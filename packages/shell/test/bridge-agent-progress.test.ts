/**
 * B3 — client-side fold tests for the additive `agent.progress` frame.
 *
 * `agent.progress` is RUNTIME data layered on top of the spawn-time journal
 * baseline: it updates a running child's rounds/lastLine/elapsedSec in
 * #subagentViews and pushes through the existing onSubagentViews emit path,
 * without changing the one-time journal-loaded guard. Settled children stay
 * journal-authoritative. Same fake-transport technique as
 * bridge-session-seam.test.ts; no host is imported.
 */
import { describe, expect, test } from "bun:test"
import { BridgeSessionSeam, type BridgeEventFrame, type BridgeTransport } from "../src/client/bridge-session-seam.ts"
import type { SeamSubagentView } from "../../tui-base/src/seams/session.ts"

type Reply = { kind: "value"; value: unknown } | { kind: "error"; error: unknown }

function makeHarness() {
	const replies = new Map<string, Reply>()
	const eventListeners: ((frame: BridgeEventFrame) => void)[] = []
	const transport: BridgeTransport = {
		async request(method) {
			const reply = replies.get(method)
			if (reply === undefined) return {}
			if (reply.kind === "error") throw reply.error
			return reply.value
		},
		onEvent(listener) {
			eventListeners.push(listener)
			return () => {
				const i = eventListeners.indexOf(listener)
				if (i >= 0) eventListeners.splice(i, 1)
			}
		},
	}
	const logger = { info() {}, warn() {}, error() {}, debug() {} }
	const seam = new BridgeSessionSeam({ transport, ctx: { logger } })
	return {
		seam,
		replies,
		emit(frame: BridgeEventFrame) {
			for (const l of [...eventListeners]) l(frame)
		},
	}
}

function spawn(parentId: string, childId: string): BridgeEventFrame {
	return { type: "agent.spawn", payload: { sessionId: parentId, childId, label: "scout", runId: "r", seq: 0 } }
}
function progress(parentId: string, childId: string, rounds: number, lastLine: string, elapsedSec: number): BridgeEventFrame {
	return { type: "agent.progress", payload: { sessionId: parentId, childId, rounds, lastLine, elapsedSec } }
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("B3 agent.progress client fold", () => {
	test("E5: progress updates a running child's rounds/lastLine/elapsedSec and emits", () => {
		const h = makeHarness()
		const snapshots: SeamSubagentView[][] = []
		h.seam.onSubagentViews((views) => snapshots.push(views))
		h.emit(spawn("p", "c1"))
		expect(h.seam.subagentViews()[0]).toMatchObject({ id: "c1", status: "running", rounds: 0 })
		const before = snapshots.length

		h.emit(progress("p", "c1", 3, "hi", 2.5))

		const view = h.seam.subagentViews()[0]!
		expect(view.rounds).toBe(3)
		expect(view.lastLine).toBe("hi")
		expect(view.elapsedSec).toBe(2.5)
		expect(view.status).toBe("running")
		expect(snapshots.length).toBe(before + 1)
		expect(snapshots[snapshots.length - 1]![0]).toMatchObject({ rounds: 3, lastLine: "hi", elapsedSec: 2.5 })
	})

	test("E5b: repeated progress advances rounds and tail; later replay fold cannot freeze them back", async () => {
		const h = makeHarness()
		h.replies.set("journal.replay", { kind: "value", value: { rows: [], cursor: 1 } })
		h.emit(spawn("p", "c1"))
		h.emit(progress("p", "c1", 2, "first", 1.2))
		await tick() // let the spawn-time journal baseline settle (empty rows)
		h.emit(progress("p", "c1", 5, "latest", 3.4))
		const view = h.seam.subagentViews()[0]!
		expect(view.rounds).toBe(5)
		expect(view.lastLine).toBe("latest")
		expect(view.elapsedSec).toBe(3.4)
	})

	test("E6: unknown child, wrong session, and settled child ignore progress", async () => {
		const h = makeHarness()
		h.replies.set("journal.replay", { kind: "value", value: { rows: [], cursor: 1 } })
		// Establish the subagent binding session via the real replay-drain path,
		// exactly as sessionInfo / storedTranscript do in production.
		await h.seam.storedTranscript("p")
		h.emit(progress("p", "ghost", 4, "x", 1)) // no spawn → no ghost row
		expect(h.seam.subagentViews()).toHaveLength(0)

		h.emit(spawn("p", "c1"))
		h.emit(progress("other-session", "c1", 9, "wrong", 9)) // stale binding → dropped
		expect(h.seam.subagentViews()[0]).toMatchObject({ rounds: 0 })

		h.emit({ type: "agent.settle", payload: { sessionId: "p", runId: "r", seq: 0, outcome: "completed" } })
		const settled = h.seam.subagentViews()[0]!
		expect(settled.status).toBe("completed")
		const frozenRounds = settled.rounds
		const frozenLine = settled.lastLine
		h.emit(progress("p", "c1", 99, "late-mid", 99)) // settled → authoritative, ignored
		const after = h.seam.subagentViews()[0]!
		expect(after.rounds).toBe(frozenRounds)
		expect(after.lastLine).toBe(frozenLine)
		expect(after.status).toBe("completed")
	})

	test("E7: settle terminal journal re-read overrides progress mid-state", async () => {
		const h = makeHarness()
		const parent = "p"
		const child = "c1"
		// Authoritative child journal: 9 assistant messages, last tail "final".
		const rows = Array.from({ length: 9 }, (_, i) => ({
			seq: i + 1,
			type: "assistant/message",
			payload: { content: i === 8 ? "final" : `round ${i + 1}` },
		}))
		h.replies.set("journal.replay", { kind: "value", value: { rows, cursor: 10 } })

		h.emit(spawn(parent, child))
		h.emit(progress(parent, child, 3, "mid", 2.5))
		expect(h.seam.subagentViews()[0]).toMatchObject({ rounds: 3, lastLine: "mid" })

		h.emit({ type: "agent.settle", payload: { sessionId: parent, runId: "r", seq: 0, outcome: "completed" } })
		await tick() // terminal journal re-read lands
		const settled = h.seam.subagentViews()[0]!
		expect(settled.status).toBe("completed")
		expect(settled.rounds).toBe(9)
		expect(settled.lastLine).toBe("final")

		// No progress frame may rewrite the terminal.
		h.emit(progress(parent, child, 50, "after-settle", 50))
		expect(h.seam.subagentViews()[0]).toMatchObject({ rounds: 9, lastLine: "final", status: "completed" })
	})
})
