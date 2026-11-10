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
		// 11 more matches so an OPEN palette on "/" has 13 rows for MAX_ROWS
		// slots — pins the OVERFLOW CAP at the real renderer (an uncapped <For>
		// painted every row out of the fixed-height box onto the textarea) and
		// the reserved `… N more` hint row.
		{ name: "/extra1", description: "e1", run: () => {} },
		{ name: "/extra2", description: "e2", run: () => {} },
		{ name: "/extra3", description: "e3", run: () => {} },
		{ name: "/extra4", description: "e4", run: () => {} },
		{ name: "/extra5", description: "e5", run: () => {} },
		{ name: "/extra6", description: "e6", run: () => {} },
		{ name: "/extra7", description: "e7", run: () => {} },
		{ name: "/extra8", description: "e8", run: () => {} },
		{ name: "/extra9", description: "e9", run: () => {} },
		{ name: "/extra10", description: "e10", run: () => {} },
		{ name: "/extra11", description: "e11", run: () => {} },
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
	// Hand-run defense (fixture is also executed bare for its JSON report):
	// a mount that lost its textarea (or its parent box) would still emit
	// plausible-looking garbage below — null composerHeight, empty buffers.
	// Fail loudly here instead; `textarea.parent` at :87 must be real.
	if (!textarea) throw new Error("FT mount: no TextareaRenderable under the renderer root")
	if (!textarea.parent) throw new Error("FT mount: textarea has no parent box (composerHeight would be null)")
	const write = async (bytes: string) => {
		setup.renderer.stdin.emit("data", Buffer.from(bytes))
		await setup.flush()
	}
	const state = () => ({
		buffer: textarea.plainText as string,
		rows: host.controller.rows(),
		query: host.controller.query(),
		// The composer ROOT box height (the textarea's parent): the flicker
		// regression is this number changing per keystroke while the palette
		// narrows (global reflow, border flicker). STABLE-HEIGHT pins it.
		composerHeight: textarea.parent?.height ?? null,
		frameHasHelpRow: setup.captureCharFrame().includes("/help show available commands"),
		frameHasNewRow: setup.captureCharFrame().includes("/new start a fresh session"),
		// OVERFLOW CAP: "/extra11" is the 13th match (past the MAX_ROWS cap) —
		// it must never paint anywhere in the frame, box or no box.
		frameHasOverflowRow: setup.captureCharFrame().includes("/extra11"),
		// the reserved row reports what the cap hides
		frameHasMoreHint: /…\s*3\s*more/.test(setup.captureCharFrame()),
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
