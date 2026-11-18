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
  ASK_JOURNAL_KINDS,
  ASK_PLUGIN_RECORD_PREFIX,
  SessionPermissionSummary,
  askPluginRecordType,
  redactIdentifier,
  summarizeAnswers,
  type AskJournalEvent,
} from '../src/ask-journal'
import { AskRegistry, type AskRegistryOptions } from '../src/ask-registry'

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
