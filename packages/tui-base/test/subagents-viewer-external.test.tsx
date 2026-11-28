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
import { SubagentsViewer, openSubagentsViewer } from "../src/routes/session/subagents-viewer"
import type { SeamSubagentView, SessionSeam } from "../src/seams/session"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages, "en")
})

const clipboard: ClipboardService = { read: async () => undefined, write: async () => {} }

class ExternalSeam {
	readonly interrupted: string[] = []
	readonly transcriptCalls: string[] = []
	constructor(readonly view: SeamSubagentView) {}
	subagentViews(): SeamSubagentView[] { return [this.view] }
	onSubagentViews(): () => void { return () => {} }
	subagentTranscript(id: string): string[] {
		this.transcriptCalls.push(id)
		throw new Error("external detail must not read a local transcript")
	}
	subagentTranscriptStatus(id: string): "not-running" {
		this.transcriptCalls.push(id)
		throw new Error("external detail must not read local transcript status")
	}
	async interruptChild(id: string): Promise<void> { this.interrupted.push(id) }
	steerChild(): boolean { throw new Error("external detail must not steer") }
}

type Setup = Awaited<ReturnType<typeof testRender>>
const frame = (setup: Setup): string => setup.captureCharFrame().replace(/\s+/g, " ")
async function settle(setup: Setup, rounds = 5): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		await new Promise((resolve) => setTimeout(resolve, 20))
		await setup.renderOnce()
	}
}
async function waitForFrame(setup: Setup, predicate: (flat: string) => boolean): Promise<string> {
	const deadline = Date.now() + 4_000
	for (;;) {
		const flat = frame(setup)
		if (predicate(flat)) return flat
		if (Date.now() > deadline) throw new Error(`timed out\n${flat}`)
		await new Promise((resolve) => setTimeout(resolve, 25))
		await setup.renderOnce()
	}
}
async function mount(view: SeamSubagentView): Promise<{ setup: Setup; seam: ExternalSeam }> {
	const seam = new ExternalSeam(view)
	const setup = await testRender(
		() => (
			<ConfigProvider config={resolve({}, { terminalSuspend: true })}>
				<ThemeProvider mode="dark" source={createThemeSource("")}>
					<Keymap.Provider>
						<ClipboardProvider value={clipboard}>
							<ToastProvider>
								<DialogProvider>
									<PanelKitProvider theme={FALLBACK_THEME} motion={STATIC_MOTION} keys={createHostKeyAdapter(createTuiPanelKeymapHost(Keymap.use()))}>
										<PanelStack><SubagentsViewer seam={seam as unknown as SessionSeam} /></PanelStack>
									</PanelKitProvider>
								</DialogProvider>
							</ToastProvider>
						</ClipboardProvider>
					</Keymap.Provider>
				</ThemeProvider>
			</ConfigProvider>
		),
		{ width: 80, height: 30 },
	)
	await setup.waitForVisualIdle()
	openSubagentsViewer()
	await waitForFrame(setup, (flat) => flat.includes("ext Research"))
	return { setup, seam }
}
async function enterDetail(setup: Setup): Promise<void> {
	setup.mockInput.pressEnter()
	await waitForFrame(setup, (flat) => flat.includes("Subagent transcript"))
	await settle(setup)
}

const external = (status: SeamSubagentView["status"], summary?: string): SeamSubagentView => ({
	id: "ext", label: "research", status, rounds: 0, mode: "external", noTranscript: true,
	...(summary !== undefined ? { summary } : {}),
})

describe("external subagent viewer on the real render stack", () => {
	test("running detail uses the external empty state, disables Enter, and keeps x×2 stop", async () => {
		const { setup, seam } = await mount(external("running"))
		try {
			await enterDetail(setup)
			let flat = frame(setup)
			expect(flat).toContain("external agent — no local transcript is available")
			expect(flat).not.toContain("enter steer")
			expect(flat).toContain("x×2 stop")
			expect(seam.transcriptCalls).toEqual([])
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(frame(setup)).not.toContain("Steer Research")
			setup.mockInput.pressKey("x")
			await new Promise((resolve) => setTimeout(resolve, 140))
			await setup.renderOnce()
			setup.mockInput.pressKey("x")
			await settle(setup)
			expect(seam.interrupted).toEqual(["ext"])
		} finally {
			await setup.dispose()
		}
	})

	test("unknown detail shows summary, hides stop, and ignores x", async () => {
		const { setup, seam } = await mount(external("unknown", "external result summary"))
		try {
			await enterDetail(setup)
			const flat = frame(setup)
			expect(flat).toContain("external result summary")
			expect(flat).toContain("unknown")
			expect(flat).not.toContain("x×2 stop")
			expect(flat).not.toContain("enter steer")
			setup.mockInput.pressKey("x")
			await new Promise((resolve) => setTimeout(resolve, 140))
			await setup.renderOnce()
			setup.mockInput.pressKey("x")
			await settle(setup)
			expect(seam.interrupted).toEqual([])
			expect(seam.transcriptCalls).toEqual([])
		} finally {
			await setup.dispose()
		}
	})
})
