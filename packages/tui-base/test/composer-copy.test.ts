import { describe, expect, test } from "bun:test"
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
})
