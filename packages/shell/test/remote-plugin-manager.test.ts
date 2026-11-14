// C1 contract tests: the /plugins manager's management face over
// RemoteHostSession — the wire method names + named-args shapes the host's
// pluginManager face expects (the SAME face the web profile's plugin page
// drives: pluginManager/setBundleEnabled|removeBundle|inspect|installBundle),
// the ChangeResult/inspection normalization, and the post-mutation cache
// refresh the panel's reactive read depends on.
import { describe, expect, test } from "bun:test"
import { RemoteHostSession } from "../src/client/remote-host-session.ts"
import type { ClientConnection } from "../src/client/transport.ts"
import type { EventsItem } from "../src/client/mux-frame.ts"
import type { RpcHandler } from "./client-fakes.ts"

// The FakeConnection lives in remote-host-session.test.ts (not exported);
// a local stand-in keeps this file independent of that harness's lifetime.
class FakeConnection {
	rpcCalls: { method: string; args: Record<string, unknown> }[] = []
	rpcHandler: RpcHandler = () => ({})
	#eventHandlers = new Set<(item: EventsItem) => void>()

	async connect(): Promise<{ clientId: string; host: { home: string } }> {
		return { clientId: "client-1", host: { home: "/tmp/dsh-home" } }
	}

	async rpc<T = unknown>(method: string, args?: Record<string, unknown>): Promise<T> {
		this.rpcCalls.push({ method, args: args ?? {} })
		return (await this.rpcHandler(method, args ?? {})) as T
	}

	onEvent(handler: (item: EventsItem) => void): () => void {
		this.#eventHandlers.add(handler)
		return () => this.#eventHandlers.delete(handler)
	}

	onStateChange(): () => void {
		return () => {}
	}

	getState(): string {
		return "connected"
	}

	async close(): Promise<void> {}

	/** Deliver a forwarded host push (the `$events` emit frame shape). */
	emit(item: EventsItem): void {
		for (const handler of [...this.#eventHandlers]) handler(item)
	}
}

function makeSession(rpcHandler: RpcHandler): RemoteHostSession {
	const connection = new FakeConnection()
	connection.rpcHandler = rpcHandler
	return new RemoteHostSession({
		connection: connection as unknown as ClientConnection,
		cookieHeader: "dsh-auth-x=v1.test",
		cwd: "/tmp/workspace",
	})
}

const BUNDLES = [
	{
		name: "dsh-tui-pi",
		version: "2.7.0",
		description: "the terminal suite",
		enabled: true,
		installed: true,
		optional: false,
		removable: true,
	},
	{
		name: "dsh-skills-office",
		version: "0.9.1",
		enabled: false,
		installed: false,
		optional: true,
		removable: false,
		readOnlyReason: "management-required",
	},
]

function pluginRpcHandler(log?: { methods: string[] }): RpcHandler {
	return (method, args) => {
		log?.methods.push(`${method} ${JSON.stringify(args)}`)
		if (method === "pluginManager/listPlugins") return [{ moduleName: "dsh-tui-pi", meta: { title: "dsh-tui-pi" } }]
		if (method === "pluginManager/listBundles") return structuredClone(BUNDLES)
		if (method === "pluginManager/setBundleEnabled") {
			return { changed: true, application: "restart-required", stage: "enable", target: String(args.name) }
		}
		if (method === "pluginManager/removeBundle") {
			return { changed: true, application: "applied", stage: "remove", target: String(args.name) }
		}
		if (method === "pluginManager/inspect") {
			if (String(args.spec).includes("bad")) return { status: "refused", problem: "not-found", reason: "no such package" }
			return { status: "accepted", kind: "registry", name: "dsh-tui-pi", version: "2.7.0", description: "suite", bundle: true }
		}
		if (method === "pluginManager/installBundle") {
			return { changed: true, application: "applied", stage: "install", target: String(args.spec) }
		}
		return {}
	}
}

describe("RemoteHostSession pluginManager face (C1)", () => {
	test("refreshPlugins caches the full bundle rows (enablement + read-only)", async () => {
		const session = makeSession(pluginRpcHandler())
		await session.refreshPlugins()
		const bundles = session.listBundles()
		expect(bundles.map((b) => b.name)).toEqual(["dsh-tui-pi", "dsh-skills-office"])
		expect(bundles[0]).toMatchObject({ enabled: true, installed: true, removable: true, version: "2.7.0" })
		expect(bundles[1]).toMatchObject({ enabled: false, installed: false, optional: true, readOnlyReason: "management-required" })
	})

	test("setBundleEnabled sends the host face method with named args and refreshes the caches", async () => {
		const log: { methods: string[] } = { methods: [] }
		const session = makeSession(pluginRpcHandler(log))
		await session.refreshPlugins()
		log.methods.length = 0

		const change = await session.setBundleEnabled("dsh-tui-pi", false)
		expect(change).toEqual({ changed: true, application: "restart-required", target: "dsh-tui-pi" })
		// The wire call: the host's typert face (named parameters, not positional).
		expect(log.methods).toContain('pluginManager/setBundleEnabled {"name":"dsh-tui-pi","enabled":false}')
		// The post-mutation refresh: both caches re-fetch (the panel re-reads).
		expect(log.methods.some((entry) => entry.startsWith("pluginManager/listPlugins"))).toBe(true)
		expect(log.methods.some((entry) => entry.startsWith("pluginManager/listBundles"))).toBe(true)
	})

	test("removeBundle sends { name } and a thrown call folds to a failed change", async () => {
		const session = makeSession((method, args) => {
			if (method === "pluginManager/removeBundle") {
				if (args.name === "protected") throw new Error("management-required")
				return { changed: true, application: "applied", target: args.name }
			}
			return {}
		})
		const ok = await session.removeBundle("dsh-tui-pi")
		expect(ok.application).toBe("applied")
		const failed = await session.removeBundle("protected")
		expect(failed.application).toBe("failed")
		expect(failed.error).toBe("management-required")
	})

	test("inspectBundle normalizes the accepted preview and the structured refusal", async () => {
		const session = makeSession(pluginRpcHandler())
		const accepted = await session.inspectBundle("dsh-tui-pi")
		expect(accepted).toEqual({ status: "accepted", name: "dsh-tui-pi", version: "2.7.0", description: "suite", bundle: true })
		const refused = await session.inspectBundle("some-bad-spec")
		expect(refused).toEqual({ status: "refused", problem: "not-found", reason: "no such package" })
	})

	test("installBundle sends the typert named-args shape { spec, options.enabled } (the panel installs active)", async () => {
		const log: { methods: string[] } = { methods: [] }
		const session = makeSession(pluginRpcHandler(log))
		const change = await session.installBundle("dsh-tui-pi")
		expect(change.application).toBe("applied")
		// The host typert declares `spec` + `options` ({ enabled?, requestId?,
		// approvedBuilds?, registry? }) — a top-level `enabled` is an undeclared
		// wire key the gateway drops, so the options object is the contract.
		expect(log.methods).toContain('pluginManager/installBundle {"spec":"dsh-tui-pi","options":{"enabled":true}}')
	})

	test("a toggle-only refresh notifies onPluginsChanged (content-level compare, P1-2)", async () => {
		// A toggle keeps the row count; the old length-only heuristic never
		// bumped the adapter's revision, so the panel's STATE column stayed stale
		// until the panel was reopened. Enablement moving MUST notify.
		const bundles = structuredClone(BUNDLES)
		const session = makeSession((method, args) => {
			if (method === "pluginManager/listPlugins") return [{ moduleName: "dsh-tui-pi", meta: { title: "dsh-tui-pi" } }]
			if (method === "pluginManager/listBundles") return structuredClone(bundles)
			if (method === "pluginManager/setBundleEnabled") {
				bundles[0].enabled = Boolean(args.enabled)
				return { changed: true, application: "restart-required", target: String(args.name) }
			}
			return {}
		})
		await session.refreshPlugins()
		let notified = 0
		session.onPluginsChanged(() => {
			notified += 1
		})
		// The mutation's post-refresh is fire-and-forget (`void refreshPlugins`);
		// a macrotask lets it settle before asserting the notify count.
		const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

		// First toggle: rows same length, enabled flips true→false — notify.
		await session.setBundleEnabled("dsh-tui-pi", false)
		await flush()
		expect(notified).toBe(1)
		expect(session.listBundles()[0].enabled).toBe(false)

		// A refresh with NO content change stays quiet (no spurious repaints).
		await session.refreshPlugins()
		expect(notified).toBe(1)

		// Toggling back notifies again.
		await session.setBundleEnabled("dsh-tui-pi", true)
		await flush()
		expect(notified).toBe(2)
	})

	test("the plugin-manager/changed push refreshes the caches and cannot escape as a rejection (C1 survival pin)", async () => {
		// The gate's real-machine repro of a client exit around a toggle was
		// not reproducible (4 independent boots, 10+ toggles, incl. a host
		// kill + same-port respawn — the client followed the fresh host).
		// This pins the only JS-side silent-death vector on the push path:
		// an unhandled rejection escaping `refreshPlugins` while the host is
		// mid-hot-apply and refuses the refresh RPCs.
		let refreshCalls = 0
		const connection = new FakeConnection()
		connection.rpcHandler = (method) => {
			if (method === "pluginManager/listPlugins" || method === "pluginManager/listBundles") {
				refreshCalls += 1
				throw new Error("host is reloading the plugin tree")
			}
			return {}
		}
		const session = new RemoteHostSession({
			connection: connection as unknown as ClientConnection,
			cookieHeader: "dsh-auth-x=v1.test",
			cwd: "/tmp/workspace",
		})
		await session.start()
		const notified: number[] = []
		session.onPluginsChanged(() => notified.push(refreshCalls))
		// start() already ran one boot warm (2 RPCs against the throwing handler).
		const before = refreshCalls

		connection.emit({ type: "emit", event: "plugin-manager/changed", args: [] })
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(refreshCalls - before).toBe(2) // listPlugins + listBundles both attempted
		expect(notified).toEqual([before + 2]) // listeners still notified after the failure
		// The caches kept their previous (empty) contents — no crash, no exit.
		expect(session.listBundles()).toEqual([])
		expect(session.listPlugins()).toEqual([])
	})
})
