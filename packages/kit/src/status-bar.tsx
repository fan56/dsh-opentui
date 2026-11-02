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
  tool: ["Working", "Executing", "Running", "Processing", "Building"],
  stream: ["Writing", "Composing", "Typing", "Drafting"],
  approve: ["Waiting"],
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const SPINNER_MS = 125
const VERB_MS = 2500

const PHASE_ICON: Record<StatusPhase, string> = {
  think: "💭",
  tool: "🔧",
  stream: "✍",
  approve: "⚠",
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
  /** Total row width (text left + comet bar to the right edge). */
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

  const spinner = () => SPINNER_FRAMES[Math.floor(tick() / (VERB_MS / BAR_MS / 8)) % SPINNER_FRAMES.length]

  /** One row: [text] left + comet bar filling the rest to the right edge. */
  const row = (): { text: string; fg: string }[] => {
    const phase = props.phase
    if (phase === null) return []
    const total = props.width ?? 80
    const spinner = SPINNER_FRAMES[tick() % SPINNER_FRAMES.length]
    const pool = pools()[phase]
    const verb = pool[Math.floor((tick() * BAR_MS) / VERB_MS) % pool.length]
    const detail = props.detail?.() ?? ""
    const label = ` ${spinner} ${PHASE_ICON[phase]} ${verb}... ${props.elapsed()}s${detail ? ` · ${detail}` : ""} `
    const trackFg = props.theme.tokens.border
    const headFg = fg()

    // comet geometry over the FULL row width (behind the label too)
    const cells = Math.max(8, total - 2)
    const head = Math.floor((tick() * 1) % (cells * 2))
    const pos = head < cells ? head : cells * 2 - 1 - head // ping-pong
    const dir = head < cells ? 1 : -1

    // text INSIDE the track: the ░ track spans the FULL width, the label
    // occupies the leading cells, and the comet travels the whole width —
    // passing BEHIND the label (label cells win; the comet emerges on
    // either side)
    const runs: { text: string; fg: string }[] = []
    let buf = ""
    let bufFg = trackFg
    const flush = (f: string) => {
      if (buf) runs.push({ text: buf, fg: bufFg })
      buf = ""
      bufFg = f
    }
    const labelChars = [...label]
    for (let c = 0; c < cells; c++) {
      let ch: string
      let cellFg = trackFg
      if (c < labelChars.length) {
        ch = labelChars[c]!
        cellFg = headFg
      } else if (c === pos) {
        ch = RAMP[0]!
        cellFg = headFg
      } else {
        ch = "░"
        for (let i = 1; i <= TAIL; i++) {
          if (c === pos - dir * i) {
            ch = RAMP[Math.min(RAMP.length - 1, Math.floor(i / 2) + 1)]!
            cellFg = headFg
            break
          }
        }
      }
      if (cellFg !== bufFg) flush(cellFg)
      buf += ch
    }
    flush(trackFg)
    return runs
  }

  return (
    <Show when={props.phase !== null}>
      <box style={{ flexDirection: "row", paddingLeft: 1, paddingRight: 1, height: 1, flexGrow: 0, width: props.width ?? 80 }}>
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
