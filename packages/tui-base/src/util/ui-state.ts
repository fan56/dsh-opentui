/**
 * Client-local UI state (the gear-class /settings rows).
 *
 * Why this exists: in the bridge (default) mode the SessionSeam has NO
 * `configSave` — the remote seam does. So a profile config write is a silent
 * no-op there, and `configLoad` degrades to `{}`: a /settings gear (e.g. the
 * think display lines) is lost on restart. Pure-UI gears belong to the CLIENT,
 * so they are persisted in the client's own state directory — the SAME
 * `paths.state` the model preferences use (`<state>/model.json`) — never in
 * `$DSH_HOME/tui-widgets/` (that manifest is host/plugin-owned: it points at
 * `dsh-workflow/lib/tui-overlay.js`).
 *
 * Storage format: the config-shaped patch itself, so boot replay can hand the
 * decoded document straight to `applyActivityPanelConfig`. A missing,
 * unreadable or malformed file is silently ignored (fail-open, like the
 * config replay in widgets-dock) — never stderr noise before the first paint.
 */
import path from "node:path"
import { readFileSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { Global } from "@opencode/util/global"
import { activityPanelHeightFromConfig, type ActivityPanelGear } from "../routes/session/widgets-dock"

export const UI_STATE_FILE = "ui-state.json"

/** The state file lives beside `model.json` in the client's state directory. */
export function defaultUiStatePath(): string {
	return path.join(Global.Path.state, UI_STATE_FILE)
}

/** Config-shaped slice: `{ session: { activity_panel_height } }`. */
export interface UiState {
	session?: { activity_panel_height?: string }
}

export const EMPTY_UI_STATE: UiState = {}

/** Decode + validate. Anything off-contract collapses to `{}` (the default). */
export function decodeUiState(value: unknown): UiState {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
	const root = value as Record<string, unknown>
	const session = root.session
	if (typeof session !== "object" || session === null || Array.isArray(session)) return {}
	const stored = (session as Record<string, unknown>).activity_panel_height
	if (activityPanelHeightFromConfig(stored) === undefined) return {}
	return { session: { activity_panel_height: stored as string } }
}

/** The valid local gear, if any. */
export function localActivityPanelGear(state: UiState): ActivityPanelGear | undefined {
	return activityPanelHeightFromConfig(state.session?.activity_panel_height)
}

/**
 * Local-first resolution: an on-disk gear always beats the config fallback.
 * This is the single decision boot replay applies — kept pure so it is
 * directly testable without touching the filesystem or the module signal.
 */
export function resolveBootGear(
	config: Record<string, unknown> | undefined,
	local: UiState,
): ActivityPanelGear | undefined {
	const localGear = localActivityPanelGear(local)
	if (localGear !== undefined) return localGear
	const session = config?.session
	const stored = typeof session === "object" && session !== null ? (session as Record<string, unknown>).activity_panel_height : undefined
	return activityPanelHeightFromConfig(stored)
}

/** Synchronous read for boot replay (runs before the first paint). Never throws. */
export function readUiStateSync(filePath: string): UiState {
	try {
		return decodeUiState(JSON.parse(readFileSync(filePath, "utf8")))
	} catch {
		return EMPTY_UI_STATE
	}
}

/** Async read for the settings write path. Never throws. */
export async function readUiState(filePath: string): Promise<UiState> {
	try {
		return decodeUiState(JSON.parse(await readFile(filePath, "utf8")))
	} catch {
		return EMPTY_UI_STATE
	}
}

/** Atomic write with a fresh temp file per call; the directory is created on demand. */
export async function writeUiState(filePath: string, state: UiState): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true })
	const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
	await writeFile(temporary, JSON.stringify(decodeUiState(state))).catch(async (error) => {
		await rm(temporary, { force: true }).catch(() => undefined)
		throw error
	})
	await rename(temporary, filePath).catch(async (error) => {
		await rm(temporary, { force: true }).catch(() => undefined)
		throw error
	})
}
