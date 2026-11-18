/**
 * ADR-0011 T7 — ask decision persistence primitives.
 *
 * Two deliberately separate concerns live here:
 *
 * 1. A redacted, append-only **journal event** vocabulary (`ask.requested` /
 *    `ask.responded` / `ask.cancelled`). These are audit records written into
 *    the host session log as ignorable `plugin:` records (the host's sanctioned
 *    out-of-repo event seam). They never carry tool arguments, prompts, reasons
 *    or free-text answers — only an explicit scalar allowlist plus numeric
 *    answer counts.
 * 2. A **session-scoped permission summary** (`SessionPermissionSummary`) that
 *    holds the durable *effect* of `behavior:'always'` in this bridge process.
 *    It is keyed by sessionId and is NOT derived from journal events, so a
 *    compaction that clears/replaces log events cannot clear the grant (ADR-0011
 *    A4/D7: "compaction 清事件不清效果"). It is also not shared across sessions.
 *
 * This module imports no host package and touches no I/O: the registry drives
 * it with an injected sink, and index.ts supplies the real host writer.
 */
import type {
  AskBehavior,
  AskCancelReason,
  AskErrorCode,
  AskKind,
  AskOutcome,
  AskVerdict,
} from './ask-frames'

// ---------------------------------------------------------------------------
// Journal event vocabulary
// ---------------------------------------------------------------------------
export const ASK_JOURNAL_KINDS = {
  REQUESTED: 'ask.requested',
  RESPONDED: 'ask.responded',
  CANCELLED: 'ask.cancelled',
} as const
export type AskJournalKind = (typeof ASK_JOURNAL_KINDS)[keyof typeof ASK_JOURNAL_KINDS]

/** Host plugin-record type for one journal kind. The host grammar is
 *  `plugin:` + slash-separated lowercase segments (dsh-session types.ts:532-537),
 *  and `ignorable:true` records are skipped by readers that do not own them. */
export const ASK_PLUGIN_RECORD_PREFIX = 'plugin:opentui/ask'
export function askPluginRecordType(kind: AskJournalKind): string {
  return `${ASK_PLUGIN_RECORD_PREFIX}/${kind.slice('ask.'.length)}`
}

/** How a decision reached the journal — informative only, never a free-text
 *  channel (no stack traces, no tool output). */
export type AskJournalSource = 'request' | 'answer' | 'timeout' | 'teardown' | 'fail-closed' | 'summary'

/** Numeric-only answer summary. Never stores `answers[].custom`, option labels,
 *  question prompts, or selected string values. */
export interface AskJournalAnswers {
  /** Number of answered questions. */
  count: number
  /** Number of selected options per answered question, in question order. */
  selections: number[]
}

/**
 * One redacted journal event. Every field is an enum, a bounded identifier, a
 * number, or a numeric summary. There is intentionally no `args`, `reason`,
 * `prompt`, `custom`, or `message` field — those are the sensitive surfaces.
 */
export interface AskJournalEvent {
  /** `${turnId}:ask-${seq}` — the ADR-0011 §3.1 lifecycle key. */
  eventId: string
  /** One of the three decision-persistence kinds. */
  kind: AskJournalKind
  /** Ask kind from the validated wire payload ('approval' | 'questions'). */
  askKind: AskKind
  /** Session that owned the ask (scoping key, also an allowlisted identifier). */
  sessionId: string
  /** Turn the ask was bound to (A1). */
  turnId: string
  /** Allowlisted tool name, when the ask carried one. */
  toolName?: string
  /** Approval verdict / answer-derived outcome, when the ask settled. */
  verdict?: AskVerdict
  /** Terminal outcome, when the ask settled. */
  outcome?: AskOutcome
  /** Grant behavior, when the client asked for one. */
  behavior?: AskBehavior
  /** Numeric answer digest, when a questions ask was answered. */
  answers?: AskJournalAnswers
  /** Protocol code on fail-closed / timeout / teardown paths. */
  code?: AskErrorCode
  /** Cancellation reason (closed vocabulary), never a free-text reason. */
  reason?: AskCancelReason
  /** How the decision was produced (audit only). */
  source: AskJournalSource
  /** Unix epoch milliseconds from the registry's injected clock. */
  at: number
}

/** Injected writer. The real host writer is fire-and-forget with containment;
 *  a failed append must never change the ask verdict. */
export type AskJournalSink = (event: AskJournalEvent) => void

// ---------------------------------------------------------------------------
// Redaction helpers — the ONLY way free-form input becomes a journal field.
// ---------------------------------------------------------------------------
const IDENTIFIER_CHARS = /[^A-Za-z0-9._:-]/g
const MAX_IDENTIFIER_CHARS = 96

/** Keep only identifier-shaped characters and bound the length. This strips
 *  every space, quote, newline, control char and non-ASCII payload from a name
 *  before it can reach the log; a value that becomes empty is dropped. */
export function redactIdentifier(value: unknown, max = MAX_IDENTIFIER_CHARS): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  const cleaned = value.replace(IDENTIFIER_CHARS, '').slice(0, max)
  return cleaned === '' ? undefined : cleaned
}

/** Build the numeric-only answer digest. `custom` and the selected strings are
 *  read for their COUNT only and discarded immediately. */
export function summarizeAnswers(answers: readonly { selected: readonly string[] }[] | undefined): AskJournalAnswers | undefined {
  if (answers === undefined || answers.length === 0) return undefined
  return {
    count: answers.length,
    selections: answers.map((answer) => answer.selected.length),
  }
}

// ---------------------------------------------------------------------------
// Session-scoped permission summary (compaction-independent by construction).
// ---------------------------------------------------------------------------
/**
 * In-process, per-session store of tool names granted with `behavior:'always'`.
 *
 * The store is intentionally a plain Map rather than a projection over journal
 * events: compaction drops/replaces events, and ADR-0011 A4 requires the effect
 * to outlive that. Scope is the sessionId, so a grant in A can never authorize
 * the same tool in B (A5). The bridge calls `clearSession` when the session is
 * closed or replaced (I1), so grants never outlive their session.
 */
export class SessionPermissionSummary {
  readonly #bySession = new Map<string, Set<string>>()

  has(sessionId: string, toolName: string): boolean {
    return this.#bySession.get(sessionId)?.has(toolName) === true
  }

  grant(sessionId: string, toolName: string): void {
    let tools = this.#bySession.get(sessionId)
    if (tools === undefined) {
      tools = new Set<string>()
      this.#bySession.set(sessionId, tools)
    }
    tools.add(toolName)
  }

  clearSession(sessionId: string): void {
    this.#bySession.delete(sessionId)
  }

  tools(sessionId: string): readonly string[] {
    return [...(this.#bySession.get(sessionId) ?? [])]
  }

  count(sessionId: string): number {
    return this.#bySession.get(sessionId)?.size ?? 0
  }

  clear(): void {
    this.#bySession.clear()
  }
}
