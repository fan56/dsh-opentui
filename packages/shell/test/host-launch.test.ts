// Launcher-side host bootstrap orchestration (ADR-0009 §3).
// Every I/O seam is faked: no real host, socket, signal, profile or HOME.
import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_LAUNCH_PROFILE,
  HostLaunchTimeoutError,
  createLaunchProgress,
  ensureHost,
  type HostLaunchDeps,
  type LaunchProgressEvent,
  type ProcessKillHooks,
  type RegistryFs,
  type SpawnedHost,
} from '../src/client/host-launch.ts'
import { readRegistry, registryPath, writeRegistry, type HostRegistryV2 } from '../src/client/host-registry.ts'

const HOME = '/virtual/home'
const PORT = 60_123
const CHILD_PID = 4242
const NOW = Date.parse('2026-11-17T00:00:00.000Z')

/** In-memory fs with link(2) semantics (mirrors host-registry.test.ts). */
function makeFs(): { fs: RegistryFs; files: Map<string, string> } {
  const files = new Map<string, string>()
  const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })
  const fs: RegistryFs = {
    existsSync: (p) => files.has(p),
    mkdirSync: () => {},
    readFileSync: (p) => {
      const v = files.get(p)
      if (v === undefined) throw errno('ENOENT')
      return v
    },
    writeFileSync: (p, data) => files.set(p, data),
    renameSync: (from, to) => {
      const v = files.get(from)
      if (v === undefined) throw errno('ENOENT')
      files.set(to, v)
      files.delete(from)
    },
    linkSync: (from, to) => {
      if (files.has(to)) throw errno('EEXIST')
      const v = files.get(from)
      if (v === undefined) throw errno('ENOENT')
      files.set(to, v)
    },
    unlinkSync: (p) => files.delete(p),
  }
  return { fs, files }
}

function makeRecord(overrides: Partial<HostRegistryV2> = {}): HostRegistryV2 {
  return {
    version: 2,
    profile: DEFAULT_LAUNCH_PROFILE,
    home: HOME,
    pid: 9999,
    port: PORT,
    phase: 'ready',
    startedAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    authority: `127.0.0.1:${PORT}`,
    clients: [],
    ...overrides,
  }
}

interface SpawnCall {
  argv: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

function makeChild(pid = CHILD_PID): SpawnedHost & { exited: boolean; fireExit(): void } {
  const obj = {
    pid,
    exited: false,
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    on: (_event: string, listener: (...args: unknown[]) => void) => {
      if (_event === 'exit') obj.fireExit = () => { obj.exited = true; listener(1, null) }
    },
    kill: () => true,
    fireExit: () => {},
  }
  return obj as unknown as SpawnedHost & { exited: boolean; fireExit(): void }
}

function makeKill(
  opts: {
    cmd?: string | null
    env?: boolean
    killed?: string[]
    /** Simulate `ps eww` being unable to read the env (P1-3 fallback). */
    envReadable?: boolean
    onEnvFallback?: (pid: number) => void
  } = {},
): {
  hooks: ProcessKillHooks
  killed: string[]
} {
  const killed = opts.killed ?? []
  return {
    killed,
    hooks: {
      cmdline: () => (opts.cmd === undefined ? `--profile opentui --no-open --port ${PORT}` : opts.cmd),
      hasServerEnv: () => opts.env ?? true,
      kill: (pid, signal) => killed.push(`${pid}:${signal}`),
      ...(opts.envReadable !== undefined ? { envReadable: () => opts.envReadable! } : {}),
      ...(opts.onEnvFallback ? { onEnvFallback: opts.onEnvFallback } : {}),
    },
  }
}

/** A harness with all seams faked and a controllable clock. */
function harness(opts: {
  initial?: HostRegistryV2 | HostRegistryV2['phase'] | 'missing' | 'legacy' | 'invalid'
  healthy?: (authority: string, cookie: string) => boolean | Promise<boolean>
  alive?: (pid: number) => boolean
  kill?: ReturnType<typeof makeKill>
  onSleep?: (n: number) => void
  timeoutMs?: number
  pollMs?: number
  force?: boolean
  progress?: (e: LaunchProgressEvent) => void
  spawn?: (call: SpawnCall) => SpawnedHost
} = {}) {
  const { fs, files } = makeFs()
  const path = registryPath(HOME, DEFAULT_LAUNCH_PROFILE)
  if (opts.initial === 'legacy' || opts.initial === 'invalid') {
    files.set(path, opts.initial === 'legacy' ? JSON.stringify({ pid: 111, port: PORT }) : '{bad json')
  } else if (opts.initial && opts.initial !== 'missing') {
    writeRegistry(HOME, DEFAULT_LAUNCH_PROFILE, makeRecord(
      typeof opts.initial === 'string' ? { phase: opts.initial } : opts.initial,
    ), fs)
  }

  let clock = NOW
  let sleepCount = 0
  const spawnCalls: SpawnCall[] = []
  const child = makeChild()
  const kill = opts.kill ?? makeKill()
  const healthCalls: { authority: string; cookie: string }[] = []
  const deps: HostLaunchDeps = {
    home: HOME,
    profile: DEFAULT_LAUNCH_PROFILE,
    cwd: '/workspace',
    fs,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
      sleepCount += 1
      opts.onSleep?.(sleepCount)
    },
    spawnHost: (argv, o) => {
      spawnCalls.push({ argv, cwd: o.cwd, env: o.env })
      return opts.spawn?.(spawnCalls[spawnCalls.length - 1]!) ?? child
    },
    pidAlive: opts.alive ?? (() => true),
    health: async (authority, cookie) => {
      healthCalls.push({ authority, cookie })
      const ok = opts.healthy?.(authority, cookie) ?? false
      return { healthy: ok, tcp: ok, httpStatus: ok ? 200 : null, reason: ok ? 'ok' : 'tcp-failed' }
    },
    mintCookie: ({ authority }) => `cookie-for-${authority}`,
    findPort: async () => PORT,
    killHooks: kill.hooks,
    timeoutMs: opts.timeoutMs ?? 2_000,
    pollMs: opts.pollMs ?? 100,
    logPath: (h, p) => `${h}/logs/${p}.log`,
    baseEnv: {},
    ...(opts.force ? { force: true } : {}),
    ...(opts.progress ? { progress: opts.progress } : {}),
  }
  return { deps, fs, files, path, spawnCalls, healthCalls, child, kill, read: () => readRegistry(HOME, DEFAULT_LAUNCH_PROFILE, fs) }
}

describe('ensureHost — attach fast path', () => {
  test('a healthy ready registry is adopted with no spawn and no progress', async () => {
    const events: LaunchProgressEvent[] = []
    const h = harness({ initial: 'ready', healthy: () => true, progress: (e) => events.push(e) })
    const result = await ensureHost(h.deps)
    expect(result).toEqual({ port: PORT, mode: 'adopted', adopted: true, spawned: false, hostPid: 9999 })
    expect(h.spawnCalls).toHaveLength(0)
    expect(events).toHaveLength(0) // no progress on the fast path
    expect(h.healthCalls).toHaveLength(1)
    expect(h.healthCalls[0]!.cookie).toBe('cookie-for-127.0.0.1:60123')
  })

  test('an unhealthy ready host is not adopted — it is cleared and re-spawned', async () => {
    // First probe (attach) fails → fall through; the old host is stopped, then
    // the readiness probe for the respawn succeeds.
    let n = 0
    const kill = makeKill()
    const h = harness({
      initial: 'ready',
      healthy: () => ++n > 1,
      kill,
      // the old ready host (9999) dies on SIGTERM; the new child stays alive
      alive: (pid) => pid === CHILD_PID || !kill.killed.some((k) => k.startsWith(`${pid}:SIGTERM`)),
    })
    const result = await ensureHost(h.deps)
    expect(result.spawned).toBe(true)
    expect(h.spawnCalls).toHaveLength(1)
    expect(h.healthCalls.length).toBe(2)
  })

  test('a >60s-old ready host is NOT discarded by the age limit — it is stopped before reboot (P1-1)', async () => {
    // updatedAt is 3 minutes old; the 60s max-age must NOT apply to `ready`.
    let n = 0
    const kill = makeKill()
    const h = harness({
      initial: makeRecord({ phase: 'ready', updatedAt: new Date(NOW - 180_000).toISOString() }),
      healthy: () => ++n > 1,
      kill,
      alive: (pid) => pid === CHILD_PID || !kill.killed.some((k) => k.startsWith(`${pid}:SIGTERM`)),
    })
    const result = await ensureHost(h.deps)
    expect(result.spawned).toBe(true)
    // The live old host was actually three-evidence-stopped, not just "abandoned".
    expect(kill.killed).toContain('9999:SIGTERM')
  })
})

describe('ensureHost — winner spawn path', () => {
  test('missing registry → boot → ready, with correct argv/env and progress', async () => {
    const events: LaunchProgressEvent[] = []
    let healthN = 0
    const h = harness({
      initial: 'missing',
      healthy: () => ++healthN >= 3, // two booting samples, then ready
      progress: (e) => events.push(e),
    })
    const result = await ensureHost(h.deps)
    expect(result).toEqual({ port: PORT, mode: 'spawned', adopted: false, spawned: true, hostPid: CHILD_PID })

    const call = h.spawnCalls[0]!
    expect(call.argv).toEqual(['--profile', 'opentui', '--no-open', '--port', String(PORT)])
    expect(call.env.DSH_OPENTUI_SERVER).toBe('1')
    expect(call.cwd).toBe('/workspace')
    // progress: spawn → booting → booting → ready
    expect(events.map((e) => e.phase)).toEqual(['spawn', 'booting', 'booting', 'ready'])
    expect(events.at(-1)!.elapsedMs).toBeGreaterThanOrEqual(events[0]!.elapsedMs)

    const reg = h.read()
    expect(reg.kind).toBe('v2')
    if (reg.kind === 'v2') {
      expect(reg.value.phase).toBe('ready')
      expect(reg.value.pid).toBe(CHILD_PID)
      expect(reg.value.port).toBe(PORT)
    }
  })

  test('a legacy registry file is cleared (file only) before spawning', async () => {
    // the legacy host pid 111 is dead → safeClearLegacy may remove the record
    const h = harness({ initial: 'legacy', healthy: () => true, alive: (pid) => pid !== 111 })
    const result = await ensureHost(h.deps)
    expect(result.spawned).toBe(true)
    const reg = h.read()
    expect(reg.kind).toBe('v2')
  })

  test('an invalid registry file is cleared before spawning', async () => {
    const h = harness({ initial: 'invalid', healthy: () => true })
    const result = await ensureHost(h.deps)
    expect(result.spawned).toBe(true)
  })

  test('a LIVE legacy host keeps its only record — no orphan, fails loudly (P1-4)', async () => {
    const h = harness({ initial: 'legacy', healthy: () => true, alive: () => true })
    await expect(ensureHost(h.deps)).rejects.toThrow(/legacy host pid 111 is still alive/)
    expect(h.read().kind).toBe('legacy')
    expect(h.spawnCalls).toHaveLength(0)
  })
})

describe('ensureHost — loser adopt path (never double-start)', () => {
  test('a live booting claim is waited out; the loser adopts ready and never spawns', async () => {
    const { fs, files } = makeFs()
    const path = registryPath(HOME, DEFAULT_LAUNCH_PROFILE)
    // A fresh `claim`/`booting` record owned by another live launcher.
    writeRegistry(HOME, DEFAULT_LAUNCH_PROFILE, makeRecord({ phase: 'booting', pid: 8888, startedAt: new Date(NOW).toISOString() }), fs)
    let clock = NOW
    const events: LaunchProgressEvent[] = []
    const result = await ensureHost({
      home: HOME,
      fs,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
        // The winner flips its record to ready between our polls.
        writeRegistry(HOME, DEFAULT_LAUNCH_PROFILE, makeRecord({ phase: 'ready', pid: 8888, startedAt: new Date(NOW).toISOString() }), fs)
      },
      spawnHost: () => { throw new Error('loser must never spawn') },
      pidAlive: () => true,
      progress: (e) => events.push(e),
      timeoutMs: 2_000,
      pollMs: 100,
      findPort: async () => PORT,
      killHooks: makeKill().hooks,
      baseEnv: {},
    })
    expect(result).toEqual({ port: PORT, mode: 'adopted', adopted: true, spawned: false, hostPid: 8888 })
    expect(events).toHaveLength(0) // adopt-wait renders no progress
    expect(files.has(path)).toBe(true)
  })
})

describe('ensureHost — timeout & three-evidence kill', () => {
  test('kills only our pid (all three evidences agree), clears registry, reports log path', async () => {
    const kill = makeKill()
    const h = harness({ initial: 'missing', healthy: () => false, timeoutMs: 500, pollMs: 100, kill })
    let err: unknown
    try {
      await ensureHost(h.deps)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(HostLaunchTimeoutError)
    expect((err as HostLaunchTimeoutError).message).toContain(`${HOME}/logs/opentui.log`)
    expect(kill.killed).toContain(`${CHILD_PID}:SIGTERM`)
    // registry cleared
    expect(h.read().kind).toBe('missing')
  })

  test('cmdline WITHOUT --profile opentui → no kill', async () => {
    const kill = makeKill({ cmd: '--profile web --no-open' })
    const h = harness({ initial: 'missing', healthy: () => false, timeoutMs: 300, pollMs: 100, kill })
    await expect(ensureHost(h.deps)).rejects.toBeInstanceOf(HostLaunchTimeoutError)
    expect(kill.killed).toHaveLength(0)
  })

  test('a second/foreign profile on the cmdline → no kill', async () => {
    const kill = makeKill({ cmd: '--profile opentui --profile tui' })
    const h = harness({ initial: 'missing', healthy: () => false, timeoutMs: 300, pollMs: 100, kill })
    await expect(ensureHost(h.deps)).rejects.toBeInstanceOf(HostLaunchTimeoutError)
    expect(kill.killed).toHaveLength(0)
  })

  test('missing DSH_OPENTUI_SERVER env evidence → no kill', async () => {
    const kill = makeKill({ env: false })
    const h = harness({ initial: 'missing', healthy: () => false, timeoutMs: 300, pollMs: 100, kill })
    await expect(ensureHost(h.deps)).rejects.toBeInstanceOf(HostLaunchTimeoutError)
    expect(kill.killed).toHaveLength(0)
  })

  test('dead child short-circuits to the timeout error (no hung wait)', async () => {
    const kill = makeKill()
    const h = harness({ initial: 'missing', healthy: () => false, timeoutMs: 5_000, pollMs: 100, kill })
    h.child.fireExit()
    const started = Date.now()
    await expect(ensureHost(h.deps)).rejects.toBeInstanceOf(HostLaunchTimeoutError)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  test('env unreadable → registry + cmdline two-evidence stop on timeout (P1-3)', async () => {
    const fallbacks: number[] = []
    const kill = makeKill({ env: false, envReadable: false, onEnvFallback: (pid) => fallbacks.push(pid) })
    const h = harness({ initial: 'missing', healthy: () => false, timeoutMs: 300, pollMs: 100, kill })
    await expect(ensureHost(h.deps)).rejects.toBeInstanceOf(HostLaunchTimeoutError)
    expect(fallbacks).toContain(CHILD_PID)
    expect(kill.killed).toContain(`${CHILD_PID}:SIGTERM`)
  })

  test('timeout teardown uses SIGTERM → grace → SIGKILL, not an instant SIGKILL (P2-1)', async () => {
    const kill = makeKill()
    const h = harness({ initial: 'missing', healthy: () => false, timeoutMs: 300, pollMs: 100, kill })
    await expect(ensureHost(h.deps)).rejects.toBeInstanceOf(HostLaunchTimeoutError)
    expect(kill.killed[0]).toBe(`${CHILD_PID}:SIGTERM`)
    expect(kill.killed).toContain(`${CHILD_PID}:SIGKILL`)
  })
})

describe('ensureHost — evidence refusal never orphans a host (P0-2)', () => {
  test('--force with evidence refused → throws, registry kept, no reset', async () => {
    const kill = makeKill({ env: false }) // strict refusal (no envReadable fallback hook)
    const h = harness({ initial: 'ready', force: true, healthy: () => true, kill })
    await expect(ensureHost(h.deps)).rejects.toThrow(/could not confirm the old host pid .* is stopped/)
    expect(h.read().kind).toBe('v2')
    expect(h.spawnCalls).toHaveLength(0)
    expect(kill.killed).toHaveLength(0)
  })

  test('unhealthy ready host with evidence refused → throws, record kept, no re-spawn', async () => {
    const kill = makeKill({ env: false })
    const h = harness({ initial: 'ready', healthy: () => false, kill })
    await expect(ensureHost(h.deps)).rejects.toThrow(/unhealthy host pid .* could not be stopped/)
    expect(h.read().kind).toBe('v2')
    expect(h.spawnCalls).toHaveLength(0)
    expect(kill.killed).toHaveLength(0)
  })

  test('--force on a LIVE legacy host with evidence refused keeps the record', async () => {
    const kill = makeKill({ env: false })
    const h = harness({ initial: 'legacy', force: true, healthy: () => true, kill })
    await expect(ensureHost(h.deps)).rejects.toThrow(/could not confirm the old host pid .* is stopped/)
    expect(h.read().kind).toBe('legacy')
    expect(kill.killed).toHaveLength(0)
  })

  test('--force with a zombie old pid (pidAlive false) confirms the stop, resets registry, no "pid survived" throw', async () => {
    // A zombie still answers kill(pid,0), but the zombie-aware defaultPidAlive
    // reports dead. Whichever evidence branch is taken (two-evidence fallback
    // when the zombie's env is unreadable, or strict three-evidence refusal),
    // the force pre-launch path must treat pidAlive=false as a confirmed stop.
    for (const kill of [
      makeKill({ env: false, envReadable: false }), // two-evidence fallback agrees
      makeKill({ env: false }),                      // strict three-evidence refused
    ]) {
      const h = harness({
        initial: 'ready',
        force: true,
        healthy: () => true,
        kill,
        // old registry pid is a zombie (judged dead); the fresh child is live
        alive: (pid) => pid === CHILD_PID,
      })
      const result = await ensureHost(h.deps) // must NOT throw "evidences ... pid survived"
      expect(result.spawned).toBe(true)
      // The old record was unlinked and a fresh one rewritten with the new pid.
      const reg = h.read()
      expect(reg.kind).toBe('v2')
      if (reg.kind === 'v2') expect(reg.value.pid).toBe(CHILD_PID)
      expect(h.spawnCalls).toHaveLength(1)
    }
  })
})

describe('ensureHost — force (T3a: skips attach only)', () => {
  test('force bypasses the healthy attach fast path and re-spawns', async () => {
    const kill = makeKill()
    const h = harness({
      initial: 'ready',
      healthy: () => true,
      force: true,
      kill,
      // the forced old host dies on SIGTERM; the new child stays alive
      alive: (pid) => pid === CHILD_PID || !kill.killed.some((k) => k.startsWith(`${pid}:SIGTERM`)),
    })
    const result = await ensureHost(h.deps)
    expect(result.spawned).toBe(true)
    // Attach fast path skipped: only the post-spawn readiness probe runs.
    expect(h.healthCalls.length).toBe(1)
    expect(h.spawnCalls).toHaveLength(1)
  })
})

describe('createLaunchProgress', () => {
  test('TTY: redraws one line with \\r + clear; newline only at ready', () => {
    const out: string[] = []
    const emit = createLaunchProgress({ isTty: true, write: (s) => out.push(s) })
    emit({ phase: 'spawn', elapsedMs: 0 })
    emit({ phase: 'booting', elapsedMs: 150 })
    emit({ phase: 'ready', elapsedMs: 320 })
    expect(out[0]).toBe('\r\u001b[2Kdsh-opentui: host spawn  0.0s')
    expect(out[1]).toContain('\r\u001b[2Kdsh-opentui: host booting  0.1s')
    expect(out[2]).toBe('\r\u001b[2Kdsh-opentui: host ready  0.3s')
    expect(out[3]).toBe('\n')
  })

  test('non-TTY: one line per phase change, no 150ms spam', () => {
    const out: string[] = []
    const emit = createLaunchProgress({ isTty: false, write: (s) => out.push(s) })
    emit({ phase: 'spawn', elapsedMs: 0 })
    emit({ phase: 'booting', elapsedMs: 150 })
    emit({ phase: 'booting', elapsedMs: 300 })
    emit({ phase: 'ready', elapsedMs: 450 })
    expect(out).toEqual([
      'dsh-opentui: host spawn  0.0s\n',
      'dsh-opentui: host booting  0.1s\n',
      'dsh-opentui: host ready  0.5s\n',
    ])
  })
})
