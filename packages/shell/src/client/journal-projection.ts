/**
 * Shared journal → seam projection (S6 Commit2 clause 1 extraction).
 *
 * S6 deletes RemoteSessionSeam (session-seam-adapter.ts) but the BridgeSessionSeam
 * reuses `projectJournalRecord` in production (bridge-session-seam.ts:53) via
 * the recovery drain. This module is that projector's permanent home.
 *
 * projectJournalRecord and NOTICE_SOURCE_KINDS were moved verbatim from
 * session-seam-adapter.ts. The two text helpers it needs — `blocksText` and
 * `turnEndErrorMessage` — are NOT duplicated here: they are imported from
 * remote-follow.ts (S6 final-review C3), which is in the RETAIN set and is the
 * single implementation for both the live follow stream and this projector.
 *
 * Behavior note (S6 final-review C3, correcting the earlier "ZERO behavior
 * change" wording): the old adapter's LOCAL blocksText had no plain-string
 * fast-path — a `user/message` with a flat-string content produced "" and was
 * dropped. The shared remote-follow helper does have that fast-path, so such
 * records now project as a `message.updated` row. The journal-record content
 * shape distribution was not proven either way, so this is a declared, narrow
 * behavior window (aligned with remote-follow's "never silently dropped"
 * philosophy), not a claimed zero-diff. Block-array content — the shape the
 * projector tests cover — is unchanged.
 *
 * Dependencies are all in the RETAIN set (host client layer): ask-transcript,
 * seam-types, remote-follow, tui-base seams/session. No deleted module is
 * imported here.
 */
import type { StoredTranscriptRow } from "./seam-types.ts"
import {
	ASK_TOOL_NAME,
	parseAskCallArgs,
	parseAskAnswers,
	type ParsedAskQuestion,
} from "../features/ask-transcript.ts"
import type { SeamSessionEvent } from "../../../tui-base/src/seams/session"
import type { RemoteJournalEntry } from "./remote-session-ops.ts"
import { blocksText, turnEndErrorMessage } from "./remote-follow.ts"

// Re-export kept for API parity with the pre-C3 module surface; the single
// implementation lives in remote-follow.ts (live follow stream + projector).
export { blocksText, turnEndErrorMessage }

/** One durable journal record → seam-rows event shapes (0..n events).
 * Payload contracts are EXACTLY what seam-rows.ts apply() consumes. */
export const NOTICE_SOURCE_KINDS: ReadonlySet<string> = new Set(["subagent-settled", "agent-message", "team-message", "webhook"])

function assistantTextValue(data: Record<string, unknown>): string {
	if (typeof data.text === "string") return data.text.trim()
	return blocksText(data.content ?? data.parts)
}

export function projectJournalRecord(entry: RemoteJournalEntry, sessionId: string): SeamSessionEvent[] {
	if (entry.type === "user/message") {
		const text = blocksText(entry.data.content)
		if (!text) return []
		const id = typeof entry.data.messageID === "string" ? entry.data.messageID : `journal-${entry.seq}`
		const source = entry.data.source
		const kind =
			source !== null && typeof source === "object" ? (source as Record<string, unknown>).kind : undefined
		if (kind === undefined || kind === "user") {
			return [{ type: "message.updated", details: { id, role: "user", text, sessionID: sessionId } }]
		}
		if (typeof kind === "string" && NOTICE_SOURCE_KINDS.has(kind)) {
			return [{ type: "message.updated", details: { id, role: "notice", text, sessionID: sessionId } }]
		}
		return []
	}
	if (entry.type === "assistant/message") {
		const text = assistantTextValue(entry.data)
		if (!text) return []
		const messageID = typeof entry.data.messageID === "string" ? entry.data.messageID : `journal-${entry.seq}`
		return [
			{
				type: "message.part.updated",
				details: { messageID, sessionID: sessionId, part: { type: "text", id: `${messageID}:text`, text } },
			},
		]
	}
	if (entry.type === "turn/end") {
		const message = turnEndErrorMessage(entry.data)
		if (message === undefined) return []
		return [{ type: "session.error", details: { message, sessionID: sessionId } }]
	}
	return []
}
