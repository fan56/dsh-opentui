/**
 * The M2 Shell: a usable chat TUI. Ask a question → the model thinks
 * (live dim stream), calls tools (approval card → tool block), replies.
 * Model/provider config is reused from ~/.dsh (see agent/config.ts).
 */
import { For, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { StatusBar, defaultTheme, type I18n } from "@dsh-opentui/kit"
import type { SurfaceStore, SurfaceWidgetDecl } from "@dsh-opentui/runtime"
import { AgentSession } from "./agent/loop.ts"
import { listModels, resolveModel, type ResolvedModel } from "./agent/config.ts"
import type { ToolRun } from "./agent/tools.ts"

export interface ShellDeps {
  store: SurfaceStore
  t: I18n["t"]
  /** Model override from CLI, if any. */
  modelOverride?: string
}

type TItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "thinking"; tail: string; chars: number }
  | { kind: "tool"; name: string; args: string; ok: boolean; brief: string }
  | { kind: "error"; text: string }
  | { kind: "system"; text: string }

const MAX_VISIBLE_LINES = 200

export function Shell(props: { deps: ShellDeps }) {
  const t = props.deps.t
  const store = props.deps.store
  const [input, setInput] = createSignal("")
  const [items, setItems] = createSignal<TItem[]>([])
  const [busy, setBusy] = createSignal(false)
  const [spin, setSpin] = createSignal(0)
  const [approval, setApproval] = createSignal<{ name: string; args: string } | null>(null)
  const [model, setModel] = createSignal<ResolvedModel | null>(null)
  const [usage, setUsage] = createSignal({ prompt: 0, completion: 0, turns: 0 })
  const [snapshot, setSnapshot] = createSignal(store.snapshot)

  let session: AgentSession | null = null
  let abort: AbortController | null = null
  let approveResolve: ((ok: boolean) => void) | null = null

  // boot model from dsh config
  try {
    const m = resolveModel(props.deps.modelOverride)
    session = new AgentSession(m)
    setModel(m)
  } catch (e) {
    setItems([{ kind: "error", text: `config: ${String(e instanceof Error ? e.message : e)}` }])
  }

  onMount(() => {
    onCleanup(store.subscribe(() => setSnapshot(store.snapshot)))
    const t2 = setInterval(() => setSpin((s) => (s + 1) % 4), 150)
    onCleanup(() => clearInterval(t2))
  })

  const spinner = () => ["⠋", "⠙", "⠹", "⠸"][spin()]

  // ---- transcript rendering (plain lines) ----
  const lines = createMemo(() => {
    const out: { text: string; fg?: string }[] = []
    for (const it of items()) {
      if (it.kind === "user") out.push({ text: `你 › ${it.text}`, fg: defaultTheme.tokens.accent })
      else if (it.kind === "assistant")
        for (const l of it.text.split("\n")) out.push({ text: l })
      else if (it.kind === "thinking")
        out.push({ text: `${spinner()} ${t("agent.thinking")} (${it.chars}) ${it.tail.slice(-120)}`, fg: defaultTheme.tokens.dim })
      else if (it.kind === "tool")
        out.push({ text: `  ⚒ ${it.name} ${it.args.slice(0, 80)} → ${it.ok ? t("agent.tool.ok") : t("agent.tool.fail")}: ${it.brief.slice(0, 100)}`, fg: it.ok ? defaultTheme.tokens.warn : defaultTheme.tokens.danger })
      else if (it.kind === "error") out.push({ text: `✗ ${t("agent.error")}: ${it.text}`, fg: defaultTheme.tokens.danger })
      else if (it.kind === "system") out.push({ text: `· ${it.text}`, fg: defaultTheme.tokens.dim })
    }
    return out.slice(-MAX_VISIBLE_LINES)
  })

  // ---- streaming appends with light throttling ----
  let lastBump = 0
  const bumpSoon = () => {
    const now = Date.now()
    if (now - lastBump > 60) {
      lastBump = now
      setItems((arr) => [...arr])
    }
  }

  const push = (it: TItem) => setItems((arr) => [...arr, it])

  async function send(text: string) {
    if (!session || busy()) return
    push({ kind: "user", text })
    setBusy(true)
    abort = new AbortController()

    let thinkingItem: { kind: "thinking"; tail: string; chars: number } | null = null
    let replyItem: { kind: "assistant"; text: string } | null = null

    try {
      await session.turn(
        text,
        {
          onThinkingDelta: (s) => {
            if (!thinkingItem) {
              thinkingItem = { kind: "thinking", tail: "", chars: 0 }
              push(thinkingItem)
            }
            thinkingItem.tail = (thinkingItem.tail + s).split("\n").slice(-2).join(" ")
            thinkingItem.chars += s.length
            bumpSoon()
          },
          onContentDelta: (s) => {
            if (thinkingItem) {
              thinkingItem.tail = `…${thinkingItem.chars}`
              thinkingItem = null
            }
            if (!replyItem) {
              replyItem = { kind: "assistant", text: "" }
              push(replyItem)
            }
            replyItem.text += s
            bumpSoon()
          },
          onTurnEnd: (u) => {
            setUsage((v) => ({ prompt: v.prompt + u.prompt, completion: v.completion + u.completion, turns: v.turns + 1 }))
          },
          onApprove: (name, args) => {
            setApproval({ name, args: JSON.stringify(args) })
            return new Promise<boolean>((resolve) => {
              approveResolve = resolve
            })
          },
          onToolRun: (run: ToolRun) => {
            const brief = run.output.split("\n").slice(-3).join(" ⏎ ").slice(0, 200)
            push({ kind: "tool", name: run.name, args: run.argsPretty, ok: run.ok, brief })
          },
          onError: (msg) => push({ kind: "error", text: msg }),
        },
        abort.signal,
      )
    } finally {
      setApproval(null)
      approveResolve = null
      setBusy(false)
      abort = null
    }
  }

  function handleCommand(raw: string): boolean {
    const [cmd, ...rest] = raw.slice(1).split(/\s+/)
    if (cmd === "quit" || cmd === "exit") {
      process.exit(0)
    }
    if (cmd === "help" || cmd === "?") {
      push({ kind: "system", text: t("cmd.help.lines") })
      return true
    }
    if (cmd === "clear") {
      setItems([])
      const m = model()
      if (m) session = new AgentSession(m)
      push({ kind: "system", text: t("cmd.cleared") })
      return true
    }
    if (cmd === "usage") {
      const u = usage()
      push({ kind: "system", text: `${t("cmd.usage.summary")}: ${u.turns} turns · prompt ${u.prompt} · completion ${u.completion} tokens` })
      return true
    }
    if (cmd === "model") {
      const arg = rest.join(" ")
      if (!arg) {
        const m = model()
        push({ kind: "system", text: `${t("cmd.model.current")}: ${m ? `${m.provider}/${m.model}` : "-"}` })
        push({ kind: "system", text: `${t("cmd.model.available")}: ${listModels().map((c) => `${c.provider}/${c.model}`).join("  ")}` })
        return true
      }
      try {
        const m = resolveModel(arg)
        session = new AgentSession(m)
        setModel(m)
        push({ kind: "system", text: `${t("cmd.model.set")} ${m.provider}/${m.model}` })
      } catch (e) {
        push({ kind: "error", text: String(e instanceof Error ? e.message : e) })
      }
      return true
    }
    return false
  }

  useKeyboard((key) => {
    // approval modal takes precedence
    const ap = approval()
    if (ap) {
      if (key.sequence === "y" || key.name === "return") {
        setApproval(null)
        approveResolve?.(true)
        approveResolve = null
      } else if (key.sequence === "n" || key.name === "escape") {
        setApproval(null)
        approveResolve?.(false)
        approveResolve = null
      }
      return
    }
    if (key.sequence === "\x03") process.exit(0)
    if (busy()) {
      if (key.name === "escape" && abort) abort.abort()
      return
    }
    if (key.name === "return") {
      const text = input().trim()
      setInput("")
      if (!text) return
      if (text.startsWith("/")) {
        handleCommand(text)
        return
      }
      send(text)
      return
    }
    if (key.name === "backspace") return setInput((s) => s.slice(0, -1))
    if (key.name === "escape") return setInput("")
    const ch = key.sequence
    if (ch && ch.length === 1 && !key.ctrl && !key.meta && !/[\x00-\x1f]/.test(ch)) setInput((s) => s + ch)
  })

  const widgets = () => snapshot().filter((d): d is SurfaceWidgetDecl => d.kind === "widget")

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ flexDirection: "column", flexGrow: 1, padding: 1 }}>
        <For each={lines()} fallback={<text style={{ fg: defaultTheme.tokens.dim }}>{t("shell.transcript.empty")}</text>}>
          {(l) => <text style={l.fg ? { fg: l.fg } : {}}>{l.text || " "}</text>}
        </For>
      </box>
      <For each={approval() ? [approval()!] : []}>
        {(ap) => (
          <box style={{ border: true, borderColor: defaultTheme.tokens.warn, flexDirection: "column", padding: 1 }}>
            <text style={{ fg: defaultTheme.tokens.warn }}>⚠ {t("agent.approve.title")}: {ap.name}</text>
            <text>{ap.args.slice(0, 200)}</text>
            <text style={{ fg: defaultTheme.tokens.dim }}>{t("agent.approve.hint")}</text>
          </box>
        )}
      </For>
      <box style={{ border: true, borderColor: defaultTheme.tokens.border, flexDirection: "row" }}>
        <text style={{ fg: defaultTheme.tokens.accent }}>{busy() ? `${spinner()} ` : "› "}</text>
        <text>{busy() ? t("shell.input.busy") : input() || t("shell.input.placeholder")}</text>
      </box>
      <StatusBar
        widgets={[
          ...(model() ? [{ kind: "widget" as const, slot: "status" as const, id: "model", order: 10, parts: [{ text: `${model()!.provider}/${model()!.model}`, color: defaultTheme.tokens.accent }] }] : []),
          { kind: "widget" as const, slot: "status" as const, id: "usage", order: 20, parts: [{ text: `p${usage().prompt}/c${usage().completion}`, dim: true }] },
          ...widgets(),
        ]}
      />
    </box>
  )
}
