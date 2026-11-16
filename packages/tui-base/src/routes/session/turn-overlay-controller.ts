/**
 * TurnOverlayController — the approval/ask queue behind the overlay surfaces
 * (the approval card on the dialog stack + the ask panel in the in-flow dock),
 * pure logic with no Solid or renderer dependency so `bun test` can drive it
 * against a fake seam.
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
 *   custom    free-text answers: the resident inline row (`✎ <input>`) is the
 *             last row of every question (spec §5) and the controller keeps
 *             its live buffer on `customDraft` (null = no live edit) plus the
 *             committed answer on `customs[qi]`. Committing a non-empty buffer
 *             CLEARS the picked options (selected ⊕ custom are mutually
 *             exclusive, tui-pi's `setCustomAnswer`) and rides the envelope's
 *             `Answer.custom` field; an empty commit discards the buffer.
 *             `beginCustom` / `commitCustom` / `cancelCustomEdit` remain the
 *             programmatic entry points the sentinel path used.
 *
 *   surface   the rendering state the dock panel needs: `phase`
 *             (questions / input / review), the per-question option-row
 *             `cursors` and the review-page cursor. The mutators below are the
 *             transitions the key layer drives (`ask-keys.ts`: arrows, digits,
 *             the staged Esc/Ctrl+C ladder — spec §5-§6, ADR-0008); no binding
 *             is registered here.
 *
 * The `onIdle` hook is the composer-refocus point: it fires every time the
 * overlay set drains to empty — the host re-asserts editor focus there
 * (the login-era bug: an overlay closing and the composer staying blurred).
 */
import type { SeamApprovalVerdict, SeamAskPick, SeamAskQuestion } from "../../seams/session"
import {
	askNeedsReview,
	inlineRowIndex,
	questionRowCount,
	recommendedPicks,
} from "./ask-options"

export type PendingApproval = { id: number; name: string; args: Record<string, unknown> }

/**
 * The ask surface's phase (spec §5, §8). `questions` = the option list owns
 * the cursor; `input` = the resident inline row owns it (its row is ALWAYS
 * painted, phase only says who has focus); `review` = the review page.
 * The Esc ladder that walks these phases is the key-layer task; this enum is
 * only what the renderer needs.
 */
export type AskPhase = "questions" | "input" | "review"

/** Ask batch state: `index` is the focused question tab, `picks` carries
 * the selected labels per question (empty = unanswered; recommended options
 * are pre-selected at open, spec §4), `phase` says which surface owns the
 * interactive focus. `customs` carries the committed free-text answer per
 * question (undefined = none); `customDraft` is the live inline buffer
 * (null = no live edit — the committed answer still paints when it exists).
 * `cursors` is the option-row cursor per question (option rows, then the
 * review row when painted, then the resident inline row — see
 * `questionRowCount`); `reviewCursor` is the review page's row cursor
 * (question rows, then Submit). */
export type PendingAsk = {
	id: number
	questions: SeamAskQuestion[]
	index: number
	picks: string[][]
	phase: AskPhase
	customs: (string | undefined)[]
	customDraft: string | null
	cursors: number[]
	reviewCursor: number
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

	/** Queue depths for the admission slot's "N more waiting" indicator
	 * (spec §7). Both queues are FIFO over the shared monotonic id, so pending
	 * interactions behind the shown head are exactly these counts minus one
	 * for whichever kind holds the slot. */
	get pendingApprovalCount(): number {
		return this.#approvals.length
	}
	get pendingAskCount(): number {
		return this.#asks.length
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
				cursors: [...head.cursors],
				reviewCursor: head.reviewCursor,
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
				// Recommended options are pre-selected in the draft (spec §4);
				// pre-selection never submits — the batch still needs a commit.
				picks: questions.map((question) => recommendedPicks(question)),
				// A zero-option question has no list-focus state (spec §2): the
				// dock opens with the resident inline row focused.
				phase: questions[0]?.options.length === 0 ? "input" : "questions",
				customs: questions.map(() => undefined),
				customDraft: null,
				cursors: questions.map(() => 0),
				reviewCursor: 0,
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
		// The phase is the ONLY gate: `input` owns the keys (digits type
		// digits), `review` has no list. A live draft alone must not block a
		// pick — Esc stage 1 (`focusOptions`) hands the keys back to the list
		// without discarding the buffer, and the pick below clears it, exactly
		// as the mutual-exclusion comment says.
		if (head.phase === "input") return
		// Picking an option clears the question's committed custom answer
		// (selected ⊕ custom are mutually exclusive, tui-pi setCustomAnswer)
		// and any live inline text.
		head.customs[head.index] = undefined
		head.customDraft = null
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
			head.reviewCursor = 0
		} else {
			// Auto-advance to the nearest later unanswered tab (clamped: the
			// last unanswered question keeps the focus). A committed free-text
			// answer counts as answered, exactly as in `confirmQuestion`,
			// `commitCustom` and `#allAnswered`.
			const next = head.questions.findIndex(
				(_, qi) => qi > head.index && (head.picks[qi]?.length ?? 0) === 0 && !head.customs[qi],
			)
			if (next >= 0) head.index = next
			// A zero-option question has no list-focus state (spec §2).
			head.phase = head.questions[head.index]?.options.length === 0 ? "input" : "questions"
			if (head.phase === "input") {
				const question = head.questions[head.index]
				if (question !== undefined) {
					head.cursors[head.index] = inlineRowIndex(question, askNeedsReview(head.questions))
				}
			}
		}
		this.#changed()
	}

	/** ←/→: switch the focused question tab, clamped at both ends. The inline
	 * input owns Left/Right while it is focused (spec §5) — the key layer
	 * releases those keys, this guard is the controller-side mirror. A
	 * zero-option question has no list at all (its input IS the question), so
	 * the Esc ladder's previous-question stage may still leave it. */
	switchFocus(direction: 1 | -1): void {
		const head = this.#asks[0]
		if (!head || head.phase === "review" || head.questions.length < 2) return
		if (head.phase === "input" && (head.questions[head.index]?.options.length ?? 0) > 0) return
		const next = Math.max(0, Math.min(head.questions.length - 1, head.index + direction))
		if (next === head.index) return
		head.index = next
		// A zero-option question has no list-focus state: it opens on the
		// resident inline row (spec §2).
		const question = head.questions[next]
		head.phase = question?.options.length === 0 ? "input" : "questions"
		if (head.phase === "input" && question !== undefined) {
			head.cursors[next] = inlineRowIndex(question, askNeedsReview(head.questions))
		}
		this.#changed()
	}

	/**
	 * Enter on a multi-select question (spec §6): confirm the draft as it
	 * stands and advance — the next unanswered question, else the review page.
	 * The picks are NOT touched here; Space is the toggle. Batches that have no
	 * review page (a lone single-select question) settle through `toggle()`
	 * instead, so this refuses them.
	 */
	confirmQuestion(): boolean {
		const head = this.#asks[0]
		if (!head || head.phase === "review" || head.phase === "input") return false
		const question = head.questions[head.index]
		if (question === undefined || !askNeedsReview(head.questions)) return false
		const next = head.questions.findIndex(
			(_, qi) => qi > head.index && (head.picks[qi]?.length ?? 0) === 0 && !head.customs[qi],
		)
		if (next >= 0) {
			head.index = next
			const target = head.questions[next]
			head.phase = target?.options.length === 0 ? "input" : "questions"
			if (head.phase === "input" && target !== undefined) {
				head.cursors[next] = inlineRowIndex(target, askNeedsReview(head.questions))
			}
		} else {
			// No later question left: the confirm advances onto the review page.
			head.phase = "review"
			head.reviewCursor = 0
		}
		this.#changed()
		return true
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
		const question = head.questions[head.index]
		head.customDraft = head.customs[head.index] ?? ""
		head.phase = "input"
		if (question !== undefined) {
			head.cursors[head.index] = inlineRowIndex(question, askNeedsReview(head.questions))
		}
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
			// An empty commit discards the buffer and hands focus back to the
			// list (a zero-option question has no list: it stays on the input).
			this.#backToList(head)
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
			head.reviewCursor = 0
		} else {
			const next = head.questions.findIndex((_, qi) => qi > head.index && (head.picks[qi]?.length ?? 0) === 0 && !head.customs[qi])
			if (next >= 0) head.index = next
			head.phase = head.questions[head.index]?.options.length === 0 ? "input" : "questions"
		}
		this.#changed()
	}

	/** Esc in the sentinel editor: discard the draft, back to the picker. */
	cancelCustomEdit(): void {
		const head = this.#asks[0]
		if (!head || head.customDraft === null) return
		head.customDraft = null
		this.#backToList(head)
		this.#changed()
	}

	// ---- ask surface state (rendering: cursors / inline focus) ---------
	//
	// `ask-keys.ts` translates keys into these transitions (spec §5-§6);
	// the controller stays renderer-free and registers no binding.

	/** The resident inline row's text: the live buffer while an edit is in
	 * progress, else the question's committed custom answer. */
	get inlineText(): string {
		const head = this.#asks[0]
		if (!head) return ""
		if (head.customDraft !== null) return head.customDraft
		return head.customs[head.index] ?? ""
	}

	/** Input event path: replace the inline buffer. The first character starts
	 * the edit and parks the cursor on the inline row (the input only receives
	 * keys while it is focused). */
	setInlineText(text: string): void {
		const head = this.#asks[0]
		const question = head?.questions[head.index]
		if (!head || !question || head.phase === "review") return
		// A controlled `InputRenderable` emits `input` when its `value` prop
		// changes programmatically, so clearing the rendered row (a pick or a
		// commit set `customDraft` back to null) arrives here as "". With no
		// live edit the model already owns the row: re-activating the input
		// phase here would steal the keys back after every pick.
		if (head.customDraft === null && text === "") return
		head.customDraft = text
		head.phase = "input"
		head.cursors[head.index] = inlineRowIndex(question, askNeedsReview(head.questions))
		this.#changed()
	}

	/** Park the cursor on the inline row and give it the phase (spec §5). */
	focusInput(): void {
		const head = this.#asks[0]
		const question = head?.questions[head.index]
		if (!head || !question || head.phase === "review") return
		head.phase = "input"
		head.cursors[head.index] = inlineRowIndex(question, askNeedsReview(head.questions))
		this.#changed()
	}

	/** Release the inline row without committing (spec §5 Esc stage 1): focus
	 * returns to the list, the buffer and the committed answer are untouched.
	 * A zero-option question has no list — the phase stays on the input. */
	focusOptions(): void {
		const head = this.#asks[0]
		if (!head || head.phase !== "input") return
		this.#backToList(head)
		this.#changed()
	}

	/** Move the option-row cursor to an absolute row (option rows, then the
	 * review row, then the inline row — see `questionRowCount`). Landing on
	 * the inline row gives it focus (spec §5 focus model). */
	setCursor(row: number): void {
		const head = this.#asks[0]
		const question = head?.questions[head.index]
		if (!head || !question || head.phase === "review") return
		const needsReview = askNeedsReview(head.questions)
		const inline = inlineRowIndex(question, needsReview)
		const next = Math.max(0, Math.min(inline, Math.floor(row)))
		head.cursors[head.index] = next
		head.phase = next === inline ? "input" : "questions"
		this.#changed()
	}

	/** Move the option-row cursor by a delta, clamped at both ends. */
	moveCursor(delta: number): void {
		const head = this.#asks[0]
		const question = head?.questions[head.index]
		if (!head || !question || head.phase === "review") return
		const needsReview = askNeedsReview(head.questions)
		const last = questionRowCount(question, needsReview) - 1
		const next = Math.max(0, Math.min(last, (head.cursors[head.index] ?? 0) + delta))
		head.cursors[head.index] = next
		head.phase = next === inlineRowIndex(question, needsReview) ? "input" : "questions"
		this.#changed()
	}

	/** Review-page cursor: 0..questions.length (the last row is Submit). */
	setReviewCursor(row: number): void {
		const head = this.#asks[0]
		if (!head || head.phase !== "review") return
		const next = Math.max(0, Math.min(head.questions.length, Math.floor(row)))
		if (next === head.reviewCursor) return
		head.reviewCursor = next
		this.#changed()
	}

	/** Move the review-page cursor by a delta, clamped at both ends. */
	moveReviewCursor(delta: number): void {
		this.setReviewCursor((this.#asks[0]?.reviewCursor ?? 0) + delta)
	}

	/** Hand focus from the inline row back to the option list when the
	 * question has one (zero-option questions keep the input, spec §2). */
	#backToList(head: AskEntry): void {
		const question = head.questions[head.index]
		if (question === undefined) return
		if (question.options.length === 0) {
			head.phase = "input"
			return
		}
		head.phase = "questions"
		const inline = inlineRowIndex(question, askNeedsReview(head.questions))
		head.cursors[head.index] = Math.min(head.cursors[head.index] ?? 0, Math.max(0, inline - 1))
	}

	/**
	 * Enter on the trailing review row / multiSelect confirm: flip to the
	 * review page. Available for every batch that NEEDS one (≥ 2 questions or
	 * any multiSelect — spec §8: the row makes the page reachable before every
	 * question is answered, and the review rows carry their unanswered state).
	 * A lone single-select batch has no review page (it settles on its pick),
	 * so this returns false there. The Submit row still resolves whatever is
	 * answered.
	 */
	enterReview(): boolean {
		const head = this.#asks[0]
		if (!head || head.phase === "review") return false
		if (!askNeedsReview(head.questions)) return false
		head.phase = "review"
		head.reviewCursor = 0
		this.#changed()
		return true
	}

	/** Review → questions (← on the review page, or picking a row to edit). */
	backToQuestions(focus?: number): void {
		const head = this.#asks[0]
		if (!head || head.phase !== "review") return
		head.phase = "questions"
		if (focus !== undefined && focus >= 0 && focus < head.questions.length) head.index = focus
		const question = head.questions[head.index]
		// Editing a zero-option question lands on its resident inline row.
		if (question !== undefined && question.options.length === 0) head.phase = "input"
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
