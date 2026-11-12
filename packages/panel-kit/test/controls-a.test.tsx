/**
 * controls-a.test.tsx — unit tests for the路 B controls (List / Button / Check).
 *
 * Pure units only, no renderer (spec §9.1): fuzzy filter hit/empty/multi-word,
 * group flattening, single/multi selection state machine, Check tri-state
 * migration, Button disabled never emits, and width truncation measured with
 * string-width over CJK/emoji.
 */
import { describe, expect, test } from "bun:test"
import stringWidth from "string-width"
import {
  buildListRows,
  fuzzyFilter,
  listReduce,
  moveActiveId,
  firstEnabledId,
  truncateCells,
  type ListRow,
  type ListState,
} from "../src/controls/list"
import { pressButton } from "../src/controls/button"
import { checkStateOf, nextCheckState, toggleCheck, type CheckState } from "../src/controls/check"
import { Button } from "../src/controls/button"
import { Check } from "../src/controls/check"
import { List } from "../src/controls/list"
import type { ListItem } from "../src/contracts"

function item(id: string, extra: Partial<ListItem<number>> = {}): ListItem<number> {
  return { id, label: id, value: 0, ...extra }
}

function stateOf(partial: Partial<ListState> = {}): ListState {
  return { activeId: undefined, selected: [], query: "", ...partial }
}

// ---------------------------------------------------------------------------
// fuzzy 过滤逻辑（命中 / 空 / 多词）
// ---------------------------------------------------------------------------

describe("fuzzyFilter", () => {
  const items = [
    item("model", { label: "Model Provider" }),
    item("theme", { label: "Theme", description: "color provider" }),
    item("agents", { label: "Agents", description: "subagent list" }),
  ]

  test("hit: subsequence match is case-insensitive", () => {
    expect(fuzzyFilter(items, "model").map((entry) => entry.id)).toEqual(["model"])
    expect(fuzzyFilter(items, "MDL").map((entry) => entry.id)).toEqual(["model"])
  })

  test("empty query returns every item; no match returns []", () => {
    expect(fuzzyFilter(items, "")).toHaveLength(3)
    expect(fuzzyFilter(items, "   ")).toHaveLength(3)
    expect(fuzzyFilter(items, "zzzz")).toEqual([])
  })

  test("multi-word queries AND their terms", () => {
    expect(fuzzyFilter(items, "model prov").map((entry) => entry.id)).toEqual(["model"])
    expect(fuzzyFilter(items, "theme provider").map((entry) => entry.id)).toEqual(["theme"])
    expect(fuzzyFilter(items, "model zzz")).toEqual([])
  })

  test("label hits outrank description-only hits", () => {
    const ranked = fuzzyFilter(items, "provider")
    expect(ranked.map((entry) => entry.id)).toEqual(["model", "theme"])
  })
})

// ---------------------------------------------------------------------------
// 分组平铺
// ---------------------------------------------------------------------------

describe("buildListRows", () => {
  test("flat items stay flat; no group rows without group fields", () => {
    const rows = buildListRows([item("a"), item("b")])
    expect(rows.map((row) => row.kind)).toEqual(["item", "item"])
  })

  test("groups flatten into header + bucket rows, ungrouped first, groups[] order", () => {
    const rows = buildListRows(
      [
        item("g2a", { group: "g2" }),
        item("plain"),
        item("g1a", { group: "g1" }),
        item("g2b", { group: "g2" }),
      ],
      [
        { id: "g1", label: "Group One" },
        { id: "g2", label: "Group Two" },
      ],
    )
    expect(rows.map((row) => (row.kind === "group" ? `#${row.group.label}` : row.item.id))).toEqual([
      "plain",
      "#Group One",
      "g1a",
      "#Group Two",
      "g2a",
      "g2b",
    ])
  })

  test("unknown group ids append after known groups, labeled by id", () => {
    const rows = buildListRows([item("x", { group: "g9" }), item("a", { group: "g1" })], [
      { id: "g1", label: "One" },
    ])
    expect(rows.map((row) => (row.kind === "group" ? `#${row.group.label}` : row.item.id))).toEqual([
      "#One",
      "a",
      "#g9",
      "x",
    ])
  })

  test("navigation skips group rows and disabled items", () => {
    const rows: ListRow<number>[] = buildListRows(
      [item("a"), item("off", { disabled: true }), item("b", { group: "g" }), item("c", { group: "g" })],
      [{ id: "g", label: "G" }],
    )
    expect(firstEnabledId(rows)).toBe("a")
    expect(moveActiveId(rows, "a", 1)).toBe("b")
    expect(moveActiveId(rows, "b", 1)).toBe("c")
    expect(moveActiveId(rows, "c", 1)).toBe("a") // wrap
    expect(moveActiveId(rows, "a", -1)).toBe("c") // wrap backwards, "off" skipped
    expect(moveActiveId(rows, undefined, 1)).toBe("a")
    expect(moveActiveId([], "a", 1)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 单/多选状态机
// ---------------------------------------------------------------------------

describe("listReduce selection state machine", () => {
  const items = [
    item("a"),
    item("b"),
    item("off", { disabled: true }),
    item("c"),
  ]
  const single = { items, mode: "single" as const }
  const multi = { items, mode: "multi" as const }

  test("single: Enter and Space select the active row and emit onSelect", () => {
    for (const action of [{ type: "activate" as const }, { type: "toggle" as const }]) {
      const out = listReduce(single, stateOf({ activeId: "b" }), action)
      expect(out.state.selected).toEqual(["b"])
      expect(out.select?.id).toBe("b")
      expect(out.change).toBeUndefined()
    }
  })

  test("single: selecting a second row replaces the first (at most one)", () => {
    const first = listReduce(single, stateOf({ activeId: "a" }), { type: "activate" })
    const second = listReduce(single, first.state, { type: "focus", id: "c" })
    const third = listReduce(single, second.state, { type: "activate" })
    expect(third.state.selected).toEqual(["c"])
    expect(third.select?.id).toBe("c")
  })

  test("multi: Space toggles the active row and emits onChange immediately", () => {
    const add = listReduce(multi, stateOf({ activeId: "a" }), { type: "toggle" })
    expect(add.change).toEqual(["a"])
    const remove = listReduce(multi, add.state, { type: "toggle" })
    expect(remove.change).toEqual([])
  })

  test("multi: Enter toggles immediately too — no batch, no defer", () => {
    const out = listReduce(multi, stateOf({ activeId: "c", selected: ["a"] }), { type: "activate" })
    expect(out.change).toEqual(["a", "c"])
    expect(out.select).toBeUndefined()
  })

  test("disabled rows and group rows never emit", () => {
    const rows = buildListRows(items)
    expect(moveActiveId(rows, "a", 1)).toBe("b") // "off" skipped
    const onDisabled = listReduce(single, stateOf({ activeId: "off" }), { type: "activate" })
    expect(onDisabled.select).toBeUndefined()
    expect(onDisabled.state.selected).toEqual([])
  })

  test("move updates the active row and reports onActiveChange", () => {
    const out = listReduce(single, stateOf({ activeId: "a" }), { type: "move", delta: 1 })
    expect(out.state.activeId).toBe("b")
    expect(out.active).toBe("b")
  })

  test("query changes re-resolve the active row when it filters out", () => {
    const out = listReduce(
      { items: [item("a", { label: "alpha" }), item("b", { label: "beta" })], mode: "single" },
      stateOf({ activeId: "b", selected: ["b"] }),
      { type: "query", query: "alpha" },
    )
    expect(out.state.activeId).toBe("a")
    expect(out.active).toBe("a")
    expect(out.state.query).toBe("alpha")
  })
})

// ---------------------------------------------------------------------------
// check 三态迁移
// ---------------------------------------------------------------------------

describe("Check tri-state", () => {
  test("visual states map from checked/indeterminate", () => {
    expect(checkStateOf(true)).toBe("on")
    expect(checkStateOf(false)).toBe("off")
    expect(checkStateOf(false, true)).toBe("mixed")
    expect(checkStateOf(true, true)).toBe("mixed")
  })

  test("toggle migration: off → on → off, mixed → on", () => {
    const order: CheckState[] = ["off", "on", "off", "on"]
    let current: CheckState = "off"
    for (const expected of order) {
      expect(current).toBe(expected)
      current = nextCheckState(current)
    }
    expect(nextCheckState("mixed")).toBe("on")
    expect(nextCheckState("on")).toBe("off")
    expect(nextCheckState("off")).toBe("on")
  })

  test("toggleCheck emits the next checked value; mixed resolves to true", () => {
    const seen: boolean[] = []
    const onChange = (checked: boolean) => seen.push(checked)
    expect(toggleCheck({ checked: false, onChange })).toBe(true)
    expect(toggleCheck({ checked: true, onChange })).toBe(false)
    expect(toggleCheck({ checked: false, indeterminate: true, onChange })).toBe(true)
    expect(seen).toEqual([true, false, true])
  })

  test("toggleCheck is inert when disabled or read-only", () => {
    let calls = 0
    const onChange = () => {
      calls += 1
    }
    expect(toggleCheck({ checked: true, disabled: true, onChange })).toBeUndefined()
    expect(toggleCheck({ checked: true })).toBeUndefined()
    expect(calls).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 按钮 disabled 不发事件
// ---------------------------------------------------------------------------

describe("Button press dispatch", () => {
  test("disabled buttons never emit onPress", () => {
    let calls = 0
    const fired = pressButton({
      disabled: true,
      onPress: () => {
        calls += 1
      },
    })
    expect(fired).toBe(false)
    expect(calls).toBe(0)
  })

  test("enabled buttons emit exactly once per press", () => {
    let calls = 0
    const fired = pressButton({
      onPress: () => {
        calls += 1
      },
    })
    expect(fired).toBe(true)
    expect(calls).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 宽度截断（string-width 对 CJK/emoji，保尾）
// ---------------------------------------------------------------------------

describe("truncateCells", () => {
  test("CJK measures as two cells and the tail is kept", () => {
    // 你(2)好(2)世(2)界(2)a(1)b(1)c(1) = 11 cells → width 6 keeps "界abc"
    const result = truncateCells("你好世界abc", 6)
    expect(result).toBe("…界abc")
    expect(stringWidth(result)).toBe(6)
  })

  test("emoji measures as two cells and the tail is kept", () => {
    const result = truncateCells("🎉🎉🎉", 5)
    expect(result).toBe("…🎉🎉")
    expect(stringWidth(result)).toBe(5)
    expect(result.endsWith("🎉")).toBe(true)
  })

  test("mixed CJK/emoji output never exceeds the budget", () => {
    const text = "面板🎉设置 provider-model.tsx"
    for (let width = 1; width <= stringWidth(text); width++) {
      const result = truncateCells(text, width)
      expect(stringWidth(result)).toBeLessThanOrEqual(width)
    }
  })

  test("head mode keeps the head and marks the tail", () => {
    const result = truncateCells("abc你好", 5, "head")
    expect(result).toBe("abc…")
    expect(result.startsWith("abc")).toBe(true)
  })

  test("fits unchanged; degenerate widths degrade safely", () => {
    expect(truncateCells("ok", 2)).toBe("ok")
    expect(truncateCells("你好", 4)).toBe("你好")
    expect(truncateCells("你好", 0)).toBe("")
    expect(truncateCells("你好", 1)).toBe("…")
  })
})

// ---------------------------------------------------------------------------
// module surface smoke (components load without a renderer)
// ---------------------------------------------------------------------------

describe("control modules load", () => {
  test("List/Button/Check are functions", () => {
    expect(typeof List).toBe("function")
    expect(typeof Button).toBe("function")
    expect(typeof Check).toBe("function")
  })
})
