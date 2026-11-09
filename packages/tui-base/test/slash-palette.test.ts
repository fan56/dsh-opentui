/**
 * Slash palette controller + host glue tests (batch 8): sync/visibility,
 * prefix filtering, wrap navigation, esc-keeps-buffer, and the two composer
 * hook paths (key consumption + submit interception incl. the unknown row).
 */
import { describe, expect, test } from "bun:test"
import { coreCommands, type SlashCommand } from "../src/routes/session/commands"
import {
	createSlashHost,
	MAX_ROWS,
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

	test("a zero-match query closes the palette (batch V5: no empty 1-row strip)", () => {
		const controller = new SlashPaletteController()
		controller.sync("/", COMMANDS)
		expect(controller.rows()).toBe(MAX_ROWS)
		controller.sync("/zz", COMMANDS)
		expect(controller.filtered(COMMANDS)).toEqual([])
		expect(controller.rows()).toBe(0)
		expect(controller.open).toBe(false)
		// narrowing back to a match re-opens
		controller.sync("/h", COMMANDS)
		expect(controller.rows()).toBe(MAX_ROWS)
	})

	test("STABLE-HEIGHT: narrowing the filter never changes the rendered height", () => {
		// The flicker regression: a count-tracking height resized the composer
		// root per keystroke (global reflow, border flicker). The rendered box
		// height must stay at the MAX_ROWS cap for ANY non-zero result — the
		// filter only decides which rows paint (open/close still transition).
		const commands: SlashCommand[] = [
			{ name: "/help", description: "d1", run: () => {} },
			{ name: "/hello", description: "d2", run: () => {} },
			{ name: "/heat", description: "d3", run: () => {} },
			{ name: "/new", description: "d4", run: () => {} },
		]
		const controller = new SlashPaletteController()
		const heights: number[] = []
		controller.sync("/", commands)
		heights.push(controller.rows()) // 4 matches
		controller.sync("/he", commands)
		heights.push(controller.rows()) // 3 matches
		controller.sync("/hel", commands)
		heights.push(controller.rows()) // 2 matches
		controller.sync("/help", commands)
		heights.push(controller.rows()) // 1 match
		expect(heights).toEqual([MAX_ROWS, MAX_ROWS, MAX_ROWS, MAX_ROWS])
		// the highlight still tracks the FILTERED list, not the padded box
		controller.sync("/he", commands)
		controller.move(2, commands)
		expect(controller.selected()).toBe(2)
		expect(controller.filtered(commands).length).toBe(3)
	})
})

describe("createSlashHost", () => {
	function makeHost(commands?: SlashCommand[]) {
		const lines: string[] = []
		const hooks = { cleared: 0, reloaded: 0, quit: 0, ran: [] as string[] }
		const host = createSlashHost({
			seam: new Proxy({} as any, {}),
			commands:
				commands ?? [
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
		host.slashKeyFilter(key("escape"), "/h")
		expect(host.controller.open).toBe(false)
		// the next edit re-arms (a MATCHING query — zero matches stay closed
		// since batch V5)
		host.slashKeyFilter(key("e"), "/he")
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

	test("interceptSubmit: an exact typed name beats the highlighted prefix row", () => {
		// "/session" typed in full must run /session even though the longer
		// "/sessions" prefix row is highlighted in the palette (the exact-match
		// precedence dispatchLine already applies — parity here, or Enter opens
		// the Resume picker instead of the info panel).
		const ran: string[] = []
		const commands: SlashCommand[] = [
			{ name: "/help", description: "d1", run: () => ran.push("/help") },
			{ name: "/sessions", description: "d2", run: () => ran.push("/sessions") },
			{ name: "/session", description: "d3", run: () => ran.push("/session") },
		]
		const { host } = makeHost(commands)
		host.slashKeyFilter(key("s"), "/session")
		// the highlight IS the shadowing row (table order puts /sessions first)
		expect(host.controller.current(commands)?.name).toBe("/sessions")
		expect(host.interceptSubmit("/session")).toBe(true)
		expect(ran).toEqual(["/session"])
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
