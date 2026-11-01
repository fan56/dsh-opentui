/**
 * FT layer (verify/README layer 2) — runs now, blocked on one engine rule.
 * Harness fixed this round: tsconfig include now covers test/ (the file
 * was silently REACT-compiled before — the original mystery), and the
 * frame capture uses setup.captureCharFrame(). Three tests execute and
 * two fail on a genuine reconciler rule: text-node renderables may not
 * sit directly under a box in this path (isTextNodeRenderable parent
 * check throws). Needs reconciler source reading — assertions are
 * correct, keep them.
 */
/**
 * FT layer: headless-rendered FRAME assertions (verify/README layer 2).
 * Locks the regressions the user caught by hand:
 *  - single-row mode renders exactly ONE row (no header row overflow)
 *  - expanded mode renders the bordered frame with header
 *  - fade=1 renders nothing */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { WidgetFrame } from "../src/widget-frame.tsx"

const frameText = async (node: () => any): Promise<string[]> => {
  const setup = await testRender(node, { width: 60, height: 12, kittyKeyboard: true, exitOnCtrlC: false })
  const grid: string[][] = setup.captureCharFrame()
  const text = grid.map((r: any) => r.map((c: any) => c.char ?? " ").join(""))
  await setup.dispose()
  return text
}

describe("WidgetFrame frames", () => {
  test("size 1 = exactly one painted row, no border", async () => {
    const lines = await frameText(() => (
      <box style={{ flexDirection: "column", width: 60, height: 12 }}>
      <WidgetFrame size={1} accent="#4d6bfe" hint="ctrl+t">
        <text style={{ fg: "#888", wrapMode: "none", truncate: true }}>💭 3s thinking tail text</text>
      </WidgetFrame>
      </box>
    ))
    const painted = lines.filter((l) => l.trim().length > 0)
    expect(painted.length).toBe(1)
    expect(painted[0]!).toContain("💭 3s")
    expect(painted[0]!).not.toContain("╭")
  })

  test("size 7 = bordered frame with header + content", async () => {
    const lines = await frameText(() => (
      <WidgetFrame size={7} accent="#4d6bfe" title="💭 thinking">
        <text style={{ fg: "#888" }}>tail line</text>
      </WidgetFrame>
    ))
    const all = lines.join("\n")
    expect(all).toContain("╭")
    expect(all).toContain("💭 thinking")
    expect(all).toContain("tail line")
  })

  test("fade=1 renders nothing", async () => {
    const lines = await frameText(() => (
      <WidgetFrame size={7} accent="#4d6bfe" fade={1} title="gone">
        <text>x</text>
      </WidgetFrame>
    ))
    expect(lines.filter((l) => l.trim().length > 0).length).toBe(0)
  })
})
