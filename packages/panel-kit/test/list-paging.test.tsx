/**
 * list-paging.test.tsx — v1.1 paged window (ListProps.pageSize).
 *
 * Pins the page algebra (clamping at both ends, empty list, exactly one page,
 * no pageSize, invalid pageSize), the indicator text ("1-12/34"), the key
 * mapping (PgUp/PgDn/Home/End only while the list exceeds one page), and the
 * painted page window through @opentui/solid's testRender.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { ListItem, PanelKitContextValue } from "../src/contracts"
import {
  List,
  listPageIndicator,
  nextListPage,
  resolveListPage,
} from "../src/controls/list"
import { FALLBACK_THEME } from "../src/fallback"
import { PanelKitContext, STATIC_MOTION } from "../src/theme"

const kit: PanelKitContextValue = {
  theme: () => FALLBACK_THEME,
  motion: STATIC_MOTION,
}

function rows(count: number): ListItem<string>[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `id-${index}`,
    label: `item-${index}`,
  }))
}

const PAGE_KEYS = ["pageup", "pagedown", "home", "end"] as const

describe("resolveListPage (bounds / empty / one page)", () => {
  test("empty list: one empty page, nothing to page", () => {
    const window = resolveListPage(0, 10, 0)
    expect(window).toEqual({ page: 0, pages: 1, start: 0, end: 0, total: 0, paged: false })
    expect(listPageIndicator(window)).toBe("0-0/0")
  })

  test("exactly one page does not paginate", () => {
    const window = resolveListPage(5, 5, 0)
    expect(window.paged).toBe(false)
    expect(window.start).toBe(1)
    expect(window.end).toBe(5)
    expect(window.pages).toBe(1)
    expect(listPageIndicator(window)).toBe("1-5/5")
  })

  test("multiple pages expose inclusive ranges", () => {
    expect(resolveListPage(34, 12, 0)).toMatchObject({ page: 0, pages: 3, start: 1, end: 12, paged: true })
    expect(resolveListPage(34, 12, 1)).toMatchObject({ page: 1, pages: 3, start: 13, end: 24 })
    expect(resolveListPage(34, 12, 2)).toMatchObject({ page: 2, pages: 3, start: 25, end: 34 })
    expect(listPageIndicator(resolveListPage(34, 12, 2))).toBe("25-34/34")
  })

  test("page indices clamp at both ends instead of running blank", () => {
    expect(resolveListPage(34, 12, -5).page).toBe(0)
    expect(resolveListPage(34, 12, 99).page).toBe(2)
    expect(resolveListPage(34, 12, 99).start).toBe(25)
  })

  test("no pageSize or a non-positive pageSize means one page (no paging)", () => {
    for (const size of [undefined, 0, -3, Number.NaN]) {
      const window = resolveListPage(7, size, 0)
      expect(window.paged).toBe(false)
      expect(window.pages).toBe(1)
      expect(window.start).toBe(1)
      expect(window.end).toBe(7)
    }
  })
})

describe("nextListPage / listPageIndicator (key gating)", () => {
  test("no key is consumed when the list fits one page or is empty", () => {
    for (const id of PAGE_KEYS) {
      expect(nextListPage(id, 0, 1)).toBeUndefined()
    }
    const empty = resolveListPage(0, 4, 0)
    for (const id of PAGE_KEYS) {
      expect(nextListPage(id, empty.page, empty.pages)).toBeUndefined()
    }
    expect(nextListPage("pageup", 0, 0)).toBeUndefined()
  })

  test("PgUp/PgDn walk one page and clamp at the ends", () => {
    expect(nextListPage("pagedown", 0, 3)).toBe(1)
    expect(nextListPage("pagedown", 2, 3)).toBe(2) // last page stays
    expect(nextListPage("pageup", 2, 3)).toBe(1)
    expect(nextListPage("pageup", 0, 3)).toBe(0) // first page stays
  })

  test("Home/End jump to the edges and unrelated keys fall through", () => {
    expect(nextListPage("home", 2, 3)).toBe(0)
    expect(nextListPage("end", 0, 3)).toBe(2)
    expect(nextListPage("down", 0, 3)).toBeUndefined()
    expect(nextListPage("escape", 0, 3)).toBeUndefined()
  })

  test("the indicator uses the 1-based inclusive range", () => {
    expect(listPageIndicator({ start: 1, end: 12, total: 34 })).toBe("1-12/34")
    expect(listPageIndicator({ start: 13, end: 24, total: 34 })).toBe("13-24/34")
    expect(listPageIndicator({ start: 0, end: 0, total: 0 })).toBe("0-0/0")
  })
})

describe("List paged render (testRender smoke)", () => {
  test("paints only the current page and the tail indicator", async () => {
    const setup = await testRender(
      () => (
        <PanelKitContext.Provider value={kit}>
          <List items={rows(5)} pageSize={2} width={30} />
        </PanelKitContext.Provider>
      ),
      { width: 30, height: 10, useMouse: false },
    )
    try {
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("item-0")
      expect(frame).toContain("item-1")
      expect(frame).not.toContain("item-2") // page 2 is hidden
      expect(frame).toContain("1-2/5")
      expect(frame).toContain("PgUp/PgDn")
    } finally {
      await setup.dispose()
    }
  })

  test("a list that fits one page paints no indicator", async () => {
    const setup = await testRender(
      () => (
        <PanelKitContext.Provider value={kit}>
          <List items={rows(3)} pageSize={3} width={30} />
        </PanelKitContext.Provider>
      ),
      { width: 30, height: 10, useMouse: false },
    )
    try {
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("item-2")
      expect(frame).not.toContain("PgUp/PgDn")
      expect(frame).not.toContain("1-3/3")
    } finally {
      await setup.dispose()
    }
  })
})
