/**
 * Slash-command registry tests (batch 8): dispatch classification, the
 * harmless unknown row, and each core command's seam/hook call.
 */
import { describe, expect, test, beforeEach } from "bun:test"
import {
	MODEL_DEFAULT_EFFORT_PICK,
	coreCommands,
	dispatchLine,
	filterCommands,
	findPresetRow,
	presetLabelFor,
	presetNextRow,
	unknownCommandRow,
	type SlashCommandContext,
} from "../src/routes/session/commands"
import { emptyFilteredCopy } from "../src/routes/session/resume-picker"
import { getMotionTier, setMotionTier } from "../src/skin/motion"
import { footerHints, hintsLocale, setFooterHints, setHintsLocale, DEFAULT_FOOTER_HINTS, HINT_LOCALES } from "../src/routes/session/hints-line"
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
	/** C13: broken-log rows the client-local scan reports (default: none). */
	brokenLogs: { path: string; name: string; reason: string; sessionId?: string }[] = []
	/** C13: queued repair results; a missing entry defaults to repaired. */
	repairResults: ({ kind: "repaired"; backupPath: string } | { kind: "clean" } | { kind: "failed"; detail: string })[] = []
	/** C13: the log paths the repair actually received (the write gate). */
	repairCalls: string[] = []
	/** Fail-loud /resume: when set, listSessions rejects with this error. */
	listFailure: Error | undefined

	readonly seam: SessionSeam = {
		status: () => ({ connection: "connected", turn: "idle", sessionAttached: true }),
		listSessions: async () => {
			this.calls.push("listSessions")
			if (this.listFailure) throw this.listFailure
			return this.sessions
		},
		searchSessions: async () => [],
		storedTranscript: async () => [],
		currentSessionId: () => "s-current",
		resumeSession: (id) => {
			this.calls.push(`resumeSession:${id}`)
			return "ok"
		},
		// C13 /resume repair flow (optional seam members): the scan rides
		// brokenLogs (empty by default → the repair-free behavior every
		// pre-existing test asserts), the repair records its calls — the
		// assertion "no confirm, no write" reads these.
		repairScanBroken: () => this.brokenLogs,
		repairSessionLog: (path) => {
			this.repairCalls.push(path)
			return this.repairResults.shift() ?? { kind: "repaired" as const, backupPath: `${path}.corrupt-bak` }
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
		selectModel: async (providerID, modelID) => {
			this.calls.push(`selectModel:${providerID}/${modelID}`)
		},
		usageSummary: () => [],
		agents: {
			list: () => [],
			set: () => ({ target: { kind: "frontmatter" } as const }),
			body: () => "",
			modelEfforts: async () => [],
		},
		onSessionEvent: () => () => {},
		dispose: async () => {},
	}
}

function makeCtx(seam: RecordingSeam, pickAnswer?: string | (string | undefined)[]) {
	const lines: string[] = []
	const hooks = {
		cleared: 0,
		reloaded: 0,
		/** The session id each reload was told to read (undefined = live one). */
		reloadIds: [] as (string | undefined)[],
		quit: 0,
		footerRefreshes: 0,
		footerInvalidations: 0,
		picks: [] as {
			title: string
			headerLine?: string
			currentValue?: string
			options: { title: string; description?: string }[]
		}[],
	}
	const ctx: SlashCommandContext & { hooks: typeof hooks; lines: string[] } = {
		seam: seam.seam,
		say: (text) => lines.push(text),
		clear: () => hooks.cleared++,
		reload: (sessionId?: string) => {
			hooks.reloaded++
			hooks.reloadIds.push(sessionId)
		},
		quit: () => hooks.quit++,
		refreshFooter: () => hooks.footerRefreshes++,
		invalidateFooter: () => hooks.footerInvalidations++,
		pickOne: async (title, options, headerLine, currentValue) => {
			hooks.picks.push({
				title,
				headerLine,
				currentValue,
				options: options.map((o) => ({ title: o.title, description: o.description })),
			})
			// An array answer is a per-stage queue (the /model two-stage flow:
			// stage 1's model pick, then stage 2's effort pick or esc).
			if (Array.isArray(pickAnswer)) return pickAnswer.shift()
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
		// "/se" matches /session, /search and /settings; the longest wins.
		const result = dispatchLine(commands, "/se")
		expect(result.kind).toBe("command")
		if (result.kind === "command") expect(result.command.name).toBe("/settings")
		// "/sess" narrows back to /session.
		const session = dispatchLine(commands, "/sess")
		if (session.kind === "command") expect(session.command.name).toBe("/session")
		// "/res" only has one match since the rename.
		const resume = dispatchLine(commands, "/res")
		if (resume.kind === "command") expect(resume.command.name).toBe("/resume")
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
			"/logout",
			"/quit",
			"/resume",
			"/clear",
			"/flush",
			"/btw",
			"/session",
			"/plugins",
			"/search",
			"/agents",
			"/settings",
			"/history",
			"/think",
			"/hints",
			"/motion",
			"/hotkeys",
			"/theme",
			"/preset",
		])
		expect(filterCommands(commands, "/cl").map((c) => c.name)).toEqual(["/clear"])
		expect(filterCommands(commands, "/pl").map((c) => c.name)).toEqual(["/plugins"])
		expect(filterCommands(commands, "/l").map((c) => c.name)).toEqual(["/login", "/logout"])
		expect(filterCommands(commands, "/logo").map((c) => c.name)).toEqual(["/logout"])
	})
})

describe("core commands", () => {
	test("/help lists the table", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await coreCommands()[0]!.run(ctx, "")
		expect(ctx.lines).toEqual([
			"/help — show available commands",
			"/new — start a fresh session",
			"/model — switch model (bare opens the picker, then the effort picker)",
			"/login — log in a provider (bare opens the picker; Custom provider opens the form)",
			"/logout — log out a provider (drops the stored key)",
			"/quit — exit the app",
			"/resume — resume a persisted session",
			"/clear — clear the transcript",
			"/flush — deliver the queued prompts now",
			"/btw — side question (bare reopens the last answer)",
			"/session — show session info (id, model, tokens, speed)",
			"/plugins — manage plugins (opens the panel)",
			"/search — full-text search over stored sessions",
			"/agents — manage agent definitions (model, think level, spawn depth) from markdown files",
			"/settings — settings: local preferences, host settings, other namespaces",
			"/history — browse completed turns of the session (refill, switch, fork)",
			"/think — set reasoning effort (opens the picker)",
			"/hints — key hints: toggle bar; <segment> on|off; all on|off; lang <locale>",
			"/motion — animation tier: full | reduced | off | auto (bare shows setting → effective)",
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
		// Two-stage /model (research/model-picker-think-level.md): this fake
		// seam carries NO thinking face — the optional-`effortsFor` degrade
		// arm — so stage 2 is skipped with the merged notice line.
		expect(ctx.hooks.picks).toHaveLength(1)
		expect(ctx.lines).toEqual(["model → deepseek/v3.2 (no think levels)"])
		// Footer-quickwins bug fix: the pick re-runs the page's footer refresh
		// after the selection settles (the provider/model segment moves now,
		// not at the next turn boundary).
		expect(ctx.hooks.footerRefreshes).toBe(1)
	})

	test("/model bare with esc resolves without selecting", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, undefined)
		await coreCommands()[2]!.run(ctx, "")
		expect(seam.calls).not.toContain("selectModel:deepseek/v3.2")
		expect(ctx.lines).toEqual([])
		expect(ctx.hooks.footerRefreshes).toBe(0)
	})

	test("/model provider/model selects directly (no picker)", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam)
		await coreCommands()[2]!.run(ctx, "bigmodel/glm-5.3-flash")
		expect(seam.calls).toEqual(["selectModel:bigmodel/glm-5.3-flash"])
		expect(ctx.hooks.picks).toEqual([])
		expect(ctx.hooks.footerRefreshes).toBe(1)
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
		await coreCommands()[5]!.run(ctx, "")
		expect(ctx.hooks.quit).toBe(1)
		expect(ctx.lines).toEqual([])
	})

	test("/resume lists, picks, resumes, reloads (aligned UPDATED/DIR rows)", async () => {
		const seam = new RecordingSeam()
		seam.sessions = [
			{ id: "s1", title: "first", updatedAt: "2026-01-01T00:00:00Z", cwd: "/repo/alpha" },
			{ id: "s2", title: "second" },
		]
		const ctx = makeCtx(seam, "s2")
		await coreCommands()[6]!.run(ctx, "")
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
		// Transcript-loss regression: the reload MUST name the picked session.
		// resumeSession only stages the id (the seam's live id is undefined
		// until the next turn), so an unnamed reload read "" and emptied the
		// transcript.
		expect(ctx.hooks.reloadIds).toEqual(["s2"])
		expect(ctx.lines).toEqual(["resumed s2"])
	})

	test("/new clears the transcript explicitly, then reloads the fresh (empty) session", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam)
		await coreCommands()[1]!.run(ctx, "")
		expect(seam.calls).toContain("newSession")
		// A fresh session has no history; the wipe is explicit (the old code
		// relied on an errored "" read — the transcript-loss bug).
		expect(ctx.hooks.cleared).toBe(1)
		expect(ctx.hooks.reloadIds).toEqual([undefined])
	})

	test("/resume applies the 1KB display floor with fail-open on unknown sizes", async () => {
		const seam = new RecordingSeam()
		seam.sessions = [
			{ id: "big", title: "big", sizeBytes: 25000, cwd: "/repo/big" },
			{ id: "tiny", title: "tiny", sizeBytes: 200, cwd: "/repo/tiny" },
			{ id: "unknown", title: "unknown" },
		]
		const ctx = makeCtx(seam, "big")
		await coreCommands()[6]!.run(ctx, "")
		const pick = ctx.hooks.picks[0]
		expect(pick?.options).toHaveLength(2)
		expect(pick?.options.map((o) => o.title.includes("big") || o.title.includes("unknown"))).toEqual([true, true])
		expect(ctx.lines).toEqual(["resumed big"])
	})

	test("/resume reports the empty-FILTERED copy when the floor hides everything", async () => {
		const seam = new RecordingSeam()
		seam.sessions = [{ id: "stub", title: "stub", sizeBytes: 200 }]
		const ctx = makeCtx(seam)
		await coreCommands()[6]!.run(ctx, "")
		expect(ctx.hooks.picks).toEqual([])
		expect(ctx.lines).toEqual([emptyFilteredCopy(1)])
	})

	test("/resume with no stored sessions says so (no picker)", async () => {
		const seam = new RecordingSeam()
		seam.sessions = []
		const ctx = makeCtx(seam)
		await coreCommands()[6]!.run(ctx, "")
		expect(ctx.hooks.picks).toEqual([])
		expect(ctx.lines).toEqual(["no stored sessions"])
	})

	test("/resume reports a failing store list as an error, never 'no stored sessions'", async () => {
		// The list must fail loud: a dead seam / an adopted host without the
		// session/list route used to flatten to [] and print the lie "no
		// stored sessions" while the store had rows (02e1608 logout parity).
		const seam = new RecordingSeam()
		seam.listFailure = new Error("host does not serve session/list")
		const ctx = makeCtx(seam)
		await coreCommands()[6]!.run(ctx, "")
		expect(ctx.hooks.picks).toEqual([])
		expect(ctx.lines).toEqual(["resume unavailable — host does not serve session/list"])
	})

	test("/clear resets the transcript client-side and says so", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await coreCommands()[7]!.run(ctx, "")
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
		// α skin layer: the active row rides the `currentValue` marker slot
		// (the vendored `●`), not a description; no mode face → no mode rows.
		expect(ctx.hooks.picks[0]?.options).toEqual([
			{ title: "github-dark" },
			{ title: "github-light" },
			{ title: "opencode" },
		])
		expect(ctx.hooks.picks[0]?.currentValue).toBe("opencode")
		expect(applied).toEqual(["github-light"])
		expect(ctx.lines).toEqual(["Theme: github-light — applied"])
	})

	test("/theme with a mode face appends the auto/dark/light rows and applies the pick (α skin layer)", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, "mode:light")
		const modes: string[] = []
		ctx.themes = {
			current: () => "opencode",
			list: () => ["opencode"],
			set: () => false,
			mode: () => ({
				current: () => "auto",
				set: (mode) => {
					modes.push(mode)
					return true
				},
			}),
		}
		await coreCommands().find((c) => c.name === "/theme")!.run(ctx, "")
		expect(ctx.hooks.picks[0]?.options).toEqual([
			{ title: "opencode" },
			{ title: "mode: auto", description: "follow the terminal (default)" },
			{ title: "mode: dark", description: "always dark" },
			{ title: "mode: light", description: "always light" },
		])
		expect(modes).toEqual(["light"])
		expect(ctx.lines).toEqual(["Theme mode: light"])
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
				selectEffort: async (effort) => {
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
		// Footer-quickwins bug fix: the pick re-runs the page's footer refresh
		// (tui-pi footer parity — the effort segment moves NOW, not at the
		// next turn boundary).
		expect(ctx.hooks.footerRefreshes).toBe(1)
	})

	test("footer refresh waits for the seam's selectEffort acceptance (no stale-race refresh)", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, "low")
		let releaseEffort: (() => void) | undefined
		const applied: (string | undefined)[] = []
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [{ id: "low", name: "Low" }, { id: "high", name: "High" }],
				currentEffort: async () => "high",
				selectEffort: (effort) =>
					new Promise<void>((resolve) => {
						applied.push(effort)
						releaseEffort = resolve
					}),
			},
		}
		const run = coreCommands().find((c) => c.name === "/think")!.run(ctx, "")
		// The host acceptance is pending: no refresh may fire yet (the refresh
		// would read the OLD effort back off currentEffort and pin it).
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(applied).toEqual(["low"])
		expect(ctx.hooks.footerRefreshes).toBe(0)
		releaseEffort!()
		await run
		expect(ctx.hooks.footerRefreshes).toBe(1)
	})

	test("without the seam thinking face says unavailable (the /btw contract)", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await coreCommands().find((c) => c.name === "/think")!.run(ctx, "")
		expect(ctx.lines).toEqual(["/think unavailable in this session"])
		expect(ctx.hooks.footerRefreshes).toBe(0)
	})

	test("an empty ladder (model without efforts) says unavailable", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam)
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [],
				currentEffort: async () => undefined,
				selectEffort: async () => {},
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
				selectEffort: async (effort) => {
					applied.push(effort)
				},
			},
		}
		await coreCommands().find((c) => c.name === "/think")!.run(ctx, "")
		expect(applied).toEqual([])
		expect(ctx.lines).toEqual([])
		expect(ctx.hooks.footerRefreshes).toBe(0)
		expect(ctx.hooks.footerInvalidations).toBe(0)
	})

	// Review 3.5: the ordinal invalidation must fire BEFORE the host accepts
	// the pick. A refreshFooterData chain from the previous turn end still
	// holds the current ordinal while the pick is in flight; its pending
	// default-effort write would otherwise flip the user's `off` back to high.
	test("invalidates the footer BEFORE accepting the pick, then refreshes (3.5)", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, "off")
		const order: string[] = []
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [
					{ id: "off", name: "Off" },
					{ id: "high", name: "High" },
				],
				currentEffort: async () => undefined,
				selectEffort: async (effort) => {
					order.push(`select:${effort}`)
				},
			},
		}
		ctx.invalidateFooter = () => order.push("invalidate")
		ctx.refreshFooter = () => order.push("refresh")
		await coreCommands().find((c) => c.name === "/think")!.run(ctx, "")
		expect(order).toEqual(["invalidate", "select:off", "refresh"])
		expect(ctx.lines).toEqual(["thinking → off (next turn)"])
	})
})

describe("/model two-stage think level (one transaction, tui-pi parity)", () => {
	test("a pick on a laddered model commits nothing at stage 1; the effort-stage confirm commits model then effort", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, ["deepseek/v3.2", "low"])
		const applied: (string | undefined)[] = []
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [],
				effortsFor: async (providerID, modelID) => {
					// Rides the spy transcript so the stage-1 → ladder-read →
					// commit order is provable: the ladder read lands BEFORE
					// any selectModel (stage 1 must not commit).
					seam.calls.push(`effortsFor:${providerID}/${modelID}`)
					return [
						{ id: "low", name: "Low" },
						{ id: "high", name: "High" },
					]
				},
				currentEffort: async () => undefined,
				selectEffort: async (effort) => {
					seam.calls.push(`selectEffort:${effort ?? "undefined"}`)
					applied.push(effort)
				},
			},
		}
		await coreCommands()[2]!.run(ctx, "")
		// The whole selection is one deferred transaction: no selectModel at
		// the stage-1 boundary; the commit lands model-first, effort-second.
		expect(seam.calls).toEqual([
			"modelCatalog",
			"currentModelSelection",
			"effortsFor:deepseek/v3.2",
			"selectModel:deepseek/v3.2",
			"selectEffort:low",
		])
		expect(ctx.hooks.picks).toHaveLength(2)
		expect(ctx.hooks.picks[0]?.title).toBe("Select model")
		expect(ctx.hooks.picks[1]?.title).toBe("Select reasoning effort — deepseek/v3.2")
		expect(ctx.hooks.picks[1]?.options).toEqual([
			{ title: "(model default)" },
			{ title: "Low" },
			{ title: "High" },
		])
		expect(applied).toEqual(["low"])
		expect(ctx.lines).toEqual(["model → deepseek/v3.2", "thinking → low (next turn)"])
		// One commit point: invalidate BEFORE the acceptance, one refresh
		// after (the /think sequence).
		expect(ctx.hooks.footerInvalidations).toBe(1)
		expect(ctx.hooks.footerRefreshes).toBe(1)
	})

	test("esc on the effort stage abandons the whole selection (no model commit, no effort write)", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, ["deepseek/v3.2", undefined])
		const applied: (string | undefined)[] = []
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [],
				effortsFor: async (providerID, modelID) => {
					seam.calls.push(`effortsFor:${providerID}/${modelID}`)
					return [{ id: "low", name: "Low" }]
				},
				currentEffort: async () => undefined,
				selectEffort: async (effort) => {
					applied.push(effort)
				},
			},
		}
		await coreCommands()[2]!.run(ctx, "")
		// Stage 2 DID open (two picks) but esc resolved it: the tui-pi
		// contract (selectors.ts:508-513) is esc = abandon the WHOLE pick —
		// stage 1 never committed, so the model is NOT switched and the
		// effort face is untouched.
		expect(ctx.hooks.picks).toHaveLength(2)
		expect(seam.calls).toEqual(["modelCatalog", "currentModelSelection", "effortsFor:deepseek/v3.2"])
		expect(applied).toEqual([])
		expect(ctx.lines).toEqual(["model unchanged"])
		expect(ctx.hooks.footerRefreshes).toBe(0)
		expect(ctx.hooks.footerInvalidations).toBe(0)
	})

	test("esc on the model stage does nothing (no commit, no stage 2)", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, undefined)
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [],
				effortsFor: async () => [{ id: "low", name: "Low" }],
				currentEffort: async () => undefined,
				selectEffort: async () => {},
			},
		}
		await coreCommands()[2]!.run(ctx, "")
		// Stage-1 esc keeps the old no-op behavior: no ladder read, no
		// commit, no transcript line.
		expect(ctx.hooks.picks).toHaveLength(1)
		expect(seam.calls).toEqual(["modelCatalog", "currentModelSelection"])
		expect(ctx.lines).toEqual([])
	})

	test("a model with an empty ladder skips the effort stage and commits immediately", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, "deepseek/v3.2")
		const applied: (string | undefined)[] = []
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [],
				effortsFor: async (providerID, modelID) => {
					seam.calls.push(`effortsFor:${providerID}/${modelID}`)
					return []
				},
				currentEffort: async () => undefined,
				selectEffort: async (effort) => {
					applied.push(effort)
				},
			},
		}
		await coreCommands()[2]!.run(ctx, "")
		// No stage 2 exists → the model pick is the whole transaction: it
		// commits right away (the pre-two-stage behavior).
		expect(ctx.hooks.picks).toHaveLength(1)
		expect(seam.calls).toEqual(["modelCatalog", "currentModelSelection", "effortsFor:deepseek/v3.2", "selectModel:deepseek/v3.2"])
		expect(applied).toEqual([])
		expect(ctx.lines).toEqual(["model → deepseek/v3.2 (no think levels)"])
		expect(ctx.hooks.footerRefreshes).toBe(1)
	})

	test("a same-provider pick on a ladder-less model carries the current effort (tui-pi selectors.ts:489-498)", async () => {
		const seam = new RecordingSeam()
		seam.catalog = [
			{ providerID: "bigmodel", modelID: "glm-5.3-flash" },
			{ providerID: "bigmodel", modelID: "no-think" },
		]
		const ctx = makeCtx(seam, "bigmodel/no-think")
		const applied: (string | undefined)[] = []
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [],
				effortsFor: async (providerID, modelID) => {
					seam.calls.push(`effortsFor:${providerID}/${modelID}`)
					return []
				},
				currentEffort: async () => {
					seam.calls.push("currentEffort")
					return "high"
				},
				selectEffort: async (effort) => {
					seam.calls.push(`selectEffort:${effort ?? "undefined"}`)
					applied.push(effort)
				},
			},
		}
		await coreCommands()[2]!.run(ctx, "")
		// The kept effort is read off the pre-commit snapshot BEFORE the
		// model write, then re-asserted on top of the new route — the tui-pi
		// fallback resolve's conditional reasoningEffort arm.
		expect(seam.calls).toEqual([
			"modelCatalog",
			"currentModelSelection",
			"effortsFor:bigmodel/no-think",
			"currentEffort",
			"selectModel:bigmodel/no-think",
			"selectEffort:high",
		])
		expect(applied).toEqual(["high"])
		expect(ctx.lines).toEqual([
			"model → bigmodel/no-think (no think levels)",
			"thinking → high (next turn)",
		])
		expect(ctx.hooks.footerRefreshes).toBe(1)
	})

	test("a cross-provider pick on a ladder-less model never consults or carries the effort (tui-pi resets across providers)", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, "deepseek/v3.2")
		const applied: (string | undefined)[] = []
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [],
				effortsFor: async (providerID, modelID) => {
					seam.calls.push(`effortsFor:${providerID}/${modelID}`)
					return []
				},
				currentEffort: async () => "high",
				selectEffort: async (effort) => {
					applied.push(effort)
				},
			},
		}
		await coreCommands()[2]!.run(ctx, "")
		// Current is bigmodel/glm-5.3-flash, the pick is deepseek/v3.2: the
		// effort is dropped — `currentEffort` is never consulted (absent
		// from the transcript) and no effort write rides the commit.
		expect(seam.calls).toEqual([
			"modelCatalog",
			"currentModelSelection",
			"effortsFor:deepseek/v3.2",
			"selectModel:deepseek/v3.2",
		])
		expect(applied).toEqual([])
		expect(ctx.lines).toEqual(["model → deepseek/v3.2 (no think levels)"])
	})

	test("a failed ladder read degrades to the immediate single-stage commit", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, "deepseek/v3.2")
		const applied: (string | undefined)[] = []
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [],
				effortsFor: async () => {
					throw new Error("catalog read blew up")
				},
				currentEffort: async () => undefined,
				selectEffort: async (effort) => {
					applied.push(effort)
				},
			},
		}
		await coreCommands()[2]!.run(ctx, "")
		expect(seam.calls).toContain("selectModel:deepseek/v3.2")
		expect(ctx.hooks.picks).toHaveLength(1)
		expect(applied).toEqual([])
		expect(ctx.lines).toEqual(["model → deepseek/v3.2 (no think levels)"])
	})

	test("the (model default) row commits the model and clears the override via selectEffort(undefined)", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, ["deepseek/v3.2", MODEL_DEFAULT_EFFORT_PICK])
		const applied: (string | undefined)[] = []
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [],
				effortsFor: async (providerID, modelID) => {
					seam.calls.push(`effortsFor:${providerID}/${modelID}`)
					return [{ id: "low", name: "Low" }, { id: "high", name: "High" }]
				},
				currentEffort: async () => undefined,
				selectEffort: async (effort) => {
					seam.calls.push(`selectEffort:${effort ?? "undefined"}`)
					applied.push(effort)
				},
			},
		}
		await coreCommands()[2]!.run(ctx, "")
		expect(ctx.hooks.picks[1]?.options[0]?.title).toBe("(model default)")
		expect(seam.calls).toEqual([
			"modelCatalog",
			"currentModelSelection",
			"effortsFor:deepseek/v3.2",
			"selectModel:deepseek/v3.2",
			"selectEffort:undefined",
		])
		expect(applied).toEqual([undefined])
		expect(ctx.lines).toEqual(["model → deepseek/v3.2", "thinking → model default (next turn)"])
	})

	test("the effort stage marks the model's current rung with the current marker", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, ["deepseek/v3.2", "high"])
		const applied: (string | undefined)[] = []
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [],
				effortsFor: async () => [{ id: "low", name: "Low" }, { id: "high", name: "High" }],
				currentEffort: async () => "low",
				selectEffort: async (effort) => {
					applied.push(effort)
				},
			},
		}
		await coreCommands()[2]!.run(ctx, "")
		expect(ctx.hooks.picks[1]?.options).toEqual([
			{ title: "(model default)" },
			{ title: "Low", description: "current" },
			{ title: "High" },
		])
		expect(applied).toEqual(["high"])
	})

	test("the provider/model argument form stays one-shot (no effort stage)", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, ["unused-answer"])
		const ladderReads: string[] = []
		const applied: (string | undefined)[] = []
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [],
				effortsFor: async (providerID, modelID) => {
					ladderReads.push(`${providerID}/${modelID}`)
					return [{ id: "low", name: "Low" }]
				},
				currentEffort: async () => undefined,
				selectEffort: async (effort) => {
					applied.push(effort)
				},
			},
		}
		await coreCommands()[2]!.run(ctx, "deepseek/v3.2")
		expect(seam.calls).toEqual(["selectModel:deepseek/v3.2"])
		expect(ctx.hooks.picks).toEqual([])
		expect(ladderReads).toEqual([])
		expect(applied).toEqual([])
		expect(ctx.lines).toEqual(["model → deepseek/v3.2"])
		expect(ctx.hooks.footerRefreshes).toBe(1)
	})
})

describe("model/effort failure surfacing (a rejected RPC never echoes success)", () => {
	test("/model provider/model: a rejected selectModel prints the failure line, no success echo, footer untouched", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam)
		ctx.seam = {
			...seam.seam,
			selectModel: async (providerID, modelID) => {
				seam.calls.push(`selectModel:${providerID}/${modelID}`)
				throw new Error("provider unreachable")
			},
		}
		await coreCommands()[2]!.run(ctx, "deepseek/v3.2")
		expect(seam.calls).toEqual(["selectModel:deepseek/v3.2"])
		// the failure line, not the acceptance echo
		expect(ctx.lines).toEqual(["model switch failed — provider unreachable"])
		expect(ctx.hooks.footerRefreshes).toBe(0)
		expect(ctx.hooks.footerInvalidations).toBe(0)
	})

	test("/model two-stage: a rejected model commit abandons the whole transaction (no effort write on the old route)", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, ["deepseek/v3.2", "low"])
		const applied: (string | undefined)[] = []
		ctx.seam = {
			...seam.seam,
			selectModel: async () => {
				throw new Error("host refused the route")
			},
			thinking: {
				efforts: async () => [],
				effortsFor: async () => [{ id: "low", name: "Low" }],
				currentEffort: async () => undefined,
				selectEffort: async (effort) => {
					applied.push(effort)
				},
			},
		}
		await coreCommands()[2]!.run(ctx, "")
		// stage 1 stays pick-only; the commit rejection ends the transaction
		// BEFORE the effort arm rides the OLD route
		expect(ctx.hooks.picks).toHaveLength(2)
		expect(seam.calls).toEqual(["modelCatalog", "currentModelSelection"])
		expect(applied).toEqual([])
		expect(ctx.lines).toEqual(["model switch failed — host refused the route"])
		// review 3.5 ordering is kept (the ordinal bump precedes the commit),
		// but the footer is never refreshed with an acceptance that never was
		expect(ctx.hooks.footerInvalidations).toBe(1)
		expect(ctx.hooks.footerRefreshes).toBe(0)
	})

	test("/think: a rejected selectEffort prints the failure line, no thinking echo, footer untouched", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, "low")
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [{ id: "low", name: "Low" }, { id: "high", name: "High" }],
				currentEffort: async () => "high",
				selectEffort: async () => {
					throw new Error("host refused the effort")
				},
			},
		}
		await coreCommands().find((c) => c.name === "/think")!.run(ctx, "")
		expect(ctx.lines).toEqual(["thinking switch failed — host refused the effort"])
		// 3.5 ordering kept, but no refresh pins the old effort as if accepted
		expect(ctx.hooks.footerInvalidations).toBe(1)
		expect(ctx.hooks.footerRefreshes).toBe(0)
	})

	test("/model two-stage: an effort rejection after an ACCEPTED model keeps the model success line", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, ["deepseek/v3.2", "low"])
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [],
				effortsFor: async () => [{ id: "low", name: "Low" }],
				currentEffort: async () => undefined,
				selectEffort: async () => {
					throw new Error("host refused the effort")
				},
			},
		}
		await coreCommands()[2]!.run(ctx, "")
		// the model commit was real (its echo stays), the effort arm failed
		// (its echo is replaced by the failure line); the footer refresh is
		// legitimate — the model segment really moved
		expect(ctx.lines).toEqual(["model → deepseek/v3.2", "thinking switch failed — host refused the effort"])
		expect(ctx.hooks.footerRefreshes).toBe(1)
	})

	test("/model surfaces a pending lastSelectionError note (the staged re-send failure) before the pick", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam)
		ctx.seam = {
			...seam.seam,
			lastSelectionError: () => "staged deepseek/deepseek-reasoner — host refused",
		}
		await coreCommands()[2]!.run(ctx, "deepseek/v3.2")
		// the previously-silent staged re-send failure is reported, then the
		// fresh pick proceeds on its own merits
		expect(ctx.lines).toEqual([
			"model note: the last staged switch failed — staged deepseek/deepseek-reasoner — host refused",
			"model → deepseek/v3.2",
		])
		expect(ctx.hooks.footerRefreshes).toBe(1)
	})

	test("success paths keep their original echoes (regression guard)", async () => {
		const seam = new RecordingSeam()
		const ctx = makeCtx(seam, "low")
		ctx.seam = {
			...seam.seam,
			thinking: {
				efforts: async () => [{ id: "low", name: "Low" }],
				currentEffort: async () => undefined,
				selectEffort: async () => {},
			},
		}
		await coreCommands().find((c) => c.name === "/think")!.run(ctx, "")
		expect(ctx.lines).toEqual(["thinking → low (next turn)"])
		expect(ctx.hooks.footerRefreshes).toBe(1)
		await coreCommands()[2]!.run(ctx, "deepseek/v3.2")
		expect(ctx.lines).toEqual(["thinking → low (next turn)", "model → deepseek/v3.2"])
		expect(ctx.hooks.footerRefreshes).toBe(2)
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

	test("presetLabelFor reads the current row, else the default/standard/first anchor (tui-pi formatPresetLabel)", () => {
		// current wins
		expect(presetLabelFor(roster, "ptc")).toBe("PTC")
		// boot: nothing staged/attached → the registry-default row (the preset
		// the next session composes) instead of a blank brand segment
		expect(presetLabelFor(roster, undefined)).toBe("Standard")
		// A staged id that names no listed row (a broken row was filtered out,
		// or the preset was deleted) is NOT the default row: the live session
		// is not composed with anything we can name, so the brand stays the
		// plain "dsh" instead of a misleading default label.
		expect(presetLabelFor(roster, "gone")).toBeUndefined()
		// The roster itself answers the same way once it lists no rows.
		expect(presetLabelFor([], "gone")).toBeUndefined()
		// no isDefault mark → the standard entry, then the first-listed row
		expect(presetLabelFor([{ id: "ptc", name: "PTC" }, { id: "standard", name: "Standard" }], undefined)).toBe("Standard")
		expect(presetLabelFor([{ id: "solo", name: "Solo" }], undefined)).toBe("Solo")
		// no roster → the brand segment stays the plain "dsh"
		expect(presetLabelFor([], undefined)).toBeUndefined()
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

describe("batch H5 replacement: /agents opens the definition manager", () => {
	const run = coreCommands().find((command) => command.name === "/agents")!.run

	test("a seam without the agents face degrades to the unavailable notice", async () => {
		const ctx = makeCtx(new RecordingSeam())
		ctx.seam = { ...ctx.seam, agents: undefined }
		await run(ctx, "")
		expect(ctx.lines).toEqual(["/agents unavailable in this session"])
	})

	test("bare opens the panel with no preselect; an argument passes the exact name", async () => {
		const opened: (string | undefined)[] = []
		const ctx = makeCtx(new RecordingSeam())
		ctx.openAgents = (name?: string) => opened.push(name)
		await run(ctx, "")
		await run(ctx, "  workhorse  ")
		expect(opened).toEqual([undefined, "workhorse"])
	})

	test("the panel hook is required (an entry without the mount gets a notice)", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await run(ctx, "workhorse")
		expect(ctx.lines).toEqual(["/agents: the manager panel is not mounted in this entry"])
	})
})

describe("queue flush: /flush restarts the paused delivery pump", () => {
	const run = coreCommands().find((command) => command.name === "/flush")!.run

	test("a host without a client-side queue degrades to the unavailable notice", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await run(ctx, "")
		expect(ctx.lines).toEqual(["/flush unavailable in this session"])
	})

	test("an empty queue reports the no-op instead of staying silent", async () => {
		const ctx = makeCtx(new RecordingSeam())
		ctx.flushQueue = () => ({ kind: "empty", started: 0, remaining: 0 })
		await run(ctx, "")
		expect(ctx.lines).toEqual(["queue is empty — nothing to flush"])
	})

	test("a running turn leaves the queue to its turn end", async () => {
		const ctx = makeCtx(new RecordingSeam())
		ctx.flushQueue = () => ({ kind: "busy", started: 0, remaining: 2 })
		await run(ctx, "")
		expect(ctx.lines).toEqual(["a turn is running — 2 queued prompt(s) wait for it to finish"])
	})

	test("a paused queue starts its head and reports the tail", async () => {
		const ctx = makeCtx(new RecordingSeam())
		ctx.flushQueue = () => ({ kind: "flushed", started: 1, remaining: 1 })
		await run(ctx, "")
		expect(ctx.lines).toEqual(["queue flushed — 1 prompt(s) sending now, 1 still queued"])
	})
})

/** Config seam fake for the commands that persist footer settings. */
class ConfigSeam extends RecordingSeam {
	store: Record<string, unknown> = {}
	constructor() {
		super()
		;(this.seam as any).configLoad = () => JSON.parse(JSON.stringify(this.store))
		;(this.seam as any).configSave = (patch: Record<string, unknown>) => {
			this.calls.push("configSave")
			this.store = { ...this.store, ...patch }
			return JSON.parse(JSON.stringify(this.store))
		}
	}
}

describe("/motion (α skin layer)", () => {
	const run = coreCommands().find((command) => command.name === "/motion")!.run

	beforeEach(() => setMotionTier(undefined))

	test("bare with an explicit tier reports that tier alone", async () => {
		setMotionTier("full")
		const ctx = makeCtx(new RecordingSeam())
		await run(ctx, "")
		expect(ctx.lines).toEqual(["motion: full (usage: /motion full|reduced|off|auto)"])
		setMotionTier("off")
		const off = makeCtx(new RecordingSeam())
		await run(off, "")
		expect(off.lines).toEqual(["motion: off (usage: /motion full|reduced|off|auto)"])
	})

	test("bare on auto shows the setting AND the resolved tier", async () => {
		const seam = new ConfigSeam()
		const ctx = makeCtx(seam)
		await run(ctx, "auto")
		ctx.lines.length = 0
		await run(ctx, "")
		// The test environment has no confirmed truecolor, so auto resolves to
		// reduced — the exact tier is asserted through getMotionTier().
		expect(ctx.lines).toEqual([`motion: auto → ${getMotionTier()} (usage: /motion full|reduced|off|auto)`])
		expect(ctx.lines[0]!.startsWith("motion: auto → ")).toBe(true)
	})

	test("bare with no setting at all shows auto → resolved (never a bare tier)", async () => {
		const ctx = makeCtx(new RecordingSeam())
		await run(ctx, "")
		expect(ctx.lines).toEqual([`motion: auto → ${getMotionTier()} (usage: /motion full|reduced|off|auto)`])
	})

	test("sets the tier and persists the choice to the profile config", async () => {
		const seam = new ConfigSeam()
		const ctx = makeCtx(seam)
		await run(ctx, "reduced")
		expect(ctx.lines).toContain("motion: reduced")
		expect(seam.calls).toContain("configSave")
		expect(seam.store.motion).toBe("reduced")
		await run(ctx, "off")
		expect(ctx.lines).toContain("motion: off")
		expect(seam.store.motion).toBe("off")
	})

	test("auto drops the explicit tier and persists the auto choice", async () => {
		const seam = new ConfigSeam()
		const ctx = makeCtx(seam)
		await run(ctx, "full")
		expect(seam.store.motion).toBe("full")
		await run(ctx, "auto")
		expect(ctx.lines).toContain("motion: auto")
		expect(seam.store.motion).toBe("auto")
	})

	test("rejects unknown args without persisting", async () => {
		const seam = new ConfigSeam()
		const ctx = makeCtx(seam)
		await run(ctx, "turbo")
		expect(ctx.lines).toEqual(["usage: /motion full|reduced|off|auto"])
		expect(seam.calls).not.toContain("configSave")
	})
})

describe("/hints argument parsing", () => {
	const hints = coreCommands().find((c) => c.name === "/hints")!
	const run = (argText: string) => {
		const ctx = makeCtx(new RecordingSeam())
		hints.run(ctx, argText)
		return ctx
	}

	beforeEach(() => {
		setFooterHints({ ...DEFAULT_FOOTER_HINTS })
		setHintsLocale("en")
	})

	test("description stays within the palette row budget (≤ /login's 78)", () => {
		expect(hints.description.length).toBeLessThanOrEqual(70)
	})

	test("lang matches case-insensitively onto the canonical locale", () => {
		expect(run("lang EN").lines).toEqual(["hint language: en"])
		expect(hintsLocale()).toBe("en")
		expect(run("lang zh-cn").lines).toEqual(["hint language: zh-CN"])
		expect(hintsLocale()).toBe("zh-CN")
		expect(run("lang JA").lines).toEqual(["hint language: ja"])
		setHintsLocale("en")
	})

	test("lang with an unknown or missing locale reprints usage", () => {
		expect(run("lang fr").lines).toEqual([`usage: /hints lang ${HINT_LOCALES.join("|")} (current: en)`])
		expect(run("lang").lines.length).toBe(1)
		expect(run("lang").lines[0]).toContain("usage: /hints lang")
		expect(hintsLocale()).toBe("en")
	})

	test("bare `all` defaults every segment on (even from all-off state)", () => {
		const off = { ...DEFAULT_FOOTER_HINTS }
		for (const key of Object.keys(off) as (keyof typeof off)[]) off[key] = false
		setFooterHints(off)
		const ctx = run("all")
		expect(ctx.lines).toEqual(["all hint segments: on"])
		expect(footerHints()).toEqual({ ...DEFAULT_FOOTER_HINTS })
	})

	test("`all off` bulk-sets every segment off", () => {
		const ctx = run("all off")
		expect(ctx.lines).toEqual(["all hint segments: off"])
		expect(Object.values(footerHints()).every((on) => !on)).toBe(true)
	})

	test("unknown state word errors without touching the store (typo ≠ on)", () => {
		const before = footerHints()
		expect(run("scroll of").lines).toEqual(["usage: /hints scroll on|off (got: of)"])
		expect(run("all ONN").lines).toEqual(["usage: /hints all on|off (got: onn)"])
		expect(footerHints()).toEqual(before)
	})

	test("unknown segment reports the error and lists the segments", () => {
		const ctx = run("banana")
		expect(ctx.lines[0]).toContain("unknown hint segment: banana")
		expect(ctx.lines[0]).toContain("scroll")
	})

	test("mutating runs persist footerHints + hintsLocale through the config seam (/motion parity)", () => {
		const seam = new ConfigSeam()
		const ctx = makeCtx(seam)
		hints.run(ctx, "scroll off")
		hints.run(ctx, "lang ja")
		expect(seam.calls.filter((call) => call === "configSave").length).toBe(2)
		// the FULL record rides each write (configSave replaces the key wholesale)
		expect(seam.store.footerHints).toEqual({ ...DEFAULT_FOOTER_HINTS, scroll: false })
		expect(seam.store.hintsLocale).toBe("ja")
	})

	test("usage errors and the bare bar toggle stay session-scoped (no config write)", () => {
		const seam = new ConfigSeam()
		const ctx = makeCtx(seam)
		hints.run(ctx, "scroll of") // typo → usage
		hints.run(ctx, "banana") // unknown segment
		hints.run(ctx, "") // bare toggle flips hintsShown — not persisted
		expect(seam.calls).not.toContain("configSave")
	})
})

// ---------------------------------------------------------------------------
// C13 — /resume corrupt-log repair flow (tui-pi repair-dialog semantics on
// the generic pickOne modal: probe at picker load, ⚠ rows, EXPLICIT confirm
// gate, guarded rewrite, result feedback; no confirm → no write)
// ---------------------------------------------------------------------------

describe("C13: /resume repair flow", () => {
	const BAD_LOG = {
		path: "/home/.dsh/sessions/ws/session-bad/session.v3.jsonl",
		name: "session.v3.jsonl",
		reason: "invalid jsonl tail",
		sessionId: "s1",
	}

	test("broken logs flag their picker rows with ⚠ (probe at picker-load time)", async () => {
		const seam = new RecordingSeam()
		seam.sessions = [{ id: "s1", title: "first" }, { id: "s2", title: "second" }]
		seam.brokenLogs = [BAD_LOG]
		const ctx = makeCtx(seam, "s2")
		await coreCommands().find((c) => c.name === "/resume")!.run(ctx, "")
		const pick = ctx.hooks.picks[0]
		expect(pick?.options[0]?.title).toContain("⚠ first")
		expect(pick?.options[1]?.title).not.toContain("⚠")
		// a clean pick bypasses the confirm entirely (single pickOne stage)
		expect(ctx.hooks.picks).toHaveLength(1)
		expect(seam.repairCalls).toEqual([])
		expect(ctx.lines).toEqual(["resumed s2"])
	})

	test("NO CONFIRM → NO WRITE: cancel leaves the log untouched and never resumes", async () => {
		const seam = new RecordingSeam()
		seam.sessions = [{ id: "s1", title: "first" }]
		seam.brokenLogs = [BAD_LOG]
		const ctx = makeCtx(seam, ["s1", "cancel"])
		await coreCommands().find((c) => c.name === "/resume")!.run(ctx, "")
		// stage 1 = session picker, stage 2 = the repair confirm dialog
		expect(ctx.hooks.picks).toHaveLength(2)
		expect(ctx.hooks.picks[1]?.title).toContain("s1")
		expect(ctx.hooks.picks[1]?.title).toContain("invalid jsonl tail")
		expect(ctx.hooks.picks[1]?.options.map((o) => o.title)).toEqual(["Repair & resume", "Cancel"])
		// the write gate: the repair never received the path
		expect(seam.repairCalls).toEqual([])
		expect(seam.calls).toEqual(["listSessions"]) // no resumeSession
		expect(ctx.lines[0]).toContain("left untouched")
	})

	test("esc (undefined pick) cancels the repair the same way", async () => {
		const seam = new RecordingSeam()
		seam.sessions = [{ id: "s1", title: "first" }]
		seam.brokenLogs = [BAD_LOG]
		const ctx = makeCtx(seam, undefined)
		await coreCommands().find((c) => c.name === "/resume")!.run(ctx, "")
		expect(seam.repairCalls).toEqual([])
		expect(seam.calls).toEqual(["listSessions"])
	})

	test("NO DOOMED CONFIRM: a zstd broken log reports its reason directly — no Repair & resume dialog", async () => {
		const seam = new RecordingSeam()
		seam.sessions = [{ id: "s1", title: "first" }]
		seam.brokenLogs = [
			{
				...BAD_LOG,
				path: "/home/.dsh/sessions/ws/session-bad/session.v4.jsonl.zstd",
				name: "session.v4.jsonl.zstd",
				reason: "truncated or corrupt zstd frame — not repairable client-side (only plain jsonl tails are)",
			},
		]
		const ctx = makeCtx(seam, ["s1", "repair"]) // even a forced "repair" pick must never be consumed
		await coreCommands().find((c) => c.name === "/resume")!.run(ctx, "")
		// stage 1 = session picker only: the doomed confirm dialog never opened
		expect(ctx.hooks.picks).toHaveLength(1)
		expect(seam.repairCalls).toEqual([])
		expect(seam.calls).toEqual(["listSessions"]) // no resume either
		expect(ctx.lines[0]).toContain("cannot repair s1 client-side")
		expect(ctx.lines[0]).toContain("not repairable client-side")
	})

	test("NO DOOMED CONFIRM: a 0-byte log is the same unrepairable category", async () => {
		const seam = new RecordingSeam()
		seam.sessions = [{ id: "s1", title: "first" }]
		seam.brokenLogs = [{ ...BAD_LOG, reason: "0 bytes" }]
		const ctx = makeCtx(seam, ["s1", "repair"])
		await coreCommands().find((c) => c.name === "/resume")!.run(ctx, "")
		expect(ctx.hooks.picks).toHaveLength(1)
		expect(seam.repairCalls).toEqual([])
		expect(seam.calls).toEqual(["listSessions"])
		expect(ctx.lines[0]).toContain("cannot repair s1 client-side")
	})

	test("explicit confirm rewrites through the seam (path handed over), reports the backup, resumes", async () => {
		const seam = new RecordingSeam()
		seam.sessions = [{ id: "s1", title: "first" }]
		seam.brokenLogs = [BAD_LOG]
		const ctx = makeCtx(seam, ["s1", "repair"])
		await coreCommands().find((c) => c.name === "/resume")!.run(ctx, "")
		// the write happened exactly once, with the scanned path
		expect(seam.repairCalls).toEqual([BAD_LOG.path])
		expect(ctx.lines.some((l) => l.includes("repaired") && l.includes(".corrupt-bak"))).toBe(true)
		// the resume path re-enters after the repair
		expect(seam.calls).toEqual(["listSessions", "resumeSession:s1"])
		expect(ctx.hooks.reloadIds).toEqual(["s1"])
		expect(ctx.lines.at(-1)).toBe("resumed s1")
	})

	test("failed repair stops the resume (the log stays untouched or restored)", async () => {
		const seam = new RecordingSeam()
		seam.sessions = [{ id: "s1", title: "first" }]
		seam.brokenLogs = [BAD_LOG]
		seam.repairResults = [{ kind: "failed", detail: "cannot back up the original: EACCES" }]
		const ctx = makeCtx(seam, ["s1", "repair"])
		await coreCommands().find((c) => c.name === "/resume")!.run(ctx, "")
		expect(seam.repairCalls).toEqual([BAD_LOG.path])
		expect(ctx.lines[0]).toContain("repair failed")
		expect(seam.calls).toEqual(["listSessions"]) // no resumeSession
	})

	test("clean verdict (self-healed log) reports nothing-to-do and still resumes", async () => {
		const seam = new RecordingSeam()
		seam.sessions = [{ id: "s1", title: "first" }]
		seam.brokenLogs = [BAD_LOG]
		seam.repairResults = [{ kind: "clean" }]
		const ctx = makeCtx(seam, ["s1", "repair"])
		await coreCommands().find((c) => c.name === "/resume")!.run(ctx, "")
		expect(ctx.lines.some((l) => l.includes("needs no repair"))).toBe(true)
		expect(seam.calls).toEqual(["listSessions", "resumeSession:s1"])
	})

	test("seam without the optional repair members keeps the repair-free picker", async () => {
		const seam = new RecordingSeam()
		const bare = { ...seam.seam } as SessionSeam
		delete (bare as Partial<SessionSeam>).repairScanBroken
		delete (bare as Partial<SessionSeam>).repairSessionLog
		const ctx = makeCtx({ seam: bare, calls: [] } as unknown as RecordingSeam, "s2")
		await coreCommands().find((c) => c.name === "/resume")!.run(ctx, "")
		expect(ctx.hooks.picks).toHaveLength(1)
		expect(ctx.lines).toEqual(["resumed s2"])
	})
})
