import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { WidgetFrame } from "../../src/widget-frame.tsx"

const render = async (node: () => any) => {
  const setup = await testRender(node, { width: 60, height: 12, kittyKeyboard: true, exitOnCtrlC: false })
  await new Promise((r) => setTimeout(r, 100))
  const frame: string = setup.captureCharFrame()
  await setup.dispose()
  return frame.split("\n")
}
const painted = (lines: string[]) => lines.filter((l) => l.trim().length > 0)

test("single-row", async () => {
  const one = await render(() => (
    <box style={{ flexDirection: "column", width: 60, height: 12 }}>
      <WidgetFrame size={1} accent="#4d6bfe" hint="ctrl+t">
        <text style={{ fg: "#888888", wrapMode: "none", truncate: true }}>💭 3s thinking tail text</text>
      </WidgetFrame>
    </box>
  ))
  expect(painted(one).length).toBe(1)
  expect(painted(one)[0]!).toContain("💭 3s")
  expect(painted(one)[0]!).not.toContain("╭")
})
