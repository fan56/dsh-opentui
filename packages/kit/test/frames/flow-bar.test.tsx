/** FT: the flow bar paints track+head+tail and the head MOVES between captures. */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { FlowBar } from "../../src/flow-bar.tsx"
import { defaultTheme } from "../../src/theme.ts"

test("FlowBar: comet with gradient tail over a dim track, advancing", async () => {
  const setup = await testRender(
    () => (
      <box style={{ flexDirection: "column", width: 46, height: 3 }}>
        <FlowBar theme={defaultTheme} width={44} />
      </box>
    ),
    { width: 46, height: 6, kittyKeyboard: true, exitOnCtrlC: false },
  )
  await new Promise((r) => setTimeout(r, 100))
  const f1: string = setup.captureCharFrame()
  await new Promise((r) => setTimeout(r, 300))
  const f2: string = setup.captureCharFrame()
  await setup.dispose()
  const posOf = (f: string) => f.split("\n").find((l) => l.includes("█"))?.indexOf("█") ?? -1
  expect(f1).toContain("█")
  expect(f1).toContain("░")
  expect(f1).toMatch(/█▓|▓█/)
  expect(posOf(f1)).not.toBe(posOf(f2))
  expect(posOf(f1)).toBeGreaterThanOrEqual(0)
})
