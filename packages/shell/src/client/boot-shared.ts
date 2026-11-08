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
import { ENV_THEME } from "./workspace-config.ts"

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
// A stored theme choice that predates the dsh-blue default (profile OR
// workspace layer) switches to the new default once; the marker lives in
// the profile so each profile migrates exactly once; dsh-blue is written
// back to the layer the legacy theme lived in.

export { ENV_THEME }

export const SKIN_MIGRATION_THEME = "dsh-blue"
export const SKIN_MIGRATION_NOTICE =
	"Theme switched to dsh-blue (new default). Use /theme to switch back."

export interface SkinMigrationPlan {
	/** The config layer the legacy theme lived in (and dsh-blue is written
	 * back to) — the read precedence is env > workspace > profile, so the
	 * winning layer owns the write-back. */
	layer: "profile" | "workspace"
	/** The theme to apply and persist over the legacy key. */
	theme: string
	/** The marker value persisted as `skinMigration` in the PROFILE config
	 * (one migration per profile, regardless of the theme's layer). */
	skinMigration: number
	/** The one-shot notice text (the v2 notices channel). */
	notice: string
}

export interface SkinMigrationInput {
	/** The profile config.json raw contents (no overlay/env merge). */
	profileConfig: Record<string, unknown>
	/** The workspace config.yml overlay slice (may be empty). */
	workspaceConfig: Record<string, unknown>
	/** The `DSH_OPENTUI_THEME` env value when set (empty string = unset, the
	 * mergeConfig convention): an env-pinned theme skips the migration — the
	 * user's effective theme is not a stored choice. */
	envTheme?: string
}

function storedTheme(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined
}

/** Pure migration decision (read precedence env > workspace > profile, the
 * workspace-config.ts chain): a STORED legacy `theme` key (profile or
 * workspace layer) with no `skinMigration` marker in the profile switches
 * to the dsh-blue default once. Env-pinned themes, fresh users (no theme
 * key) and already-migrated profiles → no migration. */
export function skinMigrationPlan(input: SkinMigrationInput): SkinMigrationPlan | undefined {
	if (storedTheme(input.envTheme) !== undefined) return undefined
	if (input.profileConfig.skinMigration !== undefined) return undefined
	const profileTheme = storedTheme(input.profileConfig.theme)
	if (profileTheme !== undefined && profileTheme !== SKIN_MIGRATION_THEME) {
		return { layer: "profile", theme: SKIN_MIGRATION_THEME, skinMigration: 1, notice: SKIN_MIGRATION_NOTICE }
	}
	const workspaceTheme = storedTheme(input.workspaceConfig.theme)
	if (workspaceTheme !== undefined && workspaceTheme !== SKIN_MIGRATION_THEME) {
		return { layer: "workspace", theme: SKIN_MIGRATION_THEME, skinMigration: 1, notice: SKIN_MIGRATION_NOTICE }
	}
	return undefined
}
