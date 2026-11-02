/** FT: the busy-state line paints spinner + phase verb + elapsed, hides idle. */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { StatusBar } from "../../src/status-bar.tsx"
import { defaultTheme } from "../../src/theme.ts"

test("StatusBar: busy paints spinner+verb+seconds; idle paints nothing", async () => {
  const setup = await testRender(
    () => (
      <box style={{ flexDirection: "column", width: 50, height: 4 }}>
        <StatusBar theme={defaultTheme} phase="think" elapsed={() => 7} />
      </box>
    ),
    { width: 50, height: 8, kittyKeyboard: true, exitOnCtrlC: false },
  )
  await new Promise((r) => setTimeout(r, 150))
  const busy: string = setup.captureCharFrame()
  await setup.dispose()
  expect(busy).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)
  expect(busy).toMatch(/(思考|钻研|推演|构思|酝酿|琢磨)中/)
  expect(busy).toContain("7s")

  const setup2 = await testRender(
    () => (
      <box style={{ flexDirection: "column", width: 50, height: 4 }}>
        <StatusBar theme={defaultTheme} phase={null} elapsed={() => 7} />
      </box>
    ),
    { width: 50, height: 8, kittyKeyboard: true, exitOnCtrlC: false },
  )
  await new Promise((r) => setTimeout(r, 150))
  const idle: string = setup2.captureCharFrame()
  await setup2.dispose()
  expect(idle.split("\n").filter((l) => l.trim().length > 0).length).toBe(0)
})
