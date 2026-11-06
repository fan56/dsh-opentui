/**
 * RemoteSessionSeam adapter unit tests (batch 9a): mapping fidelity against
 * the batch-2a table (tui-base/src/seams/session.ts header) and the
 * seam-rows.ts event payload contract. The facade is a minimal structural
 * fake — the adapter reads only its public surface.
 */
import { describe, expect, test } from "bun:test"
import { RemoteSessionSeam, projectJournalRecord } from "../src/client/session-seam-adapter.ts"
import type { RemoteJournalEntry } from "../src/client/remote-session-ops.ts"
import type { SeamSessionEvent } from "../../../tui-base/src/seams/session"

type Callbacks = Parameters<RemoteSessionSeam["turn"]>[1]

/** Minimal RemoteHostSession double: records calls, plays canned data. */
function fakeSession(overrides: Record<string, unknown> = {}) {
	const calls: { method: string; args: unknown }[] = []
	const journalListeners: ((entry: RemoteJournalEntry) => void)[] = []
	let askProvider: ((q: unknown[]) => Promise<unknown[]>) | undefined
	const base = {
		label: "dsh-host",
		usage: { prompt: 3, completion: 5, cacheRead: 0, cacheWrite: 0 },
		lastTurnStats: { ms: 0, chars: 0, tokens: 0, tps: null, estimated: false, startedAt: 0, endedAt: 0 },
		status: {
			connection: "connected" as const,
			turn: "idle" as const,
			sessionAttached: true,
			tailActive: false,
		},
		currentSessionId: () => "ses-live",
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
			{ kind: "assistant", text: "a", final: false },
			{ kind: "ask", entries: [{ question: "Go?", options: ["y", "n"], selected: ["y"], declined: false }] },
		],
		resumeSession: (id: string) => {
			calls.push({ method: "resumeSession", args: id })
			return "ok" as const
		},
		newSession: () => calls.push({ method: "newSession", args: undefined }),
		renameSession: async (title: string) => {
			calls.push({ method: "renameSession", args: title })
			return { title, seq: 7 }
		},
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
		modelCatalog: async () => ({
			groups: [
				{ id: "prov-a", models: [{ id: "ma1" }, { id: "ma2" }] },
				{ id: "prov-b", models: [{ id: "mb1" }] },
			],
		}),
		currentModelSelection: async () => ({ provider: "prov-a", model: "ma1", reasoningEffort: "high" }),
		selectModel: async (selection: unknown) => {
			calls.push({ method: "selectModel", args: selection })
			return selection
		},
		usageSummary: () => ["turns 1"],
		onJournalRecord: (listener: (entry: RemoteJournalEntry) => void) => {
			journalListeners.push(listener)
			return () => {
				journalListeners.splice(journalListeners.indexOf(listener), 1)
			}
		},
		dispose: async () => calls.push({ method: "dispose", args: undefined }),
		...overrides,
	}
	return {
		session: base as unknown as import("../src/client/remote-host-session.ts").RemoteHostSession,
		calls,
		journalListeners,
		getAskProvider: () => askProvider,
	}
}

describe("RemoteSessionSeam mapping fidelity (batch-2a table)", () => {
	test("status projects the view slice, dropping tailActive", async () => {
		const { session } = fakeSession()
		const seam = new RemoteSessionSeam(session)
		expect(seam.status()).toEqual({ connection: "connected", turn: "idle", sessionAttached: true })
	})

	test("listSessions passes the limit and propagates optional updatedAt", async () => {
		const { session, calls } = fakeSession()
		const seam = new RemoteSessionSeam(session)
		const rows = await seam.listSessions(5)
		expect(calls[0]).toEqual({ method: "listSessions", args: 5 })
		expect(rows).toEqual([
			{ id: "ses-1", title: "t1", updatedAt: "2026-11-06" },
			{ id: "ses-2", title: "t2" },
		])
	})

	test("storedTranscript: durable rows final-true, assistant keeps its flag, ask rows project Q&A text", async () => {
		const { session } = fakeSession()
		const seam = new RemoteSessionSeam(session)
		const rows = await seam.storedTranscript("ses-1")
		expect(rows).toEqual([
			{ kind: "user", text: "q", final: true },
			{ kind: "assistant", text: "a", final: false },
			{ kind: "ask", text: "Go? → y", final: true },
		])
	})

	test("searchSessions / resumeSession / renameSession / steer / newSession are 1:1", async () => {
		const { session, calls } = fakeSession()
		const seam = new RemoteSessionSeam(session)
		expect(await seam.searchSessions("x")).toEqual([{ id: "ses-9", snippet: "hit" }])
		expect(seam.resumeSession("ses-1")).toBe("ok")
		expect(await seam.renameSession("renamed")).toEqual({ title: "renamed", seq: 7 })
		seam.steer("go left")
		seam.newSession()
		expect(seam.currentSessionId()).toBe("ses-live")
		const methods = calls.map((c) => c.method)
		expect(methods).toContain("searchSessions")
		expect(calls.find((c) => c.method === "renameSession")?.args).toBe("renamed")
		expect(calls.find((c) => c.method === "steer")?.args).toBe("go left")
	})

	test("interrupt maps to the facade abort (session/cancel + fresh-next-send)", () => {
		const { session, calls } = fakeSession()
		const seam = new RemoteSessionSeam(session)
		seam.interrupt()
		expect(calls.map((c) => c.method)).toEqual(["abort"])
	})

	test("modelCatalog flattens wire provider groups into SeamProviderModel rows", async () => {
		const { session } = fakeSession()
		const seam = new RemoteSessionSeam(session)
		expect(await seam.modelCatalog(true)).toEqual([
			{ providerID: "prov-a", modelID: "ma1" },
			{ providerID: "prov-a", modelID: "ma2" },
			{ providerID: "prov-b", modelID: "mb1" },
		])
	})

	test("currentModelSelection renames {provider,model} → {providerID,modelID}", async () => {
		const { session } = fakeSession()
		const seam = new RemoteSessionSeam(session)
		expect(await seam.currentModelSelection()).toEqual({ providerID: "prov-a", modelID: "ma1" })
	})

	test("selectModel inverts the argument shape onto ModelSelection", async () => {
		const { session, calls } = fakeSession()
		const seam = new RemoteSessionSeam(session)
		seam.selectModel("prov-a", "ma2")
		await Promise.resolve()
		expect(calls.find((c) => c.method === "selectModel")?.args).toEqual({ provider: "prov-a", model: "ma2" })
	})

	test("listProviders / usageSummary pass through untouched", async () => {
		const { session } = fakeSession()
		const seam = new RemoteSessionSeam(session)
		expect(await seam.listProviders()).toEqual([{ provider: "p", models: ["m1", "m2"] }])
		expect(seam.usageSummary()).toEqual(["turns 1"])
	})
})

describe("turn callback adaptation", () => {
	test("onApprove verdict strings map to the facade boolean (fail closed)", async () => {
		let captured: Callbacks | undefined
		const { session: sessionOk } = fakeSession({
			turn: async (_text: string, cb: Callbacks) => {
				captured = cb
			},
		})
		const seam = new RemoteSessionSeam(sessionOk)
		await seam.turn("hello", {
			onThinkingDelta: () => {},
			onContentDelta: () => {},
			onApprove: async () => "allowed-once",
			onError: () => {},
		})
		expect(await captured?.onApprove("bash", {})).toBe(true)
		// "rejected" (and any non-allowed-once arm) fails closed.
		let captured2: Callbacks | undefined
		const { session: sessionRej } = fakeSession({
			turn: async (_text: string, cb: Callbacks) => {
				captured2 = cb
			},
		})
		await new RemoteSessionSeam(sessionRej).turn("x", {
			onThinkingDelta: () => {},
			onContentDelta: () => {},
			onApprove: async () => "rejected",
			onError: () => {},
		})
		expect(await captured2?.onApprove("bash", {})).toBe(false)
	})

	test("registerAskProvider passes the question/answer shapes through structurally", async () => {
		const { session, getAskProvider } = fakeSession()
		const seam = new RemoteSessionSeam(session)
		const questions = [{ id: "q1", prompt: "Pick", options: ["a", "b"] }]
		let received: unknown
		seam.registerAskProvider(async (q) => {
			received = q
			return [{ questionId: "q1", selected: "a" }]
		})
		const provider = getAskProvider()
		expect(provider).toBeDefined()
		const answers = (await provider?.(questions)) as unknown[]
		expect(received).toEqual(questions)
		expect(answers).toEqual([{ questionId: "q1", selected: "a" }])
	})
})

describe("event feed (seam-rows payload contract)", () => {
	test("projectJournalRecord: user/message → message.updated {id, role, text, sessionID}", () => {
		const events = projectJournalRecord(
			{ type: "user/message", seq: 3, time: 0, data: { messageID: "m-3", content: [{ type: "text", text: "hello" }] } },
			"ses-live",
		)
		expect(events).toEqual([{ type: "message.updated", details: { id: "m-3", role: "user", text: "hello", sessionID: "ses-live" } }])
	})

	test("projectJournalRecord: assistant/message → message.part.updated with a text part", () => {
		const events = projectJournalRecord(
			{ type: "assistant/message", seq: 4, time: 0, data: { messageID: "m-4", text: "answer" } },
			"ses-live",
		)
		expect(events).toEqual([
			{
				type: "message.part.updated",
				details: { messageID: "m-4", sessionID: "ses-live", part: { type: "text", id: "m-4:text", text: "answer" } },
			},
		])
	})

	test("projectJournalRecord: turn/end error → session.error; clean turn/end and tool records → none", () => {
		const error = projectJournalRecord(
			{ type: "turn/end", seq: 5, time: 0, data: { reason: { kind: "error", error: { message: "boom" } } } },
			"ses-live",
		)
		expect(error).toEqual([{ type: "session.error", details: { message: "boom", sessionID: "ses-live" } }])
		expect(projectJournalRecord({ type: "turn/end", seq: 6, time: 0, data: {} }, "ses-live")).toEqual([])
		expect(projectJournalRecord({ type: "tool/call", seq: 7, time: 0, data: { name: "bash" } }, "s")).toEqual([])
	})

	test("journal feed fans out to onSessionEvent listeners; unsubscribe detaches", async () => {
		const { session, journalListeners } = fakeSession()
		const seam = new RemoteSessionSeam(session)
		const seen: SeamSessionEvent[] = []
		const unsubscribe = seam.onSessionEvent((event) => seen.push(event))
		expect(journalListeners.length).toBe(1)
		journalListeners[0]?.({ type: "user/message", seq: 1, time: 0, data: { messageID: "m1", content: [{ type: "text", text: "hi" }] } })
		expect(seen.map((e) => e.type)).toEqual(["message.updated"])
		unsubscribe()
		journalListeners[0]?.({ type: "user/message", seq: 2, time: 0, data: { messageID: "m2", content: [{ type: "text", text: "hi2" }] } })
		expect(seen.length).toBe(1)
	})

	test("journal events are suppressed while one of OUR turns is in flight (double-paint law)", async () => {
		let release: (() => void) | undefined
		const { session, journalListeners } = fakeSession({
			turn: (_text: string, _cb: unknown) =>
				new Promise<void>((resolve) => {
					release = resolve
				}),
		})
		const seam = new RemoteSessionSeam(session)
		const seen: SeamSessionEvent[] = []
		seam.onSessionEvent((event) => seen.push(event))
		const pending = seam.turn("hello", {
			onThinkingDelta: () => {},
			onContentDelta: () => {},
			onApprove: async () => "rejected",
			onError: () => {},
		})
		// mid-turn: durable records of the same content are dropped
		journalListeners[0]?.({ type: "assistant/message", seq: 9, time: 0, data: { messageID: "m9", text: "dup" } })
		expect(seen).toEqual([])
		release?.()
		await pending
		// after the turn: external pushes flow again
		journalListeners[0]?.({ type: "assistant/message", seq: 10, time: 0, data: { messageID: "m10", text: "post" } })
		expect(seen.map((e) => e.type)).toEqual(["message.part.updated"])
	})

	test("a listener that throws never takes the feed down", () => {
		const { session, journalListeners } = fakeSession()
		const seam = new RemoteSessionSeam(session)
		const seen: string[] = []
		seam.onSessionEvent(() => {
			throw new Error("view bug")
		})
		seam.onSessionEvent((event) => seen.push(event.type))
		journalListeners[0]?.({ type: "assistant/message", seq: 11, time: 0, data: { messageID: "m", text: "t" } })
		expect(seen).toEqual(["message.part.updated"])
	})
})

describe("dispose", () => {
	test("detaches the journal feed and disposes the facade", async () => {
		const { session, calls, journalListeners } = fakeSession()
		const seam = new RemoteSessionSeam(session)
		seam.onSessionEvent(() => {})
		expect(journalListeners.length).toBe(1)
		await seam.dispose()
		expect(journalListeners.length).toBe(0)
		expect(calls.map((c) => c.method)).toEqual(["dispose"])
	})
})

describe("RemoteSessionSeam cacheHitMode (batch F2)", () => {
	test("cacheHitRate forwards the mode 1:1; configLoad reads the facade config", async () => {
		const modes: (string | undefined)[] = []
		const { session } = fakeSession({
			cacheHitRate: (mode?: "session" | "lastMessage") => {
				modes.push(mode)
				return mode === "session" ? 55 : 20
			},
			configLoad: () => ({ cacheHitMode: "session" }),
		})
		const seam = new RemoteSessionSeam(session as never)
		expect(seam.cacheHitRate()).toBe(20)
		expect(seam.cacheHitRate("lastMessage")).toBe(20)
		expect(seam.cacheHitRate("session")).toBe(55)
		expect(modes).toEqual([undefined, "lastMessage", "session"])
		expect(seam.configLoad()).toEqual({ cacheHitMode: "session" })
	})
})
