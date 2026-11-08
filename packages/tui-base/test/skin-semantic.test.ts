import { describe, expect, test } from "bun:test"
import {
	COMPOSER_BORDER_ROWS,
	COMPOSER_COMPACT_TERMINAL_ROWS,
	SKIN_FALLBACK,
	SKIN_FOCUS_BLUR_DEBOUNCE_MS,
	composerBorderSides,
	composerLayout,
	currentRowColors,
	focusedBorderColor,
	successColor,
	surfaceBorder,
	unfocusedBorderColor,
	warningColor,
} from "../src/skin/semantic"
import type { ComponentTheme } from "../src/theme/component"

/** Minimal ComponentTheme stub: the resolvers only read these token paths,
 * and hex strings satisfy the `RGBA | string` color types, so the tests
 * stay renderer-free (no @opentui/core import). */
function stubTheme(overrides?: Partial<Record<string, string>>): ComponentTheme {
	const at = (path: string, fallback: string) => overrides?.[path] ?? fallback
	return {
		border: { base: at("border.base", "#111111") },
		hue: { accent: { 500: at("accent", "#222222") } },
		text: {
			feedback: {
				warning: { base: at("warning", "#333333"), muted: at("warning.muted", "#33333388") },
				success: { base: at("success", "#444444"), muted: at("success.muted", "#44444488") },
			},
			action: { primary: { focused: at("row.text", "#555555") } },
		},
		background: { action: { primary: { focused: at("row.bg", "#666666") } } },
	} as unknown as ComponentTheme
}

describe("skin semantic colors", () => {
	test("focused border = accent hue, unfocused = border.base", () => {
		expect(focusedBorderColor(stubTheme())).toBe("#222222")
		expect(unfocusedBorderColor(stubTheme())).toBe("#111111")
	})

	test("warning / success tiers map to text.feedback", () => {
		expect(warningColor(stubTheme())).toBe("#333333")
		expect(successColor(stubTheme())).toBe("#444444")
	})

	test("current row = dialog-select token semantics (bg + text)", () => {
		const row = currentRowColors(stubTheme())
		expect(row.backgroundColor).toBe("#666666")
		expect(row.textColor).toBe("#555555")
	})

	test("no theme → the pre-skin fallback hexes", () => {
		expect(focusedBorderColor(undefined)).toBe(SKIN_FALLBACK.accent)
		expect(unfocusedBorderColor(undefined)).toBe(SKIN_FALLBACK.border)
		expect(warningColor(undefined)).toBe(SKIN_FALLBACK.warning)
		expect(successColor(undefined)).toBe(SKIN_FALLBACK.success)
		expect(currentRowColors(undefined).backgroundColor).toBeUndefined()
	})

	test("surfaceBorder: busy recolors to warning, focus sets the weight", () => {
		const theme = stubTheme()
		expect(surfaceBorder({ focused: true, theme })).toEqual({ borderStyle: "heavy", borderColor: "#222222" })
		expect(surfaceBorder({ focused: false, theme })).toEqual({ borderStyle: "single", borderColor: "#111111" })
		// Busy wins the color even while focused; weight still follows focus.
		expect(surfaceBorder({ busy: true, focused: true, theme })).toEqual({
			borderStyle: "heavy",
			borderColor: "#333333",
		})
		expect(surfaceBorder({ busy: true, focused: false, theme })).toEqual({
			borderStyle: "single",
			borderColor: "#333333",
		})
	})
})

describe("composer layout (H7 height formula + short-terminal rule)", () => {
	const busyWorst = { textareaLines: 8, footerRows: 0, paletteRows: 6 }

	test("four-side border adds exactly 2 rows to the explicit height", () => {
		const tall = composerLayout({ ...busyWorst, terminalRows: COMPOSER_COMPACT_TERMINAL_ROWS + 1 })
		expect(tall.border).toEqual(["top", "bottom", "left", "right"])
		expect(tall.height).toBe(8 + 0 + 6 + COMPOSER_BORDER_ROWS)
	})

	test("compact terminals drop the top/bottom sides (and their rows)", () => {
		const short = composerLayout({ ...busyWorst, terminalRows: COMPOSER_COMPACT_TERMINAL_ROWS })
		expect(short.border).toEqual(["left", "right"])
		expect(short.height).toBe(8 + 0 + 6)
	})

	test("single-line idle input keeps one visible row under a full border", () => {
		// The H7 finding: without +2 a 1-line input had zero visible rows.
		const layout = composerLayout({ textareaLines: 1, footerRows: 1, paletteRows: 0, terminalRows: 40 })
		expect(layout.height).toBe(1 + 1 + 2)
	})

	test("textarea height floors at 1", () => {
		const layout = composerLayout({ textareaLines: 0, footerRows: 0, paletteRows: 0, terminalRows: 40 })
		expect(layout.height).toBe(1 + COMPOSER_BORDER_ROWS)
	})

	test("80x24 busy: composer + fixed rows leave the transcript ≥ 6 rows", () => {
		// v2 page fixed rows outside the composer: powerline 1 + hints 1.
		const FIXED_PAGE_ROWS = 2
		const { height, border } = composerLayout({ ...busyWorst, terminalRows: 24 })
		expect(border).toEqual(["left", "right"]) // compact kicks in at 24
		const transcriptRows = 24 - FIXED_PAGE_ROWS - height
		expect(transcriptRows).toBeGreaterThanOrEqual(6)
		// With a full border the same terminal would fall short of the
		// guaranteed margin the contract demands for the activity frame.
		const framed = composerLayout({ ...busyWorst, terminalRows: COMPOSER_COMPACT_TERMINAL_ROWS + 1 })
		expect(framed.height).toBe(height + COMPOSER_BORDER_ROWS)
	})

	test("focus blur debounce is a positive, frame-scale constant", () => {
		expect(SKIN_FOCUS_BLUR_DEBOUNCE_MS).toBeGreaterThan(0)
		expect(SKIN_FOCUS_BLUR_DEBOUNCE_MS).toBeLessThanOrEqual(100)
	})
})
