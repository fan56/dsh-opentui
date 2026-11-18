/**
 * BridgeSessionSeam unit tests — first batch (12 members).
 *
 * Every degrade class from ticket §6 D3 is pinned with a NON-TRIVIAL
 * assertion (exact projected rows / exact log calls / exact error codes),
 * not a "does not throw" smoke check:
 *   - sync members  → degraded value + logger.warn, never a throw
 *   - async members → rejected BridgeProtocolError(code=UNSUPPORTED)
 *   - listSessions  → success projection AND UNSUPPORTED pass-through (no [])
 *   - transcript    → {seq,type,payload} → SeamTranscriptRow with skip as ROW
 *                     count (never a seq bound), tool/ask pairing intact
 */
import { describe, expect, test } from "bun:test"
import {
	BridgeProtocolError,
	BridgeSessionSeam,
	bridgeReplayRowsToSeamTranscript,
	projectBridgeEvent,
	projectBridgeSessionList,
	type BridgeEventFrame,
	type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type Reply =
	| { kind: "value"; value: unknown }
	| { kind: "error"; error: unknown }
	| { kind: "fn"; fn: (params?: Record<string, unknown>) => Reply }

interface LogCall {
	level: "info" | "warn" | "error"
	args: unknown[]
}

function makeHarness() {
	const requests: { method: string; params?: Record<string, unknown> }[] = []
	const replies = new Map<string, Reply>()
	const eventListeners: ((frame: BridgeEventFrame) => void)[] = []
	const logs: LogCall[] = []
	const unsubCalls: number[] = [0]

	const transport: BridgeTransport = {
		async request(method, params) {
			requests.push({ method, params })
			let reply = replies.get(method)
			if (reply === undefined) return {}
			if (reply.kind === "fn") reply = reply.fn(params)
			if (reply.kind === "error") throw reply.error
			return reply.value
		},
		onEvent(listener) {
			eventListeners.push(listener)
			return () => {
				unsubCalls[0] += 1
				const i = eventListeners.indexOf(listener)
				if (i >= 0) eventListeners.splice(i, 1)
			}
		},
	}

	const logger = {
		info(...args: unknown[]) { logs.push({ level: "info", args }) },
		warn(...args: unknown[]) { logs.push({ level: "warn", args }) },
		error(...args: unknown[]) { logs.push({ level: "error", args }) },
	}

	const seam = new BridgeSessionSeam({ transport, ctx: { logger } })

	return {
		seam,
		requests,
		replies,
		logs,
		unsubCalls,
		emit(frame: BridgeEventFrame) {
			for (const l of [...eventListeners]) l(frame)
		},
		warnFor(member: string) {
			return logs.filter((l) => l.level === "warn" && l.args.map(String).join(" ").includes(member))
		},
		lastRequest(method: string) {
			return [...requests].reverse().find((r) => r.method === method)
		},
	}
}

const unsupportedError = (capability: string) =>
	new BridgeProtocolError("UNSUPPORTED", `${capability} not available`, { capability })

// Real host session/list wire rows — the exact shape the host controller
// returns (ADR-0010 §88-89 / bridge session-list.test.ts:192-219): title at
// projections.values.title, NO top-level `title`/`sizeBytes`. A top-level
// sizeBytes is not on the wire; the projection's sizeBytes arm is defensive
// only, so a fake carrying it would make the assertion spin (P2-6).
const WIRE_ROWS = [
	{
		sessionId: "s-newest",
		updatedAt: 1700000000000,
		agentAvailable: false,
		formatStatus: "current",
		running: false,
		blank: false,
		cwd: "/work/alpha",
		projections: {
			kind: "cached",
			asOfSeq: 42,
			values: { title: "The newest conversation with a very long title that must be trimmed" },
		},
	},
	{
		sessionId: "s-child",
		updatedAt: 1699999999999,
		agentAvailable: true,
		running: false,
		blank: true,
		parentSessionId: "s-newest",
		origin: "subagent",
		projections: { kind: "sequenced", asOfSeq: 7, values: { title: "child" } },
	},
	{
		sessionId: "s-older",
		updatedAt: 1699000000000,
		agentAvailable: false,
		running: false,
		blank: true,
		projections: { kind: "cached", asOfSeq: 3, values: { title: "Older chat" } },
	},
	{ sessionId: "", updatedAt: 1, projections: { values: { title: "no id" } } },
	{ sessionId: "s-no-title" },
]

// ---------------------------------------------------------------------------
// listSessions: success projection + UNSUPPORTED pass-through
// ---------------------------------------------------------------------------

describe("listSessions", () => {
	test("projects host wire rows: subagent/id filters, title slice(40), pass-through fields, desc sort, limit", async () => {
		const h = makeHarness()
		h.replies.set("session.list", { kind: "value", value: { items: WIRE_ROWS } })

		const rows = await h.seam.listSessions(2)

		// P2-6: the fake wire has NO top-level sizeBytes (real host shape), so
		// the projection cannot invent one — the assertion is not spinning on
		// a field the real wire never sends.
		expect(WIRE_ROWS[0]).not.toHaveProperty("sizeBytes")
		expect(h.lastRequest("session.list")?.params).toBeUndefined()
		expect(rows).toEqual([
			{
				id: "s-newest",
				title: "The newest conversation with a very long title that must be trimmed".slice(0, 40),
				updatedAt: "1700000000000",
				cwd: "/work/alpha",
				blank: false,
			},
			{ id: "s-older", title: "Older chat", updatedAt: "1699000000000", blank: true },
		])
		// Non-trivial: limit actually dropped the third eligible row, and the
		// title was truncated to exactly 40 chars (not the raw 66-char string).
		expect(rows).toHaveLength(2)
		expect(rows[0].title).toHaveLength(40)
		expect(rows[0]).not.toHaveProperty("sizeBytes")
		expect(rows.map((r) => r.id)).not.toContain("s-child")
		expect(rows.map((r) => r.id)).not.toContain("s-no-title")
	})

	test("default limit is 12 and a session with no title gets an empty one", async () => {
		const h = makeHarness()
		h.replies.set("session.list", { kind: "value", value: { items: [{ sessionId: "x" }] } })
		expect(await h.seam.listSessions()).toEqual([{ id: "x", title: "" }])
	})

	test("UNSUPPORTED frame propagates as a rejected UNSUPPORTED error — never an empty list", async () => {
		const h = makeHarness()
		h.replies.set("session.list", { kind: "error", error: unsupportedError("session.list") })

		let caught: unknown
		try {
			await h.seam.listSessions()
		} catch (err) {
			caught = err
		}
		expect(caught).toBeInstanceOf(BridgeProtocolError)
		expect((caught as BridgeProtocolError).code).toBe("UNSUPPORTED")
		expect((caught as BridgeProtocolError).detail).toEqual({ capability: "session.list" })
	})

	test("projectBridgeSessionList is pure and keeps updatedAt as a string for localeCompare sort", () => {
		const rows = projectBridgeSessionList(
			[
				{ sessionId: "a", updatedAt: 100, projections: { values: { title: "A" } } },
				{ sessionId: "b", updatedAt: 300, projections: { values: { title: "B" } } },
			],
			12,
		)
		expect(rows.map((r) => r.id)).toEqual(["b", "a"])
		expect(rows[0].updatedAt).toBe("300")
	})
})

// ---------------------------------------------------------------------------
// storedTranscript: projection + skip/from non-equivalence
// ---------------------------------------------------------------------------

describe("storedTranscript", () => {
	const REPLAY_ROWS = [
		{ seq: 1, type: "user/message", payload: { content: [{ type: "text", text: "hello" }], source: { kind: "user" } } },
		{ seq: 3, type: "turn/start", payload: { turn: 1 } }, // non-human, consumes a seq
		{
			seq: 5,
			type: "tool/call",
			payload: { callId: "c1", name: "read", arguments: "{\"p\":1}" },
		},
		{
			seq: 6,
			type: "tool/result",
			payload: { callId: "c1", isError: false, output: "file body", message: { isError: false } },
		},
		{ seq: 9, type: "assistant/message", payload: { message: { content: [{ type: "text", text: "world" }] } } },
	]

	test("projects {seq,type,payload} rows through the remote journal→transcript rule", () => {
		const rows = bridgeReplayRowsToSeamTranscript(REPLAY_ROWS)
		expect(rows).toEqual([
			{ kind: "user", text: "hello", final: true },
			{ kind: "tool", text: "read", final: true, args: "{\"p\":1}", output: "\"file body\"", ok: true },
			{ kind: "assistant", text: "world", final: true },
		])
	})

	test("skip is a ROW COUNT, not a seq bound: skip=1 drops the user row despite the seq gap", () => {
		const rows = bridgeReplayRowsToSeamTranscript(REPLAY_ROWS, 1)
		expect(rows.map((r) => r.kind)).toEqual(["tool", "assistant"])
		// from=1 would have kept the user row; the row-count semantics do not.
		expect(rows.some((r) => r.kind === "user")).toBe(false)
	})

	test("seam.storedTranscript sends journal.replay WITHOUT from and slices locally by skip", async () => {
		const h = makeHarness()
		h.replies.set("journal.replay", { kind: "value", value: { rows: REPLAY_ROWS, cursor: 10 } })
		const rows = await h.seam.storedTranscript("sess-x", 1)
		const req = h.lastRequest("journal.replay")!
		expect(req.params).toEqual({ sessionId: "sess-x" })
		expect(req.params).not.toHaveProperty("from")
		// cursor (maxSeq+1=10) is NOT used as a row bound.
		expect(rows.map((r) => r.kind)).toEqual(["tool", "assistant"])
	})

	test("ask tool call+result merge into an ask row (remote pairing preserved)", () => {
		const rows = bridgeReplayRowsToSeamTranscript([
			{
				seq: 1,
				type: "tool/call",
				payload: {
					callId: "q1",
					name: "ask_user_question",
					arguments: JSON.stringify({ questions: [{ id: "q", question: "Go?", options: [{ label: "y" }, { label: "n" }] }] }),
				},
			},
			{
				seq: 2,
				type: "tool/result",
				payload: {
					callId: "q1",
					message: { content: [{ type: "text", text: JSON.stringify({ answers: [{ id: "q", selected: ["y"] }] }) }] },
				},
			},
		])
		expect(rows).toHaveLength(1)
		expect(rows[0].kind).toBe("ask")
		expect(rows[0].text).toBe("")
		expect((rows[0].entries ?? [])[0]?.question).toBe("Go?")
		expect((rows[0].entries ?? [])[0]?.selected).toEqual(["y"])
	})

	test("journal.replay UNSUPPORTED/other errors propagate (async member)", async () => {
		const h = makeHarness()
		h.replies.set("journal.replay", { kind: "error", error: unsupportedError("journal.replay") })
		await expect(h.seam.storedTranscript("s")).rejects.toMatchObject({ code: "UNSUPPORTED" })
	})
})

// ---------------------------------------------------------------------------
// SYNC members: degraded value + log, never a throw
// ---------------------------------------------------------------------------

describe("sync degrade values + logs", () => {
	test("status before handshake returns connected=disconnected/idle and logs a degrade", () => {
		const h = makeHarness()
		const s = h.seam.status()
		expect(s).toEqual({ connection: "disconnected", turn: "idle", sessionAttached: false })
		expect(h.warnFor("status")).toHaveLength(1)
	})

	test("status after a successful ping has no degrade log and reports connected", async () => {
		const h = makeHarness()
		h.replies.set("bridge.ping", { kind: "value", value: { protocolVersion: 1 } })
		await h.seam.connect()
		const logsBefore = h.warnFor("status").length
		expect(h.seam.status()).toEqual({ connection: "connected", turn: "idle", sessionAttached: false })
		expect(h.warnFor("status")).toHaveLength(logsBefore)
	})

	test("usageSummary with no captured usage returns [] + log; after turn.end.usage it returns real lines", () => {
		const h = makeHarness()
		expect(h.seam.usageSummary()).toEqual([])
		expect(h.warnFor("usageSummary")).toHaveLength(1)

		h.emit({
			type: "turn.end",
			payload: { turnId: "t1", usage: { prompt: 1500, completion: 250, cacheRead: 10, cacheWrite: 20 } },
		})
		expect(h.seam.usageSummary()).toEqual(["turns 1", "prompt 1.5k tok", "completion 250 tok"])
		// still exactly the earlier degrade log — no extra log once data lands.
		expect(h.warnFor("usageSummary")).toHaveLength(1)
	})

	test("P2-9: status/usageSummary degrade logs fire once per class under idle polling", () => {
		const h = makeHarness()
		for (let i = 0; i < 6; i++) {
			h.seam.status()
			h.seam.usageSummary()
		}
		// Six polls of each sync member: one warn each, not twelve.
		expect(h.warnFor("status")).toHaveLength(1)
		expect(h.warnFor("usageSummary")).toHaveLength(1)
	})

	test("interrupt with no in-flight turnId is a no-op + log (no frame sent, no throw)", () => {
		const h = makeHarness()
		expect(() => h.seam.interrupt()).not.toThrow()
		expect(h.warnFor("interrupt")).toHaveLength(1)
		expect(h.lastRequest("turn.abort")).toBeUndefined()
	})

	test("interrupt with an in-flight turnId fires turn.abort with that id", async () => {
		const h = makeHarness()
		h.replies.set("session.send", { kind: "value", value: { turnId: "t-live" } })
		const waiting = h.seam.turn("hi", {
			onThinkingDelta() {},
			onContentDelta() {},
			onApprove: async () => "allowed-once",
			onError() {},
		})
		await Bun.sleep(0) // let session.send resolve and set the turnId
		h.seam.interrupt()
		expect(h.lastRequest("turn.abort")?.params).toEqual({ turnId: "t-live" })
		expect(h.warnFor("interrupt")).toHaveLength(0)
		h.emit({ type: "turn.end", payload: { turnId: "t-live", text: "" } })
		await waiting
	})

	test("P1-5: abort rejection (after one retry) surfaces onError + session.error, never throws", async () => {
		const h = makeHarness()
		h.replies.set("session.send", { kind: "value", value: { turnId: "t-live" } })
		const errors: string[] = []
		const events: { type: string; details: unknown }[] = []
		const waiting = h.seam.turn("hi", {
			onThinkingDelta() {},
			onContentDelta() {},
			onApprove: async () => "allowed-once",
			onError: (m) => errors.push(m),
		})
		h.seam.onSessionEvent((e) => events.push(e))
		await Bun.sleep(0)
		h.emit({ type: "turn.token", payload: { turnId: "t-live", kind: "text", text: "x" } })
		expect(h.seam.status().turn).toBe("running")

		let attempts = 0
		h.replies.set("turn.abort", {
			kind: "fn",
			fn: () => {
				attempts += 1
				return { kind: "error", error: new BridgeProtocolError("TURN_NOT_FOUND", "no such turn") }
			},
		})
		expect(() => h.seam.interrupt()).not.toThrow() // sync signature never throws
		await Bun.sleep(0) // both attempts + their catch handlers are microtasks

		expect(attempts).toBe(2) // one bounded retry, not infinite
		expect(errors.some((m) => m.includes("turn.abort failed") && m.includes("no such turn"))).toBe(true)
		const errEvent = events.find((e) => e.type === "session.error")
		expect(errEvent).toBeDefined()
		expect(errEvent!.details).toMatchObject({
			code: "TURN_NOT_FOUND",
			turnId: "t-live",
			message: "turn.abort failed for turn t-live: no such turn",
		})
		// Failure releases the waiter so turn() does not hang; status goes idle.
		await waiting
		expect(h.seam.status().turn).toBe("idle")
	})

	test("P1-5: abort noop 'success' is reported and not retried", async () => {
		const h = makeHarness()
		h.replies.set("session.send", { kind: "value", value: { turnId: "t-live" } })
		const errors: string[] = []
		const events: { type: string; details: unknown }[] = []
		const waiting = h.seam.turn("hi", {
			onThinkingDelta() {},
			onContentDelta() {},
			onApprove: async () => "allowed-once",
			onError: (m) => errors.push(m),
		})
		h.seam.onSessionEvent((e) => events.push(e))
		await Bun.sleep(0)

		let attempts = 0
		h.replies.set("turn.abort", {
			kind: "fn",
			fn: () => {
				attempts += 1
				return { kind: "value", value: { turnId: "t-live", noop: true } }
			},
		})
		expect(() => h.seam.interrupt()).not.toThrow()
		await Bun.sleep(0)

		expect(attempts).toBe(1) // a noop is terminal/already-aborted — do not retry
		expect(errors.some((m) => m.includes("noop"))).toBe(true)
		expect(events.find((e) => e.type === "session.error")!.details).toMatchObject({ code: "TURN_ABORT_NOOP" })
		await waiting
	})

	test("P1-5: a real abort acknowledgement reports no failure and keeps the turn live", async () => {
		const h = makeHarness()
		h.replies.set("session.send", { kind: "value", value: { turnId: "t-live" } })
		h.replies.set("turn.abort", { kind: "value", value: { turnId: "t-live", aborted: true } })
		const errors: string[] = []
		const events: { type: string; details: unknown }[] = []
		const waiting = h.seam.turn("hi", {
			onThinkingDelta() {},
			onContentDelta() {},
			onApprove: async () => "allowed-once",
			onError: (m) => errors.push(m),
		})
		h.seam.onSessionEvent((e) => events.push(e))
		await Bun.sleep(0)
		h.emit({ type: "turn.token", payload: { turnId: "t-live", kind: "text", text: "x" } })

		h.seam.interrupt()
		await Bun.sleep(0)
		expect(errors).toEqual([])
		expect(events.filter((e) => e.type === "session.error")).toHaveLength(0)
		expect(h.seam.status().turn).toBe("running") // no terminal frame yet
		h.emit({ type: "turn.end", payload: { turnId: "t-live", text: "" } })
		await waiting
	})

	test("onSessionEvent registration logs the explicit non-projected events gap", () => {
		const h = makeHarness()
		h.seam.onSessionEvent(() => {})
		expect(h.warnFor("onSessionEvent")).toHaveLength(1)
		expect(h.warnFor("onSessionEvent")[0].args.map(String).join(" ")).toContain("permission.asked")
	})

	test("steer / registerAskProvider degrade to no-ops + logs (out-of-batch D3 stubs)", () => {
		const h = makeHarness()
		expect(() => h.seam.steer("x")).not.toThrow()
		expect(() => h.seam.registerAskProvider(async () => [])).not.toThrow()
		expect(h.warnFor("steer")).toHaveLength(1)
		expect(h.warnFor("registerAskProvider")).toHaveLength(1)
	})
})

// ---------------------------------------------------------------------------
// ASYNC members: UNSUPPORTED errors (never fake success)
// ---------------------------------------------------------------------------

describe("async UNSUPPORTED members", () => {
	test("currentModelSelection propagates the bridge UNSUPPORTED for the missing frame", async () => {
		const h = makeHarness()
		h.replies.set("model.currentSelection", { kind: "error", error: unsupportedError("model.currentSelection") })
		await expect(h.seam.currentModelSelection()).rejects.toMatchObject({ code: "UNSUPPORTED" })
		expect(h.lastRequest("model.currentSelection")).toBeDefined()
	})

	test("currentModelSelection projects provider/model → providerID/modelID when the frame exists", async () => {
		const h = makeHarness()
		h.replies.set("model.currentSelection", { kind: "value", value: { provider: "p1", model: "m2" } })
		expect(await h.seam.currentModelSelection()).toEqual({ providerID: "p1", modelID: "m2" })
	})

	test("out-of-batch async members all reject with UNSUPPORTED", async () => {
		const h = makeHarness()
		await expect(h.seam.searchSessions("q")).rejects.toMatchObject({ code: "UNSUPPORTED" })
		await expect(h.seam.renameSession("t")).rejects.toMatchObject({ code: "UNSUPPORTED" })
		await expect(h.seam.listProviders()).rejects.toMatchObject({ code: "UNSUPPORTED" })
		await expect(h.seam.modelCatalog()).rejects.toMatchObject({ code: "UNSUPPORTED" })
		await expect(h.seam.selectModel("p", "m")).rejects.toMatchObject({ code: "UNSUPPORTED" })
	})
})

// ---------------------------------------------------------------------------
// COVERED members + turn/event state machine + dispose
// ---------------------------------------------------------------------------

describe("covered lifecycle + turn stream", () => {
	test("resumeSession stages the id; the next turn binds it via session.open{mode:resume}", async () => {
		const h = makeHarness()
		h.replies.set("session.open", { kind: "value", value: { sessionId: "sess-resumed", journalCursor: 7 } })
		h.replies.set("session.send", { kind: "value", value: { turnId: "t1" } })

		expect(h.seam.resumeSession("sess-resumed")).toBe("ok")
		expect(h.seam.currentSessionId()).toBeUndefined() // staged, not bound
		const done = h.seam.turn("go", {
			onThinkingDelta() {},
			onContentDelta() {},
			onApprove: async () => "allowed-once",
			onError() {},
		})
		await Bun.sleep(0)
		expect(h.lastRequest("session.open")?.params).toEqual({ mode: "resume", id: "sess-resumed" })
		expect(h.seam.currentSessionId()).toBe("sess-resumed")
		expect(h.seam.status().sessionAttached).toBe(true)
		h.emit({ type: "turn.end", payload: { turnId: "t1", text: "ok" } })
		await done
	})

	test("newSession clears the bound id before the next turn stages session.open{mode:new}", async () => {
		const h = makeHarness()
		h.replies.set("session.open", {
			kind: "fn",
			fn: (params) => ({
				kind: "value",
				value: { sessionId: params?.mode === "new" ? "fresh" : "old" },
			}),
		})
		h.replies.set("session.send", { kind: "value", value: { turnId: "t2" } })
		// bind an id first
		h.seam.resumeSession("old")
		const first = h.seam.turn("1", { onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {} })
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t2", text: "" } })
		await first
		expect(h.seam.currentSessionId()).toBe("old")

		h.seam.newSession()
		expect(h.seam.currentSessionId()).toBeUndefined()
		const second = h.seam.turn("2", { onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {} })
		await Bun.sleep(0)
		expect(h.lastRequest("session.open")?.params).toEqual({ mode: "new", replace: true })
		expect(h.seam.currentSessionId()).toBe("fresh")
		h.emit({ type: "turn.end", payload: { turnId: "t2", text: "" } })
		await second
	})

	test("turn routes token/reasoning/tool/error to callbacks and resolves on terminal", async () => {
		const h = makeHarness()
		h.replies.set("session.send", { kind: "value", value: { turnId: "t9" } })
		const content: string[] = []
		const thinking: string[] = []
		const errors: string[] = []
		const tools: string[] = []
		const done = h.seam.turn("q", {
			onThinkingDelta: (t) => thinking.push(t),
			onContentDelta: (t) => content.push(t),
			onApprove: async () => "allowed-once",
			onError: (m) => errors.push(m),
			onToolStart: (s) => tools.push(`start:${s.name}`),
			onToolRun: (r) => tools.push(`run:${r.name}`),
		})
		await Bun.sleep(0)
		h.emit({ type: "turn.start", payload: { turnId: "t9" } })
		h.emit({ type: "turn.token", payload: { turnId: "t9", kind: "reasoning", text: "think" } })
		h.emit({ type: "turn.token", payload: { turnId: "t9", kind: "text", text: "answer" } })
		h.emit({ type: "turn.tool", payload: { turnId: "t9", name: "read", input: { p: 1 } } })
		h.emit({ type: "turn.tool", payload: { turnId: "t9", name: "read", output: "body" } })
		h.emit({ type: "turn.error", payload: { turnId: "t9", code: "BLOCKED", message: "blocked" } })
		await done
		expect(thinking).toEqual(["think"])
		expect(content).toEqual(["answer"])
		expect(tools).toEqual(["start:read", "run:read"])
		expect(errors).toEqual(["blocked"])
		expect(h.seam.status().turn).toBe("idle")
	})

	test("P1-3: concurrent turn() is rejected and leaves the in-flight turn's slots intact", async () => {
		const h = makeHarness()
		h.replies.set("session.send", { kind: "value", value: { turnId: "t1" } })
		const contentA: string[] = []
		const contentB: string[] = []
		const cbA = {
			onThinkingDelta() {},
			onContentDelta: (t: string) => contentA.push(t),
			onApprove: async () => "allowed-once" as const,
			onError() {},
		}
		const cbB = {
			onThinkingDelta() {},
			onContentDelta: (t: string) => contentB.push(t),
			onApprove: async () => "allowed-once" as const,
			onError() {},
		}
		const first = h.seam.turn("a", cbA)
		await Bun.sleep(0) // first send resolved, waiter + callbacks registered

		// Reentrant turn is rejected before it can touch any single slot.
		await expect(h.seam.turn("b", cbB)).rejects.toMatchObject({
			code: "TURN_REENTRANT",
			detail: { activeTurnId: "t1" },
		})

		// The first turn is still live: its own callbacks get deltas, the
		// rejected turn's callbacks get nothing, and no second send was issued.
		h.emit({ type: "turn.token", payload: { turnId: "t1", kind: "text", text: "live" } })
		expect(contentA).toEqual(["live"])
		expect(contentB).toEqual([])
		expect(h.requests.filter((r) => r.method === "session.send")).toHaveLength(1)

		h.emit({ type: "turn.end", payload: { turnId: "t1", text: "" } })
		await first // must resolve, not hang on an overwritten waiter
		expect(h.seam.status().turn).toBe("idle")

		// Generation reset: a fresh turn works after the first completes.
		const second = h.seam.turn("c", cbA)
		await Bun.sleep(0)
		expect(h.requests.filter((r) => r.method === "session.send")).toHaveLength(2)
		h.emit({ type: "turn.end", payload: { turnId: "t1", text: "" } })
		await second
	})

	test("P1-4: stagedSessionId exposes the staged resume id until the next turn binds it", async () => {
		const h = makeHarness()
		expect(h.seam.stagedSessionId()).toBeUndefined()
		expect(h.seam.resumeSession("s-resume")).toBe("ok")
		expect(h.seam.stagedSessionId()).toBe("s-resume")
		expect(h.seam.currentSessionId()).toBeUndefined() // staged, not bound yet

		h.replies.set("session.open", { kind: "value", value: { sessionId: "s-resume" } })
		h.replies.set("session.send", { kind: "value", value: { turnId: "t1" } })
		const done = h.seam.turn("go", {
			onThinkingDelta() {},
			onContentDelta() {},
			onApprove: async () => "allowed-once",
			onError() {},
		})
		await Bun.sleep(0)
		expect(h.seam.stagedSessionId()).toBeUndefined()
		expect(h.seam.currentSessionId()).toBe("s-resume")
		h.emit({ type: "turn.end", payload: { turnId: "t1", text: "" } })
		await done
	})

	test("P1-4: stagedSessionId is undefined for a staged newSession", () => {
		const h = makeHarness()
		h.seam.newSession()
		expect(h.seam.stagedSessionId()).toBeUndefined()
	})

	test("onSessionEvent projects turn.start/end/error and excludes token/tool", () => {
		const h = makeHarness()
		const events: { type: string; details: unknown }[] = []
		const dispose = h.seam.onSessionEvent((e) => events.push(e))
		h.emit({ type: "turn.start", payload: { turnId: "t1" } })
		h.emit({ type: "turn.token", payload: { turnId: "t1", kind: "text", text: "x" } })
		h.emit({ type: "turn.tool", payload: { turnId: "t1", name: "t", input: {} } })
		h.emit({ type: "turn.error", payload: { turnId: "t1", code: "X", message: "bad" } })
		expect(events.map((e) => e.type)).toEqual(["session.updated", "session.error"])
		expect(events[1].details).toMatchObject({ message: "bad", code: "X" })
		dispose()
		h.emit({ type: "turn.end", payload: { turnId: "t1" } })
		expect(events).toHaveLength(2) // disposer stops the feed
		expect(projectBridgeEvent({ type: "turn.token", payload: { text: "x" } }, "s")).toEqual([])
	})

	test("dispose unsubscribes the event feed, closes the attached session and is idempotent", async () => {
		const h = makeHarness()
		h.seam.resumeSession("s1")
		h.replies.set("session.open", { kind: "value", value: { sessionId: "s1" } })
		h.replies.set("session.send", { kind: "value", value: { turnId: "t" } })
		const done = h.seam.turn("x", { onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {} })
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t", text: "" } })
		await done

		await h.seam.dispose()
		await h.seam.dispose()
		expect(h.unsubCalls[0]).toBe(1)
		expect(h.requests.filter((r) => r.method === "session.close")).toHaveLength(1)
		expect(h.seam.currentSessionId()).toBeUndefined()
	})
})
