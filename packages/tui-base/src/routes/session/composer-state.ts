/**
 * Composer state — the seam-driven composer's decision core (batch 4),
 * split out of session-composer.tsx so submit/busy/history unit tests run without
 * a renderer. The Solid component is a thin shell over this controller.
 *
 * Busy semantics mirror the vendored prompt (component/prompt/index.tsx
 * `submit()`): Enter during a running turn is NOT disabled. The view asks the
 * user (dialog stack) whether to STEER the running turn or QUEUE the line for
 * the next turn; the controller consumes that answer through
 * `chooseDelivery` and owns the client-side queue (the seam has no queue
 * primitive — `steer` is the only busy-side wire call).
 *
 * Queue contract:
 *   - queued lines are sent strictly in submission order, ONE per turn end
 *     (the next line starts only after the previous turn settles);
 *   - a failed or aborted turn PAUSES the pump and KEEPS the queue (a
 *     user-visible `⏸` line stays; the next successful turn end resumes it);
 *   - `flushQueue()` is the explicit "deliver it NOW" trigger: a paused queue
 *     is pumped again immediately, in order (the /flush command);
 *   - a session switch calls `resetDeliveries()` (queue and receipt lines are
 *     per-session state, never carried across).
 *
 * Steer contract: the injected line gets a `⤵` receipt row that flips to
 * `✓` (delivered) ONLY when the SAME turn that accepted it settles cleanly.
 * Each accepted steer is tagged with the turn generation that owns it; a
 * failed/aborted turn leaves its rows "injected", and the next generation
 * never promotes those stale rows. The transcript paints both states from
 * `pendingRows` (the row shape is unchanged); nothing here animates.
 *
 * History recall is shell-style, aligned with the pi editor
 * (`dsh-tui-pi` pi-tui `navigateHistory`) and the mini composer
 * (`mini/prompt.shared.ts movePromptHistory`), in-memory only (the vendored
 * provider persists to prompt-history.jsonl — the shell adapter may add
 * persistence later):
 *
 *   `index === null` is the draft (not browsing). ↑ stashes the CURRENT
 *   buffer — empty or typed, multi-line included, WITH its cursor offset (pi
 *   stashes the whole editor state via `structuredClone(this.state)`) — and
 *   walks newest → oldest; ↓ walks back and, past the newest entry, restores
 *   that draft and its cursor instead of clobbering it with "". Neither end
 *   wraps: ↑ past the oldest and ↓ past the draft are no-ops.
 *
 * This deliberately replaces the earlier vendored `prompt/history.tsx`
 * `move()` port, which compared the buffer against `entries[0]` and refused
 * to recall once the user had typed a draft (the reported "↑ does nothing
 * when I typed something" gap).
 */
import type { SeamSessionEvent, SeamSteerResult } from "../../seams/session"

export const MAX_HISTORY_ENTRIES = 50

/** Turn-error codes that mean an abort / closed session rather than a genuine
 *  turn failure. The bridge emits these as `turn.error` (relayed to the page as
 *  `session.error`); abort/close resolves the awaited turn WITHOUT a send
 *  rejection, so the controller needs the code to classify them. The terminal
 *  stop shapes include an explicit abort, a user abort, a closed/resumed/forked
 *  session, an interrupted turn, and an abort with no live turn to cancel. Any
 *  other code (INTERNAL, BLOCKED, …) is a failure. */
export function isAbortTurnCode(code: string | undefined): boolean {
	return (
		code === "ABORTED" ||
		code === "USER_ABORT" ||
		code === "SESSION_CLOSED" ||
		code === "FORKED" ||
		code === "INTERRUPTED" ||
		code === "TURN_ABORT_NOOP"
	)
}

/**
 * Turn outcome tracker — the page's renderer-free classification of the seam
 * turn that just settled (oldfox 终审收口).
 *
 * The bridge resolves the awaited `session.send` on `turn.error` / abort
 * WITHOUT rejecting the send promise, so `ComposerController` cannot tell a
 * failed or aborted turn from a successful one on its own. This tracker reads
 * the seam's event stream instead:
 *
 *   `session.updated{ turn: "starting", turnId }` → arm that turn id
 *   `session.error{ turnId, code }`               → terminal failed / aborted
 *   `bridge.turn.terminal{ turnId, terminalType, reason }`
 *       `terminalType:"turn/error"`               → failed / aborted by reason.code
 *       `terminalType:"turn/end"`                 → clean end (no failure)
 *   `bridge.turn.interrupted{ turnId }`           → terminal aborted
 *
 * A terminal event counts ONLY when its `turnId` equals the armed id: a late
 * error from a prior turn must not poison the new one. `beginTurn()` (called
 * at each send) disarms the id and clears the terminal outcome. Plain,
 * non-reactive state — both getters are read at turn settle by the controller,
 * so no signal is needed. Unit-testable with plain `{ type, details }` events.
 */
export class TurnOutcomeTracker {
	/** The turn id armed by `session.updated{turn:"starting"}` for this send. */
	private activeTurnId: string | undefined
	/** Terminal classification of the armed turn (unset while it runs). */
	private outcome: "failed" | "aborted" | undefined

	/** A new send: forget the previous turn id AND its terminal outcome. */
	beginTurn(): void {
		this.activeTurnId = undefined
		this.outcome = undefined
	}

	/** Feed one seam event. Only turn-scoped events for the armed id classify. */
	onEvent(event: SeamSessionEvent): void {
		const details = (event?.details ?? {}) as Record<string, unknown>
		if (event?.type === "session.updated" && details.turn === "starting") {
			const id = details.turnId
			if (typeof id === "string" && id !== "") this.activeTurnId = id
			return
		}
		if (this.activeTurnId === undefined) return
		if (event?.type === "session.error") {
			if (details.turnId !== this.activeTurnId) return
			const code = typeof details.code === "string" ? details.code : "INTERNAL"
			this.outcome = isAbortTurnCode(code) ? "aborted" : "failed"
			return
		}
		if (event?.type === "bridge.turn.terminal") {
			if (details.turnId !== this.activeTurnId) return
			// A journal terminal: turn/error classifies exactly like session.error,
			// while turn/end is a clean settle and must NOT mark a failure.
			if (details.terminalType === "turn/error") {
				const reason = (details.reason ?? {}) as Record<string, unknown>
				const code = typeof reason.code === "string" ? reason.code : "INTERNAL"
				this.outcome = isAbortTurnCode(code) ? "aborted" : "failed"
			}
			return
		}
		if (event?.type === "bridge.turn.interrupted" && details.turnId === this.activeTurnId) {
			this.outcome = "aborted"
		}
	}

	/** The armed turn ended with a genuine error. */
	isFailed(): boolean {
		return this.outcome === "failed"
	}

	/** The armed turn was aborted / interrupted / closed. */
	isAborted(): boolean {
		return this.outcome === "aborted"
	}
}

/** Busy-submit delivery choice. The view asks through the dialog stack; the
 * controller only consumes the answer, so the decision core stays
 * renderer-free. undefined = the user cancelled (input must be kept). */
export type ComposerDelivery = "steer" | "queue"

export type ComposerSubmitResult = "sent" | "steered" | "queued" | "ignored" | "cancelled"

/** A transcript "pending delivery" line (queue wait / injected steer). */
export type ComposerPendingKind = "queue" | "steer"
/** queued = waiting for the turn end; paused = a failed/aborted turn kept the
 * queue and the pump waits for the next successful turn end; injected = a
 * steer line already pushed into the running turn; delivered = that steer's
 * turn has settled (the line stays as a compact receipt). */
export type ComposerPendingState = "queued" | "paused" | "injected" | "delivered"

export interface ComposerPendingRow {
	/** Monotonic id (stable transcript row key). */
	id: number
	kind: ComposerPendingKind
	state: ComposerPendingState
	text: string
	/** 1-based queue position; queue rows only. */
	order?: number
}

export interface ComposerQueuePause {
	remaining: number
	reason: "failed" | "aborted"
}

/** What an explicit queue flush did (the /flush trigger). */
export type ComposerFlushKind = "empty" | "busy" | "flushed"

/** The outcome of `ComposerController.flushQueue()`. */
export interface ComposerFlushResult {
	kind: ComposerFlushKind
	/** Prompts this flush put into delivery (the head; the rest follow one
	 * per turn end). 0 for "empty"/"busy". */
	started: number
	/** Prompts still waiting behind the started one. */
	remaining: number
}

/** One recall step: the text to place in the composer plus, when the step
 * restores the stashed draft, the cursor offset to restore with it. Committed
 * entries leave `cursor` unset — the caller picks 0 (↑) or end (↓), matching
 * pi's `setTextInternal(..., "start" | "end")`. */
export type ComposerHistoryStep = {
	text: string
	cursor?: number
}

/** The draft slot is the whole editor state we can cheaply restore: text and
 * cursor offset (pi's `historyDraft = structuredClone(this.state)`). */
type HistoryDraft = { text: string; cursor: number }

/** Who caused a turn to start. `user` = an explicit Enter / /flush head:
 *  the page may scroll the transcript to the newest row. `queue` = a queued
 *  line pumped on turn end (or a popup answer that landed after settle):
 *  the reader must not be yanked away from scrollback. */
export type ComposerSendSource = "user" | "queue"

export type ComposerControllerOptions = {
	/** Starts a turn (page wiring: the transcript projection's `send`).
	 *  The source is optional for simple callers and defaults to `user`. */
	send: (text: string, source?: ComposerSendSource) => Promise<void>
	/** Steers the running turn (page wiring: `seam.steer`); resolution is the
	 * acceptance receipt — the controller paints nothing before `accepted`. */
	steer: (text: string) => Promise<SeamSteerResult>
	/** A steer was refused (idle / ending / aborting / unsupported). Safe
	 * default: no receipt row, no auto-send; the page restores the draft. */
	onSteerRejected?: (info: { text: string; reason: string }) => void
	/** Busy changes are pushed here (status/powerline batch consumes). */
	onBusyChange?: (busy: boolean) => void
	/** Injectable history for tests; defaults to a fresh in-memory one. */
	history?: ComposerHistory
	/** Busy-submit chooser (the dialog stack). Omitted = the vendored default
	 * (steer immediately, no prompt). Resolves undefined on Esc. */
	chooseDelivery?: (text: string) => Promise<ComposerDelivery | undefined>
	/** Pending delivery lines changed (transcript slot). Snapshot, not a live
	 * store — the page copies it into a signal. */
	onPendingChange?: (rows: readonly ComposerPendingRow[]) => void
	/** A failed/aborted turn paused a non-empty queue (page shows a notice). */
	onQueuePaused?: (info: ComposerQueuePause) => void
	/** Page-owned abort flag (esc/ctrl+c interrupt or a classified abort turn).
	 * Abort resolves the seam turn without an error, so the controller cannot
	 * tell it from success on its own. */
	isTurnAborted?: () => boolean
	/** Page-owned failure flag (a `session.error` for the active turn classified
	 * it as failed). A failed turn also resolves the seam without a send
	 * rejection, so the controller needs this signal to pause the queue / drop
	 * steer receipts. Read as a getter; the page resets it on each send. */
	isTurnFailed?: () => boolean
	/** A disabled composer refuses every submit (bridge RECOVERING, blocky
	 * §2.5). The caller keeps the typed draft: "ignored" never clears it and
	 * never appends history. Read as a getter so the page can flip it live. */
	disabled?: () => boolean
}

export class ComposerHistory {
	private entries: string[] = []
	/** null = the draft slot (not browsing); otherwise an index into entries. */
	private index: number | null = null
	/** Buffer + cursor stashed when browsing started; restored on ↓ past the
	 * newest. */
	private draft: HistoryDraft = { text: "", cursor: 0 }

	/** True while ↑/↓ is walking committed prompts instead of the draft. */
	get browsing(): boolean {
		return this.index !== null
	}

	/**
	 * Shell-style recall. `input` is the current buffer text and `cursor` its
	 * cursor offset (only stashed on the first ↑, then restored with the
	 * draft).
	 *
	 * Returns the text to place in the composer (plus the draft cursor when
	 * this step restores the draft), or undefined when the walk cannot move
	 * (empty history, past the oldest, at the draft).
	 */
	move(direction: 1 | -1, input: string, cursor = 0): ComposerHistoryStep | undefined {
		if (this.entries.length === 0) return undefined

		if (this.index === null) {
			// ↓ at the draft: nothing newer to walk to.
			if (direction === 1) return undefined
			// First ↑ from the draft: stash it (typed, multi-line or empty,
			// cursor included) exactly like pi's historyDraft / mini's
			// movePromptHistory.
			this.draft = { text: input, cursor }
			this.index = this.entries.length - 1
			return { text: this.entries[this.index], cursor: 0 }
		}

		const next = this.index + direction
		if (next < 0) return undefined // past the oldest: stop
		if (next >= this.entries.length) {
			// Past the newest: back to the draft slot, restoring the stash and
			// its cursor (an empty stash clears the buffer, "最底 = 新消息").
			this.index = null
			return { ...this.draft }
		}
		this.index = next
		return { text: this.entries[next] }
	}

	/** Commit a prompt. Duplicate of the newest entry only resets the walk. */
	append(text: string): void {
		if (this.entries.at(-1) === text) {
			this.reset()
			return
		}
		this.entries.push(text)
		if (this.entries.length > MAX_HISTORY_ENTRIES) this.entries = this.entries.slice(-MAX_HISTORY_ENTRIES)
		this.reset()
	}

	private reset(): void {
		this.index = null
		this.draft = { text: "", cursor: 0 }
	}

	get size(): number {
		return this.entries.length
	}
}

export class ComposerController {
	readonly history: ComposerHistory
	private readonly send: ComposerControllerOptions["send"]
	private readonly steer: ComposerControllerOptions["steer"]
	private readonly onSteerRejected: ComposerControllerOptions["onSteerRejected"]
	private readonly onBusyChange: ComposerControllerOptions["onBusyChange"]
	private readonly chooseDelivery: ComposerControllerOptions["chooseDelivery"]
	private readonly onPendingChange: ComposerControllerOptions["onPendingChange"]
	private readonly onQueuePaused: ComposerControllerOptions["onQueuePaused"]
	private readonly isTurnAborted: ComposerControllerOptions["isTurnAborted"]
	private readonly isTurnFailed: ComposerControllerOptions["isTurnFailed"]
	private readonly disabled: ComposerControllerOptions["disabled"]
	private busyState = false
	private pendingTurn: Promise<void> | undefined
	/** Queue items awaiting their turn, submission order (head = next). */
	private queueItems: { id: number; text: string }[] = []
	/** Transcript delivery lines (queue waits + steer receipts), in creation
	 * order. Queue rows carry a live 1-based `order`. */
	private pendingRows: ComposerPendingRow[] = []
	private deliverySeq = 0
	/** Session-switch epoch: a popup answer that lands after a switch is
	 * discarded (the queue belongs to the old session). */
	private deliveryEpoch = 0
	/** Turn generation: bumped on every startTurn (including pumped queue
	 * lines). A steer receipt belongs to the generation that accepted it; a
	 * later turn cannot promote an injected row left by a failed/aborted turn. */
	private turnGeneration = 0
	/** Accepted steer row id → the generation that accepted it. */
	private readonly steerTurnById = new Map<number, number>()

	constructor(options: ComposerControllerOptions) {
		this.send = options.send
		this.steer = options.steer
		this.onSteerRejected = options.onSteerRejected
		this.onBusyChange = options.onBusyChange
		this.chooseDelivery = options.chooseDelivery
		this.onPendingChange = options.onPendingChange
		this.onQueuePaused = options.onQueuePaused
		this.isTurnAborted = options.isTurnAborted
		this.isTurnFailed = options.isTurnFailed
		this.disabled = options.disabled
		this.history = options.history ?? new ComposerHistory()
	}

	get busy(): boolean {
		return this.busyState
	}

	/** Delivery lines for the transcript's pending slot (stable snapshot). */
	get pending(): readonly ComposerPendingRow[] {
		return this.pendingRows
	}

	/** Queue depth (page diagnostics / tests). */
	get queued(): number {
		return this.queueItems.length
	}

	/**
	 * Enter dispatch: busy → steer; idle → send and track the turn promise.
	 * The caller clears the input when the result is not "ignored" (the
	 * vendored composer clears synchronously on both send and steer paths).
	 * A rejected send still ends the turn from the composer's perspective —
	 * errors surface through the transcript's error row, not the composer.
	 *
	 * The popup path lives in `submitWhileBusy`: the view asks first (async),
	 * then calls it. This sync entry keeps the vendored no-prompt default for
	 * hosts without a dialog stack.
	 */
	submit(text: string): ComposerSubmitResult {
		// Disabled (bridge RECOVERING): refuse the turn AND history. The view
		// keeps the typed draft because the result is "ignored".
		if (this.disabled?.()) return "ignored"
		const prompt = text.trim()
		if (!prompt) return "ignored"
		// Vendored submitInner appends history for every committed prompt,
		// whatever its delivery — steered lines are recallable too.
		this.history.append(prompt)
		if (this.busyState) {
			// Sync entry: the result is optimistic ("steered" names the chosen
			// delivery, not an accepted receipt). injectSteer paints nothing
			// until the seam accepts; a rejection restores the draft via the
			// page callback.
			void this.injectSteer(prompt)
			return "steered"
		}
		this.startTurn(prompt)
		return "sent"
	}

	/**
	 * Busy-submit popup path: ask the view (dialog stack) for steer vs queue,
	 * then apply the answer. `undefined` = cancelled → "cancelled" and the
	 * caller keeps the input. Empty/blank input never opens the popup.
	 *
	 * Race: the turn may settle while the popup is open. If it did, both
	 * answers fall back to starting a normal turn — steering a settled turn
	 * would be silently dropped by the host, and a queue with no running turn
	 * should not wait forever.
	 */
	async submitWhileBusy(text: string): Promise<ComposerSubmitResult> {
		if (this.disabled?.()) return "ignored"
		const prompt = text.trim()
		if (!prompt) return "ignored"
		const epoch = this.deliveryEpoch
		const delivery = this.chooseDelivery ? await this.chooseDelivery(prompt) : "steer"
		// A session switch while the popup was open invalidates the answer: the
		// queue belongs to the old session and must not leak into the new one.
		if (epoch !== this.deliveryEpoch) return "cancelled"
		if (delivery === undefined) return "cancelled"
		if (!this.busyState) {
			// The turn settled while the popup was open: the answer is a
			// deferred delivery, not a fresh user submit — no scroll-to-bottom.
			this.history.append(prompt)
			this.startTurn(prompt, "queue")
			return "sent"
		}
		if (delivery === "queue") {
			this.history.append(prompt)
			this.enqueue(prompt)
			return "queued"
		}
		// A refused steer keeps the text (no history entry, no receipt, no
		// silent send); "cancelled" tells the page to keep the editor buffer.
		if (!(await this.injectSteer(prompt))) return "cancelled"
		this.history.append(prompt)
		return "steered"
	}

	/** Session switch: drop the queue and every delivery receipt. An
	 * in-flight turn is NOT cancelled (the page owns the seam). */
	resetDeliveries(): void {
		this.deliveryEpoch += 1
		this.queueItems = []
		this.pendingRows = []
		// Every receipt row is gone; drop its generation tag with it.
		this.steerTurnById.clear()
		this.emitPending()
	}

	/**
	 * Explicit flush (the /flush trigger): deliver the queued prompts NOW.
	 *
	 * The paused queue (a failed or aborted turn kept it) has NO pump
	 * running — it would wait for the user's next message. This restarts
	 * the pump: the head of the queue starts a turn immediately and the
	 * rest follow one per turn end, exactly like the normal hand-off (the
	 * busy flag stays true across the boundary — no idle flicker).
	 *
	 * Outcomes:
	 *   - "empty":   nothing queued (the caller reports the no-op);
	 *   - "busy":    a turn is running — the queue is already scheduled
	 *                behind it, so there is nothing to flush;
	 *   - "flushed": the head started a turn; `remaining` lines wait
	 *                behind it.
	 */
	flushQueue(): ComposerFlushResult {
		if (this.queueItems.length === 0) return { kind: "empty", started: 0, remaining: 0 }
		if (this.busyState) return { kind: "busy", started: 0, remaining: this.queueItems.length }
		const next = this.queueItems.shift()!
		// The head's wait row goes away (the projection paints the real user
		// message); the rows behind it are live again, not paused.
		this.dropQueueRow(next.id)
		this.setQueuedState("queued")
		this.startTurn(next.text)
		return { kind: "flushed", started: 1, remaining: this.queueItems.length }
	}

	/** Exposed so a host can await turn completion (tests, page wiring). */
	get turn(): Promise<void> | undefined {
		return this.pendingTurn
	}

	private setBusy(busy: boolean) {
		if (this.busyState === busy) return
		this.busyState = busy
		this.onBusyChange?.(busy)
	}

	private emitPending(): void {
		this.onPendingChange?.(this.pendingRows)
	}

	/** Start one turn and own its settle: successful settle pumps the next
	 * queued line (staying busy across the boundary — no idle flicker);
	 * failure/abort pauses a non-empty queue and keeps it. */
	private startTurn(prompt: string, source: ComposerSendSource = "user"): void {
		// New generation: receipts accepted by an earlier turn (left injected by
		// a failure/abort) never become delivered on this turn's clean settle.
		const generation = ++this.turnGeneration
		this.setBusy(true)
		let sendRejected = false
		const turn = (async () => this.send(prompt, source))().then(
			() => undefined,
			() => {
				sendRejected = true
			},
		)
		this.pendingTurn = turn.finally(() => {
			this.pendingTurn = undefined
			// A turn failure also resolves the seam without rejecting send: the
			// page records `session.error` (with a turn id) and exposes it here.
			const failed = sendRejected || (this.isTurnFailed?.() ?? false)
			const aborted = !failed && (this.isTurnAborted?.() ?? false)
			// Only a cleanly settled turn proves ITS steers were consumed.
			// A failed/aborted turn leaves its injected rows "injected" — never a
			// false ✓ receipt on this or any later generation for text the host
			// may not have consumed.
			if (!failed && !aborted) this.markSteerDelivered(generation)
			if (failed || aborted) {
				this.setBusy(false)
				if (this.queueItems.length > 0) {
					this.setQueuedState("paused")
					this.onQueuePaused?.({ remaining: this.queueItems.length, reason: failed ? "failed" : "aborted" })
				}
				return
			}
			const next = this.queueItems.shift()
			if (next === undefined) {
				this.setBusy(false)
				return
			}
			this.dropQueueRow(next.id)
			// Busy stays true through the hand-off: the footer/status never
			// flashes idle between queued turns. A pumped line is NOT a user
			// submit: carry `queue` so the page leaves scrollback untouched.
			this.startTurn(next.text, "queue")
		})
	}

	/** Queue a line behind the running turn and paint its `⏸` row. */
	private enqueue(prompt: string): void {
		const id = ++this.deliverySeq
		this.queueItems.push({ id, text: prompt })
		this.pendingRows = [
			...this.pendingRows,
			{ id, kind: "queue", state: "queued", text: prompt, order: this.queueItems.length },
		]
		this.emitPending()
	}

	/** Steer the running turn; paint a `⤵` receipt ONLY on acceptance.
	 * A rejection keeps the text under the page's control (draft restored via
	 * `onSteerRejected`) and never starts a surprise normal turn. A thrown
	 * seam error is a rejection whose reason is the actual err.message — never a fake receipt.
	 * The generation is captured BEFORE the await: the receipt belongs to the
	 * turn that was running when the steer was submitted, not to whichever turn
	 * happens to be current when the host answers. */
	private async injectSteer(prompt: string): Promise<boolean> {
		const epoch = this.deliveryEpoch
		const generation = this.turnGeneration
		let result: SeamSteerResult
		try {
			const awaited = await this.steer(prompt)
			// A legacy/void seam cannot confirm acceptance. Treat it as an
			// explicit refusal (never a fake receipt, never a TypeError).
			result =
				awaited !== null && typeof awaited === "object" && typeof awaited.accepted === "boolean"
					? awaited
					: { accepted: false, reason: "INVALID_STEER_RESULT" }
		} catch (err) {
			result = { accepted: false, reason: err instanceof Error ? err.message : String(err) }
		}
		if (epoch !== this.deliveryEpoch) return false // session switched while awaiting
		if (!result.accepted) {
			this.onSteerRejected?.({ text: prompt, reason: result.reason })
			return false
		}
		const id = ++this.deliverySeq
		this.steerTurnById.set(id, generation)
		// Public row shape is unchanged — the generation tag is controller-only.
		this.pendingRows = [...this.pendingRows, { id, kind: "steer", state: "injected", text: prompt }]
		this.emitPending()
		return true
	}

	/** Clean turn end: only THIS generation's injected steer rows become
	 * delivered receipts. Rows left by a failed/aborted generation stay
	 * "injected" forever — a later successful turn must not vouch for them. */
	private markSteerDelivered(generation: number): void {
		const isMine = (row: ComposerPendingRow) =>
			row.kind === "steer" && row.state === "injected" && this.steerTurnById.get(row.id) === generation
		if (!this.pendingRows.some(isMine)) return
		this.pendingRows = this.pendingRows.map((row) => (isMine(row) ? { ...row, state: "delivered" } : row))
		this.emitPending()
	}

	/** Remove a queue row (its turn started; the projection paints the real
	 * user message) and renumber the remaining waits. */
	private dropQueueRow(id: number): void {
		this.pendingRows = this.pendingRows.filter((row) => row.id !== id)
		let order = 0
		this.pendingRows = this.pendingRows.map((row) => {
			if (row.kind !== "queue") return row
			order += 1
			return { ...row, order }
		})
		this.emitPending()
	}

	private setQueuedState(state: "queued" | "paused"): void {
		this.pendingRows = this.pendingRows.map((row) =>
			row.kind === "queue" && (row.state === "queued" || row.state === "paused") ? { ...row, state } : row,
		)
		this.emitPending()
	}
}
