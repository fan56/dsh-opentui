/**
 * Dock think/tool visibility timing (user directive, 2026-11-10).
 *
 * A finished activity block is NOT cleared the moment its stream/settle
 * stops. It lingers fully visible for `DOCK_LINGER_MS` (2s), then (when the
 * sweep is enabled) fades out over `DOCK_FADE_OUT_MS` (original 300ms). Since
 * 2026-11-23 the sweep is disabled (0ms) so the line goes straight to hidden
 * at the 2s edge. During the linger a new burst of the SAME
 * kind replaces the old block (see dockLines / seam-rows: the store drops the
 * old think summary, and a starting tool flags the previous settled tool
 * lines as cleared).
 *
 * The state machine is PURE and timestamp-driven: `dockLineVisibility` maps a
 * stop anchor + the current clock reading onto
 * `live | lingering | fading | hidden` plus the fade progress. The view layer
 * reads it from the renderer's shared animation clock (onAnimationTick), so
 * there is no new setInterval/setTimeout anywhere. The seam store keeps a
 * settled row for `DOCK_LINE_RETENTION_MS` (2s + 0ms while the sweep is
 * disabled; originally 2s + 300ms) under the decorated (full) tier — exactly
 * long enough for the view to finish the sweep, so the store's drop is only
 * the backstop. The non-decorated tiers (reduced/off)
 * paint no sweep: the view itself turns the line `hidden` at the 2s linger
 * edge and the store's drop coincides with that edge (`dockRemovalMs(false)`
 * → `DOCK_LINGER_MS`). For `off` — whose clock is paused, so no view repaint
 * can land at 2.0s — that drop IS the removal moment; documented as 2.0s.
 */
/** Hold after the round ends, fully visible (user directive: 2s). */
export const DOCK_LINGER_MS = 2000

/** Fade sweep after the hold — the same 300ms the skin exit fade used. */
// 原 300；2026-11-23 用户指示暂时关闭渐隐（残影/不消失问题），恢复改回 300
export const DOCK_FADE_OUT_MS = 0
//
// 恢复清单（2026-11-23 用户已拍板不恢复则无需执行，清单仅供将来反悔用）：
//   1. 本常量改回 300 → DOCK_LINE_RETENTION_MS 自动回到 2300，fading 分支重新可达。
//   2. packages/tui-base/test/widgets-dock-render.test.ts:98 取消 M1 用例的 test.skip。
//   3. packages/tui-base/test/widgets-dock.test.ts 三条改回原期望：
//      a. 计时：「hold 2000ms → sweep 300ms → done at 2300ms」（300 / 2300 / mid≈0.5）
//      b. 颜色：「fade color … half-mixed at the sweep midpoint」（中点 #800000）
//      c. timeline：「full 2s linger, then a 300ms sweep, then gone」（2000 fading / 2150 mid / 2300 hidden）
//      并删除 R3 新增的「DOCK_FADE_OUT_MS=0 → dockLineVisibility never returns fading」用例。
//   4. packages/tui-base/test/widgets-dock-render.test.ts:817 D3/D14 用例改回
//      「full 保留到 2.3s、reduced/off 在 2.0s 丢弃」的 tier 边界断言。
//   5. packages/shell/test/shell-render-incident-motion-ft.test.tsx:56 shell motion
//      用例改回「窗内采到 mid-sweep 混合帧」的断言。
//   6. widgets-dock.tsx 注释段中标注「2026-11-23 / no fade / no sweep」的退场描述同步还原。

/** How long a settled row must stay in the store so the view can finish the
 * fade: the linger plus the sweep. The seam-rows fade timers use this. */
export const DOCK_LINE_RETENTION_MS = DOCK_LINGER_MS + DOCK_FADE_OUT_MS

/** The store's retention delay for the active motion tier: decorated (full)
 * keeps the row through the sweep (300ms when enabled; 0ms now, so both tiers
 * drop at the 2s linger edge); reduced/off have no gradient. Removal moment ==
 * what the docs promise, and `off`'s paused clock can rely on the drop. */
export function dockRemovalMs(decorated: boolean): number {
	return decorated ? DOCK_LINE_RETENTION_MS : DOCK_LINGER_MS
}

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
 *   - elapsed ≥ 2s + DOCK_FADE_OUT_MS → `hidden`;
 *   - otherwise `fading`, progress 0→1 over the sweep. With the sweep disabled
 *     (0ms) this branch is unreachable — `fading` is never returned.
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
