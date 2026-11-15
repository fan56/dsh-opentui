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
 *   ctrl+c (1st)      interrupt the running turn (if any) + arm the quit
 *                     affordance: "Press Ctrl+C again to quit" (an armed
 *                     Esc window is cleared first — the two arm chains
 *                     never mix).
 *   ctrl+c (2nd)      inside CTRL_C_QUIT_WINDOW_MS of the 1st → quit()
 *                     (the page's clean shutdown path — tui-pi parity
 *                     "Ctrl+C x2: quit").
 *
 * Precondition: the renderer runs with `exitOnCtrlC: false`. OpenTUI's
 * default (`true`, core renderer: `config.exitOnCtrlC === undefined ? true`)
 * intercepts ctrl+c in the raw key handler BEFORE any keymap layer and
 * schedules `exitHandler` on nextTick — that bypassed the page's shutdown
 * and left a wiped, never-repainted frame.
 *
 * Both keys are gated by `enabled` (pass "no dialog is open"): the
 * DialogProvider stack owns esc/ctrl+c while an overlay is up — the
 * confirm dialog's Esc lands in the dialog (cancel), never at the task.
 */
import { createSignal, onCleanup, Show } from "solid-js"
import { Keymap } from "../../context/keymap"
import { useThemeOptional } from "../../context/theme"
import { t } from "../../i18n"

/** Double-press window for ctrl+c → quit and the armed esc stop (tui-pi
 * contract range 150-500ms — DOUBLE_PRESS_MS parity). */
export const CTRL_C_QUIT_WINDOW_MS = 500

export type CtrlCAction = "arm" | "quit"

/** Pure double-press gate: first press arms, a second press inside the
 * window quits; a late second press re-arms. */
export function createCtrlCGate(windowMs: number = CTRL_C_QUIT_WINDOW_MS, now: () => number = Date.now) {
	let armedAt: number | undefined
	return {
		press(): CtrlCAction {
			const t = now()
			if (armedAt !== undefined && t - armedAt <= windowMs) {
				armedAt = undefined
				return "quit"
			}
			armedAt = t
			return "arm"
		},
		reset(): void {
			armedAt = undefined
		},
	}
}

/** Which chain currently owns the arm affordance. */
export type ArmKey = "escape" | "ctrl-c"

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
	/** Clean quit (the page's shutdown path). */
	quit: () => void
	/** Layer gate — pass "no overlay is open". */
	enabled: () => boolean
	/** Esc is left to the composer while this is true (slash palette open). */
	escapeYields?: () => boolean
	/** Double-press window override (tests). */
	windowMs?: number
}

/** Key decisions, split out so tests drive them without a renderer. */
export function createTurnCancel(props: TurnCancelKeysProps, onArm: (armed: boolean, key: ArmKey) => void) {
	const windowMs = props.windowMs ?? CTRL_C_QUIT_WINDOW_MS
	const gate = createCtrlCGate(windowMs)
	let timer: ReturnType<typeof setTimeout> | undefined
	let armedKey: ArmKey | undefined
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
			// The esc arm must not survive into the ctrl+c chain: its timer and
			// affordance are cleared before the quit gate runs (tui-pi parity —
			// handleExit clears the interrupt arm).
			if (armedKey === "escape") disarm()
			if (gate.press() === "quit") {
				disarm()
				props.quit()
				return true
			}
			if (props.busy()) props.interrupt()
			arm("ctrl-c", () => gate.reset())
			return true
		},
		dispose: disarm,
	}
}

export function TurnCancelKeys(props: TurnCancelKeysProps) {
	const theme = useThemeOptional()
	const [armed, setArmed] = createSignal<ArmKey | undefined>(undefined)
	const cancel = createTurnCancel(props, (value, key) => setArmed(value ? key : undefined))
	onCleanup(() => cancel.dispose())
	Keymap.createLayer(() => ({
		mode: "global",
		enabled: props.enabled(),
		commands: [
			{
				bind: "escape",
				title: props.confirmStop ? "Stop current turn (press Esc twice)" : "Interrupt current turn",
				group: "Session",
				run: () => cancel.escape(),
			},
			{ bind: "ctrl+c", title: "Interrupt / quit (press twice)", group: "Session", run: () => cancel.ctrlC() },
		],
	}))
	return (
		<Show when={armed()}>
			<box height={1} flexShrink={0} paddingLeft={1}>
				<text fg={theme?.text.feedback.warning.base ?? "#e0af68"} wrapMode="none">
					{armed() === "escape" ? t("turn.stop.escHint") : "Press Ctrl+C again to quit"}
				</text>
			</box>
		</Show>
	)
}
