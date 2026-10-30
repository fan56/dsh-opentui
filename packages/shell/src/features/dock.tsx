/**
 * Feature: the activity dock — independent think/tool widgets built on
 * the kit WidgetFrame template (user-mandated widget system):
 * - each widget shows while it has content and fades out when empty
 *   (show appears instantly; hide fades over ~600ms, dimming + shrinking)
 * - default size is ONE summary line; auto-expands to the configured
 *   rows while actively streaming/running, collapses when idle
 * - sizes configurable per widget: 1 | 5 | 7 | 12 | full
 * - widgets stack (think above tool)
 * - each frame shows its hotkey hint (ctrl+t / ctrl+o detail keys)
 *
 * Phase rules (dsh-tui-pi live-widgets port): think opens on the first
 * reasoning delta, the first text delta ends it; tool begin/settle pair
 * by callId; turn end clears both → fade.
 */
import { createSignal, For, Show, type JSX } from "solid-js"
import { WidgetFrame, dimColor, type Theme } from "@dsh-opentui/kit"
import type { ToolWidgetEntry } from "@dsh-opentui/kit"

export interface DockDeps {
  theme: () => Theme
  /** Per-widget row size from the plugin config (default: expanded 7). */
  sizes?: () => { think?: number | "full"; tool?: number | "full" }
  /** Hotkey hints rendered in the frames. */
  hints?: () => { think?: string; tool?: string }
  /** Widget background tint override (hex); missing = accent-derived auto. */
  style?: () => { thinkBg?: string; toolBg?: string }
}

const FLUSH_MS = 60
const FADE_STEP_MS = 130
const FADE_STEPS = 5
const IDLE_COLLAPSE_MS = 2000

const BUBBLE_FRAMES = ["╹", "╹▀", "╹▀▄", " ▀▄"]
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export interface DockState {
  dockView: () => JSX.Element
  onThinkingDelta(text: string): void
  onContentDelta(text: string): void
  onToolStart(start: { callId?: string; name: string; args: string }): void
  onToolRun(run: { name: string; ok: boolean; output?: string; callId?: string; argsPretty?: string }): void
  onTurnStart(): void
  onTurnEnd(): void
  tick(): void
  toolCount(): number
  toolActive(): boolean
  /** Manual expand/collapse toggle (the widget's hotkey). */
  toggleExpand(which: "think" | "tool"): void
  reset(): void
}

export function createDockFeature(deps: DockDeps): DockState {
  const th = () => deps.theme()
  const thinkFg = () => th().tokens.thinking ?? th().tokens.accent
  const toolFg = () => th().tokens.toolOk ?? th().tokens.ok
  const dim = (fg: string) => dimColor(fg, 0.45)

  // ---- think widget state ----
  const [think, setThink] = createSignal({ visible: false, expanded: false, fading: false, fade: 0, text: "", lastAt: 0, startedAt: 0 })
  let thinkBuf = ""
  let lastFlush = 0
  // ---- tool widget state ----
  const [tools, setTools] = createSignal<ToolWidgetEntry[]>([])
  const [toolVisible, setToolVisible] = createSignal(false)
  const [toolFading, setToolFading] = createSignal(false)
  const [toolFade, setToolFade] = createSignal(0)
  const [toolExpanded, setToolExpanded] = createSignal(false)
  let lastToolAt = 0

  const flush = (force = false) => {
    const now = Date.now()
    if (!force && now - lastFlush < FLUSH_MS) return
    lastFlush = now
    setThink((s) => (s.visible ? { ...s, text: thinkBuf } : s))
  }

  // fade driver: advances both widgets' fade at FADE_STEP_MS, and handles
  // the idle auto-collapse (expanded -> 1 row after a quiet period)
  const fadeTimer = setInterval(() => {
    const now = Date.now()
    setThink((s) => {
      if (s.fading) {
        const f = Math.min(1, s.fade + 1 / FADE_STEPS)
        return f >= 1 ? { visible: false, expanded: false, fading: false, fade: 0, text: "", lastAt: 0, startedAt: 0 } : { ...s, fade: f }
      }
      if (s.visible) return { ...s, expanded: now - s.lastAt < IDLE_COLLAPSE_MS }
      return s
    })
    if (toolFading()) {
      const f = Math.min(1, toolFade() + 1 / FADE_STEPS)
      if (f >= 1) {
        setToolFading(false)
        setToolFade(0)
        setToolVisible(false)
        setTools([])
      } else setToolFade(f)
    } else if (toolVisible()) {
      setToolExpanded(now - lastToolAt < IDLE_COLLAPSE_MS || tools().some((e) => e.status === "running"))
    }
  }, FADE_STEP_MS)

  const startThinkFade = () => setThink((s) => ({ ...s, visible: true, fading: true, fade: 0, expanded: false }))

  const dockView = (): JSX.Element => {
    const t = think()
    const list = tools()
    const rowsT = (deps.sizes?.().think ?? 7) as number | "full"
    const rowsTool = (deps.sizes?.().tool ?? 7) as number | "full"
    const hints = deps.hints?.() ?? {}
    const elapsed = t.startedAt ? Math.floor((Date.now() - t.startedAt) / 1000) : 0
    const running = list.filter((e) => e.status === "running")
    const frame = SPINNER_FRAMES[Math.floor((Date.now() / 125) % SPINNER_FRAMES.length)]
    // panel background tint: config override (hex) or an accent-derived
    // auto tint (accent dimmed 82% — subtle, readable over any terminal bg)
    const bgTint = () => {
      const st = deps.style?.() ?? {}
      const override = t.visible ? st.thinkBg : st.toolBg
      if (override && override !== "auto") return override
      const border = t.visible ? thinkFg() : toolFg()
      return dimColor(border, 0.82)
    }
    return (
      <>
        <Show when={t.visible}>
          <WidgetFrame
            bg={bgTint()}
            size={t.expanded ? rowsT : 1}
            accent={thinkFg()}
            fade={t.fading ? t.fade : 0}
            title={`${BUBBLE_FRAMES[Math.floor(Date.now() / 300) % BUBBLE_FRAMES.length]} thinking · ${elapsed}s`}
            hint={hints.think}
          >
            <Show when={t.expanded}>
              <For each={t.text.split("\n").slice(-Math.max(1, (typeof rowsT === "number" ? rowsT : 7) - 2))}>
                {(line) => <text style={{ fg: dimColor(thinkFg(), 0.2) }}>{line.slice(0, 100) || " "}</text>}
              </For>
            </Show>
            <Show when={!t.expanded}>
              <text style={{ fg: dimColor(thinkFg(), 0.2) }}>{thinkBuf.split("\n").pop()?.slice(0, 80) || " "}</text>
            </Show>
          </WidgetFrame>
        </Show>
        <Show when={toolVisible() || list.length > 0}>
          <WidgetFrame
            bg={bgTint()}
            size={toolExpanded() ? rowsTool : 1}
            accent={toolFg()}
            fade={toolFading() ? toolFade() : 0}
            title={`${running.length > 0 ? `${frame} ⚒ ${running.length} running` : `⚒ ${list.length} tools`} · ${list.filter((e) => e.status === "ok").length}✔ ${list.filter((e) => e.status === "fail").length}✘`}
            hint={hints.tool}
          >
            <Show when={toolExpanded()}>
              <For each={list.slice(-(Math.max(1, (typeof rowsTool === "number" ? rowsTool : 7) - 2)))}>
                {(e) => (
                  <text style={{ fg: e.status === "running" ? toolFg() : e.status === "fail" ? th().tokens.toolFail ?? th().tokens.danger : th().tokens.toolOk ?? th().tokens.ok }}>
                    {e.status === "running"
                      ? `${SPINNER_FRAMES[Math.floor((Date.now() / 125) % SPINNER_FRAMES.length)]} ⚙ ${e.name} ${e.args.slice(0, 64)}`
                      : `${e.status === "ok" ? "✔" : "✘"} ${e.name} ${e.args.slice(0, 50)}`}
                  </text>
                )}
              </For>
            </Show>
            <Show when={!toolExpanded()}>
              <text style={{ fg: dimColor(toolFg(), 0.2) }}>
                {running.length > 0
                  ? `${running[0]!.name} ${running[0]!.args.slice(0, 60)}`
                  : `${list[0]?.name ?? ""} ${list[0]?.args?.slice(0, 50) ?? ""}`}
              </text>
            </Show>
          </WidgetFrame>
        </Show>
      </>
    )
  }

  return {
    dockView,

    onThinkingDelta(text) {
      if (text === "") return
      const now = Date.now()
      if (!think().visible || think().fading) {
        thinkBuf = text
        setThink({ visible: true, expanded: true, fading: false, fade: 0, text: thinkBuf, lastAt: now, startedAt: now })
        lastFlush = 0
        flush(true)
        return
      }
      thinkBuf += text
      setThink((s) => ({ ...s, lastAt: now, expanded: true }))
      flush()
    },

    onContentDelta() {
      // the answer is streaming: the thought is done — collapse to summary
      if (think().visible) setThink((s) => ({ ...s, expanded: false, lastAt: Date.now() }))
    },

    onToolStart(start) {
      lastToolAt = Date.now()
      setToolVisible(true)
      setToolFading(false)
      setToolFade(0)
      setToolExpanded(true)
      setTools((arr) => [...arr, { name: start.name, args: start.args, status: "running", elapsed: 0, ...(start.callId ? { callId: start.callId } : {}) }])
    },

    onToolRun(run) {
      const brief = (run.output ?? "").split("\n").slice(-2).join(" ⏎ ").slice(0, 160)
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
      lastToolAt = Date.now()
    },

    onTurnStart() {
      // fresh turn: previous content fades out, panels start empty
      setThink((s) => (s.visible ? { ...s, fading: true, fade: 0, expanded: false } : s))
      if (tools().length > 0) {
        setToolFading(true)
        setToolFade(0)
      }
      thinkBuf = ""
    },

    onTurnEnd() {
      thinkBuf = ""
      // content cleared → fade out whatever is still on screen
      if (think().visible) startThinkFade()
      if (tools().length > 0 && toolVisible()) {
        setToolFading(true)
        setToolFade(0)
      }
    },

    tick() {
      /* fades + collapse run on the feature's own FADE_STEP_MS timer */
    },

    reset() {
      hideAll()
    },

    toggleExpand(which) {
      if (which === "think") setThink((s) => (s.visible ? { ...s, expanded: !s.expanded, lastAt: Date.now() } : s))
      else setToolExpanded((v) => !v)
    },

    toolCount: () => tools().length,
    toolActive: () => tools().some((e) => e.status === "running"),
  }

  function hideAll() {
    setThink({ visible: false, expanded: false, fading: false, fade: 0, text: "", lastAt: 0, startedAt: 0 })
    thinkBuf = ""
    setTools([])
    setToolVisible(false)
    setToolFading(false)
    setToolFade(0)
    setToolExpanded(false)
  }
}
