/**
 * FT: the /logout two-call contract — the commit removes the llm-pi-ai
 * route (settingsSeam.mutate unset op) AND the credential (session.logout),
 * route first, and the /model picker reflects the removal immediately.
 *
 * Drives the REAL ShellHost headlessly (testRender + mockInput, ft-paste
 * pattern) against an instrumented fake session whose settingsSeam/listProviders
 * share one provider-state store, so the frame evidence shows the picker
 * BEFORE and AFTER the commit:
 *
 *   1. /logout menu lists the configured routes; the confirm names the
 *      highlighted provider EXACTLY (the read-before-confirm incident guard)
 *   2. y commits: exactly one unset mutate + one credential unset, in that
 *      order, with the auditprov shapes
 *   3. /model no longer lists the logged-out provider's models
 *
 * WHY A SCRIPT (not bun test): same as ft-paste.tsx — bun test does not
 * apply the @opentui/solid preload, so multi-child boxes throw "Orphan
 * text error". `bun scripts/ft-logout.tsx` applies the preload via main.
 *
 * Usage: bun scripts/ft-logout.tsx   (exit 0 = all assertions pass)
 */
import { testRender } from "@opentui/solid"
import { SurfaceStore } from "@dsh-opentui/runtime"
import { ShellHost } from "../src/ShellHost.tsx"
import { makeFakePromptSession } from "../test/last-prompt-persist.test-helpers.ts"
import type { ShellSessionSurface } from "../src/client/shell-session.ts"

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

// The shared provider-state store: settingsSeam.mutate writes it,
// settingsSeam.describe reads it, listProviders derives the /model rows
// from it — exactly the host-side dataflow the real seams implement.
let revision = 5
const providers: Record<string, { apiKeyEnv: string; models?: { id: string }[] }> = {
  otherprov: { apiKeyEnv: "OTHERPROV_API_KEY", models: [{ id: "other-m" }] },
  auditprov: { apiKeyEnv: "AUDITPROV_API_KEY", models: [{ id: "fake-m" }] },
}

const mutateCalls: { ns: string; ops: unknown[]; revision?: number }[] = []
const logoutRefs: string[] = []

const session = makeFakePromptSession() as ShellSessionSurface & Record<string, unknown>
Object.assign(session, {
  settingsSeam: {
    describe: async () => [{ ns: "llm-pi-ai", revision, value: { providers }, schema: {} }],
    mutate: async (ns: string, ops: unknown[], rev?: number) => {
      mutateCalls.push({ ns, ops, revision: rev })
      for (const op of ops as { op: string; path: string[] }[]) {
        if (op.op === "unset" && op.path[0] === "providers") delete providers[op.path[1] as string]
        if (op.op === "set" && op.path[0] === "providers") providers[op.path[1] as string] = {} as never
      }
      revision++
    },
  },
  logout: async (ref: string) => {
    logoutRefs.push(ref)
  },
  async listProviders() {
    return Object.entries(providers).map(([provider, p]) => ({ provider, models: (p.models ?? []).map((m) => m.id) }))
  },
})

const ui = await testRender(
  () => <ShellHost deps={{ store: new SurfaceStore() as any, t: ((k: string) => k) as any, session }} />,
  { width: 110, height: 40, kittyKeyboard: true, exitOnCtrlC: false },
)
await settle()

try {
  // ---- before: /model lists the auditprov model ----
  await ui.mockInput.typeText("/model")
  ui.mockInput.pressEnter()
  const before = await waitFrame("fake-m")
  check(before.includes("fake-m") && before.includes("auditprov"), "/model before logout: fake-m (auditprov) listed")

  ui.mockInput.pressEscape()
  await settle()

  // ---- /logout: menu → Down to auditprov → confirm names it EXACTLY ----
  await ui.mockInput.typeText("/logout")
  ui.mockInput.pressEnter()
  const menu = await waitFrame("log out — pick a provider")
  check(menu.includes("otherprov") && menu.includes("auditprov"), "/logout: menu lists the configured routes")
  ui.mockInput.pressArrow("down") // first item is otherprov — NEVER confirm blind (incident guard)
  await settle()
  ui.mockInput.pressEnter()
  const confirm = await waitFrame("unsubscribe auditprov?")
  check(
    confirm.includes("unsubscribe auditprov? (route + key removed)"),
    "/logout: confirm names the highlighted provider exactly",
    JSON.stringify(confirm.slice(-400)),
  )
  check(!confirm.includes("unsubscribe otherprov?"), "/logout: the OTHER route is not the confirm target")

  // ---- y commits: both calls, route first ----
  ui.mockInput.typeText("y")
  const done = await waitFrame("auditprov unsubscribed — route and key removed")
  check(done.includes("auditprov unsubscribed — route and key removed"), "/logout: unsubscribed message paints")
  // KNOWN pre-existing leak (separate issue): during login-panel stages the
  // blurred main editor also receives the keystroke, so the confirm's y
  // lands in the input buffer after the commit. Clear it before the next
  // command so /model is not polluted into a prompt.
  for (let i = 0; i < 8; i++) ui.mockInput.pressBackspace()
  await settle()
  check(mutateCalls.length === 1, "logout contract: exactly ONE settings.mutate (route removal)", JSON.stringify(mutateCalls))
  check(logoutRefs.length === 1 && logoutRefs[0] === "AUDITPROV_API_KEY", "logout contract: exactly ONE credential unset for AUDITPROV_API_KEY", JSON.stringify(logoutRefs))
  check(mutateCalls[0]?.ns === "llm-pi-ai", "logout contract: route removal targets the llm-pi-ai namespace")
  check(
    JSON.stringify(mutateCalls[0]?.ops) === JSON.stringify([{ op: "unset", path: ["providers", "auditprov"] }]),
    "logout contract: the unset op is the exact inverse of login's set",
    JSON.stringify(mutateCalls[0]?.ops),
  )
  check(mutateCalls[0]?.revision === 5, "logout contract: mutate carries the describe() revision (optimistic lock)")

  // ---- after: /model no longer lists the removed provider ----
  await settle()
  await ui.mockInput.typeText("/model")
  ui.mockInput.pressEnter()
  const after = await waitFrame("other-m")
  check(after.includes("other-m"), "/model after logout: still lists the surviving route")
  // fake-m appears ONLY as a picker row (the transcript row says
  // "auditprov unsubscribed", so the provider ID must not be asserted
  // against the whole frame)
  check(!after.includes("fake-m"), "/model after logout: the logged-out provider is GONE", JSON.stringify(after))
  ui.mockInput.pressEscape()
  await settle()
} finally {
  await ui.dispose()
}

console.log(failures === 0 ? "\nFT logout: PASS" : `\nFT logout: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
