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
import { SyntaxStyle, decodePasteBytes } from "@opentui/core"
import { useKeyboard, usePaste, useRenderer } from "@opentui/solid"
import { getTheme, themeNames, themes, type I18n } from "@dsh-opentui/kit"
import { Transcript, TranscriptWindow, InputLine, FooterHints, ApprovalCard, type TranscriptItem, type AskEntry, type StoredTranscriptRow } from "@dsh-opentui/kit"
import { WelcomeBanner, PowerlineFooter, POWERLINE_COLORS, speedSegment, toolSegment, type PowerlineSegment } from "@dsh-opentui/kit"
import { AutoScroll, Select, type SelectItem, TodosWidget, type TodoItem, SubagentWidget, type SubagentEntry, LastPromptLine, StatusBar, type StatusPhase } from "@dsh-opentui/kit"
import type { SurfaceStore } from "@dsh-opentui/runtime"
import type { ShellSessionSurface } from "./client/shell-session.ts"
import type { ToolRun } from "./agent/tools.ts"
import { ASK_TOOL_NAME, parseAskCallArgs, parseAskAnswers, buildAskTranscriptItem, type AskPick, type ParsedAskQuestion } from "./features/ask-transcript.ts"
/** Tools that spawn subagent children — gated by the maxAgents policy. */
const SPAWN_TOOLS = ["subagent", "subagent_fork", "workflow", "ralph", "use_agent"]
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
  /** The session seam (ShellSessionSurface): plugin mode feeds the
   * in-process HostSession, client mode the RemoteHostSession — both
   * satisfy it structurally. */
  session: ShellSessionSurface
  /** Theme name from plugin config; env wins over this. */
  themeName?: string
  /** The live i18n instance (/language switches it in place). */
  i18n?: { locale: string; setLocale(l: "zh-CN" | "en" | "ja" | "ko"): void }
}

/** Transcript rows: the CLEAN subset of Kit's shape — thinking and raw
 * tool traffic lives in the dock widgets, never in the message flow.
 * Exception: the ask_user_question Q&A block ("ask") — the one tool
 * whose result IS user-visible context (the questions asked and the
 * choices picked), so it joins the durable message flow and replays
 * from the journal on resume/fork. */
type TItem = Extract<TranscriptItem, { kind: "user" | "assistant" | "error" | "system" | "ask" }>

/** Stored/replayed rows → TItems (finalized assistant, ask rows pass through).
 * Rows structurally equal to the previous item at the same index REUSE the
 * previous object: a replay that changes nothing must not remount the
 * transcript — OpenTUI's diff-paint can drop an interior row when a whole
 * sibling group unmounts+remounts in one flush (the same reconciler class
 * bumpSoon works around with ref replacement). */
const rowEqual = (a: TItem | undefined, b: TranscriptItem): boolean => {
  if (a === undefined || a.kind !== b.kind) return false
  if (a.kind === "ask" && b.kind === "ask") return JSON.stringify(a.entries) === JSON.stringify(b.entries)
  if (a.kind === "user" || a.kind === "assistant" || a.kind === "error" || a.kind === "system") {
    if (b.kind !== "user" && b.kind !== "assistant" && b.kind !== "error" && b.kind !== "system") return false
    return a.text === b.text && (b.kind !== "assistant" || a.kind !== "assistant" || (a.final === (b as { final?: boolean }).final))
  }
  return false
}
const storedRowsToItems = (rows: StoredTranscriptRow[], prev: TItem[] = []): TItem[] =>
  rows.map((it, i) => {
    const next: TItem = it.kind === "assistant" ? { kind: "assistant" as const, text: it.text, final: true } : (it as TItem)
    return rowEqual(prev[i], next) ? prev[i]! : next
  })

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
  /** Live preview while arrows move (theme picker: apply-as-you-browse). */
  onPreview?: (value: string) => void
  /** Esc cancels — restore whatever onPreview changed. */
  onHoverCancel?: () => void
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
  { name: "/think", desc: "cycle reasoning effort of the current model" },
  { name: "/subagents", desc: "pick a subagent to view its transcript" },
  { name: "/resume", desc: "resume a stored session (picker)" },
  { name: "/hotkeys", desc: "show the key bindings" },
  { name: "/session", desc: "show current session info (/session rename …)" },
  { name: "/plugins", desc: "list installed plugins" },
  { name: "/skills", desc: "list registered skills" },
  { name: "/reload", desc: "hot-reload plugins" },
  { name: "/search", desc: "full-text search sessions (/search text)" },
  { name: "/btw", desc: "side question overlay (/btw question, bare toggles)" },
  { name: "/language", desc: "switch interface language (zh-CN/en)" },
  { name: "/hints", desc: "toggle the key-hint strip" },
  { name: "/config", desc: "plugin settings (/config or /config key value)" },
  { name: "/settings", desc: "browse host settings namespaces" },
  { name: "/queue", desc: "queue a message (/queue msg, bare toggles panel)" },
  { name: "/repair", desc: "scan session logs for broken files" },
  { name: "/tail", desc: "watch a session log live (/tail sessionId)" },
  { name: "/agents", desc: "list agent definitions (~/.dsh/agents)" },
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
  // last-input line (tui-pi's ` ● ` last-request echo): the latest MODEL
  // prompt, shown dim below the input. SESSION-persistent (tui-pi
  // semantics): set on send/steer, survives turn ends for the rest of the
  // session; cleared only when the session changes (/new, resume, fork).
  // Slash commands never set it.
  const [lastPrompt, setLastPrompt] = createSignal("")
  // subagent panel lifecycle: when every child settles, clear the panel
  // 1s later (user spec — done means gone, brief linger to read results)
  let subagentClearTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleSubagentClear = () => {
    if (subagentClearTimer !== undefined) clearTimeout(subagentClearTimer)
    subagentClearTimer = setTimeout(() => {
      subagentClearTimer = undefined
      setSubagents([])
    }, 1000)
  }
  // ctrl+G viewer: the selected child id, its rendered lines, and the
  // one-line steer entry state
  const [viewerId, setViewerId] = createSignal<string | null>(null)
  const [viewerLines, setViewerLines] = createSignal<string[]>([])
  const [steerFor, setSteerFor] = createSignal<string | null>(null)
  const [steerBuffer, setSteerBuffer] = createSignal("")
  const [hintsVisible, setHintsVisible] = createSignal(true)
  // git segment: the session cwd's branch, refreshed on the 30s tick
  const [gitBranch, setGitBranch] = createSignal("")
  // message queue: /queue <msg> enqueues while busy (steering stays the
  // primary mid-turn path); the turn-end drain sends them in order
  const [queueMsgs, setQueueMsgs] = createSignal<string[]>([])
  const [queueOpen, setQueueOpen] = createSignal(false)
  // btw side questions: finished Q/A pairs (bare /btw reviews) + a live
  // running entry + the panel toggle
  const [btwPairs, setBtwPairs] = createSignal<{ q: string; a: string }[]>([])
  const [btwLive, setBtwLive] = createSignal<{ q: string; a: string } | null>(null)
  const [btwOpen, setBtwOpen] = createSignal(false)
  // keybindings.json (profile root, sibling of config.json): overrides for
  // the global hotkeys — { "viewer": "ctrl+g", "think": "t", ... }; loaded
  // once at mount via the session's keybindingsPath
  const [kb] = createSignal<Record<string, string>>(props.deps.session.keybindingsLoad?.() ?? {})
  const hot = (action: string, fallback: string): string => kb()[action] ?? fallback
  // remote tail sink: a watched (other-process) session replays durable
  // rows straight into the transcript
  props.deps.session.remoteTailSink = (rows) => {
    setItems(rows.map((r) => ({ kind: r.kind, text: r.text, final: r.final })) as TItem[])
    setScrollTopLine(null)
  }
  // plugin config (profile config.json): favorites/hidden shape /model,
  // askUserTimeoutSec auto-declines the ask overlay
  const [pluginConfig, setPluginConfig] = createSignal(props.deps.session.configLoad())
  const openViewer = (id: string) => {
    setViewerId(id)
    setViewerLines(props.deps.session.childTranscript(id))
  }
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
  // turn elapsed seconds (status bar timer readout)
  const [turnElapsed, setTurnElapsed] = createSignal(0)
  // streaming-reply state as a SIGNAL (streamingReply is a plain let — a
  // memo reading it never recomputes when the reply starts, so the 📝
  // phase never lit)
  const [streaming, setStreaming] = createSignal(false)
  // terminal width for full-bleed rows (status bar reaches the right edge)
  const [termCols, setTermCols] = createSignal(process.stdout.columns ?? 100)
  // Live streaming speed for the powerline ⚡ segment (chars/4 estimate
  // over elapsed time; shown only while a turn is running).
  const [liveTps, setLiveTps] = createSignal<number | null>(null)
  let turnStartAt = 0

  let approveResolve: ((ok: boolean) => void) | null = null
  // ---- ask_user_question transcript record (the Q&A block) ----
  // tool/call → parsed questions (callId-keyed); the overlay's own picks
  // are stashed between the provider answer and the tool/result event —
  // the result brief can be truncated (300-char cap) for multi-question
  // batches, the stash is the local fallback. Both cleared per ask so a
  // stale stash can never answer a newer ask.
  const askPending = new Map<string, ParsedAskQuestion[]>()
  let askStash: { picks: AskPick[]; declined: boolean } | null = null
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
  // user-installed plugins (welcome list) + tool-execution mode (powerline;
  // re-read from the host after each turn and on /preset,/new — the live
  // agent's scope decides it, not the installed plugin list)
  const [stopConfirm, setStopConfirm] = createSignal(false)
  const [plugins] = createSignal(props.deps.session.listPlugins())
  const [execMode, setExecMode] = createSignal(props.deps.session.executionMode())
  const refreshExecMode = () => setExecMode(props.deps.session.executionMode())
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
      setTermCols(process.stdout.columns ?? 100)
      if (busy()) setTurnElapsed((s) => s + 1)
      dock.tick()
      setSubagents((arr) =>
        arr.some((r) => r.status === "running")
          ? arr.map((r) => (r.status === "running" ? { ...r, elapsed: r.elapsed + 1 } : r))
          : arr,
      )
      if (viewerId()) setViewerLines(props.deps.session.childTranscript(viewerId()!))
    }, 1000)
    // git branch probe (30s cadence, silent on non-repos)
    const gitTick = setInterval(() => {
      import("node:child_process").then(({ execFile }) => {
        execFile("git", ["branch", "--show-current"], { cwd: process.cwd(), timeout: 3000 }, (err, stdout) => {
          if (!err) setGitBranch(String(stdout).trim())
          else setGitBranch("")
        })
      })
    }, 30000)
    const gitOnce = setTimeout(() => {
      import("node:child_process").then(({ execFile }) => {
        execFile("git", ["branch", "--show-current"], { cwd: process.cwd(), timeout: 3000 }, (err, stdout) => {
          if (!err) setGitBranch(String(stdout).trim())
        })
      })
    }, 1200)
    onCleanup(() => {
      clearInterval(gitTick)
      clearTimeout(gitOnce)
    })
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
        let settled = false
        const settle = (v: { questionId: string; selected: string }[] | "declined") => {
          if (settled) return
          settled = true
          setOverlay(null)
          setFocusKey((k) => k + 1)
          resolve(v)
        }
        // askUserTimeoutSec (plugin config): auto-decline when unanswered —
        // the turn keeps running either way
        const timeoutSec = Number(pluginConfig().askUserTimeoutSec ?? 0)
        if (timeoutSec > 0) setTimeout(() => settle("declined"), timeoutSec * 1000)
        openOverlay({
          title: `${t("ask.title")}: ${q0.prompt}`.slice(0, 70),
          items: options.map((o) => ({ label: o, value: o })),
          ask: { questionId: q0.id, resolve: settle },
          onSelect: (value) => settle([{ questionId: q0.id, selected: value }]),
        })
      })
      // Stash what the user actually picked — the ask transcript block
      // reads it when the tool result brief is truncated. Cleared when the
      // result event consumes it (or the next ask call starts).
      askStash = { picks: answer === "declined" ? [] : answer, declined: answer === "declined" }
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
  const dock = createDockFeature({
    theme,
    sizes: () => {
      const c = pluginConfig() as { dockRows?: { think?: unknown; tool?: unknown } }
      const pick = (v: unknown, d: number | "full") => (typeof v === "number" || v === "full" ? (v as number | "full") : d)
      return { think: pick(c.dockRows?.think, 7), tool: pick(c.dockRows?.tool, 7) }
    },
    hints: () => ({ think: hot("think", "ctrl+t"), tool: hot("tools", "ctrl+o") }),
    style: () => {
      const c = pluginConfig()
      return {
        thinkBg: typeof c.thinkBg === "string" ? c.thinkBg : undefined,
        toolBg: typeof c.toolBg === "string" ? c.toolBg : undefined,
      }
    },
  })
  const modelSelect = createModelSelectFeature({
    session: props.deps.session,
    t,
    label,
    setLabel,
    push: (it) => push(it),
    config: pluginConfig,
  })
  const themeSelect = createThemeSelectFeature({ t, themeName, setThemeName, revertTheme: () => setThemeName(initialTheme) })
  const historyFork = createHistoryForkFeature({
    session: props.deps.session,
    t,
    push: (it) => push(it),
    setItems: (rows) => setItems(rows as TItem[]),
    resetDock: () => {
      dock.reset()
      setLastPrompt("") // fork mounts a NEW session — the ` ● ` echo resets
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
  /** Esc inside the overlay Select: restore previews, then cancel
   * (idempotent with the Select's own onCancel). */
  const onOverlayCancel = () => {
    const ov = overlay()
    setOverlay(null)
    setFocusKey((k) => k + 1)
    ov?.onHoverCancel?.()
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
              setLastPrompt("") // resumed a DIFFERENT session — echo resets
              setBusy(false)
              setShowWelcome(false)
              const gen = ++replayGen
              try {
                const rows = await props.deps.session.storedTranscript(value)
                if (gen !== replayGen) return
                await new Promise((r2) => setTimeout(r2, 50))
                if (gen !== replayGen) return
                setItems((cur) => storedRowsToItems(rows, cur))
                setScrollTopLine(null)
              } catch {
                /* replay best-effort */
              }
              push({ kind: "system", text: `${t("cmd.sessions.resumed")}: ${value.slice(0, 8)}` })
            },
          })
        }
      }
    } else if (cmd === "think") {
      // cycle the CURRENT route's reasoning effort without re-picking the
      // model (tui-pi /think): keep -> low -> ... -> max -> keep
      const ladder = ["keep", "low", "medium", "high", "xhigh", "max"]
      const m = /^([^/]+)\/([^/]+?)(?:\s*\(([^)]+)\))?$/.exec(label())
      if (!m) {
        push({ kind: "error", text: "no live model route to cycle" })
        return
      }
      const [, provider, model, cur] = m
      const next = cur === undefined || cur === "off" ? "low" : ladder[(ladder.indexOf(cur) + 1) % ladder.length]
      props.deps.session.switchModel(provider!, model!, next === "keep" ? undefined : next)
      setLabel(props.deps.session.label)
      push({ kind: "system", text: `${provider}/${model} ◕ ${next}` })
    } else if (cmd === "subagents") {
      // command twin of ctrl+G — same list -> transcript -> steer flow
      const list = subagents()
      if (list.length === 0) {
        push({ kind: "system", text: "no subagents yet (ctrl+G works once children exist too)" })
        return
      }
      openOverlay({
        title: "subagents — pick to view transcript",
        items: list.map((e) => ({ label: `${e.label}${e.model ? ` · ${e.model}` : ""}`, value: e.id, description: `${e.status} · ↻${e.rounds}` })),
        onSelect: (value) => openViewer(value),
      })
    } else if (cmd === "resume") {
      // standalone resume picker (same replay as /sessions resume)
      const hits = await props.deps.session.listSessions()
      if (hits.length === 0) {
        push({ kind: "system", text: "no sessions to resume" })
        return
      }
      openOverlay({
        title: t("picker.sessions.title"),
        items: hits.map((h) => ({ label: h.title || h.id.slice(0, 8), value: h.id, description: h.updatedAt?.slice(0, 19) })),
        onSelect: async (value) => {
          props.deps.session.resumeSession(value)
          setLastPrompt("") // resumed a DIFFERENT session — echo resets
          setBusy(false)
          setShowWelcome(false)
          const gen = ++replayGen
          try {
            const rows = await props.deps.session.storedTranscript(value)
            if (gen !== replayGen) return
            await new Promise((r) => setTimeout(r, 50))
            if (gen !== replayGen) return
            setItems(storedRowsToItems(rows))
            setScrollTopLine(null)
          } catch {
            /* replay best-effort */
          }
          push({ kind: "system", text: `${t("cmd.sessions.resumed")}: ${value.slice(0, 8)}` })
        },
      })
    } else if (cmd === "hotkeys") {
      // keymap help: defaults + any keybindings.json overrides
      const rows: [string, string][] = [
        ["viewer", "ctrl+g"],
        ["think", "ctrl+t"],
        ["tools", "ctrl+o"],
        ["scrollUp", "pageup"],
        ["scrollDown", "pagedown"],
        ["model", "ctrl+l"],
        ["search", "ctrl+alt+f"],
        ["escape", "escape"],
        ["ctrlC", "ctrl+c"],
        ["ctrlD", "ctrl+d"],
      ]
      push({ kind: "system", text: "keybindings (keybindings.json overrides *):" })
      for (const [action, def] of rows) {
        const mark = kb()[action] ? " *" : ""
        push({ kind: "system", text: `  ${action.padEnd(10)} ${kb()[action] ?? def}${mark}` })
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
            refreshExecMode()
            push({ kind: "system", text: `preset → ${picked?.name ?? value} (fresh session on next message)` })
          },
        })
      }
    } else if (cmd === "history") {
      historyFork.open(openOverlay)
    } else if (cmd === "new") {
      replayGen++
      props.deps.session.newSession()
      refreshExecMode()
      setItems([])
      // fresh session = fresh dock state (same reset the fork path runs) —
      // the todo panel shows only while the CURRENT session has todos
      dock.reset()
      setLastPrompt("") // session change: the ` ● ` echo is session-scoped
      setTodos([])
      setSubagents([])
      setBtwPairs([])
      setBtwLive(null)
      setBtwOpen(false)
      props.deps.session.stopRemoteTail()
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
            setLastPrompt("") // resumed a DIFFERENT session — echo resets
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
              setItems((cur) => storedRowsToItems(rows, cur))
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
    } else if (cmd === "language") {
      const i18n = props.deps.i18n
      if (i18n) {
        const cycle: Array<"zh-CN" | "en" | "ja" | "ko"> = ["zh-CN", "en", "ja", "ko"]
        const to = cycle[(cycle.indexOf(i18n.locale as any) + 1) % cycle.length]
        i18n.setLocale(to)
        push({ kind: "system", text: `language → ${to}` })
      } else {
        push({ kind: "error", text: "language switching unavailable" })
      }
    } else if (cmd === "agents") {
      // two-layer manager (tui-pi agentsmg): list → per-agent fields
      const agents = props.deps.session.listAgents()
      if (agents.length === 0) {
        push({ kind: "system", text: "no agent definitions (~/.dsh/agents/*.md)" })
        return
      }
      // per-agent fields stage: RE-READS the agent after every commit so
      // the rows reflect the edit, then re-opens itself — the user stays
      // in the fields view instead of being dropped out
      const openFields = (agentName: string): void => {
        const a = props.deps.session.listAgents().find((x) => x.name === agentName)
        if (!a) return
        openOverlay({
          title: `${a.displayName ?? a.name} — fields`,
          items: [
            { label: `model: ${a.model ?? "(inherit)"}`, value: "model", description: "pick a model route" },
            { label: `thinking: ${a.thinking ?? "(inherit)"}`, value: "thinking", description: "pick a reasoning effort" },
            { label: `deep: ${a.deep ?? "0"}`, value: "deep", description: "spawn depth" },
          ],
          onSelect: (field) => {
            if (field === "model") {
              void props.deps.session.listProviders().then((catalog) => {
                openOverlay({
                  title: `${a.name} — pick model`,
                  items: catalog.flatMap((p) => p.models.map((m) => ({ label: m, group: p.provider, value: `${p.provider}/${m}` }))),
                  onSelect: (v) => {
                    props.deps.session.agentSet(a.name, "model", v)
                    push({ kind: "system", text: `${a.name}: model → ${v}` })
                    openFields(a.name)
                  },
                })
              })
            } else if (field === "thinking") {
              openOverlay({
                title: `${a.name} — thinking`,
                items: ["keep", "low", "medium", "high", "xhigh", "max"].map((e) => ({ label: e, value: e, description: t(`picker.effort.${e}.desc`) })),
                onSelect: (v) => {
                  props.deps.session.agentSet(a.name, "thinking", v === "keep" ? "" : v)
                  push({ kind: "system", text: `${a.name}: thinking → ${v}` })
                  openFields(a.name)
                },
              })
            } else {
              openOverlay({
                title: `${a.name} — deep`,
                items: ["0", "1", "2", "3"].map((d) => ({ label: d, value: d, description: d === "0" ? "no delegation" : `depth ${d}` })),
                onSelect: (v) => {
                  props.deps.session.agentSet(a.name, "deep", v)
                  push({ kind: "system", text: `${a.name}: deep → ${v}` })
                  openFields(a.name)
                },
              })
            }
          },
        })
      }
      const broken = agents.filter((a) => a.broken)
      openOverlay({
        title: `agents (${agents.length})`,
        items: agents.map((a) => ({
          label: a.broken ? `✗ ${a.name}` : (a.displayName ?? a.name),
          value: a.name,
          description: [a.model ? `⚙ ${a.model}` : null, a.thinking ? `◕ ${a.thinking}` : null, a.deep ? `deep ${a.deep}` : null, a.broken ? `broken: ${a.broken}` : null].filter(Boolean).join(" · "),
        })),
        onSelect: (value) => {
          const a = agents.find((x) => x.name === value)
          if (!a || a.broken) return
          openFields(a.name)
        },
      })
    } else if (cmd === "tail") {
      // watch a session log LIVE (read-only, another dsh process may own
      // it) — poll-decodes the jsonl.zstd and replays durable rows into
      // the transcript. /tail <sessionId|prefix>
      const target = parts[1] ?? ""
      if (!target) {
        push({ kind: "error", text: "usage: /tail <sessionId or prefix>" })
        return
      }
      setShowWelcome(false)
      setBusy(false)
      const err = await props.deps.session.startRemoteTail(target)
      if (err) push({ kind: "error", text: `tail: ${err}` })
      else push({ kind: "system", text: `watching ${target.slice(0, 8)} (read-only, 2s poll) — /new stops` })
    } else if (cmd === "repair") {
      // session-log integrity report (tui-pi repair-dialog's scan half —
      // diagnostic only; nothing is deleted or rewritten)
      for (const line of props.deps.session.repairScan()) push({ kind: "system", text: line })
    } else if (cmd === "queue") {
      setShowWelcome(false)
      if (!arg) {
        setQueueOpen((v) => !v)
        return
      }
      setQueueMsgs((arr) => [...arr, arg])
      push({ kind: "system", text: `queued (${queueMsgs().length} waiting) — sends after the current turn` })
    } else if (cmd === "session") {
      // current session info; rename goes through the host session-title
      // plugin when mounted (best-effort, silent if absent)
      push({ kind: "system", text: `session: ${label()} · 💬 ${msgCount()} · 🛠 ${toolCount()} · up ${turnElapsed()}s` })
      if (parts[1]) push({ kind: "system", text: `rename: ${parts.slice(1).join(" ")} (needs session-title plugin)` })
    } else if (cmd === "plugins") {
      const list = props.deps.session.listPlugins()
      if (list.length === 0) push({ kind: "system", text: "no plugins installed" })
      else {
        push({ kind: "system", text: `plugins (${list.length}):` })
        for (const p of list) push({ kind: "system", text: `  ● ${p.name}@${p.version}` })
      }
    } else if (cmd === "skills") {
      const skills = props.deps.session.listSkills()
      if (skills.length === 0) push({ kind: "system", text: "no skills registered" })
      else {
        push({ kind: "system", text: `skills (${skills.length}):` })
        for (const k of skills) push({ kind: "system", text: `  ● ${k.name} — ${k.description}` })
      }
    } else if (cmd === "reload") {
      const err = await props.deps.session.reloadPlugins()
      if (err) push({ kind: "error", text: `reload failed: ${err}` })
      else push({ kind: "system", text: "plugins reloaded" })
    } else if (cmd === "settings") {
      // host settings browser: namespaces from settings.describe(); enter
      // a namespace to list its top-level keys; picking a key mutates it
      // (string overwrite) with revision guard. Read-only when the
      // settings service is absent.
      const descs = await props.deps.session.settingsDescribe()
      if (descs.length === 0) {
        push({ kind: "system", text: "settings service unavailable" })
        return
      }
      openOverlay({
        title: `settings (${descs.length} namespaces)`,
        items: descs.map((d) => ({ label: d.ns, value: d.ns, description: `revision ${d.revision ?? "?"}` })),
        onSelect: (ns) => {
          const desc = descs.find((d) => d.ns === ns)
          const value = desc?.value ?? {}
          const keys = Object.keys(value ?? {})
          if (keys.length === 0) {
            push({ kind: "system", text: `${ns}: no top-level keys` })
            return
          }
          openOverlay({
            title: `settings: ${ns}`,
            items: keys.map((k) => ({ label: k, value: k, description: JSON.stringify((value as any)[k]).slice(0, 70) })),
            onSelect: (key) => {
              const cur = (value as any)[key]
              push({ kind: "system", text: `${ns}.${key} = ${JSON.stringify(cur)} — edit via /settings-edit ${ns} ${key} <json>` })
            },
          })
        },
      })
    } else if (cmd === "config") {
      // deep settings: /config lists, /config key value writes. Persisted
      // to the profile config.json; applied live (retention filters
      // /sessions, favorites/hidden shape /model, askUserTimeoutSec arms
      // the ask overlay timer)
      const KEYS: { key: string; desc: string; parse: (v: string) => unknown }[] = [
        { key: "retentionDays", desc: "/sessions retention days (0 = unlimited)", parse: (v) => Number(v) },
        { key: "askUserTimeoutSec", desc: "ask overlay timeout seconds (0 = none)", parse: (v) => Number(v) },
        { key: "favoriteModels", desc: "favorite models (comma-separated provider/model)", parse: (v) => v.split(",").map((x) => x.trim()).filter(Boolean) },
        { key: "hiddenModels", desc: "hidden models (comma-separated provider/model)", parse: (v) => v.split(",").map((x) => x.trim()).filter(Boolean) },
        { key: "maxAgents", desc: "max concurrently running subagents (0 = unlimited)", parse: (v) => Number(v) },
        { key: "maxRounds", desc: "max rounds per subagent (0 = unlimited, enforced at the approval layer)", parse: (v) => Number(v) },
        { key: "iconSet", desc: "dock icon style: default | minimal", parse: (v) => (["default", "minimal"].includes(v) ? v : "default") },
      ]
      if (parts.length >= 3) {
        const spec = KEYS.find((k) => k.key === parts[1])
        if (!spec) {
          push({ kind: "error", text: `unknown config key: ${parts[1]}` })
        } else {
          const merged = props.deps.session.configSave({ [spec.key]: spec.parse(parts.slice(2).join(" ")) })
          setPluginConfig(merged)
          push({ kind: "system", text: `${spec.key} = ${JSON.stringify(merged[spec.key])} — ${spec.desc}` })
        }
      } else {
        push({ kind: "system", text: "config keys:" })
        for (const k of KEYS) {
          push({ kind: "system", text: `  ${k.key} = ${JSON.stringify(pluginConfig()[k.key] ?? "(unset)")} — ${k.desc}` })
        }
        push({ kind: "system", text: "set: /config <key> <value>" })
      }
    } else if (cmd === "btw") {
      // by-the-way side question: one-shot side call, framed overlay only —
      // the main transcript never sees it; bare /btw toggles the review panel
      if (!arg) {
        setBtwOpen((v) => !v)
        if (!btwOpen()) setShowWelcome(false)
        return
      }
      if (btwLive()) {
        push({ kind: "system", text: "a btw side call is already running — it will finish first" })
        return
      }
      const snapshot = items().filter((it) => it.kind === "user" || it.kind === "assistant").slice(-8).map((it) => `${it.kind === "user" ? "Q" : "A"}: ${it.text.slice(0, 150)}`)
      const q = arg
      setBtwLive({ q, a: "" })
      setShowWelcome(false)
      void props.deps.session
        .btwAsk(q, snapshot, (full) => setBtwLive({ q, a: full.slice(-400) }))
        .then((a) => {
          setBtwLive(null)
          if (a) setBtwPairs((arr) => [...arr.slice(-4), { q, a }])
        })
      return
    } else if (cmd === "hints") {
      setHintsVisible((v) => !v)
      push({ kind: "system", text: `key hints ${hintsVisible() ? "hidden" : "shown"}` })
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
   * line stays unlocked while busy and enter feeds the agent mid-turn.
   * The steered text replaces the last-input line (tui-pi: a routed
   * prompt updates the ` ● ` echo too). */
  const steerText = (text: string) => {
    push({ kind: "user", text: `⚡ ${text}` })
    setLastPrompt(text)
    props.deps.session.steer(text)
  }

  async function send(text: string) {
    setShowWelcome(false)
    push({ kind: "user", text })
    setLastPrompt(text)
    setBusy(true)
    // Fresh dock state: the think panel expands empty; tool entries keep
    // accumulating across turns (they are the session's tool ledger). Any
    // manually re-expanded detail view closes for the new turn.
    dock.onTurnStart()
    setTurnElapsed(0)
    setStreaming(false)
    if (subagentClearTimer !== undefined) {
      clearTimeout(subagentClearTimer)
      subagentClearTimer = undefined
    }
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
            setStreaming(true)
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
            refreshExecMode()
            setUsage((v) => ({ prompt: v.prompt + u.prompt, completion: v.completion + u.completion, turns: v.turns + 1 }))
          },
          onStreamTick: ({ chars, at }) => {
            // live tok/s for the powerline ⚡ segment (chars/4 estimate)
            const sec = (at - turnStartAt) / 1000
            if (sec > 0.3 && chars > 0) setLiveTps(Math.round(chars / 4 / sec))
          },
          onTodos: (list) => setTodos(list),
          onSubagentUpdate: (entries) => {
            setSubagents(entries)
            if (entries.length > 0 && entries.every((e) => e.status !== "running")) scheduleSubagentClear()
          },
          onApprove: (name: string, args: Record<string, unknown>) => {
            // subagent policy (tui-pi subagent-policy concept): spawn tools
            // over the maxAgents cap are rejected at the approval layer
            if (SPAWN_TOOLS.includes(name)) {
              const cap = Number(pluginConfig().maxAgents ?? 0)
              const running = subagents().filter((e) => e.status === "running").length
              if (cap > 0 && running >= cap) {
                push({ kind: "error", text: `spawn rejected: maxAgents=${cap} reached (${running} running)` })
                return Promise.resolve(false)
              }
            }
            // Only the modal card lives here; the dock entry is filed by
            // onToolStart (the tool/call event), which fires for
            // auto-allowed calls that never reach this waterfall.
            setApproval({ name, args: JSON.stringify(args) })
            return new Promise<boolean>((resolve) => {
              approveResolve = resolve
            })
          },
          onToolStart: (start) => {
            // ask_user_question: parse the questions now; open a fresh
            // stash window so only THIS ask's overlay answer can fill it.
            if (start.name === ASK_TOOL_NAME) {
              const parsed = parseAskCallArgs(start.args)
              if (parsed && start.callId) askPending.set(start.callId, parsed)
              askStash = null
            }
            dock.onToolStart(start)
          },
          onToolRun: (run: ToolRun) => {
            // ask_user_question result: pair it with its call and paint the
            // Q&A transcript block (questions + options + the user's pick).
            const asked = (run.callId !== undefined ? askPending.get(run.callId) : undefined) ?? (run.name === ASK_TOOL_NAME ? parseAskCallArgs(run.argsPretty) : undefined)
            if (asked) {
              if (run.callId !== undefined) askPending.delete(run.callId)
              const item = buildAskTranscriptItem(asked, parseAskAnswers(run.output), askStash?.picks, run.ok)
              askStash = null
              if (item) push(item as TItem)
            }
            dock.onToolRun(run)
          },
          onReattachedMissed: (rows: { kind: "user" | "assistant"; text: string }[]) => {
            // Idle-release wake: another surface drove the session while our
            // handle was freed. The missed rows belong BEFORE the prompt row
            // send() just pushed — splice them in ahead of it.
            if (rows.length === 0) return
            setItems((arr) => {
              const painted = rows.map((it) =>
                it.kind === "assistant" ? { kind: "assistant" as const, text: it.text, final: true } : { kind: "user" as const, text: it.text },
              )
              if (arr.length === 0) return painted as TItem[]
              return [...arr.slice(0, -1), ...painted, arr[arr.length - 1]] as TItem[]
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
      dock.onTurnEnd()
      setStreaming(false)
      setApproval(null)
      approveResolve = null
      setBusy(false)
      setLiveTps(null)
      // lastPrompt intentionally NOT cleared here: the ` ● ` echo is
      // session-scoped now (tui-pi semantics) — it persists across turns
      // and only resets when the session itself changes (/new, resume, fork).
      // queue drain: the next queued message goes out right after the
      // turn settles (400ms beat so the dock collapse renders first)
      const nextQueued = queueMsgs()[0]
      if (nextQueued !== undefined) {
        setQueueMsgs((arr) => arr.slice(1))
        setTimeout(() => void send(nextQueued), 400)
      }
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
    // Subagent viewer (ctrl+G opened it): esc backs out, s opens the
    // one-line steer entry for a RUNNING child. The editor is blurred
    // while the viewer is up so typed keys land here.
    if (viewerId()) {
      if (key.name === "escape") {
        if (steerFor()) {
          setSteerFor(null)
          setSteerBuffer("")
        } else {
          setViewerId(null)
        }
        setFocusKey((k) => k + 1)
        return
      }
      if (steerFor()) {
        if (key.name === "return") {
          const text = steerBuffer().trim()
          setSteerFor(null)
          setSteerBuffer("")
          if (text) {
            const ok = props.deps.session.steerChild(viewerId()!, text)
            push({ kind: ok ? "system" : "error", text: ok ? `⚡ steered child ${viewerId()!.slice(0, 8)}` : "child is not steerable (settled or not in this process)" })
          }
        } else if (key.name === "backspace") {
          setSteerBuffer((b) => b.slice(0, -1))
        } else {
          const ch = key.sequence ?? ""
          if (ch.length === 1 && /[\x20-\x7e]/.test(ch)) setSteerBuffer((b) => b + ch)
        }
        return
      }
      if (key.sequence === "s") {
        const entry = subagents().find((e) => e.id === viewerId())
        if (entry?.status === "running") {
          setSteerFor(viewerId())
          setSteerBuffer("")
        } else {
          push({ kind: "system", text: "child is settled — only running children can be steered" })
        }
        return
      }
      return
    }
    // ctrl+G: subagent viewer (list → transcript) — keybindings.json may
    // rebind it ("viewer": "ctrl+g")
    const viewerKey = hot("viewer", "ctrl+g")
    const vkCtrl = viewerKey.startsWith("ctrl+")
    const vkName = vkCtrl ? viewerKey.slice(5) : viewerKey
    if (key.ctrl === vkCtrl && key.name === vkName) {
      const list = subagents()
      if (list.length === 0) {
        push({ kind: "system", text: "no subagents yet" })
        return
      }
      openOverlay({
        title: "subagents — pick to view transcript",
        items: list.map((e) => ({ label: `${e.label}${e.model ? ` · ${e.model}` : ""}`, value: e.id, description: `${e.status} · ↻${e.rounds}` })),
        onSelect: (value) => openViewer(value),
      })
      return
    }
    // Dock detail re-expand: ctrl+t (last thought) / ctrl+o (tool ledger)
    // re-open the collapsed dock panels; a fresh turn closes them again.
    // login feature's key stages (key entry / logout confirm) come before
    // everything else while its panel is up
    if (loginFeature.active() && loginFeature.handleKey(key)) return
    const thinkKey = hot("think", "ctrl+t")
    const tkCtrl = thinkKey.startsWith("ctrl+")
    if (key.ctrl === tkCtrl && key.name === (tkCtrl ? thinkKey.slice(5) : thinkKey)) {
      dock.toggleExpand("think")
      return
    }
    const toolsKey = hot("tools", "ctrl+o")
    const toCtrl = toolsKey.startsWith("ctrl+")
    if (key.ctrl === toCtrl && key.name === (toCtrl ? toolsKey.slice(5) : toolsKey)) {
      dock.toggleExpand("tool")
      return
    }
    // scrollback lookback: PgUp/PgDn page through the transcript region
    // model picker (ctrl+l) and session search (ctrl+alt+f) hotkeys
    const modelKey = hot("model", "ctrl+l")
    if (key.ctrl && !key.meta && key.name === modelKey.replace("ctrl+", "")) {
      void runCommand("/model")
      return
    }
    const searchKey = hot("search", "ctrl+alt+f")
    if (key.ctrl && (key as any).option && key.name === searchKey.replace("ctrl+alt+", "")) {
      void runCommand("/search")
      return
    }
    const upKey = hot("scrollUp", "pageup")
    const dnKey = hot("scrollDown", "pagedown")
    if (key.name === upKey || (upKey.startsWith("ctrl+") && key.ctrl && key.name === upKey.slice(5))) {
      scrollUp()
      return
    }
    if (key.name === dnKey || (dnKey.startsWith("ctrl+") && key.ctrl && key.name === dnKey.slice(5))) {
      scrollDown()
      return
    }
    // esc closes the slash palette (the editor keeps its buffer).
    if (key.name === "escape" && menuVisible()) setMenuOpen(false)
  })

  // Bracketed paste (Ghostty/tmux Cmd+V wrap the burst in ESC[200~…201~
  // because OpenTUI enables mode 2004): the parser strips the wrappers and
  // emits a paste EVENT — which never reaches keypress-level handlers, so
  // the custom text-capture surfaces (login entry fields, the steer line)
  // silently dropped pasted text. Global paste listeners run before the
  // focused renderable's, so: route to the consuming modal first; when no
  // modal owns input, let the event fall through to the focused editor
  // (it handles paste natively); when a non-text modal holds the screen,
  // swallow the paste so nothing lands in the blurred editor.
  usePaste((event) => {
    const text = decodePasteBytes(event.bytes)
    if (loginFeature.panelOpen()) {
      // entry fields consume the text; other stages (menu/confirm) just
      // swallow it — same posture as keys under the panel
      loginFeature.handlePaste(text)
      event.preventDefault()
      return
    }
    if (viewerId() && steerFor()) {
      const cleaned = [...text].filter((c) => c >= "\x20" && c <= "\x7e").join("")
      if (cleaned) setSteerBuffer((b) => b + cleaned)
      event.preventDefault()
      return
    }
    if (approval() || overlay() || stopConfirm() || viewerId()) event.preventDefault()
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
      { text: `dsh(${execMode()})`, bg: POWERLINE_COLORS.brand },
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
    if (gitBranch()) segs.push({ text: `⎇ ${gitBranch()}`, bg: POWERLINE_COLORS.provider })
    if (msgCount() > 0) segs.push({ text: `💬 ${msgCount()}`, bg: POWERLINE_COLORS.messages })
    const tools = toolSegment(toolCount())
    if (tools) segs.push(tools)
    // cache hit rate (tui-pi's ⚡ CH% segment): shown once the host
    // reports cache traffic
    const ch = props.deps.session.cacheHitRate()
    if (ch !== null) segs.push({ text: `⚡ CH${ch.toFixed(1)}%`, bg: POWERLINE_COLORS.speed })
    // Streaming speed: live while the turn runs (the closing rate lives in
    // /usage via lastTurnStats).
    const speed = speedSegment(busy() ? liveTps() : null, th())
    if (speed) segs.push(speed)
    return segs
  }

  // status bar phase: approval > tool > streaming reply > thinking
  const statusPhase = createMemo<StatusPhase | null>(() => {
    if (!busy()) return null
    if (approval()) return "approve"
    if (dock.toolActive()) return "tool"
    if (streaming()) return "stream"
    return "think"
  })

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
      {dock.dockView()}
      {approval() ? (
        <ApprovalCard toolName={approval()!.name} args={approval()!.args} hint={t("agent.approve.hint")} theme={th()} />
      ) : null}
      {stopConfirm() ? (
        <box style={{ border: true, borderStyle: "rounded", borderColor: th().tokens.warn, flexDirection: "column", padding: 1 }}>
          <text style={{ fg: th().tokens.warn }}>abort this turn?</text>
          <text style={{ fg: th().tokens.dim }}>y aborts · n/esc resumes</text>
        </box>
      ) : null}
      {viewerId() ? (
        <box style={{ border: true, borderStyle: "rounded", borderColor: th().tokens.border, flexDirection: "column", padding: 1, height: 10 }}>
          <text style={{ fg: th().tokens.accent }}>{`child ${viewerId()!.slice(0, 8)} · s steer · esc back`}</text>
          <For each={viewerLines().slice(-7)}>
            {(l) => <text style={{ fg: th().tokens.dim }}>{l}</text>}
          </For>
        </box>
      ) : null}
      {steerFor() ? (
        <box style={{ border: true, borderStyle: "rounded", borderColor: th().tokens.accent, flexDirection: "row", padding: 1 }}>
          <text style={{ fg: th().tokens.accent }}>⚡ steer: </text>
          <text style={{ fg: th().tokens.text }}>{steerBuffer() || " "}</text>
        </box>
      ) : null}
      {btwOpen() || btwLive() ? (
        <box style={{ border: true, borderStyle: "rounded", borderColor: th().tokens.accent, flexDirection: "column", padding: 1, maxHeight: 10 }}>
          <box style={{ flexDirection: "row" }}>
            <text style={{ fg: th().tokens.accent }}>btw</text>
            <box style={{ flexGrow: 1 }} />
            <text style={{ fg: th().tokens.dim }}>/btw close</text>
          </box>
          <For each={btwLive() ? [btwLive()!] : btwPairs().slice(-2)}>
            {(pair) => (
              <box style={{ flexDirection: "column" }}>
                <text style={{ fg: th().tokens.dim }}>{`Q: ${pair.q.slice(0, 90)}`}</text>
                <For each={pair.a.split("\n").slice(0, 4)}>
                  {(l) => <text style={{ fg: th().tokens.text }}>{`A: ${l.slice(0, 100)}`}</text>}
                </For>
              </box>
            )}
          </For>
        </box>
      ) : null}
      {queueOpen() || queueMsgs().length > 0 ? (
        <box style={{ border: true, borderStyle: "rounded", borderColor: th().tokens.border, flexDirection: "column", padding: 1, maxHeight: 8 }}>
          <box style={{ flexDirection: "row" }}>
            <text style={{ fg: th().tokens.accent }}>queue</text>
            <box style={{ flexGrow: 1 }} />
            <text style={{ fg: th().tokens.dim }}>/queue &lt;msg&gt; enqueue · bare toggle</text>
          </box>
          <For each={queueMsgs()}>
            {(m, i) => <text style={{ fg: th().tokens.text }}>{`${i() + 1}. ${m.slice(0, 80)}`}</text>}
          </For>
        </box>
      ) : null}
      {loginFeature.view()}
      {overlay() ? (
        <Select
          title={overlay()?.title ?? ""}
          items={overlay()?.items ?? []}
          theme={th()}
          onSelect={onOverlaySelect}
          onPreview={overlay()?.onPreview}
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
      {/* the busy-state line (Kimi/opencode-style): animated spinner +
          rotating verbs + elapsed, only while a turn runs */}
      <StatusBar
        theme={th()}
        phase={statusPhase()}
        elapsed={turnElapsed}
        detail={() => dock.runningToolName() ?? ""}
        verbs={pluginConfig().statusVerbs as Partial<Record<StatusPhase, string[]>> | undefined}
        width={termCols()}
      />
      {/* todo panel directly ABOVE the input box (user-spec stack); the
          widget itself renders zero rows when the list is empty */}
      <TodosWidget todos={todos()} theme={th()} />
      {/* busy stays false on purpose: the line is never locked — mid-turn
          typing STEERS, and the busy state reads from the dock widgets.
          The editor blurs under modals (approval/overlay) so their keys
          never leak into the buffer. */}
      <InputLine
        focused={!(approval() || overlay() || loginFeature.panelOpen() || viewerId() !== null)}
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
      {/* fixed dock BELOW the input line (user-spec stack): the ` ● `
          last-input echo while the turn runs, then the subagent rail */}
      <LastPromptLine text={lastPrompt()} theme={th()} />
      <SubagentWidget entries={subagents()} theme={th()} />
      {hintsVisible() ? <FooterHints theme={th()} /> : null}
      <PowerlineFooter left={powerlineSegments()} right={clock()} theme={th()} />
    </box>
  )
}
