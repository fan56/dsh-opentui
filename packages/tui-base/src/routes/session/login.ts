/**
 * /login pure layer (batch H4, tui-pi 65-ux-batch parity). Ported from the
 * old-stack features/login.tsx (deleted in the ADR-0006 cutover, commit
 * 7d5448a) — the flat provider catalog, the derived key-ref and the
 * llm-pi-ai route profile — plus the six-step custom-provider chain the
 * reference scenario drives (1 route id → 2 display name → 3 protocol →
 * 4 base URL → 5 models → 6 API key). Everything here is pure and
 * table-testable; the /login command (commands.ts) drives it through
 * ctx.pickOne / ctx.promptText and the seam's `login` face.
 */

export interface CatalogEntry {
	id: string
	name: string
	hint: string
	catalogRoute: boolean
	api?: string
	baseURL?: string
	models?: readonly { id: string; name?: string }[]
	displayName?: string
}

/** The flat provider catalog (old-stack PROVIDER_CATALOG, verbatim ids). */
export const PROVIDER_CATALOG: CatalogEntry[] = [
	{ id: "amazon-bedrock", name: "Amazon Bedrock", hint: "aws route", catalogRoute: true },
	{ id: "ant-ling", name: "Ant Ling", hint: "api key", catalogRoute: true },
	{ id: "anthropic", name: "Anthropic", hint: "api key", catalogRoute: true },
	{ id: "azure-openai-responses", name: "Azure OpenAI", hint: "api key", catalogRoute: true },
	{ id: "cerebras", name: "Cerebras", hint: "api key", catalogRoute: true },
	{ id: "cloudflare-ai-gateway", name: "Cloudflare AI Gateway", hint: "api key", catalogRoute: true },
	{ id: "cloudflare-workers-ai", name: "Cloudflare Workers AI", hint: "api key", catalogRoute: true },
	{ id: "deepseek", name: "DeepSeek", hint: "api key", catalogRoute: true },
	{ id: "fireworks", name: "Fireworks", hint: "api key", catalogRoute: true },
	{ id: "github-copilot", name: "GitHub Copilot", hint: "provcatalog.hint.copilot", catalogRoute: true },
	{ id: "google", name: "Google Gemini", hint: "api key", catalogRoute: true },
	{ id: "google-vertex", name: "Google Vertex AI", hint: "provcatalog.hint.googleCloud", catalogRoute: true },
	{ id: "groq", name: "Groq", hint: "api key", catalogRoute: true },
	{ id: "huggingface", name: "Hugging Face", hint: "provcatalog.hint.huggingface", catalogRoute: true },
	{ id: "kimi-coding", name: "Kimi For Coding", hint: "api key", catalogRoute: true },
	{ id: "minimax", name: "MiniMax", hint: "api key", catalogRoute: true },
	{ id: "minimax-cn", name: "MiniMax CN", hint: "api key", catalogRoute: true },
	{ id: "mistral", name: "Mistral", hint: "api key", catalogRoute: true },
	{ id: "moonshotai", name: "Moonshot AI", hint: "api key", catalogRoute: true },
	{ id: "moonshotai-cn", name: "Moonshot AI CN", hint: "api key", catalogRoute: true },
	{ id: "nvidia", name: "NVIDIA", hint: "api key", catalogRoute: true },
	{ id: "openai", name: "OpenAI", hint: "api key", catalogRoute: true },
	{ id: "opencode-go", name: "OpenCode Go", hint: "api key.gateway", catalogRoute: true },
	{ id: "opencode", name: "OpenCode Zen", hint: "api key", catalogRoute: true },
	{ id: "openrouter", name: "OpenRouter", hint: "api key", catalogRoute: true },
	{ id: "qwen-token-plan", name: "Qwen Token Plan", hint: "api key", catalogRoute: true },
	{ id: "qwen-token-plan-cn", name: "Qwen Token Plan CN", hint: "api key", catalogRoute: true },
	{ id: "together", name: "Together AI", hint: "api key", catalogRoute: true },
	{ id: "vercel-ai-gateway", name: "Vercel AI Gateway", hint: "api key", catalogRoute: true },
	{ id: "xiaomi", name: "Xiaomi", hint: "api key", catalogRoute: true },
	{ id: "xiaomi-token-plan-ams", name: "Xiaomi Token Plan AMS", hint: "api key", catalogRoute: true },
	{ id: "xiaomi-token-plan-cn", name: "Xiaomi Token Plan CN", hint: "api key", catalogRoute: true },
	{ id: "xiaomi-token-plan-sgp", name: "Xiaomi Token Plan SGP", hint: "api key", catalogRoute: true },
	{ id: "zai", name: "Z.AI", hint: "api key", catalogRoute: true },
	{ id: "zai-coding-cn", name: "Z.AI Coding CN", hint: "api key", catalogRoute: true },
	{ id: "xai", name: "xAI", hint: "api key", catalogRoute: true },
]

/** The hand-declared picker row (the six-step chained form's entry). */
export const CUSTOM_ENTRY: CatalogEntry = { id: "custom", name: "Custom provider", hint: "baseUrl + model + key", catalogRoute: false }

/** Picker title (the reference marker the scenario waits on). */
export const LOGIN_PICKER_TITLE = "Add provider"

/** The six chained steps' titles (1/6..6/6 markers) + optional/skip flags. */
export const CUSTOM_STEPS: { title: string; optional: boolean; mask: boolean }[] = [
	{ title: "Custom provider 1/6 — route id", optional: false, mask: false },
	{ title: "Custom provider 2/6 — display name", optional: true, mask: false },
	{ title: "Custom provider 3/6 — protocol (default openai-completions)", optional: true, mask: false },
	{ title: "Custom provider 4/6 — base URL", optional: false, mask: false },
	{ title: "Custom provider 5/6 — models (comma-separated)", optional: false, mask: false },
	{ title: "Custom provider 6/6 — API key (secret, never echoed)", optional: false, mask: true },
]

/** The env-ref one provider's key is stored under (old-stack deriveKeyRef). */
export function deriveKeyRef(provider: string): string {
	return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`
}

/** The llm-pi-ai profile for one catalog entry (old-stack providerProfileFor). */
export function providerProfileFor(entry: CatalogEntry): Record<string, unknown> {
	const profile: Record<string, unknown> = { apiKeyEnv: deriveKeyRef(entry.id) }
	if (!entry.catalogRoute) {
		if (entry.api) profile.api = entry.api
		if (entry.baseURL) profile.baseURL = entry.baseURL
		if (entry.models) profile.models = entry.models
		if (entry.displayName) profile.displayName = entry.displayName
	}
	return profile
}

/**
 * Step-1 validation: a non-empty slug that does not collide with an
 * already-registered route. Returns the inline error (the reference's
 * "already exists" marker) or undefined.
 */
export function validateRouteId(id: string, existingRoutes: readonly string[]): string | undefined {
	const value = id.trim()
	if (!value) return "route id is required"
	if (/[^A-Za-z0-9_-]/.test(value)) return "route id: letters, digits, - and _ only"
	if (existingRoutes.includes(value)) return `route id "${value}" already exists`
	return undefined
}

/**
 * Step-4 validation: the base URL must be an http(s) URL (the reference's
 * "an invalid base URL keeps step 4 with the inline error" arm — the
 * assertion greps 'http' in the pane, the error names the scheme).
 */
export function validateBaseUrl(url: string): string | undefined {
	const value = url.trim()
	if (!value) return "base URL is required"
	if (!/^https?:\/\/\S+$/.test(value)) return "base URL must start with http:// or https://"
	return undefined
}

/** Compose the hand-declared CatalogEntry from the six committed answers. */
export function buildCustomEntry(answers: {
	routeId: string
	displayName?: string
	protocol?: string
	baseURL: string
	models: string
}): CatalogEntry {
	const id = answers.routeId.trim()
	return {
		id,
		name: answers.displayName?.trim() || id,
		hint: "custom",
		catalogRoute: false,
		api: answers.protocol?.trim() || "openai-completions",
		baseURL: answers.baseURL.trim(),
		models: answers.models
			.split(",")
			.map((m) => ({ id: m.trim() }))
			.filter((m) => m.id),
		displayName: answers.displayName?.trim() || id,
	}
}
