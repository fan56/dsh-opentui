/**
 * --v2 dev entry (batch 9a): the FIRST real boot of the rebuilt tui-base
 * view — Transcript + SessionComposer + turn overlays + slash palette +
 * StatusBar/PowerlineFooter on the REAL `RemoteSessionSeam` adapter
 * (shell client/session-seam-adapter.ts) over a real resident host.
 *
 * RESOLUTION LAW (established empirically on the first real boot): this
 * file MUST live under tui-base and import the view graph through the
 * package's own bare specifiers. Run from packages/shell with deep
 * imports, the identical composition dies at `useRenderer` ("No renderer
 * found") — the entry has to be babel-processed in tui-base's resolution
 * context like examples/session.tsx. It carries NO JSX: the tree
 * composes through @opentui's createComponent with COMPILED-JSX CHILDREN
 * GETTERS (`get children()`), because eager children are created in the
 * parent's owner scope and miss every context the provider sets.
 *
 * The shell-side helpers come from shell's preload-free boot-shared.ts
 * (NOT client-entry.tsx — that file registers the solid preload on
 * import and drags the old ShellHost/@opentui-0.7.0 graph into the
 * process, which breaks the 0.8.1 renderer context).
 *
 * TS-NOCHECK: this dev file sits in tui-base's tsconfig include but
 * composes shell's (untyped-from-here) client classes; keeping tui-base's
 * budgeted tsc error count at 58 matters more than typechecking a file
 * that dies at the cutover.
 * Dies at the batch-10 cutover (the boot render root swaps into
 * client-entry's bootClient). ADR-0006 direction (shell → tui-base) is
 * respected; the shell-side boot helpers are plain node code.
 */
// @ts-nocheck
import { createSignal, onCleanup, onMount, ErrorBoundary } from "solid-js"
import { createComponent, createElement, render, spread } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { SessionComposer } from "../src/routes/session/session-composer"
import { WelcomeHero } from "../src/routes/welcome-hero"
import { pickDailyQuote } from "../src/routes/quotes"
import { SubagentsPicker } from "../src/routes/session/subagents-picker"
import { registerSubagentSteerFeedback } from "../src/routes/session/subagent-markers"
import { createSeamRows } from "../src/routes/session/seam-rows"
import { Transcript } from "../src/routes/session/transcript"
import { WidgetsDock } from "../src/routes/session/widgets-dock"
import { LastRequestDock } from "../src/routes/session/lastrequest-dock"
import { NoticesDock, showNotice } from "../src/routes/session/notices-dock"
import { HintsLine } from "../src/routes/session/hints-line"
import { SearchOverlay } from "../src/routes/session/search-overlay"
import { TranscriptScrollKeys } from "../src/routes/session/transcript-scroll"
import { TurnCancelKeys } from "../src/routes/session/turn-cancel"
import { TurnOverlayController } from "../src/routes/session/turn-overlay-controller"
import { registerTurnOverlays, TurnOverlayHost } from "../src/routes/session/turn-overlays"
import { createSlashHost, SlashPalette } from "../src/routes/session/slash-palette"
import { SessionsSearch, openSessionsSearch } from "../src/routes/session/sessions-search"
import { PluginsPanel, openPluginsPanel } from "../src/routes/session/plugins-panel"
import { BtwController, createBtwOpener, createBtwSnapshotBuilder } from "../src/routes/session/btw-overlay"
import { readCacheHitMode } from "../src/seams/config"
import { DialogSelect } from "../src/ui/dialog-select"
import { DialogPrompt } from "../src/ui/dialog-prompt"
import { DialogProvider, useDialog } from "../src/ui/dialog"
import { ToastProvider } from "../src/ui/toast"
import { ClipboardProvider } from "../src/context/clipboard"
import { Keymap } from "../src/context/keymap"
import { ThemeProvider, useTheme, useThemes } from "../src/context/theme"
import { ConfigProvider, resolve } from "../src/config"
import { createThemeSeam } from "../src/seams/theme"
import { PowerlineFooter, sessionFooterSegments } from "../src/routes/session/powerline"
import { StatusBar } from "../src/routes/session/status-bar"
// Shell-side modules load through COMPUTED dynamic imports: a static
// import would pull shell's client graph into tui-base's tsc program (11
// transitive errors on top of the 58 budget) even behind this file's
// ts-nocheck. Runtime-only, opaque to tsc.
const SHELL = "../../" + "shell/src/client/"
async function loadShell() {
	const [shared, lifecycle, transport, rhs, adapter] = await Promise.all([
		import(SHELL + "boot-shared.ts"),
		import(SHELL + "lifecycle.ts"),
		import(SHELL + "transport.ts"),
		import(SHELL + "remote-host-session.ts"),
		import(SHELL + "session-seam-adapter.ts"),
	])
	return { shared, lifecycle, transport, rhs, adapter }
}

const overlays = new TurnOverlayController()

/** The one-shot skin-migration notice (α skin layer): boot writes the plan,
 * the page shows it through the notices dock once mounted (the dock reads a
 * module signal — a pre-mount showNotice would burn the TTL before paint). */
let pendingMigrationNotice: string | undefined
/** The config layer the theme lives in (env > workspace > profile, the
 * workspace-config.ts precedence): the /theme mode face persists `themeMode`
 * to the SAME layer (workspace via the workspaceThemeMode patch key, else
 * the profile `themeMode` key). An env-pinned theme has no file layer for
 * the mode pin either → profile (no env var carries a mode). */
let themeModePatchKey: "themeMode" | "workspaceThemeMode" = "themeMode"

/** The v2 session page: the real seam driving the rebuilt view. */
function V2SessionPage(props: {
	seam: RemoteSessionSeam
	themeName?: string
	quit: () => void
	workspace: string
}) {
	const seam = props.seam
	const projection = createSeamRows(seam, () => seam.currentSessionId() ?? "", {
		// Mid-turn approvals route through the batch-5 card.
		onApprove: (name, args) => overlays.requestApproval(name, args),
	})
	const dialog = useDialog()
	const theme = useTheme()
	const themeService = useThemes()
	const themeSeam = createThemeSeam(themeService)
	if (props.themeName && !themeSeam.setTheme(props.themeName)) {
		console.error(`[v2] unknown theme ${props.themeName}; bundled: ${themeSeam.list().join(", ")}`)
	}
	const [composerBusy, setComposerBusy] = createSignal(false)
	const [turnBusy, setTurnBusy] = createSignal(false)
	const busy = () => composerBusy() || turnBusy()
	const [busySince, setBusySince] = createSignal(0)
	const [msgs, setMsgs] = createSignal(0)
	const [model, setModel] = createSignal<{ providerID: string; modelID: string } | undefined>()
	const [now, setNow] = createSignal(new Date())
	// Batch H2 (tui-pi 60-preset footer parity) — host-entry-v2 parity: the
	// current agent preset's display label for the brand segment
	// ("dsh(<name>)"); undefined keeps the plain "dsh". Re-read on mount and
	// on every reload hook — a /preset switch lands through reload().
	const [presetLabel, setPresetLabel] = createSignal<string | undefined>()
	const refreshPresetLabel = () => {
		const face = seam.preset
		if (!face) return
		void Promise.all([face.list(), face.currentId()])
			.then(([rows, id]) => setPresetLabel(rows.find((row) => row.id === id)?.name))
			.catch(() => setPresetLabel(undefined))
	}
	let composerRef: { focused(): boolean; focus(): void } | undefined
	// Transcript scrollback (batch 10f): the page owns the scrollbox ref and
	// the key layer. Focus stays in the composer; the layer is gated on an
	// empty dialog stack (turn overlays + /model + pickOne all ride it).
	let transcriptScroll: ScrollBoxRenderable | undefined
	onMount(() => {
		void projection.load()
		void seam.currentModelSelection().then(setModel)
		refreshPresetLabel()
		if (pendingMigrationNotice) {
			showNotice(pendingMigrationNotice)
			pendingMigrationNotice = undefined
		}
		const timer = setInterval(() => setNow(new Date()), 1000)
		onCleanup(() => clearInterval(timer))
	})
	const elapsed = () => (busy() ? Math.max(0, Math.floor((now().getTime() - busySince()) / 1000)) : 0)
	// Batch D2 (tui-pi index.ts:2469 semantics): the `●` last-request echo
	// below the editor tracks MODEL prompts only — `send` is the composer's
	// non-slash submit path (the slash host intercepts `…` commands), it
	// persists across turns and clears on session switch (clear/reload below).
	const [lastRequest, setLastRequest] = createSignal<string | undefined>()
	const send = (text: string) => {
		setMsgs((n) => n + 1)
		setTurnBusy(true)
		setBusySince(Date.now())
		setLastRequest(text)
		const done = projection.send(text)
		void done.finally(() => setTurnBusy(false))
		return done
	}
	// ⚡ CH (batch F2): usage lands at turn end, so reading turnBusy() here
	// re-runs the getter-fed segment list on each turn boundary (footer row
	// only — PowerlineFooter's `left` prop is a getter, reactive-prop law).
	// cacheHitMode (batch F2, tui-pi semantics): the mode is re-read off the
	// config seam on every re-run — a profile flip applies on the next
	// repaint without a restart.
	const cacheRate = () => {
		turnBusy()
		const mode = readCacheHitMode(seam.configLoad?.())
		return seam.cacheHitRate?.(mode) ?? null
	}
	const segments = () =>
		sessionFooterSegments({
			provider: model()?.providerID,
			model: model()?.modelID,
			messages: msgs(),
			tools: 0,
			cacheHitRate: cacheRate(),
			presetLabel: presetLabel(),
			theme,
		})
	let cmdOrdinal = 0
	// `currentValue` (α skin layer): marks the active row with the vendored
	// `●` marker (DialogSelectRow current) WITHOUT moving the selection to it
	// (focusCurrent: false keeps row 0 selected — the e2e 67 bare-Enter
	// contract). `description` rides the option mapping now: pickOne used to
	// drop it (theme facts §5). `headerLine` stays the /sessions slot (v2
	// does not paint it — pre-existing gap, unchanged).
	const pickOne = (
		title: string,
		options: { title: string; value: string; description?: string }[],
		headerLine?: string,
		currentValue?: string,
	) =>
		new Promise<string | undefined>((resolvePick) => {
			let settled = false
			const done = (value: string | undefined) => {
				if (settled) return
				settled = true
				dialog.clear()
				resolvePick(value)
			}
			dialog.replace(
				() =>
					createComponent(DialogSelect, {
						title,
						renderFilter: false,
						options: options.map((option) => ({
							title: option.title,
							value: option.value,
							description: option.description,
						})),
						current: currentValue,
						focusCurrent: false,
						onSelect: (option: { value: string }) => done(option.value),
						onCancel: () => done(undefined),
					}),
				() => done(undefined),
			)
		})
	// /login chained-form text prompt (batch H4, host-entry-v2 parity): the
	// DialogPrompt modal through the same dialog host as pickOne — Enter
	// commits, esc resolves undefined (the chain aborts).
	const promptText = (
		title: string,
		opts?: { placeholder?: string; mask?: boolean; initial?: string },
	) =>
		new Promise<string | undefined>((resolvePrompt) => {
			let settled = false
			const done = (value: string | undefined) => {
				if (settled) return
				settled = true
				dialog.clear()
				resolvePrompt(value)
			}
			dialog.replace(
				() =>
					createComponent(DialogPrompt, {
						title,
						placeholder: opts?.placeholder,
						value: opts?.initial,
						onConfirm: (value: string) => done(value),
						onCancel: () => done(undefined),
					}),
				() => done(undefined),
			)
		})
	// /btw side-question overlay (feature batch F3) — host-entry-v2 parity.
	const btw = new BtwController({
		ask: (question, snapshot, onDelta) =>
			seam.btwAsk ? seam.btwAsk(question, snapshot, onDelta) : Promise.resolve("error: /btw unavailable"),
		snapshot: createBtwSnapshotBuilder(seam),
	})
	const openBtw = createBtwOpener({ controller: btw, dialog })
	// Batch D9 (host-entry-v2 parity): the transcript print path (the slash
	// command feedback row) shared by the slash host AND the steer outcome
	// echo through the module bridge's feedback slot.
	const sayLine = (text: string) =>
		projection.apply({
			type: "message.part.updated",
			details: { messageID: "cmd", part: { type: "text", id: `cmd-${++cmdOrdinal}`, text } },
		})
	// Batch D3: the steer outcome echo is a TRANSIENT notice (dsh-tui-pi
	// viewer.steer notices) — the notices slot below lastRequest, not a
	// permanent transcript row.
	registerSubagentSteerFeedback((line: string) => void showNotice(line))
	const slash = createSlashHost({
		seam,
		say: sayLine,
		// Batch D2: a session switch (/new → clear, /fork//resume → reload)
		// drops the `●` last-request echo with the rest of the session state.
		clear: () => {
			projection.hydrate([])
			setLastRequest(undefined)
		},
		reload: () => {
			setLastRequest(undefined)
			const settled = projection.load()
			void seam.currentModelSelection().then(setModel)
			refreshPresetLabel()
			return settled
		},
		quit: props.quit,
		pickOne,
		promptText,
		openBtw: (argText: string) => void openBtw(argText),
		// Batch H3 client-face parity (host-entry-v2 was the only wired pair —
		// this entry missed the deps, so /search answered "unavailable in this
		// session" while the status bar advertised Ctrl+Shift+F): /search
		// (cross-session FTS overlay) + /plugins (the manager panel — table +
		// state column + `/` filter). Both open through module-signal bridges
		// onto the overlays mounted in the root children below.
		openSearch: () => openSessionsSearch(),
		openPlugins: () => openPluginsPanel(),
		// /theme switch surface (batch F7b — client-face parity with
		// host-entry-v2): live apply + persistence through the seam's
		// configSave (RemoteHostSession.configSave routes `theme` to the
		// profile config.json, host-face parity); boot reads the stored
		// name via themeNameFromConfig (shared/boot-shared.ts).
		themes: {
			current: () => themeSeam.current(),
			list: () => themeSeam.list(),
			set: (name: string) => {
				const applied = themeSeam.setTheme(name)
				if (applied) {
					try {
						seam.configSave?.({ theme: name })
					} catch (error) {
						console.error("[v2] theme persist failed:", error)
					}
				}
				return applied
			},
			// α skin layer: auto/dark/light mode face — a FUNCTION returning the
			// face (the SlashCommandContext.themes.mode contract; the container
			// e2e caught an object-shape mismatch here as a picker-open crash).
			// Pin/free rides the vendored theme service; the persistence follows
			// the THEME's config layer (themeModePatchKey — workspaceThemeMode
			// routes into the workspace config.yml, themeMode into the profile
			// config.json; the v2 vendor config is resolve({}), so the
			// configState.update path inside pin/free cannot persist anything).
			mode: () => ({
				current: () => (themeService.locked() ? themeService.mode() : "auto"),
				set: (mode: "auto" | "dark" | "light") => {
					if (mode === "auto") themeService.unlock()
					else if (!themeService.setMode(mode)) return false
					try {
						seam.configSave?.({ [themeModePatchKey]: mode })
					} catch (error) {
						console.error("[v2] themeMode persist failed:", error)
					}
					return true
				},
			}),
		},
	})
	const overlayHost = createComponent(TurnOverlayHost, {
		controller: overlays,
		reclaimFocus: () => {
			if (composerRef && !composerRef.focused()) composerRef.focus()
		},
	})
	// Single root node (the example's <box flexDirection="column">); the
	// reconciler-native intrinsic path: createElement(tag) + spread(props).
	const root = createElement("box")
	spread(root, {
		flexDirection: "column",
		width: "100%",
		height: "100%",
		// α skin layer: the boot chrome follows the active theme instead of
		// the pinned "black" (theme facts §6 — the theme background never
		// reached the v2 root, light terminals booted dark-on-black). The
		// getter is a PER-PROPERTY reactive prop: spreadExpression tracks it
		// in its own render effect, so a theme/mode switch repaints the root
		// without re-running this children getter (REACTIVE-PROP LAW,
		// v2-entry.tsx:432-437 — no subtree remount on /theme).
		get backgroundColor() {
			return theme.background.base
		},
		get children() {
			return [
				// Startup hero (batch V3, old-stack welcome semantics): the block
				// "DSH OPENTUI" wordmark + model/cwd + daily quote, top-left above
				// the transcript while the session is empty; the first message
				// hides it and the transcript takes over. PROP RECAST LAW: getter
				// props from this children getter are baked into values before the
				// component body runs (proven empirically), so the accessors ride
				// a stable `state` object the component reads in its own scopes.
				createComponent(WelcomeHero, {
					state: {
						// hydrated() gates the journal-hydration window: a boot that
						// attaches a session with history must not flash the hero
						// for the duration of the fetch before it fills.
						visible: () => projection.hydrated() && msgs() === 0 && projection.rows.length === 0,
						model: () => model()?.modelID,
						muted: () => theme.text.muted,
					},
					cwd: props.workspace,
				}),
				// Transcript search (batch H1, tui-pi 22-search parity):
				// ctrl+shift+f opens the find bar over the SAME projection the
				// Transcript paints. Getter-prop law: the scrollbox rides a getter.
				createComponent(SearchOverlay, {
					projection,
					get scroll() {
						return transcriptScroll
					},
					onClosed: () => {
						if (composerRef && !composerRef.focused()) composerRef.focus()
					},
				}),
				// Cross-session FTS search (batch H3, host-entry-v2 parity):
				// /search and ctrl+shift+f open the query overlay over the seam's
				// searchSessions face. Getter-prop law: the seam rides a getter.
				createComponent(SessionsSearch, {
					get seam() {
						return seam
					},
					onClosed: () => {
						if (composerRef && !composerRef.focused()) composerRef.focus()
					},
				}),
				// Plugins manager panel (batch H3 client-face parity): /plugins
				// opens the bundle table with the state column and the `/` filter.
				// Getter-prop law: the seam rides a getter.
				createComponent(PluginsPanel, {
					get seam() {
						return seam
					},
					onClosed: () => {
						if (composerRef && !composerRef.focused()) composerRef.focus()
					},
				}),
				createComponent(Transcript, {
					seam,
					projection,
					scrollRef: (value: ScrollBoxRenderable | undefined) => (transcriptScroll = value),
					// Batch D3 status slot (dsh-tui-pi dock top, index.ts:846 Loader):
					// the 🐳 comet StatusBar moved here from below the composer —
					// mount-on-busy, zero rows idle. Getter-prop law: phase is a getter.
					status: createComponent(StatusBar, {
						get phase() {
							return busy() ? "stream" : null
						},
						elapsed,
					}),
					// Batch D1 widgets slot (dsh-tui-pi dock structure): the fixed
					// Todos → Think → Tool panels ride the SAME projection the
					// transcript paints — the dock reads the tool/reasoning rows the
					// transcript no longer renders. Getter-prop law: rows is a getter.
					widgets: createComponent(WidgetsDock, {
						get rows() {
							return projection.rows
						},
					}),
					// Batch D2 lastRequest slot (dsh-tui-pi live-widgets structure):
					// the `●` echo + running-children lines paint BELOW the editor.
					// Getter-prop law: rows and lastRequest are getters.
					footer: createComponent(LastRequestDock, {
						get rows() {
							return projection.rows
						},
						get lastRequest() {
							return lastRequest()
						},
					}),
					// Batch D3 notices slot (dsh-tui-pi tui.ts:256): stacked
					// auto-dismissing lines below lastRequest, above the powerline.
					notices: createComponent(NoticesDock, {}),
					get children() {
						return createComponent(SessionComposer, {
							seam,
							send,
							footerHint: false,
								onBusyChange: setComposerBusy,
								ref: (r: { focused(): boolean; focus(): void }) => (composerRef = r),
							slashKeyFilter: slash.slashKeyFilter,
							slashSync: (buffer: string) => slash.controller.sync(buffer, slash.commands),
							interceptSubmit: slash.interceptSubmit,
							slashPalette: () => createComponent(SlashPalette, { controller: slash.controller, commands: slash.commands }),
							slashHeight: () => slash.controller.rows(),
						})
					},
				}),
				// Subagents picker (batch C10a mount-gap fix): the seam-native
				// edition of the vendored SubagentsTab (rows off the
				// subagent-markers store, steer through the module bridge),
				// toggled by the vendored `session.child.first` keybind (down).
				// Getter-prop law: the seam rides a getter.
				createComponent(SubagentsPicker, {
					get seam() {
						return seam
					},
				}),
				// Transcript scrollback keys (batch 10f, ./transcript-scroll.tsx):
				// PgUp/PgDn scroll the transcript while the composer keeps focus;
				// gated OFF while any dialog (approval/ask//model) is open.
					createComponent(TranscriptScrollKeys, {
						scroll: () => transcriptScroll,
						enabled: () => dialog.stack.length === 0,
					}),
					// Cancel contract (batch V2, ./turn-cancel.tsx): esc interrupts
					// the running turn; ctrl+c interrupts + arms, ctrl+c x2 quits
					// through props.quit (the shutdown-intercepted process.exit).
					createComponent(TurnCancelKeys, {
						busy,
						interrupt: () => seam.interrupt(),
						quit: props.quit,
						enabled: () => dialog.stack.length === 0,
						escapeYields: () => slash.controller.open,
					}),
				// REACTIVE-PROP LAW (batch 10d): signal reads ride GETTERS. An
				// eager `busy()` / `segments()` / `now()` read here is tracked by
				// this children getter, so every 1s clock tick re-ran it and
				// REMOUNTED the whole subtree — the SessionComposer owning the
				// in-flight turn was disposed and its busy=false dropped by its
				// disposed guard: "Writing…" frozen after a settled turn.
				// Batch D3: the StatusBar moved to the dock top (Transcript status
				// slot); the page bottom is the powerline, then the hints row LAST
				// (dsh-tui-pi PowerlineFooter → FooterHint order).
				createComponent(PowerlineFooter, {
					get left() {
						return segments()
					},
					get right() {
						return clock(now())
					},
					theme,
				}),
				createComponent(HintsLine, {
					get busy() {
						return busy()
					},
				}),
				overlayHost,
			]
		},
	})
	return root
}

function clock(d: Date): string {
	return d.toTimeString().slice(0, 8)
}

/** Synchronous dev diagnostics (console output races process.exit). */
function appendDiagnostic(line: string): void {
	try {
		require("node:fs").appendFileSync("/tmp/b9a-render-diag.txt", `${line}\n`)
	} catch {
		/* diagnostics are best-effort */
	}
}

/** What the v2 boot keeps alive. */
export interface ClientBootV2 {
	shutdown(): Promise<void>
}

/**
 * The v2 boot: ensureHost → ClientConnection → RemoteHostSession →
 * RemoteSessionSeam → the rebuilt view. Shutdown semantics are client-entry
 * parity (dispose session → release host ref → idle reaper hand-off).
 */
export async function bootClientV2(): Promise<ClientBootV2> {
	const { shared, lifecycle, transport, rhs, adapter } = await loadShell()
	const workspace = process.cwd()
	const profile = lifecycle.DEFAULT_PROFILE
	const idleExitSec = lifecycle.DEFAULT_IDLE_EXIT_SEC

	shared.bootCallOrder.push("ensureHost")
	const host = await lifecycle.ensureHost({ profile, idleExitSec })
	shared.bootCallOrder.push("connect")
	const connection = new transport.ClientConnection({ authority: host.authority, cookieHeader: host.cookieHeader })
	shared.bootCallOrder.push("createSession")
	const session = new rhs.RemoteHostSession({
		connection: connection as never,
		cookieHeader: host.cookieHeader,
		cwd: workspace,
		workspaceDir: workspace,
		dshHome: host.dshHome,
		profile,
	})
	shared.bootCallOrder.push("session.start")
	await session.start()
	// Cold-boot label wait (client-entry parity): the powerline shows the
	// real provider/model from the first paint when the catalog answers.
	{
		const deadline = Date.now() + shared.BOOT_LABEL_BUDGET_MS
		while (session.label === "dsh-host" && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}

	const seam = new adapter.RemoteSessionSeam(session as never)
	registerTurnOverlays(seam, overlays)
	// One-shot skin migration (α skin layer, real precedence chain env >
	// workspace > profile): a STORED legacy `theme` key (profile OR
	// workspace layer) switches to the dsh-blue default once, persists the
	// `skinMigration` marker in the PROFILE config, writes dsh-blue back to
	// the layer the legacy key lived in, and queues the one-time notice.
	// Env-pinned themes (DSH_OPENTUI_THEME) skip — the effective theme is
	// not a stored choice. Fresh profiles fall to the default naturally.
	// Best-effort: a failed persist still applies the theme for this boot.
	const envTheme = process.env[shared.ENV_THEME]
	const workspaceConfig = seam.workspaceConfig()
	const migration = shared.skinMigrationPlan({
		profileConfig: seam.configRaw(),
		workspaceConfig,
		envTheme,
	})
	if (migration) {
		try {
			const patch: Record<string, unknown> = { skinMigration: migration.skinMigration }
			if (migration.layer === "workspace") patch.workspaceTheme = migration.theme
			else patch.theme = migration.theme
			session.configSave(patch)
		} catch (error) {
			console.error("[v2] skin migration persist failed:", error)
		}
		pendingMigrationNotice = migration.notice
	}
	// The mode-pin layer mirrors the theme's layer: workspace theme → the
	// workspace slice; profile (or env) theme → the profile config.json.
	themeModePatchKey = migration?.layer === "workspace" || (!envTheme && workspaceConfig.theme !== undefined) ? "workspaceThemeMode" : "themeMode"
	const themeName = migration ? migration.theme : shared.themeNameFromConfig(session)
	const themeModeLock = shared.themeModeFromConfig(session)

	let shutdownPromise: Promise<void> | null = null
	const shutdown = (): Promise<void> => {
		shutdownPromise ??= (async () => {
			shared.bootCallOrder.push("shutdown")
			try {
				await Promise.race([session.dispose(), new Promise((resolve) => setTimeout(resolve, shared.SHUTDOWN_GRACE_MS))])
			} catch {
				/* dispose is best-effort on the quit path */
			}
			// Grace-window parity (client-entry): release — NOT dispose — the
			// host, then hand the idle-exit to the detached reaper.
			host.release()
			if (host.refCount === 0 && idleExitSec > 0) shared.spawnIdleReaper(host, idleExitSec)
		})()
		return shutdownPromise
	}
	shared.installExitPaths(shutdown)

	shared.bootCallOrder.push("render")
	// The example page's provider closure, in the vendored app's order.
	// COMPILED-JSX LAW: children ride GETTERS — eager children are created
	// in the parent's owner scope and miss the provider's context.
	render(() =>
		createComponent(ConfigProvider, {
			config: resolve({}, { terminalSuspend: true }),
			get children() {
				return createComponent(Keymap.Provider, {
					get children() {
						return createComponent(ToastProvider, {
							get children() {
									return createComponent(ThemeProvider, {
										mode: "dark",
										// α skin layer: the profile-pinned mode (themeMode
										// config key) arrives as the boot lock; undefined =
										// auto (renderer.themeMode, dark fallback).
										lock: themeModeLock,
										source: { discover: async () => ({}) },
									get children() {
										return createComponent(ClipboardProvider, {
											value: { read: async () => undefined, write: async () => {} },
											get children() {
												return createComponent(DialogProvider, {
													get children() {
														return createComponent(ErrorBoundaryDiagnostics, {
															get children() {
																return createComponent(V2SessionPage, {
																	seam,
																	themeName,
																	quit: () => process.exit(0),
																	workspace,
																})
															},
														})
													},
												})
											},
										})
									},
								})
							},
						})
					},
				})
			},
		}),
		// Renderer options (batch 10f): mouse reporting OFF — the terminal
		// keeps drag-select + Cmd+C (Ghostty native); the transcript
		// scrollback moves via TranscriptScrollKeys instead of the wheel.
		// exitOnCtrlC OFF (batch V2): OpenTUI's default `true` grabs ctrl+c
		// in the raw key handler ahead of every keymap layer and runs its
		// own exitHandler — bypassing shutdown and leaving a wiped frame.
		// TurnCancelKeys owns ctrl+c (vendored app.tsx / engine.ts parity).
		{ useMouse: false, exitOnCtrlC: false },
	).then(() => {
		appendDiagnostic("[v2] render promise resolved")
	}).catch((error: unknown) => {
		appendDiagnostic(`[v2 boot render failed] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
		process.exit(1)
	})
	return { shutdown }
}

/** Error boundary that surfaces view crashes synchronously (dev aid). */
function ErrorBoundaryDiagnostics(props: { children: unknown }) {
	return createComponent(ErrorBoundary, {
		fallback: (error: unknown) => {
			appendDiagnostic(`[v2 render error] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
			process.exit(2)
			return null as never
		},
		get children() {
			return props.children
		},
	})
}

// CLI main: the launcher execs this file directly for --v2.
if (import.meta.main) {
	bootClientV2().catch((error: unknown) => {
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
		process.stderr.write(`dsh-opentui v2 boot failed: ${message}\n`)
		process.exit(1)
	})
}
