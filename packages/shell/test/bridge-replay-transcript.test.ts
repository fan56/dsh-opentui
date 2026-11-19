/**
 * P1-2 (oldfox review) — a post-DEAD journal drain must actually APPLY to the
 * transcript, not just report `applied: N`. These tests wire the REAL
 * BridgeSessionSeam → `onSessionEvent` → tui-base's seam-rows projection with
 * fake transport frames (no child process), so the assertions are on the
 * transcript rows a user would see — content, order and absence of duplicates.
 *
 * The four scenarios mirror the review's acceptance list:
 *   a. tail rows journalled after the last live delta become visible;
 *   b. a second DEAD + drain does not duplicate already-painted rows and does
 *      fill rows that landed in the new death window;
 *   c. live + replay rows interleaved stay seq-ordered, with no duplicates;
 *   d. a tool line that landed during the death window is replayed too.
 */
import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { BridgeSessionSeam, type BridgeEventFrame, type BridgeReplayRow } from "../src/client/bridge-session-seam.ts"
import { createSeamRows } from "../../tui-base/src/routes/session/seam-rows.ts"

// ---------------------------------------------------------------------------
// Fake-frame harness
// ---------------------------------------------------------------------------

function assistantRow(seq: number, text: string, messageID = `msg-${seq}`): BridgeReplayRow {
	return { seq, type: "assistant/message", payload: { messageID, text } }
}
function userRow(seq: number, text: string): BridgeReplayRow {
	return {
		seq,
		type: "user/message",
		payload: { messageID: `u-${seq}`, content: [{ type: "text", text }], source: { kind: "user" } },
	}
}
function toolRows(callSeq: number, resultSeq: number, callId: string, name: string, output: string): BridgeReplayRow[] {
	return [
		{ seq: callSeq, type: "tool/call", payload: { callId, name, arguments: "{}" } },
		{ seq: resultSeq, type: "tool/result", payload: { callId, output } },
	]
}

function makeHarness(sessionId = "sess-1") {
	const frameListeners: ((frame: BridgeEventFrame) => void)[] = []
	const seamEvents: { type: string; details: unknown }[] = []
	const requests: { method: string; params?: Record<string, unknown> }[] = []
	let journal: BridgeReplayRow[] = []
	let turnSeq = 0

	const transport = {
		async request(method: string, params?: Record<string, unknown>) {
			requests.push({ method, params })
			if (method === "session.open") return { sessionId: params?.id ?? sessionId }
			if (method === "session.send") {
				turnSeq += 1
				return { turnId: `turn-${turnSeq}` }
			}
			if (method === "journal.replay") {
				// Recovery drain sends `from`; seam-rows' storedTranscript() does not.
				const from = (params as { from?: number } | undefined)?.from
				const rows = from === undefined ? journal : journal.filter((r) => r.seq >= from)
				const cursor = (journal[journal.length - 1]?.seq ?? 0) + 1
				return { rows, cursor }
			}
			return {}
		},
		onEvent(listener: (frame: BridgeEventFrame) => void) {
			frameListeners.push(listener)
			return () => {
				const i = frameListeners.indexOf(listener)
				if (i >= 0) frameListeners.splice(i, 1)
			}
		},
		async recover() {},
	}
	const logger = { info() {}, warn() {}, error() {} }
	const seam = new BridgeSessionSeam({ transport, ctx: { logger } })
	seam.onSessionEvent((event) => seamEvents.push(event as { type: string; details: unknown }))

	let boundId = sessionId
	const projection = createRoot(() =>
		createSeamRows(seam, () => boundId, { thinkFadeMs: 0, toolFadeMs: 0 }),
	)

	const texts = () => projection.rows
		.filter((r): r is { key: string; kind: "assistant"; text: string; final: boolean } => r.kind === "assistant")
		.map((r) => r.text)
	const rowTexts = () => projection.rows.map((r) =>
		r.kind === "tool" ? `tool:${r.name}` : "text" in r ? r.text : r.kind,
	)

	return {
		seam,
		projection,
		seamEvents,
		requests,
		setJournal: (rows: BridgeReplayRow[]) => { journal = rows },
		emitFrame(type: string, payload: unknown) {
			for (const l of [...frameListeners]) l({ type, payload })
		},
		/** Drive a live turn until it is killed mid-stream (turn() left pending). */
		async crashMidTurn(prompt: string, partial: string): Promise<void> {
			void projection.send(prompt)
			await Bun.sleep(0) // session.send resolves, callbacks installed
			this.emitFrame("turn.start", { turnId: `turn-${turnSeq}`, sessionId })
			this.emitFrame("turn.token", { turnId: `turn-${turnSeq}`, kind: "text", text: partial })
			this.emitFrame("bridge.dead", { stage: "runtime", code: 1, signal: null, message: "killed" })
			await Bun.sleep(0) // dead settles turn(), seam-rows .finally() runs
		},
		async recover(): Promise<void> {
			await seam.recoverSession()
			await Bun.sleep(0) // let the projection consume the replayed events
		},
		texts,
		rowTexts,
	}
}

describe("P1-2: replay rows are applied to the transcript (not only counted)", () => {
	test("a) a row journalled after the last live delta becomes visible with its content", async () => {
		const h = makeHarness()
		await h.crashMidTurn("question", "live-partial")
		// The host journalled the prompt and the FULL body AFTER the last
		// `turn.token` the client ever saw. Before the fix only the count was
		// reported; the durable body was never painted.
		h.setJournal([
			userRow(1, "question"),
			assistantRow(2, "live-partial-durable-tail"),
		])
		await h.recover()

		const replayed = h.seamEvents.filter((e) => e.type === "message.part.updated")
		expect(replayed.length).toBeGreaterThan(0)
		expect(h.texts()).toContain("live-partial-durable-tail")
		// The pure live raw text must not linger beside the durable body.
		expect(h.texts().filter((t) => t === "live-partial")).toEqual([])
	})

	test("b) second DEAD + drain: already-painted rows stay single, new dead-window rows fill in", async () => {
		const h = makeHarness()
		await h.crashMidTurn("q1", "p1")
		h.setJournal([userRow(1, "q1"), assistantRow(2, "body-1")])
		await h.recover()
		expect(h.texts().filter((t) => t === "body-1").length).toBe(1)

		// Second live turn, killed again. New journal rows appear after the
		// first drain's cursor. Live frames carry no seq, so the seam relies on
		// the applied-key set to avoid duplicating `body-1`.
		await h.crashMidTurn("q2", "p2")
		h.setJournal([
			userRow(1, "q1"),
			assistantRow(2, "body-1"),
			userRow(3, "q2"),
			assistantRow(4, "body-2"),
		])
		// Force a full re-drain (simulates the key-set guard rather than the
		// from-cursor short-circuit): the already-applied key must be skipped.
		h.seam.resumeSession("sess-1")
		await h.recover()

		expect(h.texts().filter((t) => t === "body-1").length).toBe(1)
		expect(h.texts().filter((t) => t === "body-2").length).toBe(1)
	})

	test("c) live and replay rows interleave in seq order without duplicates", async () => {
		const h = makeHarness()
		await h.crashMidTurn("q", "raw-live")
		h.setJournal([
			userRow(1, "q"),
			assistantRow(2, "first-durable"),
			assistantRow(3, "second-durable"),
			assistantRow(4, "third-durable"),
		])
		await h.recover()

		const durable = ["first-durable", "second-durable", "third-durable"]
		const positions = durable.map((text) => h.texts().indexOf(text))
		expect(positions.every((p) => p >= 0)).toBe(true)
		// Every replayed body occupies one slot, and the seq order is kept.
		expect(positions).toEqual([...positions].sort((a, b) => a - b))
		for (const text of durable) {
			expect(h.texts().filter((t) => t === text).length).toBe(1)
		}
	})

	test("d) a tool line that landed during the death window is replayed into the transcript", async () => {
		const h = makeHarness()
		await h.crashMidTurn("run", "starting")
		h.setJournal([
			userRow(1, "run"),
			...toolRows(2, 3, "call-1", "bash", "done-output"),
			assistantRow(4, "final-answer"),
		])
		await h.recover()

		const tool = h.projection.rows.find((r) => r.kind === "tool")
		expect(tool).toBeDefined()
		expect(tool && tool.kind === "tool" ? tool.name : "").toBe("bash")
		expect(h.texts()).toContain("final-answer")
		// The tool line from the death window is present (the review's (d));
		// the assistant body took the superseded live row's slot. Existing
		// seam-rows upserts tool rows at the tail — seq interleaving of a
		// replay tool vs the superseded body is covered at the event level
		// (the projector emits in ascending seq order) rather than by row index.
	})
})
