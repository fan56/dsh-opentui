/**
 * Flicker mitigation 2 (research/skin-flicker-analysis.md 缓解 3): the
 * composer footer hint — the input box's bottom-edge row — must be ONE
 * constant string. The old busy↔idle swap repainted the row on every turn
 * boundary (different text, different width → full-row redraw). The row is
 * now width-stable by construction: a single constant, rendered verbatim.
 */
import { describe, expect, test } from "bun:test"
import { COMPOSER_FOOTER_HINT } from "../src/routes/session/session-composer"

describe("composer footer hint (flicker mitigation 2)", () => {
	test("is one non-empty constant string (same width idle and busy)", () => {
		expect(typeof COMPOSER_FOOTER_HINT).toBe("string")
		expect(COMPOSER_FOOTER_HINT.length).toBeGreaterThan(0)
		expect(COMPOSER_FOOTER_HINT).toBe(COMPOSER_FOOTER_HINT.trim())
	})

	test("still carries the union of the old idle+busy hints", () => {
		// old idle: `enter send · alt+enter newline · ↑↓ history`
		expect(COMPOSER_FOOTER_HINT).toContain("enter send")
		expect(COMPOSER_FOOTER_HINT).toContain("alt+enter newline")
		expect(COMPOSER_FOOTER_HINT).toContain("↑↓ history")
		// old busy: `* streaming… enter steers the running turn`
		expect(COMPOSER_FOOTER_HINT).toContain("streaming")
		expect(COMPOSER_FOOTER_HINT).toContain("steers")
	})
})
