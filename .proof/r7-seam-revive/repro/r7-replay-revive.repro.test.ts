// oldfox W4 scratch reproduction (read-only w.r.t. the repo): does a FULL-log
// journal re-fold (`storedTranscript`, which seam-rows.ts calls at EVERY parent
// turn end) revive a catalog child that was settled by the NEW live
// `agent.settle {runId:"catalog:<id>", seq:0}` frame (bridge d0a6748) when the
// parent journal does not yet hold the `user/message subagent-settled` notice?
// Pure seam-level check with the same fake-transport technique as
// packages/shell/test/bridge-session-seam.test.ts. No host is imported.
import { test } from "bun:test"
import {
	BridgeSessionSeam,
	type BridgeEventFrame,
	type BridgeTransport,
} from "../../../packages/shell/src/client/bridge-session-seam.ts"

type Reply =
	| { kind: "value"; value: unknown }
	| { kind: "error"; error: unknown }
	| { kind: "fn"; fn: (params?: Record<string, unknown>) => Reply }

function makeHarness() {
	const requests: { method: string; params?: Record<string, unknown> }[] = []
	const replies = new Map<string, Reply>()
	const eventListeners: ((frame: BridgeEventFrame) => void)[] = []
	const transport: BridgeTransport = {
		async request(method, params) {
			requests.push({ method, params })
			let reply = replies.get(method)
			if (reply === undefined) return {}
			if (reply.kind === "fn") reply = reply.fn(params)
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
		requests,
		replies,
		emit(frame: BridgeEventFrame) {
			for (const l of [...eventListeners]) l(frame)
		},
	}
}

const CREATED = 1_795_424_492_844 // real child turn/start clock from 20-journal.md
const CAT = {
	seq: 21, type: "subagent/catalog",
	payload: { childId: "c1", childCreatedAt: CREATED, label: "L" },
}
const NOTICE = {
	seq: 37, type: "user/message",
	payload: { source: { kind: "subagent-settled", stopReason: "completed", senderSessionId: "c1" } },
}
const SPAWN: BridgeEventFrame = {
	type: "agent.spawn",
	payload: { sessionId: "p", childId: "c1", label: "L", runId: "catalog:c1", seq: 0, childCreatedAt: CREATED },
}
// EXACT payload shape the bridge emits after d0a6748 (packages/bridge/src/index.ts:3411-3418)
const LIVE_SETTLE: BridgeEventFrame = {
	type: "agent.settle",
	payload: {
		turnId: "t1", sessionId: "p", childId: "c1", runId: "catalog:c1", seq: 0, outcome: "completed",
	},
}
const view = (h: ReturnType<typeof makeHarness>) => {
	const v = h.seam.subagentViews()[0]
	return v === undefined ? "<absent>" : `${v.status} rounds=${v.rounds} elapsed=${v.elapsedSec}`
}
const trace = (h: ReturnType<typeof makeHarness>) => {
	const out: string[] = []
	h.seam.onSubagentViews((views) => {
		const v = views.find((x) => x.id === "c1")
		out.push(v === undefined ? "c1:<absent>" : `c1:${v.status}`)
	})
	return out
}

test("A: turn-end full re-fold, notice NOT in journal, session.list empty (best-effort read gives no row)", async () => {
	const h = makeHarness()
	h.emit(SPAWN)
	h.emit(LIVE_SETTLE)
	const afterLive = view(h)
	const emitted = trace(h)
	h.replies.set("journal.replay", { kind: "value", value: { rows: [CAT], cursor: 40 } })
	h.replies.set("session.list", { kind: "value", value: { items: [] } })
	await h.seam.storedTranscript("p") // seam-rows.ts:870 — every parent turn end
	await Bun.sleep(0)
	await Bun.sleep(0)
	console.log(`[A] afterLive=${afterLive} | afterTurnEndReFold=${view(h)} | emitsSinceReFold=${JSON.stringify(emitted)}`)
})

test("B: turn-end full re-fold, notice NOT in journal, session.list reports the child running=false", async () => {
	const h = makeHarness()
	h.emit(SPAWN)
	h.emit(LIVE_SETTLE)
	const afterLive = view(h)
	const emitted = trace(h)
	h.replies.set("journal.replay", { kind: "value", value: { rows: [CAT], cursor: 40 } })
	h.replies.set("session.list", {
		kind: "value",
		value: { items: [{ sessionId: "c1", origin: "subagent", parentSessionId: "p", running: false, updatedAt: CREATED }] },
	})
	await h.seam.storedTranscript("p")
	const syncAfterFold = view(h) // BEFORE the void sweep's list round-trip resolves
	await Bun.sleep(0)
	await Bun.sleep(0)
	console.log(`[B] afterLive=${afterLive} | syncAfterFold=${syncAfterFold} | afterSweep=${view(h)} | emits=${JSON.stringify(emitted)}`)
})

test("C: turn-end full re-fold, notice PRESENT in journal (control)", async () => {
	const h = makeHarness()
	h.emit(SPAWN)
	h.emit(LIVE_SETTLE)
	const afterLive = view(h)
	const emitted = trace(h)
	h.replies.set("journal.replay", { kind: "value", value: { rows: [CAT, NOTICE], cursor: 40 } })
	h.replies.set("session.list", { kind: "value", value: { items: [] } })
	await h.seam.storedTranscript("p")
	await Bun.sleep(0)
	await Bun.sleep(0)
	console.log(`[C] afterLive=${afterLive} | afterTurnEndReFold=${view(h)} | emits=${JSON.stringify(emitted)}`)
})

test("E: /session incremental drain (sessionInfo) with a catalog row and no notice — no sweep follows", async () => {
	const h = makeHarness()
	h.replies.set("session.open", { kind: "value", value: { sessionId: "p" } })
	h.replies.set("session.send", { kind: "value", value: { turnId: "t1" } })
	h.seam.resumeSession("p")
	const done = h.seam.turn("go", {
		onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {},
	})
	await Bun.sleep(0)
	h.emit(SPAWN)
	h.emit(LIVE_SETTLE)
	const afterLive = view(h)
	h.replies.set("journal.replay", { kind: "fn", fn: (p) => ({ kind: "value", value: { rows: p?.sessionId === "c1" ? [] : [CAT], cursor: 40 } }) })
	await h.seam.sessionInfo() // commands.ts:1203 (/session) -> #computeSessionInfo -> #foldAgentReplayRows
	await Bun.sleep(0)
	await Bun.sleep(0)
	console.log(`[E] afterLive=${afterLive} | afterSessionInfoDrain=${view(h)}`)
	void done
})

test("P (positive pairing): catalog-keyed live spawn + catalog-keyed live settle (seq 0) pairs and settles; a 2nd identical settle is a no-op", async () => {
	const h = makeHarness()
	const emitted = trace(h)
	h.emit(SPAWN)
	const afterSpawn = view(h)
	h.emit(LIVE_SETTLE)
	const afterSettle = view(h)
	h.emit(LIVE_SETTLE) // duplicate — must not change anything
	h.emit({ ...LIVE_SETTLE, payload: { ...LIVE_SETTLE.payload, outcome: "failed" } }) // late conflicting outcome
	await Bun.sleep(0)
	console.log(`[P] afterSpawn=${afterSpawn} | afterSettle=${afterSettle} | afterDuplicateAndConflicting=${view(h)} | emits=${JSON.stringify(emitted)}`)
})
