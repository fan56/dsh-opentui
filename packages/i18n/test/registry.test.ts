/**
 * Registry unit tests — design acceptance §5 items 1/2 (validation, merge)
 * plus the loader integration behaviour behind them.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	bundledLocalesDir,
	extractParams,
	installedLanguagesFrom,
	loadLocales,
	mergeTables,
	parseLocaleFile,
	validateLocaleFile,
} from "../src/registry"

const tmpRoot = () => mkdtempSync(join(tmpdir(), "i18n-registry-test-"))

describe("registry: strict whole-file validation (design §5.1)", () => {
	test("a valid flat table passes", () => {
		const result = validateLocaleFile({ name: "English", "a.b": "hello {x}" })
		expect(result.ok).toBe(true)
		if (result.ok) expect(result.table["a.b"]).toBe("hello {x}")
	})

	test("a number value rejects the WHOLE file and names the offending key", () => {
		const result = validateLocaleFile({ name: "X", "good.key": "ok", "bad.key": 42 })
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.errors.map((e) => e.key)).toContain("bad.key")
			expect(result.errors.map((e) => e.key)).not.toContain("good.key")
		}
	})

	test("a nested object value rejects the whole file and names the offending key", () => {
		const result = validateLocaleFile({ name: "X", "nested.key": { deep: "value" } })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.errors[0]?.key).toBe("nested.key")
	})

	test("an empty string value rejects the whole file", () => {
		const result = validateLocaleFile({ name: "X", "empty.key": "" })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.errors[0]?.key).toBe("empty.key")
	})

	test("a missing or empty `name` rejects the file", () => {
		expect(validateLocaleFile({ "a": "b" }).ok).toBe(false)
		expect(validateLocaleFile({ "name": "", "a": "b" }).ok).toBe(false)
		expect(validateLocaleFile({ "name": 3 }).ok).toBe(false)
	})

	test("a non-{param} placeholder rejects the whole file (whole-file rule)", () => {
		for (const bad of ["hello {0}", "{a b}", "{}", "%s left", "{a-b}"]) {
			const result = validateLocaleFile({ name: "X", "k": bad })
			expect(result.ok, `expected rejection for ${JSON.stringify(bad)}`).toBe(false)
		}
		// identifier placeholders pass
		expect(validateLocaleFile({ name: "X", "k": "hi {name_1}" }).ok).toBe(true)
	})

	test("a top-level array / scalar is rejected as not-a-flat-object", () => {
		expect(validateLocaleFile(["a", "b"]).ok).toBe(false)
		expect(validateLocaleFile("en").ok).toBe(false)
		expect(validateLocaleFile(null).ok).toBe(false)
	})

	test("bad JSON parses as a rejection, never a throw (skip + warn path)", () => {
		const result = parseLocaleFile("{ not json !!!")
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.errors[0]?.reason).toContain("invalid JSON")
	})

	test("extractParams reads the identifier placeholders of one value", () => {
		expect([...extractParams("hi {name}, count {count}, keep {missing}")].sort()).toEqual([
			"count",
			"missing",
			"name",
		])
	})
})

describe("registry: merge + registration via the loader (design §5.2)", () => {
	const bundledDir = bundledLocalesDir()

	test("bundled baseline loads en and zh-CN", () => {
		const { languages, warnings } = loadLocales({ bundledDir })
		expect(warnings).toEqual([])
		expect(installedLanguagesFrom(languages)).toEqual(["en", "zh-CN"])
		expect(languages.get("en")?.["name"]).toBe("English")
	})

	test("a same-id user file overrides key-by-key; uncovered keys keep bundled values", () => {
		const userDir = tmpRoot()
		try {
			writeFileSync(
				join(userDir, "en.json"),
				JSON.stringify({ name: "English (mine)", "common.confirm": "Yes" }),
			)
			const { languages } = loadLocales({ bundledDir, userDir })
			const en = languages.get("en")
			expect(en?.["name"]).toBe("English (mine)")
			expect(en?.["common.confirm"]).toBe("Yes")
			expect(en?.["common.cancel"]).toBe("Cancel") // untouched bundled key survives
		} finally {
			rmSync(userDir, { recursive: true, force: true })
		}
	})

	test("omitted options.userDir still honors $DSH_HOME/locales (boot-contract regression)", () => {
		const home = tmpRoot()
		const localesDir = join(home, "locales")
		mkdirSync(localesDir, { recursive: true })
		const prevHome = process.env.DSH_HOME
		try {
			writeFileSync(
				join(localesDir, "zh-CN.json"),
				JSON.stringify({ name: "简体中文（覆盖）", "common.confirm": "好的" }),
			)
			process.env.DSH_HOME = home
			const { languages, warnings } = loadLocales({ bundledDir })
			expect(warnings).toEqual([])
			const zh = languages.get("zh-CN")
			expect(zh?.["name"]).toBe("简体中文（覆盖）")
			expect(zh?.["common.confirm"]).toBe("好的")
		} finally {
			if (prevHome === undefined) delete process.env.DSH_HOME
			else process.env.DSH_HOME = prevHome
			rmSync(home, { recursive: true, force: true })
		}
	})

	test("a new id in the user dir registers a new language", () => {
		const userDir = tmpRoot()
		try {
			writeFileSync(join(userDir, "fr.json"), JSON.stringify({ name: "Français", "common.confirm": "OK" }))
			const { languages } = loadLocales({ bundledDir, userDir })
			expect(installedLanguagesFrom(languages)).toEqual(["en", "fr", "zh-CN"])
		} finally {
			rmSync(userDir, { recursive: true, force: true })
		}
	})

	test("a broken user file is rejected whole with a warning — bundled table stays intact", () => {
		const userDir = tmpRoot()
		try {
			// the hand-edited typo: one empty string poisons the file
			writeFileSync(
				join(userDir, "en.json"),
				JSON.stringify({ name: "X", "common.confirm": "", "common.cancel": "Cancel" }),
			)
			const { languages, warnings } = loadLocales({ bundledDir, userDir })
			expect(warnings.some((w) => w.includes("en.json") && w.includes("empty string"))).toBe(true)
			expect(languages.get("en")?.["name"]).toBe("English") // bundled, not the rejected user file
		} finally {
			rmSync(userDir, { recursive: true, force: true })
		}
	})

	test("an unparseable user file is skipped with a warning, not a crash", () => {
		const userDir = tmpRoot()
		try {
			writeFileSync(join(userDir, "zh-CN.json"), "{ oops")
			const { languages, warnings } = loadLocales({ bundledDir, userDir })
			expect(warnings.some((w) => w.includes("zh-CN.json"))).toBe(true)
			expect(languages.get("zh-CN")?.["name"]).toBe("简体中文")
		} finally {
			rmSync(userDir, { recursive: true, force: true })
		}
	})

	test("mergeTables is pure key-by-key override", () => {
		expect(mergeTables({ a: "1", b: "2" }, { b: "9", c: "3" })).toEqual({ a: "1", b: "9", c: "3" })
	})
})
