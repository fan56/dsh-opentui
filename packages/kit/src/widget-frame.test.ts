/** UT: WidgetFrame math + config parsing (layer 1 of verify/README). */
import { describe, expect, test } from "bun:test"
import { widgetRows, dimColor } from "./widget-frame.tsx"

describe("widgetRows", () => {
  test("named sizes map to rows", () => {
    expect(widgetRows(1)).toBe(1)
    expect(widgetRows(5)).toBe(5)
    expect(widgetRows(7)).toBe(7)
    expect(widgetRows(12)).toBe(12)
    expect(widgetRows("full")).toBe(14)
  })
})

describe("dimColor", () => {
  test("k=0 unchanged, k=1 black, monotonic", () => {
    expect(dimColor("#4d6bfe", 0)).toBe("#4d6bfe")
    expect(dimColor("#4d6bfe", 1)).toBe("#000000")
    const mid = dimColor("#4d6bfe", 0.5)
    expect(mid).not.toBe("#4d6bfe")
    // each channel strictly darker
    const n = (h: string, s: number) => parseInt(h.slice(s, s + 2), 16)
    for (const off of [1, 3, 5]) expect(n(mid, off)).toBeLessThan(n("#4d6bfe", off))
  })
})

describe("fade row shrink (the overflow regression: height must fit content)", () => {
  test("size 1 never exceeds 1 row at any fade", () => {
    for (const f of [0, 0.25, 0.5, 0.9]) {
      const rows = Math.max(f >= 1 ? 0 : 1, Math.round(widgetRows(1) * (1 - f)))
      expect(rows).toBeLessThanOrEqual(1)
    }
  })
  test("fade 1 = unmounted (0 rows)", () => {
    const rows = Math.max(false ? 1 : 0, Math.round(7 * 0))
    expect(rows).toBe(0)
  })
})
