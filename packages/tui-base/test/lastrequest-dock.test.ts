/**
 * Batch D2: the lastRequest dock's pure line builders
 * (./src/routes/session/lastrequest-dock.tsx). The dock paints the `●`
 * last-request echo + one line per RUNNING child BELOW the editor
 * (dsh-tui-pi live-widgets activityDoc structure):
 *   - requestEchoLine: first line only, `● ` prefixed; blank → none;
 *   - childLineText: `├─/└─ ⠋ <label> · Xs · <tail>` — NO model segment
 *     (tui-pi parity: the model belongs to the Ctrl+G viewer);
 *   - lastRequestLines: clear-when-done — settled children never render.
 */
import { describe, expect, test } from "bun:test"
import { childLineText, lastRequestLines, lastVisibleLine, requestEchoLine } from "../src/routes/session/lastrequest-dock"
import { stringWidth } from "../src/util/string-width"
import type { SeamRow } from "../src/routes/session/seam-rows"

const spin = () => 0

const subagentsRow = (
	children: Extract<SeamRow, { kind: "subagents" }>["children"],
): SeamRow => ({ key: "subagents:live", kind: "subagents", children })

describe("requestEchoLine", () => {
	test("echoes the first line with the ● prefix", () => {
		expect(requestEchoLine("fix the layout\nsecond line ignored")).toBe("● fix the layout")
	})
	test("blank or undefined: no echo", () => {
		expect(requestEchoLine(undefined)).toBeUndefined()
		expect(requestEchoLine("   \n  ")).toBeUndefined()
	})
})

describe("childLineText", () => {
	test("running child: track + spinner + label + elapsed + rounds + tail", () => {
		const line = childLineText(
			{ id: "c1", label: "looper", status: "running", rounds: 2, startedAt: Date.now() - 13600, lastLine: "working\non it" },
			true,
			spin,
		)
		expect(line.startsWith("└─ ⠋ looper · ")).toBe(true)
		expect(line).toContain(" · ↻2 · ")
		expect(line.endsWith(" · on it")).toBe(true)
		// tui-pi parity: the compact line carries NO model segment.
		expect(line).not.toContain("(")
	})
	test("track: ├─ for non-final rows, └─ for the last", () => {
		const child = { id: "c", label: "x", status: "running" as const, rounds: 0 }
		expect(childLineText(child, false, spin).startsWith("├─ ")).toBe(true)
		expect(childLineText(child, true, spin).startsWith("└─ ")).toBe(true)
	})
	test("no startedAt: no elapsed segment (rounds always shown)", () => {
		const line = childLineText({ id: "c", label: "x", status: "running", rounds: 0 }, true, spin)
		expect(line).toBe("└─ ⠋ x · ↻0")
	})
	test("tail: last NON-BLANK line (a trailing newline never blanks it)", () => {
		const line = childLineText(
			{ id: "c", label: "x", status: "running", rounds: 1, lastLine: "old line\nhi\n" },
			true,
			spin,
		)
		expect(line).toBe("└─ ⠋ x · ↻1 · hi")
	})
	test("tail: whitespace folds onto one row", () => {
		const line = childLineText({ id: "c", label: "x", status: "running", rounds: 1, lastLine: "a\t  b" }, true, spin)
		expect(line).toBe("└─ ⠋ x · ↻1 · a b")
	})
	test("width: the tail keeps room; a long label clips first", () => {
		const line = childLineText(
			{ id: "c", label: "a-very-long-delegation-label-that-would-eat-the-row", status: "running", rounds: 3, startedAt: Date.now() - 2000, lastLine: "hi" },
			true,
			spin,
			60,
		)
		expect(stringWidth(line)).toBeLessThanOrEqual(60)
		expect(line).toContain("↻3")
		expect(line.endsWith("hi")).toBe(true)
	})
})

describe("lastVisibleLine", () => {
	test("last non-blank line, CRLF/CR folded, whitespace collapsed", () => {
		expect(lastVisibleLine("a\r\nb\rc\n\n")).toBe("c")
		expect(lastVisibleLine("hi\n   \n")).toBe("hi")
		expect(lastVisibleLine("  x   y  ")).toBe("x y")
		expect(lastVisibleLine("")).toBeUndefined()
		expect(lastVisibleLine(undefined)).toBeUndefined()
	})
})

describe("lastRequestLines", () => {
	test("echo + running children only (clear-when-done)", () => {
		const rows: SeamRow[] = [
			{ key: "stored:user:0", kind: "user", text: "run the loop" },
			subagentsRow([
				{ id: "a", label: "done-one", status: "completed", rounds: 1, elapsedSec: 2 },
				{ id: "b", label: "live-one", status: "running", rounds: 1, startedAt: Date.now() - 1000 },
			]),
		]
		const lines = lastRequestLines(rows, "run the loop")
		expect(lines).toHaveLength(2)
		expect(lines[0]).toEqual({ text: "● run the loop", tone: "muted", id: "lr:echo" })
		expect(lines[1]!.tone).toBe("running")
		expect(lines[1]!.text).toContain("live-one")
		expect(lines[1]!.text).not.toContain("done-one")
	})
	test("no request, no running children: the slot is empty", () => {
		const rows: SeamRow[] = [subagentsRow([{ id: "a", label: "done", status: "completed", rounds: 1, elapsedSec: 3 }])]
		expect(lastRequestLines(rows, undefined)).toEqual([])
	})
	test("request without children: the ● line alone persists", () => {
		const lines = lastRequestLines([{ key: "stored:user:0", kind: "user", text: "hello" }], "hello")
		expect(lines).toEqual([{ text: "● hello", tone: "muted", id: "lr:echo" }])
	})
	test("width-aware: every child line fits the dock width and keeps the tail", () => {
		const rows: SeamRow[] = [
			subagentsRow([
				{ id: "b", label: "an-extremely-long-subagent-delegation-label", status: "running", rounds: 4, startedAt: Date.now() - 5000, lastLine: "hi" },
			]),
		]
		const lines = lastRequestLines(rows, undefined, 48)
		expect(lines).toHaveLength(1)
		expect(stringWidth(lines[0]!.text)).toBeLessThanOrEqual(48)
		expect(lines[0]!.text).toContain("↻4")
		expect(lines[0]!.text.endsWith("hi")).toBe(true)
	})
})
