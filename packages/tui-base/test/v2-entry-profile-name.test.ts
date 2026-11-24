/**
 * Machine gate for the v2 splash root. `profileName` was once a bare
 * `profile` identifier that existed nowhere in v2-entry.tsx: the file's
 * `@ts-nocheck` let it compile, and the installed client died at first paint
 * with `ReferenceError: profile is not defined` (exit 2, blank screen).
 *
 * Removing `@ts-nocheck` is not an option here — it surfaces 24 legacy
 * errors in this file — so this gate pins the one expression that must
 * resolve at runtime, its single-source import, and the module's import
 * smoke. The entry's own typecheck chain is guarded too.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { DEFAULT_PROFILE } from "../../shell/src/client/profile-constants.ts"

const entryFile = new URL("../examples/v2-entry.tsx", import.meta.url)
const entry = readFileSync(entryFile, "utf8")
const entryConfig = readFileSync(new URL("../tsconfig.entry.json", import.meta.url), "utf8")

const profileNameLine = entry.split(/\r?\n/).find((line) => /^\s*profileName:/.test(line)) ?? ""
const profileNameExpr = profileNameLine.match(/^\s*profileName:\s*([^,\n]+)/)?.[1]?.trim() ?? ""
const loadShellBody = entry.match(/async function loadShell\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ""
const bootBindings = entry.match(/const \{([^}]*)\} = await loadShell\(\)/)?.[1] ?? ""
const boundNames = bootBindings.split(",").map((name) => name.trim()).filter(Boolean)

describe("v2-entry splash profile root (installed-client exit-2 gate)", () => {
	test("profileName is a declared binding from shell's single-source DEFAULT_PROFILE", () => {
		expect(profileNameExpr).toBe("profileConstants.DEFAULT_PROFILE")
		expect(boundNames).toContain("profileConstants")
		expect(loadShellBody).toContain('import(SHELL + "profile-constants.ts")')
		// The active host profile must never be re-declared in this file.
		expect(entry).not.toContain(DEFAULT_PROFILE)
	})

	test("typecheck:entry still roots the v2 entry", () => {
		expect(entryConfig).toMatch(/"examples\/v2-entry\.tsx"/)
	})

	test("importing the entry module does not throw", async () => {
		const mod = await import("../examples/v2-entry.tsx")
		expect(typeof mod.bootClientV2).toBe("function")
	})
})
