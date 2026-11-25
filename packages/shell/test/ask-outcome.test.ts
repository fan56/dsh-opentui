/**
 * ask-outcome notice contract (research §8 / hydrate contract §3 / prereg
 * A10, A11, A13, A17, A18, A19, A20, A23, A27, A29).
 *
 * Covers the LIVE `ask.settled` emission and the DEAD replay events path plus
 * the single shared derivation function. The stored/hydrate path is NOT in
 * scope here (separate task); `bridgeReplayRowsToSeamTranscript` /
 * `journalToTranscriptRows` / seam-types / seam-rows are untouched.
 */
import { describe, expect, test } from "bun:test"
import {
	BridgeSessionSeam,
	bridgeReplayRowsToSeamEvents,
	type BridgeEventFrame,
	type BridgeReplayRow,
	type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"
import { deriveAskOutcomeNotice } from "../src/client/ask-outcome.ts"
import type { SeamSessionEvent, SeamTurnCallbacks } from "../../tui-base/src/seams/session"

const SESSION = "sess-1"
const CLOSED_WORDS = ["answered", "rejected", "timeout", "aborted", "no-channel", "turn-ended", "session-closed"]

function noticeEvents(events: readonly SeamSessionEvent[]): Record<string, unknown>[] {
	return events
		.filter((e) => e.type === "message.updated")
		.map((e) => e.details as Record<string, unknown>)
		.filter((d) => d.role === "notice" && typeof d.id === "string" && String(d.id).startsWith("ask-outcome:"))
}

function askRow(seq: number, overrides: Record<string, unknown> = {}): BridgeReplayRow {
	const kind = overrides.kind ?? "ask.responded"
	const wireKind = String(kind).replace("ask.", "")
	return {
		seq,
		type: `plugin:opentui/ask/${wireKind}`,
		payload: {
			eventId: "E1",
			kind,
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

// ---------------------------------------------------------------------------
// Shared derivation function
// ---------------------------------------------------------------------------

describe("deriveAskOutcomeNotice — single shared function", () => {
	test("fixed id, non-empty text, anchorSeq and scoped sessionId", () => {
		const notice = deriveAskOutcomeNotice({
			eventId: "E1", sessionId: SESSION, anchorSeq: 7, settleReason: "answered",
		})
		expect(notice).toBeDefined()
		expect(notice!.id).toBe("ask-outcome:E1")
		expect(typeof notice!.text).toBe("string")
		expect(notice!.text.length).toBeGreaterThan(0)
		expect(notice!.anchorSeq).toBe(7)
		expect(notice!.sessionId).toBe(SESSION)
	})

	test("summary, unknown session and questions+approved(no child) are not projected", () => {
		const base = { eventId: "E1", sessionId: SESSION, anchorSeq: 1, settleReason: "answered" }
		expect(deriveAskOutcomeNotice({ ...base, source: "summary" })).toBeUndefined()
		expect(deriveAskOutcomeNotice({ ...base, sessionId: "unknown" })).toBeUndefined()
		expect(deriveAskOutcomeNotice({
			...base, askKind: "questions", outcome: "approved",
		})).toBeUndefined()
		const child = deriveAskOutcomeNotice({
			...base, askKind: "questions", outcome: "approved", childSessionId: "child-1",
		})
		expect(child).toBeDefined()
	})

	test("v4 fallback table: legacy reasons, coarse markers, never aborted", () => {
		const fallback = (overrides: Record<string, unknown>) => deriveAskOutcomeNotice({
			eventId: "E1", sessionId: SESSION, anchorSeq: 1, ...overrides,
		})!.text
		expect(fallback({ journalKind: "ask.responded", source: "answer", outcome: "approved" }))
			.toBe(deriveAskOutcomeNotice({ eventId: "E1", sessionId: SESSION, anchorSeq: 1, settleReason: "answered" })!.text)
		expect(fallback({ journalKind: "ask.responded", outcome: "denied" }))
			.toBe(deriveAskOutcomeNotice({ eventId: "E1", sessionId: SESSION, anchorSeq: 1, settleReason: "rejected" })!.text)
		expect(fallback({ journalKind: "ask.responded", source: "fail-closed", outcome: "unavailable" }))
			.toBe(deriveAskOutcomeNotice({ eventId: "E1", sessionId: SESSION, anchorSeq: 1, settleReason: "no-channel" })!.text)
		expect(fallback({ journalKind: "ask.cancelled", cancelReason: "deadline" }))
			.toBe(deriveAskOutcomeNotice({ eventId: "E1", sessionId: SESSION, anchorSeq: 1, settleReason: "timeout" })!.text)

		const ended = fallback({ journalKind: "ask.cancelled", cancelReason: "host-abort" })
		const unrecorded = fallback({ journalKind: "ask.responded", source: "teardown", outcome: "approved" })
		// §7.3 冻结回退表：只有 responded + source='answer' + approved 才回退 answered；
		// 无 source 的 responded + approved 落入「其余」行 → unrecorded（粗粒度推断）。
		const unrecordedNoSource = fallback({ journalKind: "ask.responded", outcome: "approved" })
		expect(unrecordedNoSource).toBe(unrecorded)
		for (const text of [ended, unrecorded, unrecordedNoSource]) {
			expect(text).toContain("旧日志未细分")
			for (const word of CLOSED_WORDS) expect(text).not.toContain(word)
		}
	})

	test("orphan text names no closed reason and keeps the turn/end anchor", () => {
		const notice = deriveAskOutcomeNotice({
			eventId: "E23", sessionId: SESSION, anchorSeq: 42, orphan: true,
		})!
		expect(notice.id).toBe("ask-outcome:E23")
		expect(notice.anchorSeq).toBe(42)
		for (const word of CLOSED_WORDS) expect(notice.text).not.toContain(word)
	})
})

// ---------------------------------------------------------------------------
// LIVE ask.settled
// ---------------------------------------------------------------------------

function makeLiveHarness() {
	const listeners: ((frame: BridgeEventFrame) => void)[] = []
	const events: SeamSessionEvent[] = []
	const transport: BridgeTransport = {
		async request(method) {
			if (method === "session.open") return { sessionId: SESSION, journalCursor: 0 }
			if (method === "session.send") return { turnId: "turn-1" }
			return {}
		},
		onEvent(listener) {
			listeners.push(listener)
			return () => {}
		},
	}
	const seam = new BridgeSessionSeam({ transport, ctx: { logger: { info() {}, warn() {}, error() {} } } })
	seam.onSessionEvent((event) => events.push(event))
	const callbacks: SeamTurnCallbacks = {
		onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {},
	}
	return {
		seam,
		events,
		emit(type: string, payload: unknown) {
			for (const l of [...listeners]) l({ type, payload })
		},
		async bind() {
			const turn = seam.turn("hello", callbacks)
			await Bun.sleep(5) // session.open binds SESSION before ask frames arrive
			return { turn } // holder: returning the pending promise itself would be adopted by `await bind()`
		},
	}
}

describe("LIVE ask.settled → fixed-id notice", () => {
	test("settles first, then emits one notice; a repeated frame is a no-op", async () => {
		const h = makeLiveHarness()
		const { turn } = await h.bind()
		const payload = {
			eventId: "E10", sessionId: SESSION, outcome: "approved", reason: "answered", kind: "approval",
		}
		h.emit("ask.settled", payload)
		h.emit("ask.settled", payload)
		const notices = noticeEvents(h.events)
		expect(notices.filter((d) => d.id === "ask-outcome:E10")).toHaveLength(1)
		expect(notices[0]!.role).toBe("notice")
		expect(notices[0]!.sessionID).toBe(SESSION)
		expect(typeof notices[0]!.text).toBe("string")
		expect(String(notices[0]!.text).length).toBeGreaterThan(0)
		// live text is the SAME derivation the replay path uses
		expect(notices[0]!.text).toBe(
			deriveAskOutcomeNotice({
				eventId: "E10", sessionId: SESSION, anchorSeq: 0, settleReason: "answered",
			})!.text,
		)
		h.emit("turn.end", { turnId: "turn-1", text: "" })
		await turn
	})

	test("sessionId mismatch / unknown / missing emits nothing", async () => {
		const h = makeLiveHarness()
		const { turn } = await h.bind()
		expect(h.seam.currentSessionId()).toBe(SESSION)
		for (const sid of ["other", "unknown", undefined]) {
			h.emit("ask.settled", { eventId: `bad-${sid}`, sessionId: sid, reason: "answered" })
		}
		expect(noticeEvents(h.events)).toEqual([])
		h.emit("turn.end", { turnId: "turn-1", text: "" })
		await turn
	})

	test("questions+approved(no child) suppressed; child ask keeps childSessionId", async () => {
		const h = makeLiveHarness()
		const { turn } = await h.bind()
		h.emit("ask.settled", {
			eventId: "E13-parent", sessionId: SESSION, kind: "questions", outcome: "approved", reason: "answered",
		})
		h.emit("ask.settled", {
			eventId: "E13-child", sessionId: SESSION, kind: "questions", outcome: "approved",
			reason: "answered", childSessionId: "child-1",
		})
		const notices = noticeEvents(h.events)
		expect(notices.some((d) => d.id === "ask-outcome:E13-parent")).toBe(false)
		const child = notices.find((d) => d.id === "ask-outcome:E13-child")
		expect(child).toBeDefined()
		expect(child!.childSessionId).toBe("child-1")
		h.emit("turn.end", { turnId: "turn-1", text: "" })
		await turn
	})

	test("ask.cancel and #settlePendingAsk never emit a notice", async () => {
		const h = makeLiveHarness()
		const { turn } = await h.bind()
		h.emit("ask.request", {
			eventId: "turn-1:ask-1", sessionId: SESSION, kind: "approval", toolName: "bash",
		})
		h.emit("ask.cancel", { eventId: "turn-1:ask-1", reason: "host-abort" })
		expect(noticeEvents(h.events)).toEqual([])
		h.emit("turn.end", { turnId: "turn-1", text: "" })
		await turn
	})
})

// ---------------------------------------------------------------------------
// DEAD replay events
// ---------------------------------------------------------------------------

describe("DEAD replay → ask-outcome notices", () => {
	test("responded/cancelled rows project one fixed-id notice with replay/live parity", () => {
		const events = bridgeReplayRowsToSeamEvents([askRow(3, { eventId: "E18", settleReason: "timeout" })], SESSION)
		const notices = noticeEvents(events)
		expect(notices).toHaveLength(1)
		expect(notices[0]!.id).toBe("ask-outcome:E18")
		expect(notices[0]!.text).toBe(
			deriveAskOutcomeNotice({
				eventId: "E18", sessionId: SESSION, anchorSeq: 3, settleReason: "timeout",
			})!.text,
		)
	})

	test("DEAD notice flushes at its anchorSeq, not appended after every row", () => {
		const user = (seq: number, text: string): BridgeReplayRow => ({
			seq,
			type: "user/message",
			payload: { content: [{ type: "text", text }], source: { kind: "user" } },
		})
		const rows: BridgeReplayRow[] = [
			user(1, "before"),
			askRow(3, { eventId: "E-anchor", settleReason: "answered" }),
			user(9, "after"),
		]
		const events = bridgeReplayRowsToSeamEvents(rows, SESSION)
		// projectJournalRecord emits message.updated{role:'user', id:'journal-<seq>'}
		// for each user row; the ask journal row projects to no event of its own,
		// so the notice must land BETWEEN the two user rows (anchorSeq 3), not
		// after both as the old tail-append did (audit §6).
		const idx = (id: string, role?: string) => events.findIndex((e) => {
			const d = e.details as Record<string, unknown>
			return String(d.id ?? "") === id && (role === undefined || d.role === role)
		})
		const before = idx("journal-1", "user")
		const after = idx("journal-9", "user")
		const notice = idx("ask-outcome:E-anchor", "notice")
		expect(before).toBeGreaterThanOrEqual(0)
		expect(after).toBeGreaterThanOrEqual(0)
		expect(notice).toBeGreaterThanOrEqual(0)
		expect(notice).toBeGreaterThan(before)
		expect(notice).toBeLessThan(after)
	})

	test("same eventId repeated rows dedupe to the MAX-seq terminal", () => {
		const rows = [
			askRow(1, { eventId: "E11", settleReason: "answered" }),
			askRow(2, { eventId: "E11", settleReason: "answered" }),
			askRow(5, { eventId: "E11", settleReason: "rejected" }),
		]
		const notices = noticeEvents(bridgeReplayRowsToSeamEvents(rows, SESSION))
		// R2-5: events are flushed by anchorSeq, not derivation order, so the
		// A11 conflict line (anchor seq 1) precedes the canonical MAX-seq
		// terminal. Select the canonical by exact id, never by position.
		expect(notices.map((d) => d.id)).toEqual(["ask-outcome:E11:seq-1", "ask-outcome:E11"])
		expect(notices[0]!.text).toBe(
			`【日志结局冲突】${deriveAskOutcomeNotice({
				eventId: "E11", sessionId: SESSION, anchorSeq: 1, settleReason: "answered",
			})!.text}`,
		)
		const canonical = notices.filter((d) => d.id === "ask-outcome:E11")
		expect(canonical).toHaveLength(1)
		expect(canonical[0]!.text).toBe(
			deriveAskOutcomeNotice({
				eventId: "E11", sessionId: SESSION, anchorSeq: 5, settleReason: "rejected",
			})!.text,
		)
	})

	test("conflicting real terminals stay distinguishable (A11, no silent merge)", () => {
		const rows = [
			askRow(1, { eventId: "E11b", settleReason: "answered" }),
			askRow(2, { eventId: "E11b", settleReason: "timeout" }),
		]
		const notices = noticeEvents(bridgeReplayRowsToSeamEvents(rows, SESSION))
		expect(notices.length).toBeGreaterThan(1)
		expect(notices.some((d) => d.id === "ask-outcome:E11b")).toBe(true)
		expect(notices.some((d) => String(d.id).startsWith("ask-outcome:E11b:seq-"))).toBe(true)
		expect(notices.some((d) => String(d.text).includes("冲突"))).toBe(true)
	})

	test("summary and wrong/unknown session rows produce nothing", () => {
		const rows = [
			askRow(1, { eventId: "E19", source: "summary" }),
			askRow(2, { eventId: "E17", sessionId: "other" }),
			askRow(3, { eventId: "E27", sessionId: "unknown" }),
		]
		expect(noticeEvents(bridgeReplayRowsToSeamEvents(rows, SESSION))).toEqual([])
	})

	test("replay questions+approved: parent suppressed, child kept with childSessionId", () => {
		const rows = [
			askRow(1, { eventId: "E13a", askKind: "questions", outcome: "approved", settleReason: "answered" }),
			askRow(2, {
				eventId: "E13b", askKind: "questions", outcome: "approved",
				settleReason: "answered", childSessionId: "child-1",
			}),
		]
		const notices = noticeEvents(bridgeReplayRowsToSeamEvents(rows, SESSION))
		expect(notices.some((d) => d.id === "ask-outcome:E13a")).toBe(false)
		const child = notices.find((d) => d.id === "ask-outcome:E13b")
		expect(child).toBeDefined()
		expect(child!.childSessionId).toBe("child-1")
	})

	test("legacy fallback rows: coarse markers, no aborted, no closed words", () => {
		const rows = [
			askRow(1, { eventId: "L1", settleReason: undefined, source: "answer", outcome: "approved" }),
			askRow(2, { eventId: "L2", kind: "ask.cancelled", settleReason: undefined, reason: "deadline" }),
			askRow(3, { eventId: "L3", kind: "ask.cancelled", settleReason: undefined, reason: "host-abort" }),
			askRow(4, { eventId: "L4", settleReason: undefined, source: "teardown", outcome: "approved" }),
		]
		const notices = noticeEvents(bridgeReplayRowsToSeamEvents(rows, SESSION))
		expect(notices).toHaveLength(4)
		const text = (id: string) => String(notices.find((d) => d.id === `ask-outcome:${id}`)!.text)
		expect(text("L1")).toBe(deriveAskOutcomeNotice({
			eventId: "L1", sessionId: SESSION, anchorSeq: 1, settleReason: "answered",
		})!.text)
		expect(text("L2")).toBe(deriveAskOutcomeNotice({
			eventId: "L2", sessionId: SESSION, anchorSeq: 2, settleReason: "timeout",
		})!.text)
		for (const id of ["L3", "L4"]) {
			expect(text(id)).toContain("旧日志未细分")
			for (const word of CLOSED_WORDS) expect(text(id)).not.toContain(word)
		}
	})

	test("strong-kill orphan: only requested + same-turn turn/end, no closed reason", () => {
		const rows: BridgeReplayRow[] = [
			{ seq: 1, type: "turn/start", payload: { turnId: "turn-1" } },
			{
				seq: 2,
				type: "plugin:opentui/ask/requested",
				payload: {
					eventId: "E23", kind: "ask.requested", askKind: "approval",
					sessionId: SESSION, turnId: "turn-1", source: "request",
				},
			},
			{ seq: 9, type: "turn/end", payload: { turnId: "turn-1" } },
		]
		const notices = noticeEvents(bridgeReplayRowsToSeamEvents(rows, SESSION))
		expect(notices).toHaveLength(1)
		expect(notices[0]!.id).toBe("ask-outcome:E23")
		expect(notices[0]!.text).toBe(deriveAskOutcomeNotice({
			eventId: "E23", sessionId: SESSION, anchorSeq: 9, orphan: true,
		})!.text)
		for (const word of CLOSED_WORDS) expect(String(notices[0]!.text)).not.toContain(word)
	})

	test("no requested row (incremental window) or no turn/end → no orphan", () => {
		const withoutRequested = bridgeReplayRowsToSeamEvents([
			{ seq: 1, type: "turn/start", payload: { turnId: "turn-1" } },
			{ seq: 9, type: "turn/end", payload: { turnId: "turn-1" } },
		], SESSION)
		expect(noticeEvents(withoutRequested)).toEqual([])

		const withoutTurnEnd = bridgeReplayRowsToSeamEvents([
			{
				seq: 2,
				type: "plugin:opentui/ask/requested",
				payload: {
					eventId: "E23", kind: "ask.requested", askKind: "approval",
					sessionId: SESSION, turnId: "turn-1", source: "request",
				},
			},
		], SESSION)
		expect(noticeEvents(withoutTurnEnd)).toEqual([])
	})

	test("a terminal row wins over an orphan for the same eventId", () => {
		const rows: BridgeReplayRow[] = [
			{
				seq: 1,
				type: "plugin:opentui/ask/requested",
				payload: {
					eventId: "E28", kind: "ask.requested", askKind: "approval",
					sessionId: SESSION, turnId: "turn-1", source: "request",
				},
			},
			askRow(2, { eventId: "E28", settleReason: "answered" }),
			{ seq: 9, type: "turn/end", payload: { turnId: "turn-1" } },
		]
		const notices = noticeEvents(bridgeReplayRowsToSeamEvents(rows, SESSION))
		expect(notices).toHaveLength(1)
		expect(notices[0]!.id).toBe("ask-outcome:E28")
		expect(notices[0]!.text).toBe(deriveAskOutcomeNotice({
			eventId: "E28", sessionId: SESSION, anchorSeq: 2, settleReason: "answered",
		})!.text)
	})
})
