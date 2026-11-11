/**
 * `ClientConnection` — the connection carrier for a non-page dsh client
 * (client-mode port bucket (a); ADR-0005).
 *
 * Composition:
 * - The lifecycle manager hands `{ authority, cookieHeader }` (the authority
 *   the cookie is bound to, `host:port`, and the minted `Cookie` header
 *   value). This module never spawns hosts and never mints cookies itself —
 *   see `cookie-mint.ts` for `mintOwnerCookie`.
 * - The `dsh-client-connection` SDK (`installConnection`) owns the connection
 *   lifecycle: generation state machine, ready gating, and the reconnect
 *   policy (500ms → 10s caps, 50–100% jitter — the host's documented caps).
 * - The `$events` generation source is the minimal mux pump
 *   (`events-source.ts`), fed the SDK's authenticated socket factory: a `ws`
 *   package WebSocket carrying the cookie on the upgrade to
 *   `/api/remote.mux` (the global WebSocket cannot send headers, so a
 *   non-page carrier must supply the factory).
 * - Unary RPC rides HTTP `POST /api` with the same cookie through the SDK's
 *   envelope validation (rpcId correlation, multipart binary responses).
 *
 * Generation semantics are the SDK's: `onConnected`-equivalent resolution and
 * event delivery happen only after the validated `$events` ready frame; a
 * stream end/error/malformed frame invalidates the generation and the SDK
 * loop reconnects automatically. Consumers observe that through `getState()` /
 * `onStateChange()` (`connecting | connected | disconnected`).
 *
 * First-connection policy: the SDK reconnects forever by design, which is
 * correct AFTER a session exists but wrong during boot against a dead or
 * unauthorized host (silent `[connection] connection lost, retry #n`). The
 * generation counter below caps retries until the first successful
 * connection (default 3) and a boot budget (default 30s) backstops it; the
 * rejection carries the host's captured stderr tail. Once connected, the
 * SDK's normal reconnect behavior is untouched.
 *
 * SDK loading is LAZY: the module below is imported with `await import()`
 * inside the connect path (`#installAndStart`) and nowhere else — loading
 * this module (the whole test-load graph: tests fake the connection) never
 * pulls `@deepseek-ai/dsh-client-connection` in. That package resolves only
 * from a global dsh closure (not on the npm registry), which is exactly why
 * bare `bun test` on CI used to fail at module-load time; the workflow's
 * resolution-only stub stays as belt-and-braces. Type-only imports stay
 * static (erased at runtime; they need the package only for `tsc`, which
 * runs where the closure is linked).
 */

import type {
	ConnectionGenerationSource,
	ConnectionHandle,
	ConnectionHostInfo,
	ConnectionRecoveryConfig,
	ConnectionState,
	ConnectionWebSocket,
	installConnection,
} from "@deepseek-ai/dsh-client-connection/client"
import { Context } from "@deepseek-ai/cordis"
import WS from "ws"
import { createEventsPumpSource, type EventsPumpCallbacks, type MuxSocket } from "./events-source.ts"
import type { EventsItem } from "./mux-frame.ts"

/** Connection lifecycle state observable by consumers. */
export type ClientConnectionState = ConnectionState

/** One validated `$events` opening frame (the connection generation gate). */
export interface ClientReadyInfo {
	clientId: string
	host: ConnectionHostInfo
}

export interface ClientConnectionOptions {
	/** Cookie audience and URL authority: `host:port` (scheme omitted). */
	authority: string
	/** Full `Cookie` header value (`<name>=<value>`), e.g. from `mintOwnerCookie`. */
	cookieHeader: string
	/** Host base URL; defaults to `http://<authority>` (v1 is a local HTTP listener). */
	baseUrl?: string
	/** Reconnect-timing overrides; defaults mirror the host's documented caps. */
	recovery?: Partial<ConnectionRecoveryConfig>
	/** Retry cap until the FIRST successful connection (default 3). A carrier
	 * that has connected once keeps the SDK's normal reconnect policy — this
	 * only stops a boot against a dead/unauthorized host from looping
	 * silently forever. */
	maxConnectAttempts?: number
	/** Overall budget for the first connection (default 30s). */
	connectBudgetMs?: number
	/** Lazy host diagnostics (child output tail); quoted in the error when the
	 * retry cap or the budget is exhausted. */
	diagnostics?: () => string
}

/** RPC completed and the host returned a logical failure envelope. */
export class RemoteRpcError extends Error {
	readonly code: string
	readonly details: Readonly<Record<string, unknown>>

	constructor(code: string, message: string, details: Readonly<Record<string, unknown>>) {
		super(message)
		this.name = "RemoteRpcError"
		this.code = code
		this.details = details
	}
}

/** RPC could not complete on the transport (offline, HTTP failure, bad envelope). */
export class RpcTransportError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options)
		this.name = "RpcTransportError"
	}
}

/** The connection was closed while `connect()` was still waiting to resolve. */
export class ConnectionClosedError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ConnectionClosedError"
	}
}

/** The first client generation never completed: the host is dead, wedged, or
 * rejects our cookie. Surfaced instead of retrying silently forever. */
export class ConnectionRetryExhaustedError extends Error {
	readonly code = "connection-retry-exhausted"

	constructor(
		readonly attempts: number,
		readonly authority: string,
		readonly diagnostics?: string,
	) {
		const tail = diagnostics?.trim()
		super(
			`host ${authority} never accepted the client connection after ${attempts} retr${attempts === 1 ? "y" : "ies"}` +
				(tail ? `\n${tail}` : ""),
		)
		this.name = "ConnectionRetryExhaustedError"
	}
}

const DEFAULT_MAX_CONNECT_ATTEMPTS = 3
const DEFAULT_CONNECT_BUDGET_MS = 30_000

/** Handler receiving raw `$events` items (`emit` | `waterfall` | `cancel`). */
export type ClientEventHandler = (item: EventsItem) => void

/** The ready frame is consumed as the generation gate and is not delivered here. */
export type ClientEventDisposer = () => void

/**
 * The connection carrier for one host authority.
 *
 * See `src/client/README.md` for the full contract.
 */
export class ClientConnection {
	readonly authority: string
	readonly baseUrl: string

	#handle: ConnectionHandle | undefined
	#loop: { stop(): void } | undefined
	#readyInfo: ClientReadyInfo | undefined
	#connectPromise: Promise<ClientReadyInfo> | undefined
	#resolveConnect: ((info: ClientReadyInfo) => void) | undefined
	#rejectConnect: ((reason: unknown) => void) | undefined
	#handlers = new Set<ClientEventHandler>()
	#stateListeners = new Set<(state: ClientConnectionState) => void>()
	#state: ClientConnectionState = "connecting"
	#closed = false
	/** First-connection retry policy (see ClientConnectionOptions). */
	readonly #maxConnectAttempts: number
	readonly #connectBudgetMs: number
	readonly #diagnostics: (() => string) | undefined
	#connectAttempts = 0
	#connectedOnce = false
	#budgetTimer: ReturnType<typeof setTimeout> | undefined
	/** Transport seams staged by the constructor for the deferred SDK install. */
	readonly #transport: {
		streamBaseUrl: string
		createWebSocket: (url: string) => ConnectionWebSocket
		fetch: (input: string | URL, init?: RequestInit) => Promise<Response>
	}
	readonly #recovery: Partial<ConnectionRecoveryConfig> | undefined
	readonly #pumpCallbacks: EventsPumpCallbacks

	constructor(options: ClientConnectionOptions) {
		const { authority, cookieHeader } = options
		if (typeof authority !== "string" || authority.length === 0 || /[\r\n/]/.test(authority)) {
			throw new RpcTransportError("authority must be a non-empty host:port without scheme or path separators")
		}
		if (typeof cookieHeader !== "string" || !cookieHeader.includes("=") || /[\r\n]/.test(cookieHeader)) {
			throw new RpcTransportError("cookieHeader must be a single name=value Cookie header value")
		}
		this.authority = authority
		this.baseUrl = options.baseUrl ?? `http://${authority}`

		// Non-page carrier: every socket and every RPC call must carry the API
		// cookie explicitly (no cookie jar outside a browser).
		this.#transport = {
			streamBaseUrl: this.baseUrl,
			createWebSocket: (url: string): ConnectionWebSocket =>
				new WS(url, { headers: { cookie: cookieHeader } }) as unknown as ConnectionWebSocket,
			fetch: (input: string | URL, init?: RequestInit): Promise<Response> => {
				const url = new URL(input instanceof URL ? input.href : input, this.baseUrl).href
				const headers = new Headers(init?.headers)
				headers.set("cookie", cookieHeader)
				return globalThis.fetch(url, { ...init, headers })
			},
		}
		this.#recovery = options.recovery
		this.#maxConnectAttempts = Math.max(0, options.maxConnectAttempts ?? DEFAULT_MAX_CONNECT_ATTEMPTS)
		this.#connectBudgetMs = Math.max(1, options.connectBudgetMs ?? DEFAULT_CONNECT_BUDGET_MS)
		this.#diagnostics = options.diagnostics
		this.#pumpCallbacks = {
			onReady: (info) => {
				this.#readyInfo = info
			},
			onItem: (item) => this.#dispatch(item),
		}
	}

	/**
	 * Start the connect/reconnect loop and resolve with the first validated
	 * ready frame. The loop keeps reconnecting afterwards (state observable
	 * tracks it); `connect()` never rejects except on `close()` while waiting
	 * or when the lazy SDK import itself fails (package absent — a hard
	 * environment error; the promise is reset so a later call can retry).
	 */
	connect(): Promise<ClientReadyInfo> {
		if (this.#closed) return Promise.reject(new ConnectionClosedError("connection is closed"))
		if (this.#connectPromise) return this.#connectPromise
		this.#connectPromise = this.#installAndStart()
		return this.#connectPromise
	}

	/**
	 * The connect path proper: lazily import the SDK (the ONLY load of
	 * `@deepseek-ai/dsh-client-connection/client` — see the module header),
	 * install it into a fresh cordis context, register the mux pump as the
	 * generation source, and start the SDK loop. Constructor→connect order
	 * parity: the source is registered before `start()`, exactly as the
	 * pre-lazy constructor did.
	 */
	async #installAndStart(): Promise<ClientReadyInfo> {
		try {
			const { installConnection } = await import("@deepseek-ai/dsh-client-connection/client")
			if (this.#closed) throw new ConnectionClosedError("connection closed before connecting")
			// The SDK is type-declared against the dsh closure's cordis (augmented
			// with host services); the repo resolves @deepseek-ai/cordis@4.0.5 — the
			// same runtime version the closure ships (probe-verified end to end).
			const context = new Context()
			const sdkContext = context as unknown as Parameters<typeof installConnection>[0]
			installConnection(sdkContext, { interactions: "answer", transport: this.#transport, recovery: this.#recovery })
			const handle = sdkContext.get("connection") as ConnectionHandle | undefined
			if (!handle) throw new RpcTransportError("connection service failed to install")
			this.#handle = handle
			const pump = createEventsPumpSource(
				(path) => handle.openWebSocket(path) as unknown as MuxSocket,
				this.#pumpCallbacks,
			)
			// Count generation attempts until the first success. The SDK keeps
			// reconnecting forever by design; during a BOOT that would print
			// `[connection] connection lost, retry #n` indefinitely against a
			// host that is dead or rejects our cookie. After the first
			// connection the normal reconnect policy is left untouched.
			handle.registerGenerationSource((signal, ready) => {
				if (!this.#connectedOnce) {
					this.#connectAttempts += 1
					if (this.#connectAttempts > this.#maxConnectAttempts + 1) {
						this.#failConnect(
							new ConnectionRetryExhaustedError(
								this.#maxConnectAttempts,
								this.authority,
								this.#diagnostics?.(),
							),
						)
						return new Promise<void>((resolve) => {
							if (signal.aborted) resolve()
							else signal.addEventListener("abort", () => resolve(), { once: true })
						})
					}
				}
				return pump(signal, ready)
			})
			return await new Promise<ClientReadyInfo>((resolve, reject) => {
				this.#resolveConnect = resolve
				this.#rejectConnect = reject
				this.#budgetTimer = setTimeout(() => {
					this.#failConnect(
						new ConnectionRetryExhaustedError(
							Math.max(1, this.#connectAttempts),
							this.authority,
							this.#diagnostics?.(),
						),
					)
				}, this.#connectBudgetMs)
				this.#budgetTimer.unref?.()
				this.#loop = handle.start({
					onConnected: () => {
						this.#connectedOnce = true
						this.#clearBudgetTimer()
						const info = this.#readyInfo
						if (info) this.#resolveConnect?.(info)
					},
					onStateChange: (state) => this.#publishState(state),
				})
			})
		} catch (error) {
			// A failed attempt must not poison connect() forever: reset so a
			// later call retries (a close()-originated rejection included —
			// connect() on a closed carrier rejects at its top guard anyway).
			this.#connectPromise = undefined
			throw error
		}
	}

	/**
	 * One unary Remote RPC: `POST /api/<method>` with the API cookie.
	 * @returns the host's decoded result value.
	 * @throws RemoteRpcError for a host-returned failure envelope
	 *   (`error.code` / `error.details` carry the typed cause), and
	 *   RpcTransportError when the request cannot complete.
	 */
	async rpc<T = unknown>(method: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
		if (this.#closed) throw new ConnectionClosedError("connection is closed")
		if (this.#handle === undefined) {
			throw new RpcTransportError(`rpc ${method} before connect() — the connection service installs lazily on the connect path`)
		}
		let result
		try {
			result = await this.#handle.rpc.call("/api", method, { args: args ?? {} }, signal)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new RpcTransportError(`rpc ${method} failed on the transport: ${message}`, { cause: error })
		}
		if (!result.ok) {
			throw new RemoteRpcError(result.error.code, result.error.message, result.error.details as Record<string, unknown>)
		}
		return result.value as T
	}

	/**
	 * Subscribe to raw `$events` items (forwarded `emit`, `waterfall`,
	 * `cancel` frames). Waterfalls are NOT answered for you — answer them via
	 * `rpc("$events/result", { clientId, eventId, outcome })` (see
	 * `events-source.ts` header for the native-source trade-off). Handler
	 * exceptions are contained and logged.
	 * @returns a disposer for this exact handler.
	 */
	onEvent(handler: ClientEventHandler): ClientEventDisposer {
		this.#handlers.add(handler)
		return () => {
			this.#handlers.delete(handler)
		}
	}

	/** Current lifecycle state (`connecting` until the first attempt outcome). */
	getState(): ClientConnectionState {
		return this.#state
	}

	/** Subscribe to state transitions; returns a disposer. */
	onStateChange(listener: (state: ClientConnectionState) => void): ClientEventDisposer {
		this.#stateListeners.add(listener)
		return () => {
			this.#stateListeners.delete(listener)
		}
	}

	/**
	 * Stop the connection loop, close the mux socket, and invalidate the
	 * generation. Idempotent; pending `connect()` rejects with
	 * ConnectionClosedError. Resolves once the loop is stopped.
	 */
	async close(): Promise<void> {
		if (this.#closed) return
		this.#closed = true
		this.#clearBudgetTimer()
		this.#loop?.stop()
		this.#loop = undefined
		this.#rejectConnect?.(new ConnectionClosedError("connection closed before connecting"))
		this.#resolveConnect = undefined
		this.#rejectConnect = undefined
		this.#handlers.clear()
		this.#publishState("disconnected")
		this.#stateListeners.clear()
	}

	#clearBudgetTimer(): void {
		if (this.#budgetTimer !== undefined) {
			clearTimeout(this.#budgetTimer)
			this.#budgetTimer = undefined
		}
	}

	/** Stop the SDK loop and reject the pending `connect()` (retry cap or
	 * budget exhausted). Later connect() calls keep the rejected promise, so
	 * a boot cannot silently start a second infinite loop. */
	#failConnect(error: Error): void {
		this.#clearBudgetTimer()
		const loop = this.#loop
		this.#loop = undefined
		try {
			loop?.stop()
		} catch {
			/* already stopped */
		}
		const reject = this.#rejectConnect
		this.#resolveConnect = undefined
		this.#rejectConnect = undefined
		reject?.(error)
	}

	#dispatch(item: EventsItem): void {
		for (const handler of [...this.#handlers]) {
			try {
				handler(item)
			} catch (error) {
				console.error("[client-connection] event handler threw:", error)
			}
		}
	}

	#publishState(state: ClientConnectionState): void {
		if (this.#state === state) return
		this.#state = state
		for (const listener of [...this.#stateListeners]) {
			try {
				listener(state)
			} catch (error) {
				console.error("[client-connection] state listener threw:", error)
			}
		}
	}
}

/** The generation-source type the events source plugs into (for the swap path). */
export type { ConnectionGenerationSource, ConnectionRecoveryConfig, ConnectionHostInfo }
