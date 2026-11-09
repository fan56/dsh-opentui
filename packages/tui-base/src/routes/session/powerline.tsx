/**
 * Powerline-style segmented footer — rebuilt on the vendored theme system
 * (batch 7), ported from the old stack's `@dsh-opentui/kit` powerline.tsx.
 *
 * Rendering follows the same powerline convention as the kit port: each
 * segment is one <text> painted with its own background and one space of
 * padding on both sides; between adjacent segments sits the powerline arrow
 * (U+E0B0) drawn in the PREVIOUS segment's background color on the NEXT
 * segment's background color, so the segments chain into one chevron strip.
 * After the last segment a bare arrow (previous bg as the foreground,
 * terminal-default background) closes the strip. A flexGrow spacer pushes
 * the optional right-aligned text (the clock) to the row's end.
 *
 * Colors: segment fills resolve from vendored theme tokens (RGBA) via the
 * builder helpers below; POWERLINE_COLORS is the no-provider fallback map
 * (same injectable law as the composer/transcript: hex fallbacks when no
 * ThemeProvider is mounted). `bg`/`fg` accept either a hex string or an
 * RGBA token so tests and callers can mix both.
 */
import { createEffect, createSignal, For, on, Show, type JSX } from "solid-js"
import { onAnimationTick } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import type { ComponentTheme } from "../../theme/component"
import { ROLL_MS, STREAM_FPS, getMotionTier } from "../../skin/motion"
import { brandBlue, type SkinColorMode } from "../../skin/identity"

/** A color that is either a token RGBA or a fallback hex string. */
export type PowerlineColor = string | RGBA

/**
 * Rolling-number spec (skin contract §1 "数字滚动"): when present the
 * footer renders the label's number through the fixed-width rolling leaf —
 * ~0.3s eased roll to the new value at ≤12.5fps on the shared clock,
 * instant jump on reduced/off. `text` stays the plain (already-formatted)
 * fallback rendering.
 */
export interface RollingSpec {
	/** The numeric value the label displays. */
	value: number
	/** Fraction digits (default 0). */
	decimals?: number
	/** Minimum integer-part width, space-padded (fixed-width law). */
	width?: number
	/** Literal text before the number ("⚡ " / "🧠 "). */
	prefix?: string
	/** Literal text after the number (" tok/s" / "%"). */
	suffix?: string
}

/** One powerline segment: label text on a filled background. */
export interface PowerlineSegment {
	/** Segment label, rendered with one space of padding on each side. */
	text: string
	/** Segment fill color (token RGBA or #rrggbb). */
	bg: PowerlineColor
	/** Explicit label color; defaults to autoContrast(bg). */
	fg?: PowerlineColor
	/** Rolling-number leaf spec; absent → static `text`. */
	roll?: RollingSpec
}

/**
 * The segment fill palette — the kit-era fallbacks, used only when no
 * ThemeProvider is mounted. With a theme, builders derive fills from
 * vendored tokens instead (hue scales + feedback colors).
 */
export const POWERLINE_COLORS = {
	/** "dsh" brand blue. */
	brand: "#4D6BFE",
	/** Provider segment purple. */
	provider: "#6A1B9A",
	/** Thinking-level ramp (off→max). */
	thinking: {
		off: "#616161",
		minimal: "#78909C",
		low: "#5C6BC0",
		medium: "#42A5F5",
		high: "#26A69A",
		xhigh: "#FFA726",
		max: "#EF5350",
	} as Record<string, string>,
	/** Context-usage ramp (share of the context window consumed). */
	contextOk: "#4CAF50",
	contextWarn: "#FFC107",
	contextOrange: "#FF9800",
	contextDanger: "#F44336",
	/** Message-count segment blue. */
	messages: "#1565C0",
	/** Tool-count segment orange. */
	tools: "#E65100",
	/** Tokens-per-second segment teal. */
	speed: "#00897B",
	/** Cache-hit-rate segment teal (batch F2, tui-pi footer parity). */
	cache: "#00695C",
}

/** The powerline arrow separator (U+E0B0, nerdfont). */
export const POWERLINE_ARROW = "\ue0b0"

/** Dark text for bright fills — near-black with a navy cast. */
const AUTO_FG_DARK = "#1a1a2e"
/** Light text for dark fills. */
const AUTO_FG_LIGHT = "#ffffff"

/** [r, g, b] (0-255 each) of a PowerlineColor; [0,0,0] for malformed hex. */
export function colorRgb(color: PowerlineColor): [number, number, number] {
	if (typeof color !== "string") {
		// Token RGBA channels are 0..1 floats — normalize to the 0-255 scale
		// so the brightness math is the same for hex and token fills.
		return [Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255)]
	}
	const m = /^#?([0-9a-fA-F]{6})$/.exec(color)
	if (!m) return [0, 0, 0]
	const n = m[1]!
	return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}

/**
 * Perceived brightness (ITU-R BT.601 weighted rgb) of a segment color,
 * 0..1. The non-linearized weighted average is deliberate: paired with the
 * 0.6 threshold below it classifies the amber contextWarn (#FFC107, 0.75)
 * as bright, so it gets dark label text — the kit's hexIsLight() behavior.
 */
export function brightness(color: PowerlineColor): number {
	const [r, g, b] = colorRgb(color)
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** Readable label color on a filled segment (brightness threshold 0.6). */
export function autoContrast(bg: PowerlineColor): PowerlineColor {
	return brightness(bg) > 0.6 ? AUTO_FG_DARK : AUTO_FG_LIGHT
}

/** Effort (thinking) levels the model segment can carry. */
export type EffortLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

/**
 * Minimum perceived distance (euclidean, 0-255 RGB) between two adjacent
 * segment fills for the U+E0B0 chevron to read as a real segment boundary.
 * Skin visual-acceptance finding: on dsh-blue the brand fill (#4D6BFE) and
 * the provider fill (interactive[500] = the same #4D6BFE) collided — the
 * arrow's foreground equaled its background and the strip read as one blob.
 */
export const POWERLINE_MIN_SEGMENT_DISTANCE = 80

/** Euclidean distance between two fills on the 0-255 rgb scale. */
export function colorDistance(a: PowerlineColor, b: PowerlineColor): number {
	const [r1, g1, b1] = colorRgb(a)
	const [r2, g2, b2] = colorRgb(b)
	return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

/**
 * Provider fill that stays theme-driven yet never collides with the brand
 * segment: walk the interactive ramp 500→900 and take the first step at
 * least POWERLINE_MIN_SEGMENT_DISTANCE from the brand fill (the deepest
 * seen step when none qualifies, or 500 when the ramp is absent). On
 * dsh-blue this shifts 500→700 (dark #2A3D9E / light #9DAFF0 vs brand
 * #4D6BFE / #3B5BDB); gruvbox and tokyonight dark clear it at 500, while
 * tokyonight light walks on to 700.
 */
export function providerFill(theme: ComponentTheme, brand: PowerlineColor): RGBA {
	const ramp = theme.hue.interactive as unknown as Record<string, RGBA | undefined>
	let last: RGBA | undefined
	for (const step of ["500", "600", "700", "800", "900"]) {
		const v = ramp[step]
		if (!v) break
		last = v
		if (colorDistance(brand, v) >= POWERLINE_MIN_SEGMENT_DISTANCE) return v
	}
	return last ?? (theme.hue.interactive[500] as RGBA)
}

/**
 * Theme-driven fill palette for one component theme: the semantic mapping
 * the builders use when a ThemeProvider is mounted. Each entry mirrors the
 * kit-era hex of the same name using vendored tokens. `brand` (the actual
 * brand-segment fill) opts the provider entry into the collision-avoiding
 * ramp walk (providerFill); without it provider stays interactive[500].
 */
export function powerlinePalette(theme: ComponentTheme, brand?: PowerlineColor) {
	return {
		brand: theme.hue.accent[500],
		provider: brand ? providerFill(theme, brand) : theme.hue.interactive[500],
		thinking: {
			off: theme.text.faint,
			minimal: theme.text.muted,
			low: theme.hue.neutral[400],
			medium: theme.hue.neutral[600],
			high: theme.hue.accent[500],
			xhigh: theme.text.feedback.warning.base,
			max: theme.text.feedback.error.base,
		} as Record<EffortLevel, RGBA>,
		contextOk: theme.text.feedback.success.base,
		contextWarn: theme.text.feedback.warning.base,
		contextOrange: theme.text.feedback.error.muted,
		contextDanger: theme.text.feedback.error.base,
		messages: theme.hue.accent[700],
		tools: theme.text.feedback.warning.muted,
		speed: theme.hue.interactive[600],
		cache: theme.hue.interactive[700],
	}
}

/** Theme-or-fallback palette: tokens when a theme is mounted, else hexes. */
export function resolvePalette(theme?: ComponentTheme) {
	if (!theme) return POWERLINE_COLORS as unknown as ReturnType<typeof powerlinePalette>
	return powerlinePalette(theme)
}

/**
 * The "dsh" brand segment. `presetLabel` (batch H2, tui-pi 60-preset footer
 * parity) appends the current agent preset — "dsh(Standard)" — and stays
 * plain "dsh" without one (no preset face, empty roster, nothing selected).
 * Skin contract §1: the fill is the IDENTITY brand blue (dark #4D6BFE /
 * light #3B5BDB, skin/identity.ts) instead of the theme accent token.
 */
export function brandSegment(theme?: ComponentTheme, presetLabel?: string, mode: SkinColorMode = "dark"): PowerlineSegment {
	const label = presetLabel ? `dsh(${presetLabel})` : "dsh"
	return { text: label, bg: brandBlue(mode) }
}

/**
 * The provider segment (providerID on the purple/interactive fill). `mode`
 * feeds providerFill's brand-collision walk (see POWERLINE_MIN_SEGMENT_DISTANCE).
 */
export function providerSegment(
	provider: string,
	theme?: ComponentTheme,
	mode: SkinColorMode = "dark",
): PowerlineSegment | null {
	if (!provider) return null
	if (!theme) return { text: provider, bg: POWERLINE_COLORS.provider }
	return { text: provider, bg: powerlinePalette(theme, brandBlue(mode)).provider }
}

/** The 🤖 model segment; effort rides along (◕ level) when not "off". */
export function modelSegment(
	model: string,
	effort: EffortLevel = "off",
	theme?: ComponentTheme,
): PowerlineSegment | null {
	if (!model) return null
	const label = effort === "off" ? `🤖 ${model}` : `🤖 ${model} ◕ ${effort}`
	return { text: label, bg: resolvePalette(theme).thinking[effort] }
}

/** The 🧠 context segment; the fill ramps green→amber→orange→red on % consumed. */
export function contextSegment(pct: number | null, theme?: ComponentTheme): PowerlineSegment | null {
	if (pct === null || !Number.isFinite(pct) || pct < 0) return null
	const p = resolvePalette(theme)
	const bg = pct >= 90 ? p.contextDanger : pct >= 75 ? p.contextOrange : pct >= 60 ? p.contextWarn : p.contextOk
	return { text: `🧠 ${Math.round(pct)}%`, bg, roll: { value: pct, decimals: 0, width: 2, prefix: "🧠 ", suffix: "%" } }
}

/** The 💬 message-count segment; omitted while no message was sent. */
export function messagesSegment(n: number, theme?: ComponentTheme): PowerlineSegment | null {
	if (!Number.isFinite(n) || n <= 0) return null
	return { text: `💬 ${n}`, bg: resolvePalette(theme).messages }
}

/** The 🛠 tool-count segment; omitted while no tool has run (kit parity). */
export function toolSegment(n: number, theme?: ComponentTheme): PowerlineSegment | null {
	if (!Number.isFinite(n) || n <= 0) return null
	return { text: `🛠 ${n}`, bg: resolvePalette(theme).tools }
}

/** The ⚡ tok/s segment; omitted when tps is unknown (no measurable turn). */
export function speedSegment(tps: number | null, theme?: ComponentTheme): PowerlineSegment | null {
	if (tps === null || !Number.isFinite(tps) || tps < 0) return null
	return {
		text: `⚡ ${Math.round(tps)} tok/s`,
		bg: resolvePalette(theme).speed,
		roll: { value: tps, decimals: 0, width: 3, prefix: "⚡ ", suffix: " tok/s" },
	}
}

/**
 * The ⏱ elapsed-turn segment (skin contract §1 "数字滚动" — the 计时
 * number). Absent while no turn timing is provided; rolls on each new
 * second like the other rolling numbers.
 */
export function elapsedSegment(seconds: number | null, theme?: ComponentTheme): PowerlineSegment | null {
	if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null
	return {
		text: `⏱ ${Math.round(seconds)}s`,
		bg: theme?.hue.neutral[400] ?? "#616161",
		roll: { value: seconds, decimals: 0, width: 3, prefix: "⏱ ", suffix: "s" },
	}
}

/**
 * The ⚡ CH cache-hit-rate segment (batch F2, tui-pi footer parity). The
 * label shape matches tui-pi's `⚡ CHxx.x%`; the gate is "the session saw
 * cache traffic" (rate !== null — the seam returns null until the host
 * reports cacheRead/cacheWrite). Both faces share the builder, so the
 * segment appears wherever the seam's rate flows in.
 */
export function cacheSegment(rate: number | null, theme?: ComponentTheme): PowerlineSegment | null {
	if (rate === null || !Number.isFinite(rate) || rate < 0) return null
	return { text: `⚡ CH${rate.toFixed(1)}%`, bg: resolvePalette(theme).cache }
}

/**
 * Fixed-width number formatting for the rolling leaf: integer part padded
 * to `width` display columns (space-padded, never truncated — wider values
 * simply take more room), then the fraction digits. Pure and unit-tested.
 */
export function formatRolling(value: number, decimals = 0, width = 1): string {
	const fixed = Math.abs(value).toFixed(decimals)
	const sign = value < 0 ? "-" : ""
	const [int, frac] = fixed.split(".")
	const padded = (sign + (int ?? "0")).padStart(width, " ")
	return frac !== undefined ? `${padded}.${frac}` : padded
}

/** smootherstep — the eased roll curve (tab-pulse parity), pure. */
export function smootherstep(t: number): number {
	const x = Math.max(0, Math.min(1, t))
	return x * x * x * (x * (x * 6 - 15) + 10)
}

/** Interpolated roll value at progress p ∈ [0,1] (eased), pure. */
export function rollValue(from: number, to: number, p: number): number {
	return from + (to - from) * smootherstep(p)
}

/**
 * The rolling-number leaf (skin contract §1 "数字滚动"): one PowerlineFooter
 * inner leaf per rolling segment. On a value change it rolls from the shown
 * value to the new one over ~0.3s on the renderer's SHARED animation clock
 * (onAnimationTick at the 12.5fps cap — no setInterval, contract §2.2);
 * reduced/off jumps straight to the new value. Fixed width via
 * formatRolling so the powerline never re-flows mid-roll (H-risk review).
 */
function RollingSegmentText(props: { seg: PowerlineSegment }): JSX.Element {
	const spec = () => props.seg.roll!
	const [display, setDisplay] = createSignal(spec().value)
	const [rolling, setRolling] = createSignal(false)
	const roll = { from: 0, to: 0, started: 0 }
	// Target watcher: reduced/off jumps straight to the new value (contract
	// §1); full arms a ~0.3s roll.
	createEffect(
		on(
			() => spec().value,
			(target) => {
				if (getMotionTier() !== "full") {
					setDisplay(target)
					return
				}
				roll.from = display()
				roll.to = target
				roll.started = performance.now()
				if (roll.from !== roll.to) setRolling(true)
			},
		),
	)
	// The fps accessor pauses the shared clock (undefined) while idle, so
	// the leaf only ticks during the 0.3s roll window at the 12.5fps cap.
	onAnimationTick(
		() => (rolling() ? STREAM_FPS : undefined),
		() => {
			const p = Math.min(1, (performance.now() - roll.started) / ROLL_MS)
			setDisplay(rollValue(roll.from, roll.to, p))
			if (p >= 1) setRolling(false)
		},
	)
	const label = () => {
		const s = spec()
		return ` ${s.prefix ?? ""}${formatRolling(display(), s.decimals, s.width)}${s.suffix ?? ""} `
	}
	return <text style={{ bg: props.seg.bg, fg: props.seg.fg ?? autoContrast(props.seg.bg) }}>{label()}</text>
}

/**
 * The powerline footer: one row of chained segments plus an optional
 * right-aligned text (the clock), pushed to the row's end by a flexGrow
 * spacer. Pure presentation — callers assemble segments via the builders
 * above; segments carrying a `roll` spec render through the fixed-width
 * rolling leaf. The right text sits on the terminal default background, so
 * its color is theme.text.base (fallback #e6e6e6 without a provider).
 */
export function PowerlineFooter(props: {
	left: PowerlineSegment[]
	right?: string
	theme?: ComponentTheme
}): JSX.Element {
	// Batch F2: flexShrink 0 (auto-height-collapse law). The footer is an
	// auto-height row at the end of the page column; once a long reply makes
	// the transcript content exceed the viewport, the flex column shrinks
	// every shrinkable child and this row collapsed to 0 rows — the footer
	// "disappeared at settle" (live: boot/early-stream fine, gone after a
	// 60-sentence turn, resize did not restore it). Never shrink it.
	return (
		<box style={{ flexDirection: "row", paddingLeft: 1, flexShrink: 0 }}>
			<For each={props.left}>
				{(seg, i) => {
					const next = () => props.left[i() + 1]
					return (
						<>
							<Show when={seg.roll} fallback={<text style={{ bg: seg.bg, fg: seg.fg ?? autoContrast(seg.bg) }}>{` ${seg.text} `}</text>}>
								<RollingSegmentText seg={seg} />
							</Show>
							<Show when={next()} fallback={<text style={{ fg: seg.bg }}>{POWERLINE_ARROW}</text>}>
								{(n) => <text style={{ fg: seg.bg, bg: n().bg }}>{POWERLINE_ARROW}</text>}
							</Show>
						</>
					)
				}}
			</For>
			<Show when={props.right}>
				<box style={{ flexGrow: 1 }} />
				<text style={{ fg: props.theme?.text.base ?? "#e6e6e6" }}>{props.right}</text>
			</Show>
		</box>
	)
}

/**
 * Assemble the standard footer row from live data (the example page's
 * seam wiring): brand, provider, model+effort, context, messages, tools,
 * speed. Omitted-data builders (null) drop out.
 */
export function sessionFooterSegments(data: {
	provider?: string
	model?: string
	effort?: EffortLevel
	contextPct?: number | null
	messages?: number
	tools?: number
	tps?: number | null
	/** ⚡ CH rate (seam.cacheHitRate()); null/absent hides the segment. */
	cacheHitRate?: number | null
	/** Current agent preset label (batch H2); absent keeps the plain "dsh". */
	presetLabel?: string
	/** Elapsed turn seconds for the ⏱ segment; null/absent hides it. */
	elapsedSec?: number | null
	/** Identity color mode (brand segment fill); dark default. */
	mode?: SkinColorMode
	theme?: ComponentTheme
}): PowerlineSegment[] {
	const theme = data.theme
	const segs: PowerlineSegment[] = [brandSegment(theme, data.presetLabel, data.mode)]
	const add = (s: PowerlineSegment | null) => {
		if (s) segs.push(s)
	}
	add(providerSegment(data.provider ?? "", theme, data.mode))
	add(modelSegment(data.model ?? "", data.effort ?? "off", theme))
	add(contextSegment(data.contextPct ?? null, theme))
	// tui-pi footer order: 🧠 context, ⚡ CH, then msgs/tools.
	add(cacheSegment(data.cacheHitRate ?? null, theme))
	add(messagesSegment(data.messages ?? 0, theme))
	add(toolSegment(data.tools ?? 0, theme))
	add(elapsedSegment(data.elapsedSec ?? null, theme))
	add(speedSegment(data.tps ?? null, theme))
	// Batch D3: the search discoverability hint (batch H1) left the strip —
	// key hints live on their own last row (./hints-line.tsx, tui-pi
	// FooterHint after PowerlineFooter); the powerline is pure segments.
	return segs
}
