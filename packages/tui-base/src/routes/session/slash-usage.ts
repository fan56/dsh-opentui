/**
 * Slash-command usage memory — how many times each command was EXECUTED,
 * for the palette's "frequent first" ordering.
 *
 * Counting happens in `createSlashHost.run()` (slash-palette.tsx), i.e. only
 * when `interceptSubmit` actually dispatches a command — highlighting a row,
 * moving the selection, or Tab-completing never touches the counter.
 *
 * Persistence reuses the ONE config seam every other UI preference already
 * rides (`/motion`'s `motion` key, `/hints`' `footerHints`/`hintsLocale`):
 * `seam.configLoad()` at construction, `seam.configSave({ slashUsage })` on
 * every execution. The shell adapter routes unlisted keys to the profile
 * `config.json`, so the counts survive a restart with no new store file and
 * no new config system. The key is namespaced (`slashUsage`) so it never
 * collides with a user-facing setting.
 *
 * Failure law: this is a convenience ranking, never a boot dependency. A
 * throw from `configLoad` starts empty; a throw from `configSave` keeps the
 * in-memory counts and is swallowed (no console noise, no startup break).
 */
import type { SessionSeam } from "../../seams/session"

/** Profile config key holding the `{ "/name": count }` map. */
export const SLASH_USAGE_KEY = "slashUsage"

/** Read-only count lookup (what the palette ordering consumes). */
export interface CommandUsageView {
	count(name: string): number
}

/**
 * Sanitize a persisted value into `{ "/name": non-negative integer }`.
 * Anything else (missing key, array, strings, NaN, negative) is dropped —
 * a hand-edited config must never crash ordering.
 */
export function normalizeCommandUsage(value: unknown): Record<string, number> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return {}
	const out: Record<string, number> = {}
	for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
		if (!name.startsWith("/")) continue
		if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) continue
		out[name] = Math.floor(raw)
	}
	return out
}

/**
 * The in-memory counter plus its best-effort writer. `save` receives the
 * whole map (the config surface merges keys, not values).
 */
export class CommandUsage implements CommandUsageView {
	#counts: Record<string, number>
	#save: ((counts: Record<string, number>) => void) | undefined

	constructor(initial: Record<string, number> = {}, save?: (counts: Record<string, number>) => void) {
		this.#counts = { ...initial }
		this.#save = save
	}

	/** Executions of `name` so far (0 when never run). */
	count(name: string): number {
		return this.#counts[name] ?? 0
	}

	/** A copy of the whole map (tests/diagnostics). */
	counts(): Record<string, number> {
		return { ...this.#counts }
	}

	/**
	 * Bump one execution. The write is best-effort: a throwing `save` (disk
	 * full, read-only profile, missing seam) never propagates — the session
	 * keeps ranking on the in-memory counts.
	 */
	record(name: string): void {
		this.#counts = { ...this.#counts, [name]: this.count(name) + 1 }
		try {
			this.#save?.(this.#counts)
		} catch {
			// silent degrade: frequency ranking is not worth a startup/runtime failure
		}
	}
}

/**
 * Build the counter from the seam. Both reads and writes are optional and
 * individually guarded, so a seam without the config face (or a corrupt
 * config.json) yields a session-scoped counter instead of a boot error.
 */
export function createCommandUsage(
	seam: Pick<SessionSeam, "configLoad" | "configSave"> | undefined,
): CommandUsage {
	let config: Record<string, unknown> = {}
	try {
		config = seam?.configLoad?.() ?? {}
	} catch {
		config = {}
	}
	return new CommandUsage(normalizeCommandUsage(config[SLASH_USAGE_KEY]), (counts) => {
		seam?.configSave?.({ [SLASH_USAGE_KEY]: counts })
	})
}
