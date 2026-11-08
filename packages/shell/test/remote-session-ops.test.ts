// RemoteSessionOps wave-2 cluster tests (audit rows 12–20, 26, 27): fake
// ClientConnection + fake mux sockets deliver the wire frames
// (`session/list`, `session/page`, `session/search`, `session/rename`,
// `session/fork`, `skills/list`, `commands/list|execute`) and assert the
// HostSession-shaped results plus the client-side retention filter, the
// journal paging, and the RemoteTailSession row/gap-repair behavior.
import { describe, expect, test } from "bun:test"
import {
	groupTurns,
	journalToTranscriptRows,
	RemoteSessionOps,
	RemoteTailSession,
	sortJournal,
	tailRowsFromEntries,
	type RemoteJournalEntry,
} from "../src/client/remote-session-ops.ts"
import { ClientConnection } from "../src/client/transport.ts"
import { FakeConnection, FakeMuxSocket, until, type RpcHandler } from "./client-fakes.ts"

function makeOps(rpcHandler: RpcHandler): { connection: FakeConnection; ops: RemoteSessionOps; sockets: FakeMuxSocket[]; lastSocket(): FakeMuxSocket } {
	const connection = new FakeConnection()
	connection.rpcHandler = rpcHandler
	const sockets: FakeMuxSocket[] = []
	const ops = new RemoteSessionOps({
		rpc: (method, args) => connection.rpc(method, args),
		socketFactory: () => {
			const socket = new FakeMuxSocket()
			sockets.push(socket)
			return socket
		},
	})
	return { connection, ops, sockets, lastSocket: () => sockets[sockets.length - 1]! }
}

function journal(type: string, seq: number, data: Record<string, unknown>): RemoteJournalEntry {
	return { type, seq, time: seq, data }
}

describe("journal mappers", () => {
	test("journalToTranscriptRows maps user/assistant rows and honors skip", () => {
		const entries = [
			journal("turn/start", 1, { turn: 1 }),
			journal("user/message", 2, { source: { kind: "user" }, content: [{ type: "text", text: "hello" }] }),
			journal("tool/call", 3, { callId: "c1", name: "bash", arguments: "{}" }),
			journal("assistant/message", 4, { message: { content: [{ type: "text", text: "hi" }, { type: "image" }] } }),
			// injected runtime context: user/message without a user source
			journal("user/message", 5, { content: [{ type: "text", text: "system context" }] }),
		]
		expect(journalToTranscriptRows(entries)).toEqual([
			{ kind: "user", text: "hello" },
			{ kind: "assistant", text: "hi" },
			// host-session.storedTranscript parity: sourceless user/messages
			// (injected runtime context) ARE painted as transcript rows
			{ kind: "user", text: "system context" },
		])
		// skip drops the first N durable records (host-session parity), not rows
		expect(journalToTranscriptRows(entries, 2)).toEqual([
			{ kind: "assistant", text: "hi" },
			{ kind: "user", text: "system context" },
		])
	})

	test("batch V1: journalToTranscriptRows pairs settled tool calls into tool rows", () => {
		const entries = [
			journal("tool/call", 1, { callId: "c1", name: "bash", arguments: '{"command":"ls -la"}' }),
			journal("tool/result", 2, { callId: "c1", output: { content: [{ type: "text", text: "file1\nfile2" }] } }),
			// c2 never settles (mid-turn resume) — no fabricated row.
			journal("tool/call", 3, { callId: "c2", name: "read", arguments: '{"file_path":"/x"}' }),
			// errored result keeps the ok mirror false (isError placement parity)
			journal("tool/call", 4, { callId: "c3", name: "bash", arguments: "{}" }),
			journal("tool/result", 5, { callId: "c3", isError: true, message: { toolCallId: "c3", isError: true } }),
		]
		const rows = journalToTranscriptRows(entries)
		expect(rows).toHaveLength(2)
		const ok = rows[0] as { kind: string; name: string; args: string; ok: boolean; brief: string }
		expect(ok.kind).toBe("tool")
		expect(ok.name).toBe("bash")
		expect(ok.args).toBe('{"command":"ls -la"}')
		expect(ok.ok).toBe(true)
		expect(ok.brief.startsWith('{"content":[{"type":"text","text":"file1')).toBe(true)
		const bad = rows[1] as { kind: string; name: string; ok: boolean; brief: string }
		expect(bad.kind).toBe("tool")
		expect(bad.name).toBe("bash")
		expect(bad.ok).toBe(false)
	})

	test("groupTurns brackets completed turns with previews and seqEnd fork points", () => {
		const entries = [
			journal("turn/start", 1, { turn: 1 }),
			journal("user/message", 2, { source: { kind: "user" }, content: [{ type: "text", text: "first question" }] }),
			journal("assistant/message", 3, { message: { content: [{ type: "text", text: "answer one" }] } }),
			journal("turn/end", 4, { turn: 1, reason: { kind: "completed" } }),
			journal("turn/start", 5, { turn: 2 }),
			journal("user/message", 6, { source: { kind: "user" }, content: [{ type: "text", text: "second" }] }),
			// turn 2 still open (mid-flight): dropped from the completed list
		]
		const turns = groupTurns(entries)
		expect(turns).toEqual([
			{ turn: 1, seqEnd: 4, preview: "first question" },
		])
	})

	test("tailRowsFromEntries maps the durable subset into the sink row shape", () => {
		const rows = tailRowsFromEntries([
			journal("user/message", 1, { source: { kind: "user" }, content: [{ type: "text", text: "go" }] }),
			journal("assistant/message", 2, { message: { content: [{ type: "text", text: "ok" }] } }),
			journal("tool/call", 3, { name: "bash", arguments: '{"cmd":"ls"}' }),
			journal("tool/result", 4, { isError: true }),
			journal("todo/write", 5, { todos: [] }),
		])
		expect(rows).toEqual([
			{ kind: "user", text: "go", final: true },
			{ kind: "assistant", text: "ok", final: true },
			{ kind: "assistant", text: '⚙ bash {"cmd":"ls"}', final: true },
			{ kind: "assistant", text: "  ⎿ failed", final: true },
		])
	})

	test("sortJournal orders pages oldest-first", () => {
		expect(sortJournal([journal("turn/end", 9, {}), journal("turn/start", 1, {})]).map((e) => e.seq)).toEqual([1, 9])
	})
})

describe("RemoteSessionOps", () => {
	test("listSessions applies the retention filter: subagent rows out, cutoff, newest-first, capped", async () => {
		const now = Date.now()
		const h = makeOps((method) => {
			if (method === "session/list") {
				return {
					items: [
						{ sessionId: "old", updatedAt: now - 30 * 86400000, running: false, blank: false },
						{ sessionId: "child", updatedAt: now, running: false, blank: false, origin: "subagent" },
						{ sessionId: "newest", updatedAt: now, running: true, blank: false, projections: { kind: "cached", asOfSeq: 0, values: { title: "My session" } } },
						{ sessionId: "mid", updatedAt: now - 1000, running: false, blank: false },
						{ sessionId: "untitled", updatedAt: now - 2000, running: false, blank: true },
					],
				}
			}
			return {}
		})
		const rows = await h.ops.listSessions({ limit: 2, retentionDays: 7 })
		// retention cutoff removes "old"; origin subagent removes "child";
		// sort newest-first; limit 2 caps. Title from the projection value.
		expect(rows.map((r) => r.id)).toEqual(["newest", "mid"])
		expect(rows[0]!.title).toBe("My session")
		expect(rows[1]!.title).toBe("")
		// the wire arg key mirrors the typert parameter name
		expect(h.connection.rpcCalls[0]).toMatchObject({ method: "session/list", args: { _request: {} } })
	})

	test("listSessions survives a failing RPC with []", async () => {
		const h = makeOps(() => {
			throw new Error("down")
		})
		expect(await h.ops.listSessions()).toEqual([])
	})

	test("storedTranscript drains follow snapshot + page fills into transcript rows", async () => {
		const h = makeOps((method, args) => {
			if (method === "session/page") {
				const req = args["request"] as Record<string, unknown>
				expect(req.address).toEqual({ kind: "session", sessionId: "s1" })
				expect(req.throughSeq).toBe(9)
				// first page: beforeSeq = lowest snapshot seq (2)
				const before = req.beforeSeq as number
				if (before === 2) {
					return {
						records: [
							{ type: "event", event: { type: "user/message", seq: 1, time: 1, data: { source: { kind: "user" }, content: [{ type: "text", text: "older question" }] } } },
						],
						hasMore: false,
					}
				}
				return { records: [], hasMore: false }
			}
			return {}
		})
		const pending = h.ops.storedTranscript("s1")
		await until(() => h.sockets.length > 0)
		const sock = h.lastSocket()
		expect(sock.openFrame.endpoint).toBe("session/follow")
		expect(sock.openFrame.payload.args).toEqual({ request: { address: { kind: "session", sessionId: "s1" } } })
		sock.item({
			type: "snapshot",
			header: { version: 1, id: "s1", createdAt: 0, isSeeded: false },
			cursor: 9,
			hasMore: true,
			records: [
				{ type: "event", event: { type: "user/message", seq: 2, time: 2, data: { source: { kind: "user" }, content: [{ type: "text", text: "question" }] } } },
				{ type: "event", event: { type: "assistant/message", seq: 3, time: 3, data: { message: { content: [{ type: "text", text: "answer" }] } } } },
			],
			projections: { asOfSeq: 9, values: {} },
		})
		const rows = await pending
		expect(rows).toEqual([
			{ kind: "user", text: "older question" },
			{ kind: "user", text: "question" },
			{ kind: "assistant", text: "answer" },
		])
	})

	test("searchSessions maps items and normalizes snippets (host-session parity)", async () => {
		const h = makeOps((method, args) => {
			expect(method).toBe("session/search")
			expect(args).toEqual({ request: { query: "fork point" } })
			return {
				items: [
					{ sessionId: "s9", snippet: "fork\n  point\t here" },
					{ sessionId: "", snippet: "no id" },
				],
				hasMore: true,
			}
		})
		expect(await h.ops.searchSessions("fork point")).toEqual([
			{ id: "s9", snippet: "fork point here" },
		])
	})

	test("rename sends the request envelope and answers normalized title + seq", async () => {
		const h = makeOps((method, args) => {
			expect(method).toBe("session/rename")
			expect(args).toEqual({ request: { sessionId: "s1", title: "My Plan" } })
			return { title: "my-plan", seq: 12 }
		})
		expect(await h.ops.rename("s1", "My Plan")).toEqual({ title: "my-plan", seq: 12 })
	})

	test("fork sends atSeq only when given and answers the new session id", async () => {
		const calls: Record<string, unknown>[] = []
		const h = makeOps((method, args) => {
			expect(method).toBe("session/fork")
			calls.push(args)
			return { sessionId: "fork-1" }
		})
		expect(await h.ops.fork("s1", 42)).toBe("fork-1")
		expect(await h.ops.fork("s1")).toBe("fork-1")
		expect(calls[0]).toEqual({ request: { sessionId: "s1", atSeq: 42 } })
		// omission = latest completed turn (no atSeq key on the wire)
		expect(calls[1]).toEqual({ request: { sessionId: "s1" } })
	})

	test("skillsList maps the session-scoped catalog to the /skills row shape", async () => {
		const h = makeOps((method, args) => {
			expect(method).toBe("skills/list")
			expect(args).toEqual({ request: { sessionId: "s1" } })
			return {
				skills: [
					{ name: "review", description: "Review code", modelInvocable: true },
					{ name: "", description: "no name" },
				],
			}
		})
		expect(await h.ops.skillsList("s1")).toEqual([
			{ name: "review", description: "Review code", invocation: "/review" },
		])
	})

	test("commands list/execute ride the agent-scoped envelopes", async () => {
		const h = makeOps((method, args) => {
			if (method === "commands/list") {
				expect(args).toEqual({ agentId: "s1" })
				return [
					{ name: "compact", description: "Compact the context" },
					{ name: "", description: "no name" },
				]
			}
			if (method === "commands/execute") {
				expect(args).toEqual({ agentId: "s1", line: "/compact", submittedAttachments: [] })
				return { commandId: "c1", result: { kind: "success", text: "compacted" } }
			}
			return {}
		})
		expect(await h.ops.commandsList("s1")).toEqual([{ name: "compact", description: "Compact the context" }])
		expect(await h.ops.commandsExecute("s1", "/compact")).toEqual({ text: "compacted" })
	})
})

describe("RemoteTailSession", () => {
	function makeTail(rpcHandler: RpcHandler, sessionId: string, sink: (rows: { kind: string; text: string; final: boolean }[]) => void): {
		connection: FakeConnection
		tail: RemoteTailSession
		sockets: FakeMuxSocket[]
		lastSocket(): FakeMuxSocket
	} {
		const connection = new FakeConnection()
		connection.rpcHandler = rpcHandler
		const sockets: FakeMuxSocket[] = []
		const ops = new RemoteSessionOps({
			rpc: (method, args) => connection.rpc(method, args),
			socketFactory: () => {
				const socket = new FakeMuxSocket()
				sockets.push(socket)
				return socket
			},
		})
		const tail = new RemoteTailSession({
			ops,
			socketFactory: () => {
				const socket = new FakeMuxSocket()
				sockets.push(socket)
				return socket
			},
			sessionId,
			sink,
			connectionState: () => connection.getState(),
			onStateChange: (listener) => connection.onStateChange(listener),
			retryMs: 20,
		})
		return { connection, tail, sockets, lastSocket: () => sockets[sockets.length - 1]! }
	}

	test("replays the durable prefix, streams live rows, flushes the FULL row set", async () => {
		const flushes: { kind: string; text: string; final: boolean }[][] = []
		const h = makeTail((method) => {
			if (method === "session/page") return { records: [], hasMore: false }
			return {}
		}, "foreign-1", (rows) => flushes.push(rows))
		const pending = h.tail.start()
		await until(() => h.sockets.length > 0)
		h.lastSocket().item({
			type: "snapshot",
			header: { version: 1, id: "foreign-1", createdAt: 0, isSeeded: false },
			cursor: 2,
			hasMore: false,
			records: [
				{ type: "event", event: { type: "user/message", seq: 1, time: 1, data: { source: { kind: "user" }, content: [{ type: "text", text: "from the phone" }] } } },
				{ type: "event", event: { type: "assistant/message", seq: 2, time: 2, data: { message: { content: [{ type: "text", text: "answer" }] } } } },
			],
			projections: { asOfSeq: 2, values: {} },
		})
		await pending
		// snapshot flush carries the FULL accumulated set
		expect(flushes[0]).toEqual([
			{ kind: "user", text: "from the phone", final: true },
			{ kind: "assistant", text: "answer", final: true },
		])
		// the live pump rides its own follow socket
		expect(h.sockets.length).toBe(2)
		// live durable event appends and re-flushes everything
		h.sockets[1]!.item({ type: "event", event: { type: "assistant/message", seq: 3, time: 3, data: { message: { content: [{ type: "text", text: "more" }] } } } })
		await until(() => flushes.length === 2)
		expect(flushes[1]).toHaveLength(3)
		expect(flushes[1]!.at(-1)).toEqual({ kind: "assistant", text: "more", final: true })
		h.tail.stop()
	})

	test("stop closes the watch: no rows after stop, pump socket released", async () => {
		const flushes: { kind: string; text: string; final: boolean }[][] = []
		const h = makeTail((method) => {
			if (method === "session/page") return { records: [], hasMore: false }
			return {}
		}, "foreign-2", (rows) => flushes.push(rows))
		const pending = h.tail.start()
		await until(() => h.sockets.length > 0)
		h.lastSocket().item({
			type: "snapshot",
			header: { version: 1, id: "foreign-2", createdAt: 0, isSeeded: false },
			cursor: 1,
			hasMore: false,
			records: [
				{ type: "event", event: { type: "user/message", seq: 1, time: 1, data: { source: { kind: "user" }, content: [{ type: "text", text: "x" }] } } },
			],
			projections: { asOfSeq: 1, values: {} },
		})
		await pending
		expect(flushes.length).toBe(1)
		h.tail.stop()
		// the pump socket was closed by stop()
		expect(h.sockets[1]!.closed).toBe(true)
		const before = flushes.length
		// a late event frame on the closed socket must not flush
		h.lastSocket().item({ type: "event", event: { type: "assistant/message", seq: 2, time: 2, data: { message: { content: [{ type: "text", text: "late" }] } } } })
		await new Promise((r) => setTimeout(r, 30))
		expect(flushes.length).toBe(before)
	})

	test("transport loss repairs the journal gap via session/page before resuming", async () => {
		const flushes: { kind: string; text: string; final: boolean }[][] = []
		let paged = false
		const h = makeTail((method, args) => {
			if (method === "session/page") {
				paged = true
				const req = args["request"] as Record<string, unknown>
				// the missing middle: seqs 3..5 (snapshot window jumps 2 → 6)
				expect(req.beforeSeq).toBe(6)
				return {
					records: [
						{ type: "event", event: { type: "user/message", seq: 3, time: 3, data: { source: { kind: "user" }, content: [{ type: "text", text: "gap row" }] } } },
					],
					hasMore: false,
				}
			}
			return {}
		}, "foreign-3", (rows) => flushes.push(rows))
		const pending = h.tail.start()
		await until(() => h.sockets.length > 0)
		const first = h.lastSocket()
		first.item({
			type: "snapshot",
			header: { version: 1, id: "foreign-3", createdAt: 0, isSeeded: false },
			cursor: 2,
			hasMore: false,
			records: [
				{ type: "event", event: { type: "user/message", seq: 1, time: 1, data: { source: { kind: "user" }, content: [{ type: "text", text: "one" }] } } },
			],
			projections: { asOfSeq: 2, values: {} },
		})
		await pending
		expect(flushes.length).toBe(1)
		// transport loss on the LIVE pump socket; the watch re-attaches (retryMs 20)
		h.sockets[1]!.close()
		// fetchJournal re-opened for the replay (socket 3); deliver the new
		// snapshot window — it starts at seq 6, a gap over seq 3..5
		await until(() => h.sockets.length > 2, 4000)
		const replaySocket = h.sockets[2]!
		replaySocket.item({
			type: "snapshot",
			header: { version: 1, id: "foreign-3", createdAt: 0, isSeeded: false },
			cursor: 6,
			hasMore: false,
			records: [
				{ type: "event", event: { type: "assistant/message", seq: 6, time: 6, data: { message: { content: [{ type: "text", text: "resumed" }] } } } },
			],
			projections: { asOfSeq: 6, values: {} },
		})
		await until(() => paged, 4000)
		// gap row arrives BEFORE the newer snapshot row in the flush order
		await until(() => flushes.at(-1)?.some((r) => r.text === "gap row"), 4000)
		const last = flushes.at(-1)!
		expect(last.findIndex((r) => r.text === "gap row")).toBeLessThan(last.findIndex((r) => r.text === "resumed"))
		h.tail.stop()
	})
})
