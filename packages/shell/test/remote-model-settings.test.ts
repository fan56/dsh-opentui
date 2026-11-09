// RemoteHostSession wave-2 cluster tests: model (catalog / selectModel /
// switchModel staging / cold-boot label / projections), presets, credentials,
// settings (+ the login double-write seam), plugins/skills caches, push-event
// routing (settings/document-updated, commands/change, plugin-manager/changed,
// credentials/reference-updated), rename, search, history ledger + fork, and
// the status surface. Fake connection + fake mux sockets, real wire frames.
import { describe, expect, test } from "bun:test"
import { RemoteHostSession } from "../src/client/remote-host-session.ts"
import { RemoteModelClient } from "../src/client/remote-model.ts"
import { RemoteRpcError, type ClientConnection } from "../src/client/transport.ts"
import { FakeConnection, FakeMuxSocket, eventFrame, rpcOf, snapshotFrame, streamFrame, until, type RpcHandler } from "./client-fakes.ts"
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

/** Accept session/create + session/prompt with a stable session id. */
function defaultRpcHandler(sessionId = "sess-1"): RpcHandler {
	return (method) => {
		if (method === "session/create") return { sessionId, agentPreset: "default" }
		if (method === "session/prompt") return { accepted: true }
		if (method === "session/cancel") return { accepted: true }
		return {}
	}
}

function callbacks(overrides: Partial<TurnCallbacks> = {}): { cb: TurnCallbacks; log: { content: string[]; turnEnds: number[]; errors: string[]; missedRows: { kind: string; text: string }[][] } } {
	const log = {
		content: [] as string[],
		turnEnds: [] as number[],
		errors: [] as string[],
		missedRows: [] as { kind: string; text: string }[][] as { kind: string; text: string }[][],
	}
	const cb: TurnCallbacks = {
		onThinkingDelta: () => {},
		onContentDelta: (t) => log.content.push(t),
		onTurnEnd: (u) => log.turnEnds.push(u.prompt + u.completion),
		onApprove: async () => true,
		onToolRun: () => {},
		onError: (m) => log.errors.push(m),
		onReattachedMissed: (rows) => log.missedRows.push(rows),
		...overrides,
	}
	return { cb, log }
}

const CATALOG = {
	default: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "high" },
	routableProviders: ["deepseek"],
	groups: [
		{
			id: "deepseek",
			name: "DeepSeek",
			models: [
				{ id: "deepseek-chat", name: "DeepSeek Chat", reasoning: { efforts: [{ id: "high", name: "High" }], defaultEffort: "high" } },
				{ id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
			],
		},
	],
	failures: [{ id: "openai", name: "OpenAI", message: "credentials missing" }],
}

describe("model cluster (rows 21+22)", () => {
	test("modelCatalog maps the host-generation catalog; listProviders reads groups", async () => {
		let catalogCalls = 0
		const h = makeSession({
			rpcHandler: (method) => {
				if (method === "session/modelCatalog") {
					catalogCalls++
					return CATALOG
				}
				return {}
			},
		})
		const catalog = await h.session.modelCatalog()
		expect(catalog.default).toEqual({ provider: "deepseek", model: "deepseek-chat", reasoningEffort: "high" })
		expect(catalog.groups).toHaveLength(1)
		expect(catalog.groups[0]!.models[0]!.reasoning?.efforts).toEqual([{ id: "high", name: "High" }])
		expect(catalog.groups[0]!.models[1]!.reasoning).toBeUndefined()
		expect(catalog.failures).toEqual([{ id: "openai", name: "OpenAI", message: "credentials missing" }])
		// host parity: cached between route commits
		await h.session.modelCatalog()
		expect(catalogCalls).toBe(1)
		expect(await h.session.listProviders()).toEqual([
			{ provider: "deepseek", models: ["deepseek-chat", "deepseek-reasoner"] },
		])
		// force bypasses the cache
		await h.session.modelCatalog(true)
		expect(catalogCalls).toBe(2)
		await h.session.dispose()
	})

	test("defaultModelSelection is the cold-boot label source; start() applies it once", async () => {
		const h = makeSession({
			rpcHandler: (method) => (method === "session/modelCatalog" ? CATALOG : {}),
		})
		expect(h.session.label).toBe("dsh-host")
		await h.session.start()
		await until(() => h.session.label === "deepseek/deepseek-chat (high)")
		await h.session.dispose()
		// a fresh session with no catalog answer keeps the generic label
		const h2 = makeSession({
			rpcHandler: () => {
				throw new Error("down")
			},
		})
		await h2.session.start()
		expect(h2.session.label).toBe("dsh-host")
		await h2.session.dispose()
	})

	test("selectModel round-trips session/selectModel on the live session", async () => {
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "session/create") return { sessionId: "sess-m1" }
				if (method === "session/selectModel") {
					const req = args["request"] as Record<string, unknown>
					expect(req.sessionId).toBe("sess-m1")
					expect(req.provider).toBe("deepseek")
					expect(req.model).toBe("deepseek-reasoner")
					return { selected: { provider: req.provider, model: req.model, reasoningEffort: req.reasoningEffort } }
				}
				if (method === "session/prompt") return { accepted: true }
				return {}
			},
		})
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		h.lastSocket().item(snapshotFrame("sess-m1"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		const selected = await h.session.selectModel({ provider: "deepseek", model: "deepseek-reasoner" })
		expect(selected).toEqual({ provider: "deepseek", model: "deepseek-reasoner" })
		expect(h.session.label).toBe("deepseek/deepseek-reasoner")
		h.lastSocket().item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		await pending
		await h.session.dispose()
	})

	test("switchModel with no live session stages the route onto the next create", async () => {
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "session/create") return { sessionId: "sess-m2" }
				if (method === "session/selectModel") {
					const req = args["request"] as Record<string, unknown>
					return { selected: { provider: req.provider, model: req.model, reasoningEffort: req.reasoningEffort } }
				}
				if (method === "session/prompt") return { accepted: true }
				return {}
			},
		})
		h.session.switchModel("deepseek", "deepseek-reasoner", "low")
		expect(h.session.label).toBe("deepseek/deepseek-reasoner (low)")
		expect(h.session.currentSessionId()).toBeUndefined()
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		// selectModel fires BEFORE the prompt on the fresh session
		await until(() => rpcOf(h.connection, "session/selectModel") !== undefined)
		const promptBeforeSelect = rpcOf(h.connection, "session/prompt") === undefined
		expect(promptBeforeSelect).toBe(true)
		const sel = rpcOf(h.connection, "session/selectModel")!["request"] as Record<string, unknown>
		expect(sel).toEqual({ sessionId: "sess-m2", provider: "deepseek", model: "deepseek-reasoner", reasoningEffort: "low" })
		await until(() => h.sockets.length > 0)
		h.lastSocket().item(snapshotFrame("sess-m2"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		h.lastSocket().item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		await pending
		await h.session.dispose()
	})

	test("currentModelSelection reads the session projection (next falls back to lastUsed)", async () => {
		const h = makeSession({
			rpcHandler: (method) => {
				if (method === "session/create") return { sessionId: "sess-m3" }
				if (method === "session/prompt") return { accepted: true }
				if (method === "session/projections") {
					return {
						kind: "sequenced",
						asOfSeq: 5,
						values: {
							modelSelection: {
								lastUsed: { provider: "deepseek", model: "deepseek-chat" },
								pending: { provider: "deepseek", model: "deepseek-reasoner", reasoningEffort: "low" },
								next: { provider: "deepseek", model: "deepseek-reasoner", reasoningEffort: "low" },
							},
						},
					}
				}
				return {}
			},
		})
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		h.lastSocket().item(snapshotFrame("sess-m3"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		expect(await h.session.currentModelSelection()).toEqual({ provider: "deepseek", model: "deepseek-reasoner", reasoningEffort: "low" })
		h.lastSocket().item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		await pending
		await h.session.dispose()
	})

	test("sessionProjections parses modelSelection + contextPressure defensively in one round-trip", async () => {
		const calls: { method: string; args: Record<string, unknown> }[] = []
		let answer: unknown = {
			values: {
				modelSelection: { lastUsed: { provider: "prov-a", model: "big" }, next: { provider: "prov-b", model: "tiny" } },
				contextPressure: { contextWindow: 128000, projectedTokens: 45000, pressureTokens: 42000 },
				agentPreset: "ptc",
			},
		}
		const client = new RemoteModelClient({
			rpc: async (method, args) => {
				calls.push({ method, args: args ?? {} })
				return answer
			},
		})
		const proj = await client.sessionProjections("sess-p9")
		expect(calls).toEqual([{ method: "session/projections", args: { request: { sessionId: "sess-p9" } } }])
		expect(proj.selection).toEqual({ provider: "prov-b", model: "tiny" })
		expect(proj.pressure).toEqual({ contextWindow: 128000, projectedTokens: 45000, pressureTokens: 42000 })
		// the web header label source rides the same answer
		expect(proj.agentPreset).toBe("ptc")
		// sessionSelection keeps its row-22 contract over the same answer
		expect(await client.sessionSelection("sess-p9")).toEqual({ provider: "prov-b", model: "tiny" })

		// no values / null answer → both rows absent
		answer = {}
		expect(await client.sessionProjections("sess-p9")).toEqual({})
		answer = null
		expect(await client.sessionProjections("sess-p9")).toEqual({})

		// garbage fields read as absent: negative tokens, 0 window, wrong types
		answer = {
			values: {
				modelSelection: { pending: { provider: "prov-a", model: "big" } },
				contextPressure: { contextWindow: 0, projectedTokens: -5, pressureTokens: "lots", extra: true },
				agentPreset: "",
			},
		}
		const garbage = await client.sessionProjections("sess-p9")
		expect(garbage.selection).toEqual({ provider: "prov-a", model: "big" }) // next folds → pending
		expect(garbage.pressure).toBeUndefined()
		expect(garbage.agentPreset).toBeUndefined() // empty string = deployment composes none
	})
})

describe("presets (row 23)", () => {
	test("listPresets maps the roster; readPreset/selectPreset ride the wire", async () => {
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "agentPresets/list") {
					return { presets: [{ id: "default", isDefault: true }, { id: "reviewer", name: "Reviewer" }] }
				}
				if (method === "agentPresets/read") {
					expect(args).toEqual({ agentPreset: "reviewer" })
					return { agentPreset: "reviewer", content: "childPlugins: []", name: "Reviewer" }
				}
				if (method === "agentPresets/select") {
					expect(args).toEqual({ agentId: "sess-p1", agentPreset: "reviewer" })
					return "reviewer"
				}
				if (method === "session/create") return { sessionId: "sess-p1" }
				if (method === "session/prompt") return { accepted: true }
				return {}
			},
		})
		expect(await h.session.listPresets()).toEqual([
			{ id: "default", name: "default", isDefault: true },
			{ id: "reviewer", name: "Reviewer" },
		])
		const doc = await h.session.readPreset("reviewer")
		expect(doc?.content).toBe("childPlugins: []")
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		h.lastSocket().item(snapshotFrame("sess-p1"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		expect(await h.session.selectPreset("reviewer")).toBe("reviewer")
		h.lastSocket().item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		await pending
		await h.session.dispose()
	})

	test("listPresets carries the display face: shipped-id English names, isDefault, description; broken rows dropped", async () => {
		const h = makeSession({
			rpcHandler: (method) => {
				if (method === "agentPresets/list") {
					return {
						presets: [
							{ id: "standard", isDefault: true, description: "code and files" },
							{ id: "ptc" },
							{ id: "minimal", name: "Minimal", broken: "missing plugin" },
							{ id: "audit", name: "Audit", description: "custom" },
						],
					}
				}
				return {}
			},
		})
		// Shipped declarations publish no `name`; the client-side English map
		// keeps "standard"/"ptc" from reaching the footer and the picker as
		// bare ids (tui-pi PRESET_ENGLISH_NAMES parity).
		expect(await h.session.listPresets()).toEqual([
			{ id: "standard", name: "Standard", description: "code and files", isDefault: true },
			{ id: "ptc", name: "PTC" },
			{ id: "audit", name: "Audit", description: "custom" },
		])
		await h.session.dispose()
	})
})

describe("credentials + settings (rows 24+25)", () => {
	test("credentialStatus/login/logout ride credentials/describe|set|unset", async () => {
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "credentials/describe") {
					expect(args).toEqual({ refs: ["DEEPSEEK_API_KEY"] })
					return { DEEPSEEK_API_KEY: { configured: true, source: "env", writable: true } }
				}
				if (method === "credentials/set") {
					expect(args).toEqual({ ref: "DEEPSEEK_API_KEY", value: "sk-test" })
					return {}
				}
				if (method === "credentials/unset") {
					expect(args).toEqual({ ref: "DEEPSEEK_API_KEY" })
					return {}
				}
				return {}
			},
		})
		expect(await h.session.credentialStatus("DEEPSEEK_API_KEY")).toEqual({ configured: true })
		await h.session.login("DEEPSEEK_API_KEY", "sk-test")
		await h.session.logout("DEEPSEEK_API_KEY")
		await h.session.dispose()
	})

	test("settingsSeam.mutate carries the unset route op — the exact logout inverse of login's set", async () => {
		const mutations: { args: Record<string, unknown> }[] = []
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "settings/describe") {
					return {
						writable: true,
						hasDocument: false,
						namespaces: [{ ns: "llm-pi-ai", revision: 7, value: { providers: { auditprov: { apiKeyEnv: "AUDITPROV_API_KEY" } } }, schema: {} }],
					}
				}
				if (method === "settings/mutate") {
					mutations.push({ args: args as Record<string, unknown> })
					return { ns: "llm-pi-ai", revision: 8, value: { providers: {} } }
				}
				return {}
			},
		})
		const seam = h.session.settingsSeam
		// the login.tsx writeRoute("set") frame (login direction, pinned here as the inverse base)
		await seam.mutate("llm-pi-ai", [{ op: "set", path: ["providers", "auditprov"], value: { apiKeyEnv: "AUDITPROV_API_KEY" } }], 7)
		// the login.tsx writeRoute("unset") frame (logout direction)
		await seam.mutate("llm-pi-ai", [{ op: "unset", path: ["providers", "auditprov"] }], 7)
		expect(mutations).toEqual([
			{ args: { ns: "llm-pi-ai", ops: [{ op: "set", path: ["providers", "auditprov"], value: { apiKeyEnv: "AUDITPROV_API_KEY" } }], expectedRevision: 7 } },
			{ args: { ns: "llm-pi-ai", ops: [{ op: "unset", path: ["providers", "auditprov"] }], expectedRevision: 7 } },
		])
		await h.session.dispose()
	})

	test("model catalog invalidates on login/logout/settings writes and route pushes (logout leaves /model)", async () => {
		const WITH_AUDITPROV = {
			default: { provider: "auditprov", model: "fake-m" },
			routableProviders: ["auditprov"],
			groups: [{ id: "auditprov", name: "auditprov", models: [{ id: "fake-m", name: "fake-m" }] }],
			failures: [],
		}
		const AFTER_LOGOUT = {
			default: { provider: "auditprov", model: "fake-m" },
			routableProviders: [],
			groups: [],
			failures: [],
		}
		let serving = WITH_AUDITPROV
		let catalogCalls = 0
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "session/modelCatalog") {
					catalogCalls++
					return serving
				}
				if (method === "credentials/unset") {
					expect(args).toEqual({ ref: "AUDITPROV_API_KEY" })
					return {}
				}
				if (method === "credentials/set") return {}
				if (method === "settings/mutate") return { ns: "llm-pi-ai", revision: 2, value: { providers: {} } }
				if (method === "settings/update") return { ns: "llm-pi-ai", revision: 3, value: {} }
				if (method === "settings/replace") return { ns: "llm-pi-ai", revision: 4, value: {} }
				return {}
			},
		})

		// cached: the second read hits the cache (host parity), /model shows the provider
		await h.session.modelCatalog()
		await h.session.modelCatalog()
		expect(catalogCalls).toBe(1)
		expect(await h.session.listProviders()).toEqual([{ provider: "auditprov", models: ["fake-m"] }])

		// logout (the credentials/unset half) drops the cache: the next read
		// re-fetches the fresh host answer, where the provider is gone
		serving = AFTER_LOGOUT
		await h.session.logout("AUDITPROV_API_KEY")
		expect(await h.session.listProviders()).toEqual([])
		expect(catalogCalls).toBe(2)

		// login invalidates too (stale-absence direction: a newly subscribed
		// provider must appear without a restart)
		serving = WITH_AUDITPROV
		await h.session.login("AUDITPROV_API_KEY", "sk-fake")
		expect((await h.session.modelCatalog()).groups.map((g) => g.id)).toEqual(["auditprov"])
		expect(catalogCalls).toBe(3)
		expect((await h.session.modelCatalog()).groups.map((g) => g.id)).toEqual(["auditprov"])
		expect(catalogCalls).toBe(3) // re-cached after the invalidation

		await h.session.start() // pushes need the event subscription
		// settings/document-updated from ANOTHER surface drops the cache
		// (the invalidation in #onEmitEvent is synchronous)
		serving = AFTER_LOGOUT
		h.connection.emitEvent("settings/document-updated", "llm-pi-ai", 9)
		expect((await h.session.modelCatalog()).groups).toEqual([])
		expect(catalogCalls).toBe(4)
		// credentials/reference-updated flips routability the same way
		serving = WITH_AUDITPROV
		h.connection.emitEvent("credentials/reference-updated", "AUDITPROV_API_KEY")
		expect((await h.session.modelCatalog()).groups.map((g) => g.id)).toEqual(["auditprov"])
		expect(catalogCalls).toBe(5)
		// the local settings writes invalidate as well (route half of /login //logout)
		serving = AFTER_LOGOUT
		await h.session.settingsSeam.mutate("llm-pi-ai", [{ op: "unset", path: ["providers", "auditprov"] }], 9)
		expect((await h.session.modelCatalog()).groups).toEqual([])
		expect(catalogCalls).toBe(6)
		await h.session.settingsMutate("llm-pi-ai", [], 10)
		expect((await h.session.modelCatalog()).groups).toEqual([])
		expect(catalogCalls).toBe(7)
		await h.session.settingsUpdate("llm-pi-ai", {}, 11)
		expect((await h.session.modelCatalog()).groups).toEqual([])
		expect(catalogCalls).toBe(8)
		await h.session.settingsReplace("llm-pi-ai", {}, 12)
		expect((await h.session.modelCatalog()).groups).toEqual([])
		expect(catalogCalls).toBe(9)
		await h.session.dispose()
	})

	test("settingsSeam describes flat rows and mutates with the read revision (login double-write parity)", async () => {
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "settings/describe") {
					return {
						writable: true,
						hasDocument: false,
						namespaces: [{ ns: "llm-pi-ai", revision: 4, value: { providers: {} }, schema: {} }],
					}
				}
				if (method === "settings/mutate") {
					expect(args).toEqual({
						ns: "llm-pi-ai",
						ops: [{ op: "set", path: ["providers", "custom"], value: { apiKeyEnv: "CUSTOM_API_KEY" } }],
						expectedRevision: 4,
					})
					return { ns: "llm-pi-ai", revision: 5, value: { providers: { custom: {} } } }
				}
				return {}
			},
		})
		const seam = h.session.settingsSeam
		const rows = await seam.describe()
		expect(rows).toEqual([{ ns: "llm-pi-ai", revision: 4, value: { providers: {} }, schema: {} }])
		await seam.mutate("llm-pi-ai", [{ op: "set", path: ["providers", "custom"], value: { apiKeyEnv: "CUSTOM_API_KEY" } }], 4)
		await h.session.dispose()
	})

	test("settingsDescribe/settingsMutate/update/replace map the document view; push notifies listeners", async () => {
		let described = 0
		const h = makeSession({
			rpcHandler: (method) => {
				if (method === "settings/describe") {
					described++
					return { writable: true, hasDocument: true, namespaces: [{ ns: "llm-deepseek", revision: 2, value: {} }] }
				}
				if (method === "settings/update") {
					return { ns: "llm-deepseek", revision: 3, value: {} }
				}
				if (method === "settings/replace") {
					return { ns: "llm-deepseek", revision: 4, value: {} }
				}
				return {}
			},
		})
		const rows = await h.session.settingsDescribe()
		expect(rows).toEqual([{ ns: "llm-deepseek", revision: 2, value: {} }])
		const doc = await h.session.settingsDocument()
		expect(doc.writable).toBe(true)
		expect(doc.hasDocument).toBe(true)
		const updated = await h.session.settingsUpdate("llm-deepseek", { model: "x" }, 2)
		expect(updated.revision).toBe(3)
		await h.session.settingsReplace("llm-deepseek", { model: "y" }, 3)
		// settingsDescribe + settingsDocument each read the document view
		expect(described).toBe(2)

		await h.session.start()
		const updates: [string, number][] = []
		const dispose = h.session.onSettingsUpdated((ns, revision) => updates.push([ns, revision]))
		h.connection.emitEvent("settings/document-updated", "llm-deepseek", 7)
		await until(() => updates.length === 1)
		expect(updates[0]).toEqual(["llm-deepseek", 7])
		dispose()
		h.connection.emitEvent("settings/document-updated", "llm-deepseek", 8)
		await new Promise((r) => setTimeout(r, 20))
		expect(updates.length).toBe(1)
		await h.session.dispose()
	})

	test("credential/reference push reaches listeners", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler() })
		await h.session.start()
		const refs: string[] = []
		const dispose = h.session.onCredentialUpdated((ref) => refs.push(ref))
		h.connection.emitEvent("credentials/reference-updated", "OPENAI_API_KEY")
		await until(() => refs.length === 1)
		expect(refs[0]).toBe("OPENAI_API_KEY")
		dispose()
		await h.session.dispose()
	})
})

describe("commands (row 26)", () => {
	test("listHostCommands is agent-scoped: [] without a session, registry with one", async () => {
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "commands/list") {
					expect(args).toEqual({ agentId: "sess-c1" })
					return [{ name: "compact", description: "Compact" }]
				}
				if (method === "session/create") return { sessionId: "sess-c1" }
				if (method === "session/prompt") return { accepted: true }
				if (method === "commands/execute") {
					const req = args as Record<string, unknown>
					expect(req.agentId).toBe("sess-c1")
					return { commandId: "c1", result: { kind: "success", text: "done" } }
				}
				return {}
			},
		})
		expect(await h.session.listHostCommands()).toEqual([])
		expect(await h.session.executeHostCommand("/compact")).toEqual({ text: "host command service unavailable" })
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		h.lastSocket().item(snapshotFrame("sess-c1"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		expect(await h.session.listHostCommands()).toEqual([{ name: "compact", description: "Compact" }])
		expect(await h.session.executeHostCommand("/compact")).toEqual({ text: "done" })
		// a failing execution surfaces as the error text (host-session parity)
		h.connection.rpcHandler = (method) => {
			if (method === "commands/execute") throw new RemoteRpcError("commands/failed", "boom", {})
			if (method === "session/cancel") return { accepted: true }
			return {}
		}
		expect(await h.session.executeHostCommand("/compact")).toEqual({ text: "boom" })
		h.connection.rpcHandler = defaultRpcHandler("sess-c1")
		h.lastSocket().item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		await pending
		await h.session.dispose()
	})

	test("commands/change push reaches listeners", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler() })
		await h.session.start()
		let changes = 0
		const dispose = h.session.onHostCommandsChanged(() => changes++)
		h.connection.emitEvent("commands/change")
		await until(() => changes === 1)
		dispose()
		await h.session.dispose()
	})
})

describe("plugins + skills caches (rows 27+28)", () => {
	test("refreshPlugins maps listPlugins rows (built-ins out, versions from bundles); push auto-refreshes", async () => {
		let listed = 0
		const h = makeSession({
			rpcHandler: (method) => {
				if (method === "pluginManager/listPlugins") {
					listed++
					return [
						{ entryId: "e1", moduleName: "@deepseek-ai/dsh-agent", meta: { title: "Agent" }, enabled: true },
						{ entryId: "e2", moduleName: "my-opentui-plugin", meta: { title: "My Plugin" }, enabled: true },
						{ entryId: "e3", moduleName: "bare-plugin", enabled: true },
					]
				}
				if (method === "pluginManager/listBundles") {
					return [{ name: "x", moduleName: "my-opentui-plugin", version: "1.2.3" }]
				}
				return {}
			},
		})
		expect(h.session.listPlugins()).toEqual([]) // sync cache before refresh
		const rows = await h.session.refreshPlugins()
		expect(rows).toEqual([
			{ name: "My Plugin", version: "1.2.3" },
			{ name: "bare-plugin", version: "" },
		])
		expect(h.session.listPlugins()).toEqual(rows) // sync read hits the cache
		expect(listed).toBe(1)
		// the plugin-manager/changed push auto-refreshes, then notifies
		await h.session.start()
		let notified = 0
		const dispose = h.session.onPluginsChanged(() => notified++)
		h.connection.emitEvent("plugin-manager/changed", { reason: "plugin" })
		await until(() => notified === 1 && listed === 2, 4000)
		dispose()
		await h.session.dispose()
	})

	test("refreshSkills reads the session-scoped catalog once a session is live", async () => {
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "skills/list") {
					expect(args).toEqual({ request: { sessionId: "sess-s1" } })
					return { skills: [{ name: "review", description: "Review", modelInvocable: false }] }
				}
				if (method === "session/create") return { sessionId: "sess-s1" }
				if (method === "session/prompt") return { accepted: true }
				return {}
			},
		})
		expect(h.session.listSkills()).toEqual([])
		await h.session.refreshSkills() // no live session: cache unchanged
		expect(h.session.listSkills()).toEqual([])
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		h.lastSocket().item(snapshotFrame("sess-s1"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		const rows = await h.session.refreshSkills()
		expect(rows).toEqual([{ name: "review", description: "Review", invocation: "/review" }])
		expect(h.session.listSkills()).toEqual(rows)
		h.lastSocket().item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		await pending
		await h.session.dispose()
	})
})

describe("history + fork (row 18) and rename (row 20)", () => {
	async function runTurn(h: ReturnType<typeof makeSession>, sessionId: string): Promise<ReturnType<typeof callbacks>> {
		const { cb, log } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		h.lastSocket().item(
			snapshotFrame(sessionId, {
				records: [
					{ type: "event", event: { type: "turn/start", seq: 1, time: 1, data: { turn: 1 } } },
					{ type: "event", event: { type: "user/message", seq: 2, time: 2, data: { source: { kind: "user" }, content: [{ type: "text", text: "first question" }] } } },
					{ type: "event", event: { type: "assistant/message", seq: 3, time: 3, data: { message: { content: [{ type: "text", text: "answer one" }] } } } },
					{ type: "event", event: { type: "turn/end", seq: 4, time: 4, data: { turn: 1, reason: { kind: "completed" } } } },
				],
			}),
		)
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		return { cb, log, pending }
	}

	test("historyTurns groups the follow ledger; forkAtTurn switches to the forked session", async () => {
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "session/create") return { sessionId: "sess-h1" }
				if (method === "session/prompt") return { accepted: true }
				if (method === "session/fork") {
					const req = (args["request"] ?? {}) as Record<string, unknown>
					if (req.sessionId === "sess-h1") expect(req.atSeq).toBe(4)
					return { sessionId: req.sessionId === "sess-h1" ? "fork-h1" : "fork-h2" }
				}
				return {}
			},
		})
		const { pending } = await runTurn(h, "sess-h1")
		// ledger from the attach snapshot: one completed turn
		expect(h.session.historyTurns()).toEqual([{ turn: 1, seqEnd: 4, preview: "first question" }])

		const forkPending = h.session.forkAtTurn(4)
		await until(() => h.sockets.length > 1)
		h.sockets[1]!.item(
			snapshotFrame("fork-h1", {
				header: { version: 1, id: "fork-h1", createdAt: 0, isSeeded: true },
				records: [
					{ type: "event", event: { type: "turn/start", seq: 1, time: 1, data: { turn: 1 } } },
					{ type: "event", event: { type: "user/message", seq: 2, time: 2, data: { source: { kind: "user" }, content: [{ type: "text", text: "first question" }] } } },
					{ type: "event", event: { type: "assistant/message", seq: 3, time: 3, data: { message: { content: [{ type: "text", text: "answer one" }] } } } },
					{ type: "event", event: { type: "turn/end", seq: 4, time: 4, data: { turn: 1, reason: { kind: "completed" } } } },
				],
			}),
		)
		const forked = await forkPending
		expect(forked.items).toEqual([
			{ kind: "user", text: "first question" },
			{ kind: "assistant", text: "answer one" },
		])
		expect(forked.turn).toBe(1)
		expect(h.session.currentSessionId()).toBe("fork-h1")
		// the ledger now belongs to the forked session
		expect(h.session.historyTurns()).toEqual([{ turn: 1, seqEnd: 4, preview: "first question" }])

		// fork with NO atSeq = latest completed turn (omission on the wire)
		const forkPending2 = h.session.forkAtTurn()
		await until(() => h.sockets.length > 2)
		const forkCall = h.connection.rpcCalls.filter((c) => c.method === "session/fork").at(-1)!
		expect(forkCall.args).toEqual({ request: { sessionId: "fork-h1" } })
		h.sockets[2]!.item(snapshotFrame("fork-h2"))
		await forkPending2
		h.sockets[2]!.item(eventFrame("turn/end", { turn: 2, reason: { kind: "completed" } }, 9))
		await pending
		await h.session.dispose()
	})

	test("forkAtTurn without a live session throws (host-session parity)", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler() })
		await expect(h.session.forkAtTurn(4)).rejects.toThrow(/no live session to fork/)
		await h.session.dispose()
	})

	test("renameSession rides session/rename on the live session", async () => {
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "session/create") return { sessionId: "sess-r1" }
				if (method === "session/prompt") return { accepted: true }
				if (method === "session/rename") {
					expect(args).toEqual({ request: { sessionId: "sess-r1", title: "Renamed" } })
					return { title: "renamed", seq: 5 }
				}
				return {}
			},
		})
		expect(await h.session.renameSession("no session yet")).toBeUndefined()
		const { pending } = await runTurn(h, "sess-r1")
		expect(await h.session.renameSession("Renamed")).toEqual({ title: "renamed", seq: 5 })
		h.lastSocket().item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 5))
		await pending
		await h.session.dispose()
	})
})

describe("row 12 fresh-id semantics + row 19 search", () => {
	test("/new re-creates with a FRESH id and adopts the host's answer", async () => {
		const created: (string | undefined)[] = []
		const h = makeSession({
			rpcHandler: (method, args) => {
				if (method === "session/create") {
					created.push((args["request"] as Record<string, unknown>)["sessionId"])
					// the host's blank-reuse may answer a DIFFERENT id
					return { sessionId: created.length === 1 ? "host-chosen" : "host-chosen-2" }
				}
				if (method === "session/prompt") return { accepted: true }
				return {}
			},
		})
		const { cb } = callbacks()
		const first = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		h.lastSocket().item(snapshotFrame("host-chosen"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		expect(h.session.currentSessionId()).toBe("host-chosen")
		expect(created[0]).toMatch(/^[0-9a-f-]{36}$/)
		h.lastSocket().item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		await first

		h.session.newSession()
		const second = h.session.turn("again", cb)
		await until(() => h.connection.rpcCalls.filter((c) => c.method === "session/create").length === 2)
		// a fresh client-minted id — never the previous session's id
		expect(created[1]).toMatch(/^[0-9a-f-]{36}$/)
		expect(created[1]).not.toBe(created[0])
		await until(() => h.sockets.length > 1)
		h.sockets[1]!.item(snapshotFrame("host-chosen-2"))
		await until(() => h.connection.rpcCalls.some((c) => c.method === "session/prompt" && (c.args["request"] as Record<string, unknown>)["sessionId"] === "host-chosen-2"))
		expect(h.session.currentSessionId()).toBe("host-chosen-2")
		h.sockets[1]!.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		await second
		await h.session.dispose()
	})

	test("searchSessions maps session/search (row 19)", async () => {
		const h = makeSession({
			rpcHandler: (method, args) => {
				expect(method).toBe("session/search")
				expect(args).toEqual({ request: { query: "needle" } })
				return { items: [{ sessionId: "s1", snippet: "a  needle  here" }], hasMore: false }
			},
		})
		expect(await h.session.searchSessions("needle")).toEqual([{ id: "s1", snippet: "a needle here" }])
		await h.session.dispose()
	})
})

describe("status surface (wave-2 polish)", () => {
	test("status tracks connection/turn phases through a turn and reconnect", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-st") })
		const { cb } = callbacks()
		expect(h.session.status).toMatchObject({ connection: "connecting", turn: "idle", sessionAttached: false, tailActive: false })
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		expect(h.session.status.turn).toBe("starting")
		h.lastSocket().item(snapshotFrame("sess-st"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		expect(h.session.status.turn).toBe("running")
		expect(h.session.status.sessionAttached).toBe(true)
		// transport loss mid-turn: reconnecting phase + label swap
		h.lastSocket().close()
		await until(() => h.session.status.turn === "reconnecting")
		expect(h.session.label).toBe("reconnecting…")
		h.connection.setState("connected")
		await until(() => h.sockets.length > 1)
		h.sockets[1]!.item(snapshotFrame("sess-st"))
		await until(() => h.session.status.turn === "running")
		expect(h.session.label).not.toBe("reconnecting…")
		h.sockets[1]!.item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		await pending
		expect(h.session.status.turn).toBe("idle")
		expect(h.session.status.connection).toBe("connected")
		await h.session.dispose()
		expect(h.session.status.connection).toBe("disconnected")
	})
})

describe("row 16 idle-release (host-native)", () => {
	test("the client keeps no lease machinery: no idle timers, sessions stay claimed", async () => {
		const h = makeSession({ rpcHandler: defaultRpcHandler("sess-idle") })
		const { cb } = callbacks()
		const pending = h.session.turn("go", cb)
		await until(() => h.sockets.length > 0)
		h.lastSocket().item(snapshotFrame("sess-idle"))
		await until(() => rpcOf(h.connection, "session/prompt") !== undefined)
		await new Promise((r) => setTimeout(r, 50))
		// long past any plausible in-process idle-release window: the session
		// id is still ours (the host owns the writer lock; no client timer)
		expect(h.session.currentSessionId()).toBe("sess-idle")
		expect(h.session.status.sessionAttached).toBe(true)
		h.lastSocket().item(eventFrame("turn/end", { turn: 1, reason: { kind: "completed" } }, 1))
		await pending
		// and after the turn it stays attached too (no dispose-on-idle)
		expect(h.session.currentSessionId()).toBe("sess-idle")
		await h.session.dispose()
	})
})
