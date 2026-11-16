// Boot/connect timeout env contracts + the injectable mux-readiness budget.
//
// Three millisecond budgets are resolved with the same precedence as the
// idle-exit window: explicit option > env override > default. Illegal values
// (NaN, non-integer, <= 0, empty) are ignored and fall through, never thrown.
// The final test proves the former module-level SERVE_PROBE_BUDGET_MS is now
// injectable: a tiny budget reaches HostNotServingError promptly.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_PROFILE,
  DEFAULT_READINESS_TIMEOUT_MS,
  DEFAULT_SERVE_PROBE_BUDGET_MS,
  ENV_BOOT_TIMEOUT_MS,
  ENV_CONNECT_TIMEOUT_MS,
  ENV_MUX_TIMEOUT_MS,
  HostNotServingError,
  ensureHost,
  resolveBootTimeoutMs,
  resolveConnectTimeoutMs,
  resolveMuxTimeoutMs,
  type HostChildProcess,
  type SpawnDsh,
} from '../src/client/lifecycle.ts'

const ALL_TIMEOUT_ENVS = [ENV_BOOT_TIMEOUT_MS, ENV_MUX_TIMEOUT_MS, ENV_CONNECT_TIMEOUT_MS]
const savedEnv = new Map<string, string | undefined>()

beforeEach(() => {
  for (const name of ALL_TIMEOUT_ENVS) {
    savedEnv.set(name, process.env[name])
    delete process.env[name]
  }
})

afterEach(() => {
  for (const name of ALL_TIMEOUT_ENVS) {
    const value = savedEnv.get(name)
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

interface Resolver {
  name: string
  env: string
  def: number
  fn: (explicitMs?: number) => number
}

const resolvers: Resolver[] = [
  {
    name: 'resolveBootTimeoutMs',
    env: ENV_BOOT_TIMEOUT_MS,
    def: DEFAULT_READINESS_TIMEOUT_MS,
    fn: resolveBootTimeoutMs,
  },
  {
    name: 'resolveMuxTimeoutMs',
    env: ENV_MUX_TIMEOUT_MS,
    def: DEFAULT_SERVE_PROBE_BUDGET_MS,
    fn: resolveMuxTimeoutMs,
  },
  {
    name: 'resolveConnectTimeoutMs',
    env: ENV_CONNECT_TIMEOUT_MS,
    def: DEFAULT_CONNECT_TIMEOUT_MS,
    fn: resolveConnectTimeoutMs,
  },
]

for (const r of resolvers) {
  describe(r.name, () => {
    test('explicit value wins over env and default', () => {
      process.env[r.env] = '1234'
      expect(r.fn(777)).toBe(777)
    })

    test('uses env value when no explicit value is given', () => {
      process.env[r.env] = '4321'
      expect(r.fn()).toBe(4321)
    })

    test('invalid env "abc" falls back to default', () => {
      process.env[r.env] = 'abc'
      expect(r.fn()).toBe(r.def)
    })

    test('invalid env "0" falls back to default', () => {
      process.env[r.env] = '0'
      expect(r.fn()).toBe(r.def)
    })

    test('invalid env "-5" falls back to default', () => {
      process.env[r.env] = '-5'
      expect(r.fn()).toBe(r.def)
    })

    test('empty env falls back to default', () => {
      process.env[r.env] = ''
      expect(r.fn()).toBe(r.def)
    })

    test('no env uses the default', () => {
      expect(r.fn()).toBe(r.def)
    })

    test('invalid explicit values fall back to default without throwing', () => {
      expect(r.fn(0)).toBe(r.def)
      expect(r.fn(-5)).toBe(r.def)
      expect(r.fn(Number.NaN)).toBe(r.def)
      expect(r.fn(1.5)).toBe(r.def) // non-integer
    })
  })
}

// --- Injectable mux-readiness budget ----------------------------------------

/** Fake child whose live pid keeps the serve-probe loop running until the
 * injected budget expires; kill() reports exit so terminateHost does not wait
 * out the real SIGTERM grace period. */
function makeFakeChild(pid: number): HostChildProcess {
  const exitCbs: ((code: number | null, signal: string | null) => void)[] = []
  let exited = false
  return {
    pid,
    exitCode: null,
    stdout: { on: () => ({}) },
    stderr: { on: () => ({}) },
    on(event: string, listener: (...args: any[]) => void) {
      if (event === 'exit') exitCbs.push(listener as (code: number | null, signal: string | null) => void)
      return this
    },
    kill() {
      if (!exited) {
        exited = true
        queueMicrotask(() => {
          for (const cb of exitCbs) cb(null, 'SIGTERM')
        })
      }
      return true
    },
    unref() {},
  } as unknown as HostChildProcess
}

describe('injectable serve-probe budget (former SERVE_PROBE_BUDGET_MS)', () => {
  test('a tiny mux budget reaches HostNotServingError promptly (no hang / no crash)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-boot-timeout-'))
    mkdirSync(join(home, 'profiles', DEFAULT_PROFILE), { recursive: true })
    // A real, live pid so pidAlive() stays true and the poll loop runs until
    // the injected deadline instead of bailing on the first iteration.
    const sleeper = Bun.spawn(['sleep', '120'], { stdout: 'ignore', stderr: 'ignore' })
    let server: Server | undefined

    const spawnDsh: SpawnDsh = (argv) => {
      const port = Number(argv[argv.indexOf('--port') + 1])
      // A plain HTTP server: readiness falls back to 'listener' (no URL line
      // on stdout), but the mux upgrade is never served — probeHostMux fails
      // on every attempt, exactly the "listening but never serving" case.
      server = createServer((_req, res) => {
        res.writeHead(200)
        res.end('ok')
      })
      void server.listen(port, '127.0.0.1')
      return makeFakeChild(sleeper.pid)
    }

    const startedAt = Date.now()
    let thrown: unknown
    try {
      await ensureHost({
        dshHome: home,
        spawnDsh,
        mintCookie: () => 'FakeCookie',
        serveProbeBudgetMs: 40,
        readinessTimeoutMs: 3_000,
      })
    } catch (err) {
      thrown = err
    }
    const elapsed = Date.now() - startedAt

    expect(thrown).toBeInstanceOf(HostNotServingError)
    const notServing = thrown as HostNotServingError
    expect(notServing.budgetMs).toBe(40)
    expect(notServing.message).toContain('40ms budget')
    // The tiny budget, not the 20s default or the 3s readiness budget, drove it.
    expect(elapsed).toBeLessThan(3_000)

    server?.close()
    sleeper.kill()
    rmSync(home, { recursive: true, force: true })
  })
})
