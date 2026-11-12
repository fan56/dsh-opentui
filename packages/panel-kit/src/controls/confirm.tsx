/**
 * Adapted from @opencode/tui, Copyright 2025 opencode, MIT
 *
 * ConfirmDialog content body (spec §3.8): message block + confirm/cancel
 * button row composed from the lane-B `Button` (contracts.ButtonProps).
 *
 * Key semantics (user directive 2026-11-12):
 *   - Enter activates the focused action, Esc is always Cancel, Left/Right
 *     move the active action. Esc is the only back action: there is no
 *     mouse-driven exit (no click-outside, no scrim dismiss).
 *   - `destructive` puts the initial focus on Cancel and gives the confirm
 *     button the danger variant.
 *   - After an action fires both buttons disable and further keys are inert
 *     (double-submit guard while the stack waits for the promise to settle).
 *
 * This file used to own a second kit context (Symbol.for registry); T17-INT1
 * B3/C2 collapsed it into src/theme.ts. The re-exports below keep the module
 * API stable, but there is only one context identity in the package.
 */
import { createSignal, onCleanup, onMount, type JSX } from "solid-js"
import type {
  ConfirmDialogProps,
  PanelButtonVariant,
  PanelKeyCommands,
} from "../contracts"
import { useControlKeys, usePanelTheme } from "../theme"
import { Button } from "./button"

// ---------------------------------------------------------------------------
// Kit context (single canonical host: src/theme.ts)
// ---------------------------------------------------------------------------

export { panelKitContext, usePanelKit, usePanelTheme } from "../theme"

// ---------------------------------------------------------------------------
// Confirm state machine (unit-tested without a renderer)
// ---------------------------------------------------------------------------

export type ConfirmAction = "confirm" | "cancel"

export interface ConfirmButtonState {
  label: string
  variant: PanelButtonVariant
  keyHint: string
  disabled: boolean
  focused: boolean
  onPress: () => void
}

export interface ConfirmModel {
  /** The action Left/Right-highlighted and activated by Enter. */
  active(): ConfirmAction
  /** True once an action fired; both buttons disable from here on. */
  settled(): boolean
  buttons(): Record<ConfirmAction, ConfirmButtonState>
  /**
   * Reserved-key dispatch ("enter" | "escape" | "left" | "right"). Returns
   * true when consumed. Everything is consumed while settled so a pending
   * close cannot race panel-level Esc handling.
   */
  command(id: string): boolean
  choose(action: ConfirmAction): void
}

export function createConfirmModel(props: ConfirmDialogProps): ConfirmModel {
  const [active, setActive] = createSignal<ConfirmAction>(props.destructive ? "cancel" : "confirm")
  const [settled, setSettled] = createSignal(false)

  const choose = (action: ConfirmAction) => {
    if (settled()) return
    // Disable first: the host may keep the dialog mounted until the
    // returned promise settles (spec §3.8), so no double-submit window.
    setSettled(true)
    if (action === "confirm") props.onConfirm()
    else props.onCancel()
  }

  const command = (id: string): boolean => {
    if (settled()) return true
    switch (id) {
      case "enter":
        choose(active())
        return true
      case "escape":
        choose("cancel")
        return true
      case "left":
      case "right":
        setActive((current) => (current === "confirm" ? "cancel" : "confirm"))
        return true
      default:
        return false
    }
  }

  const buttons = (): Record<ConfirmAction, ConfirmButtonState> => ({
    cancel: {
      label: props.cancelLabel ?? "Cancel",
      variant: "ghost",
      keyHint: "esc",
      disabled: settled(),
      focused: active() === "cancel" && !settled(),
      onPress: () => choose("cancel"),
    },
    confirm: {
      label: props.confirmLabel ?? "Confirm",
      variant: props.destructive || props.tone === "danger" ? "danger" : "primary",
      keyHint: "enter",
      disabled: settled(),
      focused: active() === "confirm" && !settled(),
      onPress: () => choose("confirm"),
    },
  })

  return { active, settled, buttons, command, choose }
}

// ---------------------------------------------------------------------------
// ConfirmDialog (spec §3.8): content body only — the panel shell owns the
// title row and frame tone.
// ---------------------------------------------------------------------------

export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  const model = createConfirmModel(props)
  const theme = usePanelTheme()
  const registerKeys = useControlKeys()

  const commands = (): PanelKeyCommands => ({
    enter: () => model.command("enter"),
    escape: () => model.command("escape"),
    left: () => model.command("left"),
    right: () => model.command("right"),
  })

  onMount(() => {
    const dispose = registerKeys(commands())
    if (typeof dispose === "function") onCleanup(dispose)
  })

  const cancel = () => model.buttons().cancel
  const confirm = () => model.buttons().confirm

  const messageTone = () => {
    const tokens = theme()
    if (props.tone === "danger") return tokens.text.danger
    if (props.tone === "accent") return tokens.text.base
    // Default tone is "warning" (contracts §3.8).
    return tokens.text.warning
  }

  return (
    <box flexDirection="column" gap={1}>
      {typeof props.message === "string" ? (
        <text wrapMode="word" fg={messageTone()}>
          {props.message}
        </text>
      ) : (
        props.message
      )}
      <box flexDirection="row" justifyContent="flex-end" gap={2} marginTop={1}>
        <Button
          label={cancel().label}
          variant={cancel().variant}
          keyHint={cancel().keyHint}
          disabled={cancel().disabled}
          focused={cancel().focused}
          onPress={cancel().onPress}
        />
        <Button
          label={confirm().label}
          variant={confirm().variant}
          keyHint={confirm().keyHint}
          disabled={confirm().disabled}
          focused={confirm().focused}
          onPress={confirm().onPress}
        />
      </box>
    </box>
  )
}
