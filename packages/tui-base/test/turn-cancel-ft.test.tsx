/**
 * turn-cancel-ft.test.tsx — the cancel/quit contract on the REAL renderer
 * through the production Keymap layer chain + DialogProvider stack:
 *
 *   - busy + confirmStop: the 1st Esc paints the arm hint ("Press Esc again
 *     to stop") and fires NOTHING; the 2nd Esc inside the window calls
 *     confirmStop exactly once (the dialog is the caller's seam — this file
 *     pins the gesture, the dialog itself is covered by the page wiring
 *     guard and dialog-confirm's own tests);
 *   - a late 2nd Esc (window expired) re-arms instead of confirming;
 *   - idle Esc falls through (no arm, no call — the composer keeps its esc);
 *   - a disabled layer (dialog open) never arms;
 *   - Ctrl+C no longer paints a timing hint: idle opens the quit dialog,
 *     busy interrupts first and opens the dialog on the second press; the
 *     dialog's confirm runs props.quit and Esc cancels without quitting.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import { ConfigProvider, resolve } from "../src/config"
import { ThemeProvider, createThemeSource } from "../src/context/theme"
import { Keymap } from "../src/context/keymap"
import { ClipboardProvider, type ClipboardService } from "../src/context/clipboard"
import { ToastProvider } from "../src/ui/toast"
import { DialogProvider, useDialog } from "../src/ui/dialog"
import { TurnCancelKeys } from "../src/routes/session/turn-cancel"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})
afterAll(() => setLanguages(new Map()))

const keymapConfig = {
	keybinds: { get: () => [] },
} as unknown as Parameters<typeof Keymap.Provider>[0]["config"]

const ESC_HINT = "Press Esc again to stop"
const QUIT_HINT = "Press Ctrl+C again to quit" // must be gone from the rendered frame
const QUIT_TITLE = "Quit dsh-opentui?"

const clipboard: ClipboardService = { read: async () => undefined, write: async () => {} }

type Setup = Awaited<ReturnType<typeof testRender>>

/** Flush the keymap effect, layout and the deferred stdin parse tick. */
async function settle(setup: Setup, rounds = 4): Promise<void> {
	for (let index = 0; index < rounds; index += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5))
		await setup.renderOnce()
	}
}

function tree(child: () => JSX.Element) {
	return (
		<ConfigProvider config={resolve({}, {})}>
			<ThemeProvider mode="dark" source={createThemeSource("")}>
				<Keymap.Provider config={keymapConfig}>
					<ClipboardProvider value={clipboard}>
						<ToastProvider>
							<DialogProvider>{child()}</DialogProvider>
						</ToastProvider>
					</ClipboardProvider>
				</Keymap.Provider>
			</ThemeProvider>
		</ConfigProvider>
	)
}

/** The esc-gesture harness: page layer always enabled (no dialog in play). */
async function mount(props: {
	busy: () => boolean
	calls: string[]
	enabled?: () => boolean
	confirmStop?: () => void
}) {
	const setup = await testRender(
		() =>
			tree(() => (
				<TurnCancelKeys
					busy={props.busy}
					interrupt={() => props.calls.push("interrupt")}
					confirmStop={props.confirmStop ?? (() => props.calls.push("confirmStop"))}
					quit={() => props.calls.push("quit")}
					enabled={props.enabled ?? (() => true)}
				/>
			)),
		{ width: 80, height: 12, exitOnCtrlC: false },
	)
	await settle(setup)
	return { setup, frame: () => setup.captureCharFrame() }
}

/**
 * The quit-gesture harness: TurnCancelKeys is gated off once its DialogConfirm
 * is on the stack (pageOwns parity), so the dialog owns Esc / Enter / Ctrl+C.
 */
async function mountQuit(props: { busy: () => boolean; calls: string[] }) {
	const setup = await testRender(
		() =>
			tree(() => {
				const dialog = useDialog()
				return (
					<TurnCancelKeys
						busy={props.busy}
						interrupt={() => props.calls.push("interrupt")}
						quit={() => props.calls.push("quit")}
						enabled={() => dialog.stack.length === 0}
					/>
				)
			}),
		{ width: 80, height: 12, exitOnCtrlC: false },
	)
	await settle(setup)
	return { setup, frame: () => setup.captureCharFrame() }
}

describe("turn-cancel U6 stop-confirm (real renderer, Keymap layer)", () => {
	test("busy: 1st Esc arms with the hint and fires nothing; 2nd Esc calls confirmStop once", async () => {
		const calls: string[] = []
		const { setup, frame } = await mount({ busy: () => true, calls })
		try {
			expect(frame()).not.toContain(ESC_HINT)

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(frame()).toContain(ESC_HINT)
			expect(calls).toEqual([])

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(calls).toEqual(["confirmStop"])
			// The arm consumed itself: the hint row is gone (the dialog owns esc now).
			expect(frame()).not.toContain(ESC_HINT)
		} finally {
			await setup.dispose()
		}
	})

	test("late 2nd Esc (window expired) re-arms instead of confirming", async () => {
		const calls: string[] = []
		const { setup, frame } = await mount({ busy: () => true, calls })
		try {
			setup.mockInput.pressEscape()
			await settle(setup)
			// Outlive the 500ms arm window before the second press.
			await new Promise((resolve) => setTimeout(resolve, 560))
			await settle(setup)
			expect(frame()).not.toContain(ESC_HINT)

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(calls).toEqual([]) // re-armed, never confirmed
			expect(frame()).toContain(ESC_HINT)
		} finally {
			await setup.dispose()
		}
	})

	test("idle Esc falls through: no arm hint, no call", async () => {
		const calls: string[] = []
		const { setup, frame } = await mount({ busy: () => false, calls })
		try {
			setup.mockInput.pressEscape()
			await settle(setup)
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(calls).toEqual([])
			expect(frame()).not.toContain(ESC_HINT)
		} finally {
			await setup.dispose()
		}
	})

	test("a disabled layer (dialog open) never arms", async () => {
		const calls: string[] = []
		const { setup, frame } = await mount({ busy: () => true, calls, enabled: () => false })
		try {
			setup.mockInput.pressEscape()
			await settle(setup)
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(calls).toEqual([])
			expect(frame()).not.toContain(ESC_HINT)
		} finally {
			await setup.dispose()
		}
	})

	test("ctrl+c on busy interrupts but paints NO timing hint", async () => {
		const calls: string[] = []
		const { setup, frame } = await mount({ busy: () => true, calls })
		try {
			setup.mockInput.pressEscape()
			await settle(setup)
			setup.mockInput.pressCtrlC()
			await settle(setup)
			// ctrl+c interrupted the busy turn and cleared the esc arm — no quit hint.
			expect(calls).toEqual(["interrupt"])
			expect(frame()).not.toContain(QUIT_HINT)
			expect(frame()).not.toContain(ESC_HINT)
		} finally {
			await setup.dispose()
		}
	})
})

describe("turn-cancel ctrl+c quit dialog (real renderer, DialogConfirm stack)", () => {
	test("idle: a single ctrl+c opens the quit dialog (no interrupt, no quit yet)", async () => {
		const calls: string[] = []
		const { setup, frame } = await mountQuit({ busy: () => false, calls })
		try {
			expect(frame()).not.toContain(QUIT_TITLE)
			setup.mockInput.pressCtrlC()
			await settle(setup)
			expect(frame()).toContain(QUIT_TITLE)
			expect(calls).toEqual([])
			expect(frame()).not.toContain(QUIT_HINT)
		} finally {
			await setup.dispose()
		}
	})

	test("idle: confirming (Enter) runs the existing quit path", async () => {
		const calls: string[] = []
		const { setup, frame } = await mountQuit({ busy: () => false, calls })
		try {
			setup.mockInput.pressCtrlC()
			await settle(setup)
			expect(frame()).toContain(QUIT_TITLE)
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(calls).toEqual(["quit"])
			expect(frame()).not.toContain(QUIT_TITLE)
		} finally {
			await setup.dispose()
		}
	})

	test("busy: first ctrl+c interrupts with no dialog; second opens the dialog", async () => {
		const calls: string[] = []
		const { setup, frame } = await mountQuit({ busy: () => true, calls })
		try {
			setup.mockInput.pressCtrlC()
			await settle(setup)
			expect(calls).toEqual(["interrupt"])
			expect(frame()).not.toContain(QUIT_TITLE)

			setup.mockInput.pressCtrlC()
			await settle(setup)
			expect(frame()).toContain(QUIT_TITLE)
			expect(calls).toEqual(["interrupt"]) // still no quit until confirmed
		} finally {
			await setup.dispose()
		}
	})

	test("Esc on the quit dialog cancels it without quitting", async () => {
		const calls: string[] = []
		const { setup, frame } = await mountQuit({ busy: () => false, calls })
		try {
			setup.mockInput.pressCtrlC()
			await settle(setup)
			expect(frame()).toContain(QUIT_TITLE)

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(frame()).not.toContain(QUIT_TITLE)
			expect(calls).toEqual([]) // no quit, no interrupt
		} finally {
			await setup.dispose()
		}
	})
})
