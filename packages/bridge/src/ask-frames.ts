/**
 * ADR-0011 T1 — Ask / permission bridge channel: wire types, error codes and
 * runtime validators (host side).
 *
 * This module is a pure shape/schema layer. It does NOT touch dispatch, seam,
 * UI, or stdio: `apply()` in index.ts keeps owning the request dispatch, and
 * T3 will wire `ask.response` through the existing `parseRequest`/`replyError`
 * path. Nothing here imports a host package; every shape is transcribed from
 * the source-verified ADR-0011 §3 (which itself was checked against
 * `packages/tui-base/src/seams/session.ts` and
 * `packages/shell/src/client/remote-waterfall.ts`).
 *
 * Validation follows the bridge's existing style (`parseRequest` in index.ts):
 * a parser returns a discriminated `{ok:true,value} | {ok:false,code,message}`
 * result carrying a flat SCREAMING_SNAKE_CASE protocol code. Event payload
 * malformations use the pre-existing `BAD_PARAMS` code; a malformed
 * `ask.response` uses the ask-specific `ASK_INVALID_RESPONSE` (ADR-0011 §5).
 */

// ---------------------------------------------------------------------------
// Frame names (ADR-0011 D3) — the five `ask.*` point-separated event names.
// ---------------------------------------------------------------------------
export const ASK_FRAME_TYPES = {
  REQUEST: 'ask.request',
  CANCEL: 'ask.cancel',
  PENDING: 'ask.pending',
  SETTLED: 'ask.settled',
  RESPONSE: 'ask.response',
} as const
export type AskFrameType = (typeof ASK_FRAME_TYPES)[keyof typeof ASK_FRAME_TYPES]

/** Downstream frames (host → client) — the `event{type,payload}` shape. */
export type AskEventType = Exclude<AskFrameType, 'ask.response'>

// ---------------------------------------------------------------------------
// ADR-0011 §5 — the seven ask error codes. Flat `ASK_` namespace (no module
// prefix beyond the semantic first word), matching SESSION_/TURN_/JOURNAL_.
// ---------------------------------------------------------------------------
export const ASK_ERROR_CODES = {
  /** eventId not in the registry (never issued or already evicted). */
  UNKNOWN_REQUEST: 'ASK_UNKNOWN_REQUEST',
  /** Second answer to a settled eventId — first-wins, state unchanged. */
  ALREADY_ANSWERED: 'ASK_ALREADY_ANSWERED',
  /** deliveredTo !== sessionId — cross-session frame, do not settle. */
  NOT_ADDRESSEE: 'ASK_NOT_ADDRESSEE',
  /** Late answer whose turn is terminal / session closed-replaced. */
  TURN_ENDED: 'ASK_TURN_ENDED',
  /** deadlineAt (or askDeadlineMs / maxAskWaitMs) wall-clock cap exceeded. */
  DEADLINE_EXCEEDED: 'ASK_DEADLINE_EXCEEDED',
  /** No approval/userQuestions service or no provider — settle unavailable. */
  CHANNEL_UNAVAILABLE: 'ASK_CHANNEL_UNAVAILABLE',
  /** Illegal answer fields (e.g. behavior:'always' without escalation). */
  INVALID_RESPONSE: 'ASK_INVALID_RESPONSE',
} as const
export type AskErrorCode = (typeof ASK_ERROR_CODES)[keyof typeof ASK_ERROR_CODES]

const ASK_ERROR_CODE_SET: ReadonlySet<string> = new Set(Object.values(ASK_ERROR_CODES))
export function isAskErrorCode(value: unknown): value is AskErrorCode {
  return typeof value === 'string' && ASK_ERROR_CODE_SET.has(value)
}

// ---------------------------------------------------------------------------
// Vocabulary lifted from the verified source signatures.
// ---------------------------------------------------------------------------
export type AskKind = 'approval' | 'questions'
export type AskOutcome = 'approved' | 'denied' | 'cancelled' | 'unavailable'
/** remote-waterfall.ts:42 `RemoteApprovalVerdict` — the real verdict words. */
export type AskVerdict = 'allowed-once' | 'rejected' | 'unavailable'
export type AskBehavior = 'once' | 'always' | 'session'
/** ask.cancel reasons (ADR-0011 §3.2). Separate vocabulary — never reuse as
 *  the settled reason (research §7.1). */
export type AskCancelReason = 'host-abort' | 'superseded' | 'deadline' | 'no-provider'

/** Closed terminal-reason vocabulary shared by `ask.settled.reason` and the
 *  terminal journal's `settleReason` (research §7.1 / §8.7). The coarse legacy
 *  fallback values `ended` / `unrecorded` are deliberately NOT members.
 *  `auto-approved` is exhaustively representable but invisible (A19). */
export type AskSettleReason =
  | 'answered'
  | 'rejected'
  | 'unavailable'
  | 'timeout'
  | 'aborted'
  | 'turn-ended'
  | 'session-closed'
  | 'detached'
  | 'connection-closed'
  | 'no-channel'
  | 'auto-approved'

/** Runtime mirror of `AskSettleReason`, for validators that must reject values
 *  outside the closed set. */
export const SETTLE_REASONS: readonly AskSettleReason[] = [
  'answered',
  'rejected',
  'unavailable',
  'timeout',
  'aborted',
  'turn-ended',
  'session-closed',
  'detached',
  'connection-closed',
  'no-channel',
  'auto-approved',
]
export function isAskSettleReason(value: unknown): value is AskSettleReason {
  return typeof value === 'string' && (SETTLE_REASONS as readonly string[]).includes(value)
}

export interface AskOption {
  label: string
  description?: string
}

/** ADR-0011 §3.2 / seams/session.ts:233 `SeamAskQuestion`. */
export interface AskQuestion {
  id: string
  prompt: string
  header?: string
  description?: string
  detail?: string
  options: AskOption[]
  multiSelect?: boolean
}

/** remote-waterfall.ts:206 `answersValue` — `{id, selected[], custom?}`. */
export interface AskAnswer {
  id: string
  selected: string[]
  custom?: string
}

export interface AskRequestPayload {
  /** `${turnId}:ask-${seq}`, turn-scoped monotonic — the lifecycle key. */
  eventId: string
  /** Delivery addressee. For a subagent ask this stays the PARENT session id:
   *  `ask.response` from the client is answered against the bound session, and
   *  grants / clearSession are keyed on it. Do not change to the child id. */
  sessionId: string
  kind: AskKind
  toolName?: string
  callId?: string
  reason?: string
  questions?: AskQuestion[]
  deadlineAt?: number
  detachGraceMs?: number
  escalation?: boolean
  /** F1-A1: present only when the ask originated from a subagent tool call.
   *  The requesting child session id (from the catalog-driven target table) —
   *  the TUI uses it to distinguish a child card from a parent card. */
  childSessionId?: string
  /** F1-A1: present only on a child ask. Parent session whose ask channel
   *  carries this ask; equals `sessionId`. Lets the TUI mount the child card
   *  under the parent trajectory without a duplicate parent card. */
  parentSessionId?: string
}

export interface AskCancelPayload {
  eventId: string
  reason: AskCancelReason
}

export interface AskPendingPayload {
  sessionId: string
  /** Reconnect snapshot: the still-pending ask.request payloads. */
  asks: AskRequestPayload[]
}

export interface AskSettledPayload {
  eventId: string
  outcome: AskOutcome
  /** Mandatory on production outbound frames. Kept as a closed enum, never a
   *  free-text field, and never populated from `ask.cancel.reason`. */
  reason: AskSettleReason
  /** Optional correlation fields carried through the frame/replay path. */
  sessionId?: string
  kind?: AskKind
  toolName?: string
  callId?: string
  childSessionId?: string
}

/** Consumption shape. Frames written before `reason` existed must stay valid
 *  (research §7.1: missing reason is not rejected, no BAD_PARAMS), so the read
 *  side makes `reason` optional while the outbound type above stays strict. */
export type AskSettledPayloadRead = Omit<AskSettledPayload, 'reason'> & {
  reason?: AskSettleReason
}

/** `params` of the `ask.response` request frame (client → host). */
export interface AskResponseParams {
  eventId: string
  kind: AskKind
  verdict?: AskVerdict
  answers?: AskAnswer[]
  behavior?: AskBehavior
  escalation?: boolean
}

/** Typed outbound frames for the registry's injected sink (T3 will forward to
 *  `emitEvent`). Kept here so the skeleton needs no dispatch dependency. */
export type AskOutboundFrame =
  | { type: 'ask.request'; payload: AskRequestPayload }
  | { type: 'ask.cancel'; payload: AskCancelPayload }
  | { type: 'ask.pending'; payload: AskPendingPayload }
  | { type: 'ask.settled'; payload: AskSettledPayload }

// ---------------------------------------------------------------------------
// Validation primitives (mirror parseRequest's "throw/return a code" style).
// ---------------------------------------------------------------------------
export type ParseOk<T> = { ok: true; value: T }
export type ParseErr = { ok: false; code: string; message: string }
export type ParseResult<T> = ParseOk<T> | ParseErr

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function bad(code: string, message: string): ParseErr {
  return { ok: false, code, message }
}

function nonEmptyString(value: unknown, field: string, code: string): ParseErr | string {
  if (typeof value !== 'string' || value === '') return bad(code, `${field} must be a non-empty string`)
  return value
}

function optionalString(value: unknown, field: string, code: string): ParseErr | string | undefined {
  if (value === undefined) return undefined
  return nonEmptyString(value, field, code)
}

function optionalFiniteNumber(value: unknown, field: string, code: string): ParseErr | number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) return bad(code, `${field} must be a finite number`)
  return value
}

function optionalBoolean(value: unknown, field: string, code: string): ParseErr | boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') return bad(code, `${field} must be a boolean`)
  return value
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string, code: string): ParseErr | T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return bad(code, `${field} must be one of ${allowed.join('|')}`)
  }
  return value as T
}

const KINDS: readonly AskKind[] = ['approval', 'questions']
const OUTCOMES: readonly AskOutcome[] = ['approved', 'denied', 'cancelled', 'unavailable']
const VERDICTS: readonly AskVerdict[] = ['allowed-once', 'rejected', 'unavailable']
const BEHAVIORS: readonly AskBehavior[] = ['once', 'always', 'session']
const CANCEL_REASONS: readonly AskCancelReason[] = ['host-abort', 'superseded', 'deadline', 'no-provider']

function validateOption(value: unknown, code: string): ParseResult<AskOption> {
  if (!isRecord(value)) return bad(code, 'question option must be an object')
  const label = nonEmptyString(value.label, 'option.label', code)
  if (typeof label !== 'string') return label
  const description = optionalString(value.description, 'option.description', code)
  if (typeof description === 'object') return description
  return { ok: true, value: { label, ...(description !== undefined ? { description } : {}) } }
}

function validateQuestion(value: unknown, code: string): ParseResult<AskQuestion> {
  if (!isRecord(value)) return bad(code, 'question must be an object')
  const id = nonEmptyString(value.id, 'question.id', code)
  if (typeof id !== 'string') return id
  const prompt = nonEmptyString(value.prompt, 'question.prompt', code)
  if (typeof prompt !== 'string') return prompt
  if (!Array.isArray(value.options) || value.options.length === 0) {
    return bad(code, 'question.options must be a non-empty array')
  }
  const options: AskOption[] = []
  for (const raw of value.options) {
    const parsed = validateOption(raw, code)
    if (!parsed.ok) return parsed
    options.push(parsed.value)
  }
  const header = optionalString(value.header, 'question.header', code)
  if (typeof header === 'object') return header
  const description = optionalString(value.description, 'question.description', code)
  if (typeof description === 'object') return description
  const detail = optionalString(value.detail, 'question.detail', code)
  if (typeof detail === 'object') return detail
  const multiSelect = optionalBoolean(value.multiSelect, 'question.multiSelect', code)
  if (typeof multiSelect === 'object') return multiSelect
  return {
    ok: true,
    value: {
      id,
      prompt,
      options,
      ...(header !== undefined ? { header } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(detail !== undefined ? { detail } : {}),
      ...(multiSelect !== undefined ? { multiSelect } : {}),
    },
  }
}

function validateAnswer(value: unknown): ParseResult<AskAnswer> {
  const code = ASK_ERROR_CODES.INVALID_RESPONSE
  if (!isRecord(value)) return bad(code, 'answer must be an object')
  const id = nonEmptyString(value.id, 'answer.id', code)
  if (typeof id !== 'string') return id
  if (!Array.isArray(value.selected) || value.selected.some((s) => typeof s !== 'string')) {
    return bad(code, 'answer.selected must be an array of strings')
  }
  const custom = optionalString(value.custom, 'answer.custom', code)
  if (typeof custom === 'object') return custom
  return { ok: true, value: { id, selected: value.selected as string[], ...(custom !== undefined ? { custom } : {}) } }
}

/** Validate an `ask.request` event payload. */
export function validateAskRequest(value: unknown): ParseResult<AskRequestPayload> {
  const code = 'BAD_PARAMS'
  if (!isRecord(value)) return bad(code, 'ask.request payload must be an object')
  const eventId = nonEmptyString(value.eventId, 'eventId', code)
  if (typeof eventId !== 'string') return eventId
  const sessionId = nonEmptyString(value.sessionId, 'sessionId', code)
  if (typeof sessionId !== 'string') return sessionId
  const kind = oneOf(value.kind, KINDS, 'kind', code)
  if (typeof kind !== 'string') return kind

  const toolName = optionalString(value.toolName, 'toolName', code)
  if (typeof toolName === 'object') return toolName
  const callId = optionalString(value.callId, 'callId', code)
  if (typeof callId === 'object') return callId
  const reason = optionalString(value.reason, 'reason', code)
  if (typeof reason === 'object') return reason
  const deadlineAt = optionalFiniteNumber(value.deadlineAt, 'deadlineAt', code)
  if (typeof deadlineAt === 'object') return deadlineAt
  const detachGraceMs = optionalFiniteNumber(value.detachGraceMs, 'detachGraceMs', code)
  if (typeof detachGraceMs === 'object') return detachGraceMs
  if (typeof detachGraceMs === 'number' && detachGraceMs < 0) return bad(code, 'detachGraceMs must be >= 0')
  const escalation = optionalBoolean(value.escalation, 'escalation', code)
  if (typeof escalation === 'object') return escalation
  const childSessionId = optionalString(value.childSessionId, 'childSessionId', code)
  if (typeof childSessionId === 'object') return childSessionId
  const parentSessionId = optionalString(value.parentSessionId, 'parentSessionId', code)
  if (typeof parentSessionId === 'object') return parentSessionId

  let questions: AskQuestion[] | undefined
  if (value.questions !== undefined) {
    if (!Array.isArray(value.questions)) return bad(code, 'questions must be an array')
    questions = []
    for (const raw of value.questions) {
      const parsed = validateQuestion(raw, code)
      if (!parsed.ok) return parsed
      questions.push(parsed.value)
    }
  }

  return {
    ok: true,
    value: {
      eventId,
      sessionId,
      kind,
      ...(toolName !== undefined ? { toolName } : {}),
      ...(callId !== undefined ? { callId } : {}),
      ...(reason !== undefined ? { reason } : {}),
      ...(questions !== undefined ? { questions } : {}),
      ...(deadlineAt !== undefined ? { deadlineAt } : {}),
      ...(detachGraceMs !== undefined ? { detachGraceMs } : {}),
      ...(escalation !== undefined ? { escalation } : {}),
      ...(childSessionId !== undefined ? { childSessionId } : {}),
      ...(parentSessionId !== undefined ? { parentSessionId } : {}),
    },
  }
}

/** Validate an `ask.cancel` event payload. */
export function validateAskCancel(value: unknown): ParseResult<AskCancelPayload> {
  const code = 'BAD_PARAMS'
  if (!isRecord(value)) return bad(code, 'ask.cancel payload must be an object')
  const eventId = nonEmptyString(value.eventId, 'eventId', code)
  if (typeof eventId !== 'string') return eventId
  const reason = oneOf(value.reason, CANCEL_REASONS, 'reason', code)
  if (typeof reason !== 'string') return reason
  return { ok: true, value: { eventId, reason } }
}

/** Validate an `ask.pending` reconnect-snapshot payload. */
export function validateAskPending(value: unknown): ParseResult<AskPendingPayload> {
  const code = 'BAD_PARAMS'
  if (!isRecord(value)) return bad(code, 'ask.pending payload must be an object')
  const sessionId = nonEmptyString(value.sessionId, 'sessionId', code)
  if (typeof sessionId !== 'string') return sessionId
  if (!Array.isArray(value.asks)) return bad(code, 'asks must be an array')
  const asks: AskRequestPayload[] = []
  for (const raw of value.asks) {
    const parsed = validateAskRequest(raw)
    if (!parsed.ok) return parsed
    asks.push(parsed.value)
  }
  return { ok: true, value: { sessionId, asks } }
}

/** Validate an `ask.settled` broadcast payload.
 *
 * Legacy frames without `reason` stay valid — the consumer handles them via
 * the §7.3 fallback table. A `reason` that IS present must be in the closed
 * set; unknown values are rejected rather than silently forwarded. New
 * correlation fields are validated and passed through when present. No `code`
 * field exists on this payload (protocol codes only live on the journal). */
export function validateAskSettled(value: unknown): ParseResult<AskSettledPayloadRead> {
  const code = 'BAD_PARAMS'
  if (!isRecord(value)) return bad(code, 'ask.settled payload must be an object')
  const eventId = nonEmptyString(value.eventId, 'eventId', code)
  if (typeof eventId !== 'string') return eventId
  const outcome = oneOf(value.outcome, OUTCOMES, 'outcome', code)
  if (typeof outcome !== 'string') return outcome

  let reason: AskSettleReason | undefined
  if (value.reason !== undefined) {
    const parsed = oneOf(value.reason, SETTLE_REASONS, 'reason', code)
    if (typeof parsed !== 'string') return parsed
    reason = parsed
  }
  const sessionId = optionalString(value.sessionId, 'sessionId', code)
  if (typeof sessionId === 'object') return sessionId
  let kind: AskKind | undefined
  if (value.kind !== undefined) {
    const parsed = oneOf(value.kind, KINDS, 'kind', code)
    if (typeof parsed !== 'string') return parsed
    kind = parsed
  }
  const toolName = optionalString(value.toolName, 'toolName', code)
  if (typeof toolName === 'object') return toolName
  const callId = optionalString(value.callId, 'callId', code)
  if (typeof callId === 'object') return callId
  const childSessionId = optionalString(value.childSessionId, 'childSessionId', code)
  if (typeof childSessionId === 'object') return childSessionId

  return {
    ok: true,
    value: {
      eventId,
      outcome,
      ...(reason !== undefined ? { reason } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(toolName !== undefined ? { toolName } : {}),
      ...(callId !== undefined ? { callId } : {}),
      ...(childSessionId !== undefined ? { childSessionId } : {}),
    },
  }
}

/**
 * Validate `ask.response` params (the only client → host ask frame).
 *
 * PENDING-CONFIRMATION (ADR-0011 §8 Q3, recommended value): `behavior:'always'`
 * without `escalation:true` is rejected as ASK_INVALID_RESPONSE. The session
 * scope of `always` is not yet user-confirmed; the recommended value (session
 * summary surviving compaction) is what the registry will carry.
 */
export function validateAskResponse(value: unknown): ParseResult<AskResponseParams> {
  const code = ASK_ERROR_CODES.INVALID_RESPONSE
  if (!isRecord(value)) return bad(code, 'ask.response params must be an object')
  const eventId = nonEmptyString(value.eventId, 'eventId', code)
  if (typeof eventId !== 'string') return eventId
  const kind = oneOf(value.kind, KINDS, 'kind', code)
  if (typeof kind !== 'string') return kind

  let verdict: AskVerdict | undefined
  if (value.verdict !== undefined) {
    const parsed = oneOf(value.verdict, VERDICTS, 'verdict', code)
    if (typeof parsed !== 'string') return parsed
    verdict = parsed
  }
  let answers: AskAnswer[] | undefined
  if (value.answers !== undefined) {
    if (!Array.isArray(value.answers)) return bad(code, 'answers must be an array')
    answers = []
    for (const raw of value.answers) {
      const parsed = validateAnswer(raw)
      if (!parsed.ok) return parsed
      answers.push(parsed.value)
    }
  }
  let behavior: AskBehavior | undefined
  if (value.behavior !== undefined) {
    const parsed = oneOf(value.behavior, BEHAVIORS, 'behavior', code)
    if (typeof parsed !== 'string') return parsed
    behavior = parsed
  }
  const escalation = optionalBoolean(value.escalation, 'escalation', code)
  if (typeof escalation === 'object') return escalation

  if (behavior === 'always' && escalation !== true) {
    return bad(code, 'behavior:"always" requires escalation:true')
  }
  if (verdict === undefined && (answers === undefined || answers.length === 0)) {
    return bad(code, 'ask.response requires a verdict or a non-empty answers array')
  }

  return {
    ok: true,
    value: {
      eventId,
      kind,
      ...(verdict !== undefined ? { verdict } : {}),
      ...(answers !== undefined ? { answers } : {}),
      ...(behavior !== undefined ? { behavior } : {}),
      ...(escalation !== undefined ? { escalation } : {}),
    },
  }
}

/** Dispatch an event payload by its `ask.*` type; unknown types are rejected
 *  with BAD_PARAMS. `ask.response` is a request, not an event — use
 *  `validateAskResponse` for it. */
export function validateAskEvent(
  type: string,
  payload: unknown,
): ParseResult<AskRequestPayload | AskCancelPayload | AskPendingPayload | AskSettledPayloadRead> {
  switch (type) {
    case ASK_FRAME_TYPES.REQUEST:
      return validateAskRequest(payload)
    case ASK_FRAME_TYPES.CANCEL:
      return validateAskCancel(payload)
    case ASK_FRAME_TYPES.PENDING:
      return validateAskPending(payload)
    case ASK_FRAME_TYPES.SETTLED:
      return validateAskSettled(payload)
    default:
      return bad('BAD_PARAMS', `unsupported ask event type: ${type}`)
  }
}
