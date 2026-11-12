/**
 * contract-compile.test.ts — T17a smoke test.
 *
 * Purpose: prove the contract surface imports and typechecks, and that the
 * spec-pinned constants/absence rules hold. T17-INT2: slide is deferred, so
 * slide constants/types and PanelOptions.enterFrom/exitTo must be GONE.
 */
import { expect, test } from "bun:test"
import { FADE_MS, PANEL_WIDTHS, SCRIM_MAX, SCRIM_STEP } from "../src"
import * as kit from "../src"
import type { PanelKitProviderProps, PanelProps, PanelTheme } from "../src"

/** Compile-time check: the value must satisfy T; returns it unchanged. */
function accepts<T>(value: T): T {
  return value
}

test("contracts compile and constants are spec-pinned", () => {
  expect(PANEL_WIDTHS).toEqual({ medium: 60, large: 88, xlarge: 116 })
  expect(Object.isFrozen(PANEL_WIDTHS)).toBe(true)
  expect([FADE_MS, SCRIM_STEP, SCRIM_MAX]).toEqual([160, 24, 210])

  // v1 transition is fade only; the slide surface is not exported.
  expect("SLIDE_MS" in kit).toBe(false)
  expect("VERTICAL_OFFSET" in kit).toBe(false)
  expect("HORIZONTAL_OFFSET" in kit).toBe(false)
  expect("sampleSlide" in kit).toBe(false)
  expect("createSlideDriver" in kit).toBe(false)

  const props = accepts<PanelProps>({
    title: "Settings",
    size: "xlarge",
    border: "heavy",
    scrim: true,
    scrimAlpha: 150,
    fadeIn: true,
    beforeClose: () => true,
  })
  expect(props.fadeIn).toBe(true)

  // @ts-expect-error slide directions were removed in T17-INT2
  const removed: PanelProps = { title: "x", enterFrom: "top" }
  expect(removed.title).toBe("x")

  // Type-only: the provider/adapter surface and theme projection exist.
  const provider = undefined as unknown as PanelKitProviderProps
  const theme = undefined as unknown as PanelTheme
  expect(provider).toBeUndefined()
  expect(theme).toBeUndefined()
})

test("PanelProps has no scrim-click dismiss", () => {
  type HasDismiss = "dismissOnScrimClick" extends keyof PanelProps ? true : false
  const hasDismiss: HasDismiss = false
  expect(hasDismiss).toBe(false)

  // Esc is the only back action (user decision 2026-11-12). If this prop is
  // ever added to the contract, the unused @ts-expect-error fails typecheck.
  // @ts-expect-error scrim clicks never dismiss
  const forbidden: PanelProps = { title: "x", dismissOnScrimClick: true }
  expect(forbidden.title).toBe("x")
})
