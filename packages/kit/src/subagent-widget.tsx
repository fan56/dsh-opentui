/**
 * Subagent dock widget (tui-pi style live-activity panel). One row per
 * child agent session, drawn as a tree rail: a still-running child is an
 * accent row with a braille spinner (advanced by its elapsed-seconds
 * prop, bumped by the host's 1s tick) plus a dim continuation row with
 * the tail of its last assistant text; a settled child collapses to a
 * single dim row with a ✔/✘/⊘ glyph. The rail closes (└─) on the last
 * entry, and with no entries the widget renders zero rows (fully
 * hidden). Pure presentation: the host drives it entirely through state
 * props, no timers and no keyboard handling here.
 */
import { For, Show, type JSX } from "solid-js"
import type { Theme } from "./theme.ts"

/** One child agent session tracked by the dock. */
export interface SubagentEntry {
  /** Child session id (displayed as its 8-char tail when no label). */
  id: string
  label: string
  /** Provider/model route when known ("provider/model" or bare model). */
  model?: string
  status: "running" | "completed" | "failed" | "cancelled"
  /** Completed assistant messages (rounds) in the child session. */
  rounds: number
  /** Accumulated tokens when known (prompt+completion). */
  tokens?: number
  /** Seconds since the child started (drives the spinner; bumped by the host's 1s tick). */
  elapsed: number
  /** Tail of the child's last assistant text, single line, ~80 chars. */
  lastLine?: string
}

/** Braille spinner frames, stepped by the child's elapsed time. */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
/** Spinner animation speed (frames per second of elapsed time). */
const SPINNER_FPS = 8
/** Tail characters of the session id used as the name when unlabeled. */
const ID_TAIL = 8
/** Characters of `lastLine` kept on the continuation row. */
const LAST_LINE_WIDTH = 80

/** Spinner glyph for a running child, advanced by its elapsed seconds. */
function spinnerFrame(elapsed: number): string {
  return SPINNER_FRAMES[Math.floor(elapsed * SPINNER_FPS) % SPINNER_FRAMES.length]
}

/** Display name: the label, or the session id's tail when unlabeled. */
function displayName(e: SubagentEntry): string {
  if (e.label) return e.label
  return e.id.length > ID_TAIL ? e.id.slice(-ID_TAIL) : e.id
}

/** ` · `-joined metadata tail shared by running and settled rows. */
function metaSuffix(e: SubagentEntry): string {
  const parts: string[] = []
  if (e.model) parts.push(e.model)
  parts.push(`↻${e.rounds}`)
  parts.push(`${e.elapsed}s`)
  if (e.tokens !== undefined) parts.push(`${e.tokens} tok`)
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : ""
}

/** Continuation payload: lastLine flattened to one clamped line. */
function tailLine(e: SubagentEntry): string {
  return (e.lastLine ?? "").replace(/\s+/g, " ").trim().slice(0, LAST_LINE_WIDTH)
}

/**
 * Subagent dock: the tree of child agent rows described above. With no
 * entries it renders zero rows.
 */
export function SubagentWidget(props: { entries: SubagentEntry[]; theme: Theme }): JSX.Element {
  const th = () => props.theme

  return (
    <Show when={props.entries.length > 0}>
      <For each={props.entries}>
        {(e, i) => {
          // The rail closes on the last entry: └─ instead of ├─.
          const branch = () => (i() === props.entries.length - 1 ? "└─" : "├─")
          const name = () => displayName(e)
          const meta = () => metaSuffix(e)
          // Settled glyph; the fallback branch only renders when not running.
          const glyph = () => (e.status === "completed" ? "✔" : e.status === "failed" ? "✘" : "⊘")
          return (
            <>
              <Show
                when={e.status === "running"}
                fallback={
                  // Settled: one dim row, no continuation.
                  <text style={{ fg: th().tokens.dim }}>{`${branch()} ${glyph()} ${name()}${meta()}`}</text>
                }
              >
                <text style={{ fg: th().tokens.accent }}>
                  {`${branch()} ${spinnerFrame(e.elapsed)} ${name()}${meta()}`}
                </text>
                <Show when={tailLine(e).length > 0}>
                  <text style={{ fg: th().tokens.dim, wrapMode: "none", truncate: true }}>{`│   ${tailLine(e)}`}</text>
                </Show>
              </Show>
            </>
          )
        }}
      </For>
    </Show>
  )
}
