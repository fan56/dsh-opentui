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
import { Show, createSignal, type JSX } from "solid-js"
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

/** Keep a highlight index inside the items range. */
const clamp = (v: number, n: number) => (n === 0 ? 0 : Math.max(0, Math.min(n - 1, v)))

export function Select(props: {
  title: string
  items: SelectItem[]
  theme: Theme
  onSelect: (value: string) => void
  /** Fires as the highlight moves (live preview); not fired on confirm. */
  onPreview?: (value: string) => void
  onCancel: () => void
}): JSX.Element {
  // Controlled highlight + exclusive key ownership: the native select's
  // OWN enter handling does not fire under the real renderer (verified in
  // a live boot), while its arrow handling DOES — so routing arrows
  // through BOTH paths double-advances the highlight (observed +4 per
  // key). Global listeners run before the focused renderable, and a
  // preventDefault() in them makes the renderable skip the key entirely
  // (the mechanism InputLine's onKeyDown already relies on) — so we claim
  // arrows/enter/escape here and the native select becomes display-only.
  // onSelect dedupes within a 250ms window as a final safety.
  const [index, setIndex] = createSignal(0)
  let lastFire = 0
  const fire = (i: number) => {
    const opt = options()[i]
    if (!opt) return
    const now = Date.now()
    if (now - lastFire < 250) return
    lastFire = now
    props.onSelect(String(opt.value))
  }
  useKeyboard((key) => {
    const n = props.items.length
    if (key.name === "escape") {
      key.preventDefault?.()
      return props.onCancel()
    }
    if (n === 0) return
    // left/right navigate too — horizontal pickers (few options) read
    // naturally with arrows in both axes (left = previous, right = next)
    if (key.name === "up" || key.name === "left") {
      key.preventDefault?.()
      const v = (index() - 1 + n) % n
      setIndex(v)
      props.onPreview?.(props.items[v]?.value ?? "")
      return
    }
    if (key.name === "down" || key.name === "right") {
      key.preventDefault?.()
      const v = (index() + 1) % n
      setIndex(v)
      props.onPreview?.(props.items[v]?.value ?? "")
      return
    }
    if (key.name === "return" || key.name === "enter") {
      key.preventDefault?.()
      fire(clamp(index(), n))
    }
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
          selectedIndex={clamp(index(), props.items.length)}
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
          onSelect={(i, option) => {
            if (option) fire(i ?? clamp(index(), props.items.length))
          }}
        />
      </box>
    </Show>
  )
}
