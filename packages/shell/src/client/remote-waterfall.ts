/**
 * Forwarded `$events` waterfall answering for the client-mode session layer
 * (audit rows 7 + 8).
 *
 * A forwarded waterfall arrives as a raw `$events` frame — the host stripped
 * the scoped `agent` object and the cancellation `signal` from the request
 * (`projectRemoteEventRequest`, dsh-api-gateway) and put the owning agent's
 * identity on the frame itself. On this closure the agent identity IS the
 * session identity ("Session-backed Agent identity", `dsh-agent` types;
 * the client sessions service keys scopes by the same axis), so claiming a
 * request is `frame.agentId === our sessionId`. The answer leaves through the
 * unary `$events/result` RPC with the client id from the connection's ready
 * frame:
 *
 *   rpc("$events/result", { clientId, eventId, outcome })
 *     outcome: {kind:'next'} | {kind:'result', value} | {kind:'rejected', error}
 *
 * Verdict parity with host-session.ts:1366-1382: an approval decision is the
 * ApprovalOutcome string "allowed-once" / "rejected" (+"unavailable" when no
 * turn callbacks exist to prompt into — fail closed, same as the in-process
 * listener). The user-questions answer is `{answers: [{id, selected[], custom?}]}`,
 * including the declined envelope `{id, selected: [], custom: "declined"}`
 * that host-session.ts:248-275 returns when the UI layer throws.
 *
 * Why the waterfall route for ask_user (and not `userQuestions/answer` +
 * `userQuestions/attachWait`): the waterfall IS the answerer chain the
 * in-process TUI joins today — same claim semantics (returning claims, `next`
 * delegates), same payload, no timeout state machine, and it keeps the
 * prompt reachable from the UI layer with zero extra streams. The
 * `userQuestions/*` RPCs exist for TIMED questions (`wait.timed`): a client
 * that answers a timed question after detaching from the waterfall must
 * attach to the wait stream first or the host counts it as a timeout. The
 * TUI overlay has no such detach window (the modal is always local), so the
 * waterfall route is the exact-parity route; the RPC pair stays a wave-2
 * option for late answers to timed questions.
 */

import type { ClientConnection, ClientReadyInfo } from "./transport.ts"
import type { EventsWaterfall, RemoteJson } from "./mux-frame.ts"

/** The approval verdict vocabulary (ApprovalOutcome subset the TUI returns). */
export type RemoteApprovalVerdict = "allowed-once" | "rejected" | "unavailable"

/** One simplified question row — the exact host-session.ts ask-provider shape. */
export interface RemoteQuestion {
	id: string
	prompt: string
	options: string[]
}

/** One answer row the UI returns (host-session.ts registerAskProvider shape). */
export interface RemoteQuestionAnswer {
	questionId: string
	selected: string
}

export interface WaterfallAnswererOptions {
	connection: ClientConnection
	/** The ready frame's client id — the `$events/result` correlation key. */
	readyInfo: ClientReadyInfo
	/** Answer one `$events/result` RPC; injectable for tests. */
	answerRpc?(args: Record<string, unknown>): Promise<void>
}

/**
 * Claim predicates + answer plumbing shared by the approval and
 * user-questions flows. The session layer routes raw `$events` frames here.
 */
export class WaterfallAnswerer {
	readonly #connection: ClientConnection
	readonly #clientId: string
	readonly #answerRpc: (args: Record<string, unknown>) => Promise<void>

	constructor(options: WaterfallAnswererOptions) {
		this.#connection = options.connection
		this.#clientId = options.readyInfo.clientId
		this.#answerRpc = options.answerRpc ?? (async (args) => {
			await this.#connection.rpc("$events/result", args)
		})
	}

	/** True when the waterfall belongs to the given session (agentId axis). */
	claims(frame: EventsWaterfall, sessionId: string | undefined): boolean {
		return sessionId !== undefined && frame.agentId === sessionId
	}

	/** Answer "not mine" — hand the request back to the host's next listener. */
	async delegate(eventId: string): Promise<void> {
		await this.#answerRpc({ clientId: this.#clientId, eventId, outcome: { kind: "next" } })
	}

	/** Answer with a business result value (the claimed outcome). */
	async answer(eventId: string, value: RemoteJson): Promise<void> {
		await this.#answerRpc({ clientId: this.#clientId, eventId, outcome: { kind: "result", value } })
	}

	/** Answer with a wire-safe rejection (the host rethrows it listener-side). */
	async reject(eventId: string, error: { name: string; message: string; code?: string }): Promise<void> {
		await this.#answerRpc({
			clientId: this.#clientId,
			eventId,
			outcome: { kind: "rejected", error: { name: error.name, message: error.message, ...(error.code ? { code: error.code } : {}) } },
		})
	}

	/** Approve/reject one tool call; `null` prompts = fail closed 'unavailable'. */
	async answerApproval(eventId: string, verdict: RemoteApprovalVerdict): Promise<void> {
		await this.answer(eventId, verdict)
	}

	/** The approval request's user-facing fields (agent/signal already stripped). */
	static approvalView(frame: EventsWaterfall): { toolName: string; callId?: string; reason?: string } {
		const toolName = String(frame.request.toolName ?? "tool")
		const callId = frame.request.callId === undefined ? undefined : String(frame.request.callId)
		const reason = frame.request.reason === undefined ? undefined : String(frame.request.reason)
		return { toolName, ...(callId !== undefined ? { callId } : {}), ...(reason !== undefined ? { reason } : {}) }
	}

	/**
	 * The user-questions request simplified to the ask-provider shape
	 * (host-session.ts:256-260 parity: prompt ?? question ?? header;
	 * option label ?? value ?? raw).
	 */
	static questionsView(frame: EventsWaterfall): RemoteQuestion[] {
		const questions = Array.isArray(frame.request.questions) ? frame.request.questions : []
		return questions.map((q) => {
			const item = (typeof q === "object" && q !== null ? q : {}) as Record<string, unknown>
			const options = Array.isArray(item.options) ? item.options : []
			return {
				id: String(item.id ?? ""),
				prompt: String(item.prompt ?? item.question ?? item.header ?? ""),
				options: options.map((o) => String(typeof o === "object" && o !== null ? ((o as Record<string, unknown>).label ?? (o as Record<string, unknown>).value ?? o) : o)),
			}
		})
	}

	/** The answers value built from UI picks (host-session.ts:267-272 parity). */
	static answersValue(questions: RemoteQuestion[], picks: RemoteQuestionAnswer[]): RemoteJson {
		return {
			answers: questions.map((q) => {
				const pick = picks.find((p) => p.questionId === q.id)
				const answer: { [key: string]: RemoteJson } = pick
					? { id: q.id, selected: [pick.selected] }
					: { id: q.id, selected: [], custom: "declined" }
				return answer
			}),
		}
	}

	/** The declined envelope returned when the UI layer throws. */
	static declinedValue(questions: RemoteQuestion[]): RemoteJson {
		return {
			answers: questions.map((q) => ({ id: q.id, selected: [], custom: "declined" })),
		}
	}
}
