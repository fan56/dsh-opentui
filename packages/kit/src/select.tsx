/**
 * Select — the unified picker, wrapping the native OpenTUI <select>
 * intrinsic so keyboard navigation (arrows, fast-scroll, enter) comes
 * from the engine instead of a hand-rolled key loop.
 *
 * Verified against @opentui/core 0.7.0 with a headless bun probe:
 * - the intrinsic paints only with an EXPLICIT width/height (auto height
 *   inside a flex column collapses to zero rows), so both are computed
 *   here;
 * - enter emits `onSelect` with the mapped SelectOption;
 * - a lone escape is NOT consumed by the select and still surfaces
 *   through the renderer keypress stream — `useKeyboard` turns it into
 *   onCancel.
 */
import { Show, type JSX } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { SelectOption } from "@opentui/core"
import type { Theme } from "./theme.ts"

export interface SelectItem {
  label: string
  description?: string
  group?: string
  value: string
}

/** Items visible at once; longer lists scroll inside the select. */
const MAX_VISIBLE_ITEMS = 12
/** Highlight background when the theme defines no selection token. */
const FALLBACK_SELECTION_BG = "#313244"

export function Select(props: {
  title: string
  items: SelectItem[]
  theme: Theme
  onSelect: (value: string) => void
  onCancel: () => void
}): JSX.Element {
  // Escape is the one key the native select leaves alone; the hook stays
  // live for the whole mount, so an empty picker can still be dismissed.
  useKeyboard((key) => {
    if (key.name === "escape") props.onCancel()
  })

  const th = () => props.theme

  // The native SelectOption wants a string description and has no group
  // field, so the group rides along on the description line.
  const options = (): SelectOption[] =>
    props.items.map((it) => ({
      name: it.label,
      description: [it.group, it.description].filter(Boolean).join(" · "),
      value: it.value,
    }))

  // Items are two lines (label + description) when anything carries a
  // description or group; a blank description still burns a row
  // otherwise, so undecorated lists switch to compact one-line items.
  const hasDescriptions = () => props.items.some((it) => Boolean(it.description || it.group))
  const linesPerItem = () => (hasDescriptions() ? 2 : 1)
  const visibleItems = () => Math.min(props.items.length, MAX_VISIBLE_ITEMS)

  return (
    <Show when={props.items.length > 0}>
      <box
        style={{
          border: true,
          borderStyle: "rounded",
          borderColor: th().tokens.border,
          flexDirection: "column",
          padding: 1,
        }}
      >
        <box style={{ flexDirection: "row" }}>
          <text style={{ fg: th().tokens.accent }}>{props.title}</text>
          <box style={{ flexGrow: 1 }} />
          <text style={{ fg: th().tokens.dim }}>↑↓ move · enter select · esc cancel</text>
        </box>
        <select
          options={options()}
          selectedIndex={0}
          focused={true}
          width="100%"
          height={visibleItems() * linesPerItem()}
          textColor={th().tokens.text}
          descriptionColor={th().tokens.dim}
          focusedBackgroundColor={th().tokens.selection ?? FALLBACK_SELECTION_BG}
          focusedTextColor={th().tokens.text}
          selectedBackgroundColor={th().tokens.selection ?? FALLBACK_SELECTION_BG}
          selectedTextColor={th().tokens.text}
          showDescription={hasDescriptions()}
          showScrollIndicator={props.items.length > visibleItems()}
          onSelect={(_index, option) => {
            if (option) props.onSelect(String(option.value))
          }}
        />
      </box>
    </Show>
  )
}
