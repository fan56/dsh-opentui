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
import { Transcript, TranscriptWindow, InputLine, FooterHints, ApprovalCard, type TranscriptItem } from "@dsh-opentui/kit"
import { WelcomeBanner, PowerlineFooter, POWERLINE_COLORS, speedSegment, type PowerlineSegment } from "@dsh-opentui/kit"
import { AutoScroll, Select, type SelectItem, TodosWidget, type TodoItem, SubagentWidget, type SubagentEntry } from "@dsh-opentui/kit"
import type { SurfaceStore } from "@dsh-opentui/runtime"
import type { HostSession } from "./host-session.ts"
import type { ToolRun } from "./agent/tools.ts"
import { createModelSelectFeature } from "./features/model-select.tsx"
import { createThemeSelectFeature } from "./features/theme-select.tsx"
import { createHistoryForkFeature } from "./features/history-fork.tsx"
import { createLoginFeature } from "./features/login.tsx"
import { createDockFeature } from "./features/dock.tsx"

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
/** A generic overlay request: features hand these to the Shell, which
 * knows nothing about their semantics (pure routing). The ask envelope is
 * the one special case — cancelling it must answer "declined". */
type Overlay = {
  title: string
  items: SelectItem[]
  onSelect: (value: string) => void
  ask?: { questionId: string; resolve: AskResolve }
}

/** Credential refs reported by the bare /login //logout status dump. */
const CRED_REFS = ["ZAI_CODING_CN_API_KEY", "DEEPSEEK_API_KEY", "MINIMAX_CN_API_KEY"]

/** Reasoning-effort ladder offered after a model pick ("keep" = default). */

/** Context window assumed by the powerline 🧠 segment. */
const CONTEXT_WINDOW_TOKENS = 128000

/** Slash commands surfaced by the autocomplete palette (dsh-tui-pi style). */
const COMMANDS: { name: string; desc: string }[] = [
  { name: "/help", desc: "show available commands" },
  { name: "/clear", desc: "clear the transcript" },
  { name: "/usage", desc: "show token usage summary" },
  { name: "/new", desc: "start a fresh session" },
  { name: "/sessions", desc: "list and resume stored sessions" },
  { name: "/history", desc: "fork the session at an earlier turn" },
  { name: "/preset", desc: "switch agent preset" },
  { name: "/search", desc: "full-text search sessions (/search text)" },
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
  // Agent todo list (host todo tool's todo/write snapshots; the host
  // projection clears them at every turn start) and subagent panel entries
  // (child-session views: header adoption + tool-workflow pairing + fold).
  const [todos, setTodos] = createSignal<TodoItem[]>([])
  const [subagents, setSubagents] = createSignal<SubagentEntry[]>([])
  // Modal Select overlay (model/sessions/effort/ask); see the Overlay type.
  const [overlay, setOverlay] = createSignal<Overlay | null>(null)
  // Model catalog for the Select (reactive: the host list loads async).
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
  // Transcript lookback: a bottom-anchored line window (tui-pi's shape —
  // the native scrollbox never re-measures streaming text growth, so every
  // scroll API on it clamps to a stale height). offset 0 shows the newest
  // lines and follows the stream by construction; scrolling up switches to
  // a top-anchored window that stays put while content grows; reaching the
  // bottom resumes following.
  const [scrollTopLine, setScrollTopLine] = createSignal<number | null>(null)
  let totalLines = 0
  const VIEWPORT_ROWS = 18
  const scrollUp = () => {
    const cur = scrollTopLine() ?? Math.max(0, totalLines - VIEWPORT_ROWS)
    setScrollTopLine(Math.max(0, cur - 12))
  }
  const scrollDown = () => {
    const cur = scrollTopLine()
    if (cur === null) return
    const next = cur + 12
    if (next + VIEWPORT_ROWS >= totalLines) setScrollTopLine(null)
    else setScrollTopLine(next)
  }
  const pinIfFollowing = () => {} // window is bottom-anchored; nothing to pin
  // bumps on any session switch (/new, resume, fork) — async replays check it
  let replayGen = 0
  // user-installed plugins (welcome list) + tool-execution mode (powerline)
  const [stopConfirm, setStopConfirm] = createSignal(false)
  const [plugins] = createSignal(props.deps.session.listPlugins())
  const execMode = props.deps.session.executionMode()
  // Host command registry (plan/compact/feedback/export/…): fetched once at
  // boot, merged into the palette below the TUI-owned commands.
  const [hostCommands, setHostCommands] = createSignal<{ name: string; description: string }[]>([])
  onMount(async () => {
    try {
      setHostCommands(await props.deps.session.listHostCommands())
    } catch {
      /* registry unavailable: TUI commands still work */
    }
  })
  // imperative editor refocus counter (overlay teardown guard)
  const [focusKey, setFocusKey] = createSignal(0)

  onMount(() => {
    // One 1s heartbeat drives the dock widgets' elapsed counters (think
    // seconds, running-tool spinner) and the powerline clock.
    const tick = setInterval(() => {
      setClock(fmtClock())
      dock.tick()
      setSubagents((arr) =>
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
        openOverlay({
          title: `${t("ask.title")}: ${q0.prompt}`.slice(0, 70),
          items: options.map((o) => ({ label: o, value: o })),
          ask: { questionId: q0.id, resolve },
          onSelect: (value) => resolve([{ questionId: q0.id, selected: value }]),
        })
      })
      if (answer === "declined") throw new Error("declined")
      return answer
    })
  })

  // Slash palette: the menu lists COMMANDS matching the "/token" prefix of
  // the input line. Usable mid-turn too — the line is never locked.
  const allCommands = createMemo(() => {
    const tuiNames = new Set(COMMANDS.map((c) => c.name))
    return [...COMMANDS, ...hostCommands().filter((c) => !tuiNames.has(`/${c.name}`)).map((c) => ({ name: `/${c.name}`, desc: c.description, host: true }))]
  })
  const filteredCommands = createMemo(() => {
    const m = /^\/(\S*)/.exec(input())
    if (!m) return []
    return allCommands().filter((c) => c.name.slice(1).startsWith(m[1]))
  })
  const clampedSel = createMemo(() => {
    const n = filteredCommands().length
    return n === 0 ? 0 : Math.min(menuSel(), n - 1)
  })
  const menuVisible = createMemo(() => menuOpen() && filteredCommands().length > 0)

  // ---- feature modules (the architecture's composition layer) ----
  // Each feature owns its flow; the Shell only routes: overlays are generic
  // {title, items, onSelect} payloads and commands delegate.
  const openOverlay = (req: { title: string; items: SelectItem[]; onSelect: (v: string) => void; ask?: { questionId: string; resolve: AskResolve } }) =>
    setOverlay(req)
  // think/tool dock phase machine (ported from tui-pi live-widgets)
  const dock = createDockFeature({ theme })
  const modelSelect = createModelSelectFeature({
    session: props.deps.session,
    t,
    label,
    setLabel,
    push: (it) => push(it),
  })
  const themeSelect = createThemeSelectFeature({ t, themeName, setThemeName })
  const historyFork = createHistoryForkFeature({
    session: props.deps.session,
    t,
    push: (it) => push(it),
    setItems: (rows) => setItems(rows as TItem[]),
    resetDock: () => {
      dock.reset()
      setTodos([])
      setSubagents([])
    },
    onForked: () => {
      setShowWelcome(false)
      setBusy(false)
    },
  })
  const loginFeature = createLoginFeature({ session: props.deps.session, theme, push: (it) => push(it) })

  const onOverlaySelect = (value: string) => {
    const ov = overlay()
    setOverlay(null)
    setFocusKey((k) => k + 1)
    ov?.onSelect(value)
  }
  /** Esc inside the overlay Select (idempotent with the Select's own onCancel). */
  const onOverlayCancel = () => {
    const ov = overlay()
    setOverlay(null)
    setFocusKey((k) => k + 1)
    ov?.ask?.resolve("declined")
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
  // The streaming reply row is bumped at a throttled cadence (the think
  // text now lives in the dock feature).
  let streamingReply: Extract<TItem, { kind: "assistant" }> | null = null
  let lastBump = 0
  const bumpSoon = () => {
    const now = Date.now()
    if (now - lastBump < 60) return
    lastBump = now
    pinIfFollowing()
    // Replace the streaming reply ref (not just the array) so the per-item
    // <For> re-renders it — and REBIND the live ref to the copy now in the
    // array: matching the original object stops working after the first
    // copy, which froze the streamed text at the first bump and made the
    // final settle below never land.
    if (streamingReply) {
      const prev = streamingReply
      const next: TItem = { ...prev }
      streamingReply = next
      setItems((arr) => arr.map((x) => (x === prev ? next : x)))
    }
  }
  const push = (it: TItem) => {
    setItems((arr) => [...arr, it])
    pinIfFollowing()
  }

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
      if ((cmd as any).host) {
        // host registry command: execute in the agent, echo any feedback
        void props.deps.session.executeHostCommand(full).then((r) => {
          if (r?.text) push({ kind: "system", text: r.text })
        })
        return
      }
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
    // any command output needs the transcript visible — the welcome banner
    // replaces it entirely while up
    setShowWelcome(false)
    const parts = text.slice(1).trim().split(/\s+/)
    const cmd = parts[0]
    const arg = parts.slice(1).join(" ")
    if (cmd === "quit" || cmd === "exit") process.exit(0)
    if (cmd === "help" || cmd === "?") {
      push({ kind: "system", text: t("cmd.help.lines") })
      push({ kind: "system", text: "keys: PgUp/PgDn or ctrl+b/f scroll · ctrl+t think detail · ctrl+o tool ledger · esc stop-confirm while busy · alt+enter newline · / palette" })
      const hc = hostCommands()
      if (hc.length > 0) push({ kind: "system", text: `host commands: ${hc.map((c) => `/${c.name}`).join(" ")}` })
    } else if (cmd === "clear") {
      setItems([])
      setResetKey((k) => k + 1)
      push({ kind: "system", text: t("cmd.cleared") })
    } else if (cmd === "usage") {
      // Rich per-session summary (turns / prompt / completion / last-turn
      // speed) from the host session's telemetry.
      for (const line of props.deps.session.usageSummary()) push({ kind: "system", text: line })
      push({ kind: "system", text: `model: ${label()}` })
    } else if (cmd === "search") {
      if (!arg) {
        push({ kind: "error", text: "usage: /search <text>" })
      } else {
        const hits = await props.deps.session.searchSessions(arg)
        if (hits.length === 0) {
          push({ kind: "system", text: `no sessions matching "${arg}"` })
        } else {
          openOverlay({
            title: `search: ${arg}`,
            items: hits.map((hit) => ({ label: hit.snippet || hit.id.slice(0, 8), value: hit.id, description: hit.id.slice(0, 8) })),
            onSelect: async (value) => {
              props.deps.session.resumeSession(value)
              setBusy(false)
              setShowWelcome(false)
              const gen = ++replayGen
              try {
                const rows = await props.deps.session.storedTranscript(value)
                if (gen !== replayGen) return
                await new Promise((r2) => setTimeout(r2, 50))
                if (gen !== replayGen) return
                setItems(rows.map((it) => (it.kind === "assistant" ? { kind: "assistant" as const, text: it.text, final: true } : { kind: "user" as const, text: it.text })) as TItem[])
                setScrollTopLine(null)
              } catch {
                /* replay best-effort */
              }
              push({ kind: "system", text: `${t("cmd.sessions.resumed")}: ${value.slice(0, 8)}` })
            },
          })
        }
      }
    } else if (cmd === "preset") {
      const presets = await props.deps.session.listPresets()
      if (presets.length === 0) {
        push({ kind: "system", text: "no presets in the agentPresets registry" })
      } else {
        const cur = props.deps.session.currentPresetId()
        openOverlay({
          title: t("picker.preset.title"),
          items: presets.map((p) => ({
            label: p.name,
            value: p.id,
            ...(p.id === cur ? { description: t("cmd.model.current") } : {}),
          })),
          onSelect: (value) => {
            const picked = presets.find((p) => p.id === value)
            props.deps.session.switchPreset(value)
            push({ kind: "system", text: `preset → ${picked?.name ?? value} (fresh session on next message)` })
          },
        })
      }
    } else if (cmd === "history") {
      historyFork.open(openOverlay)
    } else if (cmd === "new") {
      replayGen++
      props.deps.session.newSession()
      setItems([])
      push({ kind: "system", text: t("cmd.new.done") })
    } else if (cmd === "sessions") {
      const list = await props.deps.session.listSessions()
      if (!list.length) {
        push({ kind: "system", text: t("cmd.sessions.empty") })
      } else {
        openOverlay({
          title: t("picker.sessions.title"),
          items: list.map((x) => ({
            label: x.title || x.id.slice(0, 8),
            value: x.id,
            ...(x.updatedAt ? { description: String(x.updatedAt).slice(0, 19) } : {}),
          })),
          onSelect: async (value) => {
            props.deps.session.resumeSession(value)
            setBusy(false)
            setShowWelcome(false)
            // replay the stored transcript (context returns with the agent;
            // the rows come from the persisted log). A generation guard
            // aborts the replay if /new or another session switch ran while
            // the log was reading (a slow read losing to /new used to
            // repopulate the cleared transcript with the OLD rows).
            const gen = ++replayGen
            try {
              const rows = await props.deps.session.storedTranscript(value)
              if (gen !== replayGen) return
              // yield one tick so the overlay-close focus-flip commits
              // BEFORE the heavy replay batch — committing them together
              // left the editor unfocused for the whole render and keys
              // typed in the window were lost
              await new Promise((r2) => setTimeout(r2, 50))
              if (gen !== replayGen) return
              setItems(rows.map((it) => (it.kind === "assistant" ? { kind: "assistant" as const, text: it.text, final: true } : { kind: "user" as const, text: it.text })) as TItem[])
              setScrollTopLine(null)
            } catch {
              /* replay is best-effort; the turn itself still resumes */
            }
            push({ kind: "system", text: `${t("cmd.sessions.resumed")}: ${value.slice(0, 8)}` })
          },
        })
      }
    } else if (cmd === "theme") {
      themeSelect.open(openOverlay)
    } else if (cmd === "model") {
      if (!arg) {
        await modelSelect.open(openOverlay)
      } else {
        const [provider, model] = arg.split("/")
        modelSelect.direct(provider, model)
      }
    } else if (cmd === "login") {
      // /login REF KEY still works headlessly; bare /login opens the panel
      if (parts.length === 3) {
        try {
          await props.deps.session.login(parts[1], parts[2])
          push({ kind: "system", text: t("cmd.login.saved", { ref: parts[1] }) })
        } catch (e) {
          push({ kind: "error", text: errText(e) })
        }
      } else {
        await loginFeature.open("login")
      }
    } else if (cmd === "logout") {
      if (parts.length === 2) {
        try {
          await props.deps.session.logout(parts[1])
          push({ kind: "system", text: t("cmd.logout.done", { ref: parts[1] }) })
        } catch (e) {
          push({ kind: "error", text: errText(e) })
        }
      } else {
        await loginFeature.open("logout")
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
      // not TUI-owned: try the host command registry before giving up
      const known = hostCommands().some((c) => c.name === cmd)
      if (known) {
        const r = await props.deps.session.executeHostCommand(text)
        if (r?.text) push({ kind: "system", text: r.text })
        return
      }
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
    dock.onTurnStart()
    setLiveTps(null)
    turnStartAt = Date.now()
    streamingReply = null
    try {
      await props.deps.session.turn(
        text,
        {
          onThinkingDelta: (s: string) => {
            dock.onThinkingDelta(s)
            bumpSoon()
          },
          onContentDelta: (s: string) => {
            dock.onContentDelta(s)
            if (!streamingReply) {
              streamingReply = { kind: "assistant", text: "" }
              push(streamingReply)
            }
            streamingReply.text += s
            bumpSoon()
          },
          onTurnEnd: (u: { prompt: number; completion: number }) => {
            const cur = streamingReply
            if (cur) {
              const final: TItem = { ...cur, final: true }
              setItems((arr) => arr.map((x) => (x === cur ? final : x)))
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
          onSubagentUpdate: (entries) => setSubagents(entries),
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
            dock.onToolStart(start)
          },
          onToolRun: (run: ToolRun) => {
            dock.onToolRun(run)
          },
          onError: (msg: string) => push({ kind: "error", text: msg }),
        },
      )
    } catch (e) {
      push({ kind: "error", text: errText(e) })
    } finally {
      // Dock collapse: the thought folds to its summary line, entries that
      // never produced a result (declined / aborted) settle as failed.
      dock.onTurnEnd()
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
    // abort confirm (tui-pi stop-dialog): a bare esc while busy arms the
    // stop card instead of killing the turn — accidental esc no longer
    // throws away a long answer. y aborts, n/esc resumes.
    if (stopConfirm()) {
      if (key.sequence === "y") {
        setStopConfirm(false)
        props.deps.session.abort?.()
        push({ kind: "system", text: "turn aborted" })
      } else if (key.sequence === "n" || key.name === "escape") {
        setStopConfirm(false)
      }
      return
    }
    if (key.name === "escape" && busy() && !stopConfirm()) {
      setStopConfirm(true)
      return
    }
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
    // login feature's key stages (key entry / logout confirm) come before
    // everything else while its panel is up
    if (loginFeature.active() && loginFeature.handleKey(key)) return
    if (key.ctrl && key.name === "t") {
      dock.reexpandThink()
      return
    }
    if (key.ctrl && key.name === "o") {
      dock.reexpandTools()
      return
    }
    // scrollback lookback: PgUp/PgDn page through the transcript region
    if (key.name === "pageup" || (key.ctrl && key.name === "b")) {
      scrollUp()
      return
    }
    if (key.name === "pagedown" || (key.ctrl && key.name === "f")) {
      scrollDown()
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
  const toolCount = createMemo(() => dock.toolCount())
  const powerlineSegments = (): PowerlineSegment[] => {
    const r = route()
    const pct = contextPct()
    const segs: PowerlineSegment[] = [
      { text: `dsh(${execMode})`, bg: POWERLINE_COLORS.brand },
      { text: r.provider, bg: POWERLINE_COLORS.provider },
      {
        text: `🤖 ${r.model || "·"} ◕${r.effort ?? "off"}`,
        bg: POWERLINE_COLORS.thinking[r.effort ?? "high"] ?? POWERLINE_COLORS.thinking.high,
      },
      {
        text: `🧠 ${usage().prompt >= 1000 ? `${(usage().prompt / 1000).toFixed(1)}k` : usage().prompt}(${pct}%)`,
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
        <WelcomeBanner theme={th()} model={label()} cwd={process.cwd()} plugins={plugins()} />
      ) : (
        <TranscriptWindow
          items={items()}
          theme={th()}
          t={t}
          spinnerFrame=""
          mdStyle={mdStyle}
          viewportRows={VIEWPORT_ROWS}
          {...(scrollTopLine() !== null ? { startIndex: scrollTopLine()! } : { offset: 0 })}
          onLayout={(total, rows) => (totalLines = total)}
        />
      )}
      {/* Fixed dock below the transcript window (tui-pi's shape): the
          panels never scroll away with the content. */}
      <TodosWidget todos={todos()} theme={th()} />
      <SubagentWidget entries={subagents()} theme={th()} />
      {dock.thinkView()}
      {dock.toolView()}
      {approval() ? (
        <ApprovalCard toolName={approval()!.name} args={approval()!.args} hint={t("agent.approve.hint")} theme={th()} />
      ) : null}
      {stopConfirm() ? (
        <box style={{ border: true, borderStyle: "rounded", borderColor: th().tokens.warn, flexDirection: "column", padding: 1 }}>
          <text style={{ fg: th().tokens.warn }}>abort this turn?</text>
          <text style={{ fg: th().tokens.dim }}>y aborts · n/esc resumes</text>
        </box>
      ) : null}
      {loginFeature.view()}
      {overlay() ? (
        <Select
          title={overlay()?.title ?? ""}
          items={overlay()?.items ?? []}
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
        focused={!(approval() || overlay() || loginFeature.panelOpen())}
        height={Math.max(1, Math.min(5, input() ? input().split("\n").length : 1))}
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
        focusKey={focusKey()}
        resetKey={resetKey()}
        setKey={setKey()}
        setValue={setValueText()}
      />
      <FooterHints theme={th()} />
      <PowerlineFooter left={powerlineSegments()} right={clock()} theme={th()} />
    </box>
  )
}
