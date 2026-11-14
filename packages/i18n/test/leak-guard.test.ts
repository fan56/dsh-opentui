/**
 * Leak-guard ratchet (design c5-i18n §4 T14 infra, built AHEAD of the facet
 * migrations): the residual untranslated-copy counts of the migration facets
 * are PINNED in leak-guard-baseline.json and may only go DOWN.
 *
 * - T4-T11 lower the baseline numbers in the same commit that migrates the
 *   copy;
 * - any NEW hardcoded CJK copy or `say(`...`)` template string fails this
 *   test — new user-visible copy must go through `t()` + the locale tables;
 * - goal at T14: all zeros.
 *
 * Scanned roots: tui-base/src and panel-kit/src (the facet migration scope).
 * Sanctioned exclusions (intentional Chinese that is NOT UI chrome):
 * - tui-base/src/routes/quotes.ts — the daily quote pool, ported verbatim
 *   from dsh-tui-pi (its header documents this); content, not copy;
 * - tui-base/src/mini/demo.ts — excluded from the migration scope by the
 *   design (§4 T11 "mini 面板（除 demo.ts）").
 *
 * RED LINES untouched (§5.3/§6): this file adds no `t()` behavior and cannot
 * weaken the never-throw pinning in t.test.ts.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import {
	formatBreakdown,
	isCommentLine,
	scanSource,
	scanTree,
	totalsOf,
	type FileLeaks,
} from "../src/scan"

const PACKAGES = join(import.meta.dir, "..", "..")

const SCANNED_ROOTS: Record<string, string> = {
	"tui-base": join(PACKAGES, "tui-base", "src"),
	"panel-kit": join(PACKAGES, "panel-kit", "src"),
}

const EXCLUDED = (file: string): boolean =>
	file.endsWith(join("routes", "quotes.ts")) || file.endsWith(join("mini", "demo.ts"))

interface BaselineEntry {
	cjkLines: number
	templateSayCalls: number
}

const loadBaseline = (): Record<string, BaselineEntry> =>
	JSON.parse(readFileSync(join(import.meta.dir, "leak-guard-baseline.json"), "utf8")) as Record<
		string,
		BaselineEntry
	>

describe("leak-guard scanner (design §4 T14 infra)", () => {
	test("isCommentLine recognizes comment-only lines", () => {
		expect(isCommentLine("// 中文 comment")).toBe(true)
		expect(isCommentLine("* 中文 block continuation")).toBe(true)
		expect(isCommentLine("/* 中文 block open")).toBe(true)
		expect(isCommentLine("*/")).toBe(true)
		expect(isCommentLine("say('中文 copy')")).toBe(false)
		expect(isCommentLine("const x = 1")).toBe(false)
	})

	test("scanSource flags CJK copy and say template literals with 1-based lines, skipping comments", () => {
		const source = [
			"// 中文注释不算",
			"const a = '中文文案'", // line 2
			"\tsay(`done in ${lang}`)", // line 3
			"say('plain string is not a template leak')", // line 4
			"ctx.say(`multi part ${x}`)", // line 5
		].join("\n")
		const found = scanSource(source)
		expect(found.cjkLines).toEqual([2])
		expect(found.templateSayLines).toEqual([3, 5])
	})

	test("scanSource catches multi-line say template literals (T15 blind spot)", () => {
		const source = [
			"ctx.say(", // line 1: call and template split across lines
			"\t`queue flushed — ${result.started} sending`", // line 2
			")",
			"ctx.say(", // line 4
			"\tcond",
			"\t\t? `arm one ${x}`", // line 6
			"\t\t: `arm two`", // line 7
			")",
			"say('plain string is not a template leak')",
		].join("\n")
		const found = scanSource(source)
		expect(found.templateSayLines).toEqual([1, 4])
	})

	test("scanTree skips node_modules, test files and non-source files; never throws on a missing root", () => {
		const dir = mkdtempSync(join(tmpdir(), "i18n-scan-"))
		try {
			writeFileSync(join(dir, "real.ts"), "const a = '中文'\n")
			writeFileSync(join(dir, "real.test.ts"), "const a = '中文'\n")
			writeFileSync(join(dir, "notes.md"), "中文")
			mkdirSync(join(dir, "node_modules", "dep"), { recursive: true })
			writeFileSync(join(dir, "node_modules", "dep", "index.ts"), "const a = '中文'\n")
			const found = scanTree(dir)
			expect(found.map((f: FileLeaks) => f.file)).toEqual([join(dir, "real.ts")])
			// a missing root is an empty result, not a crash
			expect(scanTree(join(dir, "does-not-exist"))).toEqual([])
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

		test("scanTree honors the exclude option", () => {
			const dir = mkdtempSync(join(tmpdir(), "i18n-scan-"))
			try {
				writeFileSync(join(dir, "keep.ts"), "const a = '中文'\n")
				writeFileSync(join(dir, "skip-me.ts"), "const a = '中文'\n")
				const found = scanTree(dir, { exclude: (file) => file.endsWith("skip-me.ts") })
				expect(found.map((f: FileLeaks) => f.file)).toEqual([join(dir, "keep.ts")])
			} finally {
				rmSync(dir, { recursive: true, force: true })
			}
		})

		test("scanTree skips the sanctioned vendored dead code by default", () => {
			const dir = mkdtempSync(join(tmpdir(), "i18n-scan-"))
			// the suffixes are matched against the shipped layout (<pkg>/src/...)
			const src = join(dir, "src")
			try {
				mkdirSync(src, { recursive: true })
				writeFileSync(join(src, "keep.ts"), "const a = '中文'\n")
				// dead code per the C12 disposition doc: v2-entry never mounts
				// the vendored app root or the session route reached from it
				mkdirSync(join(src, "routes", "session"), { recursive: true })
				writeFileSync(join(src, "routes", "session", "index.tsx"), "const a = '中文'\n")
				writeFileSync(join(src, "app.tsx"), "const a = '中文'\n")
				const found = scanTree(src)
				expect(found.map((f: FileLeaks) => f.file)).toEqual([join(src, "keep.ts")])
			} finally {
				rmSync(dir, { recursive: true, force: true })
			}
		})
})

describe("leak-guard ratchet (baseline may only go down — design §4 T14)", () => {
	const baseline = loadBaseline()

	for (const [pkg, root] of Object.entries(SCANNED_ROOTS)) {
		test(`${pkg}: residual copy counts <= baseline ${JSON.stringify(baseline[pkg])}`, () => {
			const files = scanTree(root, { exclude: EXCLUDED })
			const totals = totalsOf(files)
			const expected = baseline[pkg] ?? { cjkLines: 0, templateSayCalls: 0 }
			if (totals.cjkLines > expected.cjkLines || totals.templateSayCalls > expected.templateSayCalls) {
				// surface the per-file breakdown as the failure payload
				expect(
					`leak overflow in ${pkg} — new copy must go through t() + locale tables; ` +
						`if a facet migration removed copy, lower leak-guard-baseline.json in the same commit:\n` +
						formatBreakdown(files),
				).toBe("")
			}
			expect(totals.cjkLines).toBeLessThanOrEqual(expected.cjkLines)
			expect(totals.templateSayCalls).toBeLessThanOrEqual(expected.templateSayCalls)
		})
	}
})
