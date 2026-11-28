/**
 * B1 S4/S5 — seam host-first settings route (design 05 §4.2). Synthetic fake
 * transport + scratch local patch only; no host environment assertions.
 *
 * E1 host present -> describe routes to the wire, source=host, values from the
 *    wire (NOT the local file number).
 * E2 host present -> mutate routes to the wire with verbatim params; local
 *    patch bytes unchanged.
 * E3 host absent -> degrade local-file + reason; mutate refuses (no local
 *    fake success, no wire call, patch bytes unchanged).
 * E4 caps come from the same document: host numbers when host, n/a (no numbers)
 *    when local-file even though the local patch has 3/1.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BridgeSessionSeam, type BridgeTransport } from "../src/client/bridge-session-seam.ts"

type Reply = { kind: "value"; value: unknown } | { kind: "error"; error: unknown }

function makeSeam(replies: Record<string, Reply>) {
	const requests: { method: string; params?: Record<string, unknown> }[] = []
	const transport: BridgeTransport = {
		async request(method, params) {
			requests.push({ method, params })
			const reply = replies[method]
			if (reply === undefined) return {}
			if (reply.kind === "error") throw reply.error
			return reply.value
		},
		onEvent() { return () => {} },
	}
	const home = mkdtempSync(join(tmpdir(), "b1-s4-"))
	const profile = "opentui"
	const profileDir = join(home, "profiles", profile)
	mkdirSync(profileDir, { recursive: true })
	const patch = join(profileDir, "cordis.patch.yml")
	// Local file says 3/1 — deliberately DIFFERENT from the host wire's 5/2.
	writeFileSync(patch, ["- id: subagent", "  config:", "    maxActiveSubagents: 3", "    maxDepth: 1"].join("\n"))
	const patchBytes = () => readFileSync(patch, "utf8")
	const seam = new BridgeSessionSeam({
		transport,
		ctx: { logger: { info() {}, warn() {}, error() {}, debug() {} } },
		dshHome: home,
		profile,
		workspaceDir: home,
	})
	return { seam, requests, patch, patchBytes, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

const HOST_DESCRIBE = {
	kind: "value" as const,
	value: {
		writable: true,
		hasDocument: true,
		namespaces: [
			{
				ns: "subagent",
				revision: 7,
				value: { maxActiveSubagents: 5, maxDepth: 2, apiKey: "HOST_SECRET_MUST_NOT_CROSS" },
				base: { maxActiveSubagents: 3 },
				secrets: [{ path: ["apiKey"], set: true, value: "HOST_SECRET_VALUE" }],
			},
			{ ns: "unlisted-ns", revision: 9, value: { token: "OTHER_NS_SECRET" } },
		],
	},
}

describe("B1 S4 — seam settings.describe/mutate host-first route", () => {
	test("E1 host present: describe goes over the wire, source=host, wire values win", async () => {
		const h = makeSeam({ "settings.describe": HOST_DESCRIBE })
		try {
			const doc = await h.seam.settings!.describe()
			expect(h.requests.filter((r) => r.method === "settings.describe")).toHaveLength(1)
			expect(doc.source).toBe("host")
			const sub = doc.namespaces.find((n) => n.ns === "subagent")!
			expect(sub.value).toEqual({ maxActiveSubagents: 5, maxDepth: 2 })
			// field-level whitelist: secret value never crosses; secret keeps {path,set}
			expect(JSON.stringify(doc)).not.toContain("HOST_SECRET")
			expect(sub.secrets).toEqual([{ path: ["apiKey"], set: true }])
			// non-whitelisted namespace keeps ns+revision only
			const other = doc.namespaces.find((n) => n.ns === "unlisted-ns")!
			expect(other.value).toBeUndefined()
			expect(other.revision).toBe(9)
		} finally { h.cleanup() }
	})

	test("E2 host present: mutate forwards ns/ops/revision verbatim, local file untouched", async () => {
		const h = makeSeam({
			"settings.describe": HOST_DESCRIBE,
			"settings.mutate": { kind: "value", value: {} },
		})
		try {
			await h.seam.settings!.describe() // make the host available
			const before = h.patchBytes()
			const result = await h.seam.settings!.mutate("subagent", [{ op: "set", path: ["maxActiveSubagents"], value: 5 }], 7)
			expect(result).toEqual({ ok: true })
			const call = h.requests.find((r) => r.method === "settings.mutate")!
			expect(call.params).toEqual({
				ns: "subagent",
				ops: [{ op: "set", path: ["maxActiveSubagents"], value: 5 }],
				expectedRevision: 7,
			})
			expect(h.patchBytes()).toBe(before)
		} finally { h.cleanup() }
	})

	test("E3 host absent: degrade to local-file + reason; mutate refuses, no fake success", async () => {
		const h = makeSeam({ "settings.describe": { kind: "error", error: new Error("host offline TEST_REASON") } })
		try {
			const before = h.patchBytes()
			const doc = await h.seam.settings!.describe()
			expect(doc.source).toBe("local-file")
			expect(doc.sourceDetail?.reason).toContain("TEST_REASON")
			const result = await h.seam.settings!.mutate("subagent", [{ op: "set", path: ["maxActiveSubagents"], value: 9 }])
			expect(result.ok).toBe(false)
			expect(result).not.toHaveProperty("conflict", true)
			expect(h.requests.some((r) => r.method === "settings.mutate")).toBe(false)
			expect(h.patchBytes()).toBe(before)
		} finally { h.cleanup() }
	})

	test("E3b a host conflict error code is preserved as conflict=true", async () => {
		const h = makeSeam({
			"settings.describe": HOST_DESCRIBE,
			"settings.mutate": { kind: "error", error: Object.assign(new Error("stale"), { code: "SETTINGS_CONFLICT" }) },
		})
		try {
			await h.seam.settings!.describe()
			const result = await h.seam.settings!.mutate("subagent", [{ op: "set", path: ["maxDepth"], value: 2 }], 1)
			expect(result.ok).toBe(false)
			if (!result.ok) expect(result.conflict).toBe(true)
		} finally { h.cleanup() }
	})

	test("E4 caps are host-authoritative: host numbers, or n/a with no local fallback", async () => {
		const host = makeSeam({ "settings.describe": HOST_DESCRIBE })
		try {
			const caps = await host.seam.agents!.officialCaps!()
			expect(caps.source).toBe("host")
			expect(caps.maxActiveSubagents).toBe(5)
			expect(caps.maxDepth).toBe(2)
		} finally { host.cleanup() }

		const degraded = makeSeam({ "settings.describe": { kind: "error", error: new Error("offline") } })
		try {
			const caps = await degraded.seam.agents!.officialCaps!()
			expect(caps.source).toBe("unavailable")
			// local patch has 3/1 — neither may appear as a cap value
			expect(caps.maxActiveSubagents).toBeUndefined()
			expect(caps.maxDepth).toBeUndefined()
			expect(caps.reason).toBeTruthy()
		} finally { degraded.cleanup() }
	})

	test("Issue #29: fresh seam mutate probes settings.describe once before mutating (no local-file latch)", async () => {
		const h = makeSeam({
			"settings.describe": HOST_DESCRIBE,
			"settings.mutate": { kind: "value", value: {} },
		})
		try {
			// No prior seam.settings.describe() call.
			const result = await h.seam.settings!.mutate("llm-pi-ai", [{ op: "set", path: ["providers", "openai"], value: { apiKeyEnv: "OPENAI_API_KEY" } }])
			expect(result).toEqual({ ok: true })
			expect(h.requests.map((r) => r.method)).toEqual(["settings.describe", "settings.mutate"])
		} finally { h.cleanup() }
	})

	test("Issue #29: fresh seam mutate refuses when probe fails (remains local-file)", async () => {
		const h = makeSeam({
			"settings.describe": { kind: "error", error: new Error("host down") },
		})
		try {
			const result = await h.seam.settings!.mutate("subagent", [{ op: "set", path: ["maxActiveSubagents"], value: 9 }])
			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.conflict).toBe(false)
				expect(result.error).toContain("host down")
			}
			expect(h.requests.map((r) => r.method)).toEqual(["settings.describe"])
		} finally { h.cleanup() }
	})

	test("Issue #29: seam.login routes credentials.* to host and reads routes from host settings", async () => {
		const h = makeSeam({
			"credentials.describe": {
				kind: "value",
				value: { DEEPSEEK_API_KEY: { configured: true, source: "file", writable: true } },
			},
			"credentials.set": { kind: "value", value: { ok: true } },
			"credentials.unset": { kind: "value", value: { ok: true } },
			"settings.describe": {
				kind: "value",
				value: {
					writable: true,
					hasDocument: true,
					namespaces: [
						{
							ns: "llm-pi-ai",
							revision: 3,
							value: { providers: { openai: { apiKeyEnv: "OPENAI_API_KEY" } } },
						},
						{
							ns: "llm-deepseek",
							revision: 2,
							value: { apiKeyEnv: "DEEPSEEK_API_KEY" },
						},
					],
				},
			},
		})
		try {
			expect(await h.seam.login.credentialStatus("DEEPSEEK_API_KEY")).toEqual({ configured: true })
			await h.seam.login.login("DEEPSEEK_API_KEY", "sk-synthetic-value")
			await h.seam.login.logout("DEEPSEEK_API_KEY")
			const routes = await h.seam.login.routes()
			expect(routes).toEqual([
				{ id: "openai", apiKeyEnv: "OPENAI_API_KEY", declared: false },
				{ id: "deepseek-official", apiKeyEnv: "DEEPSEEK_API_KEY", displayName: "DeepSeek", declared: true },
			])
			expect(h.requests.map((r) => r.method)).toEqual([
				"credentials.describe",
				"credentials.set",
				"credentials.unset",
				"settings.describe",
			])
			expect(h.requests[1]!.params).toEqual({ ref: "DEEPSEEK_API_KEY", value: "sk-synthetic-value" })
			expect(h.requests[2]!.params).toEqual({ ref: "DEEPSEEK_API_KEY" })
		} finally { h.cleanup() }
	})
})
