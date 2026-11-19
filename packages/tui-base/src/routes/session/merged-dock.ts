/**
 * Merged activity dock — DATA LAYER + pure row building (spec: docs/activity-merged-widget.md).
 *
 * This module is deliberately free of JSX / layout / scrollbox wiring. The UI
 * task consumes these pure functions. Two zones are built simultaneously:
 * an upper tool zone and a lower todo/subagent zone (D1), with a single
 * 10-line total cap (D8) and a title that never contains "todo" (D4).
 *
 * Width law (D13): every line returned by `mergedDockLines` is fitted to the
 * caller's `innerWidth` using the runtime `stringWidth` (via `takeWidth`),
 * never a character count. `lineWidth(line)` is exported so callers/tests can
 * assert the right boundary lands exactly on `innerWidth`.
 */

import type { SeamSubagentView } from "../../seams/session"
import type { Todo } from "../../util/todo"
import { graphemes, takeWidth } from "../../util/locale"
import { stringWidth } from "../../util/string-width"
import type { SeamRow } from "./seam-rows"
import {
	activityScene,
	skinStopAt,
	thinkBlockLines,
	todoBriefLine,
	todosSummaryFromTodos,
	toolLineText,
	toolMarker,
	type DockAccent,
} from "./widgets-dock"

// ---------------------------------------------------------------------------
// Constants & public types
// ---------------------------------------------------------------------------

/** Total visible-line cap for the merged dock (tool zone + lower zone +
 * indicators). A safety valve for extreme concurrency, not a normal target
 * (D8). */
export const MERGED_DOCK_TOTAL_LINES = 10

/** Upper tool zone in tool-only mode is min 1 / max 3 lines (D8). */
export const MERGED_DOCK_TOOL_ONLY_MAX = 3

/** Status glyph definitions (D6). Only `in_progress` is rendered under the
 * active-only policy, but all four are defined and retained — `cancelled` is
 * `⊘`, distinct from `○` — do not delete them. */
export const TODO_STATUS_GLYPHS = {
	pending: "○",
	in_progress: "●",
	completed: "✓",
	cancelled: "⊘",
} as const

/** A todo carrying its ORIGINAL 1-based plan index (D6/D7: plan order, no
 * renumbering, no rank reshuffle). */
export type ActiveTodo = Todo & { index: number }

export type MergedToolRow = Extract<SeamRow, { kind: "tool" }>
export type MergedThinkRow = Extract<SeamRow, { kind: "reasoning" }>
export type MergedAgent = SeamSubagentView

/** Structured input for `mergedDockLines`. The UI layer extracts think + tool
 * from the live seam rows, todos from `latestTodos`, and running agents from
 * the subagent face, then passes them here. `think` is optional so callers
 * that only build tool/todo lines (and the pre-think tests) stay valid. */
export interface MergedDockData {
	tools: readonly MergedToolRow[]
	todos: readonly Todo[]
	agents: readonly MergedAgent[]
	think?: readonly MergedThinkRow[]
	/** 指令4: optional explicit anchor for the scene-A todo brief (seconds
	 * counted from this wall clock). Pure callers/tests may pass one; the dock
	 * leaves it unset so `todoBriefLine` uses the unified text-signature
	 * first-seen map (task set establishment time, status flips ignored). */
	todoStartedAt?: number
}

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

export interface MergedDockOptions {
	/** Target INNER width. Every returned line is exactly this visible width. */
	innerWidth: number
	/** Injectable clock for elapsed columns (tests stay deterministic). */
	now?: number
	/** Injectable spinner tick (toolLineText parity); defaults to a no-op. */
	spin?: () => number
	/** Scroll position within the lower zone content (0-based top item). */
	cursor?: number
	/** Total visible-line cap for this render. Defaults to
	 * `MERGED_DOCK_TOTAL_LINES` (10) — a HARD ceiling, no gear growth rule.
	 * Upper zone + lower zone + indicators never exceed it. */
	totalLines?: number
	/** Think block line cap (the ONLY thing `session.activity_panel_height`
	 * controls since 2026-11-19): 1/5/7/10, `all`=10. Defaults to 1 (the
	 * legacy single think line). Tool/todo never read this. */
	thinkLines?: number
}

/** The lower-zone window geometry, computed once by `assembleZones` and shared
 * by the row builder, the title `N/M` suffix and the wheel cursor guard so the
 * three can never drift apart (D8 recon). `total` = M = `lowerRaw.length`;
 * `position` = N = `start + 1` (1-based first visible item). */
export interface MergedWindowInfo {
	/** M — total lower-zone content items (todo rows + agent sub-lines). */
	total: number
	/** N — 1-based index of the first visible lower item (`start + 1`). */
	position: number
	/** 0-based index of the first visible lower item (the clamped cursor). */
	start: number
	/** Number of lower content lines currently visible. */
	size: number
	/** True iff lower content exceeds the visible window (content > window).
	 * FALSE in the no-window case (cap ≤ 0 / no lower slot): there is no
	 * rendered window to overflow, so no N/M and no scroll markers are shown.
	 * `size = 0` there records that nothing lower is visible — it does NOT mean
	 * "everything fits" (that is the separate `n <= lowerBudget` branch). */
	overflow: boolean
	/** Largest valid 0-based cursor for the branch actually taken — the upper
	 * bound of that branch's `start` clamp. The wheel clamps to [0, maxCursor];
	 * at `maxCursor` the last lower item is the last content row (no dead zone).
	 * 0 when nothing scrolls (no window / everything fits). */
	maxCursor: number
}

export interface AgentAttribution {
	/** The last `in_progress` todo, or null when there is none (agents flat). */
	parent: { todo: Todo; index: number } | null
	/** Running agents only, in input order. */
	agents: MergedAgent[]
}

// ---------------------------------------------------------------------------
// Data layer
// ---------------------------------------------------------------------------

/** Active-only filter (D6): keep `in_progress` todos in original plan order,
 * each annotated with its ORIGINAL 1-based array index — never renumbered to
 * a contiguous 1..n. */
export function activeTodos(todos: readonly Todo[]): ActiveTodo[] {
	const out: ActiveTodo[] = []
	for (let i = 0; i < todos.length; i++) {
		const todo = todos[i]!
		if (todo.status === "in_progress") out.push({ ...todo, index: i + 1 })
	}
	return out
}

/** Subagent attribution (D7): every running agent hangs under the LAST
 * `in_progress` todo (by plan order, not last todo overall). No in_progress →
 * `parent = null` and the agents render flat. No pairing, text matching or
 * timing inference. Re-call after a state change to re-attach (D7 "parent
 * completes"). */
export function attributeAgents(todos: readonly Todo[], agents: readonly MergedAgent[]): AgentAttribution {
	let parent: { todo: Todo; index: number } | null = null
	for (let i = 0; i < todos.length; i++) {
		const todo = todos[i]!
		if (todo.status === "in_progress") parent = { todo, index: i + 1 }
	}
	return { parent, agents: agents.filter((agent) => agent.status === "running") }
}

/** Title composition (D4). Priority tool > subagent > think, at most two
 * items joined by ` · `. The word "todo" never appears — a todo is a state
 * record, not an in-progress activity.
 * Tool glyph is U+1F527 and must NOT carry VS16 — the renderer blanks VS16 graphemes in wcwidth mode (2026-11-17 decision). */
export function mergedTitle(parts: { tool: boolean; subagent: boolean; think: boolean }): string {
	if (parts.tool) return parts.subagent ? "🔧 tool · 🤖 subagent" : "🔧 tool"
	if (parts.subagent) return "🤖 subagent"
	if (parts.think) return "💭 think"
	return "🧩 activity"
}

/** The D8 title `N/M` block, derived ONLY from the window info the row builder
 * used. Returns `null` when the lower zone fits (no overflow) — in that case
 * the caller prints NO `N/M` (decided 2026-11-17). N = `position` = `start+1`,
 * M = `total` = total lower-zone items. */
export function mergedPositionSuffix(info: MergedWindowInfo): string | null {
	return info.overflow ? `${info.position}/${info.total}` : null
}

// ---------------------------------------------------------------------------
// Width helpers (D13)
// ---------------------------------------------------------------------------

/** Visible width of a structured line, computed with the runtime
 * `stringWidth` (emoji/ZWJ/CJK = 2, VS16/combining = 0). */
export function lineWidth(line: MergedDockLine): number {
	return line.segments.reduce((sum, segment) => sum + stringWidth(segment.text), 0)
}

function padTo(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - stringWidth(text)))
}

/** Drop `marker`/`markerAt` when cropping removed the glyph they point at, so
 * a stale marker assertion can never paint a half-present status icon. The
 * check mirrors `dockLineNode` (widgets-dock.tsx:1351-1353): the marker must
 * still sit intact at `markerAt` in the joined text. All other line fields
 * (id / fadeOutAt / italic) are preserved by the spread. */
function clearBrokenMarker(line: MergedDockLine): MergedDockLine {
	const marker = line.marker
	if (marker === undefined) return line
	const markerAt = line.markerAt ?? 0
	const joined = line.segments.map((segment) => segment.text).join("")
	if (markerAt < 0 || markerAt + marker.length > joined.length || joined.slice(markerAt, markerAt + marker.length) !== marker) {
		const { marker: _marker, markerAt: _markerAt, ...rest } = line
		return rest
	}
	return line
}

/** Fit a line to `innerWidth`: crop the trailing content segment with
 * `takeWidth` (display columns, grapheme-safe) and pad any grapheme-boundary
 * remainder. Guarantees `lineWidth(result) === innerWidth`. Every segment and
 * line field (accent / italic / id / fadeOutAt / marker / markerAt) is carried
 * through via spread; only marker/markerAt are cleared if cropping invalidated
 * them. */
function fitLine(line: MergedDockLine, innerWidth: number): MergedDockLine {
	const width = Math.max(0, Math.floor(innerWidth))
	if (lineWidth(line) === width) return line
	const segments = line.segments
	if (segments.length === 0) return line
	const prefixWidth = segments.slice(0, -1).reduce((sum, segment) => sum + stringWidth(segment.text), 0)
	if (prefixWidth >= width) {
		// Degenerate narrow width: collapse to one hard-cut segment. Only the
		// head of the first segment survives, so keep all of that segment's
		// fields (tone/accent) rather than just its tone.
		const first = segments[0]!
		const full = segments.map((segment) => segment.text).join("")
		return clearBrokenMarker({ ...line, segments: [{ ...first, text: padTo(takeWidth(full, width), width) }] })
	}
	const last = segments[segments.length - 1]!
	const avail = width - prefixWidth
	const cropped = takeWidth(last.text, avail)
	return clearBrokenMarker({ ...line, segments: [...segments.slice(0, -1), { ...last, text: padTo(cropped, avail) }] })
}

/** Trailing snippet by display width (for `lastLine` tail), grapheme-safe. */
function widthTail(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return ""
	const parts = graphemes(text)
	let out = ""
	let used = 0
	for (let i = parts.length - 1; i >= 0; i--) {
		const next = stringWidth(parts[i]!)
		if (used + next > maxWidth) break
		out = parts[i]! + out
		used += next
	}
	return out
}

function secsFrom(startedAt: number | undefined, elapsedSec: number | undefined, now: number): string {
	if (startedAt !== undefined) return `${((now - startedAt) / 1000).toFixed(1)}s`
	if (elapsedSec !== undefined) return `${elapsedSec.toFixed(1)}s`
	return "0.0s"
}

function toneForTool(status: MergedToolRow["status"]): MergedTone {
	return status === "failed" ? "failed" : status === "done" ? "ok" : "running"
}

/** Tool elapsed follows `toolLineText`: running ticks off `startedAt`,
 * settled uses the frozen `elapsedSec` (never recomputed from `startedAt`). */
function toolElapsed(tool: MergedToolRow, now: number): string {
	return tool.status === "running"
		? secsFrom(tool.startedAt, undefined, now)
		: secsFrom(undefined, tool.elapsedSec, now)
}

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

/** Coexistence mode (D5/D8): exactly one tool line, `⚙ <name> · <Xs>` —
 * the leading glyph still follows `toolMarker`, but subject/args/detail are
 * dropped. Only the latest tool row is passed in by the caller. */
function coexistenceToolLine(tool: MergedToolRow, now: number, spin: () => number): MergedDockLine {
	void spin()
	const marker = toolMarker(tool.status)
	const elapsed = toolElapsed(tool, now)
	const tone = toneForTool(tool.status)
	return {
		kind: "tool",
		segments: [
			// Marker segment keeps `tone` (no accent) — running/ok/failed color.
			{ text: `${marker} `, tone },
			// Body carries the tool accent; `accent` overrides `tone` at paint.
			{ text: `${tool.name} · ${elapsed}`, tone, accent: "tool" },
		],
		id: `dock:tool:${tool.key}`,
		fadeOutAt: tool.status !== "running" ? skinStopAt(tool) : undefined,
		marker,
		markerAt: 0,
	}
}

/** Tool-only mode (D5/D8): the FULL `toolLineText` format (subject/detail
 * included), reused verbatim from widgets-dock. */
function toolOnlyLine(tool: MergedToolRow, now: number, spin: () => number): MergedDockLine {
	const text = toolLineText(tool, spin, now)
	const marker = toolMarker(tool.status)
	const tone = toneForTool(tool.status)
	// `toolLineText` returns `${marker} ${body}` (widgets-dock.tsx:538-542), so
	// the glyph is at offset 0. Split it into a tone-colored marker segment and
	// an accent-colored body segment; joined text is byte-for-byte the original.
	return {
		kind: "tool",
		segments: [
			{ text: marker, tone },
			{ text: text.slice(marker.length), tone, accent: "tool" },
		],
		id: `dock:tool:${tool.key}`,
		fadeOutAt: tool.status !== "running" ? skinStopAt(tool) : undefined,
		marker,
		markerAt: 0,
	}
}

/** Pick the think row to show (D5 upper zone): the latest LIVE streaming burst
 * wins, else the latest collapsed summary. Mirrors `dockBlocks`' selection so
 * the merged frame shows the same think the old dock did. */
export function latestThinkRow(rows: readonly MergedThinkRow[]): MergedThinkRow | undefined {
	const live = [...rows].reverse().find((row) => row.streaming === true)
	if (live !== undefined) return live
	for (let i = rows.length - 1; i >= 0; i--) {
		const row = rows[i]!
		if (row.elapsedSec !== undefined) return row
	}
	return undefined
}

/** Think lines (D1/D5, gear-driven since 2026-11-19): the text is produced by
 * the shared `thinkBlockLines` (widgets-dock.tsx) with `maxLines = thinkLines`
 * — the same `💭 thinking · <secs> · <snippet>` / `💭 thought · <secs> ·
 * <snippet>` format the old upper zone used, never a second hand-rolled
 * format. Continuation lines carry the 3-column indent from `thinkBlockLines`.
 * `thinkLines = 1` keeps the legacy single line. Rows without panel state
 * paint nothing (`thinkBlockLines` returns []). */
function thinkLinesFor(row: MergedThinkRow, now: number, spin: () => number, thinkLines: number): MergedDockLine[] {
	return thinkBlockLines(row, spin, thinkLines, now).map((text) => ({
		kind: "think" as const,
		// Whole text is accent-colored (no marker to keep tone).
		segments: [{ text, tone: "running" as const, accent: "think" as const }],
		italic: true,
		id: `dock:think:${row.key}`,
		// A live burst carries no exit anchor, even with a stale elapsedSec
		// (M2 view-side rule, widgets-dock.tsx).
		fadeOutAt: row.streaming === true ? undefined : skinStopAt(row),
	}))
}

/** Agent sub-line (D6): `├─ `/`└─ ` branch, indented just after the index,
 * `<label> · <Xs> · round <N> · <lastLine tail>`. */
function agentLine(agent: MergedAgent, position: number, count: number, parentIndex?: number, now = Date.now()): MergedDockLine {
	const branch = position === count - 1 ? "└─ " : "├─ "
	const indent = parentIndex === undefined ? "" : " ".repeat(stringWidth(`${TODO_STATUS_GLYPHS.in_progress} ${parentIndex} `))
	const elapsed = secsFrom(agent.startedAt, agent.elapsedSec, now)
	const tail = widthTail(agent.lastLine ?? "", 32)
	const content = `${agent.label} · ${elapsed} · round ${agent.rounds} · ${tail}`
	return {
		kind: "agent",
		index: parentIndex,
		segments: [
			{ text: `${indent}${branch}`, tone: "muted" },
			{ text: content, tone: "running" },
		],
	}
}

function indicatorLine(kind: "more-top" | "more-bottom", count: number): MergedDockLine {
	return {
		kind,
		segments: [{ text: `${kind === "more-top" ? "▲" : "▼"} ${count} more`, tone: "muted" }],
	}
}

function clamp(value: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, value))
}

// ---------------------------------------------------------------------------
// Row assembly
// ---------------------------------------------------------------------------

/**
 * Build the merged dock's structured lines. See the module header and the
 * spec sections D4–D8 for the full contract.
 *
 * - 2026-11-19 scene table (see widgets-dock.tsx header): A = running subagent
 *   → pinned think(1)/tool(1)/todo brief(1) above a clipped subagent list;
 *   B = no subagent + visible think → gear-driven think lines only; C = no
 *   subagent + no think → up to 3 full-format tool lines + one todo summary.
 * - The 10-line total cap counts every line and indicator; visible content
 *   never exceeds it, and `▼ N more` / `▲ N more` counts are self-consistent.
 * - Every returned line is fitted to `innerWidth` (D13).
 */
export function mergedDockLines(data: MergedDockData, options: MergedDockOptions): MergedDockLine[] {
	return buildMergedDock(data, options).lines
}

/** Lower-zone window geometry for the SAME `{start, n, size}` the row builder
 * used. The UI calls this with the same data/options as `mergedDockLines` so
 * the title `N/M`, the scroll guard and the rendered window cannot disagree. */
export function mergedWindowInfo(data: MergedDockData, options: MergedDockOptions): MergedWindowInfo {
	return buildMergedDock(data, options).info
}

/** Single build site for both the lines and the window info (recon: derive it
 * in one place). Cursor is clamped on EVERY build inside `assembleZones`, so a
 * stale/shrunk cursor can never blank the window. */
function buildMergedDock(
	data: MergedDockData,
	options: MergedDockOptions,
): { lines: MergedDockLine[]; info: MergedWindowInfo } {
	const now = options.now ?? Date.now()
	const spin = options.spin ?? (() => 0)

	// `attributeAgents` keeps RUNNING agents only — a historical subagents row
	// never opens scene A (指令3: it yields to an active think / scene B).
	const agents = attributeAgents(data.todos, data.agents).agents

	// The selected think row is VISIBLE (live or inside its exit hold). Rows
	// without panel state produce no lines, which also means "no visible think"
	// for scene detection. Build its lines once (gear cap) for scene B, and
	// rebuild at one line for scene A (指令 A pins think to a single row).
	const thinkRow = latestThinkRow(data.think ?? [])
	const thinkAtGear = thinkRow === undefined ? [] : thinkLinesFor(thinkRow, now, spin, options.thinkLines ?? 1)
	const scene = activityScene(agents.length > 0, thinkAtGear.length > 0)
	const tools = data.tools

	let upperLines: MergedDockLine[]
	let lowerRaw: MergedDockLine[]

	if (scene === "A") {
		// PINNED ABOVE the list, in order: think(1) → tool(1) → todo brief(1).
		// Think/tool shrink to a single line regardless of gear or terminal.
		upperLines = thinkRow === undefined ? [] : thinkLinesFor(thinkRow, now, spin, 1).slice(0, 1)
		const latest = tools.length > 0 ? tools[tools.length - 1]! : undefined
		if (latest !== undefined) upperLines.push(coexistenceToolLine(latest, now, spin))
		const brief = todoBriefLine(data.todos, now, data.todoStartedAt)
		if (brief !== "") upperLines.push({ kind: "todo", segments: [{ text: brief, tone: "running" }] })
		// The subagent list takes ALL remaining lines under the existing scroll
		// clipping. No parent todo row: the todo is the brief above.
		lowerRaw = agents.map((agent, i) => agentLine(agent, i, agents.length, undefined, now))
	} else if (scene === "B") {
		// Think exclusive: gear-driven think lines; tool/todo/subagent all hidden.
		upperLines = thinkAtGear
		lowerRaw = []
	} else {
		// Scene C: no running subagent, no visible think. Tool keeps its fixed
		// full-format cap; todo is ONE line in the current summary format.
		upperLines = tools.slice(-MERGED_DOCK_TOOL_ONLY_MAX).map((tool) => toolOnlyLine(tool, now, spin))
		const summary = todosSummaryFromTodos(data.todos)
		lowerRaw = summary === "" ? [] : [{ kind: "todo", segments: [{ text: summary, tone: "running" }] }]
	}

	const assembled = assembleZones(upperLines, lowerRaw, options.totalLines ?? MERGED_DOCK_TOTAL_LINES, options.cursor)
	return { lines: fitAll(assembled.lines, options.innerWidth), info: assembled.info }
}

/** Split the lower content into a window + indicators under the shared cap.
 * `upperLines` is the scene's pinned block (think/tool/todo brief for A, the
 * think lines for B, the tool lines for C), rendered above the lower zone and
 * counted against `totalLines`. `totalLines` is the HARD 10-line ceiling; it
 * defaults to `MERGED_DOCK_TOTAL_LINES`.
 *
 * Small-cap edge rule (documented for the tests): content wins over scroll
 * indicators when the lower budget is too tight for both. Budget 1 → exactly
 * one content line at the clamped cursor, no indicator (an indicator would
 * leave zero content). Budget 2 with BOTH indicators needed → the whole lower
 * budget goes to content (no indicators); a single-indicator case still keeps
 * its one content line + one indicator. No negative `slice` window in any
 * case. With no lower slot at all the lower zone is not rendered. The upper
 * zone is trimmed from its head first so the frame never exceeds `totalLines`
 * even at gear 1 (newest line wins). */
function assembleZones(
	upperLines: MergedDockLine[],
	lowerRaw: MergedDockLine[],
	totalLines: number,
	cursor?: number,
): { lines: MergedDockLine[]; info: MergedWindowInfo } {
	const n = lowerRaw.length
	// No window (cap ≤ 0, or no lower slot): nothing to scroll, no N/M. The
	// `overflow: false` / `size: 0` pair here is intentional — see the field
	// docs on MergedWindowInfo: there is no rendered window, so no N/M or
	// scroll markers are shown, and no cursor is valid (`maxCursor = 0`).
	const noWindow = (): MergedWindowInfo => ({ total: n, position: 1, start: 0, size: 0, overflow: false, maxCursor: 0 })
	if (totalLines <= 0) return { lines: [], info: noWindow() }
	const upper = upperLines.length <= totalLines ? upperLines : upperLines.slice(-totalLines)
	const lowerBudget = totalLines - upper.length
	if (lowerBudget < 1) return { lines: [...upper], info: noWindow() } // no lower slot: renders nothing
	if (n <= lowerBudget) {
		// Everything fits: NO overflow, hence NO N/M (decided 2026-11-17). The
		// cursor is ignored (start is always 0), so maxCursor is 0.
		return {
			lines: [...upper, ...lowerRaw],
			info: { total: n, position: 1, start: 0, size: n, overflow: false, maxCursor: 0 },
		}
	}

	// Overflow below. Each branch derives `maxCursor` from the SAME upper bound
	// it uses to clamp `start`, so `assembleZones` is the single source of the
	// maximum VALID start: cursor = maxCursor puts the last item in the last
	// content row, and any larger cursor clamps back to that same start. A stale
	// cursor is clamped on EVERY build so it can never blank the window.
	// One-line lower budget: a scroll indicator would consume the only slot and
	// leave zero content. Show one content line at the cursor, no indicators.
	if (lowerBudget === 1) {
		const maxCursor = n - 1
		const start = clamp(cursor ?? 0, 0, maxCursor)
		return {
			lines: [...upper, lowerRaw[start]!],
			info: { total: n, position: start + 1, start, size: 1, overflow: true, maxCursor },
		}
	}

	let size = lowerBudget - 1
	let maxCursor = n - size
	let start = clamp(cursor ?? 0, 0, maxCursor)
	let needTop = start > 0
	let needBottom = start + size < n
	if (needTop && needBottom) {
		if (lowerBudget < 3) {
			// Budget 2 cannot fit content + both indicators: give the whole
			// budget to content (no indicators), keeping the count consistent.
			maxCursor = n - lowerBudget
			start = clamp(cursor ?? 0, 0, maxCursor)
			return {
				lines: [...upper, ...lowerRaw.slice(start, start + lowerBudget)],
				info: { total: n, position: start + 1, start, size: lowerBudget, overflow: true, maxCursor },
			}
		}
		// Both indicators are needed: reserve one line for each.
		size = lowerBudget - 2
		maxCursor = n - size - 1
		start = clamp(cursor ?? 0, 1, maxCursor)
		needTop = start > 0
		needBottom = start + size < n
	}
	void needTop // start/size already encode it

	const topCount = start
	const bottomCount = n - (start + size)
	const window = lowerRaw.slice(start, start + size)
	const lower: MergedDockLine[] = []
	if (topCount > 0) lower.push(indicatorLine("more-top", topCount))
	lower.push(...window)
	if (bottomCount > 0) lower.push(indicatorLine("more-bottom", bottomCount))
	return {
		lines: [...upper, ...lower],
		info: { total: n, position: start + 1, start, size, overflow: topCount + bottomCount > 0, maxCursor },
	}
}

function fitAll(lines: MergedDockLine[], innerWidth: number): MergedDockLine[] {
	return lines.map((line) => fitLine(line, innerWidth))
}
