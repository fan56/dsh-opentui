/**
 * ADR-0011 T3 — protocol-level unit tests for the ask channel wiring.
 *
 * Fake-ctx discipline mirrors turn-abort.test.ts: install a fake cordis ctx
 * plus fake stdin/stdout for each case, drive the real `apply()` over the NDJSON
 * wire, and read the connection's AskRegistry through `getAskRegistry(ctx)`.
 * No host package, no seam/UI, no model turn — the turn is held open by a
 * never-settling `whenIdle()` and terminated through the fake firehose.
 *
 * Locked behaviour:
 *  - ask.response forwards the registry's error codes verbatim (5 reachable
 *    from answer(); the deadline/fail-closed two are exercised in T2 tests);
 *  - a valid answer emits ask.settled upstream and leaves the registry clean;
 *  - turn terminal / session close / replace clear pending asks and make late
 *    answers ASK_TURN_ENDED;
 *  - clearing is idempotent and releases every timer.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { apply, getAskRegistry } from '../src/index'
import { ASK_ERROR_CODES } from '../src/ask-frames'
import type { AskRegistry } from '../src/ask-registry'

const STDIO_SWITCH = 'DSH_OPENTUI_BRIDGE_STDIO'
type Frame = Record<string, any>

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const QUESTIONS = [{ id: 'q1', prompt: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }]

interface Harness {
  frames: string[]
  registry: AskRegistry
  ctx: any
  send(frame: unknown): void
  latest(id: number | string): Frame | undefined
  waitFor(id: number | string): Promise<Frame>
  emitSessionEvent(session: unknown, event: unknown): void
  askFrames(type: string): Frame[]
  dispose(): void
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function makeHarness(): Harness {
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

  const eventListeners = new Map<string, Array<(...args: any[]) => void>>()
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
    on(name: string, listener: (...args: any[]) => void) {
      const next = [...(eventListeners.get(name) || []), listener]
      eventListeners.set(name, next)
      return () => eventListeners.set(name, next.filter((l) => l !== listener))
    },
    agents: {
      async create() { return { agent, dispose: async () => {} } },
      async resume() { return { agent, dispose: async () => {} } },
      get() { return undefined },
    },
  }
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
    send(frame: unknown) {
      const line = `${JSON.stringify(frame)}\n`
      for (const fn of stdinListeners['data'] || []) fn(line)
    },
    latest,
    waitFor,
    emitSessionEvent(session: unknown, event: unknown) {
      for (const fn of eventListeners.get('session/event') || []) fn(session, event)
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

function terminate(h: Harness, sessionId: string, reason: unknown) {
  h.emitSessionEvent({ id: sessionId }, { type: 'turn/end', data: { reason } })
}

function approval(eventId: string, verdict = 'allowed-once') {
  return { eventId, kind: 'approval', verdict }
}

describe('ask.response — happy path', () => {
  test('valid answer settles once: ask.settled upstream, clean registry state', async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h, 1)
    const ask = h.registry.create(turnId, { sessionId, kind: 'approval', toolName: 'bash' })
    expect(h.askFrames('ask.request').some((f) => f.payload.eventId === ask.eventId)).toBe(true)
    expect(h.registry.timerCount()).toBe(1) // hard cap only (askDeadlineMs default null)

    h.send({ id: 10, method: 'ask.response', params: approval(ask.eventId) })
    const reply = await h.waitFor(10)

    expect(reply.ok).toBe(true)
    expect(reply.result.eventId).toBe(ask.eventId)
    expect(reply.result.outcome).toBe('approved')
    const settled = h.askFrames('ask.settled').filter((f) => f.payload.eventId === ask.eventId)
    expect(settled).toHaveLength(1)
    expect(settled[0].payload.outcome).toBe('approved')
    expect(h.registry.pendingCount()).toBe(0)
    expect(h.registry.timerCount()).toBe(0)
    expect(h.registry.settlements()).toHaveLength(1)
  })
})

describe('ask.response — five error codes forwarded verbatim', () => {
  test('ASK_UNKNOWN_REQUEST for an eventId never issued', async () => {
    const h = makeHarness()
    h.send({ id: 10, method: 'ask.response', params: approval('ghost:ask-99') })
    const reply = await h.waitFor(10)
    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe(ASK_ERROR_CODES.UNKNOWN_REQUEST)
  })

  test('ASK_ALREADY_ANSWERED on a second answer, state unchanged', async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h, 1)
    const ask = h.registry.create(turnId, { sessionId, kind: 'approval' })

    h.send({ id: 10, method: 'ask.response', params: approval(ask.eventId, 'allowed-once') })
    expect((await h.waitFor(10)).ok).toBe(true)
    h.send({ id: 11, method: 'ask.response', params: approval(ask.eventId, 'rejected') })
    const second = await h.waitFor(11)

    expect(second.ok).toBe(false)
    expect(second.error.code).toBe(ASK_ERROR_CODES.ALREADY_ANSWERED)
    expect(h.registry.settlements()).toHaveLength(1)
    expect(h.registry.settlements()[0].outcome).toBe('approved')
    expect(h.askFrames('ask.settled').filter((f) => f.payload.eventId === ask.eventId)).toHaveLength(1)
  })

  test('ASK_NOT_ADDRESSEE when the binding session is not the deliveredTo session', async () => {
    const h = makeHarness()
    const { turnId } = await startTurn(h, 1)
    // Deliberately register the ask for a foreign session; the open binding's
    // sessionId is what ask.response is checked against.
    const ask = h.registry.create(turnId, { sessionId: 'foreign-session', kind: 'approval' })

    h.send({ id: 10, method: 'ask.response', params: approval(ask.eventId) })
    const reply = await h.waitFor(10)

    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe(ASK_ERROR_CODES.NOT_ADDRESSEE)
    expect(h.registry.pendingCount()).toBe(1)
    expect(h.registry.settlements()).toHaveLength(0)
  })

  test('ASK_TURN_ENDED for a late answer after turn terminal clearing', async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h, 1)
    const ask = h.registry.create(turnId, { sessionId, kind: 'approval' })

    terminate(h, sessionId, 'completed')
    await sleep(0)
    h.send({ id: 10, method: 'ask.response', params: approval(ask.eventId) })
    const reply = await h.waitFor(10)

    expect(reply.ok).toBe(false)
    expect(reply.error.code).toBe(ASK_ERROR_CODES.TURN_ENDED)
    expect(h.registry.settlements()).toHaveLength(1)
  })

  test('ASK_INVALID_RESPONSE for a malformed response (validation before registry)', async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h, 1)
    const ask = h.registry.create(turnId, { sessionId, kind: 'approval' })

    // behavior:'always' without escalation is rejected by validateAskResponse.
    h.send({ id: 10, method: 'ask.response', params: { ...approval(ask.eventId), behavior: 'always' } })
    const invalid = await h.waitFor(10)
    expect(invalid.ok).toBe(false)
    expect(invalid.error.code).toBe(ASK_ERROR_CODES.INVALID_RESPONSE)

    // A structurally broken params object is rejected the same way.
    h.send({ id: 11, method: 'ask.response', params: { kind: 'approval', verdict: 'allowed-once' } })
    const missingId = await h.waitFor(11)
    expect(missingId.ok).toBe(false)
    expect(missingId.error.code).toBe(ASK_ERROR_CODES.INVALID_RESPONSE)

    expect(h.registry.pendingCount()).toBe(1)
    expect(h.registry.settlements()).toHaveLength(0)
  })
})

describe('ADR-0011 T3 — lifecycle clearing', () => {
  test('turn terminal via abort emits ask.cancel + ask.settled; late answer is TURN_ENDED', async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h, 1)
    const ask = h.registry.create(turnId, { sessionId, kind: 'approval' })

    h.send({ id: 10, method: 'turn.abort', params: { turnId } })
    expect((await h.waitFor(10)).ok).toBe(true)
    terminate(h, sessionId, { kind: 'aborted', reason: { code: 'USER_ABORT' } })
    await sleep(0)

    expect(h.askFrames('ask.cancel').some((f) => f.payload.eventId === ask.eventId)).toBe(true)
    const settled = h.askFrames('ask.settled').filter((f) => f.payload.eventId === ask.eventId)
    expect(settled).toHaveLength(1)
    expect(settled[0].payload.outcome).toBe('cancelled')

    h.send({ id: 11, method: 'ask.response', params: approval(ask.eventId) })
    const late = await h.waitFor(11)
    expect(late.ok).toBe(false)
    expect(late.error.code).toBe(ASK_ERROR_CODES.TURN_ENDED)
    expect(h.registry.pendingCount()).toBe(0)
    expect(h.registry.timerCount()).toBe(0)
  })

  test('session.close clears session asks; late answer is TURN_ENDED', async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h, 1)
    const ask = h.registry.create(turnId, { sessionId, kind: 'approval' })

    h.send({ id: 10, method: 'session.close', params: {} })
    const closed = await h.waitFor(10)
    expect(closed.ok).toBe(true)

    expect(h.askFrames('ask.cancel').some((f) => f.payload.eventId === ask.eventId)).toBe(true)
    expect(h.askFrames('ask.settled').some((f) => f.payload.eventId === ask.eventId)).toBe(true)
    expect(h.registry.pendingCount()).toBe(0)

    h.send({ id: 11, method: 'ask.response', params: approval(ask.eventId) })
    const late = await h.waitFor(11)
    expect(late.ok).toBe(false)
    expect(late.error.code).toBe(ASK_ERROR_CODES.TURN_ENDED)
  })

  test('session.open{replace:true} clears the previous session asks', async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h, 1)
    const ask = h.registry.create(turnId, { sessionId, kind: 'approval' })

    h.send({ id: 10, method: 'session.open', params: { mode: 'resume', id: 'session-B', replace: true } })
    const replaced = await h.waitFor(10)
    expect(replaced.ok).toBe(true)
    expect(replaced.result.previousSessionId).toBe(sessionId)

    expect(h.askFrames('ask.cancel').some((f) => f.payload.eventId === ask.eventId)).toBe(true)
    expect(h.askFrames('ask.settled').some((f) => f.payload.eventId === ask.eventId)).toBe(true)

    h.send({ id: 11, method: 'ask.response', params: approval(ask.eventId) })
    const late = await h.waitFor(11)
    expect(late.ok).toBe(false)
    expect(late.error.code).toBe(ASK_ERROR_CODES.TURN_ENDED)
  })

  test('clearing is idempotent, emits one cancel/settled per ask, releases timers', async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h, 1)
    const a = h.registry.create(turnId, { sessionId, kind: 'approval' })
    const b = h.registry.create(turnId, { sessionId, kind: 'questions', questions: QUESTIONS })
    expect(h.registry.timerCount()).toBe(2)

    expect(h.registry.clearTurn(turnId)).toHaveLength(2)
    expect(h.registry.clearTurn(turnId)).toHaveLength(0)
    expect(h.registry.clearSession(sessionId)).toHaveLength(0)
    expect(h.registry.clearSession(sessionId)).toHaveLength(0)
    expect(h.registry.timerCount()).toBe(0)
    expect(h.registry.settlements()).toHaveLength(2)

    const ids = [a.eventId, b.eventId]
    const cancels = h.askFrames('ask.cancel').filter((f) => ids.includes(f.payload.eventId))
    const settled = h.askFrames('ask.settled').filter((f) => ids.includes(f.payload.eventId))
    expect(cancels).toHaveLength(2)
    expect(settled).toHaveLength(2)
  })

  test('connection teardown disposes the registry and releases every timer', async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h, 1)
    h.registry.create(turnId, { sessionId, kind: 'approval' })
    h.registry.create(turnId, { sessionId, kind: 'approval' })
    expect(h.registry.timerCount()).toBe(2)

    h.dispose()
    h.dispose() // idempotent
    expect(h.registry.timerCount()).toBe(0)
    expect(h.registry.pendingCount()).toBe(0)
  })
})

// A6 — production call point for AskRegistry.pendingSnapshot.
describe('session.open resume pushes the pendingSnapshot frame', () => {
  test('resume open pushes ask.pending with the still-pending askId (idempotent binding)', async () => {
    const h = makeHarness()
    const { sessionId, turnId } = await startTurn(h, 1)
    const ask = h.registry.create(turnId, { sessionId, kind: 'approval', toolName: 'bash' })
    expect(h.askFrames('ask.pending')).toHaveLength(0) // no snapshot on fresh open

    // DEAD recovery re-opens the same live session — the idempotent resume path.
    h.send({ id: 20, method: 'session.open', params: { mode: 'resume', id: sessionId } })
    const opened = await h.waitFor(20)
    expect(opened.ok).toBe(true)

    const snapshots = h.askFrames('ask.pending')
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].payload.sessionId).toBe(sessionId)
    expect(snapshots[0].payload.asks.map((a: any) => a.eventId)).toEqual([ask.eventId])
    // Pushing the snapshot is a pure read — the ask is still pending/answerable.
    expect(h.registry.pendingIds()).toEqual([ask.eventId])
  })

  test('fresh (mode:new) open pushes NO ask.pending frame', async () => {
    const h = makeHarness()
    h.send({ id: 1, method: 'session.open', params: { mode: 'new' } })
    const opened = await h.waitFor(1)
    expect(opened.ok).toBe(true)
    expect(h.askFrames('ask.pending')).toHaveLength(0)
  })
})
