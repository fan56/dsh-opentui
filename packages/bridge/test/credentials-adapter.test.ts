/**
 * Issue #29 — inproc host credentials adapter unit tests.
 *
 * Drives the REAL `createCapHostInvoke` credentials arm (and adapter helpers)
 * with a synthetic host `ctx.credentials` service (`dsh-credentials-local`
 * shape). Covers:
 *   - E1 present: `credentials.describe` maps per-ref calls and strips `masked`
 *     and hostile fields; `set`/`unset` forward to host;
 *   - E2 absent: neither `credentialsController` nor `ctx.credentials` keeps the
 *     exact `NOT_WIRED: credentialsController unavailable` error text;
 *   - E3 throw & desensitization: `set` errors never echo the submitted secret
 *     value; missing host methods report `HOST_UNAVAILABLE`;
 *   - Controller priority: real `credentialsController` wins over `ctx.credentials`;
 *   - Parameter validation: >64 refs or invalid ref grammar -> `BAD_PARAMS`.
 */
import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { createCapHostInvoke } from "../src/index"
import { projectCredentialInfoForWire, sanitizeCredentialErrorMessage } from "../src/credentials-adapter"
import type { CapMethodId } from "../../../capcontract/types"

const DESC = "@deepseek-ai/dsh-api-settings-controller#credentials/describe" as CapMethodId
const SET = "@deepseek-ai/dsh-api-settings-controller#credentials/set" as CapMethodId
const UNSET = "@deepseek-ai/dsh-api-settings-controller#credentials/unset" as CapMethodId

function ctxWith(services: { controller?: unknown; credentials?: unknown }): never {
	return {
		get: (key: string) => {
			if (key === "credentialsController") return services.controller
			if (key === "credentials") return services.credentials
			return undefined
		},
	} as never
}

describe("Issue #29 — credentials-adapter present: host ctx.credentials resolves through the arm", () => {
	test("credentials/describe maps per-ref calls and strips masked + hostile fields", async () => {
		const seenRefs: string[] = []
		const host = {
			describe: async (ref: string) => {
				seenRefs.push(ref)
				return {
					configured: true,
					source: "file",
					writable: true,
					masked: "sk-1234••••abcd",
					value: "SECRET_SHOULD_NOT_CROSS",
				}
			},
		}
		const out = await createCapHostInvoke(ctxWith({ credentials: host }))(
			DESC,
			"unary",
			{ refs: ["DEEPSEEK_API_KEY", "OPENAI_API_KEY"] },
		) as Record<string, unknown>

		expect(seenRefs).toEqual(["DEEPSEEK_API_KEY", "OPENAI_API_KEY"])
		expect(out).toEqual({
			DEEPSEEK_API_KEY: { configured: true, source: "file", writable: true },
			OPENAI_API_KEY: { configured: true, source: "file", writable: true },
		})
		expect(JSON.stringify(out)).not.toContain("masked")
		expect(JSON.stringify(out)).not.toContain("sk-1234")
		expect(JSON.stringify(out)).not.toContain("SECRET_SHOULD_NOT_CROSS")
	})

	test("credentials/set and unset forward to host ctx.credentials", async () => {
		const store = new Map<string, string>()
		const host = {
			describe: async (ref: string) => ({ configured: store.has(ref), writable: true }),
			set: async (ref: string, value: string) => { store.set(ref, value) },
			unset: async (ref: string) => { store.delete(ref) },
		}
		const invoke = createCapHostInvoke(ctxWith({ credentials: host }))
		await invoke(SET, "unary", { ref: "DEEPSEEK_API_KEY", value: "sk-synthetic-1" })
		expect(store.get("DEEPSEEK_API_KEY")).toBe("sk-synthetic-1")
		const desc = await invoke(DESC, "unary", { refs: ["DEEPSEEK_API_KEY"] })
		expect(desc).toEqual({ DEEPSEEK_API_KEY: { configured: true, writable: true } })
		await invoke(UNSET, "unary", { ref: "DEEPSEEK_API_KEY" })
		expect(store.has("DEEPSEEK_API_KEY")).toBe(false)
	})
})

describe("Issue #29 — credentials-adapter absent & text-union discipline", () => {
	test("no controller and no ctx.credentials -> exact NOT_WIRED text", async () => {
		const invoke = createCapHostInvoke(ctxWith({}))
		await expect(invoke(DESC, "unary", { refs: ["DEEPSEEK_API_KEY"] })).rejects.toThrow(
			"NOT_WIRED: credentialsController unavailable",
		)
		await expect(invoke(SET, "unary", { ref: "DEEPSEEK_API_KEY", value: "x" })).rejects.toThrow(
			"NOT_WIRED: credentialsController unavailable",
		)
		await expect(invoke(UNSET, "unary", { ref: "DEEPSEEK_API_KEY" })).rejects.toThrow(
			"NOT_WIRED: credentialsController unavailable",
		)
	})

	test("adapter source introduces no NOT_WIRED literal (capcontract #16 text-union)", () => {
		const src = readFileSync(new URL("../src/credentials-adapter.ts", import.meta.url), "utf8")
		expect(src.includes("NOT_WIRED")).toBe(false)
	})
})

describe("Issue #29 — credentials-adapter safety, priority & BAD_PARAMS", () => {
	test("set failure scrubs submitted secret value from error message", async () => {
		const secret = "sk-top-secret-sentinel-value"
		const host = {
			set: async () => { throw new Error(`bad secret ${secret}`) },
		}
		const invoke = createCapHostInvoke(ctxWith({ credentials: host }))
		let caught = ""
		try {
			await invoke(SET, "unary", { ref: "DEEPSEEK_API_KEY", value: secret })
		} catch (err) {
			caught = err instanceof Error ? err.message : String(err)
		}
		expect(caught).toContain("DEEPSEEK_API_KEY")
		expect(caught).not.toContain(secret)
		expect(sanitizeCredentialErrorMessage(new Error(`leak ${secret}`), "REF", secret)).toBe(
			"credentials.set failed for REF",
		)
	})

	test("missing host method throws HOST_UNAVAILABLE, not NOT_WIRED", async () => {
		const invoke = createCapHostInvoke(ctxWith({ credentials: {} }))
		await expect(invoke(SET, "unary", { ref: "DEEPSEEK_API_KEY", value: "v" })).rejects.toThrow(
			"HOST_UNAVAILABLE: credentials.set",
		)
	})

	test("real credentialsController retains priority over ctx.credentials", async () => {
		let fallbackTouched = false
		const controller = {
			describe: async (refs: string[]) => Object.fromEntries(refs.map((r) => [r, { configured: true, source: "controller", writable: true }])),
		}
		const credentials = {
			describe: async () => { fallbackTouched = true; return { configured: false, writable: true } },
		}
		const out = await createCapHostInvoke(ctxWith({ controller, credentials }))(
			DESC,
			"unary",
			{ refs: ["DEEPSEEK_API_KEY"] },
		)
		expect(fallbackTouched).toBe(false)
		expect(out).toEqual({ DEEPSEEK_API_KEY: { configured: true, source: "controller", writable: true } })
	})

	test("BAD_PARAMS on invalid ref grammar or >64 refs in describe", async () => {
		const invoke = createCapHostInvoke(ctxWith({ credentials: { describe: async () => ({ configured: false }) } }))
		await expect(invoke(DESC, "unary", { refs: ["bad-ref!"] })).rejects.toThrow("BAD_PARAMS:")
		const tooMany = Array.from({ length: 65 }, (_, i) => `REF_${i}`)
		await expect(invoke(DESC, "unary", { refs: tooMany })).rejects.toThrow("BAD_PARAMS:")
		expect(projectCredentialInfoForWire({ present: true, masked: "secret" })).toEqual({
			configured: true,
			writable: true,
		})
	})
})
