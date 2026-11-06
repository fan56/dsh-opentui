/**
 * /btw overlay (feature batch F3): controller state machine + opener
 * open/close routing over a fake dialog stack. Renderer-free.
 */
import { describe, expect, test } from "bun:test"
import {
	BtwController,
	createBtwOpener,
	createBtwSnapshotBuilder,
	type BtwAskFn,
	type BtwDialogHost,
} from "../src/routes/session/btw-overlay"

/** Manually-settled ask: each call parks until the test resolves it. */
function deferredAsk() {
	const calls: { question: string; snapshot: string[]; onDelta: (full: string) => void; resolve: (a: string) => void; reject: (e: Error) => void }[] = []
	const ask: BtwAskFn = (question, snapshot, onDelta) =>
		new Promise<string>((resolve, reject) => calls.push({ question, snapshot, onDelta, resolve, reject }))
	return { ask, calls }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

function fakeDialog() {
	const log: string[] = []
	let onClose: (() => void) | undefined
	const dialog: BtwDialogHost = {
		replace(_input, close) {
			log.push("replace")
			onClose = close
		},
		clear() {
			log.push("clear")
		},
	}
	return { dialog, log, esc: () => onClose?.() }
}

describe("BtwController", () => {
	test("submit starts a run that streams deltas and settles into the last slot", async () => {
		const fake = deferredAsk()
		const btw = new BtwController({ ask: fake.ask, snapshot: async () => ["user: hi"] })
		expect(btw.submit("q1")).toBe("started")
		await tick()
		expect(fake.calls[0]!.question).toBe("q1")
		expect(fake.calls[0]!.snapshot).toEqual(["user: hi"])
		fake.calls[0]!.onDelta("par")
		expect(btw.run()).toEqual({ question: "q1", answer: "par", status: "streaming" })
		expect(btw.busy).toBe(true)
		fake.calls[0]!.resolve("partial answer")
		await tick()
		expect(btw.run()).toBeUndefined()
		expect(btw.last()).toEqual({ question: "q1", answer: "partial answer", status: "settled" })
		expect(btw.busy).toBe(false)
	})

	test("a submit during a live run queues (bounded) and runs after settle", async () => {
		const fake = deferredAsk()
		const btw = new BtwController({ ask: fake.ask, snapshot: async () => [], capacity: 1 })
		btw.submit("q1")
		expect(btw.submit("q2")).toBe("queued")
		expect(btw.submit("q3")).toBe("full")
		expect(btw.queueDepth()).toBe(1)
		await tick()
		fake.calls[0]!.resolve("a1")
		await tick()
		await tick()
		expect(btw.queueDepth()).toBe(0)
		expect(btw.run()?.question).toBe("q2")
		expect(fake.calls.map((c) => c.question)).toEqual(["q1", "q2"])
	})

	test("error text and rejections settle as status error", async () => {
		const fake = deferredAsk()
		const btw = new BtwController({ ask: fake.ask, snapshot: async () => [] })
		btw.submit("q1")
		await tick()
		fake.calls[0]!.resolve("error: boom")
		await tick()
		expect(btw.last()?.status).toBe("error")
		btw.submit("q2")
		await tick()
		fake.calls[1]!.reject(new Error("service down"))
		await tick()
		expect(btw.last()).toEqual({ question: "q2", answer: "error: service down", status: "error" })
	})

	test("close hides the overlay but never stops the run", async () => {
		const fake = deferredAsk()
		const btw = new BtwController({ ask: fake.ask, snapshot: async () => [] })
		btw.submit("q1")
		btw.markVisible()
		btw.close()
		expect(btw.visible()).toBe(false)
		expect(btw.run()?.status).toBe("streaming")
		await tick()
		fake.calls[0]!.resolve("still delivered")
		await tick()
		expect(btw.last()?.answer).toBe("still delivered")
	})
})

describe("createBtwOpener", () => {
	test("argument form submits and shows the panel; Esc closes via the stack", async () => {
		const fake = deferredAsk()
		const btw = new BtwController({ ask: fake.ask, snapshot: async () => [] })
		const d = fakeDialog()
		const open = createBtwOpener({ controller: btw, dialog: d.dialog })
		expect(open("why?")).toBe("started")
		expect(d.log).toEqual(["replace"])
		expect(btw.visible()).toBe(true)
		d.esc()
		expect(btw.visible()).toBe(false)
		expect(btw.run()?.status).toBe("streaming")
	})

	test("bare form opens the input prompt without a prior answer, review with one", async () => {
		const fake = deferredAsk()
		const btw = new BtwController({ ask: fake.ask, snapshot: async () => [] })
		const d = fakeDialog()
		const open = createBtwOpener({ controller: btw, dialog: d.dialog })
		expect(open("  ")).toBe("input")
		expect(btw.visible()).toBe(false)
		d.esc()
		expect(fake.calls).toHaveLength(0)
		btw.submit("q1")
		await tick()
		fake.calls[0]!.resolve("a1")
		await tick()
		expect(open("")).toBe("review")
		expect(btw.visible()).toBe(true)
	})

	test("a full queue reports full and opens nothing", () => {
		const fake = deferredAsk()
		const btw = new BtwController({ ask: fake.ask, snapshot: async () => [], capacity: 0 })
		const d = fakeDialog()
		const open = createBtwOpener({ controller: btw, dialog: d.dialog })
		open("q1")
		d.log.length = 0
		expect(open("q2")).toBe("full")
		expect(d.log).toEqual([])
	})
})

describe("createBtwSnapshotBuilder", () => {
	test("takes the recent transcript rows; no session or a failing read → []", async () => {
		const rows = Array.from({ length: 8 }, (_, i) => ({ kind: "user", text: `m${i}` }))
		const build = createBtwSnapshotBuilder({ currentSessionId: () => "s1", storedTranscript: async () => rows })
		expect(await build()).toEqual(["user: m2", "user: m3", "user: m4", "user: m5", "user: m6", "user: m7"])
		expect(await createBtwSnapshotBuilder({ currentSessionId: () => undefined, storedTranscript: async () => rows })()).toEqual([])
		expect(
			await createBtwSnapshotBuilder({
				currentSessionId: () => "s1",
				storedTranscript: async () => {
					throw new Error("x")
				},
			})(),
		).toEqual([])
	})
})
