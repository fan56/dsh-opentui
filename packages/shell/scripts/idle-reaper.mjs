// Idle-exit reaper (ADR-0005 decision 5, entry-side companion of
// lifecycle.ts): the lifecycle's idle-exit timer is unref()ed — a
// refcount-0 manager must stay free to exit — so a cleanly quitting TUI
// cannot deliver "the host exits after DSH_OPENTUI_HOST_IDLE_MS of
// idleness" with an in-process timer. The quitting client spawns this
// script DETACHED instead (spawnIdleReaper in src/client/boot-shared.ts):
//
//   node idle-reaper.mjs <pid> <port> <lockfilePath> <idleMs>
//
// It owns the idle window after the last client disconnected. During the
// window it polls the port and the lockfile; a client coming back CANCELS
// the timer (exit 0, the host stays — that client's own quit arms the next
// reaper). It never touches a host it does not own:
//
// - the lockfile now describes a DIFFERENT pid (a fresh boot — or
//   lifecycle's `booting` placeholder, pid = the booting client — replaced
//   the host): exit without killing;
// - the lockfile GENERATION moved since the window started (lifecycle's
//   adoptHost bumps startedAt/mtime): a client adopted the host and may
//   still be minting its cookie (up to ~15s) before its first ESTABLISHED
//   connection — spare it;
// - an ESTABLISHED TCP connection to the host port (the adoption path's
//   liveness marker): a client re-attached, spare it;
// - the lockfile cannot be read: never kill what we cannot verify.
//
// After the window with none of the above, it appends one line to
// `<dshHome>/opentui-host.idle.log`
//   <iso> reason=idle idleMs=<n> lastClientAt=<iso> host=<pid> port=<n>
// then SIGTERMs the host, escalates to SIGKILL after 2s, and clears the
// lockfile only while it still describes this host.
//
// The probe is `lsof -sTCP:ESTABLISHED`; when the tool is unavailable the
// reaper falls back to the plain lifecycle semantics (idle exit).
//
// Idempotent and leak-free: no sockets are opened (lsof is a child
// process), the process exits by itself, and a replacement host's lock is
// never removed.
import { appendFileSync, readFileSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'

const [pidArg, portArg, lockPath, idleMsArg] = process.argv.slice(2)
const pid = Number(pidArg)
const port = Number(portArg)
const idleMs = Number(idleMsArg)

// Defensive argument handling: the spawner always passes valid values, but
// a stray manual invocation must exit quietly instead of throwing.
if (!lockPath || !Number.isFinite(pid) || pid <= 0 || !Number.isFinite(idleMs) || idleMs < 0) {
  process.exit(2)
}

const startedAt = Date.now()
/** Poll cadence inside the window: fine enough to notice a re-attach well
 * before the deadline, coarse enough to keep `lsof` cheap. */
const POLL_MS = Math.max(50, Math.min(500, Math.round(idleMs / 10) || 50))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const pidAlive = (target) => {
  try {
    process.kill(target, 0)
    return true
  } catch {
    return false
  }
}

/** Established TCP connections involving the host port (0 = none, -1 =
 * the probe tool is unavailable). lsof exits 1 with no output when the
 * filter matches nothing — that IS the zero case. */
function establishedTo(targetPort) {
  const res = spawnSync('lsof', ['-nP', `-iTCP:${targetPort}`, '-sTCP:ESTABLISHED'], { encoding: 'utf8' })
  if (res.error) return -1
  if (res.status === 1) return 0
  const lines = String(res.stdout ?? '').split('\n')
  return Math.max(0, lines.slice(1).filter((l) => l.trim().length > 0).length)
}

/** Lockfile snapshot: the ownership fields plus the mtime used as the
 * generation token. null when the lock is missing or unreadable. */
function readLock() {
  try {
    const raw = JSON.parse(readFileSync(lockPath, 'utf8'))
    if (typeof raw?.pid !== 'number') return null
    let mtimeMs = 0
    try {
      mtimeMs = statSync(lockPath).mtimeMs
    } catch {
      mtimeMs = 0
    }
    return { pid: raw.pid, port: raw.port, startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '', mtimeMs }
  } catch {
    return null
  }
}

/** Has this lockfile moved to a new generation since `base`? Adoption
 * rewrites `startedAt`; the mtime comparison is the belt-and-braces for a
 * writer that keeps the field identical. */
function generationMoved(base, current) {
  if (!base || !current) return false
  if (current.startedAt !== base.startedAt) return true
  return current.mtimeMs > base.mtimeMs + 1
}

const logPath = join(dirname(lockPath), 'opentui-host.idle.log')
function logIdleExit(hostPort) {
  const line =
    `${new Date().toISOString()} reason=idle idleMs=${idleMs} ` +
    `lastClientAt=${new Date(startedAt).toISOString()} host=${pid} port=${hostPort}\n`
  try {
    appendFileSync(logPath, line)
  } catch {}
  try {
    process.stderr.write(line) // usually /dev/null (detached, stdio ignore)
  } catch {}
}

const initial = readLock()
if (!initial || initial.pid !== pid) process.exit(0) // nothing of ours to reap

const deadline = startedAt + idleMs
for (;;) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) break
  await sleep(Math.min(POLL_MS, remaining))

  const current = readLock()
  if (!current) continue // mid-rewrite or vanished: re-check at the deadline
  if (current.pid !== pid) process.exit(0) // replaced by a fresh boot — not ours
  if (generationMoved(initial, current)) process.exit(0) // adopted mid-window — a client is coming
  if (establishedTo(port) > 0) process.exit(0) // a client re-attached — cancel the idle exit
}

// Final gate: re-verify everything we saw during the window. Anything
// ambiguous (unreadable lock) means "do not kill".
const finalLock = readLock()
if (!finalLock) process.exit(0)
if (finalLock.pid !== pid) process.exit(0)
if (generationMoved(initial, finalLock)) process.exit(0)
if (establishedTo(port) > 0) process.exit(0)

logIdleExit(finalLock.port ?? port)
try {
  process.kill(pid, 'SIGTERM')
} catch {}
// Graceful window for the host's own SIGTERM disposer; escalate only when
// it is still alive afterwards. Polling (not a flat sleep) lets the lockfile
// cleanup happen as soon as the host is gone, so a new client booting right
// after the exit does not see a stale lock.
const killDeadline = Date.now() + 2000
while (Date.now() < killDeadline && pidAlive(pid)) await sleep(50)
if (pidAlive(pid)) {
  try {
    process.kill(pid, 'SIGKILL')
  } catch {}
  const hardDeadline = Date.now() + 500
  while (Date.now() < hardDeadline && pidAlive(pid)) await sleep(25)
}
// Clear the lockfile only if it still describes THIS host (never clobber
// a newer host's lock — lifecycle parity).
try {
  const now = readLock()
  if (now && now.pid === pid && now.port === finalLock.port) rmSync(lockPath, { force: true })
} catch {}
process.exit(0)
