// Session page skeleton (batch 5): the REAL Transcript + SessionComposer on
// one fake SessionSeam, now with the batch-5 overlay surfaces — the approval
// card (vendored dialog-confirm) and the ask picker (vendored dialog-select),
// mounted through the vendored DialogProvider stack.
//
// A fake turn streams; mid-turn the fake seam fires one approval (the card
// must render over the transcript; enter → turn continues, esc → rejected)
// and one two-question ask (sequential pickers; esc declines the batch).
// After every overlay closes, typing must land in the composer (focus law).
// Run from packages/tui-base: bun examples/session.tsx   (ctrl+c quits)
import { createSignal, onMount } from "solid-js"
import { render } from "@opentui/solid"
import { NullSessionSeam, type SeamAskPick, type SeamAskQuestion, type SeamTranscriptRow, type SeamTurnCallbacks } from "../src/seams/session"
import { createSeamRows } from "../src/routes/session/seam-rows"
import { Transcript } from "../src/routes/session/transcript"
import { SessionComposer, type SessionComposerRef } from "../src/routes/session/session-composer"
import { TurnOverlayController } from "../src/routes/session/turn-overlay-controller"
import { TurnOverlayHost, registerTurnOverlays } from "../src/routes/session/turn-overlays"
import { ConfigProvider, resolve } from "../src/config"
import { ThemeProvider } from "../src/context/theme"
import { Keymap } from "../src/context/keymap"
import { ToastProvider } from "../src/ui/toast"
import { ClipboardProvider } from "../src/context/clipboard"
import { DialogProvider } from "../src/ui/dialog"

const SENTENCES = Number(process.env.S_SENTENCES ?? 24)
const INTERVAL_MS = Number(process.env.S_INTERVAL_MS ?? 250)
const EXIT_AFTER_MS = Number(process.env.S_EXIT_AFTER_MS ?? 0)

/** The questions the fake ask fires mid-turn (one batch, two pickers). */
const DEMO_QUESTIONS: SeamAskQuestion[] = [
	{ id: "q-followup", prompt: "Run a follow-up deep dive?", options: ["yes, deep dive", "summary only"] },
	{ id: "q-format", prompt: "Which output format?", options: ["bullets", "prose"] },
]

class FakeSeam extends NullSessionSeam {
	private steers: string[] = []
	override currentSessionId() {
		return "demo"
	}
	override async storedTranscript(): Promise<SeamTranscriptRow[]> {
		return [
			{ kind: "user", text: "earlier question (stored history)", final: true },
			{ kind: "assistant", text: "Earlier **answer** from stored history.", final: true },
		]
	}
	override steer(text: string): void {
		this.steers.push(text)
	}
	override async turn(text: string, cb: SeamTurnCallbacks): Promise<void> {
		const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
		cb.onThinkingDelta(`Answering: ${text}`)
		for (let n = 1; n <= SENTENCES; n++) {
			for (const steer of this.steers.splice(0)) cb.onContentDelta(`**[steer received: ${steer}]**\n\n`)
			cb.onContentDelta(`${n}. Streamed sentence ${n}.\n\n`)
			if (n === 8) {
				// Approval: the view's turn callback routes through the card.
				const verdict = await cb.onApprove("bash", { command: "git status --short", cwd: "/repo" })
				cb.onContentDelta(`**[approval → ${verdict}]**\n\n`)
			}
			if (n === 16) {
				// Ask: registered provider answers; esc declines (empty picks).
				const picks = await this.ask(DEMO_QUESTIONS)
				cb.onContentDelta(`**[ask → ${describePicks(picks)}]**\n\n`)
			}
			await sleep(INTERVAL_MS)
		}
		for (const steer of this.steers.splice(0)) cb.onContentDelta(`**[steer received: ${steer}]**\n\n`)
	}
}

function describePicks(picks: SeamAskPick[]): string {
	if (picks.length === 0) return "declined"
	return picks.map((p) => `${p.questionId}=${p.selected}`).join(", ")
}

const seam = new FakeSeam()
const overlays = new TurnOverlayController()
registerTurnOverlays(seam, overlays)
let composerRef: SessionComposerRef | undefined

function SessionPage() {
	const projection = createSeamRows(seam, () => seam.currentSessionId() ?? "", {
		// Approval mid-turn routes through the batch-5 card.
		onApprove: (name, args) => overlays.requestApproval(name, args),
	})
	const [, setBusy] = createSignal(false)
	onMount(() => projection.load())
	return (
		<box flexDirection="column" width="100%" height="100%" backgroundColor="black">
			<Transcript seam={seam} projection={projection}>
				<SessionComposer seam={seam} send={projection.send} onBusyChange={setBusy} ref={(r) => (composerRef = r)} />
			</Transcript>
			<TurnOverlayHost
				controller={overlays}
				reclaimFocus={() => {
					if (composerRef && !composerRef.focused()) composerRef.focus()
				}}
			/>
		</box>
	)
}

// The vendored dialog components' provider closure, in the vendored app's
// order (ConfigProvider feeds keybinds/cursor/theme prefs; Keymap the modal
// layers; ThemeProvider the dialog tokens; Toast/Clipboard what
// DialogProvider itself consumes).
render(
	() => (
		<ConfigProvider config={resolve({}, { terminalSuspend: true })}>
			<Keymap.Provider>
				<ToastProvider>
					<ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
						<ClipboardProvider value={{ read: async () => undefined, write: async () => {} }}>
							<DialogProvider>
								<SessionPage />
							</DialogProvider>
						</ClipboardProvider>
					</ThemeProvider>
				</ToastProvider>
			</Keymap.Provider>
		</ConfigProvider>
	),
	{ exitOnCtrlC: true },
)
if (EXIT_AFTER_MS > 0) setTimeout(() => process.exit(0), EXIT_AFTER_MS)
