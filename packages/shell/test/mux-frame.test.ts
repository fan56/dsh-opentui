// Mux frame parser + `$events` pump gating tests.
//
// The parser mirrors dsh-api-gateway's stream-protocol validation; the pump
// tests drive the real `createEventsPumpSource` with a fake socket and assert
// the generation gate: ready-only-after-valid-ready-frame, open-frame shape,
// malformed items invalidating the generation, and end/error handling.
import { describe, expect, test } from "bun:test"

import {
	createEventsPumpSource,
	EventsStreamEndedError,
	EventsStreamRemoteError,
	type MuxSocket,
} from "../src/client/events-source.ts"
import {
	openEventsStreamFrame,
	parseEventsItem,
	parseEventsReady,
	parseMuxFrame,
	type MuxServerFrame,
} from "../src/client/mux-frame.ts"

const READY = { type: "ready", clientId: "client-1", host: { home: "/Users/tester" } }
const STREAM_ID = "s-1"

/** One macrotask: drains every pending microtask (the pump's async chain) first. */
function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

/** EventEmitter-style socket fake with manual event delivery. */
class FakeMuxSocket implements MuxSocket {
	readyState = 0
	sent: string[] = []
	closed = false
	/** 'error' emissions that found NO listener attached — the real `ws`
	 * socket surfaces those as uncaught exceptions. */
	readonly uncaughtErrors: unknown[] = []
	private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

	on(event: string, listener: (...args: unknown[]) => void): this {
		this.register(event, listener)
		return this
	}

	once(event: string, listener: (...args: unknown[]) => void): this {
		const wrapped = (...args: unknown[]) => {
			this.removeListener(event, listener)
			listener(...args)
		}
		// Node EventEmitter parity: the wrapper remembers its original, so
		// removeListener(original) removes the wrapper too
		;(wrapped as { listener?: unknown }).listener = listener
		this.register(event, wrapped)
		return this
	}

	removeListener(event: string, listener: (...args: unknown[]) => void): this {
		const set = this.listeners.get(event)
		if (!set) return this
		if (set.delete(listener)) return this
		for (const wrapped of set) {
			if ((wrapped as { listener?: unknown }).listener === listener) {
				set.delete(wrapped)
				break
			}
		}
		return this
	}

	send(data: string): void {
		this.sent.push(data)
	}

	close(): void {
		const wasConnecting = this.readyState === 0
		this.closed = true
		this.readyState = 3
		if (wasConnecting) {
			// `ws` parity: closing a CONNECTING socket reports "closed before
			// established" ASYNCHRONOUSLY, after close() has returned
			setTimeout(() => this.emit("error", new Error("WebSocket was closed before the connection was established")), 0)
		}
	}

	open(): void {
		this.readyState = 1
		this.emit("open")
	}

	/** Simulate the server refusing the upgrade (ws's unexpected-response). */
	rejectUpgrade(status: number): void {
		this.readyState = 3
		this.emit("unexpected-response", {}, { statusCode: status })
	}

	message(frame: unknown): void {
		this.emit("message", typeof frame === "string" ? frame : JSON.stringify(frame))
	}

	fail(error: Error): void {
		this.emit("error", error)
	}

	shutdown(): void {
		this.readyState = 3
		this.emit("close")
	}

	listenerCount(event: string): number {
		return this.listeners.get(event)?.size ?? 0
	}

	private register(event: string, listener: (...args: unknown[]) => void): void {
		const set = this.listeners.get(event) ?? new Set()
		set.add(listener)
		this.listeners.set(event, set)
	}

	private emit(event: string, ...args: unknown[]): void {
		const listeners = [...(this.listeners.get(event) ?? [])]
		if (event === "error" && listeners.length === 0) this.uncaughtErrors.push(args[0])
		for (const listener of listeners) listener(...args)
	}
}

interface PumpHarness {
	socket: FakeMuxSocket
	done: Promise<void>
	readyHosts: unknown[]
	items: unknown[]
	controller: AbortController
}

/** Start one pump attempt; the promise rejects on generation loss. */
function startPump(): PumpHarness {
	const socket = new FakeMuxSocket()
	const readyHosts: unknown[] = []
	const items: unknown[] = []
	const controller = new AbortController()
	const source = createEventsPumpSource(() => socket, {
		onReady: (info) => readyHosts.push(info),
		onItem: (item) => items.push(item),
	})
	const done = source(controller.signal, (host) => readyHosts.push(host)).catch((error: unknown) => {
		if (controller.signal.aborted) return undefined
		throw error
	})
	return { socket, done, readyHosts, items, controller }
}

async function expectRejection(promise: Promise<void>): Promise<unknown> {
	try {
		await promise
	} catch (error) {
		return error
	}
	throw new Error("expected the pump generation to fail")
}

describe("parseMuxFrame", () => {
	test("parses item, value-less item, end, and error frames", () => {
		expect(parseMuxFrame(JSON.stringify({ type: "item", streamId: STREAM_ID, value: { a: 1 } }))).toEqual({
			type: "item",
			streamId: STREAM_ID,
			value: { a: 1 },
		})
		expect(parseMuxFrame(JSON.stringify({ type: "item", streamId: STREAM_ID }))).toEqual({
			type: "item",
			streamId: STREAM_ID,
			value: undefined,
		})
		expect(parseMuxFrame(JSON.stringify({ type: "end", streamId: STREAM_ID }))).toEqual({ type: "end", streamId: STREAM_ID })
		const error = parseMuxFrame(JSON.stringify({ type: "error", streamId: STREAM_ID, error: { code: "c", message: "m", details: {} } }))
		expect(error).toEqual({ type: "error", streamId: STREAM_ID, error: { code: "c", message: "m", details: {} } })
	})

	test("rejects malformed frames", () => {
		for (const text of [
			"not json",
			"[]",
			JSON.stringify({ type: "item" }), // missing streamId
			JSON.stringify({ type: "item", streamId: "" }),
			JSON.stringify({ type: "item", streamId: STREAM_ID, extra: 1, value: null }), // extra key
			JSON.stringify({ type: "end", streamId: STREAM_ID, extra: 1 }),
			JSON.stringify({ type: "error", streamId: STREAM_ID }), // missing error
			JSON.stringify({ type: "error", streamId: STREAM_ID, error: { code: "c", message: "m" } }), // missing details
			JSON.stringify({ type: "error", streamId: STREAM_ID, error: { code: "c", message: 5, details: {} } }),
			JSON.stringify({ type: "bogus", streamId: STREAM_ID }),
		]) {
			expect(() => parseMuxFrame(text), text).toThrow()
		}
	})
})

describe("parseEventsReady (generation gate)", () => {
	test("accepts the exact ready shape", () => {
		expect(parseEventsReady(READY)).toEqual(READY)
	})

	test("rejects non-ready opening items and malformed hosts", () => {
		for (const value of [
			{ type: "emit", event: "x", args: [] }, // events before ready
			{ type: "ready", clientId: "c" }, // missing host
			{ type: "ready", clientId: "c", host: { home: 1 } },
			{ type: "ready", clientId: "", host: { home: "/" } },
			{ type: "ready", clientId: "c", host: { home: "/", extra: 1 } },
			{ type: "ready", clientId: "c", host: { home: "/", }, extra: 1 },
			null,
			"ready",
		]) {
			expect(() => parseEventsReady(value), JSON.stringify(value)).toThrow()
		}
	})
})

describe("parseEventsItem", () => {
	test("accepts emit, waterfall, and cancel items", () => {
		expect(parseEventsItem({ type: "emit", event: "api-session/status", args: [{}, true] })).toEqual({
			type: "emit",
			event: "api-session/status",
			args: [{}, true],
		})
		expect(
			parseEventsItem({
				type: "waterfall",
				event: "approval/request",
				eventId: "e-1",
				agentId: "agent-1",
				request: { requestId: "r-1", payload: { kind: "bash" } },
			}),
		).toMatchObject({ type: "waterfall", eventId: "e-1" })
		expect(parseEventsItem({ type: "cancel", eventId: "e-1" })).toEqual({ type: "cancel", eventId: "e-1" })
	})

	test("rejects malformed items (gateway parity)", () => {
		for (const value of [
			{ type: "emit", event: "x" }, // missing args
			{ type: "emit", event: "", args: [] },
			{ type: "waterfall", event: "x", eventId: "e", agentId: "a", request: { agent: {} } }, // reserved key
			{ type: "waterfall", event: "x", eventId: "e", agentId: "a", request: { signal: 1 } }, // reserved key
			{ type: "waterfall", event: "x", eventId: "", agentId: "a", request: {} },
			{ type: "cancel", eventId: "" },
			{ type: "snapshot", data: 1 }, // unknown type
			42,
			"emit",
		]) {
			expect(() => parseEventsItem(value), JSON.stringify(value)).toThrow()
		}
	})
})

describe("openEventsStreamFrame", () => {
	test("matches the documented open payload", () => {
		expect(openEventsStreamFrame("abc")).toEqual({ type: "open", streamId: "abc", endpoint: "$events", payload: { args: {} } })
	})
})

describe("events pump (ready gating over a fake socket)", () => {
	test("opens the $events stream with the documented open frame and gates on the ready item", async () => {
		const { socket, done, readyHosts, items, controller } = startPump()
		socket.open()
		await tick()
		expect(socket.sent).toHaveLength(1)
		const openFrame = JSON.parse(socket.sent[0]!) as {
			type: string
			streamId: string
			endpoint: string
			payload: { args: Record<string, never> }
		}
		expect(openFrame.type).toBe("open")
		expect(openFrame.endpoint).toBe("$events")
		expect(openFrame.payload).toEqual({ args: {} })
		expect(typeof openFrame.streamId).toBe("string")

		socket.message({ type: "item", streamId: openFrame.streamId, value: READY })
		await tick()
		// onReady receives the validated opening frame; ready() publishes the host facts
		expect(readyHosts).toEqual([READY, { home: "/Users/tester" }])

		// after ready, items flow to the consumer in order
		socket.message({ type: "item", streamId: openFrame.streamId, value: { type: "emit", event: "commands/change", args: [] } })
		socket.message({ type: "item", streamId: openFrame.streamId, value: { type: "cancel", eventId: "e-1" } })
		await tick()
		expect(items).toHaveLength(2)
		expect(items[0]).toMatchObject({ type: "emit", event: "commands/change" })
		expect(items[1]).toMatchObject({ type: "cancel", eventId: "e-1" })

		controller.abort()
		await done
	})

	test("a non-ready opening item refuses readiness and invalidates the attempt", async () => {
		const { socket, done, readyHosts } = startPump()
		socket.open()
		await tick()
		const streamId = (JSON.parse(socket.sent[0]!) as { streamId: string }).streamId
		socket.message({ type: "item", streamId, value: { type: "emit", event: "x", args: [] } })
		const error = await expectRejection(done)
		expect((error as Error).name).toBe("MuxFrameError")
		expect(readyHosts).toHaveLength(0)
	})

	test("malformed item invalidates the generation", async () => {
		const { socket, done, readyHosts } = startPump()
		socket.open()
		await tick()
		const streamId = (JSON.parse(socket.sent[0]!) as { streamId: string }).streamId
		socket.message({ type: "item", streamId, value: READY })
		await tick()
		expect(readyHosts).toHaveLength(2)
		socket.message({ type: "item", streamId, value: { type: "bogus", x: 1 } })
		const error = await expectRejection(done)
		expect((error as Error).name).toBe("MuxFrameError")
	})

	test("end frame after ready throws EventsStreamEndedError", async () => {
		const { socket, done, readyHosts } = startPump()
		socket.open()
		await tick()
		const streamId = (JSON.parse(socket.sent[0]!) as { streamId: string }).streamId
		socket.message({ type: "item", streamId, value: READY })
		await tick()
		expect(readyHosts).toHaveLength(2)
		socket.message({ type: "end", streamId })
		const error = await expectRejection(done)
		expect(error).toBeInstanceOf(EventsStreamEndedError)
	})

	test("error frame surfaces code and message", async () => {
		const { socket, done } = startPump()
		socket.open()
		await tick()
		const streamId = (JSON.parse(socket.sent[0]!) as { streamId: string }).streamId
		socket.message({ type: "item", streamId, value: READY })
		socket.message({ type: "error", streamId, error: { code: "gateway/internal", message: "boom", details: {} } })
		const error = await expectRejection(done) as EventsStreamRemoteError
		expect(error).toBeInstanceOf(EventsStreamRemoteError)
		expect(error.code).toBe("gateway/internal")
		expect(error.message).toContain("boom")
	})

	test("socket close before ready fails the attempt", async () => {
		const { socket, done, readyHosts } = startPump()
		socket.open()
		await tick()
		socket.shutdown()
		await expectRejection(done)
		expect(readyHosts).toHaveLength(0)
	})

	test("socket error before ready fails the attempt", async () => {
		const { socket, done } = startPump()
		socket.open()
		await tick()
		socket.fail(new Error("ECONNREFUSED"))
		await expectRejection(done)
	})

	test("rejected upgrade reports the HTTP status", async () => {
		const { socket, done } = startPump()
		socket.rejectUpgrade(401)
		const error = await expectRejection(done)
		expect((error as Error).message).toContain("401")
	})

	test("abort during open settles the attempt and closes the socket", async () => {
		const socket = new FakeMuxSocket()
		const controller = new AbortController()
		const source = createEventsPumpSource(() => socket, { onReady: () => {}, onItem: () => {} })
		const done = source(controller.signal, () => {})
		controller.abort()
		await expectRejection(done)
		expect(socket.closed).toBe(true)
	})

	test("abort after ready ends the generation and closes the socket", async () => {
		const socket = new FakeMuxSocket()
		const controller = new AbortController()
		const items: MuxServerFrame[] = []
		const source = createEventsPumpSource(() => socket, { onReady: () => {}, onItem: (item) => items.push(item as MuxServerFrame) })
		const done = source(controller.signal, () => {})
		socket.open()
		await tick()
		const streamId = (JSON.parse(socket.sent[0]!) as { streamId: string }).streamId
		socket.message({ type: "item", streamId, value: READY })
		controller.abort()
		await expectRejection(done)
		expect(socket.closed).toBe(true)
	})

	test("CONNECTING-socket close emits its async error AFTER listener cleanup — guarded, never uncaught", async () => {
		const socket = new FakeMuxSocket()
		const controller = new AbortController()
		const source = createEventsPumpSource(() => socket, { onReady: () => {}, onItem: () => {} })
		const done = source(controller.signal, () => {})
		// abort while CONNECTING: the pump's finally removes the pump
		// listeners and closes the socket, and only THEN does the socket's
		// async "closed before established" error fire (the remote-stream.ts
		// race, mirrored by the fake's CONNECTING-close behavior)
		controller.abort()
		await expectRejection(done)
		expect(socket.closed).toBe(true)
		// the cleanup removed the pump listeners; exactly the noop guard remains
		expect(socket.listenerCount("error")).toBe(1)
		await tick()
		await tick()
		// the async close-error landed on the noop guard — no uncaught surface
		expect(socket.uncaughtErrors).toHaveLength(0)
		// and a late manual error after settlement is swallowed the same way
		socket.fail(new Error("late close noise"))
		expect(socket.uncaughtErrors).toHaveLength(0)
	})
})
