/**
 * Tool block summarization (batch V1, dsh-tui-pi semantics —
 * dsh-tui-pi/src/activity.ts `toolSubject` / `callDetail` /
 * `resultTextLines` parity, rendered as transcript rows instead of the
 * fixed live panel).
 *
 * The wire carries RAW JSON in both directions:
 *   - tool/call `arguments`  → `toolSubject` picks the head word,
 *     `toolDetail` renders the human arg line (`$ cmd`, paths, pattern…).
 *   - tool/result `output`   → `toolResultLine` digs the first text line
 *     out of the JSON-brief the follow stream slices (RemoteToolRun.output
 *     is `JSON.stringify(output).slice(0, 300)`).
 *
 * All helpers are total: non-JSON, empty and oversized inputs degrade to
 * '' — a tool block renders from whatever arrives, never throws.
 */

import { stringWidth } from "../../util/string-width"

/**
 * Display-width clip (P1-1 CJK law): limits are TERMINAL COLUMNS, measured
 * with the package's #string-width util — a CJK code point is 2 columns, so
 * a `.length`-based budget overflows 2x on Chinese args. No ANSI sequences
 * in these strings.
 */
export function clipToWidth(text: string, limit: number): string {
	if (limit <= 0) return ""
	const flat = text.replace(/\s+/u, " ").trim()
	if (stringWidth(flat) <= limit) return flat
	// Walk the string accumulating display width; keep room for the ellipsis.
	let width = 0
	for (let i = 0; i < flat.length; i++) {
		width += stringWidth(flat[i]!)
		if (width > limit - 1) {
			return limit <= 1 ? "…" : `${flat.slice(0, i)}…`
		}
	}
	return flat
}

/** First word of a value (dsh-tui-pi parity: `command`.split(/\s+/)[0]).
 * CJK text carries no spaces — the whole string comes back as the "word";
 * the title/track callers clip by display width, so this stays bounded. */
function firstWord(value: string): string {
	return value.trim().split(/\s+/u)[0] ?? ""
}

/**
 * Head-word subject of a call (dsh-tui-pi `toolSubject` parity): the first
 * string value among the known keys, else the first string value at all.
 * Display-capped to 24 columns so an unsplit CJK value can't balloon the
 * title before the row-level clip sees it.
 */
export function toolSubject(rawArguments: string): string {
	const cap = (value: string): string => clipToWidth(value, 24)
	try {
		const parsed = JSON.parse(rawArguments) as Record<string, unknown>
		for (const key of ["command", "file_path", "path", "query", "url", "pattern", "description"]) {
			const value = parsed[key]
			if (typeof value === "string" && value.trim() !== "") return cap(firstWord(value))
		}
		for (const value of Object.values(parsed)) {
			if (typeof value === "string" && value.trim() !== "") return cap(firstWord(value))
		}
	} catch {
		// Model-controlled rawArguments; non-JSON yields no subject.
	}
	return ""
}

/**
 * Human arg detail line (dsh-tui-pi `callDetail` parity, limit 120):
 * `$ command`, file paths, pattern/query/url, falling back to the flattened
 * raw JSON; newlines fold to ` ⏎ `.
 */
export function toolDetail(rawArguments: string, limit = 120): string {
	try {
		const parsed = JSON.parse(rawArguments) as Record<string, unknown>
		const parts: string[] = []
		if (typeof parsed.command === "string") parts.push(`$ ${parsed.command}`)
		if (typeof parsed.file_path === "string") parts.push(parsed.file_path)
		if (typeof parsed.path === "string" && parts.length === 0) parts.push(parsed.path)
		if (typeof parsed.pattern === "string") parts.push(`pattern: ${parsed.pattern}`)
		if (typeof parsed.query === "string") parts.push(`query: ${parsed.query}`)
		if (typeof parsed.url === "string") parts.push(parsed.url)
	if (typeof parsed.description === "string" && parts.length === 0) parts.push(parsed.description)
	// ask_agent shape (batch D5, real-model capture): the relay ask carries
	// { agent_id, prompt | message } — same delegation family as use_agent.
	// The human summary reads `→ <agent> · <content>`; the raw-JSON fallback
	// must never fire for it.
	const agentId = typeof parsed.agent_id === "string" ? parsed.agent_id.trim() : ""
	if (agentId !== "") {
		const content =
			typeof parsed.prompt === "string" && parsed.prompt.trim() !== ""
				? parsed.prompt
				: typeof parsed.message === "string"
					? parsed.message
					: ""
		const summary = content.trim() !== "" ? `→ ${agentId} · ${content.trim()}` : `→ ${agentId}`
		return clipToWidth(summary.replace(/\n/g, " ⏎ "), limit)
	}
	// use_agent shape (batch D1, dsh-tui-pi parity): the delegation tools carry
	// { agent, prompt } — the human summary names the agent and leads with the
	// prompt's first line; the raw-JSON fallback must never fire for it.
	if (typeof parsed.agent === "string") parts.push(`agent: ${parsed.agent}`)
	if (typeof parsed.prompt === "string" && parsed.prompt.trim() !== "") {
		parts.push(parsed.prompt.trim())
	}
	if (parts.length === 0) parts.push(rawArguments.replace(/\s+/g, " "))
		const joined = parts.join("  ").replace(/\n/g, " ⏎ ")
		return clipToWidth(joined, limit)
	} catch {
		return ""
	}
}

/**
 * Depth-limited string leaf walk (batch D2): the (key, value) pairs of an
 * envelope object's string leaves in insertion order, arrays flattened to
 * their first readable entry. The human-readable fallback for envelopes
 * with no text/content/output dig.
 */
function stringLeaves(record: Record<string, unknown>, depth: number): [string, string][] {
	const out: [string, string][] = []
	if (depth < 0) return out
	for (const [key, value] of Object.entries(record)) {
		if (typeof value === "string") {
			if (value.trim() !== "") out.push([key, value.trim().split("\n")[0] ?? value.trim()])
		} else if (typeof value === "number" || typeof value === "boolean") {
			out.push([key, String(value)])
		} else if (value !== null && typeof value === "object") {
			const inner = Array.isArray(value) ? (value.find((v) => v !== null && typeof v === "object") as unknown) : value
			if (inner !== null && typeof inner === "object") {
				out.push(...stringLeaves(inner as Record<string, unknown>, depth - 1))
			} else if (typeof inner === "string" && inner.trim() !== "") {
				out.push([key, inner.trim()])
			}
		}
		if (out.length >= 4) break
	}
	return out.slice(0, 4)
}

/** Human placeholder when a JSON result carries no readable text (batch
 * D5 law: a raw JSON brief NEVER reaches the screen, on any path). */
export const TOOL_RESULT_PLACEHOLDER = "tool result"

/**
 * Truncation-tolerant dig (batch D5, verified live: the follow brief is
 * `JSON.stringify(output).slice(0, 300)`, so a long result arrives as
 * UNPARSEABLE cut JSON — `{"turn":1,"step":1,"message":{"role":"tool",…`
 * — and the old parse-failure arm painted it raw). Scan for the first
 * human-text field (`text`, then string `content`/`output`/`result`) and
 * decode its JSON-escaped value up to the closing quote or the cut.
 */
function digTruncatedJson(raw: string): string | undefined {
	for (const key of ["text", "content", "output", "result", "message"]) {
		const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, "u").exec(raw)
		if (match === null) continue
		let body = match[1]!
		// A cut inside an escape leaves a dangling backslash — drop it.
		body = body.replace(/\\(u[0-9a-fA-F]{0,3})?$/u, "")
		try {
			const decoded = JSON.parse(`"${body}"`) as string
			if (decoded.trim() !== "") return decoded
		} catch {
			// Undecodable fragment — try the next key.
		}
	}
	return undefined
}

/**
 * First meaningful line of a tool result (dsh-tui-pi `resultTextLines`
 * semantics applied to the follow stream's JSON brief): the input is
 * `JSON.stringify(output).slice(0, 300)` — dig the text content out
 * best-effort ({ text }, { content: string | [{ type: "text", text }] },
 * the `{turn, message: {role: "tool", content}}` wire envelope), else the
 * human leaves, else the `tool result` placeholder — never raw JSON.
 */
export function toolResultLine(output: string | undefined, limit = 120): string {
	if (output === undefined || output.trim() === "") return ""
	let text = output
	const looksJson = /^\s*[{["]/u.test(output)
	try {
		const parsed = JSON.parse(output) as unknown
		if (typeof parsed === "string") {
			text = parsed
		} else if (parsed !== null && typeof parsed === "object") {
			text = TOOL_RESULT_PLACEHOLDER
			const record = parsed as Record<string, unknown>
			// The follow brief can be the WHOLE wire envelope ({turn, message,
			// …}) when data.output is absent (verified live: the ⎿ track showed
			// the raw envelope) — dig the message record out first.
			const inner = typeof record.message === "object" && record.message !== null
				? (record.message as Record<string, unknown>)
				: record
			const blocks = Array.isArray(inner.content) ? inner.content : Array.isArray(parsed) ? (parsed as unknown[]) : undefined
			const first = blocks?.find(
				(block) => typeof block === "object" && block !== null && typeof (block as Record<string, unknown>).text === "string",
			) as Record<string, unknown> | undefined
			if (first !== undefined) {
				text = String(first.text)
			} else if (typeof inner.content === "string" && inner.content.trim() !== "") {
				text = inner.content
			} else if (typeof inner.text === "string") {
				text = inner.text
			} else if (typeof inner.output === "string") {
				text = inner.output
			} else if (blocks === undefined) {
				// Batch D2 fallback (verified live in the D1 frames: `✘
				// use_agent(looper) · 0.0s · {"turn":2,...}`): an envelope with
				// NO text/content/output digs — collect the object's string leaf
				// values (depth-2, insertion order) as `key: value` fragments.
				const leaves = stringLeaves(inner, 2)
				if (leaves.length > 0) text = leaves.map(([key, value]) => `${key}: ${value}`).join(" · ")
			}
		}
	} catch {
		// Not parseable: plain text — or a TRUNCATED JSON brief (D5), which
		// must be dug, never painted raw.
		if (looksJson) text = digTruncatedJson(output) ?? TOOL_RESULT_PLACEHOLDER
	}
	const lines = text
		.replace(/\s+$/u, "")
		.split("\n")
		.filter((line) => line.trim() !== "")
	if (lines.length === 0) return ""
	const first = lines[0]!
	const more = lines.length > 1 ? ` (+${lines.length - 1} lines)` : ""
	return clipToWidth(first + more, limit)
}
