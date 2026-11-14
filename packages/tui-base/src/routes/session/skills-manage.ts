/**
 * Skills management semantics — gap C3 (tui-pi skills-manager.ts parity),
 * the pure/filesystem half of the /skills panel.
 *
 * WHY LOCAL FILESYSTEM, NOT AN RPC FACE. The host (dsh 0.2.2-rc.2) exposes
 * exactly one skills RPC — the session-scoped read-only `skills/list`
 * catalog. `dsh-skill` is a registry/merger and `dsh-skill-filesystem` a
 * read-only list+watch provider; there is NO install/uninstall/enable face
 * (unlike plugins, which owns the pluginManager service the web profile's
 * management page drives). The web profile has no skills management page
 * either — `dsh-client-ui-skill` only renders SkillReference/SkillRow
 * inline. So the reference's approach is the only one: manage the
 * directories the host's skill provider scans, directly on disk.
 *
 * THE MODEL (tui-pi parity, adapted to dsh's ranked roots — see
 * skills-source.ts): the SOURCE of available skills is the agents home root
 * (`<agentsHome>/skills`, rank 500); installing a skill promotes it into the
 * user root (`<dshHome>/skills`, rank 400) as a SYMLINK. Because the user
 * root outranks the agents home, the promoted copy is the one the provider
 * serves — install/uninstall is purely a symlink create/delete in
 * `<dshHome>/skills`, and the provider's watcher picks the change up live.
 *
 * SAFETY (the reference's installSkillSymlink / applyOneSkillChange
 * semantics, kept 1:1): install is idempotent for an identical link, refuses
 * to overwrite a physical file/directory (user content) or a link pointing
 * elsewhere, and repairs a dangling link; uninstall removes ONLY a symlink
 * we own — a physical file/directory at the destination is refused, never
 * deleted.
 */

import { existsSync } from "node:fs"
import { lstat, mkdir, readFile, readdir, realpath, symlink, unlink } from "node:fs/promises"
import { join } from "node:path"
import { parseFrontmatter } from "./skills-source"

/** One row of the /skills manager: a public skill and its installed flag. */
export interface SkillManageRow {
	name: string
	description: string
	/** A symlink (or file) for this skill exists in the curated (user) root. */
	installed: boolean
}

// ------------------------------------------------------------ symlink application --

/** Result of applying one pending skill change. */
export interface SkillApplyResult {
	name: string
	/** Failure reason; undefined when the change applied (or already held). */
	error: string | undefined
}

/**
 * Resolve the (src, dest) symlink pair for a skill name: the flat
 * `<name>.md` file first, then the `<name>/` directory bundle. Return
 * undefined when neither source form exists.
 */
export function skillSymlinkPaths(
	publicDir: string,
	curatedDir: string,
	name: string,
): { src: string; dest: string } | undefined {
	const srcMd = join(publicDir, `${name}.md`)
	if (existsSync(srcMd)) return { src: srcMd, dest: join(curatedDir, `${name}.md`) }
	const srcBundle = join(publicDir, name)
	if (existsSync(srcBundle)) return { src: srcBundle, dest: join(curatedDir, name) }
	return undefined
}

/**
 * Create the `dest` symlink pointing at `src`, idempotently:
 *
 * - dest absent → plain symlink creation;
 * - dest is a symlink whose realpath matches the source → no-op success
 *   (re-installing an installed skill must not raise EEXIST);
 * - dest is a symlink to a different source → error, never overwrite;
 * - dest is a physical file or directory (user content) → error, never
 *   overwrite or pierce it;
 * - dest is a dangling symlink → unlink it and recreate (repairable).
 */
export async function installSkillSymlink(src: string, dest: string): Promise<void> {
	const srcReal = await realpath(src).catch((error: unknown) => {
		// Race window: the source vanished between the scan and the apply —
		// surface a readable cause instead of a raw errno message.
		const code = (error as NodeJS.ErrnoException).code
		throw new Error(`skill source vanished: "${src}"${code === undefined ? "" : ` (${code})`}`)
	})
	const destStat = await lstat(dest).catch(() => undefined)
	if (destStat === undefined) {
		await symlink(src, dest)
		return
	}
	if (!destStat.isSymbolicLink()) {
		throw new Error(`refusing to overwrite "${dest}": not a symlink`)
	}
	const destReal = await realpath(dest).catch((error: unknown) => {
		// Only a missing target (ENOENT) or a link loop (ELOOP) counts as a
		// repairable dead link; any other failure (EACCES, EIO, …) is a real
		// error and must not be silently paved over with a recreate.
		const code = (error as NodeJS.ErrnoException).code
		if (code === "ENOENT" || code === "ELOOP") return undefined
		throw error
	})
	if (destReal === undefined) {
		// Dangling symlink: drop the dead link and recreate it.
		await unlink(dest)
		await symlink(src, dest)
		return
	}
	if (destReal === srcReal) return
	throw new Error(
		`already installed from a different source: "${dest}" points to "${destReal}", expected "${srcReal}"`,
	)
}

/**
 * Apply one pending install/uninstall. Return an error message instead of
 * throwing so a batch can continue past broken items.
 */
export async function applyOneSkillChange(
	name: string,
	targetState: boolean,
	publicDir: string,
	curatedDir: string,
): Promise<string | undefined> {
	if (targetState) {
		const paths = skillSymlinkPaths(publicDir, curatedDir, name)
		if (paths === undefined) return `cannot install: skill not found in "${publicDir}"`
		try {
			await installSkillSymlink(paths.src, paths.dest)
			return undefined
		} catch (error: unknown) {
			return `cannot install: ${error instanceof Error ? error.message : String(error)}`
		}
	}
	// Uninstall: mirror the install-side protection — only ever remove a
	// symlink we own. A physical file or directory at dest is user content
	// and must be refused, never silently deleted.
	try {
		const destMd = join(curatedDir, `${name}.md`)
		const destBundle = join(curatedDir, name)
		const mdStat = await lstat(destMd).catch(() => undefined)
		if (mdStat !== undefined) {
			if (!mdStat.isSymbolicLink()) throw new Error(`refusing to remove "${destMd}": not a symlink`)
			await unlink(destMd)
			return undefined
		}
		const bundleStat = await lstat(destBundle).catch(() => undefined)
		if (bundleStat !== undefined) {
			if (!bundleStat.isSymbolicLink()) throw new Error(`refusing to remove "${destBundle}": not a symlink`)
			await unlink(destBundle)
		}
		return undefined
	} catch (error: unknown) {
		return `cannot uninstall: ${error instanceof Error ? error.message : String(error)}`
	}
}

// ------------------------------------------------------------ batch summary --

/** Max items itemized per list (ok / failed) in the one-line summary. */
const SKILL_SUMMARY_MAX_ITEMS = 3

/**
 * Collapse a per-item error into a short reason for the one-line summary.
 * Full paths and raw errno details stay out of the clipped status line.
 */
export function skillApplyShortReason(error: string): string {
	if (error.includes("not a symlink")) return "protected (not a symlink)"
	if (error.includes("different source")) return "installed from a different source"
	if (error.includes("skill not found") || error.includes("source vanished")) return "source missing"
	return "failed"
}

/**
 * Compose the one-line summary for a finished batch. Empty when everything
 * applied (the rescan speaks for itself); otherwise name the successes and
 * itemize failures as `name (short reason)`. Both lists are capped at
 * SKILL_SUMMARY_MAX_ITEMS entries plus a `+N more` tail: a large ok list
 * must never fill the line and clip away the failed segment behind it.
 */
export function skillApplySummary(results: readonly SkillApplyResult[]): string {
	const failures = results.filter((r) => r.error !== undefined)
	if (failures.length === 0) return ""
	const okNames = results.filter((r) => r.error === undefined).map((r) => r.name)
	const failed = failures
		.slice(0, SKILL_SUMMARY_MAX_ITEMS)
		.map((r) => `${r.name} (${skillApplyShortReason(r.error ?? "")})`)
		.join(", ")
	const failedExtra = failures.length - SKILL_SUMMARY_MAX_ITEMS
	const failedMore = failedExtra > 0 ? ` +${failedExtra} more` : ""
	const okShown = okNames.slice(0, SKILL_SUMMARY_MAX_ITEMS).join(", ")
	const okExtra = okNames.length - SKILL_SUMMARY_MAX_ITEMS
	const okMore = okExtra > 0 ? ` +${okExtra} more` : ""
	const okPart = okNames.length > 0 ? `ok: ${okShown}${okMore} · ` : ""
	return `applied ${okNames.length}/${results.length} — ${okPart}failed: ${failed}${failedMore}`
}

// ------------------------------------------------------------ scanning --

/** One-line description budget (the slash palette slices at 90 too). */
const DESCRIPTION_MAX = 90

function oneLine(value: string): string {
	const normalized = value.replace(/\s+/g, " ").trim()
	if (normalized.length <= DESCRIPTION_MAX) return normalized
	return `${normalized.slice(0, DESCRIPTION_MAX - 3)}...`
}

/** Extract the frontmatter `description` of a skill file, or "". */
async function readSkillDescription(path: string): Promise<string> {
	try {
		const text = await readFile(path, "utf8")
		const front = parseFrontmatter(text)
		if (front === undefined) return ""
		return oneLine((front.description ?? "").trim())
	} catch {
		return ""
	}
}

/**
 * Read the available skills from the public root (the agents home's
 * `skills/`) and check which are already promoted into the curated root
 * (`<dshHome>/skills/`). A skill is a flat `<name>.md` file or a `<name>/`
 * directory bundle with a `SKILL.md` inside (the provider's discovery
 * shape). A name missing BOTH destination forms counts as uninstalled.
 * Sorted by name (the reference's ordering).
 */
export async function scanAvailableSkills(publicDir: string, curatedDir: string): Promise<SkillManageRow[]> {
	let entries: string[]
	try {
		entries = await readdir(publicDir, { encoding: "utf8" })
	} catch {
		return [] // absent root = valid empty state
	}
	const skillNames = new Set<string>()
	for (const name of entries) {
		if (name.endsWith(".md")) {
			skillNames.add(name.slice(0, -3))
		} else if (!name.startsWith(".")) {
			// Could be a directory bundle — check if it has a SKILL.md inside.
			if (existsSync(join(publicDir, name, "SKILL.md"))) skillNames.add(name)
		}
	}
	const rows: SkillManageRow[] = []
	for (const name of skillNames) {
		const installed =
			existsSync(join(curatedDir, `${name}.md`)) || existsSync(join(curatedDir, name))
		const description = await readSkillDescription(
			existsSync(join(publicDir, name, "SKILL.md")) ? join(publicDir, name, "SKILL.md") : join(publicDir, `${name}.md`),
		)
		rows.push({ name, description, installed })
	}
	rows.sort((a, b) => a.name.localeCompare(b.name))
	return rows
}

// ------------------------------------------------------------ view helpers --

/**
 * The rows surviving the filter: a case-insensitive substring over
 * `name + description` (the reference's narrowing move).
 */
export function filterSkillRows<T extends { name: string; description: string }>(
	rows: readonly T[],
	query: string,
): T[] {
	const needle = query.trim().toLowerCase()
	if (!needle) return [...rows]
	return rows.filter(
		(row) => row.name.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle),
	)
}

/**
 * STATE column text of one skill row: `installed` when the curated root
 * holds it, `available` otherwise; a pending (not yet applied) target state
 * renders with a trailing `*` marker so the user sees the unapplied diff.
 */
export function skillStateText(row: { installed: boolean }, pendingState?: boolean): string {
	const effective = pendingState ?? row.installed
	const base = effective ? "installed" : "available"
	return pendingState === undefined || pendingState === row.installed ? base : `${base}*`
}

/** Ensure the curated root exists before a batch apply (best-effort). */
export async function ensureCuratedDir(curatedDir: string): Promise<void> {
	try {
		await mkdir(curatedDir, { recursive: true })
	} catch {
		// Directory exists or could not be created — the apply reports it.
	}
}
