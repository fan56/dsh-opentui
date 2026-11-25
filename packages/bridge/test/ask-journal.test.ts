/**
 * ADR-0011 T7 — ask decision persistence + session-scoped permission summary.
 *
 * Fake-ctx discipline mirrors ask-registry.test.ts: no host package, no stdio,
 * no dispatch. A fake journal sink captures the ALREADY-REDACTED events the
 * registry emits; a fake compaction clears that sink (log events) while the
 * summary must survive. Every registry is disposed in afterEach.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  ASK_GRANT_JOURNAL_TYPE,
  ASK_JOURNAL_KINDS,
  ASK_PLUGIN_RECORD_PREFIX,
  SessionPermissionSummary,
  alwaysGrantToolsFromJournal,
  askPluginRecordType,
  redactIdentifier,
  summarizeAnswers,
  type AskJournalEvent,
  type AskJournalTerminalEvent,
  type AskJournalWriteEvent,
} from '../src/ask-journal'
import { AskRegistry, type AskRegistryOptions } from '../src/ask-registry'

/** Compile-time check: `value` must satisfy T; returns it unchanged. */
function accepts<T>(value: T): T {
  return value
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

interface Harness {
  registry: AskRegistry
  journal: AskJournalEvent[]
}

function makeRegistry(options: AskRegistryOptions = {}): Harness {
  const journal: AskJournalEvent[] = []
  const registry = new AskRegistry({
    askDeadlineMs: null,
    maxAskWaitMs: 1000,
    journal: (event) => journal.push(event),
    ...options,
  })
  cleanups.push(() => registry.dispose())
  return { registry, journal }
}

const approval = (
  eventId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({ eventId, kind: 'approval', verdict: 'allowed-once', ...extra })

describe('ADR-0011 T7 — journal event shape + ordering', () => {
  test('create → answer writes requested then responded with bounded fields', () => {
    const { registry, journal } = makeRegistry()
    const request = registry.create('t1', { sessionId: 's1', kind: 'approval', toolName: 'bash' })
    registry.answer('s1', approval(request.eventId))

    expect(journal.map((event) => event.kind)).toEqual([
      ASK_JOURNAL_KINDS.REQUESTED,
      ASK_JOURNAL_KINDS.RESPONDED,
    ])
    const [requested, responded] = journal
    expect(requested.eventId).toBe('t1:ask-1')
    expect(requested).toMatchObject({
      kind: 'ask.requested',
      askKind: 'approval',
      sessionId: 's1',
      turnId: 't1',
      toolName: 'bash',
      source: 'request',
    })
    expect(typeof requested.at).toBe('number')
    expect(responded).toMatchObject({
      kind: 'ask.responded',
      eventId: requested.eventId,
      outcome: 'approved',
      verdict: 'allowed-once',
      source: 'answer',
    })
  })

  test('turn teardown writes requested then cancelled with a closed-vocabulary reason', () => {
    const { registry, journal } = makeRegistry()
    registry.create('t1', { sessionId: 's1', kind: 'questions' })
    registry.clearTurn('t1')

    expect(journal.map((event) => event.kind)).toEqual([
      ASK_JOURNAL_KINDS.REQUESTED,
      ASK_JOURNAL_KINDS.CANCELLED,
    ])
    expect(journal[1]).toMatchObject({
      outcome: 'cancelled',
      reason: 'host-abort',
      source: 'teardown',
    })
  })

  test('fail-closed writes a single responded/unavailable event (no requested)', () => {
    const { registry, journal } = makeRegistry()
    const { settlement } = registry.failClosed({ turnId: 't1', sessionId: 's1', kind: 'approval' })

    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({
      kind: 'ask.responded',
      eventId: settlement.eventId,
      outcome: 'unavailable',
      verdict: 'unavailable',
      code: 'ASK_CHANNEL_UNAVAILABLE',
      source: 'fail-closed',
    })
  })

  test('plugin record type follows the host grammar and stays ignorable', () => {
    expect(ASK_PLUGIN_RECORD_PREFIX).toBe('plugin:opentui/ask')
    expect(askPluginRecordType(ASK_JOURNAL_KINDS.REQUESTED)).toBe('plugin:opentui/ask/requested')
    expect(askPluginRecordType(ASK_JOURNAL_KINDS.RESPONDED)).toBe('plugin:opentui/ask/responded')
    expect(askPluginRecordType(ASK_JOURNAL_KINDS.CANCELLED)).toBe('plugin:opentui/ask/cancelled')
  })
})

describe('ADR-0011 T7 — redaction (never persist parameters or sensitive content)', () => {
  test('reason, question prompts, option labels and answer.custom never reach the journal', () => {
    const SECRET = 'SECRET_TOOL_ARG_pA55w0rd_DO_NOT_PERSIST'
    const { registry, journal } = makeRegistry()
    const request = registry.create('t1', {
      sessionId: 's1',
      kind: 'questions',
      toolName: 'bash',
      reason: SECRET,
      questions: [{
        id: 'q1',
        prompt: SECRET,
        options: [{ label: SECRET, description: SECRET }],
      }],
    })
    registry.answer('s1', {
      eventId: request.eventId,
      kind: 'questions',
      answers: [{ id: 'q1', selected: [SECRET, SECRET], custom: SECRET }],
    })

    const serialized = JSON.stringify(journal)
    expect(serialized).not.toContain(SECRET)
    expect(journal[1].answers).toEqual({ count: 1, selections: [2] })
    // Bounded audit records: no prompt/args payload can inflate the log.
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThan(512)
  })

  test('redactIdentifier strips free-form characters and bounds length', () => {
    expect(redactIdentifier('bash -lc "cat /etc/shadow"')).toBe('bash-lccatetcshadow')
    expect(redactIdentifier('  ')).toBeUndefined()
    expect(redactIdentifier('x'.repeat(500))).toHaveLength(96)
    expect(summarizeAnswers(undefined)).toBeUndefined()
  })
})

describe('ADR-0011 T7 — session summary survives compaction', () => {
  test('always grant stays effective after journal events are cleared', () => {
    const { registry, journal } = makeRegistry()
    const granted = registry.create('t1', {
      sessionId: 's1', kind: 'approval', toolName: 'bash', escalation: true,
    })
    const answer = registry.answer('s1', {
      ...approval(granted.eventId), behavior: 'always', escalation: true,
    })
    expect(answer.ok).toBe(true)
    expect(registry.hasGrant('s1', 'bash')).toBe(true)
    expect(registry.sessionGrants('s1')).toEqual(['bash'])
    expect(journal[1].behavior).toBe('always')

    // Simulated compaction: the host drops/replaces journal events. The summary
    // is NOT derived from them, so the effect must still hold on a NEW turn.
    // The second call takes the summary short-circuit: NO ask.create() / card,
    // exactly like index.ts's onApprovalRequest auto-grant path.
    journal.length = 0
    expect(registry.hasGrant('s1', 'bash')).toBe(true)

    const autoEventId = registry.recordSummaryDecision('t2', {
      sessionId: 's1', askKind: 'approval', toolName: 'bash',
    })
    expect(autoEventId).toBe('t2:ask-1')
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({
      kind: 'ask.responded',
      verdict: 'allowed-once',
      behavior: 'always',
      outcome: 'approved',
      source: 'summary',
      toolName: 'bash',
    })
  })

  test('session A grant never authorizes session B; close clears A', () => {
    const { registry } = makeRegistry()
    const granted = registry.create('t1', {
      sessionId: 's1', kind: 'approval', toolName: 'bash', escalation: true,
    })
    expect(registry.answer('s1', {
      ...approval(granted.eventId), behavior: 'always', escalation: true,
    }).ok).toBe(true)

    expect(registry.hasGrant('s1', 'bash')).toBe(true)
    expect(registry.hasGrant('s2', 'bash')).toBe(false)
    expect(registry.sessionGrants('s2')).toEqual([])

    registry.clearSessionGrants('s1')
    expect(registry.hasGrant('s1', 'bash')).toBe(false)

    // Standalone summary scope check (the class the registry delegates to).
    const summary = new SessionPermissionSummary()
    summary.grant('sA', 'write')
    expect(summary.has('sA', 'write')).toBe(true)
    expect(summary.has('sB', 'write')).toBe(false)
    summary.clearSession('sA')
    expect(summary.count('sA')).toBe(0)
  })
})

describe('ADR-0011 D7 — always-grant reconstruction from the durable journal (respawn)', () => {
  const row = (payload: unknown, type: string = ASK_GRANT_JOURNAL_TYPE) => ({ type, payload })
  const always = (overrides: Record<string, unknown> = {}) => ({
    eventId: 't1:ask-1',
    kind: 'ask.responded',
    askKind: 'approval',
    sessionId: 's1',
    turnId: 't1',
    toolName: 'bash',
    verdict: 'allowed-once',
    outcome: 'approved',
    behavior: 'always',
    source: 'answer',
    at: 1,
    ...overrides,
  })

  test('(a) rebuild: always-allow responded events restore tools into the summary', () => {
    const tools = alwaysGrantToolsFromJournal('s1', [
      row({ type: 'turn.start' }), // unrelated host event
      row(always()),
      row(always({ eventId: 't2:ask-1', turnId: 't2', toolName: 'write', source: 'summary' })),
    ])
    expect(tools).toEqual(['bash', 'write'])

    const summary = new SessionPermissionSummary()
    summary.restoreGrants('s1', tools)
    expect(summary.has('s1', 'bash')).toBe(true)
    expect(summary.has('s1', 'write')).toBe(true)
    expect(summary.has('s1', 'edit')).toBe(false)
    expect(summary.count('s1')).toBe(2)

    // The registry facade the bridge calls on resume exposes the same effect.
    const { registry } = makeRegistry()
    registry.restoreSessionGrants('s1', tools)
    expect(registry.sessionGrants('s1')).toEqual(['bash', 'write'])
  })

  test('(b) idempotent: replaying the same journal never accumulates duplicates', () => {
    const rows = [row(always()), row(always({ eventId: 't2:ask-1' }))]
    const summary = new SessionPermissionSummary()
    const first = alwaysGrantToolsFromJournal('s1', rows)
    summary.restoreGrants('s1', first)
    expect(summary.tools('s1')).toEqual(['bash'])

    summary.restoreGrants('s1', alwaysGrantToolsFromJournal('s1', rows))
    expect(summary.tools('s1')).toEqual(['bash'])
    expect(summary.count('s1')).toBe(1)

    const { registry } = makeRegistry()
    registry.restoreSessionGrants('s1', first)
    registry.restoreSessionGrants('s1', first)
    expect(registry.sessionGrants('s1')).toEqual(['bash'])
  })

  test('(c) corrupt / incomplete journal degrades to an empty summary without throwing', () => {
    const rows = [
      { type: ASK_GRANT_JOURNAL_TYPE, payload: 'not-an-object' },
      { type: ASK_GRANT_JOURNAL_TYPE, payload: null },
      { type: ASK_GRANT_JOURNAL_TYPE, payload: [1, 2, 3] },
      row({ behavior: 'always', outcome: 'approved', toolName: 'bash' }), // no sessionId
      row(always({ toolName: 42 })), // non-string tool name
      row(always(), 'plugin:opentui/ask/requested'), // wrong record type
    ]
    let tools: readonly string[] | undefined
    expect(() => {
      tools = alwaysGrantToolsFromJournal('s1', rows)
    }).not.toThrow()
    expect(tools).toEqual([])

    const summary = new SessionPermissionSummary()
    summary.restoreGrants('s1', tools ?? [])
    expect(summary.count('s1')).toBe(0)
  })

  test('(d) no audit events yields an empty summary', () => {
    expect(ASK_GRANT_JOURNAL_TYPE).toBe('plugin:opentui/ask/responded')
    expect(alwaysGrantToolsFromJournal('s1', [])).toEqual([])
    const summary = new SessionPermissionSummary()
    summary.restoreGrants('s1', [])
    expect(summary.count('s1')).toBe(0)
  })

  test('session scoping: a forked journal cannot inherit the parent session\'s grant', () => {
    const rows = [row(always({ sessionId: 'parent-session' }))]
    expect(alwaysGrantToolsFromJournal('child-session', rows)).toEqual([])
  })

  test('fail-closed: rejected / unavailable / cancelled / once events confer no grant', () => {
    const rows = [
      row(always({ verdict: 'rejected', outcome: 'denied' })),
      row(always({ verdict: 'unavailable', outcome: 'unavailable' })),
      row(always({ kind: 'ask.cancelled', outcome: 'cancelled', behavior: undefined })),
      row(always({ behavior: 'once' })),
    ]
    expect(alwaysGrantToolsFromJournal('s1', rows)).toEqual([])
  })

  test('production always answer produces the journal row that rebuilds the grant on respawn', () => {
    // The real answerer now grants escalation on every approval ask (index.ts),
    // so this is the exact journal event a user "always" produces in prod.
    const { registry, journal } = makeRegistry()
    const granted = registry.create('t1', {
      sessionId: 's1', kind: 'approval', toolName: 'bash', escalation: true,
    })
    expect(registry.answer('s1', {
      eventId: granted.eventId, kind: 'approval', verdict: 'allowed-once',
      behavior: 'always', escalation: true,
    }).ok).toBe(true)

    const responded = journal.find((e) => e.kind === ASK_JOURNAL_KINDS.RESPONDED)!
    expect(responded).toMatchObject({
      toolName: 'bash', behavior: 'always', outcome: 'approved',
      sessionId: 's1', source: 'answer',
    })

    // 5b94053: a fresh bridge process drains that durable row on resume and
    // repopulates the in-process summary — the next approval still skips the card.
    const restored = alwaysGrantToolsFromJournal('s1', [
      { type: ASK_GRANT_JOURNAL_TYPE, payload: responded },
    ])
    expect(restored).toEqual(['bash'])
    const fresh = new AskRegistry({ journal: () => {} })
    try {
      fresh.restoreSessionGrants('s1', restored)
      expect(fresh.hasGrant('s1', 'bash')).toBe(true)
      expect(fresh.hasGrant('s1', 'write')).toBe(false)
    } finally {
      fresh.dispose()
    }
  })

  test('production session answer journals one grant row per gate tool and rebuilds all four on respawn', () => {
    const { registry, journal } = makeRegistry()
    const asked = registry.create('t1', {
      sessionId: 's1', kind: 'approval', toolName: 'write', escalation: true,
    })
    expect(registry.answer('s1', {
      eventId: asked.eventId, kind: 'approval', verdict: 'allowed-once',
      behavior: 'session', escalation: true,
    }).ok).toBe(true)

    // One (session,tool) grant row per gate tool (marker behavior:'always'),
    // plus the real "session" settlement row recording the user's choice.
    const grantRows = journal.filter(
      (e) => e.kind === ASK_JOURNAL_KINDS.RESPONDED && e.behavior === 'always' && e.outcome === 'approved',
    )
    expect(grantRows).toHaveLength(4)
    expect([...grantRows.map((e) => e.toolName)].sort()).toEqual(['apply_patch', 'bash', 'edit', 'write'])
    for (const row of grantRows) {
      expect(row).toMatchObject({ sessionId: 's1', verdict: 'allowed-once', source: 'answer' })
    }
    const settleRow = journal.find(
      (e) => e.kind === ASK_JOURNAL_KINDS.RESPONDED && e.behavior === 'session',
    )!
    expect(settleRow).toMatchObject({ verdict: 'allowed-once', outcome: 'approved', toolName: 'write' })

    // Respawn: the durable rows rebuild the full session grant set, idempotently.
    const rows = journal.map((payload) => ({ type: ASK_GRANT_JOURNAL_TYPE, payload }))
    const restored = alwaysGrantToolsFromJournal('s1', rows)
    expect([...restored].sort()).toEqual(['apply_patch', 'bash', 'edit', 'write'])
    expect(alwaysGrantToolsFromJournal('s1', rows)).toEqual(restored)

    const fresh = new AskRegistry({ journal: () => {} })
    try {
      fresh.restoreSessionGrants('s1', restored)
      for (const tool of ['bash', 'write', 'edit', 'apply_patch']) {
        expect(fresh.hasGrant('s1', tool)).toBe(true)
      }
    } finally {
      fresh.dispose()
    }
  })
})

describe('settleReason / childSessionId — read compatibility and terminal write constraint', () => {
  const base = {
    eventId: 't1:ask-1',
    askKind: 'approval' as const,
    sessionId: 's1',
    turnId: 't1',
    source: 'answer' as const,
    at: 1,
  }

  test('TYPE: old rows read without settleReason; terminal writes require it', () => {
    accepts<AskJournalEvent>({ ...base, kind: 'ask.responded' })
    accepts<AskJournalEvent>({
      ...base, kind: 'ask.cancelled', settleReason: 'connection-closed', childSessionId: 'child-1',
    })
    accepts<AskJournalTerminalEvent>({
      ...base, kind: 'ask.responded', settleReason: 'answered', childSessionId: 'child-1',
    })
    accepts<AskJournalWriteEvent>({ ...base, kind: 'ask.requested' })
    accepts<AskJournalWriteEvent>({ ...base, kind: 'ask.cancelled', settleReason: 'aborted' })

    // @ts-expect-error terminal journal rows require settleReason
    const missing: AskJournalTerminalEvent = { ...base, kind: 'ask.responded' }
    expect(missing.eventId).toBe('t1:ask-1')

    // @ts-expect-error terminal write union requires settleReason on terminal kinds
    const badWrite: AskJournalWriteEvent = { ...base, kind: 'ask.cancelled' }
    expect(badWrite.eventId).toBe('t1:ask-1')

    // @ts-expect-error settleReason is closed vocabulary; 'ended' is legacy fallback only
    const badReason: AskJournalTerminalEvent = { ...base, kind: 'ask.responded', settleReason: 'ended' }
    expect(badReason.eventId).toBe('t1:ask-1')
  })

  test('legacy rows without settleReason still replay alongside rows carrying the new fields', () => {
    const legacy = { ...base, kind: 'ask.responded', behavior: 'always', outcome: 'approved', toolName: 'bash' }
    const tools = alwaysGrantToolsFromJournal('s1', [
      { type: ASK_GRANT_JOURNAL_TYPE, payload: legacy },
      { type: ASK_GRANT_JOURNAL_TYPE, payload: { ...legacy, settleReason: 'answered', childSessionId: 'child-1' } },
    ])
    expect(tools).toEqual(['bash'])
  })
})
