/**
 * Feature: /login and /logout — interactive credential panels, the flow
 * ported from dsh-tui-pi's login.ts (picker → key editor → commit →
 * feedback; logout picks among configured refs). Composed from Kit's
 * Select and a single-line native textarea for the key entry.
 */
import { createSignal, Show, type JSX } from "solid-js"
import { Select, type SelectItem, type Theme } from "@dsh-opentui/kit"
import type { OverlayRequest } from "./model-select.tsx"

/** Credential refs offered (the profile's apiKeyEnv routes). */
const CRED_REFS = ["ZAI_CODING_CN_API_KEY", "DEEPSEEK_API_KEY", "MINIMAX_CN_API_KEY"]

export interface LoginDeps {
  session: {
    credentialStatus(ref: string): Promise<{ configured: boolean }>
    login(ref: string, apiKey: string): Promise<void>
    logout(ref: string): Promise<void>
  }
  theme: () => Theme
  push: (it: { kind: "system" | "error"; text: string }) => void
}

type Stage =
  | { kind: "closed" }
  | { kind: "menu"; mode: "login" | "logout"; items: SelectItem[]; title: string; onPick: (value: string) => void }
  | { kind: "key"; ref: string }
  | { kind: "confirm-logout"; ref: string }
  | { kind: "notice"; text: string; error?: boolean }

export interface LoginFeature {
  view: () => JSX.Element | null
  open(mode: "login" | "logout"): Promise<void>
  /** Shell routes keys here while view() is non-null; true = consumed. */
  handleKey(key: { name: string; sequence?: string }): boolean
  /** Any stage visible (drives the editor blur so keys never leak). */
  active(): boolean
  /** A panel is on screen (menu included) — the Shell blurs the editor. */
  panelOpen(): boolean
}

export function createLoginFeature(deps: LoginDeps): LoginFeature {
  const [stage, setStage] = createSignal<Stage>({ kind: "closed" })
  const [keyBuf, setKeyBuf] = createSignal("")
  const [status, setStatus] = createSignal<Record<string, boolean>>({})

  const refreshStatus = async () => {
    const next: Record<string, boolean> = {}
    for (const ref of CRED_REFS) {
      try {
        next[ref] = (await deps.session.credentialStatus(ref)).configured
      } catch {
        next[ref] = false
      }
    }
    setStatus(next)
  }

  const openMenu = async (mode: "login" | "logout") => {
    await refreshStatus()
    const st = status()
    if (mode === "logout") {
      const configured = CRED_REFS.filter((r) => st[r])
      if (configured.length === 0) {
        setStage({ kind: "notice", text: "no configured credentials to log out" })
        return
      }
      setStage({
        kind: "menu",
        mode,
        title: "log out — pick a credential",
        items: configured.map((r) => ({ label: r, value: r, description: st[r] ? "configured" : "missing" })),
        onPick: (value) => setStage({ kind: "confirm-logout", ref: value }),
      })
      return
    }
    // login: every known ref is offered (a re-login overwrites the key)
    setStage({
      kind: "menu",
      mode,
      title: "log in — pick a credential ref",
      items: CRED_REFS.map((r) => ({ label: r, value: r, description: st[r] ? "configured — re-login overwrites" : "missing" })),
      onPick: (value) => {
        setKeyBuf("")
        setStage({ kind: "key", ref: value })
      },
    })
  }

  const commitLogin = async () => {
    const ref = (stage() as { ref: string }).ref
    const key = keyBuf().trim()
    setStage({ kind: "closed" })
    if (!key) return
    try {
      await deps.session.login(ref, key)
      deps.push({ kind: "system", text: `credential saved: ${ref}` })
    } catch (e) {
      deps.push({ kind: "error", text: String(e instanceof Error ? e.message : e).slice(0, 300) })
    }
  }

  const commitLogout = async (ref: string) => {
    setStage({ kind: "closed" })
    try {
      await deps.session.logout(ref)
      deps.push({ kind: "system", text: `credential removed: ${ref}` })
    } catch (e) {
      deps.push({ kind: "error", text: String(e instanceof Error ? e.message : e).slice(0, 300) })
    }
  }

  const view = (): JSX.Element | null => {
    const st = stage()
    const th = deps.theme()
    if (st.kind === "menu") {
      return (
        <Select
          title={st.title}
          items={st.items}
          theme={th}
          onSelect={(value) => {
            setStage({ kind: "closed" })
            st.onPick(value)
          }}
          onCancel={() => setStage({ kind: "closed" })}
        />
      )
    }
    if (st.kind === "key") {
      return (
        <box style={{ border: true, borderStyle: "rounded", borderColor: th.tokens.border, flexDirection: "column", padding: 1 }}>
          <text style={{ fg: th.tokens.accent }}>{`API key for ${st.ref}`}</text>
          <box style={{ flexDirection: "row" }}>
            <text style={{ fg: th.tokens.dim }}>key: </text>
            <text style={{ fg: th.tokens.text }}>{keyBuf().replace(/./g, "*") || " "}</text>
          </box>
          <text style={{ fg: th.tokens.dim }}>type the key · enter saves · esc cancels</text>
        </box>
      )
    }
    if (st.kind === "confirm-logout") {
      return (
        <box style={{ border: true, borderStyle: "rounded", borderColor: th.tokens.warn, flexDirection: "column", padding: 1 }}>
          <text style={{ fg: th.tokens.warn }}>{`remove credential ${st.ref}?`}</text>
          <text style={{ fg: th.tokens.dim }}>y removes · n/esc cancels</text>
        </box>
      )
    }
    if (st.kind === "notice") {
      return (
        <box style={{ border: true, borderStyle: "rounded", borderColor: th.tokens.border, flexDirection: "column", padding: 1 }}>
          <text style={{ fg: th.tokens.dim }}>{st.text}</text>
        </box>
      )
    }
    return null
  }

  const handleKey = (key: { name: string; sequence?: string }): boolean => {
    const st = stage()
    if (st.kind === "closed") return false
    if (st.kind === "key") {
      if (key.name === "escape") {
        setStage({ kind: "closed" })
        return true
      }
      if (key.name === "return") {
        void commitLogin()
        return true
      }
      if (key.name === "backspace") {
        setKeyBuf((v) => v.slice(0, -1))
        return true
      }
      const ch = key.sequence ?? ""
      if (ch.length === 1 && !key.name?.startsWith("shift") && /[\x20-\x7e]/.test(ch)) {
        setKeyBuf((v) => v + ch)
        return true
      }
      return true // swallow everything else while typing
    }
    if (st.kind === "confirm-logout") {
      if (key.sequence === "y") {
        void commitLogout(st.ref)
        return true
      }
      if (key.sequence === "n" || key.name === "escape") {
        setStage({ kind: "closed" })
        return true
      }
      return true
    }
    if (st.kind === "notice") {
      setStage({ kind: "closed" })
      return true
    }
    return false // menu stage: the Select handles its own keys
  }

  return {
    view,
    open: openMenu,
    handleKey,
    active: () => stage().kind !== "closed" && stage().kind !== "menu",
    panelOpen: () => stage().kind !== "closed",
  }
}

/** Overlay-request adapter kept for API symmetry with sibling features. */
export function loginOverlayStub(): OverlayRequest | null {
  return null
}
