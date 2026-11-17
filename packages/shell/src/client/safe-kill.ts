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
 * Evidence 3 is OPTIONAL when the env is genuinely unreadable (DESIGN §6):
 * on some platforms `ps eww` cannot expose a detached process's environment.
 * In that case only the two hard evidences (registry pid + exact
 * `--profile opentui` cmdline) are required, and a fallback log is emitted.
 * A bare "dsh" substring match remains explicitly forbidden in ALL cases.
 * Every signal goes
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
  /**
   * Whether `pid`'s environment can be READ AT ALL (distinct from "readable
   * but lacks the marker"). When this returns false, `evidencesAgree` waives
   * evidence 3 and requires only registry pid + exact cmdline. Hooks that omit
   * it keep the strict three-evidence rule (backward compatible).
   */
  envReadable?(pid: number): boolean
  /** Called once when the two-evidence fallback is used (logging seam). */
  onEnvFallback?(pid: number): void
}

/** Read a pid's process state via `ps -o stat=`; null when ps is unavailable. */
function psStat(pid: number): string | null {
  try {
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' })
    if (result.error || result.status !== 0) return null
    return (result.stdout ?? '').trim() || null
  } catch {
    return null
  }
}

/** True when a `ps -o stat=` row denotes a zombie (Z / Z+ / Z<...>). */
function statIsZombie(stat: string): boolean {
  return stat.startsWith('Z')
}

export function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
  // kill(0) succeeds for a zombie the parent has not reaped yet. Confirm via
  // ps; when ps is unavailable keep the kill(0) verdict (no semantic change).
  const stat = psStat(pid)
  if (stat !== null && statIsZombie(stat)) return false
  return true
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
  envReadable(pid) {
    try {
      const result = spawnSync('ps', ['eww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
      if (result.error || (result.status !== null && result.status !== 0)) return false
      const out = (result.stdout ?? '').trim()
      // A zombie's command degrades to `<defunct>` and carries no readable env.
      if (!out || out.includes('<defunct>')) return false
      const stat = psStat(pid)
      if (stat !== null && statIsZombie(stat)) return false
      // A non-empty `ps eww` row means the env was readable, even if the
      // marker itself is absent (that case must still refuse to signal).
      return true
    } catch {
      return false
    }
  },
  onEnvFallback(pid) {
    console.warn(
      `[safe-kill] ${SERVER_ENV_NAME} env unreadable for pid ${pid}; ` +
        `using registry + cmdline two-evidence fallback (no "dsh" match)`,
    )
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
 * True when the ADR-0009 decision-8 evidences agree. Evidences 1 (registry
 * pid) and 2 (exact `--profile opentui` cmdline, no other profile) are always
 * required. Evidence 3 (the env marker) is waived ONLY when the env is
 * genuinely unreadable (`hooks.envReadable(pid) === false`, e.g. `ps eww` is
 * unavailable) — in that case a fallback log is emitted. When the env is
 * readable but lacks the marker, this still refuses to signal. This is the
 * sole gate before any host signal and never falls back to a "dsh" substring
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
  // (3) env marker — required when readable, optional when unreadable.
  if (hooks.hasServerEnv(pid)) return true
  if (hooks.envReadable && !hooks.envReadable(pid)) {
    hooks.onEnvFallback?.(pid)
    return true
  }
  return false
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
