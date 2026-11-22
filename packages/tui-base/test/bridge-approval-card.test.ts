/**
 * ADR-0011 T5a — TUI approval card state machine.
 *
 * Pure controller tests: the seam is a fake that only exposes the read-only
 * `pendingAsks()` snapshot (frame handling lives in the seam, never in the UI).
 * No Solid renderer here — the reactive/rendering path is covered by the FT
 * test; this file pins the state machine the FT test drives.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import {
	TurnOverlayController,
	type BridgeAskSnapshot,
} from "../src/routes/session/turn-overlay-controller"
import { registerTurnOverlays, summarizeArgs } from "../src/routes/session/turn-overlays"
import type { SeamAskPick, SeamAskQuestion } from "../src/seams/session"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})

function ask(overrides: Partial<BridgeAskSnapshot> = {}): BridgeAskSnapshot {
	return {
		eventId: "t1:ask-1",
		kind: "approval",
		toolName: "bash",
		callId: "c-1",
		reason: "run git status",
		...(overrides),
	}
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

describe("approval card — request / verdict", () => {
	test("a request opens a card enriched from the read-only snapshot", async () => {
		const seam = bridgeLike([ask({ escalation: true })])
		const controller = new TurnOverlayController()
		registerTurnOverlays(seam, controller)

		const onApprove = controller.requestApproval("bash", { callId: "c-1", reason: "run git status" })
		expect(controller.pendingApproval?.name).toBe("bash")
		expect(controller.pendingApproval?.eventId).toBe("t1:ask-1")
		expect(controller.pendingApproval?.escalation).toBe(true)
		expect(controller.pendingApprovalCount).toBe(1)

		controller.confirmApproval()
		expect(await onApprove).toBe("allowed-once")
		expect(controller.pendingApproval).toBeUndefined()
	})

	test("confirm routes to allowed-once; esc/reject routes to rejected (fail-closed)", async () => {
		const controller = new TurnOverlayController()
		const allowed = controller.requestApproval("bash", {})
		controller.confirmApproval()
		expect(await allowed).toBe("allowed-once")

		const denied = controller.requestApproval("rm", {})
		controller.rejectApproval()
		expect(await denied).toBe("rejected")
		// Empty settle is a no-op (no throw, no resolve leak).
		controller.confirmApproval()
		controller.rejectApproval()
	})

	test("escalation actions only settle when the host granted escalation", async () => {
		const seam = bridgeLike([ask({ eventId: "t1:ask-2", escalation: true })])
		const controller = new TurnOverlayController()
		registerTurnOverlays(seam, controller)

		const first = controller.requestApproval("bash", { callId: "c-1" })
		controller.approveAlways()
		expect(await first).toBe("always")

		const second = controller.requestApproval("bash", { callId: "c-1" })
		controller.approveSession()
		expect(await second).toBe("session")

		// No escalation on the wire: the widened verdicts are refused locally,
		// the card stays pending, and the only way out is allow-once / reject.
		seam.setAsks([ask({ eventId: "t1:ask-3", escalation: false })])
		const third = controller.requestApproval("bash", { callId: "c-1" })
		expect(controller.pendingApproval?.escalation).toBe(false)
		controller.approveAlways()
		controller.approveSession()
		expect(controller.pendingApproval?.name).toBe("bash")
		controller.rejectApproval()
		expect(await third).toBe("rejected")
	})

	test("args summary is truncated (no whole sensitive blob on screen)", () => {
		const summary = summarizeArgs("bash", { command: "x".repeat(500) })
		expect(summary.startsWith("bash ")).toBe(true)
		expect(summary.length).toBeLessThanOrEqual("bash ".length + 160)
		expect(summary).toContain("…")
	})
})

describe("approval card — cancellation / sync / stacking", () => {
	test("ask.cancel removes the ask: sync closes the card fail-closed", async () => {
		const seam = bridgeLike([ask()])
		const controller = new TurnOverlayController()
		registerTurnOverlays(seam, controller)
		const onApprove = controller.requestApproval("bash", { callId: "c-1" })
		expect(controller.pendingApproval).toBeDefined()

		// Host cancelled / settled the ask; the seam's snapshot is now empty.
		seam.setAsks([])
		controller.syncPendingAsks()
		expect(controller.pendingApproval).toBeUndefined()
		expect(await onApprove).toBe("rejected")
	})

	test("turn termination sweeps every pending card fail-closed", async () => {
		const controller = new TurnOverlayController()
		const first = controller.requestApproval("bash", {})
		const second = controller.requestApproval("rm", {})
		expect(controller.pendingApprovalCount).toBe(2)

		controller.cancelAllApprovals()
		expect(await first).toBe("rejected")
		expect(await second).toBe("rejected")
		expect(controller.pendingApproval).toBeUndefined()
		expect(controller.pendingApprovalCount).toBe(0)
	})

	test("reconnect snapshot replacement closes stale cards, keeps live ones", async () => {
		const seam = bridgeLike([
			ask({ eventId: "t1:ask-1", callId: "c-1" }),
			ask({ eventId: "t1:ask-9", callId: "c-2" }),
		])
		const controller = new TurnOverlayController()
		registerTurnOverlays(seam, controller)
		const stale = controller.requestApproval("bash", { callId: "c-1" })
		const live = controller.requestApproval("bash", { callId: "c-2" })

		seam.setAsks([ask({ eventId: "t1:ask-9", callId: "c-2" })])
		controller.syncPendingAsks()
		expect(await stale).toBe("rejected")
		expect(controller.pendingApproval?.eventId).toBe("t1:ask-9")

		controller.confirmApproval()
		expect(await live).toBe("allowed-once")
	})

	test("multiple requests stack FIFO and settle in order", async () => {
		const controller = new TurnOverlayController()
		const first = controller.requestApproval("a", {})
		const second = controller.requestApproval("b", {})
		const third = controller.requestApproval("c", {})
		expect(controller.pendingApprovalCount).toBe(3)
		expect(controller.pendingApproval?.name).toBe("a")

		controller.confirmApproval()
		expect(await first).toBe("allowed-once")
		expect(controller.pendingApproval?.name).toBe("b")
		controller.approveAlways() // no escalation on this plain controller: no-op
		expect(controller.pendingApproval?.name).toBe("b")
		controller.rejectApproval()
		expect(await second).toBe("rejected")
		expect(controller.pendingApproval?.name).toBe("c")
		controller.confirmApproval()
		expect(await third).toBe("allowed-once")
		expect(controller.pendingApprovalCount).toBe(0)
	})

	test("no snapshot accessor (non-bridge seam): sync is a no-op, escalation off", async () => {
		const controller = new TurnOverlayController()
		const pending = controller.requestApproval("bash", {})
		expect(controller.pendingApproval?.escalation).toBe(false)
		controller.syncPendingAsks()
		expect(controller.pendingApproval).toBeDefined()
		controller.rejectApproval()
		expect(await pending).toBe("rejected")
	})

	test("ambiguous args never widen to escalation; conservative sync keeps card", async () => {
		const seam = bridgeLike([
			ask({ eventId: "t1:ask-a", callId: "c-a", escalation: true }),
			ask({ eventId: "t1:ask-b", callId: "c-b", reason: "other", escalation: true }),
		])
		const controller = new TurnOverlayController()
		registerTurnOverlays(seam, controller)
		const pending = controller.requestApproval("bash", { callId: "unknown-call" })
		expect(controller.pendingApproval?.escalation).toBe(false)
		expect(controller.pendingApproval?.eventId).toBeUndefined()

		// No eventId to correlate: only a FULLY empty approval set closes it.
		seam.setAsks([ask({ eventId: "t1:ask-b", callId: "c-b", reason: "other" })])
		controller.syncPendingAsks()
		expect(controller.pendingApproval).toBeDefined()
		seam.setAsks([])
		controller.syncPendingAsks()
		expect(await pending).toBe("rejected")
	})
})

// A6 — a rebuilt card whose ask.response failed becomes a terminal
// "已失效" card carrying its reason (never a silent disappearance).
describe("A6: invalidated terminal card", () => {
	test("invalidateAsk keeps the askId and paints a reason; ack clears the terminal card", () => {
		const controller = new TurnOverlayController()
		controller.invalidateAsk("t9:ask-1", "ASK_TURN_ENDED: turn ended")

		expect(controller.pendingInvalidated().get("t9:ask-1")).toContain("ASK_TURN_ENDED")
		expect(controller.pendingApproval?.eventId).toBe("t9:ask-1")
		expect(controller.pendingApproval?.invalidatedReason).toContain("ASK_TURN_ENDED")

		// The only action is acknowledgement — fail-closed, never an allow.
		controller.confirmApproval()
		expect(controller.pendingInvalidated().size).toBe(0)
		expect(controller.pendingApproval).toBeUndefined()
	})

	test("a still-open card for the same askId is dropped fail-closed before the terminal card", async () => {
		const controller = new TurnOverlayController()
		registerTurnOverlays(bridgeLike([ask({ eventId: "t9:ask-1" })]), controller)
		const pending = controller.requestApproval("bash", { callId: "c-1" })
		expect(controller.pendingApproval?.eventId).toBe("t9:ask-1")
		controller.invalidateAsk("t9:ask-1", "ASK_UNKNOWN_REQUEST: evicted")
		expect(await pending).toBe("rejected")
		expect(controller.pendingApproval?.eventId).toBe("t9:ask-1")
		expect(controller.pendingApproval?.invalidatedReason).toContain("ASK_UNKNOWN_REQUEST")
	})

	test("registerTurnOverlays wires bridge.ask.invalidated into the controller", () => {
		let listener: ((event: { type: string; details: unknown }) => void) | undefined
		const seam = {
			...bridgeLike([]),
			onSessionEvent(fn: (event: { type: string; details: unknown }) => void) {
				listener = fn
				return () => { listener = undefined }
			},
		}
		const controller = new TurnOverlayController()
		registerTurnOverlays(seam, controller)

		listener?.({
			type: "bridge.ask.invalidated",
			details: { eventId: "t9:ask-1", reason: "ASK_TURN_ENDED: turn ended" },
		})
		expect(controller.pendingInvalidated().get("t9:ask-1")).toBe("ASK_TURN_ENDED: turn ended")
	})
})

// RM-2b V3 — a bridge PROCESS death kills every turn/ask in it. No pending
// snapshot can be rebuilt across a dead process (AskRegistry died with it), so
// every pending card goes straight to a terminal "已失效" state on bridge.dead.
describe("RM-2b V3: bridge.dead invalidates every pending card", () => {
	function withDeadEvents(
		controller: TurnOverlayController,
		deadReason: (details: unknown) => string,
		initial: BridgeAskSnapshot[] = [],
	) {
		let listener: ((event: { type: string; details: unknown }) => void) | undefined
		const seam = {
			...bridgeLike(initial),
			onSessionEvent(fn: (event: { type: string; details: unknown }) => void) {
				listener = fn
				return () => { listener = undefined }
			},
		}
		registerTurnOverlays(seam, controller, { deadReason })
		return (event: { type: string; details: unknown }) => listener?.(event)
	}

	const QUESTIONS: SeamAskQuestion[] = [
		{ id: "q1", prompt: "Keep?", options: [{ label: "A" }, { label: "B" }] },
	]

	test("bridge.dead → all pending approvals + questions become terminal invalidated cards", async () => {
		const controller = new TurnOverlayController()
		const emit = withDeadEvents(controller, (details) => {
			const cause = details as { message?: string }
			return `CONNECTION_LOST · ${cause.message ?? ""}`
		}, [
			ask({ eventId: "t9:ask-1", callId: "c-1", toolName: "bash" }),
			ask({ eventId: "t9:ask-2", callId: "c-2", toolName: "rm" }),
			{
				eventId: "t9:ask-3",
				kind: "questions",
				questions: QUESTIONS,
			} as BridgeAskSnapshot,
		])

		const first = controller.requestApproval("bash", { callId: "c-1" })
		const second = controller.requestApproval("rm", { callId: "c-2" })
		const answers = controller.answer(QUESTIONS)
		expect(controller.pendingApprovalCount).toBe(2)
		expect(controller.pendingAskCount).toBe(1)

		emit({
			type: "bridge.dead",
			details: { stage: "runtime", code: null, signal: "SIGKILL", message: "bridge host exited (signal SIGKILL)" },
		})

		// Every card is now a terminal invalidated card (reason includes the
		// localized disconnected text + the dead cause message). None is dropped.
		const invalidated = controller.pendingInvalidated()
		expect(invalidated.size).toBe(3)
		for (const reason of invalidated.values()) {
			expect(reason).toContain("CONNECTION_LOST")
			expect(reason).toContain("SIGKILL")
		}
		expect(controller.pendingApproval?.invalidatedReason).toContain("CONNECTION_LOST")
		expect(controller.pendingAskCount).toBe(0)
		// Original waiters settle fail-closed: no dangling promise, no implicit allow.
		expect(await first).toBe("rejected")
		expect(await second).toBe("rejected")
		expect(await answers).toEqual([])
	})

	test("a terminal card is acknowledge-only, never an answer (作答入口禁用)", async () => {
		const controller = new TurnOverlayController()
		const emit = withDeadEvents(controller, () => "CONNECTION_LOST")
		const pending = controller.requestApproval("bash", { callId: "c-1" })
		emit({ type: "bridge.dead", details: {} })

		expect(controller.pendingApproval?.invalidatedReason).toBe("CONNECTION_LOST")
		// The original waiter is failed closed — a terminal card never answers.
		expect(await pending).toBe("rejected")
		// Confirm on a terminal card only acknowledges the single card: it does
		// not produce a verdict, and escalation actions are never rendered.
		controller.confirmApproval()
		expect(controller.pendingInvalidated().size).toBe(0)
		expect(controller.pendingApproval).toBeUndefined()
	})

	test("a follow-up BRIDGE_DEAD bridge.ask.invalidated cannot repaint the terminal reason", () => {
		const controller = new TurnOverlayController()
		const emit = withDeadEvents(controller, () => "CONNECTION_LOST (localized)")
		controller.invalidateAsk("t9:ask-1", "CONNECTION_LOST (localized)")
		emit({ type: "bridge.dead", details: {} })
		expect(controller.pendingInvalidated().get("t9:ask-1")).toBe("CONNECTION_LOST (localized)")

		emit({ type: "bridge.ask.invalidated", details: { eventId: "t9:ask-1", reason: "BRIDGE_DEAD: bridge dead" } })
		expect(controller.pendingInvalidated().get("t9:ask-1")).toBe("CONNECTION_LOST (localized)")
	})

	test("non-dead events do NOT invalidate pending cards (no regression)", async () => {
		const controller = new TurnOverlayController()
		const emit = withDeadEvents(controller, () => "CONNECTION_LOST")
		const pending = controller.requestApproval("bash", {})
		emit({ type: "bridge.recovered", details: { applied: 0 } })
		emit({ type: "bridge.session.opened", details: {} })
		expect(controller.pendingInvalidated().size).toBe(0)
		expect(controller.pendingApproval?.invalidatedReason).toBeUndefined()
		controller.rejectApproval()
		expect(await pending).toBe("rejected")
	})
})

// ---------------------------------------------------------------------------
// F1-A3 — parent + child approval cards in one turn, keyed by eventId
// ---------------------------------------------------------------------------
describe("F1-A3 — parent/child approval cards coexist (eventId correlation)", () => {
	test("eventId in args correlates each card to its own snapshot row (no borrowed escalation)", async () => {
		const seam = bridgeLike([
			ask({ eventId: "t1:ask-parent", callId: "c-p", toolName: "bash", escalation: false }),
			ask({
				eventId: "t1:ask-child",
				callId: "c-c",
				toolName: "bash",
				escalation: true,
				parentSessionId: "s1",
				childSessionId: "child-1",
			}),
		])
		const controller = new TurnOverlayController()
		registerTurnOverlays(seam, controller)

		// Parent card: legacy args (no eventId) — matches by callId.
		const parent = controller.requestApproval("bash", { callId: "c-p" })
		expect(controller.pendingApproval?.eventId).toBe("t1:ask-parent")
		expect(controller.pendingApproval?.escalation).toBe(false)

		// Child card: the seam supplies its unique eventId; the controller must
		// key on it rather than borrow the parent card's row.
		const child = controller.requestApproval("bash", { callId: "c-c", eventId: "t1:ask-child" })
		expect(controller.pendingApprovalCount).toBe(2) // two cards, no double card
		controller.confirmApproval()
		expect(await parent).toBe("allowed-once")
		expect(controller.pendingApproval?.eventId).toBe("t1:ask-child")
		expect(controller.pendingApproval?.escalation).toBe(true)
		controller.confirmApproval()
		expect(await child).toBe("allowed-once")
		expect(controller.pendingApprovalCount).toBe(0)
	})

	test("a mismatching eventId is a strong no-match, never a fuzzy fallback", async () => {
		const seam = bridgeLike([ask({ eventId: "t1:ask-parent", callId: "c-p", escalation: true })])
		const controller = new TurnOverlayController()
		registerTurnOverlays(seam, controller)
		const pending = controller.requestApproval("bash", { callId: "c-p", eventId: "t1:ask-gone" })
		expect(controller.pendingApproval?.eventId).toBeUndefined()
		expect(controller.pendingApproval?.escalation).toBe(false)
		controller.rejectApproval()
		expect(await pending).toBe("rejected")
	})

	test("sync closes only the cancelled child card; the parent card stays (no double card)", async () => {
		const seam = bridgeLike([
			ask({ eventId: "t1:ask-parent", callId: "c-p" }),
			ask({ eventId: "t1:ask-child", callId: "c-c", parentSessionId: "s1", childSessionId: "child-1" }),
		])
		const controller = new TurnOverlayController()
		registerTurnOverlays(seam, controller)
		const parent = controller.requestApproval("bash", { callId: "c-p" })
		const child = controller.requestApproval("bash", { callId: "c-c", eventId: "t1:ask-child" })
		expect(controller.pendingApprovalCount).toBe(2)

		// Host settles/cancels ONLY the child ask; the parent card must survive.
		seam.setAsks([ask({ eventId: "t1:ask-parent", callId: "c-p" })])
		controller.syncPendingAsks()
		expect(await child).toBe("rejected")
		expect(controller.pendingApprovalCount).toBe(1)
		expect(controller.pendingApproval?.eventId).toBe("t1:ask-parent")
		controller.confirmApproval()
		expect(await parent).toBe("allowed-once")
		expect(controller.pendingApprovalCount).toBe(0)
	})
})
