/**
 * No-wrap / clip-at-right-edge law for the two bottom strips (real render).
 *
 * The footer powerline row and the key-hint row must NEVER wrap: hostile
 * content (long provider/model, every footer segment, busy + idle hints) is
 * clipped at the pane's right edge, never painted onto a second row. Each test
 * mounts the actual component through @opentui/solid's testRender and asserts
 * on the painted frame, so a regression that reintroduces a wrapping <text>
 * (or drops wrapMode="none") fails here rather than only in a real terminal.
 */
import { describe, expect, test } from "bun:test"
import { createComponent, testRender } from "@opentui/solid"
import { bundledLocalesDir, loadLocales, setLanguage, setLanguages } from "@dsh-opentui/i18n"
import { PowerlineFooter, sessionFooterSegments } from "../src/routes/session/powerline"
import {
	DEFAULT_FOOTER_HINTS,
	HintsLine,
	setFooterHints,
	setHintsShown,
} from "../src/routes/session/hints-line"
import { stringWidth } from "../src/util/string-width"

setLanguages(loadLocales({ bundledDir: bundledLocalesDir() }).languages)

/** Every width the real-terminal probe exercises. */
const WIDTHS = [20, 30, 45, 60, 80] as const

/** Deliberately hostile: long provider + long model + every footer segment. */
const hostileSegments = () =>
	sessionFooterSegments({
		provider: "some-very-long-provider-name-for-testing",
		model: "some-very-long-model-identifier-for-testing",
		effort: "high",
		contextTokens: 420,
		contextWindow: 1000,
		msg: 11,
		tools: 7,
		tps: 42,
	})

/** Rows of a captured frame that actually carry painted glyphs. */
const contentRows = (frame: string): string[] => frame.split("\n").filter((line) => line.trim().length > 0)

/** Glyphs that belong to a footer strip — used to prove none spill onto row 2. */
const FOOTER_GLYPH = /dsh|🧠|💬|🔧|tok\/s|\ue0b0/

describe("bottom strips never wrap (real painted frame)", () => {
	for (const width of WIDTHS) {
		test(`PowerlineFooter: hostile content is ONE row at ${width} columns`, async () => {
			const setup = await testRender(
				() => [
					createComponent(PowerlineFooter, {
						left: hostileSegments(),
						right: "2026-11-17 21:30:00 some-long-clock-suffix",
					}),
				],
				{ width, height: 8, useMouse: false },
			)
			try {
				await setup.renderOnce()
				const frame = setup.captureCharFrame()
				const rows = contentRows(frame)
				// Exactly one painted row; a wrapped glyph would create a second.
				expect(rows).toHaveLength(1)
				// Runtime glyph-aware width never exceeds the pane.
				expect(stringWidth(rows[0]!)).toBeLessThanOrEqual(width)
				// The clipped tail cannot reappear as footer glyphs on any other row.
				const lines = frame.split("\n")
				const first = lines.findIndex((line) => FOOTER_GLYPH.test(line))
				expect(first).toBeGreaterThanOrEqual(0)
				expect(lines.slice(first + 1).some((line) => FOOTER_GLYPH.test(line))).toBe(false)
			} finally {
				await setup.dispose()
			}
		})

		for (const busy of [true, false]) {
			test(`HintsLine ${busy ? "busy" : "idle"}: ONE row at ${width} columns`, async () => {
				setLanguage("en")
				setHintsShown(true)
				setFooterHints({ ...DEFAULT_FOOTER_HINTS })
				const setup = await testRender(() => <HintsLine busy={() => busy} />, {
					width,
					height: 8,
					useMouse: false,
				})
				try {
					await setup.renderOnce()
					const frame = setup.captureCharFrame()
					const rows = contentRows(frame)
					expect(rows).toHaveLength(1)
					expect(stringWidth(rows[0]!)).toBeLessThanOrEqual(width)
					// The clipped hint tail cannot reappear on row 2.
					const lines = frame.split("\n")
					const HINT_GLYPH = /⌨|🐳|enter|steer|quit|history|subagent/
					const first = lines.findIndex((line) => HINT_GLYPH.test(line))
					expect(first).toBeGreaterThanOrEqual(0)
					expect(lines.slice(first + 1).some((line) => HINT_GLYPH.test(line))).toBe(false)
				} finally {
					await setup.dispose()
				}
			})
		}
	}
})
