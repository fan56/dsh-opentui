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
 *             ONE live buffer PER QUESTION (`customDrafts[qi]`, null = no live
 *             edit) plus the committed answer on `customs[qi]`. The buffer is
 *             question-scoped: an uncommitted draft typed on question N never
 *             paints on question M, and committing M never touches N's draft.
 *             Committing a non-empty buffer
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

export type PendingApproval = {
	id: number
	name: string
	args: Record<string, unknown>
	/** ADR-0011: the bridge ask this card answers, when one is attached. Used
	 *  by `syncPendingAsks()` to close a card the host cancelled/settled. */
	eventId?: string
	/** Host granted escalation: the card may offer `always` / `session`. Never
	 *  inferred from args (the seam's approval args carry no escalation bit). */
	escalation: boolean
	/** A6: set when a REBUILT card's ask.response failed because the ask/turn is
	 *  gone. Terminal state — the card shows the reason and only acknowledges;
	 *  it is never silently dropped and never treated as an approval. */
	invalidatedReason?: string
}

/** The read-only slice of the ADR-0011 reconnect snapshot the controller
 *  needs. Structural on purpose: tui-base does not import the shell seam. */
export type BridgeAskSnapshot = {
	eventId: string
	kind: string
	toolName?: string
	callId?: string
	reason?: string
	escalation?: boolean
	/** Question rows of a `kind:"questions"` ask. Used to correlate the
	 *  provider's `answer(questions)` call to its seam entry so a host cancel /
	 *  turn end can close the panel (ADR-0011 T5b). */
	questions?: SeamAskQuestion[]
}

/** `always` / `session` are the two escalated behaviors the bridge wire
 *  accepts when the host granted escalation. The seam declares only the two
 *  base verdicts on `onApprove`; the widened strings travel through the same
 *  promise and are gated on `escalation` before a frame is ever sent. */
export type BridgeApprovalVerdict = SeamApprovalVerdict | "always" | "session"

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
 * question (undefined = none); `customDraft` is the FOCUSED question's live
 * inline buffer (derived from the per-question buffers — null = no live edit,
 * the committed answer still paints when it exists).
 * `cursors` is the option-row cursor per question (option rows, then the
 * review row when painted, then the resident inline row — see
 * `questionRowCount`); `listCursors` remembers the last LIST position (option
 * or review row) so the list keeps a marker while the inline input owns the
 * phase; `reviewCursor` is the review page's row cursor (question rows, then
 * Submit). */
export type PendingAsk = {
	id: number
	/** ADR-0011 T5b: the bridge ask this batch answers, when correlated from
	 *  the read-only snapshot. Lets `syncPendingAsks()` close a panel whose host
	 *  ask was cancelled / settled without a UI frame. */
	eventId?: string
	questions: SeamAskQuestion[]
	index: number
	picks: string[][]
	phase: AskPhase
	customs: (string | undefined)[]
	customDraft: string | null
	cursors: number[]
	listCursors: number[]
	reviewCursor: number
}

type ApprovalEntry = {
	request: PendingApproval
	resolve: (verdict: BridgeApprovalVerdict) => void
}
/** The stored batch keeps one live inline buffer PER QUESTION. The public
 * snapshot above derives `customDraft` for the focused question only, so a
 * draft typed on question N can never leak onto M (D4). */
type AskEntry = Omit<PendingAsk, "customDraft"> & {
	customDrafts: (string | null)[]
	resolve: (picks: SeamAskPick[]) => void
}

/** Content signature correlating a provider `answer(questions)` call to its
 *  seam entry. Ids plus every rendered field are included so two concurrent
 *  asks with different questions never borrow each other's eventId (a wrong
 *  match could cancel the wrong panel). */
function askSignature(questions: readonly SeamAskQuestion[]): string {
	return JSON.stringify(
		questions.map((question) => [
			question.id,
			question.prompt,
			question.header,
			question.description,
			question.detail,
			question.multiSelect === true,
			question.options.map((option) => [option.label, option.description]),
		]),
	)
}

export class TurnOverlayController {
	#approvals: ApprovalEntry[] = []
	#asks: AskEntry[] = []
	#seq = 0
	#listeners = new Set<() => void>()
	#idleHandlers = new Set<() => void>()
	#busy = false
	/** ADR-0011 read-only seam snapshot accessor. Absent seams (FakeSeam,
	 *  plain view tests) never sync — `syncPendingAsks()` is a no-op there. */
	#pendingAsks: (() => readonly BridgeAskSnapshot[]) | undefined

	subscribe(fn: () => void): () => void {
		this.#listeners.add(fn)
		return () => this.#listeners.delete(fn)
	}

	/** Attach the seam's `pendingAsks()` snapshot (wired by
	 *  `registerTurnOverlays`). Read-only: the controller never sends frames. */
	attachPendingAsks(read: () => readonly BridgeAskSnapshot[]): void {
		this.#pendingAsks = read
	}

	/**
	 * A6 — terminal "已失效" state for a rebuilt card whose `ask.response`
	 * failed (ASK_UNKNOWN_REQUEST / ASK_TURN_ENDED). Any still-open card for the
	 * same eventId is first dropped fail-closed (never counted as an answer),
	 * then a terminal approval card carrying the reason is queued. The eventId
	 * is preserved so the card stays traceable to the dead ask. The host renders
	 * `invalidatedReason` as the reason text + an acknowledge-only action.
	 */
	invalidateAsk(eventId: string, reason: string): void {
		if (eventId === "") return
		// RM-2b V3: a dead-bridge invalidation resolves every pending card
		// fail-closed, which makes the seam send ask.response on a DEAD bridge.
		// That response fails with BRIDGE_DEAD and re-emits bridge.ask.invalidated
		// for the SAME eventId. A terminal card already carrying this eventId is
		// the desired end state — ignore the duplicate rather than repaint it
		// (which would flicker and overwrite the localized disconnected reason).
		if (
			this.#approvals.some(
				(entry) => entry.request.invalidatedReason !== undefined && entry.request.eventId === eventId,
			)
		) return
		// Drop any open card for this ask without treating it as a verdict/pick.
		this.#approvals = this.#approvals.filter((entry) => {
			if (entry.request.eventId !== eventId) return true
			entry.resolve("rejected")
			return false
		})
		this.#asks = this.#asks.filter((entry) => {
			if (entry.eventId !== eventId) return true
			entry.resolve([])
			return false
		})
		this.#approvals.push({
			request: {
				id: ++this.#seq,
				name: "ask",
				args: {},
				eventId,
				escalation: false,
				invalidatedReason: reason,
			},
			resolve: () => { /* terminal: acknowledgement is the only action */ },
		})
		this.#changed()
	}

	/**
	 * RM-2b V3 — bridge process death invalidates EVERY ask inside that bridge.
	 * Called on `bridge.dead`: every still-pending approval card / question panel
	 * becomes a terminal "已失效" card carrying `reason` (connection lost), and
	 * every underlying ask promise is resolved fail-closed (approval → rejected,
	 * questions → declined) so no waiter dangles and no answer is implicit.
	 *
	 * During DEAD the terminal cards STAY on screen (never silently dropped);
	 * their only action is acknowledgement, and eventIds are preserved where
	 * known so they remain traceable to the dead asks. They are TRANSIENT, not
	 * permanent: a successful recovery rebuilds the session's pending-ask set
	 * and the cards are cleared with it (RM-2c observed ≤200ms after recovery),
	 * so there is no stale-card residue once the session is live again. A
	 * follow-up BRIDGE_DEAD `bridge.ask.invalidated` is deduped by
	 * `invalidateAsk`'s terminal guard while DEAD still holds.
	 */
	invalidateAll(reason: string): void {
		if (reason === "") return
		const open = this.#approvals.length + this.#asks.length
		if (open === 0) return

		const terminals: ApprovalEntry[] = []
		for (const entry of this.#approvals) {
			terminals.push({
				request: {
					id: ++this.#seq,
					name: "ask",
					args: {},
					...(entry.request.eventId !== undefined ? { eventId: entry.request.eventId } : {}),
					escalation: false,
					invalidatedReason: reason,
				},
				resolve: () => { /* terminal: acknowledgement is the only action */ },
			})
		}
		for (const entry of this.#asks) {
			terminals.push({
				request: {
					id: ++this.#seq,
					name: "ask",
					args: {},
					...(entry.eventId !== undefined ? { eventId: entry.eventId } : {}),
					escalation: false,
					invalidatedReason: reason,
				},
				resolve: () => { /* terminal: acknowledgement is the only action */ },
			})
		}
		// Resolve the originals fail-closed BEFORE swapping the queues, so a
		// consumer awaiting an answer never hangs and never gets an implicit allow.
		for (const entry of this.#approvals) entry.resolve("rejected")
		for (const entry of this.#asks) entry.resolve([])
		this.#approvals = terminals
		this.#asks = []
		this.#changed()
	}

	/** A6: read-only invalidated cards (eventId → reason), for view/tests. */
	pendingInvalidated(): ReadonlyMap<string, string> {
		const out = new Map<string, string>()
		for (const entry of this.#approvals) {
			if (entry.request.invalidatedReason !== undefined && entry.request.eventId !== undefined) {
				out.set(entry.request.eventId, entry.request.invalidatedReason)
			}
		}
		return out
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

	/** View-side entry — what `SeamTurnCallbacks.onApprove` awaits. The bridge
	 *  seam calls this with `(toolName, {callId, reason})` when an
	 *  `ask.request{kind:"approval"}` lands mid-turn; the matching snapshot row
	 *  supplies `eventId` (for cancellation sync) and `escalation` (for the
	 *  optional always/session actions). No snapshot / no match → a plain
	 *  allow-once/reject card, never an implicit widen. */
	requestApproval(name: string, args: Record<string, unknown>): Promise<SeamApprovalVerdict> {
		const ask = this.#matchApproval(name, args)
		const promise = new Promise<BridgeApprovalVerdict>((resolve) => {
			this.#approvals.push({
				request: {
					id: ++this.#seq,
					name,
					args,
					escalation: ask?.escalation === true,
					...(ask !== undefined ? { eventId: ask.eventId } : {}),
				},
				resolve,
			})
			this.#changed()
		})
		// The seam honours the widened strings at runtime; keep the declared
		// onApprove surface at SeamApprovalVerdict for every existing caller.
		return promise as Promise<SeamApprovalVerdict>
	}

	/** Correlate an onApprove call to its `pendingAsks()` row. The seam's
	 *  approval args carry `callId` / `reason` but not `eventId`, so match the
	 *  most specific key available and fall back only for an unambiguous
	 *  single approval — a wrong match would offer an ungranted escalation. */
	#matchApproval(name: string, args: Record<string, unknown>): BridgeAskSnapshot | undefined {
		const asks = (this.#pendingAsks?.() ?? []).filter((ask) => ask.kind === "approval")
		if (asks.length === 0) return undefined
		const callId = typeof args.callId === "string" ? args.callId : undefined
		if (callId !== undefined) {
			// callId is a strong identifier: a mismatch means NO match. Falling
			// back to a name-only match here could borrow another ask's
			// escalation flag and offer an ungranted behavior.
			const byCall = asks.filter((ask) => ask.callId === callId)
			return byCall.length > 0 ? byCall[byCall.length - 1] : undefined
		}
		const reason = typeof args.reason === "string" ? args.reason : undefined
		const byName = asks.filter(
			(ask) => (ask.toolName ?? "tool") === name && (reason === undefined || ask.reason === reason),
		)
		if (byName.length > 0) return byName[byName.length - 1]
		return asks.length === 1 ? asks[0] : undefined
	}

	/** Enter / confirm button. */
	confirmApproval(): void {
		this.#settleApproval("allowed-once")
	}

	/** Cancel button / esc — fail-closed: the tool is denied, never allowed. */
	rejectApproval(): void {
		this.#settleApproval("rejected")
	}

	/** Escalated actions, only offered on a card whose ask granted escalation.
	 *  A call without escalation is a no-op (no frame, no silent widen). */
	approveAlways(): void {
		this.#settleEscalated("always")
	}

	approveSession(): void {
		this.#settleEscalated("session")
	}

	#settleEscalated(verdict: "always" | "session"): void {
		if (this.#approvals[0]?.request.escalation !== true) return
		this.#settleApproval(verdict)
	}

	#settleApproval(verdict: BridgeApprovalVerdict): void {
		const head = this.#approvals.shift()
		if (!head) return
		head.resolve(verdict)
		this.#changed()
	}

	/**
	 * ADR-0011: reconcile BOTH overlay queues with the seam's read-only
	 * snapshot. When the host cancels / settles / replaces an ask (`ask.cancel`,
	 * `ask.settled`, timeout, turn end, `ask.pending` reconnect snapshot), the
	 * seam drops its local entry. A card / panel still on screen for that
	 * eventId closes fail-closed — approvals resolve `rejected`, questions
	 * resolve `[]` (the declined envelope) — no ghost card/panel, no dangling
	 * promise, never an implicit allow. No accessor (non-bridge seams) = no-op.
	 */
	syncPendingAsks(): void {
		if (this.#pendingAsks === undefined) return
		const asks = this.#pendingAsks()
		let changed = false

		const approvalsBefore = this.#approvals.length
		this.#approvals = this.#approvals.filter((entry) => {
			if (this.#approvalStillPending(entry.request, asks)) return true
			entry.resolve("rejected")
			return false
		})
		if (this.#approvals.length !== approvalsBefore) changed = true

		const questionsBefore = this.#asks.length
		this.#asks = this.#asks.filter((entry) => {
			if (this.#questionStillPending(entry, asks)) return true
			entry.resolve([]) // fail-closed: empty picks = declined downstream
			return false
		})
		if (this.#asks.length !== questionsBefore) changed = true

		if (changed) this.#changed()
	}

	#approvalStillPending(request: PendingApproval, asks: readonly BridgeAskSnapshot[]): boolean {
		if (request.eventId !== undefined) return asks.some((ask) => ask.eventId === request.eventId)
		// Unmatched card (no eventId): keep it unless there are NO approval asks
		// left at all. Conservative — an active card is never closed on a maybe.
		return asks.some((ask) => ask.kind === "approval")
	}

	#questionStillPending(entry: AskEntry, asks: readonly BridgeAskSnapshot[]): boolean {
		if (entry.eventId !== undefined) return asks.some((ask) => ask.eventId === entry.eventId)
		// Unmatched panel (no eventId): keep it unless NO questions asks remain.
		return asks.some((ask) => ask.kind === "questions")
	}

	/** Turn terminal / session close sweep (A1/D5): close every card fail-closed. */
	cancelAllApprovals(): void {
		if (this.#approvals.length === 0) return
		const entries = this.#approvals.splice(0)
		for (const entry of entries) entry.resolve("rejected")
		this.#changed()
	}

	/** Turn terminal / session close sweep for questions (A1/D5): resolve every
	 *  pending batch with the declined envelope — fail-closed, never silent. */
	cancelAllAsks(): void {
		if (this.#asks.length === 0) return
		const entries = this.#asks.splice(0)
		for (const entry of entries) entry.resolve([])
		this.#changed()
	}

	// ---- ask ----------------------------------------------------------

	get pendingAsk(): PendingAsk | undefined {
		const head = this.#asks[0]
		if (!head) return undefined
			return {
				id: head.id,
				...(head.eventId !== undefined ? { eventId: head.eventId } : {}),
				questions: head.questions,
				index: head.index,
				picks: head.picks,
				phase: head.phase,
				customs: [...head.customs],
				customDraft: head.customDrafts[head.index] ?? null,
				cursors: [...head.cursors],
				listCursors: [...head.listCursors],
				reviewCursor: head.reviewCursor,
			}
		}

	get currentQuestion(): SeamAskQuestion | undefined {
		const head = this.#asks[0]
		return head?.questions[head.index]
	}

	/**
	 * Correlate a provider `answer(questions)` call to a `kind:"questions"` row
	 * in the read-only snapshot. The seam passes only the question rows (no
	 * eventId), so match on their full content; an eventId already held by an
	 * open panel is skipped so two concurrent identical asks get distinct
	 * entries. A single unclaimed questions ask is a safe fallback; anything
	 * more ambiguous stays uncorrelated (conservative sync keeps that panel).
	 */
	#matchAsk(questions: SeamAskQuestion[]): BridgeAskSnapshot | undefined {
		const asks = (this.#pendingAsks?.() ?? []).filter((ask) => ask.kind === "questions")
		if (asks.length === 0) return undefined
		const claimed = new Set(this.#asks.map((entry) => entry.eventId))
		const available = asks.filter((ask) => !claimed.has(ask.eventId))
		if (available.length === 0) return undefined
		const signature = askSignature(questions)
		const exact = available.filter((ask) => askSignature(ask.questions ?? []) === signature)
		if (exact.length > 0) return exact[0]
		return available.length === 1 ? available[0] : undefined
	}

	/** The seam ask provider body — one batch picker (tui-pi parity). */
	answer(questions: SeamAskQuestion[]): Promise<SeamAskPick[]> {
		if (questions.length === 0) return Promise.resolve([])
		const ask = this.#matchAsk(questions)
		return new Promise((resolve) => {
			this.#asks.push({
				id: ++this.#seq,
				...(ask !== undefined ? { eventId: ask.eventId } : {}),
				questions,
				index: 0,
				// Recommended options are pre-selected in the draft (spec §4);
				// pre-selection never submits — the batch still needs a commit.
				picks: questions.map((question) => recommendedPicks(question)),
				// A zero-option question has no list-focus state (spec §2): the
				// dock opens with the resident inline row focused.
				phase: questions[0]?.options.length === 0 ? "input" : "questions",
				customs: questions.map(() => undefined),
				customDrafts: questions.map(() => null),
				cursors: questions.map(() => 0),
				listCursors: questions.map(() => 0),
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
		// and ITS live inline text only — a draft on another question stays.
		head.customs[head.index] = undefined
		head.customDrafts[head.index] = null
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
		head.customDrafts[head.index] = head.customs[head.index] ?? ""
		head.phase = "input"
		if (question !== undefined) {
			head.cursors[head.index] = inlineRowIndex(question, askNeedsReview(head.questions))
		}
		this.#changed()
		return true
	}

	/** Live sentinel edit: replace the draft buffer. No-op unless the focused
	 * question is being edited. */
	patchCustom(text: string): void {
		const head = this.#asks[0]
		if (!head || head.customDrafts[head.index] === null) return
		head.customDrafts[head.index] = text
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
		if (!head || !question) return
		const draft = head.customDrafts[head.index] ?? null
		if (draft === null) return
		const text = draft.trim()
		head.customDrafts[head.index] = null
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
		if (!head || head.customDrafts[head.index] === null) return
		head.customDrafts[head.index] = null
		this.#backToList(head)
		this.#changed()
	}

	// ---- ask surface state (rendering: cursors / inline focus) ---------
	//
	// `ask-keys.ts` translates keys into these transitions (spec §5-§6);
	// the controller stays renderer-free and registers no binding.

	/** The resident inline row's text for the FOCUSED question: its live
	 * buffer while an edit is in progress, else its committed custom answer.
	 * Another question's draft is never returned (D4). */
	get inlineText(): string {
		const head = this.#asks[0]
		if (!head) return ""
		const draft = head.customDrafts[head.index]
		if (draft !== null && draft !== undefined) return draft
		return head.customs[head.index] ?? ""
	}

	/** Input event path: replace the focused question's inline buffer. The
	 * first character starts the edit and parks the cursor on the inline row
	 * (the input only receives keys while it is focused). */
	setInlineText(text: string): void {
		const head = this.#asks[0]
		const question = head?.questions[head.index]
		if (!head || !question || head.phase === "review") return
		// A controlled `InputRenderable` emits `input` when its `value` prop
		// changes programmatically, so clearing the rendered row (a pick or a
		// commit set the buffer back to null) arrives here as "". With no
		// live edit the model already owns the row: re-activating the input
		// phase here would steal the keys back after every pick.
		if ((head.customDrafts[head.index] ?? null) === null && text === "") return
		head.customDrafts[head.index] = text
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
		// Landing on the inline row does not forget the list position: the
		// panel keeps a muted marker on it while the input owns the phase.
		if (next !== inline) head.listCursors[head.index] = next
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
		const inline = inlineRowIndex(question, needsReview)
		head.cursors[head.index] = next
		head.phase = next === inline ? "input" : "questions"
		if (next !== inline) head.listCursors[head.index] = next
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
		// Restore the remembered LIST row (not "the last row before the
		// inline input"): Esc out of the resident input returns the list to
		// where the user left it.
		const row = Math.max(0, Math.min(inline - 1, head.listCursors[head.index] ?? 0))
		head.cursors[head.index] = row
		head.listCursors[head.index] = row
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
