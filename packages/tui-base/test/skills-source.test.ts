/**
 * skills-source.ts: filesystem discovery, frontmatter parsing, slash-row
 * wrapping and the italic palette style. Pure/read-only against temp dirs.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TextAttributes } from "@opentui/core"
import type { SlashCommand } from "../src/routes/session/commands"
import {
	discoverSkills,
	findProjectRoot,
	frontmatterBoolean,
	parseFrontmatter,
	paletteRowAttributes,
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
})

describe("skills-source: slash rows + style", () => {
	test("wrap skills as /name rows with the skill description (or a fallback)", () => {
		const rows = skillCommands([
			{ name: "cron", description: "schedule tasks", path: "/x/cron/SKILL.md" },
			{ name: "bare", description: "", path: "/x/bare.md" },
		])
		expect(rows.map((row) => row.name)).toEqual(["/cron", "/bare"])
		expect(rows[0]!.description).toBe("schedule tasks")
		expect(rows[1]!.description).toBe("invoke skill bare")
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
