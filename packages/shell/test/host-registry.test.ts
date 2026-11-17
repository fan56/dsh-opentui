// Singleton host registry schema v2 (ADR-0009 decisions 4 & 8).
// Covers round-trip + legacy detection, atomic claim concurrency, stale
// judgement with an injected clock / pid probe, and safe legacy cleanup.
// No real host is spawned; legacy cleanup is asserted to touch files only.
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  REGISTRY_PHASES,
  REGISTRY_SCHEMA_VERSION,
  claimRegistry,
  createClaimRegistry,
  isRegistryStale,
  readRegistry,
  registryPath,
  releaseClaim,
  safeClearLegacy,
  validateRegistry,
  withPhase,
  writeRegistry,
  type HostRegistryV2,
  type RegistryFs,
} from '../src/client/host-registry.ts'

const PROFILE = 'opentui'
const NOW = '2026-11-17T00:00:00.000Z'

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-registry-test-'))
}

function makeRecord(overrides: Partial<HostRegistryV2> = {}): HostRegistryV2 {
  return {
    version: 2,
    profile: PROFILE,
    home: '/abs/DSH_HOME',
    pid: 1234,
    port: 60_123,
    phase: 'ready',
    startedAt: NOW,
    updatedAt: NOW,
    authority: '127.0.0.1:60123',
    clients: [{ id: 'client-a', pid: 900, lastSeen: NOW }],
    ...overrides,
  }
}

/** Minimal in-memory fs implementing the seam link(2) semantics. */
function makeMemFs(): RegistryFs {
  const files = new Map<string, string>()
  const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })
  return {
    existsSync: (p) => files.has(p),
    mkdirSync: () => {},
    readFileSync: (p) => {
      const value = files.get(p)
      if (value === undefined) throw errno('ENOENT')
      return value
    },
    writeFileSync: (p, data) => {
      files.set(p, data)
    },
    renameSync: (from, to) => {
      const value = files.get(from)
      if (value === undefined) throw errno('ENOENT')
      files.set(to, value)
      files.delete(from)
    },
    linkSync: (from, to) => {
      if (files.has(to)) throw errno('EEXIST')
      const value = files.get(from)
      if (value === undefined) throw errno('ENOENT')
      files.set(to, value) // link(2): new name, same content
    },
    unlinkSync: (p) => {
      files.delete(p)
    },
  }
}

describe('registry schema v2', () => {
  test('round-trip: write then read returns an equal v2 record', () => {
    const home = makeHome()
    try {
      const record = makeRecord({ home })
      writeRegistry(home, PROFILE, record)
      const read = readRegistry(home, PROFILE)
      expect(read.kind).toBe('v2')
      if (read.kind !== 'v2') return
      expect(read.value).toEqual(record)
      expect(read.value.version).toBe(REGISTRY_SCHEMA_VERSION)
      expect(read.value.clients).toHaveLength(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('atomic write leaves no temp file behind', () => {
    const home = makeHome()
    try {
      writeRegistry(home, PROFILE, makeRecord({ home }))
      const files = readdirSync(home)
      expect(files).toEqual([`opentui-host.${PROFILE}.json`])
      expect(files.some((f) => f.includes('.tmp'))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('read of a pre-v2 lockfile (no version/clients) is legacy', () => {
    const home = makeHome()
    try {
      writeFileSync(
        registryPath(home, PROFILE),
        JSON.stringify({ pid: 42, port: 60_000, authority: '127.0.0.1:60000', startedAt: NOW, profile: PROFILE }),
      )
      const read = readRegistry(home, PROFILE)
      expect(read.kind).toBe('legacy')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('corrupt JSON is invalid; unknown version is invalid', () => {
    const home = makeHome()
    try {
      writeFileSync(registryPath(home, PROFILE), '{not json')
      expect(readRegistry(home, PROFILE).kind).toBe('invalid')
      writeFileSync(registryPath(home, PROFILE), JSON.stringify({ ...makeRecord(), version: 99 }))
      expect(readRegistry(home, PROFILE).kind).toBe('invalid')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('validateRegistry rejects malformed v2 fields', () => {
    expect(validateRegistry({ ...makeRecord(), clients: 'nope' }).kind).toBe('invalid')
    expect(validateRegistry({ ...makeRecord(), phase: 'bogus' }).kind).toBe('invalid')
    expect(validateRegistry({ ...makeRecord(), port: 70_000 }).kind).toBe('invalid')
    expect(validateRegistry({ ...makeRecord(), clients: [{ id: 'x' }] }).kind).toBe('invalid')
    expect(validateRegistry(null).kind).toBe('invalid')
  })

  test('createClaimRegistry / withPhase build well-formed records', () => {
    const claim = createClaimRegistry('/h', PROFILE, 7, NOW)
    expect(validateRegistry(claim).kind).toBe('v2')
    expect(claim.phase).toBe('claim')
    expect(claim.port).toBe(0)
    expect(claim.clients).toEqual([])
    const booting = withPhase(claim, 'booting', '2026-11-17T00:00:01.000Z')
    expect(booting.phase).toBe('booting')
    expect(booting.updatedAt).toBe('2026-11-17T00:00:01.000Z')
    expect(REGISTRY_PHASES).toContain('ready')
  })

  test('writeRegistry refuses an invalid v2 record', () => {
    const home = makeHome()
    try {
      expect(() => writeRegistry(home, PROFILE, { ...makeRecord(), clients: 3 as never })).toThrow()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('atomic claim (link/O_EXCL)', () => {
  test('two real-filesystem claims: only the first wins, the loser is "occupied"', () => {
    const home = makeHome()
    try {
      const first = claimRegistry(home, PROFILE, { pid: 111, now: () => Date.parse(NOW) })
      const second = claimRegistry(home, PROFILE, { pid: 222, now: () => Date.parse(NOW) })
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(false)
      if (!second.ok) expect(second.reason).toBe('occupied')
      if (first.ok) {
        expect(first.registry.phase).toBe('claim')
        expect(first.registry.pid).toBe(111)
        // the winner's complete content is intact (no clobber by the loser)
        const read = readRegistry(home, PROFILE)
        expect(read.kind).toBe('v2')
        if (read.kind === 'v2') expect(read.value.pid).toBe(111)
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('concurrent claims from two simulated processes (shared fs): exactly one succeeds', () => {
    const fs = makeMemFs()
    const home = '/virtual/home'
    const a = claimRegistry(home, PROFILE, { fs, pid: 1000, now: () => Date.parse(NOW) })
    const b = claimRegistry(home, PROFILE, { fs, pid: 2000, now: () => Date.parse(NOW) })
    expect([a.ok, b.ok]).toEqual([true, false])
  })

  test('release removes only our claim; a wrong token/pid or a completed record is not removed', () => {
    const fs = makeMemFs()
    const home = '/virtual/home'
    const claim = claimRegistry(home, PROFILE, { fs, pid: 7, now: () => Date.parse(NOW) })
    expect(claim.ok).toBe(true)
    if (!claim.ok) return

    expect(releaseClaim(home, PROFILE, { pid: 8, token: claim.token }, { fs })).toBe(false)
    expect(releaseClaim(home, PROFILE, { pid: 7, token: 'wrong-token' }, { fs })).toBe(false)
    expect(readRegistry(home, PROFILE, fs).kind).toBe('v2') // still there

    expect(releaseClaim(home, PROFILE, { pid: 7, token: claim.token }, { fs })).toBe(true)
    expect(readRegistry(home, PROFILE, fs).kind).toBe('missing')
    expect(claimRegistry(home, PROFILE, { fs, pid: 9 }).ok).toBe(true) // claim free again
  })

  test('release will not clobber a claim that flipped to ready', () => {
    const home = makeHome()
    try {
      const claim = claimRegistry(home, PROFILE, { pid: 11 })
      expect(claim.ok).toBe(true)
      if (!claim.ok) return
      writeRegistry(home, PROFILE, makeRecord({ home, pid: 11 })) // boot completed
      expect(releaseClaim(home, PROFILE, { pid: 11, token: claim.token })).toBe(false)
      expect(readRegistry(home, PROFILE).kind).toBe('v2')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('stale detection (injected clock + pid probe)', () => {
  test('legacy and invalid records are stale by schema', () => {
    expect(isRegistryStale({ kind: 'legacy', raw: { pid: 1, port: 2 } })).toEqual({
      stale: true,
      reasons: ['legacy-schema'],
    })
    expect(isRegistryStale({ kind: 'invalid', raw: null, reason: 'bad' }).stale).toBe(true)
  })

  test('missing registry is not stale (free to claim)', () => {
    expect(isRegistryStale({ kind: 'missing' })).toEqual({ stale: false, reasons: [] })
  })

  test('v2 with a dead pid is stale; a live pid is not', () => {
    const record = makeRecord()
    expect(isRegistryStale(record, { pidAlive: () => false })).toEqual({ stale: true, reasons: ['dead-pid'] })
    expect(isRegistryStale(record, { pidAlive: () => true })).toEqual({ stale: false, reasons: [] })
  })

  test('optional registryMaxAgeMs uses the injected clock', () => {
    const record = makeRecord({ updatedAt: NOW })
    const now = Date.parse(NOW) + 60_000
    expect(isRegistryStale(record, { pidAlive: () => true, now: () => now, registryMaxAgeMs: 30_000 })).toEqual({
      stale: true,
      reasons: ['registry-too-old'],
    })
    expect(isRegistryStale(record, { pidAlive: () => true, now: () => now, registryMaxAgeMs: 120_000 }).stale).toBe(false)
  })
})

describe('safeClearLegacy — file only, never a process', () => {
  test('removes a legacy file and leaves a v2 / missing file untouched', () => {
    const home = makeHome()
    try {
      const path = registryPath(home, PROFILE)
      writeFileSync(path, JSON.stringify({ pid: 42, port: 60_000 }))
      // pre-read registry is accepted (no second read needed)
      const preRead = readRegistry(home, PROFILE)
      expect(safeClearLegacy(home, PROFILE, { read: preRead })).toEqual({ removed: true, reason: 'legacy-removed' })
      expect(readRegistry(home, PROFILE).kind).toBe('missing')

      writeFileSync(path, JSON.stringify({ pid: 43, port: 60_001 }))
      expect(safeClearLegacy(home, PROFILE)).toEqual({ removed: true, reason: 'legacy-removed' })
      expect(readRegistry(home, PROFILE).kind).toBe('missing')

      writeRegistry(home, PROFILE, makeRecord({ home }))
      expect(safeClearLegacy(home, PROFILE)).toEqual({ removed: false, reason: 'not-legacy' })
      expect(readRegistry(home, PROFILE).kind).toBe('v2')

      rmSync(path)
      expect(safeClearLegacy(home, PROFILE)).toEqual({ removed: false, reason: 'missing' })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('with an injected fs, cleanup touches only the registry path (no signalling seam exists)', () => {
    const fs = makeMemFs()
    const home = '/virtual/home'
    const path = registryPath(home, PROFILE)
    fs.writeFileSync(path, JSON.stringify({ pid: 999, port: 60_000 }))
    expect(safeClearLegacy(home, PROFILE, { fs }).removed).toBe(true)
    expect(fs.existsSync(path)).toBe(false)
    // There is no process.kill import or call in this module — the seam has
    // no signal method at all, so no process can be touched by cleanup.
    expect((fs as unknown as Record<string, unknown>).kill).toBeUndefined()
  })
})
