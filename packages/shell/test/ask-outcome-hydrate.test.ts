/**
 * ask-outcome HYDRATE (stored) path — v4 contract (research
 * ask-hydrate-notice-contract §2–§4 / ask-outcome-transcript §8.3–§8.5 /
 * prereg A12 / A21 / A26–A29).
 *
 * The stored path derives notices from RAW journal rows through the same
 * `deriveAskOutcomeNotice` the live + DEAD event paths use, merges them by
 * anchorSeq into the hydrate rows, and NEVER emits an event from
 * `storedTranscript`. This file covers the pure projection (no harness):
 * stored row shape, event parity, session isolation, conflict handling,
 * orphan anchor/text parity and the child-log zero-output rule.
 */
import { describe, expect, test } from "bun:test"
import {
	bridgeReplayRowsToChildLog,
	bridgeReplayRowsToSeamEvents,
	bridgeReplayRowsToSeamTranscript,
	type BridgeReplayRow,
} from "../src/client/bridge-session-seam.ts"
import { deriveAskOutcomeNotice } from "../src/client/ask-outcome.ts"

const SESSION = "hydrate-sess"

function terminal(seq: number, overrides: Record<string, unknown> = {}): BridgeReplayRow {
	return {
		seq,
		type: "plugin:opentui/ask/responded",
		payload: {
			eventId: "E1",
			kind: "ask.responded",
			askKind: "approval",
			sessionId: SESSION,
			turnId: "turn-1",
			source: "answer",
			outcome: "approved",
			settleReason: "answered",
			...overrides,
		},
	}
}

function userRow(seq: number, text: string): BridgeReplayRow {
	return {
		seq,
		type: "user/message",
		payload: { content: [{ type: "text", text }], source: { kind: "user" } },
	}
}

function noticeRows(rows: readonly BridgeReplayRow[], sessionId = SESSION) {
	return bridgeReplayRowsToSeamTranscript(rows, 0, sessionId)
		.filter((row) => row.kind === "notice")
		.map((row) => row as { kind: "notice"; id: string; text: string; final: true })
}

describe("hydrate ask-outcome notice — stored carrier (A21)", () => {
	test("stored row has its OWN kind 'notice' with the shared id, not an assistant row", () => {
		const stored = noticeRows([userRow(1, "hi"), terminal(9)])
		expect(stored).toHaveLength(1)
		expect(stored[0]).toEqual({
			kind: "notice",
			id: "ask-outcome:E1",
			text: "已收到该请求的回答",
			final: true,
		})
		expect(bridgeReplayRowsToSeamTranscript([userRow(1, "hi"), terminal(9)]).some((r) => r.kind === "notice")).toBe(false)
	})

	test("stored and DEAD event paths produce byte-identical id/text (A18/A28)", () => {
		const rows = [userRow(1, "hi"), terminal(9)]
		const stored = noticeRows(rows)
		const events = bridgeReplayRowsToSeamEvents(rows, SESSION)
			.filter((e) => e.type === "message.updated")
			.map((e) => e.details as Record<string, unknown>)
			.filter((d) => d.role === "notice")
		expect(events).toHaveLength(1)
		expect(events[0]!.id).toBe(stored[0]!.id)
		expect(events[0]!.text).toBe(stored[0]!.text)
		// The shared derivation is the source of both texts.
		expect(stored[0]!.text).toBe(
			deriveAskOutcomeNotice({
				eventId: "E1", sessionId: SESSION, anchorSeq: 9, settleReason: "answered",
			})!.text,
		)
	})

	test("no session id (child log / sessionInfo callers) → zero notices", () => {
		const rows = [userRow(1, "hi"), terminal(9)]
		expect(bridgeReplayRowsToSeamTranscript(rows).some((r) => r.kind === "notice")).toBe(false)
		expect(bridgeReplayRowsToChildLog(rows)).toEqual(["hi"])
	})

	test("only the READ session survives; unknown/mismatched sessionId is dropped (A27)", () => {
		const rows = [
			terminal(9),
			terminal(11, { eventId: "E-unknown", sessionId: "unknown" }),
			terminal(13, { eventId: "E-other", sessionId: "another" }),
			terminal(15, { eventId: "E-missing", sessionId: undefined }),
		]
		expect(noticeRows(rows).map((n) => n.id)).toEqual(["ask-outcome:E1"])
	})

	test("same eventId: MAX-seq terminal wins; distinct real reasons stay distinguishable (A11)", () => {
		const rows = [
			terminal(9),
			terminal(12, { settleReason: "rejected", outcome: "denied" }),
			terminal(14, { settleReason: "rejected", outcome: "denied" }),
		]
		const stored = noticeRows(rows)
		expect(stored.map((n) => n.text)).toEqual([
			"该请求已被拒绝",
			"【日志结局冲突】已收到该请求的回答",
		])
		expect(stored[1]!.id).toBe("ask-outcome:E1:seq-9")
	})

	test("strong-kill orphan anchors at turn/end and matches the events text (A23/A29)", () => {
		const rows: BridgeReplayRow[] = [
			userRow(1, "hi"),
			{
				seq: 4,
				type: "plugin:opentui/ask/requested",
				payload: { eventId: "turn-2:ask-4", kind: "ask.requested", askKind: "questions", sessionId: SESSION, turnId: "turn-2" },
			},
			{ seq: 8, type: "turn/end", payload: { turnId: "turn-2", turn: 2 } },
		]
		const stored = noticeRows(rows)
		expect(stored).toHaveLength(1)
		const event = bridgeReplayRowsToSeamEvents(rows, SESSION)
			.map((e) => e.details as Record<string, unknown>)
			.find((d) => d.role === "notice" && String(d.id).startsWith("ask-outcome:"))
		expect(stored[0]!.text).toBe(event!.text)
		expect(stored[0]!.text).toBe("未收到该请求的回答结果")
		// anchorSeq lands after the turn/end: the notice is the LAST stored row.
		const all = bridgeReplayRowsToSeamTranscript(rows, 0, SESSION)
		expect(all[all.length - 1]!.kind).toBe("notice")
		expect(stored[0]!.text).not.toMatch(/answered|rejected|timeout|aborted/)
	})
})
