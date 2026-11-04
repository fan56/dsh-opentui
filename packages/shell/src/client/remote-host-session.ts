/**
 * `RemoteHostSession` — the client-mode session core (ADR-0005 bucket (b),
 * waves 1 + 2): the SAME surface ShellHost consumes from the in-process
 * `HostSession`, driven over P1's `ClientConnection` (unary Remote RPC +
 * raw `$events` frames). The rendering layer can later swap the injection
 * point (host-entry.tsx's ShellHostDeps.session) with zero UI changes.
 *
 * Wave-1 capability rows (docs/client-mode-protocol-audit.md):
 *  1/9/10  turn lifecycle — `session/create` + `session/prompt`
 *          (`mode:'queue'` is the wire's only fresh-send mode; `mode:'steer'`
 *          mirrors agent.steer; the message queue stays client-side in
 *          ShellHost exactly as today)
 *  2–6     `session/follow({assistantStream:true})` consumption — text and
 *          thinking deltas, usage chunks, tool call/result frames (image-path
 *          extraction parity), turn/end + error frames (remote-follow.ts)
 *  11      `session/cancel` (abort)
 *  7       approval waterfall — `approval/request` frames claimed by
 *          agentId, prompted through TurnCallbacks.onApprove, answered with
 *          the same "allowed-once" / "rejected" verdict strings via
 *          `$events/result` (remote-waterfall.ts)
 *  8       user-questions waterfall — `user-questions/request` claimed the
 *          same way and answered through registerAskProvider (see
 *          remote-waterfall.ts for why the waterfall route and not
 *          `userQuestions/answer` + `attachWait`)
 *  34      durable `todo/write` → TurnCallbacks.onTodos
 *
 * Wave-2 rows (this class + remote-session-ops/-model/-settings):
 *  12      /new — fresh `session/create` per send (a fresh client-minted id
 *          never matches a stored session, so blank-reuse stays host-native
 *          and the host's returned sessionId — which may differ from the
 *          requested one — is adopted)
 *  13      `session/list` + the SAME client-side retention filter
 *          (subagent rows out, retentionDays cutoff, newest-first, capped)
 *  14      stored transcript replay — `session/page` backwards fills over
 *          the `session/follow` opening snapshot (records + cursor)
 *  15      /resume + single-writer guard — `session/create` on the stored
 *          id; `session/writer-held` maps to the takeover error surface
 *          host-session.ts:826-838 produced
 *  16      idle-release — HOST-NATIVE. There is NO client-side lease
 *          machinery here (no idle timer, no releasedSeq, no wake-diff
 *          base): the host owns the writer lock, `session/follow` reads
 *          need no lock, and the re-attach wake diff rides the follow
 *          opening snapshot (delete-by-omission vs host-session.ts:868-919)
 *  17      /tail — `session/follow` on a FOREIGN session id, read-only,
 *          with journal-tail page gap repair (RemoteTailSession; strictly
 *          better than the zstd CLI poll)
 *  18      /history — turn grouping from the follow record ledger
 *          (client-side, host-session.ts:1057-1084 algorithm) +
 *          `session/fork` (`atSeq` = the turn's seqEnd; omission = latest
 *          completed turn)
 *  19      `session/search`
 *  20      `session/rename` (renameSession)
 *  21+22   model — `session/modelCatalog` (groups + failures + default),
 *          `session/selectModel` (ModelSelection round-trip),
 *          `llm/listProviders`/`llm/listConfigurableProviders`; the
 *          cold-boot label comes from the catalog's `default` route (the
 *          host-side equivalent of agentDefaultModel.currentSelection) and
 *          a live session's route from `session/projections`
 *          (modelSelection.next, pending folded host-side)
 *  23      `agentPresets/list|read|select`
 *  24      `credentials/describe|set|unset` (+ the login double-write's
 *          settings.mutate route registration via settingsSeam)
 *  25      `settings/describe|mutate|update|replace` + the
 *          `settings/document-updated` push
 *  26      `commands/list|execute` (+ `commands/change` push) — agent-scoped
 *          on the wire: no boot-time palette without a live session
 *  27      `skills/list` (session-scoped catalog)
 *  28      `pluginManager/listPlugins` + `pluginInventory/list` + the
 *          `plugin-manager/changed` push (cache auto-refresh)
 *  5       usage polish — each usage chunk ASSIGNS the fields it reports
 *          (never accumulates them into each other; completion is the one
 *          accumulator across the session), verified against the live wire:
 *          the zai adapter SPLITS the request context into a cached prefix
 *          (cacheRead) and uncached input (prompt) — the context size is
 *          prompt + cacheRead + cacheWrite, prompt alone is not it (the
 *          same numeric scan and assignment the plugin-mode path runs)
 *
 * Wave-2 polish: the re-attach replay resumes CLEAN at the dense chunk
 * index already streamed (compact-stream delta-dedupe) and repairs a
 * journal gap via `session/page` when the snapshot window cannot reach the
 * last painted record; `status` exposes the fuller connection/turn surface
 * (the "reconnecting…" label swap stays for UI compatibility).
 *
 * Still stubs (wave 3): /agents + /repair client-local FS (rows 30/31),
 * subagent panel + /btw (rows 32/33), attachments (row 35), executionMode
 * probe (row 37 — kept "native" rather than inferred from a preset YAML),
 * workspace config overlay (row 41), /reload (row 29 — host restart +
 * auto-reconnect by design).
 */

import { randomUUID } from "node:crypto"
import {
	createStreamTicker,
	emptyTurnStats,
	estimateTokens,
	tokensPerSecond,
	type TurnCallbacks,
	type TurnStats,
} from "../agent/loop.ts"
import WS from "ws"
import type { MuxSocket, MuxSocketFactory } from "./events-source.ts"
import type { EventsItem, EventsWaterfall, RemoteJson } from "./mux-frame.ts"
import {
	RemoteFollowSession,
	turnEndErrorMessage,
	type RemoteFollowOpening,
	type RemoteJournalEntry,
	type RemoteTodoItem,
	type RemoteToolRun,
	type RemoteTranscriptRow,
} from "./remote-follow.ts"
import {
	journalToTranscriptRows,
	groupTurns,
	sortJournal,
	RemoteSessionOps,
	RemoteTailSession,
} from "./remote-session-ops.ts"
import { RemoteModelClient, type RemoteModelSelection } from "./remote-model.ts"
import { RemoteSettingsClient, type RemoteSettingsRow, type RemoteCredentialInfo } from "./remote-settings.ts"
import { openRemoteStream, type RemoteStreamHandle } from "./remote-stream.ts"
import {
	WaterfallAnswerer,
	type RemoteApprovalVerdict,
	type RemoteQuestion,
	type RemoteQuestionAnswer,
} from "./remote-waterfall.ts"
import { ClientConnection, RemoteRpcError, type ClientConnectionState, type ClientReadyInfo } from "./transport.ts"

/** The fuller client-side status surface (wave-2 polish; `label` stays). */
export interface RemoteSessionStatus {
	connection: ClientConnectionState
	/** Turn lifecycle: starting = prompt RPC in flight; running = awaiting turn/end. */
	turn: "idle" | "starting" | "running" | "reconnecting"
	/** True while a session id exists and its follow stream is open. */
	sessionAttached: boolean
	/** True while a foreign-session tail watch is active (row 17). */
	tailActive: boolean
}

/** Push-event listener sets (audit rows 24/25/26/28). */
export interface RemotePushListeners {
	onSettingsUpdated?: (ns: string, revision: number) => void
	onHostCommandsChanged?: () => void
	onPluginsChanged?: () => void
	onCredentialUpdated?: (ref: string) => void
}

export interface RemoteHostSessionOptions {
	/** P1's connection carrier (frozen surface): `connect` / `rpc` / `onEvent`. */
	connection: ClientConnection
	/** The API cookie for the follow stream's own mux WebSocket. */
	cookieHeader: string
	/** Host base URL; defaults to the connection's (`http://<authority>`). */
	baseUrl?: string
	/** Socket factory override (tests); default: `ws` carrying the cookie. */
	socketFactory?: MuxSocketFactory
	/** Workspace directory sent as `session/create.cwd`; default `process.cwd()`. */
	cwd?: string
}

const REATTACH_RETRY_MS = 1_000
const REATTACH_MAX_ATTEMPTS = 10

/**
 * The client-mode session facade. Wave-1 rows are fully functional; the
 * remaining HostSession surface is present with graceful stubs so the
 * rendering layer can swap the injection point without shape drift.
 */
export class RemoteHostSession {
	label = "dsh-host"
	/** Cumulative token telemetry (assignment/addition semantics per chunk). */
	usage = { prompt: 0, completion: 0, cacheRead: 0, cacheWrite: 0 }
	/** Telemetry of the last completed turn (HostSession shape). */
	lastTurnStats: TurnStats = emptyTurnStats()
	remoteTailActive = false
	remoteTailSink: ((rows: { kind: string; text: string; final: boolean }[]) => void) | null = null

	readonly #connection: ClientConnection
	readonly #cookieHeader: string
	readonly #baseUrl: string
	readonly #socketFactory: MuxSocketFactory
	readonly #cwd: string

	#readyInfo: ClientReadyInfo | undefined
	#started: Promise<ClientReadyInfo> | undefined
	#waterfall: WaterfallAnswerer | undefined
	#follow: RemoteFollowSession | undefined
	#sessionId: string | undefined
	#resumeId: string | undefined
	#presetId: string | undefined
	#cb: TurnCallbacks | undefined
	#askProvider: ((questions: RemoteQuestion[]) => Promise<RemoteQuestionAnswer[]>) | undefined
	#resolveTurn: (() => void) | undefined
	#awaiting = false
	/** The prompt RPC is in flight but the turn await has not armed yet. */
	#promptInFlight = false
	/** abort()/dispose() while the prompt RPC was still in flight. */
	#interrupted = false
	/** Model selection staged for the NEXT session (switchModel with no live session). */
	#pendingModel: RemoteModelSelection | undefined
	#turns = 0
	#turnStartedAt = 0
	#turnUsageStart = { prompt: 0, completion: 0 }
	#ticker = createStreamTicker((t) => this.#cb?.onStreamTick?.(t))
	#disposed = false
	#disposers: (() => void)[] = []
	#reattachTimer: ReturnType<typeof setTimeout> | undefined
	#reattachInFlight = false
	#reattachAttempts = 0
	#labelBackup: string | undefined
	/** Wave-2 ops surfaces (lazy: built on first use after start()). */
	#ops: RemoteSessionOps | undefined
	#model: RemoteModelClient | undefined
	#settings: RemoteSettingsClient | undefined
	/** Durable record ledger of the LIVE session (/history + fork + gap repair). */
	#journal: RemoteJournalEntry[] = []
	/** Highest durable seq painted for the live session (gap-repair base). */
	#lastDurableSeq = -1
	/** Foreign-session tail watch (row 17). */
	#tail: RemoteTailSession | undefined
	/** Cached /plugins rows (sync listPlugins contract; refreshed async). */
	#pluginsCache: { name: string; version: string }[] = []
	/** Cached /skills rows (sync listSkills contract; refreshed async). */
	#skillsCache: { name: string; description: string; invocation: string }[] = []
	/** Push-event listeners (settings/commands/plugins/credentials). */
	#pushListeners: RemotePushListeners[] = []
	#coldBootLabelApplied = false

	constructor(options: RemoteHostSessionOptions) {
		this.#connection = options.connection
		this.#cookieHeader = options.cookieHeader
		this.#baseUrl = options.baseUrl ?? options.connection.baseUrl
		this.#cwd = options.cwd ?? process.cwd()
		this.#socketFactory = options.socketFactory ?? ((path) => this.#openMuxSocket(path))
	}

	#openMuxSocket(path: string): MuxSocket {
		return new WS(`${this.#baseUrl}${path}`, { headers: { cookie: this.#cookieHeader } }) as unknown as MuxSocket
	}

	// ------------------------------------------------------------------
	// Lifecycle
	// ------------------------------------------------------------------

	/**
	 * Connect the carrier and start event/waterfall routing. Idempotent;
	 * `turn()` calls it lazily, so ShellHost wiring can construct first and
	 * start whenever the boot sequence is ready. Applies the cold-boot label
	 * (row 22) from `session/modelCatalog.default` — best-effort, never
	 * throws out of start().
	 */
	async start(): Promise<ClientReadyInfo> {
		if (this.#disposed) throw new Error("RemoteHostSession is disposed")
		if (this.#started) return this.#started
		// Subscribe before connect: event delivery begins with the ready
		// frame, and these subscriptions are in place before it resolves.
		this.#disposers.push(this.#connection.onEvent((item) => this.#onEventsItem(item)))
		this.#disposers.push(this.#connection.onStateChange((state) => this.#onConnectionState(state)))
		this.#started = (async () => {
			const info = await this.#connection.connect()
			this.#readyInfo = info
			this.#waterfall = new WaterfallAnswerer({ connection: this.#connection, readyInfo: info })
			return info
		})()
		const info = await this.#started
		void this.#applyColdBootLabel()
		return info
	}

	/** The fuller status surface (wave-2 polish; the `label` swap stays). */
	get status(): RemoteSessionStatus {
		const reconnecting = this.#labelBackup !== undefined
		return {
			connection: this.#connection.getState(),
			turn: this.#awaiting ? (reconnecting ? "reconnecting" : "running") : this.#promptInFlight ? "starting" : "idle",
			sessionAttached: this.#sessionId !== undefined && this.#follow?.attached === true,
			tailActive: this.#tail !== undefined,
		}
	}

	/** Stop every stream and listener; resolve an awaited turn. Idempotent. */
	async dispose(): Promise<void> {
		if (this.#disposed) return
		this.#disposed = true
		if (this.#reattachTimer !== undefined) {
			clearTimeout(this.#reattachTimer)
			this.#reattachTimer = undefined
		}
		this.stopRemoteTail()
		this.#follow?.reset()
		this.#follow = undefined
		for (const dispose of this.#disposers) dispose()
		this.#disposers = []
		this.#pushListeners = []
		this.#interrupted = true
		const resolve = this.#resolveTurn
		this.#resolveTurn = undefined
		this.#awaiting = false
		resolve?.()
		await this.#connection.close()
	}

	/** The live session id (undefined until the first turn creates one). */
	currentSessionId(): string | undefined {
		return this.#sessionId
	}

	// ------------------------------------------------------------------
	// Wave-1 turn lifecycle (rows 1/9/10/11)
	// ------------------------------------------------------------------

	/**
	 * One user turn: create/attach the session on first use, prompt with
	 * `mode:'queue'`, and await the durable `turn/end`. Create/prompt
	 * failures throw (ShellHost's send() catches and paints them); streaming
	 * failures surface through `cb.onError`.
	 */
	async turn(userText: string, cb: TurnCallbacks, _signal?: AbortSignal): Promise<void> {
		if (this.#disposed) throw new Error("RemoteHostSession is disposed")
		if (this.#awaiting) throw new Error("a turn is already running")
		this.#cb = cb
		this.#interrupted = false
		this.#promptInFlight = true
		this.#turns++
		this.#ticker.reset()
		this.#turnStartedAt = Date.now()
		this.#turnUsageStart = { prompt: this.usage.prompt, completion: this.usage.completion }
		await this.start()
		const sessionId = await this.#ensureSession()
		const requestId = randomUUID()
		await this.#rpc("session/prompt", {
			request: {
				requestId,
				sessionId,
				mode: "queue",
				content: [{ type: "text", text: userText }],
			},
		})
		this.#promptInFlight = false
		// abort()/dispose() raced the prompt RPC: the cancel was already sent
		// and the turn was already settled — do not start awaiting now.
		if (this.#interrupted || this.#disposed) return
		this.#awaiting = true
		await new Promise<void>((resolve) => {
			this.#resolveTurn = resolve
		})
	}

	/** Steer the RUNNING turn (`session/prompt` mode:'steer'). Fire-and-forget. */
	steer(userText: string): void {
		const sessionId = this.#sessionId
		if (!sessionId) return
		void this.#rpc("session/prompt", {
			request: {
				requestId: randomUUID(),
				sessionId,
				mode: "steer",
				content: [{ type: "text", text: userText }],
			},
		}).catch((error) => {
			console.error("[remote-host-session] steer failed:", error)
		})
	}

	/**
	 * Abort the running turn: `session/cancel`, then settle the awaited turn
	 * WITHOUT onTurnEnd — and the next send gets a FRESH session
	 * (host-session.ts:1168-1183 semantics).
	 */
	abort(): void {
		const sessionId = this.#sessionId
		if (sessionId !== undefined) {
			void this.#rpc("session/cancel", { request: { sessionId } }).catch(() => {})
		}
		this.#sessionId = undefined
		this.#resumeId = undefined
		this.#follow?.reset()
		this.#resetLedger()
		this.#interrupted = true
		this.#settleTurnWithoutEnd()
	}

	/**
	 * Start a FRESH session on the next turn (keeps the current preset and a
	 * staged model override). Row 12: the send re-creates with a fresh
	 * client-minted id — it never matches a stored session, so the host's
	 * blank-reuse rules stay host-native and cannot silently hand back
	 * another surface's blank.
	 */
	newSession(): void {
		this.#sessionId = undefined
		this.#resumeId = undefined
		this.#follow?.reset()
		this.#resetLedger()
	}

	/**
	 * Resume a stored session on the next turn (`session/create` with the
	 * stored id — row 15). The writer-lock probe happens at turn time: a
	 * `session/writer-held` failure surfaces as the SAME takeover error the
	 * in-process SessionAlreadyOwnedError path produced
	 * (host-session.ts:826-838 parity).
	 */
	resumeSession(id: string): "ok" | "owned" {
		this.newSession()
		this.#resumeId = id
		return "ok"
	}

	/**
	 * Register the user-questions answerer (user-questions waterfall). The
	 * UI answers {questionId, selected} pairs; a throwing UI produces the
	 * same declined envelope the in-process listener returns.
	 */
	registerAskProvider(onAsk: (q: RemoteQuestion[]) => Promise<RemoteQuestionAnswer[]>): void {
		this.#askProvider = onAsk
	}

	// ------------------------------------------------------------------
	// Telemetry parity
	// ------------------------------------------------------------------

	/** Cache hit rate in percent when the host reports cache traffic. */
	cacheHitRate(): number | null {
		const total = this.usage.cacheRead + this.usage.cacheWrite
		if (total <= 0) return null
		return (this.usage.cacheRead / total) * 100
	}

	/** Compact /usage lines (HostSession parity). */
	usageSummary(): string[] {
		const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)
		const lines = [
			`turns ${this.#turns}`,
			`prompt ${fmt(this.usage.prompt)} tok`,
			`completion ${fmt(this.usage.completion)} tok`,
		]
		const s = this.lastTurnStats
		if (s.ms > 0) {
			const rate = s.tps === null ? "" : ` · ${Math.round(s.tps)} tok/s${s.estimated ? " (estimated)" : ""}`
			lines.push(`last turn ${(s.ms / 1000).toFixed(1)}s${rate}`)
		}
		return lines
	}

	// ------------------------------------------------------------------
	// Wave-2 model surface (rows 21 + 22)
	// ------------------------------------------------------------------

	/**
	 * Switch the model route (host-session.ts:127-140 parity): updates the
	 * label immediately; with a LIVE session the route goes through
	 * `session/selectModel` (durable per session — it applies to that
	 * session's next request, strictly stronger than the in-process
	 * next-session-only semantics); without one it is staged onto the
	 * session the next turn creates.
	 */
	switchModel(provider: string, model: string, reasoningEffort?: string): void {
		const selection: RemoteModelSelection = { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) }
		this.label = `${provider}/${model}${reasoningEffort ? ` (${reasoningEffort})` : ""}`
		const sessionId = this.#sessionId
		if (sessionId === undefined) {
			this.#pendingModel = selection
			this.newSession()
			return
		}
		void this.#modelClient()
			.selectModel(sessionId, selection)
			.catch((error) => {
				console.error("[remote-host-session] selectModel failed:", error)
			})
	}

	/**
	 * Select the model route and await the host's resolved acceptance
	 * (`session/selectModel` round-trip, row 21). Applies to the live
	 * session when one exists, else stages for the next create.
	 */
	async selectModel(selection: RemoteModelSelection): Promise<RemoteModelSelection> {
		this.label = `${selection.provider}/${selection.model}${selection.reasoningEffort ? ` (${selection.reasoningEffort})` : ""}`
		const sessionId = this.#sessionId
		if (sessionId === undefined) {
			this.#pendingModel = selection
			return selection
		}
		return this.#modelClient().selectModel(sessionId, selection)
	}

	/** The host-generation model catalog (row 21; cached host-side parity). */
	async modelCatalog(force = false) {
		return this.#modelClient().modelCatalog(force)
	}

	/** The cold-boot route: the catalog's `default` (row 22 mapping). */
	async defaultModelSelection(): Promise<RemoteModelSelection | undefined> {
		return this.#modelClient().defaultSelection()
	}

	/** A live session's effective route from `session/projections` (row 22). */
	async currentModelSelection(): Promise<RemoteModelSelection | undefined> {
		const sessionId = this.#sessionId
		if (sessionId === undefined) return this.defaultModelSelection()
		return this.#modelClient().sessionSelection(sessionId)
	}

	/** Ask the host to resolve the default model route. */
	async initializeDefaultModel(): Promise<void> {
		await this.#modelClient().initializeDefaultModel()
	}

	// ------------------------------------------------------------------
	// Wave-2 session ops (rows 12–20, 26, 27)
	// ------------------------------------------------------------------

	/** wave 2 (`llm/listConfigurableProviders` + catalog groups — row 21). */
	async listProviders(): Promise<{ provider: string; models: string[] }[]> {
		return this.#modelClient().listProviders()
	}

	/** Raw configurable-provider rows (settingsNs etc. for /login routing). */
	async configurableProviders(): Promise<Record<string, unknown>[]> {
		return this.#modelClient().configurableProviders()
	}

	/** wave 2 (`session/list` + retention filter — audit row 13). */
	async listSessions(limit = 12): Promise<{ id: string; title: string; updatedAt?: string }[]> {
		const cfg = this.configLoad()
		const retentionDays = Number(cfg.retentionDays ?? 0)
		return this.#opsClient().listSessions({ limit, ...(Number.isFinite(retentionDays) && retentionDays > 0 ? { retentionDays } : {}) })
	}

	/** wave 2 (`session/page` over the follow snapshot — audit row 14). */
	async storedTranscript(id: string, skip = 0): Promise<{ kind: "user" | "assistant"; text: string }[]> {
		return this.#opsClient().storedTranscript(id, skip)
	}

	/** Rename the live session (`session/rename` — audit row 20). */
	async renameSession(title: string): Promise<{ title: string; seq: number } | undefined> {
		const sessionId = this.#sessionId
		if (sessionId === undefined) return undefined
		return this.#opsClient().rename(sessionId, title)
	}

	/** wave 2 (`agentPresets/list` — audit row 23). */
	async listPresets(): Promise<{ id: string; name: string }[]> {
		try {
			const roster = (await this.#rpc("agentPresets/list")) as { presets?: unknown }
			const presets = Array.isArray(roster.presets) ? roster.presets : []
			return presets
				.map((p) => {
					const row = (typeof p === "object" && p !== null ? p : {}) as Record<string, unknown>
					return { id: String(row.id ?? ""), name: String(row.name ?? row.id ?? "") }
				})
				.filter((p) => p.id)
		} catch {
			return []
		}
	}

	/** Read one preset's composition document (row 23; executionMode probe input). */
	async readPreset(presetId: string): Promise<{ agentPreset: string; content: string; name?: string; description?: string } | undefined> {
		try {
			const doc = (await this.#rpc("agentPresets/read", { agentPreset: presetId })) as Record<string, unknown>
			return {
				agentPreset: String(doc.agentPreset ?? presetId),
				content: String(doc.content ?? ""),
				...(typeof doc.name === "string" ? { name: doc.name } : {}),
				...(typeof doc.description === "string" ? { description: doc.description } : {}),
			}
		} catch {
			return undefined
		}
	}

	/** Select a preset for the LIVE session (`agentPresets/select`, row 23). */
	async selectPreset(presetId: string): Promise<string | undefined> {
		const sessionId = this.#sessionId
		if (sessionId === undefined) return undefined
		return (await this.#rpc("agentPresets/select", { agentId: sessionId, agentPreset: presetId })) as string
	}

	/** Real in wave 1: the preset rides the next `session/create` (row 1). */
	switchPreset(presetId: string): void {
		this.#presetId = presetId
		this.newSession()
	}

	currentPresetId(): string | undefined {
		return this.#presetId
	}

	/**
	 * wave 2 (`commands/list` — audit row 26). Agent-scoped on the wire: no
	 * boot-time (agent-less) list exists remotely, so without a live session
	 * the palette gets [] (degradation vs the in-process global registry).
	 */
	async listHostCommands(): Promise<{ name: string; description: string }[]> {
		const sessionId = this.#sessionId
		if (sessionId === undefined) return []
		return this.#opsClient().commandsList(sessionId)
	}

	/** wave 2 (`commands/execute` — audit row 26). */
	async executeHostCommand(line: string): Promise<{ text?: string } | undefined> {
		const sessionId = this.#sessionId
		if (sessionId === undefined) return { text: "host command service unavailable" }
		try {
			return await this.#opsClient().commandsExecute(sessionId, line)
		} catch (e) {
			return { text: String(e instanceof Error ? e.message : e).slice(0, 300) }
		}
	}

	/** wave 2 (`credentials/describe` — audit row 24). */
	async credentialStatus(ref: string): Promise<{ configured: boolean }> {
		try {
			const infos = await this.#settingsClient().credentialInfo([ref])
			return { configured: infos[ref]?.configured === true }
		} catch {
			return { configured: false }
		}
	}

	/** wave 2 (`credentials/set` — audit row 24; the login double-write's key half). */
	async login(ref: string, apiKey: string): Promise<void> {
		await this.#settingsClient().setCredential(ref, apiKey)
	}

	/** wave 2 (`credentials/unset` — audit row 24). */
	async logout(ref: string): Promise<void> {
		await this.#settingsClient().unsetCredential(ref)
	}

	/**
	 * wave 2 (`settings/describe` + `settings/mutate` — audit row 24/25). The
	 * login feature's route-registration double-write consumes this seam;
	 * describe() answers the FLAT row array the in-process seam produced.
	 */
	get settingsSeam(): { describe(): Promise<RemoteSettingsRow[]>; mutate(ns: string, ops: unknown[], revision?: number): Promise<void> } {
		const client = this.#settingsClient()
		return {
			describe: () => client.describe(),
			mutate: async (ns: string, ops: unknown[], revision?: number) => {
				await client.mutate(ns, ops, revision)
			},
		}
	}

	/** wave 2 (`settings/describe` — audit row 25; HostSession row shape). */
	async settingsDescribe(): Promise<{ ns: string; revision?: number; value?: unknown }[]> {
		try {
			return await this.#settingsClient().describe()
		} catch {
			return []
		}
	}

	/** wave 2 (`settings/mutate` — audit row 25). */
	async settingsMutate(ns: string, ops: unknown[], revision?: number): Promise<void> {
		await this.#settingsClient().mutate(ns, ops, revision)
	}

	/** wave 2 (`settings/update` — audit row 25). */
	async settingsUpdate(ns: string, patch: Record<string, unknown>, revision?: number) {
		return this.#settingsClient().update(ns, patch, revision)
	}

	/** wave 2 (`settings/replace` — audit row 25). */
	async settingsReplace(ns: string, section: Record<string, unknown>, revision?: number) {
		return this.#settingsClient().replace(ns, section, revision)
	}

	/** The raw settings document view (writable/hasDocument/namespaces). */
	async settingsDocument() {
		return this.#settingsClient().describeDocument()
	}

	/** Subscribe to `settings/document-updated` pushes (row 25). Returns a disposer. */
	onSettingsUpdated(listener: (ns: string, revision: number) => void): () => void {
		return this.#addPushListener({ onSettingsUpdated: listener })
	}

	/** Subscribe to `commands/change` pushes (row 26). Returns a disposer. */
	onHostCommandsChanged(listener: () => void): () => void {
		return this.#addPushListener({ onHostCommandsChanged: listener })
	}

	/** Subscribe to `plugin-manager/changed` pushes (row 28). Returns a disposer. */
	onPluginsChanged(listener: () => void): () => void {
		return this.#addPushListener({ onPluginsChanged: listener })
	}

	/** Subscribe to `credentials/reference-updated` pushes (row 24). Returns a disposer. */
	onCredentialUpdated(listener: (ref: string) => void): () => void {
		return this.#addPushListener({ onCredentialUpdated: listener })
	}

	/** wave 3 (workspace-local config overlay — bucket (d), audit row 41). */
	keybindingsLoad(): Record<string, string> {
		return {}
	}

	configPath(_name = "config.json"): string {
		return "client-mode config overlay lands in wave 3 (bucket d)"
	}

	configLoad(): Record<string, unknown> {
		return {}
	}

	configSave(patch: Record<string, unknown>): Record<string, unknown> {
		// In-memory only until the wave-3 overlay lands; process-local merge.
		return { ...this.configLoad(), ...patch }
	}

	/** wave 3 (client-local FS for ~/.dsh/agents/*.md — audit row 30). */
	listAgents(): { name: string; displayName?: string; description?: string; model?: string; thinking?: string; deep?: string; file: string; broken?: string }[] {
		return []
	}

	agentSet(_name: string, _field: "model" | "thinking" | "deep", _value: string): void {
		/* wave 3 */
	}

	/**
	 * wave 2 (`skills/list` — audit row 27). Sync cached: the wire catalog is
	 * session-scoped, so refresh with `refreshSkills()` once a session is
	 * live ([] until then).
	 */
	listSkills(): { name: string; description: string; invocation: string }[] {
		return [...this.#skillsCache]
	}

	/** Refresh the /skills cache from `skills/list` on the live session. */
	async refreshSkills(): Promise<{ name: string; description: string; invocation: string }[]> {
		const sessionId = this.#sessionId
		if (sessionId === undefined) return [...this.#skillsCache]
		this.#skillsCache = await this.#opsClient().skillsList(sessionId)
		return [...this.#skillsCache]
	}

	/** Wave 3 by design: no remote live reload — host restart + auto-reconnect (audit row 29). */
	async reloadPlugins(): Promise<string | undefined> {
		return "plugin reload requires a host restart in client mode"
	}

	/**
	 * wave 2 (`pluginManager/listPlugins` — audit row 28). Sync cached;
	 * `refreshPlugins()` fetches (user-installed rows only — @deepseek-ai
	 * built-ins excluded, HostSession parity), versions enriched from
	 * `pluginManager/listBundles`. The `plugin-manager/changed` push
	 * auto-refreshes.
	 */
	listPlugins(): { name: string; version: string }[] {
		return [...this.#pluginsCache]
	}

	async refreshPlugins(): Promise<{ name: string; version: string }[]> {
		try {
			const [plugins, bundles] = await Promise.all([
				this.#rpc("pluginManager/listPlugins") as Promise<unknown>,
				this.#rpc("pluginManager/listBundles").catch(() => undefined) as Promise<unknown>,
			])
			const versions = new Map<string, string>()
			if (Array.isArray(bundles)) {
				for (const b of bundles as Record<string, unknown>[]) {
					const moduleName = typeof b?.moduleName === "string" ? b.moduleName : ""
					const version = typeof b?.version === "string" ? b.version : ""
					if (moduleName && version) versions.set(moduleName, version)
				}
			}
			this.#pluginsCache = (Array.isArray(plugins) ? plugins : [])
				.map((p) => {
					const row = (typeof p === "object" && p !== null ? p : {}) as Record<string, unknown>
					const moduleName = String(row.moduleName ?? "")
					const meta = (row.meta ?? {}) as Record<string, unknown>
					const title = typeof meta.title === "string" ? meta.title : moduleName
					return { name: title, moduleName, version: versions.get(moduleName) ?? "" }
				})
				// user-installed rows only — dsh built-ins excluded (HostSession parity)
				.filter((p) => p.name && !p.moduleName.startsWith("@deepseek-ai/"))
				.map(({ name, version }) => ({ name, version }))
		} catch {
			/* keep the previous cache */
		}
		return [...this.#pluginsCache]
	}

	/** wave 3 (agentPresets read / pluginInventory probe — audit row 37). */
	executionMode(): "native" | "ptc" {
		return "native"
	}

	/** Client-local scan parity is wave 3 (audit row 31). */
	repairScan(): string[] {
		return ["repair scan runs on the client filesystem; deferred to wave 3 (client mode)"]
	}

	/** wave 2 (`session/search` — audit row 19). */
	async searchSessions(query: string): Promise<{ id: string; snippet: string }[]> {
		return this.#opsClient().searchSessions(query)
	}

	/**
	 * wave 2 (audit row 18): completed turns of the LIVE session from the
	 * follow record ledger (client-side grouping, host-session.ts:1057-1084
	 * algorithm). Empty until the session's journal has turn brackets.
	 */
	historyTurns(): { turn: number; seqEnd: number; preview: string }[] {
		return groupTurns(this.#journal)
	}

	/**
	 * wave 2 (`session/fork` — audit row 18): seed a NEW session with the
	 * live session's event prefix through `atSeq` (a historyTurns seqEnd;
	 * omission = latest completed turn), switch the facade onto it, and
	 * return the rebuilt transcript rows. Unlike the in-process seed path,
	 * the forked journal IS replayed through the follow ledger (no
	 * re-paint: the caller rebuilds the transcript from these rows).
	 */
	async forkAtTurn(seqEnd?: number): Promise<{ items: { kind: "user" | "assistant"; text: string }[]; turn: number }> {
		const sessionId = this.#sessionId
		if (sessionId === undefined) throw new Error("no live session to fork")
		const forked = await this.#opsClient().fork(sessionId, seqEnd)
		this.#sessionId = forked
		this.#follow?.reset()
		this.#resetLedger()
		await this.#attachFollow(false)
		const items = journalToTranscriptRows(this.#journal)
		const turn = this.#journal.filter((e) => e.type === "turn/end").length
		return { items, turn }
	}

	/** wave 3 (second-session flow — audit row 32). */
	async btwAsk(_question: string, _snapshot: string[], _onDelta?: (full: string) => void): Promise<string> {
		throw new Error("btw side sessions are deferred to wave 3 (client mode)")
	}

	/** wave 3 (`fileUploads/upload` — audit row 35). */
	async attachImage(_path: string): Promise<string> {
		throw new Error("attachment service unavailable in client mode (wave 3: fileUploads/upload)")
	}

	/**
	 * wave 2 (audit row 17): read-only `session/follow` watch of a session
	 * another surface drives. The durable prefix replays through the sink,
	 * live rows stream in, and reconnects repair the journal gap. Returns
	 * undefined on success, an error string otherwise (HostSession parity).
	 */
	async startRemoteTail(sessionId: string): Promise<string | undefined> {
		this.stopRemoteTail()
		this.#tail = new RemoteTailSession({
			ops: this.#opsClient(),
			socketFactory: this.#socketFactory,
			sessionId,
			sink: (rows) => {
				const sink = this.remoteTailSink
				if (sink) {
					try {
						sink(rows)
					} catch {
						/* contained */
					}
				}
			},
			connectionState: () => this.#connection.getState(),
			onStateChange: (listener) => this.#connection.onStateChange(listener),
		})
		try {
			await this.#tail.start()
			return undefined
		} catch (e) {
			this.stopRemoteTail()
			return String(e instanceof Error ? e.message : e).slice(0, 150)
		}
	}

	stopRemoteTail(): void {
		this.#tail?.stop()
		this.#tail = undefined
	}

	/** wave 3 (subagent panel aggregation — audit row 33). */
	childTranscript(_id: string): string[] {
		return []
	}

	/** wave 3 (`subagents/prompt` — audit row 33). */
	steerChild(_id: string, _text: string): boolean {
		return false
	}

	// ------------------------------------------------------------------
	// Internals — session + follow plumbing
	// ------------------------------------------------------------------

	#rpc(method: string, args?: Record<string, unknown>): Promise<unknown> {
		return this.#connection.rpc(method, args ?? {})
	}

	#opsClient(): RemoteSessionOps {
		if (this.#ops === undefined) {
			this.#ops = new RemoteSessionOps({ rpc: (method, args) => this.#rpc(method, args), socketFactory: this.#socketFactory })
		}
		return this.#ops
	}

	#modelClient(): RemoteModelClient {
		if (this.#model === undefined) {
			this.#model = new RemoteModelClient({ rpc: (method, args) => this.#rpc(method, args) })
		}
		return this.#model
	}

	#settingsClient(): RemoteSettingsClient {
		if (this.#settings === undefined) {
			this.#settings = new RemoteSettingsClient({ rpc: (method, args) => this.#rpc(method, args) })
		}
		return this.#settings
	}

	/** Forget the live session's record ledger (fresh/resumed/forked session). */
	#resetLedger(): void {
		this.#journal = []
		this.#lastDurableSeq = -1
	}

	#addPushListener(listener: RemotePushListeners): () => void {
		this.#pushListeners.push(listener)
		return () => {
			this.#pushListeners = this.#pushListeners.filter((l) => l !== listener)
		}
	}

	/**
	 * Cold-boot label (row 22): the catalog's `default` route — the host-side
	 * equivalent of the in-process agentDefaultModel.currentSelection read in
	 * host-session.ts:90-94. Best-effort: only when the label is still the
	 * generic default and no route has been chosen yet.
	 */
	async #applyColdBootLabel(): Promise<void> {
		if (this.#coldBootLabelApplied || this.label !== "dsh-host" || this.#labelBackup !== undefined) return
		this.#coldBootLabelApplied = true
		try {
			const def = await this.#modelClient().defaultSelection()
			if (def && this.label === "dsh-host") {
				this.label = `${def.provider}/${def.model}${def.reasoningEffort ? ` (${def.reasoningEffort})` : ""}`
			}
		} catch {
			/* optional service; keep the generic label */
		}
	}

	/** Create or reuse the session, then make sure its follow stream is open. */
	async #ensureSession(): Promise<string> {
		if (this.#sessionId !== undefined && this.#follow?.attached) return this.#sessionId
		if (this.#sessionId !== undefined && this.#follow && !this.#follow.attached) {
			await this.#attachFollow(false)
			return this.#sessionId
		}
		const requestedId = this.#resumeId ?? randomUUID()
		this.#resumeId = undefined
		const request: Record<string, unknown> = { cwd: this.#cwd, sessionId: requestedId }
		if (this.#presetId !== undefined) request.agentPreset = this.#presetId
		let value: Record<string, unknown>
		try {
			value = (await this.#rpc("session/create", { request })) as Record<string, unknown>
		} catch (error) {
			if (error instanceof RemoteRpcError && error.code === "session/writer-held") {
				throw new Error("session is being driven by another process (phone/web) — send again later to re-take it, or /new for a fresh session")
			}
			throw error
		}
		// The host may reuse a DIFFERENT session than requested (blank-reuse
		// rules are host-native, row 12) — its answer wins.
		this.#sessionId = typeof value.sessionId === "string" ? value.sessionId : requestedId
		if (typeof value.agentPreset === "string" && value.agentPreset) this.#presetId = value.agentPreset
		// A staged model selection (switchModel with no live session) applies
		// to the fresh session before its first prompt.
		if (this.#pendingModel !== undefined && this.#sessionId !== undefined) {
			const staged = this.#pendingModel
			this.#pendingModel = undefined
			try {
				await this.#modelClient().selectModel(this.#sessionId, staged)
			} catch (error) {
				console.error("[remote-host-session] staged selectModel failed:", error)
			}
		}
		// Attach BEFORE the first prompt so no live frame is missed.
		await this.#attachFollow(false)
		return this.#sessionId
	}

	#attachFollow(replay: boolean): Promise<RemoteFollowOpening> {
		if (this.#follow === undefined) {
			this.#follow = new RemoteFollowSession({
				socketFactory: this.#socketFactory,
				sink: this.#followSink(),
				onDetached: () => this.#onFollowDetached(),
			})
		}
		return this.#follow.attach(this.#sessionId!, replay)
	}

	#followSink() {
		return {
			// Durable record ledger (wave 2): /history grouping + fork points +
			// the reconnect gap-repair base all read this.
			onRecord: (entry: RemoteJournalEntry) => {
				if (entry.seq > this.#lastDurableSeq) this.#lastDurableSeq = entry.seq
				this.#journal.push(entry)
				if (this.#journal.length > 4000) this.#journal.shift()
			},
			onContentDelta: (text: string) => {
				try {
					this.#cb?.onContentDelta(text)
					this.#ticker.add(text.length)
				} catch {
					/* a UI callback must never take the pump down */
				}
			},
			onThinkingDelta: (text: string) => {
				try {
					this.#cb?.onThinkingDelta(text)
					this.#ticker.add(text.length)
				} catch {
					/* ditto */
				}
			},
			onUsage: (usage: { prompt: number; completion: number; cacheRead: number; cacheWrite: number }) => {
				// host-session.ts:1269-1272 semantics, verified on the live wire:
				// every chunk ASSIGNS the fields it reports (completion is the
				// one session accumulator). On cache-splitting adapters (zai)
				// prompt is the UNCACHED input only — the request's context size
				// is prompt + cacheRead + cacheWrite.
				if (usage.prompt > 0) this.usage.prompt = usage.prompt
				if (usage.completion > 0) this.usage.completion += usage.completion
				if (usage.cacheRead > 0) this.usage.cacheRead = usage.cacheRead
				if (usage.cacheWrite > 0) this.usage.cacheWrite = usage.cacheWrite
			},
			onToolStart: (start: { callId?: string; name: string; args: string }) => {
				try {
					this.#cb?.onToolStart?.(start)
				} catch {
					/* contained */
				}
			},
			onToolRun: (run: RemoteToolRun) => {
				try {
					this.#cb?.onToolRun(run)
				} catch {
					/* contained */
				}
			},
			onTodos: (todos: RemoteTodoItem[]) => {
				try {
					this.#cb?.onTodos?.(todos)
				} catch {
					/* contained */
				}
			},
			onTurnEnd: (data: Record<string, unknown>) => {
				const message = turnEndErrorMessage(data)
				if (message !== undefined) {
					try {
						this.#cb?.onError(message)
					} catch {
						/* contained */
					}
				}
				this.#finishTurn()
			},
			onMissedRows: (rows: RemoteTranscriptRow[]) => {
				try {
					this.#cb?.onReattachedMissed?.(rows)
				} catch {
					/* contained */
				}
			},
		}
	}

	/** Turn-end telemetry + settle (host-session.ts #finishTurn parity). */
	#finishTurn(): void {
		if (this.#resolveTurn === undefined) return
		const endedAt = Date.now()
		this.#ticker.finish()
		const chars = this.#ticker.chars()
		const ms = Math.max(0, endedAt - this.#turnStartedAt)
		const completion = this.usage.completion - this.#turnUsageStart.completion
		const real = completion > 0
		const tokens = real ? completion : estimateTokens(chars)
		this.lastTurnStats = {
			startedAt: this.#turnStartedAt,
			endedAt,
			ms,
			chars,
			tokens,
			tps: tokensPerSecond(tokens, ms),
			estimated: !real,
		}
		// Order parity: freeze stats, fire onTurnEnd, THEN resolve the awaited
		// turn (a resolved await lets ShellHost's send() finally-block drain
		// the queue into a new turn — onTurnEnd must paint first).
		const resolve = this.#resolveTurn
		this.#resolveTurn = undefined
		this.#awaiting = false
		const cb = this.#cb
		try {
			cb?.onTurnEnd({ prompt: this.usage.prompt, completion: this.usage.completion })
		} catch {
			/* contained */
		}
		resolve?.()
	}

	/** Resolve the awaited turn without onTurnEnd (abort/dispose parity). */
	#settleTurnWithoutEnd(): void {
		const resolve = this.#resolveTurn
		this.#resolveTurn = undefined
		this.#awaiting = false
		resolve?.()
	}

	// ------------------------------------------------------------------
	// Internals — $events routing (waterfalls)
	// ------------------------------------------------------------------

	#onEventsItem(item: EventsItem): void {
		if (item.type === "emit") this.#onEmitEvent(item.event, item.args)
		if (item.type !== "waterfall") return
		// `cancel` items: the overlay is ShellHost's; a host-cancelled
		// waterfall is dropped bookkeeping-free in wave 1 (a late answer to a
		// cancelled eventId is a server-side no-op).
		const waterfall = this.#waterfall
		if (waterfall === undefined) {
			console.error("[remote-host-session] waterfall before start() completed; cannot answer:", item.event)
			return
		}
		if (!waterfall.claims(item, this.#sessionId)) {
			// Not ours — hand it back so another surface's listener can claim.
			void waterfall.delegate(item.eventId).catch((error) => {
				console.error("[remote-host-session] waterfall delegation failed:", error)
			})
			return
		}
		if (item.event === "approval/request") void this.#onApprovalRequest(waterfall, item)
		else if (item.event === "user-questions/request") void this.#onQuestionsRequest(waterfall, item)
		else {
			void waterfall.delegate(item.eventId).catch((error) => {
				console.error("[remote-host-session] unclaimed waterfall delegation failed:", error)
			})
		}
	}

	async #onApprovalRequest(waterfall: WaterfallAnswerer, frame: EventsWaterfall): Promise<void> {
		const cb = this.#cb
		const { toolName, callId } = WaterfallAnswerer.approvalView(frame)
		if (cb === undefined) {
			await waterfall.answerApproval(frame.eventId, "unavailable")
			return
		}
		// Approval args from the follow ledger (the forwarded request strips
		// the agent object that used to carry session.eventAt lookup).
		let args: Record<string, unknown> = {}
		if (callId !== undefined) {
			const raw = this.#follow?.toolArgs(callId)
			if (raw) {
				try {
					args = JSON.parse(raw) as Record<string, unknown>
				} catch {
					/* show whatever we have */
				}
			}
		}
		let verdict: RemoteApprovalVerdict
		try {
			const ok = await cb.onApprove(toolName, args)
			verdict = ok ? "allowed-once" : "rejected"
		} catch {
			verdict = "unavailable" // fail closed, same as the in-process contract
		}
		try {
			await waterfall.answerApproval(frame.eventId, verdict)
		} catch (error) {
			console.error("[remote-host-session] approval answer failed:", error)
		}
	}

	async #onQuestionsRequest(waterfall: WaterfallAnswerer, frame: EventsWaterfall): Promise<void> {
		const questions = WaterfallAnswerer.questionsView(frame)
		if (questions.length === 0 || this.#askProvider === undefined) {
			await waterfall.delegate(frame.eventId)
			return
		}
		let value: RemoteJson
		try {
			const picks = await this.#askProvider(questions)
			value = WaterfallAnswerer.answersValue(questions, picks)
		} catch {
			value = WaterfallAnswerer.declinedValue(questions)
		}
		try {
			await waterfall.answer(frame.eventId, value)
		} catch (error) {
			console.error("[remote-host-session] user-questions answer failed:", error)
		}
	}

	// ------------------------------------------------------------------
	// Internals — $events routing (forwarded emits)
	// ------------------------------------------------------------------

	/**
	 * Forwarded `emit` frames (the allowlist the host forwards: rows 24/25/
	 * 26/28 push events). Args are the emitted event's positional arguments.
	 */
	#onEmitEvent(event: string, args: unknown): void {
		const argv = Array.isArray(args) ? args : []
		if (event === "settings/document-updated") {
			const ns = typeof argv[0] === "string" ? argv[0] : ""
			const revision = typeof argv[1] === "number" ? argv[1] : 0
			for (const listener of this.#pushListeners) {
				try {
					listener.onSettingsUpdated?.(ns, revision)
				} catch {
					/* contained */
				}
			}
			return
		}
		if (event === "commands/change") {
			for (const listener of this.#pushListeners) {
				try {
					listener.onHostCommandsChanged?.()
				} catch {
					/* contained */
				}
			}
			return
		}
		if (event === "plugin-manager/changed") {
			// the profile's plugins changed: refresh the sync cache, then notify
			void this.refreshPlugins()
				.catch(() => {})
				.then(() => {
					for (const listener of this.#pushListeners) {
						try {
							listener.onPluginsChanged?.()
						} catch {
							/* contained */
						}
					}
				})
			return
		}
		if (event === "credentials/reference-updated") {
			const ref = typeof argv[0] === "string" ? argv[0] : ""
			for (const listener of this.#pushListeners) {
				try {
					listener.onCredentialUpdated?.(ref)
				} catch {
					/* contained */
				}
			}
			return
		}
		// Other forwarded emits (api-session/*, agent-preset/selected, …) have
		// no wave-2 consumer; they stay observable through connection.onEvent.
	}

	// ------------------------------------------------------------------
	// Internals — generation change (reconnect) re-attach
	// ------------------------------------------------------------------

	#onConnectionState(state: "connecting" | "connected" | "disconnected"): void {
		if (state === "connected") this.#scheduleReattach()
	}

	#onFollowDetached(): void {
		if (this.#disposed || this.#sessionId === undefined) return
		if (this.#awaiting) this.#setReconnecting(true)
		// If the carrier is already `connected` again, nothing else will
		// announce it — retry from here; otherwise the state listener fires.
		if (this.#connection.getState() === "connected") this.#scheduleReattach()
	}

	#scheduleReattach(): void {
		if (this.#disposed || this.#sessionId === undefined) return
		if (this.#follow?.attached || this.#reattachTimer !== undefined || this.#reattachInFlight) return
		this.#reattachTimer = setTimeout(() => {
			this.#reattachTimer = undefined
			void this.#reattach()
		}, 0)
		this.#reattachTimer.unref?.()
	}

	async #reattach(): Promise<void> {
		if (this.#disposed || this.#sessionId === undefined || this.#reattachInFlight) return
		if (this.#follow?.attached) return
		this.#reattachInFlight = true
		if (this.#awaiting) this.#setReconnecting(true)
		try {
			const journalBefore = this.#journal.length
			const seqBefore = this.#lastDurableSeq
			const opening = await this.#attachFollow(true)
			this.#reattachAttempts = 0
			await this.#repairJournalGap(opening, journalBefore, seqBefore)
			this.#setReconnecting(false)
		} catch {
			this.#reattachAttempts += 1
			if (this.#reattachAttempts >= REATTACH_MAX_ATTEMPTS) {
				this.#reattachAttempts = 0
				this.#setReconnecting(false)
				try {
					this.#cb?.onError("connection lost — the host did not come back within the re-attach window")
				} catch {
					/* contained */
				}
				this.#finishTurn()
			} else {
				this.#scheduleReattachRetry()
			}
		} finally {
			this.#reattachInFlight = false
		}
	}

	/**
	 * Journal-tail page gap repair (wave-2 polish): the follow snapshot's
	 * opening window may not reach back to the last durable seq painted
	 * before the gap. When it cannot, `session/page` fills the missing span
	 * and the extra rows ride onReattachedMissed (after the snapshot rows —
	 * ordering: page rows are OLDER, but they arrive with the snapshot's own
	 * rows already painted, so the caller sees one batched history).
	 */
	async #repairJournalGap(opening: RemoteFollowOpening, journalBefore: number, seqBefore: number): Promise<void> {
		if (seqBefore < 0 || opening.cursor <= seqBefore) return
		const appended = this.#journal.slice(journalBefore)
		const oldest = appended.length > 0 ? Math.min(...appended.map((e) => e.seq)) : opening.cursor + 1
		if (oldest <= seqBefore + 1) return // snapshot window reached back; no gap
		try {
			const gap = await this.#opsClient().pageSpan(this.#sessionId!, seqBefore, oldest - 1)
			const missing = gap.filter((e) => e.seq > seqBefore && !this.#journal.some((j) => j.seq === e.seq))
			if (missing.length === 0) return
			for (const entry of missing) {
				if (entry.seq > this.#lastDurableSeq) this.#lastDurableSeq = entry.seq
				this.#journal.push(entry)
			}
			const rows = journalToTranscriptRows(sortJournal(missing))
			if (rows.length > 0) {
				try {
					this.#cb?.onReattachedMissed?.(rows)
				} catch {
					/* contained */
				}
			}
		} catch {
			/* gap repair is best-effort; the live stream is already back */
		}
	}

	#scheduleReattachRetry(): void {
		if (this.#disposed || this.#reattachTimer !== undefined) return
		this.#reattachTimer = setTimeout(() => {
			this.#reattachTimer = undefined
			void this.#reattach()
		}, REATTACH_RETRY_MS)
		this.#reattachTimer.unref?.()
	}

	/** The wave-1 reconnecting marker: the label swap the UI already reads. */
	#setReconnecting(on: boolean): void {
		if (on) {
			if (this.#labelBackup === undefined) {
				this.#labelBackup = this.label
				this.label = "reconnecting…"
			}
		} else if (this.#labelBackup !== undefined) {
			this.label = this.#labelBackup
			this.#labelBackup = undefined
		}
	}
}

/** Re-export for the tests and the future ShellHostDeps swap. */
export { openRemoteStream, type RemoteStreamHandle }
