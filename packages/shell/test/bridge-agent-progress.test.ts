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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type Reply = { kind: "value"; value: unknown } | { kind: "error"; error: unknown }

function makeHarness(local?: { dshHome?: string; profile?: string; workspaceDir?: string }) {
	const replies = new Map<string, Reply>()
	const requests: { method: string; params?: Record<string, unknown> }[] = []
	const eventListeners: ((frame: BridgeEventFrame) => void)[] = []
	const transport: BridgeTransport = {
		async request(method, params) {
			requests.push({ method, params })
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
	const seam = new BridgeSessionSeam({ transport, ctx: { logger }, ...local })
	return {
		seam,
		replies,
		requests,
		emit(frame: BridgeEventFrame) {
			for (const l of [...eventListeners]) l(frame)
		},
	}
}

/** Deterministic profile home for the maxRounds config face: either NO config.json
 *  (unset → default 50/0) or one carrying the two knobs. Returns its cleanup. */
function configHome(config?: Record<string, unknown>) {
	const dshHome = mkdtempSync(join(tmpdir(), "dsh-round-policy-"))
	if (config !== undefined) {
		const profileDir = join(dshHome, "profiles", "opentui-monday")
		mkdirSync(profileDir, { recursive: true })
		writeFileSync(join(profileDir, "config.json"), JSON.stringify(config))
	}
	return { dshHome, cleanup: () => rmSync(dshHome, { recursive: true, force: true }) }
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

// ---------------------------------------------------------------------------
// maxRounds runtime consumer — the config.json knobs now have a REAL consumer:
// the shared SubagentRoundPolicy is driven by additive `agent.progress` rounds
// and delivers through the seam's real child steer / interrupt faces.
// ---------------------------------------------------------------------------

describe("maxRounds ladder wired to agent.progress (config.json consumer)", () => {
	const promptCalls = (h: ReturnType<typeof makeHarness>) => h.requests.filter((r) => r.method === "subagents.prompt")
	const interruptCalls = (h: ReturnType<typeof makeHarness>) => h.requests.filter((r) => r.method === "subagents.interrupt")

	test("unset keys → cap 50 / grace 0: wrap-up at 50, no force-stop past the cap", async () => {
		const home = configHome() // no config.json at all
		try {
			const h = makeHarness({ dshHome: home.dshHome, profile: "opentui-monday" })
			h.emit(spawn("p", "c1"))
			h.emit(progress("p", "c1", 49, "still going", 4.9))
			await tick()
			expect(promptCalls(h)).toHaveLength(0)
			expect(h.seam.subagentViews()[0]!.injectedRound).toBeUndefined()

			h.emit(progress("p", "c1", 50, "at cap", 5))
			await tick()
			const prompts = promptCalls(h)
			expect(prompts).toHaveLength(1)
			const content = (prompts[0]!.params!.content as Array<{ text: string }>)[0]!.text
			expect(content).toContain("Round limit reached (50")
			expect(h.seam.subagentViews()[0]!.injectedRound).toBe(50)

			// grace 0 = warn-only: even far past the cap no interrupt is issued.
			h.emit(progress("p", "c1", 80, "past cap", 8))
			await tick()
			expect(interruptCalls(h)).toHaveLength(0)
			expect(promptCalls(h)).toHaveLength(1) // one wrap-up per child
		} finally {
			home.cleanup()
		}
	})

	test("explicit maxRounds:0 disables the ladder even at round 100", async () => {
		const home = configHome({ maxRounds: 0, maxRoundsGrace: 3 })
		try {
			const h = makeHarness({ dshHome: home.dshHome, profile: "opentui-monday" })
			h.emit(spawn("p", "c1"))
			h.emit(progress("p", "c1", 100, "unbounded", 10))
			await tick()
			expect(promptCalls(h)).toHaveLength(0)
			expect(interruptCalls(h)).toHaveLength(0)
			const view = h.seam.subagentViews()[0]!
			expect(view.injectedRound).toBeUndefined()
			expect(view.hardStopRound).toBeUndefined()
		} finally {
			home.cleanup()
		}
	})

	test("cap + grace: wrap-up at cap, real interruptChild force-stop at cap+grace", async () => {
		const home = configHome({ maxRounds: 3, maxRoundsGrace: 2 })
		try {
			const h = makeHarness({ dshHome: home.dshHome, profile: "opentui-monday" })
			// Bind a session so the real interruptChild has a parent id.
			h.replies.set("session.open", { kind: "value", value: { sessionId: "parent" } })
			h.replies.set("session.send", { kind: "value", value: { turnId: "t-bind" } })
			h.replies.set("subagents.interrupt", {
				kind: "value", value: { childId: "c1", disposition: "already-settled" },
			})
			h.seam.resumeSession("parent")
			const done = h.seam.turn("go", {
				onThinkingDelta() {}, onContentDelta() {}, onApprove: async () => "allowed-once", onError() {},
			})
			await tick()
			h.emit({ type: "turn.end", payload: { turnId: "t-bind", text: "" } })
			await done
			await tick()

			h.emit(spawn("parent", "c1"))
			h.emit(progress("parent", "c1", 3, "at cap", 3))
			await tick()
			expect(promptCalls(h)).toHaveLength(1)
			expect(h.seam.subagentViews()[0]!.injectedRound).toBe(3)
			expect(interruptCalls(h)).toHaveLength(0)

			h.emit(progress("parent", "c1", 4, "in grace", 4))
			await tick()
			expect(interruptCalls(h)).toHaveLength(0)

			h.emit(progress("parent", "c1", 5, "past grace", 5))
			await tick()
			await tick()
			expect(interruptCalls(h)).toHaveLength(1)
			expect(interruptCalls(h)[0]!.params).toEqual({ parentSessionId: "parent", childId: "c1" })
			expect(h.seam.subagentViews()[0]!.hardStopRound).toBe(5)
		} finally {
			home.cleanup()
		}
	})

	test("settle does not re-awaken: no wrap-up when the child settles in the same tick", async () => {
		const home = configHome({ maxRounds: 3, maxRoundsGrace: 2 })
		try {
			const h = makeHarness({ dshHome: home.dshHome, profile: "opentui-monday" })
			h.emit(spawn("p", "c1"))
			// The cap crossing schedules a deferred wrap-up; settle before it flushes.
			h.emit(progress("p", "c1", 3, "at cap", 3))
			h.emit({ type: "agent.settle", payload: { sessionId: "p", runId: "r", seq: 0, outcome: "completed" } })
			await tick()
			expect(promptCalls(h)).toHaveLength(0)
			expect(h.seam.subagentViews()[0]!.status).toBe("completed")
			expect(h.seam.subagentViews()[0]!.injectedRound).toBeUndefined()

			// Late progress on a settled child is authoritative — never wakes it.
			h.emit(progress("p", "c1", 50, "after settle", 50))
			await tick()
			expect(promptCalls(h)).toHaveLength(0)
			expect(interruptCalls(h)).toHaveLength(0)
		} finally {
			home.cleanup()
		}
	})
})
