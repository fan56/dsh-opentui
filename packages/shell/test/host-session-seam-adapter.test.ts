/**
 * HostSessionSeam adapter unit tests (batch 10a): the plugin-mode twin of
 * the batch-9a RemoteSessionSeam tests — mapping fidelity vs the deltas
 * documented in the adapter header and the seam-rows.ts event payload
 * contract. The facade is a minimal structural double.
 */
import { describe, expect, test } from "bun:test"
import { HostSessionSeam, projectJournalRecord } from "../src/host-session-seam-adapter.ts"
import type { SeamSessionEvent } from "../../../tui-base/src/seams/session"

type Callbacks = Parameters<HostSessionSeam["turn"]>[1]

/** Minimal HostSession double: records calls, plays canned data. */
function fakeSession(overrides: Record<string, unknown> = {}) {
	const calls: { method: string; args: unknown }[] = []
	const journalListeners: ((entry: { seq: number; type: string; data: Record<string, unknown> }) => void)[] = []
	let askProvider: ((q: unknown[]) => Promise<unknown[]>) | undefined
	const base = {
		currentSessionId: () => "ses-live" as string | undefined,
		listSessions: async (limit?: number) => {
			calls.push({ method: "listSessions", args: limit })
			return [{ id: "ses-1", title: "t1", updatedAt: "2026-11-06" }, { id: "ses-2", title: "t2" }]
		},
		searchSessions: async (query: string) => {
			calls.push({ method: "searchSessions", args: query })
			return [{ id: "ses-9", snippet: "hit" }]
		},
		storedTranscript: async () => [
			{ kind: "user", text: "q" },
			{ kind: "assistant", text: "a" },
		],
		resumeSession: (id: string) => {
			calls.push({ method: "resumeSession", args: id })
			return "ok" as const
		},
		newSession: () => calls.push({ method: "newSession", args: undefined }),
		turn: async (text: string, cb: Record<string, unknown>) => {
			calls.push({ method: "turn", args: text })
			void cb
		},
		steer: (text: string) => calls.push({ method: "steer", args: text }),
		abort: () => calls.push({ method: "abort", args: undefined }),
		registerAskProvider: (provider: (q: unknown[]) => Promise<unknown[]>) => {
			askProvider = provider
			calls.push({ method: "registerAskProvider", args: undefined })
		},
		listProviders: async () => [{ provider: "p", models: ["m1", "m2"] }],
		currentModelSelection: () => ({ provider: "prov-a", model: "ma1", reasoningEffort: "high" }),
		switchModel: (provider: string, model: string) => calls.push({ method: "switchModel", args: { provider, model } }),
		usageSummary: () => ["turns 1"],
		onJournalRecord: (listener: (entry: { seq: number; type: string; data: Record<string, unknown> }) => void) => {
			journalListeners.push(listener)
			return () => {
				journalListeners.splice(journalListeners.indexOf(listener), 1)
			}
		},
		...overrides,
	}
	return { session: base as never, calls, journalListeners, askProvider: () => askProvider }
}

function turnCbs(overrides: Partial<Record<keyof Callbacks, unknown>> = {}): Callbacks {
	return {
		onThinkingDelta: () => {},
		onContentDelta: () => {},
		onApprove: async () => "allowed-once",
		onError: () => {},
		...overrides,
	} as Callbacks
}

describe("HostSessionSeam status", () => {
	test("in-process connection, derived turn + attach slice", () => {
		const { session } = fakeSession()
		const seam = new HostSessionSeam(session)
		expect(seam.status()).toEqual({ connection: "connected", turn: "idle", sessionAttached: true })
		const detached = fakeSession({ currentSessionId: () => undefined })
		expect(new HostSessionSeam(detached.session).status().sessionAttached).toBe(false)
	})
})

describe("HostSessionSeam reads", () => {
	test("listSessions projects the row shape", async () => {
		const { session, calls } = fakeSession()
		const rows = await new HostSessionSeam(session).listSessions(5)
		expect(calls[0]).toEqual({ method: "listSessions", args: 5 })
		expect(rows).toEqual([
			{ id: "ses-1", title: "t1", updatedAt: "2026-11-06" },
			{ id: "ses-2", title: "t2" },
		])
	})

	test("storedTranscript defaults final=true on every row", async () => {
		const { session } = fakeSession()
		const rows = await new HostSessionSeam(session).storedTranscript("ses-1")
		expect(rows).toEqual([
			{ kind: "user", text: "q", final: true },
			{ kind: "assistant", text: "a", final: true },
		])
	})

	test("modelCatalog flattens providers×models (no catalog endpoint)", async () => {
		const { session } = fakeSession()
		const rows = await new HostSessionSeam(session).modelCatalog(true)
		expect(rows).toEqual([
			{ providerID: "p", modelID: "m1" },
			{ providerID: "p", modelID: "m2" },
		])
	})

	test("currentModelSelection renames to providerID/modelID", async () => {
		const { session } = fakeSession()
		const none = fakeSession({ currentModelSelection: () => undefined })
		expect(await new HostSessionSeam(session).currentModelSelection()).toEqual({ providerID: "prov-a", modelID: "ma1" })
		expect(await new HostSessionSeam(none.session).currentModelSelection()).toBeUndefined()
	})

	test("renameSession is a documented stub (not sourced on the facade)", async () => {
		const { session } = fakeSession()
		expect(await new HostSessionSeam(session).renameSession("x")).toBeUndefined()
	})
})

describe("HostSessionSeam writes", () => {
	test("turn adapts callbacks: approve verdict→boolean, onTurnEnd/onToolRun no-op", async () => {
		let approves = 0
		const { session, calls } = fakeSession({
			turn: async (text: string, cb: Record<string, unknown>) => {
				calls.push({ method: "turn", args: text })
				const ok = await (cb.onApprove as (n: string, a: Record<string, unknown>) => Promise<boolean>)("bash", {})
				expect(ok).toBe(true) // "allowed-once" → true
				approves = 1
				const no = await (cb.onApprove as (n: string, a: Record<string, unknown>) => Promise<boolean>)("bash", {})
				expect(no).toBe(false) // "rejected" → fail-closed
				expect(typeof cb.onTurnEnd).toBe("function")
				expect(typeof cb.onToolRun).toBe("function")
				cb.onThinkingDelta?.("t")
				cb.onContentDelta?.("c")
			},
		})
		const seen: string[] = []
		await new HostSessionSeam(session).turn(
			"hello",
			turnCbs({
				onThinkingDelta: (t) => seen.push(`think:${t}`),
				onContentDelta: (t) => seen.push(`content:${t}`),
				onApprove: async () => (approves === 0 ? "allowed-once" : "rejected"),
			}),
		)
		expect(calls[0]?.method).toBe("turn")
		expect(seen).toEqual(["think:t", "content:c"])
	})

	test("interrupt maps to abort; steer and selectModel map 1:1", () => {
		const { session, calls } = fakeSession()
		const seam = new HostSessionSeam(session)
		seam.steer("go left")
		seam.interrupt()
		seam.selectModel("prov-b", "mb1")
		expect(calls.map((c) => [c.method, c.args])).toEqual([
			["steer", "go left"],
			["abort", undefined],
			["switchModel", { provider: "prov-b", model: "mb1" }],
		])
	})

	test("registerAskProvider is structural passthrough", async () => {
		const { session, askProvider } = fakeSession()
		const seam = new HostSessionSeam(session)
		seam.registerAskProvider(async (questions) => questions.map((q) => ({ questionId: q.id, selected: q.options[0] ?? "" })))
		const picks = await askProvider()([{ id: "q1", prompt: "P?", options: ["a", "b"] }])
		expect(picks).toEqual([{ questionId: "q1", selected: "a" }])
	})
})

describe("HostSessionSeam journal feed", () => {
	test("projects user/assistant/error records onto the seam-rows payloads", () => {
		expect(projectJournalRecord({ seq: 1, type: "user/message", data: { content: [{ type: "text", text: "hi" }] } }, "s1")).toEqual([
			{ type: "message.updated", details: { id: "journal-1", role: "user", text: "hi", sessionID: "s1" } },
		])
		expect(
			projectJournalRecord({ seq: 2, type: "assistant/message", data: { message: { content: [{ type: "text", text: "yo" }] } } }, "s1"),
		).toEqual([
			{ type: "message.part.updated", details: { messageID: "journal-2", sessionID: "s1", part: { type: "text", id: "journal-2:text", text: "yo" } } },
		])
		expect(
			projectJournalRecord({ seq: 3, type: "turn/end", data: { reason: { kind: "error", error: { message: "boom" } } } }, "s1"),
		).toEqual([{ type: "session.error", details: { message: "boom", sessionID: "s1" } }])
		expect(projectJournalRecord({ seq: 4, type: "tool/call", data: {} }, "s1")).toEqual([])
	})

	test("onSessionEvent subscribes + suppresses while our own turn is in flight", async () => {
		const { session, journalListeners } = fakeSession({
			turn: async (_text: string, cb: Record<string, unknown>) => {
				// durable record arrives mid-turn (live paint owns the rows)
				for (const listener of journalListeners) listener({ seq: 9, type: "assistant/message", data: { text: "mid" } })
				await new Promise((resolve) => setTimeout(resolve, 10))
			},
		})
		const seam = new HostSessionSeam(session)
		const events: SeamSessionEvent[] = []
		const off = seam.onSessionEvent((event) => events.push(event))
		expect(journalListeners.length).toBe(1)
		const done = seam.turn("hello", turnCbs())
		for (const listener of journalListeners) listener({ seq: 10, type: "user/message", data: { content: [{ type: "text", text: "after" }] } })
		await done
		for (const listener of journalListeners) listener({ seq: 11, type: "user/message", data: { content: [{ type: "text", text: "post" }] } })
		expect(events).toEqual([{ type: "message.updated", details: { id: "journal-11", role: "user", text: "post", sessionID: "ses-live" } }])
		off()
		for (const listener of journalListeners) listener({ seq: 12, type: "user/message", data: { content: [{ type: "text", text: "gone" }] } })
		expect(events.length).toBe(1)
	})

	test("dispose drops the journal sink and listeners", async () => {
		const { session, journalListeners } = fakeSession()
		const seam = new HostSessionSeam(session)
		seam.onSessionEvent(() => {})
		expect(journalListeners.length).toBe(1)
		await seam.dispose()
		expect(journalListeners.length).toBe(0) // the facade sink is unregistered too
		expect(seam.status().turn).toBe("idle")
	})
})

describe("HostSessionSeam cacheHitMode (batch F2)", () => {
	test("cacheHitRate forwards the mode 1:1; configLoad reads the facade config", () => {
		const modes: (string | undefined)[] = []
		const { session } = fakeSession({
			cacheHitRate: (mode?: "session" | "lastMessage") => {
				modes.push(mode)
				return mode === "session" ? 55 : 20
			},
			configLoad: () => ({ cacheHitMode: "session" }),
		})
		const seam = new HostSessionSeam(session)
		expect(seam.cacheHitRate()).toBe(20)
		expect(seam.cacheHitRate("lastMessage")).toBe(20)
		expect(seam.cacheHitRate("session")).toBe(55)
		expect(modes).toEqual([undefined, "lastMessage", "session"])
		expect(seam.configLoad()).toEqual({ cacheHitMode: "session" })
	})
})
