/**
 * Config seam readers: narrow config values off the seam's READ-ONLY config
 * faces (no `configSave`, no `ConfigProvider.update`). The ⚡ CH footer rate
 * mode (batch F2, tui-pi parity) reads `configLoad()`; the v2 transcript
 * scrollbar (round7 AMEND) reads nested `session.scrollbar` below.
 *
 * tui-pi semantics (dsh-tui-pi src/theme-settings.ts narrowCacheHitMode):
 * the value `"session"` selects the session-cumulative hit rate over the
 * whole session's billed input traffic; ANYTHING ELSE — including the
 * absent key — narrows to the per-message default (`lastMessage`).
 */
import { Schema } from "effect"

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

// --- v2 transcript scrollbar (round7 AMEND) -------------------------------
// `configLoad()` projects only a whitelist of flat keys; nested `session` is
// NOT among them (shell LocalConfigStore CONFIG_KEYS). The honest read-only
// path is therefore the full-config seam faces: `workspaceConfig()` (workspace
// overlay, highest precedence) and `configRaw()` (profile config.json), with
// `configLoad()` kept last for hosts whose whitelist does carry the key.
// Decode with the config schema's boolean shape: anything that is not an
// explicit boolean degrades to "unset" and never turns the scrollbar off.
const SessionScrollbarConfig = Schema.Struct({
	session: Schema.optional(Schema.Struct({ scrollbar: Schema.Boolean })),
})
const decodeScrollbar = Schema.decodeUnknownOption(SessionScrollbarConfig)

/** Read the explicit `session.scrollbar` boolean across config faces. */
export function readSessionScrollbar(
	...configs: Array<Record<string, unknown> | undefined | null>
): boolean | undefined {
	for (const config of configs) {
		const decoded = decodeScrollbar(config ?? {})
		if (decoded._tag === "Some" && decoded.value.session?.scrollbar !== undefined) {
			return decoded.value.session.scrollbar
		}
	}
	return undefined
}

/** The v2 page default: scrollbar ON unless the user explicitly sets it off. */
export const DEFAULT_SESSION_SCROLLBAR = true

/** Resolve the effective v2 scrollbar: explicit config wins, default true. */
export function resolveSessionScrollbar(
	...configs: Array<Record<string, unknown> | undefined | null>
): boolean {
	return readSessionScrollbar(...configs) ?? DEFAULT_SESSION_SCROLLBAR
}
