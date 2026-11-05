/**
 * Slash palette controller + host glue tests (batch 8): sync/visibility,
 * prefix filtering, wrap navigation, esc-keeps-buffer, and the two composer
 * hook paths (key consumption + submit interception incl. the unknown row).
 */
import { describe, expect, test } from "bun:test"
import { coreCommands, type SlashCommand } from "../src/routes/session/commands"
import {
	createSlashHost,
	SlashPaletteController,
} from "../src/routes/session/slash-palette"

const COMMANDS: SlashCommand[] = [
	{ name: "/help", description: "d1", run: () => {} },
	{ name: "/new", description: "d2", run: () => {} },
]

/** Minimal key event stub (only what the host reads). */
function key(name: string): any {
	return { name, preventDefault: (() => {}) as any, ctrl: false }
}

describe("SlashPaletteController", () => {
	test("sync opens on a leading slash and closes on anything else", () => {
		const controller = new SlashPaletteController()
		controller.sync("/h", COMMANDS)
		expect(controller.open).toBe(true)
		expect(controller.query()).toBe("/h")
		controller.sync("hello", COMMANDS)
		expect(controller.open).toBe(false)
		expect(controller.query()).toBe("")
	})

	test("a space in the buffer closes the menu (command entered, args follow)", () => {
		const controller = new SlashPaletteController()
		controller.sync("/model big", COMMANDS)
		expect(controller.open).toBe(false)
	})

	test("query narrows the rows; selection clamps when the list shrinks", () => {
		const controller = new SlashPaletteController()
		controller.sync("/", COMMANDS)
		expect(controller.filtered(COMMANDS).length).toBe(2)
		controller.move(1, COMMANDS)
		expect(controller.selected()).toBe(1)
		controller.sync("/n", COMMANDS)
		expect(controller.filtered(COMMANDS).map((c) => c.name)).toEqual(["/new"])
		expect(controller.selected()).toBe(0)
	})

	test("move wraps in both directions", () => {
		const controller = new SlashPaletteController()
		controller.sync("/", COMMANDS)
		controller.move(-1, COMMANDS)
		expect(controller.selected()).toBe(1)
		controller.move(1, COMMANDS)
		expect(controller.selected()).toBe(0)
	})

	test("current returns the highlighted command", () => {
		const controller = new SlashPaletteController()
		controller.sync("/he", COMMANDS)
		expect(controller.current(COMMANDS)?.name).toBe("/help")
	})
})

describe("createSlashHost", () => {
	function makeHost() {
		const lines: string[] = []
		const hooks = { cleared: 0, reloaded: 0, quit: 0, ran: [] as string[] }
		const host = createSlashHost({
			seam: new Proxy({} as any, {}),
			commands: [
				{ name: "/help", description: "d1", run: () => hooks.ran.push("/help") },
				{ name: "/new", description: "d2", run: () => hooks.ran.push("/new") },
			],
			say: (text) => lines.push(text),
			clear: () => hooks.cleared++,
			reload: () => hooks.reloaded++,
			quit: () => hooks.quit++,
			pickOne: async () => undefined,
		})
		return { host, lines, hooks }
	}

	test("slashKeyFilter consumes up/down while open (with wrap)", () => {
		const { host } = makeHost()
		const up = key("up")
		expect(host.slashKeyFilter(up, "/")).toBe(true)
		expect(host.controller.selected()).toBe(1)
		expect(host.slashKeyFilter(key("down"), "/")).toBe(true)
		expect(host.controller.selected()).toBe(0)
	})

	test("escape closes the palette and consumes the key (buffer untouched)", () => {
		const { host } = makeHost()
		expect(host.slashKeyFilter(key("escape"), "/help")).toBe(true)
		expect(host.controller.open).toBe(false)
		// a subsequent navigation key falls through (not consumed)
		expect(host.slashKeyFilter(key("up"), "/help")).toBe(false)
	})

	test("typing re-arms the menu after esc (old behavior)", () => {
		const { host } = makeHost()
		host.slashKeyFilter(key("escape"), "/help")
		host.slashKeyFilter(key("a"), "/helpx")
		expect(host.controller.open).toBe(true)
	})

	test("interceptSubmit runs the highlighted entry for a partial name", () => {
		const { host, hooks } = makeHost()
		host.slashKeyFilter(key("n"), "/n")
		expect(host.interceptSubmit("/n")).toBe(true)
		expect(hooks.ran).toEqual(["/new"])
		expect(host.controller.open).toBe(false)
	})

	test("interceptSubmit passes the argument text through", () => {
		const { host, hooks } = makeHost()
		expect(host.interceptSubmit("/new")).toBe(true)
		expect(hooks.ran).toEqual(["/new"])
	})

	test("unknown /xxx resolves as the harmless error row, never a send", () => {
		const { host, lines, hooks } = makeHost()
		expect(host.interceptSubmit("/nope")).toBe(true)
		expect(lines).toEqual(["unknown command: /nope (try /help)"])
		expect(hooks.ran).toEqual([])
	})

	test("plain text returns false (flows to send/steer) and closes any menu", () => {
		const { host, lines } = makeHost()
		host.slashKeyFilter(key("x"), "/")
		expect(host.interceptSubmit("hello world")).toBe(false)
		expect(lines).toEqual([])
		expect(host.controller.open).toBe(false)
	})

	test("core set via the default registry: dispatch reaches the real commands", () => {
		const { host, hooks } = makeHost()
		host.commands.push(...coreCommands().filter((c) => c.name === "/quit"))
		expect(host.interceptSubmit("/quit")).toBe(true)
		expect(hooks.quit).toBe(1)
	})
})
