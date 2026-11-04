// Wave-3 /btw second-session flow (row 32) and /reload same-port restart
// (row 29) — fake connection, fake mux sockets, a fake dsh spawner, and a
// real killable child process for the lockfile stop half.
import { afterAll, describe, expect, test } from "bun:test"
import { spawn as spawnNode } from "node:child_process"
import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Server } from "node:net"
import { askBtw, BTW_TITLE_PREFIX } from "../src/client/remote-btw.ts"
import { HostRestartError, restartSamePortHost } from "../src/client/remote-restart.ts"
import { RemoteHostSession } from "../src/client/remote-host-session.ts"
import { FakeConnection, FakeMuxSocket, rpcOf, snapshotFrame, streamFrame, eventFrame, until } from "./client-fakes.ts"
import type { ClientConnection } from "../src/client/transport.ts"

const scratchDirs: string[] = []
function scratchDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix))
	scratchDirs.push(dir)
	return dir
}
afterAll(() => {
	for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Row 32 — /btw throwaway-session flow
// ---------------------------------------------------------------------------

describe("row 32 — /btw via a reused throwaway session", () => {
	test("create + follow deltas + prompt + turn/end settle + btw: rename", async () => {
		const { connection, session, lastSocket, socketCount } = makeBtwFacade()
		const deltas: string[] = []
		const pending = session.btwAsk("what is a pec?", ["earlier context"], (full) => deltas.push(full))
		await until(() => socketCount() > 0)
		feedTurn(lastSocket(), ["a pec is", " a nut"])
		const answer = await pending
		expect(answer).toBe("a pec is a nut")
		expect(deltas).toEqual(["a pec is", "a pec is a nut"])
		// the throwaway was created and renamed with the marker title (the
		// host's returned sessionId is adopted — "btw-1" from the handler)
		const create = rpcOf(connection, "session/create")!.request as Record<string, unknown>
		expect(typeof create.sessionId).toBe("string")
		expect(create.cwd).toBe("/tmp/workspace")
		const rename = rpcOf(connection, "session/rename")!.request as Record<string, unknown>
		expect(rename.sessionId).toBe("btw-1")
		expect(String(rename.title).startsWith(BTW_TITLE_PREFIX)).toBe(true)
		expect(String(rename.title).includes("what is a pec?")).toBe(true)
		// the follow rode the throwaway's address
		expect(lastSocket().openFrame.endpoint).toBe("session/follow")
		expect(lastSocket().openFrame.payload.args.request.address).toEqual({ kind: "session", sessionId: "btw-1" })
		// snapshot prefix rides the prompt
		const prompt = rpcOf(connection, "session/prompt")!.request as Record<string, unknown>
		expect(String((prompt.content as { text: string }[])[0]!.text)).toContain("Recent conversation context (for reference only):")
		expect(String((prompt.content as { text: string }[])[0]!.text)).toContain("what is a pec?")
		await session.dispose()
	})

	test("second ask REUSES the throwaway session (one-session pollution cap)", async () => {
		const { connection, session, lastSocket, socketCount } = makeBtwFacade()
		const first = session.btwAsk("q1", [])
		await until(() => socketCount() > 0)
		feedTurn(lastSocket(), ["one"])
		expect(await first).toBe("one")

		const countBefore = socketCount()
		const second = session.btwAsk("q2", [])
		await until(() => socketCount() > countBefore)
		feedTurn(lastSocket(), ["two"])
		expect(await second).toBe("two")
		// exactly ONE create across both questions
		expect(connection.rpcCalls.filter((c) => c.method === "session/create").length).toBe(1)
		// and listSessions hides the marker row
		connection.rpcHandler = (method) => {
			if (method === "session/list") {
				return { items: [{ sessionId: "btw-throwaway", updatedAt: Date.now(), running: false, blank: false, projections: { values: { title: "btw: q1" } } }] }
			}
			return {}
		}
		expect(await session.listSessions()).toEqual([])
		await session.dispose()
	})

	test("concurrent asks are refused; turn errors resolve as error: text", async () => {
		const { session, lastSocket, socketCount } = makeBtwFacade()
		const first = session.btwAsk("slow", [])
		await until(() => socketCount() > 0)
		await expect(session.btwAsk("racing", [])).rejects.toThrow(/already running/)
		// settle the first with an error turn/end (host-session parity shape)
		firstSocketFeed(lastSocket())
		lastSocket().item(eventFrame("turn/end", { turn: 1, reason: { kind: "error", error: { message: "route down" } } }, 1))
		expect(await first).toBe("error: route down")
		// a settled first ask frees the guard
		const countBefore = socketCount()
		const next = session.btwAsk("after", [])
		await until(() => socketCount() > countBefore)
		feedTurn(lastSocket(), [])
		expect(await next).toBe("")
		await session.dispose()
	})

	test("prompt RPC failure rejects (create path is live)", async () => {
		const { session, lastSocket, socketCount } = makeBtwFacade({
			rpcHandler: (method, args) => {
				if (method === "session/prompt") throw new Error("session service refused")
				return defaultRpc(method, args)
			},
		})
		const pending = session.btwAsk("q", [])
		pending.catch(() => {}) // shelve the rejection until expect().rejects attaches
		await until(() => socketCount() > 0)
		firstSocketFeed(lastSocket()) // snapshot so the pump is running
		await expect(pending).rejects.toThrow("session service refused")
		await session.dispose()
	})

	test("askBtw standalone happy path over a bare rpc carrier", async () => {
		const sockets: FakeMuxSocket[] = []
		const connection = new FakeConnection()
		connection.rpcHandler = (method) => {
			if (method === "session/create") return { sessionId: "throw-1" }
			if (method === "session/prompt") return { accepted: true }
			if (method === "session/rename") return { title: "x", seq: 1 }
			return {}
		}
		const pending = askBtw({
			rpc: (method, args) => connection.rpc(method, args),
			socketFactory: () => {
				const s = new FakeMuxSocket()
				sockets.push(s)
				return s
			},
			cwd: "/w",
			question: "tiny",
			snapshot: [],
			timeoutMs: 2000,
		})
		await until(() => sockets.length > 0)
		const sock = sockets[sockets.length - 1]!
		sock.item(snapshotFrame("throw-1"))
		sock.item(streamFrame({ type: "chunk", attemptId: "a", revision: 0, index: 0, time: 1, chunk: { type: "text-delta", index: 0, text: "hi" } }))
		sock.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		const result = await pending
		expect(result.answer).toBe("hi")
		expect(result.sessionId).toBe("throw-1")
		await connection.close()
	})
})

/** Feed the opening snapshot the pump needs before its live frames. */
function firstSocketFeed(sock: FakeMuxSocket): void {
	sock.item(snapshotFrame("btw-1"))
}

/** Feed one complete btw turn into the given follow socket. */
function feedTurn(sock: FakeMuxSocket, chunks: string[]): void {
	firstSocketFeed(sock)
	let index = 0
	for (const text of chunks) {
		sock.item(streamFrame({ type: "chunk", attemptId: "a", revision: 0, index, time: 1, chunk: { type: "text-delta", index, text } }))
		index += 1
	}
	sock.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
}

interface BtwFacade {
	connection: FakeConnection
	session: RemoteHostSession
	lastSocket(): FakeMuxSocket
	socketCount(): number
}

function makeBtwFacade(options: { rpcHandler?: (method: string, args: Record<string, unknown>) => unknown } = {}): BtwFacade {
	const connection = new FakeConnection()
	connection.rpcHandler =
		options.rpcHandler ??
		((method, args) => {
			if (method === "session/create") return { sessionId: "btw-1" }
			if (method === "session/prompt") return { accepted: true }
			if (method === "session/rename") return { title: `${BTW_TITLE_PREFIX} x`, seq: 1 }
			return defaultRpc(method, args)
		})
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
	return {
		connection,
		session,
		lastSocket: () => sockets[sockets.length - 1]!,
		socketCount: () => sockets.length,
	}
}

function defaultRpc(method: string): unknown {
	if (method === "session/create") return { sessionId: "main-1" }
	if (method === "session/prompt") return { accepted: true }
	if (method === "session/cancel") return { accepted: true }
	return {}
}

// ---------------------------------------------------------------------------
// Row 29 — /reload via same-port restart
// ---------------------------------------------------------------------------

describe("row 29 — /reload via lifecycle restart + carrier reconnect", () => {
	test("restartHost seam override is used and the carrier reconnect verdict returns", async () => {
		const connection = new FakeConnection()
		const session = new RemoteHostSession({
			connection: connection as unknown as ClientConnection,
			cookieHeader: "dsh-auth-x=v1.test",
			restartHost: async (reason) => {
				expect(reason).toBe("plugin reload")
				connection.setState("disconnected")
				connection.setState("connected")
			},
		})
		await session.start()
		expect(await session.reloadPlugins()).toBeUndefined()
		await session.dispose()
	})

	test("restartHost failure returns the error string (host-session parity)", async () => {
		const connection = new FakeConnection()
		const session = new RemoteHostSession({
			connection: connection as unknown as ClientConnection,
			cookieHeader: "dsh-auth-x=v1.test",
			restartHost: async () => {
				throw new Error("port grabbed by another process")
			},
		})
		await session.start()
		expect(await session.reloadPlugins()).toContain("port grabbed by another process")
		await session.dispose()
	})

	test("restartSamePortHost: lockfile pid SIGTERMed, same-port respawn, cookie mint", async () => {
		const home = scratchDir("dsh-restart-home-")
		mkdirSync(join(home, "profiles", "opentui"), { recursive: true })
		// a real, killable "host" process (a sleeping bun child)
		const victim = spawnNode(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" })
		// discover a free port, then release it — the fake "fresh host" binds
		// it inside spawnDsh (after the helper's port-quiet gate, exactly
		// where a real host would bind)
		const probe = new Server((socket) => socket.destroy())
		const port = await new Promise<number>((resolve) => {
			probe.listen(0, "127.0.0.1", () => resolve((probe.address() as { port: number }).port))
		})
		await new Promise<void>((resolve) => probe.close(() => resolve()))
		const listeners: Server[] = []
		writeFileSync(join(home, "opentui-host.opentui.json"), JSON.stringify({ pid: victim.pid, port, authority: `127.0.0.1:${port}`, startedAt: new Date().toISOString(), profile: "opentui" }))

		const spawned: { argv: string[]; cwd: string }[] = []
		const result = await restartSamePortHost({
			dshHome: home,
			profile: "opentui",
			spawnDsh: (argv, options) => {
				spawned.push({ argv, cwd: options.cwd })
				const listener = new Server((socket) => socket.destroy())
				listener.listen(port, "127.0.0.1")
				listeners.push(listener)
				return {
					pid: 999_999,
					exitCode: null,
					stdout: { on: () => {} },
					stderr: { on: () => {} },
					on: () => {},
					kill: () => true,
				}
			},
			mintCookie: ({ home: mintHome, authority }) => `cookie-for-${mintHome === home ? "scratch" : "wrong"}-${authority}`,
		})

		// the victim was SIGTERMed to death
		const victimGone = await new Promise<boolean>((resolve) => {
			const deadline = Date.now() + 3000
			const poll = (): void => {
				try {
					process.kill(victim.pid!, 0)
					if (Date.now() > deadline) resolve(false)
					else setTimeout(poll, 50)
				} catch {
					resolve(true)
				}
			}
			poll()
		})
		expect(victimGone).toBe(true)
		// the same port was reused; the cookie was minted against it
		expect(result.port).toBe(port)
		expect(result.authority).toBe(`127.0.0.1:${port}`)
		expect(result.cookieHeader).toBe(`cookie-for-scratch-127.0.0.1:${port}`)
		// the respawn ran the same-port boot argv in the profile dir
		expect(spawned).toEqual([{ argv: ["--profile", "opentui", "--no-open", "--port", String(port)], cwd: join(home, "profiles", "opentui") }])
		// the stale lockfile was cleared
		expect(existsSync(join(home, "opentui-host.opentui.json"))).toBe(false)
		for (const listener of listeners) listener.close()
	}, 20000)

	test("restartSamePortHost without a lockfile → typed no-lock error", async () => {
		const home = scratchDir("dsh-restart-home-")
		await expect(restartSamePortHost({ dshHome: home, mintCookie: () => "c" })).rejects.toThrow(HostRestartError)
	})

	test("facade reloadPlugins without a lockfile returns the error string", async () => {
		const home = scratchDir("dsh-restart-home-")
		const connection = new FakeConnection()
		const session = new RemoteHostSession({
			connection: connection as unknown as ClientConnection,
			cookieHeader: "dsh-auth-x=v1.test",
			dshHome: home,
			profile: "opentui",
		})
		await session.start()
		const message = await session.reloadPlugins()
		expect(message).toContain("no host lockfile")
		await session.dispose()
	})
})
