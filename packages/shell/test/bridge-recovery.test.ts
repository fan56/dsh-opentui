/**
 * A4+A5 — post-DEAD session recovery: `session.open{resume}` + journal replay.
 *
 * All frames are faked; no host/child process. `recoverBridgeSession()` is the
 * single orchestration entry (transport.recover → seam.recoverSession), so one
 * call exercises the whole §2.3 sequence and every frame is assertable.
 */
import { describe, expect, test } from "bun:test"
import {
	BridgeProtocolError,
	BridgeSessionSeam,
	type BridgeEventFrame,
	type BridgeReplayRow,
} from "../src/client/bridge-session-seam.ts"
import {
	recoverBridgeSession,
	type RecoverableBridgeTransport,
} from "../src/client/seam-bootstrap.ts"

// ---------------------------------------------------------------------------
// Fake transport / seam harness
// ---------------------------------------------------------------------------

type Reply =
	| { kind: "value"; value: unknown }
	| { kind: "error"; error: unknown }
	| { kind: "fn"; fn: (params?: Record<string, unknown>) => Reply }

interface LogCall {
	level: "info" | "warn" | "error"
	args: unknown[]
}

const value = (v: unknown): Reply => ({ kind: "value", value: v })
const fail = (code: string, message = code): Reply => ({
	kind: "error",
	error: new BridgeProtocolError(code, message, { holder: "other" }),
})

function makeHarness() {
	const requests: { method: string; params?: Record<string, unknown> }[] = []
	const replies = new Map<string, Reply>()
	const frameListeners: ((frame: BridgeEventFrame) => void)[] = []
	const seamEvents: { type: string; details: unknown }[] = []
	const logs: LogCall[] = []

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
			// A marker so the test can assert handshake-before-session.open.
			requests.push({ method: "__recover__" })
		},
	}
	const logger = {
		info(...args: unknown[]) { logs.push({ level: "info", args }) },
		warn(...args: unknown[]) { logs.push({ level: "warn", args }) },
		error(...args: unknown[]) { logs.push({ level: "error", args }) },
	}
	const seam = new BridgeSessionSeam({ transport, ctx: { logger } })
	seam.onSessionEvent((event) => seamEvents.push(event))

	return {
		seam,
		transport,
		requests,
		replies,
		seamEvents,
		logs,
		/** A6: drive a bridge→client event frame through the seam's onEvent pump. */
		emitFrame(type: string, payload: unknown) {
			for (const l of [...frameListeners]) l({ type, payload })
		},
		recover: () => recoverBridgeSession({ transport, seam }),
		openRequest: () => requests.find((r) => r.method === "session.open"),
		replayRequests: () => requests.filter((r) => r.method === "journal.replay"),
		replayFroms: () => requests
			.filter((r) => r.method === "journal.replay")
			.map((r) => (r.params as { from: number }).from),
		recoveredEvent: () => seamEvents.find((e) => e.type === "bridge.recovered"),
		warnFor: (needle: string) => logs.filter(
			(l) => l.level === "warn" && l.args.map(String).join(" ").includes(needle),
		),
	}
}

/** text row on the wire — the projection the seam already uses. */
function textRow(seq: number, text: string): BridgeReplayRow {
	return {
		seq,
		type: "assistant/message",
		payload: { message: { content: [{ type: "text", text }] } },
	}
}

function setPages(h: ReturnType<typeof makeHarness>, pages: { rows: BridgeReplayRow[]; cursor: number }[]): void {
	let i = 0
	h.replies.set("journal.replay", {
		kind: "fn",
		fn() {
			const page = pages[Math.min(i, pages.length - 1)]!
			i += 1
			return value(page)
		},
	})
}

async function stageResume(h: ReturnType<typeof makeHarness>, id: string): Promise<void> {
	h.seam.resumeSession(id)
	h.replies.set("session.open", value({ sessionId: id }))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("A4+A5: post-DEAD recovery orchestration", () => {
	test("recover() handshake first, then automatic session.open{resume,id} (frame args asserted)", async () => {
		const h = makeHarness()
		await stageResume(h, "s-42")
		setPages(h, [{ rows: [], cursor: 1 }])

		const result = await h.recover()

		expect(h.requests[0]?.method).toBe("__recover__")
		expect(h.openRequest()?.params).toEqual({ mode: "resume", id: "s-42" })
		expect(result.state).toBe("attached")
		expect(h.seam.recoveryState()).toBe("attached")
		expect(h.seam.status()).toMatchObject({
			connection: "connected", sessionAttached: true, bridge: "ready",
		})
		expect(h.seam.currentSessionId()).toBe("s-42")
	})

	test("replay from=lastAppliedSeq+1 on a later recovery; no lastSeq → from=1", async () => {
		const h = makeHarness()
		await stageResume(h, "s-1")
		setPages(h, [{ rows: [textRow(1, "a"), textRow(2, "b"), textRow(3, "c")], cursor: 4 }])

		const first = await h.recover()
		expect(first.applied).toBe(3)
		expect(h.replayFroms()).toEqual([1]) // no lastSeq → full log from 1

		setPages(h, [{ rows: [textRow(4, "d")], cursor: 5 }])
		const second = await h.recover()
		expect(h.replayFroms().at(-1)).toBe(4) // lastAppliedSeq(3) + 1
		expect(second.applied).toBe(1)
	})

	test("multi-page drain fetches every page (from advances by page max seq)", async () => {
		const h = makeHarness()
		await stageResume(h, "s-pages")
		setPages(h, [
			{ rows: [textRow(1, "a"), textRow(2, "b")], cursor: 6 },
			{ rows: [textRow(3, "c"), textRow(4, "d")], cursor: 6 },
			{ rows: [textRow(5, "e")], cursor: 6 },
		])

		const result = await h.recover()
		expect(h.replayFroms()).toEqual([1, 3, 5])
		expect(result.applied).toBe(5)
		expect(result.cursor).toBe(6)
	})

	test("duplicate seqs are dropped and out-of-order rows applied in seq order", async () => {
		const h = makeHarness()
		await stageResume(h, "s-sort")
		setPages(h, [
			{
				rows: [textRow(5, "E"), textRow(3, "C"), textRow(4, "D"), textRow(3, "C-dup")],
				cursor: 8,
			},
			{ rows: [textRow(3, "C-late"), textRow(6, "F"), textRow(7, "G")], cursor: 8 },
		])

		const result = await h.recover()
		expect(result.applied).toBe(5) // 3,4,5,6,7 — 3 counted once
		expect(result.rows.map((r) => r.text)).toEqual(["C", "D", "E", "F", "G"])
	})

	test("SESSION_LOCKED → transport READY + connected-not-attached state, no crash", async () => {
		const h = makeHarness()
		await stageResume(h, "s-locked")
		h.replies.set("session.open", fail("SESSION_LOCKED"))
		setPages(h, [{ rows: [], cursor: 1 }])

		const result = await h.recover()

		expect(result.state).toBe("locked")
		expect(result.error?.code).toBe("SESSION_LOCKED")
		expect(h.seam.recoveryState()).toBe("locked")
		expect(h.seam.status()).toMatchObject({
			connection: "connected", sessionAttached: false, bridge: "ready",
		})
		expect(h.seamEvents.some((e) => e.type === "bridge.recovery.locked")).toBe(true)
		expect(h.replayRequests()).toHaveLength(0) // no replay when not attached
		expect(h.requests.filter((r) => r.method === "__recover__")).toHaveLength(1) // no retry
	})

	test("ahead lastSeq is clamped to the journal max with a warn; never throws", async () => {
		const h = makeHarness()
		await stageResume(h, "s-ahead")
		setPages(h, [{ rows: [textRow(1, "a"), textRow(2, "b"), textRow(3, "c")], cursor: 4 }])
		await h.recover() // lastAppliedSeq = 3

		// The journal shrank to max=1 (cursor=2) while the client still has seq 3.
		setPages(h, [{ rows: [textRow(1, "a")], cursor: 2 }])
		const result = await h.recover()

		expect(result.state).toBe("attached")
		// First probe from=4 > cursor=2 is clamped; the clamp guard re-requests
		// from=2 and does not loop again.
		expect(h.replayFroms().slice(-2)).toEqual([4, 2])
		expect(h.warnFor("ahead of journal max")).toHaveLength(1)
	})

	test("non-LOCKED session.open failure → explicit failed state, no retry loop", async () => {
		const h = makeHarness()
		await stageResume(h, "s-fail")
		h.replies.set("session.open", fail("SESSION_NOT_FOUND"))
		setPages(h, [{ rows: [], cursor: 1 }])

		const result = await h.recover()

		expect(result.state).toBe("failed")
		expect(result.error?.code).toBe("SESSION_NOT_FOUND")
		expect(h.seam.recoveryState()).toBe("failed")
		expect(h.seam.status()).toMatchObject({ connection: "connected", sessionAttached: false })
		expect(h.seamEvents.some((e) => e.type === "bridge.recovery.failed")).toBe(true)
		expect(h.requests.filter((r) => r.method === "__recover__")).toHaveLength(1)
	})

	test("success emits one '已恢复，补齐 N 条事件' event with the correct N", async () => {
		const h = makeHarness()
		await stageResume(h, "s-notice")
		setPages(h, [{ rows: [textRow(1, "a"), textRow(2, "b")], cursor: 3 }])

		const result = await h.recover()
		const events = h.seamEvents.filter((e) => e.type === "bridge.recovered")
		expect(events).toHaveLength(1)
		expect(events[0]!.details).toMatchObject({
			sessionId: "s-notice", applied: 2, from: 1, cursor: 3,
		})
		expect((events[0]!.details as { message: string }).message).toContain("已恢复，补齐 2 条事件")
		expect(result.applied).toBe(2)
	})
})

// ---------------------------------------------------------------------------
// A6 — pendingSnapshot timing gate (blocky §2.3 step 6)
// ---------------------------------------------------------------------------

describe("A6: pendingSnapshot is applied only after the replay drain", () => {
	const SNAPSHOT_ASK = {
		eventId: "t9:ask-1",
		sessionId: "s-a6",
		kind: "questions",
		questions: [{ id: "q1", prompt: "Keep?", options: [{ label: "Yes" }] }],
	}

	test("snapshot arriving mid-drain is BUFFERED, then rebuilt after drain with askId preserved", async () => {
		const h = makeHarness()
		await stageResume(h, "s-a6")
		// Gate the answerer so the rebuilt card stays pending and assertable.
		let release!: (picks: { questionId: string; selected: string }[]) => void
		const gate = new Promise<{ questionId: string; selected: string }[]>((r) => { release = r })
		h.seam.registerAskProvider(async () => gate)

		// Push the reconnect snapshot from inside the journal.replay reply — i.e.
		// while recoverSession's drain is still in flight — and record whether
		// a card was (prematurely) rebuilt at that exact moment.
		let rebuiltAtReceive: string[] | undefined
		h.replies.set("journal.replay", {
			kind: "fn",
			fn() {
				h.emitFrame("ask.pending", { sessionId: "s-a6", asks: [SNAPSHOT_ASK] })
				rebuiltAtReceive = h.seam.pendingAsks().map((a) => a.eventId)
				return value({ rows: [], cursor: 1 })
			},
		})

		const result = await h.recover()
		await Bun.sleep(5) // let #answerAsk's provider microtask settle

		expect(result.state).toBe("attached")
		// TIMING GATE: no card at frame receipt (drain not done); rebuilt after.
		expect(rebuiltAtReceive).toEqual([])
		// The rebuilt card is present with the SAME askId (parseAskRequest preserves it).
		expect(h.seam.pendingAsks().map((a) => a.eventId)).toEqual(["t9:ask-1"])

		release([{ questionId: "q1", selected: "Yes" }])
		await Bun.sleep(5)

		// SAME askId flowed through the EXISTING ask.response frame path.
		const responses = h.requests.filter((r) => r.method === "ask.response")
		expect(responses).toHaveLength(1)
		expect(responses[0].params).toMatchObject({ eventId: "t9:ask-1", kind: "questions" })
	})

	test("empty snapshot rebuilds no card and does not crash", async () => {
		const h = makeHarness()
		await stageResume(h, "s-a6-empty")
		h.seam.registerAskProvider(async () => [{ questionId: "q1", selected: "Yes" }])

		h.replies.set("journal.replay", {
			kind: "fn",
			fn() {
				h.emitFrame("ask.pending", { sessionId: "s-a6-empty", asks: [] })
				return value({ rows: [], cursor: 1 })
			},
		})

		const result = await h.recover()
		await Bun.sleep(5)

		expect(result.state).toBe("attached")
		expect(h.seam.pendingAsks()).toEqual([])
		expect(h.requests.filter((r) => r.method === "ask.response")).toHaveLength(0)
	})
})
