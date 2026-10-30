/**
 * Startup banner: the "DSH OpenTUI" wordmark in ascii_font "block" (the
 * ANSI-Shadow style letters), the model/cwd line and the daily quote
 * under it — top-left, above the input.
 */
import { For, type JSX } from "solid-js"
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

export function WelcomeBanner(props: { theme: Theme; model: string; cwd: string; plugins?: { name: string; version: string }[] }): JSX.Element {
  const quote = pickDailyQuote()
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, justifyContent: "flex-start", alignItems: "flex-start", padding: 1 }}>
      <ascii_font text="DSH OPENTUI" font="block" color={POWERLINE_COLORS.brand} />
      <text style={{ fg: props.theme.tokens.dim }}>{"plugins:"}</text>
      <For each={props.plugins ?? []}>
        {(p) => (
          <text style={{ fg: props.theme.tokens.dim }}>{`  ● ${p.name}@${p.version}`}</text>
        )}
      </For>
      <text>{" "}</text>
      <text style={{ fg: props.theme.tokens.dim }}>{`${props.model} · ${shortenCwd(props.cwd)}`}</text>
      <text style={{ fg: props.theme.tokens.dim }}>{`🐳 「${quote}」`}</text>
      <text>{" "}</text>
    </box>
  )
}
