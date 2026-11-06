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
