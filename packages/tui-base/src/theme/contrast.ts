/**
 * contrast.ts — WCAG contrast helpers over @opentui/core RGBA values.
 *
 * The panel projection (context/panel-kit-host.tsx) uses `ensureContrast` so a
 * theme token that is unreadable on the panel content surface falls back to
 * the theme's own primary text color instead of vanishing. No literal colors:
 * both inputs and the fallback are theme tokens.
 */
import { RGBA } from "@opentui/core"

/** WCAG relative luminance (sRGB, 0..1) of an RGBA value. */
export function relativeLuminance(color: RGBA): number {
  const [r, g, b] = color.toInts()
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Contrast guard: keep `foreground` when it clears `min` on `background`,
 * otherwise return `fallback` (the theme's primary text token). Returns the
 * ORIGINAL fg object when it passes, so identity comparisons still hold.
 */
export function ensureContrast(
  foreground: RGBA,
  background: RGBA,
  min = 4.5,
  fallback: RGBA = foreground,
): RGBA {
  return contrastRatio(foreground, background) >= min ? foreground : fallback
}
