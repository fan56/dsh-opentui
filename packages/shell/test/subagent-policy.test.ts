// Subagent maxRounds hard-stop policy (feature batch F1): settings parse,
// the pure ladder verdict (grace window / force-stop timing), the stateful
// SubagentRoundPolicy, and both facade feeds — the client RemoteSubagentPanel
// (subagents/prompt + subagents/interruptByParent) and the plugin
// HostSession (child agent steer + cancel, settings via ctx "settings").
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
import { HostSession } from "../src/host-session.ts"
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
		expect(panel.views()[0]!.status).toBe("cancelled")
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

// ---------------------------------------------------------------------------
// Plugin face: HostSession firehose feed (fake ctx, settings service)
// ---------------------------------------------------------------------------

describe("plugin face: HostSession", () => {
	function makeCtx(settingsValue: unknown) {
		const handlers = new Map<string, ((...args: any[]) => void)[]>()
		const handles: { agent: any }[] = []
		const ctx: any = {
			on(event: string, handler: (...args: any[]) => void) {
				handlers.set(event, [...(handlers.get(event) ?? []), handler])
			},
			get(key: string) {
				if (key === "settings") return { describe: async () => [{ ns: "dsh-opentui", value: settingsValue }], mutate: async () => {} }
				if (key === "sessionPersistence") return { list: async () => [], open: async () => ({ read: async () => ({ events: [] }), close: async () => {} }) }
				return undefined
			},
			agents: {
				async create(options: any) {
					const agent = {
						id: `agent-${handles.length + 1}`,
						session: { id: String(options.sessionId), snapshotEvents: () => [] },
						status: "idle",
						followup: () => {},
						steer: () => {},
					}
					const handle = { agent, dispose: () => {} }
					handles.push(handle)
					return handle
				},
			},
		}
		const emit = (event: string, ...args: any[]) => {
			for (const handler of handlers.get(event) ?? []) handler(...args)
		}
		return { ctx, emit, handles }
	}

	async function startSession(env: ReturnType<typeof makeCtx>, session: HostSession): Promise<string> {
		const pending = session.turn("go", {
			onThinkingDelta: () => {},
			onContentDelta: () => {},
			onTurnEnd: () => {},
			onApprove: async () => true,
			onToolRun: () => {},
			onError: () => {},
		})
		await flush()
		const agentId = `agent-${env.handles.length}`
		env.emit("agent/status", { agent: { id: agentId }, status: "running" })
		env.emit("agent/status", { agent: { id: agentId }, status: "idle" })
		await pending
		return session.currentSessionId()!
	}

	test("child agent gets the wrap-up steer at the cap and a cancel at cap + grace", async () => {
		const env = makeCtx({ maxRounds: 3, maxRoundsGrace: 2 })
		const session = new HostSession(env.ctx)
		const parentId = await startSession(env, session)
		const steered: string[] = []
		const cancels: unknown[][] = []
		const child = {
			id: "child-1",
			header: { parentSession: parentId, origin: "subagent" },
			agent: {
				steer: (message: any) => steered.push(message.content[0].text),
				cancel: (...args: unknown[]) => cancels.push(args),
			},
		}
		const round = (n: number) =>
			env.emit("session/event", child, { type: "assistant/message", data: { message: { content: [{ type: "text", text: `r${n}` }] } } })
		round(1)
		await flush()
		round(2)
		round(3)
		await flush()
		expect(steered).toHaveLength(1)
		expect(steered[0]).toContain("Round limit reached (3")
		round(4)
		await flush()
		expect(cancels).toHaveLength(0)
		round(5)
		expect(cancels).toEqual([[{ kind: "user" }, { keepInbox: true }]])
		round(6)
		expect(cancels).toHaveLength(1)
	})

	test("no dsh-opentui settings = no enforcement", async () => {
		const env = makeCtx(undefined)
		const session = new HostSession(env.ctx)
		const parentId = await startSession(env, session)
		const steered: string[] = []
		const cancels: unknown[] = []
		const child = {
			id: "child-2",
			header: { parentSession: parentId, origin: "subagent" },
			agent: { steer: (m: any) => steered.push(m), cancel: () => cancels.push(1) },
		}
		for (let n = 1; n <= 30; n++) {
			env.emit("session/event", child, { type: "assistant/message", data: { message: { content: [] } } })
			await flush()
		}
		expect(steered).toHaveLength(0)
		expect(cancels).toHaveLength(0)
	})

	// D3's instrumented repro: firehose child session objects may never
	// carry `.agent` (#adoptChild captures nothing), which left the wrap-up
	// permanently undelivered and the stage-2 force-stop unreachable. The
	// delivery now falls back to the in-process `subagents` service.
	test("no firehose agent handle: wrap-up rides the subagents service, force-stop lands exactly once", async () => {
		const env = makeCtx({ maxRounds: 3, maxRoundsGrace: 2 })
		const prompts: any[] = []
		const interrupts: unknown[][] = []
		const baseGet = env.ctx.get.bind(env.ctx)
		env.ctx.get = (key: string) => {
			if (key === "subagents") {
				return {
					prompt: async (request: any) => {
						prompts.push(request)
						return {}
					},
					interruptByParent: (...args: unknown[]) => {
						interrupts.push(args)
						return {}
					},
				}
			}
			return baseGet(key)
		}
		const session = new HostSession(env.ctx)
		const parentId = await startSession(env, session)
		// The repro shape: adopted via header, NO `.agent` on the session object.
		const child = { id: "child-9", header: { parentSession: parentId, origin: "subagent" } }
		const round = (n: number) =>
			env.emit("session/event", child, { type: "assistant/message", data: { message: { content: [{ type: "text", text: `r${n}` }] } } })
		round(1)
		await flush()
		round(2)
		round(3)
		await until(() => prompts.length === 1)
		expect(prompts[0]).toMatchObject({ parentSessionId: parentId, childSessionId: "child-9", mode: "continuable", delivery: "steer" })
		expect(prompts[0].content[0].text).toContain("Round limit reached (3")
		await flush()
		// The async delivery latched: the ⚡ marker folded, stage 2 is armed.
		expect(session.subagentViews().find((v) => v.id === "child-9")?.injectedRound).toBe(3)
		round(4)
		await flush()
		expect(interrupts).toHaveLength(0)
		round(5)
		await flush()
		expect(interrupts).toEqual([["child-9", parentId, "continuable"]])
		expect(session.subagentViews().find((v) => v.id === "child-9")?.status).toBe("cancelled")
		round(6) // the stop's own settlement re-entry
		await flush()
		expect(interrupts).toHaveLength(1) // exactly once
	})

	test("per-agent maxRounds resolves through the [fg] label prefix (agent file cap wins over the global)", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "dsh-opentui-agents-"))
		const prevHome = process.env.DSH_HOME
		process.env.DSH_HOME = tmp
		try {
			mkdirSync(join(tmp, "agents"), { recursive: true })
			writeFileSync(join(tmp, "agents", "looper.md"), "---\nname: looper\nmaxRounds: 5\n---\nbody")
			const env = makeCtx({ maxRounds: 3, maxRoundsGrace: 1 })
			const session = new HostSession(env.ctx)
			const parentId = await startSession(env, session)
			const steered: string[] = []
			const cancels: unknown[][] = []
			const child = {
				id: "child-l",
				header: { parentSession: parentId, origin: "subagent" },
				agent: { steer: (m: any) => steered.push(m.content[0].text), cancel: (...a: unknown[]) => cancels.push(a) },
			}
			// The descriptor label carries the foreground namespace — this is
			// what used to make the per-agent frontmatter unresolvable.
			env.emit("session/event", child, { type: "subagent/descriptor", data: { label: "[fg] looper" } })
			const round = (n: number) =>
				env.emit("session/event", child, { type: "assistant/message", data: { message: { content: [{ type: "text", text: `r${n}` }] } } })
			for (let n = 1; n <= 4; n++) {
				round(n)
				await flush()
			}
			expect(steered).toHaveLength(0) // the global cap 3 did NOT fire
			round(5)
			await flush()
			expect(steered).toHaveLength(1)
			expect(steered[0]).toContain("Round limit reached (5")
			round(6) // cap 5 + grace 1
			expect(cancels).toEqual([[{ kind: "user" }, { keepInbox: true }]])
		} finally {
			if (prevHome === undefined) delete process.env.DSH_HOME
			else process.env.DSH_HOME = prevHome
			rmSync(tmp, { recursive: true, force: true })
		}
	})
})
