/**
 * B3 — protocol-level unit tests for the additive `agent.progress` frame.
 *
 * The host's `cb.onSubagentUpdate` snapshot is a plain JS callback, not a cordis
 * event, so the bridge folds the SAME live events that feed it (child
 * `assistant/message` + child `agent/assistant-stream` text-delta, scoped by the
 * catalog-driven SubagentIndex) and forwards one throttled `agent.progress`
 * frame per running child. Same fake-cordis-ctx + NDJSON technique as
 * agent-lifecycle.test.ts; no host package is imported.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { apply } from "../src/index"

const STDIO_SWITCH = "DSH_OPENTUI_BRIDGE_STDIO"
type Frame = Record<string, any>
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const cleanups: Array<() => void> = []
afterEach(() => {
	while (cleanups.length > 0) cleanups.pop()!()
})

function makeHarness() {
	const previousSwitch = process.env[STDIO_SWITCH]
	process.env[STDIO_SWITCH] = "1"
	const originalWrite = process.stdout.write.bind(process.stdout)
	const frames: string[] = []
	process.stdout.write = function (this: unknown, chunk: any, ...rest: any[]) {
		frames.push(String(chunk))
		return true
	} as typeof process.stdout.write

	const stdinListeners: Record<string, Array<(...args: any[]) => void>> = {}
	const fakeStdin = {
		setEncoding() {},
		on(name: string, fn: (...args: any[]) => void) {
			;(stdinListeners[name] ||= []).push(fn)
			return fakeStdin
		},
		off(name: string, fn: (...args: any[]) => void) {
			stdinListeners[name] = (stdinListeners[name] || []).filter((f) => f !== fn)
			return fakeStdin
		},
		pause() { return fakeStdin },
		resume() { return fakeStdin },
	}
	const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin")
	Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true })

	const eventListeners = new Map<string, Array<(...args: any[]) => void>>()
	const idlePromise = new Promise<void>(() => { /* never resolves in this test */ })
	const agent = {
		status: "idle",
		session: { seq: 0 },
		followup() {},
		steer() {},
		cancel() {},
		whenIdle() { return idlePromise },
	}
	const handle = { agent, async dispose() {} }
	let disposeBridge: (() => void) | undefined
	const ctx: any = {
		logger: { info() {}, warn() {}, error() {}, debug() {} },
		effect(execute: () => () => void) {
			disposeBridge = execute()
			return { dispose: () => disposeBridge?.() }
		},
		on(name: string, listener: (...args: any[]) => void) {
			const next = [...(eventListeners.get(name) || []), listener]
			eventListeners.set(name, next)
			return () => eventListeners.set(name, next.filter((l) => l !== listener))
		},
		agents: {
			async create() { return handle },
			async resume() { return handle },
			get() { return undefined },
		},
	}
	apply(ctx, {})

	cleanups.push(() => {
		try { disposeBridge?.() } catch { /* already torn down */ }
		process.stdout.write = originalWrite
		if (stdinDescriptor) Object.defineProperty(process, "stdin", stdinDescriptor)
		else delete (process as any).stdin
		if (previousSwitch === undefined) delete process.env[STDIO_SWITCH]
		else process.env[STDIO_SWITCH] = previousSwitch
	})

	const parsed = (): Frame[] => {
		const out: Frame[] = []
		for (const line of frames) {
			try {
				const f = JSON.parse(line)
				if (f !== null && typeof f === "object" && "type" in f && "payload" in f) out.push(f)
			} catch { /* reporter noise */ }
		}
		return out
	}
	const latest = (id: number): Frame | undefined => {
		for (let i = frames.length - 1; i >= 0; i--) {
			try {
				const f = JSON.parse(frames[i])
				if (f !== null && typeof f === "object" && f.id === id) return f
			} catch { /* noise */ }
		}
		return undefined
	}
	const waitFor = async (id: number): Promise<Frame> => {
		const deadline = Date.now() + 2000
		for (;;) {
			const f = latest(id)
			if (f !== undefined) return f
			if (Date.now() > deadline) throw new Error(`no response for id=${id}`)
			await sleep(1)
		}
	}

	return {
		send(frame: unknown) {
			for (const fn of stdinListeners["data"] || []) fn(`${JSON.stringify(frame)}\n`)
		},
		waitFor,
		emitSessionEvent(session: unknown, event: unknown) {
			for (const fn of eventListeners.get("session/event") || []) fn(session, event)
		},
		emitStream(payload: unknown) {
			for (const fn of eventListeners.get("agent/assistant-stream") || []) fn(payload)
		},
		eventFrames(type: string): Frame[] { return parsed().filter((f) => f.type === type) },
	}
}

async function startTurn(h: ReturnType<typeof makeHarness>, id: number): Promise<string> {
	h.send({ id, method: "session.open", params: { mode: "new" } })
	const opened = await h.waitFor(id)
	const sessionId = opened.result.sessionId as string
	h.send({ id: id + 1, method: "session.send", params: { text: "spawn a subagent" } })
	await h.waitFor(id + 1)
	return sessionId
}

function catalogChild(h: ReturnType<typeof makeHarness>, parentId: string, childId: string): void {
	h.emitSessionEvent(
		{ id: parentId },
		{ type: "subagent/catalog", data: { version: 3, childId, childCreatedAt: Date.now(), label: "scout" } },
	)
}

function childMessage(h: ReturnType<typeof makeHarness>, childId: string, text: string): void {
	h.emitSessionEvent({ id: childId }, { type: "assistant/message", data: { content: text } })
}

function childDelta(h: ReturnType<typeof makeHarness>, childId: string, text: string): void {
	h.emitStream({ agent: { id: childId }, frame: { type: "chunk", chunk: { type: "text-delta", text } } })
}

describe("B3 agent.progress frames (live subagent progress)", () => {
	test("E1: child assistant/message + text-delta emit agent.progress with the full field set", async () => {
		const h = makeHarness()
		const parentId = await startTurn(h, 1)
		catalogChild(h, parentId, "child-1")
		childMessage(h, "child-1", "first line")
		// leading edge is synchronous — frame visible without waiting
		let progress = h.eventFrames("agent.progress")
		expect(progress.length).toBeGreaterThanOrEqual(1)
		childDelta(h, "child-1", " streamed tail")
		await sleep(450) // trailing flush
		progress = h.eventFrames("agent.progress")
		expect(progress.length).toBeGreaterThanOrEqual(2)
		for (const f of progress) {
			expect(typeof f.payload.childId).toBe("string")
			expect(typeof f.payload.sessionId).toBe("string")
			expect(typeof f.payload.rounds).toBe("number")
			expect(typeof f.payload.lastLine).toBe("string")
			expect(typeof f.payload.elapsedSec).toBe("number")
			expect(f.payload.sessionId).toBe(parentId)
			expect(f.payload.childId).toBe("child-1")
		}
	})

	test("E2: rounds increment per assistant/message and never regress; lastLine follows latest text", async () => {
		const h = makeHarness()
		const parentId = await startTurn(h, 10)
		catalogChild(h, parentId, "child-2")
		childMessage(h, "child-2", "line1")
		childMessage(h, "child-2", "line2")
		childMessage(h, "child-2", "line3")
		await sleep(450) // trailing flush carries the final rounds=3 snapshot
		const progress = h.eventFrames("agent.progress")
		const rounds = progress.map((f) => f.payload.rounds as number)
		expect(rounds.length).toBeGreaterThanOrEqual(1)
		expect(rounds[rounds.length - 1]).toBe(3)
		for (let i = 1; i < rounds.length; i++) expect(rounds[i]!).toBeGreaterThanOrEqual(rounds[i - 1]!)
		expect(progress[progress.length - 1]!.payload.lastLine).toBe("line3")
	})

	test("E3: throttle coalesces hot deltas inside the window and always flushes the tail", async () => {
		const h = makeHarness()
		const parentId = await startTurn(h, 20)
		catalogChild(h, parentId, "child-3")
		// first delta emits immediately (leading), no wait
		childDelta(h, "child-3", "a")
		expect(h.eventFrames("agent.progress")).toHaveLength(1)
		// many more deltas inside the 400ms window — coalesced, NOT one frame each
		for (let i = 0; i < 7; i++) childDelta(h, "child-3", "b")
		expect(h.eventFrames("agent.progress")).toHaveLength(1)
		await sleep(450) // window close → trailing flush
		const progress = h.eventFrames("agent.progress")
		expect(progress).toHaveLength(2) // leading + trailing only
		expect(progress[0]!.payload.lastLine).toBe("a")
		expect(progress[1]!.payload.lastLine).toBe("abbbbbbb") // last value in window
	})

	test("E4: per-child throttle is independent; settle is immediate and no progress lands after it", async () => {
		const h = makeHarness()
		const parentId = await startTurn(h, 30)
		catalogChild(h, parentId, "child-a")
		catalogChild(h, parentId, "child-b")
		childDelta(h, "child-a", "A")
		childDelta(h, "child-b", "B")
		const before = h.eventFrames("agent.progress")
		expect(before.map((f) => f.payload.childId)).toContain("child-a")
		expect(before.map((f) => f.payload.childId)).toContain("child-b")

		// settle is immediate and not throttled
		h.emitSessionEvent(
			{ id: parentId },
			{ type: "tool-workflow/agent-end", data: { runId: "run-x", seq: 0, outcome: "completed" } },
		)
		expect(h.eventFrames("agent.settle")).toHaveLength(1)

		// mark both children settled in the index (their own turn/end), then try
		// more deltas — noteChildProgress must no-op, so progress count is frozen.
		h.emitSessionEvent({ id: "child-a" }, { type: "turn/end", data: {} })
		h.emitSessionEvent({ id: "child-b" }, { type: "turn/end", data: {} })
		await sleep(450)
		const settledCount = h.eventFrames("agent.progress").length
		childDelta(h, "child-a", "late")
		childDelta(h, "child-b", "late")
		await sleep(450)
		expect(h.eventFrames("agent.progress")).toHaveLength(settledCount)
	})

	test("unknown / foreign children never emit progress (spoof containment)", async () => {
		const h = makeHarness()
		const parentId = await startTurn(h, 40)
		// no catalog row → unknown child
		childDelta(h, "unknown-child", "x")
		childMessage(h, "unknown-child", "y")
		expect(h.eventFrames("agent.progress")).toHaveLength(0)
		// catalog row bound to a DIFFERENT parent must not be folded either
		h.emitSessionEvent(
			{ id: "other-parent" },
			{ type: "subagent/catalog", data: { childId: "foreign-child", childCreatedAt: Date.now() } },
		)
		childDelta(h, "foreign-child", "z")
		expect(h.eventFrames("agent.progress")).toHaveLength(0)
	})
})
