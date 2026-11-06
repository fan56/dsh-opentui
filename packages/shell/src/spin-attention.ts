/**
 * The spin attention source — the session facade's OWN jev layer (batch: the
 * verdict feed for the spin-detected early stop). Ported from dsh-tui-pi's
 * attention-jev.ts (ticket 04), narrowed to the spin question only.
 *
 * Why not the dispatch plugin's verdicts.ndjson: the mounted
 * `@aiwayds/dsh-agent-dispatch` chain (process-internal, cordis) has no
 * service/event face to subscribe to, and its verdict log cannot serve the
 * ladder — `skipSubagentSessions` (default on, and the e2e bake sets only
 * `mode` + `logDir`) skips every child turn before the keyword gate, so rows
 * exist only for parent turns and carry no child linkage (the row's
 * `session` is the parent's). The plugin host half deliberately exposes
 * nothing else. The verdict log stays what it was built to be: a calibration
 * surface for the dispatch rubric, not a side channel.
 *
 * So the source asks jev itself, exactly like the reference: every debounce
 * window, ONE classify call batches one atomic noul question per live
 * running child (`spin_<id8>` — productive vs circling) over a compact state
 * table, and the scores are read back onto child ids through the id8 map and
 * pushed to `onVerdict` (HostSession.noteChildSpinVerdict → the round
 * policy's spin streak). `@aiwayds/dsh-jev-core` resolves from the profile
 * node_modules (the bake pins it at the profile root for exactly this
 * "76-style probe") and honors JEV_ENDPOINT / TYPESAFE_API_KEY from the host
 * process env — the same consumption chain the dispatch plugin rides.
 *
 * jev-optional by construction: the source ticks silently when the settings
 * knob is off, the core probe fails, no key is configured, the debounce
 * window is open, another call is in flight, or nothing is live — a failed
 * call is a silent counter bump, never a warn. Without a verdict trail the
 * ladder below is byte-for-byte the classic one.
 */

/** Minimum gap between spin dispatches (reference ticket 04: global debounce 30s). */
export const SPIN_JEV_MIN_INTERVAL_MS = 30_000
/** Per-call deadline: advisory data, generous but bounded. */
export const SPIN_JEV_TIMEOUT_MS = 8_000
/** State table size guard (reference ticket 04; hard cap keeps runaway labels bounded). */
export const SPIN_STATE_MAX_CHARS = 1_000
export const SPIN_LABEL_MAX_CHARS = 40

/** Structural slice of @aiwayds/dsh-jev-core — type-only, erased at runtime. */
export interface JevCoreModule {
	classify(options: {
		questions: Record<string, { type: "noul"; criteria: Record<string, string> }>
		state: string
		env?: NodeJS.ProcessEnv
		timeoutMs?: number
		fetchImpl?: typeof fetch
	}): Promise<{ answers: Record<string, { kind: "noul"; value: number }>; model: string; usage: unknown; latencyMs: number }>
	isConfigured(sources?: { env?: NodeJS.ProcessEnv }): boolean
}

/** Probe the core once per process; a failed import degrades to classic-ladder-only. */
async function loadJevCore(): Promise<JevCoreModule | null> {
	// The specifier is held in a variable on purpose: the package is a
	// runtime capability probe (resolved from the profile node_modules), not
	// a compile-time dependency of this repo.
	const specifier = "@aiwayds/dsh-jev-core"
	try {
		const mod = (await import(/* @vite-ignore */ specifier)) as unknown as Record<string, unknown>
		if (typeof mod["classify"] !== "function" || typeof mod["isConfigured"] !== "function") return null
		return mod as unknown as JevCoreModule
	} catch {
		return null
	}
}

/** One live child as the source sees it (the facade's child view, narrowed). */
export interface SpinChildView {
	childId: string
	label: string
	rounds: number
	/** Whether the child is still running (settled children are never asked). */
	running: boolean
	/** Wall clock the child started (for the state table's elapsed column). */
	startedAt?: number
}

/** One atomic noul question per child, keyed by its id8. */
export function buildSpinQuestions(id8s: readonly string[]): Record<string, { type: "noul"; criteria: Record<string, string> }> {
	const questions: Record<string, { type: "noul"; criteria: Record<string, string> }> = {}
	for (const id8 of id8s) {
		questions[`spin_${id8}`] = {
			type: "noul",
			criteria: {
				true: "work is UNPRODUCTIVE — repeating the same tools or circling without forward motion",
				false: "work is productive — measurable forward progress",
			},
		}
	}
	return questions
}

/** The shared state table: one compact line per child, the fact the question judges. */
export function buildSpinState(views: readonly SpinChildView[], cap: number, now: number): string {
	const lines = views.map((view) => {
		const parts = [
			`${view.childId.slice(0, 8)} ${view.label.slice(0, SPIN_LABEL_MAX_CHARS)}`,
			`rounds ${view.rounds}/${cap > 0 ? cap : "∞"}`,
			...(view.startedAt !== undefined ? [`elapsed ${Math.round(Math.max(0, now - view.startedAt) / 1000)}s`] : []),
		]
		return `- ${parts.join(" | ")}`
	})
	const head = "Subagents under supervision; judge each child on the question keyed by its id."
	return `${head}\n${lines.join("\n")}`.slice(0, SPIN_STATE_MAX_CHARS)
}

/** Read the verdict map back onto child ids (first-wins on an id8 collision — uuid4 id8 collisions are astronomic). */
export function parseSpinAnswers(
	answers: Record<string, { value: number }>,
	id8ToChild: ReadonlyMap<string, string>,
): [childId: string, score: number][] {
	const out: [string, number][] = []
	for (const [id8, childId] of id8ToChild) {
		const answer = answers[`spin_${id8}`]
		if (answer === undefined || typeof answer.value !== "number" || !Number.isFinite(answer.value)) continue
		out.push([childId, answer.value])
	}
	return out
}

/** The `dsh-opentui` settings knob: `spinAttention: false` in the namespace
 * value turns the source off; absent/anything else keeps it on (it is still
 * silent without a configured key — unconfigured == off, dispatch parity). */
export function spinAttentionEnabled(value: unknown): boolean {
	if (value === null || typeof value !== "object") return true
	return (value as Record<string, unknown>).spinAttention !== false
}

export function spinAttentionEnabledFromRows(rows: readonly { ns?: unknown; value?: unknown }[]): boolean {
	for (const row of rows) {
		if (row?.ns === "dsh-opentui") return spinAttentionEnabled(row.value)
	}
	return true
}

export interface SpinAttentionOptions {
	/** Live settings read — hot-applies the `spinAttention` toggle with no restart. */
	enabledReader: () => boolean
	/** Verdict sink: one fresh noul score per child per dispatch. The facade
	 * forwards to noteChildSpinVerdict (the streak trail dedupes nothing here
	 * — each call's answers ARE the fresh verdicts; the debounce is the
	 * replay guard). */
	onVerdict(childId: string, score: number): void
	/** Test seam: inject the core module directly, skipping the runtime probe. */
	module?: JevCoreModule | null
	env?: NodeJS.ProcessEnv
	now?: () => number
	minIntervalMs?: number
}

export interface SpinAttentionSource {
	/** Driven from the facade's child-event fold (a looping child fires
	 * events every round, which is exactly the tick cadence the ladder
	 * needs); self-serializing, debounced, fire-and-forget. `cap` is the
	 * settings-resolved maxRounds for the state table. */
	tick(views: readonly SpinChildView[], cap: number): void
	/** Failed-call counter (diagnostics; the feed itself never surfaces errors). */
	failures(): number
}

export function createSpinAttentionSource(options: SpinAttentionOptions): SpinAttentionSource {
	const now = options.now ?? Date.now
	const minIntervalMs = options.minIntervalMs ?? SPIN_JEV_MIN_INTERVAL_MS
	const env = options.env ?? process.env
	let core: JevCoreModule | null | undefined
	let loading: Promise<JevCoreModule | null> | undefined
	let lastDispatchAt = -Infinity
	let inFlight = false
	let failureCount = 0

	const ensureLoaded = (): Promise<JevCoreModule | null> => {
		if (options.module !== undefined) return Promise.resolve(options.module)
		if (core !== undefined) return Promise.resolve(core)
		loading ??= loadJevCore().then((mod) => {
			core = mod
			return mod
		})
		return loading
	}

	return {
		failures: () => failureCount,
		tick(views, cap) {
			if (inFlight) return
			if (!options.enabledReader()) return
			const live = views.filter((view) => view.running && view.childId)
			if (live.length === 0) return
			const at = now()
			if (at - lastDispatchAt < minIntervalMs) return
			void ensureLoaded().then((mod) => {
				if (mod === null) return
				if (!mod.isConfigured({ env })) return
				// Fresh live/running filter at dispatch time (a child may have
				// settled while the probe loaded).
				const running = views.filter((view) => view.running && view.childId)
				if (running.length === 0) return
				const id8ToChild = new Map(running.map((view) => [view.childId.slice(0, 8), view.childId]))
				const questions = buildSpinQuestions([...id8ToChild.keys()])
				const state = buildSpinState(running, cap, now())
				if (state.trim() === "") return
				inFlight = true
				lastDispatchAt = at
				mod.classify({ questions, state, env, timeoutMs: SPIN_JEV_TIMEOUT_MS })
					.then((result) => {
						for (const [childId, score] of parseSpinAnswers(result.answers, id8ToChild)) {
							try {
								options.onVerdict(childId, score)
							} catch {
								/* a sink failure must not touch the trail */
							}
						}
					})
					.catch(() => {
						failureCount += 1
					})
					.finally(() => {
						inFlight = false
					})
			})
		},
	}
}
