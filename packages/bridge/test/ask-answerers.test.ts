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
  askFrames(type: string): Frame[]
  dispose(): void
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function makeHarness(overrides: { onThrows?: boolean; noOn?: boolean; askDeadlineMs?: unknown } = {}): Harness {
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
  if (overrides.noOn) delete ctx.on
  // F1-A2: the construction point reads askDeadlineMs from the plugin config.
  const config = overrides.askDeadlineMs !== undefined ? { askDeadlineMs: overrides.askDeadlineMs } : {}
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
