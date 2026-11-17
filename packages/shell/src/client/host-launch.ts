/**
 * Launcher-side host bootstrap orchestration (ADR-0009 decisions 2–5 & 8;
 * DESIGN-redesign §3 — the launcher startup sequence).
 *
 * This module is the *launcher* half of the singleton host: it resolves the
 * `(home, profile)` scope, derives a deterministic port, reads the v2 registry,
 * attaches to a healthy host on the fast path (no progress), and otherwise
 * atomically claims the registry and spawns ONE host — rendering progress
 * (spawn → booting → ready + elapsed) before the launcher hands the TTY to the
 * bun client. It never changes the host core and adds no argv flag: the host
 * is marked by env `DSH_OPENTUI_SERVER=1` (dsh 0.18.4+ exits 2 on unknown flags).
 *
 * Concurrency: the atomic `link(2)` claim in host-registry guarantees exactly
 * one winner per `(home, profile)`. A loser never spawns; it polls the registry
 * until `phase=ready` (or timeout) and adopts. The 5-minute timeout identifies
 * and kills ONLY this spawn's pid — and only when three evidences agree
 * (registry pid + `--profile opentui` cmdline + `DSH_OPENTUI_SERVER=1` env),
 * with injectable kill hooks so tests never signal a real process.
 *
 * All I/O that reaches the process (spawn, clock, sleep, fs, TCP/HTTP probes,
 * cookie mint, process evidence/kill) is an injectable seam. Unit tests drive
 * the whole state machine with fakes — no real host, socket, or signal.
 */

import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { connect as netConnect, Server, type AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'

// ADR-0009 decisions 6–8 — client heartbeat guard, three-evidence safe stop.
import { assertForceAllowed, purgeAllHeartbeats } from './client-lifecycle.ts'
import { mintOwnerCookie } from './cookie-mint.ts'
import { checkHostHealth, defaultHealthProbes, type HealthCheck } from './host-health.ts'
import { findFreePort } from './host-port.ts'
// ADR-0009 decision 8 — the three-evidence gate and the only sanctioned way to
// signal a host. Re-exported below so existing callers keep their imports.
import {
  psKillHooks,
  safeStopHost,
  SERVER_ENV_NAME,
  SERVER_ENV_VALUE,
  type ProcessKillHooks,
} from './safe-kill.ts'
import {
  claimRegistry,
  isRegistryStale,
  nodeRegistryFs,
  readRegistry,
  registryPath,
  safeClearLegacy,
  withPhase,
  writeRegistry,
  type HostRegistryV2,
  type RegistryFs,
  type RegistryReadResult,
} from './host-registry.ts'

// ---------------------------------------------------------------------------
// Constants + public value types.
// ---------------------------------------------------------------------------

/** The one product profile (ADR-0005 decision 3). */
export const DEFAULT_LAUNCH_PROFILE = 'opentui'
/** Env marker + three-evidence hooks live in `safe-kill.ts`; re-exported for
 *  the callers/tests that imported them from here in T3a. */
export { SERVER_ENV_NAME, SERVER_ENV_VALUE, psKillHooks } from './safe-kill.ts'
export type { ProcessKillHooks } from './safe-kill.ts'
/** 5-minute budget for the whole claim→ready sequence (ADR-0009 decision 5). */
export const DEFAULT_LAUNCH_TIMEOUT_MS = 5 * 60_000
/** Progress / readiness poll cadence (100–200ms per the ADR). */
export const DEFAULT_POLL_MS = 150
/** Max age before a LIVE `claim`/`booting` record is stale (P1-1: never applied
 *  to steady-state `ready`/`stopping`, whose `updatedAt` is not refreshed). */
export const DEFAULT_REGISTRY_MAX_AGE_MS = 60_000
/** SIGTERM → SIGKILL grace for a confirmed `--force --yes` host stop. */
export const FORCE_TERM_GRACE_MS = 2_000
export const FORCE_KILL_GRACE_MS = 1_000

/** Stages rendered in the launcher terminal while WE spawn the host. */
export const LAUNCH_PHASES = ['spawn', 'booting', 'ready'] as const
export type LaunchPhase = (typeof LAUNCH_PHASES)[number]

/** One progress sample emitted by the winner (`elapsedMs` from spawn). */
export interface LaunchProgressEvent {
  phase: LaunchPhase
  elapsedMs: number
}

export interface HostLaunchResult {
  /** The port the host listens on (pinned into the registry). */
  port: number
  /** Whether we started the host (spawn) or joined an existing one (adopt). */
  mode: 'adopted' | 'spawned'
  adopted: boolean
  spawned: boolean
  /** The Host service pid when known. */
  hostPid?: number
}

/** Typed timeout error carrying the diagnostic log path (ADR-0009 decision 5). */
export class HostLaunchTimeoutError extends Error {
  readonly code = 'host-launch-timeout'
  constructor(
    message: string,
    readonly logPath: string,
  ) {
    super(`${message}\n--- dsh host log: ${logPath} ---`)
    this.name = new.target.name
  }
}

// ---------------------------------------------------------------------------
// Injectable seams.
// ---------------------------------------------------------------------------

/** Minimal child handle the orchestrator needs (structurally a ChildProcess). */
export interface SpawnedHost {
  pid: number
  stdout?: { on(event: 'data', listener: (chunk: unknown) => void): unknown }
  stderr?: { on(event: 'data', listener: (chunk: unknown) => void): unknown }
  on?(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown
  on?(event: 'error', listener: (err: Error) => void): unknown
  kill?(signal?: string): boolean
}

export type SpawnHost = (
  argv: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => SpawnedHost

export interface HostLaunchDeps {
  home?: string
  profile?: string
  cwd?: string
  /** Reset the singleton host. Live clients require `yes` too (ADR-0009 §7). */
  force?: boolean
  /** Confirm a force reset when live clients exist (`--force --yes`). */
  yes?: boolean
  /** Filesystem seam for the registry + diagnostic log. */
  fs?: RegistryFs
  /** Clock (`Date.now` equivalent) for timestamps, elapsed and deadlines. */
  now?: () => number
  /** Cancellable sleep seam. */
  sleep?: (ms: number) => Promise<void>
  /** Spawn seam. Default: real `dsh`, detached + unref'd. */
  spawnHost?: SpawnHost
  /** Pid liveness. Default: `process.kill(pid, 0)`. */
  pidAlive?: (pid: number) => boolean
  /** Health gate for attach + readiness. Default: `checkHostHealth` (TCP + GET /). */
  health?: (authority: string, cookieHeader: string) => Promise<HealthCheck>
  /** Cookie mint for the health probe. Default: `mintOwnerCookie` from this home. */
  mintCookie?: (opts: { home: string; authority: string }) => string
  /** Free-port selection. Default: `findFreePort` over the derived window. */
  findPort?: (home: string, profile: string, probe: (port: number) => Promise<boolean>) => Promise<number>
  /** Port-occupancy probe used by the default `findPort`. */
  portProbe?: (port: number) => Promise<boolean>
  /** Progress sink. Absent = silent (headless / attach fast path). */
  progress?: (event: LaunchProgressEvent) => void
  /** Process identification + kill, used only on timeout. */
  killHooks?: ProcessKillHooks
  /** Whole-sequence budget. Default 5 minutes. */
  timeoutMs?: number
  /** Poll cadence. Default 150ms. */
  pollMs?: number
  /** Max age of a live-pid v2 record before it is stale. */
  registryMaxAgeMs?: number
  /** Diagnostic log path for the spawned host's captured output. */
  logPath?: (home: string, profile: string) => string
  /** NODE_OPTIONS-affecting env for the spawned host (tests keep it clean). */
  baseEnv?: NodeJS.ProcessEnv
}

interface ResolvedDeps {
  home: string
  profile: string
  cwd: string
  force: boolean
  yes: boolean
  fs: RegistryFs
  now: () => number
  sleep: (ms: number) => Promise<void>
  spawnHost: SpawnHost
  pidAlive: (pid: number) => boolean
  health: (authority: string, cookieHeader: string) => Promise<HealthCheck>
  mintCookie: (opts: { home: string; authority: string }) => string
  findPort: (home: string, profile: string, probe: (port: number) => Promise<boolean>) => Promise<number>
  portProbe: (port: number) => Promise<boolean>
  progress?: (event: LaunchProgressEvent) => void
  killHooks: ProcessKillHooks
  timeoutMs: number
  pollMs: number
  registryMaxAgeMs: number
  logPath: (home: string, profile: string) => string
  baseEnv: NodeJS.ProcessEnv
}

// ---------------------------------------------------------------------------
// Default seam implementations.
// ---------------------------------------------------------------------------

export function defaultDshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const defaultPortProbe = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    let settled = false
    const socket = netConnect({ host: '127.0.0.1', port })
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(750)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })

/** OpenTUI's host core needs node's `--experimental-ffi`; mirror lifecycle.ts. */
const FFI_FLAG = '--experimental-ffi'

function withFfiFlag(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const existing = env.NODE_OPTIONS ?? ''
  if (existing.split(/\s+/).includes(FFI_FLAG)) return env
  return { ...env, NODE_OPTIONS: `${existing} ${FFI_FLAG}`.trim() }
}

/** Default spawn: detached/unref'd so the host outlives the launcher process. */
export const defaultSpawnHost: SpawnHost = (argv, options) => {
  const env = { ...options.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('npm_config_')) delete env[key]
  }
  const child = spawn('dsh', argv, {
    cwd: options.cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.unref()
  for (const pipe of [child.stdout, child.stderr]) {
    ;(pipe as unknown as { unref?: () => void }).unref?.()
  }
  return child as unknown as SpawnedHost
}

const defaultHealth = (authority: string, cookieHeader: string): Promise<HealthCheck> =>
  checkHostHealth({ authority, cookieHeader }, defaultHealthProbes)

function resolveDeps(d: HostLaunchDeps): ResolvedDeps {
  const home = d.home ?? defaultDshHome()
  const profile = d.profile ?? DEFAULT_LAUNCH_PROFILE
  return {
    home,
    profile,
    cwd: d.cwd ?? process.cwd(),
    force: d.force ?? false,
    yes: d.yes ?? false,
    fs: d.fs ?? nodeRegistryFs,
    now: d.now ?? Date.now,
    sleep: d.sleep ?? defaultSleep,
    spawnHost: d.spawnHost ?? defaultSpawnHost,
    pidAlive: d.pidAlive ?? defaultPidAlive,
    health: d.health ?? defaultHealth,
    mintCookie: d.mintCookie ?? mintOwnerCookie,
    findPort: d.findPort ?? ((home, profile, probe) => findFreePort(home, profile, { probe })),
    portProbe: d.portProbe ?? defaultPortProbe,
    ...(d.progress ? { progress: d.progress } : {}),
    killHooks: d.killHooks ?? psKillHooks,
    timeoutMs: d.timeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS,
    pollMs: d.pollMs ?? DEFAULT_POLL_MS,
    registryMaxAgeMs: d.registryMaxAgeMs ?? DEFAULT_REGISTRY_MAX_AGE_MS,
    logPath: d.logPath ?? ((h, p) => join(h, `opentui-host.${p}.log`)),
    baseEnv: d.baseEnv ?? process.env,
  }
}

// ---------------------------------------------------------------------------
// Progress rendering (TTY overwrite vs non-TTY one line per phase).
// ---------------------------------------------------------------------------

export interface ProgressRendererOptions {
  isTty: boolean
  write: (text: string) => void
}

/**
 * Build the progress sink the launcher passes as `deps.progress`.
 * - TTY: redraw one line (`\r` + clear) on every sample, terminated by a
 *   newline at `ready` so the client's alternate screen starts on a fresh line.
 * - non-TTY: emit one line per PHASE CHANGE only (no 150ms spam).
 */
export function createLaunchProgress(options: ProgressRendererOptions): (event: LaunchProgressEvent) => void {
  const { isTty, write } = options
  let lastPhase: LaunchPhase | null = null
  return (event) => {
    const seconds = (event.elapsedMs / 1000).toFixed(1)
    const line = `dsh-opentui: host ${event.phase}  ${seconds}s`
    if (isTty) {
      write(`\r\u001b[2K${line}`)
      if (event.phase === 'ready') write('\n')
      return
    }
    if (event.phase === lastPhase) return
    lastPhase = event.phase
    write(`${line}\n`)
  }
}

// ---------------------------------------------------------------------------
// Helpers: registry hygiene, evidence, log capture.
// ---------------------------------------------------------------------------

/** Remove a v2 record only if it still matches the pid/token we judged stale. */
function removeStaleRecord(home: string, profile: string, stale: HostRegistryV2, o: ResolvedDeps): void {
  const current = readRegistry(home, profile, o.fs)
  if (current.kind === 'v2' && current.value.pid === stale.pid && current.value.startedAt === stale.startedAt) {
    try {
      o.fs.unlinkSync(registryPath(home, profile))
    } catch {
      /* already gone */
    }
  }
}

/** Remove an invalid file (unparseable / unsupported) so a fresh claim can start. */
function removeInvalidRecord(home: string, profile: string, o: ResolvedDeps): void {
  try {
    o.fs.unlinkSync(registryPath(home, profile))
  } catch {
    /* already gone */
  }
}

/** Attach output listeners that accumulate a bounded tail for the log/timeout. */
function captureOutput(child: SpawnedHost, tail: { text: string }): void {
  const push = (chunk: unknown) => {
    tail.text = (tail.text + String(chunk)).slice(-8_000)
  }
  child.stdout?.on('data', push)
  child.stderr?.on('data', push)
}

function flushLog(o: ResolvedDeps, tail: { text: string }): string {
  const path = o.logPath(o.home, o.profile)
  try {
    o.fs.mkdirSync(dirname(path), { recursive: true })
    o.fs.writeFileSync(path, `[dsh-opentui] host output tail\n${tail.text}\n`)
  } catch {
    /* logging must never mask the real timeout error */
  }
  return path
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Ensure a single healthy host for `(home, profile)` and return the port to
 * attach to. See the file header for the state machine. Emits progress ONLY
 * when this call spawns the host; the attach fast path and the adopt-wait path
 * are silent. `force` is accepted here in T3a (skips the attach fast path);
 * its full stop/restart semantics land in T3b.
 */
export async function ensureHost(deps: HostLaunchDeps = {}): Promise<HostLaunchResult> {
  const o = resolveDeps(deps)

  // 0. `--force` reset (ADR-0009 decision 7). Refuse when live clients exist
  //    without `--yes`; otherwise three-evidence-stop the registry host and
  //    clear its registry + client heartbeats before the normal boot sequence.
  if (o.force) {
    const hbDeps = { fs: o.fs, now: o.now }
    assertForceAllowed(o.home, { ...hbDeps, yes: o.yes })
    const current = readRegistry(o.home, o.profile, o.fs)
    // A live legacy record is ALSO a host that must be stopped before its sole
    // record is removed (P1-4 hands it to --force / manual intervention).
    const forcePid =
      current.kind === 'v2' ? current.value.pid : current.kind === 'legacy' ? current.raw.pid : 0
    if (forcePid > 0) {
      const stop = await safeStopHost({
        pid: forcePid,
        registryPid: forcePid,
        hooks: o.killHooks,
        termGraceMs: FORCE_TERM_GRACE_MS,
        killGraceMs: FORCE_KILL_GRACE_MS,
        sleep: o.sleep,
        now: o.now,
        pidAlive: o.pidAlive,
      })
      // P0-2: only unlink after the old host is CONFIRMED stopped. Otherwise
      // clearing the record turns it into an untrackable live orphan.
      if (!stop.stopped) {
        throw new Error(
          `dsh-opentui: --force could not confirm the old host pid ${forcePid} is stopped ` +
            `(evidences ${stop.evidencesOk ? 'matched but pid survived' : 'refused'}); ` +
            `registry left intact — retry --force or stop it manually.`,
        )
      }
      try {
        o.fs.unlinkSync(registryPath(o.home, o.profile))
      } catch {
        /* already gone */
      }
    }
    purgeAllHeartbeats(o.home, hbDeps)
  }

  // The launch budget covers the claim → ready sequence only, not the force
  // teardown that preceded it.
  const startedAt = o.now()
  const deadline = startedAt + o.timeoutMs
  const emit = (phase: LaunchPhase) => o.progress?.({ phase, elapsedMs: o.now() - startedAt })

  // 1. Read + classify the registry (attach fast path first).
  let read = readRegistry(o.home, o.profile, o.fs)
  if (read.kind === 'v2' && !o.force) {
    const reg = read.value
    const authority = reg.authority || `127.0.0.1:${reg.port}`
    if (reg.phase === 'ready' && reg.port > 0 && o.pidAlive(reg.pid)) {
      const cookie = o.mintCookie({ home: o.home, authority })
      if ((await o.health(authority, cookie)).healthy) {
        return { port: reg.port, mode: 'adopted', adopted: true, spawned: false, hostPid: reg.pid }
      }
      // A live pid whose cookie/port no longer answers is not attachable —
      // fall through to the stale/claim path (never signal the foreign pid).
    }
  }

  // 2. Cleanup stale / legacy / invalid state before claiming. A bounded loop
  //    prevents a racing writer from spinning us forever; a leftover file just
  //    makes the atomic claim below lose (→ adopt-wait), never double-spawn.
  for (let attempt = 0; attempt < 4; attempt++) {
    read = readRegistry(o.home, o.profile, o.fs)
    if (read.kind === 'missing') break
    if (read.kind === 'legacy') {
      // P1-4: safeClearLegacy keeps the record when the old pid is still alive.
      const cleared = safeClearLegacy(o.home, o.profile, { fs: o.fs, read, pidAlive: o.pidAlive })
      if (!cleared.removed) {
        throw new Error(
          `dsh-opentui: legacy host pid ${read.raw.pid} is still alive; ` +
            `its registry record is kept — stop it manually or use --force --yes.`,
        )
      }
      continue
    }
    if (read.kind === 'invalid') {
      removeInvalidRecord(o.home, o.profile, o)
      continue
    }
    const verdict = isRegistryStale(read, {
      now: o.now,
      pidAlive: o.pidAlive,
      registryMaxAgeMs: o.registryMaxAgeMs,
    })
    if (verdict.stale) {
      removeStaleRecord(o.home, o.profile, read.value, o)
      continue
    }
    // Fresh v2 we could not attach to: an unhealthy `ready` host is first
    // three-evidence-STOPPED, then its record is dropped so a fresh claim can
    // reboot it (P0-2: never just abandon the record — that leaks a live host).
    // If the stop cannot be confirmed, keep the record and fail loudly instead
    // of silently orphaning the old host. A `claim`/`booting` record is LEFT
    // INTACT — another launcher owns it and our claim below must lose (adopt-wait).
    if (read.value.phase === 'ready' && read.value.pid > 0) {
      const stop = await safeStopHost({
        pid: read.value.pid,
        registryPid: read.value.pid,
        hooks: o.killHooks,
        termGraceMs: FORCE_TERM_GRACE_MS,
        killGraceMs: FORCE_KILL_GRACE_MS,
        sleep: o.sleep,
        now: o.now,
        pidAlive: o.pidAlive,
      })
      if (!stop.stopped) {
        throw new Error(
          `dsh-opentui: unhealthy host pid ${read.value.pid} could not be stopped ` +
            `(evidences ${stop.evidencesOk ? 'matched but pid survived' : 'refused'}); ` +
            `registry record kept — retry or stop it manually.`,
        )
      }
      removeStaleRecord(o.home, o.profile, read.value, o)
    }
    break
  }

  // 3. Atomic claim — exactly one winner per (home, profile).
  const claim = claimRegistry(o.home, o.profile, { fs: o.fs, now: o.now, pid: process.pid })
  if (!claim.ok) {
    // 3b. Loser: poll to ready or timeout, then adopt. NEVER spawn.
    while (o.now() < deadline) {
      const current = readRegistry(o.home, o.profile, o.fs)
      if (current.kind === 'v2' && current.value.phase === 'ready' && current.value.port > 0) {
        return {
          port: current.value.port,
          mode: 'adopted',
          adopted: true,
          spawned: false,
          hostPid: current.value.pid,
        }
      }
      await o.sleep(o.pollMs)
    }
    throw new HostLaunchTimeoutError(
      `timed out waiting for the host claimed by another launcher (${o.timeoutMs}ms)`,
      o.logPath(o.home, o.profile),
    )
  }

  // 4. Winner: choose a port, write booting, spawn the host with the env marker.
  const port = await o.findPort(o.home, o.profile, o.portProbe)
  const booting: HostRegistryV2 = {
    ...claim.registry,
    pid: 0, // replaced with the child pid the moment it spawns
    port,
    phase: 'booting',
    authority: `127.0.0.1:${port}`,
    updatedAt: new Date(o.now()).toISOString(),
  }
  const env: NodeJS.ProcessEnv = withFfiFlag({
    ...o.baseEnv,
    [SERVER_ENV_NAME]: SERVER_ENV_VALUE,
    DSH_HOME: o.home,
  })
  const child = o.spawnHost(['--profile', o.profile, '--no-open', '--port', String(port)], {
    cwd: o.cwd,
    env,
  })
  writeRegistry(o.home, o.profile, { ...booting, pid: child.pid }, o.fs)
  const bootingRecord: HostRegistryV2 = { ...booting, pid: child.pid }
  emit('spawn')
  const tail = { text: '' }
  captureOutput(child, tail)

  // 5. Poll readiness (registry phase stays `booting`; health = TCP + GET /)
  //    while rendering progress. Only the winner renders.
  const authority = `127.0.0.1:${port}`
  const cookie = o.mintCookie({ home: o.home, authority })
  let ready = false
  let died = false
  child.on?.('exit', () => {
    died = true
  })
  while (o.now() < deadline) {
    if (died || !o.pidAlive(child.pid)) break
    if ((await o.health(authority, cookie)).healthy) {
      ready = true
      break
    }
    emit('booting')
    await o.sleep(o.pollMs)
  }

  if (ready) {
    writeRegistry(o.home, o.profile, withPhase(bootingRecord, 'ready', new Date(o.now()).toISOString()), o.fs)
    emit('ready')
    return { port, mode: 'spawned', adopted: false, spawned: true, hostPid: child.pid }
  }

  // 6. Timeout / death: verify three evidences against the registry's CURRENT
  //    pid, then use the SAME SIGTERM → grace → SIGKILL sequence as
  //    safeStopHost (P2-1) to give the host a chance to flush. Clear the
  //    registry only for our own spawn and surface the log path.
  const log = flushLog(o, tail)
  const current = readRegistry(o.home, o.profile, o.fs)
  const registryPid = current.kind === 'v2' ? current.value.pid : -1
  await safeStopHost({
    pid: child.pid,
    registryPid,
    hooks: o.killHooks,
    termGraceMs: FORCE_TERM_GRACE_MS,
    killGraceMs: FORCE_KILL_GRACE_MS,
    sleep: o.sleep,
    now: o.now,
    pidAlive: o.pidAlive,
  })
  if (current.kind === 'v2' && current.value.pid === child.pid) {
    try {
      o.fs.unlinkSync(registryPath(o.home, o.profile))
    } catch {
      /* already gone */
    }
  }
  throw new HostLaunchTimeoutError(
    `host did not become ready within ${o.timeoutMs}ms (port ${port}, pid ${child.pid})`,
    log,
  )
}

/** Bind-probe a free loopback port (handy for tests / callers that need one). */
export function bindFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = new Server((socket) => socket.destroy())
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      server.close(() => resolve(port))
    })
  })
}

// Re-export so callers can read a validated registry without reaching into the
// sibling module directly, plus the typed `--force` refusal the launcher gates on.
export { readRegistry, type HostRegistryV2, type RegistryReadResult }
export { ForceNeedsYesError } from './client-lifecycle.ts'
