/**
 * ADR-0011 T4 — unit tests for the host-side waterfall answerers.
 *
 * Fake-ctx discipline mirrors ask-dispatch.test.ts: install a fake cordis ctx
 * plus fake stdin/stdout, drive the real `apply()` over the NDJSON wire, and
 * invoke the registered `approval/request` / `user-questions/request` listeners
 * directly (that is exactly how cordis `waterfall` calls them — see events.ts:
 * `dispatch()` binds each `ctx.on` hook with the trailing `next`). No host
 * package, no seam/UI, no model turn: the turn is held open by a never-settling
 * `whenIdle()` and the host request is synthetic.
 *
 * Locked behaviour:
 *  - both answerers register on `ctx.on` and the plugin stays live when `ctx.on`
 *    is missing or throws (containment → bridge.ping still answers);
 *  - approval + questions requests push a source-verified `ask.request`;
 *  - verdict / answers map back to the host shapes; abort maps to 'cancelled';
 *  - no deliverable turn → fail-closed (ASK_CHANNEL_UNAVAILABLE, no frame);
 *  - terminal / teardown settles the answerer promise (never hangs).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { apply, getAskRegistry, resolveAskDeadlineMs } from '../src/index'
import { resolveMaxAskWaitMs } from '../src/index'
import { DEFAULT_MAX_ASK_WAIT_MS } from '../src/ask-registry'
import { ASK_ERROR_CODES } from '../src/ask-frames'
import { getSubagentIndex } from '../src/subagent-index'
import type { AskRegistry } from '../src/ask-registry'

const STDIO_SWITCH = 'DSH_OPENTUI_BRIDGE_STDIO'
type Frame = Record<string, any>

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
/** A promise race used to PROVE an answerer settled (a hang fails the test). */
async function mustSettle<T>(p: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`answerer promise hung: ${label}`)), 800)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

interface Harness {
  frames: string[]
  registry: AskRegistry
  ctx: any
  /** S1: formatted logger.warn calls, including construction-time config warns. */
  warns: string[]
  listeners: Map<string, Array<(...args: any[]) => any>>
  send(frame: unknown): void
  latest(id: number | string): Frame | undefined
  waitFor(id: number | string): Promise<Frame>
  emitSessionEvent(session: unknown, event: unknown): void
  emitHost(name: string, request: unknown): Promise<any>[]
  /** Faithful cordis waterfall dispatch: hooks run in registration order and
   *  only advance when the current listener calls next(). Used by the ask-slot
   *  arbitration regression tests; `emitHost` above is deliberately left as the
   *  legacy "call every listener independently + throwing next" helper so its
   *  existing assertions stay byte-for-byte valid. */
  emitHostWaterfall(name: string, request: unknown): Promise<any>
  askFrames(type: string): Frame[]
  dispose(): void
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function makeHarness(overrides: {
  onThrows?: boolean
  noOn?: boolean
  askDeadlineMs?: unknown
  /** R3: inject the profile-patch hard cap at the real construction point. */
  maxAskWaitMs?: unknown
  /** Install a fake cordis `ctx.get` (the base fake has none, so the catalog
   *  re-pin guard early-returns). Used by the F1 policy-inheritance tests to
   *  actually reach `ctx.get('sessions'/'approval')`. */
  repinGet?: (name: string) => unknown
  /** Register listeners BEFORE `apply()` arms the bridge answerers, to exercise
   *  router-first waterfall ordering (companion mounted ahead of bridge). */
  preRegister?: (ctx: any) => void
} = {}): Harness {
  const previousSwitch = process.env[STDIO_SWITCH]
  process.env[STDIO_SWITCH] = '1'

  const originalWrite = process.stdout.write.bind(process.stdout)
  const frames: string[] = []
  const patchedWrite = function (this: unknown, chunk: any, ...rest: any[]) {
    const text = String(chunk)
    frames.push(text)
    let parsed: any
    try {
      parsed = JSON.parse(text.trim())
    } catch {
      /* plain reporter output */
    }
    const isBridgeFrame =
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      ('ok' in parsed || 'type' in parsed) &&
      ('id' in parsed || 'payload' in parsed || 'result' in parsed || 'error' in parsed)
    if (isBridgeFrame) return true
    return originalWrite(chunk, ...rest)
  } as typeof process.stdout.write
  process.stdout.write = patchedWrite

  const stdinListeners: Record<string, Array<(...args: any[]) => void>> = {}
  const fakeStdin = {
    setEncoding() {},
    on(name: string, fn: (...args: any[]) => void) {
      ;(stdinListeners[name] ||= []).push(fn)
      return fakeStdin
    },
    off(name: string, fn: (...args: any[]) => void) {
      stdinListeners[name] = (stdinListeners[name] || []).filter((f) => f !== fn)
      return fakeStdin
    },
    once(name: string, fn: (...args: any[]) => void) {
      ;(stdinListeners[name] ||= []).push(fn)
      return fakeStdin
    },
    pause() { return fakeStdin },
    resume() { return fakeStdin },
  }
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true })

  const listeners = new Map<string, Array<(...args: any[]) => any>>()
  const agent = {
    status: 'idle',
    session: { seq: 0 },
    followup() {},
    steer() {},
    cancel() {},
    whenIdle() {
      return new Promise<void>(() => {}) // hold the turn open
    },
  }
  let disposeBridge: (() => void) | undefined
  const warns: string[] = []
  const ctx: any = {
    logger: { info() {}, warn(format: unknown, ...params: unknown[]) { warns.push(`${String(format)} ${params.map(String).join(' ')}`) }, error() {}, debug() {} },
    effect(execute: () => () => void) {
      disposeBridge = execute()
      return { dispose: () => disposeBridge?.() }
    },
    on(name: string, listener: (...args: any[]) => any) {
      // Only the two ask answerers throw; the pre-existing turn subscriptions
      // must register so the test isolates T4's containment, not T2's.
      if (overrides.onThrows && (name === 'approval/request' || name === 'user-questions/request')) {
        throw new Error('cannot register listener: fiber inactive')
      }
      const next = [...(listeners.get(name) || []), listener]
      listeners.set(name, next)
      return () => listeners.set(name, next.filter((l) => l !== listener))
    },
    agents: {
      async create() { return { agent, dispose: async () => {} } },
      async resume() { return { agent, dispose: async () => {} } },
      get() { return undefined },
    },
  }
  if (overrides.repinGet !== undefined) ctx.get = overrides.repinGet
  if (overrides.noOn) delete ctx.on
  // Router-first ordering: register the companion listener before apply() arms
  // the bridge answerers, so the waterfall hook order is [router, bridge].
  overrides.preRegister?.(ctx)
  // F1-A2: the construction point reads askDeadlineMs from the plugin config.
  const config = overrides.askDeadlineMs !== undefined ? { askDeadlineMs: overrides.askDeadlineMs } : {}
  // R3: maxAskWaitMs is additive — existing callers keep the 1h default.
  if (overrides.maxAskWaitMs !== undefined) Object.assign(config, { maxAskWaitMs: overrides.maxAskWaitMs })
  // apply() must never throw even when ctx.on is missing or throws.
  apply(ctx, config)
  const registry = getAskRegistry(ctx)
  if (registry === undefined) throw new Error('apply() did not register an AskRegistry')

  cleanups.push(() => {
    try { disposeBridge?.() } catch { /* already torn down */ }
    process.stdout.write = originalWrite
    if (stdinDescriptor) Object.defineProperty(process, 'stdin', stdinDescriptor)
    else delete (process as any).stdin
    if (previousSwitch === undefined) delete process.env[STDIO_SWITCH]
    else process.env[STDIO_SWITCH] = previousSwitch
  })

  const latest = (id: number | string): Frame | undefined => {
    for (let i = frames.length - 1; i >= 0; i--) {
      try {
        const frame = JSON.parse(frames[i])
        if (frame !== null && typeof frame === 'object' && frame.id === id) return frame
      } catch { /* non-frame stdout noise */ }
    }
    return undefined
  }
  const waitFor = async (id: number | string): Promise<Frame> => {
    const deadline = Date.now() + 2000
    for (;;) {
      const frame = latest(id)
      if (frame !== undefined) return frame
      if (Date.now() > deadline) throw new Error(`no response frame for id=${id}`)
      await sleep(1)
    }
  }

  return {
    frames,
    registry,
    ctx,
    warns,
    listeners,
    send(frame: unknown) {
      const line = `${JSON.stringify(frame)}\n`
      for (const fn of stdinListeners['data'] || []) fn(line)
    },
    latest,
    waitFor,
    emitSessionEvent(session: unknown, event: unknown) {
      for (const fn of listeners.get('session/event') || []) fn(session, event)
    },
    emitHost(name: string, request: unknown): Promise<any>[] {
      // cordis waterfall: each listener is called with (request, next). Our
      // answerers claim by never calling next; `next` here is a fail-safe stub.
      return (listeners.get(name) || []).map((fn) =>
        Promise.resolve(fn(request, async () => { throw new Error('next() must not be reached when the bridge claims the ask') })),
      )
    },
    emitHostWaterfall(name: string, request: unknown): Promise<any> {
      // Faithful port of cordis `waterfall()` (events.ts:237-260): hooks run in
      // registration order; a listener that never calls next() vetoes the rest
      // of the chain; next() advances exactly one listener and throws on a
      // second call. The innermost `next` is the built-in behavior — here a
      // hard reject so "nobody claimed the ask" can never read as a green.
      const hooks = [...(listeners.get(name) || [])]
      const dispatch = (): Promise<any> => {
        const fn = hooks.shift()
        if (fn === undefined) {
          return Promise.reject(new Error(`waterfall exhausted: no answerer claimed ${name}`))
        }
        let nextCalled = false
        const next = (): Promise<any> => {
          if (nextCalled) throw new Error('next() called multiple times')
          nextCalled = true
          return dispatch()
        }
        return Promise.resolve(fn(request, next))
      }
      return dispatch()
    },
    askFrames(type: string) {
      const out: Frame[] = []
      for (const line of frames) {
        try {
          const frame = JSON.parse(line)
          if (frame?.type === type) out.push(frame)
        } catch { /* ignore */ }
      }
      return out
    },
    dispose() { disposeBridge?.() },
  }
}

async function startTurn(h: Harness, id: number): Promise<{ sessionId: string; turnId: string }> {
  h.send({ id, method: 'session.open', params: { mode: 'new' } })
  const opened = await h.waitFor(id)
  expect(opened.ok).toBe(true)
  const sessionId = opened.result.sessionId as string
  h.send({ id: id + 1, method: 'session.send', params: { text: 'hello' } })
  const sent = await h.waitFor(id + 1)
  expect(sent.ok).toBe(true)
  return { sessionId, turnId: sent.result.turnId as string }
}

const approvalReq = (sessionId: string, extra: Record<string, unknown> = {}) => ({
  agent: { session: { id: sessionId } },
  toolName: 'bash',
  callId: 'call-1',
  reason: 'needs sandbox write access',
  ...extra,
})

describe('ADR-0011 T4 — answerer registration + containment', () => {
  test('registers both waterfall answerers on ctx.on', () => {
    const h = makeHarness()
    expect((h.listeners.get('approval/request') || []).length).toBe(1)
    expect((h.listeners.get('user-questions/request') || []).length).toBe(1)
  })

  test('missing ctx.on does not throw / does not make the plugin pending (ping still works)', async () => {
    const h = makeHarness({ noOn: true })
    expect((h.listeners.get('approval/request') || []).length).toBe(0)
    h.send({ id: 7, method: 'bridge.ping' })
    const reply = await h.waitFor(7)
    expect(reply.ok).toBe(true)
    expect(reply.result.protocolVersion).toBe(1)
  })

  test('throwing ctx.on is contained: apply() survives and ping still works', async () => {
    const h = makeHarness({ onThrows: true })
    h.send({ id: 8, method: 'bridge.ping' })
    const reply = await h.waitFor(8)
    expect(reply.ok).toBe(true)
    expect(reply.result.protocolVersion).toBe(1)
  })
})

describe('ADR-0011 T4 — approval ask.request push + verdict mapping', () => {
  test('push fields match ADR-0011 §3.2, allowed-once maps back to the host', async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h, 1)

    const pending = h.emitHost('approval/request', approvalReq(sessionId))[0]
    await sleep(0)
    const asks = h.askFrames('ask.request').filter((f) => f.payload.sessionId === sessionId)
    expect(asks).toHaveLength(1)
    const payload = asks[0].payload
    expect(payload.eventId).toBe(`${turnId}:ask-1`)
    expect(payload.sessionId).toBe(sessionId)
    expect(payload.kind).toBe('approval')
    expect(payload.toolName).toBe('bash')
    expect(payload.callId).toBe('call-1')
    expect(payload.reason).toBe('needs sandbox write access')
    expect(payload.escalation).toBe(true) // ADR-0011 Q3/D7: bridge grants escalation on approval asks

    h.send({ id: 10, method: 'ask.response', params: { eventId: payload.eventId, kind: 'approval', verdict: 'allowed-once' } })
    expect((await h.waitFor(10)).ok).toBe(true)
    expect(await mustSettle(pending, 'allowed-once')).toBe('allowed-once')
  })

  test('rejected verdict maps to host "rejected"', async () => {
    const h = makeHarness()
    const { sessionId } = await startTurn(h, 1)
    const pending = h.emitHost('approval/request', approvalReq(sessionId))[0]
    await sleep(0)
    const payload = h.askFrames('ask.request').at(-1)!.payload
    h.send({ id: 11, method: 'ask.response', params: { eventId: payload.eventId, kind: 'approval', verdict: 'rejected' } })
    expect((await h.waitFor(11)).ok).toBe(true)
    expect(await mustSettle(pending, 'rejected')).toBe('rejected')
  })

  test('unavailable verdict maps to host "unavailable"', async () => {
    const h = makeHarness()
    const { sessionId } = await startTurn(h, 1)
    const pending = h.emitHost('approval/request', approvalReq(sessionId))[0]
    await sleep(0)
    const payload = h.askFrames('ask.request').at(-1)!.payload
    h.send({ id: 12, method: 'ask.response', params: { eventId: payload.eventId, kind: 'approval', verdict: 'unavailable' } })
    expect((await h.waitFor(12)).ok).toBe(true)
    expect(await mustSettle(pending, 'unavailable')).toBe('unavailable')
  })

  test('host signal abort settles the answerer as "cancelled" with no client response', async () => {
    const h = makeHarness()
    const { sessionId } = await startTurn(h, 1)
    const controller = new AbortController()
    const pending = h.emitHost('approval/request', approvalReq(sessionId, { signal: controller.signal }))[0]
    await sleep(0)
    expect(h.askFrames('ask.request')).toHaveLength(1)
    controller.abort()
    expect(await mustSettle(pending, 'abort')).toBe('cancelled')
  })
})

describe('ADR-0011 T4 — user-questions mapping', () => {
  test('question fields projected into ask.request and answers mapped back', async () => {
    const h = makeHarness()
    const { sessionId } = await startTurn(h, 1)
    const request = {
      agent: { session: { id: sessionId } },
      questions: [{
        id: 'q1',
        question: 'Which DB?',
        header: 'Storage',
        detail: 'pick one',
        options: [{ label: 'Postgres', description: 'relational' }, { label: 'SQLite' }],
        multiSelect: false,
      }],
      wait: { callId: 'call-q' },
    }
    const pending = h.emitHost('user-questions/request', request)[0]
    await sleep(0)
    const payload = h.askFrames('ask.request').at(-1)!.payload
    expect(payload.kind).toBe('questions')
    expect(payload.callId).toBe('call-q')
    expect(payload.questions).toEqual([{
      id: 'q1',
      prompt: 'Which DB?',
      header: 'Storage',
      detail: 'pick one',
      options: [{ label: 'Postgres', description: 'relational' }, { label: 'SQLite' }],
    }])

    h.send({ id: 13, method: 'ask.response', params: {
      eventId: payload.eventId, kind: 'questions', answers: [{ id: 'q1', selected: ['Postgres'] }],
    } })
    expect((await h.waitFor(13)).ok).toBe(true)
    expect(await mustSettle(pending, 'questions')).toEqual({ answers: [{ id: 'q1', selected: ['Postgres'] }] })
  })
})

describe('ADR-0011 T4 — fail-closed + cleanup settle', () => {
  // Regression: the DEFAULT inproc startup (no --session) now stages
  // session.open{mode:'new'} on the first turn. The claims gate (askTarget)
  // must accept that freshly-created binding + its live turn and PUSH the
  // ask.request frame — never mis-route it to failClosedAsk, which would
  // settle 'unavailable' with no card on the client.
  test('default-path session.open{mode:new} binding is NOT mis-rejected by the claims gate', async () => {
    const h = makeHarness()
    const { sessionId } = await startTurn(h, 1) // session.open{mode:'new'} + session.send
    const pending = h.emitHost('approval/request', approvalReq(sessionId))[0]
    await sleep(0)

    // The ask was delivered, not fail-closed.
    const asks = h.askFrames('ask.request').filter((f) => f.payload.sessionId === sessionId)
    expect(asks).toHaveLength(1)
    expect(h.registry.settlements()).toHaveLength(0)
    // Answer it to prove the host verdict round-trips (card reachability).
    h.send({ id: 20, method: 'ask.response', params: {
      eventId: asks[0].payload.eventId, kind: 'approval', verdict: 'allowed-once',
    } })
    expect((await h.waitFor(20)).ok).toBe(true)
    expect(await mustSettle(pending, 'default-path ask')).toBe('allowed-once')
  })

  test('no open turn: no ask.request frame, ASK_CHANNEL_UNAVAILABLE settle, host fails closed', async () => {
    const h = makeHarness()
    const pending = h.emitHost('approval/request', approvalReq('no-session'))[0]
    expect(await mustSettle(pending, 'fail-closed')).toBe('unavailable')
    expect(h.askFrames('ask.request')).toHaveLength(0)
    const settled = h.askFrames('ask.settled')
    expect(settled).toHaveLength(1)
    expect(settled[0].payload.outcome).toBe('unavailable')
    const record = h.registry.settlements()[0]
    expect(record.code).toBe(ASK_ERROR_CODES.CHANNEL_UNAVAILABLE)
  })

  test('foreign session request is NOT delivered (claims gate), fails closed', async () => {
    const h = makeHarness()
    await startTurn(h, 1)
    const pending = h.emitHost('approval/request', approvalReq('foreign-session'))[0]
    expect(await mustSettle(pending, 'foreign')).toBe('unavailable')
    expect(h.askFrames('ask.request')).toHaveLength(0)
    expect(h.registry.settlements()[0].code).toBe(ASK_ERROR_CODES.CHANNEL_UNAVAILABLE)
  })

  test('turn terminal clears the ask and settles the answerer (no hang)', async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h, 1)
    const pending = h.emitHost('approval/request', approvalReq(sessionId))[0]
    await sleep(0)
    expect(h.askFrames('ask.request')).toHaveLength(1)

    // A terminal turn funnels through finalizeTurn → ask.clearTurn → ask.settled.
    h.send({ id: 10, method: 'turn.abort', params: { turnId } })
    await h.waitFor(10)
    h.emitSessionEvent({ id: sessionId }, { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { code: 'USER_ABORT' } } } })
    expect(await mustSettle(pending, 'turn terminal')).toBe('cancelled')
    expect(h.askFrames('ask.cancel').some((f) => f.payload.eventId === `${turnId}:ask-1`)).toBe(true)
  })

  test('connection teardown settles every answerer promise (never hangs)', async () => {
    const h = makeHarness()
    const { sessionId } = await startTurn(h, 1)
    const pending = h.emitHost('approval/request', approvalReq(sessionId))[0]
    await sleep(0)
    expect(h.askFrames('ask.request')).toHaveLength(1)
    h.dispose()
    h.dispose() // idempotent
    expect(await mustSettle(pending, 'teardown')).toBe('cancelled')
    expect(h.registry.timerCount()).toBe(0)
  })

  // Real disposeBinding ordering, not registry.clearTurn/clearSession called
  // from the test: finalizeTurn (→ turn-ended) MUST win on the active turn's
  // ask before clearSession (→ session-closed) reaches the other-turn ask.
  test('session.close: activeTurn ask settles turn-ended, other-turn same-session pending settles session-closed', async () => {
    const h = makeHarness()
    const { sessionId } = await startTurn(h, 1)

    // A: a real host answerer, delivered on the active turn of this session.
    const pendingA = h.emitHost('approval/request', approvalReq(sessionId))[0]
    await sleep(0)
    const askA = h.askFrames('ask.request').filter((f) => f.payload.sessionId === sessionId).at(-1)!.payload

    // B: another pending ask on the SAME session but a DIFFERENT turnId. It is
    // staged on the registry only to set up state; every settlement below is
    // driven by the real session.close → disposeBinding orchestration.
    const askB = h.registry.create('other-turn', { sessionId, kind: 'approval', toolName: 'write' })
    expect(h.registry.pendingIds()).toContain(askA.eventId)
    expect(h.registry.pendingIds()).toContain(askB.eventId)

    h.send({ id: 40, method: 'session.close', params: {} })
    expect((await h.waitFor(40)).ok).toBe(true)

    expect(await mustSettle(pendingA, 'A on session.close')).toBe('cancelled')
    const reasons = new Map<string, string | undefined>()
    for (const frame of h.askFrames('ask.settled')) reasons.set(frame.payload.eventId, frame.payload.reason)
    expect(reasons.get(askA.eventId)).toBe('turn-ended')
    expect(reasons.get(askB.eventId)).toBe('session-closed')
    expect(h.registry.pendingIds()).not.toContain(askA.eventId)
    expect(h.registry.pendingIds()).not.toContain(askB.eventId)
  })
})

describe('F1-A1 — multi-session ask routing (catalog-driven child → parent ask channel)', () => {
  const CHILD = 'child-session-1'

  /** The parent journal's `subagent/catalog` row is the ONLY fact that creates
   *  an ask-routing target — mirroring the host's `establishCatalogChild`. */
  function registerChild(h: Harness, childId: string, parent: string): void {
    h.emitSessionEvent({ id: parent }, { type: 'subagent/catalog', data: { childId, childCreatedAt: 1 } })
  }

  test('catalog-registered child ask routes onto the parent channel with identity fields and round-trips', async () => {
    const h = makeHarness()
    const { sessionId: parent, turnId } = await startTurn(h, 1)
    registerChild(h, CHILD, parent)

    const pending = h.emitHost('approval/request', approvalReq(CHILD))[0]
    await sleep(0)

    const asks = h.askFrames('ask.request')
    expect(asks).toHaveLength(1)
    const payload = asks[0].payload
    // Delivery addressee stays the parent: ask.response / grant / clearSession
    // all still key on the bound session, so the card is answerable.
    expect(payload.sessionId).toBe(parent)
    expect(payload.eventId).toBe(`${turnId}:ask-1`)
    expect(payload.kind).toBe('approval')
    expect(payload.childSessionId).toBe(CHILD)
    expect(payload.parentSessionId).toBe(parent)

    h.send({ id: 20, method: 'ask.response', params: {
      eventId: payload.eventId, kind: 'approval', verdict: 'allowed-once',
    } })
    expect((await h.waitFor(20)).ok).toBe(true)
    expect(await mustSettle(pending, 'routed child ask')).toBe('allowed-once')
    // The answer reached the registry as a normal settlement, not a fail-closed.
    expect(h.registry.settlements()[0].outcome).toBe('approved')
  })

  test('parent ask is unchanged: no child identity fields on the frame', async () => {
    const h = makeHarness()
    const { sessionId: parent } = await startTurn(h, 1)
    registerChild(h, CHILD, parent) // presence of a child must not alter a parent ask

    const pending = h.emitHost('approval/request', approvalReq(parent))[0]
    await sleep(0)
    const payload = h.askFrames('ask.request').at(-1)!.payload
    expect(payload.sessionId).toBe(parent)
    expect(payload.childSessionId).toBeUndefined()
    expect(payload.parentSessionId).toBeUndefined()

    h.send({ id: 21, method: 'ask.response', params: {
      eventId: payload.eventId, kind: 'approval', verdict: 'allowed-once',
    } })
    expect((await h.waitFor(21)).ok).toBe(true)
    expect(await mustSettle(pending, 'parent regression')).toBe('allowed-once')
  })

  test('unknown child and child of another parent stay fail-closed (no frame)', async () => {
    const h = makeHarness()
    const { sessionId: parent } = await startTurn(h, 1)
    // A target row only count when its parentSessionId is THIS binding.
    getSubagentIndex(h.ctx).noteCatalog('child-of-other', 'other-parent')

    const unknown = h.emitHost('approval/request', approvalReq('never-registered'))[0]
    expect(await mustSettle(unknown, 'unknown child')).toBe('unavailable')
    const foreign = h.emitHost('approval/request', approvalReq('child-of-other'))[0]
    expect(await mustSettle(foreign, 'child of different parent')).toBe('unavailable')

    expect(h.askFrames('ask.request')).toHaveLength(0)
    expect(h.registry.settlements().map((s) => s.code)).toEqual([
      ASK_ERROR_CODES.CHANNEL_UNAVAILABLE,
      ASK_ERROR_CODES.CHANNEL_UNAVAILABLE,
    ])
  })

  test('settled child no longer routes (fail-closed)', async () => {
    const h = makeHarness()
    const { sessionId: parent } = await startTurn(h, 1)
    registerChild(h, CHILD, parent)
    // The child's own turn/end flips its index status to settled.
    h.emitSessionEvent({ id: CHILD }, { type: 'turn/end', data: {} })

    const pending = h.emitHost('approval/request', approvalReq(CHILD))[0]
    expect(await mustSettle(pending, 'settled child')).toBe('unavailable')
    expect(h.askFrames('ask.request')).toHaveLength(0)
  })

  test('no in-flight turn fails closed even for a registered child (regression)', async () => {
    const h = makeHarness()
    // No session.open / session.send → no binding, no activeTurn.
    getSubagentIndex(h.ctx).noteCatalog(CHILD, 'parent-with-no-turn')
    const pending = h.emitHost('approval/request', approvalReq(CHILD))[0]
    expect(await mustSettle(pending, 'registered child but no turn')).toBe('unavailable')
    expect(h.askFrames('ask.request')).toHaveLength(0)
    expect(h.registry.settlements()[0].code).toBe(ASK_ERROR_CODES.CHANNEL_UNAVAILABLE)
  })
})

describe('F1-A2 — askDeadlineMs config wiring + timeout outcome decision', () => {
  test('config askDeadlineMs times out an approval as denied (host sees rejected)', async () => {
    const h = makeHarness({ askDeadlineMs: 20 })
    const { sessionId } = await startTurn(h, 1)
    const pending = h.emitHost('approval/request', approvalReq(sessionId))[0]
    expect(h.registry.timerCount()).toBe(2) // deadline + hard cap
    await sleep(70)

    const settled = h.registry.settlements()[0]
    expect(settled.outcome).toBe('denied') // F1-A2 decision: timeout = denied, not unavailable
    expect(settled.code).toBe(ASK_ERROR_CODES.DEADLINE_EXCEEDED)
    expect(await mustSettle(pending, 'timed-out approval')).toBe('rejected')
    expect(h.askFrames('ask.settled').some((f) =>
      f.payload.eventId === settled.eventId && f.payload.outcome === 'denied')).toBe(true)
    expect(h.askFrames('ask.cancel').some((f) => f.payload.reason === 'deadline')).toBe(true)
  })

  test('default config keeps askDeadlineMs=null: no per-ask wall clock (regression)', async () => {
    const h = makeHarness()
    const { sessionId } = await startTurn(h, 1)
    const pending = h.emitHost('approval/request', approvalReq(sessionId))[0]
    await sleep(0)
    expect(h.registry.timerCount()).toBe(1) // hard cap only
    await sleep(60)
    expect(h.registry.settlements()).toHaveLength(0)
    expect(h.registry.pendingCount()).toBe(1)

    const ask = h.askFrames('ask.request').at(-1)!.payload
    h.send({ id: 30, method: 'ask.response', params: { eventId: ask.eventId, kind: 'approval', verdict: 'allowed-once' } })
    expect((await h.waitFor(30)).ok).toBe(true)
    expect(await mustSettle(pending, 'answered while default deadline off')).toBe('allowed-once')
  })

  test('F1 routing coexists: catalog-routed child ask also times out denied', async () => {
    const h = makeHarness({ askDeadlineMs: 20 })
    const { sessionId: parent } = await startTurn(h, 1)
    h.emitSessionEvent({ id: parent }, { type: 'subagent/catalog', data: { childId: 'child-deadline', childCreatedAt: 1 } })
    const pending = h.emitHost('approval/request', approvalReq('child-deadline'))[0]
    await sleep(0)
    const ask = h.askFrames('ask.request').at(-1)!.payload
    expect(ask.sessionId).toBe(parent)
    expect(ask.childSessionId).toBe('child-deadline')

    await sleep(70)
    expect(h.registry.settlements()[0].outcome).toBe('denied')
    expect(h.registry.settlements()[0].code).toBe(ASK_ERROR_CODES.DEADLINE_EXCEEDED)
    expect(await mustSettle(pending, 'timed-out child ask')).toBe('rejected')
  })

  // oldfox S1: config validation at the single construction point.
  test('S1: non-number / NaN / negative askDeadlineMs is ignored with ONE warn', async () => {
    const warns: unknown[][] = []
    const warn = (...args: unknown[]) => { warns.push(args) }
    for (const raw of ['20', NaN, -1]) {
      expect(resolveAskDeadlineMs(raw, DEFAULT_MAX_ASK_WAIT_MS, warn)).toBeNull()
    }
    expect(warns).toHaveLength(3) // one warn per ignored config, not one per ask

    // The real apply() path uses the same helper and warns at construction.
    const h = makeHarness({ askDeadlineMs: -1 })
    expect(h.warns.filter((line) => line.includes('invalid askDeadlineMs'))).toHaveLength(1)
    const { sessionId } = await startTurn(h, 1)
    h.emitHost('approval/request', approvalReq(sessionId))
    await sleep(0)
    expect(h.registry.timerCount()).toBe(1) // hard cap only — no per-ask clock
  })

  test('S1: askDeadlineMs above maxAskWaitMs is clamped to the hard cap with ONE warn', async () => {
    const warns: unknown[][] = []
    const warn = (...args: unknown[]) => { warns.push(args) }
    expect(resolveAskDeadlineMs(DEFAULT_MAX_ASK_WAIT_MS + 1, DEFAULT_MAX_ASK_WAIT_MS, warn)).toBe(DEFAULT_MAX_ASK_WAIT_MS)
    expect(warns).toHaveLength(1)
    expect(String(warns[0]![0])).toContain('clamped')

    const h = makeHarness({ askDeadlineMs: DEFAULT_MAX_ASK_WAIT_MS + 1 })
    expect(h.warns.filter((line) => line.includes('clamped to hard cap'))).toHaveLength(1)
    const { sessionId } = await startTurn(h, 1)
    h.emitHost('approval/request', approvalReq(sessionId))
    await sleep(0)
    expect(h.registry.timerCount()).toBe(2) // deadline (at the cap) + hard cap still armed
  })
})

/**
 * R3 — profile-patch `maxAskWaitMs` hard-cap override. Pure-function cases are
 * environment-independent; the apply() cases drive the real construction point
 * over the NDJSON wire, never a registry method call.
 */
describe('R3 — maxAskWaitMs config validation + hard cap', () => {
  test('E1: valid positive integer (incl. the default) passes through with no warn', () => {
    const warns: unknown[][] = []
    const warn = (...args: unknown[]) => { warns.push(args) }
    expect(resolveMaxAskWaitMs(25, DEFAULT_MAX_ASK_WAIT_MS, warn)).toBe(25)
    expect(resolveMaxAskWaitMs(DEFAULT_MAX_ASK_WAIT_MS, DEFAULT_MAX_ASK_WAIT_MS, warn)).toBe(DEFAULT_MAX_ASK_WAIT_MS)
    expect(resolveMaxAskWaitMs(undefined, DEFAULT_MAX_ASK_WAIT_MS, warn)).toBe(DEFAULT_MAX_ASK_WAIT_MS)
    expect(resolveMaxAskWaitMs(null, DEFAULT_MAX_ASK_WAIT_MS, warn)).toBe(DEFAULT_MAX_ASK_WAIT_MS)
    expect(warns).toHaveLength(0)
  })

  test('E2: non-number / NaN / 0 / negative / fractional / Infinity / above cap are ignored + one warn each', () => {
    const warns: unknown[][] = []
    const warn = (...args: unknown[]) => { warns.push(args) }
    const invalid: unknown[] = ['25', NaN, 0, -1, 1.5, Infinity, DEFAULT_MAX_ASK_WAIT_MS + 1]
    for (const raw of invalid) expect(resolveMaxAskWaitMs(raw, DEFAULT_MAX_ASK_WAIT_MS, warn)).toBe(DEFAULT_MAX_ASK_WAIT_MS)
    expect(warns).toHaveLength(invalid.length) // exactly one warn per ignored config, not per ask
    for (const args of warns) expect(String(args[0])).toContain('invalid maxAskWaitMs')
  })

  test('E3: config maxAskWaitMs shrinks the hard cap at the real apply() construction point', async () => {
    const h = makeHarness({ maxAskWaitMs: 25 })
    const { sessionId } = await startTurn(h, 1)
    const pending = h.emitHost('approval/request', approvalReq(sessionId))[0]
    expect(h.registry.timerCount()).toBe(1) // hard cap only — askDeadlineMs still null
    await mustSettle(pending, 'R3 hard cap')

    const ask = h.askFrames('ask.request').at(-1)!.payload
    const settled = h.registry.settlements().filter((s) => s.eventId === ask.eventId)
    expect(settled).toHaveLength(1) // first-wins: no second terminal
    expect(settled[0].outcome).toBe('unavailable') // D6 fail-closed
    expect(settled[0].code).toBe(ASK_ERROR_CODES.DEADLINE_EXCEEDED)
    expect(settled[0].message).toContain('maxAskWaitMs')
    // settleReason rides on ask.settled.reason (journal `settleReason` is
    // asserted by the real-journal driver, not this fake ctx).
    const terminals = h.askFrames('ask.settled').filter((f) => f.payload.eventId === ask.eventId)
    expect(terminals).toHaveLength(1)
    expect(terminals[0].payload.reason).toBe('timeout')
    expect(h.askFrames('ask.cancel').some((f) => f.payload.eventId === ask.eventId && f.payload.reason === 'deadline')).toBe(true)
  })

  test('E4: invalid config never shrinks or zeroes the cap (one warn at construction)', async () => {
    for (const raw of [-1, '25']) {
      const h = makeHarness({ maxAskWaitMs: raw })
      expect(h.warns.filter((line) => line.includes('invalid maxAskWaitMs'))).toHaveLength(1)
      const { sessionId } = await startTurn(h, 1)
      h.emitHost('approval/request', approvalReq(sessionId))
      await sleep(0)
      expect(h.registry.timerCount()).toBe(1) // 1h default still armed
      expect(h.registry.settlements()).toHaveLength(0) // no short-cap settlement
      h.dispose()
    }
  })

  test('E4b: askDeadlineMs clamps to the EFFECTIVE (injected) cap, not the 1h default', async () => {
    const h = makeHarness({ maxAskWaitMs: 100, askDeadlineMs: 200 })
    expect(h.warns.filter((line) => line.includes('clamped to hard cap'))).toHaveLength(1)
    const { sessionId } = await startTurn(h, 1)
    h.emitHost('approval/request', approvalReq(sessionId))
    await sleep(0)
    expect(h.registry.timerCount()).toBe(2) // deadline at 100 + hard cap at 100
  })
})

/**
 * R3 harness hook for the real turn.abort chain. Production semantics are NOT
 * touched: `handleAbort` (index.ts:4307) calls
 * `agent.cancel({kind:'user'},{keepInbox:true})`, which fires the active
 * driver's AbortSignal; that signal is the host request `signal` read by
 * `onApprovalRequest` and passed to `waitForAnswerer`, whose `onAbort` calls
 * `ask.settleExternal(eventId, {settleReason:'aborted'})` (index.ts:2809).
 * The fake agent's cancel() is a no-op, so this hook hands a REAL AbortSignal
 * to the host request and aborts it — the same terminal the driver fires.
 */
function turnAbortableRequest(request: Record<string, unknown>) {
  const controller = new AbortController()
  return { ...request, signal: controller.signal, abortTurn: () => controller.abort() }
}

describe('R3 — host abort signal reaches settleExternal(aborted)', () => {
  test('E6-unit: signal abort settles an in-flight approval as aborted, not timeout', async () => {
    const h = makeHarness()
    const { sessionId } = await startTurn(h, 1)
    const req = turnAbortableRequest(approvalReq(sessionId))
    const pending = h.emitHost('approval/request', req)[0]
    await sleep(0)
    const ask = h.askFrames('ask.request').at(-1)!.payload
    expect(h.registry.settlements()).toHaveLength(0)

    req.abortTurn()
    expect(await mustSettle(pending, 'host abort')).toBe('cancelled')
    const settled = h.registry.settlements().filter((s) => s.eventId === ask.eventId)
    expect(settled).toHaveLength(1)
    expect(settled[0].outcome).toBe('cancelled')
    expect(settled[0].code).toBeUndefined() // no ASK_DEADLINE_EXCEEDED on abort
    const terminals = h.askFrames('ask.settled').filter((f) => f.payload.eventId === ask.eventId)
    expect(terminals).toHaveLength(1)
    expect(terminals[0].payload.reason).toBe('aborted')
    expect(h.askFrames('ask.cancel').some((f) => f.payload.eventId === ask.eventId)).toBe(false) // no timeout cancel frame
  })
})

describe('ADR-0011 Q3/T7 — always grant is reachable through the real answerer', () => {
  test('UI always → ask.response → session summary → no card on the next approval', async () => {
    const h = makeHarness()
    const { sessionId } = await startTurn(h, 1)

    // 1. The real host answerer pushes an approval card with escalation granted
    // (the flag the seam/UI gate on), so the always action is legal on the wire.
    const pending = h.emitHost('approval/request', approvalReq(sessionId))[0]
    await sleep(0)
    const ask = h.askFrames('ask.request').filter((f) => f.payload.sessionId === sessionId).at(-1)!.payload
    expect(ask.escalation).toBe(true)

    // 2. The seam sends exactly this when the user picks "always".
    h.send({
      id: 10, method: 'ask.response',
      params: { eventId: ask.eventId, kind: 'approval', verdict: 'allowed-once', behavior: 'always', escalation: true },
    })
    expect((await h.waitFor(10)).ok).toBe(true)
    // The host only ever sees allowed-once (its ApprovalOutcome has no 'always').
    expect(await mustSettle(pending, 'always → host')).toBe('allowed-once')
    expect(h.registry.hasGrant(sessionId, 'bash')).toBe(true)

    // 3. A second approval of the same tool/session is answered from the
    // summary: no new card, no new pending ask, host still gets allowed-once.
    const cardCountBefore = h.askFrames('ask.request').length
    const pendingBefore = h.registry.pendingCount()
    const second = h.emitHost('approval/request', approvalReq(sessionId))[0]
    expect(await mustSettle(second, 'session-summary short-circuit')).toBe('allowed-once')
    expect(h.askFrames('ask.request')).toHaveLength(cardCountBefore)
    expect(h.registry.pendingCount()).toBe(pendingBefore)

    // 4. A different session cannot borrow session A's grant.
    const foreign = h.emitHost('approval/request', approvalReq('other-session'))[0]
    expect(await mustSettle(foreign, 'foreign session after grant')).toBe('unavailable')
  })

  test('once / deny still work and create no always grant', async () => {
    const h = makeHarness()
    const { sessionId } = await startTurn(h, 1)
    const first = h.emitHost('approval/request', approvalReq(sessionId))[0]
    await sleep(0)
    const ask = h.askFrames('ask.request').filter((f) => f.payload.sessionId === sessionId).at(-1)!.payload
    h.send({ id: 11, method: 'ask.response', params: { eventId: ask.eventId, kind: 'approval', verdict: 'allowed-once' } })
    expect((await h.waitFor(11)).ok).toBe(true)
    expect(await mustSettle(first, 'once')).toBe('allowed-once')
    expect(h.registry.sessionGrants(sessionId)).toEqual([])

    const second = h.emitHost('approval/request', approvalReq(sessionId))[0] // second host request
    await sleep(0)
    const ask2 = h.askFrames('ask.request').filter((f) => f.payload.sessionId === sessionId).at(-1)!.payload
    h.send({ id: 12, method: 'ask.response', params: { eventId: ask2.eventId, kind: 'approval', verdict: 'rejected' } })
    expect((await h.waitFor(12)).ok).toBe(true)
    expect(await mustSettle(second, 'deny')).toBe('rejected')
    expect(h.registry.sessionGrants(sessionId)).toEqual([])

    // A new card really was pushed for the denied tool (no false short-circuit).
    expect(h.askFrames('ask.request').filter((f) => f.payload.sessionId === sessionId)).toHaveLength(2)
  })
})

describe('C2 (2026-11-22 拍板) — always-grant scope covers the parent and all its subagents', () => {
  // "父会话管到底": askTarget() resolves a registered child ask onto the
  // parent channel, so the grant key is ALWAYS the parent session. A parent
  // grant silently covers every registered child of the same tool; a child
  // card answered 'always' writes (parent, tool); the fail-closed routing gate
  // (unknown / foreign child) is NOT widened by any grant.
  const CHILD = 'grant-child-1'
  const SIBLING = 'grant-child-2'

  function registerChild(h: Harness, childId: string, parent: string): void {
    h.emitSessionEvent({ id: parent }, { type: 'subagent/catalog', data: { childId, childCreatedAt: 1 } })
  }

  /** Establish an always grant on `sessionId` through the REAL answerer path. */
  async function grantAlways(h: Harness, sessionId: string, toolName: string, id: number): Promise<void> {
    const pending = h.emitHost('approval/request', approvalReq(sessionId, { toolName }))[0]
    await sleep(0)
    const ask = h.askFrames('ask.request').filter((f) => f.payload.sessionId === sessionId).at(-1)!.payload
    expect(ask.escalation).toBe(true)
    h.send({
      id, method: 'ask.response',
      params: { eventId: ask.eventId, kind: 'approval', verdict: 'allowed-once', behavior: 'always', escalation: true },
    })
    expect((await h.waitFor(id)).ok).toBe(true)
    expect(await mustSettle(pending, 'grant setup')).toBe('allowed-once')
    expect(h.registry.hasGrant(sessionId, toolName)).toBe(true)
  }

  test('parent always-grant silently covers a registered child same-tool ask (no card)', async () => {
    const h = makeHarness()
    const { sessionId: parent } = await startTurn(h, 1)
    registerChild(h, CHILD, parent)
    await grantAlways(h, parent, 'bash', 100)

    const cardCountBefore = h.askFrames('ask.request').length
    const pendingBefore = h.registry.pendingCount()
    const childAsk = h.emitHost('approval/request', approvalReq(CHILD, { toolName: 'bash' }))[0]
    expect(await mustSettle(childAsk, 'child covered by parent grant')).toBe('allowed-once')
    // Grant-hit path: no new card, no new pending ask, not a fail-closed settle.
    expect(h.askFrames('ask.request')).toHaveLength(cardCountBefore)
    expect(h.registry.pendingCount()).toBe(pendingBefore)
    expect(h.registry.settlements().some((s) => s.code === ASK_ERROR_CODES.CHANNEL_UNAVAILABLE)).toBe(false)
  })

  test('child ask answered always writes the grant to the parent key (parent + sibling inherit)', async () => {
    const h = makeHarness()
    const { sessionId: parent } = await startTurn(h, 1)
    registerChild(h, CHILD, parent)
    registerChild(h, SIBLING, parent)

    // The child card is delivered on the parent channel; 'always' on it must
    // write (parent, 'bash'), not (child, 'bash').
    const childAsk = h.emitHost('approval/request', approvalReq(CHILD, { toolName: 'bash' }))[0]
    await sleep(0)
    const ask = h.askFrames('ask.request').filter((f) => f.payload.childSessionId === CHILD).at(-1)!.payload
    expect(ask.sessionId).toBe(parent)
    h.send({
      id: 101, method: 'ask.response',
      params: { eventId: ask.eventId, kind: 'approval', verdict: 'allowed-once', behavior: 'always', escalation: true },
    })
    expect((await h.waitFor(101)).ok).toBe(true)
    expect(await mustSettle(childAsk, 'child always → host')).toBe('allowed-once')
    expect(h.registry.hasGrant(parent, 'bash')).toBe(true)
    expect(h.registry.hasGrant(CHILD, 'bash')).toBe(false)
    expect(h.registry.sessionGrants(parent)).toContain('bash')

    // The same tool on the parent now short-circuits: no new card.
    let cards = h.askFrames('ask.request').length
    const parentAsk = h.emitHost('approval/request', approvalReq(parent, { toolName: 'bash' }))[0]
    expect(await mustSettle(parentAsk, 'parent inherits child grant')).toBe('allowed-once')
    expect(h.askFrames('ask.request')).toHaveLength(cards)

    // A sibling child of the same parent inherits it too.
    cards = h.askFrames('ask.request').length
    const siblingAsk = h.emitHost('approval/request', approvalReq(SIBLING, { toolName: 'bash' }))[0]
    expect(await mustSettle(siblingAsk, 'sibling inherits child grant')).toBe('allowed-once')
    expect(h.askFrames('ask.request')).toHaveLength(cards)
  })

  test('grant never widens fail-closed: foreign-parent and unregistered children stay unavailable', async () => {
    const h = makeHarness()
    const { sessionId: parent } = await startTurn(h, 1)
    await grantAlways(h, parent, 'bash', 100)
    expect(h.registry.hasGrant(parent, 'bash')).toBe(true)

    // A child of a DIFFERENT parent is foreign to this binding even when this
    // parent has granted the tool — the routing gate is consulted first.
    getSubagentIndex(h.ctx).noteCatalog('foreign-child', 'other-parent')
    const foreign = h.emitHost('approval/request', approvalReq('foreign-child', { toolName: 'bash' }))[0]
    expect(await mustSettle(foreign, 'foreign child despite grant')).toBe('unavailable')

    // An unregistered child stays unknown, grant or no grant.
    const unknown = h.emitHost('approval/request', approvalReq('never-registered', { toolName: 'bash' }))[0]
    expect(await mustSettle(unknown, 'unknown child despite grant')).toBe('unavailable')

    expect(h.askFrames('ask.request').filter((f) => f.payload.childSessionId !== undefined)).toHaveLength(0)
    const failClosed = h.registry.settlements().filter((s) => s.code === ASK_ERROR_CODES.CHANNEL_UNAVAILABLE)
    expect(failClosed).toHaveLength(2)
  })
})

describe('F1 policy mirror (R2) — (a) catalog / (b) 父策略事件 / (c) 未知子首事件 / (i) 全量 re-sync', () => {
  // The base makeHarness fake ctx has NO get, so the sync guard early-returns at
  // `typeof ctx.get !== 'function'`. Every test here passes an explicit `repinGet`
  // so the sync genuinely reaches ctx.get('sessions'/'approval'/'sessionController')
  // (research red-flag #4: without this the assertions are false greens).
  const CHILD = 'mirror-child-1'

  function makeChildSession(id: string) {
    const appended: Array<{ type: string; data: Record<string, unknown> }> = []
    const header: { parentSession?: string; origin?: string } = {}
    const session = {
      id,
      header,
      // Faithful reentrancy guard (dsh-session/lib/index.js:1652 publicationEntry):
      // a synchronous re-append while THIS session's publish is in flight throws.
      appending: false,
      append(type: string, data: Record<string, unknown>) {
        if (session.appending) throw new Error('session append cannot reenter while another append is being published')
        appended.push({ type, data })
      },
    }
    return { appended, header, session }
  }

  interface SyncOptions {
    parentPolicy?: string | undefined
    overrideOfChild?: string | undefined
    parentResolves?: boolean
    sessionsGetThrows?: boolean
    approvalMissing?: boolean
    effectivePolicyThrows?: boolean
    /** Additional child sessions served by the fake sessions service (for the
     *  genuine "full re-sync over ALL index rows" assertion). */
    extraChildren?: string[]
  }

  function makeSyncHarness(options: SyncOptions = {}) {
    const child = makeChildSession(CHILD)
    const extras = new Map<string, ReturnType<typeof makeChildSession>>()
    for (const id of options.extraChildren ?? []) extras.set(id, makeChildSession(id))
    let boundParentId = ''
    // Mutable live parent policy + host session.list rows — lets a single test
    // simulate "resume with empty index, policy switches, then Stop reconcile".
    const live = { parentPolicy: options.parentPolicy }
    let hostRows: Array<Record<string, unknown>> = []
    // FIELD root cause: sessions.get resolves only LIVE sessions; the host detaches
    // a child when its turn ends. Toggle to simulate detach / re-attach on resume.
    let childDetached = false
    const h = makeHarness({
      repinGet(name: string) {
        if (name === 'sessions') {
          return {
            get(id: string) {
              if (id === CHILD) return childDetached ? undefined : child.session
              const extra = extras.get(id)
              if (extra !== undefined) return extra.session
              if (id === boundParentId) {
                if (options.sessionsGetThrows) throw new Error('sessions.get(parent) boom')
                return options.parentResolves === false ? undefined : { id: boundParentId }
              }
              return undefined
            },
          }
        }
        if (name === 'approval') {
          if (options.approvalMissing) return undefined
          return {
            effectivePolicy(s: unknown) {
              if (options.effectivePolicyThrows) throw new Error('effectivePolicy boom')
              return s !== null && typeof s === 'object' && (s as { id?: unknown }).id === boundParentId
                ? live.parentPolicy
                : undefined
            },
            overrideOf(s: unknown) {
              if (s !== child.session) return undefined
              // Faithful fake: reflect the last mirrored policy so repeat events
              // are genuine idempotency checks, not false greens.
              const last = child.appended.at(-1)
              return last ? (last.data.policy as string) : options.overrideOfChild
            },
          }
        }
        if (name === 'sessionController') {
          return { list: async () => ({ items: hostRows }) }
        }
        return undefined
      },
    })
    return {
      h,
      child,
      extras,
      async bindParent(id: number): Promise<string> {
        const { sessionId } = await startTurn(h, id)
        boundParentId = sessionId
        child.header.parentSession = sessionId
        child.header.origin = 'subagent'
        // Default host list: one resumed subagent row under this parent.
        if (hostRows.length === 0) {
          hostRows = [{ sessionId: CHILD, parentSessionId: sessionId, origin: 'subagent', running: true, updatedAt: 1 }]
        }
        return sessionId
      },
      emitCatalog(parentId: string, createdAt = 1) {
        h.emitSessionEvent({ id: parentId }, {
          type: 'subagent/catalog',
          data: { childId: CHILD, childCreatedAt: createdAt },
        })
      },
      emitParentPolicy(parentId: string, policy: string) {
        h.emitSessionEvent({ id: parentId }, { type: 'approval/policy', data: { policy } })
      },
      emitParentTurnStart(parentId: string) {
        h.emitSessionEvent({ id: parentId }, { type: 'turn/start', data: { turn: 1 } })
      },
      /** (b3) the child's OWN turn/start (session id === child id). The host
       *  publishes this from the child's own commit(), so the child's `appending`
       *  guard is TRUE for the whole listener dispatch — a synchronous append to
       *  the same child must throw (mirrors session-event-scope.test.ts). */
      emitChildTurnStart(childId: string) {
        const target = childId === CHILD ? child : extras.get(childId)
        if (target !== undefined) target.session.appending = true
        try {
          h.emitSessionEvent({ id: childId }, { type: 'turn/start', data: { turn: 2 } })
        } finally {
          if (target !== undefined) target.session.appending = false
        }
      },
      setChildDetached(detached: boolean) { childDetached = detached },
      emitChildDelegation(childId: string, parentId: string) {
        h.emitSessionEvent(
          { id: childId, header: { parentSession: parentId, origin: 'subagent' } },
          { type: 'approval/policy', data: { policy: 'never', source: 'delegation' } },
        )
      },
      /** (c) generalized: ANY first live event from an unknown child session. */
      emitChildLiveEvent(session: Record<string, unknown>, type: string) {
        h.emitSessionEvent(session, { type, data: {} })
      },
      setParentPolicy(policy: string) { live.parentPolicy = policy },
      setHostRows(rows: Array<Record<string, unknown>>) { hostRows = rows },
      /** Drive the real subagents.stopChildren RPC → reconcileSubagentIndex →
       *  syncFromList + full re-sync (i/R2-2). */
      async stopChildren(parentId: string, id = 901): Promise<void> {
        h.send({ id, method: 'subagents.stopChildren', params: { parentSessionId: parentId } })
        await h.waitFor(id)
      },
      indexChildIds(): string[] { return [...getSubagentIndex(h.ctx).rows.keys()] },
      /** (c) sync is deferred via queueMicrotask (host rejects reentrant append). */
      flushMicrotasks() { return Promise.resolve().then(() => {}) },
    }
  }

  const ask = (policy: string) => [{ type: 'approval/policy', data: { policy } }]

  test('(a) catalog + parent ask → child log append approval/policy ask', async () => {
    const r = makeSyncHarness({ parentPolicy: 'ask' })
    const parentId = await r.bindParent(21)
    r.emitCatalog(parentId)
    expect(r.child.appended).toEqual(ask('ask'))
  })

  test('(a) catalog + parent full access(never) → child mirrors to never (no pointless ask)', async () => {
    const r = makeSyncHarness({ parentPolicy: 'never' })
    const parentId = await r.bindParent(22)
    r.emitCatalog(parentId)
    expect(r.child.appended).toEqual(ask('never'))
  })

  test('(b) parent approval/policy ask→never → already-ask child mirrored to never', async () => {
    const r = makeSyncHarness({ parentPolicy: 'ask' })
    const parentId = await r.bindParent(23)
    r.emitCatalog(parentId)                 // (a): child → ask
    expect(r.child.appended).toEqual(ask('ask'))
    r.emitParentPolicy(parentId, 'never')   // (b): mirror every known child → never
    expect(r.child.appended).toEqual([...ask('ask'), ...ask('never')])
  })

  test('(b) parent never→ask → never child self-healed to ask (REAL recovery path, no catalog replay)', async () => {
    const r = makeSyncHarness({ parentPolicy: 'never', overrideOfChild: 'never' })
    const parentId = await r.bindParent(24)
    r.emitCatalog(parentId)                 // (a): parent never == child never → no append
    expect(r.child.appended).toHaveLength(0)
    r.emitParentPolicy(parentId, 'ask')     // (b): recovery via parent policy event
    expect(r.child.appended).toEqual(ask('ask'))
    expect(r.h.warns.some((line) => line.includes('self-healed never→ask'))).toBe(true)
  })

  test('(c) child delegation pin BEFORE catalog → child synced without any catalog frame', async () => {
    const r = makeSyncHarness({ parentPolicy: 'ask' })
    const parentId = await r.bindParent(25)
    r.emitChildDelegation(CHILD, parentId)  // no catalog at all
    await r.flushMicrotasks()               // deferred to dodge host reentrant-append guard
    expect(r.child.appended).toEqual(ask('ask'))
  })

  test('sync idempotency: repeated parent policy events do not re-append', async () => {
    const r = makeSyncHarness({ parentPolicy: 'ask' })
    const parentId = await r.bindParent(26)
    r.emitCatalog(parentId)
    r.emitParentPolicy(parentId, 'ask')
    r.emitParentPolicy(parentId, 'ask')
    expect(r.child.appended).toEqual(ask('ask'))
  })

  test('(b)/(c) scope guard: unrelated session events never drive a sync', async () => {
    const r = makeSyncHarness({ parentPolicy: 'ask' })
    const parentId = await r.bindParent(27)
    // (b) an unrelated session's policy change is not the binding's parent.
    r.emitParentPolicy('some-other-session', 'never')
    expect(r.child.appended).toHaveLength(0)
    // (c) a delegation pin whose header.parentSession is another session.
    r.emitChildDelegation('unrelated-child', 'another-parent')
    await r.flushMicrotasks()
    expect(r.child.appended).toHaveLength(0)
  })

  test('fail-closed: unresolved parent / missing approval / throwing effectivePolicy → no append', async () => {
    const missing = makeSyncHarness({ parentPolicy: 'ask', parentResolves: false })
    const missingParentId = await missing.bindParent(28)
    missing.emitCatalog(missingParentId)
    expect(missing.child.appended).toHaveLength(0)

    const throwing = makeSyncHarness({ parentPolicy: 'ask', sessionsGetThrows: true })
    const throwingParentId = await throwing.bindParent(29)
    throwing.emitCatalog(throwingParentId)
    expect(throwing.child.appended).toHaveLength(0)

    const noApproval = makeSyncHarness({ approvalMissing: true })
    const noApprovalParentId = await noApproval.bindParent(30)
    noApproval.emitCatalog(noApprovalParentId)
    expect(noApproval.child.appended).toHaveLength(0)

    const policyThrows = makeSyncHarness({ parentPolicy: 'ask', effectivePolicyThrows: true })
    const policyThrowsParentId = await policyThrows.bindParent(31)
    policyThrows.emitCatalog(policyThrowsParentId)
    expect(policyThrows.child.appended).toHaveLength(0)
  })

  test('(b2) FIELD 2026-11-23: parent turn/start re-syncs known child from LIVE policy (redundant recovery)', async () => {
    // The real machine saw (b)'s approval/policy event not trigger a mirror even
    // though the host publishes it (see 03-live-trigger-diagnosis.md). The redundant
    // turn/start hook re-syncs from the LIVE effective policy, so this recovers even
    // when the policy value changed without an approval/policy event reaching (b).
    const r = makeSyncHarness({ parentPolicy: 'never', overrideOfChild: 'never' })
    const parentId = await r.bindParent(39)
    r.emitCatalog(parentId)                 // parent never == child never → no append
    expect(r.child.appended).toHaveLength(0)
    // Policy switched live to ask; no approval/policy event—only a turn/start.
    r.setParentPolicy('ask')
    r.emitParentTurnStart(parentId)
    expect(r.child.appended).toEqual(ask('ask'))
    // Idempotent: a second turn/start does not re-append.
    r.emitParentTurnStart(parentId)
    expect(r.child.appended).toEqual(ask('ask'))
  })

  // ---- (b3) FIELD root cause: known child re-attached on turn/start ------------

  test('(b3) detached child + parent flips ask→never → child turn/start mirrors never', async () => {
    // FIELD root cause: sessions.get resolves only LIVE sessions. The child was
    // settled (detached) when the parent flipped to never, so (b)/(b2) no-op.
    // When the child is continued, the host re-attaches it and its turn/start
    // (before any tool call) must mirror the LIVE parent policy.
    const r = makeSyncHarness({ parentPolicy: 'ask', overrideOfChild: 'never' })
    const parentId = await r.bindParent(51)
    r.emitCatalog(parentId)                       // live ask, child never → re-pin ask
    expect(r.child.appended).toEqual(ask('ask'))
    r.setChildDetached(true)                      // child's turn ends → host detaches
    r.setParentPolicy('never')
    r.emitParentPolicy(parentId, 'never')         // (b) : child UNDEF → no-op
    r.emitParentTurnStart(parentId)               // (b2): child UNDEF → no-op
    expect(r.child.appended).toEqual(ask('ask'))  // still ask while detached
    r.setChildDetached(false)                     // resume/continue → host re-attaches
    r.emitChildTurnStart(CHILD)                   // (b3): child known + turn/start
    await r.flushMicrotasks()                     // deferred to dodge reentrant-append guard
    expect(r.child.appended).toEqual([...ask('ask'), ...ask('never')])
  })

  test('(b3) detached child + parent flips never→ask → child turn/start re-pins ask (danger direction)', async () => {
    const r = makeSyncHarness({ parentPolicy: 'never', overrideOfChild: 'never' })
    const parentId = await r.bindParent(52)
    r.emitCatalog(parentId)                       // parent never == child never → no append
    expect(r.child.appended).toHaveLength(0)
    r.setChildDetached(true)
    r.setParentPolicy('ask')
    r.emitParentPolicy(parentId, 'ask')           // (b): no-op (detached)
    expect(r.child.appended).toHaveLength(0)
    r.setChildDetached(false)                     // re-attach on resume
    r.emitChildTurnStart(CHILD)                   // (b3): re-pin ask → writes get a card
    await r.flushMicrotasks()                     // deferred to dodge reentrant-append guard
    expect(r.child.appended).toEqual(ask('ask'))
  })

  test('(b3) negative: unknown child turn/start with no index row is NOT synced (no false claim)', async () => {
    const r = makeSyncHarness({ parentPolicy: 'ask' })
    await r.bindParent(53)
    // No catalog — child not in index. A turn/start from a session that is not a
    // known child must not drive (b3); header-less → (c) guard also rejects it.
    r.emitChildTurnStart('never-seen-child')
    expect(r.indexChildIds()).toEqual([])
    expect(r.child.appended).toHaveLength(0)
  })

  // ---- R2-1(i) / R2-2: resume self-heal --------------------------------------

  test('(i) resume bind with parent ALREADY ask → Stop reconcile re-pins the resumed child', async () => {
    // Fresh bridge after TUI restart: index is EMPTY (no catalog/seed replay),
    // the host list still has the child. A Stop action drives reconcile →
    // syncFromList → full re-sync with LIVE effectivePolicy (ask) → re-pin.
    const r = makeSyncHarness({ parentPolicy: 'ask', overrideOfChild: 'never' })
    const parentId = await r.bindParent(41)
    expect(r.indexChildIds()).not.toContain(CHILD) // empty index after "restart"
    // (b) on an empty index is structurally a no-op — no sync possible yet.
    r.emitParentPolicy(parentId, 'ask')
    expect(r.child.appended).toHaveLength(0)
    // Stop action → reconcile → syncFromList seeds rows → (i) full re-sync.
    await r.stopChildren(parentId, 911)
    expect(r.indexChildIds()).toContain(CHILD)
    expect(r.child.appended).toEqual(ask('ask'))
  })

  test('(i) resume bind, parent switches ask AFTER resume → (b) no-op on empty index, Stop reconcile heals', async () => {
    const r = makeSyncHarness({ parentPolicy: 'never', overrideOfChild: 'never' })
    const parentId = await r.bindParent(42)
    // Resume with parent still full-access: reconcile would pin never (no-op).
    // Parent switches to ask while index is still empty: (b) sees zero rows.
    r.setParentPolicy('ask')
    r.emitParentPolicy(parentId, 'ask')
    expect(r.child.appended).toHaveLength(0) // structural failure of (b) on empty index
    // Stop reconcile reads LIVE effectivePolicy (ask), not the stale event value.
    await r.stopChildren(parentId, 912)
    expect(r.child.appended).toEqual(ask('ask'))
  })

  test('(i)+Stop full re-sync covers ALL index rows, not just the event child', async () => {
    const SECOND = 'mirror-child-2'
    const r = makeSyncHarness({ parentPolicy: 'ask', overrideOfChild: 'never', extraChildren: [SECOND] })
    const parentId = await r.bindParent(43)
    r.setHostRows([
      { sessionId: CHILD, parentSessionId: parentId, origin: 'subagent', running: true, updatedAt: 1 },
      { sessionId: SECOND, parentSessionId: parentId, origin: 'subagent', running: true, updatedAt: 2 },
    ])
    await r.stopChildren(parentId, 913)
    expect(r.indexChildIds().sort()).toEqual([CHILD, SECOND].sort())
    expect(r.child.appended).toEqual(ask('ask'))
    expect(r.extras.get(SECOND)!.appended).toEqual(ask('ask'))
  })

  test('(i) bind completion re-syncs a WARM index (in-process resume)', async () => {
    // A reconnect with a warm index: the idempotent session.open resume path
    // mirrors the live parent policy onto already-known children.
    const r = makeSyncHarness({ parentPolicy: 'never', overrideOfChild: 'never' })
    const parentId = await r.bindParent(44)
    r.emitCatalog(parentId)                 // catalog seeds index + mirrors never (no-op)
    expect(r.child.appended).toHaveLength(0)
    r.setHostRows([])                       // keep index warm; stop reconcile not needed
    // Parent policy changed live WITHOUT an approval/policy event (e.g. missed
    // while disconnected): a second resume bind must re-sync from live policy.
    r.setParentPolicy('ask')
    r.h.send({ id: 914, method: 'session.open', params: { mode: 'resume', id: parentId } })
    await r.h.waitFor(914)
    expect(r.child.appended).toEqual(ask('ask'))
  })

  // ---- R2-1(ii): unknown child's first live event → noteCatalog + sync -------

  test('(ii) unknown child first live event (valid header) → noteCatalog into index + sync', async () => {
    const r = makeSyncHarness({ parentPolicy: 'ask' })
    const parentId = await r.bindParent(45)
    expect(r.indexChildIds()).not.toContain(CHILD)
    // ANY live event (not just delegation pin) from an unknown child with a
    // valid header claims it into the index AND mirrors the parent policy.
    r.emitChildLiveEvent({ id: CHILD, header: { parentSession: parentId, origin: 'subagent' } }, 'turn/start')
    await r.flushMicrotasks()
    expect(r.indexChildIds()).toContain(CHILD) // claimed into the INDEX (not a seen-set)
    expect(r.child.appended).toEqual(ask('ask'))
    // Once in the index, a later parent policy event (b) can take over.
    r.emitParentPolicy(parentId, 'never')
    expect(r.child.appended).toEqual([...ask('ask'), ...ask('never')])
  })

  test('(ii) header mismatch (not this binding\'s child) → NOT indexed, NOT synced', async () => {
    const r = makeSyncHarness({ parentPolicy: 'ask' })
    const parentId = await r.bindParent(46)
    const FOREIGN = 'foreign-child-1'
    // Wrong parentSession in header.
    r.emitChildLiveEvent({ id: FOREIGN, header: { parentSession: 'another-parent', origin: 'subagent' } }, 'turn/start')
    // Wrong origin.
    r.emitChildLiveEvent({ id: 'plain-fork', header: { parentSession: parentId, origin: 'fork' } }, 'turn/start')
    // Missing header.
    r.emitChildLiveEvent({ id: 'headerless' }, 'turn/start')
    await r.flushMicrotasks()
    expect(r.indexChildIds()).toEqual([])
    expect(r.child.appended).toHaveLength(0)
  })

  test('(ii) unknown child without a live event stays invisible (no false claim)', async () => {
    const r = makeSyncHarness({ parentPolicy: 'ask' })
    await r.bindParent(47)
    // No event at all — the child is not magically added; only (i) reconcile
    // (Stop action) can seed it from session.list.
    expect(r.indexChildIds()).toEqual([])
    expect(r.child.appended).toHaveLength(0)
  })
})

describe('ask-slot arbitration — real waterfall next() chain (oldfox NO CHANGE)', () => {
  /** Minimal fake of `@aiwayds/dsh-ask-router@0.7.0`'s answerer — NO dependency
   *  on the real package and NO `askSurfaces` registry. Its exact 0.7.0 contract
   *  (installed lib/index.js:117-120) is:
   *    on('user-questions/request', (request, next) =>
   *      registry.list().length === 0 ? next() : routeAsk(surfaces, request))
   *  Zero surface ⇒ delegate once via next(), push no ask of its own. */
  function makeZeroSurfaceRouter() {
    const state = { nextCalls: 0 }
    const listener = (_request: unknown, next: () => Promise<any>) => {
      state.nextCalls++
      return next()
    }
    return { listener, state }
  }

  const questionRequest = (sessionId: string, callId: string) => ({
    agent: { session: { id: sessionId } },
    questions: [{
      id: 'q1', question: 'Which DB?', header: 'Storage',
      options: [{ label: 'Postgres' }], multiSelect: false,
    }],
    wait: { callId },
  })
  const answerQuestions = (eventId: string, id: number) => ({
    id, method: 'ask.response',
    params: { eventId, kind: 'questions', answers: [{ id: 'q1', selected: ['Postgres'] }] },
  })

  test('bridge-first + zero-surface router-after: exactly one ask.request, bridge claims, router never re-asks', async () => {
    const router = makeZeroSurfaceRouter()
    const h = makeHarness()
    // apply() armed the bridge answerers first; append the router AFTER them.
    h.ctx.on('user-questions/request', router.listener)
    const { sessionId } = await startTurn(h, 1)

    const claim = h.emitHostWaterfall('user-questions/request', questionRequest(sessionId, 'call-wf1'))
    await sleep(0)
    const asks = h.askFrames('ask.request')
    expect(asks).toHaveLength(1)
    // Bridge vetoed the chain by never calling next(): the downstream router
    // listener never ran, so it could not push a second card.
    expect(router.state.nextCalls).toBe(0)

    h.send(answerQuestions(asks[0].payload.eventId, 40))
    expect((await h.waitFor(40)).ok).toBe(true)
    expect(await mustSettle(claim, 'bridge-first waterfall')).toEqual({
      answers: [{ id: 'q1', selected: ['Postgres'] }],
    })
    expect(h.askFrames('ask.request')).toHaveLength(1) // still exactly one
  })

  test('zero-surface router-first + bridge-after: router next() then bridge claims, exactly one ask.request', async () => {
    const router = makeZeroSurfaceRouter()
    // Register the companion listener BEFORE apply() arms the bridge answerers.
    const h = makeHarness({ preRegister: (ctx) => ctx.on('user-questions/request', router.listener) })
    const { sessionId } = await startTurn(h, 1)

    const claim = h.emitHostWaterfall('user-questions/request', questionRequest(sessionId, 'call-wf2'))
    await sleep(0)
    const asks = h.askFrames('ask.request')
    expect(asks).toHaveLength(1)
    // Router stepped aside exactly once; bridge then claimed and vetoed any
    // further hook, so the chain terminated on the first (and only) card.
    expect(router.state.nextCalls).toBe(1)

    h.send(answerQuestions(asks[0].payload.eventId, 41))
    expect((await h.waitFor(41)).ok).toBe(true)
    expect(await mustSettle(claim, 'router-first waterfall')).toEqual({
      answers: [{ id: 'q1', selected: ['Postgres'] }],
    })
    expect(h.askFrames('ask.request')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// ask-outcome v4 (§8.7 / §8.8 T9–T12) — bridge-side external settlement wiring.
// Only the index.ts answerer/teardown paths are exercised here; the registry's
// settleExternal semantics are covered by ask-registry.test.ts. Wrapping the
// registry instance method records the exact input index.ts passed, without
// changing the call itself.
function spyExternalSettle(h: Harness): Array<{ eventId: string; input: Record<string, any> }> {
  const calls: Array<{ eventId: string; input: Record<string, any> }> = []
  const original = h.registry.settleExternal.bind(h.registry)
  ;(h.registry as any).settleExternal = (eventId: string, input: Record<string, any>) => {
    calls.push({ eventId, input })
    return original(eventId, input)
  }
  return calls
}

const settledReasons = (h: Harness, eventId: string): string[] =>
  h.askFrames('ask.settled')
    .filter((f) => f.payload.eventId === eventId)
    .map((f) => f.payload.reason)

/** Count only NDJSON bridge frames, ignoring any reporter stdout noise. */
const bridgeFrameCount = (h: Harness): number => h.frames.filter((line) => {
  try {
    const f = JSON.parse(line)
    return f !== null && typeof f === 'object' && ('ok' in f || 'type' in f)
  } catch { return false }
}).length

describe('ask-outcome v4 — bridge external settlement wiring', () => {
  test('host signal abort writes aborted through the registry, keeps the answerer fallback, and a late answer is a no-op', async () => {
    const h = makeHarness()
    const calls = spyExternalSettle(h)
    const { sessionId } = await startTurn(h, 1)
    const host = new AbortController()
    const pending = h.emitHost('approval/request', approvalReq(sessionId, { signal: host.signal }))[0]
    await sleep(0)
    const ask = h.askFrames('ask.request').at(-1)!.payload

    host.abort()
    expect(await mustSettle(pending, 'host abort')).toBe('cancelled')
    expect(calls).toEqual([{ eventId: ask.eventId, input: { settleReason: 'aborted' } }])
    expect(settledReasons(h, ask.eventId)).toEqual(['aborted'])
    expect(h.registry.settlements()).toHaveLength(1)

    h.send({ id: 60, method: 'ask.response', params: { eventId: ask.eventId, kind: 'approval', verdict: 'allowed-once' } })
    const reply = await h.waitFor(60)
    expect(reply.ok).toBe(false)
    expect(h.registry.settlements()).toHaveLength(1) // no second terminal
    expect(settledReasons(h, ask.eventId)).toEqual(['aborted'])
  })

  test('connection teardown settles every pending ask with connection-closed and emits no frame after closing', async () => {
    const h = makeHarness()
    const calls = spyExternalSettle(h)
    const { sessionId } = await startTurn(h, 1)
    const pending = h.emitHost('approval/request', approvalReq(sessionId))[0]
    await sleep(0)
    const ask = h.askFrames('ask.request').at(-1)!.payload
    const framesBefore = bridgeFrameCount(h)

    h.dispose()
    h.dispose() // idempotent
    expect(await mustSettle(pending, 'teardown')).toBe('cancelled')
    expect(calls).toEqual([{ eventId: ask.eventId, input: { settleReason: 'connection-closed' } }])
    expect(h.registry.settlements()).toHaveLength(1)
    expect(h.registry.pendingIds()).toEqual([])
    // closing=true suppresses writeFrame, so teardown never writes ask.settled.
    expect(settledReasons(h, ask.eventId)).toEqual([])
    expect(bridgeFrameCount(h)).toBe(framesBefore)
  })

  test('repeated teardown keeps one cancelled settlement and the connection-closed call', async () => {
    const h = makeHarness()
    const calls = spyExternalSettle(h)
    const { sessionId } = await startTurn(h, 1)
    const pending = h.emitHost('approval/request', approvalReq(sessionId))[0]
    await sleep(0)
    const ask = h.askFrames('ask.request').at(-1)!.payload

    h.dispose()
    h.dispose() // idempotent teardown must not add a second terminal

    expect(await mustSettle(pending, 'repeated teardown')).toBe('cancelled')
    expect(h.registry.settlements().map(({ eventId, outcome }) => ({ eventId, outcome }))).toEqual([
      { eventId: ask.eventId, outcome: 'cancelled' },
    ])
    expect(calls).toEqual([{ eventId: ask.eventId, input: { settleReason: 'connection-closed' } }])
    expect(h.registry.pendingIds()).toEqual([])
  })

  test('approvalGateExpiry.signal aborts independently: timeout + defaultOutcome rejected, no windowMs timer', async () => {
    const h = makeHarness()
    const calls = spyExternalSettle(h)
    const { sessionId } = await startTurn(h, 1)
    const host = new AbortController()
    const gate = new AbortController()
    const pending = h.emitHost('approval/request', approvalReq(sessionId, {
      signal: host.signal,
      approvalGateExpiry: { windowMs: 50, defaultOutcome: 'rejected', signal: gate.signal },
    }))[0]
    await sleep(0)
    const ask = h.askFrames('ask.request').at(-1)!.payload
    expect(h.registry.timerCount()).toBe(1) // hard cap only — windowMs builds no timer

    gate.abort()
    expect(await mustSettle(pending, 'gate timeout')).toBe('rejected')
    expect(calls).toEqual([{
      eventId: ask.eventId,
      input: { settleReason: 'timeout', defaultOutcome: 'rejected' },
    }])
    expect(settledReasons(h, ask.eventId)).toEqual(['timeout'])
    expect(h.registry.settlements()).toHaveLength(1)
    expect(host.signal.aborted).toBe(false) // gate never composed with the host signal

    // A late answer cannot rewrite the terminal.
    h.send({ id: 61, method: 'ask.response', params: { eventId: ask.eventId, kind: 'approval', verdict: 'allowed-once' } })
    expect((await h.waitFor(61)).ok).toBe(false)
    expect(h.registry.settlements()).toHaveLength(1)
  })

  test('gate defaultOutcome unavailable maps to host "unavailable"', async () => {
    const h = makeHarness()
    const calls = spyExternalSettle(h)
    const { sessionId } = await startTurn(h, 1)
    const gate = new AbortController()
    const pending = h.emitHost('approval/request', approvalReq(sessionId, {
      approvalGateExpiry: { windowMs: 10, defaultOutcome: 'unavailable', signal: gate.signal },
    }))[0]
    await sleep(0)
    const ask = h.askFrames('ask.request').at(-1)!.payload
    gate.abort()
    expect(await mustSettle(pending, 'gate unavailable')).toBe('unavailable')
    expect(calls).toEqual([{
      eventId: ask.eventId,
      input: { settleReason: 'timeout', defaultOutcome: 'unavailable' },
    }])
    expect(settledReasons(h, ask.eventId)).toEqual(['timeout'])
    expect(h.registry.settlements()).toHaveLength(1)
  })

  test('signal order preserved: gate-first stays timeout (host abort cannot rewrite)', async () => {
    const h = makeHarness()
    const calls = spyExternalSettle(h)
    const { sessionId } = await startTurn(h, 1)
    const gate = new AbortController()
    const host = new AbortController()
    const pending = h.emitHost('approval/request', approvalReq(sessionId, {
      signal: host.signal,
      approvalGateExpiry: { windowMs: 20, defaultOutcome: 'rejected', signal: gate.signal },
    }))[0]
    await sleep(0)
    const ask = h.askFrames('ask.request').at(-1)!.payload

    gate.abort()
    expect(await mustSettle(pending, 'gate first')).toBe('rejected')
    host.abort() // host listener was cleared on settle — no rewrite
    expect(h.registry.settlements()).toHaveLength(1)
    expect(settledReasons(h, ask.eventId)).toEqual(['timeout'])
    expect(calls.filter((c) => c.eventId === ask.eventId).map((c) => c.input.settleReason)).toEqual(['timeout'])
  })

  test('signal order preserved: host-first stays aborted (gate timeout cannot rewrite)', async () => {
    const h = makeHarness()
    const calls = spyExternalSettle(h)
    const { sessionId } = await startTurn(h, 1)
    const gate = new AbortController()
    const host = new AbortController()
    const pending = h.emitHost('approval/request', approvalReq(sessionId, {
      signal: host.signal,
      approvalGateExpiry: { windowMs: 20, defaultOutcome: 'rejected', signal: gate.signal },
    }))[0]
    await sleep(0)
    const ask = h.askFrames('ask.request').at(-1)!.payload

    host.abort()
    expect(await mustSettle(pending, 'host first')).toBe('cancelled')
    gate.abort() // gate listener was cleared on settle — no rewrite
    expect(h.registry.settlements()).toHaveLength(1)
    expect(settledReasons(h, ask.eventId)).toEqual(['aborted'])
    expect(calls.filter((c) => c.eventId === ask.eventId).map((c) => c.input.settleReason)).toEqual(['aborted'])
  })

  test('request without approvalGateExpiry keeps the existing answer path (no gate wiring)', async () => {
    const h = makeHarness()
    const calls = spyExternalSettle(h)
    const { sessionId } = await startTurn(h, 1)
    const pending = h.emitHost('approval/request', approvalReq(sessionId))[0]
    await sleep(0)
    const ask = h.askFrames('ask.request').at(-1)!.payload
    h.send({ id: 62, method: 'ask.response', params: { eventId: ask.eventId, kind: 'approval', verdict: 'allowed-once' } })
    expect((await h.waitFor(62)).ok).toBe(true)
    expect(await mustSettle(pending, 'no expiry')).toBe('allowed-once')
    expect(calls).toEqual([])
    expect(settledReasons(h, ask.eventId)).toEqual(['answered'])
    expect(h.registry.settlements()).toHaveLength(1)
  })

  test('fail-closed ask forwards toolName/callId and keeps unknown session literal', async () => {
    const h = makeHarness()
    const pending = h.emitHost('approval/request', approvalReq('no-session'))[0]
    expect(await mustSettle(pending, 'fail-closed metadata')).toBe('unavailable')
    const settled = h.askFrames('ask.settled')
    expect(settled).toHaveLength(1)
    expect(settled[0].payload).toMatchObject({
      reason: 'no-channel', outcome: 'unavailable', sessionId: 'unknown',
      toolName: 'bash', callId: 'call-1',
    })
  })
})
