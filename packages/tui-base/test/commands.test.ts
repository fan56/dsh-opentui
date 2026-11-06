/**
 * Slash-command registry tests (batch 8): dispatch classification, the
 * harmless unknown row, and each core command's seam/hook call.
 */
import { describe, expect, test } from "bun:test"
import {
	coreCommands,
	dispatchLine,
	filterCommands,
	unknownCommandRow,
	type SlashCommandContext,
} from "../src/routes/session/commands"
import type { SessionSeam, SeamProviderModel, SeamSessionSummary } from "../src/seams/session"

/** Recording fake: every seam method the core set touches is a spy. */
class RecordingSeam {
	sessions: SeamSessionSummary[] = [
		{ id: "s1", title: "first", updatedAt: "2026-01-01" },
		{ id: "s2", title: "second" },
	]
	catalog: SeamProviderModel[] = [
		{ providerID: "bigmodel", modelID: "glm-5.3-flash" },
		{ providerID: "deepseek", modelID: "v3.2" },
	]
	calls: string[] = []
	pickAnswer: string | undefined

	readonly seam: SessionSeam = {
		status: () => ({ connection: "connected", turn: "idle", sessionAttached: true }),
		listSessions: async () => {
			this.calls.push("listSessions")
			return this.sessions
		},
		searchSessions: async () => [],
		storedTranscript: async () => [],
		currentSessionId: () => "s-current",
		resumeSession: (id) => {
			this.calls.push(`resumeSession:${id}`)
			return "ok"
		},
		newSession: () => {
			this.calls.push("newSession")
		},
		renameSession: async () => undefined,
		turn: async () => {},
		steer: () => {},
		interrupt: () => {},
		registerAskProvider: () => {},
		listProviders: async () => [],
		modelCatalog: async () => {
			this.calls.push("modelCatalog")
			return this.catalog
		},
		currentModelSelection: async () => {
			this.calls.push("currentModelSelection")
			return { providerID: "bigmodel", modelID: "glm-5.3-flash" }
		},
		selectModel: (providerID, modelID) => {
			this.calls.push(`selectModel:${providerID}/${modelID}`)
		},
		usageSummary: () => [],
		onSessionEvent: () => () => {},
		dispose: async () => {},
	}
}

function makeCtx(seam: RecordingSeam, pickAnswer?: string) {
	const lines: string[] = []
	const hooks = {
		cleared: 0,
		reloaded: 0,
		quit: 0,
		picks: [] as { title: string; options: { title: string; description?: string }[] }[],
	}
	const ctx: SlashCommandContext & { hooks: typeof hooks; lines: string[] } = {
		seam: seam.seam,
		say: (text) => lines.push(text),
		clear: () => hooks.cleared++,
		reload: () => hooks.reloaded++,
		quit: () => hooks.quit++,
		pickOne: async (title, options) => {
			hooks.picks.push({ title, options: options.map((o) => ({ title: o.title, description: o.description })) })
			return pickAnswer
		},
		hooks,
		lines,
	}
	return ctx
}

describe("dispatchLine", () => {
	const commands = coreCommands()

	test("plain text is not a command (flows to send/steer)", () => {
		expect(dispatchLine(commands, "hello world")).toEqual({ kind: "text" })
		expect(dispatchLine(commands, "")).toEqual({ kind: "text" })
	})

	test("unknown /xxx is classified unknown (never sent to the model)", () => {
		const result = dispatchLine(commands, "/nope arg")
		expect(result).toEqual({ kind: "unknown", name: "/nope" })
	})

	test("exact command dispatches with its argument text", () => {
		const result = dispatchLine(commands, "/model deepseek/v3.2")
		expect(result.kind).toBe("command")
		if (result.kind === "command") {
			expect(result.command.name).toBe("/model")
			expect(result.argText).toBe("deepseek/v3.2")
		}
	})

	test("partial name dispatches to the longest registered prefix", () => {
		const result = dispatchLine(commands, "/se")
		expect(result.kind).toBe("command")
		if (result.kind === "command") expect(result.command.name).toBe("/sessions")
	})

	test("unknown row text is the old ShellHost phrasing", () => {
		expect(unknownCommandRow("/nope")).toBe("unknown command: /nope (try /help)")
	})
})

describe("filterCommands (palette prefix filter)", () => {
	const commands = coreCommands()

	test("empty-ish query returns nothing (caller gates on the slash)", () => {
		expect(filterCommands(commands, "")).toEqual([])
		expect(filterCommands(commands, "help")).toEqual([])
	})

	test("prefix narrows the table", () => {
		expect(filterCommands(commands, "/").map((c) => c.name)).toEqual([
			"/help",
			"/new",
			"/model",
			"/quit",
			"/sessions",
			"/clear",
			"/btw",
			"/session",
			"/plugins",
			"/think",
			"/hotkeys",
			"/theme",
		])
		expect(filterCommands(commands, "/cl").map((c) => c.name)).toEqual(["/clear"])
		expect(filterCommands(commands, "/pl").map((c) => c.name)).toEqual(["/plugins"])
		expect(filterCommands(commands, "/l").map((c) => c.name)).toEqual([])
	})
})

describe("core commands", () => {
	test("/help lists the table", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await coreCommands()[0]!.run(ctx, "")
		expect(ctx.lines).toEqual([
			"/help — show available commands",
			"/new — start a fresh session",
			"/model — switch model (bare opens the picker)",
			"/quit — exit the app",
			"/sessions — list and resume stored sessions",
			"/clear — clear the transcript",
			"/btw — side question (bare reopens the last answer)",
			"/session — show session info (id, model, tokens, speed)",
			"/plugins — list installed plugins",
			"/think — set reasoning effort (opens the picker)",
			"/hotkeys — show keybinds",
			"/theme — switch theme (opens the picker)",
		])
	})

	test("/new calls newSession + reload and echoes the session id", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam)
		await coreCommands()[1]!.run(ctx, "")
		expect(seam.calls).toEqual(["newSession"])
		expect(ctx.hooks.reloaded).toBe(1)
		expect(ctx.lines).toEqual(["new session s-current"])
	})

	test("/model bare opens the picker from the catalog and selects on pick", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, "deepseek/v3.2")
		await coreCommands()[2]!.run(ctx, "")
		expect(seam.calls).toContain("modelCatalog")
		expect(ctx.hooks.picks[0]?.title).toBe("Select model")
		expect(ctx.hooks.picks[0]?.options).toEqual([
			{ title: "bigmodel/glm-5.3-flash", description: "current" },
			{ title: "deepseek/v3.2" },
		])
		expect(seam.calls).toContain("selectModel:deepseek/v3.2")
		expect(ctx.lines).toEqual(["model → deepseek/v3.2"])
	})

	test("/model bare with esc resolves without selecting", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, undefined)
		await coreCommands()[2]!.run(ctx, "")
		expect(seam.calls).not.toContain("selectModel:deepseek/v3.2")
		expect(ctx.lines).toEqual([])
	})

	test("/model provider/model selects directly (no picker)", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam)
		await coreCommands()[2]!.run(ctx, "bigmodel/glm-5.3-flash")
		expect(seam.calls).toEqual(["selectModel:bigmodel/glm-5.3-flash"])
		expect(ctx.hooks.picks).toEqual([])
	})

	test("/model with a malformed argument prints usage, no select", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam)
		await coreCommands()[2]!.run(ctx, "justamodel")
		expect(seam.calls).toEqual([])
		expect(ctx.lines).toEqual(['usage: /model or /model provider/model (got "justamodel")'])
	})

	test("/quit calls the quit hook only", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await coreCommands()[3]!.run(ctx, "")
		expect(ctx.hooks.quit).toBe(1)
		expect(ctx.lines).toEqual([])
	})

	test("/sessions lists, picks, resumes, reloads", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, "s2")
		await coreCommands()[4]!.run(ctx, "")
		expect(seam.calls).toEqual(["listSessions", "resumeSession:s2"])
		expect(ctx.hooks.picks[0]?.title).toBe("Resume session")
		expect(ctx.hooks.picks[0]?.options).toEqual([
			{ title: "first", description: "2026-01-01" },
			{ title: "second", description: undefined },
		])
		expect(ctx.hooks.reloaded).toBe(1)
		expect(ctx.lines).toEqual(["resumed s2"])
	})

	test("/sessions with no stored sessions says so (no picker)", async () => {
		const seam = new RecordingSeam()
		seam.sessions = []
		const ctx = makeCtx(seam)
		await coreCommands()[4]!.run(ctx, "")
		expect(ctx.hooks.picks).toEqual([])
		expect(ctx.lines).toEqual(["no stored sessions"])
	})

	test("/clear resets the transcript client-side and says so", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await coreCommands()[5]!.run(ctx, "")
		expect(ctx.hooks.cleared).toBe(1)
		expect(ctx.lines).toEqual(["transcript cleared"])
	})

	test("/btw is registered and dispatches with its argument text", () => {
		const result = dispatchLine(coreCommands(), "/btw what is a pec?")
		expect(result.kind).toBe("command")
		if (result.kind === "command") {
			expect(result.command.name).toBe("/btw")
			expect(result.argText).toBe("what is a pec?")
		}
		expect(filterCommands(coreCommands(), "/b").map((c) => c.name)).toEqual(["/btw"])
	})

	test("/btw opens the overlay through the hook when the seam has btwAsk", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam)
		const opened: string[] = []
		ctx.seam = { ...seam.seam, btwAsk: async () => "ok" }
		ctx.openBtw = (argText) => opened.push(argText)
		await coreCommands().find((c) => c.name === "/btw")!.run(ctx, "why?")
		expect(opened).toEqual(["why?"])
		expect(ctx.lines).toEqual([])
	})

	test("/btw without a btwAsk seam or opener says unavailable (no overlay)", async () => {
		const ctx = makeCtx(new RecordingSeam())
		const opened: string[] = []
		ctx.openBtw = (argText) => opened.push(argText)
		await coreCommands().find((c) => c.name === "/btw")!.run(ctx, "why?")
		expect(opened).toEqual([])
		expect(ctx.lines).toEqual(["/btw unavailable in this session"])
	})

	test("/plugins prints one ● name@version row per installed plugin", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam)
		ctx.seam = { ...seam.seam, plugins: () => [
			{ name: "dsh-tui-pi", version: "0.5.0" },
			{ name: "dsh-jev-core", version: "1.2.3" },
		] }
		await coreCommands().find((c) => c.name === "/plugins")!.run(ctx, "")
		expect(ctx.lines).toEqual(["● dsh-tui-pi@0.5.0", "● dsh-jev-core@1.2.3"])
	})

	test("/plugins with an empty list says so (no rows)", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam)
		ctx.seam = { ...seam.seam, plugins: () => [] }
		await coreCommands().find((c) => c.name === "/plugins")!.run(ctx, "")
		expect(ctx.lines).toEqual(["no plugins installed"])
	})

	test("/plugins without the seam face says unavailable", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await coreCommands().find((c) => c.name === "/plugins")!.run(ctx, "")
		expect(ctx.lines).toEqual(["/plugins unavailable in this session"])
	})

	test("/theme bare opens the picker over the bundled list with current marked", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, "github-light")
		const applied: string[] = []
		ctx.themes = {
			current: () => "opencode",
			list: () => ["github-dark", "github-light", "opencode"],
			set: (name) => {
				applied.push(name)
				return true
			},
		}
		await coreCommands().find((c) => c.name === "/theme")!.run(ctx, "")
		expect(ctx.hooks.picks[0]?.title).toBe("Select theme")
		expect(ctx.hooks.picks[0]?.options).toEqual([
			{ title: "github-dark" },
			{ title: "github-light" },
			{ title: "opencode", description: "current" },
		])
		expect(applied).toEqual(["github-light"])
		expect(ctx.lines).toEqual(["Theme: github-light — applied"])
	})

	test("/theme with esc or the current theme re-picked applies nothing", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, undefined)
		const applied: string[] = []
		ctx.themes = {
			current: () => "opencode",
			list: () => ["opencode"],
			set: (name) => {
				applied.push(name)
				return true
			},
		}
		await coreCommands().find((c) => c.name === "/theme")!.run(ctx, "")
		expect(applied).toEqual([])
		expect(ctx.lines).toEqual([])
	})

	test("/theme without the themes face says unavailable", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await coreCommands().find((c) => c.name === "/theme")!.run(ctx, "")
		expect(ctx.lines).toEqual(["/theme unavailable in this session"])
	})
})

describe("/think (batch F7b)", () => {
	test("opens the picker over the seam's real effort ladder and applies the pick", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, "low")
		const applied: (string | undefined)[] = []
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [
					{ id: "off", name: "Off" },
					{ id: "low", name: "Low" },
					{ id: "high", name: "High", description: "current" },
				],
				currentEffort: async () => "high",
				selectEffort: (effort) => {
					applied.push(effort)
				},
			},
		}
		await coreCommands().find((c) => c.name === "/think")!.run(ctx, "")
		expect(ctx.hooks.picks[0]?.title).toBe("Select reasoning effort")
		expect(ctx.hooks.picks[0]?.options).toEqual([
			{ title: "Off" },
			{ title: "Low" },
			{ title: "High", description: "current" },
		])
		expect(applied).toEqual(["low"])
		expect(ctx.lines).toEqual(["thinking → low (next turn)"])
	})

	test("without the seam thinking face says unavailable (the /btw contract)", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await coreCommands().find((c) => c.name === "/think")!.run(ctx, "")
		expect(ctx.lines).toEqual(["/think unavailable in this session"])
	})

	test("an empty ladder (model without efforts) says unavailable", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam)
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [],
				currentEffort: async () => undefined,
				selectEffort: () => {},
			},
		}
		await coreCommands().find((c) => c.name === "/think")!.run(ctx, "")
		expect(ctx.lines).toEqual(["/think unavailable: the current model exposes no reasoning efforts"])
	})

	test("esc or the current effort re-picked applies nothing", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, undefined)
		const applied: (string | undefined)[] = []
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [{ id: "high", name: "High" }],
				currentEffort: async () => "high",
				selectEffort: (effort) => {
					applied.push(effort)
				},
			},
		}
		await coreCommands().find((c) => c.name === "/think")!.run(ctx, "")
		expect(applied).toEqual([])
		expect(ctx.lines).toEqual([])
	})
})

describe("/hotkeys (batch F7b)", () => {
	test("prints the panel header plus generated rows from config/keybind Definitions", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await coreCommands().find((c) => c.name === "/hotkeys")!.run(ctx, "")
		expect(ctx.lines.length).toBeGreaterThan(3)
		expect(ctx.lines[0]).toContain("Keybinds")
		// A real binding from Definitions (config/keybind.ts), leader resolved.
		expect(ctx.lines).toContain("ctrl+c,ctrl+d,ctrl+x q — Exit the application (app.exit)")
		// `none`-bound definitions are skipped (no row carries a bare "none —").
		expect(ctx.lines.some((line) => line.startsWith("none —"))).toBe(false)
	})
})
