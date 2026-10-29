/**
 * Overlay surfaces: the Picker (selection list with group headers),
 * the Dialog (bordered message box) and the ApprovalCard (inline tool
 * approval). All are presentation-only; selection state and answer
 * plumbing live in the host.
 */
import { For, type JSX } from "solid-js"
import type { Theme } from "./theme.ts"

export interface PickerItem {
  id: string
  label: string
  detail?: string
  group?: string
}

export function Picker(props: {
  title: string
  items: PickerItem[]
  selected: number
  theme: Theme
  maxRows?: number
}): JSX.Element {
  const maxRows = () => props.maxRows ?? 12
  // Show the head of the list; the tail collapses into a "… N more" row.
  const visible = () => props.items.slice(0, maxRows())
  const hiddenCount = () => props.items.length - visible().length

  /** Style for one row: highlighted rows invert onto the selection
   * background (when the theme defines one), the rest stay dim. */
  const rowStyle = (sel: boolean) => {
    if (!sel) return { fg: props.theme.tokens.dim }
    return {
      fg: props.theme.tokens.text,
      ...(props.theme.tokens.selection ? { bg: props.theme.tokens.selection } : {}),
    }
  }

  /** A group header renders whenever the group label changes between
   * consecutive visible items. */
  const needsHeader = (idx: number) => {
    const it = visible()[idx]
    if (!it || it.group === undefined) return false
    const prev = idx > 0 ? visible()[idx - 1] : undefined
    return prev?.group !== it.group
  }

  return (
    <box style={{ border: true, borderStyle: "rounded", borderColor: props.theme.tokens.border, flexDirection: "column", padding: 1 }}>
      <text style={{ fg: props.theme.tokens.accent }}>{props.title}</text>
      <For each={visible()}>
        {(it, i) => (
          <>
            {needsHeader(i()) ? <text style={{ fg: props.theme.tokens.dim }}>{it.group}</text> : null}
            <text style={rowStyle(i() === props.selected)}>
              {i() === props.selected ? "› " : "  "}
              {it.label}
              {it.detail ? <span style={{ fg: props.theme.tokens.dim }}>{`  ${it.detail}`}</span> : null}
            </text>
          </>
        )}
      </For>
      {hiddenCount() > 0 ? (
        <text style={{ fg: props.theme.tokens.dim }}>{`… ${hiddenCount()} more`}</text>
      ) : null}
    </box>
  )
}

export function Dialog(props: { title: string; body: string[]; theme: Theme; border?: string }): JSX.Element {
  return (
    <box
      style={{
        border: true,
        borderStyle: "rounded",
        borderColor: props.border ?? props.theme.tokens.warn,
        flexDirection: "column",
        padding: 1,
      }}
    >
      <text style={{ fg: props.theme.tokens.accent }}>{props.title}</text>
      <For each={props.body}>{(line) => <text>{line}</text>}</For>
    </box>
  )
}

export function ApprovalCard(props: { toolName: string; args: string; hint: string; theme: Theme }): JSX.Element {
  const th = () => props.theme
  return (
    <box
      style={{
        border: true,
        borderStyle: "rounded",
        borderColor: th().tokens.approvalBorder ?? th().tokens.warn,
        flexDirection: "column",
        padding: 1,
      }}
    >
      <text style={{ fg: th().tokens.warn }}>⚠ {props.toolName}</text>
      <text>{props.args.slice(0, 200)}</text>
      <text style={{ fg: th().tokens.dim }}>{props.hint}</text>
    </box>
  )
}
