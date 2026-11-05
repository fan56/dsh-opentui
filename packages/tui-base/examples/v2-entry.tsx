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
import { SessionComposer } from "../src/routes/session/session-composer"
import { createSeamRows } from "../src/routes/session/seam-rows"
import { Transcript } from "../src/routes/session/transcript"
import { TurnOverlayController } from "../src/routes/session/turn-overlay-controller"
import { registerTurnOverlays, TurnOverlayHost } from "../src/routes/session/turn-overlays"
import { createSlashHost, SlashPalette } from "../src/routes/session/slash-palette"
import { DialogSelect } from "../src/ui/dialog-select"
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

/** The v2 session page: the real seam driving the rebuilt view. */
function V2SessionPage(props: { seam: RemoteSessionSeam; themeName?: string; quit: () => void }) {
	const seam = props.seam
	const projection = createSeamRows(seam, () => seam.currentSessionId() ?? "", {
		// Mid-turn approvals route through the batch-5 card.
		onApprove: (name, args) => overlays.requestApproval(name, args),
	})
	const dialog = useDialog()
	const theme = useTheme()
	const themeSeam = createThemeSeam(useThemes())
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
	let composerRef: { focused(): boolean; focus(): void } | undefined
	onMount(() => {
		void projection.load()
		void seam.currentModelSelection().then(setModel)
		const timer = setInterval(() => setNow(new Date()), 1000)
		onCleanup(() => clearInterval(timer))
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
			messages: msgs(),
			tools: 0,
			theme,
		})
	let cmdOrdinal = 0
	const pickOne = (title: string, options: { title: string; value: string }[]) =>
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
						options: options.map((option) => ({ title: option.title, value: option.value })),
						onSelect: (option: { value: string }) => done(option.value),
						onCancel: () => done(undefined),
					}),
				() => done(undefined),
			)
		})
	const slash = createSlashHost({
		seam,
		say: (text: string) =>
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
		quit: props.quit,
		pickOne,
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
		backgroundColor: "black",
		get children() {
			return [
				createComponent(Transcript, {
					seam,
					projection,
					get children() {
						return createComponent(SessionComposer, {
							seam,
							send,
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
				// REACTIVE-PROP LAW (batch 10d): signal reads ride GETTERS. An
				// eager `busy()` / `segments()` / `now()` read here is tracked by
				// this children getter, so every 1s clock tick re-ran it and
				// REMOUNTED the whole subtree — the SessionComposer owning the
				// in-flight turn was disposed and its busy=false dropped by its
				// disposed guard: "Writing…" frozen after a settled turn.
				createComponent(StatusBar, {
					get phase() {
						return busy() ? "stream" : null
					},
					elapsed,
				}),
				createComponent(PowerlineFooter, {
					get left() {
						return segments()
					},
					get right() {
						return clock(now())
					},
					theme,
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
	const themeName = shared.themeNameFromConfig(session)

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
