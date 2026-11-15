/**
 * /settings data layer v1 (whitelist-driven, no generic schema walker).
 * Rendering now lives in ./settings-modal.tsx (panel-kit modal, T18): this
 * module keeps the row builders, the write planners, the conflict contract,
 * the live appliers and the module open bridge.
 *
 * Three fixed zones:
 *   本地偏好      configSave → profile config.json, applied live in this
 *                 process (theme/themeMode/motion/footerHints/hintsLocale/
 *                 cacheHitMode/retentionDays/maxRounds/maxRoundsGrace)
 *   宿主设置      settings.mutate → the profile patch file the host applies
 *                 live (subagent.maxActiveSubagents/maxDepth,
 *                 permission.defaultPreset, session-log-deepseek.enabled)
 *   其它命名空间  describe-only rows, read-only by design — the note says
 *                 "本 TUI 不消费" instead of offering a fake edit affordance
 *
 * Write rules (hard constraints):
 *   - host writes are PATH OPS only (`{op:"set",path,value}`); the panel
 *     never sends `settings/replace` — a whole-section replace would drop
 *     the secret slots the host redacts out of `describe`.
 *   - every write is followed by a fresh `describe` (the panel re-renders
 *     from the document, never from an optimistic local copy).
 *   - a `settings/conflict` (stale revision) is retried ONCE with the
 *     re-read revision; a second conflict is shown in the panel, never
 *     swallowed.
 *   - `describe().writable === false` disables every write control and the
 *     header explains why.
 *   - a key the host baseline does not define renders `n/a` and is not
 *     editable (no guessed defaults).
 *
 * Keys (the agents-panel law): a global priority-2 keymap layer gated on the
 * module open signal + an empty dialog stack; a focus-catcher input keeps
 * printable keys out of the composer while the panel owns the screen; Esc on
 * the options/input level pops that level, and on the list it clears a
 * non-empty filter before closing.
 */
import { createSignal, onCleanup } from "solid-js"
import { t, LANGUAGE_CHOICES } from "../../i18n"
import { stringWidth } from "../../util/string-width"
import { setMotionTier, type MotionTier } from "../../skin/motion"
import {
	DEFAULT_FOOTER_HINTS,
	FOOTER_HINT_IDS,
	footerHintsFromConfig,
	hintsLocaleFromConfig,
	setFooterHints,
	setHintsLocale,
	type FooterHints,
	type HintLocale,
} from "./hints-line"
import { readCacheHitMode } from "../../seams/config"
import { activityPanelHeightFromConfig, setActivityPanelGear } from "./widgets-dock"
import type {
	SeamPermissionCatalog,
	SeamSettingsDocument,
	SeamSettingsMutateResult,
	SeamSettingsOp,
	SessionSeam,
} from "../../seams/session"

const TABLE_SEP = " │ "
const PAGE = 8
/** Max rows rendered per zone — the panel must keep all three zone titles
 * on screen inside the page's fixed-height panel slot (the real-client gate
 * asserts all three at 120x34). The cursor row is always inside its window. */
const MAX_ZONE_ROWS = 4
/** Translated value placeholders (read-time `t()`, never module-top-baked —
 * design §6 getter law). */
const unknownValue = () => t("settings.value.unset")
const naValue = () => t("settings.value.na")
const readonlyNote = () => t("settings.zone.readonlyNote")

// ---------------------------------------------------------------- zones --

export const SETTINGS_ZONES = ["local", "host", "other"] as const
export type SettingsZone = (typeof SETTINGS_ZONES)[number]

/** The three zone titles (the real-client gate asserts all three render).
 * Read-time `t()`: the language is boot-fixed, but the copy is resolved where
 * it is rendered/built, not baked into a module constant. */
export function settingsZoneTitle(zone: SettingsZone): string {
	return t(`settings.zone.title.${zone}`)
}

function settingsZoneSubtitle(zone: SettingsZone): string {
	return t(`settings.zone.subtitle.${zone}`)
}

// ---------------------------------------------------------------- items --

export type SettingsKind = "enum" | "toggle" | "number" | "text"

export type SettingsWrite =
	| { via: "config"; key: string }
	| { via: "settings"; ns: string; path: string[] }

export interface SettingsItem {
	id: string
	zone: SettingsZone
	label: string
	/** Rendered current value (`(unset)` / `n/a` included). */
	value: string
	/** Data source / write path shown beside the value. */
	source: string
	kind: SettingsKind
	editable: boolean
	options?: readonly string[]
	/** Why the row is not editable (n/a / read-only / unsupported). */
	note?: string
	write?: SettingsWrite
	/** Host namespace revision the row was read at. */
	revision?: number
	min?: number
	max?: number
}

/** The host-settings whitelist (v1 — strictly these four rows). */
export interface HostSettingSpec {
	id: string
	ns: string
	path: string[]
	label: string
	kind: SettingsKind
	min?: number
	max?: number
}

export const HOST_SETTINGS_WHITELIST: readonly HostSettingSpec[] = [
	{ id: "subagent.maxActiveSubagents", ns: "subagent", path: ["maxActiveSubagents"], label: "maxActiveSubagents", kind: "number", min: 1 },
	{ id: "subagent.maxDepth", ns: "subagent", path: ["maxDepth"], label: "maxDepth", kind: "number", min: 0 },
	{ id: "permission.defaultPreset", ns: "permission", path: ["defaultPreset"], label: "defaultPreset", kind: "enum" },
	{ id: "session-log-deepseek.enabled", ns: "session-log-deepseek", path: ["enabled"], label: "enabled", kind: "toggle" },
]

/** Namespaces the panel never lists (the whitelist owns them; `dsh-tui` is
 * not part of the opentui profile at all). */
const HIDDEN_NAMESPACES = new Set([...HOST_SETTINGS_WHITELIST.map((spec) => spec.ns), "dsh-tui"])

export const LOCAL_SETTING_IDS = [
	"theme",
	"themeMode",
	"workspaceThemeMode",
	"motion",
	...FOOTER_HINT_IDS.map((id) => `footerHints.${id}`),
	"lang",
	"cacheHitMode",
	"activityPanelHeight",
	"retentionDays",
	"maxRounds",
	"maxRoundsGrace",
] as const

function str(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** Read one own-property path from a value (no prototype walk). */
export function valueAtPath(value: unknown, path: readonly string[]): unknown {
	let current = value
	for (const key of path) {
		if (typeof current !== "object" || current === null || !Object.hasOwn(current, key)) return undefined
		current = (current as Record<string, unknown>)[key]
	}
	return current
}

/** The local preferences as rows (v1 whitelist; merged config wins for
 * display, the layer-specific rows read their own layer). */
export function buildLocalItems(input: {
	merged: Record<string, unknown>
	profile: Record<string, unknown>
	workspace: Record<string, unknown>
	themeNames?: readonly string[]
	writable: boolean
}): SettingsItem[] {
	const { merged, profile, workspace, writable } = input
	const hints = footerHintsFromConfig(merged.footerHints) ?? DEFAULT_FOOTER_HINTS
	const base = { zone: "local" as const, editable: writable }
	const items: SettingsItem[] = [
		{
			...base,
			id: "theme",
			label: "theme",
			value: str(merged.theme) ?? unknownValue(),
			// The value shown is the MERGED view (profile ⊕ workspace ⊕ env);
			// the write goes to the profile config.json only.
			source: t("settings.source.mergedTheme"),
			kind: "enum",
			...(input.themeNames !== undefined && input.themeNames.length > 0 ? { options: input.themeNames } : {}),
			write: { via: "config", key: "theme" },
		},
		{
			...base,
			id: "themeMode",
			label: "themeMode",
			value: str(profile.themeMode) ?? unknownValue(),
			source: "config.json · themeMode (profile layer)",
			kind: "enum",
			options: ["auto", "dark", "light"],
			write: { via: "config", key: "themeMode" },
		},
		{
			...base,
			id: "workspaceThemeMode",
			label: "workspaceThemeMode",
			value: str(workspace.themeMode) ?? unknownValue(),
			source: "workspace .dsh/config.yml · themeMode",
			kind: "enum",
			options: ["auto", "dark", "light"],
			write: { via: "config", key: "workspaceThemeMode" },
		},
		{
			...base,
			id: "motion",
			label: "motion",
			value: str(merged.motion) ?? "auto",
			source: "config.json · motion",
			kind: "enum",
			options: ["auto", "full", "reduced", "off"],
			write: { via: "config", key: "motion" },
		},
		...FOOTER_HINT_IDS.map<SettingsItem>((id) => ({
			...base,
			id: `footerHints.${id}`,
			label: `footerHints.${id}`,
			value: hints[id] ? "on" : "off",
			source: `config.json · footerHints.${id}`,
			kind: "toggle",
			write: { via: "config", key: "footerHints" },
		})),
		{
			...base,
			// T14 storage-key unification: `lang` is THE authoritative language
			// key; the legacy `hintsLocale` folds in read-only for the DISPLAY
			// when no unified value exists (applyHintsConfig boot parity). The
			// options are the contract set only (en + zh-CN — ja/ko are not
			// offered; the /hints lang degrade path stays its own surface).
			id: "lang",
			label: "lang",
			value: hintsLocaleFromConfig(merged.lang) ?? hintsLocaleFromConfig(merged.hintsLocale) ?? "en",
			source: "config.json · lang",
			kind: "enum",
			options: LANGUAGE_CHOICES,
			write: { via: "config", key: "lang" },
		},
		{
			...base,
			id: "cacheHitMode",
			label: "cacheHitMode",
			value: readCacheHitMode(merged),
			source: "config.json · cacheHitMode (⚡ CH footer)",
			kind: "enum",
			options: ["lastMessage", "session"],
			write: { via: "config", key: "cacheHitMode" },
		},
		{
			...base,
			// U4 panelHeight: the activity dock's size gear (1/5/7/10/all).
			// Unset renders `default` — the graded terminal-height sizing. The
			// write targets the NESTED `session.activity_panel_height` key (the
			// config schema's session section), so planLocalWrite merges the
			// profile's existing session slice instead of clobbering it.
			id: "activityPanelHeight",
			label: t("settings.row.activityPanelHeight"),
			// Normalized display: an out-of-contract stored value (hand-edited
			// config) runs the default at runtime, so the row must SAY default
			// too — the raw string would render a value the runtime ignores.
			value:
				activityPanelHeightFromConfig((merged.session as Record<string, unknown> | undefined)?.activity_panel_height) ??
				"default",
			source: "config.json · session.activity_panel_height",
			kind: "enum",
			options: ["default", "1", "5", "7", "10", "all"],
			write: { via: "config", key: "session.activity_panel_height" },
		},
		{
			...base,
			id: "retentionDays",
			label: "retentionDays",
			value: num(merged.retentionDays)?.toString() ?? unknownValue(),
			source: "config.json · retentionDays",
			kind: "number",
			min: 0,
			write: { via: "config", key: "retentionDays" },
		},
		{
			...base,
			id: "maxRounds",
			label: "maxRounds",
			value: num(merged.maxRounds)?.toString() ?? unknownValue(),
			source: "config.json · maxRounds (subagent round cap)",
			kind: "number",
			min: 0,
			write: { via: "config", key: "maxRounds" },
		},
		{
			...base,
			id: "maxRoundsGrace",
			label: "maxRoundsGrace",
			value: num(merged.maxRoundsGrace)?.toString() ?? unknownValue(),
			source: "config.json · maxRoundsGrace (wrap-up window)",
			kind: "number",
			min: 0,
			write: { via: "config", key: "maxRoundsGrace" },
		},
	]
	return items
}

/** The host-settings rows (fixed whitelist order). Missing namespaces/keys
 * render `n/a` and are not editable. `catalog` is the host's process
 * permission catalog: when present it is the ONLY option source for
 * `permission.defaultPreset` (the settings schema itself is a plain string);
 * when absent the row is read-only and shows the effective value. */
export function buildHostItems(
	document: SeamSettingsDocument | undefined,
	writable: boolean,
	catalog?: SeamPermissionCatalog,
): SettingsItem[] {
	return HOST_SETTINGS_WHITELIST.map((spec) => {
		const row = document?.namespaces.find((candidate) => candidate.ns === spec.ns)
		const item: SettingsItem = {
			id: spec.id,
			zone: "host",
			label: `${spec.ns}.${spec.label}`,
			value: naValue(),
			source: `cordis.patch.yml · ${spec.ns}.${spec.label}`,
			kind: spec.kind,
			editable: false,
			note: t("settings.note.notInHostBaseline"),
			write: { via: "settings", ns: spec.ns, path: [...spec.path] },
			...(spec.min !== undefined ? { min: spec.min } : {}),
			...(spec.max !== undefined ? { max: spec.max } : {}),
		}
		if (document === undefined) {
			item.note = t("settings.note.hostUnavailable")
			return item
		}
		if (row === undefined) return item
		const raw = valueAtPath(row.value, spec.path)
		const base = valueAtPath(row.base, spec.path)
		const declared = schemaDeclaresPath(row.schema, spec.path)
		const permissionRow = spec.id === "permission.defaultPreset"
		const hasCatalog = permissionRow && catalog !== undefined
		// Baseline-absent = the namespace does not exist, or the key appears in
		// neither the resolved value, the composition base, nor the schema. A
		// permission catalog still supplies the effective default for display.
		if (raw === undefined && base === undefined && !declared && !hasCatalog) return item
		item.revision = row.revision
		const effective = raw ?? base
		item.value =
			effective === undefined
				? hasCatalog && catalog.defaultPreset !== ""
					? catalog.defaultPreset
					: unknownValue()
				: typeof effective === "boolean"
					? effective ? "on" : "off"
					: String(effective)
		item.note = undefined
		item.editable = writable
		if (spec.kind === "enum") {
			const info = readSchemaField(row.schema, spec.path)
			// defaultPreset's schema is a plain string; its valid values are
			// the sibling `presets` dict keys. The schema is still the source.
			const derived = spec.id === "permission.defaultPreset" ? presetEnumFromSchema(row.schema) : []
			const schemaOptions = info.options !== undefined && info.options.length > 0 ? info.options : derived
			const catalogOptions = hasCatalog ? catalog.defaultOptions.map((option) => option.value) : []
			const options = catalogOptions.length > 0 ? catalogOptions : schemaOptions
			if (options.length > 0) {
				item.options = options
				if (hasCatalog) {
					item.source = t("settings.note.catalogSource")
					if (item.value !== unknownValue() && item.value !== naValue() && !options.includes(item.value)) {
						item.note = t("settings.note.valueNotInCatalog", { value: item.value })
					}
				}
			} else {
				// No option source = no picker. Keep the effective value visible and
				// say why it cannot be changed here (never an empty dropdown).
				item.editable = false
				item.note = hasCatalog
					? t("settings.note.catalogNoOptions")
					: t("settings.note.noCatalog")
			}
		}
		if (spec.kind === "number") {
			const info = readSchemaField(row.schema, spec.path)
			if (info.min !== undefined) item.min = info.min
			if (info.max !== undefined) item.max = info.max
		}
		return item
	})
}

/** Every other namespace, read-only. */
export function buildOtherItems(document: SeamSettingsDocument | undefined): SettingsItem[] {
	if (document === undefined) return []
	return document.namespaces
		.filter((row) => !HIDDEN_NAMESPACES.has(row.ns))
		.map((row) => ({
			id: `other.${row.ns}`,
			zone: "other" as const,
			label: row.ns,
			value: row.revision === undefined ? `rev ?` : `rev ${row.revision}`,
			source: readonlyNote(),
			kind: "text" as const,
			editable: false,
			note: readonlyNote(),
		}))
}

/** Namespace count shown in the header (all rows, whitelisted included). */
export function settingsNamespaceCount(document: SeamSettingsDocument | undefined): number {
	return document?.namespaces.length ?? 0
}

// --------------------------------------------------------------- schema --

interface SchemaNode {
	type?: string
	dict?: Record<string, unknown>
	inner?: unknown
	list?: readonly unknown[]
	value?: unknown
	meta?: { min?: number; max?: number; step?: number; default?: unknown }
	uid?: number
	refs?: Record<string, unknown>
}

function deref(schema: unknown, rootRefs?: Record<string, unknown>): SchemaNode | undefined {
	if (typeof schema === "number" && rootRefs !== undefined) return deref(rootRefs[String(schema)], rootRefs)
	if (typeof schema !== "object" || schema === null) return undefined
	const node = schema as SchemaNode
	if (node.refs !== undefined && node.uid !== undefined) {
		const ref = node.refs[String(node.uid)]
		return typeof ref === "object" && ref !== null ? (ref as SchemaNode) : node
	}
	return node
}

export interface SchemaFieldInfo {
	options?: string[]
	min?: number
	max?: number
}

/**
 * Read one field's enum/bounds out of a `Schema.toJSON()` envelope
 * (`{uid, refs:{[uid]:node}}`; nodes reference children by uid). Returns an
 * empty object when the schema does not declare the field — callers keep
 * `n/a`/free text instead of guessing.
 */
export function readSchemaField(schema: unknown, path: readonly string[]): SchemaFieldInfo {
	const located = schemaNodeAt(schema, path)
	if (located === undefined) return {}
	const node = located.node
	const refs = located.refs
	const info: SchemaFieldInfo = {}
	const options = enumOptions(node, refs)
	if (options.length > 0) info.options = options
	if (typeof node.meta?.min === "number") info.min = node.meta.min
	if (typeof node.meta?.max === "number") info.max = node.meta.max
	return info
}

/** Walk one field path through the schema envelope; undefined = undeclared. */
function schemaNodeAt(
	schema: unknown,
	path: readonly string[],
): { node: SchemaNode; refs: Record<string, unknown> | undefined } | undefined {
	if (typeof schema !== "object" || schema === null) return undefined
	const envelope = schema as { refs?: Record<string, unknown>; uid?: number }
	const refs = envelope.refs
	let node = refs !== undefined && envelope.uid !== undefined ? deref(envelope.uid, refs) : deref(schema, refs)
	for (const key of path) {
		if (node === undefined) return undefined
		if (node.type === "dict") {
			node = deref(node.inner, refs)
			if (node === undefined) return undefined
		}
		const child = node.type === "object" ? node.dict?.[key] : undefined
		node = deref(child, refs)
	}
	return node === undefined ? undefined : { node, refs }
}

/** Whether the schema declares the path at all (a declared-but-unset field
 * is editable; an undeclared one is `n/a`). */
export function schemaDeclaresPath(schema: unknown, path: readonly string[]): boolean {
	return schemaNodeAt(schema, path) !== undefined
}

function enumOptions(node: SchemaNode, refs: Record<string, unknown> | undefined): string[] {
	if (node.type === "const" && (typeof node.value === "string" || typeof node.value === "number")) {
		return [String(node.value)]
	}
	if (node.type === "union" && Array.isArray(node.list)) {
		const values: string[] = []
		for (const entry of node.list) {
			const child = deref(entry, refs)
			if (child?.type === "const" && (typeof child.value === "string" || typeof child.value === "number")) {
				values.push(String(child.value))
			}
		}
		if (values.length > 0) return values
	}
	return []
}

/**
 * `permission.defaultPreset` ships as a plain string schema whose valid values
 * ARE the sibling `presets` dict keys (the host rejects anything else). The
 * schema is the enum source here — no hardcoded preset list.
 *
 * Real-host fact (live `settings/describe`, opentui profile): the `permission`
 * namespace schema is
 * `{uid, refs:{N:{type:"string"}, M:{type:"object",dict:{defaultPreset:N}}}}`
 * — `defaultPreset` only, NO sibling `presets` dict — so this derivation
 * returns [] there and the row keeps the "schema 未声明可选项" note. A host
 * that does serve a `presets` dict is a valid-value list as-is: `custom`
 * (derived not-a-preset state) and `auto` (live integration) are RESERVED
 * names the permission service refuses as configured preset keys
 * (`dsh-permission-presets` throws on both), so they cannot appear in the
 * schema and need no filtering.
 */
export function presetEnumFromSchema(schema: unknown): string[] {
	if (typeof schema !== "object" || schema === null) return []
	const envelope = schema as { refs?: Record<string, unknown>; uid?: number }
	const refs = envelope.refs
	const root = refs !== undefined && envelope.uid !== undefined ? deref(envelope.uid, refs) : deref(schema, refs)
	if (root === undefined || root.type !== "object") return []
	const presets = deref(root.dict?.presets, refs)
	if (presets?.type !== "dict" || presets.dict === undefined) return []
	return Object.keys(presets.dict)
}

// --------------------------------------------------------------- writes --

export type LocalWritePlan =
	| { ok: true; patch: Record<string, unknown>; applied: string | boolean | number | undefined }
	| { ok: false; error: string }

/** Validate one local value and build the configSave patch. Nested keys (the
 * `session.activity_panel_height` gear) take an optional `session` slice — the
 * PROFILE's current session object — so the patch carries the whole section
 * (configSave merges top-level keys shallowly; a bare `{session:{…}}` would
 * drop every sibling session key). */
export function planLocalWrite(
	item: SettingsItem,
	raw: string | boolean | number,
	hints: FooterHints,
	session?: Record<string, unknown>,
): LocalWritePlan {
	if (item.write?.via !== "config") return { ok: false, error: t("settings.error.notLocal") }
	const key = item.write.key
	if (item.id.startsWith("footerHints.")) {
		const segment = item.id.slice("footerHints.".length) as keyof FooterHints
		if (!(segment in DEFAULT_FOOTER_HINTS)) return { ok: false, error: t("settings.error.unknownHintSegment", { segment }) }
		const on = typeof raw === "boolean" ? raw : raw === "on" || raw === "true"
		return { ok: true, patch: { footerHints: { ...hints, [segment]: on } }, applied: on }
	}
	if (key === "session.activity_panel_height") {
		const text = String(raw)
		// `default` (or an emptied input) unsets the key: the gear returns to
		// the graded terminal-height sizing. `undefined` values vanish on the
		// JSON write, so the key is dropped rather than stored as null.
		const gear = text === "" || text === "default" ? undefined : activityPanelHeightFromConfig(text)
		if (text !== "" && text !== "default" && gear === undefined) {
			// Enum guard: only the contract spellings land in the profile — a
			// stray value would be silently ignored at runtime while the row
			// still renders it (write what the validator will read back).
			return { ok: false, error: t("settings.error.invalidGear", { value: text }) }
		}
		return {
			ok: true,
			patch: { session: { ...(session ?? {}), activity_panel_height: gear } },
			applied: gear,
		}
	}
	if (item.kind === "toggle") {
		const on = typeof raw === "boolean" ? raw : raw === "on" || raw === "true"
		return { ok: true, patch: { [key]: on }, applied: on }
	}
	if (item.kind === "number") {
		const text = String(raw).trim()
		if (text === "") return { ok: true, patch: { [key]: undefined }, applied: undefined }
		const parsed = parseIntegerInput(text, item.min, item.max)
		if (!parsed.ok) return parsed
		return { ok: true, patch: { [key]: parsed.value }, applied: parsed.value }
	}
	const text = String(raw)
	if (text === "") return { ok: false, error: t("settings.error.emptyValue") }
	return { ok: true, patch: { [key]: text }, applied: text }
}

export type HostWritePlan =
	| { ok: true; ns: string; ops: SeamSettingsOp[]; applied: unknown }
	| { ok: false; error: string }

/** Validate one host value and build the path-op write (set/unset only). */
export function planHostWrite(item: SettingsItem, raw: string | boolean | number): HostWritePlan {
	if (item.write?.via !== "settings") return { ok: false, error: t("settings.error.notHost") }
	const { ns, path } = item.write
	if (item.kind === "toggle") {
		const on = typeof raw === "boolean" ? raw : raw === "on" || raw === "true"
		return { ok: true, ns, ops: [{ op: "set", path: [...path], value: on }], applied: on }
	}
	if (item.kind === "number") {
		const parsed = parseIntegerInput(String(raw), item.min, item.max)
		if (!parsed.ok) return parsed
		return { ok: true, ns, ops: [{ op: "set", path: [...path], value: parsed.value }], applied: parsed.value }
	}
	const text = String(raw)
	if (text === "") return { ok: false, error: t("settings.error.emptyValue") }
	return { ok: true, ns, ops: [{ op: "set", path: [...path], value: text }], applied: text }
}

export type ParsedInteger = { ok: true; value: number } | { ok: false; error: string }

/** Integer input for every number row (all settings are integers). */
export function parseIntegerInput(text: string, min?: number, max?: number): ParsedInteger {
	const trimmed = text.trim()
	if (!/^-?\d+$/.test(trimmed)) return { ok: false, error: t("settings.error.expectedInteger", { value: trimmed }) }
	const value = Number(trimmed)
	if (!Number.isSafeInteger(value)) return { ok: false, error: t("settings.error.integerOutOfRange", { value: trimmed }) }
	if (min !== undefined && value < min) return { ok: false, error: t("settings.error.min", { min }) }
	if (max !== undefined && value > max) return { ok: false, error: t("settings.error.max", { max }) }
	return { ok: true, value }
}

/** The revision to send for one namespace (undefined = first write before any read). */
export function currentHostRevision(document: SeamSettingsDocument | undefined, ns: string): number | undefined {
	return document?.namespaces.find((row) => row.ns === ns)?.revision
}

export interface HostWriteOutcome {
	result: SeamSettingsMutateResult
	/** Mutate calls made (1 = no conflict, 2 = one retry). */
	attempts: number
	/** Fresh document after the last write (every write re-describes). */
	document?: SeamSettingsDocument
	describeError?: string
	/** The write landed but the refresh after it still failed (retried once). */
	refreshFailed?: boolean
}

/**
 * One host write with the conflict contract: write → describe → (on
 * `settings/conflict`) re-read the revision and retry ONCE → describe. Any
 * other failure is returned for the panel to display (never thrown away).
 *
 * Two rules the review pinned:
 *   - a conflict whose re-read describe FAILED has no fresh revision, so the
 *     write is NOT retried blind: the conflict is surfaced instead (C3).
 *   - a successful write whose refresh describe failed gets ONE more describe
 *     (refresh only — no second write); a still-failed refresh sets
 *     `refreshFailed` so the panel says "written but not refreshed" instead of
 *     claiming a saved value it could not read back (M2b).
 */
export async function commitHostWrite(input: {
	mutate(ns: string, ops: SeamSettingsOp[], revision?: number): Promise<SeamSettingsMutateResult>
	describe(): Promise<SeamSettingsDocument>
	ns: string
	ops: SeamSettingsOp[]
	revision?: number
}): Promise<HostWriteOutcome> {
	const describeOnce = async (): Promise<{ document?: SeamSettingsDocument; describeError?: string }> => {
		try {
			return { document: await input.describe() }
		} catch (error) {
			return { describeError: error instanceof Error ? error.message : String(error) }
		}
	}
	let attempts = 0
	let result = await input.mutate(input.ns, input.ops, input.revision)
	attempts++
	let fresh = await describeOnce()
	if (!result.ok && result.conflict && attempts === 1) {
		// No fresh document = no fresh revision. Retrying the write without it
		// would be a lock-free overwrite; surface the conflict instead.
		if (fresh.document === undefined) return { result, attempts, ...fresh }
		const revision = currentHostRevision(fresh.document, input.ns)
		result = await input.mutate(input.ns, input.ops, revision)
		attempts++
		fresh = await describeOnce()
	}
	if (result.ok && fresh.document === undefined) {
		const retried = await describeOnce()
		if (retried.document === undefined) {
			return { result, attempts, ...retried, refreshFailed: true }
		}
		fresh = retried
	}
	return { result, attempts, ...fresh }
}

// ---------------------------------------------------------------- lines --

export type SettingsTone = "accent" | "selected" | "muted" | "subtle" | "attention"

export interface SettingsLine {
	text: string
	tone: SettingsTone
}

function clipText(text: string, limit: number): string {
	if (limit <= 0) return ""
	if (stringWidth(text) <= limit) return text
	let width = 0
	let out = ""
	for (const char of text) {
		const charWidth = stringWidth(char)
		if (width + charWidth > limit - 1) break
		out += char
		width += charWidth
	}
	return limit <= 1 ? "…" : `${out}…`
}

function padCell(text: string, width: number): string {
	const clipped = clipText(text, width)
	return clipped + " ".repeat(Math.max(0, width - stringWidth(clipped)))
}

/** Rows surviving the filter (label/value/source/id, case-insensitive). */
export function filterSettingsItems(items: readonly SettingsItem[], query: string): SettingsItem[] {
	const needle = query.trim().toLowerCase()
	if (needle === "") return [...items]
	return items.filter((item) =>
		`${item.label} ${item.value} ${item.source} ${item.id}`.toLowerCase().includes(needle),
	)
}

/** The enabled/disabled verdict for both write halves. A failed
 * `settings/describe` only costs the HOST half: local preferences are
 * `configSave` writes and do not depend on the host document at all (C5). */
export function settingsWritable(
	document: SeamSettingsDocument | undefined,
	describeError: string | undefined,
	hasFace: boolean,
): { local: boolean; host: boolean; reason?: string } {
	if (!hasFace) return { local: true, host: false, reason: t("settings.writable.noFace") }
	if (describeError !== undefined) {
		return {
			local: true,
			host: false,
			reason: t("settings.writable.describeFailed", { detail: describeError }),
		}
	}
	if (document !== undefined && document.writable === false) {
		return { local: false, host: false, reason: t("settings.writable.readOnlyDoc") }
	}
	return { local: true, host: true }
}

export interface SettingsLinesInput {
	items: readonly SettingsItem[]
	cursor: number
	width: number
	filter: string
	identity?: { profile: string; dshHome: string }
	writable: boolean
	writableReason?: string
	namespaceCount: number
	hasDocument: boolean
	status?: string
}

/** The list layer as rendered lines (header + three zones + footer). Pure:
 * the panel test asserts zone titles, row content and the selection marker. */
export function settingsLines(input: SettingsLinesInput): SettingsLine[] {
	const { items, cursor, width } = input
	const lines: SettingsLine[] = [{ text: clipText(t("settings.panel.title"), width), tone: "accent" }]
	if (input.identity !== undefined) {
		lines.push({
			text: clipText(t("settings.panel.identity", { profile: input.identity.profile, dshHome: input.identity.dshHome }), width),
			tone: "muted",
		})
	}
	const documentState = input.writable ? t("settings.panel.state.writable") : t("settings.panel.state.readOnly")
	lines.push({
		text: clipText(
			input.hasDocument
				? t("settings.panel.document", { state: documentState, count: input.namespaceCount })
				: t("settings.panel.documentNoDoc", { state: documentState, count: input.namespaceCount }),
			width,
		),
		tone: "subtle",
	})
	if (input.writableReason !== undefined) {
		lines.push({ text: clipText(`⚠ ${input.writableReason}`, width), tone: "attention" })
	}
	if (input.filter !== "") lines.push({ text: clipText(t("settings.panel.filter", { query: input.filter }), width), tone: "subtle" })
	lines.push({ text: "", tone: "subtle" })

	const visible = filterSettingsItems(items, input.filter)
	const keyWidth = Math.min(26, Math.max(8, ...visible.map((item) => stringWidth(item.label)), 8))
	const valueWidth = Math.min(24, Math.max(10, ...visible.map((item) => stringWidth(item.value)), 10))
	if (visible.length === 0) {
		lines.push({ text: clipText(t("settings.panel.noMatch", { query: input.filter }), width), tone: "muted" })
	}
	const selectedItem = visible[cursor]
	for (const zone of SETTINGS_ZONES) {
		const zoneItems = visible.filter((item) => item.zone === zone)
		lines.push({
			text: clipText(`${settingsZoneTitle(zone)}  ${settingsZoneSubtitle(zone)}`, width),
			tone: "accent",
		})
		if (zoneItems.length === 0) {
			lines.push({ text: clipText(t("settings.panel.none"), width), tone: "subtle" })
			continue
		}
		// Window the zone around the cursor row; the header rows stay put so
		// every zone title remains on screen.
		let start = 0
		let shown = zoneItems
		if (zoneItems.length > MAX_ZONE_ROWS) {
			const selectedIndex = selectedItem !== undefined && selectedItem.zone === zone ? zoneItems.indexOf(selectedItem) : -1
			if (selectedIndex >= 0) {
				start = Math.max(0, Math.min(selectedIndex - Math.floor(MAX_ZONE_ROWS / 2), zoneItems.length - MAX_ZONE_ROWS))
			}
			shown = zoneItems.slice(start, start + MAX_ZONE_ROWS)
			if (start > 0) lines.push({ text: clipText(t("settings.panel.moreAbove", { count: start }), width), tone: "subtle" })
		}
		for (const item of shown) {
			const selected = selectedItem !== undefined && item.id === selectedItem.id
			const value = item.editable ? `✎ ${item.value}` : item.value
			const source = item.note ?? item.source
			const text = `${selected ? "▸ " : "  "}${padCell(item.label, keyWidth)}${TABLE_SEP}${padCell(value, valueWidth)}${TABLE_SEP}${source}`
			lines.push({ text: clipText(text, width), tone: selected ? "selected" : "muted" })
		}
		const below = zoneItems.length - start - shown.length
		if (below > 0) lines.push({ text: clipText(t("settings.panel.moreBelow", { count: below }), width), tone: "subtle" })
	}
	lines.push({ text: "", tone: "subtle" })
	if (input.status !== undefined) {
		lines.push({ text: clipText(input.status, width), tone: "attention" })
	}
	if (visible.length > PAGE) {
		lines.push({ text: clipText(`(${cursor + 1}/${visible.length})`, width), tone: "subtle" })
	}
	lines.push({
		text: clipText(t("settings.panel.footer"), width),
		tone: "subtle",
	})
	return lines
}

/** The enum picker layer. `status` carries a failed write verbatim — the list
 * footer is not on screen here, so a write error must render in this layer. */
export function settingsOptionLines(
	item: SettingsItem,
	options: readonly string[],
	cursor: number,
	width: number,
	status?: string,
): SettingsLine[] {
	const lines: SettingsLine[] = [{ text: clipText(t("settings.options.title", { label: item.label }), width), tone: "accent" }]
	lines.push({ text: clipText(item.source, width), tone: "subtle" })
	if (status !== undefined) lines.push({ text: clipText(status, width), tone: "attention" })
	lines.push({ text: "", tone: "subtle" })
	for (let index = 0; index < options.length; index++) {
		const option = options[index]!
		const selected = index === cursor
		const current = option === item.value ? t("settings.options.current") : ""
		lines.push({
			text: clipText(`${selected ? "▸ " : "  "}${option}${current}`, width),
			tone: selected ? "selected" : "muted",
		})
	}
	lines.push({ text: "", tone: "subtle" })
	lines.push({ text: clipText(t("settings.options.footer"), width), tone: "subtle" })
	return lines
}

/** The text/number editor layer. */
export function settingsInputLines(
	item: SettingsItem,
	value: string,
	width: number,
	error?: string,
): SettingsLine[] {
	const action = item.kind === "number" ? t("settings.input.enterInteger") : t("settings.input.enterValue")
	const lines: SettingsLine[] = [
		{ text: clipText(t("settings.input.title", { label: item.label, action }), width), tone: "accent" },
		{ text: clipText(item.source, width), tone: "subtle" },
	]
	if (item.min !== undefined || item.max !== undefined) {
		lines.push({
			text: clipText(t("settings.input.bounds", { min: item.min ?? "−∞", max: item.max ?? "∞" }), width),
			tone: "subtle",
		})
	}
	lines.push({ text: "", tone: "subtle" })
	if (error !== undefined) lines.push({ text: clipText(`✘ ${error}`, width), tone: "attention" })
	lines.push({ text: clipText(`> ${value}`, width), tone: "accent" })
	lines.push({ text: "", tone: "subtle" })
	// `empty = unset` is a LOCAL number-key rule only (planLocalWrite maps ""
	// to an undefined value the profile writer drops). Host number rows and
	// every text/enum row refuse an empty value. Full-sentence branch keys
	// (design §6 pattern 2 — no half-key + concat).
	const footer =
		item.kind === "number" && item.write?.via === "config"
			? t("settings.input.footerLocalNumber")
			: t("settings.input.footerRefuse")
	lines.push({ text: clipText(footer, width), tone: "subtle" })
	return lines
}

/** Esc hierarchy (as implemented): the editor/picker levels pop back to the
 * list; on the list a non-empty filter clears first, then the next Esc
 * closes. The filter only exists on the list layer. */
export type SettingsEscape =
	| { action: "clearFilter" }
	| { action: "back" }
	| { action: "close" }

export function settingsEscape(level: "list" | "options" | "input", filter: string): SettingsEscape {
	if (level !== "list") return { action: "back" }
	if (filter !== "") return { action: "clearFilter" }
	return { action: "close" }
}

/** Exit summary (mirrors the agents panel). */
export function settingsSummary(changed: readonly string[]): string {
	return changed.length > 0 ? t("settings.summary.updated", { labels: changed.join(", ") }) : t("settings.summary.unchanged")
}

// ------------------------------------------------- bridge + appliers --

const [bridgeOpen, setBridgeOpen] = createSignal<string | undefined>(undefined)
const [panelOpen, setPanelOpen] = createSignal(false)

/** Whether the /settings panel is on screen (the sidebar Esc layer yields). */
export const settingsPanelOpen = panelOpen

/** Open /settings; an optional item id preselects that row. */
export function openSettingsPanel(itemId?: string): void {
	setBridgeOpen(itemId ?? "")
}

/**
 * The panel's module-scope open state. Unmount resets it so a stale `true`
 * cannot leave the sidebar's priority-10 Esc layer disabled (b36c821).
 */
export function useSettingsPanelOpenState() {
	onCleanup(() => setPanelOpen(false))
	return [settingsPanelOpen, setPanelOpen] as const
}

/** Persist flag for a theme-face apply: the panel persists through
 * `configSave` itself and asks the face for the LIVE half only, so the face
 * must not write a second time to the layer it happens to own. */
export interface ThemeApplyOptions {
	persist?: boolean
}

/** The theme face the entry injects (live apply + persistence is the panel's). */
export interface SettingsThemeFace {
	current(): string
	list(): string[]
	set(name: string, options?: ThemeApplyOptions): boolean
	mode?(): {
		current(): "auto" | "dark" | "light"
		set(mode: "auto" | "dark" | "light", options?: ThemeApplyOptions): boolean
	}
}

/** Read the merged / profile / workspace snapshots for a panel open. A broken
 * face degrades to an empty map (the row builders never throw). */
export function readLocalSnapshot(seam: SessionSeam): {
	merged: Record<string, unknown>
	profile: Record<string, unknown>
	workspace: Record<string, unknown>
} {
	let merged: Record<string, unknown> = {}
	let profile: Record<string, unknown> = {}
	let workspace: Record<string, unknown> = {}
	try {
		merged = seam.configLoad?.() ?? {}
	} catch {
		merged = {}
	}
	try {
		profile = seam.configRaw?.() ?? {}
	} catch {
		profile = {}
	}
	try {
		workspace = seam.workspaceConfig?.() ?? {}
	} catch {
		workspace = {}
	}
	return { merged, profile, workspace }
}

/** Read the host settings document + permission catalog (both degrade
 * independently: a failed catalog read must not disable the host zone). */
export async function readHostSnapshot(seam: SessionSeam): Promise<{
	document: SeamSettingsDocument | undefined
	describeError: string | undefined
	catalog: SeamPermissionCatalog | undefined
}> {
	const face = seam.settings
	if (face === undefined) return { document: undefined, describeError: undefined, catalog: undefined }
	let document: SeamSettingsDocument | undefined
	let describeError: string | undefined
	try {
		document = await face.describe()
	} catch (error) {
		describeError = error instanceof Error ? error.message : String(error)
	}
	let catalog: SeamPermissionCatalog | undefined
	try {
		catalog = await face.permissionCatalog?.()
	} catch {
		catalog = undefined
	}
	return { document, describeError, catalog }
}

/**
 * Apply the live effect a persisted local key drives in THIS process. The
 * caller already persisted through `planLocalWrite` + `configSave`, so every
 * theme-face call is LIVE-only (`persist: false`): the face owns a boot-time
 * layer (themeModePatchKey) and its own write would land there even while the
 * user edits another layer (M1).
 *
 * The branch key is the WRITE TARGET (`write.key`), not the row id (P1-1):
 * the General rows carry presentation ids (`general.appearance`,
 * `general.language`) while their writes are the local keys themeMode /
 * hintsLocale. `footerHints` is one shared write key holding one boolean per
 * hint id, so that branch keys the row-id segment.
 */
export function applySettingsLive(
	item: SettingsItem,
	applied: string | boolean | number | undefined,
	hints: FooterHints,
	themes?: SettingsThemeFace,
): void {
	const write = item.write
	if (write?.via !== "config") return
	const key = write.key
	try {
		if (key === "footerHints") {
			const segment = item.id.slice("footerHints.".length) as keyof FooterHints
			if (!(segment in DEFAULT_FOOTER_HINTS)) return
			setFooterHints({ ...hints, [segment]: applied === true })
			return
		}
		switch (key) {
			case "motion":
				setMotionTier(applied === undefined || applied === "auto" ? undefined : (String(applied) as MotionTier))
				break
			case "lang":
				setHintsLocale(String(applied) as HintLocale)
				break
			case "session.activity_panel_height":
				// U4 panelHeight live apply: the dock reads the gear signal
				// reactively, so this set repaints the panel in place. An invalid
				// stored value falls back to unset (the validator's fail-open law).
				setActivityPanelGear(applied === undefined ? undefined : activityPanelHeightFromConfig(applied))
				break
			case "theme":
				themes?.set(String(applied), { persist: false })
				break
			case "themeMode":
			case "workspaceThemeMode": {
				const mode = String(applied)
				if (mode === "auto" || mode === "dark" || mode === "light") {
					themes?.mode?.().set(mode, { persist: false })
				}
				break
			}
		}
	} catch (error) {
		console.error("[settings] live apply failed:", error)
	}
}

// ------------------------------------------------------------- bridge ----

/** The module open bridge (a string = row id to preselect, "" = none). */
export const settingsBridgeOpen = bridgeOpen

/** Consume/clear the bridge (the modal host owns the read). */
export function setSettingsBridge(value: string | undefined): void {
	setBridgeOpen(value)
}
