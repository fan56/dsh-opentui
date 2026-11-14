/**
 * Gap C12 (/export): the pure export module (export.ts — target-path
 * resolution + journalToJSONL serialization) and the /export command
 * wiring (degrade notices, the run-scoped FS write, the honest done line).
 * The command tests hand-build the ctx (skills-manate.test.ts precedent)
 * but exercise the REAL write against a temp dir.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { exportTargetPath, journalToJSONL } from "../src/routes/session/export"
import { coreCommands, type SlashCommandContext } from "../src/routes/session/commands"
import type { HistoryJournalEntry } from "../src/routes/session/history-data"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"

// The command copy resolves through `t()` (T4 facet migration; the /export
// say lines ride it after the main merge): boot the bundled registry so the
// en-literal assertions stay hermetic in isolation.
beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})

function entry(seq: number, type = "message/updated"): HistoryJournalEntry {
	return { type, seq, time: 1700000000000 + seq, data: { seq } }
}

describe("export.ts: exportTargetPath", () => {
	test("no arg → ~/Downloads/dsh-session-<id8>.jsonl (id clipped to 8)", () => {
		const target = exportTargetPath("sess-abcdefgh-1234")
		expect(target).toBe(join(homedir(), "Downloads", "dsh-session-sess-abc.jsonl"))
	})

	test("path-unsafe id characters fold to '-'", () => {
		const target = exportTargetPath("ab/cd ef")
		expect(target).toBe(join(homedir(), "Downloads", "dsh-session-ab-cd-ef.jsonl"))
	})

	test("relative arg resolves against the cwd", () => {
		const target = exportTargetPath("sess-1234", "out/session.jsonl")
		expect(target).toBe(resolve(process.cwd(), "out/session.jsonl"))
	})

	test("absolute arg passes through", () => {
		const target = exportTargetPath("sess-1234", "/tmp/x/dump.jsonl")
		expect(target).toBe("/tmp/x/dump.jsonl")
	})
})

describe("export.ts: journalToJSONL", () => {
	test("one JSON.parse-able line per record, newline-terminated", () => {
		const text = journalToJSONL([entry(1), entry(2, "turn/start")])
		const lines = text.split("\n")
		expect(lines.length).toBe(3) // 2 records + trailing newline
		expect(lines[2]).toBe("")
		const parsed = lines.slice(0, 2).map((line) => JSON.parse(line) as HistoryJournalEntry)
		expect(parsed.map((e) => e.seq)).toEqual([1, 2])
		expect(parsed[1].type).toBe("turn/start")
	})

	test("empty journal → empty string (empty file, not a silent skip)", () => {
		expect(journalToJSONL([])).toBe("")
	})
})

describe("/export command wiring", () => {
	const exportCommand = () => coreCommands().find((c) => c.name === "/export")!

	function makeCtx(seam: Partial<SlashCommandContext["seam"]>): SlashCommandContext & { lines: string[] } {
		const lines: string[] = []
		return {
			say: (text) => lines.push(text),
			clear: () => {},
			reload: () => {},
			quit: () => {},
			pickOne: async () => undefined,
			seam: seam as SlashCommandContext["seam"],
			lines,
		}
	}

	test("/export without an active session degrades to the notice", async () => {
		const ctx = makeCtx({ currentSessionId: () => undefined })
		await exportCommand().run(ctx, "")
		expect(ctx.lines).toEqual(["/export: no active session to export"])
	})

	test("/export without the sessionJournal face degrades to the notice", async () => {
		const ctx = makeCtx({ currentSessionId: () => "sess-12345678" })
		await exportCommand().run(ctx, "")
		expect(ctx.lines).toEqual(["/export: the journal read face is not mounted in this entry"])
	})

	test("/export writes the JSONL (mkdir -p) and reports count + path honestly", async () => {
		const base = await mkdtemp(join(tmpdir(), "dsh-export-test-"))
		try {
			const target = join(base, "nested/dir/out.jsonl")
			const ctx = makeCtx({
				currentSessionId: () => "sess-12345678",
				sessionJournal: async () => [entry(1), entry(2), entry(3)],
			})
			await exportCommand().run(ctx, target)
			expect(ctx.lines).toEqual([
				`exported 3 journal records (host journal format) → ${resolve(target)}`,
			])
			const text = await readFile(resolve(target), "utf8")
			expect(text.split("\n").filter((line) => line !== "").length).toBe(3)
			expect(JSON.parse(text.split("\n")[0]!)).toMatchObject({ seq: 1 })
		} finally {
			await rm(base, { recursive: true, force: true })
		}
	})

	test("/export default target lands in ~/Downloads (id8 naming)", async () => {
		const base = await mkdtemp(join(tmpdir(), "dsh-export-test-"))
		const realDownloads = join(homedir(), "Downloads")
		try {
			// Run the resolution-only half for the default (do NOT write into
			// the user's real Downloads from a test): the command with an
			// empty arg resolves the default path — assert it, then route the
			// write through a temp arg to verify the write path itself.
			expect(exportTargetPath("sess-12345678")).toBe(
				join(realDownloads, "dsh-session-sess-123.jsonl"),
			)
			const target = join(base, "default-shape.jsonl")
			const ctx = makeCtx({
				currentSessionId: () => "sess-12345678",
				sessionJournal: async () => [entry(1)],
			})
			await exportCommand().run(ctx, target)
			expect(existsSync(resolve(target))).toBe(true)
		} finally {
			await rm(base, { recursive: true, force: true })
		}
	})

	test("/export with an empty journal still writes an empty file", async () => {
		const base = await mkdtemp(join(tmpdir(), "dsh-export-test-"))
		try {
			const target = join(base, "empty.jsonl")
			const ctx = makeCtx({
				currentSessionId: () => "sess-12345678",
				sessionJournal: async () => [],
			})
			await exportCommand().run(ctx, target)
			expect(await readFile(resolve(target), "utf8")).toBe("")
			expect(ctx.lines[0]).toContain("exported 0 journal records")
		} finally {
			await rm(base, { recursive: true, force: true })
		}
	})

	test("/export reports a seam rejection instead of crashing", async () => {
		const ctx = makeCtx({
			currentSessionId: () => "sess-12345678",
			sessionJournal: async () => {
				throw new Error("page read exploded")
			},
		})
		await exportCommand().run(ctx, "")
		expect(ctx.lines).toEqual(["/export failed — page read exploded"])
	})
})

describe("/export registration hygiene", () => {
	test("appears exactly once in coreCommands (the /help count 20 → 21)", () => {
		expect(coreCommands().filter((c) => c.name === "/export").length).toBe(1)
	})
})
