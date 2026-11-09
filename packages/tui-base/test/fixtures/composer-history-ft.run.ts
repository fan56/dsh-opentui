/**
 * FT runner — shell-style ↑/↓ history on the REAL renderer, mounted under the
 * SAME provider tree the client uses (ConfigProvider → Keymap.Provider).
 *
 * This is the regression the unit tests cannot see: with a Keymap.Provider
 * mounted, ↑/↓ are bound to `input.move.up/down` for the focused textarea and
 * consumed by a prepended renderer listener (preventDefault + stopPropagation)
 * BEFORE the renderable's onKeyDown. Without the composer's priority-1
 * history layer, arrow recall is dead in the app while the bare FT harness
 * (composer-palette-ft, no Keymap.Provider) keeps passing.
 *
 * Drives raw stdin bytes through the native input parser, like a PTY write.
 * Run by test/composer-history-ft.test.ts in a child `bun --conditions browser`
 * process (solid-js client build), prints one JSON report.
 */
import { createTestRenderer } from "@opentui/core/testing"
import { createComponent, render } from "@opentui/solid"
import { SessionComposer } from "../../src/routes/session/session-composer"
import { createSlashHost, SlashPalette } from "../../src/routes/session/slash-palette"
import type { SlashCommand } from "../../src/routes/session/commands"
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

async function mount() {
	const setup = await createTestRenderer({ width: 80, height: 16, useMouse: false })
	const sent: string[] = []
	const said: string[] = []
	const commands: SlashCommand[] = [{ name: "/help", description: "show available commands", run: () => {} }]
	const seam = { steer: (text: string) => sent.push(`steer:${text}`) } as any
	const host = createSlashHost({
		seam,
		commands,
		say: (text) => said.push(text),
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
			slashKeyFilter: host.slashKeyFilter,
			slashSync: (buffer: string) => host.controller.sync(buffer, host.commands),
			interceptSubmit: host.interceptSubmit,
			slashPalette: () => createComponent(SlashPalette, { controller: host.controller, commands: host.commands }),
			slashHeight: () => host.controller.rows(),
		})
	render(
		() =>
			createComponent(ConfigProvider, {
				config: resolve({}, { terminalSuspend: true }),
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
	const write = async (bytes: string) => {
		setup.renderer.stdin.emit("data", Buffer.from(bytes))
		await setup.flush()
	}
	const state = () => ({ buffer: textarea.plainText as string, rows: host.controller.rows(), sent: [...sent] })
	return { setup, write, state }
}

const UP = "\x1b[A"
const DOWN = "\x1b[B"
const ENTER = "\r"
const report: Record<string, unknown> = {}

// 1. Keymap-mounted recall: submit two prompts, then walk with arrows. The
//    bottom stop MUST come back to "(empty)" — if the keymap swallows ↑/↓,
//    every state below stays at the submitted/empty buffer.
{
	const m = await mount()
	await m.write("first message" + ENTER)
	await m.write("second message" + ENTER)
	report.afterSubmits = m.state()
	await m.write(UP)
	report.up1 = m.state()
	await m.write(UP)
	report.up2 = m.state()
	await m.write(UP) // past the oldest: no-op
	report.up3 = m.state()
	await m.write(DOWN)
	report.down1 = m.state()
	await m.write(DOWN) // past the newest: back to the empty draft
	report.down2 = m.state()
	await m.setup.dispose()
}

// 2. Typed single-line draft: the FIRST ↑ recalls (shell-style) and stashes
//    it; ↓ past the newest restores the exact text, not "".
{
	const m = await mount()
	await m.write("committed" + ENTER)
	await m.write("my draft")
	report.draftTyped = m.state()
	await m.write(UP)
	report.draftUp = m.state()
	await m.write(DOWN)
	report.draftRestored = m.state()
	await m.setup.dispose()
}

// 3. Slash palette owns ↑/↓ while open: the buffer stays "/" and the menu
//    does not recall history.
{
	const m = await mount()
	await m.write("committed" + ENTER)
	await m.write("/")
	report.slashOpen = m.state()
	await m.write(UP)
	report.slashUp = m.state()
	await m.write(DOWN)
	report.slashDown = m.state()
	await m.setup.dispose()
}

console.log(JSON.stringify(report))
process.exit(0)
