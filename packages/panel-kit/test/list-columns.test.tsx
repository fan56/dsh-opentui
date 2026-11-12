/**
 * list-columns.test.tsx — v1.1 fixed columns (ListItem.cells / ListProps.columns).
 *
 * Pure assertions pin the column algebra: declared widths, left/right
 * alignment, the label fallback for a row (or cell) without data, and the
 * narrow-budget shrink (widest column first, ellipsis truncation, zero-width
 * columns dropped so a row can never overflow its budget). Render smokes check
 * the painted header + cells through @opentui/solid's testRender.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import stringWidth from "string-width"
import type { ListColumn, ListItem, PanelKitContextValue } from "../src/contracts"
import {
  List,
  listColumnRow,
  listColumnValues,
  resolveListColumns,
} from "../src/controls/list"
import { FALLBACK_THEME } from "../src/fallback"
import { PanelKitContext, STATIC_MOTION } from "../src/theme"

const COLUMNS: ListColumn[] = [
  { id: "agent", title: "Agent", width: 8 },
  { id: "model", title: "Model", width: 6 },
  { id: "state", title: "State", width: 5, align: "right" },
]

const kit: PanelKitContextValue = {
  theme: () => FALLBACK_THEME,
  motion: STATIC_MOTION,
}

function row<T>(id: string, extra: Partial<ListItem<T>> = {}): ListItem<T> {
  return { id, label: id, ...extra }
}

describe("resolveListColumns (declared widths / narrow shrink)", () => {
  test("no budget keeps the declared widths and alignment", () => {
    const resolved = resolveListColumns(COLUMNS)
    expect(resolved.map((column) => column.width)).toEqual([8, 6, 5])
    expect(resolved.map((column) => column.align)).toEqual(["left", "left", "right"])
    expect(resolved.map((column) => column.title)).toEqual(["Agent", "Model", "State"])
  })

  test("a narrow budget shrinks the widest column first", () => {
    const resolved = resolveListColumns(COLUMNS, 21) // 8 + 6 + 5 + 2 gaps = 21
    expect(resolved.map((column) => column.width)).toEqual([8, 6, 5])
    const tight = resolveListColumns(COLUMNS, 12)
    // 10 cells for columns after the two gaps, spread across three columns.
    expect(tight.reduce((sum, column) => sum + column.width, 0)).toBeLessThanOrEqual(10)
    expect(tight.every((column) => column.width >= 1)).toBe(true)
    // No column keeps its declared width when every cell is needed elsewhere.
    expect(tight.filter((column) => column.width > 0)).toHaveLength(3)
  })

  test("columns that cannot keep a cell are dropped, never overlapping", () => {
    const resolved = resolveListColumns(COLUMNS, 2)
    const text = listColumnRow(["alpha", "gpt", "busy"], resolved)
    expect(stringWidth(text)).toBeLessThanOrEqual(2)
    expect(resolved.filter((column) => column.width === 0).length).toBeGreaterThan(0)
  })
})

describe("listColumnValues / listColumnRow (cells + fallback)", () => {
  test("cells win by column id; the first column falls back to label", () => {
    const withCells = row("ignored", {
      label: "planner",
      cells: { model: "gpt-5", state: "idle" },
    })
    expect(listColumnValues(withCells, COLUMNS)).toEqual(["planner", "gpt-5", "idle"])

    const noCells = row("reviewer", { label: "reviewer" })
    expect(listColumnValues(noCells, COLUMNS)).toEqual(["reviewer", "", ""])
  })

  test("a missing non-first cell renders as an empty padded column", () => {
    const item = row("x", { label: "x", cells: { model: "opus" } })
    const resolved = resolveListColumns(COLUMNS)
    const text = listColumnRow(listColumnValues(item, COLUMNS), resolved)
    expect(text).toBe(["x".padEnd(8), "opus".padEnd(6), "".padEnd(5)].join(" "))
    expect(stringWidth(text)).toBe(8 + 1 + 6 + 1 + 5)
  })

  test("right alignment pads on the left; left alignment pads on the right", () => {
    const resolved = resolveListColumns(COLUMNS)
    const text = listColumnRow(["a", "b", "7"], resolved)
    expect(text).toBe(["a".padEnd(8), "b".padEnd(6), "7".padStart(5)].join(" "))
    expect(text.endsWith("    7")).toBe(true)
  })

  test("narrow truncation appends an ellipsis and respects the budget", () => {
    const resolved = resolveListColumns(COLUMNS, 12)
    const text = listColumnRow(["planner-agent", "gpt-5-turbo", "busy"], resolved)
    expect(stringWidth(text)).toBeLessThanOrEqual(12)
    expect(text).toContain("…")
  })
})

describe("List columns render (testRender smoke)", () => {
  test("paints the header row and the cell values", async () => {
    const items: ListItem<string>[] = [
      row("planner", { cells: { model: "gpt-5", state: "idle" } }),
      row("coder", { cells: { model: "sonnet", state: "busy" } }),
    ]
    const setup = await testRender(
      () => (
        <PanelKitContext.Provider value={kit}>
          <List items={items} columns={COLUMNS} width={40} />
        </PanelKitContext.Provider>
      ),
      { width: 40, height: 10, useMouse: false },
    )
    try {
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("Agent")
      expect(frame).toContain("Model")
      expect(frame).toContain("State")
      expect(frame).toContain("planner")
      expect(frame).toContain("gpt-5")
      expect(frame).toContain("busy")
    } finally {
      await setup.dispose()
    }
  })

  test("a narrow width truncates columns with an ellipsis instead of overflowing", async () => {
    const items: ListItem<string>[] = [row("planner-agent", { cells: { model: "gpt-5-turbo", state: "busy" } })]
    const setup = await testRender(
      () => (
        <PanelKitContext.Provider value={kit}>
          <List items={items} columns={COLUMNS} width={12} />
        </PanelKitContext.Provider>
      ),
      { width: 40, height: 8, useMouse: false },
    )
    try {
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("…")
      // None of the already-truncated values leaks in full.
      expect(frame).not.toContain("gpt-5-turbo")
      expect(frame).not.toContain("planner-agent")
    } finally {
      await setup.dispose()
    }
  })
})
