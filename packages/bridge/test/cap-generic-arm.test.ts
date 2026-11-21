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
  CAP_SCOPE_TABLE,
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
  createProductionGenericConfig,
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
    // W2-4 round log — OLD W2-3 criterion kept VERBATIM (do not delete):
    //   expect(CAP_GENERIC_ADAPTERS.size).toBe(18)
    // W2-5 round log — OLD W2-4 criterion kept VERBATIM (do not delete):
    //   expect(CAP_GENERIC_ADAPTERS.size).toBe(23)
    expect(CAP_GENERIC_ADAPTERS.size).toBe(30)
    expect(inject).toEqual(['agents', 'typert'])
    expect(inject).not.toContain('pluginManager')
    expect(inject).not.toContain('llm')
    expect(inject).not.toContain('web')
    expect(inject).not.toContain('permissionPresets')
    expect(inject).not.toContain('goals')

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
    // W2-4 round log — OLD W2-3 criterion kept VERBATIM (do not delete):
    //   expect(prodGhost).toContain('in_wired=46/257')
    // W2-5 round log — OLD W2-4 criterion kept VERBATIM (do not delete):
    //   expect(prodGhost).toContain('in_wired=51/257')
    const prodConfig = makeConfig({ adapters: CAP_GENERIC_ADAPTERS })
    const prodInvoke = createCapHostInvoke(ctx, prodConfig)
    const prodGhost = await rejectionMessage(() => prodInvoke(GHOST_ID as never, 'unary', {}))
    expect(prodGhost).toContain('in_wired=58/257')
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
    // W2-4 round log — OLD W2-3 criterion kept VERBATIM (do not delete):
    //   expect(CAP_GENERIC_ADAPTERS.size).toBe(18)
    // W2-4 releases 5 more directory ids -> 23; W2-3 write ids still all present.
    // W2-5 round log — OLD W2-4 criterion kept VERBATIM (do not delete):
    //   expect(CAP_GENERIC_ADAPTERS.size).toBe(23)
    // W2-5 releases 7 goals ids -> 30; W2-3 write ids still all present.
    expect(CAP_GENERIC_ADAPTERS.size).toBe(30)
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

/**
 * 025 W2-4a — the five directory READ ids released into the generic arm (plan
 * §4.2). Synthetic fixtures only: no real service, no real credential value
 * (SENTINEL is a fixed fake string). E2 per-id negative, E4 positional fidelity
 * (R3, incl. discoverModels' trailing owned AbortSignal), E5 AMEND-2 wire-layer
 * SENTINEL for the one PROJECTED_BY_HAND id (llm/discoverModels).
 */
describe('W2-4a directory ids — E2/E4/E5 (AMEND-2 wire SENTINEL)', () => {
  const LLM = '@deepseek-ai/dsh-llm#llm/'
  const IDS = {
    listProviders: LLM + 'listProviders',
    listConfigurableProviders: LLM + 'listConfigurableProviders',
    discoverModels: LLM + 'discoverModels',
    webListProviders: '@deepseek-ai/dsh-web#web/listProviders',
    catalog: '@deepseek-ai/dsh-permission-presets#permissionPresets/catalog',
  }
  const ALL = Object.values(IDS)
  const ZERO_PARAM = [IDS.listProviders, IDS.listConfigurableProviders, IDS.webListProviders, IDS.catalog]

  let calls: Record<string, unknown[][]> = {}
  function svc(): Record<string, (...a: unknown[]) => unknown> {
    calls = {}
    const make = (key: string) => (...args: unknown[]) => {
      ;(calls[key] ??= []).push(args)
      return [{ id: 'probe-provider', name: 'Probe' }]
    }
    // Explicit named methods (no dynamic proxy) so positional reconstruction
    // is observable, including the trailing signal for discoverModels.
    return {
      listProviders: make('listProviders'),
      listConfigurableProviders: make('listConfigurableProviders'),
      remoteDiscoverModels: make('remoteDiscoverModels'), // implementation alias, not method name
      listProviders_web: make('listProviders_web'),
      catalog: make('catalog'),
    }
  }

  function dirConfig(service: Record<string, (...a: unknown[]) => unknown> | undefined) {
    return makeConfig({
      adapters: CAP_GENERIC_ADAPTERS,
      services: {
        // The web/listProviders binding must resolve to a distinct fn from the
        // llm one — the real service keys differ (web vs llm).
        ...CAP_SERVICE_TABLE,
        [IDS.webListProviders]: { service: 'web', implementation: 'listProviders_web' },
      },
      params: CAP_PARAMS_TABLE,
      projectedByHand: CAP_PROJECTED_BY_HAND,
      confirmIds: CAP_WRITE_CONFIRM_IDS,
      kindOf: () => 'unary',
      getService: (name) => (name === 'llm' || name === 'web' || name === 'permissionPresets' ? service : undefined),
    })
  }

  // Release-set integrity: 5 directory ids in adapters, wired service/params;
  // discoverModels is the ONLY one in PROJECTED_BY_HAND (AMEND-2 scan fact).
  test('W2-4a release set: 5 directory ids in adapters + wired service/params; only discoverModels PROJECTED', () => {
    // W2-5 round log — OLD W2-4 criterion kept VERBATIM (do not delete):
    //   expect(CAP_GENERIC_ADAPTERS.size).toBe(23)
    expect(CAP_GENERIC_ADAPTERS.size).toBe(30)
    for (const id of ALL) {
      expect(CAP_GENERIC_ADAPTERS.has(id as never)).toBe(true)
      expect(CAP_SERVICE_TABLE[id as never]?.service).toBeDefined()
      expect(Object.prototype.hasOwnProperty.call(CAP_PARAMS_TABLE, id)).toBe(true)
    }
    expect(CAP_SERVICE_TABLE[IDS.discoverModels as never]?.implementation).toBe('remoteDiscoverModels')
    expect(CAP_SERVICE_TABLE[IDS.discoverModels as never]?.cancel).toBe('signal')
    for (const id of ZERO_PARAM) {
      expect((CAP_PARAMS_TABLE[id as never] ?? []).length).toBe(0)
      expect(CAP_PROJECTED_BY_HAND.has(id as never)).toBe(false)
    }
    // AMEND-2 fact: the handoff's "listProviders/web are PROJECTED" is an
    // erratum; the deterministic scan pins discoverModels (maxTokens→/token/).
    expect(CAP_PROJECTED_BY_HAND.has(IDS.discoverModels as never)).toBe(true)
    expect(CAP_PROJECTED_BY_HAND.has(IDS.listProviders as never)).toBe(false)
    expect(CAP_PROJECTED_BY_HAND.has(IDS.webListProviders as never)).toBe(false)
  })

  // E2: discoverModels is the only directory id with required params. Both
  // required params get BAD_PARAMS negatives naming the FULL CapIR id; the four
  // zero-param ids have no required field to omit (objective fact, registered
  // honestly) — they are proven reachable via E4 below.
  test('E2 — discoverModels BAD_PARAMS (missing settingsNs / request), full id, hostCalls=0', async () => {
    const service = svc()
    const config = dirConfig(service)
    const cases: Array<[unknown, string, string]> = [
      [{ request: { model: 'm' } }, 'settingsNs', 'required'],
      [{ settingsNs: 'ns' }, 'request', 'required'],
      [{ settingsNs: 42, request: { model: 'm' } }, 'settingsNs', 'must be string'],
      [{ settingsNs: 'ns', request: 'not-object' }, 'request', 'must be object'],
    ]
    for (const [params, param, reason] of cases) {
      const msg = await rejectionMessage(() => invokeGenericCap(config, IDS.discoverModels, 'unary', params))
      expect(msg).toContain('BAD_PARAMS: ' + IDS.discoverModels + ' ' + param + ' ' + reason)
    }
    expect(Object.values(calls).flat().length).toBe(0)
  })

  // E4 (R3): zero-param ids call with exactly []; discoverModels reconstructs
  // [settingsNs, request, signal] BY TABLE ORDER with a trailing owned signal,
  // object identity preserved (no left shift / no extra args).
  test('E4 — positional args: zero-param ids [] and discoverModels [settingsNs, request, signal]', async () => {
    const service = svc()
    const config = dirConfig(service)

    await invokeGenericCap(config, IDS.listProviders, 'unary', {})
    expect(calls.listProviders![0]).toEqual([])
    await invokeGenericCap(config, IDS.listConfigurableProviders, 'unary', {})
    expect(calls.listConfigurableProviders![0]).toEqual([])
    await invokeGenericCap(config, IDS.webListProviders, 'unary', {})
    expect(calls.listProviders_web![0]).toEqual([])
    await invokeGenericCap(config, IDS.catalog, 'unary', {})
    expect(calls.catalog![0]).toEqual([])

    const req = { model: 'm', endpoint: 'https://example.invalid' }
    await invokeGenericCap(config, IDS.discoverModels, 'unary', { settingsNs: 'llm', request: req })
    const args = calls.remoteDiscoverModels![0]!
    expect(args.length).toBe(3)
    expect(args[0]).toBe('llm')
    expect(args[1]).toBe(req)
    expect(args[1]).toBe(req) // identity, not a copy
    expect(args[2]).toBeInstanceOf(AbortSignal)
  })

  // E5 / AMEND-2 (first true trigger): the PROJECTED id llm/discoverModels must
  // NEVER traverse the generic default wire projection — a hostile reply with
  // sensitive keys emits NO frame (HAND_PROJECTION_REQUIRED), while a control
  // non-exception id WOULD leak the SENTINEL under the legacy OAuth-only
  // sanitizer. This is the wire-layer negative the W2-3 review singled out.
  test('E5 — AMEND-2 wire SENTINEL: discoverModels hostile reply emits no frame; control leaks', () => {
    const config = dirConfig(undefined)
    const hostile = {
      id: 'm', name: 'Probe', maxTokens: 128,
      apiKey: SENTINEL, token: SENTINEL, secret: SENTINEL,
      password: SENTINEL, credential: SENTINEL, safe: 'visible',
    }
    let emitted: string | undefined
    let threw = false
    try {
      emitted = JSON.stringify(projectGenericWireReply(config, IDS.discoverModels, hostile, sanitizeFrameForWire))
    } catch (err) {
      threw = true
      expect((err as Error).message).toContain('HAND_PROJECTION_REQUIRED: ' + IDS.discoverModels)
      expect((err as Error).message).not.toContain(SENTINEL)
    }
    expect(threw).toBe(true)
    expect(emitted ?? '').not.toContain(SENTINEL)
    expect(emitted ?? '').not.toMatch(/"apiKey"|"token"|"secret"|"password"|"credential"/i)

    // Control: the legacy OAuth-only sanitizer would leak general sensitive keys.
    const wouldLeak = projectGenericWireReply(config, IDS.listProviders, hostile, sanitizeFrameForWire)
    expect(JSON.stringify(wouldLeak)).toContain(SENTINEL)
    expect(JSON.stringify(wouldLeak)).toContain('"apiKey"')
  })

  // Wire-name resolution: all five directory ids resolve via the GENERATED
  // CAP_GENERIC_WIRE_METHODS table (no hand-copied wire line, C5).
  test('C5 — all five directory ids resolve via generated wire table', () => {
    const config = dirConfig(undefined)
    const expectWire: Record<string, string> = {
      [IDS.listProviders]: 'llm.listProviders',
      [IDS.listConfigurableProviders]: 'llm.listConfigurableProviders',
      [IDS.discoverModels]: 'llm.discoverModels',
      [IDS.webListProviders]: 'web.listProviders',
      [IDS.catalog]: 'permissionPresets.catalog',
    }
    for (const [id, wire] of Object.entries(expectWire)) {
      expect(resolveGenericWireMethod(wire, CAP_GENERIC_WIRE_METHODS, config)).toBe(id)
    }
  })
})

/**
 * 025 W2-5a — the seven goals ids released into the generic arm (plan §4.2).
 * All unary/service=goals, scope agentId carried as a wire STRING and resolved
 * in place by the arm via CAP_SCOPE_TABLE (data-driven scope substitution,
 * d94161a, table-driven — AMEND-5 erratum). Synthetic fixtures only: no real
 * service, no real credential value (SENTINEL is a fixed fake string).
 * E2 per-id BAD_PARAMS,
 * E4 positional fidelity (R3, all args table-ordered, NO trailing signal),
 * E5 AMEND-2 blind-spot registration (ALL 7 ids are schema-open/null — none is
 * PROJECTED_BY_HAND — so the load-bearing defence is the seam second whitelist,
 * projected in W2-5b; here we pin the wire-layer control + the scan fact).
 */
describe('W2-5a goals ids — E2/E4/E5 (AMEND-2 blind-spot family)', () => {
  const G = '@deepseek-ai/dsh-goal#goals/'
  const IDS = {
    create: G + 'create',
    get: G + 'get',
    edit: G + 'edit',
    complete: G + 'complete',
    pause: G + 'pause',
    resume: G + 'resume',
    clear: G + 'clear',
  }
  const ALL = Object.values(IDS)

  let calls: Record<string, unknown[][]> = {}
  function svc(): Record<string, (...a: unknown[]) => unknown> {
    calls = {}
    const make = (key: string) => (...args: unknown[]) => {
      ;(calls[key] ??= []).push(args)
      return { id: 'g-probe', revision: 1 }
    }
    // Explicit named methods (no dynamic proxy). create resolves via its
    // implementation alias remoteExportCreate (NOT the method name).
    return {
      remoteExportCreate: make('remoteExportCreate'),
      get: make('get'),
      edit: make('edit'),
      complete: make('complete'),
      pause: make('pause'),
      resume: make('resume'),
      clear: make('clear'),
    }
  }
  function goalsConfig(service: Record<string, (...a: unknown[]) => unknown> | undefined) {
    return makeConfig({
      adapters: CAP_GENERIC_ADAPTERS,
      services: CAP_SERVICE_TABLE,
      params: CAP_PARAMS_TABLE,
      projectedByHand: CAP_PROJECTED_BY_HAND,
      kindOf: () => 'unary',
      getService: (name) => (name === 'goals' ? service : undefined),
    })
  }

  // Release-set integrity: 7 goals ids in adapters + wired service/params;
  // create has the remoteExportCreate alias; NO id carries cancel:'signal';
  // NONE is in PROJECTED_BY_HAND (the AMEND-2 blind-spot family).
  test('W2-5a release set: 7 goals ids wired; create=remoteExportCreate alias; none PROJECTED/cancel', () => {
    // W2-5 round log — OLD W2-4 criterion kept VERBATIM (do not delete):
    //   expect(CAP_GENERIC_ADAPTERS.size).toBe(23)
    expect(CAP_GENERIC_ADAPTERS.size).toBe(30)
    for (const id of ALL) {
      expect(CAP_GENERIC_ADAPTERS.has(id as never)).toBe(true)
      expect(CAP_SERVICE_TABLE[id as never]?.service).toBe('goals')
      expect(Object.prototype.hasOwnProperty.call(CAP_PARAMS_TABLE, id)).toBe(true)
      expect(CAP_PROJECTED_BY_HAND.has(id as never)).toBe(false)
      expect(CAP_SERVICE_TABLE[id as never]?.cancel).toBeUndefined()
    }
    expect(CAP_SERVICE_TABLE[IDS.create as never]?.implementation).toBe('remoteExportCreate')
    for (const id of ALL.filter((x) => x !== IDS.create)) {
      expect(CAP_SERVICE_TABLE[id as never]?.implementation).toBe(id.slice(G.length))
    }
  })

  // E2: every id has required params (agentId mandatory, write ids add ref/request).
  // Each gets a BAD_PARAMS negative naming the FULL id; host ZERO-called.
  test('E2 — all 7 goals ids: BAD_PARAMS missing/wrong-type, full id, hostCalls=0', async () => {
    const service = svc()
    const config = goalsConfig(service)
    const cases: Array<[string, unknown, string, string]> = [
      [IDS.get, {}, 'agentId', 'required'],
      [IDS.get, { agentId: 42 }, 'agentId', 'must be string'],
      [IDS.create, {}, 'agentId', 'required'],
      [IDS.create, { agentId: 'a' }, 'request', 'required'],
      [IDS.create, { agentId: 'a', request: 'x' }, 'request', 'must be object'],
      [IDS.edit, { agentId: 'a', ref: {} }, 'request', 'required'],
      [IDS.edit, { agentId: 'a', ref: {}, request: 42 }, 'request', 'must be object'],
      [IDS.complete, { agentId: 'a' }, 'ref', 'required'],
      [IDS.complete, { agentId: 'a', ref: 42 }, 'ref', 'must be object'],
      [IDS.pause, { agentId: 'a' }, 'ref', 'required'],
      [IDS.resume, { agentId: 'a' }, 'ref', 'required'],
      [IDS.clear, { agentId: 'a' }, 'ref', 'required'],
    ]
    for (const [id, params, param, reason] of cases) {
      const msg = await rejectionMessage(() => invokeGenericCap(config, id, 'unary', params))
      expect(msg).toContain('BAD_PARAMS: ' + id + ' ' + param + ' ' + reason)
    }
    expect(Object.values(calls).flat().length).toBe(0)
  })

  // E4 (R3): positional args per id BY TABLE ORDER. No id carries cancel:'signal'
  // -> no trailing AbortSignal. agentId string + ref/request object identity
  // preserved; create resolves via remoteExportCreate alias.
  test('E4 — positional args: create[agentId,request] via alias, get[agentId], edit[agentId,ref,request], others[agentId,ref]', async () => {
    const service = svc()
    const config = goalsConfig(service)

    const request = { objective: 'ship it' }
    await invokeGenericCap(config, IDS.create, 'unary', { agentId: 'ag', request })
    expect(calls.remoteExportCreate![0]).toEqual(['ag', request])
    expect(calls.remoteExportCreate![0]![1]).toBe(request)

    await invokeGenericCap(config, IDS.get, 'unary', { agentId: 'ag' })
    expect(calls.get![0]).toEqual(['ag'])

    const ref = { id: 'g-1', revision: 3 }, editReq = { objective: 'new' }
    await invokeGenericCap(config, IDS.edit, 'unary', { agentId: 'ag', ref, request: editReq })
    expect(calls.edit![0]).toEqual(['ag', ref, editReq])
    expect(calls.edit![0]![1]).toBe(ref)
    expect(calls.edit![0]![2]).toBe(editReq)

    for (const key of ['complete', 'pause', 'resume', 'clear'] as const) {
      const r = { id: 'g-1', revision: 3 }
      await invokeGenericCap(config, IDS[key], 'unary', { agentId: 'ag', ref: r })
      expect(calls[key]![0]).toEqual(['ag', r])
      expect(calls[key]![0]![1]).toBe(r)
    }
    // No trailing signal on ANY goals id (no cancel:'signal' in capir.json).
    for (const args of Object.values(calls).flat()) {
      for (const a of args) expect(a).not.toBeInstanceOf(AbortSignal)
    }
  })

  // E5 / AMEND-2 blind-spot family registration. ALL 7 goals ids are schema-open
  // (additionalProperties:true) or null-schema (get): the static sensitive-key
  // scan sees NO declared sensitive key, so none is PROJECTED_BY_HAND. The wire
  // default projection would therefore LET general sensitive keys through (the
  // C-1 blind spot, control proven here); the load-bearing defence is the seam
  // SECOND whitelist (W2-5b bridge-goals.test.ts + bridge-session-seam.test.ts),
  // not the wire layer. This test pins that fact honestly — no fake "safe" claim.
  test('E5 — AMEND-2 blind spot: goals ids NOT PROJECTED (control wire leaks; seam whitelist is the defence)', () => {
    const config = goalsConfig(undefined)
    const hostile = {
      id: 'g-1', revision: 1, objective: 'safe',
      apiKey: SENTINEL, token: SENTINEL, secret: SENTINEL,
      password: SENTINEL, credential: SENTINEL, safe: 'visible',
    }
    // Scan fact: no goals id is a hand-projection exception.
    for (const id of ALL) expect(CAP_PROJECTED_BY_HAND.has(id as never)).toBe(false)
    // Control: the generic wire default (OAuth-only sanitizer) would leak the
    // general sensitive keys — this is exactly the blind spot C-1 registered;
    // seam whitelist (W2-5b) is what actually blocks them from reaching the TUI.
    const wire = projectGenericWireReply(config, IDS.get, hostile, sanitizeFrameForWire)
    expect(JSON.stringify(wire)).toContain(SENTINEL)
    expect(JSON.stringify(wire)).toContain('"apiKey"')
  })

  // C5 wire-name resolution: all seven goals ids resolve via the GENERATED wire
  // table (no hand-copied wire line, C5).
  test('C5 — all seven goals ids resolve via generated wire table', () => {
    const config = goalsConfig(undefined)
    for (const id of ALL) {
      const wire = 'goals.' + id.slice(G.length)
      expect(resolveGenericWireMethod(wire, CAP_GENERIC_WIRE_METHODS, config)).toBe(id)
    }
  })
})

/**
 * 025 W2-0 scope-lookup fix — data-driven resolver injection in the generic arm.
 * The goal-family host methods take a LIVE Agent object (assertLive:
 * ctx.agents.get(agent.id) === agent, deepseek-harness-pr goal/src/index.ts:472-475);
 * the wire carries only agentId:string. CAP_SCOPE_TABLE (generated from capir.json
 * `scope`) drives the substitution; there is NO goals-specific branch in the arm.
 * Synthetic fixtures only — no real agent, no credential value.
 */
describe('W2-0 scope-lookup — data-driven resolver (no goals branch)', () => {
  const G = '@deepseek-ai/dsh-goal#goals/'
  const GOALS = {
    create: G + 'create',
    get: G + 'get',
    edit: G + 'edit',
    complete: G + 'complete',
    pause: G + 'pause',
    resume: G + 'resume',
    clear: G + 'clear',
  }
  // A non-goal scope-bearing id proves the mechanism is table-driven, not a
  // goals-only special case. terminal/create also carries cancel:'signal'.
  const TERMINAL_CREATE = '@deepseek-ai/dsh-api-terminal-controller#terminal/create'
  const AGENT_ID = 'live-agent-1'
  const LIVE_AGENT = { id: AGENT_ID, marker: 'LIVE_AGENT_OBJECT' }

  // E1: generated scope metadata is complete + a non-goal scope id is present.
  test('E1 — CAP_SCOPE_TABLE carries 7 goals ids + non-goal scope ids, context/wire from capir', () => {
    expect(Object.keys(CAP_SCOPE_TABLE).length).toBe(34)
    for (const id of Object.values(GOALS)) {
      expect(CAP_SCOPE_TABLE[id as never]).toEqual({ context: 'agent', wire: 'agentId' })
    }
    expect(CAP_SCOPE_TABLE[TERMINAL_CREATE as never]).toEqual({ context: 'agent', wire: 'agentId' })
  })

  // E2 (R3/E4): resolver receives (context, wire, raw wire value); the returned
  // live object lands in the SAME positional slot. Later params keep their
  // index (no left shift) and object identity is preserved.
  test('E2 — resolver call args + live object at param index 0, later indices unshifted', async () => {
    const calls: Record<string, unknown[][]> = {}
    const svc = {
      get: (...a: unknown[]) => { (calls.get ??= []).push(a); return { objective: 'real' } },
      edit: (...a: unknown[]) => { (calls.edit ??= []).push(a); return { objective: 'edited' } },
      remoteExportCreate: (...a: unknown[]) => { (calls.create ??= []).push(a); return { ref: { id: 'g', revision: 1 } } },
    }
    const resolveCalls: Array<[string, string, unknown]> = []
    const config = makeConfig({
      adapters: CAP_GENERIC_ADAPTERS,
      services: CAP_SERVICE_TABLE,
      params: CAP_PARAMS_TABLE,
      scopes: CAP_SCOPE_TABLE,
      kindOf: () => 'unary',
      getService: (name) => (name === 'goals' ? svc : undefined),
      resolveScope: (context, wire, value) => {
        resolveCalls.push([context, wire, value])
        return context === 'agent' && wire === 'agentId' && value === AGENT_ID ? LIVE_AGENT : undefined
      },
    })

    await invokeGenericCap(config, GOALS.get, 'unary', { agentId: AGENT_ID })
    const ref = { id: 'g-1', revision: 3 }, request = { objective: 'new' }
    await invokeGenericCap(config, GOALS.edit, 'unary', { agentId: AGENT_ID, ref, request })
    const createRequest = { objective: 'ship' }
    await invokeGenericCap(config, GOALS.create, 'unary', { agentId: AGENT_ID, request: createRequest })

    expect(resolveCalls).toEqual([
      ['agent', 'agentId', AGENT_ID],
      ['agent', 'agentId', AGENT_ID],
      ['agent', 'agentId', AGENT_ID],
    ])
    expect(calls.get![0]).toEqual([LIVE_AGENT])
    expect(calls.get![0]![0]).toBe(LIVE_AGENT) // live object, NOT the agentId string
    expect(calls.edit![0]).toEqual([LIVE_AGENT, ref, request])
    expect(calls.edit![0]![1]).toBe(ref) // indices 1/2 unchanged, identity preserved
    expect(calls.edit![0]![2]).toBe(request)
    expect(calls.create![0]).toEqual([LIVE_AGENT, createRequest]) // implementation alias
    expect(calls.create![0]![1]).toBe(createRequest)
  })

  // E2 data-driven control: a NON-goal scope id resolves through the same table
  // (no goals hardcode). cancel:'signal' still appends AFTER the resolved slot.
  test('E2 — non-goal scope id resolves too (terminal/create [live, request, signal])', async () => {
    const args: unknown[][] = []
    const svc = { create: (...a: unknown[]) => { args.push(a); return {} } }
    const resolveCalls: Array<[string, string, unknown]> = []
    const config = makeConfig({
      adapters: new Set([TERMINAL_CREATE]),
      services: { [TERMINAL_CREATE]: { service: 'terminalController', implementation: 'create', cancel: 'signal' } },
      params: { [TERMINAL_CREATE]: CAP_PARAMS_TABLE[TERMINAL_CREATE as never] },
      scopes: CAP_SCOPE_TABLE,
      kindOf: () => 'unary',
      getService: () => svc,
      resolveScope: (context, wire, value) => { resolveCalls.push([context, wire, value]); return LIVE_AGENT },
    })
    const request = { id: 't', cols: 80, rows: 24 }
    await invokeGenericCap(config, TERMINAL_CREATE, 'unary', { agentId: AGENT_ID, request })
    expect(resolveCalls).toEqual([['agent', 'agentId', AGENT_ID]])
    expect(args[0]).toHaveLength(3)
    expect(args[0]![0]).toBe(LIVE_AGENT)
    expect(args[0]![1]).toBe(request)
    expect(args[0]![2]).toBeInstanceOf(AbortSignal)
  })

  // E3: every failure mode fails closed (no crash / no fake empty), message
  // carries the FULL CapIR id + the FULL wire id value; host zero-called.
  test('E3 — lookup failure negatives: no resolver / undefined / null / throw / unknown context', async () => {
    let hostCalls = 0
    const svc = { get: (..._a: unknown[]) => { hostCalls++; return {} } }
    const base = {
      adapters: CAP_GENERIC_ADAPTERS,
      services: CAP_SERVICE_TABLE,
      params: CAP_PARAMS_TABLE,
      scopes: CAP_SCOPE_TABLE,
      kindOf: () => 'unary' as const,
      getService: () => svc,
    }
    const noResolver = makeConfig(base)
    const msg1 = await rejectionMessage(() => invokeGenericCap(noResolver, GOALS.get, 'unary', { agentId: AGENT_ID }))
    expect(msg1).toContain('BAD_PARAMS: ' + GOALS.get + ' agentId scope lookup agent has no resolver')
    expect(msg1).toContain(GOALS.get)

    for (const resolveScope of [
      () => undefined,
      () => null,
      () => { throw new Error('registry gone') },
    ]) {
      const config = makeConfig({ ...base, resolveScope })
      const msg = await rejectionMessage(() => invokeGenericCap(config, GOALS.get, 'unary', { agentId: AGENT_ID }))
      expect(msg).toContain('BAD_PARAMS: ' + GOALS.get + ' agentId scope lookup agent failed for id "' + AGENT_ID + '"')
      expect(msg).toContain(GOALS.get)
    }

    const unknownContext = makeConfig({
      ...base,
      scopes: { [GOALS.get]: { context: 'mystery', wire: 'agentId' } },
      resolveScope: () => undefined,
    })
    const msg2 = await rejectionMessage(() => invokeGenericCap(unknownContext, GOALS.get, 'unary', { agentId: AGENT_ID }))
    expect(msg2).toContain('BAD_PARAMS: ' + GOALS.get + ' agentId scope lookup mystery failed')
    expect(hostCalls).toBe(0)
  })

  // E4: >=2 goals ids traverse the REAL production wiring (createCapHostInvoke
  // default config) end-to-end. The production resolver uses the existing agents
  // registry path (ctx.get('agents') -> .get); the mock registry returns LIVE_AGENT.
  test('E4 — end-to-end via production config: goals.get + goals.create deliver live agent', async () => {
    const calls: Record<string, unknown[][]> = {}
    const goalsSvc = {
      get: (...a: unknown[]) => { (calls.get ??= []).push(a); return { objective: 'real goal', phase: 'active' } },
      remoteExportCreate: (...a: unknown[]) => { (calls.create ??= []).push(a); return { ref: { id: 'g', revision: 1 } } },
    }
    const agents = {
      create: async () => ({ agent: LIVE_AGENT, dispose: async () => {} }),
      resume: async () => ({ agent: LIVE_AGENT, dispose: async () => {} }),
      get: (id: string) => (id === AGENT_ID ? LIVE_AGENT : undefined),
    }
    const ctx = {
      get: (name: string) => (name === 'goals' ? goalsSvc : name === 'agents' ? agents : undefined),
    } as unknown as BridgeContext

    // Injection point documented by direct assertion: production resolver is the
    // existing agents registry path, and unknown context / absent registry fail closed.
    const prod = createProductionGenericConfig(ctx)
    expect(await prod.resolveScope?.('agent', 'agentId', AGENT_ID)).toBe(LIVE_AGENT)
    expect(await prod.resolveScope?.('other', 'agentId', AGENT_ID)).toBeUndefined()
    const noAgents = createProductionGenericConfig({ get: () => undefined } as unknown as BridgeContext)
    expect(await noAgents.resolveScope?.('agent', 'agentId', AGENT_ID)).toBeUndefined()

    const invoke = createCapHostInvoke(ctx) // production generic config (no override)
    await invoke(GOALS.get as never, 'unary', { agentId: AGENT_ID })
    const request = { objective: 'probe' }
    await invoke(GOALS.create as never, 'unary', { agentId: AGENT_ID, request })

    expect(calls.get![0]).toEqual([LIVE_AGENT])
    expect(calls.get![0]![0]).toBe(LIVE_AGENT)
    expect(calls.create![0]).toEqual([LIVE_AGENT, request])
    expect(calls.create![0]![0]).toBe(LIVE_AGENT)

    // The raw agentId string must NEVER reach the host as the live-agent arg.
    for (const args of Object.values(calls).flat()) expect(args[0]).not.toBe(AGENT_ID)
  })

  // E5: a lookup failure for an unlive id is a hard error through the full
  // dispatcher path too (real seam degrades honestly — no fabricated success).
  test('E5 — production path unlive agent id -> BAD_PARAMS with full id, no host call', async () => {
    let hostCalls = 0
    const goalsSvc = { get: (..._a: unknown[]) => { hostCalls++; return {} } }
    const agents = {
      create: async () => ({ agent: LIVE_AGENT, dispose: async () => {} }),
      resume: async () => ({ agent: LIVE_AGENT, dispose: async () => {} }),
      get: () => undefined, // no live agent for the wire id
    }
    const ctx = {
      get: (name: string) => (name === 'goals' ? goalsSvc : name === 'agents' ? agents : undefined),
    } as unknown as BridgeContext
    const invoke = createCapHostInvoke(ctx)
    const msg = await rejectionMessage(() => invoke(GOALS.get as never, 'unary', { agentId: 'unlive-agent-x' }))
    expect(msg).toContain('BAD_PARAMS: ' + GOALS.get + ' agentId scope lookup agent failed for id "unlive-agent-x"')
    expect(hostCalls).toBe(0)
  })
})
