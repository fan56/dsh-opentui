/**
 * Host-command palette FT on the REAL renderer (027).
 *
 * Mounts the real SessionComposer with a mergeHostCommands-built registry
 * (fixtures/composer-host-commands-ft.run.ts, run in a child
 * `bun --conditions browser` — see the fixture header) and drives raw stdin
 * bytes. Pins the three behaviors the daily path needs:
 *
 *   - a host-published row appears among the completions of an open palette;
 *   - selecting the host row and pressing Enter executes it through
 *     `seam.hostCommands.execute` (raw name, echo text → say; never a local
 *     run, never a model send) — with or without arguments;
 *   - typing the FULL local name of a duplicated command + Enter still runs
 *     the LOCAL implementation (exact-name precedence; the host twin lists
 *     under its i18n source suffix and never swallows the local command).
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { PALETTE_ROWS } from "../src/routes/session/slash-palette"

const fixture = join(import.meta.dir, "fixtures", "composer-host-commands-ft.run.ts")

async function runFt(): Promise<Record<string, any>> {
	const proc = Bun.spawn(["bun", "--conditions", "browser", fixture], {
		cwd: join(import.meta.dir, ".."),
		stdout: "pipe",
		stderr: "pipe",
	})
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	])
	const line = out.trim().split("\n").at(-1) ?? ""
	if (code !== 0 || !line.startsWith("{")) throw new Error(`FT runner failed (exit ${code}):\n${out}\n${err}`)
	return JSON.parse(line)
}

describe("host commands in the slash palette on the real renderer", () => {
	test("host row completes, executes through the seam; the local twin keeps the exact-name Enter", async () => {
		const r = await runFt()

		// 1. the host row is merged into the open palette's completions
		//    (`rows` is the FIXED box height while open — STABLE-HEIGHT)
		expect(r.openHost).toMatchObject({ buffer: "/", rows: PALETTE_ROWS, total: 3, frameHasHostRow: true })
		// narrowing to the host row only: it stays painted and highlighted
		expect(r.hostNarrow).toMatchObject({ buffer: "/plug", rows: PALETTE_ROWS, frameHasHostRow: true })
		// Enter on the highlighted host row → seam execute with the RAW name,
		// echo text painted via say; no local run, no model send
		expect(r.hostEnter).toMatchObject({ buffer: "", ran: [], sent: [], executed: ["/plugin-cmd"] })
		expect(r.hostEnter.said).toEqual(["host echo: /plugin-cmd"])

		// 2. argument line (menu closed by the space) dispatches the host row
		//    with the typed args through the same execute face
		expect(r.argsLine).toMatchObject({ buffer: "/plugin-cmd extra", rows: 0 })
		expect(r.argsEnter).toMatchObject({ ran: [], sent: [], executed: ["/plugin-cmd extra"] })

		// 3. duplicated name: both rows paint (twin under the i18n suffix), and
		//    the exact-name Enter runs the LOCAL implementation
		expect(r.dupOpen).toMatchObject({ rows: PALETTE_ROWS, frameHasDupLocal: true, frameHasDupTwin: true })
		expect(r.dupEnter).toMatchObject({ buffer: "", ran: ["/dup"], said: [], sent: [], executed: [] })
	}, 60_000)
})
