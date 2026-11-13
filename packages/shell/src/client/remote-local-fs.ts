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

import {
	chmodSync,
	closeSync,
	existsSync,
	openSync,
	readFileSync,
	readdirSync,
	readSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import type { Dirent } from "node:fs"
import * as nodeZlib from "node:zlib"

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
 * walks `<dshHome>/sessions/` and flags empty logs, broken/truncated zstd
 * frames and invalid jsonl tails. Returns the report lines the /repair card
 * prints.
 *
 * Hot-path note (this also backs the /resume probe): per log only a bounded
 * TAIL window is read (plain jsonl) or a full frame verify runs once per
 * (mtime, size) version (zstd), all behind a verdict cache — scanning a
 * large store never re-reads unchanged bodies.
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
		visitSessionLogs(root, 0, (full, name) => {
			total += 1
			const verdict = probeSessionLog(full, name)
			if (verdict.broken) broken.push(`${name} (${verdict.reason})`)
			else ok += 1
		})
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

/** One broken session log from {@link scanBrokenSessionLogs}: the absolute
 * path, the file name, the same reason strings the /repair card prints, and
 * the owning session id when the log sits in a `session-<uuid>/` directory. */
export interface BrokenSessionLog {
	path: string
	name: string
	reason: string
	sessionId?: string
}

/**
 * Structured sibling of {@link repairScanSessions} (same walker and probe
 * criteria): returns the broken logs with their paths so the /resume repair
 * flow can map them onto picker rows and act per log. Never throws; a
 * scan-level failure surfaces as a `reason`-carrying pseudo row.
 */
export function scanBrokenSessionLogs(explicitHome?: string): BrokenSessionLog[] {
	const broken: BrokenSessionLog[] = []
	try {
		const home = resolveDshHome(explicitHome)
		const root = join(home, "sessions")
		if (!existsSync(root)) return broken
		visitSessionLogs(root, 0, (full, name) => {
			const sessionId = /^session-(.+)$/.exec(basename(dirname(full)))?.[1]
			const verdict = probeSessionLog(full, name)
			if (verdict.broken) broken.push({ path: full, name, reason: verdict.reason, sessionId })
		})
	} catch (e) {
		broken.push({
			path: "",
			name: "",
			reason: `scan failed: ${String(e instanceof Error ? e.message : e).slice(0, 150)}`,
		})
	}
	return broken
}

/** Walk `<root>` to depth 4 and hand every session log (plain or zstd, any
 * v3/v4 layout) to `onLog`. Per-entry fault tolerance: an unreadable
 * directory or a single failing entry (dangling symlink, permission oddity,
 * a host rotation/compaction ENOENT race) is skipped — it never aborts the
 * whole scan and never silently truncates the result set. */
function visitSessionLogs(dir: string, depth: number, onLog: (path: string, name: string) => void): void {
	if (depth > 4) return
	let entries: Dirent[]
	try {
		entries = readdirSync(dir, { withFileTypes: true })
	} catch {
		return // unreadable directory: skip it, keep the rest of the scan
	}
	for (const entry of entries) {
		const full = join(dir, entry.name)
		if (entry.isDirectory()) {
			visitSessionLogs(full, depth + 1, onLog)
			continue
		}
		// any session log: v3/v4, plain or zstd — the layout moved to
		// session-<uuid>/ directories with v4 zstd logs
		if (!(entry.name.startsWith("session.") && (entry.name.endsWith(".zstd") || entry.name.endsWith(".jsonl")))) continue
		try {
			onLog(full, entry.name)
		} catch {
			continue // one unreadable entry must not take down the scan
		}
	}
}

/** Per-log integrity verdict, cached per (mtime, size) so /resume re-scans
 * never re-read unchanged log bodies. */
type LogVerdict = { broken: false } | { broken: true; reason: string }

const logVerdictCache = new Map<string, { mtimeMs: number; size: number; verdict: LogVerdict }>()

/**
 * The zstd frame verifier. `Bun.zstdDecompressSync` THROWS on truncated or
 * corrupt frames; the node:zlib shim only throws on Node runtimes that map
 * the error (it silently returns partial output under Bun, so it is a
 * fallback, never the first choice). `undefined` = this runtime has no
 * verifier — the magic check then stands alone and the frame body is NOT
 * verified (no claim either way).
 */
function zstdVerifyFn(): ((frame: Buffer) => Buffer) | undefined {
	if (typeof Bun !== "undefined" && typeof Bun.zstdDecompressSync === "function") {
		return Bun.zstdDecompressSync.bind(Bun)
	}
	if (typeof nodeZlib.zstdDecompressSync === "function") return nodeZlib.zstdDecompressSync
	return undefined
}

/** Probe ONE session log (cached): 0-byte, broken/truncated zstd frame, or
 * invalid plain-jsonl tail. Never throws; an unreadable log is flagged, a
 * log that vanished mid-scan is treated as absent (rotation race). */
function probeSessionLog(path: string, name: string): LogVerdict {
	let size: number
	let mtimeMs: number
	try {
		const st = statSync(path)
		size = st.size
		mtimeMs = st.mtimeMs
	} catch {
		return { broken: false }
	}
	const cached = logVerdictCache.get(path)
	if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.verdict
	let verdict: LogVerdict
	try {
		if (size === 0) {
			verdict = { broken: true, reason: "0 bytes" }
		} else if (name.endsWith(".zstd")) {
			verdict = probeZstdFrame(path)
		} else {
			verdict = jsonlTailParses(path, size) ? { broken: false } : { broken: true, reason: "invalid jsonl tail" }
		}
	} catch (e) {
		verdict = { broken: true, reason: `unreadable: ${String(e instanceof Error ? e.message : e).slice(0, 100)}` }
	}
	logVerdictCache.set(path, { mtimeMs, size, verdict })
	return verdict
}

/**
 * zstd probe: the magic bytes via a bounded 4-byte read (never the whole
 * file), then — when a zstd binding is available — a full frame verify that
 * catches TRUNCATED frames (valid magic, torn body: the realistic crash
 * residue a magic check alone cannot see). Every flagged zstd verdict says
 * plainly that client-side repair cannot fix it (only plain jsonl tails are
 * repaired), so no UI ever offers a doomed action.
 */
function probeZstdFrame(path: string): LogVerdict {
	const notRepairable = " — not repairable client-side (only plain jsonl tails are)"
	const fd = openSync(path, "r")
	try {
		const magic = Buffer.alloc(4)
		const read = readSync(fd, magic, 0, 4, 0)
		if (read < 4 || magic[0] !== 0x28 || magic[1] !== 0xb5 || magic[2] !== 0x2f || magic[3] !== 0xfd) {
			return { broken: true, reason: `not a zstd frame${notRepairable}` }
		}
	} finally {
		closeSync(fd)
	}
	const verify = zstdVerifyFn()
	if (verify === undefined) return { broken: false } // magic ok; body not verifiable in this runtime
	try {
		verify(readFileSync(path))
		return { broken: false }
	} catch {
		return { broken: true, reason: `truncated or corrupt zstd frame${notRepairable}` }
	}
}

/** Whether the last non-empty line of a plain jsonl log parses as JSON —
 * read from the TAIL through bounded windows (64KB, growing only when the
 * window starts mid-line), never the full body. A window that cut the last
 * line (no preceding newline seen, window < size) grows and retries before
 * the log is called broken. */
function jsonlTailParses(path: string, size: number): boolean {
	const fd = openSync(path, "r")
	try {
		let window = Math.min(size, 64 * 1024)
		for (;;) {
			const buf = Buffer.alloc(window)
			const read = readSync(fd, buf, 0, window, size - window)
			const lines = buf.toString("utf8", 0, read).split("\n")
			let last = ""
			let lastIdx = -1
			for (let i = lines.length - 1; i >= 0; i--) {
				if (lines[i]!.trim() !== "") {
					last = lines[i]!
					lastIdx = i
					break
				}
			}
			if (last === "") return true // blank tail: nothing torn
			try {
				JSON.parse(last)
				return true
			} catch {
				// A window that starts mid-line may have cut the last line in
				// half — grow the window and retry before flagging it broken.
				if (lastIdx === 0 && window < size) {
					window = Math.min(size, window * 4)
					continue
				}
				return false
			}
		}
	} finally {
		closeSync(fd)
	}
}

/** Outcome of the guarded repair of one session log (tui-pi log-repair.ts
 * parity): results, never throws. */
export type RepairSessionLogResult =
	| { kind: "repaired"; backupPath: string }
	| { kind: "clean" }
	| { kind: "failed"; detail: string }

/** Injection seams for the guarded swap (tui-pi swapRepaired parity): tests
 * drive the fs calls and the writer probe pause directly instead of staging
 * real permission/IO failures. Every field defaults to the real fs call. */
export interface RepairSessionLogOptions {
	/** The inter-sample pause of the active-writer re-check. */
	delayFn?: (ms: number) => void
	/** The swap-in write of the repaired copy. Defaults to writeFileSync. */
	writeFn?: typeof writeFileSync
	/** The two renames of the swap pair. Defaults to renameSync. */
	renameFn?: typeof renameSync
}

/** Wall-clock gap between the two stability samples of the active-writer
 * re-check (a log quiet for this long is treated as not being appended). */
const ACTIVE_WRITER_PROBE_MS = 25

/** Blocking pause without timers: the writer re-check samples the log twice
 * around this gap and must not yield the render thread meanwhile. */
function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Guarded repair of ONE plain-jsonl session log with an invalid tail
 * (tui-pi repairSessionLog invariants, minus the offline-surgery script the
 * zstd fork case needs):
 *
 * - Anything but a plain `.jsonl` log (0-byte, zstd) is NOT repairable
 *   client-side and reports `failed` — the caller must never lose data it
 *   cannot reconstruct.
 * - A log whose last non-empty line already parses reports `clean` (nothing
 *   was touched — the corruption may have self-healed).
 * - ACTIVE-WRITER DEFENSE: the scan can glimpse a torn tail of a log that
 *   is being appended RIGHT NOW (a large event line written in several
 *   writes looks torn mid-write). Before touching anything, the log's
 *   mtime+size are sampled twice around a short gap; an unstable log is
 *   abandoned untouched and reported as still being written.
 * - SWAP (tui-pi swapRepaired order): the repaired copy is written — with
 *   owner-only 0600 permissions AT CREATION — beside the original, verified
 *   byte-for-byte, and only then takes the canonical name in a tight
 *   rename-rename pair (original → `<name>.corrupt-bak`, epoch-suffixed
 *   when taken, never overwritten). A failed swap-in restores the original
 *   best-effort and the failure detail NAMES the backup, so even a double
 *   failure never strands the data without a pointer.
 */
export function repairSessionLogTail(path: string, options: RepairSessionLogOptions = {}): RepairSessionLogResult {
	const delayFn = options.delayFn ?? sleepSync
	const writeFn = options.writeFn ?? writeFileSync
	const renameFn = options.renameFn ?? renameSync
	if (!path.endsWith(".jsonl")) {
		return { kind: "failed", detail: "not a plain jsonl log — client-side repair only truncates invalid jsonl tails" }
	}
	let text: string
	try {
		text = readFileSync(path, "utf8")
	} catch (e) {
		return { kind: "failed", detail: `cannot read ${basename(path)}: ${String(e instanceof Error ? e.message : e)}` }
	}
	const lines = text.split("\n")
	let end = lines.length
	while (end > 0 && lines[end - 1]!.trim() === "") end--
	let kept = end
	while (kept > 0) {
		try {
			JSON.parse(lines[kept - 1]!)
			break
		} catch {
			kept--
		}
	}
	if (kept === 0) {
		return { kind: "failed", detail: "no parseable jsonl line remains — refusing to empty the log" }
	}
	if (kept === end) return { kind: "clean" }
	// Active-writer defense: two stable mtime+size samples around a short
	// gap, or the repair is abandoned untouched.
	try {
		const before = statSync(path)
		delayFn(ACTIVE_WRITER_PROBE_MS)
		const after = statSync(path)
		if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
			return { kind: "failed", detail: "log is still being written — repair abandoned, nothing was touched" }
		}
	} catch (e) {
		return { kind: "failed", detail: `cannot stat ${basename(path)}: ${String(e instanceof Error ? e.message : e)}` }
	}
	const repaired = lines.slice(0, kept).join("\n") + "\n"
	// The repaired copy is written BESIDE the original first (0600 at
	// creation — never a world-readable moment) and verified before any
	// canonical name is touched.
	const tmpPath = `${path}.repair-tmp-${Date.now()}`
	try {
		writeFn(tmpPath, repaired, { mode: 0o600 })
	} catch (e) {
		return { kind: "failed", detail: `cannot write the repaired copy: ${String(e instanceof Error ? e.message : e)}` }
	}
	try {
		if (readFileSync(tmpPath, "utf8") !== repaired) throw new Error("repaired copy content mismatch")
	} catch (e) {
		try {
			unlinkSync(tmpPath)
		} catch {
			// Best-effort cleanup.
		}
		return {
			kind: "failed",
			detail: `repaired copy failed verification: ${String(e instanceof Error ? e.message : e)}`,
		}
	}
	let backupPath = `${path}.corrupt-bak`
	try {
		statSync(backupPath)
		backupPath = `${backupPath}.${Date.now()}`
	} catch {
		// Free — the plain .corrupt-bak name is ours.
	}
	try {
		renameFn(path, backupPath)
	} catch (e) {
		try {
			unlinkSync(tmpPath)
		} catch {
			// Best-effort cleanup.
		}
		return { kind: "failed", detail: `cannot back up the original: ${String(e instanceof Error ? e.message : e)}` }
	}
	try {
		renameFn(tmpPath, path)
	} catch (e) {
		// Best-effort restore first — the canonical name must not stay missing
		// with the original parked in the backup. The detail names the backup
		// either way: on a double failure that copy is all that remains.
		try {
			unlinkSync(tmpPath)
		} catch {
			// Best-effort cleanup of the stray repaired copy.
		}
		let restored = false
		try {
			renameFn(backupPath, path)
			restored = true
		} catch {
			// Nothing further is recoverable; the backup still holds the original.
		}
		return {
			kind: "failed",
			detail: `swap failed: ${String(e instanceof Error ? e.message : e)} — the original is at ${backupPath}${restored ? " (restored in place)" : " (restore failed; the backup copy is the only remaining data)"}`,
		}
	}
	try {
		chmodSync(path, 0o600)
	} catch {
		// Permissions are store hygiene, not log integrity: the swap already
		// succeeded, so a chmod failure never flips the outcome.
	}
	return { kind: "repaired", backupPath }
}
