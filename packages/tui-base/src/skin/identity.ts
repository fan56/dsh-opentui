/**
 * skin/identity.ts — the DSH identity gradient (skin contract §1 "身份色").
 *
 * Brand blue → purple ramp: dark mode `#4D6BFE → #8B5CF6`, light mode the
 * deepened pair `#3B5BDB → #7C3AED` (keeps ≥4.5:1 contrast on white). Pure
 * math, no framework or renderer deps, so the interpolation is unit-testable
 * in isolation. `skin/index.ts` is intentionally NOT created here (the
 * static-skin lane owns `skin/semantic.ts`).
 *
 * Usage (module-level, no provider):
 *   import { identityAt, identityHexAt, brandBlue } from "../skin/identity"
 *   identityHexAt(0.5)          // midpoint of the DARK ramp (default)
 *   identityHexAt(0.25, "light")
 *   brandBlue()                 // "#4D6BFE" — ramp start, dark mode
 */

export type SkinColorMode = "dark" | "light"

/** 8-bit RGB channels. */
export interface RGB {
	r: number
	g: number
	b: number
}

/** The identity ramp endpoints per color mode (skin contract §1). */
export const IDENTITY_GRADIENT: Record<SkinColorMode, { from: RGB; to: RGB }> = {
	dark: { from: hexToRgb("#4D6BFE"), to: hexToRgb("#8B5CF6") },
	light: { from: hexToRgb("#3B5BDB"), to: hexToRgb("#7C3AED") },
}

/** Parse `#rrggbb` (with or without `#`); malformed input → black. */
export function hexToRgb(hex: string): RGB {
	const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
	if (!m) return { r: 0, g: 0, b: 0 }
	const n = m[1]!
	return {
		r: parseInt(n.slice(0, 2), 16),
		g: parseInt(n.slice(2, 4), 16),
		b: parseInt(n.slice(4, 6), 16),
	}
}

/** `#rrggbb` (lowercase) from RGB channels. */
export function rgbToHex({ r, g, b }: RGB): string {
	const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")
	return `#${part(r)}${part(g)}${part(b)}`
}

/** Linear interpolation between two colors; `t` clamped to [0,1]. */
export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
	const k = clamp01(t)
	return {
		r: a.r + (b.r - a.r) * k,
		g: a.g + (b.g - a.g) * k,
		b: a.b + (b.b - a.b) * k,
	}
}

function clamp01(t: number): number {
	if (!Number.isFinite(t)) return 0 // NaN / ±Infinity → ramp start, never malformed
	return t < 0 ? 0 : t > 1 ? 1 : t
}

/**
 * Per-cell identity gradient: `t ∈ [0,1]` maps ramp start → end for the
 * given color mode (dark default). This is the single source of truth the
 * gradient text component and the comet tail both sample.
 */
export function identityAt(t: number, mode: SkinColorMode = "dark"): RGB {
	const { from, to } = IDENTITY_GRADIENT[mode]
	return lerpRgb(from, to, t)
}

/** `identityAt` as an `#rrggbb` string. */
export function identityHexAt(t: number, mode: SkinColorMode = "dark"): string {
	return rgbToHex(identityAt(t, mode))
}

/** The ramp start — the DSH brand blue for the color mode (dark default). */
export function brandBlue(mode: SkinColorMode = "dark"): string {
	return identityHexAt(0, mode)
}

/**
 * A discrete ramp of `steps` hex colors sampled across the identity gradient
 * (steps ≤ 1 → single-color ramp at the start). For per-cell coloring prefer
 * sampling `identityHexAt` directly; a ramp is for bounded color arrays.
 */
export function identityRamp(steps: number, mode: SkinColorMode = "dark"): string[] {
	const n = Math.max(1, Math.floor(steps))
	return Array.from({ length: n }, (_, i) => identityHexAt(n === 1 ? 0 : i / (n - 1), mode))
}
