/**
 * Config seam reader (batch F2 cacheHitMode, tui-pi parity): the ⚡ CH
 * footer segment's rate mode, read off the merged session config
 * (`configLoad()` — profile config.json ⊕ workspace overlay ⊕ env).
 *
 * tui-pi semantics (dsh-tui-pi src/theme-settings.ts narrowCacheHitMode):
 * the value `"session"` selects the session-cumulative hit rate over the
 * whole session's billed input traffic; ANYTHING ELSE — including the
 * absent key — narrows to the per-message default (`lastMessage`).
 */

/** Which usage sample the ⚡ CH footer rate describes. */
export type CacheHitMode = "session" | "lastMessage"

/** The footer CH default: per-message, matching the pi-tui footer. */
export const DEFAULT_CACHE_HIT_MODE: CacheHitMode = "lastMessage"

/** Narrow an unknown config value to a CacheHitMode (tui-pi semantics). */
export function narrowCacheHitMode(value: unknown): CacheHitMode {
	return value === "session" ? "session" : DEFAULT_CACHE_HIT_MODE
}

/** The config seam reader: pick the CH mode off a `configLoad()` result. */
export function readCacheHitMode(config: Record<string, unknown> | undefined | null): CacheHitMode {
	return narrowCacheHitMode(config?.cacheHitMode)
}

// ---------------------------------------------------------------------------
// settings-defaults-029 — shared numeric preference defaults.
//
// These are PURE readers over a merged `configLoad()` view. They are shared on
// purpose: the /settings panel displays the effective value, the subagent
// round policy enforces the cap, and the (later) session prune will read the
// retention window. One default per key keeps display and runtime from
// drifting. An explicitly stored `0` is a REAL value (disable the ladder /
// disable the retention cutoff), never a missing key: it survives both readers.
// Malformed / negative / non-finite values fall back, like the lang validator's
// fail-open law — a hand-edited config cannot widen a default silently.
// ---------------------------------------------------------------------------

/** Default global subagent round cap (the round ladder's global cap). */
export const DEFAULT_MAX_ROUNDS = 50

/** Default stored-session retention window in days (future prune consumer). */
export const DEFAULT_RETENTION_DAYS = 90

/** Non-negative integer config value, or undefined when absent/malformed. */
function configNonNegativeInt(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value)
	if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim())
	return undefined
}

/** Effective global subagent cap off a `configLoad()` result (explicit 0 kept). */
export function readMaxRounds(config: Record<string, unknown> | undefined | null): number {
	return configNonNegativeInt(config?.maxRounds) ?? DEFAULT_MAX_ROUNDS
}

/**
 * Effective session-retention days off a `configLoad()` result (explicit 0
 * kept). Shared pure fallback for the later prune implementation; this slice
 * only supplies the reader — no deletion is performed anywhere.
 */
export function readRetentionDays(config: Record<string, unknown> | undefined | null): number {
	return configNonNegativeInt(config?.retentionDays) ?? DEFAULT_RETENTION_DAYS
}
