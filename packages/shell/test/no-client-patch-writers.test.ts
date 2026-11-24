/**
 * T7 gate (06 R6 / §6.1 / oldfox-3 T7): the profile patch is a HOST-OWNED
 * runtime file. Client source (`packages/shell/src`, scripts/ excluded) must
 * never WRITE it, and the two settings whitelist tables must stay in sync.
 *
 * This is a code-invariant gate, not a security boundary: it fails the build
 * if a future writer is reintroduced or only one whitelist table is widened.
 *
 * P0-4: the detector is a pure function (`./lib/patch-writer-guard.ts`) so it
 * can be fed inline fake source. The old regex only matched `writeFileSync(...)`
 * when its arguments had no nested parentheses.
 * P1-B: the detector was upgraded to a TypeScript AST taint analysis. Oldfox's
 * 8 bypass samples (newline assignment, import/destructure alias, helper
 * extraction, imported path constant, string concat, Deno write, subprocess
 * write) are now pinned as synthetic self-tests below, each with a sanitized
 * negative control so a blanket "any write call" rule cannot pass the suite.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

import { SETTINGS_NS_VALUE_FIELDS } from "../src/client/bridge-settings-route.ts"
import { NS_VALUE_FIELDS } from "../src/client/local-config-faces.ts"
import {
	detectPatchWriterViolations,
	hasReadonlyMarker,
	isExemptPatchScanPath,
} from "./lib/patch-writer-guard.ts"

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url))

/** Every .ts/.tsx file under shell/src (the other agent's scripts/ is out of scope). */
function sourceFiles(dir: string): string[] {
	const out: string[] = []
	for (const entry of readdirSync(dir)) {
		if (entry === "scripts" || entry === "node_modules") continue
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
		else if (/\.tsx?$/.test(entry)) out.push(full)
	}
	return out
}

// ---------------------------------------------------------------------------
// Synthetic self-tests (P0-4 core acceptance): inline fake source strings.
// ---------------------------------------------------------------------------

/** The four shapes the old rule missed / must now catch. */
const REQUIRED_VIOLATIONS = [
	{
		name: "join() literal inside writeFileSync args",
		source: `writeFileSync(join(dir, "cordis.patch.yml"), content)`,
		symbol: "writeFileSync",
	},
	{
		name: "patchPath helper + fs.promises.writeFile",
		source: `await fs.promises.writeFile(patchPath(profile), yaml)`,
		symbol: "writeFile",
	},
	{
		name: "Bun.write with path.join + literal",
		source: `Bun.write(path.join(dir, "cordis.patch.yml"), data)`,
		symbol: "Bun.write",
	},
	{
		name: "renameSync with patch literal in the second arg",
		source: `renameSync(tmp, join(dir, "cordis.patch.yml"))`,
		symbol: "renameSync",
	},
]

/** Additional real-world shapes that a hardened gate must also cover. */
const EXTRA_VIOLATIONS = [
	{
		name: "patch path held in a local var then written",
		source: `const p = join(dir, "cordis.patch.yml")\nwriteFileSync(p, text)`,
	},
	{
		name: "template string patch path",
		source: "writeFileSync(`${home}/cordis.patch.yml`, text)",
	},
	{
		name: "appendFileSync via patchFilePath helper",
		source: `appendFileSync(patchFilePath(profile), line)`,
	},
	{
		name: "createWriteStream on the patch path",
		source: `createWriteStream(join(dir, "cordis.patch.yml"))`,
	},
	{
		name: "copyFileSync via resolvePatchPath helper",
		source: `copyFileSync(src, resolvePatchPath(profile))`,
	},
	{
		name: "tracked this.#patchPath passed to writeFileSync",
		source: `this.#patchPath = join(home, "cordis.patch.yml")\nwriteFileSync(this.#patchPath, yaml)`,
	},
]

/**
 * P1-B: oldfox's 7 bypass samples. Each entry pins the canonical write symbol
 * so a fix cannot pass by merely "flagging something" in the file.
 */
const BYPASS_MATRIX: ReadonlyArray<{ name: string; source: string; symbol: string }> = [
	{
		name: "bypass 1: newline assignment",
		source: `const p = join(home,\n  "cordis.patch.yml")\nwriteFileSync(p, yaml)`,
		symbol: "writeFileSync",
	},
	{
		name: "bypass 2: aliased import",
		source: `import { writeFileSync as wf } from "fs"\nwf(join(dir,"cordis.patch.yml"), yaml)`,
		symbol: "writeFileSync",
	},
	{
		name: "bypass 3: extracted helper with tainted parameter",
		source: `function save(p,b){writeFileSync(p,b)}\nsave(join(dir,"cordis.patch.yml"), yaml)`,
		symbol: "writeFileSync",
	},
	{
		name: "bypass 4: imported PATCH-named path constant",
		source: `import { CORDIS_PATCH_PATH } from "./profile-constants.ts"\nwriteFileSync(CORDIS_PATCH_PATH, yaml)`,
		symbol: "writeFileSync",
	},
	{
		name: "bypass 5: string concatenation",
		source: `writeFileSync("cordis" + ".patch.yml", yaml)`,
		symbol: "writeFileSync",
	},
	{
		name: "bypass 6: Deno.writeTextFile",
		source: `Deno.writeTextFile(join(dir,"cordis.patch.yml"), yaml)`,
		symbol: "Deno.writeTextFile",
	},
	{
		name: "bypass 7: subprocess write via execSync",
		source: "execSync(`cat > ${join(dir,\"cordis.patch.yml\")}`)",
		symbol: "execSync",
	},
]

/** Cross-line helper + alias combinations requested in the P1-B spec. */
const ALIAS_HELPER_CASES: ReadonlyArray<{ name: string; source: string }> = [
	{
		name: "multiline helper call with aliased writer and multiline join",
		source: `import { writeFileSync as wf } from "fs"
function save(p: string, b: string) {
  wf(p, b)
}
save(
  join(dir,
    "cordis.patch.yml"),
  yaml,
)`,
	},
	{
		name: "destructured write alias from fs namespace",
		source: `const { writeFileSync: z } = fs\nz(join(dir,"cordis.patch.yml"), yaml)`,
	},
	{
		name: "aliased fs.promises namespace",
		source: `import { promises as p } from "fs"\np.writeFile(join(dir,"cordis.patch.yml"), yaml)`,
	},
	{
		name: "Bun.spawn command array carrying patch path",
		source: `Bun.spawn(["bash", "-c", \`cp x \${join(dir,"cordis.patch.yml")}\`])`,
	},
	{
		name: "Deno.writeFile direct",
		source: `Deno.writeFile(join(dir,"cordis.patch.yml"), data)`,
	},
	{
		name: "writer rebound to a plain identifier",
		source: `import { writeFileSync } from "fs"\nconst w = writeFileSync\nw(join(dir,"cordis.patch.yml"), yaml)`,
	},
	{
		name: "helper aliased on import",
		source: `import { patchPath as pp } from "./h.ts"\nwriteFileSync(pp(profile), yaml)`,
	},
	{
		name: "helper aliased on destructure",
		source: `const { patchPath: pp } = helpers\nwriteFileSync(pp(profile), yaml)`,
	},
]

/** Replace only the patch target; a correct detector must then go silent. */
function sanitizePatchTarget(source: string): string {
	return source
		.replaceAll("CORDIS_PATCH_PATH", "CONFIG_PATH")
		.replaceAll("cordis.patch.yml", "config.json")
		.replaceAll(".patch.yml", ".json")
}

/** Must NOT be reported: read-only, path-only, or writes to other files. */
const NON_VIOLATIONS = [
	{ name: "read-only readFileSync", source: `readFileSync(join(dir, "cordis.patch.yml"))` },
	{ name: "path construction only", source: `const p = patchPath(profile)` },
	{ name: "string concat only, no write", source: `const p = "cordis" + ".patch.yml"` },
	{ name: "write to config.json", source: `writeFileSync(join(dir, "config.json"), content)` },
	{
		name: "patch var exists but write targets another file",
		source: `const p = join(dir, "cordis.patch.yml")\nwriteFileSync(join(dir, "config.json"), "x")`,
	},
	{
		name: "patch path read for rendering, config written",
		source: `this.#patchPath = join(home, "cordis.patch.yml")\nreadFileSync(this.#patchPath)\nwriteFileSync(join(home, "config.json"), data)`,
	},
	{
		name: "benign subprocess command",
		source: `Bun.spawn(["bash", "-c", cmd], { cwd: opts.cwd })`,
	},
]

/** Every write face named in the P0-4 dimension-B spec. */
const WRITE_FACES = [
	"writeFileSync", "writeFile", "appendFileSync", "appendFile",
	"createWriteStream", "renameSync", "rename", "copyFileSync", "copyFile",
	"rmSync", "unlinkSync", "truncateSync", "outputFile",
] as const

describe("patch-writer-guard detector (P0-4 synthetic self-tests)", () => {
	test("dimension B covers every required write/mutate symbol", () => {
		for (const sym of WRITE_FACES) {
			const src = `${sym}(join(dir, "cordis.patch.yml"), data)`
			expect(detectPatchWriterViolations(src), sym).toHaveLength(1)
		}
		expect(detectPatchWriterViolations(`fs.promises.writeFile("cordis.patch.yml", data)`)).toHaveLength(1)
		expect(detectPatchWriterViolations(`Bun.write("cordis.patch.yml", data)`)).toHaveLength(1)
	})

	test("catches the four required violation shapes", () => {
		for (const c of REQUIRED_VIOLATIONS) {
			const found = detectPatchWriterViolations(c.source)
			expect(found, c.name).toHaveLength(1)
			expect(found[0]!.writeSymbol, c.name).toBe(c.symbol)
		}
	})

	test("catches additional real-world write shapes", () => {
		for (const c of EXTRA_VIOLATIONS) {
			expect(detectPatchWriterViolations(c.source), c.name).toHaveLength(1)
		}
	})

	test("does not flag read-only, path-only, or other-file writes", () => {
		for (const c of NON_VIOLATIONS) {
			expect(detectPatchWriterViolations(c.source), c.name).toEqual([])
		}
	})

	test("whitelist keeps its original semantics", () => {
		expect(isExemptPatchScanPath("dist/client/index.js").exempt).toBe(true)
		expect(isExemptPatchScanPath("test/fixtures/foo.ts").exempt).toBe(true)
		expect(isExemptPatchScanPath("scripts/provision-inproc-profile.mjs").exempt).toBe(true)
		expect(isExemptPatchScanPath("src/client/profile-constants.ts").exempt).toBe(true)
		expect(isExemptPatchScanPath("src/client/local-config-faces.ts").exempt).toBe(false)
		expect(hasReadonlyMarker("// @patch-readonly\n")).toBe(true)
		expect(hasReadonlyMarker("export const X = 1\n")).toBe(false)
	})
})

describe("patch-writer-guard detector (P1-B bypass matrix)", () => {
	test("catches all 7 oldfox bypasses with the correct canonical write symbol", () => {
		expect(BYPASS_MATRIX).toHaveLength(7)
		for (const c of BYPASS_MATRIX) {
			const found = detectPatchWriterViolations(c.source)
			expect(found, c.name).toHaveLength(1)
			expect(found[0]!.writeSymbol, c.name).toBe(c.symbol)
			expect(found[0]!.targetForm, c.name).toBeTruthy()
			expect(found[0]!.line, c.name).toBeGreaterThan(0)
		}
	})

	test("negative control: each bypass goes silent once its patch target is sanitized", () => {
		for (const c of BYPASS_MATRIX) {
			const sanitized = sanitizePatchTarget(c.source)
			expect(detectPatchWriterViolations(sanitized), `sanitized ${c.name}`).toEqual([])
		}
	})

	test("catches cross-line helper + alias combinations", () => {
		for (const c of ALIAS_HELPER_CASES) {
			expect(detectPatchWriterViolations(c.source), c.name).toHaveLength(1)
		}
	})

	test("violation record carries file/line/symbol/reason when file is supplied", () => {
		const found = detectPatchWriterViolations(
			`writeFileSync(join(dir, "cordis.patch.yml"), yaml)`,
			{ file: "src/client/rogue.ts" },
		)
		expect(found).toHaveLength(1)
		expect(found[0]!.file).toBe("src/client/rogue.ts")
		expect(found[0]!.line).toBe(1)
		expect(found[0]!.writeSymbol).toBe("writeFileSync")
		expect(found[0]!.targetForm).toContain("cordis.patch.yml")
	})
})

/**
 * P1-2: same-family bypasses found after the P1-B AST rewrite. Each entry pins
 * the canonical write symbol so the test cannot pass by flagging an arbitrary
 * call. All five were confirmed BYPASS against the pre-fix detector.
 */
const P12_BYPASS_MATRIX: ReadonlyArray<{ name: string; source: string; symbol: string }> = [
	{
		name: "P1-2 1: function declaration factory return-value taint",
		source: `export function patchPathFor(home: string) {
  return join(home, "cordis.patch.yml")
}
function save(home: string, y: string) {
  const p = patchPathFor(home)
  writeFileSync(p, y)
}`,
		symbol: "writeFileSync",
	},
	{
		name: "P1-2 2: arrow factory return-value taint",
		source: `const getPatch = (h: string) => join(h, "cordis.patch.yml")
writeFileSync(getPatch(home), y)`,
		symbol: "writeFileSync",
	},
	{
		name: "P1-2 3: tainted object property used as write target",
		source: `const paths = { patch: join(h, "cordis.patch.yml") }
writeFileSync(paths.patch, y)`,
		symbol: "writeFileSync",
	},
	{
		name: "P1-2 4: constant array join folded into patch filename",
		source: `const name = ["cordis", "patch", "yml"].join(".")
writeFileSync(join(dir, name), y)`,
		symbol: "writeFileSync",
	},
	{
		name: "P1-2 5: Bun destructuring alias",
		source: `const { write } = Bun
write(join(dir, "cordis.patch.yml"), y)`,
		symbol: "Bun.write",
	},
]

/** Sanitized controls plus shapes that must stay silent under the new rules. */
const P12_NON_VIOLATIONS: ReadonlyArray<{ name: string; source: string }> = [
	{
		name: "non-patch factory return is not a helper",
		source: `function configPath(h: string) { return join(h, "config.json") }
function save(h: string, y: string) {
  const p = configPath(h)
  writeFileSync(p, y)
}`,
	},
	{
		name: "non-patch object property is not tainted",
		source: `const paths = { config: join(h, "config.json") }
writeFileSync(paths.config, y)`,
	},
	{
		name: "non-patch array join is not folded into the patch filename",
		source: `const name = ["config", "file", "json"].join(".")
writeFileSync(join(dir, name), y)`,
	},
	{
		name: "Bun destructure writing a non-patch target",
		source: `const { write } = Bun
write(join(dir, "config.json"), y)`,
	},
]

describe("patch-writer-guard detector (P1-2 same-family bypasses)", () => {
	test("catches all 5 new bypasses with the correct canonical write symbol", () => {
		expect(P12_BYPASS_MATRIX).toHaveLength(5)
		for (const c of P12_BYPASS_MATRIX) {
			const found = detectPatchWriterViolations(c.source)
			expect(found, c.name).toHaveLength(1)
			expect(found[0]!.writeSymbol, c.name).toBe(c.symbol)
			expect(found[0]!.targetForm, c.name).toBeTruthy()
		}
	})

	test("negative controls: sanitized targets stay silent", () => {
		for (const c of P12_NON_VIOLATIONS) {
			expect(detectPatchWriterViolations(c.source), c.name).toEqual([])
		}
	})

	test("property variants: element access, renamed Bun destructure, direct Bun.write binding", () => {
		expect(detectPatchWriterViolations(`const paths = { patch: join(h, "cordis.patch.yml") }
writeFileSync(paths["patch"], y)`)).toHaveLength(1)
		expect(detectPatchWriterViolations(`const { write: w } = Bun
w(join(dir, "cordis.patch.yml"), y)`)[0]?.writeSymbol).toBe("Bun.write")
		expect(detectPatchWriterViolations(`const w = Bun.write
w(join(dir, "cordis.patch.yml"), y)`)[0]?.writeSymbol).toBe("Bun.write")
	})

	test("recursive fixpoint: helper calling another tainted-return helper is caught", () => {
		const src = `function inner(p: string) { return join(p, "cordis.patch.yml") }
function outer(h: string) { return inner(h) }
function save(h: string, y: string) {
  const p = outer(h)
  writeFileSync(p, y)
}`
		expect(detectPatchWriterViolations(src)).toHaveLength(1)
	})
})

describe("no-client-patch-writers (T7)", () => {
	test("no client source writes cordis.patch.yml", () => {
		const violations: string[] = []
		let scanned = 0
		for (const file of sourceFiles(SRC_DIR)) {
			const rel = `src/${file.slice(SRC_DIR.length + 1).replace(/\\/g, "/")}`
			if (isExemptPatchScanPath(rel).exempt) continue
			const text = readFileSync(file, "utf8")
			if (hasReadonlyMarker(text)) continue
			scanned++
			for (const v of detectPatchWriterViolations(text, { file: rel })) {
				violations.push(`${v.file ?? rel}:${v.line}: ${v.snippet} [${v.writeSymbol} <- ${v.targetForm}]`)
			}
		}
		// Anti-vacuity: a broken walker that scans zero files must fail the gate.
		expect(scanned).toBeGreaterThanOrEqual(30)
		expect(violations).toEqual([])
	})

	test("the two settings whitelist tables have identical namespace key sets", () => {
		expect(Object.keys(NS_VALUE_FIELDS).sort()).toEqual(Object.keys(SETTINGS_NS_VALUE_FIELDS).sort())
	})

	test("new write faces (approval policy + llm-pi-ai providers) are present in both tables", () => {
		for (const table of [NS_VALUE_FIELDS, SETTINGS_NS_VALUE_FIELDS]) {
			expect(table["dsh-approval-policy"]).toEqual(["windowSeconds", "origins", "defaultOutcome", "sessions"])
			expect(table["llm-pi-ai"]).toEqual(["providers"])
		}
	})
})
