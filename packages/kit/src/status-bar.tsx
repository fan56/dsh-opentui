/**
 * StatusBar — the busy-state line (Kimi/opencode-style): one animated row
 * above the input showing WHAT the agent is doing right now.
 *
 * Anatomy: [braille spinner] [verb…] [elapsed s] [phase detail]
 * - spinner advances every ~125ms (braille dots)
 * - VERB ROTATES through a per-phase pool every ~2.5s (思考中→钻研中→…,
 *   Kimi/Claude-code spinnerVerbs style; pools overridable via config)
 * - phases: think (reasoning streaming), tool (a tool is running),
 *   stream (reply text streaming), approve (waiting on the approval card)
 * - idle → the line is gone (mount-on-busy); no fade state machine here,
 *   the caller unmounts it when the turn ends
 */
import { createSignal, onCleanup, For, Show, type JSX } from "solid-js"
import type { Theme } from "./theme.ts"

export type StatusPhase = "think" | "tool" | "stream" | "approve"

/** Rotating verb pools per phase (zh). Config can override via statusVerbs. */
const DEFAULT_VERBS: Record<StatusPhase, string[]> = {
  think: ["Thinking", "Pondering", "Reasoning", "Reflecting", "Deliberating", "Mulling"],
  tool: ["Executing", "Running", "Processing", "Building"],
  stream: ["Writing", "Composing", "Typing", "Drafting"],
  approve: ["Waiting"],
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const SPINNER_MS = 125
const VERB_MS = 2500

// the BRAND WHALE is the comet head for every phase (emoji cannot be
// horizontally mirrored in terminals — direction reads from the tail
// side + movement; phases still differ by color and verb)
const PHASE_ICON: Record<StatusPhase, string> = {
  think: "🧠",
  tool: "🛠",
  stream: "📝",
  approve: "⏳",
}

const TAIL = 5
const RAMP = ["█", "▓", "▒", "░"]
const BAR_MS = 80

export function StatusBar(props: {
  theme: Theme
  /** Current busy phase (null = idle → renders nothing). */
  phase: StatusPhase | null
  /** Seconds since the turn started (drives the timer readout). */
  elapsed: () => number
  /** Short phase detail (e.g. the running tool's name). */
  detail?: () => string
  /** Verb pool override: { think?: string[], tool?: string[], … }. */
  verbs?: Partial<Record<StatusPhase, string[]>>
  /** Unused now (fixed track); kept for API compat. */
  width?: number
}): JSX.Element {
  const [tick, setTick] = createSignal(0)
  const timer = setInterval(() => setTick((t) => t + 1), BAR_MS)
  onCleanup(() => clearInterval(timer))

  const pools = (): Record<StatusPhase, string[]> => ({
    think: props.verbs?.think ?? DEFAULT_VERBS.think,
    tool: props.verbs?.tool ?? DEFAULT_VERBS.tool,
    stream: props.verbs?.stream ?? DEFAULT_VERBS.stream,
    approve: props.verbs?.approve ?? DEFAULT_VERBS.approve,
  })

  const fg = () => {
    const th = props.theme.tokens
    if (props.phase === "think") return th.thinking ?? th.accent
    if (props.phase === "tool") return th.toolOk ?? th.ok
    if (props.phase === "approve") return th.warn
    return th.accent
  }

  /** Fixed-width comet track: the whale 🐳 is the moving head (2 display
   * columns, no arrow — the tail side reads the travel direction).
   * Track = FIXED 15 DISPLAY COLUMNS; the label carries the per-phase
   * icon. */
  const TRACK_COLS = 15
  const ASSEMBLY = 2 // 🐳 spans two display columns
  const row = (): { text: string; fg: string }[] => {
    const phase = props.phase
    if (phase === null) return []
    const pool = pools()[phase]
    const verb = pool[Math.floor((tick() * BAR_MS) / VERB_MS) % pool.length]
    const detail = props.detail?.() ?? ""
    const label = `${PHASE_ICON[phase]} ${verb}... ${props.elapsed()}s${detail ? ` · ${detail}` : ""}`
    const trackFg = props.theme.tokens.border
    const headFg = fg()

    // assembly start column ping-pongs over [0, TRACK_COLS - ASSEMBLY]
    const span = TRACK_COLS - ASSEMBLY
    const step = Math.floor(tick() % (span * 2))
    const start = step < span ? step : span * 2 - step
    const dirRight = step < span
    const stern = dirRight ? start : start + ASSEMBLY // first tail column
    const tailEnd = dirRight ? stern - TAIL : stern + TAIL // exclusive

    const runs: { text: string; fg: string }[] = []
    let buf = ""
    let bufFg = trackFg
    const flush = (f: string) => {
      if (buf) runs.push({ text: buf, fg: bufFg })
      buf = ""
      bufFg = f
    }
    for (let c = 0; c < TRACK_COLS; c++) {
      if (c === start) {
        flush(headFg)
        runs.push({ text: "🐳", fg: headFg })
        bufFg = trackFg
        c += 1 // whale spans two display columns
        continue
      }
      const behind = dirRight ? stern - c : c - stern
      const inTail = dirRight ? c < stern && c > tailEnd : c > stern && c < tailEnd
      if (inTail && behind >= 0) {
        const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(behind / 2) + 1)]!
        if (headFg !== bufFg) flush(headFg)
        buf += ch
      } else {
        if (trackFg !== bufFg) flush(trackFg)
        buf += "░"
      }
    }
    flush(trackFg)
    runs.push({ text: ` ${label}`, fg: headFg })
    return runs
  }

  return (
    <Show when={props.phase !== null}>
      <box style={{ flexDirection: "row", paddingLeft: 1, paddingRight: 1, height: 1, flexGrow: 0 }}>
        <For each={row()}>
          {(r) => (
            <text style={{ fg: r.fg }} wrapMode="none">
              {r.text}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}
