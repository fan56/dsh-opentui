/**
 * Adapted from @opencode/tui, Copyright 2025 opencode, MIT
 *
 * InputRow (spec §3.10): one settings-row control covering
 *   - text input (single line, real `InputRenderable` mounted while focused),
 *   - number stepper (`◂ 42 ▸`, Left/Right step by `step`, clamped to
 *     [min, max], one step per key event — no fast-repeat ramp),
 *   - readOnly static value rows (T18 read-only items),
 *   - validation error state under the row (theme.text.danger token).
 *
 * Commit rules (`commit` selects the auto trigger; Enter always commits):
 *   - "enter"  (default): onCommit fires from Enter / stepper settle.
 *   - "blur":  onCommit also fires on blur (the row losing focus).
 *   - "change": onCommit also fires per edit.
 * Stepper settle always commits (spec §3.10 "onCommit: Enter / blur /
 * stepper settle").
 */
import { Show, createSignal, onCleanup, type JSX } from "solid-js"
import type { InputRowProps, PanelKeyCommands } from "../contracts"
import { useControlKeys, usePanelTheme } from "../theme"

export interface InputRowModel {
  /** Live editing buffer (string form). */
  text(): string
  focused(): boolean
  focus(): void
  blur(): void
  readOnly(): boolean
  disabled(): boolean
  /** False for readOnly/disabled rows: they reject every edit and step. */
  canEdit(): boolean
  /** validate() output, or a built-in "Invalid number" for unparsable numbers. */
  error(): string | undefined
  /** What the row paints when not editing (placeholder / masked password). */
  display(): string
  /** Per-keystroke edit; false (and inert) when the row rejects editing. */
  edit(next: string): boolean
  /** Enter: commit the current buffer. False when nothing fired. */
  commit(): boolean
  /** Number rows: one step in `direction` (+1/-1), clamped to [min, max]. */
  step(direction: number): boolean
  /** Reserved-key dispatch ("enter" | "left" | "right"); true when consumed. */
  command(id: string): boolean
}

/** Strict number parsing: empty strings and junk are not numbers. */
export function parseNumberText(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === "") return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function createInputRowModel(props: InputRowProps): InputRowModel {
  const [text, setText] = createSignal(String(props.value ?? ""))
  const [focused, setFocused] = createSignal(false)

  const readOnly = () => props.readOnly === true
  const disabled = () => props.disabled === true
  const canEdit = () => !readOnly() && !disabled()

  const validateValue = (): string | number => {
    if (props.kind === "number") return parseNumberText(text()) ?? text()
    return text()
  }

  const error = (): string | undefined => {
    if (props.kind === "number" && text().trim() !== "" && parseNumberText(text()) === undefined) {
      return "Invalid number"
    }
    return props.validate?.(validateValue())
  }

  const commit = (): boolean => {
    if (!canEdit()) return false
    const next = props.kind === "number" ? parseNumberText(text()) : text()
    if (props.kind === "number" && next === undefined) return false
    props.onCommit?.(next as string | number)
    return true
  }

  const edit = (next: string): boolean => {
    if (!canEdit()) return false
    setText(next)
    props.onChange?.(next)
    if (props.commit === "change") commit()
    return true
  }

  const step = (direction: number): boolean => {
    if (!canEdit() || props.kind !== "number") return false
    const size = props.step ?? 1
    const base = parseNumberText(text()) ?? props.min ?? 0
    let next = base + direction * size
    if (props.min !== undefined) next = Math.max(props.min, next)
    if (props.max !== undefined) next = Math.min(props.max, next)
    setText(String(next))
    // Stepper settle is a commit trigger regardless of `commit` mode.
    props.onCommit?.(next)
    return true
  }

  const blur = () => {
    if (!focused()) return
    setFocused(false)
    if (props.commit === "blur") commit()
  }

  const command = (id: string): boolean => {
    if (!focused() || !canEdit()) return false
    switch (id) {
      case "enter":
        return commit() || true
      case "left":
        return props.kind === "number" ? (step(-1), true) : false
      case "right":
        return props.kind === "number" ? (step(1), true) : false
      default:
        return false
    }
  }

  const display = (): string => {
    if (props.password && !focused()) return "•".repeat(text().length)
    return text() || props.placeholder || ""
  }

  return {
    text,
    focused,
    focus: () => setFocused(true),
    blur,
    readOnly,
    disabled,
    canEdit,
    error,
    display,
    edit,
    commit,
    step,
    command,
  }
}

export function InputRow(props: InputRowProps): JSX.Element {
  const model = createInputRowModel(props)
  const theme = usePanelTheme()
  const registerKeys = useControlKeys()
  let disposeScope: (() => void) | undefined

  const commands = (): PanelKeyCommands => ({
    enter: () => model.command("enter"),
    left: () => model.command("left"),
    right: () => model.command("right"),
  })

  onCleanup(() => disposeScope?.())

  const valueFg = () => {
    const tokens = theme()
    if (model.disabled()) return tokens.text.disabled
    if (model.error() !== undefined) return tokens.text.danger
    return tokens.text.base
  }

  return (
    <box flexDirection="column">
      <box
        flexDirection="row"
        gap={1}
        onMouseUp={() => {
          if (!model.canEdit()) return
          model.focus()
          disposeScope?.()
          disposeScope = undefined
          const registered = registerKeys(commands())
          if (typeof registered === "function") disposeScope = registered
        }}
      >
        <text fg={theme().text.muted} wrapMode="none">
          {props.label}
        </text>
        <Show
          when={props.kind === "number" && !props.readOnly}
          fallback={
            <Show
              when={model.focused() && model.canEdit() && props.kind !== "number"}
              fallback={
                <text fg={valueFg()} wrapMode="none" flexGrow={1}>
                  {model.display()}
                </text>
              }
            >
              <input
                flexGrow={1}
                value={model.text()}
                placeholder={props.placeholder}
                focused
                onInput={(next: string) => model.edit(next)}
                onSubmit={() => {
                  model.commit()
                  model.blur()
                }}
              />
            </Show>
          }
        >
          <box flexDirection="row" gap={1} flexGrow={1}>
            <text fg={theme().text.accent} wrapMode="none" onMouseUp={() => model.step(-1)}>
              ◂
            </text>
            <text fg={valueFg()} wrapMode="none" flexGrow={1}>
              {model.display()}
            </text>
            <text fg={theme().text.accent} wrapMode="none" onMouseUp={() => model.step(1)}>
              ▸
            </text>
          </box>
        </Show>
        <Show when={props.unit !== undefined}>
          <text fg={theme().text.muted} wrapMode="none">
            {props.unit}
          </text>
        </Show>
      </box>
      <Show when={model.error() !== undefined}>
        <text fg={theme().text.danger} wrapMode="word">
          {model.error()}
        </text>
      </Show>
    </box>
  )
}
