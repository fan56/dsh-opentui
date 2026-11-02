/**
 * The M2 Shell: a usable chat TUI. Ask a question → the model thinks
 * (live dim stream), calls tools (approval card → tool block), replies.
 * Model/provider config is reused from ~/.dsh (see agent/config.ts).
 * All presentational building blocks come from @dsh-opentui/kit — this
 * file owns state and keyboard routing only.
 */
import { For, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { SyntaxStyle } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { StatusBar, getTheme, themes, type I18n } from "@dsh-opentui/kit"
import { Transcript, InputLine, FooterHints, type TranscriptItem } from "@dsh-opentui/kit"
import { ApprovalCard } from "@dsh-opentui/kit"
import type { SurfaceStore, SurfaceWidgetDecl } from "@dsh-opentui/runtime"
import { AgentSession } from "./agent/loop.ts"
import { listModels, resolveModel, type ResolvedModel } from "./agent/config.ts"
import type { ToolRun } from "./agent/tools.ts"

export interface ShellDeps {
  store: SurfaceStore
  t: I18n["t"]
  /** Model override from CLI, if any. */
  modelOverride?: string
  themeName?: string
}

/** Transcript rows are Kit's shape now; kept as a local alias. */
type TItem = TranscriptItem

const MAX_VISIBLE_ITEMS = 120
const THEME_ORDER = ["catppuccin-mocha", "default"]

export function Shell(props: { deps: ShellDeps }) {
  const t = props.deps.t
  const store = props.deps.store
  const initialTheme =
    process.env.DSH_OPENTUI_THEME ?? props.deps.themeName ?? "catppuccin-mocha"
  const [themeName, setThemeName] = createSignal(
    themes[initialTheme] ? initialTheme : "catppuccin-mocha",
  )
  const th = () => getTheme(themeName())
  // Draft mirrors the InputLine textarea buffer; the component owns the
  // caret and all editing, the Shell only reads the value on submit.
  const [draft, setDraft] = createSignal("")
  // Command history for up/down recall; historyIdx === history().length is
  // the draft slot (below the newest entry, i.e. the empty line).
  const [history, setHistory] = createSignal<string[]>([])
  const [historyIdx, setHistoryIdx] = createSignal(0)
  // Imperative textarea control: resetKey bump = full buffer reset (/clear),
  // setKey bump + setValue = undoable replace (submit-clear, history recall).
  const [resetKey, setResetKey] = createSignal(0)
  const [setKey, setSetKey] = createSignal(0)
  const [setValue, setSetValue] = createSignal("")
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

  // markdown style for finalized assistant messages (best-effort: the
  // intrinsic tolerates undefined, code blocks then render unstyled)
  const rendererCtx = useRenderer()
  let mdStyle: any
  try {
    mdStyle = SyntaxStyle.create(rendererCtx as any)
  } catch {
    mdStyle = undefined
  }

  const visibleItems = createMemo(() => items().slice(-MAX_VISIBLE_ITEMS))

  let lastBump = 0
  let streaming: { thinking?: TItem; reply?: TItem } = {}
  const bumpSoon = () => {
    const now = Date.now()
    if (now - lastBump > 60) {
      lastBump = now
      setItems((arr) => arr.map((x) => (x === streaming.thinking || x === streaming.reply ? { ...x } : x)))
    }
  }
  const push = (it: TItem) => setItems((arr) => [...arr, it])

  // ---- input flow: submit + history recall over the InputLine textarea ----
  /** Record a submitted line in history (dedupe consecutive duplicates). */
  const commitHistory = (text: string) => {
    if (!text) return
    const h = history()
    const next = h[h.length - 1] === text ? h : [...h, text]
    setHistory(next)
    setHistoryIdx(next.length)
  }
  /** History recall from InputLine's onHistoryNav. Fires only when the
   * cursor sits on the first/last visual line. Returns true when the key
   * was consumed so the editor suppresses its own cursor movement. */
  const historyNav = (dir: "up" | "down"): boolean => {
    const h = history()
    if (h.length === 0) return false
    let idx = Math.min(historyIdx(), h.length)
    if (dir === "up" && idx > 0) idx -= 1
    else if (dir === "down" && idx < h.length) idx += 1
    else return false
    setHistoryIdx(idx)
    const text = idx === h.length ? "" : h[idx]
    setSetValue(text)
    setSetKey((k) => k + 1)
    return true
  }
  /** Clear the textarea buffer (undoable replace, cursor stays in draft). */
  const clearInput = () => {
    setSetValue("")
    setSetKey((k) => k + 1)
  }
  /** Enter in the InputLine: read the draft, clear the buffer, dispatch. */
  const submitInput = () => {
    const text = draft().trim()
    clearInput()
    if (!text) return
    commitHistory(text)
    if (text.startsWith("/")) {
      handleCommand(text)
      return
    }
    send(text)
  }

  async function send(text: string) {
    if (!session || busy()) return
    push({ kind: "user", text })
    setBusy(true)
    abort = new AbortController()

    let thinkingItem: Extract<TItem, { kind: "thinking" }> | null = null
    let replyItem: Extract<TItem, { kind: "assistant" }> | null = null

    try {
      await session.turn(
        text,
        {
          onThinkingDelta: (s) => {
            if (!thinkingItem) {
              thinkingItem = { kind: "thinking", tail: "", chars: 0 }
              streaming.thinking = thinkingItem
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
              streaming.reply = replyItem
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
      setResetKey((k) => k + 1)
      push({ kind: "system", text: t("cmd.cleared") })
      return true
    }
    if (cmd === "usage") {
      const u = usage()
      push({ kind: "system", text: `${t("cmd.usage.summary")}: ${u.turns} turns · prompt ${u.prompt} · completion ${u.completion} tokens` })
      return true
    }
    if (cmd === "theme") {
      const i = THEME_ORDER.indexOf(themeName())
      const next = THEME_ORDER[(i + 1) % THEME_ORDER.length]
      setThemeName(next)
      push({ kind: "system", text: `theme → ${next}` })
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

  // Global keys only. While the InputLine textarea is focused, this hook
  // still sees every key FIRST (global listeners run before the focused
  // renderable in OpenTUI's InternalKeyHandler), but everything it does
  // not handle falls through to the textarea's own editing bindings.
  useKeyboard((key) => {
    // quit works from any state — raw \x03 (legacy mode) or parsed ctrl+c
    // (kitty keyboard protocol delivers it as CSI-u, OpenTUI parses to
    // name "c" + ctrl flag)
    if (key.sequence === "\x03" || ((key.name === "c" || key.name === "C") && key.ctrl)) process.exit(0)
    // approval modal takes precedence (busy is up, the textarea is blurred)
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
    if (busy()) {
      if (key.name === "escape" && abort) abort.abort()
      return
    }
    // Idle: all editing keys belong to the focused textarea in InputLine.
  })

  const widgets = () => snapshot().filter((d): d is SurfaceWidgetDecl => d.kind === "widget")

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ flexDirection: "column", flexGrow: 1, padding: 1 }}>
        <Transcript
          items={visibleItems()}
          theme={th()}
          t={t}
          spinnerFrame={spinner()}
          mdStyle={mdStyle}
        />
      </box>
      <For each={approval() ? [approval()!] : []}>
        {(ap) => (
          <ApprovalCard toolName={ap.name} args={ap.args} hint={t("agent.approve.hint")} theme={th()} />
        )}
      </For>
      <InputLine
        theme={th()}
        placeholder={t("shell.input.placeholder")}
        busy={busy()}
        busyLabel={t("shell.input.busy")}
        spinnerFrame={spinner()}
        onSubmit={submitInput}
        onContentChange={setDraft}
        onHistoryNav={historyNav}
        resetKey={resetKey()}
        setKey={setKey()}
        setValue={setValue()}
      />
      <FooterHints theme={th()} />
      <StatusBar
        theme={th()}
        phase={busy() ? (approval() ? "approve" : "tool") : null}
        elapsed={() => 0}
        detail={() => approval()?.name ?? ""}
      />
    </box>
  )
}
