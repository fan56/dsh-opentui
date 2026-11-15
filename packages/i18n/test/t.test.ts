/**
 * t() unit tests — design acceptance §5 items 3/4/5/6 (fail-open t(),
 * param-set consistency, localeFromConfig, golden values on the seed keys).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createEffect, createRoot } from "solid-js"
import { bundledLocalesDir, extractParams, loadLocales, type LocaleTable } from "../src/registry"
import { activeLanguage, applyI18nConfig, installedLanguages, localeFromConfig, setLanguage, setLanguages, t } from "../src/t"

const bundledDir = bundledLocalesDir()

const loadBundled = () => {
	const { languages } = loadLocales({ bundledDir })
	setLanguages(languages)
	return languages
}

beforeEach(loadBundled)
afterEach(() => setLanguages(new Map()))

describe("t(): interpolation + fail-open (design §5.3)", () => {
	test("{param} substitution with the active language", () => {
		expect(t("panel.sessionsCount", { count: 3 })).toBe("sessions: 3")
	})

	test("a missing param keeps the placeholder as-is", () => {
		expect(t("panel.sessionsCount")).toBe("sessions: {count}")
		expect(t("panel.sessionsCount", {})).toBe("sessions: {count}")
		expect(t("panel.sessionsCount", { other: 1 })).toBe("sessions: {count}")
	})

	test("missing key in active language falls back to en", () => {
		setLanguages(
			new Map<string, LocaleTable>([
				["en", { name: "English", "only.en": "EN!" }],
				["zh-CN", { name: "简体中文" }],
			]),
			"zh-CN",
		)
		expect(t("only.en")).toBe("EN!")
	})

	test("missing in both active and en returns the key itself", () => {
		expect(t("no.such.key")).toBe("no.such.key")
	})

	test("never throws — pinned with hostile inputs (design §6 exit(2) rule)", () => {
		expect(() => t("")).not.toThrow()
		expect(() => t("no.such.key", undefined)).not.toThrow()
		expect(() => t("panel.sessionsCount", { count: { deep: [1, 2] } })).not.toThrow()
		expect(() => t("panel.sessionsCount", null as never)).not.toThrow()
		expect(() => t("panel.sessionsCount", undefined as never)).not.toThrow()
		expect(() => t(String.fromCharCode(0x2028), { "x": Symbol("s") as never })).not.toThrow()
		// object params stringify instead of throwing
		expect(t("panel.sessionsCount", { count: { deep: [1, 2] } })).toBe("sessions: [object Object]")
		// a symbol param renders via String() instead of throwing (template
		// interpolation `${symbol}` would throw; String(symbol) does not)
		expect(t("panel.sessionsCount", { count: Symbol("s") as never })).toBe("sessions: Symbol(s)")
	})

	test("a non-string table entry is treated as missing (fail-open)", () => {
		setLanguages(new Map<string, LocaleTable>([["en", { name: "English", "bad": 42 as never }]]), "en")
		expect(t("bad")).toBe("bad")
	})
})

describe("en/zh {param} set consistency (design §5.4)", () => {
	test("every shared key has the same param set in en and zh-CN, both directions", () => {
		const { languages } = loadLocales({ bundledDir })
		const en = languages.get("en")!
		const zh = languages.get("zh-CN")!
		const keys = Object.keys(en).filter((k) => k !== "name")
		expect(keys.length).toBeGreaterThan(0)
		for (const key of keys) {
			if (zh[key] === undefined) continue
			const enParams = [...extractParams(en[key]!)].sort()
			const zhParams = [...extractParams(zh[key]!)].sort()
			expect(zhParams, `zh-CN key '${key}' params vs en`).toEqual(enParams)
			expect(enParams, `en key '${key}' params vs zh-CN`).toEqual(zhParams)
		}
	})

	test("zh-CN carries the seed keys (no dropped keys between the two bundled files)", () => {
		const { languages } = loadLocales({ bundledDir })
		const en = Object.keys(languages.get("en")!).filter((k) => k !== "name").sort()
		const zh = Object.keys(languages.get("zh-CN")!).filter((k) => k !== "name").sort()
		expect(zh).toEqual(en)
	})
})

describe("localeFromConfig (design §5.5)", () => {
	test("canonical ids pass through", () => {
		expect(localeFromConfig("en")).toBe("en")
		expect(localeFromConfig("zh-CN")).toBe("zh-CN")
	})

	test("zh aliases map to zh-CN (legacy hintsLocale spellings)", () => {
		expect(localeFromConfig("zh-cn")).toBe("zh-CN")
		expect(localeFromConfig("zh_cn")).toBe("zh-CN")
		expect(localeFromConfig("zh")).toBe("zh-CN")
		expect(localeFromConfig("zh-Hans")).toBe("zh-CN")
		expect(localeFromConfig("zh-Hans-CN")).toBe("zh-CN")
	})

	test("ja/ko degrade to en (bundled languages not shipped)", () => {
		expect(localeFromConfig("ja")).toBe("en")
		expect(localeFromConfig("ko")).toBe("en")
		expect(localeFromConfig("ja-JP")).toBe("en")
		expect(localeFromConfig("ko-KR")).toBe("en")
	})

	test("unknown, missing and non-string values fall back to en", () => {
		expect(localeFromConfig("fr")).toBe("en")
		expect(localeFromConfig("")).toBe("en")
		expect(localeFromConfig(undefined)).toBe("en")
		expect(localeFromConfig(null)).toBe("en")
		expect(localeFromConfig(42)).toBe("en")
		expect(localeFromConfig({})).toBe("en")
	})
})

describe("golden values on the seed keys (design §5.6, seed-key form)", () => {
	test("en output is pinned", () => {
		setLanguages(loadLocales({ bundledDir }).languages, "en")
		expect(t("common.confirm")).toBe("Confirm")
		expect(t("common.cancel")).toBe("Cancel")
		expect(t("common.noItems")).toBe("No items")
		expect(t("common.invalidNumber")).toBe("Invalid number")
		expect(t("command.language.set", { lang: "zh-CN" })).toBe("language switched: zh-CN")
		expect(t("panel.sessionsCount", { count: 12 })).toBe("sessions: 12")
	})

	test("zh-CN output is pinned", () => {
		setLanguages(loadLocales({ bundledDir }).languages, "zh-CN")
		expect(t("common.confirm")).toBe("确认")
		expect(t("common.cancel")).toBe("取消")
		expect(t("common.noItems")).toBe("暂无条目")
		expect(t("common.invalidNumber")).toBe("数字无效")
		expect(t("command.language.set", { lang: "zh-CN" })).toBe("语言已切换：zh-CN")
		expect(t("panel.sessionsCount", { count: 12 })).toBe("会话数: 12")
	})
})

describe("applyI18nConfig boot replay (design §3, live-switch amendment)", () => {
	test("resolves the unified lang setting and fixes it for the process", () => {
		const result = applyI18nConfig({ lang: "zh-CN" }, { bundledDir })
		expect(result.language).toBe("zh-CN")
		expect(activeLanguage()).toBe("zh-CN")
		expect(t("common.confirm")).toBe("确认")
	})

	test("legacy hintsLocale folds in when no unified lang exists", () => {
		const result = applyI18nConfig({ hintsLocale: "zh-CN" }, { bundledDir })
		expect(result.language).toBe("zh-CN")
	})

	test("ja/ko degrade to en with a warning, and never crash", () => {
		for (const legacy of ["ja", "ko"]) {
			const result = applyI18nConfig({ hintsLocale: legacy }, { bundledDir })
			expect(result.language).toBe("en")
			expect(result.warnings.some((w) => w.includes(legacy) && w.includes("degraded"))).toBe(true)
			expect(activeLanguage()).toBe("en")
		}
	})

	test("a missing/unresolvable config keeps the en default", () => {
		const result = applyI18nConfig(undefined, { bundledDir })
		expect(result.language).toBe("en")
		const result2 = applyI18nConfig({ lang: "not-a-language" }, { bundledDir })
		expect(result2.language).toBe("en")
	})

	test("installedLanguages reflects the boot-loaded registry", () => {
		applyI18nConfig({ lang: "en" }, { bundledDir })
		expect(installedLanguages()).toEqual(["en", "zh-CN"])
	})
})

describe("setLanguage live switch (solid signal, no restart)", () => {
	test("t() returns the new language immediately after setLanguage", () => {
		setLanguages(loadLocales({ bundledDir }).languages, "en")
		expect(t("command.language.set", { lang: "zh-CN" })).toBe("language switched: zh-CN")
		setLanguage("zh-CN")
		expect(activeLanguage()).toBe("zh-CN")
		expect(t("command.language.set", { lang: "zh-CN" })).toBe("语言已切换：zh-CN")
		// switching back restores the en wording (same signal, same table)
		setLanguage("en")
		expect(t("command.language.set", { lang: "zh-CN" })).toBe("language switched: zh-CN")
	})

	test("a live switch to an id without a table degrades to en (never a table-less language)", () => {
		// Real-machine live-lang symptom-2 guard (2026-11-15): a `setLanguage`
		// past an uninstalled id must NOT leave the signal pointing at a
		// table-less language — the fail-open chain would silently mask it
		// (hintLabel turns a key-shaped t() output into '').
		setLanguages(loadLocales({ bundledDir }).languages, "en")
		setLanguage("fr")
		expect(activeLanguage()).toBe("en")
		expect(t("common.confirm")).toBe("Confirm")
		// the installed ids still switch live
		setLanguage("zh-CN")
		expect(activeLanguage()).toBe("zh-CN")
	})

	test("t() is tracked: createEffect reading it re-runs on a language switch", async () => {
		const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
		setLanguages(loadLocales({ bundledDir }).languages, "en")
		let runs = 0
		let last = ""
		let disposeRoot: (() => void) | undefined
		createRoot((dispose) => {
			disposeRoot = dispose
			createEffect(() => {
				runs++
				last = t("command.language.set", { lang: "zh-CN" })
			})
		})
		// solid effects fire on the microtask queue — initial run: en wording
		await wait(0)
		expect(runs).toBe(1)
		expect(last).toBe("language switched: zh-CN")
		// live flip → the tracked effect re-runs with the new language
		setLanguage("zh-CN")
		await wait(0)
		expect(runs).toBe(2)
		expect(last).toBe("语言已切换：zh-CN")
		setLanguage("en")
		await wait(0)
		expect(runs).toBe(3)
		expect(last).toBe("language switched: zh-CN")
		// a same-id set is a solid no-op write (equal value) — no re-run
		setLanguage("en")
		await wait(0)
		expect(runs).toBe(3)
		disposeRoot?.()
	})
})
