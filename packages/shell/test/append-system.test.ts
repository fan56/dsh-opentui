// append-system contract tests against tmp DSH_HOME fixtures (the user's
// real ~/.dsh is NEVER touched — every path is under a fresh mkdtemp).
//
// Coverage: seeding (missing => template, existing => byte-identical zero
// write, atomic tmp cleanup), persona read, preset-row sync (append once,
// idempotent second pass, managed-block detection, collision refusal for
// both the preset id and the row id, missing-patch skip, other rows
// byte-preserved) and the managed block's shape (persona suffix !!js read,
// standard-composition copy — the additive face the agents-mount gate
// protects).
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
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
	profilePatchPath,
	readAppendSystem,
	syncAppendSystemPreset,
} from "../src/client/append-system.ts"

let home: string

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "dsh-append-system-"))
})

afterEach(() => {
	rmSync(home, { recursive: true, force: true })
})

/** A minimal user patch (two foreign rows in the shape the real files use). */
function seedPatch(body: string): string {
	mkdirSync(join(home, "profiles", "opentui"), { recursive: true })
	const path = profilePatchPath(home, "opentui")
	writeFileSync(path, body)
	return path
}

const USER_PATCH = `# my patch
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: false
- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  disabled: false
`

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

describe("syncAppendSystemPreset", () => {
	test("no patch file => skipped, nothing created", () => {
		mkdirSync(join(home, "profiles"), { recursive: true })
		const result = syncAppendSystemPreset(home, "opentui")
		expect(result.status).toBe("skipped")
		expect(existsSync(profilePatchPath(home, "opentui"))).toBe(false)
	})

	test("foreign patch => block appended at EOF, other rows byte-preserved", () => {
		const path = seedPatch(USER_PATCH)
		const result = syncAppendSystemPreset(home, "opentui")
		expect(result.status).toBe("added")
		const after = readFileSync(path, "utf8")
		expect(after.startsWith(USER_PATCH)).toBe(true)
		expect(after).toContain(APPEND_SYSTEM_MARKER)
		expect(after).toContain(`id: ${APPEND_SYSTEM_ROW_ID}`)
		expect(after).toContain(`id: ${APPEND_SYSTEM_PRESET_ID}`)
	})

	test("idempotent: second pass is present and changes nothing", () => {
		const path = seedPatch(USER_PATCH)
		syncAppendSystemPreset(home, "opentui")
		const once = readFileSync(path, "utf8")
		const result = syncAppendSystemPreset(home, "opentui")
		expect(result.status).toBe("present")
		expect(readFileSync(path, "utf8")).toBe(once)
	})

	test("managed block survives sibling rows appended after it", () => {
		const path = seedPatch(USER_PATCH)
		syncAppendSystemPreset(home, "opentui")
		// Another tool appends its own top-level row after our block.
		const withSibling = `${readFileSync(path, "utf8")}- id: tool-web\n  name: '@deepseek-ai/dsh-tool-web'\n`
		writeFileSync(path, withSibling)
		const result = syncAppendSystemPreset(home, "opentui")
		expect(result.status).toBe("present")
	})

	test("preset id declared elsewhere => collision, zero writes", () => {
		const hostile = `${USER_PATCH}- insert:\n    - id: preset-something\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: ${APPEND_SYSTEM_PRESET_ID}\n`
		const path = seedPatch(hostile)
		const before = readFileSync(path, "utf8")
		const result = syncAppendSystemPreset(home, "opentui")
		expect(result.status).toBe("collision")
		expect(readFileSync(path, "utf8")).toBe(before)
	})

	test("row id declared elsewhere => collision, zero writes", () => {
		const hostile = `${USER_PATCH}- id: ${APPEND_SYSTEM_ROW_ID}\n  name: '@deepseek-ai/dsh-something'\n`
		const path = seedPatch(hostile)
		const before = readFileSync(path, "utf8")
		const result = syncAppendSystemPreset(home, "opentui")
		expect(result.status).toBe("collision")
		expect(readFileSync(path, "utf8")).toBe(before)
	})

	test("ids inside our own managed block do not self-collide", () => {
		const path = seedPatch(USER_PATCH)
		syncAppendSystemPreset(home, "opentui")
		const result = syncAppendSystemPreset(home, "opentui")
		expect(result.status).toBe("present")
	})

	test("block present but ids ALSO declared outside it => collision, zero writes", () => {
		const path = seedPatch(USER_PATCH)
		syncAppendSystemPreset(home, "opentui")
		const once = readFileSync(path, "utf8")
		const polluted = `${once}\n- id: preset-foreign\n  name: '@deepseek-ai/dsh-agent-preset'\n  config:\n    id: ${APPEND_SYSTEM_PRESET_ID}\n`
		writeFileSync(path, polluted)
		const before = readFileSync(path, "utf8")
		const result = syncAppendSystemPreset(home, "opentui")
		expect(result.status).toBe("collision")
		expect(readFileSync(path, "utf8")).toBe(before)
	})

	test("write is atomic: no tmp leftovers in the profile dir", () => {
		const dir = join(home, "profiles", "opentui")
		mkdirSync(dir, { recursive: true })
		writeFileSync(profilePatchPath(home, "opentui"), USER_PATCH)
		syncAppendSystemPreset(home, "opentui")
		expect(readdirSync(dir).filter((name) => name.includes(".tmp"))).toEqual([])
	})
})

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
