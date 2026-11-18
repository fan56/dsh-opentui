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

export class StdioBridgeTransport implements BridgeTransport {
	readonly #opts: StdioBridgeTransportOptions
	#child: SpawnedBridgeChild | undefined
	#nextId = 1
	#pending = new Map<number, PendingRequest>()
	#listeners = new Set<(event: BridgeEventFrame) => void>()
	#stdoutBuffer = ""
	#stderrTail: string[] = []
	#deadError: BridgeProtocolError | undefined
	/** A1: first (permanent) structured DEAD cause. */
	#deadCause: BridgeDeadCause | undefined
	#closed = false

	constructor(options: StdioBridgeTransportOptions = {}) {
		this.#opts = options
	}

	/** The stderr tail captured so far — quoted in diagnostics on a dead bridge. */
	get diagnostics(): string {
		return this.#stderrTail.slice(-12).join("\n")
	}

	/** A1: the structured reason the bridge entered DEAD, or undefined if alive.
	 *  Set once (permanent, like #deadError) and readable synchronously by the
	 *  upper layers. */
	get deadCause(): BridgeDeadCause | undefined {
		return this.#deadCause
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
		this.#child = child
		child.stdout.on("data", (chunk) => this.#onStdout(chunk))
		child.stderr.on("data", (chunk) => {
			const text = typeof chunk === "string" ? chunk : chunk.toString("utf8")
			this.#stderrTail.push(...text.split("\n").filter(Boolean))
			if (this.#stderrTail.length > 64) this.#stderrTail.splice(0, this.#stderrTail.length - 64)
		})
		child.on("exit", (code, signal) => {
			const exitCode = typeof code === "number" ? code : null
			const exitSignal = typeof signal === "string" ? signal : null
			const message = `bridge host exited (code ${String(code)}${exitSignal === null ? "" : `, signal ${exitSignal}`})`
			this.#onDead(message, { stage: "runtime", code: exitCode, signal: exitSignal, message })
		})
		child.on("error", (err) => {
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
		if (this.#deadError !== undefined) return Promise.reject(this.#deadError)
		if (this.#closed) return Promise.reject(new BridgeProtocolError("BRIDGE_CLOSED", "bridge transport is closed"))
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

	onEvent(listener: (event: BridgeEventFrame) => void): () => void {
		this.#listeners.add(listener)
		return () => {
			this.#listeners.delete(listener)
		}
	}

	/** Kill the child and fail all in-flight requests. Idempotent. */
	close(): void {
		if (this.#closed) return
		this.#closed = true
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
