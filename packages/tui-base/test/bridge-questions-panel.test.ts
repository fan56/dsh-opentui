/**
 * ADR-0011 T5b — TUI questions panel state machine (bridge ask channel).
 *
 * Pure controller tests: the seam is a fake that only exposes the read-only
 * `pendingAsks()` snapshot (frame handling lives in the seam, never in the UI).
 * The UI answers only through the provider promise the seam awaits — no frame
 * is sent here. The real render/key path is in questions-panel-ft.test.tsx.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import {
	TurnOverlayController,
	type BridgeAskSnapshot,
} from "../src/routes/session/turn-overlay-controller"
import { registerTurnOverlays } from "../src/routes/session/turn-overlays"
import type { SeamAskPick, SeamAskQuestion } from "../src/seams/session"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})

function question(
	id: string,
	prompt: string,
	labels: string[],
	extra: Partial<SeamAskQuestion> = {},
): SeamAskQuestion {
	return {
		id,
		prompt,
		options: labels.map((label) => ({ label })),
		...extra,
	}
}

function askSnapshot(
	eventId: string,
	questions: SeamAskQuestion[],
	extra: Partial<BridgeAskSnapshot> = {},
): BridgeAskSnapshot {
	return { eventId, kind: "questions", questions, ...extra }
}

/** A bridge-like seam: only `registerAskProvider` + the read-only snapshot. */
function bridgeLike(initial: BridgeAskSnapshot[] = []) {
	let snapshot = [...initial]
	return {
		registerAskProvider(_onAsk: (questions: SeamAskQuestion[]) => Promise<SeamAskPick[]>) {},
		pendingAsks: () => snapshot,
		setAsks(next: BridgeAskSnapshot[]) {
			snapshot = [...next]
		},
	}
}

describe("questions panel — provider answer / picks (ADR-0011 T5b)", () => {
	test("answer() opens a batch correlated to the seam entry; single-select resolves SeamAskPick[]", async () => {
		const q = question("q1", "Which database?", ["postgres", "sqlite"])
		const seam = bridgeLike([askSnapshot("t1:ask-1", [q])])
		const controller = new TurnOverlayController()
		registerTurnOverlays(seam, controller)

		const picks = controller.answer([q])
		expect(controller.pendingAsk?.eventId).toBe("t1:ask-1")
		expect(controller.pendingAsk?.questions[0]?.header).toBeUndefined()
		expect(controller.pendingAskCount).toBe(1)

		controller.toggle("postgres")
		expect(await picks).toEqual([{ questionId: "q1", selected: "postgres" }])
		expect(controller.pendingAsk).toBeUndefined()
	})

	test("header / description / detail / option description ride through the provider unchanged", () => {
		const q = question("q1", "Pick one", ["a", "b"], {
			header: "Migration",
			description: "supporting line",
			detail: "long body text",
			options: [
				{ label: "a", description: "option a detail" },
				{ label: "b" },
			],
		})
		const controller = new TurnOverlayController()
		void controller.answer([q])
		const shown = controller.pendingAsk?.questions[0]
		expect(shown?.header).toBe("Migration")
		expect(shown?.description).toBe("supporting line")
		expect(shown?.detail).toBe("long body text")
		expect(shown?.options[0]?.description).toBe("option a detail")
		controller.decline()
	})

	test("multi-select toggles membership and resolves selections[]", async () => {
		const q = question("q1", "Pick many", ["a", "b", "c"], { multiSelect: true })
		const controller = new TurnOverlayController()
		const picks = controller.answer([q])

		controller.toggle("a")
		controller.toggle("c")
		expect(controller.pendingAsk?.picks[0]).toEqual(["a", "c"])
		controller.submit()
		expect(await picks).toEqual([{ questionId: "q1", selected: "a", selections: ["a", "c"] }])
	})

	test("custom free-text resolves selected:'' + custom, not a silent option pick", async () => {
		const q = question("q1", "Your call", ["yes", "no"])
		const controller = new TurnOverlayController()
		const picks = controller.answer([q])

		expect(controller.beginCustom()).toBe(true)
		controller.patchCustom("  my own answer  ")
		controller.commitCustom()
		expect(await picks).toEqual([{ questionId: "q1", selected: "", custom: "my own answer" }])
	})

	test("decline resolves [] (the declined envelope); unanswered submit has no selected value", async () => {
		const questions = [
			question("q1", "One?", ["a", "b"]),
			question("q2", "Two?", ["c", "d"]),
		]
		const controller = new TurnOverlayController()
		const declined = controller.answer(questions)
		controller.decline()
		expect(await declined).toEqual([])

		const unanswered = controller.answer(questions)
		controller.enterReview()
		controller.submit()
		expect(await unanswered).toEqual([
			{ questionId: "q1", selected: "" },
			{ questionId: "q2", selected: "" },
		])
	})

	test("custom ⊕ options are mutually exclusive", async () => {
		const questions = [
			question("q1", "One?", ["a", "b"]),
			question("q2", "Two?", ["c", "d"]),
		]
		const controller = new TurnOverlayController()
		const picks = controller.answer(questions)
		controller.toggle("a") // q1 picked
		controller.switchFocus(1)
		controller.beginCustom()
		controller.patchCustom("free text")
		controller.commitCustom() // q2 custom → review page (2 questions)
		controller.submit()
		expect(await picks).toEqual([
			{ questionId: "q1", selected: "a" },
			{ questionId: "q2", selected: "", custom: "free text" },
		])
	})
})

describe("questions panel — cancellation / sync / stacking (ADR-0011 T5b)", () => {
	test("ask.cancel removes the seam entry: sync closes the panel and resolves []", async () => {
		const q = question("q1", "Which?", ["a", "b"])
		const seam = bridgeLike([askSnapshot("t1:ask-1", [q])])
		const controller = new TurnOverlayController()
		registerTurnOverlays(seam, controller)
		const picks = controller.answer([q])
		expect(controller.pendingAsk).toBeDefined()

		seam.setAsks([]) // host cancelled / timed out / turn ended
		controller.syncPendingAsks()
		expect(await picks).toEqual([])
		expect(controller.pendingAsk).toBeUndefined()
		expect(controller.pendingAskCount).toBe(0)
	})

	test("turn termination sweeps every pending batch fail-closed", async () => {
		const controller = new TurnOverlayController()
		const first = controller.answer([question("q1", "One?", ["a"])])
		const second = controller.answer([question("q2", "Two?", ["b"])])
		expect(controller.pendingAskCount).toBe(2)

		controller.cancelAllAsks()
		expect(await first).toEqual([])
		expect(await second).toEqual([])
		expect(controller.pendingAsk).toBeUndefined()
		expect(controller.pendingAskCount).toBe(0)
	})

	test("multiple requests stack FIFO and settle in order (no ghost panel)", async () => {
		const controller = new TurnOverlayController()
		const first = controller.answer([question("q1", "One?", ["a"])])
		const second = controller.answer([question("q2", "Two?", ["b"])])
		const third = controller.answer([question("q3", "Three?", ["c"])])
		expect(controller.pendingAskCount).toBe(3)
		expect(controller.pendingAsk?.eventId).toBeUndefined() // plain seam, no correlation

		controller.toggle("a")
		expect(await first).toEqual([{ questionId: "q1", selected: "a" }])
		controller.toggle("b")
		expect(await second).toEqual([{ questionId: "q2", selected: "b" }])
		controller.toggle("c")
		expect(await third).toEqual([{ questionId: "q3", selected: "c" }])
		expect(controller.pendingAskCount).toBe(0)
	})

	test("reconnect snapshot replacement closes the stale panel, keeps the live one", async () => {
		const q1 = question("q1", "Which?", ["a"])
		const q2 = question("q2", "Which?", ["b"])
		const seam = bridgeLike([askSnapshot("t1:ask-1", [q1]), askSnapshot("t1:ask-2", [q2])])
		const controller = new TurnOverlayController()
		registerTurnOverlays(seam, controller)
		const stale = controller.answer([q1])
		const live = controller.answer([q2])
		expect(controller.pendingAsk?.eventId).toBe("t1:ask-1")

		seam.setAsks([askSnapshot("t1:ask-2", [q2])])
		controller.syncPendingAsks()
		expect(await stale).toEqual([])
		expect(controller.pendingAsk?.eventId).toBe("t1:ask-2")

		controller.toggle("b")
		expect(await live).toEqual([{ questionId: "q2", selected: "b" }])
	})

	test("sync reconciles BOTH queues: a cancelled questions ask never touches a live approval card", async () => {
		const approval = askSnapshot("t1:ask-a", [], { kind: "approval", callId: "c-1" })
		const q = question("q1", "Which?", ["a"])
		const seam = bridgeLike([approval, askSnapshot("t1:ask-q", [q])])
		const controller = new TurnOverlayController()
		registerTurnOverlays(seam, controller)
		const onApprove = controller.requestApproval("bash", { callId: "c-1" })
		const picks = controller.answer([q])
		expect(controller.pendingApproval).toBeDefined()
		expect(controller.pendingAsk?.eventId).toBe("t1:ask-q")

		seam.setAsks([approval]) // only the questions ask was cancelled
		controller.syncPendingAsks()
		expect(await picks).toEqual([])
		expect(controller.pendingApproval).toBeDefined()
		controller.confirmApproval()
		expect(await onApprove).toBe("allowed-once")
	})

	test("no snapshot accessor (non-bridge seam): sync is a no-op on panels", async () => {
		const controller = new TurnOverlayController()
		const picks = controller.answer([question("q1", "Which?", ["a"])])
		controller.syncPendingAsks()
		expect(controller.pendingAsk).toBeDefined()
		controller.decline()
		expect(await picks).toEqual([])
	})

	test("ambiguous content stays uncorrelated; conservative sync keeps the panel until none remain", async () => {
		const qA = question("q1", "A?", ["a"])
		const qB = question("q1", "B?", ["b"])
		const seam = bridgeLike([askSnapshot("t1:ask-a", [qA]), askSnapshot("t1:ask-b", [qB])])
		const controller = new TurnOverlayController()
		registerTurnOverlays(seam, controller)
		const picks = controller.answer([question("q1", "Unknown?", ["x"])])
		expect(controller.pendingAsk?.eventId).toBeUndefined() // no guess

		seam.setAsks([askSnapshot("t1:ask-b", [qB])])
		controller.syncPendingAsks()
		expect(controller.pendingAsk).toBeDefined() // one questions ask still live
		seam.setAsks([])
		controller.syncPendingAsks()
		expect(await picks).toEqual([])
	})
})
