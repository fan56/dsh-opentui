/**
 * Unit tests for the inproc companion decision table (unfrozen step [4/8]).
 *
 * Pure: no network, no real profile, no process spawn. The policy module takes
 * its environment and registry answer as arguments; this file pins the
 * minimal-set decision, the kill switch, the opt-in list and the no-downgrade
 * / idempotence / breaking-version guards (major, plus minor in 0.x) that keep
 * a `latest` install safe.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  COMPANIONS,
  COMPANIONS_ENV,
  COMPANION_LATEST_ENV,
  decideCompanionInstall,
  normalizeVersion,
  queryDistTagLatest,
  selectCompanions,
} from '../scripts/lib/inproc-companions.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/provision-inproc-profile.mjs', import.meta.url))
const scriptSrc = readFileSync(SCRIPT, 'utf8')

describe('inproc companion catalog', () => {
  test('only the registry is default-on; every other candidate is explicitly justified and off', () => {
    const defaults = COMPANIONS.filter((entry) => entry.defaultOn)
    expect(defaults.map((entry) => entry.name)).toEqual(['@aiwayds/dsh-subagent-registry'])
    for (const entry of COMPANIONS.filter((c) => !c.defaultOn)) {
      expect(entry.reason.length).toBeGreaterThan(20)
      expect(entry.declaredRange).toMatch(/^\^\d+\.\d+\.\d+$/)
    }
  })

  test('registry carries the use_agent justification and a breaking-version guard range', () => {
    const registry = COMPANIONS.find((entry) => entry.name === '@aiwayds/dsh-subagent-registry')
    expect(registry?.short).toBe('registry')
    expect(registry?.reason).toContain('use_agent')
    // The guard range must admit the shipped latest but stop the next 0.x minor.
    expect(registry?.declaredRange).toBe('^0.21.0')
  })
})

describe('companion selection + switch', () => {
  test('unset or truthy master switch enables; 0/false/off disables', () => {
    expect(selectCompanions({})).toHaveLength(1)
    expect(selectCompanions({ [COMPANION_LATEST_ENV]: '' })).toHaveLength(1)
    expect(selectCompanions({ [COMPANION_LATEST_ENV]: '1' })).toHaveLength(1)
    for (const value of ['0', 'false', 'OFF', ' off ']) {
      expect(selectCompanions({ [COMPANION_LATEST_ENV]: value })).toEqual([])
    }
  })

  test('DSH_OPENTUI_COMPANIONS opt-in list replaces the default set; none/all are honoured', () => {
    expect(selectCompanions({ [COMPANIONS_ENV]: 'llm-stats' }).map((c) => c.short)).toEqual(['llm-stats'])
    expect(selectCompanions({ [COMPANIONS_ENV]: 'registry, llm-stats' }).map((c) => c.short)).toEqual(['registry', 'llm-stats'])
    expect(selectCompanions({ [COMPANIONS_ENV]: 'none' })).toEqual([])
    expect(selectCompanions({ [COMPANIONS_ENV]: 'all' })).toHaveLength(COMPANIONS.length)
    // Full package names are accepted too.
    expect(selectCompanions({ [COMPANIONS_ENV]: '@aiwayds/dsh-vault' }).map((c) => c.short)).toEqual(['vault'])
  })

  test('master off wins over the opt-in list', () => {
    expect(selectCompanions({
      [COMPANION_LATEST_ENV]: 'off',
      [COMPANIONS_ENV]: 'all',
    })).toEqual([])
  })
})

describe('decideCompanionInstall', () => {
  const base = { packageName: '@aiwayds/dsh-subagent-registry', declaredRange: '^0.21.0' }

  test('exact latest pin becomes one exact spec; v-prefix normalises', () => {
    expect(decideCompanionInstall({ ...base, resolved: 'v0.21.0' })).toEqual({
      action: 'install', spec: '@aiwayds/dsh-subagent-registry@0.21.0', reason: 'latest',
    })
    expect(normalizeVersion('  v0.21.0  ')).toBe('0.21.0')
  })

  test('same version is idempotent and a newer pin is never downgraded', () => {
    expect(decideCompanionInstall({ ...base, resolved: '0.21.0', currentPin: '0.21.0' }).action).toBe('skip')
    expect(decideCompanionInstall({ ...base, resolved: '0.21.0', currentPin: '0.21.0' }).reason).toBe('idempotent')
    const downgrade = decideCompanionInstall({ ...base, resolved: '0.21.0', currentPin: '0.21.1' })
    expect(downgrade.action).toBe('skip')
    expect(downgrade.reason).toContain('downgrade')
  })

  test('a cross-major latest is skipped, not installed', () => {
    const cross = decideCompanionInstall({ ...base, resolved: '1.0.0' })
    expect(cross.action).toBe('skip')
    expect(cross.reason).toContain('cross_major')
  })

  test('0.x minor bumps are breaking: a newer minor is skipped, same minor is allowed', () => {
    const cross = decideCompanionInstall({ ...base, resolved: '0.22.0' })
    expect(cross.action).toBe('skip')
    expect(cross.reason).toContain('cross_minor')
    const sameMinor = decideCompanionInstall({ ...base, resolved: '0.21.9' })
    expect(sameMinor).toEqual({
      action: 'install', spec: '@aiwayds/dsh-subagent-registry@0.21.9', reason: 'latest',
    })
  })

  test('at 1.x the guard stays major-only (minor jumps are allowed)', () => {
    const pkg = { packageName: 'pkg', declaredRange: '^1.2.0' }
    expect(decideCompanionInstall({ ...pkg, resolved: '1.9.3' }).action).toBe('install')
    const cross = decideCompanionInstall({ ...pkg, resolved: '2.0.0' })
    expect(cross.action).toBe('skip')
    expect(cross.reason).toContain('cross_major')
  })

  test('unresolved registry answer: install @latest on a fresh profile, keep an existing pin offline', () => {
    expect(decideCompanionInstall({ ...base, resolved: null })).toEqual({
      action: 'install', spec: '@aiwayds/dsh-subagent-registry@latest', reason: 'unresolved',
    })
    expect(decideCompanionInstall({ ...base, resolved: null, currentPin: '0.21.0' })).toEqual({
      action: 'skip', spec: null, reason: 'unresolved',
    })
  })
})

describe('queryDistTagLatest', () => {
  test('reads dist-tags.latest through an injected executor', () => {
    const calls: unknown[][] = []
    const result = queryDistTagLatest('@aiwayds/dsh-subagent-registry', {
      cwd: '/tmp/any',
      env: { A: '1' },
      exec: (...args: unknown[]) => { calls.push(args); return '{"latest":"v0.21.0"}' },
    })
    expect(result).toBe('0.21.0')
    expect(calls[0][0]).toBe('npm')
    expect(calls[0][2]).toMatchObject({ cwd: '/tmp/any', env: { A: '1' } })
  })

  test('any query failure degrades to null (caller then uses the @latest fallback)', () => {
    expect(queryDistTagLatest('x', { exec: () => { throw new Error('offline') } })).toBeNull()
    expect(queryDistTagLatest('x', { exec: () => 'not json' })).toBeNull()
    expect(queryDistTagLatest('x', { exec: () => '{}' })).toBeNull()
  })
})

describe('provision script wiring (source guards)', () => {
  test('companion step runs before verification and the verify step cross-checks declaration state', () => {
    expect(scriptSrc).toContain('const TOTAL_STEPS = 7')
    expect(scriptSrc).toContain('provisionCompanions()')
    expect(scriptSrc).toContain('verifyCompanionState()')
    const installAt = scriptSrc.indexOf('  provisionCompanions()')
    const verifyAt = scriptSrc.indexOf('  const companionCount = verifyCompanionState()')
    expect(installAt).toBeGreaterThan(-1)
    expect(verifyAt).toBeGreaterThan(installAt)
  })

  test('the kill switch and opt-in env names are the documented ones', () => {
    expect(scriptSrc).toContain(COMPANION_LATEST_ENV)
    expect(COMPANION_LATEST_ENV).toBe('DSH_OPENTUI_COMPANION_LATEST')
  })

  test('manifest convergence preserves already-declared companion bundles', () => {
    expect(scriptSrc).toContain('const managedBundles = (existing) =>')
    expect(scriptSrc).toContain('bundles: managedBundles(existing)')
  })
})
