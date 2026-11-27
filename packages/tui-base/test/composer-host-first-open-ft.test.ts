/**
 * First-open host-command visibility FT on the REAL renderer.
 *
 * Mounts the real SessionComposer over a signal-backed mergeHostCommands
 * registry whose seam `list()` settles AFTER the palette opens
 * (fixtures/composer-host-first-open-ft.run.ts, run in a child
 * `bun --conditions browser` — see the fixture header; the slashSync wrapper
 * there mirrors examples/v2-entry.tsx's refresh discipline line for line).
 * Pins the fix behaviors:
 *
 *   - the very first "/" shows the host row once the pull settles — no
 *     close/reopen needed (the old pending-until-close rule made plugin
 *     commands invisible on the first open of a session);
 *   - rows landing while the palette is OPEN re-anchor the highlight to
 *     row 0 of the merged table (a carried index would highlight — and
 *     Enter execute — a different command after the alphabetical merge);
 *   - reopening while a second pull is in flight keeps the previous rows
 *     painted (no empty-list flash), one pull per open edge.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { PALETTE_ROWS } from "../src/routes/session/slash-palette"

const fixture = join(import.meta.dir, "fixtures", "composer-host-first-open-ft.run.ts")

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

describe("host commands visible on the FIRST palette open (real renderer)", () => {
	test("first / paints the host row when the pull settles mid-open; highlight re-anchors; no flash on reopen", async () => {
		const r = await runFt()

		// 1. FIRST-OPEN VISIBILITY: open → locals only; settle (palette still
		//    open, no close/reopen) → the host row paints. `total` grows 2→3
		//    and the box height stays PALETTE_ROWS (STABLE-HEIGHT).
		expect(r.firstOpen).toMatchObject({
			buffer: "/",
			open: true,
			rows: PALETTE_ROWS,
			total: 2,
			frameHasHostRow: false,
			pullCalls: 1,
			refreshCalls: 1,
		})
		expect(r.firstOpenSettled).toMatchObject({
			buffer: "/",
			open: true,
			rows: PALETTE_ROWS,
			total: 3,
			frameHasHostRow: true,
			// exactly ONE pull for the ONE open edge
			pullCalls: 1,
			refreshCalls: 1,
		})

		// 2. SELECTION RESOLUTION: the highlight sat on index 1 ("/zeta") in
		//    the locals-only table; after the merged table lands
		//    ["/alpha", "/mid", "/zeta"] a carried index 1 would point at the
		//    "/mid" host twin — the reset re-anchors to row 0 instead.
		expect(r.hazardSetup).toMatchObject({ open: true, selected: 1, current: "/zeta" })
		expect(r.openSettleSelection).toMatchObject({
			open: true,
			total: 3,
			selected: 0,
			current: "/alpha",
			frameHasHostRow: true,
		})
		// one ↓ lands deliberately on the host twin; Enter executes it through
		// the seam (raw name, echo → say; never a local run, never a send)
		expect(r.afterDown).toMatchObject({ selected: 1, current: "/mid" })
		expect(r.hostRowEnter).toMatchObject({
			ran: [],
			sent: [],
			executed: ["/mid"],
			buffer: "",
			open: false,
		})
		expect(r.hostRowEnter.said).toEqual(["host echo: /mid"])

		// 3. NO PULL FLASH: closed after esc, reopen (buffer edit) fires the
		//    second open edge + pull; mid-flight the FIRST pull's rows still
		//    paint, and the settled reopen keeps them.
		expect(r.closed).toMatchObject({ open: false, rows: 0, pullCalls: 1, refreshCalls: 1 })
		expect(r.reopenMidPull).toMatchObject({
			open: true,
			frameHasHostRow: true,
			pullCalls: 2,
			refreshCalls: 2,
		})
		expect(r.reopenSettled).toMatchObject({
			open: true,
			total: 3,
			frameHasHostRow: true,
			// the reopen's apply resets the highlight while open
			selected: 0,
		})
	}, 60_000)
})
