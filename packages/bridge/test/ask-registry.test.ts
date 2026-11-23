/**
 * ADR-0011 T2 — AskRegistry unit tests.
 *
 * Fake-ctx discipline (mirrors turn-abort.test.ts): no host package import, no
 * stdio, no dispatch. A fake cordis-style logger + an injected frame sink are
 * handed to the registry; time is driven with short real timers and an
 * injectable clock so every case stays deterministic and every registry is
 * disposed in afterEach (leak safety).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { ASK_ERROR_CODES, type AskKind, type AskRequestPayload } from '../src/ask-frames'
import { AskRegistry, type AskOutboundFrame, type AskRegistryLogger, type AskRegistryOptions } from '../src/ask-registry'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

interface Harness {
  registry: AskRegistry
  frames: AskOutboundFrame[]
  ctx: { logger: AskRegistryLogger }
}

function makeRegistry(options: AskRegistryOptions = {}): Harness {
  // Fake ctx: only the logger slice the registry is allowed to observe.
  const ctx = { logger: { debug() {}, warn() {}, info() {}, error() {} } }
  const frames: AskOutboundFrame[] = []
  const registry = new AskRegistry({
    askDeadlineMs: null,
    detachGraceMs: 1000,
    maxAskWaitMs: 1000,
    now: () => Date.now(),
    sink: (frame) => frames.push(frame),
    logger: ctx.logger,
    ...options,
  })
  cleanups.push(() => registry.dispose())
  return { registry, frames, ctx }
}

const QUESTIONS: AskRequestPayload['questions'] = [
  { id: 'q1', prompt: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] },
]

function addAsk(
  registry: AskRegistry,
  turnId: string,
  sessionId = 's1',
  kind: AskKind = 'approval',
  overrides: Partial<Omit<AskRequestPayload, 'eventId' | 'sessionId' | 'kind'>> = {},
): AskRequestPayload {
  return registry.create(turnId, {
    sessionId,
    kind,
    toolName: 'bash',
    ...(kind === 'questions' ? { questions: QUESTIONS } : {}),
    ...overrides,
  })
}

function approval(eventId: string, verdict: 'allowed-once' | 'rejected' | 'unavailable' = 'allowed-once') {
  return { eventId, kind: 'approval' as const, verdict }
}

describe('AskRegistry: eventId + pending table', () => {
  test('eventId is turn-scoped monotonic and pending is keyed by it', () => {
    const { registry, frames } = makeRegistry()
    const a = addAsk(registry, 't1')
    const b = addAsk(registry, 't1', 's1', 'questions')
    const c = addAsk(registry, 't2')
    expect(a.eventId).toBe('t1:ask-1')
    expect(b.eventId).toBe('t1:ask-2')
    expect(c.eventId).toBe('t2:ask-1')
    expect(registry.pendingIds()).toEqual([a.eventId, b.eventId, c.eventId])
    expect(frames.filter((f) => f.type === 'ask.request')).toHaveLength(3)
    expect(registry.pendingSnapshot('s1')).toHaveLength(3)
  })
})

describe('AskRegistry: first-wins and duplicate submissions', () => {
  test('first answer settles exactly once and disarms that ask timers', () => {
    const { registry, frames } = makeRegistry()
    const a = addAsk(registry, 't1')
    const b = addAsk(registry, 't1')
    expect(registry.timerCount()).toBe(2) // one hard cap per ask (askDeadlineMs is null)

    const first = registry.answer('s1', approval(a.eventId))
    expect(first.ok).toBe(true)
    if (first.ok) expect(first.settlement.outcome).toBe('approved')
    expect(registry.pendingCount()).toBe(1)
    expect(registry.timerCount()).toBe(1) // only b's hard cap remains
    expect(registry.settlements()).toHaveLength(1)
    expect(frames.filter((f) => f.type === 'ask.settled')).toHaveLength(1)
  })

  test('duplicate submission returns ASK_ALREADY_ANSWERED and never changes state', () => {
    const { registry } = makeRegistry()
    const a = addAsk(registry, 't1')
    expect(registry.answer('s1', approval(a.eventId, 'allowed-once')).ok).toBe(true)

    const second = registry.answer('s1', approval(a.eventId, 'rejected'))
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.code).toBe(ASK_ERROR_CODES.ALREADY_ANSWERED)
    expect(registry.settlements()).toHaveLength(1)
    expect(registry.settlements()[0].outcome).toBe('approved')
  })
})

describe('AskRegistry: three wall clocks', () => {
  test('askDeadlineMs expiry settles an approval as denied + ASK_DEADLINE_EXCEEDED', async () => {
    const { registry, frames } = makeRegistry({ askDeadlineMs: 20, maxAskWaitMs: 1000 })
    const a = addAsk(registry, 't1')
    expect(registry.timerCount()).toBe(2) // deadline + hard cap

    await sleep(70)
    const settled = registry.settlements()
    expect(settled).toHaveLength(1)
    expect(settled[0].eventId).toBe(a.eventId)
    expect(settled[0].outcome).toBe('denied') // PENDING-CONFIRMATION Q1: permission timeout -> deny
    expect(settled[0].code).toBe(ASK_ERROR_CODES.DEADLINE_EXCEEDED)
    expect(registry.timerCount()).toBe(0)
    expect(frames.some((f) => f.type === 'ask.cancel' && f.payload.reason === 'deadline')).toBe(true)
  })

  test('detachGraceMs expiry cancels an unanswered ask; re-attach disarms the grace timer', async () => {
    const a = makeRegistry({ detachGraceMs: 20, maxAskWaitMs: 1000 })
    const ask = addAsk(a.registry, 't1')
    a.registry.markDetached('s1')
    expect(a.registry.timerCount()).toBe(2) // grace + hard cap
    await sleep(70)
    expect(a.registry.settlements()[0].outcome).toBe('cancelled') // PENDING-CONFIRMATION Q2
    expect(a.registry.settlements()[0].code).toBe(ASK_ERROR_CODES.TURN_ENDED)
    expect(a.frames.some((f) => f.type === 'ask.cancel' && f.payload.reason === 'host-abort')).toBe(true)

    const b = makeRegistry({ detachGraceMs: 20, maxAskWaitMs: 1000 })
    addAsk(b.registry, 't2')
    b.registry.markDetached('s1')
    b.registry.markAttached('s1')
    expect(b.registry.timerCount()).toBe(1) // grace disarmed, hard cap remains
    await sleep(70)
    expect(b.registry.settlements()).toHaveLength(0)
    expect(b.registry.pendingCount()).toBe(1)
    expect(ask.eventId).not.toBe('')
  })

  test('maxAskWaitMs hard cap settles unavailable even with a far-future deadlineAt', async () => {
    const { registry } = makeRegistry({ askDeadlineMs: null, maxAskWaitMs: 20 })
    const a = addAsk(registry, 't1', 's1', 'approval', { deadlineAt: Date.now() + 100_000 })
    expect(registry.timerCount()).toBe(2) // deadline (far future) + hard cap
    await sleep(70)
    const settled = registry.settlements()
    expect(settled).toHaveLength(1)
    expect(settled[0].outcome).toBe('unavailable')
    expect(settled[0].code).toBe(ASK_ERROR_CODES.DEADLINE_EXCEEDED)
    expect(settled[0].message).toContain('maxAskWaitMs')
  })
})

describe('AskRegistry: turn/session teardown and error routing', () => {
  test('clearTurn cancels every pending ask of that turn; late answers are ASK_TURN_ENDED', () => {
    const { registry } = makeRegistry()
    const a = addAsk(registry, 't1')
    addAsk(registry, 't1', 's1', 'questions')
    const c = addAsk(registry, 't2')

    const cleared = registry.clearTurn('t1')
    expect(cleared).toHaveLength(2)
    expect(cleared.every((s) => s.outcome === 'cancelled')).toBe(true)
    expect(registry.pendingIds()).toEqual([c.eventId])
    expect(registry.timerCount()).toBe(1) // only t2's hard cap

    const late = registry.answer('s1', approval(a.eventId))
    expect(late.ok).toBe(false)
    if (!late.ok) expect(late.code).toBe(ASK_ERROR_CODES.TURN_ENDED)
    expect(registry.settlements()).toHaveLength(2) // late answer did not settle again
  })

  test('clearSession cancels every pending ask of that session', () => {
    const { registry } = makeRegistry()
    const a = addAsk(registry, 't1', 's2')
    addAsk(registry, 't2', 's1')
    expect(registry.clearSession('s2')).toHaveLength(1)
    expect(registry.pendingIds()).not.toContain(a.eventId)
    const late = registry.answer('s2', approval(a.eventId))
    expect(late.ok).toBe(false)
    if (!late.ok) expect(late.code).toBe(ASK_ERROR_CODES.TURN_ENDED)
  })

  test('unknown id -> ASK_UNKNOWN_REQUEST; wrong session -> ASK_NOT_ADDRESSEE', () => {
    const { registry } = makeRegistry()
    const a = addAsk(registry, 't1', 's1')

    const unknown = registry.answer('s1', approval('never:ask-99'))
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.code).toBe(ASK_ERROR_CODES.UNKNOWN_REQUEST)

    const wrong = registry.answer('s2', approval(a.eventId))
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.code).toBe(ASK_ERROR_CODES.NOT_ADDRESSEE)
    expect(registry.pendingCount()).toBe(1) // still addressable by the right session

    expect(registry.answer('s1', approval(a.eventId)).ok).toBe(true)
  })

  test('failClosed never pushes ask.request and returns ASK_CHANNEL_UNAVAILABLE', () => {
    const { registry, frames } = makeRegistry()
    const { code, settlement } = registry.failClosed({ turnId: 't1', sessionId: 's1', kind: 'approval' })
    expect(code).toBe(ASK_ERROR_CODES.CHANNEL_UNAVAILABLE)
    expect(settlement.outcome).toBe('unavailable')
    expect(frames.some((f) => f.type === 'ask.request')).toBe(false)
    expect(frames.some((f) => f.type === 'ask.settled')).toBe(true)
    const late = registry.answer('s1', approval(settlement.eventId))
    expect(late.ok).toBe(false)
    if (!late.ok) expect(late.code).toBe(ASK_ERROR_CODES.ALREADY_ANSWERED)
  })

  test('behavior:"always" requires escalation on both wire and request', () => {
    const { registry } = makeRegistry()
    const granted = addAsk(registry, 't1', 's1', 'approval', { escalation: true })
    const ok = registry.answer('s1', { ...approval(granted.eventId), behavior: 'always', escalation: true })
    expect(ok.ok).toBe(true)
    expect(registry.sessionGrants('s1')).toContain('bash') // PENDING-CONFIRMATION Q3: session-scoped

    const notGranted = addAsk(registry, 't1', 's1', 'approval', { escalation: false })
    const bad = registry.answer('s1', { ...approval(notGranted.eventId), behavior: 'always', escalation: true })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.code).toBe(ASK_ERROR_CODES.INVALID_RESPONSE)
    expect(registry.pendingCount()).toBe(1) // rejected response did not settle
  })

  test('behavior:"session" grants all four gated write tools; always keeps its single-tool grant', () => {
    const { registry, frames } = makeRegistry()
    // always: unchanged — only the ask's own tool is granted.
    const alwaysAsk = addAsk(registry, 't1', 's1', 'approval', { escalation: true, toolName: 'bash' })
    expect(registry.answer('s1', { ...approval(alwaysAsk.eventId), behavior: 'always', escalation: true }).ok).toBe(true)
    expect([...registry.sessionGrants('s1')].sort()).toEqual(['bash'])

    // session: all four gate tools granted, no fifth.
    registry.clearSessionGrants('s1')
    const sessionAsk = addAsk(registry, 't2', 's1', 'approval', { escalation: true, toolName: 'write' })
    const ok = registry.answer('s1', { ...approval(sessionAsk.eventId), behavior: 'session', escalation: true })
    expect(ok.ok).toBe(true)
    expect([...registry.sessionGrants('s1')].sort()).toEqual(['apply_patch', 'bash', 'edit', 'write'])

    // Host verdict / settlement semantics unchanged (ADR-0011:52 folding).
    expect(ok.ok && ok.settlement.outcome).toBe('approved')
    const settled = frames.filter((f) => f.type === 'ask.settled').at(-1)
    expect(settled).toMatchObject({ payload: { outcome: 'approved' } })
  })
})

describe('AskRegistry: timer release / no leak', () => {
  test('dispose releases every timer and suppresses all pending callbacks', async () => {
    const frames: AskOutboundFrame[] = []
    const registry = new AskRegistry({
      askDeadlineMs: 15,
      detachGraceMs: 15,
      maxAskWaitMs: 40,
      sink: (frame) => frames.push(frame),
    })
    addAsk(registry, 't1')
    addAsk(registry, 't1', 's1', 'questions')
    registry.markDetached('s1')
    expect(registry.timerCount()).toBeGreaterThan(0)
    expect(registry.pendingCount()).toBe(2)

    const settledBefore = registry.settlements().length
    const framesBefore = frames.length
    registry.dispose()
    registry.dispose() // idempotent
    expect(registry.timerCount()).toBe(0)
    expect(registry.pendingCount()).toBe(0)

    // Wait past every armed delay: without clearTimeout these would fire and
    // emit cancel/settled frames (the leak this test guards against).
    await sleep(90)
    expect(registry.settlements()).toHaveLength(settledBefore)
    expect(frames).toHaveLength(framesBefore)
  })
})
