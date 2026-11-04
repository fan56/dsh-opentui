/** FT: the ask_user_question Q&A transcript block renders as asserted
 * frames — question pops, options dimmed, the user's selection marked,
 * declined rendered honestly. Both Transcript kinds matter: the rich JSX
 * path (following mode) and the scrollback line flattening. */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { TranscriptWindow, type TranscriptItem } from "../../src/shell-parts.tsx"
import { getTheme } from "../../src/theme.ts"

const theme = getTheme("catppuccin-mocha")
const t = (k: string) => (k === "ask.declined" ? "declined" : k)

const render = async (items: TranscriptItem[]) => {
  const setup = await testRender(
    () => (
      <box style={{ flexDirection: "column", width: 60, height: 14 }}>
        <TranscriptWindow items={items} theme={theme} t={t} spinnerFrame="" viewportRows={14} />
      </box>
    ),
    { width: 60, height: 14, kittyKeyboard: true, exitOnCtrlC: false },
  )
  await new Promise((r) => setTimeout(r, 100))
  const frame: string = setup.captureCharFrame()
  await setup.dispose()
  return frame.split("\n")
}

test("ask block: question, options, and the highlighted selection", async () => {
  const lines = await render([
    { kind: "user", text: "pick a stack for me" },
    {
      kind: "ask",
      entries: [
        { question: "Which framework?", options: ["React", "Solid"], selected: ["Solid"], declined: false },
      ],
    },
  ])
  const painted = lines.join("\n")
  expect(painted).toContain("❓ Which framework?")
  expect(painted).toContain("· React")
  expect(painted).toContain("· Solid")
  expect(painted).toContain("⎿ ✓ Solid")
})

test("ask block: the declined path renders as declined", async () => {
  const lines = await render([
    {
      kind: "ask",
      entries: [{ question: "Proceed?", options: ["yes", "no"], selected: [], declined: true }],
    },
  ])
  const painted = lines.join("\n")
  expect(painted).toContain("❓ Proceed?")
  expect(painted).toContain("declined")
  expect(painted).not.toContain("✓")
})

test("ask block: multi-question batch shows every question + its choice", async () => {
  const lines = await render([
    {
      kind: "ask",
      entries: [
        { question: "Which framework?", options: ["React", "Solid"], selected: ["React"], declined: false },
        { question: "Styling: CSS approach?", options: ["Tailwind", "vanilla"], selected: ["vanilla"], declined: false },
      ],
    },
  ])
  const painted = lines.join("\n")
  expect(painted).toContain("❓ Which framework?")
  expect(painted).toContain("⎿ ✓ React")
  expect(painted).toContain("❓ Styling: CSS approach?")
  expect(painted).toContain("⎿ ✓ vanilla")
})

test("ask block: free-text custom answer renders with the selection", async () => {
  const lines = await render([
    {
      kind: "ask",
      entries: [{ question: "Other preference?", options: [], selected: [], custom: "Svelte, actually", declined: false }],
    },
  ])
  const painted = lines.join("\n")
  expect(painted).toContain("⎿ ✓ Svelte, actually")
})
