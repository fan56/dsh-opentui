/**
 * A7 (blocky 2.4) — a turn in flight when the bridge died gets a LOCAL
 * INTERRUPTED marker ONLY when the durable journal stays silent about its
 * terminal. All frames are faked; the journal is read-only in this file.
 *
 *  - journal has a terminal (completed / aborted / error) → no marker
 *  - journal silent → exactly one marker, correct turnId, partial kept
 *  - no in-flight turn at DEAD → no marker
 *  - `seq:null` + `source:"local"` provenance; NO journal write call
 */
import { describe, expect, test } from "bun:test"
import {
	BridgeProtocolError,
	BridgeSessionSeam,
	journalHasTurnTerminal,
	lastJournalTurnTerminal,
	type BridgeEventFrame,
	type BridgeReplayRow,
} from "../src/client/bridge-session-seam.ts"
import {
	recoverBridgeSession,
	type RecoverableBridgeTransport,
} from "../src/client/seam-bootstrap.ts"

type Reply =
	| { kind: "value"; value: unknown }
	| { kind: "error"; error: unknown }
	| { kind: "fn"; fn: (params?: Record<string, unknown>) => Reply }

const value = (v: unknown): Reply => ({ kind: "value", value: v })

function makeHarness() {
	const requests: { method: string; params?: Record<string, unknown> }[] = []
	const replies = new Map<string, Reply>()
	const frameListeners: ((frame: BridgeEventFrame) => void)[] = []
	const seamEvents: { type: string; details: unknown }[] = []
	const transport: RecoverableBridgeTransport = {
		async request(method, params) {
			requests.push({ method, params })
			const reply = replies.get(method)
			if (reply === undefined) return {}
			const r = reply.kind === "fn" ? reply.fn(params) : reply
			if (r.kind === "error") throw r.error
			return r.value
		},
		onEvent(listener) {
			frameListeners.push(listener)
			return () => {
				const i = frameListeners.indexOf(listener)
				if (i >= 0) frameListeners.splice(i, 1)
			}
		},
		async recover() {
			requests.push({ method: "__recover__" })
		},
	}
	const logger = { info() {}, warn() {}, error() {} }
	const seam = new BridgeSessionSeam({ transport, ctx: { logger } })
	seam.onSessionEvent((event) => seamEvents.push(event))
	return {
		seam,
		requests,
		replies,
		seamEvents,
		emitFrame(type: string, payload: unknown) {
			for (const l of [...frameListeners]) l({ type, payload })
		},
		recover: () => recoverBridgeSession({ transport, seam }),
		interrupted: () => seamEvents.filter((e) => e.type === "bridge.turn.interrupted"),
		/** A7 red line: the client MUST NOT persist its inference anywhere. */
		journalWrites: () => requests.filter((r) =>
			/append|journal\.(write|append|commit)|session\.append/i.test(r.method),
		),
		terminals: () => seamEvents.filter((e) => e.type === "bridge.turn.terminal"),
	}
}

const textRow = (seq: number, text: string): BridgeReplayRow => ({
	seq,
	type: "assistant/message",
	payload: { message: { content: [{ type: "text", text }] } },
})
const startRow = (seq: number, turn: number): BridgeReplayRow => ({
	seq,
	type: "turn/start",
	payload: { turn },
})
const terminalRow = (seq: number, turn: number, kind: string): BridgeReplayRow => ({
	seq,
	type: "turn/end",
	payload: { turn, reason: { kind } },
})

function setPages(h: ReturnType<typeof makeHarness>, rows: BridgeReplayRow[], cursor: number): void {
	h.replies.set("journal.replay", { kind: "fn", fn: () => value({ rows, cursor }) })
}

async function stageResume(h: ReturnType<typeof makeHarness>, id: string): Promise<void> {
	h.seam.resumeSession(id)
	h.replies.set("session.open", value({ sessionId: id }))
}

/** Crash a live turn after one partial text delta. turn() stays awaiting a
 *  terminal frame that DEAD never delivers, so it is intentionally NOT awaited
 *  (an async helper that returned it would flatten + hang the test). */
async function crashMidTurn(
	h: ReturnType<typeof makeHarness>,
	turnId: string,
	partial: string,
): Promise<void> {
	h.replies.set("session.send", value({ turnId }))
	void h.seam.turn("question", {
		onThinkingDelta() {},
		onContentDelta() {},
		onError() {},
		async onApprove() { return "allowed-once" },
	})
	await Bun.sleep(0) // let session.send resolve and install #inFlightTurnId
	h.emitFrame("turn.token", { turnId, kind: "text", text: partial })
	h.emitFrame("bridge.dead", { stage: "runtime", code: 1, signal: null, message: "crash" })
}

/** Same as crashMidTurn but hands back the pending turn() promise so a test can
 *  assert recovery actually settled it (spinner / live-row finalize). The
 *  promise rides in a HOLDER object: an `async` helper returning it directly
 *  would flatten + await it here and deadlock (recovery has not run yet). */
function crashMidTurnTracked(
	h: ReturnType<typeof makeHarness>,
	turnId: string,
	partial: string,
): { pending: Promise<void>; ready: Promise<void> } {
	h.replies.set("session.send", value({ turnId }))
	const pending = h.seam.turn("question", {
		onThinkingDelta() {},
		onContentDelta() {},
		onError() {},
		async onApprove() { return "allowed-once" },
	})
	const ready = Bun.sleep(0).then(() => {
		h.emitFrame("turn.token", { turnId, kind: "text", text: partial })
		h.emitFrame("bridge.dead", { stage: "runtime", code: 1, signal: null, message: "crash" })
	})
	return { pending, ready }
}

const trackedTerminal = (seq: number, payload: unknown): BridgeReplayRow => ({
	seq, type: "turn/end", payload,
})

describe("A7: journalHasTurnTerminal (pure terminal detector)", () => {
	test("any turn/end reason counts; a bare turn/start does not", () => {
		expect(journalHasTurnTerminal([])).toBe(false)
		expect(journalHasTurnTerminal([startRow(1, 1)])).toBe(false)
		expect(journalHasTurnTerminal([startRow(1, 1), textRow(2, "partial")])).toBe(false)
		for (const kind of ["completed", "aborted", "error", "interrupted", "blocked", "forked"]) {
			expect(journalHasTurnTerminal([startRow(1, 1), terminalRow(2, 1, kind)])).toBe(true)
		}
	})
	test("a terminal from a PRIOR turn (below the last start) is not this turn's", () => {
		expect(journalHasTurnTerminal([terminalRow(1, 1, "completed"), startRow(2, 2)])).toBe(false)
	})
	test("lastJournalTurnTerminal picks the closing row with the journal payload intact", () => {
		const payload = { turn: 1, reason: { kind: "interrupted" }, usage: { prompt: 9 } }
		const term = trackedTerminal(25, payload)
		expect(lastJournalTurnTerminal([startRow(1, 1), terminalRow(2, 1, "completed"), term])).toEqual(term)
		expect(lastJournalTurnTerminal([startRow(1, 1), textRow(2, "partial")])).toBeUndefined()
		expect(lastJournalTurnTerminal([terminalRow(1, 1, "completed"), startRow(2, 2)])).toBeUndefined()
	})
})

describe("A7: local INTERRUPTED marker after DEAD recovery", () => {
	test("scenario 1 — journal has the host terminal → NO marker (no duplicate terminal)", async () => {
		const h = makeHarness()
		await stageResume(h, "s-term")
		await crashMidTurn(h, "t-term", "partial answer")
		setPages(h, [startRow(1, 1), terminalRow(2, 1, "completed"), textRow(3, "final answer")], 4)

		const result = await h.recover()

		expect(result.state).toBe("attached")
		expect(h.interrupted()).toHaveLength(0)
		// The host terminal reached the transcript through the normal replay.
		expect(result.rows.some((r) => r.text === "final answer")).toBe(true)
		expect(h.journalWrites()).toHaveLength(0)
	})

	test("scenario 2 — journal silent → exactly ONE marker, correct turnId, partial kept", async () => {
		const h = makeHarness()
		await stageResume(h, "s-silent")
		await crashMidTurn(h, "t-silent", "partial answer")
		setPages(h, [startRow(1, 1), textRow(2, "partial answer")], 3)

		const result = await h.recover()

		expect(result.state).toBe("attached")
		const marks = h.interrupted()
		expect(marks).toHaveLength(1)
		expect(marks[0]!.details).toMatchObject({
			sessionID: "s-silent",
			turnId: "t-silent",
			partial: "partial answer",
			code: "INTERRUPTED",
			seq: null,
			source: "local",
		})
		// The partial output is NOT silently dropped: replay still projects it.
		expect(result.rows.some((r) => r.text === "partial answer")).toBe(true)
		// Red line: a client inference is never written back to the journal.
		expect(h.journalWrites()).toHaveLength(0)
		// One marker only — a second recovery does not re-paint it.
		await h.recover()
		expect(h.interrupted()).toHaveLength(1)
	})

	test("scenario 3 — no in-flight turn at DEAD → NO marker", async () => {
		const h = makeHarness()
		await stageResume(h, "s-idle")
		h.emitFrame("bridge.dead", { stage: "runtime", code: 1, signal: null, message: "idle crash" })
		setPages(h, [], 1)

		const result = await h.recover()

		expect(result.state).toBe("attached")
		expect(h.interrupted()).toHaveLength(0)
		expect(h.journalWrites()).toHaveLength(0)
	})

	test("submit ACK carries the turnId and text (no client inputId on the wire)", async () => {
		const h = makeHarness()
		await stageResume(h, "s-ack")
		await crashMidTurn(h, "t-ack", "x")
		const acks = h.seamEvents.filter((e) => e.type === "bridge.input.acked")
		expect(acks).toHaveLength(1)
		expect(acks[0]!.details).toMatchObject({
			sessionID: "s-ack", turnId: "t-ack", text: "question",
		})
		// session.send only carries { text } — there is no inputId to key on.
		const send = h.requests.find((r) => r.method === "session.send")
		expect(Object.keys(send?.params ?? {})).toEqual(["text"])
	})

	test("ABORTED host terminal also suppresses the marker (no user-cancel misread)", async () => {
		const h = makeHarness()
		await stageResume(h, "s-aborted")
		await crashMidTurn(h, "t-aborted", "p")
		setPages(h, [startRow(1, 1), terminalRow(2, 1, "aborted")], 3)
		await h.recover()
		expect(h.interrupted()).toHaveLength(0)
	})
})

describe("replay terminal feeds back to the live turn state", () => {
	test("journal terminal finalizes the dead turn once, with the journal reason/payload, no INTERRUPTED duplicate", async () => {
		const h = makeHarness()
		await stageResume(h, "s-live-terminal")
		const { pending, ready } = crashMidTurnTracked(h, "t-live", "partial answer")
		await ready
		const payload = { turn: 1, reason: { kind: "interrupted", message: "killed by operator" }, usage: { prompt: 3 } }
		setPages(h, [startRow(1, 1), trackedTerminal(25, payload)], 26)

		const result = await h.recover()

		expect(result.state).toBe("attached")
		const terms = h.terminals()
		expect(terms).toHaveLength(1)
		expect(terms[0]!.details).toMatchObject({
			sessionID: "s-live-terminal",
			turnId: "t-live",
			seq: 25,
			terminalType: "turn/end",
			source: "journal",
		})
		// reason/payload are the HOST's journal shape, verbatim.
		expect((terms[0]!.details as { reason: unknown }).reason).toEqual({ kind: "interrupted", message: "killed by operator" })
		expect((terms[0]!.details as { payload: unknown }).payload).toEqual(payload)
		// No duplicate local terminal, no journal write.
		expect(h.interrupted()).toHaveLength(0)
		expect(h.journalWrites()).toHaveLength(0)
		// The live turn state is settled: status idle AND the pending turn()
		// waiter resolved (which is what closes the spinner in the view).
		expect(h.seam.status().turn).toBe("idle")
		const settled = await Promise.race([
			pending.then(() => "settled"),
			Bun.sleep(50).then(() => "timeout"),
		])
		expect(settled).toBe("settled")

		// A second recovery must NOT finalize twice (#deadInFlight was cleared).
		setPages(h, [{ seq: 26, type: "assistant/message", payload: { message: { content: [{ type: "text", text: "later" }] } } }], 27)
		await h.recover()
		expect(h.terminals()).toHaveLength(1)
	})

	test("no DEAD in-flight turn → replay terminal is NOT fed back to a live turn", async () => {
		const h = makeHarness()
		await stageResume(h, "s-running")
		h.replies.set("session.send", value({ turnId: "t-running" }))
		const pending = h.seam.turn("question", {
			onThinkingDelta() {}, onContentDelta() {}, onError() {}, async onApprove() { return "allowed-once" },
		})
		await Bun.sleep(0)
		h.emitFrame("turn.token", { turnId: "t-running", kind: "text", text: "still running" })
		setPages(h, [startRow(1, 1), terminalRow(2, 1, "completed")], 3)

		await h.recover()

		expect(h.terminals()).toHaveLength(0)
		const state = await Promise.race([
			pending.then(() => "settled"),
			Bun.sleep(30).then(() => "still-pending"),
		])
		expect(state).toBe("still-pending")
		// Cleanup the intentionally-pending turn so the test exits cleanly.
		h.emitFrame("turn.end", { turnId: "t-running", reason: { kind: "completed" } })
	})
})
