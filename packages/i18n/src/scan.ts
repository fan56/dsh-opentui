/**
 * Leak-guard scanner (design c5-i18n §4 T14 infra, built AHEAD of the facet
 * migrations so the residual counts can only go DOWN — ratchet, see
 * test/leak-guard.test.ts):
 *
 * - hardcoded CJK copy: user-visible Chinese strings in source lines that are
 *   not comments and not test files;
 * - `say(`...`)` template-literal calls: interpolated user-facing strings
 *   that must become `command.*` `{param}` keys in the T4 migration.
 *
 * Deliberately line-based heuristics, not a parser: this is a monotonic
 * guard, it never needs to be perfect — only strict enough that new leaks
 * fail the unit tier. Pure node:fs/node:path, no UI dependencies (§3).
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/** Han ideographs (U+3400–U+9FFF: ext-A + unified). */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/

/** A `say(` call whose argument is a template literal (backtick). */
const SAY_TEMPLATE_RE = /\bsay\(\s*`/

/** Lines whose visible content is a comment are not user-visible copy. */
export function isCommentLine(line: string): boolean {
	const trimmed = line.trim()
	return (
		trimmed.startsWith("//") ||
		trimmed.startsWith("/*") ||
		trimmed.startsWith("*") ||
		trimmed.startsWith("*/")
	)
}

export interface SourceLeaks {
	/** 1-based line numbers carrying hardcoded CJK copy (comments excluded) */
	cjkLines: number[]
	/** 1-based line numbers of `say(`...`)` template-literal calls */
	templateSayLines: number[]
}

/** Scan one file's text for both leak kinds. Never throws. */
export function scanSource(source: string): SourceLeaks {
	const cjkLines: number[] = []
	const templateSayLines: number[] = []
	const lines = source.split("\n")
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? ""
		if (isCommentLine(line)) continue
		if (CJK_RE.test(line)) cjkLines.push(i + 1)
		if (SAY_TEMPLATE_RE.test(line)) templateSayLines.push(i + 1)
	}
	return { cjkLines, templateSayLines }
}

export interface FileLeaks extends SourceLeaks {
	/** path relative to the scanned root */
	file: string
}

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx"])

function* walkSources(
	dir: string,
	exclude?: (file: string) => boolean,
): Generator<string> {
	let entries
	try {
		entries = readdirSync(dir)
	} catch {
		return // missing root: nothing to scan, the caller decides if that is fatal
	}
	for (const entry of entries) {
		const full = join(dir, entry)
		let stats
		try {
			stats = statSync(full)
		} catch {
			continue
		}
		if (stats.isDirectory()) {
			if (entry === "node_modules") continue
			yield* walkSources(full, exclude)
		} else if (
			stats.isFile() &&
			SCANNED_EXTENSIONS.has(entry.slice(entry.lastIndexOf("."))) &&
			!entry.includes(".test.")
		) {
			if (exclude?.(full)) continue
			yield full
		}
	}
}

/**
 * Walk a source tree and scan every non-test .ts/.tsx file. Files with no
 * leaks are omitted. `exclude(file)` opts intentional non-UI-CJK files out
 * of the scan (see test/leak-guard.test.ts for the sanctioned list). Never
 * throws on unreadable files (skipped).
 */
export function scanTree(
	rootDir: string,
	options?: { exclude?: (file: string) => boolean },
): FileLeaks[] {
	const leaks: FileLeaks[] = []
	for (const file of walkSources(rootDir, options?.exclude)) {
		let source
		try {
			source = readFileSync(file, "utf8")
		} catch {
			continue
		}
		const found = scanSource(source)
		if (found.cjkLines.length > 0 || found.templateSayLines.length > 0) {
			leaks.push({ file, ...found })
		}
	}
	return leaks.sort((a, b) => a.file.localeCompare(b.file))
}

export interface LeakTotals {
	cjkLines: number
	templateSayCalls: number
}

export const totalsOf = (files: FileLeaks[]): LeakTotals => ({
	cjkLines: files.reduce((sum, f) => sum + f.cjkLines.length, 0),
	templateSayCalls: files.reduce((sum, f) => sum + f.templateSayLines.length, 0),
})

/** Human-readable per-file breakdown for the failure message / T14 清单. */
export function formatBreakdown(files: FileLeaks[]): string {
	return files
		.map(
			(f) =>
				`${f.file}: cjk=[${f.cjkLines.join(",")}] sayTemplate=[${f.templateSayLines.join(",")}]`,
		)
		.join("\n")
}
