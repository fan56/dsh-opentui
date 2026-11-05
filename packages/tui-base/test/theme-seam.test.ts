import { describe, expect, test } from "bun:test"
import { bundledThemeNames, createThemeSeam, DEFAULT_THEME, isBundledTheme } from "../src/seams/theme"

function fakeTarget(start = DEFAULT_THEME) {
	const calls: string[] = []
	const target = {
		selected: start,
		set(theme: string) {
			calls.push(theme)
			target.selected = theme
			return true
		},
	}
	return { target, calls }
}

describe("ThemeSeam (batch 6 stub)", () => {
	test("bundled list = 32 v1 assets + opencode; default is the vendored default", () => {
		const names = bundledThemeNames()
		expect(DEFAULT_THEME).toBe("opencode")
		expect(names.length).toBe(33)
		for (const name of ["opencode", "catppuccin", "tokyonight", "dracula", "nord", "gruvbox"]) {
			expect(names).toContain(name)
		}
		expect(names).not.toContain("system") // generated from the terminal palette, not bundled
		expect([...names].sort()).toEqual(names)
	})

	test("setTheme accepts a bundled name and drives the provider", () => {
		const { target, calls } = fakeTarget()
		const seam = createThemeSeam(target)
		expect(seam.current()).toBe("opencode")
		expect(seam.setTheme("catppuccin")).toBe(true)
		expect(calls).toEqual(["catppuccin"])
		expect(seam.current()).toBe("catppuccin")
	})

	test("setTheme rejects unknown / non-bundled names without touching the provider", () => {
		const { target, calls } = fakeTarget()
		const seam = createThemeSeam(target)
		for (const bad of ["", "nope", "system", "Catppuccin", "__proto__", "toString"]) {
			expect(seam.setTheme(bad)).toBe(false)
			expect(isBundledTheme(bad)).toBe(false)
		}
		expect(calls).toEqual([])
		expect(seam.current()).toBe("opencode")
	})

	test("list() is the bundled list", () => {
		const seam = createThemeSeam(fakeTarget().target)
		expect(seam.list()).toEqual(bundledThemeNames())
	})
})
