/**
 * /agents on the panel-kit modal stack: the real layer chain, not a stand-in.
 *
 * Mounted through @opentui/solid testRender with the production host wiring
 * (Keymap.Provider → PanelKitProvider + PanelStack, the same shape
 * PanelKitHost mounts in examples/v2-entry.tsx), so keys travel the real path:
 * the kit's modal table for Escape, the focused List for arrows/Enter/paging,
 * and the consumer's own Keymap layer for the m/t/d/v/l hotkeys.
 *
 * Covers: the 8-level table → fields → picker/effort/deep/viewer and
 * table → limits → limitEdit chains with Esc popping exactly one layer per
 * press, table column rendering (including the label first-column fallback),
 * the List.pageSize window boundaries, `/agents <name>` preselect and the
 * close summary carrying the changed-name list.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createComponent, onMount } from "solid-js"
import {
	FALLBACK_THEME,
	PanelKitProvider,
	PanelStack,
	STATIC_MOTION,
	createHostKeyAdapter,
	usePanels,
	type PanelStackApi,
} from "@dsh-opentui/panel-kit"
import { Keymap } from "../src/context/keymap"
import { createTuiPanelKeymapHost } from "../src/context/panel-kit-host"
import { AgentsPanel, agentsPanelOpen, openAgentsPanel } from "../src/routes/session/agents-panel"
import type { SessionSeam } from "../src/seams/session"
import type { SeamAgentRow } from "../src/seams/session"

const keymapConfig = {
	keybinds: { get: () => [] },
} as unknown as Parameters<typeof Keymap.Provider>[0]["config"]

interface FakeAgent extends SeamAgentRow {}

function corpus(count: number): FakeAgent[] {
	return Array.from({ length: count }, (_, index) => ({
		name: `agent${String(index).padStart(2, "0")}`,
		displayName: `Agent ${String(index).padStart(2, "0")}`,
		model: index === 0 ? "bigmodel/glm-5.3" : "other/model",
		thinking: "high",
		deep: index,
		description: `does task ${index}`,
		maxRounds: index === 0 ? 12 : undefined,
		background: index === 0,
		file: `/tmp/agent${index}.md`,
	}))
}

interface FakeSeam {
	seam: SessionSeam
	writes: { name: string; field: string; value: string | null }[]
}

interface FakeSeamOptions {
	/** Land the model write, then reject the effort write (P2-3). */
	failThinking?: boolean
}

function fakeSeam(rows: FakeAgent[], options: FakeSeamOptions = {}): FakeSeam {
	const writes: { name: string; field: string; value: string | null }[] = []
	const corpus = rows.map((row) => ({ ...row }))
	const seam = {
		modelCatalog: async () => [
			{ providerID: "bigmodel", modelID: "glm-5.3" },
			{ providerID: "other", modelID: "model" },
		],
		agents: {
			list: () => corpus,
			dir: () => "/home/u/.dsh/agents",
			set: (name: string, field: string, value: string | null) => {
				writes.push({ name, field, value })
				if (options.failThinking === true && field === "thinking") {
					return { target: { kind: "frontmatter" }, error: "thinking write refused" }
				}
				// Mirror the real seam: writes are re-read by the panel.
				const row = corpus.find((entry) => entry.name === name)
				if (row !== undefined) {
					if (field === "deep") row.deep = Number(value)
					else if (field === "maxRounds") row.maxRounds = value === null ? undefined : Number(value)
					else if (field === "background") row.background = value === "true"
					else if (field === "model") row.model = value ?? undefined
					// thinking is composed with the model; the panel only re-reads
				}
				return { target: { kind: "frontmatter" } }
			},
			body: () => "You are the workhorse.\nSecond prompt line.",
			modelEfforts: async (providerID: string, modelID: string) =>
				providerID === "other"
					? []
					: [
							{ id: "low", name: "Low" },
							{ id: "high", name: "High" },
						],
			officialCaps: async () => ({ maxActiveSubagents: 8, maxDepth: 1 }),
		},
	} as unknown as SessionSeam
	return { seam, writes }
}

function PanelsProbe(props: { onReady: (api: PanelStackApi) => void }) {
	onMount(() => props.onReady(usePanels()))
	return null
}

/**
 * Stand-in for the session transcript pager: a lower-priority global layer
 * that records the paging keys which fell through the panel layer.
 */
function PagerSpy(props: { onPage: (key: string) => void }) {
	Keymap.createLayer(() => ({
		mode: "global",
		priority: 0,
		commands: (["pageup", "pagedown", "home", "end"] as const).map((key) => ({
			bind: key,
			title: `spy ${key}`,
			group: "Spy",
			run: () => {
				props.onPage(key)
				return true
			},
		})),
	}))
	return null
}

function Harness(props: {
	seam: SessionSeam
	onClosed?: (summary?: string) => void
	onPanels?: (api: PanelStackApi) => void
	onPage?: (key: string) => void
}) {
	const keymap = Keymap.use()
	const keys = createHostKeyAdapter(createTuiPanelKeymapHost(keymap))
	return (
		<PanelKitProvider theme={FALLBACK_THEME} motion={STATIC_MOTION} keys={keys}>
			<PanelStack>
				{createComponent(AgentsPanel, {
					get seam() {
						return props.seam
					},
					onClosed: props.onClosed,
				})}
				{props.onPanels === undefined ? undefined : <PanelsProbe onReady={props.onPanels} />}
				{props.onPage === undefined ? undefined : <PagerSpy onPage={props.onPage} />}
			</PanelStack>
		</PanelKitProvider>
	)
}

async function mount(options: {
	rows: FakeAgent[]
	onClosed?: (summary?: string) => void
	onPanels?: (api: PanelStackApi) => void
	onPage?: (key: string) => void
	preselect?: string
	width?: number
	height?: number
	failThinking?: boolean
}): Promise<{ setup: Awaited<ReturnType<typeof testRender>>; writes: FakeSeam["writes"]; frame: () => string }> {
	const fake = fakeSeam(options.rows, { failThinking: options.failThinking })
	const setup = await testRender(
		() => (
			<Keymap.Provider config={keymapConfig}>
				<Harness
					seam={fake.seam}
					onClosed={options.onClosed}
					onPanels={options.onPanels}
					onPage={options.onPage}
				/>
			</Keymap.Provider>
		),
		{ width: options.width ?? 120, height: options.height ?? 34 },
	)
	await settle(setup)
	openAgentsPanel(options.preselect)
	await settle(setup)
	return { setup, writes: fake.writes, frame: () => setup.captureCharFrame() }
}

/** Flush the effect that consumes the open bridge, layout, and the deferred
 * focus tick (1 ms from FocusRoot / editor refs). */
async function settle(setup: Awaited<ReturnType<typeof testRender>>, rounds = 4): Promise<void> {
	for (let index = 0; index < rounds; index += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5))
		await setup.renderOnce()
	}
}

/** Poll until `predicate` holds (the close summary lands on a 3 ms refocus
 * timer, so a fixed wait can lose a loaded-worker race). */
async function settleUntil(
	setup: Awaited<ReturnType<typeof testRender>>,
	predicate: () => boolean,
): Promise<void> {
	for (let index = 0; index < 100; index += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5))
		await setup.renderOnce()
		if (predicate()) return
	}
}

function text(frame: string): string {
	return frame.replace(/\s+/g, " ")
}

describe("/agents panel-kit modal (8 layers)", () => {
	test("table renders the column headers and the label first-column fallback", async () => {
		const { setup, frame } = await mount({ rows: corpus(3) })
		try {
			const flat = text(frame())
			expect(flat).toContain("NAME")
			expect(flat).toContain("MODEL")
			expect(flat).toContain("THINK")
			expect(flat).toContain("DEEP")
			expect(flat).toContain("LIMITS")
			// label fallback: the display name is not in cells.name
			expect(flat).toContain("Agent 00")
			expect(flat).toContain("bigmodel/glm-5.3")
			expect(flat).toContain("rounds 12 · background")
			expect(agentsPanelOpen()).toBe(true)
		} finally {
			await setup.dispose()
		}
	})

	test("drill-down chain pushes one stacked layer per level; Esc pops one per press", async () => {
		const summaries: (string | undefined)[] = []
		const { setup, frame } = await mount({ rows: corpus(3), onClosed: (summary) => summaries.push(summary) })
		try {
			// table → fields (Enter on the focused List selects the active row)
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(text(frame())).toContain("FIELD")
			expect(text(frame())).toContain("✎ model")
			expect(text(frame())).toContain("bigmodel/glm-5.3")

			// fields → picker (letter hotkey on the consumer layer)
			setup.mockInput.pressKey("m")
			await settle(setup)
			expect(text(frame())).toContain("PROVIDER")
			expect(text(frame())).toContain("glm-5.3")

			// picker → effort (the fake ladder is non-empty)
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(text(frame())).toContain("EFFORT")
			expect(text(frame())).toContain("(provider default)")

			// effort → picker → fields, one Esc each
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(text(frame())).toContain("PROVIDER")
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(text(frame())).toContain("FIELD")

			// fields → deep editor; Esc back to fields
			setup.mockInput.pressKey("d")
			await settle(setup)
			expect(text(frame())).toContain("Max spawn depth")
			expect(text(frame())).toContain("0 = this agent never spawns subagents")
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(text(frame())).toContain("FIELD")

			// fields → viewer; Esc back to fields
			setup.mockInput.pressKey("v")
			await settle(setup)
			expect(text(frame())).toContain("You are the workhorse.")
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(text(frame())).toContain("FIELD")

			// fields → table: only the layer pops, the manager stays on screen
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(text(frame())).toContain("LIMITS")
			expect(text(frame())).toContain("NAME")
			expect(agentsPanelOpen()).toBe(true)

			// table → limits → limitEdit; Esc back twice, then close
			setup.mockInput.pressKey("l")
			await settle(setup)
			expect(text(frame())).toContain("maxRounds")
			expect(text(frame())).toContain("assistant messages before wrap-up")
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(text(frame())).toContain("Max rounds")
			expect(text(frame())).toContain("positive integer")
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(text(frame())).toContain("maxRounds")
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(text(frame())).toContain("LIMITS")

			setup.mockInput.pressEscape()
			await settleUntil(setup, () => summaries.length > 0)
			expect(agentsPanelOpen()).toBe(false)
			expect(summaries.at(-1)).toBe("Agents unchanged.")
		} finally {
			await setup.dispose()
		}
	})

	test("pageSize pages with PgUp/PgDn; the boundary never paints 13 rows", async () => {
		const { setup, frame } = await mount({ rows: corpus(14) })
		try {
			const first = text(frame())
			expect(first).toContain("1-12/14")
			expect(first).toContain("Agent 00")
			expect(first).not.toContain("Agent 12")

			setup.mockInput.pressKey("\u001b[6~") // PgDn
			await settle(setup)
			const second = text(frame())
			expect(second).toContain("13-14/14")
			expect(second).toContain("Agent 12")
			expect(second).toContain("Agent 13")
			expect(second).not.toContain("Agent 00")

			setup.mockInput.pressKey("\u001b[H") // Home → first page
			await settle(setup)
			expect(text(frame())).toContain("1-12/14")
		} finally {
			await setup.dispose()
		}
	})

	test("/agents <name> preselects the exact agent row", async () => {
		const { setup, frame } = await mount({ rows: corpus(5), preselect: "agent03" })
		try {
			// The active row is agent03, so the first Enter opens ITS fields.
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(text(frame())).toContain("Agent 03")
			expect(text(frame())).toContain("does task 3")
		} finally {
			await setup.dispose()
		}
	})

	test("empty corpus lands on limits and Esc closes the manager", async () => {
		const summaries: (string | undefined)[] = []
		const { setup, frame } = await mount({ rows: [], onClosed: (summary) => summaries.push(summary) })
		try {
			const flat = text(frame())
			expect(flat).toContain("Limits")
			expect(flat).toContain("no agents in /home/u/.dsh/agents yet")
			expect(flat).toContain("maxActiveSubagents")
			expect(flat).toContain("8 · official concurrent-children cap")
			expect(flat).not.toContain("maxRounds")
			setup.mockInput.pressEscape()
			await settleUntil(setup, () => summaries.length > 0)
			expect(agentsPanelOpen()).toBe(false)
			expect(summaries.at(-1)).toBe("Agents unchanged.")
		} finally {
			await setup.dispose()
		}
	})

	test("a deep write rides seam.set and the close summary reports the change", async () => {
		const summaries: (string | undefined)[] = []
		const { setup, writes, frame } = await mount({ rows: corpus(2), onClosed: (summary) => summaries.push(summary) })
		try {
			setup.mockInput.pressEnter() // fields
			await settle(setup)
			setup.mockInput.pressKey("d") // deep editor
			await settle(setup)
			expect(text(frame())).toContain("Max spawn depth")
			setup.mockInput.pressBackspace()
			setup.mockInput.pressKey("4")
			await settle(setup)
			setup.mockInput.pressEnter() // commit (consumer Keymap "return")
			await settle(setup)
			expect(writes).toEqual([{ name: "agent00", field: "deep", value: "4" }])
			expect(text(frame())).toContain("max depth 4 saved")

			setup.mockInput.pressEscape() // deep → fields (reports the saved depth)
			await settle(setup)
			expect(text(frame())).toContain("saved agent00 → max depth 4")

			setup.mockInput.pressEscape() // fields → table
			await settle(setup)
			setup.mockInput.pressEscape() // table → closed
			await settleUntil(setup, () => summaries.length > 0)
			expect(summaries.at(-1)).toBe("Agents updated: agent00")
		} finally {
			await setup.dispose()
		}
	})

	test("broken files are hidden but counted on the table and limits layers", async () => {
		const rows: FakeAgent[] = [
			...corpus(2),
			{ name: "broken0", displayName: "Broken Agent", deep: 0, file: "/tmp/broken0.md", broken: "invalid frontmatter" },
		]
		const { setup, frame } = await mount({ rows })
		try {
			const table = text(frame())
			expect(table).toContain("1 broken file(s) ignored")
			expect(table).not.toContain("Broken Agent")

			setup.mockInput.pressKey("l") // table → limits
			await settle(setup)
			const limits = text(frame())
			expect(limits).toContain("maxRounds")
			expect(limits).toContain("1 broken file(s) ignored")
		} finally {
			await setup.dispose()
		}
	})

	test("14 rows at pageSize 12: ↓ walks to the last row and keeps it visible", async () => {
		const { setup, frame } = await mount({ rows: corpus(14) })
		try {
			expect(text(frame())).toContain("1-12/14")
			for (let index = 0; index < 13; index += 1) {
				setup.mockInput.pressArrow("down")
				await settle(setup, 2)
			}
			const flat = text(frame())
			expect(flat).toContain("Agent 13")
			expect(flat).toContain("13-14/14")
		} finally {
			await setup.dispose()
		}
	})

	test("a landed model write still reports changed when the effort write fails", async () => {
		const summaries: (string | undefined)[] = []
		const { setup, writes, frame } = await mount({
			rows: corpus(2),
			failThinking: true,
			onClosed: (summary) => summaries.push(summary),
		})
		try {
			setup.mockInput.pressEnter() // fields
			await settle(setup)
			setup.mockInput.pressKey("m") // picker
			await settle(setup)
			setup.mockInput.pressArrow("down") // other/model has no ladder → direct commit
			await settle(setup)
			setup.mockInput.pressEnter()
			await settle(setup)

			expect(writes).toEqual([
				{ name: "agent00", field: "model", value: "other/model" },
				{ name: "agent00", field: "thinking", value: null },
			])
			const flat = text(frame())
			expect(flat).toContain("thinking not saved: thinking write refused")
			expect(flat).toContain("model agent00 → other/model saved")
			expect(flat).toContain("FIELD")

			setup.mockInput.pressEscape() // fields → table
			await settle(setup)
			setup.mockInput.pressEscape() // table → closed
			await settleUntil(setup, () => summaries.length > 0)
			expect(summaries.at(-1)).toBe("Agents updated: agent00")
		} finally {
			await setup.dispose()
		}
	})

	test("a kit layer on top parks the letter hotkeys (no leak below the confirm)", async () => {
		let panels: PanelStackApi | undefined
		const { setup, frame } = await mount({ rows: corpus(2), onPanels: (api) => (panels = api) })
		try {
			setup.mockInput.pressEnter() // table → fields
			await settle(setup)
			expect(text(frame())).toContain("FIELD")

			void panels!.confirm({ title: "Confirm write", message: "Proceed with the write?" })
			await settle(setup)
			expect(text(frame())).toContain("Proceed with the write?")

			// Before the stack gate this pushed the model picker ABOVE the confirm.
			setup.mockInput.pressKey("m")
			await settle(setup)
			expect(text(frame())).toContain("Proceed with the write?")
			expect(text(frame())).not.toContain("PROVIDER")

			// Cancelling the confirm re-enables the hotkeys on the fields layer.
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(text(frame())).not.toContain("Proceed with the write?")
			setup.mockInput.pressKey("m")
			await settle(setup)
			expect(text(frame())).toContain("PROVIDER")
		} finally {
			await setup.dispose()
		}
	})

	test("15 rows: PgDn/PgUp/Home/End page the table and move the cursor", async () => {
		const pages: string[] = []
		const { setup, frame } = await mount({ rows: corpus(15), onPage: (key) => pages.push(key) })
		try {
			expect(text(frame())).toContain("1-12/15")

			setup.mockInput.pressKey("\u001b[6~") // PgDn
			await settle(setup)
			expect(text(frame())).toContain("13-15/15")
			// The panel layer consumed it: the session pager never saw the key.
			expect(pages).toEqual([])
			// The cursor sits on the new page's first row: Enter opens Agent 12.
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(text(frame())).toContain("Agent 12")
			expect(text(frame())).toContain("FIELD")
			setup.mockInput.pressEscape()
			await settle(setup)

			setup.mockInput.pressKey("\u001b[5~") // PgUp
			await settle(setup)
			expect(text(frame())).toContain("1-12/15")

			setup.mockInput.pressKey("\u001b[F") // End → last row
			await settle(setup)
			expect(text(frame())).toContain("13-15/15")

			setup.mockInput.pressKey("\u001b[H") // Home → first row
			await settle(setup)
			expect(text(frame())).toContain("1-12/15")
			expect(pages).toEqual([])
		} finally {
			await setup.dispose()
		}
	})

	test("12 rows (one page): PgDn falls through to the session pager", async () => {
		const pages: string[] = []
		const { setup, frame } = await mount({ rows: corpus(12), onPage: (key) => pages.push(key) })
		try {
			expect(text(frame())).not.toContain("/12")
			setup.mockInput.pressKey("\u001b[6~") // PgDn
			await settle(setup)
			// Not consumed by the panel: the spy (session pager stand-in) gets it
			// and the table window is untouched.
			expect(pages).toEqual(["pagedown"])
			expect(text(frame())).toContain("Agent 00")
			expect(text(frame())).toContain("Agent 11")
		} finally {
			await setup.dispose()
		}
	})

	test("a confirm on top keeps the paging keys; paging resumes after it pops", async () => {
		let panels: PanelStackApi | undefined
		const { setup, frame } = await mount({ rows: corpus(15), onPanels: (api) => (panels = api) })
		try {
			setup.mockInput.pressKey("\u001b[6~") // PgDn → page 2
			await settle(setup)
			expect(text(frame())).toContain("13-15/15")

			void panels!.confirm({ title: "Confirm", message: "Hold the pager" })
			await settle(setup)
			expect(text(frame())).toContain("Hold the pager")

			setup.mockInput.pressKey("\u001b[5~") // PgUp while the confirm is on top
			await settle(setup)
			expect(text(frame())).toContain("Hold the pager")
			expect(text(frame())).toContain("13-15/15") // the panel did not page

			setup.mockInput.pressEscape() // cancel the confirm
			await settle(setup)
			expect(text(frame())).not.toContain("Hold the pager")
			setup.mockInput.pressKey("\u001b[5~") // PgUp now reaches the panel
			await settle(setup)
			expect(text(frame())).toContain("1-12/15")
		} finally {
			await setup.dispose()
		}
	})
})
