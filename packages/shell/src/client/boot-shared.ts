/**
 * Boot helpers shared by the client entry and the --v2 dev entry (batch 9a).
 * Extracted verbatim from client-entry.tsx so the v2 entry can reuse the
 * shutdown/exit-path machinery WITHOUT importing that file — client-entry's
 * first import registers @opentui/solid's bun transform plugin (the solid
 * client-build rewrite), which must NOT be active in the v2 view graph (the
 * rebuilt tui-base view runs on tui-base's own solid resolution; the
 * rewrite flips it onto the client build, whose owner/context glue breaks
 * @opentui's renderer context — see v2-entry.ts).
 */

/** Force-exit grace: dispose + release must never hang the quit path. */
export const SHUTDOWN_GRACE_MS = 2_500
/** How long the boot waits for the cold-boot model label before painting. */
export const BOOT_LABEL_BUDGET_MS = 4_000

/** Order the boot ran in (tests assert start-before-render etc.). */
export const bootCallOrder: string[] = []

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

/** The lockfile lifecycle.ts maintains for the resident host (same
 * `<dshHome>/opentui-host.<profile>.json` contract — the reaper re-reads
 * it to detect a host replacement). */
export function hostLockPath(dshHome: string, profile: string): string {
	return join(dshHome, `opentui-host.${profile}.json`)
}

/** Detached idle-exit hand-off (decision 5): see scripts/idle-reaper.mjs.
 * The reaper survives this process; a stuck SIGTERM escalates to SIGKILL
 * inside the reaper, and the lockfile is cleared only while it still
 * describes this host. */
export function defaultSpawnReaper(args: { pid: number; port: number; lockPath: string; graceSec: number }): void {
	const script = join(import.meta.dir, "..", "scripts", "idle-reaper.mjs")
	const child = spawn(process.execPath, [script, String(args.pid), String(args.port), args.lockPath, String(args.graceSec)], {
		detached: true,
		stdio: "ignore",
	})
	child.unref?.()
}

/** Reaper hand-off wrapper (client-entry parity; injectable seam kept for
 * the old entry's tests). */
export function spawnIdleReaper(
	host: { pid: number; port: number; dshHome: string; profile: string; refCount: number },
	idleExitSec: number,
	spawnReaper: (args: { pid: number; port: number; lockPath: string; graceSec: number }) => void = defaultSpawnReaper,
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

import { join } from "node:path"
import { spawn } from "node:child_process"
import type { ShellSessionSurface } from "./shell-session.ts"

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

/** The pinned theme mode (α skin layer): configLoad().themeMode. Auto
 * (undefined) follows the terminal; only dark/light pin. */
export function themeModeFromConfig(session: ShellSessionSurface): "dark" | "light" | undefined {
	try {
		const mode = session.configLoad().themeMode
		return mode === "dark" || mode === "light" ? mode : undefined
	} catch {
		return undefined
	}
}

// --- one-shot skin migration (α skin layer) ---------------------------------
// A profile that predates the dsh-blue default keeps an explicit `theme`
// key; the first boot after the skin cutover switches it to the new default
// once, writes a marker so it never re-fires, and notifies the user.

export const SKIN_MIGRATION_THEME = "dsh-blue"
export const SKIN_MIGRATION_NOTICE =
	"Theme switched to dsh-blue (new default). Use /theme to switch back."

export interface SkinMigrationPlan {
	/** The theme to apply and persist over the legacy key. */
	theme: string
	/** The marker value persisted as `skinMigration` in the profile config. */
	skinMigration: number
	/** The one-shot notice text (the v2 notices channel). */
	notice: string
}

/** Pure migration decision: a profile config with a legacy `theme` key and
 * no `skinMigration` marker switches to the dsh-blue default once. No theme
 * key (fresh users) or an existing marker → no migration. */
export function skinMigrationPlan(config: Record<string, unknown>): SkinMigrationPlan | undefined {
	const theme = config.theme
	if (typeof theme !== "string" || theme.length === 0) return undefined
	if (config.skinMigration !== undefined) return undefined
	if (theme === SKIN_MIGRATION_THEME) return undefined
	return { theme: SKIN_MIGRATION_THEME, skinMigration: 1, notice: SKIN_MIGRATION_NOTICE }
}
