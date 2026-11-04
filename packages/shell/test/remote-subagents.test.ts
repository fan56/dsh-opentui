// Wave-3 subagent panel aggregation (audit row 33): parent-journal
// tool-workflow pairing, session/list adoption filters, api-session push
// folding, the child-follow transcript pump (address.kind:'subagent'), and
// the steer/interrupt wire shapes — fake rpc + fake mux sockets.
import { describe, expect, test } from "bun:test"
import { RemoteSubagentPanel, descriptorOf, totalTokensOf, type RemoteSubagentView } from "../src/client/remote-subagents.ts"
import { RemoteHostSession } from "../src/client/remote-host-session.ts"
import { RemoteRpcError, type ClientConnection } from "../src/client/transport.ts"
import { FakeConnection, FakeMuxSocket, rpcOf, snapshotFrame, streamFrame, until } from "./client-fakes.ts"
import type { TurnCallbacks } from "../src/agent/loop.ts"

type RpcHandler = (method: string, args: Record<string, unknown>) => unknown | Promise<unknown>

function makePanel(options: { parentId?: string; rpcHandler?: RpcHandler } = {}) {
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

// Facade harness: drive one main turn that emits a tool-workflow/agent-start
// journal row, so the panel adopts through the real #followSink.onRecord path.
async function facadeWithChild() {
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
