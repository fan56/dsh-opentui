/**
 * /btw side questions for the client-mode session layer (ADR-0005 bucket
 * (b) wave 3; audit row 32 + gap 7).
 *
 * No one-shot throwaway-agent RPC exists on the wire (the in-process path
 * was `agents.create` + `agent.followup` on a detached handle,
 * host-session.ts:378-442). The shaped workaround is a REAL second
 * session: `session/create` + `session/follow` (deltas + turn/end) +
 * `session/prompt` — streamed to the same onDelta callback surface, with
 * the same snapshot-prefix prompt and the same 120s hard stop.
 *
 * Session-pollution choice (documented; audit gap 7):
 * - the wire offers NO session delete/archive RPC (the
 *   dsh-api-session-controller face is create/list/fork/page/… — nothing
 *   removes a stored session), so physical deletion is impossible from
 *   the client; host-side cleanup stays an audit §4 candidate.
 * - pollution is minimized to ONE stored session per client lifetime:
 *   `askBtw` reuses the previous throwaway id (`previousSessionId`) so
 *   every side question rides the same session (prior side Q/A stays in
 *   its context — harmless for one-line answers, and documented here);
 * - the session is renamed `btw: …` after each answer (the only durable
 *   marker the wire can write), and the facade filters `btw:`-titled rows
 *   out of listSessions (client-side; the wire truth keeps the row).
 */

import { randomUUID } from "node:crypto"
import { appendFileSync } from "node:fs"
import type { MuxSocketFactory } from "./events-source.ts"
import { openRemoteStream, type RemoteStreamHandle } from "./remote-stream.ts"
import type { RemoteModelSelection } from "./remote-model.ts"

/** Durable marker title prefix set on the throwaway session. */
export const BTW_TITLE_PREFIX = "btw:"

/** Unary RPC carrier (the ClientConnection subset used here). */
export type RemoteBtwRpc = (method: string, args?: Record<string, unknown>) => Promise<unknown>

export interface RemoteBtwOptions {
	rpc: RemoteBtwRpc
	socketFactory: MuxSocketFactory
	/** Workspace the throwaway session joins (same as the main session). */
	cwd: string
	question: string
	/** Recent-conversation snapshot lines prefixed for reference only. */
	snapshot: string[]
	/** Streaming callback — the FULL answer so far, per text delta. */
	onDelta?: (full: string) => void
	/** Reuse the previous throwaway session (one-session pollution cap). */
	previousSessionId?: string
	/** Model route staged for the throwaway (the facade's pending selection). */
	stagedModel?: RemoteModelSelection
	/**
	 * Preset the throwaway rides (append-system default rule — the facade
	 * passes the same id a fresh main create would). Omitted => host default.
	 */
	agentPreset?: string
	/** Hard stop (host-session parity: 120s wedged side call → empty). */
	timeoutMs?: number
}

export interface RemoteBtwResult {
	answer: string
	sessionId: string
}

/** Btw pump trace (DSH_OPENTUI_DEBUG): /btw render-gap adjudication — did
 * text actually arrive before settle (H-A: paint dropped the body) or did
 * the pump settle with nothing in `out` (H-B: early empty resolve).
 * Timestamped stderr, same shape as remote-follow.ts followTrace.
 *
 * Second sink: when DSH_OPENTUI_TRACE_FILE names a path, the SAME line is
 * appended to that file. The container e2e cannot use stderr here — the TUI
 * repaints the tmux pane and the PTY output never reaches the podman log.
 * The file sink is independent of DSH_OPENTUI_DEBUG (it is its own gate);
 * stderr keeps its exact old behaviour (DEBUG-gated, unchanged). */
function btwTrace(message: string): void {
	const line = `[btw ${new Date().toISOString().slice(11, 23)}] ${message}\n`
	if (process.env.DSH_OPENTUI_DEBUG) process.stderr.write(line)
	const path = process.env.DSH_OPENTUI_TRACE_FILE
	if (!path) return
	try {
		appendFileSync(path, line)
	} catch {
		// A trace file that cannot be written (missing dir, permissions,
		// full disk) must never take the client down — degrade to stderr only.
	}
}

/** Settle-time state of the accumulated answer: length + head/tail chars. */
function btwOutPreview(out: string): string {
	return `out len=${out.length} head=${JSON.stringify(out.slice(0, 40))} tail=${JSON.stringify(out.slice(-40))}`
}

/**
 * One /btw side question over a throwaway remote session. Turn-level
 * failures resolve as `error: …` text (host-session parity — the answer
 * slot shows them); create/prompt RPC failures REJECT (they mean the
 * session service is unavailable, not a bad answer).
 */
export async function askBtw(options: RemoteBtwOptions): Promise<RemoteBtwResult> {
	const timeoutMs = options.timeoutMs ?? 120_000
	// 1. reuse or create the throwaway session (the host may hand back a
	//    different blank — its answer wins, HostSession row-12 parity).
	let sessionId = options.previousSessionId ?? ""
	if (!sessionId) {
		const requested = randomUUID()
		const value = (await options.rpc("session/create", {
			request: {
				cwd: options.cwd,
				sessionId: requested,
				...(options.agentPreset !== undefined ? { agentPreset: options.agentPreset } : {}),
			},
		})) as Record<string, unknown>
		sessionId = typeof value.sessionId === "string" ? value.sessionId : requested
		// a staged model route applies to the fresh throwaway before the prompt
		if (options.stagedModel) {
			try {
				await options.rpc("session/selectModel", {
					request: { sessionId, provider: options.stagedModel.provider, model: options.stagedModel.model },
				})
			} catch {
				/* optional polish — the default route answers fine */
			}
		}
	}

	// 2. attach BEFORE the prompt so no live frame is missed (the main
	//    session's create/attach ordering, applied to the throwaway).
	let out = ""
	let settled = false
	let pump: RemoteStreamHandle | undefined
	let timer: ReturnType<typeof setTimeout> | undefined
	let promptFailure: { error: unknown } | undefined
	// Gap-adjudication counters (trace-only): text deltas seen, turn/end
	// events, stream END/FAILED callbacks — what settled the pump, and with
	// how much of the answer already in `out`.
	let deltas = 0
	let turnEnds = 0
	let streamEnds = 0
	let streamFails = 0
	const settle = (errorText: string | undefined) => {
		if (settled) return
		settled = true
		if (timer !== undefined) clearTimeout(timer)
		pump?.close()
		// 4. cleanup: mark the throwaway (best-effort — the wire's only
		//    durable write after the fact; the facade filters the title).
		void options.rpc("session/rename", {
			request: { sessionId, title: `${BTW_TITLE_PREFIX} ${options.question.slice(0, 40).trim()}` },
		}).catch(() => {})
	}

	const answer = await new Promise<string>((resolve) => {
		const finish = (errorText: string | undefined, why: string) => {
			if (!settled)
				btwTrace(
					`settle why=${why} err=${errorText !== undefined} deltas=${deltas} turnEnds=${turnEnds} streamEnds=${streamEnds} streamFails=${streamFails} ${btwOutPreview(out)}${deltas === 0 && errorText === undefined ? " EARLY-EMPTY-SETTLE" : ""}`,
				)
			settle(errorText)
			resolve(errorText !== undefined ? errorText : out.trim())
		}
		timer = setTimeout(() => finish(undefined, "timeout"), timeoutMs) // wedged side call → empty
		timer.unref?.()
		pump = openRemoteStream(
			options.socketFactory,
			"session/follow",
			{ request: { address: { kind: "session", sessionId }, assistantStream: true } },
			{
				onItem: (value) => {
					const frame = (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>
					if (frame.type === "assistant-stream") {
						const streamFrame = (typeof frame.frame === "object" && frame.frame !== null ? frame.frame : {}) as Record<string, unknown>
						if (streamFrame.type !== "chunk") return
						const chunk = (typeof streamFrame.chunk === "object" && streamFrame.chunk !== null ? streamFrame.chunk : {}) as Record<string, unknown>
						if (chunk.type === "text-delta" && typeof chunk.text === "string" && chunk.text) {
							out += chunk.text
							deltas += 1
							try {
								options.onDelta?.(out)
							} catch {
								/* a UI callback must never take the pump down */
							}
						}
						return
					}
					if (frame.type === "event") {
						const event = (typeof frame.event === "object" && frame.event !== null ? frame.event : {}) as Record<string, unknown>
						if (event.type !== "turn/end") return
						const data = (typeof event.data === "object" && event.data !== null ? event.data : {}) as Record<string, unknown>
						const reason = (typeof data.reason === "object" && data.reason !== null ? data.reason : {}) as Record<string, unknown>
						turnEnds += 1
						btwTrace(`recv turn/end #${turnEnds} reason=${JSON.stringify(reason.kind ?? null)} out=${out.length}`)
						if (reason.kind === "error") {
							const err = typeof reason.error === "object" && reason.error !== null ? (reason.error as Record<string, unknown>) : {}
							finish(`error: ${String(err.message ?? "unknown").slice(0, 200)}`, "turn-end-error")
							return
						}
						finish(undefined, "turn-end")
					}
				},
				onEnd: () => {
					streamEnds += 1
					btwTrace(`recv stream-end #${streamEnds} out=${out.length}`)
					finish(undefined, "stream-end")
				},
				onFailed: (error: Error) => {
					streamFails += 1
					btwTrace(`recv stream-failed #${streamFails} ${btwOutPreview(out)} err=${String(error?.message ?? error)}`)
					finish(undefined, "stream-failed")
				},
			},
		)

		// 3. prompt with the HostSession snapshot prefix (host-session.ts:433-437
		//    parity: reference-only context + "answer in one or two sentences").
		const snap = options.snapshot.length > 0 ? `Recent conversation context (for reference only):\n${options.snapshot.join("\n").slice(-1500)}\n\n` : ""
		options.rpc("session/prompt", {
			request: {
				requestId: randomUUID(),
				sessionId,
				mode: "queue",
				content: [{ type: "text", text: `${snap}Side question (answer in one or two sentences, do not use tools): ${options.question}` }],
			},
		}).then(
			() => {},
			(error: unknown) => {
				promptFailure = { error }
				finish(undefined, "prompt-rejected") // do not wait out the timer on a refused prompt
			},
		)
	})
	if (promptFailure !== undefined) {
		const error = promptFailure.error
		throw error instanceof Error ? error : new Error(String(error))
	}
	return { answer, sessionId }
}
