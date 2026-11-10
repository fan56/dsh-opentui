/**
 * Shell-style ↑/↓ history on the REAL renderer under the client's provider
 * tree (ConfigProvider → Keymap.Provider) — the path where the composer's
 * own onKeyDown never sees the key (the managed textarea layer consumes it
 * first). Pins:
 *
 *   - ↑ walks newest → oldest and stops at the oldest (no wrap);
 *   - ↓ walks back and past the newest restores the EMPTY draft ("最底 =
 *     新消息"), so the composer is ready for a new message;
 *   - a typed single-line draft is stashed on the first ↑ and restored
 *     verbatim on ↓ past the newest, cursor included (pi stashes the whole
 *     editor state);
 *   - a multi-line draft with the cursor on a middle row: ↑/↓ move the
 *     cursor natively and never recall history;
 *   - a config override of `prompt.history.previous` (ctrl+p) recalls — the
 *     modifier guard that made overrides silently dead is gone;
 *   - while the slash palette is open ↑/↓ move the menu only (buffer stays
 *     the slash prefix, history is not recalled).
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { PALETTE_ROWS } from "../src/routes/session/slash-palette"

const fixture = join(import.meta.dir, "fixtures", "composer-history-ft.run.ts")

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

describe("shell-style ↑/↓ history under Keymap.Provider", () => {
	test("recall walks and bottoms out at the empty draft; draft stash; slash menu wins", async () => {
		const r = await runFt()

		expect(r.afterSubmits).toMatchObject({ buffer: "", sent: ["first message", "second message"] })
		// ↑ newest → oldest, then stop (no wrap)
		expect(r.up1.buffer).toBe("second message")
		expect(r.up2.buffer).toBe("first message")
		expect(r.up3.buffer).toBe("first message")
		// ↓ forward, then past the newest → empty draft (the "new message" slot)
		expect(r.down1.buffer).toBe("second message")
		expect(r.down2.buffer).toBe("")

		// typed draft: FIRST ↑ recalls and stashes; ↓ restores the draft
		expect(r.draftTyped.buffer).toBe("my draft")
		expect(r.draftUp.buffer).toBe("committed")
		expect(r.draftRestored.buffer).toBe("my draft")

		// draft cursor: stashed mid-line on the first ↑, restored with the draft
		expect(r.draftCursorBefore).toMatchObject({ buffer: "my draft", cursor: 3 })
		expect(r.draftCursorUp).toMatchObject({ buffer: "committed", cursor: 0 })
		expect(r.draftCursorRestored).toMatchObject({ buffer: "my draft", cursor: 3 })

		// multi-line draft, cursor on a middle row: native cursor movement, no recall
		expect(r.midBefore).toMatchObject({ buffer: "alpha\nbravo\ncharlie", row: 1 })
		expect(r.midUp).toMatchObject({ buffer: "alpha\nbravo\ncharlie", row: 0 })
		expect(r.midDown).toMatchObject({ buffer: "alpha\nbravo\ncharlie", row: 1 })

		// config override (ctrl+p) reaches history recall instead of being
		// rejected by a modifier guard
		expect(r.overrideBefore.buffer).toBe("")
		expect(r.overrideUp.buffer).toBe("committed")

		// open slash palette: arrows move the menu, never the history
		expect(r.slashOpen).toMatchObject({ buffer: "/", rows: PALETTE_ROWS })
		expect(r.slashUp).toMatchObject({ buffer: "/", rows: PALETTE_ROWS })
		expect(r.slashDown).toMatchObject({ buffer: "/", rows: PALETTE_ROWS })
	}, 60_000)
})
