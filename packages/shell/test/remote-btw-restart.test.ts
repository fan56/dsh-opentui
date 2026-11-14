// Wave-3 /btw second-session flow (row 32) and /reload same-port restart
// (row 29) — fake connection, fake mux sockets, a fake dsh spawner, and a
// real killable child process for the lockfile stop half.
import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { spawn as spawnNode } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Server } from "node:net"
import { createServer as createHttpServer } from "node:http"
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

// ---------------------------------------------------------------------------
// Trace file sink — DSH_OPENTUI_TRACE_FILE (the container e2e cannot read
// stderr: the TUI repaints the tmux pane, so stderr never reaches the
// container log). The sink only changes WHERE the trace lands — the line
// format and the EARLY-EMPTY-SETTLE marker are unchanged.
// ---------------------------------------------------------------------------

describe("btw trace file sink (DSH_OPENTUI_TRACE_FILE)", () => {
	const savedTraceFile = process.env.DSH_OPENTUI_TRACE_FILE
	const savedDebug = process.env.DSH_OPENTUI_DEBUG
	afterEach(() => {
		if (savedTraceFile === undefined) delete process.env.DSH_OPENTUI_TRACE_FILE
		else process.env.DSH_OPENTUI_TRACE_FILE = savedTraceFile
		if (savedDebug === undefined) delete process.env.DSH_OPENTUI_DEBUG
		else process.env.DSH_OPENTUI_DEBUG = savedDebug
	})

	/** One standalone askBtw turn: one text delta, then turn/end → settle. */
	async function runOneBtw(): Promise<string> {
		const sockets: FakeMuxSocket[] = []
		const connection = new FakeConnection()
		connection.rpcHandler = (method) => {
			if (method === "session/create") return { sessionId: "throw-trace" }
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
			question: "trace me",
			snapshot: [],
			timeoutMs: 2000,
		})
		await until(() => sockets.length > 0)
		const sock = sockets[sockets.length - 1]!
		sock.item(snapshotFrame("throw-trace"))
		sock.item(streamFrame({ type: "chunk", attemptId: "a", revision: 0, index: 0, time: 1, chunk: { type: "text-delta", index: 0, text: "hi" } }))
		sock.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		const result = await pending
		await connection.close()
		return result.answer
	}

	test("the settle trace line is appended to DSH_OPENTUI_TRACE_FILE", async () => {
		const file = join(scratchDir("btw-trace-"), "trace.log")
		delete process.env.DSH_OPENTUI_DEBUG // the file sink has its own gate
		process.env.DSH_OPENTUI_TRACE_FILE = file
		expect(await runOneBtw()).toBe("hi")
		const text = readFileSync(file, "utf8")
		expect(text).toMatch(/^\[btw \d{2}:\d{2}:\d{2}\.\d{3}\] settle why=turn-end /m)
		expect(text).toContain("out len=2")
		// the EARLY-EMPTY-SETTLE marker only fires on a zero-delta settle
		expect(text).not.toContain("EARLY-EMPTY-SETTLE")
		// append-friendly: every trace line ends with a newline
		expect(text.endsWith("\n")).toBe(true)
		for (const line of text.split("\n")) {
			if (line.length > 0) expect(line.startsWith("[btw ")).toBe(true)
		}
	})

	test("no trace file is written when DSH_OPENTUI_TRACE_FILE is unset", async () => {
		const file = join(scratchDir("btw-trace-off-"), "trace.log")
		process.env.DSH_OPENTUI_TRACE_FILE = file
		expect(await runOneBtw()).toBe("hi")
		expect(existsSync(file)).toBe(true)
		unlinkSync(file)
		delete process.env.DSH_OPENTUI_TRACE_FILE
		expect(await runOneBtw()).toBe("hi")
		expect(existsSync(file)).toBe(false)
	})

	test("an unwritable trace file degrades instead of throwing", async () => {
		const file = join(scratchDir("btw-trace-bad-"), "no-such-dir", "trace.log")
		process.env.DSH_OPENTUI_TRACE_FILE = file
		expect(await runOneBtw()).toBe("hi")
		expect(existsSync(file)).toBe(false)
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

		// The restarted host is a real dsh HTTP host; the subsequent ensureHost
		// adoption probe requires an authenticated `GET /` to reach it (a bare
		// TCP socket would be classified as a foreign holder of the port).
		const listener = createHttpServer((_req, res) => res.end("restarted-host"))
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

// ---------------------------------------------------------------------------
// e2e mock btw keying — the 61-btw render-gap root cause pin. askBtw reuses
// ONE throwaway session across side questions (previousSessionId), so the
// SECOND question's LLM request body embeds the FIRST question's marker in
// its history turns. The mock must key on the LAST marker in the body (the
// newest user turn); the old first-match rule re-served ANSWER-ONE to Q2,
// which made the scenario's ANSWER-TWO assertions unwinnable while the
// client's paint path was fine (warn text said "render gap" — the body
// never existed on the wire; local trace: settle out len=63 = ANSWER-ONE).
// ---------------------------------------------------------------------------

describe("e2e mock btwAnswer keys on the newest question (session-reuse contract)", () => {
	test("Q2's body embedding Q1's history marker still answers ANSWER-TWO", async () => {
		const { btwAnswer } = await import("../../../e2e/lib/mock-llm.mjs")
		// shape: Q1's historical turns (question + ANSWER-ONE) precede Q2's
		// own user message — the reused throwaway session's request body.
		const body = [
			'{"role":"user","content":"Side question (answer in one or two sentences, do not use tools): E2E_BTW_Q1 what is the deploy status"}',
			'{"role":"assistant","content":"E2E-BTW-ANSWER-ONE — the deploy is green and the cache is warm."}',
			'{"role":"user","content":"Side question (answer in one or two sentences, do not use tools): E2E_BTW_Q2 and the rollback plan"}',
		].join("\n")
		expect(btwAnswer(body)).toContain("E2E-BTW-ANSWER-TWO")
	})

	test("a first-question-only body still answers ANSWER-ONE", async () => {
		const { btwAnswer } = await import("../../../e2e/lib/mock-llm.mjs")
		const body = '{"role":"user","content":"Side question: E2E_BTW_Q1 what is the deploy status"}'
		expect(btwAnswer(body)).toContain("E2E-BTW-ANSWER-ONE")
	})

	test("a body with no Q key falls back to the UNKNOWN marker", async () => {
		const { btwAnswer } = await import("../../../e2e/lib/mock-llm.mjs")
		expect(btwAnswer('{"role":"user","content":"hello"}')).toBe("E2E-BTW-ANSWER-UNKNOWN")
	})

	test("a body whose Q2 marker precedes Q1's still answers the LAST one", async () => {
		const { btwAnswer } = await import("../../../e2e/lib/mock-llm.mjs")
		// defensive ordering pin: whatever the host's history serialization
		// order, the greatest lastIndexOf wins, not array order
		const body = 'x E2E_BTW_Q2 y E2E_BTW_Q1 z'
		expect(btwAnswer(body)).toContain("E2E-BTW-ANSWER-ONE")
	})
})
