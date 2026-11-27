/**
 * Permanent guard for the one-way dock split:
 *   widgets-dock -> merged-dock -> dock-line-primitives
 *
 * The transitive checks use the TypeScript AST (including type-only imports and
 * export-from declarations), not source text or direct-import spot checks.
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

interface ModuleReferences {
	static: string[]
	dynamic: string[]
}

const referenceCache = new Map<string, ModuleReferences>()

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

/** Resolve only relative TypeScript modules, with the source-tree forms used by this package. */
function resolveRelativeSpecifier(fromFile: string, specifier: string): string | null {
	if (!specifier.startsWith(".")) return null
	const base = resolve(dirname(fromFile), specifier)
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		join(base, "index.ts"),
		join(base, "index.tsx"),
	]
	return candidates.find(isFile) ?? null
}

/** Collect import/export-from and literal dynamic import specifiers from the AST. */
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
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length === 1 &&
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

/** Mechanically walk the complete static closure and retain parents for failure paths. */
function staticPathTo(start: string, target: string): string[] | null {
	const parents = new Map<string, string | null>([[start, null]])
	const queue = [start]
	const unresolved: string[] = []

	while (queue.length > 0) {
		const file = queue.shift()!
		for (const specifier of moduleReferences(file).static) {
			if (!specifier.startsWith(".")) continue
			const dependency = resolveRelativeSpecifier(file, specifier)
			if (dependency === null) {
				unresolved.push(`${displayPath(file)} -> ${specifier}`)
				continue
			}
			if (!isInsideSrc(dependency) || parents.has(dependency)) continue
			parents.set(dependency, file)
			queue.push(dependency)
		}
	}

	if (unresolved.length > 0) {
		throw new Error(`Unresolved relative static imports while walking ${displayPath(start)}:\n${unresolved.join("\n")}`)
	}
	if (!parents.has(target)) return null

	const path: string[] = []
	let cursor: string | null = target
	while (cursor !== null) {
		path.unshift(cursor)
		cursor = parents.get(cursor) ?? null
	}
	return path
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

function directReferencesTo(file: string, targets: readonly string[]): string[] {
	const targetSet = new Set(targets)
	const violations: string[] = []
	for (const [kind, specifiers] of [
		["static", moduleReferences(file).static],
		["dynamic", moduleReferences(file).dynamic],
	] as const) {
		for (const specifier of specifiers) {
			const dependency = resolveRelativeSpecifier(file, specifier)
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

	test("the merged-dock static closure cannot reach widgets-dock", () => {
		expectNoStaticPath(MERGED_DOCK, WIDGETS_DOCK)
	})

	test("the dock-line-primitives static closure cannot reach merged-dock or widgets-dock", () => {
		expectNoStaticPath(DOCK_LINE_PRIMITIVES, MERGED_DOCK)
		expectNoStaticPath(DOCK_LINE_PRIMITIVES, WIDGETS_DOCK)
	})
})
