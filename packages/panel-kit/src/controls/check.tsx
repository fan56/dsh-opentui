/**
 * check.tsx — Check (spec §3.7): ✔/✘ marker that doubles as the kit's boolean
 * toggle (T18 switches map to interactive Check rows), plus a half-selected
 * "mixed" state for tri-state flows. Glyphs swap instantly — Check is not an
 * animated switch (spec §3.7).
 *
 * The mixed state is part of CheckProps now (T17-INT1 B1): `indeterminate`
 * marks the half state, rendered with `▌` (spec §5.2 glyph vocabulary).
 *
 * Adapted from @opencode/tui, Copyright 2025 opencode, MIT
 */
import type { KeyEvent } from "@opentui/core"
import type { JSX } from "solid-js"
import { Show } from "solid-js"
import type { CheckProps, PanelTheme } from "../contracts"
import { useControlTheme } from "./list"

/** Visual state of the check: on (✔), off (✘), or mixed (▌, half-selected). */
export type CheckState = "on" | "off" | "mixed"

/** Kept as an alias: the tri-state fields are part of CheckProps (T17-INT1 B1). */
export type CheckControlProps = CheckProps

export function checkStateOf(checked: boolean, indeterminate?: boolean): CheckState {
  return indeterminate ? "mixed" : checked ? "on" : "off"
}

/**
 * Tri-state toggle migration (Space/Enter): off → on, on → off, mixed → on.
 * The mixed state resolves to a definite value on the first toggle.
 */
export function nextCheckState(current: CheckState): CheckState {
  switch (current) {
    case "on":
      return "off"
    case "off":
      return "on"
    case "mixed":
      return "on"
  }
}

/**
 * Keyboard toggle dispatch for an interactive Check. Returns the next `checked`
 * value when an event should fire, undefined when the check is inert (disabled
 * or read-only — no onChange).
 */
export function toggleCheck(
  props: Pick<CheckControlProps, "checked" | "indeterminate" | "disabled" | "onChange">,
): boolean | undefined {
  if (props.disabled || props.onChange === undefined) return undefined
  const next = nextCheckState(checkStateOf(props.checked, props.indeterminate))
  const checked = next === "on"
  props.onChange(checked)
  return checked
}

function glyphOf(props: CheckControlProps): string {
  switch (checkStateOf(props.checked, props.indeterminate)) {
    case "on":
      return props.trueGlyph ?? "✔"
    case "off":
      return props.falseGlyph ?? "✘"
    case "mixed":
      return props.indeterminateGlyph ?? "▌"
  }
}

function glyphColor(theme: PanelTheme, props: CheckControlProps) {
  if (props.disabled) return theme.text.disabled
  switch (checkStateOf(props.checked, props.indeterminate)) {
    case "on":
      return props.trueTone === "accent" ? theme.text.accent : theme.text.success
    case "off":
      return props.falseTone === "danger" ? theme.text.danger : theme.text.faint
    case "mixed":
      return theme.text.muted
  }
}

export function Check(props: CheckControlProps): JSX.Element {
  const theme = useControlTheme()
  const interactive = () => props.onChange !== undefined && !props.disabled

  function onKeyDown(key: KeyEvent) {
    if (key.name !== "return" && key.name !== "enter" && key.name !== "space") return
    if (toggleCheck(props) === undefined) return
    key.preventDefault()
    key.stopPropagation()
  }

  return (
    <box flexDirection="row" focusable={interactive()} onKeyDown={interactive() ? onKeyDown : undefined}>
      <text fg={glyphColor(theme(), props)}>{glyphOf(props)}</text>
      <Show when={props.label !== undefined}>
        <text fg={props.disabled ? theme().text.disabled : theme().text.base}>
          {" " + props.label}
        </text>
      </Show>
    </box>
  )
}
