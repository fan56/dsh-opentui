/**
 * Real AskRegistry → wire/journal → shell live/DEAD/stored three-way round-trip.
 *
 * Every frame and journal row asserted here comes from a REAL `AskRegistry`
 * instance (packages/bridge/src/ask-registry.ts) with injected capture sinks —
 * no hand-built registry output and no production export changes. The captured
 * `ask.settled` frames are fed to the LIVE seam; the captured journal rows are
 * mapped to replay rows EXACTLY as the production writer does
 * (`askPluginRecordType(event.kind)` + the event as `payload`,
 * bridge/src/index.ts:2830) and fed to the DEAD event and stored/hydrate
 * projections. Fixed id, text, sessionId scoping, childSessionId
 * suppression/retention and the terminal reason are compared across all three
 * paths for answer / clearTurn / failClosed / questions-with-child.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { AskRegistry } from "../../bridge/src/ask-registry.ts"
import {
	askPluginRecordType,
	type AskJournalWriteEvent,
} from "../../bridge/src/ask-journal.ts"
import type { AskOutboundFrame, AskSettledPayload } from "../../bridge/src/ask-frames.ts"
import {
	BridgeSessionSeam,
	bridgeReplayRowsToSeamEvents,
	bridgeReplayRowsToSeamTranscript,
	type BridgeEventFrame,
	type BridgeReplayRow,
	type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"
import type { SeamSessionEvent, SeamTurnCallbacks } from "../../tui-base/src/seams/session"
import { deriveAskOutcomeNotice } from "../src/client/ask-outcome.ts"

const SESSION = "sess-roundtrip"
const TURN = "turn-roundtrip"

type NoticeDetails = Record<string, unknown>
type StoredNotice = { kind: "notice"; id: string; text: string; final: true }

const cleanups: Array<() => void> = []
afterEach(() => {
	while (cleanups.length > 0) cleanups.pop()!()
})

/** Bounded poll for an async seam state (e.g. session.open binding). One helper
 *  for every wait in this file — no bare `Bun.sleep(n)` to observe a condition. */
async function waitFor(predicate: () => boolean, timeoutMs = 1000, intervalMs = 1): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms`)
		await Bun.sleep(intervalMs)
	}
}

interface Capture {
	registry: AskRegistry
	frames: AskOutboundFrame[]
	journal: AskJournalWriteEvent[]
}

function makeCapture(): Capture {
	const frames: AskOutboundFrame[] = []
	const journal: AskJournalWriteEvent[] = []
	const registry = new AskRegistry({
		askDeadlineMs: null,
		now: () => 1_700_000_000_000,
		sink: (frame) => { frames.push(frame) },
		journal: (event) => { journal.push(event) },
	})
	cleanups.push(() => registry.dispose())
	return { registry, frames, journal }
}

/** Only the real terminal frames the registry emitted through its sink. */
function settledFrames(frames: readonly AskOutboundFrame[]): AskSettledPayload[] {
	const out: AskSettledPayload[] = []
	for (const frame of frames) {
		if (frame.type === "ask.settled") out.push(frame.payload)
	}
	return out
}

/** The real terminal row the registry wrote for `eventId` (never synthesized). */
function terminalRow(journal: readonly AskJournalWriteEvent[], eventId: string): Record<string, unknown> {
	const row = journal.find((event) => event.eventId === eventId && event.kind !== "ask.requested")
	if (row === undefined) throw new Error(`registry wrote no terminal journal row for ${eventId}`)
	return row as Record<string, unknown>
}

/** Journal → replay rows with the production type mapping only; the payload IS
 *  the real journal event the registry wrote. */
function replayRows(journal: readonly AskJournalWriteEvent[]): BridgeReplayRow[] {
	return journal.map((event, i) => ({
		seq: i + 1,
		type: askPluginRecordType(event.kind),
		payload: event,
	}))
}

function makeLiveHarness() {
	const listeners: ((frame: BridgeEventFrame) => void)[] = []
	const events: SeamSessionEvent[] = []
	const transport: BridgeTransport = {
		async request(method) {
			if (method === "session.open") return { sessionId: SESSION, journalCursor: 0 }
			if (method === "session.send") return { turnId: TURN }
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
			for (const listener of [...listeners]) listener({ type, payload })
		},
		async bind() {
			const turn = seam.turn("hello", callbacks)
			await waitFor(() => seam.currentSessionId() === SESSION) // session.open binds SESSION before ask frames arrive
			return { turn } // holder: awaiting bind() must not adopt the turn promise
		},
	}
}

function eventNotices(events: readonly SeamSessionEvent[]): NoticeDetails[] {
	return events
		.filter((event) => event.type === "message.updated")
		.map((event) => event.details as NoticeDetails)
		.filter((details) => details.role === "notice" &&
			typeof details.id === "string" && String(details.id).startsWith("ask-outcome:"))
}

interface RoundTrip {
	live: NoticeDetails[]
	dead: NoticeDetails[]
	stored: StoredNotice[]
}

async function roundTrip(capture: Capture): Promise<RoundTrip> {
	const h = makeLiveHarness()
	const { turn } = await h.bind()
	// LIVE: feed every REAL registry frame in emission order (request, cancel,
	// settled) — only ask.settled produces a notice.
	for (const frame of capture.frames) h.emit(frame.type, frame.payload)
	const live = eventNotices(h.events)
	h.emit("turn.end", { turnId: TURN, text: "" })
	await turn

	// DEAD + stored: the same REAL journal rows, production type mapping only.
	const rows = replayRows(capture.journal)
	const dead = eventNotices(bridgeReplayRowsToSeamEvents(rows, SESSION))
	const stored = bridgeReplayRowsToSeamTranscript(rows, 0, SESSION)
		.filter((row): row is StoredNotice => row.kind === "notice")
	return { live, dead, stored }
}

function expectThreeWayNotice(rt: RoundTrip, eventId: string, text: string): void {
	const id = `ask-outcome:${eventId}`
	for (const notices of [rt.live, rt.dead]) {
		const matches = notices.filter((details) => details.id === id)
		expect(matches).toHaveLength(1)
		expect(matches[0]!.text).toBe(text)
		expect(matches[0]!.sessionID).toBe(SESSION)
	}
	const stored = rt.stored.filter((row) => row.id === id)
	expect(stored).toHaveLength(1)
	expect(stored[0]!.text).toBe(text)
}

describe("AskRegistry → wire/journal → live/DEAD/stored round-trip", () => {
	test("answer: real answered frame and journal row give one identical notice on all paths", async () => {
		const cap = makeCapture()
		const request = cap.registry.create(TURN, {
			sessionId: SESSION,
			kind: "approval",
			toolName: "bash",
			callId: "call-answer",
		})
		const result = cap.registry.answer(SESSION, {
			eventId: request.eventId,
			kind: "approval",
			verdict: "allowed-once",
			behavior: "once",
		})
		expect(result.ok).toBe(true)

		const settled = settledFrames(cap.frames)
		expect(settled).toHaveLength(1)
		expect(settled[0]!.eventId).toBe(request.eventId)
		expect(settled[0]!.reason).toBe("answered")
		expect(settled[0]!.outcome).toBe("approved")
		expect(settled[0]!.sessionId).toBe(SESSION)

		const terminal = terminalRow(cap.journal, request.eventId)
		expect(terminal.kind).toBe("ask.responded")
		expect(terminal.settleReason).toBe(settled[0]!.reason) // terminal-reason parity
		expect(terminal.outcome).toBe("approved")
		expect(terminal.source).toBe("answer")
		expect(terminal.sessionId).toBe(SESSION)

		const rt = await roundTrip(cap)
		expectThreeWayNotice(rt, request.eventId, "已收到该请求的回答")

		// Session scoping uses the real journal rows: an unbound stored call and
		// a different DEAD bind produce no notice at all.
		const rows = replayRows(cap.journal)
		expect(bridgeReplayRowsToSeamTranscript(rows, 0).some((row) => row.kind === "notice")).toBe(false)
		expect(eventNotices(bridgeReplayRowsToSeamEvents(rows, "another-session"))).toEqual([])
	})

	test("clearTurn: terminal reason stays turn-ended, not ask.cancel's host-abort", async () => {
		const cap = makeCapture()
		const request = cap.registry.create(TURN, {
			sessionId: SESSION,
			kind: "approval",
			toolName: "bash",
		})
		const settlements = cap.registry.clearTurn(TURN, "host-abort")
		expect(settlements).toHaveLength(1)
		expect(settlements[0]!.eventId).toBe(request.eventId)
		expect(settlements[0]!.outcome).toBe("cancelled")

		const settled = settledFrames(cap.frames)
		expect(settled).toHaveLength(1)
		expect(settled[0]!.eventId).toBe(request.eventId)
		expect(settled[0]!.reason).toBe("turn-ended")
		expect(settled[0]!.outcome).toBe("cancelled")
		expect(settled[0]!.sessionId).toBe(SESSION)
		const cancels = cap.frames.filter((frame) => frame.type === "ask.cancel")
		expect(cancels).toHaveLength(1)
		expect((cancels[0] as Extract<AskOutboundFrame, { type: "ask.cancel" }>).payload.reason)
			.toBe("host-abort")

		const terminal = terminalRow(cap.journal, request.eventId)
		expect(terminal.kind).toBe("ask.cancelled")
		expect(terminal.settleReason).toBe(settled[0]!.reason) // terminal-reason parity
		expect(terminal.reason).toBe("host-abort")
		expect(terminal.source).toBe("teardown")
		expect(terminal.outcome).toBe("cancelled")

		const rt = await roundTrip(cap)
		expectThreeWayNotice(rt, request.eventId, "回合结束时该请求已取消")
	})

	test("failClosed: no ask.request frame; no-channel notice on all paths", async () => {
		const cap = makeCapture()
		const failed = cap.registry.failClosed({
			turnId: TURN,
			sessionId: SESSION,
			kind: "approval",
			toolName: "bash",
			callId: "call-fail",
		})
		expect(failed.code).toBe("ASK_CHANNEL_UNAVAILABLE")
		expect(failed.settlement.outcome).toBe("unavailable")
		expect(cap.frames.some((frame) => frame.type === "ask.request")).toBe(false)
		expect(cap.journal.some((event) => event.kind === "ask.requested")).toBe(false)

		const settled = settledFrames(cap.frames)
		expect(settled).toHaveLength(1)
		expect(settled[0]!.eventId).toBe(failed.settlement.eventId)
		expect(settled[0]!.reason).toBe("no-channel")
		expect(settled[0]!.outcome).toBe("unavailable")
		expect(settled[0]!.sessionId).toBe(SESSION)

		const terminal = terminalRow(cap.journal, failed.settlement.eventId)
		expect(terminal.kind).toBe("ask.responded")
		expect(terminal.settleReason).toBe(settled[0]!.reason) // terminal-reason parity
		expect(terminal.source).toBe("fail-closed")
		expect(terminal.code).toBe("ASK_CHANNEL_UNAVAILABLE")

		const rt = await roundTrip(cap)
		expectThreeWayNotice(rt, failed.settlement.eventId, "没有可用投递渠道，该请求未完成")
	})

	test("questions: child ask keeps its notice on all paths; parent ask is suppressed", async () => {
		const cap = makeCapture()
		const questions = [
			{ id: "q1", prompt: "Proceed?", options: [{ label: "Yes" }, { label: "No" }] },
		]
		const child = cap.registry.create(TURN, {
			sessionId: SESSION,
			kind: "questions",
			childSessionId: "child-roundtrip",
			parentSessionId: SESSION,
			questions,
		})
		const parent = cap.registry.create(`${TURN}-parent`, {
			sessionId: SESSION,
			kind: "questions",
			questions,
		})
		expect(cap.registry.answer(SESSION, {
			eventId: child.eventId,
			kind: "questions",
			answers: [{ id: "q1", selected: ["Yes"] }],
		}).ok).toBe(true)
		expect(cap.registry.answer(SESSION, {
			eventId: parent.eventId,
			kind: "questions",
			answers: [{ id: "q1", selected: ["No"] }],
		}).ok).toBe(true)

		const settled = settledFrames(cap.frames)
		expect(settled).toHaveLength(2)
		const childSettled = settled.find((frame) => frame.eventId === child.eventId)!
		const parentSettled = settled.find((frame) => frame.eventId === parent.eventId)!
		expect(childSettled.reason).toBe("answered")
		expect(childSettled.kind).toBe("questions")
		expect(childSettled.outcome).toBe("approved")
		expect(childSettled.childSessionId).toBe("child-roundtrip")
		expect(parentSettled.reason).toBe("answered")
		expect(parentSettled.childSessionId).toBeUndefined()

		const childTerminal = terminalRow(cap.journal, child.eventId)
		expect(childTerminal.kind).toBe("ask.responded")
		expect(childTerminal.askKind).toBe("questions")
		expect(childTerminal.childSessionId).toBe("child-roundtrip")
		expect(childTerminal.settleReason).toBe(childSettled.reason) // terminal-reason parity
		expect(childTerminal.outcome).toBe("approved")
		expect(childTerminal.answers).toEqual({ count: 1, selections: [1] })
		const parentTerminal = terminalRow(cap.journal, parent.eventId)
		expect(parentTerminal.childSessionId).toBeUndefined()
		expect(parentTerminal.settleReason).toBe(parentSettled.reason)

		const rt = await roundTrip(cap)
		expectThreeWayNotice(rt, child.eventId, "已收到该请求的回答")
		for (const notices of [rt.live, rt.dead]) {
			const kept = notices.filter((details) => details.id === `ask-outcome:${child.eventId}`)
			expect(kept).toHaveLength(1)
			expect(kept[0]!.childSessionId).toBe("child-roundtrip")
			expect(notices.some((details) => details.id === `ask-outcome:${parent.eventId}`)).toBe(false)
		}
		// Stored rows have no childSessionId column; suppression is by fixed id.
		expect(rt.stored.some((row) => row.id === `ask-outcome:${parent.eventId}`)).toBe(false)
	})

	test("strong-kill orphan: real requested journal + same-turn host turn/end yields the fixed-id orphan notice on stored/events, zero on live", async () => {
		const cap = makeCapture()
		// create() writes ask.requested and emits ask.request, but NOTHING settles
		// it: no answer / clearTurn / failClosed / deadline (askDeadlineMs: null).
		const request = cap.registry.create(TURN, {
			sessionId: SESSION,
			kind: "approval",
			toolName: "bash",
		})

		// The REAL requested row the registry wrote — never a synthesized row.
		const requested = cap.journal.find(
			(event) => event.eventId === request.eventId && event.kind === "ask.requested",
		)
		if (requested === undefined) throw new Error(`registry wrote no ask.requested row for ${request.eventId}`)
		// Use the journal's own turnId (post-redactIdentifier) for the host
		// turn/end, so the orphan join keys on exactly what persistence recorded.
		const realTurnId = requested.turnId
		expect(typeof realTurnId).toBe("string")
		expect(cap.frames.some((frame) => frame.type === "ask.settled")).toBe(false)

		// LIVE: only the real frames (ask.request) are emitted; no ask.settled
		// frame exists, so the live seam produces no ask-outcome notice.
		const h = makeLiveHarness()
		const { turn } = await h.bind()
		for (const frame of cap.frames) h.emit(frame.type, frame.payload)
		expect(eventNotices(h.events)).toEqual([])
		h.emit("turn.end", { turnId: TURN, text: "" })
		await turn

		// DEAD + stored: the real requested row (seq 1), a user row, then a HOST
		// turn/end replay row on the SAME turnId, then another user row. The user
		// payload shape is the one used by ask-outcome-hydrate.test.ts userRow.
		const before = "before orphan"
		const after = "after orphan"
		const userRow = (seq: number, text: string): BridgeReplayRow => ({
			seq,
			type: "user/message",
			payload: { content: [{ type: "text", text }], source: { kind: "user" } },
		})
		const rows: BridgeReplayRow[] = [
			...replayRows(cap.journal), // real ask.requested, seq 1
			userRow(99, before),
			{ seq: 100, type: "turn/end", payload: { turnId: realTurnId, turn: 1 } },
			userRow(101, after),
		]
		const id = `ask-outcome:${request.eventId}`
		const events = eventNotices(bridgeReplayRowsToSeamEvents(rows, SESSION))
		const allStored = bridgeReplayRowsToSeamTranscript(rows, 0, SESSION)
		const stored = allStored.filter((row): row is StoredNotice => row.kind === "notice")

		// The PUBLIC single derivation, with orphan:true and anchorSeq at the
		// turn/end seq, is the shared source of id/text for all projection paths.
		const derived = deriveAskOutcomeNotice({
			eventId: request.eventId,
			sessionId: SESSION,
			anchorSeq: 100,
			orphan: true,
			askKind: "approval",
		})!
		expect(derived.id).toBe(id)
		expect(derived.text).toBe("未收到该请求的回答结果")
		// events: assert id/text only (no wire anchorSeq coupling).
		expect(events.filter((details) => details.id === id)).toHaveLength(1)
		expect(events[0]!.text).toBe(derived.text)
		expect(stored.filter((row) => row.id === id)).toHaveLength(1)
		expect(stored[0]!.text).toBe(derived.text)
		// The notice lands between the two user rows, anchored at the turn/end.
		expect(allStored.map((row) => (row.kind === "notice" ? `notice:${row.id}` : row.text)))
			.toEqual([before, `notice:${id}`, after])
		// The orphan text names no closed reason (A29 / U1).
		expect(stored[0]!.text).not.toMatch(/answered|rejected|timeout|aborted/)
	})

	test("orphan negative: a real requested journal with NO turn/end yields zero stored notice", async () => {
		const cap = makeCapture()
		const request = cap.registry.create(TURN, {
			sessionId: SESSION,
			kind: "approval",
			toolName: "bash",
		})
		const rows = replayRows(cap.journal) // requested only; no host turn/end
		expect(bridgeReplayRowsToSeamTranscript(rows, 0, SESSION)
			.filter((row) => row.kind === "notice")).toEqual([])
		expect(eventNotices(bridgeReplayRowsToSeamEvents(rows, SESSION))
			.some((details) => details.id === `ask-outcome:${request.eventId}`)).toBe(false)
	})
})
