/**
 * External (ACP/agy) subagent bridge coverage.
 *
 * Drives the real apply()/NDJSON path with a fake cordis host. The frozen
 * client contract is intentionally narrower than local agent lifecycle:
 *   agent.external.spawn  {sessionId, childId, label?, name?, createdAt}
 *   agent.external.settle {sessionId, childId, stopReason?, summary?, endedAt}
 */
import { afterEach, describe, expect, test } from "bun:test"
import { apply } from "../src/index"
import { getSubagentIndex } from "../src/subagent-index"

const STDIO_SWITCH = "DSH_OPENTUI_BRIDGE_STDIO"
type Frame = Record<string, any>
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const cleanups: Array<() => void> = []

afterEach(() => {
	while (cleanups.length > 0) cleanups.pop()!()
})

const childRow = (sessionId: string, parentSessionId: string, running = true) => ({
	sessionId,
	updatedAt: 1000,
	agentAvailable: running,
	running,
	blank: false,
	parentSessionId,
	origin: "subagent",
})

interface JournalRow {
	seq: number
	type: string
	data: Frame
}

interface HarnessOptions {
	rows?: Frame[]
	children?: Record<string, {}>
	journal?: JournalRow[]
	hangingInterrupts?: string[]
}

function makeHarness(options: HarnessOptions = {}) {
	const previousSwitch = process.env[STDIO_SWITCH]
	process.env[STDIO_SWITCH] = "1"

	const originalWrite = process.stdout.write.bind(process.stdout)
	const frames: string[] = []
	const patchedWrite = function (this: unknown, chunk: any, ...rest: any[]) {
		frames.push(String(chunk))
		let parsed: any
		try { parsed = JSON.parse(String(chunk).trim()) } catch { /* reporter noise */ }
		const isBridgeFrame =
			parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) &&
			("ok" in parsed || "type" in parsed) &&
			("id" in parsed || "payload" in parsed || "result" in parsed || "error" in parsed)
		if (isBridgeFrame) return true
		return originalWrite(chunk, ...rest)
	} as typeof process.stdout.write
	process.stdout.write = patchedWrite

	const stdinListeners: Record<string, Array<(...args: any[]) => void>> = {}
	const fakeStdin = {
		setEncoding() {},
		on(name: string, fn: (...args: any[]) => void) { (stdinListeners[name] ||= []).push(fn); return fakeStdin },
		off(name: string, fn: (...args: any[]) => void) { (stdinListeners[name] ||= []).filter((f) => f !== fn); return fakeStdin },
		pause() { return fakeStdin },
		resume() { return fakeStdin },
	}
	const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin")
	Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true })

	let rows: Frame[] = [...(options.rows ?? [])]
	const controller = {
		calls: [] as any[],
		async list(request: any) {
			controller.calls.push(request)
			return { items: rows }
		},
	}

	const cancelCalls = new Map<string, Array<{ cause: any; options: any }>>()
	for (const id of Object.keys(options.children ?? {})) cancelCalls.set(id, [])
	const idlePromise = new Promise<void>(() => { /* never resolves */ })
	const parentAgent = {
		status: "idle",
		session: { seq: 0 },
		followup() {},
		steer() {},
		cancel() {},
		whenIdle() { return idlePromise },
	}
	const agents = {
		async create() { return { agent: parentAgent, dispose: async () => {} } },
		async resume() { return { agent: parentAgent, dispose: async () => {} } },
		get(id: string) {
			if (!cancelCalls.has(id)) return undefined
			return {
				...parentAgent,
				cancel(cause: any, cancelOptions: any) { cancelCalls.get(id)!.push({ cause, options: cancelOptions }) },
			}
		},
	}

	const interruptCalls: string[] = []
	const subagents = {
		async interruptByUser(childId: string) {
			interruptCalls.push(childId)
			if (options.hangingInterrupts?.includes(childId)) return new Promise<{ accepted: true }>(() => {})
			return { accepted: true as const }
		},
	}
	const policySessionGets: string[] = []
	const sessions = {
		get(id: string) {
			policySessionGets.push(id)
			return undefined
		},
	}
	const approval = {
		effectivePolicy() { return "ask" },
		overrideOf() { return "ask" },
	}

	const journal = [...(options.journal ?? [])]
	const persistence = {
		async open(_id: string, _access: "read" | "write") {
			return {
				async read(offset = 0) { return { events: journal.slice(offset, offset + 100) } },
				async close() {},
			}
		},
	}

	const eventListeners = new Map<string, Array<(...args: any[]) => void>>()
	let disposeBridge: (() => void) | undefined
	const ctx: any = {
		logger: { info() {}, warn() {}, error() {}, debug() {} },
		effect(execute: () => () => void) {
			disposeBridge = execute()
			return { dispose: () => disposeBridge?.() }
		},
		on(name: string, listener: (...args: any[]) => void) {
			const next = [...(eventListeners.get(name) || []), listener]
			eventListeners.set(name, next)
			return () => eventListeners.set(name, next.filter((l) => l !== listener))
		},
		get(name: string) {
			if (name === "sessionController") return controller
			if (name === "agents") return agents
			if (name === "subagents") return subagents
			if (name === "sessions") return sessions
			if (name === "approval") return approval
			if (name === "sessionPersistence") return persistence
			return undefined
		},
		agents,
	}
	apply(ctx, {})

	cleanups.push(() => {
		try { disposeBridge?.() } catch { /* already torn down */ }
		process.stdout.write = originalWrite
		if (stdinDescriptor) Object.defineProperty(process, "stdin", stdinDescriptor)
		else delete (process as any).stdin
		if (previousSwitch === undefined) delete process.env[STDIO_SWITCH]
		else process.env[STDIO_SWITCH] = previousSwitch
	})

	const parsed = (): Frame[] => {
		const out: Frame[] = []
		for (const line of frames) {
			try {
				const frame = JSON.parse(line)
				if (frame !== null && typeof frame === "object" && !Array.isArray(frame)) out.push(frame)
			} catch { /* reporter noise */ }
		}
		return out
	}
	const latest = (id: number): Frame | undefined => {
		for (let i = frames.length - 1; i >= 0; i--) {
			try {
				const frame = JSON.parse(frames[i])
				if (frame !== null && typeof frame === "object" && frame.id === id) return frame
			} catch { /* noise */ }
		}
		return undefined
	}
	const waitFor = async (id: number): Promise<Frame> => {
		const deadline = Date.now() + 2000
		for (;;) {
			const frame = latest(id)
			if (frame !== undefined) return frame
			if (Date.now() > deadline) throw new Error(`no response for id=${id}`)
			await sleep(1)
		}
	}
	const waitUntil = async (predicate: () => boolean): Promise<void> => {
		const deadline = Date.now() + 2000
		while (!predicate()) {
			if (Date.now() > deadline) throw new Error("condition did not become true")
			await sleep(1)
		}
	}

	return {
		ctx,
		controller,
		interruptCalls,
		policySessionGets,
		parsed,
		waitFor,
		waitUntil,
		setRows(next: Frame[]) { rows = next },
		cancelCallsOf(id: string) { return cancelCalls.get(id) ?? [] },
		eventFrames(type: string): Frame[] { return parsed().filter((frame) => frame.type === type) },
		emitSessionEvent(session: unknown, event: unknown) {
			for (const fn of eventListeners.get("session/event") || []) fn(session, event)
		},
		async emitHostEvent(name: string, ...args: any[]): Promise<any[]> {
			const results: any[] = []
			for (const fn of eventListeners.get(name) || []) results.push(await fn(...args))
			return results
		},
		send(frame: unknown) {
			for (const fn of stdinListeners["data"] || []) fn(`${JSON.stringify(frame)}\n`)
		},
	}
}

async function openParent(h: ReturnType<typeof makeHarness>, id: number): Promise<string> {
	h.send({ id, method: "session.open", params: { mode: "new" } })
	const opened = await h.waitFor(id)
	expect(opened.ok).toBe(true)
	return opened.result.sessionId as string
}

function emitExternalCatalog(
	h: ReturnType<typeof makeHarness>,
	parent: string,
	childId: string,
	createdAt = 1795074915408,
	extra: Frame = {},
): void {
	h.emitSessionEvent(
		{ id: parent },
		{ type: "subagent/catalog", data: { version: 3, mode: "external", childId, childCreatedAt: createdAt, ...extra } },
	)
}

function emitSettledNotice(h: ReturnType<typeof makeHarness>, parent: string, childId: string, source: Frame = {}): void {
	h.emitSessionEvent(
		{ id: parent },
		{
			type: "user/message",
			data: { source: { kind: "subagent-settled", senderSessionId: childId, ...source } },
		},
	)
}

describe("external catalog discovery", () => {
	test("emits only the frozen spawn frame, indexes external mode, and skips local policy/transcript paths", async () => {
		const h = makeHarness()
		const parent = await openParent(h, 1)

		emitExternalCatalog(h, parent, "ext-1", 1795074915408, { label: "ACP task", name: "agy" })

		expect(h.eventFrames("agent.external.spawn")).toEqual([{
			type: "agent.external.spawn",
			payload: { sessionId: parent, childId: "ext-1", label: "ACP task", name: "agy", createdAt: 1795074915408 },
		}])
		expect(h.eventFrames("agent.spawn")).toHaveLength(0)
		expect(getSubagentIndex(h.ctx).get("ext-1")).toEqual({
			parentSessionId: parent,
			startedAt: 1795074915408,
			status: "running",
			mode: "external",
		})
		expect(h.policySessionGets).toEqual([])
	})

	test("omits optional label/name and ignores an external catalog without createdAt", async () => {
		const h = makeHarness()
		const parent = await openParent(h, 2)
		emitExternalCatalog(h, parent, "ext-minimal", 123)
		h.emitSessionEvent(
			{ id: parent },
			{ type: "subagent/catalog", data: { version: 3, mode: "external", childId: "ext-incomplete", label: "no clock" } },
		)

		expect(h.eventFrames("agent.external.spawn")).toEqual([{
			type: "agent.external.spawn",
			payload: { sessionId: parent, childId: "ext-minimal", createdAt: 123 },
		}])
		expect(getSubagentIndex(h.ctx).has("ext-incomplete")).toBe(false)
	})

	test("external children are not ask-routing targets", async () => {
		const h = makeHarness()
		const parent = await openParent(h, 3)
		h.send({ id: 4, method: "session.send", params: { text: "run" } })
		expect((await h.waitFor(4)).ok).toBe(true)
		emitExternalCatalog(h, parent, "ext-ask", 123)

		const outcomes = await h.emitHostEvent(
			"approval/request",
			{ agent: { session: { id: "ext-ask" } }, toolName: "bash", callId: "call-1" },
			async () => "allowed-once",
		)
		expect(outcomes).toEqual(["unavailable"])
		expect(h.eventFrames("ask.request")).toHaveLength(0)
	})
})

describe("external settle notices", () => {
	test("exact subagent-settled flips the index and emits the frozen settle frame with wall-clock endedAt", async () => {
		const h = makeHarness()
		const parent = await openParent(h, 10)
		emitExternalCatalog(h, parent, "ext-settle", 100)
		const before = Date.now()

		emitSettledNotice(h, parent, "ext-settle", { stopReason: "completed", summary: "done" })
		const after = Date.now()

		const settles = h.eventFrames("agent.external.settle")
		expect(settles).toHaveLength(1)
		expect(settles[0].type).toBe("agent.external.settle")
		expect(Object.keys(settles[0].payload).sort()).toEqual(["childId", "endedAt", "sessionId", "stopReason", "summary"])
		expect(settles[0].payload).toMatchObject({
			sessionId: parent,
			childId: "ext-settle",
			stopReason: "completed",
			summary: "done",
		})
		expect(settles[0].payload.endedAt).toBeGreaterThanOrEqual(before)
		expect(settles[0].payload.endedAt).toBeLessThanOrEqual(after)
		expect(getSubagentIndex(h.ctx).get("ext-settle")?.status).toBe("settled")
	})

	test("agent-message with senderSessionId is not a settle; unknown ids do not create or flip rows", async () => {
		const h = makeHarness()
		const parent = await openParent(h, 11)
		emitExternalCatalog(h, parent, "ext-known", 100)
		h.emitSessionEvent(
			{ id: parent },
			{
				type: "user/message",
				data: { source: { kind: "agent-message", senderSessionId: "ext-known", summary: "not terminal" } },
			},
		)
		emitSettledNotice(h, parent, "ext-unknown", { stopReason: "completed" })

		expect(h.eventFrames("agent.external.settle")).toHaveLength(0)
		expect(getSubagentIndex(h.ctx).get("ext-known")?.status).toBe("running")
		expect(getSubagentIndex(h.ctx).has("ext-unknown")).toBe(false)
	})

	test("a settle notice never flips a local row through the external path", async () => {
		const h = makeHarness()
		const parent = await openParent(h, 12)
		h.emitSessionEvent(
			{ id: parent },
			{ type: "subagent/catalog", data: { version: 3, childId: "local-1", childCreatedAt: 100 } },
		)
		emitSettledNotice(h, parent, "local-1", { stopReason: "completed" })

		expect(h.eventFrames("agent.external.settle")).toHaveLength(0)
		expect(getSubagentIndex(h.ctx).get("local-1")?.status).toBe("running")
	})
})

describe("external interrupt and stopChildren", () => {
	test("interrupt delegates to subagents.interruptByUser and keeps the roster response shape", async () => {
		const h = makeHarness({ children: { "ext-1": {} } })
		const parent = await openParent(h, 20)
		emitExternalCatalog(h, parent, "ext-1", 100)
		h.setRows([childRow("ext-1", parent, true)])

		h.send({ id: 21, method: "subagents.interrupt", params: { parentSessionId: parent, childId: "ext-1" } })
		const reply = await h.waitFor(21)

		expect(reply.ok).toBe(true)
		expect(reply.result).toEqual({ childId: "ext-1", disposition: "cancel-issued" })
		expect(h.interruptCalls).toEqual(["ext-1"])
		expect(h.cancelCallsOf("ext-1")).toHaveLength(0)
		expect(h.policySessionGets).toEqual([])
	})

	test("stopChildren interrupts running external rows without a host agent and excludes settled external rows", async () => {
		const h = makeHarness({ children: { "local-1": {} } })
		const parent = await openParent(h, 22)
		emitExternalCatalog(h, parent, "ext-settled", 100)
		emitSettledNotice(h, parent, "ext-settled", { stopReason: "completed" })
		emitExternalCatalog(h, parent, "ext-running", 200)
		h.setRows([
			childRow("ext-settled", parent, true), // stale host bit must not revive external settled
			childRow("local-1", parent, true),
		])

		h.send({ id: 23, method: "subagents.stopChildren", params: { parentSessionId: parent } })
		const reply = await h.waitFor(23)

		expect(reply.ok).toBe(true)
		expect(reply.result.children).toHaveLength(2)
		expect(reply.result.children).toEqual(expect.arrayContaining([
			{ childId: "ext-running", disposition: "cancel-issued" },
			{ childId: "local-1", disposition: "cancel-issued" },
		]))
		expect(h.interruptCalls).toEqual(["ext-running"])
		expect(h.cancelCallsOf("ext-running")).toHaveLength(0)
		expect(h.cancelCallsOf("local-1")).toHaveLength(1)
		expect(getSubagentIndex(h.ctx).get("ext-settled")?.status).toBe("settled")
	})

	test("stopChildren times out a hung external interrupt without blocking a later local cancel", async () => {
		const h = makeHarness({ children: { "local-1": {} }, hangingInterrupts: ["ext-hung"] })
		const parent = await openParent(h, 24)
		emitExternalCatalog(h, parent, "ext-hung", 100)
		h.setRows([
			childRow("ext-hung", parent, true),
			childRow("local-1", parent, true),
		])

		h.send({ id: 25, method: "subagents.stopChildren", params: { parentSessionId: parent } })
		const reply = await h.waitFor(25)

		expect(reply.ok).toBe(true)
		expect(reply.result.children).toEqual([
			{ childId: "ext-hung", disposition: "failed", detail: "subagents.interruptByUser timed out after 1000ms" },
			{ childId: "local-1", disposition: "cancel-issued" },
		])
		expect(h.interruptCalls).toEqual(["ext-hung"])
		expect(h.cancelCallsOf("local-1")).toHaveLength(1)
	})
})

describe("external journal recovery", () => {
	const journal: JournalRow[] = [
		{ seq: 1, type: "subagent/catalog", data: { mode: "external", childId: "ext-done", childCreatedAt: 100 } },
		{
			seq: 2,
			type: "user/message",
			data: { source: { kind: "subagent-settled", senderSessionId: "ext-done", stopReason: "completed" } },
		},
		{ seq: 3, type: "subagent/catalog", data: { mode: "external", childId: "ext-live", childCreatedAt: 200 } },
	]

	test("journal.replay before open seeds external ids and settled state from the full log", async () => {
		const h = makeHarness({ journal })
		h.send({ id: 30, method: "journal.replay", params: { sessionId: "parent-journal", from: 2 } })
		const reply = await h.waitFor(30)

		expect(reply.ok).toBe(true)
		expect(reply.result.rows.map((row: Frame) => row.seq)).toEqual([2, 3])
		expect(getSubagentIndex(h.ctx).get("ext-done")).toMatchObject({ mode: "external", status: "settled" })
		expect(getSubagentIndex(h.ctx).get("ext-live")).toMatchObject({ mode: "external", status: "running" })
	})

	test("resume bind reconstructs external state without a catalog replay", async () => {
		const h = makeHarness({ journal })
		h.send({ id: 31, method: "session.open", params: { mode: "resume", id: "parent-journal" } })
		expect((await h.waitFor(31)).ok).toBe(true)
		await h.waitUntil(() => getSubagentIndex(h.ctx).has("ext-done") && getSubagentIndex(h.ctx).has("ext-live"))

		expect(getSubagentIndex(h.ctx).get("ext-done")).toMatchObject({
			parentSessionId: "parent-journal",
			mode: "external",
			status: "settled",
		})
		expect(getSubagentIndex(h.ctx).get("ext-live")).toMatchObject({
			parentSessionId: "parent-journal",
			mode: "external",
			status: "running",
		})
		expect(h.eventFrames("agent.external.spawn")).toHaveLength(0)
	})

	test("journal restore heals the same live run but does not clobber a newer run", async () => {
		const h = makeHarness({ journal })
		const parent = await openParent(h, 32)
		emitExternalCatalog(h, parent, "ext-done", 100)

		h.send({ id: 33, method: "journal.replay", params: { sessionId: parent } })
		expect((await h.waitFor(33)).ok).toBe(true)
		expect(getSubagentIndex(h.ctx).get("ext-done")?.status).toBe("settled")

		emitExternalCatalog(h, parent, "ext-done", 300)
		h.send({ id: 34, method: "journal.replay", params: { sessionId: parent } })
		expect((await h.waitFor(34)).ok).toBe(true)
		expect(getSubagentIndex(h.ctx).get("ext-done")).toMatchObject({ startedAt: 300, status: "running" })
	})
})
