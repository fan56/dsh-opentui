/**
 * Batch D1: the widgets dock's pure line builders (./widgets-dock.tsx).
 * The dock renders Todos → Think → Tool single lines above the composer;
 * these cover the data-shape contracts without a renderer:
 *   - todosSummaryLine digs the todo array out of the todowrite follow
 *     brief (JSON.stringify(output).slice(0, 300)) and degrades to '';
 *   - thinkLineText: streaming → `💭 thinking · Xs · <tail>`; collapsed →
 *     `💭 thought · Xs · <first line>`; panel-less replay rows → undefined.
 */
import { describe, expect, test } from "bun:test"
import {
	ACTIVITY_FRAME_BORDER_FALLBACK,
	ACTIVITY_FRAME_DEFER_MS,
	activityFrameBorderColor,
	boostUntilContrast,
	hueAngle,
	createFrameLatch,
	frameLatchFire,
	frameLatchNext,
	type FrameLatch,
	activityFrameMode,
	activityLines,
	activityRuleLines,
	dockLines,
	dockAccentColor,
	dockTurnActive,
	mixSkinColor,
	skinFadeOutColor,
	skinFadeOutProgress,
	skinFaintColor,
	skinNoticeFadeProgress,
	skinPulseBrightness,
	skinStopAt,
	thinkLineText,
	toolLineText,
	TODO_MAX_ROWS,
	latestTodos,
	padCell,
	todosTableLines,
	todosTableWidth,
	SKIN_FADE_IN_MS,
	SKIN_FADE_OUT_MS,
	SKIN_HOLD_MS,
	SKIN_NOTICE_FADE_MS,
	SKIN_PULSE_MS,
} from "../src/routes/session/widgets-dock"
import type { SeamRow } from "../src/routes/session/seam-rows"
import { stringWidth } from "../src/util/string-width"
import { RGBA } from "@opentui/core"
import { colorDistance, colorRgb, contrastRatio } from "../src/routes/session/powerline"
import { createComponentTheme } from "../src/theme/component"
import { getDshBlueTheme } from "../src/theme/index"
import { resolveThemeDocument } from "../src/vendor/theme/src/tui/resolve"

const spin = () => 0

describe("todosTableLines (dsh-tui-pi TodosPanel parity)", () => {
	type T = { content: string; status: string }
	const toolRow = (todos: T[], key = "tool:live:t", status: "done" | "failed" = "done"): SeamRow => ({
		key,
		kind: "tool",
		name: "todo_write",
		args: JSON.stringify({ todos }),
		status,
		faded: true,
		output: JSON.stringify({ message: { content: [{ type: "text", text: "Updated todo list." }] } }),
	})
	const table = (rows: readonly SeamRow[], width = 48): string[] => todosTableLines(rows, width).map((line) => line.text)

	test("boxed table: borders + `● Todos (done/total)` header + `# │ ✓ │ Task` + rows", () => {
		const lines = table([
			toolRow([
				{ content: "a", status: "completed" },
				{ content: "b", status: "in_progress" },
				{ content: "c", status: "pending" },
			]),
		])
		expect(lines[0]!.startsWith("┌")).toBe(true)
		expect(lines[0]!.endsWith("┐")).toBe(true)
		expect(lines[1]).toContain("● Todos (1/3)")
		expect(lines[2]).toContain("#")
		expect(lines[2]).toContain("✓")
		expect(lines[2]).toContain("Task")
		expect(lines[3]).toContain("☑")
		expect(lines[3]).toContain("a")
		expect(lines[4]).toContain("◐")
		expect(lines[4]).toContain("b")
		expect(lines[5]).toContain("☐")
		expect(lines[5]).toContain("c")
		expect(lines[6]!.startsWith("└")).toBe(true)
		// One tone per row: the in-progress row is the running family.
		expect(todosTableLines([toolRow([{ content: "b", status: "in_progress" }])], 48)[3]!.tone).toBe("running")
	})

	test("window: TODO_MAX_ROWS rows, active first, global plan numbers + showing hint", () => {
		const todos: T[] = Array.from({ length: 8 }, (_, i) => ({ content: `t${i + 1}`, status: "pending" }))
		todos[7] = { content: "t8", status: "in_progress" }
		const lines = table([toolRow(todos)])
		// 2 borders + header + table header + 5 windowed rows.
		expect(lines).toHaveLength(4 + TODO_MAX_ROWS)
		expect(lines[1]).toContain("showing 1-4,8")
		// The in-progress item keeps its GLOBAL number 8.
		expect(lines.find((line) => line.includes("◐"))).toContain("8")
	})

	test("short terminals (≤30 rows): the table collapses to ONE summary line", () => {
		const rows = [
			toolRow([
				{ content: "a", status: "completed" },
				{ content: "b", status: "in_progress" },
				{ content: "c", status: "pending" },
			]),
		]
		// 80x24: the persistent table's 9-row worst case cannot fit the
		// middle band (transcript 6 + activity rule 2 = 8) — one line only.
		const compact = todosTableLines(rows, 80, 24)
		expect(compact).toHaveLength(1)
		expect(compact[0]!.text).toBe("todos [✓]1/3 · b")
		expect(compact[0]!.id).toBe("dock:todos")
		// Same clear-when-done law in the compact form.
		expect(todosTableLines([toolRow([{ content: "a", status: "completed" }])], 80, 24)).toEqual([])
		// Above the threshold the bordered table returns (31 rows > 30):
		// 4 chrome rows + one row per todo.
		expect(todosTableLines(rows, 80, 31)).toHaveLength(4 + 3)
	})

	test("no todos / all completed → zero rows (clear-when-done)", () => {
		expect(table([])).toEqual([])
		expect(table([toolRow([])])).toEqual([])
		expect(table([toolRow([{ content: "a", status: "completed" }])])).toEqual([])
	})

	test("multi-line content flattens onto one row", () => {
		const lines = table([toolRow([{ content: "first\nsecond", status: "pending" }])])
		expect(lines[3]).toContain("first second")
	})

	test("latestTodos: host args shape wins, opencode bare-array output works", () => {
		const two: T[] = [
			{ content: "买咖啡", status: "pending" },
			{ content: "写周报", status: "in_progress" },
		]
		expect(latestTodos([toolRow(two)]).map((todo) => todo.content)).toEqual(["买咖啡", "写周报"])
		expect(
			latestTodos([{ key: "tool:live:o", kind: "tool", name: "todowrite", args: "{}", status: "done", faded: true, output: JSON.stringify(two) }]).map((todo) => todo.content),
		).toEqual(["买咖啡", "写周报"])
	})

	test("exact-name match; running and failed rows never feed the table", () => {
		for (const name of ["todoread", "todo_read", "todo", "todo_write_x", "my_todo_write"]) {
			expect(latestTodos([{ ...toolRow([]), name }])).toEqual([])
		}
		const running: SeamRow = { key: "tool:live:r", kind: "tool", name: "todo_write", args: JSON.stringify({ todos: [{ content: "a", status: "pending" }] }), status: "running" }
		expect(latestTodos([running])).toEqual([])
		const rejected = toolRow([{ content: "x", status: "in_progress" }], "tool:live:2", "failed")
		expect(latestTodos([rejected])).toEqual([])
	})

	test("padCell clips with the ellipsis and pads to exact display width", () => {
		expect(padCell("ab", 4)).toBe("ab  ")
		expect(padCell("ab", 4, "right")).toBe("  ab")
		expect(stringWidth(padCell("abcdef", 4))).toBe(4)
		// Flatten + trim (tui-pi padClip): no stray leading/trailing columns.
		expect(padCell("  ab\ncd  ", 6)).toBe("ab cd ")
	})

	test("narrow box (boxWidth < 23): the Task column shrinks, rows never overflow", () => {
		const lines = table([toolRow([{ content: "a very long task name", status: "in_progress" }])], 16)
		for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(16)
	})

	test("right border aligns with the composer's right border (80/120 columns)", () => {
		const rows = [
			toolRow([
				{ content: "a", status: "completed" },
				{ content: "b", status: "in_progress" },
				{ content: "c", status: "pending" },
			]),
		]
		for (const columns of [80, 120]) {
			const boxWidth = todosTableWidth(columns)
			// Slot geometry: one-column left indent + the box fill the terminal,
			// so the box's right border (last char, 0-based column
			// `1 + boxWidth - 1`) lands on column `columns - 1` — the same column
			// as the composer's right border.
			expect(boxWidth).toBe(columns - 1)
			expect(1 + boxWidth).toBe(columns)
			expect(1 + boxWidth - 1).toBe(columns - 1)
			const lines = table(rows, boxWidth)
			expect(lines.length).toBeGreaterThan(0)
			for (const line of lines) expect(stringWidth(line)).toBe(boxWidth)
			// Every border row carries its right corner in the last column.
			expect(lines[0]!.endsWith("┐")).toBe(true)
			expect(lines[lines.length - 1]!.endsWith("┘")).toBe(true)
		}
	})

	test("narrow terminal (≤30 rows) summary is unchanged and stays inside the slot", () => {
		const rows = [
			toolRow([
				{ content: "a", status: "completed" },
				{ content: "b", status: "in_progress" },
			]),
		]
		const compact = todosTableLines(rows, todosTableWidth(80), 24)
		expect(compact).toHaveLength(1)
		expect(compact[0]!.text).toBe("todos [✓]1/2 · b")
		expect(stringWidth(compact[0]!.text)).toBeLessThanOrEqual(todosTableWidth(80))
	})
})

describe("thinkLineText", () => {
	test("streaming: `💭 thinking · Xs · <tail line>`", () => {
		const row = {
			key: "reasoning:live-1",
			kind: "reasoning" as const,
			text: "first\nsecond",
			final: false,
			streaming: true,
			startedAt: Date.now() - 1500,
		}
		const line = thinkLineText(row, spin) ?? ""
		expect(line.startsWith("💭 thinking · ")).toBe(true)
		expect(line.endsWith(" · second")).toBe(true)
	})
	test("collapsed: `💭 thought · Xs · <first line>` frozen at elapsedSec", () => {
		const row = { key: "r", kind: "reasoning" as const, text: "alpha\nbeta", final: true, elapsedSec: 2.5 }
		expect(thinkLineText(row, spin)).toBe("💭 thought · 2.5s · alpha")
	})
	test("panel-less replay rows paint nothing", () => {
		const row = { key: "r", kind: "reasoning" as const, text: "draft", final: true }
		expect(thinkLineText(row, spin)).toBeUndefined()
	})
})

describe("dockLines (batch D5 widget fade; todos live in their own table)", () => {
	test("faded settled tools leave the dock; running tools stay; todos never enter dockLines", () => {
		const todos = JSON.stringify([{ content: "a", status: "in_progress" }])
		const rows: SeamRow[] = [
			{ key: "tool:live:t", kind: "tool", name: "todowrite", args: "{}", status: "done", output: todos, faded: true },
			{ key: "tool:live:a", kind: "tool", name: "bash", args: '{"command":"ls"}', status: "done", output: "ok", faded: true },
			{ key: "tool:live:b", kind: "tool", name: "grep", args: '{"pattern":"x"}', status: "running", startedAt: Date.now() },
		]
		const lines = dockLines(rows).map((l) => l.text)
		expect(lines).toHaveLength(1)
		expect(lines[0]).toContain("grep")
		expect(todosTableLines(rows, 40).length).toBeGreaterThan(0)
	})
	test("tool line: status icon marker, `name subject` (space, tui-pi style), elapsed, arg/result tail", () => {
		const running: SeamRow = { key: "tool:live:b", kind: "tool", name: "bash", args: '{"command":"git status"}', status: "running", startedAt: Date.now() - 1200 }
		expect(toolLineText(running, spin)).toMatch(/^⚙ bash git · 1\.\ds · \$ git status$/)
		const done: SeamRow = { key: "tool:live:d", kind: "tool", name: "read", args: '{"path":"a.ts"}', status: "done", elapsedSec: 0.4, output: "ok" }
		expect(toolLineText(done, spin)).toBe("✔ read a.ts · 0.4s · ok")
		const failed: SeamRow = { key: "tool:live:f", kind: "tool", name: "bash", args: '{"command":"false"}', status: "failed", elapsedSec: 1, output: "boom" }
		expect(toolLineText(failed, spin)).toMatch(/^✘ bash false · 1\.0s/)
	})
	test("think/tool lines carry semantic accents; the tool marker keeps its tone", () => {
		const rows: SeamRow[] = [
			{ key: "reasoning:live-1", kind: "reasoning", text: "pondering", final: false, streaming: true, startedAt: Date.now() },
			{ key: "tool:live:b", kind: "tool", name: "bash", args: '{"command":"ls"}', status: "running", startedAt: Date.now() },
			{ key: "tool:live:d", kind: "tool", name: "read", args: '{"path":"a.ts"}', status: "done", elapsedSec: 0.4, output: "ok" },
		]
		const lines = dockLines(rows)
		const think = lines.find((line) => line.id?.startsWith("dock:think:"))
		expect(think?.accent).toBe("think")
		expect(think?.marker).toBeUndefined()
		const tools = lines.filter((line) => line.id?.startsWith("dock:tool:"))
		expect(tools.map((line) => line.marker)).toEqual(["⚙", "✔"])
		expect(tools.every((line) => line.accent === "tool")).toBe(true)
		// Pure text builders keep the full icon-prefixed string.
		expect(tools[0]!.text.startsWith("⚙ ")).toBe(true)
		expect(tools[1]!.text.startsWith("✔ ")).toBe(true)
		// The compact rule form shifts the marker past the `┃ ` prefix.
		const [, ruledTool] = activityRuleLines(rows)
		expect(ruledTool.markerAt).toBe(2)
		expect(ruledTool.text.slice(2, 3)).toBe("✔")
	})
})

// ---------------------------------------------------------------------------
// Batch δ (skin): fade timing inside the seam-rows 1s window, the turn-
// lifetime activity frame, the code-block forms, and the reminder pulse.
// ---------------------------------------------------------------------------

describe("skin exit fade timing (H5: inside the existing 1s window)", () => {
	test("hold 700ms → sweep 300ms → done at 1000ms (clear moment unchanged)", () => {
		expect(SKIN_HOLD_MS + SKIN_FADE_OUT_MS).toBe(1000)
		expect(skinFadeOutProgress(0)).toBe(0)
		expect(skinFadeOutProgress(699)).toBe(0)
		expect(skinFadeOutProgress(SKIN_HOLD_MS)).toBe(0)
		const mid = skinFadeOutProgress(SKIN_HOLD_MS + SKIN_FADE_OUT_MS / 2)
		expect(mid).toBeGreaterThan(0.4)
		expect(mid).toBeLessThan(0.6)
		expect(skinFadeOutProgress(1000)).toBe(1)
		expect(skinFadeOutProgress(5000)).toBe(1)
	})
	test("fade color: full target during the hold, half-mixed at the sweep midpoint", () => {
		const full = skinFadeOutColor("#ff0000", "#000000", 0)
		expect(full).toBe("#ff0000")
		const mid = skinFadeOutColor("#ff0000", "#000000", SKIN_HOLD_MS + SKIN_FADE_OUT_MS / 2)
		expect(mid).toBe("#800000")
	})
	test("stop anchor from startedAt + elapsedSec (view-side math, store untouched)", () => {
		expect(skinStopAt({ startedAt: 1000, elapsedSec: 2.5 })).toBe(3500)
		expect(skinStopAt({ startedAt: 1000 })).toBeUndefined()
		expect(skinStopAt({ elapsedSec: 2.5 })).toBeUndefined()
	})
	test("notice fade stays inside the 8s TTL (last 500ms only)", () => {
		expect(SKIN_NOTICE_FADE_MS).toBe(500)
		expect(skinNoticeFadeProgress(7000, 8000)).toBe(0)
		expect(skinNoticeFadeProgress(7750, 8000)).toBeCloseTo(0.5)
		expect(skinNoticeFadeProgress(8000, 8000)).toBe(1)
	})
	test("color mixing + faint start", () => {
		expect(mixSkinColor("#000000", "#ffffff", 0.5)).toBe("#808080")
		expect(skinFaintColor("#ffffff", "#000000")).toBe("#383838")
		expect(SKIN_FADE_IN_MS).toBe(400)
	})
})

describe("skin reminder pulse (3 dips ≈1.2s then rest)", () => {
	test("exactly 3 cycles over ≈1.2s, then constant bright", () => {
		expect(SKIN_PULSE_MS).toBe(1200)
		let dips = 0
		let prev = 1
		for (let ms = 0; ms <= 1200; ms += 10) {
			const b = skinPulseBrightness(ms)
			if (prev === 1 && b < 1) dips += 1
			prev = b
		}
		expect(dips).toBe(3)
		expect(skinPulseBrightness(1200)).toBe(1)
		expect(skinPulseBrightness(5000)).toBe(1)
	})
	test("dims to the dim floor mid-cycle and never goes below it", () => {
		const cycle = SKIN_PULSE_MS / 3
		expect(skinPulseBrightness(cycle / 2)).toBeCloseTo(0.55, 2) // 1 − 0.45
		for (let ms = 0; ms < 1200; ms += 5) expect(skinPulseBrightness(ms)).toBeGreaterThanOrEqual(0.55 - 1e-9)
	})
})

describe("skin turn-lifetime activity frame", () => {
	const thinkLive: SeamRow = { key: "reasoning:live-1", kind: "reasoning", text: "x", final: false, streaming: true, startedAt: Date.now() }
	const toolRun: SeamRow = { key: "tool:live:t", kind: "tool", name: "bash", args: "{}", status: "running", startedAt: Date.now() }
	const toolDone: SeamRow = { key: "tool:live:d", kind: "tool", name: "bash", args: "{}", status: "done", output: "ok", faded: true }
	const todosBrief = JSON.stringify([{ content: "a", status: "in_progress" }])
	const todoTool: SeamRow = { key: "tool:live:todo", kind: "tool", name: "todo_write", args: JSON.stringify({ todos: [{ content: "a", status: "in_progress" }] }), status: "done", faded: true, output: todosBrief }

	test("turn activity derives from live rows (prop override wins when wired)", () => {
		expect(dockTurnActive([])).toBe(false)
		expect(dockTurnActive([toolDone])).toBe(false)
		expect(dockTurnActive([toolRun])).toBe(true)
		expect(dockTurnActive([thinkLive])).toBe(true)
		expect(dockTurnActive([{ key: "a", kind: "assistant", text: "x", final: false }])).toBe(true)
		expect(dockTurnActive([{ key: "s", kind: "subagents", children: [{ id: "c", label: "l", status: "running", rounds: 1 }] }])).toBe(true)
	})
	test("frame content is EXACTLY two slots: think/tool (todos live in their own table), blanks left blank", () => {
		const [think, tool] = activityLines([todoTool, thinkLive, toolRun])
		expect(think.text).toContain("thinking")
		expect(tool.text).toContain("bash")
		const empty = activityLines([])
		expect(empty.map((line) => line.text)).toEqual(["", ""])
	})
	test("fixed law: multi-tool turns show the most recent tool line", () => {
		const second: SeamRow = { key: "tool:live:t2", kind: "tool", name: "grep", args: "{}", status: "running", startedAt: Date.now() }
		const [, tool] = activityLines([toolRun, second])
		expect(tool.text).toContain("grep")
	})
	test("compact form: left rule with the activity title in the first line", () => {
		const rule = activityRuleLines([toolRun])
		expect(rule).toHaveLength(2)
		expect(rule[0]!.text).toBe("┃ activity")
		expect(rule[1]!.text.startsWith("┃ ")).toBe(true)
	})
	test("compact form keeps the think text (rule head carries it, not a bare title)", () => {
		// Tool-only turns keep the bare title (above); a streaming think burst
		// must NOT be swallowed by it — the old form overwrote the think slot
		// with `┃ activity` and rendered nothing of the reasoning.
		const thinkOnly = activityRuleLines([thinkLive])
		expect(thinkOnly[0]!.text.startsWith("┃ activity · 💭 thinking · ")).toBe(true)
		expect(thinkOnly[0]!.text).toContain(" · x")
		// Think + tool: the head carries the think text, row 2 the tool line.
		const both = activityRuleLines([thinkLive, toolRun])
		expect(both[0]!.text).toContain("thinking")
		expect(both[1]!.text).toContain("bash")
		// Still exactly two rows — the collapse never grew.
		expect(both).toHaveLength(2)
	})
	test("frame vs rule follows the composer compact threshold (coordinated lanes)", () => {
		expect(activityFrameMode(24)).toBe("rule")
		expect(activityFrameMode(30)).toBe("rule")
		expect(activityFrameMode(31)).toBe("frame")
	})
})

describe("skin code-block forms (streaming rule → final frame)", () => {
	test("streaming → rule (no extra rows), final → frame", async () => {
		const mod = await import("../src/routes/session/transcript")
		expect(mod.codeBlockForm(false)).toBe("rule")
		expect(mod.codeBlockForm(true)).toBe("frame")
	})
	test("rule label carries the language on the ┃ line", async () => {
		const mod = await import("../src/routes/session/transcript")
		expect(mod.codeBlockRuleLabel("ts")).toBe("┃ ts")
		expect(mod.codeBlockRuleLabel(undefined)).toBe("┃")
		expect(mod.codeBlockRuleLabel("")).toBe("┃")
	})
	test("applyCodeBlockSkin mutates the markdown's default renderable IN PLACE (no new nodes per increment)", async () => {
		const mod = await import("../src/routes/session/transcript")
		const box = { border: ["top", "bottom", "left", "right"], borderStyle: "single", title: undefined as string | undefined }
		const streamed = mod.applyCodeBlockSkin(box, false, "ts")
		expect(streamed).toBe(box) // same instance — the renderNode identity law
		expect(box.border).toEqual(["left"])
		expect(box.title).toBeUndefined()
		mod.applyCodeBlockSkin(box, true, "ts")
		expect(box.border).toEqual(["top", "bottom", "left", "right"])
		expect(box.borderStyle).toBe("single")
		expect(box.title).toBe(" ts ")
		const nonBox = { content: "plain text renderable" }
		expect(mod.applyCodeBlockSkin(nonBox, true, "ts")).toBe(nonBox)
		expect((nonBox as typeof box).border).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// Flicker mitigation 1 (research/skin-flicker-analysis.md 缓解 1): the
// turn-lifetime activity frame mounts/unmounts one render tick after the
// turn flip, so the frame toggle never lands on the turn-boundary reflow
// frame (the engine's diff-paint misses the border there — the `┌─activity`
// ghost).
// ---------------------------------------------------------------------------

describe("deferred activity frame latch (flicker mitigation 1)", () => {
	const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

	test("defer window is one render tick (50-100ms band)", () => {
		expect(ACTIVITY_FRAME_DEFER_MS).toBeGreaterThanOrEqual(50)
		expect(ACTIVITY_FRAME_DEFER_MS).toBeLessThanOrEqual(100)
	})

	test("pure transitions: steady states never schedule, a flip defers", () => {
		const hidden: FrameLatch = { shown: false, pending: undefined }
		const shown: FrameLatch = { shown: true, pending: undefined }
		expect(frameLatchNext(hidden, false)).toEqual({ latch: hidden, schedule: false })
		expect(frameLatchNext(shown, true)).toEqual({ latch: shown, schedule: false })
		expect(frameLatchNext(hidden, true)).toEqual({ latch: { shown: false, pending: "show" }, schedule: true })
		expect(frameLatchNext(shown, false)).toEqual({ latch: { shown: true, pending: "hide" }, schedule: true })
	})

	test("pure timer fire commits the pending op; nothing pending is a no-op", () => {
		expect(frameLatchFire({ shown: false, pending: "show" })).toEqual({ shown: true, pending: undefined })
		expect(frameLatchFire({ shown: true, pending: "hide" })).toEqual({ shown: false, pending: undefined })
		const steady = { shown: true, pending: undefined }
		expect(frameLatchFire(steady)).toBe(steady)
	})

	test("mount and unmount each land one tick late (real one-shot timers)", async () => {
		const latch = createFrameLatch(10)
		expect(latch.shown()).toBe(false)
		latch.push(true)
		expect(latch.shown()).toBe(false) // deferred: NOT mounted this frame
		await wait(30)
		expect(latch.shown()).toBe(true)
		latch.push(false)
		expect(latch.shown()).toBe(true) // deferred: still mounted this frame
		await wait(30)
		expect(latch.shown()).toBe(false)
		latch.dispose()
	})

	test("a flip inside the window cancels the pending op (no ghost either way)", async () => {
		const latch = createFrameLatch(10)
		latch.push(true)
		latch.push(false) // turn aborted within the window → never flashes on
		await wait(30)
		expect(latch.shown()).toBe(false)
		latch.push(true)
		await wait(30)
		expect(latch.shown()).toBe(true)
		latch.push(false)
		latch.push(true) // turn resumed within the window → never flickers off
		await wait(30)
		expect(latch.shown()).toBe(true)
		latch.dispose()
	})
})

/**
 * Footer-polish feedback batch (item 2, follow-up; recolored to green): the
 * turn-lifetime frame only exists WHILE a turn is active, so its border must
 * be a BRIGHT GREEN on a heavy line, static (border animation is forbidden),
 * clearing 4.5:1 against the working background.
 */
describe("activity frame active border", () => {
	const themeWith = (green: Record<string, RGBA> | undefined, background: string) =>
		({
			hue: { accent: {}, interactive: {}, neutral: {} },
			categorical: green ? [green] : [],
			text: { feedback: { success: { base: RGBA.fromHex("#7fd88f") } } },
			background: { base: RGBA.fromHex(background) },
		}) as unknown as Parameters<typeof activityFrameBorderColor>[0]

	test("prefers the bright green step (green[200])", () => {
		const green = {
			"100": RGBA.fromHex("#96f7a7"),
			"200": RGBA.fromHex("#7fd88f"),
			"300": RGBA.fromHex("#68b977"),
		}
		const picked = activityFrameBorderColor(themeWith(green, "#0a0a0f"))
		expect(picked).toBe(green["200"])
		// Bright green on the dsh-blue dark background clears the contract.
		expect(contrastRatio(picked, "#0a0a0f")).toBeGreaterThanOrEqual(4.5)
	})

	test("real dsh-blue dark picks green[200] #7fd88f at 11.4:1", () => {
		const theme = createComponentTheme(() => resolveThemeDocument(getDshBlueTheme(), "dark"))
		const picked = activityFrameBorderColor(theme)
		expect(colorRgb(picked)).toEqual([127, 216, 143]) // #7fd88f
		expect(contrastRatio(picked, theme.background.base)).toBeGreaterThanOrEqual(4.5)
	})

	test("fallback is the bright green hex, not the old dark blue border", () => {
		expect(ACTIVITY_FRAME_BORDER_FALLBACK).toBe("#7fd88f")
		// 11.4:1 on the dsh-blue dark surface.
		expect(contrastRatio(ACTIVITY_FRAME_BORDER_FALLBACK, "#0a0a0f")).toBeGreaterThanOrEqual(4.5)
		expect(activityFrameBorderColor()).toBe(ACTIVITY_FRAME_BORDER_FALLBACK)
	})

	test("no green scale → success token; light surfaces deepen to 4.5:1", () => {
		const successTheme = {
			hue: { accent: {}, interactive: {}, neutral: {} },
			categorical: [],
			text: { feedback: { success: { base: RGBA.fromHex("#7fd88f") } } },
			background: { base: RGBA.fromHex("#0a0a0f") },
		} as unknown as Parameters<typeof activityFrameBorderColor>[0]
		expect(activityFrameBorderColor(successTheme)).toBe(successTheme.text.feedback.success.base)

		// Light theme: the stock green[200] is too light against #fafafa, so
		// the helper walks it away from the surface (toward black) until the
		// border still clears 4.5:1.
		const lightGreen = { "200": RGBA.fromHex("#3d9a57"), "300": RGBA.fromHex("#55a96a") }
		const picked = activityFrameBorderColor(themeWith(lightGreen, "#fafafa"))
		expect(contrastRatio(picked, "#fafafa")).toBeGreaterThanOrEqual(4.5)
	})

	// Review 5: hue-angle identification. Yellow/cyan are r/g/b swatches with
	// real spread but their hue sits outside the green window; the resolved
	// theme drops categorical hue NAMES, so color (hue angle) is the fallback
	// and must at least not misclassify.
	test("hue angle separates green from yellow and cyan and achromatic swatches", () => {
		expect(hueAngle(RGBA.fromHex("#7fd88f"))).toBeGreaterThan(90) // green: ~130.8°
		expect(hueAngle(RGBA.fromHex("#7fd88f"))).toBeLessThan(150)
		expect(hueAngle(RGBA.fromHex("#ffeb3b"))).toBeLessThan(90) // yellow: ~53.9°
		expect(hueAngle(RGBA.fromHex("#ff7f50"))).toBeLessThan(90) // coral: ~16.1°
		expect(hueAngle(RGBA.fromHex("#22d3ee"))).toBeGreaterThan(150) // cyan: ~186.9°
		expect(hueAngle(RGBA.fromHex("#808080"))).toBe(0) // achromatic
	})

	test("a yellow categorical scale is not mistaken for the green family", () => {
		const yellow = { "500": RGBA.fromHex("#eab308"), "200": RGBA.fromHex("#fde047") }
		const theme = themeWith(yellow, "#0a0a0f")
		// No green scale found → the success feedback token (it clears 4.5:1).
		expect(activityFrameBorderColor(theme)).toBe(theme.text.feedback.success.base)
	})
})

/**
 * Semantic think/tool accents: the two activity lines must read as their own
 * panels (violet thinking, cyan/teal tool) and never collapse onto the body
 * copy or onto each other, while each clears the 4.5:1 text floor.
 */
describe("dock semantic accents (think violet / tool cyan)", () => {
	const darkTheme = () => createComponentTheme(() => resolveThemeDocument(getDshBlueTheme(), "dark"))
	const lightTheme = () => createComponentTheme(() => resolveThemeDocument(getDshBlueTheme(), "light"))

	test("dsh-blue dark: think purple[200] #9d7cd8, tool cyan[300] #449da7", () => {
		const theme = darkTheme()
		const think = colorRgb(dockAccentColor(theme, "think"))
		const tool = colorRgb(dockAccentColor(theme, "tool"))
		expect(think).toEqual([157, 124, 216]) // #9d7cd8
		expect(tool).toEqual([68, 157, 167]) // #449da7
		for (const picked of [dockAccentColor(theme, "think"), dockAccentColor(theme, "tool")]) {
			expect(contrastRatio(picked, theme.background.base)).toBeGreaterThanOrEqual(4.5)
			// Distinct from the default body copy.
			expect(colorRgb(picked)).not.toEqual(colorRgb(theme.text.base))
		}
		expect(think).not.toEqual(tool)
	})

	test("dsh-blue light: think purple[200] #6d47ad, tool cyan[100] #077786", () => {
		const theme = lightTheme()
		const think = colorRgb(dockAccentColor(theme, "think"))
		const tool = colorRgb(dockAccentColor(theme, "tool"))
		expect(think).toEqual([109, 71, 173]) // #6d47ad
		expect(tool).toEqual([7, 119, 134]) // #077786
		for (const picked of [dockAccentColor(theme, "think"), dockAccentColor(theme, "tool")]) {
			expect(contrastRatio(picked, theme.background.base)).toBeGreaterThanOrEqual(4.5)
			expect(colorRgb(picked)).not.toEqual(colorRgb(theme.text.base))
		}
		expect(think).not.toEqual(tool)
	})

	test("the two accents stay far apart in RGB (panel identity, not just a tint)", () => {
		const theme = darkTheme()
		expect(colorDistance(dockAccentColor(theme, "think"), dockAccentColor(theme, "tool"))).toBeGreaterThan(40)
	})

	test("no hue ramp → polarity-aware static fallback", () => {
		const noHues = {
			hue: {},
			background: { base: RGBA.fromHex("#0a0a0f") },
		} as unknown as Parameters<typeof dockAccentColor>[0]
		expect(dockAccentColor(noHues, "think")).toBe("#9d7cd8")
		expect(dockAccentColor(noHues, "tool")).toBe("#449da7")
		const lightNoHues = {
			hue: {},
			background: { base: RGBA.fromHex("#ffffff") },
		} as unknown as Parameters<typeof dockAccentColor>[0]
		expect(dockAccentColor(lightNoHues, "think")).toBe("#6d47ad")
		expect(dockAccentColor(lightNoHues, "tool")).toBe("#077786")
	})

	test("think falls back to accent when the theme has no purple/violet ramp", () => {
		const accentOnly = {
			hue: { accent: { "200": RGBA.fromHex("#8599ff") } },
			background: { base: RGBA.fromHex("#0a0a0f") },
		} as unknown as Parameters<typeof dockAccentColor>[0]
		expect(colorRgb(dockAccentColor(accentOnly, "think"))).toEqual([133, 153, 255])
	})
})

/**
 * Review 2.2: the contrast walk is bidirectional. The old one-way blend
 * toward black made an under-contrast border muddier on a DARK surface; the
 * walk now goes toward white on dark surfaces and black on light ones, and
 * the final contrast is re-measured and reported as an assertion result.
 */
describe("contrast walk (bidirectional)", () => {
	test("dark surface: an under-contrast fill walks toward WHITE, not black", () => {
		const bg = "#0a0a0f"
		const deepOrange = "#6a3a00"
		expect(contrastRatio(deepOrange, bg)).toBeLessThan(4.5)
		const result = boostUntilContrast(deepOrange, bg)
		expect(result.meetsContrast).toBe(true)
		expect(result.contrast).toBeGreaterThanOrEqual(4.5)
		const [r, g, b] = colorRgb(result.color)
		// Brightened, not darkened: every channel moved up (toward white).
		expect(r).toBeGreaterThan(0x6a)
		expect(g).toBeGreaterThan(0x3a)
		expect(b).toBeGreaterThan(0)
	})

	test("light surface: an under-contrast fill walks toward BLACK", () => {
		const bg = "#fafafa"
		const lightOrange = "#f5c98a"
		expect(contrastRatio(lightOrange, bg)).toBeLessThan(4.5)
		const result = boostUntilContrast(lightOrange, bg)
		expect(result.meetsContrast).toBe(true)
		expect(result.contrast).toBeGreaterThanOrEqual(4.5)
		const [r] = colorRgb(result.color)
		expect(r).toBeLessThan(0xf5)
	})

	test("reports meetsContrast=false when neither pole can reach the floor", () => {
		// Mid-gray surface: white tops out ~3.95, black ~5.28 — a 10:1 floor is
		// unreachable, so the assertion result says so instead of lying.
		const result = boostUntilContrast("#8a8a8a", "#808080", 10)
		expect(result.meetsContrast).toBe(false)
		expect(result.contrast).toBeLessThan(10)
	})

	test("a fill already clearing the floor is returned untouched", () => {
		const result = boostUntilContrast("#fab283", "#0a0a0f")
		expect(result.meetsContrast).toBe(true)
		expect(result.color).toBe("#fab283")
	})
})
