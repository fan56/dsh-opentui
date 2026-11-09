/**
 * FT runner — slash Tab completion on the REAL renderer under the SAME
 * provider tree the client uses (ConfigProvider → Keymap.Provider).
 *
 * This is the regression shape the history fix documented: with a
 * Keymap.Provider mounted, the keymap installs a PREPENDED renderer keypress
 * listener that consumes keys BEFORE the renderable's onKeyDown. A bare
 * onKeyDown Tab handler passes in the palette FT harness (no provider) and is
 * dead in the app. The composer therefore binds `prompt.autocomplete.complete`
 * (default tab) on the same priority-1 layer as history.
 *
 * The keypress SPY attached after mount runs inside the same global listener
 * list, AFTER the prepended keymap listener, so `defaultPrevented` tells us
 * whether the keymap layer consumed Tab before the textarea saw it.
 *
 * Drives raw stdin bytes through the native input parser (a PTY write), like
 * the history fixture. Run by test/composer-slash-tab-ft.test.ts in a child
 * `bun --conditions browser` process (solid-js client build); prints one JSON.
 */
import { createTestRenderer } from "@opentui/core/testing"
import { createComponent, render } from "@opentui/solid"
import { SessionComposer } from "../../src/routes/session/session-composer"
import { createSlashHost, SlashPalette } from "../../src/routes/session/slash-palette"
import type { SlashCommand } from "../../src/routes/session/commands"
import { ComposerHistory } from "../../src/routes/session/composer-state"
import { ConfigProvider, resolve } from "../../src/config"
import { Keymap } from "../../src/context/keymap"

function findTextarea(node: any): any {
	if (!node) return undefined
	if (node.constructor?.name === "TextareaRenderable") return node
	for (const child of node.getChildren?.() ?? []) {
		const hit = findTextarea(child)
		if (hit) return hit
	}
	return undefined
}

async function mount(
	options: { config?: Record<string, unknown>; history?: string[]; gated?: boolean } = {},
) {
	const setup = await createTestRenderer({ width: 80, height: 16, useMouse: false })
	const sent: string[] = []
	const commands: SlashCommand[] = [
		{ name: "/help", description: "show available commands", run: () => {} },
		{ name: "/model", description: "switch model", run: () => {} },
		{ name: "/session", description: "session info", run: () => {} },
		{ name: "/sessions", description: "resume a session", run: () => {} },
		{ name: "/search", description: "search history", run: () => {} },
		{ name: "/think", description: "reasoning effort", run: () => {} },
	]
	const history = new ComposerHistory()
	for (const entry of options.history ?? []) history.append(entry)
	const seam = { steer: (text: string) => sent.push(`steer:${text}`) } as any
	const host = createSlashHost({
		seam,
		commands,
		say: () => {},
		clear: () => {},
		reload: () => {},
		quit: () => {},
		pickOne: async () => undefined,
	})
	const composer = () =>
		createComponent(SessionComposer, {
			seam,
			send: (text: string) => {
				sent.push(text)
				return Promise.resolve()
			},
			history: options.history ? history : undefined,
			slashKeyFilter: host.slashKeyFilter,
			slashSync: (buffer: string) => host.controller.sync(buffer, host.commands),
			interceptSubmit: host.interceptSubmit,
			// `gated` mirrors the examples' approval/dialog gate: while a dialog
			// owns the screen the composer passes NO completer (undefined = fall
			// through, never steal the key).
			slashComplete: options.gated ? undefined : host.slashComplete,
			slashPalette: () => createComponent(SlashPalette, { controller: host.controller, commands: host.commands }),
			slashHeight: () => host.controller.rows(),
		})
	render(
		() =>
			createComponent(ConfigProvider, {
				config: resolve(options.config ?? {}, { terminalSuspend: true }),
				get children() {
					return createComponent(Keymap.Provider, {
						get children() {
							return composer()
						},
					})
				},
			}),
		setup.renderer,
	)
	await setup.flush()
	const textarea = findTextarea(setup.renderer.root)
	if (!textarea) throw new Error("FT mount: no TextareaRenderable under the renderer root")

	// Consumption probe: appended AFTER the keymap's prepended listener.
	let lastKey: { name: string; prevented: boolean; stopped: boolean } | undefined
	setup.renderer.keyInput.on("keypress", (event: any) => {
		lastKey = { name: event.name, prevented: event.defaultPrevented, stopped: event.propagationStopped }
	})
	const write = async (bytes: string) => {
		lastKey = undefined
		setup.renderer.stdin.emit("data", Buffer.from(bytes))
		await setup.flush()
	}
	/** Lone ESC is ambiguous to the parser until its timeout — wait it out. */
	const pause = async () => {
		await new Promise((resolve) => setTimeout(resolve, 150))
		await setup.flush()
	}
	const state = () => ({
		buffer: textarea.plainText as string,
		cursor: textarea.cursorOffset as number,
		rows: host.controller.rows(),
		query: host.controller.query(),
		sent: [...sent],
		lastKey,
	})
	return { setup, write, pause, state, textarea }
}

const TAB = "\t"
const ESC = "\x1b"
const DOWN = "\x1b[B"
const UP = "\x1b[A"
const report: Record<string, unknown> = {}

// 1. Unique match: Tab fills "/help " (trailing separator), the menu closes,
//    the caret lands at the end, nothing is sent, and the keymap layer
//    CONSUMED the key (the textarea's own keypress handler never runs).
{
	const m = await mount()
	await m.write("/he")
	await m.write(TAB)
	report.unique = m.state()
	await m.setup.dispose()
}

// 2. Several candidates with a longer common prefix: "/s" → "/se", menu stays
//    open, no trailing space (the name phase survives).
{
	const m = await mount()
	await m.write("/s")
	await m.write(TAB)
	report.common = m.state()
	await m.setup.dispose()
}

// 3. No match: Tab is consumed but the buffer is untouched — the literal tab
//    never reaches the editor.
{
	const m = await mount()
	await m.write("/zzz")
	await m.write(TAB)
	report.noMatch = m.state()
	await m.setup.dispose()
}

// 4. Ordinary text: Tab is NOT ours — it falls through (the spy sees the key
//    un-prevented; the native textarea ignores tab, so the buffer is intact).
{
	const m = await mount()
	await m.write("hello")
	await m.write(TAB)
	report.plain = m.state()
	await m.setup.dispose()
}

// 5. Exact full name (fish model): "/session" has a longer same-prefix sibling
//    ("/sessions"), yet Tab lands on "/session " — the same command Enter
//    runs. A second Tab is argument-phase native (not consumed, no drift).
{
	const m = await mount()
	await m.write("/session")
	await m.write(TAB)
	report.exactName = m.state()
	await m.write(TAB)
	report.exactNameAgain = m.state()
	await m.setup.dispose()
}

// 6. Accept the highlighted row: "/" → the first palette row + separator.
{
	const m = await mount()
	await m.write("/")
	await m.write(TAB)
	report.acceptSelected = m.state()
	await m.setup.dispose()
}

// 7. Argument phase: after "/help " Tab is native again (not consumed).
{
	const m = await mount()
	await m.write("/he")
	await m.write(TAB)
	await m.write(TAB)
	report.afterComplete = m.state()
	await m.setup.dispose()
}

// 8. Mid-token caret: "/help" with the caret between "e" and "l" + Tab must
//    leave the buffer, the caret AND the menu untouched (the guard is live in
//    the real wiring, not fed a fabricated buffer end). Tab falls through.
{
	const m = await mount()
	await m.write("/help")
	m.textarea.cursorOffset = 3
	await m.setup.flush()
	await m.write(TAB)
	report.midToken = m.state()
	await m.setup.dispose()
}

// 9. Approval/dialog gate (examples wiring): a dialog owning the screen means
//    NO completer is passed, so Tab is not consumed and nothing is rewritten.
{
	const m = await mount({ gated: true })
	await m.write("/he")
	await m.write(TAB)
	report.gated = m.state()
	await m.setup.dispose()
}

// 10. Esc closes the menu; Tab must then fall back to the first candidate
//     (documented behavior) — the now-invisible highlight is NOT consulted.
{
	const m = await mount()
	await m.write("/se")
	await m.write(DOWN) // highlight /sessions (index 1)
	await m.write(ESC) // close the menu, buffer untouched
	await m.pause()
	await m.write(TAB)
	report.escThenTab = m.state()
	await m.setup.dispose()
}

// 11. History recall writes the buffer without a content change; the host
//     re-syncs before deciding. Stale state would pick the pre-recall query's
//     highlight; the fresh state picks index 1 of "/" (now "/model").
{
	const m = await mount({ history: ["/"] })
	await m.write("/se")
	await m.write(DOWN) // stale highlight: /sessions (index 1)
	await m.write(ESC)
	await m.pause()
	await m.write(UP) // recall "/" (palette closed → history owns ↑)
	m.textarea.cursorOffset = 1 // recall lands at 0; complete from the end
	await m.setup.flush()
	await m.write(TAB)
	report.recallThenTab = m.state()
	await m.setup.dispose()
}

console.log(JSON.stringify(report))
process.exit(0)
