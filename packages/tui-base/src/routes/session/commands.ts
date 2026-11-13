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
 * /resume /clear, plus /btw (feature batch F3). Later commands (/attach …)
 * are POST-CUTOVER fill — absent from the table, not stubbed.
 *
 * Dispatch vocabulary (old ShellHost parity):
 *   "/model provider/id"  → argument form runs directly
 *   "/nope"               → "unknown command" (a harmless error row, NOT a
 *                            send to the model)
 *   plain text            → not a command; caller sends/steers as batch 4
 */
import type { SeamEffortOption, SeamPresetRow, SessionSeam } from "../../seams/session"
import type { ComposerFlushResult } from "./composer-state"
import { hotkeyRows, hotkeysHeader } from "./hotkeys"
import {
	brokenLogsForSession,
	corruptSessionIds,
	emptyFilteredCopy,
	filterSessionsBySizeFloor,
	repairConfirmBody,
	repairConfirmOptions,
	resumePickerOptions,
	type BrokenLogRow,
} from "./resume-picker"
import { formatSessionInfoPanel, sessionInfoRows } from "./session-info"
import {
	buildModelPickerRows,
	modelKey,
	readModelPrefsFromConfig,
	toggleStringList,
} from "./model-picker"
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
import { getMotionPreference, getMotionTier, setMotionTier, type MotionTier } from "../../skin/motion"

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

/**
 * The `/model` stage-2 row-0 pick value ("(model default)"): applying it
 * rides `selectEffort(undefined)` = clear the override (the /agents
 * pickerSelectEffort row-0 parity) — never a real ladder id. Exported for
 * the command tests (the fake pickOne echoes this value back).
 */
export const MODEL_DEFAULT_EFFORT_PICK = "__model_default__"

/**
 * One short, key-free failure line for a seam rejection (the /login commit
 * convention — `String(e.message).slice(0, 150)`): the /model and /think
 * failure arms print it instead of echoing an acceptance that never happened.
 */
function seamFailureReason(error: unknown): string {
	return String(error instanceof Error ? error.message : error).slice(0, 150)
}

/** One registry row: name carries the leading slash ("/help"). */
export interface SlashCommand {
	name: string
	description: string
	/**
	 * `"skill"` marks a human-invocable skill row: it participates in the
	 * same filtering/completion/dispatch resolution as a command, but the
	 * slash host deliberately does NOT run `run` — the line falls through to
	 * the model, where the host's `/name` gesture injects the skill body.
	 * Omitted (the normal case) = executable command.
	 */
	kind?: "command" | "skill"
	run(ctx: SlashCommandContext, argText: string): void | Promise<void>
}

/**
 * One in-picker key action (A4, gap-analysis C14; the DialogSelect
 * `actions` face). The entry registers it on the dialog's keymap under
 * `bind` and paints it in the dialog footer; a press fires the pickOne
 * caller's `onAction` with the command id and the selected row's value.
 */
export interface PickOneAction {
	/** Keymap command id — also the `onAction` discriminator. */
	command: string
	/** Footer label. A function follows the selected row (e.g. favorite ↔
	 * unfavorite); it also receives undefined (label resolved without a
	 * selection while the list moves). */
	title: string | ((value: string | undefined) => string)
	/** Direct key binding, e.g. "f" / "h". */
	bind?: string
	/** Dynamic disable — the press is refused while it returns true for the
	 * selected row's value (the h-on-favorite guard, tui-pi parity). */
	disabled?: (value: string) => boolean
}

/**
 * Optional in-picker arming for pickOne (A4). `getOptions` is the reactive
 * row source: the entry re-reads it after every `onAction` press so the
 * list reorders live while the dialog stays open (the DialogSelect options
 * effect reconciles the cursor onto the moved row). Commands keep their
 * favorite/hidden state in the closures those callbacks close over.
 */
export interface PickOneExtras {
	actions?: PickOneAction[]
	getOptions?: () => { title: string; value: string; description?: string; category?: string }[]
	onAction?: (command: string, value: string) => void
}

/** Host-side effects a command may ask for; the page owns each hook. */
export interface SlashCommandContext {
	seam: SessionSeam
	/** Append a system-style line to the transcript view (command feedback). */
	say(text: string): void
	/** Client-side transcript reset (/clear). */
	clear(): void
	/** Re-hydrate the transcript from the seam (/new, /resume).
	 * `sessionId` names the session to read when it is not the seam's live
	 * one yet — /resume stages an id that only binds at the next turn.
	 * May return a settle promise; commands awaiting it can append rows
	 * AFTER the re-hydrate instead of being wiped by it. */
	reload(sessionId?: string): void | Promise<void>
	/** Exit the app (/quit). */
	quit(): void
	/**
	 * One generic modal picker (the vendored dialog-select through the page's
	 * overlay host). Resolves the picked value, or undefined on esc/cancel.
	 * `headerLine` (G1 resume-picker batch) paints an aligned column-header
	 * line under the dialog title (the /resume UPDATED/DIR columns).
	 *
	 * `extras` (A4, gap-analysis C14) arms the dialog with in-picker
	 * actions (f/h-style keys). Optional — a host without the wiring keeps
	 * the plain pick (every pre-A4 caller and test).
	 */
	pickOne(
		title: string,
		options: { title: string; value: string; description?: string }[],
		headerLine?: string,
		/** α skin layer: marks the active row with the vendored `●` current
		 * marker without moving the selection off row 0. */
		currentValue?: string,
		extras?: PickOneExtras,
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
	 * Footer-refresh hook (footer-quickwins): the page's own footer data
	 * refresh entry (the same one the mount/reload/turn-end paths drive).
	 * Commands that mutate session settings shown in the footer (/think,
	 * /model) call it after the mutation settles — otherwise
	 * the effort/model segments only move at the next turn boundary.
	 * Optional — a host without it keeps the old turn-end-only behavior.
	 */
	refreshFooter?(): void
	/**
	 * Footer-refresh CANCELLATION hook (review 3.5): bump the page's refresh
	 * ordinal WITHOUT re-reading, so every in-flight refreshFooterData chain
	 * (including its pending default-effort write) bails at its next seq
	 * check. /think calls it BEFORE the host accepts the pick: a chain from
	 * the previous turn end can still be holding the current ordinal and
	 * would otherwise write the default "high" AFTER the user's /think off.
	 * Optional — a host without it keeps the old behavior (the accept-then-
	 * refresh order still invalidates once the pick has landed).
	 */
	invalidateFooter?(): void
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
	/**
	 * Open the agents manager panel (tui-pi agents manager parity). Optional —
	 * an entry without it degrades /agents to a notice.
	 */
	openAgents?(name?: string): void
	/**
	 * Open the /settings panel (whitelist-driven local preferences + host
	 * settings + read-only namespaces). Optional — an entry without it
	 * degrades /settings to a notice.
	 */
	openSettings?(): void
	/**
	 * Deliver the client-side delivery queue NOW (the /flush command).
	 *
	 * The queue is paused after a failed or aborted turn: it is KEPT (the
	 * user-visible `⏸` row stays) but nothing pumps it — it would wait for
	 * the next message. This restarts the pump: the head of the queue starts
	 * a turn immediately and the rest follow one per turn end.
	 *
	 * Optional — an entry without a client-side queue degrades /flush to a
	 * notice. The result tells the command what to report ("empty" = nothing
	 * to deliver, "busy" = a turn is running, "flushed" = the pump restarted).
	 */
	flushQueue?(): ComposerFlushResult
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

/**
 * The footer brand segment's preset label (tui-pi `formatPresetLabel`
 * semantics): the current row's name, else the registry-default row's, else
 * the `standard` entry, else the first-listed one — the footer shows the
 * preset the next session will compose, so at boot (no session yet, nothing
 * staged) the default row is the honest answer. A staged id (`currentId`)
 * that names no listed row means the composed preset is unknown here (a
 * broken row was filtered out, or the preset was deleted): undefined, never
 * another row's name that the session is not actually composed with. Empty
 * roster / no face → undefined (the brand segment stays the plain "dsh").
 */
export function presetLabelFor(rows: SeamPresetRow[], currentId: string | undefined): string | undefined {
	if (rows.length === 0) return undefined
	if (currentId !== undefined) return rows.find((row) => row.id === currentId)?.name
	const marked = rows.find((row) => row.isDefault) ?? rows.find((row) => row.id === "standard")
	return (marked ?? rows[0])?.name
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

/**
 * C13 /resume repair flow (dsh-tui-pi `offerCorruptedLogRepair` parity, the
 * repair-dialog.ts semantics on the generic pickOne modal): the picked
 * session's log failed the integrity scan, so the repair is offered behind
 * an EXPLICIT confirmation dialog. It never runs silently:
 *
 *   - Cancel (or esc) leaves the log untouched and reports the original
 *     reasons — the resume path does NOT run.
 *   - Confirm runs the guarded seam repair (original always moves to
 *     `.corrupt-bak` BEFORE any rewrite). A `failed` result keeps the log
 *     untouched-or-restored and stops the resume; `clean` (nothing needed)
 *     and `repaired` both let the resume proceed.
 *
 * Resolves true only when the resume path should re-enter.
 */
export async function offerCorruptedLogRepair(
	ctx: Pick<SlashCommandContext, "say" | "pickOne"> & { seam: SessionSeam },
	sessionId: string,
	broken: readonly BrokenLogRow[],
): Promise<boolean> {
	if (broken.length === 0) {
		ctx.say(`cannot repair ${sessionId}: no broken log found on disk`)
		return false
	}
	if (!ctx.seam.repairSessionLog) {
		ctx.say("/resume repair unavailable in this session — the log was left untouched")
		return false
	}
	const confirm = await ctx.pickOne(
		`Session ${sessionId} has a broken log (${repairConfirmBody(broken).join("; ")}) — repair it?`,
		repairConfirmOptions(),
	)
	if (confirm !== "repair") {
		ctx.say(`resume cancelled — the log was left untouched (${repairConfirmBody(broken).join("; ")})`)
		return false
	}
	for (const row of broken) {
		const result = ctx.seam.repairSessionLog(row.path)
		if (result.kind === "failed") {
			ctx.say(`repair failed — ${row.name}: ${result.detail} (the log was left untouched or restored)`)
			return false
		}
		if (result.kind === "clean") {
			ctx.say(`${row.name} needs no repair — the last line already parses; resuming`)
		} else {
			ctx.say(`repaired ${row.name} — the original was kept at ${result.backupPath}`)
		}
	}
	return true
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

// ----------------------------------------------------------- /logout helpers --
// Gap fix (C8): the login/logout seam has existed since batch H4, but /logout
// had no caller. Behavior mirrors the reference (dsh-tui-pi openLogoutFlow):
// list the routes whose derived key ref holds a stored credential, pick one,
// drop the key first (the security-critical half), then clear the route —
// EXCEPT for custom (non-catalog) routes, whose api/baseURL/models profile the
// catalog commit cannot re-create, so they keep the route (the reference's
// hand-declared arm). Picker selection is the commit boundary — the reference
// drives no extra confirm dialog.

/** One actionable logout target derived from a configured route. */
export interface LogoutTarget {
	id: string
	/** Catalog display name, else the raw route id. */
	name: string
	/** The env-ref the key is stored under (deriveKeyRef). */
	ref: string
	/** Non-catalog route: logout drops only the key, never the route. */
	custom: boolean
}

/**
 * Pure classifier: configured route ids → picker rows. Catalog rows carry
 * their display name; anything else is a custom route (key-only logout).
 */
export function logoutTargets(routes: readonly string[]): LogoutTarget[] {
	return routes.map((id) => {
		const entry = PROVIDER_CATALOG.find((e) => e.id === id)
		return { id, name: entry?.name ?? id, ref: deriveKeyRef(id), custom: entry === undefined }
	})
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
				// A fresh session has no stored history: clear explicitly. The
				// reload used to imply the wipe through an errored "" read —
				// that path is gone (transcript-loss fix), and old rows must
				// not survive a /new.
				ctx.clear()
				await ctx.reload()
				ctx.say(`new session ${ctx.seam.currentSessionId() ?? "(unnamed)"}`)
			},
		},
		{
			name: "/model",
			description: "switch model (bare opens the picker, then the effort picker)",
			async run(ctx, argText) {
				// A previously SILENT selection failure (the staged route's
				// re-send onto the last session create, a fire-and-forget
				// switchModel): surface it before this pick — the footer label
				// may still name a route the host never accepted.
				const pendingSelectionError = ctx.seam.lastSelectionError?.()
				if (pendingSelectionError) {
					ctx.say(`model note: the last staged switch failed — ${pendingSelectionError}`)
				}
				const arg = argText.trim()
				if (arg) {
					const [providerID, modelID] = arg.split("/")
					if (!providerID || !modelID) {
						ctx.say(`usage: /model or /model provider/model (got "${arg}")`)
						return
					}
					// Argument form stays one-shot (script/muscle-memory path):
					// no second stage, byte-identical to the pre-two-stage flow.
					try {
						await ctx.seam.selectModel(providerID, modelID)
					} catch (error) {
						ctx.say(`model switch failed — ${seamFailureReason(error)}`)
						return
					}
					ctx.say(`model → ${providerID}/${modelID}`)
					ctx.refreshFooter?.()
					return
				}
				const catalog = await ctx.seam.modelCatalog()
				if (catalog.length === 0) {
					ctx.say("no models in the catalog")
					return
				}
				const current = await ctx.seam.currentModelSelection()
				// A4 (gap-analysis C14, dsh-tui-pi selectors.ts pickModel parity):
				// the stage-1 picker carries the favorites/hidden layer — `f`
				// toggles the favorite flag on the cursor model (list reorders
				// live, dialog stays open), `h` hides (a "Hidden" section at the
				// bottom keeps the rows visible/selectable so `h` restores
				// them). Every toggle persists immediately through the config
				// seam (`favoriteModels`/`hiddenModels` profile config.json
				// keys, tui-pi readModelPrefs/writeModelPref parity) —
				// best-effort: a seam-less host keeps the session-local state.
				const prefs = readModelPrefsFromConfig(ctx.seam.configLoad?.())
				let favorites = prefs.favoriteModels
				let hidden = prefs.hiddenModels
				const persistPrefs = (): void => {
					try {
						ctx.seam.configSave?.({ favoriteModels: [...favorites], hiddenModels: [...hidden] })
					} catch (error) {
						console.error("[commands] model prefs persist failed:", error)
					}
				}
				const currentKey = current ? modelKey(current.providerID, current.modelID) : undefined
				const picked = await ctx.pickOne(
					"Select model",
					buildModelPickerRows(catalog, favorites, hidden, current),
					undefined,
					currentKey,
					{
						actions: [
							{
								command: "model.picker.favorite",
								title: (value) => (value !== undefined && favorites.includes(value) ? "unfavorite" : "favorite"),
								bind: "f",
							},
							{
								command: "model.picker.hide",
								title: "hide",
								bind: "h",
								// tui-pi canHideModelRow parity: hiding a favorite row
								// would silently persist hiddenModels with no visual
								// feedback (the row stays pinned in Favorites) — refuse
								// h there; the user unfavorites first.
								disabled: (value) => favorites.includes(value),
							},
						],
						getOptions: () => buildModelPickerRows(catalog, favorites, hidden, current),
						onAction: (command, value) => {
							if (command === "model.picker.favorite") {
								favorites = toggleStringList(favorites, value)
							} else if (command === "model.picker.hide") {
								if (favorites.includes(value)) return
								hidden = toggleStringList(hidden, value)
							} else {
								return
							}
							persistPrefs()
						},
					},
				)
				if (!picked) return
				const [providerID, modelID] = picked.split("/")
				// The two stages are ONE transaction (tui-pi selectors.ts:465-520
				// parity): stage 1 only picks — nothing commits here. Stage-2
				// prep reads the picked model's real ladder BEFORE any commit.
				// A host without the optional `effortsFor` arm, an empty ladder,
				// or a failed read all mean there IS no stage 2: the model pick
				// is then the whole transaction and commits immediately (the
				// pre-two-stage behavior) with one merged notice line.
				const thinking = ctx.seam.thinking
				let ladder: SeamEffortOption[] = []
				try {
					ladder = (await thinking?.effortsFor?.(providerID, modelID)) ?? []
				} catch {
					ladder = []
				}
				if (ladder.length === 0) {
					// tui-pi selectors.ts:489-498 parity: the no-ladder fallback
					// commit carries the CURRENT effort when the pick stays on
					// the same provider (cross-provider — or no face to read
					// with — starts from the route's own default). The read
					// rides the pre-commit `current` snapshot and must land
					// BEFORE the model write: afterwards the route's effort is
					// the new model's business, not the kept one.
					const keptEffort =
						current?.providerID === providerID
							? await thinking?.currentEffort()
							: undefined
					try {
						await ctx.seam.selectModel(providerID, modelID)
					} catch (error) {
						ctx.say(`model switch failed — ${seamFailureReason(error)}`)
						return
					}
					ctx.say(`model → ${picked} (no think levels)`)
					if (keptEffort !== undefined) {
						try {
							await thinking?.selectEffort(keptEffort)
						} catch (error) {
							ctx.say(`thinking switch failed — ${seamFailureReason(error)}`)
							ctx.refreshFooter?.()
							return
						}
						ctx.say(`thinking → ${keptEffort} (next turn)`)
					}
					ctx.refreshFooter?.()
					return
				}
				// Stage 2 — the /think effort window over the new model's
				// ladder. Row 0 is "(model default)": picking it commits the
				// model with the override cleared (selectEffort(undefined) =
				// the model default). Esc here abandons the WHOLE selection —
				// stage 1 never committed, so nothing switches (tui-pi
				// selectors.ts:508-513).
				const effortNow = await thinking?.currentEffort()
				const effortPicked = await ctx.pickOne(
					`Select reasoning effort — ${picked}`,
					[
						{ title: "(model default)", value: MODEL_DEFAULT_EFFORT_PICK },
						...ladder.map((effort) => ({
							title: effort.name,
							value: effort.id,
							description: effort.id === effortNow ? "current" : effort.description,
						})),
					],
				)
				if (!effortPicked) {
					ctx.say("model unchanged")
					return
				}
				const effort = effortPicked === MODEL_DEFAULT_EFFORT_PICK ? undefined : effortPicked
				// One deferred commit at the confirmed boundary, ordered like
				// /think's contract (review 3.5): bump the footer ordinal
				// BEFORE the host accepts, model first, then the effort on top
				// of it, refresh after. A failed arm reports its own error line
				// and never echoes the acceptance it did not get: the model
				// rejection abandons the whole transaction (no effort write on
				// top of the OLD route), an effort rejection after an accepted
				// model still keeps the (real) model success line.
				ctx.invalidateFooter?.()
				try {
					await ctx.seam.selectModel(providerID, modelID)
				} catch (error) {
					ctx.say(`model switch failed — ${seamFailureReason(error)}`)
					return
				}
				ctx.say(`model → ${picked}`)
				try {
					await thinking?.selectEffort(effort)
				} catch (error) {
					ctx.say(`thinking switch failed — ${seamFailureReason(error)}`)
					ctx.refreshFooter?.()
					return
				}
				ctx.say(`thinking → ${effortPicked === MODEL_DEFAULT_EFFORT_PICK ? "model default" : effortPicked} (next turn)`)
				ctx.refreshFooter?.()
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
			// Gap fix (C8): the logout half of the batch-H4 login face — the
			// seam carried logout/credentialStatus all along, but nothing
			// called them. Bare opens the picker over the routes whose derived
			// key ref probes configured; "/logout <id>" targets one directly.
			// Commit mirrors the reference commitLogout ordering: the key
			// (credentials/unset) first — a failed unset never touches the
			// route — then the route clears for catalog rows only (custom
			// routes keep their api/baseURL/models profile: the catalog commit
			// could not re-create it). A failed route clear keeps the key
			// removal (it is reported, never rolled back).
			name: "/logout",
			description: "log out a provider (drops the stored key)",
			async run(ctx, argText) {
				const face = ctx.seam.login
				if (!face) {
					ctx.say("/logout unavailable in this session")
					return
				}
				const routes = await face.routes().catch(() => [] as string[])
				// Probe each route's key ref (the reference's credentials sweep):
				// a failing probe reads as logged out — never breaks the list.
				const loggedIn: LogoutTarget[] = []
				for (const target of logoutTargets(routes)) {
					try {
						if ((await face.credentialStatus(target.ref)).configured) loggedIn.push(target)
					} catch {
						// skipped — the provider reads as logged out
					}
				}
				if (loggedIn.length === 0) {
					ctx.say("no logged-in providers")
					return
				}
				const arg = argText.trim().toLowerCase()
				let target = arg ? loggedIn.find((t) => t.id === arg) : undefined
				if (arg && !target) {
					ctx.say(`not logged in: ${arg}`)
					return
				}
				if (!target) {
					const picked = await ctx.pickOne(
						"Log out provider",
						loggedIn.map((t) => ({ title: t.name, value: t.id, description: t.ref })),
					)
					if (!picked) return
					target = loggedIn.find((t) => t.id === picked)
				}
				if (!target) return
				try {
					await face.logout(target.ref)
				} catch (error) {
					ctx.say(`${target.id}: logout failed — ${seamFailureReason(error)}`)
					return
				}
				if (target.custom) {
					ctx.say(`${target.name} logged out — key removed (route kept)`)
					return
				}
				const cleared = await face.registerRoute(target.id, undefined).catch(() => false)
				ctx.say(
					cleared
						? `${target.name} logged out — key + route removed (leaves /model next session)`
						: `${target.name} logged out — key removed, route removal failed`,
				)
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
			// G1 resume-picker batch (renamed to /resume — the dsh-tui-pi
			// command name; no /sessions alias, the old name is gone): the
			// picker keeps the reference /resume column semantics (dsh-tui-pi
			// 66 Phases C/D): aligned UPDATED (relative time) / DIR (workspace
			// dir) columns under a fitted header line, the 1KB size display
			// floor (rows without a size fail open), and the empty-FILTERED
			// copy distinct from the plain empty-store one. Retention
			// (deletion / age windows) stays host-side — out of scope here.
			name: "/resume",
			description: "resume a persisted session",
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
				// C13 repair flow, probe half: the client-local store scan (the
				// /repair criteria) runs at picker-load time so broken logs show
				// up as `⚠`-marked rows (tui-pi loadSessionPreviews corruptIds
				// parity) — the repair itself stays behind the per-row confirm.
				const broken = ctx.seam.repairScanBroken?.() ?? []
				const corruptIds = corruptSessionIds(broken)
				const { header, options } = resumePickerOptions(visible, Date.now(), corruptIds)
				const picked = await ctx.pickOne("Resume session", options, header)
				if (!picked) return
				// Corrupt-log branch (tui-pi offerCorruptedLogRepair parity): the
				// explicit confirm dialog gates the rewrite — Cancel falls back
				// to the plain failure text and never resumes.
				if (corruptIds.has(picked)) {
					const ok = await offerCorruptedLogRepair(ctx, picked, brokenLogsForSession(broken, picked))
					if (!ok) return
				}
				ctx.seam.resumeSession(picked)
				// The staged id is not the seam's live id yet (resumeSession
				// only records it; session/create binds it at the next turn),
				// so the reload must be told WHICH session to read. Without it
				// the transcript read targeted "" and the view was emptied.
				await ctx.reload(picked)
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
			// The steer/queue batch's explicit "deliver it NOW" trigger.
			// A failed or aborted turn PAUSES the client-side queue: the
			// prompts are KEPT (the `⏸` row stays) but nothing pumps them,
			// so they would wait for the user's next message. This restarts
			// the pump: the head of the queue starts a turn immediately and
			// the rest follow one per turn end, in submission order.
			//
			// Never silent: an empty queue answers "nothing to flush", a
			// running turn answers that the prompts wait for it to finish (no
			// promise of delivery — a failed turn pauses the queue again).
			name: "/flush",
			description: "deliver the queued prompts now",
			run(ctx) {
				if (!ctx.flushQueue) {
					ctx.say("/flush unavailable in this session")
					return
				}
				const result = ctx.flushQueue()
				if (result.kind === "empty") {
					ctx.say("queue is empty — nothing to flush")
					return
				}
				if (result.kind === "busy") {
					ctx.say(
						`a turn is running — ${result.remaining} queued prompt(s) wait for it to finish`,
					)
					return
				}
				ctx.say(
					`queue flushed — ${result.started} prompt(s) sending now, ${result.remaining} still queued`,
				)
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
			// /agents opens the agent-definition manager (tui-pi agents
			// manager parity): the `${DSH_HOME}/agents/*.md` corpus, the
			// composed model/thinking columns, and the table -> fields ->
			// model/effort/deep editors. An argument preselects the EXACT
			// `name` row (display names never match, tui-pi parity); a miss
			// degrades to the plain table. A seam without the agents face
			// degrades to the unavailable notice.
			name: "/agents",
			description: "manage agent definitions (model, think level, spawn depth) from markdown files",
			run(ctx, argText) {
				if (!ctx.seam.agents) {
					ctx.say("/agents unavailable in this session")
					return
				}
				if (!ctx.openAgents) {
					ctx.say("/agents: the manager panel is not mounted in this entry")
					return
				}
				const name = argText.trim()
				ctx.openAgents(name === "" ? undefined : name)
			},
		},
		{
			// /settings opens the whitelist-driven settings panel v1: local
			// preferences (configSave → profile config.json, live),
			// host settings (settings.mutate → profile patch file), and every
			// other namespace read-only ("本 TUI 不消费"). A seam without the
			// settings face still gets the local zone.
			name: "/settings",
			description: "settings: local preferences, host settings, other namespaces",
			run(ctx) {
				if (!ctx.openSettings) {
					ctx.say("/settings: the panel is not mounted in this entry")
					return
				}
				ctx.openSettings()
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
				// Review 3.5: close the default-write window BEFORE the host
				// accepts the pick. A refreshFooterData chain started at the last
				// turn end still holds the current ordinal while this pick is in
				// flight; when its ladder read lands it would write the default
				// "high" AFTER the user's pick (e.g. /think off → flipped back to
				// high). Bumping the ordinal first makes that pending chain bail;
				// the refresh below then re-reads the accepted effort.
				ctx.invalidateFooter?.()
				// Await the host's acceptance (the seam promise) BEFORE the
				// footer refresh — currentEffort() reads the accepted route, so
				// refreshing first would race the old effort back onto the
				// footer (tui-pi updates the footer segment immediately). A
				// rejected acceptance prints the failure line instead of the
				// success echo and leaves the footer on the old effort.
				try {
					await thinking.selectEffort(picked)
				} catch (error) {
					ctx.say(`thinking switch failed — ${seamFailureReason(error)}`)
					return
				}
				ctx.say(`thinking → ${picked} (next turn)`)
				ctx.refreshFooter?.()
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
			// Bare reports BOTH the setting and the effective tier: an explicit
			// tier prints itself; auto/unset prints `auto → <resolved>`, so a
			// profile sitting on auto is never mistaken for a fixed tier. `auto`
			// drops the explicit tier and follows the capability/multiplexer
			// detection again. The choice persists through the same configSave
			// chain /theme uses (the profile `motion` key); the boot replays it
			// after env `DSH_OPENTUI_MOTION` (skin/motion.ts
			// resolveMotionPreference).
			name: "/motion",
			description: "animation tier: full | reduced | off | auto (bare shows setting → effective)",
			run(ctx, argText) {
				const arg = argText.trim().toLowerCase()
				if (!arg) {
					const preference = getMotionPreference()
					const setting = preference === undefined ? `auto → ${getMotionTier()}` : preference
					ctx.say(`motion: ${setting} (usage: /motion full|reduced|off|auto)`)
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
export function filterCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
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
	// Exact name wins first — a typed full command must not be shadowed by a
	// longer sibling (the old /session → /sessions bug); the length sort then
	// only orders the remaining prefix matches (palette-style abbreviations).
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
