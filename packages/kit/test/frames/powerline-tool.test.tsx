/** FT: the powerline tool segment paints 🛠 N on the tools fill, and is
 * omitted while no tool has run. */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { PowerlineFooter, POWERLINE_COLORS, toolSegment, type PowerlineSegment } from "../../src/powerline.tsx"
import { defaultTheme } from "../../src/theme.ts"

test("toolSegment: 🛠 N on the tools fill; null until a tool has run", () => {
  expect(toolSegment(3)).toEqual({ text: "🛠 3", bg: POWERLINE_COLORS.tools })
  expect(toolSegment(1)).toEqual({ text: "🛠 1", bg: POWERLINE_COLORS.tools })
  expect(toolSegment(0)).toBeNull()
  expect(toolSegment(-1)).toBeNull()
  expect(toolSegment(Number.NaN)).toBeNull()
})

const render = async (node: () => any) => {
  const setup = await testRender(node, { width: 60, height: 4, kittyKeyboard: true, exitOnCtrlC: false })
  await new Promise((r) => setTimeout(r, 100))
  const frame: string = setup.captureCharFrame()
  await setup.dispose()
  return frame.split("\n")
}
const painted = (lines: string[]) => lines.filter((l) => l.trim().length > 0)

test("footer frame renders the 🛠 tool segment in the chain", async () => {
  const segs: PowerlineSegment[] = [{ text: "dsh", bg: POWERLINE_COLORS.brand }]
  const tools = toolSegment(2)
  if (tools) segs.push(tools)
  const lines = await render(() => (
    <box style={{ flexDirection: "column", width: 60, height: 4 }}>
      {/* right clock passed like the live host always does (an omitted
          right trips a known testRender falsy-Show strictness) */}
      <PowerlineFooter left={segs} right="00:00:00" theme={defaultTheme} />
    </box>
  ))
  expect(painted(lines).length).toBe(1)
  expect(painted(lines)[0]!).toContain("dsh")
  expect(painted(lines)[0]!).toContain("🛠 2")
  expect(painted(lines)[0]!).toContain("00:00:00")
})
