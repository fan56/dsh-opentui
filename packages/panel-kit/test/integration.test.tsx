/**
 * integration.test.tsx — T17-INT1 integration contracts.
 *
 * Pins the three arbitration points that span lanes:
 *   1. ONE theme injection identity (theme.ts), no Symbol.for registry.
 *   2. ONE modal table per Panel layer; the layer router sees keys before the
 *      panel default (ConfirmDialog Esc must cancel, not close the panel).
 *   3. List controlled query arrives through ListProps (B2).
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createComponent } from "solid-js"
import type { PanelKeyAdapter, PanelKeyCommands, PanelKitContextValue } from "../src/contracts"
import { ConfirmDialog } from "../src/controls/confirm"
import { List } from "../src/controls/list"
import { FALLBACK_THEME } from "../src/fallback"
import { Panel } from "../src/panel"
import { PanelKitContext, STATIC_MOTION, panelKitContext } from "../src/theme"

const kit = (keys?: PanelKeyAdapter): PanelKitContextValue => ({
  theme: () => FALLBACK_THEME,
  motion: STATIC_MOTION,
  keys,
})

describe("integration (T17-INT1)", () => {
  test("one theme injection identity: panelKitContext() is theme.ts's context", () => {
    expect(panelKitContext()).toBe(PanelKitContext)
  })

  test("one modal table per layer; the router consumes Esc before the panel", async () => {
    let closed = 0
    let cancelled = 0
    const registered: PanelKeyCommands[] = []
    const keys: PanelKeyAdapter = {
      scope(commands) {
        registered.push(commands)
        return undefined
      },
    }

    const setup = await testRender(
      () => (
        <PanelKitContext.Provider value={kit(keys)}>
          <Panel title="Confirm" height={10} onClose={() => closed++}>
            {createComponent(ConfirmDialog, {
              title: "Discard",
              message: "Discard the draft?",
              onConfirm: () => {},
              onCancel: () => (cancelled += 1),
            })}
          </Panel>
        </PanelKitContext.Provider>
      ),
      { width: 80, height: 24 },
    )

    try {
      await setup.renderOnce()
      // The Panel registers exactly one table; controls do not scope() again.
      expect(registered).toHaveLength(1)
      const escape = registered[0]?.["escape"]
      expect(typeof escape).toBe("function")
      escape?.()
      await setup.renderOnce()
      expect(cancelled).toBe(1) // ConfirmDialog handled Esc
      expect(closed).toBe(0) // panel default was not reached
    } finally {
      await setup.dispose()
    }
  })

  test("List renders its controlled query and filters items", async () => {
    const setup = await testRender(
      () => (
        <PanelKitContext.Provider value={kit()}>
          <List
            items={[
              { id: "model", label: "Model" },
              { id: "theme", label: "Theme" },
            ]}
            query="mod"
          />
        </PanelKitContext.Provider>
      ),
      { width: 60, height: 8 },
    )

    try {
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("Model")
      expect(frame).not.toContain("Theme")
    } finally {
      await setup.dispose()
    }
  })
})
