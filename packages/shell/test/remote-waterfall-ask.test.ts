import { describe, expect, test } from "bun:test"
import { WaterfallAnswerer, type RemoteQuestion, type RemoteQuestionAnswer } from "../src/client/remote-waterfall.ts"
import type { EventsWaterfall } from "../src/client/mux-frame.ts"

/** A user-questions `$events` frame (agent/signal stripped by the gateway). */
function askFrame(questions: unknown[]): EventsWaterfall {
	return { type: "waterfall", event: "user-questions/request", eventId: "ev-1", agentId: "sess-1", request: { questions } } as unknown as EventsWaterfall
}

describe("WaterfallAnswerer.questionsView — multiSelect passthrough (60-ask-user)", () => {
	test("keeps the renamed service field `multiSelect`", () => {
		const questions = WaterfallAnswerer.questionsView(
			askFrame([{ id: "q3", prompt: "Which extra checks should run?", options: ["lint", "smoke"], multiSelect: true }]),
		)
		expect(questions).toHaveLength(1)
		expect(questions[0].multiSelect).toBe(true)
	})

	test("keeps the raw tool field `multi_select` (host-session.ts fallback parity)", () => {
		const questions = WaterfallAnswerer.questionsView(
			askFrame([{ id: "q3", question: "picks?", options: [{ label: "lint" }, { label: "smoke" }], multi_select: true }]),
		)
		expect(questions[0].multiSelect).toBe(true)
		expect(questions[0].options).toEqual([{ label: "lint" }, { label: "smoke" }])
	})

	test("omits the key on single-select questions (absent, not false)", () => {
		const questions = WaterfallAnswerer.questionsView(askFrame([{ id: "q1", prompt: "deploy?", options: ["staging"] }]))
		expect(questions[0].multiSelect).toBeUndefined()
	})
})

describe("WaterfallAnswerer.questionsView — rich content plumbing", () => {
	test("carries header, detail, description and per-option descriptions", () => {
		const questions = WaterfallAnswerer.questionsView(
			askFrame([{
				id: "q1",
				question: "Which framework?",
				header: "Stack",
				detail: "Pick the renderer",
				description: "one line",
				options: [
					{ label: "React", description: "SPA, largest ecosystem" },
					{ label: "Solid" },
				],
			}]),
		)
		expect(questions[0]).toEqual({
			id: "q1",
			prompt: "Which framework?",
			header: "Stack",
			detail: "Pick the renderer",
			description: "one line",
			options: [{ label: "React", description: "SPA, largest ecosystem" }, { label: "Solid" }],
		})
	})

	test("string options and `value` option objects still normalize to labels", () => {
		const questions = WaterfallAnswerer.questionsView(
			askFrame([{ id: "q1", question: "which?", options: ["plain", { value: "legacy" }, { label: "modern", description: "new" }] }]),
		)
		expect(questions[0].options).toEqual([{ label: "plain" }, { label: "legacy" }, { label: "modern", description: "new" }])
		expect(questions[0].header).toBeUndefined()
		expect(questions[0].detail).toBeUndefined()
	})
})

describe("WaterfallAnswerer.answersValue — selections array (60-ask-user)", () => {
	const questions: RemoteQuestion[] = [
		{ id: "q1", prompt: "deploy?", options: [{ label: "staging" }, { label: "production" }] },
		{ id: "q3", prompt: "checks?", options: [{ label: "lint" }, { label: "smoke" }], multiSelect: true },
	]

	test("a multiSelect pick carries every toggled label in `selected`", () => {
		const picks: RemoteQuestionAnswer[] = [
			{ questionId: "q1", selected: "staging", selections: ["staging"] },
			{ questionId: "q3", selected: "lint", selections: ["lint", "smoke"] },
		]
		const value = WaterfallAnswerer.answersValue(questions, picks) as {
			answers: { id: string; selected: string[] }[]
		}
		expect(value.answers).toEqual([
			{ id: "q1", selected: ["staging"] },
			{ id: "q3", selected: ["lint", "smoke"] },
		])
	})

	test("a single-select pick without selections keeps the [first pick] shape", () => {
		const picks: RemoteQuestionAnswer[] = [{ questionId: "q1", selected: "staging" }]
		const value = WaterfallAnswerer.answersValue(questions, picks) as {
			answers: { id: string; selected: string[] }[]
		}
		expect(value.answers).toEqual([{ id: "q1", selected: ["staging"] }, { id: "q3", selected: [], custom: "declined" }])
	})

	test("an empty selections array falls back to the single pick", () => {
		const picks: RemoteQuestionAnswer[] = [{ questionId: "q3", selected: "lint", selections: [] }]
		const value = WaterfallAnswerer.answersValue([questions[1]], picks) as {
			answers: { id: string; selected: string[] }[]
		}
		expect(value.answers).toEqual([{ id: "q3", selected: ["lint"] }])
	})
})

describe("WaterfallAnswerer.answersValue — free-text custom (C7)", () => {
	const questions: RemoteQuestion[] = [{ id: "q1", prompt: "why?", options: [{ label: "a" }, { label: "b" }] }]

	test("a custom pick rides Answer.custom with an empty selected (mutual exclusion)", () => {
		const picks: RemoteQuestionAnswer[] = [{ questionId: "q1", selected: "", custom: "because reasons" }]
		const value = WaterfallAnswerer.answersValue(questions, picks) as {
			answers: { id: string; selected: string[]; custom?: string }[]
		}
		expect(value.answers).toEqual([{ id: "q1", selected: [], custom: "because reasons" }])
	})

	test("a missing pick still renders the declined envelope (unchanged contract)", () => {
		const value = WaterfallAnswerer.answersValue(questions, []) as {
			answers: { id: string; selected: string[]; custom?: string }[]
		}
		expect(value.answers).toEqual([{ id: "q1", selected: [], custom: "declined" }])
	})
})

describe("WaterfallAnswerer.answersValue — blank pick is unanswered (P1-3)", () => {
	const questions: RemoteQuestion[] = [
		{ id: "q1", prompt: "one?", options: [{ label: "a" }, { label: "b" }] },
		{ id: "q2", prompt: "two?", options: [{ label: "x" }] },
	]

	test("selected === '' with no custom produces the EXACT missing-pick shape", () => {
		const blank: RemoteQuestionAnswer[] = [
			{ questionId: "q1", selected: "a" },
			{ questionId: "q2", selected: "" },
		]
		const missing: RemoteQuestionAnswer[] = [{ questionId: "q1", selected: "a" }]
		const blankValue = WaterfallAnswerer.answersValue(questions, blank)
		const missingValue = WaterfallAnswerer.answersValue(questions, missing)
		// The exact same envelope: no `selected: [""]` state exists.
		expect(blankValue).toEqual(missingValue)
		expect(blankValue).toEqual({
			answers: [
				{ id: "q1", selected: ["a"] },
				{ id: "q2", selected: [], custom: "declined" },
			],
		})
		expect(JSON.stringify(blankValue)).not.toContain('[""]')
	})

	test("a blank selected is NOT declined when a custom answer rides along", () => {
		const picks: RemoteQuestionAnswer[] = [{ questionId: "q1", selected: "", custom: "free text" }]
		const value = WaterfallAnswerer.answersValue([questions[0]], picks) as {
			answers: { id: string; selected: string[]; custom?: string }[]
		}
		expect(value.answers).toEqual([{ id: "q1", selected: [], custom: "free text" }])
	})
})
