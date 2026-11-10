/**
 * Source-level detector for the entry→host hook wiring (verification gate).
 *
 * The entry call site is:
 *   createSlashHost(buildSlashDeps({ ...base }, { ...hooks }))
 *
 * The previous assertion matched a hook name ANYWHERE in `v2-entry.tsx`, so a
 * hook moved from the second (hooks) literal into the base literal still left
 * the name in the file and the test stayed green — the gate would go blind
 * exactly when it matters. This module locates the SECOND argument's object
 * literal (`}, {` boundary) and scans only that region.
 *
 * Pure string functions, no file IO: `test/entry-slash-deps.test.ts` asserts
 * the real entry source and a synthetic counter-example (hook in the base).
 */

const CALL = "buildSlashDeps("
const ARG_BOUNDARY = "}, {"

/** The `{ ... }` source of the second argument, or null if the call shape is absent. */
export function entryHookRegion(source: string): string | null {
	const call = source.indexOf(CALL)
	if (call < 0) return null
	const boundary = source.indexOf(ARG_BOUNDARY, call + CALL.length)
	if (boundary < 0) return null
	const open = boundary + ARG_BOUNDARY.length - 1
	const close = matchingBrace(source, open)
	return close < 0 ? null : source.slice(open, close + 1)
}

/** Hooks absent from the second argument; null when the call shape is absent. */
export function missingEntryHooks(source: string, hooks: readonly string[]): string[] | null {
	const region = entryHookRegion(source)
	if (region === null) return null
	const code = stripCommentsAndStrings(region)
	return hooks.filter(
		(key) => !new RegExp(`(^|[\\s{,])${escapeRegExp(key)}[,:]`, "m").test(code),
	)
}

/** Throws with the missing-hook list; used by the gate so failures name the hook. */
export function assertEntryHooks(source: string, hooks: readonly string[]): void {
	const missing = missingEntryHooks(source, hooks)
	if (missing === null) {
		throw new Error(
			`entry does not call ${CALL}<base>, <hooks>): no '${ARG_BOUNDARY}' boundary found`,
		)
	}
	if (missing.length > 0) {
		throw new Error(
			`entry hooks missing from the SECOND argument of buildSlashDeps: ${missing.join(", ")}`,
		)
	}
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Index of the `}` matching `open` (brace/string/comment aware), or -1. */
function matchingBrace(source: string, open: number): number {
	let depth = 0
	for (let i = open; i < source.length; i++) {
		const ch = source[i]
		if (ch === '"' || ch === "'" || ch === "`") {
			i = skipString(source, i) - 1
			continue
		}
		if (ch === "/" && source[i + 1] === "/") {
			const newline = source.indexOf("\n", i + 2)
			i = newline < 0 ? source.length : newline
			continue
		}
		if (ch === "/" && source[i + 1] === "*") {
			const end = source.indexOf("*/", i + 2)
			i = end < 0 ? source.length : end + 1
			continue
		}
		if (ch === "{") depth++
		else if (ch === "}" && --depth === 0) return i
	}
	return -1
}

/** Index just past the string literal starting at `start`. */
function skipString(source: string, start: number): number {
	const quote = source[start]
	let i = start + 1
	while (i < source.length) {
		const ch = source[i]
		if (ch === "\\") {
			i += 2
			continue
		}
		if (quote === "`" && ch === "$" && source[i + 1] === "{") {
			const close = matchingBrace(source, i + 1)
			if (close < 0) return source.length
			i = close + 1
			continue
		}
		if (ch === quote) return i + 1
		i++
	}
	return source.length
}

/** Replace comments and string contents with spaces so names inside them never match. */
function stripCommentsAndStrings(source: string): string {
	let out = ""
	for (let i = 0; i < source.length; ) {
		const ch = source[i]
		if (ch === '"' || ch === "'" || ch === "`") {
			i = skipString(source, i)
			out += " "
			continue
		}
		if (ch === "/" && source[i + 1] === "/") {
			const newline = source.indexOf("\n", i + 2)
			i = newline < 0 ? source.length : newline
			out += " "
			continue
		}
		if (ch === "/" && source[i + 1] === "*") {
			const end = source.indexOf("*/", i + 2)
			i = end < 0 ? source.length : end + 2
			out += " "
			continue
		}
		out += ch
		i++
	}
	return out
}
