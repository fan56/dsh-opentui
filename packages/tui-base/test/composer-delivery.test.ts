/**
 * Busy-submit delivery choice + client-side queue (steer/queue batch).
 *
 * The controller is the decision core: the view's dialog supplies the
 * steer/queue answer, the controller owns ordering, the one-at-a-time pump and
 * the transcript delivery lines. No renderer is mounted here.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import {
	ComposerController,
	TurnOutcomeTracker,
	isAbortTurnCode,
	type ComposerControllerOptions,
	type ComposerDelivery,
	type ComposerPendingRow,
	type ComposerQueuePause,
} from "../src/routes/session/composer-state"
import { deliveryOptions, openDeliveryChoice } from "../src/routes/session/delivery-choice"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"

function deferred() {
	let resolve!: () => void
	let reject!: (error: unknown) => void
	const promise = new Promise<void>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// The delivery-choice copy resolves through `t()` (T7 facet migration): boot
// the bundled registry so the en-literal assertions stay hermetic in isolation.
beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})

function setup(options: {
	choice?: (text: string) => Promise<ComposerDelivery | undefined>
	aborted?: () => boolean
	failed?: () => boolean
	onQueuePaused?: (info: ComposerQueuePause) => void
	steer?: ComposerControllerOptions["steer"]
	onSteerRejected?: ComposerControllerOptions["onSteerRejected"]
} = {}) {
	const sent: string[] = []
	const sources: string[] = []
	const steered: string[] = []
	const turns: ReturnType<typeof deferred>[] = []
	const pendingSnapshots: (readonly ComposerPendingRow[])[] = []
	// Wrap every seam call so `steered` records the attempt regardless of the
	// outcome (accept, explicit refusal, or a legacy void seam).
	const steerResult = options.steer ?? (async (_text: string) => ({ accepted: true as const, turnId: "t-test" }))
	const controller = new ComposerController({
		send: (text, source) => {
			sent.push(text)
			sources.push(source ?? "user")
			const turn = deferred()
			turns.push(turn)
			return turn.promise
		},
		steer: async (text) => {
			steered.push(text)
			return steerResult(text)
		},
		chooseDelivery: options.choice ?? (async () => "steer"),
		onPendingChange: (rows) => pendingSnapshots.push(rows.map((row) => ({ ...row }))),
		onQueuePaused: options.onQueuePaused,
		isTurnAborted: options.aborted,
		isTurnFailed: options.failed,
		onSteerRejected: options.onSteerRejected,
	})
	return { controller, sent, sources, steered, turns, pendingSnapshots }
}

describe("isAbortTurnCode (turn.error code → abort vs failure)", () => {
	test("ABORTED / SESSION_CLOSED are aborts", () => {
		expect(isAbortTurnCode("ABORTED")).toBe(true)
		expect(isAbortTurnCode("SESSION_CLOSED")).toBe(true)
	})

	test("every terminal stop code is an abort, not just close/abort", () => {
		for (const code of ["ABORTED", "SESSION_CLOSED", "FORKED", "INTERRUPTED", "TURN_ABORT_NOOP"]) {
			expect(isAbortTurnCode(code)).toBe(true)
		}
	})

	test("a genuine error code and a missing code are NOT aborts", () => {
		expect(isAbortTurnCode("INTERNAL")).toBe(false)
		expect(isAbortTurnCode(undefined)).toBe(false)
		// empty/other codes stay failures — only the terminal stop codes are aborts
		expect(isAbortTurnCode("")).toBe(false)
		expect(isAbortTurnCode("BLOCKED")).toBe(false)
	})

	test("USER_ABORT is an abort (an explicit user cancel, not a genuine failure)", () => {
		expect(isAbortTurnCode("USER_ABORT")).toBe(true)
	})
})

describe("TurnOutcomeTracker (turn-scoped seam event → failed / aborted)", () => {
	/** The bridge projects `turn.start` to a starting notice carrying the turn id. */
	const arm = (tracker: TurnOutcomeTracker, turnId: string) => {
		tracker.onEvent({ type: "session.updated", details: { turnId, turn: "starting" } })
	}

	test("beginTurn → session.updated starting → session.error with the same turn id is failed", () => {
		const tracker = new TurnOutcomeTracker()
		tracker.beginTurn()
		arm(tracker, "turn-1")
		tracker.onEvent({
			type: "session.error",
			details: { turnId: "turn-1", code: "INTERNAL", message: "boom" },
		})
		expect(tracker.isFailed()).toBe(true)
		expect(tracker.isAborted()).toBe(false)
	})

	test("ABORTED / SESSION_CLOSED / FORKED / INTERRUPTED / TURN_ABORT_NOOP are aborted, never failed", () => {
		for (const code of ["ABORTED", "SESSION_CLOSED", "FORKED", "INTERRUPTED", "TURN_ABORT_NOOP"]) {
			const tracker = new TurnOutcomeTracker()
			tracker.beginTurn()
			arm(tracker, `turn-${code}`)
			tracker.onEvent({ type: "session.error", details: { turnId: `turn-${code}`, code } })
			expect(tracker.isAborted()).toBe(true)
			expect(tracker.isFailed()).toBe(false)
		}
		// A non-terminal code on the armed turn is still a genuine failure.
		const genuine = new TurnOutcomeTracker()
		genuine.beginTurn()
		arm(genuine, "turn-internal")
		genuine.onEvent({ type: "session.error", details: { turnId: "turn-internal", code: "BLOCKED" } })
		expect(genuine.isFailed()).toBe(true)
		expect(genuine.isAborted()).toBe(false)
	})

	test("a stale turn id or an empty/missing turn id never poisons the armed turn", () => {
		const tracker = new TurnOutcomeTracker()
		tracker.beginTurn()
		arm(tracker, "current")
		tracker.onEvent({ type: "session.error", details: { turnId: "old-turn", code: "INTERNAL" } })
		tracker.onEvent({ type: "session.error", details: { turnId: "", code: "ABORTED" } })
		tracker.onEvent({ type: "session.error", details: { code: "FORKED" } })
		expect(tracker.isFailed()).toBe(false)
		expect(tracker.isAborted()).toBe(false)
		// The armed turn can still be classified by its own matching error.
		tracker.onEvent({ type: "session.error", details: { turnId: "current", code: "INTERNAL" } })
		expect(tracker.isFailed()).toBe(true)
	})

	test("an empty starting turn id does not arm a turn id", () => {
		const tracker = new TurnOutcomeTracker()
		tracker.beginTurn()
		tracker.onEvent({ type: "session.updated", details: { turnId: "", turn: "starting" } })
		tracker.onEvent({ type: "session.error", details: { turnId: "", code: "INTERNAL" } })
		expect(tracker.isFailed()).toBe(false)
		expect(tracker.isAborted()).toBe(false)
	})

	test("beginTurn clears the outcome and disarms the previous turn id", () => {
		const tracker = new TurnOutcomeTracker()
		tracker.beginTurn()
		arm(tracker, "turn-1")
		tracker.onEvent({ type: "session.error", details: { turnId: "turn-1", code: "INTERNAL" } })
		expect(tracker.isFailed()).toBe(true)

		tracker.beginTurn()
		expect(tracker.isFailed()).toBe(false)
		expect(tracker.isAborted()).toBe(false)
		// A late error from the previous turn cannot classify the new one.
		tracker.onEvent({ type: "session.error", details: { turnId: "turn-1", code: "ABORTED" } })
		expect(tracker.isAborted()).toBe(false)
		// The new turn still classifies its own error.
		arm(tracker, "turn-2")
		tracker.onEvent({ type: "session.error", details: { turnId: "turn-2", code: "INTERNAL" } })
		expect(tracker.isFailed()).toBe(true)
	})

	test("bridge.turn.interrupted on the armed turn is aborted", () => {
		const tracker = new TurnOutcomeTracker()
		tracker.beginTurn()
		arm(tracker, "turn-1")
		tracker.onEvent({
			type: "bridge.turn.interrupted",
			details: { turnId: "turn-1", code: "INTERRUPTED", reason: "connection lost" },
		})
		expect(tracker.isAborted()).toBe(true)
		expect(tracker.isFailed()).toBe(false)

		// A different turn's interruption does not classify this one.
		const other = new TurnOutcomeTracker()
		other.beginTurn()
		arm(other, "current")
		other.onEvent({ type: "bridge.turn.interrupted", details: { turnId: "old-turn" } })
		expect(other.isAborted()).toBe(false)
	})

	test("USER_ABORT on the armed turn is aborted, never failed", () => {
		// The bridge reports a user cancel as `turn.error{code:"USER_ABORT"}` —
		// relayed live as session.error, and from the journal as a
		// bridge.turn.terminal{terminalType:"turn/error"}. Both classify abort.
		const viaError = new TurnOutcomeTracker()
		viaError.beginTurn()
		arm(viaError, "turn-user-abort")
		viaError.onEvent({ type: "session.error", details: { turnId: "turn-user-abort", code: "USER_ABORT" } })
		expect(viaError.isAborted()).toBe(true)
		expect(viaError.isFailed()).toBe(false)

		const viaJournal = new TurnOutcomeTracker()
		viaJournal.beginTurn()
		arm(viaJournal, "turn-user-abort")
		viaJournal.onEvent({
			type: "bridge.turn.terminal",
			details: {
				turnId: "turn-user-abort",
				terminalType: "turn/error",
				reason: { kind: "aborted", code: "USER_ABORT" },
				source: "journal",
			},
		})
		expect(viaJournal.isAborted()).toBe(true)
		expect(viaJournal.isFailed()).toBe(false)
	})

	test("bridge.turn.terminal turn/error on the armed turn is failed", () => {
		const tracker = new TurnOutcomeTracker()
		tracker.beginTurn()
		arm(tracker, "turn-journal")
		tracker.onEvent({
			type: "bridge.turn.terminal",
			details: {
				sessionID: "s-1",
				turnId: "turn-journal",
				seq: 12,
				terminalType: "turn/error",
				reason: { kind: "error", code: "INTERNAL", message: "boom" },
				payload: { reason: { kind: "error", code: "INTERNAL" } },
				source: "journal",
			},
		})
		expect(tracker.isFailed()).toBe(true)
		expect(tracker.isAborted()).toBe(false)
	})

	test("a stale turn id bridge.turn.terminal never classifies the armed turn", () => {
		const tracker = new TurnOutcomeTracker()
		tracker.beginTurn()
		arm(tracker, "current")
		tracker.onEvent({
			type: "bridge.turn.terminal",
			details: { turnId: "old-turn", terminalType: "turn/error", reason: { code: "INTERNAL" } },
		})
		expect(tracker.isFailed()).toBe(false)
		expect(tracker.isAborted()).toBe(false)
		// A matching error still classifies this turn.
		tracker.onEvent({
			type: "bridge.turn.terminal",
			details: { turnId: "current", terminalType: "turn/error", reason: { code: "INTERNAL" } },
		})
		expect(tracker.isFailed()).toBe(true)
	})

	test("bridge.turn.terminal turn/end is a clean settle, not a failure", () => {
		const tracker = new TurnOutcomeTracker()
		tracker.beginTurn()
		arm(tracker, "turn-clean")
		tracker.onEvent({
			type: "bridge.turn.terminal",
			details: {
				turnId: "turn-clean",
				terminalType: "turn/end",
				reason: { kind: "completed" },
				source: "journal",
			},
		})
		expect(tracker.isFailed()).toBe(false)
		expect(tracker.isAborted()).toBe(false)
	})
})

describe("busy submit asks steer vs queue", () => {
	test("the choice is asked once for a non-empty busy submit; Steer injects", async () => {
		let asked = 0
		const { controller, sent, sources, steered } = setup({
			choice: async () => {
				asked += 1
				return "steer"
			},
		})
		controller.submit("first")
		expect(await controller.submitWhileBusy("  keep it short  ")).toBe("steered")
		expect(asked).toBe(1)
		expect(sent).toEqual(["first"])
		expect(sources).toEqual(["user"]) // idle Enter is a user submit
		expect(steered).toEqual(["keep it short"])
		expect(controller.pending).toEqual([
			{ id: 1, kind: "steer", state: "injected", text: "keep it short" },
		])
	})

	test("empty/blank busy input never opens the choice", async () => {
		let asked = 0
		const { controller } = setup({
			choice: async () => {
				asked += 1
				return "queue"
			},
		})
		controller.submit("first")
		expect(await controller.submitWhileBusy("   ")).toBe("ignored")
		expect(asked).toBe(0)
	})

	test("Esc (undefined) cancels: no send/steer, no history entry", async () => {
		const { controller, sent, steered } = setup({ choice: async () => undefined })
		controller.submit("first")
		expect(await controller.submitWhileBusy("draft stays")).toBe("cancelled")
		expect(sent).toEqual(["first"])
		expect(steered).toEqual([])
		expect(controller.pending).toEqual([])
		expect(controller.history.move(-1, "")?.text).toBe("first")
	})

	test("the turn may settle while the popup is open: the answer starts a normal turn", async () => {
		const gate = deferred()
		const { controller, sent, steered, turns } = setup({
			choice: () => gate.promise.then(() => "steer" as const),
		})
		controller.submit("first")
		const submitting = controller.submitWhileBusy("late")
		// The running turn settles before the popup answer lands.
		turns[0]!.resolve()
		await flush()
		gate.resolve()
		// Steering a settled turn would be dropped by the host: the answer
		// becomes a fresh turn instead.
		expect(await submitting).toBe("sent")
		expect(sent).toEqual(["first", "late"])
		expect(steered).toEqual([])
	})

	test("Steer receipt flips to delivered when the turn settles", async () => {
		const { controller, turns } = setup({ choice: async () => "steer" })
		controller.submit("first")
		await controller.submitWhileBusy("steer me")
		expect(controller.pending[0]?.state).toBe("injected")
		turns[0]!.resolve()
		await flush()
		expect(controller.pending).toEqual([
			{ id: 1, kind: "steer", state: "delivered", text: "steer me" },
		])
	})

	test("a failed turn leaves an accepted steer row injected (no false delivered receipt)", async () => {
		let failed = false
		const { controller, turns, pendingSnapshots } = setup({
			choice: async () => "steer",
			failed: () => failed,
		})
		controller.submit("boom")
		await controller.submitWhileBusy("steer me")
		expect(controller.pending).toEqual([
			{ id: 1, kind: "steer", state: "injected", text: "steer me" },
		])
		// A turn-scoped session.error lands DURING the turn, but the seam still
		// resolves `send` normally. The page-owned flag is the only failure
		// signal: a resolved turn must NOT flip the accepted steer to delivered.
		failed = true
		turns[0]!.resolve()
		await flush()
		expect(controller.busy).toBe(false)
		expect(controller.pending).toEqual([
			{ id: 1, kind: "steer", state: "injected", text: "steer me" },
		])
		expect(pendingSnapshots.some((rows) => rows.some((row) => row.state === "delivered"))).toBe(false)
	})

	test("an aborted turn also leaves an accepted steer row injected", async () => {
		let aborted = false
		const { controller, turns, pendingSnapshots } = setup({
			choice: async () => "steer",
			aborted: () => aborted,
		})
		controller.submit("running")
		await controller.submitWhileBusy("steer me")
		aborted = true
		turns[0]!.resolve()
		await flush()
		expect(controller.pending).toEqual([
			{ id: 1, kind: "steer", state: "injected", text: "steer me" },
		])
		expect(pendingSnapshots.some((rows) => rows.some((row) => row.state === "delivered"))).toBe(false)
	})
})

describe("steer receipts are turn-scoped", () => {
	test("a steer injected in a failed turn stays injected when the next turn ends successfully", async () => {
		let failed = false
		const { controller, turns, pendingSnapshots } = setup({
			choice: async () => "steer",
			failed: () => failed,
		})
		controller.submit("boom")
		await controller.submitWhileBusy("lost steer")
		expect(controller.pending).toEqual([
			{ id: 1, kind: "steer", state: "injected", text: "lost steer" },
		])

		// The seam still resolves on failure; the page's flag classifies it.
		failed = true
		turns[0]!.resolve()
		await flush()
		expect(controller.pending[0]?.state).toBe("injected")

		// A clean later turn must not promote the earlier turn's row.
		failed = false
		controller.submit("ok")
		turns[1]!.resolve()
		await flush()
		expect(controller.pending).toEqual([
			{ id: 1, kind: "steer", state: "injected", text: "lost steer" },
		])
		expect(
			pendingSnapshots.some((rows) =>
				rows.some((row) => row.text === "lost steer" && row.state === "delivered"),
			),
		).toBe(false)
	})

	test("a successful turn still delivers its own steer, never an older injected one", async () => {
		let failed = false
		const { controller, turns, pendingSnapshots } = setup({
			choice: async () => "steer",
			failed: () => failed,
		})
		controller.submit("boom")
		await controller.submitWhileBusy("lost steer")
		failed = true
		turns[0]!.resolve()
		await flush()

		failed = false
		controller.submit("ok")
		await controller.submitWhileBusy("good steer")
		turns[1]!.resolve()
		await flush()
		expect(controller.pending).toEqual([
			{ id: 1, kind: "steer", state: "injected", text: "lost steer" },
			{ id: 2, kind: "steer", state: "delivered", text: "good steer" },
		])
		expect(
			pendingSnapshots.some((rows) =>
				rows.some((row) => row.text === "lost steer" && row.state === "delivered"),
			),
		).toBe(false)
	})
})

describe("queue: one line per turn end, submission order", () => {
	test("Queue paints a numbered wait row and sends only after the turn ends", async () => {
		const { controller, sent, turns } = setup({ choice: async () => "queue" })
		controller.submit("first")
		expect(await controller.submitWhileBusy("second")).toBe("queued")
		expect(sent).toEqual(["first"])
		expect(controller.pending).toEqual([
			{ id: 1, kind: "queue", state: "queued", text: "second", order: 1 },
		])
		expect(controller.queued).toBe(1)

		turns[0]!.resolve()
		await flush()
		// The queued line started: its wait row is gone (the projection paints
		// the real user message) and busy never flashed idle.
		expect(sent).toEqual(["first", "second"])
		expect(controller.pending).toEqual([])
		expect(controller.busy).toBe(true)

		turns[1]!.resolve()
		await flush()
		expect(controller.busy).toBe(false)
	})

	test("multiple queues send one at a time in submission order", async () => {
		const { controller, sent, sources, turns } = setup({ choice: async () => "queue" })
		controller.submit("turn0")
		await controller.submitWhileBusy("q1")
		await controller.submitWhileBusy("q2")
		await controller.submitWhileBusy("q3")
		expect(controller.pending.map((row) => [row.text, row.order])).toEqual([
			["q1", 1],
			["q2", 2],
			["q3", 3],
		])
		turns[0]!.resolve()
		await flush()
		expect(sent).toEqual(["turn0", "q1"])
		expect(controller.pending.map((row) => [row.text, row.order])).toEqual([
			["q2", 1],
			["q3", 2],
		])
		turns[1]!.resolve()
		await flush()
		expect(sent).toEqual(["turn0", "q1", "q2"])
		turns[2]!.resolve()
		await flush()
		expect(sent).toEqual(["turn0", "q1", "q2", "q3"])
		// Only the first turn is user-sourced; every pumped queue line is queue.
		expect(sources).toEqual(["user", "queue", "queue", "queue"])
		turns[3]!.resolve()
		await flush()
		expect(controller.busy).toBe(false)
		expect(controller.queued).toBe(0)
	})
})

describe("failure/abort policy: keep the queue, pause the pump", () => {
	test("a session.error turn keeps the queue paused and notifies with reason failed", async () => {
		let failed = false
		const pauses: ComposerQueuePause[] = []
		const { controller, sent, turns } = setup({
			choice: async () => "queue",
			failed: () => failed,
			onQueuePaused: (info) => pauses.push(info),
		})
		controller.submit("boom")
		await controller.submitWhileBusy("keep me")
		// The seam resolves on a failed turn (no send rejection); the page's
		// turn-scoped session.error flag is what classifies it as failed.
		failed = true
		turns[0]!.resolve()
		await flush()
		expect(sent).toEqual(["boom"])
		expect(controller.busy).toBe(false)
		expect(pauses).toEqual([{ remaining: 1, reason: "failed" }])
		expect(controller.pending).toEqual([
			{ id: 1, kind: "queue", state: "paused", text: "keep me", order: 1 },
		])
	})

	test("a rejected send still pauses the queue as failed (back-compat)", async () => {
		const pauses: ComposerQueuePause[] = []
		const { controller, sent, turns } = setup({
			choice: async () => "queue",
			onQueuePaused: (info) => pauses.push(info),
		})
		controller.submit("boom")
		await controller.submitWhileBusy("keep me")
		// Legacy seam: the turn itself rejects and no page flag is set.
		turns[0]!.reject(new Error("failed"))
		await flush()
		expect(sent).toEqual(["boom"])
		expect(controller.busy).toBe(false)
		expect(pauses).toEqual([{ remaining: 1, reason: "failed" }])
		expect(controller.pending).toEqual([
			{ id: 1, kind: "queue", state: "paused", text: "keep me", order: 1 },
		])
	})

	test("abort (resolved turn + flag) also keeps the queue paused", async () => {
		let aborted = false
		const pauses: ComposerQueuePause[] = []
		const { controller, sent, turns } = setup({
			choice: async () => "queue",
			aborted: () => aborted,
			onQueuePaused: (info) => pauses.push(info),
		})
		controller.submit("running")
		await controller.submitWhileBusy("after abort")
		aborted = true
		turns[0]!.resolve()
		await flush()
		expect(sent).toEqual(["running"])
		expect(pauses).toEqual([{ remaining: 1, reason: "aborted" }])
		expect(controller.pending[0]?.state).toBe("paused")
	})

	test("a failed turn keeps an accepted steer injected AND pauses the queue as failed", async () => {
		let failed = false
		const pauses: ComposerQueuePause[] = []
		const { controller, turns, pendingSnapshots } = setup({
			choice: async (text) => (text === "steer me" ? "steer" : "queue"),
			failed: () => failed,
			onQueuePaused: (info) => pauses.push(info),
		})
		controller.submit("boom")
		await controller.submitWhileBusy("steer me")
		await controller.submitWhileBusy("keep me")
		failed = true // turn-scoped session.error; send itself still resolves
		turns[0]!.resolve()
		await flush()
		expect(pauses).toEqual([{ remaining: 1, reason: "failed" }])
		expect(controller.pending).toEqual([
			{ id: 1, kind: "steer", state: "injected", text: "steer me" },
			{ id: 2, kind: "queue", state: "paused", text: "keep me", order: 1 },
		])
		// No snapshot may ever show the accepted steer as delivered.
		expect(pendingSnapshots.some((rows) => rows.some((row) => row.state === "delivered"))).toBe(false)
	})

	test("an aborted turn keeps an accepted steer injected AND pauses the queue as aborted", async () => {
		let aborted = false
		const pauses: ComposerQueuePause[] = []
		const { controller, turns, pendingSnapshots } = setup({
			choice: async (text) => (text === "steer me" ? "steer" : "queue"),
			aborted: () => aborted,
			onQueuePaused: (info) => pauses.push(info),
		})
		controller.submit("running")
		await controller.submitWhileBusy("steer me")
		await controller.submitWhileBusy("after abort")
		aborted = true
		turns[0]!.resolve()
		await flush()
		expect(pauses).toEqual([{ remaining: 1, reason: "aborted" }])
		expect(controller.pending).toEqual([
			{ id: 1, kind: "steer", state: "injected", text: "steer me" },
			{ id: 2, kind: "queue", state: "paused", text: "after abort", order: 1 },
		])
		expect(pendingSnapshots.some((rows) => rows.some((row) => row.state === "delivered"))).toBe(false)
	})

	test("the next successful turn end resumes the kept queue", async () => {
		const { controller, sent, turns } = setup({ choice: async () => "queue" })
		controller.submit("boom")
		await controller.submitWhileBusy("keep me")
		turns[0]!.reject(new Error("failed"))
		await flush()
		expect(controller.queued).toBe(1)

		// The user sends a fresh prompt; its successful end resumes the queue.
		expect(controller.submit("retry")).toBe("sent")
		turns[1]!.resolve()
		await flush()
		expect(sent).toEqual(["boom", "retry", "keep me"])
	})
})

describe("refused steer: keep the draft, paint no receipt", () => {
	test("a rejected steer reports text/reason, writes no history and cancels the submit", async () => {
		const rejected: { text: string; reason: string }[] = []
		const { controller, steered, pendingSnapshots } = setup({
			choice: async () => "steer",
			steer: async () => ({ accepted: false as const, reason: "STEER_ENDED" }),
			onSteerRejected: (info) => rejected.push(info),
		})
		controller.submit("first")
		expect(await controller.submitWhileBusy("draft stays")).toBe("cancelled")
		expect(steered).toEqual(["draft stays"])
		expect(rejected).toEqual([{ text: "draft stays", reason: "STEER_ENDED" }])
		expect(controller.pending).toEqual([])
		expect(pendingSnapshots).toEqual([])
		// Only the idle submit reached history; the refused line did not.
		expect(controller.history.move(-1, "")?.text).toBe("first")
	})

	test("a legacy void steer seam is rejected as INVALID_STEER_RESULT (no fake receipt)", async () => {
		const rejected: { text: string; reason: string }[] = []
		const { controller, pendingSnapshots } = setup({
			choice: async () => "steer",
			steer: (async () => undefined) as never,
			onSteerRejected: (info) => rejected.push(info),
		})
		controller.submit("first")
		expect(await controller.submitWhileBusy("legacy line")).toBe("cancelled")
		expect(rejected).toEqual([{ text: "legacy line", reason: "INVALID_STEER_RESULT" }])
		expect(controller.pending).toEqual([])
		expect(pendingSnapshots).toEqual([])
		expect(controller.history.move(-1, "")?.text).toBe("first")
	})
})

describe("explicit queue flush", () => {
	test("an empty queue flushes nothing (the caller reports the no-op)", () => {
		const { controller, sent } = setup()
		expect(controller.flushQueue()).toEqual({ kind: "empty", started: 0, remaining: 0 })
		expect(sent).toEqual([])
		expect(controller.busy).toBe(false)
	})

	test("a paused queue is delivered immediately, in order", async () => {
		const { controller, sent, turns } = setup({ choice: async () => "queue" })
		controller.submit("boom")
		await controller.submitWhileBusy("q1")
		await controller.submitWhileBusy("q2")
		turns[0]!.reject(new Error("failed"))
		await flush()
		expect(controller.queued).toBe(2)
		expect(controller.busy).toBe(false)

		// The flush restarts the pump: q1 goes out now, q2 follows its turn end.
		expect(controller.flushQueue()).toEqual({ kind: "flushed", started: 1, remaining: 1 })
		expect(sent).toEqual(["boom", "q1"])
		expect(controller.busy).toBe(true)
		expect(controller.queued).toBe(1)
		// The head's wait row is gone (the projection paints the real message);
		// the rest are queued again, not paused.
		expect(controller.pending).toEqual([
			{ id: 2, kind: "queue", state: "queued", text: "q2", order: 1 },
		])

		turns[1]!.resolve()
		await flush()
		expect(sent).toEqual(["boom", "q1", "q2"])
		expect(controller.queued).toBe(0)
	})

	test("a flush during a running turn leaves the queue alone (it drains at the turn end)", async () => {
		const { controller, sent, turns } = setup({ choice: async () => "queue" })
		controller.submit("running")
		await controller.submitWhileBusy("q1")
		expect(controller.flushQueue()).toEqual({ kind: "busy", started: 0, remaining: 1 })
		expect(sent).toEqual(["running"])
		turns[0]!.resolve()
		await flush()
		expect(sent).toEqual(["running", "q1"])
	})

	test("a flushed turn that fails pauses the rest again", async () => {
		const { controller, sent, turns } = setup({ choice: async () => "queue" })
		controller.submit("boom")
		await controller.submitWhileBusy("q1")
		turns[0]!.reject(new Error("failed"))
		await flush()

		expect(controller.flushQueue().kind).toBe("flushed")
		turns[1]!.reject(new Error("failed again"))
		await flush()
		expect(sent).toEqual(["boom", "q1"])
		expect(controller.queued).toBe(0)
		expect(controller.pending).toEqual([])
	})

	test("flush head is a user submit; the line it releases stays queue-sourced", async () => {
		const { controller, sent, sources, turns } = setup({ choice: async () => "queue" })
		controller.submit("boom")
		await controller.submitWhileBusy("q1")
		await controller.submitWhileBusy("q2")
		turns[0]!.reject(new Error("failed"))
		await flush()

		expect(controller.flushQueue()).toEqual({ kind: "flushed", started: 1, remaining: 1 })
		await flush()
		expect(sent).toEqual(["boom", "q1"])
		// /flush deliberately hand-starts the head like a user submit. q2 has
		// NOT started yet: its queue pump needs q1 to settle first.
		expect(sources).toEqual(["user", "user"])
		turns[1]!.resolve()
		await flush()
		expect(sent).toEqual(["boom", "q1", "q2"])
		// The released q2 is queue-sourced, unlike the flush head above.
		expect(sources).toEqual(["user", "user", "queue"])
	})
})

describe("session switch", () => {
	test("resetDeliveries drops the queue and every receipt", async () => {
		const { controller, turns } = setup({ choice: async () => "queue" })
		controller.submit("first")
		await controller.submitWhileBusy("q1")
		controller.submit("s1") // busy → steer; the receipt lands only on acceptance
		await flush()
		expect(controller.pending).toHaveLength(2) // queue row + accepted steer receipt
		controller.resetDeliveries()
		expect(controller.pending).toEqual([])
		expect(controller.queued).toBe(0)
		turns[0]!.resolve()
		await flush()
		// The cleared queue must not fire after the switch.
		expect(controller.busy).toBe(false)
	})

	test("a popup answer landing after a session switch is discarded", async () => {
		let release: ((value: "queue") => void) | undefined
		const gate = new Promise<"queue">((resolve) => (release = resolve))
		const { controller, sent } = setup({ choice: () => gate })
		controller.submit("first")
		const submitting = controller.submitWhileBusy("late")
		controller.resetDeliveries()
		release?.("queue")
		expect(await submitting).toBe("cancelled")
		expect(sent).toEqual(["first"])
		expect(controller.pending).toEqual([])
	})
})

describe("dialog options", () => {
	test("Steer is first (the default highlight) and Queue second", () => {
		const options = deliveryOptions()
		expect(options.map((option) => option.value)).toEqual(["steer", "queue"])
		expect(options[0]?.title).toBe("Steer")
		expect(options[1]?.title).toBe("Queue")
	})

	test("an already-open dialog suppresses the popup (vendored steer, no stacking)", async () => {
		let replaced = 0
		const dialog = {
			stack: [{ element: () => undefined }],
			clear: () => {},
			replace: () => {
				replaced += 1
			},
		}
		expect(await openDeliveryChoice(dialog as never, "hello")).toBe("steer")
		expect(replaced).toBe(0)
	})
})
