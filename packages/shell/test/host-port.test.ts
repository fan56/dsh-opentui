// Deterministic host port derivation (ADR-0009 decision 3).
// Pure logic only: no socket is bound and no host is started.
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  DEFAULT_PORT_BASE,
  DEFAULT_PORT_COUNT,
  NoFreePortError,
  canonicalHome,
  derivePort,
  findFreePort,
  fnv1a32,
} from '../src/client/host-port.ts'

const HOME = '/Users/qingguee/.dsh'
const PROFILE = 'opentui'

describe('fnv1a32', () => {
  test('matches the canonical FNV-1a offset basis for the empty string', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5)
  })

  test('unsigned 32-bit range', () => {
    for (const s of ['a', 'home:/x:opentui', '中文路径']) {
      const h = fnv1a32(s)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('derivePort', () => {
  test('deterministic across repeated calls for the same input', () => {
    const a = derivePort(HOME, PROFILE)
    const b = derivePort(HOME, PROFILE)
    const c = derivePort(HOME, PROFILE)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  test('stable across separate processes (no per-process seed / object hash)', () => {
    const src = join(import.meta.dir, '..', 'src', 'client', 'host-port.ts')
    const script = `import {derivePort} from ${JSON.stringify(src)}; console.log(derivePort(${JSON.stringify(HOME)}, ${JSON.stringify(PROFILE)}))`
    const result = Bun.spawnSync(['bun', '-e', script], { stdout: 'pipe', stderr: 'pipe' })
    expect(result.exitCode).toBe(0)
    expect(Number(result.stdout.toString().trim())).toBe(derivePort(HOME, PROFILE))
  })

  test('within the default [base, base + count) window', () => {
    for (const home of ['/a', '/b/c', '/tmp/some dsh home', HOME]) {
      for (const profile of ['opentui', 'web', 'tui']) {
        const port = derivePort(home, profile)
        expect(port).toBeGreaterThanOrEqual(DEFAULT_PORT_BASE)
        expect(port).toBeLessThan(DEFAULT_PORT_BASE + DEFAULT_PORT_COUNT)
      }
    }
  })

  test('honours custom base/count and stays in that window', () => {
    for (let i = 0; i < 50; i++) {
      const port = derivePort(HOME, PROFILE, { base: 40_000, count: 100 })
      expect(port).toBeGreaterThanOrEqual(40_000)
      expect(port).toBeLessThan(40_100)
    }
  })

  test('different (home, profile) pairs usually differ', () => {
    const a = derivePort('/home/a/.dsh', PROFILE)
    const b = derivePort('/home/b/.dsh', PROFILE)
    const c = derivePort('/home/a/.dsh', 'web')
    expect(new Set([a, b, c]).size).toBeGreaterThan(1)
  })

  test('canonicalHome normalises path text without touching the filesystem', () => {
    expect(canonicalHome('/a/b/../c')).toBe('/a/c')
    expect(canonicalHome('/a/b/')).toBe('/a/b')
  })

  test('rejects invalid window options', () => {
    expect(() => derivePort(HOME, PROFILE, { count: 0 })).toThrow(RangeError)
    expect(() => derivePort(HOME, PROFILE, { base: 1.5 })).toThrow(RangeError)
  })
})

describe('findFreePort', () => {
  test('returns the derived port when the probe says it is free', async () => {
    const derived = derivePort(HOME, PROFILE)
    const seen: number[] = []
    const port = await findFreePort(HOME, PROFILE, {
      probe: async (p) => {
        seen.push(p)
        return false // never occupied
      },
    })
    expect(port).toBe(derived)
    expect(seen).toEqual([derived])
  })

  test('walks [derived, derived + N) and returns the first free port', async () => {
    const derived = derivePort(HOME, PROFILE)
    const calls: number[] = []
    const port = await findFreePort(HOME, PROFILE, {
      probe: async (p) => {
        calls.push(p)
        return p < derived + 7 // first 7 occupied
      },
    })
    expect(port).toBe(derived + 7)
    expect(calls).toEqual(Array.from({ length: 8 }, (_, i) => derived + i))
  })

  test('never scans outside the window and throws when all ports are occupied', async () => {
    const derived = derivePort(HOME, PROFILE, { base: 40_000, count: 5 })
    const calls: number[] = []
    await expect(
      findFreePort(HOME, PROFILE, {
        base: 40_000,
        count: 5,
        probe: async (p) => {
          calls.push(p)
          return true
        },
      }),
    ).rejects.toBeInstanceOf(NoFreePortError)
    expect(calls).toEqual([derived, derived + 1, derived + 2, derived + 3, derived + 4])
  })
})
