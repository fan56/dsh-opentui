/**
 * ADR-0011 T1 — schema/error-code unit tests for the ask frame layer.
 *
 * Same fake-ctx/no-host-import discipline as turn-abort.test.ts: these are pure
 * shape checks against the source-verified wire vocabulary, with no dispatch,
 * seam or stdio involved.
 */
import { describe, expect, test } from 'bun:test'
import {
  ASK_ERROR_CODES,
  ASK_FRAME_TYPES,
  SETTLE_REASONS,
  isAskErrorCode,
  isAskSettleReason,
  validateAskCancel,
  validateAskEvent,
  validateAskPending,
  validateAskRequest,
  validateAskResponse,
  validateAskSettled,
  type AskSettleReason,
  type AskSettledPayload,
  type AskSettledPayloadRead,
} from '../src/ask-frames'

/** Compile-time check: `value` must satisfy T; returns it unchanged. */
function accepts<T>(value: T): T {
  return value
}

const ADR_ERROR_CODES = [
  'ASK_UNKNOWN_REQUEST',
  'ASK_ALREADY_ANSWERED',
  'ASK_NOT_ADDRESSEE',
  'ASK_TURN_ENDED',
  'ASK_DEADLINE_EXCEEDED',
  'ASK_CHANNEL_UNAVAILABLE',
  'ASK_INVALID_RESPONSE',
]

describe('ADR-0011 T1: frame names and error codes', () => {
  test('five ask frame names, point-separated like turn.*', () => {
    expect(Object.values(ASK_FRAME_TYPES)).toEqual([
      'ask.request',
      'ask.cancel',
      'ask.pending',
      'ask.settled',
      'ask.response',
    ])
  })

  test('exactly the seven ADR-0011 §5 error codes, no extras', () => {
    const codes = Object.values(ASK_ERROR_CODES)
    expect(codes).toHaveLength(7)
    expect([...codes].sort()).toEqual([...ADR_ERROR_CODES].sort())
    for (const code of ADR_ERROR_CODES) expect(isAskErrorCode(code)).toBe(true)
    expect(isAskErrorCode('APPROVAL_REJECTED')).toBe(false) // tool-layer, not protocol
    expect(isAskErrorCode('BAD_PARAMS')).toBe(false) // existing protocol, not ask-specific
  })
})

describe('validateAskRequest', () => {
  const valid = {
    eventId: 'turn-1:ask-1',
    sessionId: 's1',
    kind: 'approval',
    toolName: 'bash',
    questions: [
      {
        id: 'q1',
        prompt: 'Allow?',
        options: [{ label: 'Yes', description: 'once' }, { label: 'No' }],
        multiSelect: false,
      },
    ],
    deadlineAt: 1234,
    detachGraceMs: 100,
    escalation: true,
  }

  test('accepts the full source-verified shape', () => {
    const result = validateAskRequest(valid)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.eventId).toBe('turn-1:ask-1')
    expect(result.value.questions?.[0].options).toHaveLength(2)
    expect(result.value.escalation).toBe(true)
  })

  test('F1-A1: child-session identity fields are optional and round-trip', () => {
    const base = validateAskRequest({ eventId: 't:ask-1', sessionId: 'parent', kind: 'approval' })
    expect(base.ok).toBe(true)
    if (base.ok) {
      expect(base.value.childSessionId).toBeUndefined()
      expect(base.value.parentSessionId).toBeUndefined()
    }
    const child = validateAskRequest({
      eventId: 't:ask-2', sessionId: 'parent', kind: 'approval',
      childSessionId: 'child-1', parentSessionId: 'parent',
    })
    expect(child.ok).toBe(true)
    if (child.ok) {
      expect(child.value.childSessionId).toBe('child-1')
      expect(child.value.parentSessionId).toBe('parent')
    }
    // Bad shapes are rejected with BAD_PARAMS (same as every other field).
    expect(validateAskRequest({ ...valid, childSessionId: '' }).ok).toBe(false)
    expect(validateAskRequest({ ...valid, parentSessionId: 42 }).ok).toBe(false)
  })

  test('rejects missing eventId, bad kind, and empty options (BAD_PARAMS)', () => {
    expect(validateAskRequest({ ...valid, eventId: '' }).ok).toBe(false)
    expect(validateAskRequest({ ...valid, kind: 'unknown' }).ok).toBe(false)
    const bad = validateAskRequest({ ...valid, questions: [{ id: 'q', prompt: 'p', options: [] }] })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.code).toBe('BAD_PARAMS')
  })
})

describe('validateAskCancel / AskSettled / AskPending', () => {
  test('cancel accepts only the four ADR reasons', () => {
    for (const reason of ['host-abort', 'superseded', 'deadline', 'no-provider']) {
      expect(validateAskCancel({ eventId: 't:ask-1', reason }).ok).toBe(true)
    }
    expect(validateAskCancel({ eventId: 't:ask-1', reason: 'detach' }).ok).toBe(false)
  })

  test('settled accepts only the four outcomes', () => {
    for (const outcome of ['approved', 'denied', 'cancelled', 'unavailable']) {
      expect(validateAskSettled({ eventId: 't:ask-1', outcome }).ok).toBe(true)
    }
    expect(validateAskSettled({ eventId: 't:ask-1', outcome: 'approved-x' }).ok).toBe(false)
  })

  test('pending snapshot validates nested ask.request payloads', () => {
    const result = validateAskPending({
      sessionId: 's1',
      asks: [{ eventId: 't:ask-1', sessionId: 's1', kind: 'questions' }],
    })
    expect(result.ok).toBe(true)
    expect(validateAskPending({ sessionId: 's1', asks: 'nope' }).ok).toBe(false)
  })
})

describe('ask.settled reason — closed set, legacy tolerance, field pass-through', () => {
  const EXPECTED_REASONS = [
    'answered', 'rejected', 'unavailable', 'timeout', 'aborted',
    'turn-ended', 'session-closed', 'detached', 'connection-closed',
    'no-channel', 'auto-approved',
  ]

  test('exact closed set of eleven settle reasons', () => {
    expect([...SETTLE_REASONS].sort()).toEqual([...EXPECTED_REASONS].sort())
    for (const reason of EXPECTED_REASONS) expect(isAskSettleReason(reason)).toBe(true)
    // Legacy fallback / ask.cancel vocabulary values must not leak into the set.
    for (const reason of ['ended', 'unrecorded', 'host-abort', 'superseded', 'approved']) {
      expect(isAskSettleReason(reason)).toBe(false)
    }
  })

  test('legacy frame without reason is NOT rejected (no BAD_PARAMS, no dropped frame)', () => {
    const result = validateAskSettled({ eventId: 't:ask-1', outcome: 'approved' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.reason).toBeUndefined()

    // Same through the generic event dispatcher.
    const dispatched = validateAskEvent('ask.settled', { eventId: 't:ask-1', outcome: 'denied' })
    expect(dispatched.ok).toBe(true)
  })

  test('all new fields are validated and passed through; no code field is invented', () => {
    const raw = {
      eventId: 't:ask-2', outcome: 'cancelled', reason: 'timeout',
      sessionId: 'parent', kind: 'questions', toolName: 'AskUserQuestion',
      callId: 'call-9', childSessionId: 'child-1', code: 'ASK_DEADLINE_EXCEEDED',
    }
    const result = validateAskSettled(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      eventId: 't:ask-2', outcome: 'cancelled', reason: 'timeout',
      sessionId: 'parent', kind: 'questions', toolName: 'AskUserQuestion',
      callId: 'call-9', childSessionId: 'child-1',
    })
    expect('code' in result.value).toBe(false)
  })

  test('illegal reason is rejected with BAD_PARAMS; malformed optional fields too', () => {
    for (const reason of ['ended', 'unrecorded', 'host-abort', 'approved', '']) {
      const bad = validateAskSettled({ eventId: 't:ask-1', outcome: 'approved', reason })
      expect(bad.ok).toBe(false)
      if (!bad.ok) expect(bad.code).toBe('BAD_PARAMS')
    }
    expect(validateAskSettled({ eventId: 't:ask-1', outcome: 'approved', kind: 'nope' }).ok).toBe(false)
    expect(validateAskSettled({ eventId: 't:ask-1', outcome: 'approved', childSessionId: 42 }).ok).toBe(false)
  })

  test('TYPE: production payload requires reason; consumed payload does not', () => {
    accepts<AskSettledPayload>({
      eventId: 't:ask-1', outcome: 'approved', reason: 'answered',
      sessionId: 's1', kind: 'approval', childSessionId: 'child-1',
    })
    accepts<AskSettledPayloadRead>({ eventId: 't:ask-1', outcome: 'approved' })

    // @ts-expect-error production outbound settled payload requires reason
    const missingReason: AskSettledPayload = { eventId: 't:ask-1', outcome: 'approved' }
    expect(missingReason.eventId).toBe('t:ask-1')

    // @ts-expect-error 'ended' is a coarse legacy fallback, not a closed reason
    const badReason: AskSettleReason = 'ended'
    expect(badReason).toBe('ended')

    // @ts-expect-error AskSettledPayload has no code? field
    const withCode: AskSettledPayload = {
      eventId: 't:ask-1', outcome: 'cancelled', reason: 'timeout',
      code: 'ASK_DEADLINE_EXCEEDED',
    }
    expect(withCode.eventId).toBe('t:ask-1')
  })
})

describe('validateAskResponse', () => {
  test('accepts verdict and answers vocabulary', () => {
    expect(validateAskResponse({ eventId: 't:ask-1', kind: 'approval', verdict: 'allowed-once' }).ok).toBe(true)
    const answered = validateAskResponse({
      eventId: 't:ask-1',
      kind: 'questions',
      answers: [{ id: 'q1', selected: ['Yes'] }],
      behavior: 'once',
    })
    expect(answered.ok).toBe(true)
  })

  test('rejects unknown verdict and illegal fields with ASK_INVALID_RESPONSE', () => {
    const unknown = validateAskResponse({ eventId: 't:ask-1', kind: 'approval', verdict: 'approved' })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.code).toBe(ASK_ERROR_CODES.INVALID_RESPONSE)

    // PENDING-CONFIRMATION (Q3): no escalation => behavior:'always' is illegal.
    const always = validateAskResponse({ eventId: 't:ask-1', kind: 'approval', verdict: 'allowed-once', behavior: 'always' })
    expect(always.ok).toBe(false)
  })

  test('validateAskEvent dispatches by type and rejects ask.response', () => {
    expect(validateAskEvent('ask.cancel', { eventId: 't:ask-1', reason: 'deadline' }).ok).toBe(true)
    expect(validateAskEvent('ask.response', { eventId: 't:ask-1', kind: 'approval' }).ok).toBe(false)
  })
})
