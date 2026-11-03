/**
 * Mux wire frames and `$events` item validation for the client-mode transport.
 *
 * Mirrors the Host's `dsh-api-gateway` stream-protocol validation exactly
 * (`parseRemoteStreamServerMessage` + `parseRemoteEventReady` +
 * `parseRemoteEventFrame`): a frame that the Host would refuse is refused
 * here too, and a malformed `$events` item invalidates the connection
 * generation (the `dsh-client-connection` contract). Keeping this pure and
 * dependency-free makes the parser unit-testable without sockets.
 */

/** A failure that means "the physical/logical stream violated the protocol". */
export class MuxFrameError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options)
		this.name = "MuxFrameError"
	}
}

/** Lossless JSON value as carried by the Remote wire. */
export type RemoteJson = null | boolean | number | string | RemoteJson[] | { [key: string]: RemoteJson }

/** One server-to-client frame on the `/api/remote.mux` WebSocket. */
export type MuxServerFrame =
	| { type: "item"; streamId: string; value: unknown }
	| { type: "end"; streamId: string }
	| { type: "error"; streamId: string; error: RemoteErrorFields }

/** Host-side failure fields carried by an `error` frame or a failed RPC result. */
export interface RemoteErrorFields {
	code: string
	message: string
	details: Record<string, RemoteJson>
}

/** Opening `$events` item: one connection generation's Client identity + Host facts. */
export interface EventsReady {
	type: "ready"
	clientId: string
	host: { home: string }
}

/** Forwarded broadcast event (`emit`) — fire-and-forget notification. */
export interface EventsEmit {
	type: "emit"
	event: string
	args: RemoteJson[]
}

/** Forwarded waterfall event — requires an outcome answer via `$events/result`. */
export interface EventsWaterfall {
	type: "waterfall"
	event: string
	eventId: string
	agentId: string
	request: { [key: string]: RemoteJson }
}

/** A previously delivered waterfall was cancelled by the Host. */
export interface EventsCancel {
	type: "cancel"
	eventId: string
}

/** `$events` items delivered after the opening ready frame. */
export type EventsItem = EventsEmit | EventsWaterfall | EventsCancel

/** Client-to-server frame opening one `$events` logical stream on the mux. */
export interface MuxOpenFrame {
	type: "open"
	streamId: string
	endpoint: "$events"
	payload: { args: Record<string, never> }
}

/** Build the `$events` stream-open frame (empty standard Remote payload). */
export function openEventsStreamFrame(streamId: string): MuxOpenFrame {
	return { type: "open", streamId, endpoint: "$events", payload: { args: {} } }
}

/** Parse and validate one Host-to-client mux text message. Throws MuxFrameError. */
export function parseMuxFrame(text: string): MuxServerFrame {
	let decoded: unknown
	try {
		decoded = JSON.parse(text)
	} catch (cause) {
		throw new MuxFrameError("mux frame is not JSON", { cause })
	}
	if (!isRecord(decoded)) throw new MuxFrameError("mux frame must be an object")
	const value = decoded as Record<string, unknown>
	const type = value.type
	const streamId = value.streamId
	if (typeof streamId !== "string" || streamId.length === 0) {
		throw new MuxFrameError("mux frame streamId is missing or empty")
	}
	if (type === "item") {
		// Gateway parity: an item's value is optional on the wire (value-less item frames are legal).
		if (!exactKeys(value, ["type", "streamId"]) && !exactKeys(value, ["type", "streamId", "value"])) {
			throw new MuxFrameError("item frame must carry exactly type, streamId [, value]")
		}
		return { type: "item", streamId, value: value.value }
	}
	if (type === "end") {
		if (!exactKeys(value, ["type", "streamId"])) {
			throw new MuxFrameError("end frame must carry exactly type, streamId")
		}
		return { type: "end", streamId }
	}
	if (type === "error") {
		if (!exactKeys(value, ["type", "streamId", "error"])) {
			throw new MuxFrameError("error frame must carry exactly type, streamId, error")
		}
		return { type: "error", streamId, error: parseRemoteErrorFields(value.error) }
	}
	throw new MuxFrameError(`unknown mux frame type: ${String(type)}`)
}

/** Validate the opening `$events` item; the generation gate. Throws MuxFrameError. */
export function parseEventsReady(value: unknown): EventsReady {
	if (!isPlainRecord(value) || !exactKeys(value, ["type", "clientId", "host"])) {
		throw new MuxFrameError("$events opening item must carry exactly type, clientId, host")
	}
	const record = value as Record<string, unknown>
	if (record.type !== "ready") {
		throw new MuxFrameError(`$events opening item must be ready, got: ${String(record.type)}`)
	}
	if (typeof record.clientId !== "string" || record.clientId.length === 0) {
		throw new MuxFrameError("$events ready clientId must be a non-empty string")
	}
	const host = record.host
	if (!isPlainRecord(host) || !exactKeys(host, ["home"]) || typeof host.home !== "string") {
		throw new MuxFrameError("$events ready host must carry exactly home: string")
	}
	return { type: "ready", clientId: record.clientId, host: { home: host.home } }
}

/** Validate one `$events` item delivered after ready. Throws MuxFrameError. */
export function parseEventsItem(value: unknown): EventsItem {
	if (!isPlainRecord(value)) throw new MuxFrameError("$events item must be a plain object")
	const record = value as Record<string, unknown>
	if (record.type === "cancel") {
		if (!exactKeys(record, ["type", "eventId"]) || typeof record.eventId !== "string" || record.eventId.length === 0) {
			throw new MuxFrameError("$events cancel item must carry exactly type, eventId: string")
		}
		return { type: "cancel", eventId: record.eventId }
	}
	if (record.type === "emit") {
		if (
			!exactKeys(record, ["type", "event", "args"])
			|| typeof record.event !== "string" || record.event.length === 0
			|| !Array.isArray(record.args) || !isRemoteJson(record.args)
		) {
			throw new MuxFrameError("$events emit item must carry exactly type, event: string, args: JSON[]")
		}
		return { type: "emit", event: record.event, args: record.args as RemoteJson[] }
	}
	if (record.type === "waterfall") {
		const request = record.request
		if (
			!exactKeys(record, ["type", "event", "eventId", "agentId", "request"])
			|| typeof record.event !== "string" || record.event.length === 0
			|| typeof record.eventId !== "string" || record.eventId.length === 0
			|| typeof record.agentId !== "string" || record.agentId.length === 0
			|| !isPlainRecord(request)
			|| Object.hasOwn(request, "agent") || Object.hasOwn(request, "signal")
			|| !isRemoteJson(request)
		) {
			throw new MuxFrameError("$events waterfall item has an invalid frame shape")
		}
		return {
			type: "waterfall",
			event: record.event,
			eventId: record.eventId,
			agentId: record.agentId,
			request: request as { [key: string]: RemoteJson },
		}
	}
	throw new MuxFrameError(`unknown $events item type: ${String(record.type)}`)
}

/** Build the wire-failure fields shape (used when raising stream errors upward). */
export function parseRemoteErrorFields(value: unknown): RemoteErrorFields {
	if (!isPlainRecord(value) || !exactKeys(value, ["code", "message", "details"])) {
		throw new MuxFrameError("remote error must carry exactly code, message, details")
	}
	const record = value as Record<string, unknown>
	if (typeof record.code !== "string" || typeof record.message !== "string" || !isPlainRecord(record.details)) {
		throw new MuxFrameError("remote error code/message must be strings and details an object")
	}
	if (!isRemoteJson(record.details)) {
		throw new MuxFrameError("remote error details must be JSON data")
	}
	return record as unknown as RemoteErrorFields
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Gateway parity: event objects must be plain (prototype Object.prototype or null). */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value)) return false
	const prototype = Object.getPrototypeOf(value)
	return prototype === Object.prototype || prototype === null
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
	return Reflect.ownKeys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

function isRemoteJson(value: unknown): value is RemoteJson {
	if (value === null) return true
	const kind = typeof value
	if (kind === "boolean" || kind === "number" || kind === "string") return true
	if (Array.isArray(value)) return value.every(isRemoteJson)
	if (isPlainRecord(value)) return Object.values(value).every(isRemoteJson)
	return false
}
