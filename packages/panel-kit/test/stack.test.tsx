/**
 * stack.test.tsx — T17-INT2 stack host contracts.
 *
 * Pins z-order/depth, active-only modal tables (Esc inner-first), handle
 * depth/top, and focus save/restore. Also smoke-tests the demo page so the
 * showcase cannot drift from the kit API.
 *
 * Motion is STATIC_MOTION (jump) so open/close settle synchronously.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { BoxRenderable, Renderable } from "@opentui/core"
import type { JSX } from "solid-js"
import type { PanelKeyAdapter, PanelKeyCommands, PanelStackApi } from "../src/contracts"
import { FALLBACK_THEME } from "../src/fallback"
import { PanelKitProvider } from "../src/kit"
import { PanelStack, usePanels } from "../src/stack"
import { STATIC_MOTION } from "../src/theme"
import { Demo } from "../examples/panel-demo"

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

function zIndexes(node: Renderable, out: number[] = []): number[] {
  out.push(node.zIndex)
  for (const child of node.getChildren()) zIndexes(child, out)
  return out
}

async function mount(keys?: PanelKeyAdapter, setup?: (api: PanelStackApi) => void) {
  let base: BoxRenderable | undefined
  const renderer = await testRender(
    () => (
      <PanelKitProvider theme={FALLBACK_THEME} motion={STATIC_MOTION} keys={keys}>
        <box flexDirection="column">
          <box ref={(element) => (base = element)} focusable width={12} height={1}>
            <text>base focus</text>
          </box>
          <PanelStack>{setup ? <Harness setup={setup} /> : undefined}</PanelStack>
        </box>
      </PanelKitProvider>
    ),
    { width: 80, height: 24 },
  )
  return { renderer, base }
}

describe("PanelStack (T17-INT2)", () => {
  test("layers stack with depth/active: zIndex 3000+n, both mounted", async () => {
    let panels!: PanelStackApi
    const keys = fakeKeys()
    const { renderer } = await mount(keys.adapter, (api) => (panels = api))
    try {
      panels.open(() => <text>lower body</text>, { title: "Lower", height: 6 })
      panels.open(() => <text>top body</text>, { title: "Top", height: 6 })
      await renderer.renderOnce()

      // The top layer covers the lower one (same centered geometry); both are
      // mounted, proven by their zIndex slots and the stack depth.
      const frame = renderer.captureCharFrame()
      expect(frame).toContain("Top")
      const levels = zIndexes(renderer.renderer.root)
      expect(levels).toContain(3000)
      expect(levels).toContain(3001)
      expect(panels.depth).toBe(2)
      expect(panels.top?.id).toBe("panel-2")
    } finally {
      await renderer.dispose()
    }
  })

  test("Esc is inner-first: top table closes, then the lower layer re-registers", async () => {
    let panels!: PanelStackApi
    const keys = fakeKeys()
    const { renderer } = await mount(keys.adapter, (api) => (panels = api))
    try {
      panels.open(() => <text>lower body</text>, { title: "Lower", height: 6 })
      panels.open(() => <text>top body</text>, { title: "Top", height: 6 })
      await renderer.renderOnce()

      keys.state.table?.escape?.()
      await renderer.renderOnce()
      let frame = renderer.captureCharFrame()
      expect(frame).not.toContain("Top")
      expect(frame).toContain("Lower")
      expect(panels.depth).toBe(1)

      keys.state.table?.escape?.()
      await renderer.renderOnce()
      frame = renderer.captureCharFrame()
      expect(frame).not.toContain("Lower")
      expect(panels.depth).toBe(0)
    } finally {
      await renderer.dispose()
    }
  })

  test("handles expose id/depth and closeNow unmounts immediately", async () => {
    let panels!: PanelStackApi
    let closed = 0
    const keys = fakeKeys()
    const { renderer } = await mount(keys.adapter, (api) => (panels = api))
    try {
      const first = panels.open(() => <text>one</text>, { title: "One", height: 5, onClose: () => (closed += 1) })
      const second = panels.open(() => <text>two</text>, { title: "Two", height: 5 })
      await renderer.renderOnce()
      expect(first.depth).toBe(0)
      expect(second.depth).toBe(1)
      expect(panels.top?.id).toBe(second.id)

      second.closeNow()
      await renderer.renderOnce()
      expect(renderer.captureCharFrame()).not.toContain("Two")
      expect(first.depth).toBe(0)

      first.closeNow()
      await renderer.renderOnce()
      expect(closed).toBe(1)
      expect(panels.depth).toBe(0)
    } finally {
      await renderer.dispose()
    }
  })

  test("confirm() opens a layer, Esc cancels it and resolves false", async () => {
    let panels!: PanelStackApi
    const keys = fakeKeys()
    const { renderer } = await mount(keys.adapter, (api) => (panels = api))
    try {
      const answer = panels.confirm({
        title: "Delete?",
        message: "This cannot be undone.",
        destructive: true,
        tone: "danger",
      })
      await renderer.renderOnce()
      expect(renderer.captureCharFrame()).toContain("This cannot be undone.")

      keys.state.table?.escape?.()
      await renderer.renderOnce()
      expect(await answer).toBe(false)
      expect(panels.depth).toBe(0)
    } finally {
      await renderer.dispose()
    }
  })

  test("focus is saved on open and restored after closeAll", async () => {
    let panels!: PanelStackApi
    const keys = fakeKeys()
    const { renderer, base } = await mount(keys.adapter, (api) => (panels = api))
    try {
      base!.focus()
      expect(renderer.renderer.currentFocusedRenderable).toBe(base!)

      panels.open(() => <text>modal</text>, { title: "Modal", height: 5 })
      await renderer.renderOnce()
      expect(renderer.renderer.currentFocusedRenderable).not.toBe(base!)

      panels.closeAll()
      await renderer.renderOnce()
      await Bun.sleep(0) // focus restore is a microtask
      await renderer.renderOnce()
      expect(renderer.renderer.currentFocusedRenderable).toBe(base!)
    } finally {
      await renderer.dispose()
    }
  })

  test("demo page mounts and auto-opens a scene (80x24 smoke)", async () => {
    const setup = await testRender(() => <Demo motion={STATIC_MOTION} initialScene="zoo" />, {
      width: 80,
      height: 24,
    })
    try {
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("panel-kit demo")
      expect(frame).toContain("Widget zoo")
      expect(frame).toContain("Decorations")
      expect(frame).toContain("Apply")
    } finally {
      await setup.dispose()
    }
  })

  test("demo fade and stack scenes open without errors", async () => {
    for (const [scene, needle] of [
      ["fade", "Fade · panel"],
      ["stack", "Settings (stub)"],
    ] as const) {
      const setup = await testRender(() => <Demo motion={STATIC_MOTION} initialScene={scene} />, {
        width: 80,
        height: 24,
      })
      try {
        await setup.renderOnce()
        expect(setup.captureCharFrame()).toContain(needle)
      } finally {
        await setup.dispose()
      }
    }
  })

  test("PanelKitProvider keymap bridge: layer enabled only while a table is active, false passes through", async () => {
    let panels!: PanelStackApi
    let layer: (() => import("../src/kit").PanelKeymapLayer) | undefined
    let pushes = 0
    let pops = 0
    const keymap: import("../src/kit").PanelKeymapHost = {
      mode: {
        push() {
          pushes += 1
          return () => {
            pops += 1
          }
        },
      },
      createLayer(input) {
        layer = input
        return undefined
      },
    }

    const setup = await testRender(
      () => (
        <PanelKitProvider theme={FALLBACK_THEME} motion={STATIC_MOTION} keymap={keymap}>
          <PanelStack>
            <Harness setup={(api) => (panels = api)} />
          </PanelStack>
        </PanelKitProvider>
      ),
      { width: 80, height: 24 },
    )
    try {
      await setup.renderOnce()
      expect(pushes).toBe(1)
      expect(layer?.().enabled).toBe(false)

      panels.open(() => <text>body</text>, { title: "Bridge", height: 5 })
      await setup.renderOnce()
      expect(layer?.().enabled).toBe(true)
      const escape = layer!().bindings.find((binding) => binding.key === "escape")!
      expect(escape.cmd()).toBe(true)

      await setup.renderOnce()
      expect(panels.depth).toBe(0)
      expect(layer?.().enabled).toBe(false)
      expect(escape.cmd()).toBe(false)
    } finally {
      await setup.dispose()
      expect(pops).toBe(1)
    }
  })
})
