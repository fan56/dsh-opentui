/**
 * TurnOverlayController — the approval/ask queue behind the batch-5
 * overlay surfaces (approval card + ask picker), pure logic with no Solid
 * or renderer dependency so `bun test` can drive it against a fake seam.
 *
 * Contract (shell parity):
 *   approval  `requestApproval` resolves with the exact verdict strings
 *             ("allowed-once" on confirm, "rejected" on cancel/esc);
 *             requests made while one is pending queue FIFO.
 *   ask       `answer(questions)` walks the batch one picker at a time;
 *             enter records a pick and advances, the last pick resolves
 *             the batch with the picks; esc at ANY question resolves `[]`
 *             (empty selection = the declined envelope downstream).
 *
 * The `onIdle` hook is the composer-refocus point: it fires every time the
 * overlay set drains to empty — the host re-asserts editor focus there
 * (the login-era bug: an overlay closing and the composer staying blurred).
 */
import type { SeamApprovalVerdict, SeamAskPick, SeamAskQuestion } from "../../seams/session"

export type PendingApproval = { id: number; name: string; args: Record<string, unknown> }
export type PendingAsk = { id: number; questions: SeamAskQuestion[]; index: number }

type ApprovalEntry = {
	request: PendingApproval
	resolve: (verdict: SeamApprovalVerdict) => void
}
type AskEntry = {
	id: number
	questions: SeamAskQuestion[]
	index: number
	picks: SeamAskPick[]
	resolve: (picks: SeamAskPick[]) => void
}

export class TurnOverlayController {
	#approvals: ApprovalEntry[] = []
	#asks: AskEntry[] = []
	#seq = 0
	#listeners = new Set<() => void>()
	#idleHandlers = new Set<() => void>()
	#busy = false

	subscribe(fn: () => void): () => void {
		this.#listeners.add(fn)
		return () => this.#listeners.delete(fn)
	}

	/** Fires each time the overlay set drains to empty (the refocus point). */
	onIdle(fn: () => void): () => void {
		this.#idleHandlers.add(fn)
		return () => this.#idleHandlers.delete(fn)
	}

	#changed(): void {
		for (const listener of this.#listeners) listener()
		const busy = this.#approvals.length > 0 || this.#asks.length > 0
		if (this.#busy && !busy) for (const handler of this.#idleHandlers) handler()
		this.#busy = busy
	}

	// ---- approval ----------------------------------------------------

	get pendingApproval(): PendingApproval | undefined {
		return this.#approvals[0]?.request
	}

	/** View-side entry — what `SeamTurnCallbacks.onApprove` awaits. */
	requestApproval(name: string, args: Record<string, unknown>): Promise<SeamApprovalVerdict> {
		return new Promise((resolve) => {
			this.#approvals.push({ request: { id: ++this.#seq, name, args }, resolve })
			this.#changed()
		})
	}

	/** Enter / confirm button. */
	confirmApproval(): void {
		this.#settleApproval("allowed-once")
	}

	/** Cancel button / esc. */
	rejectApproval(): void {
		this.#settleApproval("rejected")
	}

	#settleApproval(verdict: SeamApprovalVerdict): void {
		const head = this.#approvals.shift()
		if (!head) return
		head.resolve(verdict)
		this.#changed()
	}

	// ---- ask ----------------------------------------------------------

	get pendingAsk(): PendingAsk | undefined {
		const head = this.#asks[0]
		return head ? { id: head.id, questions: head.questions, index: head.index } : undefined
	}

	get currentQuestion(): SeamAskQuestion | undefined {
		const head = this.#asks[0]
		return head?.questions[head.index]
	}

	/** The seam ask provider body — sequential pickers per question. */
	answer(questions: SeamAskQuestion[]): Promise<SeamAskPick[]> {
		if (questions.length === 0) return Promise.resolve([])
		return new Promise((resolve) => {
			this.#asks.push({ id: ++this.#seq, questions, index: 0, picks: [], resolve })
			this.#changed()
		})
	}

	/** Enter on an option: record the pick, advance; the last pick settles. */
	pick(option: string): void {
		const head = this.#asks[0]
		const question = head?.questions[head.index]
		if (!head || !question) return
		head.picks.push({ questionId: question.id, selected: option })
		if (head.index + 1 >= head.questions.length) {
			this.#asks.shift()
			head.resolve(head.picks)
		} else {
			head.index++
		}
		this.#changed()
	}

	/** Esc at any question: declined envelope — the batch resolves `[]`. */
	decline(): void {
		const head = this.#asks.shift()
		if (!head) return
		head.resolve([])
		this.#changed()
	}
}
