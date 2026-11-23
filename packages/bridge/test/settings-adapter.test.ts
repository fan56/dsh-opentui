/**
 * B1 S1/S2 — inproc host settings adapter unit tests.
 *
 * Drives the REAL `createCapHostInvoke` settings arm with a synthetic host
 * `ctx.settings` service (no real dsh-settings / host package is installed in
 * this repo). Covers the three states from the preregistered expected:
 *   E1 present  — host service used, field-level namespace projection, secret
 *                 values dropped, mutate forwarded verbatim;
 *   E2 absent   — existing absence error text unchanged, no client-seam change;
 *   E3 throw    — host error propagates unchanged, no new "unavailable" text.
 * Plus controller-priority and method-missing regression guards.
 *
 * All fixtures are synthetic; no real secret value or host service is touched.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { createCapHostInvoke } from '../src/index'
import type { CapMethodId } from '../../../capcontract/types'

const DESC = '@deepseek-ai/dsh-api-settings-controller#settings/describe' as CapMethodId
const MUTATE = '@deepseek-ai/dsh-api-settings-controller#settings/mutate' as CapMethodId

/** ctx stub exposing settingsController / settings via ctx.get (same seam as prod). */
function ctxWith(services: { controller?: unknown; settings?: unknown }): never {
  return {
    get: (key: string) => {
      if (key === 'settingsController') return services.controller
      if (key === 'settings') return services.settings
      return undefined
    },
  } as never
}

const RAW_NS = {
  ns: 'subagent',
  revision: 7,
  schema: { type: 'object' },
  value: { maxActiveSubagents: 5 },
  base: { maxActiveSubagents: 8 },
  user: { maxActiveSubagents: 5 },
  applies: ['maxActiveSubagents'],
  secrets: [{ path: 'apiKey', set: true, value: 'LEAK_ME_SENTINEL' }],
  extraNotAllowed: 'DROP_ME',
}

const PROJECTED_NS = {
  ns: 'subagent',
  revision: 7,
  schema: { type: 'object' },
  value: { maxActiveSubagents: 5 },
  base: { maxActiveSubagents: 8 },
  user: { maxActiveSubagents: 5 },
  applies: ['maxActiveSubagents'],
  secrets: [{ path: 'apiKey', set: true }],
}

describe('B1 S1 — E1 present: host settings service resolves through the arm', () => {
  test('settings.describe calls host.describe({redactSecrets:true}) and projects the fixed field set', async () => {
    let describeCalls = 0
    let seenOpts: unknown
    const host = {
      writable: true,
      describe: async (opts: unknown) => {
        describeCalls++
        seenOpts = opts
        return { namespaces: [RAW_NS] }
      },
    }
    const out = await createCapHostInvoke(ctxWith({ settings: host }))(DESC, 'unary', {}) as {
      writable: boolean
      hasDocument: boolean
      namespaces: Record<string, unknown>[]
    }
    expect(describeCalls).toBe(1)
    expect(seenOpts).toEqual({ redactSecrets: true })
    expect(out.writable).toBe(true)
    expect(out.hasDocument).toBe(true)
    expect(out.namespaces).toHaveLength(1)
    expect(out.namespaces[0]).toEqual(PROJECTED_NS)
    // field-level allow-list: no secret VALUE and no stray field survives
    expect(JSON.stringify(out)).not.toContain('LEAK_ME_SENTINEL')
    expect(JSON.stringify(out)).not.toContain('DROP_ME')
    expect(Object.keys(out.namespaces[0]).sort()).toEqual(Object.keys(PROJECTED_NS).sort())
  })

  test('settings.mutate forwards ns/ops/expectedRevision to the host verbatim', async () => {
    const seen: unknown[] = []
    const host = {
      mutate: async (ns: string, ops: unknown[], expectedRevision?: number) => {
        seen.push([ns, ops, expectedRevision])
        return { revision: 8 }
      },
    }
    const ops = [{ op: 'set', path: ['maxActiveSubagents'], value: 5 }]
    const out = await createCapHostInvoke(ctxWith({ settings: host }))(
      MUTATE, 'unary', { ns: 'subagent', ops, expectedRevision: 7 },
    )
    expect(seen).toEqual([['subagent', ops, 7]])
    expect(out).toEqual({ revision: 8 })
  })

  test('host describe accepting a bare namespace array is tolerated', async () => {
    const host = { describe: async () => [RAW_NS] }
    const out = await createCapHostInvoke(ctxWith({ settings: host }))(DESC, 'unary', {}) as {
      namespaces: Record<string, unknown>[]
    }
    expect(out.namespaces[0]).toEqual(PROJECTED_NS)
  })
})

describe('B1 S1 — E2 absent: existing absence path unchanged', () => {
  test('no controller and no host settings -> existing error text, verbatim', async () => {
    const invoke = createCapHostInvoke(ctxWith({}))
    await expect(invoke(DESC, 'unary', {})).rejects.toThrow(
      'NOT_WIRED: settingsController unavailable',
    )
    await expect(invoke(MUTATE, 'unary', { ns: 'subagent', ops: [] })).rejects.toThrow(
      'NOT_WIRED: settingsController unavailable',
    )
  })

  test('adapter source introduces no NOT_WIRED text literal (capcontract #16 text-union)', () => {
    const src = readFileSync(new URL('../src/settings-adapter.ts', import.meta.url), 'utf8')
    expect(src.includes('NOT_WIRED')).toBe(false)
  })
})

describe('B1 S1 — E3 throw: host error propagates unchanged', () => {
  test('describe throw surfaces the original error, not a rewritten/unavailable message', async () => {
    const original = new Error('dsh-config-editor: overridden by a home patch')
    const host = { describe: async () => { throw original } }
    let caught: unknown
    try {
      await createCapHostInvoke(ctxWith({ settings: host }))(DESC, 'unary', {})
    } catch (err) { caught = err }
    expect(caught).toBe(original)
    expect((caught as Error).message).toBe('dsh-config-editor: overridden by a home patch')
  })

  test('mutate throw surfaces the original error (conflict/home-patch semantics preserved)', async () => {
    const conflict = new Error('settings mutation failed')
    Object.assign(conflict, { code: 'SETTINGS_CONFLICT' })
    const host = { mutate: async () => { throw conflict } }
    let caught: unknown
    try {
      await createCapHostInvoke(ctxWith({ settings: host }))(
        MUTATE, 'unary', { ns: 'subagent', ops: [] },
      )
    } catch (err) { caught = err }
    expect(caught).toBe(conflict)
    expect((caught as { code?: string }).code).toBe('SETTINGS_CONFLICT')
  })

  test('host present but method missing -> descriptive HOST_UNAVAILABLE, not an unavailable text mapping', async () => {
    const host = { writable: true } // no describe/mutate
    let caught: unknown
    try {
      await createCapHostInvoke(ctxWith({ settings: host }))(DESC, 'unary', {})
    } catch (err) { caught = err }
    expect((caught as Error).message).toContain('HOST_UNAVAILABLE: settings.describe')
    expect((caught as Error).message).not.toContain('NOT_WIRED')
  })
})

describe('B1 S2 — resolver seam: controller keeps priority', () => {
  test('real controller present -> it is used, host settings never touched', async () => {
    let hostTouched = false
    const controller = {
      describe: async () => ({ writable: false, hasDocument: true, namespaces: [{ ns: 'controller-ns' }] }),
    }
    const settings = {
      describe: async () => { hostTouched = true; return { namespaces: [] } },
    }
    const out = await createCapHostInvoke(ctxWith({ controller, settings }))(DESC, 'unary', {}) as {
      namespaces: { ns: string }[]
    }
    expect(hostTouched).toBe(false)
    expect(out.namespaces[0].ns).toBe('controller-ns')
  })

  test('throwing ctx.get falls back to the absence path (no crash)', async () => {
    const ctx = {
      get: () => { throw new Error('ctx.get unavailable') },
    } as never
    await expect(createCapHostInvoke(ctx)(DESC, 'unary', {})).rejects.toThrow(
      'NOT_WIRED: settingsController unavailable',
    )
  })
})
