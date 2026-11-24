// append-system contract tests against tmp DSH_HOME fixtures (the user's
// real ~/.dsh is NEVER touched — every path is under a fresh mkdtemp).
//
// T7: the patch-row sync is retired (host owns the patch). Coverage left here:
// APPEND_SYSTEM.md seeding (missing => template, existing => byte-identical
// zero write, atomic tmp cleanup), persona read, and the legacy preset-id
// constants used for legacy-resume detection.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
	APPEND_SYSTEM_MARKER,
	APPEND_SYSTEM_TEMPLATE,
	APPEND_SYSTEM_PRESET_ID,
	APPEND_SYSTEM_ROW_ID,
	APPEND_SYSTEM_SUFFIX_EXPR,
	appendSystemPath,
	appendSystemPresetBlock,
	defaultDshHome,
	ensureAppendSystemFile,
	readAppendSystem,
} from "../src/client/append-system.ts"

let home: string

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "dsh-append-system-"))
})

afterEach(() => {
	rmSync(home, { recursive: true, force: true })
})

describe("ensureAppendSystemFile", () => {
	test("missing file => seeded with the template, byte-exact", () => {
		const path = appendSystemPath(home)
		expect(ensureAppendSystemFile(path)).toBe("seeded")
		expect(readFileSync(path, "utf8")).toBe(APPEND_SYSTEM_TEMPLATE)
	})

	test("existing file (user-owned) => kept, byte-identical, zero writes", () => {
		const path = appendSystemPath(home)
		writeFileSync(path, "my own 2300 bytes of identity\n")
		const before = readFileSync(path, "utf8")
		expect(ensureAppendSystemFile(path)).toBe("kept")
		expect(readFileSync(path, "utf8")).toBe(before)
	})

	test("empty-but-existing file is still user-owned (kept)", () => {
		const path = appendSystemPath(home)
		writeFileSync(path, "")
		expect(ensureAppendSystemFile(path)).toBe("kept")
		expect(readFileSync(path, "utf8")).toBe("")
	})

	test("write is atomic: no tmp leftovers in the directory", () => {
		const path = appendSystemPath(home)
		ensureAppendSystemFile(path)
		const siblings = readdirSync(home).filter((name) => name.includes(".tmp"))
		expect(siblings).toEqual([])
	})

	test("template carries the subagent vocabulary rule and no todo-lifecycle section", () => {
		expect(APPEND_SYSTEM_TEMPLATE).toContain("registered subagents only")
		expect(APPEND_SYSTEM_TEMPLATE.toLowerCase()).not.toContain("todo")
	})
})

describe("readAppendSystem", () => {
	test("missing file => empty string", () => {
		expect(readAppendSystem(appendSystemPath(home))).toBe("")
	})

	test("present file => full content", () => {
		const path = appendSystemPath(home)
		writeFileSync(path, "ORCHESTRATOR RULES\n")
		expect(readAppendSystem(path)).toBe("ORCHESTRATOR RULES\n")
	})
})

// T7: patch-writer tests retired (host owns the profile patch).

describe("appendSystemPresetBlock shape", () => {
	const block = appendSystemPresetBlock()

	test("declares the preset row with the persona plugin", () => {
		expect(block).toContain(`- id: ${APPEND_SYSTEM_ROW_ID}`)
		expect(block).toContain("name: '@deepseek-ai/dsh-agent-preset'")
		expect(block).toContain(`id: ${APPEND_SYSTEM_PRESET_ID}`)
		expect(block).toContain("name: '@deepseek-ai/dsh-persona'")
	})

	test("persona suffix is the guarded !!js read of $DSH_HOME/APPEND_SYSTEM.md", () => {
		expect(block).toContain(`suffix: !!js "${APPEND_SYSTEM_SUFFIX_EXPR}"`)
		expect(APPEND_SYSTEM_SUFFIX_EXPR).toContain("APPEND_SYSTEM.md")
		expect(APPEND_SYSTEM_SUFFIX_EXPR).toContain("DSH_HOME")
		expect(APPEND_SYSTEM_SUFFIX_EXPR).toContain("65536") // 64KiB cap (agent-instructions maxBytes magnitude)
		expect(APPEND_SYSTEM_SUFFIX_EXPR).toContain("String.fromCharCode(10)") // newline joiner without any YAML-escape hazard
		expect(APPEND_SYSTEM_SUFFIX_EXPR).toContain("truncated at 64KiB") // felt marker on truncation
		expect(APPEND_SYSTEM_SUFFIX_EXPR).not.toContain('"') // survives the YAML double-quoted scalar
		expect(APPEND_SYSTEM_SUFFIX_EXPR).not.toContain("\\") // no escape-sequence surprises
	})

	test("persona prefix matches the shipped standard preset verbatim (identity not shadowed away)", () => {
		expect(block).toContain("prefix: You are a coding agent powered by the {{model}} model.")
	})

	test("carries the full standard composition (the additive face): tools, skills, plan, compaction, delegation", () => {
		for (const row of [
			"id: tool-bash",
			"id: tool-fs",
			"id: tool-todo",
			"id: tool-web",
			"id: tool-ask-user",
			"id: skill-filesystem",
			"id: tool-skill",
			"id: plan-mode",
			"id: compaction-basic",
			"id: tool-subagent",
			"id: tool-subagent-fork",
			"id: time-context",
			"id: agent-instructions",
			"id: tool-result-pruner",
			"id: present",
		]) {
			expect(block).toContain(row)
		}
	})

	test("single top-level list entry (block ends before the next `- ` row)", () => {
		const topLevel = block.split("\n").filter((line) => /^- /.test(line))
		expect(topLevel).toEqual(["- insert:"])
	})
})

describe("defaultDshHome", () => {
	test("honours DSH_HOME", () => {
		const previous = process.env.DSH_HOME
		process.env.DSH_HOME = home
		try {
			expect(defaultDshHome()).toBe(home)
		} finally {
			if (previous === undefined) delete process.env.DSH_HOME
			else process.env.DSH_HOME = previous
		}
	})
})
