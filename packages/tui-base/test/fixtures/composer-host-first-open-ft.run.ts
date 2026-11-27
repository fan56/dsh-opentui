/**
 * FT runner (first-open host-command visibility fix) — mounts the REAL
 * SessionComposer + slash host over a signal-backed mergeHostCommands
 * registry and a seam whose `list()` settles LATE (after the palette is
 * already open), driving raw stdin bytes. Prints one JSON report.
 *
 * The slashSync wrapper mirrors examples/v2-entry.tsx's host-command
 * refresh discipline line for line (open edge → refresh + ONE pull; settle
 * applies whenever it lands, resetting the highlight while open) — the same
 * "wiring shape" precedent as fixtures/composer-host-commands-ft.run.ts.
 * Run by test/composer-host-first-open-ft.test.ts in a child
 * `bun --conditions browser` process (solid-js must resolve to its CLIENT
 * build — see fixtures/composer-palette-ft.run.ts for the full rationale).
 *
 * Pins the fix behaviors:
 *   1. FIRST-OPEN VISIBILITY: the very first "/" shows the host row as soon
 *      as the pull settles — no close/reopen needed (the old
 *      pending-until-close rule kept it invisible on the first open);
 *   2. SELECTION RESOLUTION: rows landing mid-open re-anchor the highlight
 *      to row 0 of the merged table (a carried index would point at — and
 *      Enter execute — a different command after the alphabetical merge);
 *   3. NO PULL FLASH: reopening while a second pull is in flight keeps the
 *      previous rows painted (never an empty-list flash).
 */
import { createTestRenderer } from "@opentui/core/testing"
import { createComponent, render } from "@opentui/solid"
import { applyI18nConfig, t } from "@dsh-opentui/i18n"
import { createSignal } from "solid-js"
import { SessionComposer } from "../../src/routes/session/session-composer"
import { createSlashHost, SlashPalette } from "../../src/routes/session/slash-palette"
import { mergeHostCommands, type SlashCommand } from "../../src/routes/session/commands"
import type { SeamHostCommandRow } from "../../src/seams/session"

// i18n boot parity with the real client: the host twin's display name rides
// t("command.hostSource") — without the boot it fail-opens to the raw key.
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

/** Locals sort AROUND the host row: the merged "/" table is
 * ["/alpha", "/mid" (host), "/zeta"] — the host row lands in the MIDDLE, so
 * a carried highlight index 1 flips from "/zeta" to "/mid" without the reset.
 * The host row rides the REAL wire shape — the dsh `commands/list` name has
 * NO leading slash ("mid"); the merge must produce the palette gesture form
 * "/mid" (the bare-name regression this suite pins). */
const LOCAL_COMMANDS: SlashCommand[] = [
	{ name: "/alpha", description: "local alpha", run: () => {} },
	{ name: "/zeta", description: "local zeta", run: () => {} },
]
const HOST_ROWS: SeamHostCommandRow[] = [{ name: "mid", description: "host plugin command" }]
/** The pull delay: longer than a keystroke flush, shorter than the settle. */
const PULL_DELAY_MS = 80

async function mount() {
	const setup = await createTestRenderer({ width: 80, height: 16, useMouse: false })
	const ran: string[] = []
	const said: string[] = []
	const sent: string[] = []
	const executed: string[] = []
	let pullCalls = 0
	let refreshCalls = 0
	// The v2-entry wiring shape: the merge runs per read over the live host
	// rows signal (a plain array would freeze the first paint).
	const [hostRows, setHostRows] = createSignal<readonly SeamHostCommandRow[]>([])
	const seam = {
		steer: (text: string) => sent.push(`steer:${text}`),
		hostCommands: {
			list: async () => {
				pullCalls++
				await new Promise((resolve) => setTimeout(resolve, PULL_DELAY_MS))
				return [...HOST_ROWS]
			},
			execute: async (line: string) => {
				executed.push(line)
				return { text: `host echo: ${line}` }
			},
			available: () => true,
			refresh: () => {
				refreshCalls++
			},
		},
	} as any
	const host = createSlashHost({
		seam,
		commands: () => mergeHostCommands(LOCAL_COMMANDS, hostRows(), { t }),
		say: (text) => said.push(text),
		clear: () => {},
		reload: () => {},
		quit: () => {},
		pickOne: async () => undefined,
	})
	// The v2-entry slashSync wrapper, line for line (the discipline under fix).
	let paletteWasOpen = false
	const applyHostRows = (rows: readonly SeamHostCommandRow[]) => {
		setHostRows(rows)
		if (host.controller.open) host.controller.resetSelection()
	}
	const pullHostRows = () => {
		const face = seam.hostCommands
		if (!face?.available()) return
		void face
			.list()
			.then((rows) => applyHostRows(rows))
			.catch(() => {})
	}
	render(
		() =>
			createComponent(SessionComposer, {
				seam,
				send: (text: string) => {
					sent.push(text)
					return Promise.resolve()
				},
				slashKeyFilter: host.slashKeyFilter,
				slashSync: (buffer: string) => {
					const wasOpen = paletteWasOpen
					host.controller.sync(buffer, host.commands)
					const open = host.controller.open
					if (open && !wasOpen) {
						seam.hostCommands.refresh()
						pullHostRows()
					}
					paletteWasOpen = open
				},
				interceptSubmit: host.interceptSubmit,
				slashPalette: () =>
					createComponent(SlashPalette, { controller: host.controller, commands: host.commands }),
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
	// wait out the pull delay, then let solid flush the applied rows
	const settle = async () => {
		await new Promise((resolve) => setTimeout(resolve, PULL_DELAY_MS + 80))
		await setup.flush()
	}
	const state = () => ({
		buffer: textarea.plainText as string,
		rows: host.controller.rows(),
		total: host.commands.length,
		open: host.controller.open,
		selected: host.controller.selected(),
		current: host.controller.current(host.commands)?.name ?? undefined,
		frameHasHostRow: setup.captureCharFrame().includes("/mid host plugin command"),
	})
	return { setup, host, write, settle, state, ran, said, sent, executed, counters: () => ({ pullCalls, refreshCalls }) }
}

const DOWN = "\x1b[B"
const report: Record<string, unknown> = {}

// 1. FIRST-OPEN VISIBILITY: the very first "/" of a session — palette opens
//    with locals only, the pull settles mid-open, the host row paints. No
//    close, no reopen (the old rule needed one).
{
	const m = await mount()
	await m.write("/")
	report.firstOpen = { ...m.state(), ...m.counters() }
	await m.settle()
	report.firstOpenSettled = { ...m.state(), ...m.counters() }
	await m.setup.dispose()
}

// 2. SELECTION RESOLUTION: highlight moved while open, rows land, the
//    highlight re-anchors to row 0 of the merged table (without the reset it
//    would sit on the "/mid" host twin the cursor never touched); one ↓ then
//    Enter deliberately runs the host row through the seam.
{
	const m = await mount()
	await m.write("/")
	await m.write(DOWN)
	report.hazardSetup = { ...m.state(), ...m.counters() }
	await m.settle()
	report.openSettleSelection = { ...m.state(), ...m.counters() }
	await m.write(DOWN)
	report.afterDown = m.state()
	await m.write("\r")
	await m.settle()
	report.hostRowEnter = { ran: m.ran, said: m.said, sent: m.sent, executed: m.executed, ...m.state() }
	await m.setup.dispose()
}

// 3. NO PULL FLASH: after the rows are in, a real close (submit clears the
//    buffer → the sync observes closed) then a reopen fires the SECOND open
//    edge + pull; mid-flight the FIRST pull's rows keep painting (never an
//    empty list), one pull per observed open edge.
{
	const m = await mount()
	await m.write("/")
	await m.settle()
	await m.write("\r") // runs the highlighted local; the buffer clears → closed
	report.closed = { ...m.state(), ...m.counters(), ran: m.ran, executed: m.executed }
	await m.write("/")
	report.reopenMidPull = { ...m.state(), ...m.counters() }
	await m.settle()
	report.reopenSettled = { ...m.state(), ...m.counters() }
	await m.setup.dispose()
}

process.stdout.write(`${JSON.stringify(report)}\n`)
process.exit(0)
