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
import { ASK_JOURNAL_KINDS, redactIdentifier, type AskJournalWriteEvent } from '../src/ask-journal'
import { AskRegistry, type AskOutboundFrame, type AskRegistryLogger, type AskRegistryOptions, type AskSettlement } from '../src/ask-registry'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

interface Harness {
  registry: AskRegistry
  frames: AskOutboundFrame[]
  journal: AskJournalWriteEvent[]
  ctx: { logger: AskRegistryLogger }
}

function makeRegistry(options: AskRegistryOptions = {}): Harness {
  // Fake ctx: only the logger slice the registry is allowed to observe.
  const ctx = { logger: { debug() {}, warn() {}, info() {}, error() {} } }
  const frames: AskOutboundFrame[] = []
  const journal: AskJournalWriteEvent[] = []
  const registry = new AskRegistry({
    askDeadlineMs: null,
    detachGraceMs: 1000,
    maxAskWaitMs: 1000,
    now: () => Date.now(),
    sink: (frame) => frames.push(frame),
    journal: (event) => journal.push(event),
    logger: ctx.logger,
    ...options,
  })
  cleanups.push(() => registry.dispose())
  return { registry, frames, journal, ctx }
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

type SettledFrame = Extract<AskOutboundFrame, { type: 'ask.settled' }>
function settledFrames(frames: AskOutboundFrame[]): SettledFrame[] {
  return frames.filter((f): f is SettledFrame => f.type === 'ask.settled')
}
function terminalRows(journal: AskJournalWriteEvent[]): AskJournalWriteEvent[] {
  return journal.filter((e) => e.kind !== ASK_JOURNAL_KINDS.REQUESTED)
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
    const { registry, frames, journal } = makeRegistry()
    // always: unchanged — only the ask's own tool is granted.
    const alwaysAsk = addAsk(registry, 't1', 's1', 'approval', { escalation: true, toolName: 'bash' })
    expect(registry.answer('s1', { ...approval(alwaysAsk.eventId), behavior: 'always', escalation: true }).ok).toBe(true)
    expect([...registry.sessionGrants('s1')].sort()).toEqual(['bash'])

    // session: all four gate tools granted, no fifth.
    registry.clearSessionGrants('s1')
    const rawChild = 'child "raw"/2'
    const redactedChild = redactIdentifier(rawChild)
    expect(redactedChild).toBeDefined()
    const sessionAsk = addAsk(registry, 't2', 's1', 'approval', {
      escalation: true, toolName: 'write', childSessionId: rawChild,
    })
    const ok = registry.answer('s1', { ...approval(sessionAsk.eventId), behavior: 'session', escalation: true })
    expect(ok.ok).toBe(true)
    expect([...registry.sessionGrants('s1')].sort()).toEqual(['apply_patch', 'bash', 'edit', 'write'])

    // ADR-0011 T7: every per-tool durability row carries the child attribution,
    // redacted the same way as the requested/terminal rows (no raw id on disk).
    const perToolRows = journal.filter(
      (e) => e.eventId === sessionAsk.eventId && e.behavior === 'always' && e.source === 'answer',
    )
    expect(perToolRows).toHaveLength(4)
    expect(perToolRows.map((e) => e.toolName).sort()).toEqual(['apply_patch', 'bash', 'edit', 'write'])
    for (const row of perToolRows) {
      expect(row.childSessionId).toBe(redactedChild)
    }
    expect(journal.some((e) => Object.values(e).includes(rawChild))).toBe(false)

    // Host verdict / settlement semantics unchanged (ADR-0011:52 folding).
    expect(ok.ok && ok.settlement.outcome).toBe('approved')
    const settled = frames.filter((f) => f.type === 'ask.settled').at(-1)
    expect(settled).toMatchObject({ payload: { outcome: 'approved' } })
  })

  test('behavior:"session" requires escalation — non-escalated ask is rejected with no grant (B4-3)', () => {
    const { registry } = makeRegistry()
    const notGranted = addAsk(registry, 't1', 's1', 'approval', { escalation: false, toolName: 'write' })
    const bad = registry.answer('s1', { ...approval(notGranted.eventId), behavior: 'session', escalation: true })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.code).toBe(ASK_ERROR_CODES.INVALID_RESPONSE)
      expect(bad.message).toBe('behavior:"session" needs a granted escalation')
    }
    // Same refusal path as 'always': no session grant and the ask stays pending.
    expect([...registry.sessionGrants('s1')]).toEqual([])
    expect(registry.pendingCount()).toBe(1)
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

  test('dispose keeps the settlement snapshot after repeated calls', () => {
    const { registry } = makeRegistry()
    const ask = addAsk(registry, 't1')
    registry.clearTurn('t1')
    // settlements() exposes the internal array — snapshot it before dispose.
    const snapshot = structuredClone(registry.settlements())

    registry.dispose()
    registry.dispose() // idempotent

    expect(registry.settlements()).toEqual(snapshot)
    expect(registry.settlements()).toHaveLength(1)
    expect(registry.settlements()[0].eventId).toBe(ask.eventId)
    expect(registry.settlements()[0].outcome).toBe('cancelled')
    expect(registry.pendingIds()).toEqual([])
    expect(registry.timerCount()).toBe(0)
  })
})

describe('AskRegistry: settleReason on journal + ask.settled frame', () => {
  test('answer() maps approved/rejected/unavailable explicitly and carries pending metadata', () => {
    const h = makeRegistry()
    const yes = addAsk(h.registry, 't1', 's1', 'approval', { toolName: 'bash', callId: 'call-1' })
    const no = addAsk(h.registry, 't1', 's1', 'approval', { toolName: 'bash' })
    const na = addAsk(h.registry, 't1', 's1', 'approval', { toolName: 'bash' })
    expect(h.registry.answer('s1', approval(yes.eventId)).ok).toBe(true)
    expect(h.registry.answer('s1', approval(no.eventId, 'rejected')).ok).toBe(true)
    expect(h.registry.answer('s1', approval(na.eventId, 'unavailable')).ok).toBe(true)

    expect(terminalRows(h.journal).map((e) => e.settleReason)).toEqual(['answered', 'rejected', 'unavailable'])
    expect(terminalRows(h.journal).map((e) => e.settleReason)).not.toContain('cancelled')
    expect(h.registry.settlements().map((s) => s.outcome)).toEqual(['approved', 'denied', 'unavailable'])

    const first = settledFrames(h.frames)[0].payload
    expect(first).toMatchObject({
      eventId: yes.eventId,
      reason: 'answered',
      sessionId: 's1',
      kind: 'approval',
      toolName: 'bash',
      callId: 'call-1',
    })
    expect(terminalRows(h.journal)[1]).toMatchObject({
      outcome: 'denied', verdict: 'rejected', settleReason: 'rejected', source: 'answer',
    })
  })

  test('a questions answer is answered (missing verdict is never inferred as cancelled)', () => {
    const h = makeRegistry()
    const ask = addAsk(h.registry, 't1', 's1', 'questions')
    const result = h.registry.answer('s1', {
      eventId: ask.eventId, kind: 'questions', answers: [{ id: 'q1', selected: ['Yes'] }],
    })
    expect(result.ok).toBe(true)
    expect(terminalRows(h.journal)[0].settleReason).toBe('answered')
    expect(settledFrames(h.frames)[0].payload.reason).toBe('answered')
  })

  test('deadline expiry writes timeout (journal + frame), keeping code and cancel vocabulary', async () => {
    const h = makeRegistry({ askDeadlineMs: 15, maxAskWaitMs: 1000 })
    addAsk(h.registry, 't1')
    await sleep(70)
    expect(terminalRows(h.journal)).toHaveLength(1)
    expect(terminalRows(h.journal)[0]).toMatchObject({
      kind: ASK_JOURNAL_KINDS.CANCELLED,
      settleReason: 'timeout',
      reason: 'deadline',
      code: ASK_ERROR_CODES.DEADLINE_EXCEEDED,
      source: 'timeout',
    })
    expect(settledFrames(h.frames)[0].payload.reason).toBe('timeout')
    expect(h.frames.some((f) => f.type === 'ask.cancel' && f.payload.reason === 'deadline')).toBe(true)
  })

  test('hard cap writes timeout even when deadlineAt is far in the future', async () => {
    const h = makeRegistry({ askDeadlineMs: null, maxAskWaitMs: 15 })
    addAsk(h.registry, 't1', 's1', 'approval', { deadlineAt: Date.now() + 100_000 })
    await sleep(70)
    expect(terminalRows(h.journal)[0]).toMatchObject({
      settleReason: 'timeout',
      code: ASK_ERROR_CODES.DEADLINE_EXCEEDED,
      source: 'timeout',
    })
    expect(settledFrames(h.frames)[0].payload.reason).toBe('timeout')
  })

  test('clearTurn → turn-ended and clearSession → session-closed', () => {
    const h = makeRegistry()
    const a = addAsk(h.registry, 't1', 's1')
    const b = addAsk(h.registry, 't2', 's2')
    expect(h.registry.clearTurn('t1')).toHaveLength(1)
    expect(h.registry.clearSession('s2')).toHaveLength(1)

    const rows = terminalRows(h.journal)
    expect(rows.map((e) => e.settleReason)).toEqual(['turn-ended', 'session-closed'])
    expect(rows.every((e) => e.kind === ASK_JOURNAL_KINDS.CANCELLED)).toBe(true)
    expect(settledFrames(h.frames).map((f) => f.payload.reason)).toEqual(['turn-ended', 'session-closed'])
    expect(h.registry.answer('s1', approval(a.eventId)).ok).toBe(false)
    expect(h.registry.answer('s2', approval(b.eventId)).ok).toBe(false)
    expect(terminalRows(h.journal)).toHaveLength(2) // late answers wrote no new row
  })

  test('detach grace → detached while ask.cancel keeps its own vocabulary', async () => {
    const h = makeRegistry({ detachGraceMs: 15, maxAskWaitMs: 1000 })
    addAsk(h.registry, 't1')
    h.registry.markDetached('s1')
    await sleep(70)
    expect(terminalRows(h.journal)[0]).toMatchObject({
      kind: ASK_JOURNAL_KINDS.CANCELLED, settleReason: 'detached', reason: 'host-abort',
    })
    expect(settledFrames(h.frames)[0].payload.reason).toBe('detached')
    expect(h.frames.some((f) => f.type === 'ask.cancel' && f.payload.reason === 'host-abort')).toBe(true)
  })

  test('failClosed → no-channel with metadata; sessionId unknown is preserved', () => {
    const h = makeRegistry()
    const { settlement } = h.registry.failClosed({
      turnId: 't1', sessionId: 'unknown', kind: 'approval',
      toolName: 'bash', callId: 'call-x', childSessionId: 'child raw/1',
    })
    expect(h.journal.map((e) => e.kind)).toEqual([ASK_JOURNAL_KINDS.RESPONDED])
    expect(h.journal[0]).toMatchObject({
      settleReason: 'no-channel',
      sessionId: 'unknown',
      toolName: 'bash',
      childSessionId: redactIdentifier('child raw/1'),
      code: ASK_ERROR_CODES.CHANNEL_UNAVAILABLE,
      source: 'fail-closed',
    })
    expect(settledFrames(h.frames)[0].payload).toMatchObject({
      eventId: settlement.eventId,
      reason: 'no-channel',
      sessionId: 'unknown',
      kind: 'approval',
      toolName: 'bash',
      callId: 'call-x',
      childSessionId: 'child raw/1',
    })
    expect(h.frames.some((f) => f.type === 'ask.request')).toBe(false)
  })

  test('recordSummaryDecision journals auto-approved only: no frame, no new grant', () => {
    const h = makeRegistry()
    const id = h.registry.recordSummaryDecision('t1', {
      sessionId: 's1', askKind: 'approval', toolName: 'bash',
    })
    expect(h.journal).toHaveLength(1)
    expect(h.journal[0]).toMatchObject({
      eventId: id,
      kind: ASK_JOURNAL_KINDS.RESPONDED,
      settleReason: 'auto-approved',
      source: 'summary',
      behavior: 'always',
      outcome: 'approved',
    })
    expect(h.frames).toHaveLength(0)
    expect(h.registry.settlements()).toHaveLength(0)
    expect(h.registry.sessionGrants('s1')).toEqual([])
  })

  test('external abort settles by eventId; repeats, late answers and unknown ids are no-op', () => {
    const h = makeRegistry()
    const ask = addAsk(h.registry, 't1', 's1', 'approval', { toolName: 'bash', callId: 'c1' })
    const first = h.registry.settleExternal(ask.eventId, { settleReason: 'aborted' })
    expect(first?.outcome).toBe('cancelled')
    expect(h.registry.pendingIds()).toEqual([])
    expect(settledFrames(h.frames)[0].payload).toMatchObject({
      reason: 'aborted', sessionId: 's1', kind: 'approval', toolName: 'bash', callId: 'c1',
    })
    expect(terminalRows(h.journal)[0]).toMatchObject({
      kind: ASK_JOURNAL_KINDS.CANCELLED, settleReason: 'aborted', source: 'teardown',
    })

    const journalBefore = h.journal.length
    const framesBefore = h.frames.length
    expect(h.registry.settleExternal(ask.eventId, { settleReason: 'aborted' })).toBeUndefined()
    expect(h.registry.settleExternal(ask.eventId, { settleReason: 'timeout' })).toBeUndefined()
    expect(h.registry.settleExternal('never:ask-99', { settleReason: 'connection-closed' })).toBeUndefined()
    expect(h.journal).toHaveLength(journalBefore)
    expect(h.frames).toHaveLength(framesBefore)

    const late = h.registry.answer('s1', approval(ask.eventId))
    expect(late.ok).toBe(false)
    if (!late.ok) expect(late.code).toBe(ASK_ERROR_CODES.TURN_ENDED)
    expect(h.journal).toHaveLength(journalBefore)
  })

  test('external connection-closed settles every pending id exactly once', () => {
    const h = makeRegistry()
    const a = addAsk(h.registry, 't1')
    const b = addAsk(h.registry, 't2')
    expect(h.registry.settleExternal(a.eventId, { settleReason: 'connection-closed' })?.outcome).toBe('cancelled')
    expect(h.registry.settleExternal(b.eventId, { settleReason: 'connection-closed' })?.outcome).toBe('cancelled')
    expect(terminalRows(h.journal).map((e) => e.settleReason)).toEqual(['connection-closed', 'connection-closed'])
    expect(settledFrames(h.frames).map((f) => f.payload.reason)).toEqual(['connection-closed', 'connection-closed'])
    expect(h.registry.pendingIds()).toEqual([])
  })

  test('external timeout maps defaultOutcome rejected→denied / unavailable→unavailable', () => {
    const h = makeRegistry()
    const rejected = addAsk(h.registry, 't1', 's1', 'approval')
    const unavailable = addAsk(h.registry, 't2', 's1', 'approval')
    const explicit = addAsk(h.registry, 't3', 's1', 'questions')
    expect(h.registry.settleExternal(rejected.eventId, {
      settleReason: 'timeout', defaultOutcome: 'rejected',
    })?.outcome).toBe('denied')
    expect(h.registry.settleExternal(unavailable.eventId, {
      settleReason: 'timeout', defaultOutcome: 'unavailable',
    })?.outcome).toBe('unavailable')
    expect(h.registry.settleExternal(explicit.eventId, {
      settleReason: 'timeout', outcome: 'cancelled',
    })?.outcome).toBe('cancelled')

    const rows = terminalRows(h.journal)
    expect(rows.map((e) => e.settleReason)).toEqual(['timeout', 'timeout', 'timeout'])
    expect(rows.every((e) => e.source === 'timeout' && e.code === ASK_ERROR_CODES.DEADLINE_EXCEEDED)).toBe(true)
    expect(settledFrames(h.frames).map((f) => f.payload.reason)).toEqual(['timeout', 'timeout', 'timeout'])
  })

  test('create() rolls back pending + timers when the request emit throws', async () => {
    const frames: AskOutboundFrame[] = []
    let throwOnRequest = true
    const registry = new AskRegistry({
      askDeadlineMs: 20,
      maxAskWaitMs: 100_000,
      sink: (frame) => {
        if (throwOnRequest && frame.type === 'ask.request') throw new Error('sink down')
        frames.push(frame)
      },
    })
    cleanups.push(() => registry.dispose())

    expect(() => addAsk(registry, 't1')).toThrow('sink down')
    expect(registry.pendingIds()).toEqual([])
    expect(registry.timerCount()).toBe(0)

    throwOnRequest = false
    const ok = addAsk(registry, 't2', 's1', 'approval', { deadlineAt: Date.now() + 100_000 })
    await sleep(70) // the rolled-back ask's 20ms deadline must not fire
    expect(registry.settlements()).toHaveLength(0)
    expect(registry.pendingIds()).toEqual([ok.eventId])
    expect(frames.filter((f) => f.type === 'ask.cancel')).toHaveLength(0)
  })

  test('settleExternal(timeout) commits fully even when the sink throws on every frame', () => {
    const frames: AskOutboundFrame[] = []
    const journal: AskJournalWriteEvent[] = []
    // Indirection lets the harness flip the sink AFTER a normal create(); the
    // registry captures the option once at construction time.
    let sink: (frame: AskOutboundFrame) => void = (frame) => { frames.push(frame) }
    const registry = new AskRegistry({
      askDeadlineMs: null,
      maxAskWaitMs: 100_000,
      sink: (frame) => sink(frame),
      journal: (event) => journal.push(event),
    })
    cleanups.push(() => registry.dispose())

    const ask = addAsk(registry, 't1', 's1', 'approval', { toolName: 'bash' })
    expect(frames.filter((f) => f.type === 'ask.request')).toHaveLength(1)

    // From here on every terminal frame throws from the sink.
    sink = () => { throw new Error('sink down') }

    let settlement: AskSettlement | undefined = undefined
    expect(() => {
      settlement = registry.settleExternal(ask.eventId, { settleReason: 'timeout' })
    }).not.toThrow()

    expect(settlement).toBeDefined()
    expect(settlement?.eventId).toBe(ask.eventId)
    expect(settlement?.outcome).toBe('denied') // approval + gate defaultOutcome absent
    const rows = terminalRows(journal)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      settleReason: 'timeout', source: 'timeout', code: ASK_ERROR_CODES.DEADLINE_EXCEEDED,
    })
    expect(registry.pendingIds()).toEqual([])
    expect(registry.timerCount()).toBe(0)
  })

  test('childSessionId is redacted in requested and terminal journal rows', () => {
    const h = makeRegistry()
    const raw = 'child "raw"/1'
    const ask = addAsk(h.registry, 't1', 's1', 'approval', { childSessionId: raw })
    h.registry.answer('s1', approval(ask.eventId))
    const redacted = redactIdentifier(raw)
    expect(redacted).toBeDefined()
    expect(h.journal[0]).toMatchObject({ kind: ASK_JOURNAL_KINDS.REQUESTED, childSessionId: redacted })
    expect(terminalRows(h.journal)[0]).toMatchObject({ childSessionId: redacted })
    expect(settledFrames(h.frames)[0].payload.childSessionId).toBe(raw)
  })
})
