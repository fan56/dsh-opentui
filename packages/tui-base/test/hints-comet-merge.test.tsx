/**
 * HUD merge (2026-11-17): the busy 🐳 comet lives in the LAST page row, to the
 * LEFT of the key hints; idle keeps the hints-only row, and every busy status
 * TEXT code path (verb pool / elapsed seconds / phase icon / detail) is gone.
 *
 * Each test mounts the real HintsLine through @opentui/solid's testRender and
 * measures the painted frame with the runtime `stringWidth` (glyph-aware, so
 * the two-column 🐳 and the box-drawing ramp count correctly).
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { bundledLocalesDir, loadLocales, setLanguage, setLanguages } from "@dsh-opentui/i18n"
import {
	COMET_HINT_GAP,
	DEFAULT_FOOTER_HINTS,
	hintsTextAtWidth,
	HintsLine,
	setFooterHints,
	setHintsShown,
} from "../src/routes/session/hints-line"
import { COMET_TRACK_COLS } from "../src/routes/session/comet-track"
import { stringWidth } from "../src/util/string-width"

setLanguages(loadLocales({ bundledDir: bundledLocalesDir() }).languages)

/** Mount the merged row, reset the shared toggles/locale, return its painted line. */
async function mountRow(width: number, busy: () => boolean) {
	setLanguage("en")
	setHintsShown(true)
	setFooterHints({ ...DEFAULT_FOOTER_HINTS })
	const setup = await testRender(() => <HintsLine busy={busy} />, { width, height: 4, useMouse: false })
	await setup.renderOnce()
	const frame = setup.captureCharFrame()
	const lines = frame.split("\n")
	const row = lines.find((line) => line.includes("⌨") || line.includes("🐳")) ?? ""
	return { setup, frame, lines, row }
}

describe("merged hints + comet row", () => {
	test("busy: comet first, hints follow, row spans the full pane width", async () => {
		const width = 80
		const { setup, lines, row } = await mountRow(width, () => true)
		try {
			expect(row).toContain("🐳")
			expect(row).toContain("⌨")
			// Everything stays on ONE painted row (no overflow wrap).
			expect(lines.filter((line) => line.includes("⌨") || line.includes("🐳"))).toHaveLength(1)
			const cometAt = row.indexOf("🐳")
			const hintAt = row.indexOf("⌨")
			expect(cometAt).toBeLessThan(hintAt)
			// 1 left pad + 15-col track + 1-col gap before the first hint.
			expect(stringWidth(row.slice(0, hintAt))).toBe(1 + COMET_TRACK_COLS + COMET_HINT_GAP)
			// The painted row is exactly the pane width (runtime stringWidth).
			expect(stringWidth(row)).toBe(width)
		} finally {
			await setup.dispose()
		}
	})

	test("idle: no comet, hints start at the original left offset", async () => {
		const width = 80
		const { setup, row } = await mountRow(width, () => false)
		try {
			expect(row).not.toContain("🐳")
			expect(row).toContain("⌨")
			// Before the merge (and still today) the single text child sits one
			// column in from the box's paddingLeft: 1.
			expect(row.indexOf("⌨")).toBe(1)
			expect(stringWidth(row)).toBe(width)
		} finally {
			await setup.dispose()
		}
	})

	for (const width of [45, 60]) {
		test(`busy ${width}-column pane folds whole segments and never overflows`, async () => {
			const { setup, lines, row } = await mountRow(width, () => true)
			try {
				expect(row).toContain("🐳")
				expect(row).toContain("⌨")
				expect(lines.filter((line) => line.includes("⌨") || line.includes("🐳"))).toHaveLength(1)
				expect(stringWidth(row)).toBe(width)
				// The hints are fitted into exactly `pane - trackWidth - gap`
				// (hintsTextAtWidth applies its own -2 padding reserve).
				const expectedHints = hintsTextAtWidth(true, true, false, width - COMET_TRACK_COLS - COMET_HINT_GAP)
				expect(row).toContain(expectedHints)
				// Core keys survive; optional ones shed whole (no mid-glyph cut).
				expect(row).toContain("enter steer")
				expect(row).not.toContain("pgup/pgdn")
				expect(row).not.toContain("ctrl+shift+f")
				expect(row).not.toContain("…")
			} finally {
				await setup.dispose()
			}
		})
	}

	test("busy row carries no status text: no verb-pool word, timer, or phase icon", async () => {
		const { setup, row } = await mountRow(120, () => true)
		try {
			const verbs = /thinking|pondering|reasoning|reflecting|deliberating|mulling|executing|running|processing|building|writing|composing|typing|drafting|waiting/i
			expect(row).not.toMatch(verbs)
			expect(row).not.toMatch(/\b\d+s\b/) // no "12s" elapsed readout
			for (const icon of ["🧠", "🛠", "📝", "⏳"]) expect(row).not.toContain(icon)
		} finally {
			await setup.dispose()
		}
	})

	test("/hints off still collapses the merged row to zero rows, even while busy", async () => {
		setHintsShown(false)
		const setup = await testRender(() => <HintsLine busy={() => true} />, { width: 80, height: 4, useMouse: false })
		try {
			await setup.renderOnce()
			const frame = setup.captureCharFrame()
			expect(frame).not.toContain("🐳")
			expect(frame).not.toContain("⌨")
		} finally {
			setHintsShown(true)
			await setup.dispose()
		}
	})
})
