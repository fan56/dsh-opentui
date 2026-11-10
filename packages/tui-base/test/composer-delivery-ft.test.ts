/**
 * Busy-submit chooser FT on the REAL renderer: the injected chooser is asked
 * on a busy Enter, Esc keeps the typed buffer, Queue clears it without a send,
 * Steer clears it and reaches the seam.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const fixture = join(import.meta.dir, "fixtures", "composer-delivery-ft.run.ts")

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

describe("busy submit delivery chooser (real renderer)", () => {
	test("asks once, Esc keeps the input, Queue clears without send, Steer reaches the seam", async () => {
		const r = await runFt()

		// idle submit started the turn
		expect(r.first).toMatchObject({ buffer: "", asked: 0, sent: ["first"], steered: [] })

		// busy submit: chooser asked, buffer untouched while the dialog is open
		expect(r.askedBeforeEsc).toMatchObject({ buffer: "keep me", asked: 1, sent: ["first"] })

		// Esc: cancelled → buffer stays, nothing sent or steered
		expect(r.afterEsc).toMatchObject({ buffer: "keep me", sent: ["first"], steered: [] })

		// Queue: cleared, still no send (waits for the turn end)
		expect(r.afterQueue).toMatchObject({ buffer: "", sent: ["first"], steered: [] })

		// Steer: cleared and injected through the seam
		expect(r.afterSteer).toMatchObject({ buffer: "", sent: ["first"], steered: ["steer line"] })
	})
})
