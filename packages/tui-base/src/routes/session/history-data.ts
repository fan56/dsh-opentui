/**
 * /history turn data layer (gap C1, step 1 — the pure face, no TUI deps).
 *
 * dsh-tui-pi parity (src/history-turns.ts, src/history.ts): the /history
 * browser folds a session's journal into COMPLETED turns — one
 * `turn/start … turn/end` bracket per row of the left list — and serves the
 * right pane's detail, the `c`/Enter editor refill and the `f` fork slice
 * off the same fold.
 *
 * Input: the session journal as the shell client reads it
 * (remote-session-ops.ts `RemoteJournalEntry` shape — type/seq/time/data,
 * oldest-first; `fetchJournal(sessionId)` produces exactly this for ANY
 * session id, so the `s` session-switch face is the same fold over a
 * different journal). The entry type here is a STRUCTURAL slice: the shell's
 * journal records satisfy it as-is, no package dependency in either
 * direction.
 *
 * What the journal provides (verified against remote-session-ops.ts /
 * remote-follow.ts — nothing invented):
 *   - turn/start data.turn, turn/end data.reason.kind (+ reason.error.message),
 *     assistant/message data.interrupted, user/message data.source.kind,
 *     tool/call data.name/callId/arguments, tool/result data.callId (or
 *     message.toolCallId)/isError/output, and per-record `seq` + `time`
 *     (epoch ms) — tui-pi's SessionEvent fold has NO timestamps; the journal
 *     does, so turns carry them.
 *   - NOT in the journal: per-message token usage / model tags, and
 *     reasoning blocks (journalToTranscriptRows folds none either — the
 *     durable record is text blocks only).
 *
 * Copy/refill semantics (tui-pi turnPrimaryUserText): the refill text is the
 * turn's FIRST human prompt — userTexts[0] — and an injected-only turn (no
 * human prompt) yields `undefined` so a notice can never land in the editor.
 * One deliberate vocabulary divergence from tui-pi, documented where it
 * bites: tui-pi requires source.kind === 'user' for a human prompt, but the
 * opentui journal treats a user/message with NO source.kind as human-authored
 * too (journalToTranscriptRows, groupTurns and the follow replay all use
 * `kind === undefined || kind === 'user'`) — the fold follows the data's own
 * vocabulary, and the preview keeps tui-pi's fallback (first text of ANY
 * user/message kind) so injected-only turns still show a readable row.
 *
 * Everything here is pure and total: malformed records degrade ('' / dropped),
 * never throw — the same defensive posture as journalToTranscriptRows.
 */

/** Structural slice of one journal record (RemoteJournalEntry parity). */
export interface HistoryJournalEntry {
	type: string
	seq: number
	/** Epoch ms of the record (journal `time` field). */
	time: number
	data: Record<string, unknown>
}

/** One tool invocation inside a turn (call, paired with its result when settled). */
export interface HistoryToolCall {
	name: string
	/** Raw arguments JSON as logged ('' when the record carried none). */
	args: string
	/** isError mirror of the paired tool/result — undefined = no settled result. */
	ok?: boolean
	/** Result JSON-brief as logged (undefined = no settled result). */
	output?: string
}

/** One completed `turn/start … turn/end` bracket of a session journal. */
export interface HistoryTurn {
	/** The journal's turn number (`turn/start` data.turn). Row identity. */
	turn: number
	/** Seq of the `turn/start` record. */
	seqStart: number
	/** Seq of the closing `turn/end` record. Fork cut point (inclusive). */
	seqEnd: number
	/** `turn/end` reason kind (`completed`, `aborted`, `error`, …). */
	endReason: string
	/** Error message of an `error`-kind end, when the record carried one. */
	endError: string | undefined
	/** True when any assembled assistant message of the turn was interrupted. */
	interrupted: boolean
	/** Epoch ms of the `turn/start` record (undefined when unrecorded). */
	startTime: number | undefined
	/** Epoch ms of the `turn/end` record (undefined when unrecorded). */
	endTime: number | undefined
	/**
	 * Text of every human prompt in the turn, journal order — direct prompts,
	 * steer and follow-up messages alike (source kind `user` or untagged).
	 */
	userTexts: string[]
	/**
	 * One-line preview seed: the first human prompt's text, falling back to
	 * the first text of ANY user/message kind (an injected-only turn still
	 * gets a readable row). Whitespace as logged — clip at display time.
	 */
	previewText: string
	/** Text-bearing assistant message bodies, journal order (one per step). */
	assistantTexts: string[]
	/** Tool invocations, journal order (repeats included; result-paired). */
	toolCalls: HistoryToolCall[]
}

/** Mutable accumulator for one open turn bracket. */
interface OpenTurn {
	turn: number
	seqStart: number
	seqEnd: number
	endReason: string
	endError: string | undefined
	endTime: number | undefined
	startTime: number | undefined
	interrupted: boolean
	userEntries: Array<{ human: boolean; text: string }>
	assistantTexts: string[]
	toolCalls: HistoryToolCall[]
	/** callId → index into toolCalls, for pairing settled results (tui-pi
	 * counts names only; the journal's call/result pairing enriches the row
	 * with ok/output — the live transcript's own pairing vocabulary). */
	callIndex: Map<string, number>
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/**
 * Join the `text` blocks of a message content array into one trimmed string
 * (multi-block bodies join with newlines so copy stays faithful). Defensive
 * over the erased shape — a malformed record yields '' instead of throwing.
 */
function blocksText(content: unknown): string {
	if (!Array.isArray(content)) return ""
	let text = ""
	for (const block of content) {
		const typed = asRecord(block)
		if (typeof typed.text === "string" && typed.type === "text") {
			text += (text === "" ? "" : "\n") + typed.text
		}
	}
	return text.trim()
}

/** The `source.kind` authorship tag of a user/message record. */
function sourceKind(data: Record<string, unknown>): unknown {
	return asRecord(data.source).kind
}

/**
 * Fold a session journal into the completed turns, in log order (tui-pi
 * groupHistoryTurns parity). Unclosed brackets (the live turn still
 * streaming when the snapshot was taken) and records outside any bracket are
 * dropped; a new `turn/start` while one is open drops the never-closed one.
 * Journals arrive oldest-first (fetchJournal sorts); pages that arrived
 * newest-first must be sorted before this fold.
 */
export function groupHistoryTurns(entries: readonly HistoryJournalEntry[]): HistoryTurn[] {
	const turns: HistoryTurn[] = []
	let open: OpenTurn | undefined
	const close = (): void => {
		if (open === undefined) return
		const userTexts = open.userEntries.filter((entry) => entry.human && entry.text !== "").map((entry) => entry.text)
		const anyText = open.userEntries.find((entry) => entry.text !== "")?.text ?? ""
		turns.push({
			turn: open.turn,
			seqStart: open.seqStart,
			seqEnd: open.seqEnd,
			endReason: open.endReason,
			endError: open.endError,
			interrupted: open.interrupted,
			startTime: open.startTime,
			endTime: open.endTime,
			userTexts,
			previewText: userTexts[0] ?? anyText,
			assistantTexts: open.assistantTexts,
			toolCalls: open.toolCalls,
		})
		open = undefined
	}
	let ordinal = 0
	for (const entry of entries) {
		if (entry.type === "turn/start") {
			// A new bracket while one is open means the previous one never
			// closed — drop it (incomplete) and start fresh; well-formed
			// journals never hit this. A record without a numeric turn number
			// falls back to its positional ordinal (groupTurns parity).
			open = {
				turn: typeof entry.data.turn === "number" ? entry.data.turn : ordinal,
				seqStart: entry.seq,
				seqEnd: entry.seq,
				endReason: "completed",
				endError: undefined,
				endTime: undefined,
				startTime: typeof entry.time === "number" ? entry.time : undefined,
				interrupted: false,
				userEntries: [],
				assistantTexts: [],
				toolCalls: [],
				callIndex: new Map<string, number>(),
			}
			ordinal++
			continue
		}
		if (open === undefined) continue
		switch (entry.type) {
			case "user/message": {
				// Journal vocabulary: kind `user` — or an UNTAGGED user/message —
				// is human-authored; other kinds are injected context, never a
				// prompt (see the module comment for the tui-pi divergence).
				const kind = sourceKind(entry.data)
				const human = kind === undefined || kind === "user"
				open.userEntries.push({ human, text: blocksText(entry.data.content) })
				break
			}
			case "assistant/message": {
				const message = asRecord(entry.data.message)
				const text = blocksText(message.content)
				if (text !== "") open.assistantTexts.push(text)
				if (entry.data.interrupted === true) open.interrupted = true
				break
			}
			case "tool/call": {
				const index = open.toolCalls.push({
					name: String(entry.data.name ?? ""),
					args: typeof entry.data.arguments === "string" ? entry.data.arguments : "",
				}) - 1
				// Journal callIds pair call→result (remote-session-ops.ts
				// journalToTranscriptRows vocabulary); an untagged call simply
				// never pairs (its ok/output stay undefined = unsettled).
				if (entry.data.callId !== undefined) open.callIndex.set(String(entry.data.callId), index)
				break
			}
			case "tool/result": {
				// Pair the settled result onto its call — callId first, the
				// message.toolCallId fallback mirrors journalToTranscriptRows.
				const message = asRecord(entry.data.message)
				const callId = entry.data.callId !== undefined
					? String(entry.data.callId)
					: message.toolCallId !== undefined
						? String(message.toolCallId)
						: ""
				const index = callId === "" ? undefined : open.callIndex.get(callId)
				if (index === undefined) break
				open.callIndex.delete(callId)
				const call = open.toolCalls[index]!
				call.ok = entry.data.isError !== true && message.isError !== true
				call.output = typeof entry.data.output === "string" ? entry.data.output : JSON.stringify(entry.data.output ?? entry.data)
				break
			}
			case "turn/end": {
				open.seqEnd = entry.seq
				open.endTime = typeof entry.time === "number" ? entry.time : undefined
				const reason = asRecord(entry.data.reason)
				open.endReason = typeof reason.kind === "string" ? reason.kind : "completed"
				const error = asRecord(reason.error)
				open.endError = typeof error.message === "string" ? error.message : undefined
				close()
				break
			}
			default:
				// assistant/chunk, step/start|end, request/*, todo/write, … — no
				// turn pane needs them.
				break
		}
	}
	// A trailing unclosed bracket (the live turn mid-flight) is dropped by
	// never closing it.
	return turns
}

/**
 * The user prompt text a `c`/Enter copy refills the editor with (tui-pi
 * turnPrimaryUserText parity): the turn's first human prompt. `undefined`
 * when the turn carries NO human prompt — an injected-only turn (file-change
 * notices, skill content) must never be refillable into the editor, where
 * one Enter would submit the notice as a prompt. The LEFT-LIST preview keeps
 * its own fallback (previewText), so such turns still show a readable row;
 * only the refill path declines.
 */
export function turnPrimaryUserText(turn: HistoryTurn): string | undefined {
	return turn.userTexts[0]
}

/**
 * The right-pane detail of one selected turn, by INDEX into the fold output
 * (the left list's row order): full assistant bodies, the tool call list and
 * the end state. `undefined` past either end — the pane renders its empty
 * hint.
 */
export function historyTurnDetail(turns: readonly HistoryTurn[], index: number): HistoryTurn | undefined {
	return index >= 0 && index < turns.length ? turns[index] : undefined
}

/**
 * tui-pi normalizePreview parity (sessions.ts PREVIEW_MAX_CHARS = 140):
 * control characters fold to spaces, whitespace collapses, one line, hard
 * character cap with an ellipsis. Pure display clipping — the fold's
 * previewText stays raw.
 */
export const HISTORY_PREVIEW_MAX_CHARS = 140

export function normalizeHistoryPreview(text: string, maxChars = HISTORY_PREVIEW_MAX_CHARS): string {
	const oneLine = text.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim()
	return oneLine.length <= maxChars ? oneLine : `${oneLine.slice(0, maxChars)}…`
}

/**
 * Case-insensitive substring filter over the row vocabulary (tui-pi
 * matchesTurnFilter parity): the preview text and the turn number (typing
 * "3" narrows to turn 3xx too — the number is the row's identity). Empty
 * query matches everything, order preserved.
 */
export function matchesTurnFilter(turn: HistoryTurn, query: string): boolean {
	const needle = query.trim().toLowerCase()
	if (needle === "") return true
	return turn.previewText.toLowerCase().includes(needle) || String(turn.turn).includes(needle)
}

/**
 * The `⚙ N tool calls: read×2, edit×1` summary of one turn's tool names, in
 * first-appearance order (tui-pi toolCallSummary parity, minus the i18n
 * lookup — the labels are literal here). Empty string for a tool-less turn.
 */
export function toolCallSummary(names: readonly string[]): string {
	if (names.length === 0) return ""
	const counts = new Map<string, number>()
	for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
	const parts = [...counts.entries()].map(([name, count]) => `${name}×${count}`)
	const label = names.length === 1 ? "tool call" : "tool calls"
	return `${names.length} ${label}: ${parts.join(", ")}`
}

/**
 * The `f` fork-at-turn seed: the journal records from seq 0 through the
 * selected turn's `turn/end` (inclusive) — the state as that turn finished;
 * later turns stay out of the new session (tui-pi turnSeedSlice parity). The
 * boundary is the turn's OWN seqEnd (captured while folding), never a
 * re-match on the turn NUMBER. `seq === array index` holds for the fetched
 * journal (sortJournal + contiguous seq), so a plain slice is exact.
 */
export function turnSeedSlice(
	entries: readonly HistoryJournalEntry[],
	turn: HistoryTurn,
): readonly HistoryJournalEntry[] {
	return entries.slice(0, Math.min(turn.seqEnd + 1, entries.length))
}
