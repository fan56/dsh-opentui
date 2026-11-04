/**
 * `session/follow` consumption for the client-mode session layer (ADR-0005
 * bucket (b) wave 1; audit rows 2–6 + 34).
 *
 * One durable session log, streamed live: the opening `snapshot` frame
 * (header + records + cursor + optional process-local assistant baseline)
 * followed by `{type:'event'}` durable frames and — with
 * `assistantStream:true` — `{type:'assistant-stream'}` presentation frames.
 * This module owns the frame pump and maps everything onto the SAME callback
 * shapes the in-process `HostSession` feeds ShellHost with:
 *
 * - `text-delta` / `reasoning-delta` chunks → content/thinking deltas
 *   (host-session.ts:1247-1252 parity).
 * - `usage` chunks → the TokenUsage numeric scan of host-session.ts:1263-1272
 *   (`{inputTokens,outputTokens,cacheReadTokens?,cacheWriteTokens?}` — the
 *   same numeric max() scan covers adapter field-name variance).
 * - durable `tool/call` → onToolStart; durable `tool/result` → onToolRun with
 *   the image-path extraction parity of host-session.ts:1330-1343.
 * - durable `todo/write` → onTodos (whole-list snapshot semantics).
 * - durable `turn/end` → onTurnEnd (+ onError for `reason.kind === "error"`).
 * - snapshot records on a RE-attach → onMissedRows rows (the wake-diff
 *   callback shape) plus todo/tool ledger refill, and an active attempt's
 *   compact stream replays as deltas — resuming CLEAN at the dense chunk
 *   index the live stream already consumed (wave-2 delta-dedupe; wave 1
 *   replayed the whole accumulated attempt text and duplicated the pre-gap
 *   content).
 * - every durable journal record (live and snapshot) also reaches the
 *   optional `onRecord` hook with its seq envelope — the seq-bearing surface
 *   the /history turn grouping, fork-at-turn (`session/fork.atSeq`) and the
 *   tail's journal-gap repair need (wave 2; wave 1 exposed data payloads
 *   only).
 *
 * Wire facts this relies on (installed closure, dsh 0.2.1-rc.5):
 * - `dsh-api-session-controller/lib/types/types.d.ts`: SessionFollowRequest /
 *   SessionFollowFrame / SessionAssistantStreamFrame / SessionWireEvent.
 * - `dsh-session/lib/types/types.d.ts`: SessionEventMap (`tool/call`,
 *   `tool/result`, `turn/end`, `user/message`, `assistant/message`).
 * - `dsh-tool-todo/lib/types/types.d.ts`: `todo/write {todos: TodoItem[]}`.
 * - `dsh-llm/lib/types/types.d.ts`: StreamChunk, TokenUsage.
 * - `dsh-llm/lib/types/assistant-stream.d.ts`: AssistantStreamRecord (the
 *   compact detached stream of a reconnect baseline).
 */

import type { MuxSocketFactory } from "./events-source.ts"
import { openRemoteStream, type RemoteStreamHandle } from "./remote-stream.ts"

/** The session wire header of the opening snapshot (`SessionWireHeader`). */
export interface RemoteFollowHeader {
	id: string
	cwd?: string
	agentPreset?: string
}

/** What attaching to one session's follow stream reported. */
export interface RemoteFollowOpening {
	header: RemoteFollowHeader
	/** Inclusive durable log cut of the snapshot (for `session/page` wave 2). */
	cursor: number
	hasMore: boolean
	/** True when the host reports a live assistant attempt at attach time. */
	activeAttempt: boolean
}

/** Todo list snapshot item (`TodoItem` — the exact TurnCallbacks.onTodos shape). */
export interface RemoteTodoItem {
	content: string
	status: "pending" | "in_progress" | "completed"
}

/** One transcript row replayed after a re-attach (the wake-diff row shape). */
export interface RemoteTranscriptRow {
	kind: "user" | "assistant"
	text: string
}

/** Tool result callback payload — `ToolRun` plus the optional image path. */
export interface RemoteToolRun {
	name: string
	argsPretty: string
	output: string
	ok: boolean
	callId?: string
	imagePath?: string
}

/** One durable journal record (`SessionWireEvent` subset): type + seq envelope. */
export interface RemoteJournalEntry {
	type: string
	seq: number
	time: number
	data: Record<string, unknown>
}

/** Callbacks the session layer registers (shapes mirror TurnCallbacks). */
export interface RemoteFollowSink {
	onContentDelta(text: string): void
	onThinkingDelta(text: string): void
	/** Raw `usage` chunk payload (TokenUsage-shaped JSON; numeric-scan applied here). */
	onUsage(usage: { prompt: number; completion: number; cacheRead: number; cacheWrite: number }): void
	onToolStart(start: { callId?: string; name: string; args: string }): void
	onToolRun(run: RemoteToolRun): void
	onTodos(todos: RemoteTodoItem[]): void
	/** Raw durable `turn/end` data (`{turn, reason}`); the session layer settles. */
	onTurnEnd(data: Record<string, unknown>): void
	/** Transcript rows recovered from a re-attach snapshot. */
	onMissedRows(rows: RemoteTranscriptRow[]): void
	/**
	 * Every durable journal record, live or snapshot, with its seq envelope
	 * (optional — wave-2 widening: the seq is what /history grouping,
	 * fork-at-turn and the tail's gap repair need; data payloads alone
	 * cannot address a fork point).
	 */
	onRecord?(entry: RemoteJournalEntry): void
}

export interface RemoteFollowOptions {
	socketFactory: MuxSocketFactory
	sink: RemoteFollowSink
	/** Called when the follow stream dies without a protocol end (transport loss). */
	onDetached(): void
}

interface AssistantStreamFrameStart {
	type: "start"
	attemptId: string
	revision: number
	turn: number
	step: number
}

interface AssistantStreamFrameChunk {
	type: "chunk"
	attemptId: string
	index: number
	chunk: Record<string, unknown>
}

interface AssistantStreamFrameEnd {
	type: "end"
	attemptId: string
	outcome: Record<string, unknown>
}

/** Convert one compact `AssistantStreamRecord[]` into (type, text) delta pairs. */
export function expandCompactStream(records: unknown[]): { kind: "text" | "reasoning"; text: string }[] {
	return expandCompactStreamIndexed(records).map(({ kind, text }) => ({ kind, text }))
}

/** One compact-stream delta with its dense stream position (when recorded). */
export interface CompactStreamDelta {
	kind: "text" | "reasoning"
	text: string
	/** Dense chunk index this delta occupies (the live frame's `index` space). */
	denseIndex?: number
}

/**
 * Per-delta expansion of one compact `AssistantStreamRecord[]`, keeping each
 * chunk's dense index: `text-chunks`/`reasoning-chunks` records spread their
 * `texts` across `index .. index + texts.length - 1`, bare `chunk` records
 * carry the chunk's own index. The reconnect replay filters on this to
 * resume clean at the dense position the live stream already consumed.
 */
export function expandCompactStreamIndexed(records: unknown[]): CompactStreamDelta[] {
	const out: CompactStreamDelta[] = []
	if (!Array.isArray(records)) return out
	for (const record of records) {
		const r = record as Record<string, unknown> | null
		if (!r) continue
		if (r.type === "text-chunks" || r.type === "reasoning-chunks") {
			const texts = Array.isArray(r.texts) ? r.texts : []
			const base = typeof r.index === "number" ? r.index : undefined
			texts.forEach((t, i) => {
				const text = typeof t === "string" ? t : ""
				if (!text) return
				const delta: CompactStreamDelta = { kind: r.type === "text-chunks" ? "text" : "reasoning", text }
				if (base !== undefined) delta.denseIndex = base + i
				out.push(delta)
			})
		} else if (r.type === "chunk") {
			const chunk = r.chunk as Record<string, unknown> | undefined
			const text = typeof chunk?.text === "string" ? chunk.text : ""
			const index = typeof chunk?.index === "number" ? chunk.index : undefined
			if (text && chunk?.type === "text-delta") out.push(index !== undefined ? { kind: "text", text, denseIndex: index } : { kind: "text", text })
			if (text && chunk?.type === "reasoning-delta") out.push(index !== undefined ? { kind: "reasoning", text, denseIndex: index } : { kind: "reasoning", text })
		}
	}
	return out
}

/** The host-session.ts:1263-1272 numeric scan applied to one usage chunk. */
export function scanUsageChunk(chunk: Record<string, unknown>): {
	prompt: number
	completion: number
	cacheRead: number
	cacheWrite: number
} {
	const u = (chunk.usage ?? {}) as Record<string, unknown>
	const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
	return {
		prompt: Math.max(num(u.promptTokens), num(u.inputTokens), num(u.prompt_tokens)),
		completion: Math.max(num(u.completionTokens), num(u.outputTokens), num(u.completion_tokens)),
		cacheRead: Math.max(num(u.cacheReadTokens), num(u.cache_read_tokens), num(u.cacheRead)),
		cacheWrite: Math.max(num(u.cacheWriteTokens), num(u.cache_write_tokens), num(u.cacheWrite)),
	}
}

/** Concatenated text of the text blocks in a message content array (parity). */
export function blocksText(content: unknown): string {
	if (!Array.isArray(content)) return ""
	let text = ""
	for (const block of content) {
		const typed = block as { type?: unknown; text?: unknown } | null
		if (typed?.type === "text" && typeof typed.text === "string") {
			text += (text === "" ? "" : "\n") + typed.text
		}
	}
	return text.trim()
}

/**
 * The live `session/follow` stream for ONE session id: attach, keep the
 * ledger (tool call args, active attempt baseline), and fold every frame
 * into the sink. Detaches on transport loss (`onDetached`) so the session
 * layer can re-attach after the connection generation changes.
 */
export class RemoteFollowSession {
	readonly #options: RemoteFollowOptions
	#sessionId: string | undefined
	#stream: RemoteStreamHandle | undefined
	#toolCalls = new Map<string, { name: string; args: string }>()
	/**
	 * callIds already announced through onToolStart (live or replay). The
	 * re-attach baseline filter is the primary dedupe (P1#1); this set is the
	 * belt-and-braces: a replayed snapshot record above the baseline whose
	 * call was somehow already painted never announces twice.
	 */
	#announcedToolCalls = new Set<string>()
	#activeAttemptId: string | undefined
	/** Dense chunk index the next live frame is expected at (re-attach baseline). */
	#attemptBaseline = 0
	/**
	 * Attempt id + dense watermark of the chunks this client already PAINTED
	 * from the live stream. Survives a detach so the next attach's compact
	 * replay resumes at exactly that position (wave-2 delta-dedupe).
	 */
	#liveAttemptId: string | undefined
	#liveWatermark = 0
	#attached = false

	constructor(options: RemoteFollowOptions) {
		this.#options = options
	}

	get sessionId(): string | undefined {
		return this.#sessionId
	}

	get attached(): boolean {
		return this.#attached
	}

	/**
	 * Open the follow stream and await its opening snapshot. `replay` selects
	 * re-attach semantics: snapshot records fold into missed rows + ledger
	 * refill and an active attempt's compact stream replays as deltas. A
	 * first attach (right after `session/create`) passes `replay: false` —
	 * the snapshot is empty or belongs to a transcript the caller paints
	 * through the dedicated wave-2 page path.
	 *
	 * `sinceSeq` is the re-attach replay baseline (P1#1): the highest durable
	 * seq this client already painted before the gap. Snapshot records at or
	 * below it are already on every ledger (tool-call ledger + the caller's
	 * journal arrived live pre-gap) and are skipped ENTIRELY — never
	 * re-announced, never replayed as missed rows, never re-journaled (a
	 * full-window re-fold used to double-paint user/assistant rows and
	 * re-announce every tool call after a reconnect).
	 */
	async attach(sessionId: string, replay: boolean, sinceSeq?: number): Promise<RemoteFollowOpening> {
		this.detach()
		this.#sessionId = sessionId
		const opening = await new Promise<Record<string, unknown>>((resolve, reject) => {
			let settled = false
			const handle = openRemoteStream(
				this.#options.socketFactory,
				"session/follow",
				{
					request: {
						address: { kind: "session", sessionId },
						assistantStream: true,
					},
				},
				{
					onItem: (value) => {
						if (settled) {
							this.#dispatch(value)
							return
						}
						settled = true
						resolve(asRecord(value))
					},
					onEnd: () => {
						this.#attached = false
						if (!settled) {
							settled = true
							reject(new Error("session/follow ended before its opening snapshot"))
						}
					},
					onFailed: (error) => {
						this.#attached = false
						this.#stream = undefined
						if (!settled) {
							settled = true
							reject(error)
						} else {
							this.#options.onDetached()
						}
					},
				},
			)
			this.#stream = handle
		})

		if (opening.type !== "snapshot") {
			throw new Error(`session/follow opening frame must be a snapshot, got: ${String(opening.type)}`)
		}
		const header = asRecord(opening.header)
		const cursor = typeof opening.cursor === "number" ? opening.cursor : 0
		const hasMore = opening.hasMore === true
		const baseline = asRecord(opening.assistantStream)
		const attempt = asRecord(baseline.activeAttempt)

		// Ledger refill on every attach: tool/result name lookup needs the
		// tool/call args of calls made before (re)attach.
		this.#foldSnapshotRecords(opening.records, replay, sinceSeq)

		if (replay && attempt && typeof attempt.attemptId === "string") {
			// Re-attach repair: replay the compact stream accumulated while we
			// were away, resuming CLEAN at the dense position the live stream
			// already painted before the gap (wave-2 dedupe). Chunks without a
			// recorded index are unreplayable precisely — emit them only when
			// nothing was streamed live (wave-1 whole-replay behavior).
			const watermark = attempt.attemptId === this.#liveAttemptId ? this.#liveWatermark : 0
			for (const delta of expandCompactStreamIndexed(Array.isArray(attempt.stream) ? attempt.stream : [])) {
				if (delta.denseIndex !== undefined ? delta.denseIndex < watermark : watermark > 0) continue
				if (delta.kind === "text") this.#options.sink.onContentDelta(delta.text)
				else this.#options.sink.onThinkingDelta(delta.text)
			}
		}
		if (attempt && typeof attempt.attemptId === "string") {
			this.#activeAttemptId = attempt.attemptId
			this.#attemptBaseline = typeof attempt.nextIndex === "number" ? attempt.nextIndex : 0
		} else {
			this.#activeAttemptId = undefined
			this.#attemptBaseline = 0
		}
		this.#attached = true
		return {
			header: {
				id: String(header.id ?? sessionId),
				...(typeof header.cwd === "string" ? { cwd: header.cwd } : {}),
				...(typeof header.agentPreset === "string" ? { agentPreset: header.agentPreset } : {}),
			},
			cursor,
			hasMore,
			activeAttempt: this.#activeAttemptId !== undefined,
		}
	}

	/** Drop the stream (keeping the ledger for the same session's re-attach). */
	detach(): void {
		this.#stream?.close()
		this.#stream = undefined
		this.#attached = false
		this.#activeAttemptId = undefined
		this.#attemptBaseline = 0
		// #liveAttemptId/#liveWatermark survive: they are the dedupe baseline
		// the next attach's compact replay resumes from.
	}

	/**
	 * The recorded tool/call arguments for one call id — the approval
	 * waterfall's args display (client-side parity with host-session.ts's
	 * `#lookupCallArgs` log walk; the follow ledger replaces it).
	 */
	toolArgs(callId: string): string | undefined {
		return this.#toolCalls.get(String(callId))?.args
	}

	/** Forget the session ledger entirely (fresh session next turn). */
	reset(): void {
		this.detach()
		this.#sessionId = undefined
		this.#toolCalls.clear()
		this.#announcedToolCalls.clear()
		this.#liveAttemptId = undefined
		this.#liveWatermark = 0
	}

	#dispatch(value: unknown): void {
		const frame = asRecord(value)
		if (frame.type === "event") {
			const event = asRecord(frame.event)
			const entry: RemoteJournalEntry = {
				type: String(event.type ?? ""),
				seq: typeof event.seq === "number" ? event.seq : 0,
				time: typeof event.time === "number" ? event.time : 0,
				data: asRecord(event.data),
			}
			this.#options.sink.onRecord?.(entry)
			this.#durableEvent(entry.type, entry.data)
		} else if (frame.type === "assistant-stream") {
			this.#assistantStreamFrame(asRecord(frame.frame))
		}
		// A second snapshot frame mid-stream is not part of the protocol; ignore.
	}

	#assistantStreamFrame(frame: Record<string, unknown>): void {
		if (frame.type === "start") {
			const f = frame as unknown as AssistantStreamFrameStart
			this.#activeAttemptId = f.attemptId
			this.#attemptBaseline = 0
			this.#liveAttemptId = f.attemptId
			this.#liveWatermark = 0
			return
		}
		if (frame.type === "chunk") {
			const f = frame as unknown as AssistantStreamFrameChunk
			if (this.#activeAttemptId === undefined || f.attemptId !== this.#activeAttemptId) return
			if (typeof f.index === "number" && f.index < this.#attemptBaseline) return
			if (typeof f.index === "number" && f.index >= this.#liveWatermark) this.#liveWatermark = f.index + 1
			this.#streamChunk(f.chunk)
			return
		}
		if (frame.type === "end") {
			const f = frame as unknown as AssistantStreamFrameEnd
			if (this.#activeAttemptId === f.attemptId) {
				this.#activeAttemptId = undefined
				this.#attemptBaseline = 0
				this.#liveAttemptId = undefined
				this.#liveWatermark = 0
			}
		}
	}

	#streamChunk(chunkValue: unknown): void {
		const chunk = asRecord(chunkValue)
		const type = String(chunk.type ?? "")
		if (type === "text-delta" && typeof chunk.text === "string" && chunk.text) {
			this.#options.sink.onContentDelta(chunk.text)
		} else if (type === "reasoning-delta" && typeof chunk.text === "string" && chunk.text) {
			this.#options.sink.onThinkingDelta(chunk.text)
		} else if (type === "usage") {
			this.#options.sink.onUsage(scanUsageChunk(chunk))
		}
		// tool-call-delta / block-* / finish are tool plumbing and stream
		// bookkeeping — the rendered tool blocks come from the durable
		// tool/call + tool/result events (host-session.ts:1273-1277 parity).
	}

	#foldSnapshotRecords(recordsValue: unknown, replay: boolean, sinceSeq?: number): void {
		if (!Array.isArray(recordsValue)) return
		const rows: RemoteTranscriptRow[] = []
		for (const record of recordsValue) {
			const entry = asRecord(record)
			if (entry.type !== "event") continue
			const event = asRecord(entry.event)
			const type = String(event.type ?? "")
			const data = asRecord(event.data)
			const seq = typeof event.seq === "number" ? event.seq : 0
			// Re-attach baseline (P1#1): at/below the already-painted watermark
			// the record is on every ledger from the live stream — skip it
			// whole (no re-journal, no row, no announce).
			if (sinceSeq !== undefined && seq > 0 && seq <= sinceSeq) continue
			// Seq envelope first — the ledger is current before any row/settle
			// callback reads it.
			this.#options.sink.onRecord?.({
				type,
				seq,
				time: typeof event.time === "number" ? event.time : 0,
				data,
			})
			if (type === "user/message") {
				const source = asRecord(data.source)
				const kind = source.kind
				if (kind !== undefined && kind !== "user") continue
				const text = blocksText(data.content)
				if (text && replay) rows.push({ kind: "user", text })
			} else if (type === "assistant/message") {
				const message = asRecord(data.message)
				const text = blocksText(message.content)
				if (text && replay) rows.push({ kind: "assistant", text })
			} else if (type === "tool/call") {
				this.#toolCallEvent(data, replay)
			} else if (type === "tool/result") {
				if (replay) this.#toolResultEvent(data)
			} else if (type === "todo/write") {
				this.#options.sink.onTodos(this.#todoList(data))
			}
			// turn/end inside a snapshot is settled history — never settles a
			// live await (only live event frames settle turns).
		}
		if (rows.length > 0) this.#options.sink.onMissedRows(rows)
	}

	#durableEvent(type: string, data: Record<string, unknown>): void {
		if (type === "tool/call") {
			this.#toolCallEvent(data, true)
		} else if (type === "todo/write") {
			this.#options.sink.onTodos(this.#todoList(data))
		} else if (type === "tool/result") {
			this.#toolResultEvent(data)
		} else if (type === "turn/end") {
			this.#options.sink.onTurnEnd(data)
		}
		// Live user/message + assistant/message are NOT repainted (the deltas
		// already painted them; ShellHost pushes the prompt row itself) —
		// host-session.ts live-path parity.
	}

	#toolCallEvent(data: Record<string, unknown>, announce: boolean): void {
		const callId = data.callId === undefined ? undefined : String(data.callId)
		const name = String(data.name ?? "tool")
		const args = String(data.arguments ?? "")
		if (callId) this.#toolCalls.set(callId, { name, args })
		if (announce) {
			// Belt-and-braces dedupe (P1#1): one call paints one tool block,
			// whatever path replays it (the baseline filter is the primary
			// guard; this catches baseline-miss cases keyed by callId).
			if (callId !== undefined && this.#announcedToolCalls.has(callId)) return
			if (callId !== undefined) this.#announcedToolCalls.add(callId)
			this.#options.sink.onToolStart({
				...(callId ? { callId } : {}),
				name,
				args,
			})
		}
	}

	#toolResultEvent(data: Record<string, unknown>): void {
		const message = asRecord(data.message)
		const callId = data.callId !== undefined ? String(data.callId) : message.toolCallId !== undefined ? String(message.toolCallId) : undefined
		const known = callId ? this.#toolCalls.get(callId) : undefined
		const brief = JSON.stringify(data.output ?? data).slice(0, 300)
		// ok parity: host-session checks data.isError; the 0.2.1 wire carries
		// isError on the ToolResultMessage — accept both placements.
		const ok = data.isError !== true && message.isError !== true
		const run: RemoteToolRun = {
			name: known?.name ?? "tool",
			argsPretty: known?.args ?? "",
			output: brief,
			ok,
			...(callId ? { callId } : {}),
		}
		const imagePath = this.#imagePathOf(data, message)
		if (typeof imagePath === "string") run.imagePath = imagePath
		this.#options.sink.onToolRun(run)
	}

	/**
	 * Image-path extraction parity with host-session.ts:1330-1343: the image
	 * content block renders as a picture in the tool panel; the host tool
	 * result carries the file path in a sibling `<path>` text block.
	 */
	#imagePathOf(data: Record<string, unknown>, message: Record<string, unknown>): unknown {
		const content = (data.content ?? message.content ?? []) as unknown[]
		if (!Array.isArray(content)) return undefined
		const typed = content as Record<string, unknown>[]
		const imageBlock = typed.find((c) => c?.type === "image")
		const pathMatch = /<path>([^<]+)<\/path>/.exec(
			String(typed.find((c) => c?.type === "text")?.text ?? ""),
		)
		return (typeof imageBlock?.source === "string" ? imageBlock.source : undefined)
			?? imageBlock?.path
			?? imageBlock?.file_path
			?? imageBlock?.url
			?? (imageBlock ? pathMatch?.[1] : undefined)
	}

	#todoList(data: Record<string, unknown>): RemoteTodoItem[] {
		const todos = Array.isArray(data.todos) ? data.todos : []
		return todos.map((t) => {
			const item = asRecord(t)
			const status = item.status === "in_progress" || item.status === "completed" ? item.status : "pending"
			return { content: String(item.content ?? ""), status }
		})
	}
}

/** The `reason.kind === "error"` message of a turn/end, when present. */
export function turnEndErrorMessage(data: Record<string, unknown>): string | undefined {
	const reason = asRecord(data.reason)
	if (reason.kind !== "error") return undefined
	const error = asRecord(reason.error)
	const message = error.message ?? reason.error
	return String(message ?? "turn error").slice(0, 300)
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
}
