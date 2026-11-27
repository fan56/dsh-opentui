/**
 * Shared pure line primitives for the activity dock.
 *
 * This module holds the row helpers, row types and todo-brief clock shared by
 * the dock's data and view layers. It contains no view-layer code and no
 * renderer imports; every declaration here is a pure helper or a data type.
 */

import type { SeamRow } from "./seam-rows"
import type { Todo } from "../../util/todo"
import { t } from "../../i18n"
import { toolDetail, toolResultLine, toolSubject } from "./tool-summarize"
import { DOCK_WIDGET_MAX_LINES } from "./dock-visibility"

// ---------------------------------------------------------------------------
// Row types and status glyphs (from the merged row layer)
// ---------------------------------------------------------------------------

/** Status glyph definitions (D6). Only `in_progress` is rendered under the
 * active-only policy, but all four are defined and retained — `cancelled` is
 * `⊘`, distinct from `○` — do not delete them. */
export const TODO_STATUS_GLYPHS = {
	pending: "○",
	in_progress: "●",
	completed: "✓",
	cancelled: "⊘",
} as const

export type MergedTone = "ok" | "running" | "failed" | "muted"

export interface MergedDockSegment {
	text: string
	tone: MergedTone
	/** Semantic accent (think violet / tool cyan) painted on THIS segment's
	 * text, overriding `tone`. A segment without an accent paints in its tone
	 * (this is how the tool status marker keeps its running/ok/failed color).
	 * Mirrors `DockLine.accent` in widgets-dock.tsx:601-604. */
	accent?: DockAccent
}

export type MergedDockLineKind = "think" | "tool" | "todo" | "agent" | "more-top" | "more-bottom"

export interface MergedDockLine {
	kind: MergedDockLineKind
	/** Original 1-based plan index for todo lines (absent on other kinds). */
	index?: number
	segments: MergedDockSegment[]
	/** Stable entrance-fade key — spinner glyphs churn the text, so the id is
	 * derived from the row key, not the rendered text (D3). Think/tool only.
	 * Consumed by `skinLineFadeT` / `skinDockLineFg` (widgets-dock.tsx:279,
	 * :305). */
	id?: string
	/** Exit-fade anchor in ms-epoch, from `skinStopAt(row)` — undefined while
	 * the row is live/running (D3). Think/tool only. */
	fadeOutAt?: number
	/** Leading status glyph (⚙/✔/✘) inside the joined segment text, painted
	 * with `tone` while the body uses its `accent` (legacy `dockLineNode`
	 * marker mechanism, widgets-dock.tsx:1336-1372). Tool lines only. */
	marker?: string
	/** Offset of `marker` inside the joined segment text. Always 0 here — the
	 * glyph leads both the coexistence and tool-only layouts. */
	markerAt?: number
	/** Italic whole line (think rows). Italic is a whole-line property, so this
	 * is the single source of truth the view reads (no segment-level italic). */
	italic?: boolean
}

// ---------------------------------------------------------------------------
// Pure helpers (from the widgets view layer)
// ---------------------------------------------------------------------------

/** The stop anchor a view can compute WITHOUT touching the store: the row
 * froze elapsedSec at its stop, so stop ≈ startedAt + elapsedSec*1000 (H5).
 * undefined when either side is missing (replay rows) — no fade, solid color. */
export function skinStopAt(row: { startedAt?: number; elapsedSec?: number }): number | undefined {
	return row.startedAt !== undefined && row.elapsedSec !== undefined ? row.startedAt + row.elapsedSec * 1000 : undefined
}

/** Scene-C todo tree (compact terminal): the `● Todos (d/n)` header plus one
 * `├─ {glyph} {content}` row per todo (`└─ ` on the last). Returned as lower-zone
 * lines so the merged dock gives them its 10-line hard cap + scroll window;
 * they are rebuilt from the same `MergedDockData.todos` as `todosSummaryFromTodos`.
 * Empty list OR every todo completed → zero lines (clear-when-done, same law as
 * the one-line summary). Status glyphs reuse `TODO_STATUS_GLYPHS`. */
export function todoTreeLines(todos: readonly Todo[]): MergedDockLine[] {
	if (todos.length === 0) return []
	const done = todos.filter((todo) => todo.status === "completed").length
	if (done === todos.length) return []
	const lines: MergedDockLine[] = [
		{ kind: "todo", segments: [{ text: t("overlay.widgets.todosHeader", { done, total: todos.length }), tone: "running", accent: "todo" }] },
	]
	todos.forEach((todo, i) => {
		const branch = i === todos.length - 1 ? "└─ " : "├─ "
		const glyph = TODO_STATUS_GLYPHS[todo.status] ?? TODO_STATUS_GLYPHS.pending
		lines.push({ kind: "todo", segments: [{ text: `${branch}${glyph} ${todo.content}`, tone: "running", accent: "todo" }] })
	})
	return lines
}

// ------------------------------------------- scene-A todo brief timing (指令4)
// `todo done/total Ns` — no current-task text. The duration is seconds since
// the CURRENT TASK SET was established: the moment the set of task TEXTS first
// appeared. Only texts are compared (a 1/3→2/3 status flip is NOT a new set),
// and they are sorted (reordering is NOT a new set). A different text set gets
// a fresh anchor ("换集重置"); within one set status flips do not reset.
// A single module-level map — text signature → first-seen wall clock — is the
// ONLY anchor source; there is no rows-based "earliest startedAt" primary and
// no array-change fallback. Module scope keeps the CLOSURE LAW; the map is
// cleared on session switch (`resetTodoBriefClock`, wired to the dock unmount
// cleanup), so a signature never leaks into a later session.

/** Text-only signature of a task set — status flips and ordering ignored. */
const todoSetSignature = (todos: readonly Todo[]): string => todos.map((todo) => todo.content).sort().join("\u0001")

/** Text signature → wall clock when that task set was FIRST seen this session. */
const todoSetFirstSeen = new Map<string, number>()

/** The current task set's establishment time: first-seen time of its text
 * signature. Pure apart from the module map (never component state). */
export function todoSetStartedAt(todos: readonly Todo[], now: number = Date.now()): number {
	const sig = todoSetSignature(todos)
	const first = todoSetFirstSeen.get(sig)
	if (first !== undefined) return first
	todoSetFirstSeen.set(sig, now)
	return now
}

/** The one-line scene-A todo brief: `todo done/total Ns`. An explicit
 * `startedAt` is a pure-caller/test seam; the dock leaves it unset so the
 * unified text-signature first-seen map above is the single production clock. */
export function todoBriefLine(todos: readonly Todo[], now: number = Date.now(), startedAt?: number): string {
	if (todos.length === 0) return ""
	const done = todos.filter((todo) => todo.status === "completed").length
	const anchor = startedAt ?? todoSetStartedAt(todos, now)
	const secs = Math.max(0, Math.floor((now - anchor) / 1000))
	return t("overlay.widgets.todosBrief", { done, total: todos.length, secs })
}

/** Session-switch hook: drop every first-seen anchor (no signature survives
 * into the next session). */
export function resetTodoBriefClock(): void {
	todoSetFirstSeen.clear()
}

/** Status glyph for a tool row: running ⚙, failed ✘, settled ✔. The icon
 * keeps its own semantic tone; the line text carries the tool accent. */
export function toolMarker(status: Extract<SeamRow, { kind: "tool" }>["status"]): string {
	return status === "running" ? "⚙" : status === "failed" ? "✘" : "✔"
}

/** One dock tool line (pure, dsh-tui-pi ToolPanel height '1' parity):
 * `<⚙|✔|✘> <name> <subject> · Xs · <tail>`. NOT the old `⠋ ⚙ name(subject)`
 * form: the status icon IS the marker, the subject follows the name with a
 * space, a running tool's tail is the arg summary, a settled one's the
 * result tail (the raw JSON never renders). `now` is injectable so the
 * elapsed column (and tests) do not depend on a real wall clock. */
export function toolLineText(row: Extract<SeamRow, { kind: "tool" }>, spin: () => number, now: number = Date.now()): string {
	const subject = toolSubject(row.args)
	const title = subject === "" ? row.name : `${row.name} ${subject}`
	const elapsed =
		row.status === "running"
			? row.startedAt !== undefined
				? ` · ${((now - row.startedAt) / 1000).toFixed(1)}s`
				: ""
			: row.elapsedSec !== undefined
				? ` · ${row.elapsedSec.toFixed(1)}s`
				: ""
	const marker = toolMarker(row.status)
	void spin()
	const tail = row.status === "running" ? toolDetail(row.args) : toolResultLine(row.output)
	const body = `${title}${elapsed}${tail !== "" ? ` · ${tail}` : ""}`
	return `${marker} ${body}`
}

/** Up to `maxLines` display lines for one think row (pure, testable).
 *
 * The block always shows the TAIL — the last N non-blank lines, the same law
 * tui-pi's ThinkPanel uses (`TAIL_LINES = 3`). Live AND collapsed keep the
 * same tail: collapsing only swaps the prefix (`💭 thinking · ` → `💭 thought · `)
 * so the block never jumps back to the head at the collapse instant. The
 * first displayed line carries the `💭 … · Xs · ` prefix; continuation lines
 * are indented 3 columns (the width of `💭 `) so they sit under the content.
 *
 * Rows without panel state (replay shapes) paint nothing. */
export function thinkBlockLines(
	row: Extract<SeamRow, { kind: "reasoning" }>,
	spin: () => number,
	maxLines: number = DOCK_WIDGET_MAX_LINES,
	now: number = Date.now(),
): string[] {
	const lines = row.text.replace(/\r/g, "").split("\n").filter((line) => line.trim() !== "")
	const n = Math.max(1, Math.floor(maxLines))
	if (row.streaming === true) {
		const secs = row.startedAt !== undefined ? `${((now - row.startedAt) / 1000).toFixed(1)}s` : "0.0s"
		void spin()
		const picked = lines.length === 0 ? [""] : lines.slice(-n)
		return picked.map((line, index) => (index === 0 ? t("overlay.widgets.thinkStreaming", { secs, line }) : `   ${line}`))
	}
	if (row.elapsedSec !== undefined) {
		const secs = `${row.elapsedSec.toFixed(1)}s`
		const picked = lines.length === 0 ? [""] : lines.slice(-n)
		return picked.map((line, index) => (index === 0 ? t("overlay.widgets.thinkCollapsed", { secs, line }) : `   ${line}`))
	}
	return []
}

/** The 2026-11-19 rule table's three scenes. */
export type ActivityScene = "A" | "B" | "C"

/**
 * Pure scene decision (2026-11-19 rule table). PRIORITY = SUBAGENT ACTIVE >
 * THINK EXCLUSIVE: a RUNNING subagent opens scene A regardless of think; only
 * when there is none does a VISIBLE think (live OR inside its exit hold) open
 * scene B. Historical / non-running subagent rows never open A — per 指令3 a
 * leftover subagent row yields to an active think (scene B). No subagent and
 * no think → scene C.
 */
export function activityScene(hasRunningSubagent: boolean, hasVisibleThink: boolean): ActivityScene {
	if (hasRunningSubagent) return "A"
	return hasVisibleThink ? "B" : "C"
}

/**
 * Semantic dock line accents — each activity line family gets its own color
 * family so it reads as its own panel, not as default body copy:
 *   - think: VIOLET (`purple` ramp; dsh-tui-pi's `thinking` text token),
 *   - tool:  CYAN/TEAL (`cyan` ramp; dsh-tui-pi's blue tool panel family but
 *     shifted off the footer blue so it never reads as chrome),
 *   - todo:  GREEN (`green` ramp) — the compact todo tree rows,
 *   - agent: BLUE (`blue` ramp) — running subagent rows.
 * todo/agent are deliberately cool and far off `warning.base` (#e0af68,
 * the shared `tone:"running"` amber), so the two lower-zone row kinds stay
 * distinguishable both from that amber and from each other. Never reuse a
 * semantic alias (`accent`/`interactive`) here: on themes that alias both to
 * one hue that would collapse todo/agent (and tool) back to one color.
 * Every accent is picked from the theme's named hue ramps, preferring a soft
 * mid step and walking the ramp until the text clears 4.5:1 on the theme
 * surface (dark: later steps are dimmer; light: later steps are lighter).
 * Status glyphs (⚙/✔/✘) never use this — they keep their tone color.
 */
export type DockAccent = "think" | "tool" | "todo" | "agent"
