import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { contrastRatio, ensureContrast, relativeLuminance } from "../src/theme/contrast"

const hex = (value: string) => RGBA.fromHex(value)

describe("panel contrast guard", () => {
	test("relative luminance matches the WCAG sRGB formula", () => {
		expect(relativeLuminance(hex("#000000"))).toBeCloseTo(0, 5)
		expect(relativeLuminance(hex("#ffffff"))).toBeCloseTo(1, 5)
		// Mid grey #808080 is ~0.2159 by the piecewise sRGB transfer function.
		expect(relativeLuminance(hex("#808080"))).toBeCloseTo(0.2159, 3)
	})

	test("contrastRatio is symmetric and bounded", () => {
		const a = hex("#ffffff")
		const b = hex("#000000")
		expect(contrastRatio(a, b)).toBeCloseTo(21, 4)
		expect(contrastRatio(b, a)).toBeCloseTo(21, 4)
		expect(contrastRatio(a, a)).toBeCloseTo(1, 6)
	})

	test("keeps the theme token when it already clears the floor", () => {
		const fg = hex("#eeeeee")
		const bg = hex("#141419")
		expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5)
		expect(ensureContrast(fg, bg, 4.5, hex("#000000"))).toBe(fg)
	})

	test("falls back to the supplied primary text below the floor", () => {
		// dsh-blue light: markdown.code #3d9a57 on raised.base #fafafa = 3.38.
		const code = hex("#3d9a57")
		const content = hex("#fafafa")
		const base = hex("#1a1a1a")
		expect(contrastRatio(code, content)).toBeLessThan(4.5)
		expect(ensureContrast(code, content, 4.5, base)).toBe(base)
	})

	test("returns the foreground itself when no fallback is supplied", () => {
		const low = hex("#3d9a57")
		const content = hex("#fafafa")
		expect(ensureContrast(low, content)).toBe(low)
	})
})
