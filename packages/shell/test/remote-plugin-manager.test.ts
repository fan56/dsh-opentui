// C1 contract tests: the /plugins manager's management face over
// RemoteHostSession — the wire method names + named-args shapes the host's
// pluginManager face expects (the SAME face the web profile's plugin page
// drives: pluginManager/setBundleEnabled|removeBundle|inspect|installBundle),
// the ChangeResult/inspection normalization, and the post-mutation cache
// refresh the panel's reactive read depends on.
import { describe, expect, test } from "bun:test"
import { RemoteHostSession } from "../src/client/remote-host-session.ts"
import type { ClientConnection } from "../src/client/transport.ts"
import type { RpcHandler } from "./client-fakes.ts"

// The FakeConnection lives in remote-host-session.test.ts (not exported);
// a local stand-in keeps this file independent of that harness's lifetime.
class FakeConnection {
	rpcCalls: { method: string; args: Record<string, unknown> }[] = []
	rpcHandler: RpcHandler = () => ({})

	async connect(): Promise<{ clientId: string; host: { home: string } }> {
		return { clientId: "client-1", host: { home: "/tmp/dsh-home" } }
	}

	async rpc<T = unknown>(method: string, args?: Record<string, unknown>): Promise<T> {
		this.rpcCalls.push({ method, args: args ?? {} })
		return (await this.rpcHandler(method, args ?? {})) as T
	}

	onEvent(): () => void {
		return () => {}
	}

	onStateChange(): () => void {
		return () => {}
	}

	getState(): string {
		return "connected"
	}

	async close(): Promise<void> {}
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

	test("installBundle sends the spec with enabled: true (the panel installs active)", async () => {
		const log: { methods: string[] } = { methods: [] }
		const session = makeSession(pluginRpcHandler(log))
		const change = await session.installBundle("dsh-tui-pi")
		expect(change.application).toBe("applied")
		expect(log.methods).toContain('pluginManager/installBundle {"spec":"dsh-tui-pi","enabled":true}')
	})
})
