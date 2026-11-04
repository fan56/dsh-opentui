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
	/** Hard stop (host-session parity: 120s wedged side call → empty). */
	timeoutMs?: number
}

export interface RemoteBtwResult {
	answer: string
	sessionId: string
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
		const value = (await options.rpc("session/create", { request: { cwd: options.cwd, sessionId: requested } })) as Record<string, unknown>
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
		const finish = (errorText: string | undefined) => {
			settle(errorText)
			resolve(errorText !== undefined ? errorText : out.trim())
		}
		timer = setTimeout(() => finish(undefined), timeoutMs) // wedged side call → empty
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
						if (reason.kind === "error") {
							const err = typeof reason.error === "object" && reason.error !== null ? (reason.error as Record<string, unknown>) : {}
							finish(`error: ${String(err.message ?? "unknown").slice(0, 200)}`)
							return
						}
						finish(undefined)
					}
				},
				onEnd: () => finish(undefined),
				onFailed: () => finish(undefined),
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
				finish(undefined) // do not wait out the timer on a refused prompt
			},
		)
	})
	if (promptFailure !== undefined) {
		const error = promptFailure.error
		throw error instanceof Error ? error : new Error(String(error))
	}
	return { answer, sessionId }
}
