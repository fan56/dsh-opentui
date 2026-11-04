/**
 * The `$events` generation source for the client-mode transport.
 *
 * This is the proven minimal mux pump recipe (spike A, `/tmp/spike-sdk/
 * client-spike.mjs`): one `/api/remote.mux` WebSocket carrying the API cookie
 * on the upgrade, one `{type:'open', endpoint:'$events'}` logical stream, and
 * the opening `{type:'ready', clientId, host}` item published as the
 * connection generation. It is deliberately isolated behind a one-function
 * interface (`ConnectionGenerationSource`, the shape
 * `dsh-client-connection`'s `registerGenerationSource` takes) so the source
 * can be swapped later — e.g. for `dsh-api-gateway/client`'s native
 * ClientRemoteEvents pump, which a probe verified mounts cleanly under bun
 * with a stub `typert` service. The pump stays the default because it hands
 * EVERY `$events` frame (including forwarded waterfalls) to the consumer,
 * while the gateway-native source intercepts waterfall frames and answers
 * them itself, which v1's TUI must do in-process instead.
 *
 * Lifecycle contract (mirrors dsh-client-connection): the source reports
 * `ready` only after the validated ready frame; stream end, remote error, a
 * non-ready opening item, or a malformed frame/settlement throws, which
 * invalidates the generation and lets the ConnectionController reconnect
 * (500ms → 10s caps, 50–100% jitter).
 */

import { type ConnectionGenerationSource, type ConnectionHostInfo } from "@deepseek-ai/dsh-client-connection/client"
import {
	type EventsItem,
	type MuxServerFrame,
	MuxFrameError,
	openEventsStreamFrame,
	parseEventsItem,
	parseEventsReady,
	parseMuxFrame,
	type RemoteErrorFields,
} from "./mux-frame.ts"

/** EventEmitter-style subset of the `ws` socket the pump drives. */
export interface MuxSocket {
	readonly readyState: number
	send(data: string): void
	close(code?: number, reason?: string): void
	on(event: string, listener: (...args: unknown[]) => void): unknown
	once(event: string, listener: (...args: unknown[]) => void): unknown
	removeListener(event: string, listener: (...args: unknown[]) => void): unknown
}

/** The mux socket factory: must attach the API cookie on the upgrade. */
export type MuxSocketFactory = (path: string) => MuxSocket

/** The exact mux path carrying every Typert Remote stream. */
export const REMOTE_STREAM_MUX_PATH = "/api/remote.mux"

export interface EventsPumpCallbacks {
	/** Called once per generation with the validated opening ready frame. */
	onReady(info: { clientId: string; host: ConnectionHostInfo }): void
	/** Called for every validated `$events` item after the opening frame. */
	onItem(item: EventsItem): void
}

/** The `$events` logical stream ended without an error frame (host went away). */
export class EventsStreamEndedError extends Error {
	constructor() {
		super("$events stream ended")
		this.name = "EventsStreamEndedError"
	}
}

/** The host sent an `error` frame on the `$events` stream. */
export class EventsStreamRemoteError extends Error {
	readonly code: string
	readonly details: Readonly<Record<string, unknown>>

	constructor(error: RemoteErrorFields) {
		super(`$events stream error ${error.code}: ${error.message}`)
		this.name = "EventsStreamRemoteError"
		this.code = error.code
		this.details = error.details
	}
}

/**
 * Build the generation source: open the authenticated mux WebSocket, open the
 * `$events` logical stream, gate readiness on the validated ready item, and
 * forward every later item to the consumer. The returned promise settles only
 * when the generation ends (signal abort, socket loss, end/error frame, or
 * protocol violation).
 */
export function createEventsPumpSource(
	openWebSocket: MuxSocketFactory,
	callbacks: EventsPumpCallbacks,
): ConnectionGenerationSource {
	return async (signal, ready) => {
		const ws = openWebSocket(REMOTE_STREAM_MUX_PATH)
		const inbox = new FrameInbox()
		const onMessage = (data: unknown) => {
			try {
				inbox.push(parseMuxFrame(String(data)))
			} catch (error) {
				inbox.fail(toError(error))
			}
		}
		const onClose = () => inbox.fail(new Error("mux socket closed"))
		const onError = (raw: unknown) => inbox.fail(toError(raw))
		const onAbort = () => inbox.fail(new Error("events generation aborted"))
		ws.on("message", onMessage)
		ws.on("close", onClose)
		ws.on("error", onError)
		signal.addEventListener("abort", onAbort, { once: true })
		try {
			await awaitSocketOpen(ws, signal)
			if (signal.aborted) throw new Error("events generation aborted")
			ws.send(JSON.stringify(openEventsStreamFrame(crypto.randomUUID())))
			const first = await inbox.next()
			if (first.type !== "item") {
				throw new MuxFrameError(`$events stream produced a ${first.type} frame before its ready item`)
			}
			const opening = parseEventsReady(first.value)
			callbacks.onReady(opening)
			ready({ home: opening.host.home })
			while (true) {
				if (signal.aborted) throw new Error("events generation aborted")
				const frame = await inbox.next()
				if (frame.type === "end") throw new EventsStreamEndedError()
				if (frame.type === "error") throw new EventsStreamRemoteError(frame.error)
				callbacks.onItem(parseEventsItem(frame.value))
			}
		} finally {
			signal.removeEventListener("abort", onAbort)
			ws.removeListener("message", onMessage)
			ws.removeListener("close", onClose)
			ws.removeListener("error", onError)
			closeQuietly(ws)
			// Closing a still-CONNECTING socket makes `ws` emit 'error' ("closed
			// before established") asynchronously, after the removals above
			// cleaned the pump listeners — keep a noop handler attached so it can
			// never surface as an uncaught exception (remote-stream.ts fixed the
			// identical race the same way).
			ws.on("error", () => {})
		}
	}
}

/** Resolve when the socket reaches OPEN; reject on error / rejected upgrade / abort. */
function awaitSocketOpen(ws: MuxSocket, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (ws.readyState === 1) return resolve()
		const onOpen = () => {
			cleanup()
			resolve()
		}
		const onError = (raw: unknown) => {
			cleanup()
			reject(toError(raw))
		}
		const onUnexpectedResponse = (...args: unknown[]) => {
			cleanup()
			const response = args[1] as { statusCode?: number } | undefined
			reject(new Error(`mux upgrade rejected: HTTP ${String(response?.statusCode ?? "?")}`))
		}
		const onAbort = () => {
			cleanup()
			reject(new Error("events generation aborted during socket open"))
		}
		const cleanup = () => {
			ws.removeListener("open", onOpen)
			ws.removeListener("error", onError)
			ws.removeListener("unexpected-response", onUnexpectedResponse)
			signal.removeEventListener("abort", onAbort)
		}
		ws.once("open", onOpen)
		ws.once("error", onError)
		ws.once("unexpected-response", onUnexpectedResponse)
		signal.addEventListener("abort", onAbort, { once: true })
	})
}

function closeQuietly(ws: MuxSocket): void {
	try {
		if (ws.readyState < 2) ws.close()
	} catch {
		// a socket that refuses close() is already dead; the pump's failure path handles it
	}
}

function toError(raw: unknown): Error {
	return raw instanceof Error ? raw : new Error(String(raw))
}

/** Ordered frame queue with a terminal failure, mirroring the gateway StreamInbox. */
class FrameInbox {
	private queue: MuxServerFrame[] = []
	private failure: Error | undefined
	private wake: (() => void) | undefined

	push(frame: MuxServerFrame): void {
		if (this.failure) return
		this.queue.push(frame)
		const wake = this.wake
		this.wake = undefined
		wake?.()
	}

	fail(error: Error): void {
		if (!this.failure) {
			this.failure = error
			this.queue.length = 0
		}
		const wake = this.wake
		this.wake = undefined
		wake?.()
	}

	async next(): Promise<MuxServerFrame> {
		while (this.queue.length === 0) {
			if (this.failure) throw this.failure
			await new Promise<void>((wake) => {
				this.wake = wake
			})
		}
		if (this.queue.length === 0) throw this.failure!
		return this.queue.shift()!
	}
}
