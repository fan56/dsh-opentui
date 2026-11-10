/**
 * Skill rows for the `/` slash palette — data source, dispatch marker and
 * render style, all outside `slash-palette.tsx` so the palette only gains one
 * lookup + one style read.
 *
 * WHY A LOCAL FILE SCAN. dsh exposes user-invocable skills through the
 * session-scoped `skills/list` RPC (cursor's `ctx.skills` registry), but that
 * RPC needs a live session id and the client only creates a session on the
 * first prompt. The `/` menu must work at first paint, so this module scans
 * the same roots `@deepseek-ai/dsh-skill-filesystem` scans (read-only):
 *
 *   rank 100  <projectRoot>/.dsh/skills
 *   rank 200  <projectRoot>/.agents/skills
 *   rank 300  custom dirs (when the caller supplies them)
 *   rank 400  <dshHome>/skills          (the user root; `.system` skipped)
 *   rank 500  <agentsHome>/skills        (config > DSH_AGENTS_HOME > ~/.agents)
 *
 * A skill is a directory bundle `<name>/SKILL.md` or a flat `<name>.md` at the
 * top level of a root (nested bundles are deliberately not discovered), with
 * YAML frontmatter: required `name` (kebab-case) + `description`; a
 * `user-invocable: false` skill is hidden from this human-facing surface.
 * First root wins on a duplicate name (the provider's rank order).
 *
 * EXECUTION IS THE COMMAND CHANNEL, WITH A DELIBERATE FALL-THROUGH. Skill
 * rows carry `kind: "skill"`; the slash host resolves them exactly like a
 * command (exact name / palette highlight / longest-prefix `dispatchLine`) and
 * then returns false instead of running `run`, so the composer sends the
 * typed line to the model untouched. That is the host's own gesture:
 * dsh-tool-skill scans user text for a whitespace-bounded `/name` token and
 * injects the rendered `<skill_content>` in `agent/pre-step`. Do not turn
 * these into ordinary commands with a `run` body — the model must receive the
 * line. (dsh-tui-pi parity for skills: a skill gesture falls through to the
 * model; an UNKNOWN `/xxx` is NOT a model send — the host answers it with the
 * harmless unknown-command row and consumes the enter.)
 *
 * STYLE: skill rows render italic (whole row: name + description) so the
 * human-facing menu distinguishes them from commands. OpenTUI has no per-row
 * theme hook in the palette, but `<text attributes>` accepts TextAttributes
 * (BOLD | ITALIC), and nested `<span style={{ italic }}>` keeps the
 * description italic too. No ANSI strings are hand-written; the renderer owns
 * the SGR.
 *
 * Residual gaps (reported, not worked around): skills supplied by plugins
 * (bundled/remote providers) are not in a local root, so they do not appear
 * here; customSkillDirs from the host's cordis config are only included when
 * the caller passes them. The catalog is a boot snapshot — the host watcher
 * refreshes the model catalog live, while this menu picks changes up on the
 * next client start.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { TextAttributes } from "@opentui/core"
import type { SlashCommand } from "./commands"

/** One human-invocable skill discovered from disk. */
export interface SkillRow {
	name: string
	description: string
	/** The `SKILL.md` / `<name>.md` file the row came from (diagnostics). */
	path: string
}

/** Roots to scan; `cwd` selects the project roots. */
export interface SkillScanOptions {
	cwd: string
	dshHome?: string
	agentsHome?: string
	customSkillDirs?: readonly string[]
}

interface SkillRoot {
	path: string
	rank: number
	/** The user root skips its `.system` child (provider parity). */
	skipSystem: boolean
}

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** One-line description budget (the remote RPC slices at 90 too). */
const DESCRIPTION_MAX = 90

/** Nearest ancestor containing `.git`, else `cwd` (provider parity).
 * `pathExists`, not `isDirectory`: a git WORKTREE (and a submodule) has a
 * `.git` FILE, and the host's `findProjectRoot` counts either kind. */
export function findProjectRoot(cwd: string): string {
	let dir = resolve(cwd)
	for (let depth = 0; depth < 64; depth++) {
		if (existsSync(join(dir, ".git"))) return dir
		const parent = dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	return resolve(cwd)
}

/**
 * The agents home, in the host's precedence (`dsh-skill-filesystem`):
 * explicit config > non-empty `DSH_AGENTS_HOME` > `~/.agents`. An empty or
 * whitespace-only value counts as unset (the host's `??` chain keeps the
 * next leg), and the result is resolved like the provider's `resolve()`.
 */
export function resolveAgentsHome(explicit?: string | null): string {
	if (typeof explicit === "string" && explicit.trim() !== "") return resolve(explicit)
	const env = process.env.DSH_AGENTS_HOME
	if (typeof env === "string" && env.trim() !== "") return resolve(env)
	return resolve(join(homedir(), ".agents"))
}

/** The ranked roots, de-duplicated by resolved path (lowest rank wins). */
export function skillRoots(options: SkillScanOptions): SkillRoot[] {
	const roots: SkillRoot[] = []
	const projectRoot = findProjectRoot(options.cwd)
	roots.push({ path: join(projectRoot, ".dsh", "skills"), rank: 100, skipSystem: false })
	roots.push({ path: join(projectRoot, ".agents", "skills"), rank: 200, skipSystem: false })
	for (const dir of options.customSkillDirs ?? []) {
		if (typeof dir === "string" && dir.trim() !== "") {
			roots.push({ path: resolve(dir), rank: 300, skipSystem: false })
		}
	}
	if (options.dshHome !== undefined) {
		roots.push({ path: join(options.dshHome, "skills"), rank: 400, skipSystem: true })
	}
	const agentsHome = resolveAgentsHome(options.agentsHome)
	roots.push({ path: join(agentsHome, "skills"), rank: 500, skipSystem: false })

	const seen = new Set<string>()
	const deduped: SkillRoot[] = []
	for (const root of roots.sort((a, b) => a.rank - b.rank)) {
		const key = resolve(root.path)
		if (seen.has(key)) continue
		seen.add(key)
		deduped.push(root)
	}
	return deduped
}

// ------------------------------------------------------------ frontmatter --

/** Scalar YAML-ish frontmatter map. `undefined` = malformed block. */
export function parseFrontmatter(text: string): Record<string, string> | undefined {
	const body = text.replace(/^\uFEFF/, "")
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)
	if (!match) return undefined
	const lines = match[1]!.split(/\r?\n/)
	const out: Record<string, string> = {}
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!
		if (line.trim() === "" || line.trimStart().startsWith("#")) continue
		const field = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line)
		if (!field) continue // nested maps/sequences are not needed here
		const key = field[1]!
		let value = field[2]!.trim()
		if (value === "|" || value === ">") {
			// Block scalar: consume the indented continuation lines.
			const folded = value === ">"
			const parts: string[] = []
			while (i + 1 < lines.length && /^\s+/.test(lines[i + 1]!)) {
				parts.push(lines[++i]!.trim())
			}
			value = folded ? parts.join(" ") : parts.join("\n")
		} else if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
			value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, " ")
		} else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
			value = value.slice(1, -1).replace(/''/g, "'")
		}
		out[key] = value
	}
	return out
}

/** Strict boolean grammar (provider parity); undefined = invalid spelling. */
export function frontmatterBoolean(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined
	const needle = value.trim().toLowerCase()
	if (["true", "yes", "on", "1"].includes(needle)) return true
	if (["false", "no", "off", "0"].includes(needle)) return false
	return undefined
}

function oneLine(value: string): string {
	const normalized = value.replace(/\s+/g, " ").trim()
	if (normalized.length <= DESCRIPTION_MAX) return normalized
	return `${normalized.slice(0, DESCRIPTION_MAX - 3)}...`
}

/** Parse one candidate file into a row, or undefined when not invocable. */
function readSkillFile(path: string): SkillRow | undefined {
	let raw: string
	try {
		raw = readFileSync(path, "utf8")
	} catch {
		return undefined
	}
	const front = parseFrontmatter(raw)
	if (front === undefined) return undefined
	const name = (front.name ?? "").trim()
	if (!SKILL_NAME.test(name)) return undefined
	const description = (front.description ?? "").trim()
	if (description === "") return undefined
	// Invalid invocation spellings drop the skill (provider behavior); only
	// `user-invocable` decides this surface.
	const userInvocable = frontmatterBoolean(front["user-invocable"])
	if (userInvocable === undefined && front["user-invocable"] !== undefined) return undefined
	if (userInvocable === false) return undefined
	return { name, description: oneLine(description), path }
}

/** Discover user-invocable skills from the ranked roots (first name wins). */
export function discoverSkills(options: SkillScanOptions): SkillRow[] {
	const rows: SkillRow[] = []
	const seen = new Set<string>()
	for (const root of skillRoots(options)) {
		let entries: { name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }[]
		try {
			entries = readdirSync(root.path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
		} catch {
			continue // absent root = valid empty state
		}
		for (const entry of entries) {
			if (root.skipSystem && entry.name === ".system") continue
			// Symlinked bundles/files resolve to their target kind; a broken
			// link is skipped (the provider's symlink support, best-effort).
			let isDirectory = entry.isDirectory()
			let isFile = entry.isFile()
			if (entry.isSymbolicLink()) {
				try {
					const target = statSync(join(root.path, entry.name))
					isDirectory = target.isDirectory()
					isFile = target.isFile()
				} catch {
					continue
				}
			}
			let file: string | undefined
			if (isDirectory) file = join(root.path, entry.name, "SKILL.md")
			else if (isFile && entry.name.endsWith(".md")) file = join(root.path, entry.name)
			if (file === undefined) continue
			const row = readSkillFile(file)
			if (row === undefined || seen.has(row.name)) continue
			seen.add(row.name)
			rows.push(row)
		}
	}
	return rows
}

// ------------------------------------------------------- slash palette rows --

/**
 * Wrap skill rows as slash-menu entries under their native `/name` (the
 * host's own gesture form). `run` is intentionally a no-op: the slash host
 * recognizes `kind: "skill"` and returns false so the line falls through to
 * the model — see the module header. No trailing space lives in the name.
 * Discovery already rejects a skill without a description, so the row's
 * text is the skill's own (there is no fallback branch to keep alive).
 */
export function skillCommands(skills: readonly SkillRow[]): SlashCommand[] {
	return skills.map((skill) => ({
		name: `/${skill.name}`,
		description: skill.description,
		kind: "skill" as const,
		run() {
			/* never executed: the slash host falls skill rows through */
		},
	}))
}

/**
 * Command registry + skill rows, preserving command order and appending
 * skills by discovery name order. A skill that collides with a command name
 * is dropped (the command is the executable surface; duplicate `/help` rows
 * would be ambiguous). Neither input is mutated.
 */
export function withSkillCommands(
	commands: readonly SlashCommand[],
	skills: readonly SkillRow[],
): SlashCommand[] {
	const names = new Set(commands.map((command) => command.name.toLowerCase()))
	const additions = skillCommands(skills).filter((command) => !names.has(command.name.toLowerCase()))
	return [...commands, ...additions]
}

/** True when the row is a skill gesture rather than an executable command. */
export function isSkillCommand(command: SlashCommand): boolean {
	return command.kind === "skill"
}

/**
 * The palette row's text attributes: skill rows italic (plus bold while
 * selected); command rows keep the pre-existing selected-bold look and no
 * attribute when unselected. One place so the palette's JSX stays a read.
 */
export function paletteRowAttributes(command: SlashCommand, active: boolean): number {
	const skill = isSkillCommand(command)
	if (active) return skill ? TextAttributes.BOLD | TextAttributes.ITALIC : TextAttributes.BOLD
	return skill ? TextAttributes.ITALIC : 0
}
