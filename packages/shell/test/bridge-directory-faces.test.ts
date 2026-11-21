/**
 * 025 W2-4b — bridge seam directory faces integration (E1/E3/E5, R4 honest
 * degradation). Drives BridgeSessionSeam with a fake transport: real wire data
 * -> hand-projected rows; service absence -> UNSUPPORTED (providerDirectory) /
 * undefined (settings.permissionCatalog); hostile reply -> no key/value leak.
 */
import { describe, expect, test } from "bun:test"
import {
	BridgeProtocolError,
	BridgeSessionSeam,
	type BridgeEventFrame,
	type BridgeTransport,
} from "../src/client/bridge-session-seam.ts"

const SENTINEL = "W2_4_SENTINEL_synthetic_no_real_credential"

function harness(replies: Record<string, unknown> = {}) {
	const requests: { method: string; params?: Record<string, unknown> }[] = []
	const transport: BridgeTransport = {
		async request(method, params) {
			requests.push({ method, params })
			if (Object.prototype.hasOwnProperty.call(replies, method)) return replies[method]!
			throw new BridgeProtocolError("UNSUPPORTED", `${method} unavailable`, { capability: method })
		},
		onEvent(_listener: (frame: BridgeEventFrame) => void) {
			return () => {}
		},
	}
	const seam = new BridgeSessionSeam({ transport, ctx: { logger: { info() {}, warn() {}, error() {} } } })
	return { seam, requests }
}

describe("W2-4b providerDirectory face — real data / honest degrade", () => {
	test("registered + configurable wire names -> hand-projected rows", async () => {
		const { seam, requests } = harness({
			"llm.listProviders": { value: [
				{ id: "deepseek", name: "DeepSeek", apiKey: SENTINEL },
			] },
			"llm.listConfigurableProviders": { value: [
				{ provider: "openai", displayName: "OpenAI", settingsNs: "llm", baseURL: "https://secret", nativeAuth: { env: ["OPENAI_API_KEY"], oauth: false } },
			] },
		})
		const registered = await seam.providerDirectory!.registered()
		const configurable = await seam.providerDirectory!.configurable()
		expect(registered).toEqual([{ id: "deepseek", name: "DeepSeek" }])
		expect(configurable[0]!.provider).toBe("openai")
		expect(configurable[0]!.authEnvNames).toContain("OPENAI_API_KEY")
		expect(requests.map((r) => r.method)).toEqual(["llm.listProviders", "llm.listConfigurableProviders"])
		const text = JSON.stringify([registered, configurable])
		expect(text).not.toContain(SENTINEL)
		expect(text).not.toContain("https://secret")
	})

	test("E3 — service absent -> UNSUPPORTED rejection (never fake-empty)", async () => {
		const { seam } = harness({})
		let rejected = false
		try { await seam.providerDirectory!.registered() } catch (err) {
			rejected = err instanceof BridgeProtocolError && err.code === "UNSUPPORTED"
		}
		expect(rejected).toBe(true)
	})
})

describe("W2-4b settings.permissionCatalog face — real catalog / honest fallback", () => {
	test("real permissionPresets.catalog -> projected catalog", async () => {
		const { seam, requests } = harness({
			"permissionPresets.catalog": {
				options: [{ value: "auto", name: "Auto" }, { value: "strict", name: "Strict" }],
				defaultOptions: [{ value: "auto", name: "Auto" }],
				defaultPreset: "auto",
			},
		})
		const catalog = await seam.settings!.permissionCatalog!()
		expect(catalog).toBeDefined()
		expect(catalog!.options.map((o) => o.value)).toEqual(["auto", "strict"])
		expect(catalog!.defaultPreset).toBe("auto")
		expect(requests.map((r) => r.method)).toContain("permissionPresets.catalog")
	})

	test("E3 — service absent -> undefined (settings falls back to schema enum, no fake catalog)", async () => {
		const { seam } = harness({})
		expect(await seam.settings!.permissionCatalog!()).toBeUndefined()
	})

	test("E5 — hostile catalog reply: SENTINEL/secret keys never cross", async () => {
		const { seam } = harness({
			"permissionPresets.catalog": {
				options: [{ value: "auto", name: "Auto", apiKey: SENTINEL, token: SENTINEL }],
				defaultOptions: [],
				defaultPreset: "auto",
				secret: SENTINEL,
			},
		})
		const catalog = await seam.settings!.permissionCatalog!()
		const text = JSON.stringify(catalog)
		expect(text).not.toContain(SENTINEL)
		expect(text).not.toMatch(/"apiKey"|"token"|"secret"/i)
	})
})

// 025-w3-2 — the one PROJECTED_BY_HAND id now has a hand-written seam face.
describe("W3-2 providerDirectory.discover — hand projection + safe request", () => {
	test("llm.discoverModels -> SECOND-whitelisted models; request params forwarded without a key", async () => {
		const { seam, requests } = harness({
			"llm.discoverModels": { value: [
				{ id: "m1", name: "Model One", contextWindow: 128000, maxTokens: 8192, inputModalities: ["text", "image"], apiKey: SENTINEL, baseURL: "https://secret" },
				{ id: "m2", name: "Model Two", inputModalities: ["voice"] },
			] },
		})
		const models = await seam.providerDirectory!.discover!("llm", { provider: "p1" })
		expect(models).toEqual([
			{ id: "m1", name: "Model One", contextWindow: 128000, maxTokens: 8192, inputModalities: ["text", "image"] },
			{ id: "m2", name: "Model Two" },
		])
		expect(requests).toEqual([{ method: "llm.discoverModels", params: { settingsNs: "llm", request: { provider: "p1" } } }])
		const text = JSON.stringify(models)
		expect(text).not.toContain(SENTINEL)
		expect(text).not.toContain("https://secret")
		expect(text).not.toMatch(/"apiKey"|"baseURL"|"voice"/)
	})

	test("service absent -> UNSUPPORTED (never a fake-empty discovered list)", async () => {
		const { seam } = harness({})
		let rejected = false
		try { await seam.providerDirectory!.discover!("llm", {}) } catch (err) {
			rejected = err instanceof BridgeProtocolError && err.code === "UNSUPPORTED"
		}
		expect(rejected).toBe(true)
	})

	test("hostile reply: only whitelisted fields survive", async () => {
		const { seam } = harness({
			"llm.discoverModels": { value: [
				{ id: "ok", token: SENTINEL, password: SENTINEL, extra: SENTINEL },
				{ name: "no id" },
			] },
		})
		const models = await seam.providerDirectory!.discover!("llm", {})
		expect(models).toEqual([{ id: "ok" }])
		expect(JSON.stringify(models)).not.toContain(SENTINEL)
	})
})
