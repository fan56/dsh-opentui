/**
 * Single ask-outcome notice derivation (research §8.4 / hydrate contract §3,
 * prereg A18 / A20 / A23 / A29).
 *
 * Live `ask.settled` frames AND DEAD replay journal rows both call this one
 * function, so the fixed id / text / anchorSeq are byte-identical across
 * paths. The stored (hydrate) path reuses it too. This module intentionally
 * lives in the shell client layer: the seam never imports the bridge package
 * at runtime (same rule as BridgeTransport), so the closed reason vocabulary
 * is mirrored here rather than imported.
 */

/** Stable output consumed by both the frame emitter and the replay projector. */
export interface AskOutcomeNotice {
	/** Fixed id shared by live frames and replay events: `ask-outcome:<eventId>`. */
	id: string
	/** Non-empty, human-readable outcome text. */
	text: string
	/** Journal seq the notice is anchored to: terminal row, or turn/end for an orphan. */
	anchorSeq: number
	/** Session the notice is scoped to; callers also check it against the bound session. */
	sessionId: string
}

/** Normalized terminal / journal information from either path. */
export interface AskOutcomeInput {
	eventId: string
	sessionId: string
	anchorSeq: number
	/** Closed `ask.settled.reason` / journal `settleReason` when present. */
	settleReason?: string
	/** Journal kind (`ask.responded` / `ask.cancelled`) when replaying an old row. */
	journalKind?: string
	/** Ask kind (`approval` / `questions`). */
	askKind?: string
	outcome?: string
	source?: string
	/** `ask.cancel` vocabulary — only consulted by the legacy fallback, never for new frames. */
	cancelReason?: string
	childSessionId?: string
	/** Strong-kill orphan: a `requested` row with no terminal, after its turn/end. */
	orphan?: boolean
}

/** Mirror of the bridge's closed `AskSettleReason` set (no runtime bridge import). */
const CLOSED_SETTLE_REASONS: ReadonlySet<string> = new Set([
	"answered",
	"rejected",
	"unavailable",
	"timeout",
	"aborted",
	"turn-ended",
	"session-closed",
	"detached",
	"connection-closed",
	"no-channel",
	"auto-approved",
])

/** One text per reason, shared verbatim by live and replay (A18). All strings
 *  are Chinese so the closed English reason tokens never leak into notice text. */
const SETTLE_TEXT: Readonly<Record<string, string>> = {
	answered: "已收到该请求的回答",
	rejected: "该请求已被拒绝",
	unavailable: "该请求无可用回答渠道",
	timeout: "等待该请求的回答超时",
	aborted: "该请求被中止",
	"turn-ended": "回合结束时该请求已取消",
	"session-closed": "会话关闭时该请求已取消",
	detached: "该请求已脱离当前会话",
	"connection-closed": "连接关闭时该请求已取消",
	"no-channel": "没有可用投递渠道，该请求未完成",
	"auto-approved": "该请求已自动批准",
}

/** Coarse legacy values carry an explicit "旧日志未细分" marker and no closed
 *  reason word (A20). The orphan text likewise never names a closed reason
 *  (§7.5 / A23 / U1). */
const LEGACY_ENDED_TEXT = "该请求已结束（旧日志未细分）"
const LEGACY_UNRECORDED_TEXT = "该请求结局未记录（旧日志未细分）"
const LEGACY_ORPHAN_TEXT = "未收到该请求的回答结果"

/** §7.3 fixed fallback table, used ONLY when a row has no closed `settleReason`.
 *  `ended` / `unrecorded` are coarse inferences, never `aborted`. */
function legacyReason(input: AskOutcomeInput): string {
	if (input.journalKind === "ask.responded") {
		if (input.outcome === "denied") return "rejected"
		if (input.outcome === "approved" && input.source === "answer") return "answered"
		if (input.outcome === "unavailable" && input.source === "fail-closed") return "no-channel"
		return "unrecorded"
	}
	if (input.journalKind === "ask.cancelled") {
		if (input.cancelReason === "deadline") return "timeout"
		if (input.cancelReason === "host-abort") return "ended"
		return "unrecorded"
	}
	// A live frame (or a row without a journal kind) only carries an outcome.
	if (input.outcome === "approved") return "answered"
	if (input.outcome === "denied") return "rejected"
	if (input.outcome === "unavailable") return "no-channel"
	return "unrecorded"
}

function reasonText(reason: string): string {
	if (reason === "ended") return LEGACY_ENDED_TEXT
	if (reason === "unrecorded") return LEGACY_UNRECORDED_TEXT
	return SETTLE_TEXT[reason] ?? LEGACY_UNRECORDED_TEXT
}

/**
 * Derive the single ask-outcome notice. Returns `undefined` when the row must
 * not be projected at all:
 *  - no eventId, or a missing / `unknown` sessionId (A17 / A27);
 *  - `source === 'summary'` (A15 / A19);
 *  - `questions` + `approved` with no `childSessionId` — the ask row already
 *    carries the answer, so no notice (A13; child asks keep theirs).
 */
export function deriveAskOutcomeNotice(input: AskOutcomeInput): AskOutcomeNotice | undefined {
	if (input.eventId === "" || input.sessionId === "" || input.sessionId === "unknown") return undefined
	if (input.source === "summary") return undefined
	if (
		!input.orphan &&
		input.askKind === "questions" &&
		input.outcome === "approved" &&
		input.childSessionId === undefined
	) {
		return undefined
	}

	const text = input.orphan
		? LEGACY_ORPHAN_TEXT
		: reasonText(
			input.settleReason !== undefined && CLOSED_SETTLE_REASONS.has(input.settleReason)
				? input.settleReason
				: legacyReason(input),
		)
	return {
		id: `ask-outcome:${input.eventId}`,
		text,
		anchorSeq: input.anchorSeq,
		sessionId: input.sessionId,
	}
}
