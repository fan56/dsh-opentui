/**
 * ThemeSeam — theme-switch contract (batch 6 stub).
 *
 * The theme SOURCE is the vendored theme system (`context/theme.tsx`
 * ThemeProvider over `src/theme` + `src/vendor/theme`); the default is the
 * vendored default `opencode` (ThemeProvider store `active: "opencode"`).
 * This seam is the switch point a host (shell command, config UI) calls; it
 * validates the name against the bundled list before touching the provider.
 *
 * Structural target: the vendored `useThemes()` service satisfies it
 * (`has` / `set` / `selected`), so a host passes `createThemeSeam(useThemes())`.
 */
import { DEFAULT_THEMES } from "../theme"

/** Default theme for the rebuilt stack (vendored default). */
export const DEFAULT_THEME = "opencode"

/** The bundled theme names: 32 v1 assets + the v2 `opencode` default.
 * (`system` is generated from the terminal palette, not bundled.) */
export function bundledThemeNames(): string[] {
	return [...Object.keys(DEFAULT_THEMES), DEFAULT_THEME].sort()
}

export function isBundledTheme(name: string): boolean {
	return name === DEFAULT_THEME || Object.hasOwn(DEFAULT_THEMES, name)
}

export interface ThemeSeam {
	/** Switch the active theme; false (no-op) when `name` is not bundled. */
	setTheme(name: string): boolean
	/** Active theme name. */
	current(): string
	/** Valid `setTheme` arguments. */
	list(): string[]
}

/** The slice of the vendored `useThemes()` service the seam drives. */
export type ThemeSwitchTarget = {
	set(theme: string): boolean
	readonly selected: string
}

export function createThemeSeam(target: ThemeSwitchTarget): ThemeSeam {
	return {
		setTheme(name) {
			if (!isBundledTheme(name)) return false
			return target.set(name)
		},
		current: () => target.selected,
		list: bundledThemeNames,
	}
}
