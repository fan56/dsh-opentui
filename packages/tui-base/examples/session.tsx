// Session page skeleton (batch 5): the REAL Transcript + SessionComposer on
// one fake SessionSeam, now with the batch-5 overlay surfaces — the approval
// card (vendored dialog-confirm) and the ask picker (vendored dialog-select),
// mounted through the vendored DialogProvider stack.
//
// A fake turn streams; mid-turn the fake seam fires one approval (the card
// must render over the transcript; enter → turn continues, esc → rejected)
// and one two-question ask (sequential pickers; esc declines the batch).
// After every overlay closes, typing must land in the composer (focus law).
// Batch 6: transcript/composer/dialogs render with vendored theme tokens
// (default "opencode"); S_THEME=<bundled name> switches via the ThemeSeam
// stub (validated against the bundled list; unknown names are ignored).
// Batch 7: a powerline footer + busy StatusBar render below the composer —
// theme-token fills (POWERLINE_COLORS only as the no-provider fallback);
// busy/message-count/model come from the composer + seam wiring, the rest
// (effort/context%/tok-s) stay demo props.
// Batch 8: the slash palette — type "/" for the inline command menu (prefix
// filter, ↑↓, enter; esc closes keeping the buffer), the batch-8 core set
// (/help /new /model /quit /sessions /clear) on the fake seam; /model and
// /sessions open vendored DialogSelect pickers through the dialog stack.
// Run from packages/tui-base: bun examples/session.tsx   (ctrl+c quits)
import { createSignal, onCleanup, onMount } from "solid-js"
import { createComponent, render } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { NullSessionSeam, type SeamAskPick, type SeamAskQuestion, type SeamProviderModel, type SeamSessionSummary, type SeamTranscriptRow, type SeamTurnCallbacks } from "../src/seams/session"
import { createSeamRows } from "../src/routes/session/seam-rows"
import { Transcript } from "../src/routes/session/transcript"
import { TranscriptScrollKeys } from "../src/routes/session/transcript-scroll"
import { SessionComposer, type SessionComposerRef } from "../src/routes/session/session-composer"
import { TurnOverlayController } from "../src/routes/session/turn-overlay-controller"
import { TurnOverlayHost, registerTurnOverlays } from "../src/routes/session/turn-overlays"
import { createSlashHost, SlashPalette } from "../src/routes/session/slash-palette"
import { DialogSelect } from "../src/ui/dialog-select"
import { useDialog } from "../src/ui/dialog"
import { PowerlineFooter, sessionFooterSegments } from "../src/routes/session/powerline"
import { StatusBar } from "../src/routes/session/status-bar"
import { ConfigProvider, resolve } from "../src/config"
import { ThemeProvider, useTheme, useThemes } from "../src/context/theme"
import { createThemeSeam } from "../src/seams/theme"
import { Keymap } from "../src/context/keymap"
import { ToastProvider } from "../src/ui/toast"
import { ClipboardProvider } from "../src/context/clipboard"
import { DialogProvider } from "../src/ui/dialog"

const SENTENCES = Number(process.env.S_SENTENCES ?? 24)
const INTERVAL_MS = Number(process.env.S_INTERVAL_MS ?? 250)
const EXIT_AFTER_MS = Number(process.env.S_EXIT_AFTER_MS ?? 0)
const THEME = process.env.S_THEME
/** S_AUTO_TURN=1: fire one fake turn on mount (visual captures). */
const AUTO_TURN = process.env.S_AUTO_TURN === "1"

/** The questions the fake ask fires mid-turn (one batch, two pickers). */
const DEMO_QUESTIONS: SeamAskQuestion[] = [
	{ id: "q-followup", prompt: "Run a follow-up deep dive?", options: ["yes, deep dive", "summary only"] },
	{ id: "q-format", prompt: "Which output format?", options: ["bullets", "prose"] },
]

class FakeSeam extends NullSessionSeam {
	private steers: string[] = []
	/** Session lifecycle for /new + /sessions (batch 8). */
	private sessionID = "ses-1"
	readonly sessions: SeamSessionSummary[] = [
		{ id: "ses-1", title: "batch-8 demo", updatedAt: "2026-11-06" },
		{ id: "ses-2", title: "earlier exploration", updatedAt: "2026-11-05" },
	]
	readonly catalog: SeamProviderModel[] = [
		{ providerID: "bigmodel", modelID: "glm-5.3-flash" },
		{ providerID: "bigmodel", modelID: "glm-4.7" },
		{ providerID: "deepseek", modelID: "v3.2" },
	]
	private model: SeamProviderModel = { providerID: "bigmodel", modelID: "glm-5.3-flash" }
	override currentSessionId() {
		return this.sessionID
	}
	override newSession(): void {
		const n = Number(this.sessionID.split("-")[1] ?? 0) + 1
		this.sessionID = `ses-${n}`
		if (!this.sessions.some((s) => s.id === this.sessionID)) {
			this.sessions.unshift({ id: this.sessionID, title: `fresh session ${n}`, updatedAt: "2026-11-06" })
		}
	}
	override resumeSession(id: string): "ok" | "owned" {
		this.sessionID = id
		return "ok"
	}
	override async listSessions(): Promise<SeamSessionSummary[]> {
		return [...this.sessions]
	}
	override async modelCatalog(): Promise<SeamProviderModel[]> {
		return this.catalog
	}
	override async currentModelSelection() {
		return { ...this.model }
	}
	override selectModel(providerID: string, modelID: string): Promise<void> {
		this.model = { providerID, modelID }
		return Promise.resolve()
	}
	override async storedTranscript(id = this.sessionID): Promise<SeamTranscriptRow[]> {
		if (id === "ses-2") {
			return [
				{ kind: "user", text: "older session prompt", final: true },
				{ kind: "assistant", text: "Older session answer.", final: true },
			]
		}
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

/** The right-aligned footer text: the wall clock (hh:mm:ss). */
function clock(d: Date): string {
	return d.toTimeString().slice(0, 8)
}

const seam = new FakeSeam()
const overlays = new TurnOverlayController()
registerTurnOverlays(seam, overlays)
let composerRef: SessionComposerRef | undefined
// Transcript scrollback (batch 10f): the page owns the scrollbox ref for
// TranscriptScrollKeys (focus stays in the composer; layer gated on an
// empty dialog stack).
let transcriptScroll: ScrollBoxRenderable | undefined

function SessionPage() {
	const projection = createSeamRows(seam, () => seam.currentSessionId() ?? "", {
		// Approval mid-turn routes through the batch-5 card.
		onApprove: (name, args) => overlays.requestApproval(name, args),
	})
	const dialog = useDialog()
	const theme = useTheme()
	const themeSeam = createThemeSeam(useThemes())
	if (THEME && !themeSeam.setTheme(THEME)) console.error(`unknown theme ${THEME}; bundled: ${themeSeam.list().join(", ")}`)

	// Batch-7 footer/status wiring (cheap seam data only):
	// - busy is the composer's onBusyChange OR a page-driven projection turn
	// - message count counts real sends through the projection
	// - model label comes from seam.currentModelSelection()
	// effort / context% / tok-s stay demo props until their seams carry them.
	const [composerBusy, setComposerBusy] = createSignal(false)
	const [turnBusy, setTurnBusy] = createSignal(false)
	const busy = () => composerBusy() || turnBusy()
	const [busySince, setBusySince] = createSignal(0)
	const [msgs, setMsgs] = createSignal(0)
	const [model, setModel] = createSignal<{ providerID: string; modelID: string } | undefined>()
	const [now, setNow] = createSignal(new Date())
	onMount(() => {
		projection.load()
		void seam.currentModelSelection().then(setModel)
		const timer = setInterval(() => setNow(new Date()), 1000)
		onCleanup(() => clearInterval(timer))
		if (AUTO_TURN) void send("batch-7 capture turn")
	})
	const elapsed = () => (busy() ? Math.max(0, Math.floor((now().getTime() - busySince()) / 1000)) : 0)
	const send = (text: string) => {
		setMsgs((n) => n + 1)
		setTurnBusy(true)
		setBusySince(Date.now())
		const done = projection.send(text)
		void done.finally(() => setTurnBusy(false))
		return done
	}
	const segments = () =>
		sessionFooterSegments({
			provider: model()?.providerID,
			model: model()?.modelID,
			effort: "high",
			contextTokens: 4200,
			contextWindow: 10000,
			messages: msgs(),
			tools: 0,
			tps: busy() ? 87 : null,
			theme,
		})
	// Batch-8 slash host: command feedback lands as transcript rows through
	// the projection's event fan-in (assistant rows under a "cmd" message);
	// /clear resets the client-side store; /new + /sessions reload from the
	// seam; /model + /sessions pick through the vendored DialogSelect. The
	// settle path must ALSO drain the dialog stack — a resolved promise
	// alone leaves the picker mounted (TurnOverlayHost drives its stack
	// through the controller; here the promise settles it directly).
	let cmdOrdinal = 0
	const pickOne = (title: string, options: { title: string; value: string }[]) =>
		new Promise<string | undefined>((resolve) => {
			let settled = false
			const done = (value: string | undefined) => {
				if (settled) return
				settled = true
				dialog.clear()
				resolve(value)
			}
			dialog.replace(
				() => (
					<DialogSelect<string>
						title={title}
						renderFilter={false}
						options={options.map((option) => ({ title: option.title, value: option.value }))}
						onSelect={(option) => done(option.value)}
						onCancel={() => done(undefined)}
					/>
				),
				() => done(undefined),
			)
		})
	const slash = createSlashHost({
		seam,
		say: (text) =>
			projection.apply({
				type: "message.part.updated",
				details: { messageID: "cmd", part: { type: "text", id: `cmd-${++cmdOrdinal}`, text } },
			}),
		clear: () => projection.hydrate([]),
		reload: () => {
			const settled = projection.load()
			void seam.currentModelSelection().then(setModel)
			return settled
		},
		quit: () => process.exit(0),
		pickOne,
	})
	return (
		<box flexDirection="column" width="100%" height="100%" backgroundColor="black">
			<Transcript seam={seam} projection={projection} scrollRef={(value) => (transcriptScroll = value)}>
				<SessionComposer
					seam={seam}
					send={send}
					onBusyChange={setComposerBusy}
					ref={(r) => (composerRef = r)}
					slashKeyFilter={slash.slashKeyFilter}
					slashSync={(buffer) => slash.controller.sync(buffer, slash.commands)}
					interceptSubmit={slash.interceptSubmit}
					slashComplete={(buffer) => (dialog.stack.length > 0 ? undefined : slash.slashComplete(buffer))}
					slashPalette={() => (
						<SlashPalette controller={slash.controller} commands={slash.commands} />
					)}
					slashHeight={() => slash.controller.rows()}
				/>
			</Transcript>
			{/* Transcript scrollback keys (batch 10f, transcript-scroll.tsx):
			    PgUp/PgDn scroll the transcript, composer keeps focus; gated OFF
			    while any dialog (approval/ask//model) is open. */}
			<TranscriptScrollKeys scroll={() => transcriptScroll} enabled={() => dialog.stack.length === 0} />
			{/* REACTIVE-PROP LAW (batch 10e, the v2-entry fix family): signal
			    reads ride getters. An eager `busy()` / `segments()` / `now()`
			    read in a JSX prop is tracked by the root render effect (bun's
			    JSX emits eager prop objects), so every 1s clock tick rebuilt
			    the whole subtree and the composer owning the in-flight turn
			    was disposed before its busy=false — "Typing…" never settled. */}
			{/* The `as never` bridges the vendored JSX child slot (Element) to
			    createComponent's BaseRenderable — the v2-entry composition. */}
			{createComponent(StatusBar, {
				get phase() {
					return busy() ? "stream" : null
				},
				elapsed,
			}) as never}
			{createComponent(PowerlineFooter, {
				get left() {
					return segments()
				},
				get right() {
					return clock(now())
				},
				theme,
			}) as never}
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
	// useMouse:false (batch 10f, v2-entry parity): terminal-native
	// drag-select; scrollback via TranscriptScrollKeys.
	{ exitOnCtrlC: true, useMouse: false },
)
if (EXIT_AFTER_MS > 0) setTimeout(() => process.exit(0), EXIT_AFTER_MS)
