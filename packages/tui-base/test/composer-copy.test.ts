import { describe, expect, test } from "bun:test"
import { registerDefaultKeys, registerEnabledFields } from "@opentui/keymap/addons"
import { createTestKeymap } from "@opentui/keymap/testing"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { copyComposerSelection } from "../src/component/prompt/copy"
import { TuiKeybind } from "../src/config/keybind"

function mockClipboard() {
  const writes: string[] = []
  return {
    writes,
    write(text: string) {
      writes.push(text)
      return Promise.resolve()
    },
  }
}

const src = (relative: string) => readFileSync(join(import.meta.dir, "..", relative), "utf8")

describe("R1 composer copy selection", () => {
  test("E1: copy binding defaults; clear and app.exit unchanged", () => {
    expect(TuiKeybind.defaultValue("input.copy")).toBe("ctrl+c,super+c")
    expect(TuiKeybind.defaultValue("prompt.clear")).toBe("ctrl+c")
    expect(TuiKeybind.defaultValue("app.exit")).toBe("ctrl+c,ctrl+d,<leader>q")
    expect("input.copy" in TuiKeybind.parse({})).toBe(true)
  })

  test("E2: selection → clipboard.write called once with the selected text", () => {
    const clipboard = mockClipboard()
    const source = { hasSelection: () => true, getSelectedText: () => "selected text" }
    expect(copyComposerSelection(source, clipboard)).toBe(true)
    expect(clipboard.writes).toEqual(["selected text"])
  })

  test("E3: no selection → no write; existing clear binding stays wired", () => {
    const clipboard = mockClipboard()
    let selectedTextRead = false
    const source = {
      hasSelection: () => false,
      getSelectedText: () => {
        selectedTextRead = true
        return "never"
      },
    }
    expect(copyComposerSelection(source, clipboard)).toBe(false)
    expect(clipboard.writes).toEqual([])
    expect(selectedTextRead).toBe(false)
    const prompt = src("src/component/prompt/index.tsx")
    expect(prompt).toContain('bindings: ["prompt.clear"]')
    expect(prompt).toContain('store.prompt.text !== ""')
  })

  test("E4: copy layer wins and consumes the key; app interceptor untouched", () => {
    const prompt = src("src/component/prompt/index.tsx")
    expect(prompt).toMatch(/priority: 2,[\s\S]{0,400}?bindings: \["input\.copy"\]/)
    // A plain string binding keeps keymap's default preventDefault=true, which
    // makes a handled copy call preventDefault + stopPropagation.
    expect(typeof TuiKeybind.defaultValue("input.copy")).toBe("string")
    const app = src("src/app.tsx")
    expect(app).toContain("Selection.handleSelectionKey(renderer, toast, event, clipboard, copyOnSelectEnabled())")
    expect(app).toContain("{ priority: 101 }")
  })

  test("E4b (oldfox P2): run() returns the boolean; component does not discard it", () => {
    const prompt = src("src/component/prompt/index.tsx")
    expect(prompt).toContain("run: () => copyComposerSelection(input, clipboard, toast.error)")
  })
})

/** Real keymap engine: the copy layer and the lower-priority clear layer both
 * claim ctrl+c (the literal key here is the first leg of the input.copy /
 * prompt.clear TuiKeybind defaults; E1 pins those defaults). Mirrors
 * component/prompt/index.tsx: priority 2 copy, priority 0 clear. */
function bootRouting(hasSelection: () => boolean) {
  const harness = createTestKeymap({ defaultKeys: false })
  registerDefaultKeys(harness.keymap)
  registerEnabledFields(harness.keymap)
  const target = harness.host.createTarget("textarea")
  harness.host.focus(target)
  const clipboard = mockClipboard()
  const calls = { copyRun: 0, clear: 0 }
  const source = { hasSelection, getSelectedText: () => "selected text" }

  harness.keymap.registerLayer({
    priority: 2,
    target,
    enabled: true,
    commands: [
      {
        name: "input.copy",
        run: () => {
          calls.copyRun++
          return copyComposerSelection(source, clipboard, () => {})
        },
      },
    ],
    bindings: [{ key: "ctrl+c", cmd: "input.copy" }],
  })
  harness.keymap.registerLayer({
    target,
    enabled: true,
    commands: [
      {
        name: "prompt.clear",
        run: () => {
          calls.clear++
          return true
        },
      },
    ],
    bindings: [{ key: "ctrl+c", cmd: "prompt.clear" }],
  })
  return { ...harness, clipboard, calls }
}

describe("R1 copy routing (real keymap engine)", () => {
  test("P2 regression: layer enabled but selection vanished → run() returns false → falls through to prompt.clear", () => {
    const h = bootRouting(() => false)
    h.host.press("c", { ctrl: true })
    expect(h.calls.copyRun).toBe(1)
    expect(h.clipboard.writes).toEqual([])
    expect(h.calls.clear).toBe(1)
  })

  test("selection present → copy consumes ctrl+c; clear not reached", () => {
    const h = bootRouting(() => true)
    h.host.press("c", { ctrl: true })
    expect(h.clipboard.writes).toEqual(["selected text"])
    expect(h.calls.copyRun).toBe(1)
    expect(h.calls.clear).toBe(0)
  })
})

/** R1b: the copy layer's `enabled` is always-on (purely reactive target/focus),
 * the live selection check lives in `run`. These tests pin both halves with the
 * real keymap engine and a MUTABLE selection flag, so a layer that captured a
 * stale boolean at compile time (oldfox P3) cannot pass. */
describe("R1b copy consumes selection (real keymap engine)", () => {
  function bootLiveRouting(initialSelection: boolean) {
    const harness = createTestKeymap({ defaultKeys: false })
    registerDefaultKeys(harness.keymap)
    registerEnabledFields(harness.keymap)
    const target = harness.host.createTarget("textarea")
    harness.host.focus(target)
    const clipboard = mockClipboard()
    const calls = { copyRun: 0, clear: 0 }
    let selected = initialSelection
    const source = {
      hasSelection: () => selected,
      getSelectedText: () => "live selected text",
    }

    // Mirrors the fixed component: priority 2, enabled=true (no hasSelection
    // folded into enabled); run() reads hasSelection live and returns false to
    // fall through when the selection vanished.
    harness.keymap.registerLayer({
      priority: 2,
      target,
      enabled: true,
      commands: [
        {
          name: "input.copy",
          run: () => {
            calls.copyRun++
            return copyComposerSelection(source, clipboard, () => {})
          },
        },
      ],
      bindings: [{ key: "ctrl+c", cmd: "input.copy" }],
    })
    harness.keymap.registerLayer({
      target,
      enabled: true,
      commands: [
        {
          name: "prompt.clear",
          run: () => {
            calls.clear++
            return true
          },
        },
      ],
      bindings: [{ key: "ctrl+c", cmd: "prompt.clear" }],
    })
    return { ...harness, clipboard, calls, clearSelection: () => (selected = false) }
  }

  test("B1: selection present → C-c → write called once, clear NOT called", () => {
    const h = bootLiveRouting(true)
    h.host.press("c", { ctrl: true })
    expect(h.calls.copyRun).toBe(1)
    expect(h.clipboard.writes).toEqual(["live selected text"])
    expect(h.calls.clear).toBe(0)
  })

  test("B2: selection vanishes before dispatch → run() returns false → falls back to clear, no write", () => {
    const h = bootLiveRouting(true)
    // The selection existed when the layer was set up, then disappeared just
    // before the key. A stale-boolean enabled would have gone either way; the
    // live run() must see the current false and fall through.
    h.clearSelection()
    h.host.press("c", { ctrl: true })
    expect(h.calls.copyRun).toBe(1)
    expect(h.clipboard.writes).toEqual([])
    expect(h.calls.clear).toBe(1)
  })

  test("B3 (P3 structural): copy layer enabled does not read hasSelection/cursorVersion", () => {
    const prompt = src("src/component/prompt/index.tsx")
    const layer = prompt.slice(prompt.indexOf('priority: 2'), prompt.indexOf('priority: 2') + 400)
    expect(layer).toContain('enabled: inputTarget() !== undefined && !disabled()')
    expect(layer).not.toMatch(/hasSelection/)
    expect(layer).not.toMatch(/cursorVersion/)
  })

  test("B4 (shipped view): v2 client mounts the copy layer at priority 2 with live hasSelection in run", () => {
    const v2 = src("examples/v2-entry.tsx")
    expect(v2).toContain("copyComposerSelection")
    expect(v2).toContain("hasSelection: () => node?.hasSelection() === true")
    // The v2 copy layer must outrank the page ctrl+c cancel layer (priority 0).
    const idx = v2.indexOf("Copy selected input text")
    expect(idx).toBeGreaterThan(-1)
    expect(v2.slice(idx - 400, idx)).toContain("priority: 2")
  })
})
