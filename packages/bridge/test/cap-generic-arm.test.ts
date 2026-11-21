/**
 * 025 wave2 W2-0d — generic arm unit tests (plan §6.1 W2-0d / §6.2 E2–E5,
 * AMEND-1/2, S1). All fixtures are synthetic: no real service is contacted,
 * no real credential value appears anywhere (SENTINEL is a fixed fake string).
 *
 * The arm is DORMANT in W2-0 (CAP_GENERIC_ADAPTERS is empty), so these tests
 * inject small table fixtures into the exported helpers instead of mutating
 * any frozen generated table. That is exactly how the R3 positional-order
 * single point of failure is forced into the open.
 */
import { describe, expect, test } from 'bun:test'
import type { CapParamRow } from '../../../capcontract/types'
import {
  CAP_GENERIC_ADAPTERS,
  CAP_GENERIC_WIRE_METHODS,
  CAP_PROJECTED_BY_HAND,
} from '../../../capcontract/types'
import {
  capIdNamespace,
  invokeGenericCap,
  projectGenericWireReply,
  resolveGenericWireMethod,
  type GenericCapConfig,
} from '../src/cap-generic'
import {
  CAP_HOST_WIRED_IDS,
  createCapHostInvoke,
  GENERIC_DENY_NAMESPACES,
  inject,
  sanitizeFrameForWire,
} from '../src/index'
import type { BridgeContext } from '../src/index'

const RUN_ID = '@probe/pkg#probe/run'
const OPT_ID = '@probe/pkg#probe/optional'
const BAD_ID = '@probe/pkg#probe/validate'
const STREAM_ID = '@probe/pkg#probe/stream'
const GENERIC_ID = '@probe/pkg#probe/generic'
const GHOST_ID = '@probe/pkg#probe/ghost'

const ACCOUNT_DENIED_ID = '@deepseek-ai/dsh-deepseek-account#account/getState'
const CREDENTIALS_DENIED_ID = '@deepseek-ai/dsh-api-settings-controller#credentials/set'
const SETTINGS_DENIED_ID = '@deepseek-ai/dsh-api-settings-controller#settings/mutate'
const PROJECTED_ID = '@deepseek-ai/dsh-llm#llm/discoverModels'
const NON_PROJECTED_ID = '@probe/pkg#probe/plain'

const SENTINEL = 'W2D_SENTINEL_synthetic_no_real_credential'

function makeConfig(overrides: Partial<GenericCapConfig> = {}): GenericCapConfig {
  return {
    adapters: new Set<string>(),
    services: {},
    params: {},
    projectedByHand: new Set<string>(),
    denyNamespaces: GENERIC_DENY_NAMESPACES,
    kindOf: () => 'unary',
    getService: () => undefined,
    ...overrides,
  }
}

/** Capture a rejection message (bun's toThrow cannot assert several substrings cleanly). */
async function rejectionMessage(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  throw new Error('expected rejection but call resolved')
}

describe('W2-0d generic arm — table-driven dispatch (dormant at base)', () => {
  // E4 core: positional reconstruction fidelity. This is the R3 silent-misplacement
  // guard: named params are read BY TABLE ORDER into positional args, values and
  // nested object identity preserved, object key order in the input is irrelevant.
  test('E4 multi-param full: named->positional mapping + nested object value (full id in call)', async () => {
    const received: unknown[][] = []
    const svc = {
      run(...args: unknown[]) { received.push(args); return { ok: true } },
    }
    const rows: readonly CapParamRow[] = [
      { name: 'spec', required: true, type: 'string' },
      { name: 'options', required: true, type: 'object' },
      { name: 'flag', required: true, type: 'boolean' },
      { name: 'retries', required: true, type: 'number' },
    ]
    const config = makeConfig({
      adapters: new Set([RUN_ID]),
      services: { [RUN_ID]: { service: 'probeSvc', implementation: 'run' } },
      params: { [RUN_ID]: rows },
      getService: (name) => (name === 'probeSvc' ? svc : undefined),
    })
    const nested = { depth: { enabled: true, tags: ['alpha', 'beta'] } }
    const out = await invokeGenericCap(config, RUN_ID, 'unary', {
      retries: 3,
      flag: true,
      spec: 'spec-value',
      options: nested,
    })
    expect(out).toEqual({ ok: true })
    expect(received).toEqual([['spec-value', nested, true, 3]])
    // value identity is preserved (no cloning / rewriting of the nested object)
    expect(received[0]![1]).toBe(nested)
    expect(capIdNamespace(RUN_ID)).toBe('probe')
  })

  // E4 core: omitted optional param MUST leave a slot, not shift the next param.
  test('E4 optional omission: dense positional array keeps later indices aligned', async () => {
    const received: unknown[][] = []
    const svc = {
      optional(...args: unknown[]) { received.push(args); return 'done' },
    }
    const rows: readonly CapParamRow[] = [
      { name: 'a', required: true, type: 'string' },
      { name: 'b', required: false, type: 'string' },
      { name: 'c', required: true, type: 'number' },
      { name: 'd', required: false, type: 'boolean' },
    ]
    const config = makeConfig({
      adapters: new Set([OPT_ID]),
      services: { [OPT_ID]: { service: 'probeSvc', implementation: 'optional' } },
      params: { [OPT_ID]: rows },
      getService: () => svc,
    })
    expect(await invokeGenericCap(config, OPT_ID, 'unary', { a: 'A', c: 7 })).toBe('done')
    expect(received[0]).toEqual(['A', undefined, 7, undefined])
    await invokeGenericCap(config, OPT_ID, 'unary', { a: 'A', b: 'B', c: 7 })
    expect(received[1]).toEqual(['A', 'B', 7, undefined])
  })

  // E2: three BAD_PARAMS modes, each message carries the FULL CapIR id.
  test('E2 BAD_PARAMS negatives: required missing / coarse type wrong / enum outside', async () => {
    const rows: readonly CapParamRow[] = [
      { name: 'id', required: true, type: 'string' },
      { name: 'mode', required: true, type: 'string', enum: ['fast', 'slow'] },
      { name: 'count', required: true, type: 'number' },
    ]
    let hostCalls = 0
    const config = makeConfig({
      adapters: new Set([BAD_ID]),
      services: { [BAD_ID]: { service: 'probeSvc', implementation: 'validate' } },
      params: { [BAD_ID]: rows },
      getService: () => ({ validate: () => { hostCalls++; return 'never' } }),
    })

    const missing = await rejectionMessage(() => invokeGenericCap(config, BAD_ID, 'unary', { mode: 'fast', count: 1 }))
    expect(missing).toContain('BAD_PARAMS')
    expect(missing).toContain(BAD_ID)
    expect(missing).toContain('id required')

    const wrongType = await rejectionMessage(() => invokeGenericCap(config, BAD_ID, 'unary', {
      id: 'x', mode: 'fast', count: 'three',
    }))
    expect(wrongType).toContain('BAD_PARAMS')
    expect(wrongType).toContain(BAD_ID)
    expect(wrongType).toContain('count must be number')

    const enumOut = await rejectionMessage(() => invokeGenericCap(config, BAD_ID, 'unary', {
      id: 'x', mode: 'turbo', count: 1,
    }))
    expect(enumOut).toContain('BAD_PARAMS')
    expect(enumOut).toContain(BAD_ID)
    expect(enumOut).toContain('mode outside enum')
    // no validation failure reached the host method
    expect(hostCalls).toBe(0)
  })

  // E3: missing service injection / missing method degrade to NOT_WIRED loudly —
  // never a crash, never a fabricated empty success.
  test('E3 NOT_WIRED negatives: absent service and absent method (no fake empty result)', async () => {
    const rows: readonly CapParamRow[] = [{ name: 'value', required: true, type: 'string' }]
    const noService = makeConfig({
      adapters: new Set([RUN_ID]),
      services: { [RUN_ID]: { service: 'absentSvc', implementation: 'run' } },
      params: { [RUN_ID]: rows },
      getService: () => undefined,
    })
    const missingService = await rejectionMessage(() => invokeGenericCap(noService, RUN_ID, 'unary', { value: 'v' }))
    expect(missingService).toContain('NOT_WIRED')
    expect(missingService).toContain(RUN_ID)
    expect(missingService).toContain('absentSvc')

    const noMethod = makeConfig({
      adapters: new Set([RUN_ID]),
      services: { [RUN_ID]: { service: 'presentSvc', implementation: 'run' } },
      params: { [RUN_ID]: rows },
      getService: () => ({ otherMethod: () => 1 }),
    })
    const missingMethod = await rejectionMessage(() => invokeGenericCap(noMethod, RUN_ID, 'unary', { value: 'v' }))
    expect(missingMethod).toContain('NOT_WIRED')
    expect(missingMethod).toContain('presentSvc.run')
    expect(missingMethod).toContain(RUN_ID)
  })

  // §3.6: stream ids are refused by the unary generic arm regardless of the
  // dispatcher kind argument or the static kind table.
  test('BAD_KIND: stream id is gated by the unary generic arm', async () => {
    const config = makeConfig({
      adapters: new Set([STREAM_ID]),
      services: { [STREAM_ID]: { service: 'probeSvc', implementation: 'follow' } },
      kindOf: () => 'stream',
      getService: () => ({ follow: () => 'never' }),
    })
    const byDispatcherKind = await rejectionMessage(() => invokeGenericCap(config, STREAM_ID, 'unary', {}))
    expect(byDispatcherKind).toContain('BAD_KIND')
    expect(byDispatcherKind).toContain(STREAM_ID)

    const byStaticTable = await rejectionMessage(() => invokeGenericCap(config, STREAM_ID, 'stream', {}))
    expect(byStaticTable).toContain('BAD_KIND')
    expect(byStaticTable).toContain(STREAM_ID)

    const misconfigured = makeConfig({ ...config, kindOf: () => 'unary' })
    const wrongKindArg = await rejectionMessage(() => invokeGenericCap(misconfigured, STREAM_ID, 'stream', {}))
    expect(wrongKindArg).toContain('BAD_KIND')
  })

  // AMEND-1: deny-list enforced at generator (real tables), invoke gate and wire
  // lookup — a denied id is refused even when a hostile fixture writes it into
  // BOTH the adapters set and the wire table.
  test('AMEND-1 deny-list: account/credentials/settings absent in generated tables and gated anyway', async () => {
    const namespaces = ['account', 'credentials', 'settings']
    const adapters = [...CAP_GENERIC_ADAPTERS]
    const wire = Object.entries(CAP_GENERIC_WIRE_METHODS)
    for (const ns of namespaces) {
      expect(adapters.filter((id) => capIdNamespace(id) === ns)).toEqual([])
      expect(wire.filter(([wireName]) => wireName.split('.')[0] === ns)).toEqual([])
    }

    const denied = [ACCOUNT_DENIED_ID, CREDENTIALS_DENIED_ID, SETTINGS_DENIED_ID]
    const hostileWire: Readonly<Record<string, string>> = {
      'account.getState': ACCOUNT_DENIED_ID,
      'credentials.set': CREDENTIALS_DENIED_ID,
      'settings.mutate': SETTINGS_DENIED_ID,
    }
    for (const id of denied) {
      const config = makeConfig({
        adapters: new Set([id]),
        services: { [id]: { service: 'handOnlySvc', implementation: 'run' } },
        params: { [id]: [] },
        getService: () => ({ run: () => 'leaked' }),
      })
      const msg = await rejectionMessage(() => invokeGenericCap(config, id, 'unary', {}))
      expect(msg).toContain('NOT_WIRED')
      expect(msg).toContain(id)
      expect(msg).toContain('generic dispatch denied')
      // wire layer refuses the name even though the hostile table contains it
      const wireName = id.includes('/account/') ? 'account.getState'
        : id.includes('/credentials/') ? 'credentials.set' : 'settings.mutate'
      expect(resolveGenericWireMethod(wireName, hostileWire, config)).toBeUndefined()
    }
  })

  // AMEND-2 / E5: a PROJECTED_BY_HAND id must not traverse the generic default
  // projection. Hostile values carry a SENTINEL under general sensitive keys
  // (apiKey/token/secret/...), which the legacy OAuth-only sanitizer would let
  // through — proving the exception gate is load-bearing. No frame is emitted.
  test('AMEND-2 E5 SENTINEL: sensitive keys never appear in a generic frame for PROJECTED_BY_HAND ids', () => {
    expect(CAP_PROJECTED_BY_HAND.has(PROJECTED_ID)).toBe(true)
    const config = makeConfig({ projectedByHand: CAP_PROJECTED_BY_HAND })
    const hostile = {
      apiKey: SENTINEL,
      token: SENTINEL,
      secret: SENTINEL,
      password: SENTINEL,
      credential: SENTINEL,
      safe: 'visible',
    }

    let emittedFrame: string | undefined
    let threw = false
    try {
      emittedFrame = JSON.stringify(projectGenericWireReply(config, PROJECTED_ID, hostile, sanitizeFrameForWire))
    } catch (err) {
      threw = true
      expect((err as Error).message).toContain('HAND_PROJECTION_REQUIRED')
      expect((err as Error).message).toContain(PROJECTED_ID)
      expect((err as Error).message).not.toContain(SENTINEL)
      expect((err as Error).message).not.toMatch(/apiKey|token|secret|password|credential/i)
    }
    expect(threw).toBe(true)
    expect(emittedFrame ?? '').not.toContain(SENTINEL)
    expect(emittedFrame ?? '').not.toMatch(/"apiKey"|"token"|"secret"|"password"|"credential"/i)

    // Control: WITHOUT the exception, the default sanitizer would leak the
    // SENTINEL under apiKey/token/secret/password (it only strips 7 OAuth keys).
    const wouldLeak = projectGenericWireReply(config, NON_PROJECTED_ID, hostile, sanitizeFrameForWire)
    expect(JSON.stringify(wouldLeak)).toContain(SENTINEL)
    expect(JSON.stringify(wouldLeak)).toContain('"apiKey"')
    expect(JSON.stringify(wouldLeak)).toContain('"password"')
  })

  // §3.3 coexistence + S1 union gate + frozen invariants. Existing 28 per-id
  // arms win over generic; the union first gate admits both sets; the empty
  // adapters set and unchanged inject prove the W2-0 dormant contract.
  test('coexistence: per-id wins, union gate admits both sets, 28/0/inject invariants hold', async () => {
    expect(CAP_HOST_WIRED_IDS.length).toBe(28)
    expect(CAP_GENERIC_ADAPTERS.size).toBe(0)
    expect(inject).toEqual(['agents', 'typert'])
    expect(inject).not.toContain('pluginManager')
    expect(inject).not.toContain('llm')

    const controllerStub = { list: () => ({ items: [{ id: 'from-per-id-arm' }] }) }
    const ctx = {
      get: (name: string) => (name === 'sessionController' ? controllerStub : undefined),
    } as unknown as BridgeContext
    const sessionListId = '@deepseek-ai/dsh-api-session-controller#session/list'
    let genericTouched = 0
    const bothSets = makeConfig({
      adapters: new Set([sessionListId, GENERIC_ID]),
      services: {
        [sessionListId]: { service: 'probeSvc', implementation: 'list' },
        [GENERIC_ID]: { service: 'genericSvc', implementation: 'run' },
      },
      params: { [sessionListId]: [], [GENERIC_ID]: [] },
      getService: (name) => {
        if (name === 'probeSvc') { genericTouched++; return { list: () => 'WRONG: generic ran' } }
        if (name === 'genericSvc') return { run: () => ({ via: 'generic' }) }
        return undefined
      },
    })
    const hostInvoke = createCapHostInvoke(ctx, bothSets)
    // per-id arm is authoritative for a hand-wired id even if it is in both sets
    expect(await hostInvoke(sessionListId as never, 'unary', { cursor: 'c' })).toEqual({
      items: [{ id: 'from-per-id-arm' }],
    })
    expect(genericTouched).toBe(0)
    // a generic-released id passes the union gate and reaches the generic arm
    expect(await hostInvoke(GENERIC_ID as never, 'unary', {})).toEqual({ via: 'generic' })
    // an id in NEITHER set fails the union gate with the unchanged 28 count text
    const ghost = await rejectionMessage(() => hostInvoke(GHOST_ID as never, 'unary', {}))
    expect(ghost).toContain('NOT_WIRED')
    expect(ghost).toContain(GHOST_ID)
    expect(ghost).toContain('in_wired=28/257')
  })
})
