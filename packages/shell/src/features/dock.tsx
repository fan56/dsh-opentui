/**
 * Feature: the think/tool dock — the live-activity phase machine ported
 * from dsh-tui-pi's live-widgets.ts (applyEvent/applyStreamDelta) with
 * rendering delegated to Kit's ThinkWidget/ToolWidget.
 *
 * Ported phase rules (tui-pi live-widgets.ts:320-395, activity.ts:298-323):
 * - the think panel OPENS on the first reasoning delta — never at turn
 *   start, so a silently-thinking model shows no empty box;
 * - the first text delta (answer streaming) hides the think panel;
 * - tool/call begins a running entry; tool/result settles it (by callId,
 *   name-fallback); user/message + turn/end collapse and fail stragglers;
 * - the tool ledger keeps its collapsed summary line across turns (our
 *   session ledger extension over tui-pi's hide-everything).
 */
import { createSignal, type JSX } from "solid-js"
import { ThinkWidget, ToolWidget, type ThinkWidgetState, type ToolWidgetEntry, type Theme } from "@dsh-opentui/kit"

export interface DockDeps {
  theme: () => Theme
  /** Dock icon style (plugin config iconSet): default | minimal. */
  icons?: () => "default" | "minimal" | undefined
}

/** Text flush cadence into the reactive state (same as the old Shell). */
const FLUSH_MS = 60

export interface DockState {
  thinkView: () => JSX.Element
  toolView: () => JSX.Element
  onThinkingDelta(text: string): void
  onContentDelta(text: string): void
  onToolStart(start: { callId?: string; name: string; args: string }): void
  onToolRun(run: { name: string; ok: boolean; output?: string; callId?: string; argsPretty?: string }): void
  onTurnStart(): void
  onTurnEnd(): void
  tick(): void
  reexpandThink(): void
  reexpandTools(): void
  toolCount(): number
  toolActive(): boolean
  /** Hard reset (fork/new session): panels closed, ledger emptied. */
  reset(): void
}

export function createDockFeature(deps: DockDeps): DockState {
  const [think, setThink] = createSignal<ThinkWidgetState>({ active: false, text: "", elapsed: 0 })
  const [tools, setTools] = createSignal<ToolWidgetEntry[]>([])
  // detail re-expand (ctrl+t / ctrl+o) after a turn collapsed the panels
  const [thinkRe, setThinkRe] = createSignal(false)
  const [toolRe, setToolRe] = createSignal(false)

  let thinkBuf = ""
  let lastFlush = 0
  let thinkOpenedAt = 0

  const flush = (force = false) => {
    const now = Date.now()
    if (!force && now - lastFlush < FLUSH_MS) return
    lastFlush = now
    if (think().active && thinkBuf !== think().text) setThink((prev) => ({ ...prev, text: thinkBuf }))
  }

  const hideThink = () => {
    thinkBuf = ""
    setThinkRe(false)
    setThink({ active: false, text: "", elapsed: 0 })
  }

  return {
    thinkView: () => <ThinkWidget state={{ ...think(), active: think().active || thinkRe() }} theme={deps.theme()} icons={deps.icons?.()} />,
    toolView: () => <ToolWidget entries={tools()} active={tools().some((e) => e.status === "running") || toolRe()} theme={deps.theme()} icons={deps.icons?.()} />,

    onThinkingDelta(text) {
      if (text === "") return
      if (!think().active) {
        // first delta of the burst opens the panel (tui-pi feed())
        thinkOpenedAt = Date.now()
        thinkBuf = text
        setThink({ active: true, text: "", elapsed: 0 })
        lastFlush = 0
        flush(true)
        return
      }
      thinkBuf += text
      flush()
    },

    onContentDelta() {
      // answer streaming: the thought is done (tui-pi text-delta hides both)
      if (think().active) hideThink()
    },

    onToolStart(start) {
      setToolRe(false)
      setTools((arr) => [...arr, { name: start.name, args: start.args, status: "running", elapsed: 0, ...(start.callId ? { callId: start.callId } : {}) }])
    },

    onToolRun(run) {
      const brief = (run.output ?? "").split("\n").slice(-2).join(" ⏎ ").slice(0, 200)
      setTools((arr) => {
        const idx = run.callId
          ? arr.findIndex((e) => e.callId === run.callId)
          : arr.findIndex((e) => e.status === "running" && e.name === run.name)
        const settled: ToolWidgetEntry = {
          ...(run.callId ? { callId: run.callId } : {}),
          name: run.name,
          args: run.argsPretty ?? "",
          status: run.ok ? "ok" : "fail",
          output: brief,
        }
        return idx === -1 ? [...arr, settled] : arr.map((e, i) => (i === idx ? { ...e, ...settled } : e))
      })
    },

    onTurnStart() {
      // fresh turn: the think panel stays CLOSED until the first reasoning
      // delta — no empty box during the model's silent warm-up
      hideThink()
      setThinkRe(false)
      setToolRe(false)
    },

    onTurnEnd() {
      // collapse; entries that never produced a result (declined/aborted)
      // settle as failed
      const hadThink = think().active || thinkBuf !== ""
      const text = thinkBuf
      thinkBuf = ""
      setThink((prev) => (prev.active ? { active: false, text, elapsed: prev.elapsed } : prev))
      setTools((arr) => arr.map((e) => (e.status === "running" ? { ...e, status: "fail" } : e)))
      return void hadThink
    },

    tick() {
      setThink((s) => (s.active ? { ...s, elapsed: s.elapsed + 1 } : s))
      setTools((arr) =>
        arr.some((e) => e.status === "running")
          ? arr.map((e) => (e.status === "running" ? { ...e, elapsed: (e.elapsed ?? 0) + 1 } : e))
          : arr,
      )
    },

    reexpandThink() {
      if (!think().active) setThinkRe((v) => !v)
    },
    reexpandTools() {
      if (!tools().some((e) => e.status === "running")) setToolRe((v) => !v)
    },

    /** Hard reset (fork/new session): panels closed, ledger emptied. */
    reset() {
      hideThink()
      setTools([])
      setThinkRe(false)
      setToolRe(false)
    },

    toolCount: () => tools().length,
    toolActive: () => tools().some((e) => e.status === "running"),
  }
}
