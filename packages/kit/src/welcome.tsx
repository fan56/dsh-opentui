/**
 * Startup welcome banner — the pixel-art hero ported from dsh-tui-pi's
 * welcome.ts: a pixel whale (28×10 half-block art) with the DSH wordmark
 * beside it, every letter a hand-authored 20×20 pixel bitmap sheared into
 * an arcade italic, folded to the SAME half-block grid the whale uses
 * (two pixel rows per terminal row — square pixels). Everything paints in
 * the powerline brand blue; the block sits bottom-anchored right above
 * the input line (opencode's hero shape: art centered, input below).
 */
import { For, type JSX } from "solid-js"
import type { Theme } from "./theme.ts"
import { POWERLINE_COLORS } from "./powerline.tsx"
import { pickDailyQuote } from "./quotes.ts"

/** The brand blue — the same as the powerline 'dsh' segment. */
const WHALE_COLOR = POWERLINE_COLORS.brand

export const WHALE_ART: readonly string[] = [
  '           ▄▄▄▄    █        ',
  '   ▄██████████▄   ████ ▄▄▄█▀',
  ' ▄██████████████▄  ████████ ',
  ' ██▀▀█████████████▄ ▄██▀▀   ',
  '██      ▀▀█████▄▀██████     ',
  '▀██        ▀████▄ ████▀     ',
  ' ███        ▀████████▀      ',
  '  ▀██▄   █▄▄  ▀█████▀       ',
  '   ▀▀███▄▄███▄▄▄█████▄      ',
  '      ▀▀▀████▀▀▀            ',
]

/** Blank columns between the whale and the wordmark column. */
const WHALE_TITLE_GAP = 2
/** Blank columns between the wordmark's letters. */
const LETTER_GAP = 2
/** The wordmark: D S H. */
const WORDMARK = "DSH"
/** Whale art width in columns (every row is this wide). */
const WHALE_ART_WIDTH = Math.max(...WHALE_ART.map((row) => row.length))

export const PIXEL_FONT: Record<string, readonly string[]> = {
  D: [
    '....#############...',
    '....#############...',
    '....#############...',
    '....###.........###.',
    '...###.........###..',
    '...###...........###',
    '...###...........###',
    '...###...........###',
    '..###...........###.',
    '..###...........###.',
    '..###...........###.',
    '..###...........###.',
    '.###...........###..',
    '.###...........###..',
    '.###...........###..',
    '.###.........###....',
    '###.........###.....',
    '#############.......',
    '#############.......',
    '#############.......',
  ],
  S: [
    '.......#############',
    '.......#############',
    '.......#############',
    '....###.............',
    '...###..............',
    '...###..............',
    '...###..............',
    '...#############....',
    '..#############.....',
    '..#############.....',
    '..#############.....',
    '...............###..',
    '..............###...',
    '..............###...',
    '..............###...',
    '..............###...',
    '.............###....',
    '############........',
    '############........',
    '############........',
  ],
  H: [
    '....###..........###',
    '....###..........###',
    '....###..........###',
    '....###..........###',
    '...###..........###.',
    '...###..........###.',
    '...###..........###.',
    '...###..........###.',
    '..################..',
    '..################..',
    '..################..',
    '..################..',
    '.###..........###...',
    '.###..........###...',
    '.###..........###...',
    '.###..........###...',
    '###..........###....',
    '###..........###....',
    '###..........###....',
    '###..........###....',
  ],
}

/**
 * Fold a 20×20 pixel bitmap into its 10 terminal rows with the whale's
 * half-block mapping: both pixel rows on → █, top only → ▀, bottom only
 * → ▄, neither → space. Two pixels vertically per cell is what makes the
 * pixels square on screen.
 */
function renderPixelGlyph(px: readonly string[]): readonly string[] {
  const rows: string[] = []
  for (let i = 0; i < px.length / 2; i++) {
    let row = ""
    for (let c = 0; c < px[0].length; c++) {
      const top = px[2 * i]![c] === "#"
      const bottom = px[2 * i + 1]![c] === "#"
      row += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " "
    }
    rows.push(row)
  }
  return rows
}

/** The wordmark's 10 letter rows (D + gap + S + gap + H). */
function wordmarkRows(): readonly string[] {
  const glyphRows = [...WORDMARK].map((ch) => renderPixelGlyph(PIXEL_FONT[ch]!))
  const rows = Array.from({ length: WHALE_ART.length }, () => "")
  for (let i = 0; i < glyphRows.length; i++) {
    for (let r = 0; r < rows.length; r++) {
      rows[r] += glyphRows[i]![r]
      if (i < glyphRows.length - 1) rows[r] += " ".repeat(LETTER_GAP)
    }
  }
  return rows
}

/** The 10 banner rows: whale + gap + wordmark, all brand blue. */
export function bannerRows(): readonly string[] {
  const letters = wordmarkRows()
  return WHALE_ART.map((row, r) => row + " ".repeat(WHALE_TITLE_GAP + WHALE_ART_WIDTH - row.length) + letters[r])
}

/** The user's home, shortened to "~" in the info line. */
const home = (typeof process !== "undefined" && process.env.HOME) || ""

function shortenCwd(cwd: string): string {
  const short = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd
  if (short.length <= 40) return short
  return `…${short.slice(-39)}`
}

/**
 * The welcome hero: whale + wordmark rows centered, a dim model·cwd line
 * and the daily quote under them, bottom-anchored so the art hugs the
 * input line right below (opencode's hero composition).
 */
export function WelcomeBanner(props: { theme: Theme; model: string; cwd: string }): JSX.Element {
  const quote = pickDailyQuote()
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, justifyContent: "flex-end", alignItems: "center", padding: 1 }}>
      <For each={bannerRows()}>
        {(row) => <text style={{ fg: WHALE_COLOR }}>{row}</text>}
      </For>
      <text>{" "}</text>
      <text style={{ fg: props.theme.tokens.dim }}>{`${props.model} · ${shortenCwd(props.cwd)}`}</text>
      <text style={{ fg: props.theme.tokens.dim }}>{`🐳 「${quote}」`}</text>
      <text>{" "}</text>
    </box>
  )
}
