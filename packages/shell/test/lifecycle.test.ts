// Host lifecycle manager contract (client-mode bucket (e), ADR-0005 decision 5):
// ensureHost must manage ONE resident dsh host per profile — idempotent joins,
// refcount + idle-exit with a cancellable grace window, single-instance
// lockfile with stale takeover and adoption, a rapid-respawn cap, and typed
// boot errors. All units run against an injectable fake spawn runner; the
// only test that touches a real `dsh` is the guarded live smoke at the end.
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type AddressInfo } from 'node:http'
import {
  DEFAULT_PROFILE,
  HostBootTimeoutError,
  HostDiedError,
  HostRespawnLoopError,
  MintUnavailableError,
  ProfileMissingError,
  ensureHost,
  pidAlive,
  __internals,
  type HostChildProcess,
  type HostHandle,
  type MintOwnerCookie,
  type SpawnDsh,
} from '../src/client/lifecycle.ts'

// ---------------------------------------------------------------------------
// Fakes.
// ---------------------------------------------------------------------------

interface FakeChild extends HostChildProcess {
  writeOut(text: string): void
  emitExit(code?: number | null, signal?: string | null): void
  kills: string[]
}

function makeFakeChild(pid: number): FakeChild {
  const kills: string[] = []
  const dataCbs: ((chunk: unknown) => void)[] = []
  const exitCbs: ((code: number | null, signal: string | null) => void)[] = []
  let exited = false
  const child: FakeChild = {
    pid,
    exitCode: null,
    stdout: {
      on: (_event: 'data', listener: (chunk: unknown) => void) => {
        dataCbs.push(listener)
        return child
      },
    },
    stderr: { on: () => child },
    on(event: string, listener: (...args: unknown[]) => void) {
      if (event === 'exit') exitCbs.push(listener as (code: number | null, signal: string | null) => void)
      // 'error' listeners are accepted and ignored (real code swallows them)
      return child
    },
    kill(signal?: string) {
      const sig = signal ?? 'SIGTERM'
      kills.push(sig)
      // a killed process dies like a real one (exit by signal: code null)
      if (!exited) {
        exited = true
        queueMicrotask(() => {
          for (const listener of [...exitCbs]) listener(null, sig)
        })
      }
      return true
    },
    unref() {},
    kills,
    writeOut(text: string) {
      for (const listener of dataCbs) listener(Buffer.from(text))
    },
    emitExit(code: number | null = 0, signal: string | null = null) {
      child.exitCode = code
      exited = true
      for (const listener of [...exitCbs]) listener(code, signal)
    },
  }
  return child
}

function makeRunner(pidStart = 40_000) {
  const calls: { argv: string[]; cwd: string; env: NodeJS.ProcessEnv }[] = []
  const children: FakeChild[] = []
  let seq = 0
  const spawnDsh: SpawnDsh = (argv, options) => {
    calls.push({ argv, cwd: options.cwd, env: options.env })
    const child = makeFakeChild(pidStart + ++seq)
    children.push(child)
    return child
  }
  return {
    calls,
    children,
    spawnDsh,
    get last() {
      return children.at(-1)!
    },
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitUntil(predicate: () => boolean, budgetMs = 3_000): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitUntil: predicate never became true')
    await sleep(10)
  }
}

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-lifecycle-test-'))
  // the real boot path requires the profile dir to exist (it is the child cwd)
  mkdirSync(join(home, 'profiles', DEFAULT_PROFILE), { recursive: true })
  return home
}

function readyLine(port: number): string {
  return `dsh web: http://127.0.0.1:${port}/?token=tok-123\n`
}

function readyUrl(port: number): string {
  return readyLine(port).trim().replace(/^dsh web: /, '')
}

function lockPathOf(home: string): string {
  return __internals.lockPathFor(home, DEFAULT_PROFILE)
}

function registeredFor(home: string): boolean {
  return __internals.registry.has(__internals.registryKey(home, DEFAULT_PROFILE))
}

/** Boots through ensureHost with the fake runner and completes readiness. */
async function fakeBoot(
  runner: ReturnType<typeof makeRunner>,
  home: string,
  opts: Record<string, unknown> = {},
): Promise<HostHandle> {
  const before = runner.calls.length
  const booting = ensureHost({
    dshHome: home,
    spawnDsh: runner.spawnDsh,
    mintCookie: (o) => `FakeCookie ${o.authority}`,
    ...opts,
  } as Parameters<typeof ensureHost>[0])
  await waitUntil(() => runner.calls.length === before + 1)
  const call = runner.calls[before]!
  runner.last.writeOut(readyLine(Number(call.argv[call.argv.indexOf('--port') + 1])))
  return booting
}

/** A real, killable, still-alive pid (a plain `sleep` child). */
function spawnSleeper(): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(['sleep', '120'], { stdout: 'ignore', stderr: 'ignore' })
}

function writeLockFor(home: string, lock: object): void {
  mkdirSync(home, { recursive: true })
  writeFileSync(lockPathOf(home), JSON.stringify(lock, null, 2) + '\n')
}

function readLockFrom(home: string): any {
  return JSON.parse(readFileSync(lockPathOf(home), 'utf8'))
}

async function rejectsWith<T extends Error>(promise: Promise<unknown>, ctor: new (...args: never[]) => T): Promise<T> {
  try {
    await promise
  } catch (err) {
    expect(err instanceof ctor).toBe(true)
    return err as T
  }
  throw new Error(`expected rejection with ${ctor.name}, but the promise resolved`)
}

/** A loopback port that is (almost surely) NOT listening. */
async function closedPort(): Promise<number> {
  const server = createServer(() => {})
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('ensureHost — boot + contract', () => {
  test('spawns dsh with the profile args, writes the lockfile, mints the cookie', async () => {
    const home = makeHome()
    const runner = makeRunner()
    try {
      const mintCalls: { home: string; authority: string; maxAgeMs?: number }[] = []
      const handle = await fakeBoot(runner, home, {
        mintCookie: (o) => {
          mintCalls.push(o)
          return `FakeCookie ${o.authority}`
        },
      })

      expect(runner.calls.length).toBe(1)
      const port = Number(runner.calls[0]!.argv[runner.calls[0]!.argv.indexOf('--port') + 1])
      expect(port).toBeGreaterThan(0)
      expect(runner.calls[0]!.argv.slice(0, 5)).toEqual([
        '--profile',
        DEFAULT_PROFILE,
        '--no-open',
        '--port',
        String(port),
      ])
      expect(runner.calls[0]!.cwd).toBe(join(home, 'profiles', DEFAULT_PROFILE))
      expect(runner.calls[0]!.env.DSH_HOME).toBe(home)

      expect(handle.pid).toBe(runner.last.pid)
      expect(handle.port).toBe(port)
      expect(handle.authority).toBe(`127.0.0.1:${port}`)
      expect(handle.token).toBe('tok-123')
      expect(handle.url).toBe(readyUrl(port))
      expect(handle.adopted).toBe(false)
      expect(handle.refCount).toBe(1)

      expect(mintCalls.length).toBe(1)
      expect(mintCalls[0]!.home).toBe(home)
      expect(mintCalls[0]!.authority).toBe(`127.0.0.1:${port}`)
      expect(handle.cookieHeader).toBe(`FakeCookie 127.0.0.1:${port}`)

      const lock = readLockFrom(home)
      expect(lock).toEqual({
        pid: runner.last.pid,
        port,
        authority: `127.0.0.1:${port}`,
        startedAt: expect.any(String),
        profile: DEFAULT_PROFILE,
      })

      await handle.dispose()
      expect(existsSync(lockPathOf(home))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('spawn env: NODE_OPTIONS carries --experimental-ffi (added once, inherited, never duplicated)', async () => {
    const home = makeHome()
    const runner = makeRunner()
    const savedNodeOptions = process.env.NODE_OPTIONS
    try {
      // 1. Absent inherited NODE_OPTIONS → the flag is added.
      delete process.env.NODE_OPTIONS
      let handle = await fakeBoot(runner, home)
      await handle.dispose()
      expect(runner.calls[0]!.env.NODE_OPTIONS).toBe('--experimental-ffi')

      // 2. Inherited NODE_OPTIONS without the flag → merged, existing kept.
      process.env.NODE_OPTIONS = '--max-old-space-size=4096'
      handle = await fakeBoot(runner, home)
      await handle.dispose()
      expect(runner.calls[1]!.env.NODE_OPTIONS).toBe('--max-old-space-size=4096 --experimental-ffi')

      // 3. Inherited NODE_OPTIONS already carrying the flag → untouched
      // (no duplicate; the v2 shell's hasFfiFlag then never re-execs).
      process.env.NODE_OPTIONS = '--experimental-ffi --max-old-space-size=4096'
      handle = await fakeBoot(runner, home)
      await handle.dispose()
      expect(runner.calls[2]!.env.NODE_OPTIONS).toBe('--experimental-ffi --max-old-space-size=4096')
    } finally {
      if (savedNodeOptions === undefined) delete process.env.NODE_OPTIONS
      else process.env.NODE_OPTIONS = savedNodeOptions
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('missing profile dir → ProfileMissingError before any spawn', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-lifecycle-test-'))
    const runner = makeRunner()
    try {
      const err = await rejectsWith(
        ensureHost({ dshHome: home, spawnDsh: runner.spawnDsh, mintCookie: () => 'x' }),
        ProfileMissingError,
      )
      expect(err.profileDir).toBe(join(home, 'profiles', DEFAULT_PROFILE))
      expect(runner.calls.length).toBe(0)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('child dies before readiness → HostDiedError with output tail, child cleaned up', async () => {
    const home = makeHome()
    const runner = makeRunner()
    try {
      const booting = ensureHost({
        dshHome: home,
        spawnDsh: runner.spawnDsh,
        mintCookie: () => 'x',
      })
      await waitUntil(() => runner.calls.length === 1)
      runner.last.writeOut('starting up…\n')
      runner.last.emitExit(1, null)
      const err = await rejectsWith(booting, HostDiedError)
      expect(err.exitCode).toBe(1)
      expect(err.outputTail).toContain('starting up…')
      expect(runner.last.kills).toContain('SIGTERM') // boot-failure cleanup
      expect(existsSync(lockPathOf(home))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('readiness timeout → HostBootTimeoutError, child SIGTERMed', async () => {
    const home = makeHome()
    const runner = makeRunner()
    try {
      const err = await rejectsWith(
        ensureHost({
          dshHome: home,
          spawnDsh: runner.spawnDsh,
          mintCookie: () => 'x',
          readinessTimeoutMs: 120,
        }),
        HostBootTimeoutError,
      )
      expect(err.budgetMs).toBe(120)
      expect(runner.last.kills).toContain('SIGTERM')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('mint module missing and no fake injected → MintUnavailableError + cleanup', async () => {
    const home = makeHome()
    const runner = makeRunner()
    try {
      const real = await __internals.loadRealMint()
      if (real) {
        console.log('skipping MintUnavailableError case: ./cookie-mint.ts has landed')
        return
      }
      const booting = ensureHost({ dshHome: home, spawnDsh: runner.spawnDsh })
      await waitUntil(() => runner.calls.length === 1)
      runner.last.writeOut(readyLine(Number(runner.calls[0]!.argv[4])))
      await rejectsWith(booting, MintUnavailableError)
      expect(runner.last.kills).toContain('SIGTERM')
      expect(existsSync(lockPathOf(home))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('ensureHost — idempotency + refcount', () => {
  test('second ensureHost joins the live host (same handle, refcount 2, one spawn)', async () => {
    const home = makeHome()
    const runner = makeRunner()
    try {
      const handle = await fakeBoot(runner, home)
      const joined = await ensureHost({
        dshHome: home,
        spawnDsh: runner.spawnDsh,
        mintCookie: () => 'joined-should-not-run',
      })
      expect(joined).toBe(handle)
      expect(handle.refCount).toBe(2)
      expect(runner.calls.length).toBe(1)
      await handle.dispose()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('concurrent ensureHost calls join one in-flight boot', async () => {
    const home = makeHome()
    const runner = makeRunner()
    try {
      const mint: MintOwnerCookie = () => 'FakeCookie concurrent'
      const booting = Promise.all([
        ensureHost({ dshHome: home, spawnDsh: runner.spawnDsh, mintCookie: mint }),
        ensureHost({ dshHome: home, spawnDsh: runner.spawnDsh, mintCookie: mint }),
      ])
      await waitUntil(() => runner.calls.length === 1)
      runner.last.writeOut(readyLine(Number(runner.calls[0]!.argv[4])))
      const [a, b] = await booting
      expect(b).toBe(a)
      expect(runner.calls.length).toBe(1)
      expect(a.refCount).toBe(2)
      await a.dispose()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('idle timer fires after release: SIGTERM, lockfile cleared, next boot is fresh', async () => {
    const home = makeHome()
    const runner = makeRunner()
    try {
      const handle = await fakeBoot(runner, home, { idleExitSec: 0.15 })
      const firstPid = handle.pid
      handle.release()
      await waitUntil(() => !existsSync(lockPathOf(home)), 5_000)
      await waitUntil(() => runner.last.kills.includes('SIGTERM'), 2_000)
      expect(registeredFor(home)).toBe(false)

      // dispose() on an already-idle-exited host is a no-op that resolves
      await handle.dispose()

      // the next ensureHost respawns a fresh child
      const respawned = await fakeBoot(runner, home)
      expect(respawned.pid).not.toBe(firstPid)
      expect(runner.calls.length).toBe(2)
      await respawned.dispose()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('grace-window re-attach cancels the idle timer (child survives)', async () => {
    const home = makeHome()
    const runner = makeRunner()
    try {
      const handle = await fakeBoot(runner, home, { idleExitSec: 0.3 })
      handle.release()
      await sleep(120) // inside the grace window
      const rejoined = await ensureHost({
        dshHome: home,
        spawnDsh: runner.spawnDsh,
        mintCookie: () => 'x',
      })
      expect(rejoined).toBe(handle)
      expect(handle.refCount).toBe(1)
      await sleep(450) // longer than the original idle deadline
      expect(runner.last.kills.length).toBe(0)
      expect(runner.last.exitCode).toBe(null)
      expect(existsSync(lockPathOf(home))).toBe(true)
      await handle.dispose()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('idleExitSec 0 = never exit (resident)', async () => {
    const home = makeHome()
    const runner = makeRunner()
    try {
      const handle = await fakeBoot(runner, home, { idleExitSec: 0 })
      handle.release()
      await sleep(350)
      expect(runner.last.kills.length).toBe(0)
      expect(existsSync(lockPathOf(home))).toBe(true)
      expect(handle.refCount).toBe(0)
      await handle.dispose()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('ensureHost — single-instance lock', () => {
  test('stale lock (dead pid) → takeover: fresh boot replaces the lockfile', async () => {
    const home = makeHome()
    const runner = makeRunner()
    try {
      writeLockFor(home, {
        pid: 2_000_000_000, // nothing lives here
        port: 1,
        authority: '127.0.0.1:1',
        startedAt: new Date().toISOString(),
        profile: DEFAULT_PROFILE,
      })
      const handle = await fakeBoot(runner, home)
      expect(runner.calls.length).toBe(1) // spawned, not adopted
      const lock = readLockFrom(home)
      expect(lock.pid).toBe(runner.last.pid)
      expect(lock.pid).not.toBe(2_000_000_000)
      expect(handle.adopted).toBe(false)
      await handle.dispose()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('stale lock (alive pid, listener gone) → takeover after the probe window', async () => {
    const home = makeHome()
    const runner = makeRunner()
    const sleeper = spawnSleeper()
    try {
      const dead = await closedPort()
      writeLockFor(home, {
        pid: sleeper.pid, // alive but will never listen on `dead`
        port: dead,
        authority: `127.0.0.1:${dead}`,
        startedAt: new Date().toISOString(),
        profile: DEFAULT_PROFILE,
      })
      const handle = await fakeBoot(runner, home, { staleProbeMs: 300 })
      expect(runner.calls.length).toBe(1)
      expect(handle.pid).not.toBe(sleeper.pid)
      await handle.dispose()
    } finally {
      sleeper.kill()
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('fresh lock (alive pid + live listener) → adoption, no spawn', async () => {
    const home = makeHome()
    const runner = makeRunner()
    const sleeper = spawnSleeper()
    const server = createServer((_req, res) => res.end('adopted-host'))
    try {
      const [port] = await new Promise<number[]>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve([(server.address() as AddressInfo).port])),
      )
      writeLockFor(home, {
        pid: sleeper.pid,
        port,
        authority: `127.0.0.1:${port}`,
        startedAt: new Date().toISOString(),
        profile: DEFAULT_PROFILE,
      })
      const mintCalls: { authority: string }[] = []
      const handle = await ensureHost({
        dshHome: home,
        spawnDsh: runner.spawnDsh,
        mintCookie: (o) => {
          mintCalls.push(o)
          return `FakeCookie ${o.authority}`
        },
      })
      expect(runner.calls.length).toBe(0) // nothing spawned
      expect(handle.adopted).toBe(true)
      expect(handle.pid).toBe(sleeper.pid)
      expect(handle.port).toBe(port)
      expect(handle.authority).toBe(`127.0.0.1:${port}`)
      expect(mintCalls[0]!.authority).toBe(`127.0.0.1:${port}`)
      expect(existsSync(lockPathOf(home))).toBe(true)

      // dispose of an adopted host signals the foreign pid
      await handle.dispose()
      const died = await Promise.race([sleeper.exited.then(() => true), sleep(6_000).then(() => false)])
      expect(died).toBe(true)
      expect(sleeper.signalCode === 'SIGTERM' || sleeper.exitCode !== null).toBe(true)
    } finally {
      server.close()
      sleeper.kill()
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('adoption bumps the lockfile (fresh startedAt/mtime) — reaper-visible liveness', async () => {
    const home = makeHome()
    const runner = makeRunner()
    const sleeper = spawnSleeper()
    const server = createServer((_req, res) => res.end('adopted-host'))
    try {
      const [port] = await new Promise<number[]>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve([(server.address() as AddressInfo).port])),
      )
      const staleStamp = new Date(Date.now() - 120_000).toISOString()
      writeLockFor(home, {
        pid: sleeper.pid,
        port,
        authority: `127.0.0.1:${port}`,
        startedAt: staleStamp,
        profile: DEFAULT_PROFILE,
      })
      const mtimeBefore = statSync(lockPathOf(home)).mtimeMs

      const handle = await ensureHost({
        dshHome: home,
        spawnDsh: runner.spawnDsh,
        mintCookie: (o) => `FakeCookie ${o.authority}`,
      })
      expect(handle.adopted).toBe(true)

      // the bump: same pid/port, refreshed startedAt + mtime (the detached
      // idle reaper treats a recently-touched lockfile as alive even without
      // an ESTABLISHED connection yet — the adopted client may still be
      // minting, up to ~15s, at the reaper's grace deadline)
      const lock = readLockFrom(home)
      expect(lock.pid).toBe(sleeper.pid)
      expect(lock.port).toBe(port)
      expect(lock.startedAt).not.toBe(staleStamp)
      expect(Date.parse(lock.startedAt)).toBeGreaterThan(Date.parse(staleStamp))
      expect(statSync(lockPathOf(home)).mtimeMs).toBeGreaterThanOrEqual(mtimeBefore)

      await handle.dispose()
    } finally {
      server.close()
      sleeper.kill()
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('ensureHost — concurrent cold-boot mutual exclusion', () => {
  test('slow boot + concurrent second ensureHost → exactly ONE spawn, second caller joins (same pid/port)', async () => {
    const home = makeHome()
    const runner = makeRunner()
    try {
      const mint: MintOwnerCookie = (o) => `FakeCookie ${o.authority}`
      const first = ensureHost({ dshHome: home, spawnDsh: runner.spawnDsh, mintCookie: mint })
      await waitUntil(() => runner.calls.length === 1)
      const second = ensureHost({ dshHome: home, spawnDsh: runner.spawnDsh, mintCookie: mint })
      await sleep(600) // the boot is still slow-pending — nobody respawns
      expect(runner.calls.length).toBe(1)
      runner.last.writeOut(readyLine(Number(runner.calls[0]!.argv[runner.calls[0]!.argv.indexOf('--port') + 1])))
      const [a, b] = await Promise.all([first, second])
      expect(a.pid).toBe(b.pid)
      expect(a.port).toBe(b.port)
      expect(b).toBe(a)
      expect(a.refCount).toBe(2)
      expect(runner.calls.length).toBe(1) // exactly one spawn
      await a.dispose()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('foreign booting placeholder: waits, joins the completed boot (no spawn of our own)', async () => {
    const home = makeHome()
    const runner = makeRunner()
    const sleeper = spawnSleeper() // the foreign booter process
    const server = createServer((_req, res) => res.end('foreign-boot'))
    try {
      const [port] = await new Promise<number[]>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve([(server.address() as AddressInfo).port])),
      )
      writeLockFor(home, {
        pid: sleeper.pid,
        port,
        authority: `127.0.0.1:${port}`,
        startedAt: new Date().toISOString(),
        profile: DEFAULT_PROFILE,
        booting: true,
      })
      let joined: HostHandle | null = null
      const booting = ensureHost({
        dshHome: home,
        spawnDsh: runner.spawnDsh,
        mintCookie: (o) => `FakeCookie ${o.authority}`,
      }).then((h) => {
        joined = h
        return h
      })

      await sleep(400) // still waiting on the foreign claim…
      expect(runner.calls.length).toBe(0) // …never spawns its own host
      expect(joined).toBeNull()

      // the foreign boot completes: placeholder flips into a real lock
      writeLockFor(home, {
        pid: sleeper.pid,
        port,
        authority: `127.0.0.1:${port}`,
        startedAt: new Date().toISOString(),
        profile: DEFAULT_PROFILE,
      })
      const handle = await booting
      expect(runner.calls.length).toBe(0) // joined, not re-booted
      expect(handle.adopted).toBe(true)
      expect(handle.pid).toBe(sleeper.pid)
      expect(handle.port).toBe(port)
      expect(handle.refCount).toBe(1)
      await handle.dispose()
    } finally {
      server.close()
      sleeper.kill()
      rmSync(home, { recursive: true, force: true })
    }
  }, 20_000)

  test('booting pid dies mid-boot → waiter takes over cleanly and boots its own host', async () => {
    const home = makeHome()
    const runner = makeRunner()
    const sleeper = spawnSleeper()
    try {
      writeLockFor(home, {
        pid: sleeper.pid,
        port: 1,
        authority: '127.0.0.1:1',
        startedAt: new Date().toISOString(),
        profile: DEFAULT_PROFILE,
        booting: true,
      })
      const booting = ensureHost({
        dshHome: home,
        spawnDsh: runner.spawnDsh,
        mintCookie: (o) => `FakeCookie ${o.authority}`,
      })
      await sleep(300) // entered the wait…
      expect(runner.calls.length).toBe(0) // …without spawning
      sleeper.kill() // the foreign booter dies mid-boot

      await waitUntil(() => runner.calls.length === 1, 5_000) // takeover → we spawn
      runner.last.writeOut(readyLine(Number(runner.calls[0]!.argv[runner.calls[0]!.argv.indexOf('--port') + 1])))
      const handle = await booting
      expect(handle.adopted).toBe(false)
      expect(handle.pid).toBe(runner.last.pid)
      const lock = readLockFrom(home)
      expect(lock.booting).toBeUndefined() // a real lock replaced the placeholder
      expect(lock.pid).toBe(handle.pid)
      await handle.dispose()
    } finally {
      sleeper.kill()
      rmSync(home, { recursive: true, force: true })
    }
  }, 20_000)

  test('booting lock that never completes → join budget lapses → takeover boot (foreign pid untouched)', async () => {
    const home = makeHome()
    const runner = makeRunner()
    const sleeper = spawnSleeper()
    try {
      writeLockFor(home, {
        pid: sleeper.pid,
        port: 1,
        authority: '127.0.0.1:1',
        startedAt: new Date().toISOString(),
        profile: DEFAULT_PROFILE,
        booting: true,
      })
      const booting = ensureHost({
        dshHome: home,
        spawnDsh: runner.spawnDsh,
        mintCookie: (o) => `FakeCookie ${o.authority}`,
        bootJoinTimeoutMs: 400,
      })
      await waitUntil(() => runner.calls.length === 1, 5_000) // budget lapsed → takeover spawn
      runner.last.writeOut(readyLine(Number(runner.calls[0]!.argv[runner.calls[0]!.argv.indexOf('--port') + 1])))
      const handle = await booting
      expect(handle.adopted).toBe(false)
      expect(handle.pid).toBe(runner.last.pid)
      const lock = readLockFrom(home)
      expect(lock.booting).toBeUndefined()
      expect(lock.pid).toBe(handle.pid)
      expect(pidAlive(sleeper.pid)).toBe(true) // takeover never signals the foreign booter
    } finally {
      sleeper.kill()
      rmSync(home, { recursive: true, force: true })
    }
  }, 20_000)
})

describe('ensureHost — crash policy', () => {
  test('unexpected child death clears the lock; the next ensureHost respawns', async () => {
    const home = makeHome()
    const runner = makeRunner()
    try {
      const handle = await fakeBoot(runner, home, { idleExitSec: 0 })
      const firstPid = handle.pid
      runner.last.emitExit(137, 'SIGKILL')

      await waitUntil(() => !existsSync(lockPathOf(home)))
      expect(registeredFor(home)).toBe(false)

      const respawned = await fakeBoot(runner, home)
      expect(respawned.pid).not.toBe(firstPid)
      expect(runner.calls.length).toBe(2)
      await respawned.dispose()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('rapid respawn cap: 3 failed boots then HostRespawnLoopError, no more spawns', async () => {
    const home = makeHome()
    const runner = makeRunner()
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const booting = ensureHost({
          dshHome: home,
          spawnDsh: runner.spawnDsh,
          mintCookie: () => 'x',
        })
        await waitUntil(() => runner.children.length === attempt + 1)
        runner.children[attempt]!.emitExit(1, null)
        await rejectsWith(booting, HostDiedError)
      }
      expect(runner.calls.length).toBe(3)
      const err = await rejectsWith(
        ensureHost({ dshHome: home, spawnDsh: runner.spawnDsh, mintCookie: () => 'x' }),
        HostRespawnLoopError,
      )
      expect(err.attempts).toBe(3)
      expect(runner.calls.length).toBe(3) // the capped call never spawned
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Live smoke — the only test that runs the real `dsh` binary. Skips without a
// global dsh. Uses a scratch DSH_HOME, provisions the opentui profile via the
// real provision script, boots through ensureHost, mints a cookie, probes
// HTTP, disposes, and verifies nothing is left listening.
// ---------------------------------------------------------------------------

function hasGlobalDsh(): boolean {
  const which = spawnSync('which', ['dsh'], { encoding: 'utf8' })
  return which.status === 0 && Boolean(which.stdout.trim())
}

describe('live smoke (real dsh)', () => {
  test('provision → boot → cookie probe → dispose → no listener left', async () => {
    if (!hasGlobalDsh()) {
      console.log('live smoke skipped: no global dsh')
      return
    }
    const home = mkdtempSync(join(tmpdir(), 'dsh-lifecycle-live-'))
    const script = join(import.meta.dir, '..', 'scripts', 'provision-opentui-profile.mjs')
    try {
      // provision via the real script (twice — the second run must be a no-op)
      const first = Bun.spawnSync([process.execPath, script], {
        env: { ...process.env, DSH_HOME: home },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      expect(first.exitCode).toBe(0)
      expect(existsSync(join(home, 'profiles', DEFAULT_PROFILE))).toBe(true)
      const second = Bun.spawnSync([process.execPath, script], {
        env: { ...process.env, DSH_HOME: home },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      expect(second.exitCode).toBe(0)
      expect(second.stdout.toString()).toContain('already provisioned')

      // boot through ensureHost — real spawn, real mint when available
      let handle: HostHandle
      let fakeMintUsed = false
      try {
        handle = await ensureHost({
          dshHome: home,
          profile: DEFAULT_PROFILE,
          idleExitSec: 0, // resident during the smoke; disposed explicitly
          readinessTimeoutMs: 45_000,
          staleProbeMs: 2_000,
        })
      } catch (err) {
        if (!(err instanceof MintUnavailableError)) throw err
        // cookie-mint.ts not landed yet — validate the lifecycle with the fake
        fakeMintUsed = true
        console.log('live smoke: ./cookie-mint.ts missing — using an injected fake mint')
        handle = await ensureHost({
          dshHome: home,
          profile: DEFAULT_PROFILE,
          idleExitSec: 0,
          readinessTimeoutMs: 45_000,
          staleProbeMs: 2_000,
          mintCookie: (o) => `FakeCookie ${o.authority}`,
        })
      }

      expect(handle.pid).toBeGreaterThan(0)
      expect(handle.port).toBeGreaterThan(0)
      expect(existsSync(lockPathOf(home))).toBe(true)
      const lock = readLockFrom(home)
      expect(lock.pid).toBe(handle.pid)
      expect(lock.port).toBe(handle.port)

      // HTTP: the root is cookie-gated (client-connection README: a missing
      // cookie returns 401 on the index exchange). Only meaningful with the
      // real mint — a fake cookie obviously cannot authenticate.
      const rootUrl = `http://127.0.0.1:${handle.port}/`
      const anonymous = await fetch(rootUrl)
      console.log(`live smoke: GET / anonymous → ${anonymous.status}`)
      if (!fakeMintUsed) {
        expect(anonymous.status).toBe(401)
        const withCookie = await fetch(rootUrl, {
          headers: { cookie: handle.cookieHeader },
        })
        console.log(`live smoke: GET / with minted cookie → ${withCookie.status}`)
        expect(withCookie.status).not.toBe(401)
      } else {
        expect([401, 302, 403]).toContain(anonymous.status)
      }

      // dispose: lockfile gone, listener gone, child exited
      await handle.dispose()
      expect(existsSync(lockPathOf(home))).toBe(false)
      const deadline = Date.now() + 8_000
      let listenerGone = false
      while (Date.now() < deadline) {
        const probe = await new Promise<boolean>((resolve) => {
          const attempt = Bun.spawnSync(['lsof', '-nP', `-iTCP:${handle.port}`, '-sTCP:LISTEN'], {
            stdout: 'ignore',
            stderr: 'ignore',
          })
          resolve(attempt.exitCode !== 0)
        })
        if (probe) {
          listenerGone = true
          break
        }
        await sleep(250)
      }
      expect(listenerGone).toBe(true)
      console.log(`live smoke: PASS — booted pid ${handle.pid} on port ${handle.port}, disposed cleanly`)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 180_000)
})
