/**
 * Slash palette + composer FT on the REAL renderer (batch V5).
 *
 * Mounts the real SessionComposer with the batch-8 slash host on the
 * @opentui test renderer and drives raw stdin bytes through the native input
 * parser (fixtures/composer-palette-ft.run.ts, run in a child
 * `bun --conditions browser` so solid-js resolves to its client build — see
 * the fixture header). Pins the daily path the e2e port flagged:
 *
 *   - "/" opens the palette; letters typed one-by-one AND as one burst
 *     narrow it live (rows never orphan, the frame paints the filtered row);
 *   - Enter on the highlighted entry dispatches it (never a model send) and
 *     clears the composer;
 *   - Esc closes the palette with the buffer intact; the next edit re-arms;
 *   - a zero-match query paints no empty strip and Enter yields the harmless
 *     unknown-command row.
 *
 * The container failure itself was NOT in this layer: the plugin entry
 * (shell/src/host-entry-v2.tsx) remounted SessionComposer on every clock
 * tick via eager signal reads in its root children getter, so each write
 * landed in a fresh empty textarea — pinned by
 * shell/test/host-entry-v2-reactive-props.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { PALETTE_ROWS } from "../src/routes/session/slash-palette"

const fixture = join(import.meta.dir, "fixtures", "composer-palette-ft.run.ts")

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

describe("slash palette + composer on the real renderer", () => {
	test("open, type (key-by-key and burst), Enter dispatches, Esc keeps the buffer, zero-match is inert", async () => {
		const r = await runFt()

		// open: the FIXED-height palette box (MAX_ROWS, blank-padded) —
		// STABLE-HEIGHT: the composer root height must NOT follow the filter
		const openHeight = r.openSlash.composerHeight
		expect(r.openSlash).toMatchObject({ buffer: "/", rows: PALETTE_ROWS, frameHasHelpRow: true, frameHasNewRow: true })
		expect(openHeight).toBeGreaterThan(0)
		// OVERFLOW CAP (real renderer): the table holds 13 matching commands but
		// only the first MAX_ROWS paint — "/extra11" is past the cap and must
		// not appear anywhere in the frame (used to overlap the textarea when
		// <For> rendered the uncapped list); the reserved row shows the count.
		expect(r.openSlash.frameHasOverflowRow).toBe(false)
		expect(r.openSlash.frameHasMoreHint).toBe(true)

		// key-by-key into the OPEN palette: filters live, never orphans, and
		// the composer root height is UNCHANGED per keystroke (the flicker fix)
		expect(r.keyH).toMatchObject({ buffer: "/h", rows: PALETTE_ROWS, query: "/h", composerHeight: openHeight, frameHasHelpRow: true, frameHasNewRow: false })
		expect(r.keyE).toMatchObject({ buffer: "/he", rows: PALETTE_ROWS, query: "/he", composerHeight: openHeight, frameHasHelpRow: true })
		// Enter runs the highlighted /help, clears, no model send; the palette
		// closes and the composer root shrinks back below its open height
		expect(r.enter).toMatchObject({ buffer: "", rows: 0, ran: ["/help"], sent: [] })
		expect(r.enter.composerHeight).toBeLessThan(openHeight)

		// one-write burst into the OPEN palette: same outcome
		expect(r.burst).toMatchObject({ buffer: "/he", rows: PALETTE_ROWS, query: "/he", composerHeight: openHeight, frameHasHelpRow: true, frameHasNewRow: false })
		expect(r.burstEnter).toMatchObject({ buffer: "", rows: 0, ran: ["/help"], sent: [] })
		expect(r.burstEnter.composerHeight).toBeLessThan(openHeight)

		// Esc: closed, buffer intact; the next edit re-arms the filtered list
		expect(r.esc).toMatchObject({ buffer: "/h", rows: 0, frameHasHelpRow: false })
		expect(r.escThenType).toMatchObject({ buffer: "/he", rows: PALETTE_ROWS, composerHeight: openHeight, frameHasHelpRow: true })

		// zero-match: closed (no empty strip), Enter = unknown row, never a send
		expect(r.zeroMatch).toMatchObject({ buffer: "/zz", rows: 0, frameHasHelpRow: false })
		expect(r.zeroMatchEnter).toMatchObject({ buffer: "", said: ["unknown command: /zz (try /help)"], sent: [] })
		expect(r.zeroMatchEnter.composerHeight).toBeLessThan(openHeight)
	}, 60_000)
})
