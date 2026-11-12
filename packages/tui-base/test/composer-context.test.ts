/**
 * Composer info bar (user feedback batch, final spec): the pure formatting
 * contract for the composer's top-border title — `steer? dir branch`
 * segments joined by ` ── ` inside the border line.
 */
import { describe, expect, test } from "bun:test"
import {
	composerContextLabel,
	composerFrameTitle,
	spinnerFrame,
	truncateLeft,
} from "../src/routes/session/composer-context"
import { SPINNER_FRAMES } from "../src/component/spinner-frames"
import { stringWidth } from "../src/util/string-width"

const HOME = "/Users/me"

describe("composer context label", () => {
	test("home-abbreviates the directory and appends the branch", () => {
		expect(composerContextLabel({ cwd: `${HOME}/repo/dsh-opentui`, home: HOME, maxColumns: 80 })).toBe("~/repo/dsh-opentui")
		expect(
			composerContextLabel({ cwd: `${HOME}/repo/dsh-opentui`, branch: "feat/composer-context", home: HOME, maxColumns: 80 }),
		).toBe("~/repo/dsh-opentui · feat/composer-context")
	})

	test("outside home keeps the absolute path; empty cwd renders no row", () => {
		expect(composerContextLabel({ cwd: "/opt/work/app", home: HOME, maxColumns: 80 })).toBe("/opt/work/app")
		expect(composerContextLabel({ cwd: HOME, home: HOME, maxColumns: 80 })).toBe("~")
		expect(composerContextLabel({ cwd: "", branch: "main", maxColumns: 80 })).toBe("")
		expect(composerContextLabel({ cwd: "   ", maxColumns: 80 })).toBe("")
	})

	test("long paths clip from the left, keeping the tail and the branch", () => {
		const branch = "feat/composer-context"
		const label = composerContextLabel({
			cwd: `${HOME}/repo/a/very/long/workspace/path/dsh-opentui`,
			branch,
			home: HOME,
			maxColumns: 30,
		})
		expect(label.startsWith("…")).toBe(true)
		expect(label.endsWith(branch)).toBe(true)
		expect(stringWidth(label)).toBeLessThanOrEqual(30)
	})

	test("truncateLeft respects display width and the one-column floor", () => {
		expect(truncateLeft("short", 10)).toBe("short")
		expect(truncateLeft("abcdef", 0)).toBe("")
		expect(truncateLeft("abcdef", 1)).toBe("…")
		expect(truncateLeft("abcdef", 4)).toBe("…def")
		expect(stringWidth(truncateLeft("abcdefgh", 5))).toBeLessThanOrEqual(5)
		// Wide glyphs cost two columns (no overrun, no split of the tail).
		expect(stringWidth(truncateLeft("目录目录目录", 5))).toBeLessThanOrEqual(5)
	})
})

describe("composer frame title (top-border info bar)", () => {
	const title = (input: {
		steer?: boolean
		frame?: string
		cwd: string
		branch?: string
		home?: string
		cols: number
	}) => composerFrameTitle({ home: HOME, ...input })

	test("idle without a branch: one space-wrapped directory, no dash prefix, no steer segment", () => {
		const out = title({ cwd: `${HOME}/repo/dsh-opentui`, cols: 80 })
		expect(out).toBe(" ~/repo/dsh-opentui ")
		expect(out.includes("steer")).toBe(false)
		expect(out.includes("─")).toBe(false)
	})

	test("idle with a branch: segments joined by ` · `, text space-wrapped, no dash runs", () => {
		const out = title({ cwd: `${HOME}/repo/dsh-opentui`, branch: "main", cols: 80 })
		expect(out).toBe(" ~/repo/dsh-opentui · main ")
		expect(out.includes("steer")).toBe(false)
		expect(out.startsWith(" ")).toBe(true)
		expect(out.endsWith(" ")).toBe(true)
		expect(out.includes("─")).toBe(false)
	})

	test("steer state prepends the steer segment before dir and branch", () => {
		const out = title({ steer: true, cwd: `${HOME}/repo/dsh-opentui`, branch: "main", cols: 80 })
		expect(out).toBe(" steer · ~/repo/dsh-opentui · main ")
	})

	test("busy frame char prefixes the steer segment (⠋ steer, 7 cells)", () => {
		const out = title({ steer: true, frame: "⠋", cwd: `${HOME}/repo/dsh-opentui`, branch: "main", cols: 80 })
		expect(out).toBe(" ⠋ steer · ~/repo/dsh-opentui · main ")
		// No-frame call = the bare `steer` word (undefined AND empty both).
		expect(title({ steer: true, cwd: `${HOME}/repo/dsh-opentui`, branch: "main", cols: 80 })).toBe(
			" steer · ~/repo/dsh-opentui · main ",
		)
		expect(title({ steer: true, frame: "", cwd: `${HOME}/repo/dsh-opentui`, branch: "main", cols: 80 })).toBe(
			" steer · ~/repo/dsh-opentui · main ",
		)
		// A frame without the steer window adds no segment at all.
		expect(title({ frame: "⠋", cwd: `${HOME}/repo/dsh-opentui`, branch: "main", cols: 80 })).toBe(
			" ~/repo/dsh-opentui · main ",
		)
	})

	test("narrow width clips the directory, keeping the branch tail verbatim", () => {
		const out = title({ cwd: `${HOME}/repo/a/very/long/workspace/dsh-opentui`, branch: "feat/bar", cols: 30 })
		// 30 cols → 26-cell interior; sep ` · ` = 3 → dir budget = 26 − 1 − 11 − 1 = 13.
		expect(out).toBe(" …/dsh-opentui · feat/bar ")
		expect(stringWidth(out)).toBeLessThanOrEqual(30 - 4)
		expect(out.startsWith(" ─")).toBe(false)
	})

	test("narrow width keeps the steer segment while clipping the directory", () => {
		const out = title({ steer: true, cwd: `${HOME}/repo/a/very/long/workspace/dsh-opentui`, cols: 30 })
		expect(out.startsWith(" steer · ")).toBe(true)
		expect(stringWidth(out)).toBeLessThanOrEqual(30 - 4)
		expect(out.endsWith("dsh-opentui ")).toBe(true)
	})

	test("narrow width keeps the framed steer segment verbatim (7 cells)", () => {
		const out = title({ steer: true, frame: "⠹", cwd: `${HOME}/repo/a/very/long/workspace/dsh-opentui`, cols: 30 })
		expect(out.startsWith(" ⠹ steer · ")).toBe(true)
		expect(stringWidth(out)).toBeLessThanOrEqual(30 - 4)
		expect(out.includes("⠹ steer")).toBe(true)
	})

	test("segments cannot fit at all: degrades to the directory alone, tail kept", () => {
		const out = title({ steer: true, frame: "⠋", cwd: `${HOME}/repo/dsh-opentui`, branch: "feat/long-branch-name", cols: 16 })
		// 16 cols → 12-cell interior → only a clipped dir tail fits.
		expect(out.startsWith(" ")).toBe(true)
		expect(out.endsWith("entui ")).toBe(true)
		expect(out.includes("steer")).toBe(false)
		expect(out.includes("feat/")).toBe(false)
		expect(stringWidth(out)).toBeLessThanOrEqual(16 - 4)
	})

	test("degenerate widths render no title (caller hides the bar)", () => {
		expect(title({ cwd: `${HOME}/repo/dsh-opentui`, cols: 6 })).toBe("")
		expect(title({ cwd: `${HOME}/repo/dsh-opentui`, cols: 3 })).toBe("")
		expect(title({ cwd: `${HOME}/repo/dsh-opentui`, cols: 0 })).toBe("")
		expect(title({ cwd: "", branch: "main", cols: 80 })).toBe("")
	})
})

describe("spinner frame wraparound (steer segment animation)", () => {
	test("walks the braille table and wraps forward", () => {
		expect(spinnerFrame(0)).toBe(SPINNER_FRAMES[0])
		expect(spinnerFrame(1)).toBe(SPINNER_FRAMES[1])
		expect(spinnerFrame(SPINNER_FRAMES.length - 1)).toBe(SPINNER_FRAMES.at(-1))
		expect(spinnerFrame(SPINNER_FRAMES.length)).toBe(SPINNER_FRAMES[0])
		expect(spinnerFrame(SPINNER_FRAMES.length * 3 + 2)).toBe(SPINNER_FRAMES[2])
	})

	test("wraps backwards for negative ticks", () => {
		expect(spinnerFrame(-1)).toBe(SPINNER_FRAMES.at(-1))
		expect(spinnerFrame(-SPINNER_FRAMES.length)).toBe(SPINNER_FRAMES[0])
	})
})
