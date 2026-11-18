/**
 * ADR-0011 T4-client — BridgeSessionSeam ask channel unit tests (fake transport).
 *
 * Pins the client half of the ask/permission bridge channel:
 *   - registerAskProvider answers `ask.request{kind:"questions"}` with the
 *     exact wire `{id, selected[], custom?}` answers shape
 *   - turn-scoped onApprove answers approval asks and shadows the registered
 *     provider for that turn; verdict → verdict mapping + escalation gate
 *   - no provider → explicit verdict:"unavailable" (ASK_CHANNEL_UNAVAILABLE),
 *     never a silent approve
 *   - ask.cancel / turn end / ask.settled / ask.pending snapshot: no dangling
 *     promise, no late ask.response, first-wins de-dup
 *
 * No live host, no bridge package import — the transport is injected exactly
 * as in bridge-session-seam.test.ts.
 */
import { describe, expect, test } from "bun:test"
import {
	BridgeSessionSeam,
	type BridgeAskRequestPayload,
	type BridgeEventFrame,
	type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"
import type { SeamAskPick, SeamAskQuestion, SeamApprovalVerdict, SeamTurnCallbacks } from "../../tui-base/src/seams/session"

// ---------------------------------------------------------------------------
// Fake transport harness
// ---------------------------------------------------------------------------

interface Reply {
	value?: unknown
	error?: unknown
}

interface LogCall {
	level: "info" | "warn" | "error"
	args: unknown[]
}

function makeAskHarness() {
	const requests: { method: string; params?: Record<string, unknown> }[] = []
	const replies = new Map<string, Reply>()
	const eventListeners: ((frame: BridgeEventFrame) => void)[] = []
	const logs: LogCall[] = []

	const transport: BridgeTransport = {
		async request(method, params) {
			requests.push({ method, params })
			const reply = replies.get(method)
			if (reply === undefined) return {}
			if (reply.error !== undefined) throw reply.error
			return reply.value ?? {}
		},
		onEvent(listener) {
			eventListeners.push(listener)
			return () => {
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
		emit(type: string, payload: unknown) {
			for (const l of [...eventListeners]) l({ type, payload })
		},
		responses() {
			return requests.filter((r) => r.method === "ask.response")
		},
		lastResponse() {
			return [...this.responses()].reverse()[0]?.params
		},
		logsContaining(text: string) {
			return logs.filter((l) => l.args.map(String).join(" ").includes(text))
		},
		flush() {
			return Bun.sleep(5) // let provider/answer microtasks settle
		},
	}
}

/** A one-shot deferred promise for "user has not answered yet" simulations. */
function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((r) => { resolve = r })
	return { promise, resolve }
}

const noopCallbacks = (overrides: Partial<SeamTurnCallbacks> = {}): SeamTurnCallbacks => ({
	onThinkingDelta() {},
	onContentDelta() {},
	onApprove: async () => "allowed-once",
	onError() {},
	...overrides,
})

function askRequest(overrides: Partial<BridgeAskRequestPayload> & { eventId: string }): BridgeAskRequestPayload {
	return { sessionId: "s1", kind: "approval", ...overrides }
}

const QUESTIONS: SeamAskQuestion[] = [
	{ id: "q1", prompt: "Pick one", options: [{ label: "A" }, { label: "B" }] },
	{ id: "q2", prompt: "Pick many", multiSelect: true, options: [{ label: "X" }, { label: "Y" }] },
	{ id: "q3", prompt: "Type something", options: [{ label: "free" }] },
]

// ---------------------------------------------------------------------------
// 1. question round-trip — exact ask.response fields
// ---------------------------------------------------------------------------

describe("registerAskProvider — question answer round-trip", () => {
	test("provider picks → ask.response with exact answers shape (single, multi, custom)", async () => {
		const h = makeAskHarness()
		const seen: SeamAskQuestion[][] = []
		h.seam.registerAskProvider(async (questions) => {
			seen.push(questions)
			return [
				{ questionId: "q1", selected: "B" },
				{ questionId: "q2", selected: "X", selections: ["X", "Y"] },
				{ questionId: "q3", selected: "", custom: "my own answer" },
			] satisfies SeamAskPick[]
		})

		h.emit("ask.request", askRequest({
			eventId: "t1:ask-1",
			kind: "questions",
			questions: QUESTIONS,
		}))
		await h.flush()

		// The provider really received the wire questions (structural passthrough).
		expect(seen).toHaveLength(1)
		expect(seen[0]).toEqual(QUESTIONS)

		const responses = h.responses()
		expect(responses).toHaveLength(1)
		expect(responses[0].params).toEqual({
			eventId: "t1:ask-1",
			kind: "questions",
			answers: [
				{ id: "q1", selected: ["B"] },
				{ id: "q2", selected: ["X", "Y"] },
				{ id: "q3", selected: [], custom: "my own answer" },
			],
		})
		// No verdict on a questions answer, exactly one response frame.
		expect(responses[0].params).not.toHaveProperty("verdict")
		expect(h.seam.pendingAsks()).toEqual([])
	})

	test("empty picks decline every question: {selected:[],custom:'declined'} (host-valid non-empty answers)", async () => {
		const h = makeAskHarness()
		h.seam.registerAskProvider(async () => [])

		h.emit("ask.request", askRequest({
			eventId: "t1:ask-2",
			kind: "questions",
			questions: QUESTIONS.slice(0, 2),
		}))
		await h.flush()

		expect(h.lastResponse()).toEqual({
			eventId: "t1:ask-2",
			kind: "questions",
			answers: [
				{ id: "q1", selected: [], custom: "declined" },
				{ id: "q2", selected: [], custom: "declined" },
			],
		})
	})
})

// ---------------------------------------------------------------------------
// 2 & 3. onApprove priority + verdict mapping + escalation gate
// ---------------------------------------------------------------------------

describe("turn().onApprove — approval answers", () => {
	test("onApprove shadows the registered provider for this turn (name/args forwarded)", async () => {
		const h = makeAskHarness()
		const providerCalls: unknown[] = []
		h.seam.registerAskProvider(async (questions) => {
			providerCalls.push(questions)
			return [{ questionId: "t2:ask-1", selected: "allow" }]
		})

		const approveCalls: { name: string; args: Record<string, unknown> }[] = []
		h.replies.set("session.send", { value: { turnId: "t-live" } })
		const turn = h.seam.turn("go", noopCallbacks({
			onApprove: async (name, args) => {
				approveCalls.push({ name, args })
				return "rejected"
			},
		}))
		await h.flush()

		h.emit("ask.request", askRequest({
			eventId: "t-live:ask-1",
			kind: "approval",
			toolName: "bash",
			callId: "c1",
			reason: "dangerous command",
			escalation: true,
		}))
		await h.flush()

		expect(approveCalls).toEqual([{ name: "bash", args: { callId: "c1", reason: "dangerous command" } }])
		expect(providerCalls).toHaveLength(0) // turn-scoped onApprove wins
		expect(h.lastResponse()).toEqual({ eventId: "t-live:ask-1", kind: "approval", verdict: "rejected" })

		h.emit("turn.end", { turnId: "t-live", text: "" })
		await turn
	})

	test("allowed-once → verdict:'allowed-once'; rejected → verdict:'rejected'", async () => {
		const h = makeAskHarness()
		h.replies.set("session.send", { value: { turnId: "t-live" } })
		const verdicts: SeamApprovalVerdict[] = ["allowed-once", "rejected"]
		let i = 0
		const turn = h.seam.turn("go", noopCallbacks({ onApprove: async () => verdicts[i++] ?? "rejected" }))
		await h.flush()

		h.emit("ask.request", askRequest({ eventId: "t-live:ask-1", toolName: "read" }))
		await h.flush()
		h.emit("ask.request", askRequest({ eventId: "t-live:ask-2", toolName: "write" }))
		await h.flush()

		expect(h.responses().map((r) => r.params)).toEqual([
			{ eventId: "t-live:ask-1", kind: "approval", verdict: "allowed-once" },
			{ eventId: "t-live:ask-2", kind: "approval", verdict: "rejected" },
		])

		h.emit("turn.end", { turnId: "t-live", text: "" })
		await turn
	})

	test("always/session behavior is refused locally without escalation (ASK_INVALID_RESPONSE), sent when granted", async () => {
		const h = makeAskHarness()
		h.replies.set("session.send", { value: { turnId: "t-live" } })
		const turn = h.seam.turn("go", noopCallbacks({ onApprove: async () => "always" as SeamApprovalVerdict }))
		await h.flush()

		// No escalation on the request → no frame is sent at all.
		h.emit("ask.request", askRequest({ eventId: "t-live:ask-1", toolName: "bash" }))
		await h.flush()
		expect(h.responses()).toHaveLength(0)
		expect(h.logsContaining("ASK_INVALID_RESPONSE")).toHaveLength(1)
		expect(h.seam.pendingAsks()).toEqual([]) // local entry still cleared

		// Granted escalation → the widened behavior is legal on the wire.
		h.emit("ask.request", askRequest({ eventId: "t-live:ask-2", toolName: "bash", escalation: true }))
		await h.flush()
		expect(h.lastResponse()).toEqual({
			eventId: "t-live:ask-2",
			kind: "approval",
			verdict: "allowed-once",
			behavior: "always",
			escalation: true,
		})

		h.emit("turn.end", { turnId: "t-live", text: "" })
		await turn
	})
})

// ---------------------------------------------------------------------------
// 4. no provider — explicit fail-closed, never silent approve
// ---------------------------------------------------------------------------

describe("no provider — ASK_CHANNEL_UNAVAILABLE", () => {
	test("approval and question asks answer verdict:'unavailable' with one log (never allowed-once)", async () => {
		const h = makeAskHarness()

		h.emit("ask.request", askRequest({ eventId: "t0:ask-1", toolName: "bash" }))
		await h.flush()
		h.emit("ask.request", askRequest({ eventId: "t0:ask-2", kind: "questions", questions: QUESTIONS.slice(0, 1) }))
		await h.flush()

		expect(h.responses().map((r) => r.params)).toEqual([
			{ eventId: "t0:ask-1", kind: "approval", verdict: "unavailable" },
			{
				eventId: "t0:ask-2",
				kind: "questions",
				verdict: "unavailable",
				answers: [{ id: "q1", selected: [], custom: "declined" }],
			},
		])
		// once-only log per degrade class (P2-9 discipline): both asks share
		// the "ask.no-provider" class, so exactly one warning is emitted.
		expect(h.logsContaining("ASK_CHANNEL_UNAVAILABLE")).toHaveLength(1)
		const serialized = JSON.stringify(h.responses())
		expect(serialized).not.toContain('"verdict":"allowed-once"')
	})

	test("a provider that throws also fails closed to unavailable", async () => {
		const h = makeAskHarness()
		h.seam.registerAskProvider(async () => { throw new Error("provider exploded") })

		h.emit("ask.request", askRequest({ eventId: "t0:ask-3", toolName: "bash" }))
		await h.flush()

		expect(h.lastResponse()).toEqual({ eventId: "t0:ask-3", kind: "approval", verdict: "unavailable" })
	})
})

// ---------------------------------------------------------------------------
// 5 & 6. cancel / turn end / settled / pending snapshot — no dangling promise
// ---------------------------------------------------------------------------

describe("ask queue convergence", () => {
	test("ask.cancel drops the pending ask; a late provider resolution sends nothing", async () => {
		const h = makeAskHarness()
		const gate = deferred<SeamAskPick[]>()
		h.seam.registerAskProvider(async () => gate.promise)

		h.emit("ask.request", askRequest({ eventId: "t1:ask-1", kind: "questions", questions: QUESTIONS.slice(0, 1) }))
		await h.flush()
		expect(h.seam.pendingAsks().map((a) => a.eventId)).toEqual(["t1:ask-1"])

		h.emit("ask.cancel", { eventId: "t1:ask-1", reason: "host-abort" })
		expect(h.seam.pendingAsks()).toEqual([])

		// Simulate the user answering after cancel: the promise resolves, but
		// the cancelled entry must not emit a late ask.response.
		gate.resolve([{ questionId: "q1", selected: "A" }])
		await h.flush()
		expect(h.responses()).toHaveLength(0)
	})

	test("turn end clears its asks; a late onApprove resolution sends nothing", async () => {
		const h = makeAskHarness()
		const gate = deferred<SeamApprovalVerdict>()
		h.replies.set("session.send", { value: { turnId: "t-live" } })
		const turn = h.seam.turn("go", noopCallbacks({ onApprove: async () => gate.promise }))
		await h.flush()

		h.emit("ask.request", askRequest({ eventId: "t-live:ask-1", toolName: "bash" }))
		await h.flush()
		expect(h.seam.pendingAsks().map((a) => a.eventId)).toEqual(["t-live:ask-1"])

		h.emit("turn.end", { turnId: "t-live", text: "" })
		await turn
		expect(h.seam.pendingAsks()).toEqual([])

		gate.resolve("allowed-once")
		await h.flush()
		expect(h.responses()).toHaveLength(0)
	})

	test("ask.settled de-dups a locally pending ask (host already closed it)", async () => {
		const h = makeAskHarness()
		const gate = deferred<SeamAskPick[]>()
		h.seam.registerAskProvider(async () => gate.promise)

		h.emit("ask.request", askRequest({ eventId: "t1:ask-1", kind: "questions", questions: QUESTIONS.slice(0, 1) }))
		await h.flush()
		h.emit("ask.settled", { eventId: "t1:ask-1", outcome: "cancelled" })
		expect(h.seam.pendingAsks()).toEqual([])

		gate.resolve([{ questionId: "q1", selected: "A" }])
		await h.flush()
		expect(h.responses()).toHaveLength(0)
	})

	test("ask.pending snapshot replaces the whole queue and resolves old waiters", async () => {
		const h = makeAskHarness()
		const gate = deferred<SeamAskPick[]>()
		h.seam.registerAskProvider(async (questions) =>
			questions[0]?.id === "q-defer" ? gate.promise : [{ questionId: "q-now", selected: "ok" }],
		)

		h.emit("ask.request", askRequest({
			eventId: "t1:ask-old",
			kind: "questions",
			questions: [{ id: "q-defer", prompt: "deferred", options: [{ label: "A" }] }],
		}))
		await h.flush()
		expect(h.seam.pendingAsks().map((a) => a.eventId)).toEqual(["t1:ask-old"])

		// Reconnect snapshot: only the fresh ask survives; the old one is dropped.
		h.emit("ask.pending", {
			sessionId: "s1",
			asks: [askRequest({
				eventId: "t2:ask-new",
				kind: "questions",
				questions: [{ id: "q-now", prompt: "fresh", options: [{ label: "ok" }] }],
			})],
		})
		await h.flush()
		expect(h.seam.pendingAsks().map((a) => a.eventId)).toEqual([]) // new one already answered

		gate.resolve([{ questionId: "q-defer", selected: "A" }])
		await h.flush()
		// Exactly one response, for the NEW ask — the replaced one never sends.
		expect(h.responses().map((r) => r.params)).toEqual([{
			eventId: "t2:ask-new",
			kind: "questions",
			answers: [{ id: "q-now", selected: ["ok"] }],
		}])
	})

	test("dispose clears all pending asks", async () => {
		const h = makeAskHarness()
		const gate = deferred<SeamAskPick[]>()
		h.seam.registerAskProvider(async () => gate.promise)
		h.emit("ask.request", askRequest({ eventId: "t1:ask-1", kind: "questions", questions: QUESTIONS.slice(0, 1) }))
		await h.flush()
		expect(h.seam.pendingAsks()).toHaveLength(1)

		await h.seam.dispose()
		expect(h.seam.pendingAsks()).toEqual([])
		gate.resolve([{ questionId: "q1", selected: "A" }])
		await h.flush()
		expect(h.responses()).toHaveLength(0)
	})
})
