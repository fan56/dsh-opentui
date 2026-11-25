/**
 * Transcript away-from-bottom hint — pure kernel (no Solid, no renderer).
 *
 * The component in ./transcript.tsx keeps the reactive state and the renderer
 * wiring; this module owns the three decidable predicates so they can be
 * unit-tested without a terminal and pinned against drift:
 *
 *   - away-from-bottom is a pure scroll-geometry predicate; the component
 *     subscribes PASSIVELY to the scrollbar's `change` event and never writes
 *     `stickyScroll` (native follow stays the only owner of that flag);
 *   - the hint's N counts NEW ROWS since the reader left the bottom, so a
 *     streaming increment on an existing row cannot inflate it or pulse;
 *   - the pulse is a bounded two-cycle envelope driven by the shared
 *     animation clock + wall clock, never a resident timer.
 */

export type ScrollPosition = {
	scrollTop: number
	viewportHeight: number
	scrollHeight: number
}

/**
 * Away predicate: `scrollTop + viewport.height < scrollHeight`.
 * Degenerate geometry (empty/unmeasured viewport or content) is at-bottom:
 * there is no scrollback to be away from.
 */
export function awayFromBottom(pos: ScrollPosition): boolean {
	const { scrollTop, viewportHeight, scrollHeight } = pos
	if (
		!Number.isFinite(scrollTop) ||
		!Number.isFinite(viewportHeight) ||
		!Number.isFinite(scrollHeight) ||
		viewportHeight <= 0 ||
		scrollHeight <= 0
	)
		return false
	return scrollTop + viewportHeight < scrollHeight
}

/** N new messages = visible rows added since the baseline, never negative. */
export function newMessageCount(rows: number, baseline: number): number {
	return Math.max(0, Math.floor(rows) - Math.floor(baseline))
}

/** A pulse starts only when the new-message count actually grows. */
export function shouldPulse(previousCount: number, nextCount: number): boolean {
	return nextCount > previousCount
}

/**
 * Copy key for the N-new-rows hint. English distinguishes the singular case
 * ("1 new message") from the plural ("N new messages"); zh-CN intentionally
 * ships the same table entry for both keys, since Chinese has no plural form.
 * The component picks the key, `t()` only interpolates `{count}` / `{keys}`.
 */
export function newMessageCopyKey(count: number): "transcript.scroll.newMessage" | "transcript.scroll.newMessages" {
	return count === 1 ? "transcript.scroll.newMessage" : "transcript.scroll.newMessages"
}

/**
 * Display label for the to-bottom command, derived from the LIVE keybind
 * definition instead of being baked into a locale string. Accepts the whole
 * `TuiKeybind.BindingValue` union (string / array / keystroke object) and
 * returns the first chord only — a multi-chord binding would make the hint
 * lie about what a single key press does.
 */
export function keybindLabel(value: unknown): string {
	if (typeof value === "string") return value.split(",")[0]?.trim() ?? ""
	if (Array.isArray(value)) return keybindLabel(value[0])
	if (value && typeof value === "object" && "key" in value) return keybindLabel((value as { key: unknown }).key)
	return ""
}

/** Two pulses in 600ms = two 300ms triangular cycles. */
export const HINT_PULSE_TOTAL_MS = 600
export const HINT_PULSE_CYCLES = 2

/**
 * Brightness envelope, 0..1: each cycle rises 0 → 1 → 0, so the hint is back
 * at its resting color at both 300ms and 600ms. Outside the window (and for
 * any non-finite input) it is exactly 0 — that is what lets the component
 * unregister its animation tick instead of leaving a permanent timer behind.
 */
export function pulseLevel(elapsedMs: number): number {
	if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || elapsedMs >= HINT_PULSE_TOTAL_MS) return 0
	const cycleMs = HINT_PULSE_TOTAL_MS / HINT_PULSE_CYCLES
	const within = (elapsedMs % cycleMs) / cycleMs
	return within < 0.5 ? within * 2 : (1 - within) * 2
}
