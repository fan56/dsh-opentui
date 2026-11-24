/**
 * T7 gate (06 R6 / §6.1 / oldfox-3 T7): the profile patch is a HOST-OWNED
 * runtime file. Client source (`packages/shell/src`, scripts/ excluded) must
 * never WRITE it, and the two settings whitelist tables must stay in sync.
 *
 * This is a code-invariant gate, not a security boundary: it fails the build
 * if a future writer is reintroduced or only one whitelist table is widened.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

import { SETTINGS_NS_VALUE_FIELDS } from "../src/client/bridge-settings-route.ts"
import { NS_VALUE_FIELDS } from "../src/client/local-config-faces.ts"

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

describe("no-client-patch-writers (T7)", () => {
	test("no client source writes cordis.patch.yml", () => {
		const violations: string[] = []
		for (const file of sourceFiles(SRC_DIR)) {
			const text = readFileSync(file, "utf8")
			if (!text.includes("cordis.patch.yml") && !text.includes("profilePatchPath")) continue

			// Identifiers assigned a path built from the patch filename.
			const patchVars = new Set<string>()
			for (const m of text.matchAll(/(?:this\.)?(#[A-Za-z_]\w*|[A-Za-z_]\w*)\s*=\s*[^;\n]*cordis\.patch\.yml/g)) {
				patchVars.add(m[1]!)
			}

			// Any write call whose arguments mention a patch path / patch-path helper.
			for (const m of text.matchAll(/\b(writeFileSync|writeFile|renameSync|atomicWrite|writeAtomically|appendFileSync|truncateSync)\s*\(([^()]*)\)/g)) {
				const args = m[2] ?? ""
				const touchesPatch =
					args.includes("cordis.patch.yml") ||
					args.includes("profilePatchPath") ||
					[...patchVars].some((v) => args.includes(v))
				if (touchesPatch) violations.push(`${file.replace(SRC_DIR, "src")}: ${m[0].slice(0, 120)}`)
			}
		}
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
