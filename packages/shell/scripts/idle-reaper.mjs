// Idle-exit reaper (ADR-0005 decision 5, entry-side companion of
// lifecycle.ts): the lifecycle's idle-exit timer is unref()ed — a
// refcount-0 manager must stay free to exit — so a cleanly quitting TUI
// cannot deliver "the host exits after idleExitSec of idleness" with an
// in-process timer. The quitting client spawns this script DETACHED
// instead (spawnIdleReaper in src/client-entry.tsx):
//
//   bun idle-reaper.mjs <pid> <port> <lockfilePath> <graceSec>
//
// After the grace window it shuts the host down — unless:
// - the lockfile now describes a DIFFERENT pid (a fresh boot replaced the
//   host): never touch what we do not own;
// - a client re-attached inside the grace window (established TCP
//   connections to the host port — the adoption path keeps the host alive
//   under its new owner; that owner's own quit spawns the next reaper).
// The probe is `lsof -sTCP:ESTABLISHED`; when the tool is unavailable the
// reaper falls back to the plain lifecycle semantics (idle exit).
import { readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const [pidArg, portArg, lockPath, graceArg] = process.argv.slice(2)
const pid = Number(pidArg)
const port = Number(portArg)
const graceSec = Number(graceArg ?? 60)

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

function readLock() {
  try {
    const raw = JSON.parse(readFileSync(lockPath, 'utf8'))
    return typeof raw?.pid === 'number' ? raw : null
  } catch {
    return null
  }
}

await sleep(graceSec * 1000)

const lock = readLock()
if (!lock || lock.pid !== pid) process.exit(0) // replaced by a fresh boot — not ours

const established = establishedTo(port)
if (established > 0) process.exit(0) // a client re-attached — the host stays under its new owner

try {
  process.kill(pid, 'SIGTERM')
} catch {}
await sleep(2000)
if (pidAlive(pid)) {
  try {
    process.kill(pid, 'SIGKILL')
  } catch {}
}
// Clear the lockfile only if it still describes THIS host (never clobber
// a newer host's lock — lifecycle parity).
try {
  const now = readLock()
  if (now && now.pid === pid && now.port === port) rmSync(lockPath, { force: true })
} catch {}
process.exit(0)
