/**
 * Locale registry: validate / merge / directory resolution / installedLanguages.
 *
 * Contract (research/gap-analysis-20261113/c5-i18n-design.md §1/§3):
 * - one language = one flat JSON file (`<id>.json`), required field `name`,
 *   everything else is a flat `key -> string` mapping;
 * - strict validation is whole-file: a number, a nested object, an empty
 *   string or a non-`{param}`-compatible placeholder anywhere → the ENTIRE
 *   file is rejected with the offending key(s) reported (no half-loaded
 *   language; same spirit as the theme registry);
 * - a file that fails to parse as JSON is skipped with a warning — the app
 *   must never crash on a hand-edited file;
 * - a user file with the same id (`$DSH_HOME/locales/<id>.json`) overrides
 *   the bundled table key-by-key; an unseen id registers a new language.
 *
 * No UI dependencies: node:path/fs + JSON only (design §3).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const DEFAULT_LANGUAGE = "en"

/** A validated flat table: `name` plus flat `key -> string` entries. */
export type LocaleTable = Record<string, string>

export interface LocaleFileError {
	/** offending key, or a pseudo-key for file-level problems ("(file)", "(name)") */
	key: string
	reason: string
}

export type ValidateResult =
	| { ok: true; table: LocaleTable }
	| { ok: false; errors: LocaleFileError[] }

/**
 * `{param}` placeholders must be a bare identifier: `{name}`, `{count}`.
 * Anything else that looks like a placeholder (`{0}`, `{a b}`, `{}`, `{a-b}`,
 * `%s`, `{{x}}`-style nesting) is not compatible → whole-file reject.
 */
const PLACEHOLDER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const PLACEHOLDER_SCAN = /\{([^{}]*)\}/g

/** Placeholder names used by one message value, in `{name}` syntax. */
export function extractParams(value: string): Set<string> {
	const names = new Set<string>()
	for (const match of value.matchAll(PLACEHOLDER_SCAN)) {
		const token = match[1] ?? ""
		if (PLACEHOLDER_NAME.test(token)) names.add(token)
	}
	return names
}

const hasIncompatiblePlaceholder = (value: string): string | undefined => {
	for (const match of value.matchAll(PLACEHOLDER_SCAN)) {
		const token = match[1] ?? ""
		if (!PLACEHOLDER_NAME.test(token)) return match[0]
	}
	// legacy printf-style placeholders are not {param}-compatible either
	const legacy = value.match(/%[-0-9.]*[sdif@]/)
	if (legacy) return legacy[0]
	return undefined
}

/**
 * Whole-file validation (design §1 "strict validation" row). A flat JSON
 * object with a non-empty string `name` and only non-empty string values
 * passes; anything else reports every offending key and fails the file.
 */
export function validateLocaleFile(raw: unknown): ValidateResult {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { ok: false, errors: [{ key: "(file)", reason: "not a flat JSON object" }] }
	}
	const errors: LocaleFileError[] = []
	const record = raw as Record<string, unknown>
	const name = record["name"]
	if (typeof name !== "string" || name.length === 0) {
		errors.push({ key: "name", reason: "missing or not a non-empty string" })
	}
	for (const [key, value] of Object.entries(record)) {
		if (key === "name") continue
		if (typeof value !== "string") {
			errors.push({ key, reason: `not a string (${value === null ? "null" : Array.isArray(value) ? "array" : typeof value})` })
			continue
		}
		if (value.length === 0) {
			errors.push({ key, reason: "empty string" })
			continue
		}
		const bad = hasIncompatiblePlaceholder(value)
		if (bad !== undefined) errors.push({ key, reason: `incompatible placeholder ${bad} (expected {param})` })
	}
	if (errors.length > 0) return { ok: false, errors }
	return { ok: true, table: raw as LocaleTable }
}

/** Parse + validate one locale file's text; a JSON syntax error is a rejection, never a throw. */
export function parseLocaleFile(text: string): ValidateResult {
	let raw: unknown
	try {
		raw = JSON.parse(text)
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		return { ok: false, errors: [{ key: "(file)", reason: `invalid JSON: ${reason}` }] }
	}
	return validateLocaleFile(raw)
}

/** Key-by-key override merge (design §1 "merge semantics" row). */
export function mergeTables(bundled: LocaleTable, override: LocaleTable): LocaleTable {
	return { ...bundled, ...override }
}

/**
 * The user locale directory: `$DSH_HOME/locales` (DSH_HOME resolution matches
 * the rest of the repo: env var, else `~/.dsh`).
 */
export function userLocalesDir(dshHome?: string): string {
	const home = dshHome ?? process.env.DSH_HOME ?? join(homedir(), ".dsh")
	return join(home, "locales")
}

/**
 * Bundled `locales/` resolution, tui-pi style: from this module's directory
 * walk up until a directory containing `locales/en.json` is found, so the
 * lookup works from src and from any compiled artifact location.
 */
export function bundledLocalesDir(): string {
	let dir = dirname(new URL(import.meta.url).pathname)
	for (let up = 0; up < 6; up++) {
		const candidate = join(dir, "locales")
		if (existsSync(join(candidate, `${DEFAULT_LANGUAGE}.json`))) return candidate
		const parent = dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	return join(dirname(new URL(import.meta.url).pathname), "..", "locales")
}

export interface LoadLocalesResult {
	/** language id -> table; includes bundled en/zh-CN and every registered user language */
	languages: Map<string, LocaleTable>
	/** human-readable warnings for every rejected/skipped file (console + tests) */
	warnings: string[]
}

/**
 * Load the bundled baseline, then merge `$DSH_HOME/locales/<lang>.json`
 * user overrides (same id) / registrations (new id). Invalid files are
 * rejected whole with a warning — the app never crashes and no language is
 * half-loaded.
 */
export function loadLocales(options?: { bundledDir?: string; userDir?: string }): LoadLocalesResult {
	const bundledDir = options?.bundledDir ?? bundledLocalesDir()
	const languages = new Map<string, LocaleTable>()
	const warnings: string[] = []

	if (existsSync(bundledDir)) {
		for (const entry of readdirSync(bundledDir)) {
			if (!entry.endsWith(".json")) continue
			const id = entry.slice(0, -".json".length)
			const result = parseLocaleFile(readFileSync(join(bundledDir, entry), "utf8"))
			if (!result.ok) {
				warnings.push(`[i18n] bundled locale file rejected, skipping '${entry}': ${formatErrors(result.errors)}`)
				continue
			}
			languages.set(id, result.table)
		}
	} else {
		warnings.push(`[i18n] bundled locales dir not found: ${bundledDir}`)
	}

	// Design contract: user overrides under $DSH_HOME/locales always ride the
	// boot load — an omitted options.userDir must not silently disable them.
	const userDir = options?.userDir ?? userLocalesDir()
	if (existsSync(userDir)) {
		for (const entry of readdirSync(userDir)) {
			if (!entry.endsWith(".json")) continue
			const id = entry.slice(0, -".json".length)
			const result = parseLocaleFile(readFileSync(join(userDir, entry), "utf8"))
			if (!result.ok) {
				warnings.push(`[i18n] user locale file rejected, skipping '${entry}': ${formatErrors(result.errors)}`)
				continue
			}
			const bundled = languages.get(id)
			languages.set(id, bundled ? mergeTables(bundled, result.table) : result.table)
		}
	}

	return { languages, warnings }
}

const formatErrors = (errors: LocaleFileError[]): string =>
	errors.map((e) => `${e.key}: ${e.reason}`).join("; ")

/** Sorted ids of a language map (bundled + user-registered). */
export function installedLanguagesFrom(languages: Map<string, LocaleTable>): string[] {
	return [...languages.keys()].sort()
}
