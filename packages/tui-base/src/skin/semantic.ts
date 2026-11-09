/**
 * Skin semantic colors + static layout vocabulary (new-skin contract §1, γ
 * lane — focus & borders). Single source for every face that paints:
 *
 *   - a focused border      → heavy line + accent
 *   - an unfocused border   → single line + border.base
 *   - a busy composer       → warning color (instant swap, NEVER animated)
 *   - the current list row  → full-row background + text (the dialog-select
 *                             token semantics: background.action.primary.focused
 *                             / text.action.primary.focused)
 *   - warning / success tints → text.feedback.{warning,success}.base
 *
 * All resolvers take the active ComponentTheme optionally and fall back to
 * the tokyonight-ish hexes the pre-skin faces hardcoded, so the rebuilt
 * faces keep painting without a theme provider.
 *
 * The composer's height/border layout math lives here too (pure, unit-
 * tested): the four-side border adds two rows to the explicit root height,
 * and terminals at or below COMPACT_TERMINAL_ROWS drop the top/bottom sides
 * (contract: 80x24 busy keeps the transcript ≥ 6 rows; the activity frame
 * occupies 5 more — a later lane drops it to a left rule).
 *
 * BORDER ANIMATION IS FORBIDDEN (user directive): these colors switch
 * instantly on state change. Nothing here may interpolate.
 */
import type { RGBA } from "@opentui/core"
import type { ComponentTheme } from "../theme/component"

/** No-provider fallbacks (the pre-skin hardcoded hexes). */
export const SKIN_FALLBACK = {
	/** border.base — unfocused border, slash-menu base rows. */
	border: "#7aa2f7",
	/** Accent — focused border (theme accent hue, mid step). */
	accent: "#7aa2f7",
	/** Warning tier — busy composer, approval/ask cards. */
	warning: "#e0af68",
	/** Success tier — the plugins "on" column (was hardcoded #9ece6a). */
	success: "#9ece6a",
} as const

export type SkinBorderColor = RGBA | string
/** Mutable array: the Box `border` prop takes `BorderSides[]`. */
export type SkinBorderSides = ("top" | "bottom" | "left" | "right")[]

/** Unfocused surface border: single line + border.base. */
export function unfocusedBorderColor(theme?: ComponentTheme): SkinBorderColor {
	return theme?.border.base ?? SKIN_FALLBACK.border
}

/** Focused surface border: the theme's INTERACTIVE hue (500 step) — the
 * same family the current-row action colors use, so focus frames and list
 * highlights stay one color across themes (P1-1: tokyonight's accent hue
 * is orange while its current row is blue; interactive keeps them equal).
 * Cursors that ride the focused-border color follow automatically. */
export function focusedBorderColor(theme?: ComponentTheme): SkinBorderColor {
	return theme?.hue.interactive[500] ?? SKIN_FALLBACK.accent
}

/** Warning tier (feedback.warning.base): busy composer border/cursor/title,
 * approval + ask card frames. */
export function warningColor(theme?: ComponentTheme): SkinBorderColor {
	return theme?.text.feedback.warning.base ?? SKIN_FALLBACK.warning
}

/** Success tier (feedback.success.base): the plugins panel "on" column. */
export function successColor(theme?: ComponentTheme): SkinBorderColor {
	return theme?.text.feedback.success.base ?? SKIN_FALLBACK.success
}

/** Border color + line weight for a focusable surface. Orthogonal states:
 * busy drives the COLOR (warning wins — the contract's instant busy swap),
 * focus drives the WEIGHT (heavy when focused, single otherwise). */
export function surfaceBorder(
	state: { busy?: boolean; focused?: boolean; theme?: ComponentTheme },
): { borderStyle: "single" | "heavy"; borderColor: SkinBorderColor } {
	return {
		borderStyle: state.focused ? "heavy" : "single",
		borderColor: state.busy
			? warningColor(state.theme)
			: state.focused
				? focusedBorderColor(state.theme)
				: unfocusedBorderColor(state.theme),
	}
}

/** Current list row (the dialog-select legacy semantics, lifted here as the
 * single source): full-row background + text color. */
export function currentRowColors(
	theme?: ComponentTheme,
): { backgroundColor: SkinBorderColor | undefined; textColor: SkinBorderColor } {
	return {
		backgroundColor: theme?.background.action.primary.focused,
		textColor: theme?.text.action.primary.focused ?? SKIN_FALLBACK.accent,
	}
}

/** Skin cursor (contract §1: vertical bar, blinking): the resolved config
 * style wins when the user picked a shape explicitly; the resolved default
 * ("block") and "default" map to the skin's line. Color rides cursorColor
 * only — cursorStyle.color is ignored by core. Faces read the config via
 * useCursorStyle() and pass it here (undefined = no ConfigProvider, e.g.
 * bare FT harnesses → the skin default). */
export function skinCursor(config?: { style?: string; blinking?: boolean }): {
	style: "line" | "underline"
	blinking: boolean
} {
	return {
		style: config?.style === "underline" ? "underline" : "line",
		blinking: config?.blinking ?? true,
	}
}

// ---------------------------------------------------------------------------
// Composer layout (H7): explicit height + short-terminal rule.
// ---------------------------------------------------------------------------

/** Rows the four-side border adds to the composer's explicit root height
 * (top + bottom). The H7 finding: without +2 a single-line input has zero
 * visible rows. */
export const COMPOSER_BORDER_ROWS = 2

/** Terminal rows at or below which the composer drops its top/bottom border
 * sides. Contract: 80x24 busy must keep the transcript ≥ 6 rows — busy
 * worst case is palette 6 + textarea 8 (max) composer content and 2 fixed
 * page rows (powerline + hints): 24 − 2 − 14 = 8 ≥ 6 only WITHOUT the
 * border rows, so 24 must fall in the compact branch; 30 keeps normal
 * terminals (30+ rows) framed. The SAME threshold governs the widget lanes
 * that share this band: the activity frame collapses to a two-row left rule
 * and the persistent Todos table collapses to its one-line summary
 * (routes/session/widgets-dock.tsx) — a 9-row table would blow the band. */
export const COMPOSER_COMPACT_TERMINAL_ROWS = 30

/** 50ms debounce on UNFOCUS only: a dialog close refocuses the composer a
 * frame after blurring it (vendored DialogProvider schedules at 1ms, the
 * turn overlay host re-asserts at 3ms) — without the debounce the border
 * flashes unfocused for that frame. Focus itself applies immediately. */
export const SKIN_FOCUS_BLUR_DEBOUNCE_MS = 50

/** Composer border sides for a terminal height: all four above the compact
 * threshold, left/right only at or below it (the top/bottom rows go back to
 * the transcript). */
export function composerBorderSides(terminalRows: number): SkinBorderSides {
	if (terminalRows <= COMPOSER_COMPACT_TERMINAL_ROWS) return ["left", "right"]
	return ["top", "bottom", "left", "right"]
}

/** The composer's explicit root height (OpenTUI law: never auto-height) and
 * its border sides. Height = content rows (textarea + footer + slash
 * palette) + the border rows the sides actually draw. */
export function composerLayout(input: {
	textareaLines: number
	footerRows: number
	paletteRows: number
	terminalRows: number
}): { height: number; border: SkinBorderSides } {
	const border = composerBorderSides(input.terminalRows)
	const borderRows = border.includes("top") ? COMPOSER_BORDER_ROWS : 0
	const content = Math.max(1, input.textareaLines) + Math.max(0, input.footerRows) + Math.max(0, input.paletteRows)
	return { height: content + borderRows, border }
}
