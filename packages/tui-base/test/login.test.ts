/**
 * /login tests (batch H4, tui-pi 65-ux-batch parity): the pure helpers
 * (key-ref derivation, route profiles, per-step validation) and the
 * command's flows — picker, six-step custom chain (per-step validation
 * keeping the step, esc aborting the whole flow), the catalog key path and
 * the degrade notices — against a recording fake face.
 */
import { describe, expect, test } from "bun:test"
import {
	coreCommands,
	commitLoginRoute,
	loginStepTitle,
	type LoginFace,
	type SlashCommandContext,
} from "../src/routes/session/commands"
import {
	CUSTOM_ENTRY,
	CUSTOM_STEPS,
	PROVIDER_CATALOG,
	buildCustomEntry,
	deriveKeyRef,
	providerProfileFor,
	validateBaseUrl,
	validateRouteId,
} from "../src/routes/session/login"
import type { SessionSeam } from "../src/seams/session"

describe("login pure helpers", () => {
	test("deriveKeyRef maps provider ids to env refs", () => {
		expect(deriveKeyRef("openai")).toBe("OPENAI_API_KEY")
		expect(deriveKeyRef("acme-gateway")).toBe("ACME_GATEWAY_API_KEY")
		expect(deriveKeyRef("zai-coding-cn")).toBe("ZAI_CODING_CN_API_KEY")
	})

	test("providerProfileFor: catalog routes carry only apiKeyEnv, customs carry the hand-declared fields", () => {
		expect(providerProfileFor(PROVIDER_CATALOG[0]!)).toEqual({ apiKeyEnv: "AMAZON_BEDROCK_API_KEY" })
		const custom = buildCustomEntry({ routeId: "acme-gateway", baseURL: "https://gw/v1", models: "a,b" })
		expect(providerProfileFor(custom)).toEqual({
			apiKeyEnv: "ACME_GATEWAY_API_KEY",
			api: "openai-completions",
			baseURL: "https://gw/v1",
			models: [{ id: "a" }, { id: "b" }],
			displayName: "acme-gateway",
		})
	})

	test("buildCustomEntry: optional display name and protocol defaults", () => {
		const entry = buildCustomEntry({ routeId: "x", displayName: "X GW", protocol: "anthropic-messages", baseURL: "https://x/v1", models: " m1 , m2 " })
		expect(entry.name).toBe("X GW")
		expect(entry.api).toBe("anthropic-messages")
		expect(entry.models).toEqual([{ id: "m1" }, { id: "m2" }])
	})

	test("validateRouteId: required, slug charset, collision (the reference's already-exists error)", () => {
		expect(validateRouteId("", [])).toBe("route id is required")
		expect(validateRouteId("bad id!", [])).toContain("letters, digits")
		expect(validateRouteId("openai", ["openai", "zai"])).toBe('route id "openai" already exists')
		expect(validateRouteId("acme-gateway", ["openai"])).toBeUndefined()
	})

	test("validateBaseUrl: http(s) scheme required (the reference keeps step 4 on a bad URL)", () => {
		expect(validateBaseUrl("not-a-url")).toContain("http")
		expect(validateBaseUrl("")).toBe("base URL is required")
		expect(validateBaseUrl("https://gw.internal.example/v1")).toBeUndefined()
		expect(validateBaseUrl("http://gw/v1")).toBeUndefined()
	})

	test("the six steps: 1 id / 2 display / 3 protocol / 4 url / 5 models / 6 masked key", () => {
		expect(CUSTOM_STEPS.map((s) => s.title)).toEqual([
			"Custom provider 1/6 — route id",
			"Custom provider 2/6 — display name",
			"Custom provider 3/6 — protocol (default openai-completions)",
			"Custom provider 4/6 — base URL",
			"Custom provider 5/6 — models (comma-separated)",
			"Custom provider 6/6 — API key (secret, never echoed)",
		])
		expect(CUSTOM_STEPS.map((s) => s.optional)).toEqual([false, true, true, false, false, false])
		expect(CUSTOM_STEPS[5]!.mask).toBe(true)
	})

	test("loginStepTitle appends the inline error", () => {
		expect(loginStepTitle("step", undefined)).toBe("step")
		expect(loginStepTitle("step", "boom")).toBe("step — boom")
	})
})

// ---------------------------------------------------------- command flows ----

/** Recording login face: every call is logged in order. */
class RecordingLoginFace implements LoginFace {
	calls: string[] = []
	existingRoutes: string[] = []
	registerOk = true
	loginError: Error | undefined
	credentialStatusResult = { configured: false }

	async credentialStatus(ref: string) {
		this.calls.push(`status:${ref}`)
		return this.credentialStatusResult
	}
	async login(ref: string, apiKey: string) {
		this.calls.push(`login:${ref}`)
		if (this.loginError) throw this.loginError
	}
	async logout(ref: string) {
		this.calls.push(`logout:${ref}`)
	}
	async routes() {
		return this.existingRoutes
	}
	async registerRoute(providerId: string, profile: Record<string, unknown> | undefined) {
		this.calls.push(`route:${providerId}:${profile ? JSON.stringify(profile) : "unset"}`)
		return this.registerOk
	}
}

function makeLoginCtx(opts: {
	face: RecordingLoginFace
	pick?: string
	/** Scripted promptText answers, consumed in order; undefined entries are esc. */
	type: (string | undefined)[]
}) {
	const lines: string[] = []
	const prompts: { title: string; mask?: boolean }[] = []
	const ctx: Record<string, unknown> = {
		seam: seamWith(opts.face),
		say: (text: string) => lines.push(text),
		promptText: async (title: string, o?: { mask?: boolean }) => {
			prompts.push({ title, mask: o?.mask })
			const next = opts.type.shift()
			return next
		},
		pickOne: async () => opts.pick,
	}
	return { ctx, lines, prompts }
}

async function runLogin(ctx: { say: (t: string) => void }, argText: string) {
	const command = coreCommands().find((c) => c.name === "/login")!
	await command.run(ctx as unknown as SlashCommandContext, argText)
}

/** SessionSeam carrying only the login face (the command touches nothing else). */
function seamWith(face: LoginFace | undefined): SessionSeam {
	return { login: face } as unknown as SessionSeam
}

describe("/login command (batch H4)", () => {
	test("bare opens the Add provider picker over the catalog + Custom provider", async () => {
		const face = new RecordingLoginFace()
		const { ctx, prompts } = makeLoginCtx({ face, pick: undefined, type: [] })
		const picks: { title: string; options: { title: string; value: string }[] }[] = []
		;(ctx as any).pickOne = async (title: string, options: { title: string; value: string }[]) => {
			picks.push({ title, options })
			return undefined
		}
		await runLogin(ctx as any, "")
		expect(picks[0]!.title).toBe("Add provider")
		const values = picks[0]!.options.map((o) => o.value)
		expect(values[0]).toBe("custom")
		expect(values[values.length - 1]).toBe("xai")
		expect(picks[0]!.options.length).toBe(PROVIDER_CATALOG.length + 1)
		expect(prompts).toEqual([])
	})

	test("esc on the picker does nothing", async () => {
		const face = new RecordingLoginFace()
		const { ctx, lines } = makeLoginCtx({ face, pick: undefined, type: [] })
		await runLogin(ctx as any, "")
		expect(face.calls).toEqual([])
		expect(lines).toEqual([])
	})

	test("catalog row: masked key prompt → route registered THEN key stored (the double-write order)", async () => {
		const face = new RecordingLoginFace()
		const { ctx, prompts, lines } = makeLoginCtx({ face, pick: "deepseek", type: ["sk-test-1"] })
		await runLogin(ctx as any, "")
		expect(prompts[0]!.mask).toBe(true)
		expect(prompts[0]!.title).toContain("DEEPSEEK_API_KEY")
		expect(face.calls).toEqual([
			`route:deepseek:${JSON.stringify({ apiKeyEnv: "DEEPSEEK_API_KEY" })}`,
			"login:DEEPSEEK_API_KEY",
		])
		expect(lines[0]).toContain("DeepSeek subscribed")
	})

	test("esc on the key step aborts with no writes", async () => {
		const face = new RecordingLoginFace()
		const { ctx } = makeLoginCtx({ face, pick: "deepseek", type: [undefined] })
		await runLogin(ctx as any, "")
		expect(face.calls).toEqual([])
	})

	test("direct argument targets a catalog id", async () => {
		const face = new RecordingLoginFace()
		const { ctx } = makeLoginCtx({ face, type: ["sk-x"] })
		await runLogin(ctx as any, "openai")
		expect(face.calls).toEqual([`route:openai:${JSON.stringify({ apiKeyEnv: "OPENAI_API_KEY" })}`, "login:OPENAI_API_KEY"])
	})

	test("six-step chain happy path: route id → display → protocol → url → models → masked key", async () => {
		const face = new RecordingLoginFace()
		face.existingRoutes = ["existing"]
		const { ctx, prompts, lines } = makeLoginCtx({
			face,
			pick: "custom",
			type: ["acme-gateway", "Acme GW", "", "https://gw.internal.example/v1", "acme-large,acme-think", "sk-e2e-test-key"],
		})
		await runLogin(ctx as any, "")
		expect(prompts.map((p) => p.title)).toEqual([
			"Custom provider 1/6 — route id",
			"Custom provider 2/6 — display name",
			"Custom provider 3/6 — protocol (default openai-completions)",
			"Custom provider 4/6 — base URL",
			"Custom provider 5/6 — models (comma-separated)",
			"Custom provider 6/6 — API key (secret, never echoed)",
		])
		expect(prompts[5]!.mask).toBe(true)
		const profile = { apiKeyEnv: "ACME_GATEWAY_API_KEY", api: "openai-completions", baseURL: "https://gw.internal.example/v1", models: [{ id: "acme-large" }, { id: "acme-think" }], displayName: "Acme GW" }
		expect(face.calls).toEqual([`route:acme-gateway:${JSON.stringify(profile)}`, "login:ACME_GATEWAY_API_KEY"])
		expect(lines[0]).toContain("Acme GW subscribed")
	})

	test("a colliding route id keeps step 1 (re-prompt with the inline error), then a valid one advances", async () => {
		const face = new RecordingLoginFace()
		face.existingRoutes = ["openai", "zai"]
		const { ctx, prompts } = makeLoginCtx({
			face,
			pick: "custom",
			type: ["openai", "acme-gateway", "Acme", "", "https://gw/v1", "m1", "sk-k"],
		})
		await runLogin(ctx as any, "")
		expect(prompts[0]!.title).toBe("Custom provider 1/6 — route id")
		expect(prompts[1]!.title).toBe('Custom provider 1/6 — route id — route id "openai" already exists')
		expect(prompts[2]!.title).toBe("Custom provider 2/6 — display name")
	})

	test("an invalid base URL keeps step 4, then a valid one advances", async () => {
		const face = new RecordingLoginFace()
		const { ctx, prompts } = makeLoginCtx({
			face,
			pick: "custom",
			type: ["acme-gateway", "", "", "not-a-url", "https://gw/v1", "m1", "sk-k"],
		})
		await runLogin(ctx as any, "")
		const titles = prompts.map((p) => p.title)
		expect(titles[3]).toBe("Custom provider 4/6 — base URL")
		expect(titles[4]).toBe("Custom provider 4/6 — base URL — base URL must start with http:// or https://")
		expect(titles[5]).toBe("Custom provider 5/6 — models (comma-separated)")
	})

	test("esc mid-chain abandons the whole flow with no writes and the cancel feedback", async () => {
		const face = new RecordingLoginFace()
		const { ctx, lines } = makeLoginCtx({ face, pick: "custom", type: ["acme-gateway", undefined] })
		await runLogin(ctx as any, "")
		expect(face.calls).toEqual([])
		expect(lines).toEqual(["login cancelled"])
	})

	test("route failure keeps the key unstored (registerRoute false → no credentials write)", async () => {
		const face = new RecordingLoginFace()
		face.registerOk = false
		const { ctx, lines } = makeLoginCtx({ face, pick: "deepseek", type: ["sk-test-1"] })
		await runLogin(ctx as any, "")
		expect(face.calls).toEqual(["route:deepseek:" + JSON.stringify({ apiKeyEnv: "DEEPSEEK_API_KEY" })])
		expect(lines[0]).toContain("route registration failed — key not stored")
	})

	test("credentials failure is reported, route stays registered", async () => {
		const face = new RecordingLoginFace()
		face.loginError = new Error("invalid payload")
		const { ctx, lines } = makeLoginCtx({ face, pick: "deepseek", type: ["sk-test-1"] })
		await runLogin(ctx as any, "")
		expect(face.calls).toEqual(["route:deepseek:" + JSON.stringify({ apiKeyEnv: "DEEPSEEK_API_KEY" }), "login:DEEPSEEK_API_KEY"])
		expect(lines[0]).toContain("key store failed — invalid payload")
	})

	test("degrades to a notice without the seam face", async () => {
		const { ctx, lines } = makeLoginCtx({ face: new RecordingLoginFace(), type: [] })
		await runLogin({ ...ctx, seam: seamWith(undefined) } as any, "")
		expect(lines).toEqual(["/login unavailable in this session"])
	})
})

describe("commitLoginRoute (shared commit half)", () => {
	test("empty key never reaches the seam", async () => {
		const face = new RecordingLoginFace()
		const lines: string[] = []
		await commitLoginRoute((t) => lines.push(t), face, PROVIDER_CATALOG[0]!, "  ")
		expect(face.calls).toEqual([])
	})
})
