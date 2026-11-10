/**
 * Skills in the `/` palette: same filtering, Tab completion and dispatch
 * resolution as commands, with the deliberate model fall-through on submit.
 */
import { describe, expect, test } from "bun:test"
import type { SessionSeam } from "../src/seams/session"
import type { SlashCommand } from "../src/routes/session/commands"
import { createSlashHost, MAX_ROWS } from "../src/routes/session/slash-palette"
import { withSkillCommands } from "../src/routes/session/skills-source"

const SKILL_ROWS = [
	{ name: "cron", description: "schedule bounded tasks", path: "/x/cron/SKILL.md" },
	{ name: "cron-batch", description: "batch cron", path: "/x/cron-batch/SKILL.md" },
]

function command(name: string, ran: string[]): SlashCommand {
	return {
		name,
		description: `${name} description`,
		run() {
			ran.push(name)
		},
	}
}

function host(ran: string[], said: string[]) {
	return createSlashHost({
		seam: {} as SessionSeam,
		commands: withSkillCommands([command("/help", ran), command("/clear", ran)], SKILL_ROWS),
		say: (text) => said.push(text),
		clear: () => {},
		reload: () => {},
		quit: () => {},
		pickOne: async () => undefined,
	})
}

describe("skills in the slash palette", () => {
	test("the / filter matches commands and skills in one list", () => {
		const h = host([], [])
		h.controller.sync("/c", h.commands)
		const names = h.controller.filtered(h.commands).map((row) => row.name)
		expect(names).toContain("/clear")
		expect(names).toContain("/cron")
		expect(names).toContain("/cron-batch")
		// The visible cap still applies to the merged list.
		expect(h.controller.filtered(h.commands).length).toBeLessThanOrEqual(MAX_ROWS)
	})

	test("Tab completes a skill through completeSlash (same trailing space)", () => {
		const h = host([], [])
		expect(h.slashComplete("/cro", 4)).toEqual({ text: "/cron", cursor: 5 })
		expect(h.slashComplete("/cron", 5)).toEqual({ text: "/cron ", cursor: 6 })
		expect(h.slashComplete("/cron-b", 7)).toEqual({ text: "/cron-batch ", cursor: 12 })
	})

	test("submitting a skill line falls through to the model (false, not executed)", () => {
		const ran: string[] = []
		const said: string[] = []
		const h = host(ran, said)
		expect(h.interceptSubmit("/cron")).toBe(false)
		expect(h.interceptSubmit("/cron run the deploy monitor")).toBe(false)
		// Abbreviation resolved through the palette highlight also falls through,
		// and the composer is handed the canonical `/name ` line to submit (a raw
		// "/cro" would not match the host's /name gesture).
		h.controller.sync("/cro", h.commands)
		expect(h.controller.current(h.commands)?.name).toBe("/cron")
		let applied: string | undefined
		expect(h.interceptSubmit("/cro", (text) => { applied = text })).toBe(false)
		expect(applied).toBe("/cron ")
		expect(ran).toEqual([])
		// Skills must not be misreported as unknown commands.
		expect(said).toEqual([])
	})

	test("commands keep executing through the same intercept", () => {
		const ran: string[] = []
		const h = host(ran, [])
		expect(h.interceptSubmit("/help")).toBe(true)
		expect(ran).toEqual(["/help"])
	})

	test("a command abbreviation still resolves through the open palette highlight", () => {
		const ran: string[] = []
		const h = host(ran, [])
		// "/cl" filters to /clear; the highlight must be captured while the
		// menu is still open (close() clears the query).
		h.controller.sync("/cl", h.commands)
		expect(h.interceptSubmit("/cl")).toBe(true)
		expect(ran).toEqual(["/clear"])
	})

	test("an unknown /xxx still resolves as the harmless error row", () => {
		const said: string[] = []
		const h = host([], said)
		expect(h.interceptSubmit("/zzz")).toBe(true)
		expect(said[0]).toContain("unknown command: /zzz")
	})
})
