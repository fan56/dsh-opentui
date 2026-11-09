/**
 * Composer state — the seam-driven composer's decision core (batch 4),
 * split out of session-composer.tsx so submit/busy/history unit tests run without
 * a renderer. The Solid component is a thin shell over this controller.
 *
 * Busy/steer semantics mirror the vendored prompt (component/prompt/index.tsx
 * `submit()`): Enter during a running turn is NOT disabled — it is routed as
 * a steer (vendored default `delivery = "steer"`; the "queue" delivery is a
 * separate binding and is not modeled on the seam yet). The composer clears
 * on both paths, exactly like the vendored snapshot-and-clear flow.
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

export type ComposerSubmitResult = "sent" | "steered" | "ignored"

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
	private busyState = false
	private pendingTurn: Promise<void> | undefined

	constructor(options: ComposerControllerOptions) {
		this.send = options.send
		this.steer = options.steer
		this.onBusyChange = options.onBusyChange
		this.history = options.history ?? new ComposerHistory()
	}

	get busy(): boolean {
		return this.busyState
	}

	/**
	 * Enter dispatch: busy → steer; idle → send and track the turn promise.
	 * The caller clears the input when the result is not "ignored" (the
	 * vendored composer clears synchronously on both send and steer paths).
	 * A rejected send still ends the turn from the composer's perspective —
	 * errors surface through the transcript's error row, not the composer.
	 */
	submit(text: string): ComposerSubmitResult {
		const prompt = text.trim()
		if (!prompt) return "ignored"
		// Vendored submitInner appends history for every committed prompt,
		// whatever its delivery — steered lines are recallable too.
		this.history.append(prompt)
		if (this.busyState) {
			this.steer(prompt)
			return "steered"
		}
		this.setBusy(true)
		this.pendingTurn = this.send(prompt)
			.catch(() => undefined)
			.finally(() => {
				this.pendingTurn = undefined
				this.setBusy(false)
			})
		return "sent"
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
}
