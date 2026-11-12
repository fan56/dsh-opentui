/**
 * button.tsx — Button (spec §3.6): primary/ghost/danger variants, one line
 * tall, key-hint suffix aligned with the upstream button-group form
 * (ui/dialog.tsx:216-338). The focused state reuses the list-row highlight
 * tokens; hover is expressed through `focused` (keyboard-driven) — the control
 * has no mouse interaction dependency.
 *
 * Adapted from @opencode/tui, Copyright 2025 opencode, MIT
 * (form: ui/dialog.tsx:216-338 footer button group)
 */
import type { KeyEvent } from "@opentui/core"
import type { JSX } from "solid-js"
import { Show } from "solid-js"
import type { ButtonProps, PanelTheme } from "../contracts"
import { useControlTheme } from "./list"

/**
 * Dispatch a button press. Disabled buttons never emit (spec §3.6). Returns
 * true when `onPress` ran — the key layer calls this for Enter/Space.
 */
export function pressButton(props: Pick<ButtonProps, "onPress" | "disabled">): boolean {
  if (props.disabled) return false
  props.onPress()
  return true
}

interface ButtonVisual {
  /** undefined = transparent. */
  readonly bg: PanelTheme["row"]["activeBg"] | undefined
  readonly fg: PanelTheme["text"]["base"]
  readonly hintFg: PanelTheme["text"]["muted"]
}

/**
 * Variant/state → theme tokens. All values come from PanelTheme; the kit never
 * hardcodes colors (spec §7.2). Focused reuses the list-row highlight tokens
 * (spec §3.6: "same highlight tokens as a list row").
 */
export function buttonVisual(
  theme: PanelTheme,
  props: Pick<ButtonProps, "variant" | "focused" | "disabled">,
): ButtonVisual {
  if (props.disabled) {
    return { bg: undefined, fg: theme.text.disabled, hintFg: theme.text.disabled }
  }
  if (props.focused) {
    return { bg: theme.row.activeBg, fg: theme.row.activeFg, hintFg: theme.row.activeFg }
  }
  switch (props.variant ?? "ghost") {
    case "primary":
      // action-primary background + foreground; the projected theme carries
      // them as the row highlight tokens (see contract revision request).
      return { bg: theme.row.activeBg, fg: theme.row.activeFg, hintFg: theme.row.activeFg }
    case "danger":
      return { bg: undefined, fg: theme.text.danger, hintFg: theme.text.muted }
    default:
      return { bg: undefined, fg: theme.text.base, hintFg: theme.text.muted }
  }
}

export function Button(props: ButtonProps): JSX.Element {
  const theme = useControlTheme()
  const visual = () => buttonVisual(theme(), props)

  function onKeyDown(key: KeyEvent) {
    if (key.name !== "return" && key.name !== "enter" && key.name !== "space") return
    if (pressButton(props)) {
      key.preventDefault()
      key.stopPropagation()
    }
  }

  return (
    <box
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
      backgroundColor={visual().bg}
      focusable={!props.disabled}
      onKeyDown={props.disabled ? undefined : onKeyDown}
    >
      <text fg={visual().fg}>{props.label}</text>
      <Show when={props.keyHint !== undefined}>
        <text fg={visual().hintFg} attributes={theme().attributes.keyHint}>
          {" " + props.keyHint}
        </text>
      </Show>
    </box>
  )
}
