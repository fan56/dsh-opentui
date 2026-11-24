/**
 * /login tests (batch H4, tui-pi 65-ux-batch parity): the pure helpers
 * (key-ref derivation, route profiles, per-step validation) and the
 * command's flows — picker, six-step custom chain (per-step validation
 * keeping the step, esc aborting the whole flow), the catalog key path and
 * the degrade notices — against a recording fake face.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import {
	coreCommands,
	commitLoginRoute,
	loginStepTitle,
	logoutTargets,
	type LoginFace,
	type SlashCommandContext,
} from "../src/routes/session/commands"
import {
	CUSTOM_STEPS,
	PROVIDER_CATALOG,
	buildCustomEntry,
	catalogEntriesFromDirectory,
	deriveKeyRef,
	providerProfileFor,
	validateBaseUrl,
	validateRouteId,
} from "../src/routes/session/login"
import type { SeamAccountState, SeamLoginRoute, SessionSeam } from "../src/seams/session"

// The command copy resolves through `t()` (T4 facet migration): boot the
// bundled registry so the en-literal assertions stay hermetic in isolation.
beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})
afterAll(() => setLanguages(new Map()))

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
	/** Full route bodies (the /logout contract); overrides existingRoutes when set. */
	liveRoutes: SeamLoginRoute[] | undefined
	/** When set, routes() rejects — the dead-settings-seam arm. */
	routesError: Error | undefined
	registerOk = true
	/** When set, registerRoute rejects instead of returning a plan (P1 reason test). */
	registerError: Error | undefined
	loginError: Error | undefined
	logoutError: Error | undefined
	/** Key refs that probe as configured (the /logout sweep's fixture). */
	configuredRefs: Set<string> = new Set()
	credentialStatusResult = { configured: false }

	async credentialStatus(ref: string) {
		this.calls.push(`status:${ref}`)
		return this.configuredRefs.has(ref) ? { configured: true } : this.credentialStatusResult
	}
	async login(ref: string, apiKey: string) {
		this.calls.push(`login:${ref}`)
		if (this.loginError) throw this.loginError
	}
	async logout(ref: string) {
		this.calls.push(`logout:${ref}`)
		if (this.logoutError) throw this.logoutError
	}
	async routes() {
		if (this.routesError) throw this.routesError
		return this.liveRoutes ?? this.existingRoutes.map((id) => ({ id }))
	}
	async registerRoute(providerId: string, profile: Record<string, unknown> | undefined) {
		this.calls.push(`route:${providerId}:${profile ? JSON.stringify(profile) : "unset"}`)
		if (this.registerError) throw this.registerError
		return this.registerOk
			? { kind: "host-settings" as const, ns: "llm-pi-ai" as const, ops: [{ op: "set" as const, path: ["providers", providerId], value: profile ?? {} }] }
			: { kind: "invalid" as const, reason: "host settings channel refused the route" }
	}
}

/** Recording account face: the existing seam.account state machine the D8
 * "account" entrance reuses (no new bridge frame / no invented authorize URL). */
class RecordingAccountFace {
	calls: string[] = []
	state: SeamAccountState = { status: "credential-stored", attemptPhase: null, authorizeUrlReady: false, linksPresent: true }
	signInError: Error | undefined

	async getState() {
		this.calls.push("getState")
		return this.state
	}
	async startSignIn(origin: string, source: string) {
		this.calls.push(`startSignIn:${origin}:${source}`)
		if (this.signInError) throw this.signInError
		return this.state
	}
	async cancelSignIn(attemptId: string) {
		this.calls.push(`cancelSignIn:${attemptId}`)
		return this.state
	}
	async signOut() {
		this.calls.push("signOut")
		return this.state
	}
	async hasRunningAccountTasks() {
		this.calls.push("hasRunningAccountTasks")
		return false
	}
}

function makeLoginCtx(opts: {
	face: RecordingLoginFace
	/** One value for a single-picker flow; an array for the D8 two-stage flows
	 * (entrance pick, then the sub-panel pick). Exhausted / undefined = esc. */
	pick?: string | (string | undefined)[]
	/** Scripted promptText answers, consumed in order; undefined entries are esc. */
	type: (string | undefined)[]
}) {
	const lines: string[] = []
	const prompts: { title: string; mask?: boolean }[] = []
	const pickQueue: (string | undefined)[] = Array.isArray(opts.pick)
		? [...opts.pick]
		: opts.pick === undefined
			? []
			: [opts.pick]
	const ctx: Record<string, unknown> = {
		seam: seamWith(opts.face),
		say: (text: string) => lines.push(text),
		promptText: async (title: string, o?: { mask?: boolean }) => {
			prompts.push({ title, mask: o?.mask })
			const next = opts.type.shift()
			return next
		},
		pickOne: async () => pickQueue.shift(),
	}
	return { ctx, lines, prompts }
}

async function runLogin(ctx: { say: (t: string) => void }, argText: string) {
	const command = coreCommands().find((c) => c.name === "/login")!
	await command.run(ctx as unknown as SlashCommandContext, argText)
}

/** SessionSeam carrying the login face + the host settings channel the route
 *  plan is applied through (T7). */
function seamWith(face: LoginFace | undefined): SessionSeam {
	return {
		login: face,
		settings: { mutate: async () => ({ ok: true }) },
	} as unknown as SessionSeam
}

/** P0-3: a seam whose client profile directory differs from the one the dsh
 *  process actually loads. The notice must name both dirs and the repair. */
function seamWithMismatch(face: LoginFace | undefined): SessionSeam {
	return {
		login: face,
		settings: {
			mutate: async () => ({ ok: true }),
			profileConsistency: () => ({
				ok: false,
				clientDir: "/home/u/.dsh/profiles/opentui",
				hostDir: "/home/u/.dsh/profiles/opentui-inproc",
			}),
		},
	} as unknown as SessionSeam
}

describe("/login command (batch H4)", () => {
	test("bare opens the three-entrance picker, then the third-party catalog picker", async () => {
		const face = new RecordingLoginFace()
		const { ctx, prompts } = makeLoginCtx({ face, pick: undefined, type: [] })
		const picks: { title: string; options: { title: string; value: string }[] }[] = []
		;(ctx as any).pickOne = async (title: string, options: { title: string; value: string }[]) => {
			picks.push({ title, options })
			return picks.length === 1 ? "third-party" : undefined
		}
		await runLogin(ctx as any, "")
		expect(picks[0]!.title).toBe("Sign in — choose a method")
		expect(picks[0]!.options.map((o) => o.value)).toEqual(["account", "third-party", "custom"])
		// The old flat picker is now the third-party sub-panel (no Custom row).
		expect(picks[1]!.title).toBe("Add provider")
		const values = picks[1]!.options.map((o) => o.value)
		expect(values).toContain("deepseek")
		expect(values[values.length - 1]).toBe("xai")
		expect(picks[1]!.options.length).toBe(PROVIDER_CATALOG.length)
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
		const { ctx, prompts, lines } = makeLoginCtx({ face, pick: ["third-party", "deepseek"], type: ["sk-test-1"] })
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
		const { ctx } = makeLoginCtx({ face, pick: ["third-party", "deepseek"], type: [undefined] })
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
		const { ctx, lines } = makeLoginCtx({ face, pick: ["third-party", "deepseek"], type: ["sk-test-1"] })
		await runLogin(ctx as any, "")
		expect(face.calls).toEqual(["route:deepseek:" + JSON.stringify({ apiKeyEnv: "DEEPSEEK_API_KEY" })])
		expect(lines[0]).toContain("route registration failed — key not stored")
	})

	test("credentials failure is reported, route stays registered", async () => {
		const face = new RecordingLoginFace()
		face.loginError = new Error("invalid payload")
		const { ctx, lines } = makeLoginCtx({ face, pick: ["third-party", "deepseek"], type: ["sk-test-1"] })
		await runLogin(ctx as any, "")
		expect(face.calls).toEqual(["route:deepseek:" + JSON.stringify({ apiKeyEnv: "DEEPSEEK_API_KEY" }), "login:DEEPSEEK_API_KEY"])
		expect(lines[0]).toContain("key store failed — invalid payload")
	})

	test("degrades to a notice without the seam face", async () => {
		const { ctx, lines } = makeLoginCtx({ face: new RecordingLoginFace(), type: [] })
		await runLogin({ ...ctx, seam: seamWith(undefined) } as any, "")
		expect(lines).toEqual(["/login unavailable in this session"])
	})

	test("P0-3: a profile mismatch refuses the whole commit with both dirs", async () => {
		const face = new RecordingLoginFace()
		const { ctx, lines } = makeLoginCtx({ face, pick: "deepseek", type: ["sk-secret"] })
		;(ctx as any).seam = seamWithMismatch(face)
		await runLogin(ctx as any, "deepseek")
		expect(face.calls).toEqual([])
		expect(lines).toHaveLength(1)
		expect(lines[0]).toContain("/home/u/.dsh/profiles/opentui")
		expect(lines[0]).toContain("/home/u/.dsh/profiles/opentui-inproc")
		expect(lines[0]).toContain("restart dsh-opentui")
	})
})

// -------------------------------------------------------- D8 three entrances ----
// The bare /login flow now opens a three-item picker first. Each entrance
// drives an EXISTING seam face — no new bridge frame, no invented URL/port.
describe("/login three entrances (D8)", () => {
	/** seam carrying both the login face (the /login guard) and an account face. */
	function seamWithAccount(face: LoginFace, account: RecordingAccountFace | undefined): SessionSeam {
		return { ...seamWith(face), account } as unknown as SessionSeam
	}

	test("the entrance picker offers exactly the three contracted modes", async () => {
		const face = new RecordingLoginFace()
		const picks: { title: string; options: { title: string; value: string; description?: string }[] }[] = []
		const { ctx } = makeLoginCtx({ face, pick: undefined, type: [] })
		;(ctx as any).pickOne = async (title: string, options: { title: string; value: string; description?: string }[]) => {
			picks.push({ title, options })
			return undefined
		}
		await runLogin(ctx as any, "")
		expect(picks).toHaveLength(1)
		expect(picks[0]!.title).toBe("Sign in — choose a method")
		expect(picks[0]!.options.map((o) => o.value)).toEqual(["account", "third-party", "custom"])
		expect(picks[0]!.options.map((o) => o.title)).toEqual(["DeepSeek account", "Third-party provider", "Custom provider"])
	})

	test("account entrance → signin is unavailable: no startSignIn call, no key writes", async () => {
		const face = new RecordingLoginFace()
		const account = new RecordingAccountFace()
		const { ctx, lines } = makeLoginCtx({ face, pick: ["account", "signin"], type: [] })
		;(ctx as any).seam = seamWithAccount(face, account)
		await runLogin(ctx as any, "")
		expect(account.calls).toEqual([])
		expect(account.calls.filter((c) => c.startsWith("startSignIn:"))).toEqual([])
		expect(lines).toHaveLength(1)
		expect(lines[0]).toContain("Browser sign-in is not available in this build.")
		expect(face.calls).toEqual([]) // the account entrance never touches the provider key faces
	})

	test("account entrance → state and signout actions reach the same state machine", async () => {
		const face = new RecordingLoginFace()
		const accountState = new RecordingAccountFace()
		const { ctx: ctxState } = makeLoginCtx({ face, pick: ["account", "state"], type: [] })
		;(ctxState as any).seam = seamWithAccount(face, accountState)
		await runLogin(ctxState as any, "")
		expect(accountState.calls).toEqual(["getState"])

		const accountOut = new RecordingAccountFace()
		const { ctx: ctxOut } = makeLoginCtx({ face, pick: ["account", "signout"], type: [] })
		;(ctxOut as any).seam = seamWithAccount(face, accountOut)
		await runLogin(ctxOut as any, "")
		expect(accountOut.calls).toEqual(["signOut"])
	})

	test("account entrance: the action picker offers only state and signout", async () => {
		const face = new RecordingLoginFace()
		const account = new RecordingAccountFace()
		const { ctx } = makeLoginCtx({ face, pick: [], type: [] })
		;(ctx as any).seam = seamWithAccount(face, account)
		const picks: { title: string; options: { title: string; value: string }[] }[] = []
		const queue: (string | undefined)[] = ["account", undefined]
		;(ctx as any).pickOne = async (title: string, options: { title: string; value: string }[]) => {
			picks.push({ title, options })
			return queue.shift()
		}
		await runLogin(ctx as any, "")
		expect(picks).toHaveLength(2)
		expect(picks[1]!.title).toBe("DeepSeek account")
		expect(picks[1]!.options.map((o) => o.value)).toEqual(["state", "signout"])
	})

	test("account entrance: esc at the entrance or at the action picker is a no-op", async () => {
		const face = new RecordingLoginFace()
		const account = new RecordingAccountFace()
		const { ctx: ctx1, lines: lines1 } = makeLoginCtx({ face, pick: [undefined], type: [] })
		;(ctx1 as any).seam = seamWithAccount(face, account)
		await runLogin(ctx1 as any, "")
		expect(account.calls).toEqual([])
		expect(face.calls).toEqual([]) // zero writes on esc
		expect(lines1).toEqual([])

		const { ctx: ctx2, lines: lines2 } = makeLoginCtx({ face, pick: ["account", undefined], type: [] })
		;(ctx2 as any).seam = seamWithAccount(face, account)
		await runLogin(ctx2 as any, "")
		expect(account.calls).toEqual([])
		expect(face.calls).toEqual([]) // zero writes on esc
		expect(lines2).toEqual([])
	})

	test("account entrance: a missing account face reports unavailable before opening the action picker", async () => {
		const face = new RecordingLoginFace()
		const { ctx, lines } = makeLoginCtx({ face, pick: ["account", "signin"], type: [] })
		;(ctx as any).seam = seamWithAccount(face, undefined)
		const picks: string[] = []
		;(ctx as any).pickOne = async (title: string) => {
			picks.push(title)
			return "account"
		}
		await runLogin(ctx as any, "")
		expect(lines).toEqual(["/account unavailable in this session"])
		expect(picks).toEqual(["Sign in — choose a method"]) // no action picker when the face is absent
	})

	test("account entrance: signin never reaches the seam even if its face would reject it", async () => {
		const face = new RecordingLoginFace()
		const account = new RecordingAccountFace()
		account.signInError = new Error("webServer unavailable: protocol")
		const { ctx, lines } = makeLoginCtx({ face, pick: ["account", "signin"], type: [] })
		;(ctx as any).seam = seamWithAccount(face, account)
		await runLogin(ctx as any, "")
		expect(account.calls.filter((c) => c.startsWith("startSignIn:"))).toEqual([])
		expect(lines).toHaveLength(1)
		expect(lines[0]).toContain("Browser sign-in is not available in this build.")
	})

	test("an illegal entrance mode is a no-op (no face calls, no output)", async () => {
		const face = new RecordingLoginFace()
		const { ctx, lines } = makeLoginCtx({ face, pick: ["not-a-mode"], type: [] })
		await runLogin(ctx as any, "")
		expect(face.calls).toEqual([])
		expect(lines).toEqual([])
	})

	test("third-party entrance: catalog pick → masked key → route + key double write", async () => {
		const face = new RecordingLoginFace()
		const { ctx, prompts, lines } = makeLoginCtx({ face, pick: ["third-party", "deepseek"], type: ["sk-d8"] })
		await runLogin(ctx as any, "")
		expect(prompts[0]!.mask).toBe(true)
		expect(face.calls).toEqual([
			`route:deepseek:${JSON.stringify({ apiKeyEnv: "DEEPSEEK_API_KEY" })}`,
			"login:DEEPSEEK_API_KEY",
		])
		expect(lines[0]).toContain("DeepSeek subscribed")
	})

	test("custom entrance: the six-step chain still commits the hand-declared route", async () => {
		const face = new RecordingLoginFace()
		const { ctx, prompts, lines } = makeLoginCtx({
			face,
			pick: ["custom"],
			type: ["d8-gw", "D8 GW", "", "https://gw.example/v1", "m1", "sk-d8"],
		})
		await runLogin(ctx as any, "")
		expect(prompts).toHaveLength(6)
		expect(prompts[5]!.mask).toBe(true)
		expect(face.calls).toEqual([
			`route:d8-gw:${JSON.stringify({ apiKeyEnv: "D8_GW_API_KEY", api: "openai-completions", baseURL: "https://gw.example/v1", models: [{ id: "m1" }], displayName: "D8 GW" })}`,
			"login:D8_GW_API_KEY",
		])
		expect(lines[0]).toContain("D8 GW subscribed")
	})

	test("/account signin reports unavailable without any startSignIn call", async () => {
		const account = new RecordingAccountFace()
		const lines: string[] = []
		const ctx = { seam: { account }, say: (text: string) => lines.push(text) } as unknown as SlashCommandContext
		const command = coreCommands().find((c) => c.name === "/account")!
		await command.run(ctx, "signin")
		expect(account.calls.filter((c) => c.startsWith("startSignIn:"))).toEqual([])
		expect(lines[0]).toContain("Browser sign-in is not available in this build.")
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

// ------------------------------------------------------------- /logout flow ----
// Gap fix (C8): the logout half of the login face — the picker over the
// routes whose key ref probes configured, the key-first commit ordering, and
// the custom-route key-only arm (the reference's hand-declared parity).

describe("logoutTargets (pure classifier)", () => {
	test("catalog routes carry the display name; unknown ids are custom (key-only)", () => {
		const targets = logoutTargets([{ id: "deepseek" }, { id: "acme-gateway" }])
		expect(targets).toEqual([
			{ id: "deepseek", name: "DeepSeek", ref: "DEEPSEEK_API_KEY", custom: false },
			{ id: "acme-gateway", name: "acme-gateway", ref: "ACME_GATEWAY_API_KEY", custom: true },
		])
	})

	test("the ref comes from the profile's own apiKeyEnv, not a derivation from the id (hand-edited profiles)", () => {
		const targets = logoutTargets([
			{ id: "deepseek", apiKeyEnv: "MY_HAND_EDITED_REF" },
			{ id: "openai" },
		])
		expect(targets.map((t) => t.ref)).toEqual(["MY_HAND_EDITED_REF", "OPENAI_API_KEY"])
	})

	test("profile displayName wins over the catalog name; empty strings fall through", () => {
		const targets = logoutTargets([
			{ id: "deepseek", displayName: "DeepSeek (work)" },
			{ id: "acme-gateway", displayName: "" },
		])
		expect(targets.map((t) => t.name)).toEqual(["DeepSeek (work)", "acme-gateway"])
	})

	test("a live declared flag marks a catalog id hand-declared (key-only logout even when the mirror lists it)", () => {
		const targets = logoutTargets([{ id: "deepseek", declared: true }])
		expect(targets[0]!.custom).toBe(true)
		// Absent flag: the static catalog mirror decides.
		expect(logoutTargets([{ id: "deepseek" }])[0]!.custom).toBe(false)
	})
})

describe("/logout command (C8 gap fix)", () => {
	async function runLogout(ctx: { say: (t: string) => void }, argText: string) {
		const command = coreCommands().find((c) => c.name === "/logout")!
		await command.run(ctx as unknown as SlashCommandContext, argText)
	}

	test("bare: picker over only the routes whose key ref probes configured", async () => {
		const face = new RecordingLoginFace()
		face.existingRoutes = ["deepseek", "acme-gateway", "openai"]
		face.configuredRefs = new Set(["DEEPSEEK_API_KEY", "ACME_GATEWAY_API_KEY"])
		const { ctx, lines } = makeLoginCtx({ face, pick: undefined, type: [] })
		const picks: { title: string; options: { title: string; value: string; description?: string }[] }[] = []
		;(ctx as any).pickOne = async (title: string, options: any[]) => {
			picks.push({ title, options })
			return undefined
		}
		await runLogout(ctx as any, "")
		expect(picks[0]!.title).toBe("Log out provider")
		expect(picks[0]!.options).toEqual([
			{ title: "DeepSeek", value: "deepseek", description: "DEEPSEEK_API_KEY" },
			{ title: "acme-gateway", value: "acme-gateway", description: "ACME_GATEWAY_API_KEY" },
		])
		expect(face.calls).toEqual(["status:DEEPSEEK_API_KEY", "status:ACME_GATEWAY_API_KEY", "status:OPENAI_API_KEY"])
		expect(lines).toEqual([])
	})

	test("esc on the picker does nothing", async () => {
		const face = new RecordingLoginFace()
		face.existingRoutes = ["deepseek"]
		face.configuredRefs = new Set(["DEEPSEEK_API_KEY"])
		const { ctx, lines } = makeLoginCtx({ face, pick: undefined, type: [] })
		await runLogout(ctx as any, "")
		expect(face.calls).toEqual(["status:DEEPSEEK_API_KEY"])
		expect(lines).toEqual([])
	})

	test("catalog pick: key dropped THEN route cleared (the commitLogout ordering)", async () => {
		const face = new RecordingLoginFace()
		face.existingRoutes = ["deepseek"]
		face.configuredRefs = new Set(["DEEPSEEK_API_KEY"])
		const { ctx, lines } = makeLoginCtx({ face, pick: "deepseek", type: [] })
		await runLogout(ctx as any, "")
		expect(face.calls).toEqual(["status:DEEPSEEK_API_KEY", "logout:DEEPSEEK_API_KEY", "route:deepseek:unset"])
		expect(lines).toEqual(["DeepSeek logged out — key + route removed (leaves /model next session)"])
	})

	test("custom route: key only — the route (api/baseURL/models) stays", async () => {
		const face = new RecordingLoginFace()
		face.existingRoutes = ["acme-gateway"]
		face.configuredRefs = new Set(["ACME_GATEWAY_API_KEY"])
		const { ctx, lines } = makeLoginCtx({ face, pick: "acme-gateway", type: [] })
		await runLogout(ctx as any, "")
		expect(face.calls).toEqual(["status:ACME_GATEWAY_API_KEY", "logout:ACME_GATEWAY_API_KEY"])
		expect(lines).toEqual(["acme-gateway logged out — key removed (route kept)"])
	})

	test("argument form targets one route directly", async () => {
		const face = new RecordingLoginFace()
		face.existingRoutes = ["deepseek", "openai"]
		face.configuredRefs = new Set(["DEEPSEEK_API_KEY", "OPENAI_API_KEY"])
		const { ctx, lines } = makeLoginCtx({ face, type: [] })
		await runLogout(ctx as any, "openai")
		expect(face.calls).toEqual(["status:DEEPSEEK_API_KEY", "status:OPENAI_API_KEY", "logout:OPENAI_API_KEY", "route:openai:unset"])
		expect(lines[0]).toContain("OpenAI logged out")
	})

	test("argument naming a not-logged-in route is rejected with no writes", async () => {
		const face = new RecordingLoginFace()
		face.existingRoutes = ["deepseek"]
		face.configuredRefs = new Set(["DEEPSEEK_API_KEY"])
		const { ctx, lines } = makeLoginCtx({ face, type: [] })
		await runLogout(ctx as any, "openai")
		expect(face.calls).toEqual(["status:DEEPSEEK_API_KEY"])
		expect(lines).toEqual(["not logged in: openai"])
	})

	test("argument matching is case-sensitive (route ids are mixed-case)", async () => {
		const face = new RecordingLoginFace()
		face.liveRoutes = [{ id: "Acme" }]
		face.configuredRefs = new Set(["ACME_API_KEY"])
		const { ctx, lines } = makeLoginCtx({ face, pick: "Acme", type: [] })
		await runLogout(ctx as any, "acme")
		expect(lines).toEqual(["not logged in: acme"])
		expect(face.calls).toEqual(["status:ACME_API_KEY"])
		// The exact-case id hits.
		await runLogout(ctx as any, "Acme")
		expect(face.calls).toEqual(["status:ACME_API_KEY", "status:ACME_API_KEY", "logout:ACME_API_KEY"])
	})

	test("a hand-edited profile's apiKeyEnv drives the probe and the unset — never a derived ref", async () => {
		const face = new RecordingLoginFace()
		face.liveRoutes = [{ id: "deepseek", apiKeyEnv: "MY_HAND_EDITED_REF" }]
		face.configuredRefs = new Set(["MY_HAND_EDITED_REF"])
		const { ctx, lines } = makeLoginCtx({ face, pick: "deepseek", type: [] })
		await runLogout(ctx as any, "")
		expect(face.calls).toEqual(["status:MY_HAND_EDITED_REF", "logout:MY_HAND_EDITED_REF", "route:deepseek:unset"])
		expect(lines).toEqual(["DeepSeek logged out — key + route removed (leaves /model next session)"])
	})

	test("a dead settings seam reports the failure — never 'no logged-in providers'", async () => {
		const face = new RecordingLoginFace()
		face.routesError = new Error("settings service down")
		const { ctx, lines } = makeLoginCtx({ face, type: [] })
		await runLogout(ctx as any, "")
		expect(lines).toEqual(["logout failed — settings service down"])
		expect(face.calls).toEqual([])
	})

	test("a live declared flag keeps the catalog route (key-only logout)", async () => {
		const face = new RecordingLoginFace()
		face.liveRoutes = [{ id: "deepseek", declared: true }]
		face.configuredRefs = new Set(["DEEPSEEK_API_KEY"])
		const { ctx, lines } = makeLoginCtx({ face, pick: "deepseek", type: [] })
		await runLogout(ctx as any, "")
		expect(face.calls).toEqual(["status:DEEPSEEK_API_KEY", "logout:DEEPSEEK_API_KEY"])
		expect(lines).toEqual(["DeepSeek logged out — key removed (route kept)"])
	})

	test("no configured routes degrades to a plain notice", async () => {
		const face = new RecordingLoginFace()
		face.existingRoutes = ["deepseek"]
		const { ctx, lines } = makeLoginCtx({ face, pick: undefined, type: [] })
		await runLogout(ctx as any, "")
		expect(lines).toEqual(["no logged-in providers"])
	})

	test("a failed key unset reports and never touches the route", async () => {
		const face = new RecordingLoginFace()
		face.existingRoutes = ["deepseek"]
		face.configuredRefs = new Set(["DEEPSEEK_API_KEY"])
		face.logoutError = new Error("credentials service down")
		const { ctx, lines } = makeLoginCtx({ face, pick: "deepseek", type: [] })
		await runLogout(ctx as any, "")
		expect(face.calls).toEqual(["status:DEEPSEEK_API_KEY", "logout:DEEPSEEK_API_KEY"])
		expect(lines).toEqual(["deepseek: logout failed — credentials service down"])
	})

	test("a failed route clear keeps the key removal and says so", async () => {
		const face = new RecordingLoginFace()
		face.existingRoutes = ["deepseek"]
		face.configuredRefs = new Set(["DEEPSEEK_API_KEY"])
		face.registerOk = false
		const { ctx, lines } = makeLoginCtx({ face, pick: "deepseek", type: [] })
		await runLogout(ctx as any, "")
		expect(face.calls).toEqual(["status:DEEPSEEK_API_KEY", "logout:DEEPSEEK_API_KEY", "route:deepseek:unset"])
		expect(lines).toEqual([
			"DeepSeek logged out — key removed, but the deepseek route stayed: host settings channel refused the route. "
			+ "Next: fix that settings write (retry after the host recovers) or remove the deepseek route in /settings; no key is stored now.",
		])
	})

	test("degrades to a notice without the seam face", async () => {
		const { ctx, lines } = makeLoginCtx({ face: new RecordingLoginFace(), type: [] })
		await runLogout({ ...ctx, seam: seamWith(undefined) } as any, "")
		expect(lines).toEqual(["/logout unavailable in this session"])
	})

	test("P0-3: a profile mismatch removes neither key nor route", async () => {
		const face = new RecordingLoginFace()
		face.existingRoutes = ["deepseek"]
		face.configuredRefs = new Set(["DEEPSEEK_API_KEY"])
		const { ctx, lines } = makeLoginCtx({ face, pick: "deepseek", type: [] })
		;(ctx as any).seam = seamWithMismatch(face)
		await runLogout(ctx as any, "")
		expect(face.calls).toEqual(["status:DEEPSEEK_API_KEY"])
		expect(lines[0]).toContain("restart dsh-opentui")
	})

	test("P1: a rejecting registerRoute puts the reason and the next step on screen", async () => {
		const face = new RecordingLoginFace()
		face.existingRoutes = ["deepseek"]
		face.configuredRefs = new Set(["DEEPSEEK_API_KEY"])
		face.registerError = new Error("settings channel down")
		const { ctx, lines } = makeLoginCtx({ face, pick: "deepseek", type: [] })
		await runLogout(ctx as any, "")
		expect(lines).toHaveLength(1)
		expect(lines[0]).toContain("settings channel down")
		expect(lines[0]).toContain("Next:")
	})
})

// 025-w2-4 — real provider directory (llm/listProviders + listConfigurableProviders).
describe("/login real provider directory (W2-4)", () => {
	test("catalogEntriesFromDirectory: real rows first, static hint kept for known ids, unknown ids selectable", () => {
		const entries = catalogEntriesFromDirectory(
			[{ id: "deepseek", name: "DeepSeek real" }, { id: "new-provider", name: "New Provider" }],
			[{ provider: "openai", displayName: "OpenAI real" }, { provider: "dormant", displayName: "Dormant", error: "needs key" }],
			PROVIDER_CATALOG,
		)
		const ids = entries.map((e) => e.id)
		expect(ids).toContain("deepseek")
		expect(ids).toContain("new-provider")
		expect(ids).toContain("dormant")
		expect(ids).toContain("openai")
		// known id keeps its richer static hint/name; unknown gets safe defaults.
		expect(entries.find((e) => e.id === "deepseek")!.hint).toBe("api key")
		expect(entries.find((e) => e.id === "new-provider")!.catalogRoute).toBe(true)
		expect(entries.find((e) => e.id === "dormant")!.name).toBe("Dormant")
		expect(new Set(ids).size).toBe(ids.length) // no duplicates
	})

	test("real directory picker uses provider rows; service-absent falls back with notice", async () => {
		const face = new RecordingLoginFace()
		const lines: string[] = []
		const picks: { options: { title: string; value: string }[] }[] = []
		const seam = {
			login: face,
			providerDirectory: {
				registered: async () => [{ id: "real-one", name: "Real One" }],
				configurable: async () => [{ provider: "real-two", displayName: "Real Two" }],
			},
		} as unknown as SessionSeam
		const ctx = {
			seam,
			say: (t: string) => lines.push(t),
			promptText: async () => undefined,
			pickOne: async (title: string, options: { title: string; value: string }[]) => {
				picks.push({ options })
				return picks.length === 1 ? "third-party" : undefined // enter the sub-panel, then esc it
			},
		} as unknown as SlashCommandContext
		const command = coreCommands().find((c) => c.name === "/login")!
		await command.run(ctx, "")
		const values = picks[1]!.options.map((o) => o.value)
		expect(values).not.toContain("custom") // the Custom row moved to the entrance picker
		expect(values).toContain("real-one")
		expect(values).toContain("real-two")
		expect(lines).toEqual([]) // no degrade notice when the real read succeeded

		// Now a seam whose directory calls reject -> static fallback + notice.
		const lines2: string[] = []
		const seam2 = {
			login: face,
			providerDirectory: {
				registered: async () => { throw new Error("UNSUPPORTED") },
				configurable: async () => { throw new Error("UNSUPPORTED") },
			},
		} as unknown as SessionSeam
		const ctx2 = {
			seam: seam2,
			say: (t: string) => lines2.push(t),
			promptText: async () => undefined,
			pickOne: async () => "third-party", // enter the sub-panel; its catalog read degrades
		} as unknown as SlashCommandContext
		await command.run(ctx2, "")
		expect(lines2.some((l) => /directory unavailable|built-in provider/i.test(l))).toBe(true)
	})
})
