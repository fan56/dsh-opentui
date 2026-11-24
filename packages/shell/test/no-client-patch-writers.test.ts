/**
 * T7 gate (06 R6 / §6.1 / oldfox-3 T7): the profile patch is a HOST-OWNED
 * runtime file. Client source (`packages/shell/src`, scripts/ excluded) must
 * never WRITE it, and the two settings whitelist tables must stay in sync.
 *
 * This is a code-invariant gate, not a security boundary: it fails the build
 * if a future writer is reintroduced or only one whitelist table is widened.
 *
 * P0-4 hardening: the detector is a pure function
 * (`./lib/patch-writer-guard.ts`) so it can be fed inline fake source. The old
 * regex only matched `writeFileSync(...)` when its arguments had no nested
 * parentheses, so `writeFileSync(join(dir, "cordis.patch.yml"), content)` slipped
 * through. The new rule requires dimension A (patch target) and dimension B
 * (write capability) to co-occur inside one write call.
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

/** Must NOT be reported: read-only, path-only, or writes to other files. */
const NON_VIOLATIONS = [
	{ name: "read-only readFileSync", source: `readFileSync(join(dir, "cordis.patch.yml"))` },
	{ name: "path construction only", source: `const p = patchPath(profile)` },
	{ name: "write to config.json", source: `writeFileSync(join(dir, "config.json"), content)` },
	{
		name: "patch var exists but write targets another file",
		source: `const p = join(dir, "cordis.patch.yml")\nwriteFileSync(join(dir, "config.json"), "x")`,
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
			for (const v of detectPatchWriterViolations(text)) {
				violations.push(`${rel}:${v.line}: ${v.snippet}`)
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
