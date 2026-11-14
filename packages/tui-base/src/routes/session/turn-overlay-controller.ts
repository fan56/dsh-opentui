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
 *   custom    free-text answers (tui-pi sentinel parity): every question's
 *             option list ends with a "Type something." sentinel row
 *             (C7); selecting it enters an inline edit (`beginCustom` —
 *             the live buffer rides `customDraft`, null = not editing).
 *             Enter commits (`commitCustom` — non-empty text lands in
 *             `customs[qi]` and CLEARS the picked options, selected ⊕
 *             custom are mutually exclusive, same as tui-pi's
 *             `setCustomAnswer`), Esc discards (`cancelCustomEdit`). A
 *             committed custom counts as an answer for the review gate
 *             and rides the envelope's `Answer.custom` field.
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
 * before-submit listing. `customs` carries the committed free-text answer
 * per question (undefined = none); `customDraft` is the live sentinel
 * edit buffer (null = not editing — tui-pi's `customEditingFor` flattened
 * to one edit at a time, the focused tab owns it). */
export type PendingAsk = {
	id: number
	questions: SeamAskQuestion[]
	index: number
	picks: string[][]
	phase: "questions" | "review"
	customs: (string | undefined)[]
	customDraft: string | null
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
		return {
			id: head.id,
			questions: head.questions,
			index: head.index,
			picks: head.picks,
			phase: head.phase,
			customs: [...head.customs],
			customDraft: head.customDraft,
		}
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
				customs: questions.map(() => undefined),
				customDraft: null,
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
		// The sentinel editor owns the keyboard while engaged (its view
		// replaces the picker, so this never fires from the UI — guard for
		// stray programmatic calls anyway, tui-pi parity).
		if (head.customDraft !== null) return
		// Picking an option clears the question's committed custom answer
		// (selected ⊕ custom are mutually exclusive, tui-pi setCustomAnswer).
		head.customs[head.index] = undefined
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
	 * Enter on the "Type something." sentinel row: open the inline free-text
	 * editor on the focused question (questions phase only). The draft
	 * seeds from the question's committed custom answer so re-editing
	 * keeps the typed text (tui-pi `enterCustomEdit`). Returns false when
	 * the batch is on the review phase — the review page has no sentinel.
	 */
	beginCustom(): boolean {
		const head = this.#asks[0]
		if (!head || head.phase === "review") return false
		head.customDraft = head.customs[head.index] ?? ""
		this.#changed()
		return true
	}

	/** Live sentinel edit: replace the draft buffer. No-op unless editing. */
	patchCustom(text: string): void {
		const head = this.#asks[0]
		if (!head || head.customDraft === null) return
		head.customDraft = text
		this.#changed()
	}

	/**
	 * Enter in the sentinel editor: commit a non-empty trimmed buffer as the
	 * question's custom answer (clearing its picked options — mutual
	 * exclusion), or discard an empty one and return to the picker. A
	 * committed answer then advances exactly like a picked option: a lone
	 * single-select batch settles immediately, otherwise auto-advance to
	 * the next unanswered tab / the review phase (tui-pi parity: the
	 * filled sentinel commits, the empty one just closes the editor).
	 */
	commitCustom(): void {
		const head = this.#asks[0]
		const question = head?.questions[head.index]
		if (!head || !question || head.customDraft === null) return
		const text = head.customDraft.trim()
		head.customDraft = null
		if (text === "") {
			this.#changed()
			return
		}
		head.customs[head.index] = text
		head.picks[head.index] = []
		if (question.multiSelect !== true && head.questions.length === 1) {
			// Lone single-select: the committed custom IS the answer.
			this.#asks.shift()
			head.resolve(this.#envelope(head))
			this.#changed()
			return
		}
		if (this.#allAnswered(head)) {
			head.phase = "review"
		} else {
			const next = head.questions.findIndex((_, qi) => qi > head.index && (head.picks[qi]?.length ?? 0) === 0 && !head.customs[qi])
			if (next >= 0) head.index = next
		}
		this.#changed()
	}

	/** Esc in the sentinel editor: discard the draft, back to the picker. */
	cancelCustomEdit(): void {
		const head = this.#asks[0]
		if (!head || head.customDraft === null) return
		head.customDraft = null
		this.#changed()
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
		return head.questions.every(
			(_, qi) => (head.picks[qi]?.length ?? 0) > 0 || (head.customs[qi] !== undefined && head.customs[qi] !== ""),
		)
	}

	#envelope(head: AskEntry): SeamAskPick[] {
		return head.questions.map((question, qi) => {
			const custom = head.customs[qi]
			if (custom !== undefined && custom !== "") {
				// Free-text answer: no picked options (mutual exclusion), the
				// text rides `custom` (tui-pi Answer.custom contract).
				return { questionId: question.id, selected: "", custom }
			}
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
