/**
 * WidgetsDock — batch D1: the fixed widgets slot above the composer
 * (dsh-tui-pi dock structure). The transcript renders ONLY user/assistant/
 * echo/notice/ask blocks (never tools/thinking); the live activity that the
 * old V1/V2a build painted as transcript rows docks here instead —
 * Todos → Think → Tool, fixed panels above the composer.
 *
 *   Todos  `todos [✓]2/3 · <current>`     — from the latest todo tool call
 *   Think  `💭 thinking · Xs · <tail>`    — up to DOCK_WIDGET_MAX_LINES (3)
 *          lines of the reasoning tail (live AND collapsed — the same tail,
 *          so collapsing never jumps the block back to the head);
 *          a finished round lingers 2s, then fades 0.3s (dock-visibility.ts)
 *   Tool   `⚙ name(subject) · Xs · <tail>` — up to 3 tool lines, newest
 *          last; settled lines freeze ✔/✘ + elapsed, then linger 2s and fade
 *
 * Data law: the dock is a pure VIEW over the seam-rows store — the phase
 * machine (onThinkingDelta / onToolRun / collapse / fade) is untouched.
 *
 * Visibility law (2026-11-10, exit timing UNCHANGED): a finished think/tool
 * block is NOT dropped when its stream/settle stops. It stays fully visible
 * for 2s (`DOCK_LINGER_MS`), then fades out over 300ms (`DOCK_FADE_OUT_MS`);
 * after that the line is `hidden`. New content of the same kind inside the
 * window replaces the old block (think: the store drops the old summary on
 * the next burst; tool: a starting tool flags the previous settled rows
 * `faded`). The timeline is a pure function of the row's stop anchor and the
 * wall clock; the view re-renders on the renderer's shared animation clock, so
 * no timers are added here. `reduced` hides at the 2s deadline without a
 * sweep and, together with `off`, the store's retention drop is the SAME
 * 2.0s (`dockRemovalMs(false)` → DOCK_LINGER_MS): the non-decorated tiers
 * have no sweep, so 2.0s is the hard removal moment. `off` never ticks, and
 * that 2.0s drop is what actually removes the line.
 *
 * 2026-11-19 user directive — SCENE TABLE (this SUPERSEDES the former "Think
 * and tool carry INDEPENDENT anchors — one never hides the other" law, REMOVED;
 * it also supersedes the earlier "keep subagents while think is visible"
 * reading, REMOVED). Priority: SUBAGENT ACTIVE > THINK EXCLUSIVE. Three scenes
 * are decided once per build from the live seam rows:
 *
 *   A. running subagent(s) present → think = 1 line, tool = 1 line, todo = ONE
 *      compact brief (`todo done/total Ns`, no current-task text); those three
 *      lines are PINNED ABOVE the subagent list, which takes all remaining
 *      lines under the existing ▲/▼ scroll clipping. Think/tool shrink to one
 *      line here regardless of gear or terminal height. A subagent with only
 *      HISTORICAL (non-running) rows is NOT "active": it does not open scene A.
 *   B. no running subagent + VISIBLE think (live burst OR the 2s exit hold;
 *      a decorated tier's 300ms fade tail is still "visible") → think = gear
 *      lines (1/5/7/10, `all`=10); tool AND todo are HIDDEN; no subagent list.
 *   C. no running subagent + no visible think → think absent; tool = up to
 *      DOCK_WIDGET_MAX_LINES (3, fixed — NEVER the gear); todo = ONE line in
 *      the current full summary format (`todos [✓]d/n · <active>`).
 *
 * Tool/todo resume the instant scene C holds. D5 (no content → whole dock
 * hidden) and the 2s/300ms exit timing themselves are untouched.
 *
 * CLOSURE LAW (D1 on-device finding): the component body declares NO
 * reactive state that the JSX props close over — every render getter calls
 * the module-level `dockLines` with the props accessor itself. On the real
 * boot, component-scope memo accessors read `undefined` from inside the
 * rendered box's setProp effects (twice reproduced with the real preload
 * transform; the same closures were verified non-undefined at body time —
 * root cause not yet isolated, see the D1 handoff). The transcript's own
 * closures keep working, so this is dock-local avoidance, not a global law.
 *
 * Layout law (2026-11-19): the dock sits in the transcript's bottom slot
 * (explicit-dims parent chain); the box sets an EXPLICIT height = 2 border
 * rows + its visible content-line count and flexShrink=0 so the composer keeps
 * its own height below it. The CONTENT area is elastic but HARD-CAPPED at 10
 * lines (`MERGED_DOCK_TOTAL_LINES`) — the old `all`-gear "2/3 of terminal rows"
 * growth rule and the halfBudget clamp are GONE. Per-scene budgets follow the
 * SCENE TABLE above; within a scene the upper (pinned) block sheds from its
 * head first and the subagent window clips with ▲/▼ indicators. D5: no
 * content → the whole dock stays hidden. Height changes ride a short
 * shared-clock tween (`dockHeightLines`, 200ms, integer lines, exact terminal
 * state).
 */
import { For, createEffect, createSignal, onCleanup, Show, untrack, type JSX } from "solid-js"
import { onAnimationTick } from "@opentui/solid"
import { useTerminalSize } from "./terminal-size"
import { parseColor, TextAttributes, type MouseEvent, type RGBA } from "@opentui/core"
import type { SeamRow } from "./seam-rows"
import type { SeamSubagentView } from "../../seams/session"
import { clipToWidth, toolDetail, toolResultLine, toolSubject } from "./tool-summarize"
import { parseTodos, type Todo } from "../../util/todo"
import { stringWidth } from "../../util/string-width"
import { useThemeOptional } from "../../context/theme"
import { t } from "../../i18n"
import { motionAnimationRunning, motionDecorationsEnabled, motionFrameRate } from "../../skin/motion"
import { COMPOSER_COMPACT_TERMINAL_ROWS } from "../../skin/semantic"
import {
	DOCK_COMPACT_MAX_LINES,
	DOCK_FADE_OUT_MS,
	DOCK_LINGER_MS,
	DOCK_WIDGET_MAX_LINES,
	dockLineVisibility,
} from "./dock-visibility"
import type { ComponentTheme } from "../../theme/component"
import type { HueScale } from "@opencode/theme/tui"
import { colorRgb, contrastRatio, mixPowerlineColor, relativeLuminance, type PowerlineColor } from "./powerline"
import {
	MERGED_DOCK_TOTAL_LINES,
	mergedDockLines,
	mergedPositionSuffix,
	mergedTitle,
	mergedWindowInfo,
	TODO_STATUS_GLYPHS,
	type MergedDockData,
	type MergedDockLine,
	type MergedDockOptions,
	type MergedThinkRow,
	type MergedToolRow,
} from "./merged-dock"
import { Keymap } from "../../context/keymap"
import { useIsPageOwner } from "../../context/input-ownership"

// ---------------------------------------------------------------------------
// Skin motion timing (skin contract §1 入场淡入/退场渐隐/提醒脉冲, batch δ).
// Pure so the fades/pulses are unit-testable; the VIEW layer derives progress
// from timestamps — the seam-rows phase machine (stop → clear at 1s) is
// untouched, per H5: the fade completes INSIDE the existing window.
// ---------------------------------------------------------------------------

/** Dock line entrance fade: text color faint → target, 0.4s. */
export const SKIN_FADE_IN_MS = 400
/** Exit hold: a finished think/tool block stays fully colored for 2s
 * (dock-visibility.ts, user directive). */
export const SKIN_HOLD_MS = DOCK_LINGER_MS
/** Exit fade sweep after the hold (2s + 300ms = the row's retention edge). */
export const SKIN_FADE_OUT_MS = DOCK_FADE_OUT_MS
/** Notice fade-out inside the LAST 500ms of the 8s TTL (remove moment unchanged). */
export const SKIN_NOTICE_FADE_MS = 500
/** Reminder pulse: 3 bright/dim cycles ≈ 1.2s, then静止 at full brightness. */
export const SKIN_PULSE_MS = 1200
export const SKIN_PULSE_CYCLES = 3
/** How dim the pulse dips (0 = off-black, 1 = full color). */
export const SKIN_PULSE_DIM = 0.45
/** How faint the entrance start is (mix toward the background). */
export const SKIN_FAINT_MIX = 0.78

/** Linear mix of two color inputs (hex/rgb string or RGBA) → hex string.
 * parseColor's channel getters are NORMALIZED floats (0-1) — scale back to
 * the 0-255 byte range here. */
export function mixSkinColor(a: string | RGBA, b: string | RGBA, t: number): string {
	const ca = parseColor(a)
	const cb = parseColor(b)
	const k = Math.max(0, Math.min(1, t))
	const ch = (x: number, y: number) => Math.round((x + (y - x) * k) * 255)
	return `#${[ch(ca.r, cb.r), ch(ca.g, cb.g), ch(ca.b, cb.b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

/** The "faint" start color: the target washed out toward the background. */
export function skinFaintColor(target: string | RGBA, background: string | RGBA): string {
	return mixSkinColor(target, background, SKIN_FAINT_MIX)
}

/** Entrance fade color: faint at 0ms → target at SKIN_FADE_IN_MS. */
export function skinFadeInColor(target: string | RGBA, background: string | RGBA, elapsedMs: number): string {
	return mixSkinColor(skinFaintColor(target, background), target, elapsedMs / SKIN_FADE_IN_MS)
}

/** Exit fade progress within the dock retention window: 0 during the 2s
 * linger, 0→1 across the 300ms sweep, 1 after (the row is hidden then). */
export function skinFadeOutProgress(elapsedSinceStopMs: number): number {
	if (elapsedSinceStopMs <= SKIN_HOLD_MS) return 0
	return Math.max(0, Math.min(1, (elapsedSinceStopMs - SKIN_HOLD_MS) / SKIN_FADE_OUT_MS))
}

/** Exit fade color: target during the hold, → background across the sweep. */
export function skinFadeOutColor(target: string | RGBA, background: string | RGBA, elapsedSinceStopMs: number): string {
	return mixSkinColor(target, background, skinFadeOutProgress(elapsedSinceStopMs))
}

/** TOOL-block line cap (pure), graded by terminal height. The gear NEVER
 * touches this — since 2026-11-19 the tool block is capped only here (3 lines
 * at normal terminals, graded down on short ones), not by
 * `session.activity_panel_height`. At 31-40 rows the worst case would be a
 * 3-tool-line frame, so those terminals keep the pre-2026-11 ONE-line
 * footprint; 41-50 rows afford two; only > 50 rows get the default three.
 * Think uses the separate gear-driven cap (`activityPanelCapSpec`). Unknown
 * height (undefined, e.g. a unit test with no geometry) keeps the full cap. */
export function dockLineCap(terminalRows?: number): number {
	if (terminalRows === undefined) return DOCK_WIDGET_MAX_LINES
	if (terminalRows <= 40) return DOCK_COMPACT_MAX_LINES
	if (terminalRows <= 50) return 2
	return DOCK_WIDGET_MAX_LINES
}

// --------------------------- U4 think display lines (gear) -------------------
// The /settings gear (config key UNCHANGED — `session.activity_panel_height`,
// no config migration) controls ONLY the think block's display line count
// (2026-11-19 user directive): 1 / 5 / 7 / 10 = think shows at most N lines.
// `all` is KEPT as a stored spelling for backward compatibility (no user config
// is migrated) but its semantics = 10 — under the 10-line panel ceiling it is
// identical to the `10` gear. The tool block NO LONGER consumes this gear:
// it uses the fixed `dockLineCap` (3 lines at normal terminals). The whole
// content area is hard-capped at MERGED_DOCK_TOTAL_LINES (10) lines; the old
// `all` "2/3 of terminal rows" growth rule and the halfBudget clamp are gone.
// ONLY /settings writes the key; the effect is live through this module signal
// (settings-row write flips it, boot replay restores it — no restart/keybind).

/** The five stored spellings. `all` is legacy-compatible, semantically 10. */
export const ACTIVITY_PANEL_GEARS = ["1", "5", "7", "10", "all"] as const
export type ActivityPanelGear = (typeof ACTIVITY_PANEL_GEARS)[number]

/** `all` is a legacy spelling; under the 10-line ceiling it equals the `10`
 * gear. A LITERAL (not `MERGED_DOCK_TOTAL_LINES`) on purpose: this module and
 * merged-dock.ts import each other, so a cross-module top-level initializer
 * would hit a TDZ ReferenceError when merged-dock is the first module loaded. */
export const ACTIVITY_PANEL_ALL_LINES = 10

/** The selected gear; undefined = unset → the graded `dockLineCap` default. */
export const [activityPanelGear, setActivityPanelGear] = createSignal<ActivityPanelGear | undefined>(undefined)

/** The stored `session.activity_panel_height` value: one of the five gear
 * spellings; anything else (typo, number, legacy value) → undefined → the
 * caller keeps the default (the lang validator's fail-open style). */
export function activityPanelHeightFromConfig(value: unknown): ActivityPanelGear | undefined {
	return typeof value === "string" && (ACTIVITY_PANEL_GEARS as readonly string[]).includes(value)
		? (value as ActivityPanelGear)
		: undefined
}

/**
 * Boot replay (/motion's resolveMotionPreference parity): apply the persisted
 * /settings gear onto the module signal BEFORE the first paint, so a restart
 * keeps the user's choice. Reads `session.activity_panel_height` from the
 * merged config snapshot; an invalid value is silently REJECTED (the default
 * sizing keeps running) — the applyHintsConfig/applyI18nConfig fail-open law:
 * replay runs before the first frame, and stderr noise there can corrupt the
 * raw-mode first paint. Missing/unreadable config is silent too. Never
 * throws.
 */
export function applyActivityPanelConfig(config?: Record<string, unknown>): void {
	try {
		const session = config?.session
		const stored =
			typeof session === "object" && session !== null ? (session as Record<string, unknown>).activity_panel_height : undefined
		if (stored === undefined || stored === null) return
		const gear = activityPanelHeightFromConfig(stored)
		if (gear !== undefined) setActivityPanelGear(gear)
	} catch {
		/* replay is best-effort: a bad config read keeps the default */
	}
}

/** The resolved THINK line cap for one gear + terminal height. No combined
 * budget field any more — the content area's 10-line hard cap lives in
 * `merged-dock.ts` (`assembleZones`), and the tool block has its own fixed
 * `dockLineCap`. */
export interface ActivityPanelCapSpec {
	/** Think block line cap (the ONLY thing the gear controls now). */
	maxLines: number
}

/**
 * Gear → THINK line cap (pure, 2026-11-19). Unset gear = the graded
 * `dockLineCap` default. A short terminal (≤ COMPOSER_COMPACT_TERMINAL_ROWS,
 * the two-row rule-bar contract) leaves the gear INERT — the degraded strip
 * wins at any value. Numeric gears cap THINK at N lines (clamped to the
 * 10-line content ceiling). `all` is a legacy spelling that means 10. The
 * former 2/3-of-rows growth rule and halfBudget clamp are REMOVED — the
 * content area is hard-capped at 10 lines regardless of terminal height.
 */
export function activityPanelCapSpec(gear: ActivityPanelGear | undefined, terminalRows?: number): ActivityPanelCapSpec {
	if (gear === undefined) return { maxLines: dockLineCap(terminalRows) }
	if (terminalRows !== undefined && terminalRows <= COMPOSER_COMPACT_TERMINAL_ROWS) {
		return { maxLines: dockLineCap(terminalRows) }
	}
	if (gear === "all") return { maxLines: ACTIVITY_PANEL_ALL_LINES }
	return { maxLines: Math.min(Number(gear), MERGED_DOCK_TOTAL_LINES) }
}

// --------------------------------- height tween (2026-11-19) ---------------
// The panel's content-line count changes as think/tool/todo/subagent appear
// and leave. To keep the composer from jumping, that count is interpolated
// over a SHORT, NON-RESIDENT tween on the shared animation clock (no timers).
// The interpolation is pure + integer-line (never a fractional row — the
// repo has a resident-animation-vs-diff-paint lost-line incident on record),
// and its terminal state is EXACT: at/after the duration the value is `to`,
// never `to-1`. If the shared clock gives no tick while idle, the terminal
// state is still correct on the NEXT render because the value is derived from
// the WALL CLOCK, not from accumulated tick deltas (terminal correctness
// beats animation completeness).

/** Tween length, in the requested 150-250ms band. */
export const DOCK_HEIGHT_ANIM_MS = 200

/** Ease-in-out (smoothstep), 0→1 over 0→1 input. Pure. */
export function dockHeightEase(t: number): number {
	const k = Math.max(0, Math.min(1, t))
	return k * k * (3 - 2 * k)
}

/** Integer-line interpolation of the panel's content-line count. `from`/`to`
 * are clamped to ≥ 0; the result is a whole number of lines so the diff-paint
 * never sees a fractional row. Terminal state (`elapsedMs >= durationMs`) is
 * EXACTLY `to`; `elapsedMs <= 0` is exactly `from`. */
export function dockHeightLines(from: number, to: number, elapsedMs: number, durationMs = DOCK_HEIGHT_ANIM_MS): number {
	const a = Math.max(0, Math.floor(from))
	const b = Math.max(0, Math.floor(to))
	if (elapsedMs <= 0) return a
	if (elapsedMs >= durationMs) return b
	return Math.max(0, Math.round(a + (b - a) * dockHeightEase(elapsedMs / durationMs)))
}

interface DockHeightTween {
	from: number
	to: number
	startedAt: number
}

/** MODULE-level tween (CLOSURE LAW: no component-scope signal closed over by
 * JSX props). `undefined` = settled, no animation in flight. */
const [dockHeightTween, setDockHeightTween] = createSignal<DockHeightTween | undefined>(undefined)
/** The last settled count — the tween's `from` when no tween is active.
 * `undefined` until the dock has rendered once: the FIRST appearance has no
 * previous height to animate from, so it snaps to its target (otherwise a
 * border-only box would sit on screen until a clock tick advanced the tween). */
let dockHeightSettled: number | undefined = undefined
/** The ONE wall clock a whole render pass derives its height count from.
 * `frameHeight()` and `<For each={frameLines()}>` are separate reactive getters;
 * if each called `Date.now()` itself, an ms boundary between them could paint
 * a box one row taller/shorter than its content. Only the tick / target-set
 * writers advance this value, so both getters in a pass read the SAME clock. */
let dockFrameNow = 0

/** Current content-line count to render for a freshly-computed `target`.
 * Reads the tween signal (so a clock tick re-renders the frame) but derives
 * the count from the WALL CLOCK, so a missed idle tick still yields the exact
 * terminal count on the next render. */
export function dockHeightContentLines(target: number, now: number = Date.now()): number {
	// No animation clock (tier off / reduced → "busy has no rate") means no
	// ticks would ever advance a tween. SNAP to the exact target instead of
	// leaving the frame stuck on its first interpolated row forever. This is
	// the "terminal correctness beats animation completeness" rule.
	if (!motionAnimationRunning()) return target
	const tween = dockHeightTween()
	if (tween === undefined) return target
	return dockHeightLines(tween.from, tween.to, now - tween.startedAt)
}

/** Push a new target content-line count. (Re)starts a short tween from the
 * currently displayed count; a no-op when the target is unchanged. The new
 * target always becomes `dockHeightSettled`, so even if the clock never ticks
 * the NEXT render shows the exact terminal value. */
export function setDockHeightTarget(target: number, now: number = Date.now()): void {
	dockFrameNow = now
	const to = Math.max(0, Math.min(MERGED_DOCK_TOTAL_LINES, Math.floor(target)))
	const current = untrack(dockHeightTween)
	if (current !== undefined) {
		if (current.to === to) return
		// The painted count is CAPPED at the in-flight target during a shrink
		// (frameLines: `min(target, tweened)`), so the screen already shows
		// `current.to`, not the raw curve value. Clamp `from` to that same
		// visible count: an interrupted 5→2 shrink retargeting to 6 at 100ms
		// would otherwise start from the curve's 4 and jump 2 lines.
		const from = Math.min(current.to, dockHeightLines(current.from, current.to, now - current.startedAt))
		// No visible previous content (or no clock) → snap. A 0-line "from"
		// would paint a border-only box until the first tick, which a fixture
		// waiting on the title captures as a lost content row.
		if (from === 0 || to === 0 || !motionAnimationRunning()) {
			setDockHeightTween(undefined)
			dockHeightSettled = to
			return
		}
		setDockHeightTween({ from, to, startedAt: now })
	} else {
		if (dockHeightSettled === to) return
		// First render / no prior visible content / no clock → snap (no
		// 0-line border-only frame). Only a real visible→visible change tweens.
		if (dockHeightSettled === undefined || dockHeightSettled === 0 || to === 0 || !motionAnimationRunning()) {
			dockHeightSettled = to
			return
		}
		setDockHeightTween({ from: dockHeightSettled, to, startedAt: now })
	}
	dockHeightSettled = to
}

/** True while a height tween is in flight (used to keep the shared clock
 * subscribed). */
export function dockHeightAnimating(): boolean {
	return dockHeightTween() !== undefined
}

/** Shared-clock tick: clear the tween at its exact terminal frame so the
 * clock unsubscribes (no residual animation). Idle/no-tick is fine — the
 * wall-clock accessor already reports the exact terminal count. */
export function tickDockHeight(now: number = Date.now()): void {
	dockFrameNow = now
	const current = untrack(dockHeightTween)
	if (current !== undefined && now - current.startedAt >= DOCK_HEIGHT_ANIM_MS) setDockHeightTween(undefined)
}

/** Session-switch hook: drop any in-flight tween and settle at `to`. */
export function resetDockHeight(to?: number): void {
	setDockHeightTween(undefined)
	// No arg (session switch / unmount) → forget the previous height so the
	// next mount snaps instead of tweening up from a stale count.
	dockHeightSettled = to === undefined ? undefined : Math.max(0, Math.min(MERGED_DOCK_TOTAL_LINES, Math.floor(to)))
}

/** Notice fade progress: 0 until the last SKIN_NOTICE_FADE_MS of the TTL,
 * then 0→1. The removal timer is untouched (H5/notifications). */
export function skinNoticeFadeProgress(elapsedMs: number, ttlMs: number): number {
	return Math.max(0, Math.min(1, (elapsedMs - (ttlMs - SKIN_NOTICE_FADE_MS)) / SKIN_NOTICE_FADE_MS))
}

/** Reminder pulse brightness (pure): SKIN_PULSE_CYCLES triangular dips over
 * SKIN_PULSE_MS (≈1.2s), then a constant 1 (bright,静止). 1 = full color. */
export function skinPulseBrightness(elapsedMs: number): number {
	if (elapsedMs >= SKIN_PULSE_MS || elapsedMs < 0) return 1
	const cycle = SKIN_PULSE_MS / SKIN_PULSE_CYCLES
	const phase = (elapsedMs % cycle) / cycle // 0..1 within the cycle
	return 1 - SKIN_PULSE_DIM * (1 - Math.abs(2 * phase - 1))
}

/** The stop anchor a view can compute WITHOUT touching the store: the row
 * froze elapsedSec at its stop, so stop ≈ startedAt + elapsedSec*1000 (H5).
 * undefined when either side is missing (replay rows) — no fade, solid color. */
export function skinStopAt(row: { startedAt?: number; elapsedSec?: number }): number | undefined {
	return row.startedAt !== undefined && row.elapsedSec !== undefined ? row.startedAt + row.elapsedSec * 1000 : undefined
}

/** Per-line entrance-fade registry (module level — CLOSURE LAW): first sight
 * timestamp per stable line id. Gated by motionDecorationsEnabled at the
 * call site; reduced/off simply read full color. P2-1 (review): capped FIFO
 * (long sessions must not grow it without bound) and `resetSkinLineFades`
 * on session switches — the stable "dock:todos" id must re-fade for a NEW
 * session's first todo line instead of keeping the old timestamp. */
const LINE_FIRST_SEEN_MAX = 512
const lineFirstSeen = new Map<string, number>()
export function skinLineFadeT(id: string, now: number = Date.now()): number {
	let seen = lineFirstSeen.get(id)
	if (seen === undefined) {
		seen = now
		if (lineFirstSeen.size >= LINE_FIRST_SEEN_MAX) {
			const oldest = lineFirstSeen.keys().next().value
			if (oldest !== undefined) lineFirstSeen.delete(oldest)
		}
		lineFirstSeen.set(id, seen)
	}
	return Math.max(0, Math.min(1, (now - seen) / SKIN_FADE_IN_MS))
}

/** Session switch hook: drop every first-sight timestamp so the next paint
 * re-runs the entrance fades (the v2 entry's clear/reload hooks call this —
 * /new, /fork, /resume, /clear). */
export function resetSkinLineFades(): void {
	lineFirstSeen.clear()
}

/** Component-side line color (shared by the docks, batch δ): the 2s-linger →
 * 300ms-sweep exit fade wins, then the entrance fade, else the plain target
 * color. `decorated: false` (reduced/off tier) jumps straight to the final
 * color — contract §1 动效档位; the line itself is hidden at the 2s deadline
 * by `dockLines`, so no gradient is ever painted. */
export type SkinFgContext = { decorated: boolean; background: string | RGBA }
export function skinDockLineFg(ctx: SkinFgContext, target: string | RGBA, line: { id?: string; fadeOutAt?: number }): string | RGBA {
	if (!ctx.decorated) return target
	if (line.fadeOutAt !== undefined) {
		const visibility = dockLineVisibility(line.fadeOutAt, Date.now(), ctx.decorated)
		if (visibility.phase === "fading") return mixSkinColor(target, ctx.background, visibility.progress)
		if (visibility.phase === "hidden") return ctx.background
	}
	const id = line.id
	if (id === undefined) return target
	const t = skinLineFadeT(id)
	return t >= 1 ? target : skinFadeInColor(target, ctx.background, t * SKIN_FADE_IN_MS)
}

/** Shared dock spinner tick — MODULE-level so no render closure owns it
 * (one interval per dock mount flips it; every line reads it lazily).
 * Batch D2: the lastRequest dock below the editor reads the SAME tick
 * (one interval owns the braille cadence for both docks). */
export const [dockSpin, setDockSpin] = createSignal(0)

/** Lower-zone scroll cursor — 0-based index of the first visible item.
 * MODULE-level per the CLOSURE LAW (dockSpin / activityFrameLatch / lineFirstSeen
 * precedent): the dock is a per-app singleton, so component scope would drop the
 * position on every mount. `mergedDockLines`/`assembleZones` clamp it against the
 * live content on EVERY build, so a shrinking todo list can never blank the
 * window. The wheel handler advances it; `resetMergedDockCursor` drops it on a
 * session switch so a stale position cannot leak across sessions. */
export const [mergedDockCursor, setMergedDockCursor] = createSignal(0)

/** Session-switch hook (mirrors `resetSkinLineFades`): the v2 entry's
 * clear/reload hooks call this so the old session's scroll position cannot
 * leak into the new one. */
export function resetMergedDockCursor(): void {
	setMergedDockCursor(0)
}

/** The todo array inside one todo-tool args/output value, or undefined when it
 * carries none. Two payload shapes: a bare array (the opencode output brief)
 * or `{ todos: [...] }` (the dsh host's todo_write call ARGUMENTS — its
 * tool/result wire carries only the rendered `Updated todo list: …` text,
 * never the array).
 *
 * Two CARRIER shapes too, one per seam boundary: the journal/`message.part`
 * seam hands the raw JSON STRING (`part.input`, a tool row's `args`), while a
 * live bridge frame hands the PARSED OBJECT (`turn.tool.input` after the host
 * arguments were JSON-parsed). Accept both so the array survives whichever
 * boundary delivered it — a string-only reader dropped the object form and
 * left `latestTodos` empty even though the row carried the full array. */
function todoArray(value: unknown): unknown[] | undefined {
	if (value === undefined || value === null) return undefined
	let parsed: unknown = value
	if (typeof value === "string") {
		if (value.trim() === "") return undefined
		try {
			parsed = JSON.parse(value) as unknown
		} catch {
			return undefined
		}
	}
	if (Array.isArray(parsed)) return parsed
	if (parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { todos?: unknown }).todos)) {
		return (parsed as { todos: unknown[] }).todos
	}
	return undefined
}

/** Max todo rows the table shows (dsh-tui-pi `TODO_MAX_ROWS`). Longer lists
 * window onto the active items: running first, then the queue, completed
 * last (newest-first inside the done group). */
export const TODO_MAX_ROWS = 5

/** Table cell separator (dsh-tui-pi `TABLE_SEP`). */
const TABLE_SEP = " │ "

/** Status icon of one todo (dsh-tui-pi `todoIcon`): pending / in-progress /
 * completed. `cancelled` (opencode-only) degrades to the pending box. */
export function todoIcon(status: string): string {
	if (status === "completed") return "☑"
	if (status === "in_progress") return "◐"
	return "☐"
}

/** Window priority (dsh-tui-pi `statusRank`). */
function statusRank(status: string): number {
	if (status === "in_progress") return 0
	if (status === "completed") return 2
	return 1
}

/** `[1,2,3,7,9]` → `1-3,7,9` (dsh-tui-pi `compactRanges`). */
function compactRanges(numbers: readonly number[]): string {
	if (numbers.length === 0) return ""
	const runs: string[] = []
	let start = numbers[0]!
	let prev = start
	for (const n of numbers.slice(1)) {
		if (n === prev + 1) {
			prev = n
			continue
		}
		runs.push(start === prev ? `${start}` : `${start}-${prev}`)
		start = prev = n
	}
	runs.push(start === prev ? `${start}` : `${start}-${prev}`)
	return runs.join(",")
}

/** Width-exact table cell (dsh-tui-pi `padCell`): flatten, clip with the
 * ellipsis, then pad to `width` columns. */
export function padCell(text: string, width: number, align: "left" | "right" = "left"): string {
	const flat = text.replace(/[\r\n]+/g, " ").trim()
	const clipped = clipToWidth(flat, width)
	const pad = Math.max(0, width - stringWidth(clipped))
	return align === "right" ? " ".repeat(pad) + clipped : clipped + " ".repeat(pad)
}

/** One bordered table row of exactly `boxWidth` columns. */
function borderedRow(boxWidth: number, inner: string): string {
	const pad = Math.max(0, boxWidth - 4 - stringWidth(inner))
	return `│ ${inner}${" ".repeat(pad)} │`
}

/** The todo list of the latest SETTLED, non-failed todo tool row (a rejected
 * call's args were never applied). The list comes from the call args (dsh
 * host shape) else the output brief (opencode shape). */
export function latestTodos(rows: readonly SeamRow[]): Todo[] {
	const todoTool = [...rows]
		.reverse()
		.find((row) => row.kind === "tool" && TODO_TOOL_NAMES.has(row.name) && row.output !== undefined && row.status !== "failed")
	if (todoTool?.kind !== "tool") return []
	const source = todoArray(todoTool.args) !== undefined ? todoTool.args : todoTool.output
	return parseTodos(todoArray(source) ?? [])
}

/** The one-line Todos summary (the pre-table form): `todos [✓]done/total`
 * plus ` · <active item>` while an item is in progress. No todos, or every
 * todo completed → '' (clear-when-done, same as the table). This is the
 * SHORT-TERMINAL form: the persistent table would spend 4 chrome rows + up
 * to TODO_MAX_ROWS entries of the 80x24 middle band, which only has 8 rows
 * (transcript floor 6 + activity rule 2) — one summary line keeps the
 * transcript contract intact while the todos stay visible. */
export function todosSummaryLine(rows: readonly SeamRow[]): string {
	return todosSummaryFromTodos(latestTodos(rows))
}

/** The scene-C todo line, from an already-extracted todo list (the merged
 * dock builds from `MergedDockData.todos`, not from raw rows). Same current
 * full format as `todosSummaryLine`: `todos [✓]done/total · <active item>`. */
export function todosSummaryFromTodos(todos: readonly Todo[]): string {
	if (todos.length === 0) return ""
	const done = todos.filter((todo) => todo.status === "completed").length
	if (done === todos.length) return ""
	const active = todos.find((todo) => todo.status === "in_progress")
	const head = t("overlay.widgets.todosSummary", { done, total: todos.length })
	return active ? `${head} · ${active.content}` : head
}

/** Scene-C todo tree (compact terminal): the `● Todos (d/n)` header plus one
 * `├─ {glyph} {content}` row per todo (`└─ ` on the last). Returned as lower-zone
 * lines so the merged dock gives them its 10-line hard cap + scroll window;
 * they are rebuilt from the same `MergedDockData.todos` as `todosSummaryFromTodos`.
 * Empty list OR every todo completed → zero lines (clear-when-done, same law as
 * the one-line summary). Status glyphs reuse `TODO_STATUS_GLYPHS`. */
export function todoTreeLines(todos: readonly Todo[]): MergedDockLine[] {
	if (todos.length === 0) return []
	const done = todos.filter((todo) => todo.status === "completed").length
	if (done === todos.length) return []
	const lines: MergedDockLine[] = [
		{ kind: "todo", segments: [{ text: t("overlay.widgets.todosHeader", { done, total: todos.length }), tone: "running" }] },
	]
	todos.forEach((todo, i) => {
		const branch = i === todos.length - 1 ? "└─ " : "├─ "
		const glyph = TODO_STATUS_GLYPHS[todo.status] ?? TODO_STATUS_GLYPHS.pending
		lines.push({ kind: "todo", segments: [{ text: `${branch}${glyph} ${todo.content}`, tone: "running" }] })
	})
	return lines
}

// ------------------------------------------- scene-A todo brief timing (指令4)
// `todo done/total Ns` — no current-task text. The duration is seconds since
// the CURRENT TASK SET was established: the moment the set of task TEXTS first
// appeared. Only texts are compared (a 1/3→2/3 status flip is NOT a new set),
// and they are sorted (reordering is NOT a new set). A different text set gets
// a fresh anchor ("换集重置"); within one set status flips do not reset.
// A single module-level map — text signature → first-seen wall clock — is the
// ONLY anchor source; there is no rows-based "earliest startedAt" primary and
// no array-change fallback. Module scope keeps the CLOSURE LAW; the map is
// cleared on session switch (`resetTodoBriefClock`, wired to the dock unmount
// cleanup), so a signature never leaks into a later session.

/** Text-only signature of a task set — status flips and ordering ignored. */
const todoSetSignature = (todos: readonly Todo[]): string => todos.map((todo) => todo.content).sort().join("\u0001")

/** Text signature → wall clock when that task set was FIRST seen this session. */
const todoSetFirstSeen = new Map<string, number>()

/** The current task set's establishment time: first-seen time of its text
 * signature. Pure apart from the module map (never component state). */
export function todoSetStartedAt(todos: readonly Todo[], now: number = Date.now()): number {
	const sig = todoSetSignature(todos)
	const first = todoSetFirstSeen.get(sig)
	if (first !== undefined) return first
	todoSetFirstSeen.set(sig, now)
	return now
}

/** The one-line scene-A todo brief: `todo done/total Ns`. An explicit
 * `startedAt` is a pure-caller/test seam; the dock leaves it unset so the
 * unified text-signature first-seen map above is the single production clock. */
export function todoBriefLine(todos: readonly Todo[], now: number = Date.now(), startedAt?: number): string {
	if (todos.length === 0) return ""
	const done = todos.filter((todo) => todo.status === "completed").length
	const anchor = startedAt ?? todoSetStartedAt(todos, now)
	const secs = Math.max(0, Math.floor((now - anchor) / 1000))
	return t("overlay.widgets.todosBrief", { done, total: todos.length, secs })
}

/** Session-switch hook: drop every first-seen anchor (no signature survives
 * into the next session). */
export function resetTodoBriefClock(): void {
	todoSetFirstSeen.clear()
}

/** The Todos table's box width for a `terminalColumns`-wide terminal.
 *
 * The dock slot is rendered with `paddingLeft=1` (the composer's left border
 * owns column 0), so the box starts at column 1 and must be `columns - 1`
 * wide for its right border to land on the composer's right border at column
 * `columns - 1` (0-based). dsh-tui-pi's `panelBoxWidth` is `columns - 2`
 * (a two-column right gutter when the panel renders at the full terminal
 * width); here the slot is indented one column and the composer is
 * full-bleed, so that arithmetic leaves the table's right edge one column
 * left of the input frame (the screenshot bug). */
export function todosTableWidth(terminalColumns: number): number {
	return Math.max(16, terminalColumns - 1)
}

/** The Todos table (pure, dsh-tui-pi `TodosPanel` parity): a bordered box
 * with the `● Todos (done/total)` header (plus a `· showing 4-8` range hint
 * when the 5-row window hides rows), the `# │ ✓ │ Task` table header and one
 * row per todo in plan order with GLOBAL numbers. No todos, or every todo
 * completed → zero rows (clear-when-done). `width` is the box's terminal
 * columns (box drawing included).
 *
 * Short terminals (`terminalRows` at or below the composer's compact
 * threshold — the coordinated lane, skin/semantic.ts) collapse the whole
 * box to the ONE-LINE `todosSummaryLine` instead. The bordered table's
 * worst case is 9 rows; the 80x24 middle band is only 8 rows for the
 * transcript (≥6) plus the activity rule (2), so the table must never
 * render there. `terminalRows` omitted = no terminal knowledge, keep the
 * table (pure callers/tests).
 *
 * Line granularity: the dock paints one <text> per table row, so each row
 * carries ONE tone — border/header rows are muted, a todo row takes its
 * status color (completed → ok, in-progress → running, pending → muted). */
export function todosTableLines(rows: readonly SeamRow[], width: number, terminalRows?: number): DockLine[] {
	const todos = latestTodos(rows)
	if (todos.length === 0 || todos.every((todo) => todo.status === "completed")) return []
	if (terminalRows !== undefined && terminalRows <= COMPOSER_COMPACT_TERMINAL_ROWS) {
		return [{ text: todosSummaryLine(rows), tone: "muted", id: "dock:todos" }]
	}
	const boxWidth = Math.max(16, width)
	const innerWidth = boxWidth - 4
	// Narrow-box guard (boxWidth < 23): the fixed columns + separators are
	// 5 + TABLE_SEP*2 = 11 inner columns, so the Task column must shrink below
	// 8 rather than push the row past the border (the old floor overflowed).
	const colWidths = [3, 2, Math.max(1, innerWidth - 5 - TABLE_SEP.length * 2)]
	const border = "─".repeat(Math.max(0, boxWidth - 2))

	// The visible window (dsh-tui-pi law): at most TODO_MAX_ROWS entries
	// ranked in_progress → pending → completed (done newest-first), displayed
	// back in plan order with their GLOBAL numbers.
	const window = todos
		.map((todo, index) => ({ todo, index }))
		.sort(
			(a, b) =>
				statusRank(a.todo.status) - statusRank(b.todo.status) ||
				(a.todo.status === "completed" ? b.index - a.index : a.index - b.index),
		)
		.slice(0, TODO_MAX_ROWS)
		.sort((a, b) => a.index - b.index)

	const done = todos.filter((todo) => todo.status === "completed").length
	const showing = window.length < todos.length ? ` · ${t("overlay.widgets.todosShowing", { ranges: compactRanges(window.map((entry) => entry.index + 1)) })}` : ""
	const header = clipToWidth(t("overlay.widgets.todosHeader", { done, total: todos.length }) + showing, innerWidth)
	const out: DockLine[] = [
		{ text: `┌${border}┐`, tone: "muted" },
		{ text: borderedRow(boxWidth, header), tone: "muted" },
		{
			text: borderedRow(
				boxWidth,
				[padCell("#", colWidths[0]!, "right"), padCell("✓", colWidths[1]!), padCell(t("overlay.widgets.taskColumn"), colWidths[2]!)].join(TABLE_SEP),
			),
			tone: "muted",
		},
	]
	for (const { todo, index } of window) {
		const cells = [
			padCell(String(index + 1), colWidths[0]!, "right"),
			padCell(todoIcon(todo.status), colWidths[1]!),
			padCell(todo.content, colWidths[2]!),
		].join(TABLE_SEP)
		const tone: DockLine["tone"] =
			todo.status === "completed" ? "ok" : todo.status === "in_progress" ? "running" : "muted"
		out.push({ text: borderedRow(boxWidth, cells), tone })
	}
	out.push({ text: `└${border}┘`, tone: "muted" })
	return out
}

/** Status glyph for a tool row: running ⚙, failed ✘, settled ✔. The icon
 * keeps its own semantic tone; the line text carries the tool accent. */
export function toolMarker(status: Extract<SeamRow, { kind: "tool" }>["status"]): string {
	return status === "running" ? "⚙" : status === "failed" ? "✘" : "✔"
}

/** One dock tool line (pure, dsh-tui-pi ToolPanel height '1' parity):
 * `<⚙|✔|✘> <name> <subject> · Xs · <tail>`. NOT the old `⠋ ⚙ name(subject)`
 * form: the status icon IS the marker, the subject follows the name with a
 * space, a running tool's tail is the arg summary, a settled one's the
 * result tail (the raw JSON never renders). `now` is injectable so the
 * elapsed column (and tests) do not depend on a real wall clock. */
export function toolLineText(row: Extract<SeamRow, { kind: "tool" }>, spin: () => number, now: number = Date.now()): string {
	const subject = toolSubject(row.args)
	const title = subject === "" ? row.name : `${row.name} ${subject}`
	const elapsed =
		row.status === "running"
			? row.startedAt !== undefined
				? ` · ${((now - row.startedAt) / 1000).toFixed(1)}s`
				: ""
			: row.elapsedSec !== undefined
				? ` · ${row.elapsedSec.toFixed(1)}s`
				: ""
	const marker = toolMarker(row.status)
	void spin()
	const tail = row.status === "running" ? toolDetail(row.args) : toolResultLine(row.output)
	const body = `${title}${elapsed}${tail !== "" ? ` · ${tail}` : ""}`
	return `${marker} ${body}`
}

/** Up to `maxLines` display lines for one think row (pure, testable).
 *
 * The block always shows the TAIL — the last N non-blank lines, the same law
 * tui-pi's ThinkPanel uses (`TAIL_LINES = 3`). Live AND collapsed keep the
 * same tail: collapsing only swaps the prefix (`💭 thinking · ` → `💭 thought · `)
 * so the block never jumps back to the head at the collapse instant. The
 * first displayed line carries the `💭 … · Xs · ` prefix; continuation lines
 * are indented 3 columns (the width of `💭 `) so they sit under the content.
 *
 * Rows without panel state (replay shapes) paint nothing. */
export function thinkBlockLines(
	row: Extract<SeamRow, { kind: "reasoning" }>,
	spin: () => number,
	maxLines: number = DOCK_WIDGET_MAX_LINES,
	now: number = Date.now(),
): string[] {
	const lines = row.text.replace(/\r/g, "").split("\n").filter((line) => line.trim() !== "")
	const n = Math.max(1, Math.floor(maxLines))
	if (row.streaming === true) {
		const secs = row.startedAt !== undefined ? `${((now - row.startedAt) / 1000).toFixed(1)}s` : "0.0s"
		void spin()
		const picked = lines.length === 0 ? [""] : lines.slice(-n)
		return picked.map((line, index) => (index === 0 ? t("overlay.widgets.thinkStreaming", { secs, line }) : `   ${line}`))
	}
	if (row.elapsedSec !== undefined) {
		const secs = `${row.elapsedSec.toFixed(1)}s`
		const picked = lines.length === 0 ? [""] : lines.slice(-n)
		return picked.map((line, index) => (index === 0 ? t("overlay.widgets.thinkCollapsed", { secs, line }) : `   ${line}`))
	}
	return []
}

/** The live think line (one line, pure): `💭 thinking · Xs · <tail>` while
 * streaming, `💭 thought · Xs · <first line>` once collapsed. Rows without
 * panel state (replay shapes) paint nothing. Kept as the single-line view
 * used by callers/tests that predate the 3-line block. */
export function thinkLineText(
	row: Extract<SeamRow, { kind: "reasoning" }>,
	spin: () => number,
	now: number = Date.now(),
): string | undefined {
	return thinkBlockLines(row, spin, 1, now)[0]
}

/** The 2026-11-19 rule table's three scenes. */
export type ActivityScene = "A" | "B" | "C"

/**
 * Pure scene decision (2026-11-19 rule table). PRIORITY = SUBAGENT ACTIVE >
 * THINK EXCLUSIVE: a RUNNING subagent opens scene A regardless of think; only
 * when there is none does a VISIBLE think (live OR inside its exit hold) open
 * scene B. Historical / non-running subagent rows never open A — per 指令3 a
 * leftover subagent row yields to an active think (scene B). No subagent and
 * no think → scene C.
 */
export function activityScene(hasRunningSubagent: boolean, hasVisibleThink: boolean): ActivityScene {
	if (hasRunningSubagent) return "A"
	return hasVisibleThink ? "B" : "C"
}

/** Whether a think row is "VISIBLE" in the scene-table sense: a live streaming
 * burst, OR a settled row that has not reached its retention edge (the 2s hold
 * plus, on decorated tiers, the 300ms fade tail — `dockLineVisibility` knows
 * the tier boundary). `undefined` row → false. */
export function thinkRowVisible(
	row: Extract<SeamRow, { kind: "reasoning" }> | undefined,
	now: number = Date.now(),
	decorated: boolean = motionDecorationsEnabled(),
): boolean {
	if (row === undefined) return false
	if (row.streaming === true) return true
	const stopAt = skinStopAt(row)
	return stopAt === undefined || dockLineVisibility(stopAt, now, decorated).phase !== "hidden"
}

/** The dock line set (pure): Think → Tool, one entry per visible panel line.
 * The Todos table is NOT part of it (tui-pi parity): it owns its own
 * multi-row block above the think/tool lines (see `todosTableLines`).
 * `tone` keys the status-color family (resolved at render). `id` is the
 * STABLE entrance-fade key (spinner glyphs churn the text — the id must
 * not); `fadeOutAt` anchors the exit fade (H5 view-side math). */
export type DockLine = {
	text: string
	tone: "ok" | "running" | "failed" | "muted"
	italic?: boolean
	id?: string
	fadeOutAt?: number
	/** Semantic line accent (think violet / tool cyan), painted on the line
	 * TEXT while the status marker keeps its `tone` color. A line without an
	 * accent paints entirely in its tone. */
	accent?: DockAccent
	/** Leading status glyph (⚙/✔/✘) inside `text`, painted with the tone
	 * color (running/success/failure semantics stay untouched). */
	marker?: string
	/** Offset of `marker` inside `text` (the compact rule form prefixes `┃ `). */
	markerAt?: number
}

/** The todo brief carrier: the opencode-side name is `todowrite`; the dsh
 * host registers `tool-todo` whose model-side call name (the one the seam
 * rows carry off the host stream events) is `todo_write`. Both spellings
 * are the same tool — the set stays EXACT so nothing else starting with
 * "todo" can hijack the panel. */
const TODO_TOOL_NAMES = new Set(["todowrite", "todo_write"])

/** Render options for the pure line builders. Defaults: wall clock and the
 * active motion tier. Tests pass a fake `now` and an explicit `decorated` tier.
 * The think cap is gear-driven; the tool cap (`maxLines`) is NOT. */
export type DockViewOptions = {
	now?: number
	decorated?: boolean
	/** TOOL-block line cap (3 default, 1 at compact terminals). Never the gear. */
	maxLines?: number
	/** THINK-block line cap (gear-driven). Defaults to `maxLines`. */
	thinkMaxLines?: number
	/** Optional combined think+tool budget. Kept as a generic pure utility;
	 * the view no longer feeds it (the 10-line cap lives in `merged-dock.ts`).
	 * When present the LONGER block sheds its oldest line first (a tie sheds
	 * think) until the sum fits. */
	totalMaxLines?: number
}

/** The dock's two widget blocks (pure): Think → Tool. The Todos table is NOT
 * part of it (tui-pi parity): it owns its own multi-row block above the
 * think/tool lines (see `todosTableLines`).
 *
 * Think: the newest LIVE burst wins; otherwise the newest collapsed summary
 * still inside its 2s linger. Up to `thinkMaxLines` lines, always the tail.
 *
 * Tool: live tool rows, chronological order, up to `maxLines` (the newest
 * `maxLines` survive the slice). A settled row is painted for 2s and then
 * fades (dock-visibility); a starting tool has already flagged the previous
 * settled rows `faded` in the store (clear old, show new). Running rows
 * always show. 2026-11-19 scene table: scene A (a running subagent) shrinks
 * both think and tool to ONE line; scene B (no running subagent + visible
 * think) HIDES tool entirely; scene C (neither) keeps the full `maxLines`.
 * The Todos table is not part of this block — the merged dock renders the
 * scene-A brief / scene-C summary above these lines.
 *
 * Clock law (M1): the entry reads the shared `dockSpin` signal
 * UNCONDITIONALLY. A collapsed/lingering/fading think block no longer reads
 * the spinner (the streaming branch is the only one that did), so without
 * this read the tick bumped a signal nobody tracked and a think-ONLY dock
 * painted no intermediate fade frames — it sat at full color until the
 * store dropped the row at 2.3s. The read makes every tick re-run the
 * builders, and the view re-derives `skinDockLineFg` from the new clock.
 *
 * `tone` keys the status-color family (resolved at render). `id` is the
 * STABLE entrance-fade key (spinner glyphs churn the text — the id must
 * not); `fadeOutAt` anchors the exit fade. */
export type DockBlocks = { think: DockLine[]; tool: DockLine[]; now: number; decorated: boolean }

export function dockBlocks(rows: readonly SeamRow[], options: DockViewOptions = {}): DockBlocks {
	// M1: unconditional clock consumption (see the Clock law above). Must stay
	// the FIRST reactive read so a think-only dock repaints on every tick.
	void dockSpin()
	const now = options.now ?? Date.now()
	const decorated = options.decorated ?? motionDecorationsEnabled()
	const maxLines = Math.max(1, Math.floor(options.maxLines ?? DOCK_WIDGET_MAX_LINES))
	const gearThinkMaxLines = Math.max(1, Math.floor(options.thinkMaxLines ?? maxLines))
	const think: DockLine[] = []
	const toolLines: DockLine[] = []

	// 2026-11-19 scene table. Only RUNNING subagents open scene A (a historical
	// subagents row yields to think per 指令3). The selected think row is, by
	// construction below, a VISIBLE one (live or inside its exit hold), so its
	// presence is the scene-B signal.
	const hasRunningSubagent = rows.some(
		(row) => row.kind === "subagents" && row.children.some((child) => child.status === "running"),
	)

	// Think panel: the live burst wins; else the newest collapsed summary
	// that has not reached the retention edge (hidden rows are not painted).
	const reasoning = rows.filter((row): row is Extract<SeamRow, { kind: "reasoning" }> => row.kind === "reasoning")
	const live = [...reasoning].reverse().find((row) => row.streaming === true)
	let thinkRow: Extract<SeamRow, { kind: "reasoning" }> | undefined = live
	if (thinkRow === undefined) {
		for (let i = reasoning.length - 1; i >= 0; i--) {
			const candidate = reasoning[i]!
			if (candidate.elapsedSec === undefined) continue
			const stopAt = skinStopAt(candidate)
			if (stopAt === undefined || dockLineVisibility(stopAt, now, decorated).phase !== "hidden") {
				thinkRow = candidate
				break
			}
		}
	}
	// The selected row is visible by construction; its presence is the scene-B
	// signal. Scene A forces a 1-line think regardless of gear.
	const scene = activityScene(hasRunningSubagent, thinkRow !== undefined)
	const effectiveThinkMax = scene === "A" ? 1 : gearThinkMaxLines
	if (thinkRow !== undefined) {
		const stopAt = skinStopAt(thinkRow)
		// M2 (view side): a LIVE row carries no exit anchor, even when the row
		// still has a stale `elapsedSec` from the segment that collapsed before
		// this burst resumed (the store clears it on the upsert too — belt and
		// braces: an old anchor would paint the fresh burst in background).
		const fadeOutAt = thinkRow.streaming === true ? undefined : stopAt
		for (const text of thinkBlockLines(thinkRow, dockSpin, effectiveThinkMax, now)) {
			think.push({
				text,
				tone: "running",
				italic: true,
				accent: "think",
				id: `dock:think:${thinkRow.key}`,
				fadeOutAt,
			})
		}
	}

	// 2026-11-19 scene table: scene B hides tool entirely; scene A caps it to
	// ONE line; scene C uses the full (fixed, never gear-driven) `maxLines`.
	const toolMax = scene === "B" ? 0 : scene === "A" ? 1 : maxLines
	const tools =
		toolMax === 0
			? []
			: rows.filter(
					(row): row is Extract<SeamRow, { kind: "tool" }> => row.kind === "tool" && row.key.startsWith("tool:live:"),
				)
	// Tool panel: one line per live tool row, keyed in-place updates.
	const visible = tools.filter((row) => {
		// The store's `faded` flag is the hard clear (turn-end stragglers and
		// cleared-at-new-tool rows); running tools always show.
		if (row.faded === true && row.status !== "running") return false
		if (row.status === "running") return true
		const stopAt = skinStopAt(row)
		return stopAt === undefined || dockLineVisibility(stopAt, now, decorated).phase !== "hidden"
	})
	for (const row of visible.slice(-toolMax)) {
		toolLines.push({
			text: toolLineText(row, dockSpin, now),
			tone: row.status === "running" ? "running" : row.status === "failed" ? "failed" : "ok",
			accent: "tool",
			marker: toolMarker(row.status),
			id: `dock:tool:${row.key}`,
			fadeOutAt: row.status !== "running" ? skinStopAt(row) : undefined,
		})
	}
	// U4 panelHeight `all` gear: the combined think+tool budget. Think and
	// tool stay independent builders; only the SUM is clamped here, shedding
	// the oldest (front) line of the currently LONGER block first — a tie
	// sheds think — so neither block can starve the other below half.
	const totalCap = options.totalMaxLines !== undefined ? Math.max(1, Math.floor(options.totalMaxLines)) : undefined
	if (totalCap !== undefined) {
		while (think.length + toolLines.length > totalCap && think.length + toolLines.length > 0) {
			const longer = think.length >= toolLines.length ? think : toolLines
			if (longer.length === 0) break
			longer.shift()
		}
	}
	return { think, tool: toolLines, now, decorated }
}

/** The flat line set (pure): Think block → Tool block. */
export function dockLines(rows: readonly SeamRow[], options: DockViewOptions = {}): DockLine[] {
	const blocks = dockBlocks(rows, options)
	return [...blocks.think, ...blocks.tool]
}

/** Turn activity, derived (pure): any live tool, a streaming think burst, an
 * unfinished assistant body, or a running subagent child means a turn is in
 * flight. The frame prop (`turnActive`) wins when the host provides it. */
export function dockTurnActive(rows: readonly SeamRow[]): boolean {
	return rows.some(
		(row) =>
			(row.kind === "tool" && row.status === "running") ||
			(row.kind === "reasoning" && row.streaming === true) ||
			(row.kind === "assistant" && row.final === false) ||
			(row.kind === "subagents" && row.children.some((child) => child.status === "running")),
	)
}

/** The turn-lifetime activity frame content (pure): the SAME two blocks as
 * the flat dock — thinking / tool slots (skin contract §1 活动区). Think uses
 * the gear-driven `thinkMaxLines`, tool the fixed `maxLines` (3 default, 1 at
 * compact terminals); empty slots left blank. 2026-11-19 scene table applies
 * (A = one line each, B = think-only, C = tool-only); the old "independent
 * anchors — never feed each other" law is superseded. The Todos table moved
 * OUT of the frame to the widgets slot's own block (dsh-tui-pi parity: the
 * table is persistent, not turn-lifetime). */
export function activityBlocks(rows: readonly SeamRow[], options: DockViewOptions = {}): DockBlocks {
	return dockBlocks(rows, options)
}

/** Compact-terminal form (contract 矮终端): the frame collapses to a left
 * rule with the title written into the first line (H2 mitigation), still
 * exactly two rows — compact terminals cap each block at ONE line, so the
 * rule never grows. The think slot keeps its TEXT here — the live burst is
 * the point of the panel, so dropping it for the bare `┃ activity` title
 * (the pre-fix bug) hid the reasoning content whenever the frame mode
 * flipped to the rule. */
export function activityRuleLines(rows: readonly SeamRow[], options: DockViewOptions = {}): [DockLine, DockLine] {
	const blocks = activityBlocks(rows, { ...options, maxLines: Math.min(options.maxLines ?? DOCK_COMPACT_MAX_LINES, DOCK_COMPACT_MAX_LINES) })
	const think = blocks.think[0] ?? { text: "", tone: "muted" }
	const tool = blocks.tool[0] ?? { text: "", tone: "muted" }
	const head = think.text === "" ? t("overlay.widgets.activityTitle") : t("overlay.widgets.activityWithThink", { text: think.text })
	return [
		{ ...think, text: head, id: "dock:activity-head" },
		{ ...tool, text: tool.text === "" ? "" : `┃ ${tool.text}`, markerAt: (tool.markerAt ?? 0) + 2 },
	]
}

/** Frame vs left rule (pure): at or below the composer's compact threshold
 * the activity frame drops its border box (skin/semantic.ts owns the
 * threshold — the two lanes stay coordinated). */
export function activityFrameMode(terminalRows: number, compactRows: number = COMPOSER_COMPACT_TERMINAL_ROWS): "frame" | "rule" {
	return terminalRows <= compactRows ? "rule" : "frame"
}

/** No-provider fallback for the active frame border (bright blue, not the
 * dark unfocused border.base). #7aa2f7 on dsh-blue dark background
 * (#0a0a0f) is 7.5:1. */
export const ACTIVITY_FRAME_BORDER_FALLBACK = "#7aa2f7"

/** Minimum contrast the active border must clear against the working
 * background. The frame only exists while a turn runs, so it is the reader's
 * "something is happening" cue; the user asked for it to be clearly visible,
 * which raises the old 4.5:1 floor to 6:1. */
export const ACTIVITY_FRAME_MIN_CONTRAST = 6

/** Bright blue steps in preference order for the blue hue family: blue[200]
 * is the "bright blue" step of the dark dsh-blue scale (#8599ff, 7.5:1 on
 * #0a0a0f); 100/300 are the nearest neighbours. 100 is lighter, but on dark
 * surfaces it starts to wash out toward white, so 200 leads. */
const ACTIVITY_BLUE_STEPS = [200, 100, 300, 400, 500, 600, 700] as const

/**
 * The blue hue window in degrees. Blue sits around 227-231° in the dsh-blue
 * scale; the 190° floor keeps cyan (~187°) out of the family, the 250° cap
 * keeps purple (~262°) out. The resolved theme carries no categorical hue
 * NAMES (resolve.ts maps them to scales and drops the labels), so the family
 * is identified by COLOR; a name-priority path is impossible at this layer.
 * The saturation floor rejects near-gray swatches whose numeric hue lands in
 * range but which are not visually blue.
 */
const BLUE_HUE_MIN = 190
const BLUE_HUE_MAX = 250
const BLUE_MIN_SATURATION = 0.25

/** The two contrast poles the fill walk can blend toward. */
const AUTO_POLE_LIGHT = "#ffffff"
const AUTO_POLE_DARK = "#000000"

/** True when a swatch reads blue — hue angle inside the blue window, with a
 * saturation floor so near-gray swatches whose numeric hue happens to land in
 * range are rejected. */
function looksBlue(color: RGBA): boolean {
	const [r, g, b] = colorRgb(color)
	const max = Math.max(r, g, b)
	const delta = max - Math.min(r, g, b)
	if (max === 0 || delta / max < BLUE_MIN_SATURATION) return false
	const hue = hueAngle(color)
	return hue >= BLUE_HUE_MIN && hue <= BLUE_HUE_MAX
}

/** Blue steps of a hue scale in preference order, skipping missing steps. */
function blueCandidates(scale: HueScale | undefined): RGBA[] {
	if (!scale) return []
	return ACTIVITY_BLUE_STEPS.map((step) => scale[step]).filter((value): value is RGBA => value !== undefined)
}

/**
 * Pick the readable blue from a scale's steps: the preferred bright step when
 * it already clears the surface, else the most readable step; a surface no
 * stock step clears walks the fill AWAY from itself (toward white on dark,
 * toward black on light) until the 6:1 border contract holds.
 */
function readableBlue(candidates: RGBA[], background?: PowerlineColor): string | RGBA | undefined {
	if (candidates.length === 0) return undefined
	const preferred = candidates[0]!
	if (!background) return preferred
	if (contrastRatio(preferred, background) >= ACTIVITY_FRAME_MIN_CONTRAST) return preferred
	const best = candidates.reduce((a, b) => (contrastRatio(b, background) > contrastRatio(a, background) ? b : a))
	if (contrastRatio(best, background) >= ACTIVITY_FRAME_MIN_CONTRAST) return best
	return boostUntilContrast(best, background, ACTIVITY_FRAME_MIN_CONTRAST).color
}

/** HSL hue angle in degrees (0..360); achromatic swatches answer 0. */
export function hueAngle(color: PowerlineColor): number {
	const [r, g, b] = colorRgb(color)
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const delta = max - min
	if (delta === 0) return 0
	const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
	return (raw * 60 + 360) % 360
}

/**
 * Contrast-adjusted fill: the walked color, its measured contrast against the
 * surface, and whether it cleared `min` (the assertion result, so callers and
 * tests can verify the contract instead of trusting the loop).
 */
export interface ContrastAdjusted {
	color: string
	contrast: number
	meetsContrast: boolean
}

/**
 * Walk a fill AWAY from the surface until its contrast clears `min`
 * (default 4.5:1): on a dark surface blend toward WHITE, on a light surface
 * toward BLACK — the pole that maximizes contrast against the background.
 * (The old one-way blend toward black made dark-surface borders muddier the
 * harder it tried.) 8% steps, at most 32. The final contrast is RE-MEASURED
 * after the walk and returned as `meetsContrast`; a mid-luminance surface
 * where neither pole reaches `min` reports false with the best effort.
 */
export function boostUntilContrast(
	color: PowerlineColor,
	background: PowerlineColor,
	min = 4.5,
): ContrastAdjusted {
	let candidate = typeof color === "string" ? color : mixPowerlineColor(color, "#000000", 0)
	const pole =
		contrastRatio(background, AUTO_POLE_LIGHT) >= contrastRatio(background, AUTO_POLE_DARK)
			? AUTO_POLE_LIGHT
			: AUTO_POLE_DARK
	for (let i = 0; i < 32 && contrastRatio(candidate, background) < min; i++) {
		candidate = mixPowerlineColor(candidate, pole, 0.08)
	}
	const contrast = contrastRatio(candidate, background)
	return { color: candidate, contrast, meetsContrast: contrast >= min }
}

/**
 * Turn-lifetime activity frame border (user feedback): the frame only exists
 * WHILE a turn is in flight, so its border is always the ACTIVE state — a
 * BRIGHT BLUE instead of the dark border.base (latest directive: blue, bright
 * enough to stand out against the dark surface and stay distinct from the
 * footer's deep→light blue ramp). The blue hue family comes from the theme's
 * categorical scales (blue[200] on dsh-blue dark = #8599ff, 7.5:1 against the
 * #0a0a0f background), falling back to the semantic interactive ramp while it
 * is blue, then to the action primary text token; a surface no stock step
 * clears walks the fill AWAY from itself (toward white on dark, toward black
 * on light) until the border still clears 6:1. Static per the contract:
 * border color/weight never animate; the heavy line is chosen at render.
 */
export function activityFrameBorderColor(theme?: ComponentTheme): string | RGBA {
	const background = theme?.background?.base
	const blueScale = (theme?.categorical ?? []).find((scale) => {
		const swatch = scale[500] ?? scale[400] ?? scale[300]
		return swatch !== undefined && looksBlue(swatch)
	})
	const fromCategorical = readableBlue(blueCandidates(blueScale), background)
	if (fromCategorical) return fromCategorical
	// No categorical blue: the semantic interactive ramp is blue in the stock
	// themes, so keep the frame blue when it still reads blue.
	const interactive = theme?.hue?.interactive
	const interactiveSwatch = interactive?.[500] ?? interactive?.[400] ?? interactive?.[300]
	if (interactiveSwatch && looksBlue(interactiveSwatch)) {
		const fromInteractive = readableBlue(blueCandidates(interactive), background)
		if (fromInteractive) return fromInteractive
	}
	const action = theme?.text?.action?.primary?.base
	if (action) {
		if (!background || contrastRatio(action, background) >= ACTIVITY_FRAME_MIN_CONTRAST) return action
		return boostUntilContrast(action, background, ACTIVITY_FRAME_MIN_CONTRAST).color
	}
	return ACTIVITY_FRAME_BORDER_FALLBACK
}

/**
 * Semantic dock line accents (think / tool) — the two activity lines get
 * their own color families so they read as panels, not as default body copy:
 *   - think: VIOLET (`purple` ramp; dsh-tui-pi's `thinking` text token),
 *   - tool:  CYAN/TEAL (`cyan` ramp; dsh-tui-pi's blue tool panel family but
 *     shifted off the footer blue so it never reads as chrome).
 * Both are picked from the theme's named hue ramps, preferring a soft mid
 * step and walking the ramp until the text clears 4.5:1 on the theme
 * surface (dark: later steps are dimmer; light: later steps are lighter).
 * Status glyphs (⚙/✔/✘) never use this — they keep their tone color.
 */
export type DockAccent = "think" | "tool"

/** Preferred steps: a soft mid swatch first, then the rest of the ramp. */
const DOCK_ACCENT_STEPS: Record<DockAccent, readonly number[]> = {
	think: [200, 300, 100, 400, 500, 600, 700, 800, 900],
	tool: [300, 200, 100, 400, 500, 600, 700, 800, 900],
}

/** Fallback hue ramps when the theme carries no named hue record: violet →
 * accent (think), teal → interactive (tool). */
const DOCK_ACCENT_HUES: Record<DockAccent, readonly string[]> = {
	think: ["purple", "violet", "accent"],
	tool: ["cyan", "teal", "interactive"],
}

/** No-theme fallbacks per surface polarity (dsh-blue dark indices). */
const DOCK_ACCENT_FALLBACK: Record<DockAccent, { dark: string; light: string }> = {
	think: { dark: "#9d7cd8", light: "#6d47ad" },
	tool: { dark: "#449da7", light: "#077786" },
}

type HueRamp = Readonly<Record<number, RGBA | undefined>>

export function dockAccentColor(theme: ComponentTheme | undefined, accent: DockAccent): string | RGBA {
	const background = theme?.background?.base
	const hues = theme?.hue as unknown as Readonly<Record<string, HueRamp | undefined>> | undefined
	for (const name of DOCK_ACCENT_HUES[accent]) {
		const ramp = hues?.[name]
		if (ramp === undefined) continue
		const candidates = DOCK_ACCENT_STEPS[accent]
			.map((step) => ramp[step])
			.filter((value): value is RGBA => value !== undefined)
		if (candidates.length === 0) continue
		if (background === undefined) return candidates[0]!
		const preferred = candidates.find((value) => contrastRatio(value, background) >= 4.5)
		if (preferred !== undefined) return preferred
		// No stock step clears the floor (custom surface): return the most
		// readable step rather than an unreadable stock one.
		return candidates.reduce((a, b) => (contrastRatio(b, background) > contrastRatio(a, background) ? b : a))
	}
	const fallback = DOCK_ACCENT_FALLBACK[accent]
	const darkSurface = background === undefined || relativeLuminance(background) < 0.5
	return darkSurface ? fallback.dark : fallback.light
}

/** Whether the dock needs the shared animation clock right now (pure):
 * any visible line (entrance fades / exit sweep) or a live child tree in
 * the lastRequest dock (which reads this module's dockSpin). The line read
 * is UNTRACKED: `dockBlocks` consumes `dockSpin` unconditionally (M1), and
 * the fps accessor that calls this is a reactive effect — tracking the tick
 * there would re-register the renderer ticker on every bump. */
export function dockNeedsClock(rows: readonly SeamRow[]): boolean {
	if (untrack(() => dockLines(rows)).length > 0) return true
	return rows.some((row) => row.kind === "subagents" && row.children.some((child) => child.status === "running"))
}

// ---------------------------------------------------------------------------
// Flicker mitigation 1 (research/skin-flicker-analysis.md 缓解 1): the
// turn-lifetime activity frame MOUNT and UNMOUNT are each deferred one
// render tick (ACTIVITY_FRAME_DEFER_MS) so neither ever lands on the same
// frame as the turn-start reflow (transcript scroll + composer busy flip)
// or the turn-end reflow — the engine's diff-paint misses the frame border
// when all three coincide, leaving a 1-frame ghost (`┌─activity` remnant)
// that self-heals a frame later. Pure latch machine + module-level instance
// (dockSpin law: no component-scope reactive state closed over by JSX
// props). One-shot timers only (contract §2.2: no setInterval), disposed
// with the dock.
// ---------------------------------------------------------------------------

/** Defer window ≈ one render tick of reflow settling (analysis band
 * 50-100ms). */
export const ACTIVITY_FRAME_DEFER_MS = 60

/** Latch state: `shown` is what the JSX renders; `pending` is the deferred
 * op sitting on the one-shot timer. */
export interface FrameLatch {
	shown: boolean
	pending: "show" | "hide" | undefined
}

/** Pure transition: apply a new turn-liveness reading. Steady → unchanged.
 * A flip schedules the deferred op (caller arms the timer). A flip that
 * CONTRADICTS a pending op cancels it — a turn that ends within the window
 * of its own start never mounts the frame, and one that resumes within the
 * end window never flickers off. */
export function frameLatchNext(latch: FrameLatch, target: boolean): { latch: FrameLatch; schedule: boolean } {
	if (target === latch.shown) {
		if (latch.pending === undefined) return { latch, schedule: false }
		return { latch: { shown: latch.shown, pending: undefined }, schedule: false }
	}
	return { latch: { shown: latch.shown, pending: target ? "show" : "hide" }, schedule: true }
}

/** Pure timer-fire: commit the pending op (no-op when nothing is pending). */
export function frameLatchFire(latch: FrameLatch): FrameLatch {
	if (latch.pending === "show") return { shown: true, pending: undefined }
	if (latch.pending === "hide") return { shown: false, pending: undefined }
	return latch
}

/** Latch owner: the reactive signal lives here (module scope, like
 * `dockSpin`), the one-shot timer is cleared on every push and on dispose. */
export function createFrameLatch(ms: number = ACTIVITY_FRAME_DEFER_MS) {
	const [latch, setLatch] = createSignal<FrameLatch>({ shown: false, pending: undefined })
	let timer: ReturnType<typeof setTimeout> | undefined
	const clear = (): void => {
		if (timer !== undefined) {
			clearTimeout(timer)
			timer = undefined
		}
	}
	return {
		/** Deferred turn-liveness accessor for the JSX `Show`. */
		shown: (): boolean => latch().shown,
		/** Feed a turn-liveness reading (an effect in the dock body).
		 * FIX (feedback-loop): the latch read here MUST be untracked. The dock
		 * wires `createEffect(() => activityFrameLatch.push(turnActive()))` —
		 * a tracked read of `latch()` inside push makes that effect subscribe
		 * to the very signal push WRITES, and `frameLatchNext` returns a fresh
		 * object on every flip, so Object.is always reports a change: the
		 * effect re-fires synchronously, re-clears the just-armed timer and
		 * re-arms it — infinite recursion (stack overflow in bare solid;
		 * inside the app the render layer swallows it, the latch never leaves
		 * `pending`, and the activity frame NEVER mounts). `untrack` keeps the
		 * effect subscribed to turn-liveness only; the JSX `Show` still reads
		 * `shown()` tracked, so deferred mount/unmount stay reactive. */
		push: (target: boolean): void => {
			const next = frameLatchNext(untrack(latch), target)
			clear()
			setLatch(next.latch)
			if (next.schedule) timer = setTimeout(() => {
				timer = undefined
				setLatch(frameLatchFire(untrack(latch)))
			}, ms)
		},
		/** Unmount cleanup (contract §2.2: one-shot timers die with the owner). */
		dispose: clear,
	}
}

/** MODULE-level latch — the dock is a per-app singleton and module scope is
 * the CLOSURE-LAW-safe home (dockSpin precedent). */
export const activityFrameLatch = createFrameLatch()

// ---------------------------------------------------------------------------
// Merged activity widget — pure data extraction (spec D1/D4/D10/D11).
// ---------------------------------------------------------------------------

/** Visible LIVE tool rows, with the same store-visibility law as `dockBlocks`
 * (a `faded` settled row hides; a running row always shows). Kept as raw rows
 * because `mergedDockLines` rebuilds the trimmed/full tool text itself. */
export function mergedToolRows(rows: readonly SeamRow[], now: number, decorated: boolean): MergedToolRow[] {
	return rows.filter((row): row is MergedToolRow => row.kind === "tool" && row.key.startsWith("tool:live:")).filter((row) => {
		if (row.faded === true && row.status !== "running") return false
		if (row.status === "running") return true
		const stopAt = skinStopAt(row)
		return stopAt === undefined || dockLineVisibility(stopAt, now, decorated).phase !== "hidden"
	})
}

/** Visible think rows, with the SAME store-visibility law as `mergedToolRows`
 * (D3/D14): a live streaming burst always shows; a collapsed summary hides
 * once `dockLineVisibility` reaches `hidden`. The store's retention timer is
 * only a backstop — it kept the row 2.3s under `full`, so a mid-linger switch
 * to `reduced`/`off` (decorations off → hidden at the 2.0s edge) must be
 * enforced here too, else the row stays fully colored through 2.0-2.3s. */
export function mergedThinkRows(rows: readonly SeamRow[], now: number, decorated: boolean): MergedThinkRow[] {
	return rows
		.filter((row): row is MergedThinkRow => row.kind === "reasoning")
		.filter((row) => {
			if (row.streaming === true) return true // live burst, no exit anchor (M2)
			const stopAt = skinStopAt(row)
			return stopAt === undefined || dockLineVisibility(stopAt, now, decorated).phase !== "hidden"
		})
}

/** Running subagents from the live `subagents` seam row (D15 / D7 source). */
export function mergedRunningAgents(rows: readonly SeamRow[]): SeamSubagentView[] {
	const tree = [...rows].reverse().find((row) => row.kind === "subagents")
	return tree?.kind === "subagents" ? tree.children.filter((child) => child.status === "running") : []
}

/** Lower-zone presence (D10): an `in_progress` todo OR a running subagent.
 * This is the latch's extra liveness beyond the turn — decouples the lower
 * zone from the turn lifecycle without touching `dockTurnActive`. */
export function mergedLowerHasContent(rows: readonly SeamRow[]): boolean {
	return latestTodos(rows).some((todo) => todo.status === "in_progress") || mergedRunningAgents(rows).length > 0
}

/** The compact-terminal lower-zone summary (D11): reuse `todosSummaryLine`
 * verbatim — the single line the old short-terminal Todos table collapsed to.
 * Kept as the HONEST degradation for a tree that cannot fit the middle band
 * (very narrow terminals / very long lists); the normal compact path renders
 * the tree via `mergedCompactLowerLines`. */
export function mergedCompactSummary(rows: readonly SeamRow[]): string {
	return todosSummaryLine(rows)
}

/** Max tree rows the compact (≤ COMPOSER_COMPACT_TERMINAL_ROWS) lower zone can
 * show before it degrades to the single-line summary. A 3-item tree is 4 rows
 * (header + 3); 8 leaves room for the 2 rule rows + the transcript floor on an
 * 80x24 / 120x29 terminal. Beyond that the summary is the only honest form. */
export const COMPACT_TREE_MAX_LINES = 8

/** Compact-terminal lower zone: the SAME todo tree the framed scene C shows,
 * fed by the same `latestTodos`. Previously this branch alone still painted
 * the old `todos [✓]d/n · active` summary — so a turn that settled with an
 * in_progress todo (the state the user actually sits in) kept the summary on
 * any terminal ≤ 30 rows while tall terminals got the tree. Now both modes
 * render the tree; only an over-budget tree degrades to the summary line. */
export function mergedCompactLowerLines(rows: readonly SeamRow[]): MergedDockLine[] {
	const tree = todoTreeLines(latestTodos(rows))
	if (tree.length === 0) return []
	if (tree.length > COMPACT_TREE_MAX_LINES) {
		const summary = mergedCompactSummary(rows)
		return summary === "" ? [] : [{ kind: "todo", segments: [{ text: summary, tone: "muted" }] }]
	}
	return tree
}

/** The dock. Mounted by the v2-entry page as the transcript's `widgets`
 * slot — directly above the composer (the editor).
 *
 * Skin (batch δ): the turn-lifetime activity frame (contract §1 活动区) —
 * `turnActive` (optional accessor prop, host wiring) wins; without it the
 * turn is derived from the rows (dockTurnActive). The frame's mount and
 * unmount are each DEFERRED one render tick (flicker mitigation 1,
 * `activityFrameLatch` below the clock helpers) so they never share a frame
 * with the turn-boundary reflows. Inside the frame each widget block paints
 * up to the geometry's line cap (dockLineCap: 1 at ≤ 40 rows, 2 at 41-50,
 * 3 above; short terminals ≤ COMPOSER_COMPACT_TERMINAL_ROWS also drop the
 * box for a left rule with the title in the first line (H2)). Line entrance
 * fade 0.4s and the 2s-linger → 300ms-sweep exit fade both ride the shared
 * motion clock — no timers are added (contract §2.2; reduced/off have no
 * gradient, and their hard removal coincides with the 2.0s linger edge). */
export function WidgetsDock(props: {
	/** The shared seam-rows store (getter-prop law: the page passes
	 * `{ get rows() { return projection.rows } }` — the STORE ARRAY itself,
	 * reactive through its proxy reads). */
	rows: readonly SeamRow[]
	/** Turn-lifetime override (δ): accessor answering "is a turn in flight".
	 * True for the whole turn — the activity frame shows from turn start to
	 * turn end (NOT per visible line, so a 0↔1 line flip never flickers the
	 * frame, H2). Omitted → derived from the rows (dockTurnActive). */
	turnActive?: () => boolean
}): JSX.Element {
	const dimensions = useTerminalSize()
	const theme = useThemeOptional()
	const fgFor = (tone: DockLine["tone"]): string | RGBA =>
		tone === "running"
			? (theme?.text.feedback.warning.base ?? "#e0af68")
			: tone === "failed"
				? (theme?.text.feedback.error.base ?? "#f7768e")
				: tone === "ok"
					? (theme?.text.feedback.success.base ?? "#9ece6a")
					: (theme?.text.muted ?? "#9aa5ce")
	const bg = () => theme?.background.base ?? "#000000"
	const skinCtx = () => ({ decorated: motionDecorationsEnabled(), background: bg() })
	// Shared animation clock (contract §2.2 — no setInterval). The rate is
	// undefined when NOTHING needs it (tier off / idle with no live lines and
	// no tween in flight) — "busy only has a rate". While the height tween is
	// in flight the clock is subscribed so the frame repaints at integer-line
	// steps; if idle gives no tick the wall-clock accessor still yields the
	// exact terminal count on the next render (terminal correctness wins).
	onAnimationTick(
		() => {
			if (!motionAnimationRunning()) return undefined
			if (untrack(dockHeightAnimating)) return motionFrameRate()
			return dockNeedsClock(props.rows) ? motionFrameRate() : undefined
		},
		() => {
			// Advance the shared pass clock BEFORE bumping `dockSpin`: the tick's
			// wall clock must be visible to every getter in the re-render it
			// triggers, so height and painted rows read one and the same `now`.
			tickDockHeight()
			setDockSpin((s) => s + 1)
		},
	)
	const width = () => Math.max(16, dimensions().width - 4)
	const turnActive = () => props.turnActive?.() ?? dockTurnActive(props.rows)
	// Mitigation 1: the frame's Show reads the DEFERRED latch, not the raw
	// turn liveness — mount/unmount land one render tick after the flip
	// (see createFrameLatch above). The latch timer dies with the dock.
	// D10: the lower zone must survive turn end while an in_progress todo or a
	// running subagent is still present, so the latch target is "turn active
	// OR lower zone has content". `dockTurnActive` itself is untouched.
	// Think/tool exit linger: a settled line stays visible for ~2.3s after the
	// turn (2s hold + 300ms sweep, `dockLineVisibility`). Keep the frame up for
	// that whole window so the fade paints INSIDE the framed activity board
	// instead of the bare FlatDock — the board now withdraws only once the last
	// line is hidden (the user-visible "board waits for the fade" behavior).
	// Same `Date.now()` / `motionDecorationsEnabled()` args as `mergedSource`.
	createEffect(() =>
		activityFrameLatch.push(
			turnActive() ||
				mergedLowerHasContent(props.rows) ||
				mergedThinkRows(props.rows, Date.now(), motionDecorationsEnabled()).length > 0 ||
				mergedToolRows(props.rows, Date.now(), motionDecorationsEnabled()).length > 0,
		),
	)
	onCleanup(activityFrameLatch.dispose)
	const frame = () => activityFrameMode(dimensions().height)
	// Since 2026-11-19 the gear drives ONLY the THINK cap; the TOOL cap is
	// `dockLineCap` (fixed 3 at normal terminals, graded down on short ones).
	const capSpec = () => activityPanelCapSpec(activityPanelGear(), dimensions().height)
	const thinkCap = () => capSpec().maxLines
	const toolCap = () => dockLineCap(dimensions().height)

	// ---- merged activity widget (D1/D4/D8/D11) -----------------------------
	// CLOSURE LAW: no component-scope signal/memo here — every getter rebuilds
	// from the props accessor so JSX reads the live store. `void dockSpin()`
	// keeps the merged lines on the shared animation clock (dockBlocks law).
	const mergedSource = (now: number): MergedDockData => {
		void dockSpin()
		return {
			think: mergedThinkRows(props.rows, now, motionDecorationsEnabled()),
			tools: mergedToolRows(props.rows, now, motionDecorationsEnabled()),
			todos: latestTodos(props.rows),
			agents: mergedRunningAgents(props.rows),
			// 指令4: no explicit todo anchor — `todoBriefLine` uses the unified
			// text-signature first-seen map (task set establishment time).
		}
	}
	// 2026-11-19: the merged frame's content area is HARD-capped at 10 lines
	// (`MERGED_DOCK_TOTAL_LINES`) regardless of gear — the old min(gear,10)
	// frame cap and the `all` 2/3-of-rows growth rule are gone. The gear only
	// reaches the builder as `thinkLines`. `frameHeight()` (2 + animated
	// content count) follows the tweened count, not the raw line count.
	// One builder, ONE `now` per reactive read: `mergedDockLines` and
	// `mergedWindowInfo` share the same data/options object so the title N/M,
	// the height, the rendered window and the wheel/key guards can never
	// disagree at a retention boundary (D8 recon / review FIX C). `mergedSource`
	// still reads the live props accessor + `dockSpin` on every call, so JSX
	// stays reactive; no component-scope signal/memo is created (CLOSURE LAW).
	const mergedFrame = (): { lines: ReturnType<typeof mergedDockLines>; info: ReturnType<typeof mergedWindowInfo> } => {
		const now = Date.now()
		const data = mergedSource(now)
		const options: MergedDockOptions = {
			innerWidth: width(),
			now,
			totalLines: MERGED_DOCK_TOTAL_LINES,
			thinkLines: thinkCap(),
			cursor: mergedDockCursor(),
		}
		return { lines: mergedDockLines(data, options), info: mergedWindowInfo(data, options) }
	}
	// Feed the height tween from the freshly-built content count. This effect
	// re-runs on every reactive read inside `mergedFrame` (rows / dockSpin /
	// gear / cursor / width); `setDockHeightTarget` is a no-op while the target
	// count is unchanged, so there is no feedback loop. While the latch is off
	// the FlatDock is mounted and owns the shared tween feed (see FlatDock) —
	// guarding here keeps ONE feed site for the two mutually-exclusive views.
	createEffect(() => {
		if (!activityFrameLatch.shown()) return
		setDockHeightTarget(mergedFrame().lines.length)
	})
	onCleanup(() => {
		resetDockHeight()
		// Session switch / unmount: no task-text signature may survive into the
		// next session's brief clock.
		resetTodoBriefClock()
	})
	// The box reserves 4 of the W columns for title chrome: ┏ (col 0), the
	// leading ━ it always draws before a left-aligned title (col 1), the trailing
	// ━ it always draws after the title (col W-2), and ┓ (col W-1). The title
	// SLOT is therefore exactly W-4 columns. Derived empirically via render
	// capture (widgets-dock-render.test.ts): padding to W-4 fills the slot with
	// the suffix immediately before the single mandatory trailing ━ (`1/14━┓`);
	// padding to W-3 makes the title wider than the slot and opentui drops it
	// entirely (no title painted), so suffix-adjacent-to-┓ is not achievable.
	const titleSlotWidth = () => dimensions().width - 4
	const mergedTitleText = () => {
		const { lines, info } = mergedFrame()
		const base = mergedTitle({
			tool: lines.some((line) => line.kind === "tool"),
			think: lines.some((line) => line.kind === "think"),
			subagent: mergedRunningAgents(props.rows).length > 0,
		})
		const suffix = mergedPositionSuffix(info)
		if (suffix === null) return base
		// D8: N/M on the title's RIGHT side. `titleAlignment="left"` lays the
		// string out from the left border, so pad with spaces measured by the
		// runtime `stringWidth` (D13 — never a character count) to push the
		// suffix block's right edge onto the slot's right edge (the box then adds
		// its single mandatory trailing ━ before ┓).
		const gap = titleSlotWidth() - stringWidth(base) - stringWidth(suffix)
		if (gap < 1) return `${base} · ${suffix}` // degenerate narrow title: append
		return base + " ".repeat(gap) + suffix
	}
	// D9 wheel — the PRIMARY scroll channel. Step the module cursor only while
	// the lower zone overflows. `event.scroll` = `{ direction, delta }`
	// (@opentui/core 0.8.1: no `units` field); `delta` is the wheel magnitude,
	// so one notch moves at least one line, matching the ScrollBox feel.
	// Deliberately NO stopPropagation / preventDefault: the transcript owns the
	// wheel outside the dock, and right-pane-active is a documented dead zone
	// (the full-pane overlay covers the dock) — no overlay forwarding here.
	const onMergedWheel = (event: MouseEvent) => {
		const info = mergedFrame().info
		if (!info.overflow) return
		const dir = event.scroll?.direction
		if (dir !== "up" && dir !== "down") return
		const step = Math.max(1, Math.floor(Math.abs(event.scroll?.delta ?? 0)))
		setMergedDockCursor((c) => (dir === "up" ? Math.max(0, c - step) : Math.min(info.maxCursor, c + step)))
	}
	// D9 optional keyboard fallback — ctrl+alt+↑/↓ through the two config ids
	// added in keybind.ts. Those chords are ALSO declared on which-key.scroll.*,
	// but which-key has no layer implementation in this repo, so those entries
	// are inert and there is no live collision. One key press = one notch = one
	// line, using the SAME clamp source as the wheel (`info.maxCursor`; the window
	// builder further clamps the visible start to n-size in assembleZones).
	const stepMergedDock = (delta: number) => {
		const info = mergedFrame().info
		if (!info.overflow) return // no-op when the lower zone fits
		setMergedDockCursor((c) => Math.max(0, Math.min(info.maxCursor, c + delta)))
	}
	// Global-mode layer gated ONLY by (a) lower-zone overflow and (b) page
	// ownership (no dialog / panel / dock overlay owns the keyboard). `createLayer`
	// MULTIPLIES `enabled` by `useInteractivity()` (keymap.tsx:219): because this
	// dock lives inside the Session subtree, the layer also goes dead while the
	// right pane is active — desired (the dock is a left-pane-only channel).
	// `useOptional` keeps bare FT harnesses (no Keymap.Provider) from throwing;
	// the wheel still works there. Built once per mount, never per render.
	const pageOwns = useIsPageOwner()
	if (Keymap.useOptional() !== undefined) {
		Keymap.createLayer(() => ({
			mode: "global",
			enabled: mergedFrame().info.overflow && pageOwns(),
			commands: [
				{
					id: "session.dock.scroll.up",
					title: "Scroll activity up",
					group: "Session",
					run: () => stepMergedDock(-1),
				},
				{
					id: "session.dock.scroll.down",
					title: "Scroll activity down",
					group: "Session",
					run: () => stepMergedDock(1),
				},
			],
			bindings: ["session.dock.scroll.up", "session.dock.scroll.down"],
		}))
	}
	// The painted lines follow the tweened count: during a resize only the
	// first `count` lines render, so the box's explicit height and its content
	// always agree (no fractional/overflow rows hitting diff-paint). The 10-line
	// cap bounds the target count; the title rides the top border.
	const frameLines = (): MergedDockLine[] => {
		const lines = mergedFrame().lines
		const target = lines.length
		// PINNED clock: `frameHeight()` and the `<For>` below each call this
		// getter, and both must derive the same count. Using the shared
		// `dockFrameNow` (advanced once per tick / target-set) instead of a
		// fresh Date.now() removes the ms-boundary off-by-one between the box
		// height and its painted rows (review P3-1).
		const tweened = Math.max(0, dockHeightContentLines(target, dockFrameNow))
		// 指令5 self-check: at/after the terminal frame the painted count MUST
		// equal the target exactly. This repo has a resident-animation-vs-diff-
		// paint lost-line incident on record; snapping here makes an idle clock
		// (no tick) or a dropped end frame impossible to leave one row short.
		// During an in-flight shrink only, the tweened (smaller) count is kept.
		const animating = untrack(dockHeightAnimating)
		const count = !animating || tweened >= target ? target : Math.min(target, tweened)
		return lines.slice(0, count)
	}
	const frameHeight = () => 2 + frameLines().length
	// Compact lower zone: the same todo tree as the framed dock (with a narrow
	// fallback for an over-budget tree). No scroll zone in the compact form.
	const compactLower = () => mergedCompactLowerLines(props.rows)
	const compactHeight = () => 2 + compactLower().length

	const accentFg = (accent: DockAccent): string | RGBA => dockAccentColor(theme, accent)
	const lineView = (line: DockLine) => dockLineNode(line, width(), skinCtx(), fgFor, accentFg)
	// Merged rows carry structured segments. Each segment resolves its TARGET
	// color from its semantic accent (think violet / tool cyan) or, when it has
	// none (the tool status marker), from its tone — then that target goes
	// through the SAME `skinDockLineFg` entrance/exit-fade pipeline as the flat
	// dock, keyed by the line's stable id / exit anchor (D3/D14). Whole-line
	// italics come from `line.italic`. `mergedDockLines` already fitted each
	// line to exactly `width()` columns, so the concatenated spans land the
	// right edge on the composer border: NO clipping (it would break the exact
	// width law) and `wrapMode="none"`.
	const mergedLineView = (line: MergedDockLine) => {
		const ctx = skinCtx()
		const lineFade = { id: line.id, fadeOutAt: line.fadeOutAt }
		const attributes = line.italic === true ? TextAttributes.ITALIC : undefined
		return (
			<text attributes={attributes} wrapMode="none">
				<For each={line.segments}>
					{(segment) => {
						const target = segment.accent !== undefined ? accentFg(segment.accent) : fgFor(segment.tone)
						return <span style={{ fg: skinDockLineFg(ctx, target, lineFade) }}>{segment.text}</span>
					}}
				</For>
			</text>
		)
	}

	return (
		<box flexShrink={0} flexDirection="column" width="100%">
			<Show
				when={activityFrameLatch.shown()}
				fallback={
					<FlatDock
						rows={props.rows}
						width={width()}
						fgFor={fgFor}
						accentFg={accentFg}
						skinCtx={skinCtx()}
						maxLines={toolCap()}
						thinkMaxLines={thinkCap()}
					/>
				}
			>
				<Show
					when={frame() === "frame"}
					fallback={
						<box flexShrink={0} flexDirection="column" width="100%" height={compactHeight()} paddingLeft={3}>
							<For each={activityRuleLines(props.rows)}>{lineView}</For>
							{/* Compact terminals keep the 2-line rule form for
							 * think/tool. The lower zone now renders the SAME todo
							 * tree as the framed dock (no scroll zone); only an
							 * over-budget tree degrades to one summary line. */}
							<For each={compactLower()}>{mergedLineView}</For>
						</box>
					}
				>
					{/* Explicit border (the borderColor-only trap opens four sides
					 * implicitly — contract §2.4). Height = 2 border rows + the
					 * merged content rows (cap-bounded, title rides the top border). */}
					<box
						flexShrink={0}
						flexDirection="column"
						width="100%"
						height={frameHeight()}
						border={["top", "bottom", "left", "right"]}
						borderStyle="heavy"
						borderColor={activityFrameBorderColor(theme)}
						title={mergedTitleText()}
						titleAlignment="left"
						onMouseScroll={onMergedWheel}
					>
						<For each={frameLines()}>{mergedLineView}</For>
					</box>
				</Show>
			</Show>
		</box>
	)
}

/** The idle fallback dock (the pre-skin flat line list): after the turn
 * ends the frame disappears and any straggler lines (lingering/fading) keep
 * their original per-line height so the composer never jumps. `maxLines` is
 * the TOOL cap (3 default, graded at compact terminals; never the gear);
 * `thinkMaxLines` is the gear-driven THINK cap. Since 2026-11-19 think also
 * suppresses tool here (via `dockBlocks`), and no combined budget is fed. */
function FlatDock(props: {
	rows: readonly SeamRow[]
	width: number
	fgFor: (tone: DockLine["tone"]) => string | RGBA
	accentFg: (accent: DockAccent) => string | RGBA
	skinCtx: SkinFgContext
	maxLines: number
	thinkMaxLines: number
}): JSX.Element {
	const dockOptions = () => ({ maxLines: props.maxLines, thinkMaxLines: props.thinkMaxLines })
	const allLines = () => dockLines(props.rows, dockOptions())
	// The idle fallback owns the shared height tween while mounted (the frame
	// feed in WidgetsDock is guarded by the latch). Feed from the flat line
	// count; a store drop to 0 snaps by the to===0 law in setDockHeightTarget.
	createEffect(() => setDockHeightTarget(allLines().length))
	// Same tween pattern as the framed view (frameLines): the painted count is
	// capped at the target on an in-flight shrink and snaps to the exact target
	// at the terminal frame, so the box height and its rows always agree. Both
	// getters read the SAME pinned `dockFrameNow`, so no ms-boundary off-by-one.
	const flatLines = (): DockLine[] => {
		const lines = allLines()
		const target = lines.length
		const tweened = Math.max(0, dockHeightContentLines(target, dockFrameNow))
		const animating = untrack(dockHeightAnimating)
		const count = !animating || tweened >= target ? target : Math.min(target, tweened)
		return lines.slice(0, count)
	}
	return (
		<box flexShrink={0} flexDirection="column" width="100%" height={flatLines().length} paddingLeft={3}>
			<For each={flatLines()}>{(line) => dockLineNode(line, props.width, props.skinCtx, props.fgFor, props.accentFg)}</For>
		</box>
	)
}

/**
 * One dock row: the status marker (⚙/✔/✘) keeps its tone color while the
 * rest of the line paints in the semantic accent (think violet / tool cyan).
 * `line.text` always carries the full string (pure builders/tests unchanged);
 * the marker is cut out at `markerAt` and re-inserted as a colored span. */
function dockLineNode(
	line: DockLine,
	width: number,
	ctx: SkinFgContext,
	fgFor: (tone: DockLine["tone"]) => string | RGBA,
	accentFg: (accent: DockAccent) => string | RGBA,
): JSX.Element {
	const toneFg = fgFor(line.tone)
	const bodyFg = skinDockLineFg(ctx, line.accent !== undefined ? accentFg(line.accent) : toneFg, line)
	const attributes = line.italic === true ? TextAttributes.ITALIC : undefined
	const marker = line.marker
	const markerAt = line.markerAt ?? 0
	if (marker === undefined || line.text.slice(markerAt, markerAt + marker.length) !== marker) {
		return (
			<text fg={bodyFg} attributes={attributes} wrapMode="none">
				{clipToWidth(line.text, width)}
			</text>
		)
	}
	const before = clipToWidth(line.text.slice(0, markerAt), width)
	const markerBudget = Math.max(0, width - stringWidth(before))
	const clippedMarker = clipToWidth(marker, markerBudget)
	const after = clipToWidth(line.text.slice(markerAt + marker.length), Math.max(0, markerBudget - stringWidth(clippedMarker)))
	const markerFg = skinDockLineFg(ctx, toneFg, line)
	return (
		<text fg={bodyFg} attributes={attributes} wrapMode="none">
			{before}
			<span style={{ fg: markerFg }}>{clippedMarker}</span>
			{after}
		</text>
	)
}
