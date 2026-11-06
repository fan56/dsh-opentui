import { describe, expect, test } from "bun:test"
import { NullSessionSeam, type SeamApprovalVerdict, type SeamAskPick } from "../src/seams/session"
import { TurnOverlayController } from "../src/routes/session/turn-overlay-controller"
import { askNeedsReview, askProgressTitle, askTabStrip, registerTurnOverlays, summarizeArgs } from "../src/routes/session/turn-overlays"

describe("TurnOverlayController approval", () => {
	test("confirm resolves the exact allowed-once verdict", async () => {
		const c = new TurnOverlayController()
		const pending = c.requestApproval("bash", { command: "git status" })
		expect(c.pendingApproval?.name).toBe("bash")
		c.confirmApproval()
		expect(await pending).toBe<SeamApprovalVerdict>("allowed-once")
		expect(c.pendingApproval).toBeUndefined()
	})

	test("cancel and empty-settle resolve rejected (esc path)", async () => {
		const c = new TurnOverlayController()
		const cancelled = c.requestApproval("rm", {})
		c.rejectApproval()
		expect(await cancelled).toBe<SeamApprovalVerdict>("rejected")
		// Settling with nothing pending is a no-op (no throw, no resolve leak).
		c.confirmApproval()
		c.rejectApproval()
	})

	test("requests queue FIFO and settle in order", async () => {
		const c = new TurnOverlayController()
		const first = c.requestApproval("a", {})
		const second = c.requestApproval("b", {})
		expect(c.pendingApproval?.name).toBe("a")
		c.confirmApproval()
		expect(await first).toBe("allowed-once")
		expect(c.pendingApproval?.name).toBe("b")
		c.rejectApproval()
		expect(await second).toBe<SeamApprovalVerdict>("rejected")
	})
})

describe("TurnOverlayController ask", () => {
	test("lone single-select question settles on the pick (legacy fast path)", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([{ id: "q1", prompt: "first?", options: ["a", "b"] }])
		expect(c.currentQuestion?.id).toBe("q1")
		c.toggle("a")
		expect(await pending).toEqual([{ questionId: "q1", selected: "a" }])
		expect(c.pendingAsk).toBeUndefined()
	})

	test("multi-question batch: single-select replaces and auto-advances to review", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([
			{ id: "q1", prompt: "first?", options: ["a", "b"] },
			{ id: "q2", prompt: "second?", options: ["x", "y"] },
		])
		expect(c.pendingAsk?.phase).toBe("questions")
		c.toggle("a")
		// Auto-advanced to the unanswered second tab, still in questions phase.
		expect(c.currentQuestion?.id).toBe("q2")
		expect(c.pendingAsk?.phase).toBe("questions")
		c.toggle("y")
		// All answered: the review gate opens.
		expect(c.pendingAsk?.phase).toBe("review")
		c.submit()
		expect(await pending).toEqual([
			{ questionId: "q1", selected: "a" },
			{ questionId: "q2", selected: "y" },
		])
		expect(c.pendingAsk).toBeUndefined()
	})

	test("multiSelect toggles membership in place and the envelope carries selections", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([
			{ id: "q1", prompt: "pick many?", options: ["a", "b", "c"], multiSelect: true },
		])
		c.toggle("a")
		expect(c.pendingAsk?.phase).toBe("questions")
		c.toggle("b")
		expect(c.pendingAsk?.picks[0]).toEqual(["a", "b"])
		c.toggle("a") // untoggle
		expect(c.pendingAsk?.picks[0]).toEqual(["b"])
		expect(c.enterReview()).toBe(true)
		c.submit()
		expect(await pending).toEqual([{ questionId: "q1", selected: "b" }])
	})

	test("←/→ switchFocus moves between tabs, clamped at both ends", () => {
		const c = new TurnOverlayController()
		c.answer([
			{ id: "q1", prompt: "one", options: ["a"] },
			{ id: "q2", prompt: "two", options: ["x"] },
		])
		c.switchFocus(1)
		expect(c.currentQuestion?.id).toBe("q2")
		c.switchFocus(1) // clamped at the last tab
		expect(c.currentQuestion?.id).toBe("q2")
		c.switchFocus(-1)
		expect(c.currentQuestion?.id).toBe("q1")
		c.switchFocus(-1) // clamped at the first tab
		expect(c.currentQuestion?.id).toBe("q1")
		// Single-question batches and the review phase ignore tab switches.
		const solo = new TurnOverlayController()
		solo.answer([{ id: "solo", prompt: "p", options: ["o"] }])
		solo.switchFocus(1)
		expect(solo.currentQuestion?.id).toBe("solo")
	})

	test("enterReview is refused until every question is answered; backToQuestions returns to edit", () => {
		const c = new TurnOverlayController()
		c.answer([
			{ id: "q1", prompt: "one", options: ["a", "b"] },
			{ id: "q2", prompt: "two", options: ["x", "y"], multiSelect: true },
		])
		c.toggle("a")
		expect(c.enterReview()).toBe(false)
		expect(c.pendingAsk?.phase).toBe("questions")
		c.toggle("x")
		expect(c.enterReview()).toBe(true)
		c.backToQuestions(1)
		expect(c.pendingAsk?.phase).toBe("questions")
		expect(c.currentQuestion?.id).toBe("q2")
	})

	test("review page: ← back keeps picks, re-answer replaces, submit resolves the batch", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([
			{ id: "q1", prompt: "one", options: ["a", "b"] },
			{ id: "q2", prompt: "two", options: ["x", "y"] },
		])
		c.toggle("a")
		c.toggle("y")
		expect(c.pendingAsk?.phase).toBe("review")
		c.backToQuestions(0)
		expect(c.pendingAsk?.phase).toBe("questions")
		// Picks survive the round trip; the focused tab kept its answer.
		expect(c.pendingAsk?.picks).toEqual([["a"], ["y"]])
		expect(c.currentQuestion?.id).toBe("q1")
		c.toggle("b") // re-answer q1 (focused)
		expect(c.pendingAsk?.phase).toBe("review")
		c.submit()
		expect(await pending).toEqual([
			{ questionId: "q1", selected: "b" },
			{ questionId: "q2", selected: "y" },
		])
	})

	test("esc mid-batch declines the whole batch as an empty selection", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([
			{ id: "q1", prompt: "first?", options: ["a"] },
			{ id: "q2", prompt: "second?", options: ["x"] },
		])
		c.toggle("a")
		expect(c.currentQuestion?.id).toBe("q2")
		c.decline()
		const picks: SeamAskPick[] = await pending
		expect(picks).toEqual([])
		expect(c.pendingAsk).toBeUndefined()
	})

	test("esc on the review page still declines the whole batch", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([
			{ id: "q1", prompt: "one", options: ["a"] },
			{ id: "q2", prompt: "two", options: ["x"] },
		])
		c.toggle("a")
		c.toggle("x")
		expect(c.pendingAsk?.phase).toBe("review")
		c.decline()
		expect(await pending).toEqual([])
	})

	test("empty question batch resolves declined immediately; no-provider seam declines", async () => {
		const c = new TurnOverlayController()
		expect(await c.answer([])).toEqual([])
		const seam = new NullSessionSeam()
		expect(await seam.ask([{ id: "q", prompt: "p", options: ["o"] }])).toEqual([])
	})
})

describe("ask picker pure helpers (F5)", () => {
	test("askTabStrip: brackets mark focus, ✓ marks answered tabs", () => {
		const questions = [
			{ id: "1", prompt: "a", options: ["x"] },
			{ id: "2", prompt: "b", options: ["y"] },
			{ id: "3", prompt: "c", options: ["z"] },
		]
		expect(askTabStrip(questions, [[], [], []], 0)).toBe("[1] · 2 · 3")
		expect(askTabStrip(questions, [["x"], [], ["z"]], 1)).toBe("1✓ · [2] · 3✓")
	})

	test("askProgressTitle: (i/n) only for multi-question batches", () => {
		expect(askProgressTitle([{ id: "1", prompt: "a", options: [] }], 0)).toBe("Question")
		expect(askProgressTitle([{ id: "1", prompt: "a", options: [] }, { id: "2", prompt: "b", options: [] }], 1)).toBe("Question (2/2)")
	})

	test("askNeedsReview: multi-question or any multiSelect", () => {
		expect(askNeedsReview([{ id: "1", prompt: "a", options: ["x"] }])).toBe(false)
		expect(askNeedsReview([{ id: "1", prompt: "a", options: ["x"], multiSelect: true }])).toBe(true)
		expect(askNeedsReview([{ id: "1", prompt: "a", options: ["x"] }, { id: "2", prompt: "b", options: ["y"] }])).toBe(true)
	})
})

describe("overlay wiring through the seam", () => {
	test("registerTurnOverlays routes seam asks into the controller", async () => {
		const seam = new NullSessionSeam()
		const c = new TurnOverlayController()
		registerTurnOverlays(seam, c)
		const pending = seam.ask([{ id: "q9", prompt: "pick one", options: ["one", "two"] }])
		expect(c.currentQuestion?.id).toBe("q9")
		c.toggle("two")
		expect(await pending).toEqual([{ questionId: "q9", selected: "two" }])
	})

	test("idle fires when the overlay set drains — the composer refocus point", async () => {
		const c = new TurnOverlayController()
		let idles = 0
		c.onIdle(() => idles++)
		const approval = c.requestApproval("bash", {})
		const ask = c.answer([{ id: "q", prompt: "p", options: ["o"] }])
		// Approval settles but the ask is still queued: no drain yet.
		c.confirmApproval()
		expect(idles).toBe(0)
		c.toggle("o")
		await approval
		await ask
		// Draining to empty again (second sequence) fires it once more.
		const second = c.requestApproval("a", {})
		expect(idles).toBe(1)
		c.rejectApproval()
		await second
		expect(idles).toBe(2)
	})

	test("summarizeArgs: tool name + compact JSON, truncated with ellipsis", () => {
		expect(summarizeArgs("bash", { command: "git status" })).toBe("bash {\"command\":\"git status\"}")
		const long = summarizeArgs("x", { blob: "y".repeat(300) })
		expect(long.length).toBe(162)
		expect(long.endsWith("…")).toBe(true)
	})
})
