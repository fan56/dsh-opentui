import { describe, expect, test } from "bun:test"
import { NullSessionSeam, type SeamApprovalVerdict, type SeamAskPick } from "../src/seams/session"
import { TurnOverlayController } from "../src/routes/session/turn-overlay-controller"
import { registerTurnOverlays, summarizeArgs } from "../src/routes/session/turn-overlays"

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
	test("walks a batch one question at a time, then resolves picks", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([
			{ id: "q1", prompt: "first?", options: ["a", "b"] },
			{ id: "q2", prompt: "second?", options: ["x", "y"] },
		])
		expect(c.currentQuestion?.id).toBe("q1")
		c.pick("a")
		expect(c.currentQuestion?.id).toBe("q2")
		c.pick("y")
		expect(await pending).toEqual([
			{ questionId: "q1", selected: "a" },
			{ questionId: "q2", selected: "y" },
		])
		expect(c.pendingAsk).toBeUndefined()
	})

	test("esc mid-batch declines the whole batch as an empty selection", async () => {
		const c = new TurnOverlayController()
		const pending = c.answer([
			{ id: "q1", prompt: "first?", options: ["a"] },
			{ id: "q2", prompt: "second?", options: ["x"] },
		])
		c.pick("a")
		expect(c.currentQuestion?.id).toBe("q2")
		c.decline()
		const picks: SeamAskPick[] = await pending
		expect(picks).toEqual([])
		expect(c.pendingAsk).toBeUndefined()
	})

	test("empty question batch resolves declined immediately; no-provider seam declines", async () => {
		const c = new TurnOverlayController()
		expect(await c.answer([])).toEqual([])
		const seam = new NullSessionSeam()
		expect(await seam.ask([{ id: "q", prompt: "p", options: ["o"] }])).toEqual([])
	})
})

describe("overlay wiring through the seam", () => {
	test("registerTurnOverlays routes seam asks into the controller", async () => {
		const seam = new NullSessionSeam()
		const c = new TurnOverlayController()
		registerTurnOverlays(seam, c)
		const pending = seam.ask([{ id: "q9", prompt: "pick one", options: ["one", "two"] }])
		expect(c.currentQuestion?.id).toBe("q9")
		c.pick("two")
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
		c.pick("o")
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
