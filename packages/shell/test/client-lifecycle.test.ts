// ADR-0009 decision 6–8 client lifecycle: refcount/heartbeat, last-one grace,
// all-crash watchdog, --force guard and three-evidence safe kill.
// Every I/O seam is faked: no real host, socket, timer or signal.
import { describe, expect, test } from 'bun:test'
import { basename, dirname, join } from 'node:path'

import {
  assertForceAllowed,
  CLIENTS_DIR_NAME,
  DEFAULT_CLIENT_TTL_MS,
  ForceNeedsYesError,
  IncompleteLifecycleFsError,
  freshClients,
  heartbeatPath,
  isFresh,
  lastOneGracefulShutdown,
  listHeartbeats,
  purgeAllHeartbeats,
  purgeStaleHeartbeats,
  registerHeartbeat,
  resolveGraceMs,
  runWatchdog,
  spawnWatchdog,
  validateHeartbeat,
  ENV_IDLE_MS,
  ENV_WATCHDOG,
  ENV_WATCHDOG_HOME,
  type HeartbeatHandle,
  type LifecycleFs,
  type ProcessKillHooks,
} from '../src/client/client-lifecycle.ts'
import { writeRegistry, type HostRegistryV2 } from '../src/client/host-registry.ts'
import { ensureHost, ForceNeedsYesError as HostForceError } from '../src/client/host-launch.ts'
import { safeStopHost } from '../src/client/safe-kill.ts'
import { prelaunchFailurePolicy } from '../bin/lib/launcher.mjs'

const HOME = '/virtual/home'
const PORT = 60_200
const HOST_PID = 7777
const NOW = Date.parse('2026-11-17T00:00:00.000Z')

/** In-memory fs with readdirSync + rename, shared by heartbeat/registry tests. */
function makeFs(): { fs: LifecycleFs; files: Map<string, string> } {
  const files = new Map<string, string>()
  const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })
  const fs: LifecycleFs = {
    existsSync: (p) => files.has(p),
    mkdirSync: () => {},
    readFileSync: (p) => {
      const v = files.get(p)
      if (v === undefined) throw errno('ENOENT')
      return v
    },
    writeFileSync: (p, data) => files.set(p, data),
    unlinkSync: (p) => {
      if (!files.delete(p)) throw errno('ENOENT')
    },
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
    readdirSync: (dir) => {
      const prefix = dir.endsWith('/') ? dir : dir + '/'
      const names = new Set<string>()
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) names.add(basename(key))
      }
      return [...names]
    },
  }
  return { fs, files }
}

function makeClock() {
  let clock = NOW
  let sleeps = 0
  return {
    now: () => clock,
    advance: (ms: number) => { clock += ms },
    sleep: async (ms: number) => { clock += ms; sleeps += 1 },
    get sleeps() { return sleeps },
    get value() { return clock },
    iso: () => new Date(clock).toISOString(),
  }
}

function makeHooks(
  opts: {
    cmd?: string | null
    env?: boolean
    alive?: (pid: number) => boolean
    /** Simulate a host that actually dies on SIGTERM (so a stop is confirmable). */
    stopOnSigterm?: boolean
    /** Simulate an unreadable env → two-evidence fallback (P1-3). */
    envReadable?: boolean
    onEnvFallback?: (pid: number) => void
  } = {},
): {
  hooks: ProcessKillHooks & { killed: string[] }
  killed: string[]
} {
  const killed: string[] = []
  const hooks: ProcessKillHooks & { killed: string[] } = {
    killed,
    cmdline: () => (opts.cmd === undefined ? '--profile opentui --no-open' : opts.cmd),
    hasServerEnv: () => opts.env ?? true,
    kill: (pid, signal) => { killed.push(`${pid}:${signal}`) },
    pidAlive:
      opts.alive ??
      (opts.stopOnSigterm
        ? (pid) => !killed.some((k) => k.startsWith(`${pid}:SIGTERM`))
        : () => true),
    ...(opts.envReadable !== undefined ? { envReadable: () => opts.envReadable! } : {}),
    ...(opts.onEnvFallback ? { onEnvFallback: opts.onEnvFallback } : {}),
  }
  return { hooks, killed }
}

function seedHeartbeat(fs: LifecycleFs, id: string, lastSeenIso: string, pid = 1000, workspace = '/ws'): void {
  fs.mkdirSync(join(HOME, CLIENTS_DIR_NAME), { recursive: true })
  fs.writeFileSync(heartbeatPath(HOME, id), JSON.stringify({ id, pid, lastSeen: lastSeenIso, workspace }))
}

function seedRegistry(fs: LifecycleFs, pid = HOST_PID): HostRegistryV2 {
  const reg: HostRegistryV2 = {
    version: 2,
    profile: 'opentui',
    home: HOME,
    pid,
    port: PORT,
    phase: 'ready',
    startedAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    authority: `127.0.0.1:${PORT}`,
    clients: [],
  }
  writeRegistry(HOME, 'opentui', reg, fs as never)
  return reg
}

// ---------------------------------------------------------------------------

describe('heartbeat files — register / list / TTL', () => {
  test('register writes a per-client file; refresh updates lastSeen; remove deletes it', () => {
    const { fs, files } = makeFs()
    const clock = makeClock()
    const h: HeartbeatHandle = registerHeartbeat(HOME, { id: 'c1', pid: 111, workspace: '/ws' }, { fs, now: clock.now })
    expect(files.has(heartbeatPath(HOME, 'c1'))).toBe(true)
    const first = JSON.parse(files.get(heartbeatPath(HOME, 'c1'))!)
    expect(first).toMatchObject({ id: 'c1', pid: 111, workspace: '/ws' })

    clock.advance(3_000)
    h.refresh()
    const second = JSON.parse(files.get(heartbeatPath(HOME, 'c1'))!)
    expect(Date.parse(second.lastSeen)).toBe(NOW + 3_000)

    expect(h.remove()).toBe(true)
    expect(files.has(heartbeatPath(HOME, 'c1'))).toBe(false)
    expect(h.remove()).toBe(false)
  })

  test('listHeartbeats skips corrupt files; isFresh enforces the TTL', () => {
    const { fs, files } = makeFs()
    seedHeartbeat(fs, 'fresh', new Date(NOW).toISOString())
    seedHeartbeat(fs, 'stale', new Date(NOW - DEFAULT_CLIENT_TTL_MS - 1).toISOString())
    files.set(join(HOME, CLIENTS_DIR_NAME, 'junk.json'), '{not json')

    const all = listHeartbeats(HOME, { fs, now: () => NOW })
    expect(all.map((h) => h.id).sort()).toEqual(['fresh', 'stale'])
    expect(freshClients(HOME, { fs, now: () => NOW }).map((h) => h.id)).toEqual(['fresh'])
    expect(isFresh(validateHeartbeat(all.find((h) => h.id === 'stale'))!, NOW, DEFAULT_CLIENT_TTL_MS)).toBe(false)
  })

  test('purgeStaleHeartbeats removes only expired clients', () => {
    const { fs } = makeFs()
    seedHeartbeat(fs, 'fresh', new Date(NOW).toISOString())
    seedHeartbeat(fs, 'stale', new Date(NOW - 20_000).toISOString())
    const removed = purgeStaleHeartbeats(HOME, { fs, now: () => NOW })
    expect(removed).toEqual(['stale'])
    expect(listHeartbeats(HOME, { fs, now: () => NOW }).map((h) => h.id)).toEqual(['fresh'])
  })

  test('concurrent clients keep independent files (no array read-modify-write)', () => {
    const { fs, files } = makeFs()
    const clock = makeClock()
    const a = registerHeartbeat(HOME, { id: 'a', pid: 1, workspace: '/a' }, { fs, now: clock.now })
    const b = registerHeartbeat(HOME, { id: 'b', pid: 2, workspace: '/b' }, { fs, now: clock.now })
    clock.advance(1_000)
    a.refresh()
    const rec = JSON.parse(files.get(heartbeatPath(HOME, 'b'))!)
    expect(Date.parse(rec.lastSeen)).toBe(NOW) // b's file untouched by a's write
    b.remove()
    expect(listHeartbeats(HOME, { fs, now: clock.now }).map((h) => h.id)).toEqual(['a'])
  })
})

describe('resolveGraceMs — DSH_OPENTUI_HOST_IDLE_MS meaning', () => {
  test('default 2000; env override; explicit wins; 0 = resident', () => {
    expect(resolveGraceMs()).toBe(2_000)
    expect(resolveGraceMs(undefined, { [ENV_IDLE_MS]: '9000' })).toBe(9_000)
    expect(resolveGraceMs(350, { [ENV_IDLE_MS]: '9000' })).toBe(350)
    expect(resolveGraceMs(undefined, { [ENV_IDLE_MS]: '0' })).toBe(0)
    expect(resolveGraceMs(0)).toBe(0)
    expect(resolveGraceMs(undefined, { [ENV_IDLE_MS]: 'junk' })).toBe(2_000)
  })
})

describe('last-one graceful shutdown (refcount → 0 → grace → SIGTERM)', () => {
  test('no other fresh client → after grace, three-evidence SIGTERM + registry cleared', async () => {
    const { fs, files } = makeFs()
    const clock = makeClock()
    seedRegistry(fs)
    const kill = makeHooks({ stopOnSigterm: true })
    const regPath = join(HOME, 'opentui-host.opentui.json')
    expect(files.has(regPath)).toBe(true)

    const result = await lastOneGracefulShutdown(HOME, {
      fs, now: clock.now, sleep: clock.sleep, hooks: kill.hooks,
      graceMs: 100, ttlMs: DEFAULT_CLIENT_TTL_MS, termGraceMs: 50, killGraceMs: 50,
    })
    expect(result.action).toBe('shutdown')
    expect(kill.killed).toContain(`${HOST_PID}:SIGTERM`)
    expect(files.has(regPath)).toBe(false)
  })

  test('a second live client keeps the host open (no signal)', async () => {
    const { fs, files } = makeFs()
    const clock = makeClock()
    seedRegistry(fs)
    seedHeartbeat(fs, 'other', new Date(NOW).toISOString())
    const kill = makeHooks()
    const regPath = join(HOME, 'opentui-host.opentui.json')

    const result = await lastOneGracefulShutdown(HOME, {
      fs, now: clock.now, sleep: clock.sleep, hooks: kill.hooks, graceMs: 100,
    })
    expect(result.action).toBe('others-alive')
    expect(result.freshCount).toBe(1)
    expect(kill.killed).toHaveLength(0)
    expect(files.has(regPath)).toBe(true)
  })

  test('graceMs 0 = resident — never auto-close', async () => {
    const { fs, files } = makeFs()
    seedRegistry(fs)
    const kill = makeHooks()
    const result = await lastOneGracefulShutdown(HOME, {
      fs, now: () => NOW, sleep: async () => {}, hooks: kill.hooks, graceMs: 0,
    })
    expect(result.action).toBe('resident')
    expect(kill.killed).toHaveLength(0)
    expect(files.has(join(HOME, 'opentui-host.opentui.json'))).toBe(true)
  })

  test('three evidence missing → refuse to signal AND keep the registry (P0-2)', async () => {
    const { fs, files } = makeFs()
    seedRegistry(fs)
    const kill = makeHooks({ env: false })
    const regPath = join(HOME, 'opentui-host.opentui.json')
    const result = await lastOneGracefulShutdown(HOME, {
      fs, now: () => NOW, sleep: async () => {}, hooks: kill.hooks, graceMs: 10, termGraceMs: 10, killGraceMs: 10,
    })
    expect(result.action).toBe('evidence-refused')
    expect(kill.killed).toHaveLength(0)
    expect(files.has(regPath)).toBe(true) // never orphan a live host
  })

  test('evidence matched but pid survives SIGKILL → stop-failed, registry kept (P0-2)', async () => {
    const { fs, files } = makeFs()
    seedRegistry(fs)
    const kill = makeHooks({ alive: () => true }) // never dies, even after SIGKILL
    const result = await lastOneGracefulShutdown(HOME, {
      fs, now: () => NOW, sleep: async () => {}, hooks: kill.hooks, graceMs: 10, termGraceMs: 10, killGraceMs: 10,
    })
    expect(result.action).toBe('stop-failed')
    expect(kill.killed).toContain(`${HOST_PID}:SIGTERM`)
    expect(kill.killed).toContain(`${HOST_PID}:SIGKILL`)
    expect(files.has(join(HOME, 'opentui-host.opentui.json'))).toBe(true)
  })
})

describe('all-crash watchdog fallback', () => {
  test('no fresh client across TTL+grace → reclaim host + clear registry + stop', async () => {
    const { fs, files } = makeFs()
    const clock = makeClock()
    seedRegistry(fs)
    const kill = makeHooks({ stopOnSigterm: true })
    const ticks: number[] = []
    const result = await runWatchdog(HOME, {
      fs, now: clock.now, sleep: clock.sleep, hooks: kill.hooks,
      graceMs: 50, pollMs: 10, maxTicks: 3, termGraceMs: 50, killGraceMs: 50,
      onTick: ({ freshCount }) => ticks.push(freshCount),
    })
    expect(result.reclaimed).toBe(true)
    expect(result.reason).toBe('reclaimed')
    expect(kill.killed).toContain(`${HOST_PID}:SIGTERM`)
    expect(files.has(join(HOME, 'opentui-host.opentui.json'))).toBe(false)
  })

  test('a live heartbeat keeps the watchdog from reclaiming', async () => {
    const { fs, files } = makeFs()
    const clock = makeClock()
    seedRegistry(fs)
    seedHeartbeat(fs, 'alive', new Date(NOW).toISOString())
    const kill = makeHooks()
    const result = await runWatchdog(HOME, {
      fs, now: clock.now, sleep: clock.sleep, hooks: kill.hooks,
      graceMs: 20, pollMs: 10, maxTicks: 3,
    })
    expect(result.reclaimed).toBe(false)
    expect(result.reason).toBe('max-ticks')
    expect(kill.killed).toHaveLength(0)
    expect(files.has(join(HOME, 'opentui-host.opentui.json'))).toBe(true)
  })

  test('host already dead → watchdog self-exits without signalling', async () => {
    const { fs } = makeFs()
    seedRegistry(fs)
    const kill = makeHooks({ alive: () => false })
    const result = await runWatchdog(HOME, {
      fs, now: () => NOW, sleep: async () => {}, hooks: kill.hooks, maxTicks: 2,
    })
    expect(result.reason).toBe('host-gone')
    expect(kill.killed).toHaveLength(0)
  })

  test('evidence refused → registry kept, log emitted, retry next tick (P0-2)', async () => {
    const { fs, files } = makeFs()
    const clock = makeClock()
    seedRegistry(fs)
    // env evidence missing and no fallback hook → strict refusal; host stays alive
    const kill = makeHooks({ env: false })
    const refusals: { pid: number; evidencesOk: boolean }[] = []
    const regPath = join(HOME, 'opentui-host.opentui.json')
    const result = await runWatchdog(HOME, {
      fs, now: clock.now, sleep: clock.sleep, hooks: kill.hooks,
      graceMs: 10, pollMs: 5, maxTicks: 3, termGraceMs: 10, killGraceMs: 10,
      onEvidenceRefused: (info) => refusals.push(info),
    })
    expect(result.reclaimed).toBe(false)
    expect(result.reason).toBe('max-ticks') // retried instead of returning early
    expect(refusals.length).toBeGreaterThanOrEqual(1)
    expect(refusals[0]!.evidencesOk).toBe(false)
    expect(kill.killed).toHaveLength(0)
    expect(files.has(regPath)).toBe(true) // live host keeps its only record
  })

  test('graceMs 0 = resident — watchdog self-exits, never signals (P1-2)', async () => {
    const { fs, files } = makeFs()
    seedRegistry(fs)
    const kill = makeHooks()
    const result = await runWatchdog(HOME, {
      fs, now: () => NOW, sleep: async () => {}, hooks: kill.hooks, graceMs: 0, maxTicks: 3,
    })
    expect(result.reason).toBe('resident')
    expect(result.reclaimed).toBe(false)
    expect(kill.killed).toHaveLength(0)
    expect(files.has(join(HOME, 'opentui-host.opentui.json'))).toBe(true)
  })
})

describe('three-evidence safe kill — the only signalling path', () => {
  test('all three agree → SIGTERM (stopped when pid exits)', async () => {
    const kill = makeHooks({ alive: (pid) => !kill.killed.some((k) => k.startsWith(`${pid}:SIGTERM`)) })
    const result = await safeStopHost({
      pid: HOST_PID, registryPid: HOST_PID, hooks: kill.hooks, termGraceMs: 20, killGraceMs: 20,
      now: () => NOW, sleep: async () => {},
    })
    expect(result.evidencesOk).toBe(true)
    expect(result.stopped).toBe(true)
    expect(kill.killed).toEqual([`${HOST_PID}:SIGTERM`]) // no SIGKILL needed
  })

  test('registry pid mismatch → no signal', async () => {
    const kill = makeHooks()
    const result = await safeStopHost({
      pid: HOST_PID, registryPid: 9999, hooks: kill.hooks, now: () => NOW, sleep: async () => {},
    })
    expect(result.evidencesOk).toBe(false)
    expect(kill.killed).toHaveLength(0)
  })

  test('wrong profile / second profile → no signal', async () => {
    for (const cmd of ['--profile web', '--profile opentui --profile tui', 'just dsh']) {
      const kill = makeHooks({ cmd })
      const result = await safeStopHost({
        pid: HOST_PID, registryPid: HOST_PID, hooks: kill.hooks, now: () => NOW, sleep: async () => {},
      })
      expect(result.evidencesOk).toBe(false)
      expect(kill.killed).toHaveLength(0)
    }
  })

  test('missing DSH_OPENTUI_SERVER env → no signal', async () => {
    const kill = makeHooks({ env: false })
    const result = await safeStopHost({
      pid: HOST_PID, registryPid: HOST_PID, hooks: kill.hooks, now: () => NOW, sleep: async () => {},
    })
    expect(result.evidencesOk).toBe(false)
    expect(kill.killed).toHaveLength(0)
  })

  test('pid survives SIGTERM → escalates to SIGKILL', async () => {
    const kill = makeHooks({ alive: () => true })
    const result = await safeStopHost({
      pid: HOST_PID, registryPid: HOST_PID, hooks: kill.hooks,
      termGraceMs: 20, killGraceMs: 20, now: () => NOW, sleep: async () => {},
    })
    expect(kill.killed).toEqual([`${HOST_PID}:SIGTERM`, `${HOST_PID}:SIGKILL`])
    expect(result.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  test('env unreadable → registry + cmdline two-evidence fallback agrees + logs (P1-3)', async () => {
    const fallbacks: number[] = []
    const kill = makeHooks({ env: false, envReadable: false, onEnvFallback: (pid) => fallbacks.push(pid) })
    const result = await safeStopHost({
      pid: HOST_PID, registryPid: HOST_PID, hooks: kill.hooks, now: () => NOW, sleep: async () => {},
    })
    expect(result.evidencesOk).toBe(true)
    expect(fallbacks).toEqual([HOST_PID])
    expect(kill.killed).toContain(`${HOST_PID}:SIGTERM`)
  })

  test('env readable but marker missing → still refuse, no fallback (P1-3)', async () => {
    const fallbacks: number[] = []
    const kill = makeHooks({ env: false, envReadable: true, onEnvFallback: (pid) => fallbacks.push(pid) })
    const result = await safeStopHost({
      pid: HOST_PID, registryPid: HOST_PID, hooks: kill.hooks, now: () => NOW, sleep: async () => {},
    })
    expect(result.evidencesOk).toBe(false)
    expect(fallbacks).toHaveLength(0)
    expect(kill.killed).toHaveLength(0)
  })

  test('env unreadable NEVER waives registry-pid or exact-cmdline evidence (P1-3)', async () => {
    for (const cmd of ['--profile web', 'just dsh', null]) {
      const kill = makeHooks({ cmd, env: false, envReadable: false })
      const result = await safeStopHost({
        pid: HOST_PID, registryPid: HOST_PID, hooks: kill.hooks, now: () => NOW, sleep: async () => {},
      })
      expect(result.evidencesOk).toBe(false)
      expect(kill.killed).toHaveLength(0)
    }
    const mismatch = makeHooks({ env: false, envReadable: false })
    await expect(safeStopHost({
      pid: HOST_PID, registryPid: 9999, hooks: mismatch.hooks, now: () => NOW, sleep: async () => {},
    })).resolves.toMatchObject({ evidencesOk: false })
  })
})

describe('--force / --yes guard', () => {
  test('live clients without --yes → refuse with a count; with --yes → allowed', () => {
    const { fs } = makeFs()
    seedHeartbeat(fs, 'c1', new Date(NOW).toISOString())
    seedHeartbeat(fs, 'c2', new Date(NOW).toISOString())
    expect(() => assertForceAllowed(HOME, { fs, now: () => NOW })).toThrow(ForceNeedsYesError)
    try {
      assertForceAllowed(HOME, { fs, now: () => NOW })
    } catch (err) {
      expect((err as ForceNeedsYesError).clientCount).toBe(2)
      expect((err as ForceNeedsYesError).message).toContain('disconnect 2 live client')
    }
    expect(assertForceAllowed(HOME, { fs, now: () => NOW, yes: true }).liveClients).toBe(2)
  })

  test('no live client → --force allowed without --yes', () => {
    const { fs } = makeFs()
    expect(assertForceAllowed(HOME, { fs, now: () => NOW }).liveClients).toBe(0)
  })

  test('ensureHost: force with a fresh client and no --yes rejects', async () => {
    const { fs } = makeFs()
    seedHeartbeat(fs, 'c1', new Date(NOW).toISOString())
    const kill = makeHooks()
    await expect(ensureHost({
      home: HOME, fs: fs as never, lifecycleFs: fs, now: () => NOW, force: true, killHooks: kill.hooks,
      spawnHost: () => { throw new Error('must not spawn') },
    })).rejects.toBeInstanceOf(HostForceError)
    expect(kill.killed).toHaveLength(0)
  })

  test('ensureHost: force --yes resets — stops host, clears registry + heartbeats, respawns', async () => {
    const { fs, files } = makeFs()
    const clock = makeClock()
    seedRegistry(fs)
    seedHeartbeat(fs, 'c1', new Date(NOW).toISOString())
    const kill = makeHooks({ stopOnSigterm: true })
    const child = {
      pid: 4242,
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: () => {},
      kill: () => true,
    }
    const spawned: unknown[] = []
    const result = await ensureHost({
      home: HOME, fs: fs as never, lifecycleFs: fs, now: clock.now, sleep: clock.sleep,
      force: true, yes: true, killHooks: kill.hooks, pidAlive: kill.hooks.pidAlive!,
      baseEnv: {}, findPort: async () => PORT,
      mintCookie: ({ authority }) => `cookie-for-${authority}`,
      health: async () => ({ healthy: true, tcp: true, httpStatus: 200, reason: 'ok' as const }),
      spawnHost: (argv, o) => { spawned.push({ argv, o }); return child as never },
    })
    expect(result.spawned).toBe(true)
    expect(spawned).toHaveLength(1)
    expect(kill.killed).toContain(`${HOST_PID}:SIGTERM`)
    // Old registry was cleared; the respawn wrote a fresh one for the new pid.
    const reg = JSON.parse(files.get(join(HOME, 'opentui-host.opentui.json'))!)
    expect(reg.pid).toBe(4242)
    expect(reg.phase).toBe('ready')
    expect(listHeartbeats(HOME, { fs, now: clock.now })).toHaveLength(0) // heartbeats purged
  })

  // Regression for T6b/S1: the packaged host-launch used to hand the slim
  // registry-only fs (no readdirSync) to the force guard. A live client was then
  // invisible → no ForceNeedsYesError → SIGTERM to a live host. That fs must now
  // HARD-ERROR, never silently report zero clients.
  test('slim fs without readdirSync hard-errors instead of silently allowing force', () => {
    const { fs: full } = makeFs()
    seedHeartbeat(full, 'c1', new Date(NOW).toISOString()) // a live client really exists
    const slim: LifecycleFs = { ...full }
    delete slim.readdirSync
    // The full fs still sees the client and refuses.
    expect(() => assertForceAllowed(HOME, { fs: full, now: () => NOW })).toThrow(ForceNeedsYesError)
    // The slim fs must not degrade to "0 clients → allowed".
    expect(() => assertForceAllowed(HOME, { fs: slim, now: () => NOW })).toThrow(IncompleteLifecycleFsError)
    try {
      assertForceAllowed(HOME, { fs: slim, now: () => NOW })
    } catch (err) {
      expect((err as IncompleteLifecycleFsError).code).toBe('lifecycle-fs-incomplete')
      expect((err as IncompleteLifecycleFsError).missing).toContain('readdirSync')
      expect((err as IncompleteLifecycleFsError).message).toContain('readdirSync')
    }
  })

  test('ensureHost force with a slim lifecycleFs refuses before any host signal/spawn', async () => {
    const { fs } = makeFs()
    seedRegistry(fs)
    seedHeartbeat(fs, 'c1', new Date(NOW).toISOString())
    const slim: LifecycleFs = { ...fs }
    delete slim.readdirSync
    const kill = makeHooks({ stopOnSigterm: true })
    await expect(ensureHost({
      home: HOME, fs: fs as never, lifecycleFs: slim, now: () => NOW, force: true,
      killHooks: kill.hooks, pidAlive: kill.hooks.pidAlive!,
      spawnHost: () => { throw new Error('must not spawn') },
    })).rejects.toBeInstanceOf(IncompleteLifecycleFsError)
    expect(kill.killed).toHaveLength(0) // no SIGTERM/SIGKILL reached the live host
  })

  test('ForceNeedsYesError maps to exit 2 (usage-error) and prints the client count', () => {
    const { fs } = makeFs()
    seedHeartbeat(fs, 'c1', new Date(NOW).toISOString())
    let err: unknown
    try {
      assertForceAllowed(HOME, { fs, now: () => NOW })
    } catch (caught) {
      err = caught
    }
    expect(err).toBeInstanceOf(ForceNeedsYesError)
    const forceErr = err as ForceNeedsYesError
    expect(forceErr.code).toBe('force-needs-yes')
    expect(forceErr.message).toContain('disconnect 1 live client')
    // The launcher's pre-launch failure policy maps this to exit code 2.
    expect(prelaunchFailurePolicy(forceErr, false)).toBe('usage-error')
    expect(prelaunchFailurePolicy(forceErr, true)).toBe('usage-error')
  })
})

describe('detached watchdog spawn', () => {
  test('marks the child with all three evidences and unrefs it', () => {
    const calls: { command: string; args: string[]; options: Record<string, unknown> }[] = []
    let unrefed = false
    const res = spawnWatchdog(HOME, {
      scriptPath: '/pkg/dist/watchdog.mjs',
      env: {},
      spawn: (command, args, options) => {
        calls.push({ command, args, options })
        return { pid: 555, unref: () => { unrefed = true } }
      },
    })
    expect(res.pid).toBe(555)
    expect(unrefed).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.args).toEqual(['/pkg/dist/watchdog.mjs', '--profile', 'opentui'])
    const env = calls[0]!.options.env as NodeJS.ProcessEnv
    expect(env.DSH_OPENTUI_SERVER).toBe('1')
    expect(env[ENV_WATCHDOG]).toBe('1')
    expect(env[ENV_WATCHDOG_HOME]).toBe(HOME)
    expect((calls[0]!.options as { detached: boolean }).detached).toBe(true)
  })
})
