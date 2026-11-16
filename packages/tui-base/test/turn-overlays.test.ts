import { beforeAll, describe, expect, test } from "bun:test"
import { NullSessionSeam, type SeamApprovalVerdict, type SeamAskPick } from "../src/seams/session"
import { TurnOverlayController } from "../src/routes/session/turn-overlay-controller"
import { registerTurnOverlays, summarizeArgs } from "../src/routes/session/turn-overlays"
import {
	askNeedsReview,
	askTabStrip,
	hasReviewRow,
	inlineRowIndex,
	questionRowCount,
	recommendedPicks,
	reviewRowIntent,
	splitRecommended,
} from "../src/routes/session/ask-options"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"

// The ask-card copy resolves through `t()` (T7 facet migration): boot the
// bundled registry so the en-literal assertions stay hermetic in isolation.
beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})

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
		const pending = c.answer([{ id: "q1", prompt: "first?", options: [{ label: "a" }, { label: "b" }] }])
		expect(c.currentQuestion?.id).toBe("q1")
		c.toggle("a")
		expect(await pending).toEqual([{ questionId: "q1", selected: "a" }])
		expect(c.pendingAsk).toBeUndefined()
	})

	test("multi-question batch: single-select replaces and auto-advances to review", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([
			{ id: "q1", prompt: "first?", options: [{ label: "a" }, { label: "b" }] },
			{ id: "q2", prompt: "second?", options: [{ label: "x" }, { label: "y" }] },
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
			{ id: "q1", prompt: "pick many?", options: [{ label: "a" }, { label: "b" }, { label: "c" }], multiSelect: true },
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

	// C7 regression pin (container e2e 60-ask-user "space toggles lint on in
	// place"): the exact e2e ladder — two single-select picks then the
	// multiSelect question — with the sentinel rows present. The space toggle
	// (controller.toggle on the string-valued option rows) must still toggle
	// the RIGHT option in place, never displaced by the sentinel/review rows.
	test("space-toggle ladder over the C7 batch (2 single-select + 1 multiSelect, sentinel rows present)", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([
			{ id: "deploy", prompt: "where?", options: [{ label: "staging" }, { label: "production" }] },
			{ id: "verbosity", prompt: "how loud?", options: [{ label: "quiet" }, { label: "chatty" }] },
			{ id: "extras", prompt: "checks?", options: [{ label: "lint" }, { label: "smoke" }], multiSelect: true },
		])
		// The sentinel slot exists on every question from the start (C7).
		expect(c.pendingAsk?.customs).toEqual([undefined, undefined, undefined])
		c.toggle("staging") // auto-advances
		c.toggle("chatty") // auto-advances to the multiSelect tab
		expect(c.currentQuestion?.id).toBe("extras")
		c.toggle("lint")
		expect(c.pendingAsk?.picks[2]).toEqual(["lint"])
		expect(c.pendingAsk?.phase).toBe("questions") // multiSelect never auto-advances
		c.toggle("smoke")
		expect(c.pendingAsk?.picks[2]).toEqual(["lint", "smoke"])
		expect(c.enterReview()).toBe(true)
		c.submit()
		expect(await pending).toEqual([
			{ questionId: "deploy", selected: "staging" },
			{ questionId: "verbosity", selected: "chatty" },
			{ questionId: "extras", selected: "lint", selections: ["lint", "smoke"] },
		])
	})

	test("←/→ switchFocus moves between tabs, clamped at both ends", () => {
		const c = new TurnOverlayController()
		c.answer([
			{ id: "q1", prompt: "one", options: [{ label: "a" }] },
			{ id: "q2", prompt: "two", options: [{ label: "x" }] },
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
		solo.answer([{ id: "solo", prompt: "p", options: [{ label: "o" }] }])
		solo.switchFocus(1)
		expect(solo.currentQuestion?.id).toBe("solo")
	})

	test("enterReview opens a reviewing batch early (spec §8); a lone single-select batch has no page", () => {
		const c = new TurnOverlayController()
		c.answer([
			{ id: "q1", prompt: "one", options: [{ label: "a" }, { label: "b" }] },
			{ id: "q2", prompt: "two", options: [{ label: "x" }, { label: "y" }], multiSelect: true },
		])
		// The trailing review row makes the page reachable before every
		// question is answered; unanswered rows render their own state.
		c.toggle("a")
		expect(c.enterReview()).toBe(true)
		expect(c.pendingAsk?.phase).toBe("review")
		c.backToQuestions(1)
		expect(c.pendingAsk?.phase).toBe("questions")
		expect(c.currentQuestion?.id).toBe("q2")
		// A lone single-select batch settles on its pick: no review page.
		const solo = new TurnOverlayController()
		solo.answer([{ id: "solo", prompt: "p", options: [{ label: "o" }] }])
		expect(solo.enterReview()).toBe(false)
	})

	test("review page: ← back keeps picks, re-answer replaces, submit resolves the batch", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([
			{ id: "q1", prompt: "one", options: [{ label: "a" }, { label: "b" }] },
			{ id: "q2", prompt: "two", options: [{ label: "x" }, { label: "y" }] },
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
			{ id: "q1", prompt: "first?", options: [{ label: "a" }] },
			{ id: "q2", prompt: "second?", options: [{ label: "x" }] },
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
			{ id: "q1", prompt: "one", options: [{ label: "a" }] },
			{ id: "q2", prompt: "two", options: [{ label: "x" }] },
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
		expect(await seam.ask([{ id: "q", prompt: "p", options: [{ label: "o" }] }])).toEqual([])
	})
})

describe("TurnOverlayController ask custom (C7 free text)", () => {
	test("lone single-select: committed custom settles immediately, envelope rides Answer.custom", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([{ id: "q1", prompt: "why?", options: [{ label: "a" }, { label: "b" }] }])
		expect(c.beginCustom()).toBe(true)
		expect(c.pendingAsk?.customDraft).toBe("")
		c.patchCustom("because reasons")
		expect(c.pendingAsk?.customDraft).toBe("because reasons")
		c.commitCustom()
		expect(await pending).toEqual([{ questionId: "q1", selected: "", custom: "because reasons" }])
		expect(c.pendingAsk).toBeUndefined()
	})

	test("selected ⊕ custom are mutually exclusive, both directions", () => {
		const c = new TurnOverlayController()
		c.answer([
			{ id: "q1", prompt: "one", options: [{ label: "a" }, { label: "b" }] },
			{ id: "q2", prompt: "two", options: [{ label: "x" }, { label: "y" }] },
		])
		c.toggle("a") // auto-advances to q2
		c.switchFocus(-1) // back to q1
		// Committing custom clears the picked option.
		c.beginCustom()
		c.patchCustom("my own answer")
		c.commitCustom()
		expect(c.pendingAsk?.picks[0]).toEqual([])
		expect(c.pendingAsk?.customs[0]).toBe("my own answer")
		// Picking an option clears the committed custom (q1 still focused:
		// the commit auto-advanced to q2, switch back first).
		c.switchFocus(-1)
		c.toggle("b")
		expect(c.pendingAsk?.customs[0]).toBeUndefined()
		expect(c.pendingAsk?.picks[0]).toEqual(["b"])
	})

	test("empty commit discards and stays on the picker; esc cancels the draft", () => {
		const c = new TurnOverlayController()
		c.answer([{ id: "q1", prompt: "one", options: [{ label: "a" }] }])
		c.beginCustom()
		c.commitCustom() // empty draft: nothing answered, editor closed
		expect(c.pendingAsk?.customDraft).toBeNull()
		expect(c.pendingAsk?.customs[0]).toBeUndefined()
		c.beginCustom()
		c.patchCustom("  ")
		c.commitCustom() // whitespace-only: discarded too
		expect(c.pendingAsk?.customs[0]).toBeUndefined()
		expect(c.pendingAsk).toBeDefined()
		c.beginCustom()
		c.patchCustom("draft")
		c.cancelCustomEdit()
		expect(c.pendingAsk?.customDraft).toBeNull()
		expect(c.pendingAsk?.customs[0]).toBeUndefined()
	})

	test("custom counts as an answer: review gate opens, envelope carries custom next to picks", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([
			{ id: "q1", prompt: "one", options: [{ label: "a" }, { label: "b" }] },
			{ id: "q2", prompt: "two", options: [{ label: "x" }, { label: "y" }] },
		])
		c.beginCustom()
		c.patchCustom("free text")
		c.commitCustom()
		// Auto-advanced to the unanswered second tab; NOT on the review yet
		// (the lone-single fast path does not apply to multi-question batches).
		expect(c.currentQuestion?.id).toBe("q2")
		expect(c.pendingAsk?.phase).toBe("questions")
		c.toggle("y")
		expect(c.pendingAsk?.phase).toBe("review")
		c.submit()
		expect(await pending).toEqual([
			{ questionId: "q1", selected: "", custom: "free text" },
			{ questionId: "q2", selected: "y" },
		])
	})

	test("re-editing the sentinel seeds the draft from the committed answer; multiSelect custom reaches the review phase", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([{ id: "q1", prompt: "many?", options: [{ label: "a" }, { label: "b" }], multiSelect: true }])
		c.beginCustom()
		expect(c.pendingAsk?.customDraft).toBe("")
		c.patchCustom("typed once")
		c.commitCustom()
		// multiSelect never auto-settles: the review gate opens instead.
		expect(c.pendingAsk?.phase).toBe("review")
		c.backToQuestions(0)
		c.beginCustom()
		expect(c.pendingAsk?.customDraft).toBe("typed once")
		c.patchCustom("typed twice")
		c.commitCustom()
		expect(c.pendingAsk?.phase).toBe("review")
		c.submit()
		expect(await pending).toEqual([{ questionId: "q1", selected: "", custom: "typed twice" }])
	})

	test("toggle gates on the phase (input), not on a live draft", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([{ id: "q1", prompt: "one", options: [{ label: "a" }] }])
		c.beginCustom()
		expect(c.pendingAsk?.phase).toBe("input")
		c.toggle("a")
		expect(c.pendingAsk?.picks[0]).toEqual([])
		expect(c.pendingAsk?.customDraft).not.toBeNull()
		c.cancelCustomEdit()
		// Editor closed: the lone single-select fast path is live again — the
		// toggle settles the batch with the picked option.
		c.toggle("a")
		expect(await pending).toEqual([{ questionId: "q1", selected: "a" }])
		// Review phase has no sentinel: beginCustom refuses there.
		const multi = new TurnOverlayController()
		multi.answer([
			{ id: "q1", prompt: "one", options: [{ label: "a" }] },
			{ id: "q2", prompt: "two", options: [{ label: "x" }] },
		])
		multi.toggle("a")
		multi.toggle("x")
		expect(multi.pendingAsk?.phase).toBe("review")
		expect(multi.beginCustom()).toBe(false)
		expect(multi.pendingAsk?.customDraft).toBeNull()
	})

	test("P1-2: a typed draft + Esc leaves the list live; a pick clears the draft", () => {
		const c = new TurnOverlayController()
		c.answer([
			{ id: "q1", prompt: "one", options: [{ label: "a" }, { label: "b" }] },
			{ id: "q2", prompt: "two", options: [{ label: "x" }, { label: "y" }] },
		])
		c.setInlineText("foo")
		expect(c.pendingAsk?.phase).toBe("input")
		expect(c.pendingAsk?.customDraft).toBe("foo")
		// Esc stage 1: the buffer survives, the list owns the keys again.
		c.focusOptions()
		expect(c.pendingAsk?.phase).toBe("questions")
		expect(c.pendingAsk?.customDraft).toBe("foo")
		// The pick must land (it was silently inert while the stale draft
		// guard returned first) and the draft is cleared as intended.
		c.toggle("a")
		expect(c.pendingAsk?.picks[0]).toEqual(["a"])
		expect(c.pendingAsk?.customDraft).toBeNull()
		expect(c.pendingAsk?.customs[0]).toBeUndefined()
		// Auto-advance to the unanswered second tab.
		expect(c.pendingAsk?.index).toBe(1)
	})

	test("D4: inline drafts are per question — commit on q2 leaves q1's draft untouched", () => {
		const c = new TurnOverlayController()
		c.answer([
			{ id: "q1", prompt: "one", options: [{ label: "a" }, { label: "b" }] },
			{ id: "q2", prompt: "two", options: [{ label: "x" }, { label: "y" }] },
		])
		c.setInlineText("ab")
		c.focusOptions()
		// Esc restores the remembered LIST row (0), not "the row before the
		// inline input".
		expect(c.pendingAsk?.cursors[0]).toBe(0)
		c.switchFocus(1)
		// The draft belongs to q1: q2's row starts empty.
		expect(c.inlineText).toBe("")
		expect(c.pendingAsk?.customDraft).toBeNull()
		c.setInlineText("cd")
		c.commitCustom()
		// q2 committed its own text; q1's draft is still pending.
		expect(c.pendingAsk?.customs[1]).toBe("cd")
		expect(c.pendingAsk?.customs[0]).toBeUndefined()
		c.switchFocus(-1)
		expect(c.inlineText).toBe("ab")
		expect(c.pendingAsk?.customDraft).toBe("ab")
	})

	test("P2-8: auto-advance skips a later question answered by free text", () => {
		const c = new TurnOverlayController()
		c.answer([
			{ id: "q1", prompt: "one", options: [{ label: "a" }, { label: "b" }] },
			{ id: "q2", prompt: "two", options: [{ label: "x" }, { label: "y" }] },
			{ id: "q3", prompt: "three", options: [{ label: "m" }, { label: "n" }] },
		])
		c.toggle("a") // q1 answered, advances to q2
		expect(c.pendingAsk?.index).toBe(1)
		c.beginCustom()
		c.patchCustom("free text")
		c.commitCustom() // q2 answered by free text, advances to q3
		expect(c.pendingAsk?.index).toBe(2)
		c.switchFocus(-1)
		c.switchFocus(-1)
		expect(c.pendingAsk?.index).toBe(0)
		// q1 re-pick: the next unanswered tab is q3 — q2's picks are empty but
		// its committed custom answer covers it.
		c.toggle("b")
		expect(c.pendingAsk?.index).toBe(2)
		expect(c.pendingAsk?.phase).toBe("questions")
	})
})

describe("ask surface pure helpers (spec §3, §4, §8)", () => {
	test("splitRecommended strips only a trailing (Recommended)/(推荐) token", () => {
		expect(splitRecommended("Postgres (Recommended)")).toEqual({ label: "Postgres", recommended: true })
		expect(splitRecommended("Postgres（推荐）")).toEqual({ label: "Postgres", recommended: true })
		expect(splitRecommended("  Postgres  (RECOMMENDED) ")).toEqual({ label: "Postgres", recommended: true })
		// Negative cases: free text and unrelated parentheticals stay intact.
		expect(splitRecommended("not recommended")).toEqual({ label: "not recommended", recommended: false })
		expect(splitRecommended("fast (beta)")).toEqual({ label: "fast (beta)", recommended: false })
		expect(splitRecommended("推荐 but slow")).toEqual({ label: "推荐 but slow", recommended: false })
		// An all-suffix label keeps its text and renders no badge.
		expect(splitRecommended("(Recommended)")).toEqual({ label: "(Recommended)", recommended: false })
		expect(splitRecommended("（推荐）")).toEqual({ label: "（推荐）", recommended: false })
	})

	test("recommendedPicks pre-selects the draft and never submits (spec §4)", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([
			{ id: "q1", prompt: "one", options: [{ label: "a (Recommended)" }, { label: "b" }] },
			{ id: "q2", prompt: "two", options: [{ label: "x" }, { label: "y（推荐）" }] },
		])
		expect(c.pendingAsk?.picks).toEqual([["a (Recommended)"], ["y（推荐）"]])
		expect(c.pendingAsk?.phase).toBe("questions")
		expect(recommendedPicks({ id: "q", prompt: "p", options: [{ label: "x" }, { label: "y (Recommended)" }, { label: "z（推荐）" }] })).toEqual(["y (Recommended)"])
		// multiSelect pre-selects every recommended option.
		expect(
			recommendedPicks({
				id: "q",
				prompt: "p",
				multiSelect: true,
				options: [{ label: "x (Recommended)" }, { label: "y（推荐）" }, { label: "z" }],
			}),
		).toEqual(["x (Recommended)", "y（推荐）"])
		c.decline()
		expect(await pending).toEqual([])
	})

	test("askTabStrip: brackets mark focus, ✓ marks answered tabs", () => {
		const questions = [
			{ id: "1", prompt: "a", options: [{ label: "x" }] },
			{ id: "2", prompt: "b", options: [{ label: "y" }] },
			{ id: "3", prompt: "c", options: [{ label: "z" }] },
		]
		expect(askTabStrip(questions, [[], [], []], 0)).toBe("[1] · 2 · 3")
		expect(askTabStrip(questions, [["x"], [], ["z"]], 1)).toBe("1 ✓ · [2] · 3 ✓")
		// A committed custom answer counts as answered too; the focused tab's
		// ✓ rides inside its brackets.
		expect(askTabStrip(questions, [[], [], []], 0, ["free", undefined, undefined])).toBe("[1 ✓] · 2 · 3")
	})

	test("askNeedsReview + the row cursor space", () => {
		const one = { id: "1", prompt: "a", options: [{ label: "x" }] }
		const zero = { id: "2", prompt: "b", options: [] }
		expect(askNeedsReview([one])).toBe(false)
		expect(askNeedsReview([{ ...one, multiSelect: true }])).toBe(true)
		expect(askNeedsReview([one, zero])).toBe(true)
		// A zero-option question paints only the resident inline row (spec §2).
		expect(hasReviewRow(zero, true)).toBe(false)
		expect(questionRowCount(zero, true)).toBe(1)
		expect(inlineRowIndex(zero, true)).toBe(0)
		// Option row(s), the review row, then the inline row.
		expect(hasReviewRow(one, true)).toBe(true)
		expect(questionRowCount(one, true)).toBe(3)
		expect(inlineRowIndex(one, true)).toBe(2)
		expect(questionRowCount(one, false)).toBe(2)
	})

	test("reviewRowIntent: question rows edit, the last row submits (spec §8)", () => {
		expect(reviewRowIntent(0, 2)).toEqual({ kind: "edit", question: 0 })
		expect(reviewRowIntent(1, 2)).toEqual({ kind: "edit", question: 1 })
		expect(reviewRowIntent(2, 2)).toEqual({ kind: "submit" })
		expect(reviewRowIntent(9, 2)).toEqual({ kind: "submit" })
	})
})

describe("overlay wiring through the seam", () => {
	test("registerTurnOverlays routes seam asks into the controller", async () => {
		const seam = new NullSessionSeam()
		const c = new TurnOverlayController()
		registerTurnOverlays(seam, c)
		const pending = seam.ask([{ id: "q9", prompt: "pick one", options: [{ label: "one" }, { label: "two" }] }])
		expect(c.currentQuestion?.id).toBe("q9")
		c.toggle("two")
		expect(await pending).toEqual([{ questionId: "q9", selected: "two" }])
	})

	test("idle fires when the overlay set drains — the composer refocus point", async () => {
		const c = new TurnOverlayController()
		let idles = 0
		c.onIdle(() => idles++)
		const approval = c.requestApproval("bash", {})
		const ask = c.answer([{ id: "q", prompt: "p", options: [{ label: "o" }] }])
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
