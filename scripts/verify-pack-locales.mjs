/**
 * Packaging contract for the published client bundle: after
 * scripts/build-client.mjs runs, packages/shell/dist/locales must exist and
 * carry every locale table from packages/i18n/locales (at minimum en.json and
 * zh-CN.json), byte-identical to the source. registry.ts's bundledLocalesDir()
 * resolves dist/locales from the bundle at runtime — if the copy is missing or
 * stale the installed CLI silently degrades to en.
 *
 * Wired into packages/shell's prepack (after build-client.mjs), so every
 * `npm pack`/publish re-checks the contract against a fresh build.
 *
 *   bun scripts/verify-pack-locales.mjs
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const srcDir = join(repoRoot, "packages", "i18n", "locales")
const outDir = join(repoRoot, "packages", "shell", "dist", "locales")

const REQUIRED = ["en.json", "zh-CN.json"]
const failures = []

if (!existsSync(outDir)) {
	failures.push(`missing ${outDir} — run scripts/build-client.mjs first`)
} else {
	for (const file of REQUIRED) {
		const src = join(srcDir, file)
		const out = join(outDir, file)
		if (!existsSync(src)) {
			failures.push(`source packages/i18n/locales/${file} is missing — contract needs updating`)
		} else if (!existsSync(out)) {
			failures.push(`dist/locales is missing ${file}`)
		} else if (!readFileSync(out).equals(readFileSync(src))) {
			failures.push(`dist/locales/${file} differs from packages/i18n/locales/${file} — stale copy`)
		}
	}
	const stale = readdirSync(outDir).filter((f) => f.endsWith(".json") && !existsSync(join(srcDir, f)))
	if (stale.length > 0) failures.push(`dist/locales has files not in the source: ${stale.join(", ")}`)
}

if (failures.length > 0) {
	console.error("[verify-pack-locales] FAILED:\n  " + failures.join("\n  "))
	process.exit(1)
}
console.log(`[verify-pack-locales] dist/locales matches packages/i18n/locales (${readdirSync(outDir).join(", ")})`)
