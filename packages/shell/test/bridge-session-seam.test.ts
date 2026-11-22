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
import { createRoot } from "solid-js"
import { createSeamRows } from "../../tui-base/src/routes/session/seam-rows.ts"
import { latestTodos, todoTreeLines } from "../../tui-base/src/routes/session/widgets-dock.tsx"
import {
	BridgeProtocolError,
	BridgeSessionSeam,
	type BridgeConfirmClock,
	bridgeChildJournalMeta,
	bridgeChildStopReason,
	bridgeReplayRowsToSeamEvents,
	bridgeReplayRowsToSeamTranscript,
	bridgeReplayRowsToSubagentViews,
	bridgeSweepSettledChildIds,
	projectBridgeEvent,
	projectBridgeSessionList,
	projectCurrentCwd,
	type BridgeEventFrame,
	type BridgeReplayRow,
	type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"
import { createPluginWriteConfirm } from "../../tui-base/src/seams/session.ts"
import type { SeamSubagentView } from "../../tui-base/src/seams/session.ts"
import { journalToTranscriptRows, type RemoteJournalEntry } from "../src/client/remote-session-ops.ts"
// S5 — deterministic scratch fixture for the REAL local config/settings faces.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type Reply =
	| { kind: "value"; value: unknown }
	| { kind: "error"; error: unknown }
	| { kind: "fn"; fn: (params?: Record<string, unknown>) => Reply }

interface LogCall {
	level: "info" | "warn" | "error" | "debug"
	args: unknown[]
}

function makeHarness(
	confirmClock?: BridgeConfirmClock,
	local?: { dshHome?: string; profile?: string; workspaceDir?: string },
) {
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
		debug(...args: unknown[]) { logs.push({ level: "debug", args }) },
	}

	const seam = new BridgeSessionSeam({ transport, ctx: { logger }, confirmClock, ...local })

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

	test("025-w1a seam.sessionJournal projects raw journal.replay rows into HistoryJournalEntry shape", async () => {
		const h = makeHarness()
		h.replies.set("journal.replay", { kind: "value", value: { rows: REPLAY_ROWS, cursor: 10 } })
		const rows = await h.seam.sessionJournal("sess-x")
		const req = h.lastRequest("journal.replay")!
		expect(req.params).toEqual({ sessionId: "sess-x" })
		// Raw fold input: {type,seq,time,data}; data=asRecord(payload); time=0
		// (the bridge wire carries no clock) — identical to the transcript row
		// construction, but WITHOUT the transcript projection (call/ask merge).
		expect(rows).toEqual(REPLAY_ROWS.map((r) => ({ type: r.type, seq: r.seq, time: 0, data: r.payload })))
	})

	test("025-w1a seam.sessionJournal propagates journal.replay failure (no fake empty journal)", async () => {
		const h = makeHarness()
		h.replies.set("journal.replay", { kind: "error", error: unsupportedError("journal.replay") })
		await expect(h.seam.sessionJournal("sess-x")).rejects.toMatchObject({ code: "UNSUPPORTED" })
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
		expect(s).toEqual({ connection: "disconnected", turn: "idle", sessionAttached: false, bridge: "ready" })
		expect(h.warnFor("status")).toHaveLength(1)
	})

	test("status after a successful ping has no degrade log and reports connected", async () => {
		const h = makeHarness()
		h.replies.set("bridge.ping", { kind: "value", value: { protocolVersion: 1 } })
		await h.seam.connect()
		const logsBefore = h.warnFor("status").length
		expect(h.seam.status()).toEqual({ connection: "connected", turn: "idle", sessionAttached: false, bridge: "ready" })
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

	test("steer degrades to a no-op + log; registerAskProvider now really stores the provider (ADR-0011 T4)", () => {
		const h = makeHarness()
		expect(() => h.seam.steer("x")).not.toThrow()
		expect(h.warnFor("steer")).toHaveLength(1)
		// T4: registerAskProvider is no longer a degrade stub — the real
		// provider round-trip is pinned in bridge-session-ask.test.ts.
		expect(() => h.seam.registerAskProvider(async () => [])).not.toThrow()
		expect(h.warnFor("registerAskProvider")).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// CONFIG faces — S5: REAL local reads/writes (no `{}` degrade, no mocks).
// v2-entry.tsx calls these UNGUARDED at boot; the honest implementation reads
// the operator's `opentui` profile files (the same files verify70 asserts).
// ---------------------------------------------------------------------------

function scratchSeam() {
	const home = mkdtempSync(join(tmpdir(), "s5-config-test-"))
	const profile = "opentui"
	const ws = join(home, "ws")
	mkdirSync(join(home, "profiles", profile), { recursive: true })
	mkdirSync(ws, { recursive: true })
	const configPath = join(home, "profiles", profile, "config.json")
	writeFileSync(configPath, JSON.stringify({ motion: "auto", autoResume: "off", lang: "en" }))
	const harness = makeHarness(undefined, { dshHome: home, profile, workspaceDir: ws })
	return { ...harness, home, configPath }
}

describe("config faces (configLoad/configRaw/workspaceConfig/configSave) — S5 real", () => {
	test("all four exist and read the REAL scratch profile config (never a {} degrade)", () => {
		const h = scratchSeam()
		expect(typeof h.seam.configLoad).toBe("function")
		expect(typeof h.seam.configSave).toBe("function")
		expect(h.seam.configLoad().motion).toBe("auto")
		expect(h.seam.configLoad().autoResume).toBe("off")
		expect(h.seam.configRaw()).toMatchObject({ motion: "auto", lang: "en" })
		expect(h.seam.workspaceConfig()).toEqual({})
		// No degrade log — the real read emits none.
		expect(h.warnFor("configLoad")).toHaveLength(0)
		rmSync(h.home, { recursive: true, force: true })
	})

	test("configSave persists a WHITELISTED key to config.json and re-reads it", () => {
		const h = scratchSeam()
		h.seam.configSave({ motion: "full" })
		expect(JSON.parse(readFileSync(h.configPath, "utf8")).motion).toBe("full")
		expect(h.seam.configLoad().motion).toBe("full")
		// A non-whitelist key never reaches disk (oldfox S4 §六.3).
		h.seam.configSave({ apiKey: "must-not-land" } as Record<string, unknown>)
		expect(JSON.parse(readFileSync(h.configPath, "utf8"))).not.toHaveProperty("apiKey")
		rmSync(h.home, { recursive: true, force: true })
	})

	test("repeated boot reads are stable (no mutate, no cross-call poisoning)", () => {
		const h = scratchSeam()
		for (let i = 0; i < 6; i++) expect(h.seam.configLoad().motion).toBe("auto")
		const first = h.seam.configLoad()
		first.motion = "poisoned"
		expect(h.seam.configLoad().motion).toBe("auto")
		rmSync(h.home, { recursive: true, force: true })
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
		// 025-w1b B: searchSessions moved OFF the stub set onto the real
		// session.search frame (see the dedicated describe below); it is no
		// longer an out-of-batch UNSUPPORTED member. The four remaining stubs
		// are unchanged.
		await expect(h.seam.renameSession("t")).rejects.toMatchObject({ code: "UNSUPPORTED" })
		await expect(h.seam.listProviders()).rejects.toMatchObject({ code: "UNSUPPORTED" })
		await expect(h.seam.modelCatalog()).rejects.toMatchObject({ code: "UNSUPPORTED" })
		await expect(h.seam.selectModel("p", "m")).rejects.toMatchObject({ code: "UNSUPPORTED" })
	})
})

// ---------------------------------------------------------------------------
// 025-w1a /plugins — phase-1 local install manifest
// ---------------------------------------------------------------------------

describe("025-w1a plugins face (profile node_modules install manifest)", () => {
	test("plugins() lists real installed packages; excludes @deepseek-ai built-ins and @aiwayds bridge self", () => {
		const h = scratchSeam()
		const nm = join(h.home, "profiles", "opentui", "node_modules")
		const mk = (path: string, name: string, version: string) => {
			mkdirSync(path, { recursive: true })
			writeFileSync(join(path, "package.json"), JSON.stringify({ name, version }))
		}
		mk(join(nm, "my-plugin"), "my-plugin", "1.2.3")
		mk(join(nm, "@scope", "another"), "@scope/another", "4.5.6")
		mk(join(nm, "@deepseek-ai", "dsh-persona"), "@deepseek-ai/dsh-persona", "0.0.1")
		mk(join(nm, "@aiwayds", "dsh-opentui-bridge"), "@aiwayds/dsh-opentui-bridge", "0.24.0")
		const rows = h.seam.plugins()
		const keyed = Object.fromEntries(rows.map((r) => [r.name, r.version]))
		expect(keyed).toEqual({ "my-plugin": "1.2.3", "@scope/another": "4.5.6" })
		// Built-ins / bridge self never appear, whatever the readdir order.
		expect(rows.some((r) => r.name.startsWith("@deepseek-ai/") || r.name.startsWith("@aiwayds/"))).toBe(false)
		rmSync(h.home, { recursive: true, force: true })
	})

	test("plugins() degrades honestly to [] when node_modules is absent", () => {
		const h = scratchSeam()
		expect(h.seam.plugins()).toEqual([])
		rmSync(h.home, { recursive: true, force: true })
	})
})

// ---------------------------------------------------------------------------
// 025-w2-1 /btw — real side session over the generic arm (no fake answer)
// ---------------------------------------------------------------------------

const waitValue = (text: string) => ({
	reason: "idle",
	state: { cursor: 1, active: false, running: false, queue: null, pendingInput: [] },
	output: { records: [{ type: "event", event: { type: "assistant/message", seq: 1, time: 1, data: { message: { role: "assistant", content: [{ type: "text", text }] } } } }], truncated: false },
})

describe("025-w2-1 btwAsk face (real side session over generic arm)", () => {
	test("btwAsk drives session.create -> prompt -> wait and returns the projected answer", async () => {
		const h = makeHarness()
		expect(typeof h.seam.btwAsk).toBe("function")
		h.replies.set("session.create", { kind: "value", value: { sessionId: "side-1" } })
		h.replies.set("session.prompt", { kind: "value", value: { accepted: true } })
		h.replies.set("session.wait", { kind: "value", value: waitValue("pong answer") })

		const answer = await h.seam.btwAsk("Reply with pong", ["ctx line"])
		expect(answer).toBe("pong answer")
		expect(h.requests.map((r) => r.method)).toEqual(["session.create", "session.prompt", "session.wait"])
		// snapshot is reference-only, never the main session state
		const prompt = h.lastRequest("session.prompt")?.params?.request as Record<string, unknown>
		expect(prompt.mode).toBe("queue")
		expect(JSON.stringify(prompt.content)).toContain("Reply with pong")
	})

	test("domain separation: a side session never rewrites currentSessionId", async () => {
		const h = makeHarness()
		h.replies.set("session.create", { kind: "value", value: { sessionId: "side-1" } })
		h.replies.set("session.prompt", { kind: "value", value: { accepted: true } })
		h.replies.set("session.wait", { kind: "value", value: waitValue("answer") })
		expect(h.seam.currentSessionId()).toBeUndefined()
		await h.seam.btwAsk("q", [])
		expect(h.seam.currentSessionId()).toBeUndefined() // bound main session untouched
		expect(h.seam.status().sessionAttached).toBe(false)
	})

	test("E3 NOT_WIRED degrades to UNSUPPORTED face reject (never a fake answer)", async () => {
		const h = makeHarness()
		h.replies.set("session.create", { kind: "error", error: new Error("NOT_WIRED: sessionController unavailable") })
		const err = await h.seam.btwAsk("ping", []).then(() => undefined, (e) => e)
		expect(err).toBeInstanceOf(BridgeProtocolError)
		expect(err.code).toBe("UNSUPPORTED")
		expect(String(err.message)).toContain("NOT_WIRED")
	})

	test("E5 SENTINEL: hostile keys in the wait reply never reach the side answer", async () => {
		const h = makeHarness()
		const hostile = waitValue("safe answer")
		;(hostile.output.records[0]!.event.data as Record<string, unknown>).apiKey = "W21_SENTINEL"
		;(hostile.output.records[0]!.event.data as Record<string, unknown>).token = "W21_SENTINEL"
		h.replies.set("session.create", { kind: "value", value: { sessionId: "side-1" } })
		h.replies.set("session.prompt", { kind: "value", value: { accepted: true } })
		h.replies.set("session.wait", { kind: "value", value: hostile })
		const answer = await h.seam.btwAsk("q", [])
		expect(answer).toBe("safe answer")
		expect(answer).not.toContain("W21_SENTINEL")
		expect(answer).not.toMatch(/apiKey|token/i)
	})

	test("single in-flight side call: a concurrent btwAsk rejects SIDE_SESSION_BUSY", async () => {
		const h = makeHarness()
		let release!: (v: unknown) => void
		const gate = new Promise<unknown>((resolve) => { release = resolve })
		h.replies.set("session.create", { kind: "fn", fn: () => ({ kind: "value", value: gate }) as never })
		const first = h.seam.btwAsk("q1", [])
		await Promise.resolve() // let the first claim the in-flight flag
		const second = await h.seam.btwAsk("q2", []).then(() => undefined, (e) => e)
		expect(second).toBeInstanceOf(BridgeProtocolError)
		expect((second as BridgeProtocolError).code).toBe("SIDE_SESSION_BUSY")
		release({ sessionId: "side-1" })
		h.replies.set("session.prompt", { kind: "value", value: { accepted: true } })
		h.replies.set("session.wait", { kind: "value", value: waitValue("q1 answer") })
		expect(await first).toBe("q1 answer")
	})
})

// ---------------------------------------------------------------------------
// 025-w1a /think — real effort ladder from the host catalog
// ---------------------------------------------------------------------------

describe("025-w1a thinking face (real host effort ladder)", () => {
	const CATALOG = {
		default: { provider: "p1", model: "m1", reasoningEffort: "medium" },
		groups: [
			{ id: "p1", models: [
				{ id: "m1", reasoning: { efforts: [
					{ id: "low", name: "Low", description: "quick" },
					{ id: "medium", name: "Medium" },
					{ id: "high", name: "High", description: "deep" },
				] } },
				{ id: "m2" }, // no ladder → empty
			] },
			{ id: "p2", models: [{ id: "m3", reasoning: { efforts: [{ id: "x", name: "X" }] } }] },
		],
	}

	test("efforts() reads the CURRENT route's real reasoning.efforts (no hardcoded tiers)", async () => {
		const h = makeHarness()
		h.replies.set("modelCatalog", { kind: "value", value: CATALOG })
		expect(await h.seam.thinking.efforts()).toEqual([
			{ id: "low", name: "Low", description: "quick" },
			{ id: "medium", name: "Medium" },
			{ id: "high", name: "High", description: "deep" },
		])
	})

	test("effortsFor() reads ANY route's ladder; empty ladder → []", async () => {
		const h = makeHarness()
		h.replies.set("modelCatalog", { kind: "value", value: CATALOG })
		expect(await h.seam.thinking.effortsFor!("p2", "m3")).toEqual([{ id: "x", name: "X" }])
		expect(await h.seam.thinking.effortsFor!("p1", "m2")).toEqual([])
	})

	test("efforts() degrades honestly to [] when the catalog frame is absent", async () => {
		const h = makeHarness()
		expect(await h.seam.thinking.efforts()).toEqual([])
	})

	test("currentEffort() reads reasoningEffort from model.currentSelection", async () => {
		const h = makeHarness()
		h.replies.set("model.currentSelection", { kind: "value", value: { provider: "p1", model: "m1", reasoningEffort: "high" } })
		expect(await h.seam.thinking.currentEffort()).toBe("high")
		h.replies.set("model.currentSelection", { kind: "value", value: { provider: "p1", model: "m1" } })
		expect(await h.seam.thinking.currentEffort()).toBeUndefined()
	})

	test("selectEffort() forwards provider/model/reasoningEffort to selectModel and rejects on failure", async () => {
		const h = makeHarness()
		h.replies.set("model.currentSelection", { kind: "value", value: { provider: "p1", model: "m1" } })
		h.replies.set("selectModel", { kind: "value", value: { selected: { provider: "p1", model: "m1", reasoningEffort: "high" } } })
		await h.seam.thinking.selectEffort("high")
		expect(h.lastRequest("selectModel")!.params).toMatchObject({ provider: "p1", model: "m1", reasoningEffort: "high" })
		// Clearing the override omits reasoningEffort.
		await h.seam.thinking.selectEffort(undefined)
		expect(h.lastRequest("selectModel")!.params).not.toHaveProperty("reasoningEffort")
		// Host refusal propagates.
		h.replies.set("selectModel", { kind: "error", error: unsupportedError("selectModel") })
		await expect(h.seam.thinking.selectEffort("low")).rejects.toMatchObject({ code: "UNSUPPORTED" })
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

	// ---- oldfox 9190946 review P1-1 补测: seam CONVERSION layer ------------
	// FakeSeam tests in seam-rows.test.ts call onToolStart/onToolRun directly and
	// bypass the frame→callback conversion in #onFrame — that is why callId loss
	// and the ok:true hardcode escaped. These drive REAL bridge frames through.

	test("P1-1: real turn.tool frames propagate callId and map isError→ok through the conversion layer", async () => {
		const h = makeHarness()
		h.replies.set("session.send", { kind: "value", value: { turnId: "t-tool" } })
		const starts: { callId?: string; name: string; args: string }[] = []
		const runs: { callId?: string; name: string; argsPretty: string; output: string; ok: boolean }[] = []
		const done = h.seam.turn("q", {
			onThinkingDelta() {},
			onContentDelta() {},
			onApprove: async () => "allowed-once",
			onError() {},
			onToolStart: (s) => starts.push(s),
			onToolRun: (r) => runs.push(r),
		})
		await Bun.sleep(0)
		h.emit({ type: "turn.tool", payload: { turnId: "t-tool", callId: "c1", name: "bash", input: { cmd: "ls" } } })
		h.emit({ type: "turn.tool", payload: { turnId: "t-tool", callId: "c1", name: "bash", output: "ok", isError: false } })
		h.emit({ type: "turn.tool", payload: { turnId: "t-tool", callId: "c2", name: "bash", output: "boom", isError: true } })
		h.emit({ type: "turn.end", payload: { turnId: "t-tool", text: "" } })
		await done

		expect(starts).toEqual([{ callId: "c1", name: "bash", args: '{"cmd":"ls"}' }])
		expect(runs).toEqual([
			{ callId: "c1", name: "bash", argsPretty: "", output: "ok", ok: true },
			{ callId: "c2", name: "bash", argsPretty: "", output: "boom", ok: false },
		])
	})

	test("P1-1: two same-name tools interleaving stay on separate callId-keyed rows (full frame→seam-rows chain)", async () => {
		const h = makeHarness()
		h.replies.set("session.send", { kind: "value", value: { turnId: "t-inter" } })
		let dispose!: () => void
		const projection = createRoot((d) => {
			dispose = d
			return createSeamRows(h.seam, () => "sess-inter")
		})
		await Bun.sleep(0) // setup storedTranscript settles

		const sent = projection.send("run two bash calls")
		await Bun.sleep(0) // turn() sends session.send and binds the live callbacks
		// A starts, B starts, A settles, B settles — all named "bash". Without
		// callId both would collide on tool:live:bash and args/results would cross.
		h.emit({ type: "turn.tool", payload: { turnId: "t-inter", callId: "A", name: "bash", input: { cmd: "a" } } })
		h.emit({ type: "turn.tool", payload: { turnId: "t-inter", callId: "B", name: "bash", input: { cmd: "b" } } })
		h.emit({ type: "turn.tool", payload: { turnId: "t-inter", callId: "A", name: "bash", output: "out-a", isError: false } })
		h.emit({ type: "turn.tool", payload: { turnId: "t-inter", callId: "B", name: "bash", output: "out-b", isError: true } })
		h.emit({ type: "turn.end", payload: { turnId: "t-inter", text: "" } })
		await sent

		const tools = projection.rows.filter((r) => r.kind === "tool")
		expect(tools).toHaveLength(2)
		const a = tools.find((r) => r.key === "tool:live:A")
		const b = tools.find((r) => r.key === "tool:live:B")
		expect(a).toMatchObject({ name: "bash", args: '{"cmd":"a"}', status: "done", output: "out-a" })
		expect(b).toMatchObject({ name: "bash", args: '{"cmd":"b"}', status: "failed", output: "out-b" })
		dispose()
	})

	// -----------------------------------------------------------------------
	// Todo tree feed: both seam paths must carry the FULL `todos` array from
	// the host's `todo_write` call into a `tool` row, so latestTodos() (and the
	// merged dock's todoTreeLines) can render it. Inputs below are the EXACT
	// frame shapes decoded from scratch-home journal session 0f192c17 seq16-19:
	// the call arguments are a JSON STRING (`arguments`), which the bridge
	// parses into an object for the live `turn.tool.input` frame, and which the
	// replay projector keeps as a string on `message.part.updated.part.input`.
	// -----------------------------------------------------------------------
	const TODO_ARGS = '{"todos":[{"content":"alpha","status":"pending"},{"content":"beta","status":"pending"},{"content":"gamma","status":"pending"}]}'
	const TODO_RESULT = "Updated todo list: 3 pending, 0 in progress, 0 completed."
	const todoTreeContents = (rows: readonly ReturnType<typeof createSeamRows>["rows"]): string[] =>
		todoTreeLines(latestTodos(rows))
			.map((line) => line.segments.map((seg) => seg.text).join(""))
			.filter((text) => text.includes("alpha") || text.includes("beta") || text.includes("gamma"))

	test("todo tree — live turn.tool frames carry arguments into the dock tree", async () => {
		const h = makeHarness()
		h.replies.set("session.send", { kind: "value", value: { turnId: "t-todo" } })
		let dispose!: () => void
		const projection = createRoot((d) => {
			dispose = d
			return createSeamRows(h.seam, () => "sess-todo")
		})
		await Bun.sleep(0) // setup storedTranscript settles

		const sent = projection.send("create todos")
		await Bun.sleep(0) // turn() sends session.send and binds the live callbacks
		// The bridge turns the host's `arguments` JSON string into a PARSED object
		// (`toolInput`) on turn.tool.input, and keeps the result text on output.
		h.emit({
			type: "turn.tool",
			payload: { turnId: "t-todo", callId: "call_todo", name: "todo_write", input: JSON.parse(TODO_ARGS) },
		})
		h.emit({
			type: "turn.tool",
			payload: { turnId: "t-todo", callId: "call_todo", name: "todo_write", output: TODO_RESULT, isError: false },
		})
		h.emit({ type: "turn.end", payload: { turnId: "t-todo" } })
		await sent

		const tool = projection.rows.find((r) => r.kind === "tool")
		expect(tool).toMatchObject({ name: "todo_write", args: TODO_ARGS, status: "done", output: TODO_RESULT })
		expect(todoTreeContents(projection.rows)).toEqual(["├─ ○ alpha", "├─ ○ beta", "└─ ○ gamma"])
		dispose()
	})

	test("todo tree — journal replay projects arguments into the dock tree", () => {
		// Exact replay row shapes from the decoded journal (seq16-19).
		const rows: BridgeReplayRow[] = [
			{
				seq: 16,
				type: "assistant/message",
				payload: {
					turn: 1,
					step: 1,
					message: {
						role: "assistant",
						content: [{ type: "tool-call", id: "call_todo", name: "todo_write", arguments: TODO_ARGS }],
					},
				},
			},
			{
				seq: 17,
				type: "tool/call",
				payload: { turn: 1, step: 1, callId: "call_todo", name: "todo_write", arguments: TODO_ARGS },
			},
			{
				seq: 19,
				type: "tool/result",
				payload: {
					turn: 1,
					step: 1,
					message: {
						role: "tool",
						toolCallId: "call_todo",
						content: [{ type: "text", text: TODO_RESULT }],
						isError: false,
					},
				},
			},
		]
		let dispose!: () => void
		const projection = createRoot((d) => {
			dispose = d
			return createSeamRows(makeHarness().seam, () => "sess-todo")
		})
		for (const event of bridgeReplayRowsToSeamEvents(rows, "sess-todo")) projection.apply(event)

		const tool = projection.rows.find((r) => r.kind === "tool")
		expect(tool).toMatchObject({ name: "todo_write", args: TODO_ARGS })
		expect(todoTreeContents(projection.rows)).toEqual(["├─ ○ alpha", "├─ ○ beta", "└─ ○ gamma"])
		dispose()
	})

	test("ADR-0010 I4: SESSION_LOCKED from session.open propagates with code + detail.holder intact", async () => {
		const h = makeHarness()
		// The bridge replies SESSION_LOCKED with detail.holder = the locked
		// session id; the transport decoded it to this BridgeProtocolError.
		const locked = new BridgeProtocolError("SESSION_LOCKED", "session already owned", { holder: "sess-held" })
		h.replies.set("session.open", { kind: "error", error: locked })
		h.seam.resumeSession("sess-held")

		const errors: string[] = []
		const pending = h.seam.turn("go", {
			onThinkingDelta() {},
			onContentDelta() {},
			onApprove: async () => "allowed-once",
			onError: (m) => errors.push(m),
		})
		await expect(pending).rejects.toBe(locked)
		// The seam rethrows verbatim — no live callback fires on this path, so
		// the tui-base render point is what turns it into the writer-held text.
		expect(errors).toHaveLength(0)
		expect(h.seam.status().sessionAttached).toBe(false)
		expect(h.requests.filter((r) => r.method === "session.send")).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// sessionInfo: footer 💬 (msgCount) + ⚡ (tps), /session panel counts
// ---------------------------------------------------------------------------

describe("sessionInfo", () => {
	function bindHarness(h: ReturnType<typeof makeHarness>, id: string, turnId: string) {
		h.replies.set("session.open", { kind: "value", value: { sessionId: id, journalCursor: 1 } })
		h.replies.set("session.send", { kind: "value", value: { turnId } })
		h.seam.resumeSession(id)
		const done = h.seam.turn("hi", {
			onThinkingDelta() {},
			onContentDelta() {},
			onApprove: async () => "allowed-once",
			onError() {},
		})
		return done
	}

	test("undefined before a session is bound", async () => {
		const h = makeHarness()
		expect(await h.seam.sessionInfo()).toBeUndefined()
	})

	test("msgCount = raw assistant/message rows; turnCount/messageCount are filtered for /session", async () => {
		const h = makeHarness()
		const done = bindHarness(h, "sess-1", "t1")
		const user = (text: string) => ({ content: [{ type: "text", text }] })
		const assistant = (text: string) => ({ message: { content: [{ type: "text", text }] } })
		h.replies.set("journal.replay", {
			kind: "value",
			value: {
				rows: [
					{ seq: 1, type: "user/message", payload: user("u1") },
					{ seq: 2, type: "assistant/message", payload: assistant("a1") },
					{ seq: 3, type: "assistant/message", payload: assistant("a2") },
					{ seq: 4, type: "user/message", payload: user("u2") },
				],
				cursor: 5,
			},
		})
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t1", text: "ok" } })
		await done

		const info = (await h.seam.sessionInfo())!
		expect(info.sessionId).toBe("sess-1")
		expect(info.msgCount).toBe(2) // raw durable assistant/message events = msgs (0.21.1 unit)
		expect(info.turnCount).toBe(2) // two filtered user transcript rows
		expect(info.messageCount).toBe(4) // filtered user + assistant, /session panel only
	})

	test("P2-2: /session counts use the filtered口径, msgCount stays raw assistant count", async () => {
		const h = makeHarness()
		const done = bindHarness(h, "sess-filter", "t-filter")
		const rows = [
			{ seq: 1, type: "user/message", payload: { content: [{ type: "text", text: "real user" }] } },
			// Non-"user" source.kind injections (runtime-context / tool-registry) are
			// excluded from the /session counts, exactly as the remote adapter's
			// journalToTranscriptRows does — but they are NOT assistant/message rows
			// so msgCount is unaffected either way.
			{ seq: 2, type: "user/message", payload: { source: { kind: "runtime-context" }, content: [{ type: "text", text: "ctx" }] } },
			{ seq: 3, type: "user/message", payload: { source: { kind: "tool-registry" }, content: [{ type: "text", text: "tools" }] } },
			// Empty-text rows are dropped from /session counts...
			{ seq: 4, type: "user/message", payload: { content: [] } },
			{ seq: 5, type: "assistant/message", payload: { message: { content: [{ type: "text", text: "real reply" }] } } },
			{ seq: 6, type: "assistant/message", payload: { message: { content: [] } } },
		]
		h.replies.set("journal.replay", { kind: "value", value: { rows, cursor: 7 } })
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t-filter", text: "" } })
		await done

		const info = (await h.seam.sessionInfo())!
		expect(info.turnCount).toBe(1) // only the real user row (injections + empty excluded)
		expect(info.messageCount).toBe(2) // real user + real assistant only
		expect(info.msgCount).toBe(2) // RAW assistant/message rows: seq 5 + 6 (empty still counted)
	})

	test("P2-1: repeated sessionInfo drains only incremental rows, counts stay cumulative", async () => {
		const h = makeHarness()
		const done = bindHarness(h, "sess-inc", "t-inc")
		const user = (text: string) => ({ content: [{ type: "text", text }] })
		const assistant = (text: string) => ({ message: { content: [{ type: "text", text }] } })
		const rows = [
			{ seq: 1, type: "user/message", payload: user("u1") },
			{ seq: 2, type: "assistant/message", payload: assistant("a1") },
		]
		const froms: number[] = []
		h.replies.set("journal.replay", {
			kind: "fn",
			fn: (params) => {
				const from = Number(params?.from ?? 1)
				froms.push(from)
				return { kind: "value", value: { rows: rows.filter((r) => r.seq >= from), cursor: rows.length + 1 } }
			},
		})
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t-inc", text: "" } })
		await done

		const first = (await h.seam.sessionInfo())!
		expect([first.msgCount, first.turnCount, first.messageCount]).toEqual([1, 1, 2])
		expect(froms).toEqual([1]) // full read on the first call

		rows.push({ seq: 3, type: "assistant/message", payload: assistant("a2") })
		const second = (await h.seam.sessionInfo())!
		expect([second.msgCount, second.turnCount, second.messageCount]).toEqual([2, 1, 3]) // cumulative
		expect(froms).toEqual([1, 3]) // second call drained ONLY the new seq
	})

	test("P2-1: sessionId switch invalidates the incremental cache", async () => {
		const h = makeHarness()
		const done = bindHarness(h, "sess-a", "t-a")
		const rowsA = [{ seq: 1, type: "user/message", payload: { content: [{ type: "text", text: "a" }] } }]
		const froms: number[] = []
		h.replies.set("journal.replay", {
			kind: "fn",
			fn: (params) => {
				const from = Number(params?.from ?? 1)
				froms.push(from)
				return { kind: "value", value: { rows: rowsA.filter((r) => r.seq >= from), cursor: rowsA.length + 1 } }
			},
		})
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t-a", text: "" } })
		await done
		expect((await h.seam.sessionInfo())!.turnCount).toBe(1)

		// Rebind to a different session whose journal restarts at seq 1.
		const rowsB = [
			{ seq: 1, type: "user/message", payload: { content: [{ type: "text", text: "b1" }] } },
			{ seq: 2, type: "user/message", payload: { content: [{ type: "text", text: "b2" }] } },
		]
		// Stage the new binding; turn() only calls session.open when a pending
		// open exists (an already-attached session keeps its current id).
		h.seam.resumeSession("sess-b")
		h.replies.set("session.open", { kind: "value", value: { sessionId: "sess-b", journalCursor: 1 } })
		h.replies.set("session.send", { kind: "value", value: { turnId: "t-b" } })
		h.replies.set("journal.replay", {
			kind: "fn",
			fn: (params) => {
				const from = Number(params?.from ?? 1)
				froms.push(from)
				return { kind: "value", value: { rows: rowsB.filter((r) => r.seq >= from), cursor: rowsB.length + 1 } }
			},
		})
		const doneB = h.seam.turn("hello b", {
			onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {},
		})
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t-b", text: "" } })
		await doneB
		const second = (await h.seam.sessionInfo())!
		expect(second.sessionId).toBe("sess-b")
		expect(second.turnCount).toBe(2) // NOT 1 (stale sess-a) + 2
		expect(froms[froms.length - 1]).toBe(1) // fresh session re-read from seq 1
	})

	test("P2-1: a journal reset (clamped cursor) invalidates the cache and re-reads from seq 1", async () => {
		const h = makeHarness()
		const done = bindHarness(h, "sess-reset", "t-reset")
		let rows = [
			{ seq: 1, type: "user/message", payload: { content: [{ type: "text", text: "old1" }] } },
			{ seq: 2, type: "user/message", payload: { content: [{ type: "text", text: "old2" }] } },
			{ seq: 3, type: "user/message", payload: { content: [{ type: "text", text: "old3" }] } },
		]
		const froms: number[] = []
		h.replies.set("journal.replay", {
			kind: "fn",
			fn: (params) => {
				const from = Number(params?.from ?? 1)
				froms.push(from)
				return { kind: "value", value: { rows: rows.filter((r) => r.seq >= from), cursor: rows.length + 1 } }
			},
		})
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t-reset", text: "" } })
		await done
		expect((await h.seam.sessionInfo())!.turnCount).toBe(3) // cached lastSeq = 3

		// Host restarts with a SHORTER journal: seqs restart from 1 and max = 2,
		// so from=4 is ahead of cursor=3 → the drain clamps and the cache resets.
		rows = [
			{ seq: 1, type: "user/message", payload: { content: [{ type: "text", text: "fresh1" }] } },
			{ seq: 2, type: "user/message", payload: { content: [{ type: "text", text: "fresh2" }] } },
		]
		const second = (await h.seam.sessionInfo())!
		expect(second.turnCount).toBe(2) // stale 3 replaced by the fresh journal's 2
		expect(froms[froms.length - 1]).toBe(1) // re-read from seq 1 after the reset
	})

	test("⚡ tps derives from a live decode window and is absent without a token", async () => {
		const h = makeHarness()
		const done = bindHarness(h, "sess-2", "t2")
		h.replies.set("journal.replay", { kind: "value", value: { rows: [], cursor: 1 } })
		await Bun.sleep(0)
		// No token frame → no decode window → no tps sample.
		h.emit({ type: "turn.end", payload: { turnId: "t2", text: "", usage: { completion: 20 } } })
		await done
		expect((await h.seam.sessionInfo())!.lastTurnTps).toBeNull()

		// A token frame opens the window; turn.end closes it with billed tokens.
		h.replies.set("session.send", { kind: "value", value: { turnId: "t3" } })
		const done2 = h.seam.turn("again", {
			onThinkingDelta() {},
			onContentDelta() {},
			onApprove: async () => "allowed-once",
			onError() {},
		})
		await Bun.sleep(0)
		h.emit({ type: "turn.token", payload: { turnId: "t3", text: "hello" } })
		await Bun.sleep(5)
		h.emit({ type: "turn.end", payload: { turnId: "t3", text: "hello", usage: { completion: 100 } } })
		await done2
		const info = (await h.seam.sessionInfo())!
		expect(info.lastTurnTps).toBeGreaterThan(0)
		expect(info.sessionAvgTps).toBeGreaterThan(0)
	})

	test("P3-1: a failed journal read omits ALL durable counts, never a fake 0", async () => {
		const h = makeHarness()
		const done = bindHarness(h, "sess-3", "t4")
		h.replies.set("journal.replay", { kind: "error", error: new Error("journal unavailable") })
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t4", text: "" } })
		await done
		const info = (await h.seam.sessionInfo())!
		expect(info.sessionId).toBe("sess-3")
		expect(info.msgCount).toBeUndefined()
		expect(info.messageCount).toBeUndefined()
		expect(info.turnCount).toBeUndefined()
	})

	test("R2 P2-1: two concurrent sessionInfo() calls coalesce; counts do not double", async () => {
		const h = makeHarness()
		const done = bindHarness(h, "sess-concurrent", "t-c")
		const user = (text: string) => ({ content: [{ type: "text", text }] })
		const assistant = (text: string) => ({ message: { content: [{ type: "text", text }] } })
		const rows = [
			{ seq: 1, type: "user/message", payload: user("u1") },
			{ seq: 2, type: "assistant/message", payload: assistant("a1") },
			{ seq: 3, type: "assistant/message", payload: assistant("a2") },
			{ seq: 4, type: "user/message", payload: user("u2") },
		]
		let replayCalls = 0
		h.replies.set("journal.replay", {
			kind: "fn",
			fn: (params) => {
				replayCalls++
				const from = Number(params?.from ?? 1)
				return { kind: "value", value: { rows: rows.filter((r) => r.seq >= from), cursor: rows.length + 1 } }
			},
		})
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t-c", text: "" } })
		await done

		// Fire BOTH calls synchronously, before either await resumes — exactly the
		// turn-boundary race between the footer refresh and the /session command.
		const p1 = h.seam.sessionInfo()
		const p2 = h.seam.sessionInfo()
		// Single-flight: concurrent callers share the exact same in-flight promise.
		expect(p1).toBe(p2)
		const [a, b] = await Promise.all([p1, p2])
		expect([a!.msgCount, a!.turnCount, a!.messageCount]).toEqual([2, 2, 4])
		expect([b!.msgCount, b!.turnCount, b!.messageCount]).toEqual([2, 2, 4])
		expect(replayCalls).toBe(1) // ONE drain over the rows, not two
	})

	test("R2 P2-2: bridge sessionInfo counts match the remote journalToTranscriptRows projection", async () => {
		const h = makeHarness()
		const done = bindHarness(h, "sess-parity", "t-p")
		const rows = [
			{ seq: 1, type: "user/message", payload: { content: [{ type: "text", text: "real user" }] } },
			{ seq: 2, type: "user/message", payload: { source: { kind: "runtime-context" }, content: [{ type: "text", text: "ctx" }] } },
			{ seq: 3, type: "user/message", payload: { source: { kind: "tool-registry" }, content: [{ type: "text", text: "tools" }] } },
			{ seq: 4, type: "user/message", payload: { content: [] } },
			{ seq: 5, type: "assistant/message", payload: { message: { content: [{ type: "text", text: "reply 1" }] } } },
			{ seq: 6, type: "assistant/message", payload: { message: { content: [{ type: "text", text: "reply 2" }] } } },
			{ seq: 7, type: "assistant/message", payload: { message: { content: [] } } },
		]
		h.replies.set("journal.replay", { kind: "value", value: { rows, cursor: rows.length + 1 } })
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t-p", text: "" } })
		await done

		const info = (await h.seam.sessionInfo())!

		// The remote adapter projection over the SAME constructed journal. A bridge
		// replay row `{seq,type,payload}` is structurally a RemoteJournalEntry with
		// `data = payload` — exactly how bridgeReplayRowsToSeamTranscript feeds
		// journalToTranscriptRows — so the two must agree field for field.
		const entries: RemoteJournalEntry[] = rows.map((row) => ({
			type: row.type,
			seq: row.seq,
			time: 0,
			data: row.payload,
		}))
		const remoteRows = journalToTranscriptRows(entries)
		const remoteUser = remoteRows.filter((r) => r.kind === "user").length
		const remoteAssistant = remoteRows.filter((r) => r.kind === "assistant").length
		const rawAssistants = rows.filter((r) => r.type === "assistant/message").length

		expect(info.turnCount).toBe(remoteUser)
		expect(info.messageCount).toBe(remoteUser + remoteAssistant)
		expect(info.msgCount).toBe(rawAssistants) // msgCount = RAW assistant rows
	})

	test("P2-1: the incremental sessionInfo drain folds a subagent-settled row into the live roster (turn-external convergence)", async () => {
		const h = makeHarness()
		const done = bindHarness(h, "sess-fold", "t-fold")
		const rows: { seq: number; type: string; payload: Record<string, unknown> }[] = [
			{
				seq: 1, type: "subagent/catalog",
				payload: { childId: "async-child", childCreatedAt: 1_000, label: "async" },
			},
		]
		h.replies.set("journal.replay", {
			kind: "fn",
			fn: (params) => {
				const from = Number(params?.from ?? 1)
				return { kind: "value", value: { rows: rows.filter((r) => r.seq >= from), cursor: rows.length + 1 } }
			},
		})
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t-fold", text: "" } })
		await done

		// First drain: catalog only → child RUNNING in the roster.
		await h.seam.sessionInfo()
		expect(h.seam.subagentViews().find((v) => v.id === "async-child")?.status).toBe("running")

		// The host journals the async terminal as a user/message notice; no
		// agent.settle frame is emitted for the catalog family. The incremental
		// drain must fold it so the child settles OUTSIDE any turn.
		rows.push({
			seq: 2, type: "user/message",
			payload: { source: { kind: "subagent-settled", stopReason: "completed", senderSessionId: "async-child" } },
		})
		await h.seam.sessionInfo()
		expect(h.seam.subagentViews().find((v) => v.id === "async-child")?.status).toBe("completed")
	})
})

// ---------------------------------------------------------------------------
// 0.22.0 footer parity: ⚡ CH cache rate + 🧠 context from the SAME journal
// ---------------------------------------------------------------------------

describe("footer telemetry parity (cacheHitRate / contextTokens / contextWindow)", () => {
	const bind = async (h: ReturnType<typeof makeHarness>, id: string, turnId: string) => {
		h.replies.set("session.open", { kind: "value", value: { sessionId: id, journalCursor: 1 } })
		h.replies.set("session.send", { kind: "value", value: { turnId } })
		h.seam.resumeSession(id)
		const done = h.seam.turn("hi", {
			onThinkingDelta() {},
			onContentDelta() {},
			onApprove: async () => "allowed-once",
			onError() {},
		})
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId, text: "" } })
		await done
	}
	const selection = { provider: "opencode-go", model: "deepseek-v4.1-flash" }
	const assistant = (seq: number, usage: Record<string, number>) => ({
		seq,
		type: "assistant/message",
		payload: { message: { content: [{ type: "text", text: "reply" }] }, usage },
	})

	test("host usage field names feed the live /session cache & token rows (the 0/0 root cause)", async () => {
		const h = makeHarness()
		await bind(h, "sess-usage", "t-usage")
		h.replies.set("journal.replay", { kind: "value", value: { rows: [], cursor: 1 } })
		// The REAL wire shape from assistant/message.data.usage — the seam used to
		// read only {prompt,cacheRead}, so every field was missed and the panel
		// painted "cache read/write 0 / 0".
		h.emit({
			type: "turn.end",
			payload: {
				turnId: "t-usage-2",
				text: "",
				usage: { inputTokens: 188, outputTokens: 378, totalTokens: 14646, cacheReadTokens: 14080 },
			},
		})
		const info = (await h.seam.sessionInfo())!
		expect(info.cacheRead).toBe(14080)
		expect(info.cacheWrite).toBe(0)
		expect(info.tokensIn).toBe(188)
		expect(info.tokensOut).toBe(378)
		expect(h.seam.usageSummary()).toEqual(["turns 1", "prompt 188 tok", "completion 378 tok"])
	})

	test("cacheHitRate mirrors remote exactly: lastMessage = latest row, session = cumulative", async () => {
		const h = makeHarness()
		await bind(h, "sess-cache", "t-cache")
		// Numbers lifted from remote-host-session.test.ts:445-457 so the two
		// seams' formulas are asserted against the same billing sample.
		h.replies.set("journal.replay", {
			kind: "value",
			value: {
				rows: [
					assistant(1, { inputTokens: 100, outputTokens: 5, cacheReadTokens: 900, totalTokens: 1005 }),
					assistant(2, { inputTokens: 800, outputTokens: 3, cacheReadTokens: 200, totalTokens: 1003 }),
				],
				cursor: 3,
			},
		})
		await h.seam.sessionInfo()
		// lastMessage bills INPUT only (prompt + cacheRead + cacheWrite), never
		// output — exactly remote-host-session.ts:2532-2533 and its test (20%).
		expect(h.seam.cacheHitRate()).toBeCloseTo(20, 5)
		expect(h.seam.cacheHitRate("lastMessage")).toBeCloseTo(20, 5)
		expect(h.seam.cacheHitRate("session")).toBeCloseTo(55, 5) // 1100 / (900+1100+0)
	})

	test("contextTokens/contextWindow derive from the journal usage + request/context rows", async () => {
		const h = makeHarness()
		await bind(h, "sess-ctx", "t-ctx")
		h.replies.set("model.currentSelection", { kind: "value", value: selection })
		h.replies.set("journal.replay", {
			kind: "value",
			value: {
				rows: [
					{ seq: 1, type: "request/context", payload: { ...selection, contextWindow: 1_000_000 } },
					assistant(2, { inputTokens: 188, outputTokens: 378, cacheReadTokens: 14080, totalTokens: 14646 }),
				],
				cursor: 3,
			},
		})
		const info = (await h.seam.sessionInfo())!
		expect(h.seam.contextTokens()).toBe(14646)
		expect(h.seam.contextWindow()).toBe(1_000_000)
		expect(info.contextTokens).toBe(14646)
		expect(info.contextWindow).toBe(1_000_000)
	})

	test("honest gates: no cache traffic → null rate; stale route → null window", async () => {
		const h = makeHarness()
		await bind(h, "sess-gate", "t-gate")
		h.replies.set("model.currentSelection", {
			kind: "value",
			value: { provider: "other", model: "other-model" },
		})
		h.replies.set("journal.replay", {
			kind: "value",
			value: {
				rows: [
					{ seq: 1, type: "request/context", payload: { ...selection, contextWindow: 1_000_000 } },
					assistant(2, { inputTokens: 10, outputTokens: 2, totalTokens: 12 }),
				],
				cursor: 3,
			},
		})
		const info = (await h.seam.sessionInfo())!
		expect(h.seam.cacheHitRate()).toBeNull() // no cacheRead/cacheWrite row
		expect(h.seam.cacheHitRate("session")).toBeNull()
		expect(h.seam.contextTokens()).toBe(12)
		expect(h.seam.contextWindow()).toBeNull() // journal row is for a different route
		expect(info.contextWindow).toBeNull()
	})

	test("new telemetry rides the single-flight incremental tally — no double counting", async () => {
		const h = makeHarness()
		await bind(h, "sess-inc-telemetry", "t-inc-tel")
		h.replies.set("model.currentSelection", { kind: "value", value: selection })
		const rows = [
			assistant(1, { inputTokens: 100, outputTokens: 5, cacheReadTokens: 900, totalTokens: 1005 }),
			assistant(2, { inputTokens: 800, outputTokens: 3, cacheReadTokens: 200, totalTokens: 1003 }),
		]
		h.replies.set("journal.replay", { kind: "value", value: { rows, cursor: 3 } })
		await h.seam.sessionInfo()
		const firstRate = h.seam.cacheHitRate("session")
		const firstTokens = h.seam.contextTokens()
		await h.seam.sessionInfo()
		expect(h.seam.cacheHitRate("session")).toBe(firstRate)
		expect(h.seam.contextTokens()).toBe(firstTokens)
		expect(firstRate).toBeCloseTo(55, 5)
	})
})

// ---------------------------------------------------------------------------
// Subagent visibility (inproc row 33): live agent.spawn/settle frames + replay
// ---------------------------------------------------------------------------

describe("subagent lifecycle rows (inproc visibility)", () => {
	const replayRow = (seq: number, type: string, payload: Record<string, unknown>): BridgeReplayRow => ({ seq, type, payload })

	test("replay projection: spawn → running → settle by runId:seq, remote view shape", () => {
		const t0 = 1_000_000
		const rows = [
			replayRow(1, "tool-workflow/agent-start", { runId: "r", seq: 0, label: "scout", childId: "child-a" }),
		]
		const running = bridgeReplayRowsToSubagentViews(rows, t0)
		expect(running).toHaveLength(1)
		expect(running[0]).toEqual({
			id: "child-a",
			label: "scout",
			status: "running",
			rounds: 0,
			startedAt: t0,
		})

		// Settled: startedAt dropped, elapsedSec + endedAt added, outcome mapped.
		// Replay rows carry no wall clock, so both rows fold at the discovery `now`
		// and a replayed settled child shows elapsedSec 0 (duration unknowable from
		// the journal — the documented wall-clock approximation).
		const settled = bridgeReplayRowsToSubagentViews(
			[...rows, replayRow(2, "tool-workflow/agent-end", { runId: "r", seq: 0, outcome: "cancelled" })],
			t0 + 3_000,
		)
		expect(settled).toHaveLength(1)
		expect(settled[0]).toEqual({
			id: "child-a",
			label: "scout",
			status: "cancelled",
			rounds: 0,
			elapsedSec: 0,
			endedAt: t0 + 3_000,
		})
		// No `startedAt` on a settled row — exact parity with #projectSubagentViews.
		expect("startedAt" in settled[0]!).toBe(false)
	})

	test("replay: start without terminal stays running; multiple children pair independently", () => {
		const t0 = 500_000
		const views = bridgeReplayRowsToSubagentViews([
			replayRow(1, "tool-workflow/agent-start", { runId: "r", seq: 0, label: "A", childId: "c-a" }),
			replayRow(2, "tool-workflow/agent-start", { runId: "r", seq: 1, label: "B", childId: "c-b" }),
			replayRow(3, "tool-workflow/agent-end", { runId: "r", seq: 1, outcome: "failed" }),
		], t0)
		expect(views).toHaveLength(2)
		const a = views.find((v) => v.id === "c-a")!
		const b = views.find((v) => v.id === "c-b")!
		expect(a.status).toBe("running") // no terminal → running (wall-clock approximation)
		expect(b.status).toBe("failed")
		expect(b.elapsedSec).toBe(0)
	})

	test("replay: plain subagent/catalog rows fold to running children (the real delegation record)", () => {
		const t0 = 700_000
		const views = bridgeReplayRowsToSubagentViews([
			replayRow(1, "subagent/catalog", {
				version: 3, childId: "child-cat", childCreatedAt: 699_000,
				mode: "continuable", label: "List and verify primes", name: "primes",
			}),
		], t0)
		expect(views).toHaveLength(1)
		expect(views[0]).toMatchObject({
			id: "child-cat",
			label: "List and verify primes",
			// F5: the fold must carry name into the view — without this the
			// renderer has no independent name channel (fake wiring).
			name: "primes",
			status: "running",
			rounds: 0,
			// P3-2: a catalog row carries the host's real childCreatedAt (epoch ms),
			// so the replay anchor is that clock, NOT the discovery `now`.
			startedAt: 699_000,
		})
		// No agent-end terminal exists for a plain child → stays running.
		expect(views[0]!.status).toBe("running")
	})

	// ---- oldfox 9190946 review P1-2 / P2-2② / P3-1 补测 ---------------------

	test("P1-2: a user/message subagent-settled notice settles the catalog child by senderSessionId (no runId pairing)", () => {
		// Real evidence: ad45fecb seq21 catalog childId == seq37 settle
		// source.senderSessionId (byte-identical); the settle has stopReason too.
		const t0 = 700_000
		const views = bridgeReplayRowsToSubagentViews([
			replayRow(21, "subagent/catalog", {
				version: 3, childId: "child-settle", childCreatedAt: 690_000, label: "primes", name: "prime-checker",
			}),
			replayRow(37, "user/message", {
				content: [{ type: "text", text: "done" }],
				source: {
					kind: "subagent-settled", form: "notice", summary: "finished",
					stopReason: "completed", senderSessionId: "child-settle",
				},
				role: "user", id: "m-37",
			}),
		], t0)
		expect(views).toHaveLength(1)
		expect(views[0]).toMatchObject({
			id: "child-settle", label: "primes", status: "completed",
			// F5: settling must not drop the carried child name.
			name: "prime-checker",
			// childCreatedAt anchors the duration; now freezes it at settle.
			elapsedSec: 10, endedAt: t0,
		})
		expect("startedAt" in views[0]!).toBe(false)
	})

	test("P1-2: stopReason maps failed/cancelled verbatim; anything else is conservatively completed", () => {
		const settledWith = (stopReason: unknown): SeamSubagentView =>
			bridgeReplayRowsToSubagentViews([
				replayRow(1, "subagent/catalog", { childId: "c", childCreatedAt: 1_000, label: "L" }),
				replayRow(2, "user/message", { source: { kind: "subagent-settled", stopReason, senderSessionId: "c" } }),
			], 2_000)[0]!
		expect(settledWith("completed").status).toBe("completed")
		expect(settledWith("failed").status).toBe("failed")
		expect(settledWith("cancelled").status).toBe("cancelled")
		// L2a display mapping: `aborted` is a real user-interrupt terminal —
		// it must NOT fold into completed (0.23.0 P1-3). SeamSubagentView.status
		// gains "interrupted" in L3; the shell already returns that string.
		expect(settledWith("aborted").status as string).toBe("interrupted")
		// Unknown / absent stopReason never paints a false failure.
		expect(settledWith("interrupted").status).toBe("completed")
		expect(settledWith(undefined).status).toBe("completed")
	})

	test("P1-2 known residue: an aborted parent turn leaves the catalog child running (no settle row, no wall-clock fallback)", () => {
		// Real evidence: 2d692fc9 catalog seq24, turn/end aborted seq32, no settle.
		const views = bridgeReplayRowsToSubagentViews([
			replayRow(24, "subagent/catalog", { childId: "ghost", childCreatedAt: 1_000, label: "G" }),
			replayRow(32, "turn/end", { reason: { kind: "aborted", reason: { kind: "disposed" } } }),
		], 2_000)
		expect(views).toHaveLength(1)
		expect(views[0]).toMatchObject({ id: "ghost", status: "running", startedAt: 1_000 })
		// No client-invented force-settle: a ghost stays running, no elapsedSec/endedAt.
		expect("elapsedSec" in views[0]!).toBe(false)
		expect("endedAt" in views[0]!).toBe(false)
	})

	test("P2-2②: catalog + tool-workflow rows in one journal stay isolated (two family keys)", () => {
		const views = bridgeReplayRowsToSubagentViews([
			replayRow(1, "subagent/catalog", { childId: "cat-1", childCreatedAt: 900_000, label: "catalog scout" }),
			replayRow(2, "tool-workflow/agent-start", { runId: "wf", seq: 0, childId: "wf-1", label: "workflow scout" }),
			replayRow(3, "tool-workflow/agent-end", { runId: "wf", seq: 0, outcome: "failed" }),
			replayRow(4, "user/message", {
				source: { kind: "subagent-settled", stopReason: "completed", senderSessionId: "cat-1" },
			}),
		], 1_000_000)
		expect(views).toHaveLength(2)
		expect(views.find((v) => v.id === "cat-1")).toMatchObject({ status: "completed" })
		expect(views.find((v) => v.id === "wf-1")).toMatchObject({ status: "failed" })
	})

	test("P2-2②: repeated catalog rows for the same childId are idempotent (one row)", () => {
		const rows = [
			replayRow(1, "subagent/catalog", { childId: "dup", childCreatedAt: 1_000, label: "L" }),
			replayRow(2, "subagent/catalog", { childId: "dup", childCreatedAt: 1_000, label: "L" }),
			replayRow(3, "subagent/catalog", { childId: "dup", childCreatedAt: 1_000, label: "L" }),
		]
		const views = bridgeReplayRowsToSubagentViews(rows, 2_000)
		expect(views).toHaveLength(1)
		expect(views[0]).toMatchObject({ id: "dup", status: "running", startedAt: 1_000 })
	})

	test("P2-2②: catalog-after-settle REVIVES (catalog family) but spawn-after-settle does NOT (tool-workflow family)", () => {
		const views = bridgeReplayRowsToSubagentViews([
			// catalog family: settle then a NEW catalog of the same child.
			replayRow(1, "subagent/catalog", { childId: "revive-cat", childCreatedAt: 1_000, label: "L" }),
			replayRow(2, "user/message", {
				source: { kind: "subagent-settled", stopReason: "completed", senderSessionId: "revive-cat" },
			}),
			replayRow(3, "subagent/catalog", { childId: "revive-cat", childCreatedAt: 3_000, label: "L2" }),
			// tool-workflow family: settle then a NEW agent-start of the same child.
			replayRow(4, "tool-workflow/agent-start", { runId: "wf", seq: 0, childId: "no-revive-wf", label: "W" }),
			replayRow(5, "tool-workflow/agent-end", { runId: "wf", seq: 0, outcome: "completed" }),
			replayRow(6, "tool-workflow/agent-start", { runId: "wf2", seq: 0, childId: "no-revive-wf", label: "W" }),
		], 4_000)
		const cat = views.find((v) => v.id === "revive-cat")!
		const wf = views.find((v) => v.id === "no-revive-wf")!
		expect(cat.status).toBe("running") // revived
		expect(cat.startedAt).toBe(3_000) // new run's childCreatedAt
		expect(cat.label).toBe("L2")
		expect(wf.status).toBe("completed") // NOT revived
		expect("startedAt" in wf).toBe(false)
	})

	test("P3-1: a tool-workflow agent-start with a catalog: runId is rejected (no family key collision)", () => {
		const views = bridgeReplayRowsToSubagentViews([
			replayRow(1, "subagent/catalog", { childId: "real-cat", childCreatedAt: 1_000, label: "C" }),
			replayRow(2, "tool-workflow/agent-start", {
				runId: "catalog:intruder", seq: 0, childId: "intruder", label: "I",
			}),
		], 2_000)
		expect(views).toHaveLength(1)
		expect(views[0]!.id).toBe("real-cat")
	})

	test("shape parity with the remote adapter's SeamSubagentView (field set)", () => {
		const view = bridgeReplayRowsToSubagentViews([
			replayRow(1, "tool-workflow/agent-start", { runId: "r", seq: 0, label: "A", childId: "c-a" }),
		], 100)[0]!
		// Keys are a strict subset of SeamSubagentView; the dock (mergedRunningAgents)
		// needs exactly id/label/status/startedAt, the viewer needs rounds/status.
		const allowed = new Set([
			"id", "label", "model", "status", "rounds", "startedAt", "elapsedSec", "endedAt",
			"injectedRound", "hardStopRound", "spinStopRound", "lastLine",
		])
		for (const key of Object.keys(view)) expect(allowed.has(key)).toBe(true)
		const typed: SeamSubagentView = view
		expect(typed.id).toBe("c-a")
		expect(typed.status).toBe("running")
	})

	test("live frames: agent.spawn → running, onSubagentViews pushes, agent.settle → completed", () => {
		const h = makeHarness()
		const snapshots: SeamSubagentView[][] = []
		const unsub = h.seam.onSubagentViews((views) => snapshots.push(views))
		expect(snapshots).toHaveLength(1) // immediate replay of the empty snapshot
		expect(snapshots[0]).toEqual([])

		h.emit({
			type: "agent.spawn",
			payload: { childId: "live-1", label: "live scout", runId: "rl", seq: 0 },
		})
		expect(h.seam.subagentViews()).toMatchObject([
			{ id: "live-1", label: "live scout", status: "running" },
		])
		expect(snapshots).toHaveLength(2)
		expect(snapshots[1]![0]!.status).toBe("running")

		h.emit({ type: "agent.settle", payload: { runId: "rl", seq: 0, outcome: "completed" } })
		const settled = h.seam.subagentViews()
		expect(settled).toHaveLength(1)
		expect(settled[0]!.status).toBe("completed")
		expect(typeof settled[0]!.elapsedSec).toBe("number")
		expect(settled[0]!.endedAt).toBeDefined()
		expect("startedAt" in settled[0]!).toBe(false)
		expect(snapshots).toHaveLength(3)

		unsub()
		h.emit({ type: "agent.spawn", payload: { childId: "live-2", label: "after unsub", runId: "r2", seq: 0 } })
		expect(snapshots).toHaveLength(3) // no further pushes after unsubscribe
		expect(h.seam.subagentViews()).toHaveLength(2) // state still updates
	})

	test("live-visibility: a catalog: prefixed live agent.spawn inserts a running row immediately (P3-1 viaCatalog guard must not drop it)", () => {
		// 0.23.1 live-visibility fix: the bridge forwards a plain `subagent`
		// catalog event as an additive agent.spawn whose runId is the catalog
		// synthetic key `catalog:<childId>`. Folding it as a tool-workflow
		// agent-start would hit the P3-1 collision guard (viaCatalog!==true)
		// and silently drop the frame — the running child stayed invisible in
		// ctrl+g until a later journal drain. The seam must route it through
		// the catalog branch and insert the running row immediately.
		const h = makeHarness()
		const snapshots: SeamSubagentView[][] = []
		h.seam.onSubagentViews((views) => snapshots.push(views))

		h.emit({
			type: "agent.spawn",
			payload: {
				childId: "live-cat-child",
				label: "live catalog child",
				runId: "catalog:live-cat-child",
				seq: 0,
			},
		})

		expect(h.seam.subagentViews()).toMatchObject([
			{ id: "live-cat-child", label: "live catalog child", status: "running" },
		])
		// The running row is pushed to subscribers immediately, not deferred
		// to a later journal drain.
		expect(snapshots).toHaveLength(2)
		expect(snapshots[1]![0]!.status).toBe("running")
	})

	test("live spawn upgrades a replay approximation to a real wall clock", async () => {
		const h = makeHarness()
		h.replies.set("journal.replay", {
			kind: "value",
			value: { rows: [replayRow(1, "tool-workflow/agent-start", { runId: "r", seq: 0, label: "A", childId: "c-a" })], cursor: 2 },
		})
		await h.seam.storedTranscript("sess-1")
		const approximate = h.seam.subagentViews()[0]!.startedAt!
		expect(typeof approximate).toBe("number")

		const before = Date.now() - 50
		h.emit({ type: "agent.spawn", payload: { childId: "c-a", label: "A", runId: "r", seq: 0 } })
		const upgraded = h.seam.subagentViews()[0]!.startedAt!
		expect(upgraded).toBeGreaterThanOrEqual(before)
		expect(h.seam.subagentViews()).toHaveLength(1) // no duplicate child
	})

	test("storedTranscript replays subagent rows into the live roster for the bound session", async () => {
		const h = makeHarness()
		const snapshots: SeamSubagentView[][] = []
		h.seam.onSubagentViews((views) => snapshots.push(views))
		h.replies.set("journal.replay", {
			kind: "value",
			value: {
				rows: [
					replayRow(1, "tool-workflow/agent-start", { runId: "r", seq: 0, label: "replayed", childId: "rp-1" }),
					replayRow(2, "tool-workflow/agent-end", { runId: "r", seq: 0, outcome: "completed" }),
				],
				cursor: 3,
			},
		})
		await h.seam.storedTranscript("sess-rp")
		const views = h.seam.subagentViews()
		expect(views).toHaveLength(1)
		expect(views[0]).toMatchObject({ id: "rp-1", status: "completed" })
		expect(snapshots.at(-1)![0]!.status).toBe("completed")
	})

	test("end-to-end: live frames drive the seam-rows `subagents:live` row the dock reads", async () => {
		const h = makeHarness()
		// createSeamRows reads storedTranscript on setup — default reply {} → [].
		let dispose!: () => void
		const projection = createRoot((d) => {
			dispose = d
			return createSeamRows(h.seam, () => "sess-e2e")
		})
		await Bun.sleep(0) // let the setup storedTranscript settle

		// Spawn → a subagents row appears with a RUNNING child (the dock's source).
		h.emit({ type: "agent.spawn", payload: { childId: "e2e-1", label: "e2e scout", runId: "re", seq: 0 } })
		const tree = projection.rows.find((r) => r.kind === "subagents")
		expect(tree).toBeDefined()
		if (tree?.kind === "subagents") {
			expect(tree.key).toBe("subagents:live")
			expect(tree.children).toHaveLength(1)
			expect(tree.children[0]!.id).toBe("e2e-1")
			expect(tree.children[0]!.status).toBe("running")
		}

		// Settle → the same row updates in place (one row, settled child).
		h.emit({ type: "agent.settle", payload: { runId: "re", seq: 0, outcome: "completed" } })
		expect(projection.rows.filter((r) => r.kind === "subagents")).toHaveLength(1)
		const settledTree = projection.rows.find((r) => r.kind === "subagents")
		if (settledTree?.kind === "subagents") {
			expect(settledTree.children[0]!.status).toBe("completed")
		}
		dispose()
	})

	// ---- oldfox 复审 P2-3 / P3 补测 -------------------------------------------

	test("① a post-turn frame (no activeTurn, empty turnId) still folds spawn → settle", () => {
		const h = makeHarness()
		const snapshots: SeamSubagentView[][] = []
		h.seam.onSubagentViews((views) => snapshots.push(views))

		// P2-1(a): with no active turn the bridge emits agent.spawn/settle with
		// an inert empty turnId (it pairs by runId:seq). The fold must not depend
		// on a turnId — pairing and the sessionId backstop are enough.
		h.emit({
			type: "agent.spawn",
			payload: { turnId: "", sessionId: "sess-idle", childId: "bg-1", label: "background", runId: "bg", seq: 0 },
		})
		expect(h.seam.subagentViews()).toMatchObject([{ id: "bg-1", status: "running", label: "background" }])
		h.emit({ type: "agent.settle", payload: { turnId: "", sessionId: "sess-idle", runId: "bg", seq: 0, outcome: "completed" } })
		expect(h.seam.subagentViews()[0]!.status).toBe("completed")
		expect(snapshots).toHaveLength(3)
	})

	test("② settle before its spawn is dropped — no ghost settled row", () => {
		const h = makeHarness()
		const snapshots: SeamSubagentView[][] = []
		h.seam.onSubagentViews((views) => snapshots.push(views))

		// No runSeq pairing exists yet: the end cannot name a child, so it must
		// be discarded rather than materialising a phantom settled view.
		h.emit({ type: "agent.settle", payload: { runId: "orphan", seq: 0, outcome: "completed" } })
		expect(h.seam.subagentViews()).toEqual([])
		expect(snapshots).toHaveLength(1) // no emit — nothing changed

		// A later spawn with that runId:seq registers normally as RUNNING; the
		// dropped settle never resurrects as a stale "completed" ghost.
		h.emit({ type: "agent.spawn", payload: { childId: "late", label: "L", runId: "orphan", seq: 0 } })
		expect(h.seam.subagentViews()).toMatchObject([{ id: "late", status: "running", label: "L" }])
	})

	test("③ repeated spawn / settle are idempotent (no duplicate rows or extra emits)", () => {
		const h = makeHarness()
		const snapshots: SeamSubagentView[][] = []
		h.seam.onSubagentViews((views) => snapshots.push(views))

		const spawn = { type: "agent.spawn", payload: { childId: "dup", label: "D", runId: "rd", seq: 0 } }
		h.emit(spawn)
		h.emit(spawn)
		expect(h.seam.subagentViews()).toHaveLength(1)
		expect(snapshots).toHaveLength(2) // initial empty + first spawn only

		const settle = { type: "agent.settle", payload: { runId: "rd", seq: 0, outcome: "completed" } }
		h.emit(settle)
		h.emit(settle)
		const views = h.seam.subagentViews()
		expect(views).toHaveLength(1)
		expect(views[0]!.status).toBe("completed")
		expect(snapshots).toHaveLength(3) // first settle only; the second is a no-op
	})

	test("④ spawn after settle does not revive the settled row (P3-1 running guard)", async () => {
		const h = makeHarness()
		const snapshots: SeamSubagentView[][] = []
		h.seam.onSubagentViews((views) => snapshots.push(views))
		h.replies.set("journal.replay", {
			kind: "value",
			value: {
				rows: [
					replayRow(1, "tool-workflow/agent-start", { runId: "r", seq: 0, label: "A", childId: "c" }),
					replayRow(2, "tool-workflow/agent-end", { runId: "r", seq: 0, outcome: "completed" }),
				],
				cursor: 3,
			},
		})
		// Replay folds with live=false, so the child is settled but NEVER entered
		// `liveStarts` — exactly the shape a late live spawn used to overwrite.
		await h.seam.storedTranscript("s")
		const settled = h.seam.subagentViews()[0]!
		expect(settled.status).toBe("completed")
		expect("startedAt" in settled).toBe(false)
		const before = snapshots.length

		h.emit({ type: "agent.spawn", payload: { childId: "c", label: "A", runId: "r", seq: 0 } })
		const after = h.seam.subagentViews()
		expect(after).toHaveLength(1)
		expect(after[0]!.status).toBe("completed")
		expect(after[0]!.endedAt).toBe(settled.endedAt)
		expect("startedAt" in after[0]!).toBe(false)
		expect(snapshots).toHaveLength(before) // no state change → no emit
	})

	test("P3-5: a later spawn adopts a new label on an existing child", () => {
		const h = makeHarness()
		h.emit({ type: "agent.spawn", payload: { childId: "x", label: "old", runId: "rx", seq: 0 } })
		expect(h.seam.subagentViews()[0]!.label).toBe("old")

		h.emit({ type: "agent.spawn", payload: { childId: "x", label: "new", runId: "rx", seq: 0 } })
		const views = h.seam.subagentViews()
		expect(views).toHaveLength(1) // no duplicate
		expect(views[0]!.label).toBe("new")
		expect(views[0]!.status).toBe("running") // still running, not revived/settled
	})

	test("⑤ session switch resets the roster and emits an empty snapshot (P3-2)", async () => {
		const h = makeHarness()
		const snapshots: SeamSubagentView[][] = []
		h.seam.onSubagentViews((views) => snapshots.push(views))
		h.replies.set("journal.replay", {
			kind: "fn",
			fn: (params) => ({
				kind: "value",
				value: {
					rows: params?.sessionId === "s1"
						? [replayRow(1, "tool-workflow/agent-start", { runId: "r1", seq: 0, label: "old", childId: "s1-child" })]
						: [],
					cursor: 2,
				},
			}),
		})

		await h.seam.storedTranscript("s1")
		expect(h.seam.subagentViews().map((v) => v.id)).toEqual(["s1-child"])
		const before = snapshots.length

		// New session has NO agent rows: the roster must still be reset and a
		// snapshot pushed, so a mounted viewer drops s1-child immediately.
		await h.seam.storedTranscript("s2")
		expect(h.seam.subagentViews()).toEqual([])
		expect(snapshots.length).toBe(before + 1)
		expect(snapshots.at(-1)).toEqual([])
	})

	test("⑥ recoverSession folds durable agent rows into the live roster", async () => {
		const h = makeHarness()
		h.replies.set("session.open", { kind: "value", value: { sessionId: "sess-rec", journalCursor: 9 } })
		h.replies.set("session.send", { kind: "value", value: { turnId: "t-rec" } })
		h.replies.set("journal.replay", {
			kind: "value",
			value: {
				rows: [
					replayRow(1, "tool-workflow/agent-start", { runId: "rr", seq: 0, label: "rec scout", childId: "rec-1" }),
					replayRow(2, "tool-workflow/agent-end", { runId: "rr", seq: 0, outcome: "completed" }),
				],
				cursor: 3,
			},
		})
		const snapshots: SeamSubagentView[][] = []
		h.seam.onSubagentViews((views) => snapshots.push(views))

		// Bind a session first — recovery has nothing to resume otherwise.
		h.seam.resumeSession("sess-rec")
		const done = h.seam.turn("go", {
			onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {},
		})
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t-rec", text: "" } })
		await done
		const before = snapshots.length

		const result = await h.seam.recoverSession()
		expect(result.state).toBe("attached")
		expect(result.applied).toBe(2)
		expect(h.seam.subagentViews().map((v) => [v.id, v.status])).toEqual([["rec-1", "completed"]])
		// T2: the restored roster also triggers ONE lazy child-journal read; when
		// it lands it repaints the snapshot (the fake journal.replay returns rows,
		// so meta folds in). before+1 = replay fold, +1 = journal meta write.
		expect(snapshots.length).toBe(before + 2)
		expect(snapshots.at(-1)![0]!.status).toBe("completed")
	})
})

// ---------------------------------------------------------------------------
// 0.23.0 T1 — registry sweep (mirror remote refreshFromList)
// ---------------------------------------------------------------------------

describe("0.23.0 T1: registry sweep of not-running subagent children", () => {
	test("pure decision: only subagent-origin + matching parent + running===false + locally running settles", () => {
		const rows = [
			{ sessionId: "c-settle", origin: "subagent", parentSessionId: "p", running: false },
			{ sessionId: "c-running", origin: "subagent", parentSessionId: "p", running: true },
			{ sessionId: "c-other-parent", origin: "subagent", parentSessionId: "q", running: false },
			{ sessionId: "c-user", origin: "user", parentSessionId: "p", running: false },
			{ sessionId: 42, origin: "subagent", parentSessionId: "p", running: false },
			{ origin: "subagent", parentSessionId: "p", running: false },
			{ sessionId: "c-not-in-catalog", origin: "subagent", parentSessionId: "p", running: false },
		]
		expect(bridgeSweepSettledChildIds(rows, "p", new Set(["c-settle", "c-running", "c-other-parent", "c-user"])))
			.toEqual(["c-settle"])
		// No parent bound → never sweep.
		expect(bridgeSweepSettledChildIds(rows, undefined, new Set(["c-settle"]))).toEqual([])
	})

	test("turn-end sweep settles the ghost child via the catalog settle path; running/other-parent untouched", async () => {
		const h = makeHarness()
		h.replies.set("session.open", { kind: "value", value: { sessionId: "p" } })
		h.replies.set("session.send", { kind: "value", value: { turnId: "t-sweep" } })
		h.replies.set("session.list", {
			kind: "value",
			value: {
				items: [
					{ sessionId: "ghost", origin: "subagent", parentSessionId: "p", running: false },
					{ sessionId: "alive", origin: "subagent", parentSessionId: "p", running: true },
					{ sessionId: "other-parent", origin: "subagent", parentSessionId: "q", running: false },
				],
			},
		})
		h.seam.resumeSession("p")
		const done = h.seam.turn("go", {
			onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {},
		})
		await Bun.sleep(0)
		h.emit({ type: "agent.spawn", payload: { sessionId: "p", childId: "ghost", label: "G" } })
		h.emit({ type: "agent.spawn", payload: { sessionId: "p", childId: "alive", label: "A" } })
		h.emit({ type: "agent.spawn", payload: { sessionId: "p", childId: "other-parent", label: "O" } })
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t-sweep", text: "" } })
		await done
		await Bun.sleep(0)

		const views = h.seam.subagentViews()
		const ghost = views.find((v) => v.id === "ghost")!
		expect(ghost.status).toBe("completed")
		expect(typeof ghost.endedAt).toBe("number") // catalog settle shape
		expect(views.find((v) => v.id === "alive")!.status).toBe("running")
		expect(views.find((v) => v.id === "other-parent")!.status).toBe("running")
	})

	test("recover sweep settles a ghost restored from the replay (client drives it — bridge has no recover event)", async () => {
		const h = makeHarness()
		h.replies.set("session.open", { kind: "value", value: { sessionId: "p" } })
		h.replies.set("journal.replay", {
			kind: "value",
			value: {
				rows: [{ seq: 1, type: "subagent/catalog", payload: { childId: "ghost", childCreatedAt: 1000, label: "G" } }],
				cursor: 2,
			},
		})
		h.replies.set("session.list", {
			kind: "value",
			value: { items: [{ sessionId: "ghost", origin: "subagent", parentSessionId: "p", running: false }] },
		})
		h.seam.resumeSession("p")
		const result = await h.seam.recoverSession()
		expect(result.state).toBe("attached")
		await Bun.sleep(0)
		const ghost = h.seam.subagentViews().find((v) => v.id === "ghost")!
		expect(ghost.status).toBe("completed")
	})

	test("a failed or malformed session.list read leaves the roster unchanged (never treats it as empty)", async () => {
		const h = makeHarness()
		h.replies.set("session.open", { kind: "value", value: { sessionId: "p" } })
		h.replies.set("session.send", { kind: "value", value: { turnId: "t-fail" } })
		h.replies.set("session.list", { kind: "error", error: new Error("list down") })
		h.seam.resumeSession("p")
		const done = h.seam.turn("go", {
			onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {},
		})
		await Bun.sleep(0)
		h.emit({ type: "agent.spawn", payload: { sessionId: "p", childId: "ghost", label: "G" } })
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t-fail", text: "" } })
		await done
		await Bun.sleep(0)
		expect(h.seam.subagentViews()[0]!.status).toBe("running")

		// A malformed reply (no items array) is equally NOT an empty registry.
		h.replies.set("session.list", { kind: "value", value: {} })
		h.emit({ type: "turn.end", payload: { turnId: "t-fail", text: "" } })
		await Bun.sleep(0)
		expect(h.seam.subagentViews()[0]!.status).toBe("running")
	})

	test("P2-1a: a plain storedTranscript (resume/viewer open) sweeps a host-stopped catalog child to settled", async () => {
		const h = makeHarness()
		h.replies.set("journal.replay", {
			kind: "value",
			value: {
				rows: [{ seq: 1, type: "subagent/catalog", payload: { childId: "ghost", childCreatedAt: 1000, label: "G" } }],
				cursor: 2,
			},
		})
		h.replies.set("session.list", {
			kind: "value",
			value: { items: [{ sessionId: "ghost", origin: "subagent", parentSessionId: "old-sess", running: false }] },
		})
		// No turn/terminal at all — this is a pure resume/viewer read of an old session.
		await h.seam.storedTranscript("old-sess")
		await Bun.sleep(0)
		await Bun.sleep(0)
		const ghost = h.seam.subagentViews().find((v) => v.id === "ghost")!
		expect(ghost.status).toBe("completed")
		expect(typeof ghost.endedAt).toBe("number")
	})
})

// ---------------------------------------------------------------------------
// 0.23.0 T2 — child journal meta (rounds / lastLine / model)
// ---------------------------------------------------------------------------

describe("0.23.0 T2: child journal rounds/lastLine/model from journal.replay", () => {
	const childRows = (): BridgeReplayRow[] => [
		{ seq: 1, type: "subagent/descriptor", payload: { agentModel: "descriptor-model", agentProvider: "p", label: "L" } },
		{ seq: 2, type: "assistant/message", payload: { message: { content: [{ type: "text", text: "first\nsecond" }] } } },
		{ seq: 3, type: "assistant/message", payload: { content: [{ type: "text", text: "last out\n" }] } },
	]

	test("rounds = assistant/message row count; lastLine = last body tail; model = descriptor.agentModel fallback", () => {
		expect(bridgeChildJournalMeta(childRows())).toEqual({
			rounds: 2, lastLine: "last out", model: "descriptor-model",
		})
	})

	test("request/context.model wins over the descriptor fallback", () => {
		const meta = bridgeChildJournalMeta([...childRows(), { seq: 4, type: "request/context", payload: { model: "ctx-model" } }])
		expect(meta.model).toBe("ctx-model")
		expect(meta.rounds).toBe(2)
	})

	test("P2-3b: a non-error tool/result tail becomes lastLine (remote parity); error results keep the prior tail", () => {
		const rows: BridgeReplayRow[] = [
			{ seq: 1, type: "assistant/message", payload: { content: [{ type: "text", text: "assistant line" }] } },
			{ seq: 2, type: "tool/result", payload: { content: [{ type: "text", text: "tool printed this\n" }] } },
		]
		const meta = bridgeChildJournalMeta(rows)
		expect(meta.lastLine).toBe("tool printed this")
		expect(meta.rounds).toBe(1) // a tool/result is NOT a round

		const withError = bridgeChildJournalMeta([
			...rows,
			{ seq: 3, type: "tool/result", payload: { isError: true, content: [{ type: "text", text: "boom" }] } },
		])
		expect(withError.lastLine).toBe("tool printed this") // error keeps the last good tail
	})

	test("no assistant rows → rounds 0 and no lastLine/model (not fabricated)", () => {
		expect(bridgeChildJournalMeta([{ seq: 1, type: "turn/start", payload: {} }])).toEqual({ rounds: 0 })
	})

	test("lazy read writes real meta into the view; a failed read keeps the degraded row untouched", async () => {
		const h = makeHarness()
		h.replies.set("journal.replay", { kind: "value", value: { rows: childRows(), cursor: 4 } })
		h.emit({ type: "agent.spawn", payload: { sessionId: "p", childId: "c1", label: "L", childCreatedAt: 1000 } })
		await Bun.sleep(0)
		expect(h.seam.subagentViews()[0]).toMatchObject({
			id: "c1", rounds: 2, lastLine: "last out", model: "descriptor-model",
		})

		// A second child whose journal read fails keeps its degraded values; the
		// successfully-read child is NOT zeroed by the other child's failure.
		h.replies.set("journal.replay", { kind: "error", error: new Error("journal down") })
		h.emit({ type: "agent.spawn", payload: { sessionId: "p", childId: "c2", label: "L2", childCreatedAt: 2000 } })
		await Bun.sleep(0)
		const views = h.seam.subagentViews()
		expect(views.find((v) => v.id === "c1")!.rounds).toBe(2)
		const c2 = views.find((v) => v.id === "c2")!
		expect(c2.rounds).toBe(0)
		expect(c2.model).toBeUndefined()
		expect(c2.lastLine).toBeUndefined()
	})

	test("P1-3a: settle re-reads the FULL child journal under the id@\"\" key (terminal rounds/lastLine/model)", async () => {
		// The running view's first lazy read sees only 1 round. bridgeSettleChild
		// drops startedAt → cache key flips id@<start> → id@"" → the post-settle
		// #syncSubagentMeta re-reads the whole journal and folds the TERMINAL
		// rounds/lastLine/model (ctrl+g accuracy pillar for done children).
		const firstRead: BridgeReplayRow[] = [
			{ seq: 1, type: "assistant/message", payload: { content: [{ type: "text", text: "only round" }] } },
		]
		let currentRows = firstRead
		const h = makeHarness()
		h.replies.set("journal.replay", {
			kind: "fn",
			fn: () => ({ kind: "value", value: { rows: currentRows, cursor: 10 } }),
		})

		// Spawn with a real wall clock (live frame) so the running key is id@<start>.
		h.emit({ type: "agent.spawn", payload: { sessionId: "p", childId: "term-child", label: "L", runId: "rt", seq: 0 } })
		await Bun.sleep(0)
		const running = h.seam.subagentViews()[0]!
		expect(running.rounds).toBe(1)
		expect(running.lastLine).toBe("only round")
		expect("startedAt" in running).toBe(true)
		expect(h.requests.filter((r) => r.method === "journal.replay")).toHaveLength(1)

		// The child does more work before its terminal is journalled.
		currentRows = [
			...firstRead,
			{ seq: 2, type: "assistant/message", payload: { content: [{ type: "text", text: "second" }] } },
			{ seq: 3, type: "assistant/message", payload: { content: [{ type: "text", text: "final line" }] } },
			{ seq: 4, type: "request/context", payload: { model: "final-model" } },
		]
		// Settle via the tool-workflow pairing (runId:seq) — drops startedAt.
		h.emit({ type: "agent.settle", payload: { runId: "rt", seq: 0, outcome: "completed" } })
		await Bun.sleep(0)
		await Bun.sleep(0)

		const settled = h.seam.subagentViews()[0]!
		expect(settled.status).toBe("completed")
		expect("startedAt" in settled).toBe(false)
		expect(settled.rounds).toBe(3) // terminal value, NOT the stale pre-settle 1
		expect(settled.lastLine).toBe("final line")
		expect(settled.model).toBe("final-model")
		expect(h.requests.filter((r) => r.method === "journal.replay")).toHaveLength(2)
	})
})

// ---------------------------------------------------------------------------
// 0.23.0 真机验收回归 — rounds 被 replay refold 归零 / 幽灵被 revive 复活
// ---------------------------------------------------------------------------

describe("0.23.0 acceptance regressions (replay refold must not undo T1/T2)", () => {
	const terminalChildRows: BridgeReplayRow[] = [
		{ seq: 1, type: "assistant/message", payload: { message: { content: [{ type: "text", text: "first" }] } } },
		{ seq: 2, type: "assistant/message", payload: { message: { content: [{ type: "text", text: "second" }] } } },
		{ seq: 3, type: "turn/end", payload: { reason: { kind: "completed" } } },
	]

	test("journal 行数 2 → view.rounds=2；已 settle 再经 catalog revive+re-settle 仍保 2", async () => {
		const h = makeHarness()
		const parentRows = [
			{ seq: 18, type: "subagent/catalog", payload: { childId: "f2c9", childCreatedAt: 1_795_092_710_913, label: "L" } },
			{ seq: 29, type: "user/message", payload: {
				source: { kind: "subagent-settled", stopReason: "completed", senderSessionId: "f2c9" },
			} },
		]
		h.replies.set("journal.replay", {
			kind: "fn",
			fn: (p) => ({ kind: "value", value: { rows: p?.sessionId === "f2c9" ? terminalChildRows : parentRows, cursor: 30 } }),
		})
		h.replies.set("session.list", { kind: "value", value: { items: [] } })

		await h.seam.storedTranscript("parent")
		await Bun.sleep(0)
		expect(h.seam.subagentViews()[0]).toMatchObject({
			id: "f2c9", status: "completed", rounds: 2, lastLine: "second",
		})

		// 下一个 turn 边界再次全量 replay：catalog 族 REVIVE（rounds 归 0、重建
		// startedAt）后 settle 行再结算。缓存的同 run journal meta 必须把 rounds
		// / lastLine 恢复回来，且不重新读 journal。
		await h.seam.storedTranscript("parent")
		await Bun.sleep(0)
		expect(h.seam.subagentViews()[0]).toMatchObject({
			id: "f2c9", status: "completed", rounds: 2, lastLine: "second",
		})
		expect(h.requests.filter((r) => r.method === "journal.replay" && r.params?.sessionId === "f2c9")).toHaveLength(1)
	})

	test("list 回该 child running=false → view completed；journal 无 turn/end 且后续 catalog-only replay 不复活", async () => {
		const h = makeHarness()
		const catalogOnly = [
			{ seq: 83, type: "subagent/catalog", payload: { childId: "ghost", childCreatedAt: 1_795_092_985_142, label: "G" } },
		]
		// 子 journal 无 turn/end、无 settle 行 —— sweep 不依赖 journal terminal。
		h.replies.set("journal.replay", { kind: "fn", fn: () => ({ kind: "value", value: { rows: catalogOnly, cursor: 84 } }) })
		h.replies.set("session.list", {
			kind: "fn",
			fn: () => ({
				kind: "value",
				value: { items: [{ sessionId: "ghost", origin: "subagent", parentSessionId: "parent", running: false }] },
			}),
		})

		await h.seam.storedTranscript("parent")
		await Bun.sleep(0)
		expect(h.seam.subagentViews()[0]).toMatchObject({ id: "ghost", status: "completed" })

		// 宿主 list 不再报 stopped，后续 replay 又只带回 catalog 行（无 settle 行）。
		// sweep 的结算必须 sticky：不靠 wall-clock、不靠 journal terminal。
		h.replies.set("session.list", { kind: "value", value: { items: [] } })
		await h.seam.storedTranscript("parent")
		await Bun.sleep(0)
		expect(h.seam.subagentViews()[0]).toMatchObject({ id: "ghost", status: "completed" })
	})

	test("genuine catalog REVIVE (new childCreatedAt) does not match the old sticky key and stays running", async () => {
		const h = makeHarness()
		const firstCatalog = [{ seq: 83, type: "subagent/catalog", payload: { childId: "revive", childCreatedAt: 1000, label: "G" } }]
		const secondCatalog = [{ seq: 90, type: "subagent/catalog", payload: { childId: "revive", childCreatedAt: 9000, label: "G2" } }]
		let rows = firstCatalog
		h.replies.set("journal.replay", { kind: "fn", fn: () => ({ kind: "value", value: { rows, cursor: 100 } }) })
		h.replies.set("session.list", {
			kind: "fn",
			fn: () => ({
				kind: "value",
				value: { items: [{ sessionId: "revive", origin: "subagent", parentSessionId: "parent", running: false }] },
			}),
		})
		await h.seam.storedTranscript("parent")
		await Bun.sleep(0)
		expect(h.seam.subagentViews()[0]!.status).toBe("completed")

		// 同一 childId 的新 run（新 childCreatedAt）不是旧 sweep 的幽灵，必须
		// 保持 running，不能让 sticky settle 误杀。
		rows = secondCatalog
		h.replies.set("session.list", { kind: "value", value: { items: [] } })
		await h.seam.storedTranscript("parent")
		await Bun.sleep(0)
		expect(h.seam.subagentViews()[0]).toMatchObject({ id: "revive", status: "running", startedAt: 9000, label: "G2" })
	})

	test("P1: settled elapsedSec/endedAt frozen across two replays at different wall clocks", async () => {
		const h = makeHarness()
		const parentRows = [
			{ seq: 18, type: "subagent/catalog", payload: { childId: "frozen", childCreatedAt: Date.now() - 60_000, label: "L" } },
			{ seq: 29, type: "user/message", payload: {
				source: { kind: "subagent-settled", stopReason: "completed", senderSessionId: "frozen" },
			} },
		]
		h.replies.set("journal.replay", { kind: "fn", fn: (p) => ({ kind: "value", value: { rows: p?.sessionId === "frozen" ? [] : parentRows, cursor: 30 } }) })
		h.replies.set("session.list", { kind: "value", value: { items: [] } })

		await h.seam.storedTranscript("parent")
		await Bun.sleep(0)
		const first = h.seam.subagentViews()[0]!
		expect(first.status).toBe("completed")
		expect(typeof first.elapsedSec).toBe("number")
		expect(first.elapsedSec!).toBeGreaterThanOrEqual(55)

		// 两个 turn 边界之后再次全量 replay —— 墙钟已前进，但 settle 快照必须
		// 冻结 elapsedSec / endedAt（远端 settle 即冻结，session-seam-adapter:715-721）。
		await Bun.sleep(260)
		await h.seam.storedTranscript("parent")
		await Bun.sleep(0)
		const second = h.seam.subagentViews()[0]!
		expect(second.status).toBe("completed")
		expect(second.elapsedSec).toBe(first.elapsedSec)
		expect(second.endedAt).toBe(first.endedAt)
	})

	test("P2b: settle boundary emits no transient rounds=0 while id@\"\" terminal read is pending", async () => {
		const h = makeHarness()
		const snapshots: SeamSubagentView[][] = []
		h.seam.onSubagentViews((views) => snapshots.push(views))
		let currentRows: BridgeReplayRow[] = [
			{ seq: 1, type: "assistant/message", payload: { content: [{ type: "text", text: "only round" }] } },
		]
		h.replies.set("journal.replay", { kind: "fn", fn: () => ({ kind: "value", value: { rows: currentRows, cursor: 10 } }) })

		// running child with a cached journal meta (rounds=1)
		h.emit({ type: "agent.spawn", payload: { sessionId: "p", childId: "mid", label: "L", runId: "rt", seq: 0 } })
		await Bun.sleep(0)
		expect(h.seam.subagentViews()[0]!.rounds).toBe(1)
		// Only the settle-boundary window matters — the initial spawn's rounds=0
		// (before any journal read) is a legitimate, unavoidable first paint.
		snapshots.length = 0

		// settle: the id@"" terminal read sees newer rows (rounds=3). The panel must
		// never observe rounds=0 in the gap — prior run-key meta bridges it.
		currentRows = [
			...currentRows,
			{ seq: 2, type: "assistant/message", payload: { content: [{ type: "text", text: "second" }] } },
			{ seq: 3, type: "assistant/message", payload: { content: [{ type: "text", text: "final" }] } },
		]
		h.emit({ type: "agent.settle", payload: { runId: "rt", seq: 0, outcome: "completed" } })
		await Bun.sleep(0)
		await Bun.sleep(0)

		const roundsSeen = snapshots.map((s) => s.find((v) => v.id === "mid")?.rounds).filter((r) => r !== undefined)
		expect(roundsSeen.length).toBeGreaterThan(0)
		expect(roundsSeen.every((r) => r! >= 1)).toBe(true)
		expect(h.seam.subagentViews()[0]!.rounds).toBe(3)
	})
})

// ---------------------------------------------------------------------------
// L2a (0.23.1) — capability negotiation + subagent stop frames + settle handoff
// ---------------------------------------------------------------------------

describe("L2a: bridge capabilities (additive hello/ping field)", () => {
	test("old bridge: no capabilities field → every capability is absent (no child probing)", async () => {
		const h = makeHarness()
		h.replies.set("bridge.ping", { kind: "value", value: { protocolVersion: 1, bridgeVersion: "0.2.2" } })
		await h.seam.connect()
		expect(h.seam.hasBridgeCapability("subagents.interrupt")).toBe(false)
		expect(h.seam.hasBridgeCapability("subagents.stopChildren")).toBe(false)
	})

	test("new bridge: advertised capabilities resolve; malformed entries dropped; reconnect replaces the set", async () => {
		const h = makeHarness()
		h.replies.set("bridge.ping", {
			kind: "value",
			value: { protocolVersion: 1, capabilities: ["subagents.interrupt", "subagents.stopChildren", 42, ""] },
		})
		await h.seam.connect()
		expect(h.seam.hasBridgeCapability("subagents.interrupt")).toBe(true)
		expect(h.seam.hasBridgeCapability("subagents.stopChildren")).toBe(true)
		expect(h.seam.hasBridgeCapability("subagents.nope")).toBe(false)

		// A malformed / missing array clears the old set (recovered bridge may be older).
		h.replies.set("bridge.ping", { kind: "value", value: { capabilities: "not-an-array" } })
		await h.seam.connect()
		expect(h.seam.hasBridgeCapability("subagents.interrupt")).toBe(false)
	})
})

describe("L2a: interruptChild / stopChildren seam methods", () => {
	/** Open + bind a session through a completed turn; #currentSessionId persists. */
	async function boundHarness(sessionId = "parent-1") {
		const h = makeHarness()
		h.replies.set("session.open", { kind: "value", value: { sessionId } })
		h.replies.set("session.send", { kind: "value", value: { turnId: "t-bind" } })
		h.seam.resumeSession(sessionId)
		const done = h.seam.turn("go", {
			onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {},
		})
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t-bind", text: "" } })
		await done
		await Bun.sleep(0)
		expect(h.seam.currentSessionId()).toBe(sessionId)
		return h
	}

	test("no binding: interruptChild rejects NO_SESSION and sends NO frame", async () => {
		const h = makeHarness()
		let caught: unknown
		try { await h.seam.interruptChild("c") } catch (err) { caught = err }
		expect(caught).toBeInstanceOf(BridgeProtocolError)
		expect((caught as BridgeProtocolError).code).toBe("NO_SESSION")
		expect(h.requests.filter((r) => r.method === "subagents.interrupt")).toHaveLength(0)
	})

	test("no binding: stopChildren rejects NO_SESSION and sends NO frame", async () => {
		const h = makeHarness()
		let caught: unknown
		try { await h.seam.stopChildren() } catch (err) { caught = err }
		expect(caught).toBeInstanceOf(BridgeProtocolError)
		expect((caught as BridgeProtocolError).code).toBe("NO_SESSION")
		expect(h.requests.filter((r) => r.method === "subagents.stopChildren")).toHaveLength(0)
	})

	test("cancel-issued / already-settled resolve; parentSessionId is the bound session", async () => {
		const h = await boundHarness()

		h.replies.set("subagents.interrupt", { kind: "value", value: { childId: "c1", disposition: "cancel-issued" } })
		await expect(h.seam.interruptChild("c1")).resolves.toBeUndefined()
		expect(h.lastRequest("subagents.interrupt")?.params).toEqual({ parentSessionId: "parent-1", childId: "c1" })

		h.replies.set("subagents.interrupt", { kind: "value", value: { childId: "c2", disposition: "already-settled" } })
		await expect(h.seam.interruptChild("c2")).resolves.toBeUndefined()
		expect(h.lastRequest("subagents.interrupt")?.params).toEqual({ parentSessionId: "parent-1", childId: "c2" })
	})

	test("failed disposition rejects INTERRUPT_FAILED with the bridge detail attached", async () => {
		const h = await boundHarness()
		const detail = "agent not available in host registry"
		h.replies.set("subagents.interrupt", {
			kind: "value", value: { childId: "c-bad", disposition: "failed", detail },
		})
		let caught: unknown
		try { await h.seam.interruptChild("c-bad") } catch (err) { caught = err }
		expect(caught).toBeInstanceOf(BridgeProtocolError)
		expect((caught as BridgeProtocolError).code).toBe("INTERRUPT_FAILED")
		expect((caught as BridgeProtocolError).detail).toMatchObject({
			childId: "c-bad", disposition: "failed", detail,
		})
	})

	test("stopChildren returns the bridge children verbatim (childId + disposition)", async () => {
		const h = await boundHarness()
		h.replies.set("subagents.stopChildren", {
			kind: "value",
			value: { children: [
				{ childId: "a", disposition: "cancel-issued" },
				{ childId: "b", disposition: "already-settled" },
				{ childId: "c", disposition: "failed", detail: "boom" },
			] },
		})
		const out = await h.seam.stopChildren()
		expect(h.lastRequest("subagents.stopChildren")?.params).toEqual({ parentSessionId: "parent-1" })
		expect(out).toEqual([
			{ childId: "a", disposition: "cancel-issued" },
			{ childId: "b", disposition: "already-settled" },
			{ childId: "c", disposition: "failed" },
		])
	})
})

describe("L2a: #settleChildFromHost extraction + in-flight sweep skip", () => {
	test("settle extraction regression: a host-stopped child still settles through sweep", async () => {
		const h = makeHarness()
		h.replies.set("session.open", { kind: "value", value: { sessionId: "p" } })
		h.replies.set("session.send", { kind: "value", value: { turnId: "t" } })
		h.replies.set("journal.replay", { kind: "value", value: { rows: [], cursor: 1 } })
		h.replies.set("session.list", {
			kind: "value",
			value: { items: [{ sessionId: "ghost", origin: "subagent", parentSessionId: "p", running: false }] },
		})
		h.seam.resumeSession("p")
		const done = h.seam.turn("go", {
			onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {},
		})
		await Bun.sleep(0)
		h.emit({ type: "agent.spawn", payload: { sessionId: "p", childId: "ghost", label: "G", childCreatedAt: 1000 } })
		await Bun.sleep(0)
		h.emit({ type: "turn.end", payload: { turnId: "t", text: "" } })
		await done
		await Bun.sleep(0)
		const ghost = h.seam.subagentViews().find((v) => v.id === "ghost")!
		expect(ghost.status).toBe("completed")
		expect(typeof ghost.endedAt).toBe("number")
	})

	test("sweep skips a child with an in-flight interrupt; siblings still settle", async () => {
		const h = makeHarness()
		h.replies.set("session.open", { kind: "value", value: { sessionId: "p" } })
		h.replies.set("session.send", { kind: "value", value: { turnId: "t-skip" } })
		h.replies.set("session.list", {
			kind: "value",
			value: { items: [
				{ sessionId: "ghost", origin: "subagent", parentSessionId: "p", running: false },
				{ sessionId: "sibling", origin: "subagent", parentSessionId: "p", running: false },
			] },
		})
		h.replies.set("subagents.interrupt", {
			kind: "value", value: { childId: "ghost", disposition: "cancel-issued" },
		})
		h.seam.resumeSession("p")
		const done = h.seam.turn("go", {
			onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {},
		})
		await Bun.sleep(0)
		h.emit({ type: "agent.spawn", payload: { sessionId: "p", childId: "ghost", label: "G", childCreatedAt: 1000 } })
		h.emit({ type: "agent.spawn", payload: { sessionId: "p", childId: "sibling", label: "S", childCreatedAt: 2000 } })
		await Bun.sleep(0)

		// Register the in-flight interrupt for `ghost` (marker survives resolve).
		await h.seam.interruptChild("ghost")
		expect(h.lastRequest("subagents.interrupt")?.params).toEqual({ parentSessionId: "p", childId: "ghost" })

		h.emit({ type: "turn.end", payload: { turnId: "t-skip", text: "" } })
		await done
		await Bun.sleep(0)

		const views = h.seam.subagentViews()
		// L2a handoff: sweep must not settle the interrupted child — C3 owns it.
		expect(views.find((v) => v.id === "ghost")!.status).toBe("running")
		// A normal sibling is still settled by the same sweep.
		expect(views.find((v) => v.id === "sibling")!.status).toBe("completed")
	})
})

// ---------------------------------------------------------------------------
// L2b (0.23.1) — C3 confirm-then-emit
// ---------------------------------------------------------------------------

/**
 * Manually-driven poll clock. `sleep` parks until step()/stepAll() resolves it;
 * `now()` advances by the requested delay at sleep-CALL time so the 45s deadline
 * is reachable in ~47 deterministic steps (no real 250ms→1s waits).
 */
function makeManualConfirmClock() {
	let t = 0
	const waiters: Array<() => void> = []
	const clock: BridgeConfirmClock = {
		sleep(ms) {
			t += ms
			return new Promise<void>((resolve) => { waiters.push(resolve) })
		},
		now() { return t },
	}
	return {
		clock,
		/** Resolve the oldest outstanding sleep (one poll round for one child). */
		async step() {
			waiters.shift()?.()
			await Bun.sleep(0)
		},
		/** Resolve every currently outstanding sleep (one round for N children). */
		async stepAll() {
			const batch = waiters.splice(0, waiters.length)
			for (const w of batch) w()
			await Bun.sleep(0)
		},
		pending() { return waiters.length },
		elapsed() { return t },
	}
}

// A child journal with real rounds/model (meta) but NO terminal row.
const CHILD_ROWS: BridgeReplayRow[] = [
	{ seq: 1, type: "request/context", payload: { model: "child-model" } },
	{ seq: 2, type: "assistant/message", payload: { content: [{ type: "text", text: "step one" }] } },
	{ seq: 3, type: "assistant/message", payload: { content: [{ type: "text", text: "step two" }] } },
]
/** Priority ① reason — a `subagent-settled` notice's `source.stopReason`. */
const SETTLED_ABORTED: BridgeReplayRow = {
	seq: 4,
	type: "user/message",
	payload: { source: { kind: "subagent-settled", stopReason: "aborted", senderSessionId: "c1" } },
}

async function bindC3(h: ReturnType<typeof makeHarness>, sessionId = "parent-1"): Promise<void> {
	h.replies.set("session.open", { kind: "value", value: { sessionId } })
	h.replies.set("session.send", { kind: "value", value: { turnId: "t-bind-c3" } })
	h.seam.resumeSession(sessionId)
	const done = h.seam.turn("go", {
		onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {},
	})
	await Bun.sleep(0)
	h.emit({ type: "turn.end", payload: { turnId: "t-bind-c3", text: "" } })
	await done
	await Bun.sleep(0)
}

async function spawnC3(h: ReturnType<typeof makeHarness>, id: string): Promise<void> {
	h.emit({ type: "agent.spawn", payload: { sessionId: "parent-1", childId: id, label: id, childCreatedAt: 1000 } })
	await Bun.sleep(0)
}

/** Track running→settled transitions for a child across emitted snapshots. */
function trackSettles(h: ReturnType<typeof makeHarness>, childId: string): () => number {
	const prev = new Map<string, string>()
	let settles = 0
	h.seam.onSubagentViews((views) => {
		for (const v of views) {
			if (v.id !== childId) continue
			if (prev.get(childId) === "running" && v.status !== "running") settles += 1
			prev.set(childId, v.status)
		}
	})
	return () => settles
}

function childReplayCount(h: ReturnType<typeof makeHarness>, id: string): number {
	return h.requests.filter((r) => r.method === "journal.replay" && r.params?.sessionId === id).length
}

describe("L2b: C3 confirm-then-emit (poll → reason → settle)", () => {
	test("① cancel-issued → running=false → replay aborted → settle once, rounds/model preserved", async () => {
		const clk = makeManualConfirmClock()
		const h = makeHarness(clk.clock)
		h.replies.set("journal.replay", {
			kind: "value", value: { rows: [...CHILD_ROWS, SETTLED_ABORTED], cursor: 5 },
		})
		let polls = 0
		h.replies.set("session.list", { kind: "fn", fn: () => {
			polls += 1
			return { kind: "value", value: { items: [
				{ sessionId: "c1", origin: "subagent", parentSessionId: "parent-1", running: polls < 2 },
			] } }
		} })
		h.replies.set("subagents.interrupt", {
			kind: "value", value: { childId: "c1", disposition: "cancel-issued" },
		})
		await bindC3(h)
		await spawnC3(h, "c1")
		const settles = trackSettles(h, "c1")

		await h.seam.interruptChild("c1")
		await clk.step() // poll 1: host still running → retry
		await clk.step() // poll 2: running===false → replay → settle
		await Bun.sleep(0)

		expect(polls).toBeGreaterThanOrEqual(2)
		expect(childReplayCount(h, "c1")).toBeGreaterThan(0)
		const c1 = h.seam.subagentViews().find((v) => v.id === "c1")!
		expect(c1.status).toBe("interrupted") // aborted → dedicated interrupted display
		expect(c1.rounds).toBe(2)
		expect(c1.model).toBe("child-model")
		expect(settles()).toBe(1)
	})

	test("② replay carries no reason → degrade to aborted", async () => {
		const clk = makeManualConfirmClock()
		const h = makeHarness(clk.clock)
		expect(bridgeChildStopReason(CHILD_ROWS)).toBeUndefined()
		h.replies.set("journal.replay", { kind: "value", value: { rows: CHILD_ROWS, cursor: 4 } })
		h.replies.set("session.list", { kind: "value", value: { items: [
			{ sessionId: "c1", origin: "subagent", parentSessionId: "parent-1", running: false },
		] } })
		h.replies.set("subagents.interrupt", {
			kind: "value", value: { childId: "c1", disposition: "cancel-issued" },
		})
		await bindC3(h)
		await spawnC3(h, "c1")
		const settles = trackSettles(h, "c1")

		await h.seam.interruptChild("c1")
		await clk.step()
		await Bun.sleep(0)

		expect(h.seam.subagentViews().find((v) => v.id === "c1")!.status).toBe("interrupted")
		expect(settles()).toBe(1)
	})

	test("③ already-settled starts no confirmation poll", async () => {
		const clk = makeManualConfirmClock()
		const h = makeHarness(clk.clock)
		h.replies.set("journal.replay", { kind: "value", value: { rows: CHILD_ROWS, cursor: 4 } })
		h.replies.set("subagents.interrupt", {
			kind: "value", value: { childId: "c1", disposition: "already-settled" },
		})
		await bindC3(h)
		await spawnC3(h, "c1")
		await Bun.sleep(0)
		const before = h.requests.length

		await h.seam.interruptChild("c1")
		await clk.step()
		await clk.step()
		await Bun.sleep(0)

		const added = h.requests.slice(before)
		expect(added.filter((r) => r.method === "session.list" || r.method === "journal.replay")).toHaveLength(0)
		expect(clk.pending()).toBe(0)

		// F-1: already-settled cleared the in-flight marker — a later turn-boundary
		// sweep is NOT skipped and converges the still-running child. If the marker
		// lingered, sweep would skip "c1" and it would stay "running".
		h.replies.set("session.list", { kind: "value", value: { items: [
			{ sessionId: "c1", origin: "subagent", parentSessionId: "parent-1", running: false },
		] } })
		h.emit({ type: "turn.end", payload: { turnId: "t-fallback", text: "" } })
		await Bun.sleep(0)
		expect(h.seam.subagentViews().find((v) => v.id === "c1")!.status).toBe("completed")
	})

	test("④ generation / binding change after rebind → no settle, no emit", async () => {
		const clk = makeManualConfirmClock()
		const h = makeHarness(clk.clock)
		h.replies.set("journal.replay", { kind: "fn", fn: ({ sessionId }) => {
			if (sessionId === "c1") {
				return { kind: "value", value: { rows: [...CHILD_ROWS, SETTLED_ABORTED], cursor: 5 } }
			}
			// A different binding whose roster has c1 RUNNING — without the guard
			// the stale coroutine would settle THIS new view.
			return { kind: "value", value: { rows: [
				{ seq: 1, type: "subagent/catalog", payload: { childId: "c1", label: "c1" } },
			], cursor: 2 } }
		} })
		h.replies.set("subagents.interrupt", {
			kind: "value", value: { childId: "c1", disposition: "cancel-issued" },
		})
		await bindC3(h)
		await spawnC3(h, "c1")
		await h.seam.interruptChild("c1")
		expect(clk.pending()).toBe(1) // coroutine parked at its first poll

		// Rebind to a different session (clears marker + bumps generation).
		await h.seam.storedTranscript("parent-2")
		await Bun.sleep(0)
		expect(h.seam.subagentViews().find((v) => v.id === "c1")!.status).toBe("running")

		// Subscribe AFTER the rebind: only coroutine-generated emits are counted.
		const emissions: SeamSubagentView[][] = []
		h.seam.onSubagentViews((views) => emissions.push(views))
		const replaysBefore = childReplayCount(h, "c1")
		await clk.step() // stale coroutine wakes — guard must bail before any RPC
		await Bun.sleep(0)

		expect(emissions).toHaveLength(1) // only the replay-on-subscribe snapshot
		expect(childReplayCount(h, "c1")).toBe(replaysBefore)
		expect(h.seam.subagentViews().find((v) => v.id === "c1")!.status).toBe("running")
	})

	test("⑤ deadline reached → no settle, marker cleared for turn sweep, debug log (no body)", async () => {
		const clk = makeManualConfirmClock()
		const h = makeHarness(clk.clock)
		h.replies.set("journal.replay", { kind: "value", value: { rows: CHILD_ROWS, cursor: 4 } })
		let listCalls = 0
		h.replies.set("session.list", { kind: "fn", fn: () => {
			listCalls += 1
			return { kind: "value", value: { items: [
				{ sessionId: "c1", origin: "subagent", parentSessionId: "parent-1", running: true },
			] } }
		} })
		h.replies.set("subagents.interrupt", {
			kind: "value", value: { childId: "c1", disposition: "cancel-issued" },
		})
		await bindC3(h)
		await spawnC3(h, "c1")
		const settles = trackSettles(h, "c1")

		await h.seam.interruptChild("c1")
		for (let i = 0; i < 60; i += 1) await clk.step()
		await Bun.sleep(0)

		expect(listCalls).toBeGreaterThan(20)
		expect(clk.elapsed()).toBeGreaterThanOrEqual(45_000)
		expect(h.seam.subagentViews().find((v) => v.id === "c1")!.status).toBe("running")
		expect(settles()).toBe(0)
		const debug = h.logs.filter((l) => l.level === "debug" && l.args.map(String).join(" ").includes("timed out"))
		expect(debug).toHaveLength(1)
		expect(debug[0]!.args.map(String).join(" ")).toContain("c1")

		// Marker was cleared: a later turn boundary sweep converges the child.
		h.replies.set("session.list", { kind: "value", value: { items: [
			{ sessionId: "c1", origin: "subagent", parentSessionId: "parent-1", running: false },
		] } })
		h.emit({ type: "turn.end", payload: { turnId: "t-fallback", text: "" } })
		await Bun.sleep(0)
		expect(h.seam.subagentViews().find((v) => v.id === "c1")!.status).toBe("completed")
	})

	test("⑥ stopChildren: each child confirms independently; one replay failure does not drag the other", async () => {
		const clk = makeManualConfirmClock()
		const h = makeHarness(clk.clock)
		h.replies.set("journal.replay", { kind: "fn", fn: ({ sessionId }) => {
			if (sessionId === "c2") return { kind: "error", error: new Error("child journal unavailable") }
			return { kind: "value", value: { rows: [...CHILD_ROWS, SETTLED_ABORTED], cursor: 5 } }
		} })
		let listRound = 0
		h.replies.set("session.list", { kind: "fn", fn: () => {
			listRound += 1
			return { kind: "value", value: { items: [
				{ sessionId: "c1", origin: "subagent", parentSessionId: "parent-1", running: false },
				{ sessionId: "c2", origin: "subagent", parentSessionId: "parent-1", running: listRound < 2 },
			] } }
		} })
		h.replies.set("subagents.stopChildren", { kind: "value", value: { children: [
			{ childId: "c1", disposition: "cancel-issued" },
			{ childId: "c2", disposition: "cancel-issued" },
		] } })
		await bindC3(h)
		await spawnC3(h, "c1")
		await spawnC3(h, "c2")
		await Bun.sleep(0)

		await h.seam.stopChildren()
		expect(clk.pending()).toBe(2) // one parked poll per child
		await clk.stepAll() // round 1: c1 stopped; c2 still running
		await clk.stepAll() // round 2: c2 stopped → replay throws → degrades
		await Bun.sleep(0)

		const views = h.seam.subagentViews()
		expect(views.find((v) => v.id === "c1")!.status).toBe("interrupted")
		expect(views.find((v) => v.id === "c1")!.rounds).toBe(2)
		expect(views.find((v) => v.id === "c2")!.status).toBe("interrupted")
		expect(clk.pending()).toBe(0)
	})
})

describe("025-w1b B — seam.searchSessions hits the real session.search frame", () => {
	test("searchSessions projects the bridge's whitelisted {items} into {id,snippet}", async () => {
		const h = makeHarness()
		h.replies.set("session.search", {
			kind: "value",
			value: { items: [{ id: "s1", snippet: "first hit" }, { id: "s2", snippet: "second hit" }, { id: "", snippet: "drop" }] },
		})
		const found = await h.seam.searchSessions("needle")
		expect(found).toEqual([
			{ id: "s1", snippet: "first hit" },
			{ id: "s2", snippet: "second hit" },
		])
		const req = h.lastRequest("session.search")!
		expect(req.params).toEqual({ query: "needle" })
	})

	test("searchSessions propagates UNSUPPORTED when the frame is absent (never fake empty)", async () => {
		const h = makeHarness()
		h.replies.set("session.search", { kind: "error", error: new Error("UNSUPPORTED: session.search") })
		await expect(h.seam.searchSessions("x")).rejects.toThrow("UNSUPPORTED")
	})
})

describe("025-w1b C — seam.forkSession drives the real session.fork frame", () => {
	test("forkSession sends {sessionId,atSeq} and returns the forked id", async () => {
		const h = makeHarness()
		h.replies.set("session.fork", { kind: "value", value: { sessionId: "forked-42" } })
		const id = await h.seam.forkSession!("src-session", 12)
		expect(id).toBe("forked-42")
		const req = h.lastRequest("session.fork")!
		expect(req.params).toEqual({ sessionId: "src-session", atSeq: 12 })
	})

	test("forkSession omits atSeq when no seqEnd given", async () => {
		const h = makeHarness()
		h.replies.set("session.fork", { kind: "value", value: { sessionId: "forked-latest" } })
		await h.seam.forkSession!("src-session")
		expect(h.lastRequest("session.fork")!.params).toEqual({ sessionId: "src-session" })
	})

	test("forkSession rejects on empty id / missing frame (never a fake fork)", async () => {
		const h = makeHarness()
		h.replies.set("session.fork", { kind: "value", value: {} })
		await expect(h.seam.forkSession!("src")).rejects.toMatchObject({ code: "FORK_FAILED" })
		const h2 = makeHarness()
		h2.replies.set("session.fork", { kind: "error", error: new Error("UNSUPPORTED: session.fork") })
		await expect(h2.seam.forkSession!("src")).rejects.toThrow("UNSUPPORTED")
	})
})

describe("025-w1b D — seam subagentTranscript / steerChild (protocol frames untouched)", () => {
	test("steerChild returns true for a running child and sends the subagents.prompt frame", () => {
		const h = makeHarness()
		h.emit({ type: "agent.spawn", payload: { childId: "steer-child", label: "scout", runId: "rc", seq: 0 } })
		expect(h.seam.subagentViews().find((v) => v.id === "steer-child")?.status).toBe("running")
		expect(h.seam.steerChild!("steer-child", "keep going")).toBe(true)
		const req = h.lastRequest("subagents.prompt")!
		expect(req.params).toMatchObject({
			childSessionId: "steer-child",
			delivery: "steer",
			content: [{ type: "text", text: "keep going" }],
		})
		expect(typeof req.params!.requestId).toBe("string")
	})

	test("steerChild returns false for an unknown/settled child (no frame sent)", () => {
		const h = makeHarness()
		expect(h.seam.steerChild!("ghost", "x")).toBe(false)
		expect(h.requests.some((r) => r.method === "subagents.prompt")).toBe(false)
		h.emit({ type: "agent.spawn", payload: { childId: "c", label: "c", runId: "r", seq: 0 } })
		h.emit({ type: "agent.settle", payload: { runId: "r", seq: 0, outcome: "completed" } })
		expect(h.seam.steerChild!("c", "x")).toBe(false)
	})

	test("subagentTranscript folds the child's real journal rows (no fabricated log)", async () => {
		const h = makeHarness()
		h.replies.set("journal.replay", {
			kind: "value",
			value: { rows: [
				{ seq: 1, type: "assistant/message", payload: { message: { content: [{ type: "text", text: "hello from child" }] } } },
				{ seq: 2, type: "tool/call", payload: { name: "Read" } },
			] },
		})
		h.emit({ type: "agent.spawn", payload: { childId: "log-child", label: "scout", runId: "rl", seq: 0 } })
		// The journal read is fire-and-forget from the spawn fold; let it settle.
		await new Promise((r) => setTimeout(r, 20))
		const lines = h.seam.subagentTranscript!("log-child")
		expect(Array.isArray(lines)).toBe(true)
		expect(lines.join("\n")).toContain("hello from child")
		expect(h.requests.some((r) => r.method === "journal.replay" && r.params?.sessionId === "log-child")).toBe(true)
	})

	test("protocol frames subagents.interrupt/stopChildren are still reachable (not merged)", () => {
		const h = makeHarness()
		// A prompt frame is distinct from the protocol stop frames: steerChild uses
		// subagents.prompt; the existing interruptChild uses subagents.interrupt.
		expect(h.seam.steerChild!("ghost", "x")).toBe(false)
		expect(h.seam.stopChildren).toBeDefined()
		expect(h.seam.interruptChild).toBeDefined()
	})
})

describe("025-w1b E — account face whitelist projection + strict separation from login", () => {
	test("account and login are two distinct face objects with non-overlapping fields", () => {
		const h = makeHarness()
		expect(h.seam.account).toBeDefined()
		expect(h.seam.login).toBeDefined()
		expect(h.seam.account).not.toBe(h.seam.login)
		const accountFields = Object.keys(h.seam.account!).sort()
		const loginFields = Object.keys(h.seam.login!).sort()
		expect(accountFields).toEqual(["cancelSignIn", "getState", "hasRunningAccountTasks", "signOut", "startSignIn"])
		expect(loginFields).toEqual(["credentialStatus", "login", "logout", "registerRoute", "routes"])
		expect(accountFields.filter((f) => loginFields.includes(f))).toEqual([])
	})

	test("getState/startSignIn/cancelSignIn/signOut project to the fixed 4-field shape (no URL value)", async () => {
		const h = makeHarness()
		// A HOSTILE frame carrying an authorize URL / token value: only the four
		// whitelisted fields may survive; the URL VALUE must never reach the seam.
		const hostile = {
			status: "credential-stored",
			attemptPhase: "waiting-browser",
			authorizeUrlReady: true,
			linksPresent: true,
			authorizeUrl: "https://auth.example/?code_challenge=SENTINEL_AUTH_URL",
			access_token: "SENTINEL_TOKEN",
		}
		for (const method of ["account.getState", "account.startSignIn", "account.cancelSignIn", "account.signOut"] as const) {
			h.replies.set(method, { kind: "value", value: hostile })
		}
		for (const [name, call] of [
			["getState", () => h.seam.account!.getState()],
			["startSignIn", () => h.seam.account!.startSignIn("http://localhost", "desktop")],
			["cancelSignIn", () => h.seam.account!.cancelSignIn("att-1")],
			["signOut", () => h.seam.account!.signOut()],
		] as const) {
			const state = await call()
			expect(state).toEqual({
				status: "credential-stored", attemptPhase: "waiting-browser",
				authorizeUrlReady: true, linksPresent: true,
			})
			expect(JSON.stringify(state)).not.toContain("SENTINEL")
			expect(JSON.stringify(state)).not.toContain('"authorizeUrl":') // the URL VALUE key; authorizeUrlReady boolean is allowed
		}
		// startSignIn/signOut send caller metadata; no secret is sent from the UI.
		const startReq = h.lastRequest("account.startSignIn")!
		expect(startReq.params).toMatchObject({ callbackOrigin: "http://localhost", loginSource: "desktop" })
		expect(startReq.params!.client).toMatchObject({ version: expect.any(String) })
		expect(h.lastRequest("account.cancelSignIn")!.params).toEqual({ attemptId: "att-1" })
	})

	test("unknown status/phase values degrade to null (bounded whitelist, no pass-through)", async () => {
		const h = makeHarness()
		h.replies.set("account.getState", { kind: "value", value: {
			status: "bogus-status", attemptPhase: "evil-phase", authorizeUrlReady: "yes", linksPresent: 1,
			authorizeUrl: "https://x/?code=SENTINEL",
		} })
		const state = await h.seam.account!.getState()
		expect(state).toEqual({ status: null, attemptPhase: null, authorizeUrlReady: false, linksPresent: false })
		expect(JSON.stringify(state)).not.toContain("SENTINEL")
	})

	test("hasRunningAccountTasks is boolean-only", async () => {
		const h = makeHarness()
		h.replies.set("account.hasRunningAccountTasks", { kind: "value", value: { running: true } })
		expect(await h.seam.account!.hasRunningAccountTasks()).toBe(true)
		h.replies.set("account.hasRunningAccountTasks", { kind: "value", value: {} })
		expect(await h.seam.account!.hasRunningAccountTasks()).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// 025-w2-2 — real plugin-manager READ face over the generic arm (W2-2a 7 ids)
// ---------------------------------------------------------------------------
describe("025-w2-2 pluginsManager face — real data + honest degrade", () => {
	const BUNDLES = {
		value: [
			{
				name: "alpha-bundle", version: "1.0.0", enabled: true, installed: true,
				optional: false, removable: true, description: "alpha",
			},
			{
				name: "beta-bundle", version: "2.0.0", enabled: false, installed: true,
				optional: false, removable: true, apiKey: "W22_SENTINEL_synthetic",
			},
		],
	}

	test("listBundles: real wire response is hand-projected; available=true; pluginBundles returns real rows", async () => {
		const h = makeHarness()
		h.replies.set("pluginManager.listBundles", { kind: "value", value: BUNDLES })
		expect(h.seam.pluginsManager!.available()).toBeUndefined() // not probed yet
		const rows = await h.seam.pluginsManager!.listBundles()
		expect(rows).toHaveLength(2)
		expect(rows[0]).toMatchObject({ name: "alpha-bundle", enabled: true, installed: true })
		expect(rows[1]).toMatchObject({ name: "beta-bundle", enabled: false })
		expect(JSON.stringify(rows)).not.toContain("apiKey")
		expect(JSON.stringify(rows)).not.toContain("W22_SENTINEL_synthetic")
		expect(h.seam.pluginsManager!.available()).toBe(true)
		expect(h.seam.pluginBundles!()).toEqual(rows)
		expect(h.lastRequest("pluginManager.listBundles")).toBeDefined()
	})

	test("readBundleDetail: request carries name+language; response hand-projected (E5 markdown capped)", async () => {
		const h = makeHarness()
		h.replies.set("pluginManager.readBundleDetail", {
			kind: "value",
			value: { status: "found", origin: "readme", path: "/README.md", markdown: "W22PONG detail\n" + "x".repeat(9000), token: "W22_SENTINEL_synthetic" },
		})
		const detail = await h.seam.pluginsManager!.readBundleDetail("alpha-bundle", "en")
		expect(detail.status).toBe("found")
		if (detail.status !== "found") throw new Error("expected found")
		expect(detail.origin).toBe("readme")
		expect(detail.markdown.startsWith("W22PONG detail")).toBe(true)
		expect(detail.markdown.length).toBe(4096)
		expect(JSON.stringify(detail)).not.toContain("W22_SENTINEL_synthetic")
		const req = h.lastRequest("pluginManager.readBundleDetail")!
		expect(req.params).toEqual({ name: "alpha-bundle", language: "en" })
	})

	test("service absent: read rejects UNSUPPORTED, available=false, pluginBundles degrades to stateUnknown local rows", async () => {
		const h = scratchSeam()
		// seed a local installed plugin (phase-1 manifest)
		const nm = join(h.home, "profiles", "opentui", "node_modules")
		mkdirSync(join(nm, "local-plugin"), { recursive: true })
		writeFileSync(join(nm, "local-plugin", "package.json"), JSON.stringify({ name: "local-plugin", version: "9.9.9" }))

		h.replies.set("pluginManager.readBundleDetail", {
			kind: "error",
			error: new BridgeProtocolError("UNSUPPORTED", "NOT_WIRED: pluginManager service unavailable for detail"),
		})
		let code = ""
		try {
			await h.seam.pluginsManager!.readBundleDetail("x", "en")
		} catch (err) {
			code = err instanceof BridgeProtocolError ? err.code : ""
		}
		expect(code).toBe("UNSUPPORTED")
		expect(h.seam.pluginsManager!.available()).toBe(false)
		const rows = h.seam.pluginBundles!()
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ name: "local-plugin", version: "9.9.9", enabled: false, installed: true, stateUnknown: true })
		rmSync(h.home, { recursive: true, force: true })
	})

	test("refreshPluginBundles warms the cache even when called before any open", async () => {
		const h = makeHarness()
		h.replies.set("pluginManager.listBundles", { kind: "value", value: BUNDLES })
		await h.seam.refreshPluginBundles!()
		expect(h.seam.pluginsManager!.available()).toBe(true)
		expect(h.seam.pluginBundles!()).toHaveLength(2)
	})

	// W2-2 C-2 — error classification fidelity. A host business error must keep
	// its own wire code and must NOT poison `available` (no fake panel degrade).
	test("business INTERNAL error keeps its code, leaves available=true, panel stays on real rows (W2-2 C-2)", async () => {
		const h = makeHarness()
		// First a good read warms availability + the real bundle cache.
		h.replies.set("pluginManager.listBundles", { kind: "value", value: BUNDLES })
		await h.seam.pluginsManager!.listBundles()
		expect(h.seam.pluginsManager!.available()).toBe(true)
		// Now a host business error on a read (e.g. selecting an already-removed bundle).
		h.replies.set("pluginManager.readBundleDetail", {
			kind: "error",
			error: new BridgeProtocolError("INTERNAL", "plugin-manager/unknown-bundle: no such bundle"),
		})
		let caught: unknown
		try {
			await h.seam.pluginsManager!.readBundleDetail("gone-bundle", "en")
		} catch (err) {
			caught = err
		}
		expect(caught).toBeInstanceOf(BridgeProtocolError)
		expect((caught as BridgeProtocolError).code).toBe("INTERNAL") // not flattened to UNSUPPORTED
		expect((caught as BridgeProtocolError).message).toContain("plugin-manager/unknown-bundle")
		expect(h.seam.pluginsManager!.available()).toBe(true) // availability untouched
		// Panel still shows the REAL cached rows — no stateUnknown degrade.
		const rows = h.seam.pluginBundles!()
		expect(rows).toHaveLength(2)
		expect(rows.every((r) => r.stateUnknown !== true)).toBe(true)
	})

	test("BAD_PARAMS validation error keeps its code and does not poison availability (W2-2 C-2)", async () => {
		const h = makeHarness()
		h.replies.set("pluginManager.listBundles", { kind: "value", value: BUNDLES })
		await h.seam.pluginsManager!.listBundles()
		expect(h.seam.pluginsManager!.available()).toBe(true)
		h.replies.set("pluginManager.listVersions", {
			kind: "error",
			error: new BridgeProtocolError("BAD_PARAMS", "BAD_PARAMS: pluginManager.listVersions name required"),
		})
		let code = ""
		try {
			await h.seam.pluginsManager!.listVersions("x")
		} catch (err) {
			code = err instanceof BridgeProtocolError ? err.code : ""
		}
		expect(code).toBe("BAD_PARAMS")
		expect(h.seam.pluginsManager!.available()).toBe(true)
	})

	test("genuine NOT_WIRED (wire UNSUPPORTED) STILL poisons available and degrades rows (W2-2 C-2 contrast)", async () => {
		const h = scratchSeam()
		const nm = join(h.home, "profiles", "opentui", "node_modules")
		mkdirSync(join(nm, "local-plugin"), { recursive: true })
		writeFileSync(join(nm, "local-plugin", "package.json"), JSON.stringify({ name: "local-plugin", version: "9.9.9" }))
		// The wire maps NOT_WIRED/unavailable -> UNSUPPORTED (bridge index.ts:4111-4119).
		h.replies.set("pluginManager.listBundles", {
			kind: "error",
			error: new BridgeProtocolError("UNSUPPORTED", "NOT_WIRED: pluginManager service unavailable"),
		})
		let code = ""
		try {
			await h.seam.pluginsManager!.listBundles()
		} catch (err) {
			code = err instanceof BridgeProtocolError ? err.code : ""
		}
		expect(code).toBe("UNSUPPORTED")
		expect(h.seam.pluginsManager!.available()).toBe(false)
		const rows = h.seam.pluginBundles!()
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ name: "local-plugin", stateUnknown: true })
		rmSync(h.home, { recursive: true, force: true })
	})
})

// ---------------------------------------------------------------------------
// 025-w2-3b — plugin-manager WRITE faces: seam-side confirm gate (R6) + wire
// translation. Every synthetic reply uses a fixed fake SENTINEL; no real value.
// ---------------------------------------------------------------------------
describe("025-w2-3b pluginManager write faces — seam confirm gate (R6)", () => {
	const CHANGE = { changed: true, application: "applied", target: "@scope/pkg" }

	// E0 SEAM HALF: no confirm token -> CONFIRM_REQUIRED, ZERO transport calls.
	test("E0 — no confirm token: all write faces reject CONFIRM_REQUIRED, transport zero calls", async () => {
		const h = makeHarness()
		const calls: Array<() => Promise<unknown>> = [
			() => h.seam.setPluginBundleEnabled!("n", true, undefined as never),
			() => h.seam.removePluginBundle!("n", undefined as never),
			() => h.seam.installPluginSpec!("spec", undefined as never),
			() => h.seam.updatePluginBundle!("n", "2", undefined as never),
			() => h.seam.setPluginEnabled!("id", true, undefined as never),
			() => h.seam.setVersionExemption!("1", "rc", true, true, undefined as never),
		]
		for (const call of calls) {
			let code = ""
			try { await call() } catch (err) { code = err instanceof BridgeProtocolError ? err.code : "" }
			expect(code).toBe("CONFIRM_REQUIRED")
		}
		expect(h.requests.filter((r) => r.method.startsWith("pluginManager.")).length).toBe(0)
	})

	// E0 control: a forged structurally-invalid token is also refused.
	test("E0 — forged confirm token rejected", async () => {
		const h = makeHarness()
		let code = ""
		try {
			await h.seam.removePluginBundle!("n", { __pluginWriteConfirm: false, operation: "x" } as never)
		} catch (err) { code = err instanceof BridgeProtocolError ? err.code : "" }
		expect(code).toBe("CONFIRM_REQUIRED")
		expect(h.lastRequest("pluginManager.removeBundle")).toBeUndefined()
	})

	// Every write face with a valid token reaches the wire WITH __confirm:true.
	test("write faces: valid token -> correct wire method/params + __confirm marker", async () => {
		const h = makeHarness()
		h.replies.set("pluginManager.setBundleEnabled", { kind: "value", value: CHANGE })
		h.replies.set("pluginManager.removeBundle", { kind: "value", value: CHANGE })
		h.replies.set("pluginManager.installBundle", { kind: "value", value: CHANGE })
		h.replies.set("pluginManager.updateBundle", { kind: "value", value: CHANGE })
		h.replies.set("pluginManager.setPluginEnabled", { kind: "value", value: CHANGE })
		h.replies.set("pluginManager.setVersionExemption", { kind: "value", value: CHANGE })

		await h.seam.setPluginBundleEnabled!("n", false, createPluginWriteConfirm("setBundleEnabled"))
		expect(h.lastRequest("pluginManager.setBundleEnabled")?.params).toEqual({ name: "n", enabled: false, __confirm: true })

		await h.seam.removePluginBundle!("n", createPluginWriteConfirm("removeBundle"))
		expect(h.lastRequest("pluginManager.removeBundle")?.params).toEqual({ name: "n", __confirm: true })

		const installed = await h.seam.installPluginSpec!("@scope/pkg", createPluginWriteConfirm("installBundle"))
		const installReq = h.lastRequest("pluginManager.installBundle")!
		expect(installReq.params!.spec).toBe("@scope/pkg")
		expect((installReq.params!.options as Record<string, unknown>).enabled).toBe(true)
		expect((installReq.params!.options as Record<string, unknown>).requestId).toBe(installed.requestId)
		expect((installReq.params! as Record<string, unknown>).__confirm).toBe(true)

		await h.seam.updatePluginBundle!("n", "2.0.0", createPluginWriteConfirm("updateBundle"))
		expect(h.lastRequest("pluginManager.updateBundle")?.params).toEqual({ name: "n", version: "2.0.0", options: {}, __confirm: true })

		await h.seam.setPluginEnabled!("id", true, createPluginWriteConfirm("setPluginEnabled"))
		expect(h.lastRequest("pluginManager.setPluginEnabled")?.params).toEqual({ id: "id", enabled: true, __confirm: true })

		await h.seam.setVersionExemption!("1.0.0", "rc.5", true, true, createPluginWriteConfirm("setVersionExemption"))
		expect(h.lastRequest("pluginManager.setVersionExemption")?.params).toEqual({
			packageVersion: "1.0.0", runtimeVersion: "rc.5", enabled: true, acceptRisk: true, __confirm: true,
		})
	})

	// E5: hostile write reply does not leak apiKey/token SENTINEL into seam shape.
	test("E5 — hostile write reply: SENTINEL keys dropped by second whitelist", async () => {
		const h = makeHarness()
		h.replies.set("pluginManager.removeBundle", {
			kind: "value",
			value: { ...CHANGE, apiKey: "W23_SENTINEL_synthetic", token: "W23_SENTINEL_synthetic", error: { incompatible: [{ x: 1 }], diagnostic: "bad" } },
		})
		const change = await h.seam.removePluginBundle!("n", createPluginWriteConfirm("removeBundle"))
		expect(change.error).toBe("bad")
		const text = JSON.stringify(change)
		expect(text).not.toContain("W23_SENTINEL_synthetic")
		expect(text).not.toContain("apiKey")
		expect(text).not.toContain("incompatible")
	})

	// C-2 classification: a write business error keeps its code and does NOT
	// poison availability. (The service-absent / UNSUPPORTED degrade half lives in
	// the W2-2 NOT_WIRED tests; this case pins only the INTERNAL business-error
	// classification — S-3 name erratum, W2-4 review §6.)
	test("write business error keeps INTERNAL code; availability not poisoned (C-2)", async () => {
		const h = makeHarness()
		h.replies.set("pluginManager.listBundles", { kind: "value", value: {
			value: [{ name: "a", version: "1", enabled: true, installed: true }],
		} })
		await h.seam.pluginsManager!.listBundles()
		expect(h.seam.pluginsManager!.available()).toBe(true)
		h.replies.set("pluginManager.removeBundle", {
			kind: "error", error: new BridgeProtocolError("INTERNAL", "plugin-manager/bundle-in-use"),
		})
		let code = ""
		try { await h.seam.removePluginBundle!("a", createPluginWriteConfirm("removeBundle")) }
		catch (err) { code = err instanceof BridgeProtocolError ? err.code : "" }
		expect(code).toBe("INTERNAL")
		expect(h.seam.pluginsManager!.available()).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// 025-w2-3c — install progress/cancel faces (adjudicated waitForInstall route).
// ---------------------------------------------------------------------------
describe("025-w2-3c install progress/cancel faces (R6 gated, closed states)", () => {
	test("E0 — no confirm token: waitForInstall/cancelInstall reject CONFIRM_REQUIRED, zero wire", async () => {
		const h = makeHarness()
		let c1 = "", c2 = ""
		try { await h.seam.waitForInstall!("r1", undefined as never) } catch (e) { c1 = e instanceof BridgeProtocolError ? e.code : "" }
		try { await h.seam.cancelInstall!("r1", undefined as never) } catch (e) { c2 = e instanceof BridgeProtocolError ? e.code : "" }
		expect(c1).toBe("CONFIRM_REQUIRED")
		expect(c2).toBe("CONFIRM_REQUIRED")
		expect(h.lastRequest("pluginManager.waitForInstall")).toBeUndefined()
		expect(h.lastRequest("pluginManager.cancelInstall")).toBeUndefined()
	})

	test("waitForInstall: valid token -> correct wire + closed-state projection by ChangeResult", async () => {
		const h = makeHarness()
		h.replies.set("pluginManager.waitForInstall", { kind: "value", value: { changed: true, application: "cancelled", target: "@s/p" } })
		const p = await h.seam.waitForInstall!("r1", createPluginWriteConfirm("waitForInstall"))
		expect(h.lastRequest("pluginManager.waitForInstall")?.params).toEqual({ requestId: "r1", __confirm: true })
		expect(p).toEqual({ state: "cancelled", requestId: "r1", target: "@s/p" })

		h.replies.set("pluginManager.waitForInstall", { kind: "value", value: null })
		const p2 = await h.seam.waitForInstall!("r1", createPluginWriteConfirm("waitForInstall"))
		expect(p2.state).toBe("done")
	})

	test("cancelInstall: valid token -> status enum; hostile status -> not-running", async () => {
		const h = makeHarness()
		h.replies.set("pluginManager.cancelInstall", { kind: "value", value: { status: "cancelled" } })
		expect(await h.seam.cancelInstall!("r1", createPluginWriteConfirm("cancelInstall"))).toEqual({ status: "cancelled" })
		expect(h.lastRequest("pluginManager.cancelInstall")?.params).toEqual({ requestId: "r1", __confirm: true })
		h.replies.set("pluginManager.cancelInstall", { kind: "value", value: { status: "bogus" } })
		expect(await h.seam.cancelInstall!("r1", createPluginWriteConfirm("cancelInstall"))).toEqual({ status: "not-running" })
	})

	test("E5 — hostile progress reply: SENTINEL/keys never cross seam shape", async () => {
		const h = makeHarness()
		h.replies.set("pluginManager.waitForInstall", {
			kind: "value",
			value: { application: "failed", target: "p", error: { diagnostic: "boom" }, apiKey: "W23_SENTINEL_synthetic" },
		})
		const p = await h.seam.waitForInstall!("r1", createPluginWriteConfirm("waitForInstall"))
		const text = JSON.stringify(p)
		expect(text).not.toContain("W23_SENTINEL_synthetic")
		expect(text).not.toContain("apiKey")
		expect(p.state).toBe("failed")
	})
})

// ---------------------------------------------------------------------------
// 026 web-mirror — permission face (commands/execute wire args, E4/E5)
// ---------------------------------------------------------------------------
async function bindPerm(h: ReturnType<typeof makeHarness>, sessionId = "s-perm"): Promise<void> {
	h.replies.set("session.open", { kind: "value", value: { sessionId } })
	h.replies.set("session.send", { kind: "value", value: { turnId: "t-perm" } })
	h.seam.resumeSession(sessionId)
	const done = h.seam.turn("go", {
		onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {},
	})
	await Bun.sleep(0)
	h.emit({ type: "turn.end", payload: { turnId: "t-perm", text: "" } })
	await done
	await Bun.sleep(0)
}

describe("026 permission face — commands/execute", () => {
	test("switch sends commands.execute {agentId, line, []} and projects the reply", async () => {
		const h = makeHarness()
		await bindPerm(h, "s-perm")
		expect(h.seam.currentSessionId()).toBe("s-perm")
		h.replies.set("commands.execute", {
			kind: "value",
			value: { commandId: "c-1", result: { kind: "success", text: "preset workspace-write" } },
		})
		const out = await h.seam.permission!.switch("workspace-write")
		expect(out).toEqual({ ok: true, matched: true, text: "preset workspace-write" })
		const r = h.lastRequest("commands.execute")!
		expect(r.params).toEqual({
			agentId: "s-perm",
			line: "/permission workspace-write",
			submittedAttachments: [],
		})
	})

	test("no bound session -> UNSUPPORTED, zero commands.execute calls", async () => {
		const h = makeHarness()
		await expect(h.seam.permission!.switch("x")).rejects.toThrow(/no active session/)
		expect(h.requests.filter((r) => r.method === "commands.execute")).toHaveLength(0)
	})

	test("unmatched reply (no result) -> matched=false, no fabricated success", async () => {
		const h = makeHarness()
		await bindPerm(h)
		h.replies.set("commands.execute", { kind: "value", value: {} })
		expect(await h.seam.permission!.switch("x")).toEqual({ ok: false, matched: false, text: "" })
	})

	test("SENTINEL hostile reply -> only fixed fields cross (E5)", async () => {
		const h = makeHarness()
		await bindPerm(h)
		h.replies.set("commands.execute", {
			kind: "value",
			value: {
				result: { kind: "success", text: "preset x", apiKey: "O26_SENTINEL_synthetic_no_real_secret" },
				token: "O26_SENTINEL_synthetic_no_real_secret", secret: "O26_SENTINEL_synthetic_no_real_secret",
			},
		})
		const out = await h.seam.permission!.switch("x")
		expect(out).toEqual({ ok: true, matched: true, text: "preset x" })
		expect(JSON.stringify(out)).not.toContain("O26_SENTINEL_synthetic_no_real_secret")
	})

	test("catalog() reads the wired permissionPresets.catalog", async () => {
		const h = makeHarness()
		h.replies.set("permissionPresets.catalog", {
			kind: "value",
			value: {
				options: [{ value: "workspace-write", name: "Workspace write", description: "sandboxed" }],
				defaultOptions: [],
				defaultPreset: "workspace-write",
			},
		})
		const cat = await h.seam.permission!.catalog()
		expect(cat?.defaultPreset).toBe("workspace-write")
		expect(cat?.options[0]?.description).toBe("sandboxed")
	})
})

// ---------------------------------------------------------------------------
// 026 web-mirror — cwd display (SECOND whitelist projection + seam face)
// ---------------------------------------------------------------------------
describe("026 projectCurrentCwd — SECOND whitelist (no new wire id)", () => {
	test("returns only the current session's cwd string", () => {
		const rows = [
			{ sessionId: "other", cwd: "/should/not/leak" },
			{ sessionId: "cur", cwd: "/Users/qingguee/repo/dsh-opentui" },
		]
		expect(projectCurrentCwd(rows, "cur")).toBe("/Users/qingguee/repo/dsh-opentui")
	})

	test("drops absent session, empty/non-string cwd, hostile keys (SENTINEL)", () => {
		expect(projectCurrentCwd([], undefined)).toBeUndefined()
		expect(projectCurrentCwd([], "cur")).toBeUndefined()
		expect(projectCurrentCwd([{ sessionId: "cur", cwd: "" }], "cur")).toBeUndefined()
		expect(projectCurrentCwd([{ sessionId: "cur", cwd: 42 }], "cur")).toBeUndefined()
		const hostile = {
			sessionId: "cur", cwd: "/real/path",
			apiKey: "O26_SENTINEL_synthetic_no_real_secret", token: "secret",
		}
		const out = projectCurrentCwd([hostile], "cur")
		expect(out).toBe("/real/path")
		expect(JSON.stringify(out)).not.toContain("O26_SENTINEL_synthetic_no_real_secret")
		expect(JSON.stringify(out)).not.toContain("apiKey")
		expect(JSON.stringify(out)).not.toContain("token")
	})
})

describe("026 cwd face — session/list.cwd (answer-bearing + honest degrade)", () => {
	test("cwd() returns the bound session's cwd from session.list", async () => {
		const h = makeHarness()
		await bindPerm(h, "s-cwd")
		h.replies.set("session.list", {
			kind: "value",
			value: {
				items: [
					{ sessionId: "other", cwd: "/leak" },
					{ sessionId: "s-cwd", cwd: "/Users/qingguee/repo/dsh-opentui", title: "hostile" },
				],
			},
		})
		expect(await h.seam.cwd!()).toBe("/Users/qingguee/repo/dsh-opentui")
		expect(h.lastRequest("session.list")).toBeDefined()
	})

	test("cwd() with no bound session -> undefined, zero session.list calls", async () => {
		const h = makeHarness()
		expect(await h.seam.cwd!()).toBeUndefined()
		expect(h.requests.filter((r) => r.method === "session.list")).toHaveLength(0)
	})
})
