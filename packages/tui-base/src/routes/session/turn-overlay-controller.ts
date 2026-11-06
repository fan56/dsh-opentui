/**
 * TurnOverlayController — the approval/ask queue behind the batch-5
 * overlay surfaces (approval card + ask picker), pure logic with no Solid
 * or renderer dependency so `bun test` can drive it against a fake seam.
 *
 * Contract (shell parity):
 *   approval  `requestApproval` resolves with the exact verdict strings
 *             ("allowed-once" on confirm, "rejected" on cancel/esc);
 *             requests made while one is pending queue FIFO.
 *   ask       `answer(questions)` shows ONE picker over the whole batch
 *             (tui-pi parity): the picker toggles options on the focused
 *             question (`toggle` — single-select replaces, multiSelect
 *             toggles membership), ←/→ switch the focused tab
 *             (`switchFocus`), a lone single-select question settles on
 *             its pick, every other shape lands on the review phase once
 *             all questions are answered (`enterReview`), and `submit`
 *             resolves the batch with the picks. Esc at ANY point
 *             resolves `[]` (empty selection = the declined envelope
 *             downstream).
 *
 * The `onIdle` hook is the composer-refocus point: it fires every time the
 * overlay set drains to empty — the host re-asserts editor focus there
 * (the login-era bug: an overlay closing and the composer staying blurred).
 */
import type { SeamApprovalVerdict, SeamAskPick, SeamAskQuestion } from "../../seams/session"

export type PendingApproval = { id: number; name: string; args: Record<string, unknown> }
/** Ask batch state: `index` is the focused question tab, `picks` carries
 * the selected labels per question (empty = unanswered), `phase` flips to
 * `review` once every question is answered and the picker shows the
 * before-submit listing. */
export type PendingAsk = {
	id: number
	questions: SeamAskQuestion[]
	index: number
	picks: string[][]
	phase: "questions" | "review"
}

type ApprovalEntry = {
	request: PendingApproval
	resolve: (verdict: SeamApprovalVerdict) => void
}
type AskEntry = PendingAsk & {
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
		if (!head) return undefined
		return { id: head.id, questions: head.questions, index: head.index, picks: head.picks, phase: head.phase }
	}

	get currentQuestion(): SeamAskQuestion | undefined {
		const head = this.#asks[0]
		return head?.questions[head.index]
	}

	/** The seam ask provider body — one batch picker (tui-pi parity). */
	answer(questions: SeamAskQuestion[]): Promise<SeamAskPick[]> {
		if (questions.length === 0) return Promise.resolve([])
		return new Promise((resolve) => {
			this.#asks.push({
				id: ++this.#seq,
				questions,
				index: 0,
				picks: questions.map(() => []),
				phase: "questions",
				resolve,
			})
			this.#changed()
		})
	}

	/**
	 * Space (or Enter on a single-select option): single-select REPLACES the
	 * pick and auto-advances — to the next unanswered tab, or onto the review
	 * phase once everything is answered (a lone single-select batch settles
	 * immediately, the pre-F5 fast path). multiSelect TOGGLES membership and
	 * stays put. No-op on the review phase.
	 */
	toggle(option: string): void {
		const head = this.#asks[0]
		const question = head?.questions[head.index]
		if (!head || !question || head.phase === "review") return
		if (question.multiSelect === true) {
			const current = head.picks[head.index] ?? []
			head.picks[head.index] = current.includes(option)
				? current.filter((label) => label !== option)
				: [...current, option]
			this.#changed()
			return
		}
		head.picks[head.index] = [option]
		// Lone single-select: the pick IS the answer (legacy auto-submit).
		if (head.questions.length === 1) {
			this.#asks.shift()
			head.resolve(this.#envelope(head))
			this.#changed()
			return
		}
		if (this.#allAnswered(head)) {
			head.phase = "review"
		} else {
			// Auto-advance to the nearest later unanswered tab (clamped: the
			// last unanswered question keeps the focus).
			const next = head.questions.findIndex((_, qi) => qi > head.index && head.picks[qi]?.length === 0)
			if (next >= 0) head.index = next
		}
		this.#changed()
	}

	/** ←/→: switch the focused question tab, clamped at both ends. */
	switchFocus(direction: 1 | -1): void {
		const head = this.#asks[0]
		if (!head || head.phase === "review" || head.questions.length < 2) return
		const next = Math.max(0, Math.min(head.questions.length - 1, head.index + direction))
		if (next !== head.index) {
			head.index = next
			this.#changed()
		}
	}

	/**
	 * Enter on the review row / multiSelect confirm: flip to the review
	 * phase — only when every question has an answer (returns false and
	 * leaves the state alone otherwise).
	 */
	enterReview(): boolean {
		const head = this.#asks[0]
		if (!head || head.phase === "review") return false
		if (!this.#allAnswered(head)) return false
		head.phase = "review"
		this.#changed()
		return true
	}

	/** Review → questions (← on the review page, or picking a row to edit). */
	backToQuestions(focus?: number): void {
		const head = this.#asks[0]
		if (!head || head.phase !== "review") return
		head.phase = "questions"
		if (focus !== undefined && focus >= 0 && focus < head.questions.length) head.index = focus
		this.#changed()
	}

	/** Enter on the review page's submit row: resolve the batch. */
	submit(): void {
		const head = this.#asks[0]
		if (!head) return
		this.#asks.shift()
		head.resolve(this.#envelope(head))
		this.#changed()
	}

	#allAnswered(head: AskEntry): boolean {
		return head.picks.every((pick) => pick.length > 0)
	}

	#envelope(head: AskEntry): SeamAskPick[] {
		return head.questions.map((question, qi) => {
			const picks = head.picks[qi] ?? []
			return {
				questionId: question.id,
				selected: picks[0] ?? "",
				...(picks.length > 1 ? { selections: [...picks] } : {}),
			}
		})
	}

	/** Esc at any question: declined envelope — the batch resolves `[]`. */
	decline(): void {
		const head = this.#asks.shift()
		if (!head) return
		head.resolve([])
		this.#changed()
	}
}
