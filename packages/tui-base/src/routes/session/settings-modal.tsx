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
 *   - a draft buffer (edit → 确定 commits through the same write paths;
 *     Esc/取消 discards, nothing was written),
 *   - the panel-kit shell (Panel body + List + PanelActions) and its
 *     inner-first Esc ladder: editor → browse → close. Left/Right switch the
 *     focus between the section list and the section rows.
 *
 * Semantics that must not drift (contract Appendix B): host writes are PATH
 * OPS only, every write re-describes, a conflict is retried once, and a
 * read-only / n/a row never offers an edit affordance.
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import {
  Button,
  List,
  PanelBody,
  resolvePanelChrome,
  resolvePanelMetrics,
  resolvePanelWidth,
  useControlKeys,
  usePanelTheme,
  usePanels,
  type ListItem,
  type PanelHandle,
} from "@dsh-opentui/panel-kit"
import { Keymap } from "../../context/keymap"
import {
	DEFAULT_FOOTER_HINTS,
	HINT_LOCALES,
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
	{ id: "general", label: "通用" },
	{ id: "opentui", label: "TUI 专有" },
	// Host settings (whitelist + describe-only namespaces). P0-1: the host rows
	// are visible and editable here; General keeps the two web-order mirrors.
	{ id: "host", label: "Host" },
	{ id: "models", label: "模型" },
	{ id: "plugins", label: "插件" },
	{ id: "presets", label: "Agent 预设" },
	{ id: "account", label: "账号" },
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"]

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
			? { id: "general.permission", label: "权限默认预设", value: "n/a", kind: "readonly", editable: false, note: "宿主基线未定义" }
			: {
					...fromItem(permission),
					id: "general.permission",
					label: "权限默认预设",
					// No option source = no picker (existing host-row rule).
					...(permission.editable && (permission.options?.length ?? 0) > 0
						? {}
						: { kind: "readonly" as const, editable: false }),
				}
	const sessionLogRow: SettingsRow =
		sessionLog === undefined
			? { id: "general.session-log", label: "Session Log 上传", value: "n/a", kind: "readonly", editable: false, note: "宿主基线未定义" }
			: { ...fromItem(sessionLog), id: "general.session-log", label: "Session Log 上传" }

	return [
		permissionRow,
		{
			id: "general.language",
			label: "语言",
			value: hintsLocaleFromConfig(ctx.merged.hintsLocale) ?? "en",
			kind: "enum",
			options: HINT_LOCALES,
			editable: ctx.local,
			note: "语义对齐 web 的 locale；存储为本地 hintsLocale",
			write: { via: "config", key: "hintsLocale" },
		},
		{
			id: "general.appearance",
			label: "外观",
			value: typeof ctx.profile.themeMode === "string" ? ctx.profile.themeMode : "auto",
			kind: "enum",
			options: ["auto", "dark", "light"],
			editable: ctx.local,
			note: "语义 1:1 于 web 的 ui-theme（存储本地 themeMode）",
			write: { via: "config", key: "themeMode" },
		},
		readonlyRow("general.font-size", "字号", "N/A", "终端管理字号 — TUI 无字号设置"),
		{
			id: "general.transcript-view",
			label: "工作步骤",
			value: "N/A",
			kind: "submenu",
			editable: false,
			note: "N/A — 本 TUI 不消费这三项",
			detail: [
				{ id: "general.transcript-view.display", label: "工作步骤展示", value: "N/A", kind: "note", editable: false, note: "compact/standard/detailed/verbose — 无消费点" },
				{ id: "general.transcript-view.collapse", label: "收起时机", value: "N/A", kind: "note", editable: false, note: "completion/next-input — 无消费点" },
				{ id: "general.transcript-view.folded", label: "收起后显示", value: "N/A", kind: "note", editable: false, note: "all/final — 无消费点" },
			],
		},
		naRow("general.developer-tools", "开发工具", "N/A — 本 TUI 无开发者工具视图"),
		readonlyRow("general.shortcuts", "快捷键", "只读", "快捷键参考 — v1 只读"),
		naRow("general.link-opening", "链接打开方式", "N/A — TUI 无内嵌浏览器，链接交给终端"),
		readonlyRow("general.composer-enter", "忙碌时 Enter", "steer / 询问", "只读说明 — 保留现有 steer/询问行为"),
		naRow("general.performance-usage", "性能与用量", "N/A — 本 TUI 无性能/用量视图"),
		sessionLogRow,
		{ id: "general.current-version", label: "当前版本", value: ctx.version ?? resolveVersion(), kind: "readonly", editable: false },
	]
}

/** The opentui-only group (survey D.2), all preserved. hintsLocale lives in
 * General's language row (one key, one control). */
export function buildOpentuiRows(ctx: SettingsRowContext): SettingsRow[] {
	return buildLocalItems({
		merged: ctx.merged,
		profile: ctx.profile,
		workspace: ctx.workspace,
		...(ctx.themeNames !== undefined ? { themeNames: ctx.themeNames } : {}),
		writable: ctx.local,
	})
		.filter((item) => item.id !== "hintsLocale")
		.map(fromItem)
}

export function buildHostRows(ctx: SettingsRowContext): SettingsRow[] {
	return buildHostItems(ctx.document, ctx.host, ctx.catalog).map(fromItem)
}

export function buildOtherRows(ctx: SettingsRowContext): SettingsRow[] {
	return buildOtherItems(ctx.document).map((item) => ({ ...fromItem(item), kind: "readonly" as const }))
}

const COMMAND_SECTIONS: Partial<Record<SettingsSectionId, { command: string; label: string; note: string }>> = {
	models: { command: "/model", label: "打开 /model", note: "provider / API key / 模型清单页面在 v1 仍由 /model 承担" },
	plugins: { command: "/plugins", label: "打开 /plugins", note: "插件清单与启停由 /plugins 面板承担" },
	presets: { command: "/preset", label: "打开 /preset", note: "Agent 预设的轮换与指定由 /preset 承担" },
	account: { command: "/login", label: "打开 /login", note: "登录 / 登出由 /login 流程承担" },
}

export function buildCommandRows(id: SettingsSectionId): SettingsRow[] {
	const spec = COMMAND_SECTIONS[id]
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

// ---------------------------------------------------------- draft model --

export type DraftValue = string | boolean | number
export type SettingsDrafts = Readonly<Record<string, DraftValue>>

/**
 * Canonical draft key (P2-5). Drafts are keyed by the WRITE TARGET, not the
 * row id, so two rows that write the same key (General 外观 and the opentui
 * themeMode row; General 权限 and the Host permission row) always show and
 * commit the same staged value.
 *
 * `footerHints` is the one shared config key with several distinct values
 * (one boolean per hint id), so it keys per row id instead. The id is the only
 * source (the old `row.label` fallback was unreachable and would have keyed a
 * hint by its display text).
 */
export function draftKey(row: SettingsRow): string {
	const write = row.write
	if (write === undefined) return row.id
	if (write.via === "settings") return `settings:${write.ns}.${write.path.join(".")}`
	if (write.key === "footerHints") {
		const segment = row.id.startsWith("footerHints.")
			? row.id.slice("footerHints.".length)
			: row.id
		return `footerHints.${segment}`
	}
	return `config:${write.key}`
}

/** Two modal levels: the section screen (nav + rows) and one row editor. */
export type SettingsView = "browse" | "editor"
export type SettingsPane = "nav" | "rows"
/** Esc ladder: editor → browse → close (one level per press). */
export function settingsBackView(view: SettingsView): SettingsView | "close" {
	return view === "editor" ? "browse" : "close"
}

/** Stage one value; a value equal to the row's current value is dropped. */
export function stageDraft(
	drafts: SettingsDrafts,
	row: SettingsRow,
	value: DraftValue,
): SettingsDrafts {
	const key = draftKey(row)
	const next = { ...drafts }
	const sameAsSnapshot =
		typeof value === "boolean" ? row.value === (value ? "on" : "off") : row.value === String(value)
	// A value equal to the persisted snapshot is not a change: drop the entry.
	if (sameAsSnapshot) {
		delete next[key]
		return next
	}
	next[key] = value
	return next
}

export function draftFor(drafts: SettingsDrafts, row: SettingsRow): DraftValue | undefined {
	return drafts[draftKey(row)]
}

/** Effective display value: the draft when present, the snapshot otherwise. */
export function displayValue(drafts: SettingsDrafts, row: SettingsRow): string {
	const draft = drafts[draftKey(row)]
	if (draft === undefined) return row.value
	if (typeof draft === "boolean") return draft ? "on" : "off"
	return String(draft)
}

export function isDirty(drafts: SettingsDrafts): boolean {
	return Object.keys(drafts).length > 0
}

// ----------------------------------------------------------- commit path --

export interface SettingsCommitDeps {
	seam: SessionSeam
	themes?: SettingsThemeFace
	rows: readonly SettingsRow[]
	drafts: SettingsDrafts
	merged: Record<string, unknown>
	document?: SeamSettingsDocument
	local: boolean
	host: boolean
}

export interface SettingsCommitResult {
	ok: boolean
	/** Rows written (labels), in commit order. */
	saved: string[]
	/**
	 * Canonical draft keys (`draftKey`) this commit ATTEMPTED, in order: every
	 * key already written plus the one that failed. Untried keys are absent so
	 * the modal keeps their drafts after a partial failure.
	 */
	attempted: string[]
	error?: string
	/** Host document after the last successful write (fresh describe). */
	document?: SeamSettingsDocument
	/** A write landed but its read-back failed (surfaced, never "saved"). */
	refreshFailed?: boolean
}

/**
 * Commit every staged draft through the EXISTING writers. Order is the row
 * order (stable, deterministic). Local rows go configSave → live apply; host
 * rows go commitHostWrite (path ops, one conflict retry, fresh describe).
 * The first hard failure stops the loop and returns its message verbatim so
 * the modal can render it and keep the remaining drafts.
 *
 * Drafts are read by canonical `draftKey`, so a key shared by two rows is
 * written exactly once.
 */
export async function commitSettingsDrafts(deps: SettingsCommitDeps): Promise<SettingsCommitResult> {
	const saved: string[] = []
	const attempted: string[] = []
	const written = new Set<string>()
	let document = deps.document
	let refreshFailed = false
	/**
	 * Running local snapshot. Every local patch is folded in as it lands, so a
	 * shared-key patch (footerHints carries the WHOLE hint object) never
	 * rewrites an earlier write of the same commit from the stale pre-commit
	 * snapshot — that clobber was the "first 确定 does not persist, second one
	 * does" bug: send=true was followed by the search patch built from the old
	 * {send:false} map.
	 */
	let liveMerged = deps.merged

	for (const row of deps.rows) {
		const key = draftKey(row)
		if (written.has(key)) continue
		const value = deps.drafts[key]
		if (value === undefined) continue
		written.add(key)
		attempted.push(key)
		if (row.detail !== undefined) {
			for (const child of row.detail) {
				if (deps.drafts[draftKey(child)] !== undefined) {
					return { ok: false, saved, attempted, error: `✘ ${child.label} 不可编辑`, ...(document !== undefined ? { document } : {}) }
				}
			}
		}
		if (!row.editable || row.write === undefined) {
			return { ok: false, saved, attempted, error: `✘ ${row.label} 不可编辑`, ...(document !== undefined ? { document } : {}) }
		}
		if (row.write.via === "config") {
			if (!deps.local) {
				return { ok: false, saved, attempted, error: "✘ 本地偏好当前不可写", ...(document !== undefined ? { document } : {}) }
			}
			const hints = footerHintsFromConfig(liveMerged.footerHints) ?? DEFAULT_FOOTER_HINTS
			const plan = planLocalWrite(row as unknown as SettingsItem, value, hints)
			if (!plan.ok) {
				return { ok: false, saved, attempted, error: `✘ ${plan.error}`, ...(document !== undefined ? { document } : {}) }
			}
			try {
				deps.seam.configSave?.(plan.patch)
			} catch (error) {
				return {
					ok: false,
					saved,
					attempted,
					error: `✘ 写入失败：${error instanceof Error ? error.message : String(error)}`,
					...(document !== undefined ? { document } : {}),
				}
			}
			liveMerged = { ...liveMerged, ...plan.patch }
			applySettingsLive(row as unknown as SettingsItem, plan.applied, hints, deps.themes)
			saved.push(row.label)
			continue
		}
		// Host row.
		if (!deps.host) {
			return { ok: false, saved, attempted, error: "✘ 宿主设置当前不可写", ...(document !== undefined ? { document } : {}) }
		}
		const plan = planHostWrite(row as unknown as SettingsItem, value)
		if (!plan.ok) {
			return { ok: false, saved, attempted, error: `✘ ${plan.error}`, ...(document !== undefined ? { document } : {}) }
		}
		const face = deps.seam.settings
		if (face === undefined) {
			return { ok: false, saved, attempted, error: "✘ 宿主 settings 接口不可用", ...(document !== undefined ? { document } : {}) }
		}
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
						? "✘ 冲突：设置已被其它客户端修改，且 settings/describe 失败 — 没有最新 revision，未重试写入"
						: "✘ 冲突：设置已被其它客户端修改，重试一次仍冲突（未写入）"
					: `✘ ${outcome.result.error}`
				return { ok: false, saved, attempted, error: message, ...(document !== undefined ? { document } : {}) }
			}
			if (outcome.refreshFailed === true) refreshFailed = true
			saved.push(row.label)
		} catch (error) {
			return {
				ok: false,
				saved,
				attempted,
				error: `✘ 写入失败：${error instanceof Error ? error.message : String(error)}`,
				...(document !== undefined ? { document } : {}),
			}
		}
	}

	return {
		ok: true,
		saved,
		attempted,
		...(document !== undefined ? { document } : {}),
		...(refreshFailed ? { refreshFailed } : {}),
	}
}

// ------------------------------------------------------------- component --

export interface SettingsModalProps {
	seam: SessionSeam
	/** Called after a successful commit (exit summary). */
	onApplied?: (labels: readonly string[]) => void
	themes?: SettingsThemeFace
	/** Optional command jump dispatch (close happens first). */
	onCommand?: (command: string) => void
	/** Row id to land on (agents-panel jump). */
	preselect?: string
	/**
	 * The stack handle this body was opened under. Top-ness is an IDENTITY
	 * comparison against `panels.top` (same object `panels.open` returned), so
	 * a layer closing underneath can never silently disable the paging/Ctrl+S
	 * layer the way a positional depth check could.
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

function rowListItems(rows: readonly SettingsRow[], drafts: SettingsDrafts): ListItem[] {
	return rows.map((row) => ({
		id: row.id,
		label: row.label,
		description: displayValue(drafts, row),
		...(row.editable ? { badge: "✎" } : { tone: "muted" as const }),
		...(row.kind === "jump" ? { badge: "›" } : {}),
	}))
}

export function SettingsModalBody(props: SettingsModalProps & { onRequestClose: () => void }) {
	const themeFace = () => props.themes
	/** Live kit theme: every color below is a token of this projection. */
	const theme = usePanelTheme()
	const chrome = () => resolvePanelChrome(theme())
	const [view, setView] = createSignal<SettingsView>("browse")
	const [pane, setPane] = createSignal<SettingsPane>("nav")
	const [sectionIndex, setSectionIndex] = createSignal(0)
	const [rowIndex, setRowIndex] = createSignal(0)
	const [editorRow, setEditorRow] = createSignal<SettingsRow | undefined>(undefined)
	const [editorValue, setEditorValue] = createSignal<string>("")
	/** Enum editor cursor (P0-2): the option Enter/Space will stage. */
	const [optionCursor, setOptionCursor] = createSignal(0)
	const [drafts, setDrafts] = createSignal<SettingsDrafts>({})
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
		return SETTINGS_SECTIONS.map((section) => ({
			...section,
			rows: buildSectionRows(section.id, ctx),
		}))
	})
	const currentSection = createMemo(() => sections()[sectionIndex()] ?? sections()[0]!)
	const currentRows = createMemo(() => currentSection().rows)
	const currentRow = createMemo(() => currentRows()[rowIndex()])
	const dirty = createMemo(() => isDirty(drafts()))

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
		setMerged(snapshot.merged)
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
		setStatus(undefined)
	}

	function openRow(row: SettingsRow) {
		setError(undefined)
		setStatus(undefined)
		if (row.kind === "jump") {
			props.onCommand?.(row.command ?? "")
			props.onRequestClose()
			return
		}
		if (row.kind === "toggle") {
			if (!row.editable) {
				setStatus(row.note ?? "该行只读")
				return
			}
			const next = displayValue(drafts(), row) !== "on"
			setDrafts((current) => stageDraft(current, row, next))
			return
		}
		if (row.kind === "submenu") {
			setEditorRow(row)
			setEditorValue("")
			setView("editor")
			return
		}
		if (!row.editable) {
			setStatus(row.note ?? "该行只读")
			return
		}
		setEditorRow(row)
		setEditorValue(row.kind === "number" && (row.value === "n/a" || row.value === "(unset)") ? "" : displayValue(drafts(), row))
		if (row.kind === "enum") {
			// Cursor starts on the effective value (P0-2): ↑↓ move it, Enter/Space
			// stage and commit that option — a complete keyboard path.
			const options = row.options ?? []
			const at = options.indexOf(displayValue(drafts(), row))
			setOptionCursor(at >= 0 ? at : 0)
		}
		setView("editor")
	}

	function moveOptionCursor(delta: number) {
		const options = editorRow()?.options ?? []
		if (options.length === 0) return
		setOptionCursor((current) => ((current + delta) % options.length + options.length) % options.length)
	}

	/** Choose the option under the cursor: stage it and leave the editor. */
	function chooseOption() {
		const row = editorRow()
		if (row === undefined) return
		const option = row.options?.[optionCursor()]
		if (option === undefined) return
		setEditorValue(option)
		stageEditorValue(option)
		backToSection()
	}

	function stageEditorValue(value: DraftValue) {
		const row = editorRow()
		if (row === undefined) return
		setDrafts((current) => stageDraft(current, row, value))
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
		stageEditorValue(next)
	}

	function commitEditor() {
		const row = editorRow()
		if (row === undefined) return
		if (row.kind === "number") {
			const parsed = parseIntegerInput(editorValue(), row.min, row.max)
			if (!parsed.ok) {
				setError(`✘ ${parsed.error}`)
				return
			}
			stageEditorValue(parsed.value)
		} else {
			stageEditorValue(editorValue())
		}
		backToSection()
	}

	function cancelEditor() {
		const row = editorRow()
		if (row !== undefined) {
			setDrafts((current) => {
				const next = { ...current }
				delete next[draftKey(row)]
				return next
			})
		}
		backToSection()
	}

	/** 取消 / Esc at the root: discard drafts, nothing was written. */
	function discardAndClose() {
		setDrafts({})
		props.onRequestClose()
	}

	const panels = usePanels()
	let confirmingDiscard = false

	/**
	 * P1-3: a dirty buffer must not vanish on one Esc. The confirmation uses
	 * the kit's confirm layer (destructive => focus starts on 取消), so a stray
	 * Esc cancels and keeps both the drafts and the panel.
	 */
	async function requestDiscardOrClose() {
		if (!dirty()) {
			discardAndClose()
			return
		}
		if (confirmingDiscard) return
		confirmingDiscard = true
		try {
			const count = Object.keys(drafts()).length
			const discard = await panels.confirm({
				title: "丢弃未保存的改动？",
				message: `有 ${count} 项未保存的修改；丢弃后不会写入任何设置。`,
				confirmLabel: "丢弃",
				cancelLabel: "取消",
				destructive: true,
				tone: "danger",
			})
			if (discard) discardAndClose()
		} catch {
			// A failed confirm leaves the panel and the drafts untouched.
		} finally {
			confirmingDiscard = false
		}
	}

	async function confirm() {
		if (busy()) return
		if (!dirty()) {
			props.onRequestClose()
			return
		}
		setBusy(true)
		setError(undefined)
		try {
			const result = await commitSettingsDrafts({
				seam: props.seam,
				...(props.themes !== undefined ? { themes: props.themes } : {}),
				rows: sections().flatMap((section) => section.rows),
				drafts: drafts(),
				merged: merged(),
				...(document() !== undefined ? { document: document() } : {}),
				local: writable().local,
				host: writable().host,
			})
			if (result.document !== undefined) setDocument(result.document)
			if (!result.ok) {
				// P1-3: roll back only the keys this commit touched (they were
				// re-described above); drafts for rows not yet reached stay, so a
				// partial failure does not throw away the user's remaining edits.
				const attempted = new Set(result.attempted)
				reloadLocal()
				await reloadHost()
				setDrafts((current) => {
					const next: Record<string, DraftValue> = {}
					for (const [key, value] of Object.entries(current)) {
						if (!attempted.has(key)) next[key] = value
					}
					return next
				})
				setError(result.error ?? "✘ 写入失败")
				return
			}
			setDrafts({})
			reloadLocal()
			await reloadHost()
			if (result.refreshFailed === true) {
				setError("⚠ 已写入，但设置刷新失败（显示的仍是旧文档）")
				return
			}
			if (result.saved.length > 0) {
				setStatus(settingsSummary(result.saved))
				props.onApplied?.(result.saved)
			}
			props.onRequestClose()
		} finally {
			setBusy(false)
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
						chooseOption()
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
						chooseOption()
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
					void requestDiscardOrClose()
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
	 * Paging keys + Ctrl+S live on the consumer layer (the kit's modal table
	 * only knows escape/enter/space/arrows; the session's global `pagedown`
	 * binding would otherwise swallow the keys). This layer:
	 *   - is only enabled while OUR layer is the stack top (`panels.depth`),
	 *     so a confirm/popup on top keeps the keys for itself;
	 *   - consumes pageup/pagedown/home/end only in the rows pane and only when
	 *     the section overflows one page — returning false lets the session's
	 *     scroll layer keep them on a fitting section;
	 *   - binds ctrl+s ONCE (no `useKeyboard` twin), calling the same `confirm`
	 *     as the 确定 button; `busy()` drops a second press mid-commit.
	 */
	/**
	 * Top-ness is a handle IDENTITY check (same object `panels.open` returned,
	 * which is also what `panels.top` yields), not a depth/position compare: a
	 * layer closing underneath must not silently disable paging/Ctrl+S. A
	 * foreign layer pushed on top makes `top` different, so this layer yields;
	 * popping it restores the same comparison result.
	 */
	const ownsTop = () => props.layerHandle !== undefined && panels.top === props.layerHandle
	Keymap.createLayer(() => ({
		mode: "global",
		priority: 2,
		enabled: ownsTop,
		commands: [
			{ bind: "pageup", title: "Settings: page up", group: "Settings", run: () => pageRows("pageup") },
			{ bind: "pagedown", title: "Settings: page down", group: "Settings", run: () => pageRows("pagedown") },
			{ bind: "home", title: "Settings: first row", group: "Settings", run: () => pageRows("home") },
			{ bind: "end", title: "Settings: last row", group: "Settings", run: () => pageRows("end") },
			{
				bind: "ctrl+s",
				title: "Settings: commit",
				group: "Settings",
				run: () => {
					void confirm()
					return true
				},
			},
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
			label: section.label,
			description: `${section.rows.length}`,
		})),
	)

	/**
	 * Row width derived from the real frame (see settingsRowWidth): terminal
	 * width/height → panel frame (`xlarge`, capped at terminal-2) → borders (2)
	 * + panel inset (3 or 1 when compact, both sides) + PanelBody inset (2) +
	 * nav column + column gap.
	 */
	const rowWidth = () => settingsRowWidth(dimensions().width, dimensions().height)
	const rowItems = createMemo(() => rowListItems(visibleRows(), drafts()))
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
					<box flexDirection="column" flexGrow={1} flexShrink={1} paddingLeft={1}>
						<box flexShrink={0} backgroundColor={chrome().titleBand}>
							<text attributes={TextAttributes.BOLD} fg={theme().text.base}>
								{currentSection().label}
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
								<text fg={theme().text.muted}>{`  ${currentRow()!.note!}`}</text>
							</Show>
							<text fg={theme().text.muted}>{`${pane() === "nav" ? "↑↓ 选择分节 · →/Enter 进入内容" : "↑↓ 选择行 · Enter 编辑 · ←/Esc 返回"}${pageIndicator()}`}</text>
						</Show>
						<Show when={editorRow() !== undefined}>
							<EditorView
								row={editorRow()!}
								value={editorValue()}
								cursor={optionCursor()}
								optionRows={Math.max(1, pageSize() - 2)}
								onValue={setEditorValue}
								onStage={stageEditorValue}
								onStep={stepValue}
								onCommit={commitEditor}
								onCancel={cancelEditor}
							/>
						</Show>
					</box>
				</box>
			</PanelBody>
			{/* Action band (v1.2): the 确定 / esc 取消 actions are real kit Buttons
			    inside a one-cell rule on each side, so the footer has a boundary
			    instead of naked text; the primary action keeps the accent fill and
			    the default action owns the accent rule. */}
			<box flexDirection="column" flexShrink={0}>
				<box flexDirection="row" justifyContent="space-between" flexShrink={0} gap={2}>
					<box
						flexShrink={0}
						border={["left", "right"]}
						borderStyle="single"
						borderColor={chrome().divider}
					>
						<Button label="取消" keyHint="esc" variant="ghost" onPress={() => void requestDiscardOrClose()} />
					</box>
					<box
						flexShrink={0}
						border={["left", "right"]}
						borderStyle="single"
						borderColor={theme().text.accent}
					>
						<Button
							label="确定"
							keyHint="ctrl+s"
							variant="primary"
							disabled={busy()}
							onPress={() => void confirm()}
						/>
					</box>
				</box>
				<box flexDirection="row" justifyContent="flex-end">
					<text fg={theme().text.muted} attributes={theme().attributes.keyHint} wrapMode="none">
						{error() ?? status() ?? (dirty() ? `未提交：${Object.keys(drafts()).length} 项 · 确定提交 / 取消丢弃` : "无未提交改动")}
					</text>
				</box>
			</box>
		</box>
	)
}

function EditorView(props: {
	row: SettingsRow
	value: string
	/** Enum cursor: Enter/Space stages this option (P0-2). */
	cursor: number
	/** Options painted at once (a window follows the cursor; §3.2). */
	optionRows: number
	onValue: (value: string) => void
	onStage: (value: DraftValue) => void
	onStep: (direction: number) => void
	onCommit: () => void
	onCancel: () => void
}) {
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
			<text>{`${props.row.label} — ${props.row.kind === "number" ? "输入整数" : props.row.kind === "enum" ? "选择值" : "查看"}`}</text>
			<Show when={props.row.note !== undefined}>
				<text>{`  ${props.row.note!}`}</text>
			</Show>
			<Show when={props.row.kind === "submenu"}>
				<For each={props.row.detail ?? []}>
					{(child) => (
						<box flexDirection="column">
							<text>{`  ${child.label}  ${child.value}`}</text>
							<Show when={child.note !== undefined}>
								<text>{`    ${child.note!}`}</text>
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
								<text>{`${optionStart() + index() === props.cursor ? "▸ " : "  "}${option}${option === props.row.value ? "  (current)" : ""}`}</text>
							</box>
						)}
					</For>
					<Show when={optionIndicator() !== ""}>
						<text>{optionIndicator()}</text>
					</Show>
				</box>
			</Show>
			<Show when={props.row.kind === "number" || props.row.kind === "text"}>
				<box flexDirection="row">
					<text>{`${props.row.kind === "number" ? "数值" : "值"}: `}</text>
					<text>{props.value}</text>
					<input
						flexGrow={1}
						value={props.value}
						onInput={(next: string) => {
							props.onValue(next)
							props.onStage(next)
						}}
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
			<text>
				{props.row.kind === "enum"
					? "↑↓ 选择 · Enter/Space 确认本行 · Esc 丢弃并返回"
					: "Enter 确认本行 · Esc 丢弃并返回 · 左/右 调整数值"}
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
				subtitle: "分节导航 · Ctrl+S 提交 · Esc 逐层返回",
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
