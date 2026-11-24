/**
 * Pure detector for the `no-client-patch-writers` gate (P0-4 hardening).
 *
 * Input: one source file as a string. Output: plain violation records.
 * No fs/network access, no imports from `src/` — this module is safe to feed
 * inline fake source strings in self-tests.
 *
 * Two dimensions, both required for a violation:
 *   A ("patch target"): the patch filename literal (also inside template
 *     strings / `join(...)` args), a patch-path helper call, or a local
 *     variable whose initializer contains either of the former.
 *   B ("write capability"): a write/mutate call symbol, including namespace
 *     chains (`fs.promises.writeFile`) and `Bun.write`.
 *
 * Co-occurrence is judged **inside a single write call** (i.e. within one
 * function body), not per file. Reason: a real client file
 * (`src/client/local-config-faces.ts`) legitimately holds a read-only
 * `#patchPath` alongside writes to `config.json` / `provider-keys.json`;
 * a file-level rule would flag it as a false positive.
 */

export interface PatchWriterViolation {
	/** 1-based line number of the write call. */
	line: number
	/** The matched write-call head plus a bounded argument excerpt. */
	snippet: string
	/** Dimension B symbol that fired. */
	writeSymbol: string
	/** Dimension A form that fired inside the write-call arguments. */
	targetForm: string
}

export interface DetectOptions {
	/** Extra helpers that resolve a patch path (dimension A). */
	patchPathHelpers?: readonly string[]
	/** Extra write/mutate call symbols (dimension B). */
	writeSymbols?: readonly string[]
}

/** Helpers seen in this repo's design/tests plus conventional aliases. */
export const PATCH_PATH_HELPERS = [
	"patchFilePath",
	"resolvePatchPath",
	"profilePatchPath",
	"patchPath",
] as const

/** Broad write/mutate surface; ordered longest-first at match time. */
export const WRITE_SYMBOLS = [
	"writeFileSync",
	"writeAtomically",
	"appendFileSync",
	"copyFileSync",
	"createWriteStream",
	"truncateSync",
	"unlinkSync",
	"renameSync",
	"outputFile",
	"atomicWrite",
	"writeFile",
	"appendFile",
	"rename",
	"copyFile",
	"rmSync",
	"writeSync",
] as const

export const PATCH_FILENAME = "cordis.patch.yml"

/** Opt-in source marker for read-only path-constant files. */
export const READONLY_MARKER = "@patch-readonly"

export function hasReadonlyMarker(source: string): boolean {
	return source.includes(READONLY_MARKER) || /patch-writer-guard:\s*readonly/.test(source)
}

/**
 * Whitelist semantics, kept as a pure function so it can be asserted on.
 * Paths are repo-relative with forward slashes.
 */
export function isExemptPatchScanPath(relPath: string): { exempt: boolean; reason: string } {
	const p = relPath.replace(/\\/g, "/")
	const seg = (name: string): boolean => p === name || p.startsWith(`${name}/`) || p.includes(`/${name}/`)

	// 1. Build output — never authoritative source.
	if (seg("dist") || seg("build")) return { exempt: true, reason: "build output" }
	// 2. Tests and fixtures — synthetic violation strings live here.
	if (seg("test") || seg("tests") || seg("fixtures") || seg("__fixtures__") || /\.test\.[cm]?[jt]sx?$/.test(p)) {
		return { exempt: true, reason: "test / fixture" }
	}
	// 3. Provisioner (the sole legitimate writer) and launcher scripts.
	if (seg("scripts") || seg("bin") || /provision(-[a-z]+)*-profile\.mjs$/.test(p)) {
		return { exempt: true, reason: "provisioner (sole writer)" }
	}
	// 4. Explicit read-only path constants.
	if (/(^|\/)profile-constants\.ts$/.test(p)) {
		return { exempt: true, reason: "read-only path constants" }
	}
	return { exempt: false, reason: "" }
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function uniqueSorted(names: readonly string[]): string[] {
	return [...new Set(names)].sort((a, b) => b.length - a.length || a.localeCompare(b))
}

/**
 * Extract a balanced argument list starting at `openIndex` (the `(`).
 * Quotes are honoured so a `(` inside a string argument does not skew depth.
 */
function extractArgs(source: string, openIndex: number): string {
	let depth = 0
	let quote: '"' | "'" | "`" | undefined
	let escaped = false
	for (let i = openIndex; i < source.length; i++) {
		const ch = source[i]!
		if (quote !== undefined) {
			if (escaped) {
				escaped = false
			} else if (ch === "\\") {
				escaped = true
			} else if (ch === quote) {
				quote = undefined
			}
			continue
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch
		} else if (ch === "(") {
			depth++
		} else if (ch === ")") {
			depth--
			if (depth === 0) return source.slice(openIndex + 1, i)
		}
	}
	return source.slice(openIndex + 1)
}

function mentionsIdentifier(text: string, name: string): boolean {
	if (name.startsWith("#")) return text.includes(name)
	return new RegExp(`(^|[^\\w$])${escapeRe(name)}(?![\\w$])`).test(text)
}

function lineAt(source: string, index: number): number {
	let line = 1
	for (let i = 0; i < index; i++) if (source[i] === "\n") line++
	return line
}

/**
 * Dimension A match inside a write-call argument list.
 */
function patchTargetInArgs(
	args: string,
	helpers: readonly string[],
	patchVars: readonly string[],
): string | undefined {
	if (args.includes(PATCH_FILENAME)) return `literal:${PATCH_FILENAME}`

	const helperRe = new RegExp(`\\b(?:${helpers.map(escapeRe).join("|")})\\s*\\(`)
	const helper = helperRe.exec(args)
	if (helper) return `helper:${helper[0].replace(/\s*\($/, "")}`

	for (const name of patchVars) {
		if (mentionsIdentifier(args, name)) return `var:${name}`
	}
	return undefined
}

/**
 * Main pure detector. Returns one record per offending write call.
 */
export function detectPatchWriterViolations(source: string, options: DetectOptions = {}): PatchWriterViolation[] {
	const helpers = uniqueSorted([...PATCH_PATH_HELPERS, ...(options.patchPathHelpers ?? [])])
	const symbols = uniqueSorted([...WRITE_SYMBOLS, ...(options.writeSymbols ?? [])])

	// Dimension A, part 2: variables assigned a path built from the literal or a
	// helper call. Covers `const p = join(dir, "cordis.patch.yml")` and
	// `this.#patchPath = join(home, ...)`; read-only uses of such vars are fine —
	// they only escalate to a violation when passed to a write call.
	const patchVars = new Set<string>()
	const aRe = new RegExp(
		`(?:this\\.)?(#[A-Za-z_]\\w*|[A-Za-z_]\\w*)\\s*=[^;\\n]*(?:${escapeRe(PATCH_FILENAME)}|\\b(?:${helpers.map(escapeRe).join("|")})\\s*\\()`,
		"g",
	)
	for (const m of source.matchAll(aRe)) patchVars.add(m[1]!)

	// Dimension B: write call heads. Member chains (`fs.promises.writeFile`,
	// `obj.atomicWrite`) are included; symbols are longest-first so `renameSync`
	// wins over `rename`.
	const bRe = new RegExp(
		`(?:\\b[A-Za-z_$][\\w$]*\\s*\\.\\s*)*\\b(?:${symbols.map(escapeRe).join("|")})\\s*\\(`,
		"g",
	)
	const bunRe = /\bBun\s*\.\s*write\s*\(/g

	const calls: Array<{ index: number; head: string; open: number; symbol: string }> = []
	for (const m of source.matchAll(bRe)) {
		const head = m[0]
		calls.push({
			index: m.index!,
			head: head.trim(),
			open: m.index! + head.lastIndexOf("("),
			symbol: head.replace(/\s*\($/, "").split(/\s*\.\s*/).pop() ?? head,
		})
	}
	for (const m of source.matchAll(bunRe)) {
		const head = m[0]
		calls.push({
			index: m.index!,
			head: head.trim(),
			open: m.index! + head.lastIndexOf("("),
			symbol: "Bun.write",
		})
	}

	calls.sort((a, b) => a.index - b.index)
	const violations: PatchWriterViolation[] = []
	for (const call of calls) {
		const args = extractArgs(source, call.open)
		const targetForm = patchTargetInArgs(args, helpers, [...patchVars])
		if (targetForm === undefined) continue
		violations.push({
			line: lineAt(source, call.index),
			snippet: `${call.head} ${args.trim().slice(0, 100)}`.trim(),
			writeSymbol: call.symbol,
			targetForm,
		})
	}
	return violations
}
