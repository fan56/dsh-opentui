/**
 * /subagents transcript-layer key routing on the REAL render stack (the
 * `transcriptHandle` reactivity regression).
 *
 * The LIST layer's `x×2` stop and Enter-steer live in a second Keymap layer
 * whose `enabled` gate reads `transcriptHandle?.ownsInput()`. The handle used
 * to be a plain (non-reactive) variable, so when it was assigned by
 * `openTranscript()` the `useBindings` effect never re-ran — `enabled` stayed
 * false forever and BOTH hotkeys were dead once the transcript was top. The
 * fix makes it a `createSignal` (the history-panel `sessionsHandle` law).
 *
 * Repro: mount through the production provider tree, open the viewer (LIST),
 * press Enter into the transcript, then verify `x×2` and Enter reach the seam
 * faces. A `shift+k` case guards that the LIST layer keeps working.
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
import type { SeamSubagentView, SessionSeam } from "../src/seams/session"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})

const CHILD_A = "child-a"
const CHILD_B = "child-b"

const clipboard: ClipboardService = {
	read: async () => undefined,
	write: async () => {},
}

interface FakeSubagents {
	seam: SessionSeam
	interrupted: string[]
	steered: { id: string; text: string }[]
}

function fakeSeam(): FakeSubagents {
	const views: SeamSubagentView[] = [
		{ id: CHILD_A, label: "workhorse", status: "running", rounds: 1, startedAt: Date.now() },
		{ id: CHILD_B, label: "scout", status: "running", rounds: 2, startedAt: Date.now() },
	]
	const interrupted: string[] = []
	const steered: { id: string; text: string }[] = []
	const seam = {
		subagentViews: () => views,
		onSubagentViews: () => () => {},
		subagentTranscript: (id: string) => [`line-1-${id}`, `line-2-${id}`],
		interruptChild: async (id: string) => {
			interrupted.push(id)
		},
		steerChild: (id: string, text: string) => {
			steered.push({ id, text })
			return true
		},
	} as unknown as SessionSeam
	return { seam, interrupted, steered }
}

function Harness(props: { seam: SessionSeam }) {
	const keymap = Keymap.use()
	const keys = createHostKeyAdapter(createTuiPanelKeymapHost(keymap))
	return (
		<PanelKitProvider theme={FALLBACK_THEME} motion={STATIC_MOTION} keys={keys}>
			<PanelStack>
				<SubagentsViewer seam={props.seam} />
			</PanelStack>
		</PanelKitProvider>
	)
}

type Setup = Awaited<ReturnType<typeof testRender>>

function frame(setup: Setup): string {
	return setup.captureCharFrame().replace(/\s+/g, " ")
}

/** Predicate wait per docs/test-framework.md §4.4: sleep THEN render (stdin is
 * parsed a tick after emit), with a wall-clock budget. A timeout throws with
 * the last frame so a dead hotkey is visible in the failure. */
async function waitForFrame(setup: Setup, predicate: (flat: string) => boolean, timeoutMs = 4000): Promise<string> {
	const deadline = Date.now() + timeoutMs
	for (;;) {
		const flat = frame(setup)
		if (predicate(flat)) return flat
		if (Date.now() > deadline) throw new Error(`waitForFrame: timed out after ${timeoutMs}ms\nlast frame:\n${flat}`)
		await new Promise((resolve) => setTimeout(resolve, 25))
		await setup.renderOnce()
	}
}

async function settle(setup: Setup, rounds = 5): Promise<void> {
	for (let index = 0; index < rounds; index += 1) {
		await new Promise((resolve) => setTimeout(resolve, 20))
		await setup.renderOnce()
	}
}

async function mount(seam: SessionSeam): Promise<Setup> {
	const setup = await testRender(
		() => (
			<ConfigProvider config={resolve({}, { terminalSuspend: true })}>
				<ThemeProvider mode="dark" source={createThemeSource("")}>
					<Keymap.Provider>
						<ClipboardProvider value={clipboard}>
							<ToastProvider>
								<DialogProvider>
									<Harness seam={seam} />
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
	// LIST layer is up: both running children rendered (labels are titlecased).
	await waitForFrame(
		setup,
		(flat) => flat.toLowerCase().includes("workhorse") && flat.toLowerCase().includes("scout") && flat.includes("enter transcript"),
	)
	return setup
}

/** Enter on the LIST opens the first running child's transcript layer. */
async function enterTranscript(setup: Setup): Promise<void> {
	setup.mockInput.pressEnter()
	await waitForFrame(setup, (flat) => flat.includes("Subagent transcript") && flat.includes("enter steer"))
}

describe("/subagents transcript-layer keys on the real stack (transcriptHandle reactivity)", () => {
	test("x ×2 in the transcript layer interrupts the selected running child", async () => {
		const fake = fakeSeam()
		const setup = await mount(fake.seam)
		try {
			expect(subagentsViewerOpen()).toBe(true)
			await enterTranscript(setup)

			// Deliberate double press: the arm needs >= 80ms and <= 600ms between
			// the two strokes (a held key's auto-repeat must not complete it).
			setup.mockInput.pressKey("x")
			await new Promise((resolve) => setTimeout(resolve, 140))
			await setup.renderOnce()
			setup.mockInput.pressKey("x")
			await settle(setup)

			expect(fake.interrupted).toContain(CHILD_A)
			expect(fake.interrupted.length).toBe(1)
		} finally {
			await setup.dispose()
		}
	})

	test("Enter in the transcript layer opens the steer prompt and steerChild is called on submit", async () => {
		const fake = fakeSeam()
		const setup = await mount(fake.seam)
		try {
			await enterTranscript(setup)

			setup.mockInput.pressEnter()
			// The steer DialogPrompt title (the placeholder is not in the char frame).
			await waitForFrame(setup, (flat) => flat.includes("Steer Workhorse"))
			// The prompt focuses its textarea on a setTimeout(1); let it land.
			await settle(setup)

			await setup.mockInput.typeText("please refine")
			await settle(setup)
			setup.mockInput.pressEnter()
			await settle(setup)

			expect(fake.steered).toEqual([{ id: CHILD_A, text: "please refine" }])
		} finally {
			await setup.dispose()
		}
	})

	test("LIST layer shift+k still stops all running children (regression guard)", async () => {
		const fake = fakeSeam()
		const setup = await mount(fake.seam)
		try {
			// Still on the LIST layer: shift+k fans out one interrupt per running
			// child. This layer was never broken; the test guards it stays that way.
			setup.mockInput.pressKey("k", { shift: true })
			await settle(setup)

			expect(fake.interrupted.length).toBe(2)
			expect(fake.interrupted).toContain(CHILD_A)
			expect(fake.interrupted).toContain(CHILD_B)
		} finally {
			await setup.dispose()
		}
	})
})
