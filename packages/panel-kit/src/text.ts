/**
 * text.ts — row layout helpers shared by the shell (and the controls lane).
 *
 * Terminal cells are atomic (spec §5.1/§5.3): every width here is measured in
 * cells with string-width, never in UTF-16 code units, and a wide glyph is
 * never split when truncating. Glyph vocabulary is fixed and single-width
 * (spec §5.2); data values may be wide and are handled by measurement.
 *
 * Adapted from @opencode/tui, Copyright 2025 opencode, MIT.
 */
import stringWidth from "string-width"

/** Visual width in cells (double-width CJK counts 2). */
export function measure(value: string): number {
  return stringWidth(value)
}

/** Split into grapheme clusters so a truncation never splits a wide glyph. */
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function graphemes(value: string): string[] {
  return Array.from(segmenter.segment(value), (part) => part.segment)
}

/** Longest prefix of `value` whose measured width is at most `width`. */
export function takeCells(value: string, width: number): string {
  if (width <= 0) return ""
  if (stringWidth(value) <= width) return value
  const parts: string[] = []
  let used = 0
  for (const part of graphemes(value)) {
    const cells = stringWidth(part)
    if (used + cells > width) break
    parts.push(part)
    used += cells
  }
  return parts.join("")
}

/** Truncate to `width` cells, ending in an ellipsis when anything was cut. */
export function truncate(value: string, width: number): string {
  if (width <= 0) return ""
  if (stringWidth(value) <= width) return value
  if (width === 1) return "…"
  return takeCells(value, width - 1) + "…"
}

/** Pad with spaces to exactly `width` cells; wider values are truncated. */
export function padEnd(value: string, width: number): string {
  const clipped = truncate(value, width)
  const pad = width - stringWidth(clipped)
  return pad > 0 ? clipped + " ".repeat(pad) : clipped
}

export function padStart(value: string, width: number): string {
  const clipped = truncate(value, width)
  const pad = width - stringWidth(clipped)
  return pad > 0 ? " ".repeat(pad) + clipped : clipped
}

/** Pad to the cell box on the requested side. */
export function align(value: string, width: number, side: "left" | "right" = "left"): string {
  return side === "right" ? padStart(value, width) : padEnd(value, width)
}

/**
 * One row with a left and a right segment, one cell of gap preserved. When
 * the pair does not fit, the left segment is truncated first so the right
 * (usually a value or key hint) stays readable.
 */
export function fitRow(left: string, right: string, width: number, gap = 1): string {
  if (width <= 0) return ""
  const rightWidth = stringWidth(right)
  if (rightWidth >= width) return padEnd("", width)
  const leftWidth = Math.max(0, width - rightWidth - gap)
  const clippedLeft = truncate(left, leftWidth)
  const used = stringWidth(clippedLeft)
  const between = Math.max(gap, width - used - rightWidth)
  return clippedLeft + " ".repeat(between) + padEnd(right, rightWidth)
}

/**
 * Fixed-column row: each column is padded (or right-aligned) to its declared
 * cell width, joined by one cell. Missing cells render empty.
 */
export function fitColumns(
  cells: readonly string[],
  widths: readonly number[],
  aligns: readonly ("left" | "right")[] = [],
  gap = 1,
): string {
  return widths
    .map((width, index) => align(cells[index] ?? "", width, aligns[index] ?? "left"))
    .join(" ".repeat(gap))
}

/** True when any grapheme in `value` measures wider than one cell. */
export function hasWideGlyphs(value: string): boolean {
  return graphemes(value).some((part) => stringWidth(part) > 1)
}
