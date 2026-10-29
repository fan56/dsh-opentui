/**
 * Startup welcome banner — the kit counterpart of dsh-tui-pi's whale
 * wordmark banner, drawn with OpenTUI's native <ascii_font> intrinsic.
 *
 * Layout (vertically centered, top to bottom): the big "DSH" wordmark in
 * the "block" font (ANSI Shadow — the boldest of the seven shipped fonts;
 * probe of all seven via testRender picked it: solid double-weight strokes
 * that read at one glance, unlike the thin line fonts), a blank spacer, a
 * dim model·cwd info line, another spacer, then the daily quote — one
 * random pick per banner mount (the same once-per-session semantics as
 * tui-pi's welcome), prefixed with the whale emoji and wrapped in CJK
 * corner brackets.
 */
import type { JSX } from "solid-js"
import type { Theme } from "./theme.ts"
import { POWERLINE_COLORS } from "./powerline.tsx"
import { pickDailyQuote } from "./quotes.ts"

/** The ascii font used for the wordmark. */
const WORDMARK_FONT = "block"

/** Longest cwd display width in columns. */
const CWD_MAX_COLUMNS = 40

/** The user's home, shortened to "~" in the info line. */
const home = (typeof process !== "undefined" && process.env.HOME) || ""

/**
 * Shorten the cwd to at most CWD_MAX_COLUMNS columns, keeping the tail (the
 * leaf directories carry the identity of the path). Home collapses to "~"
 * before the cut so the visible budget goes to the interesting part.
 * Paths are effectively ASCII, so one character is one column; "…" is the
 * single-column ellipsis.
 */
function shortenCwd(cwd: string): string {
  const short = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd
  if (short.length <= CWD_MAX_COLUMNS) return short
  return `…${short.slice(-(CWD_MAX_COLUMNS - 1))}`
}

/**
 * The welcome banner: wordmark + info line + daily quote, centered
 * vertically in the space the host gives it (flexGrow + justifyContent).
 * The quote is rolled once per mount so re-layouts keep the same line.
 */
export function WelcomeBanner(props: { theme: Theme; model: string; cwd: string }): JSX.Element {
  const quote = pickDailyQuote()
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, justifyContent: "center", padding: 1 }}>
      <ascii_font text="DSH" font={WORDMARK_FONT} color={POWERLINE_COLORS.brand} />
      <text>{" "}</text>
      <text style={{ fg: props.theme.tokens.dim }}>{`${props.model} · ${shortenCwd(props.cwd)}`}</text>
      <text>{" "}</text>
      <text style={{ fg: props.theme.tokens.dim }}>{`🐳 「${quote}」`}</text>
    </box>
  )
}
