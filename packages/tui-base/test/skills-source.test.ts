/**
 * skills-source.ts: filesystem discovery, frontmatter parsing, slash-row
 * wrapping and the italic palette style. Pure/read-only against temp dirs.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { TextAttributes } from "@opentui/core"
import type { SlashCommand } from "../src/routes/session/commands"
import {
	discoverSkills,
	findProjectRoot,
	frontmatterBoolean,
	parseFrontmatter,
	paletteRowAttributes,
	resolveAgentsHome,
	skillCommands,
	skillRoots,
	withSkillCommands,
} from "../src/routes/session/skills-source"

const tempRoots: string[] = []

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix))
	tempRoots.push(dir)
	return dir
}

function cleanup(): void {
	for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true })
}

function writeSkill(root: string, name: string, frontmatter: string, flat = false): void {
	if (flat) {
		writeFileSync(join(root, `${name}.md`), frontmatter)
		return
	}
	const dir = join(root, name)
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, "SKILL.md"), frontmatter)
}

const SKILL = (name: string, description = `${name} description`, extra = "") =>
	`---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n`

describe("skills-source: frontmatter", () => {
	test("parses plain, quoted and block scalars", () => {
		const front = parseFrontmatter(
			'---\nname: cron\ndescription: "a: quoted value"\nuser-invocable: no\nwhenToUse: >\n  first line\n  second line\n---\nbody',
		)
		expect(front).toEqual({
			name: "cron",
			description: "a: quoted value",
			"user-invocable": "no",
			whenToUse: "first line second line",
		})
	})

	test("returns undefined without a frontmatter fence", () => {
		expect(parseFrontmatter("# just markdown")).toBeUndefined()
	})

	test("strict boolean grammar", () => {
		expect(frontmatterBoolean("TRUE")).toBe(true)
		expect(frontmatterBoolean("Off")).toBe(false)
		expect(frontmatterBoolean("maybe")).toBeUndefined()
		expect(frontmatterBoolean(undefined)).toBeUndefined()
	})
})

describe("skills-source: discovery", () => {
	test("finds bundle + flat skills and skips disabled/invalid ones", () => {
		const dshHome = tempDir("skill-home-")
		const skills = join(dshHome, "skills")
		mkdirSync(skills, { recursive: true })
		writeSkill(skills, "cron", SKILL("cron", "schedule tasks"))
		writeSkill(skills, "flat-one", SKILL("flat-one", "flat file skill"), true)
		writeSkill(skills, "hidden", SKILL("hidden", "not user invocable", "user-invocable: false\n"))
		writeSkill(skills, "badname", SKILL("Bad_Name", "invalid name"))
		writeSkill(skills, "nodesc", "---\nname: nodesc\n---\nbody")
		writeSkill(skills, "bogus-bool", SKILL("bogus-bool", "bad boolean", "user-invocable: maybe\n"))

		const rows = discoverSkills({ cwd: tempDir("skill-cwd-"), dshHome, agentsHome: tempDir("skill-agents-") })
		expect(rows.map((row) => row.name)).toEqual(["cron", "flat-one"])
		expect(rows[0]!.description).toBe("schedule tasks")
		cleanup()
	})

	test("ranks project roots above the user root; first name wins", () => {
		const project = tempDir("skill-project-")
		mkdirSync(join(project, ".git"))
		const projectSkills = join(project, ".dsh", "skills")
		mkdirSync(projectSkills, { recursive: true })
		writeSkill(projectSkills, "cron", SKILL("cron", "project cron"))
		writeSkill(projectSkills, "proj-only", SKILL("proj-only", "project only"))

		const dshHome = tempDir("skill-home-")
		const userSkills = join(dshHome, "skills")
		mkdirSync(userSkills, { recursive: true })
		writeSkill(userSkills, "cron", SKILL("cron", "user cron"))
		writeSkill(userSkills, "user-only", SKILL("user-only", "user only"))

		const rows = discoverSkills({
			cwd: join(project, "nested", "dir"),
			dshHome,
			agentsHome: tempDir("skill-agents-"),
		})
		const byName = new Map(rows.map((row) => [row.name, row.description]))
		expect(byName.get("cron")).toBe("project cron")
		expect(byName.get("proj-only")).toBe("project only")
		expect(byName.get("user-only")).toBe("user only")
		cleanup()
	})

	test("root list is ranked and de-duplicated; .system is a user-root rule", () => {
		const cwd = tempDir("skill-cwd-")
		mkdirSync(join(cwd, ".git"))
		const roots = skillRoots({
			cwd,
			dshHome: tempDir("skill-home-"),
			agentsHome: tempDir("skill-agents-"),
		})
		expect(roots.map((root) => root.rank)).toEqual([100, 200, 400, 500])
		expect(roots[2]!.skipSystem).toBe(true)
		expect(roots[0]!.path).toBe(join(cwd, ".dsh", "skills"))
		expect(findProjectRoot(join(cwd, "a", "b"))).toBe(cwd)
		cleanup()
	})

	test("project root counts a .git FILE (worktree/submodule), not only a directory", () => {
		const worktree = tempDir("skill-worktree-")
		// `git worktree add` writes a file: `gitdir: <main>/.git/worktrees/<name>`.
		writeFileSync(join(worktree, ".git"), `gitdir: ${join(worktree, "main", ".git", "worktrees", "wt")}\n`)
		const nested = join(worktree, "packages", "app")
		mkdirSync(nested, { recursive: true })
		expect(findProjectRoot(nested)).toBe(worktree)

		// A plain directory with no .git at any depth falls back to cwd.
		const bare = tempDir("skill-bare-")
		mkdirSync(join(bare, "deep", "er"), { recursive: true })
		expect(findProjectRoot(join(bare, "deep", "er"))).toBe(join(bare, "deep", "er"))
		cleanup()
	})
})

describe("skills-source: agents home resolution (host parity)", () => {
	const withEnv = (value: string | undefined, fn: () => void): void => {
		const previous = process.env.DSH_AGENTS_HOME
		if (value === undefined) delete process.env.DSH_AGENTS_HOME
		else process.env.DSH_AGENTS_HOME = value
		try {
			fn()
		} finally {
			if (previous === undefined) delete process.env.DSH_AGENTS_HOME
			else process.env.DSH_AGENTS_HOME = previous
		}
	}

	test("explicit config wins over the env", () => {
		withEnv(join(tmpdir(), "env-agents-home"), () => {
			expect(resolveAgentsHome(join(tmpdir(), "explicit-agents-home"))).toBe(
				join(tmpdir(), "explicit-agents-home"),
			)
		})
	})

	test("non-empty DSH_AGENTS_HOME is the second leg", () => {
		const envHome = join(tmpdir(), "env-only-agents-home")
		withEnv(envHome, () => {
			expect(resolveAgentsHome()).toBe(envHome)
			expect(skillRoots({ cwd: tempDir("skill-cwd-") }).at(-1)!.path).toBe(join(envHome, "skills"))
		})
		cleanup()
	})

	test("an empty/blank env is unset and falls back to ~/.agents", () => {
		withEnv("   ", () => {
			expect(resolveAgentsHome()).toBe(join(homedir(), ".agents"))
		})
		withEnv("", () => {
			expect(resolveAgentsHome()).toBe(join(homedir(), ".agents"))
		})
	})
})

describe("skills-source: slash rows + style", () => {
	test("wrap skills as /name rows with the skill's own description", () => {
		const rows = skillCommands([
			{ name: "cron", description: "schedule tasks", path: "/x/cron/SKILL.md" },
			{ name: "bare", description: "no fallback needed", path: "/x/bare.md" },
		])
		expect(rows.map((row) => row.name)).toEqual(["/cron", "/bare"])
		expect(rows[0]!.description).toBe("schedule tasks")
		expect(rows[1]!.description).toBe("no fallback needed")
		expect(rows.every((row) => row.kind === "skill")).toBe(true)
	})

	test("withSkillCommands preserves command order, appends skills, keeps command on collision", () => {
		const command = (name: string): SlashCommand => ({ name, description: name, run: () => {} })
		const merged = withSkillCommands([
			command("/help"),
			command("/model"),
		], [
			{ name: "model", description: "collides", path: "/x/model/SKILL.md" },
			{ name: "cron", description: "schedule", path: "/x/cron/SKILL.md" },
		])
		expect(merged.map((row) => row.name)).toEqual(["/help", "/model", "/cron"])
		expect(merged[1]!.kind).toBeUndefined()
	})

	test("palette attributes: commands keep bold-only, skills italicize both states", () => {
		const command: SlashCommand = { name: "/help", description: "d", run: () => {} }
		const skill: SlashCommand = { name: "/cron", description: "d", kind: "skill", run: () => {} }
		expect(paletteRowAttributes(command, false)).toBe(0)
		expect(paletteRowAttributes(command, true)).toBe(TextAttributes.BOLD)
		expect(paletteRowAttributes(skill, false)).toBe(TextAttributes.ITALIC)
		expect(paletteRowAttributes(skill, true)).toBe(TextAttributes.BOLD | TextAttributes.ITALIC)
	})
})
