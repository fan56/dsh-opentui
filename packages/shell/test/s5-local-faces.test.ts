/**
 * S5 real-local-face tests — oldfox S4 review §六.2/§六.3/§六.4:
 *  - describe() is a FIELD-LEVEL WHITELIST projection (never key stripping);
 *  - configSave only accepts whitelisted keys;
 *  - agents face reads the REAL corpus (no mocks).
 * All fixtures are scratch-only; no credential VALUE is ever asserted/printed.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalAgentsFace, LocalConfigStore, LocalSettingsStore } from "../src/client/local-config-faces.ts"

function scratch() {
	const home = mkdtempSync(join(tmpdir(), "s5-faces-"))
	const profile = "opentui"
	mkdirSync(join(home, "profiles", profile), { recursive: true })
	const patch = join(home, "profiles", profile, "cordis.patch.yml")
	const config = join(home, "profiles", profile, "config.json")
	writeFileSync(config, JSON.stringify({ motion: "auto", autoResume: "off" }))
	return { home, profile, patch, config }
}

describe("S5 settings.describe — field-level whitelist projection", () => {
	test("hostile config never crosses: only enumerated fields land in the document", () => {
		const s = scratch()
		writeFileSync(s.patch, [
			"- id: subagent",
			"  config:",
			"    maxActiveSubagents: 3",
			"    maxDepth: 2",
			`    apiKey: SENTINEL_MUST_NOT_CROSS`,
			"- id: session-log-deepseek",
			"  config:",
			"    enabled: true",
			`    token: SENTINEL_MUST_NOT_CROSS`,
			"- id: agent-default-model",
			"  config:",
			`    authorizeUrl: https://x/?code_challenge=SENTINEL`,
			"",
		].join("\n"))
		const doc = new LocalSettingsStore(s.home, s.profile).describe()
		const payload = JSON.stringify(doc)
		for (const needle of ["SENTINEL", "apiKey", "token", "authorizeUrl", "code_challenge"]) {
			expect(payload).not.toContain(needle)
		}
		const sub = doc.namespaces.find((n) => n.ns === "subagent")!
		expect(sub.value).toEqual({ maxActiveSubagents: 3, maxDepth: 2 })
		// describe-only ns: ns + revision only, ZERO value fields.
		const other = doc.namespaces.find((n) => n.ns === "agent-default-model")!
		expect(other.revision).toBe(1)
		expect(other.value).toBeUndefined()
		rmSync(s.home, { recursive: true, force: true })
	})

	test("mutate refuses non-whitelisted namespace and path (no whole-doc replace)", () => {
		const s = scratch()
		const store = new LocalSettingsStore(s.home, s.profile)
		expect(store.mutate("credentials", [{ op: "set", path: ["apiKey"], value: "x" }]).ok).toBe(false)
		expect(store.mutate("subagent", [{ op: "set", path: ["apiKey"], value: "x" }]).ok).toBe(false)
		expect(store.mutate("subagent", [{ op: "set", path: ["maxDepth", "nested"], value: 1 }]).ok).toBe(false)
		rmSync(s.home, { recursive: true, force: true })
	})
})

describe("S5 configSave — whitelisted keys only", () => {
	test("a secret key in the patch is dropped; a real preference key persists", () => {
		const s = scratch()
		const store = new LocalConfigStore(s.home, s.profile, s.home)
		store.configSave({ motion: "full", apiKey: "SENTINEL" } as Record<string, unknown>)
		const onDisk = JSON.parse(readFileSync(s.config, "utf8"))
		expect(onDisk.motion).toBe("full")
		expect(onDisk).not.toHaveProperty("apiKey")
		rmSync(s.home, { recursive: true, force: true })
	})
})

describe("S5 agents face — REAL corpus, no mocks", () => {
	test("list/body read a real agent .md from the scratch corpus", () => {
		const s = scratch()
		const agentsDir = join(s.home, "agents")
		mkdirSync(agentsDir, { recursive: true })
		writeFileSync(join(agentsDir, "fixture.md"), [
			"---",
			"name: fixture",
			"model: provider/model-x",
			"thinking: high",
			"deep: 2",
			"---",
			"",
			"Fixture body line.",
			"",
		].join("\n"))
		const face = new LocalAgentsFace({
			home: s.home,
			workspaceDir: s.home,
			settings: new LocalSettingsStore(s.home, s.profile),
			modelCatalog: async () => ({ groups: [] }),
		})
		const rows = face.list()
		expect(rows.some((r) => r.name === "fixture" && r.model === "provider/model-x" && r.deep === 2)).toBe(true)
		expect(face.dir()).toBe(agentsDir)
		expect(face.body("fixture")).toContain("Fixture body line.")
		rmSync(s.home, { recursive: true, force: true })
	})
})
