/**
 * S5 real-local-face tests — oldfox S4 review §六.2/§六.3/§六.4:
 *  - describe() is a FIELD-LEVEL WHITELIST projection (never key stripping);
 *  - configSave only accepts whitelisted keys;
 *  - agents face reads the REAL corpus (no mocks).
 * All fixtures are scratch-only; no credential VALUE is ever asserted/printed.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalAgentsFace, LocalConfigStore, LocalLoginFace, LocalPresetFace, LocalSettingsStore } from "../src/client/local-config-faces.ts"
import { buildCustomEntry, providerProfileFor } from "../../tui-base/src/routes/session/login.ts"

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

describe("025-w1a LocalPresetFace — REAL patch-declared presets, field whitelist", () => {
	const PATCH = [
		"- id: llm-pi-ai",
		"  config:",
		"    providers: {}",
		"- insert:",
		"    - id: preset-standard",
		"      name: '@deepseek-ai/dsh-agent-preset'",
		"      config:",
		"        id: standard",
		"        name: Standard",
		"        description: The shipped standard preset",
		"        order: 1",
		"        plugins:",
		"          - id: persona",
		`            config: { prompt: SENTINEL_MUST_NOT_CROSS }`,
		"- insert:",
		"    - id: preset-reviewer",
		"      name: '@deepseek-ai/dsh-agent-preset'",
		"      config:",
		"        id: reviewer",
		"        name: Reviewer",
		"        order: 2",
		"        plugins: []",
		"",
	].join("\n")

	test("list() parses declared preset blocks; plugin config bodies never cross", () => {
		const s = scratch()
		writeFileSync(s.patch, PATCH)
		const face = new LocalPresetFace(s.home, s.profile)
		const rows = face.list()
		expect(rows).toEqual([
			{ id: "standard", name: "Standard", description: "The shipped standard preset" },
			{ id: "reviewer", name: "Reviewer" },
		])
		// FIELD whitelist: the plugin `config.prompt` SENTINEL is never projected.
		expect(JSON.stringify(rows)).not.toContain("SENTINEL")
		rmSync(s.home, { recursive: true, force: true })
	})

	test("list() folds a wrapped description scalar", () => {
		const s = scratch()
		writeFileSync(s.patch, [
			"- insert:",
			"    - id: preset-x",
			"      name: '@deepseek-ai/dsh-agent-preset'",
			"      config:",
			"        id: x",
			"        name: Ex",
			"        description: first line",
			"          second line",
			"        plugins: []",
			"",
		].join("\n"))
		expect(new LocalPresetFace(s.home, s.profile).list()[0].description).toBe("first line second line")
		rmSync(s.home, { recursive: true, force: true })
	})

	test("list() degrades honestly to [] when the patch is absent", () => {
		const s = scratch()
		expect(new LocalPresetFace(s.home, s.profile).list()).toEqual([])
		rmSync(s.home, { recursive: true, force: true })
	})

	test("currentId()/select() round-trip the staged preset id in config.json", () => {
		const s = scratch()
		const face = new LocalPresetFace(s.home, s.profile)
		expect(face.currentId()).toBeUndefined()
		expect(face.select("reviewer")).toBe(true)
		expect(face.currentId()).toBe("reviewer")
		expect(JSON.parse(readFileSync(s.config, "utf8")).agentPreset).toBe("reviewer")
		rmSync(s.home, { recursive: true, force: true })
	})
})

describe("025-w1a LocalLoginFace — provider routes + boolean credentials, value never crosses", () => {
	const PATCH = [
		"- id: llm-pi-ai",
		"  name: '@deepseek-ai/dsh-llm-pi-ai'",
		"  config:",
		"    providers:",
		"      zai-coding-cn:",
		"        apiKeyEnv: ZAI_CODING_CN_API_KEY",
		"        models:",
		"          - id: glm-5",
		"      my-custom:",
		"        api: openai-completions",
		"        baseURL: https://example.test/v1",
		"        displayName: My Custom",
		"- id: permission",
		"  config:",
		"    defaultPreset: workspace-write",
		"",
	].join("\n")

	test("routes() projects provider keys + apiKeyEnv KEY NAME + declared flag (no secret value)", () => {
		const s = scratch()
		writeFileSync(s.patch, PATCH)
		const rows = new LocalLoginFace(s.home, s.profile).routes()
		expect(rows).toEqual([
			{ id: "zai-coding-cn", apiKeyEnv: "ZAI_CODING_CN_API_KEY", declared: true },
			{ id: "my-custom", displayName: "My Custom", declared: true },
		])
		rmSync(s.home, { recursive: true, force: true })
	})

	test("credentialStatus() is boolean-only (env presence OR local store key)", () => {
		const s = scratch()
		writeFileSync(s.patch, PATCH)
		const face = new LocalLoginFace(s.home, s.profile)
		const ref = "TEST_W1A_API_KEY"
		delete process.env[ref]
		expect(face.credentialStatus(ref)).toEqual({ configured: false })
		process.env[ref] = "SENTINEL_SECRET_VALUE"
		expect(face.credentialStatus(ref)).toEqual({ configured: true })
		delete process.env[ref]
		rmSync(s.home, { recursive: true, force: true })
	})

	test("login/logout persist to an owner-only local store (0600); value never in return", () => {
		const s = scratch()
		const face = new LocalLoginFace(s.home, s.profile)
		const ref = "LOCAL_W1A_API_KEY"
		const ret = face.login(ref, "SENTINEL_SECRET_VALUE")
		expect(ret).toBeUndefined() // value never echoed/returned
		const storePath = join(s.home, "profiles", s.profile, "provider-keys.json")
		expect(JSON.parse(readFileSync(storePath, "utf8"))[ref]).toBe("SENTINEL_SECRET_VALUE")
		if (process.platform !== "win32") expect(statSync(storePath).mode & 0o777).toBe(0o600)
		expect(face.credentialStatus(ref)).toEqual({ configured: true })
		face.logout(ref)
		expect(face.credentialStatus(ref)).toEqual({ configured: false })
		rmSync(s.home, { recursive: true, force: true })
	})

	test("registerRoute writes/clears a provider in the patch providers dict", () => {
		const s = scratch()
		writeFileSync(s.patch, PATCH)
		const face = new LocalLoginFace(s.home, s.profile)
		expect(face.registerRoute("new-provider", { apiKeyEnv: "NEW_PROVIDER_API_KEY" })).toBe(true)
		expect(face.routes().some((r) => r.id === "new-provider" && r.apiKeyEnv === "NEW_PROVIDER_API_KEY")).toBe(true)
		expect(face.registerRoute("new-provider", undefined)).toBe(true)
		expect(face.routes().some((r) => r.id === "new-provider")).toBe(false)
		// Original routes untouched.
		expect(face.routes().some((r) => r.id === "zai-coding-cn")).toBe(true)
		rmSync(s.home, { recursive: true, force: true })
	})

	test("routes() degrades honestly to [] when the patch is absent", () => {
		const s = scratch()
		expect(new LocalLoginFace(s.home, s.profile).routes()).toEqual([])
		rmSync(s.home, { recursive: true, force: true })
	})
})

describe("025-w1b C1/C2/C3 — registerRoute persists the full custom route, value never crosses", () => {
	const PATCH_EMPTY = [
		"- id: llm-pi-ai",
		"  name: '@deepseek-ai/dsh-llm-pi-ai'",
		"  config:",
		"    providers:",
		"      zai-coding-cn:",
		"        apiKeyEnv: ZAI_CODING_CN_API_KEY",
		"- id: permission",
		"  config:",
		"    defaultPreset: workspace-write",
		"",
	].join("\n")

	test("C1 round-trip: providerProfileFor -> registerRoute -> patch/routes keeps api/baseURL/models/displayName", () => {
		const s = scratch()
		writeFileSync(s.patch, PATCH_EMPTY)
		// The six-step form's committed entry, exactly as /login builds it.
		const entry = buildCustomEntry({
			routeId: "my-llm",
			displayName: "My LLM",
			protocol: "openai-completions",
			baseURL: "https://llm.example.test/v1",
			models: "glm-5, deepseek-chat",
		})
		const profile = providerProfileFor(entry) // {apiKeyEnv,api,baseURL,models,displayName}
		const face = new LocalLoginFace(s.home, s.profile)
		expect(face.registerRoute(entry.id, profile)).toBe(true)

		const text = readFileSync(s.patch, "utf8")
		for (const field of [
			"my-llm:",
			"apiKeyEnv: MY_LLM_API_KEY",
			"api: openai-completions",
			'baseURL: "https://llm.example.test/v1"',
			'displayName: "My LLM"',
			'- id: "glm-5"',
			'- id: "deepseek-chat"',
		]) expect(text).toContain(field)

		const rows = face.routes()
		const row = rows.find((r) => r.id === "my-llm")!
		expect(row.apiKeyEnv).toBe("MY_LLM_API_KEY")
		expect(row.displayName).toBe("My LLM")
		expect(row.declared).toBe(true) // api/baseURL/models mark the live declaration
		expect(rows.some((r) => r.id === "zai-coding-cn")).toBe(true) // original route untouched
		rmSync(s.home, { recursive: true, force: true })
	})

	test("C1 negative: unknown profile keys + YAML injection values never land in the patch", () => {
		const s = scratch()
		writeFileSync(s.patch, PATCH_EMPTY)
		const face = new LocalLoginFace(s.home, s.profile)
		const evil = {
			apiKeyEnv: "EVIL_KEY",
			baseURL: "https://ok.test/v1\n  injected: pwned", // newline YAML injection
			displayName: 'bad"name\r\n  injected: pwned',
			evilKey: "SENTINEL_MUST_NOT_CROSS", // unknown key
			models: [{ id: "ok-model\n  injected: pwned" }],
		}
		expect(face.registerRoute("evil-route", evil)).toBe(false)
		const text = readFileSync(s.patch, "utf8")
		for (const marker of ["SENTINEL", "injected: pwned", "evilKey", "evil-route:"]) {
			expect(text).not.toContain(marker)
		}
		expect(face.routes().some((r) => r.id === "evil-route")).toBe(false)
		rmSync(s.home, { recursive: true, force: true })
	})

	test("C2 negative: providerId charset gate rejects YAML-special ids (apiKeyEnv had safeRef)", () => {
		const s = scratch()
		writeFileSync(s.patch, PATCH_EMPTY)
		const face = new LocalLoginFace(s.home, s.profile)
		const before = readFileSync(s.patch, "utf8")
		// Leading/embedded '-' is valid (validateRouteId allows it); YAML-special
		// chars (space, colon, newline, hash, quotes) are not.
		for (const badId of ["bad id", "bad:id", "bad\nid", "bad#id", 'bad"id']) {
			expect(face.registerRoute(badId, { apiKeyEnv: "OK_KEY" })).toBe(false)
		}
		expect(readFileSync(s.patch, "utf8")).toBe(before) // file byte-identical after all rejects
		rmSync(s.home, { recursive: true, force: true })
	})

	test("C3: an owner-only keys file is 0600 from first creation (no 0644 window)", () => {
		const s = scratch()
		const face = new LocalLoginFace(s.home, s.profile)
		face.login("C3_TEST_API_KEY", "SENTINEL_SECRET_VALUE")
		const storePath = join(s.home, "profiles", s.profile, "provider-keys.json")
		if (process.platform !== "win32") expect(statSync(storePath).mode & 0o777).toBe(0o600)
		rmSync(s.home, { recursive: true, force: true })
	})
})
