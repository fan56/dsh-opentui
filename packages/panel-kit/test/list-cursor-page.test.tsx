/**
 * list-cursor-page.test.tsx — P0-3/P1-2: the active row never leaves the
 * painted page window.
 *
 * Pins the v1.1 cursor/page coupling contract:
 *   • up/down/Home/End (and a controlled activeId change) move the window to
 *     the row's page, so the active row is always painted;
 *   • PgUp/PgDn still page, and the cursor is clamped into the new page
 *     (first row forward, last row back) instead of being left behind;
 *   • empty / single row / exactly one page / filtered-out activeId are safe.
 *
 * Pure helpers and the painted frame are both asserted, through
 * @opentui/solid's testRender for the key-driven cases.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Renderable } from "@opentui/core"
import { createSignal, type JSX } from "solid-js"
import type { ListItem, PanelKitContextValue } from "../src/contracts"
import {
  List,
  buildListRows,
  listPageOfRow,
  listPageSlice,
  listRowIndex,
  nextListPage,
} from "../src/controls/list"
import { FALLBACK_THEME } from "../src/fallback"
import { PanelKitContext, STATIC_MOTION } from "../src/theme"

const kit: PanelKitContextValue = {
  theme: () => FALLBACK_THEME,
  motion: STATIC_MOTION,
}

const DOWN = "\u001b[B"
const UP = "\u001b[A"
const HOME = "\u001b[H"
const END = "\u001b[F"
const PGUP = "\u001b[5~"
const PGDN = "\u001b[6~"

function rows(count: number): ListItem<string>[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `id-${index}`,
    label: `item-${index}`,
  }))
}

function firstFocusable(node: Renderable): Renderable | undefined {
  if (node.focusable) return node
  for (const child of node.getChildren()) {
    const hit = firstFocusable(child)
    if (hit !== undefined) return hit
  }
  return undefined
}

type Setup = Awaited<ReturnType<typeof testRender>>

async function mount(view: () => JSX.Element, width = 30, height = 12): Promise<Setup> {
  const setup = await testRender(view, { width, height, useMouse: false })
  await setup.renderOnce()
  firstFocusable(setup.renderer.root)?.focus()
  await setup.renderOnce()
  return setup
}

/** stdin parsing is deferred by a tick in the test renderer. */
async function press(setup: Setup, key: string): Promise<void> {
  setup.mockInput.pressKey(key)
  await Bun.sleep(20)
  await setup.renderOnce()
}

function frame(setup: Setup): string {
  return setup.captureCharFrame()
}

// ---------------------------------------------------------------------------
// Pure page algebra
// ---------------------------------------------------------------------------

describe("listPageOfRow / listRowIndex (cursor page mapping)", () => {
  const items = rows(7)
  const listRows = buildListRows(items)

  test("row index ignores unknown ids and group rows", () => {
    expect(listRowIndex(listRows, "id-0")).toBe(0)
    expect(listRowIndex(listRows, "id-6")).toBe(6)
    expect(listRowIndex(listRows, "missing")).toBe(-1)
    expect(listRowIndex(listRows, undefined)).toBe(-1)
  })

  test("3-row pages map rows 0-2/3-5/6 to pages 0/1/2", () => {
    expect(listPageOfRow(0, 3, 7)).toBe(0)
    expect(listPageOfRow(2, 3, 7)).toBe(0)
    expect(listPageOfRow(3, 3, 7)).toBe(1)
    expect(listPageOfRow(6, 3, 7)).toBe(2)
  })

  test("no paging / empty / out-of-range indices clamp to page 0", () => {
    for (const size of [undefined, 0, -2, Number.NaN]) {
      expect(listPageOfRow(5, size, 7)).toBe(0)
    }
    expect(listPageOfRow(0, 3, 0)).toBe(0)
    expect(listPageOfRow(-1, 3, 7)).toBe(0)
    expect(listPageOfRow(99, 3, 7)).toBe(2) // never past the last page
  })

  test("a page slice matches the painted window (group headers count)", () => {
    const grouped = buildListRows(rows(3), [{ id: "g", label: "Group" }])
    expect(listPageSlice(listRows, 3, 0).map((row) => row.kind)).toEqual(["item", "item", "item"])
    expect(listPageSlice(listRows, 3, 2)).toHaveLength(1)
    expect(listPageSlice(grouped, 2, 0)).toHaveLength(2)
    expect(listPageSlice(listRows, 3, 0)).not.toBe(listRows) // a copy, never the source
    expect(listPageSlice([], 3, 0)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Render: the window follows the cursor
// ---------------------------------------------------------------------------

describe("List cursor/page coupling (7 rows, pageSize 3)", () => {
  test("four DOWN presses paint page 2 and keep the active row visible", async () => {
    const setup = await mount(() => (
      <PanelKitContext.Provider value={kit}>
        <List items={rows(7)} pageSize={3} width={30} />
      </PanelKitContext.Provider>
    ))
    try {
      expect(frame(setup)).toContain("1-3/7")
      for (let index = 0; index < 4; index += 1) await press(setup, DOWN)
      const text = frame(setup)
      expect(text).toContain("4-6/7") // page 2, not the stale 0-2 window
      expect(text).toContain("item-3")
      expect(text).not.toContain("item-0")
    } finally {
      await setup.dispose()
    }
  })

  test("UP from the first row of page 2 steps the window back to page 1", async () => {
    const setup = await mount(() => (
      <PanelKitContext.Provider value={kit}>
        <List items={rows(7)} pageSize={3} width={30} />
      </PanelKitContext.Provider>
    ))
    try {
      for (let index = 0; index < 4; index += 1) await press(setup, DOWN)
      expect(frame(setup)).toContain("4-6/7")
      await press(setup, UP)
      const text = frame(setup)
      expect(text).toContain("1-3/7")
      expect(text).toContain("item-2")
      expect(text).not.toContain("item-5")
    } finally {
      await setup.dispose()
    }
  })

  test("END lands on the page of the last row and the cursor follows", async () => {
    let picked: string | undefined
    const setup = await mount(() => (
      <PanelKitContext.Provider value={kit}>
        <List items={rows(7)} pageSize={3} width={30} onSelect={(item) => (picked = item.id)} />
      </PanelKitContext.Provider>
    ))
    try {
      await press(setup, END)
      const text = frame(setup)
      expect(text).toContain("7-7/7")
      expect(text).toContain("item-6")
      await press(setup, "\r")
      expect(picked).toBe("id-6") // the active row is the painted last row
    } finally {
      await setup.dispose()
    }
  })

  test("HOME returns to page 1 and the cursor sits on the first row", async () => {
    let picked: string | undefined
    const setup = await mount(() => (
      <PanelKitContext.Provider value={kit}>
        <List items={rows(7)} pageSize={3} width={30} onSelect={(item) => (picked = item.id)} />
      </PanelKitContext.Provider>
    ))
    try {
      await press(setup, END)
      expect(frame(setup)).toContain("7-7/7")
      await press(setup, HOME)
      const text = frame(setup)
      expect(text).toContain("1-3/7")
      expect(text).toContain("item-0")
      await press(setup, "\r")
      expect(picked).toBe("id-0")
    } finally {
      await setup.dispose()
    }
  })

  test("PgDn clamps the cursor to the first row of the new page", async () => {
    let picked: string | undefined
    const setup = await mount(() => (
      <PanelKitContext.Provider value={kit}>
        <List items={rows(7)} pageSize={3} width={30} onSelect={(item) => (picked = item.id)} />
      </PanelKitContext.Provider>
    ))
    try {
      await press(setup, PGDN)
      const text = frame(setup)
      expect(text).toContain("4-6/7")
      await press(setup, "\r")
      expect(picked).toBe("id-3") // new page's first row
    } finally {
      await setup.dispose()
    }
  })

  test("PgUp clamps the cursor to the last row of the previous page", async () => {
    let picked: string | undefined
    const setup = await mount(() => (
      <PanelKitContext.Provider value={kit}>
        <List items={rows(7)} pageSize={3} width={30} onSelect={(item) => (picked = item.id)} />
      </PanelKitContext.Provider>
    ))
    try {
      await press(setup, PGDN)
      expect(frame(setup)).toContain("4-6/7")
      await press(setup, PGUP)
      expect(frame(setup)).toContain("1-3/7")
      await press(setup, "\r")
      expect(picked).toBe("id-2") // previous page's last row
    } finally {
      await setup.dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Render: boundaries stay safe
// ---------------------------------------------------------------------------

describe("List cursor/page coupling (edges)", () => {
  test("an empty list paints the empty label and paging/arrow keys never throw", async () => {
    const setup = await mount(() => (
      <PanelKitContext.Provider value={kit}>
        <List items={[]} pageSize={3} width={30} />
      </PanelKitContext.Provider>
    ))
    try {
      for (const key of [DOWN, UP, PGDN, PGUP, HOME, END, "\r"]) await press(setup, key)
      expect(frame(setup)).toContain("No items")
    } finally {
      await setup.dispose()
    }
  })

  test("a list that fits one page keeps PgUp/PgDn unconsumed and paints no window", async () => {
    // nextListPage is the gate the List shares with the old contract.
    expect(nextListPage("pageup", 0, 1)).toBeUndefined()
    expect(nextListPage("pagedown", 0, 1)).toBeUndefined()

    const setup = await mount(() => (
      <PanelKitContext.Provider value={kit}>
        <List items={rows(3)} pageSize={3} width={30} />
      </PanelKitContext.Provider>
    ))
    try {
      const before = frame(setup)
      await press(setup, PGDN)
      await press(setup, PGUP)
      const after = frame(setup)
      expect(after).toBe(before) // no page moved, no cursor lost
      expect(after).toContain("item-2")
      expect(after).not.toContain("PgUp/PgDn")
    } finally {
      await setup.dispose()
    }
  })

  test("a single row is safe and paints no window", async () => {
    const setup = await mount(() => (
      <PanelKitContext.Provider value={kit}>
        <List items={rows(1)} pageSize={3} width={30} />
      </PanelKitContext.Provider>
    ))
    try {
      for (const key of [DOWN, PGDN, END, HOME]) await press(setup, key)
      const text = frame(setup)
      expect(text).toContain("item-0")
      expect(text).not.toContain("PgUp/PgDn")
    } finally {
      await setup.dispose()
    }
  })

  test("an activeId filtered out of the query is safe (no blank window, no throw)", async () => {
    const setup = await mount(() => (
      <PanelKitContext.Provider value={kit}>
        <List items={rows(7)} pageSize={3} width={30} activeId="id-6" query="item-1" />
      </PanelKitContext.Provider>
    ))
    try {
      const text = frame(setup)
      expect(text).toContain("item-1") // the only fuzzy hit
      expect(text).not.toContain("item-6") // the filtered-out active row
      await press(setup, DOWN)
      expect(frame(setup)).toContain("item-1")
    } finally {
      await setup.dispose()
    }
  })

  test("a controlled activeId change scrolls the window to that row's page", async () => {
    const [active, setActive] = createSignal("id-0")
    const setup = await mount(() => (
      <PanelKitContext.Provider value={kit}>
        <List items={rows(7)} pageSize={3} width={30} activeId={active()} />
      </PanelKitContext.Provider>
    ))
    try {
      expect(frame(setup)).toContain("1-3/7")
      setActive("id-5")
      await Bun.sleep(20)
      await setup.renderOnce()
      const text = frame(setup)
      expect(text).toContain("4-6/7")
      expect(text).toContain("item-5")
      expect(text).not.toContain("item-0")
    } finally {
      await setup.dispose()
    }
  })
})
