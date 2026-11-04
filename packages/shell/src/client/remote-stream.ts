/**
 * One logical Remote stream on the host mux WebSocket (`/api/remote.mux`).
 *
 * The Typert gateway carries every STREAM Remote method (`session/follow`,
 * `session/control`, …) as a logical stream on the mux WebSocket: the client
 * sends one `{type:'open', streamId, endpoint, payload:{args}}` frame and the
 * host answers with `item` frames (one validated JSON value each) until an
 * `end` frame, or an `error` frame carrying the Remote failure envelope. A
 * stream Remote method CANNOT ride the unary HTTP `POST /api` carrier (the
 * gateway refuses it: "stream Remote methods must be opened through the
 * stream carrier"), and P1's `ClientConnection` deliberately exposes only
 * `rpc` + `$events` — so this module is the session layer's own minimal mux
 * client, reusing the exact frame grammar of `mux-frame.ts` and the same
 * `MuxSocket` shape as `events-source.ts` (which drives the `$events`
 * logical stream on a separate socket the same way).
 *
 * One socket per logical stream: the mux multiplexes by `streamId`, and this
 * client filters frames to its own id, so sharing a socket is a future
 * optimization, not a requirement.
 */

import { parseMuxFrame, type RemoteErrorFields } from "./mux-frame.ts"
import type { MuxSocket, MuxSocketFactory } from "./events-source.ts"

/** The exact mux path carrying every Typert Remote stream (gateway parity). */
export const REMOTE_STREAM_MUX_PATH = "/api/remote.mux"

/** The host answered a logical stream with a Remote failure envelope. */
export class RemoteStreamFailedError extends Error {
	readonly code: string
	readonly details: Readonly<Record<string, unknown>>

	constructor(error: RemoteErrorFields) {
		super(`remote stream ${error.code}: ${error.message}`)
		this.name = "RemoteStreamFailedError"
		this.code = error.code
		this.details = error.details
	}
}

/** The stream ended (or its socket died) before/after delivering items. */
export class RemoteStreamEndedError extends Error {
	constructor(message = "remote stream ended") {
		super(message)
		this.name = "RemoteStreamEndedError"
	}
}

/**
 * Handlers for one opened logical stream. All callbacks fire synchronously
 * from the socket pump; a throwing handler is contained (logged, never
 * tearing down the socket).
 */
export interface RemoteStreamHandlers {
	/** One item value delivered by the host on this stream. */
	onItem(value: unknown): void
	/** The host closed the stream deliberately (protocol `end` frame). */
	onEnd(): void
	/** The stream failed: Remote error frame, socket loss, or protocol violation. */
	onFailed(error: Error): void
}

/** One open logical stream; `close()` releases the socket. */
export interface RemoteStreamHandle {
	readonly streamId: string
	close(): void
}

/**
 * Open one logical stream on a fresh authenticated mux WebSocket and pump its
 * frames to `handlers`. Returns immediately; stream-level failures (including
 * "the host refused the open") surface through `handlers.onFailed`.
 */
export function openRemoteStream(
	socketFactory: MuxSocketFactory,
	endpoint: string,
	args: Record<string, unknown>,
	handlers: RemoteStreamHandlers,
): RemoteStreamHandle {
	const streamId = crypto.randomUUID()
	const ws = socketFactory(REMOTE_STREAM_MUX_PATH)
	let finished = false
	let openSent = false

	const finish = () => {
		if (finished) return
		finished = true
		cleanup()
		closeQuietly(ws)
	}

	const fail = (error: Error) => {
		if (finished) return
		finished = true
		cleanup()
		closeQuietly(ws)
		safe(() => handlers.onFailed(error))
	}

	const onMessage = (data: unknown) => {
		let frame
		try {
			frame = parseMuxFrame(String(data))
		} catch (error) {
			fail(toError(error))
			return
		}
		if (frame.streamId !== streamId) return
		if (frame.type === "item") {
			safe(() => handlers.onItem(frame.value))
		} else if (frame.type === "end") {
			finish()
			safe(() => handlers.onEnd())
		} else {
			fail(new RemoteStreamFailedError(frame.error))
		}
	}

	const onClose = () => fail(new RemoteStreamEndedError("mux socket closed"))
	const onError = (raw: unknown) => fail(toError(raw))
	const onOpen = () => {
		if (finished || openSent) return
		openSent = true
		try {
			ws.send(JSON.stringify({ type: "open", streamId, endpoint, payload: { args } }))
		} catch (error) {
			fail(toError(error))
		}
	}

	const cleanup = () => {
		ws.removeListener("message", onMessage)
		ws.removeListener("close", onClose)
		ws.removeListener("error", onError)
		ws.removeListener("open", onOpen)
	}

	ws.on("message", onMessage)
	ws.on("close", onClose)
	ws.on("error", onError)
	ws.on("open", onOpen)
	if (ws.readyState === 1) onOpen()

	return {
		streamId,
		close() {
			finish()
		},
	}
}

function safe(fn: () => void): void {
	try {
		fn()
	} catch (error) {
		console.error("[remote-stream] handler threw:", error)
	}
}

function closeQuietly(ws: MuxSocket): void {
	try {
		if (ws.readyState < 2) ws.close()
	} catch {
		// a socket that refuses close() is already dead
	}
}

function toError(raw: unknown): Error {
	return raw instanceof Error ? raw : new Error(String(raw))
}
