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
import { apply, getAskRegistry } from '../src/index'
import { ASK_ERROR_CODES } from '../src/ask-frames'
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

function makeHarness(overrides: { onThrows?: boolean; noOn?: boolean } = {}): Harness {
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
  const ctx: any = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
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
  // apply() must never throw even when ctx.on is missing or throws.
  apply(ctx, {})
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
    expect(payload.escalation).toBe(false) // host carries no escalation grant

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

describe('ADR-0011 T7 — session summary short-circuit in the real answerer', () => {
  test('an always grant skips the card on the next approval of the same tool/session', async () => {
    const h = makeHarness()
    const { sessionId } = await startTurn(h, 1)
    // Seed the summary the only way Q3 permits: an accepted behavior:'always'
    // answer on a request that carried escalation:true. The stock host's
    // ApprovalRequestEvent has no escalation field, so a real card can never
    // grant it today; drive the registry directly to exercise T7's effect.
    const seed = h.registry.create('seed-turn', {
      sessionId, kind: 'approval', toolName: 'bash', escalation: true,
    })
    expect(h.registry.answer(sessionId, {
      eventId: seed.eventId, kind: 'approval', verdict: 'allowed-once',
      behavior: 'always', escalation: true,
    }).ok).toBe(true)
    expect(h.registry.hasGrant(sessionId, 'bash')).toBe(true)

    const cardCountBefore = h.askFrames('ask.request').length
    const pendingBefore = h.registry.pendingCount()

    const pending = h.emitHost('approval/request', approvalReq(sessionId))[0]
    expect(await mustSettle(pending, 'session-summary short-circuit')).toBe('allowed-once')
    // The host is answered immediately: no ask.request card, no new pending ask.
    expect(h.askFrames('ask.request')).toHaveLength(cardCountBefore)
    expect(h.registry.pendingCount()).toBe(pendingBefore)

    // A different session cannot borrow session A's grant.
    const foreign = h.emitHost('approval/request', approvalReq('other-session'))[0]
    expect(await mustSettle(foreign, 'foreign session after grant')).toBe('unavailable')
  })
})
