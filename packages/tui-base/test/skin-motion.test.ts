/**
 * Skin lane β tests: identity gradient interpolation (skin/identity.ts),
 * motion tier + auto-degradation + frame gating (skin/motion.ts), the
 * comet track bounce math (status-bar.tsx), the gradient text font
 * fallback (component/gradient-text.tsx), and the powerline rolling-number
 * fixed-width math (powerline.tsx). Pure logic only — no renderer.
 */
import { describe, expect, test } from "bun:test"
import { measureText } from "@opentui/core"
import {
	IDENTITY_GRADIENT,
	brandBlue,
	hexToRgb,
	identityAt,
	identityHexAt,
	identityRamp,
	lerpRgb,
	rgbToHex,
} from "../src/skin/identity"
import {
	IDLE_FPS,
	ROLL_MS,
	STREAM_FPS,
	confirmTerminalCapabilities,
	getMotionTier,
	isMotionBusy,
	motionAnimationRunning,
	motionDecorationsEnabled,
	motionFrameRate,
	refreshAutoTier,
	resolveAutoTier,
	resolveEffectiveTier,
	resolveMotionPreference,
	setMotionBusy,
	setMotionTier,
} from "../src/skin/motion"
import { cometPosition, cometRampChar } from "../src/routes/session/status-bar"
import { pickAsciiFont, stripFontTags } from "../src/component/gradient-text"
import {
	elapsedSegment,
	formatRolling,
	rollValue,
	sessionFooterSegments,
	smootherstep,
	speedSegment,
	contextSegment,
} from "../src/routes/session/powerline"

afterEachDefault()

function afterEachDefault() {
	// reset the motion module singletons so tests stay order-independent
	setMotionTier(undefined)
	setMotionBusy(false)
	refreshAutoTier()
}

describe("skin/identity gradient interpolation", () => {
	test("endpoints match the contract colors", () => {
		expect(identityHexAt(0, "dark")).toBe("#4d6bfe")
		expect(identityHexAt(1, "dark")).toBe("#8b5cf6")
		expect(identityHexAt(0, "light")).toBe("#3b5bdb")
		expect(identityHexAt(1, "light")).toBe("#7c3aed")
		expect(IDENTITY_GRADIENT.dark.from).toEqual({ r: 0x4d, g: 0x6b, b: 0xfe })
	})

	test("midpoint is the channel average", () => {
		const mid = identityAt(0.5, "dark")
		expect(Math.round(mid.r)).toBe(Math.round((0x4d + 0x8b) / 2))
		expect(Math.round(mid.g)).toBe(Math.round((0x6b + 0x5c) / 2))
		expect(Math.round(mid.b)).toBe(Math.round((0xfe + 0xf6) / 2))
	})

	test("t clamps outside [0,1] and ignores NaN", () => {
		expect(identityHexAt(-3, "dark")).toBe(identityHexAt(0, "dark"))
		expect(identityHexAt(7, "dark")).toBe(identityHexAt(1, "dark"))
		// NaN → treated as 0 (clamp01 branch), never a malformed hex
		expect(identityHexAt(Number.NaN, "dark")).toBe("#4d6bfe")
	})

	test("light mode is a deepened pair (darker than dark mode at t=0)", () => {
		const dark0 = hexToRgb(brandBlue("dark"))
		const light0 = hexToRgb(brandBlue("light"))
		expect(light0.r + light0.g + light0.b).toBeLessThan(dark0.r + dark0.g + dark0.b)
	})

	test("brandBlue is the ramp start; ramp samples stay hex and monotone", () => {
		expect(brandBlue()).toBe("#4d6bfe")
		expect(brandBlue("light")).toBe("#3b5bdb")
		const ramp = identityRamp(5, "dark")
		expect(ramp).toHaveLength(5)
		for (const hex of ramp) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
		expect(ramp[0]).toBe("#4d6bfe")
		expect(ramp[4]).toBe("#8b5cf6")
	})

	test("hex/rgb helpers round-trip and lerp is linear per channel", () => {
		expect(hexToRgb("#4D6BFE")).toEqual({ r: 77, g: 107, b: 254 })
		expect(rgbToHex({ r: 77, g: 107, b: 254 })).toBe("#4d6bfe")
		expect(hexToRgb("nope")).toEqual({ r: 0, g: 0, b: 0 })
		expect(lerpRgb({ r: 0, g: 10, b: 20 }, { r: 100, g: 110, b: 120 }, 0.25)).toEqual({
			r: 25,
			g: 35,
			b: 45,
		})
	})
})

describe("skin/motion auto-degradation", () => {
	test("reduced before capabilities confirm, and on confirmed non-truecolor", () => {
		expect(resolveAutoTier({})).toBe("reduced")
		expect(resolveAutoTier({ truecolorConfirmed: false })).toBe("reduced")
		expect(resolveAutoTier({ truecolorConfirmed: true })).toBe("full")
	})

	test("tmux / SSH force reduced even with confirmed truecolor", () => {
		for (const env of [
			{ tmux: "/tmp/tmux-0/default,1,0", truecolorConfirmed: true },
			{ sshConnection: "::1 2", truecolorConfirmed: true },
			{ sshTty: "/dev/ttys001", truecolorConfirmed: true },
		]) {
			expect(resolveAutoTier(env)).toBe("reduced")
		}
	})

	test("effective tier: explicit user choice wins, otherwise auto", () => {
		expect(resolveEffectiveTier(undefined, "reduced")).toBe("reduced")
		expect(resolveEffectiveTier("full", "reduced")).toBe("full")
		expect(resolveEffectiveTier("off", "full")).toBe("off")
	})
})

describe("skin/motion boot preference resolution (env > persisted > auto)", () => {
	test("a valid env value beats everything, including the persisted key", () => {
		expect(resolveMotionPreference("full", "reduced")).toBe("full")
		expect(resolveMotionPreference("off", "full")).toBe("off")
		expect(resolveMotionPreference("reduced", undefined)).toBe("reduced")
	})

	test("env `auto` (or unset) falls through to the persisted key", () => {
		expect(resolveMotionPreference("auto", "full")).toBe("full")
		expect(resolveMotionPreference(undefined, "reduced")).toBe("reduced")
		expect(resolveMotionPreference(undefined, "off")).toBe("off")
	})

	test("persisted `auto` (or no source at all) resolves to the auto tier", () => {
		expect(resolveMotionPreference(undefined, "auto")).toBeUndefined()
		expect(resolveMotionPreference("auto", undefined)).toBeUndefined()
		expect(resolveMotionPreference(undefined, undefined)).toBeUndefined()
	})

	test("garbage values are ignored and never shadow a valid lower source", () => {
		expect(resolveMotionPreference("turbo", "full")).toBe("full")
		expect(resolveMotionPreference("FULL", "reduced")).toBe("full")
		expect(resolveMotionPreference(" full ", undefined)).toBe("full")
		expect(resolveMotionPreference("", "off")).toBe("off")
		expect(resolveMotionPreference("turbo", "also-garbage")).toBeUndefined()
	})
})

describe("skin/motion tier + frame gating (module API)", () => {
	test("default boot state: reduced until capabilities confirm", () => {
		afterEachDefault()
		expect(getMotionTier()).toBe("reduced")
		confirmTerminalCapabilities({ rgb: true })
		expect(getMotionTier()).toBe("full")
		confirmTerminalCapabilities(null)
		expect(getMotionTier()).toBe("reduced")
		afterEachDefault()
	})

	test("frame rates: off pauses (undefined), reduced stays at the stream cap, full caps busy/idle", () => {
		confirmTerminalCapabilities({ rgb: true })
		setMotionBusy(true)
		expect(motionFrameRate()).toBe(STREAM_FPS)
		expect(STREAM_FPS).toBeLessThanOrEqual(12.5)
		setMotionBusy(false)
		expect(motionFrameRate()).toBe(IDLE_FPS)
		expect(IDLE_FPS).toBeLessThanOrEqual(24)

		setMotionTier("reduced")
		expect(motionFrameRate()).toBe(STREAM_FPS)
		expect(motionDecorationsEnabled()).toBe(false)
		expect(motionAnimationRunning()).toBe(true)

		setMotionTier("off")
		expect(motionFrameRate()).toBeUndefined()
		expect(motionAnimationRunning()).toBe(false)

		setMotionTier("full")
		expect(getMotionTier()).toBe("full")
		setMotionTier("bogus" as never)
		expect(getMotionTier()).toBe("full") // invalid input falls back to auto
		afterEachDefault()
	})

	test("busy flag entry point (host streaming/busy)", () => {
		confirmTerminalCapabilities({ rgb: true })
		expect(isMotionBusy()).toBe(false)
		setMotionBusy(true)
		expect(isMotionBusy()).toBe(true)
		expect(motionFrameRate()).toBe(STREAM_FPS)
		afterEachDefault()
		expect(ROLL_MS).toBe(300)
	})
})

describe("comet track math (status-bar)", () => {
	const TRACK_COLS = 15
	const ASSEMBLY = 2

	test("bounce stays inside the fixed 15-column track", () => {
		for (let step = 0; step < 26; step++) {
			const { start } = cometPosition(step)
			expect(start).toBeGreaterThanOrEqual(0)
			expect(start + ASSEMBLY).toBeLessThanOrEqual(TRACK_COLS) // whale spans 2
		}
	})

	test("matches the legacy runs-based formula exactly", () => {
		const span = TRACK_COLS - ASSEMBLY
		for (let s = 0; s < span * 2; s++) {
			const legacyStart = s < span ? s : span * 2 - s
			const legacyDirRight = s < span
			const legacyStern = legacyDirRight ? legacyStart : legacyStart + ASSEMBLY
			const legacyTailEnd = legacyDirRight ? legacyStern - 5 : legacyStern + 5
			const { start, dirRight, stern, tailEnd } = cometPosition(s)
			expect(start).toBe(legacyStart)
			expect(dirRight).toBe(legacyDirRight)
			expect(stern).toBe(legacyStern)
			expect(tailEnd).toBe(legacyTailEnd)
		}
	})

	test("legacy ▓▒░ ramp chars for distance behind the head", () => {
		expect(cometRampChar(1)).toBe("▓")
		expect(cometRampChar(2)).toBe("▒")
		expect(cometRampChar(4)).toBe("░")
		expect(cometRampChar(99)).toBe("░") // clamped
	})
})

describe("gradient text font fallback", () => {
	const TEXT = "DSH OPENTUI"

	test("block fits 93 cols (measured), tiny fits 80-col terminals", () => {
		expect(measureText({ text: TEXT, font: "block" }).width).toBe(93)
		expect(measureText({ text: TEXT, font: "tiny" }).width).toBe(40)
		expect(pickAsciiFont(TEXT, 93)).toBe("block")
		expect(pickAsciiFont(TEXT, 92)).toBe("tiny")
		expect(pickAsciiFont(TEXT, 80)).toBe("tiny")
	})

	test("cfonts color-slot markup is stripped for per-cell coloring", () => {
		expect(stripFontTags("<c1>██████</c1><c2>╗ </c2>")).toBe("██████╗ ")
		expect(stripFontTags("plain")).toBe("plain")
	})
})

describe("powerline rolling numbers", () => {
	test("formatRolling is fixed-width, space-padded, never truncated", () => {
		expect(formatRolling(42, 0, 3)).toBe(" 42")
		expect(formatRolling(7, 0, 3)).toBe("  7")
		expect(formatRolling(1000, 0, 3)).toBe("1000")
		expect(formatRolling(87.4, 1, 3)).toBe(" 87.4")
		expect(formatRolling(0, 0, 2)).toBe(" 0")
		expect(formatRolling(-5, 0, 3)).toBe(" -5")
	})

	test("rollValue eases from → to through smootherstep", () => {
		expect(smootherstep(0)).toBe(0)
		expect(smootherstep(1)).toBe(1)
		expect(smootherstep(0.5)).toBeCloseTo(0.5)
		expect(rollValue(10, 20, 0)).toBe(10)
		expect(rollValue(10, 20, 1)).toBe(20)
		expect(rollValue(10, 20, 0.5)).toBeCloseTo(15)
	})

	test("speed segment carries the tok/s roll spec (no glyph prefix); context the % spec", () => {
		const speed = speedSegment(87.4)
		expect(speed?.roll).toEqual({ value: 87.4, decimals: 0, width: 3, suffix: " tok/s" })
		// Footer context batch: the roll spec rides the percent (one decimal,
		// X/Y prefix frozen so the strip never re-flows mid-roll).
		const ctx = contextSegment(420, 1000)
		expect(ctx?.roll).toEqual({ value: 42, decimals: 1, width: 4, prefix: "🧠 420/1.0k(", suffix: "%)" })
	})

	test("elapsed segment (计时) rolls whole seconds and omits unknown", () => {
		expect(elapsedSegment(null)).toBeNull()
		expect(elapsedSegment(-1)).toBeNull()
		const seg = elapsedSegment(42)!
		expect(seg.text).toBe("⏱ 42s")
		expect(seg.roll?.value).toBe(42)
		expect(seg.roll?.suffix).toBe("s")
	})

	test("footer assembly keeps order with the elapsed segment", () => {
		const segs = sessionFooterSegments({ elapsedSec: 5, tps: 10 })
		// always-on counters (💬/🔧, tui-pi parity); context still drops out
		expect(segs.map((s) => s.text)).toEqual(["dsh", "💬 0 msgs", "🔧 0 tools", "⏱ 5s", "10 tok/s"])
	})
})
