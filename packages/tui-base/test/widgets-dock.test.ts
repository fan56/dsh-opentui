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
import { dockLines, thinkLineText, todosSummaryLine } from "../src/routes/session/widgets-dock"
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
