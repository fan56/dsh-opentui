/**
 * FT: paste works on EVERY text-entry surface. A bracketed paste (what
 * Ghostty Cmd+V / tmux paste-buffer -p send, because OpenTUI enables
 * mode 2004) arrives as a paste EVENT — never a keypress — so the custom
 * key-capture fields (login key entry, custom-provider fields) silently
 * dropped it. Drives the REAL ShellHost headlessly with the real stdin
 * parser semantics via mockInput.pasteBracketedText (ESC[200~…201~ wrapped)
 * and typeText (single-char keypress bursts):
 *
 *   1. main input line: bracketed paste + typed burst both land
 *   2. /login key field: bracketed paste lands, masked display intact
 *      (asterisks, no token echo), esc aborts before any commit
 *   3. custom provider flow: baseUrl field takes a bracketed paste
 *   4. no paste wrappers (`200~`/`201~`) leak into any buffer
 *
 * WHY A SCRIPT (not bun test): same as ft-last-prompt.tsx — bun test does
 * not apply the @opentui/solid preload, so multi-child boxes throw
 * "Orphan text error". `bun scripts/ft-paste.tsx` applies the preload.
 *
 * Usage: bun scripts/ft-paste.tsx   (exit 0 = all assertions pass)
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
/** Poll the char frame until it contains `needle` (render/async settle). */
const waitFrame = async (needle: string, tries = 20): Promise<string> => {
  let frame = ui.captureCharFrame()
  for (let i = 0; i < tries && !frame.includes(needle); i++) {
    await new Promise((r) => setTimeout(r, 100))
    frame = ui.captureCharFrame()
  }
  return frame
}

const TOKEN = "sk-test-token-0123456789abcdef"

const session = makeFakePromptSession()
// spy: the empty-commit guard must keep a retry Enter from firing a
// credentials write with an empty value (the host rejects it — "invalid
// payload for credentials.set" — after the route was already registered)
let loginCalls = 0
const loginSpy = new Proxy(session, {
  get(target, prop, recv) {
    if (prop === "login") return async () => { loginCalls++ }
    return Reflect.get(target, prop, recv)
  },
})
const ui = await testRender(
  () => <ShellHost deps={{ store: new SurfaceStore() as any, t: ((k: string) => k) as any, session: loginSpy }} />,
  { width: 110, height: 40, kittyKeyboard: true, exitOnCtrlC: false },
)
await settle()

try {
  // ---- 1. main input line ----
  await ui.mockInput.pasteBracketedText(TOKEN)
  await settle()
  let frame = ui.captureCharFrame()
  check(frame.includes(TOKEN), "main input: bracketed paste lands", JSON.stringify(frame.slice(-600)))
  check(!frame.includes("200~") && !frame.includes("201~"), "main input: no paste wrappers leak")
  await ui.mockInput.pressBackspace()
  for (let i = 0; i < TOKEN.length; i++) await ui.mockInput.pressBackspace()
  await settle()
  // typed burst: one typeText call sends the whole string as fast keys
  await ui.mockInput.typeText(TOKEN)
  await settle()
  frame = ui.captureCharFrame()
  check(frame.includes(TOKEN), "main input: typed burst lands fully", JSON.stringify(frame.slice(-600)))
  for (let i = 0; i < TOKEN.length + 2; i++) await ui.mockInput.pressBackspace()
  await settle()

  // ---- 2. /login key field (masked custom capture) ----
  await ui.mockInput.typeText("/login")
  ui.mockInput.pressEnter()
  frame = await waitFrame("Amazon Bedrock") // provider menu open
  check(frame.includes("Amazon Bedrock"), "/login: provider menu open", JSON.stringify(frame.slice(-600)))
  // first item is Amazon Bedrock — pick it (enter)
  ui.mockInput.pressEnter()
  frame = await waitFrame("API key for Amazon Bedrock")
  check(frame.includes("API key for Amazon Bedrock"), "/login: key entry stage open", JSON.stringify(frame.slice(-600)))
  await ui.mockInput.pasteBracketedText(TOKEN)
  await settle()
  frame = ui.captureCharFrame()
  const masked = "*".repeat(TOKEN.length)
  check(frame.includes(masked), "/login key field: bracketed paste lands (masked display intact)", JSON.stringify(frame.slice(-600)))
  check(!frame.includes(TOKEN), "/login key field: token never echoed in clear")
  check(!frame.includes("200~"), "/login key field: no paste wrappers leak")
  ui.mockInput.pressEscape() // abort BEFORE commit — no credential write
  await settle()
  frame = ui.captureCharFrame()
  check(!frame.includes(masked), "/login key field: esc aborts without committing")

  // ---- 3. custom provider flow (baseUrl field, unmasked) ----
  await ui.mockInput.typeText("/login")
  ui.mockInput.pressEnter()
  frame = await waitFrame("Amazon Bedrock") // provider menu open
  // arrow to the LAST item: Custom provider (36 catalog entries + custom)
  for (let i = 0; i < 36; i++) ui.mockInput.pressArrow("down")
  await settle()
  ui.mockInput.pressEnter()
  frame = await waitFrame("custom provider baseUrl")
  check(frame.includes("custom provider baseUrl"), "custom flow: baseUrl stage open", JSON.stringify(frame.slice(-600)))
  await ui.mockInput.pasteBracketedText("http://localhost:9199/v1")
  await settle()
  frame = ui.captureCharFrame()
  check(frame.includes("custom provider baseUrl") && frame.includes("http://localhost:9199/v1"), "custom flow: baseUrl bracketed paste lands", JSON.stringify(frame.slice(-600)))
  ui.mockInput.pressEscape()
  await settle()
  ui.mockInput.pressEscape()
  await settle()

  // ---- 5. regression: empty-commit guard on the key entry stage ----
  // A re-sent Enter (dropped-keypress retry) used to COMMIT the empty
  // buffer: credentials.set fired with "" (host rejects: "invalid payload
  // for credentials.set") after the route was already registered, and the
  // panel closed — the stage became unreachable without any user input.
  await ui.mockInput.typeText("/login")
  ui.mockInput.pressEnter()
  frame = await waitFrame("Amazon Bedrock")
  ui.mockInput.pressEnter() // pick Amazon Bedrock → key entry
  frame = await waitFrame("API key for Amazon Bedrock")
  check(frame.includes("API key for Amazon Bedrock"), "guard: key entry stage open", JSON.stringify(frame.slice(-600)))
  for (let i = 0; i < 3; i++) { ui.mockInput.pressEnter(); await settle() }
  frame = ui.captureCharFrame()
  check(frame.includes("API key for Amazon Bedrock"), "guard: empty Enter keeps the stage open (no commit)", JSON.stringify(frame.slice(-600)))
  check(loginCalls === 0, "guard: no credentials write attempted on empty buffer", `login calls: ${loginCalls}`)
  ui.mockInput.pressEscape() // esc is still the cancel path
  await settle()
  frame = ui.captureCharFrame()
  check(!frame.includes("API key for Amazon Bedrock"), "guard: esc still cancels the entry stage")
} finally {
  await ui.dispose()
}

console.log(failures === 0 ? "\nFT paste: PASS" : `\nFT paste: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
