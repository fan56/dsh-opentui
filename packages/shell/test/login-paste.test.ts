/**
 * UT: the /login feature's text-entry surface contract
 * (features/login.tsx). The key-entry stage is a custom key-capture
 * surface — historically it only accepted single printable chars, so
 * pasted API keys never landed (bracketed paste arrives as one paste
 * EVENT, never a keypress). The event-level fix lives in ShellHost's
 * usePaste routing + the feature's handlePaste; the full entry-stage
 * round-trip (burst append, mask display, esc abort) is covered by the
 * FT round-trip in scripts/ft-paste.tsx. This unit test pins the
 * reachable contract: gating (menu/closed stages decline text), panel
 * lifecycle, and the derived credential refs.
 */
import { describe, expect, test } from "bun:test"
import { createLoginFeature, deriveKeyRef, type LoginDeps, type LoginFeature } from "../src/features/login.tsx"

function makeLogin(): { login: LoginFeature; pushed: { kind: string; text: string }[] } {
  const pushed: { kind: string; text: string }[] = []
  const deps: LoginDeps = {
    session: {
      credentialStatus: async () => ({ configured: false }),
      login: async () => {},
      logout: async () => {},
    },
    theme: () => ({ tokens: { border: "#fff", accent: "#fff", dim: "#fff", text: "#fff", warn: "#fff" } } as any),
    push: (it) => pushed.push(it as any),
  }
  return { login: createLoginFeature(deps), pushed }
}

describe("deriveKeyRef", () => {
  test("provider id -> UPPER_SNAKE ref", () => {
    expect(deriveKeyRef("anthropic")).toBe("ANTHROPIC_API_KEY")
    expect(deriveKeyRef("amazon-bedrock")).toBe("AMAZON_BEDROCK_API_KEY")
    expect(deriveKeyRef("moonshotai-cn")).toBe("MOONSHOTAI_CN_API_KEY")
  })
})

describe("handlePaste gating", () => {
  test("closed panel declines paste", () => {
    const { login } = makeLogin()
    expect(login.panelOpen()).toBe(false)
    expect(login.handlePaste("sk-token")).toBe(false)
  })

  test("menu stage declines paste (Select owns the interaction)", async () => {
    const { login } = makeLogin()
    await login.open("login")
    expect(login.panelOpen()).toBe(true)
    expect(login.active()).toBe(false)
    expect(login.handlePaste("sk-token")).toBe(false)
    expect(login.handleKey({ name: "x", sequence: "x" })).toBe(false)
  })

  test("menu stage: the feature does not consume keys (Select owns them)", async () => {
    const { login } = makeLogin()
    await login.open("login")
    // even escape: the focused Select closes itself via onCancel
    expect(login.handleKey({ name: "escape" })).toBe(false)
    expect(login.panelOpen()).toBe(true)
  })
})
