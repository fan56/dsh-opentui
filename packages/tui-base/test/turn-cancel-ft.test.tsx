/**
 * turn-cancel-ft.test.tsx — the U6 stop-confirm Esc contract on the REAL
 * renderer through the production Keymap layer chain:
 *
 *   - busy + confirmStop: the 1st Esc paints the arm hint ("Press Esc again
 *     to stop") and fires NOTHING; the 2nd Esc inside the window calls
 *     confirmStop exactly once (the dialog is the caller's seam — this file
 *     pins the gesture, the dialog itself is covered by the page wiring
 *     guard and dialog-confirm's own tests);
 *   - a late 2nd Esc (window expired) re-arms instead of confirming;
 *   - idle Esc falls through (no arm, no call — the composer keeps its esc);
 *   - a disabled layer (dialog open) never arms;
 *   - ctrl+c still paints its own quit affordance (the chains stay separate).
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { testRender } from "@opentui/solid"
import { bundledLocalesDir, loadLocales, setLanguages } from "@dsh-opentui/i18n"
import { Keymap } from "../src/context/keymap"
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
const QUIT_HINT = "Press Ctrl+C again to quit"

function Harness(props: {
	busy: () => boolean
	calls: string[]
	enabled?: () => boolean
	confirmStop?: () => void
}) {
	return (
		<TurnCancelKeys
			busy={props.busy}
			interrupt={() => props.calls.push("interrupt")}
			confirmStop={props.confirmStop ?? (() => props.calls.push("confirmStop"))}
			quit={() => props.calls.push("quit")}
			enabled={props.enabled ?? (() => true)}
		/>
	)
}

/** Flush the keymap effect, layout and the deferred stdin parse tick. */
async function settle(setup: Awaited<ReturnType<typeof testRender>>, rounds = 4): Promise<void> {
	for (let index = 0; index < rounds; index += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5))
		await setup.renderOnce()
	}
}

async function mount(props: Parameters<typeof Harness>[0]) {
	const setup = await testRender(
		() => (
			<Keymap.Provider config={keymapConfig}>
				<Harness {...props} />
			</Keymap.Provider>
		),
		{ width: 80, height: 8, exitOnCtrlC: false },
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

	test("ctrl+c keeps its own quit affordance (the arm chains stay separate)", async () => {
		const calls: string[] = []
		const { setup, frame } = await mount({ busy: () => true, calls })
		try {
			setup.mockInput.pressEscape()
			await settle(setup)
			setup.mockInput.pressCtrlC()
			await settle(setup)
			// ctrl+c interrupted the busy turn and painted ITS hint.
			expect(calls).toEqual(["interrupt"])
			expect(frame()).toContain(QUIT_HINT)
			expect(frame()).not.toContain(ESC_HINT)
		} finally {
			await setup.dispose()
		}
	})
})
