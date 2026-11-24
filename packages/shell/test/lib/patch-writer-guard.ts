/**
 * Pure detector for the `no-client-patch-writers` gate (P0-4 / P1-B hardening).
 *
 * Input: one source file as a string. Output: plain violation records.
 * No fs/network access, no imports from `src/` — this module is safe to feed
 * inline fake source strings in self-tests.
 *
 * P1-B replaced the old 234-line regex/balanced-paren scanner with a lightweight
 * TypeScript AST taint analysis. The old scanner matched only *syntactically
 * adjacent* tokens, so it was bypassed by line breaks, import/destructure
 * aliases, helper extraction, imported path constants and string concatenation.
 * Parsing first makes those syntactic variations irrelevant.
 *
 * Two dimensions, both required for a violation, co-occurring inside one write
 * call:
 *   A ("patch target"): a path expression tainted by the patch filename literal
 *     (incl. templates / concatenation), a patch-path helper, an imported
 *     PATCH-named constant, a tainted local/property, or a tainted function
 *     parameter (same-file call graph).
 *   B ("write capability"): a write/mutate/subprocess call symbol, resolved
 *     through import/destructure aliases and member chains.
 *
 * Co-occurrence is judged **inside a single write call**, not per file. Reason:
 * `src/client/local-config-faces.ts` legitimately holds read-only `#patchPath`
 * fields alongside writes to `config.json` / `provider-keys.json`; a file-level
 * rule would flag it as a false positive.
 *
 * Dependency: the repo's existing `typescript` devDependency (API only, no
 * install, no emit). If TS were unavailable the old structured scanner would be
 * the fallback, but TS 5.9.x is present so the AST path is always used here.
 */
import ts from "typescript"

export interface PatchWriterViolation {
	/** 1-based line number of the write call. */
	line: number
	/** The matched write-call head plus a bounded argument excerpt. */
	snippet: string
	/** Canonical dimension-B symbol that fired. */
	writeSymbol: string
	/** Dimension-A taint reason that fired inside the write-call path argument. */
	targetForm: string
	/** Repo-relative file, when the caller supplied one via DetectOptions.file. */
	file?: string
}

export interface DetectOptions {
	/** Extra helpers that resolve a patch path (dimension A). */
	patchPathHelpers?: readonly string[]
	/** Extra write/mutate call symbols (dimension B). */
	writeSymbols?: readonly string[]
	/** Repo-relative path, echoed into each violation for locating. */
	file?: string
}

/** Helpers seen in this repo's design/tests plus conventional aliases. */
export const PATCH_PATH_HELPERS = [
	"patchFilePath",
	"resolvePatchPath",
	"profilePatchPath",
	"patchPath",
] as const

/** Broad write/mutate surface; kept from P0-4 so no capability is lost. */
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

/** Subprocess faces: a command/arg list carrying a patch path also writes it. */
export const SUBPROCESS_SYMBOLS = [
	"execSync",
	"spawnSync",
	"execFileSync",
	"exec",
	"spawn",
	"execFile",
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

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function walk(node: ts.Node, cb: (n: ts.Node) => void): void {
	cb(node)
	ts.forEachChild(node, (child) => walk(child, cb))
}

/** Strip transparent wrappers so taint/call resolution sees the core expression. */
function unwrap(expr: ts.Expression): ts.Expression {
	let e = expr
	for (;;) {
		if (
			ts.isParenthesizedExpression(e) ||
			ts.isAsExpression(e) ||
			ts.isNonNullExpression(e) ||
			ts.isSatisfiesExpression(e) ||
			ts.isTypeAssertionExpression(e)
		) {
			e = e.expression
		} else {
			return e
		}
	}
}

/** Flatten `fs.promises.writeFile` into ["fs","promises","writeFile"]. */
function flattenAccess(expr: ts.Expression): string[] | undefined {
	const e = unwrap(expr)
	if (ts.isIdentifier(e)) return [e.text]
	if (ts.isPropertyAccessExpression(e)) {
		const base = flattenAccess(e.expression)
		if (!base) return undefined
		return [...base, e.name.text]
	}
	return undefined
}

/** Constant-fold a chain of string `+` so `"cordis" + ".patch.yml"` is seen. */
function foldedString(expr: ts.Expression): string | undefined {
	const e = unwrap(expr)
	if (ts.isStringLiteralLike(e)) return e.text
	if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
		const left = foldedString(e.left)
		const right = foldedString(e.right)
		if (left !== undefined && right !== undefined) return left + right
	}
	return undefined
}

const SUBPROCESS_SET: ReadonlySet<string> = new Set(SUBPROCESS_SYMBOLS)

/** Member chains that must map to a canonical write symbol. */
const MEMBER_WRITE_CHAINS = new Map<string, string>([
	["fs.promises.writeFile", "writeFile"],
	["promises.writeFile", "writeFile"],
	["fsp.writeFile", "writeFile"],
	["fs.writeFile", "writeFile"],
	["Bun.write", "Bun.write"],
	["Bun.spawn", "Bun.spawn"],
	["Deno.writeTextFile", "Deno.writeTextFile"],
	["Deno.writeTextFileSync", "Deno.writeTextFileSync"],
	["Deno.writeFile", "Deno.writeFile"],
	["Deno.writeFileSync", "Deno.writeFileSync"],
	["Deno.write", "Deno.write"],
])

/**
 * Dimension B: resolve a call target to a canonical write symbol, honouring
 * import/destructure aliases and namespace member chains.
 */
function resolveWriteSymbol(expr: ts.Expression, aliases: ReadonlyMap<string, string>, writeSet: ReadonlySet<string>): string | undefined {
	const e = unwrap(expr)
	if (ts.isIdentifier(e)) {
		const canonical = aliases.get(e.text) ?? e.text
		if (writeSet.has(canonical)) return canonical
		if (SUBPROCESS_SET.has(canonical)) return canonical
		return undefined
	}
	if (ts.isPropertyAccessExpression(e)) {
		const segs = flattenAccess(e)
		if (!segs) return undefined
		const root = aliases.get(segs[0]!) ?? segs[0]!
		segs[0] = root
		const mapped = MEMBER_WRITE_CHAINS.get(segs.join("."))
		if (mapped) return mapped
		const last = segs[segs.length - 1]!
		if ((root === "fs" || root === "fsp" || root === "promises" || root === "nodeFs") && (writeSet.has(last) || SUBPROCESS_SET.has(last))) {
			return last
		}
		return undefined
	}
	return undefined
}

/** Only path-like arguments are checked; content/data args must not taint a write. */
function pathArgIndices(symbol: string): readonly number[] | "all" {
	if (SUBPROCESS_SET.has(symbol)) return "all" // command string + arg array
	if (symbol === "renameSync" || symbol === "rename" || symbol === "copyFileSync" || symbol === "copyFile") return [0, 1]
	return [0]
}

interface TaintContext {
	/** Tainted local / property / param names in scope. */
	tainted: ReadonlySet<string>
	/** Imported bindings that denote a patch path. */
	patchConsts: ReadonlySet<string>
	/** Patch-path helper names. */
	helpers: ReadonlySet<string>
}

/**
 * Dimension A: return the taint reason for an expression, or undefined.
 * Deliberately does NOT propagate taint through arbitrary function results
 * (e.g. JSON.stringify / readFileSync content): only path-building shapes and
 * explicitly tainted names count. This keeps `writeFileSync(configPath, data)`
 * clean when the file also reads the patch.
 */
function taintReason(expr: ts.Expression, ctx: TaintContext): string | undefined {
	const e = unwrap(expr)
	if (ts.isStringLiteralLike(e) && e.text.includes(PATCH_FILENAME)) return `literal:${PATCH_FILENAME}`
	if (ts.isTemplateExpression(e)) {
		if (e.getText().includes(PATCH_FILENAME)) return `literal:${PATCH_FILENAME}`
		for (const span of e.templateSpans) {
			const reason = taintReason(span.expression, ctx)
			if (reason) return reason
		}
		return undefined
	}
	if (ts.isIdentifier(e)) {
		if (ctx.patchConsts.has(e.text)) return `const:${e.text}`
		if (ctx.tainted.has(e.text)) return `var:${e.text}`
		return undefined
	}
	if (ts.isPropertyAccessExpression(e)) {
		const reason = taintReason(e.expression, ctx)
		if (reason) return reason
		if (ctx.tainted.has(e.name.text)) return `var:${e.name.text}`
		return undefined
	}
	if (ts.isElementAccessExpression(e)) {
		const base = taintReason(e.expression, ctx)
		if (base) return base
		if (e.argumentExpression) return taintReason(e.argumentExpression, ctx)
		return undefined
	}
	if (ts.isBinaryExpression(e)) {
		const folded = foldedString(e)
		if (folded?.includes(PATCH_FILENAME)) return `literal:${PATCH_FILENAME}`
		return taintReason(e.left, ctx) ?? taintReason(e.right, ctx)
	}
	if (ts.isCallExpression(e)) {
		const segs = flattenAccess(e.expression)
		const callee = segs?.[segs.length - 1]
		if (callee && ctx.helpers.has(callee)) return `helper:${callee}`
		for (const arg of e.arguments) {
			const reason = taintReason(arg, ctx)
			if (reason) return reason
		}
		return undefined
	}
	if (ts.isArrayLiteralExpression(e)) {
		for (const element of e.elements) {
			const reason = taintReason(element, ctx)
			if (reason) return reason
		}
		return undefined
	}
	if (ts.isPrefixUnaryExpression(e)) return taintReason(e.operand, ctx)
	if (ts.isConditionalExpression(e)) return taintReason(e.whenTrue, ctx) ?? taintReason(e.whenFalse, ctx)
	return undefined
}

function scriptKind(file: string | undefined): ts.ScriptKind {
	if (file?.endsWith(".tsx")) return ts.ScriptKind.TSX
	if (file?.endsWith(".jsx")) return ts.ScriptKind.JSX
	return ts.ScriptKind.TS
}

interface FuncInfo {
	name: string
	params: string[]
}

/**
 * Main pure detector. Returns one record per offending write call.
 */
export function detectPatchWriterViolations(source: string, options: DetectOptions = {}): PatchWriterViolation[] {
	const sf = ts.createSourceFile(options.file ?? "inline.ts", source, ts.ScriptTarget.Latest, true, scriptKind(options.file))
	const helpers = new Set<string>([...PATCH_PATH_HELPERS, ...(options.patchPathHelpers ?? [])])
	const writeSet = new Set<string>([...WRITE_SYMBOLS, ...(options.writeSymbols ?? [])])
	const aliases = new Map<string, string>()
	const patchConsts = new Set<string>()

	// Pass 1 — imports: alias table (B) + imported PATCH-named bindings (A).
	for (const stmt of sf.statements) {
		if (!ts.isImportDeclaration(stmt)) continue
		const mod = ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : ""
		const fsModule = /(^|\/)fs$|node:fs$/.test(mod)
		const patchyModule = /patch/i.test(mod)
		const clause = stmt.importClause
		if (!clause) continue
		if (clause.name) {
			if (fsModule) aliases.set(clause.name.text, "fs")
			if (patchyModule || /patch/i.test(clause.name.text)) patchConsts.add(clause.name.text)
		}
		const named = clause.namedBindings
		if (named && ts.isNamedImports(named)) {
			for (const el of named.elements) {
				const original = el.propertyName?.text ?? el.name.text
				const local = el.name.text
				if (writeSet.has(original) || original === "promises") aliases.set(local, original)
				if (helpers.has(original)) helpers.add(local)
				if (patchyModule || /patch/i.test(original) || /patch/i.test(local)) patchConsts.add(local)
			}
		} else if (named && ts.isNamespaceImport(named)) {
			aliases.set(named.name.text, fsModule ? "fs" : named.name.text)
		}
	}

	// Pass 2 — variable initializers / assignments (A), destructure aliases (B).
	const varDecls: Array<{ name: string; init: ts.Expression | undefined }> = []
	const propAssigns: Array<{ name: string; value: ts.Expression }> = []
	walk(sf, (node) => {
		if (ts.isVariableDeclaration(node) && node.initializer) {
			if (ts.isIdentifier(node.name)) {
				varDecls.push({ name: node.name.text, init: node.initializer })
				// `const w = writeFileSync` / `const w = fs.writeFile` is a write alias.
				const canonical = resolveWriteSymbol(node.initializer, aliases, writeSet)
				if (canonical) aliases.set(node.name.text, canonical)
			} else if (ts.isObjectBindingPattern(node.name)) {
				for (const el of node.name.elements) {
					if (!ts.isIdentifier(el.name)) continue
					if (el.propertyName && ts.isIdentifier(el.propertyName)) {
						const original = el.propertyName.text
						if (writeSet.has(original) || original === "promises") aliases.set(el.name.text, original)
						if (helpers.has(original)) helpers.add(el.name.text)
						if (/patch/i.test(original) || /patch/i.test(el.name.text)) patchConsts.add(el.name.text)
					}
				}
			}
		}
		if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
			if (ts.isPropertyAccessExpression(node.left)) propAssigns.push({ name: node.left.name.text, value: node.right })
			else if (ts.isIdentifier(node.left)) varDecls.push({ name: node.left.text, init: node.right })
		}
	})

	// Fixpoint: a tainted initializer can feed another variable / property.
	const tainted = new Set<string>(patchConsts)
	let varChanged = true
	let varIter = 0
	while (varChanged && varIter++ <= varDecls.length + propAssigns.length + 2) {
		varChanged = false
		const ctx: TaintContext = { tainted, patchConsts, helpers }
		for (const decl of varDecls) {
			if (!tainted.has(decl.name) && decl.init && taintReason(decl.init, ctx)) {
				tainted.add(decl.name)
				varChanged = true
			}
		}
		for (const assign of propAssigns) {
			if (!tainted.has(assign.name) && taintReason(assign.value, ctx)) {
				tainted.add(assign.name)
				varChanged = true
			}
		}
	}

	// Pass 3 — local functions (for same-file call-graph param taint) + calls.
	const funcs = new Map<string, FuncInfo[]>()
	const nodeFuncName = new Map<ts.Node, string>()
	const addFunc = (name: string, node: ts.Node, params: string[]): void => {
		if (!name) return
		const list = funcs.get(name) ?? []
		list.push({ name, params })
		funcs.set(name, list)
		nodeFuncName.set(node, name)
	}
	const paramNamesOf = (fn: ts.SignatureDeclaration): string[] =>
		fn.parameters.map((p) => {
			const text = p.name.getText(sf)
			return text.startsWith("...") ? text.slice(3) : text
		})

	const calls: ts.CallExpression[] = []
	walk(sf, (node) => {
		if (ts.isFunctionDeclaration(node) && node.name) addFunc(node.name.text, node, paramNamesOf(node))
		else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) addFunc(node.name.text, node, paramNamesOf(node))
		else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
			(ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
			addFunc(node.name.text, node.initializer, paramNamesOf(node.initializer))
		}
		if (ts.isCallExpression(node)) calls.push(node)
	})

	const enclosingName = (node: ts.Node): string => {
		let cur: ts.Node | undefined = node.parent
		while (cur) {
			const name = nodeFuncName.get(cur)
			if (name) return name
			cur = cur.parent
		}
		return ""
	}
	const scopeTaint = (owner: string): Set<string> => {
		const names = new Set<string>(tainted)
		if (owner) for (const n of taintedParams.get(owner) ?? []) names.add(n)
		return names
	}

	// Fixpoint: caller passes a tainted path -> callee's matching param is tainted.
	const taintedParams = new Map<string, Set<string>>()
	let cgChanged = true
	let cgIter = 0
	while (cgChanged && cgIter++ <= funcs.size + 2) {
		cgChanged = false
		for (const call of calls) {
			const segs = flattenAccess(call.expression)
			const callee = segs?.[segs.length - 1]
			if (!callee) continue
			const targets = funcs.get(callee)
			if (!targets?.length) continue
			const ctx: TaintContext = { tainted: scopeTaint(enclosingName(call)), patchConsts, helpers }
			call.arguments.forEach((arg, index) => {
				if (!taintReason(arg, ctx)) return
				for (const target of targets) {
					const param = target.params[index]
					if (!param) continue
					let set = taintedParams.get(target.name)
					if (!set) {
						set = new Set<string>()
						taintedParams.set(target.name, set)
					}
					if (!set.has(param)) {
						set.add(param)
						cgChanged = true
					}
				}
			})
		}
	}

	// Pass 4 — write calls whose path arguments carry patch taint.
	const violations: PatchWriterViolation[] = []
	const seen = new Set<ts.Node>()
	for (const call of calls) {
		if (seen.has(call)) continue
		const writeSymbol = resolveWriteSymbol(call.expression, aliases, writeSet)
		if (!writeSymbol) continue
		const ctx: TaintContext = { tainted: scopeTaint(enclosingName(call)), patchConsts, helpers }
		const indices = pathArgIndices(writeSymbol)
		let reason: string | undefined
		if (indices === "all") {
			for (const arg of call.arguments) {
				reason = taintReason(arg, ctx)
				if (reason) break
			}
		} else {
			for (const index of indices) {
				const arg = call.arguments[index]
				if (!arg) continue
				reason = taintReason(arg, ctx)
				if (reason) break
			}
		}
		if (!reason) continue
		seen.add(call)
		const pos = sf.getLineAndCharacterOfPosition(call.getStart(sf))
		violations.push({
			line: pos.line + 1,
			snippet: call.getText(sf).replace(/\s+/g, " ").trim().slice(0, 140),
			writeSymbol,
			targetForm: reason,
			...(options.file ? { file: options.file } : {}),
		})
	}
	return violations
}
