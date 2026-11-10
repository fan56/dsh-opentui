/**
 * Busy-submit delivery choice + client-side queue (steer/queue batch).
 *
 * The controller is the decision core: the view's dialog supplies the
 * steer/queue answer, the controller owns ordering, the one-at-a-time pump and
 * the transcript delivery lines. No renderer is mounted here.
 */
import { describe, expect, test } from "bun:test"
import {
	ComposerController,
	type ComposerDelivery,
	type ComposerPendingRow,
	type ComposerQueuePause,
} from "../src/routes/session/composer-state"
import { DELIVERY_OPTIONS, openDeliveryChoice } from "../src/routes/session/delivery-choice"

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

function setup(options: {
	choice?: () => Promise<ComposerDelivery | undefined>
	aborted?: () => boolean
	onQueuePaused?: (info: ComposerQueuePause) => void
} = {}) {
	const sent: string[] = []
	const steered: string[] = []
	const turns: ReturnType<typeof deferred>[] = []
	const pendingSnapshots: (readonly ComposerPendingRow[])[] = []
	const controller = new ComposerController({
		send: (text) => {
			sent.push(text)
			const turn = deferred()
			turns.push(turn)
			return turn.promise
		},
		steer: (text) => steered.push(text),
		chooseDelivery: options.choice ?? (async () => "steer"),
		onPendingChange: (rows) => pendingSnapshots.push(rows.map((row) => ({ ...row }))),
		onQueuePaused: options.onQueuePaused,
		isTurnAborted: options.aborted,
	})
	return { controller, sent, steered, turns, pendingSnapshots }
}

describe("busy submit asks steer vs queue", () => {
	test("the choice is asked once for a non-empty busy submit; Steer injects", async () => {
		let asked = 0
		const { controller, sent, steered } = setup({
			choice: async () => {
				asked += 1
				return "steer"
			},
		})
		controller.submit("first")
		expect(await controller.submitWhileBusy("  keep it short  ")).toBe("steered")
		expect(asked).toBe(1)
		expect(sent).toEqual(["first"])
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
		const { controller, sent, turns } = setup({ choice: async () => "queue" })
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
		turns[3]!.resolve()
		await flush()
		expect(controller.busy).toBe(false)
		expect(controller.queued).toBe(0)
	})
})

describe("failure/abort policy: keep the queue, pause the pump", () => {
	test("a failed turn keeps the queue paused and notifies", async () => {
		const pauses: ComposerQueuePause[] = []
		const { controller, sent, turns } = setup({
			choice: async () => "queue",
			onQueuePaused: (info) => pauses.push(info),
		})
		controller.submit("boom")
		await controller.submitWhileBusy("keep me")
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

describe("session switch", () => {
	test("resetDeliveries drops the queue and every receipt", async () => {
		const { controller, turns } = setup({ choice: async () => "queue" })
		controller.submit("first")
		await controller.submitWhileBusy("q1")
		controller.submit("s1") // busy → steer receipt row
		expect(controller.pending).toHaveLength(2)
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
		expect(DELIVERY_OPTIONS.map((option) => option.value)).toEqual(["steer", "queue"])
		expect(DELIVERY_OPTIONS[0]?.title).toBe("Steer")
		expect(DELIVERY_OPTIONS[1]?.title).toBe("Queue")
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
