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
	const hooks = { cleared: 0, reloaded: 0, quit: 0, picks: [] as { title: string; options: string[] }[] }
	const ctx: SlashCommandContext & { hooks: typeof hooks; lines: string[] } = {
		seam: seam.seam,
		say: (text) => lines.push(text),
		clear: () => hooks.cleared++,
		reload: () => hooks.reloaded++,
		quit: () => hooks.quit++,
		pickOne: async (title, options) => {
			hooks.picks.push({ title, options: options.map((o) => o.title) })
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
		])
		expect(filterCommands(commands, "/cl").map((c) => c.name)).toEqual(["/clear"])
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
		expect(ctx.hooks.picks[0]?.options).toEqual(["bigmodel/glm-5.3-flash", "deepseek/v3.2"])
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
		expect(ctx.hooks.picks[0]?.options).toEqual(["first", "second"])
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
})
