// RemoteHostSession wave-1 contract tests: a fake ClientConnection with
// scripted RPC results + a fake mux socket factory deliver the real wire
// frames (`session/create` / `session/prompt` / `$events/result` payloads,
// `session/follow` snapshot + durable event + assistant-stream frames) and
// assert the HostSession-shaped callbacks ShellHost consumes.
import { describe, expect, test } from "bun:test"
import { RemoteHostSession } from "../src/client/remote-host-session.ts"
import { expandCompactStream, scanUsageChunk, blocksText } from "../src/client/remote-follow.ts"
import { RemoteRpcError, type ClientConnection, type ClientConnectionState, type ClientEventDisposer, type ClientEventHandler, type ClientReadyInfo } from "../src/client/transport.ts"
import type { EventsItem } from "../src/client/mux-frame.ts"
import type { MuxSocket } from "../src/client/events-source.ts"
import type { TurnCallbacks } from "../src/agent/loop.ts"

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type RpcHandler = (method: string, args: Record<string, unknown>) => unknown | Promise<unknown>

/** Minimal ClientConnection stand-in (the frozen P1 surface subset). */
class FakeConnection {
	baseUrl = "http://127.0.0.1:18120"
	#eventHandlers = new Set<ClientEventHandler>()
	#stateListeners = new Set<(state: ClientConnectionState) => void>()
	#state: ClientConnectionState = "connecting"
	closed = false
	rpcCalls: { method: string; args: Record<string, unknown> }[] = []
	rpcHandler: RpcHandler = () => ({})

	async connect(): Promise<ClientReadyInfo> {
		this.#state = "connected"
		return { clientId: "client-1", host: { home: "/tmp/dsh-home" } }
	}

	async rpc<T = unknown>(method: string, args?: Record<string, unknown>): Promise<T> {
		this.rpcCalls.push({ method, args: args ?? {} })
		return (await this.rpcHandler(method, args ?? {})) as T
	}

	onEvent(handler: ClientEventHandler): ClientEventDisposer {
		this.#eventHandlers.add(handler)
		return () => this.#eventHandlers.delete(handler)
	}

	onStateChange(listener: (state: ClientConnectionState) => void): ClientEventDisposer {
		this.#stateListeners.add(listener)
		return () => this.#stateListeners.delete(listener)
	}

	getState(): ClientConnectionState {
		return this.#state
	}

	async close(): Promise<void> {
		this.closed = true
		this.#state = "disconnected"
		this.#eventHandlers.clear()
		this.#stateListeners.clear()
	}

	emit(item: EventsItem): void {
		for (const handler of [...this.#eventHandlers]) handler(item)
	}

	setState(state: ClientConnectionState): void {
		this.#state = state
		for (const listener of [...this.#stateListeners]) listener(state)
	}

	get listenerCounts(): { events: number; states: number } {
		return { events: this.#eventHandlers.size, states: this.#stateListeners.size }
	}
}

/** Minimal `ws` stand-in with the MuxSocket surface the pump drives. */
class FakeMuxSocket implements MuxSocket {
	readyState = 1
	sent: string[] = []
	closed = false
	#listeners = new Map<string, ((...args: unknown[]) => void)[]>()

	on(event: string, listener: (...args: unknown[]) => void): unknown {
		this.#add(event, listener)
		return this
	}

	once(event: string, listener: (...args: unknown[]) => void): unknown {
		return this.on(event, listener)
	}

	removeListener(event: string, listener: (...args: unknown[]) => void): unknown {
		const list = this.#listeners.get(event)
		if (list) this.#listeners.set(event, list.filter((l) => l !== listener))
		return this
	}

	send(data: string): void {
		this.sent.push(data)
	}

	close(): void {
		if (this.closed) return
		this.closed = true
		this.readyState = 3
		this.#emit("close")
	}

	#add(event: string, listener: (...args: unknown[]) => void): void {
		const list = this.#listeners.get(event) ?? []
		list.push(listener)
		this.#listeners.set(event, list)
	}

	#emit(event: string, ...args: unknown[]): void {
		for (const listener of [...(this.#listeners.get(event) ?? [])]) listener(...args)
	}

	/** The streamId the client opened (from its `open` frame). */
	get streamId(): string {
		const open = this.sent.find((s) => s.includes('"type":"open"'))
		return open ? (JSON.parse(open) as { streamId: string }).streamId : ""
	}

	get openFrame(): { type: string; endpoint: string; payload: { args: Record<string, unknown> } } {
		const open = this.sent.find((s) => s.includes('"type":"open"'))
		return JSON.parse(open!) as { type: string; endpoint: string; payload: { args: Record<string, unknown> } }
	}

	item(value: unknown): void {
		this.#emit("message", JSON.stringify({ type: "item", streamId: this.streamId, value }))
	}

	endStream(): void {
		this.#emit("message", JSON.stringify({ type: "end", streamId: this.streamId }))
	}

	errorFrame(code: string, message: string): void {
		this.#emit("message", JSON.stringify({ type: "error", streamId: this.streamId, error: { code, message, details: {} } }))
	}
}

function snapshotFrame(sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		type: "snapshot",
		header: { version: 1, id: sessionId, createdAt: 0, isSeeded: false },
		cursor: 0,
		records: [],
		hasMore: false,
		projections: { asOfSeq: 0, values: {} },
		...extra,
	}
}

function eventFrame(type: string, data: unknown, seq = 1): Record<string, unknown> {
	return { type: "event", event: { type, seq, time: Date.now(), data } }
}

function streamFrame(frame: Record<string, unknown>): Record<string, unknown> {
	return { type: "assistant-stream", frame }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
	connection: FakeConnection
	session: RemoteHostSession
	sockets: FakeMuxSocket[]
	lastSocket(): FakeMuxSocket
}

function makeSession(options: { cwd?: string; rpcHandler?: RpcHandler } = {}): Harness {
	const connection = new FakeConnection()
	if (options.rpcHandler) connection.rpcHandler = options.rpcHandler
	const sockets: FakeMuxSocket[] = []
	const session = new RemoteHostSession({
		connection: connection as unknown as ClientConnection,
		cookieHeader: "dsh-auth-x=v1.test",
		cwd: options.cwd ?? "/tmp/workspace",
		socketFactory: () => {
			const socket = new FakeMuxSocket()
			sockets.push(socket)
			return socket
		},
	})
	return { connection, session, sockets, lastSocket: () => sockets[sockets.length - 1]! }
}

/** Accept session/create + session/prompt with a stable session id. */
function defaultRpcHandler(sessionId = "sess-1"): RpcHandler {
	return (method) => {
		if (method === "session/create") return { sessionId, agentPreset: "review" }
		if (method === "session/prompt") return { accepted: true }
		if (method === "session/cancel") return { accepted: true }
		return {}
	}
}

function callbacks(overrides: Partial<TurnCallbacks> = {}): { cb: TurnCallbacks; log: { content: string[]; thinking: string[]; errors: string[]; turnEnds: number[]; toolStarts: { name: string; args: string }[]; toolRuns: { name: string; ok: boolean; imagePath?: string }[]; todos: { content: string; status: string }[][]; missedRows: { kind: string; text: string }[][] } } {
	const log = {
		content: [] as string[],
		thinking: [] as string[],
		errors: [] as string[],
		turnEnds: [] as number[],
		toolStarts: [] as { name: string; args: string }[],
		toolRuns: [] as { name: string; ok: boolean; imagePath?: string }[],
		todos: [] as { content: string; status: string }[][],
		missedRows: [] as { kind: string; text: string }[][],
	}
	const cb: TurnCallbacks = {
		onThinkingDelta: (t) => log.thinking.push(t),
		onContentDelta: (t) => log.content.push(t),
		onTurnEnd: (u) => log.turnEnds.push(u.prompt + u.completion),
		onApprove: async () => true,
		onToolRun: (run) => log.toolRuns.push({ name: run.name, ok: run.ok, ...(run.imagePath !== undefined ? { imagePath: run.imagePath } : {}) }),
		onError: (m) => log.errors.push(m),
		onToolStart: (s) => log.toolStarts.push({ name: s.name, args: s.args }),
		onTodos: (t) => log.todos.push(t),
		onReattachedMissed: (rows) => log.missedRows.push(rows),
		...overrides,
	}
	return { cb, log }
}

/** Poll until `fn()` is true (the waterfall answering paths are async). */
async function until(fn: () => boolean, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (!fn()) {
		if (Date.now() > deadline) throw new Error("until() timed out")
		await new Promise((r) => setTimeout(r, 5))
	}
}

function rpcOf(connection: FakeConnection, method: string): Record<string, unknown> | undefined {
	return connection.rpcCalls.find((c) => c.method === method)?.args
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("remote follow helpers", () => {
	test("scanUsageChunk covers the TokenUsage wire fields", () => {
		expect(scanUsageChunk({ usage: { inputTokens: 120, outputTokens: 8, cacheReadTokens: 90, cacheWriteTokens: 3 } })).toEqual({
			prompt: 120,
			completion: 8,
			cacheRead: 90,
			cacheWrite: 3,
		})
	})

	test("expandCompactStream joins text and reasoning runs", () => {
		const deltas = expandCompactStream([
			{ type: "reasoning-chunks", time0: 0, index: 0, dt: [1, 1], texts: ["think ", "more"] },
			{ type: "text-chunks", time0: 5, index: 1, dt: [2], texts: ["answer"] },
			{ type: "chunk", time: 9, chunk: { type: "text-delta", index: 1, text: "!" } },
			{ type: "chunk", time: 9, chunk: { type: "usage", usage: { inputTokens: 1 } } },
		])
		expect(deltas).toEqual([
			{ kind: "reasoning", text: "think more" },
			{ kind: "text", text: "answer" },
			{ kind: "text", text: "!" },
		])
	})

	test("blocksText joins text blocks", () => {
		expect(blocksText([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }])).toBe("a\nb")
	})
})

describe("RemoteHostSession turn lifecycle", () => {
	test("create + prompt + follow stream maps deltas, usage, turn end", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-1") })
		const { cb, log } = callbacks()
		const pending = h.session.turn("say ok", cb)
		await until(() => h.sockets.length > 0)

		const sock = h.lastSocket()
		expect(sock.openFrame.endpoint).toBe("session/follow")
		expect(sock.openFrame.payload.args).toEqual({
			request: { address: { kind: "session", sessionId: "sess-1" }, assistantStream: true },
		})

		sock.item(snapshotFrame("sess-1"))
		await until(() => rpcOf(h.connection, "session/create") !== undefined)
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		const prompt = rpcOf(h.connection, "session/prompt")!["request"] as Record<string, unknown>
		expect(prompt.mode).toBe("queue")
		expect(typeof prompt.requestId).toBe("string")
		expect(prompt.sessionId).toBe("sess-1")
		expect(prompt.content).toEqual([{ type: "text", text: "say ok" }])
		const create = rpcOf(h.connection, "session/create")!["request"] as Record<string, unknown>
		expect(create.cwd).toBe("/tmp/workspace")

		// Live presentation frames (reasoning-delta is present on the wire).
		sock.item(streamFrame({ type: "start", attemptId: "a1", revision: 0, startedAfterSeq: 0, turn: 1, step: 1 }))
		sock.item(streamFrame({ type: "chunk", attemptId: "a1", revision: 0, index: 0, time: 1, chunk: { type: "reasoning-delta", index: 0, text: "thinking" } }))
		sock.item(streamFrame({ type: "chunk", attemptId: "a1", revision: 0, index: 1, time: 2, chunk: { type: "text-delta", index: 0, text: "ok" } }))
		sock.item(streamFrame({ type: "chunk", attemptId: "a1", revision: 0, index: 2, time: 3, chunk: { type: "usage", usage: { inputTokens: 50, outputTokens: 4 } } }))
		sock.item(streamFrame({ type: "end", attemptId: "a1", revision: 0, index: 3, outcome: { kind: "committed", eventType: "assistant/message", seq: 9 } }))
		sock.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }))

		await pending
		expect(log.thinking).toEqual(["thinking"])
		expect(log.content.join("")).toBe("ok")
		expect(h.session.usage).toEqual({ prompt: 50, completion: 4, cacheRead: 0, cacheWrite: 0 })
		expect(log.turnEnds.length).toBe(1)
		expect(h.session.lastTurnStats.estimated).toBe(false)
		expect(h.session.lastTurnStats.tokens).toBe(4)
		// First attach after create replays no snapshot rows.
		expect(log.missedRows.length).toBe(0)
		await h.session.dispose()
	})

	test("tool call/result frames and todo/write reach the dock callbacks", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-2") })
		const { cb, log } = callbacks()
		const pending = h.session.turn("list files", cb)
		await until(() => h.sockets.length > 0)
		const sock = h.lastSocket()
		sock.item(snapshotFrame("sess-2"))
		// The turn gate arms only after the prompt is accepted — drive frames
		// after that (host ordering: prompt accept precedes all turn frames).
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)

		sock.item(eventFrame("tool/call", { turn: 1, step: 1, callId: "c1", name: "bash", arguments: '{"cmd":"ls"}' }, 2))
		sock.item(eventFrame("todo/write", { todos: [{ content: "inspect", status: "in_progress" }, { content: "report", status: "pending" }] }, 3))
		// Image path via the sibling <path> text block (host-session parity).
		sock.item(eventFrame("tool/result", {
			turn: 1,
			step: 1,
			message: {
				id: "m1",
				role: "tool",
				toolCallId: "c1",
				content: [
					{ type: "text", text: "saved chart <path>/tmp/chart.png</path>" },
					{ type: "image", source: "att-1" },
				],
				isError: false,
			},
		}, 4))
		// A failed result: isError true on the message.
		sock.item(eventFrame("tool/result", {
			turn: 1,
			step: 1,
			message: { id: "m2", role: "tool", toolCallId: "c2", content: [{ type: "text", text: "boom" }], isError: true },
		}, 5))
		sock.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 6))

		await pending
		expect(log.toolStarts).toEqual([{ name: "bash", args: '{"cmd":"ls"}' }])
		expect(log.todos).toEqual([[{ content: "inspect", status: "in_progress" }, { content: "report", status: "pending" }]])
		expect(log.toolRuns.length).toBe(2)
		expect(log.toolRuns[0]).toEqual({ name: "bash", ok: true, imagePath: "att-1" })
		expect(log.toolRuns[1]!.ok).toBe(false)
		await h.session.dispose()
	})

	test("usage chunks: prompt is assigned, completion accumulates", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-3") })
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		const sock = h.lastSocket()
		sock.item(snapshotFrame("sess-3"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		sock.item(streamFrame({ type: "start", attemptId: "a1", revision: 0, startedAfterSeq: 0, turn: 1, step: 1 }))
		sock.item(streamFrame({ type: "chunk", attemptId: "a1", revision: 0, index: 0, time: 1, chunk: { type: "usage", usage: { inputTokens: 100, outputTokens: 5 } } }))
		sock.item(streamFrame({ type: "end", attemptId: "a1", revision: 0, index: 1, outcome: { kind: "committed", eventType: "assistant/message", seq: 2 } }))
		sock.item(streamFrame({ type: "start", attemptId: "a2", revision: 0, startedAfterSeq: 2, turn: 1, step: 2 }))
		sock.item(streamFrame({ type: "chunk", attemptId: "a2", revision: 0, index: 0, time: 4, chunk: { type: "usage", usage: { inputTokens: 200, outputTokens: 3, cacheReadTokens: 80 } } }))
		sock.item(streamFrame({ type: "end", attemptId: "a2", revision: 0, index: 1, outcome: { kind: "committed", eventType: "assistant/message", seq: 3 } }))
		sock.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 4))
		await pending
		expect(h.session.usage.prompt).toBe(200)
		expect(h.session.usage.completion).toBe(8)
		expect(h.session.usage.cacheRead).toBe(80)
		expect(h.session.cacheHitRate()).toBeCloseTo(100, 0)
		await h.session.dispose()
	})

	test("turn/end error kind surfaces onError and settles", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-4") })
		const { cb, log } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		const sock = h.lastSocket()
		sock.item(snapshotFrame("sess-4"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		sock.item(eventFrame("turn/end", { turn: 1, reason: { kind: "error", error: { message: "provider exploded", code: "X" } } }, 2))
		await pending
		expect(log.errors).toEqual(["provider exploded"])
		expect(log.turnEnds.length).toBe(1)
		await h.session.dispose()
	})

	test("steer prompts with mode steer against the live session", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-5") })
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		h.lastSocket().item(snapshotFrame("sess-5"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		h.session.steer("focus on tests")
		await until(() => h.connection.rpcCalls.some((c) => c.method === "session/prompt" && (c.args["request"] as Record<string, unknown>)["mode"] === "steer"))
		const steer = h.connection.rpcCalls.filter((c) => c.method === "session/prompt").at(-1)!.args["request"] as Record<string, unknown>
		expect(steer.mode).toBe("steer")
		expect(steer.sessionId).toBe("sess-5")
		sockEndsTurn(h.lastSocket())
		await pending
		await h.session.dispose()
	})

	test("abort cancels, settles without onTurnEnd, next send is a fresh session", async () => {
		let created = 0
		const h = makeSession({
			rpcHandler: (method) => {
				if (method === "session/create") return { sessionId: `sess-${++created}` }
				if (method === "session/prompt") return { accepted: true }
				return {}
			},
		})
		const { cb, log } = callbacks()
		const first = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		h.lastSocket().item(snapshotFrame("sess-1"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)

		h.session.abort()
		await first
		expect(h.connection.rpcCalls.some((c) => c.method === "session/cancel")).toBe(true)
		expect(log.turnEnds.length).toBe(0)
		expect(h.session.currentSessionId()).toBeUndefined()

		// Next send creates a FRESH session id with its own follow stream.
		const second = h.session.turn("again", cb)
		await until(() => h.sockets.length > 1)
		h.sockets.at(-1)!.item(snapshotFrame("sess-2"))
		// Wait for THIS session's prompt (the first turn's entry is stale).
		await until(() =>
			h.connection.rpcCalls.some((c) => c.method === "session/prompt" && (c.args["request"] as Record<string, unknown>)["sessionId"] === "sess-2"),
		)
		expect(h.session.currentSessionId()).toBe("sess-2")
		h.sockets.at(-1)!.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		await second
		expect(log.turnEnds.length).toBe(1)
		await h.session.dispose()
	})
})

describe("RemoteHostSession waterfalls", () => {
	test("approval waterfall: claimed by agentId, args from the tool ledger, verdict parity", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-6") })
		const approvals: { name: string; args: Record<string, unknown> }[] = []
		let allow = true
		const { cb } = callbacks({
			onApprove: async (name, args) => {
				approvals.push({ name, args })
				return allow
			},
		})
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		const sock = h.lastSocket()
		sock.item(snapshotFrame("sess-6"))
		sock.item(eventFrame("tool/call", { turn: 1, step: 1, callId: "c1", name: "bash", arguments: '{"cmd":"rm -rf /"}' }, 2))
		await until(() => h.session.usage !== undefined)

		h.connection.emit({
			type: "waterfall",
			event: "approval/request",
			eventId: "e1",
			agentId: "sess-6",
			request: { toolName: "bash", callId: "c1" },
		})
		await until(() => h.connection.rpcCalls.some((c) => c.method === "$events/result"))
		expect(approvals).toEqual([{ name: "bash", args: { cmd: "rm -rf /" } }])
		expect(h.connection.rpcCalls.find((c) => c.method === "$events/result")!.args).toEqual({
			clientId: "client-1",
			eventId: "e1",
			outcome: { kind: "result", value: "allowed-once" },
		})

		allow = false
		h.connection.emit({
			type: "waterfall",
			event: "approval/request",
			eventId: "e2",
			agentId: "sess-6",
			request: { toolName: "write" },
		})
		await until(() => h.connection.rpcCalls.filter((c) => c.method === "$events/result").length === 2)
		expect(h.connection.rpcCalls.filter((c) => c.method === "$events/result").at(-1)!.args.outcome).toEqual({
			kind: "result",
			value: "rejected",
		})

		// Another surface's session: delegated, never claimed.
		h.connection.emit({
			type: "waterfall",
			event: "approval/request",
			eventId: "e3",
			agentId: "sess-other",
			request: { toolName: "bash" },
		})
		await until(() => h.connection.rpcCalls.filter((c) => c.method === "$events/result").length === 3)
		expect(h.connection.rpcCalls.filter((c) => c.method === "$events/result").at(-1)!.args.outcome).toEqual({ kind: "next" })

		sockEndsTurn(sock)
		await pending
		await h.session.dispose()
	})

	test("user-questions waterfall: ask provider answers, throw declines", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-7") })
		const asked: { id: string; prompt: string; options: string[] }[][] = []
		h.session.registerAskProvider(async (questions) => {
			asked.push(questions)
			if (asked.length === 1) return [{ questionId: "q1", selected: "allow" }]
			throw new Error("UI is gone")
		})
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		const sock = h.lastSocket()
		sock.item(snapshotFrame("sess-7"))

		h.connection.emit({
			type: "waterfall",
			event: "user-questions/request",
			eventId: "q-e1",
			agentId: "sess-7",
			request: {
				questions: [
					{ id: "q1", prompt: "Proceed?", options: [{ label: "allow", description: "yes" }, "deny"] },
				],
			},
		})
		await until(() => h.connection.rpcCalls.some((c) => c.method === "$events/result"))
		expect(asked[0]).toEqual([{ id: "q1", prompt: "Proceed?", options: ["allow", "deny"] }])
		expect(h.connection.rpcCalls.find((c) => c.method === "$events/result")!.args.outcome).toEqual({
			kind: "result",
			value: { answers: [{ id: "q1", selected: ["allow"] }] },
		})

		h.connection.emit({
			type: "waterfall",
			event: "user-questions/request",
			eventId: "q-e2",
			agentId: "sess-7",
			request: { questions: [{ id: "q2", question: "fallback prompt", header: "h" }] },
		})
		await until(() => h.connection.rpcCalls.filter((c) => c.method === "$events/result").length === 2)
		expect(asked[1]).toEqual([{ id: "q2", prompt: "fallback prompt", options: [] }])
		expect(h.connection.rpcCalls.filter((c) => c.method === "$events/result").at(-1)!.args.outcome).toEqual({
			kind: "result",
			value: { answers: [{ id: "q2", selected: [], custom: "declined" }] },
		})

		// Empty question list: delegated to the next listener.
		h.connection.emit({
			type: "waterfall",
			event: "user-questions/request",
			eventId: "q-e3",
			agentId: "sess-7",
			request: { questions: [] },
		})
		await until(() => h.connection.rpcCalls.filter((c) => c.method === "$events/result").length === 3)
		expect(h.connection.rpcCalls.filter((c) => c.method === "$events/result").at(-1)!.args.outcome).toEqual({ kind: "next" })

		sockEndsTurn(sock)
		await pending
		await h.session.dispose()
	})
})

describe("RemoteHostSession session ops", () => {
	test("resumeSession keeps the stored id and writer-held surfaces the takeover error", async () => {
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "session/create") {
					throw new RemoteRpcError("session/writer-held", "writer held", { sessionId: (args["request"] as Record<string, unknown>)["sessionId"] })
				}
				return {}
			},
		})
		expect(h.session.resumeSession("stored-9")).toBe("ok")
		const { cb, log } = callbacks()
		await expect(h.session.turn("go", cb)).rejects.toThrow(/another process/)
		expect(log.turnEnds.length).toBe(0)
		await h.session.dispose()
	})

	test("preset switch feeds the next session/create", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-8") })
		const { cb } = callbacks()
		h.session.switchPreset("reviewer")
		expect(h.session.currentPresetId()).toBe("reviewer")
		const pending = h.session.turn("go", cb)
		await until(() => rpcOf(h.connection, "session/create") !== undefined)
		const create = rpcOf(h.connection, "session/create")!["request"] as Record<string, unknown>
		expect(create.agentPreset).toBe("reviewer")
		h.lastSocket().item(snapshotFrame("sess-8"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		h.lastSocket().item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		await pending
		await h.session.dispose()
	})
})

describe("RemoteHostSession generation-change re-attach", () => {
	test("reconnect re-opens follow, replays missed rows + compact stream, resumes live chunks", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-9") })
		const { cb, log } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		const first = h.lastSocket()
		first.item(snapshotFrame("sess-9"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		first.item(streamFrame({ type: "start", attemptId: "a1", revision: 0, startedAfterSeq: 0, turn: 1, step: 1 }))
		first.item(streamFrame({ type: "chunk", attemptId: "a1", revision: 0, index: 0, time: 1, chunk: { type: "text-delta", index: 0, text: "hel" } }))
		expect(log.content.join("")).toBe("hel")

		// Transport loss mid-turn: the follow stream dies, the carrier stays up.
		first.close()
		await until(() => h.session.label === "reconnecting…")
		expect(h.connection.listenerCounts.states).toBe(1)

		// Connection generation change: the SDK loop reports connected again.
		h.connection.setState("connected")
		await until(() => h.sockets.length > 1)
		const second = h.lastSocket()
		second.item(snapshotFrame("sess-9", {
			records: [
				eventFrame("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "from the phone" }] }, 1),
				eventFrame("assistant/message", { message: { content: [{ type: "text", text: "phone answer" }] } }, 2),
			],
			assistantStream: {
				revision: 2,
				activeAttempt: {
					attemptId: "a1",
					startedAfterSeq: 2,
					turn: 1,
					step: 1,
					nextIndex: 2,
					stream: [
						{ type: "text-chunks", time0: 2, index: 0, dt: [1, 1], texts: ["hel", "lo"] },
					],
				},
			},
		}))

		// Compact stream replay: wave 1 replays the WHOLE accumulated attempt
		// text (no-loss choice — the gap cannot be sliced per-delta), so the
		// pre-gap "hel" is painted again; dedupe is wave-2 polish.
		await until(() => log.content.join("") === "helhello")
		// Missed durable rows ride onReattachedMissed.
		await until(() => log.missedRows.length === 1)
		expect(log.missedRows[0]).toEqual([
			{ kind: "user", text: "from the phone" },
			{ kind: "assistant", text: "phone answer" },
		])
		expect(h.session.label).not.toBe("reconnecting…")

		// Live chunks continue at the baseline index; below-baseline drops.
		second.item(streamFrame({ type: "chunk", attemptId: "a1", revision: 2, index: 1, time: 5, chunk: { type: "text-delta", index: 1, text: "DUP" } }))
		second.item(streamFrame({ type: "chunk", attemptId: "a1", revision: 2, index: 2, time: 6, chunk: { type: "text-delta", index: 2, text: " world" } }))
		second.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 9))
		await pending
		expect(log.content.join("")).toBe("helhello world")
		expect(log.turnEnds.length).toBe(1)
		await h.session.dispose()
	})

	test("dispose leaves no listeners and closes the carrier", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-10") })
		await h.session.start()
		expect(h.connection.listenerCounts.events).toBe(1)
		expect(h.connection.listenerCounts.states).toBe(1)
		await h.session.dispose()
		expect(h.connection.closed).toBe(true)
		expect(h.connection.listenerCounts.events).toBe(0)
		expect(h.connection.listenerCounts.states).toBe(0)
	})
})

/** Drive the current socket's follow stream to a completed turn/end. */
function sockEndsTurn(sock: FakeMuxSocket): void {
	sock.item(streamFrame({ type: "end", attemptId: "a1", revision: 0, index: 1, outcome: { kind: "committed", eventType: "assistant/message", seq: 2 } }))
	sock.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 3))
}
