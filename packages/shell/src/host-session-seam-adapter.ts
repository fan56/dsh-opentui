/**
 * HostSessionSeam (batch 10a) — the plugin-mode SessionSeam: tui-base's
 * typed view seam (packages/tui-base/src/seams/session.ts) driven over the
 * IN-PROCESS `HostSession` facade (src/host-session.ts, ctx.* surfaces).
 * Injected at host-entry-v2's composition root — the plugin-mode twin of
 * the batch-9a RemoteSessionSeam (client/session-seam-adapter.ts), whose
 * structure and event discipline it mirrors on purpose.
 *
 * Mapping fidelity vs the batch-9a adapter (reused vs diverged):
 *
 *   status()                   → DERIVED (the facade has no status getter):
 *                                connection "connected" (in-process), turn
 *                                "running" while one of OUR turns awaits
 *                                else "idle", sessionAttached =
 *                                currentSessionId() !== undefined
 *   listSessions(limit)        → session.listSessions(limit)     (1:1; same
 *                                {id,title,updatedAt?} row shape)
 *   searchSessions(q)          → session.searchSessions(q)       (1:1)
 *   storedTranscript(id,skip)  → session.storedTranscript(...)   (1:1 drain;
 *                                rows are {kind:"user"|"assistant",text} —
 *                                no ask arm, `final` defaulted true)
 *   currentSessionId()         → session.currentSessionId()      (1:1 over
 *                                the batch-10a additive getter)
 *   resumeSession(id)          → session.resumeSession(id)       (always
 *                                "ok"; single-writer takeover is enforced
 *                                at turn() time instead of resume time)
 *   newSession()               → session.newSession()            (1:1)
 *   renameSession(title)       → NOT SOURCED: the facade has no title
 *                                write (titles are host-derived from the
 *                                first prompt) — stub returning undefined,
 *                                same shape as the remote adapter's omitted
 *                                parentID: documented absence, not silence
 *   turn(text, cb)             → session.turn(text, adapted)     — see below
 *   steer(text)                → session.steer(text)             (1:1)
 *   interrupt()                → session.abort()                 (same rename
 *                                as remote: abort is the fresh-next-send
 *                                contract, not a stream pause)
 *   registerAskProvider(cb)    → session.registerAskProvider(cb) — pure
 *                                structural passthrough: the facade's
 *                                {id,prompt,options:string[]} questions and
 *                                {questionId,selected} picks ARE the seam
 *                                shapes (declined envelope handled inside
 *                                the facade)
 *   listProviders()            → session.listProviders()         (1:1)
 *   modelCatalog(force)        → NOT SOURCED as a catalog endpoint: the
 *                                facade exposes listProviders() (cached) —
 *                                the seam's flat SeamProviderModel[] is
 *                                built groups-style provider×models.
 *                                `force` is accepted and ignored.
 *   currentModelSelection()    → session.currentModelSelection() RENAMED
 *                                (batch-10a additive read-only getter:
 *                                explicit override wins over the composed
 *                                agentDefaultModel selection — the same
 *                                precedence turn() applies, without its
 *                                label side effect)
 *   selectModel(pid, mid)      → session.switchModel(pid, mid)   (no effort
 *                                arm on the seam; void, errors contained)
 *   usageSummary()             → session.usageSummary()          (1:1)
 *   dispose()                  → NO FACADE DISPOSE: the plugin process owns
 *                                the lifecycle — the adapter drops its
 *                                listeners only (the old ShellHost entry
 *                                had the same shape)
 *
 * Turn-callback adaptation (SeamTurnCallbacks → TurnCallbacks): identical
 * to the remote adapter.
 *   onThinkingDelta / onContentDelta / onToolStart / onError → passthrough.
 *   onApprove: verdict STRINGS → facade boolean (`"allowed-once"` else
 *     fail-closed).
 *   onTurnEnd: no-op — the seam models turn end as the turn() promise
 *     resolving (the facade resolves it after painting onTurnEnd).
 *   onToolRun: no-op — the facade requires the field; the rebuilt rows
 *     finalize live (batch 3/4 documented limit). The facade's richer
 *     optional arms (onTodos, onSubagentUpdate, onStreamTick,
 *     onReattachedMissed) have no seam consumer and stay unwired.
 *
 * EVENT FEED (the remote adapter projects the facade's journal; the
 * in-process facade's equivalent channel is the session/event firehose,
 * which until now fed only the turn callbacks): the facade gains a public
 * `onJournalRecord` hook (batch 10a, additive — the same shape the remote
 * facade grew in 9a) and THIS adapter projects those records onto the
 * payload shapes seam-rows.ts apply() consumes:
 *
 *   user/message            → {type:"message.updated",
 *                               details:{id, role:"user", text, sessionID}}
 *   assistant/message       → {type:"message.part.updated",
 *                               details:{messageID, sessionID,
 *                                        part:{type:"text", id, text}}}
 *   turn/end (reason.error) → {type:"session.error",
 *                               details:{message, sessionID}}
 *
 * Host-side shape delta vs the remote journal: the assistant text lives
 * under data.message.content (not data.text/content), so the projection
 * reads that path first (projectJournalRecord below).
 *
 * DOUBLE-PAINT LAW (verbatim from the remote adapter): while one of THIS
 * adapter's turns is in flight, journal events are suppressed — the live
 * paint path (turn callbacks) owns the transcript during that window, and
 * re-emitting the same content as events would mount duplicate rows. The
 * suppression window is the turn await.
 */
// Seam types come straight from tui-base's source tree (the package's
// export map does not expose seams/ yet — the proper export is a later
// batch; ADR-0006 direction shell → tui-base is respected).
import type {
	SeamAskPick,
	SeamAskQuestion,
	SeamProviderModel,
	SeamSessionEvent,
	SeamSessionSummary,
	SeamStatus,
	SeamTranscriptRow,
	SeamTurnCallbacks,
	SessionSeam,
} from "../../tui-base/src/seams/session"
import { turnEndErrorMessage } from "./client/remote-follow.ts"
import type { HostSession } from "./host-session.ts"

/** One durable firehose record forwarded by the facade's journal hook. */
export interface HostJournalEntry {
	seq: number
	type: string
	data: Record<string, unknown>
}

export class HostSessionSeam implements SessionSeam {
	readonly #session: HostSession
	readonly #listeners: ((event: SeamSessionEvent) => void)[] = []
	/** Live-paint window: one of OUR turns is awaiting (see header). */
	#turnInFlight = false
	/** Journal hook disposer (set lazily; the facade registers one sink). */
	#unjournal: (() => void) | undefined

	constructor(session: HostSession) {
		this.#session = session
	}

	status(): SeamStatus {
		return {
			connection: "connected", // in-process: no connection to lose
			turn: this.#turnInFlight ? "running" : "idle",
			sessionAttached: this.#session.currentSessionId() !== undefined,
		}
	}

	async listSessions(limit?: number): Promise<SeamSessionSummary[]> {
		const rows = await this.#session.listSessions(limit)
		return rows.map((row) => ({ id: row.id, title: row.title, ...(row.updatedAt !== undefined ? { updatedAt: row.updatedAt } : {}) }))
	}

	async searchSessions(query: string): Promise<{ id: string; snippet: string }[]> {
		return this.#session.searchSessions(query)
	}

	async storedTranscript(id: string, skip?: number): Promise<SeamTranscriptRow[]> {
		const rows = await this.#session.storedTranscript(id, skip)
		// Host rows are durable extracts ({kind,text}) — always complete.
		return rows.map((row) => ({ kind: row.kind, text: row.text, final: true }))
	}

	currentSessionId(): string | undefined {
		return this.#session.currentSessionId()
	}

	resumeSession(id: string): "ok" | "owned" {
		return this.#session.resumeSession(id)
	}

	newSession(): void {
		this.#session.newSession()
	}

	async renameSession(_title: string): Promise<{ title: string; seq: number } | undefined> {
		return undefined // not sourced (header): no title write on the facade
	}

	async turn(userText: string, cb: SeamTurnCallbacks): Promise<void> {
		this.#turnInFlight = true
		try {
			await this.#session.turn(userText, {
				onThinkingDelta: (text) => cb.onThinkingDelta(text),
				onContentDelta: (text) => cb.onContentDelta(text),
				onTurnEnd: () => {}, // seam models turn end as the promise
				onApprove: async (name, args) => (await cb.onApprove(name, args)) === "allowed-once",
				onToolStart: (start) => cb.onToolStart?.(start),
				onToolRun: () => {}, // required by the facade; rows finalize live
				onError: (message) => cb.onError(message),
			})
		} finally {
			this.#turnInFlight = false
		}
	}

	steer(text: string): void {
		this.#session.steer(text)
	}

	interrupt(): void {
		this.#session.abort()
	}

	registerAskProvider(onAsk: (questions: SeamAskQuestion[]) => Promise<SeamAskPick[]>): void {
		// Structural passthrough (header): the facade's shapes ARE the seam's.
		this.#session.registerAskProvider(async (questions) => onAsk(questions))
	}

	async listProviders(): Promise<{ provider: string; models: string[] }[]> {
		return this.#session.listProviders()
	}

	async modelCatalog(_force?: boolean): Promise<SeamProviderModel[]> {
		const providers = await this.#session.listProviders()
		const rows: SeamProviderModel[] = []
		for (const provider of providers) {
			for (const modelID of provider.models) rows.push({ providerID: provider.provider, modelID })
		}
		return rows
	}

	async currentModelSelection(): Promise<{ providerID: string; modelID: string } | undefined> {
		const selection = this.#session.currentModelSelection()
		if (!selection) return undefined
		return { providerID: selection.provider, modelID: selection.model }
	}

	selectModel(providerID: string, modelID: string): void {
		try {
			this.#session.switchModel(providerID, modelID)
		} catch (error) {
			console.error("[host-session-seam-adapter] selectModel failed:", error)
		}
	}

	usageSummary(): string[] {
		return this.#session.usageSummary()
	}

	onSessionEvent(listener: (event: SeamSessionEvent) => void): () => void {
		this.#listeners.push(listener)
		this.#ensureJournalFeed()
		return () => {
			const index = this.#listeners.indexOf(listener)
			if (index >= 0) this.#listeners.splice(index, 1)
		}
	}

	async dispose(): Promise<void> {
		// No facade dispose (header): the plugin process owns the lifecycle.
		this.#unjournal?.()
		this.#unjournal = undefined
		this.#listeners.length = 0
	}

	// ------------------------------------------------------------------
	// Firehose → seam-event projection
	// ------------------------------------------------------------------

	#ensureJournalFeed(): void {
		if (this.#unjournal !== undefined) return
		const hook = this.#session as {
			onJournalRecord?: (listener: (entry: HostJournalEntry) => void) => () => void
		}
		if (typeof hook.onJournalRecord !== "function") return // older facade: callbacks only
		this.#unjournal = hook.onJournalRecord((entry) => {
			if (this.#turnInFlight) return // live paint owns the rows (header)
			for (const event of projectJournalRecord(entry, this.#session.currentSessionId() ?? "")) {
				this.#emit(event)
			}
		})
	}

	#emit(event: SeamSessionEvent): void {
		for (const listener of this.#listeners) {
			try {
				listener(event)
			} catch {
				/* a view listener must never take the feed down */
			}
		}
	}
}

/**
 * One durable firehose record → the seam-rows event shapes (0..n events).
 * Payload contracts are EXACTLY what seam-rows.ts apply() consumes (same
 * as the remote adapter's projector); the host-side shape delta is the
 * assistant text path (data.message.content). Keys stay stable per record
 * (seq-derived ids) so re-delivery upserts in place instead of mounting
 * duplicates.
 */
export function projectJournalRecord(entry: HostJournalEntry, sessionId: string): SeamSessionEvent[] {
	if (entry.type === "user/message") {
		const text = blocksText(entry.data.content)
		if (!text) return []
		const id = typeof entry.data.messageID === "string" ? entry.data.messageID : `journal-${entry.seq}`
		return [{ type: "message.updated", details: { id, role: "user", text, sessionID: sessionId } }]
	}
	if (entry.type === "assistant/message") {
		const text = assistantTextValue(entry.data)
		if (!text) return []
		const messageID = typeof entry.data.messageID === "string" ? entry.data.messageID : `journal-${entry.seq}`
		return [
			{
				type: "message.part.updated",
				details: { messageID, sessionID: sessionId, part: { type: "text", id: `${messageID}:text`, text } },
			},
		]
	}
	if (entry.type === "turn/end") {
		const message = turnEndErrorMessage(entry.data)
		if (message === undefined) return []
		return [{ type: "session.error", details: { message, sessionID: sessionId } }]
	}
	return []
}

/** Concatenated text of the record's content blocks ({type:"text",text}). */
function blocksText(content: unknown): string {
	const blocks = Array.isArray(content) ? content : []
	let text = ""
	for (const block of blocks) {
		if (typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text") {
			const value = (block as { text?: unknown }).text
			if (typeof value === "string") text += value
		}
	}
	return text.trim()
}

/** The assistant record's text: host shape first (data.message.content —
 * the path storedTranscript reads), then the remote shapes for parity. */
function assistantTextValue(data: Record<string, unknown>): string {
	const message = typeof data.message === "object" && data.message !== null ? (data.message as Record<string, unknown>) : undefined
	if (message && Array.isArray(message.content) && blocksText(message.content)) return blocksText(message.content)
	if (typeof data.text === "string") return data.text.trim()
	return blocksText(data.content ?? data.parts)
}
