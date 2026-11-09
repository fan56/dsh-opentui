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
import { clipToWidth } from "./tool-summarize"

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
	/** Literal text before the number ("🧠 …(" / "⏱ "). */
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
	/**
	 * Semantic opt-out of the footer gradient: `danger` / `warning` / `error`
	 * segments keep their feedback fill (context >90% is the live case) while
	 * every other segment walks the single blue ramp. Static — no animation.
	 */
	semantic?: "danger" | "warning" | "error"
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
 * Perceived brightness (ITU-R BT.601 weighted rgb), 0..1. Kept for the
 * gradient ordering test and the kit-era callers; label contrast itself is
 * now decided by WCAG (autoContrast below).
 */
export function brightness(color: PowerlineColor): number {
	const [r, g, b] = colorRgb(color)
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/**
 * WCAG relative luminance (sRGB, 0..1) of a segment color. Used by the
 * footer contract "段内文字对比度 ≥ 4.5:1" and by the gradient's
 * deep→light ordering (the ramp is sorted by this, so themes whose numeric
 * scale runs the other way still read dark→light left to right).
 */
export function relativeLuminance(color: PowerlineColor): number {
	const [r, g, b] = colorRgb(color)
	const channel = (v: number): number => {
		const c = v / 255
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrastRatio(a: PowerlineColor, b: PowerlineColor): number {
	const la = relativeLuminance(a)
	const lb = relativeLuminance(b)
	const hi = Math.max(la, lb)
	const lo = Math.min(la, lb)
	return (hi + 0.05) / (lo + 0.05)
}

/**
 * Readable label color on a filled segment: the kit's preferred navy-black
 * or white, whichever has more contrast; when neither reaches the contract's
 * 4.5:1 floor (a mid-blue token can land just under it) fall back to the
 * absolute black/white extreme. The kit-era 0.6 brightness threshold is
 * superseded — it classified #4d6bfe as dark and then painted white at only
 * 4.33:1.
 */
export function autoContrast(bg: PowerlineColor): PowerlineColor {
	const preferred =
		contrastRatio(bg, AUTO_FG_DARK) >= contrastRatio(bg, AUTO_FG_LIGHT) ? AUTO_FG_DARK : AUTO_FG_LIGHT
	if (contrastRatio(bg, preferred) >= 4.5) return preferred
	return contrastRatio(bg, "#000000") >= contrastRatio(bg, "#ffffff") ? "#000000" : "#ffffff"
}

/** Effort (thinking) levels the model segment can carry. */
export type EffortLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

/** Default reasoning effort when the route carries no explicit level. */
export const DEFAULT_EFFORT: EffortLevel = "high"

/**
 * Effective effort for display: a known explicit word ALWAYS wins — including
 * "off" (a user's /think off choice must never be coerced back to high).
 * An absent or unknown word resolves to DEFAULT_EFFORT ("high").
 */
export function effectiveEffort(word: string | null | undefined): EffortLevel {
	const w = word?.trim() as EffortLevel | undefined
	return w && w in EFFORT_ICONS ? w : DEFAULT_EFFORT
}

/**
 * The effort the default policy should WRITE to the route, or undefined when
 * the host must be left alone. Only an unspecified current level qualifies
 * (explicit values, "off" included, are never overwritten) and only when the
 * model's real ladder exposes the default — a non-reasoning model keeps its
 * native behavior instead of receiving a bogus route override.
 */
export function defaultEffortToApply(
	current: string | null | undefined,
	ladder: readonly { id: string }[] | readonly string[],
): EffortLevel | undefined {
	const word = current?.trim()
	if (word && word in EFFORT_ICONS) return undefined
	const ids = ladder.map((entry) => (typeof entry === "string" ? entry : entry.id))
	return ids.includes(DEFAULT_EFFORT) ? DEFAULT_EFFORT : undefined
}

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
 * No-provider gradient anchors: the dsh-blue dark blue ramp, already ordered
 * deepest → lightest (#2a3d9e → #a5b9ff). With a theme the anchors are read
 * off the interactive hue scale instead (see powerlineGradientAnchors).
 */
export const POWERLINE_GRADIENT_FALLBACK = [
	"#2a3d9e",
	"#3b53ce",
	"#4d6bfe",
	"#5c76fe",
	"#6b82fe",
	"#8599ff",
	"#a5b9ff",
] as const

/** The hue steps the gradient samples. Bounded to 100..700 so every
 * interpolated fill keeps the autoContrast label ≥ 4.5:1 on dsh-blue. */
const POWERLINE_GRADIENT_STEPS = ["100", "200", "300", "400", "500", "600", "700"] as const

/** Linear sRGB interpolation → #rrggbb (for the gradient continuum). */
export function mixPowerlineColor(a: PowerlineColor, b: PowerlineColor, t: number): string {
	const [r1, g1, b1] = colorRgb(a)
	const [r2, g2, b2] = colorRgb(b)
	const k = Math.max(0, Math.min(1, t))
	const ch = (x: number, y: number): number => Math.round(x + (y - x) * k)
	return `#${[ch(r1, r2), ch(g1, g2), ch(b1, b2)]
		.map((v) => v.toString(16).padStart(2, "0"))
		.join("")}`
}

/**
 * Gradient endpoints for a theme: the darkest and lightest step of the
 * interactive hue scale within 100..700, sorted by WCAG luminance. Sorting
 * (instead of assuming 700→100) keeps "deep → light" true for light themes
 * too, where the numeric scale runs the other way (blue[100] is the dark
 * end on dsh-blue light).
 */
export function powerlineGradientAnchors(theme?: ComponentTheme): [PowerlineColor, PowerlineColor] {
	const fallback: [PowerlineColor, PowerlineColor] = [
		POWERLINE_GRADIENT_FALLBACK[0],
		POWERLINE_GRADIENT_FALLBACK[POWERLINE_GRADIENT_FALLBACK.length - 1]!,
	]
	if (!theme) return fallback
	const scale = (theme.hue.interactive ?? theme.hue.accent) as unknown as Record<string, RGBA | undefined>
	const steps = POWERLINE_GRADIENT_STEPS.map((step) => scale[step]).filter((value): value is RGBA => value !== undefined)
	if (steps.length < 2) return fallback
	const sorted = [...steps].sort((a, b) => relativeLuminance(a) - relativeLuminance(b))
	return [sorted[0]!, sorted[sorted.length - 1]!]
}

/**
 * The single-hue footer ramp: `count` fills walking from the theme's deepest
 * blue to its lightest, left to right. Brand (index 0) is always the deepest
 * step; the continuum interpolation keeps the steps monotonic in brightness
 * for any segment count (7 or 9 segments resolve distinctly).
 */
export function powerlineGradient(theme: ComponentTheme | undefined, count: number): PowerlineColor[] {
	if (count <= 0) return []
	const [deep, light] = powerlineGradientAnchors(theme)
	if (count === 1) return [deep]
	return Array.from({ length: count }, (_, i) => mixPowerlineColor(deep, light, i / (count - 1)))
}

/**
 * Repaint a footer's segment list with the gradient. Semantic segments
 * (`semantic`: context >90% danger, error states) keep their feedback fill
 * and do not consume a ramp slot; every other segment takes the next step in
 * order, so the remaining strip stays monotonically deep→light.
 */
export function applyPowerlineGradient(segments: readonly PowerlineSegment[], theme?: ComponentTheme): PowerlineSegment[] {
	const gradientCount = segments.reduce((n, segment) => (segment.semantic ? n : n + 1), 0)
	const ramp = powerlineGradient(theme, gradientCount)
	let index = 0
	return segments.map((segment) => {
		if (segment.semantic) return segment
		return { ...segment, bg: ramp[index++]! }
	})
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
 *
 * Footer gradient (user feedback batch): when the segment list is assembled
 * through sessionFooterSegments, applyPowerlineGradient repaints the brand
 * as the DEEPEST step of the single blue ramp. This builder keeps the
 * identity fill for standalone callers/tests.
 */
export function brandSegment(theme?: ComponentTheme, presetLabel?: string, mode: SkinColorMode = "dark"): PowerlineSegment {
	const label = presetLabel ? `dsh(${presetLabel})` : "dsh"
	return { text: label, bg: brandBlue(mode) }
}

/**
 * The provider segment (providerID on the purple/interactive fill, ☁️ lead —
 * tui-pi footer parity). `mode` feeds providerFill's brand-collision walk
 * (see POWERLINE_MIN_SEGMENT_DISTANCE).
 */
export function providerSegment(
	provider: string,
	theme?: ComponentTheme,
	mode: SkinColorMode = "dark",
): PowerlineSegment | null {
	if (!provider) return null
	const label = `☁️ ${provider}`
	if (!theme) return { text: label, bg: POWERLINE_COLORS.provider }
	return { text: label, bg: powerlinePalette(theme, brandBlue(mode)).provider }
}

/**
 * tui-pi thinkingIcon parity: the effort ladder's seven fills get the same
 * seven-step glyph ramp (minimal ◔ → low ◑ → medium ◕ → high ● → xhigh ◉ →
 * max ★). `off` maps to ○ (fix/footer-parity, aligned with tui-pi: off is
 * no longer bare — it renders `○ off` through thinkingIcon's default ○,
 * footer.ts:198/232-234). The earlier "off shows NO glyph" deliberate
 * divergence documented here is VOID. Unknown levels still catch-all to ○.
 */
export const EFFORT_ICONS: Record<EffortLevel, string> = {
	off: "○",
	minimal: "◔",
	low: "◑",
	medium: "◕",
	high: "●",
	xhigh: "◉",
	max: "★",
}

/** The glyph for one effort level: every level maps (off → ○); unknown words fall to ○. */
export function effortIcon(effort: string): string {
	return EFFORT_ICONS[effort as EffortLevel] ?? "○"
}

/**
 * Parse the effort word off the sessionInfo().model label ("provider/model[
 * (effort)]" — seams/session.ts SeamSessionInfo.model). Returns the trailing
 * parenthesized word when it names a known effort level, else undefined —
 * the read-side fallback where the host carries no dedicated effort getter.
 */
export function effortFromModelLabel(label: string | null | undefined): EffortLevel | undefined {
	const m = /\(([^)]+)\)\s*$/.exec(label ?? "")
	const word = m?.[1]?.trim() as EffortLevel | undefined
	return word && word in EFFORT_ICONS ? word : undefined
}

/**
 * The 🤖 model segment; the effort word ALWAYS rides along with its ladder
 * glyph (`🤖 model ● high` when the route carries no explicit level — user
 * directive: unspecified effort defaults to high). An explicit `off` renders
 * `○ off` and is never coerced back.
 * The model name is clipped to 24 terminal columns (tui-pi footer.ts:229
 * `clipToWidth(model, 24)` parity — long ids keep the segment one row wide).
 */
export function modelSegment(
	model: string,
	effort: EffortLevel = DEFAULT_EFFORT,
	theme?: ComponentTheme,
): PowerlineSegment | null {
	if (!model) return null
	const label = `🤖 ${clipToWidth(model, 24)} ${effortIcon(effort)} ${effort}`
	return { text: label, bg: resolvePalette(theme).thinking[effort] }
}

/**
 * Compact token count (footer context batch, tui-pi `fmtNum` parity):
 * `1.2M` / `34.5k` / plain — the 🧠 segment's X/Y pair stays one segment
 * wide on big windows.
 */
export function fmtNum(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
	return `${n}`
}

/**
 * The 🧠 context segment (footer context batch, tui-pi footer.ts:243-256
 * parity): `🧠 {used}/{window}({x.x%})` — one decimal, percent capped at
 * 100 (the window is a hard ceiling; the estimate can overshoot while it
 * prices pending messages a compaction will drop). Without a window (or
 * with a non-positive one) it degrades to the bare `🧠 {used}` shape on
 * contextOk. The fill ramps green→amber→orange→red at 50/70/90.
 */
export function contextSegment(
	used: number | null,
	window: number | null | undefined,
	theme?: ComponentTheme,
): PowerlineSegment | null {
	if (used === null || !Number.isFinite(used) || used < 0) return null
	const p = resolvePalette(theme)
	if (window !== null && window !== undefined && Number.isFinite(window) && window > 0) {
		const percent = Math.min(100, (used / window) * 100)
		const danger = percent >= 90
		const bg = danger ? p.contextDanger : percent >= 70 ? p.contextOrange : percent >= 50 ? p.contextWarn : p.contextOk
		return {
			text: `🧠 ${fmtNum(used)}/${fmtNum(window)}(${percent.toFixed(1)}%)`,
			bg,
			roll: { value: percent, decimals: 1, width: 4, prefix: `🧠 ${fmtNum(used)}/${fmtNum(window)}(`, suffix: "%)" },
			// >90% is the footer gradient's semantic exception: the danger fill
			// survives (warning color stays a warning, not a ramp step).
			...(danger ? { semantic: "danger" as const } : {}),
		}
	}
	return {
		text: `🧠 ${fmtNum(used)}`,
		bg: p.contextOk,
		roll: { value: used, decimals: 0, width: 4, prefix: "🧠 ", suffix: "" },
	}
}

/**
 * The 💬 message-count segment (fix/footer-parity, tui-pi wording `💬 {n}
 * msgs`, footer.ts:271); ALWAYS shown — tui-pi pushes it unconditionally,
 * so 0 renders `💬 0 msgs` instead of omitting the segment.
 */
export function messagesSegment(n: number, theme?: ComponentTheme): PowerlineSegment | null {
	if (!Number.isFinite(n) || n < 0) return null
	return { text: `💬 ${n} msgs`, bg: resolvePalette(theme).messages }
}

/**
 * The 🔧 tool-count segment (fix/footer-parity, tui-pi parity: icon 🔧 and
 * the `{n} tools` wording, footer.ts:272; the former 🛠 bare-count with a
 * > 0 gate is replaced). ALWAYS shown — 0 renders `🔧 0 tools`.
 */
export function toolSegment(n: number, theme?: ComponentTheme): PowerlineSegment | null {
	if (!Number.isFinite(n) || n < 0) return null
	return { text: `🔧 ${n} tools`, bg: resolvePalette(theme).tools }
}

/**
 * The tok/s segment (skin-batch enhancement, kept): bare `{n} tok/s` with NO
 * glyph. fix/footer-parity: the old `⚡ ` prefix collided with tui-pi's
 * cache-hit symbol — ⚡ stays reserved for the `⚡ CH%` segment (tui-pi
 * semantics, footer.ts:269). Still omitted when tps is unknown.
 */
export function speedSegment(tps: number | null, theme?: ComponentTheme): PowerlineSegment | null {
	if (tps === null || !Number.isFinite(tps) || tps < 0) return null
	return {
		text: `${Math.round(tps)} tok/s`,
		bg: resolvePalette(theme).speed,
		roll: { value: tps, decimals: 0, width: 3, suffix: " tok/s" },
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
 *
 * Two fixes from the footer-polish feedback batch ride here:
 *   - the strip is repainted through applyPowerlineGradient: one blue ramp
 *     running deep→light left to right (brand = deepest), with the >90%
 *     context danger fill as the only semantic exception;
 *   - an unspecified effort resolves to `high` (effectiveEffort), while an
 *     explicit level — `off` included — always wins.
 */
export function sessionFooterSegments(data: {
	provider?: string
	model?: string
	effort?: EffortLevel
	/** 🧠 occupancy estimate (footer context batch); null/absent hides the segment. */
	contextTokens?: number | null
	/** 🧠 model window (footer context batch); null/absent degrades to the bare `used` shape. */
	contextWindow?: number | null
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
	add(modelSegment(data.model ?? "", effectiveEffort(data.effort), theme))
	add(contextSegment(data.contextTokens ?? null, data.contextWindow ?? null, theme))
	// tui-pi footer order: 🧠 context, ⚡ CH, then msgs/tools.
	add(cacheSegment(data.cacheHitRate ?? null, theme))
	add(messagesSegment(data.messages ?? 0, theme))
	add(toolSegment(data.tools ?? 0, theme))
	add(elapsedSegment(data.elapsedSec ?? null, theme))
	add(speedSegment(data.tps ?? null, theme))
	// Batch D3: the search discoverability hint (batch H1) left the strip —
	// key hints live on their own last row (./hints-line.tsx, tui-pi
	// FooterHint after PowerlineFooter); the powerline is pure segments.
	return applyPowerlineGradient(segs, theme)
}
