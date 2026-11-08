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
import { For, createSignal, Show, type JSX } from "solid-js"
import { useTerminalDimensions, onAnimationTick } from "@opentui/solid"
import { parseColor, TextAttributes, type RGBA } from "@opentui/core"
import type { SeamRow } from "./seam-rows"
import { clipToWidth, toolDetail, toolResultLine, toolSubject } from "./tool-summarize"
import { parseTodos } from "../../util/todo"
import { useThemeOptional } from "../../context/theme"
import { motionAnimationRunning, motionDecorationsEnabled, motionFrameRate } from "../../skin/motion"
import { COMPOSER_COMPACT_TERMINAL_ROWS, unfocusedBorderColor } from "../../skin/semantic"

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

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
 * call site; reduced/off simply read full color. */
const lineFirstSeen = new Map<string, number>()
export function skinLineFadeT(id: string, now: number = Date.now()): number {
	let seen = lineFirstSeen.get(id)
	if (seen === undefined) {
		seen = now
		lineFirstSeen.set(id, seen)
	}
	return Math.max(0, Math.min(1, (now - seen) / SKIN_FADE_IN_MS))
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

/** Todos summary line (pure, testable): the todo array of the latest
 * settled todo tool row (see todoArray for the accepted shapes). No todos
 * → ''. Batch D5b hide-law: ALL completed → '' too (the tui-pi semantics —
 * the row only earns its line while work remains). */
export function todosSummaryLine(output: string | undefined): string {
	const todos = parseTodos(todoArray(output) ?? [])
	if (todos.length === 0) return ""
	const done = todos.filter((t) => t.status === "completed").length
	if (done === todos.length) return ""
	const active = todos.find((t) => t.status === "in_progress")
	const head = `todos [✓]${done}/${todos.length}`
	return active ? `${head} · ${active.content}` : head
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
 * panel line. `tone` keys the status-color family (resolved at render).
 * `id` is the STABLE entrance-fade key (spinner glyphs churn the text —
 * the id must not); `fadeOutAt` anchors the exit fade (H5 view-side math). */
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
	// Todos panel (single line): the latest SETTLED, non-failed todo tool
	// row (a rejected call's args were never applied). The list comes from
	// the call args (dsh host shape) else the output brief (opencode shape).
	const todoTool = [...all]
		.reverse()
		.find((row) => row.kind === "tool" && TODO_TOOL_NAMES.has(row.name) && row.output !== undefined && row.status !== "failed")
	const todos =
		todoTool?.kind === "tool" ? todosSummaryLine(todoArray(todoTool.args) !== undefined ? todoTool.args : todoTool.output) : ""
	if (todos !== "") out.push({ text: todos, tone: "muted", id: "dock:todos" })
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

/** The turn-lifetime activity frame content (pure): EXACTLY three slots —
 * todo / thinking / tool (skin contract §1 活动区) — each painted per the D5
 * laws, empty slots left blank. The fixed-3 law caps the tool slot at the
 * most recent visible tool line (multi-tool turns show the newest inside
 * the frame; the flat non-frame dock still lists every tool line). */
export function activityLines(rows: readonly SeamRow[]): [DockLine, DockLine, DockLine] {
	const blank: DockLine = { text: "", tone: "muted" }
	const flat = dockLines(rows)
	const todo = flat.find((line) => line.id === "dock:todos") ?? blank
	const think = flat.find((line) => line.id?.startsWith("dock:think:")) ?? blank
	const tools = flat.filter((line) => line.id?.startsWith("dock:tool:"))
	const tool = tools.length > 0 ? tools[tools.length - 1]! : blank
	return [todo, think, tool]
}

/** Compact-terminal form (contract 矮终端): the frame collapses to a left
 * rule with the title written into the first line (H2 mitigation), still
 * exactly three rows. */
export function activityRuleLines(rows: readonly SeamRow[]): [DockLine, DockLine, DockLine] {
	const [todo, think, tool] = activityLines(rows)
	const head = todo.text === "" ? `┃ activity` : `┃ activity · ${todo.text}`
	return [
		{ ...todo, text: head, id: "dock:activity-head" },
		{ ...think, text: think.text === "" ? "" : `┃ ${think.text}` },
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

/** The dock. Mounted by the v2-entry page as the transcript's `widgets`
 * slot — directly above the composer (the editor).
 *
 * Skin (batch δ): the turn-lifetime activity frame (contract §1 活动区) —
 * `turnActive` (optional accessor prop, host wiring) wins; without it the
 * turn is derived from the rows (dockTurnActive). Inside the frame the
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
	const turnActive = () => props.turnActive?.() ?? dockTurnActive(props.rows)
	const frame = () => activityFrameMode(dimensions().height)

	const lineView = (line: DockLine) => (
		<text fg={lineFg(line)} attributes={line.italic === true ? TextAttributes.ITALIC : undefined} wrapMode="none">
			{clipToWidth(line.text, width())}
		</text>
	)

	return (
		<Show when={turnActive()} fallback={<FlatDock rows={props.rows} width={width()} fgFor={fgFor} skinCtx={skinCtx()} />}>
			<Show
				when={frame() === "frame"}
				fallback={
					<box flexShrink={0} flexDirection="column" width="100%" height={3} paddingLeft={3}>
						<For each={activityRuleLines(props.rows)}>{lineView}</For>
					</box>
				}
			>
				{/* Explicit border (the borderColor-only trap opens four sides
				 * implicitly — contract §2.4). Height = 2 border rows + 3 fixed
				 * content rows (title rides the top border, adds no rows). */}
				<box
					flexShrink={0}
					flexDirection="column"
					width="100%"
					height={5}
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
