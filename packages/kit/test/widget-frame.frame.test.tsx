/**
 * FT layer (verify/README layer 2) — STATUS: harness-blocked.
 * The assertions below encode the three user-caught regressions
 * (single-row overflow / bordered expanded / fade unmount), but
 * testRender rejects this tree with "Orphan text error" even with the
 * probe's exact options and root-box shape — the passing probes used
 * InputLine (textarea) roots, so a WidgetFrame(Show-root) tree hits an
 * engine constraint not yet understood. Tracked in verify/README;
 * do NOT delete — make these pass.
 */
 FT layer: headless-rendered FRAME assertions (verify/README layer 2).
 * Locks the regressions the user caught by hand:
 *  - single-row mode renders exactly ONE row (no header row overflow)
 *  - expanded mode renders the bordered frame with header
 *  - fade=1 renders nothing */
import { describe, expect, test } from "bun:test"
/* eslint-disable */
const IT = test.skip
import { testRender } from "@opentui/solid"
import { WidgetFrame } from "../src/widget-frame.tsx"

const frameText = (node: () => any): Promise<string[]> =>
  testRender(node, { width: 60, height: 12, kittyKeyboard: true, exitOnCtrlC: false }).then((setup: any) => {
    const text: string[] = setup.frame.map((r: any) => r.map((c: any) => c.char ?? " ").join(""))
    return setup.dispose().then(() => text)
  })

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
