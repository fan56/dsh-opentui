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
