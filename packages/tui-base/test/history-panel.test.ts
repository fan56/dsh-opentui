/**
 * /history panel pure-layer tests (gap C1 step 2). The panel's rendering
 * logic is exported as pure functions (the commands.test.ts law — the
 * orchestrations stay unit-testable without a renderer); the fold itself is
 * covered by history-data.test.ts, here it is the fixture SOURCE.
 */
import { describe, expect, test } from "bun:test"
import {
	groupHistoryTurns,
	type HistoryJournalEntry,
	type HistoryToolCall,
	type HistoryTurn,
} from "../src/routes/session/history-data"
import {
	forkEchoText,
	historyFailureText,
	refillOrNotice,
	toolCallLine,
	turnCursorStep,
	turnDetailLines,
	turnRowText,
	turnWindow,
} from "../src/routes/session/history-panel"

/** A minimal well-formed turn fixture. */
function turn(overrides: Partial<HistoryTurn> = {}): HistoryTurn {
	return {
		turn: 1,
		seqStart: 0,
		seqEnd: 10,
		endReason: "completed",
		endError: undefined,
		interrupted: false,
		startTime: 1000,
		endTime: 2000,
		userTexts: ["fix the bug"],
		previewText: "fix the bug",
		assistantTexts: [],
		toolCalls: [],
		...overrides,
	}
}

describe("history panel: left-list rows", () => {
	test("turnRowText prefixes the turn number and keeps the preview one line", () => {
		expect(turnRowText(turn({ previewText: "fix  the\nbug" }), 80)).toBe("#1 fix the bug")
	})

	test("turnRowText clips to the width with an ellipsis (number included)", () => {
		const row = turnRowText(turn({ previewText: "x".repeat(60) }), 20)
		expect(row.startsWith("#1 ")).toBe(true)
		expect(row.endsWith("…")).toBe(true)
		expect(row.length).toBe(20)
	})

	test("turnCursorStep wraps at both edges and never moves an empty list", () => {
		expect(turnCursorStep(0, -1, 5)).toBe(4)
		expect(turnCursorStep(4, 1, 5)).toBe(0)
		expect(turnCursorStep(2, 1, 5)).toBe(3)
		expect(turnCursorStep(2, -3, 5)).toBe(4)
		expect(turnCursorStep(2, 1, 0)).toBe(2)
	})
})

describe("history panel: scroll window", () => {
	test("a short list paints whole, a long list pins the window around the cursor", () => {
		expect(turnWindow(5, 2, 12)).toEqual({ start: 0, end: 5 })
		expect(turnWindow(20, 0, 12)).toEqual({ start: 0, end: 12 })
		expect(turnWindow(20, 15, 12)).toEqual({ start: 8, end: 20 })
		expect(turnWindow(20, 8, 12)).toEqual({ start: 8, end: 20 })
	})

	test("the window clamps an out-of-range cursor instead of painting blanks", () => {
		expect(turnWindow(10, 99, 4)).toEqual({ start: 6, end: 10 })
	})

	test("a non-positive viewport yields an empty window", () => {
		expect(turnWindow(10, 3, 0)).toEqual({ start: 3, end: 3 })
	})
})

describe("history panel: Enter/c refill verdict (tui-pi copy semantics)", () => {
	test("a turn with a human prompt refills the editor with its first prompt", () => {
		const verdict = refillOrNotice(turn({ userTexts: ["first", "second"] }))
		expect(verdict).toEqual({ kind: "refill", text: "first" })
	})

	test("an injected-only turn stays open with a notice (never refills a notice)", () => {
		const verdict = refillOrNotice(turn({ userTexts: [], previewText: "file change notice" }))
		expect(verdict.kind).toBe("notice")
		if (verdict.kind === "notice") expect(verdict.text).toContain("#1")
	})

	test("no selected turn yields the notice verdict", () => {
		expect(refillOrNotice(undefined).kind).toBe("notice")
	})
})

describe("history panel: right-pane detail", () => {
	test("toolCallLine mirrors the settled result state", () => {
		expect(toolCallLine({ name: "read", args: "", ok: true, output: "{}" })).toBe("✓ read")
		expect(toolCallLine({ name: "edit", args: '{"path":"a"}', ok: false, output: "err" })).toBe(
			`✗ edit {"path":"a"}`,
		)
		expect(toolCallLine({ name: "bash", args: "ls" })).toBe("· bash ls")
	})

	test("turnDetailLines: header, prompts, assistant bodies and the tool list", () => {
		const calls: HistoryToolCall[] = [
			{ name: "read", args: "", ok: true, output: "ok" },
			{ name: "read", args: "", ok: false, output: "nope" },
		]
		const lines = turnDetailLines(
			turn({
				turn: 7,
				endReason: "error",
				endError: "rate limited",
				interrupted: true,
				userTexts: ["run it"],
				assistantTexts: ["line one\nline two"],
				toolCalls: calls,
			}),
		)
		expect(lines[0]).toBe("turn #7 — error · interrupted")
		expect(lines).toContain("error: rate limited")
		expect(lines).toContain("prompt:")
		expect(lines).toContain("run it")
		expect(lines).toContain("assistant:")
		expect(lines).toContain("line one")
		expect(lines).toContain("line two")
		expect(lines).toContain("tools — 2 tool calls: read×2")
		expect(lines).toContain("✓ read")
		expect(lines).toContain("✗ read")
	})

	test("turnDetailLines: a bare turn is just the header (no empty sections)", () => {
		const lines = turnDetailLines(turn({ turn: 3, userTexts: [], assistantTexts: [] }))
		expect(lines).toEqual(["turn #3 — completed"])
	})
})

describe("history panel: echo/failure lines", () => {
	test("forkEchoText names the cut turn and the new session", () => {
		expect(forkEchoText(4, "ses-123")).toBe("forked from turn #4 → ses-123")
	})

	test("historyFailureText slices the message (the /login commit convention)", () => {
		expect(historyFailureText("fork", new Error("boom detail")).startsWith("fork failed — boom")).toBe(true)
		expect(historyFailureText("history load", "raw").startsWith("history load failed — raw")).toBe(true)
	})
})

describe("history panel: fold → panel pipeline integration", () => {
	/** Journal builder (history-data.test.ts fixture shape, oldest-first). */
	function entry(type: string, seq: number, data: Record<string, unknown>): HistoryJournalEntry {
		return { type, seq, time: 1000 + seq, data }
	}
	function buildJournal(): HistoryJournalEntry[] {
		return [
			entry("turn/start", 0, { turn: 1 }),
			entry("user/message", 1, { content: [{ type: "text", text: "first prompt" }] }),
			entry("assistant/message", 2, { message: { content: [{ type: "text", text: "reply one" }] } }),
			entry("turn/end", 3, { reason: { kind: "completed" } }),
			entry("turn/start", 4, { turn: 2 }),
			entry("user/message", 5, { content: [{ type: "text", text: "second prompt" }] }),
			entry("tool/call", 6, { callId: "c1", name: "read", arguments: '{"f":"x"}' }),
			entry("tool/result", 7, { callId: "c1", isError: false, output: "data" }),
			entry("turn/end", 8, { reason: { kind: "aborted" } }),
		]
	}

	test("cursor stepping lands on the turn whose detail and refill serve the pane", () => {
		const turns = groupHistoryTurns(buildJournal())
		expect(turns.length).toBe(2)
		let cursor = 0
		cursor = turnCursorStep(cursor, 1, turns.length)
		expect(turns[cursor]!.turn).toBe(2)
		expect(refillOrNotice(turns[cursor]!)).toEqual({ kind: "refill", text: "second prompt" })
		const detail = turnDetailLines(turns[cursor]!)
		expect(detail[0]).toBe("turn #2 — aborted")
		expect(detail.some((line) => line.startsWith("✓ read"))).toBe(true)
	})

	test("the fork seed cuts at the selected turn's own seqEnd (inclusive)", () => {
		const journal = buildJournal()
		const turns = groupHistoryTurns(journal)
		// turnSeedSlice was deleted (review P2: its `seq === array index`
		// assumption fails on real journals); the fork now hands the turn's
		// OWN seqEnd straight to the host's atSeq fork face — that is what
		// gets pinned here.
		expect(turns[0]!.seqEnd).toBeLessThan(turns[1]!.seqStart)
		expect(journal.at(-1)!.seq).toBe(turns.at(-1)!.seqEnd)
	})
})
