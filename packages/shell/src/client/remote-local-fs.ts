/**
 * Client-local filesystem operations for the client-mode session layer
 * (ADR-0005 bucket (b) wave 3; audit rows 30 + 31).
 *
 * v1 ships FULL capability parity (ADR-0005 user decision): /agents and
 * /repair run on the CLIENT filesystem — legitimate in the single-machine
 * topology where the host process and the TUI share one filesystem (the
 * same $DSH_HOME). These are the exact in-process semantics of
 * host-session.ts:453-507 (agent definition files) and :653-711 (session
 * store integrity scan), moved verbatim into injectable helpers so the
 * RemoteHostSession can call them with an explicit dsh home (tests + live
 * smoke scratch homes) instead of only the process environment.
 *
 * Row 30 — agent definitions live at `<dshHome>/agents/*.md`, one file per
 * agent, YAML-ish frontmatter (`name`, `display_name`, `description`,
 * `model`, `thinking`, `deep`) + a body. Parsing and write-back are tui-pi
 * `agent-manager.ts` parity: CRLF tolerated, one quote layer stripped, a
 * non-negative integer `deep` (absent = 1), `name` must match the file stem
 * (the registry rule — otherwise the file is broken and never dispatched).
 * `listAgentFiles` never throws (broken files are reported in-band);
 * `updateAgentFrontmatter` rewrites existing lines in place, inserts missing
 * keys before the closing fence, deletes on null, preserves comments,
 * unknown fields, order and CRLF, and writes nothing on a no-op.
 *
 * Row 31 — the session store at `<dshHome>/sessions/` holds
 * `session-<uuid>/session.v4.jsonl.zstd` logs (older layouts: plain
 * jsonl, v3). The scan walks to depth 4 and flags: empty logs, buffers
 * without the zstd magic (28 b5 2f fd), and plain-jsonl files whose last
 * line is not JSON. Report line shapes are HostSession parity (the /repair
 * card prints them verbatim).
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

/** One agent definition row. `model`/`thinking` are the frontmatter
 * baseline; the composed values (baseline (+) pinned profile) are added by
 * remote-agent-profiles.ts. Broken files are reported in-band, not thrown. */
export interface RemoteAgentRow {
	name: string
	displayName?: string
	description?: string
	color?: string
	model?: string
	thinking?: string
	deep: number
	/** Per-agent round cap (registry `maxRounds`: a positive integer; absent
	 * = inherit the global ladder). 0 is NOT unlimited — the registry rejects
	 * it and marks the file broken. */
	maxRounds?: number
	/** Registry `background`: strict true/false (absent = false). */
	background?: boolean
	body: string
	file: string
	broken?: string
}

/** The effective dsh home (HostSession parity): $DSH_HOME or ~/.dsh. */
export function resolveDshHome(explicit?: string): string {
	return explicit ?? (process.env.DSH_HOME || join(homedir(), ".dsh"))
}

const FRONTMATTER_FENCE = "---"
/** Frontmatter key pattern (same loose shape tui-pi / zcode accept). */
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/

/** Strip one pair of matching surrounding quotes, if present. */
function stripQuotes(value: string): string {
	if (value.length >= 2) {
		const first = value[0]
		const last = value[value.length - 1]
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1)
	}
	return value
}

/** Find the closing fence line index of a frontmatter starting at line 0. */
function frontmatterBounds(lines: string[]): { close: number } | undefined {
	if (lines[0]?.trim() !== FRONTMATTER_FENCE) return undefined
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]!.trim() === FRONTMATTER_FENCE) return { close: i }
	}
	return undefined
}

/** Parse a loose `key: value` frontmatter block (lines 1..close-1). */
function parseFrontmatterValues(lines: string[], close: number): Record<string, string> {
	const values: Record<string, string> = {}
	for (let i = 1; i < close; i++) {
		const match = KEY_LINE.exec(lines[i]!)
		if (match === null) continue
		values[match[1]!] = stripQuotes(match[2]!.trim())
	}
	return values
}

export type AgentParseResult = { ok: true; agent: RemoteAgentRow } | { ok: false; error: string }

/**
 * Parse one agent markdown file - tui-pi `parseAgentMarkdown` parity:
 * tolerates CRLF, one layer of paired quotes and non-key lines inside the
 * frontmatter; `name` is required; `deep` is a non-negative integer
 * (absent = 1). A `name` that does not match the file name is broken (the
 * registry rule - the file would never be dispatched under that id).
 */
export function parseAgentMarkdown(text: string, path: string): AgentParseResult {
	const lines = text.split(/\r?\n/)
	const bounds = frontmatterBounds(lines)
	if (bounds === undefined) {
		return { ok: false, error: "missing frontmatter (file must start with `---`)" }
	}
	const values = parseFrontmatterValues(lines, bounds.close)
	const name = values["name"]?.trim()
	if (name === undefined || name === "") return { ok: false, error: "missing required frontmatter key `name`" }
	const fileBase = basename(path).replace(/\.md$/, "")
	if (name !== fileBase) {
		return { ok: false, error: `frontmatter name "${name}" does not match file name "${fileBase}"` }
	}
	let deep = 1
	if (values["deep"] !== undefined) {
		const raw = values["deep"]!.trim()
		if (!/^\d+$/.test(raw)) {
			return { ok: false, error: `invalid \`deep\`: expected a non-negative integer, got "${raw}"` }
		}
		deep = Number(raw)
	}
	const body = lines.slice(bounds.close + 1).join("\n").replace(/^\n+/, "").trimEnd()
	const agent: RemoteAgentRow = { name, deep, body, file: path }
	const displayName = values["display_name"]?.trim()
	if (displayName !== undefined && displayName !== "") agent.displayName = displayName
	const description = values["description"]?.trim()
	if (description !== undefined && description !== "") agent.description = description
	const color = values["color"]?.trim()
	if (color !== undefined && color !== "") agent.color = color
	const model = values["model"]?.trim()
	if (model !== undefined && model !== "") agent.model = model
	const thinking = values["thinking"]?.trim()
	if (thinking !== undefined && thinking !== "") agent.thinking = thinking
	// Registry fail-loud parity (agents-dir.ts): a mistyped background or
	// maxRounds drops the file from the roster instead of silently ignoring
	// the declared value. `maxRounds` is a POSITIVE integer - 0 is broken,
	// not "unlimited" (registry ownership of that key).
	const background = values["background"]?.trim()
	if (background !== undefined && background !== "") {
		if (background !== "true" && background !== "false") {
			return { ok: false, error: `invalid \`background\`: expected true or false, got "${background}"` }
		}
		agent.background = background === "true"
	}
	const maxRounds = values["maxRounds"]?.trim()
	if (maxRounds !== undefined && maxRounds !== "") {
		if (!/^\d+$/.test(maxRounds) || Number(maxRounds) < 1) {
			return { ok: false, error: `invalid \`maxRounds\`: expected a positive integer, got "${maxRounds}"` }
		}
		agent.maxRounds = Number(maxRounds)
	}
	return { ok: true, agent }
}

/**
 * Agent definitions from `<dshHome>/agents/*.md` (top level only) - valid
 * rows sorted by name (`localeCompare`, tui-pi order), broken files appended
 * as rows carrying `broken` (never thrown).
 */
export function listAgentFiles(explicitHome?: string): RemoteAgentRow[] {
	const agents: RemoteAgentRow[] = []
	const broken: RemoteAgentRow[] = []
	try {
		const home = resolveDshHome(explicitHome)
		const dir = join(home, "agents")
		if (!existsSync(dir)) return []
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue
			const full = join(dir, entry.name)
			try {
				const result = parseAgentMarkdown(readFileSync(full, "utf8"), full)
				if (result.ok) agents.push(result.agent)
				else broken.push({ name: entry.name.replace(/\.md$/, ""), deep: 1, body: "", file: full, broken: result.error })
			} catch (e) {
				broken.push({
					name: entry.name.replace(/\.md$/, ""),
					deep: 1,
					body: "",
					file: full,
					broken: String(e instanceof Error ? e.message : e).slice(0, 100),
				})
			}
		}
	} catch {
		/* dir missing: empty */
	}
	agents.sort((a, b) => a.name.localeCompare(b.name))
	broken.sort((a, b) => a.file.localeCompare(b.file))
	return [...agents, ...broken]
}

/** Frontmatter updates: `undefined` leaves a key untouched, `null` removes
 * the line (the "inherit" spelling), a value writes/replaces it. */
export interface AgentFrontmatterUpdates {
	model?: string | null
	thinking?: string | null
	deep?: number | null
	maxRounds?: number | null
	background?: boolean | null
}

/**
 * Apply frontmatter updates in place (tui-pi `updateAgentFrontmatter`
 * parity): existing lines are rewritten where they are, missing keys are
 * inserted before the closing fence, `null` removes the line, CRLF is
 * preserved and a no-op returns without touching the file. Resolves an
 * error message, or `undefined` on success.
 */
export function updateAgentFrontmatter(path: string, updates: AgentFrontmatterUpdates): string | undefined {
	let text: string
	try {
		text = readFileSync(path, "utf8")
	} catch (e) {
		return `cannot read ${path}: ${String(e instanceof Error ? e.message : e)}`
	}
	const eol = text.includes("\r\n") ? "\r\n" : "\n"
	const lines = text.split(/\r?\n/)
	const bounds = frontmatterBounds(lines)
	if (bounds === undefined) return "missing frontmatter (file must start with `---`)"
	const pending: Array<[string, string | null]> = []
	if (updates.model !== undefined) pending.push(["model", updates.model])
	if (updates.thinking !== undefined) pending.push(["thinking", updates.thinking])
	if (updates.deep !== undefined) pending.push(["deep", updates.deep === null ? null : String(updates.deep)])
	if (updates.maxRounds !== undefined) pending.push(["maxRounds", updates.maxRounds === null ? null : String(updates.maxRounds)])
	if (updates.background !== undefined) {
		pending.push(["background", updates.background === null ? null : String(updates.background)])
	}
	let changed = false
	let close = bounds.close
	for (const [key, value] of pending) {
		let found = -1
		for (let i = 1; i < close; i++) {
			if (KEY_LINE.test(lines[i]!) && lines[i]!.trimStart().startsWith(`${key}:`)) {
				found = i
				break
			}
		}
		const rendered = value === null ? null : `${key}: ${value}`
		if (found >= 0) {
			if (rendered === null) {
				lines.splice(found, 1)
				close--
				changed = true
			} else if (lines[found] !== rendered) {
				lines[found] = rendered
				changed = true
			}
		} else if (rendered !== null) {
			lines.splice(close, 0, rendered)
			close++
			changed = true
		}
	}
	if (!changed) return undefined
	try {
		writeFileSync(path, lines.join(eol))
		return undefined
	} catch (e) {
		return String(e instanceof Error ? e.message : e)
	}
}

/**
 * Edit one frontmatter field of an agent definition file. `value === null`
 * clears the key (inherit). The caller resolves the agent by its exact
 * `name` (=== file stem after parse). Resolves an error message, else
 * `undefined`.
 */
export type AgentFrontmatterField = "model" | "thinking" | "deep" | "maxRounds" | "background"

export function setAgentField(
	name: string,
	field: AgentFrontmatterField,
	value: string | null,
	explicitHome?: string,
): string | undefined {
	const home = resolveDshHome(explicitHome)
	const file = join(home, "agents", `${name}.md`)
	if (field === "deep") {
		if (value !== null && !/^\d+$/.test(value)) {
			return `expected a non-negative integer, got "${value}"`
		}
		return updateAgentFrontmatter(file, { deep: value === null ? null : Number(value) })
	}
	if (field === "maxRounds") {
		// Registry parity: positive integer only. 0 would mark the file broken
		// on the consuming side, so it is rejected here (see remote-local-fs
		// parse note). Empty input never reaches this function (keep). The
		// safe-integer guard keeps a 20-digit input from being written as
		// `1e+20` (Number exceeds the exact range).
		if (value !== null) {
			const parsed = Number(value)
			if (!/^\d+$/.test(value) || parsed < 1 || !Number.isSafeInteger(parsed)) {
				return `expected a positive integer, got "${value}"`
			}
		}
		return updateAgentFrontmatter(file, { maxRounds: value === null ? null : Number(value) })
	}
	if (field === "background") {
		if (value !== null && value !== "true" && value !== "false") {
			return `expected true or false, got "${value}"`
		}
		return updateAgentFrontmatter(file, { background: value === null ? null : value === "true" })
	}
	return updateAgentFrontmatter(file, { [field]: value })
}

/**
 * Session-log integrity scan (row 31; host-session.ts:653-711 parity):
 * walks `<dshHome>/sessions/` and flags empty logs, broken zstd frames and
 * invalid jsonl tails. Returns the report lines the /repair card prints.
 */
export function repairScanSessions(explicitHome?: string): string[] {
	const out: string[] = []
	try {
		const home = resolveDshHome(explicitHome)
		const root = join(home, "sessions")
		if (!existsSync(root)) return ["no sessions directory"]
		let total = 0
		let ok = 0
		const broken: string[] = []
		const visit = (dir: string, depth: number): void => {
			if (depth > 4) return
			for (const name of readdirSync(dir)) {
				const full = join(dir, name)
				if (statSync(full).isDirectory()) {
					visit(full, depth + 1)
					continue
				}
				// any session log: v3/v4, plain or zstd — the layout moved to
				// session-<uuid>/ directories with v4 zstd logs
				if (!(name.startsWith("session.") && (name.endsWith(".zstd") || name.endsWith(".jsonl")))) continue
				total += 1
				const size = statSync(full).size
				if (size === 0) {
					broken.push(`${name} (0 bytes)`)
					continue
				}
				if (name.endsWith(".zstd")) {
					const buf = readFileSync(full)
					const magicOk = buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd
					if (!magicOk) {
						broken.push(`${name} (not a zstd frame)`)
						continue
					}
					ok += 1
					continue
				}
				try {
					const text = readFileSync(full, "utf8").trim()
					const last = text.split("\n").filter((l) => l.trim()).pop() ?? "{}"
					JSON.parse(last)
					ok += 1
				} catch {
					broken.push(`${name} (invalid jsonl tail)`)
				}
			}
		}
		visit(root, 0)
		out.push(`sessions: ${total} logs scanned, ${ok} healthy`)
		if (broken.length === 0) out.push("no broken logs found")
		else {
			out.push(`broken: ${broken.length}`)
			for (const b of broken.slice(0, 8)) out.push(`  ✗ ${b}`)
			if (broken.length > 8) out.push(`  … +${broken.length - 8} more`)
		}
	} catch (e) {
		out.push(`scan failed: ${String(e instanceof Error ? e.message : e).slice(0, 150)}`)
	}
	return out
}
