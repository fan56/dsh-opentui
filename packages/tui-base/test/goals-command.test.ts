/**
 * 025 W2-5b — /goals command tests: pure helpers + command flows against a
 * recording face. Status is the zero-side-effect default; writes require an
 * explicit yes/no confirm (no silent change); service absence / no active
 * session degrade to an honest notice (never a fake-empty goal). en-literal
 * assertions are hermetic via the bundled locale registry.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import { coreCommands, type SlashCommandContext } from "../src/routes/session/commands"
import {
	formatGoalStatus,
	isGoalsWriteOp,
	parseGoalsArgs,
} from "../src/routes/session/goals-command"
import type { SeamGoalRef, SeamGoalView, SessionSeam } from "../src/seams/session"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})
afterAll(() => setLanguages(new Map()))

const VIEW: SeamGoalView = {
	id: "g-1", revision: 2, objective: "Reach 100% green", phase: "active", activation: "armed",
	roundsStarted: 3, maxGoalRounds: 8, createdAt: 1, updatedAt: 2,
}

describe("goals pure helpers", () => {
	test("parseGoalsArgs: bare/empty -> status; write ops + objective", () => {
		expect(parseGoalsArgs("")).toEqual({ kind: "status" })
		expect(parseGoalsArgs("  ")).toEqual({ kind: "status" })
		expect(parseGoalsArgs("nonsense")).toEqual({ kind: "status" })
		expect(parseGoalsArgs("create make it green")).toEqual({ kind: "create", objective: "make it green" })
		expect(parseGoalsArgs("pause")).toEqual({ kind: "pause" })
		expect(parseGoalsArgs("COMPLETE")).toEqual({ kind: "complete" })
		expect(isGoalsWriteOp({ kind: "status" })).toBe(false)
		expect(isGoalsWriteOp({ kind: "clear" })).toBe(true)
	})

	test("formatGoalStatus: answer-bearing rows carry objective/phase/ref; no raw object", () => {
		const rows = formatGoalStatus(VIEW)
		const text = rows.join("\n")
		expect(text).toContain("Reach 100% green")
		expect(text).toContain("g-1")
		expect(text).toContain("r2")
		expect(text).toContain("3/8")
		expect(text).not.toContain("[object Object]")
	})
})

type Face = NonNullable<SessionSeam["goals"]>

function makeCtx(face: Face | undefined, pickAnswer?: string) {
	const lines: string[] = []
	const calls: string[] = []
	const goalsFace: Face = face ?? {
		status: async () => VIEW,
		available: () => true,
		create: async () => ({ id: "g-2", revision: 1 }),
		edit: async () => VIEW,
		complete: async () => VIEW,
		pause: async () => VIEW,
		resume: async () => VIEW,
		clear: async () => ({ id: "g-1", revision: 3 }),
	}
	const ctx = {
		seam: { goals: goalsFace } as unknown as SessionSeam,
		say: (text: string) => lines.push(text),
		clear() {}, reload() {}, quit() {},
		pickOne: async () => pickAnswer,
		promptText: async () => "prompted objective",
	} as unknown as SlashCommandContext
	return { ctx, lines, calls }
}

async function runGoals(ctx: SlashCommandContext, argText = "") {
	const command = coreCommands().find((c) => c.name === "/goals")!
	await command.run(ctx, argText)
}

describe("/goals command — status / degrade / explicit confirm", () => {
	test("command is registered", () => {
		expect(coreCommands().some((c) => c.name === "/goals")).toBe(true)
	})

	test("bare /goals shows the answer-bearing status rows (read, no writes)", async () => {
		let writes = 0
		const face: Face = {
			status: async () => VIEW,
			available: () => true,
			create: async () => { writes++; return undefined },
			edit: async () => { writes++; return undefined },
			complete: async () => { writes++; return undefined },
			pause: async () => { writes++; return undefined },
			resume: async () => { writes++; return undefined },
			clear: async () => { writes++; return undefined },
		}
		const { ctx, lines } = makeCtx(face)
		await runGoals(ctx, "")
		expect(lines.join("\n")).toContain("Reach 100% green")
		expect(writes).toBe(0)
	})

	test("no seam face -> honest unavailable notice", async () => {
		const { ctx, lines } = makeCtx(undefined)
		// makeCtx(undefined) falls back to a default face; force a seam without goals.
		const seam = { } as unknown as SessionSeam
		const bare = { ...ctx, seam } as SlashCommandContext
		await runGoals(bare, "")
		expect(lines.join("\n")).toContain("unavailable")
	})

	test("service absent (status rejects) -> honest degraded notice, no crash", async () => {
		const face: Face = {
			status: async () => { throw new Error("UNSUPPORTED goals.get unavailable") },
			available: () => false,
			create: async () => undefined, edit: async () => undefined,
			complete: async () => undefined, pause: async () => undefined,
			resume: async () => undefined, clear: async () => undefined,
		}
		const { ctx, lines } = makeCtx(face)
		await runGoals(ctx, "")
		expect(lines.join("\n")).toContain("unavailable")
	})

	test("no current goal -> honest 'no current goal' (never fake-empty rows)", async () => {
		const face: Face = {
			status: async () => undefined,
			available: () => true,
			create: async () => undefined, edit: async () => undefined,
			complete: async () => undefined, pause: async () => undefined,
			resume: async () => undefined, clear: async () => undefined,
		}
		const { ctx, lines } = makeCtx(face)
		await runGoals(ctx, "")
		expect(lines.join("\n")).toContain("no current goal")
	})

	test("write with 'no' confirm -> zero mutation (aborted)", async () => {
		let created = 0
		const face: Face = {
			status: async () => VIEW,
			available: () => true,
			create: async () => { created++; return undefined },
			edit: async () => undefined, complete: async () => undefined,
			pause: async () => undefined, resume: async () => undefined, clear: async () => undefined,
		}
		const { ctx, lines } = makeCtx(face, "no")
		await runGoals(ctx, "create ship it")
		expect(created).toBe(0)
		expect(lines.join("\n")).toContain("aborted")
	})

	test("write with 'yes' confirm -> mutation fires once", async () => {
		let captured = ""
		const face: Face = {
			status: async () => VIEW,
			available: () => true,
			create: async (objective) => { captured = objective; return { id: "g-2", revision: 1 } },
			edit: async () => undefined, complete: async () => undefined,
			pause: async () => undefined, resume: async () => undefined, clear: async () => undefined,
		}
		const { ctx, lines } = makeCtx(face, "yes")
		await runGoals(ctx, "create ship it now")
		expect(captured).toBe("ship it now")
		expect(lines.join("\n")).toContain("g-2")
	})
})
