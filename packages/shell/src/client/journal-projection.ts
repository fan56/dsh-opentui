/**
 * Shared journal → seam projection (S6 Commit2 clause 1 extraction).
 *
 * S6 deletes RemoteSessionSeam (session-seam-adapter.ts) but the BridgeSessionSeam
 * reuses `projectJournalRecord` in production (bridge-session-seam.ts:53) via
 * the recovery drain. This module is that projector's permanent home so the
 * bridge path survives the deletion with ZERO behavior change.
 *
 * Extracted verbatim from session-seam-adapter.ts: NOTICE_SOURCE_KINDS,
 * projectJournalRecord, and its private helpers (blocksText / assistantTextValue).
 * `blocksText` is the union of the former local variant and remote-follow's
 * variant (string-or-blocks), which is identical for all journal record shapes.
 *
 * Dependencies are all in the RETAIN set (host client layer): ask-transcript,
 * seam-types, tui-base seams/session. No deleted module is imported here.
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

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Concatenated text of a record's content blocks ({type:"text",text}) or a
 * plain string. Union of the former session-seam-adapter + remote-follow
 * variants (identical for journal record shapes). */
export function blocksText(content: unknown): string {
	if (typeof content === "string") return content.trim()
	const blocks = Array.isArray(content) ? content : []
	let text = ""
	for (const block of blocks) {
		const typed = block as { type?: unknown; text?: unknown } | null
		if (typed?.type === "text" && typeof typed.text === "string") {
			text += (text === "" ? "" : "\n") + typed.text
		}
	}
	return text.trim()
}

/** One durable journal record → seam-rows event shapes (0..n events).
 * Payload contracts are EXACTLY what seam-rows.ts apply() consumes. */
export const NOTICE_SOURCE_KINDS: ReadonlySet<string> = new Set(["subagent-settled", "agent-message", "team-message", "webhook"])

function assistantTextValue(data: Record<string, unknown>): string {
	if (typeof data.text === "string") return data.text.trim()
	return blocksText(data.content ?? data.parts)
}

/** Error text of a `turn/end` failure record (former remote-follow helper). */
export function turnEndErrorMessage(data: Record<string, unknown>): string | undefined {
	const reason = asRecord(data.reason)
	if (reason.kind !== "error") return undefined
	const error = asRecord(reason.error)
	const message = error.message ?? reason.error
	return String(message ?? "turn error").slice(0, 300)
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
