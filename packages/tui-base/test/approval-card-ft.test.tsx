/**
 * ADR-0011 T5a — approval card on the REAL render chain.
 *
 * The state machine is covered in bridge-approval-card.test.ts; this file
 * pins the key layer against the page's turn-abort keys: Enter confirms,
 * Esc rejects the card WITHOUT interrupting the turn, and the escalation
 * actions (a/s) stay inside the dialog's modal layer. Also verifies the
 * read-only pendingAsks() poller closes a cancelled card (no ghost card).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import { Keymap } from "../src/context/keymap"
import { InputOwnershipProvider, useIsPageOwner } from "../src/context/input-ownership"
import { ClipboardProvider, type ClipboardService } from "../src/context/clipboard"
import { ThemeProvider, createThemeSource } from "../src/context/theme"
import { ConfigProvider, resolve } from "../src/config"
import { ToastProvider } from "../src/ui/toast"
import { DialogProvider } from "../src/ui/dialog"
import { DockProvider } from "../src/routes/session/dock-host"
import { TurnOverlayHost } from "../src/routes/session/turn-overlays"
import { TurnCancelKeys, resetNonArmingInterrupt } from "../src/routes/session/turn-cancel"
import {
	TurnOverlayController,
	type BridgeAskSnapshot,
} from "../src/routes/session/turn-overlay-controller"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})
afterAll(() => setLanguages(new Map()))
beforeEach(resetNonArmingInterrupt)

type Setup = Awaited<ReturnType<typeof testRender>>

const keymapConfig = { keybinds: { get: () => [] } } as unknown as Parameters<typeof Keymap.Provider>[0]["config"]
const clipboard: ClipboardService = { read: async () => undefined, write: async () => {} }

/** The page's real turn-abort layer plus a probe that logs page-level keys. */
function PageAndCancelKeys(props: { calls: string[] }) {
	const pageOwns = useIsPageOwner()
	Keymap.createLayer(() => ({
		mode: "global",
		enabled: pageOwns,
		commands: [{ bind: "f6", run: () => { props.calls.push("page:f6"); return true } }],
	}))
	return (
		<TurnCancelKeys
			busy={() => true}
			interrupt={() => props.calls.push("interrupt")}
			confirmStop={() => props.calls.push("confirmStop")}
			quit={() => props.calls.push("quit")}
			enabled={pageOwns}
		/>
	)
}

async function mount(snapshot: () => readonly BridgeAskSnapshot[] = () => []) {
	const controller = new TurnOverlayController()
	controller.attachPendingAsks(snapshot)
	const calls: string[] = []
	const setup = await testRender(
		() => (
			<ConfigProvider config={resolve({}, { terminalSuspend: true })}>
				<ThemeProvider mode="dark" source={createThemeSource("")}>
					<Keymap.Provider config={keymapConfig}>
						<ClipboardProvider value={clipboard}>
							<ToastProvider>
								<InputOwnershipProvider>
									<DialogProvider>
										<DockProvider>
											<TurnOverlayHost controller={controller} />
											<PageAndCancelKeys calls={calls} />
										</DockProvider>
									</DialogProvider>
								</InputOwnershipProvider>
							</ToastProvider>
						</ClipboardProvider>
					</Keymap.Provider>
				</ThemeProvider>
			</ConfigProvider>
		),
		{ width: 80, height: 30, exitOnCtrlC: false },
	)
	await settle(setup)
	return { setup, controller, calls }
}

async function settle(setup: Setup, rounds = 6): Promise<void> {
	for (let index = 0; index < rounds; index += 1) {
		await new Promise((resolveTick) => setTimeout(resolveTick, 5))
		await setup.renderOnce()
	}
}

const frame = (setup: Setup): string => setup.captureCharFrame()

describe("approval card keys (ADR-0011 T5a)", () => {
	test("card renders tool name + arg summary; Enter confirms, closes the card", async () => {
		const { setup, controller } = await mount()
		try {
			const verdict = controller.requestApproval("bash", { command: "git status" })
			await settle(setup)
			expect(frame(setup)).toContain("Approval: bash")
			expect(frame(setup)).toContain("git status")

			setup.mockInput.pressEnter()
			await settle(setup)
			expect(await verdict).toBe("allowed-once")
			expect(controller.pendingApproval).toBeUndefined()
			expect(frame(setup)).not.toContain("Approval: bash")
		} finally {
			await setup.dispose()
		}
	})

	test("Esc rejects the card but NEVER interrupts the busy turn", async () => {
		const { setup, controller, calls } = await mount()
		try {
			const verdict = controller.requestApproval("rm", { path: "/tmp/x" })
			await settle(setup)
			expect(frame(setup)).toContain("Approval: rm")

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(await verdict).toBe("rejected")
			// Turn-abort semantics stay untouched: no interrupt / no arm / no quit.
			expect(calls).not.toContain("interrupt")
			expect(calls).not.toContain("confirmStop")
			expect(calls).not.toContain("quit")
			expect(controller.pendingApproval).toBeUndefined()
		} finally {
			await setup.dispose()
		}
	})

	test("escalation actions render and their keys resolve always/session", async () => {
		const snapshot: BridgeAskSnapshot[] = [
			{ eventId: "t1:ask-1", kind: "approval", toolName: "bash", callId: "c-1", escalation: true },
		]
		const { setup, controller, calls } = await mount(() => snapshot)
		try {
			const first = controller.requestApproval("bash", { callId: "c-1" })
			await settle(setup)
			expect(frame(setup)).toContain("always")
			expect(frame(setup)).toContain("session")

			setup.mockInput.pressKey("a")
			await settle(setup)
			expect(await first).toBe("always")

			const second = controller.requestApproval("bash", { callId: "c-1" })
			await settle(setup)
			setup.mockInput.pressKey("s")
			await settle(setup)
			expect(await second).toBe("session")
			expect(calls).not.toContain("interrupt")
		} finally {
			await setup.dispose()
		}
	})

	test("a cancelled ask closes the card via the read-only snapshot poller", async () => {
		let snapshot: BridgeAskSnapshot[] = [
			{ eventId: "t1:ask-1", kind: "approval", toolName: "bash", callId: "c-1" },
		]
		const { setup, controller } = await mount(() => snapshot)
		try {
			const verdict = controller.requestApproval("bash", { callId: "c-1" })
			await settle(setup)
			expect(frame(setup)).toContain("Approval: bash")

			// Host cancels; the seam drops the entry from pendingAsks(). The
			// 200 ms poller must settle the card without any frame from the UI.
			snapshot = []
			await new Promise((resolveTick) => setTimeout(resolveTick, 350))
			await settle(setup)
			expect(await verdict).toBe("rejected")
			expect(controller.pendingApproval).toBeUndefined()
			expect(frame(setup)).not.toContain("Approval: bash")
		} finally {
			await setup.dispose()
		}
	})
})
