/**
 * ask-keys-ft.test.tsx — the ask surface's keyboard layer on the REAL render
 * chain (`docs/ask-user-panel-spec.md` §5-§7, ADR-0008).
 *
 * Mounted here: Keymap.Provider → InputOwnershipProvider → DialogProvider →
 * DockProvider → TurnOverlayHost (which opens the ask panel in the dock) plus
 * the page's own cancel layer and a probe page layer. Driving real stdin
 * strokes pins:
 *
 *  - the Esc ladder: input → options, question n → question n-1, question 1 →
 *    decline, review → last question, with exactly ONE decline path and no
 *    cycle;
 *  - digit gating: 1-9 quick-pick while the option list is focused, digits
 *    type digits while the resident inline input is focused;
 *  - multi-select Space vs Enter (toggle stays in place, Enter confirms and
 *    advances to the review page);
 *  - page layers stay dead while the dock owns the ownership frame;
 *  - three consecutive Ctrl+C presses never quit the application, and the
 *    batch settlement opens the next queued ask automatically in id order.
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
import { DockProvider, DockSeat, useDock, type DockApi } from "../src/routes/session/dock-host"
import { TurnOverlayHost } from "../src/routes/session/turn-overlays"
import {
	armNonArmingInterrupt,
	createTurnCancel,
	resetNonArmingInterrupt,
	TurnCancelKeys,
} from "../src/routes/session/turn-cancel"
import { TurnOverlayController } from "../src/routes/session/turn-overlay-controller"

beforeAll(() => {
	const { languages } = loadLocales({ bundledDir: bundledLocalesDir() })
	setLanguages(languages)
})
afterAll(() => setLanguages(new Map()))
beforeEach(resetNonArmingInterrupt)

type Setup = Awaited<ReturnType<typeof testRender>>

const keymapConfig = {
	keybinds: { get: () => [] },
} as unknown as Parameters<typeof Keymap.Provider>[0]["config"]

const clipboard: ClipboardService = {
	read: async () => undefined,
	write: async () => {},
}

function CaptureDock(props: { done: (api: DockApi) => void }) {
	props.done(useDock())
	return <box height={0} />
}

/** A page-level layer in the shape every page layer has after ADR-0008: it
 * answers only while the page frame is on top. */
function PageKeys(props: { calls: string[] }) {
	const pageOwns = useIsPageOwner()
	Keymap.createLayer(() => ({
		mode: "global",
		enabled: pageOwns,
		commands: [
			{
				bind: "f6",
				run: () => {
					props.calls.push("page:f6")
					return true
				},
			},
			{
				bind: "escape",
				run: () => {
					props.calls.push("page:escape")
					return true
				},
			},
		],
	}))
	return <box height={0} />
}

function CancelKeys(props: { busy: () => boolean; calls: string[] }) {
	const pageOwns = useIsPageOwner()
	return (
		<TurnCancelKeys
			busy={props.busy}
			interrupt={() => props.calls.push("interrupt")}
			confirmStop={() => props.calls.push("confirmStop")}
			quit={() => props.calls.push("quit")}
			enabled={pageOwns}
		/>
	)
}

async function mount(options: { busy?: () => boolean } = {}) {
	const controller = new TurnOverlayController()
	const calls: string[] = []
	let api: DockApi | undefined
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
											<CaptureDock done={(value) => (api = value)} />
											<DockSeat
												composer={() => (
													<box width="100%" height={1}>
														<text wrapMode="none">composer seat</text>
													</box>
												)}
											/>
											<TurnOverlayHost controller={controller} />
											<CancelKeys busy={options.busy ?? (() => false)} calls={calls} />
											<PageKeys calls={calls} />
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
	if (api === undefined) throw new Error("dock api missing")
	return { setup, api, controller, calls }
}

/** Flush Solid effects, the dock's after-layout focus and the deferred stdin
 * parse tick. */
async function settle(setup: Setup, rounds = 6): Promise<void> {
	for (let index = 0; index < rounds; index += 1) {
		await new Promise((resolveTick) => setTimeout(resolveTick, 5))
		await setup.renderOnce()
	}
}

const frame = (setup: Setup): string => setup.captureCharFrame()

const TWO_SINGLE = [
	{ id: "q1", prompt: "first question", options: [{ label: "a" }, { label: "b" }] },
	{ id: "q2", prompt: "second question", options: [{ label: "x" }, { label: "y" }] },
]

describe("Esc / Ctrl+C ladder (spec §6)", () => {
	test("question 1 → decline: the one and only decline path", async () => {
		const { setup, controller } = await mount()
		try {
			const pending = controller.answer(TWO_SINGLE)
			await settle(setup)
			expect(controller.pendingAsk?.index).toBe(0)

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(controller.pendingAsk).toBeUndefined()
			expect(await pending).toEqual([])
		} finally {
			await setup.dispose()
		}
	})

	test("question n>1 → previous question, then decline at question 1", async () => {
		const { setup, controller } = await mount()
		try {
			const pending = controller.answer(TWO_SINGLE)
			await settle(setup)

			setup.mockInput.pressArrow("right")
			await settle(setup)
			expect(controller.pendingAsk?.index).toBe(1)

			setup.mockInput.pressEscape()
			await settle(setup)
			// One stage per press: back to question 1, batch still live.
			expect(controller.pendingAsk?.index).toBe(0)
			expect(controller.pendingAsk?.phase).toBe("questions")

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(controller.pendingAsk).toBeUndefined()
			expect(await pending).toEqual([])
		} finally {
			await setup.dispose()
		}
	})

	test("inline input → options (no commit), then the list ladder", async () => {
		const { setup, controller } = await mount()
		try {
			const pending = controller.answer([{ id: "q1", prompt: "pick", options: [{ label: "a" }, { label: "b" }] }])
			await settle(setup)
			controller.focusInput()
			await settle(setup)
			expect(controller.pendingAsk?.phase).toBe("input")

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(controller.pendingAsk?.phase).toBe("questions")
			expect(controller.pendingAsk?.customs[0]).toBeUndefined()

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(controller.pendingAsk).toBeUndefined()
			expect(await pending).toEqual([])
		} finally {
			await setup.dispose()
		}
	})

	test("zero-option question: Esc skips the missing list stage and declines", async () => {
		const { setup, controller } = await mount()
		try {
			const pending = controller.answer([{ id: "q1", prompt: "anything?", options: [] }])
			await settle(setup)
			expect(controller.pendingAsk?.phase).toBe("input")

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(controller.pendingAsk).toBeUndefined()
			expect(await pending).toEqual([])
		} finally {
			await setup.dispose()
		}
	})

	test("review → last question (never review again), then back to question 1 and decline", async () => {
		const { setup, controller } = await mount()
		try {
			const pending = controller.answer(TWO_SINGLE)
			await settle(setup)
			controller.toggle("a") // answers q1, advances to q2
			controller.toggle("x") // answers q2 → review
			await settle(setup)
			expect(controller.pendingAsk?.phase).toBe("review")

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(controller.pendingAsk?.phase).toBe("questions")
			expect(controller.pendingAsk?.index).toBe(1)

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(controller.pendingAsk?.index).toBe(0)

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(controller.pendingAsk).toBeUndefined()
			expect(await pending).toEqual([])
		} finally {
			await setup.dispose()
		}
	})

	test("dock Ctrl+C declines without interrupting; the next page Ctrl+C interrupts without arming", async () => {
		const { setup, controller, calls } = await mount({ busy: () => true })
		try {
			controller.answer(TWO_SINGLE)
			await settle(setup)

			setup.mockInput.pressCtrlC() // press 1: the dock owns the key
			await settle(setup)
			expect(controller.pendingAsk).toBeUndefined()
			expect(calls).toEqual([])

			setup.mockInput.pressCtrlC() // press 2: page, one-shot non-arming interrupt
			await settle(setup)
			expect(calls).toEqual(["interrupt"])

			setup.mockInput.pressCtrlC() // press 3: must not quit
			await settle(setup)
			expect(calls).not.toContain("quit")
		} finally {
			await setup.dispose()
		}
	})
})

describe("digit gating (spec §5 constraint 3)", () => {
	test("digits quick-pick the nth option while the list is focused", async () => {
		const { setup, controller } = await mount()
		try {
			const pending = controller.answer([{ id: "q1", prompt: "pick", options: [{ label: "a" }, { label: "b" }] }])
			await settle(setup)

			setup.mockInput.pressKey("2")
			await settle(setup)
			expect(await pending).toEqual([{ questionId: "q1", selected: "b" }])
		} finally {
			await setup.dispose()
		}
	})

	test("digits type digits while the inline input holds focus", async () => {
		const { setup, controller } = await mount()
		try {
			controller.answer([{ id: "q1", prompt: "pick", options: [{ label: "a" }, { label: "b" }] }])
			await settle(setup)
			controller.focusInput()
			await settle(setup)
			expect(controller.pendingAsk?.phase).toBe("input")

			setup.mockInput.pressKey("1")
			await settle(setup)
			// The digit reached the input, not the quick-pick.
			expect(controller.inlineText).toBe("1")
			expect(controller.pendingAsk?.picks[0]).toEqual([])
			expect(controller.pendingAsk).toBeDefined()
		} finally {
			await setup.dispose()
		}
	})

	test("Esc returns focus to the list, so digits quick-pick again", async () => {
		const { setup, controller } = await mount()
		try {
			const pending = controller.answer([{ id: "q1", prompt: "pick", options: [{ label: "a" }, { label: "b" }] }])
			await settle(setup)
			controller.focusInput()
			await settle(setup)

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(controller.pendingAsk?.phase).toBe("questions")

			setup.mockInput.pressKey("2")
			await settle(setup)
			expect(await pending).toEqual([{ questionId: "q1", selected: "b" }])
		} finally {
			await setup.dispose()
		}
	})
})

describe("free-text capture on the options phase (spec §5 focus model)", () => {
	test("a printable character lands in the resident input and moves the phase there", async () => {
		const { setup, controller } = await mount()
		try {
			controller.answer([{ id: "q1", prompt: "pick", options: [{ label: "a" }, { label: "b" }] }])
			await settle(setup)
			expect(controller.pendingAsk?.phase).toBe("questions")

			setup.mockInput.pressKey("x")
			await settle(setup)

			expect(controller.pendingAsk?.phase).toBe("input")
			// The input itself received the key (its onInput wrote the buffer):
			// the character was neither swallowed nor duplicated.
			expect(controller.inlineText).toBe("x")
			expect(controller.pendingAsk?.picks[0]).toEqual([])
			expect(frame(setup)).toContain("x")
		} finally {
			await setup.dispose()
		}
	})

	test("after the capture, digits type instead of quick-picking", async () => {
		const { setup, controller } = await mount()
		try {
			controller.answer([{ id: "q1", prompt: "pick", options: [{ label: "a" }, { label: "b" }] }])
			await settle(setup)

			setup.mockInput.pressKey("x")
			await settle(setup)
			expect(controller.pendingAsk?.phase).toBe("input")

			setup.mockInput.pressKey("2")
			await settle(setup)
			expect(controller.inlineText).toBe("x2")
			expect(controller.pendingAsk?.picks[0]).toEqual([])
			expect(controller.pendingAsk).toBeDefined()
		} finally {
			await setup.dispose()
		}
	})
})

describe("space vs enter (spec §6)", () => {
	test("multi-select: Space toggles in place, Enter confirms and advances to review", async () => {
		const { setup, controller } = await mount()
		try {
			controller.answer([
				{ id: "q1", prompt: "checks?", options: [{ label: "lint" }, { label: "smoke" }], multiSelect: true },
			])
			await settle(setup)

			setup.mockInput.pressKey(" ")
			await settle(setup)
			expect(controller.pendingAsk?.picks[0]).toEqual(["lint"])
			expect(controller.pendingAsk?.phase).toBe("questions")

			setup.mockInput.pressEnter()
			await settle(setup)
			// Enter does not toggle: the picks survive and the batch moves on.
			expect(controller.pendingAsk?.picks[0]).toEqual(["lint"])
			expect(controller.pendingAsk?.phase).toBe("review")
		} finally {
			await setup.dispose()
		}
	})

	test("single-select: Space does nothing, Enter picks and settles a lone batch", async () => {
		const { setup, controller } = await mount()
		try {
			const pending = controller.answer([{ id: "q1", prompt: "pick", options: [{ label: "a" }, { label: "b" }] }])
			await settle(setup)

			setup.mockInput.pressKey(" ")
			await settle(setup)
			expect(controller.pendingAsk).toBeDefined()
			expect(controller.pendingAsk?.picks[0]).toEqual([])

			setup.mockInput.pressEnter()
			await settle(setup)
			expect(await pending).toEqual([{ questionId: "q1", selected: "a" }])
		} finally {
			await setup.dispose()
		}
	})
})

describe("admission and ownership (spec §7, ADR-0008)", () => {
	test("page keys are dead while the dock owns the frame and revive on close", async () => {
		const { setup, controller, calls } = await mount()
		try {
			controller.answer(TWO_SINGLE)
			await settle(setup)

			setup.mockInput.pressKey("\u001B[17~") // F6
			await settle(setup)
			expect(calls).not.toContain("page:f6")

			// Esc reaches the dock's ladder, never the page cancel/keys layer.
			setup.mockInput.pressEscape()
			await settle(setup)
			expect(calls).not.toContain("page:escape")
			expect(controller.pendingAsk).toBeUndefined()

			setup.mockInput.pressKey("\u001B[17~")
			await settle(setup)
			expect(calls).toContain("page:f6")
		} finally {
			await setup.dispose()
		}
	})

	test("ask batches open in request-id order and settle into the next head", async () => {
		const { setup, controller, api } = await mount()
		try {
			const first = controller.answer([{ id: "q1", prompt: "first batch", options: [{ label: "a" }] }])
			await settle(setup)
			const firstId = controller.pendingAsk?.id
			expect(firstId).toBeDefined()

			controller.answer([{ id: "q2", prompt: "second batch", options: [{ label: "b" }] }])
			await settle(setup)
			// Still the first head; the second waits behind it.
			expect(controller.pendingAsk?.id).toBe(firstId)
			expect(frame(setup)).toContain("first batch")
			expect(frame(setup)).not.toContain("second batch")
			expect(frame(setup)).toContain("1 more waiting")

			// Settle the first: the next head opens automatically, id order kept.
			setup.mockInput.pressEnter()
			await settle(setup)
			await first
			const secondId = controller.pendingAsk?.id
			expect(secondId).toBeGreaterThan(firstId)
			expect(frame(setup)).toContain("second batch")
			expect(api.isOpen()).toBe(true)
		} finally {
			await setup.dispose()
		}
	})

	test("an approval takes the slot and preempts a not-yet-open ask", async () => {
		const { setup, controller, api } = await mount()
		try {
			const verdict = controller.requestApproval("bash", { command: "git status" })
			await settle(setup)
			expect(api.isOpen()).toBe(false)

			controller.answer([{ id: "q1", prompt: "queued ask", options: [{ label: "a" }] }])
			await settle(setup)
			expect(api.isOpen()).toBe(false)

			// Enter on the approval card clears the dialog stack and settles the
			// verdict; the queued ask then takes the dock slot.
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(await verdict).toBe("allowed-once")
			expect(api.isOpen()).toBe(true)
			expect(frame(setup)).toContain("queued ask")
		} finally {
			await setup.dispose()
		}
	})
})

describe("controller transitions behind the ladder", () => {
	test("confirmQuestion advances a multi-select question without touching the picks", () => {
		const controller = new TurnOverlayController()
		controller.answer([
			{ id: "q1", prompt: "one", options: [{ label: "a" }], multiSelect: true },
			{ id: "q2", prompt: "two", options: [{ label: "b" }] },
		])
		controller.toggle("a")
		expect(controller.pendingAsk?.picks[0]).toEqual(["a"])
		expect(controller.confirmQuestion()).toBe(true)
		expect(controller.currentQuestion?.id).toBe("q2")
		expect(controller.pendingAsk?.picks[0]).toEqual(["a"])
		// A lone single-select batch has no review page: it refuses.
		const solo = new TurnOverlayController()
		solo.answer([{ id: "solo", prompt: "p", options: [{ label: "o" }] }])
		expect(solo.confirmQuestion()).toBe(false)
	})

	test("switchFocus leaves a zero-option question (the ladder's stage 2)", () => {
		const controller = new TurnOverlayController()
		controller.answer([
			{ id: "q1", prompt: "one", options: [{ label: "a" }] },
			{ id: "q2", prompt: "two", options: [] },
		])
		controller.switchFocus(1)
		expect(controller.currentQuestion?.id).toBe("q2")
		expect(controller.pendingAsk?.phase).toBe("input")
		controller.switchFocus(-1)
		expect(controller.currentQuestion?.id).toBe("q1")
	})
})

describe("one-shot non-arming interrupt (spec §6 hazard)", () => {
	test("the press after the dock's Ctrl+C interrupts without arming; a third never quits", () => {
		const calls: string[] = []
		let busy = true
		const armed: boolean[] = []
		const cancel = createTurnCancel(
			{
				busy: () => busy,
				interrupt: () => {
					calls.push("interrupt")
					busy = false
				},
				confirmStop: () => calls.push("confirmStop"),
				quit: () => calls.push("quit"),
				enabled: () => true,
			},
			(value) => armed.push(value),
		)
		armNonArmingInterrupt()
		expect(cancel.ctrlC()).toBe(true) // press 2
		expect(calls).toEqual(["interrupt"])
		expect(armed).toEqual([])
		expect(cancel.ctrlC()).toBe(true) // press 3: arms at most
		expect(calls).not.toContain("quit")
		expect(armed).toEqual([true])
		cancel.dispose()
	})

	test("an idle page still takes the normal double-press chain (the one-shot is spent)", () => {
		const calls: string[] = []
		const cancel = createTurnCancel(
			{
				busy: () => false,
				interrupt: () => calls.push("interrupt"),
				quit: () => calls.push("quit"),
				enabled: () => true,
			},
			() => {},
		)
		armNonArmingInterrupt()
		cancel.ctrlC() // idle: the one-shot is spent, the gate arms
		cancel.ctrlC() // second idle press quits (the shipped idle convention)
		expect(calls).toEqual(["quit"])
		cancel.dispose()
	})
})
