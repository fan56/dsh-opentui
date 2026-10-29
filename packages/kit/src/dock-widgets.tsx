/**
 * Dock widgets (tui-pi style live-activity panels). Design philosophy:
 * thinking and tool traffic NEVER enters the chat stream — it is collected
 * in a dock strip above the input. While a turn is running the widgets
 * auto-expand into bordered panels; when the turn ends each collapses to
 * a single dim summary line, and an empty widget renders zero rows
 * (fully hidden). Both are pure presentation: the host drives them
 * entirely through state props, no keyboard handling here.
 */
import { For, Show, type JSX } from "solid-js"
import type { Theme } from "./theme.ts"

/** Live state of the assistant's thinking segment. */
export interface ThinkWidgetState {
  active: boolean
  text: string
  /** Seconds since the thinking segment started. */
  elapsed: number
}

/** Trailing lines of thinking text kept visible while expanded. */
const THINK_TAIL = 3
/** Leading characters of the thought shown in the collapsed one-liner. */
const THINK_SUMMARY_HEAD = 60

/**
 * Thinking dock: an accent-bordered box with a title row plus the tail of
 * the thinking text while active; a single dim line once the turn ends;
 * nothing at all when there is no thought to summarize.
 */
export function ThinkWidget(props: { state: ThinkWidgetState; theme: Theme }): JSX.Element {
  const th = () => props.theme

  // Collapsed summary: head of the thought flattened to one line.
  const summary = () => {
    const head = props.state.text
      .slice(0, THINK_SUMMARY_HEAD)
      .replace(/\s+/g, " ")
      .trim()
    return `💭 thought · ${props.state.elapsed}s · ${head}...`
  }

  return (
    <Show
      when={props.state.active}
      fallback={
        // Turn over: one dim line when a thought remains, zero rows when not.
        <Show when={props.state.text.length > 0}>
          <text style={{ fg: th().tokens.dim }}>{summary()}</text>
        </Show>
      }
    >
      <box
        style={{
          border: true,
          borderColor: th().tokens.accent,
          flexDirection: "column",
          padding: 1,
        }}
      >
        <text style={{ fg: th().tokens.accent }}>{`${BUBBLE_FRAMES[props.state.elapsed % BUBBLE_FRAMES.length]} thinking · ${props.state.elapsed}s`}</text>
        <For each={props.state.text.split("\n").slice(-THINK_TAIL)}>
          {(line) => <text style={{ fg: th().tokens.dim }}>{line || " "}</text>}
        </For>
      </box>
    </Show>
  )
}

/** One tool invocation tracked by the dock. */
export interface ToolWidgetEntry {
  name: string
  args: string
  status: "running" | "ok" | "fail"
  /** Correlates with the host's tool/call ↔ tool/result pair. */
  callId?: string
  /** Raw output; only the tail is ever shown. */
  output?: string
  /** Seconds this entry has been running (drives the spinner). */
  elapsed?: number
}

/** Characters of a tool's args shown on its expanded row. */
const TOOL_ARGS_WIDTH = 80
/** Lines of output tailed under the most recent still-running tool. */
const TOOL_OUTPUT_TAIL = 2
/** Braille spinner frames, stepped by the running tool's elapsed time. */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
/** Spinner animation speed (frames per second of elapsed time). */
const SPINNER_FPS = 8
/** pi-style thought bubble: inflates, then detaches and drifts away. */
const BUBBLE_FRAMES = ["╹", "╹▀", "╹▀▄", " ▀▄"]

/**
 * Blue for running tools. Themes carry no running/info token yet, so fall
 * back through userMark (the blue-family token in shipped themes) to a
 * plain blue; when the theme grows a proper token this collapses to it.
 */
function runningColor(theme: Theme): string {
  return theme.tokens.userMark ?? "#61afef"
}

/** Spinner glyph for an entry, advanced by its elapsed seconds. */
function spinnerFrame(elapsed: number | undefined): string {
  const t = elapsed ?? 0
  return SPINNER_FRAMES[Math.floor(t * SPINNER_FPS) % SPINNER_FRAMES.length]
}

/**
 * Tool dock: expanded while the turn is active — a bordered box with one
 * row per tool run (running blue with args, ok green, fail red) plus the
 * output tail of the last still-running tool. Once the turn ends it
 * collapses to a single dim count line; with no entries it renders zero
 * rows.
 */
export function ToolWidget(props: { entries: ToolWidgetEntry[]; active: boolean; theme: Theme }): JSX.Element {
  const th = () => props.theme

  const okCount = () => props.entries.filter((e) => e.status === "ok").length
  const failCount = () => props.entries.filter((e) => e.status === "fail").length
  const runningCount = () => props.entries.filter((e) => e.status === "running").length

  // Index of the LAST still-running entry — its output tail is the one
  // shown, so the newest activity stays visible.
  const lastRunningIndex = () => {
    let idx = -1
    for (let i = 0; i < props.entries.length; i++) {
      if (props.entries[i]?.status === "running") idx = i
    }
    return idx
  }

  // Spinner ticks off the oldest still-running entry's elapsed time.
  const headerElapsed = () => {
    let max = 0
    for (const e of props.entries) if (e.status === "running" && (e.elapsed ?? 0) > max) max = e.elapsed ?? 0
    return max
  }

  const rowFg = (e: ToolWidgetEntry): string => {
    if (e.status === "ok") return th().tokens.ok
    if (e.status === "fail") return th().tokens.toolFail ?? th().tokens.danger
    return runningColor(th())
  }

  const rowText = (e: ToolWidgetEntry): string => {
    if (e.status === "ok") return `✔ ${e.name}`
    if (e.status === "fail") return `✘ ${e.name}`
    const args = e.args.slice(0, TOOL_ARGS_WIDTH).replace(/\s+/g, " ").trim()
    return args ? `⚙ ${e.name} ${args}` : `⚙ ${e.name}`
  }

  const outputTail = (e: ToolWidgetEntry): string[] =>
    (e.output ?? "").split("\n").slice(-TOOL_OUTPUT_TAIL).filter((l) => l.trim().length > 0)

  return (
    <Show when={props.entries.length > 0}>
      <Show
        when={props.active}
        fallback={
          // Turn over: one dim summary line with the tally.
          <text style={{ fg: th().tokens.dim }}>
            {`⚒ ${props.entries.length} tools · ${okCount()}✔ ${failCount()}✘`}
          </text>
        }
      >
        <box
          style={{
            border: true,
            borderColor: th().tokens.border,
            flexDirection: "column",
            padding: 1,
          }}
        >
          <box style={{ flexDirection: "row" }}>
            <Show
              when={runningCount() > 0}
              fallback={<text style={{ fg: th().tokens.accent }}>⚒ tools</text>}
            >
              <text style={{ fg: runningColor(th()) }}>
                {`${spinnerFrame(headerElapsed())} ⚒ tools · ${runningCount()} running`}
              </text>
            </Show>
            <box style={{ flexGrow: 1 }} />
            <text style={{ fg: th().tokens.dim }}>{`${okCount()}✔ ${failCount()}✘`}</text>
          </box>
          <For each={props.entries}>
            {(e, i) => (
              <>
                <text style={{ fg: rowFg(e) }}>{rowText(e)}</text>
                <Show when={i() === lastRunningIndex() && e.output}>
                  <For each={outputTail(e)}>
                    {(line) => <text style={{ fg: th().tokens.dim }}>{`  ⎿ ${line}`}</text>}
                  </For>
                </Show>
              </>
            )}
          </For>
        </box>
      </Show>
    </Show>
  )
}
