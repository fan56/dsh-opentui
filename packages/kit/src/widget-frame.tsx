/**
 * WidgetFrame — the dock widget template. One reusable frame for every
 * dock widget (think / tool / todos / subagents): configured row size
 * (1 = single line, no border; 5/7/12 = bordered; "full" = grow), an
 * accent color for the border/header, and a hide animation — `fade`
 * (0..1) dims the accent toward the background and shrinks the box, so
 * a widget "fades out" instead of vanishing. Show is instant (直接出现).
 */
import { Show, type JSX } from "solid-js"

/** Dim a hex color toward black by `k` (0 = unchanged, 1 = black). */
export function dimColor(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.round(v * (1 - k)).toString(16).padStart(2, "0")
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`
}

/** Named size → box rows ("full" is resolved by the caller's terminal share). */
export function widgetRows(size: number | "full"): number {
  return size === "full" ? 14 : size
}

export function WidgetFrame(props: {
  /** Configured rows: 1 = single line (no border), 5/7/12 = bordered. */
  size: number | "full"
  accent: string
  /** Hide animation progress 0..1 (dims + shrinks; 1 = gone). */
  fade?: number
  title?: string
  /** Hotkey hint shown right-aligned, dimmed (e.g. "ctrl+t"). */
  hint?: string
  /** Widget background tint (hex). */
  bg?: string
  children?: JSX.Element
}): JSX.Element {
  const fade = () => Math.min(1, Math.max(0, props.fade ?? 0))
  const accent = () => dimColor(props.accent, fade())
  const rows = () => Math.max(fade() >= 1 ? 0 : 1, Math.round(widgetRows(props.size) * (1 - fade())))
  const bordered = () => widgetRows(props.size) > 1 && rows() > 1
  return (
    <Show when={rows() > 0}>
      <box
        style={{
          flexDirection: "column",
          flexGrow: 0,
          height: rows(),
          ...(props.bg ? { backgroundColor: props.bg } : {}),
          ...(bordered()
            ? { border: true, borderStyle: "rounded", borderColor: accent() }
            : {}),
          padding: 0,
        }}
      >
        {props.title || props.hint ? (
          <box style={{ flexDirection: "row" }}>
            <text style={{ fg: accent(), wrapMode: "none", truncate: true }}>{props.title}</text>
            <box style={{ flexGrow: 1 }} />
            <text style={{ fg: dimColor(accent(), 0.25) }}>{props.hint}</text>
          </box>
        ) : null}
        {props.children}
      </box>
    </Show>
  )
}
