/**
 * LIVE TRANSCRIPT — protocol-level unit tests for the additive
 * `agent.transcript` frame. Same fake-cordis-ctx + NDJSON technique as
 * agent-progress.test.ts; no host package is imported, no test is run here.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { apply, probeAgentTranscriptResidue } from "../src/index"

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
	const idlePromise = new Promise<void>(() => { /* never resolves */ })
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
		ctx,
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
		frames(type: string): Frame[] { return parsed().filter((f) => f.type === type) },
		all(): Frame[] { return parsed() },
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

describe("LIVE TRANSCRIPT agent.transcript frames", () => {
	test("E1: frame shape is additive and whitelisted", async () => {
		const h = makeHarness()
		const parentId = await startTurn(h, 1)
		catalogChild(h, parentId, "child-1")
		h.emitSessionEvent({ id: "child-1" }, {
			type: "assistant/message",
			data: { content: [{ type: "text", text: "hello" }] },
		})
		const frames = h.frames("agent.transcript")
		expect(frames.length).toBe(1)
		const p = frames[0]!.payload
		expect(Object.keys(p).sort()).toEqual(["childId", "rows", "seq", "sessionId", "turnId"])
		expect(p.childId).toBe("child-1")
		expect(p.sessionId).toBe(parentId)
		expect(typeof p.seq).toBe("number")
		expect(Array.isArray(p.rows)).toBe(true)
		for (const row of p.rows) expect(["assistant", "tool"]).toContain(row.kind)
	})

	test("E2: finalized assistant/message text, token deltas never transcribed", async () => {
		const h = makeHarness()
		const parentId = await startTurn(h, 2)
		catalogChild(h, parentId, "child-2")
		for (let i = 0; i < 5; i++) {
			h.emitStream({ agent: { id: "child-2" }, frame: { type: "chunk", chunk: { type: "text-delta", text: "x" } } })
		}
		expect(h.frames("agent.transcript")).toHaveLength(0) // deltas only feed progress
		h.emitSessionEvent({ id: "child-2" }, {
			type: "assistant/message",
			data: { content: [{ type: "text", text: "line one" }, { type: "text", text: "\nline two" }] },
		})
		const frames = h.frames("agent.transcript")
		expect(frames).toHaveLength(1)
		expect(frames[0]!.payload.rows[0]).toEqual({ kind: "assistant", text: "line one\nline two" })
	})

	test("E2b: a child tool call/result pair emits ONE finalized tool row", async () => {
		const h = makeHarness()
		const parentId = await startTurn(h, 3)
		catalogChild(h, parentId, "child-3")
		h.emitSessionEvent({ id: "child-3" }, {
			type: "tool/call", data: { callId: "c1", name: "read_file", arguments: "{}" },
		})
		expect(h.frames("agent.transcript")).toHaveLength(0) // call alone is not final
		h.emitSessionEvent({ id: "child-3" }, {
			type: "tool/result",
			data: { message: { toolCallId: "c1", content: [{ type: "text", text: "file body" }] } },
		})
		const frames = h.frames("agent.transcript")
		expect(frames).toHaveLength(1)
		expect(frames[0]!.payload.rows[0]).toEqual({ kind: "tool", text: "read_file", output: "file body" })
	})

	test("E3: seq is monotonic per run and pending rows flush before settle", async () => {
		const h = makeHarness()
		const parentId = await startTurn(h, 4)
		catalogChild(h, parentId, "child-4")
		for (const text of ["a", "b", "c"]) {
			h.emitSessionEvent({ id: "child-4" }, { type: "assistant/message", data: { content: text } })
		}
		const frames = h.frames("agent.transcript")
		expect(frames.map((f) => f.payload.seq)).toEqual([0, 1, 2])
		// child terminal: no transcript frame may land after its settle
		h.emitSessionEvent({ id: "child-4" }, { type: "turn/end", data: {} })
		const settledIndex = h.all().findIndex((f) => f.type === "agent.settle")
		const lastTranscript = h.all().map((f) => f.type).lastIndexOf("agent.transcript")
		expect(settledIndex).toBeGreaterThan(-1)
		expect(lastTranscript).toBeLessThan(settledIndex)
		const after = frames.length
		h.emitSessionEvent({ id: "child-4" }, { type: "assistant/message", data: { content: "late" } })
		expect(h.frames("agent.transcript")).toHaveLength(after)
		expect(probeAgentTranscriptResidue(h.ctx)?.childTranscripts).toBe(0)
	})

	test("E4: unknown/foreign children never emit; parent turn pipeline unchanged", async () => {
		const h = makeHarness()
		const parentId = await startTurn(h, 5)
		h.emitSessionEvent({ id: "unknown-child" }, { type: "assistant/message", data: { content: "x" } })
		expect(h.frames("agent.transcript")).toHaveLength(0)
		h.emitSessionEvent(
			{ id: "other-parent" },
			{ type: "subagent/catalog", data: { childId: "foreign-child", childCreatedAt: Date.now() } },
		)
		h.emitSessionEvent({ id: "foreign-child" }, { type: "assistant/message", data: { content: "y" } })
		expect(h.frames("agent.transcript")).toHaveLength(0)
		// Parent's own turn frames still ride the normal pipeline.
		h.emitSessionEvent({ id: parentId }, { type: "tool/call", data: { callId: "p1", name: "parent_tool", arguments: "{}" } })
		expect(h.frames("turn.tool").some((f) => f.payload.name === "parent_tool")).toBe(true)
	})
})
