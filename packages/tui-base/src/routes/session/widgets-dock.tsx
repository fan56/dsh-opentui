/**
 * WidgetsDock — batch D1: the fixed widgets slot above the composer
 * (dsh-tui-pi dock structure). The transcript renders ONLY user/assistant/
 * echo/notice/ask blocks (never tools/thinking); the live activity that the
 * old V1/V2a build painted as transcript rows docks here instead —
 * Todos → Think → Tool, three fixed panels, each panel a SINGLE line that
 * refreshes in place (no remount, no scroll coupling, never in the
 * transcript flow).
 *
 *   Todos  `todos [✓]2/3 · <current>`     — from the latest todo tool call
 *   Think  `💭 thinking · Xs · <tail>`    — italic while the burst runs;
 *          collapses to `💭 thought · Xs · <first line>` (the seam-rows fade
 *          machine clears it ~1s after the burst stops — batch D5)
 *   Tool   `⚙ name(subject) · Xs · <tail>` per tool line; settled freezes
 *          ✔/✘ + elapsed, then fades ~1s later (batch D5: `faded`);
 *          multiple tools = multiple lines, each updated in place
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
import { For, createEffect, createSignal, onCleanup, Show, untrack, type JSX } from "solid-js"
import { useTerminalDimensions, onAnimationTick } from "@opentui/solid"
import { parseColor, TextAttributes, type RGBA } from "@opentui/core"
import type { SeamRow } from "./seam-rows"
import { clipToWidth, toolDetail, toolResultLine, toolSubject } from "./tool-summarize"
import { parseTodos, type Todo } from "../../util/todo"
import { stringWidth } from "../../util/string-width"
import { useThemeOptional } from "../../context/theme"
import { motionAnimationRunning, motionDecorationsEnabled, motionFrameRate } from "../../skin/motion"
import { COMPOSER_COMPACT_TERMINAL_ROWS, unfocusedBorderColor } from "../../skin/semantic"

// ---------------------------------------------------------------------------
// Skin motion timing (skin contract §1 入场淡入/退场渐隐/提醒脉冲, batch δ).
// Pure so the fades/pulses are unit-testable; the VIEW layer derives progress
// from timestamps — the seam-rows phase machine (stop → clear at 1s) is
// untouched, per H5: the fade completes INSIDE the existing window.
// ---------------------------------------------------------------------------

/** Dock line entrance fade: text color faint → target, 0.4s. */
export const SKIN_FADE_IN_MS = 400
/** Exit fade hold: the line stays fully colored for the first 700ms of the
 * seam-rows 1s fade window (contract: 停 0.7s、淡 0.3s, clear moment unchanged). */
export const SKIN_HOLD_MS = 700
/** Exit fade sweep after the hold (700 + 300 = 1000 = seam-rows fade window). */
export const SKIN_FADE_OUT_MS = 300
/** Notice fade-out inside the LAST 500ms of the 8s TTL (remove moment unchanged). */
export const SKIN_NOTICE_FADE_MS = 500
/** Reminder pulse: 3 bright/dim cycles ≈ 1.2s, then静止 at full brightness. */
export const SKIN_PULSE_MS = 1200
export const SKIN_PULSE_CYCLES = 3
/** How dim the pulse dips (0 = off-black, 1 = full color). */
export const SKIN_PULSE_DIM = 0.45
/** How faint the entrance start is (mix toward the background). */
export const SKIN_FAINT_MIX = 0.78

/** Linear mix of two color inputs (hex/rgb string or RGBA) → hex string.
 * parseColor's channel getters are NORMALIZED floats (0-1) — scale back to
 * the 0-255 byte range here. */
export function mixSkinColor(a: string | RGBA, b: string | RGBA, t: number): string {
	const ca = parseColor(a)
	const cb = parseColor(b)
	const k = Math.max(0, Math.min(1, t))
	const ch = (x: number, y: number) => Math.round((x + (y - x) * k) * 255)
	return `#${[ch(ca.r, cb.r), ch(ca.g, cb.g), ch(ca.b, cb.b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

/** The "faint" start color: the target washed out toward the background. */
export function skinFaintColor(target: string | RGBA, background: string | RGBA): string {
	return mixSkinColor(target, background, SKIN_FAINT_MIX)
}

/** Entrance fade color: faint at 0ms → target at SKIN_FADE_IN_MS. */
export function skinFadeInColor(target: string | RGBA, background: string | RGBA, elapsedMs: number): string {
	return mixSkinColor(skinFaintColor(target, background), target, elapsedMs / SKIN_FADE_IN_MS)
}

/** Exit fade progress within the 1s seam window: 0 during the 700ms hold,
 * 0→1 across the 300ms sweep, 1 after (row is gone by then anyway). */
export function skinFadeOutProgress(elapsedSinceStopMs: number): number {
	if (elapsedSinceStopMs <= SKIN_HOLD_MS) return 0
	return Math.max(0, Math.min(1, (elapsedSinceStopMs - SKIN_HOLD_MS) / SKIN_FADE_OUT_MS))
}

/** Exit fade color: target during the hold, → background across the sweep. */
export function skinFadeOutColor(target: string | RGBA, background: string | RGBA, elapsedSinceStopMs: number): string {
	return mixSkinColor(target, background, skinFadeOutProgress(elapsedSinceStopMs))
}

/** Notice fade progress: 0 until the last SKIN_NOTICE_FADE_MS of the TTL,
 * then 0→1. The removal timer is untouched (H5/notifications). */
export function skinNoticeFadeProgress(elapsedMs: number, ttlMs: number): number {
	return Math.max(0, Math.min(1, (elapsedMs - (ttlMs - SKIN_NOTICE_FADE_MS)) / SKIN_NOTICE_FADE_MS))
}

/** Reminder pulse brightness (pure): SKIN_PULSE_CYCLES triangular dips over
 * SKIN_PULSE_MS (≈1.2s), then a constant 1 (bright,静止). 1 = full color. */
export function skinPulseBrightness(elapsedMs: number): number {
	if (elapsedMs >= SKIN_PULSE_MS || elapsedMs < 0) return 1
	const cycle = SKIN_PULSE_MS / SKIN_PULSE_CYCLES
	const phase = (elapsedMs % cycle) / cycle // 0..1 within the cycle
	return 1 - SKIN_PULSE_DIM * (1 - Math.abs(2 * phase - 1))
}

/** The stop anchor a view can compute WITHOUT touching the store: the row
 * froze elapsedSec at its stop, so stop ≈ startedAt + elapsedSec*1000 (H5).
 * undefined when either side is missing (replay rows) — no fade, solid color. */
export function skinStopAt(row: { startedAt?: number; elapsedSec?: number }): number | undefined {
	return row.startedAt !== undefined && row.elapsedSec !== undefined ? row.startedAt + row.elapsedSec * 1000 : undefined
}

/** Per-line entrance-fade registry (module level — CLOSURE LAW): first sight
 * timestamp per stable line id. Gated by motionDecorationsEnabled at the
 * call site; reduced/off simply read full color. P2-1 (review): capped FIFO
 * (long sessions must not grow it without bound) and `resetSkinLineFades`
 * on session switches — the stable "dock:todos" id must re-fade for a NEW
 * session's first todo line instead of keeping the old timestamp. */
const LINE_FIRST_SEEN_MAX = 512
const lineFirstSeen = new Map<string, number>()
export function skinLineFadeT(id: string, now: number = Date.now()): number {
	let seen = lineFirstSeen.get(id)
	if (seen === undefined) {
		seen = now
		if (lineFirstSeen.size >= LINE_FIRST_SEEN_MAX) {
			const oldest = lineFirstSeen.keys().next().value
			if (oldest !== undefined) lineFirstSeen.delete(oldest)
		}
		lineFirstSeen.set(id, seen)
	}
	return Math.max(0, Math.min(1, (now - seen) / SKIN_FADE_IN_MS))
}

/** Session switch hook: drop every first-sight timestamp so the next paint
 * re-runs the entrance fades (the v2 entry's clear/reload hooks call this —
 * /new, /fork, /resume, /clear). */
export function resetSkinLineFades(): void {
	lineFirstSeen.clear()
}

/** Component-side line color (shared by the docks, batch δ): exit fade
 * (inside the seam 1s window) wins, then the entrance fade, else the plain
 * target color. `decorated: false` (reduced/off tier) jumps straight to
 * the final color — contract §1 动效档位. */
export type SkinFgContext = { decorated: boolean; background: string | RGBA }
export function skinDockLineFg(ctx: SkinFgContext, target: string | RGBA, line: { id?: string; fadeOutAt?: number }): string | RGBA {
	if (!ctx.decorated) return target
	if (line.fadeOutAt !== undefined) {
		const sinceStop = Date.now() - line.fadeOutAt
		if (sinceStop > SKIN_HOLD_MS) return skinFadeOutColor(target, ctx.background, sinceStop)
	}
	const id = line.id
	if (id === undefined) return target
	const t = skinLineFadeT(id)
	return t >= 1 ? target : skinFadeInColor(target, ctx.background, t * SKIN_FADE_IN_MS)
}

/** Shared dock spinner tick — MODULE-level so no render closure owns it
 * (one interval per dock mount flips it; every line reads it lazily).
 * Batch D2: the lastRequest dock below the editor reads the SAME tick
 * (one interval owns the braille cadence for both docks). */
export const [dockSpin, setDockSpin] = createSignal(0)

/** The todo array inside one todo-tool text, or undefined when the text
 * carries none. Two shapes: a bare array (the opencode output brief) or
 * `{ todos: [...] }` (the dsh host's todo_write call ARGUMENTS — its
 * tool/result wire carries only the rendered `Updated todo list: …` text,
 * never the array). */
function todoArray(text: string | undefined): unknown[] | undefined {
	if (text === undefined || text.trim() === "") return undefined
	try {
		const parsed = JSON.parse(text) as unknown
		if (Array.isArray(parsed)) return parsed
		if (parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { todos?: unknown }).todos)) {
			return (parsed as { todos: unknown[] }).todos
		}
	} catch {
		/* not JSON — no todo array */
	}
	return undefined
}

/** Max todo rows the table shows (dsh-tui-pi `TODO_MAX_ROWS`). Longer lists
 * window onto the active items: running first, then the queue, completed
 * last (newest-first inside the done group). */
export const TODO_MAX_ROWS = 5

/** Table cell separator (dsh-tui-pi `TABLE_SEP`). */
const TABLE_SEP = " │ "

/** Status icon of one todo (dsh-tui-pi `todoIcon`): pending / in-progress /
 * completed. `cancelled` (opencode-only) degrades to the pending box. */
export function todoIcon(status: string): string {
	if (status === "completed") return "☑"
	if (status === "in_progress") return "◐"
	return "☐"
}

/** Window priority (dsh-tui-pi `statusRank`). */
function statusRank(status: string): number {
	if (status === "in_progress") return 0
	if (status === "completed") return 2
	return 1
}

/** `[1,2,3,7,9]` → `1-3,7,9` (dsh-tui-pi `compactRanges`). */
function compactRanges(numbers: readonly number[]): string {
	if (numbers.length === 0) return ""
	const runs: string[] = []
	let start = numbers[0]!
	let prev = start
	for (const n of numbers.slice(1)) {
		if (n === prev + 1) {
			prev = n
			continue
		}
		runs.push(start === prev ? `${start}` : `${start}-${prev}`)
		start = prev = n
	}
	runs.push(start === prev ? `${start}` : `${start}-${prev}`)
	return runs.join(",")
}

/** Width-exact table cell (dsh-tui-pi `padCell`): flatten, clip with the
 * ellipsis, then pad to `width` columns. */
export function padCell(text: string, width: number, align: "left" | "right" = "left"): string {
	const flat = text.replace(/[\r\n]+/g, " ")
	const clipped = clipToWidth(flat, width)
	const pad = Math.max(0, width - stringWidth(clipped))
	return align === "right" ? " ".repeat(pad) + clipped : clipped + " ".repeat(pad)
}

/** One bordered table row of exactly `boxWidth` columns. */
function borderedRow(boxWidth: number, inner: string): string {
	const pad = Math.max(0, boxWidth - 4 - stringWidth(inner))
	return `│ ${inner}${" ".repeat(pad)} │`
}

/** The todo list of the latest SETTLED, non-failed todo tool row (a rejected
 * call's args were never applied). The list comes from the call args (dsh
 * host shape) else the output brief (opencode shape). */
export function latestTodos(rows: readonly SeamRow[]): Todo[] {
	const todoTool = [...rows]
		.reverse()
		.find((row) => row.kind === "tool" && TODO_TOOL_NAMES.has(row.name) && row.output !== undefined && row.status !== "failed")
	if (todoTool?.kind !== "tool") return []
	const source = todoArray(todoTool.args) !== undefined ? todoTool.args : todoTool.output
	return parseTodos(todoArray(source) ?? [])
}

/** The Todos table (pure, dsh-tui-pi `TodosPanel` parity): a bordered box
 * with the `● Todos (done/total)` header (plus a `· showing 4-8` range hint
 * when the 5-row window hides rows), the `# │ ✓ │ Task` table header and one
 * row per todo in plan order with GLOBAL numbers. No todos, or every todo
 * completed → zero rows (clear-when-done). `width` is the box's terminal
 * columns (box drawing included).
 *
 * Line granularity: the dock paints one <text> per table row, so each row
 * carries ONE tone — border/header rows are muted, a todo row takes its
 * status color (completed → ok, in-progress → running, pending → muted). */
export function todosTableLines(rows: readonly SeamRow[], width: number): DockLine[] {
	const todos = latestTodos(rows)
	if (todos.length === 0 || todos.every((todo) => todo.status === "completed")) return []
	const boxWidth = Math.max(16, width)
	const innerWidth = boxWidth - 4
	const colWidths = [3, 2, Math.max(8, innerWidth - 5 - TABLE_SEP.length * 2)]
	const border = "─".repeat(Math.max(0, boxWidth - 2))

	// The visible window (dsh-tui-pi law): at most TODO_MAX_ROWS entries
	// ranked in_progress → pending → completed (done newest-first), displayed
	// back in plan order with their GLOBAL numbers.
	const window = todos
		.map((todo, index) => ({ todo, index }))
		.sort(
			(a, b) =>
				statusRank(a.todo.status) - statusRank(b.todo.status) ||
				(a.todo.status === "completed" ? b.index - a.index : a.index - b.index),
		)
		.slice(0, TODO_MAX_ROWS)
		.sort((a, b) => a.index - b.index)

	const done = todos.filter((todo) => todo.status === "completed").length
	const showing = window.length < todos.length ? ` · showing ${compactRanges(window.map((entry) => entry.index + 1))}` : ""
	const header = clipToWidth(`● Todos (${done}/${todos.length})${showing}`, innerWidth)
	const out: DockLine[] = [
		{ text: `┌${border}┐`, tone: "muted" },
		{ text: borderedRow(boxWidth, header), tone: "muted" },
		{
			text: borderedRow(
				boxWidth,
				[padCell("#", colWidths[0]!, "right"), padCell("✓", colWidths[1]!), padCell("Task", colWidths[2]!)].join(TABLE_SEP),
			),
			tone: "muted",
		},
	]
	for (const { todo, index } of window) {
		const cells = [
			padCell(String(index + 1), colWidths[0]!, "right"),
			padCell(todoIcon(todo.status), colWidths[1]!),
			padCell(todo.content, colWidths[2]!),
		].join(TABLE_SEP)
		const tone: DockLine["tone"] =
			todo.status === "completed" ? "ok" : todo.status === "in_progress" ? "running" : "muted"
		out.push({ text: borderedRow(boxWidth, cells), tone })
	}
	out.push({ text: `└${border}┘`, tone: "muted" })
	return out
}

/** One dock tool line (pure, dsh-tui-pi ToolPanel height '1' parity):
 * `<⚙|✔|✘> <name> <subject> · Xs · <tail>`. NOT the old `⠋ ⚙ name(subject)`
 * form: the status icon IS the marker, the subject follows the name with a
 * space, a running tool's tail is the arg summary, a settled one's the
 * result tail (the raw JSON never renders). */
export function toolLineText(row: Extract<SeamRow, { kind: "tool" }>, spin: () => number): string {
	const subject = toolSubject(row.args)
	const title = subject === "" ? row.name : `${row.name} ${subject}`
	const elapsed =
		row.status === "running"
			? row.startedAt !== undefined
				? ` · ${((Date.now() - row.startedAt) / 1000).toFixed(1)}s`
				: ""
			: row.elapsedSec !== undefined
				? ` · ${row.elapsedSec.toFixed(1)}s`
				: ""
	const marker = row.status === "running" ? "⚙" : row.status === "failed" ? "✘" : "✔"
	void spin()
	const tail = row.status === "running" ? toolDetail(row.args) : toolResultLine(row.output)
	const body = `${title}${elapsed}${tail !== "" ? ` · ${tail}` : ""}`
	return `${marker} ${body}`
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

/** The dock line set (pure): Think → Tool, one entry per visible panel line.
 * The Todos table is NOT part of it (tui-pi parity): it owns its own
 * multi-row block above the think/tool lines (see `todosTableLines`).
 * `tone` keys the status-color family (resolved at render). `id` is the
 * STABLE entrance-fade key (spinner glyphs churn the text — the id must
 * not); `fadeOutAt` anchors the exit fade (H5 view-side math). */
export type DockLine = {
	text: string
	tone: "ok" | "running" | "failed" | "muted"
	italic?: boolean
	id?: string
	fadeOutAt?: number
}

/** The todo brief carrier: the opencode-side name is `todowrite`; the dsh
 * host registers `tool-todo` whose model-side call name (the one the seam
 * rows carry off the host stream events) is `todo_write`. Both spellings
 * are the same tool — the set stays EXACT so nothing else starting with
 * "todo" can hijack the panel. */
const TODO_TOOL_NAMES = new Set(["todowrite", "todo_write"])

export function dockLines(rows: readonly SeamRow[]): DockLine[] {
	const out: DockLine[] = []
	const all = rows
	// Think panel (single line): the LIVE burst wins; else the collapsed
	// summary inside its fade window (the seam-rows timer clears the row).
	const live = [...all].reverse().find((row) => row.kind === "reasoning" && row.streaming === true)
	const collapsed = [...all].reverse().find((row) => row.kind === "reasoning" && row.elapsedSec !== undefined)
	const thinkRow = live?.kind === "reasoning" ? live : collapsed?.kind === "reasoning" ? collapsed : undefined
	const think = thinkRow?.kind === "reasoning" ? thinkLineText(thinkRow, dockSpin) : undefined
	if (think !== undefined && thinkRow)
		out.push({ text: think, tone: "running", italic: true, id: `dock:think:${thinkRow.key}`, fadeOutAt: skinStopAt(thinkRow) })
	// Tool panel (one line per live tool row, in-place keyed updates).
	for (const row of all) {
		if (row.kind !== "tool" || !row.key.startsWith("tool:live:")) continue
		// Batch D5: settled tools fade out ~1s after settle (seam-rows flips
		// `faded`); running tools always show.
		if (row.faded === true && row.status !== "running") continue
		out.push({
			text: toolLineText(row, dockSpin),
			tone: row.status === "running" ? "running" : row.status === "failed" ? "failed" : "ok",
			id: `dock:tool:${row.key}`,
			fadeOutAt: row.status !== "running" ? skinStopAt(row) : undefined,
		})
	}
	return out
}

/** Turn activity, derived (pure): any live tool, a streaming think burst, an
 * unfinished assistant body, or a running subagent child means a turn is in
 * flight. The frame prop (`turnActive`) wins when the host provides it. */
export function dockTurnActive(rows: readonly SeamRow[]): boolean {
	return rows.some(
		(row) =>
			(row.kind === "tool" && row.status === "running") ||
			(row.kind === "reasoning" && row.streaming === true) ||
			(row.kind === "assistant" && row.final === false) ||
			(row.kind === "subagents" && row.children.some((child) => child.status === "running")),
	)
}

/** The turn-lifetime activity frame content (pure): EXACTLY two slots —
 * thinking / tool (skin contract §1 活动区) — each painted per the D5 laws,
 * empty slots left blank. The fixed law caps the tool slot at the most
 * recent visible tool line (multi-tool turns show the newest inside the
 * frame; the flat non-frame dock still lists every tool line). The Todos
 * table moved OUT of the frame to the widgets slot's own block (dsh-tui-pi
 * parity: the table is persistent, not turn-lifetime). */
export function activityLines(rows: readonly SeamRow[]): [DockLine, DockLine] {
	const blank: DockLine = { text: "", tone: "muted" }
	const flat = dockLines(rows)
	const think = flat.find((line) => line.id?.startsWith("dock:think:")) ?? blank
	const tools = flat.filter((line) => line.id?.startsWith("dock:tool:"))
	const tool = tools.length > 0 ? tools[tools.length - 1]! : blank
	return [think, tool]
}

/** Compact-terminal form (contract 矮终端): the frame collapses to a left
 * rule with the title written into the first line (H2 mitigation), still
 * exactly two rows. */
export function activityRuleLines(rows: readonly SeamRow[]): [DockLine, DockLine] {
	const [think, tool] = activityLines(rows)
	return [
		{ ...think, text: `┃ activity`, id: "dock:activity-head" },
		{ ...tool, text: tool.text === "" ? "" : `┃ ${tool.text}` },
	]
}

/** Frame vs left rule (pure): at or below the composer's compact threshold
 * the activity frame drops its border box (skin/semantic.ts owns the
 * threshold — the two lanes stay coordinated). */
export function activityFrameMode(terminalRows: number, compactRows: number = COMPOSER_COMPACT_TERMINAL_ROWS): "frame" | "rule" {
	return terminalRows <= compactRows ? "rule" : "frame"
}

/** Whether the dock needs the shared animation clock right now (pure):
 * any visible line (entrance fades / exit sweep) or a live child tree in
 * the lastRequest dock (which reads this module's dockSpin). */
export function dockNeedsClock(rows: readonly SeamRow[]): boolean {
	if (dockLines(rows).length > 0) return true
	return rows.some((row) => row.kind === "subagents" && row.children.some((child) => child.status === "running"))
}

// ---------------------------------------------------------------------------
// Flicker mitigation 1 (research/skin-flicker-analysis.md 缓解 1): the
// turn-lifetime activity frame MOUNT and UNMOUNT are each deferred one
// render tick (ACTIVITY_FRAME_DEFER_MS) so neither ever lands on the same
// frame as the turn-start reflow (transcript scroll + composer busy flip)
// or the turn-end reflow — the engine's diff-paint misses the frame border
// when all three coincide, leaving a 1-frame ghost (`┌─activity` remnant)
// that self-heals a frame later. Pure latch machine + module-level instance
// (dockSpin law: no component-scope reactive state closed over by JSX
// props). One-shot timers only (contract §2.2: no setInterval), disposed
// with the dock.
// ---------------------------------------------------------------------------

/** Defer window ≈ one render tick of reflow settling (analysis band
 * 50-100ms). */
export const ACTIVITY_FRAME_DEFER_MS = 60

/** Latch state: `shown` is what the JSX renders; `pending` is the deferred
 * op sitting on the one-shot timer. */
export interface FrameLatch {
	shown: boolean
	pending: "show" | "hide" | undefined
}

/** Pure transition: apply a new turn-liveness reading. Steady → unchanged.
 * A flip schedules the deferred op (caller arms the timer). A flip that
 * CONTRADICTS a pending op cancels it — a turn that ends within the window
 * of its own start never mounts the frame, and one that resumes within the
 * end window never flickers off. */
export function frameLatchNext(latch: FrameLatch, target: boolean): { latch: FrameLatch; schedule: boolean } {
	if (target === latch.shown) {
		if (latch.pending === undefined) return { latch, schedule: false }
		return { latch: { shown: latch.shown, pending: undefined }, schedule: false }
	}
	return { latch: { shown: latch.shown, pending: target ? "show" : "hide" }, schedule: true }
}

/** Pure timer-fire: commit the pending op (no-op when nothing is pending). */
export function frameLatchFire(latch: FrameLatch): FrameLatch {
	if (latch.pending === "show") return { shown: true, pending: undefined }
	if (latch.pending === "hide") return { shown: false, pending: undefined }
	return latch
}

/** Latch owner: the reactive signal lives here (module scope, like
 * `dockSpin`), the one-shot timer is cleared on every push and on dispose. */
export function createFrameLatch(ms: number = ACTIVITY_FRAME_DEFER_MS) {
	const [latch, setLatch] = createSignal<FrameLatch>({ shown: false, pending: undefined })
	let timer: ReturnType<typeof setTimeout> | undefined
	const clear = (): void => {
		if (timer !== undefined) {
			clearTimeout(timer)
			timer = undefined
		}
	}
	return {
		/** Deferred turn-liveness accessor for the JSX `Show`. */
		shown: (): boolean => latch().shown,
		/** Feed a turn-liveness reading (an effect in the dock body).
		 * FIX (feedback-loop): the latch read here MUST be untracked. The dock
		 * wires `createEffect(() => activityFrameLatch.push(turnActive()))` —
		 * a tracked read of `latch()` inside push makes that effect subscribe
		 * to the very signal push WRITES, and `frameLatchNext` returns a fresh
		 * object on every flip, so Object.is always reports a change: the
		 * effect re-fires synchronously, re-clears the just-armed timer and
		 * re-arms it — infinite recursion (stack overflow in bare solid;
		 * inside the app the render layer swallows it, the latch never leaves
		 * `pending`, and the activity frame NEVER mounts). `untrack` keeps the
		 * effect subscribed to turn-liveness only; the JSX `Show` still reads
		 * `shown()` tracked, so deferred mount/unmount stay reactive. */
		push: (target: boolean): void => {
			const next = frameLatchNext(untrack(latch), target)
			clear()
			setLatch(next.latch)
			if (next.schedule) timer = setTimeout(() => {
				timer = undefined
				setLatch(frameLatchFire(untrack(latch)))
			}, ms)
		},
		/** Unmount cleanup (contract §2.2: one-shot timers die with the owner). */
		dispose: clear,
	}
}

/** MODULE-level latch — the dock is a per-app singleton and module scope is
 * the CLOSURE-LAW-safe home (dockSpin precedent). */
export const activityFrameLatch = createFrameLatch()



/** The dock. Mounted by the v2-entry page as the transcript's `widgets`
 * slot — directly above the composer (the editor).
 *
 * Skin (batch δ): the turn-lifetime activity frame (contract §1 活动区) —
 * `turnActive` (optional accessor prop, host wiring) wins; without it the
 * turn is derived from the rows (dockTurnActive). The frame's mount and
 * unmount are each DEFERRED one render tick (flicker mitigation 1,
 * `activityFrameLatch` below the clock helpers) so they never share a frame
 * with the turn-boundary reflows. Inside the frame the
 * content area is EXACTLY three rows (todo/think/tool, D5 semantics, blank
 * empty slots); short terminals (≤ COMPOSER_COMPACT_TERMINAL_ROWS) drop the
 * box for a left rule with the title in the first line (H2). Line entrance
 * fade 0.4s and exit fade inside the seam-rows 1s window both ride the
 * shared motion clock — the old 120ms setInterval is GONE (contract §2.2:
 * no new timers; reduced/off jump straight to the final color). */
export function WidgetsDock(props: {
	/** The shared seam-rows store (getter-prop law: the page passes
	 * `{ get rows() { return projection.rows } }` — the STORE ARRAY itself,
	 * reactive through its proxy reads). */
	rows: readonly SeamRow[]
	/** Turn-lifetime override (δ): accessor answering "is a turn in flight".
	 * True for the whole turn — the activity frame shows from turn start to
	 * turn end (NOT per visible line, so a 0↔1 line flip never flickers the
	 * frame, H2). Omitted → derived from the rows (dockTurnActive). */
	turnActive?: () => boolean
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
	const bg = () => theme?.background.base ?? "#000000"
	const skinCtx = () => ({ decorated: motionDecorationsEnabled(), background: bg() })
	/** Line color: entrance fade-in (0.4s from first sight) then exit fade
	 * (inside the seam 1s window) — see skinDockLineFg. */
	const lineFg = (line: DockLine): string | RGBA => skinDockLineFg(skinCtx(), fgFor(line.tone), line)
	// Shared animation clock (contract §2.2 — replaces the old 120ms
	// setInterval): ticks only while the docks have live lines; undefined
	// pauses the clock (tier off / idle with nothing animating).
	onAnimationTick(
		() => (motionAnimationRunning() && dockNeedsClock(props.rows) ? motionFrameRate() : undefined),
		() => setDockSpin((s) => s + 1),
	)
	const width = () => Math.max(16, dimensions().width - 4)
	// Todos table width: the tui-pi box spans the widget slot at paddingX=1
	// (`columns - 2`), independent of the skin's 3-column line indent.
	const tableWidth = () => Math.max(16, dimensions().width - 2)
	const table = () => todosTableLines(props.rows, tableWidth())
	const turnActive = () => props.turnActive?.() ?? dockTurnActive(props.rows)
	// Mitigation 1: the frame's Show reads the DEFERRED latch, not the raw
	// turn liveness — mount/unmount land one render tick after the flip
	// (see createFrameLatch above). The latch timer dies with the dock.
	createEffect(() => activityFrameLatch.push(turnActive()))
	onCleanup(activityFrameLatch.dispose)
	const frame = () => activityFrameMode(dimensions().height)

	const lineView = (line: DockLine) => (
		<text fg={lineFg(line)} attributes={line.italic === true ? TextAttributes.ITALIC : undefined} wrapMode="none">
			{clipToWidth(line.text, width())}
		</text>
	)

	return (
		<box flexShrink={0} flexDirection="column" width="100%">
			{/* Todos slot (tui-pi parity): the persistent bordered table sits
			 * ABOVE the transient think/tool surface, outside the turn-lifetime
			 * activity frame (the tabular todos are not per-turn activity). */}
			<Show when={table().length > 0}>
				<box flexShrink={0} flexDirection="column" width="100%" height={table().length} paddingLeft={1}>
					<For each={table()}>
						{(line) => (
							<text fg={fgFor(line.tone)} wrapMode="none">
								{clipToWidth(line.text, tableWidth())}
							</text>
						)}
					</For>
				</box>
			</Show>
			<Show
				when={activityFrameLatch.shown()}
				fallback={<FlatDock rows={props.rows} width={width()} fgFor={fgFor} skinCtx={skinCtx()} />}
			>
				<Show
					when={frame() === "frame"}
					fallback={
						<box flexShrink={0} flexDirection="column" width="100%" height={2} paddingLeft={3}>
							<For each={activityRuleLines(props.rows)}>{lineView}</For>
						</box>
					}
				>
					{/* Explicit border (the borderColor-only trap opens four sides
					 * implicitly — contract §2.4). Height = 2 border rows + 2 fixed
					 * content rows (title rides the top border, adds no rows). */}
					<box
						flexShrink={0}
						flexDirection="column"
						width="100%"
						height={4}
						border={["top", "bottom", "left", "right"]}
						borderStyle="single"
						borderColor={unfocusedBorderColor(theme)}
						title="activity"
						titleAlignment="left"
					>
						<For each={activityLines(props.rows)}>{lineView}</For>
					</box>
				</Show>
			</Show>
		</box>
	)
}

/** The idle fallback dock (the pre-skin flat line list): after the turn
 * ends the frame disappears and any straggler lines (fading) keep the
 * original per-line height so the composer never jumps. */
function FlatDock(props: {
	rows: readonly SeamRow[]
	width: number
	fgFor: (tone: DockLine["tone"]) => string | RGBA
	skinCtx: SkinFgContext
}): JSX.Element {
	return (
		<box flexShrink={0} flexDirection="column" width="100%" height={dockLines(props.rows).length} paddingLeft={3}>
			<For each={dockLines(props.rows)}>
				{(line) => (
					<text fg={skinDockLineFg(props.skinCtx, props.fgFor(line.tone), line)} attributes={line.italic === true ? TextAttributes.ITALIC : undefined} wrapMode="none">
						{clipToWidth(line.text, props.width)}
					</text>
				)}
			</For>
		</box>
	)
}
