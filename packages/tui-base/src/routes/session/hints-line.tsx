/**
 * HintsLine — batch D3: the keybinding hint row, the LAST row of the page
 * (dsh-tui-pi index.ts:2290-2297: the PowerlineFooter first, the FooterHint
 * single width-clipped row after it). The powerline keeps the pure segment
 * strip; every key hint (the composer's old idle footer + the powerline's
 * `Ctrl+Shift+F: search` segment) lives here.
 *
 *   idle  `⌨ enter send · alt+enter newline · ↑↓ history · ↓ subagents · ctrl+shift+f search · ctrl+c ×2 quit`
 *   busy  `⌨ enter steer · esc stop · …` (the running-turn keys lead)
 *
 * Toggle: `/hints` flips the module-level `hintsShown` signal (zero rows
 * when off). Store law: module-level state, getter-prop busy.
 */
import { createSignal, Show, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { clipToWidth } from "./tool-summarize"
import { useThemeOptional } from "../../context/theme"
import { subagentMarkerViews } from "./subagent-markers"

export const [hintsShown, setHintsShown] = createSignal(true)

const IDLE_HINTS = ["enter send", "alt+enter newline", "↑↓ history"]
const BUSY_HINTS = ["enter steer", "esc stop"]
const COMMON_HINTS = ["ctrl+shift+f search", "pgup/pgdn scroll", "ctrl+c ×2 quit"]

/** The hint row text (pure): `''` when hints are off. Batch D5b: `↓
 * subagents` only while a child runs (↓ is history otherwise — the
 * SubagentsPicker toggle gate). */
export function hintsText(busy: boolean, shown = true, subagentsLive = false): string {
	if (!shown) return ""
	const parts = [...(busy ? BUSY_HINTS : IDLE_HINTS), ...(subagentsLive ? ["↓ subagents"] : []), ...COMMON_HINTS]
	return `⌨ ${parts.join(" · ")}`
}

export function HintsLine(props: {
	/** Turn running (getter-prop law: the page passes a getter). */
	busy: boolean
}): JSX.Element {
	const dimensions = useTerminalDimensions()
	const theme = useThemeOptional()
	return (
		<Show when={hintsShown()}>
			<box flexShrink={0} height={1} width="100%" paddingLeft={1}>
				<text fg={theme?.text.faint ?? "#565f89"} wrapMode="none">
					{clipToWidth(hintsText(props.busy, hintsShown(), subagentMarkerViews().some((v) => v.status === "running")), Math.max(8, dimensions().width - 2))}
				</text>
			</box>
		</Show>
	)
}
