/**
 * FT: the ` ● ` last-input echo is SESSION-persistent (tui-pi semantics).
 * Renders the REAL ShellHost against a controllable fake session and
 * drives the real input path (typed keys → submitLine → send/runCommand):
 *
 *   1. persistence — the echo survives a turn END (set on send, nothing
 *      in the turn finally clears it), and keeps following new sends
 *   2. /new clears it (session change is the only reset)
 *   3. a slash command still never sets it
 *
 * WHY A SCRIPT (not bun test): `bun test` does not apply this package's
 * bunfig preload (`@opentui/solid/preload`), so TSX compiles through bun's
 * default JSX transform with solid-js resolving to the SSR server build —
 * that combination throws "Orphan text error" on any box with multiple
 * expression children, which ShellHost's layout is full of (verified
 * 2026-11-04; kit's single-child frame tests still pass under bun test).
 * `bun run` DOES apply the preload (same path `bun src/client-entry.tsx`
 * uses), so the full host mounts headlessly here.
 *
 * Usage: bun scripts/ft-last-prompt.tsx   (exit 0 = all assertions pass)
 */
import { testRender } from "@opentui/solid"
import { SurfaceStore } from "@dsh-opentui/runtime"
import { ShellHost } from "../src/ShellHost.tsx"
import { makeFakePromptSession } from "../test/last-prompt-persist.test-helpers.ts"

let failures = 0
const check = (ok: boolean, label: string, detail?: string) => {
  console.log(`${ok ? "ok" : "FAIL"}  ${label}${ok || detail === undefined ? "" : ` — ${detail}`}`)
  if (!ok) failures++
}

const settle = () => new Promise((r) => setTimeout(r, 150))

const session = makeFakePromptSession()
const ui = await testRender(
  () => <ShellHost deps={{ store: new SurfaceStore() as any, t: ((k: string) => k) as any, session }} />,
  { width: 110, height: 40, kittyKeyboard: true, exitOnCtrlC: false },
)
await settle()

try {
  // ---- 1. persistence across the turn boundary ----
  await ui.mockInput.typeText("first question")
  ui.mockInput.pressEnter()
  await settle()
  check(session.turnCount() === 1, "send drives exactly one turn", `turns=${session.turnCount()}`)
  check(ui.captureCharFrame().includes("● first question"), "echo shows mid-turn")

  session.resolveTurn() // turn END — the old code cleared the echo here
  await settle()
  check(ui.captureCharFrame().includes("● first question"), "echo PERSISTS after the turn ends")

  // a second send updates the echo and it persists past that turn too
  await ui.mockInput.typeText("second question")
  ui.mockInput.pressEnter()
  await settle()
  check(session.turnCount() === 2, "second send runs a second turn", `turns=${session.turnCount()}`)
  check(ui.captureCharFrame().includes("● second question"), "echo follows the newest prompt")
  session.resolveTurn()
  await settle()
  check(ui.captureCharFrame().includes("● second question"), "echo PERSISTS past the second turn")

  // ---- 2. /new clears it (session change) ----
  await ui.mockInput.typeText("/new")
  ui.mockInput.pressEnter()
  await settle()
  check(!ui.captureCharFrame().includes("● second question"), "/new clears the echo")

  // ---- 3. slash commands never set it ----
  await ui.mockInput.typeText("/help")
  ui.mockInput.pressEnter()
  await settle()
  const helpFrame = ui.captureCharFrame()
  check(!helpFrame.includes("● /help"), "slash command does not set the echo")
  check(!helpFrame.includes("● "), "no echo row after commands only")
} finally {
  await ui.dispose()
}

console.log(failures === 0 ? "\nFT last-prompt-persist: PASS" : `\nFT last-prompt-persist: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
