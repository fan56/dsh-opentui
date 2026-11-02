/**
 * FlowBar — an indeterminate progress bar: a bright segment (comet) with a
 * fading tail travels left→right, bounces at the edge and returns
 * (KITT-style ping-pong) across the bar. One terminal row of density-ramp
 * blocks: ░ track, ▒▓ tail gradient, █ head. ~80ms per cell advance.
 * Mounted only while busy; idle renders nothing.
 */
import { createSignal, onCleanup, For, Show, type JSX } from "solid-js"
import type { Theme } from "./theme.ts"

const FRAME_MS = 80
/** Tail length in cells behind the bright head. */
const TAIL = 5
const RAMP = ["█", "▓", "▒", "░"]

export function FlowBar(props: {
  theme: Theme
  /** Bar cells (the bar also shrinks on narrow terminals via truncation). */
  width?: number
  /** Bar color (defaults to the theme accent). */
  color?: string
}): JSX.Element {
  const cells = props.width ?? 40
  const [pos, setPos] = createSignal(0)
  let dir = 1
  const timer = setInterval(() => {
    setPos((p) => {
      let next = p + dir
      if (next >= cells) {
        dir = -1
        next = cells - 1
      } else if (next < 0) {
        dir = 1
        next = 0
      }
      return next
    })
  }, FRAME_MS)
  onCleanup(() => clearInterval(timer))

  const fg = () => props.color ?? props.theme.tokens.accent
  const trackFg = () => props.theme.tokens.border

  // one <text> per density class keeps the row a single line: head, tail
  // gradient, track — assembled as colored runs left to right
  const row = (): { text: string; fg: string }[] => {
    const p = pos()
    const head = p
    // tail cells behind the head, in the travel direction
    const tailCells: number[] = []
    for (let i = 1; i <= TAIL; i++) {
      const c = head - dir * i
      if (c >= 0 && c < cells) tailCells.push(c)
    }
    const runs: { text: string; fg: string }[] = []
    let buf = ""
    let bufFg = trackFg()
    const flush = (fg: string) => {
      if (buf) runs.push({ text: buf, fg: bufFg })
      buf = ""
      bufFg = fg
    }
    for (let c = 0; c < cells; c++) {
      let ch = "░"
      let cellFg = trackFg()
      if (c === head) {
        ch = RAMP[0]!
        cellFg = fg()
      } else {
        const ti = tailCells.indexOf(c)
        if (ti >= 0) {
          ch = RAMP[Math.min(RAMP.length - 1, Math.floor(ti / 2) + 1)]!
          cellFg = fg()
        }
      }
      if (cellFg !== bufFg) flush(cellFg)
      buf += ch
    }
    flush(trackFg())
    return runs
  }

  return (
    <Show when={true}>
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
