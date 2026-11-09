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
 *   onToolRun: passthrough (batch V1) — a durable tool/result settles its
 *     transcript row LIVE (status + result brief ride the row); the turn
 *     finalize sweep only catches stragglers (was a no-op through batch 3/4).
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
	SeamPresetRow,
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
import { foldSubagentMarkerViews, registerSubagentSteer } from "../../../tui-base/src/routes/session/subagent-markers.ts"
import { createSignal } from "solid-js"

export class RemoteSessionSeam implements SessionSeam {
	readonly #session: RemoteHostSession
	readonly #listeners: ((event: SeamSessionEvent) => void)[] = []
	/** Live-paint window: one of OUR turns is awaiting (see header). */
	#turnInFlight = false
	/** Journal hook disposer (set lazily; the facade registers one sink). */
	#unjournal: (() => void) | undefined
	/** /plugins cache revision — the reactive face reads through this signal
	 * so a boot warm or push refresh repaints the panel (the underlying
	 * listPlugins() is a sync cached read that alone never retriggers). */
	readonly #pluginsRevision = createSignal(0)
	#unplugins: (() => void) | undefined

	constructor(session: RemoteHostSession) {
		this.#session = session
		// Steer slot (batch G2): the vendored picker calls through the module
		// bridge; this face's facade steerChild serves it over the steer RPC.
		registerSubagentSteer((id, text) => this.#session.steerChild(id, text))
		// /plugins reactivity (client-face panel): the facade notifies after
		// every refreshPlugins() that lands (boot warm + plugin-manager/changed
		// push); the panel's memo re-reads the sync cache on each bump.
		// Optional-chained: test stubs may not carry the push-listener face.
		this.#unplugins =
			session.onPluginsChanged?.(() => this.#pluginsRevision[1]((n) => n + 1)) ?? undefined
	}

	status(): SeamStatus {
		const s = this.#session.status
		return { connection: s.connection, turn: s.turn, sessionAttached: s.sessionAttached }
	}

	async listSessions(limit?: number): Promise<SeamSessionSummary[]> {
		const rows = await this.#session.listSessions(limit)
		return rows.map((row) => ({
			id: row.id,
			title: row.title,
			...(row.updatedAt !== undefined ? { updatedAt: row.updatedAt } : {}),
			...(row.cwd !== undefined ? { cwd: row.cwd } : {}),
			...(row.sizeBytes !== undefined ? { sizeBytes: row.sizeBytes } : {}),
		}))
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
			if (row.kind === "tool") {
				// Batch V1: settled tool rows project with their args brief and
				// result summary — the view's tool block replays them (gap 3).
				return { kind: "tool", text: row.name, final: true, args: row.args, output: row.brief, ok: row.ok }
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

	/** Config seam write (batch F7b /theme persistence): RemoteHostSession.
	 * configSave() 1:1 — `theme` and plugin keys go to the profile
	 * config.json (host-face parity), `model` to the workspace config.yml. */
	configSave(patch: Record<string, unknown>): Record<string, unknown> {
		return this.#session.configSave(patch)
	}

	/** α skin layer: the profile config.json RAW contents (no overlay/env
	 * merge) — the migration decision reads layers, not the merged view. */
	configRaw(): Record<string, unknown> {
		return this.#session.configRaw()
	}

	/** α skin layer: the workspace overlay slice (theme + model), warm
	 * after start() — the workspace side of the migration decision. */
	workspaceConfig(): { theme?: string; themeMode?: "dark" | "light" | "auto"; model?: unknown } {
		return this.#session.workspaceConfig()
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
				// Batch V1: result events settle their tool row live (was a no-op —
				// rows finalized only at turn end, output discarded).
				onToolRun: (run) => cb.onToolRun?.(run),
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

	/** Reasoning-effort surface (batch F7b /think): the ladder reads the
	 * CURRENT route's `reasoning.efforts` off the host model catalog (real
	 * provider data, the wire shape RemoteModelCatalog already parses);
	 * the apply arm rides /model's effort semantics — selectModel with a
	 * reasoningEffort arm (undefined clears the override). */
	thinking = {
		efforts: async (): Promise<{ id: string; name: string; description?: string }[]> => {
			try {
				const selection = await this.#session.currentModelSelection()
				if (!selection) return []
				const catalog = (await this.#session.modelCatalog(false)) as {
					groups?: { id?: unknown; models?: { id?: unknown; reasoning?: { efforts?: unknown } }[] }[]
				}
				const group = Array.isArray(catalog.groups)
					? catalog.groups.find((g) => String(g?.id ?? "") === selection.provider)
					: undefined
				const model = Array.isArray(group?.models) ? group!.models!.find((m) => String(m?.id ?? "") === selection.model) : undefined
				const efforts = model?.reasoning?.efforts
				if (!Array.isArray(efforts) || efforts.length === 0) return []
				return (efforts as any[])
					.map((e) => ({
						id: String(typeof e === "object" && e !== null ? (e?.id ?? "") : e ?? ""),
						name: String(typeof e === "object" && e !== null ? (e?.name ?? e?.id ?? "") : e ?? ""),
						...(typeof e === "object" && e !== null && typeof e?.description === "string" && e.description
							? { description: e.description }
							: {}),
					}))
					.filter((e: { id: string }) => e.id)
			} catch {
				return []
			}
		},
		currentEffort: async (): Promise<string | undefined> => {
			const selection = (await this.#session.currentModelSelection()) as { reasoningEffort?: string } | undefined
			return selection?.reasoningEffort
		},
		selectEffort: (effort: string | undefined): void => {
			void this.#session
				.currentModelSelection()
				.then((selection) => {
					if (!selection) return
					return this.#session.selectModel({
						provider: selection.provider,
						model: selection.model,
						...(effort ? { reasoningEffort: effort } : {}),
					})
				})
				.catch((error) => console.error("[session-seam-adapter] selectEffort failed:", error))
		},
	}

	usageSummary(): string[] {
		return this.#session.usageSummary()
	}

	btwAsk(question: string, snapshot: string[], onDelta?: (full: string) => void): Promise<string> {
		return this.#session.btwAsk(question, snapshot, onDelta)
	}

	/**
	 * /plugins listing (batch F7a): RemoteHostSession.listPlugins() 1:1 —
	 * the sync cached rows (pluginManager/listPlugins, refreshed async;
	 * @deepseek-ai/* built-ins excluded upstream, HostSession parity).
	 * Reads through #pluginsRevision so the panel's memo tracks cache
	 * refreshes (boot warm + plugin-manager/changed push).
	 */
	plugins(): { name: string; version: string }[] {
		this.#pluginsRevision[0]()
		return this.#session.listPlugins()
	}

	// ---- agent-preset face (batch H2, tui-pi 60-preset parity): RemoteHostSession 1:1 ----
	// The roster reads the remote agentPresets/list RPC (listPresets, audit
	// row 23); the switch rides switchPreset — the id rides the NEXT
	// session/create request, the reference's confirmed-switch path. Both
	// arms already degrade (listPresets catches into [], switchPreset
	// re-probes the execution mode).
	preset = {
		list: (): Promise<SeamPresetRow[]> => this.#session.listPresets(),
		currentId: async (): Promise<string | undefined> => this.#session.currentPresetId(),
		select: async (presetId: string): Promise<boolean> => {
			try {
				this.#session.switchPreset(presetId)
				return true
			} catch (error) {
				console.error("[session-seam-adapter] preset switch failed:", error)
				return false
			}
		},
	}

	// ---- /login provider face (batch H4, tui-pi 65-ux-batch parity) ----
	// The credentials half (credentialStatus/login/logout) is RemoteHostSession
	// 1:1 (credentials/set|unset — audit row 24); the route half rides the
	// settings seam's llm-pi-ai namespace with the old-stack writeRoute
	// semantics (describe → revision → mutate). Route failure keeps the key
	// unstored — commitLoginRoute checks registerRoute's boolean first.
	login = {
		credentialStatus: (ref: string) => this.#session.credentialStatus(ref),
		login: (ref: string, apiKey: string) => this.#session.login(ref, apiKey),
		logout: (ref: string) => this.#session.logout(ref),
		routes: async (): Promise<string[]> => {
			try {
				const rows = await this.#session.settingsSeam.describe()
				const ns = Array.isArray(rows) ? rows.find((row: any) => row?.ns === "llm-pi-ai") : undefined
				return Object.keys((ns?.value as any)?.providers ?? {})
			} catch {
				return []
			}
		},
		registerRoute: async (providerId: string, profile: Record<string, unknown> | undefined): Promise<boolean> => {
			try {
				const rows = await this.#session.settingsSeam.describe()
				const ns = Array.isArray(rows) ? rows.find((row: any) => row?.ns === "llm-pi-ai") : undefined
				const ops = profile
					? [{ op: "set", path: ["providers", providerId], value: profile }]
					: [{ op: "unset", path: ["providers", providerId] }]
				await this.#session.settingsSeam.mutate("llm-pi-ai", ops, ns?.revision)
				return true
			} catch (error) {
				console.error("[session-seam-adapter] login route registration failed:", error)
				return false
			}
		},
	}

	// ---- subagent marker face (batch F6): RemoteHostSession 1:1 ----
	// Batch V2b: the projection carries the transcript-tree fields too —
	// `model` (the label's agent/model suffix), `startedAt` (live duration
	// ticks) and `elapsedSec` (frozen at the fold for a settled child; the
	// settle emission fires at settle time, so the freeze is the settle
	// duration to the second).
	#projectSubagentViews(views: { id: string; label: string; model?: string; status: "running" | "completed" | "failed" | "cancelled"; rounds: number; startedAt?: number; injectedRound?: number; hardStopRound?: number; spinStopRound?: number; lastLine?: string }[]): SeamSubagentView[] {
		return views.map((v) => ({
			id: v.id,
			label: v.label,
			...(v.model ? { model: v.model } : {}),
			status: v.status,
			rounds: v.rounds,
			...(v.startedAt !== undefined
				? v.status === "running"
					? { startedAt: v.startedAt }
					: { elapsedSec: Number(((Date.now() - v.startedAt) / 1000).toFixed(1)) }
				: {}),
			...(v.injectedRound !== undefined ? { injectedRound: v.injectedRound } : {}),
			...(v.hardStopRound !== undefined ? { hardStopRound: v.hardStopRound } : {}),
			...(v.spinStopRound !== undefined ? { spinStopRound: v.spinStopRound } : {}),
			// Batch D2 (lastRequest dock): the child's latest content tail.
			...(v.lastLine !== undefined ? { lastLine: v.lastLine } : {}),
		}))
	}
	subagentViews(): SeamSubagentView[] {
		return this.#projectSubagentViews(this.#session.subagentViews())
	}
	onSubagentViews(listener: (views: SeamSubagentView[]) => void): () => void {
		// Fold into the vendored picker's module store too (batch F6): the
		// SubagentsTab predates the seam and reads contexts, so the markers
		// ride this snapshot instead of a context re-plumb.
		foldSubagentMarkerViews(this.subagentViews())
		return this.#session.onSubagentViews((views) => {
			const projected = this.#projectSubagentViews(views)
			foldSubagentMarkerViews(projected)
			listener(projected)
		})
	}

	// ---- subagent steer face (batch G2): RemoteHostSession 1:1 ----
	// The facade's sync steerChild rides the remote-subagents steer RPC and
	// surfaces `false` on settled/unreachable children (steerChildDetailed
	// carries the typed reason; the seam keeps the boolean face).
	steerChild(id: string, text: string): boolean {
		return this.#session.steerChild(id, text)
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
		this.#unplugins?.()
		this.#unplugins = undefined
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
/** Batch D5: user/message source kinds that are human-facing relay
 * notices (painted as markdown notice rows, never as `❯` prompts). Every
 * other non-user kind is a host injection and never paints. */
export const NOTICE_SOURCE_KINDS: ReadonlySet<string> = new Set(["subagent-settled", "agent-message", "team-message", "webhook"])

export function projectJournalRecord(entry: RemoteJournalEntry, sessionId: string): SeamSessionEvent[] {
	if (entry.type === "user/message") {
		const text = blocksText(entry.data.content)
		if (!text) return []
		const id = typeof entry.data.messageID === "string" ? entry.data.messageID : `journal-${entry.seq}`
		// Batch D5 (live finding: `❯ Current runtime context. This snapshot
		// supersedes…` painted as a user prompt): only source.kind `user` (or
		// a source-less legacy record) is the user's own words. Host-injected
		// records (runtime-context, tool-registry, system-prompt, loop guards…)
		// never paint; the human-facing relay notices (a subagent settling, an
		// agent/team message, a webhook) paint as a markdown NOTICE row — not
		// a `❯` prompt (the replay paths already apply the same user filter).
		const source = entry.data.source
		const kind =
			source !== null && typeof source === "object" ? (source as Record<string, unknown>).kind : undefined
		if (kind === undefined || kind === "user") {
			return [{ type: "message.updated", details: { id, role: "user", text, sessionID: sessionId } }]
		}
		if (typeof kind === "string" && NOTICE_SOURCE_KINDS.has(kind)) {
			return [{ type: "message.updated", details: { id, role: "notice", text, sessionID: sessionId } }]
		}
		return []
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
			// Batch D5b (live finding: a two-block subagent-settled notice
			// painted `finished.It left…`): blocks join on a newline — the
			// remote-follow blocksText parity.
			if (typeof value === "string") text += (text === "" ? "" : "\n") + value
		}
	}
	return text.trim()
}

/** The assistant record's text value (a plain string or text blocks). */
function assistantTextValue(data: Record<string, unknown>): string {
	if (typeof data.text === "string") return data.text.trim()
	return blocksText(data.content ?? data.parts)
}
