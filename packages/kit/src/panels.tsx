/**
 * Dock-style panels (tui-pi look): ToolPanel lists recent tool runs
 * with an optional expanded entry, ThinkPanel tails the thinking text.
 * Both are pure presentation — no keyboard handling, open/close keys
 * only appear as dim hints in the header row.
 */
import { For, Show, type JSX } from "solid-js"
import type { Theme } from "./theme.ts"

export interface ToolPanelEntry { name: string; args: string; ok: boolean; output: string; imagePath?: string }

/** Total row budget for the tool list (entries plus expanded output). */
const TOOL_MAX_ROWS = 14
/** Lines of output shown under an expanded tool entry. */
const TOOL_OUTPUT_TAIL = 6
/** Lines of thinking text kept in the tail. */
const THINK_TAIL = 10

/** Header row shared by the dock panels: accent title on the left,
 * dim close hint pushed to the right edge by a growing spacer. */
function dockHeader(theme: Theme, title: string, closeHint: string): JSX.Element {
  return (
    <box style={{ flexDirection: "row" }}>
      <text style={{ fg: theme.tokens.accent }}>{title}</text>
      <box style={{ flexGrow: 1 }} />
      <text style={{ fg: theme.tokens.dim }}>{closeHint}</text>
    </box>
  )
}

export function ToolPanel(props: { entries: ToolPanelEntry[]; theme: Theme; expandedIndex?: number }): JSX.Element {
  // Flatten entries (plus the expanded entry's output tail) into display
  // rows first, then cap the whole body at the row budget.
  const rows = () => {
    const th = props.theme
    const out: { text: string; fg: string }[] = []
    for (let i = 0; i < props.entries.length && out.length < TOOL_MAX_ROWS; i++) {
      const e = props.entries[i]
      if (!e) continue
      const fg = e.ok ? th.tokens.toolOk ?? th.tokens.ok : th.tokens.toolFail ?? th.tokens.danger
      out.push({ text: `⚒ ${e.name} ${e.ok ? "ok" : "fail"}`, fg })
      if (i === props.expandedIndex) {
        for (const line of e.output.split("\n").slice(-TOOL_OUTPUT_TAIL)) {
          if (out.length >= TOOL_MAX_ROWS) break
          out.push({ text: `  ${line}`, fg: th.tokens.dim })
        }
      }
    }
    return out
  }

  const expandedImage = () => {
    const e = props.entries[props.expandedIndex ?? -1]
    return e?.imagePath
  }

  return (
    <box style={{ border: true, borderColor: props.theme.tokens.border, flexDirection: "column", padding: 1 }}>
      {dockHeader(props.theme, ` Tools (${props.entries.length})`, "ctrl+o close")}
      <For each={rows()}>{(r) => <text style={{ fg: r.fg }}>{r.text}</text>}</For>
      <Show when={expandedImage()}>
        <image source={expandedImage()} fit="fit" />
      </Show>
    </box>
  )
}

export function ThinkPanel(props: { text: string; theme: Theme }): JSX.Element {
  const lines = () => props.text.split("\n")
  const tail = () => lines().slice(-THINK_TAIL)
  const truncated = () => lines().length > tail().length

  return (
    <box style={{ border: true, borderColor: props.theme.tokens.border, flexDirection: "column", padding: 1 }}>
      {dockHeader(props.theme, " Thinking ", "ctrl+t close")}
      {truncated() ? <text style={{ fg: props.theme.tokens.dim }}>…</text> : null}
      <For each={tail()}>{(l) => <text style={{ fg: props.theme.tokens.dim }}>{l}</text>}</For>
    </box>
  )
}
