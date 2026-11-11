/**
 * LastRequestDock — batch D2: the fixed lastRequest slot BELOW the editor
 * (dsh-tui-pi live-widgets activityDoc structure):
 *
 *   ● <last submitted prompt>          — muted, one row, first line only
 *   ├─ ⠋ <label> · 13.6s · round 2 · <tail> — one line PER RUNNING child
 *   └─ ⠋ <label> · 2.1s · round 1 · <tail>
 *
 * Semantics (tui-pi live-widgets.ts):
 *   - the `●` line tracks MODEL prompts only — slash commands never set it
 *     (the page wires the signal, tui-pi index.ts:2469 semantics); it
 *     persists across turns and clears on session switch (/new/fork/resume).
 *   - the child lines are CLEAR-WHEN-DONE: only RUNNING children render —
 *     a settled roster collapses the slot to the `●` line alone.
 *   - the compact line shows the delegation label + elapsed + assistant
 *     round count + content tail. NO model — that is the Ctrl+G viewer's
 *     business (tui-pi parity).
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
import { useTerminalSize } from "./terminal-size"
import type { RGBA } from "@opentui/core"
import type { SeamRow } from "./seam-rows"
import { clipToWidth } from "./tool-summarize"
import { stringWidth } from "../../util/string-width"
import { useThemeOptional } from "../../context/theme"
import { motionDecorationsEnabled } from "../../skin/motion"
import { dockSpin, skinFadeInColor, skinLineFadeT, SKIN_FADE_IN_MS } from "./widgets-dock"

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/** The ` · ` separator between the meta block and the content tail. */
const TAIL_SEP_COLS = 3
/** Columns of tail a narrow dock keeps before dropping it entirely — the
 * live signal never disappears while a stub still fits. */
const MIN_TAIL_COLS = 2

export type LastRequestLine = {
	text: string
	tone: "muted" | "running"
	/** δ: stable entrance-fade key (spinner glyphs churn the text). */
	id?: string
	/** Extra leading columns (dsh-tui-pi: the ` ● ` request echo starts one
	 * column right of the `├─ ` child rows — Text paddingX=1 + an inner
	 * leading space). Deducted from the echo line's clip budget at render. */
	indent?: number
}

/** The `●` echo line (pure): first line of the prompt, `● ` prefixed. */
export function requestEchoLine(text: string | undefined): string | undefined {
	if (text === undefined || text.trim() === "") return undefined
	const first = text.replace(/\r/g, "").split("\n")[0] ?? text
	if (first.trim() === "") return undefined
	return `● ${first}`
}


/** One running-child line (pure): `├─/└─ ⠋ <label> · Xs · round N · <tail>`
 * — tui-pi compactAgentLine shape, reduced to the seam's facts (label,
 * elapsed, assistant-message round count, content tail; NO model, NO
 * token/context meta — tui-pi keeps those for the viewer). Settled
 * children never render here.
 *
 * Rounds: `round N` (tui-pi `misc.agent.rounds`, en locale "round {n}"). The
 * seam row carries no maxRounds cap, so tui-pi's `/M` suffix is absent.
 * Deliberately NOT `↻N`: that glyph is tui-pi's LLM RETRY counter
 * (`↻retries≤max`, live-widgets.ts:510-512) — reusing it for rounds would
 * read as "2 retries", the exact misreading this shape avoids.
 *
 * Tail law (tui-pi live-widgets.ts compactAgentLine): the tail is the
 * child's latest CONTENT line — last non-blank line of the folded buffer,
 * whitespace-collapsed onto one row (line TAIL, never line head — the live
 * delta fold and the durable-record fold both take the last line). It wins
 * the width fight: the label is clipped first, and the tail keeps at least
 * MIN_TAIL_COLS whenever the width allows any tail at all. */
export function childLineText(
	child: Extract<SeamRow, { kind: "subagents" }>["children"][number],
	isLast: boolean,
	spin: () => number,
	width?: number,
): string {
	const track = isLast ? "└─ " : "├─ "
	const glyph = `${SPINNER_FRAMES[spin() % SPINNER_FRAMES.length]} `
	const elapsed =
		child.startedAt !== undefined ? ` · ${((Date.now() - child.startedAt) / 1000).toFixed(1)}s` : ""
	// Rounds = the child's assistant-message count (one LLM round-trip per
	// message, tui-pi `round {n}` parity). Always shown — `round 0` proves
	// the counter is live on a freshly spawned child.
	const rounds = ` · round ${child.rounds}`
	const meta = `${elapsed}${rounds}`
	const head = `${track}${glyph}`
	const tail = lastVisibleLine(child.lastLine)
	if (tail === undefined) {
		const plain = `${head}${child.label}${meta}`
		return width === undefined ? plain : clipToWidth(plain, width)
	}
	if (width === undefined) return `${head}${child.label}${meta} · ${tail}`
	// Width law (tui-pi nameCap + tail priority): the label caps at 40% of
	// what the meta leaves, and is further clipped so the ` · ` separator
	// plus a MIN_TAIL_COLS tail stub always fit — a narrow dock clips the
	// label, it never silently drops the live signal. The tail then takes
	// everything the label leaves (it wins the width fight). tui-pi's
	// 10-column label floor is deliberately dropped: at narrow widths it
	// let the label eat the tail entirely.
	const available = width - stringWidth(head) - stringWidth(meta)
	if (available <= 0) return clipToWidth(`${head}${child.label}${meta}`, width)
	const labelCap = Math.floor(available * 0.4)
	const labelRoom = Math.max(0, available - TAIL_SEP_COLS - MIN_TAIL_COLS)
	const label = clipToWidth(child.label, Math.min(labelCap, labelRoom))
	const tailBudget = available - stringWidth(label) - TAIL_SEP_COLS
	if (tailBudget < MIN_TAIL_COLS) return clipToWidth(`${head}${label}${meta}`, width)
	return `${head}${label}${meta} · ${clipToWidth(tail, tailBudget)}`
}

/** Last non-blank line of a child's content buffer, whitespace-folded onto
 * one row (tui-pi `lastBufferLine`): a delta ending in `\n` must never
 * blank the tail, and CRLF/CR collapse like tui-pi's strip pass. */
export function lastVisibleLine(text: string | undefined): string | undefined {
	if (text === undefined) return undefined
	const lines = text.replace(/\r\n?/g, "\n").split("\n")
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]!.trim()
		if (line !== "") return line.replace(/\s+/gu, " ")
	}
	return undefined
}

/** The slot's line set (pure): the `●` echo (when a prompt was submitted)
 * followed by one line per RUNNING child (clear-when-done). */
export function lastRequestLines(
	rows: readonly SeamRow[],
	request: string | undefined,
	width?: number,
): LastRequestLine[] {
	const out: LastRequestLine[] = []
	const echo = requestEchoLine(request)
	if (echo !== undefined) out.push({ text: echo, tone: "muted", id: "lr:echo", indent: 1 })
	const tree = [...rows].reverse().find((row) => row.kind === "subagents")
	if (tree?.kind === "subagents") {
		const running = tree.children.filter((child) => child.status === "running")
		running.forEach((child, index) => {
			out.push({
				text: childLineText(child, index === running.length - 1, dockSpin, width),
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
	const dimensions = useTerminalSize()
	const theme = useThemeOptional()
	const fgFor = (tone: LastRequestLine["tone"]): string | RGBA =>
		tone === "running" ? (theme?.text.feedback.warning.base ?? "#e0af68") : (theme?.text.muted ?? "#9aa5ce")
	// Width law (walign geometry × subtail tail): the dock box carries
	// paddingLeft=1, so the content area is `columns - 1`. The echo line then
	// spends one more column on its `indent` (the `● ` prefix is inside the
	// text), while child lines carry their `├─ ` track inside the text and
	// childLineText's own budget. Clip each line to the columns it really
	// has, so neither the indent nor the track can push a row past the slot.
	const contentWidth = () => Math.max(16, dimensions().width - 1)
	const lineWidth = (line: LastRequestLine) => Math.max(1, contentWidth() - (line.indent ?? 0))
	const lines = () => lastRequestLines(props.rows, props.lastRequest, contentWidth())
	// δ: entrance fade (0.4s faint → target) on the shared skin palette; the
	// re-render cadence rides the widgets dock's shared-clock dockSpin tick.
	const lineFg = (line: LastRequestLine): string | RGBA => {
		const target = fgFor(line.tone)
		if (!motionDecorationsEnabled() || line.id === undefined) return target
		const t = skinLineFadeT(line.id)
		return t >= 1 ? target : skinFadeInColor(target, theme?.background.base ?? "#000000", t * SKIN_FADE_IN_MS)
	}

	return (
		<box flexShrink={0} flexDirection="column" width="100%" height={lines().length} paddingLeft={1}>
			<For each={lines()}>
				{(line) => (
					<text fg={lineFg(line)} wrapMode="none">
						{`${" ".repeat(line.indent ?? 0)}${clipToWidth(line.text, lineWidth(line))}`}
					</text>
				)}
			</For>
		</box>
	)
}
