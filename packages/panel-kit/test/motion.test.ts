/**
 * motion.test.ts — the fade contract, point by point.
 *
 * Everything here is a pure function: clamp01, the whole-theme fade
 * projection, the phase machine and the motion gate. The shared-clock driver
 * is exercised in shell.test.tsx through testRender.
 */
import { describe, expect, test } from "bun:test"
import { FADE_MS } from "../src/contracts"
import {
  clamp01,
  motionDegraded,
  motionRate,
  nextPanelPhase,
  phaseAnimates,
  type PanelPhase,
} from "../src/motion"
import { FALLBACK_THEME } from "../src/fallback"
import { fadeColor, fadeTheme } from "../src/theme"

const theme = FALLBACK_THEME

describe("clamp01", () => {
  test("clamps and rejects non-finite values", () => {
    expect(clamp01(-3)).toBe(0)
    expect(clamp01(0.25)).toBe(0.25)
    expect(clamp01(4)).toBe(1)
    expect(clamp01(Number.NaN)).toBe(0)
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(1)
  })
})

describe("fadeTheme", () => {
  test("t = 1 returns the resolved theme unchanged", () => {
    expect(fadeTheme(theme, 1)).toBe(theme)
    expect(fadeTheme(theme, 4)).toBe(theme)
  })

  test("t = 0 collapses every color onto background.surface", () => {
    const faded = fadeTheme(theme, 0)
    const surface = theme.background.surface.toInts()
    expect(faded.text.base.toInts()).toEqual(surface)
    expect(faded.text.muted.toInts()).toEqual(surface)
    expect(faded.row.activeBg.toInts()).toEqual(surface)
    expect(faded.border.focused.color.toInts()).toEqual(surface)
    expect(faded.identity[0].toInts()).toEqual(surface)
    // Structure survives the projection.
    expect(faded.border.focused.style).toBe(theme.border.focused.style)
    expect(faded.attributes).toBe(theme.attributes)
    expect(faded.background.surface).toBe(theme.background.surface)
  })

  test("t = 0.5 is the channel midpoint of surface → token", () => {
    const faded = fadeTheme(theme, 0.5)
    const expected = fadeColor(theme.background.surface, theme.text.base, 0.5)
    expect(faded.text.base.toInts()).toEqual(expected.toInts())
    const danger = fadeColor(theme.background.surface, theme.text.danger, 0.5)
    expect(faded.text.danger.toInts()).toEqual(danger.toInts())
    const border = fadeColor(theme.background.surface, theme.border.base.color, 0.5)
    expect(faded.border.base.color.toInts()).toEqual(border.toInts())
    expect(faded.border.base.style).toBe(theme.border.base.style)
  })

  test("the fade window is spec-pinned at 160 ms", () => {
    expect(FADE_MS).toBe(160)
  })
})

describe("phase machine", () => {
  test("mount animates unless degraded", () => {
    expect(nextPanelPhase("idle", "mount", false)).toBe("entering")
    expect(nextPanelPhase("idle", "mount", true)).toBe("open")
  })

  test("entering → open only through entered", () => {
    expect(nextPanelPhase("entering", "entered", false)).toBe("open")
    expect(nextPanelPhase("open", "entered", false)).toBe("open")
  })

  test("close request plays the fade-out, or jumps when degraded", () => {
    expect(nextPanelPhase("open", "requestClose", false)).toBe("exiting")
    expect(nextPanelPhase("open", "requestClose", true)).toBe("closed")
  })

  test("a close during enter lands immediately (no exit replay)", () => {
    expect(nextPanelPhase("entering", "requestClose", false)).toBe("closed")
  })

  test("second close during exit closes now", () => {
    expect(nextPanelPhase("exiting", "requestClose", false)).toBe("closed")
  })

  test("exited finishes and closeNow is idempotent", () => {
    expect(nextPanelPhase("exiting", "exited", false)).toBe("closed")
    expect(nextPanelPhase("open", "closeNow", false)).toBe("closed")
    expect(nextPanelPhase("closed", "closeNow", false)).toBe("closed")
    expect(nextPanelPhase("closed", "requestClose", false)).toBe("closed")
  })

  test("only entering/exiting animate", () => {
    const phases: PanelPhase[] = ["idle", "entering", "open", "exiting", "closed"]
    expect(phases.filter(phaseAnimates)).toEqual(["entering", "exiting"])
  })

  test("motion gate: jump or a paused clock disables the tick", () => {
    const full = { decorationsEnabled: () => true, fps: () => 24, jump: () => false }
    const reduced = { decorationsEnabled: () => false, fps: () => 12.5, jump: () => true }
    const off = { decorationsEnabled: () => false, fps: () => undefined, jump: () => true }

    expect(motionRate(() => "entering", () => full)).toBe(24)
    expect(motionRate(() => "exiting", () => full)).toBe(24)
    expect(motionRate(() => "open", () => full)).toBeUndefined()
    expect(motionRate(() => "entering", () => reduced)).toBeUndefined()
    expect(motionRate(() => "entering", () => off)).toBeUndefined()

    expect(motionDegraded(full)).toBe(false)
    expect(motionDegraded(reduced)).toBe(true)
    expect(motionDegraded(off)).toBe(true)
    // fps undefined alone is enough even if a broken adapter claims jump false.
    expect(motionDegraded({ decorationsEnabled: () => false, fps: () => undefined, jump: () => false })).toBe(true)
  })
})
