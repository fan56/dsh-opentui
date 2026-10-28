/**
 * ShellHost — the Shell driving a HostSession (the real dsh host inside
 * this process). dsh-tui-pi-style affordances: slash palette with
 * autocomplete, themes, footer hints, markdown-ish transcript with
 * left-rail tool blocks, live /model switching across host providers.
 */
import { For, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { StatusBar, getTheme, themes, type I18n, type Theme } from "@dsh-opentui/kit"
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

type TItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "thinking"; tail: string; chars: number }
  | { kind: "tool"; name: string; args: string; ok: boolean; brief: string }
  | { kind: "error"; text: string }
  | { kind: "system"; text: string }

const MAX_VISIBLE_LINES = 200
const THEME_ORDER = ["catppuccin-mocha", "default"]

/** Slash commands surfaced by the autocomplete palette (dsh-tui-pi style). */
const COMMANDS: { name: string; desc: string }[] = [
  { name: "/help", desc: "show available commands" },
  { name: "/clear", desc: "clear the transcript" },
  { name: "/usage", desc: "show token usage summary" },
  { name: "/theme", desc: "cycle theme" },
  { name: "/model", desc: "show or switch model (/model provider/id)" },
  { name: "/quit", desc: "exit the shell" },
]

/** Hint strip rendered above the status bar (dsh-tui-pi style). */
const footerHints: { key: string; label: string }[] = [
  { key: "enter", label: "send" },
  { key: "y/n", label: "approve" },
  { key: "esc", label: "abort" },
  { key: "/help", label: "commands" },
  { key: "ctrl+c", label: "quit" },
]

/** Minimal markdown-ish transcript rendering: headings pop, fenced code
 * blocks get a dim left rail, everything else passes through. */
function renderAssistant(text: string, theme: Theme): { text: string; fg?: string }[] {
  const out: { text: string; fg?: string }[] = []
  let inFence = false
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1")
    if (/^```/.test(line)) {
      inFence = !inFence
      out.push({ text: inFence ? "┌─" : "└─", fg: theme.tokens.dim })
      continue
    }
    if (inFence) {
      out.push({ text: `│ ${line}`, fg: theme.tokens.dim })
      continue
    }
    const heading = /^(#{1,3})\s+(.*)/.exec(line)
    if (heading) out.push({ text: heading[2], fg: theme.tokens.accent })
    else out.push({ text: line })
  }
  return out
}

export function ShellHost(props: { deps: ShellHostDeps }) {
  const t = props.deps.t
  const store = props.deps.store
  const [input, setInput] = createSignal("")
  const [items, setItems] = createSignal<TItem[]>([])
  const [busy, setBusy] = createSignal(false)
  const [spin, setSpin] = createSignal(0)
  const [approval, setApproval] = createSignal<{ name: string; args: string } | null>(null)
  const [usage, setUsage] = createSignal({ prompt: 0, completion: 0, turns: 0 })
  const [label, setLabel] = createSignal(props.deps.session.label)
  const [snapshot, setSnapshot] = createSignal(store.snapshot)
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

  const lines = createMemo(() => {
    const th = theme()
    const out: { text: string; fg?: string }[] = []
    for (const it of items()) {
      if (it.kind === "user") {
        out.push({ text: `❯ ${it.text}`, fg: th.tokens.userMark ?? th.tokens.accent })
      } else if (it.kind === "assistant") {
        out.push(...renderAssistant(it.text, th))
        out.push({ text: "" })
      } else if (it.kind === "thinking") {
        out.push({ text: `${spinner()} ${t("agent.thinking")} (${it.chars}) ${it.tail.slice(-120)}`, fg: th.tokens.dim })
      } else if (it.kind === "tool") {
        out.push({ text: ` ⚒ ${it.name} ${it.args.slice(0, 90)}`, fg: th.tokens.toolOk ?? th.tokens.warn })
        out.push({ text: ` ⎿ ${it.ok ? t("agent.tool.ok") : t("agent.tool.fail")}: ${it.brief.slice(0, 110)}`, fg: it.ok ? th.tokens.dim : th.tokens.toolFail ?? th.tokens.danger })
      } else if (it.kind === "error") {
        out.push({ text: `✗ ${t("agent.error")}: ${it.text}`, fg: th.tokens.danger })
      } else if (it.kind === "system") {
        out.push({ text: `· ${it.text}`, fg: th.tokens.dim })
      }
    }
    return out.slice(-MAX_VISIBLE_LINES)
  })

  let lastBump = 0
  const bumpSoon = () => {
    const now = Date.now()
    if (now - lastBump > 60) {
      lastBump = now
      setItems((arr) => [...arr])
    }
  }
  const push = (it: TItem) => setItems((arr) => [...arr, it])

  /** Execute a "/cmd ..." input line (shared by Enter and the palette). */
  function runCommand(text: string) {
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
        push({ kind: "system", text: `model: ${props.deps.session.label}` })
        const catalog = props.deps.session.listProviders()
        for (const p of catalog) {
          push({ kind: "system", text: `  ${p.provider}: ${p.models.slice(0, 8).join(", ")}${p.models.length > 8 ? ` …(+${p.models.length - 8})` : ""}` })
        }
        push({ kind: "system", text: "switch: /model provider/model-id (applies to the next message)" })
      } else {
        const [provider, model] = arg.split("/")
        if (!provider || !model) {
          push({ kind: "error", text: "usage: /model provider/model-id" })
        } else {
          props.deps.session.switchModel(provider, model)
          setLabel(props.deps.session.label)
          push({ kind: "system", text: `model → ${provider}/${model} (next message)` })
        }
      }
    } else {
      push({ kind: "system", text: `unknown command: /${cmd} (try /help)` })
    }
  }

  async function send(text: string) {
    if (busy()) return
    push({ kind: "user", text })
    setBusy(true)
    let thinkingItem: { kind: "thinking"; tail: string; chars: number } | null = null
    let replyItem: { kind: "assistant"; text: string } | null = null
    try {
      await props.deps.session.turn(
        text,
        {
          onThinkingDelta: (s: string) => {
            if (!thinkingItem) {
              thinkingItem = { kind: "thinking", tail: "", chars: 0 }
              push(thinkingItem)
            }
            thinkingItem.tail = (thinkingItem.tail + s).split("\n").slice(-2).join(" ")
            thinkingItem.chars += s.length
            bumpSoon()
          },
          onContentDelta: (s: string) => {
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
          onTurnEnd: (u: { prompt: number; completion: number }) => {
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
      push({ kind: "error", text: String(e instanceof Error ? e.message : e).slice(0, 300) })
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
    if (busy()) return
    // Slash palette keys: arrows move the highlight (disabled while busy
    // via the early return above), tab completes, enter runs, esc closes.
    if (menuVisible() && (key.name === "up" || key.name === "down")) {
      const n = filteredCommands().length
      setMenuSel((s) => (key.name === "up" ? (s - 1 + n) % n : (s + 1) % n))
      return
    }
    if (key.name === "tab") {
      const cmd = menuVisible() ? filteredCommands()[clampedSel()] : undefined
      if (cmd) {
        setInput(cmd.name + " ")
        setMenuSel(0)
      }
      return
    }
    if (key.name === "return") {
      const text = input().trim()
      const cmd = menuVisible() ? filteredCommands()[clampedSel()] : undefined
      setInput("")
      setMenuOpen(true)
      setMenuSel(0)
      if (cmd) {
        runCommand(cmd.name)
        return
      }
      if (!text) return
      if (text.startsWith("/")) {
        runCommand(text)
        return
      }
      send(text)
      return
    }
    if (key.name === "backspace") {
      setInput((s) => s.slice(0, -1))
      setMenuOpen(true)
      setMenuSel(0)
      return
    }
    if (key.name === "escape") {
      if (menuVisible()) return setMenuOpen(false)
      return setInput("")
    }
    const ch = key.sequence
    if (ch && ch.length === 1 && !key.ctrl && !key.meta && !/[\x00-\x1f]/.test(ch)) {
      setInput((s) => s + ch)
      setMenuOpen(true)
      setMenuSel(0)
    }
  })

  const widgets = () => snapshot().filter((d): d is SurfaceWidgetDecl => d.kind === "widget")
  const th = () => theme()

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ flexDirection: "column", flexGrow: 1, padding: 1 }}>
        <For each={lines()} fallback={<text style={{ fg: th().tokens.dim }}>{t("shell.transcript.empty")}</text>}>
          {(l) => <text style={l.fg ? { fg: l.fg } : {}}>{l.text || " "}</text>}
        </For>
      </box>
      <For each={approval() ? [approval()!] : []}>
        {(ap) => (
          <box style={{ border: true, borderColor: th().tokens.approvalBorder ?? th().tokens.warn, flexDirection: "column", padding: 1 }}>
            <text style={{ fg: th().tokens.warn }}>⚠ {t("agent.approve.title")}: {ap.name}</text>
            <text>{ap.args.slice(0, 200)}</text>
            <text style={{ fg: th().tokens.dim }}>{t("agent.approve.hint")}</text>
          </box>
        )}
      </For>
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
      <box style={{ border: true, borderColor: th().tokens.border, flexDirection: "row" }}>
        <text style={{ fg: th().tokens.accent }}>{busy() ? `${spinner()} ` : "❯ "}</text>
        <text style={{ fg: input() ? th().tokens.text : th().tokens.dim }}>
          {busy() ? t("shell.input.busy") : input() || t("shell.input.placeholder")}
        </text>
      </box>
      <box style={{ flexDirection: "row", paddingLeft: 2, paddingRight: 2 }}>
        <For each={footerHints}>
          {(h, i) => (
            <text style={{ fg: th().tokens.dim }}>
              {i() > 0 ? " · " : ""}
              {h.key} {h.label}
            </text>
          )}
        </For>
      </box>
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
