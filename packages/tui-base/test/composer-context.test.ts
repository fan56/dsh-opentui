/**
 * Composer context row (user feedback batch): the pure formatting contract
 * for the directory + git branch line directly above the input box.
 */
import { describe, expect, test } from "bun:test"
import { composerContextLabel, truncateLeft } from "../src/routes/session/composer-context"
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
