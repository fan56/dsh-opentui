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
import { For, Show, type JSX } from "solid-js"
import { RGBA } from "@opentui/core"
import type { ComponentTheme } from "../../theme/component"

/** A color that is either a token RGBA or a fallback hex string. */
export type PowerlineColor = string | RGBA

/** One powerline segment: label text on a filled background. */
export interface PowerlineSegment {
	/** Segment label, rendered with one space of padding on each side. */
	text: string
	/** Segment fill color (token RGBA or #rrggbb). */
	bg: PowerlineColor
	/** Explicit label color; defaults to autoContrast(bg). */
	fg?: PowerlineColor
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
 * Theme-driven fill palette for one component theme: the semantic mapping
 * the builders use when a ThemeProvider is mounted. Each entry mirrors the
 * kit-era hex of the same name using vendored tokens.
 */
export function powerlinePalette(theme: ComponentTheme) {
	return {
		brand: theme.hue.accent[500],
		provider: theme.hue.interactive[500],
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
	}
}

/** Theme-or-fallback palette: tokens when a theme is mounted, else hexes. */
export function resolvePalette(theme?: ComponentTheme) {
	if (!theme) return POWERLINE_COLORS as unknown as ReturnType<typeof powerlinePalette>
	return powerlinePalette(theme)
}

/** The fixed "dsh" brand segment. */
export function brandSegment(theme?: ComponentTheme): PowerlineSegment {
	return { text: "dsh", bg: resolvePalette(theme).brand }
}

/** The provider segment (providerID on the purple/interactive fill). */
export function providerSegment(provider: string, theme?: ComponentTheme): PowerlineSegment | null {
	if (!provider) return null
	return { text: provider, bg: resolvePalette(theme).provider }
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
	return { text: `🧠 ${Math.round(pct)}%`, bg }
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
	return { text: `⚡ ${Math.round(tps)} tok/s`, bg: resolvePalette(theme).speed }
}

/**
 * The powerline footer: one row of chained segments plus an optional
 * right-aligned text (the clock), pushed to the row's end by a flexGrow
 * spacer. Pure presentation — callers assemble segments via the builders
 * above. The right text sits on the terminal default background, so its
 * color is theme.text.base (fallback #e6e6e6 without a provider).
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
							<text style={{ bg: seg.bg, fg: seg.fg ?? autoContrast(seg.bg) }}>{` ${seg.text} `}</text>
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
	theme?: ComponentTheme
}): PowerlineSegment[] {
	const theme = data.theme
	const segs: PowerlineSegment[] = [brandSegment(theme)]
	const add = (s: PowerlineSegment | null) => {
		if (s) segs.push(s)
	}
	add(providerSegment(data.provider ?? "", theme))
	add(modelSegment(data.model ?? "", data.effort ?? "off", theme))
	add(contextSegment(data.contextPct ?? null, theme))
	add(messagesSegment(data.messages ?? 0, theme))
	add(toolSegment(data.tools ?? 0, theme))
	add(speedSegment(data.tps ?? null, theme))
	return segs
}
