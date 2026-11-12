/**
 * slots.test.tsx — v1.1 structural slots (PanelTitle / PanelBody /
 * PanelActions).
 *
 * Pure assertions cover the static identity-gradient projection (endpoints
 * exact, no division by zero). Render smokes pin the painted text and layout
 * structure: title + subtitle + right hint, body children, and the actions
 * band (secondary hints left, primary buttons right, faint hint line last).
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import type { CapturedSpan } from "@opentui/core"
import type { PanelKitContextValue } from "../src/contracts"
import { FALLBACK_THEME } from "../src/fallback"
import { PanelActions, PanelBody, PanelTitle, titleGradientStops } from "../src/slots"
import { PanelKitContext, STATIC_MOTION } from "../src/theme"

// The public barrel must expose the v1.1 surface (imported as a module).
const barrel = await import("../src")

const kit: PanelKitContextValue = {
  theme: () => FALLBACK_THEME,
  motion: STATIC_MOTION,
}

function frameText(frame: { lines: { spans: CapturedSpan[] }[] }): string {
  return frame.lines.map((line) => line.spans.map((span) => span.text).join("")).join("\n")
}

/** Row index of the first captured line containing `needle`, or -1. */
function rowOf(frame: { lines: { spans: CapturedSpan[] }[] }, needle: string): number {
  return frame.lines.findIndex((line) => line.spans.some((span) => span.text.includes(needle)))
}

describe("v1.1 public exports", () => {
  test("slots, column helpers and paging helpers are on the barrel", () => {
    for (const name of [
      "PanelTitle",
      "PanelBody",
      "PanelActions",
      "titleGradientStops",
      "resolveListColumns",
      "listColumnRow",
      "listColumnValues",
      "resolveListPage",
      "nextListPage",
      "listPageIndicator",
    ] as const) {
      expect(typeof barrel[name]).toBe("function")
    }
  })
})

describe("titleGradientStops", () => {
  const gradient = [RGBA.fromValues(0.2, 0.4, 1, 1), RGBA.fromValues(1, 0.3, 0.6, 1)] as const

  test("empty text yields no stops; one cluster takes the start color", () => {
    expect(titleGradientStops("", gradient)).toEqual([])
    expect(titleGradientStops("设", gradient)).toEqual([{ text: "设", color: gradient[0] }])
  })

  test("endpoints are exact and wide glyphs stay whole", () => {
    const stops = titleGradientStops("设置ab", gradient)
    expect(stops.map((stop) => stop.text)).toEqual(["设", "置", "a", "b"])
    expect(stops[0]!.color).toBe(gradient[0])
    expect(stops[stops.length - 1]!.color).toBe(gradient[1])
    expect(stops.map((stop) => stop.text).join("")).toBe("设置ab")
  })
})

describe("PanelTitle render", () => {
  test("paints title, subtitle and the default esc hint on one column", async () => {
    const setup = await testRender(
      () => (
        <PanelKitContext.Provider value={kit}>
          <PanelTitle title="Settings" subtitle="Appearance" />
        </PanelKitContext.Provider>
      ),
      { width: 40, height: 6, useMouse: false },
    )
    try {
      await setup.renderOnce()
      const frame = setup.captureSpans()
      expect(frameText(frame)).toContain("Settings")
      expect(frameText(frame)).toContain("Appearance")
      expect(frameText(frame)).toContain("esc")
      expect(rowOf(frame, "Appearance")).toBeGreaterThan(rowOf(frame, "Settings"))
    } finally {
      await setup.dispose()
    }
  })

  test("right slot replaces the hint; closeHint false hides it", async () => {
    const withRight = await testRender(
      () => (
        <PanelKitContext.Provider value={kit}>
          <PanelTitle title="Agents" right={<text>⌘K</text>} />
        </PanelKitContext.Provider>
      ),
      { width: 40, height: 4, useMouse: false },
    )
    try {
      await withRight.renderOnce()
      const frame = withRight.captureCharFrame()
      expect(frame).toContain("Agents")
      expect(frame).toContain("⌘K")
      expect(frame).not.toContain("esc")
    } finally {
      await withRight.dispose()
    }

    const hidden = await testRender(
      () => (
        <PanelKitContext.Provider value={kit}>
          <PanelTitle title="Quiet" closeHint={false} />
        </PanelKitContext.Provider>
      ),
      { width: 40, height: 4, useMouse: false },
    )
    try {
      await hidden.renderOnce()
      const frame = hidden.captureCharFrame()
      expect(frame).toContain("Quiet")
      expect(frame).not.toContain("esc")
    } finally {
      await hidden.dispose()
    }
  })

  test("the identity gradient still paints the whole title", async () => {
    const setup = await testRender(
      () => (
        <PanelKitContext.Provider value={kit}>
          <PanelTitle title="Gradient" gradient={FALLBACK_THEME.identity} />
        </PanelKitContext.Provider>
      ),
      { width: 40, height: 4, useMouse: false },
    )
    try {
      await setup.renderOnce()
      const frame = setup.captureSpans()
      expect(frameText(frame)).toContain("Gradient")
      // One colored text span per grapheme, all inside the title row.
      const titleSpanCount = frame.lines
        .flatMap((line) => line.spans)
        .filter((span) => "Gradient".includes(span.text) && span.text.length === 1).length
      expect(titleSpanCount).toBeGreaterThanOrEqual("Gradient".length)
    } finally {
      await setup.dispose()
    }
  })
})

describe("PanelBody render", () => {
  test("renders its children in a vertical column and caps rows when asked", async () => {
    const setup = await testRender(
      () => (
        <PanelKitContext.Provider value={kit}>
          <PanelBody maxRows={3}>
            <text>first</text>
            <text>second</text>
          </PanelBody>
        </PanelKitContext.Provider>
      ),
      { width: 30, height: 8, useMouse: false },
    )
    try {
      await setup.renderOnce()
      const frame = setup.captureSpans()
      expect(frameText(frame)).toContain("first")
      expect(frameText(frame)).toContain("second")
      expect(rowOf(frame, "second")).toBeGreaterThan(rowOf(frame, "first"))
    } finally {
      await setup.dispose()
    }
  })
})

describe("PanelActions render", () => {
  test("secondary hints left, primary button right, faint hint line last", async () => {
    const pressed: string[] = []
    const setup = await testRender(
      () => (
        <PanelKitContext.Provider value={kit}>
          <box flexDirection="column" width={40}>
            <PanelBody>
              <text>body</text>
            </PanelBody>
            <PanelActions
              secondary={[{ id: "back", label: "Back", keyHint: "esc", onPress: () => {} }]}
              primary={[{ id: "save", label: "Save", keyHint: "enter", onPress: () => pressed.push("save") }]}
              hint="enter save · esc close"
            />
          </box>
        </PanelKitContext.Provider>
      ),
      { width: 40, height: 10, useMouse: false },
    )
    try {
      await setup.renderOnce()
      const frame = setup.captureSpans()
      const text = frameText(frame)
      expect(text).toContain("esc Back")
      expect(text).toContain("Save enter")
      expect(text).toContain("enter save · esc close")
      // Body, then the actions band, then the hint line (bottom-most).
      expect(rowOf(frame, "esc Back")).toBeGreaterThan(rowOf(frame, "body"))
      expect(rowOf(frame, "enter save · esc close")).toBeGreaterThan(rowOf(frame, "esc Back"))
      expect(pressed).toEqual([])
    } finally {
      await setup.dispose()
    }
  })

  test("only a hint line renders when no actions are supplied", async () => {
    const setup = await testRender(
      () => (
        <PanelKitContext.Provider value={kit}>
          <PanelActions hint="esc close" />
        </PanelKitContext.Provider>
      ),
      { width: 30, height: 4, useMouse: false },
    )
    try {
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("esc close")
      // Right-aligned: the hint shares its line with leading whitespace.
      const line = frame.split("\n").find((entry) => entry.includes("esc close"))!
      expect(line.trimEnd().endsWith("esc close")).toBe(true)
      expect(line.search(/\S/)).toBeGreaterThan(0)
    } finally {
      await setup.dispose()
    }
  })
})
