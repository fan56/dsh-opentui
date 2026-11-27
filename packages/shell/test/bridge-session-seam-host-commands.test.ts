/**
 * BridgeSessionSeam.hostCommands face tests (027 — plugin-registered slash
 * commands over the generic commands.list / commands.execute arm).
 *
 * Mock pattern follows remote-session-ops.test.ts: a scripted BridgeTransport
 * records every request and replays canned replies, so the assertions pin
 * the ADAPTER behavior the ops layer cannot observe (its commandsList
 * swallows raw errors into []):
 *   - list() maps rows and the transport sees the DOTTED wire name
 *     (`commands.list`), never the raw slash name — the translation table
 *     is load-bearing (the generic arm indexes by exact dot-name);
 *   - the service-absent class (UNSUPPORTED / NOT_WIRED / UNAVAILABLE) flips
 *     `available()` false — durably, past the swallowed settle — while
 *     BAD_PARAMS (business code) never poisons availability;
 *   - execute() degrades to `undefined` (never rejects) with the raw line;
 *   - the row cache is keyed per agentId (15s TTL), a settle whose binding
 *     moved on discards its rows (never cached, never surfaced).
 */
import { describe, expect, test } from "bun:test"
import {
	BridgeProtocolError,
	BridgeSessionSeam,
	type BridgeConfirmClock,
	type BridgeEventFrame,
	type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"
import type { SeamHostCommandRow } from "../../tui-base/src/seams/session.ts"

// ---------------------------------------------------------------------------
// Fakes (same shape as bridge-session-seam.test.ts makeHarness, trimmed to
// what this face touches)
// ---------------------------------------------------------------------------

type Reply =
	| { kind: "value"; value: unknown }
	| { kind: "error"; error: unknown }
	| { kind: "async"; fn: (params?: Record<string, unknown>) => Promise<Reply> }

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((r) => {
		resolve = r
	})
	return { promise, resolve }
}

interface LogCall {
	level: "info" | "warn" | "error" | "debug"
	args: unknown[]
}

function makeHarness(confirmClock?: BridgeConfirmClock) {
	const requests: { method: string; params?: Record<string, unknown> }[] = []
	const replies = new Map<string, Reply>()
	const logs: LogCall[] = []

	const transport: BridgeTransport = {
		async request(method, params) {
			requests.push({ method, params })
			const reply = replies.get(method)
			if (reply === undefined) return {}
			if (reply.kind === "async") return (await reply.fn(params)).value
			if (reply.kind === "error") throw reply.error
			return reply.value
		},
		onEvent() {
			return () => {}
		},
	}

	const logger = {
		info(...args: unknown[]) {
			logs.push({ level: "info", args })
		},
		warn(...args: unknown[]) {
			logs.push({ level: "warn", args })
		},
		error(...args: unknown[]) {
			logs.push({ level: "error", args })
		},
		debug(...args: unknown[]) {
			logs.push({ level: "debug", args })
		},
	}

	const seam = new BridgeSessionSeam({ transport, ctx: { logger }, confirmClock })

	return {
		seam,
		requests,
		replies,
		logs,
		emit(_frame: BridgeEventFrame) {},
		warnFor(member: string) {
			return logs.filter((l) => l.level === "warn" && l.args.map(String).join(" ").includes(member))
		},
		lastRequest(method: string) {
			return [...requests].reverse().find((r) => r.method === method)
		},
	}
}

const ROWS_A1: SeamHostCommandRow[] = [{ name: "compact", description: "Compact the context" }]
const ROWS_A2: SeamHostCommandRow[] = [{ name: "plugin-cmd", description: "plugin one" }]

describe("BridgeSessionSeam.hostCommands (027)", () => {
	test("list maps rows through the dedicated ops; the transport sees the dotted name, never the raw slash name", async () => {
		const h = makeHarness()
		h.replies.set("commands.list", {
			kind: "value",
			value: [
				{ name: "compact", description: "Compact the context" },
				{ name: "", description: "nameless row is dropped by the ops projection" },
			],
		})
		h.seam.resumeSession("a1") // staged id — the face's agentId

		expect(await h.seam.hostCommands.list()).toEqual([{ name: "compact", description: "Compact the context" }])
		expect(h.lastRequest("commands.list")?.params).toEqual({ agentId: "a1" })
		// fail-loud translation table: the raw slash wire name must never
		// reach the transport untranslated (the generic arm would 404 it into
		// a silent empty face). Only the 2 table entries may ever appear.
		const methods = h.requests.map((r) => r.method)
		expect(methods).toContain("commands.list")
		expect(methods.filter((m) => m === "commands/list")).toHaveLength(0)
		// every observed transport method is one of the table's 2 dotted entries
		expect(methods.every((m) => ["commands.list", "commands.execute"].includes(m))).toBe(true)
		expect(h.seam.hostCommands.available()).toBe(true)
	})

	test("list unwraps the generic-arm `{ value: [...] }` envelope — the real wire shape", async () => {
		const h = makeHarness()
		// The bridge's generic arm wraps the host's plain ARRAY as { value: T }
		// (projectGenericWireReply: a bare array never crosses the wire) — the
		// ops layer must unwrap that envelope before mapping rows.
		h.replies.set("commands.list", {
			kind: "value",
			value: { value: [{ name: "compact", description: "Compact the context" }] },
		})
		h.seam.resumeSession("a1")

		expect(await h.seam.hostCommands.list()).toEqual([{ name: "compact", description: "Compact the context" }])
		expect(h.seam.hostCommands.available()).toBe(true)
	})

	test("execute proxies the raw line and degrades to undefined (never rejects); echo text passes through", async () => {
		const h = makeHarness()
		h.seam.resumeSession("a1")
		h.replies.set("commands.execute", {
			kind: "value",
			value: { commandId: "c1", result: { kind: "success", text: "compacted" } },
		})
		expect(await h.seam.hostCommands.execute("/compact with arg")).toEqual({ text: "compacted" })
		expect(h.lastRequest("commands.execute")?.params).toEqual({
			agentId: "a1",
			line: "/compact with arg",
			submittedAttachments: [],
		})

		// wire failure → undefined + a one-time degrade log, still no rejection
		h.replies.set("commands.execute", { kind: "error", error: new BridgeProtocolError("BAD_PARAMS", "no such command") })
		expect(await h.seam.hostCommands.execute("/nope")).toBeUndefined()
		expect(h.warnFor("hostCommands.execute").length).toBeGreaterThan(0)
		// a business (non service-absent) failure must NOT flip availability
		expect(h.seam.hostCommands.available()).toBe(true)
	})

	for (const code of ["UNSUPPORTED", "NOT_WIRED", "UNAVAILABLE"] as const) {
		test(`service-absent ${code} flips available() false — durably, past the swallowed ops settle`, async () => {
			const h = makeHarness()
			h.replies.set("commands.list", {
				kind: "error",
				error: new BridgeProtocolError(code, `commands.list: ${code.toLowerCase()} on this host`),
			})
			h.seam.resumeSession("a1")
			// ops.commandsList swallows the raw error into [] — the face's
			// observable is the availability flag, and the flip must survive
			// the settle (this is what the palette's unavailable status line reads)
			expect(await h.seam.hostCommands.list()).toEqual([])
			expect(h.seam.hostCommands.available()).toBe(false)
			expect(h.warnFor("hostCommands.service").length).toBeGreaterThan(0)
		})
	}

	test("a later successful wire round flips available() back true (honest re-probe after absence)", async () => {
		const h = makeHarness()
		h.seam.resumeSession("a1")
		h.replies.set("commands.list", { kind: "error", error: new BridgeProtocolError("UNSUPPORTED", "absent") })
		await h.seam.hostCommands.list()
		expect(h.seam.hostCommands.available()).toBe(false)

		// service came back: refresh drops the cache, the probe round succeeds
		h.replies.set("commands.list", { kind: "value", value: ROWS_A1 })
		h.seam.hostCommands.refresh()
		expect(await h.seam.hostCommands.list()).toEqual(ROWS_A1)
		expect(h.seam.hostCommands.available()).toBe(true)
	})

	test("BAD_PARAMS (business code) does not flip available()", async () => {
		const h = makeHarness()
		h.replies.set("commands.list", {
			kind: "error",
			error: new BridgeProtocolError("BAD_PARAMS", "commands.list: bad agentId"),
		})
		h.seam.resumeSession("a1")
		expect(await h.seam.hostCommands.list()).toEqual([])
		expect(h.seam.hostCommands.available()).toBe(true)
	})

	test("the row cache is keyed per agentId (15s TTL): a second list inside the window never re-requests", async () => {
		const clock = { now: 1_000 }
		const h = makeHarness({
			sleep: async () => {},
			now: () => clock.now,
		})
		h.replies.set("commands.list", { kind: "value", value: ROWS_A1 })
		h.seam.resumeSession("a1")
		expect(await h.seam.hostCommands.list()).toEqual(ROWS_A1)
		clock.now += 1_000 // inside the 15s TTL
		expect(await h.seam.hostCommands.list()).toEqual(ROWS_A1)
		clock.now += 20_000 // past the TTL → back to the wire
		expect(await h.seam.hostCommands.list()).toEqual(ROWS_A1)
		expect(h.requests.filter((r) => r.method === "commands.list")).toHaveLength(2)
	})

	test("a settle whose binding moved on is discarded: no rows, no cache — the new agent's round wins", async () => {
		const h = makeHarness()
		const gates = {
			a1: deferred<unknown>(),
			a2: deferred<unknown>(),
		}
		h.replies.set("commands.list", {
			kind: "async",
			fn: async (params) => {
				const agentId = String(params?.agentId)
				const gate = agentId === "a1" ? gates.a1 : gates.a2
				const value = agentId === "a1" ? ROWS_A1 : ROWS_A2
				await gate.promise
				return { kind: "value", value }
			},
		})

		h.seam.resumeSession("a1")
		const p1 = h.seam.hostCommands.list() // in-flight for a1
		h.seam.newSession() // binding dropped (epoch bump + in-flight clear)
		h.seam.resumeSession("a2")
		const p2 = h.seam.hostCommands.list() // in-flight for a2

		gates.a1.resolve(undefined) // a1 settles LAST, under a2's binding
		expect(await p1).toEqual([]) // discarded — nobody is on a1 anymore

		gates.a2.resolve(undefined)
		expect(await p2).toEqual(ROWS_A2)
		// a2's rows are cached: the next list rides the cache (no new request)
		expect(await h.seam.hostCommands.list()).toEqual(ROWS_A2)
		expect(h.requests.filter((r) => r.method === "commands.list")).toHaveLength(2)

		// a1 was never cached: restaging a1 goes back to the wire and serves
		// a1's own rows (no a2 leakage across the per-agentId key)
		h.seam.resumeSession("a1")
		gates.a1.resolve(undefined) // second a1 round resolves immediately
		expect(await h.seam.hostCommands.list()).toEqual(ROWS_A1)
		expect(h.requests.filter((r) => r.method === "commands.list")).toHaveLength(3)
	})
})
