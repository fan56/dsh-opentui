/**
 * --v2 dev entry (batch 9a): the FIRST real boot of the rebuilt tui-base
 * view — Transcript + SessionComposer + turn overlays + slash palette +
 * PowerlineFooter/HintsLine (the busy comet rides the hints row) on the REAL
 * `RemoteSessionSeam` adapter
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
import { createSignal, createMemo, createEffect, onCleanup, onMount, ErrorBoundary } from "solid-js"
import { createComponent, createElement, render, spread, useRenderer } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { SessionComposer } from "../src/routes/session/session-composer"
import { ComposerContext } from "../src/routes/session/composer-context"
import type { ComposerPendingRow } from "../src/routes/session/composer-state"
import { openDeliveryChoice } from "../src/routes/session/delivery-choice"
import { parseLaunchArgs, runAutoResume } from "../src/routes/session/auto-resume"
import { WelcomeHero } from "../src/routes/welcome-hero"
import { useTerminalSize } from "../src/routes/session/terminal-size"
import { pickDailyQuote } from "../src/routes/quotes"
import { SubagentsPicker } from "../src/routes/session/subagents-picker"
import { registerSubagentSteerFeedback } from "../src/routes/session/subagent-markers"
import { createSeamRows } from "../src/routes/session/seam-rows"
import {
	initialFooterProbeState,
	markFooterProbeStarted,
	settleFooterProbe,
	shouldStartFooterProbe,
} from "../src/routes/session/footer-refresh"
import { Transcript } from "../src/routes/session/transcript"
import { WidgetsDock, resetMergedDockCursor, resetSkinLineFades } from "../src/routes/session/widgets-dock"
import { LastRequestDock } from "../src/routes/session/lastrequest-dock"
import { NoticesDock, showNotice } from "../src/routes/session/notices-dock"
import { RecoveryBanner } from "../src/routes/session/recovery-banner"
import { RecoveryUiController, type RecoveryTexts } from "../src/routes/session/recovery-ui"
import { HintsLine, applyHintsConfig } from "../src/routes/session/hints-line"
import { applyActivityPanelConfig } from "../src/routes/session/widgets-dock"
import { applyI18nConfig } from "@dsh-opentui/i18n"
import { t } from "../src/i18n"
import { SearchOverlay } from "../src/routes/session/search-overlay"
import { TranscriptScrollKeys } from "../src/routes/session/transcript-scroll"
import { createPaneFocus, PaneFocusKeys } from "../src/routes/session/pane-focus"
import { subagentsPickerOpen } from "../src/routes/session/subagents-picker"
import { TurnCancelKeys } from "../src/routes/session/turn-cancel"
import { stopEverything } from "../src/routes/session/stop-all"
import { TurnOverlayController } from "../src/routes/session/turn-overlay-controller"
import { registerTurnOverlays, TurnOverlayHost } from "../src/routes/session/turn-overlays"
import { DockProvider, DockSeat, useDock } from "../src/routes/session/dock-host"
import { createSlashHost, SlashPalette } from "../src/routes/session/slash-palette"
import { buildSlashDeps } from "../src/routes/session/slash-deps"
import { presetLabelFor, coreCommands, type PickOneExtras } from "../src/routes/session/commands"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { agentsHomeEnvWarning, discoverSkills, resolveAgentsHome, withSkillCommands, type SkillRow } from "../src/routes/session/skills-source"
import { SkillsPanel, openSkillsPanel } from "../src/routes/session/skills-panel"
import { SessionsSearch, openSessionsSearch } from "../src/routes/session/sessions-search"
import { PluginsPanel, openPluginsPanel } from "../src/routes/session/plugins-panel"
import { AgentsPanel, openAgentsPanel } from "../src/routes/session/agents-panel"
import { openSettingsPanel } from "../src/routes/session/settings-panel"
import { HistoryPanel, openHistoryPanel } from "../src/routes/session/history-panel"
import { SubagentsViewer, openSubagentsViewer } from "../src/routes/session/subagents-viewer"
import { SettingsModalHost } from "../src/routes/session/settings-modal"
import { BtwController, createBtwOpener, createBtwSnapshotBuilder } from "../src/routes/session/btw-overlay"
import { readCacheHitMode } from "../src/seams/config"
import { DialogSelect } from "../src/ui/dialog-select"
import { DialogPrompt } from "../src/ui/dialog-prompt"
import { DialogConfirm } from "../src/ui/dialog-confirm"
import { DialogProvider, useDialog } from "../src/ui/dialog"
import { ToastProvider, useToast } from "../src/ui/toast"
import { ClipboardProvider, useClipboard } from "../src/context/clipboard"
import { createTuiClipboard } from "../src/clipboard"
import { Keymap } from "../src/context/keymap"
import { ThemeProvider, useTheme, useThemes } from "../src/context/theme"
import { PanelKitHost } from "../src/context/panel-kit-host"
import { InputOwnershipProvider, useIsPageOwner } from "../src/context/input-ownership"
import { ConfigProvider, resolve, useConfig } from "../src/config"
import { copyOnSelectEnabled, copyOnSelectRelease } from "../src/util/selection"
import { createThemeSeam } from "../src/seams/theme"
import {
	confirmTerminalCapabilities,
	resolveMotionPreference,
	setMotionBusy,
	setMotionTier,
} from "../src/skin/motion"
import {
	PowerlineFooter,
	sessionFooterSegments,
	effortFromModelLabel,
	decideEffort,
	defaultEffortToApply,
} from "../src/routes/session/powerline"
// Shell-side modules load through COMPUTED dynamic imports: a static
// import would pull shell's client graph into tui-base's tsc program (11
// transitive errors on top of the 58 budget) even behind this file's
// ts-nocheck. Runtime-only, opaque to tsc.
const SHELL = "../../" + "shell/src/client/"
/** Locate the detached watchdog bundle across source / built layouts. */
function resolveWatchdogScript(): string | null {
	const candidates = [
		join(import.meta.dir, "..", "watchdog.mjs"),
		join(import.meta.dir, "..", "..", "shell", "dist", "watchdog.mjs"),
		join(import.meta.dir, "..", "..", "..", "shell", "dist", "watchdog.mjs"),
	]
	for (const candidate of candidates) if (existsSync(candidate)) return candidate
	return null
}
async function loadShell() {
	const [shared, lifecycle, clifecycle, transport, rhs, adapter, git, seamBootstrap] = await Promise.all([
		import(SHELL + "boot-shared.ts"),
		import(SHELL + "lifecycle.ts"),
		import(SHELL + "client-lifecycle.ts"),
		import(SHELL + "transport.ts"),
		import(SHELL + "remote-host-session.ts"),
		import(SHELL + "session-seam-adapter.ts"),
		import(SHELL + "remote-git.ts"),
		import(SHELL + "seam-bootstrap.ts"),
	])
	return { shared, lifecycle, clifecycle, transport, rhs, adapter, git, seamBootstrap }
}

const overlays = new TurnOverlayController()

/** The one-shot skin-migration notice (α skin layer): boot writes the plan,
 * the page shows it through the notices dock once mounted (the dock reads a
 * module signal — a pre-mount showNotice would burn the TTL before paint). */
let pendingMigrationNotice: string | undefined
/** The P2-2 agents-home boundary warning (skills-source.ts): boot detects a
 * set-but-blank DSH_AGENTS_HOME or a blank config `agentsHome` (either leg
 * of the host's precedence chain), the page surfaces it through the notices
 * dock once mounted — a pre-mount showNotice would burn the TTL before
 * paint (same reason as pendingMigrationNotice). */
let pendingAgentsHomeNotice: string | undefined
/** The config layer the theme lives in (env > workspace > profile, the
 * workspace-config.ts precedence): the /theme mode face persists `themeMode`
 * to the SAME layer (workspace via the workspaceThemeMode patch key, else
 * the profile `themeMode` key). An env-pinned theme has no file layer for
 * the mode pin either → profile (no env var carries a mode). */
let themeModePatchKey: "themeMode" | "workspaceThemeMode" = "themeMode"

/**
 * Page boundary: the dock provider must be an ANCESTOR of the page body for
 * `useDock()` to resolve, and it must sit inside the ownership stack (it
 * pushes the `dock` frame) and the renderer. It renders no element — context
 * only — so the page-root layout is untouched.
 */
function V2SessionPage(props: Parameters<typeof V2SessionPageBody>[0]) {
	return createComponent(DockProvider, {
		get children() {
			return createComponent(V2SessionPageBody, props)
		},
	})
}

/** The v2 session page: the real seam driving the rebuilt view. */
function V2SessionPageBody(props: {
	seam: RemoteSessionSeam
	themeName?: string
	quit: () => void
	/** A3b+A8: the injected recovery entry (shell recoverBridgeSession over
	 *  the live transport). Absent on legacy seams — the R layer then no-ops. */
	recoverBridge?: () => Promise<unknown>
	workspace: string
	/** Splash hero plugin-tree root label (the boot profile name,
	 * lifecycle.DEFAULT_PROFILE); undefined keeps the block headless. */
	profileName?: string
	/** Branch-or-SHA probe for the composer context row (shell's
	 * remote-git.ts; absent = directory-only row, the silent degrade). */
	probeBranch?: (cwd: string) => Promise<string>
	/** feat/auto-resume: the stored session the boot staged on the seam
	 * (`resumeSession(id)` — bound at the next turn). */
	initialSessionId?: string
	/** feat/auto-resume: `resumed <title> · <time ago>` notice line. */
	resumeNotice?: string
	/** Boot-time disk snapshot of user-invocable skills (skills-source.ts). */
	skills?: SkillRow[]
	/** /skills manager roots (gap C3): the agents-home skills/ source and the
	 * `<dshHome>/skills` curated root. Computed in bootClientV2 (where the
	 * agentsHome resolution and host.dshHome live) and passed in — the page's
	 * render getters must never reach into boot scope (the C3 exit-2 bug: a
	 * boot-scope const referenced from the children getter compiled clean
	 * under @ts-nocheck and threw ReferenceError only when the panel first
	 * mounted, which the root ErrorBoundary answered with process.exit(2)). */
	skillsSource: string
	skillsCurated: string
}) {
	const seam = props.seam
	// First-turn footer fix (pure-chat / no-tool path): journal message events
	// cannot re-read the 💬 count during a turn — the real adapter DROPS every
	// journal projection for the whole turn await (`session-seam-adapter.ts:771
	// if (this.#turnInFlight) return`, no buffer/replay), so an onSessionEvent
	// subscription is dead in exactly the window we need. The streamed delta
	// callbacks DO fire while the turn awaits (`shell/src/agent/loop.ts:198
	// onThinkingDelta / :202 onContentDelta`, passed through the adapter at
	// :344-345) and are not gated by #turnInFlight. Wrap the seam's turn() so
	// the FIRST delta of a turn triggers the one-shot authoritative count
	// probe. onContentDelta is the guaranteed trigger for a tool-less chat turn
	// (every answer streams text); onThinkingDelta is hooked too so a
	// reasoning-only turn trips on the earliest delta. The probe guard collapses
	// the burst; onToolRun below stays as the earlier, tool-path trigger.
	const rawTurn = seam.turn.bind(seam)
	seam.turn = (userText, cb) =>
		rawTurn(userText, {
			...cb,
			onThinkingDelta: (text) => {
				refreshFooterIfUnknown()
				cb.onThinkingDelta?.(text)
			},
			onContentDelta: (text) => {
				refreshFooterIfUnknown()
				cb.onContentDelta?.(text)
			},
		})
	const projection = createSeamRows(seam, () => seam.currentSessionId() ?? "", {
		// Mid-turn approvals route through the batch-5 card.
		onApprove: (name, args) => overlays.requestApproval(name, args),
		// Skin wiring (contract §1 报错通知): turn errors surface as a
		// pulsing ⚠ notice alongside the transcript error row.
		onError: (message) => showNotice(`error: ${message}`, undefined, "error"),
		// Footer-quickwins (tui-pi 🔧 tools parity): the 🛠 footer segment
		// counts settled tool runs off the store's onToolRun passthrough —
		// replaces the hardcoded `tools: 0`. Reset on session clear/reload.
		// First-turn footer fix: a settled tool run proves the live session id
		// is bound, so it is one of the events that re-reads the authoritative
		// 💬 count during the first turn (the turn-end effect is busy-gated).
		onToolRun: () => {
			setTools((n) => n + 1)
			refreshFooterIfUnknown()
		},
	})
	const dialog = useDialog()
	// ADR-0008: page-level global layers answer only while the page frame is
	// the top ownership frame (dialogs, panel-kit panels and the ask dock all
	// push above it). Subsumes the old `dialog.stack.length === 0` gate.
	const pageOwns = useIsPageOwner()
	// The in-flow interaction dock (spec §2). The provider sits above this
	// page, so the page and the surface that will open the dock share one
	// queue and one `dock` ownership frame. Nothing opens it in this change
	// set: the ask surface is a later task, and its extension point is
	// `dock.open(...)` (see dock-host.tsx).
	const dock = useDock()
	const theme = useTheme()
	const themeService = useThemes()
	const themeSeam = createThemeSeam(themeService)
	if (props.themeName && !themeSeam.setTheme(props.themeName)) {
		console.error(`[v2] unknown theme ${props.themeName}; bundled: ${themeSeam.list().join(", ")}`)
	}
	const [composerBusy, setComposerBusy] = createSignal(false)
	const [turnBusy, setTurnBusy] = createSignal(false)
	const busy = () => composerBusy() || turnBusy()
	const [model, setModel] = createSignal<{ providerID: string; modelID: string } | undefined>()
	// Footer-quickwins (tui-pi footer parity): local tool-run count (🛠, reset
	// on session clear), the model segment's effort level, and the remote
	// session snapshot (durable assistant/message msg count + decode-window
	// tok/s). The 💬 count has NO local fallback: while sessionInfo is absent
	// the footer hides the segment instead of showing a send-count-shaped
	// fake number.
	const [tools, setTools] = createSignal(0)
	const [effort, setEffort] = createSignal<string | undefined>()
	const [remoteInfo, setRemoteInfo] = createSignal<{
		msgCount?: number
		tps?: number | null
	}>()
	// A2: bridge link health for the footer status slot. Event-driven off the
	// seam's SeamSessionEvent — no polling, so an idle-period crash repaints
	// immediately. A3b+A8: the RecoveryUiController folds all four recovery
	// events into the three-state footer, the composer-disable gate and the
	// persistent banner. The page owns no copy: texts are t() getters.
	const [bridgeStatus, setBridgeStatus] = createSignal<"ready" | "recovering" | "dead">("ready")
	// The controller is installed here but /new needs the slash host created
	// below, so the new-session action rides a holder assigned later. Quit is
	// the boot-owned path and resolves straight through props.quit.
	let recoveryNewSession: () => void = () => {}
	const recoveryQuit: () => void = () => props.quit()
	const recoveryTexts: RecoveryTexts = {
		transient: () => t("recovery.transient"),
		recovered: (count) => t("recovery.recovered", { count: String(count) }),
		failedReason: (reason) => t("recovery.failed.reason", { reason }),
		// P2-1: three shapes — bare base, host reason, reason + holder. The
		// controller supplies the holder only when the reason does not name it.
		locked: (reason, holder) =>
			reason === undefined
				? t("recovery.locked")
				: holder === undefined
					? t("recovery.locked.reason", { reason })
					: t("recovery.locked.holder", { reason, holder }),
		cooldown: (remainingMs) => t("recovery.cooldown", { remainingMs: String(remainingMs) }),
		reconnect: () => t("recovery.action.reconnect"),
		retry: () => t("recovery.action.retry"),
		newSession: () => t("recovery.action.newSession"),
		quit: () => t("recovery.action.quit"),
	}
	const recovery = new RecoveryUiController({
		recover: () =>
			props.recoverBridge ? props.recoverBridge() : Promise.reject(new Error("no bridge transport injected")),
		texts: recoveryTexts,
		onNotice: (text, ttl, kind) => void showNotice(text, ttl, kind),
		onNewSession: () => recoveryNewSession(),
		onQuit: () => recoveryQuit(),
	})
	const recoveryEvents = new Set([
		"bridge.dead",
		"bridge.recovered",
		"bridge.recovery.locked",
		"bridge.recovery.failed",
	])
	onCleanup(
		seam.onSessionEvent?.((event: { type: string; details: unknown }) => {
			if (!recoveryEvents.has(event?.type)) return
			recovery.handleEvent(event)
		}) ?? (() => {}),
	)
	// A3b+A8: the footer's bridge-status slot follows the recovery controller's
	// PHASE, not only seam events. The manual R path moves the controller to
	// "recovering" (and back to ready/failed) WITHOUT any seam event, so this
	// subscription is the single source of truth for the footer — including the
	// auto `bridge.dead` event path (dead), which the controller also emits.
	onCleanup(recovery.subscribe(() => setBridgeStatus(recovery.footerStatus)))
	const [now, setNow] = createSignal(new Date())
	// Composer context row (user feedback batch): a bump re-reads the git
	// branch above the input box. Session switches (/new → clear, /fork /
	// /resume → reload) are the only refresh signals — no timer, no poll.
	const [contextRevision, setContextRevision] = createSignal(0)
	// Info bar (steer/dir/branch batch): ComposerContext publishes its
	// reactive frame title here at setup; SessionComposer embeds it in the
	// top border (full-frame geometry — compact draws the one-row rule on
	// the context component itself). Plain holder, assigned before the
	// composer's first title read (the mount order below guarantees it).
	let contextFrameTitle: (() => string) | undefined
	// Batch H2 (tui-pi 60-preset footer parity) — host-entry-v2 parity: the
	// current agent preset's display label for the brand segment
	// ("dsh(<name>)"); undefined keeps the plain "dsh". Re-read on mount, on
	// every reload hook (a /preset switch lands through reload()) and at each
	// turn end — the first session/create is what names the live preset, and
	// that only happens on the first turn.
	const [presetLabel, setPresetLabel] = createSignal<string | undefined>()
	// Slash-menu skills: the boot disk snapshot is the first paint; the host's
	// session-scoped `skills/list` takes over after the first user message
	// (plugin-provided skills live only there). The registry below is a memo
	// so the palette rows and Tab completion read the CURRENT rows.
	const [skillRows, setSkillRows] = createSignal<SkillRow[]>(props.skills ?? [])
	const slashCommands = createMemo(() => withSkillCommands(coreCommands(), skillRows()))
	// Splash hero plugin rows (tui-pi welcome parity): seeded from the seam's
	// sync plugins() cache (the boot warm may not have landed yet), then the
	// push bridge re-reads on every refresh — the adapter's revision signal is
	// shell-side solid-js and cannot repaint tui-base (the /plugins panel
	// trap), so the rows ride THIS signal into the hero state.
	const [pluginRows, setPluginRows] = createSignal<readonly { name: string; version: string }[]>(seam.plugins?.() ?? [])
	onMount(() => {
		const off = seam.onSkillsChanged?.((rows) =>
			setSkillRows(rows.map((row) => ({ name: row.name, description: row.description, path: "skills/list" }))),
		)
		onCleanup(() => off?.())
		const offPlugins = seam.onPluginsChanged?.(() => setPluginRows(seam.plugins?.() ?? []))
		onCleanup(() => offPlugins?.())
		// Re-read once AFTER registering: a boot warm that landed between the
		// signal seed above and this subscription would otherwise only reach
		// us on the NEXT push (the registration window lost-event trap).
		setPluginRows(seam.plugins?.() ?? [])
	})
	// `presetLabelFor` is tui-pi's formatPresetLabel semantics: with nothing
	// staged/attached yet the registry-default row answers, so the brand
	// segment reads "dsh(<default>)" from the first frame.
	const refreshPresetLabel = () => {
		const face = seam.preset
		if (!face) return
		void Promise.all([face.list(), face.currentId()])
			.then(([rows, id]) => setPresetLabel(presetLabelFor(rows, id)))
			// A transient list/currentId failure must not blank the brand
			// segment back to plain "dsh" once a label is known: keep the last
			// value (the next refresh, e.g. turn end, retries).
			.catch(() => {})
	}
	let composerRef: {
		focused(): boolean
		focus(): void
		node(): import("@opentui/core").TextareaRenderable | undefined
		resetDeliveries(): void
		flushQueue(): import("../src/routes/session/composer-state").ComposerFlushResult
	} | undefined
	// Focus restoration (spec §10): the dock calls this by ref after layout
	// when its queue drains. The closure reads `composerRef` at call time —
	// the composer mounts later than this registration.
	dock.bindComposerFocus(() => {
		if (composerRef && !composerRef.focused()) composerRef.focus()
	})
	// Transcript scrollback (batch 10f): the page owns the scrollbox ref and
	// the key layer. Pane focus (focus batch): F6 / mouse clicks move the
	// renderer focus between this scrollbox and the composer textarea; the
	// pane signal is derived from the renderer, never guessed.
	let transcriptScroll: ScrollBoxRenderable | undefined
	// Skin wiring (contract §1 动效档位): the renderer's terminal capability
	// probe feeds the motion gate — before the probe answers (and on
	// non-truecolor / tmux / SSH) the auto tier is reduced; a truecolor
	// confirmation lifts it to full. The event may fire before mount, so an
	// already-present capabilities snapshot applies too.
	const renderer = useRenderer()
	// Shared resize-reactive terminal size (terminal-size.ts — ONE renderer
	// listener serves every caller): feeds the splash hero's plugin-block
	// cap/clip so a mid-splash resize recomputes instead of freezing the boot
	// snapshot (the composer compact-band law at COMPOSER_COMPACT_TERMINAL_ROWS).
	const dimensions = useTerminalSize()
	// Pane focus (focus batch): composer textarea ↔ transcript scrollbox, both
	// focused through OpenTUI itself. `pane` is read off the renderer's
	// FOCUSED_RENDERABLE event, so dialogs and the search input correctly
	// classify as "neither pane" and F6 gates itself off.
	const paneFocus = createPaneFocus({
		transcript: () => transcriptScroll,
		composer: () => composerRef?.node(),
	})
	// Copy-on-select at the page root (the vendored app.tsx root shape). With
	// mouse reporting ON, drag-select is app-owned; this release handler is
	// what actually copies it (the dialog host's sibling overlay never sees
	// transcript events). Shift+drag still bypasses to the terminal's native
	// selection for Cmd+C.
	const toast = useToast()
	const clipboard = useClipboard()
	const config = useConfig()
	onMount(() => {
		const onCapabilities = (capabilities: { rgb: boolean } | null) => confirmTerminalCapabilities(capabilities)
		renderer.on("capabilities", onCapabilities)
		onCleanup(() => renderer.off("capabilities", onCapabilities))
		if (renderer.capabilities) confirmTerminalCapabilities(renderer.capabilities)
	})
	// Skin wiring (contract §1): the shared motion clock's busy lane is the
	// page's own busy window (composer + turn). It stays host-side truth even
	// though the comet now lives in HintsLine (which mounts on both states) —
	// an old StatusBar-only effect used to drop the cap the moment a phase
	// ended; busy() no longer has that gap.
	createEffect(() => setMotionBusy(busy()))
	onCleanup(() => setMotionBusy(false))
	onMount(() => {
		// feat/auto-resume: the boot may have staged a stored session on the
		// seam. Read THAT session's journal explicitly — `currentSessionId()`
		// is still undefined until the first turn binds the staged id, and the
		// transcript-loss fix pinned the rule: never rely on the live id here.
		void projection.load(props.initialSessionId)
		void seam.currentModelSelection().then(setModel)
		refreshFooterData()
		refreshPresetLabel()
		// First-turn 💬 re-read is driven by the streamed-delta wrapper on
		// seam.turn() (see the top of this body) and by onToolRun for tool turns.
		// There is intentionally NO onSessionEvent subscription here: the real
		// adapter suppresses all journal events for the turn await, and the
		// turn-end effect below already refreshes once the turn settles — so an
		// event listener would be dead in-turn and redundant post-turn.
		if (props.resumeNotice) showNotice(props.resumeNotice)
		if (pendingMigrationNotice) {
			showNotice(pendingMigrationNotice)
			pendingMigrationNotice = undefined
		}
		if (pendingAgentsHomeNotice) {
			showNotice(pendingAgentsHomeNotice)
			pendingAgentsHomeNotice = undefined
		}
		const timer = setInterval(() => setNow(new Date()), 1000)
		onCleanup(() => clearInterval(timer))
	})
	// Batch D2 (tui-pi index.ts:2469 semantics): the `●` last-request echo
	// below the editor tracks MODEL prompts only — `send` is the composer's
	// non-slash submit path (the slash host intercepts `…` commands), it
	// persists across turns and clears on session switch (clear/reload below).
	const [lastRequest, setLastRequest] = createSignal<string | undefined>()
	// Busy-submit delivery lines (steer/queue batch): the composer owns the
	// queue state; this signal is the transcript's pending slot snapshot.
	const [composerPending, setComposerPending] = createSignal<readonly ComposerPendingRow[]>([])
	// Abort flag for the composer's queue policy: `seam.interrupt()` RESOLVES
	// the awaited turn without an error, so the controller cannot distinguish
	// abort from success on its own. Each send clears it; esc/ctrl+c sets it.
	let turnAborted = false
	const send = (text: string) => {
		turnAborted = false
		setTurnBusy(true)
		setLastRequest(text)
		const done = projection.send(text)
		void done.finally(() => setTurnBusy(false))
		return done
	}
	// U6 stop-everything confirm (tui-pi stop-dialog parity): the confirmed
	// stop cancels the main turn AND every live subagent (cancelling the
	// parent alone leaves independent children running — seam.interruptChild
	// per running row, the /subagents viewer's stop-all leg). The dialog
	// states the blast radius at open time; Esc inside it cancels and keeps
	// everything running.
	const confirmStopAll = () => {
		const runningChildren = (seam.subagentViews?.() ?? []).filter((view) => view.status === "running").length
		const parts = [
			...(turnBusy() || composerBusy() ? [t("turn.stop.confirmMain")] : []),
			...(runningChildren === 1
				? [t("turn.stop.confirmChildrenOne")]
				: runningChildren > 0
					? [t("turn.stop.confirmChildrenMany", { count: String(runningChildren) })]
					: []),
		]
		dialog.replace(
			() => (
				<DialogConfirm
					title={t("turn.stop.confirmTitle")}
					message={t("turn.stop.confirmMessage", { parts: parts.join(", ") })}
					label={{ confirm: t("turn.stop.confirmLabel"), cancel: t("turn.stop.cancelLabel") }}
					onConfirm={() => {
						turnAborted = true
						// Stop the main turn AND every live subagent through the
						// shared leg (also used by /stop); the helper isolates
						// per-child failures so one bad child cannot strand the rest.
						void stopEverything(seam)
					}}
				/>
			),
			undefined,
			{ tone: "warning" },
		)
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
	// 🧠 context segment (footer context batch, tui-pi footer parity): the
	// occupancy estimate + model window off the seam's live getters. Same
	// turnBusy() re-run trigger as cacheRate() — usage lands at turn end, so
	// the getter-fed segment list re-runs on each turn boundary (footer row
	// only; PowerlineFooter's `left` prop is a getter, reactive-prop law).
	// Unknown window → null → the segment degrades to the bare `🧠 used`.
	const ctxTokens = () => {
		turnBusy()
		return seam.contextTokens?.() ?? null
	}
	const ctxWindow = () => seam.contextWindow?.() ?? null
	// Footer-quickwins (tui-pi footer parity): refresh the model segment's
	// effort level and the remote session snapshot (durable message count +
	// decode-window tok/s). Effort prefers the seam's thinking face
	// (currentEffort — read-only, no adapter/host change) and falls back to
	// parsing the sessionInfo().model label ("provider/model (effort)").
	// An unspecified level defaults to HIGH (display + host route); an
	// explicit level, "off" included, always wins (footer-polish feedback).
	// Called on mount, on session reload and at every turn end.
	let footerRefreshSeq = 0
	// First-turn footer fix: the 💬 count comes from sessionInfo(), which is
	// undefined until the first turn binds the live session id. The mount read
	// therefore lands in the unknown window, and the normal turn-end refresh is
	// gated off by turnBusy() for the whole first turn — the segment would stay
	// hidden until the turn ended. The first streamed delta (or a settled tool
	// run) proves the id is bound, so it triggers this ONE extra re-read.
	// FooterProbeState collapses the delta burst into a single in-flight read
	// and caps retries (max 3, >=400ms apart) so a sessionInfo() that answered
	// undefined / rejected cannot make every subsequent delta issue a read.
	let footerProbe = initialFooterProbeState()
	const resetFooterProbe = () => {
		footerProbe = initialFooterProbeState()
	}
	function refreshFooterIfUnknown() {
		const now = Date.now()
		if (!shouldStartFooterProbe(remoteInfo(), seam.currentSessionId(), footerProbe, now)) return
		footerProbe = markFooterProbeStarted(footerProbe, now)
		refreshFooterData((infoObtained) => {
			// Always release — a bound id whose snapshot has not projected yet,
			// or a rejecting sessionInfo(), must not strand the guard (which
			// would swallow this AND later sessions' first-turn probes). A
			// successful read also resets the budget; a failed one keeps the
			// cap/stamp so the next delta is still throttled.
			footerProbe = settleFooterProbe(footerProbe, infoObtained)
		})
	}
	// A refresh that paints an authoritative count makes further probes moot —
	// clear the guard and the budget. A later session switch (clear/reload) and
	// each turn boundary reset the budget explicitly below.
	createEffect(() => {
		if (remoteInfo() !== undefined) resetFooterProbe()
	})
	const refreshFooterData = (onSettled?: (infoObtained: boolean) => void) => {
		// Stale-promise guard (review fix): a slow earlier refresh must never
		// overwrite a newer refresh's answer — every then/catch below checks
		// the ordinal before touching the signals.
		const seq = ++footerRefreshSeq
		// Review 3.3 fix: the effort has TWO answer sources — the seam's
		// thinking face (currentEffort, provider-native ids such as none/auto)
		// and the sessionInfo().model label parse ("provider/model (effort)").
		// Deciding the default as soon as the FIRST source answered let its
		// "unspecified → high" paint over the other source's explicit value
		// (an explicit label-level `off` was flipped to high). Aggregate BOTH,
		// then decide once: current first, label second, default last.
		let currentEffortWord: string | undefined
		let labelEffortWord: string | undefined
		let effortSourcesPending = 2
		const settleEffort = () => {
			if (--effortSourcesPending > 0 || seq !== footerRefreshSeq) return
			// Both sources answered: aggregate, then decide once (current wins
			// over label; the default only when both are empty).
			const decision = decideEffort(currentEffortWord, labelEffortWord)
			// User directive: an unspecified think level defaults to HIGH.
			// Display half: an explicit word (INCLUDING "off" and provider-native
			// ids) always wins and is never coerced back; decideEffort has
			// already resolved the default for the empty case.
			setEffort(decision.display)
			if (decision.explicit !== undefined || !seam.thinking) return
			// Behavior half: write the default to the route only when the
			// model's real ladder exposes "high" (a non-reasoning model keeps
			// its native behavior). Explicit levels never reach this branch.
			void seam.thinking
				.efforts()
				.then((ladder) => {
					if (seq !== footerRefreshSeq) return
					const target = defaultEffortToApply(decision.explicit, ladder.map((entry) => entry.id))
					return target ? seam.thinking!.selectEffort(target) : undefined
				})
				.catch(() => undefined)
		}
		void Promise.resolve(seam.thinking?.currentEffort())
			.then((word) => {
				if (seq !== footerRefreshSeq) return
				currentEffortWord = word
				settleEffort()
			})
			.catch(() => {
				if (seq !== footerRefreshSeq) return
				settleEffort()
			})
		// Review fix: /model commits a new route through the
		// seam but the model segment only re-read on mount/reload — refresh it
		// here too, or the footer keeps the previous provider/model until the
		// next turn. Same seq guard as the reads above.
		void seam.currentModelSelection()
			.then((s) => {
				if (seq !== footerRefreshSeq) return
				setModel(s)
			})
			.catch(() => undefined)
		void Promise.resolve(seam.sessionInfo?.())
			.then((info) => {
				// Release the probe guard even when a newer refresh superseded
				// this read: a stale result must never strand in-flight. Only the
				// signal writes below are seq-gated; the release is unconditional.
				onSettled?.(!!info)
				if (seq !== footerRefreshSeq) return
				// Footer-quickwins review fix: a missing snapshot (fresh/cleared
				// session before its first event) must DROP the previous session's
				// 💬 count / ⚡ tok/s — keeping them pinned the stale numbers to the
				// next turn's footer until a new snapshot landed.
				if (!info) {
					setRemoteInfo(undefined)
					settleEffort()
					return
				}
				setRemoteInfo({
					msgCount: info.msgCount,
					tps: info.lastTurnTps ?? info.sessionAvgTps,
				})
				labelEffortWord = effortFromModelLabel(info.model)
				settleEffort()
			})
			.catch(() => {
				onSettled?.(false)
				if (seq !== footerRefreshSeq) return
				settleEffort()
			})
	}
	// Turn-end refresh (⚡ tok/s + 💬 message count move at turn boundaries —
	// the same reactive trick cacheRate uses above). The preset label joins
	// here: the live session is created (and its bound preset named by the
	// opening header) on the first turn, after mount already read the roster.
	createEffect(() => {
		if (!turnBusy()) {
			// Each turn boundary gives the next first-turn probe a fresh retry
			// budget; the turn-end refresh itself paints the authoritative count.
			resetFooterProbe()
			refreshFooterData()
			refreshPresetLabel()
		}
	})
	const segments = () =>
		sessionFooterSegments({
			provider: model()?.providerID,
			model: model()?.modelID,
			effort: effort(),
			// Footer 💬 msgs from the seam's session snapshot: one durable
			// assistant/message event = one msg. Hidden while unknown (sessionInfo
			// absent or a resumed session's journal unbound) rather than showing
			// a fabricated 0. messageCount/turnCount stay on the /session panel;
			// the strip shows no turn count.
			msg: remoteInfo()?.msgCount,
			tools: tools(),
			tps: remoteInfo()?.tps ?? null,
			contextTokens: ctxTokens(),
			contextWindow: ctxWindow(),
			cacheHitRate: cacheRate(),
			presetLabel: presetLabel(),
			// A2: bridge link health — dead/recovering show; ready/absent hide.
			bridgeStatus: bridgeStatus(),
			theme,
			// Skin wiring (contract §1): the dsh brand segment's identity blue
			// follows the active theme's color mode. NO elapsedSec — the ⏱
			// segment stays dormant (the busy label + its Ns timer were removed
			// in the HUD merge; the contract pins the powerline shape).
			mode: themeService.mode(),
		})
	let cmdOrdinal = 0
	// `currentValue` (α skin layer): marks the active row with the vendored
	// `●` marker (DialogSelectRow current) WITHOUT moving the selection to it
	// (focusCurrent: false keeps row 0 selected — the e2e 67 bare-Enter
	// contract). `description` rides the option mapping now: pickOne used to
	// drop it (theme facts §5). `headerLine` stays the /resume slot (v2
	// does not paint it — pre-existing gap, unchanged).
	const pickOne = (
		title: string,
		options: { title: string; value: string; description?: string }[],
		headerLine?: string,
		currentValue?: string,
		extras?: PickOneExtras,
	) =>
		new Promise<string | undefined>((resolvePick) => {
			let settled = false
			const done = (value: string | undefined) => {
				if (settled) return
				settled = true
				dialog.clear()
				resolvePick(value)
			}
			// A4 (gap-analysis C14): the extras arming. The rows ride a NATIVE
			// `get options()` accessor (the exact shape JSX compilation produces
			// for `options={rows()}`): solid's props resolve ACCESSOR properties
			// on read but hand function-VALUED props through untouched — a
			// `options: () => rows` function prop reaches DialogSelect's
			// `props.options.filter` as the function itself (real-machine
			// regression 2026-11-15, probe test in test/solid-props.test.ts).
			// Every action press bumps `extrasTick` so the accessor re-runs: the
			// list reorders live while the dialog stays open (tui-pi pickModel
			// parity; the vendored options effect reconciles the cursor onto the
			// moved row on every change).
			const [extrasTick, bumpExtrasTick] = createSignal(0)
			const actions = extras?.actions?.map((action) => ({
				command: action.command,
				title:
					typeof action.title === "function"
						? (option: { value: string } | undefined) => action.title(option === undefined ? undefined : String(option.value))
						: action.title,
				bind: action.bind,
				disabled: action.disabled
					? (option: { value: string } | undefined) => (option === undefined ? false : action.disabled!(String(option.value)))
					: undefined,
				onTrigger: (option: { value: string }) => {
					extras.onAction?.(action.command, String(option.value))
					bumpExtrasTick((n) => n + 1)
				},
			}))
			dialog.replace(
				() =>
					createComponent(DialogSelect, {
						title,
						renderFilter: false,
						get options() {
							if (extras?.getOptions === undefined) {
								return options.map((option) => ({
									title: option.title,
									value: option.value,
									description: option.description,
								}))
							}
							extrasTick()
							return extras.getOptions().map((option) => ({
								title: option.title,
								value: option.value,
								description: option.description,
								category: option.category,
							}))
						},
						...(actions && actions.length > 0 ? { actions } : {}),
						// Extras path only: with focusCurrent:false (the α ● marker)
						// the vendored options-change effect would CLAMP the cursor
						// index on every rebuild — the cursor would sit on whatever
						// row slid into the old position (h-h-h hid three unrelated
						// rows on the real machine). preserveSelection switches it
						// to the by-value reconcile: the cursor FOLLOWS the toggled
						// model across sections (tui-pi rebuild(keepKey) parity) and
						// h on the same cursor row unhides again. The plain path
						// passes static options — the effect never fires there, so
						// its face is unchanged.
						...(extras ? { preserveSelection: true } : {}),
						current: currentValue,
						// Opt-in focus-current arm (extras.focusCurrent — the
						// /language picker): the selection starts on the marked
						// current row so ↑ moves OFF it and bare Enter confirms it.
						// The default stays row 0 (the e2e 67 bare-Enter contract).
						focusCurrent: extras?.focusCurrent === true,
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
	// /theme switch surface (batch F7b — client-face parity with
	// host-entry-v2): live apply + persistence through the seam's
	// configSave (RemoteHostSession.configSave routes `theme` to the
	// profile config.json, host-face parity); boot reads the stored
	// name via themeNameFromConfig (shared/boot-shared.ts). Shared by the
	// /theme command hooks and the /settings panel (one face, no drift).
	const themeFace = {
		current: () => themeSeam.current(),
		list: () => themeSeam.list(),
		set: (name: string, options?: { persist?: boolean }) => {
			const applied = themeSeam.setTheme(name)
			// `persist === false` is the /settings panel's live-only half: the
			// panel persists through its OWN validated patch (so the edited
			// LAYER wins), and a second write here would land on the boot-time
			// layer slipstream — the pollution the review caught.
			if (applied && options?.persist !== false) {
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
		// `persist === false` skips that write for the /settings panel, which
		// already persisted the layer-specific key it edited.
		mode: () => ({
			current: () => (themeService.locked() ? themeService.mode() : "auto"),
			set: (mode: "auto" | "dark" | "light", options?: { persist?: boolean }) => {
				if (mode === "auto") themeService.unlock()
				else if (!themeService.setMode(mode)) return false
				if (options?.persist !== false) {
					try {
						seam.configSave?.({ [themeModePatchKey]: mode })
					} catch (error) {
						console.error("[v2] themeMode persist failed:", error)
					}
				}
				return true
			},
		}),
	}
	// The session-switch refresh, lifted out of the slash deps so the /resume
	// command AND the B1 search-hit resume share ONE reload body (per-session
	// state resets + the journal load targeting the STAGED id — the
	// transcript-loss law: the reload must be told WHICH session to read).
	const reloadSession = (sessionId?: string) => {
		setLastRequest(undefined)
		// A8: any session switch (/new, /fork, /resume) retires a recovery-bound
		// id override so the footer follows the seam's new session id again.
		setSessionIdFromRecovery(undefined)
		// Steer/queue batch: same per-session reset on /fork//resume switches.
		composerRef?.resetDeliveries()
		setComposerPending([])
		// Footer-quickwins: same per-session reset on /fork//resume switches.
		setTools(0)
		resetSkinLineFades()
		// Merged lower-zone wheel position is per-session: drop the old cursor.
		resetMergedDockCursor()
		// /resume stages the id (no live session yet) — read THAT session's
		// journal; /new clears first and reads the (empty) live one.
		const settled = projection.load(sessionId)
		void seam.currentModelSelection().then(setModel)
		resetFooterProbe()
		refreshFooterData()
		refreshPresetLabel()
		// Slash-menu skills: same per-session reset on /fork//resume switches
		// (the new session's catalog is listed after its first message).
		setSkillRows(props.skills ?? [])
		// Composer context row: /fork and /resume are session switches.
		setContextRevision((n) => n + 1)
		return settled
	}
	// B1 (gap C2, tui-pi search.ts parity): Enter on a /search hit resumes
	// through the SAME path a /resume pick takes — stage the id on the seam
	// (`resumeSession` binds it at the next turn), reload THAT journal, then
	// confirm in the transcript. No confirm dialog (the reference's
	// resumeTarget({ id }) fires straight); a rejected resume keeps the
	// overlay open with its own `resume failed — …` status line.
	//
	// P1-2 (review): the probe comes BEFORE the stage. `resumeSession` only
	// records the id (bound at the next turn), so a resume of a cleaned or
	// corrupted journal that failed AFTER staging would leave the id armed —
	// the next message would be sent into the dead session. And
	// `projection.load` deliberately SETTLES read failures instead of
	// rejecting (its catch guards the transcript-loss rule — never clear rows
	// on a failed read — and the fresh-boot empty settle that keeps the
	// "Loading session history…" placeholder from pinning), so a plain
	// `await reloadSession` can never surface the failure. Probing the same
	// `storedTranscript` read the reload will make rejects the resume while
	// NOTHING is mutated: no staged id, no `resumed <id>` echo, the
	// transcript keeps the current session's rows, and the search overlay
	// stays open on its `resume failed — …` line.
	const resumeFromSearch = async (sessionId: string) => {
		await seam.storedTranscript(sessionId)
		seam.resumeSession(sessionId)
		await reloadSession(sessionId)
		sayLine(`resumed ${sessionId}`)
	}
	const slash = createSlashHost(buildSlashDeps({
		seam,
		// Skills ride the SAME registry as the commands: `/name` rows share
		// filtering, highlight navigation and Tab completion, and the host's
		// dispatch falls them through to the model (skills-source.ts). A
		// command-name collision keeps the command (withSkillCommands).
		commands: slashCommands,
		say: sayLine,
		// Batch D2: a session switch (/new → clear, /fork//resume → reload)
		// drops the `●` last-request echo with the rest of the session state.
		// Skin wiring (P2-1): the docks' first-sight fade registry resets too,
		// so a new session's todo/think/tool lines re-run their entrance fade
		// instead of inheriting the previous session's timestamps.
		clear: () => {
			projection.hydrate([])
			setLastRequest(undefined)
			// Steer/queue batch: queued prompts and delivery receipts are
			// per-session state — a switch drops them (never leaks a stale
			// queue into the next session).
			composerRef?.resetDeliveries()
			setComposerPending([])
			// Footer-quickwins: a session switch resets the LOCAL footer counters
			// (🛠 tool runs are per-session local; the remote 💬 count re-reads).
			setTools(0)
			resetFooterProbe()
			refreshFooterData()
			resetSkinLineFades()
			// Merged lower-zone wheel position is per-session: drop the old cursor.
			resetMergedDockCursor()
			// Slash-menu skills: the host catalog is session-scoped, so the
			// previous session's `skills/list` rows must not leak into the new
			// one — fall back to the boot snapshot until its first message
			// triggers #refreshSkillsOnce.
			setSkillRows(props.skills ?? [])
			// Composer context row: re-read the branch for the new session.
			setContextRevision((n) => n + 1)
		},
		reload: reloadSession,
		quit: props.quit,
		pickOne,
	}, {
		// Entry hooks: the typed assembly in src/routes/session/slash-deps.ts
		// pins that every one of these reaches createSlashHost (the /agents
		// regression was a hook that stopped at this object literal).
		promptText,
		openBtw: (argText: string) => void openBtw(argText),
		// Batch H3 client-face parity (host-entry-v2 was the only wired pair —
		// this entry missed the deps, so /search answered "unavailable in this
		// session" while the hint row advertised Ctrl+Shift+F): /search
		// (cross-session FTS overlay) + /plugins (the manager panel — table +
		// state column + `/` filter). Both open through module-signal bridges
		// onto the overlays mounted in the root children below.
		openSearch: () => openSessionsSearch(),
		openPlugins: () => openPluginsPanel(),
		// Gap C3 (tui-pi skills-manager parity): the Installed/Available skill
		// browser over the local skill roots — see skillsManagerRoots below.
		openSkills: () => openSkillsPanel(),
		// tui-pi agents manager parity: table + fields layers over the
		// client-local agent corpus (the composed model column included).
		openAgents: (name?: string) => openAgentsPanel(name),
		// /settings panel v1 (whitelist-driven): local preferences + host
		// settings + read-only namespaces; mounted in the root children below.
		openSettings: () => openSettingsPanel(),
			// B2 (gap C1 step 2, tui-pi history.ts parity): /history opens the
			// two-pane turn browser (the module-bridge panel mounted below).
			openHistory: () => openHistoryPanel(),
		// Gap C3 (tui-pi subagent-viewer parity): /subagents opens the
		// large-window transcript viewer (the module-bridge panel below).
		openSubagents: () => openSubagentsViewer(),
		// Footer-quickwins bug fix (/think parity with tui-pi): setting commands
		// (/think, /model) re-run the page's footer refresh right
		// after the seam mutation settles — the same entry the turn-end effect
		// drives, so the footerRefreshSeq stale-promise guard stays intact.
		refreshFooter: refreshFooterData,
		// Review 3.5: /think bumps the ordinal BEFORE the host accepts the
		// pick, so a pending default-effort write from the last turn end can
		// never land after the user's choice (off stays off). Bump only — no
		// re-read, which would race the OLD effort back onto the footer.
		invalidateFooter: () => {
			footerRefreshSeq++
		},
		// /theme + /settings share ONE theme face (defined above the slash
		// host): live apply + persistence through the same seam write.
		themes: themeFace,
		// /flush (steer/queue batch): deliver the client-side delivery queue
		// NOW. The queue lives in the composer controller; the page holds the
		// composer ref, so the hook reaches it through that ref (the ref is
		// assigned once the composer mounts).
		flushQueue: () =>
			composerRef?.flushQueue() ?? { kind: "empty", started: 0, remaining: 0 },
		// RM-4: a typed `/new` takes the same recovery-UI cleanup the banner
		// action calls, so the dead footer / locked banner never outlive the
		// session switch. The banner path still goes through recovery.newSession().
		clearRecoveryUi: () => recovery.clearRecoveryState(),
	}))
	// A8 banner "new session": reuse the SAME /new command path a typed
	// `/new` takes (seam.newSession + clear + reload) — no second session
	// reset implementation. quit stays the boot-owned shutdown path.
	recoveryNewSession = () => void slash.interceptSubmit("/new")
	// Ctrl+G opens the live subagents panel through the SAME slash dispatch a
	// typed `/subagents` uses — no viewer internals are imported here (the
	// command host owns the mount bridge). Deliberately NOT gated on running
	// agents: the whole point is discoverability; an empty roster gets the
	// command's honest "no subagents" notice instead of a hidden shortcut.
	Keymap.createLayer(() => ({
		enabled: () => pageOwns(),
		commands: [
			{
				id: "session.subagents",
				title: "Subagents activity panel",
				group: "Session",
				run: () => slash.interceptSubmit("/subagents"),
			},
		],
	}))
	// A3b: plain R reconnects only from dead / failed / locked. The command's
	// enabled flag hides it elsewhere; the run body re-checks canRecover() so a
	// stale dispatch can never start a second recovery. Key occupancy: plain
	// `r` is free in config/keybind.ts (ctrl+r = session.rename, <leader>r =
	// redo are distinct strokes).
	// RM-2b V3: a bridge death turns every pending ask card into a terminal
	// "已失效" card that STAYS on the dialog stack. That dialog pushes modal mode
	// + an ownership frame, so a base-mode `pageOwns()` layer would gate R out —
	// exactly the real-device BLOCKED result. Recovery must stay reachable while
	// that terminal card is still visible: `global` mode ignores the modal-mode
	// requirement, and `canRecover()` opens the layer only in dead/failed/locked
	// (page ownership still opens it in the ordinary, no-dialog case). The
	// reconnect command's own `canRecover()` gate is the final guard; its body
	// never forces input ownership, so the visible card is not torn down.
	Keymap.createLayer(() => ({
		mode: "global",
		enabled: () => pageOwns() || recovery.canRecover(),
		commands: [recovery.reconnectCommand()],
	}))
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
		// Copy-on-select (mouse batch): a drag release over the transcript
		// copies the app-owned selection (util/selection). The setting is
		// `terminal.copy` (default select outside Windows).
		onMouseUp: (event: { isDragging?: boolean }) => {
			if (copyOnSelectEnabled(config.data.terminal)) copyOnSelectRelease(event, renderer, toast, clipboard)
		},
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
						// for the duration of the fetch before it fills. A local send
						// upserts a user row synchronously (seam-rows send()), so the
						// empty-rows check alone also covers "first message sent".
						visible: () => projection.hydrated() && projection.rows.length === 0,
						model: () => model()?.modelID,
						muted: () => theme.text.muted,
						// Skin wiring (contract §1): the identity gradient follows the
						// active theme's color mode (light themes darken the brand
						// ramp for contrast — skin/identity.ts).
						mode: () => themeService.mode(),
						// Splash plugin tree (tui-pi welcome parity): profile-name
						// root + the bridged plugin rows (signal above).
						title: () => props.profileName,
						plugins: () => pluginRows(),
						// Plugin-block cap/clip follow the LIVE terminal size (the
						// renderer resize signal, terminal-size.ts): a mid-splash
						// resize recomputes the cap instead of freezing at the boot
						// snapshot.
						size: () => dimensions(),
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
					// B1 (gap C2): Enter on a search hit resumes it through the
					// /resume seam path (resumeFromSearch: stage + reload(id) + say).
					onResumed: (sessionId: string) => resumeFromSearch(sessionId),
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
				// Skills manager panel (gap C3, tui-pi skills-manager parity):
				// /skills opens the Installed/Available browser over the local
				// skill roots. Getter-prop law: the roots ride getters.
				// PROP RECAST LAW (the second half of the exit-2 bug): object
				// getters in a children literal are BAKED INTO VALUES before the
				// component body runs — `get source()` arrived as the bare string
				// and `props.source()` inside the panel threw TypeError. The
				// HistoryPanel `sessionId: () => …` precedent is the right shape:
				// arrow-function props survive, and the panel calls them.
				createComponent(SkillsPanel, {
					source: () => props.skillsSource,
					curated: () => props.skillsCurated,
					onClosed: () => {
						if (composerRef && !composerRef.focused()) composerRef.focus()
					},
				}),
				// Agents manager panel (tui-pi agents manager parity): /agents
				// opens the definition table; Enter drills into the fields layer.
				createComponent(AgentsPanel, {
					get seam() {
						return seam
					},
					onClosed: (summary?: string) => {
						if (summary !== undefined) sayLine(summary)
						if (composerRef && !composerRef.focused()) composerRef.focus()
					},
				}),
				// History browser (B2 gap C1 step 2, tui-pi history.ts parity):
				// /history opens the two-pane turn browser. Getter-prop law: the
				// seam and the current-session id ride getters.
				createComponent(HistoryPanel, {
					get seam() {
						return seam
					},
					// The /history bare target: the live id — or the staged stored
					// id (auto-resume / resumeFromSearch / fork resume) until the
					// next turn binds it (the transcript-loss law: never rely on
					// the live id alone). Review P1-1: the seam's staged face is the
					// ONLY id a resumed-but-not-yet-turned session has — without it
					// the browser opened on the boot-time session (or nothing).
					sessionId: () =>
						seam.currentSessionId() ?? seam.stagedSessionId?.() ?? props.initialSessionId,
					// Enter/c refill (tui-pi copy semantics): write the turn's first
					// human prompt into the composer editor and focus it (the panel
					// closes itself; onClosed reclaims focus below).
					onRefill: (text: string) => {
						composerRef?.node()?.setText(text)
						if (composerRef && !composerRef.focused()) composerRef.focus()
					},
					// f fork-at-turn success: resume the forked session through the
					// SAME seam path a /resume pick takes (stage + reload + say) —
					// the B1 resumeFromSearch shape, INCLUDING its ordering (review
					// P2-1): the echo line is appended only AFTER the reload lands —
					// a hydrate-appended row wipes any line appended before it
					// (seam-rows keyed reconcile), so `void reload` + immediate say
					// erased the "forked from turn #N" confirmation.
					onForked: async (forkedId: string, turn: number) => {
						seam.resumeSession(forkedId)
						await reloadSession(forkedId)
						sayLine(`forked from turn #${turn} → ${forkedId}`)
					},
					onClosed: () => {
						if (composerRef && !composerRef.focused()) composerRef.focus()
					},
				}),
				// Subagents transcript viewer (gap C3, tui-pi subagent-viewer
				// parity): /subagents opens the list + live transcript layers.
				// Getter-prop law: the seam rides a getter.
				createComponent(SubagentsViewer, {
					get seam() {
						return seam
					},
					onClosed: () => {
						if (composerRef && !composerRef.focused()) composerRef.focus()
					},
				}),
				// Settings modal (T18): panel-kit stack layer, 6-section nav,
				// General 12 rows. The host watches the module bridge, so
				// /settings (and the agents jump) still call openSettingsPanel.
				// Command-jump sections close first, then prefill the composer.
				createComponent(SettingsModalHost, {
					get seam() {
						return seam
					},
					themes: themeFace,
					// Command-jump sections close first, then RUN the command
					// (contract §3.5) through the same slash host the composer
					// uses — 打开 /model must open the picker, not leave
					// "/model " staged in the composer.
					onCommand: (command: string) => {
						slash.interceptSubmit(command)
					},
					onClosed: (summary?: string) => {
						if (summary !== undefined) sayLine(summary)
						// A jump may have opened a dialog (the /model picker);
						// stealing focus back to the composer would kill its keys.
						if (dialog.stack.length === 0 && composerRef && !composerRef.focused()) composerRef.focus()
					},
				}),
				createComponent(Transcript, {
					seam,
					projection,
					// Pane focus: heavy/accent frame while the transcript owns
					// the renderer focus, single/border.base otherwise.
					focused: paneFocus.transcriptFocused,
					scrollRef: (value: ScrollBoxRenderable | undefined) => (transcriptScroll = value),
					// HUD merge (2026-11-17): the transcript `status` slot is
					// intentionally LEFT UNUSED (undefined) — no StatusBar is
					// mounted here any more. The 🐳 comet moved into the LAST
					// page row (HintsLine), to the left of the key hints; the busy
					// status label was deleted. The slot stays in the Transcript
					// API (optional) rather than restructuring that component.
					// Batch D1 widgets slot (dsh-tui-pi dock structure): the fixed
					// Todos → Think → Tool panels ride the SAME projection the
					// transcript paints — the dock reads the tool/reasoning rows the
					// transcript no longer renders. Getter-prop law: rows is a getter.
					widgets: createComponent(WidgetsDock, {
						get rows() {
							return projection.rows
						},
						// Skin wiring (contract §1 活动区): the turn-lifetime activity
						// frame is driven by the page's busy window. PROP RECAST LAW:
						// a `get turnActive()` GETTER here is baked to its mount-time
						// VALUE (false) before the component body runs — the accessor
						// must ride a STABLE FUNCTION value so WidgetsDock's own
						// scopes keep tracking it (same pattern as WelcomeHero's
						// state object).
						turnActive: () => busy(),
					}),
					// Steer/queue batch: queued waits and steer receipts paint at the
					// bottom of the transcript flow (inside the scrollbox).
					pending: () => composerPending(),
				}),
				// Composer seat, lifted out of Transcript's bottom slot into the
				// page-root column (spec §2): DockSeat is a sibling of Transcript,
				// so a dock request takes the seat in flow, full width, and the
				// transcript reflows above it. With no request the seat renders
				// exactly the composer stack this file used to pass as
				// Transcript's `children`.
				createComponent(DockSeat, {
					composer: () => [
						// Composer info bar (steer/dir/branch batch): the working
						// directory + git branch embedded in the input box's top
						// border (one-row rule at compact heights). The probe is
						// shell's client-local remote-git.ts (branch, or the short
						// SHA on a detached HEAD); a failed read resolves "" →
						// directory-only, never an error row. steer = the page's
						// composer-busy mirror — the existing steer window.
						createComponent(ComposerContext, {
							cwd: () => props.workspace,
							probeBranch: props.probeBranch,
							revision: () => contextRevision(),
							steer: () => composerBusy(),
							attachTitle: (get) => {
								contextFrameTitle = get
							},
						}),
						createComponent(SessionComposer, {
							seam,
							send,
							footerHint: false,
							// A3b: RECOVERING refuses submits; the typed draft is kept.
							disabled: () => recovery.composerDisabled,
							disabledReason: () => t("recovery.composer.disabled"),
							frameTitle: () => contextFrameTitle?.() ?? "",
							onBusyChange: setComposerBusy,
							ref: (r: { focused(): boolean; focus(): void; node(): import("@opentui/core").TextareaRenderable | undefined; resetDeliveries(): void }) => (composerRef = r),
							// Steer/queue batch: busy Enter opens the two-row choice on
							// the page's dialog stack (Steer highlighted first; Esc keeps
							// the typed text). The queue lives client-side in the
							// controller; its rows feed the transcript's pending slot.
							chooseDelivery: (text: string) => openDeliveryChoice(dialog, text),
							onPendingChange: (rows: readonly ComposerPendingRow[]) => setComposerPending(rows),
							onQueuePaused: (info: { remaining: number; reason: "failed" | "aborted" }) =>
								showNotice(
									`队列已保留 ${info.remaining} 条:本回合${info.reason === "failed" ? "失败" : "已中止"},下回合结束后继续发送`,
									8000,
								),
							isTurnAborted: () => turnAborted,
							slashKeyFilter: slash.slashKeyFilter,
							slashSync: (buffer: string) => slash.controller.sync(buffer, slash.commands),
							interceptSubmit: slash.interceptSubmit,
							// Tab completion is composer-only while no dialog owns the
							// screen: an approval/dialog-select layer keeps its own Tab
							// (undefined = fall through, do not steal the key).
							slashComplete: (buffer: string, cursor: number) =>
								dialog.stack.length > 0 ? undefined : slash.slashComplete(buffer, cursor),
							slashPalette: () => createComponent(SlashPalette, { controller: slash.controller, commands: () => slash.commands }),
							slashHeight: () => slash.controller.rows(),
						}),
					],
				}),
				// Batch D2 lastRequest slot (dsh-tui-pi live-widgets structure):
				// the `●` echo + running-children lines paint BELOW the editor —
				// now below the page-root seat, keeping the no-dock order
				// status → widgets → composer → lastRequest → notices → powerline
				// → hints identical to the old transcript bottom slot.
				createComponent(LastRequestDock, {
					get rows() {
						return projection.rows
					},
					get lastRequest() {
						return lastRequest()
					},
				}),
				// Batch D3 notices slot (dsh-tui-pi tui.ts:256): stacked
				// auto-dismissing lines below lastRequest, above the powerline.
				createComponent(NoticesDock, {}),
				// A8: persistent recovery banner — reason + reconnect /
				// new-session / quit actions. Zero rows until failed/locked.
				createComponent(RecoveryBanner, { controller: recovery }),
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
						// ADR-0008: page frame on top (no dialog, panel or dock).
						enabled: pageOwns,
					}),
					// Pane focus keys (./pane-focus.tsx): F6 toggles the two
					// panes; while the transcript is focused ↑↓/PgUp/PgDn/Home/End
					// scroll it, Tab and idle Esc return to the composer. The F6
					// layer yields to dialogs, the slash menu and the subagent
					// picker, so no overlay ever loses its keys.
					createComponent(PaneFocusKeys, {
						pane: paneFocus.pane,
						// Both pane layers (F6 and transcript keys) gate on the
						// ownership stack: the pane-focus leak was wider than
						// PgUp/PgDn and at priority 1, so a dialog/panel/dock
						// above the page must win (ADR-0008 consequences).
						keysEnabled: pageOwns,
						slashOpen: () => slash.controller.open,
						pickerOpen: subagentsPickerOpen,
						busy,
						scroll: () => transcriptScroll,
						toggle: paneFocus.toggle,
						focusComposer: paneFocus.focusComposer,
					}),
					// Cancel contract (batch V2, ./turn-cancel.tsx): esc on a running
					// turn arms the stop (U6 double-press), a second esc inside the
					// window opens the stop-everything confirm (main turn + every
					// live subagent); ctrl+c interrupts + arms, ctrl+c x2 quits
					// through props.quit (the shutdown-intercepted process.exit).
					createComponent(TurnCancelKeys, {
						busy,
						interrupt: () => {
							// Steer/queue batch: abort resolves the seam turn without an
							// error, so the composer's queue policy needs this flag to
							// keep (not silently send) the queue.
							turnAborted = true
							seam.interrupt()
						},
						confirmStop: () => {
							// The flag flips only on a CONFIRMED stop — a cancelled
							// dialog leaves the turn (and its queue policy) untouched.
							confirmStopAll()
						},
						quit: props.quit,
						// ADR-0008: one layer, page-owned. While any overlay frame
						// (dialog, panel, ask dock) is on top, both Esc and Ctrl+C
						// belong to it.
						enabled: pageOwns,
						escapeYields: () => slash.controller.open,
					}),
				// REACTIVE-PROP LAW (batch 10d): signal reads ride GETTERS. An
				// eager `busy()` / `segments()` / `now()` read here is tracked by
				// this children getter, so every 1s clock tick re-ran it and
				// REMOUNTED the whole subtree — the SessionComposer owning the
				// in-flight turn was disposed and its busy=false dropped by its
				// disposed guard: "Writing…" frozen after a settled turn.
				// HUD merge (2026-11-17): the page bottom is the powerline, then
				// the hints row LAST (dsh-tui-pi PowerlineFooter → FooterHint
				// order); that last row now also carries the busy comet.
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
					// GETTER-PROP LAW: a STABLE FUNCTION value, not a baked
					// `get busy()` snapshot — the latter is recast to its mount-time
					// value before HintsLine's body runs (the exact WidgetsDock
					// turnActive trap). HintsLine calls props.busy() at render time
					// so busy/idle (and the comet) flip live.
					busy: () => busy(),
					// Pane focus: transcript-focused swaps the row to the scroll
					// keys (4 locales, hints-line.tsx).
					pane: paneFocus.pane,
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
 * The v2 boot: ensureHost → ClientConnection → RemoteHostSession → seam →
 * the rebuilt view. The seam is selected here (the synthetic root): in inproc
 * mode it is BridgeSessionSeam over an injected stdio transport; otherwise —
 * or with the deprecated `--remote` — it stays RemoteSessionSeam (the legacy
 * thin client, retained in phase one). Shutdown semantics are client-entry
 * parity (dispose session → release host ref → idle reaper hand-off).
 */
export async function bootClientV2(options: {
	argv?: readonly string[]
	/** Injected bridge transport (inproc mode). Production creates the real
	 *  stdio transport; tests inject a fake. */
	bridgeTransport?: {
		request(method: string, params?: Record<string, unknown>): Promise<unknown>
		onEvent(listener: (event: { type: string; payload: unknown }) => void): () => void
	}
	/** Injected seam logger (inproc mode). */
	bridgeCtx?: { logger: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void } }
} = {}): Promise<ClientBootV2> {
	const { shared, lifecycle, clifecycle, transport, rhs, adapter, git, seamBootstrap } = await loadShell()
	const workspace = process.cwd()
	const profile = lifecycle.DEFAULT_PROFILE
	const idleExitMs = lifecycle.resolveIdleExitMs()
	const idleExitSec = idleExitMs / 1000

	shared.bootCallOrder.push("ensureHost")
	// ADR-0009 (P0-1): attach through the v2 host-launch stack (v2 registry),
	// never the legacy v1 ensureHost that overwrites the registry on adopt.
	const host = await lifecycle.ensureV2Host({ profile, idleExitSec })
	// ADR-0009 decision 6: register this client's OWN heartbeat as soon as the
	// attach succeeded, refresh every ~3s, and start the detached all-crash
	// watchdog. All I/O here is best-effort — a heartbeat failure must never
	// block the TUI from booting.
	let clientHeartbeat: ReturnType<typeof clifecycle.registerHeartbeat> | null = null
	let heartbeatRegistered = false
	try {
		clientHeartbeat = clifecycle.registerHeartbeat(host.dshHome, { pid: process.pid, workspace })
		clientHeartbeat.start()
		heartbeatRegistered = true
	} catch (error) {
		console.error("[v2-entry] heartbeat registration failed:", error)
	}
	// P1-6: do NOT arm the all-crash watchdog when our own heartbeat was not
	// registered — with no heartbeat file the watchdog would reclaim the host
	// from under this still-live client after the TTL.
	if (heartbeatRegistered) {
		try {
			const scriptPath = resolveWatchdogScript()
			if (scriptPath) clifecycle.spawnWatchdog(host.dshHome, { scriptPath, profile })
		} catch (error) {
			console.error("[v2-entry] watchdog spawn failed:", error)
		}
	}
	shared.bootCallOrder.push("connect")
	const connection = new transport.ClientConnection({
		authority: host.authority,
		cookieHeader: host.cookieHeader,
		// Surface the child's stderr tail if the first connection cannot be
		// established (host died/wedged right after boot) instead of the SDK's
		// silent infinite retry loop.
		diagnostics: () => host.diagnostics(),
	})
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

	const launchArgs = parseLaunchArgs(options.argv ?? process.argv.slice(2))
	// M2/T9: the seam is chosen HERE — the synthetic root. inproc mode defaults
	// to BridgeSessionSeam; the deprecated `--remote` (and any non-inproc
	// launch) keeps the legacy RemoteSessionSeam. Bridge handshake/fingerprint
	// failure throws (BridgeBootstrapError, three elements) — NEVER falls back.
	const seamKind = seamBootstrap.selectSeamKind({
		inproc: seamBootstrap.isInprocMode(),
		remote: launchArgs.remoteRequested === true,
	})
	const seam = await seamBootstrap.createSessionSeam({
		kind: seamKind,
		createBridge: async () => {
			if (options.bridgeTransport === undefined) {
				throw new seamBootstrap.BridgeBootstrapError({
					code: "BRIDGE_TRANSPORT_MISSING",
					diagnosis: "inproc mode is on (DSH_OPENTUI_INPROC=1) but no bridge transport was injected at the synthetic root",
				})
			}
			return seamBootstrap.createBridgeSessionSeam({
				transport: options.bridgeTransport,
				ctx: options.bridgeCtx ?? { logger: console },
				// A2: DEAD is event-driven (no turn needed, so an idle crash paints
				// immediately). showNotice is the global transient notices dock.
				// A3b: the notice now carries the actionable reconnect hint; the
				// R key itself is a page keymap layer and the terminal states get
				// a persistent banner (see RecoveryUiController).
				onDead: (cause: { stage: string; code: number | null; signal: string | null; message: string }) =>
					void showNotice(
						`${seamBootstrap.formatDeadNotice(cause)} · ${t("recovery.action.reconnect")}`,
						undefined,
						"error",
					),
				// ADR-0011 T8/Q4: one-shot TRANSIENT fail-closed notice when the
				// approval provider cannot be confirmed (the seam fires this at
				// most once per process). Never a persistent status bit. The
				// reason is a stable code localized through i18n below.
				onPermissionUnavailable: (reason: string) =>
					void showNotice(
						`${t("notice.permission.unavailable")} · ${t(`notice.permission.reason.${reason}`)}`,
						undefined,
						"error",
					),
			})
		},
		createRemote: () => new adapter.RemoteSessionSeam(session as never),
	})
	// A3b: the one recovery entry injected into the page. The real inproc
	// transport satisfies recoverBridgeSession's RecoverableBridgeTransport
	// (StdioBridgeTransport.recover); a legacy remote seam has no recovery and
	// leaves the prop undefined so the R layer is inert there.
	const recoverBridge =
		seamKind === "bridge" && options.bridgeTransport !== undefined
			? () =>
					seamBootstrap.recoverBridgeSession({
						transport: options.bridgeTransport as never,
						seam: seam as never,
					})
			: undefined
	registerTurnOverlays(seam, overlays, {
		// RM-2b V3: DEAD means the bridge PROCESS died — AskRegistry died with it,
		// so no pending snapshot can be rebuilt. Every pending card is painted as
		// a terminal "已失效" card with this localized reason + the dead cause's
		// own diagnostic (stage/code/signal/message).
		deadReason: (details) => {
			const cause = details as { message?: unknown } | undefined
			const detail = typeof cause?.message === "string" && cause.message.trim() !== "" ? cause.message : ""
			return detail === "" ? t("overlay.ask.invalidated.disconnected") : `${t("overlay.ask.invalidated.disconnected")} · ${detail}`
		},
	})
	// feat/auto-resume: dsh sessions are persisted server-side, but a plain
	// launch must land on a NEW session (the default is `autoResume: "off"`).
	// Restoring the newest non-empty session from THIS workspace is an opt-in:
	// `"autoResume": "last"` in the merged profile config, or `--resume-last`
	// for one launch (which overrides the config). `--new` wins over both, and
	// `--session <id>` names the journal outright. When off, nothing is listed,
	// no id is staged and no `resumed …` notice is produced. The list is
	// bounded and any failure logs one WARN and keeps the fresh-session boot.
	// The id is only STAGED here (`resumeSession` binds at the next turn), so
	// the page reads its journal explicitly (onMount) and no writer lock is
	// taken at boot.
	let initialSessionId: string | undefined
	let resumeNotice: string | undefined
	if (launchArgs.sessionId !== undefined) {
		// `--session <id>`: the caller named the journal — open it as-is and
		// stay out of the auto path (an explicit pick never needs a notice).
		seam.resumeSession(launchArgs.sessionId)
		initialSessionId = launchArgs.sessionId
	} else {
		const autoResume = await runAutoResume(
			// configLoad is OPTIONAL in SessionSeam: a seam without it must
			// degrade to "no stored override", never crash the render path.
			{ config: seam.configLoad?.() ?? {}, launch: launchArgs, workspace },
			{
				listSessions: (limit) => seam.listSessions(limit),
				resumeSession: (id) => seam.resumeSession(id),
				warn: (message) => console.warn(message),
			},
		)
		initialSessionId = autoResume?.id
		resumeNotice = autoResume?.line
	}
	// Slash-menu skills (skills-source.ts): a read-only boot snapshot of the
	// same filesystem roots the host's skill provider scans. The host RPC
	// (`skills/list`) is session-scoped and no session exists before the
	// first prompt, so the menu would otherwise be empty at first paint.
	// The agents home uses the HOST's precedence (explicit config > non-empty
	// DSH_AGENTS_HOME > ~/.agents, `resolveAgentsHome`) so this scan and the
	// provider read the same root; the client's config seam is the explicit
	// leg it can see.
	// Contained: a broken root yields the empty catalog, never a boot failure.
	// One agentsHome resolution shared by BOTH skill surfaces: the slash
	// palette boot scan below and the /skills manager panel (gap C3) — the
	// explicit-config precedence must not diverge between them.
	const agentsHomeConfig = (seam.configLoad?.() ?? {}).agentsHome as string | undefined
	const agentsHomeForSkills = resolveAgentsHome(agentsHomeConfig)
	// P2-2 boundary warning (skills-source.ts): a set-but-blank DSH_AGENTS_HOME
	// — or a blank config `agentsHome`, which penetrates the host's `??` chain
	// the same way — is unset here (resolveAgentsHome falls back to ~/.agents)
	// but the HOST provider resolves the empty string to its cwd, so the two
	// skill surfaces can read different roots. The host is out of this repo's
	// reach — surface the misconfiguration through the notices dock instead.
	pendingAgentsHomeNotice = agentsHomeEnvWarning(undefined, agentsHomeConfig)
	const skillRows = discoverSkills({
		cwd: workspace,
		dshHome: host.dshHome,
		agentsHome: agentsHomeForSkills,
	})
	// /skills manager roots (gap C3): the panel manages the SAME pair of
	// roots this boot scan read — the agents home's skills/ (the public
	// source) and <dshHome>/skills (the curated user root installs symlink
	// into; rank 400 outranks the agents home's 500, so a promoted copy is
	// the one the host provider serves).
	const skillsManagerRoots = {
		source: join(agentsHomeForSkills, "skills"),
		curated: join(host.dshHome, "skills"),
	}
	// One-shot skin migration (α skin layer, real precedence chain env >
	// workspace > profile): a STORED legacy `theme` key (profile OR
	// workspace layer) switches to the dsh-blue default once, persists the
	// `skinMigration` marker in the PROFILE config, writes dsh-blue back to
	// the layer the legacy key lived in, and queues the one-time notice.
	// Env-pinned themes (DSH_OPENTUI_THEME) skip — the effective theme is
	// not a stored choice. Fresh profiles fall to the default naturally.
	// Best-effort: a failed persist still applies the theme for this boot.
	const envTheme = process.env[shared.ENV_THEME]
	// configRaw / workspaceConfig are OPTIONAL seam faces (same contract as
	// configLoad above): a seam without them degrades to "no stored layer".
	const workspaceConfig = seam.workspaceConfig?.() ?? {}
	const migration = shared.skinMigrationPlan({
		profileConfig: seam.configRaw?.() ?? {},
		workspaceConfig,
		envTheme,
	})
	if (migration) {
		// P1-2 (review): the persist is awaited and the one-shot notice only
		// fires when the marker actually landed — a failed write must leave
		// NO marker so the next boot retries instead of showing the notice
		// forever with the migration never committed.
		try {
			const patch: Record<string, unknown> = { skinMigration: migration.skinMigration }
			if (migration.layer === "workspace") patch.workspaceTheme = migration.theme
			else patch.theme = migration.theme
			await session.configSave(patch)
			pendingMigrationNotice = migration.notice
		} catch (error) {
			console.error("[v2] skin migration persist failed (will retry next boot):", error)
		}
	}
	// The mode-pin layer mirrors the theme's layer: workspace theme → the
	// workspace slice; profile (or env) theme → the profile config.json.
	themeModePatchKey = migration?.layer === "workspace" || (!envTheme && workspaceConfig.theme !== undefined) ? "workspaceThemeMode" : "themeMode"
	const themeName = migration ? migration.theme : shared.themeNameFromConfig(session)
	const themeModeLock = shared.themeModeFromConfig(session)
	// Skin wiring (contract §1 动效档位): replay the motion tier BEFORE the
	// first paint — `DSH_OPENTUI_MOTION` (env) beats the persisted profile
	// `motion` key (/motion), both beat the auto tier (reduced until the
	// capability probe confirms truecolor; tmux/SSH stay reduced). e2e and
	// screenshots force full through the env var.
	setMotionTier(
		resolveMotionPreference(process.env[shared.ENV_MOTION], shared.motionFromConfig(session)),
	)
	// Hint-bar persistence (footer-quickwins review): replay the persisted
	// /hints selection (profile `footerHints` / `hintsLocale` keys — /motion
	// parity) BEFORE the first paint, so a restart keeps the toggles.
	applyHintsConfig(seam.configLoad?.())
	// U4 panelHeight replay (/motion parity): restore the persisted /settings
	// gear BEFORE the first paint, so a restart keeps the chosen panel size.
	applyActivityPanelConfig(seam.configLoad?.())
	// i18n boot replay (design §3, applyHintsConfig parity): seed the active
	// language BEFORE the first paint — unified `lang` key first, legacy
	// `hintsLocale` folds in when no unified value exists (zh-CN aliases
	// collapse; ja/ko degrade to en). This boot seeds the signal only; the
	// language stays LIVE afterwards — /language and /hints lang flip it at
	// runtime through setLanguage (commands.ts), and t() call sites in
	// tracking scopes re-render on the flip.
	applyI18nConfig(seam.configLoad?.())

	let shutdownPromise: Promise<void> | null = null
	const shutdown = (): Promise<void> => {
		shutdownPromise ??= (async () => {
			shared.bootCallOrder.push("shutdown")
			try {
				await Promise.race([session.dispose(), new Promise((resolve) => setTimeout(resolve, shared.SHUTDOWN_GRACE_MS))])
			} catch {
				/* dispose is best-effort on the quit path */
			}
			// Inproc bridge seam: dispose the bridge session and close its
			// stdio child FIRST. Best-effort — a dead bridge must not block quit.
			if (seamKind === "bridge") {
				try {
					await Promise.race([seam.dispose(), new Promise((resolve) => setTimeout(resolve, shared.SHUTDOWN_GRACE_MS))])
				} catch {
					/* best-effort */
				}
				options.bridgeTransport?.close?.()
			}
			// ADR-0009 decision 6: client-side bridge is closed before we drop
			// our own heartbeat and let the last-one logic decide (after the grace
			// window) whether to SIGTERM the host.
			if (clientHeartbeat) {
				clientHeartbeat.stop()
				clientHeartbeat.remove()
				try {
					await clifecycle.lastOneGracefulShutdown(host.dshHome, { profile, hooks: clifecycle.psKillHooks })
				} catch (error) {
					console.error("[v2-entry] last-one shutdown failed:", error)
				}
			}
			// Grace-window parity (client-entry): release — NOT dispose — the
			// host, then hand the idle-exit to the detached reaper. ADR-0009:
			// v2-backed hosts are governed by last-one grace + watchdog only;
			// never arm the legacy idle-5s reaper on the production path.
			host.release()
			if (host.v2Managed !== true && host.refCount === 0 && idleExitMs > 0) shared.spawnIdleReaper(host, idleExitMs)
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
										// Mouse batch: a REAL clipboard (the no-op stub was
										// only viable while the app never owned a selection).
										return createComponent(ClipboardHost, {
											get children() {
												return createComponent(InputOwnershipProvider, {
													get children() {
														return createComponent(DialogProvider, {
															get children() {
																return createComponent(ErrorBoundaryDiagnostics, {
																	get children() {
																		// PanelKit host (T17-INT2): inside ThemeProvider +
																		// Keymap.Provider, wrapping the page so the stack's
																		// layers are absolute siblings of the page root
																		// (zIndex 3000+) and cover the transcript and every
																		// page-level panel.
																		return createComponent(PanelKitHost, {
																			get children() {
																				return createComponent(V2SessionPage, {
																					seam,
																					themeName,
																					quit: () => process.exit(0),
																					recoverBridge,
																					workspace,
																					// Splash hero plugin-tree root (the boot profile).
																					profileName: profile,
																					// Branch-or-SHA probe (composer context row):
																					// client-local, silent on non-repos.
																					probeBranch: (cwd: string) => git.probeGitBranchOrSha(cwd),
																					// feat/auto-resume: the staged stored session +
																					// its one-line notice (undefined = fresh boot).
																					initialSessionId,
																					resumeNotice,
																					skills: skillRows,
																					// /skills manager roots (gap C3): see the
																					// V2SessionPage props note — boot-scope values
																					// ride PROPS into the page, never closure reads
																					// from the children getters (the exit-2 bug).
																					skillsSource: skillsManagerRoots.source,
																					skillsCurated: skillsManagerRoots.curated,
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
						})
					},
				})
			},
		}),
		// Renderer options (focus batch): mouse reporting ON — clicks focus the
		// pane under the pointer (autoFocus, renderer default) and the wheel
		// scrolls the transcript. Drag-select is app-owned; the page root's
		// onMouseUp copies it on release (terminal.copy). Shift+drag bypasses
		// to the terminal's native selection for Cmd+C.
		// exitOnCtrlC OFF (batch V2): OpenTUI's default `true` grabs ctrl+c
		// in the raw key handler ahead of every keymap layer and runs its
		// own exitHandler — bypassing shutdown and leaving a wiped frame.
		// TurnCancelKeys owns ctrl+c (vendored app.tsx / engine.ts parity).
		{ useMouse: true, exitOnCtrlC: false },
	).then(() => {
		appendDiagnostic("[v2] render promise resolved")
	}).catch((error: unknown) => {
		appendDiagnostic(`[v2 boot render failed] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
		process.exit(1)
	})
	return { shutdown }
}

/**
 * Clipboard host (mouse batch): the v2 tree used to mount a no-op clipboard
 * (mouse reporting was off; the terminal's native selection was the copy
 * path). With the app owning mouse selection again, copy-on-select must
 * actually reach the clipboard — same `createTuiClipboard(renderer)` the
 * vendored app.tsx uses (host + OSC 52 + renderer adapter).
 */
function ClipboardHost(props: { children: unknown }) {
  const renderer = useRenderer()
  const service = createTuiClipboard(renderer as never)
  onCleanup(() => void service.dispose())
  return createComponent(ClipboardProvider, {
    value: service,
    get children() {
      return props.children
    },
  })
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
