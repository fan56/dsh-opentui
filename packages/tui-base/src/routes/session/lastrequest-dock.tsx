/**
 * LastRequestDock — batch D2: the fixed lastRequest slot BELOW the editor
 * (dsh-tui-pi live-widgets activityDoc structure):
 *
 *   ● <last submitted prompt>          — muted, one row, first line only
 *   ├─ ⠋ <label> · 13.6s · <tail>      — one line PER RUNNING child
 *   └─ ⠋ <label> · 2.1s · <tail>
 *
 * Semantics (tui-pi live-widgets.ts):
 *   - the `●` line tracks MODEL prompts only — slash commands never set it
 *     (the page wires the signal, tui-pi index.ts:2469 semantics); it
 *     persists across turns and clears on session switch (/new/fork/resume).
 *   - the child lines are CLEAR-WHEN-DONE: only RUNNING children render —
 *     a settled roster collapses the slot to the `●` line alone.
 *   - the compact line shows the delegation label + elapsed + content tail.
 *     NO model — that is the Ctrl+G viewer's business (tui-pi parity).
 *
 * Data law: pure VIEW over the shared seam-rows store (the `subagents:live`
 * row the seam's subagent marker face drives) + the page's lastRequest
 * signal. No phase machine touched.
 *
 * CLOSURE LAW (D1): the component body declares NO reactive state that the
 * JSX props close over — every render call reads the props accessors
 * directly inside JSX (the page passes getter props; see widgets-dock.tsx).
 *
 * Layout law: explicit height = visible line count, flexShrink=0 (auto-
 * height boxes collapse in flex columns; the transcript's bottom slot owns
 * the ordering — footer paints UNDER the composer).
 */
import { For, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import type { SeamRow } from "./seam-rows"
import { clipToWidth } from "./tool-summarize"
import { useThemeOptional } from "../../context/theme"
import { motionDecorationsEnabled } from "../../skin/motion"
import { dockSpin, skinFadeInColor, skinLineFadeT, SKIN_FADE_IN_MS } from "./widgets-dock"

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export type LastRequestLine = {
	text: string
	tone: "muted" | "running"
	/** δ: stable entrance-fade key (spinner glyphs churn the text). */
	id?: string
}

/** The `●` echo line (pure): first line of the prompt, `● ` prefixed. */
export function requestEchoLine(text: string | undefined): string | undefined {
	if (text === undefined || text.trim() === "") return undefined
	const first = text.replace(/\r/g, "").split("\n")[0] ?? text
	if (first.trim() === "") return undefined
	return `● ${first}`
}


/** One running-child line (pure): `├─/└─ ⠋ <label> · Xs · <tail>` —
 * tui-pi compactAgentLine shape, reduced to the seam's facts (label,
 * elapsed, content tail; NO model, NO token/round meta — tui-pi keeps
 * those for the viewer). Settled children never render here. */
export function childLineText(
	child: Extract<SeamRow, { kind: "subagents" }>["children"][number],
	isLast: boolean,
	spin: () => number,
): string {
	const track = isLast ? "└─ " : "├─ "
	const glyph = `${SPINNER_FRAMES[spin() % SPINNER_FRAMES.length]} `
	const elapsed =
		child.startedAt !== undefined ? ` · ${((Date.now() - child.startedAt) / 1000).toFixed(1)}s` : ""
	const tail = child.lastLine !== undefined ? ` · ${child.lastLine.split("\n").pop()?.trim()}` : ""
	return `${track}${glyph}${child.label}${elapsed}${tail}`
}

/** The slot's line set (pure): the `●` echo (when a prompt was submitted)
 * followed by one line per RUNNING child (clear-when-done). */
export function lastRequestLines(rows: readonly SeamRow[], request: string | undefined): LastRequestLine[] {
	const out: LastRequestLine[] = []
	const echo = requestEchoLine(request)
	if (echo !== undefined) out.push({ text: echo, tone: "muted", id: "lr:echo" })
	const tree = [...rows].reverse().find((row) => row.kind === "subagents")
	if (tree?.kind === "subagents") {
		const running = tree.children.filter((child) => child.status === "running")
		running.forEach((child, index) => {
			out.push({
				text: childLineText(child, index === running.length - 1, dockSpin),
				tone: "running",
				id: `lr:child:${child.id}`,
			})
		})
	}
	return out
}

/**
 * The dock. Mounted by the v2-entry page as the transcript's `footer`
 * slot — directly BELOW the composer (the editor).
 */
export function LastRequestDock(props: {
	/** The shared seam-rows store (getter-prop law — see WidgetsDock). */
	rows: readonly SeamRow[]
	/** The last submitted model prompt (page signal; undefined → no echo). */
	lastRequest: string | undefined
}): JSX.Element {
	const dimensions = useTerminalDimensions()
	const theme = useThemeOptional()
	const fgFor = (tone: LastRequestLine["tone"]): string | RGBA =>
		tone === "running" ? (theme?.text.feedback.warning.base ?? "#e0af68") : (theme?.text.muted ?? "#9aa5ce")
	const width = () => Math.max(16, dimensions().width - 5)
	const lines = () => lastRequestLines(props.rows, props.lastRequest)
	// δ: entrance fade (0.4s faint → target) on the shared skin palette; the
	// re-render cadence rides the widgets dock's shared-clock dockSpin tick.
	const lineFg = (line: LastRequestLine): string | RGBA => {
		const target = fgFor(line.tone)
		if (!motionDecorationsEnabled() || line.id === undefined) return target
		const t = skinLineFadeT(line.id)
		return t >= 1 ? target : skinFadeInColor(target, theme?.background.base ?? "#000000", t * SKIN_FADE_IN_MS)
	}

	return (
		<box flexShrink={0} flexDirection="column" width="100%" height={lines().length} paddingLeft={3}>
			<For each={lines()}>
				{(line) => (
					<text fg={lineFg(line)} wrapMode="none">
						{clipToWidth(line.text, width())}
					</text>
				)}
			</For>
		</box>
	)
}
