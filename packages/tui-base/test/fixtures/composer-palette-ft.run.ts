/**
 * FT runner (batch V5) — mounts the REAL SessionComposer + slash host on the
 * @opentui test renderer and drives raw stdin bytes through the native input
 * parser (the same path a PTY write takes). Prints one JSON report.
 *
 * Run by test/composer-palette-ft.test.ts in a child `bun --conditions
 * browser` process: solid-js must resolve to its CLIENT build (the server
 * build has no reactive scheduling and the reconciler rejects text nodes) —
 * the same pin build-host.ts applies to the dist-host. Not a *.test.ts file,
 * so the plain `bun test` gate never collects it directly.
 */
import { createTestRenderer } from "@opentui/core/testing"
import { createComponent, render } from "@opentui/solid"
import { SessionComposer } from "../../src/routes/session/session-composer"
import { createSlashHost, SlashPalette } from "../../src/routes/session/slash-palette"
import type { SlashCommand } from "../../src/routes/session/commands"

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
	const ran: string[] = []
	const said: string[] = []
	const sent: string[] = []
	const commands: SlashCommand[] = [
		{ name: "/help", description: "show available commands", run: () => void ran.push("/help") },
		{ name: "/new", description: "start a fresh session", run: () => void ran.push("/new") },
	]
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
	render(
		() =>
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
			}),
		setup.renderer,
	)
	await setup.flush()
	const textarea = findTextarea(setup.renderer.root)
	const write = async (bytes: string) => {
		setup.renderer.stdin.emit("data", Buffer.from(bytes))
		await setup.flush()
	}
	const state = () => ({
		buffer: textarea.plainText as string,
		rows: host.controller.rows(),
		query: host.controller.query(),
		frameHasHelpRow: setup.captureCharFrame().includes("/help show available commands"),
		frameHasNewRow: setup.captureCharFrame().includes("/new start a fresh session"),
	})
	return { setup, host, write, state, ran, said, sent }
}

const report: Record<string, unknown> = {}

// 1. key-by-key into an OPEN palette, then Enter runs the highlighted command
{
	const m = await mount()
	await m.write("/")
	report.openSlash = m.state()
	await m.write("h")
	report.keyH = m.state()
	await m.write("e")
	report.keyE = m.state()
	await m.write("\r")
	report.enter = { ...m.state(), ran: m.ran, sent: m.sent }
	await m.setup.dispose()
}

// 2. burst (one write) into an OPEN palette, then Enter
{
	const m = await mount()
	await m.write("/")
	await m.write("he")
	report.burst = m.state()
	await m.write("\r")
	report.burstEnter = { ...m.state(), ran: m.ran, sent: m.sent }
	await m.setup.dispose()
}

// 3. Esc closes the palette and keeps the buffer; a further edit re-arms it
{
	const m = await mount()
	await m.write("/h")
	await m.write("\x1b")
	// lone ESC is ambiguous to the parser until its timeout — wait it out
	await new Promise((resolve) => setTimeout(resolve, 120))
	await m.setup.flush()
	report.esc = m.state()
	await m.write("e")
	report.escThenType = m.state()
	await m.setup.dispose()
}

// 4. zero-match query: no empty strip, Enter yields the unknown row (never a send)
{
	const m = await mount()
	await m.write("/zz")
	report.zeroMatch = m.state()
	await m.write("\r")
	report.zeroMatchEnter = { ...m.state(), said: m.said, sent: m.sent }
	await m.setup.dispose()
}

process.stdout.write(`${JSON.stringify(report)}\n`)
process.exit(0)
