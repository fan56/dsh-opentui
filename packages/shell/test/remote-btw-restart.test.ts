// Wave-3 /btw second-session flow (row 32) and /reload same-port restart
// (row 29) — fake connection, fake mux sockets, a fake dsh spawner, and a
// real killable child process for the lockfile stop half.
import { afterAll, describe, expect, test } from "bun:test"
import { spawn as spawnNode } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Server } from "node:net"
import { askBtw, BTW_TITLE_PREFIX } from "../src/client/remote-btw.ts"
import { ensureHost } from "../src/client/lifecycle.ts"
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

/** Poll until the pid is gone (backstop behind dispose's SIGTERM). */
async function waitPidGone(pid: number, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0)
		} catch {
			return
		}
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
}

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
		// the lockfile was REWRITTEN for the respawned host: new pid, same
		// port, lifecycle writeLock shape — the restarted host stays managed
		const rewritten = JSON.parse(readFileSync(join(home, "opentui-host.opentui.json"), "utf8")) as Record<string, unknown>
		expect(rewritten.pid).toBe(999_999)
		expect(rewritten.port).toBe(port)
		expect(rewritten.authority).toBe(`127.0.0.1:${port}`)
		expect(rewritten.profile).toBe("opentui")
		expect(typeof rewritten.startedAt).toBe("string")
		expect(new Date(String(rewritten.startedAt)).getTime()).not.toBeNaN()
		for (const listener of listeners) listener.close()
	}, 20000)

	test("restart rewrites the lockfile so a subsequent ensureHost joins (no double boot)", async () => {
		const home = scratchDir("dsh-restart-home-")
		mkdirSync(join(home, "profiles", "opentui"), { recursive: true })
		// real killable processes: the old host (SIGTERMed by the restart) and
		// the "fresh" host whose pid the fake spawn reports — adoption needs a
		// live pid behind the rewritten lock
		const victim = spawnNode(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" })
		const fresh = spawnNode(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" })
		const probe = new Server((socket) => socket.destroy())
		const port = await new Promise<number>((resolve) => {
			probe.listen(0, "127.0.0.1", () => resolve((probe.address() as { port: number }).port))
		})
		await new Promise<void>((resolve) => probe.close(() => resolve()))
		writeFileSync(join(home, "opentui-host.opentui.json"), JSON.stringify({ pid: victim.pid, port, authority: `127.0.0.1:${port}`, startedAt: new Date().toISOString(), profile: "opentui" }))

		const listener = new Server((socket) => socket.destroy())
		try {
			const result = await restartSamePortHost({
				dshHome: home,
				profile: "opentui",
				spawnDsh: () => {
					// the "fresh host" binds inside spawnDsh — after the restart's
					// port-quiet gate, exactly where a real host would bind
					listener.listen(port, "127.0.0.1")
					return {
						pid: fresh.pid!,
						exitCode: null,
						stdout: { on: () => {} },
						stderr: { on: () => {} },
						on: () => {},
						kill: () => true,
					}
				},
				mintCookie: () => "restart-cookie",
			})
			expect(result.pid).toBe(fresh.pid)
			// the rewritten lockfile is the exact lifecycle shape, fresh pid
			const lock = JSON.parse(readFileSync(join(home, "opentui-host.opentui.json"), "utf8")) as Record<string, unknown>
			expect(lock.pid).toBe(fresh.pid)
			expect(lock.port).toBe(port)

			// a subsequent ensureHost ADOPTS the restarted host (live pid +
			// bound listener → fresh lock): it joins instead of respawning
			const bootSpawns: string[][] = []
			const handle = await ensureHost({
				dshHome: home,
				profile: "opentui",
				idleExitSec: 0,
				spawnDsh: (argv) => {
					bootSpawns.push(argv)
					throw new Error("ensureHost must not respawn — the restarted host is managed")
				},
				mintCookie: () => "join-cookie",
			})
			expect(handle.adopted).toBe(true)
			expect(handle.pid).toBe(fresh.pid)
			expect(handle.port).toBe(port)
			expect(bootSpawns).toHaveLength(0)
			await handle.dispose()
			await waitPidGone(fresh.pid!)
		} finally {
			listener.close()
			for (const pid of [victim.pid, fresh.pid]) {
				try {
					process.kill(pid!, "SIGKILL")
				} catch {
					/* already gone */
				}
			}
		}
	}, 20000)

	test("restartSamePortHost without a lockfile → typed no-lock error", async () => {
		const home = scratchDir("dsh-restart-home-")
		await expect(restartSamePortHost({ dshHome: home, mintCookie: () => "c" })).rejects.toThrow(HostRestartError)
	})

	test("restartSamePortHost against a booting placeholder → typed host-booting error, booter untouched", async () => {
		const home = scratchDir("dsh-restart-home-")
		// a live "booter" process behind the cold-boot mutual-exclusion
		// placeholder (lifecycle.ts claimBootLock shape: booter pid, port 0)
		const booter = spawnNode(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" })
		const lockPath = join(home, "opentui-host.opentui.json")
		writeFileSync(
			lockPath,
			JSON.stringify({ pid: booter.pid, port: 0, authority: "127.0.0.1:0", startedAt: new Date().toISOString(), profile: "opentui", booting: true }),
		)
		try {
			let error: unknown
			try {
				await restartSamePortHost({ dshHome: home, profile: "opentui", mintCookie: () => "c" })
			} catch (err) {
				error = err
			}
			expect(error).toBeInstanceOf(HostRestartError)
			expect((error as HostRestartError).code).toBe("host-booting")
			expect(String((error as Error).message)).toContain("booting placeholder")
			// the booter was never signaled — still alive behind its claim
			let booterAlive = false
			try {
				process.kill(booter.pid!, 0)
				booterAlive = true
			} catch {
				booterAlive = false
			}
			expect(booterAlive).toBe(true)
			// the placeholder lockfile is untouched (still the booting claim)
			const lock = JSON.parse(readFileSync(lockPath, "utf8")) as Record<string, unknown>
			expect(lock.booting).toBe(true)
			expect(lock.pid).toBe(booter.pid)
		} finally {
			try {
				process.kill(booter.pid!, "SIGKILL")
			} catch {
				/* already gone */
			}
		}
	}, 15000)

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
