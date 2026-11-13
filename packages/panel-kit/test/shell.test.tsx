/**
 * shell.test.tsx — Panel shell deliverables.
 *
 * Pure assertions cover the theme projection, the row helpers and the size
 * rules. Render-level assertions use @opentui/solid's testRender: frame text,
 * scrim/surface colors from captured spans, Esc → beforeClose, and the
 * shared-clock fade (subtree tint at mid-flight, token color when settled).
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import type { PanelMotionAdapter } from "../src/contracts"
import { FALLBACK_THEME } from "../src/fallback"
import { Panel, resolvePanelHeightLimit, resolvePanelMetrics, resolvePanelRows, resolvePanelWidth } from "../src/panel"
import { PanelKitContext, fadeColor, fadeTheme, resolveFrameToken, resolveIdentity, resolvePanelChrome, resolveScrimAlpha, resolveScrimColor, resolveTitleColor, usePanelTheme } from "../src/theme"
import { align, fitColumns, fitRow, hasWideGlyphs, measure, padEnd, padStart, takeCells, truncate } from "../src/text"

/** Child probe: reads the live (possibly faded) theme like a control does. */
function ThemedProbe(): JSX.Element {
  const live = usePanelTheme()
  return <text fg={live().text.base}>Body text</text>
}

const theme = FALLBACK_THEME
const jumpMotion: PanelMotionAdapter = {
  decorationsEnabled: () => false,
  fps: () => undefined,
  jump: () => true,
}
const fullMotion: PanelMotionAdapter = {
  decorationsEnabled: () => true,
  fps: () => 60,
  jump: () => false,
}

function tree(props: Parameters<typeof Panel>[0], motion: PanelMotionAdapter = jumpMotion): JSX.Element {
  return (
    <PanelKitContext.Provider value={{ theme: () => theme, motion }}>
      <Panel {...props} />
    </PanelKitContext.Provider>
  )
}

async function renderPanel(props: Parameters<typeof Panel>[0], motion: PanelMotionAdapter = jumpMotion) {
  const setup = await testRender(() => tree(props, motion), { width: 80, height: 24 })
  await setup.renderOnce()
  return setup
}

/** stdin parsing is deferred; pump the loop before asserting. */
async function pressEsc(setup: Awaited<ReturnType<typeof renderPanel>>) {
  setup.mockInput.pressEscape()
  // stdin parsing is deferred by a tick in the test renderer.
  await Bun.sleep(60)
  await setup.flush()
}

/** Row index of the first row containing `needle`, or -1. */

// ---------------------------------------------------------------------------
// Theme projection (pure)
// ---------------------------------------------------------------------------

/**
 * Poll the painted title colour until `predicate` holds (or the deadline
 * passes). The fade is driven by the shared animation clock, so a loaded CI
 * runner can miss a fixed sampling window; polling asserts the same behaviour
 * without depending on wall-clock scheduling.
 */
async function waitForTitle(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: (fg: { toInts(): readonly number[] }) => boolean,
  timeoutMs = 1500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await setup.flush()
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
    const title = spans.find((span) => span.text.includes("Exiting"))
    if (title !== undefined && predicate(title.fg)) return true
    if (Date.now() >= deadline) return false
    await Bun.sleep(16)
  }
}

/** Poll until `read()` reaches `want`, returning the value it settled on. */
async function waitForClosed(read: () => number, want: number, timeoutMs = 1500): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (read() < want && Date.now() < deadline) await Bun.sleep(16)
  return read()
}

describe("theme projection", () => {
  test("tone selects the frame token; an override changes style only", () => {
    expect(resolveFrameToken(theme, "accent")).toEqual(theme.border.focused)
    expect(resolveFrameToken(theme, "warning")).toEqual(theme.border.warning)
    expect(resolveFrameToken(theme, "danger")).toEqual({
      style: theme.border.warning.style,
      color: theme.text.danger,
    })
    expect(resolveFrameToken(theme, "accent", "double")).toEqual({
      style: "double",
      color: theme.border.focused.color,
    })
    expect(resolveFrameToken(theme, "warning", "rounded").style).toBe("rounded")
  })

  test("title color follows tone", () => {
    expect(resolveTitleColor(theme, "accent")).toBe(theme.text.base)
    expect(resolveTitleColor(theme, "warning")).toBe(theme.text.warning)
    expect(resolveTitleColor(theme, "danger")).toBe(theme.text.danger)
  })

  test("scrim alpha adds 24 per level and caps at 210", () => {
    expect(resolveScrimAlpha(150)).toBe(150)
    expect(resolveScrimAlpha(150, 1)).toBe(174)
    expect(resolveScrimAlpha(150, 2)).toBe(198)
    expect(resolveScrimAlpha(150, 3)).toBe(210)
    expect(resolveScrimAlpha(150, 9)).toBe(210)
    expect(resolveScrimAlpha(255)).toBe(255)
    expect(resolveScrimAlpha(255, 1)).toBe(210)
    expect(resolveScrimAlpha(-10)).toBe(0)
    expect(resolveScrimAlpha(12.6)).toBe(13)
  })

  test("scrim color clones and only alpha changes", () => {
    const color = resolveScrimColor(theme, 174)
    expect(color.toInts()).toEqual([0, 0, 0, 174])
    expect(theme.background.scrim.toInts()[3]).toBe(150)
    expect(resolveScrimColor(theme).toInts()).toEqual([0, 0, 0, 150])
  })

  test("identity gradient is full-tier only and never on wide titles", () => {
    expect(resolveIdentity(theme, true)).toBe(theme.identity)
    expect(resolveIdentity(theme, false)).toBeUndefined()
    expect(resolveIdentity(theme, true, true)).toBeUndefined()
  })

  test("fadeColor interpolates foreground, endpoints exact", () => {
    const from = RGBA.fromInts(0, 0, 0, 255)
    const to = RGBA.fromInts(255, 100, 50, 255)
    expect(fadeColor(from, to, 0)).toBe(from)
    expect(fadeColor(from, to, 1)).toBe(to)
    expect(fadeColor(from, to, 0.5).toInts()).toEqual([128, 50, 25, 255])
    expect(fadeColor(from, to, -1)).toBe(from)
    expect(fadeColor(from, to, 2)).toBe(to)
  })

  test("the fallback theme is the only palette and keeps dialog scrim parity", () => {
    expect(theme.background.scrim.toInts()).toEqual([0, 0, 0, 150])
    expect(Object.isFrozen(theme)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Row helpers (pure)
// ---------------------------------------------------------------------------

describe("text helpers", () => {
  test("measures wide glyphs as two cells", () => {
    expect(measure("abc")).toBe(3)
    expect(measure("设置")).toBe(4)
    expect(hasWideGlyphs("设置")).toBe(true)
    expect(hasWideGlyphs("settings")).toBe(false)
  })

  test("truncate never splits a wide glyph and adds an ellipsis", () => {
    expect(truncate("abcdef", 10)).toBe("abcdef")
    expect(truncate("abcdef", 4)).toBe("abc…")
    expect(truncate("设置项目", 5)).toBe("设置…")
    expect(truncate("设置项目", 4)).toBe("设…")
    expect(truncate("abc", 0)).toBe("")
    expect(truncate("abc", 1)).toBe("…")
    expect(measure(truncate("设置项目列表", 7))).toBeLessThanOrEqual(7)
  })

  test("takeCells cuts on a cluster boundary", () => {
    expect(takeCells("设置项目", 2)).toBe("设")
    expect(takeCells("设置项目", 3)).toBe("设")
    expect(takeCells("abc", 2)).toBe("ab")
    expect(takeCells("abc", -1)).toBe("")
  })

  test("padding fills the exact cell box", () => {
    expect(padEnd("ab", 4)).toBe("ab  ")
    expect(padStart("ab", 4)).toBe("  ab")
    expect(align("设置", 6, "right")).toBe("  设置")
    expect(measure(padEnd("设置", 7))).toBe(7)
    expect(padEnd("toolong", 3)).toBe("to…")
  })

  test("fitRow keeps the right segment readable", () => {
    expect(fitRow("settings", "esc", 14)).toBe("settings   esc")
    const tight = fitRow("a very long label", "enter", 12)
    expect(measure(tight)).toBe(12)
    expect(tight.endsWith("enter")).toBe(true)
    expect(fitRow("x", "a value wider than row", 5)).toBe("     ")
  })

  test("fitColumns pads fixed widths", () => {
    expect(fitColumns(["a", "42"], [3, 3])).toBe("a   42 ")
    expect(fitColumns(["a", "42"], [3, 3], ["left", "right"])).toBe("a    42")
    expect(fitColumns(["only"], [3, 4])).toBe("on…     ")
  })
})

// ---------------------------------------------------------------------------
// Size rules (pure)
// ---------------------------------------------------------------------------

describe("size rules", () => {
  test("width presets match the dialog widths and clamp to terminal - 2", () => {
    expect(resolvePanelWidth(undefined, undefined, 120)).toBe(60)
    expect(resolvePanelWidth("large", undefined, 120)).toBe(88)
    expect(resolvePanelWidth("xlarge", undefined, 120)).toBe(116)
    expect(resolvePanelWidth("full", undefined, 120)).toBe(116)
    expect(resolvePanelWidth("medium", undefined, 50)).toBe(48)
    expect(resolvePanelWidth("medium", 30, 120)).toBe(30)
  })

  test("height limit defaults to terminal rows - 4 and never underflows", () => {
    expect(resolvePanelHeightLimit(undefined, 24)).toBe(20)
    expect(resolvePanelHeightLimit(10, 24)).toBe(10)
    expect(resolvePanelHeightLimit(100, 24)).toBe(20)
    expect(resolvePanelHeightLimit(undefined, 5)).toBe(3)
  })

  test("compact is width < 64 || height < 20", () => {
    expect(resolvePanelMetrics(78, 18).compact).toBe(true)
    expect(resolvePanelMetrics(60, 30).compact).toBe(true)
    expect(resolvePanelMetrics(78, 30).compact).toBe(false)
  })

  test("rows is a fixed frame height clamped like the height cap (v1.2)", () => {
    expect(resolvePanelRows(undefined, 40)).toBeUndefined()
    expect(resolvePanelRows(Number.NaN, 40)).toBeUndefined()
    expect(resolvePanelRows(30, 40)).toBe(30)
    expect(resolvePanelRows(29.7, 40)).toBe(29)
    expect(resolvePanelRows(100, 40)).toBe(36)
    expect(resolvePanelRows(2, 40)).toBe(3)
    expect(resolvePanelRows(30, 10)).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// Fixed frame (v1.2 `rows`) + layered chrome
// ---------------------------------------------------------------------------

/** First/last row of the frame's top/bottom border in the painted frame. */
function frameEdges(setup: Awaited<ReturnType<typeof testRender>>): { top: number; bottom: number } {
  const lines = setup.captureCharFrame().split("\n")
  return {
    top: lines.findIndex((line) => line.includes("┏")),
    bottom: lines.findLastIndex((line) => line.includes("┗")),
  }
}

describe("fixed frame and layered chrome", () => {
  test("a taller body cannot change the frame edges; rows fixes the height", async () => {
    // One renderer at a time (a second live testRender has no renderer), and
    // children are lazy: a function child is resolved inside the render root,
    // so createElement never runs before a renderer exists.
    const lazy = (build: () => JSX.Element) => build as unknown as JSX.Element
    const short = await renderPanel({
      title: "Fixed",
      rows: 14,
      width: 40,
      children: lazy(() => <text>one</text>),
    })
    const a = frameEdges(short)
    await short.dispose()

    const tall = await renderPanel({
      title: "Fixed",
      rows: 14,
      width: 40,
      children: lazy(() => (
        <box flexDirection="column">
          {Array.from({ length: 20 }, (_, index) => (
            <text>{`row ${index + 1}`}</text>
          ))}
        </box>
      )),
    })
    const b = frameEdges(tall)
    await tall.dispose()

    // 80x24 terminal: a 14-row frame is centered at row 5 and ends at 18.
    expect(a).toEqual({ top: 5, bottom: 18 })
    expect(b).toEqual(a)
    expect(a.bottom - a.top + 1).toBe(14)
  })

  test("rows wins over a content `height` cap", async () => {
    const setup = await renderPanel({ title: "Fixed", rows: 12, height: 4, width: 40 })
    try {
      expect(frameEdges(setup)).toEqual({ top: 6, bottom: 17 })
    } finally {
      await setup.dispose()
    }
  })

  test("layered paints the title band and a rule under it; flat keeps v1.1", async () => {
    const layered = await renderPanel({ title: "Layered", rows: 12, width: 40, layered: true })
    const flat = await renderPanel({ title: "Layered", rows: 12, width: 40 })
    try {
      const chrome = resolvePanelChrome(theme)
      const lines = layered.captureCharFrame().split("\n")
      const titleRow = lines.findIndex((line) => line.includes("Layered"))
      expect(titleRow).toBeGreaterThan(-1)
      // One-color band behind the title, straight from the theme projection.
      const titleSpan = layered
        .captureSpans()
        .lines[titleRow]!.spans.find((span) => span.text.includes("Layered"))
      expect(titleSpan?.bg.toInts()).toEqual(chrome.titleBand.toInts())
      expect(chrome.titleBand.toInts()).not.toEqual(chrome.content.toInts())
      // The rule row right under the title.
      expect(lines[titleRow + 1]).toContain("─")

      const flatLines = flat.captureCharFrame().split("\n")
      const flatTitleRow = flatLines.findIndex((line) => line.includes("Layered"))
      const flatSpan = flat
        .captureSpans()
        .lines[flatTitleRow]!.spans.find((span) => span.text.includes("Layered"))
      // Flat (v1.1) leaves the title band unpainted, so the panel surface
      // shows through — unchanged by the v1.2 content raise.
      expect(flatSpan?.bg.toInts()).toEqual(theme.background.surface.toInts())
      expect(flatLines[flatTitleRow + 1]).not.toContain("─")
    } finally {
      await layered.dispose()
      await flat.dispose()
    }
  })

  test("the chrome projection is token-only and keeps the bands distinct", () => {
    const chrome = resolvePanelChrome(theme)
    expect(chrome.content).toBe(theme.background.content)
    expect(chrome.navBand).toBe(theme.background.raised)
    expect(chrome.divider).toBe(theme.border.base.color)
    expect(chrome.titleBand.toInts()).not.toEqual(chrome.content.toInts())
    expect(chrome.navBand.toInts()).not.toEqual(chrome.titleBand.toInts())
    // The content layer sits above the page surface but below the nav band.
    expect(chrome.content.toInts()).not.toEqual(theme.background.surface.toInts())
    expect(chrome.content.toInts()).not.toEqual(chrome.navBand.toInts())
  })

  test("v1.2 slots project through fadeTheme (rail, content and text roles)", () => {
    const faded = fadeTheme(theme, 0.5)
    // Every new slot interpolates from the panel surface instead of freezing.
    expect(faded.background.content.toInts()).not.toEqual(theme.background.content.toInts())
    for (const key of ["code", "user", "system", "heading"] as const) {
      expect(faded.text[key].toInts()).not.toEqual(theme.text[key].toInts())
      // Mid-fade each slot is a mix of the SAME surface toward its own token
      // (the user role equals base in the fallback palette, so it can match).
      if (theme.text[key].toInts().join() !== theme.text.base.toInts().join()) {
        expect(faded.text[key].toInts()).not.toEqual(faded.text.base.toInts())
      }
    }
    // t = 1 is the identity, so the live theme is never re-projected.
    expect(fadeTheme(theme, 1)).toBe(theme)
  })

  test("the fallback palette carries every v1.2 role with distinct values", () => {
    expect(FALLBACK_THEME.background.content.toInts()).not.toEqual(
      FALLBACK_THEME.background.surface.toInts(),
    )
    const roles = ["base", "muted", "code", "user", "system", "heading"] as const
    for (const key of roles) expect(FALLBACK_THEME.text[key]).toBeDefined()
    // Roles must be visually distinguishable from the primary text.
    for (const key of ["muted", "code", "system", "heading"] as const) {
      expect(FALLBACK_THEME.text[key].toInts()).not.toEqual(FALLBACK_THEME.text.base.toInts())
    }
  })
})

// ---------------------------------------------------------------------------
// Package rules (spec §4.1, §7.2, decision D1)
// ---------------------------------------------------------------------------

describe("package rules", () => {
  const srcDir = fileURLToPath(new URL("../src/", import.meta.url))
  // This lane's files only: fallback.ts is the sanctioned palette.
  const laneFiles = ["panel.tsx", "motion.ts", "theme.ts", "text.ts"]

  const sources = () =>
    laneFiles.map((file) => ({ file, text: readFileSync(`${srcDir}/${file}`, "utf8") }))

  test("no literal colors outside fallback.ts", () => {
    for (const { file, text } of sources()) {
      expect({ file, hex: /#[0-9a-fA-F]{6}\b/.test(text) }).toEqual({ file, hex: false })
      expect({ file, ints: /RGBA\.fromInts/.test(text) }).toEqual({ file, ints: false })
    }
  })

  test("the shared clock is the only driver", () => {
    for (const { file, text } of sources()) {
      expect({ file, loop: /setInterval\s*\(|setTimeout\s*\(/.test(text) }).toEqual({ file, loop: false })
      expect({ file, timer: /requestAnimationFrame/.test(text) }).toEqual({ file, timer: false })
    }
  })

  test("the kit never imports tui-base", () => {
    for (const { file, text } of sources()) {
      expect({ file, backImport: /from\s+["'][^"']*tui-base/.test(text) }).toEqual({ file, backImport: false })
    }
  })
})

// ---------------------------------------------------------------------------
// Render level
// ---------------------------------------------------------------------------

describe("Panel render", () => {
  test("jump mode paints title, esc hint, frame and scrim", async () => {
    const setup = await renderPanel({ title: "Settings", subtitle: "Appearance" })
    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain("Settings")
      expect(frame).toContain("Appearance")
      expect(frame).toContain("esc")
      expect(frame).toContain("┏")
      expect(frame).toContain("┗")

      // The scrim composites to black over the default background; the frame
      // itself carries the theme surface and the heavy accent border.
      const spans = setup.captureSpans()
      const title = spans.lines
        .flatMap((line) => line.spans)
        .find((span) => span.text.includes("Settings"))
      expect(title?.bg.toInts()).toEqual(theme.background.surface.toInts())
      expect(title?.fg.toInts()).toEqual(theme.text.base.toInts())
      expect(title?.attributes).toBe(1) // TextAttributes.BOLD from the theme token
    } finally {
      await setup.dispose()
    }
  })

  test("warning tone recolors the frame token without animating it", async () => {
    const setup = await renderPanel({ title: "Delete", tone: "warning", align: "top" })
    try {
      const spans = setup.captureSpans()
      const frameCell = spans.lines.flatMap((line) => line.spans).find((span) => span.text.includes("┏"))
      expect(frameCell?.fg.toInts()).toEqual(theme.text.warning.toInts())
    } finally {
      await setup.dispose()
    }
  })

  test("beforeClose veto keeps the panel open, then allows it", async () => {
    let allowed = false
    let closed = 0
    const setup = await renderPanel({
      title: "Settings",
      beforeClose: () => allowed,
      onClose: () => closed++,
    })
    try {
      await pressEsc(setup)
      expect(closed).toBe(0)
      expect(setup.captureCharFrame()).toContain("Settings")

      allowed = true
      await pressEsc(setup)
      expect(closed).toBe(1)
      expect(setup.captureCharFrame()).not.toContain("Settings")
    } finally {
      await setup.dispose()
    }
  })

  test("async beforeClose resolves before closing", async () => {
    let closed = 0
    const setup = await renderPanel({
      title: "Async",
      beforeClose: async () => {
        await Bun.sleep(5)
        return true
      },
      onClose: () => closed++,
    })
    try {
      setup.mockInput.pressEscape()
      await Bun.sleep(5)
      await setup.flush()
      expect(closed).toBe(0)
      await Bun.sleep(80)
      await setup.flush()
      expect(closed).toBe(1)
    } finally {
      await setup.dispose()
    }
  })

  test("active=false ignores Esc (non-top layers)", async () => {
    let closed = 0
    const setup = await renderPanel({ title: "Below", active: false, onClose: () => closed++ })
    try {
      await pressEsc(setup)
      expect(closed).toBe(0)
    } finally {
      await setup.dispose()
    }
  })

  test("full tier fades the whole subtree from surface toward the tokens", async () => {
    const setup = await testRender(
      () => (
        <PanelKitContext.Provider value={{ theme: () => theme, motion: fullMotion }}>
          <Panel title="Fading" height={8}>
            <ThemedProbe />
          </Panel>
        </PanelKitContext.Provider>
      ),
      { width: 80, height: 24 },
    )
    try {
      await setup.renderOnce()
      const earlySpans = setup.captureSpans().lines.flatMap((line) => line.spans)
      const titleEarly = earlySpans.find((span) => span.text.includes("Fading"))
      const bodyEarly = earlySpans.find((span) => span.text.includes("Body text"))
      expect(titleEarly).toBeDefined()
      expect(bodyEarly).toBeDefined()

      const surface = theme.background.surface.toInts()
      const base = theme.text.base.toInts()
      const between = (value: number, a: number, b: number) =>
        value >= Math.min(a, b) && value <= Math.max(a, b)

      // Mid-fade: both the shell title and the body child are tinted together,
      // neither already at the final token (one tint per frame, no per-row loop).
      expect(titleEarly!.fg.toInts()).not.toEqual(base)
      expect(bodyEarly!.fg.toInts()).not.toEqual(base)
      for (const [index, value] of titleEarly!.fg.toInts().slice(0, 3).entries()) {
        expect(between(value, surface[index]!, base[index]!)).toBe(true)
      }
      expect(bodyEarly!.fg.toInts()).toEqual(titleEarly!.fg.toInts())

      await Bun.sleep(240)
      await setup.flush()
      const settled = setup.captureSpans().lines.flatMap((line) => line.spans)
      expect(settled.find((span) => span.text.includes("Fading"))!.fg.toInts()).toEqual(base)
    } finally {
      await setup.dispose()
    }
  })

  test("degraded tiers land on the final color immediately (no fade frames)", async () => {
    const setup = await testRender(
      () => (
        <PanelKitContext.Provider value={{ theme: () => theme, motion: jumpMotion }}>
          <Panel title="Jump" height={8}>
            <ThemedProbe />
          </Panel>
        </PanelKitContext.Provider>
      ),
      { width: 80, height: 24 },
    )
    try {
      await setup.renderOnce()
      const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
      expect(spans.find((span) => span.text.includes("Jump"))!.fg.toInts()).toEqual(
        theme.text.base.toInts(),
      )
      expect(spans.find((span) => span.text.includes("Body text"))!.fg.toInts()).toEqual(
        theme.text.base.toInts(),
      )
    } finally {
      await setup.dispose()
    }
  })

  test("exit fades back toward the surface before unmounting", async () => {
    let closed = 0
    const setup = await testRender(
      () => tree({ title: "Exiting", height: 8, onClose: () => closed++ }, fullMotion),
      { width: 80, height: 24 },
    )
    try {
      await setup.renderOnce()
      // Poll instead of sleeping a fixed 240/60ms: the shared animation clock
      // advances by wall clock, so a loaded CI runner can miss the sampling
      // window and report a false regression (observed on macos-latest).
      const settled = await waitForTitle(setup, (fg) => fg.toInts().every((v, i) => v === theme.text.base.toInts()[i]))
      expect(settled, "enter fade settles back to the base title colour").toBe(true)
      expect(closed).toBe(0)
      setup.mockInput.pressEscape()
      const tinted = await waitForTitle(setup, (fg) => fg.toInts().some((v, i) => v !== theme.text.base.toInts()[i]))
      expect(tinted, "title is tinted away from the base colour while exiting").toBe(true)
      expect(closed).toBe(0) // still fading out
      expect(await waitForClosed(() => closed, 1)).toBe(1)
    } finally {
      await setup.dispose()
    }
  })

  test("second Esc during the fade-out closes without replay", async () => {
    let closed = 0
    const setup = await testRender(
      () => tree({ title: "Exiting", height: 8, onClose: () => closed++ }, fullMotion),
      { width: 80, height: 24 },
    )
    try {
      await setup.renderOnce()
      await waitForTitle(setup, (fg) => fg.toInts().every((v, i) => v === theme.text.base.toInts()[i]))
      setup.mockInput.pressEscape()
      await setup.flush()
      expect(closed).toBe(0) // exit is still playing
      setup.mockInput.pressEscape()
      expect(await waitForClosed(() => closed, 1)).toBe(1)
    } finally {
      await setup.dispose()
    }
  })
})
