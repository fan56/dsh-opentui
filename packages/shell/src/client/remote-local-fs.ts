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
 * `model`, `thinking`, `deep`) + a body. `listAgentFiles` never throws
 * (broken files are reported in-band); `setAgentField` edits one
 * frontmatter field read-modify-write.
 *
 * One deliberate divergence from host-session.ts:500: that test
 * (`/^---\\n[\\s\\S]*?\\n---/`) matches a literal backslash-n, so its
 * "insert into existing frontmatter" branch was dead and a field added to
 * a file that already had frontmatter prepended a SECOND frontmatter
 * block (corrupting the file). The client-local write path uses the
 * intended regex — parity of the file conventions, not of the defect.
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
import { join } from "node:path"

/** One agent definition row (the HostSession.listAgents shape). */
export interface RemoteAgentRow {
	name: string
	displayName?: string
	description?: string
	model?: string
	thinking?: string
	deep?: string
	file: string
	broken?: string
}

/** The effective dsh home (HostSession parity): $DSH_HOME or ~/.dsh. */
export function resolveDshHome(explicit?: string): string {
	return explicit ?? (process.env.DSH_HOME || join(homedir(), ".dsh"))
}

/**
 * Agent definitions from `<dshHome>/agents/*.md` (row 30) — frontmatter
 * (name, display_name, description, model, thinking, deep) + body. Broken
 * files are reported, not thrown (host-session.ts:453-507 parity).
 */
export function listAgentFiles(explicitHome?: string): RemoteAgentRow[] {
	const out: RemoteAgentRow[] = []
	try {
		const home = resolveDshHome(explicitHome)
		const dir = join(home, "agents")
		if (!existsSync(dir)) return []
		for (const f of readdirSync(dir)) {
			if (!f.endsWith(".md")) continue
			const full = join(dir, f)
			try {
				const text = readFileSync(full, "utf8")
				const m = /^---\n([\s\S]*?)\n---/.exec(text)
				const fm: Record<string, string> = {}
				if (m) {
					for (const line of m[1]!.split("\n")) {
						const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line.trim())
						if (kv) fm[kv[1]!] = kv[2]!.replace(/^"|"$|'"$/g, "").trim()
					}
				}
				out.push({
					name: fm.name ?? f.replace(/\.md$/, ""),
					displayName: fm.display_name,
					description: fm.description,
					model: fm.model,
					thinking: fm.thinking,
					deep: fm.deep,
					file: full,
				})
			} catch (e) {
				out.push({ name: f, file: full, broken: String(e instanceof Error ? e.message : e).slice(0, 100) })
			}
		}
	} catch {
		/* dir missing: empty */
	}
	return out
}

/**
 * Edit one frontmatter field of an agent definition file (row 30 write
 * half; host-session.ts:492-507 parity). Reads `<home>/agents/<name>.md`,
 * replaces the `field:` line in place, inserts into the existing
 * frontmatter block when the field is new, or prepends a frontmatter block
 * to a body-only file. Throws on a missing file (the caller paints it).
 */
export function setAgentField(
	name: string,
	field: "model" | "thinking" | "deep",
	value: string,
	explicitHome?: string,
): void {
	const home = resolveDshHome(explicitHome)
	const file = join(home, "agents", `${name}.md`)
	const text = readFileSync(file, "utf8")
	const lineRe = new RegExp(`^(${field}):\\s*.*$`, "m")
	let next: string
	if (lineRe.test(text)) {
		next = text.replace(lineRe, `$1: ${value}`)
	} else if (/^---\n[\s\S]*?\n---/.test(text)) {
		// insert into the frontmatter block before its closing ---
		next = text.replace(/^---\n/, `---\n${field}: ${value}\n`)
	} else {
		next = `---\n${field}: ${value}\n---\n\n` + text
	}
	writeFileSync(file, next)
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
