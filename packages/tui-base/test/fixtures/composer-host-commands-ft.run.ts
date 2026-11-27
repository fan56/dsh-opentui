/**
 * FT runner (027 host commands) — mounts the REAL SessionComposer + slash
 * host over a registry built by mergeHostCommands (local rows + the seam's
 * hostCommands face) on the @opentui test renderer, and drives raw stdin
 * bytes through the native input parser. Prints one JSON report.
 *
 * Run by test/composer-host-commands-ft.test.ts in a child
 * `bun --conditions browser` process (solid-js must resolve to its CLIENT
 * build — see fixtures/composer-palette-ft.run.ts for the full rationale).
 * A SEPARATE fixture from the pinned 13-row palette one: its own local set +
 * host rows, so the batch-V5 geometry pins there stay untouched.
 */
import { createTestRenderer } from "@opentui/core/testing"
import { createComponent, render } from "@opentui/solid"
import { applyI18nConfig, t } from "@dsh-opentui/i18n"
import { SessionComposer } from "../../src/routes/session/session-composer"
import { createSlashHost, SlashPalette } from "../../src/routes/session/slash-palette"
import { mergeHostCommands, type SlashCommand } from "../../src/routes/session/commands"
import type { SeamHostCommandRow } from "../../src/seams/session"

// i18n boot parity with the real client: the host twin's display name rides
// t("command.hostSource") — without the boot it fail-opens to the raw key.
// No config → the bundled en default ("/name (plugin)").
applyI18nConfig()

function findTextarea(node: any): any {
	if (!node) return undefined
	if (node.constructor?.name === "TextareaRenderable") return node
	for (const child of node.getChildren?.() ?? []) {
		const hit = findTextarea(child)
		if (hit) return hit
	}
	return undefined
}

async function mount(hostRows: SeamHostCommandRow[]) {
	const setup = await createTestRenderer({ width: 80, height: 16, useMouse: false })
	const ran: string[] = []
	const said: string[] = []
	const sent: string[] = []
	const executed: string[] = []
	const localCommands: SlashCommand[] = [
		{ name: "/help", description: "show available commands", run: () => void ran.push("/help") },
		{ name: "/dup", description: "local duplicate", run: () => void ran.push("/dup") },
	]
	const seam = {
		steer: (text: string) => sent.push(`steer:${text}`),
		hostCommands: {
			list: async () => hostRows,
			execute: async (line: string) => {
				executed.push(line)
				return { text: `host echo: ${line}` }
			},
			available: () => true,
			refresh: () => {},
		},
	} as any
	const host = createSlashHost({
		seam,
		// the v2-entry wiring shape: the merge runs per read over the live host rows
		commands: () => mergeHostCommands(localCommands, hostRows, { t }),
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
	if (!textarea) throw new Error("FT mount: no TextareaRenderable under the renderer root")
	if (!textarea.parent) throw new Error("FT mount: textarea has no parent box")
	const write = async (bytes: string) => {
		setup.renderer.stdin.emit("data", Buffer.from(bytes))
		await setup.flush()
	}
	// the host run is fire-and-forget (`void command.run`) — give the async
	// execute round a tick to settle before the report reads the spies
	const settle = async () => {
		await new Promise((resolve) => setTimeout(resolve, 20))
		await setup.flush()
	}
	const frame = () => setup.captureCharFrame()
	const state = () => ({
		buffer: textarea.plainText as string,
		rows: host.controller.rows(),
		frameHasHostRow: frame().includes("/plugin-cmd plugin one"),
		frameHasDupLocal: frame().includes("/dup local duplicate"),
		// the twin's display name rides the i18n suffix — en boot → "(plugin)"
		frameHasDupTwin: frame().includes("/dup (plugin)"),
	})
	return { setup, host, write, settle, state, ran, said, sent, executed }
}

const report: Record<string, unknown> = {}

// 1. host rows complete in the palette; selecting one executes through the
//    seam (never a local run, never a model send), echo text lands in say
{
	const m = await mount([{ name: "/plugin-cmd", description: "plugin one" }])
	await m.write("/")
	report.openHost = { ...m.state(), total: m.host.commands.length }
	await m.write("plug")
	report.hostNarrow = m.state()
	await m.write("\r")
	await m.settle()
	report.hostEnter = { ...m.state(), ran: m.ran, said: m.said, sent: m.sent, executed: m.executed }
	await m.setup.dispose()
}

// 2. the host row also dispatches WITH arguments (a space closes the menu;
//    the closed-menu line re-parses through dispatchLine)
{
	const m = await mount([{ name: "/plugin-cmd", description: "plugin one" }])
	await m.write("/plugin-cmd extra")
	report.argsLine = m.state()
	await m.write("\r")
	await m.settle()
	report.argsEnter = { ran: m.ran, sent: m.sent, executed: m.executed, said: m.said }
	await m.setup.dispose()
}

// 3. duplicate name: both rows list, the twin carries the i18n source suffix;
//    typing the FULL local name + Enter still runs the LOCAL implementation
//    (exact-name precedence — the twin never swallows the local command)
{
	const m = await mount([{ name: "/dup", description: "plugin twin" }])
	await m.write("/dup")
	report.dupOpen = m.state()
	await m.write("\r")
	await m.settle()
	report.dupEnter = { ...m.state(), ran: m.ran, said: m.said, sent: m.sent, executed: m.executed }
	await m.setup.dispose()
}

process.stdout.write(`${JSON.stringify(report)}\n`)
process.exit(0)
