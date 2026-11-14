import { describe, expect, test } from "bun:test"
import {
	groupHistoryTurns,
	historyTurnDetail,
	matchesTurnFilter,
	normalizeHistoryPreview,
	toolCallSummary,
	turnPrimaryUserText,
	type HistoryJournalEntry,
} from "../src/routes/session/history-data"

/** Record builder (RemoteJournalEntry shape, oldest-first ordering). */
function entry(type: string, seq: number, time: number, data: Record<string, unknown>): HistoryJournalEntry {
	return { type, seq, time, data }
}

function turnStart(seq: number, time: number, turn: number): HistoryJournalEntry {
	return entry("turn/start", seq, time, { turn })
}

function turnEnd(seq: number, time: number, reason = "completed"): HistoryJournalEntry {
	return entry("turn/end", seq, time, { reason: { kind: reason } })
}

function userMessage(
	seq: number,
	text: string,
	source?: { kind: string },
): HistoryJournalEntry {
	return entry("user/message", seq, 1000 + seq, {
		content: [{ type: "text", text }],
		...(source === undefined ? {} : { source }),
	})
}

function assistantMessage(seq: number, text: string, interrupted = false): HistoryJournalEntry {
	return entry("assistant/message", seq, 1000 + seq, {
		message: { content: [{ type: "text", text }] },
		...(interrupted ? { interrupted: true } : {}),
	})
}

function toolCall(seq: number, callId: string, name: string, args: string): HistoryJournalEntry {
	return entry("tool/call", seq, 1000 + seq, { callId, name, arguments: args })
}

function toolResult(
	seq: number,
	callId: string,
	output: unknown,
	isError = false,
): HistoryJournalEntry {
	return entry("tool/result", seq, 1000 + seq, { callId, isError, output })
}

/** A two-turn session: prompt → reply, then a tool turn. */
function twoTurnJournal(): HistoryJournalEntry[] {
	return [
		entry("session/start", 0, 900, {}),
		turnStart(1, 1000, 1),
		userMessage(2, "first prompt"),
		assistantMessage(3, "first reply"),
		turnEnd(4, 1100),
		turnStart(5, 1200, 2),
		userMessage(6, "second prompt"),
		toolCall(7, "c1", "read", '{"path":"/a"}'),
		toolResult(8, "c1", '{"content":"x"}'),
		assistantMessage(9, "second reply"),
		turnEnd(10, 1300),
	]
}

describe("history data layer (gap C1 step 1)", () => {
	test("multi-turn journal folds into completed turns with identities and times", () => {
		const turns = groupHistoryTurns(twoTurnJournal())
		expect(turns.length).toBe(2)
		expect(turns[0]).toMatchObject({
			turn: 1,
			seqStart: 1,
			seqEnd: 4,
			endReason: "completed",
			userTexts: ["first prompt"],
			previewText: "first prompt",
			assistantTexts: ["first reply"],
		})
		expect(turns[0]!.startTime).toBe(1000)
		expect(turns[0]!.endTime).toBe(1100)
		expect(turns[1]).toMatchObject({
			turn: 2,
			seqStart: 5,
			seqEnd: 10,
			userTexts: ["second prompt"],
			assistantTexts: ["second reply"],
		})
	})

	test("empty journal yields no turns", () => {
		expect(groupHistoryTurns([])).toEqual([])
		// records outside any bracket are dropped
		expect(groupHistoryTurns([userMessage(1, "orphan"), assistantMessage(2, "nope")])).toEqual([])
	})

	test("the live turn mid-flight (unclosed bracket) never reaches the output", () => {
		const turns = groupHistoryTurns([
			turnStart(1, 1000, 1),
			userMessage(2, "done turn"),
			assistantMessage(3, "reply"),
			turnEnd(4, 1100),
			turnStart(5, 1200, 2),
			userMessage(6, "still streaming"),
		])
		expect(turns.length).toBe(1)
		expect(turns[0]!.turn).toBe(1)
	})

	test("tool-heavy turn: calls pair results (ok/isError), repeats counted in order", () => {
		const turns = groupHistoryTurns([
			turnStart(1, 1000, 1),
			userMessage(2, "do things"),
			toolCall(3, "c1", "read", '{"path":"/a"}'),
			toolCall(4, "c2", "bash", '{"command":"ls"}'),
			toolResult(5, "c1", '{"content":"x"}'),
			toolCall(6, "c3", "read", '{"path":"/b"}'),
			toolResult(7, "c2", "boom", true),
			toolResult(8, "c3", '{"ok":1}'),
			assistantMessage(9, "did things"),
			turnEnd(10, 1100),
		])
		expect(turns.length).toBe(1)
		const calls = turns[0]!.toolCalls
		expect(calls.map((call) => call.name)).toEqual(["read", "bash", "read"])
		expect(calls[0]).toMatchObject({ name: "read", args: '{"path":"/a"}', ok: true, output: '{"content":"x"}' })
		expect(calls[1]).toMatchObject({ name: "bash", ok: false, output: "boom" })
		expect(calls[2]!.ok).toBe(true)
		// message.toolCallId fallback pairs too
		const fallback = groupHistoryTurns([
			turnStart(1, 1000, 1),
			userMessage(2, "q"),
			toolCall(3, "", "read", "{}"),
			entry("tool/result", 4, 1004, { message: { toolCallId: "" } }),
			turnEnd(5, 1100),
		])
		expect(fallback[0]!.toolCalls.length).toBe(1)
		// summary: first-appearance order, repeats folded
		expect(toolCallSummary(calls.map((call) => call.name))).toBe("3 tool calls: read×2, bash×1")
		expect(toolCallSummary([])).toBe("")
	})

	test("refill text: first human prompt; injected-only turn declines", () => {
		const turns = groupHistoryTurns(twoTurnJournal())
		expect(turnPrimaryUserText(turns[0]!)).toBe("first prompt")
		// steer/follow-up prompts land as ordinary user messages — first wins
		const steered = groupHistoryTurns([
			turnStart(1, 1000, 1),
			userMessage(2, "original"),
			userMessage(3, "steer follow-up"),
			assistantMessage(4, "reply"),
			turnEnd(5, 1100),
		])
		expect(turnPrimaryUserText(steered[0]!)).toBe("original")
		// injected-only turn (a notice user/message with a non-user source):
		// readable preview, but undefined refill — a notice must never land
		// in the editor where one Enter would submit it.
		const injected = groupHistoryTurns([
			turnStart(1, 1000, 1),
			userMessage(2, "file changed", { kind: "system" }),
			assistantMessage(3, "ack"),
			turnEnd(4, 1100),
		])
		expect(turnPrimaryUserText(injected[0])).toBeUndefined()
		expect(injected[0]!.previewText).toBe("file changed")
		// journal vocabulary: an UNTAGGED user/message IS human-authored
		const untagged = groupHistoryTurns([
			turnStart(1, 1000, 1),
			entry("user/message", 2, 1002, { content: [{ type: "text", text: "no source tag" }] }),
			turnEnd(3, 1100),
		])
		expect(turnPrimaryUserText(untagged[0])).toBe("no source tag")
	})

	test("error and aborted end reasons carry the error message and interrupt flag", () => {
		const turns = groupHistoryTurns([
			entry("turn/start", 1, 1000, { turn: 1 }),
			userMessage(2, "go"),
			entry("turn/end", 3, 1100, { reason: { kind: "error", error: { message: "boom" } } }),
		])
		expect(turns[0]!.endReason).toBe("error")
		expect(turns[0]!.endError).toBe("boom")
		const interrupted = groupHistoryTurns([
			turnStart(1, 1000, 1),
			userMessage(2, "go"),
			assistantMessage(3, "partial", true),
			turnEnd(4, 1100, "aborted"),
		])
		expect(interrupted[0]!.interrupted).toBe(true)
		expect(interrupted[0]!.endReason).toBe("aborted")
	})

	test("detail lookup by index: full assistant bodies in bounds, undefined out", () => {
		const turns = groupHistoryTurns(twoTurnJournal())
		expect(historyTurnDetail(turns, 1)).toBe(turns[1])
		expect(historyTurnDetail(turns, -1)).toBeUndefined()
		expect(historyTurnDetail(turns, 2)).toBeUndefined()
	})

	test("cross-session: the fold is pure over each journal — no bleed between sessions", () => {
		const sessionA = twoTurnJournal()
		const sessionB: HistoryJournalEntry[] = [
			turnStart(1, 500, 1),
			userMessage(2, "other session prompt"),
			assistantMessage(3, "other reply"),
			turnEnd(4, 600),
		]
		const turnsA = groupHistoryTurns(sessionA)
		const turnsB = groupHistoryTurns(sessionB)
		expect(turnsB.length).toBe(1)
		expect(turnsB[0]!.previewText).toBe("other session prompt")
		expect(turnsB[0]!.startTime).toBe(500)
		// A rebuild over A is unchanged after folding B
		expect(groupHistoryTurns(sessionA)).toEqual(turnsA)
		expect(turnsB[0]!.previewText).not.toBe(turnsA[0]!.previewText)
		// and the refill face works for the swapped-in session too
		expect(turnPrimaryUserText(turnsB[0]!)).toBe("other session prompt")
	})

	test("preview normalization: control chars fold, whitespace collapses, 140-char cap", () => {
		expect(normalizeHistoryPreview("  a\nb\tc  ")).toBe("a b c")
		expect(normalizeHistoryPreview("x".repeat(200)).length).toBe(141)
		expect(normalizeHistoryPreview("x".repeat(200)).endsWith("…")).toBe(true)
		expect(normalizeHistoryPreview("short")).toBe("short")
		expect(normalizeHistoryPreview("x".repeat(140))).toBe("x".repeat(140))
	})

	test("turn filter matches preview text and turn number, empty matches all", () => {
		const turns = groupHistoryTurns(twoTurnJournal())
		expect(matchesTurnFilter(turns[0]!, "")).toBe(true)
		expect(matchesTurnFilter(turns[0]!, "FIRST")).toBe(true)
		expect(matchesTurnFilter(turns[0]!, "1")).toBe(true)
		expect(matchesTurnFilter(turns[0]!, "second")).toBe(false)
		expect(matchesTurnFilter(turns[1]!, "2")).toBe(true)
	})
})
