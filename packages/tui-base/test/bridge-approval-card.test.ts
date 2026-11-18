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
