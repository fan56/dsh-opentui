/**
 * Unit tests for the inproc companion decision table (unfrozen step [4/8]).
 *
 * Pure: no network, no real profile, no process spawn. The policy module takes
 * its environment and registry answer as arguments; this file pins the
 * D2 default roster, the kill switch, the override list and the no-downgrade
 * / idempotence / breaking-version guards (major, plus minor in 0.x) that keep
 * a `latest` install safe.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFAULT_COMPANION_IDS } from '../scripts/lib/companion-policy.mjs'
import {
  COMPANIONS,
  COMPANIONS_ENV,
  COMPANION_LATEST_ENV,
  COMPANION_QUERY_CONCURRENCY,
  decideCompanionInstall,
  formatSkippedCompanionsWarning,
  normalizeVersion,
  queryDistTagLatest,
  queryDistTagLatestBatch,
  selectCompanions,
} from '../scripts/lib/inproc-companions.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/provision-inproc-profile.mjs', import.meta.url))
const scriptSrc = readFileSync(SCRIPT, 'utf8')

describe('inproc companion catalog', () => {
  test('policy IDs and default-on catalog IDs match exactly', () => {
    const catalogIds = COMPANIONS.map((entry) => entry.short)
    const defaultOnIds = COMPANIONS.filter((entry) => entry.defaultOn).map((entry) => entry.short)
    expect(DEFAULT_COMPANION_IDS).toHaveLength(11)
    expect(new Set(DEFAULT_COMPANION_IDS).size).toBe(DEFAULT_COMPANION_IDS.length)
    expect([...DEFAULT_COMPANION_IDS].sort()).toEqual([...defaultOnIds].sort())
    for (const id of DEFAULT_COMPANION_IDS) expect(catalogIds).toContain(id)
  })

  test('the eight former opt-ins plus topics-memory and cron are default-on', () => {
    for (const id of DEFAULT_COMPANION_IDS.filter((id) => id !== 'registry')) {
      expect(COMPANIONS.find((entry) => entry.short === id)?.defaultOn).toBe(true)
    }
    expect(COMPANIONS.find((entry) => entry.short === 'topics-memory')).toMatchObject({
      name: '@aiwayds/dsh-topics-memory',
      declaredRange: '^0.26.0',
    })
    expect(COMPANIONS.find((entry) => entry.short === 'cron')).toMatchObject({
      name: '@aiwayds/dsh-cron',
      declaredRange: '^0.7.0',
    })
  })

  test('catalog reasons do not contradict the D2 default decision', () => {
    for (const entry of COMPANIONS) {
      expect(entry.reason.length).toBeGreaterThan(20)
      expect(entry.reason).not.toMatch(/opt-in only|no consumer/i)
      expect(entry.declaredRange).toMatch(/^\^\d+\.\d+\.\d+$/)
    }
  })

  test('the two formerly stale 0.x minors now admit their verified npm latest', () => {
    expect(COMPANIONS.find((entry) => entry.short === 'ask-router')?.declaredRange).toBe('^0.8.0')
    expect(COMPANIONS.find((entry) => entry.short === 'model-sync')?.declaredRange).toBe('^0.11.0')
    // Guard semantics stay intact: the next 0.x minor is still rejected.
    for (const short of ['ask-router', 'model-sync']) {
      const entry = COMPANIONS.find((c) => c.short === short)!
      const [major, minor] = entry.declaredRange.slice(1).split('.').map(Number)
      expect(decideCompanionInstall({
        packageName: entry.name,
        declaredRange: entry.declaredRange,
        resolved: `0.${minor}.0`,
      }).action).toBe('install')
      expect(decideCompanionInstall({
        packageName: entry.name,
        declaredRange: entry.declaredRange,
        resolved: `0.${minor + 1}.0`,
      }).reason).toContain('cross_minor')
      expect(major).toBe(0)
    }
  })

  test('registry carries the use_agent justification and a breaking-version guard range', () => {
    const registry = COMPANIONS.find((entry) => entry.name === '@aiwayds/dsh-subagent-registry')
    expect(registry?.short).toBe('registry')
    expect(registry?.reason).toContain('use_agent')
    // The guard range must admit the shipped latest but stop the next 0.x minor.
    expect(registry?.declaredRange).toBe('^0.25.0')
  })
})

describe('companion selection + switch', () => {
  test('default selection is exactly the D2 policy roster in policy order', () => {
    const defaults = selectCompanions({}).map((entry) => entry.short)
    expect(defaults).toEqual(DEFAULT_COMPANION_IDS)
    expect(selectCompanions({ [COMPANIONS_ENV]: '' }).map((entry) => entry.short)).toEqual(DEFAULT_COMPANION_IDS)
    expect(defaults).toContain('registry')
    expect(defaults).not.toContain('workflow')
  })

  test('unset or truthy master switch enables; 0/false/off disables', () => {
    expect(selectCompanions({})).toHaveLength(11)
    expect(selectCompanions({ [COMPANION_LATEST_ENV]: '' })).toHaveLength(11)
    expect(selectCompanions({ [COMPANION_LATEST_ENV]: '1' })).toHaveLength(11)
    for (const value of ['0', 'false', 'OFF', ' off ']) {
      expect(selectCompanions({ [COMPANION_LATEST_ENV]: value })).toEqual([])
    }
  })

  test('DSH_OPENTUI_COMPANIONS override list replaces the default set; none/all are honoured', () => {
    expect(selectCompanions({ [COMPANIONS_ENV]: 'llm-stats' }).map((c) => c.short)).toEqual(['llm-stats'])
    expect(selectCompanions({ [COMPANIONS_ENV]: 'registry, llm-stats' }).map((c) => c.short)).toEqual(['registry', 'llm-stats'])
    expect(selectCompanions({ [COMPANIONS_ENV]: 'none' })).toEqual([])
    expect(selectCompanions({ [COMPANIONS_ENV]: 'all' }).map((c) => c.short)).toEqual(COMPANIONS.map((c) => c.short))
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

  test('model-sync guard admits 0.11.0 (fresh and 0.10.x upgrade) but stops 0.12.0', () => {
    const modelSync = { packageName: '@aiwayds/dsh-model-sync', declaredRange: '^0.11.0' }
    // Fresh home: nothing installed yet -> install the exact declared latest.
    expect(decideCompanionInstall({ ...modelSync, resolved: '0.11.0' })).toEqual({
      action: 'install', spec: '@aiwayds/dsh-model-sync@0.11.0', reason: 'latest',
    })
    // An existing 0.10.x pin upgrades to the admitted 0.11 minor.
    expect(decideCompanionInstall({ ...modelSync, resolved: '0.11.0', currentPin: '0.10.0' })).toEqual({
      action: 'install', spec: '@aiwayds/dsh-model-sync@0.11.0', reason: 'latest',
    })
    // Re-running on the admitted version is a no-op.
    expect(decideCompanionInstall({ ...modelSync, resolved: '0.11.0', currentPin: '0.11.0' }).reason).toBe('idempotent')
    // The next 0.x minor is still a breaking boundary and stays skipped.
    const cross = decideCompanionInstall({ ...modelSync, resolved: '0.12.0' })
    expect(cross.action).toBe('skip')
    expect(cross.reason).toContain('cross_minor')
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

describe('queryDistTagLatestBatch (bounded concurrency)', () => {
  test('runs queries concurrently up to the concurrency cap, returns input order', async () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    let active = 0
    let peak = 0
    const results = await queryDistTagLatestBatch(names, {
      concurrency: 4,
      budgetMs: 1000,
      query: async (name) => {
        active++
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active--
        return `1.0.0-${name}`
      },
    })
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(4)
    expect(COMPANION_QUERY_CONCURRENCY).toBe(4)
    // Completion order is deliberately the reverse of input order.
    expect(results).toEqual(names.map((name) => `1.0.0-${name}`))
  })

  test('a thrown query or a null answer becomes null; the batch never rejects', async () => {
    const results = await queryDistTagLatestBatch(['a', 'b', 'c', 'd', 'e'], {
      query: async (name) => {
        if (name === 'b') throw new Error('npm view timed out')
        if (name === 'd') return null
        return `0.2.0-${name}`
      },
    })
    expect(results).toEqual(['0.2.0-a', null, '0.2.0-c', null, '0.2.0-e'])
  })

  test('the total budget stops new lookups; unqueried items stay null', async () => {
    const called: string[] = []
    let tick = 0
    // Deadline = now() at entry (1) + 3 = 4. Worker checks at 2 and 3 start
    // the first two lookups; the checks at 4/5 are past the deadline.
    const results = await queryDistTagLatestBatch(['a', 'b', 'c', 'd'], {
      concurrency: 2,
      budgetMs: 3,
      now: () => ++tick,
      query: async (name) => { called.push(name); return name },
    })
    expect(called).toEqual(['a', 'b'])
    expect(results).toEqual(['a', 'b', null, null])
  })
})

describe('single aggregated skip summary', () => {
  test('null when nothing was skipped; one deterministic line otherwise', () => {
    expect(formatSkippedCompanionsWarning([])).toBeNull()
    expect(formatSkippedCompanionsWarning(['ask-router', 'model-sync'])).toBe(
      '2 companion(s) skipped (version query failed or outside declared range): ask-router, model-sync',
    )
    expect(formatSkippedCompanionsWarning(['b', 'a', 'c'])).toContain('b, a, c')
  })
})

describe('provision script wiring (source guards)', () => {
  test('companion step runs before verification and the verify step cross-checks declaration state', () => {
    expect(scriptSrc).toContain('const TOTAL_STEPS = 8')
    expect(scriptSrc).toContain('await provisionCompanions()')
    expect(scriptSrc).toContain('verifyCompanionState()')
    const installAt = scriptSrc.indexOf('  await provisionCompanions()')
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
