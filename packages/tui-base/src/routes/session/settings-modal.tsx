/**
 * settings-modal.tsx — /settings rendered as a panel-kit modal (T18).
 *
 * The data layer is unchanged and still lives in ./settings-panel.tsx:
 * `buildLocalItems` / `buildHostItems` / `buildOtherItems`, the two write
 * planners, `commitHostWrite` (path ops + one conflict retry), the whitelist
 * and the live appliers. This module only adds:
 *
 *   - the 6-entry navigation model (General / opentui / Models / Plugins /
 *     Agent presets / Account),
 *   - the 12-row General mapping from the migration contract §3.2,
 *   - INSTANT writes: a value chosen in an editor (or a toggled row) is
 *     persisted immediately through the same planners the old 确定 button
 *     used. There is no draft buffer, so a successful save flashes
 *     「已保存 · <row>」 in the status line and a failed save keeps the editor
 *     open with its error line,
 *   - the panel-kit shell (Panel body + List) and its inner-first Esc ladder:
 *     editor → browse → exit confirmation. Exiting is always confirmed (the
 *     kit's confirm layer, default focus on 取消); nothing is pending at that
 *     point because every edit already landed. Left/Right switch the focus
 *     between the section list and the section rows.
 *
 * Semantics that must not drift (contract Appendix B): host writes are PATH
 * OPS only, every write re-describes, a conflict is retried once, and a
 * read-only / n/a row never offers an edit affordance.
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { TextAttributes, type RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import {
  List,
  PanelBody,
  resolvePanelChrome,
  resolvePanelMetrics,
  resolvePanelWidth,
  useControlKeys,
  usePanelTheme,
  usePanels,
  withContrastFloor,
  type ListItem,
  type PanelHandle,
} from "@dsh-opentui/panel-kit"
import { Keymap } from "../../context/keymap"
import { t, LANGUAGE_CHOICES } from "../../i18n"
import {
	DEFAULT_FOOTER_HINTS,
	footerHintsFromConfig,
	hintsLocaleFromConfig,
} from "./hints-line"
import {
	applySettingsLive,
	buildHostItems,
	buildLocalItems,
	buildOtherItems,
	commitHostWrite,
	currentHostRevision,
	parseIntegerInput,
	planHostWrite,
	planLocalWrite,
	readHostSnapshot,
	readLocalSnapshot,
	settingsBridgeOpen,
	settingsSummary,
	settingsWritable,
	setSettingsBridge,
	useSettingsPanelOpenState,
	type SettingsItem,
	type SettingsThemeFace,
	type SettingsWrite,
} from "./settings-panel"
import type {
	SeamPermissionCatalog,
	SeamSettingsDocument,
	SessionSeam,
} from "../../seams/session"
import {
	defaultUiStatePath,
	readUiStateSync,
	writeUiState,
} from "../../util/ui-state"

// Version: build-time define; missing (dev/test) => "dev".
declare const __DSH_CLIENT_VERSION__: string | undefined
function resolveVersion(): string {
	try {
		return typeof __DSH_CLIENT_VERSION__ === "string" && __DSH_CLIENT_VERSION__ !== ""
			? __DSH_CLIENT_VERSION__
			: "dev"
	} catch {
		return "dev"
	}
}

// ------------------------------------------------------------- nav model --

export const SETTINGS_SECTIONS = [
	{ id: "general" },
	{ id: "opentui" },
	// Host settings (whitelist + describe-only namespaces). P0-1: the host rows
	// are visible and editable here; General keeps the two web-order mirrors.
	{ id: "host" },
	{ id: "models" },
	{ id: "plugins" },
	{ id: "presets" },
	{ id: "account" },
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"]

/** Section labels resolve through `t()` at READ time (component memos /
 * render) — never baked into a module constant (design §6 getter law). */
export function settingsSectionLabel(id: SettingsSectionId): string {
	return t(`settings.section.${id}`)
}

/** General keeps exactly 12 rows (contract §3.2 + user decision 9). */
export const GENERAL_ROW_COUNT = 12

export type SettingsRowKind = "enum" | "toggle" | "number" | "text" | "readonly" | "note" | "submenu" | "jump"

export interface SettingsRow {
	id: string
	label: string
	/** Displayed current value (`n/a` / `(unset)` are real values here). */
	value: string
	kind: SettingsRowKind
	editable: boolean
	options?: readonly string[]
	note?: string
	min?: number
	max?: number
	write?: SettingsWrite
	revision?: number
	/** Sub-layer rows (working-steps: three N/A fields). */
	detail?: readonly SettingsRow[]
	/** Command-jump section rows. */
	command?: string
}

export interface SettingsRowContext {
	merged: Record<string, unknown>
	profile: Record<string, unknown>
	workspace: Record<string, unknown>
	document: SeamSettingsDocument | undefined
	catalog: SeamPermissionCatalog | undefined
	themeNames?: readonly string[]
	local: boolean
	host: boolean
	version?: string
}

function fromItem(item: SettingsItem): SettingsRow {
	const row: SettingsRow = {
		id: item.id,
		label: item.label,
		value: item.value,
		kind: item.kind === "enum" || item.kind === "toggle" || item.kind === "number" ? item.kind : "text",
		editable: item.editable,
		...(item.options !== undefined ? { options: item.options } : {}),
		...(item.note !== undefined ? { note: item.note } : {}),
		...(item.min !== undefined ? { min: item.min } : {}),
		...(item.max !== undefined ? { max: item.max } : {}),
		...(item.write !== undefined ? { write: item.write } : {}),
		...(item.revision !== undefined ? { revision: item.revision } : {}),
	}
	return row
}

function readonlyRow(id: string, label: string, value: string, note: string): SettingsRow {
	return { id, label, value, kind: "readonly", editable: false, note }
}

function naRow(id: string, label: string, note: string): SettingsRow {
	return { id, label, value: "N/A", kind: "note", editable: false, note }
}

/**
 * Runtime capability gate for the /settings row set.
 *
 * The user's rule: drop every configuration we cannot change; keep the
 * commands we support. "Cannot change" is decided by capabilities ALREADY
 * probed by the data layer — not by a new probe:
 *   - `ctx.host` is `settingsWritable(...).host` — false when there is no
 *     face, describe failed, or the document is `writable: false`; true when a
 *     face exists and writes are possible.
 *   - `ctx.document` is the `settings/describe` result from `readHostSnapshot`.
 *     It starts `undefined` and is filled by an ASYNC read on mount, so an
 *     `undefined` document while `ctx.host` is true is a LOADING window, not
 *     bridge mode. Filtering that window would make preselection resolve row
 *     ids against a hidden row set (the preselect effect runs before the host
 *     snapshot arrives), landing on the wrong row.
 * A writable host supplies the full row set (renders exactly as before).
 * A bridge seam with no face (`host: false`) hides every row with no live write
 * path; command-jump rows are kept in both modes (they are commands, not
 * configuration).
 *
 * Row DEFINITIONS stay intact — this is a filter at build time, never a
 * deletion from the source lists.
 */
function hostSettingsAvailable(ctx: SettingsRowContext): boolean {
	// `ctx.host` already folds in every capability probe. Deciding on it alone
	// (rather than also requiring `ctx.document !== undefined`) keeps the row
	// set stable during the async describe window while still gating true
	// bridge mode, where `host` is false.
	return ctx.host
}

export function settingsRowsForMode(rows: readonly SettingsRow[], ctx: SettingsRowContext): SettingsRow[] {
	if (hostSettingsAvailable(ctx)) return [...rows]
	return rows.filter((row) => row.kind === "jump" || (row.editable && row.write !== undefined))
}

/**
 * The Host nav entry is meaningless without a readable settings document —
 * bridge mode would show four rows whose only content is "host settings
 * unavailable". Hide the entry (not the definition) in that mode; remote mode
 * keeps all seven sections.
 */
export function visibleSettingsSections(ctx: SettingsRowContext): readonly (typeof SETTINGS_SECTIONS)[number][] {
	if (hostSettingsAvailable(ctx)) return SETTINGS_SECTIONS
	return SETTINGS_SECTIONS.filter((section) => section.id !== "host")
}

/**
 * 12 General rows in web order (contract §3.2). Rows 4/6/7/8/9/10/12 are
 * informational by decision: the TUI has no consumer for them, so they carry a
 * note instead of a dead control. Row 5 opens a three-field N/A sub-layer while
 * staying ONE top-level row.
 */
export function buildGeneralRows(ctx: SettingsRowContext): SettingsRow[] {
	const hostRows = buildHostItems(ctx.document, ctx.host, ctx.catalog)
	const permission = hostRows.find((row) => row.id === "permission.defaultPreset")
	const sessionLog = hostRows.find((row) => row.id === "session-log-deepseek.enabled")
	const permissionRow: SettingsRow =
		permission === undefined
			? { id: "general.permission", label: t("settings.row.permissionPreset"), value: "n/a", kind: "readonly", editable: false, note: t("settings.note.notInHostBaseline") }
			: {
					...fromItem(permission),
					id: "general.permission",
					label: t("settings.row.permissionPreset"),
					// No option source = no picker (existing host-row rule).
					...(permission.editable && (permission.options?.length ?? 0) > 0
						? {}
						: { kind: "readonly" as const, editable: false }),
				}
	const sessionLogRow: SettingsRow =
		sessionLog === undefined
			? { id: "general.session-log", label: t("settings.row.sessionLogUpload"), value: "n/a", kind: "readonly", editable: false, note: t("settings.note.notInHostBaseline") }
			: { ...fromItem(sessionLog), id: "general.session-log", label: t("settings.row.sessionLogUpload") }

	const rows: SettingsRow[] = [
		permissionRow,
		{
			// T14 storage-key unification: this row writes the unified `lang`
			// key (the /language authority); the legacy `hintsLocale` folds in
			// read-only for the display when no unified value exists.
			id: "general.language",
			label: t("settings.row.language"),
			value: hintsLocaleFromConfig(ctx.merged.lang) ?? hintsLocaleFromConfig(ctx.merged.hintsLocale) ?? "en",
			kind: "enum",
			options: LANGUAGE_CHOICES,
			editable: ctx.local,
			note: t("settings.row.languageNote"),
			write: { via: "config", key: "lang" },
		},
		{
			id: "general.appearance",
			label: t("settings.row.appearance"),
			value: typeof ctx.profile.themeMode === "string" ? ctx.profile.themeMode : "auto",
			kind: "enum",
			options: ["auto", "dark", "light"],
			editable: ctx.local,
			note: t("settings.row.appearanceNote"),
			write: { via: "config", key: "themeMode" },
		},
		readonlyRow("general.font-size", t("settings.row.fontSize"), "N/A", t("settings.row.fontSizeNote")),
		{
			id: "general.transcript-view",
			label: t("settings.row.workingSteps"),
			value: "N/A",
			kind: "submenu",
			editable: false,
			note: t("settings.row.workingStepsNote"),
			detail: [
				{ id: "general.transcript-view.display", label: t("settings.row.stepsDisplay"), value: "N/A", kind: "note", editable: false, note: t("settings.row.stepsDisplayNote") },
				{ id: "general.transcript-view.collapse", label: t("settings.row.stepsCollapse"), value: "N/A", kind: "note", editable: false, note: t("settings.row.stepsCollapseNote") },
				{ id: "general.transcript-view.folded", label: t("settings.row.stepsFolded"), value: "N/A", kind: "note", editable: false, note: t("settings.row.stepsFoldedNote") },
			],
		},
		naRow("general.developer-tools", t("settings.row.developerTools"), t("settings.row.developerToolsNote")),
		readonlyRow("general.shortcuts", t("settings.row.shortcuts"), t("settings.value.readOnly"), t("settings.row.shortcutsNote")),
		naRow("general.link-opening", t("settings.row.linkOpening"), t("settings.row.linkOpeningNote")),
		readonlyRow("general.composer-enter", t("settings.row.busyEnter"), t("settings.value.busyEnter"), t("settings.row.busyEnterNote")),
		naRow("general.performance-usage", t("settings.row.performanceUsage"), t("settings.row.performanceUsageNote")),
		sessionLogRow,
		{ id: "general.current-version", label: t("settings.row.currentVersion"), value: ctx.version ?? resolveVersion(), kind: "readonly", editable: false },
	]
	return settingsRowsForMode(rows, ctx)
}

/** The opentui-only group (survey D.2), all preserved. The unified `lang`
 * key lives in General's language row (one key, one control). */
export function buildOpentuiRows(ctx: SettingsRowContext): SettingsRow[] {
	const rows = buildLocalItems({
		merged: ctx.merged,
		profile: ctx.profile,
		workspace: ctx.workspace,
		...(ctx.themeNames !== undefined ? { themeNames: ctx.themeNames } : {}),
		writable: ctx.local,
	})
		.filter((item) => item.id !== "lang")
		.map((row) =>
			row.id === "activityPanelHeight"
				? { ...row, note: t("settings.row.activityPanelHeightNote") }
				: row,
		)
		.map(fromItem)
	return settingsRowsForMode(rows, ctx)
}

export function buildHostRows(ctx: SettingsRowContext): SettingsRow[] {
	return settingsRowsForMode(buildHostItems(ctx.document, ctx.host, ctx.catalog).map(fromItem), ctx)
}

export function buildOtherRows(ctx: SettingsRowContext): SettingsRow[] {
	return settingsRowsForMode(
		buildOtherItems(ctx.document).map((item) => ({ ...fromItem(item), kind: "readonly" as const })),
		ctx,
	)
}

/** Command-jump specs resolve through `t()` at call time (buildCommandRows
 * runs inside component memos / tests) — the copy is not module-top-baked. */
function settingsCommandSpec(id: SettingsSectionId): { command: string; label: string; note: string } | undefined {
	switch (id) {
		case "models":
			return { command: "/model", label: t("settings.jump.open", { command: "/model" }), note: t("settings.jump.modelsNote") }
		case "plugins":
			return { command: "/plugins", label: t("settings.jump.open", { command: "/plugins" }), note: t("settings.jump.pluginsNote") }
		case "presets":
			return { command: "/preset", label: t("settings.jump.open", { command: "/preset" }), note: t("settings.jump.presetsNote") }
		case "account":
			return { command: "/login", label: t("settings.jump.open", { command: "/login" }), note: t("settings.jump.accountNote") }
		default:
			return undefined
	}
}

export function buildCommandRows(id: SettingsSectionId): SettingsRow[] {
	const spec = settingsCommandSpec(id)
	if (spec === undefined) return []
	return [
		{
			id: `jump.${id}`,
			label: spec.label,
			value: spec.command,
			kind: "jump",
			editable: true,
			note: spec.note,
			command: spec.command,
		},
	]
}

export function buildSectionRows(id: SettingsSectionId, ctx: SettingsRowContext): SettingsRow[] {
	switch (id) {
		case "general":
			return buildGeneralRows(ctx)
		case "opentui":
			return buildOpentuiRows(ctx)
		case "host":
			// Whitelist rows first (all four: subagent.maxActiveSubagents /
			// maxDepth, permission.defaultPreset, session-log-deepseek.enabled),
			// then the describe-only namespaces, read-only by design.
			return [...buildHostRows(ctx), ...buildOtherRows(ctx)]
		case "models":
		case "plugins":
		case "presets":
		case "account":
			return buildCommandRows(id)
	}
}

// ----------------------------------------------------------- write path --

export type SettingsValue = string | boolean | number

/** Two modal levels: the section screen (nav + rows) and one row editor. */
export type SettingsView = "browse" | "editor"
export type SettingsPane = "nav" | "rows"
/** Esc ladder: editor → browse → exit confirmation (one level per press). */
export function settingsBackView(view: SettingsView): SettingsView | "close" {
	return view === "editor" ? "browse" : "close"
}

export interface SettingsWriteDeps {
	seam: SessionSeam
	themes?: SettingsThemeFace
	merged: Record<string, unknown>
	/** The PROFILE config snapshot: nested-key rows (the
	 * `session.activity_panel_height` gear) merge their slice from it so the
	 * patch never clobbers sibling session keys. */
	profile?: Record<string, unknown>
	document?: SeamSettingsDocument
	local: boolean
	host: boolean
	/** Client-local UI-state file. When present, pure-UI gear rows persist here
	 * (the bridge seam has no `configSave`), and local state wins at boot. */
	uiStatePath?: string
}

export interface SettingsWriteResult {
	ok: boolean
	/** Row label on success (the status line's 「已保存 · <label>」). */
	label?: string
	error?: string
	/** Host document after the write (fresh describe). */
	document?: SeamSettingsDocument
	/** A write landed but its read-back failed (surfaced, never "saved"). */
	refreshFailed?: boolean
	/** The local config patch that landed (already live-applied). */
	patch?: Record<string, unknown>
}

/**
 * Persist ONE value through the EXISTING writers. Local rows go
 * planLocalWrite → seam.configSave → applySettingsLive; host rows go
 * planHostWrite → commitHostWrite (path ops, one conflict retry, fresh
 * describe). The failure message is returned verbatim, so the caller can show
 * it and keep the editor open.
 */
export async function writeSetting(
	row: SettingsRow,
	value: SettingsValue,
	deps: SettingsWriteDeps,
): Promise<SettingsWriteResult> {
	if (row.detail !== undefined) {
		return { ok: false, error: t("settings.error.notEditable", { label: row.label }) }
	}
	if (!row.editable || row.write === undefined) {
		return { ok: false, error: t("settings.error.notEditable", { label: row.label }) }
	}
	if (row.write.via === "config") {
		if (!deps.local) return { ok: false, error: t("settings.error.localNotWritable") }
		const hints = footerHintsFromConfig(deps.merged.footerHints) ?? DEFAULT_FOOTER_HINTS
		// Nested-key rows merge the profile's CURRENT session slice so the
		// patch carries the whole section. Defensive fallback (P2-1): when the
		// profile snapshot is missing/unreadable (readLocalSnapshot → {}), fall
		// back to the merged view's session slice — a bare {session:{…}} patch
		// would shallow-merge over and DROP every sibling session key.
		const profileSession = deps.profile?.session
		const mergedSession = deps.merged.session
		const sessionSlice =
			typeof profileSession === "object" && profileSession !== null
				? (profileSession as Record<string, unknown>)
				: typeof mergedSession === "object" && mergedSession !== null
					? { ...(mergedSession as Record<string, unknown>) }
					: undefined
		const plan = planLocalWrite(row as unknown as SettingsItem, value, hints, sessionSlice)
		if (!plan.ok) return { ok: false, error: `✘ ${plan.error}` }
		// Pure-UI gears (only `session.activity_panel_height` today) are
		// CLIENT-local: persist them to the state file regardless of the
		// seam's configSave capability. The bridge seam has NO configSave, so
		// the profile write would be a silent no-op and `configLoad` degrades
		// to `{}` on restart — the local file is the source of truth at boot.
		const isLocalGear = row.write.key === "session.activity_panel_height"
		const locallyPersisted = isLocalGear && deps.uiStatePath !== undefined
		if (locallyPersisted) {
			try {
				await writeUiState(deps.uiStatePath!, {
					session: { activity_panel_height: plan.applied === undefined ? undefined : String(plan.applied) },
				})
			} catch (error) {
				return {
					ok: false,
					error: t("settings.error.writeFailed", { detail: error instanceof Error ? error.message : String(error) }),
				}
			}
		}
		if (deps.seam.configSave === undefined && !locallyPersisted) {
			// Honest failure: without a config writer this row cannot persist.
			// It is still applied live so the "session only" notice is true.
			applySettingsLive(row as unknown as SettingsItem, plan.applied, hints, deps.themes)
			return { ok: false, error: t("settings.error.configNotPersistable") }
		}
		if (deps.seam.configSave !== undefined) {
			try {
				deps.seam.configSave(plan.patch)
			} catch (error) {
				return {
					ok: false,
					error: t("settings.error.writeFailed", { detail: error instanceof Error ? error.message : String(error) }),
				}
			}
		}
		applySettingsLive(row as unknown as SettingsItem, plan.applied, hints, deps.themes)
		return { ok: true, label: row.label, patch: plan.patch }
	}
	// Host row.
	if (!deps.host) return { ok: false, error: t("settings.error.hostNotWritable") }
	const plan = planHostWrite(row as unknown as SettingsItem, value)
	if (!plan.ok) return { ok: false, error: `✘ ${plan.error}` }
	const face = deps.seam.settings
	if (face === undefined) return { ok: false, error: t("settings.error.hostFaceUnavailable") }
	let document = deps.document
	let refreshFailed = false
	try {
		const outcome = await commitHostWrite({
			mutate: (ns, ops, revision) => face.mutate(ns, ops, revision),
			describe: () => face.describe(),
			ns: plan.ns,
			ops: plan.ops,
			revision: currentHostRevision(document, plan.ns),
		})
		if (outcome.document !== undefined) document = outcome.document
		if (!outcome.result.ok) {
			const message = outcome.result.conflict
				? outcome.attempts === 1
					? t("settings.error.conflictNoRevision")
					: t("settings.error.conflictStill")
				: `✘ ${outcome.result.error}`
			return { ok: false, error: message, ...(document !== undefined ? { document } : {}) }
		}
		if (outcome.refreshFailed === true) refreshFailed = true
	} catch (error) {
		return {
			ok: false,
			error: t("settings.error.writeFailed", { detail: error instanceof Error ? error.message : String(error) }),
		}
	}
	return {
		ok: true,
		label: row.label,
		...(document !== undefined ? { document } : {}),
		...(refreshFailed ? { refreshFailed } : {}),
	}
}

// ------------------------------------------------------------- component --

export interface SettingsModalProps {
	seam: SessionSeam
	/** Called after each successful write with the labels saved so far (exit summary). */
	onApplied?: (labels: readonly string[]) => void
	themes?: SettingsThemeFace
	/** Optional command jump dispatch (close happens first). */
	onCommand?: (command: string) => void
	/** Row id to land on (agents-panel jump). */
	preselect?: string
	/**
	 * The stack handle this body was opened under. Ownership is a frame
	 * identity check inside the kit (`handle.ownsInput()`, ADR-0008), so a
	 * dialog above the panel disables the paging layer and a layer closing
	 * underneath can never silently disable it the way a depth check could.
	 */
	layerHandle?: PanelHandle
}

/** Body size cap so the frame never overflows a small terminal. */
const NAV_WIDTH = 20

/**
 * Fixed frame height (v1.2): the panel is 75% of the terminal, clamped to
 * [18, rows - 4]. The frame therefore has the SAME height in every section and
 * in the editor view — switching General (12 rows) → TUI 专有 (16) → Host (32)
 * → a command jump (1) can never move the frame edges. Overflow is handled by
 * the paged row window, not by resizing the frame.
 */
export const SETTINGS_PANEL_RATIO = 0.75
export const SETTINGS_PANEL_MIN_ROWS = 18
export function settingsPanelRows(terminalRows: number): number {
	const rows = Number.isFinite(terminalRows) ? Math.floor(terminalRows) : 24
	const upper = Math.max(3, rows - 4)
	const target = Math.round(rows * SETTINGS_PANEL_RATIO)
	// The lower bound yields on terminals too short to honour it, so the panel
	// always stays inside the terminal instead of overflowing.
	return Math.max(Math.min(SETTINGS_PANEL_MIN_ROWS, upper), Math.min(target, upper))
}

/**
 * Row width budget in cells for one section row (also the painted highlight
 * width). Terminal width/height → fixed panel frame (`xlarge`, capped at
 * terminal-2) → borders (2) + panel inset (3 or 1 when compact, both sides) +
 * nav column + divider + column gaps. 120 cols → 84 cells, which is exactly
 * the content column the flex row leaves beside the 20-cell nav.
 */
export function settingsRowWidth(terminalWidth: number, terminalHeight: number): number {
	const frame = resolvePanelWidth("xlarge", undefined, terminalWidth)
	const frameRows = settingsPanelRows(terminalHeight)
	const inset = resolvePanelMetrics(frame - 2, Math.max(3, frameRows - 2)).compact ? 1 : 3
	return Math.max(16, frame - 2 - inset * 2 - 2 - NAV_WIDTH - 2)
}
/**
 * Rows painted per page, derived from the FIXED frame height (never from the
 * section's own row count). The frame spends
 *
 *   2 border + 2 vertical padding + 3 header (title, rule, subtitle)
 *   + 2 action band (buttons, hint) + 3 body chrome (section label, note, hint)
 *
 * = 12 rows on chrome, so the row list gets `frameRows - 12`. Clamped to
 * [4, 24]: 80x24 (frame 18) still paints 6 rows + the indicator; a 120x40
 * frame (30) paints 18, which fits General's 12 without paging.
 */
const MIN_BODY_PAGE = 4
const MAX_BODY_PAGE = 24
export const SETTINGS_FIXED_CHROME_ROWS = 12
export function bodyPageSize(panelRows: number): number {
	const rows = Number.isFinite(panelRows) ? Math.floor(panelRows) : 24
	return Math.max(MIN_BODY_PAGE, Math.min(MAX_BODY_PAGE, rows - SETTINGS_FIXED_CHROME_ROWS))
}

function rowListItems(rows: readonly SettingsRow[]): ListItem[] {
	return rows.map((row) => ({
		id: row.id,
		label: row.label,
		description: row.value,
		// v1.2 roles: values are code, ✎ is the user role, a read-only row is
		// system text (it has no editable value), › keeps the accent badge.
		descriptionTone: "code" as const,
		...(row.editable ? { badge: "✎", badgeTone: "user" as const } : { tone: "system" as const }),
		...(row.kind === "jump" ? { badge: "›" } : {}),
	}))
}

export function SettingsModalBody(props: SettingsModalProps & { onRequestClose: () => void }) {
	const themeFace = () => props.themes
	/** Live kit theme: every color below is a token of this projection. */
	const theme = usePanelTheme()
	const chrome = () => resolvePanelChrome(theme())
	/** Content-pane background: every text role painted on it is floored. */
	const contentBg = () => theme().background.content
	/** Keep a role legible on the content pane, never below the theme's primary text. */
	const role = (fg: RGBA): RGBA => withContrastFloor(fg, contentBg(), theme().text.base)
	const [view, setView] = createSignal<SettingsView>("browse")
	const [pane, setPane] = createSignal<SettingsPane>("nav")
	const [sectionIndex, setSectionIndex] = createSignal(0)
	const [rowIndex, setRowIndex] = createSignal(0)
	const [editorRow, setEditorRow] = createSignal<SettingsRow | undefined>(undefined)
	const [editorValue, setEditorValue] = createSignal<string>("")
	/** Enum editor cursor (P0-2): the option Enter/Space saves immediately. */
	const [optionCursor, setOptionCursor] = createSignal(0)
	const localUiStatePath = defaultUiStatePath()
	const [merged, setMerged] = createSignal<Record<string, unknown>>({})
	const [profile, setProfile] = createSignal<Record<string, unknown>>({})
	const [workspace, setWorkspace] = createSignal<Record<string, unknown>>({})
	const [document, setDocument] = createSignal<SeamSettingsDocument | undefined>(undefined)
	const [describeError, setDescribeError] = createSignal<string | undefined>(undefined)
	const [catalog, setCatalog] = createSignal<SeamPermissionCatalog | undefined>(undefined)
	const [status, setStatus] = createSignal<string | undefined>(undefined)
	const [error, setError] = createSignal<string | undefined>(undefined)
	const [busy, setBusy] = createSignal(false)
	let unsubscribe: (() => void) | undefined
	onCleanup(() => {
		unsubscribe?.()
		unsubscribe = undefined
	})

	const writable = createMemo(() => settingsWritable(document(), describeError(), props.seam.settings !== undefined))
	const rowContext = createMemo<SettingsRowContext>(() => ({
		merged: merged(),
		profile: profile(),
		workspace: workspace(),
		document: document(),
		catalog: catalog(),
		...(props.themes !== undefined ? { themeNames: safeThemeNames() } : {}),
		local: writable().local,
		host: writable().host,
		version: resolveVersion(),
	}))
	const sections = createMemo(() => {
		const ctx = rowContext()
		return visibleSettingsSections(ctx).map((section) => ({
			...section,
			rows: buildSectionRows(section.id, ctx),
		}))
	})
	const currentSection = createMemo(() => sections()[sectionIndex()] ?? sections()[0]!)
	const currentRows = createMemo(() => currentSection().rows)
	const currentRow = createMemo(() => currentRows()[rowIndex()])

	/** Labels saved in this panel session (the exit summary's input). */
	const savedLabels: string[] = []
	let statusTimer: ReturnType<typeof setTimeout> | undefined

	/** Transient 「已保存 · X」; falls back to the resting text after 1.5 s. */
	function flashSaved(label: string) {
		setStatus(t("settings.status.saved", { label }))
		if (statusTimer !== undefined) clearTimeout(statusTimer)
		statusTimer = setTimeout(() => {
			statusTimer = undefined
			setStatus(undefined)
		}, 1500)
	}

	onCleanup(() => {
		if (statusTimer !== undefined) clearTimeout(statusTimer)
		statusTimer = undefined
	})

	/** Live page size: fixed frame rows → body rows, clamped in `bodyPageSize`. */
	const dimensions = useTerminalDimensions()
	const panelRows = createMemo(() => settingsPanelRows(dimensions().height))
	const pageSize = createMemo(() => bodyPageSize(panelRows()))

	/**
	 * Cursor-follow window (P0-3). The List paints `pageSize` rows; the window
	 * starts on the page that owns `rowIndex` so a down-move past the last
	 * visible row flips to the next page instead of becoming unreachable. This
	 * is independent of the List's own page state (the panel key table owns
	 * up/down), so every row of a 16-row section is walkable.
	 */
	const rowWindowStart = createMemo(() => {
		const total = currentRows().length
		const size = pageSize()
		if (total <= size) return 0
		const index = Math.max(0, Math.min(rowIndex(), total - 1))
		return Math.floor(index / size) * size
	})
	const visibleRows = createMemo(() =>
		currentRows().slice(rowWindowStart(), rowWindowStart() + pageSize()),
	)

	function safeThemeNames(): readonly string[] {
		try {
			return themeFace()?.list() ?? []
		} catch {
			return []
		}
	}

	function reloadLocal() {
		const snapshot = readLocalSnapshot(props.seam)
		// Local UI state wins over the config fallback: a bridge seam has no
		// configSave and its configLoad degrades to `{}`, so the local file is
		// what actually survives a restart for pure-UI gears.
		const local = readUiStateSync(localUiStatePath)
		const localGear = local.session?.activity_panel_height
		const merged: Record<string, unknown> = { ...snapshot.merged }
		if (localGear !== undefined) {
			const session = typeof merged.session === "object" && merged.session !== null ? merged.session : {}
			merged.session = { ...(session as Record<string, unknown>), activity_panel_height: localGear }
		}
		setMerged(merged)
		setProfile(snapshot.profile)
		setWorkspace(snapshot.workspace)
	}

	async function reloadHost() {
		const snapshot = await readHostSnapshot(props.seam)
		setDocument(snapshot.document)
		setDescribeError(snapshot.describeError)
		setCatalog(snapshot.catalog)
	}

	function scrollRowInto(index: number) {
		setRowIndex(Math.max(0, Math.min(currentRows().length - 1, index)))
	}

	function openSection(index: number) {
		setSectionIndex(index)
		setPane("rows")
		setRowIndex(0)
		setStatus(undefined)
		setError(undefined)
	}

	function backToSection() {
		setView("browse")
		setPane("rows")
		setEditorRow(undefined)
		setError(undefined)
	}

	function openRow(row: SettingsRow) {
		setError(undefined)
		setStatus(undefined)
		if (row.kind === "jump") {
			// Contract §3.5 dispatch rule: close the panel FIRST, then run the
			// command — never dispatch while the modal key scope is active. The
			// big sections carry exactly this one row; agent definitions are not
			// settings, their home is /agents.
			const command = row.command ?? ""
			props.onRequestClose()
			if (command !== "") props.onCommand?.(command)
			return
		}
		if (row.kind === "toggle") {
			if (!row.editable) {
				setStatus(row.note ?? t("settings.status.rowReadOnly"))
				return
			}
			// Instant model: a toggle writes on the spot, no staged buffer.
			void applyRowValue(row, row.value !== "on")
			return
		}
		if (row.kind === "submenu") {
			setEditorRow(row)
			setEditorValue("")
			setView("editor")
			return
		}
		if (!row.editable) {
			setStatus(row.note ?? t("settings.status.rowReadOnly"))
			return
		}
		setEditorRow(row)
		setEditorValue(row.kind === "number" && (row.value === "n/a" || row.value === "(unset)") ? "" : row.value)
		if (row.kind === "enum") {
			// Cursor starts on the effective value (P0-2): ↑↓ move it, Enter/Space
			// save that option immediately — a complete keyboard path.
			const options = row.options ?? []
			const at = options.indexOf(row.value)
			setOptionCursor(at >= 0 ? at : 0)
		}
		setView("editor")
	}

	/**
	 * Persist one row value through the existing writers. Returns true when the
	 * value landed. A failure sets the error line and leaves the editor open so
	 * the value can be corrected or abandoned with Esc.
	 */
	async function applyRowValue(row: SettingsRow, value: SettingsValue): Promise<boolean> {
		if (busy()) return false
		setBusy(true)
		setError(undefined)
		setStatus(undefined)
		try {
			const result = await writeSetting(row, value, {
				seam: props.seam,
				...(props.themes !== undefined ? { themes: props.themes } : {}),
				merged: merged(),
				...(profile() !== undefined ? { profile: profile() } : {}),
				...(document() !== undefined ? { document: document() } : {}),
				local: writable().local,
				host: writable().host,
				uiStatePath: localUiStatePath,
			})
			if (result.document !== undefined) setDocument(result.document)
			if (!result.ok) {
				setError(result.error ?? t("settings.error.writeFailedShort"))
				return false
			}
			reloadLocal()
			// Fold the patch in AFTER the snapshot read: a footerHints patch
			// carries the whole hint map, so the next write is never built from
			// the pre-write map.
			if (result.patch !== undefined) setMerged((current) => ({ ...current, ...result.patch }))
			void reloadHost()
			if (result.refreshFailed === true) {
				setError(t("settings.status.refreshFailed"))
				return true
			}
			savedLabels.push(row.label)
			flashSaved(row.label)
			props.onApplied?.([...savedLabels])
			return true
		} finally {
			setBusy(false)
		}
	}

	function moveOptionCursor(delta: number) {
		const options = editorRow()?.options ?? []
		if (options.length === 0) return
		setOptionCursor((current) => ((current + delta) % options.length + options.length) % options.length)
	}

	/** Choose the option under the cursor: save it immediately and leave the editor. */
	async function chooseOption() {
		const row = editorRow()
		if (row === undefined) return
		const option = row.options?.[optionCursor()]
		if (option === undefined) return
		setEditorValue(option)
		if (await applyRowValue(row, option)) backToSection()
	}

	function stepValue(direction: number) {
		const row = editorRow()
		if (row === undefined || row.kind !== "number") return
		const parsed = parseIntegerInput(editorValue(), row.min, row.max)
		const base = parsed.ok ? parsed.value : direction > 0 ? (row.min ?? 0) - 1 : (row.max ?? 0) + 1
		let next = base + direction
		if (row.min !== undefined) next = Math.max(row.min, next)
		if (row.max !== undefined) next = Math.min(row.max, next)
		setEditorValue(String(next))
	}

	/** Enter inside an editor: write the value, then return to the section. */
	async function commitEditor() {
		const row = editorRow()
		if (row === undefined) return
		if (row.kind === "number") {
			const parsed = parseIntegerInput(editorValue(), row.min, row.max)
			if (!parsed.ok) {
				setError(`✘ ${parsed.error}`)
				return
			}
			if (await applyRowValue(row, parsed.value)) backToSection()
			return
		}
		if (await applyRowValue(row, editorValue())) backToSection()
	}

	/** Esc inside an editor: nothing to discard — every value is already saved. */
	function cancelEditor() {
		backToSection()
	}

	const panels = usePanels()
	let confirmingExit = false

	/**
	 * Esc at the root opens the exit confirmation (kit confirm layer,
	 * destructive => focus starts on 返回, the safe side). Nothing is pending
	 * here: every edit landed the moment it was chosen, so the dialog is a
	 * courtesy, not a discard prompt. Only an explicit 确认退出 closes the panel.
	 */
	async function requestExitConfirm() {
		if (confirmingExit) return
		confirmingExit = true
		try {
			const exit = await panels.confirm({
				title: t("settings.exit.title"),
				message: t("settings.exit.message"),
				confirmLabel: t("settings.exit.confirm"),
				cancelLabel: t("settings.exit.cancel"),
				destructive: true,
			})
			if (exit) props.onRequestClose()
		} catch {
			// A failed confirm leaves the panel untouched.
		} finally {
			confirmingExit = false
		}
	}

	// Inner-first key ladder. Registered on the layer's router, so it runs
	// before the Panel's close default; controls mounted later (Dropdown)
	// register after this and win while their popup owns the key. In the
	// editor, enum rows are fully keyboard-driven (↑↓ cursor, Enter/Space
	// commit); number/text rows leave Enter/Space/←→ to the focused input.
	const registerKeys = useControlKeys()
	onMount(() => {
		const dispose = registerKeys({
			up: () => {
				if (view() === "editor") {
					if (editorRow()?.kind !== "enum") return false
					moveOptionCursor(-1)
					return true
				}
				if (pane() === "nav") {
					setSectionIndex((index) => Math.max(0, index - 1))
					return true
				}
				scrollRowInto(rowIndex() - 1)
				return true
			},
			down: () => {
				if (view() === "editor") {
					if (editorRow()?.kind !== "enum") return false
					moveOptionCursor(1)
					return true
				}
				if (pane() === "nav") {
					setSectionIndex((index) => Math.min(sections().length - 1, index + 1))
					return true
				}
				scrollRowInto(rowIndex() + 1)
				return true
			},
			left: () => {
				if (view() === "editor") {
					if (editorRow()?.kind !== "number") return false
					stepValue(-1)
					return true
				}
				setPane("nav")
				return true
			},
			right: () => {
				if (view() === "editor") {
					if (editorRow()?.kind !== "number") return false
					stepValue(1)
					return true
				}
				if (pane() === "nav") {
					// Entering a section resets its row cursor; a stale index from
					// the previous section would otherwise clamp onto a wrong row.
					openSection(sectionIndex())
					return true
				}
				setPane("rows")
				return true
			},
			enter: () => {
				if (view() === "editor") {
					const row = editorRow()
					if (row?.kind === "enum") {
						void chooseOption()
						return true
					}
					if (row?.kind === "submenu") {
						backToSection()
						return true
					}
					return false
				}
				if (pane() === "nav") {
					openSection(sectionIndex())
					return true
				}
				const row = currentRow()
				if (row !== undefined) openRow(row)
				return true
			},
			space: () => {
				if (view() === "editor") {
					const row = editorRow()
					if (row?.kind === "enum") {
						void chooseOption()
						return true
					}
					if (row?.kind === "submenu") {
						backToSection()
						return true
					}
					return false
				}
				if (pane() === "nav") {
					openSection(sectionIndex())
					return true
				}
				const row = currentRow()
				if (row !== undefined && row.kind === "toggle") openRow(row)
				return true
			},
			escape: () => {
				const next = settingsBackView(view())
				if (next === "close") {
					void requestExitConfirm()
					return true
				}
				backToSection()
				return true
			},
		})
		if (typeof dispose === "function") onCleanup(dispose)
	})

	/**
	 * One paging key over the full section. Returns false (= not consumed) when
	 * the rows pane is not showing or the section fits on one page, so the
	 * session's transcript pager still receives the key.
	 */
	function pageRows(action: "pageup" | "pagedown" | "home" | "end"): boolean {
		if (view() !== "browse" || pane() !== "rows") return false
		const total = currentRows().length
		const size = pageSize()
		if (total <= size) return false
		if (action === "home") {
			scrollRowInto(0)
			return true
		}
		if (action === "end") {
			scrollRowInto(total - 1)
			return true
		}
		const page = Math.floor(rowIndex() / size)
		scrollRowInto(action === "pagedown" ? (page + 1) * size : (page - 1) * size)
		return true
	}

	/**
	 * Paging keys live on the consumer layer (the kit's modal table only knows
	 * escape/enter/space/arrows; the session's global `pagedown` binding would
	 * otherwise swallow the keys). This layer:
	 *   - is only enabled while OUR layer is the input-ownership top (ADR-0008
	 *     `ownsInput`), so a confirm/popup or a dialog above the panel keeps
	 *     the keys for itself;
	 *   - consumes pageup/pagedown/home/end only in the rows pane and only when
	 *     the section overflows one page — returning false lets the session's
	 *     scroll layer keep them on a fitting section.
	 *
	 * There is deliberately no commit binding: every edit is already persisted,
	 * so Ctrl+S has no meaning in this panel (and must not have one).
	 */
	/**
	 * Ownership is a frame identity check inside the kit (`ownsInput`), not a
	 * `panels.top`/depth compare: the kit's own `top` cannot see a dialog
	 * pushed above the panel, while the ownership stack can. A layer closing
	 * underneath must not silently disable paging; a foreign layer (kit panel
	 * or dialog) on top makes `ownsInput` false and yields.
	 */
	const ownsTop = () => props.layerHandle?.ownsInput() === true
	Keymap.createLayer(() => ({
		mode: "global",
		priority: 2,
		enabled: ownsTop,
		commands: [
			{ bind: "pageup", title: "Settings: page up", group: "Settings", run: () => pageRows("pageup") },
			{ bind: "pagedown", title: "Settings: page down", group: "Settings", run: () => pageRows("pagedown") },
			{ bind: "home", title: "Settings: first row", group: "Settings", run: () => pageRows("home") },
			{ bind: "end", title: "Settings: last row", group: "Settings", run: () => pageRows("end") },
		],
	}))

	onMount(() => {
		reloadLocal()
		void reloadHost()
		unsubscribe = props.seam.settings?.onChanged?.(() => {
			void reloadHost()
		})
	})

	// Preselect a row (agents-panel jump): search every section, once.
	let preselected = false
	createEffect(() => {
		const target = props.preselect
		if (preselected || target === undefined || target === "") return
		const index = sections().findIndex((section) => section.rows.some((row) => row.id === target))
		if (index < 0) return
		preselected = true
		setSectionIndex(index)
		setView("browse")
		setPane("rows")
		setRowIndex(Math.max(0, sections()[index]!.rows.findIndex((row) => row.id === target)))
	})

	const navItems = createMemo<ListItem[]>(() =>
		sections().map((section) => ({
			id: section.id,
			label: settingsSectionLabel(section.id),
			description: `${section.rows.length}`,
			// v1.2: the row count is system text, not a muted value, and it sits
			// in the fixed right-aligned count column.
			descriptionTone: "system" as const,
			descriptionAlign: "right" as const,
		})),
	)

	/**
	 * Row width derived from the real frame (see settingsRowWidth): terminal
	 * width/height → panel frame (`xlarge`, capped at terminal-2) → borders (2)
	 * + panel inset (3 or 1 when compact, both sides) + PanelBody inset (2) +
	 * nav column + column gap.
	 */
	const rowWidth = () => settingsRowWidth(dimensions().width, dimensions().height)
	const rowItems = createMemo(() => rowListItems(visibleRows()))
	const activeRowId = () => currentRow()?.id
	/** "1-8/16" while a section exceeds one page. */
	const pageIndicator = () => {
		const total = currentRows().length
		const size = pageSize()
		if (total <= size) return ""
		const start = rowWindowStart()
		return ` ${start + 1}-${Math.min(start + size, total)}/${total}`
	}

	return (
		<box flexDirection="column" flexGrow={1} flexShrink={1}>
			<PanelBody inset={1} maxRows={pageSize() + 3}>
				{/* Layered zones (v1.2): raised nav band, a theme-border divider and
				    the content surface, all resolved from the injected PanelTheme, so
				    a theme switch recolors them. The row box fills the body height
				    (flexGrow) and the two columns stretch, so the bands reach the
				    body edges whatever the section holds. */}
				<box flexDirection="row" flexGrow={1} flexShrink={1}>
					<box
						flexDirection="column"
						width={NAV_WIDTH}
						flexShrink={0}
						backgroundColor={chrome().navBand}
					>
						<List
							items={navItems()}
							width={NAV_WIDTH - 2}
							/* Only the focused pane paints a cursor: in the nav pane the
							   row list must not also look selected (and vice versa), or the
							   hint line below contradicts the visible highlight. */
							activeId={pane() === "nav" ? currentSection().id : undefined}
							pageSize={8}
							/* Section nav: a stray printable key must never filter the
							   labels away (T18 contract §85). */
							filterable={false}
						/>
					</box>
					<box width={1} flexShrink={0} backgroundColor={chrome().divider} />
					{/* One content cell of breathing room after the rule, so the row
					    highlight never touches the divider and the 84-cell budget
					    (settingsRowWidth) is exact at 120 cols. */}
					<box
						flexDirection="column"
						flexGrow={1}
						flexShrink={1}
						paddingLeft={1}
						backgroundColor={contentBg()}
					>
						<box flexShrink={0} backgroundColor={chrome().titleBand}>
							<text attributes={TextAttributes.BOLD} fg={role(theme().text.heading)}>
								{settingsSectionLabel(currentSection().id)}
							</text>
						</box>
						<Show when={editorRow() === undefined}>
							<List
								items={rowItems()}
								width={rowWidth()}
								activeId={pane() === "rows" ? activeRowId() : undefined}
								pageSize={pageSize()}
								onSelect={(item) => {
									const row = currentRows().find((entry) => entry.id === item.id)
									if (row !== undefined) openRow(row)
								}}
							/>
							<Show when={currentRow()?.note !== undefined}>
								<text fg={role(theme().text.muted)}>{`  ${currentRow()!.note!}`}</text>
							</Show>
							<text fg={role(theme().text.muted)}>{`${pane() === "nav" ? t("settings.hint.navSections") : t("settings.hint.rows")}${pageIndicator()}`}</text>
						</Show>
						<Show when={editorRow() !== undefined}>
							<EditorView
								row={editorRow()!}
								value={editorValue()}
								cursor={optionCursor()}
								optionRows={Math.max(1, pageSize() - 2)}
								onValue={setEditorValue}
								onStep={stepValue}
								onCommit={() => void commitEditor()}
								onCancel={cancelEditor}
							/>
						</Show>
					</box>
				</box>
			</PanelBody>
			{/* Action band: no commit control (every edit is already persisted).
			    The left cell is the Esc affordance, the right the status line:
			    the transient "saved · <label>" flash lives here. */}
			<box flexDirection="row" justifyContent="space-between" flexShrink={0} gap={2}>
				<box
					flexShrink={0}
					border={["left", "right"]}
					borderStyle="single"
					borderColor={chrome().divider}
				>
					<text fg={theme().text.muted} attributes={theme().attributes.keyHint} wrapMode="none">
						{t("settings.hint.escBack")}
					</text>
				</box>
					<text
						fg={role(error() !== undefined ? theme().text.danger : theme().text.system)}
						attributes={theme().attributes.keyHint}
						wrapMode="none"
					>
					{error() ?? status() ?? t("settings.status.instantSave")}
				</text>
			</box>
		</box>
	)
}

function EditorView(props: {
	row: SettingsRow
	value: string
	/** Enum cursor: Enter/Space saves this option immediately (P0-2). */
	cursor: number
	/** Options painted at once (a window follows the cursor; §3.2). */
	optionRows: number
	onValue: (value: string) => void
	onStep: (direction: number) => void
	onCommit: () => void
	onCancel: () => void
}) {
	/** v1.2: every painted element below carries a PanelTheme role. */
	const theme = usePanelTheme()
	/** Editor lives on the content pane: role colors are floored against it. */
	const contentBg = () => theme().background.content
	const role = (fg: RGBA): RGBA => withContrastFloor(fg, contentBg(), theme().text.base)
	let catcher: { focus(): void; isDestroyed?: boolean } | undefined

	const options = () => props.row.options ?? []
	const optionLimit = () => Math.max(1, props.optionRows)
	/** First painted option of the page that owns the cursor. */
	const optionStart = () => {
		const total = options().length
		const limit = optionLimit()
		if (total <= limit) return 0
		return Math.floor(props.cursor / limit) * limit
	}
	const visibleOptions = () => options().slice(optionStart(), optionStart() + optionLimit())
	const optionIndicator = () => {
		const total = options().length
		const limit = optionLimit()
		if (total <= limit) return ""
		const start = optionStart()
		return ` ${start + 1}-${Math.min(start + limit, total)}/${total}`
	}

	return (
		<box flexDirection="column" flexGrow={1}>
			<text fg={role(theme().text.heading)}>
			{t("settings.editor.title", {
				label: props.row.label,
				action: props.row.kind === "number" ? t("settings.input.enterInteger") : props.row.kind === "enum" ? t("settings.editor.pick") : t("settings.editor.view"),
			})}
		</text>
			<Show when={props.row.note !== undefined}>
				<text fg={role(theme().text.system)}>{`  ${props.row.note!}`}</text>
			</Show>
			<Show when={props.row.kind === "submenu"}>
				<For each={props.row.detail ?? []}>
					{(child) => (
						<box flexDirection="column">
							<text fg={role(theme().text.base)}>{`  ${child.label}  ${child.value}`}</text>
							<Show when={child.note !== undefined}>
								<text fg={role(theme().text.system)}>{`    ${child.note!}`}</text>
							</Show>
						</box>
					)}
				</For>
			</Show>
			<Show when={props.row.kind === "enum"}>
				<box flexDirection="column">
					<For each={visibleOptions()}>
						{(option, index) => (
							<box
								flexDirection="row"
								onMouseUp={() => {
									props.onValue(option)
									props.onCommit()
								}}
							>
								<text fg={role(theme().text.accent)}>{optionStart() + index() === props.cursor ? "▸ " : "  "}</text>
								<text fg={role(theme().text.code)}>{option}</text>
								<Show when={option === props.row.value}>
									<text fg={role(theme().text.system)}>{t("settings.options.current")}</text>
								</Show>
							</box>
						)}
					</For>
					<Show when={optionIndicator() !== ""}>
						<text fg={role(theme().text.system)}>{optionIndicator()}</text>
					</Show>
				</box>
			</Show>
			<Show when={props.row.kind === "number" || props.row.kind === "text"}>
				<box flexDirection="row">
					<text fg={role(theme().text.muted)}>{props.row.kind === "number" ? t("settings.editor.numberValue") : t("settings.editor.textValue")}</text>
					<text fg={role(theme().text.code)}>{props.value}</text>
					<input
						flexGrow={1}
						value={props.value}
						onInput={(next: string) => props.onValue(next)}
						onSubmit={() => props.onCommit()}
						ref={(renderable: { focus(): void; isDestroyed?: boolean }) => {
							catcher = renderable
							setTimeout(() => {
								if (catcher !== undefined && catcher.isDestroyed !== true) catcher.focus()
							}, 1)
						}}
					/>
				</box>
			</Show>
			<text fg={role(theme().text.faint)}>
				{props.row.kind === "enum"
					? t("settings.editor.footerEnum")
					: t("settings.editor.footerInput")}
			</text>
		</box>
	)
}

/**
 * Entry-mounted host: watches the module bridge (`openSettingsPanel`) and
 * opens one stack layer. Kept outside the page tree so the old inline block is
 * gone; the layer is an absolute sibling at zIndex 3000+.
 */
export function SettingsModalHost(props: {
	seam: SessionSeam
	themes?: SettingsThemeFace
	onCommand?: (command: string) => void
	onClosed?: (summary?: string) => void
}) {
	const panels = usePanels()
	const dimensions = useTerminalDimensions()
	const [, setOpen] = useSettingsPanelOpenState()
	let summary: string | undefined
	let handle: PanelHandle | undefined
	/** Reactive copy of the opened handle (the body gates on identity). */
	const [layerHandle, setLayerHandle] = createSignal<PanelHandle | undefined>(undefined)

	createEffect(() => {
		const preselect = settingsBridgeOpen()
		if (preselect === undefined) return
		setSettingsBridge(undefined)
		if (handle !== undefined) return
		summary = undefined
		handle = panels.open(
			() => (
				<SettingsModalBody
					seam={props.seam}
					layerHandle={layerHandle()}
					{...(props.themes !== undefined ? { themes: props.themes } : {})}
					{...(props.onCommand !== undefined ? { onCommand: props.onCommand } : {})}
					{...(preselect !== "" ? { preselect } : {})}
					onApplied={(labels) => {
						summary = settingsSummary(labels)
					}}
					onRequestClose={() => handle?.close()}
				/>
			),
			{
				id: "settings-modal",
				title: "Settings",
				subtitle: t("settings.modal.subtitle"),
				size: "xlarge",
				/**
				 * A FIXED frame height (v1.2): 75% of the terminal, clamped to
				 * [18, rows - 4]. The frame is resolved once at open from the
				 * terminal, so no section (12 / 16 / 32 / 1 rows) and no editor view
				 * can move its edges; extra rows are paged inside the body.
				 */
				rows: settingsPanelRows(dimensions().height),
				/** Title band + rule, so the header reads as chrome, not body. */
				layered: true,
				onClose: () => {
					handle = undefined
					setLayerHandle(undefined)
					setOpen(false)
					props.onClosed?.(summary)
				},
			},
		)
		setLayerHandle(handle)
		setOpen(true)
	})

	return <box height={0} flexShrink={0} />
}
