import { describe, expect, spyOn, test } from "bun:test"
import {
	BridgeSessionSeam,
	EXTERNAL_UNKNOWN_MS,
	bridgeExternalSettledStatus,
	type BridgeEventFrame,
	type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"
import type { SeamSubagentView } from "../../tui-base/src/seams/session.ts"

type Reply = { kind: "value"; value: unknown } | { kind: "error"; error: unknown }

function makeHarness() {
	const replies = new Map<string, Reply>()
	const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
	const listeners: Array<(frame: BridgeEventFrame) => void> = []
	const transport: BridgeTransport = {
		async request(method, params) {
			requests.push({ method, params })
			const reply = replies.get(method)
			if (reply === undefined) return {}
			if (reply.kind === "error") throw reply.error
			return reply.value
		},
		onEvent(listener) {
			listeners.push(listener)
			return () => {
				const i = listeners.indexOf(listener)
				if (i >= 0) listeners.splice(i, 1)
			}
		},
	}
	const seam = new BridgeSessionSeam({ transport, ctx: { logger: { info() {}, warn() {}, error() {}, debug() {} } } })
	return {
		seam, replies, requests,
		emit(frame: BridgeEventFrame) { for (const listener of [...listeners]) listener(frame) },
	}
}

function spawn(sessionId: string, childId: string, createdAt = 1_000): BridgeEventFrame {
	return { type: "agent.external.spawn", payload: { sessionId, childId, label: `label-${childId}`, name: `name-${childId}`, createdAt } }
}
function settle(sessionId: string, childId: string, stopReason?: string, endedAt = 2_000, summary = "done"): BridgeEventFrame {
	return {
		type: "agent.external.settle",
		payload: { sessionId, childId, ...(stopReason !== undefined ? { stopReason } : {}), endedAt, ...(summary !== "" ? { summary } : {}) },
	}
}
const row = (h: ReturnType<typeof makeHarness>, id: string): SeamSubagentView | undefined =>
	h.seam.subagentViews().find((view) => view.id === id)
const tick = () => Bun.sleep(0)

async function boundHarness(sessionId = "p") {
	const h = makeHarness()
	h.replies.set("session.open", { kind: "value", value: { sessionId } })
	h.replies.set("session.send", { kind: "value", value: { turnId: "t-bind" } })
	h.seam.resumeSession(sessionId)
	const done = h.seam.turn("go", {
		onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {},
	})
	await tick()
	h.emit({ type: "turn.end", payload: { turnId: "t-bind", text: "" } })
	await done
	await tick()
	return h
}

describe("external agent seam", () => {
	test("spawn is standalone, emits to late subscribers, and never reads a child journal", async () => {
		const h = makeHarness()
		const snapshots: SeamSubagentView[][] = []
		h.seam.onSubagentViews((views) => snapshots.push(views))
		h.emit(spawn("p", "ext", 1234))
		expect(row(h, "ext")).toEqual({
			id: "ext", label: "label-ext", name: "name-ext", status: "running", rounds: 0,
			createdAt: 1234, mode: "external", noTranscript: true,
		})
		expect(snapshots[snapshots.length - 1]?.[0]?.mode).toBe("external")
		expect(h.seam.subagentTranscript("ext")).toEqual([])
		expect(h.seam.subagentTranscriptStatus("ext")).toBe("not-running")
		expect(h.seam.steerChild("ext", "no")).toBe(false)
		await tick()
		expect(h.requests.filter((r) => r.method === "journal.replay" && r.params?.sessionId === "ext")).toHaveLength(0)
		expect(h.requests.filter((r) => r.method === "subagents.prompt")).toHaveLength(0)
		await h.seam.dispose()
	})

	test("frozen stopReason mapping includes missing/other → unknown", () => {
		const cases: Array<[unknown, SeamSubagentView["status"]]> = [
			["completed", "completed"], ["aborted", "interrupted"],
			["error", "failed"], ["max-tokens", "failed"], ["refusal", "failed"],
			[undefined, "unknown"], ["cancelled", "unknown"], ["other", "unknown"],
		]
		for (const [reason, status] of cases) expect(bridgeExternalSettledStatus(reason)).toBe(status)
	})

	test("settle carries summary/endedAt without elapsed and is idempotent", async () => {
		const h = makeHarness()
		h.emit(spawn("p", "ext"))
		h.emit(settle("p", "ext", "completed", 9_999, "external summary"))
		const first = row(h, "ext")
		expect(first).toMatchObject({ status: "completed", summary: "external summary", endedAt: 9_999 })
		expect(first?.elapsedSec).toBeUndefined()
		expect(first?.startedAt).toBeUndefined()
		h.emit(settle("p", "ext", "error", 10_000, "changed"))
		expect(row(h, "ext")).toEqual(first)
		await h.seam.dispose()
	})

	test("orphan settle is cached and applied when spawn arrives", async () => {
		const h = makeHarness()
		h.emit(settle("p", "late", "aborted", 5_000, "late summary"))
		expect(h.seam.subagentViews()).toEqual([])
		h.emit(spawn("p", "late", 1_000))
		expect(row(h, "late")).toMatchObject({
			status: "interrupted", summary: "late summary", endedAt: 5_000, createdAt: 1_000,
		})
		h.emit(spawn("p", "late", 1_000))
		expect(row(h, "late")?.status).toBe("interrupted")
		await h.seam.dispose()
	})

	test("replay seeds local/external ids separately and matches exact settle kind", async () => {
		const h = makeHarness()
		const rows = [
			{ seq: 1, type: "subagent/catalog", payload: { childId: "local", label: "L", childCreatedAt: 1_000 } },
			{ seq: 2, type: "subagent/catalog", payload: { childId: "ext", label: "E", childCreatedAt: Date.now(), mode: "external" } },
			{ seq: 3, type: "subagent/catalog", payload: { childId: "near", label: "N", childCreatedAt: Date.now(), mode: "external" } },
			{ seq: 4, type: "user/message", payload: { source: { kind: "subagent-settled", senderSessionId: "ext", stopReason: "aborted", summary: "S", endedAt: 2_000 } } },
			{ seq: 5, type: "user/message", payload: { source: { kind: "subagent-settled-extra", senderSessionId: "near", stopReason: "completed", endedAt: 2_000 } } },
			{ seq: 6, type: "user/message", payload: { source: { kind: "subagent-settled", senderSessionId: "local", stopReason: "completed" } } },
		]
		h.replies.set("journal.replay", { kind: "value", value: { rows, cursor: 7 } })
		await h.seam.storedTranscript("p")
		expect(row(h, "ext")).toMatchObject({ mode: "external", status: "interrupted", summary: "S", endedAt: 2_000 })
		expect(row(h, "ext")?.elapsedSec).toBeUndefined()
		expect(row(h, "near")?.status).toBe("running")
		expect(row(h, "local")?.status).toBe("completed")
		expect(h.seam.subagentViews().filter((v) => v.id === "ext")).toHaveLength(1)
		expect(h.requests.filter((r) => r.method === "journal.replay" && (r.params?.sessionId === "ext" || r.params?.sessionId === "near"))).toHaveLength(0)
		const before = h.seam.subagentViews()
		await h.seam.storedTranscript("p")
		expect(h.seam.subagentViews()).toEqual(before)
		await h.seam.dispose()
	})

	test("replay routes an out-of-order orphan settle by pre-scanned external ownership", async () => {
		const h = makeHarness()
		const rows = [
			{ seq: 1, type: "user/message", payload: { source: { kind: "subagent-settled", senderSessionId: "ext", stopReason: "completed", endedAt: 2_000 } } },
			{ seq: 2, type: "subagent/catalog", payload: { childId: "ext", label: "E", childCreatedAt: 1_000, mode: "external" } },
		]
		h.replies.set("journal.replay", { kind: "value", value: { rows, cursor: 3 } })
		await h.seam.storedTranscript("p")
		expect(row(h, "ext")).toMatchObject({ status: "completed", endedAt: 2_000, createdAt: 1_000 })
		expect(row(h, "ext")?.elapsedSec).toBeUndefined()
		await h.seam.dispose()
	})

	test("replay uses durable childCreatedAt; older than fifteen minutes becomes unknown without endedAt", async () => {
		const h = makeHarness()
		const rows = [{ seq: 1, type: "subagent/catalog", payload: {
			childId: "old", label: "Old", childCreatedAt: Date.now() - EXTERNAL_UNKNOWN_MS - 1_000, mode: "external",
		} }]
		h.replies.set("journal.replay", { kind: "value", value: { rows, cursor: 2 } })
		await h.seam.storedTranscript("p")
		expect(row(h, "old")?.status).toBe("unknown")
		expect(row(h, "old")?.endedAt).toBeUndefined()
		expect(row(h, "old")?.elapsedSec).toBeUndefined()
		await h.seam.dispose()
	})

	test("a newer external catalog revives a settled child and its next settle wins", async () => {
		const h = makeHarness()
		const now = Date.now()
		const rows = [
			{ seq: 1, type: "subagent/catalog", payload: {
				childId: "ext", label: "old run", childCreatedAt: now - 2_000, mode: "external",
			} },
			{ seq: 2, type: "user/message", payload: { source: {
				kind: "subagent-settled", senderSessionId: "ext", stopReason: "completed",
				summary: "old summary", endedAt: now - 1_000,
			} } },
			{ seq: 3, type: "subagent/catalog", payload: {
				childId: "ext", label: "new run", childCreatedAt: now, mode: "external",
			} },
		]
		h.replies.set("journal.replay", { kind: "value", value: { rows, cursor: 4 } })
		await h.seam.storedTranscript("p")
		expect(row(h, "ext")).toEqual({
			id: "ext", label: "new run", status: "running", rounds: 0,
			createdAt: now, mode: "external", noTranscript: true,
		})
		h.emit(settle("p", "ext", "error", now + 1_000, "new summary"))
		expect(row(h, "ext")).toMatchObject({
			status: "failed", summary: "new summary", endedAt: now + 1_000, createdAt: now,
		})
		await h.seam.dispose()
	})

	test("live timeout uses discovery time, not createdAt, and duplicate spawn cannot extend it", async () => {
		const h = makeHarness()
		let now = 10_000_000
		const clock = spyOn(Date, "now").mockImplementation(() => now)
		try {
			h.emit(spawn("p", "live", now - EXTERNAL_UNKNOWN_MS * 2))
			now += EXTERNAL_UNKNOWN_MS - 1
			expect(row(h, "live")?.status).toBe("running")
			now += 1
			expect(row(h, "live")?.status).toBe("unknown")
			expect(row(h, "live")?.endedAt).toBeUndefined()
			now += EXTERNAL_UNKNOWN_MS
			h.emit(spawn("p", "live", now))
			expect(row(h, "live")?.status).toBe("unknown")
		} finally {
			clock.mockRestore()
			await h.seam.dispose()
		}
	})

	test("settled external rows are capped at twenty newest rows", async () => {
		const h = makeHarness()
		for (let i = 0; i < 21; i++) {
			h.emit({ type: "agent.external.spawn", payload: { sessionId: "p", childId: `c${i}`, label: `C${i}`, createdAt: i } })
			h.emit({ type: "agent.external.settle", payload: { sessionId: "p", childId: `c${i}`, stopReason: "completed", endedAt: i } })
		}
		const ids = h.seam.subagentViews().map((v) => v.id)
		expect(ids).toHaveLength(20)
		expect(ids).not.toContain("c0")
		expect(ids).toContain("c20")
		await h.seam.dispose()
	})

	test("stale session frames are ignored; rebind and dispose clear external state", async () => {
		const h = makeHarness()
		h.emit(spawn("p", "ext"))
		h.emit(spawn("other", "foreign"))
		expect(h.seam.subagentViews().map((v) => v.id)).toEqual(["ext"])
		h.replies.set("journal.replay", { kind: "value", value: { rows: [], cursor: 1 } })
		await h.seam.storedTranscript("q")
		expect(h.seam.subagentViews()).toEqual([])
		h.emit(spawn("q", "q-ext"))
		expect(row(h, "q-ext")).toBeDefined()
		await h.seam.dispose()
		expect(h.seam.subagentViews()).toEqual([])
	})

	test("external interrupt uses subagents.interrupt without local confirmation; only external settle settles", async () => {
		const h = await boundHarness()
		h.replies.set("subagents.interrupt", { kind: "value", value: { childId: "ext", disposition: "cancel-issued" } })
		h.emit(spawn("p", "ext"))
		const before = h.requests.length
		await h.seam.interruptChild("ext")
		expect(h.requests.slice(before).map((r) => r.method)).toEqual(["subagents.interrupt"])
		expect(h.requests[before]?.params).toEqual({ parentSessionId: "p", childId: "ext" })
		h.emit({ type: "agent.settle", payload: { sessionId: "p", childId: "ext", runId: "r", seq: 0, outcome: "completed" } })
		expect(row(h, "ext")?.status).toBe("running")
		h.emit(settle("p", "ext", "aborted"))
		expect(row(h, "ext")?.status).toBe("interrupted")
		await h.seam.dispose()
	})
})
