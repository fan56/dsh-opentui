/**
 * TurnCancelKeys — the cancel/quit contract for the rebuilt view (batch V2).
 *
 *   escape            running turn → seam.interrupt() (abort; the turn
 *                     promise settles, busy → false, status line unmounts).
 *                     Idle / palette open → NOT consumed (falls through to
 *                     the composer, so the slash palette's esc still closes).
 *   ctrl+c (1st)      interrupt the running turn (if any) + arm the quit
 *                     affordance: "Press Ctrl+C again to quit".
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
 * DialogProvider stack owns esc/ctrl+c while an overlay is up.
 */
import { createSignal, onCleanup, Show } from "solid-js"
import { Keymap } from "../../context/keymap"
import { useThemeOptional } from "../../context/theme"

/** Double-press window for ctrl+c → quit (tui-pi contract range 150-500ms). */
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

export type TurnCancelKeysProps = {
	/** A turn is running (composer/page busy signal). */
	busy: () => boolean
	/** Abort the running turn (`seam.interrupt()`). */
	interrupt: () => void
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
export function createTurnCancel(props: TurnCancelKeysProps, onArm: (armed: boolean) => void) {
	const windowMs = props.windowMs ?? CTRL_C_QUIT_WINDOW_MS
	const gate = createCtrlCGate(windowMs)
	let timer: ReturnType<typeof setTimeout> | undefined
	const disarm = () => {
		if (timer) clearTimeout(timer)
		timer = undefined
		onArm(false)
	}
	return {
		/** false = not consumed (the key falls through). */
		escape(): boolean {
			if (!props.busy() || props.escapeYields?.()) return false
			props.interrupt()
			return true
		},
		ctrlC(): boolean {
			if (gate.press() === "quit") {
				disarm()
				props.quit()
				return true
			}
			if (props.busy()) props.interrupt()
			if (timer) clearTimeout(timer)
			onArm(true)
			timer = setTimeout(() => {
				gate.reset()
				disarm()
			}, windowMs)
			return true
		},
		dispose: disarm,
	}
}

export function TurnCancelKeys(props: TurnCancelKeysProps) {
	const theme = useThemeOptional()
	const [armed, setArmed] = createSignal(false)
	const cancel = createTurnCancel(props, setArmed)
	onCleanup(() => cancel.dispose())
	Keymap.createLayer(() => ({
		mode: "global",
		enabled: props.enabled(),
		commands: [
			{ bind: "escape", title: "Interrupt current turn", group: "Session", run: () => cancel.escape() },
			{ bind: "ctrl+c", title: "Interrupt / quit (press twice)", group: "Session", run: () => cancel.ctrlC() },
		],
	}))
	return (
		<Show when={armed()}>
			<box height={1} flexShrink={0} paddingLeft={1}>
				<text fg={theme?.text.feedback.warning.base ?? "#e0af68"} wrapMode="none">
					Press Ctrl+C again to quit
				</text>
			</box>
		</Show>
	)
}
