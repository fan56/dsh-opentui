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
	test("brand segment is always present and uses the accent token with a theme", () => {
		const withTheme = brandSegment(fakeTheme())
		expect(withTheme.text).toBe("dsh")
		expect(withTheme.bg).toBeInstanceOf(RGBA)
		const fallback = brandSegment()
		expect(fallback.bg).toBe(POWERLINE_COLORS.brand)
	})

	test("provider / model omit on empty labels; model carries ◕ effort", () => {
		expect(providerSegment("", undefined)).toBeNull()
		expect(providerSegment("bigmodel", undefined)?.text).toBe("bigmodel")
		expect(modelSegment("", "high")).toBeNull()
		expect(modelSegment("glm-5.3-flash", "off")?.text).toBe("🤖 glm-5.3-flash")
		expect(modelSegment("glm-5.3-flash", "high")?.text).toBe("🤖 glm-5.3-flash ◕ high")
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
			"bigmodel",
			"🤖 glm-5.3-flash ◕ high",
			"🧠 42%",
			"💬 2",
			// Batch H1: the search hint rides the footer, default on.
			"Ctrl+Shift+F: search",
		])
	})

	test("empty data still yields the brand segment plus the search hint", () => {
		expect(sessionFooterSegments({}).map((s) => s.text)).toEqual(["dsh", "Ctrl+Shift+F: search"])
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
