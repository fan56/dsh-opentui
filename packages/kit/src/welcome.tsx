/**
 * Startup banner: the product name in plain terminal type (brand blue),
 * the model/cwd line and the daily quote under it — top-left, above the
 * input. The pixel/graphics experiments (ascii_font wordmark, half-block
 * whale, kitty image) were all reverted: plain text renders identically
 * everywhere.
 */
import { type JSX } from "solid-js"
import type { Theme } from "./theme.ts"
import { POWERLINE_COLORS } from "./powerline.tsx"
import { pickDailyQuote } from "./quotes.ts"

/** The user's home, shortened to "~" in the info line. */
const home = (typeof process !== "undefined" && process.env.HOME) || ""

function shortenCwd(cwd: string): string {
  const short = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd
  if (short.length <= 60) return short
  return `…${short.slice(-59)}`
}

export function WelcomeBanner(props: { theme: Theme; model: string; cwd: string }): JSX.Element {
  const quote = pickDailyQuote()
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, justifyContent: "flex-start", alignItems: "flex-start", padding: 1 }}>
      <text style={{ fg: POWERLINE_COLORS.brand }}>DeepseekHarness</text>
      <text style={{ fg: props.theme.tokens.dim }}>{`${props.model} · ${shortenCwd(props.cwd)}`}</text>
      <text style={{ fg: props.theme.tokens.dim }}>{`🐳 「${quote}」`}</text>
      <text>{" "}</text>
    </box>
  )
}
