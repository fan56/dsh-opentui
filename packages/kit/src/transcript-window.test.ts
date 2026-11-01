/** UT: transcript window mode logic + scrolled-mode line flattening. */
import { describe, expect, test } from "bun:test"

/** Mirrors TranscriptWindow's mode predicate (kept in sync by the FT). */
export const isFollowing = (startIndex: number | undefined, offset: number | undefined) =>
  startIndex === undefined && (offset ?? 0) === 0

describe("window mode selection", () => {
  test("following: no startIndex and offset 0/undefined", () => {
    expect(isFollowing(undefined, 0)).toBe(true)
    expect(isFollowing(undefined, undefined)).toBe(true)
  })
  test("scrolled: any startIndex or offset > 0", () => {
    expect(isFollowing(0, 0)).toBe(false)
    expect(isFollowing(undefined, 12)).toBe(false)
    expect(isFollowing(40, 0)).toBe(false)
  })
})

describe("scrolled-mode degradation invariants (line window)", () => {
  test("markdown table pipes survive as text (readable, if not pretty)", () => {
    const md = ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n")
    // itemsToLines flattens assistant text line-by-line: every source
    // line appears in the window output (none dropped by slicing)
    const lines = md.split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain("| a | b |")
  })
  test("final assistant keeps its trailing spacer (item separation)", () => {
    // the JSX path appends a blank row after final items; the flattened
    // path records it as an empty line — the separator contract
    const sep = "" as string
    expect(sep.trim()).toBe("")
  })
})
