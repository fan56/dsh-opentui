/**
 * Stdio NDJSON transport for the in-process host bridge (ADR-0009 方案 D /
 * ADR-0010 IPC contract). The bun TUI spawns the node host with
 * `DSH_OPENTUI_BRIDGE_STDIO=1` against the `opentui-inproc` profile, then
 * speaks the line-delimited `{id,method,params}` / `{id,ok,result|error}` /
 * `{type,payload}` frames over stdin/stdout.
 *
 * The child-process factory is injected so the framing/correlation/error
 * paths are unit-testable without a real dsh host. Real-host spawning is
 * covered by the separate real-machine acceptance task.
 *
 * A3 bridge-link state — ONE machine, no parallel flags:
 *   initializing → ready              (first successful reply, first-boot path unchanged)
 *   * → dead                          (child exit / spawn error)
 *   dead → recovering → handshake → ready   (manual recover(), all three checks pass)
 *   dead → recovering → handshake → dead    (respawn or handshake failure)
 *   * → closed                        (terminal; recover() refused)
 */

import { spawn as nodeSpawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import {
	BridgeProtocolError,
	type BridgeDeadCause,
	type BridgeEventFrame,
	type BridgeTransport,
} from "./bridge-session-seam.ts"
import {
	BRIDGE_PROTOCOL_VERSION,
	BridgeBootstrapError,
	verifyRecoveryHandshake,
} from "./seam-bootstrap.ts"

/** The minimal child-process surface the transport needs. */
export interface SpawnedBridgeChild {
	stdin: { write(chunk: string): unknown }
	stdout: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown }
	stderr: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown }
	/** `exit` delivers (code, signal); `error` delivers (Error). The optional
	 *  second arg keeps both shapes under one structural signature. */
	on(
		event: "exit" | "error",
		listener: (arg: number | string | Error | null, signal?: string | null) => void,
	): unknown
	kill(signal?: string): unknown
}

export type BridgeSpawnFn = (
	command: string,
	args: readonly string[],
	options: { env: NodeJS.ProcessEnv; stdio: ["pipe", "pipe", "pipe"] },
) => SpawnedBridgeChild

/** A3: the transport's bridge-link state. `recovering` is a transient value of
 *  this same machine (not a second state machine); `dead`/`closed` replace the
 *  old implicit `#deadError` / `#closed` flags as the authority for guards. */
export type BridgeTransportState =
	| "initializing"
	| "handshake"
	| "ready"
	| "recovering"
	| "dead"
	| "closed"

export interface StdioBridgeTransportOptions {
	/** dsh binary on PATH (default: "dsh"). */
	dshBin?: string
	/** DSH_HOME (default: $DSH_HOME or ~/.dsh). Must be the shared home. */
	dshHome?: string
	/** Profile the bridge is mounted in (default: "opentui-inproc"). */
	profile?: string
	/** Extra env merged over process.env (DSH_* overrides applied last). */
	env?: NodeJS.ProcessEnv
	/** Injectable spawner (default: node:child_process spawn). */
	spawnFn?: BridgeSpawnFn
	/** Per-request reply deadline (default 30s). */
	replyTimeoutMs?: number
	/** A3: recover() refuses calls within this window after DEAD (default 5s). */
	recoverCooldownMs?: number
	/** A3: injectable clock for the cooldown (default: Date.now). */
	now?: () => number
	/** A3: notified on every state transition (e.g. to paint "recovering"). */
	onStateChange?: (state: BridgeTransportState) => void
}

interface PendingRequest {
	resolve(value: unknown): void
	reject(err: unknown): void
	timer: ReturnType<typeof setTimeout>
}

const asRecord = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}

/** Turn a recovery-path throw into a structured DEAD cause. Handshake-check
 *  failures (`BridgeBootstrapError`) are PERMANENT and carry the concrete
 *  mismatched check; respawn/timeout failures stay retryable. */
function recoveryCause(err: unknown, phase: "spawn" | "handshake"): BridgeDeadCause {
	if (err instanceof BridgeBootstrapError) {
		return {
			stage: "handshake",
			code: null,
			signal: null,
			message: err.diagnosis,
			recoverability: "permanent",
			mismatches: [err.code],
		}
	}
	if (err instanceof BridgeProtocolError && err.code === "BRIDGE_DEAD") {
		const detail = asRecord(err.detail)
		return {
			stage: phase,
			code: typeof detail.code === "number" ? detail.code : null,
			signal: typeof detail.signal === "string" ? detail.signal : null,
			message: err.message,
		}
	}
	const message = err instanceof Error ? err.message : String(err)
	return { stage: phase, code: null, signal: null, message }
}

export class StdioBridgeTransport implements BridgeTransport {
	readonly #opts: StdioBridgeTransportOptions
	#child: SpawnedBridgeChild | undefined
	#nextId = 1
	#pending = new Map<number, PendingRequest>()
	#listeners = new Set<(event: BridgeEventFrame) => void>()
	#stdoutBuffer = ""
	#stderrTail: string[] = []
	#deadError: BridgeProtocolError | undefined
	/** Current structured DEAD cause (A1, updated by A3 recover failures). */
	#deadCause: BridgeDeadCause | undefined
	/** A3: the single source of truth for bridge-link state. */
	#state: BridgeTransportState = "initializing"
	/** A3: number of DEAD transitions (a failed respawn increments it). */
	#attempts = 0
	/** A3: when the current DEAD began, for the 5s manual-retry cooldown. */
	#deadAt: number | undefined
	/** A3: stale-child guard — late events from a replaced child are ignored. */
	#connectionGeneration = 0

	constructor(options: StdioBridgeTransportOptions = {}) {
		this.#opts = options
	}

	/** The stderr tail captured so far — quoted in diagnostics on a dead bridge. */
	get diagnostics(): string {
		return this.#stderrTail.slice(-12).join("\n")
	}

	/** A3: the current bridge-link state (read-only). */
	get state(): BridgeTransportState {
		return this.#state
	}

	/** A3: number of DEAD transitions, including failed recovery attempts. */
	get attempts(): number {
		return this.#attempts
	}

	/** The structured reason the bridge is currently DEAD, or undefined while
	 *  alive/recovering. A successful recover() clears it. */
	get deadCause(): BridgeDeadCause | undefined {
		return this.#deadCause
	}

	#setState(next: BridgeTransportState): void {
		if (this.#state === next) return
		this.#state = next
		this.#opts.onStateChange?.(next)
	}

	#spawn(): SpawnedBridgeChild {
		if (this.#child !== undefined) return this.#child
		const dshHome = this.#opts.dshHome ?? process.env.DSH_HOME ?? join(homedir(), ".dsh")
		const env: NodeJS.ProcessEnv = {
			...process.env,
			...(this.#opts.env ?? {}),
			DSH_HOME: dshHome,
			DSH_OPENTUI_BRIDGE_STDIO: "1",
		}
		const spawnFn: BridgeSpawnFn =
			this.#opts.spawnFn ??
			((command, args, options) => nodeSpawn(command, [...args], options as never) as unknown as SpawnedBridgeChild)
		const child = spawnFn(this.#opts.dshBin ?? "dsh", ["--profile", this.#opts.profile ?? "opentui-inproc"], {
			env,
			stdio: ["pipe", "pipe", "pipe"],
		})
		// A3: respawn creates a new child on the SAME path with the same argv/env.
		// Generation-tagged listeners keep a dying predecessor's late exit/error
		// frames from dragging a fresh RECOVERING connection back to DEAD.
		const generation = ++this.#connectionGeneration
		this.#child = child
		child.stdout.on("data", (chunk) => {
			if (generation !== this.#connectionGeneration) return
			this.#onStdout(chunk)
		})
		child.stderr.on("data", (chunk) => {
			if (generation !== this.#connectionGeneration) return
			const text = typeof chunk === "string" ? chunk : chunk.toString("utf8")
			this.#stderrTail.push(...text.split("\n").filter(Boolean))
			if (this.#stderrTail.length > 64) this.#stderrTail.splice(0, this.#stderrTail.length - 64)
		})
		child.on("exit", (code, signal) => {
			if (generation !== this.#connectionGeneration) return
			const exitCode = typeof code === "number" ? code : null
			const exitSignal = typeof signal === "string" ? signal : null
			const message = `bridge host exited (code ${String(code)}${exitSignal === null ? "" : `, signal ${exitSignal}`})`
			this.#onDead(message, { stage: "runtime", code: exitCode, signal: exitSignal, message })
		})
		child.on("error", (err) => {
			if (generation !== this.#connectionGeneration) return
			const message = `bridge host error: ${err instanceof Error ? err.message : String(err)}`
			this.#onDead(message, { stage: "spawn", code: null, signal: null, message })
		})
		return child
	}

	#onStdout(chunk: Buffer | string): void {
		this.#stdoutBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8")
		let newline = this.#stdoutBuffer.indexOf("\n")
		while (newline >= 0) {
			const line = this.#stdoutBuffer.slice(0, newline).trim()
			this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1)
			if (line !== "") this.#handleFrame(line)
			newline = this.#stdoutBuffer.indexOf("\n")
		}
	}

	#handleFrame(line: string): void {
		let frame: unknown
		try {
			frame = JSON.parse(line)
		} catch {
			// Non-JSON host chatter (banners/warnings) is not a bridge frame.
			return
		}
		const rec = asRecord(frame)
		if (typeof rec.id === "number") {
			const pending = this.#pending.get(rec.id)
			if (pending === undefined) return
			this.#pending.delete(rec.id)
			clearTimeout(pending.timer)
			if (rec.ok === true) {
				// First-boot path: the first successful reply is READY. During
				// recovery the state is `handshake`; recover() promotes to READY
				// only after all three handshake checks pass.
				if (this.#state === "initializing") this.#setState("ready")
				pending.resolve(rec.result)
			} else {
				const error = asRecord(rec.error)
				pending.reject(
					new BridgeProtocolError(
						typeof error.code === "string" ? error.code : "BRIDGE_ERROR",
						typeof error.message === "string" ? error.message : "bridge request failed",
						error.detail,
					),
				)
			}
			return
		}
		if (typeof rec.type === "string") {
			this.#publish({ type: rec.type, payload: rec.payload })
		}
	}

	/** Publish on the EXISTING onEvent subscription (no new pipeline). Also
	 *  used for the synthetic `bridge.dead` frame so upper layers observe DEAD
	 *  without polling (A2 — the idle-period crash case). */
	#publish(event: BridgeEventFrame): void {
		for (const listener of [...this.#listeners]) {
			try {
				listener(event)
			} catch {
				/* a throwing view listener must not break the frame pump */
			}
		}
	}

	#onDead(reason: string, cause: BridgeDeadCause): void {
		const firstDead = this.#state !== "dead" && this.#state !== "closed"
		if (firstDead) {
			this.#deadAt = (this.#opts.now ?? Date.now)()
			this.#attempts += 1
		}
		if (this.#state !== "closed") this.#setState("dead")
		if (this.#deadError === undefined) {
			const tail = this.diagnostics ? ` (stderr tail: ${this.diagnostics})` : ""
			this.#deadError = new BridgeProtocolError("BRIDGE_DEAD", `${reason}${tail}`, cause)
			this.#deadCause = cause
			this.#publish({ type: "bridge.dead", payload: cause })
		}
		for (const [id, pending] of [...this.#pending]) {
			this.#pending.delete(id)
			clearTimeout(pending.timer)
			pending.reject(this.#deadError)
		}
	}

	request(method: string, params?: Record<string, unknown>): Promise<unknown> {
		if (this.#state === "closed") {
			return Promise.reject(new BridgeProtocolError("BRIDGE_CLOSED", "bridge transport is closed"))
		}
		if (this.#state === "recovering" || this.#state === "handshake") {
			return Promise.reject(
				new BridgeProtocolError("BRIDGE_RECOVERING", "bridge transport is recovering; request rejected", {
					state: this.#state,
				}),
			)
		}
		if (this.#deadError !== undefined) return Promise.reject(this.#deadError)
		return this.#sendRequest(method, params)
	}

	/** Framing/correlation only — no state guard. Used by the first-boot path
	 *  through request() and by recover() for its own handshake. */
	#sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
		const child = this.#spawn()
		const id = this.#nextId++
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id)
				reject(
					new BridgeProtocolError(
						"BRIDGE_TIMEOUT",
						`no reply for ${method} within ${this.#opts.replyTimeoutMs ?? 30_000}ms`,
					),
				)
			}, this.#opts.replyTimeoutMs ?? 30_000)
			this.#pending.set(id, { resolve, reject, timer })
			try {
				child.stdin.write(`${JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) })}\n`)
			} catch (err) {
				this.#pending.delete(id)
				clearTimeout(timer)
				reject(new BridgeProtocolError("BRIDGE_WRITE_FAILED", String(err)))
			}
		})
	}

	/**
	 * A3: manual recovery from DEAD on the SAME transport instance (the session
	 * identity and the `onEvent` subscription survive). Guards: DEAD only, not
	 * CLOSED, and outside the 5s cooldown. The sequence is observable through
	 * `state` / `onStateChange`: recovering → handshake → ready, or back to dead.
	 * Ordinary `request()` calls are rejected with BRIDGE_RECOVERING meanwhile;
	 * disabling the composer is the UI layer's job, not this transport's.
	 */
	async recover(): Promise<void> {
		if (this.#state === "closed") {
			throw new BridgeProtocolError("BRIDGE_CLOSED", "bridge transport is closed; recover() refused")
		}
		if (this.#state !== "dead") {
			throw new BridgeProtocolError(
				"BRIDGE_NOT_DEAD",
				`recover() requires DEAD state (current: ${this.#state})`,
				{ state: this.#state },
			)
		}
		const now = this.#opts.now ?? Date.now
		const cooldown = this.#opts.recoverCooldownMs ?? 5_000
		const elapsed = this.#deadAt === undefined ? cooldown : now() - this.#deadAt
		if (elapsed < cooldown) {
			throw new BridgeProtocolError(
				"BRIDGE_RECOVERY_COOLDOWN",
				`recover() cooling down; retry in ${cooldown - elapsed}ms`,
				{ remainingMs: cooldown - elapsed },
			)
		}

		this.#setState("recovering")
		this.#deadError = undefined
		this.#deadCause = undefined
		this.#connectionGeneration++
		// Per-connection state belongs to the dead child; drop all of it before
		// the respawn so a stale reply can never settle a new request.
		for (const [id, pending] of [...this.#pending]) {
			this.#pending.delete(id)
			clearTimeout(pending.timer)
			pending.reject(new BridgeProtocolError("BRIDGE_RECOVERING", "bridge recovering; in-flight request dropped"))
		}
		this.#nextId = 1
		this.#stdoutBuffer = ""

		try {
			try {
				this.#child?.kill("SIGTERM")
			} catch {
				/* best-effort teardown of a possibly-still-alive mismatched child */
			}
			this.#child = undefined
			this.#spawn()
			this.#setState("handshake")
			const hello = await this.#sendRequest("bridge.hello", { protocolVersion: BRIDGE_PROTOCOL_VERSION })
			verifyRecoveryHandshake(hello, BRIDGE_PROTOCOL_VERSION)
		} catch (err) {
			// A child error/exit already drove the machine to DEAD (or CLOSED);
			// its cause is the authoritative one — do not overwrite it.
			if (this.#state === "dead" || this.#state === "closed") throw err
			const cause = recoveryCause(err, this.#state === "handshake" ? "handshake" : "spawn")
			this.#onDead(cause.message, cause)
			throw err
		}
		this.#setState("ready")
	}

	onEvent(listener: (event: BridgeEventFrame) => void): () => void {
		this.#listeners.add(listener)
		return () => {
			this.#listeners.delete(listener)
		}
	}

	/** Kill the child and fail all in-flight requests. Idempotent. Terminal:
	 *  recover() is refused after close(). */
	close(): void {
		if (this.#state === "closed") return
		this.#connectionGeneration++
		this.#setState("closed")
		this.#onDead("bridge transport closed", {
			stage: "closed",
			code: null,
			signal: null,
			message: "bridge transport closed",
		})
		try {
			this.#child?.kill("SIGTERM")
		} catch {
			/* best-effort teardown */
		}
	}
}
