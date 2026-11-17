/**
 * Client-side refcount / heartbeat / last-one grace lifecycle (ADR-0009
 * decision 6; DESIGN-redesign §4) plus the all-crash fallback watchdog and the
 * `--force`/`--yes` guard (decisions 7–8).
 *
 * WHY ONE FILE PER CLIENT: the v2 registry's `clients` array is NOT mutated via
 * read-modify-write — N concurrent clients doing that lose updates. Instead
 * each attached client owns an independent heartbeat file
 * `<DSH_HOME>/opentui-clients/<clientId>.json` ({ id, pid, lastSeen, workspace })
 * refreshed every ~3s. "Refcount" is just the count of FRESH heartbeats
 * (lastSeen within a 15s TTL). Writing a heartbeat only touches that client's
 * own file, so concurrent clients never clobber one another.
 *
 * Lifecycle rules:
 *  - register on every successful attach (spawned, adopted, or self-booted);
 *  - unregister (delete own file) on normal exit;
 *  - last one out: after deleting, if no OTHER fresh heartbeat remains, wait a
 *    grace window, re-check, then SIGTERM the registry host (graceful flush)
 *    and clear the registry;
 *  - all-crash fallback: a detached watchdog polls the heartbeat dir; after
 *    TTL + grace with NO fresh client it three-evidence-stops the host, clears
 *    the registry, and exits. It self-exits when the host is already gone.
 *
 * `DSH_OPENTUI_HOST_IDLE_MS` is REINTERPRETED here as the last-one grace
 * override (default 2000ms, `0` = resident / never auto-close). It is NOT the
 * old "5s idle → kill a live-connection client" behaviour (ADR-0009 decision 6).
 *
 * Every I/O seam (fs, clock, sleep, pid probe, signal hooks, spawn) is
 * injectable: unit tests drive the whole state machine with fakes — no real
 * host, socket, timer or signal.
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync as nodeExistsSync,
  mkdirSync as nodeMkdirSync,
  readFileSync as nodeReadFileSync,
  readdirSync as nodeReaddirSync,
  renameSync as nodeRenameSync,
  unlinkSync as nodeUnlinkSync,
  writeFileSync as nodeWriteFileSync,
} from 'node:fs'
import { join } from 'node:path'

import {
  readRegistry,
  registryPath,
  type HostRegistryV2,
  type RegistryReadResult,
} from './host-registry.ts'
import {
  psKillHooks,
  safeStopHost,
  SERVER_ENV_NAME,
  SERVER_ENV_VALUE,
  type ProcessKillHooks,
  type SafeStopResult,
} from './safe-kill.ts'

/** Default three-evidence hooks, re-exported so embedders can pass `hooks`. */
export { psKillHooks }

// ---------------------------------------------------------------------------
// Constants + value types.
// ---------------------------------------------------------------------------

/** Directory holding one heartbeat file per attached client. */
export const CLIENTS_DIR_NAME = 'opentui-clients'
/** Heartbeat refresh cadence (~3s per the ADR). */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 3_000
/** A heartbeat older than this is treated as a dead client. */
export const DEFAULT_CLIENT_TTL_MS = 15_000
/** Default last-one-out grace window. */
export const DEFAULT_LAST_ONE_GRACE_MS = 2_000
/** Env override for the grace window (0 = resident). */
export const ENV_IDLE_MS = 'DSH_OPENTUI_HOST_IDLE_MS'
/** Watchdog poll cadence. */
export const DEFAULT_WATCHDOG_POLL_MS = 1_000
/** Watchdog env: home / profile / explicit "I am the watchdog" marker. */
export const ENV_WATCHDOG = 'DSH_OPENTUI_WATCHDOG'
export const ENV_WATCHDOG_HOME = 'DSH_OPENTUI_WATCHDOG_HOME'
export const ENV_WATCHDOG_PROFILE = 'DSH_OPENTUI_WATCHDOG_PROFILE'

/** One attached client's heartbeat record. */
export interface ClientHeartbeat {
  id: string
  pid: number
  /** ISO timestamp of the last heartbeat refresh. */
  lastSeen: string
  workspace: string
}

// ---------------------------------------------------------------------------
// Injectable fs + clock + sleep seams.
// ---------------------------------------------------------------------------

/** The slice of `node:fs` the heartbeat / registry path needs. */
export interface LifecycleFs {
  existsSync(path: string): boolean
  mkdirSync(path: string, options?: { recursive?: boolean }): void
  readFileSync(path: string, encoding: 'utf8'): string
  writeFileSync(path: string, data: string, options?: { mode?: number }): void
  unlinkSync(path: string): void
  /** Optional on injected fakes that pre-seed files without a dir listing. */
  readdirSync?(path: string): string[]
  renameSync?(from: string, to: string): void
}

export const nodeLifecycleFs: LifecycleFs = {
  existsSync: (p) => nodeExistsSync(p),
  mkdirSync: (p, o) => nodeMkdirSync(p, o),
  readFileSync: (p, e) => nodeReadFileSync(p, e),
  writeFileSync: (p, d, o) => nodeWriteFileSync(p, d, o),
  unlinkSync: (p) => nodeUnlinkSync(p),
  readdirSync: (p) => nodeReaddirSync(p) as unknown as string[],
  renameSync: (from, to) => nodeRenameSync(from, to),
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Paths + validation + freshness (pure).
// ---------------------------------------------------------------------------

/** Absolute path of the heartbeat directory for a home. */
export function clientsDir(home: string): string {
  return join(home, CLIENTS_DIR_NAME)
}

/** Absolute path of one client's heartbeat file. */
export function heartbeatPath(home: string, clientId: string): string {
  return join(clientsDir(home), `${clientId}.json`)
}

/** Validate a parsed JSON value into a ClientHeartbeat (or null). */
export function validateHeartbeat(raw: unknown): ClientHeartbeat | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id.trim() === '') return null
  if (typeof r.pid !== 'number' || !Number.isInteger(r.pid) || r.pid < 0) return null
  if (typeof r.lastSeen !== 'string' || r.lastSeen.trim() === '') return null
  if (Number.isNaN(Date.parse(r.lastSeen))) return null
  if (typeof r.workspace !== 'string') return null
  return { id: r.id, pid: r.pid, lastSeen: r.lastSeen, workspace: r.workspace }
}

/** True while a heartbeat is within the TTL of `nowMs`. */
export function isFresh(hb: ClientHeartbeat, nowMs: number, ttlMs: number): boolean {
  const seen = Date.parse(hb.lastSeen)
  if (Number.isNaN(seen)) return false
  const age = nowMs - seen
  return age >= 0 && age <= ttlMs
}

/**
 * Resolve the last-one grace window: explicit option > env > default. `0` is a
 * valid value meaning "resident — never auto-close". Negative / non-finite /
 * malformed env values fall back to the default.
 */
export function resolveGraceMs(explicitMs?: number, env?: NodeJS.ProcessEnv): number {
  if (explicitMs !== undefined && Number.isFinite(explicitMs)) return Math.max(0, Math.round(explicitMs))
  const raw = (env ?? process.env)[ENV_IDLE_MS]
  if (raw !== undefined && /^\d+$/.test(raw)) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) return Math.round(parsed)
  }
  return DEFAULT_LAST_ONE_GRACE_MS
}

// ---------------------------------------------------------------------------
// Heartbeat file I/O (register / refresh / unregister / list / purge).
// ---------------------------------------------------------------------------

interface HeartbeatDeps {
  fs?: LifecycleFs
  now?: () => number
}

function writeHeartbeatFile(home: string, hb: ClientHeartbeat, fs: LifecycleFs): void {
  fs.mkdirSync(clientsDir(home), { recursive: true })
  const path = heartbeatPath(home, hb.id)
  const payload = JSON.stringify(hb, null, 2) + '\n'
  // Prefer atomic write; injected fakes may omit renameSync.
  if (fs.renameSync) {
    const tmp = `${path}.tmp-${hb.id}`
    fs.writeFileSync(tmp, payload)
    fs.renameSync(tmp, path)
  } else {
    fs.writeFileSync(path, payload)
  }
}

/** Generate a unique client id (used when the caller does not supply one). */
export function newClientId(): string {
  return `${process.pid}-${randomUUID()}`
}

export interface HeartbeatHandle {
  readonly id: string
  readonly record: ClientHeartbeat
  /** Refresh lastSeen now (also called by the auto-refresh timer). */
  refresh(): ClientHeartbeat
  /** Start the ~3s auto-refresh timer (idempotent; unref'd). */
  start(intervalMs?: number): void
  /** Stop the auto-refresh timer. */
  stop(): void
  /** Delete this client's heartbeat file. Returns true if it existed. */
  remove(): boolean
}

/**
 * Register (or re-register) a client heartbeat and return a handle that can
 * refresh / auto-refresh / remove it. Does NOT start the timer until
 * `start()` is called — callers decide when the client is fully attached.
 */
export function registerHeartbeat(
  home: string,
  info: { id?: string; pid?: number; workspace: string },
  deps: HeartbeatDeps = {},
): HeartbeatHandle {
  const fs = deps.fs ?? nodeLifecycleFs
  const now = deps.now ?? Date.now
  const id = info.id ?? newClientId()
  const pid = info.pid ?? process.pid
  const started: ClientHeartbeat = {
    id,
    pid,
    lastSeen: new Date(now()).toISOString(),
    workspace: info.workspace,
  }
  writeHeartbeatFile(home, started, fs)
  let record = started
  let timer: ReturnType<typeof setInterval> | null = null

  const refresh = (): ClientHeartbeat => {
    record = { ...record, lastSeen: new Date(now()).toISOString() }
    writeHeartbeatFile(home, record, fs)
    return record
  }
  return {
    id,
    get record() {
      return record
    },
    refresh,
    start(intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS) {
      if (timer) return
      timer = setInterval(() => {
        try {
          refresh()
        } catch {
          /* a transient fs error must not crash the client */
        }
      }, intervalMs)
      timer.unref?.()
    },
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
    remove() {
      try {
        if (!fs.existsSync(heartbeatPath(home, id))) return false
        fs.unlinkSync(heartbeatPath(home, id))
        return true
      } catch {
        return false
      }
    },
  }
}

/** Read + validate every heartbeat file in the directory. Never throws. */
export function listHeartbeats(home: string, deps: HeartbeatDeps = {}): ClientHeartbeat[] {
  const fs = deps.fs ?? nodeLifecycleFs
  if (!fs.readdirSync) return []
  let names: string[]
  try {
    names = fs.readdirSync(clientsDir(home))
  } catch {
    return []
  }
  const out: ClientHeartbeat[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const raw = JSON.parse(fs.readFileSync(join(clientsDir(home), name), 'utf8'))
      const hb = validateHeartbeat(raw)
      if (hb) out.push(hb)
    } catch {
      /* skip a half-written / corrupt heartbeat */
    }
  }
  return out
}

/** All heartbeats whose lastSeen is within the TTL of `now()`. */
export function freshClients(
  home: string,
  deps: HeartbeatDeps = {},
  ttlMs: number = DEFAULT_CLIENT_TTL_MS,
): ClientHeartbeat[] {
  const now = deps.now ?? Date.now
  const nowMs = now()
  return listHeartbeats(home, deps).filter((hb) => isFresh(hb, nowMs, ttlMs))
}

/** Delete every heartbeat file (used by a confirmed --force reset). */
export function purgeAllHeartbeats(home: string, deps: HeartbeatDeps = {}): string[] {
  const fs = deps.fs ?? nodeLifecycleFs
  const removed: string[] = []
  for (const hb of listHeartbeats(home, deps)) {
    try {
      fs.unlinkSync(heartbeatPath(home, hb.id))
      removed.push(hb.id)
    } catch {
      /* already gone */
    }
  }
  return removed
}

/** Delete heartbeat files that have aged past the TTL. Returns removed ids. */
export function purgeStaleHeartbeats(
  home: string,
  deps: HeartbeatDeps = {},
  ttlMs: number = DEFAULT_CLIENT_TTL_MS,
): string[] {
  const fs = deps.fs ?? nodeLifecycleFs
  const now = deps.now ?? Date.now
  const nowMs = now()
  const removed: string[] = []
  for (const hb of listHeartbeats(home, deps)) {
    if (isFresh(hb, nowMs, ttlMs)) continue
    try {
      fs.unlinkSync(heartbeatPath(home, hb.id))
      removed.push(hb.id)
    } catch {
      /* already gone */
    }
  }
  return removed
}

// ---------------------------------------------------------------------------
// Last-one-out graceful shutdown.
// ---------------------------------------------------------------------------

export type LastOneAction =
  | 'resident'
  | 'others-alive'
  | 'no-host'
  | 'shutdown'
  | 'evidence-refused'

export interface LastOneResult {
  action: LastOneAction
  /** Fresh client count observed at the decisive re-check. */
  freshCount: number
  /** Signals sent to the host, when a shutdown was attempted. */
  stop?: SafeStopResult
}

export interface LastOneOptions extends HeartbeatDeps {
  profile?: string
  /** Grace override (0 = resident). */
  graceMs?: number
  ttlMs?: number
  sleep?: (ms: number) => Promise<void>
  hooks: ProcessKillHooks
  /** Signal grace tuning (tests keep it tiny). */
  termGraceMs?: number
  killGraceMs?: number
}

/**
 * Run the last-one-out decision AFTER this client removed its own heartbeat:
 * if any other fresh heartbeat exists (now or after the grace window), do
 * nothing; otherwise three-evidence-stop the registry host and clear the
 * registry. A `graceMs` of 0 means "resident" — never auto-close.
 */
export async function lastOneGracefulShutdown(
  home: string,
  options: LastOneOptions,
): Promise<LastOneResult> {
  const profile = options.profile ?? 'opentui'
  const fs = options.fs ?? nodeLifecycleFs
  const read = readRegistry(home, profile, fs as never)
  // No host to shut down → do not wait out a grace window at all.
  if (read.kind !== 'v2' || read.value.pid <= 0) {
    return { action: 'no-host', freshCount: freshClients(home, options, options.ttlMs).length }
  }
  const graceMs = resolveGraceMs(options.graceMs)
  if (graceMs === 0) return { action: 'resident', freshCount: freshClients(home, options, options.ttlMs).length }

  const nowCount = freshClients(home, options, options.ttlMs).length
  if (nowCount > 0) return { action: 'others-alive', freshCount: nowCount }

  const sleep = options.sleep ?? defaultSleep
  await sleep(graceMs)

  const afterCount = freshClients(home, options, options.ttlMs).length
  if (afterCount > 0) return { action: 'others-alive', freshCount: afterCount }

  // Re-read: a concurrent client may have replaced the host during the grace.
  const still = readRegistry(home, profile, fs as never)
  if (still.kind !== 'v2' || still.value.pid !== read.value.pid) return { action: 'no-host', freshCount: 0 }

  const stop = await safeStopHost({
    pid: read.value.pid,
    registryPid: read.value.pid,
    hooks: options.hooks,
    termGraceMs: options.termGraceMs,
    killGraceMs: options.killGraceMs,
    sleep,
    now: options.now,
    pidAlive: options.hooks.pidAlive,
  })
  if (!stop.evidencesOk) return { action: 'evidence-refused', freshCount: 0, stop }

  clearRegistryIfPid(home, profile, still, still.value.pid, fs)
  return { action: 'shutdown', freshCount: 0, stop }
}

/** Unlink the registry only if it still describes `pid` (never clobber a newer host). */
function clearRegistryIfPid(
  home: string,
  profile: string,
  read: RegistryReadResult,
  pid: number,
  fs: LifecycleFs,
): void {
  if (read.kind === 'v2' && read.value.pid === pid) {
    try {
      fs.unlinkSync(registryPath(home, profile))
    } catch {
      /* already gone */
    }
  }
}

// ---------------------------------------------------------------------------
// `--force` guard (decision 7).
// ---------------------------------------------------------------------------

/** Thrown by `assertForceAllowed` when live clients exist but `--yes` is absent. */
export class ForceNeedsYesError extends Error {
  readonly code = 'force-needs-yes'
  constructor(readonly clientCount: number) {
    super(`--force would disconnect ${clientCount} live client(s); re-run with --force --yes to confirm.`)
    this.name = new.target.name
  }
}

/**
 * The launcher-side `--force` gate. If any FRESH heartbeat exists and `yes` is
 * false, refuse with a typed error carrying the client count (the launcher
 * prints "will disconnect N clients"). With `yes`, or with no live clients,
 * force is allowed to reset the host.
 */
export function assertForceAllowed(
  home: string,
  options: HeartbeatDeps & { yes?: boolean; ttlMs?: number },
): { liveClients: number; allowed: boolean } {
  const live = freshClients(home, options, options.ttlMs)
  if (live.length > 0 && !options.yes) throw new ForceNeedsYesError(live.length)
  return { liveClients: live.length, allowed: true }
}

// ---------------------------------------------------------------------------
// All-crash fallback watchdog (pure runner + detached spawn).
// ---------------------------------------------------------------------------

export type WatchdogStopReason = 'reclaimed' | 'host-gone' | 'max-ticks'

export interface WatchdogResult {
  reclaimed: boolean
  reason: WatchdogStopReason
  /** Signals sent when a reclaim happened. */
  stop?: SafeStopResult
}

export interface WatchdogOptions extends HeartbeatDeps {
  profile?: string
  ttlMs?: number
  graceMs?: number
  pollMs?: number
  sleep?: (ms: number) => Promise<void>
  hooks: ProcessKillHooks
  /** Safety bound for tests / runaway loops. Undefined = run until host gone. */
  maxTicks?: number
  termGraceMs?: number
  killGraceMs?: number
  onTick?: (info: { tick: number; freshCount: number; hostPid: number }) => void
}

/**
 * One watchdog run. Polls until the host disappears (self-exit) or until NO
 * fresh client persists across TTL + grace, at which point it
 * three-evidence-stops the host, clears the registry and exits. The watchdog
 * itself is only ever signalled through the same three-evidence hooks; if the
 * registry pid is dead it exits without touching anyone.
 */
export async function runWatchdog(home: string, options: WatchdogOptions): Promise<WatchdogResult> {
  const profile = options.profile ?? 'opentui'
  const graceMs = resolveGraceMs(options.graceMs)
  const pollMs = options.pollMs ?? DEFAULT_WATCHDOG_POLL_MS
  const sleep = options.sleep ?? defaultSleep
  const alive = options.hooks.pidAlive ?? ((pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM'
    }
  })
  const fs = options.fs ?? nodeLifecycleFs

  for (let tick = 0; options.maxTicks === undefined || tick < options.maxTicks; tick++) {
    const read = readRegistry(home, profile, fs as never)
    if (read.kind !== 'v2' || read.value.pid <= 0 || !alive(read.value.pid)) {
      // Host gone: self-exit (also drop a stale record naming a dead pid).
      if (read.kind === 'v2' && !alive(read.value.pid)) {
        try {
          fs.unlinkSync(registryPath(home, profile))
        } catch {
          /* already gone */
        }
      }
      return { reclaimed: false, reason: 'host-gone' }
    }

    const freshCount = freshClients(home, options, options.ttlMs).length
    options.onTick?.({ tick, freshCount, hostPid: read.value.pid })
    if (freshCount > 0) {
      await sleep(pollMs)
      continue
    }

    // No fresh client: wait the grace window, then re-read everything (a
    // client may have attached, or the host may have been replaced).
    await sleep(graceMs)
    const again = readRegistry(home, profile, fs as never)
    if (again.kind !== 'v2' || again.value.pid !== read.value.pid) continue
    if (freshClients(home, options, options.ttlMs).length > 0) continue
    if (!alive(again.value.pid)) continue // re-loop → host-gone self-exit

    const stop = await safeStopHost({
      pid: again.value.pid,
      registryPid: again.value.pid,
      hooks: options.hooks,
      termGraceMs: options.termGraceMs,
      killGraceMs: options.killGraceMs,
      sleep,
      now: options.now,
      pidAlive: alive,
    })
    clearRegistryIfPid(home, profile, again, again.value.pid, fs)
    return { reclaimed: stop.evidencesOk, reason: 'reclaimed', stop }
  }
  return { reclaimed: false, reason: 'max-ticks' }
}

export interface SpawnWatchdogOptions {
  /** Absolute path to the watchdog CLI bundle (dist/watchdog.mjs). */
  scriptPath: string
  profile?: string
  env?: NodeJS.ProcessEnv
  /** Injectable spawn (tests record instead of spawning). */
  spawn?: (
    command: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; detached: boolean; stdio: 'ignore' },
  ) => { pid?: number; unref?(): void }
  command?: string
}

/**
 * Spawn a detached watchdog for `(home, profile)`. The child is marked with
 * the SAME three evidences as the host (`--profile opentui` on its cmdline via
 * argv + `DSH_OPENTUI_SERVER=1` in env), so it is identifiable and is itself
 * subject to decision-8 identification; it self-exits when the host dies.
 */
export function spawnWatchdog(home: string, options: SpawnWatchdogOptions): { pid?: number } {
  const profile = options.profile ?? 'opentui'
  const env: NodeJS.ProcessEnv = {
    ...(options.env ?? process.env),
    [SERVER_ENV_NAME]: SERVER_ENV_VALUE,
    [ENV_WATCHDOG]: '1',
    [ENV_WATCHDOG_HOME]: home,
    [ENV_WATCHDOG_PROFILE]: profile,
  }
  const command = options.command ?? process.execPath
  const child = (options.spawn ?? defaultSpawnWatchdog)(command, [options.scriptPath, '--profile', profile], {
    env,
    detached: true,
    stdio: 'ignore',
  })
  child.unref?.()
  return { pid: child.pid }
}

function defaultSpawnWatchdog(
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; detached: boolean; stdio: 'ignore' },
): { pid?: number; unref?(): void } {
  const child = nodeSpawn(command, args, options)
  child.unref()
  return child
}
