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

/** The lockfile path for the resident host
 * (`<dshHome>/opentui-host.<profile>.json`). */
export function hostLockPath(dshHome: string, profile: string): string {
	return join(dshHome, `opentui-host.${profile}.json`)
}

/** Client error-log path (`<dshHome>/opentui-client.errors.log`). */
export function clientErrorLogPath(dshHome: string): string {
	return join(dshHome, "opentui-client.errors.log")
}

/** Install the client's last-resort async-error sink (opentui-host.idle.log
 * convention: appendFileSync, best-effort, never throws). WITHOUT this, a
 * rejection escaping a UI async path (`void command.run(...)` fire-and-forget
 * dispatch, detached view effects) dies with Bun's default handler — stderr
 * may be a redirected file the user never reads, or on detached runs nothing
 * at all, and the crash is unrepeatable with no trace. With it, every
 * unhandled rejection / uncaught exception lands in
 * `$DSH_HOME/opentui-client.errors.log` before anything else happens.
 *
 * - unhandledRejection: log and STAY ALIVE — an async path failing must not
 *   kill the TUI silently (the process keeps rendering; the log line is the
 *   evidence).
 * - uncaughtException: log, then exit(1) — a synchronous throw leaves the
 *   renderer in undefined state, but the stack is now on disk first.
 *
 * `target` is the process-like surface (injectable for tests); handlers are
 * idempotent per sink (re-install replaces, the flag keeps one log line per
 * event). */
export function installClientErrorLog(
	dshHome: string,
	target: Pick<NodeJS.Process, "on" | "exit"> = process,
): void {
	const logPath = clientErrorLogPath(dshHome)
	const record = (kind: string, error: unknown): void => {
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
		const line = `${new Date().toISOString()} kind=${kind} pid=${process.pid}\n${message}\n\n`
		try {
			appendFileSync(logPath, line)
		} catch {
			/* the sink must never throw from the error path */
		}
		try {
			process.stderr.write(`[dsh-opentui] ${kind}: ${message.split("\n")[0]}\n`)
		} catch {
			/* stderr may be detached */
		}
	}
	target.on("unhandledRejection", (reason) => {
		record("unhandledRejection", reason)
	})
	target.on("uncaughtException", (error) => {
		record("uncaughtException", error)
		// A synchronous throw leaves the renderer loop in an undefined state —
		// exit loudly (the stack is on disk now), never silently.
		target.exit(1)
	})
}

import { join } from "node:path"
import { appendFileSync } from "node:fs"
import { ENV_THEME } from "./workspace-config.ts"

/** The theme ShellHost boots with: configLoad().theme (post-start, so the
 * workspace overlay cache is warm); ShellHost keeps env precedence. */
export function themeNameFromConfig(session: { configLoad(): Record<string, unknown> }): string | undefined {
	try {
		const theme = session.configLoad().theme
		return typeof theme === "string" && theme ? theme : undefined
	} catch {
		return undefined
	}
}

/** The pinned theme mode (α skin layer): configLoad().themeMode. Auto
 * (undefined) follows the terminal; only dark/light pin. */
export function themeModeFromConfig(session: { configLoad(): Record<string, unknown> }): "dark" | "light" | undefined {
	try {
		const mode = session.configLoad().themeMode
		return mode === "dark" || mode === "light" ? mode : undefined
	} catch {
		return undefined
	}
}

/** Env override for the skin motion tier (α skin layer): env beats the
 * persisted profile `motion` key, both beat the auto tier (tmux/SSH/
 * capability probe — skin/motion.ts resolveMotionPreference). */
export const ENV_MOTION = "DSH_OPENTUI_MOTION"

/** The persisted motion tier (/motion writes the profile `motion` key):
 * "full" | "reduced" | "off" | "auto" (auto = undefined here — follow the
 * auto tier); anything else falls through to the auto tier. */
export function motionFromConfig(session: { configLoad(): Record<string, unknown> }): string | undefined {
	try {
		const motion = session.configLoad().motion
		return typeof motion === "string" && motion ? motion : undefined
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
 * workspace-config.ts chain — the write-back targets the layer that WINS
 * the read, so workspace is checked FIRST): a STORED legacy `theme` key
 * (workspace or profile layer) with no `skinMigration` marker in the
 * profile switches to the dsh-blue default once. Env-pinned themes, fresh
 * users (no theme key) and already-migrated profiles → no migration. */
export function skinMigrationPlan(input: SkinMigrationInput): SkinMigrationPlan | undefined {
	if (storedTheme(input.envTheme) !== undefined) return undefined
	if (input.profileConfig.skinMigration !== undefined) return undefined
	const workspaceTheme = storedTheme(input.workspaceConfig.theme)
	if (workspaceTheme !== undefined && workspaceTheme !== SKIN_MIGRATION_THEME) {
		return { layer: "workspace", theme: SKIN_MIGRATION_THEME, skinMigration: 1, notice: SKIN_MIGRATION_NOTICE }
	}
	const profileTheme = storedTheme(input.profileConfig.theme)
	if (profileTheme !== undefined && profileTheme !== SKIN_MIGRATION_THEME) {
		return { layer: "profile", theme: SKIN_MIGRATION_THEME, skinMigration: 1, notice: SKIN_MIGRATION_NOTICE }
	}
	return undefined
}
