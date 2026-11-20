/**
 * TurnCancelKeys — the cancel/quit contract for the rebuilt view (batch V2).
 *
 *   escape            no `confirmStop` prop (legacy): running turn →
 *                     seam.interrupt() immediately (abort; the turn promise
 *                     settles, busy → false, status line unmounts).
 *   escape            with `confirmStop` (U6 stop-confirm contract, tui-pi
 *                     parity): the stop becomes a deliberate double-press —
 *                     the 1st press only ARMS ("Press Esc again to stop"),
 *                     the 2nd inside the window opens the stop-everything
 *                     CONFIRMATION dialog (the caller's `confirmStop`), so
 *                     a stray Esc can never kill a running task. Idle /
 *                     palette open → NOT consumed either way (falls through
 *                     to the composer, so the slash palette's esc still
 *                     closes).
 *   ctrl+c (idle)     open the quit CONFIRMATION dialog (DialogConfirm,
 *                     "Quit dsh-opentui?"). Confirm runs the existing
 *                     `props.quit` shutdown path; Esc / cancel keeps running.
 *                     No timing gate: one press is enough.
 *   ctrl+c (busy, 1st) interrupt the running turn. No timing gate, no hint.
 *                     A one-shot latch remembers the interrupt so the NEXT
 *                     ctrl+c (any time later) opens the quit dialog. A fresh
 *                     turn (busy rising from false) restarts the cycle.
 *   ctrl+c (busy, 2nd+) open the quit confirmation dialog.
 *
 * The old "double press inside CTRL_C_QUIT_WINDOW_MS to quit" gate is GONE.
 * Real double presses routinely missed the 500ms window (terminal latency +
 * human rhythm), and on a busy turn the FIRST press was spent on the
 * interrupt — which is exactly why "press ctrl+c twice" kept failing. The
 * dialog is now a deliberate, timing-free step.
 *
 * Precondition: the renderer runs with `exitOnCtrlC: false`. OpenTUI's
 * default (`true`, core renderer: `config.exitOnCtrlC === undefined ? true`)
 * intercepts ctrl+c in the raw key handler BEFORE any keymap layer and
 * schedules `exitHandler` on nextTick — that bypassed the page's shutdown
 * and left a wiped, never-repainted frame.
 *
 * Both keys are gated by `enabled` (pass "no dialog is open"). The quit dialog
 * lives on the DialogProvider stack, so while it is open this layer is off and
 * Esc / Ctrl+C belong to the dialog: Esc cancels, Ctrl+C closes it. Neither
 * reaches the running task.
 *
 * DIVERGENCE (spec §6, docs/ask-user-panel-spec.md): the ask dock's Ctrl+C
 * declines the batch and closes the dock, which is one keypress away from
 * this layer owning Ctrl+C again. A naive reading of "first press declines,
 * second press interrupts" would let that second press open the quit dialog,
 * so a third press would quit from a sequence the user read as "dismiss the
 * panel, stop the turn". Therefore the dock's Ctrl+C arms a ONE-SHOT non-arming
 * interrupt (`armNonArmingInterrupt`) and the next page-level Ctrl+C on a busy
 * turn interrupts WITHOUT opening the dialog. Only a further press opens it.
 * Acceptance invariant: three consecutive Ctrl+C presses with a busy turn and
 * an open dock end at "turn interrupted, app still running".
 */
import { createSignal, onCleanup, Show } from "solid-js"
import { Keymap } from "../../context/keymap"
import { useThemeOptional } from "../../context/theme"
import { t } from "../../i18n"
import { useDialog } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"

/** Window for the armed esc stop (tui-pi contract range 150-500ms — DOUBLE_PRESS_MS parity). */
export const CTRL_C_QUIT_WINDOW_MS = 500

/**
 * One-shot non-arming interrupt (spec §6; see the divergence note above).
 *
 * The ask dock's Ctrl+C sets it when it declines the batch and closes the
 * dock; the next page-level Ctrl+C consumes it: on a busy turn it interrupts
 * and returns WITHOUT opening the quit dialog, on an idle page it falls through
 * to the normal chain (the flag is spent either way).
 *
 * Module scope is deliberate: the dock (a page component below the keymap
 * provider) and `TurnCancelKeys` (the page's cancel layer) are separate
 * component trees and share no controller handle.
 */
let nonArmingInterrupt = false

/** Arm the next Ctrl+C to interrupt without touching the quit chain. */
export function armNonArmingInterrupt(): void {
	nonArmingInterrupt = true
}

/** Drop a pending one-shot (tests; a fresh app boot starts unarmed). */
export function resetNonArmingInterrupt(): void {
	nonArmingInterrupt = false
}

function consumeNonArmingInterrupt(): boolean {
	const armed = nonArmingInterrupt
	nonArmingInterrupt = false
	return armed
}

/** Which chain currently owns the arm affordance (only esc arms now). */
export type ArmKey = "escape"

export type TurnCancelKeysProps = {
	/** A turn is running (composer/page busy signal). */
	busy: () => boolean
	/** Abort the running turn (`seam.interrupt()`). */
	interrupt: () => void
	/**
	 * Open the stop-everything confirmation dialog (U6): on the user's
	 * confirm the caller stops the main turn AND every live subagent.
	 * Presence switches Esc to the double-press + confirm contract; absent,
	 * Esc keeps the legacy single-press interrupt.
	 */
	confirmStop?: () => void
	/** Clean quit (the page's shutdown path) — the quit dialog's confirm leg. */
	quit: () => void
	/** Layer gate — pass "no dialog is open". */
	enabled: () => boolean
	/** Esc is left to the composer while this is true (slash palette open). */
	escapeYields?: () => boolean
	/** Esc arm window override (tests). */
	windowMs?: number
}

/**
 * Key decisions, split out so tests drive them without a renderer.
 *
 * `confirmQuit` opens the quit dialog (the component wires it to a
 * DialogConfirm whose confirm calls `props.quit`); tests pass a spy.
 */
export function createTurnCancel(
	props: TurnCancelKeysProps,
	onArm: (armed: boolean, key: ArmKey) => void,
	confirmQuit: () => void,
) {
	const windowMs = props.windowMs ?? CTRL_C_QUIT_WINDOW_MS
	let timer: ReturnType<typeof setTimeout> | undefined
	let armedKey: ArmKey | undefined
	// A busy Ctrl+C already interrupted the turn; the next Ctrl+C must open the
	// quit dialog regardless of whether busy has settled yet (no timing gate).
	let busyInterrupted = false
	// Tracks the busy value AFTER each press's side effects, so a fresh turn
	// (busy rising from false) starts a new interrupt → dialog cycle.
	let lastBusy = false
	const disarm = () => {
		if (timer) clearTimeout(timer)
		timer = undefined
		const key = armedKey
		armedKey = undefined
		if (key) onArm(false, key)
	}
	const arm = (key: ArmKey, beforeExpire?: () => void) => {
		if (timer) clearTimeout(timer)
		armedKey = key
		onArm(true, key)
		timer = setTimeout(() => {
			timer = undefined
			beforeExpire?.()
			disarm()
		}, windowMs)
	}
	return {
		/** false = not consumed (the key falls through). */
		escape(): boolean {
			if (!props.busy() || props.escapeYields?.()) return false
			// Legacy contract (no confirm face): the single press fires.
			if (!props.confirmStop) {
				props.interrupt()
				return true
			}
			// U6 double-press: the 1st press only arms, the 2nd opens the
			// confirmation dialog. A held key's auto-repeat lands far closer
			// than the window and still fires the dialog on a second arrival —
			// harmless: the dialog ignores nothing but cancel costs nothing.
			if (armedKey === "escape") {
				disarm()
				props.confirmStop()
				return true
			}
			arm("escape")
			return true
		},
		ctrlC(): boolean {
			// An armed esc window must not survive into the ctrl+c chain: its
			// timer and affordance are cleared first (tui-pi parity — handleExit
			// clears the interrupt arm).
			if (armedKey === "escape") disarm()

			const busy = props.busy()
			// A fresh turn (busy just rose) restarts the interrupt/dialog cycle.
			if (busy && !lastBusy) busyInterrupted = false

			// The press after the ask dock's own Ctrl+C decline: interrupt a busy
			// turn and NOTHING else — no dialog (spec §6 hazard).
			if (consumeNonArmingInterrupt() && busy) {
				props.interrupt()
				busyInterrupted = true
				lastBusy = props.busy()
				return true
			}

			// Busy, first press: interrupt only. The latch makes the follow-up
			// press open the dialog even if busy has not settled yet.
			if (busy && !busyInterrupted) {
				props.interrupt()
				busyInterrupted = true
				lastBusy = props.busy()
				return true
			}

			// Idle, or a follow-up press after a busy interrupt → quit dialog.
			busyInterrupted = false
			lastBusy = props.busy()
			confirmQuit()
			return true
		},
		dispose: disarm,
	}
}

export function TurnCancelKeys(props: TurnCancelKeysProps) {
	const theme = useThemeOptional()
	const dialog = useDialog()
	const [armed, setArmed] = createSignal<ArmKey | undefined>(undefined)
	const openQuitDialog = () => {
		dialog.replace(
			() => (
				<DialogConfirm
					title={t("turn.quit.confirmTitle")}
					message={t("turn.quit.confirmMessage")}
					label={{ confirm: t("turn.quit.confirmLabel"), cancel: t("turn.quit.cancelLabel") }}
					onConfirm={props.quit}
				/>
			),
			undefined,
			{ tone: "warning" },
		)
	}
	const cancel = createTurnCancel(props, (value, key) => setArmed(value ? key : undefined), openQuitDialog)
	onCleanup(() => cancel.dispose())
	Keymap.createLayer(() => ({
		mode: "global",
		// ADR-R4: the turn cancel layer is `main` tier. Under a dialog/panel/dock
		// frame Esc and Ctrl+C belong to that surface, never to the page.
		capture: "main",
		enabled: props.enabled(),
		commands: [
			{
				bind: "escape",
				title: props.confirmStop ? "Stop current turn (press Esc twice)" : "Interrupt current turn",
				group: "Session",
				run: () => cancel.escape(),
			},
			{ bind: "ctrl+c", title: "Quit / interrupt turn", group: "Session", run: () => cancel.ctrlC() },
		],
	}))
	return (
		<Show when={armed()}>
			<box height={1} flexShrink={0} paddingLeft={1}>
				<text fg={theme?.text.feedback.warning.base ?? "#e0af68"} wrapMode="none">
					{t("turn.stop.escHint")}
				</text>
			</box>
		</Show>
	)
}
