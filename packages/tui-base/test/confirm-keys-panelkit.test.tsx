/**
 * confirm-keys-panelkit.test.tsx — physical keys through the production host
 * chain: Keymap.Provider → createHostKeyAdapter/createTuiPanelKeymapHost →
 * PanelKitProvider/PanelStack → panels.confirm.
 *
 * Why here: panel-kit has no @opentui/keymap dependency, so only tui-base can
 * mount the real layer chain. This pins the user-facing acceptance for the
 * destructive settings confirm:
 *
 *   - ←/→ move the highlight 取消 ↔ 丢弃 and the frame repaints (SGR bg);
 *   - Tab / Shift+Tab do the same (the kit table does not reserve Tab, so the
 *     dialog's raw renderer listener handles it);
 *   - Enter on 丢弃 resolves true (destructive branch) and closes the layer;
 *   - Esc resolves false and closes the layer (the settings consumer keeps its
 *     drafts: covered by settings-panel-panelkit.test.tsx "dirty Esc asks
 *     first");
 *   - the hint line is painted by the control.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { CapturedFrame, CapturedSpan } from "@opentui/core"
import { FALLBACK_THEME, PanelKitProvider, PanelStack, STATIC_MOTION, createHostKeyAdapter, usePanels, type PanelStackApi } from "@dsh-opentui/panel-kit"
import { Keymap } from "../src/context/keymap"
import { createTuiPanelKeymapHost } from "../src/context/panel-kit-host"

const keymapConfig = {
  keybinds: { get: () => [] },
} as unknown as Parameters<typeof Keymap.Provider>[0]["config"]

function Probe(props: { onPanels: (api: PanelStackApi) => void }) {
  props.onPanels(usePanels())
  return <text>base</text>
}

function Host(props: { onPanels: (api: PanelStackApi) => void }) {
  const keymap = Keymap.use()
  const keys = createHostKeyAdapter(createTuiPanelKeymapHost(keymap))
  return (
    <PanelKitProvider theme={FALLBACK_THEME} motion={STATIC_MOTION} keys={keys}>
      <PanelStack>
        <Probe onPanels={props.onPanels} />
      </PanelStack>
    </PanelKitProvider>
  )
}

/** Flush effects, layout and the deferred stdin parse tick. */
async function settle(setup: Awaited<ReturnType<typeof testRender>>, rounds = 4) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    await setup.renderOnce()
  }
}

/**
 * The label span of the button row that also carries `hint`. Focused buttons
 * merge label+hint into one span (one foreground); unfocused ones stay two
 * spans. Matching (label, hint) in the same row skips the title and hint line.
 */
function buttonSpan(
  frame: CapturedFrame,
  label: string,
  hint: string,
): CapturedSpan | undefined {
  for (const line of frame.lines as { spans: CapturedSpan[] }[]) {
    const texts = line.spans.map((span) => span.text)
    if (!texts.some((text) => text.includes(label))) continue
    if (!texts.some((text) => text.includes(hint))) continue
    return line.spans.find((span) => span.text.includes(label))
  }
  return undefined
}

function isActive(span: CapturedSpan | undefined): boolean {
  if (span === undefined) return false
  const want = FALLBACK_THEME.row.activeBg
  return span.bg.r === want.r && span.bg.g === want.g && span.bg.b === want.b
}

async function mount() {
  let panels!: PanelStackApi
  const setup = await testRender(
    () => (
      <Keymap.Provider config={keymapConfig}>
        <Host onPanels={(api) => (panels = api)} />
      </Keymap.Provider>
    ),
    { width: 80, height: 24 },
  )
  await settle(setup)
  return { setup, panels }
}

function open(panels: PanelStackApi) {
  return panels.confirm({
    title: "丢弃未保存的改动？",
    message: "有 2 项未保存的修改；丢弃后不会写入任何设置。",
    confirmLabel: "丢弃",
    cancelLabel: "取消",
    destructive: true,
    tone: "danger",
  })
}

describe("panel-kit confirm physical keys (Keymap.Provider chain)", () => {
  test("←/→ and Tab/Shift+Tab move the highlight and repaint it", async () => {
    const { setup, panels } = await mount()
    try {
      void open(panels)
      await settle(setup)

      let frame = setup.captureSpans()
      expect(isActive(buttonSpan(frame, "取消", "esc"))).toBe(true)
      expect(isActive(buttonSpan(frame, "丢弃", "enter"))).toBe(false)

      setup.mockInput.pressArrow("right")
      await settle(setup)
      frame = setup.captureSpans()
      expect(isActive(buttonSpan(frame, "丢弃", "enter"))).toBe(true)
      expect(isActive(buttonSpan(frame, "取消", "esc"))).toBe(false)

      setup.mockInput.pressArrow("left")
      await settle(setup)
      frame = setup.captureSpans()
      expect(isActive(buttonSpan(frame, "取消", "esc"))).toBe(true)
      expect(isActive(buttonSpan(frame, "丢弃", "enter"))).toBe(false)

      setup.mockInput.pressTab()
      await settle(setup)
      frame = setup.captureSpans()
      expect(isActive(buttonSpan(frame, "丢弃", "enter"))).toBe(true)
      expect(isActive(buttonSpan(frame, "取消", "esc"))).toBe(false)

      setup.mockInput.pressTab({ shift: true })
      await settle(setup)
      frame = setup.captureSpans()
      expect(isActive(buttonSpan(frame, "取消", "esc"))).toBe(true)
      expect(isActive(buttonSpan(frame, "丢弃", "enter"))).toBe(false)
    } finally {
      await setup.dispose()
    }
  })

  test("Enter on the highlighted 丢弃 resolves true and closes the layer", async () => {
    const { setup, panels } = await mount()
    try {
      const answer = open(panels)
      await settle(setup)

      setup.mockInput.pressArrow("right") // destructive default: 取消 → 丢弃
      await settle(setup)
      setup.mockInput.pressEnter()
      await settle(setup)

      expect(await answer).toBe(true)
      expect(panels.depth).toBe(0)
      expect(setup.captureCharFrame()).not.toContain("丢弃未保存的改动")
    } finally {
      await setup.dispose()
    }
  })

  test("Space activates the highlighted 丢弃 like Enter", async () => {
    const { setup, panels } = await mount()
    try {
      const answer = open(panels)
      await settle(setup)

      setup.mockInput.pressArrow("right")
      await settle(setup)
      setup.mockInput.pressKey(" ")
      await settle(setup)

      expect(await answer).toBe(true)
      expect(panels.depth).toBe(0)
    } finally {
      await setup.dispose()
    }
  })

  test("Esc cancels (false) and closes; the settings consumer keeps its drafts", async () => {
    const { setup, panels } = await mount()
    try {
      const answer = open(panels)
      await settle(setup)

      setup.mockInput.pressEscape()
      await settle(setup)

      expect(await answer).toBe(false)
      expect(panels.depth).toBe(0)
      // Draft retention after this cancel is pinned end-to-end by
      // settings-panel-panelkit.test.tsx: "dirty Esc asks first: cancel keeps
      // drafts + panel, discard closes without writes (P1-3)".
    } finally {
      await setup.dispose()
    }
  })

  test("paints the 取消/丢弃 buttons with four-sided borders and the key hint line", async () => {
    const { setup, panels } = await mount()
    try {
      void open(panels)
      await settle(setup)

      const text = setup.captureCharFrame()
      // Full frames: the focused action is heavy, the unfocused one single.
      // The warning panel's own heavy top border also matches /┏━+┓/, so
      // require BOTH button top edges, separated by the button gap, on the
      // SAME line.
      const lines = text.split("\n")
      const topRow = lines.findIndex((line) => /┏━+┓ +┌─+┐/.test(line))
      expect(topRow).not.toBe(-1) // focused heavy + unfocused single, one row
      // The focused button keeps its heavy side borders on the row below.
      expect(lines[topRow + 1]).toMatch(/┃.*┃/)
      // The activation hint follows focus: 取消 (focused) reads "esc / enter",
      // 丢弃 (unfocused) carries no enter hint.
      expect(text).toMatch(/[┃│] 取消  ?esc \/ enter ?[┃│]/)
      expect(text).toMatch(/[┃│] 丢弃 +[┃│]/)
      expect(text).not.toMatch(/丢弃  ?enter/)
      // The hint's Esc verb follows cancelLabel ("取消" in this fixture).
      expect(text).toContain("←→ 选择 · Enter 确认 · Esc 取消")
    } finally {
      await setup.dispose()
    }
  })
})
