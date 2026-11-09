/**
 * Slash Tab completion under Keymap.Provider — the REAL client path.
 *
 * Mounts the real SessionComposer + slash host under ConfigProvider →
 * Keymap.Provider (fixtures/composer-slash-tab-ft.run.ts, run in a child
 * `bun --conditions browser` so solid-js resolves to its client build) and
 * drives raw stdin bytes through the native input parser.
 *
 * Why a provider-mounted FT is mandatory here: the client's keymap installs a
 * PREPENDED renderer keypress listener and a handled binding calls
 * preventDefault + stopPropagation (applyBindingEventEffects) BEFORE the
 * textarea's own handlers. The bare palette FT harness (no provider) would
 * keep passing even if the layer were never registered — the same "green in
 * tests, dead in the app" trap the ↑/↓ history fix documented.
 *
 * Consumption proof: a keypress spy appended after mount sits BEHIND the
 * prepended keymap listener in the same global emitter, so a consumer key
 * never reaches it (stopPropagation). For a non-consumed Tab the spy records
 * `{ name: "tab", prevented: false }` — pinned below on the plain-text,
 * mid-token, gated and argument-phase cases, which makes "no spy record" a
 * real signal.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const fixture = join(import.meta.dir, "fixtures", "composer-slash-tab-ft.run.ts")

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

/** A key consumed by the keymap layer never reaches the appended spy. */
function expectConsumed(state: Record<string, any>) {
	expect(state.lastKey).toBeUndefined()
	expect(state.buffer).not.toContain("\t")
}

/** Tab was not ours: the appended spy sees it un-prevented. */
function expectNativeTab(state: Record<string, any>) {
	expect(state.lastKey).toMatchObject({ name: "tab", prevented: false })
}

describe("slash Tab completion under Keymap.Provider (real client path)", () => {
	test("completes by prefix, exact name, common prefix, gate and mid-token guard", async () => {
		const r = await runFt()

		// Unique match: "/he" → "/help " with the argument separator, menu
		// closed, caret at end, nothing sent. The key was consumed.
		expect(r.unique).toMatchObject({ buffer: "/help ", cursor: 6, rows: 0, sent: [] })
		expectConsumed(r.unique)

		// Several candidates: "/s" → the common prefix "/se"; the palette stays
		// open on the extended query.
		expect(r.common).toMatchObject({ buffer: "/se", cursor: 3, rows: 6, query: "/se", sent: [] })
		expectConsumed(r.common)

		// No match: consumed, buffer untouched — no literal tab, no rewrite.
		expect(r.noMatch).toMatchObject({ buffer: "/zzz", cursor: 4, rows: 0, sent: [] })
		expectConsumed(r.noMatch)

		// Plain text: Tab is NOT ours — it falls through untouched (the spy
		// sees it un-prevented), preserving the pre-feature behavior.
		expect(r.plain).toMatchObject({ buffer: "hello", cursor: 5, sent: [] })
		expectNativeTab(r.plain)

		// Exact full name (fish model): "/session" lands on "/session " even
		// though "/sessions" shares the prefix — same command Enter runs. A
		// second Tab is argument-phase native (no drift, no extra space).
		expect(r.exactName).toMatchObject({ buffer: "/session ", cursor: 9, rows: 0, sent: [] })
		expectConsumed(r.exactName)
		expect(r.exactNameAgain).toMatchObject({ buffer: "/session ", cursor: 9, rows: 0, sent: [] })
		expectNativeTab(r.exactNameAgain)

		// Menu open: Tab accepts the highlighted row, not just the typed prefix.
		expect(r.acceptSelected).toMatchObject({ buffer: "/help ", cursor: 6, rows: 0, sent: [] })
		expectConsumed(r.acceptSelected)

		// Argument phase ("/help " already has its space): Tab falls through
		// again — no second completion, no space duplication.
		expect(r.afterComplete).toMatchObject({ buffer: "/help ", cursor: 6, sent: [] })
		expectNativeTab(r.afterComplete)

		// Mid-token caret: the compiled path must NOT feed a fabricated buffer
		// end. Buffer, caret and the still-open menu are all untouched.
		expect(r.midToken).toMatchObject({ buffer: "/help", cursor: 3, rows: 6, query: "/help", sent: [] })
		expectNativeTab(r.midToken)

		// Approval/dialog gate: no completer → native Tab, buffer untouched, the
		// menu is the pre-Tab one (the dialog owns focus in the real app).
		expect(r.gated).toMatchObject({ buffer: "/he", cursor: 3, rows: 6, sent: [] })
		expectNativeTab(r.gated)

		// Esc closed the menu: Tab falls back to the FIRST candidate in table
		// order ("/session"), never the now-invisible highlight ("/sessions").
		expect(r.escThenTab).toMatchObject({ buffer: "/session ", cursor: 9, rows: 0, sent: [] })
		expectConsumed(r.escThenTab)

		// Recall re-sync: after ↑ restores "/" the host derives the CURRENT
		// palette state; the stale pre-recall highlight ("/session") is gone.
		// Fresh query "/" highlights index 1 → "/model".
		expect(r.recallThenTab).toMatchObject({ buffer: "/model ", cursor: 7, rows: 0, sent: [] })
		expectConsumed(r.recallThenTab)
	}, 90_000)
})
