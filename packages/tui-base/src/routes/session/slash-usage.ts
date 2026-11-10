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
 * `seam.configLoad()` at construction, `seam.configSave({ slashUsage })` after
 * a dispatch. The shell adapter routes unlisted keys to the profile
 * `config.json`, so the counts survive a restart with no new store file and
 * no new config system. The key is namespaced (`slashUsage`) so it never
 * collides with a user-facing setting.
 *
 * WRITE POLICY (review C1). Every dispatch used to rewrite the whole profile
 * config synchronously — N quick dispatches meant N full-file writes, each a
 * torn-file window. The counter now coalesces writes in a ~1.2 s window
 * (several dispatches = one save of the merged map) and the seam's profile
 * write is tmp+rename atomic (remote-host-session.configSave). `flush()` is
 * exposed for tests and the process-exit hook so a quit right after a
 * dispatch does not lose the last count.
 *
 * Failure law: this is a convenience ranking, never a boot dependency. A
 * throw from `configLoad` starts empty; a throw from `configSave` keeps the
 * in-memory counts and is swallowed (no console noise, no startup break).
 */
import type { SessionSeam } from "../../seams/session"

/** Profile config key holding the `{ "/name": count }` map. */
export const SLASH_USAGE_KEY = "slashUsage"

/** Coalescing window: dispatches inside it become ONE whole-file save (ms). */
export const SAVE_DEBOUNCE_MS = 1200

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
 * Commands renamed after counts were already persisted: new name → old name.
 * `/sessions` became `/resume` (the dsh-tui-pi name; no alias kept), so a
 * profile written by an older build carries its executions under a key the
 * palette no longer asks about.
 */
export const RENAMED_COMMANDS: Readonly<Record<string, string>> = {
	"/resume": "/sessions",
}

/**
 * Fold a legacy count into its renamed command, ONCE at load. The old key is
 * dropped, never summed: the pair describes the same row, and adding both
 * would rank it for commands the user never ran under the new build twice
 * over. A profile that already counts the new name keeps that count (the
 * legacy value is discarded). The next save writes only the new key — the
 * compatibility read costs one boot, not a permanent alias in the map.
 */
export function migrateRenamedCommands(counts: Record<string, number>): Record<string, number> {
	let out: Record<string, number> | undefined
	for (const [name, legacy] of Object.entries(RENAMED_COMMANDS)) {
		const inherited = counts[legacy]
		if (inherited === undefined) continue
		out ??= { ...counts }
		delete out[legacy]
		if (out[name] === undefined) out[name] = inherited
	}
	return out ?? counts
}

/** Savers with a scheduled write; one process-exit hook flushes them. */
const pending = new Set<CommandUsage>()
let exitHooked = false
function hookExit(): void {
	if (exitHooked) return
	exitHooked = true
	process.once("exit", () => {
		for (const usage of pending) usage.flush()
	})
}

/**
 * The in-memory counter plus its debounced, best-effort writer. `save`
 * receives the whole map (the config surface merges keys, not values);
 * repeated `record` calls inside the window collapse into one `save`.
 */
export class CommandUsage implements CommandUsageView {
	#counts: Record<string, number>
	#save: ((counts: Record<string, number>) => void) | undefined
	#debounceMs: number
	#timer: ReturnType<typeof setTimeout> | undefined
	#dirty = false

	constructor(
		initial: Record<string, number> = {},
		save?: (counts: Record<string, number>) => void,
		debounceMs = SAVE_DEBOUNCE_MS,
	) {
		this.#counts = { ...initial }
		this.#save = save
		this.#debounceMs = debounceMs
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
		this.#dirty = true
		this.#schedule()
	}

	/** Write the pending map NOW (tests, process exit). No-op when clean. */
	flush(): void {
		if (this.#timer !== undefined) {
			clearTimeout(this.#timer)
			this.#timer = undefined
		}
		pending.delete(this)
		if (!this.#dirty) return
		this.#dirty = false
		try {
			this.#save?.(this.#counts)
		} catch {
			// silent degrade: frequency ranking is not worth a startup/runtime failure
		}
	}

	#schedule(): void {
		if (this.#save === undefined) return
		if (this.#debounceMs <= 0) {
			this.flush()
			return
		}
		pending.add(this)
		hookExit()
		if (this.#timer !== undefined) clearTimeout(this.#timer)
		this.#timer = setTimeout(() => this.flush(), this.#debounceMs)
		// Never hold the process open for a convenience write.
		this.#timer.unref?.()
	}
}

/**
 * Build the counter from the seam. Both reads and writes are optional and
 * individually guarded, so a seam without the config face (or a corrupt
 * config.json) yields a session-scoped counter instead of a boot error.
 */
export function createCommandUsage(
	seam: Pick<SessionSeam, "configLoad" | "configSave"> | undefined,
	debounceMs = SAVE_DEBOUNCE_MS,
): CommandUsage {
	let config: Record<string, unknown> = {}
	try {
		config = seam?.configLoad?.() ?? {}
	} catch {
		config = {}
	}
	return new CommandUsage(
		migrateRenamedCommands(normalizeCommandUsage(config[SLASH_USAGE_KEY])),
		(counts) => {
			seam?.configSave?.({ [SLASH_USAGE_KEY]: counts })
		},
		debounceMs,
	)
}
