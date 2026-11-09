import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import {
	POWERLINE_ARROW,
	POWERLINE_COLORS,
	autoContrast,
	brightness,
	brandSegment,
	colorRgb,
	contextSegment,
	messagesSegment,
	modelSegment,
	powerlinePalette,
	providerSegment,
	resolvePalette,
	sessionFooterSegments,
	speedSegment,
	cacheSegment,
	toolSegment,
	type EffortLevel,
} from "../src/routes/session/powerline"

/** A token-valued fake ComponentTheme with stable, distinguishable hues. */
function fakeTheme() {
	const hue = (base: number) => ({
		400: RGBA.fromHex(`#${base.toString(16).padStart(6, "0")}04`),
		500: RGBA.fromHex(`#${base.toString(16).padStart(6, "0")}05`),
		600: RGBA.fromHex(`#${base.toString(16).padStart(6, "0")}06`),
		700: RGBA.fromHex(`#${base.toString(16).padStart(6, "0")}07`),
	})
	return {
		hue: {
			accent: hue(0x4d6bfe),
			interactive: hue(0x6a1b9a),
			neutral: hue(0x616161),
		},
		text: {
			faint: RGBA.fromHex("#101010"),
			muted: RGBA.fromHex("#202020"),
			feedback: {
				success: { base: RGBA.fromHex("#00ff00"), muted: RGBA.fromHex("#004400") },
				warning: { base: RGBA.fromHex("#ffc107"), muted: RGBA.fromHex("#443300") },
				error: { base: RGBA.fromHex("#f44336"), muted: RGBA.fromHex("#441100") },
				info: { base: RGBA.fromHex("#00bbff"), muted: RGBA.fromHex("#003344") },
			},
		},
		border: { base: RGBA.fromHex("#7aa2f7") },
	} as unknown as Parameters<typeof powerlinePalette>[0]
}

describe("color math (kit parity)", () => {
	test("hex and token RGBA normalize to the same 0-255 rgb triple", () => {
		expect(colorRgb("#4D6BFE")).toEqual([77, 107, 254])
		expect(colorRgb(RGBA.fromHex("#4D6BFE"))).toEqual([77, 107, 254])
		expect(colorRgb("nope")).toEqual([0, 0, 0])
	})

	test("brightness thresholds match the kit's amber classification", () => {
		expect(brightness(POWERLINE_COLORS.contextWarn)).toBeGreaterThan(0.6) // #FFC107 → bright
		expect(brightness(POWERLINE_COLORS.brand)).toBeLessThan(0.6) // brand blue → dark
		expect(brightness(RGBA.fromHex(POWERLINE_COLORS.contextWarn))).toBe(brightness(POWERLINE_COLORS.contextWarn))
	})

	test("autoContrast: dark text on bright fills, white on dark fills", () => {
		expect(autoContrast(POWERLINE_COLORS.contextWarn)).not.toBe(autoContrast(POWERLINE_COLORS.brand))
		expect(autoContrast(RGBA.fromHex("#ffc107"))).toBe(autoContrast("#ffc107"))
	})
})

describe("segment builders", () => {
	test("brand segment is always present and uses the identity brand blue (skin contract)", () => {
		const withTheme = brandSegment(fakeTheme())
		expect(withTheme.text).toBe("dsh")
		// Skin contract §1: the dsh fill is the IDENTITY brand blue, not the
		// theme accent token — dark #4D6BFE, light deepened #3B5BDB.
		expect(withTheme.bg).toBe("#4d6bfe")
		expect(brandSegment(fakeTheme(), undefined, "light").bg).toBe("#3b5bdb")
		const fallback = brandSegment()
		expect(fallback.bg).toBe(POWERLINE_COLORS.brand.toLowerCase())
	})

	test("provider carries the ☁️ lead; model shows the per-level effort glyph (tui-pi parity)", () => {
		expect(providerSegment("", undefined)).toBeNull()
		expect(providerSegment("bigmodel", undefined)?.text).toBe("☁️ bigmodel")
		expect(modelSegment("", "high")).toBeNull()
		expect(modelSegment("glm-5.3-flash", "off")?.text).toBe("🤖 glm-5.3-flash")
		// tui-pi thinkingIcon ladder: minimal ◔ / low ◑ / medium ◕ / high ● / xhigh ◉ / max ★.
		expect(modelSegment("glm-5.3-flash", "medium")?.text).toBe("🤖 glm-5.3-flash ◕ medium")
		expect(modelSegment("glm-5.3-flash", "max")?.text).toBe("🤖 glm-5.3-flash ★ max")
		expect(modelSegment("glm-5.3-flash", "minimal")?.text).toBe("🤖 glm-5.3-flash ◔ minimal")
	})

	test("model fill follows the effort ramp (theme tokens)", () => {
		const theme = fakeTheme()
		const levels: EffortLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
		const fills = new Set(levels.map((l) => modelSegment("m", l, theme)!.bg))
		expect(fills.size).toBe(levels.length) // every level maps to a distinct token fill
		expect(modelSegment("m", "off", theme)!.bg).toBe(theme.text.faint)
	})

	test("context segment: ramps on % and omits unknown", () => {
		expect(contextSegment(null)).toBeNull()
		expect(contextSegment(-1)).toBeNull()
		expect(contextSegment(12)?.text).toBe("🧠 12%")
		const theme = fakeTheme()
		const ramp = [30, 65, 80, 95].map((p) => contextSegment(p, theme)!.bg)
		expect(ramp[0]).toBe(theme.text.feedback.success.base)
		expect(ramp[1]).toBe(theme.text.feedback.warning.base)
		expect(ramp[2]).toBe(theme.text.feedback.error.muted)
		expect(ramp[3]).toBe(theme.text.feedback.error.base)
		// fallback palette (no theme): the kit hex ramp
		expect(contextSegment(30)!.bg).toBe(POWERLINE_COLORS.contextOk)
		expect(contextSegment(95)!.bg).toBe(POWERLINE_COLORS.contextDanger)
	})

	test("counters omit at zero; speed omits when unknown; negative tps omitted", () => {
		expect(messagesSegment(0)).toBeNull()
		expect(messagesSegment(3)?.text).toBe("💬 3")
		expect(toolSegment(0)).toBeNull()
		expect(toolSegment(7)?.text).toBe("🛠 7")
		expect(speedSegment(null)).toBeNull()
		expect(speedSegment(-4)).toBeNull()
		expect(speedSegment(87.4)?.text).toBe("⚡ 87 tok/s")
	})
})

describe("footer assembly", () => {
	test("sessionFooterSegments keeps the kit segment order and drops empty data", () => {
		const segs = sessionFooterSegments({
			provider: "bigmodel",
			model: "glm-5.3-flash",
			effort: "high",
			contextPct: 42,
			messages: 2,
			tools: 0,
			tps: null,
		})
		expect(segs.map((s) => s.text)).toEqual([
			"dsh",
			"☁️ bigmodel",
			"🤖 glm-5.3-flash ● high",
			"🧠 42%",
			"💬 2",
			// Batch D3: no hint segment — hints moved to the last row.
		])
	})

	test("empty data still yields the brand segment alone (no hint segment)", () => {
		expect(sessionFooterSegments({}).map((s) => s.text)).toEqual(["dsh"])
	})
})

describe("palette resolution", () => {
	test("no theme → POWERLINE_COLORS fallback map; theme → token fills", () => {
		const fallback = resolvePalette()
		expect(fallback.brand).toBe(POWERLINE_COLORS.brand)
		const theme = fakeTheme()
		const themed = powerlinePalette(theme)
		expect(themed.brand).toBe(theme.hue.accent[500])
		expect(themed.provider).toBe(theme.hue.interactive[500])
		expect(themed.contextDanger).toBe(theme.text.feedback.error.base)
	})
})

test("arrow constant survives the port", () => {
	expect(POWERLINE_ARROW).toBe("\ue0b0")
})

test("batch F2: ⚡ CH segment — tui-pi label shape, hidden without cache traffic", () => {
	expect(cacheSegment(null)).toBeNull()
	expect(cacheSegment(Number.NaN)).toBeNull()
	expect(cacheSegment(98.43)?.text).toBe("⚡ CH98.4%")
	expect(cacheSegment(0)?.text).toBe("⚡ CH0.0%")
	const texts = sessionFooterSegments({ provider: "p", model: "m", contextPct: 10, messages: 2, cacheHitRate: 50 }).map((s) => s.text)
	expect(texts.indexOf("⚡ CH50.0%")).toBe(texts.indexOf("🧠 10%") + 1)
	expect(sessionFooterSegments({ messages: 1 }).some((s) => s.text.includes("CH"))).toBe(false)
})

test("batch H2: brand segment carries the agent preset label (tui-pi footer parity)", () => {
	expect(brandSegment(undefined, "Standard").text).toBe("dsh(Standard)")
	// No preset face / empty roster / nothing selected → the plain "dsh".
	expect(brandSegment().text).toBe("dsh")
	expect(brandSegment(undefined, "").text).toBe("dsh")
	const texts = sessionFooterSegments({ presetLabel: "PTC", messages: 1 }).map((s) => s.text)
	expect(texts[0]).toBe("dsh(PTC)")
	expect(sessionFooterSegments({ messages: 1 })[0].text).toBe("dsh")
})

/**
 * Visual-acceptance fix (dsh brand vs provider collision): on dsh-blue the
 * brand fill and interactive[500] are the SAME color (#4D6BFE), so the
 * U+E0B0 chevron between the two segments was invisible. providerFill now
 * walks the interactive ramp until the fill clears
 * POWERLINE_MIN_SEGMENT_DISTANCE from the brand fill. These tests pin the
 * real parse chain (bundled JSON → resolveThemeDocument → ComponentTheme)
 * across the three acceptance themes, dark AND light.
 */
import { getDshBlueTheme, parseTheme } from "../src/theme/index"
import { resolveThemeDocument } from "../src/vendor/theme/src/tui/resolve"
import { createComponentTheme } from "../src/theme/component"
import dshBlueJson from "../src/theme/assets/v2/dsh-blue.json"
import tokyonightJson from "../src/theme/assets/tokyonight.json"
import gruvboxJson from "../src/theme/assets/gruvbox.json"
import { POWERLINE_MIN_SEGMENT_DISTANCE, colorDistance } from "../src/routes/session/powerline"

describe("provider fill never collides with the brand fill (real parse chain)", () => {
	// v2 (dsh-blue) parses directly; tokyonight/gruvbox are v1 and migrate
	// through parseTheme — the same dispatch listThemes()/parseTheme uses.
	function realTheme(source: unknown, name: string) {
		const document = name === "dsh-blue" ? getDshBlueTheme() : parseTheme(source as never, name)
		return (mode: "dark" | "light") => createComponentTheme(() => resolveThemeDocument(document, mode))
	}
	const themes = {
		"dsh-blue": realTheme(dshBlueJson, "dsh-blue"),
		tokyonight: realTheme(tokyonightJson, "tokyonight"),
		gruvbox: realTheme(gruvboxJson, "gruvbox"),
	}

	test("both fills always clear POWERLINE_MIN_SEGMENT_DISTANCE (80 euclid)", () => {
		for (const [name, make] of Object.entries(themes)) {
			for (const mode of ["dark", "light"] as const) {
				const theme = make(mode)
				const brand = brandSegment(theme, undefined, mode).bg
				const provider = providerSegment("bigmodel", theme, mode)!.bg
				const d = colorDistance(brand, provider)
				expect(d).toBeGreaterThanOrEqual(POWERLINE_MIN_SEGMENT_DISTANCE)
				// And the segment pair actually renders both sides of the chevron.
				expect(providerSegment("", theme)).toBeNull()
			}
		}
	})

	test("dsh-blue shifts provider off interactive[500] (was brand-identical)", () => {
		// The bug, pinned: interactive[500] equaled the brand fill exactly.
		const theme = themes["dsh-blue"]("dark")
		expect(colorDistance(brandSegment(theme, undefined, "dark").bg, theme.hue.interactive[500])).toBe(0)
		// The fix: dark walks to 700 (#2a3d9e), light to 700 (#9daff0).
		// (RGBA has no structural equality — compare by value distance.)
		for (const mode of ["dark", "light"] as const) {
			const t = themes["dsh-blue"](mode)
			expect(colorDistance(providerSegment("p", t, mode)!.bg, t.hue.interactive[700])).toBe(0)
		}
	})

	test("tokyonight / gruvbox keep interactive[500] unless the brand fill is too close", () => {
		// fix/theme-legacy: v1 migration now anchors accent/interactive[500] at the exact
		// original hex, which moved these fills. The invariant that matters is unchanged:
		// the provider fill clears POWERLINE_MIN_SEGMENT_DISTANCE from the brand fill, and
		// when interactive[500] already clears it, the fill stays interactive[500].
		for (const name of ["tokyonight", "gruvbox"] as const) {
			for (const mode of ["dark", "light"] as const) {
				const t = themes[name](mode)
				const brand = brandSegment(t, undefined, mode).bg
				const provider = providerSegment("p", t, mode)!.bg
				expect(colorDistance(brand, provider)).toBeGreaterThanOrEqual(POWERLINE_MIN_SEGMENT_DISTANCE)
				const clearsAt500 = colorDistance(brand, t.hue.interactive[500]) >= POWERLINE_MIN_SEGMENT_DISTANCE
				expect(colorDistance(provider, t.hue.interactive[clearsAt500 ? 500 : 700])).toBe(0)
			}
		}
		// concrete walk pins: tokyonight dark (82.3), gruvbox dark (129.2) and gruvbox
		// light (112.4) keep interactive[500]; tokyonight light (39 at 500, 78.8 at 600)
		// walks to interactive[700].
		expect(colorDistance(providerSegment("p", themes.tokyonight("dark"), "dark")!.bg, themes.tokyonight("dark").hue.interactive[500])).toBe(0)
		expect(colorDistance(providerSegment("p", themes.gruvbox("light"), "light")!.bg, themes.gruvbox("light").hue.interactive[500])).toBe(0)
		expect(colorDistance(providerSegment("p", themes.tokyonight("light"), "light")!.bg, themes.tokyonight("light").hue.interactive[700])).toBe(0)
	})

	test("concrete deltas per acceptance theme/mode (regression pins)", () => {
		const delta = (name: string, mode: "dark" | "light") => {
			const t = themes[name](mode)
			return Math.round(
				colorDistance(brandSegment(t, undefined, mode).bg, providerSegment("p", t, mode)!.bg),
			)
		}
		// fix/theme-legacy: v1 accents are the exact original hex now, so the v1 rows moved
		// (tokyonight 96→82/116→131, gruvbox 165→129/96→112); dsh-blue (v2) is untouched.
		expect(delta("dsh-blue", "dark")).toBe(112)
		expect(delta("dsh-blue", "light")).toBe(131)
		expect(delta("tokyonight", "dark")).toBe(82)
		expect(delta("tokyonight", "light")).toBe(131)
		expect(delta("gruvbox", "dark")).toBe(129)
		expect(delta("gruvbox", "light")).toBe(112)
	})
})
