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

// ---------------------------------------------------------------------------
// oldfox 复审 P1-1: a `bridge.dead` frame leaves turn()'s waiter SUSPENDED.
// Every recovery exit (silent INTERRUPTED / failed / locked) and newSession()
// must settle it, or busy wedges and the next turn() throws TURN_REENTRANT.
// ---------------------------------------------------------------------------

const deadCallbacks = () => ({
	onThinkingDelta() {},
	onContentDelta() {},
	onError() {},
	async onApprove() { return "allowed-once" },
})

const settledWithin = async (p: Promise<void>, ms = 60): Promise<boolean> =>
	(await Promise.race([p.then(() => "ok"), Bun.sleep(ms).then(() => "timeout")])) === "ok"

describe("P1-1: DEAD leaves turn() suspended — every exit settles it", () => {
	test("a) journal silent → crash → recover settles turn() (no hang)", async () => {
		const h = makeHarness()
		await stageResume(h, "s-p1-silent")
		const { pending, ready } = crashMidTurnTracked(h, "t-p1-silent", "partial answer")
		await ready
		setPages(h, [startRow(1, 1), textRow(2, "partial answer")], 3)

		const result = await h.recover()

		expect(result.state).toBe("attached")
		expect(h.interrupted()).toHaveLength(1)
		expect(await settledWithin(pending)).toBe(true)
		expect(h.seam.status().turn).toBe("idle")
	})

	test("b) after silent recovery the next message submits (busy zero, no TURN_REENTRANT)", async () => {
		const h = makeHarness()
		await stageResume(h, "s-p1-next")
		const { pending, ready } = crashMidTurnTracked(h, "t-old", "p")
		await ready
		setPages(h, [startRow(1, 1), textRow(2, "p")], 3)
		await h.recover()
		expect(await settledWithin(pending)).toBe(true)
		expect(h.seam.status().turn).toBe("idle")

		h.replies.set("session.send", value({ turnId: "t-new" }))
		const next = h.seam.turn("follow up", deadCallbacks())
		await Bun.sleep(0)
		// The new turn claimed the single slot cleanly (old generation released).
		expect(h.requests.filter((r) => r.method === "session.send")).toHaveLength(2)
		h.emitFrame("turn.token", { turnId: "t-new", kind: "text", text: "new turn" })
		expect(h.seam.status().turn).toBe("running")
		h.emitFrame("turn.end", { turnId: "t-new", reason: { kind: "completed" } })
		await next
		expect(h.seam.status().turn).toBe("idle")
	})

	test("c) locked recovery settles the turn; /new escape submits a fresh turn", async () => {
		const h = makeHarness()
		await stageResume(h, "s-p1-locked")
		const { pending, ready } = crashMidTurnTracked(h, "t-locked", "p")
		await ready
		h.replies.set("session.open", { kind: "error", error: new BridgeProtocolError("SESSION_LOCKED", "held") })

		const result = await h.recover()

		expect(result.state).toBe("locked")
		expect(await settledWithin(pending)).toBe(true)
		// /new escape: settle + stage a fresh session, then submit works.
		h.seam.newSession()
		h.replies.set("session.open", value({ sessionId: "s-fresh" }))
		h.replies.set("session.send", value({ turnId: "t-fresh" }))
		const next = h.seam.turn("fresh", deadCallbacks())
		await Bun.sleep(0)
		expect(h.requests.filter((r) => r.method === "session.send")).toHaveLength(2)
		h.emitFrame("turn.end", { turnId: "t-fresh", reason: { kind: "completed" } })
		await next
		expect(h.seam.status().turn).toBe("idle")
	})

	test("d) failed recovery settles the turn; newSession escape works too", async () => {
		const h = makeHarness()
		await stageResume(h, "s-p1-failed")
		const { pending, ready } = crashMidTurnTracked(h, "t-failed", "p")
		await ready
		h.replies.set("session.open", { kind: "error", error: new Error("spawn exploded") })

		const result = await h.recover()

		expect(result.state).toBe("failed")
		expect(await settledWithin(pending)).toBe(true)
		h.seam.newSession()
		h.replies.set("session.open", value({ sessionId: "s-fresh2" }))
		h.replies.set("session.send", value({ turnId: "t-fresh2" }))
		const next = h.seam.turn("fresh", deadCallbacks())
		await Bun.sleep(0)
		expect(h.requests.filter((r) => r.method === "session.send")).toHaveLength(2)
		h.emitFrame("turn.end", { turnId: "t-fresh2", reason: { kind: "completed" } })
		await next
		expect(h.seam.status().turn).toBe("idle")
	})

	test("e) a normal in-flight turn is NOT settled by the DEAD-path guards", async () => {
		const h = makeHarness()
		await stageResume(h, "s-p1-normal")
		h.replies.set("session.send", value({ turnId: "t-normal" }))
		const running = h.seam.turn("live", deadCallbacks())
		await Bun.sleep(0)
		h.emitFrame("turn.token", { turnId: "t-normal", kind: "text", text: "streaming" })

		expect(await settledWithin(running, 30)).toBe(false)
		expect(h.seam.status().turn).toBe("running")
		h.emitFrame("turn.end", { turnId: "t-normal", reason: { kind: "completed" } })
		await running
		expect(h.seam.status().turn).toBe("idle")
	})
})

describe("P2-1: later writer's turn/start cannot steal our terminal", () => {
	test("unit: startOutsideWindow mode returns the pre-start terminal (seq 5), not the later turn's", () => {
		const rows: BridgeReplayRow[] = [
			{ seq: 5, type: "turn/end", payload: { turn: 1, reason: { kind: "completed" } } }, // ours; start before window
			{ seq: 6, type: "turn/start", payload: { turn: 2 } }, // other writer
			{ seq: 7, type: "turn/error", payload: { turn: 2, message: "other failed" } }, // other's terminal
		]
		expect(lastJournalTurnTerminal(rows, true)?.seq).toBe(5)
		// Default (start-in-window) association is unchanged.
		expect(lastJournalTurnTerminal(rows)?.seq).toBe(7)
	})

	test("e2e: recovery feeds back OUR seq-5 terminal, not the other writer's", async () => {
		const h = makeHarness()
		await stageResume(h, "s-p2-1")
		const { pending, ready } = crashMidTurnTracked(h, "t-p2-1", "p")
		await ready
		setPages(h, [
			{ seq: 5, type: "turn/end", payload: { turn: 1, reason: { kind: "completed" } } },
			{ seq: 6, type: "turn/start", payload: { turn: 2 } },
			{ seq: 7, type: "turn/error", payload: { turn: 2, message: "other failed" } },
		], 8)

		await h.recover()

		const terms = h.terminals()
		expect(terms).toHaveLength(1)
		expect(terms[0]!.details).toMatchObject({ turnId: "t-p2-1", seq: 5, source: "journal" })
		expect(h.interrupted()).toHaveLength(0)
		expect(await settledWithin(pending)).toBe(true)
	})
})
