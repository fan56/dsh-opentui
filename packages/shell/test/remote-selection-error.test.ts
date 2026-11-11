// Selection-failure propagation (model/effort switching): the seam adapters
// REJECT on a failed `session/selectModel` (web profile parity — a failed
// select is surfaced, never a silent console.error), and the two SILENT-path
// failures (the fire-and-forget `switchModel`, the staged route's re-send
// onto a freshly created session) land in `lastSelectionError()` so the
// next read/command can report them instead of trusting the optimistic
// label. Fake connection + fake mux sockets, real wire frames.
import { describe, expect, test } from "bun:test"
import { RemoteSessionSeam } from "../src/client/session-seam-adapter.ts"
import { RemoteHostSession } from "../src/client/remote-host-session.ts"
import { RemoteRpcError, type ClientConnection } from "../src/client/transport.ts"
import { FakeConnection, FakeMuxSocket, eventFrame, rpcOf, snapshotFrame, until, type RpcHandler } from "./client-fakes.ts"
import type { TurnCallbacks } from "../src/agent/loop.ts"

function makeSession(options: { cwd?: string; rpcHandler?: RpcHandler } = {}): {
	connection: FakeConnection
	session: RemoteHostSession
	sockets: FakeMuxSocket[]
	lastSocket(): FakeMuxSocket
} {
	const connection = new FakeConnection()
	if (options.rpcHandler) connection.rpcHandler = options.rpcHandler
	const sockets: FakeMuxSocket[] = []
	const session = new RemoteHostSession({
		connection: connection as unknown as ClientConnection,
		cookieHeader: "dsh-auth-x=v1.test",
		cwd: options.cwd ?? "/tmp/workspace",
		socketFactory: () => {
			const socket = new FakeMuxSocket()
			sockets.push(socket)
			return socket
		},
	})
	return { connection, session, sockets, lastSocket: () => sockets[sockets.length - 1]! }
}

function callbacks(): { cb: TurnCallbacks; log: { content: string[]; turnEnds: number[]; errors: string[] } } {
	const log = { content: [] as string[], turnEnds: [] as number[], errors: [] as string[] }
	const cb: TurnCallbacks = {
		onThinkingDelta: () => {},
		onContentDelta: (t) => log.content.push(t),
		onTurnEnd: (u) => log.turnEnds.push(u.prompt + u.completion),
		onApprove: async () => true,
		onToolRun: () => {},
		onError: (m) => log.errors.push(m),
	}
	return { cb, log }
}

describe("selection failure propagation (model/effort)", () => {
	test("a failed staged re-send is perceivable via lastSelectionError and cleared by the next accepted selection", async () => {
		let selectCalls = 0
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "session/create") return { sessionId: "sess-se1" }
				if (method === "session/selectModel") {
					selectCalls++
					if (selectCalls === 1) throw new RemoteRpcError("session/failed", "provider rejected the route", {})
					const req = args["request"] as Record<string, unknown>
					return { selected: { provider: req.provider, model: req.model, reasoningEffort: req.reasoningEffort } }
				}
				if (method === "session/prompt") return { accepted: true }
				return {}
			},
		})
		// the sessionless /model pick stages (the command path's sessionless
		// selectModel lands in the same #pendingModel slot)
		h.session.switchModel("deepseek", "deepseek-reasoner", "low")
		expect(h.session.lastSelectionError()).toBeUndefined()
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		// the fresh session's re-send fails: the next READ knows (while the
		// label still shows the optimistic staged route)
		await until(() => rpcOf(h.connection, "session/selectModel") !== undefined)
		await until(() => h.session.lastSelectionError() !== undefined)
		expect(h.session.lastSelectionError()).toContain("staged deepseek/deepseek-reasoner")
		expect(h.session.lastSelectionError()).toContain("provider rejected the route")
		// the failure never broke the turn: the session still runs
		await until(() => h.sockets.length > 0)
		h.lastSocket().item(snapshotFrame("sess-se1"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		h.lastSocket().item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		await pending
		// a later ACCEPTED selection retires the failure
		await h.session.selectModel({ provider: "deepseek", model: "deepseek-chat" })
		expect(h.session.lastSelectionError()).toBeUndefined()
		await h.session.dispose()
	})

	test("a failed fire-and-forget switchModel on the live session lands in lastSelectionError", async () => {
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "session/create") return { sessionId: "sess-se2" }
				if (method === "session/prompt") return { accepted: true }
				if (method === "session/selectModel") {
					const req = args["request"] as Record<string, unknown>
					if (req.model === "deepseek-reasoner") throw new RemoteRpcError("session/failed", "boom", {})
					return { selected: { provider: req.provider, model: req.model } }
				}
				return {}
			},
		})
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		h.lastSocket().item(snapshotFrame("sess-se2"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		expect(h.session.lastSelectionError()).toBeUndefined()
		// fire-and-forget (void, no caller to reject into): the failure is
		// recorded for the next read instead of dying in console.error
		h.session.switchModel("deepseek", "deepseek-reasoner")
		await until(() => h.session.lastSelectionError() !== undefined)
		expect(h.session.lastSelectionError()).toBe("boom")
		// an accepted application retires it
		await h.session.selectModel({ provider: "deepseek", model: "deepseek-chat" })
		expect(h.session.lastSelectionError()).toBeUndefined()
		h.lastSocket().item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		await pending
		await h.session.dispose()
	})

	test("RemoteSessionSeam.selectModel/selectEffort REJECT on a host refusal (no silent catch)", async () => {
		const h = makeSession({
			rpcHandler: (method) => {
				if (method === "session/create") return { sessionId: "sess-se3" }
				if (method === "session/prompt") return { accepted: true }
				if (method === "session/selectModel") {
					throw new RemoteRpcError("session/failed", "provider rejected the route", {})
				}
				if (method === "session/projections") {
					return {
						kind: "sequenced",
						asOfSeq: 1,
						values: { modelSelection: { lastUsed: { provider: "deepseek", model: "deepseek-chat" } } },
					}
				}
				return {}
			},
		})
		const seam = new RemoteSessionSeam(h.session)
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		h.lastSocket().item(snapshotFrame("sess-se3"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		// selectModel: the rejection reaches the caller (was: swallowed into a
		// console.error + a resolving promise the command read as success)
		await expect(seam.selectModel("deepseek", "deepseek-reasoner")).rejects.toThrow("provider rejected the route")
		// selectEffort rides selectModel on the current route: same rejection
		await expect(seam.thinking.selectEffort("low")).rejects.toThrow("provider rejected the route")
		h.lastSocket().item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		await pending
		await h.session.dispose()
	})
})
