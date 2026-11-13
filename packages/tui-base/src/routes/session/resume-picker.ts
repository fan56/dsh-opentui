/**
 * /resume picker helpers (G1 resume-picker batch) — the pure core of the
 * upgraded `/resume` picker, aligned with the reference /resume picker
 * column semantics (dsh-tui-pi 66-retention-resume Phase C/D):
 *
 *   UPDATED — relative last-update time ("just now" / "5m ago" / "3h ago" /
 *             "12d ago"); unparseable values render raw, missing ones "—".
 *   DIR     — the session's workspace directory (header cwd), capped with a
 *             leading ellipsis (the reference RESUME_DIR_CAP=32 vocabulary);
 *             missing cwd renders "—".
 *   SESSION — the row title (first-prompt preview or header label).
 *
 * Display filter: the reference's 1KB byte floor (RESUME_MIN_BYTES). Rows
 * that do not carry a size (remote wire rows, older headers) fail OPEN —
 * the same contract as the reference `filterSessionsByLastActivity`. When
 * the floor hides every row, the caller reports the empty-FILTERED copy
 * ("No sessions within the resume window …") instead of the plain
 * empty-store one — the two empties read differently, exactly like the
 * reference's `empty` vs `empty-filtered` picker outcomes.
 *
 * Retention (log deletion / age windows) is host-side and deliberately out
 * of scope here — this module only shapes display rows.
 */

/** Byte floor aligned with the reference /resume RESUME_MIN_BYTES default. */
export const SESSIONS_MIN_BYTES = 1024

/** DIR column cap (the reference RESUME_DIR_CAP vocabulary). */
export const SESSIONS_DIR_CAP = 32

/** The seam row slice the picker consumes (SeamSessionSummary). */
export interface ResumePickerRow {
	id: string
	title: string
	updatedAt?: string
	cwd?: string
	sizeBytes?: number
}

/**
 * Relative last-update time. Accepts the two wire spellings the adapters
 * normalize to `updatedAt`: a bare ms-epoch string (the remote face) and
 * anything `Date.parse` reads (ISO strings from the local header). Missing
 * renders "—"; an unparseable non-empty value renders RAW (never silently
 * blanked — a corrupt header is debuggable).
 */
export function relativeTime(updatedAt: string | undefined, now: number = Date.now()): string {
	if (updatedAt === undefined || updatedAt === "") return "—"
	const ms = /^\d{10,}$/.test(updatedAt) ? Number(updatedAt) : Date.parse(updatedAt)
	if (!Number.isFinite(ms) || ms <= 0) return updatedAt
	const diff = now - ms
	if (diff < 60_000) return "just now"
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
	return `${Math.floor(diff / 86_400_000)}d ago`
}

/** DIR cell: the workspace directory, ellipsis-capped at the column cap. */
export function resumeDirLabel(cwd: string | undefined): string {
	if (cwd === undefined || cwd === "") return "—"
	if (cwd.length <= SESSIONS_DIR_CAP) return cwd
	return `…${cwd.slice(-(SESSIONS_DIR_CAP - 1))}`
}

/**
 * The 1KB display floor: rows WITHOUT a size pass (fail open — a missing
 * stat must never empty the picker by itself, the reference contract);
 * rows with a size need `sizeBytes >= minBytes`.
 */
export function filterSessionsBySizeFloor<T extends ResumePickerRow>(rows: readonly T[], minBytes: number = SESSIONS_MIN_BYTES): T[] {
	return rows.filter((row) => row.sizeBytes === undefined || row.sizeBytes >= minBytes)
}

/** The empty-filtered copy: names the window, the hidden count and the floor. */
export function emptyFilteredCopy(hidden: number, minBytes: number = SESSIONS_MIN_BYTES): string {
	return `No sessions within the resume window (${hidden} hidden by the ${minBytes}B size floor)`
}

/** One fitted picker column: header label + rendered cell width. */
interface FittedColumn {
	header: string
	width: number
}

/** Fit one column to `max(header, longest cell)` — the reference autoColumns shape. */
function fitColumn(header: string, cells: readonly string[]): FittedColumn {
	let width = header.length
	for (const cell of cells) width = Math.max(width, cell.length)
	return { header, width }
}

/** Left-pad a cell to its column width (internal spaces survive capture). */
function padCell(cell: string, width: number): string {
	return cell.length >= width ? cell : cell + " ".repeat(width - cell.length)
}

export interface ResumePickerOptions {
	/** Aligned column-header line painted above the rows (dialog header line). */
	header: string
	/** pickOne options: the aligned `UPDATED  DIR  SESSION` row as the title. */
	options: { title: string; value: string; description?: string }[]
}

/**
 * Build the picker's aligned rows + header line. The columns are fitted
 * over the VISIBLE rows (the same width scan the reference runs), so the
 * header labels and every cell line up in a monospace capture.
 */
export function resumePickerOptions(
	rows: readonly ResumePickerRow[],
	now: number = Date.now(),
	corruptIds?: ReadonlySet<string>,
): ResumePickerOptions {
	const updatedCells = rows.map((row) => relativeTime(row.updatedAt, now))
	const dirCells = rows.map((row) => resumeDirLabel(row.cwd))
	const updated = fitColumn("UPDATED", updatedCells)
	const dir = fitColumn("DIR", dirCells)
	const header = `${padCell(updated.header, updated.width)}  ${padCell(dir.header, dir.width)}  SESSION`
	const options = rows.map((row, index) => ({
		title: `${padCell(updatedCells[index]!, updated.width)}  ${padCell(dirCells[index]!, dir.width)}  ${resumeRowTitle(row.title, corruptIds?.has(row.id) ?? false)}`,
		value: row.id,
	}))
	return { header, options }
}

/**
 * Row title with the corrupt marker (tui-pi `resumeRowTitle` parity): a
 * session whose log failed the integrity scan renders a leading `⚠`. The
 * marker is a WARNING, not a verdict — the repair itself stays behind the
 * explicit confirm dialog.
 */
export function resumeRowTitle(title: string, corrupt: boolean): string {
	return corrupt ? `⚠ ${title}` : title
}

/** The broken-log rows the seam's client-local scan reports. */
export interface BrokenLogRow {
	path: string
	name: string
	reason: string
	sessionId?: string
}

/**
 * Session ids the /resume picker should flag as corrupt: the scan's
 * `sessionId` values (the `session-<uuid>/` directory owners). Scan rows
 * without a session id cannot be mapped onto a picker row and are dropped.
 */
export function corruptSessionIds(broken: readonly BrokenLogRow[]): Set<string> {
	const ids = new Set<string>()
	for (const row of broken) {
		if (row.sessionId !== undefined && row.sessionId !== "") ids.add(row.sessionId)
	}
	return ids
}

/** The broken-log rows of ONE session (a session may own several logs). */
export function brokenLogsForSession(broken: readonly BrokenLogRow[], sessionId: string): BrokenLogRow[] {
	return broken.filter((row) => row.sessionId === sessionId)
}

/**
 * The repair confirm dialog's two options, in the tui-pi order (index 0 =
 * "Repair & resume" is preselected by pickOne's row-0 selection): the
 * repair rewrites user data on disk, so it NEVER runs implicitly.
 */
export function repairConfirmOptions(): { title: string; value: "repair" | "cancel"; description?: string }[] {
	return [
		{ title: "Repair & resume", value: "repair", description: "back up the log, truncate the broken tail" },
		{ title: "Cancel", value: "cancel", description: "leave the log untouched" },
	]
}

/** One confirm-dialog body line per broken log (reason strings are the /repair card's). */
export function repairConfirmBody(broken: readonly BrokenLogRow[]): string[] {
	return broken.map((row) => `${row.name} — ${row.reason}`)
}
