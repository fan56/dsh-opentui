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
import { t, activeLanguage, installedLanguages, setLanguage, LANGUAGE_CHOICES } from "../../i18n"
import type { SeamAccountState, SeamEffortOption, SeamLoginRoute, SeamPermissionCatalog, SeamPresetRow, SeamRegisterRoutePlan, SeamSessionSummary, SeamSettingsMutateResult, SeamSettingsOp, SessionPrunePlan, SessionPurgePrepareResult, SessionSeam } from "../../seams/session"

/** The sanctioned patch-write channel: the host settings mutate face. */
type SettingsMutate = (ns: string, ops: SeamSettingsOp[], revision?: number) => Promise<SeamSettingsMutateResult>
import type { ComposerFlushResult } from "./composer-state"
import { stopEverything } from "./stop-all"
import { hotkeyRows, hotkeysHeader } from "./hotkeys"
import {
	brokenLogsForSession,
	corruptSessionIds,
	emptyFilteredCopy,
	filterSessionsBySizeFloor,
	isRepairableLogRow,
	repairConfirmBody,
	repairConfirmOptions,
	resumePickerOptions,
	type BrokenLogRow,
} from "./resume-picker"
import { formatSessionInfoPanel, sessionInfoRows } from "./session-info"
import {
	formatGoalStatus,
	goalsConfirmOptions,
	goalsConfirmTitle,
	goalsUnknownOp,
	goalsUnknownOpHint,
	parseGoalsArgs,
} from "./goals-command"
import {
	buildModelPickerRows,
	formatDiscoveredModels,
	modelKey,
	readModelPrefsFromConfig,
	toggleStringList,
} from "./model-picker"
import {
	CUSTOM_STEPS,
	LOGIN_MODES,
	LOGIN_PICKER_TITLE,
	PROVIDER_CATALOG,
	buildCustomEntry,
	catalogEntriesFromDirectory,
	deriveKeyRef,
	providerProfileFor,
	validateBaseUrl,
	validateRouteId,
	type CatalogEntry,
	type LoginMode,
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
	type HintLocale,
	type HintSegmentId,
} from "./hints-line"
import { getMotionPreference, getMotionTier, setMotionTier, type MotionTier } from "../../skin/motion"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { exportTargetPath, journalToJSONL } from "./export"

/**
 * Persist the hint-bar selection after a /hints mutation (/motion parity):
 * the FULL record + language ride the profile config.json (`footerHints` +
 * the unified `lang` key — T14: `lang` is THE authoritative language key,
 * the legacy `hintsLocale` stays a read-only boot fallback; configSave
 * routes unlisted keys to the profile), so a restart replays them
 * (hints-line.tsx applyHintsConfig at boot). The bar toggle (`hintsShown`)
 * stays session-scoped. Best-effort: a failed write keeps this session's
 * state and logs.
 */
function persistHints(seam: SessionSeam): void {
	try {
		seam.configSave?.({ footerHints: footerHints(), lang: hintsLocale() })
	} catch (error) {
		console.error("[commands] hints persist failed:", error)
	}
}

/**
 * Persist the unified language key after a /language pick (/motion parity):
 * `lang` is THE authoritative key (T14 storage-key unification — design §1);
 * the caller flips the live language signal right after. Best-effort.
 */
function persistLang(seam: SessionSeam, lang: string): void {
	try {
		seam.configSave?.({ lang })
	} catch (error) {
		console.error("[commands] language persist failed:", error)
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

// --------------------------------------------------------- retention UI helpers --
// Pure + table-testable. No absolute path is ever formatted here: the plan's
// `location` is deliberately ignored and only session ids / ages / counts /
// sizes are shown. `stagedIds` is NOT used as a safety gate — apply safety is
// the host's fresh-plan fingerprints and purge safety is its signed token.

/** Machine skip reason → locale key (the backend's closed PruneReason set). */
const PRUNE_REASON_KEYS: Readonly<Record<string, string>> = {
	"retention-disabled": "command.prune.reason.retentionDisabled",
	"field-anomaly": "command.prune.reason.fieldAnomaly",
	current: "command.prune.reason.current",
	staged: "command.prune.reason.staged",
	"agent-available": "command.prune.reason.agentAvailable",
	running: "command.prune.reason.running",
	"missing-time": "command.prune.reason.missingTime",
	"future-time": "command.prune.reason.futureTime",
	"subtree-running": "command.prune.reason.subtreeRunning",
	unknown: "command.prune.reason.unknown",
	"no-location": "command.prune.reason.noLocation",
	"header-mismatch": "command.prune.reason.headerMismatch",
	"basename-mismatch": "command.prune.reason.basenameMismatch",
	"not-directory": "command.prune.reason.notDirectory",
	"escaped-root": "command.prune.reason.escapedRoot",
	"lock-fresh": "command.prune.reason.lockFresh",
	"lock-held": "command.prune.reason.lockHeld",
	"fresh-mtime": "command.prune.reason.freshMtime",
	"blank-grace": "command.prune.reason.blankGrace",
	"within-retention": "command.prune.reason.withinRetention",
}

export function pruneReasonLabel(reason: string): string {
	const key = PRUNE_REASON_KEYS[reason]
	return key === undefined ? t("command.prune.reason.other", { reason }) : t(key)
}

/** Short byte count for the plan summary (no locale grouping, no path). */
export function formatPruneBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
	const units = ["B", "KB", "MB", "GB", "TB"]
	let value = bytes
	let unit = 0
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024
		unit++
	}
	const shown = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1)
	return `${shown} ${units[unit]}`
}

/** Sum the prune candidates' on-disk sizes from the already-wired session list. */
export function pruneBytes(
	plan: SessionPrunePlan,
	sizeById: ReadonlyMap<string, number>,
): number {
	let total = 0
	for (const entry of plan.entries) {
		if (entry.decision !== "prune") continue
		const size = sizeById.get(entry.sessionId)
		if (typeof size === "number" && Number.isFinite(size) && size > 0) total += size
	}
	return total
}

/** The transcript rows /prune prints before asking for the typed confirm. */
export function formatPrunePlanRows(
	plan: SessionPrunePlan,
	sizeById: ReadonlyMap<string, number> = new Map(),
): string[] {
	const rows = [
		t("command.prune.summary", {
			count: String(plan.counts.prune),
			skipped: String(plan.counts.skip),
			bytes: formatPruneBytes(pruneBytes(plan, sizeById)),
			days: String(plan.retentionDays),
		}),
	]
	const candidates = plan.entries.filter(
		(entry): entry is typeof entry & { ageDays: number } =>
			entry.decision === "prune" && typeof entry.ageDays === "number" && Number.isFinite(entry.ageDays),
	)
	if (candidates.length > 0) {
		const oldest = candidates.reduce((a, b) => (b.ageDays > a.ageDays ? b : a))
		const newest = candidates.reduce((a, b) => (b.ageDays < a.ageDays ? b : a))
		rows.push(t("command.prune.oldest", { id: oldest.sessionId, days: oldest.ageDays.toFixed(1) }))
		rows.push(t("command.prune.newest", { id: newest.sessionId, days: newest.ageDays.toFixed(1) }))
	}
	const reasons = Object.entries(plan.counts.byReason).sort((a, b) => b[1] - a[1]).slice(0, 5)
	if (reasons.length > 0) {
		rows.push(t("command.prune.skipSummary", {
			list: reasons.map(([reason, count]) => `${pruneReasonLabel(reason)}:${count}`).join(", "),
		}))
	}
	return rows
}

/** The transcript rows /prune-purge prints before asking for the typed confirm. */
export function formatPurgePrepareRows(result: SessionPurgePrepareResult): string[] {
	const rows = [t("command.prunePurge.count", { count: String(result.candidates.length) })]
	for (const candidate of result.candidates) {
		rows.push(t("command.prunePurge.entry", {
			id: candidate.id,
			days: candidate.ageDays.toFixed(1),
		}))
	}
	if (result.rejected.length > 0) {
		rows.push(t("command.prunePurge.rejected", {
			count: String(result.rejected.length),
			codes: [...new Set(result.rejected.map((row) => row.code))].join(", "),
		}))
	}
	return rows
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
	/**
	 * Arm the focus-current face (live-language picker regression 2026-11-15):
	 * the selection STARTS on the `currentValue` row instead of row 0, so ↑
	 * moves OFF the marked current row and bare Enter confirms it (unchanged).
	 * Opt-in — the /theme bare-Enter row-0 contract (e2e 67) keeps the default
	 * row-0 focus.
	 */
	focusCurrent?: boolean
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
		 * marker; the selection stays on row 0 unless `extras.focusCurrent`
		 * arms the current-row focus (the /language picker). */
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
	 * Open the skills manager panel (gap C3 — the /skills panel). Optional —
	 * an entry without it degrades /skills to a notice.
	 */
	openSkills?(): void
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
	 * Open the /history two-pane turn browser (gap C1 step 2, tui-pi history
	 * parity). Optional — an entry without it degrades /history to a notice.
	 */
	openHistory?(): void
	/**
	 * Open the /subagents large-window transcript viewer (gap C3, tui-pi
	 * subagent-viewer parity). Optional — an entry without it degrades
	 * /subagents to a notice.
	 */
	openSubagents?(): void
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
	/**
	 * RM-4: reset the recovery UI after a successful `/new` session switch.
	 * The entry wires this to the SAME cleanup the banner's new-session action
	 * uses (RecoveryUiController.clearRecoveryState): footer back to ready,
	 * locked/failed banner + dead phase cleared. Optional — an entry without
	 * recovery UI keeps the plain session switch (no stale state to clear).
	 */
	clearRecoveryUi?(): void
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

// ------------------------------------------------- /permission helpers (026) --
// Pure + table-testable. Mirrors the web permission-presets `optionsOf` risk
// classification (深读 A2-8): full-access / auto presets get a second
// confirmation with an explicit acknowledge; ordinary presets switch directly.
export function isRiskPermissionPreset(value: string, name?: string): boolean {
	return /danger-full-access|full.?access|auto/i.test(`${value} ${name ?? ""}`)
}

/**
 * 026 — basename of a cwd (深读 #1 `workspaceLabel(cwd)`): last path segment,
 * trailing separators stripped, root `/` preserved. undefined/empty stays
 * undefined (honest absence). Pure + table-testable.
 */
export function cwdBasename(cwd: string | undefined): string | undefined {
	if (cwd === undefined || cwd === "") return undefined
	const trimmed = cwd.replace(/[\\/]+$/, "")
	if (trimmed === "") return cwd // root "/"
	const parts = trimmed.split(/[\\/]/)
	return parts[parts.length - 1] || trimmed
}

/** Bare `/permission` view lines from a catalog. Pure for unit testing.
 *
 *  026 review S1: our seam has NO readable current-session preset face. rc.5
 *  does register a `permissions` projection with `currentValue`, but the bridge
 *  wires `session/observeProjections` only as a raw push stream with no consumer
 *  face — wiring one is a new capability slice, not this one-line fix. So never
 *  label `defaultPreset` as "current" (that lies whenever default !== current,
 *  i.e. after a switch). State only what we can actually read and defer the
 *  current-session value to the host. */
export function permissionCatalogLines(catalog: SeamPermissionCatalog): string[] {
	const names = catalog.options.map((option) => option.value).join(", ")
	const lines = [`available presets: ${names}`]
	for (const option of catalog.options) {
		const detail = option.description === undefined || option.description === "" ? "" : ` — ${option.description}`
		lines.push(`${option.value}${detail}`)
	}
	lines.push(`default preset: ${catalog.defaultPreset}`)
	lines.push("current session preset is host-authoritative (not readable here); use /permission <preset> to set it")
	return lines
}

// ----------------------------------------------------------- /login helpers --
// Batch H4 (tui-pi 65-ux-batch parity). The commit is the old-stack
// double-write; the chain is the six-step loop. Exported for table tests.

export interface LoginFace {
	credentialStatus(ref: string): Promise<{ configured: boolean }>
	login(ref: string, apiKey: string): Promise<void>
	logout(ref: string): Promise<void>
	/** The configured routes with their profile bodies (see SeamLoginRoute). */
	routes(): Promise<SeamLoginRoute[]>
	/** Plan a route write; the caller applies it via the settings face. */
	registerRoute(providerId: string, profile: Record<string, unknown> | undefined): Promise<SeamRegisterRoutePlan>
}

/** Apply a planned provider-route write through the host settings channel. */
async function applyRoutePlan(
	plan: SeamRegisterRoutePlan,
	settings: SettingsMutate | undefined,
	onFailure: (reason: string) => void,
): Promise<boolean> {
	if (plan.kind === "invalid") {
		onFailure(plan.reason)
		return false
	}
	if (plan.kind === "noop") return true
	if (settings === undefined) {
		onFailure("host settings channel unavailable")
		return false
	}
	const result = await settings(plan.ns, plan.ops).catch((error: unknown) => ({
		ok: false as const,
		conflict: false,
		error: error instanceof Error ? error.message : String(error),
	}))
	if (!result.ok) {
		onFailure(result.error)
		return false
	}
	return true
}

/** A step title with an inline validation error appended (re-prompt view). */
export function loginStepTitle(stepTitle: string, error?: string): string {
	return error ? `${stepTitle} — ${error}` : stepTitle
}

/**
 * P0-3 — pre-write consistency check for the profile-directory writes that
 * /login and /logout perform. Both the route plan and the key file land in the
 * client's profile directory; if the dsh process that is actually running
 * loads a DIFFERENT profile, a "successful" login is invisible to /model and
 * the user gets no hint. Refuse before writing and say both directories plus
 * the repair. A seam that does not publish the fact skips the check (it is
 * never guessed from the client's own value).
 */
function profileDirsAgree(seam: SessionSeam, say: (text: string) => void): boolean {
	const state = seam.settings?.profileConsistency?.()
	if (!state || state.ok) return true
	say(t("command.profile.mismatch", { clientDir: state.clientDir, hostDir: state.hostDir }))
	return false
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
	settings?: SettingsMutate,
	seam?: SessionSeam,
): Promise<void> {
	// The old stack's empty-commit guard: an empty key fired a credentials.set
	// the host rejects AND registered a garbage route. An empty key is a
	// swallowed no-op (esc stays the cancel path).
	if (!key.trim()) {
		say(t("command.login.cancelledEmptyKey"))
		return
	}
	// P0-3: refuse the WHOLE commit (route + key) before touching either file
	// when the client's profile directory is not the one the host loads.
	if (seam && !profileDirsAgree(seam, say)) return
	const plan = await face.registerRoute(entry.id, providerProfileFor(entry))
	const registered = await applyRoutePlan(plan, settings, () => {
		say(t("command.login.routeRegistrationFailed", { id: entry.id }))
	})
	if (!registered) {
		return
	}
	try {
		await face.login(deriveKeyRef(entry.id), key)
	} catch (e) {
		say(t("command.login.keyStoreFailed", { id: entry.id, detail: String(e instanceof Error ? e.message : e).slice(0, 150) }))
		return
	}
	say(t("command.login.subscribed", { name: entry.name }))
}

/**
 * C13 /resume repair flow (dsh-tui-pi `offerCorruptedLogRepair` parity, the
 * repair-dialog.ts semantics on the generic pickOne modal): the picked
 * session's log failed the integrity scan, so the repair is offered behind
 * an EXPLICIT confirmation dialog. It never runs silently:
 *
 *   - Cancel (or esc) leaves the log untouched and reports the original
 *     reasons — the resume path does NOT run.
 *   - Confirm runs the guarded seam repair (the repaired copy is verified
 *     beside the original before the canonical name is touched). A `failed`
 *     result keeps the log untouched-or-restored and stops the resume;
 *     `clean` (nothing needed) and `repaired` both let the resume proceed.
 *   - A non-repairable category (0-byte / zstd) NEVER reaches the confirm
 *     dialog: no "Repair & resume" option is offered for a repair that
 *     cannot succeed — the reason is reported plainly instead.
 *
 * Resolves true only when the resume path should re-enter.
 */
export async function offerCorruptedLogRepair(
	ctx: Pick<SlashCommandContext, "say" | "pickOne"> & { seam: SessionSeam },
	sessionId: string,
	broken: readonly BrokenLogRow[],
): Promise<boolean> {
	if (broken.length === 0) {
		ctx.say(t("command.repair.noBrokenLog", { id: sessionId }))
		return false
	}
	if (!ctx.seam.repairSessionLog) {
		ctx.say(t("command.repair.unavailable"))
		return false
	}
	const unrepairable = broken.filter((row) => !isRepairableLogRow(row))
	if (unrepairable.length > 0) {
		// A doomed action gets no confirm option: report the reason directly,
		// touch nothing, and do not resume.
		ctx.say(
			t("command.repair.unrepairable", { id: sessionId, detail: repairConfirmBody(unrepairable).join("; ") }),
		)
		return false
	}
	const confirm = await ctx.pickOne(
		`Session ${sessionId} has a broken log (${repairConfirmBody(broken).join("; ")}) — repair it?`,
		repairConfirmOptions(),
	)
	if (confirm !== "repair") {
		ctx.say(t("command.repair.cancelled", { detail: repairConfirmBody(broken).join("; ") }))
		return false
	}
	for (const row of broken) {
		const result = ctx.seam.repairSessionLog(row.path)
		if (result.kind === "failed") {
			ctx.say(t("command.repair.failed", { name: row.name, detail: result.detail }))
			return false
		}
		if (result.kind === "clean") {
			ctx.say(t("command.repair.notNeeded", { name: row.name }))
		} else {
			ctx.say(t("command.repair.done", { name: row.name, backupPath: result.backupPath }))
		}
	}
	return true
}

/** The masked key step + commit for a catalog provider. */
/**
 * 025-w2-4 — resolve /login picker entries from the REAL host directory first,
 * falling back to the static catalog with an honest notice when the directory
 * is absent (service UNSUPPORTED / NOT_WIRED) or empty. Never a fake-empty
 * picker: the static catalog always fills the list, and `degraded` drives the
 * user-facing "real directory unavailable" line. The registered + configurable
 * faces are independent: one failing does not discard the other's rows.
 */
export async function resolveLoginCatalog(
	seam: SessionSeam,
	say: (text: string) => void,
): Promise<{ entries: CatalogEntry[]; degraded: boolean }> {
	const dir = seam.providerDirectory
	// A seam without the face at all is an older client: use the static catalog
	// silently (no notice — there was no real-directory promise to degrade).
	if (!dir) return { entries: [...PROVIDER_CATALOG], degraded: false }
	let registered: { id: string; name: string }[] = []
	let configurable: { provider: string; displayName: string; error?: string }[] = []
	let failed = false
	try {
		registered = await dir.registered()
	} catch {
		failed = true
	}
	try {
		configurable = await dir.configurable()
	} catch {
		failed = true
	}
	const real = catalogEntriesFromDirectory(registered, configurable)
	if (real.length === 0) return { entries: [...PROVIDER_CATALOG], degraded: true }
	if (failed) say(t("command.login.directoryPartial"))
	return { entries: real, degraded: false }
}

export async function commitCatalogLogin(
	ctx: Pick<SlashCommandContext, "promptText" | "say" | "seam">,
	face: LoginFace,
	entry: CatalogEntry,
): Promise<void> {
	const key = await ctx.promptText?.(`API key for ${entry.name} (${deriveKeyRef(entry.id)})`, { mask: true })
	if (key === undefined) return
	await commitLoginRoute(ctx.say, face, entry, key, ctx.seam.settings?.mutate?.bind(ctx.seam.settings), ctx.seam)
}

/**
 * The six-step chained form (the reference 65 flow). Each step re-prompts
 * on an invalid value (the inline error rides the title); esc at any step
 * aborts the WHOLE flow; the optional steps (2 display name, 3 protocol)
 * commit on an empty Enter with their defaults.
 */
export async function runCustomLoginChain(
	ctx: Pick<SlashCommandContext, "promptText" | "say" | "seam">,
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
				ctx.say(t("command.login.cancelled"))
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
			await commitLoginRoute(ctx.say, face, entry, trimmed, ctx.seam.settings?.mutate?.bind(ctx.seam.settings), ctx.seam)
			return
		}
	}
}

/**
 * D8 — the bare `/login` entrance rows. Labels ride i18n (the leak guard
 * forbids hardcoded user copy in this file); the values are the closed
 * LoginMode set so a pick can only be one of the three contracted entrances.
 */
export function loginModeOptions(): { title: string; value: LoginMode; description: string }[] {
	return [
		{ title: t("command.login.mode.account.title"), value: "account", description: t("command.login.mode.account.hint") },
		{ title: t("command.login.mode.thirdParty.title"), value: "third-party", description: t("command.login.mode.thirdParty.hint") },
		{ title: t("command.login.mode.custom.title"), value: "custom", description: t("command.login.mode.custom.hint") },
	]
}

/**
 * The third-party entrance: the real provider directory (static fallback),
 * the masked key step, then the shared double-write. P0-3 lives in
 * commitLoginRoute, so this entrance cannot write into a mismatched profile.
 */
export async function runThirdPartyLogin(
	ctx: Pick<SlashCommandContext, "promptText" | "say" | "seam" | "pickOne">,
	face: LoginFace,
): Promise<void> {
	const { entries, degraded } = await resolveLoginCatalog(ctx.seam, ctx.say)
	if (degraded) ctx.say(t("command.login.directoryDegraded"))
	const picked = await ctx.pickOne(
		LOGIN_PICKER_TITLE,
		entries.map((e) => ({ title: e.name, value: e.id, description: e.hint })),
	)
	if (!picked) return
	const entry = entries.find((e) => e.id === picked)
	if (!entry) return
	await commitCatalogLogin(ctx, face, entry)
}

/**
 * The DeepSeek-account state machine, shared by /account and the /login
 * "account" entrance. Uses ONLY the existing seam.account face; the TUI never
 * invents an authorize URL or a callback port (the seam deliberately projects
 * no URL value). The host requires an explicit port on the sign-in origin, and
 * the TUI must not fabricate one, so browser sign-in stays unavailable in this
 * build until the carrier supplies a real loopback origin.
 */
export async function runAccountFlow(
	ctx: Pick<SlashCommandContext, "say" | "seam">,
	argText: string,
): Promise<void> {
	const face = ctx.seam.account
	if (!face) {
		ctx.say(t("command.account.unavailable"))
		return
	}
	const show = (state: SeamAccountState): void => {
		ctx.say(t("command.account.state", {
			status: state.status ?? "—",
			phase: state.attemptPhase ?? "—",
			urlReady: state.authorizeUrlReady ? "✓" : "—",
			links: state.linksPresent ? "✓" : "—",
		}))
	}
	const arg = argText.trim().toLowerCase()
	try {
		if (!arg || arg === "state") show(await face.getState())
		else if (arg === "signin") {
			// The TUI never supplies an origin: the host requires an explicit
			// port and this build has no carrier loopback origin to pass.
			ctx.say(t("command.account.signinUnavailable"))
			return
		}
		else if (arg === "signout") show(await face.signOut())
		else ctx.say(t("command.account.unknownAction", { action: argText.trim() }))
	} catch (error) {
		ctx.say(t("command.account.failed", { reason: seamFailureReason(error) }))
	}
}

/** The account entrance's own panel: probe the face first (P1-1), then pick
 * among the two actions this build supports. Esc leaves every account state
 * untouched; browser sign-in is not offered because the TUI has no real
 * loopback origin to hand the host. */
async function runAccountEntrance(ctx: Pick<SlashCommandContext, "say" | "seam" | "pickOne">): Promise<void> {
	if (!ctx.seam.account) {
		ctx.say(t("command.account.unavailable"))
		return
	}
	const action = await ctx.pickOne(t("command.login.account.title"), [
		{ title: t("command.login.account.state"), value: "state" },
		{ title: t("command.login.account.signout"), value: "signout" },
	])
	if (!action) return
	await runAccountFlow(ctx, action)
}

// ----------------------------------------------------------- /logout helpers --
// Gap fix (C8): the login/logout seam has existed since batch H4, but /logout
// had no caller. Behavior mirrors the reference (dsh-tui-pi openLogoutFlow):
// list the routes whose key ref holds a stored credential, pick one, drop the
// key first (the security-critical half), then clear the route — EXCEPT for
// custom (hand-declared) routes, whose api/baseURL/models profile the catalog
// commit cannot re-create, so they keep the route (the reference's
// hand-declared arm). Picker selection is the commit boundary — the reference
// drives no extra confirm dialog.

/** One actionable logout target derived from a configured route. */
export interface LogoutTarget {
	id: string
	/** Profile display name, else the catalog name, else the raw route id. */
	name: string
	/**
	 * The env-ref the key is stored under: the profile's own `apiKeyEnv` when
	 * it names one (a hand-edited profile may point anywhere — deriving from
	 * the id would unset an unrelated key and strand the real one), else the
	 * conventional derived ref (the reference contract,
	 * tui-pi login.ts logoutCandidatesFromSection).
	 */
	ref: string
	/** Hand-declared route: logout drops only the key, never the route. */
	custom: boolean
}

/**
 * Pure classifier: configured routes → picker rows. A live `declared` flag
 * (profile carries its own api/baseURL/models) marks the route hand-declared
 * even when the client's static catalog mirror lists the id; an id absent
 * from the mirror is custom too (the mirror is the fallback signal — the
 * reference prefers the live flag and falls back to its catalog stand-in).
 */
export function logoutTargets(routes: readonly SeamLoginRoute[]): LogoutTarget[] {
	return routes.map((route) => {
		const entry = PROVIDER_CATALOG.find((e) => e.id === route.id)
		return {
			id: route.id,
			name: route.displayName ? route.displayName : (entry?.name ?? route.id),
			ref: route.apiKeyEnv ?? deriveKeyRef(route.id),
			custom: route.declared === true || entry === undefined,
		}
	})
}

/** The batch-8 core set, bound to a context at call time (pure table). */
export function coreCommands(): SlashCommand[] {
	return [
		{
			name: "/help",
			description: t("command.help.description"),
			run(ctx) {
				for (const command of coreCommands()) ctx.say(t("command.help.entry", { name: command.name, description: command.description }))
			},
		},
		{
			name: "/new",
			description: t("command.new.description"),
			async run(ctx) {
				ctx.seam.newSession()
				// A fresh session has no stored history: clear explicitly. The
				// reload used to imply the wipe through an errored "" read —
				// that path is gone (transcript-loss fix), and old rows must
				// not survive a /new.
				ctx.clear()
				await ctx.reload()
				// RM-4: a session switch must retire the stale recovery UI too.
				// The typed path used to stop here, leaving the dead footer and
				// locked banner up even though the session had changed. The
				// entry routes this to the same cleanup the banner action calls.
				ctx.clearRecoveryUi?.()
				ctx.say(t("command.new.created", { id: ctx.seam.currentSessionId() ?? "(unnamed)" }))
			},
		},
		{
			name: "/model",
			description: t("command.model.description"),
			async run(ctx, argText) {
				// A previously SILENT selection failure (the staged route's
				// re-send onto the last session create, a fire-and-forget
				// switchModel): surface it before this pick — the footer label
				// may still name a route the host never accepted.
				const pendingSelectionError = ctx.seam.lastSelectionError?.()
				if (pendingSelectionError) {
					ctx.say(t("command.model.stagedSwitchFailed", { reason: pendingSelectionError }))
				}
				const arg = argText.trim()
				// 025-w3-2 — minimal discovery entry: `/model discover` asks the
				// hand-written llm/discoverModels face for the current provider's
				// models. No credential is passed (the seam request shape has no
				// apiKey); service absence / no source degrades honestly.
				if (arg === "discover") {
					const discover = ctx.seam.providerDirectory?.discover
					if (typeof discover !== "function") {
						ctx.say(t("command.model.discoverUnavailable", { reason: "no discovery face" }))
						return
					}
					let providerID = "default"
					try {
						providerID = (await ctx.seam.currentModelSelection?.())?.providerID ?? "default"
					} catch { /* provider is only a discovery hint */ }
					ctx.say(t("command.model.discovering", { provider: providerID }))
					try {
						const models = await discover("llm", { provider: providerID })
						if (models.length === 0) {
							ctx.say(t("command.model.discoverEmpty"))
							return
						}
						const list = formatDiscoveredModels(models)
						ctx.say(t("command.model.discovered", { n: models.length, list }))
					} catch (error) {
						ctx.say(t("command.model.discoverUnavailable", { reason: seamFailureReason(error) }))
					}
					return
				}
				if (arg) {
					const [providerID, modelID] = arg.split("/")
					if (!providerID || !modelID) {
						ctx.say(t("command.model.usage", { arg }))
						return
					}
					// Argument form stays one-shot (script/muscle-memory path):
					// no second stage, byte-identical to the pre-two-stage flow.
					try {
						await ctx.seam.selectModel(providerID, modelID)
					} catch (error) {
						ctx.say(t("command.model.switchFailed", { reason: seamFailureReason(error) }))
						return
					}
					ctx.say(t("command.model.set", { model: `${providerID}/${modelID}` }))
					ctx.refreshFooter?.()
					return
				}
				// The in-process bridge has no `session/modelCatalog` (or `selectModel`)
				// wire, so its seam rejects here with BridgeProtocolError(UNSUPPORTED).
				// `slash-palette` runs commands via `void command.run()`, which would
				// turn that rejection into an unhandled rejection / Console popup.
				// Degrade THIS chain to a clear notice (the remote stack keeps the
				// normal picker path): never leak the exception, never fake a catalog.
				let catalog: Awaited<ReturnType<SessionSeam["modelCatalog"]>>
				let current: Awaited<ReturnType<SessionSeam["currentModelSelection"]>>
				try {
					catalog = await ctx.seam.modelCatalog()
					current = await ctx.seam.currentModelSelection()
				} catch (error) {
					ctx.say(t("command.model.unavailable", { reason: seamFailureReason(error) }))
					return
				}
				if (catalog.length === 0) {
					ctx.say(t("command.model.emptyCatalog"))
					return
				}
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
						ctx.say(t("command.model.switchFailed", { reason: seamFailureReason(error) }))
						return
					}
					ctx.say(t("command.model.setNoThink", { model: picked }))
					if (keptEffort !== undefined) {
						try {
							await thinking?.selectEffort(keptEffort)
						} catch (error) {
							ctx.say(t("command.thinking.switchFailed", { reason: seamFailureReason(error) }))
							ctx.refreshFooter?.()
							return
						}
						ctx.say(t("command.thinking.setNext", { effort: keptEffort }))
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
					ctx.say(t("command.model.unchanged"))
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
					ctx.say(t("command.model.switchFailed", { reason: seamFailureReason(error) }))
					return
				}
				ctx.say(t("command.model.set", { model: picked }))
				try {
					await thinking?.selectEffort(effort)
				} catch (error) {
					ctx.say(t("command.thinking.switchFailed", { reason: seamFailureReason(error) }))
					ctx.refreshFooter?.()
					return
				}
				ctx.say(t("command.thinking.setNext", { effort: effortPicked === MODEL_DEFAULT_EFFORT_PICK ? "model default" : effortPicked }))
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
			description: t("command.login.description"),
			async run(ctx, argText) {
				const face = ctx.seam.login
				if (!face || !ctx.promptText || !ctx.pickOne) {
					ctx.say(t("command.login.unavailable"))
					return
				}
				const arg = argText.trim().toLowerCase()
				// Argument form stays the direct catalog target (script / muscle-memory
				// path) — byte-identical to the pre-three-entrance flow.
				if (arg) {
					// 025-w2-4 — real provider directory first, static catalog fallback.
					const { entries, degraded } = await resolveLoginCatalog(ctx.seam, ctx.say)
					if (degraded) ctx.say(t("command.login.directoryDegraded"))
					const entry = entries.find((e) => e.id === arg)
					if (!entry) {
						ctx.say(t("command.login.unknownProvider", { provider: arg }))
						return
					}
					await commitCatalogLogin(ctx, face, entry)
					return
				}
				// D8 — bare /login opens the THREE-entrance picker first. The old flat
				// "Add provider" picker now lives behind the "third-party" entrance;
				// the six-step form lives behind "custom"; the account state machine
				// (previously only /account) lives behind "account".
				const mode = await ctx.pickOne(t("command.login.mode.title"), loginModeOptions())
				if (!mode || !LOGIN_MODES.some((m) => m === mode)) return
				if (mode === "account") {
					await runAccountEntrance(ctx)
					return
				}
				if (mode === "custom") {
					const routes = (await face.routes().catch(() => [])).map((route) => route.id)
					await runCustomLoginChain(ctx, face, routes)
					return
				}
				if (mode === "third-party") {
					await runThirdPartyLogin(ctx, face)
				}
			},
		},
		{
			// Gap fix (C8): the logout half of the batch-H4 login face — the
			// seam carried logout/credentialStatus all along, but nothing
			// called them. Bare opens the picker over the routes whose key ref
			// probes configured; "/logout <id>" targets one directly (exact,
			// case-sensitive id match — route ids are mixed-case). Commit
			// mirrors the reference commitLogout ordering: the key
			// (credentials/unset) first — a failed unset never touches the
			// route — then the route clears for catalog rows only (custom
			// routes keep their api/baseURL/models profile: the catalog commit
			// could not re-create it). A failed route clear keeps the key
			// removal (it is reported, never rolled back).
			name: "/logout",
			description: t("command.logout.description"),
			async run(ctx, argText) {
				const face = ctx.seam.login
				if (!face) {
					ctx.say(t("command.logout.unavailable"))
					return
				}
				// A dead settings seam is an ERROR, not an empty login list (the
				// reference throws "settings service is not available"): only a
				// genuinely empty/unconfigured route table reads as "no
				// logged-in providers" — a flattened failure would have the
				// user believe no keys remain.
				let routes: SeamLoginRoute[]
				try {
					routes = await face.routes()
				} catch (error) {
					ctx.say(t("command.logout.failed", { reason: seamFailureReason(error) }))
					return
				}
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
					ctx.say(t("command.logout.none"))
					return
				}
				const arg = argText.trim()
				let target = arg ? loggedIn.find((t) => t.id === arg) : undefined
				if (arg && !target) {
					ctx.say(t("command.logout.notLoggedIn", { provider: arg }))
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
			// P0-3: same pre-write guard as /login — never remove a key or a
			// route from a profile the running dsh process does not load.
			if (!profileDirsAgree(ctx.seam, ctx.say)) return
			try {
				await face.logout(target.ref)
			} catch (error) {
				ctx.say(t("command.logout.routeFailed", { id: target.id, reason: seamFailureReason(error) }))
				return
			}
			if (target.custom) {
				ctx.say(t("command.logout.done", { name: target.name }))
				return
			}
			// P1: keep the reason instead of swallowing it. A route-clear failure
			// must tell the user what broke AND what to do next, not just "failed".
			let plan: SeamRegisterRoutePlan | undefined
			let planError: unknown
			try {
				plan = await face.registerRoute(target.id, undefined)
			} catch (error) {
				planError = error
			}
			let clearReason: string | undefined
			const cleared = plan !== undefined && await applyRoutePlan(
				plan,
				ctx.seam.settings?.mutate?.bind(ctx.seam.settings),
				(reason) => { clearReason = reason },
			)
			const reason = planError !== undefined
				? seamFailureReason(planError)
				: plan === undefined
					? "no route-clear plan was produced"
					: clearReason ?? "unknown failure"
			ctx.say(
				cleared
					? t("command.logout.routeRemoved", { name: target.name })
					: t("command.logout.routeRemoveFailed", { name: target.name, id: target.id, reason }),
			)
			},
		},
		{
			name: "/quit",
			description: t("command.quit.description"),
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
			description: t("command.resume.description"),
			async run(ctx) {
				// The store list must FAIL LOUD, never read as empty: a list
				// failure here (dead seam, adopted host without the route) used
				// to flatten to [] and print the lie "no stored sessions"
				// (parity with the /logout dead-seam contract in 02e1608).
				let sessions: SeamSessionSummary[]
				try {
					sessions = await ctx.seam.listSessions()
				} catch (error) {
					ctx.say(t("command.resume.unavailable", { reason: seamFailureReason(error) }))
					return
				}
				if (sessions.length === 0) {
					ctx.say(t("command.resume.empty"))
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
				ctx.say(t("command.resume.done", { name: picked }))
			},
		},
		{
			name: "/clear",
			description: t("command.clear.description"),
			run(ctx) {
				ctx.clear()
				ctx.say(t("command.clear.done"))
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
			description: t("command.flush.description"),
			run(ctx) {
				if (!ctx.flushQueue) {
					ctx.say(t("command.flush.unavailable"))
					return
				}
				const result = ctx.flushQueue()
				if (result.kind === "empty") {
					ctx.say(t("command.flush.empty"))
					return
				}
				if (result.kind === "busy") {
					ctx.say(t("command.flush.busy", { remaining: result.remaining }))
					return
				}
				ctx.say(
					t("command.flush.flushed", { started: result.started, remaining: result.remaining }),
				)
			},
		},
		{
			// Feature batch F3. Never busy-gated: the side call rides a throwaway
			// session, so a mid-turn /btw streams alongside the main turn.
			name: "/btw",
			description: t("command.btw.description"),
			run(ctx, argText) {
				if (!ctx.seam.btwAsk || !ctx.openBtw) {
					ctx.say(t("command.btw.unavailable"))
					return
				}
				ctx.openBtw(argText)
			},
		},
		{
			// Feature batch F4. Prints the info panel as an aligned transcript
			// block (the /help print path) — no overlay, no busy-gate.
			name: "/session",
			description: t("command.session.description"),
			async run(ctx) {
				if (!ctx.seam.sessionInfo) {
					ctx.say(t("command.session.unavailable"))
					return
				}
				const info = await ctx.seam.sessionInfo()
				if (!info || info.sessionId === null) {
					ctx.say(t("command.session.noActive"))
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
			description: t("command.plugins.description"),
			run(ctx) {
				if (!ctx.seam.plugins) {
					ctx.say(t("command.plugins.unavailable"))
					return
				}
				if (ctx.openPlugins) {
					ctx.openPlugins()
					return
				}
				const plugins = ctx.seam.plugins()
				if (plugins.length === 0) {
					ctx.say(t("command.plugins.none"))
					return
				}
				for (const plugin of plugins) ctx.say(t("command.plugins.entry", { name: plugin.name, version: plugin.version }))
			},
		},
		{
			// 025-w2-5 — the /goal status surface. No args = read current goal
			// (zero-side-effect default). Explicit write subcommands go through a
			// yes/no confirm before touching the seam. Service absence / no active
			// session -> honest degrade notice, never a fake-empty goal.
			name: "/goal",
			description: t("command.goals.description"),
			async run(ctx, argText) {
				const goals = ctx.seam.goals
				if (!goals) {
					ctx.say(t("command.goals.unavailable"))
					return
				}
				// W2-5 S-3 hygiene: a misspelled subcommand used to fall through to
				// status silently. Surface an explicit, i18n-keyed hint first.
				const unknownOp = goalsUnknownOp(argText)
				if (unknownOp !== undefined) ctx.say(goalsUnknownOpHint(unknownOp))
				const op = parseGoalsArgs(argText)
				if (op.kind === "status") {
					try {
						const view = await goals.status()
						if (view === undefined) {
							ctx.say(t("command.goals.none"))
							return
						}
						for (const line of formatGoalStatus(view)) ctx.say(line)
					} catch {
						ctx.say(t("command.goals.degraded"))
					}
					return
				}
				// Write subcommands are explicit intent. create/edit need an objective
				// (prompt when omitted); esc/empty objective aborts with no side effect.
				let objective = op.kind === "create" || op.kind === "edit" ? op.objective : ""
				if ((op.kind === "create" || op.kind === "edit") && objective === "" && ctx.promptText) {
					const answer = await ctx.promptText(t("command.goals.prompt.objective"))
					objective = (answer ?? "").trim()
				}
				if ((op.kind === "create" || op.kind === "edit") && objective === "") {
					ctx.say(t("command.goals.aborted"))
					return
				}
				const confirmed = ctx.pickOne
					? (await ctx.pickOne(goalsConfirmTitle(op), goalsConfirmOptions())) === "yes"
					: false
				if (!confirmed) {
					ctx.say(t("command.goals.aborted"))
					return
				}
				try {
					if (op.kind === "create") {
						const ref = await goals.create(objective)
						ctx.say(ref ? t("command.goals.created", { id: ref.id, revision: ref.revision }) : t("command.goals.failed"))
					} else {
						// Every other mutation is a CAS on the current goal ref — read it
						// ONCE (no racy double status), and refuse cleanly when no goal is current.
						const view = await goals.status()
						if (view === undefined) {
							ctx.say(t("command.goals.none"))
							return
						}
						const ref = { id: view.id, revision: view.revision }
						if (op.kind === "edit") {
							const edited = await goals.edit(ref, { objective })
							ctx.say(edited ? t("command.goals.edited") : t("command.goals.failed"))
						} else {
							const changed = await goals[op.kind](ref)
							ctx.say(changed ? t("command.goals.updated", { op: op.kind }) : t("command.goals.failed"))
						}
					}
				} catch {
					ctx.say(t("command.goals.degraded"))
				}
			},
		},
		{
			// Gap C3 (tui-pi skills-manager parity): the Installed/Available
			// skill browser over the local skill roots. The host has no skills
			// management RPC (only the read-only session-scoped `skills/list`
			// catalog), so the panel manages the directories the provider
			// scans — space marks, enter applies the symlink batch (see
			// skills-manage.ts for the safety semantics). Purely local UI, so
			// never busy-gated.
			name: "/skills",
			description: t("command.skills.description"),
			run(ctx) {
				if (!ctx.openSkills) {
					ctx.say(t("command.skills.unavailable"))
					return
				}
				ctx.openSkills()
			},
		},
		{
			// Feature batch H3 (tui-pi 77 search parity). Opens the
			// cross-session FTS overlay over the seam's searchSessions face
			// (both adapters carry it 1:1). Never busy-gated — the query is a
			// pure read over the stored corpus, not a model turn.
			name: "/search",
			description: t("command.search.description"),
			run(ctx) {
				if (!ctx.openSearch) {
					ctx.say(t("command.search.unavailable"))
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
			// degrades to the plain table. S5: both seams carry the real agents
			// face, so /agents always opens the panel-kit modal (no unavailable
			// degrade path — the old one hid the missing-face structural red).
			name: "/agents",
			description: t("command.agents.description"),
			run(ctx, argText) {
				if (!ctx.openAgents) {
					ctx.say(t("command.agents.panelNotMounted"))
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
			description: t("command.settings.description"),
			run(ctx) {
				if (!ctx.openSettings) {
					ctx.say(t("command.settings.panelNotMounted"))
					return
				}
				ctx.openSettings()
			},
		},
		{
			// B2 gap C1 step 2 (tui-pi history.ts parity): opens the two-pane
			// turn browser — left = completed-turn list, right = the selected
			// turn's detail; Enter/c refills the composer with the turn's first
			// human prompt, s switches the browsed session, f forks at the
			// selected turn (seam.forkSession), esc closes. A bare read over
			// the stored journal — never busy-gated.
			name: "/history",
			description: t("command.history.description"),
			run(ctx) {
				if (!ctx.openHistory) {
					ctx.say(t("command.history.panelNotMounted"))
					return
				}
				ctx.openHistory()
			},
		},
		{
			// Gap C12 (tui-pi export parity, design §4 D2): dump the session's
			// RAW durable journal as JSONL. Reads through the seam's optional
			// `sessionJournal` face (the /history fold input — no new entry
			// hook, so the slash-deps hand-copied table is untouched); the FS
			// write lives HERE in the run (the commands.ts registry red line:
			// no top-level side effects). Default target carries the tui-pi
			// habit (~/Downloads/dsh-session-<id8>.jsonl); an arg resolves
			// against the client cwd. Format honesty (design §3c): the rows
			// are host-native journal envelopes (SessionWireEvent shape), NOT
			// a verified tui-pi snapshotEvents replay — the done line says so.
			name: "/export",
			description: t("command.export.description"),
			async run(ctx, argText) {
				const sessionId = ctx.seam.currentSessionId()
				if (!sessionId) {
					ctx.say(t("command.export.noSession"))
					return
				}
				if (!ctx.seam.sessionJournal) {
					ctx.say(t("command.export.unavailable"))
					return
				}
				try {
					const entries = await ctx.seam.sessionJournal(sessionId)
					const target = exportTargetPath(sessionId, argText)
					await mkdir(dirname(target), { recursive: true })
					await writeFile(target, journalToJSONL(entries))
					ctx.say(
						t("command.export.done", { count: entries.length, target }),
					)
				} catch (error) {
					ctx.say(t("command.export.failed", { reason: seamFailureReason(error) }))
				}
			},
		},
		{
			// Gap C3 (tui-pi subagent-viewer parity): the command twin of the
			// ↓ picker — opens the large-window transcript viewer over the
			// session's subagents (list → live transcript → steer/stop). A
			// pure read over the panel snapshot — never busy-gated. An empty
			// roster answers honestly instead of opening an empty window; a
			// missing hook degrades to the notice (the /plugins contract).
			name: "/subagents",
			description: t("command.subagents.description"),
			run(ctx) {
				if (!ctx.openSubagents) {
					ctx.say(t("command.subagents.panelNotMounted"))
					return
				}
				const views = ctx.seam.subagentViews?.() ?? []
				if (views.length === 0) {
					ctx.say(t("command.subagents.none"))
					return
				}
				ctx.openSubagents()
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
			description: t("command.think.description"),
			async run(ctx) {
				const thinking = ctx.seam.thinking
				if (!thinking) {
					ctx.say(t("command.think.unavailable"))
					return
				}
				const efforts = await thinking.efforts()
				if (efforts.length === 0) {
					ctx.say(t("command.think.noEfforts"))
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
					ctx.say(t("command.thinking.switchFailed", { reason: seamFailureReason(error) }))
					return
				}
				ctx.say(t("command.thinking.setNext", { effort: picked }))
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
			// segments; `all on|off` bulk-sets them; `lang <locale>` persists the
			// unified language (en/zh-CN; ja/ko degrade to en — applies live).
			name: "/hints",
			description: t("command.hints.description"),
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
					const picked = raw
						? HINT_LOCALES.find((locale) => locale.toLowerCase() === raw.toLowerCase())
						: undefined
					if (!picked) {
						ctx.say(t("command.hints.usageLang", { locales: HINT_LOCALES.join("|"), current: hintsLocale() }))
						return
					}
					// T8 fold (design §1 cut 2): ja/ko keep their command surface but
					// have no bundled locale file — the pick degrades to en with a
					// warning. Live-switch: persist through the seam, then flip the
					// language signal immediately (no restart).
					const degraded = picked !== "en" && picked !== "zh-CN"
					const next = degraded ? "en" : picked
					setHintsLocale(next)
					persistHints(ctx.seam)
					setLanguage(next)
					ctx.say(
						degraded
							? t("command.hints.langDegraded", { lang: picked })
							: t("command.hints.langSet", { lang: next }),
					)
					return
				}
				// A given state word must be exactly on|off — anything else is a
				// typo ("/hints scroll of") and errors instead of silently
				// meaning "on".
				const stateOn = state === undefined ? undefined : state === "on" ? true : state === "off" ? false : null
				if (stateOn === null) {
					ctx.say(t("command.hints.usageSegment", { segment: head, got: state }))
					return
				}
				if (head === "all") {
					const on = stateOn ?? true
					const all: FooterHints = { ...DEFAULT_FOOTER_HINTS }
					for (const seg of FOOTER_HINT_IDS) all[seg] = on
					setFooterHints(all)
					persistHints(ctx.seam)
					ctx.say(t("command.hints.allSet", { state: on ? "on" : "off" }))
					return
				}
				if (!FOOTER_HINT_IDS.includes(head as HintSegmentId)) {
					ctx.say(t("command.hints.unknownSegment", { segment: head, segments: FOOTER_HINT_IDS.join(", ") }))
					return
				}
				const id = head as HintSegmentId
				const on = stateOn === undefined ? !footerHints()[id] : stateOn
				setFooterHints((hints) => ({ ...hints, [id]: on }))
				persistHints(ctx.seam)
				if (on && !hintInState(id, false)) {
					ctx.say(t("command.hints.segmentBusy", { segment: id }))
				} else {
					ctx.say(t("command.hints.segmentSet", { segment: id, state: on ? "on" : "off" }))
				}
			},
		},
		{
			// T14 (design §1/§3, tui-pi /language ask-chain parity): the unified
			// language face. Bare opens the picker over the installed languages
			// (the generic pickOne modal — the /theme shape; the current row
			// carries the vendored `●` marker); `<id>` targets directly
			// (case-insensitive onto the installed ids). The pick persists the
			// UNIFIED `lang` profile key (THE authority — /hints lang and the
			// settings language rows write it too; the legacy `hintsLocale` key
			// stays a read-only boot fallback) and then flips the language
			// signal LIVE (no restart). ja/ko are not offered (contract: en +
			// zh-CN only); the degrade path stays /hints lang's own surface.
			name: "/language",
			description: t("command.language.description"),
			async run(ctx, argText) {
				const arg = argText.trim()
				const installed = installedLanguages()
				// A registry that never boot-loaded still offers the bundled set.
				const choices = installed.length > 0 ? installed : LANGUAGE_CHOICES
				const current = activeLanguage()
				const pick = (id: string) => {
					setHintsLocale(id as HintLocale)
					persistLang(ctx.seam, id)
					setLanguage(id)
					ctx.say(t("command.language.set", { lang: id }))
				}
				if (arg === "") {
					const picked = await ctx.pickOne(
						t("command.language.pickTitle"),
						choices.map((id) => ({
							title: id,
							value: id,
							description: id === current ? t("command.language.current") : undefined,
						})),
						undefined,
						current,
						// Real-machine regression (2026-11-15): without the arm the
						// selection stayed on row 0 while the current row only carried
						// the `●` marker — ↑ wrapped away from the marked row and Enter
						// resolved the current id again ("language unchanged" ×2), and
						// a bare Enter suddenly switched to row 0's id.
						{ focusCurrent: true },
					)
					// tui-pi unchanged semantics: esc/no answer and the current
					// language print the unchanged line, nothing is written.
					if (!picked || picked === current) {
						ctx.say(t("command.language.unchanged"))
						return
					}
					pick(picked)
					return
				}
				const picked = choices.find((id) => id.toLowerCase() === arg.toLowerCase())
				if (!picked) {
					ctx.say(t("command.language.unknown", { lang: arg, languages: choices.join("|") }))
					return
				}
				if (picked === current) {
					ctx.say(t("command.language.unchanged"))
					return
				}
				pick(picked)
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
			description: t("command.motion.description"),
			run(ctx, argText) {
				const arg = argText.trim().toLowerCase()
				if (!arg) {
					const preference = getMotionPreference()
					const setting = preference === undefined ? `auto → ${getMotionTier()}` : preference
					ctx.say(t("command.motion.usage", { setting }))
					return
				}
				if (arg !== "full" && arg !== "reduced" && arg !== "off" && arg !== "auto") {
					ctx.say(t("command.motion.usageBare"))
					return
				}
				setMotionTier(arg === "auto" ? undefined : (arg as MotionTier))
				try {
					ctx.seam.configSave?.({ motion: arg })
				} catch (error) {
					console.error("[commands] motion persist failed:", error)
				}
				ctx.say(t("command.motion.status", { setting: arg === "auto" ? "auto" : getMotionTier() }))
			},
		},
		{
			name: "/hotkeys",
			description: t("command.hotkeys.description"),
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
			description: t("command.theme.description"),
			async run(ctx) {
				if (!ctx.themes) {
					ctx.say(t("command.theme.unavailable"))
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
					if (modeFace?.set(mode)) ctx.say(t("command.theme.modeSet", { mode }))
					else ctx.say(t("command.theme.unknownMode", { mode }))
					return
				}
				if (ctx.themes.set(picked)) ctx.say(t("command.theme.set", { theme: picked }))
				else ctx.say(t("command.theme.unknown", { theme: picked }))
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
			description: t("command.preset.description"),
			async run(ctx, argText) {
				const face = ctx.seam.preset
				if (!face) {
					ctx.say(t("command.preset.unavailable"))
					return
				}
				const rows = await face.list()
				if (rows.length === 0) {
					ctx.say(t("command.preset.none"))
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
						ctx.say(t("command.preset.noOther"))
						return
					}
				} else {
					target = findPresetRow(rows, arg)
					if (!target) {
						ctx.say(t("command.preset.unknown", { name: arg }))
						return
					}
					if (target.id === currentId) {
						ctx.say(t("command.preset.already", { name: target.name }))
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
					ctx.say(t("command.preset.switchFailed", { name: target.name }))
					return
				}
				ctx.say(t("command.preset.set", { name: target.name }))
				await ctx.reload()
			},
		},
		{
			// /stop = the double-Esc confirm's stop-everything leg, without the
			// dialog (the command IS the explicit intent). Cancels the main turn
			// AND every running subagent through the shared helper; a no-turn /
			// no-child stop is a harmless "nothing running" notice, not an error.
			name: "/stop",
			description: t("command.stop.description"),
			async run(ctx) {
				const { parent, children } = await stopEverything(ctx.seam)
				if (!parent && children === 0) {
					ctx.say(t("command.stop.nothingRunning"))
					return
				}
				const parts = [
					...(parent ? [t("turn.stop.confirmMain")] : []),
					...(children === 1
						? [t("turn.stop.confirmChildrenOne")]
						: children > 0
							? [t("turn.stop.confirmChildrenMany", { count: String(children) })]
							: []),
				]
				ctx.say(t("command.stop.done", { parts: parts.join(", ") }))
			},
		},
		{
			// 025-w1b E — account sign-in state entry, appended LAST so the
			// index-based command tests keep their positions. STRICTLY SEPARATE
			// from /login (provider credentials): this drives the S4-wired
			// account.* plaintext frames via ctx.seam.account, whose state is
			// whitelist-projected (status/phase/booleans; no URL value shows).
			name: "/account",
			description: t("command.account.description"),
			async run(ctx, argText) {
				await runAccountFlow(ctx, argText)
			},
		},
		{
			// 026 web-mirror — /permission full mirror (深读映射 #12–#22). bare
			// prints the catalog + current default (web `current preset …`);
			// `<preset>` validates against the catalog (unknown -> web-semantic
			// error) then submits the host `/permission <preset>` command over
			// the generic commands/execute wire. full-access/auto presets get a
			// second confirmation with explicit acknowledge (A2-8 RiskConfirmation).
			// Appended LAST so index-based command tests keep their positions.
			name: "/permission",
			description: t("command.permission.description"),
			async run(ctx, argText) {
				const face = ctx.seam.permission
				if (!face) {
					ctx.say(t("command.permission.unavailable"))
					return
				}
				let catalog: SeamPermissionCatalog | undefined
				try {
					catalog = await face.catalog()
				} catch {
					catalog = undefined
				}
				if (catalog === undefined) {
					ctx.say(t("command.permission.catalogUnavailable"))
					return
				}
				// R4 bug fix: before the first turn, after /new, or after /resume
				// with no turn yet, no session is bound. The seam would otherwise
				// throw a bare "no active session". Give an actionable hint instead.
				// When a resume target IS staged, the seam itself falls back to
				// stagedSessionId() and switches against that id, so this guard
				// only fires when both accessors are empty.
				// R4-3 (oldfox): run this BEFORE the picker so an unbound window
				// gets the hint directly, without a pick + risk confirm first.
				const boundId = ctx.seam.currentSessionId()
				const stagedId = ctx.seam.stagedSessionId?.()
				if ((boundId === undefined || boundId === "") && (stagedId === undefined || stagedId === "")) {
					ctx.say(t("command.permission.noSession"))
					return
				}
				let arg = argText.trim()
				if (arg === "") {
					// R4: bare /permission opens the generic preset picker instead of
					// dumping the catalog. currentValue marks the DEFAULT row only —
					// the real current-session preset is host-authoritative and not
					// readable here (026 review S1 / :405-423), so never pass it off
					// as "current". The default-marker hint spells "default, not
					// current" out to the user. Cancel is a no-op.
					// B2: the title is a PURE title. The hint rides the 3rd arg
					// `headerLine`, which the shipped pickOne now forwards to
					// DialogSelect's description slot (examples/v2-entry.tsx),
					// so it paints below the title in both en/zh without a
					// title hack. 98a5341's title-merge is reverted.
					const picked = await ctx.pickOne(
						t("command.permission.pickerTitle"),
						catalog.options.map((option) => ({
							title: option.name ?? option.value,
							value: option.value,
							description: option.description,
						})),
						t("command.permission.defaultMarkerHint"),
						catalog.defaultPreset,
					)
					if (picked === undefined) return
					arg = picked
				}
				const target = catalog.options.find((option) => option.value === arg || option.name === arg)
				if (target === undefined) {
					const names = catalog.options.map((option) => option.value).join(", ")
					ctx.say(t("command.permission.unknown", { name: arg, available: names }))
					return
				}
				// 026 review C1: NO "already" short-circuit. We cannot read the
				// real current-session preset (no readable projection face), so
				// comparing the target against `defaultPreset` is wrong — after a
				// session switches to a non-default preset, switching back to the
				// default was wrongly refused. The host `apply()` is idempotent
				// (`current !== name` before append, permission-presets :488), so
				// re-submitting the default is harmless. Always go through switch.
				if (isRiskPermissionPreset(target.value, target.name)) {
					const verdict = await ctx.pickOne(t("command.permission.riskTitle", { name: target.value }), [
						{ title: t("command.permission.riskAck"), value: "ack" },
						{ title: t("command.permission.cancel"), value: "cancel" },
					])
					if (verdict !== "ack") {
						ctx.say(t("command.permission.cancelled"))
						return
					}
				}
				try {
					const result = await face.switch(target.value)
					if (!result.matched) {
						ctx.say(t("command.permission.noCommand"))
						return
					}
					if (!result.ok) {
						ctx.say(t("command.permission.failed", { reason: result.text || "error" }))
						return
					}
					ctx.say(t("command.permission.set", { name: target.value }))
					if (result.text !== "") ctx.say(result.text)
					await ctx.reload()
				} catch (error) {
					ctx.say(t("command.permission.failed", { reason: seamFailureReason(error) }))
				}
			},
		},
		{
			// 026 web-mirror — cwd display (映射 #1/#2). Reads the already-wired
			// session/list.cwd via seam.cwd() (SECOND whitelist projector; zero new
			// capability id) and shows the basename, mirroring the web chip's
			// workspaceLabel(cwd) fallback. Display only: rc.5 has no SDK
			// working-directory switch method (映射 #3 / K5), so no cd here.
			// Appended LAST so index-based command tests keep their positions.
			name: "/cwd",
			description: t("command.cwd.description"),
			async run(ctx) {
				if (!ctx.seam.cwd) {
					ctx.say(t("command.cwd.unavailable"))
					return
				}
				try {
					const cwd = await ctx.seam.cwd()
					const label = cwdBasename(cwd)
					if (label === undefined) {
						ctx.say(t("command.cwd.none"))
						return
					}
					ctx.say(t("command.cwd.current", { cwd: label }))
				} catch (error) {
					ctx.say(t("command.cwd.failed", { reason: seamFailureReason(error) }))
				}
			},
		},
		{
			// retention UI — read-only plan first; apply only after the user
			// types the exact word `prune` into a text prompt. No auto-apply,
			// no client paths, no stagedIds safety gate.
			name: "/prune",
			description: t("command.prune.description"),
			async run(ctx) {
				if (!ctx.seam.planPrune || !ctx.seam.applyPrune) {
					ctx.say(t("command.prune.unavailable"))
					return
				}
				try {
					const plan = await ctx.seam.planPrune()
					// Sizes are a display-only read of the already-wired session
					// list; an unavailable list leaves the byte count unknown.
					const sizeById = new Map<string, number>()
					try {
						for (const row of await ctx.seam.listSessions(10_000)) {
							if (typeof row.sizeBytes === "number" && Number.isFinite(row.sizeBytes)) {
								sizeById.set(row.id, row.sizeBytes)
							}
						}
					} catch { /* bytes unknown; counts/ages still print */ }
					for (const line of formatPrunePlanRows(plan, sizeById)) ctx.say(line)
					if (plan.counts.prune === 0) {
						ctx.say(t("command.prune.nothingToApply"))
						return
					}
					if (!ctx.promptText) {
						ctx.say(t("command.prune.promptUnavailable"))
						return
					}
					if (typeof plan.fingerprint !== "string" || typeof plan.configFingerprint !== "string") {
						ctx.say(t("command.prune.stalePlan"))
						return
					}
					const answer = await ctx.promptText(t("command.prune.confirmTitle"), {
						placeholder: t("command.prune.confirmPlaceholder"),
					})
					if (answer?.trim() !== "prune") {
						ctx.say(t("command.prune.cancelled"))
						return
					}
					const result = await ctx.seam.applyPrune({
						fingerprint: plan.fingerprint,
						configFingerprint: plan.configFingerprint,
						generatedAt: plan.generatedAt,
					})
					ctx.say(t("command.prune.applied", {
						count: String(result.applied.length),
						failed: String(result.failed.length),
					}))
					for (const row of result.failed) {
						ctx.say(t("command.prune.applyFailed", {
							id: row.id, code: row.code, message: row.message,
						}))
					}
					if (result.markedOrphans > 0) {
						ctx.say(t("command.prune.orphans", { count: String(result.markedOrphans) }))
					}
				} catch (error) {
					ctx.say(t("command.prune.failed", { reason: seamFailureReason(error) }))
				}
			},
		},
		{
			// retention UI — permanent delete of trashed sessions. Prepare is
			// read-only; commit runs only after the typed word `purge`.
			name: "/prune-purge",
			description: t("command.prunePurge.description"),
			async run(ctx) {
				if (!ctx.seam.preparePurge || !ctx.seam.commitPurge) {
					ctx.say(t("command.prunePurge.unavailable"))
					return
				}
				try {
					const prepared = await ctx.seam.preparePurge()
					for (const line of formatPurgePrepareRows(prepared)) ctx.say(line)
					if (prepared.candidates.length === 0) {
						ctx.say(t("command.prunePurge.empty"))
						return
					}
					if (!ctx.promptText) {
						ctx.say(t("command.prunePurge.promptUnavailable"))
						return
					}
					const answer = await ctx.promptText(t("command.prunePurge.confirmTitle"), {
						placeholder: t("command.prunePurge.confirmPlaceholder"),
					})
					if (answer?.trim() !== "purge") {
						ctx.say(t("command.prunePurge.cancelled"))
						return
					}
					const result = await ctx.seam.commitPurge({ token: prepared.token })
					ctx.say(t("command.prunePurge.done", {
						count: String(result.purged.length),
						failed: String(result.failed.length),
					}))
					for (const row of result.failed) {
						ctx.say(t("command.prunePurge.failed", {
							code: row.code, message: row.message,
						}))
					}
				} catch (error) {
					ctx.say(t("command.prunePurge.failed", {
						code: "INTERNAL", message: seamFailureReason(error),
					}))
				}
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
