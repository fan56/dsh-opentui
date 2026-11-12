/**
 * Adapted from @opencode/tui, Copyright 2025 opencode, MIT
 *
 * Dropdown (spec §3.9): one trigger row `label  value ▾` plus an in-panel
 * popup list — NOT a new stack layer. Open/Close state machine, Up/Down
 * selection over enabled options, Enter selects and closes, Esc closes ONLY
 * the popup (inner-first) and reports the event as unconsumed when closed so
 * the panel's back action proceeds. Esc is the only popup dismissal: no
 * click-outside (user directive 2026-11-12).
 *
 * Anchoring (known simplification, reported): the popup renders directly
 * below the trigger row inside the trigger's relative container. The spec's
 * absolute anchoring inside a scrolling body (anchor invalidation when the
 * trigger scrolls, flip-above when <5 rows remain below) is T17 work.
 */
import { For, Show, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import type { DropdownOption, DropdownProps, PanelKeyCommands } from "../contracts"
import { useControlKeys, usePanelTheme } from "../theme"

/** Spec §3.9: max 8 rows in the popup, scroll beyond that. */
export const DROPDOWN_MAX_ROWS = 8

export interface DropdownWindow<T> {
  /** Index of the first rendered option. */
  start: number
  rows: DropdownOption<T>[]
}

export interface DropdownModel<T = unknown> {
  open(): boolean
  cursor(): number
  window(): DropdownWindow<T>
  triggerLabel(): string
  triggerGlyph(): string
  toggle(): void
  close(): void
  /** Walk to the next enabled option in `direction` (+1/-1); clamped at ends. */
  move(direction: number): void
  /** Enter on the cursor option: onChange + close. False when nothing fired. */
  select(): boolean
  /**
   * Reserved-key dispatch ("enter" | "space" | "up" | "down" | "escape").
   * "escape" returns true only when it closed the popup (consumed); when the
   * popup is already closed it returns false so the panel can handle Esc.
   */
  command(id: string): boolean
}

function sameValue(a: unknown, b: unknown): boolean {
  return Object.is(a, b)
}

export function createDropdownModel<T>(props: DropdownProps<T>): DropdownModel<T> {
  const [open, setOpen] = createSignal(false)
  const [cursor, setCursor] = createSignal(0)
  const [start, setStart] = createSignal(0)

  const selectedOption = () => props.options.find((option) => sameValue(option.value, props.value))

  const ensureVisible = () => {
    const index = cursor()
    setStart((current) => {
      if (index < current) return index
      if (index >= current + DROPDOWN_MAX_ROWS) return index - DROPDOWN_MAX_ROWS + 1
      return current
    })
  }

  const firstEnabled = (direction: number, from: number): number => {
    for (let index = from; index >= 0 && index < props.options.length; index += direction) {
      if (!props.options[index]?.disabled) return index
    }
    return cursor()
  }

  const toggle = () => {
    if (props.disabled) return
    if (open()) {
      setOpen(false)
      return
    }
    const current = selectedOption()
    const index = current ? props.options.indexOf(current) : 0
    setCursor(firstEnabled(1, index < 0 ? 0 : index))
    setStart(Math.max(0, Math.min(cursor(), props.options.length - DROPDOWN_MAX_ROWS)))
    setOpen(true)
  }

  const close = () => setOpen(false)

  const move = (direction: number) => {
    if (!open()) return
    const next = firstEnabled(direction, cursor() + direction)
    setCursor(next)
    ensureVisible()
  }

  const select = (): boolean => {
    if (!open()) return false
    const option = props.options[cursor()]
    if (!option || option.disabled) return false
    props.onChange(option.value, option)
    setOpen(false)
    return true
  }

  const command = (id: string): boolean => {
    switch (id) {
      case "escape":
        if (!open()) return false
        close()
        return true
      case "enter":
      case "space":
        if (!open()) {
          toggle()
          return true
        }
        select()
        return true
      case "up":
        if (!open()) return false
        move(-1)
        return true
      case "down":
        if (!open()) return false
        move(1)
        return true
      default:
        return false
    }
  }

  const window = (): DropdownWindow<T> => {
    const from = Math.min(start(), Math.max(0, props.options.length - DROPDOWN_MAX_ROWS))
    return { start: from, rows: props.options.slice(from, from + DROPDOWN_MAX_ROWS) }
  }

  const triggerLabel = () => selectedOption()?.label ?? props.placeholder ?? "—"
  const triggerGlyph = () => (open() ? "▸" : "▾")

  return { open, cursor, window, triggerLabel, triggerGlyph, toggle, close, move, select, command }
}

export function Dropdown<T>(props: DropdownProps<T>): JSX.Element {
  const model = createDropdownModel(props)
  const theme = usePanelTheme()
  const registerKeys = useControlKeys()

  const commands = (): PanelKeyCommands => ({
    enter: () => model.command("enter"),
    space: () => model.command("space"),
    escape: () => model.command("escape"),
    up: () => model.command("up"),
    down: () => model.command("down"),
  })

  // While the popup is open it consumes the arrow keys before panel
  // navigation (spec §3.9): the handler registers with the layer's router and
  // returns false for ids it did not consume (T17-INT1 C1/C5).
  onMount(() => {
    const dispose = registerKeys(commands())
    if (typeof dispose === "function") onCleanup(dispose)
  })

  return (
    <box position="relative" flexDirection="column">
      <box
        flexDirection="row"
        gap={1}
        onMouseUp={() => model.toggle()}
      >
        <Show when={props.label !== undefined}>
          <text fg={theme().text.muted} wrapMode="none">
            {props.label}
          </text>
        </Show>
        <text fg={props.disabled ? theme().text.disabled : theme().text.base} wrapMode="none" flexGrow={1}>
          {model.triggerLabel()}
        </text>
        <text fg={theme().text.muted} wrapMode="none">
          {model.triggerGlyph()}
        </text>
      </box>
      <Show when={model.open()}>
        <box position="absolute" top={1} left={0} width="100%" flexDirection="column">
          <For each={model.window().rows}>
            {(option, index) => {
              const absolute = () => model.window().start + index()
              const activeRow = () => model.cursor() === absolute()
              return (
                <box
                  flexDirection="row"
                  gap={1}
                  backgroundColor={activeRow() ? theme().row.activeBg : undefined}
                  onMouseUp={() => {
                    const at = absolute()
                    if (props.options[at]?.disabled) return
                    model.command("enter")
                  }}
                >
                  <text
                    fg={
                      props.options[absolute()]?.disabled
                        ? theme().text.disabled
                        : activeRow()
                          ? theme().row.activeFg
                          : theme().text.base
                    }
                    wrapMode="none"
                    flexGrow={1}
                  >
                    {option.label}
                  </text>
                  <Show when={option.description !== undefined}>
                    <text fg={activeRow() ? theme().row.activeFg : theme().text.muted} wrapMode="none">
                      {option.description}
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
        </box>
      </Show>
    </box>
  )
}
