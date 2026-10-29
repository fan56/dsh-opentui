/**
 * ShellHost — the Shell driving a HostSession (the real dsh host inside
 * this process). Clean-transcript philosophy: thinking and tool traffic
 * NEVER enter the message flow — they are collected in the dock widgets
 * above the input, auto-expanding while the turn runs and collapsing to a
 * dim one-liner when it ends. The input line stays unlocked while busy:
 * enter mid-turn STEERS the running agent (⚡-prefixed messages) instead
 * of queueing. All visuals come from @dsh-opentui/kit — this file owns
 * state and keyboard routing only.
 */
import { For, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { SyntaxStyle } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { getTheme, themeNames, themes, type I18n } from "@dsh-opentui/kit"
import { Transcript, InputLine, FooterHints, ApprovalCard, type TranscriptItem } from "@dsh-opentui/kit"
import { WelcomeBanner, PowerlineFooter, POWERLINE_COLORS, speedSegment, type PowerlineSegment } from "@dsh-opentui/kit"
import { ThinkWidget, ToolWidget, type ThinkWidgetState, type ToolWidgetEntry } from "@dsh-opentui/kit"
import { AutoScroll, Select, type SelectItem, TodosWidget, type TodoItem } from "@dsh-opentui/kit"
import type { SurfaceStore } from "@dsh-opentui/runtime"
import type { HostSession } from "./host-session.ts"
import type { ToolRun } from "./agent/tools.ts"

export interface ShellHostDeps {
  /** Reserved: surface widgets are not shown by this host (the powerline
   * footer replaced the StatusBar slot rendering); kept for host-entry. */
  store: SurfaceStore
  t: I18n["t"]
  session: HostSession
  /** Theme name from plugin config; env wins over this. */
  themeName?: string
}

/** Transcript rows: the CLEAN subset of Kit's shape — thinking and tool
 * traffic lives in the dock widgets, never in the message flow. */
type TItem = Extract<TranscriptItem, { kind: "user" | "assistant" | "error" | "system" }>

/** Answer plumbing for the host ask overlay. */
type AskResolve = (v: { questionId: string; selected: string }[] | "declined") => void

/** Modal Select overlays. While one is open the native <select> owns the
 * arrow/enter keys (it is focused); escape bubbles out and closes it. */
type Overlay =
  | { kind: "model" } // items come from the reactive modelItems catalog
  | { kind: "sessions"; items: SelectItem[] }
  | { kind: "effort"; provider: string; model: string }
  | { kind: "theme"; items: SelectItem[] }
  | { kind: "ask"; title: string; questionId: string; items: SelectItem[]; resolve: AskResolve }

/** Credential refs reported by the bare /login //logout status dump. */
const CRED_REFS = ["ZAI_CODING_CN_API_KEY", "DEEPSEEK_API_KEY", "MINIMAX_CN_API_KEY"]

/** Reasoning-effort ladder offered after a model pick ("keep" = default). */
const EFFORTS = ["keep", "low", "medium", "high", "xhigh", "max"]

/** Context window assumed by the powerline 🧠 segment. */
const CONTEXT_WINDOW_TOKENS = 128000

/** Slash commands surfaced by the autocomplete palette (dsh-tui-pi style). */
const COMMANDS: { name: string; desc: string }[] = [
  { name: "/help", desc: "show available commands" },
  { name: "/clear", desc: "clear the transcript" },
  { name: "/usage", desc: "show token usage summary" },
  { name: "/new", desc: "start a fresh session" },
  { name: "/sessions", desc: "list and resume stored sessions" },
  { name: "/theme", desc: "pick theme" },
  { name: "/model", desc: "pick or switch model (/model provider/id)" },
  { name: "/login", desc: "set an api key (/login REF KEY)" },
  { name: "/logout", desc: "remove an api key (/logout REF)" },
  { name: "/attach", desc: "attach an image to the next message (/attach path)" },
  { name: "/quit", desc: "exit the shell" },
]

/** Uniform error text for pushed error rows. */
const errText = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 300)

/** 24h clock HH:MM:SS for the powerline footer's right side. */
const fmtClock = () => {
  const d = new Date()
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":")
}

export function ShellHost(props: { deps: ShellHostDeps }) {
  const t = props.deps.t
  const [input, setInput] = createSignal("")
  // Command history for up/down recall; historyIdx === history().length is
  // the draft slot (below the newest entry, i.e. the empty line).
  const [history, setHistory] = createSignal<string[]>([])
  const [historyIdx, setHistoryIdx] = createSignal(0)
  // Editor buffer control (InputLine v2): resetKey bump = full clear (for
  // /clear); setKey bump = replace the buffer with setValueText (history
  // recall + post-submit clear).
  const [resetKey, setResetKey] = createSignal(0)
  const [setKey, setSetKey] = createSignal(0)
  const [setValueText, setSetValueText] = createSignal("")
  const [items, setItems] = createSignal<TItem[]>([])
  const [busy, setBusy] = createSignal(false)
  const [approval, setApproval] = createSignal<{ name: string; args: string } | null>(null)
  const [usage, setUsage] = createSignal({ prompt: 0, completion: 0, turns: 0 })
  const [label, setLabel] = createSignal(props.deps.session.label)
  // Welcome banner: shown until the first real message is sent.
  const [showWelcome, setShowWelcome] = createSignal(true)
  // Dock widgets (clean transcript): live thinking state + tool ledger.
  const [thinkState, setThinkState] = createSignal<ThinkWidgetState>({ active: false, text: "", elapsed: 0 })
  const [toolEntries, setToolEntries] = createSignal<ToolWidgetEntry[]>([])
  // Detail re-expand: after a turn collapses the docks, ctrl+t / ctrl+o
  // re-open the last thought / tool ledger in their expanded form.
  const [thinkExpanded, setThinkExpanded] = createSignal(false)
  const [toolExpanded, setToolExpanded] = createSignal(false)
  // Agent todo list (host todo tool's todo/write snapshots; the host
  // projection clears them at every turn start) and subagent activity rows
  // (tool-workflow/agent-start/end pairs keyed runId:seq).
  const [todos, setTodos] = createSignal<TodoItem[]>([])
  const [agentRows, setAgentRows] = createSignal<{ key: string; label: string; status: string; elapsed: number }[]>([])
  // Modal Select overlay (model/sessions/effort/ask); see the Overlay type.
  const [overlay, setOverlay] = createSignal<Overlay | null>(null)
  // Model catalog for the Select (reactive: the host list loads async).
  const [modelItems, setModelItems] = createSignal<SelectItem[]>([])
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
  // 24h wall clock for the powerline right side.
  const [clock, setClock] = createSignal(fmtClock())
  // Live streaming speed for the powerline ⚡ segment (chars/4 estimate
  // over elapsed time; shown only while a turn is running).
  const [liveTps, setLiveTps] = createSignal<number | null>(null)
  let turnStartAt = 0

  let approveResolve: ((ok: boolean) => void) | null = null

  onMount(() => {
    // One 1s heartbeat drives the dock widgets' elapsed counters (think
    // seconds, running-tool spinner) and the powerline clock.
    const tick = setInterval(() => {
      setClock(fmtClock())
      setThinkState((s) => (s.active ? { ...s, elapsed: s.elapsed + 1 } : s))
      setToolEntries((arr) =>
        arr.some((e) => e.status === "running")
          ? arr.map((e) => (e.status === "running" ? { ...e, elapsed: (e.elapsed ?? 0) + 1 } : e))
          : arr,
      )
      setAgentRows((arr) =>
        arr.some((r) => r.status === "running")
          ? arr.map((r) => (r.status === "running" ? { ...r, elapsed: r.elapsed + 1 } : r))
          : arr,
      )
    }, 1000)
    onCleanup(() => clearInterval(tick))
    // Answer host user-questions with the ask overlay (first question with
    // options becomes a Select; esc declines). Disabled via env for bisection.
    if (!process.env.DSH_OPENTUI_NO_ASK) props.deps.session.registerAskProvider(async (questions) => {
      const answer = await new Promise<{ questionId: string; selected: string }[] | "declined">((resolve) => {
        const q0 = questions[0]
        const options = q0?.options ?? []
        if (!q0 || options.length === 0) {
          resolve("declined")
          return
        }
        setOverlay({
          kind: "ask",
          title: `${t("ask.title")}: ${q0.prompt}`.slice(0, 70),
          questionId: q0.id,
          items: options.map((o) => ({ label: o, value: o })),
          resolve,
        })
      })
      if (answer === "declined") throw new Error("declined")
      return answer
    })
  })

  // Slash palette: the menu lists COMMANDS matching the "/token" prefix of
  // the input line. Usable mid-turn too — the line is never locked.
  const filteredCommands = createMemo(() => {
    const m = /^\/(\S*)/.exec(input())
    if (!m) return []
    return COMMANDS.filter((c) => c.name.slice(1).startsWith(m[1]))
  })
  const clampedSel = createMemo(() => {
    const n = filteredCommands().length
    return n === 0 ? 0 : Math.min(menuSel(), n - 1)
  })
  const menuVisible = createMemo(() => menuOpen() && filteredCommands().length > 0)

  // Model Select feed: the provider catalog flattened to one SelectItem
  // per model (group=provider, label=model, value="provider/model"); the
  // row matching the live session label is tagged as the current one.
  const refreshModelItems = () => {
    void props.deps.session.listProviders().then((catalog) => {
      const out: SelectItem[] = []
      for (const p of catalog) {
        for (const m of p.models) {
          const id = `${p.provider}/${m}`
          out.push({ label: m, group: p.provider, value: id, ...(label() === id ? { description: t("cmd.model.current") } : {}) })
        }
      }
      setModelItems(out)
    })
  }
  onMount(refreshModelItems)

  const effortItems = (): SelectItem[] =>
    EFFORTS.map((e) => ({ label: e, value: e, description: t(`picker.effort.${e}.desc`) }))

  // The active overlay's rows/title, by kind.
  const overlayItems = createMemo<SelectItem[]>(() => {
    const ov = overlay()
    if (!ov) return []
    if (ov.kind === "model") return modelItems()
    if (ov.kind === "effort") return effortItems()
    return ov.items
  })
  const overlayTitle = () => {
    const ov = overlay()
    if (!ov) return ""
    if (ov.kind === "model") return t("picker.model.title")
    if (ov.kind === "sessions") return t("picker.sessions.title")
    if (ov.kind === "theme") return t("picker.theme.title")
    if (ov.kind === "effort") return t("picker.effort.title", { model: ov.model })
    return ov.title
  }

  /** Enter inside the overlay Select: hand the picked value to whichever
   * flow opened it (the native select already consumed the keypress). */
  const onOverlaySelect = (value: string) => {
    const ov = overlay()
    setOverlay(null)
    if (!ov) return
    if (ov.kind === "model") {
      // two-stage: picked a model, now ask for the reasoning effort
      const [provider, model] = value.split("/")
      if (provider && model) setOverlay({ kind: "effort", provider, model })
      return
    }
    if (ov.kind === "effort") {
      const effort = value === "keep" ? undefined : value
      props.deps.session.switchModel(ov.provider, ov.model, effort)
      setLabel(props.deps.session.label)
      push({ kind: "system", text: `${t("cmd.model.set")} ${ov.provider}/${ov.model}${effort ? ` (${effort})` : ""} ${t("cmd.model.next")}` })
      return
    }
    if (ov.kind === "theme") {
      setThemeName(value)
      push({ kind: "system", text: `theme → ${value}` })
      return
    }
    if (ov.kind === "sessions") {
      const item = ov.items.find((s) => s.value === value)
      props.deps.session.resumeSession(value)
      push({ kind: "system", text: `${t("cmd.sessions.resumed")}: ${item?.label ?? value.slice(0, 8)}` })
      return
    }
    ov.resolve([{ questionId: ov.questionId, selected: value }])
  }

  /** Esc inside the overlay Select (also idempotent for the Select's own
   * onCancel wiring, which fires for the same keypress). */
  const onOverlayCancel = () => {
    const ov = overlay()
    setOverlay(null)
    if (ov?.kind === "ask") ov.resolve("declined")
  }

  // markdown style for finalized assistant messages (best-effort: the
  // intrinsic tolerates undefined, code blocks then render unstyled)
  const rendererCtx = useRenderer()
  let mdStyle: any
  try {
    mdStyle = SyntaxStyle.create(rendererCtx as any)
  } catch {
    mdStyle = undefined
  }

  // ---- streaming buffers (clean transcript) ----
  // Full reasoning text of the current turn, flushed into thinkState at a
  // throttled cadence; the assistant reply row is bumped the same way.
  let thinkBuf = ""
  let streamingReply: TItem | null = null
  let lastBump = 0
  const bumpSoon = () => {
    const now = Date.now()
    if (now - lastBump < 60) return
    lastBump = now
    if (thinkBuf !== thinkState().text) setThinkState((prev) => ({ ...prev, text: thinkBuf }))
    // replace the streaming reply ref (not just the array) so the
    // per-item <For> re-renders it
    if (streamingReply) setItems((arr) => arr.map((x) => (x === streamingReply ? { ...x } : x)))
  }
  const push = (it: TItem) => setItems((arr) => [...arr, it])

  // ---- input flow: submission + history recall (buffer lives in InputLine) ----
  /** Record a submitted line in history (dedupe consecutive duplicates). */
  const commitHistory = (text: string) => {
    if (!text) return
    const h = history()
    const next = h[h.length - 1] === text ? h : [...h, text]
    setHistory(next)
    setHistoryIdx(next.length)
  }
  /** Replace the editor buffer (undoable, cursor at end). */
  const setBuffer = (text: string) => {
    setSetValueText(text)
    setSetKey((k) => k + 1)
    setInput(text)
  }
  /** up/down recall at the editor's first/last line; the draft slot
   * (index === length) restores the empty buffer. Returns whether the key
   * was consumed (InputLine then suppresses its cursor move). */
  const historyNav = (dir: "up" | "down"): boolean => {
    const h = history()
    if (h.length === 0) return false
    let idx = Math.min(historyIdx(), h.length)
    if (dir === "up" && idx > 0) idx -= 1
    else if (dir === "down" && idx < h.length) idx += 1
    else return false
    setHistoryIdx(idx)
    setBuffer(idx === h.length ? "" : h[idx]!)
    return true
  }
  /** Clear the editor buffer without touching history (post-submit / clear). */
  const clearBuffer = () => setBuffer("")

  /** Enter on the editor: palette entry executes, "/" lines run as
   * commands, plain text sends (or STEERS when a turn is running). */
  const submitLine = () => {
    const text = input().trim()
    const cmd = menuVisible() ? filteredCommands()[clampedSel()] : undefined
    setMenuOpen(true)
    setMenuSel(0)
    if (cmd) {
      // a typed line with arguments beats the bare highlighted command —
      // "/model provider/id" must not be hijacked by the palette's "/model"
      const full = text === cmd.name || !text.startsWith("/") ? cmd.name : text
      commitHistory(full)
      clearBuffer()
      void runCommand(full)
      return
    }
    if (!text) return
    commitHistory(text)
    clearBuffer()
    if (text.startsWith("/")) {
      void runCommand(text)
      return
    }
    // Steering: mid-turn enter injects into the running turn instead of
    // waiting for it to finish.
    if (busy()) return steerText(text)
    send(text)
  }

  /** Slash-palette keys consumed ahead of editor actions while the menu is
   * open (up/down highlight, tab completes, enter runs). */
  const paletteKeyFilter = (key: { name: string }): boolean => {
    if (!menuVisible()) return false
    if (key.name === "up" || key.name === "down") {
      const n = filteredCommands().length
      setMenuSel((s) => (key.name === "up" ? (s - 1 + n) % n : (s + 1) % n))
      return true
    }
    if (key.name === "tab") {
      const cmd = filteredCommands()[clampedSel()]
      if (cmd) {
        setBuffer(`${cmd.name} `)
        setMenuSel(0)
      }
      return true
    }
    if (key.name === "return") {
      submitLine()
      return true
    }
    return false
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
      setResetKey((k) => k + 1)
      push({ kind: "system", text: t("cmd.cleared") })
    } else if (cmd === "usage") {
      // Rich per-session summary (turns / prompt / completion / last-turn
      // speed) from the host session's telemetry.
      for (const line of props.deps.session.usageSummary()) push({ kind: "system", text: line })
      push({ kind: "system", text: `model: ${label()}` })
    } else if (cmd === "new") {
      props.deps.session.newSession()
      setItems([])
      push({ kind: "system", text: t("cmd.new.done") })
    } else if (cmd === "sessions") {
      const list = await props.deps.session.listSessions()
      if (!list.length) {
        push({ kind: "system", text: t("cmd.sessions.empty") })
      } else {
        setOverlay({
          kind: "sessions",
          items: list.map((x) => ({
            label: x.title || x.id.slice(0, 8),
            value: x.id,
            ...(x.updatedAt ? { description: String(x.updatedAt).slice(0, 19) } : {}),
          })),
        })
      }
    } else if (cmd === "theme") {
      // Theme picker: all shipped palettes in a Select, grouped dark/light,
      // the current one tagged in its description.
      setOverlay({
        kind: "theme",
        items: themeNames().map((x) => ({
          label: x.name,
          group: x.dark ? "dark" : "light",
          value: x.name,
          ...(x.name === themeName() ? { description: t("cmd.model.current") } : {}),
        })),
      })
    } else if (cmd === "model") {
      if (!arg) {
        // Bare /model opens the Select overlay instead of printing the list.
        refreshModelItems()
        setOverlay({ kind: "model" })
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
    } else if (cmd === "attach") {
      if (!arg) {
        push({ kind: "error", text: "usage: /attach /path/to/image.png" })
      } else {
        try {
          const desc = await props.deps.session.attachImage(arg)
          push({ kind: "system", text: `📎 attached ${desc} — sends with your next message` })
        } catch (e) {
          push({ kind: "error", text: errText(e) })
        }
      }
    } else {
      push({ kind: "system", text: `unknown command: /${cmd} (try /help)` })
    }
  }

  /** Steering: inject a message into the RUNNING turn (Kimi-style) — the
   * line stays unlocked while busy and enter feeds the agent mid-turn. */
  const steerText = (text: string) => {
    push({ kind: "user", text: `⚡ ${text}` })
    props.deps.session.steer(text)
  }

  async function send(text: string) {
    setShowWelcome(false)
    push({ kind: "user", text })
    setBusy(true)
    // Fresh dock state: the think panel expands empty; tool entries keep
    // accumulating across turns (they are the session's tool ledger). Any
    // manually re-expanded detail view closes for the new turn.
    thinkBuf = ""
    setThinkState({ active: true, text: "", elapsed: 0 })
    setThinkExpanded(false)
    setToolExpanded(false)
    setLiveTps(null)
    turnStartAt = Date.now()
    let replyItem: Extract<TItem, { kind: "assistant" }> | null = null
    streamingReply = null
    try {
      await props.deps.session.turn(
        text,
        {
          onThinkingDelta: (s: string) => {
            thinkBuf += s
            bumpSoon()
          },
          onContentDelta: (s: string) => {
            if (!replyItem) {
              replyItem = { kind: "assistant", text: "" }
              streamingReply = replyItem
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
          onStreamTick: ({ chars, at }) => {
            // live tok/s for the powerline ⚡ segment (chars/4 estimate)
            const sec = (at - turnStartAt) / 1000
            if (sec > 0.3 && chars > 0) setLiveTps(Math.round(chars / 4 / sec))
          },
          onTodos: (list) => setTodos(list),
          onAgentEvent: (e) => {
            setAgentRows((arr) => {
              const idx = arr.findIndex((r) => r.key === e.key)
              if (idx === -1) {
                if (!e.label) return arr
                return [...arr, { key: e.key, label: e.label, status: e.status, elapsed: 0 }]
              }
              return arr.map((r, i) => (i === idx ? { ...r, status: e.status } : r))
            })
          },
          onApprove: (name: string, args: Record<string, unknown>) => {
            // Only the modal card lives here; the dock entry is filed by
            // onToolStart (the tool/call event), which fires for
            // auto-allowed calls that never reach this waterfall.
            setApproval({ name, args: JSON.stringify(args) })
            return new Promise<boolean>((resolve) => {
              approveResolve = resolve
            })
          },
          onToolStart: (start) => {
            setToolEntries((arr) => [
              ...arr,
              { name: start.name, args: start.args, status: "running", elapsed: 0, ...(start.callId ? { callId: start.callId } : {}) },
            ])
          },
          onToolRun: (run: ToolRun) => {
            const brief = run.output.split("\n").slice(-2).join(" ⏎ ").slice(0, 200)
            setToolEntries((arr) => {
              // settle by callId when the pair is known, else the first
              // running entry under the same tool name
              const idx = run.callId
                ? arr.findIndex((e) => e.callId === run.callId)
                : arr.findIndex((e) => e.status === "running" && e.name === run.name)
              const settled: ToolWidgetEntry = {
                ...(run.callId ? { callId: run.callId } : {}),
                name: run.name,
                args: run.argsPretty,
                status: run.ok ? "ok" : "fail",
                output: brief,
              }
              return idx === -1 ? [...arr, settled] : arr.map((e, i) => (i === idx ? { ...e, ...settled } : e))
            })
          },
          onError: (msg: string) => push({ kind: "error", text: msg }),
        },
      )
    } catch (e) {
      push({ kind: "error", text: errText(e) })
    } finally {
      // Dock collapse: the thought folds to its summary line, entries that
      // never produced a result (declined / aborted) settle as failed.
      setThinkState((prev) => ({ ...prev, active: false, text: thinkBuf }))
      setToolEntries((arr) => arr.map((e) => (e.status === "running" ? { ...e, status: "fail" } : e)))
      setApproval(null)
      approveResolve = null
      setBusy(false)
      setLiveTps(null)
    }
  }

  // Global/modal keys ONLY — every editing key (chars, cursor moves,
  // enter-submit, history up/down, palette nav) flows through the focused
  // textarea inside InputLine (its onKeyFilter/onHistoryNav/onSubmit
  // callbacks route back into the handlers above). useKeyboard runs before
  // the focused renderable, so these handlers must never act on keys the
  // editor should own: ctrl-combos and modal-state keys only.
  useKeyboard((key) => {
    if (process.env.DSH_OPENTUI_DEBUG) {
      import("node:fs").then((fs) => fs.appendFileSync("/tmp/host-keys.log", JSON.stringify({ name: key.name, seq: key.sequence }) + "\n")).catch(() => {})
    }
    if (key.sequence === "\x03" || ((key.name === "c" || key.name === "C") && key.ctrl)) process.exit(0)
    // Approval card: y/enter allows, n/esc rejects (highest modal priority
    // — the turn is waiting on us; the editor is blurred under it).
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
    // Select overlay: the focused native select owns arrows/enter; escape
    // is the one key it leaves for us (Select maps it to onCancel too —
    // both paths close idempotently). Swallow everything else so the
    // editor and palette never react under a modal.
    if (overlay()) {
      if (key.name === "escape") onOverlayCancel()
      return
    }
    // Dock detail re-expand: ctrl+t (last thought) / ctrl+o (tool ledger)
    // re-open the collapsed dock panels; a fresh turn closes them again.
    if (key.ctrl && key.name === "t") {
      setThinkExpanded((v) => !v)
      return
    }
    if (key.ctrl && key.name === "o") {
      setToolExpanded((v) => !v)
      return
    }
    // esc closes the slash palette (the editor keeps its buffer).
    if (key.name === "escape" && menuVisible()) setMenuOpen(false)
  })

  // ---- powerline footer ----
  // provider/model/(effort) parsed back out of the live session label.
  const route = createMemo(() => {
    const m = /^([^/]+)\/(\S+?)(?:\s*\(([\w-]+)\))?$/.exec(label())
    if (!m) return { provider: label(), model: "", effort: undefined as string | undefined }
    return { provider: m[1], model: m[2], effort: m[3] }
  })
  const contextPct = createMemo(() => Math.min(99, Math.round((usage().prompt / CONTEXT_WINDOW_TOKENS) * 100)))
  const msgCount = createMemo(() => items().filter((it) => it.kind === "user" || it.kind === "assistant").length)
  const toolCount = createMemo(() => toolEntries().length)
  // ToolWidget stays expanded exactly while some entry is still running.
  const toolActive = createMemo(() => toolEntries().some((e) => e.status === "running"))
  const powerlineSegments = (): PowerlineSegment[] => {
    const r = route()
    const pct = contextPct()
    const segs: PowerlineSegment[] = [
      { text: "dsh", bg: POWERLINE_COLORS.brand },
      { text: r.provider, bg: POWERLINE_COLORS.provider },
      {
        text: `${r.model || "·"}${r.effort ? ` ◕${r.effort}` : ""}`,
        bg: POWERLINE_COLORS.thinking[r.effort ?? "high"] ?? POWERLINE_COLORS.thinking.high,
      },
      {
        text: `🧠 ${pct}%`,
        bg: pct > 80 ? POWERLINE_COLORS.contextDanger : pct > 60 ? POWERLINE_COLORS.contextOrange : pct > 40 ? POWERLINE_COLORS.contextWarn : POWERLINE_COLORS.contextOk,
      },
    ]
    if (msgCount() > 0) segs.push({ text: `💬 ${msgCount()}`, bg: POWERLINE_COLORS.messages })
    if (toolCount() > 0) segs.push({ text: `⚒ ${toolCount()}`, bg: POWERLINE_COLORS.tools })
    // Streaming speed: live while the turn runs (the closing rate lives in
    // /usage via lastTurnStats).
    const speed = speedSegment(busy() ? liveTps() : null, th())
    if (speed) segs.push(speed)
    return segs
  }

  const th = () => theme()

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      {showWelcome() ? (
        <WelcomeBanner theme={th()} model={label()} cwd={process.cwd()} />
      ) : (
        <AutoScroll>
          <Transcript items={items()} theme={th()} t={t} spinnerFrame="" mdStyle={mdStyle} />
        </AutoScroll>
      )}
      <TodosWidget todos={todos()} theme={th()} />
      <For each={agentRows()}>
        {(r) => (
          <text style={{ fg: r.status === "running" ? th().tokens.accent : th().tokens.dim }}>
            {`◇ ${r.label}${r.status === "running" ? ` · ${r.elapsed}s` : ` · ${r.status}`}`}
          </text>
        )}
      </For>
      <ThinkWidget state={{ ...thinkState(), active: thinkState().active || thinkExpanded() }} theme={th()} />
      <ToolWidget entries={toolEntries()} active={toolActive() || toolExpanded()} theme={th()} />
      {approval() ? (
        <ApprovalCard toolName={approval()!.name} args={approval()!.args} hint={t("agent.approve.hint")} theme={th()} />
      ) : null}
      {overlay() ? (
        <Select
          title={overlayTitle()}
          items={overlayItems()}
          theme={th()}
          onSelect={onOverlaySelect}
          onCancel={onOverlayCancel}
        />
      ) : null}
      {menuVisible() ? (
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
      ) : null}
      {/* busy stays false on purpose: the line is never locked — mid-turn
          typing STEERS, and the busy state reads from the dock widgets.
          The editor blurs under modals (approval/overlay) so their keys
          never leak into the buffer. */}
      <InputLine
        focused={!(approval() || overlay())}
        busy={false}
        placeholder={busy() ? t("shell.input.steer") : t("shell.input.placeholder")}
        busyLabel={t("shell.input.busy")}
        theme={th()}
        onSubmit={submitLine}
        onContentChange={(v) => {
          setInput(v)
          setMenuOpen(true)
          setMenuSel(0)
        }}
        onHistoryNav={historyNav}
        onKeyFilter={paletteKeyFilter}
        resetKey={resetKey()}
        setKey={setKey()}
        setValue={setValueText()}
      />
      <FooterHints theme={th()} />
      <PowerlineFooter left={powerlineSegments()} right={clock()} theme={th()} />
    </box>
  )
}
