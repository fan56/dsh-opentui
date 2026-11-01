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

test("expanded-frame", async () => {
  const big = await render(() => (
    <box style={{ flexDirection: "column", width: 60, height: 12 }}>
      <WidgetFrame size={7} accent="#4d6bfe" title="💭 thinking">
        <text style={{ fg: "#888888" }}>tail line</text>
      </WidgetFrame>
    </box>
  ))
  expect(big.join("\n")).toContain("╭")
  expect(big.join("\n")).toContain("💭 thinking")
  expect(big.join("\n")).toContain("tail line")
})
