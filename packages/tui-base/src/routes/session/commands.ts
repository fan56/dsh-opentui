/**
 * Slash-command registry (batch 8) — the rebuilt replacement for the old
 * `ShellHost` COMMANDS table + runCommand switch (the cutover delete
 * target; nothing here imports it).
 *
 * Shape: a simple table of `{ name, description, run }`. `run` receives a
 * `SlashCommandContext` the page supplies (seam + the host-side effects a
 * command can ask for: transcript feedback rows, client-side clear, reload,
 * quit, and one generic modal picker). Commands stay UI-free except through
 * those hooks, so the registry is table-testable without a renderer.
 *
 * Batch 8 carries the Q5 minimal face exactly: /help /new /model /quit
 * /sessions /clear, plus /btw (feature batch F3). Later commands (/attach …)
 * are POST-CUTOVER fill — absent from the table, not stubbed.
 *
 * Dispatch vocabulary (old ShellHost parity):
 *   "/model provider/id"  → argument form runs directly
 *   "/nope"               → "unknown command" (a harmless error row, NOT a
 *                            send to the model)
 *   plain text            → not a command; caller sends/steers as batch 4
 */
import type { SeamPresetRow, SessionSeam } from "../../seams/session"
import { hotkeyRows, hotkeysHeader } from "./hotkeys"
import { emptyFilteredCopy, filterSessionsBySizeFloor, resumePickerOptions } from "./resume-picker"
import { formatSessionInfoPanel, sessionInfoRows } from "./session-info"
import {
	CUSTOM_ENTRY,
	CUSTOM_STEPS,
	LOGIN_PICKER_TITLE,
	PROVIDER_CATALOG,
	buildCustomEntry,
	deriveKeyRef,
	providerProfileFor,
	validateBaseUrl,
	validateRouteId,
	type CatalogEntry,
} from "./login"
import {
	hintsShown,
	setHintsShown,
	footerHints,
	setFooterHints,
	hintsLocale,
	setHintsLocale,
	hintInState,
	DEFAULT_FOOTER_HINTS,
	FOOTER_HINT_IDS,
	HINT_LOCALES,
	type FooterHints,
	type HintSegmentId,
} from "./hints-line"
import { getMotionTier, setMotionTier, type MotionTier } from "../../skin/motion"

/**
 * Persist the hint-bar selection after a /hints mutation (/motion parity):
 * the FULL record + locale ride the profile config.json (`footerHints` /
 * `hintsLocale` keys — configSave routes unlisted keys to the profile), so
 * a restart replays them (hints-line.tsx applyHintsConfig at boot). The
 * bar toggle (`hintsShown`) stays session-scoped. Best-effort: a failed
 * write keeps this session's state and logs.
 */
function persistHints(seam: SessionSeam): void {
	try {
		seam.configSave?.({ footerHints: footerHints(), hintsLocale: hintsLocale() })
	} catch (error) {
		console.error("[commands] hints persist failed:", error)
	}
}

/** One registry row: name carries the leading slash ("/help"). */
export interface SlashCommand {
	name: string
	description: string
	run(ctx: SlashCommandContext, argText: string): void | Promise<void>
}

/** Host-side effects a command may ask for; the page owns each hook. */
export interface SlashCommandContext {
	seam: SessionSeam
	/** Append a system-style line to the transcript view (command feedback). */
	say(text: string): void
	/** Client-side transcript reset (/clear). */
	clear(): void
	/** Re-hydrate the transcript from the seam (/new, /sessions resume).
	 * May return a settle promise; commands awaiting it can append rows
	 * AFTER the re-hydrate instead of being wiped by it. */
	reload(): void | Promise<void>
	/** Exit the app (/quit). */
	quit(): void
	/**
	 * One generic modal picker (the vendored dialog-select through the page's
	 * overlay host). Resolves the picked value, or undefined on esc/cancel.
	 * `headerLine` (G1 resume-picker batch) paints an aligned column-header
	 * line under the dialog title (the /sessions UPDATED/DIR columns).
	 */
	pickOne(
		title: string,
		options: { title: string; value: string; description?: string }[],
		headerLine?: string,
		/** α skin layer: marks the active row with the vendored `●` current
		 * marker without moving the selection off row 0. */
		currentValue?: string,
	): Promise<string | undefined>
	/**
	 * One generic modal text prompt (the DialogPrompt modal through the
	 * page's overlay host, batch H4 — the subagents-picker steer precedent,
	 * DialogPrompt stepping). Resolves the committed text, or undefined on
	 * esc/cancel. `mask` marks a secret step: callers keep the value out of
	 * the transcript and every persisted surface (the title carries the
	 * masked note; the textarea itself paints plaintext).
	 */
	promptText?(
		title: string,
		opts?: { placeholder?: string; mask?: boolean; initial?: string },
	): Promise<string | undefined>
	/**
	 * Open the /btw side-question overlay (feature batch F3). Optional: an
	 * entry without the overlay host gets the "unavailable" notice.
	 */
	openBtw?(argText: string): void
	/**
	 * Theme-switch surface (batch F7a): the page's ThemeSeam slice. Optional
	 * — an entry without it gets the "unavailable" notice.
	 */
	themes?: {
		current(): string
		list(): string[]
		set(name: string): boolean
		/** α skin layer: dark/light/auto mode face. Optional — an entry
		 * without it keeps the theme-only picker (legacy hosts). */
		mode?(): {
			current(): "auto" | "dark" | "light"
			set(mode: "auto" | "dark" | "light"): boolean
		}
	}
	/**
	 * Open the cross-session FTS search overlay (batch H3). Optional — an
	 * entry without it gets the "unavailable" notice.
	 */
	openSearch?(): void
	/**
	 * Open the plugins manager panel (batch H3 — the /plugins panel upgrade).
	 * Optional — an entry without it keeps the F7a transcript listing.
	 */
	openPlugins?(): void
}

// ---------------------------------------------------------- /preset helpers --
// Batch H2 (tui-pi 60-preset parity). Pure — table-testable like the
// resume-picker helpers.

/**
 * The row `/preset next` would switch to — the roster item after the current
 * selection, wrapping around (tui-pi peekNextPreset semantics). Undefined
 * with 0 or 1 rows (nothing to rotate to). When nothing is current (no
 * session attached yet, or the selection is not in the roster) the anchor is
 * the registry-default row, falling back to the first-listed one.
 */
export function presetNextRow(rows: SeamPresetRow[], currentId: string | undefined): SeamPresetRow | undefined {
	if (rows.length <= 1) return undefined
	const anchorId =
		currentId ?? rows.find((row) => row.isDefault)?.id ?? rows[0]?.id
	const index = rows.findIndex((row) => row.id === anchorId)
	if (index < 0) return rows[0]
	return rows[(index + 1) % rows.length]
}

/** Find a preset by id or display name, case-insensitive (tui-pi
 * findPresetByName semantics, officialName folded into the name). */
export function findPresetRow(rows: SeamPresetRow[], query: string): SeamPresetRow | undefined {
	const needle = query.trim().toLowerCase()
	if (needle === "") return undefined
	return rows.find((row) => row.id.toLowerCase() === needle || row.name.toLowerCase() === needle)
}

// ----------------------------------------------------------- /login helpers --
// Batch H4 (tui-pi 65-ux-batch parity). The commit is the old-stack
// double-write; the chain is the six-step loop. Exported for table tests.

export interface LoginFace {
	credentialStatus(ref: string): Promise<{ configured: boolean }>
	login(ref: string, apiKey: string): Promise<void>
	logout(ref: string): Promise<void>
	routes(): Promise<string[]>
	registerRoute(providerId: string, profile: Record<string, unknown> | undefined): Promise<boolean>
}

/** A step title with an inline validation error appended (re-prompt view). */
export function loginStepTitle(stepTitle: string, error?: string): string {
	return error ? `${stepTitle} — ${error}` : stepTitle
}

/**
 * The commit half both flows share (old-stack commitLogin): register the
 * route through the settings seam first, then store the key through the
 * credentials seam. Route failure keeps the key unstored (no garbage
 * credential without its route).
 */
export async function commitLoginRoute(
	say: (text: string) => void,
	face: LoginFace,
	entry: CatalogEntry,
	key: string,
): Promise<void> {
	// The old stack's empty-commit guard: an empty key fired a credentials.set
	// the host rejects AND registered a garbage route. An empty key is a
	// swallowed no-op (esc stays the cancel path).
	if (!key.trim()) {
		say("login cancelled — empty key")
		return
	}
	const registered = await face.registerRoute(entry.id, providerProfileFor(entry))
	if (!registered) {
		say(`${entry.id}: route registration failed — key not stored`)
		return
	}
	try {
		await face.login(deriveKeyRef(entry.id), key)
	} catch (e) {
		say(`${entry.id}: key store failed — ${String(e instanceof Error ? e.message : e).slice(0, 150)}`)
		return
	}
	say(`${entry.name} subscribed — key stored, route registered (in /model next session)`)
}

/** The masked key step + commit for a catalog provider. */
export async function commitCatalogLogin(
	ctx: Pick<SlashCommandContext, "promptText" | "say">,
	face: LoginFace,
	entry: CatalogEntry,
): Promise<void> {
	const key = await ctx.promptText?.(`API key for ${entry.name} (${deriveKeyRef(entry.id)})`, { mask: true })
	if (key === undefined) return
	await commitLoginRoute(ctx.say, face, entry, key)
}

/**
 * The six-step chained form (the reference 65 flow). Each step re-prompts
 * on an invalid value (the inline error rides the title); esc at any step
 * aborts the WHOLE flow; the optional steps (2 display name, 3 protocol)
 * commit on an empty Enter with their defaults.
 */
export async function runCustomLoginChain(
	ctx: Pick<SlashCommandContext, "promptText" | "say">,
	face: LoginFace,
	existingRoutes: string[],
): Promise<void> {
	const answers: { routeId?: string; displayName?: string; protocol?: string; baseURL?: string; models?: string } = {}
	for (let step = 0; step < CUSTOM_STEPS.length; step++) {
		const def = CUSTOM_STEPS[step]!
		// Per-step validation loop: an invalid value re-prompts the SAME step
		// with the error inline (the reference's "keeps the form on step N"
		// arms). undefined (esc) abandons the whole flow.
		let error: string | undefined
		let value: string | undefined
		for (;;) {
			value = await ctx.promptText?.(loginStepTitle(def.title, error), { mask: def.mask })
			if (value === undefined) {
				ctx.say("login cancelled")
				return
			}
			const trimmed = value.trim()
			if (!trimmed && def.optional) break
			if (!trimmed && !def.optional) {
				error = "this field is required"
				continue
			}
			if (step === 0) error = validateRouteId(trimmed, existingRoutes)
			else if (step === 3) error = validateBaseUrl(trimmed)
			else error = undefined
			if (!error) break
		}
		const trimmed = value!.trim()
		if (step === 0) answers.routeId = trimmed
		else if (step === 1) answers.displayName = trimmed
		else if (step === 2) answers.protocol = trimmed
		else if (step === 3) answers.baseURL = trimmed
		else if (step === 4) answers.models = trimmed
		else {
			// step 6 — the masked key; the commit consumes it directly.
			const entry = buildCustomEntry(answers as { routeId: string; baseURL: string; models: string })
			await commitLoginRoute(ctx.say, face, entry, trimmed)
			return
		}
	}
}

/** The batch-8 core set, bound to a context at call time (pure table). */
export function coreCommands(): SlashCommand[] {
	return [
		{
			name: "/help",
			description: "show available commands",
			run(ctx) {
				for (const command of coreCommands()) ctx.say(`${command.name} — ${command.description}`)
			},
		},
		{
			name: "/new",
			description: "start a fresh session",
			async run(ctx) {
				ctx.seam.newSession()
				await ctx.reload()
				ctx.say(`new session ${ctx.seam.currentSessionId() ?? "(unnamed)"}`)
			},
		},
		{
			name: "/model",
			description: "switch model (bare opens the picker)",
			async run(ctx, argText) {
				const arg = argText.trim()
				if (arg) {
					const [providerID, modelID] = arg.split("/")
					if (!providerID || !modelID) {
						ctx.say(`usage: /model or /model provider/model (got "${arg}")`)
						return
					}
					ctx.seam.selectModel(providerID, modelID)
					ctx.say(`model → ${providerID}/${modelID}`)
					return
				}
				const catalog = await ctx.seam.modelCatalog()
				if (catalog.length === 0) {
					ctx.say("no models in the catalog")
					return
				}
				const current = await ctx.seam.currentModelSelection()
				const picked = await ctx.pickOne(
					"Select model",
					catalog.map((model) => ({
						title: `${model.providerID}/${model.modelID}`,
						value: `${model.providerID}/${model.modelID}`,
						description: current?.providerID === model.providerID && current.modelID === model.modelID ? "current" : undefined,
					})),
				)
				if (!picked) return
				const [providerID, modelID] = picked.split("/")
				ctx.seam.selectModel(providerID, modelID)
				ctx.say(`model → ${picked}`)
			},
		},
		{
			// Feature batch H4 (tui-pi 65-ux-batch parity). The provider login:
			// bare opens the "Add provider" picker (flat catalog + the Custom
			// provider row); a catalog row asks for its (masked) API key, the
			// Custom row runs the six-step chained form (1 route id → 2 display
			// name → 3 protocol → 4 base URL → 5 models → 6 API key) with
			// per-step inline validation ("already exists" on a colliding route
			// id, the http scheme error on a bad base URL) and esc aborting the
			// whole flow at any step. The commit is the old-stack double-write:
			// the llm-pi-ai route through the settings seam (registerRoute)
			// THEN the key through the credentials seam (login) — the provider
			// shows up in /model on the next session. "/login <id>" targets a
			// catalog entry directly.
			name: "/login",
			description: "log in a provider (bare opens the picker; Custom provider opens the form)",
			async run(ctx, argText) {
				const face = ctx.seam.login
				if (!face || !ctx.promptText) {
					ctx.say("/login unavailable in this session")
					return
				}
				const arg = argText.trim().toLowerCase()
				if (arg) {
					const entry = PROVIDER_CATALOG.find((e) => e.id === arg)
					if (!entry) {
						ctx.say(`unknown provider: ${arg}`)
						return
					}
					await commitCatalogLogin(ctx, face, entry)
					return
				}
				// Custom provider is the FIRST row (the reference's cursor-starts-
				// there behavior — Enter on the fresh picker opens the form).
				const picked = await ctx.pickOne(
					LOGIN_PICKER_TITLE,
					[CUSTOM_ENTRY, ...PROVIDER_CATALOG].map((e) => ({ title: e.name, value: e.id, description: e.hint })),
				)
				if (!picked) return
				if (picked === CUSTOM_ENTRY.id) {
					const routes = await face.routes().catch(() => [] as string[])
					await runCustomLoginChain(ctx, face, routes)
					return
				}
				const entry = PROVIDER_CATALOG.find((e) => e.id === picked)
				if (!entry) return
				await commitCatalogLogin(ctx, face, entry)
			},
		},
		{
			name: "/quit",
			description: "exit the app",
			run(ctx) {
				ctx.quit()
			},
		},
		{
			// G1 resume-picker batch: the /sessions picker upgrades to the
			// reference /resume column semantics (dsh-tui-pi 66 Phases C/D):
			// aligned UPDATED (relative time) / DIR (workspace dir) columns
			// under a fitted header line, the 1KB size display floor (rows
			// without a size fail open), and the empty-FILTERED copy distinct
			// from the plain empty-store one. Retention (deletion / age
			// windows) stays host-side — out of scope here.
			name: "/sessions",
			description: "list and resume stored sessions",
			async run(ctx) {
				const sessions = await ctx.seam.listSessions()
				if (sessions.length === 0) {
					ctx.say("no stored sessions")
					return
				}
				const visible = filterSessionsBySizeFloor(sessions)
				if (visible.length === 0) {
					ctx.say(emptyFilteredCopy(sessions.length))
					return
				}
				const { header, options } = resumePickerOptions(visible)
				const picked = await ctx.pickOne("Resume session", options, header)
				if (!picked) return
				ctx.seam.resumeSession(picked)
				await ctx.reload()
				ctx.say(`resumed ${picked}`)
			},
		},
		{
			name: "/clear",
			description: "clear the transcript",
			run(ctx) {
				ctx.clear()
				ctx.say("transcript cleared")
			},
		},
		{
			// Feature batch F3. Never busy-gated: the side call rides a throwaway
			// session, so a mid-turn /btw streams alongside the main turn.
			name: "/btw",
			description: "side question (bare reopens the last answer)",
			run(ctx, argText) {
				if (!ctx.seam.btwAsk || !ctx.openBtw) {
					ctx.say("/btw unavailable in this session")
					return
				}
				ctx.openBtw(argText)
			},
		},
		{
			// Feature batch F4. Prints the info panel as an aligned transcript
			// block (the /help print path) — no overlay, no busy-gate.
			name: "/session",
			description: "show session info (id, model, tokens, speed)",
			async run(ctx) {
				if (!ctx.seam.sessionInfo) {
					ctx.say("/session unavailable in this session")
					return
				}
				const info = await ctx.seam.sessionInfo()
				if (!info || info.sessionId === null) {
					ctx.say("no active session")
					return
				}
			for (const line of formatSessionInfoPanel(sessionInfoRows(info))) ctx.say(line)
		},
		},
		{
			// Feature batch F7a → H3 panel upgrade. With the panel hook the
			// command opens the "🔌 Plugins" manager panel (bundle table +
			// state column + `/` filter); without it the F7a transcript
			// listing remains the degrade path. Never busy-gated — a pure read.
			name: "/plugins",
			description: "manage plugins (opens the panel)",
			run(ctx) {
				if (!ctx.seam.plugins) {
					ctx.say("/plugins unavailable in this session")
					return
				}
				if (ctx.openPlugins) {
					ctx.openPlugins()
					return
				}
				const plugins = ctx.seam.plugins()
				if (plugins.length === 0) {
					ctx.say("no plugins installed")
					return
				}
				for (const plugin of plugins) ctx.say(`● ${plugin.name}@${plugin.version}`)
			},
		},
		{
			// Feature batch H3 (tui-pi 77 search parity). Opens the
			// cross-session FTS overlay over the seam's searchSessions face
			// (both adapters carry it 1:1). Never busy-gated — the query is a
			// pure read over the stored corpus, not a model turn.
			name: "/search",
			description: "full-text search over stored sessions",
			run(ctx) {
				if (!ctx.openSearch) {
					ctx.say("/search unavailable in this session")
					return
				}
				ctx.openSearch()
			},
		},
		{
			// Feature batch H5 (tui-pi 74 minimal parity): named model profiles —
			// snapshots of the CURRENT model route (provider/model + reasoning
			// effort) saved under one name and applied back through /model's own
			// semantics. `/agents` bare prints the roster (the /plugins print
			// path, current route marked); `/agents save <name>` archives the
			// current selection; `/agents use <name>` applies one (selectModel,
			// the effort arm through the thinking face when the model's ladder
			// carries it); `/agents rm <name>` deletes. Storage rides the F7b
			// config seam (configSave → the profile config.json, see
			// AGENTS_PROFILES_KEY below). Absent config faces degrade to the
			// unavailable notice (the /theme contract). Entirely offline — no
			// model traffic on any verb.
			name: "/agents",
			description: "model profiles: list / save / use / rm (named model+effort snapshots)",
			async run(ctx, argText) {
				if (!ctx.seam.configLoad || !ctx.seam.configSave) {
					ctx.say("/agents unavailable in this session")
					return
				}
				const [verb, ...rest] = argText.trim().split(/\s+/)
				if (!verb || verb === "list") {
					const profiles = loadAgentsProfiles(ctx.seam.configLoad())
					const current = await ctx.seam.currentModelSelection()
					ctx.say("model profiles:")
					for (const row of agentsRosterRows(profiles, current)) ctx.say(row)
					return
				}
				const name = rest.join(" ").trim()
				if (verb === "save") {
					if (!name) {
						ctx.say("usage: /agents save <name>")
						return
					}
					const nameError = validateAgentsName(name)
					if (nameError) {
						ctx.say(nameError)
						return
					}
					const sel = await ctx.seam.currentModelSelection()
					if (!sel) {
						ctx.say("/agents save: no current model selection")
						return
					}
					const effort = ctx.seam.thinking ? await ctx.seam.thinking.currentEffort() : undefined
					const profile: AgentsProfile = {
						name,
						provider: sel.providerID,
						model: sel.modelID,
						...(effort ? { reasoningEffort: effort } : {}),
					}
					ctx.seam.configSave(agentsProfilesPatch(upsertAgentsProfile(loadAgentsProfiles(ctx.seam.configLoad()), profile)))
					ctx.say(`saved profile ${name} → ${sel.providerID}/${sel.modelID}${effort ? ` (${effort})` : ""}`)
					return
				}
				if (verb === "use") {
					if (!name) {
						ctx.say("usage: /agents use <name>")
						return
					}
					const target = findAgentsProfile(loadAgentsProfiles(ctx.seam.configLoad()), name)
					if (!target) {
						ctx.say(`unknown profile: ${name}`)
						return
					}
					ctx.seam.selectModel(target.provider, target.model)
					let effortNote = ""
					if (target.reasoningEffort && ctx.seam.thinking) {
						const efforts = await ctx.seam.thinking.efforts()
						if (efforts.some((effort) => effort.id === target.reasoningEffort)) {
							ctx.seam.thinking.selectEffort(target.reasoningEffort)
							effortNote = ` (${target.reasoningEffort})`
						} else {
							effortNote = ` (effort ${target.reasoningEffort} not on this model's ladder — skipped)`
						}
					}
					ctx.say(`model → ${target.provider}/${target.model}${effortNote} [profile ${target.name}]`)
					return
				}
				if (verb === "rm" || verb === "remove" || verb === "delete") {
					if (!name) {
						ctx.say("usage: /agents rm <name>")
						return
					}
					const profiles = loadAgentsProfiles(ctx.seam.configLoad())
					if (!findAgentsProfile(profiles, name)) {
						ctx.say(`unknown profile: ${name}`)
						return
					}
					ctx.seam.configSave(agentsProfilesPatch(removeAgentsProfile(profiles, name)))
					ctx.say(`removed profile ${name}`)
					return
				}
				ctx.say("usage: /agents [list | save <name> | use <name> | rm <name>]")
			},
		},
		{
			// Feature batch F7b. Opens the reasoning-effort picker over the
			// CURRENT model route's real ladder (seam.thinking — the adapters
			// read provider data, never a hardcoded tier set). Picking rides
			// /model's effort semantics (switchModel with a reasoningEffort arm
			// — next-turn effect). Absent surface or an empty ladder = the
			// unavailable notice (the /btw degrade contract).
			name: "/think",
			description: "set reasoning effort (opens the picker)",
			async run(ctx) {
				const thinking = ctx.seam.thinking
				if (!thinking) {
					ctx.say("/think unavailable in this session")
					return
				}
				const efforts = await thinking.efforts()
				if (efforts.length === 0) {
					ctx.say("/think unavailable: the current model exposes no reasoning efforts")
					return
				}
				const current = await thinking.currentEffort()
				const picked = await ctx.pickOne(
					"Select reasoning effort",
					efforts.map((effort) => ({
						title: effort.name,
						value: effort.id,
						description: effort.id === current ? "current" : effort.description,
					})),
				)
				if (!picked || picked === current) return
				thinking.selectEffort(picked)
				ctx.say(`thinking → ${picked} (next turn)`)
			},
		},
		{
			// Feature batch F7b. Static keybind surface: rows generated from
			// THIS stack's config/keybind.ts Definitions (the /help print path
			// — aligned transcript lines, no overlay, no busy-gate).
			// Batch D3: the bottom key-hint row toggle (./hints-line.tsx).
			// Footer-quickwins (tui-pi footer.ts per-segment parity): bare
			// toggles the bar; `<segment> [on|off]` flips ONE of the eight
			// segments; `all on|off` bulk-sets them; `lang <locale>` switches
			// the label language (en/zh-CN/ja/ko).
			name: "/hints",
			description: "key hints: toggle bar; <segment> on|off; all on|off; lang <locale>",
			run(ctx, argText) {
				const words = argText.trim().split(/\s+/).filter(Boolean)
				if (words.length === 0) {
					setHintsShown((shown) => !shown)
					ctx.say(hintsShown() ? "key hints: on" : "key hints: off")
					return
				}
				const head = words[0]!.toLowerCase()
				const state = words[1]?.toLowerCase()
				if (head === "lang") {
					// Case-insensitive match onto the canonical locale spellings
					// ("EN" → en, "zh-cn" → zh-CN); anything else reprints usage.
					const raw = words[1]
					const next = raw
						? HINT_LOCALES.find((locale) => locale.toLowerCase() === raw.toLowerCase())
						: undefined
					if (!next) {
						ctx.say(`usage: /hints lang ${HINT_LOCALES.join("|")} (current: ${hintsLocale()})`)
						return
					}
					setHintsLocale(next)
					persistHints(ctx.seam)
					ctx.say(`hint language: ${next}`)
					return
				}
				// A given state word must be exactly on|off — anything else is a
				// typo ("/hints scroll of") and errors instead of silently
				// meaning "on".
				const stateOn = state === undefined ? undefined : state === "on" ? true : state === "off" ? false : null
				if (stateOn === null) {
					ctx.say(`usage: /hints ${head} on|off (got: ${state})`)
					return
				}
				if (head === "all") {
					const on = stateOn ?? true
					const all: FooterHints = { ...DEFAULT_FOOTER_HINTS }
					for (const seg of FOOTER_HINT_IDS) all[seg] = on
					setFooterHints(all)
					persistHints(ctx.seam)
					ctx.say(`all hint segments: ${on ? "on" : "off"}`)
					return
				}
				if (!FOOTER_HINT_IDS.includes(head as HintSegmentId)) {
					ctx.say(`unknown hint segment: ${head} (segments: ${FOOTER_HINT_IDS.join(", ")})`)
					return
				}
				const id = head as HintSegmentId
				const on = stateOn === undefined ? !footerHints()[id] : stateOn
				setFooterHints((hints) => ({ ...hints, [id]: on }))
				persistHints(ctx.seam)
				ctx.say(`hint ${id}: ${on ? "on" : "off"}${on && !hintInState(id, false) ? " (busy only)" : ""}`)
			},
		},
		{
			// α skin layer: the motion tier switch (skin contract §1 动效档位).
			// Bare reports the current tier; `auto` drops the explicit tier and
			// follows the capability/multiplexer detection again. The choice
			// persists through the same configSave chain /theme uses (the
			// profile `motion` key); the boot replays it after env
			// `DSH_OPENTUI_MOTION` (skin/motion.ts resolveMotionPreference).
			name: "/motion",
			description: "animation tier: full | reduced | off | auto (bare shows current)",
			run(ctx, argText) {
				const arg = argText.trim().toLowerCase()
				if (!arg) {
					ctx.say(`motion: ${getMotionTier()} (usage: /motion full|reduced|off|auto)`)
					return
				}
				if (arg !== "full" && arg !== "reduced" && arg !== "off" && arg !== "auto") {
					ctx.say("usage: /motion full|reduced|off|auto")
					return
				}
				setMotionTier(arg === "auto" ? undefined : (arg as MotionTier))
				try {
					ctx.seam.configSave?.({ motion: arg })
				} catch (error) {
					console.error("[commands] motion persist failed:", error)
				}
				ctx.say(`motion: ${arg === "auto" ? "auto" : getMotionTier()}`)
			},
		},
		{
			name: "/hotkeys",
			description: "show keybinds",
			run(ctx) {
				ctx.say(hotkeysHeader())
				for (const row of hotkeyRows()) ctx.say(row)
			},
		},
		{
			// Feature batch F7a. Bare opens the picker over the bundled theme
			// list (the generic pickOne modal — the same shape as /model); the
			// active theme row carries the vendored `●` current marker (α skin
			// layer — pickOne's currentValue, selection stays on row 0) and the
			// auto/dark/light mode rows ride LAST so the bare-Enter row-0 pick
			// (the e2e 67 contract) still lands on a theme. Picking applies
			// live. No argument form — the picker IS the reference surface.
			name: "/theme",
			description: "switch theme (opens the picker)",
			async run(ctx) {
				if (!ctx.themes) {
					ctx.say("/theme unavailable in this session")
					return
				}
				const current = ctx.themes.current()
				const modeFace = ctx.themes.mode?.()
				const modeOptions = modeFace
					? [
							{ title: "mode: auto", value: "mode:auto", description: "follow the terminal (default)" },
							{ title: "mode: dark", value: "mode:dark", description: "always dark" },
							{ title: "mode: light", value: "mode:light", description: "always light" },
						]
					: []
				const picked = await ctx.pickOne(
					"Select theme",
					[
						...ctx.themes.list().map((name) => ({ title: name, value: name })),
						...modeOptions,
					],
					undefined,
					current,
				)
				if (!picked || picked === current) return
				if (picked.startsWith("mode:")) {
					const mode = picked.slice("mode:".length) as "auto" | "dark" | "light"
					if (modeFace?.set(mode)) ctx.say(`Theme mode: ${mode}`)
					else ctx.say(`unknown theme mode: ${mode}`)
					return
				}
				if (ctx.themes.set(picked)) ctx.say(`Theme: ${picked} — applied`)
				else ctx.say(`unknown theme: ${picked}`)
			},
		},
		{
			// Feature batch H2 (tui-pi 60-preset parity). The deployment's agent
			// preset roster (seam.preset — the host agentPresets registry).
			// Bare opens the picker over the roster (the current row marked),
			// "/preset next" rotates one slot with wrap, "/preset <id|name>"
			// targets directly. The switch rides the adapters' switchPreset
			// semantics — the picked id composes the NEXT session — so a live
			// session confirms first ("Switch preset to <name>?", the reference
			// dialog copy; Esc/Cancel keeps everything), a fresh app (nothing
			// attached) applies directly. Absent face or an empty roster =
			// the degrade notices (the /plugins contract).
			name: "/preset",
			description: "switch agent preset (bare opens the picker, next rotates)",
			async run(ctx, argText) {
				const face = ctx.seam.preset
				if (!face) {
					ctx.say("/preset unavailable in this session")
					return
				}
				const rows = await face.list()
				if (rows.length === 0) {
					ctx.say("no agent presets available")
					return
				}
				const currentId = await face.currentId()
				const arg = argText.trim()
				let target: SeamPresetRow | undefined
				if (arg === "") {
					const picked = await ctx.pickOne(
						"Select agent preset",
						rows.map((row) => ({
							title: row.name,
							value: row.id,
							description: row.id === currentId ? "current" : row.description,
						})),
					)
					if (!picked || picked === currentId) return
					target = rows.find((row) => row.id === picked)
				} else if (arg === "next") {
					target = presetNextRow(rows, currentId)
					if (!target) {
						ctx.say("no other preset to switch to")
						return
					}
				} else {
					target = findPresetRow(rows, arg)
					if (!target) {
						ctx.say(`unknown preset: ${arg}`)
						return
					}
					if (target.id === currentId) {
						ctx.say(`preset already: ${target.name}`)
						return
					}
				}
				if (!target) return
				if (ctx.seam.status().sessionAttached) {
					const verdict = await ctx.pickOne(`Switch preset to ${target.name}?`, [
						{ title: `Switch to ${target.name}`, value: "switch" },
						{ title: "Cancel", value: "cancel" },
					])
					if (verdict !== "switch") return
				}
				if (!(await face.select(target.id))) {
					ctx.say(`preset switch failed: ${target.name}`)
					return
				}
				ctx.say(`preset → ${target.name} (new session)`)
				await ctx.reload()
			},
		},
	]
}

/**
 * Prefix filter for the palette: the query must be the head of the name,
 * slash included ("/lo" matches "/logout"-shaped rows — here "/clear" no,
 * "/model" only from "/m…"). Empty query = the full table.
 */
export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
	if (!query.startsWith("/")) return []
	const needle = query.toLowerCase()
	return commands.filter((command) => command.name.toLowerCase().startsWith(needle))
}

/** Dispatch one submitted line. Returns what the caller should do next. */
export type SlashDispatch =
	| { kind: "command"; command: SlashCommand; argText: string }
	| { kind: "unknown"; name: string }
	| { kind: "text" }

/**
 * Classify a submitted line: exact/prefixed command name (with the rest of
 * the line as its argument text), an unknown "/xxx" (harmless error row —
 * never sent to the model), or plain text.
 *
 * Resolution is by table lookup: the first command whose name the line
 * starts with, longest match first, so a typed "/model provider/id" is not
 * hijacked by bare "/model" — the argument text rides along and /model's
 * argument branch handles it.
 */
export function dispatchLine(commands: SlashCommand[], line: string): SlashDispatch {
	const text = line.trim()
	if (!text.startsWith("/")) return { kind: "text" }
	const [head, ...rest] = text.split(/\s+/)
	const needle = head.toLowerCase()
	// Exact name wins first — "/session" must not be shadowed by the longer
	// "/sessions" (both start with the typed head); the length sort then only
	// orders the remaining prefix matches (palette-style abbreviations).
	const match =
		commands.find((command) => command.name.toLowerCase() === needle) ??
		commands
			.filter((command) => command.name.toLowerCase().startsWith(needle))
			.sort((a, b) => b.name.length - a.name.length)[0]
	if (!match) return { kind: "unknown", name: head }
	return { kind: "command", command: match, argText: rest.join(" ") }
}

/** The harmless error row text for an unknown command (old ShellHost parity). */
export function unknownCommandRow(name: string): string {
	return `unknown command: ${name} (try /help)`
}

/**
 * Feature batch H5 (tui-pi 74 minimal parity) — named model profiles.
 *
 * A profile is a NAMED SNAPSHOT of the current model route: provider +
 * model + reasoning effort, saved with `/agents save <name>` and applied
 * back with `/agents use <name>` through /model's own semantics
 * (selectModel; the effort arm rides the thinking face's selectEffort when
 * the current model's real ladder carries it — a stale effort degrades to a
 * note, never a hard failure).
 *
 * Storage rides the F7b config seam: the whole roster lives under ONE
 * `agentsProfiles` key of the profile config.json (`configSave` is an
 * upsert patch, so the key is whole-document last-write-wins — the accepted
 * loss model for a human-paced feature, same as `theme`). Reads are
 * tolerant: a missing, corrupt or wrong-shape document degrades to an empty
 * roster.
 *
 * HONEST GAP LIST vs the tui-pi 74 reference manager:
 * - No agent FILES: the reference manages `$DSH_HOME/agents/*.md`
 *   frontmatter (per-agent model/think columns); this stack has no agents
 *   corpus to edit, so /agents here is a model-profile store only (the name
 *   keeps the cross-stack parity slot).
 * - No scope awareness: the reference's `.dsh-profile` pin and the shared
 *   `$DSH_HOME/model-profiles.json` store (profile "work" scoped edits vs
 *   frontmatter baseline) have no counterpart here — one flat roster.
 * - A `use` is session-scoped (selectModel semantics): it does NOT compose
 *   future sessions like the reference's pinned profile would.
 */

/** The config key the roster lives under (whole-document last-write-wins). */
export const AGENTS_PROFILES_KEY = "agentsProfiles"

/** On-disk schema version; bump only for breaking changes. */
export const AGENTS_PROFILES_VERSION = 1

/** One named model profile: a saved /model (plus effort) selection. */
export interface AgentsProfile {
	/** The slug the user typed (`/agents save <name>`); unique per roster. */
	name: string
	provider: string
	model: string
	/** Reasoning effort captured at save time; absent = provider default. */
	reasoningEffort?: string
}

/** Tolerant roster read: missing/corrupt/wrong-shape config degrades to []. */
export function loadAgentsProfiles(cfg: Record<string, unknown> | undefined): AgentsProfile[] {
	const doc = cfg?.[AGENTS_PROFILES_KEY] as { profiles?: unknown } | undefined
	if (!doc || typeof doc !== "object" || !Array.isArray(doc.profiles)) return []
	const out: AgentsProfile[] = []
	for (const row of doc.profiles) {
		if (!row || typeof row !== "object") continue
		const { name, provider, model, reasoningEffort } = row as Record<string, unknown>
		if (typeof name !== "string" || !name || typeof provider !== "string" || !provider || typeof model !== "string" || !model) {
			continue
		}
		out.push({
			name,
			provider,
			model,
			...(typeof reasoningEffort === "string" && reasoningEffort ? { reasoningEffort } : {}),
		})
	}
	return out
}

/** The whole-roster config patch for one write (the `agentsProfiles` key). */
export function agentsProfilesPatch(profiles: AgentsProfile[]): Record<string, unknown> {
	return { [AGENTS_PROFILES_KEY]: { version: AGENTS_PROFILES_VERSION, profiles } }
}

/** Insert-or-replace by name (save over an existing name overwrites). */
export function upsertAgentsProfile(profiles: AgentsProfile[], profile: AgentsProfile): AgentsProfile[] {
	const idx = profiles.findIndex((p) => p.name === profile.name)
	if (idx === -1) return [...profiles, profile]
	const next = [...profiles]
	next[idx] = profile
	return next
}

export function removeAgentsProfile(profiles: AgentsProfile[], name: string): AgentsProfile[] {
	return profiles.filter((p) => p.name !== name)
}

export function findAgentsProfile(profiles: AgentsProfile[], name: string): AgentsProfile | undefined {
	return profiles.find((p) => p.name === name)
}

/** Profile names are transcript- and key-safe slugs (1-32 chars). */
export function validateAgentsName(name: string): string | undefined {
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(name)) {
		return "profile name must be 1-32 chars: letters, digits, - _"
	}
	return undefined
}

/** The roster print rows (the /plugins print path): ● current route match. */
export function agentsRosterRows(
	profiles: AgentsProfile[],
	current?: { providerID: string; modelID: string },
): string[] {
	if (profiles.length === 0) {
		return ["no saved model profiles (/agents save <name> archives the current model)"]
	}
	return profiles.map((p) => {
		const route = `${p.provider}/${p.model}${p.reasoningEffort ? ` (${p.reasoningEffort})` : ""}`
		const mark = current && current.providerID === p.provider && current.modelID === p.model ? "●" : "○"
		return `${mark} ${p.name} — ${route}`
	})
}
