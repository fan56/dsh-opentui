/**
 * Powerline-style segmented footer, ported from dsh-tui-pi's pi-powerline
 * footer (src/footer.ts) to OpenTUI native components.
 *
 * Rendering follows the powerline convention the tui-pi footer uses: each
 * segment is one <text> painted with its own background and one space of
 * padding on both sides; between adjacent segments sits the powerline arrow
 * (U+E0B0 in a nerdfont) drawn in the PREVIOUS segment's background color
 * on the NEXT segment's background color, so the segments chain into one
 * chevron strip. After the last segment a bare arrow (previous bg as the
 * foreground, terminal-default background) closes the strip — the same
 * trailing separator buildSegments() emits in tui-pi. A flexGrow spacer
 * pushes the optional right-aligned text (the clock) to the row's end.
 */
import { For, Show, type JSX } from "solid-js"
import type { Theme } from "./theme.ts"

/** One powerline segment: label text on a filled background. */
export interface PowerlineSegment {
  /** Segment label, rendered with one space of padding on each side. */
  text: string
  /** Segment fill color (#rrggbb). */
  bg: string
  /** Explicit label color; defaults to autoContrast(bg). */
  fg?: string
}

/**
 * The segment fill palette — the same pi-powerline-footer colors tui-pi's
 * POWERLINE uses: brand blue for the fixed "dsh" segment, purple for the
 * provider, a per-level ramp for the thinking segment, a green→red ramp for
 * context usage, blue/orange for message/tool counts.
 */
export const POWERLINE_COLORS = {
  /** "dsh" brand blue. */
  brand: "#4D6BFE",
  /** Provider segment purple. */
  provider: "#6A1B9A",
  /** Thinking-level ramp (off→max). */
  thinking: {
    off: "#616161",
    minimal: "#78909C",
    low: "#5C6BC0",
    medium: "#42A5F5",
    high: "#26A69A",
    xhigh: "#FFA726",
    max: "#EF5350",
  } as Record<string, string>,
  /** Context-usage ramp (share of the context window consumed). */
  contextOk: "#4CAF50",
  contextWarn: "#FFC107",
  contextOrange: "#FF9800",
  contextDanger: "#F44336",
  /** Message-count segment blue. */
  messages: "#1565C0",
  /** Tool-count segment orange. */
  tools: "#E65100",
  /** Tokens-per-second segment teal (same Material family as the rest). */
  speed: "#00897B",
}

/** The powerline arrow separator (U+E0B0, nerdfont). */
const POWERLINE_ARROW = "\ue0b0"

/** Dark text for bright fills — near-black with a navy cast. */
const AUTO_FG_DARK = "#1a1a2e"
/** Light text for dark fills. */
const AUTO_FG_LIGHT = "#ffffff"

/** #rrggbb → [r, g, b] (0-255 each); [0,0,0] for malformed input. */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return [0, 0, 0]
  const n = m[1]!
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}

/**
 * Perceived brightness (ITU-R BT.601 weighted rgb) of a #rrggbb color,
 * 0..1. The non-linearized weighted average is deliberate: paired with the
 * 0.6 threshold below it classifies the amber contextWarn (#FFC107, 0.75)
 * and the orange fills as bright, so they get dark label text — the exact
 * behavior tui-pi's segmentText()/hexIsLight() pairing produces.
 */
function brightness(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/**
 * Readable label color on a filled segment: near-black on bright fills
 * (brightness > 0.6 — e.g. the amber contextWarn), white otherwise.
 */
function autoContrast(bg: string): string {
  return brightness(bg) > 0.6 ? AUTO_FG_DARK : AUTO_FG_LIGHT
}

/**
 * The powerline footer: one row of chained segments plus an optional
 * right-aligned text (the clock), pushed to the row's end by a flexGrow
 * spacer. Pure presentation — the caller assembles the segments (brand,
 * provider, model/thinking, context, counters...) from live counters and
 * hands them in via props; only the right text's color comes from the
 * theme (it sits on the terminal default background).
 */
export function PowerlineFooter(props: {
  left: PowerlineSegment[]
  right?: string
  theme: Theme
}): JSX.Element {
  return (
    <box style={{ flexDirection: "row" }}>
      <For each={props.left}>
        {(seg, i) => {
          const next = () => props.left[i() + 1]
          return (
            <>
              <text style={{ bg: seg.bg, fg: seg.fg ?? autoContrast(seg.bg) }}>{` ${seg.text} `}</text>
              <Show when={next()} fallback={<text style={{ fg: seg.bg }}>{POWERLINE_ARROW}</text>}>
                {(n) => <text style={{ fg: seg.bg, bg: n().bg }}>{POWERLINE_ARROW}</text>}
              </Show>
            </>
          )
        }}
      </For>
      <Show when={props.right}>
        <box style={{ flexGrow: 1 }} />
        <text style={{ fg: props.theme.tokens.text }}>{props.right}</text>
      </Show>
    </box>
  )
}

/**
 * The tokens-per-second segment (⚡ N tok/s) on the speed fill. Built like
 * every other segment — plain {text, bg} with the label color left to
 * autoContrast. Returns null when tps is unknown (no measurable turn yet),
 * so callers omit the segment: `const s = speedSegment(tps); if (s) segs.push(s)`.
 * `theme` is accepted for signature parity with future theme-aware builders;
 * the fill comes from the fixed POWERLINE_COLORS palette like the rest.
 */
export function speedSegment(tps: number | null, theme: Theme): PowerlineSegment | null {
  void theme
  if (tps === null || !Number.isFinite(tps) || tps < 0) return null
  return { text: `⚡ ${Math.round(tps)} tok/s`, bg: POWERLINE_COLORS.speed }
}

/**
 * The tool-count segment (🛠 N) on the tools fill — the tui-pi footer's
 * tool counter. Built like every other segment — plain {text, bg} with the
 * label color left to autoContrast. Returns null while no tool has run
 * (n <= 0), so callers omit the segment:
 * `const tools = toolSegment(toolCount()); if (tools) segs.push(tools)`.
 */
export function toolSegment(n: number): PowerlineSegment | null {
  if (!Number.isFinite(n) || n <= 0) return null
  return { text: `🛠 ${n}`, bg: POWERLINE_COLORS.tools }
}
