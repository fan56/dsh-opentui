/**
 * stack-wide-glyph.test.tsx — regression: a translucent layer over a lower
 * panel must not drop the lower panel's double-width glyphs.
 *
 * Engine defect (opentui 0.8.1, native scene): a box whose backgroundColor has
 * an alpha < 255 is composited as a per-cell background fill that rewrites the
 * cells it covers; the trailing cell of a wide glyph is written as a space, so
 * the terminal (and the painted buffer) loses the whole glyph. ASCII in the
 * same cells survives because one cell == one glyph.
 *
 * The stack used to paint exactly such a scrim for every layer. Opening the
 * /settings 退出设置？ confirm therefore blanked every CJK cell of the settings
 * panel underneath. The fix dims lower layers through their theme projection (a
 * color multiply that preserves graphemes) and paints no scrim above a layer
 * that already has one below it.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { PanelStackApi } from "../src/contracts"
import { FALLBACK_THEME } from "../src/fallback"
import { PanelKitProvider } from "../src/kit"
import { PanelStack, usePanels } from "../src/stack"
import { STATIC_MOTION } from "../src/theme"

function Harness(props: { setup: (api: PanelStackApi) => void }) {
  props.setup(usePanels())
  return <text> </text>
}

async function mount() {
  let panels!: PanelStackApi
  const renderer = await testRender(
    () => (
      <PanelKitProvider theme={FALLBACK_THEME} motion={STATIC_MOTION}>
        <PanelStack>
          <Harness setup={(api) => (panels = api)} />
        </PanelStack>
      </PanelKitProvider>
    ),
    { width: 100, height: 30 },
  )
  return { renderer, panels: () => panels }
}

describe("stack layer wide glyphs", () => {
  test("an open confirm keeps the lower panel's CJK intact", async () => {
    const { renderer, panels } = await mount()
    try {
      panels().open(
        () => (
          <box flexDirection="column">
            <text>{"分节导航 · 即时保存 · Esc 逐层返回"}</text>
            <text>{"通用 12"}</text>
            <text>{"TUI 专有 16"}</text>
          </box>
        ),
        { title: "设置", subtitle: "设置面板副标题", size: "full", rows: 24 },
      )
      await renderer.renderOnce()
      expect(renderer.captureCharFrame()).toContain("通用 12")

      void panels().confirm({ title: "退出设置？", message: "所有改动已即时保存。" })
      await renderer.renderOnce()

      const frame = renderer.captureCharFrame()
      // The confirm is on top...
      expect(frame).toContain("退出设置？")
      // ...and the layer below still renders every wide glyph.
      expect(frame).toContain("设置")
      expect(frame).toContain("通用 12")
      expect(frame).toContain("专有 16")
      expect(frame).toContain("分节导航 · 即时保存 · Esc 逐层返回")

      // The covered layer is still dimmed (a color projection, not an overlay):
      // its title must be darker than the undimmed theme token.
      const title = renderer
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.trim() === "设置")
      expect(title).toBeDefined()
      expect(title!.fg.r).toBeLessThan(FALLBACK_THEME.text.base.r)
    } finally {
      await renderer.dispose()
    }
  })
})
