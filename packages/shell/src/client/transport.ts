/**
 * T9 STUB — the HTTP ClientConnection carrier is retired. Kept ONLY for
 * `packages/shell/scripts/e2e-*.mjs` imports (T12 cleanup). No production code
 * imports it.
 */
export type ClientConnectionState = "connecting" | "ready" | "closed"
export type ClientEventDisposer = () => void
export type ClientEventHandler<T = unknown> = (payload: T) => void
export type ClientReadyInfo = { sessionId?: string }

export class RemoteRpcError extends Error {
	constructor(message: string, readonly code?: string) { super(message) }
}
export class ConnectionRetryExhaustedError extends Error {}

export class ClientConnection {
	constructor(_options: Record<string, unknown>) {
		throw new Error("HTTP ClientConnection retired (T9); use StdioBridgeTransport")
	}
}
