/** FT: LastPromptLine — the ` ● ` last-request echo below the input box.
 * One dim row for the latest model prompt (first line only for
 * multi-line drafts), zero rows when blank, and a long prompt clips to
 * the row (wrapMode none + truncate) instead of wrapping. */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { LastPromptLine } from "../../src/last-prompt.tsx"
import { defaultTheme } from "../../src/theme.ts"

const render = async (node: () => any) => {
  const setup = await testRender(node, { width: 40, height: 6, kittyKeyboard: true, exitOnCtrlC: false })
  await new Promise((r) => setTimeout(r, 100))
  const frame: string = setup.captureCharFrame()
  await setup.dispose()
  return frame.split("\n")
}
const painted = (lines: string[]) => lines.filter((l) => l.trim().length > 0)

test("last-prompt: one `● ` row with the prompt text", async () => {
  const lines = await render(() => (
    <box style={{ flexDirection: "column", width: 40, height: 6 }}>
      <LastPromptLine text="count from 1 to 20" theme={defaultTheme} />
    </box>
  ))
  expect(painted(lines).length).toBe(1)
  expect(painted(lines)[0]!).toContain("● count from 1 to 20")
})

test("last-prompt: multi-line prompt echoes the FIRST line only", async () => {
  const lines = await render(() => (
    <box style={{ flexDirection: "column", width: 40, height: 6 }}>
      <LastPromptLine text={"first line\ndraft tail that must not render"} theme={defaultTheme} />
    </box>
  ))
  expect(painted(lines).length).toBe(1)
  expect(painted(lines)[0]!).toContain("first line")
  expect(painted(lines)[0]!).not.toContain("draft tail")
})

test("last-prompt: blank text renders zero rows", async () => {
  const lines = await render(() => (
    <box style={{ flexDirection: "column", width: 40, height: 6 }}>
      <LastPromptLine text="" theme={defaultTheme} />
      <LastPromptLine text="   " theme={defaultTheme} />
    </box>
  ))
  expect(painted(lines).length).toBe(0)
})

test("last-prompt: long prompt truncates to one row (never wraps)", async () => {
  const long = "p".repeat(38)
  const lines = await render(() => (
    <box style={{ flexDirection: "column", width: 40, height: 6 }}>
      <LastPromptLine text={`${long} TAIL-MARKER`} theme={defaultTheme} />
    </box>
  ))
  // one clipped row at the box width: OpenTUI's truncate elides the
  // middle (…) and keeps the head + tail, but the row never wraps
  expect(painted(lines).length).toBe(1)
  expect(painted(lines)[0]!.length).toBeLessThanOrEqual(40)
  expect(painted(lines)[0]!).toContain("●")
  expect(painted(lines)[0]!).toContain("TAIL-MARKER")
  expect(painted(lines)[0]!).not.toContain(long)
})
