/**
 * ShellHost — the Shell driving a HostSession (the real dsh host inside
 * this process). dsh-tui-pi-style affordances: slash palette with
 * autocomplete, themes, markdown transcript, a /model Picker overlay,
 * think/tool panels (ctrl+t / ctrl+o / ctrl+p) and /login //logout
 * credential commands. All presentational building blocks come from
 * @dsh-opentui/kit — this file owns state and keyboard routing only.
 */
import { For, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { SyntaxStyle } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { StatusBar, getTheme, themes, type I18n } from "@dsh-opentui/kit"
import { Transcript, InputLine, FooterHints, type TranscriptItem } from "@dsh-opentui/kit"
import { Picker, ApprovalCard, Dialog, type PickerItem } from "@dsh-opentui/kit"
import { ToolPanel, ThinkPanel, type ToolPanelEntry } from "@dsh-opentui/kit"
import type { SurfaceStore, SurfaceWidgetDecl } from "@dsh-opentui/runtime"
import type { HostSession } from "./host-session.ts"
import type { ToolRun } from "./agent/tools.ts"

export interface ShellHostDeps {
  store: SurfaceStore
  t: I18n["t"]
  session: HostSession
  /** Theme name from plugin config; env wins over this. */
  themeName?: string
}

/** Transcript rows are Kit's shape now; kept as a local alias. */
type TItem = TranscriptItem

const MAX_VISIBLE_ITEMS = 120
const THEME_ORDER = ["catppuccin-mocha", "default"]

/** Credential refs reported by the bare /login //logout status dump. */
const CRED_REFS = ["ZAI_CODING_CN_API_KEY", "DEEPSEEK_API_KEY", "MINIMAX_CN_API_KEY"]

/** Slash commands surfaced by the autocomplete palette (dsh-tui-pi style). */
const COMMANDS: { name: string; desc: string }[] = [
  { name: "/help", desc: "show available commands" },
  { name: "/clear", desc: "clear the transcript" },
  { name: "/usage", desc: "show token usage summary" },
  { name: "/theme", desc: "cycle theme" },
  { name: "/model", desc: "pick or switch model (/model provider/id)" },
  { name: "/login", desc: "set an api key (/login REF KEY)" },
  { name: "/logout", desc: "remove an api key (/logout REF)" },
  { name: "/quit", desc: "exit the shell" },
]

/** Uniform error text for pushed error rows. */
const errText = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 300)

export function ShellHost(props: { deps: ShellHostDeps }) {
  const t = props.deps.t
  const store = props.deps.store
  const [input, setInput] = createSignal("")
  // Caret position within the input line (0..input().length).
  const [cursor, setCursor] = createSignal(0)
  // Command history for up/down recall; historyIdx === history().length is
  // the draft slot (below the newest entry, i.e. the empty line).
  const [history, setHistory] = createSignal<string[]>([])
  const [historyIdx, setHistoryIdx] = createSignal(0)
  const [items, setItems] = createSignal<TItem[]>([])
  const [busy, setBusy] = createSignal(false)
  const [spin, setSpin] = createSignal(0)
  const [approval, setApproval] = createSignal<{ name: string; args: string } | null>(null)
  const [usage, setUsage] = createSignal({ prompt: 0, completion: 0, turns: 0 })
  const [label, setLabel] = createSignal(props.deps.session.label)
  const [snapshot, setSnapshot] = createSignal(store.snapshot)
  // Think/tool panels: hidden by default, toggled with ctrl+t / ctrl+o.
  const [showThink, setShowThink] = createSignal(false)
  const [showTool, setShowTool] = createSignal(false)
  // Which ToolPanel entry is expanded; -1 means "none" (ctrl+p cycles).
  const [toolExpanded, setToolExpanded] = createSignal(-1)
  // Model picker overlay state; up/down/enter/esc route to it while open.
  const [picker, setPicker] = createSignal<{ kind: "model" } | null>(null)
  const [pickerSel, setPickerSel] = createSignal(0)
  // Full reasoning text of the current turn: accumulated in a plain buffer,
  // mirrored into a signal so ThinkPanel re-renders without per-delta JSX.
  let reasoningBuf = ""
  const [lastReasoning, setLastReasoning] = createSignal("")
  // Theme: plugin config < env < host-mode default (catppuccin-mocha)
  const initialTheme =
    process.env.DSH_OPENTUI_THEME ?? props.deps.themeName ?? "catppuccin-mocha"
  const [themeName, setThemeName] = createSignal(
    themes[initialTheme] ? initialTheme : "catppuccin-mocha",
  )
  const theme = () => getTheme(themeName())
  // Slash palette state: menuOpen tracks an explicit esc dismissal; any
  // further input edit reopens the menu while the line starts with "/".
  const [menuOpen, setMenuOpen] = createSignal(true)
  const [menuSel, setMenuSel] = createSignal(0)

  let approveResolve: ((ok: boolean) => void) | null = null

  onMount(() => {
    onCleanup(store.subscribe(() => setSnapshot(store.snapshot)))
    const t2 = setInterval(() => setSpin((s) => (s + 1) % 4), 150)
    onCleanup(() => clearInterval(t2))
  })

  const spinner = () => ["⠋", "⠙", "⠹", "⠸"][spin()]

  // Slash palette: the menu lists COMMANDS matching the "/token" prefix of
  // the input line; it hides while busy (navigation is disabled then too).
  const filteredCommands = createMemo(() => {
    const m = /^\/(\S*)/.exec(input())
    if (!m) return []
    return COMMANDS.filter((c) => c.name.slice(1).startsWith(m[1]))
  })
  const clampedSel = createMemo(() => {
    const n = filteredCommands().length
    return n === 0 ? 0 : Math.min(menuSel(), n - 1)
  })
  const menuVisible = createMemo(() => !busy() && menuOpen() && filteredCommands().length > 0)

  // Model picker feed: the provider catalog flattened to one PickerItem
  // per model (group=provider, label=model, id="provider/model"); the row
  // matching the live session label is tagged as the current selection.
  const pickerItems = createMemo<PickerItem[]>(() => {
    const out: PickerItem[] = []
    for (const p of props.deps.session.listProviders()) {
      for (const m of p.models) {
        const id = `${p.provider}/${m}`
        out.push({ id, group: p.provider, label: m, detail: label() === id ? "current" : undefined })
      }
    }
    return out
  })

  // Tool panel feed: tool-kind transcript rows projected onto ToolPanelEntry.
  const toolEntries = createMemo<ToolPanelEntry[]>(() =>
    items()
      .filter((it): it is Extract<TItem, { kind: "tool" }> => it.kind === "tool")
      .map((it) => ({ name: it.name, args: it.args, ok: it.ok, output: it.brief })),
  )

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
      // replace the streaming item refs (not just the array) so the
      // per-item <For> re-renders them
      setItems((arr) => arr.map((x) => (x === streaming.thinking || x === streaming.reply ? { ...x } : x)))
    }
  }
  const push = (it: TItem) => setItems((arr) => [...arr, it])

  // ---- line editor: cursor-based editing + history recall ----
  /** Start of the word before `pos` (skips trailing whitespace, then the word). */
  const wordStart = (s: string, pos: number): number => {
    const cut = s.slice(0, pos).replace(/\s+$/, "").replace(/\S+$/, "").length
    return Math.min(cut, pos)
  }
  /** Return to the draft slot after any manual edit. */
  const resetHistoryNav = () => setHistoryIdx(history().length)
  /** Insert a character at the cursor. */
  const insertChar = (ch: string) => {
    const s = input()
    const c = Math.min(cursor(), s.length)
    setInput(s.slice(0, c) + ch + s.slice(c))
    setCursor(c + ch.length)
    resetHistoryNav()
  }
  /** Record a submitted line in history (dedupe consecutive duplicates). */
  const commitHistory = (text: string) => {
    if (!text) return
    const h = history()
    const next = h[h.length - 1] === text ? h : [...h, text]
    setHistory(next)
    setHistoryIdx(next.length)
  }
  /** up/down recall; the draft slot (index === length) restores the empty line. */
  const historyNav = (dir: -1 | 1) => {
    const h = history()
    if (h.length === 0) return
    let idx = Math.min(historyIdx(), h.length)
    if (dir === -1 && idx > 0) idx -= 1
    else if (dir === 1 && idx < h.length) idx += 1
    else return
    setHistoryIdx(idx)
    const text = idx === h.length ? "" : h[idx]
    setInput(text)
    setCursor(text.length)
  }

  /** Push one "REF: configured|missing" system row per common credential ref. */
  const pushCredStatus = async () => {
    for (const ref of CRED_REFS) {
      try {
        const st = await props.deps.session.credentialStatus(ref)
        push({
          kind: "system",
          text: t("cmd.cred.status", {
            ref,
            status: st.configured ? t("cmd.cred.configured") : t("cmd.cred.missing"),
          }),
        })
      } catch (e) {
        push({ kind: "error", text: `${ref}: ${errText(e)}` })
      }
    }
  }

  /** Execute a "/cmd ..." input line (shared by Enter and the palette).
   * Async because /login //logout await host credential services; callers
   * fire-and-forget it (void runCommand(...)). */
  async function runCommand(text: string) {
    const parts = text.slice(1).trim().split(/\s+/)
    const cmd = parts[0]
    const arg = parts.slice(1).join(" ")
    if (cmd === "quit" || cmd === "exit") process.exit(0)
    if (cmd === "help" || cmd === "?") {
      push({ kind: "system", text: t("cmd.help.lines") })
    } else if (cmd === "clear") {
      setItems([])
      push({ kind: "system", text: t("cmd.cleared") })
    } else if (cmd === "usage") {
      const u = usage()
      push({ kind: "system", text: `${t("cmd.usage.summary")}: ${u.turns} turns · prompt ${u.prompt} · completion ${u.completion} tokens` })
    } else if (cmd === "theme") {
      const i = THEME_ORDER.indexOf(themeName())
      const next = THEME_ORDER[(i + 1) % THEME_ORDER.length]
      setThemeName(next)
      push({ kind: "system", text: `theme → ${next}` })
    } else if (cmd === "model") {
      if (!arg) {
        // Bare /model opens the Picker overlay instead of printing the list.
        setPickerSel(0)
        setPicker({ kind: "model" })
      } else {
        const [provider, model] = arg.split("/")
        if (!provider || !model) {
          push({ kind: "error", text: "usage: /model provider/model-id" })
        } else {
          props.deps.session.switchModel(provider, model)
          setLabel(props.deps.session.label)
          push({ kind: "system", text: `${t("cmd.model.set")} ${provider}/${model} ${t("cmd.model.next")}` })
        }
      }
    } else if (cmd === "login") {
      if (parts.length === 3) {
        try {
          await props.deps.session.login(parts[1], parts[2])
          push({ kind: "system", text: t("cmd.login.saved", { ref: parts[1] }) })
        } catch (e) {
          push({ kind: "error", text: errText(e) })
        }
      } else if (parts.length === 1) {
        await pushCredStatus()
      } else {
        push({ kind: "error", text: t("cmd.login.usage") })
      }
    } else if (cmd === "logout") {
      if (parts.length === 2) {
        try {
          await props.deps.session.logout(parts[1])
          push({ kind: "system", text: t("cmd.logout.done", { ref: parts[1] }) })
        } catch (e) {
          push({ kind: "error", text: errText(e) })
        }
      } else if (parts.length === 1) {
        await pushCredStatus()
      } else {
        push({ kind: "error", text: t("cmd.logout.usage") })
      }
    } else {
      push({ kind: "system", text: `unknown command: /${cmd} (try /help)` })
    }
  }

  async function send(text: string) {
    if (busy()) return
    push({ kind: "user", text })
    setBusy(true)
    let thinkingItem: Extract<TItem, { kind: "thinking" }> | null = null
    let replyItem: Extract<TItem, { kind: "assistant" }> | null = null
    streaming = {}
    // A fresh turn replaces the think panel's contents.
    reasoningBuf = ""
    setLastReasoning("")
    try {
      await props.deps.session.turn(
        text,
        {
          onThinkingDelta: (s: string) => {
            if (!thinkingItem) {
              thinkingItem = { kind: "thinking", tail: "", chars: 0 }
              streaming.thinking = thinkingItem
              push(thinkingItem)
            }
            thinkingItem.tail = (thinkingItem.tail + s).split("\n").slice(-2).join(" ")
            thinkingItem.chars += s.length
            reasoningBuf += s
            setLastReasoning(reasoningBuf)
            bumpSoon()
          },
          onContentDelta: (s: string) => {
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
          onTurnEnd: (u: { prompt: number; completion: number }) => {
            if (replyItem) {
              const final: TItem = { ...replyItem, final: true }
              setItems((arr) => arr.map((x) => (x === replyItem ? final : x)))
            }
            setLabel(props.deps.session.label)
            setUsage((v) => ({ prompt: v.prompt + u.prompt, completion: v.completion + u.completion, turns: v.turns + 1 }))
          },
          onApprove: (name: string, args: Record<string, unknown>) => {
            setApproval({ name, args: JSON.stringify(args) })
            return new Promise<boolean>((resolve) => {
              approveResolve = resolve
            })
          },
          onToolRun: (run: ToolRun) => {
            const brief = run.output.split("\n").slice(-3).join(" ⏎ ").slice(0, 200)
            push({ kind: "tool", name: run.name, args: run.argsPretty, ok: run.ok, brief })
          },
          onError: (msg: string) => push({ kind: "error", text: msg }),
        },
      )
    } catch (e) {
      push({ kind: "error", text: errText(e) })
    } finally {
      setApproval(null)
      approveResolve = null
      setBusy(false)
    }
  }

  useKeyboard((key) => {
    if (process.env.DSH_OPENTUI_DEBUG) {
      import("node:fs").then((fs) => fs.appendFileSync("/tmp/host-keys.log", JSON.stringify({ name: key.name, seq: key.sequence }) + "\n")).catch(() => {})
    }
    if (key.sequence === "\x03" || ((key.name === "c" || key.name === "C") && key.ctrl)) process.exit(0)
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
    // Model picker overlay (modal): owns up/down/enter/esc while open —
    // up/down move the highlight, they never recall history.
    if (picker()) {
      const n = pickerItems().length
      if (key.name === "up" || key.name === "down") {
        if (n > 0) setPickerSel((s) => (key.name === "up" ? (s - 1 + n) % n : (s + 1) % n))
      } else if (key.name === "return") {
        const item = n > 0 ? pickerItems()[Math.min(pickerSel(), n - 1)] : undefined
        setPicker(null)
        setPickerSel(0)
        if (item) {
          const [provider, model] = item.id.split("/")
          if (provider && model) {
            props.deps.session.switchModel(provider, model)
            setLabel(props.deps.session.label)
            push({ kind: "system", text: `${t("cmd.model.set")} ${item.id} ${t("cmd.model.next")}` })
          }
        }
      } else if (key.name === "escape") {
        setPicker(null)
        setPickerSel(0)
      }
      return
    }
    // Panel hotkeys — routed after approval/picker, ahead of the busy gate,
    // so panel inspection works in any idle state (and even mid-turn).
    if (key.ctrl && key.name === "t") {
      setShowThink((v) => !v)
      return
    }
    if (key.ctrl && key.name === "o") {
      setShowTool((v) => !v)
      return
    }
    if (key.ctrl && key.name === "p") {
      // Cycle the expanded ToolPanel entry: -1 (none) → 0 → … → n-1 → -1.
      const n = toolEntries().length
      if (n > 0) setToolExpanded((v) => (v + 1 >= n ? -1 : v + 1))
      return
    }
    if (busy()) return
    // Slash palette keys: arrows move the highlight (disabled while busy
    // via the early return above), tab completes, enter runs, esc closes.
    if (menuVisible() && (key.name === "up" || key.name === "down")) {
      const n = filteredCommands().length
      setMenuSel((s) => (key.name === "up" ? (s - 1 + n) % n : (s + 1) % n))
      return
    }
    // History recall on up/down — but a "/" line keeps the palette in
    // charge of those keys even when the menu is not visible.
    if (key.name === "up" || key.name === "down") {
      if (input().startsWith("/")) return
      return historyNav(key.name === "up" ? -1 : 1)
    }
    // Cursor movement: left/right, home/ctrl+a, end/ctrl+e.
    if (key.name === "left") return setCursor((c) => Math.max(0, c - 1))
    if (key.name === "right") return setCursor((c) => Math.min(input().length, c + 1))
    if (key.name === "home" || (key.ctrl && key.name === "a")) return setCursor(0)
    if (key.name === "end" || (key.ctrl && key.name === "e")) return setCursor(input().length)
    if (key.name === "tab") {
      const cmd = menuVisible() ? filteredCommands()[clampedSel()] : undefined
      if (cmd) {
        setInput(cmd.name + " ")
        setCursor(cmd.name.length + 1)
        resetHistoryNav()
        setMenuSel(0)
      }
      return
    }
    if (key.name === "return") {
      const text = input().trim()
      const cmd = menuVisible() ? filteredCommands()[clampedSel()] : undefined
      setInput("")
      setCursor(0)
      setMenuOpen(true)
      setMenuSel(0)
      if (cmd) {
        commitHistory(cmd.name)
        void runCommand(cmd.name)
        return
      }
      if (!text) return
      commitHistory(text)
      if (text.startsWith("/")) {
        void runCommand(text)
        return
      }
      send(text)
      return
    }
    if (key.name === "backspace") {
      const c = cursor()
      if (c > 0) {
        const s = input()
        setInput(s.slice(0, c - 1) + s.slice(c))
        setCursor(c - 1)
        resetHistoryNav()
        setMenuOpen(true)
        setMenuSel(0)
      }
      return
    }
    // delete / ctrl+d: remove the character under the caret.
    if (key.name === "delete" || (key.ctrl && key.name === "d")) {
      const c = cursor()
      const s = input()
      if (c < s.length) {
        setInput(s.slice(0, c) + s.slice(c + 1))
        resetHistoryNav()
        setMenuOpen(true)
        setMenuSel(0)
      }
      return
    }
    // ctrl+u: clear the whole line; ctrl+w: kill the word before the caret.
    if (key.ctrl && key.name === "u") {
      setInput("")
      setCursor(0)
      resetHistoryNav()
      setMenuOpen(true)
      setMenuSel(0)
      return
    }
    if (key.ctrl && key.name === "w") {
      const c = cursor()
      const cut = wordStart(input(), c)
      if (cut < c) {
        const s = input()
        setInput(s.slice(0, cut) + s.slice(c))
        setCursor(cut)
        resetHistoryNav()
        setMenuOpen(true)
        setMenuSel(0)
      }
      return
    }
    if (key.name === "escape") {
      if (menuVisible()) return setMenuOpen(false)
      setInput("")
      setCursor(0)
      return
    }
    const ch = key.sequence
    if (ch && ch.length === 1 && !key.ctrl && !key.meta && !/[\x00-\x1f]/.test(ch)) {
      insertChar(ch)
      setMenuOpen(true)
      setMenuSel(0)
    }
  })

  const widgets = () => snapshot().filter((d): d is SurfaceWidgetDecl => d.kind === "widget")
  const th = () => theme()

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ flexDirection: "column", flexGrow: 1, padding: 1 }}>
        <Transcript
          items={visibleItems()}
          theme={theme()}
          t={t}
          spinnerFrame={spinner()}
          mdStyle={mdStyle}
        />
      </box>
      {showTool() ? (
        <ToolPanel entries={toolEntries()} theme={th()} expandedIndex={toolExpanded()} />
      ) : null}
      {showThink() ? <ThinkPanel text={lastReasoning()} theme={th()} /> : null}
      <For each={approval() ? [approval()!] : []}>
        {(ap) => (
          <ApprovalCard toolName={ap.name} args={ap.args} hint={t("agent.approve.hint")} theme={th()} />
        )}
      </For>
      {picker() ? (
        <Picker
          title={t("picker.model.title")}
          items={pickerItems()}
          selected={pickerSel()}
          theme={th()}
          maxRows={8}
        />
      ) : null}
      <For each={menuVisible() ? [0] : []}>
        {() => (
          <box style={{ border: true, borderColor: th().tokens.border, flexDirection: "column", padding: 0 }}>
            <For each={filteredCommands()}>
              {(c, i) => (
                <text style={{ fg: i() === clampedSel() ? th().tokens.accent : undefined }}>
                  {i() === clampedSel() ? "› " : "  "}
                  {c.name}  {c.desc}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
      <InputLine
        value={input()}
        cursor={cursor()}
        busy={busy()}
        spinnerFrame={spinner()}
        placeholder={t("shell.input.placeholder")}
        busyLabel={t("shell.input.busy")}
        theme={th()}
      />
      <FooterHints theme={th()} />
      <StatusBar
        widgets={[
          { kind: "widget", slot: "status", id: "model", order: 10, parts: [{ text: label(), color: th().tokens.accent }] },
          { kind: "widget", slot: "status", id: "usage", order: 20, parts: [{ text: `p${usage().prompt}/c${usage().completion}`, dim: true }] },
          ...widgets(),
        ]}
      />
    </box>
  )
}
