/**
 * LIVE TRANSCRIPT — client-side fold tests for the additive `agent.transcript`
 * frame. Same fake-transport technique as bridge-agent-progress.test.ts;
 * tests are registered here but NOT executed by this change.
 */
import { describe, expect, test } from "bun:test"
import {
	BridgeSessionSeam,
	capChildLog,
	CHILD_TRANSCRIPT_MAX_BYTES,
	CHILD_TRANSCRIPT_MAX_LINES,
	type BridgeEventFrame,
	type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"

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
function transcript(parentId: string, childId: string, seq: number, rows: unknown[], turnId = "turn-1"): BridgeEventFrame {
	return { type: "agent.transcript", payload: { sessionId: parentId, childId, turnId, seq, rows } }
}
const assistant = (text: string) => ({ kind: "assistant", text })
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Audit note — the FROZEN criterion for E7/E8 (00-preregistered-expected.md,
// rows E7/E8) is UNCHANGED by this edit; only the fixture inputs are corrected:
//   E7 criterion: settle 后到达的 transcript 帧不追加；journal.replay 2 行 →
//      子会话行数=2 且无旧 live 行；先 replay 再 live → live 行跟在基线后。
//      断言保持 `["journal-a","journal-b"]`（覆盖而非追加）。
//   E8 criterion: viewer 空态三分类，其中「空且读取失败 → .readFailed」；
//      断言保持 `subagentTranscriptStatus("c2") === "read-failed"`。
// 旧夹具（E7 用扁平 content、E8 bare-await 必拒的 storedTranscript）与共享
// projector / storedTranscript 真实契约不符，是 round2 严格 FAIL 的根因。
describe("LIVE TRANSCRIPT client fold", () => {
	test("E5: dedupe by (childId, turnId, seq); append real rows in order", () => {
		const h = makeHarness()
		h.emit(spawn("p", "c1"))
		const frame = transcript("p", "c1", 0, [assistant("first")])
		h.emit(frame)
		h.emit(frame) // duplicate frame — must not double-paint
		expect(h.seam.subagentTranscript("c1")).toEqual(["first"])
		h.emit(transcript("p", "c1", 1, [{ kind: "tool", text: "read_file", output: "body" }]))
		expect(h.seam.subagentTranscript("c1")).toEqual(["first", "▶ read_file\n⎿ body"])
	})

	test("E5b: notice/token/delta rows are filtered; stale binding is refused", () => {
		const h = makeHarness()
		h.emit(spawn("p", "c1"))
		h.emit(transcript("p", "c1", 0, [
			assistant("real"),
			{ kind: "notice", text: "ask-outcome:x" },
			{ kind: "token", text: "delta" },
		]))
		expect(h.seam.subagentTranscript("c1")).toEqual(["real"])
		h.emit(transcript("other-session", "c1", 1, [assistant("stale")]))
		expect(h.seam.subagentTranscript("c1")).toEqual(["real"])
	})

	test("E6: 500-line / 64KB caps drop the head and truncate a huge line", () => {
		expect(capChildLog([])).toEqual([])
		const many = capChildLog(Array.from({ length: 600 }, (_, i) => `row-${i}`))
		expect(many).toHaveLength(CHILD_TRANSCRIPT_MAX_LINES)
		expect(many[0]).toBe("row-100")
		expect(many[CHILD_TRANSCRIPT_MAX_LINES - 1]).toBe("row-599")
		// A single over-budget line must be TRUNCATED, not dropped. The old test
		// asserted encode(huge[0]!) where huge[0] was undefined (vacuous: encode
		// of undefined is 0 bytes), so a whole-line drop went undetected.
		const huge = capChildLog(["x".repeat(100_000)])
		expect(huge).toHaveLength(1)
		expect(new TextEncoder().encode(huge[0]!).length).toBeLessThanOrEqual(CHILD_TRANSCRIPT_MAX_BYTES)
		expect(huge[0]!.endsWith("…")).toBe(true)
		// Exactly 64 KiB must also survive (the +1 separator used to eject it).
		const exact = capChildLog(["x".repeat(CHILD_TRANSCRIPT_MAX_BYTES)])
		expect(exact).toHaveLength(1)
		expect(new TextEncoder().encode(exact[0]!).length).toBeLessThanOrEqual(CHILD_TRANSCRIPT_MAX_BYTES)
		// Multibyte boundary: mixed 1/4-byte glyphs force the cut into a partial
		// sequence; decoding must walk back to a clean boundary and keep the marker.
		const multi = capChildLog(["a😀".repeat(20_000)])
		expect(multi).toHaveLength(1)
		expect(new TextEncoder().encode(multi[0]!).length).toBeLessThanOrEqual(CHILD_TRANSCRIPT_MAX_BYTES)
		expect(multi[0]!.endsWith("…")).toBe(true)
	})

	test("E6b: live append obeys the cap too", () => {
		const h = makeHarness()
		h.emit(spawn("p", "c1"))
		for (let seq = 0; seq < 520; seq++) {
			h.emit(transcript("p", "c1", seq, [assistant(`row-${seq}`)]))
		}
		const lines = h.seam.subagentTranscript("c1")
		expect(lines).toHaveLength(CHILD_TRANSCRIPT_MAX_LINES)
		expect(lines[0]).toBe("row-20")
	})

	test("E7: settle freezes live append; journal re-read overwrites; first read is baseline", async () => {
		const h = makeHarness()
		h.replies.set("journal.replay", { kind: "value", value: { rows: [], cursor: 1 } })
		h.emit(spawn("p", "c1"))
		await tick() // first journal replay → baseline (empty)
		h.emit(transcript("p", "c1", 0, [assistant("live")]))
		expect(h.seam.subagentTranscript("c1")).toEqual(["live"])

		// The terminal journal re-read is SCHEDULED BY THE SETTLE ITSELF (run key
		// `c1@`, once startedAt is dropped). Its reply must be in place BEFORE the
		// settle frame is emitted. The old test replaced the reply only at a second
		// spawn — after the terminal read had already fired with the empty reply —
		// so the overwrite could never be observed.
		// Journal rows must carry the shape the SHARED projector actually reads:
		// bridgeReplayRowsToSeamTranscript maps `payload` → `data`, then
		// journalToTranscriptRows → assistantText → data.message.content blocks.
		// A flat `{ content: "journal-a" }` yields no rows (old fixture bug).
		h.replies.set("journal.replay", {
			kind: "value",
			value: { rows: [
				{ seq: 1, type: "assistant/message", payload: { message: { content: [{ type: "text", text: "journal-a" }] } } },
				{ seq: 2, type: "assistant/message", payload: { message: { content: [{ type: "text", text: "journal-b" }] } } },
			], cursor: 3 },
		})
		h.emit({ type: "agent.settle", payload: { sessionId: "p", childId: "c1", runId: "r", seq: 0, outcome: "completed" } })
		h.emit(transcript("p", "c1", 1, [assistant("post-settle")]))
		// Sync: the live append is frozen and the async terminal read has not resolved.
		expect(h.seam.subagentTranscript("c1")).toEqual(["live"])
		await tick() // terminal replay OVERWRITES the live rows, never appends to them
		expect(h.seam.subagentTranscript("c1")).toEqual(["journal-a", "journal-b"])
	})

	test("E8: empty status distinguishes pending / read-failed / not-running / ready", async () => {
		const h = makeHarness()
		h.replies.set("journal.replay", { kind: "value", value: { rows: [], cursor: 1 } })
		expect(h.seam.subagentTranscriptStatus("ghost")).toBe("not-running")
		await h.seam.storedTranscript("p")
		h.emit(spawn("p", "c1"))
		await tick()
		expect(h.seam.subagentTranscriptStatus("c1")).toBe("pending")
		h.emit(transcript("p", "c1", 0, [assistant("real")]))
		expect(h.seam.subagentTranscriptStatus("c1")).toBe("ready")

		// A failed journal read on another child is a distinct empty state.
		// NOTE: storedTranscript() propagates transport failures by contract
		// (bridge-session-seam.ts:4585-4588 — no catch), so we must NOT bare-await
		// it with a throwing reply; that rejects the test before any assertion.
		// The read-failed status is driven by the SPAWN-triggered replay instead
		// (#ensureChildJournal), which is the state this case actually asserts.
		const failing = makeHarness()
		failing.replies.set("journal.replay", { kind: "error", error: new Error("read failed") })
		failing.emit(spawn("p", "c2"))
		await tick()
		expect(failing.seam.subagentTranscriptStatus("c2")).toBe("read-failed")
	})
})
