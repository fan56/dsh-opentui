// solid-js-pin contract tests against tmp profile dirs (no real home-dir
// writes). Coverage: ensureSolidPatch's patchedDependencies merge (fresh
// workspace created, stale other-version solid-js key stripped, unrelated
// package's patch key preserved, the live 0.4.3→0.5.0 duplicate-block
// backup shape collapsed to ONE merged block, append when no block exists,
// byte idempotence) and pinSolidJsDependency (the installer's stale direct
// solid-js dep replaced, absent left absent, current kept, siblings kept),
// plus an installer wiring source guard.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
	SOLID_JS_VERSION,
	ensureSolidPatch,
	pinSolidJsDependency,
} from "../scripts/solid-js-pin.mjs"

const WS_PATH = "pnpm-workspace.yaml"
const CURRENT_KEY = `solid-js@${SOLID_JS_VERSION}:`
const CURRENT_ENTRY = `  ${CURRENT_KEY} patches/solid-js@${SOLID_JS_VERSION}.patch`

let profile: string
const wsPath = () => join(profile, WS_PATH)
const wsText = () => readFileSync(wsPath(), "utf8")
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length

beforeEach(() => {
	profile = mkdtempSync(join(tmpdir(), "dsh-solid-pin-"))
})

afterEach(() => {
	rmSync(profile, { recursive: true, force: true })
})

describe("ensureSolidPatch patchedDependencies merge", () => {
	test("fresh profile: workspace created with the default layout and one patch block", () => {
		const { patchWrote, workspaceNote } = ensureSolidPatch(profile)
		expect(patchWrote).toBe(true)
		expect(workspaceNote).toBe("workspace created")
		const text = wsText()
		expect(text).toContain("packages:")
		expect(text).toContain("nodeLinker: hoisted")
		expect(count(text, /^patchedDependencies:/gm)).toBe(1)
		expect(text).toContain(CURRENT_ENTRY)
	})

	test("stale 1.9.12 block: merged into ONE block carrying the current key only", () => {
		writeFileSync(
			wsPath(),
			[
				"packages:",
				"  - .",
				"nodeLinker: hoisted",
				"autoInstallPeers: false",
				"patchedDependencies:",
				"  solid-js@1.9.12: patches/solid-js@1.9.12.patch",
				"",
			].join("\n"),
		)
		const { workspaceNote } = ensureSolidPatch(profile)
		const text = wsText()
		expect(count(text, /^patchedDependencies:/gm)).toBe(1)
		expect(count(text, /^[ \t]+solid-js@/gm)).toBe(1)
		expect(text).not.toContain("1.9.12")
		expect(text).toContain(CURRENT_ENTRY)
		expect(text).toContain("nodeLinker: hoisted")
		expect(workspaceNote).toContain("stale solid-js patch keys removed")
	})

	test("unrelated package's patch key preserved alongside the solid-js key", () => {
		writeFileSync(
			wsPath(),
			[
				"packages:",
				"  - .",
				"nodeLinker: hoisted",
				"patchedDependencies:",
				"  other-pkg@2.0.0: patches/other-pkg@2.0.0.patch",
				"",
			].join("\n"),
		)
		ensureSolidPatch(profile)
		const text = wsText()
		expect(count(text, /^patchedDependencies:/gm)).toBe(1)
		expect(text).toContain("  other-pkg@2.0.0: patches/other-pkg@2.0.0.patch")
		expect(count(text, /^[ \t]+solid-js@/gm)).toBe(1)
		expect(text).toContain(CURRENT_ENTRY)
	})

	test("live 0.4.3→0.5.0 backup shape (pnpm-workspace.yaml.bak-1793930433-dupfix): duplicate blocks collapse to one merged block, idempotent re-run", () => {
		// The exact pre-state from the migration: the stale 1.9.12 block
		// survived the old stripStale (its negative lookahead keeps any
		// well-formed versioned key) and ensureSolidPatch APPENDED a second
		// header — pnpm fails the whole install with ERR duplicate mapping
		// key. The merge must produce exactly one block and one key.
		writeFileSync(
			wsPath(),
			[
				"packages:",
				"  - .",
				"nodeLinker: hoisted",
				"autoInstallPeers: false",
				"patchedDependencies:",
				"  solid-js@1.9.12: patches/solid-js@1.9.12.patch",
				"patchedDependencies:",
				CURRENT_ENTRY,
				"",
			].join("\n"),
		)
		const { workspaceNote } = ensureSolidPatch(profile)
		const text = wsText()
		expect(count(text, /^patchedDependencies:/gm)).toBe(1)
		expect(count(text, /^[ \t]+solid-js@/gm)).toBe(1)
		expect(text).toContain(CURRENT_ENTRY)
		expect(text).toContain("nodeLinker: hoisted")
		expect(workspaceNote).toContain("duplicate patchedDependencies blocks merged")
		ensureSolidPatch(profile)
		expect(wsText()).toBe(text)
	})

	test("workspace without any patchedDependencies: one block appended", () => {
		writeFileSync(wsPath(), "packages:\n  - .\nnodeLinker: hoisted\n")
		const { workspaceNote } = ensureSolidPatch(profile)
		const text = wsText()
		expect(count(text, /^patchedDependencies:/gm)).toBe(1)
		expect(text).toContain(CURRENT_ENTRY)
		expect(workspaceNote).toContain("patch registered in existing workspace")
	})
})

describe("pinSolidJsDependency (installer dep-unfold)", () => {
	test("stale direct dep 1.9.12 replaced with the pinned version", () => {
		const deps = pinSolidJsDependency({ "solid-js": "1.9.12", ws: "^8.22.1" })
		expect(deps["solid-js"]).toBe(SOLID_JS_VERSION)
		expect(deps.ws).toBe("^8.22.1")
	})

	test("absent direct dep stays absent (patch key alone owns the pin)", () => {
		const deps = pinSolidJsDependency({ ws: "^8.22.1" })
		expect("solid-js" in deps).toBe(false)
	})

	test("already-current dep kept untouched", () => {
		const deps = pinSolidJsDependency({ "solid-js": SOLID_JS_VERSION })
		expect(deps["solid-js"]).toBe(SOLID_JS_VERSION)
	})
})

test("installer source guard: the dep-unfold runs every profile package.json through pinSolidJsDependency", () => {
	const installer = readFileSync(
		fileURLToPath(new URL("../scripts/install-profile.mjs", import.meta.url)),
		"utf8",
	)
	expect(installer).toContain("pinSolidJsDependency({ ...(pkg.dependencies || {})")
})
