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
	PALETTE_ROWS,
	SlashPaletteController,
	overflowHint,
} from "../src/routes/session/slash-palette"

const COMMANDS: SlashCommand[] = [
	{ name: "/help", description: "d1", run: () => {} },
	{ name: "/new", description: "d2", run: () => {} },
]

/** MAX_ROWS + 3 matching commands — the overflow-cap fixture. Names are
 * zero-padded so the alphabetical order is also numeric (cmd00 < cmd09). */
function wideCommands(): SlashCommand[] {
	return Array.from({ length: MAX_ROWS + 3 }, (_, i) => ({
		name: `/cmd${String(i).padStart(2, "0")}`,
		description: `d${i}`,
		run: () => {},
	}))
}

/** A usage view backed by a plain map (the ordering input). */
function usageOf(counts: Record<string, number>) {
	return { count: (name: string) => counts[name] ?? 0 }
}

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
		expect(controller.rows()).toBe(PALETTE_ROWS)
		controller.sync("/zz", COMMANDS)
		expect(controller.filtered(COMMANDS)).toEqual([])
		expect(controller.rows()).toBe(0)
		expect(controller.open).toBe(false)
		// narrowing back to a match re-opens
		controller.sync("/h", COMMANDS)
		expect(controller.rows()).toBe(PALETTE_ROWS)
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
		expect(heights).toEqual([PALETTE_ROWS, PALETTE_ROWS, PALETTE_ROWS, PALETTE_ROWS])
		// the highlight still tracks the FILTERED list, not the padded box
		controller.sync("/he", commands)
		controller.move(2, commands)
		expect(controller.selected()).toBe(2)
		expect(controller.filtered(commands).length).toBe(3)
	})

	test("OVERFLOW CAP: the window paints MAX_ROWS command rows, the hint counts the rest", () => {
		// The box holds MAX_ROWS command rows (+ the reserved hint row), so the
		// VISIBLE slice is MAX_ROWS wide — an uncapped <For> painted every match
		// out of the fixed-height box onto the textarea below it.
		const commands: SlashCommand[] = wideCommands()
		const controller = new SlashPaletteController()
		controller.sync("/", commands) // every row matches "/"
		expect(controller.filtered(commands)).toHaveLength(MAX_ROWS)
		expect(controller.filtered(commands).at(-1)?.name).toBe("/cmd09")
		expect(controller.rows()).toBe(PALETTE_ROWS)
		// the reserved row carries the count past the window
		expect(controller.matches(commands)).toBe(MAX_ROWS + 3)
		expect(overflowHint(controller.matches(commands))).toBe("… 3 more")
	})

	test("OVERFLOW CAP: a list that fits shows no hint", () => {
		const controller = new SlashPaletteController()
		controller.sync("/", COMMANDS) // 2 matches
		expect(controller.matches(COMMANDS)).toBe(2)
		expect(overflowHint(controller.matches(COMMANDS))).toBeUndefined()
	})

	test("WINDOW FOLLOW: ↓ walks into the hidden tail and the window scrolls with it", () => {
		// The reported bug: ↓ could not reach commands past the visible cap.
		// Selection indexes the FULL list; the window origin follows so the
		// highlighted row is always painted. 19 rows = the real core set size.
		const commands: SlashCommand[] = Array.from({ length: 19 }, (_, i) => ({
			name: `/cmd${String(i).padStart(2, "0")}`,
			description: `d${i}`,
			run: () => {},
		}))
		const controller = new SlashPaletteController()
		controller.sync("/", commands)
		// 17 downs = the 18th row (the bug report's "18th entry")
		for (let i = 0; i < 17; i++) controller.move(1, commands)
		expect(controller.selected()).toBe(17)
		expect(controller.offset()).toBe(17 - MAX_ROWS + 1)
		const visible = controller.filtered(commands)
		expect(visible).toHaveLength(MAX_ROWS)
		expect(visible.at(-1)?.name).toBe("/cmd17") // the highlighted row, painted
		// the highlight resolves INSIDE the painted window (never an orphan)
		expect(controller.isRowActive(visible.length - 1)).toBe(true)
		expect(controller.current(commands)?.name).toBe("/cmd17")
		// hint: 1 match below the window, 8 scrolled off the top
		expect(overflowHint(controller.matches(commands), controller.offset())).toBe(
			"… 8 more above · … 1 more",
		)
	})

	test("WINDOW FOLLOW: wrap past the last match returns to the top window", () => {
		const commands: SlashCommand[] = wideCommands()
		const controller = new SlashPaletteController()
		controller.sync("/", commands)
		controller.move(-1, commands) // 0 → last (wrap)
		expect(controller.selected()).toBe(MAX_ROWS + 2)
		expect(controller.offset()).toBe(3)
		expect(controller.current(commands)?.name).toBe("/cmd12")
		controller.move(1, commands) // last → 0 (wrap)
		expect(controller.selected()).toBe(0)
		expect(controller.offset()).toBe(0)
		expect(controller.current(commands)?.name).toBe("/cmd00")
	})

	test("WINDOW FOLLOW: the hint reports both hidden edges mid-list", () => {
		const commands: SlashCommand[] = wideCommands()
		const controller = new SlashPaletteController()
		controller.sync("/", commands)
		for (let i = 0; i < 5; i++) controller.move(1, commands) // 5: still offset 0
		expect(overflowHint(controller.matches(commands), controller.offset())).toBe("… 3 more")
		for (let i = 0; i < 5; i++) controller.move(1, commands) // 10 → offset 1
		expect(controller.offset()).toBe(1)
		expect(overflowHint(controller.matches(commands), controller.offset())).toBe("… 1 more above · … 2 more")
	})

	test("PAGE: PgUp/PgDn move one MAX_ROWS page, clamped at the edges", () => {
		const commands: SlashCommand[] = wideCommands()
		const controller = new SlashPaletteController()
		controller.sync("/", commands)
		controller.movePage(1, commands)
		expect(controller.selected()).toBe(MAX_ROWS)
		expect(controller.offset()).toBe(1)
		controller.movePage(1, commands) // clamps at the last match
		expect(controller.selected()).toBe(MAX_ROWS + 2)
		expect(controller.offset()).toBe(3)
		controller.movePage(-1, commands)
		expect(controller.selected()).toBe(2)
		// minimal scroll: the window only moves down as far as the selection
		expect(controller.offset()).toBe(2)
		controller.movePage(-1, commands) // clamps at 0
		expect(controller.selected()).toBe(0)
	})

	test("EDGE: Home/End jump to the first/last match", () => {
		const commands: SlashCommand[] = wideCommands()
		const controller = new SlashPaletteController()
		controller.sync("/", commands)
		controller.moveEdge("end", commands)
		expect(controller.selected()).toBe(MAX_ROWS + 2)
		expect(controller.current(commands)?.name).toBe("/cmd12")
		controller.moveEdge("home", commands)
		expect(controller.selected()).toBe(0)
		expect(controller.offset()).toBe(0)
	})

	test("sync keeps the selection on the FULL list (only missing rows clamp it)", () => {
		const commands: SlashCommand[] = wideCommands()
		const controller = new SlashPaletteController()
		controller.sync("/", commands)
		for (let i = 0; i < 12; i++) controller.move(1, commands)
		expect(controller.selected()).toBe(12)
		// re-sync on the same wide table keeps the highlight where the user left it
		controller.sync("/", commands)
		expect(controller.selected()).toBe(12)
		expect(controller.offset()).toBe(3)
	})

	test("DEFAULT ORDER: alphabetical, case-insensitive, a prefix before its extension", () => {
		// `/task` / `/tasks` is a synthetic prefix pair: it pins the tiebreak
		// shape the real table lost with the /sessions → /resume rename (no
		// live command is a prefix of another any more).
		const commands: SlashCommand[] = [
			{ name: "/tasks", description: "d", run: () => {} },
			{ name: "/Help", description: "d", run: () => {} },
			{ name: "/task", description: "d", run: () => {} },
			{ name: "/agents", description: "d", run: () => {} },
		]
		const controller = new SlashPaletteController()
		controller.sync("/", commands)
		expect(controller.filtered(commands).map((c) => c.name)).toEqual([
			"/agents",
			"/Help",
			"/task",
			"/tasks",
		])
	})

	test("FREQUENCY ORDER: count desc, then name asc; ties fall back to alphabetical", () => {
		const commands: SlashCommand[] = [
			{ name: "/alpha", description: "d", run: () => {} },
			{ name: "/beta", description: "d", run: () => {} },
			{ name: "/gamma", description: "d", run: () => {} },
		]
		const controller = new SlashPaletteController(usageOf({ "/beta": 3, "/gamma": 1 }))
		controller.sync("/", commands)
		expect(controller.filtered(commands).map((c) => c.name)).toEqual(["/beta", "/gamma", "/alpha"])
		// equal counts keep the alphabetical tiebreak
		const tied = new SlashPaletteController(usageOf({ "/beta": 1, "/alpha": 1 }))
		tied.sync("/", commands)
		expect(tied.filtered(commands).map((c) => c.name)).toEqual(["/alpha", "/beta", "/gamma"])
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

	test("interceptSubmit: an exact typed name runs that command", () => {
		// "/task" typed in full must run /task, never the longer "/tasks" row.
		// Alphabetical ordering already puts the shorter name first (exact-match
		// precedence in the host is the second guard). Synthetic pair: it keeps
		// the shape the real table lost with the /sessions → /resume rename.
		const ran: string[] = []
		const commands: SlashCommand[] = [
			{ name: "/help", description: "d1", run: () => ran.push("/help") },
			{ name: "/tasks", description: "d2", run: () => ran.push("/tasks") },
			{ name: "/task", description: "d3", run: () => ran.push("/task") },
		]
		const { host } = makeHost(commands)
		host.slashKeyFilter(key("t"), "/task")
		// the highlight is the exact row itself: `/task` sorts before `/tasks`
		expect(host.controller.current(commands)?.name).toBe("/task")
		expect(host.interceptSubmit("/task")).toBe(true)
		expect(ran).toEqual(["/task"])
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

	test("/agents reaches the opener passed to createSlashHost (mount-bridge regression)", () => {
		// The live bug: v2-entry passed `openAgents` to createSlashHost but the
		// deps type + ctx spread never carried it, so ctx.openAgents stayed
		// undefined and /agents always answered "the manager panel is not
		// mounted in this entry" even with the panel mounted and the seam's
		// agents face present. Pin the whole bridge: dispatch -> ctx.openAgents.
		const opened: (string | undefined)[] = []
		const lines: string[] = []
		const seam = {
			agents: { list: () => [], officialCaps: async () => ({}) },
		} as any
		const host = createSlashHost({
			seam,
			commands: coreCommands().filter((c) => c.name === "/agents"),
			say: (text) => lines.push(text),
			clear: () => {},
			reload: () => {},
			quit: () => {},
			pickOne: async () => undefined,
			openAgents: (name?: string) => void opened.push(name),
		})
		expect(host.interceptSubmit("/agents")).toBe(true)
		// an argument preselects the exact agent row (tui-pi parity)
		expect(host.interceptSubmit("/agents workhorse")).toBe(true)
		expect(opened).toEqual([undefined, "workhorse"])
		expect(lines).toEqual([])
	})

	test("/agents without an opener still reports the mount gap honestly", () => {
		const lines: string[] = []
		const seam = { agents: { list: () => [] } } as any
		const host = createSlashHost({
			seam,
			commands: coreCommands().filter((c) => c.name === "/agents"),
			say: (text) => lines.push(text),
			clear: () => {},
			reload: () => {},
			quit: () => {},
			pickOne: async () => undefined,
		})
		host.interceptSubmit("/agents")
		expect(lines).toEqual(["/agents: the manager panel is not mounted in this entry"])
	})

	test("PgDn/PgUp/End/Home are consumed while open and page the list", () => {
		const commands = wideCommands()
		const { host } = makeHost(commands)
		expect(host.slashKeyFilter(key("pagedown"), "/")).toBe(true)
		expect(host.controller.selected()).toBe(MAX_ROWS)
		expect(host.controller.offset()).toBe(1)
		expect(host.slashKeyFilter(key("end"), "/")).toBe(true)
		expect(host.controller.current(commands)?.name).toBe("/cmd12")
		expect(host.slashKeyFilter(key("home"), "/")).toBe(true)
		expect(host.controller.selected()).toBe(0)
		expect(host.slashKeyFilter(key("pageup"), "/")).toBe(true)
		expect(host.controller.selected()).toBe(0)
		// a closed palette lets the page keys fall through to the textarea
		expect(host.slashKeyFilter(key("pagedown"), "/help")).toBe(false)
	})

	test("usage counts ONLY real dispatches: highlight/Tab are inert", () => {
		const config: Record<string, unknown> = {}
		const seam = { configLoad: () => config, configSave: (patch: any) => Object.assign(config, patch) } as any
		const commands: SlashCommand[] = [
			{ name: "/alpha", description: "d1", run: () => {} },
			{ name: "/beta", description: "d2", run: () => {} },
		]
		const host = createSlashHost({
			seam,
			commands,
			say: () => {},
			clear: () => {},
			reload: () => {},
			quit: () => {},
			pickOne: async () => undefined,
		})
		// moving the highlight and Tab-completing never touch the counter
		host.slashKeyFilter(key("down"), "/")
		host.slashComplete("/b", 2)
		expect(config.slashUsage).toBeUndefined()
		// three real dispatches (exact-name path) count three times
		expect(host.interceptSubmit("/beta")).toBe(true)
		expect(host.interceptSubmit("/beta")).toBe(true)
		expect(host.interceptSubmit("/beta")).toBe(true)
		host.usage.flush() // writes are debounced (~1.2 s); flush = test/exit path
		expect(config.slashUsage).toEqual({ "/beta": 3 })
		// the live palette now ranks /beta ahead of the alphabetically-first /alpha
		host.controller.sync("/", commands)
		expect(host.controller.filtered(commands).map((c) => c.name)).toEqual(["/beta", "/alpha"])
	})

	test("usage survives a host rebuild through the config seam (restart round trip)", () => {
		const config: Record<string, unknown> = {}
		const seam = { configLoad: () => config, configSave: (patch: any) => Object.assign(config, patch) } as any
		const commands: SlashCommand[] = [
			{ name: "/alpha", description: "d1", run: () => {} },
			{ name: "/beta", description: "d2", run: () => {} },
		]
		const deps = {
			seam,
			commands,
			say: () => {},
			clear: () => {},
			reload: () => {},
			quit: () => {},
			pickOne: async () => undefined,
		}
		const first = createSlashHost(deps)
		first.interceptSubmit("/beta")
		first.interceptSubmit("/beta")
		first.usage.flush() // debounced writer: persist before the "restart"
		// a fresh boot reads the same config back
		const second = createSlashHost(deps)
		second.controller.sync("/", commands)
		expect(second.controller.filtered(commands).map((c) => c.name)).toEqual(["/beta", "/alpha"])
	})

	test("core set via the default registry: dispatch reaches the real commands", () => {
		const { host, hooks } = makeHost()
		host.commands.push(...coreCommands().filter((c) => c.name === "/quit"))
		expect(host.interceptSubmit("/quit")).toBe(true)
		expect(hooks.quit).toBe(1)
	})
})
