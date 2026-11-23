/**
 * ADR-0011 T2 — `AskRegistry`: host-side ask lifecycle state machine.
 *
 * Scope (deliberately narrow): this owns the pending table, `eventId`
 * generation, first-wins settlement, the three wall clocks, and the
 * turn/session teardown hooks. It does NOT wire dispatch, `ctx.get('approval')`,
 * the seam, or any UI — T3+ own those. Frames leave through an injected `sink`
 * whose type is `AskOutboundFrame`; the next task forwards it to `emitEvent`.
 *
 * Association key is `eventId` (`${turnId}:ask-${seq}`, turn-scoped monotonic);
 * the bridge request id (`id`) stays a separate request/response pairing key.
 * The addressee gate is `deliveredTo === sessionId`, mirroring the host
 * waterfall's `claims()` (`frame.agentId === sessionId`).
 *
 * PENDING-CONFIRMATION markers below point at ADR-0011 §8 assumptions whose
 * recommended values are implemented here but not yet user-confirmed.
 */
import {
  ASK_ERROR_CODES,
  ASK_FRAME_TYPES,
  validateAskResponse,
  type AskCancelReason,
  type AskKind,
  type AskOutcome,
  type AskOutboundFrame,
  type AskRequestPayload,
  type AskResponseParams,
  type AskErrorCode,
  type AskVerdict,
  type AskBehavior,
} from './ask-frames'
import {
  ASK_JOURNAL_KINDS,
  SessionPermissionSummary,
  redactIdentifier,
  summarizeAnswers,
  type AskJournalEvent,
  type AskJournalSink,
  type AskJournalSource,
} from './ask-journal'
import { WRITE_TOOL_POLICY } from './approval-gate'

type TimerHandle = ReturnType<typeof setTimeout>

export interface AskRegistryLogger {
  debug?(format: unknown, ...params: unknown[]): void
  warn?(format: unknown, ...params: unknown[]): void
}

export interface AskRegistryOptions {
  /** Per-ask wall clock from creation. `null` = no deadline timer (default).
   *  PENDING-CONFIRMATION: ADR-0011 §8 Q1 recommended default. */
  askDeadlineMs?: number | null
  /** Window kept after a client detach before an unanswered ask is cancelled.
   *  PENDING-CONFIRMATION: ADR-0011 §8 Q1 recommended default 30000. */
  detachGraceMs?: number
  /** Absolute hard cap from creation regardless of deadlineAt.
   *  PENDING-CONFIRMATION: ADR-0011 §8 Q1 recommended default 3600000. */
  maxAskWaitMs?: number
  /** Injectable clock so tests never depend on wall time. */
  now?: () => number
  /** Frame sink; defaults to a no-op. T3 forwards this to `emitEvent`. */
  sink?: (frame: AskOutboundFrame) => void
  /** ADR-0011 T7: redacted decision journal. Defaults to a no-op; tests inject
   *  a fake, index.ts injects the host `plugin:` record writer. The registry
   *  calls it with an already-redacted event (no tool args / prompts / custom
   *  text ever reach this sink). */
  journal?: AskJournalSink
  /** Bound for the settled/ended eventId memory (prevents unbounded growth). */
  recordLimit?: number
  logger?: AskRegistryLogger
}

export interface AskSettlement {
  eventId: string
  outcome: AskOutcome
  code?: AskErrorCode
  message?: string
  at: number
}

export type AnswerResult =
  | { ok: true; settlement: AskSettlement }
  | { ok: false; code: AskErrorCode; message: string }

export interface FailClosedInput {
  turnId: string
  sessionId: string
  kind: AskKind
  reason?: string
}

interface PendingAsk {
  request: AskRequestPayload
  turnId: string
  createdAt: number
  /** The session the request was actually delivered to (claims gate). */
  deliveredTo: string
  graceMs: number
  deadlineTimer?: TimerHandle
  graceTimer?: TimerHandle
  hardCapTimer?: TimerHandle
}

interface SettleOptions {
  code?: AskErrorCode
  message?: string
  /** When set, an `ask.cancel` frame is emitted before `ask.settled`. */
  cancelReason?: AskCancelReason
  /** Turn/session teardown records the id as "ended" (→ ASK_TURN_ENDED). */
  ended?: boolean
  /** T7: journal-only decision digest (verdict / behavior / numeric answers).
   *  Never includes `answers[].custom`, prompts, reasons or tool arguments. */
  verdict?: AskVerdict
  behavior?: AskBehavior
  answers?: AskResponseParams['answers']
  /** T7: how this decision was produced (audit field). */
  source?: AskJournalSource
}

const DEFAULT_RECORD_LIMIT = 256

/** Absolute hard cap default (1h). Exported so the bridge's profile-patch
 *  askDeadlineMs validation clamps to the SAME value this registry enforces. */
export const DEFAULT_MAX_ASK_WAIT_MS = 3_600_000

/** Bounded insertion-ordered id memory (Set removes oldest first). */
function remember(ids: Set<string>, id: string, limit: number): void {
  ids.add(id)
  while (ids.size > limit) {
    const oldest = ids.values().next().value
    if (oldest === undefined) break
    ids.delete(oldest)
  }
}

/** Split `${turnId}:ask-${seq}` back into its turn id. */
export function turnIdOf(eventId: string): string {
  const i = eventId.lastIndexOf(':ask-')
  return i === -1 ? eventId : eventId.slice(0, i)
}

export class AskRegistry {
  readonly #askDeadlineMs: number | null
  readonly #detachGraceMs: number
  readonly #maxAskWaitMs: number
  readonly #recordLimit: number
  readonly #now: () => number
  readonly #sink: (frame: AskOutboundFrame) => void
  readonly #journal: AskJournalSink
  readonly #logger?: AskRegistryLogger

  /** eventId -> pending ask. A single ask never appears twice (first-wins). */
  readonly #pending = new Map<string, PendingAsk>()
  /** Monotonic per-turn sequence for eventId generation. */
  readonly #seqByTurn = new Map<string, number>()
  /** Settled by a normal answer/timeout (→ ASK_ALREADY_ANSWERED on retry). */
  readonly #settledIds = new Set<string>()
  /** Settled by turn/session teardown (→ ASK_TURN_ENDED on retry, D5). */
  readonly #endedIds = new Set<string>()
  /** Append-only settlement log for tests/audit (bounded). */
  readonly #settlementLog: AskSettlement[] = []
  /** `behavior:'always'` grants, scoped to a session (ADR-0011 D7). Not derived
   *  from journal events, so compaction can never clear the effect (A4). */
  readonly #summary = new SessionPermissionSummary()
  /** Every armed timer, so `dispose()` can release all of them. */
  readonly #timers = new Set<TimerHandle>()

  constructor(options: AskRegistryOptions = {}) {
    this.#askDeadlineMs = options.askDeadlineMs === undefined ? null : options.askDeadlineMs
    this.#detachGraceMs = options.detachGraceMs ?? 30_000
    this.#maxAskWaitMs = options.maxAskWaitMs ?? DEFAULT_MAX_ASK_WAIT_MS
    this.#recordLimit = options.recordLimit ?? DEFAULT_RECORD_LIMIT
    this.#now = options.now ?? Date.now
    this.#sink = options.sink ?? (() => {})
    this.#journal = options.journal ?? (() => {})
    this.#logger = options.logger
  }

  // ---- introspection -------------------------------------------------------
  timerCount(): number {
    return this.#timers.size
  }
  pendingCount(): number {
    return this.#pending.size
  }
  pendingIds(): string[] {
    return [...this.#pending.keys()]
  }
  settlements(): readonly AskSettlement[] {
    return this.#settlementLog
  }
  sessionGrants(sessionId: string): readonly string[] {
    return this.#summary.tools(sessionId)
  }

  /** ADR-0011 T7: true when this session already granted 'always' to this tool.
   *  The summary lives in this process, not in journal events, so compaction
   *  cannot clear it. index.ts consults this BEFORE pushing an ask card. */
  hasGrant(sessionId: string, toolName: string): boolean {
    return this.#summary.has(sessionId, toolName)
  }

  /** Scope guard (I1/A5): drop every grant of a session on close/replace. */
  clearSessionGrants(sessionId: string): void {
    this.#summary.clearSession(sessionId)
  }

  /** ADR-0011 D7 (respawn): load always-grants reconstructed from the durable
   *  journal of this session into the in-process summary. Additive/idempotent —
   *  repeated resume opens never double-count. Reconstruction itself is done
   *  by index.ts (the registry imports no host persistence). */
  restoreSessionGrants(sessionId: string, tools: readonly string[]): void {
    this.#summary.restoreGrants(sessionId, tools)
  }

  /**
   * Record a decision made from the session summary alone (index.ts short-circuits
   * a repeated 'always' tool without creating a pending ask / pushing a card).
   * A `responded` journal event keeps the audit trail complete; no state changes
   * because the grant was already in the summary.
   */
  recordSummaryDecision(turnId: string, input: {
    sessionId: string
    askKind: AskKind
    toolName?: string
  }): string {
    const eventId = this.nextEventId(turnId)
    this.#writeJournal({
      eventId,
      kind: ASK_JOURNAL_KINDS.RESPONDED,
      askKind: input.askKind,
      sessionId: redactIdentifier(input.sessionId) ?? input.sessionId,
      turnId: redactIdentifier(turnId) ?? turnId,
      ...(redactIdentifier(input.toolName) !== undefined ? { toolName: redactIdentifier(input.toolName) } : {}),
      verdict: 'allowed-once',
      outcome: 'approved',
      behavior: 'always',
      source: 'summary',
      at: this.#now(),
    })
    return eventId
  }

  // ---- journal side effects ------------------------------------------------
  /** Single funnel for every redacted journal write (T7). Never throws into a
   *  decision path: persistence is a side effect, not part of the verdict. */
  #writeJournal(event: AskJournalEvent): void {
    try {
      this.#journal(event)
    } catch (err) {
      this.#logger?.warn?.('[ask-registry] journal sink threw (decision unchanged): %s', err)
    }
  }

  // ---- id generation -------------------------------------------------------
  /** `${turnId}:ask-${seq}` — turn-scoped monotonic, never reused. */
  nextEventId(turnId: string): string {
    const next = (this.#seqByTurn.get(turnId) ?? 0) + 1
    this.#seqByTurn.set(turnId, next)
    return `${turnId}:ask-${next}`
  }

  // ---- timer plumbing ------------------------------------------------------
  #arm(fn: () => void, delayMs: number): TimerHandle {
    const handle = setTimeout(() => {
      this.#timers.delete(handle)
      fn()
    }, Math.max(0, delayMs))
    handle.unref?.()
    this.#timers.add(handle)
    return handle
  }

  #disarm(handle: TimerHandle | undefined): void {
    if (handle === undefined) return
    clearTimeout(handle)
    this.#timers.delete(handle)
  }

  // ---- frame sink ----------------------------------------------------------
  #emit(frame: AskOutboundFrame): void {
    this.#sink(frame)
  }

  // ---- create / register ---------------------------------------------------
  /**
   * Register a new pending ask and arm its timers. The `eventId` is generated
   * here (callers pass the turn id separately — the wire payload only carries
   * `eventId`, per ADR-0011 §3.2). Emits `ask.request` through the sink.
   */
  create(turnId: string, input: Omit<AskRequestPayload, 'eventId'>): AskRequestPayload {
    const eventId = this.nextEventId(turnId)
    const request: AskRequestPayload = { ...input, eventId }
    const createdAt = this.#now()
    const graceMs = input.detachGraceMs ?? this.#detachGraceMs
    const entry: PendingAsk = { request, turnId, createdAt, deliveredTo: input.sessionId, graceMs }
    this.#pending.set(eventId, entry)

    // Deadline: absolute `deadlineAt` wins; else askDeadlineMs from creation.
    // PENDING-CONFIRMATION (Q1): deadlineAt is a hard cap, not a polled field.
    const deadlineAt = request.deadlineAt ?? (this.#askDeadlineMs === null ? undefined : createdAt + this.#askDeadlineMs)
    if (deadlineAt !== undefined) {
      entry.deadlineTimer = this.#arm(() => {
        this.#settle(entry, this.#deadlineOutcome(entry.request.kind), {
          code: ASK_ERROR_CODES.DEADLINE_EXCEEDED,
          cancelReason: 'deadline',
          message: 'ask deadline exceeded',
          source: 'timeout',
        })
      }, deadlineAt - createdAt)
    }

    // Absolute hard cap — fail-closed to unavailable (D6).
    entry.hardCapTimer = this.#arm(() => {
      this.#settle(entry, 'unavailable', {
        code: ASK_ERROR_CODES.DEADLINE_EXCEEDED,
        cancelReason: 'deadline',
        message: 'maxAskWaitMs hard cap exceeded',
        source: 'timeout',
      })
    }, this.#maxAskWaitMs)

    // ADR-0011 T7 (A4): record the pending decision BEFORE it can settle. Only
    // allowlisted identifiers reach the log — `reason`, `questions`, `callId`
    // and every other free-form payload field are deliberately not copied.
    this.#writeJournal({
      eventId,
      kind: ASK_JOURNAL_KINDS.REQUESTED,
      askKind: request.kind,
      sessionId: redactIdentifier(request.sessionId) ?? request.sessionId,
      turnId: redactIdentifier(turnId) ?? turnId,
      ...(redactIdentifier(request.toolName) !== undefined ? { toolName: redactIdentifier(request.toolName) } : {}),
      source: 'request',
      at: createdAt,
    })
    this.#emit({ type: ASK_FRAME_TYPES.REQUEST, payload: request })
    return request
  }

  // ---- settlement core -----------------------------------------------------
  #deadlineOutcome(kind: AskKind): AskOutcome {
    // PENDING-CONFIRMATION (ADR-0011 §8 Q1, recommended value): permission
    // timeout settles denied; question timeout settles cancelled. Not yet
    // user-confirmed — §5's table also mentions `unavailable` for this path.
    return kind === 'approval' ? 'denied' : 'cancelled'
  }

  #settle(entry: PendingAsk, outcome: AskOutcome, options: SettleOptions = {}): AskSettlement {
    const eventId = entry.request.eventId
    this.#disarm(entry.deadlineTimer)
    this.#disarm(entry.graceTimer)
    this.#disarm(entry.hardCapTimer)
    entry.deadlineTimer = undefined
    entry.graceTimer = undefined
    entry.hardCapTimer = undefined
    this.#pending.delete(eventId)

    if (options.ended) remember(this.#endedIds, eventId, this.#recordLimit)
    else remember(this.#settledIds, eventId, this.#recordLimit)

    if (options.cancelReason !== undefined) {
      // PENDING-CONFIRMATION (Q2): detach/grace expiry has no dedicated reason
      // in the §3.2 vocabulary; 'host-abort' is the closest documented value.
      this.#emit({ type: ASK_FRAME_TYPES.CANCEL, payload: { eventId, reason: options.cancelReason } })
    }

    const settlement: AskSettlement = {
      eventId,
      outcome,
      ...(options.code !== undefined ? { code: options.code } : {}),
      ...(options.message !== undefined ? { message: options.message } : {}),
      at: this.#now(),
    }
    if (this.#settlementLog.length >= this.#recordLimit) this.#settlementLog.shift()
    this.#settlementLog.push(settlement)

    // ADR-0011 T7 (A4): one terminal journal event per settled ask. A cancelled
    // ask (teardown / detach / deadline-cancel) uses `ask.cancelled`; every
    // other outcome uses `ask.responded`. `source` is an enum, not a message.
    const cancelled = outcome === 'cancelled' || options.cancelReason !== undefined
    this.#writeJournal({
      eventId,
      kind: cancelled ? ASK_JOURNAL_KINDS.CANCELLED : ASK_JOURNAL_KINDS.RESPONDED,
      askKind: entry.request.kind,
      sessionId: redactIdentifier(entry.request.sessionId) ?? entry.request.sessionId,
      turnId: redactIdentifier(entry.turnId) ?? entry.turnId,
      ...(redactIdentifier(entry.request.toolName) !== undefined ? { toolName: redactIdentifier(entry.request.toolName) } : {}),
      ...(options.verdict !== undefined ? { verdict: options.verdict } : {}),
      outcome,
      ...(options.behavior !== undefined ? { behavior: options.behavior } : {}),
      ...(summarizeAnswers(options.answers) !== undefined ? { answers: summarizeAnswers(options.answers) } : {}),
      ...(options.code !== undefined ? { code: options.code } : {}),
      ...(options.cancelReason !== undefined ? { reason: options.cancelReason } : {}),
      source: options.source ?? (cancelled ? 'teardown' : 'answer'),
      at: settlement.at,
    })
    this.#emit({ type: ASK_FRAME_TYPES.SETTLED, payload: { eventId, outcome } })
    return settlement
  }

  // ---- answer --------------------------------------------------------------
  /**
   * First-wins answer path. Returns the protocol error code for late, unknown,
   * non-addressee and duplicate submissions; a successful answer settles once.
   */
  answer(sessionId: string, rawParams: unknown): AnswerResult {
    const parsed = validateAskResponse(rawParams)
    if (!parsed.ok) {
      return { ok: false, code: ASK_ERROR_CODES.INVALID_RESPONSE, message: parsed.message }
    }
    const params: AskResponseParams = parsed.value
    const entry = this.#pending.get(params.eventId)

    if (entry === undefined) {
      // Turn/session teardown takes precedence over plain already-answered
      // (D5: a late response to a cleared ask is ASK_TURN_ENDED).
      if (this.#endedIds.has(params.eventId)) {
        return { ok: false, code: ASK_ERROR_CODES.TURN_ENDED, message: 'ask belongs to an ended turn/session' }
      }
      if (this.#settledIds.has(params.eventId)) {
        return { ok: false, code: ASK_ERROR_CODES.ALREADY_ANSWERED, message: 'ask already answered' }
      }
      return { ok: false, code: ASK_ERROR_CODES.UNKNOWN_REQUEST, message: 'unknown eventId' }
    }

    if (entry.deliveredTo !== sessionId) {
      return { ok: false, code: ASK_ERROR_CODES.NOT_ADDRESSEE, message: 'ask was delivered to another session' }
    }
    if (params.kind !== entry.request.kind) {
      return { ok: false, code: ASK_ERROR_CODES.INVALID_RESPONSE, message: 'response kind does not match the ask' }
    }
    if (entry.request.kind === 'approval' && params.verdict === undefined) {
      return { ok: false, code: ASK_ERROR_CODES.INVALID_RESPONSE, message: 'approval response requires a verdict' }
    }
    if (entry.request.kind === 'questions' && (params.answers === undefined || params.answers.length === 0)) {
      return { ok: false, code: ASK_ERROR_CODES.INVALID_RESPONSE, message: 'questions response requires answers' }
    }
    // PENDING-CONFIRMATION (Q3): escalation must have been granted on the
    // request, otherwise behavior:'always' is rejected.
    if (params.behavior === 'always' && entry.request.escalation !== true) {
      return { ok: false, code: ASK_ERROR_CODES.INVALID_RESPONSE, message: 'behavior:"always" needs a granted escalation' }
    }

    let outcome: AskOutcome
    switch (params.verdict) {
      case 'allowed-once':
        outcome = 'approved'
        break
      case 'rejected':
        outcome = 'denied'
        break
      case 'unavailable':
        outcome = 'unavailable'
        break
      default:
        // Questions carry answers rather than a verdict.
        outcome = 'approved'
    }

    // ADR-0011 T7: 'always' lives in a session-scoped summary that is NOT
    // derived from journal events, so compaction cannot clear the effect (A4).
    if (params.behavior === 'always') {
      this.#summary.grant(sessionId, entry.request.toolName ?? params.eventId)
    }

    // B4: 'session' = allow ALL gated write tools for this session (the `s` key
    // on the approval card). Reuse the SAME session-scoped summary as 'always',
    // so registered subagents inherit the grant (ADR-0011:142-147) and
    // clearSessionGrants still scopes it (I1/A5). NOT setApprovalPolicy — that
    // would be blanket "never ask", which the user did not choose.
    // One (session,tool) journal row per gate tool so a respawn's
    // alwaysGrantToolsFromJournal() reconstructs the full grant set: the row
    // marker is `behavior:'always'` because that is the durable grant-rebuild
    // signal; a session grant confers the identical in-process, session-scoped
    // tool grant. The settlement row below still records the real behavior
    // ('session') and the host still sees verdict:'allowed-once' (ADR-0011:52).
    if (params.behavior === 'session') {
      const sourceSession = redactIdentifier(sessionId) ?? sessionId
      const sourceTurn = redactIdentifier(entry.turnId) ?? entry.turnId
      for (const tool of Object.keys(WRITE_TOOL_POLICY)) {
        this.#summary.grant(sessionId, tool)
        this.#writeJournal({
          eventId: entry.request.eventId,
          kind: ASK_JOURNAL_KINDS.RESPONDED,
          askKind: entry.request.kind,
          sessionId: sourceSession,
          turnId: sourceTurn,
          toolName: tool,
          verdict: 'allowed-once',
          outcome: 'approved',
          behavior: 'always',
          source: 'answer',
          at: this.#now(),
        })
      }
    }

    const settlement = this.#settle(entry, outcome, {
      ...(params.verdict !== undefined ? { verdict: params.verdict } : {}),
      ...(params.behavior !== undefined ? { behavior: params.behavior } : {}),
      ...(params.answers !== undefined ? { answers: params.answers } : {}),
      source: 'answer',
    })
    return { ok: true, settlement }
  }

  // ---- fail-closed (D6 / ASK_CHANNEL_UNAVAILABLE) --------------------------
  /**
   * No provider / no service: never push `ask.request`; synthesize a settled
   * `unavailable` result and report ASK_CHANNEL_UNAVAILABLE. A later answer to
   * the returned eventId is ASK_ALREADY_ANSWERED (A2).
   */
  failClosed(input: FailClosedInput): { settlement: AskSettlement; code: AskErrorCode } {
    const eventId = this.nextEventId(input.turnId)
    const settlement: AskSettlement = {
      eventId,
      outcome: 'unavailable',
      code: ASK_ERROR_CODES.CHANNEL_UNAVAILABLE,
      message: input.reason ?? 'ask channel unavailable (no provider/service)',
      at: this.#now(),
    }
    remember(this.#settledIds, eventId, this.#recordLimit)
    this.#settlementLog.push(settlement)
    // No `ask.request` was pushed, so there is no `requested` event: the single
    // `responded` event (unavailable) is the complete audit for fail-closed.
    this.#writeJournal({
      eventId,
      kind: ASK_JOURNAL_KINDS.RESPONDED,
      askKind: input.kind,
      sessionId: redactIdentifier(input.sessionId) ?? input.sessionId,
      turnId: redactIdentifier(input.turnId) ?? input.turnId,
      verdict: 'unavailable',
      outcome: 'unavailable',
      code: ASK_ERROR_CODES.CHANNEL_UNAVAILABLE,
      source: 'fail-closed',
      at: settlement.at,
    })
    this.#emit({ type: ASK_FRAME_TYPES.SETTLED, payload: { eventId, outcome: 'unavailable' } })
    return { settlement, code: ASK_ERROR_CODES.CHANNEL_UNAVAILABLE }
  }

  // ---- detach / reattach ---------------------------------------------------
  /** Arm the grace window for every pending ask delivered to this session. */
  markDetached(sessionId: string): void {
    for (const entry of this.#pending.values()) {
      if (entry.deliveredTo !== sessionId || entry.graceTimer !== undefined) continue
      entry.graceTimer = this.#arm(() => {
        this.#settle(entry, 'cancelled', {
          cancelReason: 'host-abort',
          code: ASK_ERROR_CODES.TURN_ENDED,
          message: 'client detached past the grace window',
          source: 'teardown',
        })
      }, entry.graceMs)
    }
  }

  /** Re-ack on reconnect: disarm any grace window still pending. */
  markAttached(sessionId: string): void {
    for (const entry of this.#pending.values()) {
      if (entry.deliveredTo !== sessionId || entry.graceTimer === undefined) continue
      this.#disarm(entry.graceTimer)
      entry.graceTimer = undefined
    }
  }

  // ---- turn / session teardown (D5) ---------------------------------------
  /** Cancel + settle every pending ask of a turn; late answers get
   *  ASK_TURN_ENDED. This is the interface T3 calls from turn abort/terminal. */
  clearTurn(turnId: string, reason: AskCancelReason = 'host-abort'): AskSettlement[] {
    const out: AskSettlement[] = []
    for (const entry of [...this.#pending.values()]) {
      if (entry.turnId !== turnId) continue
      out.push(this.#settle(entry, 'cancelled', { cancelReason: reason, ended: true, message: 'turn ended' }))
    }
    return out
  }

  /** Close/replace of a session clears all of its pending asks. */
  clearSession(sessionId: string, reason: AskCancelReason = 'host-abort'): AskSettlement[] {
    const out: AskSettlement[] = []
    for (const entry of [...this.#pending.values()]) {
      if (entry.deliveredTo !== sessionId) continue
      out.push(this.#settle(entry, 'cancelled', { cancelReason: reason, ended: true, message: 'session ended' }))
    }
    return out
  }

  /** Reconnect snapshot of still-pending asks, optionally emitted as
   *  `ask.pending`. Pure read when `emit === false`. */
  pendingSnapshot(sessionId: string, emit = false): AskRequestPayload[] {
    const asks = [...this.#pending.values()]
      .filter((entry) => entry.deliveredTo === sessionId)
      .map((entry) => ({ ...entry.request }))
    if (emit) this.#emit({ type: ASK_FRAME_TYPES.PENDING, payload: { sessionId, asks } })
    return asks
  }

  // ---- teardown / leak safety ---------------------------------------------
  /** Release every armed timer and drop all state. Idempotent. */
  dispose(): void {
    for (const handle of this.#timers) clearTimeout(handle)
    this.#timers.clear()
    this.#pending.clear()
    this.#seqByTurn.clear()
    this.#settledIds.clear()
    this.#endedIds.clear()
    this.#settlementLog.length = 0
    this.#summary.clear()
    this.#logger?.debug?.('[ask-registry] disposed: all timers released')
  }
}

/** Host singleton used by the plugin (T3 will import this). Tests should use
 *  `new AskRegistry(...)` / `createAskRegistry(...)` for isolation. */
export const askRegistry = new AskRegistry()

export function createAskRegistry(options: AskRegistryOptions = {}): AskRegistry {
  return new AskRegistry(options)
}
