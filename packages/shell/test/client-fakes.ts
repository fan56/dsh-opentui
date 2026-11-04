// Shared fakes for the client-mode tests: a minimal ClientConnection
// stand-in (scripted RPC results + $events emit), a minimal `ws` stand-in
// with the MuxSocket surface the pumps drive, and the wire-frame builders
// the session/follow streams speak.
import type { ClientConnection, ClientConnectionState, ClientEventDisposer, ClientEventHandler, ClientReadyInfo } from "../src/client/transport.ts"
import type { EventsItem } from "../src/client/mux-frame.ts"
import type { MuxSocket } from "../src/client/events-source.ts"

export type RpcHandler = (method: string, args: Record<string, unknown>) => unknown | Promise<unknown>

/** Minimal ClientConnection stand-in (the frozen P1 surface subset). */
export class FakeConnection {
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

	emitEvent(event: string, ...args: unknown[]): void {
		this.emit({ type: "emit", event, args } as EventsItem)
	}

	setState(state: ClientConnectionState): void {
		this.#state = state
		for (const listener of [...this.#stateListeners]) listener(state)
	}

	get listenerCounts(): { events: number; states: number } {
		return { events: this.#eventHandlers.size, states: this.#stateListeners.size }
	}
}

/** Minimal `ws` stand-in with the MuxSocket surface the pumps drive. */
export class FakeMuxSocket implements MuxSocket {
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

export function snapshotFrame(sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
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

export function eventFrame(type: string, data: unknown, seq = 1): Record<string, unknown> {
	return { type: "event", event: { type, seq, time: Date.now(), data } }
}

export function streamFrame(frame: Record<string, unknown>): Record<string, unknown> {
	return { type: "assistant-stream", frame }
}

/** Poll until `fn()` is true (the waterfall answering paths are async). */
export async function until(fn: () => boolean, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (!fn()) {
		if (Date.now() > deadline) throw new Error("until() timed out")
		await new Promise((r) => setTimeout(r, 5))
	}
}

export function rpcOf(connection: FakeConnection, method: string): Record<string, unknown> | undefined {
	return connection.rpcCalls.find((c) => c.method === method)?.args
}
