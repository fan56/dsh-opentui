/**
 * 0234: the v2 client bundle must mount an app-level keymap layer so the
 * configured leader/chord bindings (leader n/l/g/q/m/x + ctrl+p) have a
 * command to match. Before this layer existed the keys were silent no-ops and
 * their letters fell into the composer as literal text.
 *
 * Two contracts are pinned here:
 *   1. v2-entry actually mounts the layer and routes each key to the right
 *      v2-native face (slash dispatch / palette / history panel);
 *   2. a real key chain through Keymap.Provider enters the leader pending
 *      sequence on ctrl+x and dispatches the expected action on each leg.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender } from "@opentui/solid"
import { TuiKeybind } from "../src/config/keybind"
import { Keymap } from "../src/context/keymap"
import { createAppCommandLayers, type AppCommandLayerDeps } from "../src/routes/session/app-command-layer"

const keybindsConfig = () => ({
  keybinds: createBindingLookup(TuiKeybind.toBindingConfig(TuiKeybind.parse({})), {
    bindingDefaults: TuiKeybind.bindingDefaults(),
  }),
  leader: { timeout: 2000 },
})

describe("v2-entry mounts the app command layer (0234)", () => {
  const source = readFileSync(join(import.meta.dir, "..", "examples", "v2-entry.tsx"), "utf8")

  test("imports and registers createAppCommandLayers under the page provider", () => {
    expect(source).toMatch(/import \{ createAppCommandLayers \} from "\.\.\/src\/routes\/session\/app-command-layer"/)
    expect(source).toMatch(/for \(const layer of createAppCommandLayers\(\{/)
    // The layer must be page-owned so a dialog's ctrl+p stays with the dialog.
    expect(source).toMatch(/enabled: pageOwns,/)
  })

  test("v2-entry wires the injected run bodies to the v2-native faces", () => {
    // v2-entry owns the faces: slash host, dialog stack, history panel.
    expect(source).toMatch(/slash: \(name\) => void slash\.interceptSubmit\(name\)/)
    expect(source).toMatch(/openPalette: \(\) => dialog\.replace/)
    expect(source).toMatch(/openTimeline: \(\) => openHistoryPanel\(\)/)
  })

  test("the layer module registers all seven command IDs and their run bodies", () => {
    const module = readFileSync(
      join(import.meta.dir, "..", "src", "routes", "session", "app-command-layer.ts"),
      "utf8",
    )
    const expected: Array<[id: string, call: string]> = [
      ["command.palette.show", "deps.openPalette()"],
      ["session.new", 'deps.slash("/new")'],
      ["session.list", 'deps.slash("/resume")'],
      ["session.timeline", "deps.openTimeline()"],
      ["session.queued_prompts", 'deps.slash("/flush")'],
      ["model.list", 'deps.slash("/model")'],
      ["session.export", 'deps.slash("/export")'],
    ]
    for (const [id, call] of expected) {
      expect(module).toContain(`id: "${id}"`)
      expect(module).toContain(call)
    }
  })
})

describe("keymap: leader keys dispatch to the right action", () => {
  const press = async (
    setup: Awaited<ReturnType<typeof testRender>>,
    key: string,
    modifiers?: { ctrl?: boolean },
  ) => {
    setup.mockInput.pressKey(key, modifiers)
    await Bun.sleep(30)
    await setup.renderOnce()
  }

  test("ctrl+x enters a pending leader sequence without dispatching an action", async () => {
    const actions: string[] = []
    const deps: AppCommandLayerDeps = {
      slash: (name) => actions.push(name),
      openPalette: () => actions.push("palette"),
      openTimeline: () => actions.push("timeline"),
    }
    let pending: ReturnType<typeof Keymap.usePendingSequence> = () => []
    function Probe() {
      for (const layer of createAppCommandLayers(deps)) Keymap.createLayer(layer)
      pending = Keymap.usePendingSequence()
      return <box width={1} height={1} />
    }
    const setup = await testRender(
      () => (
        <Keymap.Provider config={keybindsConfig()}>
          <Probe />
        </Keymap.Provider>
      ),
      { width: 40, height: 10, useMouse: false },
    )
    try {
      await press(setup, "x", { ctrl: true })
      expect(actions).toEqual([])
      expect(pending().some((item) => item.tokenName === "leader")).toBe(true)
    } finally {
      await setup.dispose()
    }
  })

  const cases: Array<[leg: string, expected: string]> = [
    ["n", "/new"],
    ["l", "/resume"],
    ["g", "timeline"],
    ["q", "/flush"],
    ["m", "/model"],
    ["x", "/export"],
  ]

  for (const [leg, expected] of cases) {
    test(`ctrl+x then ${leg} dispatches ${expected}`, async () => {
      const actions: string[] = []
      const deps: AppCommandLayerDeps = {
        slash: (name) => actions.push(name),
        openPalette: () => actions.push("palette"),
        openTimeline: () => actions.push("timeline"),
      }
      function Probe() {
        for (const layer of createAppCommandLayers(deps)) Keymap.createLayer(layer)
        return <box width={1} height={1} />
      }
      const setup = await testRender(
        () => (
          <Keymap.Provider config={keybindsConfig()}>
            <Probe />
          </Keymap.Provider>
        ),
        { width: 40, height: 10, useMouse: false },
      )
      try {
        await press(setup, "x", { ctrl: true })
        await press(setup, leg)
        expect(actions).toEqual([expected])
      } finally {
        await setup.dispose()
      }
    })
  }

  test("ctrl+p opens the command palette without a leader prefix", async () => {
    const actions: string[] = []
    const deps: AppCommandLayerDeps = {
      slash: (name) => actions.push(name),
      openPalette: () => actions.push("palette"),
      openTimeline: () => actions.push("timeline"),
    }
    function Probe() {
      for (const layer of createAppCommandLayers(deps)) Keymap.createLayer(layer)
      return <box width={1} height={1} />
    }
    const setup = await testRender(
      () => (
        <Keymap.Provider config={keybindsConfig()}>
          <Probe />
        </Keymap.Provider>
      ),
      { width: 40, height: 10, useMouse: false },
    )
    try {
      await press(setup, "p", { ctrl: true })
      expect(actions).toEqual(["palette"])
    } finally {
      await setup.dispose()
    }
  })

  test("the ownership gate disables the layer when the page does not own input", async () => {
    const actions: string[] = []
    const deps: AppCommandLayerDeps = {
      slash: (name) => actions.push(name),
      openPalette: () => actions.push("palette"),
      openTimeline: () => actions.push("timeline"),
      enabled: () => false,
    }
    function Probe() {
      for (const layer of createAppCommandLayers(deps)) Keymap.createLayer(layer)
      return <box width={1} height={1} />
    }
    const setup = await testRender(
      () => (
        <Keymap.Provider config={keybindsConfig()}>
          <Probe />
        </Keymap.Provider>
      ),
      { width: 40, height: 10, useMouse: false },
    )
    try {
      await press(setup, "p", { ctrl: true })
      await press(setup, "x", { ctrl: true })
      await press(setup, "n")
      expect(actions).toEqual([])
    } finally {
      await setup.dispose()
    }
  })
})
