/**
 * Session-side Remote operations for the client-mode session layer
 * (ADR-0005 bucket (b) wave 2; audit rows 12–20 + 26 + 27).
 *
 * Every method maps one TUI capability onto its unary Remote RPC (or, for
 * transcript reads, the `session/follow` opening snapshot plus backwards
 * `session/page` fills) and shapes the result into the exact HostSession
 * surface ShellHost already consumes. Wire facts (installed closure,
 * dsh 0.2.1-rc.5, `dsh-api-session-controller` + `dsh-commands` +
 * `dsh-skill` typert faces):
 *
 * - `session/list` → SessionSummary[]: running/blank/cwd/origin/
 *   parentSessionId/formatStatus + projection hints. NO title field — the
 *   row title is read opportunistically from the `title` projection value
 *   when the deployment contributes one (session-title plugin), else "".
 * - `session/page` {address, throughSeq, beforeSeq?} → one contiguous
 *   backwards page of `SessionWireEvent` records; `throughSeq` is the
 *   inclusive cut reported by the follow opening frame, `beforeSeq` the
 *   exclusive upper bound of the next older page.
 * - `session/follow` on any session id is a non-activating read (no writer
 *   lock) — the /tail path (row 17) and the stored-transcript replay (row
 *   14) both ride it; `session/create` is the only claim.
 * - `session/fork` {atSeq?}: omission = latest completed-turn prefix.
 * - `session/search` → items {sessionId, snippet} + hasMore.
 * - `session/rename` → {title (normalized), seq}.
 * - `commands/list` / `commands/execute` are agent-scoped: `agentId` is the
 *   session id; there is no boot-time (agent-less) list on the wire —
 *   with no live session the palette gets [] (degradation vs the
 *   in-process registry, which listed globally).
 * - `skills/list` {sessionId} → the session-composed human-invocable
 *   catalog; non-activating.
 *
 * The retention filter of row 13 stays CLIENT-side (host-session.ts:208-240
 * parity): subagent-origin rows out, retention-days cutoff by updatedAt,
 * newest first, capped.
 */

import { blocksText } from "./remote-follow.ts"
import { ASK_TOOL_NAME, parseAskCallArgs, parseAskAnswers, type ParsedAskQuestion } from "../features/ask-transcript.ts"
import type { StoredTranscriptRow } from "./seam-types.ts"
import type { MuxSocketFactory } from "./events-source.ts"
import { openRemoteStream } from "./remote-stream.ts"

/** One durable journal record (`SessionWireEvent` envelope subset). */
export interface RemoteJournalEntry {
	type: string
	seq: number
	time: number
	data: Record<string, unknown>
}

/** Unary RPC carrier (the ClientConnection subset used here). */
export interface RemoteOpsTransport {
	rpc(method: string, args?: Record<string, unknown>): Promise<unknown>
}

export interface RemoteSessionOpsOptions {
	rpc: RemoteOpsTransport["rpc"]
	/** Stream socket factory (the same mux the follow streams ride). */
	socketFactory: MuxSocketFactory
}

// ---------------------------------------------------------------------------
// Pure mappers (unit-tested standalone)
// ---------------------------------------------------------------------------

/**
 * Transcript rows from journal records (host-session.storedTranscript
 * parity, plus the ask_user_question Q&A rows: a durable `tool/call`
 * carrying the tool's questions pairs with its `tool/result` carrying
 * the answer batch into one "ask" row — resume/fork replays the Q&A
 * block the live turn painted. An ask call with no settled result
 * (mid-turn replay, errored read) renders nothing — no fabricated
 * answers).
 */
export function journalToTranscriptRows(
	entries: readonly RemoteJournalEntry[],
	skip = 0,
): StoredTranscriptRow[] {
	const items: StoredTranscriptRow[] = []
	const askCalls = new Map<string, { ids: string[]; questions: ParsedAskQuestion[] }>()
	// Batch V1: regular (non-ask) tool calls pair call→result into settled
	// tool rows — resume/fork replays the tool block with its args brief and
	// result instead of dropping it. Result pairing mirrors the live path
	// (remote-follow #toolResultEvent): ok is the isError mirror, brief is
	// the JSON.stringify(output).slice(0,300) summary. Calls without a
	// settled result (mid-turn resume) emit nothing — no fabricated rows.
	const toolCalls = new Map<string, { name: string; args: string }>()
	for (const entry of skip > 0 ? entries.slice(skip) : entries) {
		if (entry.type === "user/message") {
			const kind = sourceKind(entry.data)
			if (kind !== undefined && kind !== "user") continue
			const text = blocksText(entry.data.content)
			if (text) items.push({ kind: "user", text })
		} else if (entry.type === "assistant/message") {
			const text = assistantText(entry.data)
			if (text) items.push({ kind: "assistant", text })
		} else if (entry.type === "tool/call") {
			const name = String(entry.data.name ?? "")
			const callId = entry.data.callId === undefined ? "" : String(entry.data.callId)
			if (name === ASK_TOOL_NAME && callId) {
				const questions = parseAskCallArgs(typeof entry.data.arguments === "string" ? entry.data.arguments : "")
				if (questions) askCalls.set(callId, { ids: questions.map((q) => q.id), questions })
			} else if (callId) {
				toolCalls.set(callId, { name, args: typeof entry.data.arguments === "string" ? entry.data.arguments : "" })
			}
		} else if (entry.type === "tool/result") {
			const message = asRecord(entry.data.message)
			const callId = entry.data.callId !== undefined
				? String(entry.data.callId)
				: message.toolCallId !== undefined
					? String(message.toolCallId)
					: ""
			const asked = callId ? askCalls.get(callId) : undefined
			if (asked) {
				askCalls.delete(callId)
				const answers = parseAskAnswers(entry.data.message ?? entry.data)
				if (!answers) continue
				const merged = asked.questions.map(({ id, entry: q }) => {
					const ans = answers.find((a) => a.id === id)
					if (!ans) return { ...q, selected: [], declined: true }
					return {
						...q,
						selected: ans.selected,
						...(ans.custom !== undefined ? { custom: ans.custom } : {}),
						declined: ans.selected.length === 0 && (ans.custom === undefined || ans.custom === "declined"),
					}
				})
				items.push({ kind: "ask", entries: merged })
			} else {
				// Batch V1: a settled regular tool result replays its tool row.
				// Unknown callId (orphan result) still renders, nameless-args.
				const known = callId ? toolCalls.get(callId) : undefined
				if (callId) toolCalls.delete(callId)
				const ok = entry.data.isError !== true && message.isError !== true
				const brief = JSON.stringify(entry.data.output ?? entry.data).slice(0, 300)
				items.push({
					kind: "tool",
					name: known?.name ?? "tool",
					args: known?.args ?? "",
					ok,
					brief,
				})
			}
		}
	}
	return items
}

/**
 * Completed turns of one journal, oldest first — host-session.ts:1057-1084
 * parity (turn/start opens, first user-authored message is the preview,
 * turn/end closes with its seq as the fork point).
 */
export function groupTurns(entries: readonly RemoteJournalEntry[]): { turn: number; seqEnd: number; preview: string }[] {
	const turns: { turn: number; seqEnd: number; preview: string }[] = []
	let open: { turn: number; seqEnd: number; preview: string } | undefined
	for (const entry of entries) {
		if (entry.type === "turn/start") {
			// an unclosed previous bracket is dropped (live turn mid-flight)
			open = { turn: typeof entry.data.turn === "number" ? entry.data.turn : turns.length, seqEnd: entry.seq, preview: "" }
			continue
		}
		if (!open) continue
		if (entry.type === "user/message") {
			// host-injected runtime-context snapshots are user/message events
			// without a user source — previews want the human's words only
			const kind = sourceKind(entry.data)
			if (kind === undefined || kind === "user") {
				const text = blocksText(entry.data.content)
				if (text && !open.preview) open.preview = text
			}
		} else if (entry.type === "turn/end") {
			open.seqEnd = entry.seq
			turns.push(open)
			open = undefined
		}
	}
	return turns
}

/**
 * Remote-tail rows from journal records — the durable subset the in-process
 * zstd poll replayed (user/assistant text plus ⚙ tool lines), in the
 * `remoteTailSink` row shape. The remote tail sends the FULL accumulated row
 * set per flush (ShellHost's sink replaces the transcript view).
 */
export function tailRowsFromEntries(entries: readonly RemoteJournalEntry[]): { kind: string; text: string; final: boolean }[] {
	const rows: { kind: string; text: string; final: boolean }[] = []
	for (const entry of entries) {
		if (entry.type === "user/message") {
			const kind = sourceKind(entry.data)
			if (kind !== undefined && kind !== "user") continue
			const text = blocksText(entry.data.content)
			if (text) rows.push({ kind: "user", text, final: true })
		} else if (entry.type === "assistant/message") {
			const text = assistantText(entry.data)
			if (text) rows.push({ kind: "assistant", text, final: true })
		} else if (entry.type === "tool/call") {
			const args = typeof entry.data.arguments === "string" ? ` ${entry.data.arguments.slice(0, 90)}` : ""
			rows.push({ kind: "assistant", text: `⚙ ${String(entry.data.name ?? "tool")}${args}`, final: true })
		} else if (entry.type === "tool/result") {
			const ok = entry.data.isError !== true && asRecord(entry.data.message).isError !== true
			rows.push({ kind: "assistant", text: ok ? "  ⎿ done" : "  ⎿ failed", final: true })
		}
	}
	return rows
}

/** Sort journal records by seq (pages arrive newest-first; journals read oldest-first). */
export function sortJournal(entries: readonly RemoteJournalEntry[]): RemoteJournalEntry[] {
	return [...entries].sort((a, b) => a.seq - b.seq)

}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** The `source.kind` of a user/message record (host-side authorship tag). */
function sourceKind(data: Record<string, unknown>): unknown {
	return asRecord(data.source).kind
}

/** Text blocks of an assistant message record. */
function assistantText(data: Record<string, unknown>): string {
	return blocksText(asRecord(data.message).content)
}

// ---------------------------------------------------------------------------
// Remote ops
// ---------------------------------------------------------------------------

/** One /resume row (the HostSession listSessions shape). */
export interface RemoteSessionRow {
	id: string
	title: string
	updatedAt?: string
	/** Workspace directory (/resume DIR column) when the wire carries one. */
	cwd?: string
	/** On-disk log size in bytes (/resume 1KB display floor); absent = unknown. */
	sizeBytes?: number
}

export class RemoteSessionOps {
	readonly #rpc: RemoteOpsTransport["rpc"]
	readonly #socketFactory: MuxSocketFactory

	constructor(options: RemoteSessionOpsOptions) {
		this.#rpc = options.rpc
		this.#socketFactory = options.socketFactory
	}

	/**
	 * Stored sessions (row 13): `session/list` + the client-side retention
	 * filter of host-session.ts:208-240 — subagent-origin rows out,
	 * retention-days cutoff by updatedAt, newest first, capped.
	 */
	async listSessions(options: { limit?: number; retentionDays?: number } = {}): Promise<RemoteSessionRow[]> {
		const limit = options.limit ?? 12
		try {
			const value = (await this.#rpc("session/list", { _request: {} })) as { items?: unknown }
			const items = Array.isArray(value.items) ? value.items : []
			const retentionDays = Number(options.retentionDays ?? 0)
			const cutoff = retentionDays > 0 ? Date.now() - retentionDays * 86400000 : 0
			const out: RemoteSessionRow[] = []
			for (const item of items) {
				const row = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>
				// subagent children are not user-resumable (the wire carries the
				// origin tag; delegationDepth has no remote field)
				if (row.origin === "subagent") continue
				const id = typeof row.sessionId === "string" ? row.sessionId : ""
				if (!id) continue
				const updatedAt = typeof row.updatedAt === "number" ? String(row.updatedAt) : ""
				if (cutoff > 0 && updatedAt && Number(updatedAt) < cutoff) continue
				const projections = (row.projections ?? {}) as Record<string, unknown>
				const values = (projections.values ?? {}) as Record<string, unknown>
				const title = typeof values.title === "string" ? values.title : ""
				out.push({
					id,
					title: title.slice(0, 40),
					...(updatedAt ? { updatedAt } : {}),
					// G1 resume-picker: pass-through display fields — the wire may
					// not carry them (older hosts); absent stays absent and the
					// view fails open on both.
					...(typeof row.cwd === "string" && row.cwd ? { cwd: row.cwd } : {}),
					...(typeof row.sizeBytes === "number" && Number.isFinite(row.sizeBytes) ? { sizeBytes: row.sizeBytes } : {}),
				})
			}
			return out.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))).slice(0, limit)
		} catch {
			return []
		}
	}

	/**
	 * The full journal of one session (row 14 + tail gap repair): the follow
	 * opening snapshot's records, then backwards `session/page` fills until
	 * the journal is exhausted or `sinceSeq` is reached. Oldest-first.
	 */
	async fetchJournal(sessionId: string, options: { sinceSeq?: number } = {}): Promise<RemoteJournalEntry[]> {
		const opening = await this.#followSnapshot(sessionId)
		const entries = this.#recordsOf(opening.snapshot)
		const cursor = opening.cursor
		let hasMore = opening.hasMore
		for (let guard = 0; hasMore && guard < 200; guard++) {
			const lowest = entries.length > 0 ? Math.min(...entries.map((e) => e.seq)) : cursor + 1
			if (options.sinceSeq !== undefined && lowest <= options.sinceSeq) break
			const page = await this.page(sessionId, cursor, lowest)
			const pageRecords = page.records
			if (pageRecords.length === 0) break
			entries.push(...pageRecords)
			hasMore = page.hasMore
			const newLowest = Math.min(...pageRecords.map((e) => e.seq))
			if (newLowest >= lowest) break // no forward progress; stop
		}
		return sortJournal(entries)
	}

	/**
	 * One backwards `session/page` (raw): records with seq < beforeSeq, cut at
	 * the inclusive `throughSeq` journal position. Public for the tail's gap
	 * repair; `beforeSeq` omission starts at the top of the journal.
	 */
	async page(sessionId: string, throughSeq: number, beforeSeq?: number): Promise<{ records: RemoteJournalEntry[]; hasMore: boolean }> {
		const value = (await this.#rpc("session/page", {
			request: {
				address: { kind: "session", sessionId },
				throughSeq,
				...(beforeSeq !== undefined ? { beforeSeq } : {}),
			},
		})) as { records?: unknown; hasMore?: unknown }
		return { records: this.#recordsOf(value), hasMore: value.hasMore === true }
	}

	/** Records for the missing seq span (tail gap repair), oldest-first. */
	async pageSpan(sessionId: string, fromExclusive: number, throughSeq: number): Promise<RemoteJournalEntry[]> {
		const out: RemoteJournalEntry[] = []
		let before = throughSeq + 1
		for (let guard = 0; guard < 50; guard++) {
			const page = await this.page(sessionId, throughSeq, before)
			const entries = page.records.filter((e) => e.seq > fromExclusive && e.seq <= throughSeq)
			out.push(...entries)
			if (!page.hasMore || entries.length === 0) break
			const lowest = Math.min(...entries.map((e) => e.seq))
			if (lowest <= fromExclusive + 1) break
			before = lowest
		}
		return sortJournal(out)
	}

	/** Stored transcript rows (row 14; host-session.storedTranscript parity,
	 * plus the ask_user_question Q&A rows from the durable tool pair).
	 *
	 * Errors PROPAGATE (2026-11-10 transcript-loss fix): the old
	 * `catch → []` turned any transient host/RPC failure into "this session
	 * has no history", and the transcript's full-replace hydrate then wiped
	 * every visible row. An empty journal is still an empty array; a failed
	 * read is an error the caller decides about (SeamRows.load keeps its rows,
	 * sessionInfo/btw degrade to their own defaults). */
	async storedTranscript(id: string, skip = 0): Promise<StoredTranscriptRow[]> {
		return journalToTranscriptRows(await this.fetchJournal(id), skip)
	}

	/** Full-text search (row 19; host-session.searchSessions parity). */
	async searchSessions(query: string): Promise<{ id: string; snippet: string }[]> {
		try {
			const value = (await this.#rpc("session/search", { request: { query } })) as { items?: unknown }
			const items = Array.isArray(value.items) ? value.items : []
			return items
				.map((it) => {
					const row = (typeof it === "object" && it !== null ? it : {}) as Record<string, unknown>
					return {
						id: typeof row.sessionId === "string" ? row.sessionId : "",
						snippet: String(row.snippet ?? "").replace(/\s+/g, " ").slice(0, 80),
					}
				})
				.filter((it) => it.id)
		} catch {
			return []
		}
	}

	/** Rename (row 20): normalized title + the durable seq that committed it. */
	async rename(sessionId: string, title: string): Promise<{ title: string; seq: number }> {
		const value = (await this.#rpc("session/rename", { request: { sessionId, title } })) as Record<string, unknown>
		return {
			title: typeof value.title === "string" ? value.title : title,
			seq: typeof value.seq === "number" ? value.seq : 0,
		}
	}

	/**
	 * Fork (row 18): seed a NEW session with the parent's event prefix.
	 * `atSeq` is the exact inclusive source seq (historyTurns' seqEnd);
	 * omission selects the latest completed-turn prefix. Returns the new id.
	 */
	async fork(sessionId: string, atSeq?: number): Promise<string> {
		const value = (await this.#rpc("session/fork", {
			request: { sessionId, ...(atSeq !== undefined ? { atSeq } : {}) },
		})) as Record<string, unknown>
		const forked = typeof value.sessionId === "string" ? value.sessionId : ""
		if (!forked) throw new Error("session/fork returned no sessionId")
		return forked
	}

	/** Human-invocable skills of one session's composition (row 27). */
	async skillsList(sessionId: string): Promise<{ name: string; description: string; invocation: string }[]> {
		try {
			const value = (await this.#rpc("skills/list", { request: { sessionId } })) as { skills?: unknown }
			const skills = Array.isArray(value.skills) ? value.skills : []
			return skills
				.map((s) => {
					const row = (typeof s === "object" && s !== null ? s : {}) as Record<string, unknown>
					return {
						name: String(row.name ?? ""),
						description: String(row.description ?? "").slice(0, 90),
						// the slash form is the human invocation on this wire
						invocation: `/${String(row.name ?? "")}`,
					}
				})
				.filter((s) => s.name)
		} catch {
			return []
		}
	}

	/** Host slash commands (row 26) — agent-scoped; [] without a session. */
	async commandsList(sessionId: string): Promise<{ name: string; description: string }[]> {
		try {
			const list = (await this.#rpc("commands/list", { agentId: sessionId })) as unknown
			return (Array.isArray(list) ? list : [])
				.map((c) => {
					const row = (typeof c === "object" && c !== null ? c : {}) as Record<string, unknown>
					return { name: String(row.name ?? ""), description: String(row.description ?? "") }
				})
				.filter((c) => c.name)
		} catch {
			return []
		}
	}

	/** Execute one host slash command line (row 26). */
	async commandsExecute(sessionId: string, line: string): Promise<{ text?: string } | undefined> {
		const value = (await this.#rpc("commands/execute", { agentId: sessionId, line, submittedAttachments: [] })) as
			| Record<string, unknown>
			| undefined
		if (!value || typeof value !== "object") return {}
		const result = (value.result ?? {}) as Record<string, unknown>
		const text = result.text
		return text ? { text: String(text).slice(0, 300) } : {}
	}

	/**
	 * One follow opening snapshot WITHOUT the assistant presentation stream
	 * (reads only — the page/follow snapshot parity of row 14 and the tail).
	 * The stream closes as soon as the snapshot arrives (the journal tail
	 * beyond the cursor arrives via `session/page`, not this socket).
	 */
	#followSnapshot(sessionId: string): Promise<{ snapshot: Record<string, unknown>; cursor: number; hasMore: boolean }> {
		return new Promise((resolve, reject) => {
			let settled = false
			const handle = openRemoteStream(
				this.#socketFactory,
				"session/follow",
				{ request: { address: { kind: "session", sessionId } } },
				{
					onItem: (value) => {
						if (settled) return
						settled = true
						handle.close()
						const snapshot = (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>
						resolve({
							snapshot,
							cursor: typeof snapshot.cursor === "number" ? snapshot.cursor : 0,
							hasMore: snapshot.hasMore === true,
						})
					},
					onEnd: () => {
						if (!settled) {
							settled = true
							reject(new Error("session/follow ended before its opening snapshot"))
						}
					},
					onFailed: (error) => {
						if (!settled) {
							settled = true
							reject(error)
						}
					},
				},
			)
		})
	}

	#recordsOf(frame: Record<string, unknown>): RemoteJournalEntry[] {
		const records = Array.isArray(frame.records) ? frame.records : []
		const out: RemoteJournalEntry[] = []
		for (const record of records) {
			const entry = (typeof record === "object" && record !== null ? record : {}) as Record<string, unknown>
			if (entry.type !== "event") continue
			const event = (typeof entry.event === "object" && entry.event !== null ? entry.event : {}) as Record<string, unknown>
			out.push({
				type: String(event.type ?? ""),
				seq: typeof event.seq === "number" ? event.seq : 0,
				time: typeof event.time === "number" ? event.time : 0,
				data: (typeof event.data === "object" && event.data !== null && !Array.isArray(event.data) ? event.data : {}) as Record<string, unknown>,
			})
		}
		return out
	}
}

// ---------------------------------------------------------------------------
// Remote tail (row 17) — read-only watch of a foreign session
// ---------------------------------------------------------------------------

export interface RemoteTailOptions {
	ops: RemoteSessionOps
	/** Stream socket factory (the same mux the follow streams ride). */
	socketFactory: MuxSocketFactory
	/** The foreign session id to watch. */
	sessionId: string
	/** Row sink (the HostSession.remoteTailSink shape; FULL row set per flush). */
	sink(rows: { kind: string; text: string; final: boolean }[]): void
	/** Connection state source for re-attach scheduling. */
	connectionState(): "connecting" | "connected" | "disconnected"
	onStateChange(listener: (state: "connecting" | "connected" | "disconnected") => void): () => void
	/** Retry cadence for re-attach attempts (default 1s). */
	retryMs?: number
}

/**
 * Read-only follow of a session another surface drives (row 17; strictly
 * better than the zstd CLI poll it replaces): durable rows replay from the
 * opening snapshot, live durable events stream in, and a transport loss
 * repairs the gap from `session/page` before resuming. The watch keeps
 * re-attaching (retry cadence, plus immediately when the connection reports
 * `connected` again) until `stop()`. Every flush hands the FULL accumulated
 * row set to the sink (ShellHost's sink replaces the transcript view — the
 * in-process tail's whole-suffix replay parity).
 */
export class RemoteTailSession {
	readonly #options: RemoteTailOptions
	#rows: { kind: string; text: string; final: boolean }[] = []
	#lastSeq = -1
	#closeStateListener: (() => void) | undefined
	#retryTimer: ReturnType<typeof setTimeout> | undefined
	#pumpHandle: { close(): void } | undefined
	#stopped = false

	constructor(options: RemoteTailOptions) {
		this.#options = options
	}

	/**
	 * Open the follow and replay the durable prefix. Resolves once the
	 * replay is flushed and the live pump is open (the watch continues in
	 * the background until `stop()`); rejects on first-open failure.
	 */
	async start(): Promise<void> {
		this.#stopped = false
		this.#closeStateListener = this.#options.onStateChange((state) => {
			if (state === "connected") this.#scheduleReattach(0)
		})
		await this.#replayFresh()
		this.#pump()
	}

	stop(): void {
		this.#stopped = true
		if (this.#retryTimer !== undefined) {
			clearTimeout(this.#retryTimer)
			this.#retryTimer = undefined
		}
		this.#closeStateListener?.()
		this.#closeStateListener = undefined
		this.#pumpHandle?.close()
		this.#pumpHandle = undefined
	}

	async #replayFresh(): Promise<void> {
		const opening = await this.#options.ops.fetchJournal(this.#options.sessionId, { sinceSeq: this.#lastSeq })
		const fresh = sortJournal(opening.filter((e) => e.seq > this.#lastSeq))
		if (this.#lastSeq >= 0 && fresh.length > 0) {
			// Gap repair: the snapshot window may not reach back to the last
			// seq we showed — page explicitly for the missing middle.
			const oldest = fresh[0]!.seq
			if (oldest > this.#lastSeq + 1) {
				const gap = await this.#options.ops.pageSpan(this.#options.sessionId, this.#lastSeq, oldest - 1)
				fresh.unshift(...gap.filter((e) => !fresh.some((f) => f.seq === e.seq)))
			}
		}
		if (fresh.length === 0) return
		for (const entry of fresh) if (entry.seq > this.#lastSeq) this.#lastSeq = entry.seq
		this.#rows.push(...tailRowsFromEntries(fresh))
		this.#flush()
	}

	/** Live durable events until the stream dies; then schedule the next cycle. */
	#pump(): void {
		let settled = false
		const done = () => {
			if (settled) return
			settled = true
			this.#pumpHandle = undefined
			this.#scheduleReattach(this.#options.retryMs ?? 1_000)
		}
		this.#pumpHandle = openRemoteStream(
			this.#options.socketFactory,
			"session/follow",
			{ request: { address: { kind: "session", sessionId: this.#options.sessionId } } },
			{
				onItem: (value) => {
					if (this.#stopped) return
					const frame = (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>
					if (frame.type !== "event") return // snapshot window already replayed
					const event = (typeof frame.event === "object" && frame.event !== null ? frame.event : {}) as Record<string, unknown>
					const entry: RemoteJournalEntry = {
						type: String(event.type ?? ""),
						seq: typeof event.seq === "number" ? event.seq : 0,
						time: typeof event.time === "number" ? event.time : 0,
						data: (typeof event.data === "object" && event.data !== null && !Array.isArray(event.data) ? event.data : {}) as Record<string, unknown>,
					}
					if (entry.seq > this.#lastSeq) {
						this.#lastSeq = entry.seq
						this.#rows.push(...tailRowsFromEntries([entry]))
						this.#flush()
					}
				},
				onEnd: () => done(),
				onFailed: () => done(),
			},
		)
	}

	#scheduleReattach(ms: number): void {
		if (this.#stopped || this.#retryTimer !== undefined) return
		this.#retryTimer = setTimeout(() => {
			this.#retryTimer = undefined
			if (this.#stopped) return
			void this.#replayFresh()
				.then(() => this.#pump())
				.catch(() => this.#scheduleReattach(this.#options.retryMs ?? 1_000))
		}, ms)
		this.#retryTimer.unref?.()
	}

	#flush(): void {
		if (this.#rows.length > 0 && !this.#stopped) this.#options.sink([...this.#rows])
	}
}
