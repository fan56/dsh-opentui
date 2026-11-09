/**
 * Agent corpus parity (tui-pi agents manager, phase 1): loose frontmatter
 * parsing (CRLF / one quote layer / deep default / name==file), in-place
 * write-back (null deletes, missing key before the fence, unknown fields,
 * comments and order preserved, CRLF kept, no-op writes nothing), and the
 * workspace-profile composition (frontmatter baseline (+) pinned profile).
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listAgentFiles, parseAgentMarkdown, setAgentField, updateAgentFrontmatter } from "../src/client/remote-local-fs.ts"
import {
	composeAgentValues,
	commitAgentModelEdit,
	agentEditTarget,
	listComposedAgents,
	readModelProfilesDoc,
	readNearestProfilePin,
} from "../src/client/remote-agent-profiles.ts"

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "dsh-agent-parity-"))
}

function writeAgent(home: string, file: string, text: string): string {
	mkdirSync(join(home, "agents"), { recursive: true })
	const path = join(home, "agents", file)
	writeFileSync(path, text)
	return path
}

describe("frontmatter parsing (tui-pi parity)", () => {
	test("CRLF, one quote layer, deep default and body trim", () => {
		const home = scratch()
		const path = writeAgent(
			home,
			"creator.md",
			'---\r\nname: creator\r\ndisplay_name: "Code Creator"\r\ndescription: \'quoted desc\'\r\nmodel: "p/m"\r\nthinking: high\r\n---\r\n\r\nBody line.\r\n',
		)
		const result = parseAgentMarkdown(readFileSync(path, "utf8"), path)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.agent).toMatchObject({
			name: "creator",
			displayName: "Code Creator",
			description: "quoted desc",
			model: "p/m",
			thinking: "high",
			deep: 1,
			body: "Body line.",
		})
	})

	test("deep 0 is valid; a non-integer deep and a name/file mismatch are broken", () => {
		const home = scratch()
		const zero = writeAgent(home, "zero.md", "---\nname: zero\ndeep: 0\n---\n")
		expect(parseAgentMarkdown(readFileSync(zero, "utf8"), zero)).toMatchObject({ ok: true, agent: { deep: 0 } })
		const bad = writeAgent(home, "bad.md", "---\nname: bad\ndeep: -1\n---\n")
		expect(parseAgentMarkdown(readFileSync(bad, "utf8"), bad).ok).toBe(false)
		const mismatch = writeAgent(home, "file.md", "---\nname: other\n---\n")
		expect(parseAgentMarkdown(readFileSync(mismatch, "utf8"), mismatch).ok).toBe(false)
	})

	test("valid rows sort by name; broken files are reported in-band", () => {
		const home = scratch()
		writeAgent(home, "b.md", "---\nname: b\n---\n")
		writeAgent(home, "a.md", "---\nname: a\n---\n")
		writeAgent(home, "c.md", "---\nname: c\n---\n")
		writeAgent(home, "broken.md", "no frontmatter\n")
		const rows = listAgentFiles(home)
		expect(rows.filter((row) => row.broken === undefined).map((row) => row.name)).toEqual(["a", "b", "c"])
		expect(rows.find((row) => row.broken !== undefined)?.broken).toContain("missing frontmatter")
	})
})

describe("frontmatter write-back (tui-pi parity)", () => {
	test("in-place replace keeps unknown fields, comments, order and CRLF", () => {
		const home = scratch()
		const path = writeAgent(
			home,
			"a.md",
			"---\r\nname: a\r\n# keep this comment\r\nmodel: old/m\r\ncustom_flag: yes\r\nthinking: low\r\n---\r\n\r\nbody\r\n",
		)
		expect(updateAgentFrontmatter(path, { model: "new/m" })).toBeUndefined()
		const text = readFileSync(path, "utf8")
		expect(text).toBe(
			"---\r\nname: a\r\n# keep this comment\r\nmodel: new/m\r\ncustom_flag: yes\r\nthinking: low\r\n---\r\n\r\nbody\r\n",
		)
	})

	test("null deletes the key; a missing key is inserted before the close fence", () => {
		const home = scratch()
		const path = writeAgent(home, "a.md", "---\nname: a\nmodel: old/m\n---\n\nbody\n")
		expect(updateAgentFrontmatter(path, { model: null, thinking: "high" })).toBeUndefined()
		expect(readFileSync(path, "utf8")).toBe("---\nname: a\nthinking: high\n---\n\nbody\n")
	})

	test("no change writes nothing; body-only files are refused", () => {
		const home = scratch()
		const path = writeAgent(home, "a.md", "---\nname: a\nmodel: m\n---\n\nbody\n")
		const before = readFileSync(path, "utf8")
		expect(updateAgentFrontmatter(path, { model: "m" })).toBeUndefined()
		expect(readFileSync(path, "utf8")).toBe(before)
		const bodyOnly = writeAgent(home, "b.md", "just a body\n")
		expect(updateAgentFrontmatter(bodyOnly, { model: "m" })).toContain("missing frontmatter")
		expect(readFileSync(bodyOnly, "utf8")).toBe("just a body\n")
	})

	test("setAgentField validates deep and resolves errors in-band", () => {
		const home = scratch()
		writeAgent(home, "a.md", "---\nname: a\n---\n\nbody\n")
		expect(setAgentField("a", "deep", "on", home)).toContain("expected a non-negative integer")
		expect(setAgentField("a", "deep", "2", home)).toBeUndefined()
		expect(readFileSync(join(home, "agents", "a.md"), "utf8")).toContain("deep: 2")
		expect(setAgentField("missing", "model", "p/m", home)).toContain("cannot read")
	})
})

describe("workspace profile composition (tui-pi parity)", () => {
	function seedProfileHome(): { home: string; workspace: string } {
		const home = scratch()
		const workspace = scratch()
		writeFileSync(
			join(home, "model-profiles.json"),
			JSON.stringify({
				version: 1,
				current: "personal",
				profiles: [
					{ name: "work", agents: { reviewer: { model: "prof/x", thinking: "high" } } },
					{ name: "personal", agents: {} },
				],
			}),
		)
		writeFileSync(join(workspace, ".dsh-profile"), "# workspace pin\nwork\n")
		writeAgent(home, "reviewer.md", "---\nname: reviewer\nmodel: base/m\nthinking: low\n---\n\nBody\n")
		return { home, workspace }
	}

	test("nearest pin walks up; absent/invalid pins resolve to frontmatter", () => {
		const { home, workspace } = seedProfileHome()
		const nested = join(workspace, "a", "b")
		mkdirSync(nested, { recursive: true })
		expect(readNearestProfilePin(nested)).toBe("work")
		expect(readModelProfilesDoc(home)?.current).toBe("personal")
		expect(agentEditTarget(home, workspace)).toEqual({ kind: "profile", name: "work" })
		expect(agentEditTarget(home, scratch())).toEqual({ kind: "frontmatter" })
	})

	test("effective = baseline (+) pinned override; unknown thinking falls back", () => {
		const { home, workspace } = seedProfileHome()
		const doc = readModelProfilesDoc(home)
		expect(composeAgentValues("reviewer", { model: "base/m", thinking: "low" }, doc, workspace)).toEqual({
			model: "prof/x",
			thinking: "high",
			pin: "work",
		})
		expect(composeAgentValues("other", { model: "base/m", thinking: "low" }, doc, workspace)).toEqual({
			model: "base/m",
			thinking: "low",
			pin: "work",
		})
		expect(composeAgentValues("reviewer", { model: "base/m", thinking: "not-a-level" }, doc, workspace)).toEqual({
			model: "prof/x",
			thinking: "high",
			pin: "work",
		})
		// no pin: the baseline is the value (current is NOT reused)
		expect(composeAgentValues("reviewer", { model: "base/m", thinking: "low" }, doc, scratch())).toEqual({
			model: "base/m",
			thinking: "low",
		})
	})

	test("listComposedAgents carries the composed row + pin", () => {
		const { home, workspace } = seedProfileHome()
		const rows = listComposedAgents(home, workspace)
		expect(rows[0]).toMatchObject({ name: "reviewer", model: "prof/x", thinking: "high", pin: "work", deep: 1 })
	})

	test("pin commit writes profiles[].agents and leaves every other key intact", () => {
		const { home, workspace } = seedProfileHome()
		const agentFile = join(home, "agents", "reviewer.md")
		const frontmatter = readFileSync(agentFile, "utf8")
		const result = commitAgentModelEdit(home, workspace, agentFile, "reviewer", { model: "next/m", thinking: null })
		expect(result.target).toEqual({ kind: "profile", name: "work" })
		const doc = JSON.parse(readFileSync(join(home, "model-profiles.json"), "utf8"))
		expect(doc.current).toBe("personal")
		expect(doc.profiles[1]).toEqual({ name: "personal", agents: {} })
		expect(doc.profiles[0].agents.reviewer).toEqual({ model: "next/m" })
		expect(readFileSync(agentFile, "utf8")).toBe(frontmatter)
	})

	test("a pin to a seeded default resolves even with no store on disk", () => {
		const home = scratch()
		const workspace = scratch()
		writeFileSync(join(workspace, ".dsh-profile"), "work\n")
		writeAgent(home, "a.md", "---\nname: a\n---\n\nbody\n")
		expect(agentEditTarget(home, workspace)).toEqual({ kind: "profile", name: "work" })
		const result = commitAgentModelEdit(home, workspace, join(home, "agents", "a.md"), "a", { model: "p/m" })
		expect(result.target).toEqual({ kind: "profile", name: "work" })
		const doc = JSON.parse(readFileSync(join(home, "model-profiles.json"), "utf8"))
		expect(doc.profiles.map((profile: { name: string }) => profile.name)).toEqual(["work", "personal", "other"])
		expect(doc.profiles[0].agents.a).toEqual({ model: "p/m" })
	})

	test("no pin commits to the frontmatter", () => {
		const { home } = seedProfileHome()
		const agentFile = join(home, "agents", "reviewer.md")
		const result = commitAgentModelEdit(home, scratch(), agentFile, "reviewer", { thinking: "max" })
		expect(result.target).toEqual({ kind: "frontmatter" })
		expect(readFileSync(agentFile, "utf8")).toContain("thinking: max")
	})
})

describe("partial frontmatter payload (B1)", () => {
	const BASELINE = "---\nname: reviewer\nmodel: base/m\nthinking: low\ndeep: 2\n---\n\nBody\n"

	function unpinnedAgent(text = BASELINE): { home: string; workspace: string; file: string } {
		const home = scratch()
		const workspace = scratch()
		const file = writeAgent(home, "reviewer.md", text)
		return { home, workspace, file }
	}

	test("a thinking-only edit leaves the model line byte-for-byte intact", () => {
		const { home, workspace, file } = unpinnedAgent()
		commitAgentModelEdit(home, workspace, file, "reviewer", { thinking: "high" })
		expect(readFileSync(file, "utf8")).toBe(
			"---\nname: reviewer\nmodel: base/m\nthinking: high\ndeep: 2\n---\n\nBody\n",
		)
	})

	test("only-thinking keeps the model; only-model keeps the thinking", () => {
		const thinkingOnly = unpinnedAgent()
		commitAgentModelEdit(thinkingOnly.home, thinkingOnly.workspace, thinkingOnly.file, "reviewer", { thinking: "max" })
		expect(readFileSync(thinkingOnly.file, "utf8")).toContain("model: base/m")

		const modelOnly = unpinnedAgent()
		commitAgentModelEdit(modelOnly.home, modelOnly.workspace, modelOnly.file, "reviewer", { model: "next/m" })
		expect(readFileSync(modelOnly.file, "utf8")).toContain("thinking: low")
		expect(readFileSync(modelOnly.file, "utf8")).toContain("model: next/m")
	})

	test("the two-call commitModel sequence keeps both fields and their order", () => {
		const { home, workspace, file } = unpinnedAgent(
			"---\nname: reviewer\nthinking: low\nmodel: old/m\ncustom: keep\n---\n\nBody\n",
		)
		// agents-panel commitModel: set("model") then set("thinking") (no pin).
		commitAgentModelEdit(home, workspace, file, "reviewer", { model: "new/m" })
		commitAgentModelEdit(home, workspace, file, "reviewer", { thinking: "high" })
		expect(readFileSync(file, "utf8")).toBe(
			"---\nname: reviewer\nthinking: high\nmodel: new/m\ncustom: keep\n---\n\nBody\n",
		)
	})

	test("picking the provider default (thinking:null) deletes only the thinking line", () => {
		const { home, workspace, file } = unpinnedAgent()
		commitAgentModelEdit(home, workspace, file, "reviewer", { thinking: null })
		expect(readFileSync(file, "utf8")).toBe(
			"---\nname: reviewer\nmodel: base/m\ndeep: 2\n---\n\nBody\n",
		)
	})
})
