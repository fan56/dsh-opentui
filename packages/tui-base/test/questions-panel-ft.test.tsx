/**
 * ADR-0011 T5b — questions panel on the REAL render chain.
 *
 * The state machine is covered in bridge-questions-panel.test.ts; this file
 * pins the rendered fields (header / description / detail / option description
 * / multi-select marker / inline input / tab strip) and the key layer against
 * the page's turn-abort keys: digits, arrows, Enter, Esc back out, no turn
 * interrupt, plus the read-only pendingAsks() poller closing a cancelled
 * panel (no ghost panel) and FIFO hand-off between stacked batches.
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
import { DockProvider, DockSeat } from "../src/routes/session/dock-host"
import { TurnOverlayHost } from "../src/routes/session/turn-overlays"
import { TurnCancelKeys, resetNonArmingInterrupt } from "../src/routes/session/turn-cancel"
import {
	TurnOverlayController,
	type BridgeAskSnapshot,
} from "../src/routes/session/turn-overlay-controller"
import type { SeamAskQuestion } from "../src/seams/session"

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

function questionsAsk(eventId: string, questions: SeamAskQuestion[]): BridgeAskSnapshot {
	return { eventId, kind: "questions", questions }
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
										<DockSeat
											composer={() => (
												<box width="100%" height={1} focusable={true}>
													<text wrapMode="none">composer seat</text>
												</box>
											)}
										/>
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

const TWO_SINGLE: SeamAskQuestion[] = [
	{ id: "q1", prompt: "first question", options: [{ label: "a" }, { label: "b" }] },
	{ id: "q2", prompt: "second question", options: [{ label: "x" }, { label: "y" }] },
]

describe("questions panel render (ADR-0011 T5b)", () => {
	test("header / prompt / detail / option description / multi-select marker all render", async () => {
		const q: SeamAskQuestion = {
			id: "q1",
			prompt: "Which database should we use?",
			header: "Migration plan",
			description: "support line",
			detail: "long detail body text",
			multiSelect: true,
			options: [
				{ label: "postgres", description: "robust and familiar" },
				{ label: "sqlite", description: "lightweight" },
			],
		}
		const { setup, controller } = await mount(() => [questionsAsk("t1:ask-1", [q])])
		try {
			const picks = controller.answer([q])
			await settle(setup)
			expect(controller.pendingAsk?.eventId).toBe("t1:ask-1")
			expect(frame(setup)).toContain("Migration plan")
			expect(frame(setup)).toContain("Which database should we use?")
			expect(frame(setup)).toContain("long detail body text")
			expect(frame(setup)).toContain("robust and familiar")
			expect(frame(setup)).toContain("postgres")
			expect(frame(setup)).toContain("sqlite")
			expect(frame(setup)).toContain("□") // hollow multi-select state glyph
			expect(frame(setup)).toContain("Type something.") // optional inline input

			controller.decline()
			await settle(setup)
			expect(await picks).toEqual([])
		} finally {
			await setup.dispose()
		}
	})

	test("tab strip shows question navigation; picking is via digits and review submit via Enter", async () => {
		const { setup, controller } = await mount(() => [questionsAsk("t1:ask-2", TWO_SINGLE)])
		try {
			const picks = controller.answer(TWO_SINGLE)
			await settle(setup)
			expect(frame(setup)).toContain("[1] · 2")

			setup.mockInput.pressKey("1") // q1 → "a"
			await settle(setup)
			expect(controller.pendingAsk?.picks[0]).toEqual(["a"])
			expect(controller.pendingAsk?.index).toBe(1) // auto-advanced

			setup.mockInput.pressKey("2") // q2 → "y"
			await settle(setup)
			expect(controller.pendingAsk?.picks[1]).toEqual(["y"])
			expect(controller.pendingAsk?.phase).toBe("review")

			setup.mockInput.pressArrow("down") // review row → q2
			setup.mockInput.pressArrow("down") // review row → Submit
			await settle(setup)
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(await picks).toEqual([
				{ questionId: "q1", selected: "a" },
				{ questionId: "q2", selected: "y" },
			])
		} finally {
			await setup.dispose()
		}
	})
})

describe("questions panel keys vs turn abort (ADR-0011 T5b)", () => {
	test("arrows switch question; Esc backs out one stage at a time and declining never interrupts the turn", async () => {
		const { setup, controller, calls } = await mount(() => [questionsAsk("t1:ask-3", TWO_SINGLE)])
		try {
			const picks = controller.answer(TWO_SINGLE)
			await settle(setup)

			setup.mockInput.pressArrow("right")
			await settle(setup)
			expect(controller.pendingAsk?.index).toBe(1)

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(controller.pendingAsk?.index).toBe(0)
			expect(controller.pendingAsk?.phase).toBe("questions")

			setup.mockInput.pressEscape()
			await settle(setup)
			expect(await picks).toEqual([])
			expect(controller.pendingAsk).toBeUndefined()
			// Turn-abort semantics stay untouched: modal layer consumed Esc.
			expect(calls).not.toContain("interrupt")
			expect(calls).not.toContain("confirmStop")
			expect(calls).not.toContain("quit")
			expect(calls).not.toContain("page:escape")
			expect(frame(setup)).not.toContain("first question")
		} finally {
			await setup.dispose()
		}
	})

	test("multi-select Space toggles, Enter confirms, review Submit resolves selections[]", async () => {
		const q: SeamAskQuestion = {
			id: "q1",
			prompt: "checks?",
			options: [{ label: "lint" }, { label: "smoke" }],
			multiSelect: true,
		}
		const { setup, controller } = await mount(() => [questionsAsk("t1:ask-4", [q])])
		try {
			const picks = controller.answer([q])
			await settle(setup)
			setup.mockInput.pressKey(" ")
			await settle(setup)
			setup.mockInput.pressArrow("down")
			setup.mockInput.pressKey(" ")
			await settle(setup)
			expect(controller.pendingAsk?.picks[0]).toEqual(["lint", "smoke"])
			expect(frame(setup)).toContain("■") // filled multi-select state glyph

			setup.mockInput.pressEnter() // confirm → review
			await settle(setup)
			expect(controller.pendingAsk?.phase).toBe("review")
			expect(frame(setup)).toContain("Review answers")

			setup.mockInput.pressArrow("down") // 1 question: cursor → Submit
			setup.mockInput.pressEnter()
			await settle(setup)
			expect(await picks).toEqual([
				{ questionId: "q1", selected: "lint", selections: ["lint", "smoke"] },
			])
		} finally {
			await setup.dispose()
		}
	})

	test("printable keys land in the resident custom input; Enter commits free text", async () => {
		const q: SeamAskQuestion = { id: "q1", prompt: "anything else?", options: [{ label: "a" }] }
		const { setup, controller } = await mount(() => [questionsAsk("t1:ask-5", [q])])
		try {
			const picks = controller.answer([q])
			await settle(setup)
			setup.mockInput.pressKey("x")
			setup.mockInput.pressKey("y")
			await settle(setup)
			expect(controller.pendingAsk?.phase).toBe("input")
			expect(controller.inlineText).toBe("xy")

			setup.mockInput.pressEnter()
			await settle(setup)
			expect(await picks).toEqual([{ questionId: "q1", selected: "", custom: "xy" }])
		} finally {
			await setup.dispose()
		}
	})
})

describe("questions panel lifecycle (ADR-0011 T5b)", () => {
	test("a cancelled ask closes the panel via the read-only snapshot poller (declined, no ghost)", async () => {
		const q: SeamAskQuestion = { id: "q1", prompt: "ephemeral question", options: [{ label: "a" }] }
		let snapshot: BridgeAskSnapshot[] = [questionsAsk("t1:ask-6", [q])]
		const { setup, controller } = await mount(() => snapshot)
		try {
			const picks = controller.answer([q])
			await settle(setup)
			expect(frame(setup)).toContain("ephemeral question")

			// Host cancels / timeout / turn end: the seam drops the entry. The
			// 200 ms poller settles the provider promise with [] without a frame.
			snapshot = []
			await new Promise((resolveTick) => setTimeout(resolveTick, 350))
			await settle(setup)
			expect(await picks).toEqual([])
			expect(controller.pendingAsk).toBeUndefined()
			expect(frame(setup)).not.toContain("ephemeral question")
		} finally {
			await setup.dispose()
		}
	})

	test("stacked batches hand off FIFO: the next panel opens after the first settles", async () => {
		const first: SeamAskQuestion = { id: "q1", prompt: "first batch", options: [{ label: "a" }] }
		const second: SeamAskQuestion = { id: "q2", prompt: "second batch", options: [{ label: "b" }] }
		const { setup, controller } = await mount(() => [
			questionsAsk("t1:ask-7", [first]),
			questionsAsk("t1:ask-8", [second]),
		])
		try {
			const firstPicks = controller.answer([first])
			const secondPicks = controller.answer([second])
			await settle(setup)
			expect(frame(setup)).toContain("first batch")
			expect(frame(setup)).not.toContain("second batch")
			expect(frame(setup)).toContain("1 more waiting")

			setup.mockInput.pressEnter() // lone single-select auto-settles
			await settle(setup)
			expect(await firstPicks).toEqual([{ questionId: "q1", selected: "a" }])
			expect(frame(setup)).toContain("second batch")
			expect(frame(setup)).not.toContain("first batch")

			setup.mockInput.pressEnter()
			await settle(setup)
			expect(await secondPicks).toEqual([{ questionId: "q2", selected: "b" }])
			expect(frame(setup)).not.toContain("second batch")
		} finally {
			await setup.dispose()
		}
	})
})
