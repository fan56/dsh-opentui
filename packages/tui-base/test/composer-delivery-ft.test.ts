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

		const first = [{ text: "first", source: "user" }]
		const pumped = [...first, { text: "queued line", source: "queue" }]

		// idle submit started the turn with the user source
		expect(r.first).toMatchObject({ buffer: "", asked: 0, sent: first, steered: [] })

		// busy submit: chooser asked, buffer untouched while the dialog is open
		expect(r.askedBeforeEsc).toMatchObject({ buffer: "keep me", asked: 1, sent: first })

		// Esc: cancelled → buffer stays, nothing sent or steered
		expect(r.afterEsc).toMatchObject({ buffer: "keep me", asked: 1, sent: first, steered: [] })

		// Fixture clears the preserved draft before typing a fresh queue line:
		// no concatenation, no second chooser ask from a stale submit.
		expect(r.beforeQueue).toMatchObject({ buffer: "", asked: 1, sent: first, steered: [] })

		// Queue: cleared, still no send (waits for the turn end); one fresh ask
		expect(r.afterQueue).toMatchObject({ buffer: "", asked: 2, sent: first, steered: [] })

		// First turn settles: the queued line reaches the wrapper as queue-sourced
		expect(r.afterQueuePump).toMatchObject({ buffer: "", asked: 2, sent: pumped, steered: [] })

		// Steer: cleared and injected through the seam; the source log is unchanged
		expect(r.afterSteer).toMatchObject({ buffer: "", asked: 3, sent: pumped, steered: ["steer line"] })
	}, 20000)

	test("a refused steer with an empty buffer restores the submitted line", async () => {
		const r = await runFt()

		// The chooser kept the line while open; clearing it makes restoration
		// observable instead of a no-op on an untouched buffer.
		expect(r.beforeRejectEmpty).toMatchObject({ buffer: "", asked: 1, steered: [] })

		// The seam really returned a typed refusal (the fixture passes a
		// `{steer}` options object, not a bare function), so the restore path is
		// driven by accepted:false + reason — not by the default acceptance.
		expect(r.beforeRejectEmpty.seamResult).toBeUndefined()
		expect(r.afterRejectEmpty.seamResult?.accepted).toBe(false)
		expect(r.afterRejectEmpty.seamResult?.reason).toBe("STEER_ENDED")
		expect(r.afterRejectEmpty.steerResults).toEqual([{ accepted: false, reason: "STEER_ENDED" }])

		// Refusal: the exact submitted text is put back, no auto-send, no second ask.
		expect(r.afterRejectEmpty).toMatchObject({
			buffer: "restore me",
			asked: 1,
			sent: [{ text: "first", source: "user" }],
			steered: ["restore me"],
		})
	}, 20000)

	test("a refused steer does not overwrite a newer user draft", async () => {
		const r = await runFt()

		expect(r.beforeRejectNewText).toMatchObject({ buffer: "new draft", asked: 1 })
		expect(r.afterRejectNewText.seamResult?.accepted).toBe(false)
		expect(r.afterRejectNewText.seamResult?.reason).toBe("STEER_IDLE")
		// The refusal owned "original", but the user typed "new draft" meanwhile.
		expect(r.afterRejectNewText).toMatchObject({
			buffer: "new draft",
			asked: 1,
			steered: ["original"],
		})
	}, 20000)

	test("a refused steer after the component is destroyed does not crash", async () => {
		const r = await runFt()

		// The fixture disposes the renderer while the chooser is pending, then
		// resolves a rejecting steer; neither the view callback nor the submit
		// continuation may write into the dead editor (or throw unhandled).
		expect(r.afterDestroyReject).toMatchObject({ crash: null, destroyed: true })
		expect(r.afterDestroyReject.destroyed).toBe(true)
		expect(r.afterDestroyReject.seamResult?.accepted).toBe(false)
		expect(r.afterDestroyReject.seamResult?.reason).toBe("STEER_ABORTING")
	}, 20000)
})
