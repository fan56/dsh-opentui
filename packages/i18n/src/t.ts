/**
 * `t(key, params?)` + boot-time language resolution.
 *
 * Contract (research/gap-analysis-20261113/c5-i18n-design.md §3, live-switch
 * amendment): the language starts at boot replay (`applyI18nConfig`) and can
 * be switched LIVE through `setLanguage(id)` — the active language rides a
 * solid-js signal, so `t()` call sites inside a solid tracking scope
 * (components, createEffect) re-render automatically when the language
 * changes. Persistence stays the CALLER's job (`/language` persists through
 * the config seam first, then calls `setLanguage`).
 * - `t()` is fail-open and NEVER throws (§6 exit(2) rule): missing key → en,
 *   missing in en too → the key itself; a missing param leaves the
 *   placeholder as-is; any unexpected error returns the key.
 */

import { createSignal } from "solid-js"
import {
	DEFAULT_LANGUAGE,
	loadLocales,
	type LocaleTable,
} from "./registry"

export interface I18nConfigLike {
	/** unified language setting (`/language`); unknown shapes are ignored */
	lang?: unknown
	/** legacy hints-bar locale (`/hints lang`); folded into the unified language at boot */
	hintsLocale?: unknown
}

interface I18nState {
	languages: Map<string, LocaleTable>
	active: string
	/** degraded from a legacy `hintsLocale` ja/ko value (warned once at boot) */
	warnings: string[]
}

const state: I18nState = { languages: new Map(), active: DEFAULT_LANGUAGE, warnings: [] }

/**
 * The live language signal. Boot replay seeds it (`applyI18nConfig`), a
 * `/language`-style pick flips it (`setLanguage`); solid tracking scopes that
 * call `t()` re-run when it changes.
 */
const [languageSignal, setLanguageSignal] = createSignal<string>(DEFAULT_LANGUAGE)

/**
 * The offered language choices (T14 `/language` + the settings language rows
 * — design §1: the contract is en + zh-CN ONLY; ja/ko are deliberately not
 * offered as options, the /hints lang degrade path stays its own surface).
 */
export const LANGUAGE_CHOICES: readonly string[] = ["en", "zh-CN"]

/**
 * Resolve a config value into a language id. Canonical ids are `en` and
 * `zh-CN` (`zh-CN` spelling matches the existing `hintsLocale` config values,
 * design §1). `zh` aliases (zh / zh_cn / zh-hans / zh-Hans-CN …) map to
 * `zh-CN`; `ja`/`ko` (bundled languages deliberately not shipped) degrade to
 * `en`; anything unknown/missing/non-string falls back to `en`.
 */
export function localeFromConfig(value: unknown): string {
	if (typeof value !== "string") return DEFAULT_LANGUAGE
	const norm = value.trim().replace(/[_]/g, "-").toLowerCase()
	if (norm === "" || norm === "en" || norm === "en-us" || norm === "en-gb") return DEFAULT_LANGUAGE
	if (
		norm === "zh-cn" ||
		norm === "zh" ||
		norm === "zh-hans" ||
		norm === "zh-hans-cn" ||
		norm === "zh-sg" ||
		norm === "zh-my"
	) {
		return "zh-CN"
	}
	// ja/ko and every other unknown id: no bundled file → degrade to en
	return DEFAULT_LANGUAGE
}

/**
 * Boot replay (v2-entry `applyHintsConfig` parity, design §3): load the
 * registry, resolve the language from the unified `lang` key (legacy
 * `hintsLocale` folds in when no unified value exists) and fix it for the
 * process lifetime. Best-effort: never throws; on any problem the en default
 * stays active.
 */
export function applyI18nConfig(
	config?: I18nConfigLike,
	options?: { userDir?: string; bundledDir?: string },
): { language: string; warnings: string[] } {
	try {
		const loaded = loadLocales(options)
		state.languages = loaded.languages
		state.warnings = [...loaded.warnings]
		const requested = config?.lang !== undefined ? config.lang : config?.hintsLocale
		state.active = localeFromConfig(requested)
		// ja/ko are deliberately not bundled (design §1): an explicit request
		// degrades to en with a warning; other unknown ids silently fall back.
		if (
			typeof requested === "string" &&
			/^(ja|ko)([-_].*)?$/i.test(requested.trim()) &&
			!state.languages.has(requested.trim())
		) {
			state.warnings.push(`[i18n] language '${requested.trim()}' is not bundled — degraded to '${DEFAULT_LANGUAGE}'`)
		}
		if (!state.languages.has(state.active)) {
			state.warnings.push(`[i18n] language '${state.active}' not installed — falling back to '${DEFAULT_LANGUAGE}'`)
			state.active = DEFAULT_LANGUAGE
		}
	} catch (error) {
		state.warnings.push(`[i18n] boot load failed: ${error instanceof Error ? error.message : String(error)}`)
		state.languages = new Map()
		state.active = DEFAULT_LANGUAGE
	}
	for (const warning of state.warnings) console.warn(warning)
	setLanguageSignal(state.active)
	return { language: state.active, warnings: state.warnings }
}

/**
 * The active language id. Reads the live signal (reactive inside a solid
 * tracking scope); with an empty registry (never boot-loaded) it degrades to
 * en without losing the signal subscription.
 */
export function activeLanguage(): string {
	const id = languageSignal()
	return state.languages.size === 0 ? DEFAULT_LANGUAGE : id
}

/** Installed language ids, sorted (bundled + user-registered). */
export function installedLanguages(): string[] {
	return [...state.languages.keys()].sort()

}

/**
 * Switch the active language LIVE (no restart): flip the signal (tracked
 * `t()` call sites re-render) + the non-reactive mirror. Persistence is the
 * CALLER's job — `/language` persists the unified `lang` key through the
 * config seam before calling this. An id without a table (a hand-rolled
 * caller past an uninstalled id — the real-machine live-lang symptom-2 shape)
 * is REFUSED with a warning instead of parking the signal on a table-less
 * language, where the fail-open chain would silently mask every miss
 * (hintLabel turns a key-shaped t() output into '').
 */
export function setLanguage(id: string): void {
	if (state.languages.size > 0 && !state.languages.has(id)) {
		console.warn(`[i18n] setLanguage('${id}') has no table — keeping '${state.active}'`)
		return
	}
	state.active = id
	setLanguageSignal(id)
}

/** Test/secondary hook: point the registry at explicit tables without a boot replay. */
export function setLanguages(languages: Map<string, LocaleTable>, active?: string): void {
	state.languages = languages
	setLanguage(active ?? DEFAULT_LANGUAGE)
}

const table = (id: string): LocaleTable | undefined => state.languages.get(id)

/** Safe stringify: a value String() cannot render (e.g. a symbol) keeps the placeholder. */
const safeString = (value: unknown): string | undefined => {
	try {
		return String(value)
	} catch {
		return undefined
	}
}

const interpolate = (template: string, params: Record<string, unknown>): string =>
	template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (placeholder, name: string) => {
		if (!Object.prototype.hasOwnProperty.call(params, name)) return placeholder
		return safeString(params[name]) ?? placeholder
	})

/**
 * Translate one key in the ACTIVE language (live: the language signal is
 * read inside this call, so solid tracking scopes re-run on a language
 * switch). Fail-open, never throws: active language → en → the key itself; a
 * param that is not supplied keeps its `{placeholder}`; a non-string table
 * entry is treated as missing.
 */
export function t(key: string, params?: Record<string, unknown>): string {
	try {
		const active = activeLanguage()
		const raw = table(active)?.[key] ?? table(DEFAULT_LANGUAGE)?.[key]
		if (typeof raw !== "string") return key
		return params ? interpolate(raw, params) : raw
	} catch {
		return key
	}
}
