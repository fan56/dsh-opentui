/**
 * 025 W2-4b — hand-written directory projections (SECOND whitelist). Pure
 * tests: no live host, no credential value (SENTINEL is a fixed fake string).
 * Proves hostile keys / URL / env VALUES never cross into the seam shape.
 */
import { describe, expect, test } from "bun:test"
import {
	projectConfigurableProviders,
	projectLlmProviders,
	projectPermissionCatalog,
	unwrapWireValue,
} from "../src/client/bridge-directory.ts"

const SENTINEL = "W2_4_SENTINEL_synthetic_no_real_credential"

describe("unwrapWireValue — accept both generic-wrap and plain-object shapes", () => {
	test("array wrapped as {value:[...]} unwraps to the array", () => {
		expect(unwrapWireValue({ value: [1, 2] })).toEqual([1, 2])
	})
	test("plain object has no value key -> returned as-is", () => {
		const obj = { options: [], defaultPreset: "auto" }
		expect(unwrapWireValue(obj)).toBe(obj)
	})
})

describe("projectLlmProviders — {id,name} only", () => {
	test("whitelists id/name, drops every hostile key", () => {
		const raw = { value: [
			{ id: "deepseek", name: "DeepSeek", apiKey: SENTINEL, token: SENTINEL, secret: SENTINEL, url: "https://evil" },
			{ id: "", name: "no-id" },
			{ id: "no-name" },
			{ id: "x".repeat(500), name: "long" },
		] }
		const out = projectLlmProviders(raw)
		expect(out).toHaveLength(2)
		expect(out[0]).toEqual({ id: "deepseek", name: "DeepSeek" })
		expect(out[1]!.id.length).toBeLessThanOrEqual(240)
		const text = JSON.stringify(out)
		expect(text).not.toContain(SENTINEL)
		expect(text).not.toContain("evil")
		expect(text).not.toMatch(/"apiKey"|"token"|"secret"/i)
	})
	test("non-array -> [] (never a fake directory)", () => {
		expect(projectLlmProviders({ nope: true })).toEqual([])
		expect(projectLlmProviders(undefined)).toEqual([])
	})
})

describe("projectConfigurableProviders — env NAME only, no URL/value", () => {
	test("keeps provider/displayName/settingsNs/declared + env names, drops URL and secrets", () => {
		const raw = { value: [
			{
				provider: "openai", displayName: "OpenAI", settingsNs: "llm",
				settingsPath: ["providers", "openai"], declared: false,
				baseURL: "https://secret-endpoint/token", defaultBaseURL: "https://api.openai.com",
				baseURLEnv: ["OPENAI_BASE_URL", "OPENAI_ORG"],
				nativeAuth: { env: ["OPENAI_API_KEY"], oauth: true },
				error: "needs key", apiKey: SENTINEL, token: SENTINEL,
			},
		] }
		const out = projectConfigurableProviders(raw)
		expect(out).toHaveLength(1)
		const row = out[0]!
		expect(row.provider).toBe("openai")
		expect(row.displayName).toBe("OpenAI")
		expect(row.settingsNs).toBe("llm")
		expect(row.declared).toBe(false)
		expect(row.error).toBe("needs key")
		expect(row.authEnvNames).toContain("OPENAI_API_KEY")
		expect(row.authEnvNames).toContain("OPENAI_BASE_URL")
		const text = JSON.stringify(out)
		expect(text).not.toContain(SENTINEL)
		expect(text).not.toContain("https://secret-endpoint")
		expect(text).not.toContain("api.openai.com")
		expect(text).not.toMatch(/"baseURL"|"defaultBaseURL"|"apiKey"|"token"/i)
	})
})

describe("projectPermissionCatalog — real options or undefined (honest)", () => {
	test("projects options/defaultOptions/defaultPreset with capped text", () => {
		const raw = {
			options: [
				{ value: "auto", name: "Auto", description: "follow session" },
				{ value: "custom", name: "Custom", description: "x".repeat(5000) },
				{ value: "", name: "no-value" },
			],
			defaultOptions: [{ value: "auto", name: "Auto" }],
			defaultPreset: "auto",
			apiKey: SENTINEL, token: SENTINEL,
		}
		const out = projectPermissionCatalog(raw)!
		expect(out).toBeDefined()
		expect(out.options).toHaveLength(2)
		expect(out.options[0]).toEqual({ value: "auto", name: "Auto", description: "follow session" })
		expect(out.options[1]!.description!.length).toBeLessThanOrEqual(4096)
		expect(out.defaultPreset).toBe("auto")
		const text = JSON.stringify(out)
		expect(text).not.toContain(SENTINEL)
		expect(text).not.toMatch(/"apiKey"|"token"/i)
	})
	test("empty / malformed -> undefined (never a fake catalog)", () => {
		expect(projectPermissionCatalog({ options: [], defaultOptions: [], defaultPreset: "" })).toBeUndefined()
		expect(projectPermissionCatalog({})).toBeUndefined()
		expect(projectPermissionCatalog(undefined)).toBeUndefined()
	})
})
