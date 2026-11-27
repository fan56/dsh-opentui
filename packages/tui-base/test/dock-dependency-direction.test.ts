/**
 * Permanent guard for the one-way dock split:
 *   widgets-dock -> merged-dock -> dock-line-primitives
 *
 * The transitive checks walk relative imports and this package's package.json
 * imports; external bare packages are excluded. AST collection includes
 * import/export-from, import types, and literal dynamic imports with optional
 * import attributes, rather than relying on source-text spot checks.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import * as ts from "typescript"

const SRC_DIR = join(import.meta.dir, "..", "src")
const SESSION_DIR = join(SRC_DIR, "routes", "session")
const MERGED_DOCK = join(SESSION_DIR, "merged-dock.ts")
const WIDGETS_DOCK = join(SESSION_DIR, "widgets-dock.tsx")
const DOCK_LINE_PRIMITIVES = join(SESSION_DIR, "dock-line-primitives.ts")
const PACKAGE_ROOT = join(import.meta.dir, "..")
const MIN_STATIC_CLOSURE_SIZE = 10

type PackageImports = Record<string, string | { bun?: unknown; default?: unknown }>

const packageImports: PackageImports =
	(JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { imports?: PackageImports }).imports ?? {}

interface ModuleReferences {
	static: string[]
	dynamic: string[]
}

interface DynamicReference {
	from: string
	target: string
	specifier: string
}

interface StaticClosure {
	parents: Map<string, string | null>
	visited: string[]
	dynamicReferences: DynamicReference[]
}

const referenceCache = new Map<string, ModuleReferences>()
const staticClosureCache = new Map<string, StaticClosure>()

function displayPath(file: string): string {
	return relative(SRC_DIR, file).split(sep).join("/")
}

function isFile(file: string): boolean {
	return existsSync(file) && statSync(file).isFile()
}

function isInsideSrc(file: string): boolean {
	const rel = relative(SRC_DIR, file)
	return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function resolveSourceFile(base: string): string | null {
	const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]
	return candidates.find(isFile) ?? null
}

function resolverCoverageError(fromFile: string, specifier: string): Error {
	return new Error(
		`Resolver coverage is insufficient; extend resolveSpecifier (解析器覆盖不足，请扩展 resolver): ${displayPath(fromFile)} -> ${specifier}`,
	)
}

/** Resolve relative modules and package imports; external bare packages are intentionally ignored. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
	if (specifier.startsWith("#")) {
		const target = packageImports[specifier]
		const mapped =
			typeof target === "string"
				? target
				: target !== null && typeof target === "object"
					? "bun" in target
						? target.bun
						: target.default
					: undefined
		if (typeof mapped !== "string" || !mapped.startsWith(".")) throw resolverCoverageError(fromFile, specifier)
		const dependency = resolveSourceFile(resolve(PACKAGE_ROOT, mapped))
		if (dependency === null) throw resolverCoverageError(fromFile, specifier)
		return dependency
	}
	if (!specifier.startsWith(".")) return null
	const dependency = resolveSourceFile(resolve(dirname(fromFile), specifier))
	if (dependency === null) throw resolverCoverageError(fromFile, specifier)
	return dependency
}

/** Collect import/export-from, import types, and literal dynamic import specifiers from the AST. */
function moduleReferences(file: string): ModuleReferences {
	const cached = referenceCache.get(file)
	if (cached !== undefined) return cached

	const source = ts.createSourceFile(
		file,
		readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		true,
		file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	)
	const references: ModuleReferences = { static: [], dynamic: [] }

	function visit(node: ts.Node): void {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier !== undefined &&
			ts.isStringLiteralLike(node.moduleSpecifier)
		) {
			references.static.push(node.moduleSpecifier.text)
		} else if (
			ts.isImportTypeNode(node) &&
			ts.isLiteralTypeNode(node.argument) &&
			ts.isStringLiteralLike(node.argument.literal)
		) {
			references.static.push(node.argument.literal.text)
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length >= 1 &&
			ts.isStringLiteralLike(node.arguments[0]!)
		) {
			references.dynamic.push(node.arguments[0]!.text)
		}
		ts.forEachChild(node, visit)
	}

	visit(source)
	referenceCache.set(file, references)
	return references
}

/** Walk the static closure, resolving literal dynamic imports from every reachable file. */
function staticClosure(start: string): StaticClosure {
	const cached = staticClosureCache.get(start)
	if (cached !== undefined) return cached

	const parents = new Map<string, string | null>([[start, null]])
	const dynamicReferences: DynamicReference[] = []
	const queue = [start]

	while (queue.length > 0) {
		const file = queue.shift()!
		const references = moduleReferences(file)
		for (const specifier of references.static) {
			const dependency = resolveSpecifier(file, specifier)
			if (dependency === null || !isInsideSrc(dependency) || parents.has(dependency)) continue
			parents.set(dependency, file)
			queue.push(dependency)
		}
		for (const specifier of references.dynamic) {
			const dependency = resolveSpecifier(file, specifier)
			if (dependency !== null && isInsideSrc(dependency)) {
				dynamicReferences.push({ from: file, target: dependency, specifier })
			}
		}
	}

	const closure = { parents, visited: [...parents.keys()], dynamicReferences }
	staticClosureCache.set(start, closure)
	return closure
}

function staticPathTo(start: string, target: string): string[] | null {
	const { parents } = staticClosure(start)
	if (!parents.has(target)) return null

	const path: string[] = []
	let cursor: string | null = target
	while (cursor !== null) {
		path.unshift(cursor)
		cursor = parents.get(cursor) ?? null
	}
	return path
}

function expectStaticClosureLowerBound(start: string): void {
	expect(staticClosure(start).visited.length).toBeGreaterThanOrEqual(MIN_STATIC_CLOSURE_SIZE)
}

function expectNoStaticPath(start: string, target: string): void {
	const path = staticPathTo(start, target)
	if (path !== null) {
		throw new Error(
			[
				"Dock dependency direction violation",
				`start: ${displayPath(start)}`,
				`target: ${displayPath(target)}`,
				`path: ${path.map(displayPath).join(" -> ")}`,
			].join("\n"),
		)
	}
	expect(path).toBeNull()
}

function expectNoDynamicPath(start: string, targets: readonly string[]): void {
	const targetSet = new Set(targets)
	const violations: string[] = []
	for (const reference of staticClosure(start).dynamicReferences) {
		if (!targetSet.has(reference.target)) continue
		const path = staticPathTo(start, reference.from)
		if (path === null) {
			throw new Error(`Missing static closure parent path for ${displayPath(reference.from)}`)
		}
		violations.push(
			`${path.map(displayPath).join(" -> ")} --dynamic import ${reference.specifier}--> ${displayPath(reference.target)}`,
		)
	}
	if (violations.length > 0) {
		throw new Error(
			[
				"Dock dependency direction violation",
				`start: ${displayPath(start)}`,
				`targets: ${targets.map(displayPath).join(", ")}`,
				`paths:\n${violations.join("\n")}`,
			].join("\n"),
		)
	}
	expect(violations).toEqual([])
}

function directReferencesTo(file: string, targets: readonly string[]): string[] {
	const targetSet = new Set(targets)
	const violations: string[] = []
	for (const [kind, specifiers] of [
		["static", moduleReferences(file).static],
		["dynamic", moduleReferences(file).dynamic],
	] as const) {
		for (const specifier of specifiers) {
			const dependency = resolveSpecifier(file, specifier)
			if (dependency !== null && targetSet.has(dependency)) {
				violations.push(`${displayPath(file)} --${kind}--> ${specifier} (${displayPath(dependency)})`)
			}
		}
	}
	return violations
}

describe("one-way dock dependency direction", () => {
	test("merged-dock source has zero static or literal dynamic import hits for widgets-dock", () => {
		const source = readFileSync(MERGED_DOCK, "utf8")
		const staticMatches = source.match(/(?:\bfrom\s*|\bimport\s*)["']\.\/widgets-dock(?:\.[cm]?[jt]sx?)?["']/g) ?? []
		const dynamicMatches = source.match(/\bimport\s*\(\s*["']\.\/widgets-dock(?:\.[cm]?[jt]sx?)?["']\s*\)/g) ?? []
		expect({ staticMatches, dynamicMatches }).toEqual({ staticMatches: [], dynamicMatches: [] })

		const references = directReferencesTo(MERGED_DOCK, [WIDGETS_DOCK])
		if (references.length > 0) {
			throw new Error(`Direct widgets-dock dependency from ${displayPath(MERGED_DOCK)}:\n${references.join("\n")}`)
		}
		expect(references).toEqual([])
	})

	test("dock-line-primitives has no direct static or dynamic dependency on either dock", () => {
		const references = directReferencesTo(DOCK_LINE_PRIMITIVES, [MERGED_DOCK, WIDGETS_DOCK])
		if (references.length > 0) {
			throw new Error(
				`Forbidden direct dock dependency from ${displayPath(DOCK_LINE_PRIMITIVES)}:\n${references.join("\n")}`,
			)
		}
		expect(references).toEqual([])
	})

	test("the merged-dock static closure has no static or dynamic path to widgets-dock", () => {
		expect(staticPathTo(WIDGETS_DOCK, MERGED_DOCK)).not.toBeNull()
		expectStaticClosureLowerBound(MERGED_DOCK)
		expectNoStaticPath(MERGED_DOCK, WIDGETS_DOCK)
		expectNoDynamicPath(MERGED_DOCK, [WIDGETS_DOCK])
	})

	test("the dock-line-primitives static closure has no static or dynamic path to either dock", () => {
		expectStaticClosureLowerBound(DOCK_LINE_PRIMITIVES)
		expectNoStaticPath(DOCK_LINE_PRIMITIVES, MERGED_DOCK)
		expectNoStaticPath(DOCK_LINE_PRIMITIVES, WIDGETS_DOCK)
		expectNoDynamicPath(DOCK_LINE_PRIMITIVES, [MERGED_DOCK, WIDGETS_DOCK])
	})
})
