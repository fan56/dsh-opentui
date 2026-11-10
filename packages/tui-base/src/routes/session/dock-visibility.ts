/**
 * Dock think/tool visibility timing (user directive, 2026-11-10).
 *
 * A finished activity block is NOT cleared the moment its stream/settle
 * stops. It lingers fully visible for `DOCK_LINGER_MS` (2s), then fades out
 * over `DOCK_FADE_OUT_MS` (300ms). During the linger a new burst of the SAME
 * kind replaces the old block (see dockLines / seam-rows: the store drops the
 * old think summary, and a starting tool flags the previous settled tool
 * lines as cleared).
 *
 * The state machine is PURE and timestamp-driven: `dockLineVisibility` maps a
 * stop anchor + the current clock reading onto
 * `live | lingering | fading | hidden` plus the fade progress. The view layer
 * reads it from the renderer's shared animation clock (onAnimationTick), so
 * there is no new setInterval/setTimeout anywhere. The seam store keeps a
 * settled row for `DOCK_LINE_RETENTION_MS` (2s + 300ms) — exactly long enough
 * for the view to finish the sweep; the store's drop is only the backstop.
 */
/** Hold after the round ends, fully visible (user directive: 2s). */
export const DOCK_LINGER_MS = 2000

/** Fade sweep after the hold — the same 300ms the skin exit fade used. */
export const DOCK_FADE_OUT_MS = 300

/** How long a settled row must stay in the store so the view can finish the
 * fade: the linger plus the sweep. The seam-rows fade timers use this. */
export const DOCK_LINE_RETENTION_MS = DOCK_LINGER_MS + DOCK_FADE_OUT_MS

/** Default lines per widget (think block / tool block), independently. */
export const DOCK_WIDGET_MAX_LINES = 3

/** Compact terminals (≤ COMPOSER_COMPACT_TERMINAL_ROWS) shrink each block to
 * ONE line — the same two-row activity footprint as before this change, so
 * 80x24 keeps its transcript floor. */
export const DOCK_COMPACT_MAX_LINES = 1

export type DockLinePhase = "live" | "lingering" | "fading" | "hidden"

export interface DockLineVisibility {
	phase: DockLinePhase
	/** 0 while live/lingering, 0→1 across the sweep, 1 when hidden. */
	progress: number
}

/**
 * Pure visibility of one finished dock line/block.
 *
 *   - `stopAt` undefined → `live` (still streaming/running, or a replay row
 *     without an anchor: no fade, solid color — the old H5 law);
 *   - elapsed < 2s → `lingering` (full color);
 *   - `decorated` false (motion reduced/off) → `hidden` at the 2s deadline
 *     with NO gradient (degradation contract: the tier that forbids fades
 *     drops straight to gone);
 *   - elapsed ≥ 2s + 300ms → `hidden`;
 *   - otherwise `fading`, progress 0→1 over the 300ms sweep.
 */
export function dockLineVisibility(
	stopAt: number | undefined,
	now: number,
	decorated: boolean,
): DockLineVisibility {
	if (stopAt === undefined) return { phase: "live", progress: 0 }
	const elapsed = now - stopAt
	if (elapsed < DOCK_LINGER_MS) return { phase: "lingering", progress: 0 }
	if (!decorated || elapsed >= DOCK_LINE_RETENTION_MS) return { phase: "hidden", progress: 1 }
	return { phase: "fading", progress: (elapsed - DOCK_LINGER_MS) / DOCK_FADE_OUT_MS }
}

/** The color mix progress for a fading line (1 = background). Non-fading
 * phases answer 0 (full color); hidden answers 1. */
export function dockLineFadeProgress(stopAt: number | undefined, now: number, decorated: boolean): number {
	return dockLineVisibility(stopAt, now, decorated).progress
}

/** One-line guard used by the pure builders: should this line be painted? */
export function dockLineVisible(stopAt: number | undefined, now: number, decorated: boolean): boolean {
	return dockLineVisibility(stopAt, now, decorated).phase !== "hidden"
}
