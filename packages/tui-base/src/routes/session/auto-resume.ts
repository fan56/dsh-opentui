/**
 * Auto-resume on startup (feat/auto-resume).
 *
 * dsh sessions are persisted server-side; every UI should show the same
 * transcript. A fresh client boot used to land on an EMPTY screen even though
 * the workspace had a perfectly good session from minutes ago. This module is
 * the pure decision core of the startup restore:
 *
 *   boot (no explicit session, no `--new`)
 *     → read `autoResume` ("last" | "off", default "off" — a plain launch is a
 *       NEW session) + `autoResumeDays` (default 7) off the merged profile
 *       config, or `--resume-last` on the command line (overrides the config)
 *     → list stored sessions (the /resume list: newest first, subagent rows
 *       and the /btw marker rows already filtered by the seam)
 *     → pick the newest session that is
 *         - in THIS workspace (cwd match; an unknown cwd cannot be attributed
 *           and is skipped),
 *         - active within the window (updatedAt unknown/expired is skipped),
 *         - non-empty (the host's `blank` metadata; older hosts fall back to a
 *           title/size heuristic),
 *     → stage it on the seam (`resumeSession(id)` — bound at the next turn) and
 *       hand the page the id + one transcript notice line.
 *
 * The failure contract is "degrade, never block": a timed-out / failed list,
 * or a throwing resume, logs ONE warning and leaves the boot on a fresh
 * session. The list call is bounded so a hung host cannot hold the first paint.
 *
 * Explicit intent always wins: `--new` (highest priority), `--session <id>`,
 * `--resume-last`, `autoResume: "off"`, and (later) `/new` and `/resume` are
 * untouched by this path. With the default `off` nothing is listed, no session
 * id is staged, and no `resumed …` notice is produced.
 */
import { relativeTime } from "./resume-picker"

/** Startup auto-resume policy (`config.json` key `autoResume`). */
export type AutoResumeMode = "last" | "off"

/** Default restore window (days of inactivity after which we start fresh). */
export const DEFAULT_AUTO_RESUME_DAYS = 7

/** The bounded startup budget for the session list RPC (never block paint). */
export const AUTO_RESUME_TIMEOUT_MS = 2_000

/** How many stored rows to ask for: enough to find this workspace's session
 * even when another workspace has been busy recently (the seam caps at the
 * requested limit AFTER the newest-first sort). */
export const AUTO_RESUME_LIST_LIMIT = 50

/** Explicit launch intent parsed off the CLI. */
export interface LaunchArgs {
	/** `--new`: the caller asked for a fresh session (highest priority). */
	newRequested: boolean
	/** `--resume-last`: restore the newest session for one launch (overrides config). */
	resumeLastRequested: boolean
	/** `--session <id>` / `--session=<id>`: the caller pinned a session. */
	sessionId?: string
}

/**
 * Parse the launch flags this feature cares about. Everything else
 * (`--provider`, `--model`, `--plugins`, …) belongs to provisioning and is
 * ignored here.
 */
export function parseLaunchArgs(argv: readonly string[]): LaunchArgs {
	let newRequested = false
	let resumeLastRequested = false
	let sessionId: string | undefined
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		if (arg === undefined) continue
		if (arg === "--new") {
			newRequested = true
			continue
		}
		if (arg === "--resume-last") {
			resumeLastRequested = true
			continue
		}
		if (arg === "--session") {
			const value = argv[index + 1]
			if (value !== undefined && value !== "" && !value.startsWith("--")) {
				sessionId = value
				index++
			}
			continue
		}
		if (arg.startsWith("--session=")) {
			const value = arg.slice("--session=".length)
			if (value !== "") sessionId = value
		}
	}
	return { newRequested, resumeLastRequested, ...(sessionId !== undefined ? { sessionId } : {}) }
}

/** `autoResume` off the merged config; the default is "off" (a new session). */
export function readAutoResumeMode(config: Record<string, unknown> | undefined | null): AutoResumeMode {
	return config?.autoResume === "last" ? "last" : "off"
}

/**
 * The effective mode for one boot: `--new` wins over everything, then an
 * explicit `--session`, then `--resume-last`, then the stored config.
 */
export function resolveAutoResumeMode(
	config: Record<string, unknown> | undefined | null,
	launch: LaunchArgs,
): AutoResumeMode {
	if (launch.newRequested || launch.sessionId !== undefined) return "off"
	if (launch.resumeLastRequested) return "last"
	return readAutoResumeMode(config)
}

/** `autoResumeDays` off the merged config; a non-positive/NaN value keeps 7. */
export function readAutoResumeDays(
	config: Record<string, unknown> | undefined | null,
	fallback: number = DEFAULT_AUTO_RESUME_DAYS,
): number {
	const value = Number(config?.autoResumeDays)
	return Number.isFinite(value) && value > 0 ? value : fallback
}

/** One stored row slice the decision reads (the seam's listSessions shape). */
export interface AutoResumeRow {
	id: string
	title?: string
	updatedAt?: string
	cwd?: string
	sizeBytes?: number
	/** Host list metadata: `true` = created but never prompted. */
	blank?: boolean
}

/** The picked session + the one-line notice the page prints. */
export interface AutoResumeDecision {
	id: string
	title: string
	updatedAt?: string
	/** `resumed <title> · <time ago>` (transcript/notice line). */
	line: string
}

export interface AutoResumeSelectInput {
	/** The launch workspace (process.cwd()); sessions are workspace-scoped. */
	workspace: string
	mode: AutoResumeMode
	windowDays?: number
	now?: number
	/** `--new` was passed: never restore. */
	newRequested?: boolean
	/** `--session <id>` was passed: explicit intent wins. */
	sessionId?: string
}

/** Normalize the two wire spellings of `updatedAt` (ms-epoch string / ISO). */
function toEpochMs(value: string | undefined): number | undefined {
	if (value === undefined || value === "") return undefined
	const ms = /^\d{10,}$/.test(value) ? Number(value) : Date.parse(value)
	return Number.isFinite(ms) && ms > 0 ? ms : undefined
}

/** Non-empty per the host's `blank` metadata; older hosts fall back to heuristics. */
function isNonEmpty(row: AutoResumeRow): boolean {
	if (typeof row.blank === "boolean") return !row.blank
	if ((row.title ?? "").trim() !== "") return true
	return (row.sizeBytes ?? 0) > 0
}

/** Exact workspace match; an unknown cwd is not attributable and is skipped. */
function isSameWorkspace(row: AutoResumeRow, workspace: string): boolean {
	return row.cwd !== undefined && row.cwd !== "" && row.cwd === workspace
}

/** The notice line: `resumed <title> · <time ago>` (single line, no chrome). */
export function autoResumeLine(row: AutoResumeRow, now: number = Date.now()): string {
	const title = (row.title ?? "").replace(/\s+/g, " ").trim() || row.id.slice(0, 8)
	return `resumed ${title} · ${relativeTime(row.updatedAt, now)}`
}

/**
 * Pick the newest resumable session, or `undefined` to stay on a fresh one.
 * Pure: no I/O, deterministic given `now`.
 */
export function selectAutoResumeSession(
	rows: readonly AutoResumeRow[],
	input: AutoResumeSelectInput,
): AutoResumeDecision | undefined {
	if (input.mode !== "last") return undefined
	if (input.newRequested === true) return undefined
	if (input.sessionId !== undefined) return undefined
	const now = input.now ?? Date.now()
	const windowMs = readAutoResumeDays({ autoResumeDays: input.windowDays }) * 86_400_000
	const cutoff = now - windowMs
	let best: { row: AutoResumeRow; at: number } | undefined
	for (const row of rows) {
		if (!isSameWorkspace(row, input.workspace)) continue
		const at = toEpochMs(row.updatedAt)
		if (at === undefined || at < cutoff) continue
		if (!isNonEmpty(row)) continue
		if (best === undefined || at > best.at) best = { row, at }
	}
	if (best === undefined) return undefined
	return {
		id: best.row.id,
		title: (best.row.title ?? "").replace(/\s+/g, " ").trim() || best.row.id.slice(0, 8),
		...(best.row.updatedAt !== undefined ? { updatedAt: best.row.updatedAt } : {}),
		line: autoResumeLine(best.row, now),
	}
}

/** Injectable edges of the async restore (boot passes the seam; tests pass fakes). */
export interface AutoResumeDeps {
	listSessions(limit?: number): Promise<readonly AutoResumeRow[]>
	resumeSession(id: string): unknown
	/** One warning line per degradation; boot wires console.error. */
	warn?(message: string): void
	now?(): number
	timeoutMs?: number
}

export interface AutoResumeRunInput {
	config: Record<string, unknown> | undefined | null
	launch: LaunchArgs
	workspace: string
}

/** Race a promise against a bounded timer (undefined = budget spent). */
async function withBudget<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<undefined>((resolve) => {
				timer = setTimeout(() => resolve(undefined), timeoutMs)
			}),
		])
	} finally {
		if (timer !== undefined) clearTimeout(timer)
	}
}

/**
 * The boot path: decide, stage the session on the seam, return the notice.
 * NEVER throws — every failure logs one warning and returns `undefined`.
 */
export async function runAutoResume(
	input: AutoResumeRunInput,
	deps: AutoResumeDeps,
): Promise<AutoResumeDecision | undefined> {
	const warn = deps.warn ?? (() => {})
	const mode = resolveAutoResumeMode(input.config, input.launch)
	if (mode !== "last") return undefined
	const timeoutMs = deps.timeoutMs ?? AUTO_RESUME_TIMEOUT_MS
	let rows: readonly AutoResumeRow[] | undefined
	try {
		rows = await withBudget(Promise.resolve(deps.listSessions(AUTO_RESUME_LIST_LIMIT)), timeoutMs)
	} catch (error) {
		warn(`[v2] auto-resume skipped: session list failed (${errorText(error)})`)
		return undefined
	}
	if (rows === undefined) {
		warn(`[v2] auto-resume skipped: session list exceeded ${timeoutMs}ms`)
		return undefined
	}
	const decision = selectAutoResumeSession(rows, {
		workspace: input.workspace,
		mode,
		windowDays: readAutoResumeDays(input.config),
		now: deps.now?.() ?? Date.now(),
	})
	if (decision === undefined) return undefined
	try {
		deps.resumeSession(decision.id)
	} catch (error) {
		warn(`[v2] auto-resume skipped: resumeSession failed (${errorText(error)})`)
		return undefined
	}
	return decision
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
