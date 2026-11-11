// Client-mode host lifecycle manager (ADR-0005 decision 5; audit bucket (e)).
//
// `ensureHost` manages ONE resident `dsh` host per profile per machine:
//
//   const host = await ensureHost({ profile: 'opentui', idleExitSec: 5 })
//   host.authority    // '127.0.0.1:45931' — where the host listens
//   host.cookieHeader // minted Cookie header for /api + /connect auth
//   host.pid          // host child process id (or adopted pid)
//   host.port / host.url / host.token
//   host.adopted      // true when a host spawned by another (dead) client was taken over
//   host.refCount     // live users of this host from this process
//   host.retain()     // +1 (join; cancels a pending idle-exit)
//   host.release()    // -1; reaching 0 arms the idle-exit timer
//   await host.dispose() // SIGTERM (+SIGKILL escalation) now, remove lockfile
//
// Idempotency: a second `ensureHost` for the same profile + dshHome joins the
// live host (refcount +1, pending idle-exit cancelled) instead of re-booting.
//
// Single-instance lock: `$DSH_HOME/opentui-host.<profile>.json` holds
// { pid, port, authority, startedAt, profile }. A lock whose pid is dead or
// whose listener is gone is stale and taken over (replaced by a fresh boot).
// A lock whose pid lives and whose port listens is adopted ONLY after an
// authenticated probe (`GET /` with the cookie minted from this home) proves
// the process is OUR host: a foreign home / rotated grant answers 401 and
// would otherwise leave the carrier reconnecting forever. The foreign pid is
// never signalled; only the stale lock is removed.
// A fresh lock is adopted (no spawn) — that is the crashed-client recovery
// path. Unexpected child death clears the lock; the next `ensureHost`
// respawns, capped at MAX_RAPID_RESPAWNS spawn attempts inside
// RESPAWN_WINDOW_MS after which HostRespawnLoopError surfaces instead of
// looping.
//
// Cold-boot mutual exclusion: before spawning, the booter claims the
// lockfile as a `booting: true` placeholder (atomic create-if-absent —
// exactly one cold boot wins per profile across processes). Another client
// that finds a fresh booting lock WAITS for it to flip into a real lock and
// then adopts it (join); it takes over (removes the placeholder and boots
// itself) when the booting pid dies or the join budget
// (`readinessTimeoutMs + BOOT_JOIN_MARGIN_MS`) lapses. The real lock is only
// written after readiness + mint and only while the claim is still intact —
// a superseded booter kills its own child (HostBootSupersededError) instead
// of clobbering the winner's lock.
//
// Adoption bumps the lockfile (fresh startedAt/mtime): the detached idle
// reaper (scripts/idle-reaper.mjs) treats a lockfile generation change since
// its own start as a live adopter, so a client that adopted at the grace edge
// and is still minting its cookie (no ESTABLISHED connection yet) is not
// reaped underneath.
//
// Idle exit (ADR-0005 decision 5): when the refcount reaches 0 a timer of
// `idleExitSec` seconds (default 5, overridable with
// DSH_OPENTUI_HOST_IDLE_MS; `0` = never exit, resident) SIGTERMs the child
// and cleans the lockfile; an `ensureHost` inside the grace window cancels the
// timer and re-attaches. Because the in-process timer is unref()ed and dies
// with the client, a clean quit also hands the window to the detached reaper
// (scripts/idle-reaper.mjs), which owns it after this process is gone.
//
// Readiness: the `dsh web: http://127.0.0.1:<port>/?token=...` stdout line
// (verified against the shipped CLI; it prints only after the loader and the
// connection service are mounted) or an HTTP-responds fallback, within
// `readinessTimeoutMs` (default 30s) — a typed HostBootTimeoutError on miss.
// The HTTP fallback is deliberately stronger than a TCP accept: a bound
// socket that does not answer HTTP rejects the carrier's first mux upgrade.
// After a fallback boot (and the cookie mint) the lifecycle also performs the
// full `$events` handshake, so a returned host is always mux-serving. Boot
// errors quote the child's output tail (last 12 lines) in their message.
// The child is spawned detached with a bind-probed free port, so it survives
// this process and is adopted by the next client via the lockfile.
//
// Auth: `mintOwnerCookie({ home, authority, maxAgeMs? }): string` from
// ./cookie-mint.ts (owned by the transport/cookie agent; contract frozen).
// It resolves lazily at runtime so this file works before that module lands;
// tests inject a fake via `mintCookie`. A missing module at runtime throws
// MintUnavailableError. First-boot mint races ("credentials grant not yet
// written") are retried for 15s before surfacing.
//
// Known v1 limit (per ADR-0005 decision 5): the refcount is per
// manager-process. A client process that dies while holding the host leaves
// it resident; the next client adopts it through the lockfile, and a clean
// owner exit with refcount 0 shuts it down.

import { spawn } from 'node:child_process'
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { connect as netConnect, Server, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import { probeHostHttp, probeHostMux } from './host-probe.ts'

export const DEFAULT_PROFILE = 'opentui'
/** Idle-exit window: the resident host exits this long after the LAST client
 * disconnects, unless a client re-attaches inside the window. 5s is the
 * product default; `0` = never exit (resident). Override per process with
 * `DSH_OPENTUI_HOST_IDLE_MS` (milliseconds), or per call with
 * `ensureHost({ idleExitSec })`. */
export const DEFAULT_IDLE_EXIT_MS = 5_000
export const DEFAULT_IDLE_EXIT_SEC = DEFAULT_IDLE_EXIT_MS / 1000
/** Env override for the idle-exit window, in milliseconds (`0` = resident;
 * an empty or unparsable value falls back to the default). */
export const ENV_IDLE_EXIT_MS = 'DSH_OPENTUI_HOST_IDLE_MS'
export const DEFAULT_READINESS_TIMEOUT_MS = 30_000

/** Resolve the idle window (ms) for this process: explicit seconds option >
 * `DSH_OPENTUI_HOST_IDLE_MS` > `DEFAULT_IDLE_EXIT_MS`. Negative values are
 * clamped to 0 (resident); sub-millisecond values round to the nearest ms. */
export function resolveIdleExitMs(explicitSec?: number): number {
  if (explicitSec !== undefined && Number.isFinite(explicitSec)) {
    return Math.max(0, Math.round(explicitSec * 1000))
  }
  const raw = process.env[ENV_IDLE_EXIT_MS]
  if (raw !== undefined && raw.trim() !== '') {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed))
  }
  return DEFAULT_IDLE_EXIT_MS
}

/** Same window in seconds (the `ensureHost`/`release()` unit). */
export function resolveIdleExitSec(explicitSec?: number): number {
  return resolveIdleExitMs(explicitSec) / 1000
}
/** How long a lock whose pid is alive but not yet listening gets to come up
 * before we declare the lock stale (covers a cold host mid-boot). */
export const DEFAULT_STALE_PROBE_MS = 8_000
/** Join budget over the readiness budget for a foreign booting placeholder:
 * covers the post-readiness cookie mint (MINT_RETRY_BUDGET_MS = 15s) that
 * still precedes the real lock write, plus slack. */
const BOOT_JOIN_MARGIN_MS = 20_000
/** Poll cadence while waiting out a foreign booting placeholder. */
const BOOT_JOIN_POLL_MS = 200
const RESPAWN_WINDOW_MS = 15_000
const MAX_RAPID_RESPAWNS = 3
const LISTEN_PROBE_TIMEOUT_MS = 750
const LISTEN_POLL_MS = 200
/** Bound for one authenticated adoption probe (a live host answers in ms). */
const ADOPT_PROBE_TIMEOUT_MS = 2_000
/** Cadence for the post-boot mux-readiness poll (listener-fallback boots). */
const SERVE_PROBE_POLL_MS = 250
/** How long a listener-ready host gets to serve the client mux after the
 * cookie mint (the plugin tree can take seconds to mount `$events`). */
const SERVE_PROBE_BUDGET_MS = 20_000
/** Lines of child output quoted in surfaced error messages. */
const ERROR_TAIL_LINES = 12
const KILL_GRACE_MS = 5_000
const KILL_ESCALATE_MS = 2_000
const OUTPUT_TAIL_CAP = 8_000
/** The host's readiness line (empirical, shipped dsh CLI):
 * `dsh web: http://127.0.0.1:<port>/?token=...` */
const URL_LINE = /dsh web: (https?:\/\/\S+)/

// ---------------------------------------------------------------------------
// Errors — all typed, all carrying `code`.
// ---------------------------------------------------------------------------

export class HostLifecycleError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = new.target.name
    this.code = code
  }
}

/** Last `ERROR_TAIL_LINES` lines of captured child output, for error text. */
function errorTail(outputTail: string): string {
  const lines = outputTail.split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length === 0) return ''
  return `\n--- dsh host output (last ${Math.min(lines.length, ERROR_TAIL_LINES)} lines) ---\n${lines
    .slice(-ERROR_TAIL_LINES)
    .join('\n')}`
}

export class HostBootTimeoutError extends HostLifecycleError {
  constructor(readonly budgetMs: number, readonly outputTail: string) {
    super('host-boot-timeout', `dsh host did not become ready within ${budgetMs}ms${errorTail(outputTail)}`)
  }
}

export class HostDiedError extends HostLifecycleError {
  constructor(
    readonly exitCode: number | null,
    readonly signal: string | null,
    readonly outputTail: string,
  ) {
    super(
      'host-died',
      `dsh host exited before readiness (code=${exitCode ?? 'null'}, signal=${signal ?? 'null'})${errorTail(outputTail)}`,
    )
  }
}

/** The listener came up but the client mux never served a ready item — the
 * host is wedged or died just after binding (a patch/plugin failure). The
 * child's output tail is quoted so the failure is diagnosable from the TUI
 * error line alone. */
export class HostNotServingError extends HostLifecycleError {
  constructor(readonly outputTail: string) {
    super(
      'host-not-serving',
      `dsh host is listening but never served the client mux (${SERVE_PROBE_BUDGET_MS}ms budget)${errorTail(outputTail)}`,
    )
  }
}

export class HostSpawnError extends HostLifecycleError {
  constructor(readonly cause: Error) {
    super('host-spawn-failed', `failed to start dsh host: ${cause.message}`)
    this.name = new.target.name
  }
}

export class HostRespawnLoopError extends HostLifecycleError {
  constructor(readonly attempts: number, readonly windowMs: number) {
    super(
      'host-respawn-loop',
      `dsh host failed ${attempts} rapid spawn attempts within ${windowMs}ms — giving up instead of looping`,
    )
  }
}

export class HostBootSupersededError extends HostLifecycleError {
  constructor() {
    super(
      'host-boot-superseded',
      'another client took over this boot while it was coming up — our child was shut down; retry ensureHost to join the winner',
    )
  }
}

export class ProfileMissingError extends HostLifecycleError {
  constructor(readonly profile: string, readonly profileDir: string) {
    super(
      'profile-missing',
      `profile '${profile}' is not provisioned (${profileDir} missing) — run scripts/provision-opentui-profile.mjs or: dsh ${profile} --from-default-profile web --dump-config`,
    )
  }
}

export class MintUnavailableError extends HostLifecycleError {
  constructor() {
    super(
      'mint-unavailable',
      'mintOwnerCookie is unavailable: ./cookie-mint.ts not found and no mintCookie injected',
    )
  }
}

// ---------------------------------------------------------------------------
// Injectable seams + public contract.
// ---------------------------------------------------------------------------

/** Minimal shape of the spawned child the manager needs (structurally
 * satisfied by node's ChildProcess; faked in tests). */
export interface HostChildProcess {
  pid: number
  exitCode: number | null
  stdout: { on(event: 'data', listener: (chunk: unknown) => void): unknown }
  stderr: { on(event: 'data', listener: (chunk: unknown) => void): unknown }
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  kill(signal?: string): boolean
  unref?(): void
}

export type SpawnDsh = (
  argv: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => HostChildProcess

/** Frozen contract with ./cookie-mint.ts (parallel agent owns the real file). */
export type MintOwnerCookie = (opts: {
  home: string
  authority: string
  maxAgeMs?: number
}) => string

export interface EnsureHostOptions {
  /** Host profile to run. Fixed product profile per ADR-0005 decision 3. */
  profile?: string
  /** Idle seconds after the last release before the host is SIGTERMed.
   * Default 60. `0` = never exit (resident). */
  idleExitSec?: number
  /** dsh home dir. Default $DSH_HOME or ~/.dsh. */
  dshHome?: string
  /** Injectable spawn runner (tests). Default: real `dsh` from PATH. */
  spawnDsh?: SpawnDsh
  /** Injectable cookie mint (tests). Default: ./cookie-mint.ts import. */
  mintCookie?: MintOwnerCookie
  /** Readiness budget. Default 30_000. */
  readinessTimeoutMs?: number
  /** Max wait for a concurrently-booting host (another process holding the
   * `booting` placeholder) to finish, when this client cold-boots behind it.
   * Default `readinessTimeoutMs + 20s` (readiness + mint budget + slack). */
  bootJoinTimeoutMs?: number
  /** Grace window for a locked-but-not-listening pid (default 8_000). */
  staleProbeMs?: number
  /** Cookie max age forwarded to mintOwnerCookie. */
  maxAgeMs?: number
}

export interface HostHandle {
  readonly profile: string
  readonly dshHome: string
  readonly pid: number
  readonly port: number
  /** '127.0.0.1:<port>' — audience for the minted cookie. */
  readonly authority: string
  /** Minted Cookie header value; send as `Cookie: <cookieHeader>`. */
  readonly cookieHeader: string
  /** The printed `dsh web:` URL, or null when readiness came from the probe. */
  readonly url: string | null
  /** Launch token parsed out of the URL, or null. */
  readonly token: string | null
  /** Child stdout/stderr tail captured by this process ('' when adopted). */
  diagnostics(): string
  /** True when this host was adopted from the lockfile, not spawned here. */
  readonly adopted: boolean
  readonly refCount: number
  /** +1 user (cancels a pending idle-exit). */
  retain(): void
  /** -1 user; at 0 arms the idle-exit timer (unless idleExitSec is 0). */
  release(): void
  /** SIGTERM (+SIGKILL escalation), remove the lockfile, evict the entry. */
  dispose(): Promise<void>
}

// ---------------------------------------------------------------------------
// Internal state.
// ---------------------------------------------------------------------------

type HostState = 'booting' | 'ready' | 'disposing' | 'dead'

interface ManagedHost {
  key: string
  profile: string
  dshHome: string
  pid: number
  port: number
  authority: string
  cookieHeader: string
  url: string | null
  token: string | null
  adopted: boolean
  child: HostChildProcess | null
  refCount: number
  idleTimer: ReturnType<typeof setTimeout> | null
  idleExitSec: number
  maxAgeMs?: number
  state: HostState
  /** The lockfile currently describes this host. */
  lockOwned: boolean
  outputTail: string
  exitInfo: { code: number | null; signal: string | null } | null
  resolveExit: () => void
  exitPromise: Promise<void>
  termination: Promise<void> | null
  handle: HostHandle | null
  mintCookie?: MintOwnerCookie
}

interface LockFile {
  pid: number
  port: number
  authority: string
  startedAt: string
  profile: string
  /** True on the O_EXCL placeholder a booter holds between spawn and
   * readiness+mint; absent (false) on the real post-boot lock. */
  booting?: boolean
}

/** Live managed hosts, keyed by `<dshHome>\u0000<profile>`. */
const registry = new Map<string, ManagedHost>()
/** In-flight boots, same keys — concurrent ensureHosts join them. */
const pendingBoots = new Map<string, Promise<ManagedHost>>()
/** Spawn-attempt timestamps per key, for the rapid-respawn cap. */
const respawnHistory = new Map<string, number[]>()

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function registryKey(dshHome: string, profile: string): string {
  return `${dshHome}\u0000${profile}`
}

export function defaultDshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function lockPathFor(dshHome: string, profile: string): string {
  return join(dshHome, `opentui-host.${profile}.json`)
}

// ---------------------------------------------------------------------------
// Primitives: pid / listener / port / lockfile.
// ---------------------------------------------------------------------------

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const socket = netConnect({ host: '127.0.0.1', port })
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(LISTEN_PROBE_TIMEOUT_MS)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

/** Stronger than a bare TCP accept: the port answers HTTP. A host binds its
 * socket before the HTTP/WS stack is mounted, so a TCP-only readiness signal
 * hands the carrier an authority whose first mux upgrade is rejected — the
 * `[connection] connection lost, retry #n` burst this check prevents. Any
 * status counts (401/404 prove the HTTP stack is serving). */
async function httpResponds(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(LISTEN_PROBE_TIMEOUT_MS),
      redirect: 'manual',
    })
    try {
      await response.body?.cancel()
    } catch {
      /* already drained */
    }
    return true
  } catch {
    return false
  }
}

/** Bind-probe a free loopback port to hand to `dsh --port` (macOS has no
 * `timeout` command — all waiting here is JS timers). */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = new Server((socket) => socket.destroy())
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      server.close(() => resolve(port))
    })
  })
}

function readLock(dshHome: string, profile: string): LockFile | null {
  try {
    const raw = JSON.parse(readFileSync(lockPathFor(dshHome, profile), 'utf8')) as Partial<LockFile>
    if (typeof raw.pid !== 'number' || typeof raw.port !== 'number') return null
    return {
      pid: raw.pid,
      port: raw.port,
      authority: typeof raw.authority === 'string' ? raw.authority : `127.0.0.1:${raw.port}`,
      startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '',
      profile: typeof raw.profile === 'string' ? raw.profile : profile,
      booting: raw.booting === true,
    }
  } catch {
    return null // missing or corrupt → stale
  }
}

function writeLock(dshHome: string, profile: string, host: ManagedHost): void {
  mkdirSync(dshHome, { recursive: true })
  const path = lockPathFor(dshHome, profile)
  const payload: LockFile = {
    pid: host.pid,
    port: host.port,
    authority: host.authority,
    startedAt: new Date().toISOString(),
    profile,
  }
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n')
  renameSync(tmp, path) // near-atomic single-instance lock write
}

/** Remove the lockfile only if it still describes THIS host (never clobber a
 * newer host's lock). */
function clearOurLock(host: ManagedHost): void {
  if (!host.lockOwned) return
  const lock = readLock(host.dshHome, host.profile)
  if (lock && lock.pid === host.pid && lock.port === host.port) {
    rmSync(lockPathFor(host.dshHome, host.profile), { force: true })
  }
}

// -- Cold-boot mutual exclusion (the `booting` placeholder) -----------------

/** Atomically claim the lockfile as a booting placeholder (create-if-absent
 * via link(2) on a fully-written tmp file — the winner's content is complete
 * at creation, so readers never see a partial claim). Exactly one cold boot
 * per profile wins across processes. Returns the claim's startedAt token, or
 * null when a rival (booting placeholder or real lock) already holds the
 * file. The placeholder's pid is the BOOTER's pid — the liveness anchor until
 * the real lock (child pid) replaces it. */
function claimBootLock(dshHome: string, profile: string): string | null {
  mkdirSync(dshHome, { recursive: true })
  const path = lockPathFor(dshHome, profile)
  const payload: LockFile = {
    pid: process.pid,
    port: 0, // unknown until the bind probe; waiters never probe it
    authority: '127.0.0.1:0',
    startedAt: new Date().toISOString(),
    profile,
    booting: true,
  }
  const tmp = `${path}.claim-${process.pid}-${Date.now()}`
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n')
  try {
    linkSync(tmp, path) // EEXIST when a rival holds the file
    return payload.startedAt
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return null
    throw err
  } finally {
    rmSync(tmp, { force: true })
  }
}

/** Remove a booting placeholder only if it still describes THIS claim (pid,
 * optionally the startedAt token) — never a completed boot's real lock or a
 * rival's newer claim. */
function removeBootClaim(
  dshHome: string,
  profile: string,
  claim: { pid: number; startedAt?: string },
): boolean {
  const path = lockPathFor(dshHome, profile)
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockFile>
    if (raw.booting !== true || raw.pid !== claim.pid) return false
    if (claim.startedAt !== undefined && raw.startedAt !== claim.startedAt) return false
  } catch {
    return false // gone or corrupt — nothing of ours to remove
  }
  rmSync(path, { force: true })
  return true
}

/** Remove a stale REAL lock only if it still describes the lock we judged
 * stale (never clobber a fresher write, never touch a placeholder). */
function removeStaleLock(dshHome: string, profile: string, stale: LockFile): boolean {
  const path = lockPathFor(dshHome, profile)
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockFile>
    if (raw.booting === true || raw.pid !== stale.pid || raw.port !== stale.port) return false
  } catch {
    return false
  }
  rmSync(path, { force: true })
  return true
}

/** True while the lockfile still holds OUR booting claim. */
function bootClaimIntact(dshHome: string, profile: string, startedAt: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(lockPathFor(dshHome, profile), 'utf8')) as Partial<LockFile>
    return raw.booting === true && raw.pid === process.pid && raw.startedAt === startedAt
  } catch {
    return false
  }
}

/** Wait out a foreign booting placeholder (cross-process cold-boot mutual
 * exclusion): poll until the claim either flips into a real lock (the boot
 * completed — bootHost re-evaluates and adopts it) or becomes takeable
 * (booting pid dead / join budget lapsed — bootHost re-evaluates, finds no
 * lock and claims the boot itself). Never signals the booting pid. */
async function waitOutBootingLock(first: LockFile, o: ResolvedOptions): Promise<void> {
  // A booting claim naming OUR pid is a leftover from a previous incarnation
  // of this pid (crash + pid reuse): take it over immediately.
  if (first.pid === process.pid) {
    removeBootClaim(o.dshHome, o.profile, { pid: first.pid })
    return
  }
  const budget = o.bootJoinTimeoutMs ?? o.readinessTimeoutMs + BOOT_JOIN_MARGIN_MS
  const deadline = Date.now() + budget
  const claim = { pid: first.pid, startedAt: first.startedAt }
  while (Date.now() < deadline) {
    await sleep(BOOT_JOIN_POLL_MS)
    if (!pidAlive(claim.pid)) {
      // the booter died mid-boot: its claim is abandoned — take it over
      removeBootClaim(o.dshHome, o.profile, claim)
      return
    }
    const current = readLock(o.dshHome, o.profile)
    if (!current || !current.booting) return // boot completed (or claim gone) — re-evaluate
  }
  // Join budget lapsed: force the takeover if the claim is unchanged.
  removeBootClaim(o.dshHome, o.profile, claim)
}

// ---------------------------------------------------------------------------
// Cookie mint resolution (real module owned by the transport/cookie agent).
// ---------------------------------------------------------------------------

let realMintPromise: Promise<MintOwnerCookie | null> | null = null

/** Resolves `mintOwnerCookie` from ./cookie-mint.ts at runtime. The specifier
 * is built dynamically on purpose: the module is owned by the parallel
 * transport/cookie agent and may not exist yet — a literal import would fail
 * to typecheck until it lands, and flipping ts-ignore/expect-error would
 * break whichever side lands last. */
function loadRealMint(): Promise<MintOwnerCookie | null> {
  realMintPromise ??= (async () => {
    const dynamicImport = (specifier: string): Promise<unknown> => import(specifier)
    for (const specifier of ['./cookie-mint.js', './cookie-mint.ts']) {
      try {
        const mod: unknown = await dynamicImport(specifier)
        const mint = (mod as { mintOwnerCookie?: unknown }).mintOwnerCookie
        if (typeof mint === 'function') return mint as MintOwnerCookie
      } catch {
        // try next specifier / fall through to null
      }
    }
    return null
  })()
  return realMintPromise
}

async function mintCookieFor(host: ManagedHost): Promise<string> {
  const mint = host.mintCookie ?? (await loadRealMint())
  if (!mint) throw new MintUnavailableError()
  return mint({
    home: host.dshHome,
    authority: host.authority,
    ...(host.maxAgeMs !== undefined ? { maxAgeMs: host.maxAgeMs } : {}),
  })
}

/** Mint errors that mean "the host has not written its grant yet" (first-boot
 * race — the Host persists `client-connection/browser-session` during
 * connection activation, which can lag the readiness line on a cold boot).
 * cookie-mint.ts already retries these for 2s internally; a cold scratch
 * home needs more, so the manager retries them here too. Permanent mint
 * failures (insecure file, invalid grant shape) surface immediately. */
const RETRYABLE_MINT_ERRORS = new Set(['CredentialsFileMissingError', 'CredentialsGrantMissingError'])
const MINT_RETRY_BUDGET_MS = 15_000
const MINT_RETRY_INTERVAL_MS = 250

async function mintCookieWithRetry(host: ManagedHost): Promise<string> {
  const deadline = Date.now() + MINT_RETRY_BUDGET_MS
  for (;;) {
    try {
      return await mintCookieFor(host)
    } catch (err) {
      const retryable = err instanceof Error && RETRYABLE_MINT_ERRORS.has(err.name)
      if (!retryable || Date.now() >= deadline) throw err
      await sleep(MINT_RETRY_INTERVAL_MS)
    }
  }
}

// ---------------------------------------------------------------------------
// Child plumbing.
// ---------------------------------------------------------------------------

function defaultSpawnDsh(argv: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): HostChildProcess {
  const env = { ...options.env }
  // npm_config_* leaks from `npm run` wrappers confuse the dsh boot; strip.
  for (const key of Object.keys(env)) {
    if (key.startsWith('npm_config_')) delete env[key]
  }
  const child = spawn('dsh', argv, {
    cwd: options.cwd,
    env,
    detached: true, // resident host must survive this client process
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.unref()
  // piped stdio keeps the manager's event loop alive; unref the pipes too
  // (bun's stream types omit unref, hence the structural cast)
  for (const pipe of [child.stdout, child.stderr]) {
    ;(pipe as unknown as { unref?: () => void }).unref?.()
  }
  return child as unknown as HostChildProcess
}

/** OpenTUI's native layer (host-entry-v2) needs node's `--experimental-ffi`;
 * a bare `dsh --profile <profile>` does not carry it (only the dsh-opentui
 * launcher injects it, and client mode never runs through that launcher).
 * Without the flag the mounted v2 shell re-execs the whole dsh command line
 * to add it (reExecWithFfi) — a second host instance then races the booting
 * listener (EADDRINUSE) and the client's TUI renders blank. Merge the flag
 * into NODE_OPTIONS here, once, deduped as a space-delimited token (the same
 * rule as the dsh-opentui launcher's `--plugin` branch) so an inherited
 * NODE_OPTIONS that already carries the flag is passed through untouched. */
const FFI_FLAG = '--experimental-ffi'

function withFfiFlag(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const existing = env.NODE_OPTIONS ?? ''
  if (existing.split(/\s+/).includes(FFI_FLAG)) return env
  return { ...env, NODE_OPTIONS: `${existing} ${FFI_FLAG}`.trim() }
}

function childEnv(dshHome: string): NodeJS.ProcessEnv {
  return withFfiFlag({ ...process.env, DSH_HOME: dshHome })
}

function attachChildWatchers(host: ManagedHost, child: HostChildProcess): void {
  const push = (chunk: unknown) => {
    host.outputTail = (host.outputTail + String(chunk)).slice(-OUTPUT_TAIL_CAP)
  }
  child.stdout.on('data', push)
  child.stderr.on('data', push)
  child.on('error', () => {
    // post-boot spawn errors (rare; boot-time ones are surfaced by the
    // readiness waiter's own 'error' listener)
  })
  child.on('exit', (code, signal) => {
    host.exitInfo = { code, signal }
    host.resolveExit()
    if (host.state === 'ready') {
      // unexpected death: clear the lock, evict; the next ensureHost respawns
      if (host.idleTimer) {
        clearTimeout(host.idleTimer)
        host.idleTimer = null
      }
      clearOurLock(host)
      host.state = 'dead'
      registry.delete(host.key)
    }
    // 'booting' → the readiness waiter rejects; 'disposing' → our own kill.
  })
}

interface ReadyResult {
  url: string | null
  token: string | null
  port: number
  authority: string
  /** Which signal resolved readiness. `url` is the host's post-loader line
   * (the full plugin tree and the connection service are mounted); `listener`
   * is the weaker HTTP fallback and must be followed by a mux probe. */
  via: 'url' | 'listener'
}

function readyFromUrl(urlText: string): ReadyResult {
  const url = new URL(urlText)
  const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
  return {
    url: urlText,
    token: url.searchParams.get('token'),
    port,
    authority: `${url.hostname}:${port}`,
    via: 'url',
  }
}

function waitForReadiness(
  child: HostChildProcess,
  expectedPort: number,
  budgetMs: number,
  getTail: () => string,
): Promise<ReadyResult> {
  return new Promise<ReadyResult>((resolve, reject) => {
    let settled = false
    const done = (ok: boolean, value: ReadyResult | HostLifecycleError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(poll)
      if (ok) resolve(value as ReadyResult)
      else reject(value)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      done(false, new HostBootTimeoutError(budgetMs, getTail()))
    }, budgetMs)
    child.on('exit', (code, signal) =>
      done(false, new HostDiedError(code, signal, getTail())),
    )
    child.on('error', (err) => done(false, new HostSpawnError(err)))
    child.stdout.on('data', (chunk) => {
      const match = URL_LINE.exec(String(chunk))
      if (match) done(true, readyFromUrl(match[1]!))
    })
    // Fallback: wait for the HTTP stack, not just the bound socket (in case
    // the stdout contract changes). TCP-bind readiness is too early — the
    // carrier's first mux upgrade would be rejected.
    const poll = setInterval(() => {
      void httpResponds(expectedPort).then((up) => {
        if (up) {
          done(true, {
            url: null,
            token: null,
            port: expectedPort,
            authority: `127.0.0.1:${expectedPort}`,
            via: 'listener',
          })
        }
      })
    }, LISTEN_POLL_MS)
  })
}

// ---------------------------------------------------------------------------
// Boot / adopt / terminate.
// ---------------------------------------------------------------------------

function makeHandle(host: ManagedHost): HostHandle {
  host.handle ??= {
    get profile() {
      return host.profile
    },
    get dshHome() {
      return host.dshHome
    },
    get pid() {
      return host.pid
    },
    get port() {
      return host.port
    },
    get authority() {
      return host.authority
    },
    get cookieHeader() {
      return host.cookieHeader
    },
    get url() {
      return host.url
    },
    get token() {
      return host.token
    },
    diagnostics() {
      return errorTail(host.outputTail).replace(/^\n/, '')
    },
    get adopted() {
      return host.adopted
    },
    get refCount() {
      return host.refCount
    },
    retain() {
      attachHost(host)
    },
    release() {
      releaseHost(host)
    },
    dispose() {
      return terminateHost(host)
    },
  }
  return host.handle!
}

function adoptHost(lock: LockFile, o: ResolvedOptions): ManagedHost {
  const host: ManagedHost = {
    key: o.key,
    profile: o.profile,
    dshHome: o.dshHome,
    pid: lock.pid,
    port: lock.port,
    authority: lock.authority,
    cookieHeader: '',
    url: null,
    token: null,
    adopted: true,
    child: null,
    refCount: 0,
    idleTimer: null,
    idleExitSec: o.idleExitSec,
    maxAgeMs: o.maxAgeMs,
    state: 'ready',
    lockOwned: true, // the existing lockfile already describes this host
    outputTail: '',
    exitInfo: null,
    resolveExit: () => {},
    exitPromise: Promise.resolve(),
    termination: null,
    handle: null,
    mintCookie: o.mintCookie,
  }
  registry.set(o.key, host)
  // Adoption bump: refresh startedAt/mtime so the detached idle reaper sees
  // recent liveness — the adopted client can spend up to MINT_RETRY_BUDGET_MS
  // minting its cookie before its first ESTABLISHED connection, past a
  // grace-edge adoption.
  writeLock(o.dshHome, o.profile, host)
  return host
}

interface ResolvedOptions {
  profile: string
  dshHome: string
  idleExitSec: number
  readinessTimeoutMs: number
  bootJoinTimeoutMs?: number
  staleProbeMs: number
  maxAgeMs?: number
  spawnDsh: SpawnDsh
  mintCookie?: MintOwnerCookie
  key: string
}

function resolveOptions(opts: EnsureHostOptions): ResolvedOptions {
  const profile = opts.profile ?? DEFAULT_PROFILE
  const dshHome = opts.dshHome ?? defaultDshHome()
  const idleExitSec = resolveIdleExitSec(opts.idleExitSec)
  return {
    profile,
    dshHome,
    idleExitSec,
    readinessTimeoutMs: opts.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
    ...(opts.bootJoinTimeoutMs !== undefined ? { bootJoinTimeoutMs: opts.bootJoinTimeoutMs } : {}),
    staleProbeMs: opts.staleProbeMs ?? DEFAULT_STALE_PROBE_MS,
    ...(opts.maxAgeMs !== undefined ? { maxAgeMs: opts.maxAgeMs } : {}),
    spawnDsh: opts.spawnDsh ?? defaultSpawnDsh,
    ...(opts.mintCookie !== undefined ? { mintCookie: opts.mintCookie } : {}),
    key: registryKey(dshHome, profile),
  }
}

async function bootHost(o: ResolvedOptions): Promise<ManagedHost> {
  // Respawn cap: no infinite loops. Spawn attempts inside the rolling window
  // count; a successful boot resets the history.
  const now = Date.now()
  const history = (respawnHistory.get(o.key) ?? []).filter((t) => now - t < RESPAWN_WINDOW_MS)
  if (history.length >= MAX_RAPID_RESPAWNS) {
    throw new HostRespawnLoopError(MAX_RAPID_RESPAWNS, RESPAWN_WINDOW_MS)
  }
  respawnHistory.set(o.key, [...history, now])

  // Phase 1 — resolve the single-instance lock. Loops until this process
  // either adopts a live host or holds the O_EXCL booting claim.
  let claimStartedAt = ''
  for (;;) {
    const lock = readLock(o.dshHome, o.profile)
    if (lock?.booting) {
      // Another process holds the cold-boot claim: wait it out (join on
      // success, takeover on booter death / join-budget lapse), then
      // re-evaluate — a completed boot is adopted below.
      await waitOutBootingLock(lock, o)
      continue
    }
    if (lock && (await lockIsFresh(lock, o.staleProbeMs))) {
      const adopted = adoptHost(lock, o) // bumps the lockfile (reaper liveness)
      adopted.cookieHeader = await mintCookieWithRetry(adopted)
      // A live pid + open port is not enough: the process must accept OUR
      // cookie (same home grant) and serve the web app. A foreign/rotated
      // host on that port answers 401/404 and would make the carrier retry
      // forever — treat the lock as stale and boot fresh instead.
      if (
        await probeHostHttp({
          authority: adopted.authority,
          cookieHeader: adopted.cookieHeader,
          timeoutMs: ADOPT_PROBE_TIMEOUT_MS,
        })
      ) {
        respawnHistory.delete(o.key)
        return adopted
      }
      // Never signal the foreign pid (it may belong to another home / user);
      // drop only the stale lock so the fresh boot can claim it.
      registry.delete(o.key)
      removeStaleLock(o.dshHome, o.profile, lock)
      continue
    }
    // Stale lock (or none): clear the way, verify the profile, claim the
    // boot placeholder. A rival that claimed first leaves the file in place
    // (EEXIST) — re-evaluate against its booting claim.
    if (lock) removeStaleLock(o.dshHome, o.profile, lock)
    const lockPath = lockPathFor(o.dshHome, o.profile)
    if (!existsSync(lockPath)) {
      const profileDir = join(o.dshHome, 'profiles', o.profile)
      if (!existsSync(profileDir)) throw new ProfileMissingError(o.profile, profileDir)
      const claimed = claimBootLock(o.dshHome, o.profile)
      if (claimed !== null) {
        claimStartedAt = claimed
        break // we hold the claim — proceed to spawn
      }
    } else if (readLock(o.dshHome, o.profile) === null) {
      // File exists but is unreadable/corrupt: pre-fix semantics treat a
      // corrupt lock as stale — remove it and re-evaluate.
      rmSync(lockPath, { force: true })
    }
    await sleep(BOOT_JOIN_POLL_MS)
  }

  // Phase 2 — boot under the claim. The claim is released by writeLock on
  // success and removed in the failure path.
  const profileDir = join(o.dshHome, 'profiles', o.profile)
  const port = await getFreePort()
  const child = o.spawnDsh(['--profile', o.profile, '--no-open', '--port', String(port)], {
    cwd: profileDir,
    env: childEnv(o.dshHome),
  })
  const host: ManagedHost = {
    key: o.key,
    profile: o.profile,
    dshHome: o.dshHome,
    pid: child.pid,
    port,
    authority: `127.0.0.1:${port}`,
    cookieHeader: '',
    url: null,
    token: null,
    adopted: false,
    child,
    refCount: 0,
    idleTimer: null,
    idleExitSec: o.idleExitSec,
    maxAgeMs: o.maxAgeMs,
    state: 'booting',
    lockOwned: false,
    outputTail: '',
    exitInfo: null,
    resolveExit: () => {},
    exitPromise: Promise.resolve(),
    termination: null,
    handle: null,
    mintCookie: o.mintCookie,
  }
  {
    let resolveExit!: () => void
    host.exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    host.resolveExit = resolveExit
  }
  attachChildWatchers(host, child)

  try {
    const ready = await waitForReadiness(child, port, o.readinessTimeoutMs, () => host.outputTail)
    host.url = ready.url
    host.token = ready.token
    if (ready.port !== port) {
      host.port = ready.port
    }
    host.authority = ready.authority
    host.cookieHeader = await mintCookieWithRetry(host)
    // The listener-fallback readiness only proves the HTTP stack answers.
    // Gate on the actual client mux ($events ready item) so the carrier's
    // first attempt cannot land in the retry loop; the URL line already
    // implies the loader + connection service are mounted.
    if (ready.via === 'listener') {
      const deadline = Date.now() + SERVE_PROBE_BUDGET_MS
      let serving = false
      while (Date.now() < deadline) {
        serving = await probeHostMux({
          authority: host.authority,
          cookieHeader: host.cookieHeader,
          timeoutMs: 1_500,
        })
        if (serving) break
        if (!pidAlive(child.pid)) break // died after binding: surface the tail now
        await sleep(SERVE_PROBE_POLL_MS)
      }
      if (!serving) throw new HostNotServingError(host.outputTail)
    }
    // Claim still ours? A join-budget takeover by another client replaced the
    // placeholder — kill our child rather than clobber the winner's lock
    // (which would leave two live hosts and concurrent DSH_HOME writers).
    if (!bootClaimIntact(o.dshHome, o.profile, claimStartedAt)) {
      throw new HostBootSupersededError()
    }
    writeLock(o.dshHome, o.profile, host) // replaces the booting placeholder
    host.lockOwned = true
    host.state = 'ready'
    respawnHistory.delete(o.key)
    registry.set(o.key, host)
    return host
  } catch (err) {
    // Boot failed (timeout / death / mint / superseded): release the claim
    // and shut down what we started.
    removeBootClaim(o.dshHome, o.profile, { pid: process.pid, startedAt: claimStartedAt })
    await terminateHost(host).catch(() => {})
    throw err
  }
}

/** Fresh lock check: pid alive AND listener up. A pid that is alive but not
 * listening may be mid-boot, so it gets `staleProbeMs` to come up. */
async function lockIsFresh(lock: LockFile, staleProbeMs: number): Promise<boolean> {
  if (!pidAlive(lock.pid)) return false
  if (await isListening(lock.port)) return true
  const deadline = Date.now() + staleProbeMs
  while (Date.now() < deadline) {
    await sleep(LISTEN_POLL_MS)
    if (!pidAlive(lock.pid)) return false
    if (await isListening(lock.port)) return true
  }
  return false
}

function attachHost(host: ManagedHost): void {
  host.refCount += 1
  if (host.idleTimer) {
    clearTimeout(host.idleTimer)
    host.idleTimer = null
  }
}

function releaseHost(host: ManagedHost): void {
  host.refCount = Math.max(0, host.refCount - 1)
  if (host.refCount === 0 && host.state === 'ready' && host.idleExitSec > 0) {
    const timer = setTimeout(() => {
      host.idleTimer = null
      void terminateHost(host)
    }, host.idleExitSec * 1000)
    timer.unref?.() // a refcount-0 manager must not hang on this timer
    host.idleTimer = timer
  }
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    // already gone — fine
  }
}

async function waitPidGone(pid: number, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (pidAlive(pid)) {
    if (Date.now() > deadline) return false
    await sleep(LISTEN_POLL_MS)
  }
  return true
}

async function terminateHost(host: ManagedHost): Promise<void> {
  if (host.state === 'dead') {
    clearOurLock(host)
    registry.delete(host.key)
    return
  }
  if (host.state === 'disposing' && host.termination) return host.termination
  if (host.termination) return host.termination

  host.state = 'disposing'
  clearOurLock(host)
  registry.delete(host.key)

  host.termination = (async () => {
    if (host.child) {
      host.child.kill('SIGTERM')
      await Promise.race([host.exitPromise, sleep(KILL_GRACE_MS)])
      if (!host.exitInfo) {
        signalPid(host.pid, 'SIGKILL')
        await Promise.race([host.exitPromise, sleep(KILL_ESCALATE_MS)])
      }
    } else {
      // Adopted host: no child object in this process; signal by pid.
      signalPid(host.pid, 'SIGTERM')
      if (!(await waitPidGone(host.pid, KILL_GRACE_MS))) {
        signalPid(host.pid, 'SIGKILL')
        await waitPidGone(host.pid, KILL_ESCALATE_MS)
      }
    }
    host.state = 'dead'
  })()
  // The exit watcher only acts on state 'ready', so our own SIGTERM here
  // ('disposing') and booting failures ('booting') are not re-evicted.
  return host.termination
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/** Manage one resident dsh host per profile (see file header for the full
 * contract). Idempotent: existing live hosts are joined, not re-booted. */
export async function ensureHost(opts: EnsureHostOptions = {}): Promise<HostHandle> {
  const o = resolveOptions(opts)

  const live = registry.get(o.key)
  if (live && live.state === 'ready') {
    attachHost(live)
    return makeHandle(live)
  }

  const pending = pendingBoots.get(o.key)
  if (pending) {
    const host = await pending
    attachHost(host)
    return makeHandle(host)
  }

  const boot = bootHost(o).finally(() => pendingBoots.delete(o.key))
  pendingBoots.set(o.key, boot)
  const host = await boot
  attachHost(host)
  return makeHandle(host)
}

// ---------------------------------------------------------------------------
// Test-only internals.
// ---------------------------------------------------------------------------

/** Exposed strictly for the lifecycle tests: registry eviction checks and
 * probing whether the real cookie-mint module has landed. Not a public API. */
export const __internals = {
  registry,
  pendingBoots,
  respawnHistory,
  loadRealMint,
  lockPathFor,
  registryKey,
}
