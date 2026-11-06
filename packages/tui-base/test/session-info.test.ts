/**
 * /session info panel tests (feature batch F4): the speed-line rule
 * (unknown reads as "—", never 0 tok/s), the row vocabulary/order, the
 * aligned transcript block, and the /session command's seam call + notice.
 */
import { describe, expect, test } from "bun:test"
import { formatSessionInfoPanel, formatTps, sessionInfoRows } from "../src/routes/session/session-info"
import { coreCommands, dispatchLine, unknownCommandRow } from "../src/routes/session/commands"
import type { SeamSessionInfo } from "../src/seams/session"

/** A fully-billed session snapshot. */
const billed: SeamSessionInfo = {
	sessionId: "ses_123",
	model: "bigmodel/glm-5.3-flash",
	messageCount: 6,
	turnCount: 2,
	tokensIn: 4200,
	tokensOut: 950,
	cacheRead: 3800,
	cacheWrite: 400,
	lastTurnTps: 41.4,
	sessionAvgTps: 38.5,
}

describe("formatTps", () => {
	test("rounds a real rate", () => {
		expect(formatTps(41.4)).toBe("41 tok/s")
	})
	test("null/undefined/zero read as em-dash (never 0 tok/s)", () => {
		expect(formatTps(null)).toBe("—")
		expect(formatTps(undefined)).toBe("—")
		expect(formatTps(0)).toBe("—")
	})
})

describe("sessionInfoRows", () => {
	test("carries the billed fields in reference order", () => {
		const rows = sessionInfoRows(billed)
		expect(rows.map((r) => r.field)).toEqual([
			"session",
			"model",
			"messages",
			"turns",
			"tokens in/out",
			"cache read/write",
			"speed",
		])
		expect(rows[0].value).toBe("ses_123")
		expect(rows[4].value).toBe("4200 / 950")
		expect(rows[5].value).toBe("3800 / 400")
		expect(rows[6].value).toBe("last 41 tok/s · avg 39 tok/s")
	})

	test("speed line degrades per-rate: one unknown stays em-dash, never 0", () => {
		const rows = sessionInfoRows({ ...billed, sessionAvgTps: null })
		expect(rows[6].value).toBe("last 41 tok/s · avg —")
		const none = sessionInfoRows({ ...billed, lastTurnTps: null, sessionAvgTps: null })
		expect(none[6].value).toBe("—")
	})

	test("missing session/model read as em-dash", () => {
		const rows = sessionInfoRows({
			messageCount: 0,
			turnCount: 0,
			tokensIn: 0,
			tokensOut: 0,
			cacheRead: 0,
			cacheWrite: 0,
		})
		expect(rows[0].value).toBe("—")
		expect(rows[1].value).toBe("—")
	})
})

describe("formatSessionInfoPanel", () => {
	test("aligns values on the widest field label", () => {
		const lines = formatSessionInfoPanel(sessionInfoRows(billed))
		expect(lines.length).toBe(7)
		// Every value starts at the same column: the widest label ("cache
		// read/write", 16 chars) + the two-space gutter.
		for (const line of lines) {
			expect(line.slice(16, 18)).toBe("  ")
			expect(line.slice(18).length).toBeGreaterThan(0)
		}
		expect(lines[0]).toBe("session           ses_123")
	})
})

describe("/session command", () => {
	test("dispatches (longest-match keeps /sessions distinct from /session)", () => {
		const commands = coreCommands()
		expect(dispatchLine(commands, "/session")?.kind).toBe("command")
		const bare = dispatchLine(commands, "/session")
		if (bare.kind === "command") expect(bare.command.name).toBe("/session")
		const list = dispatchLine(commands, "/sessions")
		if (list.kind === "command") expect(list.command.name).toBe("/sessions")
	})

	test("prints one aligned row per line through say", async () => {
		const commands = coreCommands()
		const command = commands.find((c) => c.name === "/session")!
		const said: string[] = []
		await command.run(
			{
				seam: { sessionInfo: async () => billed } as never,
				say: (text) => said.push(text),
				clear: () => {},
				reload: () => {},
				quit: () => {},
				pickOne: async () => undefined,
			},
			"",
		)
		expect(said.length).toBe(7)
		expect(said[6]).toContain("tok/s")
	})

	test("without the seam method prints the unavailable notice", () => {
		const commands = coreCommands()
		const command = commands.find((c) => c.name === "/session")!
		const said: string[] = []
		command.run(
			{
				seam: {} as never,
				say: (text) => said.push(text),
				clear: () => {},
				reload: () => {},
				quit: () => {},
				pickOne: async () => undefined,
			},
			"",
		)
		expect(said).toEqual(["/session unavailable in this session"])
	})

	test("unknown /sessioN typos stay harmless rows", () => {
		expect(unknownCommandRow("/sessoin")).toContain("unknown command")
	})
})
