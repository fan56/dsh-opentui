// RemoteHostSession wave-1 contract tests: a fake ClientConnection with
// scripted RPC results + a fake mux socket factory deliver the real wire
// frames (`session/create` / `session/prompt` / `$events/result` payloads,
// `session/follow` snapshot + durable event + assistant-stream frames) and
// assert the HostSession-shaped callbacks ShellHost consumes.
import { describe, expect, test } from "bun:test"
import { RemoteHostSession, REATTACH_RETRY_MS, REATTACH_MAX_ATTEMPTS } from "../src/client/remote-host-session.ts"
import { RemoteFollowSession, expandCompactStream, scanUsageChunk, blocksText, type RemoteFollowSink } from "../src/client/remote-follow.ts"
import { RemoteRpcError, type ClientConnection, type ClientConnectionState, type ClientEventDisposer, type ClientEventHandler, type ClientReadyInfo } from "../src/client/transport.ts"
import { askCallData, askResultData } from "./client-fakes.ts"
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

function makeSession(options: { cwd?: string; rpcHandler?: RpcHandler; reattachRetryMs?: number; reattachMaxAttempts?: number } = {}): Harness {
	const connection = new FakeConnection()
	if (options.rpcHandler) connection.rpcHandler = options.rpcHandler
	const sockets: FakeMuxSocket[] = []
	const session = new RemoteHostSession({
		connection: connection as unknown as ClientConnection,
		cookieHeader: "dsh-auth-x=v1.test",
		cwd: options.cwd ?? "/tmp/workspace",
		...(options.reattachRetryMs !== undefined ? { reattachRetryMs: options.reattachRetryMs } : {}),
		...(options.reattachMaxAttempts !== undefined ? { reattachMaxAttempts: options.reattachMaxAttempts } : {}),
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
		// Wave 2: per-text deltas carrying dense indexes (the dedupe
		// granularity) — text-chunks records spread their texts across
		// index..index+texts.length-1; bare chunk records keep chunk.index.
		expect(deltas).toEqual([
			{ kind: "reasoning", text: "think " },
			{ kind: "reasoning", text: "more" },
			{ kind: "text", text: "answer" },
			{ kind: "text", text: "!" },
		])
	})

	test("blocksText joins text blocks", () => {
		expect(blocksText([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }])).toBe("a\nb")
	})
	test("blocksText reads a plain STRING content body (no silent drop)", () => {
		expect(blocksText("flat text")).toBe("flat text")
		expect(blocksText("")).toBe("")
		expect(blocksText(undefined)).toBe("")
		expect(blocksText({ type: "text", text: "not an array" })).toBe("")
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

	test("ask_user_question tool pair rides the follow stream into the dock callbacks", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-ask") })
		const { cb, log } = callbacks()
		const pending = h.session.turn("ask me", cb)
		await until(() => h.sockets.length > 0)
		const sock = h.lastSocket()
		sock.item(snapshotFrame("sess-ask"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)

		sock.item(eventFrame("tool/call", askCallData("a1", [
			{ id: "q1", question: "Proceed?", options: [{ label: "allow" }, { label: "deny" }] },
			{ id: "q2", header: "Scope", question: "Which dir?", options: ["src", "tests"] },
		]), 2))
		// The user answers both questions (declined envelope shape for q2 here).
		sock.item(eventFrame("tool/result", askResultData("a1", [
			{ id: "q1", selected: ["allow"] },
			{ id: "q2", selected: [], custom: "declined" },
		]), 3))
		sock.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 4))

		await pending
		// The pair reaches ShellHost's callbacks with the full call args and
		// the parseable result brief (ShellHost turns them into the Q&A block).
		expect(log.toolStarts).toEqual([{ name: "ask_user_question", args: JSON.stringify({ questions: [
			{ id: "q1", question: "Proceed?", options: [{ label: "allow" }, { label: "deny" }] },
			{ id: "q2", header: "Scope", question: "Which dir?", options: ["src", "tests"] },
		] }) }])
		expect(log.toolRuns).toHaveLength(1)
		expect(log.toolRuns[0]!.ok).toBe(true)
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
		// batch F2 cacheHitMode semantics (tui-pi parity): lastMessage bills
		// the WHOLE prompt (80 cached of 100+80=280 billed), not read/(read+write)
		expect(h.session.cacheHitRate()).toBeCloseTo((80 / 280) * 100, 3)
		expect(h.session.cacheHitRate("session")).toBeCloseTo((80 / 380) * 100, 3)
		await h.session.dispose()
	})

	test("cacheHitMode: lastMessage follows the latest request, session is cumulative", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-ch") })
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		const sock = h.lastSocket()
		sock.item(snapshotFrame("sess-ch"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		// turn one (warm): 1000 billed input, 900 cached -> 90% in both modes
		sock.item(streamFrame({ type: "start", attemptId: "a1", revision: 0, startedAfterSeq: 0, turn: 1, step: 1 }))
		sock.item(streamFrame({ type: "chunk", attemptId: "a1", revision: 0, index: 0, time: 1, chunk: { type: "usage", usage: { inputTokens: 100, outputTokens: 5, cacheReadTokens: 900 } } }))
		sock.item(streamFrame({ type: "end", attemptId: "a1", revision: 0, index: 1, outcome: { kind: "committed", eventType: "assistant/message", seq: 2 } }))
		expect(h.session.cacheHitRate()).toBeCloseTo(90, 5)
		expect(h.session.cacheHitRate("session")).toBeCloseTo(90, 5)
		// turn two (cold): 1000 billed, 200 cached -> latest 20%, cumulative 55%
		sock.item(streamFrame({ type: "start", attemptId: "a2", revision: 0, startedAfterSeq: 2, turn: 1, step: 2 }))
		sock.item(streamFrame({ type: "chunk", attemptId: "a2", revision: 0, index: 0, time: 4, chunk: { type: "usage", usage: { inputTokens: 800, outputTokens: 3, cacheReadTokens: 200 } } }))
		sock.item(streamFrame({ type: "end", attemptId: "a2", revision: 0, index: 1, outcome: { kind: "committed", eventType: "assistant/message", seq: 3 } }))
		sock.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 4))
		await pending
		expect(h.session.cacheHitRate()).toBeCloseTo(20, 5)
		expect(h.session.cacheHitRate("lastMessage")).toBeCloseTo(20, 5)
		expect(h.session.cacheHitRate("session")).toBeCloseTo(55, 5)
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

		// Compact stream replay (wave-2 dedupe): resumes CLEAN at the dense
		// index the live stream already consumed ("hel" at index 0 stays
		// painted once; the replay contributes only "lo" at index 1).
		await until(() => log.content.join("") === "hello")
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
		expect(log.content.join("")).toBe("hello world")
		expect(log.turnEnds.length).toBe(1)
		await h.session.dispose()
	})

	// P1#1: a REALISTIC re-attach window — the snapshot contains the records
	// the client already painted live pre-gap (seq ≤ the durable baseline)
	// plus genuinely new records. The baseline filter must paint only the new
	// rows: no re-painted user/assistant rows, no re-announced tool calls, no
	// duplicated journal brackets.
	test("re-attach replay folds against the durable baseline: already-painted records never paint twice", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-r1") })
		const { cb, log } = callbacks()
		// Turn 1 completes live: its full record window is journaled pre-gap.
		const first = h.session.turn("say ok", cb)
		await until(() => h.sockets.length > 0)
		const sock1 = h.lastSocket()
		sock1.item(snapshotFrame("sess-r1"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		sock1.item(eventFrame("turn/start", { turn: 1 }, 1))
		sock1.item(eventFrame("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "say ok" }] }, 2))
		sock1.item(eventFrame("tool/call", { turn: 1, step: 1, callId: "c1", name: "bash", arguments: '{"cmd":"ls"}' }, 3))
		sock1.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 4))
		await first
		expect(log.toolStarts.length).toBe(1) // painted once, live

		// Turn 2 starts, its prompt record lands live, one delta paints —
		// then the follow stream dies (restart / transport loss).
		const second = h.session.turn("go again", cb)
		await until(() => h.connection.rpcCalls.filter((c) => c.method === "session/prompt").length >= 2)
		sock1.item(eventFrame("turn/start", { turn: 2 }, 5))
		sock1.item(eventFrame("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "go again" }] }, 6))
		sock1.item(streamFrame({ type: "start", attemptId: "a2", revision: 0, startedAfterSeq: 6, turn: 2, step: 1 }))
		sock1.item(streamFrame({ type: "chunk", attemptId: "a2", revision: 0, index: 0, time: 1, chunk: { type: "text-delta", index: 0, text: "he" } }))
		expect(log.content.join("")).toBe("he")
		sock1.close()
		await until(() => h.session.label === "reconnecting…")

		// The fresh host answers with the FULL snapshot window: records 1-6
		// are at/below the painted baseline (lastDurableSeq = 6) and must be
		// skipped whole; only the gap rows replay.
		h.connection.setState("connected")
		await until(() => h.sockets.length > 1)
		const sock2 = h.lastSocket()
		sock2.item(snapshotFrame("sess-r1", {
			records: [
				eventFrame("turn/start", { turn: 1 }, 1),
				eventFrame("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "say ok" }] }, 2),
				eventFrame("tool/call", { turn: 1, step: 1, callId: "c1", name: "bash", arguments: '{"cmd":"ls"}' }, 3),
				eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 4),
				eventFrame("turn/start", { turn: 2 }, 5),
				eventFrame("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "go again" }] }, 6),
				eventFrame("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "from the phone" }] }, 7),
				eventFrame("assistant/message", { message: { content: [{ type: "text", text: "phone answer" }] } }, 8),
			],
			assistantStream: {
				revision: 2,
				activeAttempt: {
					attemptId: "a2",
					startedAfterSeq: 6,
					turn: 2,
					step: 1,
					nextIndex: 2,
					stream: [{ type: "text-chunks", time0: 2, index: 0, dt: [1, 1], texts: ["he", "llo"] }],
				},
			},
		}))
		await until(() => log.missedRows.length === 1)
		// ONLY the gap rows replayed — the already-painted turn 1/2 rows and
		// the announced tool call did not come back a second time.
		expect(log.missedRows[0]).toEqual([
			{ kind: "user", text: "from the phone" },
			{ kind: "assistant", text: "phone answer" },
		])
		expect(log.toolStarts.length).toBe(1)
		// Compact-stream dedupe still resumes clean ("he" stays painted once).
		expect(log.content.join("")).toBe("hello")
		expect(h.session.label).not.toBe("reconnecting…")

		sock2.item(streamFrame({ type: "chunk", attemptId: "a2", revision: 2, index: 2, time: 5, chunk: { type: "text-delta", index: 2, text: " world" } }))
		sock2.item(eventFrame("turn/end", { turn: 2, reason: { kind: "completed" } }, 9))
		await second
		expect(log.content.join("")).toBe("hello world")
		expect(log.turnEnds.length).toBe(2)
		// Journal dedupe: the snapshot re-fold must not duplicate brackets —
		// /history still sees exactly two turns with the same fork points.
		expect(h.session.historyTurns()).toEqual([
			{ turn: 1, seqEnd: 4, preview: "say ok" },
			{ turn: 2, seqEnd: 9, preview: "go again" },
		])
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

	// P2: the awaiting turn must outlive a same-port host restart, whose own
	// readiness budget is 30s (remote-restart.ts readinessTimeoutMs ?? 30_000).
	// The old 10×1s budget errored the turn ~15s BEFORE a legitimate restart
	// finished. Here a compressed 30-attempt budget rides out a 15-attempt
	// ("15s") outage — every re-attach socket dies until the host "returns",
	// and the turn settles via the replay, never through onError.
	test("awaiting turn rides out a 15s outage: settles via re-attach replay, not onError", async () => {
		// Budget alignment pin: cadence × cap >= the restart readiness budget.
		expect(REATTACH_RETRY_MS * REATTACH_MAX_ATTEMPTS).toBeGreaterThanOrEqual(30_000)
		// Compressed time: 20ms cadence keeps the 1s:1s ratio of the real
		// budget, so 15 failed attempts ≈ 15s of a 30s (30-attempt) budget.
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-b1"), reattachRetryMs: 20, reattachMaxAttempts: 30 })
		const { cb, log } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		const sock1 = h.lastSocket()
		sock1.item(snapshotFrame("sess-b1"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		sock1.item(eventFrame("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "go" }] }, 1))
		sock1.item(streamFrame({ type: "start", attemptId: "a1", revision: 0, startedAfterSeq: 1, turn: 1, step: 1 }))
		sock1.item(streamFrame({ type: "chunk", attemptId: "a1", revision: 0, index: 0, time: 1, chunk: { type: "text-delta", index: 0, text: "he" } }))
		expect(log.content.join("")).toBe("he")

		// The host goes down mid-turn (follow stream dies; the carrier keeps
		// its last-known "connected" state — the retry loop is what drives
		// the re-attach now).
		sock1.close()
		await until(() => h.session.label === "reconnecting…")

		// "15s outage": kill each re-attach socket until 15 attempts (the OLD
		// budget gave up at 10), then let the host come back on attempt 16.
		const outage = (async () => {
			for (let attempt = 1; attempt <= 15; attempt++) {
				await until(() => h.sockets.length > attempt)
				h.sockets[attempt]!.endStream()
			}
			await until(() => h.sockets.length > 16)
			h.lastSocket().item(snapshotFrame("sess-b1", {
				records: [eventFrame("assistant/message", { message: { content: [{ type: "text", text: "recovered answer" }] } }, 2)],
				assistantStream: {
					revision: 2,
					activeAttempt: {
						attemptId: "a1",
						startedAfterSeq: 1,
						turn: 1,
						step: 1,
						nextIndex: 2,
						stream: [{ type: "text-chunks", time0: 1, index: 0, dt: [1, 1], texts: ["he", "llo"] }],
					},
				},
			}))
		})()

		await outage
		// More sockets than the old budget allowed — the turn survived past it.
		expect(h.sockets.length).toBeGreaterThanOrEqual(17)
		// The turn settles via the replay: gap rows + compact stream, no error.
		// (missedRows paint inside attach; the label restores after the
		// reattach's gap repair completes — wait for BOTH.)
		await until(() => log.missedRows.length === 1 && h.session.label !== "reconnecting…")
		expect(log.missedRows[0]).toEqual([{ kind: "assistant", text: "recovered answer" }])
		expect(log.content.join("")).toBe("hello")
		expect(h.session.label).not.toBe("reconnecting…")

		h.lastSocket().item(streamFrame({ type: "chunk", attemptId: "a1", revision: 2, index: 2, time: 5, chunk: { type: "text-delta", index: 2, text: " world" } }))
		h.lastSocket().item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 3))
		await pending
		expect(log.content.join("")).toBe("hello world")
		expect(log.turnEnds.length).toBe(1)
		expect(log.errors).toEqual([])
		await h.session.dispose()
	})
})

// ---------------------------------------------------------------------------
// P1#1 — RemoteFollowSession replay baseline + announce dedupe
// ---------------------------------------------------------------------------

describe("RemoteFollowSession replay baseline", () => {
	test("snapshot records at/below sinceSeq skip the fold entirely (no row, no announce, no re-journal)", async () => {
		const { follow, sink, currentSocket } = await makeFollow()
		// Live pre-gap: one announced tool call + one journaled user row.
		follow.attach("s1", false)
		const sock1 = currentSocket()
		sock1.item(snapshotFrame("s1", { records: [eventFrame("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "painted" }] }, 1)] }))
		await until(() => sink.journal.length === 1)
		sock1.item(eventFrame("tool/call", { callId: "c1", name: "bash", arguments: "{}" }, 2))
		await until(() => sink.toolStarts.length === 1)
		follow.detach()

		// Re-attach with the painted baseline: records 1-2 are at/below it —
		// they go nowhere (ledgers already hold them from the live stream).
		const reopening = follow.attach("s1", true, 2)
		currentSocket().item(snapshotFrame("s1", {
			records: [
				eventFrame("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "painted" }] }, 1),
				eventFrame("tool/call", { callId: "c1", name: "bash", arguments: "{}" }, 2),
				eventFrame("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "new row" }] }, 3),
			],
		}))
		const opening = await reopening
		expect(opening.cursor).toBe(0)
		expect(sink.missedRows).toEqual([[{ kind: "user", text: "new row" }]])
		expect(sink.toolStarts.length).toBe(1)
		expect(sink.journal.map((e) => e.seq)).toEqual([1, 2, 3])
		await follow.reset()
	})

	test("belt-and-braces: a replayed tool/call above the baseline never re-announces an already-announced callId", async () => {
		const { follow, sink, currentSocket } = await makeFollow()
		follow.attach("s2", false)
		const sock1 = currentSocket()
		sock1.item(snapshotFrame("s2"))
		await until(() => sink.journal.length >= 0)
		sock1.item(eventFrame("tool/call", { callId: "c9", name: "bash", arguments: "{}" }, 5))
		await until(() => sink.toolStarts.length === 1)
		follow.detach()

		// Baseline misses the record (seq 5 > sinceSeq 0) — the announced-set
		// dedupe must still suppress the second onToolStart.
		const reopening = follow.attach("s2", true, 0)
		currentSocket().item(snapshotFrame("s2", { records: [eventFrame("tool/call", { callId: "c9", name: "bash", arguments: "{}" }, 5)] }))
		await reopening
		expect(sink.toolStarts.length).toBe(1)
		await follow.reset()
	})
})

/** A bare RemoteFollowSession over fresh fake mux sockets + a recording sink. */
async function makeFollow(): Promise<{ follow: RemoteFollowSession; sink: RecordingSink; currentSocket(): FakeMuxSocket }> {
	const sockets: FakeMuxSocket[] = []
	const sink = makeRecordingSink()
	const follow = new RemoteFollowSession({
		socketFactory: () => {
			const socket = new FakeMuxSocket()
			sockets.push(socket)
			return socket
		},
		sink,
		onDetached: () => {},
	})
	return { follow, sink, currentSocket: () => sockets[sockets.length - 1]! }
}

interface RecordingSink {
	content: string[]
	thinking: string[]
	usage: Record<string, number>[]
	toolStarts: { callId?: string; name: string; args: string }[]
	toolRuns: { name: string; ok: boolean }[]
	todos: { content: string; status: string }[][]
	turnEnds: Record<string, unknown>[]
	missedRows: { kind: string; text: string }[][]
	journal: { type: string; seq: number; time: number; data: Record<string, unknown> }[]
}

function makeRecordingSink(): RecordingSink {
	const sink: RecordingSink = {
		content: [],
		thinking: [],
		usage: [],
		toolStarts: [],
		toolRuns: [],
		todos: [],
		turnEnds: [],
		missedRows: [],
		journal: [],
	}
	// The object IS the RemoteFollowSink (methods bound below).
	const asSink = sink as unknown as RemoteFollowSink
	asSink.onContentDelta = (t) => sink.content.push(t)
	asSink.onThinkingDelta = (t) => sink.thinking.push(t)
	asSink.onUsage = (u) => sink.usage.push(u)
	asSink.onToolStart = (s) => sink.toolStarts.push(s)
	asSink.onToolRun = (r) => sink.toolRuns.push({ name: r.name, ok: r.ok })
	asSink.onTodos = (t) => sink.todos.push(t)
	asSink.onTurnEnd = (d) => sink.turnEnds.push(d)
	asSink.onMissedRows = (rows) => sink.missedRows.push(rows)
	asSink.onRecord = (entry) => sink.journal.push({ ...entry })
	return asSink
}

/** Drive the current socket's follow stream to a completed turn/end. */
function sockEndsTurn(sock: FakeMuxSocket): void {
	sock.item(streamFrame({ type: "end", attemptId: "a1", revision: 0, index: 1, outcome: { kind: "committed", eventType: "assistant/message", seq: 2 } }))
	sock.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 3))
}

// ---------------------------------------------------------------------------
// Batch 9b: turn-end finalization during a follow-stream gap
// ---------------------------------------------------------------------------

describe("RemoteHostSession batch-9b gap settlement", () => {
	test("stream death mid-turn settles the awaited turn from the reattach snapshot's turn/end", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-b9b") })
		const { cb, log } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		const sock = h.lastSocket()
		sock.item(snapshotFrame("sess-b9b"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		// Server-side drop mid-turn: no live turn/end on THIS socket, ever.
		sock.close()
		// The reattach opens a second socket; the host had already completed the
		// turn while the stream was blind, so the turn/end rides the snapshot
		// (seq above anything journaled live) as settled history.
		await until(() => h.sockets.length > 1)
		h.lastSocket().item(snapshotFrame("sess-b9b", {
			cursor: 5,
			records: [
				{ type: "event", event: { type: "turn/end", seq: 5, time: Date.now(), data: { turn: 1, reason: { kind: "completed" } } } },
			],
		}))
		// The awaited turn MUST settle (batch-9a defect: it hung forever here).
		await Promise.race([
			pending,
			new Promise((_, reject) => setTimeout(() => reject(new Error("turn await hung: reattach snapshot turn/end did not settle")), 3000)),
		])
		expect(log.turnEnds.length).toBe(1)
		await h.session.dispose()
	})

	test("a reattach whose snapshot holds no turn/end beyond the arm watermark leaves the turn pending (pre-turn history is not a settle)", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-b9b2"), reattachRetryMs: 20 })
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		const sock = h.lastSocket()
		// A live record journals seq 2 BEFORE the turn arms (turn 1's tail), so
		// the arm watermark is 2 and the snapshot's old turn/end (seq 2) must
		// NOT settle the new turn.
		sock.item(snapshotFrame("sess-b9b2"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		sock.item(eventFrame("assistant/message", { message: { content: [{ type: "text", text: "prev" }] } }, 2))
		sock.close()
		await until(() => h.sockets.length > 1)
		h.lastSocket().item(snapshotFrame("sess-b9b2", {
			cursor: 2,
			records: [
				{ type: "event", event: { type: "turn/end", seq: 2, time: Date.now(), data: { turn: 1, reason: { kind: "completed" } } } },
			],
		}))
		await new Promise((resolve) => setTimeout(resolve, 150))
		let settled = false
		void pending.then(() => { settled = true })
		await new Promise((resolve) => setTimeout(resolve, 150))
		expect(settled).toBe(false)
		await h.session.dispose()
	})
})

describe("RemoteHostSession context window", () => {
	test("switching to a window-less route clears the previous route's window (no stale denominator)", async () => {
		const catalog = {
			groups: [
				{ id: "prov-a", name: "Prov A", models: [{ id: "big", name: "Big", contextWindow: 200000 }] },
				{ id: "prov-b", name: "Prov B", models: [{ id: "tiny", name: "Tiny" }] },
			],
			failures: [],
		}
		let selection: { provider: string; model: string } = { provider: "prov-a", model: "big" }
		const h = makeSession({
			rpcHandler: (method) => {
				if (method === "session/create") return { sessionId: "sess-cw", agentPreset: "review" }
				if (method === "session/prompt") return { accepted: true }
				if (method === "session/projections") return { values: { modelSelection: { next: selection } } }
				if (method === "session/selectModel") return { selected: selection }
				if (method === "session/modelCatalog") return catalog
				return {}
			},
		})
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.session.currentSessionId() !== undefined)
		// Settle the follow attach (an empty snapshot) so dispose() below can
		// complete; the turn itself stays pending and is resolved by dispose.
		await until(() => h.sockets.length > 0)
		h.lastSocket().item(snapshotFrame("sess-cw"))

		// Route A resolves its disclosed window.
		await until(() => h.session.contextWindow() === 200000)
		// Switch to route B (a route commit reopens the per-turn projections
		// gate) whose catalog row names no contextWindow: the previous window
		// must clear, not linger as the footer's denominator.
		selection = { provider: "prov-b", model: "tiny" }
		await h.session.selectModel(selection)
		await until(() => h.session.contextWindow() === undefined)
		expect(h.session.sessionInfo().contextWindow).toBeUndefined()
		await h.session.dispose()
		await pending.catch(() => {})
	})
})

// ---------------------------------------------------------------------------
// 🧠 contextPressure projections (web workaround batch): the token-meter
// projection off `session/projections` is the PRIMARY used/window source —
// `projectedTokens ?? pressureTokens` over the meter estimate, the
// projection's window over the catalog's, estimate/bare shapes as fallbacks.
// ---------------------------------------------------------------------------

/** Drive one settled turn: create + follow attach + prompt + turn/end.
 * Waits are relative (new socket / new prompt RPC) so consecutive turns on
 * the same harness settle independently. */
async function settleTurn(h: { session: RemoteHostSession; sockets: FakeMuxSocket[]; lastSocket(): FakeMuxSocket; connection: FakeConnection }, sessionId: string, stream: Record<string, unknown>[] = []): Promise<void> {
	const { cb } = callbacks()
	const socketsBefore = h.sockets.length
	const promptsBefore = h.connection.rpcCalls.filter((c) => c.method === "session/prompt").length
	const pending = h.session.turn("go", cb)
	await until(() => h.sockets.length > socketsBefore)
	h.lastSocket().item(snapshotFrame(sessionId))
	await until(() => h.connection.rpcCalls.filter((c) => c.method === "session/prompt").length > promptsBefore)
	const sock = h.lastSocket()
	sock.item(streamFrame({ type: "start", attemptId: "a1", revision: 0, startedAfterSeq: 0, turn: 1, step: 1 }))
	for (const frame of stream) sock.item(frame)
	sock.item(streamFrame({ type: "end", attemptId: "a1", revision: 0, index: stream.length, outcome: { kind: "committed", eventType: "assistant/message", seq: 2 } }))
	sock.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
	await pending
}

describe("RemoteHostSession contextPressure projections", () => {
	test("projectedTokens is the used numerator and the projection window the denominator (wire shape {request:{sessionId}})", async () => {
		let projectionsArgs: Record<string, unknown> | undefined
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "session/create") return { sessionId: "sess-ctx1" }
				if (method === "session/prompt") return { accepted: true }
				if (method === "session/projections") {
					projectionsArgs = args
					return { values: { contextPressure: { contextWindow: 128000, projectedTokens: 45000, pressureTokens: 42000 } } }
				}
				return {}
			},
		})
		await settleTurn(h, "sess-ctx1")
		// the unary projections query rides the shared transport, sessionId wrapped
		expect(projectionsArgs).toEqual({ request: { sessionId: "sess-ctx1" } })
		// web contextOccupancy: projectedTokens ?? pressureTokens
		await until(() => h.session.contextTokens() === 45000)
		await until(() => h.session.contextWindow() === 128000)
		expect(h.session.sessionInfo().contextTokens).toBe(45000)
		expect(h.session.sessionInfo().contextWindow).toBe(128000)
		await h.session.dispose()
	})

	test("pressureTokens is the second-priority numerator when no projection exists yet", async () => {
		const h = makeSession({
			rpcHandler: (method) => {
				if (method === "session/create") return { sessionId: "sess-ctx2" }
				if (method === "session/prompt") return { accepted: true }
				if (method === "session/projections") {
					return { values: { contextPressure: { pressureTokens: 42000, contextWindow: 128000 } } }
				}
				return {}
			},
		})
		await settleTurn(h, "sess-ctx2")
		await until(() => h.session.contextTokens() === 42000)
		await h.session.dispose()
	})

	test("no projection (fresh session before its first request) falls back to the meter estimate and the bare shape", async () => {
		const h = makeSession({
			rpcHandler: (method) => {
				if (method === "session/create") return { sessionId: "sess-ctx3" }
				if (method === "session/prompt") return { accepted: true }
				if (method === "session/projections") return { values: {} }
				return {}
			},
		})
		// text-delta "ok" then usage {50, 4}: the meter ends at billed 50 +
		// output 4 + pending 0 = 54 (the projection never lands over it).
		await settleTurn(h, "sess-ctx3", [
			streamFrame({ type: "chunk", attemptId: "a1", revision: 0, index: 0, time: 1, chunk: { type: "text-delta", index: 0, text: "ok" } }),
			streamFrame({ type: "chunk", attemptId: "a1", revision: 0, index: 1, time: 2, chunk: { type: "usage", usage: { inputTokens: 50, outputTokens: 4 } } }),
		])
		await until(() => rpcOf(h.connection, "session/projections") !== undefined)
		expect(h.session.contextTokens()).toBe(54)
		// no window anywhere → the footer's bare `🧠 used` degrade
		expect(h.session.contextWindow()).toBeUndefined()
		expect(h.session.sessionInfo().contextTokens).toBe(54)
		expect(h.session.sessionInfo().contextWindow).toBeUndefined()
		await h.session.dispose()
	})

	test("the projection window outranks the catalog window (catalog stays double-insurance)", async () => {
		const catalog = {
			groups: [{ id: "prov-a", name: "Prov A", models: [{ id: "big", name: "Big", contextWindow: 200000 }] }],
			failures: [],
		}
		const h = makeSession({
			rpcHandler: (method) => {
				if (method === "session/create") return { sessionId: "sess-ctx4" }
				if (method === "session/prompt") return { accepted: true }
				if (method === "session/projections") {
					return {
						values: {
							modelSelection: { next: { provider: "prov-a", model: "big" } },
							contextPressure: { contextWindow: 128000, pressureTokens: 1000 },
						},
					}
				}
				if (method === "session/modelCatalog") return catalog
				return {}
			},
		})
		await settleTurn(h, "sess-ctx4")
		await until(() => h.session.contextWindow() === 128000)
		expect(h.session.contextTokens()).toBe(1000)
		await h.session.dispose()
	})

	test("a new session drops the previous session's pressure row (estimate until its own projection lands)", async () => {
		let pressure: Record<string, unknown> | undefined = { contextWindow: 128000, projectedTokens: 45000, pressureTokens: 42000 }
		let creates = 0
		const h = makeSession({
			rpcHandler: (method) => {
				if (method === "session/create") {
					creates++
					return { sessionId: creates === 1 ? "sess-ctx5a" : "sess-ctx5b" }
				}
				if (method === "session/prompt") return { accepted: true }
				if (method === "session/projections") return { values: pressure === undefined ? {} : { contextPressure: pressure } }
				return {}
			},
		})
		await settleTurn(h, "sess-ctx5a")
		await until(() => h.session.contextTokens() === 45000)
		// /new: the tag check + resetLedger drop session A's row synchronously —
		// the read falls back to the meter estimate (0 on the fresh session).
		h.session.newSession()
		pressure = undefined
		expect(h.session.contextTokens()).not.toBe(45000)
		// turn 2 settles on the fresh session; its empty projection keeps the
		// estimate numerator (billed 10 + output 2 — never session A's 45000).
		await settleTurn(h, "sess-ctx5b", [
			streamFrame({ type: "chunk", attemptId: "a1", revision: 0, index: 0, time: 1, chunk: { type: "usage", usage: { inputTokens: 10, outputTokens: 2 } } }),
		])
		expect(h.session.contextTokens()).toBe(12)
		await h.session.dispose()
	})

	test("getter reads (used and window) share one projections RPC per turn", async () => {
		let calls = 0
		const h = makeSession({
			rpcHandler: (method) => {
				if (method === "session/create") return { sessionId: "sess-ctx6" }
				if (method === "session/prompt") return { accepted: true }
				if (method === "session/projections") {
					calls++
					return { values: { contextPressure: { contextWindow: 128000, projectedTokens: 45000, pressureTokens: 42000 } } }
				}
				return {}
			},
		})
		await settleTurn(h, "sess-ctx6")
		await until(() => h.session.contextTokens() === 45000)
		const settled = calls
		// Repaint cadence inside the turn: both getters answer from the turn's
		// cached row — the gate lives in #refreshContextPressure, so the window
		// path is covered too (C1: no per-read RPC from contextWindow()).
		for (let i = 0; i < 5; i++) {
			h.session.contextTokens()
			h.session.contextWindow()
		}
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(calls).toBe(settled)
		expect(h.session.contextWindow()).toBe(128000)
		await h.session.dispose()
	})
})
