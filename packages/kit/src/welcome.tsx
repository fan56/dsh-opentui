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

/** Expand a half-block art row pair into pixel booleans (2 rows per cell). */
function artToPixels(): boolean[][] {
  const px: boolean[][] = []
  for (const row of WHALE_ART) {
    const top: boolean[] = []
    const bottom: boolean[] = []
    for (const ch of row) {
      top.push(ch === "█" || ch === "▀")
      bottom.push(ch === "█" || ch === "▄")
    }
    px.push(top, bottom)
  }
  return px
}

/** Nearest-neighbor 2× downsample of a pixel matrix. */
function halvePixels(px: boolean[][]): boolean[][] {
  const out: boolean[][] = []
  for (let r = 0; r < px.length; r += 2) {
    const row: boolean[] = []
    for (let c = 0; c < px[0]!.length; c += 2) row.push(px[r]![c]!)
    out.push(row)
  }
  return out
}

/** Fold a pixel matrix into half-block terminal rows. */
function foldPixels(px: boolean[][]): string[] {
  const rows: string[] = []
  for (let i = 0; i < px.length; i += 2) {
    let row = ""
    for (let c = 0; c < px[0]!.length; c++) {
      const top = px[i]![c]!
      const bottom = px[i + 1]?.[c] ?? false
      row += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " "
    }
    rows.push(row)
  }
  return rows
}

/** The banner rows at HALF scale: the whale (28×20 px → 14×10 → 5 rows)
 * * and each wordmark letter (20×20 px → 10×10 → 5 rows), same pixel
 * language, one glyph cell per art cell. */

/** Shadow layer color: the whale blue dimmed toward black (ANSI-Shadow
 * style extrusion — the wordmark's 3D comes from the font itself; the
 * whale gets the same front+shadow construction). */
function dimHex(hex: string, k = 0.45): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.round(v * k).toString(16).padStart(2, "0")
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`
}
const SHADOW_COLOR = dimHex(WHALE_COLOR)

/** Front layer at the font's height: the whale halved to 14×10 px → 5
 * rows, matching the block wordmark's 6 rows (incl. its shadow row). */
function whaleFront(): boolean[][] {
  return halvePixels(artToPixels())
}

/**
 * Outside mask: flood-fill the empty cells from the grid edges. Only
 * OUTSIDE cells may show shadow — an offset copy shown through every
 * empty cell fills the silhouette's interior holes (the eye, contour
 * gaps) and the whale dissolves into noise.
 */
/**
 * Hand-drawn compact whale (5 half-block rows × 25 cols) — sized to the
 * wordmark's height (5 art rows + 1 shadow row = 6, matching ascii_font
 * "block"). Anatomy: rounded head LEFT, eye gap, body tapering to a
 * raised tail fluke at the RIGHT. Downsampling the 10-row original was
 * lossy; this is drawn at the target size directly.
 */
const WHALE_SMALL: readonly string[] = [
  '                  ▄▄▄▄▄▄ ',
  '   ▄▄▄▄▄▄▄▄▄▄▄▄██████████',
  '▄████████████████████▀▀▀ ',
  '█████▀▀▀▀▄▄▄▄█████████▀  ',
  '▀████▄      ▀▀▀██████▄   ',
]

function outsideMask(px: boolean[][]): boolean[][] {
  const h = px.length
  const w = px[0]!.length
  const out = Array.from({ length: h }, () => Array.from({ length: w }, () => false))
  const q: [number, number][] = []
  for (let r = 0; r < h; r++) for (const c of [0, w - 1]) if (!px[r]![c]! && !out[r]![c]) { out[r]![c] = true; q.push([r, c]) }
  for (let c = 0; c < w; c++) for (const r of [0, h - 1]) if (!px[r]![c]! && !out[r]![c]) { out[r]![c] = true; q.push([r, c]) }
  while (q.length > 0) {
    const [r, c] = q.pop()!
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
      const nr = r + dr
      const nc = c + dc
      if (nr >= 0 && nr < h && nc >= 0 && nc < w && !px[nr]![nc]! && !out[nr]![nc]) {
        out[nr]![nc] = true
        q.push([nr, nc])
      }
    }
  }
  return out
}

/** Whale rows with an offset dark shadow (+1 col, +1 row) behind the
 * front layer. BOTH layers live on the FOLDED glyph grid (5 rows) — the
 * halved pixel grid is 10 rows and mixing the two scales drew the lower
 * pixel half as a spurious shadow trail that shredded the silhouette.
 * Shadow only lands on OUTSIDE cells (flood-fill), never in the body's
 * interior holes. Empty cells keep their column (a dropped space shifts
 * every later cell left and scatters the shape). */
function whale3dRows(): { text: string; fg: string }[][] {
  const presence = WHALE_SMALL.map((row) => [...row].map((ch) => ch !== " "))
  const outside = outsideMask(presence)
  const h = presence.length
  const w = presence[0]!.length
  const out: { text: string; fg: string }[][] = []
  for (let r = 0; r < h + 1; r++) {
    const spans: { text: string; fg: string }[] = []
    let run = ""
    let runFg = ""
    for (let c = 0; c < w + 1; c++) {
      const lit = (presence[r]?.[c] ?? false) === true
      const sh = !lit && r > 0 && c > 0 && presence[r - 1]![c - 1]! && (outside[r]?.[c] ?? true)
      const ch = lit ? WHALE_SMALL[r]![c]! : sh ? "█" : " "
      const fg = lit ? WHALE_COLOR : sh ? SHADOW_COLOR : runFg
      if (fg === runFg) {
        run += ch
      } else {
        if (run) spans.push({ text: run, fg: runFg })
        run = ch
        runFg = fg
      }
    }
    if (run) spans.push({ text: run, fg: runFg })
    if (spans.length > 0) out.push(spans)
  }
  return out
}

/** The whale alone at its original chunky size (10 rows × 28 cols). */
export function whaleRows(): readonly string[] {
  return WHALE_ART.map((row) => row)
}

export function bannerRows(): readonly string[] {
  const whale = foldPixels(halvePixels(artToPixels()))
  const letters = [...WORDMARK].map((ch) => {
    const glyph = PIXEL_FONT[ch]!.map((row) => [...row].map((p) => p === "#"))
    return foldPixels(halvePixels(glyph))
  })
  const width = Math.max(...whale.map((r) => r.length))
  const out: string[] = []
  for (let r = 0; r < whale.length; r++) {
    let line = whale[r]! + " ".repeat(WHALE_TITLE_GAP + width - whale[r]!.length)
    for (let i = 0; i < letters.length; i++) {
      line += letters[i]![r]
      if (i < letters.length - 1) line += " ".repeat(LETTER_GAP)
    }
    out.push(line)
  }
  return out
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
  // Hero: the DeepSeek whale logo (official vector, rasterized at 3x for
  // crispness) at the wordmark's exact height — 6 rows, natural square
  // width, fit="fit" never stretches — with DSH-OPENTUI right after it.
  const logoPng = new URL("./assets/ds-logo.png", import.meta.url).pathname
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, justifyContent: "flex-start", alignItems: "flex-start", padding: 1 }}>
      <box style={{ flexDirection: "row", alignItems: "center" }}>
        <box style={{ width: 4, height: 6 }}>
          <image source={logoPng} fit="fit" />
        </box>
        <box style={{ width: 2, height: 1 }} />
        <ascii_font text="DSH-OPENTUI" font="block" color={WHALE_COLOR} />
      </box>
      <text>{" "}</text>
      <text>{" "}</text>
      <text style={{ fg: props.theme.tokens.dim }}>{`${props.model} · ${shortenCwd(props.cwd)}`}</text>
      <text style={{ fg: props.theme.tokens.dim }}>{`🐳 「${quote}」`}</text>
      <text>{" "}</text>
    </box>
  )
}
