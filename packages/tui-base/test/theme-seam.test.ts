import { describe, expect, test } from "bun:test"
import { bundledThemeNames, createThemeSeam, DEFAULT_THEME, isBundledTheme } from "../src/seams/theme"
import { allThemes } from "../src/theme"

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
	test("bundled list = 32 v1 assets + the v2 documents (opencode, dsh-blue); default is dsh-blue", () => {
		const names = bundledThemeNames()
		expect(DEFAULT_THEME).toBe("dsh-blue")
		expect(names.length).toBe(34)
		for (const name of ["opencode", "dsh-blue", "catppuccin", "tokyonight", "dracula", "nord", "gruvbox"]) {
			expect(names).toContain(name)
		}
		expect(names).not.toContain("system") // generated from the terminal palette, not bundled
		expect([...names].sort()).toEqual(names)
	})

	test("the dsh-blue default parses as a v2 document with light+dark modes (α skin layer)", () => {
		const source = allThemes()["dsh-blue"]
		expect(source).toBeDefined()
		// v2 documents carry base/light/dark; v1 assets carry the `theme` key.
		expect("theme" in (source as object)).toBe(false)
		expect("base" in (source as object)).toBe(true)
		expect("light" in (source as object)).toBe(true)
		expect("dark" in (source as object)).toBe(true)
	})

	test("setTheme accepts a bundled name and drives the provider", () => {
		const { target, calls } = fakeTarget()
		const seam = createThemeSeam(target)
		expect(seam.current()).toBe(DEFAULT_THEME)
		expect(seam.setTheme("catppuccin")).toBe(true)
		expect(calls).toEqual(["catppuccin"])
		expect(seam.current()).toBe("catppuccin")
	})

	test("setTheme accepts both v2 document names (opencode + dsh-blue)", () => {
		const { target, calls } = fakeTarget("catppuccin")
		const seam = createThemeSeam(target)
		expect(seam.setTheme("dsh-blue")).toBe(true)
		expect(seam.setTheme("opencode")).toBe(true)
		expect(calls).toEqual(["dsh-blue", "opencode"])
	})

	test("setTheme rejects unknown / non-bundled names without touching the provider", () => {
		const { target, calls } = fakeTarget()
		const seam = createThemeSeam(target)
		for (const bad of ["", "nope", "system", "Catppuccin", "__proto__", "toString"]) {
			expect(seam.setTheme(bad)).toBe(false)
			expect(isBundledTheme(bad)).toBe(false)
		}
		expect(calls).toEqual([])
		expect(seam.current()).toBe(DEFAULT_THEME)
	})

	test("list() is the bundled list", () => {
		const seam = createThemeSeam(fakeTarget().target)
		expect(seam.list()).toEqual(bundledThemeNames())
	})
})
