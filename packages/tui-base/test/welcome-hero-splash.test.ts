/**
 * Splash plugin-tree units (tui-pi welcome parity): the height-aware row cap
 * bands (tied to the composer compact law), the overflow floor (always ≥1
 * example row behind the more-line), the width clip (CJK/emoji-safe through
 * the repo's stringWidth), and the i18n surface of the two hero.plugins keys
 * in both bundled languages (the fail-open contract: a missing key would
 * paint `hero.plugins.count` on the splash).
 */
import { describe, expect, test } from "bun:test"
import { applyI18nConfig, installedLanguages, setLanguage, t } from "@dsh-opentui/i18n"
import { COMPOSER_COMPACT_TERMINAL_ROWS } from "../src/skin/semantic"
import { clipRow, splashOverflowCount, splashRowCap } from "../src/routes/welcome-hero"
import { stringWidth } from "../src/util/string-width"

describe("splashRowCap: height bands (composer compact law tie-in)", () => {
	test("40+ rows get the spec cap of 8", () => {
		expect(splashRowCap(40)).toBe(8)
		expect(splashRowCap(52)).toBe(8)
		expect(splashRowCap(120)).toBe(8)
	})

	test("COMPOSER_COMPACT_TERMINAL_ROWS..39 get 4", () => {
		expect(splashRowCap(30)).toBe(4)
		expect(splashRowCap(COMPOSER_COMPACT_TERMINAL_ROWS)).toBe(4)
		expect(splashRowCap(39)).toBe(4)
	})

	test("compact viewports (<COMPOSER_COMPACT_TERMINAL_ROWS rows) get 1", () => {
		expect(splashRowCap(COMPOSER_COMPACT_TERMINAL_ROWS - 1)).toBe(1)
		expect(splashRowCap(29)).toBe(1)
		expect(splashRowCap(24)).toBe(1)
	})
})

describe("splashOverflowCount: overflow always keeps ≥1 example row", () => {
	test("no overflow at or under the cap", () => {
		expect(splashOverflowCount(8, 8)).toBe(0)
		expect(splashOverflowCount(1, 8)).toBe(0)
		expect(splashOverflowCount(0, 1)).toBe(0)
	})

	test("overflow hides rows behind the more-line", () => {
		expect(splashOverflowCount(9, 8)).toBe(2)
		expect(splashOverflowCount(50, 8)).toBe(43)
		expect(splashOverflowCount(50, 4)).toBe(47)
	})

	test("the cap=1 branch still shows one example row (the floor)", () => {
		expect(splashOverflowCount(19, 1)).toBe(18)
		expect(splashOverflowCount(2, 1)).toBe(1)
		for (const [total, cap] of [
			[19, 1],
			[2, 1],
			[50, 4],
			[9, 8],
		] as const) {
			const hidden = splashOverflowCount(total, cap)
			if (hidden > 0) expect(total - hidden).toBeGreaterThanOrEqual(1)
		}
	})
})

describe("clipRow: width-based, CJK/emoji-safe (repo stringWidth)", () => {
	test("short lines pass through untouched", () => {
		expect(clipRow("├─ dsh-dcp@0.13.1", 80)).toBe("├─ dsh-dcp@0.13.1")
	})

	test("long ASCII lines clip under the budget with an ellipsis", () => {
		const out = clipRow(`├─ ${"a".repeat(100)}`, 30)
		expect(stringWidth(out)).toBeLessThanOrEqual(30)
		expect(out.endsWith("…")).toBe(true)
	})

	test("CJK counts 2 cells and is never torn mid-character", () => {
		expect(stringWidth("插件")).toBe(4)
		const out = clipRow("├─ 插件名称很长很长很长很长@1.0.0", 12)
		expect(stringWidth(out)).toBeLessThanOrEqual(12)
		// every kept grapheme is whole: re-segmenting the output reproduces it
		const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(out)].map((g) => g.segment)
		expect(segments.join("")).toBe(out)
		// and no dangling wide char was split in half (a split wide char would
		// re-measure to 1)
		expect(stringWidth(segments.at(-1)!)).toBe(1) // the ellipsis closes the row
	})

	test("emoji surrogate pairs stay whole under clipping", () => {
		const out = clipRow("├─ 🤖🤖🤖🤖🤖 name", 10)
		expect(out.endsWith("…")).toBe(true)
		for (const ch of Array.from(out)) {
			const cp = ch.codePointAt(0)!
			// a torn surrogate pair shows up as a lone high/low surrogate
			expect(cp < 0xd800 || cp > 0xdfff).toBe(true)
		}
	})
})

describe("hero.plugins keys: both bundled languages resolve (fail-open gate)", () => {
	applyI18nConfig({ hintsLocale: "en" })

	test("the bundled registry carries en and zh-CN", () => {
		expect(installedLanguages()).toEqual(expect.arrayContaining(["en", "zh-CN"]))
	})

	test("en resolves count + more with {count} interpolation", () => {
		setLanguage("en")
		expect(t("hero.plugins.count", { count: 5 })).toBe("plugins 5")
		expect(t("hero.plugins.more", { count: 18 })).toBe("… +18 more")
	})

	test("zh-CN resolves count + more (never the raw key — the key-leak shape)", () => {
		setLanguage("zh-CN")
		const count = t("hero.plugins.count", { count: 5 })
		const more = t("hero.plugins.more", { count: 18 })
		expect(count).toBe("插件 5")
		expect(more).toBe("… 还有 18 个")
		expect(count).not.toBe("hero.plugins.count")
		expect(more).not.toBe("hero.plugins.more")
	})
})
