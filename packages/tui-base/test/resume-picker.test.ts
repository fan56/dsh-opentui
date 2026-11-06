/**
 * /sessions picker helper tests (G1 resume-picker batch): the pure column
 * semantics aligned with the reference /resume picker (dsh-tui-pi 66) —
 * relative UPDATED, capped DIR, the 1KB fail-open size floor, the distinct
 * empty-filtered copy, and the fitted header/row alignment.
 */
import { describe, expect, test } from "bun:test"
import {
	emptyFilteredCopy,
	filterSessionsBySizeFloor,
	resumeDirLabel,
	relativeTime,
	resumePickerOptions,
	SESSIONS_DIR_CAP,
	SESSIONS_MIN_BYTES,
} from "../src/routes/session/resume-picker"

const NOW = Date.parse("2026-11-07T12:00:00Z")

describe("relativeTime", () => {
	test("relative ladder (just now / m / h / d)", () => {
		expect(relativeTime("2026-11-07T11:59:40Z", NOW)).toBe("just now")
		expect(relativeTime(String(NOW - 5 * 60_000), NOW)).toBe("5m ago")
		expect(relativeTime("2026-11-07T09:00:00Z", NOW)).toBe("3h ago")
		expect(relativeTime("2026-10-26T12:00:00Z", NOW)).toBe("12d ago")
	})
	test("missing renders an em-dash; unparseable renders RAW", () => {
		expect(relativeTime(undefined, NOW)).toBe("—")
		expect(relativeTime("", NOW)).toBe("—")
		expect(relativeTime("not-a-date", NOW)).toBe("not-a-date")
	})
})

describe("resumeDirLabel", () => {
	test("full cwd under the cap, ellipsis-capped over it", () => {
		expect(resumeDirLabel(undefined)).toBe("—")
		expect(resumeDirLabel("")).toBe("—")
		expect(resumeDirLabel("/repo/alpha")).toBe("/repo/alpha")
		const deep = "/" + "deep/".repeat(20) + "tail"
		const label = resumeDirLabel(deep)
		expect(label.length).toBe(SESSIONS_DIR_CAP)
		expect(label.startsWith("…")).toBe(true)
		expect(label.endsWith("tail")).toBe(true)
	})
})

describe("filterSessionsBySizeFloor", () => {
	const rows = [
		{ id: "big", title: "big", sizeBytes: 25000 },
		{ id: "boundary", title: "boundary", sizeBytes: SESSIONS_MIN_BYTES },
		{ id: "tiny", title: "tiny", sizeBytes: 1023 },
		{ id: "unknown", title: "unknown" },
	]
	test("floor is inclusive; missing size fails open", () => {
		const kept = filterSessionsBySizeFloor(rows)
		expect(kept.map((row) => row.id)).toEqual(["big", "boundary", "unknown"])
	})
})

describe("emptyFilteredCopy", () => {
	test("names the window, the hidden count and the floor (reference alignment)", () => {
		expect(emptyFilteredCopy(3)).toBe(`No sessions within the resume window (3 hidden by the ${SESSIONS_MIN_BYTES}B size floor)`)
	})
})

describe("resumePickerOptions", () => {
	test("header and rows align on fitted columns", () => {
		const { header, options } = resumePickerOptions(
			[
				{ id: "a", title: "alpha prompt", updatedAt: "2026-11-07T11:00:00Z", cwd: "/repo/alpha" },
				{ id: "b", title: "beta", cwd: "/somewhat/longer/worktree/path" },
			],
			NOW,
		)
		// UPDATED cell widths: "1h ago" (6) vs "—" (1) vs header (7) → 7.
		// DIR widths: fitted to the longer cwd.
		expect(header).toMatch(/^UPDATED {2,}DIR {2,}SESSION$/)
		expect(options).toHaveLength(2)
		for (const option of options) {
			const columns = option.title.trim().split(/\s{2,}/)
			expect(columns).toHaveLength(3)
		}
		expect(options[0]!.title).toContain("/repo/alpha")
		expect(options[1]!.title).toContain("/somewhat/longer/worktree/path")
		expect(options.map((option) => option.value)).toEqual(["a", "b"])
		// The header and the rows share the two leading column widths, so the
		// SESSION cells start at the same offset.
		const sessionOffset = header.indexOf("SESSION")
		expect(options[0]!.title.indexOf("alpha prompt")).toBe(sessionOffset)
		expect(options[1]!.title.indexOf("beta")).toBe(sessionOffset)
	})
	test("empty rows still paint the bare header", () => {
		const { header, options } = resumePickerOptions([])
		expect(header).toBe("UPDATED  DIR  SESSION")
		expect(options).toEqual([])
	})
})
