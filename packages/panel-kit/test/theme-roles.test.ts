/**
 * theme-roles.test.ts — v1.2 slot contracts that are pure functions:
 * the chrome fallback for pre-v1.2 themes and the contrast floor.
 *
 * Slot projection and fade coverage live in shell.test.tsx / motion.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import type { PanelTheme } from "../src/contracts"
import { FALLBACK_THEME } from "../src/fallback"
import { fadeColor, resolvePanelChrome, withContrastFloor } from "../src/theme"

const theme = FALLBACK_THEME

describe("resolvePanelChrome on a pre-v1.2 theme", () => {
  test("missing background.content falls back to the page surface", () => {
    const legacy = {
      ...theme,
      background: {
        surface: theme.background.surface,
        raised: theme.background.raised,
        scrim: theme.background.scrim,
      },
    } as unknown as PanelTheme
    const chrome = resolvePanelChrome(legacy)
    expect(chrome.content).toBe(theme.background.surface)
    expect(chrome.navBand).toBe(theme.background.raised)
    // The title band is derived from the fallback content, not a literal.
    expect(chrome.titleBand.toInts()).toEqual(
      fadeColor(theme.background.surface, theme.background.raised, 0.5).toInts(),
    )
  })
})

describe("withContrastFloor", () => {
  const black = RGBA.fromInts(0, 0, 0)
  const fallback = RGBA.fromInts(255, 0, 0)

  test("returns fg when it clears 4.5:1", () => {
    const white = RGBA.fromInts(255, 255, 255)
    expect(withContrastFloor(white, black, fallback)).toBe(white)
    // 117/255 gray on black is 4.5578:1 — the first 8-bit gray that passes.
    const pass = RGBA.fromInts(117, 117, 117)
    expect(withContrastFloor(pass, black, fallback)).toBe(pass)
  })

  test("returns fallback below 4.5:1", () => {
    // 116/255 gray on black is 4.4929:1 — just under the AA floor.
    expect(withContrastFloor(RGBA.fromInts(116, 116, 116), black, fallback)).toBe(fallback)
    expect(withContrastFloor(RGBA.fromInts(0, 0, 0), black, fallback)).toBe(fallback)
  })

  test("exactly 4.5:1 passes, one step below falls back", () => {
    // Channels are 8-bit RGBA instances in production, so 4.5:1 is not
    // representable there; use float channel stand-ins to pin the boundary.
    function gray(v: number): RGBA {
      return { r: v, g: v, b: v, a: 1 } as unknown as RGBA
    }
    function linear(channel: number): number {
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    }
    function luminance(color: RGBA): number {
      return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
    }
    function ratio(a: RGBA, b: RGBA): number {
      const la = luminance(a)
      const lb = luminance(b)
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
    }

    // sRGB-encode the luminance that yields (L + 0.05) / 0.05 = 4.5 on black.
    let v = 1.055 * 0.175 ** (1 / 2.4) - 0.055
    while (ratio(gray(v), gray(0)) < 4.5) v += Number.EPSILON
    const at = gray(v)
    expect(ratio(at, gray(0))).toBeCloseTo(4.5, 12)
    expect(withContrastFloor(at, gray(0), fallback)).toBe(at)

    const below = gray(v - Number.EPSILON)
    expect(ratio(below, gray(0))).toBeLessThan(4.5)
    expect(withContrastFloor(below, gray(0), fallback)).toBe(fallback)
  })
})
