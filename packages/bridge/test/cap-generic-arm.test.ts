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
  CAP_SERVICE_TABLE,
  CAP_PARAMS_TABLE,
  CAP_WRITE_CONFIRM_IDS,
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
    confirmIds: new Set<string>(),
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
  test('coexistence: per-id wins, union gate admits both sets, 28/inject invariants hold', async () => {
    expect(CAP_HOST_WIRED_IDS.length).toBe(28)
    // W2-1 round log — OLD W2-0 base criterion kept VERBATIM (do not delete):
    //   expect(CAP_GENERIC_ADAPTERS.size).toBe(0)
    // W2-2 round log — OLD W2-1 criterion kept VERBATIM (do not delete):
    //   expect(CAP_GENERIC_ADAPTERS.size).toBe(3)
    // W2-3 round log — OLD W2-2 criterion kept VERBATIM (do not delete):
    //   expect(CAP_GENERIC_ADAPTERS.size).toBe(10)
    expect(CAP_GENERIC_ADAPTERS.size).toBe(18)
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
    // an id in NEITHER set fails the union gate with the union count text.
    // bothSets has 2 generic ids -> 28 + 2 = 30. W2-1 round log — OLD W2-0
    // base criterion kept VERBATIM (do not delete):
    //   expect(ghost).toContain('in_wired=28/257')
    const ghost = await rejectionMessage(() => hostInvoke(GHOST_ID as never, 'unary', {}))
    expect(ghost).toContain('NOT_WIRED')
    expect(ghost).toContain(GHOST_ID)
    expect(ghost).toContain('in_wired=30/257')

    // Production release set reports the union count 28 + released = 46 (S-1).
    // W2-2 round log — OLD W2-1 criterion kept VERBATIM (do not delete):
    //   // Production release set (3 ids) reports the union count 28 + 3 = 31 (S-1).
    //   expect(prodGhost).toContain('in_wired=31/257')
    // W2-3 round log — OLD W2-2 criterion kept VERBATIM (do not delete):
    //   expect(prodGhost).toContain('in_wired=38/257')
    const prodConfig = makeConfig({ adapters: CAP_GENERIC_ADAPTERS })
    const prodInvoke = createCapHostInvoke(ctx, prodConfig)
    const prodGhost = await rejectionMessage(() => prodInvoke(GHOST_ID as never, 'unary', {}))
    expect(prodGhost).toContain('in_wired=46/257')
  })

  // W2-1 E4: the three released side-session ids are in the production set with
  // the correct service binding; cancel:'signal' ids get an owned, un-aborted
  // trailing AbortSignal appended AFTER the table-ordered request (R3 prefix).
  test('W2-1 release set + cancel signal: create=1 arg, prompt/wait=2 args with owned AbortSignal', async () => {
    const createId = '@deepseek-ai/dsh-api-session-controller#session/create'
    const promptId = '@deepseek-ai/dsh-api-session-controller#session/prompt'
    const waitId = '@deepseek-ai/dsh-api-session-controller#session/wait'
    for (const id of [createId, promptId, waitId]) {
      expect(CAP_GENERIC_ADAPTERS.has(id as never)).toBe(true)
    }
    const captured: Record<string, unknown[][]> = {}
    const request = { sessionId: 'side-test' }
    const svc = {
      create(...args: unknown[]) { captured.create = [args]; return { sessionId: 'side-test' } },
      prompt(...args: unknown[]) { captured.prompt = [args]; return { accepted: true } },
      wait(...args: unknown[]) { captured.wait = [args]; return { reason: 'idle' } },
    }
    const config = makeConfig({
      adapters: new Set([createId, promptId, waitId]),
      services: {
        [createId]: { service: 'sessionController', implementation: 'create' },
        [promptId]: { service: 'sessionController', implementation: 'prompt', cancel: 'signal' },
        [waitId]: { service: 'sessionController', implementation: 'wait', cancel: 'signal' },
      },
      params: {
        [createId]: [{ name: 'request', required: true, type: 'object' }],
        [promptId]: [{ name: 'request', required: true, type: 'object' }],
        [waitId]: [{ name: 'request', required: true, type: 'object' }],
      },
      getService: () => svc,
    })
    await invokeGenericCap(config, createId, 'unary', { request })
    await invokeGenericCap(config, promptId, 'unary', { request })
    await invokeGenericCap(config, waitId, 'unary', { request })

    // create (no cancel) gets exactly the table-ordered request, identity preserved.
    expect(captured.create![0]).toEqual([request])
    expect(captured.create![0]![0]).toBe(request)
    // prompt/wait (cancel:'signal') get request + an owned, never-aborted signal.
    for (const key of ['prompt', 'wait'] as const) {
      const args = captured[key]![0]!
      expect(args).toHaveLength(2)
      expect(args[0]).toBe(request)
      expect(args[1]).toBeInstanceOf(AbortSignal)
      expect((args[1] as AbortSignal).aborted).toBe(false)
    }
  })
})

/**
 * 025 W2-2a — the seven pluginManager READ ids released into the generic arm
 * (plan §5.2). All synthetic fixtures: no real service, no real credential
 * value (SENTINEL is a fixed fake string). E2 per-id negatives (S-1), E4
 * positional fidelity (R3), E5 wire sanitize defence-in-depth.
 */
describe('W2-2a plugin-manager read ids — per-id E2/E4/E5', () => {
  const PM = '@deepseek-ai/dsh-plugin-manager#pluginManager/'
  const IDS = {
    listBundles: PM + 'listBundles',
    listPlugins: PM + 'listPlugins',
    listVersionExemptions: PM + 'listVersionExemptions',
    registries: PM + 'registries',
    inspect: PM + 'inspect',
    listVersions: PM + 'listVersions',
    readBundleDetail: PM + 'readBundleDetail',
  }
  const ALL = Object.values(IDS)
  const VALID: Record<string, unknown> = {
    [IDS.inspect]: { spec: '@scope/pkg' },
    [IDS.listVersions]: { name: '@scope/pkg' },
    [IDS.readBundleDetail]: { name: '@scope/pkg', language: 'en' },
    [IDS.listBundles]: {},
    [IDS.listPlugins]: {},
    [IDS.listVersionExemptions]: {},
    [IDS.registries]: {},
  }

  function pmConfig(service: Record<string, (...a: unknown[]) => unknown> | undefined) {
    return makeConfig({
      adapters: CAP_GENERIC_ADAPTERS,
      services: CAP_SERVICE_TABLE,
      params: CAP_PARAMS_TABLE,
      projectedByHand: CAP_PROJECTED_BY_HAND,
      kindOf: () => 'unary',
      getService: (name) => (name === 'pluginManager' ? service : undefined),
    })
  }

  // All 7 ids live in the production release set + generated tables.
  test('W2-2a release set: 7 read ids in adapters + wired service/params, none PROJECTED_BY_HAND', () => {
    for (const id of ALL) {
      expect(CAP_GENERIC_ADAPTERS.has(id as never)).toBe(true)
      expect(CAP_SERVICE_TABLE[id as never]?.service).toBe('pluginManager')
      expect(Object.prototype.hasOwnProperty.call(CAP_PARAMS_TABLE, id)).toBe(true)
      // Negative guard: none of the read ids may be a hand-projection exception.
      expect(CAP_PROJECTED_BY_HAND.has(id as never)).toBe(false)
    }
  })

  // E2 (S-1): every id carries >= 1 service-absent NOT_WIRED negative with the
  // FULL CapIR id in the message (no-param ids have no BAD_PARAMS surface).
  test('E2 — all 7 ids: service-absent NOT_WIRED negative names the full id', async () => {
    const config = pmConfig(undefined)
    for (const id of ALL) {
      const msg = await rejectionMessage(() => invokeGenericCap(config, id, 'unary', VALID[id]))
      expect(msg).toContain('NOT_WIRED')
      expect(msg).toContain(id)
      expect(msg).toContain('pluginManager service unavailable')
    }
  })

  // E2 (S-1): the three ids with required params get explicit BAD_PARAMS negatives;
  // the host method is ZERO-called on every rejection.
  test('E2 — required-param ids: BAD_PARAMS missing/wrong-type, hostCalls=0', async () => {
    let hostCalls = 0
    const svc = {
      inspect() { hostCalls++; return {} },
      listVersions() { hostCalls++; return {} },
      readBundleDetail() { hostCalls++; return {} },
    }
    const config = pmConfig(svc)
    const cases: Array<[string, unknown, string, string]> = [
      [IDS.inspect, {}, 'spec', 'required'],
      [IDS.inspect, { spec: 42 }, 'spec', 'must be string'],
      [IDS.listVersions, {}, 'name', 'required'],
      [IDS.listVersions, { name: 42 }, 'name', 'must be string'],
      [IDS.readBundleDetail, { name: 'pkg' }, 'language', 'required'],
      [IDS.readBundleDetail, { name: 'pkg', language: 42 }, 'language', 'must be string'],
    ]
    for (const [id, params, param, reason] of cases) {
      const msg = await rejectionMessage(() => invokeGenericCap(config, id, 'unary', params))
      expect(msg).toContain('BAD_PARAMS: ' + id + ' ' + param + ' ' + reason)
    }
    expect(hostCalls).toBe(0)
  })

  // E4 (R3): positional arg order/values per id. No-param ids receive [];
  // cancel:'signal' ids get an owned, never-aborted trailing AbortSignal AFTER
  // the table-ordered prefix; an omitted optional keeps its slot (no left shift).
  test('E4 — positional args per id: no-param [], inspect/listVersions signal, readBundleDetail 3 args', async () => {
    const captured: Record<string, unknown[][]> = {}
    const svc = {
      listBundles(...a: unknown[]) { captured.listBundles = [a]; return [] },
      listPlugins(...a: unknown[]) { captured.listPlugins = [a]; return [] },
      listVersionExemptions(...a: unknown[]) { captured.listVersionExemptions = [a]; return {} },
      registries(...a: unknown[]) { captured.registries = [a]; return {} },
      inspect(...a: unknown[]) { (captured.inspect ??= []).push(a); return {} },
      listVersions(...a: unknown[]) { (captured.listVersions ??= []).push(a); return {} },
      readBundleDetail(...a: unknown[]) { captured.readBundleDetail = [a]; return {} },
    }
    const config = pmConfig(svc)
    for (const key of ['listBundles', 'listPlugins', 'listVersionExemptions', 'registries'] as const) {
      await invokeGenericCap(config, IDS[key], 'unary', {})
      expect(captured[key]![0]).toEqual([])
    }
    const opt1 = { registry: 'r' }
    const opt2 = { registry: null }
    await invokeGenericCap(config, IDS.inspect, 'unary', { spec: 'spec-val', options: opt1 })
    await invokeGenericCap(config, IDS.inspect, 'unary', { spec: 'spec-val' })
    await invokeGenericCap(config, IDS.listVersions, 'unary', { name: 'name-val', options: opt2 })
    await invokeGenericCap(config, IDS.listVersions, 'unary', { name: 'name-val' })
    const opt3 = { npmFileSources: ['jsdelivr'] }
    await invokeGenericCap(config, IDS.readBundleDetail, 'unary', { name: 'n', language: 'en', options: opt3 })

    // inspect/listVersions: prefix [required, optional] + owned trailing signal.
    for (const [key, required, opt] of [
      ['inspect', 'spec-val', opt1],
      ['listVersions', 'name-val', opt2],
    ] as const) {
      const withOpt = captured[key]![0]!
      expect(withOpt).toHaveLength(3)
      expect(withOpt[0]).toBe(required)
      expect(withOpt[1]).toBe(opt)
      expect(withOpt[2]).toBeInstanceOf(AbortSignal)
      expect((withOpt[2] as AbortSignal).aborted).toBe(false)
      const withoutOpt = captured[key]![1]!
      expect(withoutOpt).toHaveLength(3)
      expect(withoutOpt[1]).toBeUndefined() // optional slot preserved, no left shift
      expect(withoutOpt[2]).toBeInstanceOf(AbortSignal)
    }
    // readBundleDetail: 3 table-ordered args, NO signal (cancel not set).
    const detailArgs = captured.readBundleDetail![0]!
    expect(detailArgs).toHaveLength(3)
    expect(detailArgs[0]).toBe('n')
    expect(detailArgs[1]).toBe('en')
    expect(detailArgs[2]).toBe(opt3)
  })

  // E5 (defence in depth): the generic wire projection strips ALL S4
  // auth-material keys from a hostile reply before any frame is emitted.
  test('E5 — wire projection strips S4 auth keys; no SENTINEL in frame', () => {
    const config = pmConfig(undefined)
    const hostile = [
      { name: 'pkg', version: '1', access_token: SENTINEL, id_token: SENTINEL, authorizeUrl: SENTINEL },
    ]
    const framed = projectGenericWireReply(config, IDS.listBundles, hostile, sanitizeFrameForWire)
    const text = JSON.stringify(framed)
    expect(text).not.toContain(SENTINEL)
    for (const key of ['access_token', 'id_token', 'authorizeUrl']) expect(text).not.toContain(key)
    expect(text).toContain('pkg')
  })
})

/**
 * 025 W2-3a — the eight pluginManager WRITE ids released into the generic arm
 * (plan §5.2, R6). Synthetic fixtures only: no real service, no real credential
 * value (SENTINEL is a fixed fake string). E0 confirm double-gate (bridge half),
 * E2 per-id BAD_PARAMS, E4 positional fidelity (R3), E5 wire sanitize.
 */
describe('W2-3a plugin-manager write ids — E0/E2/E4/E5', () => {
  const PM = '@deepseek-ai/dsh-plugin-manager#pluginManager/'
  const IDS = {
    installBundle: PM + 'installBundle',
    updateBundle: PM + 'updateBundle',
    removeBundle: PM + 'removeBundle',
    setBundleEnabled: PM + 'setBundleEnabled',
    setPluginEnabled: PM + 'setPluginEnabled',
    setVersionExemption: PM + 'setVersionExemption',
    cancelInstall: PM + 'cancelInstall',
    waitForInstall: PM + 'waitForInstall',
  }
  const ALL = Object.values(IDS)
  const VALID: Record<string, unknown> = {
    [IDS.installBundle]: { spec: '@scope/pkg' },
    [IDS.updateBundle]: { name: '@scope/pkg', version: '2.0.0' },
    [IDS.removeBundle]: { name: '@scope/pkg' },
    [IDS.setBundleEnabled]: { name: '@scope/pkg', enabled: true },
    [IDS.setPluginEnabled]: { id: 'pkg-entry', enabled: true },
    [IDS.setVersionExemption]: { packageVersion: '1.0.0', runtimeVersion: 'rc.5', enabled: true },
    [IDS.cancelInstall]: { requestId: 'req-1' },
    [IDS.waitForInstall]: { requestId: 'req-1' },
  }
  const CONFIRM = { __confirm: true }

  let calls: Record<string, unknown[][]> = {}
  function svc(withConfirmSpread = false): Record<string, (...a: unknown[]) => unknown> {
    calls = {}
    const make = (key: string) => (...args: unknown[]) => {
      ;(calls[key] ??= []).push(args)
      return { application: 'applied', target: key }
    }
    // Keep the mock surface explicit (no dynamic proxy): every write method is
    // a real named function so positional reconstruction is observable.
    return {
      installBundle: make('installBundle'),
      updateBundle: make('updateBundle'),
      removeBundle: make('removeBundle'),
      setBundleEnabled: make('setBundleEnabled'),
      setPluginEnabled: make('setPluginEnabled'),
      setVersionExemption: make('setVersionExemption'),
      cancelInstall: make('cancelInstall'),
      waitForInstall: make('waitForInstall'),
    }
  }

  function pmConfig(service: Record<string, (...a: unknown[]) => unknown> | undefined, confirmIds = CAP_WRITE_CONFIRM_IDS) {
    return makeConfig({
      adapters: CAP_GENERIC_ADAPTERS,
      services: CAP_SERVICE_TABLE,
      params: CAP_PARAMS_TABLE,
      projectedByHand: CAP_PROJECTED_BY_HAND,
      confirmIds,
      kindOf: () => 'unary',
      getService: (name) => (name === 'pluginManager' ? service : undefined),
    })
  }

  const keyOf = (id: string) => id.slice(PM.length)

  // Release-set integrity: 8 write ids in adapters + confirm set, service binding
  // and params present; none is a hand-projection exception (AMEND-2).
  test('W2-3a release set: 8 write ids in adapters + confirm set, wired service/params, none PROJECTED_BY_HAND', () => {
    expect(CAP_GENERIC_ADAPTERS.size).toBe(18)
    expect(CAP_WRITE_CONFIRM_IDS.size).toBe(8)
    for (const id of ALL) {
      expect(CAP_GENERIC_ADAPTERS.has(id as never)).toBe(true)
      expect(CAP_WRITE_CONFIRM_IDS.has(id as never)).toBe(true)
      expect(CAP_SERVICE_TABLE[id as never]?.service).toBe('pluginManager')
      expect(Object.prototype.hasOwnProperty.call(CAP_PARAMS_TABLE, id)).toBe(true)
      expect(CAP_PROJECTED_BY_HAND.has(id as never)).toBe(false)
    }
  })

  // E0 BRIDGE HALF of the R6 double gate: an unconfirmed write is refused with
  // CONFIRM_REQUIRED and host method ZERO-called — no service resolution, no fire.
  test('E0 — bridge confirm gate: no __confirm -> CONFIRM_REQUIRED, hostCalls=0', async () => {
    const service = svc()
    const config = pmConfig(service)
    for (const id of ALL) {
      const msg = await rejectionMessage(() => invokeGenericCap(config, id, 'unary', VALID[id]))
      expect(msg).toContain('CONFIRM_REQUIRED: ' + id)
    }
    expect(Object.values(calls).flat().length).toBe(0)
  })

  // E0 control: `__confirm: "yes"` (wrong type) is NOT accepted; only literal true.
  test('E0 — bridge confirm gate rejects non-boolean confirm marker', async () => {
    const service = svc()
    const config = pmConfig(service)
    const msg = await rejectionMessage(() =>
      invokeGenericCap(config, IDS.installBundle, 'unary', { ...VALID[IDS.installBundle], __confirm: 'yes' }),
    )
    expect(msg).toContain('CONFIRM_REQUIRED')
    expect(Object.values(calls).flat().length).toBe(0)
  })

  // E2 (S-1): every id carries >=1 BAD_PARAMS negative naming the FULL CapIR id;
  // host method ZERO-called on every rejection. __confirm supplied so the gate
  // is passed and validation is the rejecting layer (not the confirm gate).
  test('E2 — all 8 write ids: BAD_PARAMS missing/wrong-type, full id in message, hostCalls=0', async () => {
    const service = svc()
    const config = pmConfig(service)
    const cases: Array<[string, unknown, string, string]> = [
      [IDS.installBundle, {}, 'spec', 'required'],
      [IDS.installBundle, { spec: 42 }, 'spec', 'must be string'],
      [IDS.updateBundle, { name: '@s/p' }, 'version', 'required'],
      [IDS.updateBundle, { name: '@s/p', version: 42 }, 'version', 'must be string'],
      [IDS.removeBundle, {}, 'name', 'required'],
      [IDS.setBundleEnabled, { name: '@s/p' }, 'enabled', 'required'],
      [IDS.setBundleEnabled, { name: '@s/p', enabled: 'yes' }, 'enabled', 'must be boolean'],
      [IDS.setPluginEnabled, { id: 'e' }, 'enabled', 'required'],
      [IDS.setVersionExemption, {}, 'packageVersion', 'required'],
      [IDS.setVersionExemption, { packageVersion: '1', runtimeVersion: 'rc', enabled: true, acceptRisk: 'yes' }, 'acceptRisk', 'must be boolean'],
      [IDS.cancelInstall, {}, 'requestId', 'required'],
      [IDS.waitForInstall, {}, 'requestId', 'required'],
    ]
    for (const [id, params, param, reason] of cases) {
      const msg = await rejectionMessage(() =>
        invokeGenericCap(config, id, 'unary', { ...params, __confirm: true }),
      )
      expect(msg).toContain('BAD_PARAMS: ' + id + ' ' + param + ' ' + reason)
    }
    expect(Object.values(calls).flat().length).toBe(0)
  })

  // E4 (R3): positional arg order/values per id, BY TABLE ORDER from capir.json.
  // Optional omissions keep their slot (no left shift); object identity preserved.
  // No write id carries cancel:'signal' -> no trailing AbortSignal.
  test('E4 — positional args per id: table-order reconstruction, optional slots preserved', async () => {
    const service = svc()
    const config = pmConfig(service)

    const optInstall = { offline: true }
    await invokeGenericCap(config, IDS.installBundle, 'unary', { spec: 'sp', options: optInstall, __confirm: true })
    expect(calls.installBundle![0]).toEqual(['sp', optInstall])
    expect(calls.installBundle![0]![1]).toBe(optInstall)

    await invokeGenericCap(config, IDS.updateBundle, 'unary', { name: 'n', version: 'v', __confirm: true })
    expect(calls.updateBundle![0]).toEqual(['n', 'v', undefined])

    await invokeGenericCap(config, IDS.removeBundle, 'unary', { name: 'n', __confirm: true })
    expect(calls.removeBundle![0]).toEqual(['n'])

    await invokeGenericCap(config, IDS.setBundleEnabled, 'unary', { name: 'n', enabled: false, __confirm: true })
    expect(calls.setBundleEnabled![0]).toEqual(['n', false])

    await invokeGenericCap(config, IDS.setPluginEnabled, 'unary', { id: 'pid', enabled: true, __confirm: true })
    expect(calls.setPluginEnabled![0]).toEqual(['pid', true])

    const riskTrue = true
    await invokeGenericCap(config, IDS.setVersionExemption, 'unary', {
      packageVersion: 'pv', runtimeVersion: 'rv', enabled: true, acceptRisk: riskTrue, __confirm: true,
    })
    expect(calls.setVersionExemption![0]).toEqual(['pv', 'rv', true, riskTrue])
    expect(calls.setVersionExemption![0]![3]).toBe(riskTrue)
    await invokeGenericCap(config, IDS.setVersionExemption, 'unary', {
      packageVersion: 'pv', runtimeVersion: 'rv', enabled: true, __confirm: true,
    })
    expect(calls.setVersionExemption![1]).toEqual(['pv', 'rv', true, undefined])

    await invokeGenericCap(config, IDS.cancelInstall, 'unary', { requestId: 'rid', __confirm: true })
    expect(calls.cancelInstall![0]).toEqual(['rid'])
    await invokeGenericCap(config, IDS.waitForInstall, 'unary', { requestId: 'rid', __confirm: true })
    expect(calls.waitForInstall![0]).toEqual(['rid'])

    // __confirm is a meta marker: NEVER forwarded as a positional host argument.
    for (const args of Object.values(calls).flat()) {
      for (const a of args) expect(a).not.toEqual(CONFIRM)
    }
    void keyOf // documented helper; no-op reference
  })

  // E5 (defence in depth): generic wire projection strips the 7 S4 auth-material
  // keys from a hostile write reply. No write id is in PROJECTED_BY_HAND, so a
  // defensive wire-layer negative is required by the W2-2 precedent. Generic
  // apiKey/token/secret keys are NOT in the S4 sanitizer (the AMEND-2 gap) — they
  // are removed by the seam's SECOND whitelist projection (W2-3b/c), not here.
  test('E5 — wire projection strips S4 auth keys from write reply; no SENTINEL in frame', () => {
    const config = pmConfig(undefined)
    const hostile = {
      application: 'applied', target: 'pkg',
      authorizeUrl: SENTINEL, authorize_url: SENTINEL, code_challenge: SENTINEL,
      code_verifier: SENTINEL, access_token: SENTINEL, id_token: SENTINEL, refresh_token: SENTINEL,
    }
    const framed = projectGenericWireReply(config, IDS.installBundle, hostile, sanitizeFrameForWire)
    const text = JSON.stringify(framed)
    expect(text).not.toContain(SENTINEL)
    for (const key of ['authorizeUrl', 'authorize_url', 'code_challenge', 'code_verifier', 'access_token', 'id_token', 'refresh_token']) {
      expect(text).not.toContain(key)
    }
    expect(text).toContain('applied')
  })
})
