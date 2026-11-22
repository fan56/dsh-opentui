/**
 * Protocol-level unit test: the bridge forwards the host's durable
 * `tool-workflow/agent-start|agent-end` session events as additive
 * `agent.spawn`/`agent.settle` event frames (subagent visibility on the inproc
 * path). Same fake-cordis-ctx + NDJSON wire technique as turn-terminal.test.ts:
 * the real `apply()` is driven through stdio, no host package is imported.
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
		eventFrames(type: string): Frame[] { return parsed().filter((f) => f.type === type) },
	}
}

async function startTurn(h: ReturnType<typeof makeHarness>, id: number): Promise<{ sessionId: string; turnId: string }> {
	h.send({ id, method: "session.open", params: { mode: "new" } })
	const opened = await h.waitFor(id)
	const sessionId = opened.result.sessionId as string
	h.send({ id: id + 1, method: "session.send", params: { text: "spawn a subagent" } })
	const sent = await h.waitFor(id + 1)
	return { sessionId, turnId: sent.result.turnId as string }
}

describe("subagent lifecycle frames (inproc visibility)", () => {
	test("agent-start → agent.settle emits agent.spawn then agent.settle with runId:seq pairing data", async () => {
		const h = makeHarness()
		const { sessionId, turnId } = await startTurn(h, 1)

		h.emitSessionEvent(
			{ id: sessionId },
			{
				type: "tool-workflow/agent-start",
				data: { runId: "run-7", seq: 0, label: "scout", childId: "child-abc" },
			},
		)
		const spawns = h.eventFrames("agent.spawn")
		expect(spawns).toHaveLength(1)
		expect(spawns[0].payload).toMatchObject({
			turnId,
			sessionId,
			childId: "child-abc",
			label: "scout",
			runId: "run-7",
			seq: 0,
		})

		h.emitSessionEvent(
			{ id: sessionId },
			{ type: "tool-workflow/agent-end", data: { runId: "run-7", seq: 0, outcome: "failed" } },
		)
		const settles = h.eventFrames("agent.settle")
		expect(settles).toHaveLength(1)
		expect(settles[0].payload).toMatchObject({
			turnId,
			sessionId,
			runId: "run-7",
			seq: 0,
			outcome: "failed",
		})
	})

	test("P2-1(a): durable agent records still forward AFTER the turn ends (no activeTurn gate)", async () => {
		const h = makeHarness()
		const { sessionId, turnId } = await startTurn(h, 1)

		// Finalize the turn through the real firehose path: activeTurn is cleared
		// and the bridge is idle. Before P2-1(a) every later session/event was
		// dropped at `state === undefined || state.ended`, so a late agent-end
		// left a running ghost and an idle-period background run was invisible.
		h.emitSessionEvent({ id: sessionId }, { type: "turn/end", data: { reason: "completed" } })
		expect(h.eventFrames("turn.end")).toHaveLength(1)

		h.emitSessionEvent(
			{ id: sessionId },
			{
				type: "tool-workflow/agent-start",
				data: { runId: "late-run", seq: 0, label: "background", childId: "child-late" },
			},
		)
		h.emitSessionEvent(
			{ id: sessionId },
			{ type: "tool-workflow/agent-end", data: { runId: "late-run", seq: 0, outcome: "completed" } },
		)

		const spawns = h.eventFrames("agent.spawn")
		const settles = h.eventFrames("agent.settle")
		expect(spawns).toHaveLength(1)
		expect(settles).toHaveLength(1)
		// Session filter is the ONLY gate left: the bound session id is carried.
		expect(spawns[0].payload).toMatchObject({ sessionId, childId: "child-late", runId: "late-run", seq: 0 })
		expect(settles[0].payload).toMatchObject({ sessionId, runId: "late-run", seq: 0, outcome: "completed" })
		// No active turn => no bridge turnId to attribute (the seam pairs by
		// runId:seq), so the frames carry an honest inert empty turnId.
		expect(typeof spawns[0].payload.turnId).toBe("string")
		expect(turnId).not.toBe("")

		// Other event types KEEP the turn gate: a tool/call after the end must
		// not emit a turn.tool frame.
		h.emitSessionEvent({ id: sessionId }, { type: "tool/call", data: { callId: "c1", name: "bash" } })
		expect(h.eventFrames("turn.tool")).toHaveLength(0)
	})

	test("P2-1(a): stale-session agent records are still dropped when idle", async () => {
		const h = makeHarness()
		const { sessionId } = await startTurn(h, 1)
		h.emitSessionEvent({ id: sessionId }, { type: "turn/end", data: { reason: "completed" } })

		h.emitSessionEvent(
			{ id: "another-session" },
			{ type: "tool-workflow/agent-start", data: { runId: "r", seq: 0, childId: "c" } },
		)
		expect(h.eventFrames("agent.spawn")).toHaveLength(0)
	})

	test("events from a different session are dropped (no cross-session agent rows)", async () => {
		const h = makeHarness()
		await startTurn(h, 1)

		h.emitSessionEvent(
			{ id: "some-other-session" },
			{
				type: "tool-workflow/agent-start",
				data: { runId: "r", seq: 0, label: "x", childId: "child-x" },
			},
		)
		expect(h.eventFrames("agent.spawn")).toHaveLength(0)
	})

	test("plain subagent/catalog (the real delegation record) forwards as agent.spawn", async () => {
		const h = makeHarness()
		const { sessionId, turnId } = await startTurn(h, 1)

		// The host appends `subagent/catalog` to the PARENT journal for a plain
		// `subagent` call (no tool-workflow/agent-start exists on that path).
		h.emitSessionEvent(
			{ id: sessionId },
			{
				type: "subagent/catalog",
				data: {
					version: 3, childId: "child-catalog", childCreatedAt: 1795074915419,
					mode: "continuable", label: "List and verify primes", name: "primes",
				},
			},
		)
		const spawns = h.eventFrames("agent.spawn")
		expect(spawns).toHaveLength(1)
		expect(spawns[0].payload).toMatchObject({
			turnId,
			sessionId,
			childId: "child-catalog",
			label: "List and verify primes",
			// F5: the host v3 child reservation name rides through as its own
			// field (not folded into label) so the seam can render it.
			name: "primes",
			runId: "catalog:child-catalog",
			seq: 0,
		})
	})

	test("subagent/catalog without a host name forwards no name field", async () => {
		const h = makeHarness()
		const { sessionId } = await startTurn(h, 1)
		h.emitSessionEvent(
			{ id: sessionId },
			{ type: "subagent/catalog", data: { version: 3, childId: "c-noname", label: "task" } },
		)
		const spawns = h.eventFrames("agent.spawn")
		expect(spawns).toHaveLength(1)
		expect(spawns[0].payload).not.toHaveProperty("name")
	})

	test("subagent/catalog from a different session is dropped", async () => {
		const h = makeHarness()
		await startTurn(h, 1)
		h.emitSessionEvent(
			{ id: "another-session" },
			{ type: "subagent/catalog", data: { childId: "c", label: "x" } },
		)
		expect(h.eventFrames("agent.spawn")).toHaveLength(0)
	})

	test("tool/call + tool/result frames carry callId so the seam can keep args", async () => {
		const h = makeHarness()
		const { sessionId } = await startTurn(h, 1)

		h.emitSessionEvent(
			{ id: sessionId },
			{ type: "tool/call", data: { turn: 1, callId: "call-9", name: "todo_write", arguments: '{"todos":[]}' } },
		)
		h.emitSessionEvent(
			{ id: sessionId },
			{ type: "tool/result", data: { turn: 1, message: { toolCallId: "call-9", content: [] } } },
		)
		const tools = h.eventFrames("turn.tool")
		expect(tools).toHaveLength(2)
		expect(tools[0].payload).toMatchObject({ callId: "call-9", name: "todo_write", input: { todos: [] } })
		expect(tools[1].payload).toMatchObject({ callId: "call-9", name: "todo_write" })
		expect(typeof tools[1].payload.output).toBe("string")
	})

	// ---- oldfox 9190946 review P2-2① / P1-1 / P3-2 补测 --------------------

	test("P2-2①: subagent/catalog with no childId is dropped (no ghost roster row)", async () => {
		const h = makeHarness()
		const { sessionId } = await startTurn(h, 1)
		h.emitSessionEvent(
			{ id: sessionId },
			{ type: "subagent/catalog", data: { version: 3, label: "no id", name: "ghost" } },
		)
		h.emitSessionEvent(
			{ id: sessionId },
			{ type: "subagent/catalog", data: { version: 3, childId: "", label: "empty id" } },
		)
		expect(h.eventFrames("agent.spawn")).toHaveLength(0)
	})

	test("P2-2①: an empty catalog label falls back to the host's name", async () => {
		const h = makeHarness()
		const { sessionId } = await startTurn(h, 1)
		h.emitSessionEvent(
			{ id: sessionId },
			{ type: "subagent/catalog", data: { version: 3, childId: "c-name", label: "", name: "prime-checker" } },
		)
		const spawns = h.eventFrames("agent.spawn")
		expect(spawns).toHaveLength(1)
		expect(spawns[0].payload.label).toBe("prime-checker")
	})

	test("P2-2①: with no active turn the catalog spawn carries an inert empty turnId", async () => {
		const h = makeHarness()
		const { sessionId, turnId } = await startTurn(h, 1)
		expect(turnId).not.toBe("")
		h.emitSessionEvent({ id: sessionId }, { type: "turn/end", data: { reason: "completed" } })
		h.emitSessionEvent(
			{ id: sessionId },
			{ type: "subagent/catalog", data: { version: 3, childId: "c-idle", label: "L" } },
		)
		const spawns = h.eventFrames("agent.spawn")
		expect(spawns).toHaveLength(1)
		expect(spawns[0].payload.turnId).toBe("")
		expect(spawns[0].payload.sessionId).toBe(sessionId)
	})

	test("P1-1: tool/result turn.tool frame carries the isError mirror (both row and nested message)", async () => {
		const h = makeHarness()
		const { sessionId } = await startTurn(h, 1)
		h.emitSessionEvent(
			{ id: sessionId },
			{ type: "tool/result", data: { turn: 1, message: { toolCallId: "c-ok", content: [], isError: false } } },
		)
		h.emitSessionEvent(
			{ id: sessionId },
			{ type: "tool/result", data: { turn: 1, message: { toolCallId: "c-bad", content: [], isError: true } } },
		)
		h.emitSessionEvent(
			{ id: sessionId },
			{ type: "tool/result", data: { turn: 1, isError: true, message: { toolCallId: "c-rowbad", content: [] } } },
		)
		const tools = h.eventFrames("turn.tool")
		expect(tools).toHaveLength(3)
		expect(tools[0].payload).toMatchObject({ callId: "c-ok", isError: false })
		expect(tools[1].payload).toMatchObject({ callId: "c-bad", isError: true })
		expect(tools[2].payload).toMatchObject({ callId: "c-rowbad", isError: true })
	})

	test("P3-2: catalog spawn forwards the host's childCreatedAt wall clock", async () => {
		const h = makeHarness()
		const { sessionId } = await startTurn(h, 1)
		h.emitSessionEvent(
			{ id: sessionId },
			{
				type: "subagent/catalog",
				data: { version: 3, childId: "c-clock", childCreatedAt: 1795074915408, label: "L" },
			},
		)
		const spawns = h.eventFrames("agent.spawn")
		expect(spawns).toHaveLength(1)
		expect(spawns[0].payload.childCreatedAt).toBe(1795074915408)
	})

	test("protocolVersion is unchanged (additive frames stay on v1)", async () => {
		const h = makeHarness()
		h.send({ id: 50, method: "bridge.hello", params: { protocolVersion: 1 } })
		const hello = await h.waitFor(50)
		expect(hello.ok).toBe(true)
		expect(hello.result.protocolVersion).toBe(1)
	})
})
