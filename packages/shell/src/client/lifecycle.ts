// Client-mode host lifecycle manager (ADR-0005 decision 5; audit bucket (e)).
//
// `ensureHost` manages ONE resident `dsh` host per profile per machine:
//
//   const host = await ensureHost({ profile: 'opentui', idleExitSec: 60 })
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
// A fresh lock is adopted (no spawn) — that is the crashed-client recovery
// path. Unexpected child death clears the lock; the next `ensureHost`
// respawns, capped at MAX_RAPID_RESPAWNS spawn attempts inside
// RESPAWN_WINDOW_MS after which HostRespawnLoopError surfaces instead of
// looping.
//
// Idle exit (ADR-0005 decision 5): when the refcount reaches 0 a timer of
// `idleExitSec` seconds (default 60; `0` = never exit, resident) SIGTERMs the
// child and cleans the lockfile; an `ensureHost` inside the grace window
// cancels the timer and re-attaches.
//
// Readiness: the `dsh web: http://127.0.0.1:<port>/?token=...` stdout line
// (verified against the shipped CLI) or a TCP listener probe, within
// `readinessTimeoutMs` (default 30s) — a typed HostBootTimeoutError on miss.
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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { connect as netConnect, Server, type AddressInfo } from 'node:net'
import { join } from 'node:path'

export const DEFAULT_PROFILE = 'opentui'
export const DEFAULT_IDLE_EXIT_SEC = 60
export const DEFAULT_READINESS_TIMEOUT_MS = 30_000
/** How long a lock whose pid is alive but not yet listening gets to come up
 * before we declare the lock stale (covers a cold host mid-boot). */
export const DEFAULT_STALE_PROBE_MS = 8_000
const RESPAWN_WINDOW_MS = 15_000
const MAX_RAPID_RESPAWNS = 3
const LISTEN_PROBE_TIMEOUT_MS = 750
const LISTEN_POLL_MS = 200
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

export class HostBootTimeoutError extends HostLifecycleError {
  constructor(readonly budgetMs: number, readonly outputTail: string) {
    super('host-boot-timeout', `dsh host did not become ready within ${budgetMs}ms`)
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
      `dsh host exited before readiness (code=${exitCode ?? 'null'}, signal=${signal ?? 'null'})`,
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

function childEnv(dshHome: string): NodeJS.ProcessEnv {
  return { ...process.env, DSH_HOME: dshHome }
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
}

function readyFromUrl(urlText: string): ReadyResult {
  const url = new URL(urlText)
  const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
  return {
    url: urlText,
    token: url.searchParams.get('token'),
    port,
    authority: `${url.hostname}:${port}`,
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
    // Fallback: the listener probe (in case the stdout contract changes).
    const poll = setInterval(() => {
      void isListening(expectedPort).then((up) => {
        if (up) {
          done(true, {
            url: null,
            token: null,
            port: expectedPort,
            authority: `127.0.0.1:${expectedPort}`,
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
  return host
}

interface ResolvedOptions {
  profile: string
  dshHome: string
  idleExitSec: number
  readinessTimeoutMs: number
  staleProbeMs: number
  maxAgeMs?: number
  spawnDsh: SpawnDsh
  mintCookie?: MintOwnerCookie
  key: string
}

function resolveOptions(opts: EnsureHostOptions): ResolvedOptions {
  const profile = opts.profile ?? DEFAULT_PROFILE
  const dshHome = opts.dshHome ?? defaultDshHome()
  const idleExitSec = opts.idleExitSec ?? DEFAULT_IDLE_EXIT_SEC
  return {
    profile,
    dshHome,
    idleExitSec,
    readinessTimeoutMs: opts.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
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

  // Single-instance lock: adopt a fresh lock, take over a stale one.
  const lock = readLock(o.dshHome, o.profile)
  if (lock && (await lockIsFresh(lock, o.staleProbeMs))) {
    const adopted = adoptHost(lock, o)
    respawnHistory.delete(o.key)
    adopted.cookieHeader = await mintCookieWithRetry(adopted)
    return adopted
  }
  // Stale lock (or none): fall through — the fresh boot replaces the file.

  const profileDir = join(o.dshHome, 'profiles', o.profile)
  if (!existsSync(profileDir)) throw new ProfileMissingError(o.profile, profileDir)

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
    writeLock(o.dshHome, o.profile, host)
    host.lockOwned = true
    host.state = 'ready'
    respawnHistory.delete(o.key)
    registry.set(o.key, host)
    return host
  } catch (err) {
    // Boot failed (timeout / death / mint): shut down what we started.
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
