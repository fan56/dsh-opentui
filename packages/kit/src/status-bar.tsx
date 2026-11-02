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
import { createSignal, onCleanup, Show, type JSX } from "solid-js"
import type { Theme } from "./theme.ts"

export type StatusPhase = "think" | "tool" | "stream" | "approve"

/** Rotating verb pools per phase (zh). Config can override via statusVerbs. */
const DEFAULT_VERBS: Record<StatusPhase, string[]> = {
  think: ["思考中", "钻研中", "推演中", "构思中", "酝酿中", "琢磨中"],
  tool: ["执行中", "处理中", "运行中", "操作中", "施工中"],
  stream: ["撰写中", "输出中", "落笔中", "整理中"],
  approve: ["等待确认"],
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
}): JSX.Element {
  const [tick, setTick] = createSignal(0)
  const timer = setInterval(() => setTick((t) => t + 1), SPINNER_MS)
  onCleanup(() => clearInterval(timer))

  const pools = (): Record<StatusPhase, string[]> => ({
    think: props.verbs?.think ?? DEFAULT_VERBS.think,
    tool: props.verbs?.tool ?? DEFAULT_VERBS.tool,
    stream: props.verbs?.stream ?? DEFAULT_VERBS.stream,
    approve: props.verbs?.approve ?? DEFAULT_VERBS.approve,
  })

  const row = (): string | null => {
    const phase = props.phase
    if (phase === null) return null
    const spinner = SPINNER_FRAMES[Math.floor((tick() * SPINNER_MS) / SPINNER_MS) % SPINNER_FRAMES.length]
    const pool = pools()[phase]
    const verb = pool[Math.floor((tick() * SPINNER_MS) / VERB_MS) % pool.length]
    const detail = props.detail?.() ?? ""
    return `${spinner} ${PHASE_ICON[phase]} ${verb}… ${props.elapsed()}s${detail ? ` · ${detail}` : ""}`
  }

  const fg = () => {
    const th = props.theme.tokens
    if (props.phase === "think") return th.thinking ?? th.accent
    if (props.phase === "tool") return th.toolOk ?? th.ok
    if (props.phase === "approve") return th.warn
    return th.accent
  }

  return (
    <Show when={props.phase !== null}>
      <box style={{ flexDirection: "row", paddingLeft: 2, paddingRight: 2, height: 1, flexGrow: 0 }}>
        <text style={{ fg: fg(), wrapMode: "none", truncate: true }}>{row() ?? " "}</text>
      </box>
    </Show>
  )
}
