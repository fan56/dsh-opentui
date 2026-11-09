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
	powerlineGradient,
	powerlineRampFamilies,
	providerSegment,
	relativeLuminance,
	resolvePalette,
	sessionFooterSegments,
	speedSegment,
	cacheSegment,
	toolSegment,
	contrastRatio,
	effectiveEffort,
	isExplicitEffort,
	decideEffort,
	defaultEffortToApply,
	DEFAULT_EFFORT,
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
		expect(modelSegment("glm-5.3-flash", "off")?.text).toBe("🤖 glm-5.3-flash ○ off")
		// tui-pi thinkingIcon ladder: minimal ◔ / low ◑ / medium ◕ / high ● / xhigh ◉ / max ★.
		expect(modelSegment("glm-5.3-flash", "medium")?.text).toBe("🤖 glm-5.3-flash ◕ medium")
		expect(modelSegment("glm-5.3-flash", "max")?.text).toBe("🤖 glm-5.3-flash ★ max")
		expect(modelSegment("glm-5.3-flash", "minimal")?.text).toBe("🤖 glm-5.3-flash ◔ minimal")
	})

	test("model name clips to 24 columns (tui-pi footer.ts:229 parity)", () => {
		// 24 columns exactly → unchanged.
		expect(modelSegment("models/glm-5.3-flash-big", "off")?.text).toBe("🤖 models/glm-5.3-flash-big ○ off")
		// Over budget → ellipsis at 24 columns total.
		expect(modelSegment("very-long-model-name-0123456789", "off")?.text).toBe(
			"🤖 very-long-model-name-01… ○ off",
		)
		// Short names pass through untouched.
		expect(modelSegment("glm-5.3-flash", "off")?.text).toBe("🤖 glm-5.3-flash ○ off")
	})

	test("model fill follows the effort ramp (theme tokens)", () => {
		const theme = fakeTheme()
		const levels: EffortLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
		const fills = new Set(levels.map((l) => modelSegment("m", l, theme)!.bg))
		expect(fills.size).toBe(levels.length) // every level maps to a distinct token fill
		expect(modelSegment("m", "off", theme)!.bg).toBe(theme.text.faint)
	})

	test("context segment: X/Y(x.x%) shape, degrades without a window, ramps at 50/70/90", () => {
		// Footer context batch (tui-pi footer.ts:243-256 parity): used-only
		// segments hide; the bare shape (no window) renders `🧠 used` on the
		// ok fill; the full shape is one-decimal percent capped at 100.
		expect(contextSegment(null, 1000)).toBeNull()
		expect(contextSegment(-1, 1000)).toBeNull()
		expect(contextSegment(420, null)?.text).toBe("🧠 420")
		expect(contextSegment(420, undefined)?.bg).toBe(POWERLINE_COLORS.contextOk)
		expect(contextSegment(1200, 10000)?.text).toBe("🧠 1.2k/10.0k(12.0%)")
		expect(contextSegment(12345, 10000)?.text).toBe("🧠 12.3k/10.0k(100.0%)")
		const theme = fakeTheme()
		// 45 / 55 / 75 / 95 percent — the 50/70/90 ladder (tui-pi contextBg).
		const ramp = [450, 550, 750, 950].map((used) => contextSegment(used, 1000, theme)!.bg)
		expect(ramp[0]).toBe(theme.text.feedback.success.base)
		expect(ramp[1]).toBe(theme.text.feedback.warning.base)
		expect(ramp[2]).toBe(theme.text.feedback.error.muted)
		expect(ramp[3]).toBe(theme.text.feedback.error.base)
		// fallback palette (no theme): the kit hex ramp
		expect(contextSegment(450, 1000)!.bg).toBe(POWERLINE_COLORS.contextOk)
		expect(contextSegment(950, 1000)!.bg).toBe(POWERLINE_COLORS.contextDanger)
		// A non-positive/NaN window reads as "unknown" → bare shape.
		expect(contextSegment(420, 0)?.text).toBe("🧠 420")
		expect(contextSegment(420, Number.NaN)?.text).toBe("🧠 420")
	})

	test("counters are always-on (tui-pi parity); speed omits when unknown; negative tps omitted", () => {
		expect(messagesSegment(0)?.text).toBe("💬 0 msgs")
		expect(messagesSegment(3)?.text).toBe("💬 3 msgs")
		expect(toolSegment(0)?.text).toBe("🔧 0 tools")
		expect(toolSegment(7)?.text).toBe("🔧 7 tools")
		expect(messagesSegment(Number.NaN)).toBeNull()
		expect(toolSegment(-1)).toBeNull()
		expect(speedSegment(null)).toBeNull()
		expect(speedSegment(-4)).toBeNull()
		expect(speedSegment(87.4)?.text).toBe("87 tok/s")
	})
})

describe("footer assembly", () => {
	test("sessionFooterSegments keeps the kit segment order and drops empty data", () => {
		const segs = sessionFooterSegments({
			provider: "bigmodel",
			model: "glm-5.3-flash",
			effort: "high",
			contextTokens: 420,
			contextWindow: 1000,
			messages: 2,
			tools: 0,
			tps: null,
		})
		expect(segs.map((s) => s.text)).toEqual([
			"dsh",
			"☁️ bigmodel",
			"🤖 glm-5.3-flash ● high",
			"🧠 420/1.0k(42.0%)",
			"💬 2 msgs",
			"🔧 0 tools",
			// Batch D3: no hint segment — hints moved to the last row.
		])
	})

	test("empty data still yields brand plus the always-on counters (no hint segment)", () => {
		expect(sessionFooterSegments({}).map((s) => s.text)).toEqual(["dsh", "💬 0 msgs", "🔧 0 tools"])
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
	const texts = sessionFooterSegments({ provider: "p", model: "m", contextTokens: 100, contextWindow: 1000, messages: 2, cacheHitRate: 50 }).map((s) => s.text)
	expect(texts.indexOf("⚡ CH50.0%")).toBe(texts.indexOf("🧠 100/1.0k(10.0%)") + 1)
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

/**
 * Footer-ramp feedback batch (item 1; supersedes the single blue ramp): the
 * strip keeps its segment identity/order but is no longer all blue. Hues are
 * drawn from the theme's named hue families while the fills stay strictly
 * ordered by WCAG relative luminance (deep→light). These tests pin the
 * ordering, hue diversity, label contrast, the >90% danger exception and the
 * missing-family fallback, across all three acceptance themes, dark AND light.
 */
describe("footer gradient (multi-hue ramp, ordered deep→light)", () => {
	const themeFor = (name: "dsh-blue" | "tokyonight" | "gruvbox", mode: "dark" | "light") => {
		const source = name === "dsh-blue" ? dshBlueJson : name === "tokyonight" ? tokyonightJson : gruvboxJson
		const document = name === "dsh-blue" ? getDshBlueTheme() : parseTheme(source as never, name)
		return createComponentTheme(() => resolveThemeDocument(document, mode))
	}

	const fullStrip = (theme: ReturnType<typeof themeFor>) =>
		sessionFooterSegments({
			provider: "bigmodel",
			model: "glm-5.3-flash",
			effort: "high",
			contextTokens: 100,
			contextWindow: 1000,
			cacheHitRate: 50,
			messages: 2,
			tools: 1,
			elapsedSec: 5,
			tps: 10,
			theme,
		})

	type Fill = ReturnType<typeof powerlineGradient>[number]

	/** Hue angle in degrees (for the diversity assertion only). */
	const hueOf = (color: Fill): number => {
		const [r, g, b] = colorRgb(color).map((value) => value / 255) as [number, number, number]
		const max = Math.max(r, g, b)
		const min = Math.min(r, g, b)
		const delta = max - min
		if (delta === 0) return 0
		const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
		return (raw * 60 + 360) % 360
	}
	/** Number of distinct 30° hue buckets across the fills. */
	const hueBuckets = (fills: readonly Fill[]): number => new Set(fills.map((fill) => Math.floor(hueOf(fill) / 30))).size

	const expectOrdered = (fills: readonly Fill[], minDistance = 30): void => {
		for (let i = 1; i < fills.length; i++) {
			expect(relativeLuminance(fills[i]!)).toBeGreaterThan(relativeLuminance(fills[i - 1]!))
			// Neighbours must still read as segments. The deep half is the tight
			// end; the old single blue ramp measured as low as 21 euclid here.
			expect(colorDistance(fills[i]!, fills[i - 1]!)).toBeGreaterThanOrEqual(minDistance)
		}
	}

	for (const themeName of ["dsh-blue", "tokyonight", "gruvbox"] as const) {
		for (const mode of ["dark", "light"] as const) {
			test(`${themeName} ${mode}: strict luminance ascension, labels ≥4.5:1, ≥3 hues`, () => {
				const theme = themeFor(themeName, mode)
				const segs = fullStrip(theme)
				expect(segs.length).toBe(9) // brand + 8 data segments
				const fills = segs.map((segment) => segment.bg)
				expectOrdered(fills)
				for (const fill of fills) {
					expect(contrastRatio(fill, autoContrast(fill))).toBeGreaterThanOrEqual(4.5)
				}
				expect(hueBuckets(fills)).toBeGreaterThanOrEqual(3)
			})
		}
	}

	test("families follow the preferred order and skip those the theme lacks", () => {
		const names = (name: "dsh-blue" | "tokyonight" | "gruvbox", mode: "dark" | "light") =>
			powerlineRampFamilies(themeFor(name, mode)).map((family) => family.name)
		expect(names("dsh-blue", "dark")).toEqual(["blue", "purple", "cyan", "green", "orange"])
		expect(names("dsh-blue", "light")).toEqual(["blue", "purple", "cyan", "green", "orange"])
		// tokyonight dark has no cyan/orange/yellow; gruvbox dark has no blue family.
		expect(names("tokyonight", "dark")).toEqual(["blue", "purple", "green"])
		expect(names("gruvbox", "dark")).toEqual(["green", "yellow", "orange"])
	})

	test("missing-family fallback: cycles what exists, then falls back to accent", () => {
		const base = themeFor("dsh-blue", "dark")
		const hue = base.hue
		const themeWith = (families: string[]) =>
			({
				...base,
				hue: Object.fromEntries(families.map((name) => [name, (hue as unknown as Record<string, unknown>)[name]])),
			}) as unknown as Parameters<typeof powerlineGradient>[0]

		// Two named families → cycle to three slots (last family repeats).
		const twoFamily = themeWith(["purple", "green"])
		expect(powerlineRampFamilies(twoFamily).map((family) => family.name)).toEqual(["purple", "green", "purple"])
		expectOrdered(powerlineGradient(twoFamily, 9))

		// No named family → accent/interactive hue only: monochrome, still ordered.
		const noFamily = themeWith(["accent", "interactive"])
		expect(powerlineRampFamilies(noFamily).map((family) => family.name)).toEqual(["accent"])
		const mono = powerlineGradient(noFamily, 9)
		// Single-hue fallback: luminance is the only ordering channel, so the
		// light half is tighter than the multi-hue ramps (the legacy blue ramp
		// measured 19–21 euclid there).
		expectOrdered(mono, 15)
		expect(hueBuckets(mono)).toBe(1)

		// No theme at all → hardcoded dsh-blue family hues; still ordered and multi-hue.
		const fallback = powerlineGradient(undefined, 9)
		expectOrdered(fallback)
		expect(hueBuckets(fallback)).toBeGreaterThanOrEqual(3)
	})

	test("danger context (>90%) keeps the error fill and skips the ramp", () => {
		const theme = themeFor("dsh-blue", "dark")
		const segs = sessionFooterSegments({
			model: "m",
			contextTokens: 950,
			contextWindow: 1000,
			theme,
		})
		const context = segs.find((segment) => segment.text.startsWith("🧠"))!
		expect(context.semantic).toBe("danger")
		expect(colorDistance(context.bg, theme.text.feedback.error.base)).toBe(0)
		// The non-semantic neighbours still walk the ramp monotonically.
		expectOrdered(segs.filter((segment) => !segment.semantic).map((segment) => segment.bg))
	})

	test("no-provider fallback still yields one monotonic readable ramp", () => {
		const segs = sessionFooterSegments({
			provider: "p",
			model: "m",
			contextTokens: 100,
			contextWindow: 1000,
			messages: 1,
			tools: 1,
		})
		const fills = segs.map((segment) => segment.bg)
		expectOrdered(fills)
		for (const fill of fills) {
			expect(contrastRatio(fill, autoContrast(fill))).toBeGreaterThanOrEqual(4.5)
		}
	})
})

/**
 * Footer-polish feedback batch (item 3): an unspecified think level means
 * "high" for display AND route; an explicit value — "off" included — is
 * never overwritten.
 */
describe("default effort policy", () => {
	test("unspecified resolves to high; explicit words (off included) are preserved", () => {
		expect(DEFAULT_EFFORT).toBe("high")
		expect(effectiveEffort(undefined)).toBe("high")
		expect(effectiveEffort(null)).toBe("high")
		expect(effectiveEffort("off")).toBe("off")
		expect(effectiveEffort("medium")).toBe("medium")
	})

	test("the footer shows ● high when no level is specified and ○ off when it is", () => {
		const unspecified = sessionFooterSegments({ model: "m" }).find((segment) => segment.text.startsWith("🤖"))!
		expect(unspecified.text).toBe("🤖 m ● high")
		const explicit = sessionFooterSegments({ model: "m", effort: "off" }).find((segment) =>
			segment.text.startsWith("🤖"),
		)!
		expect(explicit.text).toBe("🤖 m ○ off")
		// modelSegment's own default follows the same policy.
		expect(modelSegment("m")!.text).toBe("🤖 m ● high")
	})

	test("the route write happens only for an unspecified level on a high-capable ladder", () => {
		expect(defaultEffortToApply(undefined, ["low", "high"])).toBe("high")
		expect(defaultEffortToApply(undefined, [{ id: "high" }])).toBe("high")
		// Explicit levels (including off) win.
		expect(defaultEffortToApply("off", ["low", "high"])).toBeUndefined()
		expect(defaultEffortToApply("low", ["low", "high"])).toBeUndefined()
		// No high on the ladder → leave the host route alone.
		expect(defaultEffortToApply(undefined, ["low", "medium"])).toBeUndefined()
		expect(defaultEffortToApply(undefined, [])).toBeUndefined()
	})

	// Review 3.2: the seam's ladder is PROVIDER data — native ids such as
	// none/auto are explicit values too. EFFORT_ICONS is only the glyph
	// vocabulary; membership in it must never decide explicitness.
	test("provider-native ids are explicit: none/auto pass through, never coerced to high", () => {
		expect(effectiveEffort("none")).toBe("none")
		expect(effectiveEffort("auto")).toBe("auto")
		expect(effectiveEffort("thinking")).toBe("thinking")
		expect(isExplicitEffort("none")).toBe(true)
		expect(isExplicitEffort("high")).toBe(true)
		expect(isExplicitEffort("off")).toBe(true)
		expect(isExplicitEffort("   ")).toBe(false)
		expect(isExplicitEffort("")).toBe(false)
		expect(isExplicitEffort(undefined)).toBe(false)
		expect(isExplicitEffort(null)).toBe(false)
	})

	test("native ids suppress the default write exactly like known words", () => {
		expect(defaultEffortToApply("none", ["none", "auto", "high"])).toBeUndefined()
		expect(defaultEffortToApply("auto", ["none", "auto", "high"])).toBeUndefined()
		// Only a genuinely empty current value writes.
		expect(defaultEffortToApply("  ", ["none", "auto", "high"])).toBe("high")
	})

	test("native ids display verbatim with the ○ glyph fallback and the off fill", () => {
		const theme = fakeTheme()
		const none = modelSegment("m", "none", theme)!
		expect(none.text).toBe("🤖 m ○ none")
		expect(none.bg).toBe(resolvePalette(theme).thinking.off)
		expect(modelSegment("m", "auto")!.text).toBe("🤖 m ○ auto")
		expect(sessionFooterSegments({ model: "m", effort: "none" }).find((s) => s.text.startsWith("🤖"))!.text).toBe(
			"🤖 m ○ none",
		)
	})

	// Review 3.3: both effort sources must be consulted before the default
	// lands; the aggregation itself is order-independent, so a label-level
	// explicit off survives whichever source answers first.
	test("decideEffort: current wins over label; label explicit off beats the default", () => {
		expect(decideEffort(undefined, "off")).toEqual({ display: "off", explicit: "off" })
		expect(decideEffort("", "off")).toEqual({ display: "off", explicit: "off" })
		expect(decideEffort("none", "off")).toEqual({ display: "none", explicit: "none" })
		expect(decideEffort("high", undefined)).toEqual({ display: "high", explicit: "high" })
		expect(decideEffort(undefined, undefined)).toEqual({ display: DEFAULT_EFFORT })
		expect(decideEffort("   ", "  ")).toEqual({ display: DEFAULT_EFFORT })
	})

	test("timing: a label answer that lands first does NOT settle the default early", async () => {
		// Mirrors refreshFooterData's pending counter: the display is decided
		// only after BOTH sources answer (the old code painted high off the
		// thinking answer and the label's off never applied).
		let currentWord: string | undefined
		let labelWord: string | undefined
		let pending = 2
		let display: string | undefined
		const settle = () => {
			if (--pending > 0) return
			display = decideEffort(currentWord, labelWord).display
		}
		const label = Promise.resolve("off").then((word) => {
			labelWord = word
			settle()
		})
		const current = new Promise<string | undefined>((resolve) => setTimeout(() => resolve(undefined), 5)).then(
			(word) => {
				currentWord = word
				settle()
			},
		)
		await label
		expect(display).toBeUndefined() // label first: default must not land yet
		await current
		expect(display).toBe("off") // the label's explicit off survives
	})
})
