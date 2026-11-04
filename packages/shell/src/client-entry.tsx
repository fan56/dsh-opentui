/**
 * Client-mode entry (ADR-0005): the TUI as a thin rendering client.
 *
 *   ./dsh-opentui --client        # bun src/client-entry.tsx
 *
 * Wiring (decisions 1-3):
 *   ensureHost({ profile: 'opentui', idleExitSec: 60 })  — resident host
 *     (single-instance lock, grace-window re-attach on the next client)
 *   → ClientConnection({ authority, cookieHeader })       — the carrier
 *   → RemoteHostSession                                   — HostSession-shaped
 *     facade over Remote RPC + $events
 *   → ShellHost render                                    — zero UI changes
 *
 * Sourcing rules:
 * - Workspace = the launch cwd (ADR-0005 decision 1): session/create cwd,
 *   the welcome banner, the powerline git probe and the wave-3 workspace
 *   overlay (`./.dsh/config.yml`) all key off `process.cwd()`. The process
 *   never chdirs.
 * - Theme comes from `session.configLoad().theme` (profile config.json ⊕
 *   workspace overlay ⊕ env — bucket-(d) precedence), read AFTER
 *   `session.start()` so the overlay cache is warm. ShellHost still lets
 *   `DSH_OPENTUI_THEME` win over it.
 * - Keybindings ride the session's `keybindingsLoad()` (profile
 *   keybindings.json) — ShellHost reads it at mount; nothing to wire here.
 * - Status-bar context percent: ShellHost's 🧠 segment reads the `prompt`
 *   value its onTurnEnd callback receives. The wave-2 wire finding says
 *   cache-splitting adapters report prompt = UNCACHED input only — the
 *   context size is prompt + cacheRead + cacheWrite. The aggregation is
 *   fed FROM HERE (`aggregateTurnContext`, wrapping exactly the turn-end
 *   hand-off) — NOT as a ShellHost edit, so the plugin bundle stays
 *   byte-identical (dist-host gate).
 * - Boot label: `session.start()` applies the cold-boot model route
 *   asynchronously (row 22), so the render waits (bounded) for the label
 *   to leave the generic "dsh-host" — the powerline shows the real
 *   provider/model from the first paint.
 *
 * Shutdown (clean paths only — the grace-window re-attach semantics of
 * ADR-0005 decision 5 stay intact):
 *   dispose the session (streams + listeners + carrier) → host.release()
 *   (NOT dispose — the host stays resident and idle-exits after
 *   idleExitSec, or is adopted by the next client inside the window).
 *   The lifecycle's idle timer lives in THIS process and is unref()ed, so
 *   on a last-ref release the quitting client spawns the DETACHED idle
 *   reaper (scripts/idle-reaper.mjs): after the grace it idles the host
 *   out (SIGTERM) and clears the lockfile — unless a fresh boot replaced
 *   the host or a client re-attached inside the window (established
 *   connections to the host port — the adoption path's liveness marker).
 *   Intercepted paths: /quit + Ctrl+C (both call process.exit inside
 *   ShellHost), Ctrl+D (renderer exit), SIGINT/SIGTERM/SIGHUP. Exit is
 *   force-completed after a short grace so a stuck dispose cannot hang
 *   the process.
 *
 * The `@opentui/solid/preload` import MUST stay first: it installs bun's
 * solid transform plugin before any .tsx module loads. bunfig.toml
 * (packages/shell) only applies when bun runs from that directory; the
 * launcher runs from arbitrary workspaces (the cwd is the workspace), so
 * the preload rides in the entry itself. Idempotent (Symbol.for guard).
 */
import "@opentui/solid/preload"

import { spawn } from "node:child_process"
import { join } from "node:path"
import { createComponent } from "solid-js"
import { createI18n } from "@dsh-opentui/kit"
import { bootRuntime, type RuntimeOptions, type RuntimeHandle } from "@dsh-opentui/runtime"
import { ShellHost } from "./ShellHost.tsx"
import type { HostSession } from "./host-session.ts"
import { DEFAULT_IDLE_EXIT_SEC, DEFAULT_PROFILE, ensureHost, type HostHandle, type EnsureHostOptions } from "./client/lifecycle.ts"
import { ClientConnection } from "./client/transport.ts"
import { RemoteHostSession } from "./client/remote-host-session.ts"
import type { ShellSessionSurface } from "./client/shell-session.ts"

/** Force-exit grace: dispose + release must never hang the quit path. */
const SHUTDOWN_GRACE_MS = 2_500
/** How long the boot waits for the cold-boot model label before painting. */
const BOOT_LABEL_BUDGET_MS = 4_000

/** Client boot product: what main() keeps alive and tests assert on. */
export interface ClientBoot {
	/** The resident host handle (release() arms the idle-exit timer). */
	host: HostHandle
	/** The connected client-mode session facade. */
	session: RemoteHostSession
	/** The rendering runtime (renderer teardown path). */
	runtime: RuntimeHandle
	/** Clean shutdown: dispose session → release host ref. Idempotent. */
	shutdown(): Promise<void>
}

/** Injectable seams (tests pass fakes; production uses the defaults). */
export interface ClientBootOptions {
	/** Workspace directory; default `process.cwd()` (ADR-0005 decision 1). */
	workspace?: string
	/** dsh home; default the lifecycle default ($DSH_HOME or ~/.dsh). */
	dshHome?: string
	/** Host profile; default `opentui` (ADR-0005 decision 3). */
	profile?: string
	/** Idle-exit seconds; default 60, `0` = resident (decision 5). */
	idleExitSec?: number
	/** Boot-label wait budget (tests shrink it). */
	labelBudgetMs?: number
	/** Lifecycle seam (default: the real ensureHost). */
	ensureHost?: (options?: EnsureHostOptions) => Promise<HostHandle>
	/** Carrier seam (default: the real ClientConnection). */
	connect?: (authority: string, cookieHeader: string) => ClientConnection
	/** Session facade seam (default: the real RemoteHostSession). */
	createSession?: (options: {
		connection: ClientConnection
		cookieHeader: string
		workspace: string
		dshHome: string
		profile: string
	}) => RemoteHostSession
	/** Renderer seam (default: the real bootRuntime). */
	render?: (options: RuntimeOptions) => Promise<RuntimeHandle>
	/** Install the process exit-path interception (default true; tests
	 * pass false and exercise installExitPaths with a fake target). */
	exitPaths?: boolean
	/** Idle reaper seam (tests record instead of spawning). Default: the
	 * detached `bun scripts/idle-reaper.mjs` spawn. */
	spawnReaper?: (args: { pid: number; port: number; lockPath: string; graceSec: number }) => void
}

/** Order the boot ran in (tests assert start-before-render etc.). */
export const bootCallOrder: string[] = []

/** The theme ShellHost boots with: configLoad().theme (post-start, so the
 * workspace overlay cache is warm); ShellHost keeps env precedence. */
export function themeNameFromConfig(session: ShellSessionSurface): string | undefined {
	try {
		const theme = session.configLoad().theme
		return typeof theme === "string" && theme ? theme : undefined
	} catch {
		return undefined
	}
}

/** Wait (bounded) for the cold-boot model route label — best-effort: the
 * generic label paints when the catalog service is absent. */
async function waitForBootLabel(session: RemoteHostSession, budgetMs: number): Promise<void> {
	const deadline = Date.now() + budgetMs
	while (session.label === "dsh-host" && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
}

/**
 * Feed ShellHost the aggregated context shape at turn end (the wave-2 wire
 * finding, row 5): every usage chunk ASSIGNS its fields, and on
 * cache-splitting adapters `prompt` is the UNCACHED input only — the
 * request's context size is `prompt + cacheRead + cacheWrite`. ShellHost's
 * 🧠 segment / context percent read exactly the `prompt` value its
 * onTurnEnd callback receives, so the wrapper rewrites that one hand-off;
 * everything else passes through untouched. Client-side injection point —
 * ShellHost stays byte-identical for plugin mode (its dist-host bundle is
 * gated to zero diff).
 *
 * The Proxy binds every method to the raw target: RemoteHostSession reads
 * private `#fields`, which a Proxy `this` would break.
 */
export function aggregateTurnContext(session: ShellSessionSurface): ShellSessionSurface {
	const turn: ShellSessionSurface["turn"] = (userText, cb, signal) =>
		session.turn(
			userText,
			{
				...cb,
				onTurnEnd: (u) => {
					const usage = session.usage // post-turn: the assigned fields
					cb.onTurnEnd({
						prompt: usage.prompt + usage.cacheRead + usage.cacheWrite,
						completion: u.completion,
					})
				},
			},
			signal,
		)
	return new Proxy(session, {
		get(target, prop, receiver) {
			if (prop === "turn") return turn
			const value = Reflect.get(target, prop, receiver)
			return typeof value === "function" ? value.bind(target) : value
		},
	})
}

/**
 * One client boot: host → connection → session → render. The returned
 * shutdown disposes the session and releases the host ref; installExitPaths
 * routes every exit path through it.
 */
export async function bootClient(options: ClientBootOptions = {}): Promise<ClientBoot> {
	const workspace = options.workspace ?? process.cwd()
	const profile = options.profile ?? DEFAULT_PROFILE
	const idleExitSec = options.idleExitSec ?? DEFAULT_IDLE_EXIT_SEC
	const i18n = createI18n("zh-CN")

	bootCallOrder.push("ensureHost")
	const host = await (options.ensureHost ?? ensureHost)({
		profile,
		idleExitSec,
		...(options.dshHome !== undefined ? { dshHome: options.dshHome } : {}),
	})

	bootCallOrder.push("connect")
	const connection = (options.connect ?? defaultConnect)(host.authority, host.cookieHeader)

	bootCallOrder.push("createSession")
	const createSession = options.createSession ?? defaultCreateSession
	const session = createSession({
		connection,
		cookieHeader: host.cookieHeader,
		workspace,
		dshHome: host.dshHome,
		profile,
	})

	// start() connects + begins $events routing + fires the cold-boot label
	// and the workspace overlay refresh; wait for the label so the first
	// paint shows the real provider/model route.
	bootCallOrder.push("session.start")
	await session.start()
	await waitForBootLabel(session, options.labelBudgetMs ?? BOOT_LABEL_BUDGET_MS)

	// The ShellHost surface: the remote session under the plugin-mode type.
	// The cast is guarded by client/shell-session.ts (tsc fails on drift);
	// aggregateTurnContext feeds the wave-2 aggregated context shape into
	// the turn-end hand-off (see its header — no ShellHost edit).
	const shellSession = aggregateTurnContext(session) as unknown as HostSession
	const themeName = themeNameFromConfig(session)

	bootCallOrder.push("render")
	const runtime = await (options.render ?? bootRuntime)({
		// renderer exit (Ctrl+D / terminal close): the same clean shutdown
		onExit: () => {
			void shutdown()
		},
		root: (store) =>
			createComponent(ShellHost, {
				deps: {
					store,
					t: i18n.t,
					session: shellSession,
					...(themeName !== undefined ? { themeName } : {}),
					i18n,
				},
			}),
	})

	let shutdownPromise: Promise<void> | null = null
	const shutdown = (): Promise<void> => {
		shutdownPromise ??= (async () => {
			bootCallOrder.push("shutdown")
			try {
				await Promise.race([
					session.dispose(),
					new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
				])
			} catch {
				/* dispose is best-effort on the quit path */
			}
			// Grace-window re-attach semantics (decision 5): release — NOT
			// dispose — the host; it idle-exits after idleExitSec or is
			// adopted by the next client inside the window.
			host.release()
			// The lifecycle's idle timer is unref()ed and dies with THIS
			// process — hand the idle-exit to the detached reaper when the
			// last ref was released (a resident host, idleExitSec 0, gets
			// none; another live ref in this process owns the host instead).
			if (host.refCount === 0 && idleExitSec > 0) {
				spawnIdleReaper(host, idleExitSec, options.spawnReaper ?? defaultSpawnReaper)
			}
		})()
		return shutdownPromise
	}

	if (options.exitPaths !== false) installExitPaths(shutdown)

	return { host, session, runtime, shutdown }
}

/** Route every client exit path (/quit, Ctrl+C, Ctrl+D, SIGTERM…) through
 * the clean shutdown, force-completing after the grace. `target` is the
 * process-like surface (injectable for tests). */
export function installExitPaths(
	shutdown: () => Promise<void>,
	target: Pick<NodeJS.Process, "exit" | "on"> = process,
	graceMs = SHUTDOWN_GRACE_MS,
): void {
	const realExit = target.exit.bind(target) as (code?: number) => void
	const exitAfterShutdown = (code: number | undefined): void => {
		void Promise.race([
			shutdown(),
			new Promise((resolve) => setTimeout(resolve, graceMs)),
		]).then(() => realExit(code))
	}
	// /quit and Ctrl+C call process.exit inside ShellHost — intercept.
	target.exit = ((code?: number) => exitAfterShutdown(code)) as typeof target.exit
	// Signals: outside the raw-mode TUI (boot phase, terminal hangup).
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		target.on(signal, () => exitAfterShutdown(0))
	}
}

function defaultConnect(authority: string, cookieHeader: string): ClientConnection {
	return new ClientConnection({ authority, cookieHeader })
}

/** The lockfile lifecycle.ts maintains for the resident host (same
 * `<dshHome>/opentui-host.<profile>.json` contract — the reaper re-reads
 * it to detect a host replacement). */
function hostLockPath(dshHome: string, profile: string): string {
	return join(dshHome, `opentui-host.${profile}.json`)
}

/** Detached idle-exit hand-off (decision 5): see scripts/idle-reaper.mjs.
 * The reaper survives this process; a stuck SIGTERM escalates to SIGKILL
 * inside the reaper, and the lockfile is cleared only while it still
 * describes this host. */
function defaultSpawnReaper(args: { pid: number; port: number; lockPath: string; graceSec: number }): void {
	const script = join(import.meta.dir, "..", "scripts", "idle-reaper.mjs")
	const child = spawn(process.execPath, [script, String(args.pid), String(args.port), args.lockPath, String(args.graceSec)], {
		detached: true,
		stdio: "ignore",
	})
	child.unref?.()
}

function spawnIdleReaper(
	host: HostHandle,
	idleExitSec: number,
	spawnReaper: (args: { pid: number; port: number; lockPath: string; graceSec: number }) => void,
): void {
	try {
		spawnReaper({
			pid: host.pid,
			port: host.port,
			lockPath: hostLockPath(host.dshHome, host.profile),
			graceSec: idleExitSec,
		})
	} catch (error) {
		// reaper spawn is best-effort: the fallback state is the documented
		// v1 limit (a resident host the next client adopts via the lockfile)
		console.error("[client-entry] idle reaper spawn failed:", error)
	}
}

function defaultCreateSession(options: {
	connection: ClientConnection
	cookieHeader: string
	workspace: string
	dshHome: string
	profile: string
}): RemoteHostSession {
	return new RemoteHostSession({
		connection: options.connection,
		cookieHeader: options.cookieHeader,
		cwd: options.workspace, // session/create cwd = the launch workspace
		workspaceDir: options.workspace, // ./.dsh/config.yml overlay scope
		dshHome: options.dshHome, // client-local clusters + /reload restart
		profile: options.profile,
	})
}

/** CLI main: boot and keep the process alive under the renderer loop. */
async function main(): Promise<void> {
	try {
		await bootClient()
	} catch (error) {
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
		process.stderr.write(`dsh-opentui client boot failed: ${message}\n`)
		process.exit(1)
	}
}

if (import.meta.main) {
	void main()
}
