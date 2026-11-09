/**
 * Model-route Remote operations for the client-mode session layer
 * (ADR-0005 bucket (b) wave 2; audit rows 21 + 22).
 *
 * Mapping notes against the in-process HostSession (host-session.ts:90-140):
 *
 * - `session/modelCatalog` is the host-generation catalog: provider groups
 *   with models (id/name/reasoning efforts), failures, and `default` — the
 *   ModelSelection unconfigured Sessions start on. That `default` is the
 *   cold-boot label source (row 22): the in-process
 *   `agentDefaultModel.currentSelection()` one-shot has no 1:1 remote; the
 *   catalog default IS that selection's host-side equivalent, and a LIVE
 *   session's effective selection reads from `session/projections`
 *   (modelSelection {lastUsed, pending} → next falls back to lastUsed).
 * - `llm/listConfigurableProviders` / `llm/listProviders` exist but there is
 *   NO remote `llm/listModels` — the per-provider model list comes from the
 *   catalog groups (the /model picker's provider catalog).
 * - `session/selectModel` {sessionId, provider, model, reasoningEffort?}
 *   returns the host-resolved selection. Unlike the in-process switchModel
 *   (which only affected the NEXT session — the live one kept its route),
 *   the wire selection is durable per SESSION: it applies to the session's
 *   NEXT request. The facade applies it to the live session when one exists,
 *   else stages it onto the session the next turn creates.
 *
 * Wire facts (installed closure, dsh 0.2.1-rc.5): ModelCatalog /
 * ModelSelection / SessionProjectionsValue from
 * `dsh-api-session-controller/types`; LlmConfigurableProvider from
 * `dsh-llm/types`.
 */

/** One complete model route (ModelSelection). */
export interface RemoteModelSelection {
	provider: string
	model: string
	reasoningEffort?: string
}

/** One reasoning-effort ladder entry (ModelReasoningEffort). */
export interface RemoteReasoningEffort {
	id: string
	name: string
	description?: string
}

/** One provider group of the host model catalog. */
export interface RemoteModelProviderGroup {
	id: string
	name: string
	models: {
		id: string
		name: string
		/** Max combined request+response context when the catalog discloses
		 * it (dsh-llm model rows); undefined keeps the 🧠 segment degraded. */
		contextWindow?: number
		reasoning?: { efforts: RemoteReasoningEffort[]; defaultEffort?: string }
	}[]
}

/** The host-generation model catalog (ModelCatalog subset the TUI reads). */
export interface RemoteModelCatalog {
	default?: RemoteModelSelection
	routableProviders: string[]
	groups: RemoteModelProviderGroup[]
	failures: { id: string; name: string; message: string }[]
}

/**
 * The token-meter projection's context-pressure row (SessionProjectionsValue.
 * contextPressure on the wire — the fold of the agent-loop `request/context`
 * session events; web contextOccupancy parity): `projectedTokens` is the
 * anchor + increment estimate of the NEXT request's prompt, `pressureTokens`
 * the provider-reported prompt of the LAST request (output excluded), and
 * `contextWindow` the host-resolved window of the live route. All three are
 * optional: a fresh session reports nothing until its first request lands.
 */
export interface RemoteContextPressure {
	contextWindow?: number
	projectedTokens?: number
	pressureTokens?: number
}

/** One `session/projections` answer (the subset the TUI reads). */
export interface RemoteSessionProjections {
	selection?: RemoteModelSelection
	pressure?: RemoteContextPressure
}

export interface RemoteModelOptions {
	rpc(method: string, args?: Record<string, unknown>): Promise<unknown>
}

export class RemoteModelClient {
	readonly #rpc: RemoteModelOptions["rpc"]
	#catalog: RemoteModelCatalog | undefined

	constructor(options: RemoteModelOptions) {
		this.#rpc = options.rpc
	}

	/**
	 * The host model catalog. Cached: the host list is static between route
	 * commits (host-session.ts listProviders cache parity); `force` re-reads.
	 * The cache is ALSO invalidated by the session facade on every route-
	 * affecting event (credentials set/unset, settings mutations, and the
	 * `settings/document-updated` / `credentials/reference-updated` pushes) —
	 * the host recomputes `session/modelCatalog` per call, so after a
	 * /logout the provider only survived here, in this cache.
	 */
	async modelCatalog(force = false): Promise<RemoteModelCatalog> {
		if (this.#catalog && !force) return this.#catalog
		const value = (await this.#rpc("session/modelCatalog")) as Record<string, unknown>
		const groups = Array.isArray(value.groups) ? value.groups : []
		const failures = Array.isArray(value.failures) ? value.failures : []
		const routable = Array.isArray(value.routableProviders) ? value.routableProviders : []
		this.#catalog = {
			default: asSelection(value.default),
			routableProviders: routable.map(String),
			groups: groups.map((g) => {
				const group = (typeof g === "object" && g !== null ? g : {}) as Record<string, unknown>
				const models = Array.isArray(group.models) ? group.models : []
				return {
					id: String(group.id ?? ""),
					name: String(group.name ?? group.id ?? ""),
					models: models.map((m) => {
						const model = (typeof m === "object" && m !== null ? m : {}) as Record<string, unknown>
						const reasoning = (typeof model.reasoning === "object" && model.reasoning !== null ? model.reasoning : null) as Record<string, unknown> | null
						const efforts = reasoning && Array.isArray(reasoning.efforts) ? reasoning.efforts : []
						return {
							id: String(model.id ?? ""),
							name: String(model.name ?? model.id ?? ""),
							// contextWindow passthrough (footer context batch): the
							// dsh-llm catalog model rows carry it when disclosed; the
							// 🧠 segment degrades to the bare `used` shape without.
							...(typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}),
							...(reasoning
								? {
										reasoning: {
											efforts: efforts.map((e) => {
												const effort = (typeof e === "object" && e !== null ? e : {}) as Record<string, unknown>
												return {
													id: String(effort.id ?? ""),
													name: String(effort.name ?? effort.id ?? ""),
													...(typeof effort.description === "string" ? { description: effort.description } : {}),
												}
											}),
											...(typeof reasoning.defaultEffort === "string" ? { defaultEffort: reasoning.defaultEffort } : {}),
										},
									}
								: {}),
						}
					}),
				}
			}),
			failures: failures.map((f) => {
				const failure = (typeof f === "object" && f !== null ? f : {}) as Record<string, unknown>
				return { id: String(failure.id ?? ""), name: String(failure.name ?? failure.id ?? ""), message: String(failure.message ?? "") }
			}),
		}
		return this.#catalog
	}

	/** Drop the cached catalog: the next read re-fetches the host answer. */
	invalidate(): void {
		this.#catalog = undefined
	}

	/** The catalog's default route — the cold-boot label source (row 22). */
	async defaultSelection(): Promise<RemoteModelSelection | undefined> {
		return (await this.modelCatalog()).default
	}

	/**
	 * Provider catalog as the host sees it (host-session.listProviders shape
	 * parity): provider id + model ids. The model list comes from the catalog
	 * groups — no remote `llm/listModels` exists.
	 */
	async listProviders(): Promise<{ provider: string; models: string[] }[]> {
		const catalog = await this.modelCatalog()
		return catalog.groups
			.filter((g) => g.id)
			.map((g) => ({ provider: g.id, models: g.models.map((m) => m.id).filter(Boolean) }))
	}

	/**
	 * One route's context window (footer context batch — the tui-pi
	 * `llm.resolveModelInfo(...).context.contextWindow` stand-in): the
	 * catalog model row's disclosed `contextWindow`, served from the cached
	 * catalog (no extra RPC beyond the first fill). Undefined when the
	 * catalog doesn't name the route or the row omits the window — callers
	 * degrade gracefully.
	 */
	async modelContextWindow(provider: string, model: string): Promise<number | undefined> {
		const catalog = await this.modelCatalog()
		const row = catalog.groups.find((g) => g.id === provider)?.models.find((m) => m.id === model)
		return typeof row?.contextWindow === "number" && row.contextWindow > 0 ? row.contextWindow : undefined
	}

	/** Routes configurable through settings (raw LlmConfigurableProvider rows). */
	async configurableProviders(): Promise<Record<string, unknown>[]> {
		const value = (await this.#rpc("llm/listConfigurableProviders")) as unknown
		return Array.isArray(value) ? (value as Record<string, unknown>[]) : []
	}

	/** Registered provider display rows (raw LlmProviderInfo[]). */
	async providerInfos(): Promise<{ id: string; name: string }[]> {
		const value = (await this.#rpc("llm/listProviders")) as unknown
		return (Array.isArray(value) ? value : [])
			.map((p) => {
				const row = (typeof p === "object" && p !== null ? p : {}) as Record<string, unknown>
				return { id: String(row.id ?? ""), name: String(row.name ?? row.id ?? "") }
			})
			.filter((p) => p.id)
	}

	/**
	 * Select the model route for one session (`session/selectModel`); the
	 * host's resolved acceptance comes back (row 21 round-trip).
	 */
	async selectModel(sessionId: string, selection: RemoteModelSelection): Promise<RemoteModelSelection> {
		const value = (await this.#rpc("session/selectModel", {
			request: {
				sessionId,
				provider: selection.provider,
				model: selection.model,
				...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
			},
		})) as Record<string, unknown>
		const selected = asSelection(value.selected)
		if (!selected) throw new Error("session/selectModel returned no selection")
		return selected
	}

	/**
	 * One session's projections in a single round-trip (row 22 live-side +
	 * the footer context batch): `session/projections` → values.modelSelection
	 * (next folds pending→lastUsed host-side) and values.contextPressure
	 * (token-meter fold — the web contextOccupancy source). Either entry is
	 * absent when the projection is missing (cold/unavailable session).
	 */
	async sessionProjections(sessionId: string): Promise<RemoteSessionProjections> {
		const value = (await this.#rpc("session/projections", { request: { sessionId } })) as Record<string, unknown> | null
		if (!value || typeof value !== "object") return {}
		const values = (value.values ?? {}) as Record<string, unknown>
		const selection = asProjectionSelection(values.modelSelection)
		const pressure = asContextPressure(values.contextPressure)
		return {
			...(selection ? { selection } : {}),
			...(pressure ? { pressure } : {}),
		}
	}

	/**
	 * One session's effective model route (row 22 live-side):
	 * `session/projections` → modelSelection.next. Undefined when the
	 * projection is absent (cold/unavailable).
	 */
	async sessionSelection(sessionId: string): Promise<RemoteModelSelection | undefined> {
		return (await this.sessionProjections(sessionId)).selection
	}

	/** Ask the host to resolve the default model route (boot-time helper). */
	async initializeDefaultModel(): Promise<void> {
		await this.#rpc("session/initializeDefaultModel")
	}
}

function asSelection(value: unknown): RemoteModelSelection | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
	const row = value as Record<string, unknown>
	const provider = typeof row.provider === "string" ? row.provider : ""
	const model = typeof row.model === "string" ? row.model : ""
	if (!provider || !model) return undefined
	return {
		provider,
		model,
		...(typeof row.reasoningEffort === "string" && row.reasoningEffort ? { reasoningEffort: row.reasoningEffort } : {}),
	}
}

/** The modelSelection projection row (next folds pending→lastUsed host-side;
 * accept both spellings defensively). */
function asProjectionSelection(value: unknown): RemoteModelSelection | undefined {
	if (!value || typeof value !== "object") return undefined
	const projection = value as Record<string, unknown>
	return asSelection(projection.next) ?? asSelection(projection.lastUsed) ?? asSelection(projection.pending)
}

/**
 * The contextPressure projection row (web parity). A field lands only when
 * it is a finite non-negative number (a negative/garbage value reads as
 * "absent" so the caller's fallback chain stays clean); contextWindow must
 * additionally be positive — 0 is never a usable denominator.
 */
function asContextPressure(value: unknown): RemoteContextPressure | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
	const row = value as Record<string, unknown>
	const token = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined)
	const window = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined)
	const contextWindow = window(row.contextWindow)
	const projectedTokens = token(row.projectedTokens)
	const pressureTokens = token(row.pressureTokens)
	if (contextWindow === undefined && projectedTokens === undefined && pressureTokens === undefined) return undefined
	return {
		...(contextWindow !== undefined ? { contextWindow } : {}),
		...(projectedTokens !== undefined ? { projectedTokens } : {}),
		...(pressureTokens !== undefined ? { pressureTokens } : {}),
	}
}
