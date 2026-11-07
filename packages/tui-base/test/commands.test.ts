/**
 * Slash-command registry tests (batch 8): dispatch classification, the
 * harmless unknown row, and each core command's seam/hook call.
 */
import { describe, expect, test } from "bun:test"
import {
	agentsProfilesPatch,
	agentsRosterRows,
	coreCommands,
	dispatchLine,
	filterCommands,
	findAgentsProfile,
	findPresetRow,
	loadAgentsProfiles,
	presetNextRow,
	removeAgentsProfile,
	unknownCommandRow,
	upsertAgentsProfile,
	validateAgentsName,
	type AgentsProfile,
	type SlashCommandContext,
} from "../src/routes/session/commands"
import { emptyFilteredCopy } from "../src/routes/session/resume-picker"
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
		picks: [] as { title: string; headerLine?: string; options: { title: string; description?: string }[] }[],
	}
	const ctx: SlashCommandContext & { hooks: typeof hooks; lines: string[] } = {
		seam: seam.seam,
		say: (text) => lines.push(text),
		clear: () => hooks.cleared++,
		reload: () => hooks.reloaded++,
		quit: () => hooks.quit++,
		pickOne: async (title, options, headerLine) => {
			hooks.picks.push({ title, headerLine, options: options.map((o) => ({ title: o.title, description: o.description })) })
			return pickAnswer
		},
		hooks,
		lines,
	}
	return ctx
}


describe("batch H3: /search + /plugins panel", () => {
	test("/search without the overlay hook degrades to the notice", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await coreCommands().find((c) => c.name === "/search")!.run(ctx, "")
		expect(ctx.lines).toEqual(["/search unavailable in this session"])
	})

	test("/search with the hook opens the overlay (no transcript rows)", async () => {
		const ctx = makeCtx(new RecordingSeam())
		let opened = 0
		;(ctx as any).openSearch = () => {
			opened++
		}
		await coreCommands().find((c) => c.name === "/search")!.run(ctx, "")
		expect(opened).toBe(1)
		expect(ctx.lines).toEqual([])
	})

	test("/plugins with the panel hook opens the panel", async () => {
		const seam = new RecordingSeam()
		;(seam.seam as any).plugins = () => [{ name: "pkg-a", version: "1.0.0" }]
		const ctx = makeCtx(seam)
		let opened = 0
		;(ctx as any).openPlugins = () => {
			opened++
		}
		await coreCommands().find((c) => c.name === "/plugins")!.run(ctx, "")
		expect(opened).toBe(1)
		expect(ctx.lines).toEqual([])
	})

	test("/plugins without the panel hook keeps the F7a listing", async () => {
		const seam = new RecordingSeam()
		;(seam.seam as any).plugins = () => [{ name: "pkg-a", version: "1.0.0" }]
		const ctx = makeCtx(seam)
		await coreCommands().find((c) => c.name === "/plugins")!.run(ctx, "")
		expect(ctx.lines).toEqual(["● pkg-a@1.0.0"])
	})
})

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
			"/login",
			"/quit",
			"/sessions",
			"/clear",
			"/btw",
			"/session",
			"/plugins",
			"/search",
			"/agents",
			"/think",
			"/hotkeys",
			"/theme",
			"/preset",
		])
		expect(filterCommands(commands, "/cl").map((c) => c.name)).toEqual(["/clear"])
		expect(filterCommands(commands, "/pl").map((c) => c.name)).toEqual(["/plugins"])
		expect(filterCommands(commands, "/l").map((c) => c.name)).toEqual(["/login"])
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
			"/login — log in a provider (bare opens the picker; Custom provider opens the form)",
			"/quit — exit the app",
			"/sessions — list and resume stored sessions",
			"/clear — clear the transcript",
			"/btw — side question (bare reopens the last answer)",
			"/session — show session info (id, model, tokens, speed)",
			"/plugins — manage plugins (opens the panel)",
			"/search — full-text search over stored sessions",
			"/agents — model profiles: list / save / use / rm (named model+effort snapshots)",
			"/think — set reasoning effort (opens the picker)",
			"/hotkeys — show keybinds",
			"/theme — switch theme (opens the picker)",
			"/preset — switch agent preset (bare opens the picker, next rotates)",
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
		await coreCommands()[4]!.run(ctx, "")
		expect(ctx.hooks.quit).toBe(1)
		expect(ctx.lines).toEqual([])
	})

	test("/sessions lists, picks, resumes, reloads (aligned UPDATED/DIR rows)", async () => {
		const seam = new RecordingSeam()
		seam.sessions = [
			{ id: "s1", title: "first", updatedAt: "2026-01-01T00:00:00Z", cwd: "/repo/alpha" },
			{ id: "s2", title: "second" },
		]
		const ctx = makeCtx(seam, "s2")
		await coreCommands()[5]!.run(ctx, "")
		expect(seam.calls).toEqual(["listSessions", "resumeSession:s2"])
		const pick = ctx.hooks.picks[0]
		expect(pick?.title).toBe("Resume session")
		// G1 resume-picker: the fitted header line rides the optional third
		// pickOne arg and every row is the aligned `UPDATED  DIR  SESSION` shape.
		expect(pick?.headerLine).toMatch(/^UPDATED {2,}DIR {2,}SESSION$/)
		expect(pick?.options).toHaveLength(2)
		expect(pick?.options[0]?.title).toMatch(/d ago {2,}\/repo\/alpha {2,}first$/)
		expect(pick?.options[1]?.title).toMatch(/— {2,}— {2,}second$/)
		expect(pick?.options.map((o) => o.title.trim().split(/\s{2,}/).length)).toEqual([3, 3])
		expect(ctx.hooks.reloaded).toBe(1)
		expect(ctx.lines).toEqual(["resumed s2"])
	})

	test("/sessions applies the 1KB display floor with fail-open on unknown sizes", async () => {
		const seam = new RecordingSeam()
		seam.sessions = [
			{ id: "big", title: "big", sizeBytes: 25000, cwd: "/repo/big" },
			{ id: "tiny", title: "tiny", sizeBytes: 200, cwd: "/repo/tiny" },
			{ id: "unknown", title: "unknown" },
		]
		const ctx = makeCtx(seam, "big")
		await coreCommands()[5]!.run(ctx, "")
		const pick = ctx.hooks.picks[0]
		expect(pick?.options).toHaveLength(2)
		expect(pick?.options.map((o) => o.title.includes("big") || o.title.includes("unknown"))).toEqual([true, true])
		expect(ctx.lines).toEqual(["resumed big"])
	})

	test("/sessions reports the empty-FILTERED copy when the floor hides everything", async () => {
		const seam = new RecordingSeam()
		seam.sessions = [{ id: "stub", title: "stub", sizeBytes: 200 }]
		const ctx = makeCtx(seam)
		await coreCommands()[5]!.run(ctx, "")
		expect(ctx.hooks.picks).toEqual([])
		expect(ctx.lines).toEqual([emptyFilteredCopy(1)])
	})

	test("/sessions with no stored sessions says so (no picker)", async () => {
		const seam = new RecordingSeam()
		seam.sessions = []
		const ctx = makeCtx(seam)
		await coreCommands()[5]!.run(ctx, "")
		expect(ctx.hooks.picks).toEqual([])
		expect(ctx.lines).toEqual(["no stored sessions"])
	})

	test("/clear resets the transcript client-side and says so", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await coreCommands()[6]!.run(ctx, "")
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

// ------------------------------------------------------------ /preset (H2) --

describe("/preset rotation helpers (batch H2)", () => {
	const roster = [
		{ id: "standard", name: "Standard", isDefault: true },
		{ id: "ptc", name: "PTC" },
		{ id: "minimal", name: "Minimal" },
	]

	test("presetNextRow rotates with wrap after the current selection", () => {
		expect(presetNextRow(roster, "standard")?.id).toBe("ptc")
		expect(presetNextRow(roster, "ptc")?.id).toBe("minimal")
		expect(presetNextRow(roster, "minimal")?.id).toBe("standard")
	})

	test("presetNextRow with nothing current anchors on the default row, then the first", () => {
		expect(presetNextRow(roster, undefined)?.id).toBe("ptc")
		expect(presetNextRow([{ id: "solo", name: "Solo" }, { id: "duo", name: "Duo" }], undefined)?.id).toBe("duo")
	})

	test("presetNextRow with 0 or 1 rows has nothing to switch to", () => {
		expect(presetNextRow([], "standard")).toBeUndefined()
		expect(presetNextRow([{ id: "solo", name: "Solo" }], "solo")).toBeUndefined()
	})

	test("findPresetRow matches id or display name case-insensitively", () => {
		expect(findPresetRow(roster, "PTC")?.id).toBe("ptc")
		expect(findPresetRow(roster, "standard")?.id).toBe("standard")
		expect(findPresetRow(roster, "nope")).toBeUndefined()
		expect(findPresetRow(roster, "  ")).toBeUndefined()
	})
})

describe("/preset (batch H2, tui-pi 60-preset parity)", () => {
	const roster = [
		{ id: "standard", name: "Standard", isDefault: true },
		{ id: "ptc", name: "PTC", description: "batch tools" },
	]

	function presetSeam(overrides: {
		rows?: { id: string; name: string; description?: string; isDefault?: boolean }[]
		currentId?: string
		sessionAttached?: boolean
		pickAnswer?: string
	} = {}) {
		const seam = new RecordingSeam()
		const applied: string[] = []
		const face = {
			list: async () => overrides.rows ?? roster,
			currentId: async () => overrides.currentId,
			select: async (presetId: string) => {
				applied.push(presetId)
				return true
			},
		}
		const ctx = makeCtx(seam, overrides.pickAnswer)
		ctx.seam = {
			...seam.seam,
			preset: face,
			status: () => ({
				connection: "connected",
				turn: "idle",
				sessionAttached: overrides.sessionAttached ?? true,
			}),
		}
		return { ctx, applied }
	}

	const run = (ctx: ReturnType<typeof makeCtx>, arg = "") =>
		coreCommands().find((c) => c.name === "/preset")!.run(ctx, arg)

	test("without the seam preset face says unavailable (the /plugins contract)", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await run(ctx)
		expect(ctx.lines).toEqual(["/preset unavailable in this session"])
	})

	test("an empty roster degrades to the no-presets notice", async () => {
		const { ctx } = presetSeam({ rows: [] })
		await run(ctx)
		expect(ctx.lines).toEqual(["no agent presets available"])
	})

	test("bare opens the picker over the roster with the current row marked", async () => {
		const { ctx } = presetSeam({ currentId: "standard" })
		await run(ctx)
		expect(ctx.hooks.picks[0]?.title).toBe("Select agent preset")
		expect(ctx.hooks.picks[0]?.options).toEqual([
			{ title: "Standard", description: "current" },
			{ title: "PTC", description: "batch tools" },
		])
	})

	test("a picker pick confirms (live session), applies, reloads and reports", async () => {
		const { ctx, applied } = presetSeam({ currentId: "standard", sessionAttached: true })
		// Two dialogs in sequence: the roster picker answers "ptc", the
		// confirm dialog answers "switch".
		const answers = ["ptc", "switch"]
		ctx.pickOne = async (title, options, headerLine) => {
			ctx.hooks.picks.push({ title, headerLine, options: options.map((o) => ({ title: o.title, description: o.description })) })
			return answers.shift()
		}
		await run(ctx)
		expect(ctx.hooks.picks[1]?.title).toBe("Switch preset to PTC?")
		expect(applied).toEqual(["ptc"])
		expect(ctx.hooks.reloaded).toBe(1)
		expect(ctx.lines).toEqual(["preset → PTC (new session)"])
	})

	test("dialog cancel keeps everything as it was (no select, no reload)", async () => {
		const { ctx, applied } = presetSeam({ currentId: "standard", pickAnswer: "cancel" })
		await run(ctx)
		expect(applied).toEqual([])
		expect(ctx.hooks.reloaded).toBe(0)
		expect(ctx.lines).toEqual([])
	})

	test("re-picking the current preset applies nothing", async () => {
		const { ctx, applied } = presetSeam({ currentId: "standard", pickAnswer: "standard" })
		await run(ctx)
		expect(applied).toEqual([])
	})

	test("esc on the picker applies nothing", async () => {
		const { ctx, applied } = presetSeam({ currentId: "standard", pickAnswer: undefined })
		await run(ctx)
		expect(applied).toEqual([])
	})

	test("/preset next rotates with wrap and confirms before applying", async () => {
		const { ctx, applied } = presetSeam({ currentId: "ptc", pickAnswer: "switch" })
		await run(ctx, "next")
		expect(ctx.hooks.picks[0]?.title).toBe("Switch preset to Standard?")
		expect(ctx.hooks.picks[0]?.options).toEqual([
			{ title: "Switch to Standard" },
			{ title: "Cancel" },
		])
		expect(applied).toEqual(["standard"])
		expect(ctx.lines).toEqual(["preset → Standard (new session)"])
	})

	test("/preset next on a single-preset roster says there is nothing to switch to", async () => {
		const { ctx, applied } = presetSeam({ rows: [{ id: "solo", name: "Solo" }], currentId: "solo" })
		await run(ctx, "next")
		expect(ctx.lines).toEqual(["no other preset to switch to"])
		expect(applied).toEqual([])
	})

	test("/preset next on a fresh app (nothing attached) applies directly without the dialog", async () => {
		const { ctx, applied } = presetSeam({ currentId: "standard", sessionAttached: false })
		await run(ctx, "next")
		expect(ctx.hooks.picks).toEqual([])
		expect(applied).toEqual(["ptc"])
		expect(ctx.lines).toEqual(["preset → PTC (new session)"])
	})

	test("/preset <name> targets directly and rejects unknown names", async () => {
		const { ctx, applied } = presetSeam({ currentId: "standard", pickAnswer: "switch" })
		await run(ctx, "ptc")
		expect(applied).toEqual(["ptc"])

		const miss = presetSeam({ currentId: "standard" })
		await run(miss.ctx, "nope")
		expect(miss.ctx.lines).toEqual(["unknown preset: nope"])
		expect(miss.applied).toEqual([])
	})

	test("/preset <current> is a no-op notice, a failed select reports failure", async () => {
		const { ctx, applied } = presetSeam({ currentId: "ptc", pickAnswer: "switch" })
		await run(ctx, "ptc")
		expect(ctx.lines).toEqual(["preset already: PTC"])
		expect(applied).toEqual([])

		const seam = new RecordingSeam()
		const failCtx = makeCtx(seam, "switch")
		failCtx.seam = {
			...seam.seam,
			preset: {
				list: async () => roster,
				currentId: async () => "standard",
				select: async () => false,
			},
		}
		await run(failCtx, "ptc")
		expect(failCtx.lines).toEqual(["preset switch failed: PTC"])
	})
})

/** The H5 config faces: an in-memory profile config.json behind the seam. */
class AgentsSeam extends RecordingSeam {
	store: Record<string, unknown> = {}
	constructor() {
		super()
		;(this.seam as any).configLoad = () => JSON.parse(JSON.stringify(this.store))
		;(this.seam as any).configSave = (patch: Record<string, unknown>) => {
			this.calls.push("configSave")
			this.store = { ...this.store, ...patch }
			return JSON.parse(JSON.stringify(this.store))
		}
		;(this.seam as any).thinking = {
			efforts: async () => [
				{ id: "high", name: "High" },
				{ id: "low", name: "Low" },
			],
			currentEffort: async () => this.effort,
			selectEffort: (effort: string | undefined) => {
				this.calls.push(`selectEffort:${effort ?? "undefined"}`)
				this.effort = effort
			},
		}
	}
	effort: string | undefined = "high"
	roster(): AgentsProfile[] {
		return loadAgentsProfiles(this.store)
	}
}

describe("batch H5: /agents named model profiles", () => {
	test("absent config faces degrade to the unavailable notice", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await coreCommands().find((c) => c.name === "/agents")!.run(ctx, "")
		expect(ctx.lines).toEqual(["/agents unavailable in this session"])
	})

	test("bare on an empty roster prints the empty-roster row", async () => {
		const ctx = makeCtx(new AgentsSeam())
		await coreCommands().find((c) => c.name === "/agents")!.run(ctx, "")
		expect(ctx.lines).toEqual([
			"model profiles:",
			"no saved model profiles (/agents save <name> archives the current model)",
		])
	})

	test("save snapshots the current model route + effort through configSave", async () => {
		const seam = new AgentsSeam()
		const ctx = makeCtx(seam)
		await coreCommands().find((c) => c.name === "/agents")!.run(ctx, "save work")
		expect(seam.calls).toContain("configSave")
		expect(seam.roster()).toEqual([{ name: "work", provider: "bigmodel", model: "glm-5.3-flash", reasoningEffort: "high" }])
		expect(ctx.lines).toEqual(["saved profile work → bigmodel/glm-5.3-flash (high)"])
	})

	test("save over an existing name overwrites (upsert)", async () => {
		const seam = new AgentsSeam()
		const ctx = makeCtx(seam)
		const run = coreCommands().find((c) => c.name === "/agents")!.run.bind(null, ctx)
		await run("save work")
		await run("save work")
		expect(seam.roster()).toHaveLength(1)
	})

	test("save rejects a missing or invalid name", async () => {
		const seam = new AgentsSeam()
		const ctx = makeCtx(seam)
		await coreCommands().find((c) => c.name === "/agents")!.run(ctx, "save")
		expect(ctx.lines).toEqual(["usage: /agents save <name>"])
		const ctx2 = makeCtx(seam)
		await coreCommands().find((c) => c.name === "/agents")!.run(ctx2, "save bad name!")
		expect(ctx2.lines).toEqual(["profile name must be 1-32 chars: letters, digits, - _"])
	})

	test("bare lists the roster with the current route marked", async () => {
		const seam = new AgentsSeam()
		const ctx = makeCtx(seam)
		await coreCommands().find((c) => c.name === "/agents")!.run(ctx, "save work")
		const ctx2 = makeCtx(seam)
		await coreCommands().find((c) => c.name === "/agents")!.run(ctx2, "")
		expect(ctx2.lines).toEqual(["model profiles:", "● work — bigmodel/glm-5.3-flash (high)"])
	})

	test("use applies selectModel + the effort arm when the ladder carries it", async () => {
		const seam = new AgentsSeam()
		await coreCommands().find((c) => c.name === "/agents")!.run(makeCtx(seam), "save work")
		const ctx = makeCtx(seam)
		await coreCommands().find((c) => c.name === "/agents")!.run(ctx, "use work")
		expect(seam.calls).toContain("selectModel:bigmodel/glm-5.3-flash")
		expect(seam.calls).toContain("selectEffort:high")
		expect(ctx.lines).toEqual(["model → bigmodel/glm-5.3-flash (high) [profile work]"])
	})

	test("use with a stale effort skips the arm with a note (selectModel still rides)", async () => {
		const seam = new AgentsSeam()
		await coreCommands().find((c) => c.name === "/agents")!.run(makeCtx(seam), "save work")
		;(seam.seam as any).thinking.efforts = async () => [{ id: "low", name: "Low" }]
		const ctx = makeCtx(seam)
		await coreCommands().find((c) => c.name === "/agents")!.run(ctx, "use work")
		expect(seam.calls).toContain("selectModel:bigmodel/glm-5.3-flash")
		expect(seam.calls).not.toContain("selectEffort:high")
		expect(ctx.lines).toEqual(["model → bigmodel/glm-5.3-flash (effort high not on this model's ladder — skipped) [profile work]"])
	})

	test("use of an unknown profile is a harmless notice", async () => {
		const seam = new AgentsSeam()
		const ctx = makeCtx(seam)
		await coreCommands().find((c) => c.name === "/agents")!.run(ctx, "use nope")
		expect(ctx.lines).toEqual(["unknown profile: nope"])
		expect(seam.calls).not.toContain("configSave")
	})

	test("rm deletes the profile from the stored roster", async () => {
		const seam = new AgentsSeam()
		await coreCommands().find((c) => c.name === "/agents")!.run(makeCtx(seam), "save work")
		const ctx = makeCtx(seam)
		await coreCommands().find((c) => c.name === "/agents")!.run(ctx, "rm work")
		expect(ctx.lines).toEqual(["removed profile work"])
		expect(seam.roster()).toEqual([])
	})

	test("rm of an unknown profile is a harmless notice", async () => {
		const seam = new AgentsSeam()
		const ctx = makeCtx(seam)
		await coreCommands().find((c) => c.name === "/agents")!.run(ctx, "rm nope")
		expect(ctx.lines).toEqual(["unknown profile: nope"])
	})

	test("unknown verb prints usage", async () => {
		const seam = new AgentsSeam()
		const ctx = makeCtx(seam)
		await coreCommands().find((c) => c.name === "/agents")!.run(ctx, "frobnicate")
		expect(ctx.lines).toEqual(["usage: /agents [list | save <name> | use <name> | rm <name>]"])
	})
})

describe("agents profile store helpers (pure)", () => {
	test("loadAgentsProfiles degrades corrupt/wrong-shape docs to an empty roster", () => {
		expect(loadAgentsProfiles(undefined)).toEqual([])
		expect(loadAgentsProfiles({})).toEqual([])
		expect(loadAgentsProfiles({ agentsProfiles: "nope" })).toEqual([])
		expect(loadAgentsProfiles({ agentsProfiles: { profiles: [null, 3, { name: "x" }, { name: "ok", provider: "p", model: "m" }] } })).toEqual([
			{ name: "ok", provider: "p", model: "m" },
		])
	})

	test("upsert / remove / find / patch round-trip", () => {
		const a: AgentsProfile = { name: "work", provider: "p", model: "m" }
		const b: AgentsProfile = { name: "home", provider: "p2", model: "m2", reasoningEffort: "low" }
		const roster = upsertAgentsProfile(upsertAgentsProfile([], a), b)
		expect(roster.map((p) => p.name)).toEqual(["work", "home"])
		expect(findAgentsProfile(roster, "home")).toEqual(b)
		expect(upsertAgentsProfile(roster, { ...a, model: "m3" }).map((p) => p.model)).toEqual(["m3", "m2"])
		expect(removeAgentsProfile(roster, "work")).toEqual([b])
		expect(agentsProfilesPatch(roster)).toEqual({
			agentsProfiles: { version: 1, profiles: roster },
		})
	})

	test("validateAgentsName enforces transcript-safe slugs", () => {
		expect(validateAgentsName("work")).toBeUndefined()
		expect(validateAgentsName("a-b_9")).toBeUndefined()
		expect(validateAgentsName("")).toBeDefined()
		expect(validateAgentsName("bad name!")).toBeDefined()
		expect(validateAgentsName("x".repeat(33))).toBeDefined()
	})

	test("roster rows mark the current route and degrade to the empty row", () => {
		const profiles: AgentsProfile[] = [{ name: "work", provider: "bigmodel", model: "glm-5.3-flash", reasoningEffort: "high" }]
		expect(agentsRosterRows([], { providerID: "p", modelID: "m" })).toEqual([
			"no saved model profiles (/agents save <name> archives the current model)",
		])
		expect(agentsRosterRows(profiles, { providerID: "bigmodel", modelID: "glm-5.3-flash" })).toEqual([
			"● work — bigmodel/glm-5.3-flash (high)",
		])
		expect(agentsRosterRows(profiles, { providerID: "deepseek", modelID: "v3.2" })).toEqual([
			"○ work — bigmodel/glm-5.3-flash (high)",
		])
	})
})
