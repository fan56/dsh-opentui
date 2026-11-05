/**
 * Feature: /login and /logout — the opencode-shaped flow (flat provider
 * catalog → key → commit; Custom provider option at the end), with the
 * dsh-specific commit: register the llm-pi-ai route via settings.mutate
 * AND store the credential, so the provider appears in /model. Logout is
 * the reverse (route unset + credential unset). Ported from dsh-tui-pi's
 * login/settings/provider-catalog chain, minus the settings-form system.
 */
import { createSignal, type JSX } from "solid-js"
import { Select, type SelectItem, type Theme } from "@dsh-opentui/kit"

export interface CatalogEntry {
  id: string
  name: string
  hint: string
  catalogRoute: boolean
  api?: string
  baseURL?: string
  models?: readonly { id: string; name?: string }[]
  displayName?: string
}

export const PROVIDER_CATALOG: CatalogEntry[] = [
  { id: 'amazon-bedrock', name: 'Amazon Bedrock', hint: 'aws route', catalogRoute: true },
  { id: 'ant-ling', name: 'Ant Ling', hint: 'api key', catalogRoute: true },
  { id: 'anthropic', name: 'Anthropic', hint: 'api key', catalogRoute: true },
  { id: 'azure-openai-responses', name: 'Azure OpenAI', hint: 'api key', catalogRoute: true },
  { id: 'cerebras', name: 'Cerebras', hint: 'api key', catalogRoute: true },
  { id: 'cloudflare-ai-gateway', name: 'Cloudflare AI Gateway', hint: 'api key', catalogRoute: true },
  { id: 'cloudflare-workers-ai', name: 'Cloudflare Workers AI', hint: 'api key', catalogRoute: true },
  { id: 'deepseek', name: 'DeepSeek', hint: 'api key', catalogRoute: true },
  { id: 'fireworks', name: 'Fireworks', hint: 'api key', catalogRoute: true },
  { id: 'github-copilot', name: 'GitHub Copilot', hint: 'provcatalog.hint.copilot', catalogRoute: true },
  { id: 'google', name: 'Google Gemini', hint: 'api key', catalogRoute: true },
  { id: 'google-vertex', name: 'Google Vertex AI', hint: 'provcatalog.hint.googleCloud', catalogRoute: true },
  { id: 'groq', name: 'Groq', hint: 'api key', catalogRoute: true },
  { id: 'huggingface', name: 'Hugging Face', hint: 'provcatalog.hint.huggingface', catalogRoute: true },
  { id: 'kimi-coding', name: 'Kimi For Coding', hint: 'api key', catalogRoute: true },
  { id: 'minimax', name: 'MiniMax', hint: 'api key', catalogRoute: true },
  { id: 'minimax-cn', name: 'MiniMax CN', hint: 'api key', catalogRoute: true },
  { id: 'mistral', name: 'Mistral', hint: 'api key', catalogRoute: true },
  { id: 'moonshotai', name: 'Moonshot AI', hint: 'api key', catalogRoute: true },
  { id: 'moonshotai-cn', name: 'Moonshot AI CN', hint: 'api key', catalogRoute: true },
  { id: 'nvidia', name: 'NVIDIA', hint: 'api key', catalogRoute: true },
  { id: 'openai', name: 'OpenAI', hint: 'api key', catalogRoute: true },
  { id: 'opencode-go', name: 'OpenCode Go', hint: 'api key.gateway', catalogRoute: true },
  { id: 'opencode', name: 'OpenCode Zen', hint: 'api key', catalogRoute: true },
  { id: 'openrouter', name: 'OpenRouter', hint: 'api key', catalogRoute: true },
  { id: 'qwen-token-plan', name: 'Qwen Token Plan', hint: 'api key', catalogRoute: true },
  { id: 'qwen-token-plan-cn', name: 'Qwen Token Plan CN', hint: 'api key', catalogRoute: true },
  { id: 'together', name: 'Together AI', hint: 'api key', catalogRoute: true },
  { id: 'vercel-ai-gateway', name: 'Vercel AI Gateway', hint: 'api key', catalogRoute: true },
  { id: 'xiaomi', name: 'Xiaomi', hint: 'api key', catalogRoute: true },
  { id: 'xiaomi-token-plan-ams', name: 'Xiaomi Token Plan AMS', hint: 'api key', catalogRoute: true },
  { id: 'xiaomi-token-plan-cn', name: 'Xiaomi Token Plan CN', hint: 'api key', catalogRoute: true },
  { id: 'xiaomi-token-plan-sgp', name: 'Xiaomi Token Plan SGP', hint: 'api key', catalogRoute: true },
  { id: 'zai', name: 'Z.AI', hint: 'api key', catalogRoute: true },
  { id: 'zai-coding-cn', name: 'Z.AI Coding CN', hint: 'api key', catalogRoute: true },
  { id: 'xai', name: 'xAI', hint: 'api key', catalogRoute: true },
]


const CUSTOM: CatalogEntry = { id: "custom", name: "Custom provider", hint: "baseUrl + model + key", catalogRoute: false }

export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`
}

/** The llm-pi-ai profile for one catalog entry (tui-pi providerProfileFor). */
function providerProfileFor(entry: CatalogEntry): Record<string, unknown> {
  const profile: Record<string, unknown> = { apiKeyEnv: deriveKeyRef(entry.id) }
  if (!entry.catalogRoute) {
    if (entry.api) profile.api = entry.api
    if (entry.baseURL) profile.baseURL = entry.baseURL
    if (entry.models) profile.models = entry.models
    if (entry.displayName) profile.displayName = entry.displayName
  }
  return profile
}

export interface LoginDeps {
  session: {
    credentialStatus(ref: string): Promise<{ configured: boolean }>
    login(ref: string, apiKey: string): Promise<void>
    logout(ref: string): Promise<void>
    settingsSeam?: { describe(): Promise<any>; mutate(ns: string, ops: unknown[], revision?: number): Promise<void> }
  }
  theme: () => Theme
  push: (it: { kind: "system" | "error"; text: string }) => void
}

type Stage =
  | { kind: "closed" }
  | { kind: "menu"; items: SelectItem[]; title: string; onPick: (value: string) => void }
  | { kind: "entry"; title: string; mask: boolean; buffer: string; onCommit: (value: string) => void }
  | { kind: "confirm"; text: string; onYes: () => void }
  | { kind: "notice"; text: string }

export interface LoginFeature {
  view: () => JSX.Element | null
  open(mode: "login" | "logout"): Promise<void>
  handleKey(key: { name: string; sequence?: string }): boolean
  /** Bracketed-paste text into the active entry field (API keys are pasted,
   * not typed). True when the paste was consumed by an entry stage. */
  handlePaste(text: string): boolean
  active(): boolean
  panelOpen(): boolean
}

/** Printable-run filter shared by the typed-burst and paste paths: API keys
 * and URLs are printable ASCII; control chars are dropped. */
const printableRun = (text: string): string =>
  [...text].filter((c) => c >= "\x20" && c <= "\x7e").join("")

export function createLoginFeature(deps: LoginDeps): LoginFeature {
  const [stage, setStage] = createSignal<Stage>({ kind: "closed" })

  const settings = () => deps.session.settingsSeam

  /** Write (or clear) one provider route in the llm-pi-ai profile. */
  const writeRoute = async (op: "set" | "unset", entry: CatalogEntry): Promise<string | undefined> => {
    const st = settings()
    if (!st) return undefined // no settings service: nothing to register
    try {
      const entries = (await st.describe()) as any[]
      const desc = Array.isArray(entries) ? entries.find((e) => e?.ns === "llm-pi-ai") : undefined
      const ops = op === "set"
        ? [{ op: "set", path: ["providers", entry.id], value: providerProfileFor(entry) }]
        : [{ op: "unset", path: ["providers", entry.id] }]
      await st.mutate("llm-pi-ai", ops, desc?.revision)
      return undefined
    } catch (e) {
      return String(e instanceof Error ? e.message : e).slice(0, 200)
    }
  }

  const commitLogin = async (entry: CatalogEntry, key: string) => {
    setStage({ kind: "closed" })
    const routeError = await writeRoute("set", entry)
    if (routeError) {
      deps.push({ kind: "error", text: `${entry.id}: ${routeError}` })
      return
    }
    try {
      await deps.session.login(deriveKeyRef(entry.id), key)
      deps.push({ kind: "system", text: `${entry.name} subscribed — key stored, route registered (in /model next session)` })
    } catch (e) {
      deps.push({ kind: "error", text: String(e instanceof Error ? e.message : e).slice(0, 200) })
    }
  }

  const commitLogout = async (id: string) => {
    setStage({ kind: "closed" })
    const routeError = await writeRoute("unset", { id, name: id, hint: "", catalogRoute: true })
    try {
      await deps.session.logout(deriveKeyRef(id))
    } catch (e) {
      deps.push({ kind: "error", text: `key removal failed: ${String(e instanceof Error ? e.message : e).slice(0, 150)}` })
    }
    if (routeError) deps.push({ kind: "error", text: `${id}: ${routeError}` })
    else deps.push({ kind: "system", text: `${id} unsubscribed — route and key removed` })
  }

  const openMenu = async (mode: "login" | "logout") => {
    const st = settings()
    let configuredRoutes: string[] = []
    try {
      const entries = (await st?.describe()) as any[]
      const desc = Array.isArray(entries) ? entries.find((e) => e?.ns === "llm-pi-ai") : undefined
      configuredRoutes = Object.keys((desc?.value as any)?.providers ?? {})
    } catch {
      /* no settings service: only credential-side state matters */
    }
    if (mode === "logout") {
      if (configuredRoutes.length === 0) {
        setStage({ kind: "notice", text: "no subscribed providers to log out" })
        return
      }
      setStage({
        kind: "menu",
        title: "log out — pick a provider (removes route + key)",
        items: configuredRoutes.map((id) => ({ label: id, value: id })),
        onPick: (id) => setStage({ kind: "confirm", text: `unsubscribe ${id}? (route + key removed)`, onYes: () => void commitLogout(id) }),
      })
      return
    }
    setStage({
      kind: "menu",
      title: "log in — pick a provider",
      items: [...PROVIDER_CATALOG, CUSTOM].map((e) => ({
        label: e.name,
        group: e.catalogRoute ? "api key" : "hand-declared",
        value: e.id,
        description: e.hint,
      })),
      onPick: (id) => {
        if (id === CUSTOM.id) {
          setStage({ kind: "entry", title: "custom provider baseUrl", mask: false, buffer: "", onCommit: (base) => {
            setStage({ kind: "entry", title: "model ids (comma-separated)", mask: false, buffer: "", onCommit: (models) => {
              setStage({ kind: "entry", title: "custom provider id (route key)", mask: false, buffer: "", onCommit: (pid) => {
                const entry: CatalogEntry = {
                  id: pid.trim() || "custom",
                  name: pid.trim() || "custom",
                  hint: "custom",
                  catalogRoute: false,
                  api: "openai-completions",
                  baseURL: base.trim(),
                  models: models.split(",").map((m) => ({ id: m.trim() })).filter((m) => m.id),
                  displayName: pid.trim(),
                }
                setStage({ kind: "entry", title: `API key for ${entry.id}`, mask: true, buffer: "", onCommit: (key) => void commitLogin(entry, key) })
              }})
            }})
          }})
          return
        }
        const entry = PROVIDER_CATALOG.find((e) => e.id === id)!
        setStage({ kind: "entry", title: `API key for ${entry.name} (${deriveKeyRef(entry.id)})`, mask: true, buffer: "", onCommit: (key) => void commitLogin(entry, key) })
      },
    })
  }

  const view = (): JSX.Element | null => {
    const st = stage()
    const th = deps.theme()
    if (st.kind === "menu") {
      return <Select title={st.title} items={st.items} theme={th} onSelect={(v) => { setStage({ kind: "closed" }); st.onPick(v) }} onCancel={() => setStage({ kind: "closed" })} />
    }
    if (st.kind === "entry") {
      // Explicit width/height: auto-height boxes collapse inside the flex
      // column once the flexGrow transcript holds content — the rows then
      // overpaint onto a single line (title/hint interleaved into one
      // mangled row; the same kit-Select constraint, documented there:
      // "auto height inside a flex column collapses to zero rows").
      // 7 = border 2 + padding 2 + title + buffer + hint.
      return (
        <box style={{ border: true, borderStyle: "rounded", borderColor: th.tokens.border, flexDirection: "column", padding: 1, width: "100%", height: 7 }}>
          <text style={{ fg: th.tokens.accent }}>{st.title}</text>
          <text style={{ fg: th.tokens.text }}>{st.mask ? st.buffer.replace(/./g, "*") || " " : st.buffer || " "}</text>
          <text style={{ fg: th.tokens.dim }}>type · enter saves · esc cancels</text>
        </box>
      )
    }
    if (st.kind === "confirm") {
      // 6 = border 2 + padding 2 + text + hint.
      return (
        <box style={{ border: true, borderStyle: "rounded", borderColor: th.tokens.warn, flexDirection: "column", padding: 1, width: "100%", height: 6 }}>
          <text style={{ fg: th.tokens.warn }}>{st.text}</text>
          <text style={{ fg: th.tokens.dim }}>y confirm · n/esc cancels</text>
        </box>
      )
    }
    if (st.kind === "notice") {
      // 5 = border 2 + padding 2 + text.
      return (
        <box style={{ border: true, borderStyle: "rounded", borderColor: th.tokens.border, flexDirection: "column", padding: 1, width: "100%", height: 5 }}>
          <text style={{ fg: th.tokens.dim }}>{st.text}</text>
        </box>
      )
    }
    return null
  }

  const handleKey = (key: { name: string; sequence?: string }): boolean => {
    const st = stage()
    if (st.kind === "closed") return false
    if (st.kind === "entry") {
      if (key.name === "escape") { setStage({ kind: "closed" }); return true }
      if (key.name === "return") {
        // Empty commit guard: an entry field is a required value (API key,
        // baseUrl, model ids, provider id). Committing an empty buffer
        // fired a credentials.set the host rejects ("invalid payload") AND
        // registered a garbage route (writeRoute runs before the credential
        // write) — every stage of the flow. Enter on an empty field is a
        // swallowed no-op; escape stays the cancel path. A re-sent Enter
        // (dropped-keypress retry) can no longer destroy the open stage.
        if (!st.buffer.trim()) return true
        st.onCommit(st.buffer)
        return true
      }
      if (key.name === "backspace") { setStage({ ...st, buffer: st.buffer.slice(0, -1) }); return true }
      // accept single keys AND multi-char bursts (an unwrapped paste can
      // arrive as one keypress carrying the whole string)
      const ch = printableRun(key.sequence ?? "")
      if (ch) { setStage({ ...st, buffer: st.buffer + ch }); return true }
      return true
    }
    if (st.kind === "confirm") {
      if (key.sequence === "y") { st.onYes(); return true }
      if (key.sequence === "n" || key.name === "escape") { setStage({ kind: "closed" }); return true }
      return true
    }
    if (st.kind === "notice") { setStage({ kind: "closed" }); return true }
    return false
  }

  const handlePaste = (text: string): boolean => {
    const st = stage()
    if (st.kind !== "entry") return false // menus/confirm don't take text
    const cleaned = printableRun(text)
    if (cleaned) setStage({ ...st, buffer: st.buffer + cleaned })
    return true
  }

  return {
    view,
    open: openMenu,
    handleKey,
    handlePaste,
    active: () => stage().kind !== "closed" && stage().kind !== "menu",
    panelOpen: () => stage().kind !== "closed",
  }
}
