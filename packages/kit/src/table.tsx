/**
 * Plain-text table: fixed-width columns with a dim header row. Column
 * width = explicit `width` ?? max(title length, longest cell, 8), capped
 * at 24 so one long value cannot blow up the layout. Cells truncate to
 * their column width and align via padEnd; columns are separated by two
 * spaces. Pure presentation — zero keyboard, no selection, no focus.
 */
import { For, type JSX } from "solid-js"
import type { Theme } from "./theme.ts"

export interface TableColumn {
  /** Key looked up in each row record. */
  key: string
  /** Header cell text. */
  title: string
  /** Fixed width override (still capped at MAX_WIDTH). */
  width?: number
}

/** Floor for computed column widths. */
const MIN_WIDTH = 8
/** Cap for every column width, explicit or computed. */
const MAX_WIDTH = 24
/** Gap between adjacent columns. */
const COLUMN_GAP = "  "

/** Effective width of one column: explicit width wins, otherwise the
 * longest of title / cells / floor — always capped at MAX_WIDTH. */
function columnWidth(col: TableColumn, rows: Record<string, string>[]): number {
  const longest = rows.reduce((m, r) => Math.max(m, (r[col.key] ?? "").length), 0)
  const w = col.width ?? Math.max(col.title.length, longest, MIN_WIDTH)
  return Math.min(w, MAX_WIDTH)
}

/** Fit one cell into `w` columns: truncate, then pad to the width. */
function fitCell(text: string, w: number): string {
  return text.slice(0, w).padEnd(w)
}

/** Resolve column widths once per render pass. */
function layout(columns: TableColumn[], rows: Record<string, string>[]): { col: TableColumn; w: number }[] {
  return columns.map((col) => ({ col, w: columnWidth(col, rows) }))
}

export function Table(props: {
  columns: TableColumn[]
  rows: Record<string, string>[]
  theme: Theme
}): JSX.Element {
  const cols = () => layout(props.columns, props.rows)
  const headerLine = () =>
    cols()
      .map(({ col, w }) => fitCell(col.title, w))
      .join(COLUMN_GAP)
  const rowLine = (row: Record<string, string>) =>
    cols()
      .map(({ col, w }) => fitCell(row[col.key] ?? "", w))
      .join(COLUMN_GAP)

  return (
    <box style={{ flexDirection: "column" }}>
      <text style={{ fg: props.theme.tokens.dim }}>{headerLine()}</text>
      <For each={props.rows}>{(row) => <text>{rowLine(row)}</text>}</For>
    </box>
  )
}
