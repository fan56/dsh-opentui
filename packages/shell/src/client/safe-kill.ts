/**
 * Three-evidence safe process stop — the ONE module allowed to signal a host
 * (ADR-0009 decision 8; DESIGN-redesign §6).
 *
 * A process may only be signalled when ALL of these agree:
 *   1. the pid recorded in the v2 registry (`registryPid`) equals the pid we
 *      are about to signal;
 *   2. its `ps` cmdline contains `--profile opentui` AND no other `--profile`;
 *   3. its environment carries `DSH_OPENTUI_SERVER=1`.
 *
 * A bare "dsh" substring match is explicitly forbidden. Every signal goes
 * through {@link ProcessKillHooks.kill}, which is injectable so unit tests
 * never signal a real process. No other module in the T3b path calls
 * `process.kill` on a host pid directly.
 *
 * Default signal sequence for a confirmed host: SIGTERM (let the host flush /
 * persist), wait a grace window, then SIGKILL only if the pid is still alive.
 */

import { spawnSync } from 'node:child_process'

/** Env marking a process as THIS launcher's Host service (ADR-0009 decision 1). */
export const SERVER_ENV_NAME = 'DSH_OPENTUI_SERVER'
export const SERVER_ENV_VALUE = '1'
/** The one product profile whose host may be signalled. */
export const HOST_PROFILE = 'opentui'
/** Default wait after SIGTERM before escalating to SIGKILL. */
export const DEFAULT_TERM_GRACE_MS = 5_000
/** Default wait after SIGKILL to confirm the pid is gone. */
export const DEFAULT_KILL_GRACE_MS = 2_000
/** Poll cadence while waiting for a pid to exit. */
export const DEFAULT_EXIT_POLL_MS = 50

/** The three-evidence process-identification seam, fully injectable. */
export interface ProcessKillHooks {
  /** Full cmdline of `pid`, or null when the process is gone / unreadable. */
  cmdline(pid: number): string | null
  /** True when `pid`'s environment contains `DSH_OPENTUI_SERVER=1`. */
  hasServerEnv(pid: number): boolean
  /** Send a signal to `pid` (no-op on ESRCH is fine). */
  kill(pid: number, signal: NodeJS.Signals): void
  /** Pid liveness probe (defaults to `process.kill(pid, 0)`). */
  pidAlive?(pid: number): boolean
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Default three-evidence hooks via `ps` (portable enough for darwin/linux). */
export const psKillHooks: ProcessKillHooks = {
  cmdline(pid) {
    try {
      return spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout?.trim() || null
    } catch {
      return null
    }
  },
  hasServerEnv(pid) {
    try {
      const out = spawnSync('ps', ['eww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout ?? ''
      return out.includes(`${SERVER_ENV_NAME}=${SERVER_ENV_VALUE}`)
    } catch {
      return false
    }
  },
  kill(pid, signal) {
    try {
      process.kill(pid, signal)
    } catch {
      /* already gone */
    }
  },
}

/**
 * True only when all three ADR-0009 decision-8 evidences agree. This is the
 * sole gate before any host signal. It never falls back to a "dsh" substring
 * or port guess.
 */
export function evidencesAgree(pid: number, registryPid: number, hooks: ProcessKillHooks): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (registryPid !== pid) return false // (1) registry pid
  const cmd = hooks.cmdline(pid)
  if (!cmd) return false
  // (2) --profile opentui and no other profile on the cmdline.
  const profiles = [...cmd.matchAll(/--profile[= ]+([^\s]+)/g)].map((m) => m[1])
  if (profiles.length === 0 || profiles.some((p) => p !== HOST_PROFILE)) return false
  // (3) env marker.
  return hooks.hasServerEnv(pid)
}

export interface SafeStopOptions {
  /** The pid we intend to signal. */
  pid: number
  /** The pid recorded in the registry (evidence 1). */
  registryPid: number
  hooks: ProcessKillHooks
  termGraceMs?: number
  killGraceMs?: number
  sleep?: (ms: number) => Promise<void>
  pidAlive?: (pid: number) => boolean
  /** Injectable clock for wait deadlines (defaults to `Date.now`). */
  now?: () => number
}

export interface SafeStopResult {
  /** Whether any signal was sent (false when evidence failed). */
  attempted: boolean
  /** Whether the three evidences agreed. */
  evidencesOk: boolean
  /** Signals actually sent, in order. */
  signals: NodeJS.Signals[]
  /** Whether the pid was confirmed gone at the end. */
  stopped: boolean
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitGone(
  pid: number,
  budgetMs: number,
  alive: (pid: number) => boolean,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
): Promise<boolean> {
  if (!alive(pid)) return true
  const deadline = now() + budgetMs
  // Bound by BOTH the clock and an iteration cap: an injected clock that does
  // not advance (or a sleep that does not move it) must never spin forever.
  const maxIterations = Math.max(1, Math.ceil(budgetMs / DEFAULT_EXIT_POLL_MS) + 8)
  for (let i = 0; i < maxIterations && now() < deadline; i++) {
    await sleep(DEFAULT_EXIT_POLL_MS)
    if (!alive(pid)) return true
  }
  return !alive(pid)
}

/**
 * Confirm the three evidences, then SIGTERM → grace → SIGKILL a host. When any
 * evidence is missing this is a strict no-op (no signal at all). All I/O is
 * injectable; tests drive it with fake hooks / clock / sleep.
 */
export async function safeStopHost(options: SafeStopOptions): Promise<SafeStopResult> {
  const {
    pid,
    registryPid,
    hooks,
    termGraceMs = DEFAULT_TERM_GRACE_MS,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    sleep = defaultSleep,
    pidAlive = hooks.pidAlive ?? defaultPidAlive,
    now = Date.now,
  } = options

  if (!evidencesAgree(pid, registryPid, hooks)) {
    return { attempted: false, evidencesOk: false, signals: [], stopped: !pidAlive(pid) }
  }

  const signals: NodeJS.Signals[] = []
  hooks.kill(pid, 'SIGTERM')
  signals.push('SIGTERM')
  if (await waitGone(pid, termGraceMs, pidAlive, sleep, now)) {
    return { attempted: true, evidencesOk: true, signals, stopped: true }
  }

  hooks.kill(pid, 'SIGKILL')
  signals.push('SIGKILL')
  const stopped = await waitGone(pid, killGraceMs, pidAlive, sleep, now)
  return { attempted: true, evidencesOk: true, signals, stopped }
}
