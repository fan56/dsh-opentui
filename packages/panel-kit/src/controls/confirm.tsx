/**
 * Adapted from @opencode/tui, Copyright 2025 opencode, MIT
 *
 * ConfirmDialog content body (spec §3.8): message block + confirm/cancel
 * button row composed from the lane-B `Button` (contracts.ButtonProps).
 *
 * Key semantics (user directive 2026-11-13, supersedes 2026-11-12):
 *   - Enter and Space activate the focused action; Esc is always Cancel;
 *     Left/Right and Tab/Shift+Tab cycle the active action and the highlight
 *     repaints immediately. Esc is the only back action: there is no
 *     mouse-driven exit (no click-outside, no scrim dismiss).
 *   - Tab is the one key the panel router does not carry (`panel.tsx` reserves
 *     escape/enter/space/arrows), so the dialog also listens for it on the
 *     renderer. A host that later routes Tab through the kit table owns it
 *     first: a consumed key never reaches the raw listener (no double toggle).
 *   - `destructive` puts the initial focus on Cancel and gives the confirm
 *     button the danger variant.
 *   - After an action fires both buttons disable and further keys are inert
 *     (double-submit guard while the stack waits for the promise to settle).
 *   - The hint line under the buttons is owned here, not by consumers.
 *
 * This file used to own a second kit context (Symbol.for registry); T17-INT1
 * B3/C2 collapsed it into src/theme.ts. The re-exports below keep the module
 * API stable, but there is only one context identity in the package.
 */
import { useKeyboard } from "@opentui/solid"
import { createSignal, onCleanup, onMount, type Accessor, type JSX } from "solid-js"
import type {
  ConfirmDialogProps,
  PanelButtonVariant,
  PanelKeyCommands,
  PanelTheme,
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
   * Reserved-key dispatch ("enter" | "space" | "escape" | "left" | "right" |
   * "tab" | "shift+tab"). Returns true when consumed. Everything is consumed
   * while settled so a pending close cannot race panel-level Esc handling.
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
      case "space":
        choose(active())
        return true
      case "escape":
        choose("cancel")
        return true
      case "left":
      case "right":
      case "tab":
      case "shift+tab":
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
      // Esc always cancels; Enter activates whichever button is focused, so
      // the activation hint travels with the focus instead of living on one
      // fixed button (a static "enter" on the confirm side misled users into
      // thinking Enter would discard while Cancel was focused).
      keyHint: active() === "cancel" && !settled() ? "esc / enter" : "esc",
      disabled: settled(),
      focused: active() === "cancel" && !settled(),
      onPress: () => choose("cancel"),
    },
    confirm: {
      label: props.confirmLabel ?? "Confirm",
      variant: props.destructive || props.tone === "danger" ? "danger" : "primary",
      keyHint: active() === "confirm" && !settled() ? "enter" : "",
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
    space: () => model.command("space"),
    escape: () => model.command("escape"),
    left: () => model.command("left"),
    right: () => model.command("right"),
    tab: () => model.command("tab"),
    "shift+tab": () => model.command("shift+tab"),
  })

  onMount(() => {
    const dispose = registerKeys(commands())
    if (typeof dispose === "function") onCleanup(dispose)
  })

  // The panel router does not carry Tab (see the file header). Listen on the
  // renderer for the physical key; keymap layers are consulted first, so a
  // host that routes Tab through the kit table never double-toggles here.
  useKeyboard((key) => {
    if (key.name !== "tab") return
    if (model.command(key.shift ? "shift+tab" : "tab")) {
      key.preventDefault()
      key.stopPropagation()
    }
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
    <box flexDirection="column">
      {typeof props.message === "string" ? (
        <text wrapMode="word" fg={messageTone()}>
          {props.message}
        </text>
      ) : (
        props.message
      )}
      <box flexDirection="row" justifyContent="flex-end" gap={2} flexShrink={0} marginTop={1}>
        <ConfirmButton state={cancel} theme={theme} />
        <ConfirmButton state={confirm} theme={theme} />
      </box>
      <box flexDirection="row" justifyContent="flex-end" flexShrink={0}>
        <text fg={theme().text.muted} attributes={theme().attributes.keyHint} wrapMode="none">
          {/* The Esc verb follows the cancel button's own label, so a consumer
              that renames Cancel ("返回" in /settings) never sees the hint and
              the button disagree. */}
          {`←→ 选择 · Enter 确认 · Esc ${props.cancelLabel ?? "Cancel"}`}
        </text>
      </box>
    </box>
  )
}

/**
 * One button inside a full four-sided frame so it reads as a button in both
 * states, not just when focused (the danger variant has no background of its
 * own). The inner Button keeps its one-space left/right padding, so the frame
 * sits one cell outside the label on every side. Both border tokens come from
 * the panel theme; the focused state keeps the list-row highlight tokens the
 * Button already paints.
 */
function ConfirmButton(props: {
  state: Accessor<ConfirmButtonState>
  theme: Accessor<PanelTheme>
}): JSX.Element {
  const token = () =>
    props.state().focused
      ? props.theme().border.focused
      : props.theme().border.base
  return (
    <box
      flexShrink={0}
      border={["top", "right", "bottom", "left"]}
      borderStyle={token().style}
      borderColor={token().color}
    >
      <Button
        label={props.state().label}
        variant={props.state().variant}
        // An empty hint means "no suffix": passing "" would still paint the
        // leading space, leaving the frame with two cells on the right and one
        // on the left.
        keyHint={props.state().keyHint || undefined}
        disabled={props.state().disabled}
        focused={props.state().focused}
        onPress={props.state().onPress}
      />
    </box>
  )
}
