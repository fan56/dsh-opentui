/**
 * AskKeys — the ask surface's ONE keymap layer
 * (`docs/ask-user-panel-spec.md` §5-§6, ADR-0008 decision 4/8).
 *
 * The layer is created by the panel body (`ask-panel.tsx`) so it owns the
 * same refs the body paints from, and it is gated on the ownership stack: the
 * dock pushes the `dock` frame while it is open, so this layer answers only
 * while that frame is on top (a dialog opened over the dock wins). The keymap
 * prepends its listener, so the layer runs BEFORE the focused inline input —
 * every key the input must own is released with `return false`.
 *
 * One key class is not a binding: a printable character typed while the LIST
 * owns the cursor belongs to the resident inline row (spec §5 focus model).
 * It goes through the keymap's `key` interceptor, which runs ahead of every
 * binding and does not consume, so the now-focused input inserts it after the
 * phase switch.
 *
 * Phase semantics:
 *   options  the option list owns the cursor. ↑↓/PgUp/PgDn/Home/End move;
 *            Enter picks (single) or confirms (multi); Space toggles (multi
 *            only); 1-9 quick-pick.
 *   input    the resident inline row owns the keys. Enter/Space/Left/Right/
 *            arrows are released to it; Esc leaves it without committing;
 *            digits TYPE digits (the digit commands are disabled while the
 *            input holds the renderer focus, spec §5 constraint 3).
 *   review   the review page owns the cursor. ↑↓/PgUp/PgDn/Home/End move;
 *            Enter edits the focused question or submits the batch; Esc goes
 *            back to the last question (the review page is forward-only).
 *
 * Esc / Ctrl+C are ONE monotonic back-out ladder (never a cycle):
 *   input → options (zero-option: straight to the next stage)
 *   options/question n>1 → previous question
 *   options/question 1 → decline the batch and close the dock (the only
 *   decline path; a review page never re-enters itself and never declines).
 * Ctrl+C runs the same stages but, at the outermost one, also arms the
 * one-shot non-arming page interrupt (`turn-cancel.ts`): the dock's dismissal
 * must never put the application one press away from quitting.
 */
import type { KeyEvent, Renderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { onCleanup } from "solid-js"
import { Keymap } from "../../context/keymap"
import { useInputOwnershipOptional } from "../../context/input-ownership"
import {
	askNeedsReview,
	hasReviewRow,
	questionRowCount,
	reviewRowIntent,
} from "./ask-options"
import { armNonArmingInterrupt } from "./turn-cancel"
import type { PendingAsk, TurnOverlayController } from "./turn-overlay-controller"

/** Coarse page step for PgUp/PgDn: the body has no viewport handle of its own
 * (the dock host owns the only scrollbox), so a page moves this many rows. */
export const ASK_PAGE_ROWS = 5

/** The single printable character a key types, or undefined when the key is
 * not free text. Digits stay with quick-pick, Space with multi-select, and
 * control sequences / multi-character (IME, paste-sized) payloads are left
 * alone (spec §5 focus model). */
function printableText(event: KeyEvent): string | undefined {
	const text = event.sequence
	// One UTF-16 code unit: a lone character. Anything longer is IME text or a
	// control sequence and must not be forced through the inline row.
	if (text.length !== 1) return undefined
	if (event.ctrl || event.meta || event.super === true || event.hyper === true) return undefined
	if (text === " ") return undefined
	if (text >= "0" && text <= "9") return undefined
	const code = text.codePointAt(0) ?? 0
	if (code < 32 || code === 127) return undefined
	return text
}

export interface AskKeysOptions {
	controller: TurnOverlayController
	/** The resident inline input element. It is the only surface that may take
	 * a printable key away from the layer (spec §5 constraint 3). */
	input: () => Renderable | undefined
}

export function useAskKeys(options: AskKeysOptions): void {
	// Bare rendering harnesses mount the panel without the app's keymap
	// provider; the document says the provider's presence is fixed for the
	// component's lifetime, so the branch is stable.
	const keymap = Keymap.useOptional()
	if (keymap === undefined) return

	const renderer = useRenderer()
	// ADR-0008: the dock's own frame is the gate. Without an ownership provider
	// (bare harness) the layer keeps the pre-ownership behavior.
	const ownership = useInputOwnershipOptional()
	const ownsDock = () => ownership === undefined || ownership.top().kind === "dock"

	const ask = (): PendingAsk | undefined => options.controller.pendingAsk
	const question = () => {
		const batch = ask()
		return batch?.questions[batch.index]
	}
	const needsReview = () => askNeedsReview(ask()?.questions ?? [])
	const currentRow = () => {
		const batch = ask()
		return batch === undefined ? 0 : (batch.cursors[batch.index] ?? 0)
	}
	const inputFocused = () => {
		const input = options.input()
		return input !== undefined && renderer.currentFocusedRenderable === input
	}

	// A printable character typed while the option list is focused belongs to
	// the resident inline row, not the list (spec §5 focus model). The phase
	// switch alone is not enough: the keymap is prepended, so this runs before
	// the input. A layer binding cannot express a character class — it needs a
	// concrete key or a registered sequence pattern, and the layer wrapper
	// drops `preventDefault: false` — so the catch-all is the keymap's public
	// "key" interceptor (which runs ahead of every binding). It deliberately
	// does NOT consume: the event falls through to the now-focused input's own
	// keypress handler, which inserts exactly the typed character (and its
	// `onInput` writes the controller's inline buffer).
	onCleanup(
		keymap.intercept("key", ({ event }) => {
			if (!ownsDock()) return
			const batch = ask()
			if (batch === undefined || batch.phase !== "questions") return
			if (printableText(event) === undefined) return
			options.controller.focusInput()
			options.input()?.focus()
		}),
	)

	/** Move the list cursor; false releases the key to the focused input. */
	function move(delta: number): boolean {
		const batch = ask()
		if (batch === undefined) return false
		if (batch.phase === "review") {
			options.controller.moveReviewCursor(delta)
			return true
		}
		if (batch.phase === "input") return false
		options.controller.moveCursor(delta)
		return true
	}

	function page(direction: 1 | -1): boolean {
		return move(direction * ASK_PAGE_ROWS)
	}

	/** Home/End over the list (the resident inline row is the last row) and
	 * over the review page (the Submit row is last). */
	function boundary(toEnd: boolean): boolean {
		const batch = ask()
		if (batch === undefined) return false
		if (batch.phase === "review") {
			options.controller.setReviewCursor(toEnd ? batch.questions.length : 0)
			return true
		}
		if (batch.phase === "input") return false
		const current = question()
		if (current === undefined) return false
		options.controller.setCursor(toEnd ? questionRowCount(current, needsReview()) - 1 : 0)
		return true
	}

	/** ←/→ switch questions; in review, ← goes back to the last question. */
	function switchQuestion(direction: 1 | -1): boolean {
		const batch = ask()
		if (batch === undefined) return false
		if (batch.phase === "input") return false
		if (batch.phase === "review") {
			if (direction === -1) {
				options.controller.backToQuestions(batch.questions.length - 1)
				return true
			}
			return false
		}
		if (batch.questions.length < 2) return false
		options.controller.switchFocus(direction)
		return true
	}

	/** Enter: options pick/confirm/advance, review edit/submit. In the input
	 * phase the key is released — the input's own `onSubmit` commits. */
	function enter(): boolean {
		const batch = ask()
		if (batch === undefined) return false
		if (batch.phase === "input") return false
		if (batch.phase === "review") {
			const intent = reviewRowIntent(batch.reviewCursor, batch.questions.length)
			if (intent.kind === "submit") {
				options.controller.submit()
				return true
			}
			options.controller.backToQuestions(intent.question)
			return true
		}
		const current = question()
		if (current === undefined) return false
		const row = currentRow()
		if (hasReviewRow(current, needsReview()) && row === current.options.length) {
			return options.controller.enterReview()
		}
		const option = current.options[row]
		if (option === undefined) return false
		if (current.multiSelect === true) return options.controller.confirmQuestion()
		options.controller.toggle(option.label)
		return true
	}

	/** Space toggles a multi-select row; single-select (and the review/input
	 * phases) release it so a focused input still receives a literal space. */
	function space(): boolean {
		const batch = ask()
		if (batch === undefined || batch.phase !== "questions") return false
		const current = question()
		if (current === undefined || current.multiSelect !== true) return false
		if (inputFocused()) return false
		const option = current.options[currentRow()]
		if (option === undefined) return false
		options.controller.toggle(option.label)
		return true
	}

	/** 1-9 quick-pick the nth option. Disabled while the input holds focus so
	 * digits type digits (spec §5 constraint 3). */
	function digit(index: number): boolean {
		const batch = ask()
		if (batch === undefined || batch.phase !== "questions") return false
		if (inputFocused()) return false
		const option = question()?.options[index]
		if (option === undefined) return false
		options.controller.toggle(option.label)
		return true
	}

	/** The outermost ladder level: declining is the ONLY exit path. */
	function atOutermost(batch: PendingAsk): boolean {
		if (batch.phase === "review" || batch.index > 0) return false
		// A zero-option question has no list stage to go back to.
		if (batch.phase === "input") return (batch.questions[batch.index]?.options.length ?? 0) === 0
		return true
	}

	/** Esc / Ctrl+C: one stage per press, monotonically increasing. */
	function backOut(): boolean {
		const batch = ask()
		if (batch === undefined) return false
		if (batch.phase === "review") {
			options.controller.backToQuestions(batch.questions.length - 1)
			return true
		}
		if (batch.phase === "input") {
			const current = batch.questions[batch.index]
			if (current !== undefined && current.options.length > 0) {
				options.controller.focusOptions()
				return true
			}
			// Zero-option question: fall through to the previous/decline stage.
		}
		if (batch.index > 0) {
			options.controller.switchFocus(-1)
			return true
		}
		options.controller.decline()
		return true
	}

	function interrupt(): boolean {
		const batch = ask()
		if (batch === undefined) return false
		// The dismissing press arms the page's one-shot non-arming interrupt.
		if (atOutermost(batch)) armNonArmingInterrupt()
		return backOut()
	}

	Keymap.createLayer(() => ({
		// A global layer, like every overlay layer (ADR-0008): the ownership
		// frame is the gate, not the keymap mode.
		mode: "global",
		enabled: ownsDock,
		commands: [
			{ bind: "up,ctrl+p", run: () => move(-1) },
			{ bind: "down,ctrl+n", run: () => move(1) },
			{ bind: "pageup", run: () => page(-1) },
			{ bind: "pagedown", run: () => page(1) },
			{ bind: "home", run: () => boundary(false) },
			{ bind: "end", run: () => boundary(true) },
			{ bind: "return", run: enter },
			{ bind: "space", run: space },
			...Array.from({ length: 9 }, (_, index) => ({
				bind: `${index + 1}`,
				// Held off while the resident input owns the keyboard: the same
				// `return false` release Enter/Space/Left/Right use (constraint 3).
				enabled: () => !inputFocused(),
				run: () => digit(index),
			})),
			{ bind: "left", run: () => switchQuestion(-1) },
			{ bind: "right", run: () => switchQuestion(1) },
			{ bind: "escape", run: backOut },
			{ bind: "ctrl+c", run: interrupt },
		],
	}))
}
