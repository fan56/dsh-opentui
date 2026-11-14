/**
 * Gap C3 (/skills manager): the pure filesystem semantics of
 * skills-manage.ts (tui-pi skills-manager parity — symlink safety, batch
 * summary, scan, view helpers) exercised against REAL temp dirs, plus the
 * /skills command wiring (degrade notice + panel hook) and the
 * slash-deps hook carriage (the /agents incident law).
 */
import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from "node:fs/promises"
import { existsSync, lstatSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	applyOneSkillChange,
	ensureCuratedDir,
	filterSkillRows,
	installSkillSymlink,
	scanAvailableSkills,
	skillApplyShortReason,
	skillApplySummary,
	skillStateText,
	skillSymlinkPaths,
	type SkillApplyResult,
} from "../src/routes/session/skills-manage"
import { coreCommands, type SlashCommandContext } from "../src/routes/session/commands"
import { ENTRY_SLASH_HOOKS, buildSlashDeps } from "../src/routes/session/slash-deps"

async function makeRoots(): Promise<{ source: string; curated: string }> {
	const base = await mkdtemp(join(tmpdir(), "dsh-skills-test-"))
	const source = join(base, "agents-skills")
	const curated = join(base, "dsh-skills")
	await mkdir(source, { recursive: true })
	await mkdir(curated, { recursive: true })
	return { source, curated }
}

/** A flat .md skill and a directory bundle in the source root. */
async function seedSkills(source: string): Promise<void> {
	await writeFile(
		join(source, "flat-skill.md"),
		"---\nname: flat-skill\ndescription: A flat skill for tests\n---\nbody\n",
	)
	await mkdir(join(source, "bundle-skill"))
	await writeFile(
		join(source, "bundle-skill", "SKILL.md"),
		"---\nname: bundle-skill\ndescription: A bundle skill\n---\nbody\n",
	)
}

describe("skills-manage: symlink install safety (tui-pi parity)", () => {
	test("install creates the symlink; reinstalling is an idempotent no-op", async () => {
		const { source, curated } = await makeRoots()
		await seedSkills(source)
		const paths = skillSymlinkPaths(source, curated, "flat-skill")!
		await installSkillSymlink(paths.src, paths.dest)
		expect(lstatSync(paths.dest).isSymbolicLink()).toBe(true)
		// Same source again → success, not EEXIST.
		await expect(installSkillSymlink(paths.src, paths.dest)).resolves.toBeUndefined()
	})

	test("install refuses to overwrite a physical file at the destination", async () => {
		const { source, curated } = await makeRoots()
		await seedSkills(source)
		const dest = join(curated, "flat-skill.md")
		await writeFile(dest, "user content")
		await expect(installSkillSymlink(join(source, "flat-skill.md"), dest)).rejects.toThrow(
			/not a symlink/,
		)
		// The user content is untouched.
		expect(await readFile(dest, "utf8")).toBe("user content")
	})

	test("install refuses a link pointing at a different source", async () => {
		const { source, curated } = await makeRoots()
		await seedSkills(source)
		const other = join(source, "other.md")
		await writeFile(other, "---\nname: other\n---\n")
		const dest = join(curated, "flat-skill.md")
		await symlink(other, dest)
		await expect(installSkillSymlink(join(source, "flat-skill.md"), dest)).rejects.toThrow(
			/different source/,
		)
	})

	test("install repairs a dangling symlink", async () => {
		const { source, curated } = await makeRoots()
		await seedSkills(source)
		const gone = join(source, "gone.md")
		const dest = join(curated, "flat-skill.md")
		await writeFile(gone, "x")
		await symlink(gone, dest)
		await rm(gone)
		await installSkillSymlink(join(source, "flat-skill.md"), dest)
		expect(lstatSync(dest).isSymbolicLink()).toBe(true)
		expect(existsSync(dest)).toBe(true)
	})

	test("uninstall removes only the symlink; a physical file is refused", async () => {
		const { source, curated } = await makeRoots()
		await seedSkills(source)
		const paths = skillSymlinkPaths(source, curated, "flat-skill")!
		await installSkillSymlink(paths.src, paths.dest)
		expect(await applyOneSkillChange("flat-skill", false, source, curated)).toBeUndefined()
		expect(existsSync(paths.dest)).toBe(false)

		await writeFile(paths.dest, "user content")
		const refused = await applyOneSkillChange("flat-skill", false, source, curated)
		expect(refused).toContain("not a symlink")
		expect(existsSync(paths.dest)).toBe(true)
	})

	test("install of a name missing from the source root reports a readable cause", async () => {
		const { source, curated } = await makeRoots()
		const error = await applyOneSkillChange("nope", true, source, curated)
		expect(error).toContain("skill not found")
	})

	test("directory bundles install and uninstall as one link", async () => {
		const { source, curated } = await makeRoots()
		await seedSkills(source)
		expect(await applyOneSkillChange("bundle-skill", true, source, curated)).toBeUndefined()
		const dest = join(curated, "bundle-skill")
		expect(lstatSync(dest).isSymbolicLink()).toBe(true)
		expect(await applyOneSkillChange("bundle-skill", false, source, curated)).toBeUndefined()
		expect(existsSync(dest)).toBe(false)
	})
})

describe("skills-manage: scan + batch summary + view helpers", () => {
	test("scan lists flat and bundle skills with the installed flag and description", async () => {
		const { source, curated } = await makeRoots()
		await seedSkills(source)
		const rows = await scanAvailableSkills(source, curated)
		expect(rows.map((r) => r.name)).toEqual(["bundle-skill", "flat-skill"])
		expect(rows.every((r) => r.installed === false)).toBe(true)
		expect(rows.find((r) => r.name === "flat-skill")!.description).toBe("A flat skill for tests")

		await applyOneSkillChange("flat-skill", true, source, curated)
		const after = await scanAvailableSkills(source, curated)
		expect(after.find((r) => r.name === "flat-skill")!.installed).toBe(true)
	})

	test("scan of an absent root is an empty state, not a throw", async () => {
		const rows = await scanAvailableSkills(join(tmpdir(), "dsh-skills-nope-9x"), tmpdir())
		expect(rows).toEqual([])
	})

	test("batch summary is empty when everything applied", () => {
		const results: SkillApplyResult[] = [
			{ name: "a", error: undefined },
			{ name: "b", error: undefined },
		]
		expect(skillApplySummary(results)).toBe("")
	})

	test("batch summary names failures with short reasons and caps the lists", () => {
		const results: SkillApplyResult[] = [
			{ name: "ok-1", error: undefined },
			{ name: "ok-2", error: undefined },
			{ name: "bad-1", error: 'refusing to remove "x": not a symlink' },
			{ name: "bad-2", error: "skill not found in /tmp" },
			{ name: "bad-3", error: "weird" },
			{ name: "bad-4", error: "weird" },
		]
		const summary = skillApplySummary(results)
		expect(summary).toContain("applied 2/6")
		expect(summary).toContain("ok: ok-1, ok-2 · ")
		expect(summary).toContain("bad-1 (protected (not a symlink))")
		expect(summary).toContain("bad-2 (source missing)")
		expect(summary).toContain("bad-3 (failed)")
		// The 4th failure collapses into the +N more tail.
		expect(summary).toContain("+1 more")
		expect(summary).not.toContain("bad-4 (")
	})

	test("short reason maps the errno classes", () => {
		expect(skillApplyShortReason('refusing "x": not a symlink')).toBe("protected (not a symlink)")
		expect(skillApplyShortReason("already installed from a different source: x")).toBe(
			"installed from a different source",
		)
		expect(skillApplyShortReason("cannot install: skill not found in /x")).toBe("source missing")
		expect(skillApplyShortReason("skill source vanished (/ENOENT)")).toBe("source missing")
		expect(skillApplyShortReason("EIO")).toBe("failed")
	})

	test("filter narrows over name and description, case-insensitive", () => {
		const rows = [
			{ name: "flat-skill", description: "A flat skill", installed: false },
			{ name: "bundle", description: "Bundle SKILL", installed: true },
		]
		expect(filterSkillRows(rows, "").length).toBe(2)
		expect(filterSkillRows(rows, "flat").map((r) => r.name)).toEqual(["flat-skill"])
		expect(filterSkillRows(rows, "bundle skill").map((r) => r.name)).toEqual(["bundle"])
		expect(filterSkillRows(rows, "nope")).toEqual([])
	})

	test("state text distinguishes installed/available and marks pending diffs", () => {
		expect(skillStateText({ installed: true })).toBe("installed")
		expect(skillStateText({ installed: false })).toBe("available")
		expect(skillStateText({ installed: true }, true)).toBe("installed")
		expect(skillStateText({ installed: true }, false)).toBe("available*")
		expect(skillStateText({ installed: false }, true)).toBe("installed*")
		expect(skillStateText({ installed: false }, false)).toBe("available")
	})

	test("ensureCuratedDir creates the user root when missing", async () => {
		const base = await mkdtemp(join(tmpdir(), "dsh-skills-ensure-"))
		const curated = join(base, "nested", "skills")
		await ensureCuratedDir(curated)
		expect(existsSync(curated)).toBe(true)
	})
})

describe("/skills command wiring", () => {
	function makeCtx(): SlashCommandContext & { lines: string[] } {
		const lines: string[] = []
		return {
			say: (text) => lines.push(text),
			clear: () => {},
			reload: () => {},
			quit: () => {},
			pickOne: async () => undefined,
			seam: {} as SlashCommandContext["seam"],
			lines,
		}
	}

	test("/skills without the hook degrades to the notice", async () => {
		const ctx = makeCtx()
		await coreCommands().find((c) => c.name === "/skills")!.run(ctx, "")
		expect(ctx.lines).toEqual(["/skills unavailable in this session"])
	})

	test("/skills with the hook opens the panel (no transcript rows)", async () => {
		const ctx = makeCtx()
		let opened = 0
		;(ctx as unknown as Record<string, unknown>).openSkills = () => {
			opened++
		}
		await coreCommands().find((c) => c.name === "/skills")!.run(ctx, "")
		expect(opened).toBe(1)
		expect(ctx.lines).toEqual([])
	})

	test("openSkills is a pinned entry hook (the /agents incident law)", () => {
		expect(ENTRY_SLASH_HOOKS).toContain("openSkills")
		const deps = buildSlashDeps(
			{
				say: () => {},
				clear: () => {},
				reload: () => {},
				quit: () => {},
				pickOne: async () => undefined,
			},
			{
				promptText: async () => undefined,
				openBtw: () => {},
				themes: undefined as never,
				openSearch: () => {},
				openPlugins: () => {},
				openSkills: () => {},
				openAgents: () => {},
				openSettings: () => {},
				openHistory: () => {},
				openSubagents: () => {},
				refreshFooter: () => {},
				invalidateFooter: () => {},
				flushQueue: () => ({ kind: "empty", started: 0, remaining: 0 }),
			},
		)
		expect(typeof deps.openSkills).toBe("function")
	})
})
