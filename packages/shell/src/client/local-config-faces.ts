/**
 * S5 — REAL local config / settings / agents faces for the in-process bridge
 * seam. No mocks, no `{}` degrades: every read reads the operator's actual
 * profile files and every write lands in them.
 *
 * WHY LOCAL (one-hand verified):
 *  - the inproc host profile is `@deepseek-ai/dsh-base` + the bridge bundle
 *    ONLY (provision-inproc-profile.mjs BUNDLES), so it mounts neither
 *    `settingsController` nor the `session-log-deepseek` settings namespace;
 *    the bridge's CapIR settings arms therefore answer NOT_WIRED at runtime
 *    (same fact the S2 proof recorded for credentialsController).
 *  - the inproc host has no `settingsController`, so there is no host-side
 *    settings write to ride; the patch is provisioner-owned anyway.
 *  The client owns its profile files (DEFAULT_PROFILE from profile-constants.ts,
 *  resolveDshHome()), and the seam's pre-write guard refuses to touch them if
 *  that name ever drifts from the profile the running dsh process loads. Local
 *  file I/O is therefore the honest real implementation — exactly what the
 *  legacy thin-client seam did for config/agents. The bridge CapIR wiring
 *  remains available for host profiles that DO mount the controller.
 *
 * SECURITY (oldfox S4 review §六.2/§六.3, S4 prereg §四): field-by-field
 * WHITELIST projection, never key-name stripping. `describe()` CONSTRUCTS each
 * namespace value/schema from an enumerated allow-list; no host document (with
 * apiKey/token/password/links/auth URLs) is ever copied to a frame or the seam
 * return value. T7: `mutate()` is retired — the local store is READ-ONLY for
 * the patch; all writes go through the host settings channel. `configSave()`
 * accepts only whitelisted preference keys (config.json, never the patch).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
	listComposedAgents,
	commitAgentModelEdit,
	type ComposedAgentRow,
} from "./remote-agent-profiles.ts"
import { setAgentField } from "./remote-local-fs.ts"
import { mergeConfig, saveWorkspaceConfig, type ThemeMode, type WorkspaceOverlay } from "./workspace-config.ts"
import type {
	SeamAgentOfficialCaps,
	SeamAgentRow,
	SeamAgentSetResult,
	SeamEffortOption,
	SeamLoginRoute,
	SeamPresetRow,
	SeamRegisterRoutePlan,
	SeamSettingsDocument,
	SeamSettingsOp,
	SeamSettingsRow,
} from "../../../tui-base/src/seams/session"

// --- field-level allow-lists (explicit enumeration, not stripping) ---------

/** Namespaces the /settings v1 whitelist reads; nothing else crosses the seam.
 *  T7 (D1 §对「3 字段缺陷」的修正): the write surface grew to the approval
 *  policy (300s window) and llm-pi-ai.providers (host settings mutation). */
const SETTINGS_NAMESPACES = [
	"subagent", "permission", "session-log-deepseek", "dsh-approval-policy", "llm-pi-ai",
] as const
type SettingsNs = (typeof SETTINGS_NAMESPACES)[number]

/** The ONLY value fields projected per namespace (oldfox §六.2).
 *  MIRROR of bridge-settings-route.ts SETTINGS_NS_VALUE_FIELDS — the two
 *  tables must stay in sync (no-client-patch-writers gate asserts it). */
export const NS_VALUE_FIELDS: Readonly<Record<SettingsNs, readonly string[]>> = {
	subagent: ["maxActiveSubagents", "maxDepth"],
	permission: ["defaultPreset", "presets"],
	"session-log-deepseek": ["enabled"],
	"dsh-approval-policy": ["windowSeconds", "origins", "defaultOutcome", "sessions"],
	"llm-pi-ai": ["providers"],
}
/** Host-source defaults (one-hand verified rc.5): subagent/src/index.ts:196
 *  maxDepth default 1; dsh-session-log-deepseek/src/index.ts:60 enabled default
 *  true; permission defaultPreset comes from the patch (workspace-write).
 *  `providers` is an empty dict default — real routes come from the host
 *  settings document (field-level projected), never from a default object. */
const NS_DEFAULTS: Readonly<Record<SettingsNs, Readonly<Record<string, unknown>>>> = {
	subagent: { maxActiveSubagents: 1, maxDepth: 1 },
	permission: { defaultPreset: "workspace-write" },
	"session-log-deepseek": { enabled: true },
	"dsh-approval-policy": {},
	"llm-pi-ai": { providers: {} },
}

/** config.json keys the local preference editor may read/write (oldfox §六.3:
 *  key + expected value only, no full-document round trip through a frame). */
const CONFIG_KEYS = [
	"lang", "motion", "theme", "themeMode", "skin", "cacheHitMode",
	"footerHints", "hintsLocale", "autoResume", "autoResumeDays",
	"maxRoundsGrace", "activity_panel_height", "stepsDisplay", "stepsCollapse",
	"stepsFolded",
	// 025-w1a — /preset staged selection (next-session preset id). A plain
	// scalar preference, same class as theme/lang; no secret crosses the seam.
	"agentPreset",
	// T9 (P0-2/P0-3): the one-shot skin migration marker + workspace-layer
	// theme writes must survive the seam config face (they used to go through
	// RemoteHostSession.configSave).
	"skinMigration", "workspaceTheme", "workspaceThemeMode",
] as const
const CONFIG_KEY_SET = new Set<string>(CONFIG_KEYS)

/**
 * The value `configSave()` returns: an ordinary merged config Record for sync
 * callers, but ALSO awaitable. `await configSave(patch)` resolves only once the
 * workspace-layer disk write has settled (and REJECTS if that write failed),
 * because the seam wrapper and the skin-migration boot site are both sync-typed
 * yet the boot site already spells `await seam.configSave(patch)`. Attaching the
 * thenable here is what makes THAT existing await real without changing the
 * seam's `Record<string, unknown>` contract.
 */
type AwaitableConfigView = Record<string, unknown> & PromiseLike<Record<string, unknown>>

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
}

// ---------------------------------------------------------------------------
// Line-level patch editing (conservative, like append-system.ts — the patch is
// user-owned YAML; we never parse-and-reserialize the whole document).
// ---------------------------------------------------------------------------

/** Parse a scalar YAML value into a JS primitive (booleans/numbers/strings). */
function parseScalar(raw: string): unknown {
	const v = raw.trim()
	if (v === "true") return true
	if (v === "false") return false
	if (v === "null" || v === "~") return null
	if (/^-?\d+$/.test(v)) return Number(v)
	if (/^-?\d+\.\d+$/.test(v)) return Number(v)
	return v.replace(/^["']|["']$/g, "")
}

/** The [start,end) line span of the top-level `- id: <ns>` patch row. */
function nsEntrySpan(lines: readonly string[], ns: string): [number, number] | undefined {
	const start = lines.findIndex((line) => new RegExp(`^- id:\\s*${ns}\\s*$`).test(line))
	if (start < 0) return undefined
	let end = lines.length
	for (let i = start + 1; i < lines.length; i++) {
		if (/^- /.test(lines[i]) || /^-insert:/.test(lines[i]) || /^-\s+insert:/.test(lines[i])) { end = i; break }
	}
	return [start, end]
}

/** Read the nested `llm-pi-ai.providers` dict (provider id → projected fields)
 *  from the patch row. Value-only; no patch write (T7). */
function readProvidersDict(lines: readonly string[], from: number, to: number): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (let i = from; i < to; i++) {
		const m = /^\s{6}([A-Za-z0-9_.\-]+):\s*$/.exec(lines[i])
		if (!m) {
			if (/^\s{0,4}\S/.test(lines[i])) break
			continue
		}
		const provider: Record<string, unknown> = {}
		for (let j = i + 1; j < to; j++) {
			if (/^\s{6}\S/.test(lines[j]) || /^\s{0,4}\S/.test(lines[j])) break
			const f = /^\s{8}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(lines[j])
			if (f && ["apiKeyEnv", "api", "baseURL", "displayName"].includes(f[1])) {
				provider[f[1]] = parseScalar(f[2])
			}
		}
		out[m[1]] = provider
	}
	return out
}

/** Read whitelisted value fields for one namespace from its patch row. */
function readNsValue(lines: readonly string[], ns: SettingsNs): Record<string, unknown> {
	const span = nsEntrySpan(lines, ns)
	const out: Record<string, unknown> = {}
	const fields = NS_VALUE_FIELDS[ns]
	if (span === undefined) return out
	let inConfig = false
	for (let i = span[0] + 1; i < span[1]; i++) {
		const line = lines[i]
		if (/^\s{2}config:\s*$/.test(line)) { inConfig = true; continue }
		if (inConfig && /^\s{2}\S/.test(line)) break // left the config block
		if (!inConfig) continue
		const m = /^\s{4}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line)
		if (!m || !fields.includes(m[1])) continue
		if (m[1] === "providers" && m[2].trim() === "") {
			out.providers = readProvidersDict(lines, i + 1, span[1])
		} else if (m[2].trim() !== "") {
			out[m[1]] = parseScalar(m[2])
		}
	}
	return out
}

function atomicWrite(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true })
	const tmp = `${path}.${process.pid}.s5.tmp`
	try {
		writeFileSync(tmp, text)
		renameSync(tmp, path)
	} catch (err) {
		try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
		throw err
	}
}

/**
 * 025-w1b C1 — field-by-field whitelisted YAML block for one provider route.
 * Every value is validated and quoted so NO unknown key, newline or YAML
 * injection can cross from the login form into the user-owned patch. Returns
 * undefined on any invalid field (the caller then refuses the write entirely).
 * Only the five providerProfileFor() fields are recognised; extra keys are
 * dropped, never passed through.
 */
function buildLoginRouteBlock(providerId: string, profile: Record<string, unknown>): string[] | undefined {
	const block = [`      ${providerId}:`]
	const apiKeyEnv = typeof profile.apiKeyEnv === "string" ? profile.apiKeyEnv : ""
	if (apiKeyEnv !== "") {
		if (!/^[A-Za-z0-9_]+$/.test(apiKeyEnv)) return undefined
		block.push(`        apiKeyEnv: ${apiKeyEnv}`)
	}
	if (profile.api !== undefined) {
		if (typeof profile.api !== "string" || !/^[A-Za-z0-9_.-]+$/.test(profile.api)) return undefined
		block.push(`        api: ${profile.api}`)
	}
	if (profile.baseURL !== undefined) {
		if (typeof profile.baseURL !== "string" || !/^https?:\/\/\S+$/.test(profile.baseURL)) return undefined
		block.push(`        baseURL: ${JSON.stringify(profile.baseURL)}`)
	}
	if (profile.displayName !== undefined) {
		if (typeof profile.displayName !== "string" || /[\r\n]/.test(profile.displayName)) return undefined
		block.push(`        displayName: ${JSON.stringify(profile.displayName)}`)
	}
	if (profile.models !== undefined) {
		if (!Array.isArray(profile.models)) return undefined
		block.push("        models:")
		for (const entry of profile.models) {
			const m = asRecord(entry)
			const id = m.id
			if (typeof id !== "string" || !id || /[\r\n\x00-\x1f]/.test(id)) return undefined
			block.push(`          - id: ${JSON.stringify(id)}`)
			if (m.name !== undefined) {
				if (typeof m.name !== "string" || /[\r\n\x00-\x1f]/.test(m.name)) return undefined
				block.push(`            name: ${JSON.stringify(m.name)}`)
			}
		}
	}
	return block
}

// ---------------------------------------------------------------------------
// Local settings document face
// ---------------------------------------------------------------------------

export class LocalSettingsStore {
	readonly #patchPath: string

	constructor(home: string, profile: string) {
		this.#patchPath = join(home, "profiles", profile, "cordis.patch.yml")
	}

	/** Field-by-field whitelisted document; NEVER the raw host config. */
	describe(): SeamSettingsDocument {
		let lines: readonly string[] = []
		try { lines = readFileSync(this.#patchPath, "utf8").split("\n") } catch { /* absent patch: defaults only */ }
		const namespaces: SeamSettingsRow[] = SETTINGS_NAMESPACES.map((ns) => {
			const patchValue = readNsValue(lines, ns)
			// CONSTRUCT the value from the allow-list only — no spread of a host object.
			const value: Record<string, unknown> = {}
			for (const field of NS_VALUE_FIELDS[ns]) {
				const v = patchValue[field] ?? NS_DEFAULTS[ns][field]
				if (v !== undefined) value[field] = v
			}
			// Minimal schema with only whitelisted fields (permission preset enum
			// derived from the whitelisted `presets` dict keys, not from host code).
			const schema: Record<string, unknown> = {}
			for (const field of NS_VALUE_FIELDS[ns]) schema[field] = { type: typeof value[field] }
			if (ns === "permission") {
				const presets = value.presets
				if (presets && typeof presets === "object") {
					schema.defaultPreset = { type: "string", enum: Object.keys(presets as object) }
				}
			}
			return { ns, revision: 1, value, base: { ...value }, schema, secrets: [] }
		})
		// Describe-only namespaces (the panel's "other" zone): the real patch
		// entries, but projected to ns+revision ONLY — ZERO value fields cross
		// the seam for non-whitelisted namespaces (oldfox S4 §六.2). The panel
		// paints these rows read-only with the "本 TUI 不消费" note. Without them
		// the keyboard nav (Down x4 / Up) lands on the wrong row.
		const hidden = new Set<string>([...SETTINGS_NAMESPACES, "dsh-tui"])
		const seen = new Set<string>(SETTINGS_NAMESPACES)
		const others: SeamSettingsRow[] = []
		for (const line of lines) {
			const m = /^- id:\s*([A-Za-z0-9_.\-@/]+)\s*$/.exec(line)
			if (!m) continue
			const ns = m[1]
			if (hidden.has(ns) || seen.has(ns)) continue
			seen.add(ns)
			others.push({ ns, revision: 1 })
		}
		// The host's describe orders `agent-default-model` first among the
		// describe-only namespaces; keep that order so the /settings keyboard
		// nav (Down x4 from the first Host row → first "other" row) is stable.
		others.sort((a, b) => (a.ns === "agent-default-model" ? -1 : b.ns === "agent-default-model" ? 1 : 0))
		namespaces.push(...others)
		return { writable: true, hasDocument: existsSync(this.#patchPath), namespaces, source: "local-file" }
	}
	// T7: `mutate` retired. The patch is a host-owned runtime file; the seam's
	// local-file branch stays read-only. All settings writes go through the
	// host settings channel (`seam.settings.mutate`), never this store.
}

// ---------------------------------------------------------------------------
// Local config faces (read/write the client profile config.json + overlay)
// ---------------------------------------------------------------------------

export class LocalConfigStore {
	readonly #configPath: string
	readonly #workspaceDir: string
	#overlayCache: WorkspaceOverlay
	/** The most recent workspace-layer write. Resolved while idle; rejects when
	 *  that write failed. Kept so callers can await the REAL disk write rather
	 *  than the optimistic in-memory cache. */
	#workspaceWrite: Promise<void> = Promise.resolve()

	constructor(home: string, profile: string, workspaceDir: string) {
		this.#configPath = join(home, "profiles", profile, "config.json")
		this.#workspaceDir = workspaceDir
		this.#overlayCache = loadWorkspaceConfigState(workspaceDir)
	}

	#readProfile(): Record<string, unknown> {
		try { return asRecord(JSON.parse(readFileSync(this.#configPath, "utf8"))) } catch { return {} }
	}

	configRaw(): Record<string, unknown> {
		return this.#readProfile()
	}

	configLoad(): Record<string, unknown> {
		const base = this.#readProfile()
		// Merge only for theme/model/overlay keys; the returned object carries
		// only whitelisted config keys (oldfox §六.2/§六.3).
		const merged = mergeConfig(
			{
				theme: typeof base.theme === "string" ? base.theme : undefined,
				themeMode: asThemeMode(base.themeMode),
			},
			this.#overlayCache,
			process.env as Record<string, string>,
		)
		const out: Record<string, unknown> = {}
		for (const key of CONFIG_KEYS) if (base[key] !== undefined) out[key] = base[key]
		if (merged.theme !== undefined) out.theme = merged.theme
		if (merged.themeMode !== undefined) out.themeMode = merged.themeMode
		if (merged.model !== undefined) out.model = merged.model
		return out
	}

	workspaceConfig(): Record<string, unknown> {
		return { ...(this.#overlayCache as Record<string, unknown>) }
	}

	/** Profile-layer half of configSave; kept separate so it can be chained
	 *  AFTER the workspace write (marker must never precede its config). */
	#writeProfile(rest: Record<string, unknown>): void {
		const merged = { ...this.#readProfile(), ...rest }
		atomicWrite(this.#configPath, JSON.stringify(merged, null, 2) + "\n")
	}

	/**
	 * T9 (P0-2): split writes by layer. `workspaceTheme`/`workspaceThemeMode`
	 * go to `<workspace>/.dsh/config.yml` via the frozen `saveWorkspaceConfig`
	 * (atomic 0600 + credential guard); everything else (incl. the skinMigration
	 * marker) stays in profile config.json. The async overlay write updates the
	 * sync cache optimistically and reverts on failure.
	 *
	 * ORDERING (P1): when a patch spans BOTH layers, the profile write (marker)
	 * is chained onto the workspace write's SUCCESS, never started before it.
	 * So the marker cannot land while the workspace config is missing/stale,
	 * and a failed workspace write leaves NO marker → next boot retries. The
	 * tracked promise covers both writes, and the returned AWAITABLE view makes
	 * the existing `await seam.configSave({skinMigration, workspaceTheme})` at
	 * the migration boot site genuinely wait before it sets the notice/exits.
	 *
	 * A profile-only patch keeps the original fully synchronous path (no
	 * marker delay for keys that never touch the workspace layer).
	 */
	configSave(patch: Record<string, unknown>): Record<string, unknown> {
		const overlayPatch: WorkspaceOverlay = {}
		const rest: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(patch)) {
			if (!CONFIG_KEY_SET.has(key)) continue
			if (key === "workspaceTheme") overlayPatch.theme = typeof value === "string" && value ? value : undefined
			else if (key === "workspaceThemeMode") overlayPatch.themeMode = asThemeMode(value)
			else rest[key] = value
		}
		const hasOverlay = Object.keys(overlayPatch).length > 0
		const hasRest = Object.keys(rest).length > 0
		// Awaitable view covers THIS call's write only; a stale failed write from
		// an earlier call must not poison an unrelated profile-only save.
		let write: Promise<void> = Promise.resolve()
		if (hasOverlay) {
			const previous = this.#overlayCache
			const next: WorkspaceOverlay = { ...previous, ...overlayPatch }
			this.#overlayCache = next
			const diskWrite = saveWorkspaceConfig(this.#workspaceDir, next)
			// Rollback + log is a SEPARATE derived promise: it must not swallow
			// the tracked promise's rejection (the awaitable path still sees it).
			void diskWrite.catch((error: unknown) => {
				if (this.#overlayCache === next) this.#overlayCache = previous
				console.error("[local-config-faces] workspace config save failed:", error)
			})
			// Marker/profile write happens ONLY after the workspace write lands.
			write = diskWrite.then(() => { if (hasRest) this.#writeProfile(rest) })
			this.#workspaceWrite = write
			void write.catch(() => { /* surfaced via await / flushWorkspaceWrites */ })
		} else if (hasRest) {
			// Profile-only: unchanged synchronous behaviour.
			this.#writeProfile(rest)
		}
		// `view` is deliberately a PLAIN object (no `then`), so resolving an
		// outer promise with it cannot re-enter this thenable (self-resolution).
		const view = this.configLoad()
		const result = { ...view }
		Object.defineProperties(result, {
			then: {
				enumerable: false,
				// Re-read after the writes settle so the awaited view includes a
				// deferred profile marker too (plain object → no self-resolution).
				value: (
					onFulfilled?: ((value: Record<string, unknown>) => unknown) | null,
					onRejected?: ((error: unknown) => unknown) | null,
				) => write.then(() => onFulfilled?.(this.configLoad()), onRejected),
			},
			catch: {
				enumerable: false,
				value: (onRejected?: ((error: unknown) => unknown) | null) => write.then(undefined, onRejected),
			},
		})
		return result as AwaitableConfigView
	}

	/** Await the most recent workspace-layer write (and any profile marker
	 *  chained onto it) before exit or before an independent marker write.
	 *  Rejects with the original error — no silent swallow. */
	flushWorkspaceWrites(): Promise<void> {
		return this.#workspaceWrite
	}

	/** Async variant: resolves with the merged config view only AFTER the
	 *  workspace write (and chained marker) lands; rejects if either fails. */
	async configSaveAsync(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
		return await (this.configSave(patch) as AwaitableConfigView)
	}
}

function asThemeMode(value: unknown): ThemeMode | undefined {
	return value === "dark" || value === "light" || value === "auto" ? value : undefined
}

/**
 * Synchronous overlay snapshot (loadWorkspaceConfig is async; the config
 * faces are sync). Reads the file directly, projection-limited to the three
 * overlay fields so it can be handed to `saveWorkspaceConfig` (which rejects
 * unknown keys). T9 (P0-3): YAML fallback parses `theme`, `themeMode` AND
 * `model` — matching `workspace-config.ts:593-606`, so a boot-time seam
 * configLoad no longer drops the workspace mode pin / model override.
 */
function loadWorkspaceConfigState(workspaceDir: string): WorkspaceOverlay {
	let text: string
	try { text = readFileSync(join(workspaceDir, ".dsh", "config.yml"), "utf8") } catch { return {} }
	const out: WorkspaceOverlay = {}
	const project = (raw: Record<string, unknown>): WorkspaceOverlay => {
		const projected: WorkspaceOverlay = {}
		if (typeof raw.theme === "string") projected.theme = raw.theme
		const mode = asThemeMode(raw.themeMode)
		if (mode !== undefined) projected.themeMode = mode
		if (raw.model !== null && typeof raw.model === "object" && !Array.isArray(raw.model)) {
			const prefs = raw.model as Record<string, unknown>
			const model: { provider?: string; model?: string; reasoningEffort?: string } = {}
			for (const field of ["provider", "model", "reasoningEffort"] as const) {
				if (typeof prefs[field] === "string") model[field] = prefs[field] as string
			}
			if (model.provider !== undefined || model.model !== undefined || model.reasoningEffort !== undefined) {
				projected.model = model
			}
		}
		return projected
	}
	try {
		return project(asRecord(JSON.parse(text)))
	} catch { /* YAML fallback below */ }
	const theme = /^\s*theme:\s*(.+)$/m.exec(text)
	if (theme) {
		const value = parseScalar(theme[1]!)
		if (typeof value === "string") out.theme = value
	}
	const themeMode = /^\s*themeMode:\s*(.+)$/m.exec(text)
	if (themeMode) out.themeMode = asThemeMode(parseScalar(themeMode[1]!))
	const lines = text.split("\n")
	const modelLine = lines.findIndex((line) => /^\s*model:\s*$/.test(line))
	if (modelLine >= 0) {
		const model: { provider?: string; model?: string; reasoningEffort?: string } = {}
		for (let i = modelLine + 1; i < lines.length; i++) {
			if (/^\S/.test(lines[i])) break // dedent to a top-level key
			const field = /^\s{2}(provider|model|reasoningEffort):\s*(.+)$/.exec(lines[i])
			if (!field) continue
			const value = parseScalar(field[2]!)
			if (typeof value === "string") model[field[1] as "provider" | "model" | "reasoningEffort"] = value
		}
		if (model.provider !== undefined || model.model !== undefined || model.reasoningEffort !== undefined) out.model = model
	}
	return out
}

// ---------------------------------------------------------------------------
// Local agents face (real corpus, no mocks)
// ---------------------------------------------------------------------------

export class LocalAgentsFace {
	readonly #home: string
	readonly #workspaceDir: string
	readonly #settings: LocalSettingsStore
	readonly #modelCatalog: () => Promise<{ groups: Array<{ id: string; models: Array<{ id: string; reasoning?: { efforts?: Array<{ id: string; name: string; description?: string }> } }> }> }>

	constructor(options: {
		home: string
		workspaceDir: string
		settings: LocalSettingsStore
		modelCatalog: () => Promise<{ groups: Array<{ id: string; models: Array<{ id: string; reasoning?: { efforts?: Array<{ id: string; name: string; description?: string }> } }> }> }>
	}) {
		this.#home = options.home
		this.#workspaceDir = options.workspaceDir
		this.#settings = options.settings
		this.#modelCatalog = options.modelCatalog
	}

	#rows(): ComposedAgentRow[] {
		return listComposedAgents(this.#home, this.#workspaceDir)
	}

	list(): SeamAgentRow[] {
		return this.#rows().map((row) => ({
			name: row.name,
			...(row.displayName ? { displayName: row.displayName } : {}),
			...(row.description ? { description: row.description } : {}),
			...(row.model ? { model: row.model } : {}),
			...(row.thinking ? { thinking: row.thinking } : {}),
			deep: row.deep,
			...(row.maxRounds !== undefined ? { maxRounds: row.maxRounds } : {}),
			...(row.background !== undefined ? { background: row.background } : {}),
			file: row.file,
			...(row.pin ? { pin: row.pin } : {}),
			...(row.broken ? { broken: row.broken } : {}),
		}))
	}

	dir(): string { return join(this.#home, "agents") }

	body(name: string): string {
		return this.#rows().find((row) => row.name === name && row.broken === undefined)?.body ?? ""
	}

	set(name: string, field: "model" | "thinking" | "deep" | "maxRounds" | "background", value: string | null): SeamAgentSetResult {
		if (field === "deep" || field === "maxRounds" || field === "background") {
			const error = setAgentField(name, field, value, this.#home)
			return { target: { kind: "frontmatter" }, ...(error ? { error } : {}) }
		}
		const row = this.#rows().find((agent) => agent.name === name && agent.broken === undefined)
		if (row === undefined) return { target: { kind: "frontmatter" }, error: `agent "${name}" not found` }
		const result = commitAgentModelEdit(this.#home, this.#workspaceDir, row.file, name, { [field]: value })
		return { target: result.target, ...(result.error ? { error: result.error } : {}) }
	}

	async modelEfforts(providerID: string, modelID: string): Promise<SeamEffortOption[]> {
		const catalog = await this.#modelCatalog()
		const model = catalog.groups.find((g) => g.id === providerID)?.models.find((m) => m.id === modelID)
		return (model?.reasoning?.efforts ?? []) as SeamEffortOption[]
	}

	async officialCaps(): Promise<SeamAgentOfficialCaps> {
		const doc = this.#settings.describe()
		const row = doc.namespaces.find((n) => n.ns === "subagent")
		const value = asRecord(row?.value)
		const caps: SeamAgentOfficialCaps = {}
		if (typeof value.maxActiveSubagents === "number" && Number.isFinite(value.maxActiveSubagents)) caps.maxActiveSubagents = value.maxActiveSubagents
		if (typeof value.maxDepth === "number" && Number.isFinite(value.maxDepth)) caps.maxDepth = value.maxDepth
		return caps
	}
}

// ---------------------------------------------------------------------------
// 025-w1a — Local agent-preset face for the inproc bridge seam
// ---------------------------------------------------------------------------

/**
 * REAL local agent-preset roster for the inproc profile, no mocks.
 *
 * WHY LOCAL: the inproc host mounts neither the preset registry RPC nor an
 * `agentPresets` CapIR id in the expected surface (audit §2.1); the deployment's
 * presets are DECLARED in `cordis.patch.yml` as `- insert:` blocks whose
 * `name: '@deepseek-ai/dsh-agent-preset'` carries a `config:` with the real
 * `id/name/description/order`. That patch file is the operator's own config —
 * the same source S5's settings face reads — so parsing it is the honest real
 * implementation (the alternative, a bridge RPC, is NOT_WIRED in this profile).
 *
 * SECURITY: field-by-field projection — only `id/name/description/isDefault`
 * cross the seam (SeamPresetRow); plugin `config` bodies (which may carry
 * prompts / paths / `!!js` expressions) are NEVER copied into a frame.
 */
export class LocalPresetFace {
	readonly #patchPath: string
	readonly #configPath: string

	constructor(home: string, profile: string) {
		this.#patchPath = join(home, "profiles", profile, "cordis.patch.yml")
		this.#configPath = join(home, "profiles", profile, "config.json")
	}

	/** Parse declared preset blocks from the patch into SeamPresetRow rows. */
	list(): SeamPresetRow[] {
		let lines: readonly string[] = []
		try { lines = readFileSync(this.#patchPath, "utf8").split("\n") } catch { return [] }
		const rows: SeamPresetRow[] = []
		const seen = new Set<string>()
		for (let i = 0; i < lines.length; i++) {
			// A preset block: `    - id: <blockId>` then (within its span)
			// `      name: '@deepseek-ai/dsh-agent-preset'` and `      config:`.
			if (!/^\s*- id:\s*preset-\S+\s*$/.test(lines[i])) continue
			let end = lines.length
			for (let j = i + 1; j < lines.length; j++) {
				if (/^\s*- id:\s*\S+/.test(lines[j]) || /^- /.test(lines[j])) { end = j; break }
			}
			const span = lines.slice(i, end)
			if (!span.some((l) => /name:\s*['"]?@deepseek-ai\/dsh-agent-preset/.test(l))) continue
			const cfg = span.findIndex((l) => /^\s{4,}config:\s*$/.test(l))
			const val: Record<string, string> = {}
			if (cfg >= 0) {
				for (let k = cfg + 1; k < span.length; k++) {
					const m = /^\s{6,}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(span[k])
					if (!m) continue
					// Stop at the plugins list — its nested rows are not preset fields.
					if (/^\s{6,}(plugins|disabled|order):/.test(span[k]) && m[1] !== "order") {
						if (m[1] === "plugins") break
					}
					const key = m[1]
					if (key === "id" || key === "name" || key === "description") {
						let v = m[2].trim().replace(/^['"]|['"]$/g, "")
						// Fold continuation lines of a plain scalar description.
						let kk = k + 1
						while (kk < span.length && /^\s{10,}\S/.test(span[kk]) && !/^\s{10,}[A-Za-z_][A-Za-z0-9_]*\s*:/.test(span[kk])) {
							v += " " + span[kk].trim()
							kk++
						}
						val[key] = v
					}
				}
			}
			const id = val.id
			if (!id || seen.has(id)) continue
			seen.add(id)
			rows.push({
				id,
				name: val.name || id,
				...(val.description ? { description: val.description } : {}),
			})
		}
		return rows
	}

	/** The staged preset id from config.json (`agentPreset`, a scalar preference). */
	currentId(): string | undefined {
		try {
			const doc = asRecord(JSON.parse(readFileSync(this.#configPath, "utf8")))
			return typeof doc.agentPreset === "string" && doc.agentPreset !== "" ? doc.agentPreset : undefined
		} catch {
			return undefined
		}
	}

	/** Persist the staged preset id (next-session effect); false on I/O failure. */
	select(presetId: string): boolean {
		const current = this.#readDoc()
		try {
			atomicWrite(this.#configPath, JSON.stringify({ ...current, agentPreset: presetId }, null, 2) + "\n")
			return true
		} catch {
			return false
		}
	}

	#readDoc(): Record<string, unknown> {
		try { return asRecord(JSON.parse(readFileSync(this.#configPath, "utf8"))) } catch { return {} }
	}
}

// ---------------------------------------------------------------------------
// 025-w1a — Local provider-login face for the inproc bridge seam
// ---------------------------------------------------------------------------

/**
 * REAL local provider-login face (S5 local-file-I/O paradigm, coordinator
 * ruling 2026-11-21): the /login //logout seam.login contract is a PROVIDER
 * credential/route double-write (NOT account/PKCE — that is a 波1-B entry).
 *
 * WHY LOCAL: the inproc profile mounts neither `credentialsController` nor
 * the settings controller's CapIR write arms (S2 proof: DATAFLOW NOT_WIRED;
 * S5 local-config-faces.ts header). A credentials.* plaintext frame would be
 * dead code — so routes/registerRoute ride the profile `cordis.patch.yml`
 * llm-pi-ai.providers dict (real local file I/O), and credentials ride a
 * SEPARATE owner-only `provider-keys.json` local store (never the host's
 * `.credentials.yaml` grant file, which has a different format and owner).
 *
 * SECURITY (W5 三处白名单): `routes()` projects ONLY the route-id key +
 * apiKeyEnv KEY NAME + displayName + declared flag — NEVER the apiKey VALUE.
 * `credentialStatus()` returns a boolean (env presence OR local store key
 * presence) — no value. `login(ref,key)` writes the value to an owner-only
 * (0600) local file and returns void — it never echoes/logs the value. No
 * value crosses a frame, an emit, or proof.
 */
export class LocalLoginFace {
	readonly #patchPath: string
	readonly #keysPath: string

	constructor(home: string, profile: string) {
		this.#patchPath = join(home, "profiles", profile, "cordis.patch.yml")
		this.#keysPath = join(home, "profiles", profile, "provider-keys.json")
	}

	/** Configured provider routes from the patch's llm-pi-ai.providers dict. */
	routes(): SeamLoginRoute[] {
		let lines: readonly string[] = []
		try { lines = readFileSync(this.#patchPath, "utf8").split("\n") } catch { return [] }
		const span = nsEntrySpan(lines, "llm-pi-ai")
		if (span === undefined) return []
		const providersLine = lines.findIndex((l, i) => i >= span[0] && i < span[1] && /^\s{4}providers:\s*$/.test(l))
		if (providersLine < 0) return []
		const out: SeamLoginRoute[] = []
		for (let i = providersLine + 1; i < lines.length; i++) {
			const line = lines[i]
			// provider keys are dict entries at exactly 6 spaces.
			const m = /^\s{6}([A-Za-z0-9_.\-]+):\s*$/.exec(line)
			if (!m) {
				if (/^\s{0,4}\S/.test(line)) break // left the providers block
				continue
			}
			const id = m[1]
			let apiKeyEnv: string | undefined
			let displayName: string | undefined
			let declared = false
			for (let j = i + 1; j < lines.length; j++) {
				if (/^\s{6}\S/.test(lines[j]) || /^\s{0,4}\S/.test(lines[j])) break
				const f = /^\s{8}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(lines[j])
				if (!f) continue
				if (f[1] === "apiKeyEnv") apiKeyEnv = f[2].trim().replace(/^['"]|['"]$/g, "")
				else if (f[1] === "displayName") displayName = f[2].trim().replace(/^['"]|['"]$/g, "")
				else if (f[1] === "api" || f[1] === "baseURL" || f[1] === "models") declared = true
			}
			out.push({ id, ...(apiKeyEnv ? { apiKeyEnv } : {}), ...(displayName ? { displayName } : {}), declared })
		}
		return out
	}

	/** Boolean only: env ref presence OR local provider key store presence. */
	credentialStatus(ref: string): { configured: boolean } {
		if (typeof process.env[ref] === "string" && process.env[ref] !== "") return { configured: true }
		return { configured: Object.prototype.hasOwnProperty.call(this.#readKeys(), ref) }
	}

	/** Store one API key locally (owner-only 0600); value never echoed/logged. */
	login(ref: string, apiKey: string): void {
		const keys = this.#readKeys()
		keys[ref] = apiKey
		this.#writeKeys(keys)
	}

	/** Remove one stored key (absent ref is a harmless no-op). */
	logout(ref: string): void {
		const keys = this.#readKeys()
		delete keys[ref]
		this.#writeKeys(keys)
	}

	/**
	 * T7 (06 §1.1 / R6): PLAN one provider-route write, NEVER write the patch.
	 * The returned structured result routes the caller to `seam.settings.mutate`
	 * (the host settings channel); all field-level validation is retained from
	 * the retired direct writer (C1/C2), now used as an op-builder guard.
	 * `providers` is written per SUBKEY (`["providers", <id>]`) so legitimate
	 * additions merge instead of replacing the whole template dict.
	 */
	registerRoute(providerId: string, profile: Record<string, unknown> | undefined): SeamRegisterRoutePlan {
		if (!/^[A-Za-z0-9_.-]+$/.test(providerId)) {
			return { kind: "invalid", reason: `invalid provider id '${providerId}'` }
		}
		const ops: SeamSettingsOp[] = []
		if (profile === undefined) {
			ops.push({ op: "unset", path: ["providers", providerId] })
		} else {
			// C1/C2 — reject any profile field that cannot be persisted, so the
			// form never reports `subscribed` for a route the host cannot use.
			if (buildLoginRouteBlock(providerId, profile) === undefined) {
				return { kind: "invalid", reason: "invalid provider route profile" }
			}
			ops.push({ op: "set", path: ["providers", providerId], value: profile })
		}
		return { kind: "host-settings", ns: "llm-pi-ai", ops }
	}

	#readKeys(): Record<string, string> {
		try {
			const doc = asRecord(JSON.parse(readFileSync(this.#keysPath, "utf8")))
			const out: Record<string, string> = {}
			for (const [k, v] of Object.entries(doc)) if (typeof v === "string") out[k] = v
			return out
		} catch {
			return {}
		}
	}

	#writeKeys(keys: Record<string, string>): void {
		mkdirSync(dirname(this.#keysPath), { recursive: true })
		// C3 (025-w1b) — create the temp file ALREADY owner-only so there is no
		// 0644 window between atomicWrite (rename) and a later chmod.
		const tmp = `${this.#keysPath}.${process.pid}.s5.tmp`
		try {
			writeFileSync(tmp, JSON.stringify(keys, null, 2) + "\n", { mode: 0o600 })
			try { chmodSync(tmp, 0o600) } catch { /* best effort on non-posix */ }
			renameSync(tmp, this.#keysPath)
		} catch (err) {
			try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
			throw err
		}
	}
}
