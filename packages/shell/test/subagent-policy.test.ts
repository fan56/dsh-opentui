// Subagent maxRounds hard-stop policy (feature batch F1): settings parse,
// the pure ladder verdict (grace window / force-stop timing), the stateful
// SubagentRoundPolicy, and the client facade feed — the RemoteSubagentPanel
// (subagents/prompt + subagents/interruptByParent). The former plugin
// HostSession face (child agent steer + cancel) is gone with plugin mode.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	DEFAULT_SUBAGENT_ROUND_LIMITS,
	SubagentRoundPolicy,
	bareAgentLabel,
	ladderDecision,
	limitsFromSettingsRows,
	parseSubagentRoundLimits,
	wrapupMessage,
	type HardStopRecord,
	type SubagentRoundLimits,
} from "../src/subagent-policy.ts"
import { RemoteSubagentPanel } from "../src/client/remote-subagents.ts"
import { FakeMuxSocket, until } from "./client-fakes.ts"

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("settings parse (dsh-opentui namespace)", () => {
	test("reads maxRounds/maxRoundsGrace; numeric strings accepted", () => {
		expect(parseSubagentRoundLimits({ maxRounds: 5, maxRoundsGrace: 2 })).toEqual({ maxRounds: 5, maxRoundsGrace: 2 })
		expect(parseSubagentRoundLimits({ maxRounds: "7", maxRoundsGrace: " 1 " })).toEqual({ maxRounds: 7, maxRoundsGrace: 1 })
	})
	test("malformed / negative / missing values fall back to the disabled defaults", () => {
		expect(parseSubagentRoundLimits({ maxRounds: -3, maxRoundsGrace: "x" })).toEqual(DEFAULT_SUBAGENT_ROUND_LIMITS)
		expect(parseSubagentRoundLimits(undefined)).toEqual(DEFAULT_SUBAGENT_ROUND_LIMITS)
		expect(parseSubagentRoundLimits("5")).toEqual(DEFAULT_SUBAGENT_ROUND_LIMITS)
	})
	test("picks the dsh-opentui row only", () => {
		const rows = [
			{ ns: "dsh-tui", value: { maxRounds: 99 } },
			{ ns: "dsh-opentui", value: { maxRounds: 3, maxRoundsGrace: 2 } },
		]
		expect(limitsFromSettingsRows(rows)).toEqual({ maxRounds: 3, maxRoundsGrace: 2 })
		expect(limitsFromSettingsRows([{ ns: "other", value: {} }])).toEqual(DEFAULT_SUBAGENT_ROUND_LIMITS)
	})
})

describe("ladderDecision (grace window / force-stop timing)", () => {
	const base = { cap: 3, grace: 2, wrapupDelivered: false, settled: false }
	test("no action below the cap, wrap-up at the cap", () => {
		expect(ladderDecision({ ...base, count: 2 })).toBe("none")
		expect(ladderDecision({ ...base, count: 3 })).toBe("wrapup")
		expect(ladderDecision({ ...base, count: 4 })).toBe("wrapup") // a late first crossing still wraps up
	})
	test("force-stop exactly at cap + grace, not one round earlier", () => {
		const delivered = { ...base, wrapupDelivered: true }
		expect(ladderDecision({ ...delivered, count: 3 })).toBe("none")
		expect(ladderDecision({ ...delivered, count: 4 })).toBe("none")
		expect(ladderDecision({ ...delivered, count: 5 })).toBe("force-stop")
		expect(ladderDecision({ ...delivered, count: 9 })).toBe("force-stop")
	})
	test("grace 0 = warn-only, never stops", () => {
		expect(ladderDecision({ ...base, grace: 0, wrapupDelivered: true, count: 100 })).toBe("none")
	})
	test("disabled cap and settled children are left alone", () => {
		expect(ladderDecision({ ...base, cap: 0, count: 50 })).toBe("none")
		expect(ladderDecision({ ...base, settled: true, count: 3 })).toBe("none")
		expect(ladderDecision({ ...base, settled: true, wrapupDelivered: true, count: 5 })).toBe("none")
	})
})

describe("bareAgentLabel (foreground descriptor-label namespaces)", () => {
	test("strips the current and legacy foreground prefixes", () => {
		expect(bareAgentLabel("[fg] looper")).toBe("looper")
		expect(bareAgentLabel("[use_agent foreground] looper")).toBe("looper")
		expect(bareAgentLabel("  [fg] looper ")).toBe("looper")
	})
	test("bare labels and other namespaces pass through", () => {
		expect(bareAgentLabel("looper")).toBe("looper")
		expect(bareAgentLabel("[fg]multi word name")).toBe("[fg]multi word name") // no space after ]: not the namespace
		expect(bareAgentLabel("[fg] scout extra")).toBe("scout extra") // strips at the prefix, keeps the rest
	})
})

describe("wrapupMessage", () => {
	test("names the cap and the grace window", () => {
		expect(wrapupMessage(5, 2)).toContain("5 LLM round-trips")
		expect(wrapupMessage(5, 2)).toContain("2 more rounds before this run is force-stopped")
		expect(wrapupMessage(5, 1)).toContain("1 more round before")
		expect(wrapupMessage(5, 0)).not.toContain("force-stopped")
	})
})

function makePolicy(overrides: { limits?: SubagentRoundLimits; wrapupOk?: () => boolean; resolveAgentCap?: (label: string) => number | undefined } = {}) {
	let limits = overrides.limits ?? { maxRounds: 3, maxRoundsGrace: 2 }
	const wrapups: { id: string; message: string }[] = []
	const stops: string[] = []
	const hardStops: HardStopRecord[] = []
	const settled = new Set<string>()
	const policy = new SubagentRoundPolicy({
		limits: () => limits,
		...(overrides.resolveAgentCap ? { resolveAgentCap: overrides.resolveAgentCap } : {}),
		isSettled: (id) => settled.has(id),
		wrapup: (id, message) => {
			if (overrides.wrapupOk && !overrides.wrapupOk()) return false
			wrapups.push({ id, message })
			return true
		},
		forceStop: (id) => {
			stops.push(id)
			return true
		},
		onHardStop: (record) => hardStops.push(record),
	})
	return { policy, wrapups, stops, hardStops, settled, setLimits: (next: SubagentRoundLimits) => { limits = next } }
}

describe("SubagentRoundPolicy ladder", () => {
	test("wrap-up once at the cap (microtask-deferred), force-stop once at cap + grace", async () => {
		const { policy, wrapups, stops, hardStops } = makePolicy()
		policy.onRoundCount("c1", 1)
		policy.onRoundCount("c1", 2)
		await flush()
		expect(wrapups).toHaveLength(0)
		policy.onRoundCount("c1", 3)
		expect(wrapups).toHaveLength(0) // deferred out of the caller's stack
		await flush()
		expect(wrapups).toHaveLength(1)
		expect(wrapups[0]!.message).toContain("3 LLM round-trips")
		policy.onRoundCount("c1", 4)
		await flush()
		expect(wrapups).toHaveLength(1)
		expect(stops).toHaveLength(0)
		policy.onRoundCount("c1", 5)
		expect(stops).toEqual(["c1"])
		expect(hardStops).toEqual([{ childId: "c1", round: 5, cap: 3, grace: 2 }])
		policy.onRoundCount("c1", 6) // the stop's own settlement re-entry
		expect(stops).toEqual(["c1"])
	})

	test("grace 0 never force-stops", async () => {
		const { policy, wrapups, stops } = makePolicy({ limits: { maxRounds: 2, maxRoundsGrace: 0 } })
		for (let n = 1; n <= 20; n++) {
			policy.onRoundCount("c1", n)
			await flush()
		}
		expect(wrapups).toHaveLength(1)
		expect(stops).toHaveLength(0)
	})

	test("an async forceStop reports its REAL outcome: markers only on a resolved true", async () => {
		// The remote panel's stop is a wire promise — a resolved false (the
		// missing interruptByParent route) must never fire onHardStop even
		// though the stage latched.
		const hardStops: HardStopRecord[] = []
		const forceStops: number[] = []
		let verdict = false
		const policy = new SubagentRoundPolicy({
			limits: () => ({ maxRounds: 1, maxRoundsGrace: 1 }),
			wrapup: () => true,
			forceStop: () => Promise.resolve(verdict),
			onHardStop: (record) => hardStops.push(record),
			onForceStop: (_id, round) => forceStops.push(round),
		})
		policy.onRoundCount("c1", 1)
		await flush()
		policy.onRoundCount("c1", 2) // cap + grace: stage 2 fires (latched)
		await flush()
		expect(hardStops).toEqual([]) // the wire said nothing was stopped
		expect(forceStops).toEqual([])
		// a NEW policy instance: same shape, but the stop succeeds
		const ok = new SubagentRoundPolicy({
			limits: () => ({ maxRounds: 1, maxRoundsGrace: 1 }),
			wrapup: () => true,
			forceStop: () => Promise.resolve(true),
			onHardStop: (record) => hardStops.push(record),
			onForceStop: (_id, round) => forceStops.push(round),
		})
		ok.onRoundCount("c2", 1)
		await flush()
		ok.onRoundCount("c2", 2)
		await flush()
		expect(hardStops).toEqual([{ childId: "c2", round: 2, cap: 1, grace: 1 }])
		expect(forceStops).toEqual([2])
	})

	test("maxRounds 0 disables the ladder (the 88-round runaway stays unbounded only when unconfigured)", async () => {
		const { policy, wrapups, stops } = makePolicy({ limits: { maxRounds: 0, maxRoundsGrace: 2 } })
		for (let n = 1; n <= 88; n++) policy.onRoundCount("c1", n)
		await flush()
		expect(wrapups).toHaveLength(0)
		expect(stops).toHaveLength(0)
	})

	test("per-agent cap overrides the global; a throwing lookup falls back to the global", async () => {
		const { policy, wrapups, stops } = makePolicy({
			limits: { maxRounds: 10, maxRoundsGrace: 1 },
			resolveAgentCap: (label) => {
				if (label === "boom") throw new Error("lookup failed")
				return label === "scout" ? 2 : undefined
			},
		})
		policy.onRoundCount("a", 2, "scout")
		policy.onRoundCount("b", 2, "boom")
		await flush()
		expect(wrapups.map((w) => w.id)).toEqual(["a"])
		policy.onRoundCount("a", 3, "scout")
		expect(stops).toEqual(["a"])
		policy.onRoundCount("b", 10, "boom")
		await flush()
		expect(wrapups.map((w) => w.id)).toEqual(["a", "b"])
	})

	test("caps freeze at the first crossing (a mid-flight settings edit cannot move the stop)", async () => {
		const { policy, stops, setLimits } = makePolicy()
		policy.onRoundCount("c1", 3)
		await flush()
		setLimits({ maxRounds: 50, maxRoundsGrace: 50 })
		policy.onRoundCount("c1", 5)
		expect(stops).toEqual(["c1"])
	})

	test("a failed wrap-up delivery stays eligible and retries on the next round", async () => {
		let ok = false
		const { policy, wrapups } = makePolicy({ wrapupOk: () => ok })
		policy.onRoundCount("c1", 3)
		await flush()
		expect(wrapups).toHaveLength(0)
		ok = true
		policy.onRoundCount("c1", 4)
		await flush()
		expect(wrapups).toHaveLength(1)
	})

	test("a child that settled is never woken or stopped", async () => {
		const { policy, wrapups, stops, settled } = makePolicy()
		policy.onRoundCount("c1", 3)
		await flush()
		settled.add("c1")
		policy.onRoundCount("c1", 5)
		expect(stops).toHaveLength(0)
		settled.add("c2")
		policy.onRoundCount("c2", 3)
		await flush()
		expect(wrapups.map((w) => w.id)).toEqual(["c1"])
	})

	test("dispose drops a pending deferred wrap-up", async () => {
		const { policy, wrapups } = makePolicy()
		policy.onRoundCount("c1", 3)
		policy.dispose()
		await flush()
		expect(wrapups).toHaveLength(0)
	})
})

// ---------------------------------------------------------------------------
// Client face: RemoteSubagentPanel feed (fake rpc + fake mux sockets)
// ---------------------------------------------------------------------------

describe("client face: RemoteSubagentPanel", () => {
	function assistantFrame(seq: number) {
		return {
			type: "event",
			event: { type: "assistant/message", seq, time: Date.now(), data: { message: { content: [{ type: "text", text: `round ${seq}` }] } } },
		}
	}

	test("wrap-up via subagents/prompt at the cap, force-stop via interruptByParent at cap + grace", async () => {
		const rpcCalls: { method: string; args: Record<string, unknown> }[] = []
		const sockets: FakeMuxSocket[] = []
		const hardStops: HardStopRecord[] = []
		let refreshes = 0
		const panel = new RemoteSubagentPanel({
			rpc: async (method, args) => {
				rpcCalls.push({ method, args: args ?? {} })
				return {}
			},
			socketFactory: () => {
				const socket = new FakeMuxSocket()
				sockets.push(socket)
				return socket
			},
			parentId: () => "parent-1",
			limits: () => ({ maxRounds: 3, maxRoundsGrace: 2 }),
			refreshLimits: () => {
				refreshes++
			},
			onHardStop: (record) => hardStops.push(record),
		})
		panel.foldParentRecord({ seq: 1, type: "tool-workflow/agent-start", data: { runId: "r", seq: 0, label: "scout", childId: "child-x" } } as never)
		await until(() => sockets.length > 0)
		const sock = sockets[0]!
		for (let n = 1; n <= 3; n++) sock.item(assistantFrame(n))
		await until(() => rpcCalls.some((c) => c.method === "subagents/prompt"))
		const prompt = rpcCalls.find((c) => c.method === "subagents/prompt")!
		const request = prompt.args.request as { childSessionId: string; delivery: string; content: { text: string }[] }
		expect(request.childSessionId).toBe("child-x")
		expect(request.delivery).toBe("steer")
		expect(request.content[0]!.text).toContain("Round limit reached (3")
		expect(rpcCalls.some((c) => c.method === "subagents/interruptByParent")).toBe(false)
		sock.item(assistantFrame(4))
		sock.item(assistantFrame(5))
		await until(() => rpcCalls.some((c) => c.method === "subagents/interruptByParent"))
		expect(rpcCalls.filter((c) => c.method === "subagents/interruptByParent")).toHaveLength(1)
		// the stop outcome is the interrupt's outcome now — the cancelled
		// settle and the hard-stop report land when the wire promise resolves
		await until(() => panel.views()[0]!.status === "cancelled")
		await until(() => hardStops.length > 0)
		expect(hardStops).toEqual([{ childId: "child-x", round: 5, cap: 3, grace: 2 }])
		expect(refreshes).toBeGreaterThanOrEqual(5)
		panel.stop()
	})

	test("no limits wired = no ladder (legacy panel behavior unchanged)", async () => {
		const rpcCalls: string[] = []
		const sockets: FakeMuxSocket[] = []
		const panel = new RemoteSubagentPanel({
			rpc: async (method) => {
				rpcCalls.push(method)
				return {}
			},
			socketFactory: () => {
				const socket = new FakeMuxSocket()
				sockets.push(socket)
				return socket
			},
			parentId: () => "parent-1",
		})
		panel.foldParentRecord({ seq: 1, type: "tool-workflow/agent-start", data: { runId: "r", seq: 0, label: "scout", childId: "child-x" } } as never)
		await until(() => sockets.length > 0)
		for (let n = 1; n <= 10; n++) sockets[0]!.item(assistantFrame(n))
		await until(() => panel.views()[0]?.rounds === 10)
		await flush()
		expect(rpcCalls.filter((m) => m.startsWith("subagents/"))).toEqual([])
		panel.stop()
	})
})

