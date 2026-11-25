/**
 * LIVE TRANSCRIPT — /subagents viewer empty-state routing on the real render
 * stack. A single seam face carries the reason; the viewer must show a
 * DIFFERENT line for "not produced yet" / "read failed" / "not running", and
 * must keep calling the face as a METHOD (F2 receiver law). Registered here,
 * not executed by this change.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import {
	FALLBACK_THEME,
	PanelKitProvider,
	PanelStack,
	STATIC_MOTION,
	createHostKeyAdapter,
} from "@dsh-opentui/panel-kit"
import { ConfigProvider, resolve } from "../src/config"
import { ThemeProvider, createThemeSource } from "../src/context/theme"
import { Keymap } from "../src/context/keymap"
import { createTuiPanelKeymapHost } from "../src/context/panel-kit-host"
import { ClipboardProvider, type ClipboardService } from "../src/context/clipboard"
import { ToastProvider } from "../src/ui/toast"
import { DialogProvider } from "../src/ui/dialog"
import {
	SubagentsViewer,
	openSubagentsViewer,
	subagentsViewerOpen,
} from "../src/routes/session/subagents-viewer"
import type {
	SeamSubagentView,
	SessionSeam,
	SubagentTranscriptStatus,
} from "../src/seams/session"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages, "en")
})

const CHILD = "child-empty"
const clipboard: ClipboardService = { read: async () => undefined, write: async () => {} }

/** Method-form fake: both transcript faces read `this`; a bare function
 * reference would throw and give a false green on the receiver law. */
class StatusSeam {
	readonly views: SeamSubagentView[]
	readonly statusCalls: string[] = []
	readonly #status: SubagentTranscriptStatus
	readonly #lines: string[]
	constructor(status: SubagentTranscriptStatus, lines: string[] = []) {
		this.#status = status
		this.#lines = lines
		this.views = [{
			id: CHILD,
			label: "scout",
			status: status === "not-running" ? "completed" : "running",
			rounds: 1,
			startedAt: Date.now(),
		}]
	}
	subagentViews(): SeamSubagentView[] { return this.views }
	onSubagentViews(): () => void { return () => {} }
	subagentTranscript(id: string): string[] {
		if (id !== CHILD) throw new Error("receiver lost")
		return [...this.#lines]
	}
	subagentTranscriptStatus(id: string): SubagentTranscriptStatus {
		if (id !== CHILD) throw new Error("receiver lost")
		this.statusCalls.push(id)
		return this.#status
	}
}

type Setup = Awaited<ReturnType<typeof testRender>>

async function mount(seam: SessionSeam): Promise<Setup> {
	const setup = await testRender(
		() => (
			<ConfigProvider config={resolve({}, { terminalSuspend: true })}>
				<ThemeProvider mode="dark" source={createThemeSource("")}>
					<Keymap.Provider>
						<ClipboardProvider value={clipboard}>
							<ToastProvider>
								<DialogProvider>
									<PanelKitProvider theme={FALLBACK_THEME} motion={STATIC_MOTION} keys={createHostKeyAdapter(createTuiPanelKeymapHost(Keymap.use()))}>
										<PanelStack>
											<SubagentsViewer seam={seam} />
										</PanelStack>
									</PanelKitProvider>
								</DialogProvider>
							</ToastProvider>
						</ClipboardProvider>
					</Keymap.Provider>
				</ThemeProvider>
			</ConfigProvider>
		),
		{ width: 120, height: 34 },
	)
	await setup.waitForVisualIdle()
	openSubagentsViewer()
	await settle(setup)
	setup.mockInput.pressEnter() // LIST → transcript layer
	await settle(setup)
	return setup
}

async function settle(setup: Setup, rounds = 5): Promise<void> {
	for (let index = 0; index < rounds; index += 1) {
		await new Promise((resolve) => setTimeout(resolve, 20))
		await setup.renderOnce()
	}
}

function frame(setup: Setup): string {
	return setup.captureCharFrame().replace(/\s+/g, " ")
}

describe("/subagents transcript empty states", () => {
	test("E8a: running child with no rows says 'no activity yet'", async () => {
		const seam = new StatusSeam("pending")
		const setup = await mount(seam as unknown as SessionSeam)
		try {
			expect(subagentsViewerOpen()).toBe(true)
			expect(frame(setup)).toContain("no activity yet")
			expect(seam.statusCalls).toContain(CHILD) // method call kept `this`
		} finally {
			await setup.dispose()
		}
	})

	test("E8b: failed journal read says 'could not be read'", async () => {
		const seam = new StatusSeam("read-failed")
		const setup = await mount(seam as unknown as SessionSeam)
		try {
			expect(frame(setup)).toContain("could not be read")
		} finally {
			await setup.dispose()
		}
	})

	test("E8c: settled child with no rows says 'not running'", async () => {
		const seam = new StatusSeam("not-running")
		const setup = await mount(seam as unknown as SessionSeam)
		try {
			expect(frame(setup)).toContain("not running")
		} finally {
			await setup.dispose()
		}
	})

	test("E8d: real rows win over any empty status", async () => {
		const seam = new StatusSeam("ready", ["live-row-one", "live-row-two"])
		const setup = await mount(seam as unknown as SessionSeam)
		try {
			const flat = frame(setup)
			expect(flat).toContain("live-row-one")
			expect(flat).toContain("live-row-two")
			expect(flat).not.toContain("no activity yet")
		} finally {
			await setup.dispose()
		}
	})
})
