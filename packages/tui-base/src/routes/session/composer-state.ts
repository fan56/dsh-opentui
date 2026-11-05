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
 * History recall mirrors prompt/history.tsx `move()` semantics, in-memory
 * only (the vendored provider persists to prompt-history.jsonl — the shell
 * adapter may add persistence later):
 *
 *   index 0 is the draft slot (no recall); negative indices walk newest →
 *   oldest (−1 = last committed prompt). `move` refuses to clobber an input
 *   that was modified away from the currently-recalled entry (the draft-slot
 *   protection), refuses to walk past the oldest entry, and returns "" when
 *   stepping forward past the newest entry (back to the draft).
 */
export const MAX_HISTORY_ENTRIES = 50

export type ComposerSubmitResult = "sent" | "steered" | "ignored"

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
	private index = 0

	/** Native `move(direction, input)` semantics (see module comment). */
	move(direction: 1 | -1, input: string): string | undefined {
		if (this.entries.length === 0) return undefined
		const current = this.entries.at(this.index)
		if (current === undefined) return undefined
		if (current !== input && input.length > 0) return undefined
		const next = this.index + direction
		if (Math.abs(next) > this.entries.length || next > 0) return undefined
		this.index = next
		if (next === 0) return ""
		return this.entries.at(next)
	}

	/** Commit a prompt. Duplicate of the newest entry only resets the walk. */
	append(text: string): void {
		if (this.entries.at(-1) === text) {
			this.index = 0
			return
		}
		this.entries.push(text)
		if (this.entries.length > MAX_HISTORY_ENTRIES) this.entries = this.entries.slice(-MAX_HISTORY_ENTRIES)
		this.index = 0
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
