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
 * `✓` (delivered) when the turn settles. The transcript paints both states
 * from `pendingRows`; nothing here animates.
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
export const MAX_HISTORY_ENTRIES = 50

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

export type ComposerControllerOptions = {
	/** Starts a turn (page wiring: the transcript projection's `send`). */
	send: (text: string) => Promise<void>
	/** Steers the running turn (page wiring: `seam.steer`). */
	steer: (text: string) => void
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
	/** Page-owned abort flag (esc/ctrl+c interrupt). Abort resolves the seam
	 * turn without an error, so the controller cannot tell it from success
	 * on its own. */
	isTurnAborted?: () => boolean
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
	private readonly onBusyChange: ComposerControllerOptions["onBusyChange"]
	private readonly chooseDelivery: ComposerControllerOptions["chooseDelivery"]
	private readonly onPendingChange: ComposerControllerOptions["onPendingChange"]
	private readonly onQueuePaused: ComposerControllerOptions["onQueuePaused"]
	private readonly isTurnAborted: ComposerControllerOptions["isTurnAborted"]
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

	constructor(options: ComposerControllerOptions) {
		this.send = options.send
		this.steer = options.steer
		this.onBusyChange = options.onBusyChange
		this.chooseDelivery = options.chooseDelivery
		this.onPendingChange = options.onPendingChange
		this.onQueuePaused = options.onQueuePaused
		this.isTurnAborted = options.isTurnAborted
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
		const prompt = text.trim()
		if (!prompt) return "ignored"
		// Vendored submitInner appends history for every committed prompt,
		// whatever its delivery — steered lines are recallable too.
		this.history.append(prompt)
		if (this.busyState) {
			this.injectSteer(prompt)
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
		const prompt = text.trim()
		if (!prompt) return "ignored"
		const epoch = this.deliveryEpoch
		const delivery = this.chooseDelivery ? await this.chooseDelivery(prompt) : "steer"
		// A session switch while the popup was open invalidates the answer: the
		// queue belongs to the old session and must not leak into the new one.
		if (epoch !== this.deliveryEpoch) return "cancelled"
		if (delivery === undefined) return "cancelled"
		this.history.append(prompt)
		if (!this.busyState) {
			this.startTurn(prompt)
			return "sent"
		}
		if (delivery === "queue") {
			this.enqueue(prompt)
			return "queued"
		}
		this.injectSteer(prompt)
		return "steered"
	}

	/** Session switch: drop the queue and every delivery receipt. An
	 * in-flight turn is NOT cancelled (the page owns the seam). */
	resetDeliveries(): void {
		this.deliveryEpoch += 1
		this.queueItems = []
		this.pendingRows = []
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
	private startTurn(prompt: string): void {
		this.setBusy(true)
		let failed = false
		const turn = (async () => this.send(prompt))().then(
			() => undefined,
			() => {
				failed = true
			},
		)
		this.pendingTurn = turn.finally(() => {
			this.pendingTurn = undefined
			const aborted = !failed && (this.isTurnAborted?.() ?? false)
			this.markSteerDelivered()
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
			// flashes idle between queued turns.
			this.startTurn(next.text)
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

	/** Steer the running turn now and paint its `⤵` receipt row. */
	private injectSteer(prompt: string): void {
		const id = ++this.deliverySeq
		this.pendingRows = [...this.pendingRows, { id, kind: "steer", state: "injected", text: prompt }]
		this.emitPending()
		this.steer(prompt)
	}

	/** Turn end: every injected steer line becomes a delivered receipt. */
	private markSteerDelivered(): void {
		if (!this.pendingRows.some((row) => row.kind === "steer" && row.state === "injected")) return
		this.pendingRows = this.pendingRows.map((row) =>
			row.kind === "steer" && row.state === "injected" ? { ...row, state: "delivered" } : row,
		)
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
