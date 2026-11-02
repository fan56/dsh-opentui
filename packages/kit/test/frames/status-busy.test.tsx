/** FT: the busy status bar paints the whale comet + phase icon + verb. */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { StatusBar } from "../../src/status-bar.tsx"
import { defaultTheme } from "../../src/theme.ts"

test("StatusBar busy paints whale comet, track, label icon+verb", async () => {
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
  expect(busy).toContain("🐳")
  expect(busy).toContain("░")
  expect(busy).toContain("🧠")
  expect(busy).toMatch(/(Thinking|Pondering|Reasoning|Reflecting|Deliberating|Mulling)\.\.\./)
  expect(busy).toContain("7s")
})
