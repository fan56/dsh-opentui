/**
 * WidgetsDock — batch D1: the fixed widgets slot above the composer
 * (dsh-tui-pi dock structure). The transcript renders ONLY user/assistant/
 * echo/notice/ask blocks (never tools/thinking); the live activity that the
 * old V1/V2a build painted as transcript rows docks here instead —
 * Todos → Think → Tool, three fixed panels, each panel a SINGLE line that
 * refreshes in place (no remount, no scroll coupling, never in the
 * transcript flow).
 *
 *   Todos  `todos [✓]2/3 · <current>`     — from the latest todowrite brief
 *   Think  `💭 thinking · Xs · <tail>`    — italic while the burst runs;
 *          collapses to `💭 thought · Xs · <first line>` (the seam-rows fade
 *          machine clears it ~1.8s after settle — nothing lingers)
 *   Tool   `⚙ name(subject) · Xs · <tail>` per tool line; settled freezes
 *          ✔/✘ + elapsed; multiple tools = multiple lines, each updated in
 *          place (the line set derives from the store, never re-created)
 *
 * Data law: the dock is a pure VIEW over the seam-rows store — the phase
 * machine (onThinkingDelta / onToolRun / collapse / fade) is untouched.
 *
 * CLOSURE LAW (D1 on-device finding): the component body declares NO
 * reactive state that the JSX props close over — every render getter calls
 * the module-level `dockLines` with the props accessor itself. On the real
 * boot, component-scope memo accessors read `undefined` from inside the
 * rendered box's setProp effects (twice reproduced with the real preload
 * transform; the same closures were verified non-undefined at body time —
 * root cause not yet isolated, see the D1 handoff). The transcript's own
 * closures keep working, so this is dock-local avoidance, not a global law.
 *
 * Layout law: the dock sits in the transcript's bottom slot (explicit-dims
 * parent chain); the dock box sets an EXPLICIT height = its visible line
 * count (auto-height boxes collapse in flex columns) and flexShrink=0 so
 * the composer keeps its own height below it.
 */
import { For, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes, type RGBA } from "@opentui/core"
import type { SeamRow } from "./seam-rows"
import { clipToWidth, toolDetail, toolResultLine, toolSubject } from "./tool-summarize"
import { parseTodos } from "../../util/todo"
import { useThemeOptional } from "../../context/theme"

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/** Shared dock spinner tick — MODULE-level so no render closure owns it
 * (one interval per dock mount flips it; every line reads it lazily).
 * Batch D2: the lastRequest dock below the editor reads the SAME tick
 * (one interval owns the braille cadence for both docks). */
export const [dockSpin, setDockSpin] = createSignal(0)

/** Todos summary line (pure, testable): the latest completed todowrite
 * tool brief carries the todo array (the follow stream's
 * `JSON.stringify(output).slice(0, 300)` brief). No todos → ''. */
export function todosSummaryLine(output: string | undefined): string {
	if (output === undefined || output.trim() === "") return ""
	try {
		const parsed = JSON.parse(output) as unknown
		const todos = parseTodos(Array.isArray(parsed) ? parsed : [])
		if (todos.length === 0) return ""
		const done = todos.filter((t) => t.status === "completed").length
		const active = todos.find((t) => t.status === "in_progress")
		const head = `todos [✓]${done}/${todos.length}`
		return active ? `${head} · ${active.content}` : head
	} catch {
		return ""
	}
}

/** One dock tool line (pure): `✔/✘/⠋ ⚙ name(subject) · Xs · <tail>`.
 * Running shows the arg summary; settled shows the result tail (the raw
 * JSON never renders on the line — the collapse-to-summary law). */
export function toolLineText(row: Extract<SeamRow, { kind: "tool" }>, spin: () => number): string {
	const subject = toolSubject(row.args)
	const title = subject === "" ? row.name : `${row.name}(${subject})`
	const elapsed =
		row.status === "running"
			? row.startedAt !== undefined
				? ` · ${((Date.now() - row.startedAt) / 1000).toFixed(1)}s`
				: ""
			: row.elapsedSec !== undefined
				? ` · ${row.elapsedSec.toFixed(1)}s`
				: ""
	const marker = row.status === "running" ? SPINNER_FRAMES[spin() % SPINNER_FRAMES.length] : row.status === "failed" ? "✘" : "✔"
	const tail = row.status === "running" ? toolDetail(row.args) : toolResultLine(row.output)
	const body = `${title}${elapsed}${tail !== "" ? ` · ${tail}` : ""}`
	return `${marker} ⚙ ${body}`
}

/** The live think line (pure, testable): `💭 thinking · Xs · <tail>` while
 * streaming, `💭 thought · Xs · <first line>` once collapsed. Rows without
 * panel state (replay shapes) paint nothing. */
export function thinkLineText(row: Extract<SeamRow, { kind: "reasoning" }>, spin: () => number): string | undefined {
	const lines = row.text.replace(/\r/g, "").split("\n").filter((line) => line.trim() !== "")
	if (row.streaming === true) {
		const tail = lines[lines.length - 1] ?? ""
		const secs = row.startedAt !== undefined ? `${((Date.now() - row.startedAt) / 1000).toFixed(1)}s` : "0.0s"
		void spin()
		return `💭 thinking · ${secs} · ${tail}`
	}
	if (row.elapsedSec !== undefined) {
		const first = lines[0] ?? ""
		return `💭 thought · ${row.elapsedSec.toFixed(1)}s · ${first}`
	}
	return undefined
}

/** The dock line set (pure): Todos → Think → Tool, one entry per visible
 * panel line. `tone` keys the status-color family (resolved at render). */
export type DockLine = { text: string; tone: "ok" | "running" | "failed" | "muted"; italic?: boolean }

export function dockLines(rows: readonly SeamRow[]): DockLine[] {
	const out: DockLine[] = []
	const all = rows
	// Todos panel (single line): the latest todowrite brief.
	const todoTool = [...all].reverse().find((row) => row.kind === "tool" && row.name === "todowrite" && row.output !== undefined)
	const todos = todoTool?.kind === "tool" ? todosSummaryLine(todoTool.output) : ""
	if (todos !== "") out.push({ text: todos, tone: "muted" })
	// Think panel (single line): the LIVE burst wins; else the collapsed
	// summary inside its fade window (the seam-rows timer clears the row).
	const live = [...all].reverse().find((row) => row.kind === "reasoning" && row.streaming === true)
	const collapsed = [...all].reverse().find((row) => row.kind === "reasoning" && row.elapsedSec !== undefined)
	const think =
		live?.kind === "reasoning" ? thinkLineText(live, dockSpin) : collapsed?.kind === "reasoning" ? thinkLineText(collapsed, dockSpin) : undefined
	if (think !== undefined) out.push({ text: think, tone: "running", italic: true })
	// Tool panel (one line per live tool row, in-place keyed updates).
	for (const row of all) {
		if (row.kind !== "tool" || !row.key.startsWith("tool:live:")) continue
		out.push({ text: toolLineText(row, dockSpin), tone: row.status === "running" ? "running" : row.status === "failed" ? "failed" : "ok" })
	}
	return out
}

/**
 * The dock. Mounted by the v2-entry page as the transcript's `widgets`
 * slot — directly above the composer (the editor).
 */
export function WidgetsDock(props: {
	/** The shared seam-rows store (getter-prop law: the page passes
	 * `{ get rows() { return projection.rows } }` — the STORE ARRAY itself,
	 * reactive through its proxy reads). */
	rows: readonly SeamRow[]
}): JSX.Element {
	const dimensions = useTerminalDimensions()
	const theme = useThemeOptional()
	const fgFor = (tone: DockLine["tone"]): string | RGBA =>
		tone === "running"
			? (theme?.text.feedback.warning.base ?? "#e0af68")
			: tone === "failed"
				? (theme?.text.feedback.error.base ?? "#f7768e")
				: tone === "ok"
					? (theme?.text.feedback.success.base ?? "#9ece6a")
					: (theme?.text.muted ?? "#9aa5ce")
	onMount(() => {
		const timer = setInterval(() => setDockSpin((s) => s + 1), 120)
		onCleanup(() => clearInterval(timer))
	})
	const width = () => Math.max(16, dimensions().width - 4)

	return (
		<box flexShrink={0} flexDirection="column" width="100%" height={dockLines(props.rows).length} paddingLeft={3}>
			<For each={dockLines(props.rows)}>
				{(line) => (
					<text fg={fgFor(line.tone)} attributes={line.italic === true ? TextAttributes.ITALIC : undefined} wrapMode="none">
						{clipToWidth(line.text, width())}
					</text>
				)}
			</For>
		</box>
	)
}
