/**
 * UT: the ask_user_question transcript record — pure parsers/mergers
 * (features/ask-transcript.ts) + the journal mapper's ask rows
 * (journalToTranscriptRows resume replay).
 *
 * Wire shapes (installed dsh-user-questions closure):
 * - tool/call arguments: `{questions: [{id, question, header?, options?:
 *   [{label, description?}], multi_select?}]}` (raw JSON string).
 * - tool/result text block: `{"answers":[{"id","selected":[],custom?}]}`,
 *   declined = `{selected: [], custom: "declined"}`.
 * - the live brief is the 300-char-capped JSON of the whole event data
 *   (`{turn, step, message: {content: [...]}}`).
 */
import { describe, expect, test } from "bun:test"
import {
	ASK_TOOL_NAME,
	parseAskCallArgs,
	parseAskAnswers,
	buildAskTranscriptItem,
} from "../src/features/ask-transcript.ts"
import { journalToTranscriptRows, type RemoteJournalEntry } from "../src/client/remote-session-ops.ts"

const callArgs = JSON.stringify({
	questions: [
		{ id: "q1", question: "Which framework?", options: [{ label: "React", description: "SPA" }, { label: "Solid" }] },
		{ id: "q2", header: "Styling", question: "CSS approach?", options: ["Tailwind", "vanilla"] },
	],
})

describe("parseAskCallArgs", () => {
	test("parses the wire schema: question text, header prefix, option labels", () => {
		const parsed = parseAskCallArgs(callArgs)!
		expect(parsed).toHaveLength(2)
		expect(parsed[0]!.id).toBe("q1")
		expect(parsed[0]!.entry.question).toBe("Which framework?")
		expect(parsed[0]!.entry.options).toEqual(["React", "Solid"])
		expect(parsed[1]!.entry.question).toBe("Styling: CSS approach?")
		expect(parsed[1]!.entry.options).toEqual(["Tailwind", "vanilla"])
	})

	test("answers start unfilled (declined false, no selection)", () => {
		const parsed = parseAskCallArgs(callArgs)!
		expect(parsed[0]!.entry.selected).toEqual([])
		expect(parsed[0]!.entry.declined).toBe(false)
	})

	test("tolerates the simplified shape (prompt + string options)", () => {
		const parsed = parseAskCallArgs(JSON.stringify({ questions: [{ id: "x", prompt: "Go?", options: ["yes", "no"] }] }))!
		expect(parsed[0]!.entry.question).toBe("Go?")
		expect(parsed[0]!.entry.options).toEqual(["yes", "no"])
	})

	test("malformed / empty arguments → undefined", () => {
		expect(parseAskCallArgs("not json")).toBeUndefined()
		expect(parseAskCallArgs("{}")).toBeUndefined()
		expect(parseAskCallArgs(JSON.stringify({ questions: [] }))).toBeUndefined()
	})
})

describe("parseAskAnswers", () => {
	test("reads the direct answers batch", () => {
		expect(parseAskAnswers({ answers: [{ id: "q1", selected: ["React"] }] })).toEqual([{ id: "q1", selected: ["React"] }])
	})

	test("reads the declined envelope", () => {
		expect(parseAskAnswers({ answers: [{ id: "q1", selected: [], custom: "declined" }] })).toEqual([
			{ id: "q1", selected: [], custom: "declined" },
		])
	})

	test("reads the JSON string form", () => {
		expect(parseAskAnswers('{"answers":[{"id":"q1","selected":["Solid"]}]}')).toEqual([{ id: "q1", selected: ["Solid"] }])
	})

	test("reads the whole tool/result event data (message content text blocks)", () => {
		const brief = JSON.stringify({
			turn: 1,
			step: 2,
			message: {
				role: "toolResult",
				toolCallId: "c1",
				content: [{ type: "text", text: '{"answers":[{"id":"q1","selected":["React"]}]}' }],
			},
		})
		expect(parseAskAnswers(brief)).toEqual([{ id: "q1", selected: ["React"] }])
	})

	test("a truncated (300-char cap) brief → undefined", () => {
		const truncated = '{"turn":1,"step":2,"message":{"role":"toolResult","toolCallId":"c1","content":[{"type":"text","text":"{\\"answers\\":[{\\"id\\"'
		expect(parseAskAnswers(truncated)).toBeUndefined()
	})

	test("non-answer payloads → undefined", () => {
		expect(parseAskAnswers({ answer: 1 })).toBeUndefined()
		expect(parseAskAnswers("123")).toBeUndefined()
		expect(parseAskAnswers(undefined)).toBeUndefined()
	})
})

describe("buildAskTranscriptItem", () => {
	const questions = parseAskCallArgs(callArgs)!

	test("parsed result batch fills the selections (multi-question)", () => {
		const item = buildAskTranscriptItem(
			questions,
			[
				{ id: "q1", selected: ["React"] },
				{ id: "q2", selected: ["Tailwind"] },
			],
			undefined,
			true,
		)
		expect(item?.kind).toBe("ask")
		if (item?.kind !== "ask") return
		expect(item.entries[0]).toEqual({ question: "Which framework?", options: ["React", "Solid"], selected: ["React"], declined: false })
		expect(item.entries[1]!.selected).toEqual(["Tailwind"])
		expect(item.entries[1]!.declined).toBe(false)
	})

	test("the declined envelope marks the question declined", () => {
		const item = buildAskTranscriptItem(questions, [{ id: "q1", selected: [], custom: "declined" }], undefined, true)
		if (item?.kind !== "ask") return
		expect(item.entries[0]!.declined).toBe(true)
		expect(item.entries[0]!.selected).toEqual([])
		// a settled batch missing q2's row: closed without an answer
		expect(item.entries[1]!.declined).toBe(true)
	})

	test("a real free-text custom answer is not declined", () => {
		const item = buildAskTranscriptItem(questions, [{ id: "q1", selected: [], custom: "Svelte, actually" }], undefined, true)
		if (item?.kind !== "ask") return
		expect(item.entries[0]!.declined).toBe(false)
		expect(item.entries[0]!.custom).toBe("Svelte, actually")
	})

	test("stash fallback covers a truncated brief (the overlay's own picks)", () => {
		const item = buildAskTranscriptItem(questions, undefined, [{ questionId: "q1", selected: "Solid" }], true)
		if (item?.kind !== "ask") return
		expect(item.entries[0]!.selected).toEqual(["Solid"])
		// q2 had no stash pick: the ask settled without an answer for it
		expect(item.entries[1]!.declined).toBe(true)
	})

	test("no answer evidence at all → skipped (no fabrication)", () => {
		expect(buildAskTranscriptItem(questions, undefined, undefined, true)).toBeUndefined()
	})

	test("a hard-failed result renders declined (the honest outcome)", () => {
		const item = buildAskTranscriptItem(questions, undefined, undefined, false)
		expect(item?.kind).toBe("ask")
		if (item?.kind !== "ask") return
		expect(item.entries.every((e) => e.declined)).toBe(true)
	})
})

describe("journalToTranscriptRows ask rows (resume replay)", () => {
	const askCall: RemoteJournalEntry = { type: "tool/call", seq: 3, time: 0, data: { turn: 1, step: 1, callId: "c9", name: ASK_TOOL_NAME, arguments: callArgs } }
	const askResult = (answers: unknown): RemoteJournalEntry => ({
		type: "tool/result",
		seq: 4,
		time: 0,
		data: {
			turn: 1,
			step: 1,
			message: {
				role: "toolResult",
				toolCallId: "c9",
				content: [{ type: "text", text: JSON.stringify({ answers }) }],
			},
		},
	})

	test("an ask tool pair becomes one ask row between the messages", () => {
		const rows = journalToTranscriptRows([
			{ type: "user/message", seq: 1, time: 0, data: { source: { kind: "user" }, content: [{ type: "text", text: "pick one" }] } },
			askCall,
			askResult([{ id: "q1", selected: ["React"] }, { id: "q2", selected: [], custom: "declined" }]),
			{ type: "assistant/message", seq: 5, time: 0, data: { message: { content: [{ type: "text", text: "done" }] } } },
		])
		expect(rows.map((r) => r.kind)).toEqual(["user", "ask", "assistant"])
		const ask = rows[1]
		if (ask?.kind !== "ask") return
		expect(ask.entries).toHaveLength(2)
		expect(ask.entries[0]).toEqual({ question: "Which framework?", options: ["React", "Solid"], selected: ["React"], declined: false })
		expect(ask.entries[1]!.declined).toBe(true)
	})

	test("an unpaired ask call (no settled result) renders nothing", () => {
		const rows = journalToTranscriptRows([askCall, { type: "assistant/message", seq: 5, time: 0, data: { message: { content: [{ type: "text", text: "aborted" }] } } }])
		expect(rows.map((r) => r.kind)).toEqual(["assistant"])
	})

	test("non-ask tool traffic stays out of the replay", () => {
		const rows = journalToTranscriptRows([
			{ type: "tool/call", seq: 2, time: 0, data: { callId: "c1", name: "bash", arguments: '{"cmd":"ls"}' } },
			{ type: "tool/result", seq: 3, time: 0, data: { message: { toolCallId: "c1", content: [{ type: "text", text: "files" }] } } },
		])
		expect(rows).toEqual([])
	})

	test("skip still drops the first N durable events", () => {
		const rows = journalToTranscriptRows(
			[
				{ type: "user/message", seq: 1, time: 0, data: { source: { kind: "user" }, content: [{ type: "text", text: "early" }] } },
				askCall,
				askResult([{ id: "q1", selected: ["React"] }, { id: "q2", selected: ["vanilla"] }]),
			],
			1,
		)
		expect(rows.map((r) => r.kind)).toEqual(["ask"])
	})
})
