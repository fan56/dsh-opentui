/**
 * RemoteSessionSeam (batch 9a) — the REAL `SessionSeam` implementation:
 * tui-base's typed view seam (packages/tui-base/src/seams/session.ts) driven
 * over the client-mode `RemoteHostSession` facade. Injected at the --v2
 * dev entry's composition root, replacing the batch-2a NullSessionSeam.
 *
 * Mapping fidelity vs the batch-2a table (seams/session.ts header):
 *
 *   listSessions(limit)        → session.listSessions(limit)     (1:1; rows
 *                                carry {id,title,updatedAt?} — parentID has
 *                                no remote source, omitted)
 *   searchSessions(q)          → session.searchSessions(q)       (1:1)
 *   storedTranscript(id,skip)  → session.storedTranscript(...)   (1:1; kit
 *                                rows {kind,text} get `final` defaulted
 *                                true — durable rows are complete)
 *   currentSessionId()         → session.currentSessionId()      (1:1)
 *   resumeSession(id)          → session.resumeSession(id)       ("ok"|"owned")
 *   newSession()               → session.newSession()            (1:1)
 *   renameSession(title)       → session.renameSession(title)    (1:1)
 *   turn(text, cb)             → session.turn(text, adapted)     — see below
 *   steer(text)                → session.steer(text)             (1:1)
 *   interrupt()                → session.abort()                 (rename only:
 *                                the facade's abort is the wire's
 *                                session/cancel + fresh-next-send contract)
 *   registerAskProvider(cb)    → session.registerAskProvider(cb) — pure
 *                                structural passthrough: RemoteQuestion ≡
 *                                SeamAskQuestion {id,prompt,options[]},
 *                                RemoteQuestionAnswer ≡ SeamAskPick
 *                                {questionId,selected} (remote-waterfall.ts)
 *   listProviders()            → session.listProviders()         (1:1)
 *   modelCatalog(force)        → session.modelCatalog(force), FLATTENED:
 *                                the wire catalog is provider-GROUPED
 *                                ({groups:[{id, models:[{id,…}]}]}), the
 *                                seam wants the flat SeamProviderModel[]
 *                                the /model picker renders — groups×models
 *   currentModelSelection()    → session.currentModelSelection() RENAMED:
 *                                wire ModelSelection {provider,model} →
 *                                seam {providerID,modelID}
 *   selectModel(pid, mid)      → session.selectModel({provider: pid,
 *                                model: mid}) (arg shape inverted; void,
 *                                errors contained)
 *   usageSummary()             → session.usageSummary()          (1:1)
 *   status()                   → session.status (getter), the view slice:
 *                                connection/turn/sessionAttached (tailActive
 *                                dropped — no view consumer)
 *   onSessionEvent(cb)         → follow-stream push projection — see below
 *   dispose()                  → session.dispose()               (1:1)
 *
 * Turn-callback adaptation (SeamTurnCallbacks → TurnCallbacks):
 *   onThinkingDelta / onContentDelta / onToolStart / onError → passthrough.
 *   onApprove: the seam's verdict STRINGS map to the facade's boolean —
 *     `verdict === "allowed-once"` (everything else, i.e. "rejected", fails
 *     closed; the "unavailable" escalation the facade itself uses on a
 *     throwing UI is unreachable from the seam, whose type has no such arm).
 *   onTurnEnd: no-op — the seam models turn end as the turn() promise
 *     resolving (the facade resolves it after painting onTurnEnd).
 *   onToolRun: no-op — the facade requires the field; the rebuilt rows paint
 *     tool results via the live finalize pass (batch 3/4 documented limit).
 *
 * EVENT FEED (the batch-2a row `client.event.listen/on → onSessionEvent →
 * follow-stream push (#onEventsItem → typed union)` — reconciled):
 * the real host forwards NO message-level events over the connection's
 * `$events` (its emit allowlist is settings/commands/plugins/credentials/
 * api-session — remote-host-session.ts #onEmitEvent). The only transcript
 * channel that exists is the per-session follow stream, whose durable
 * records land in the facade's journal. The facade therefore exposes a
 * public `onJournalRecord` hook (batch 9a, additive) and THIS adapter
 * projects journal records onto the payload shapes seam-rows.ts documents:
 *
 *   user/message            → {type:"message.updated",
 *                               details:{id, role:"user", text, sessionID}}
 *   assistant/message       → {type:"message.part.updated",
 *                               details:{messageID, sessionID,
 *                                        part:{type:"text", id, text}}}
 *   turn/end (reason.error) → {type:"session.error",
 *                               details:{message, sessionID}}
 *
 * DOUBLE-PAINT LAW: while one of THIS adapter's turns is in flight, journal
 * events are suppressed — the live paint path (seam-rows send() → turn
 * callbacks) owns the transcript during that window, and re-emitting the
 * same content as events would mount duplicate rows under the real
 * message-id keys (`assistant:<msgID>:<partID>` vs `assistant:live-N`).
 * The suppression window is the turn await; stray post-turn records would
 * surface as fresh rows (harmless: the durable prefix and the live rows
 * agree on content; a reload() re-hydrate replaces everything).
 */
// Dev-entry import path: the seam types come straight from tui-base's
// source tree (the package's export map does not expose seams/ yet — the
// batch-10 cutover adds the proper export; ADR-0006 direction shell →
// tui-base is respected).
import type {
	SeamAskPick,
	SeamAskQuestion,
	SeamProviderModel,
SeamSessionEvent,
	SeamSessionInfo,
	SeamSessionSummary,
	SeamStatus,
	SeamTranscriptRow,
	SeamSubagentView,
	SeamTurnCallbacks,
	SessionSeam,
} from "../../../tui-base/src/seams/session"
import type { RemoteJournalEntry } from "./remote-session-ops.ts"
import { turnEndErrorMessage } from "./remote-follow.ts"
import { RemoteHostSession } from "./remote-host-session.ts"
import { foldSubagentMarkerViews } from "../../../tui-base/src/routes/session/subagent-markers.ts"

export class RemoteSessionSeam implements SessionSeam {
	readonly #session: RemoteHostSession
	readonly #listeners: ((event: SeamSessionEvent) => void)[] = []
	/** Live-paint window: one of OUR turns is awaiting (see header). */
	#turnInFlight = false
	/** Journal hook disposer (set lazily; the facade registers one sink). */
	#unjournal: (() => void) | undefined

	constructor(session: RemoteHostSession) {
		this.#session = session
	}

	status(): SeamStatus {
		const s = this.#session.status
		return { connection: s.connection, turn: s.turn, sessionAttached: s.sessionAttached }
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
		return rows.map((row) => {
			if (row.kind === "ask") {
				// Ask rows project as their Q&A text (the seam view renders them
				// as assistant rows; the replay keeps the Q&A visible).
				const text = row.entries
					.map((entry) => {
						const picked = entry.selected.length > 0 ? entry.selected.join(", ") : (entry.custom ?? "declined")
						return `${entry.question} → ${picked}`
					})
					.join("\n")
				return { kind: row.kind, text, final: true }
			}
			return {
				kind: row.kind,
				text: row.text,
				// Durable rows are complete rows; only the assistant variant
				// carries an optional partial flag — everything else final.
				final: row.kind === "assistant" ? (row.final ?? true) : true,
			}
		})
	}

	currentSessionId(): string | undefined {
		return this.#session.currentSessionId()
	}

	/** ⚡ CH footer segment (batch F2): RemoteHostSession.cacheHitRate() 1:1 —
	 * the cacheHitMode (batch F2) passes through untouched. */
	cacheHitRate(mode?: "session" | "lastMessage"): number | null {
		return this.#session.cacheHitRate(mode)
	}

	/** Config seam read (batch F2 cacheHitMode): RemoteHostSession.configLoad() 1:1. */
	configLoad(): Record<string, unknown> {
		return this.#session.configLoad()
	}

	/**
	 * /session info panel (batch F4): RemoteHostSession.sessionInfo() 1:1,
	 * plus the message count the facade can't know — a one-shot durable
	 * transcript read (user+assistant rows). Transcript failure degrades the
	 * count to 0 without sinking the panel.
	 */
	async sessionInfo(): Promise<SeamSessionInfo | undefined> {
		const base = this.#session.sessionInfo()
		if (base.sessionId === undefined) return undefined
		let messageCount = 0
		try {
			const rows = await this.#session.storedTranscript(base.sessionId)
			messageCount = rows.filter((row) => row.kind === "user" || row.kind === "assistant").length
		} catch {
			/* panel shows 0 rather than failing */
		}
		return { ...base, sessionId: base.sessionId, model: base.model ?? null, messageCount }
	}

	resumeSession(id: string): "ok" | "owned" {
		return this.#session.resumeSession(id)
	}

	newSession(): void {
		this.#session.newSession()
	}

	async renameSession(title: string): Promise<{ title: string; seq: number } | undefined> {
		return this.#session.renameSession(title)
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
		// Structural passthrough: RemoteQuestion/RemoteQuestionAnswer are the
		// same shapes under other names (remote-waterfall.ts).
		this.#session.registerAskProvider(async (questions) => onAsk(questions))
	}

	async listProviders(): Promise<{ provider: string; models: string[] }[]> {
		return this.#session.listProviders()
	}

	async modelCatalog(force?: boolean): Promise<SeamProviderModel[]> {
		const catalog = (await this.#session.modelCatalog(force ?? false)) as {
			groups?: { id?: unknown; models?: { id?: unknown }[] }[]
		}
		const rows: SeamProviderModel[] = []
		for (const group of Array.isArray(catalog.groups) ? catalog.groups : []) {
			const providerID = String(group?.id ?? "")
			if (!providerID) continue
			for (const model of Array.isArray(group.models) ? group.models : []) {
				const modelID = String(model?.id ?? "")
				if (modelID) rows.push({ providerID, modelID })
			}
		}
		return rows
	}

	async currentModelSelection(): Promise<{ providerID: string; modelID: string } | undefined> {
		const selection = await this.#session.currentModelSelection()
		if (!selection) return undefined
		return { providerID: selection.provider, modelID: selection.model }
	}

	selectModel(providerID: string, modelID: string): void {
		void this.#session
			.selectModel({ provider: providerID, model: modelID })
			.catch((error) => console.error("[session-seam-adapter] selectModel failed:", error))
	}

	usageSummary(): string[] {
		return this.#session.usageSummary()
	}

	btwAsk(question: string, snapshot: string[], onDelta?: (full: string) => void): Promise<string> {
		return this.#session.btwAsk(question, snapshot, onDelta)
	}

	// ---- subagent marker face (batch F6): RemoteHostSession 1:1 ----
	subagentViews(): SeamSubagentView[] {
		return this.#session.subagentViews().map((v) => ({
			id: v.id,
			label: v.label,
			status: v.status,
			rounds: v.rounds,
			...(v.injectedRound !== undefined ? { injectedRound: v.injectedRound } : {}),
			...(v.hardStopRound !== undefined ? { hardStopRound: v.hardStopRound } : {}),
			...(v.spinStopRound !== undefined ? { spinStopRound: v.spinStopRound } : {}),
		}))
	}
	onSubagentViews(listener: (views: SeamSubagentView[]) => void): () => void {
		// Fold into the vendored picker's module store too (batch F6): the
		// SubagentsTab predates the seam and reads contexts, so the markers
		// ride this snapshot instead of a context re-plumb.
		foldSubagentMarkerViews(this.subagentViews())
		return this.#session.onSubagentViews((views) => {
			const projected = views.map((v) => ({
				id: v.id,
				label: v.label,
				status: v.status,
				rounds: v.rounds,
				...(v.injectedRound !== undefined ? { injectedRound: v.injectedRound } : {}),
				...(v.hardStopRound !== undefined ? { hardStopRound: v.hardStopRound } : {}),
				...(v.spinStopRound !== undefined ? { spinStopRound: v.spinStopRound } : {}),
			}))
			foldSubagentMarkerViews(projected)
			listener(projected)
		})
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
		this.#unjournal?.()
		this.#unjournal = undefined
		this.#listeners.length = 0
		await this.#session.dispose()
	}

	// ------------------------------------------------------------------
	// Journal → seam-event projection
	// ------------------------------------------------------------------

	#ensureJournalFeed(): void {
		if (this.#unjournal !== undefined) return
		const hook = this.#session as {
			onJournalRecord?: (listener: (entry: RemoteJournalEntry) => void) => () => void
		}
		if (typeof hook.onJournalRecord !== "function") return // older facade: registry-only
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
 * One durable journal record → the seam-rows event shapes (0..n events).
 * Payload contracts are EXACTLY what seam-rows.ts apply() consumes:
 * message.updated needs {id, role:"user", text}; message.part.updated needs
 * {messageID, part:{type, id, text}}; session.error needs {message}. Every
 * details carries `sessionID` so the view's active-session filter passes.
 * Keys stay stable per record (seq-derived ids) so re-delivery upserts in
 * place instead of mounting duplicates.
 */
export function projectJournalRecord(entry: RemoteJournalEntry, sessionId: string): SeamSessionEvent[] {
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

/** The assistant record's text value (a plain string or text blocks). */
function assistantTextValue(data: Record<string, unknown>): string {
	if (typeof data.text === "string") return data.text.trim()
	return blocksText(data.content ?? data.parts)
}
