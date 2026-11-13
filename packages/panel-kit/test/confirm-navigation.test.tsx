/**
 * confirm-navigation.test.tsx — ConfirmDialog keyboard usability.
 *
 * The real-machine report was "取消 / 丢弃 之间没有键盘切换，也看不出哪个被选中"
 * (destructive settings confirm). These tests pin the fixed semantics:
 *
 *   - the model cycles on left/right AND tab/shift+tab, Enter/Space activate
 *     the active action, Esc is always Cancel;
 *   - the painted frame follows the active action (list-row highlight tokens)
 *     and every button keeps a themed side border when unfocused;
 *   - the hint line is part of the control, not the consumer;
 *   - Tab reaches the dialog on the raw renderer path (the panel table does
 *     not reserve it), so a shift+tab/frame assertion exercises the same
 *     listener a host without a tab binding uses.
 *
 * Arrows are driven through the host key table (PanelKeyAdapter.scope), which
 * is the same table the real Keymap bridge fills in tui-base; the physical
 * Keymap.Provider chain is covered by
 * packages/tui-base/test/confirm-keys-panelkit.test.tsx.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { CapturedFrame, CapturedSpan } from "@opentui/core"
import type { JSX } from "solid-js"
import type { PanelKeyAdapter, PanelKeyCommands, PanelStackApi } from "../src/contracts"
import { FALLBACK_THEME } from "../src/fallback"
import { PanelKitProvider } from "../src/kit"
import { PanelStack, usePanels } from "../src/stack"
import { STATIC_MOTION } from "../src/theme"
import { createConfirmModel, type ConfirmAction } from "../src/controls/confirm"

function fakeKeys() {
  const state: { table?: PanelKeyCommands; scopes: PanelKeyCommands[] } = { scopes: [] }
  const adapter: PanelKeyAdapter = {
    scope(commands) {
      state.table = commands
      state.scopes.push(commands)
      return () => {
        const at = state.scopes.lastIndexOf(commands)
        if (at >= 0) state.scopes.splice(at, 1)
        if (state.table === commands) state.table = state.scopes.at(-1)
      }
    },
  }
  return { state, adapter }
}

function Harness(props: { setup: (api: PanelStackApi) => void }): JSX.Element {
  props.setup(usePanels())
  return <text> </text>
}

async function mount() {
  let panels!: PanelStackApi
  const keys = fakeKeys()
  const setup = await testRender(
    () => (
      <PanelKitProvider theme={FALLBACK_THEME} motion={STATIC_MOTION} keys={keys.adapter}>
        <PanelStack>
          <Harness setup={(api) => (panels = api)} />
        </PanelStack>
      </PanelKitProvider>
    ),
    { width: 80, height: 24 },
  )
  return { setup, keys, panels }
}

function frameText(frame: CapturedFrame): string {
  return frame.lines
    .flatMap((line: { spans: CapturedSpan[] }) => line.spans.map((span) => span.text))
    .join("\n")
}

/**
 * The label span of the button row that also carries `hint`. Focused buttons
 * paint label+hint with one foreground, so they merge into a single span;
 * unfocused ones stay two spans. Matching on (label, hint) in the same row
 * avoids the title (contains 丢弃) and the hint line (contains 取消).
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

/** stdin parsing is deferred in the test renderer; pump before asserting. */
async function pressTab(setup: Awaited<ReturnType<typeof testRender>>, shift = false) {
  setup.mockInput.pressTab({ shift })
  await Bun.sleep(60)
  await setup.flush()
}

function openConfirm(panels: PanelStackApi) {
  return panels.confirm({
    title: "丢弃未保存的改动？",
    message: "有 2 项未保存的修改；丢弃后不会写入任何设置。",
    confirmLabel: "丢弃",
    cancelLabel: "取消",
    destructive: true,
    tone: "danger",
  })
}

describe("confirm model keys (pure)", () => {
  function model(destructive = true) {
    const calls: ConfirmAction[] = []
    const created = createConfirmModel({
      title: "t",
      message: "m",
      destructive,
      onConfirm: () => calls.push("confirm"),
      onCancel: () => calls.push("cancel"),
    })
    return { created, calls }
  }

  test("tab and shift+tab cycle like left/right", () => {
    const { created } = model()
    expect(created.active()).toBe("cancel")
    created.command("tab")
    expect(created.active()).toBe("confirm")
    created.command("shift+tab")
    expect(created.active()).toBe("cancel")
    created.command("right")
    expect(created.active()).toBe("confirm")
    created.command("left")
    expect(created.active()).toBe("cancel")
  })

  test("Space activates the active action", () => {
    const { created, calls } = model(false)
    expect(created.active()).toBe("confirm")
    expect(created.command("space")).toBe(true)
    expect(calls).toEqual(["confirm"])
  })

  test("keys are inert once settled", () => {
    const { created, calls } = model()
    created.command("escape")
    expect(calls).toEqual(["cancel"])
    expect(created.command("tab")).toBe(true)
    expect(created.command("enter")).toBe(true)
    expect(calls).toEqual(["cancel"])
  })
})

describe("ConfirmDialog keyboard (panel router + raw Tab)", () => {
  test("left/right move the highlight to 丢弃 and back to 取消", async () => {
    const { setup, keys, panels } = await mount()
    try {
      void openConfirm(panels)
      await setup.renderOnce()

      let frame = setup.captureSpans()
      expect(isActive(buttonSpan(frame, "取消", "esc"))).toBe(true)
      expect(isActive(buttonSpan(frame, "丢弃", "enter"))).toBe(false)

      keys.state.table!.left!()
      await setup.renderOnce()
      frame = setup.captureSpans()
      expect(isActive(buttonSpan(frame, "取消", "esc"))).toBe(false)
      expect(isActive(buttonSpan(frame, "丢弃", "enter"))).toBe(true)

      keys.state.table!.right!()
      await setup.renderOnce()
      frame = setup.captureSpans()
      expect(isActive(buttonSpan(frame, "取消", "esc"))).toBe(true)
      expect(isActive(buttonSpan(frame, "丢弃", "enter"))).toBe(false)
    } finally {
      await setup.dispose()
    }
  })

  test("Tab and Shift+Tab cycle the highlight", async () => {
    const { setup, panels } = await mount()
    try {
      void openConfirm(panels)
      await setup.renderOnce()

      await pressTab(setup)
      let frame = setup.captureSpans()
      expect(isActive(buttonSpan(frame, "丢弃", "enter"))).toBe(true)
      expect(isActive(buttonSpan(frame, "取消", "esc"))).toBe(false)

      await pressTab(setup, true)
      frame = setup.captureSpans()
      expect(isActive(buttonSpan(frame, "取消", "esc"))).toBe(true)
      expect(isActive(buttonSpan(frame, "丢弃", "enter"))).toBe(false)
    } finally {
      await setup.dispose()
    }
  })

  test("Enter on the highlighted 丢弃 resolves the destructive branch and closes", async () => {
    const { setup, keys, panels } = await mount()
    try {
      const answer = openConfirm(panels)
      await setup.renderOnce()

      keys.state.table!.left!() // 取消 → 丢弃
      await setup.renderOnce()
      keys.state.table!.enter!()
      await setup.renderOnce()

      expect(await answer).toBe(true)
      await setup.renderOnce()
      expect(panels.depth).toBe(0)
      expect(setup.captureCharFrame()).not.toContain("丢弃未保存的改动")
    } finally {
      await setup.dispose()
    }
  })

  test("Esc cancels without confirming (draft-retention consumer semantics)", async () => {
    const { setup, keys, panels } = await mount()
    try {
      const answer = openConfirm(panels)
      await setup.renderOnce()

      keys.state.table!.escape!()
      await setup.renderOnce()

      // Cancel is the resolved branch; the consumer keeps its draft and the
      // panel it owns (pinned by the tui-base settings dirty-Esc test).
      expect(await answer).toBe(false)
      expect(panels.depth).toBe(0)
    } finally {
      await setup.dispose()
    }
  })

  test("paints the hint line and a full four-sided border around each button", async () => {
    const { setup, panels } = await mount()
    try {
      void openConfirm(panels)
      await setup.renderOnce()

      const text = frameText(setup.captureSpans())
      // The hint's Esc verb follows cancelLabel ("取消" in this fixture).
      expect(text).toContain("←→ 选择 · Enter 确认 · Esc 取消")

      // Both actions keep a visible four-sided boundary even when unfocused;
      // the focused one uses the heavy border token from the theme, the other
      // the single-line base token. The warning panel's own heavy top border
      // also matches /┏━+┓/, so require BOTH button top edges, separated by
      // the button gap, on the SAME line.
      const raw = setup.captureCharFrame()
      const lines = raw.split("\n")
      const topRow = lines.findIndex((line) => /┏━+┓ +┌─+┐/.test(line))
      expect(topRow).not.toBe(-1) // focused heavy + unfocused single, one row
      // The focused button keeps its heavy side borders on the row below.
      expect(lines[topRow + 1]).toMatch(/┃.*┃/)
      expect(raw).toMatch(/[┃│] 取消  ?esc \/ enter ?[┃│]/)
      expect(raw).toMatch(/[┃│] 丢弃 +[┃│]/)
      expect(raw).not.toMatch(/丢弃  ?enter/)
    } finally {
      await setup.dispose()
    }
  })
})
