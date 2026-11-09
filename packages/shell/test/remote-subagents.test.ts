// Wave-3 subagent panel aggregation (audit row 33): parent-journal
// tool-workflow pairing, session/list adoption filters, api-session push
// folding, the child-follow transcript pump (address.kind:'subagent'), and
// the steer/interrupt wire shapes — fake rpc + fake mux sockets.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RemoteSubagentPanel, boundTail, descriptorOf, lastContentLine, totalTokensOf, type RemoteSubagentView } from "../src/client/remote-subagents.ts"
import type { HardStopRecord, SubagentRoundLimits } from "../src/subagent-policy.ts"
import { RemoteHostSession } from "../src/client/remote-host-session.ts"
import { RemoteRpcError, type ClientConnection } from "../src/client/transport.ts"
import { FakeConnection, FakeMuxSocket, rpcOf, snapshotFrame, streamFrame, until } from "./client-fakes.ts"
import type { TurnCallbacks } from "../src/agent/loop.ts"

type RpcHandler = (method: string, args: Record<string, unknown>) => unknown | Promise<unknown>

function makePanel(options: { parentId?: string; rpcHandler?: RpcHandler; limits?: () => SubagentRoundLimits; onHardStop?: (record: HardStopRecord) => void } = {}) {
	const rpcCalls: { method: string; args: Record<string, unknown> }[] = []
	const rpcHandler: RpcHandler =
		options.rpcHandler ??
		((method) => {
			if (method === "session/list") return { items: [] }
			if (method === "subagents/prompt") return { messageId: "m-1" }
			if (method === "subagents/interruptByParent") return { accepted: true }
			return {}
		})
	const sockets: FakeMuxSocket[] = []
	const updates: RemoteSubagentView[][] = []
	const panel = new RemoteSubagentPanel({
		rpc: async (method, args) => {
			rpcCalls.push({ method, args: args ?? {} })
			return await rpcHandler(method, args ?? {})
		},
		socketFactory: () => {
			const socket = new FakeMuxSocket()
			sockets.push(socket)
			return socket
		},
		parentId: () => options.parentId ?? "parent-1",
		onUpdate: (views) => updates.push(views),
		...(options.limits !== undefined ? { limits: options.limits } : {}),
		...(options.onHardStop !== undefined ? { onHardStop: options.onHardStop } : {}),
	})
	return { panel, rpcCalls, sockets, updates, lastSocket: () => sockets[sockets.length - 1]! }
}

function parentRecord(type: string, data: Record<string, unknown>): { type: string; seq: number; time: number; data: Record<string, unknown> } {
	return { type, seq: 1, time: Date.now(), data }
}

describe("subagent pure mappers", () => {
	test("descriptorOf reads the v3 descriptor fields", () => {
		expect(descriptorOf({ version: 3, mode: "one-shot", provider: "workflow", label: "search the tree" })).toEqual({
			mode: "one-shot",
			provider: "workflow",
			label: "search the tree",
		})
		expect(descriptorOf({ version: 3, mode: "continuable", provider: "explore", agentProvider: "zai", agentModel: "glm" })).toEqual({
			mode: "continuable",
			provider: "explore",
			model: "zai/glm",
		})
		expect(descriptorOf({})).toEqual({})
	})
	test("totalTokensOf scans the adapter field spellings", () => {
		expect(totalTokensOf({ totalTokens: 42 })).toBe(42)
		expect(totalTokensOf({ total_tokens: 7 })).toBe(7)
		expect(totalTokensOf({ inputTokens: 5 })).toBeUndefined()
		expect(totalTokensOf(undefined)).toBeUndefined()
	})
	test("lastContentLine takes the last NON-BLANK line, folded onto one row", () => {
		expect(lastContentLine("line one\nline two")).toBe("line two")
		expect(lastContentLine("hi\n\n")).toBe("hi")
		expect(lastContentLine("a\r\nb\rc")).toBe("c")
		expect(lastContentLine("  x \t y  ")).toBe("x y")
		expect(lastContentLine("")).toBeUndefined()
		expect(lastContentLine(undefined)).toBeUndefined()
	})
	test("boundTail keeps a bounded window (last line stays intact)", () => {
		expect(boundTail("hi")).toBe("hi")
		const long = "a".repeat(600) + "\nhi"
		expect(boundTail(long).endsWith("hi")).toBe(true)
		expect(boundTail(long).length).toBeLessThanOrEqual(480)
	})
})

describe("subagent panel aggregation", () => {
	test("parent-journal agent-start registers + agent-end settles (pairing parity)", () => {
		const { panel, updates } = makePanel()
		panel.foldParentRecord(parentRecord("tool-workflow/agent-start", { runId: "r1", seq: 0, label: "scout", childId: "child-a" }))
		expect(panel.known("child-a")).toBe(true)
		expect(panel.views()[0]).toMatchObject({ id: "child-a", label: "scout", status: "running", rounds: 0 })
		expect(updates.length).toBe(1)
		// re-registration with a new label updates in place
		panel.foldParentRecord(parentRecord("tool-workflow/agent-start", { runId: "r1", seq: 1, label: "scout II", childId: "child-b" }))
		panel.foldParentRecord(parentRecord("tool-workflow/agent-end", { runId: "r1", seq: 1, outcome: "failed" }))
		expect(panel.views().find((v) => v.id === "child-b")?.status).toBe("failed")
		panel.foldParentRecord(parentRecord("tool-workflow/agent-end", { runId: "r1", seq: 0, outcome: "succeeded" }))
		expect(panel.views().find((v) => v.id === "child-a")?.status).toBe("completed")
		expect(updates.length).toBeGreaterThanOrEqual(3)
		panel.stop()
	})

	test("refreshFromList adopts ONLY this parent's subagent-origin rows", async () => {
		const { panel, rpcCalls } = makePanel({
			parentId: "parent-1",
			rpcHandler: (method) => {
				if (method === "session/list") {
					return {
						items: [
							{ sessionId: "child-ours", parentSessionId: "parent-1", origin: "subagent", running: true },
							{ sessionId: "child-other", parentSessionId: "parent-X", origin: "subagent", running: true },
							{ sessionId: "plain", parentSessionId: "parent-1", running: true },
						],
					}
				}
				return {}
			},
		})
		await panel.refreshFromList()
		expect(rpcCalls[0]).toEqual({ method: "session/list", args: { _request: {} } })
		expect(panel.views().map((v) => v.id)).toEqual(["child-ours"])
		// a later list with running:false settles the adopted child
		panel.stop()
	})

	test("api-session/status + removed pushes fold without a list round-trip", () => {
		const { panel } = makePanel()
		panel.foldParentRecord(parentRecord("tool-workflow/agent-start", { runId: "r", seq: 0, label: "l", childId: "c1" }))
		panel.noteStatus("c1", false)
		expect(panel.views()[0]!.status).toBe("completed")
		panel.noteStatus("c1", true) // already settled — no resurrection
		expect(panel.views()[0]!.status).toBe("completed")
		panel.noteRemoved("c1")
		expect(panel.views()).toEqual([])
		panel.stop()
	})

	test("child follow pump folds descriptor/message/tool rows into view + transcript", async () => {
		const { panel, lastSocket, updates } = makePanel()
		panel.foldParentRecord(parentRecord("tool-workflow/agent-start", { runId: "r", seq: 0, label: "scout", childId: "child-x" }))
		await until(() => lastSocket() !== undefined)
		const sock = lastSocket()
		// the child follow uses the subagent address + presentation stream
		expect(sock.openFrame.endpoint).toBe("session/follow")
		expect(sock.openFrame.payload.args.request.address).toEqual({
			kind: "subagent",
			parentSessionId: "parent-1",
			childSessionId: "child-x",
			mode: "unknown",
		})
		expect(sock.openFrame.payload.args.request.assistantStream).toBe(true)

		sock.item(snapshotFrame("child-x"))
		sock.item({
			type: "event",
			event: { type: "subagent/descriptor", seq: 1, time: Date.now(), data: { version: 3, mode: "continuable", provider: "explore", agentProvider: "zai", agentModel: "glm" } },
		})
		sock.item({
			type: "event",
			event: {
				type: "assistant/message",
				seq: 2,
				time: Date.now(),
				data: { message: { content: [{ type: "text", text: "line one\nline two" }] }, usage: { totalTokens: 120 } },
			},
		})
		sock.item({ type: "event", event: { type: "tool/call", seq: 3, time: Date.now(), data: { name: "grep", arguments: "{\"pattern\":\"x\"}" } } })
		sock.item({ type: "event", event: { type: "tool/result", seq: 4, time: Date.now(), data: {} } })
		await until(() => panel.transcript("child-x").length >= 4)

		const view = panel.views()[0]!
		expect(view.label).toBe("scout")
		expect(view.model).toBe("zai/glm")
		expect(view.rounds).toBe(1)
		expect(view.tokens).toBe(120)
		expect(view.lastLine).toBe("line two")
		expect(panel.transcript("child-x")).toEqual(["line one", "line two", "▶ grep {\"pattern\":\"x\"}", "  ⎿ done"])

		// live delta scrolls lastLine (firehose parity)
		sock.item(streamFrame({ type: "chunk", attemptId: "a", revision: 0, index: 0, time: 1, chunk: { type: "text-delta", index: 0, text: "…still working" } }))
		await until(() => panel.views()[0]!.lastLine?.includes("still working"))
		// turn/end settles a continuable child
		sock.item({ type: "event", event: { type: "turn/end", seq: 5, time: Date.now(), data: { turn: 1, reason: { kind: "completed" } } } })
		await until(() => panel.views()[0]!.status === "completed")
		expect(updates.length).toBeGreaterThanOrEqual(4)
		panel.stop()
		expect(lastSocket().closed).toBe(true)
	})

	test("tail: reasoning deltas scroll it, and a child's tool OUTPUT lands as the content tail", async () => {
		const { panel, lastSocket } = makePanel()
		panel.foldParentRecord(parentRecord("tool-workflow/agent-start", { runId: "r", seq: 0, label: "printer", childId: "child-hi" }))
		await until(() => lastSocket() !== undefined)
		const sock = lastSocket()
		sock.item(snapshotFrame("child-hi"))
		// reasoning delta = the child's own visible output (tui-pi parity)
		sock.item(streamFrame({ type: "chunk", attemptId: "a", revision: 0, index: 0, time: 1, chunk: { type: "reasoning-delta", index: 0, text: "thinking…" } }))
		await until(() => panel.views()[0]!.lastLine === "thinking…")
		// a `bash` loop printing "hi" only ever exposes its output in the
		// durable tool/result — the tail must follow it.
		sock.item({
			type: "event",
			event: {
				type: "tool/result",
				seq: 2,
				time: Date.now(),
				data: { message: { content: [{ type: "text", text: "hi\nhi\nhi\n" }] }, isError: false },
			},
		})
		await until(() => panel.views()[0]!.lastLine === "hi")
		// rounds stay assistant/message-counted; a tool result is not a round
		expect(panel.views()[0]!.rounds).toBe(0)
		panel.stop()
	})

	test("snapshot replay folds the journal descriptor — late join gets the label (D2 e2e finding)", async () => {
		const { panel, lastSocket } = makePanel()
		// the client face adopts list-swept children with the bare-id
		// fallback: no parent-journal agent-start row carries a label
		panel.foldParentRecord(parentRecord("tool-workflow/agent-start", { runId: "r", seq: 0, label: "", childId: "child-late" }))
		expect(panel.views()[0]!.label).toBe("subagent child-la")
		await until(() => lastSocket() !== undefined)
		const sock = lastSocket()
		// the follow's first item is the snapshot: the child journal records,
		// including the seq-0 subagent/descriptor the live stream never
		// re-sends ("[fg] " is the run-agent foreground namespace)
		sock.item(snapshotFrame("child-late", {
			records: [
				{ type: "event", event: { type: "subagent/descriptor", seq: 0, time: Date.now(), data: { version: 3, mode: "continuable", provider: "spawn", label: "[fg] looper", agentProvider: "zai", agentModel: "glm" } } },
				{ type: "event", event: { type: "assistant/message", seq: 1, time: Date.now(), data: { message: { content: [{ type: "text", text: "rounding\nloop tick" }] } } } },
			],
		}))
		await until(() => panel.views()[0]!.label === "looper")
		const view = panel.views()[0]!
		expect(view.label).toBe("looper")
		expect(view.lastLine).toBe("loop tick")
		panel.stop()
	})

	test("snapshot replay does not feed the maxRounds ladder (no force-stop re-arm)", async () => {
		const hardStops: unknown[] = []
		const rpcCalls: { method: string }[] = []
		const { panel, lastSocket } = makePanel({
			limits: () => ({ maxRounds: 1, maxRoundsGrace: 1 }),
			onHardStop: (record) => hardStops.push(record),
			rpcHandler: (method) => {
				rpcCalls.push({ method })
				if (method === "session/list") return { items: [] }
				if (method === "subagents/prompt") return { messageId: "m-1" }
				if (method === "subagents/interruptByParent") return { accepted: true }
				return {}
			},
		})
		panel.foldParentRecord(parentRecord("tool-workflow/agent-start", { runId: "r", seq: 0, label: "", childId: "child-cap" }))
		await until(() => lastSocket() !== undefined)
		const sock = lastSocket()
		// two past assistant rounds at/over the cap — a replay must count
		// them (display) but never fire the ladder for rounds the host
		// already ruled on
		sock.item(snapshotFrame("child-cap", {
			records: [
				{ type: "event", event: { type: "assistant/message", seq: 1, time: Date.now(), data: { message: { content: [{ type: "text", text: "round one" }] } } } },
				{ type: "event", event: { type: "assistant/message", seq: 2, time: Date.now(), data: { message: { content: [{ type: "text", text: "round two" }] } } } },
			],
		}))
		await until(() => panel.views()[0]!.rounds === 2)
		expect(panel.views()[0]!.rounds).toBe(2)
		expect(hardStops).toEqual([])
		expect(rpcCalls.some((c) => c.method === "subagents/prompt")).toBe(false)
		// LIVE frames keep feeding the ladder: count 3 (≥ cap) delivers the
		// wrap-up, count 4 (≥ cap + grace) force-stops
		sock.item({ type: "event", event: { type: "assistant/message", seq: 3, time: Date.now(), data: { message: { content: [{ type: "text", text: "round three" }] } } } })
		await until(() => rpcCalls.some((c) => c.method === "subagents/prompt"))
		sock.item({ type: "event", event: { type: "assistant/message", seq: 4, time: Date.now(), data: { message: { content: [{ type: "text", text: "round four" }] } } } })
		await until(() => hardStops.length > 0)
		expect(hardStops.length).toBe(1)
		panel.stop()
	})

	test("steer rides subagents/prompt with the continuable steer request", async () => {
		const { panel, rpcCalls } = makePanel()
		panel.foldParentRecord(parentRecord("tool-workflow/agent-start", { runId: "r", seq: 0, label: "l", childId: "c9" }))
		const ok = await panel.steer("c9", "focus on tests")
		expect(ok).toBe(true)
		const call = rpcCalls.find((c) => c.method === "subagents/prompt")!
		const request = call.args.request as Record<string, unknown>
		expect(request.parentSessionId).toBe("parent-1")
		expect(request.childSessionId).toBe("c9")
		expect(request.mode).toBe("continuable")
		expect(request.delivery).toBe("steer")
		expect(request.content).toEqual([{ type: "text", text: "focus on tests" }])
		expect(typeof request.requestId).toBe("string")
		const detailed = await panel.steerChildDetailed("c9", "again")
		expect(detailed).toEqual({ ok: true })
	})

	test("host policy rejection surfaces typed (not-resumable) — false + typed reason", async () => {
		const { panel } = makePanel({
			rpcHandler: (method) => {
				if (method === "subagents/prompt") {
					throw new RemoteRpcError("subagent/not-resumable", "child is one-shot and settled", { childSessionId: "c1" })
				}
				return {}
			},
		})
		panel.foldParentRecord(parentRecord("tool-workflow/agent-start", { runId: "r", seq: 0, label: "l", childId: "c1" }))
		expect(await panel.steer("c1", "nope")).toBe(false)
		const detailed = await panel.steerChildDetailed("c1", "nope")
		expect(detailed.ok).toBe(false)
		expect(detailed.ok ? "" : detailed.reason).toContain("subagent/not-resumable")
		// an unknown child is false without a wire call (HostSession parity)
		expect(await panel.steer("ghost", "x")).toBe(false)
	})

	test("interrupt rides subagents/interruptByParent", async () => {
		const { panel, rpcCalls } = makePanel()
		await panel.interrupt("c2")
		expect(rpcCalls.find((c) => c.method === "subagents/interruptByParent")!.args).toEqual({
			childSessionId: "c2",
			parentSessionId: "parent-1",
			mode: "continuable",
		})
	})
})

describe("facade subagent wiring", () => {
	test("childTranscript/steerChild/interruptChild/subagentViews ride the panel", async () => {
		const { session, connection, lastSocket } = await facadeWithChild()
		// the panel adopted the child via the parent-journal row of the turn
		await until(() => session.subagentViews().length > 0)
		expect(session.subagentViews()[0]!.id).toBe("child-1")
		// transcript flows from the child follow
		lastSocket().item(snapshotFrame("child-1"))
		lastSocket().item({ type: "event", event: { type: "assistant/message", seq: 1, time: Date.now(), data: { message: { content: [{ type: "text", text: "hello from child" }] } } } })
		await until(() => session.childTranscript("child-1").length > 0)
		expect(session.childTranscript("child-1")[0]).toBe("hello from child")
		// steer: adopted child → sync true; the async detail rides the wire
		expect(session.steerChild("child-1", "go")).toBe(true)
		expect((await session.steerChildDetailed("child-1", "go")).ok).toBe(true)
		expect(rpcOf(connection, "subagents/prompt")).toBeDefined()
		expect(session.steerChild("ghost", "go")).toBe(false)
		await session.dispose()
	})
})

// maxRounds hard-stop ladder on the client face (the B5 e2e finding's fix):
// the caps ride the CLIENT config layer — the profile config.json
// `maxRounds`/`maxRoundsGrace` keys through configLoad() — not the retired
// plugin face's settings ns `dsh-opentui` (no owning entry anymore → the
// describe-based provider answered defaults forever and the ladder stayed
// disabled: the unbounded looper of e2e 62). Real facade, real panel, real
// policy: a scratch DSH_HOME profile drives the cap; child assistant
// messages on the follow pump count the rounds.
describe("maxRounds ladder caps from the client configLoad seam", () => {
	const childAssistantMessage = (sock: FakeMuxSocket, seq: number) =>
		sock.item({
			type: "event",
			event: { type: "assistant/message", seq, time: Date.now(), data: { message: { content: [{ type: "text", text: `round ${seq}` }] } } },
		})

	test("profile config.json caps drive wrap-up + force-stop (real facade path)", async () => {
		const dshHome = mkdtempSync(join(tmpdir(), "dsh-ladder-"))
		const profileDir = join(dshHome, "profiles", "opentui")
		mkdirSync(profileDir, { recursive: true })
		writeFileSync(join(profileDir, "config.json"), JSON.stringify({ maxRounds: 2, maxRoundsGrace: 1 }))
		try {
			const { session, connection, lastSocket } = await facadeWithChild({ dshHome })
			await until(() => session.subagentViews().length > 0)
			// Round 1: below the cap — nothing fires.
			childAssistantMessage(lastSocket(), 1)
			// Round 2 = cap: stage 1, the wrap-up steer (microtask-deferred).
			childAssistantMessage(lastSocket(), 2)
			await until(() => rpcOf(connection, "subagents/prompt") !== undefined)
			expect(session.subagentViews()[0]!.injectedRound).toBe(2)
			expect(session.subagentViews()[0]!.hardStopRound).toBeUndefined()
			// Round 3 = cap + grace: stage 2, the force-stop.
			childAssistantMessage(lastSocket(), 3)
			await until(() => rpcOf(connection, "subagents/interruptByParent") !== undefined)
			await until(() => session.subagentViews()[0]!.hardStopRound === 3)
			expect(session.subagentViews()[0]!.status).toBe("cancelled")
			// Stage 2 is latched — a late round never re-fires the stop.
			childAssistantMessage(lastSocket(), 4)
			await new Promise((resolve) => setTimeout(resolve, 20))
			expect(connection.rpcCalls.filter((c) => c.method === "subagents/interruptByParent").length).toBe(1)
			await session.dispose()
		} finally {
			rmSync(dshHome, { recursive: true, force: true })
		}
	})

	test("no config caps = ladder disabled (defaults stay off, the staged-semantics parity)", async () => {
		const { session, connection, lastSocket } = await facadeWithChild()
		await until(() => session.subagentViews().length > 0)
		for (const seq of [1, 2, 3, 4]) childAssistantMessage(lastSocket(), seq)
		await new Promise((resolve) => setTimeout(resolve, 30))
		expect(rpcOf(connection, "subagents/prompt")).toBeUndefined()
		expect(rpcOf(connection, "subagents/interruptByParent")).toBeUndefined()
		expect(session.subagentViews()[0]!.hardStopRound).toBeUndefined()
		await session.dispose()
	})
})

// Facade harness: drive one main turn that emits a tool-workflow/agent-start
// journal row, so the panel adopts through the real #followSink.onRecord path.
async function facadeWithChild(opts: { dshHome?: string } = {}) {
	const connection = new FakeConnection()
	connection.rpcHandler = (method) => {
		if (method === "session/create") return { sessionId: "main-1" }
		if (method === "session/prompt") return { accepted: true }
		if (method === "subagents/prompt") return { messageId: "m" }
		if (method === "session/list") return { items: [] }
		return {}
	}
	const sockets: FakeMuxSocket[] = []
	const session = new RemoteHostSession({
		connection: connection as unknown as ClientConnection,
		cookieHeader: "dsh-auth-x=v1.test",
		cwd: "/tmp/workspace",
		...(opts.dshHome !== undefined ? { dshHome: opts.dshHome } : {}),
		socketFactory: () => {
			const socket = new FakeMuxSocket()
			sockets.push(socket)
			return socket
		},
	})
	const cb: TurnCallbacks = {
		onThinkingDelta: () => {},
		onContentDelta: () => {},
		onTurnEnd: () => {},
		onApprove: async () => true,
		onToolRun: () => {},
		onError: () => {},
		onSubagentUpdate: () => {},
	}
	const pending = session.turn("run", cb)
	await until(() => sockets.length > 0)
	const mainSock = sockets[0]!
	mainSock.item(snapshotFrame("main-1"))
	await until(() => rpcOf(connection, "session/prompt") !== undefined)
	// the parent journal carries the workflow registration row
	mainSock.item({ type: "event", event: { type: "tool-workflow/agent-start", seq: 2, time: Date.now(), data: { runId: "r", seq: 0, label: "scout", childId: "child-1" } } })
	mainSock.item({ type: "event", event: { type: "turn/end", seq: 3, time: Date.now(), data: { turn: 1, reason: { kind: "completed" } } } })
	await pending
	// after turn end: main follow closed, child follow opened
	await until(() => sockets.length > 1)
	return { session, connection, lastSocket: () => sockets[sockets.length - 1]! }
}
