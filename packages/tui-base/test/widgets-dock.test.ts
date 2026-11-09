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
	ACTIVITY_FRAME_DEFER_MS,
	createFrameLatch,
	frameLatchFire,
	frameLatchNext,
	type FrameLatch,
	activityFrameMode,
	activityLines,
	activityRuleLines,
	dockLines,
	dockTurnActive,
	mixSkinColor,
	skinFadeOutColor,
	skinFadeOutProgress,
	skinFaintColor,
	skinNoticeFadeProgress,
	skinPulseBrightness,
	skinStopAt,
	thinkLineText,
	todosSummaryLine,
	SKIN_FADE_IN_MS,
	SKIN_FADE_OUT_MS,
	SKIN_HOLD_MS,
	SKIN_NOTICE_FADE_MS,
	SKIN_PULSE_MS,
} from "../src/routes/session/widgets-dock"
import type { SeamRow } from "../src/routes/session/seam-rows"

const spin = () => 0

describe("todosSummaryLine", () => {
	test("summarizes done/total and names the in-progress item", () => {
		const brief = JSON.stringify([
			{ content: "a", status: "completed" },
			{ content: "b", status: "in_progress" },
			{ content: "c", status: "pending" },
		])
		expect(todosSummaryLine(brief)).toBe("todos [✓]1/3 · b")
	})
	test("no in-progress item: the count alone", () => {
		expect(
			todosSummaryLine(JSON.stringify([{ content: "a", status: "completed" }, { content: "b", status: "pending" }])),
		).toBe("todos [✓]1/2")
	})
	test("D5b hide-law: all completed → '' (the row leaves the dock)", () => {
		expect(todosSummaryLine(JSON.stringify([{ content: "a", status: "completed" }]))).toBe("")
		expect(
			dockLines([
				{
					key: "tool:live:t",
					kind: "tool",
					name: "todowrite",
					args: "{}",
					status: "done",
					faded: true,
					output: JSON.stringify([{ content: "a", status: "completed" }, { content: "b", status: "completed" }]),
				},
			]),
		).toEqual([])
	})
	test("empty todo array → ''", () => {
		expect(todosSummaryLine("[]")).toBe("")
	})
	test("degrades to '' on non-todo briefs", () => {
		expect(todosSummaryLine(undefined)).toBe("")
		expect(todosSummaryLine("{}")).toBe("")
		expect(todosSummaryLine("not json")).toBe("")
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

describe("dockLines (batch D5 widget fade)", () => {
	test("faded settled tools leave the dock; running tools and todos stay", () => {
		const todos = JSON.stringify([{ content: "a", status: "in_progress" }])
		const rows: SeamRow[] = [
			{ key: "tool:live:t", kind: "tool", name: "todowrite", args: "{}", status: "done", output: todos, faded: true },
			{ key: "tool:live:a", kind: "tool", name: "bash", args: '{"command":"ls"}', status: "done", output: "ok", faded: true },
			{ key: "tool:live:b", kind: "tool", name: "grep", args: '{"pattern":"x"}', status: "running", startedAt: Date.now() },
		]
		const lines = dockLines(rows).map((l) => l.text)
		expect(lines[0]).toBe("todos [✓]0/1 · a")
		expect(lines.length).toBe(2)
		expect(lines[1]).toContain("grep")
	})
})

describe("dockLines todos panel: dsh host shape (D6)", () => {
	type Todo = { content: string; status: string }
	/** The REAL dsh host row (journal-verified): name `todo_write`, args =
	 * the raw tool/call arguments `{"todos":[…]}`, output = the follow
	 * stream's brief of a tool/result whose wire carries only the rendered
	 * text — no todo array anywhere in it. */
	const hostRow = (todos: Todo[], key = "tool:live:t", status: "done" | "failed" = "done"): SeamRow => {
		const c = (s: string) => todos.filter((t) => t.status === s).length
		const brief = JSON.stringify({
			turn: 1,
			message: {
				role: "tool",
				content: [
					{
						type: "text",
						text: `Updated todo list: ${c("pending")} pending, ${c("in_progress")} in progress, ${c("completed")} completed.`,
					},
				],
				isError: status === "failed",
			},
		}).slice(0, 300)
		return { key, kind: "tool", name: "todo_write", args: JSON.stringify({ todos }), status, faded: true, output: brief }
	}
	/** The opencode shape: name `todowrite`, the brief IS the bare array. */
	const opencodeRow = (name: string, todos: Todo[]): SeamRow => ({
		key: "tool:live:o",
		kind: "tool",
		name,
		args: "{}",
		status: "done",
		faded: true,
		output: JSON.stringify(todos),
	})
	const two = [
		{ content: "买咖啡", status: "pending" },
		{ content: "写周报", status: "pending" },
	]

	test("host `todo_write`: the list comes from the call args (the result brief has no array)", () => {
		expect(dockLines([hostRow(two)]).map((l) => l.text)).toEqual(["todos [✓]0/2"])
	})
	test("opencode `todowrite`: the bare-array output brief still renders", () => {
		expect(dockLines([opencodeRow("todowrite", two)]).map((l) => l.text)).toEqual(["todos [✓]0/2"])
	})
	test("exact-name match: other todo-ish tools never feed the panel", () => {
		for (const name of ["todoread", "todo_read", "todo", "todo_write_x", "my_todo_write"]) {
			expect(dockLines([opencodeRow(name, two)])).toEqual([])
			expect(dockLines([{ ...hostRow(two), name }])).toEqual([])
		}
	})
	test("a running call (no result yet) and a failed call never feed the panel", () => {
		const running: SeamRow = { key: "tool:live:r", kind: "tool", name: "todo_write", args: JSON.stringify({ todos: two }), status: "running" }
		expect(dockLines([running]).map((l) => l.text)).toEqual([expect.stringContaining("todo_write")])
		const applied = hostRow(two, "tool:live:1")
		const rejected = hostRow([{ content: "x", status: "in_progress" }, { content: "y", status: "in_progress" }], "tool:live:2", "failed")
		expect(dockLines([applied, rejected]).map((l) => l.text)).toEqual(["todos [✓]0/2"])
	})
	test("host lifecycle (journal replay): pending → one done → all done hides → cleared hides", () => {
		const rows: SeamRow[] = [hostRow(two, "tool:live:1")]
		expect(dockLines(rows).map((l) => l.text)).toEqual(["todos [✓]0/2"])
		rows.push(hostRow([{ content: "买咖啡", status: "completed" }, { content: "写周报", status: "in_progress" }], "tool:live:2"))
		expect(dockLines(rows).map((l) => l.text)).toEqual(["todos [✓]1/2 · 写周报"])
		rows.push(hostRow([{ content: "买咖啡", status: "completed" }, { content: "写周报", status: "completed" }], "tool:live:3"))
		expect(dockLines(rows)).toEqual([])
		rows.push(hostRow([], "tool:live:4"))
		expect(dockLines(rows)).toEqual([])
	})
	test("todosSummaryLine accepts the `{ todos }` args shape", () => {
		expect(todosSummaryLine(JSON.stringify({ todos: [{ content: "a", status: "in_progress" }] }))).toBe("todos [✓]0/1 · a")
		expect(todosSummaryLine(JSON.stringify({ todos: "nope" }))).toBe("")
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
	test("frame content is EXACTLY three slots: todo/think/tool, blanks left blank", () => {
		const [todo, think, tool] = activityLines([todoTool, thinkLive, toolRun])
		expect(todo.text).toBe("todos [✓]0/1 · a")
		expect(think.text).toContain("thinking")
		expect(tool.text).toContain("bash")
		const empty = activityLines([])
		expect(empty.map((line) => line.text)).toEqual(["", "", ""])
	})
	test("fixed-3 law: multi-tool turns show the most recent tool line", () => {
		const second: SeamRow = { key: "tool:live:t2", kind: "tool", name: "grep", args: "{}", status: "running", startedAt: Date.now() }
		const [, , tool] = activityLines([toolRun, second])
		expect(tool.text).toContain("grep")
	})
	test("compact form: left rule with the activity title in the first line", () => {
		const rule = activityRuleLines([toolRun])
		expect(rule).toHaveLength(3)
		expect(rule[0]!.text).toBe("┃ activity")
		expect(rule[2]!.text.startsWith("┃ ")).toBe(true)
		const withTodos = activityRuleLines([todoTool, toolRun])
		expect(withTodos[0]!.text).toBe(`┃ activity · todos [✓]0/1 · a`)
	})
	test("frame vs rule follows the composer compact threshold (coordinated lanes)", () => {
		expect(activityFrameMode(24)).toBe("rule")
		expect(activityFrameMode(30)).toBe("rule")
		expect(activityFrameMode(31)).toBe("frame")
	})
})

describe("skin code-block forms (streaming rule → final frame)", () => {	test("streaming → rule (no extra rows), final → frame", async () => {
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
		const streamed = mod.applyCodeBlockSkinForTest(box, false, "ts")
		expect(streamed).toBe(box) // same instance — the renderNode identity law
		expect(box.border).toEqual(["left"])
		expect(box.title).toBeUndefined()
		mod.applyCodeBlockSkinForTest(box, true, "ts")
		expect(box.border).toEqual(["top", "bottom", "left", "right"])
		expect(box.borderStyle).toBe("single")
		expect(box.title).toBe(" ts ")
		const nonBox = { content: "plain text renderable" }
		expect(mod.applyCodeBlockSkinForTest(nonBox, true, "ts")).toBe(nonBox)
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
