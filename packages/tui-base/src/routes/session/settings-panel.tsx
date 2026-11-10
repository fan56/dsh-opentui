/**
 * SettingsPanel — the /settings panel v1 (whitelist-driven, no generic
 * schema walker).
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
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { InputRenderable } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { Keymap } from "../../context/keymap"
import { useDialog } from "../../ui/dialog"
import { useThemeOptional } from "../../context/theme"
import { warningColor } from "../../skin/semantic"
import { stringWidth } from "../../util/string-width"
import { setMotionTier, type MotionTier } from "../../skin/motion"
import {
	DEFAULT_FOOTER_HINTS,
	FOOTER_HINT_IDS,
	HINT_LOCALES,
	footerHintsFromConfig,
	hintsLocaleFromConfig,
	setFooterHints,
	setHintsLocale,
	type FooterHints,
	type HintLocale,
} from "./hints-line"
import { readCacheHitMode } from "../../seams/config"
import type {
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
const UNKNOWN = "(unset)"
const NA = "n/a"
const READONLY_NOTE = "只读 · 本 TUI 不消费"

// ---------------------------------------------------------------- zones --

export const SETTINGS_ZONES = ["local", "host", "other"] as const
export type SettingsZone = (typeof SETTINGS_ZONES)[number]

/** The three zone titles (the real-client gate asserts all three render). */
export const SETTINGS_ZONE_TITLES: Record<SettingsZone, string> = {
	local: "本地偏好",
	host: "宿主设置",
	other: "其它命名空间",
}

const ZONE_SUBTITLE: Record<SettingsZone, string> = {
	local: "(config.json → live)",
	host: "(settings.mutate → cordis.patch.yml → host live)",
	other: `(${READONLY_NOTE})`,
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
	"hintsLocale",
	"cacheHitMode",
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
			value: str(merged.theme) ?? UNKNOWN,
			// The value shown is the MERGED view (profile ⊕ workspace ⊕ env);
			// the write goes to the profile config.json only.
			source: "合并值 · theme（写 config.json）",
			kind: "enum",
			...(input.themeNames !== undefined && input.themeNames.length > 0 ? { options: input.themeNames } : {}),
			write: { via: "config", key: "theme" },
		},
		{
			...base,
			id: "themeMode",
			label: "themeMode",
			value: str(profile.themeMode) ?? UNKNOWN,
			source: "config.json · themeMode (profile layer)",
			kind: "enum",
			options: ["auto", "dark", "light"],
			write: { via: "config", key: "themeMode" },
		},
		{
			...base,
			id: "workspaceThemeMode",
			label: "workspaceThemeMode",
			value: str(workspace.themeMode) ?? UNKNOWN,
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
			id: "hintsLocale",
			label: "hintsLocale",
			value: hintsLocaleFromConfig(merged.hintsLocale) ?? "en",
			source: "config.json · hintsLocale",
			kind: "enum",
			options: HINT_LOCALES,
			write: { via: "config", key: "hintsLocale" },
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
			id: "retentionDays",
			label: "retentionDays",
			value: num(merged.retentionDays)?.toString() ?? UNKNOWN,
			source: "config.json · retentionDays",
			kind: "number",
			min: 0,
			write: { via: "config", key: "retentionDays" },
		},
		{
			...base,
			id: "maxRounds",
			label: "maxRounds",
			value: num(merged.maxRounds)?.toString() ?? UNKNOWN,
			source: "config.json · maxRounds (subagent round cap)",
			kind: "number",
			min: 0,
			write: { via: "config", key: "maxRounds" },
		},
		{
			...base,
			id: "maxRoundsGrace",
			label: "maxRoundsGrace",
			value: num(merged.maxRoundsGrace)?.toString() ?? UNKNOWN,
			source: "config.json · maxRoundsGrace (wrap-up window)",
			kind: "number",
			min: 0,
			write: { via: "config", key: "maxRoundsGrace" },
		},
	]
	return items
}

/** The host-settings rows (fixed whitelist order). Missing namespaces/keys
 * render `n/a` and are not editable. */
export function buildHostItems(document: SeamSettingsDocument | undefined, writable: boolean): SettingsItem[] {
	return HOST_SETTINGS_WHITELIST.map((spec) => {
		const row = document?.namespaces.find((candidate) => candidate.ns === spec.ns)
		const item: SettingsItem = {
			id: spec.id,
			zone: "host",
			label: `${spec.ns}.${spec.label}`,
			value: NA,
			source: `cordis.patch.yml · ${spec.ns}.${spec.label}`,
			kind: spec.kind,
			editable: false,
			note: "n/a — 宿主基线未定义",
			write: { via: "settings", ns: spec.ns, path: [...spec.path] },
			...(spec.min !== undefined ? { min: spec.min } : {}),
			...(spec.max !== undefined ? { max: spec.max } : {}),
		}
		if (document === undefined) {
			item.note = "宿主设置不可用（未读到 settings 文档）"
			return item
		}
		if (row === undefined) return item
		const raw = valueAtPath(row.value, spec.path)
		const base = valueAtPath(row.base, spec.path)
		const declared = schemaDeclaresPath(row.schema, spec.path)
		// Baseline-absent = the namespace does not exist, or the key appears in
		// neither the resolved value, the composition base, nor the schema.
		if (raw === undefined && base === undefined && !declared) return item
		item.revision = row.revision
		const effective = raw ?? base
		item.value =
			effective === undefined
				? UNKNOWN
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
			const options = info.options !== undefined && info.options.length > 0 ? info.options : derived
			if (options.length > 0) item.options = options
			else item.note = "schema 未声明可选项"
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
			source: READONLY_NOTE,
			kind: "text" as const,
			editable: false,
			note: READONLY_NOTE,
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

/** Validate one local value and build the configSave patch. */
export function planLocalWrite(item: SettingsItem, raw: string | boolean | number, hints: FooterHints): LocalWritePlan {
	if (item.write?.via !== "config") return { ok: false, error: "not a local preference" }
	const key = item.write.key
	if (item.id.startsWith("footerHints.")) {
		const segment = item.id.slice("footerHints.".length) as keyof FooterHints
		if (!(segment in DEFAULT_FOOTER_HINTS)) return { ok: false, error: `unknown hint segment "${segment}"` }
		const on = typeof raw === "boolean" ? raw : raw === "on" || raw === "true"
		return { ok: true, patch: { footerHints: { ...hints, [segment]: on } }, applied: on }
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
	if (text === "") return { ok: false, error: "value must not be empty" }
	return { ok: true, patch: { [key]: text }, applied: text }
}

export type HostWritePlan =
	| { ok: true; ns: string; ops: SeamSettingsOp[]; applied: unknown }
	| { ok: false; error: string }

/** Validate one host value and build the path-op write (set/unset only). */
export function planHostWrite(item: SettingsItem, raw: string | boolean | number): HostWritePlan {
	if (item.write?.via !== "settings") return { ok: false, error: "not a host setting" }
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
	if (text === "") return { ok: false, error: "value must not be empty" }
	return { ok: true, ns, ops: [{ op: "set", path: [...path], value: text }], applied: text }
}

export type ParsedInteger = { ok: true; value: number } | { ok: false; error: string }

/** Integer input for every number row (all settings are integers). */
export function parseIntegerInput(text: string, min?: number, max?: number): ParsedInteger {
	const trimmed = text.trim()
	if (!/^-?\d+$/.test(trimmed)) return { ok: false, error: `expected an integer, got "${trimmed}"` }
	const value = Number(trimmed)
	if (!Number.isSafeInteger(value)) return { ok: false, error: `integer out of range: ${trimmed}` }
	if (min !== undefined && value < min) return { ok: false, error: `must be >= ${min}` }
	if (max !== undefined && value > max) return { ok: false, error: `must be <= ${max}` }
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
	if (!hasFace) return { local: true, host: false, reason: "宿主 settings 接口不可用 — 仅本地偏好可写" }
	if (describeError !== undefined) {
		return {
			local: true,
			host: false,
			reason: `settings/describe 失败：${describeError} — 宿主设置不可写，本地偏好仍可写`,
		}
	}
	if (document !== undefined && document.writable === false) {
		return { local: false, host: false, reason: "profile 的 settings 文档只读（writable: false）— 已禁用全部写控件" }
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
	const lines: SettingsLine[] = [{ text: clipText("● Settings", width), tone: "accent" }]
	if (input.identity !== undefined) {
		lines.push({ text: clipText(`profile ${input.identity.profile} · ${input.identity.dshHome}`, width), tone: "muted" })
	}
	lines.push({
		text: clipText(
			`document ${input.writable ? "writable" : "read-only"} · ${input.namespaceCount} namespace(s)${input.hasDocument ? "" : " · no document"}`,
			width,
		),
		tone: "subtle",
	})
	if (input.writableReason !== undefined) {
		lines.push({ text: clipText(`⚠ ${input.writableReason}`, width), tone: "attention" })
	}
	if (input.filter !== "") lines.push({ text: clipText(`filter: "${input.filter}"`, width), tone: "subtle" })
	lines.push({ text: "", tone: "subtle" })

	const visible = filterSettingsItems(items, input.filter)
	const keyWidth = Math.min(26, Math.max(8, ...visible.map((item) => stringWidth(item.label)), 8))
	const valueWidth = Math.min(24, Math.max(10, ...visible.map((item) => stringWidth(item.value)), 10))
	if (visible.length === 0) {
		lines.push({ text: clipText(`  no setting matches "${input.filter}"`, width), tone: "muted" })
	}
	const selectedItem = visible[cursor]
	for (const zone of SETTINGS_ZONES) {
		const zoneItems = visible.filter((item) => item.zone === zone)
		lines.push({
			text: clipText(`${SETTINGS_ZONE_TITLES[zone]}  ${ZONE_SUBTITLE[zone]}`, width),
			tone: "accent",
		})
		if (zoneItems.length === 0) {
			lines.push({ text: clipText("  (none)", width), tone: "subtle" })
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
			if (start > 0) lines.push({ text: clipText(`  … ${start} more above`, width), tone: "subtle" })
		}
		for (const item of shown) {
			const selected = selectedItem !== undefined && item.id === selectedItem.id
			const value = item.editable ? `✎ ${item.value}` : item.value
			const source = item.note ?? item.source
			const text = `${selected ? "▸ " : "  "}${padCell(item.label, keyWidth)}${TABLE_SEP}${padCell(value, valueWidth)}${TABLE_SEP}${source}`
			lines.push({ text: clipText(text, width), tone: selected ? "selected" : "muted" })
		}
		const below = zoneItems.length - start - shown.length
		if (below > 0) lines.push({ text: clipText(`  … ${below} more below (type to filter)`, width), tone: "subtle" })
	}
	lines.push({ text: "", tone: "subtle" })
	if (input.status !== undefined) {
		lines.push({ text: clipText(input.status, width), tone: "attention" })
	}
	if (visible.length > PAGE) {
		lines.push({ text: clipText(`(${cursor + 1}/${visible.length})`, width), tone: "subtle" })
	}
	lines.push({
		text: clipText("↑↓ move · PgUp/PgDn page · Enter edit · type to filter · Esc clear/back", width),
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
	const lines: SettingsLine[] = [{ text: clipText(`● ${item.label} — pick a value`, width), tone: "accent" }]
	lines.push({ text: clipText(item.source, width), tone: "subtle" })
	if (status !== undefined) lines.push({ text: clipText(status, width), tone: "attention" })
	lines.push({ text: "", tone: "subtle" })
	for (let index = 0; index < options.length; index++) {
		const option = options[index]!
		const selected = index === cursor
		const current = option === item.value ? "  (current)" : ""
		lines.push({
			text: clipText(`${selected ? "▸ " : "  "}${option}${current}`, width),
			tone: selected ? "selected" : "muted",
		})
	}
	lines.push({ text: "", tone: "subtle" })
	lines.push({ text: clipText("↑↓ navigate · Enter apply · Esc back", width), tone: "subtle" })
	return lines
}

/** The text/number editor layer. */
export function settingsInputLines(
	item: SettingsItem,
	value: string,
	width: number,
	error?: string,
): SettingsLine[] {
	const label = item.kind === "number" ? "enter an integer" : "enter a value"
	const lines: SettingsLine[] = [
		{ text: clipText(`● ${item.label} — ${label}`, width), tone: "accent" },
		{ text: clipText(item.source, width), tone: "subtle" },
	]
	if (item.min !== undefined || item.max !== undefined) {
		lines.push({
			text: clipText(`bounds: ${item.min ?? "−∞"} … ${item.max ?? "∞"}`, width),
			tone: "subtle",
		})
	}
	lines.push({ text: "", tone: "subtle" })
	if (error !== undefined) lines.push({ text: clipText(`✘ ${error}`, width), tone: "attention" })
	lines.push({ text: clipText(`> ${value}`, width), tone: "accent" })
	lines.push({ text: "", tone: "subtle" })
	// `empty = unset` is a LOCAL number-key rule only (planLocalWrite maps ""
	// to an undefined value the profile writer drops). Host number rows and
	// every text/enum row refuse an empty value.
	const emptyHint =
		item.kind === "number" && item.write?.via === "config" ? "empty = unset · " : "empty is refused · "
	lines.push({ text: clipText(`Enter save · ${emptyHint}Esc back`, width), tone: "subtle" })
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
	return changed.length > 0 ? `Settings updated: ${changed.join(", ")}` : "Settings unchanged."
}

// ------------------------------------------------------------ component --

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

type Level = "list" | "options" | "input"

export function SettingsPanel(props: {
	seam: SessionSeam
	themes?: SettingsThemeFace
	onClosed?: (summary?: string) => void
}) {
	const theme = useThemeOptional()
	const dialog = useDialog()
	const dimensions = useTerminalDimensions()

	const [open, setOpen] = useSettingsPanelOpenState()
	const [document, setDocument] = createSignal<SeamSettingsDocument | undefined>(undefined)
	const [describeError, setDescribeError] = createSignal<string | undefined>(undefined)
	const [merged, setMerged] = createSignal<Record<string, unknown>>({})
	const [profile, setProfile] = createSignal<Record<string, unknown>>({})
	const [workspace, setWorkspace] = createSignal<Record<string, unknown>>({})
	const [level, setLevel] = createSignal<Level>("list")
	const [cursor, setCursor] = createSignal(0)
	const [filter, setFilter] = createSignal("")
	const [optionItem, setOptionItem] = createSignal<SettingsItem | undefined>(undefined)
	const [optionCursor, setOptionCursor] = createSignal(0)
	const [inputItem, setInputItem] = createSignal<SettingsItem | undefined>(undefined)
	const [inputValue, setInputValue] = createSignal("")
	const [inputError, setInputError] = createSignal<string | undefined>(undefined)
	const [status, setStatus] = createSignal<string | undefined>(undefined)
	const [changed, setChanged] = createSignal<string[]>([])
	const [busy, setBusy] = createSignal(false)
	const [preselect, setPreselect] = createSignal<string | undefined>(undefined)
	let catcher: InputRenderable | undefined
	let unsettings: (() => void) | undefined
	// Unmount with the panel open: the host push listener must not survive the
	// component (a leaked subscription keeps re-describing into dead signals).
	onCleanup(() => {
		unsettings?.()
		unsettings = undefined
	})

	const width = () => Math.max(24, dimensions().width - 4)
	const hasFace = () => props.seam.settings !== undefined
	const writable = createMemo(() => settingsWritable(document(), describeError(), hasFace()))

	const identity = createMemo(() => {
		try {
			return props.seam.settings?.identity?.() ?? undefined
		} catch {
			return undefined
		}
	})

	const items = createMemo<SettingsItem[]>(() => [
		...buildLocalItems({
			merged: merged(),
			profile: profile(),
			workspace: workspace(),
			...(props.themes !== undefined ? { themeNames: safeThemeNames() } : {}),
			writable: writable().local,
		}),
		...buildHostItems(document(), writable().host),
		...buildOtherItems(document()),
	])
	const visible = createMemo(() => filterSettingsItems(items(), filter()))
	const active = createMemo(() => visible()[cursor()])

	function safeThemeNames(): readonly string[] {
		try {
			return props.themes?.list() ?? []
		} catch {
			return []
		}
	}

	function reloadLocal() {
		try {
			setMerged(props.seam.configLoad?.() ?? {})
		} catch {
			setMerged({})
		}
		try {
			setProfile(props.seam.configRaw?.() ?? {})
		} catch {
			setProfile({})
		}
		try {
			setWorkspace(props.seam.workspaceConfig?.() ?? {})
		} catch {
			setWorkspace({})
		}
	}

	async function reloadHost(): Promise<void> {
		const face = props.seam.settings
		if (face === undefined) {
			setDocument(undefined)
			setDescribeError(undefined)
			return
		}
		try {
			setDocument(await face.describe())
			setDescribeError(undefined)
		} catch (error) {
			setDescribeError(error instanceof Error ? error.message : String(error))
		}
	}

	function close() {
		unsettings?.()
		unsettings = undefined
		setOpen(false)
		setLevel("list")
		setFilter("")
		setStatus(undefined)
		setOptionItem(undefined)
		setInputItem(undefined)
		setCursor(0)
		const summary = settingsSummary(changed())
		setChanged([])
		// Refocus AFTER teardown (the plugins-panel C15 law).
		setTimeout(() => props.onClosed?.(summary), 3)
	}

	createEffect(() => {
		const preselected = bridgeOpen()
		if (preselected === undefined) return
		setBridgeOpen(undefined)
		setLevel("list")
		setFilter("")
		setStatus(undefined)
		setChanged([])
		setCursor(0)
		reloadLocal()
		void reloadHost()
		setOpen(true)
		unsettings?.()
		unsettings = props.seam.settings?.onChanged?.(() => {
			// Host push: re-read only while the panel is on screen (the
			// module signal gates it; the listener is disposed on close).
			if (open()) void reloadHost()
		})
		setPreselect(preselected === "" ? undefined : preselected)
	})

	// Resolve a preselected row once the built rows exist (host rows arrive
	// only after the first describe).
	createEffect(() => {
		const target = preselect()
		if (target === undefined || !open()) return
		const index = visible().findIndex(
			(item) => item.id === target || item.id.endsWith(`.${target}`) || item.label === target,
		)
		if (index >= 0) {
			setCursor(index)
			setPreselect(undefined)
		}
	})

	// Cursor clamp when the filter narrows the list.
	createEffect(() => {
		const count = visible().length
		if (count === 0) setCursor(0)
		else if (cursor() >= count) setCursor(count - 1)
	})

	// Focus the catcher (or the editor) after every level transition.
	createEffect(() => {
		if (!open()) return
		level()
		setTimeout(() => {
			if (!open()) return
			if (catcher !== undefined && !catcher.isDestroyed) catcher.focus()
		}, 1)
	})

	function openEditor(item: SettingsItem) {
		if (!item.editable) {
			setStatus(item.note ?? "该行只读")
			return
		}
		if (item.kind === "toggle") {
			void applyItem(item, item.value !== "on")
			return
		}
		if (item.kind === "enum") {
			if (item.options === undefined || item.options.length === 0) {
				setStatus("no options available — this row cannot be edited here")
				return
			}
			setOptionItem(item)
			setOptionCursor(Math.max(0, item.options.indexOf(item.value)))
			setInputError(undefined)
			setStatus(undefined)
			setLevel("options")
			return
		}
		setInputItem(item)
		setInputValue(item.value === UNKNOWN || item.value === NA ? "" : item.value)
		setInputError(undefined)
		setStatus(undefined)
		setLevel("input")
	}

	function backToList() {
		setLevel("list")
		setInputItem(undefined)
		setOptionItem(undefined)
		setInputError(undefined)
	}

	async function applyItem(item: SettingsItem, raw: string | boolean | number): Promise<void> {
		if (!writable().local) {
			setStatus(writable().reason ?? "setting writes are disabled")
			return
		}
		if (busy()) return
		if (item.write?.via === "settings") {
			if (!writable().host) {
				setStatus(writable().reason ?? "host settings are read-only")
				return
			}
			const plan = planHostWrite(item, raw)
			if (!plan.ok) {
				setInputError(plan.error)
				setStatus(`✘ ${plan.error}`)
				return
			}
			const face = props.seam.settings
			if (face === undefined) return
			setBusy(true)
			try {
				const outcome = await commitHostWrite({
					mutate: (ns, ops, revision) => face.mutate(ns, ops, revision),
					describe: () => face.describe(),
					ns: plan.ns,
					ops: plan.ops,
					revision: currentHostRevision(document(), plan.ns),
				})
				if (outcome.document !== undefined) {
					setDocument(outcome.document)
					setDescribeError(undefined)
				}
				if (outcome.describeError !== undefined) setDescribeError(outcome.describeError)
				if (!outcome.result.ok) {
					const message = outcome.result.conflict
						? outcome.attempts === 1
							? "✘ 冲突：设置已被其它客户端修改，且 settings/describe 失败 — 没有最新 revision，未重试写入"
							: "✘ 冲突：设置已被其它客户端修改，重试一次仍冲突（未写入）"
						: `✘ ${outcome.result.error}`
					setInputError(message)
					setStatus(message)
					return
				}
				markChanged(item)
				if (outcome.refreshFailed === true) {
					// The write landed but the read-back did not: say so, never
					// "saved" (the displayed value would be a stale document).
					const message = `⚠ 已写入 ${item.label} = ${String(plan.applied)}，但刷新失败：${outcome.describeError ?? "settings/describe 不可用"}`
					setInputError(message)
					setStatus(message)
					backToList()
					return
				}
				setStatus(`saved ${item.label} = ${String(plan.applied)}${outcome.attempts > 1 ? " (after conflict retry)" : ""}`)
				setInputError(undefined)
				backToList()
			} catch (error) {
				// Transport/handler throw (never leave an unhandled rejection).
				const message = `✘ 写入失败：${error instanceof Error ? error.message : String(error)}`
				setInputError(message)
				setStatus(message)
			} finally {
				setBusy(false)
			}
			return
		}

		const hints = footerHintsFromConfig(merged().footerHints) ?? DEFAULT_FOOTER_HINTS
		const plan = planLocalWrite(item, raw, hints)
		if (!plan.ok) {
			setInputError(plan.error)
			setStatus(`✘ ${plan.error}`)
			return
		}
		try {
			props.seam.configSave?.(plan.patch)
		} catch (error) {
			const message = `✘ 写入失败：${error instanceof Error ? error.message : String(error)}`
			setInputError(message)
			setStatus(message)
			return
		}
		applyLive(item, plan.applied, hints)
		markChanged(item)
		reloadLocal()
		setStatus(`saved ${item.label} = ${plan.applied === undefined ? "(unset)" : String(plan.applied)}`)
		setInputError(undefined)
		backToList()
	}

	/** Apply the live effect the persisted key drives in THIS process.
	 *
	 * The panel already persisted through `planLocalWrite` (+ configSave), so
	 * every theme-face call is LIVE-only (`persist: false`): the face owns a
	 * boot-time layer (themeModePatchKey) and its own write would land there
	 * even while the user edits the other layer (M1). */
	function applyLive(item: SettingsItem, applied: string | boolean | number | undefined, hints: FooterHints) {
		try {
			if (item.id === "motion") {
				setMotionTier(applied === undefined || applied === "auto" ? undefined : (String(applied) as MotionTier))
			} else if (item.id.startsWith("footerHints.")) {
				const segment = item.id.slice("footerHints.".length) as keyof FooterHints
				setFooterHints({ ...hints, [segment]: applied === true })
			} else if (item.id === "hintsLocale") {
				setHintsLocale(String(applied) as HintLocale)
			} else if (item.id === "theme") {
				props.themes?.set(String(applied), { persist: false })
			} else if (item.id === "themeMode" || item.id === "workspaceThemeMode") {
				const mode = String(applied)
				if (mode === "auto" || mode === "dark" || mode === "light") {
					props.themes?.mode?.().set(mode, { persist: false })
				}
			}
		} catch (error) {
			console.error("[settings] live apply failed:", error)
		}
	}

	function markChanged(item: SettingsItem) {
		setChanged((list) => (list.includes(item.label) ? list : [...list, item.label]))
	}

	function step(delta: number) {
		const count = visible().length
		if (count === 0) return
		setCursor((index) => Math.max(0, Math.min(count - 1, index + delta)))
	}

	function handleEscape() {
		const decision = settingsEscape(level(), filter())
		if (decision.action === "clearFilter") {
			setFilter("")
			setCursor(0)
			// Reaching level 0 here (a filter typed after Esc cleared an editor).
			backToList()
			return
		}
		if (decision.action === "back") {
			backToList()
			return
		}
		close()
	}

	Keymap.createLayer(() => ({
		mode: "global",
		enabled: open() && dialog.stack.length === 0,
		priority: 2,
		commands: [
			{ bind: "escape", title: "Settings: back", group: "Settings", run: handleEscape },
			{ bind: "up", title: "Settings: previous row", group: "Settings", run: () => moveCursor(-1) },
			{ bind: "down", title: "Settings: next row", group: "Settings", run: () => moveCursor(1) },
			{ bind: "pageup", title: "Settings: page up", group: "Settings", run: () => moveCursor(-PAGE) },
			{ bind: "pagedown", title: "Settings: page down", group: "Settings", run: () => moveCursor(PAGE) },
			{
				bind: "return",
				title: "Settings: open / apply",
				group: "Settings",
				run: () => {
					const current = level()
					if (current === "options") {
						const item = optionItem()
						const option = item?.options?.[optionCursor()]
						if (item !== undefined && option !== undefined) void applyItem(item, option)
						return
					}
					if (current === "input") {
						const item = inputItem()
						if (item !== undefined) void applyItem(item, inputValue())
						return
					}
					const item = active()
					if (item !== undefined) openEditor(item)
				},
			},
		],
	}))

	function moveCursor(delta: number) {
		if (level() === "options") {
			const count = optionItem()?.options?.length ?? 0
			if (count === 0) return
			setOptionCursor((index) => Math.max(0, Math.min(count - 1, index + delta)))
			return
		}
		if (level() === "list") step(delta)
	}

	function lines(): SettingsLine[] {
		const current = level()
		if (current === "options") {
			const item = optionItem()
			return item === undefined
				? settingsLines(listInput())
				: settingsOptionLines(item, item.options ?? [], optionCursor(), width(), inputError())
		}
		if (current === "input") {
			const item = inputItem()
			return item === undefined
				? settingsLines(listInput())
				: settingsInputLines(item, inputValue(), width(), inputError())
		}
		return settingsLines(listInput())
	}

	function listInput(): SettingsLinesInput {
		return {
			items: items(),
			cursor: cursor(),
			width: width(),
			filter: filter(),
			...(identity() !== undefined ? { identity: identity()! } : {}),
			writable: writable().local,
			...(writable().reason !== undefined ? { writableReason: writable().reason } : {}),
			namespaceCount: settingsNamespaceCount(document()),
			hasDocument: document()?.hasDocument === true,
			...(status() !== undefined ? { status: status() } : {}),
		}
	}

	function focusColor(tone: SettingsTone) {
		switch (tone) {
			case "accent":
			case "selected":
				return theme?.text.action.primary.base ?? "#7aa2f7"
			case "attention":
				return warningColor(theme ?? undefined)
			case "subtle":
				return theme?.text.faint ?? "#565f89"
			default:
				return theme?.text.muted ?? "#565f89"
		}
	}

	const totalLines = createMemo(() => lines().length)

	return (
		<Show when={open()}>
			<box
				flexShrink={0}
				width="100%"
				height={totalLines() + 1}
				flexDirection="column"
				border={["left"]}
				borderColor={theme?.border.base ?? "#7aa2f7"}
				backgroundColor={theme?.background.raised.base ?? "#1a1b26"}
				paddingLeft={1}
				paddingRight={1}
			>
				<For each={lines()}>
					{(line) => (
						<box height={1} flexShrink={0}>
							<text
								fg={focusColor(line.tone)}
								attributes={line.tone === "accent" || line.tone === "selected" ? TextAttributes.BOLD : TextAttributes.NONE}
								wrapMode="none"
							>
								{line.text}
							</text>
						</box>
					)}
				</For>
				<Show
					when={level() === "input"}
					fallback={
						<box height={1} flexShrink={0} flexDirection="row">
							<Show
								when={level() === "list"}
								fallback={
									<input
										width={1}
										value=""
										onInput={() => {}}
										ref={(renderable: InputRenderable) => {
											catcher = renderable
											setTimeout(() => {
												if (!renderable.isDestroyed) renderable.focus()
											}, 1)
										}}
									/>
								}
							>
								<input
									flexGrow={1}
									placeholder="type to filter settings"
									value={filter()}
									onInput={(value: string) => {
										setFilter(value)
										setCursor(0)
									}}
									ref={(renderable: InputRenderable) => {
										catcher = renderable
										setTimeout(() => {
											if (!renderable.isDestroyed) renderable.focus()
										}, 1)
									}}
								/>
							</Show>
						</box>
					}
				>
					<box height={1} flexShrink={0} flexDirection="row">
						<input
							flexGrow={1}
							value={inputValue()}
							onInput={(value: string) => setInputValue(value)}
							onSubmit={() => {
								const item = inputItem()
								if (item !== undefined) void applyItem(item, inputValue())
							}}
							ref={(renderable: InputRenderable) => {
								catcher = renderable
								setTimeout(() => {
									if (renderable.isDestroyed) return
									renderable.focus()
									renderable.gotoLineEnd()
								}, 1)
							}}
						/>
					</box>
				</Show>
			</box>
		</Show>
	)
}
