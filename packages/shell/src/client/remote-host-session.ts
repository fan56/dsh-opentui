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
 * Wave-3 rows (this class + the remote-* helpers under src/client/) —
 * v1 FULL parity, no degradations (ADR-0005 user decision; the
 * single-machine topology makes client-local FS/process legitimate):
 *  30      /agents — client-local FS over `<dshHome>/agents/*.md`
 *          (listAgentFiles/setAgentField, host-session.ts:453-507
 *          semantics; the write path fixes that file's dead
 *          frontmatter-insert branch — see remote-local-fs.ts header)
 *  31      /repair — client-local session-store scan
 *          (repairScanSessions, host-session.ts:653-711 parity)
 *  29      /reload — same-port host restart
 *          (restartSamePortHost over the lifecycle lockfile contract) +
 *          the carrier's own reconnect + the wave-2 follow re-attach;
 *          a `restartHost` option overrides for custom topologies
 *  32      /btw — one throwaway remote session (create + follow +
 *          prompt), REUSED across questions, renamed `btw: …` and
 *          filtered from listSessions (the wire has no session delete —
 *          remote-btw.ts header documents the pollution choice)
 *  33      subagent panel — `session/list` (parentSessionId +
 *          origin:'subagent') + `api-session/added|removed|status`
 *          pushes + parent-journal tool-workflow pairing
 *          (RemoteSubagentPanel); child transcript via `session/follow`
 *          with `address.kind:'subagent'`; steer via `subagents/prompt`
 *          (host `subagent/not-resumable` policy on one-shot children
 *          surfaces as the in-process steerChild false shape, typed
 *          reason via steerChildDetailed); interrupt via
 *          `subagents/interruptByParent`
 *  35      /attach — local read + validation staged at call time, the
 *          next prompt carries the INLINE image part
 *          `{type:'image', mediaType, data, name}` (the chosen wire route:
 *          the host admits it to a durable ImageAttachmentRef, which is
 *          what `session/attachment` reads back — the receipt route mints
 *          FILE refs the read-back RPC cannot serve, live-verified;
 *          remote-attachments.ts documents the choice); admitted ids
 *          surface via lastAttachmentIds() from the journal
 *  36      tool-result images — `GET /api/file?path=` bytes helper
 *          (fetchHostFile); the renderer keeps the local path (single
 *          machine)
 *  37      executionMode — cached probe of `agentPresets/read`'s
 *          entry-list document for the `tool-presentation` row's
 *          `mode` (the in-process shadowing rule); no preset row →
 *          "native" (the deployment default is not queryable over the
 *          wire — remote-exec-mode.ts header documents the exact
 *          reason; pluginInventory carries no config and is NOT usable)
 *  39      git segment — client-local `git branch --show-current` probe
 *          in the workspace cwd (probeGitBranch, ShellHost.tsx:277-295
 *          semantics; the renderer keeps its own identical probe)
 *  41      config seam — the workspace overlay (bucket (d),
 *          loadWorkspaceConfig/mergeConfig/saveWorkspaceConfig, frozen
 *          API) wired into the HostSession config surface: configLoad()
 *          = profile config.json (base) ⊕ workspace config.yml (model;
 *          legacy theme keys still win the read) ⊕ env; configSave
 *          routes `theme` and the plugin keys (retentionDays,
 *          favorites, …) into the profile config.json and `model` into
 *          config.yml — HostSession persistence parity on the same
 *          files plugin mode used (single machine)
 */

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join as joinPath } from "node:path"
import type { StoredTranscriptRow } from "./seam-types.ts"
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
import { listAgentFiles, repairScanSessions, resolveDshHome, setAgentField } from "./remote-local-fs.ts"
import { probeGitBranch } from "./remote-git.ts"
import { toolPresentationModeFromPresetDocument } from "./remote-exec-mode.ts"
import {
	attachmentIdsOfPromptContent,
	fetchHostFile,
	imagePromptPart,
	readImageAttachment,
	readSessionAttachment,
	type StagedImageUpload,
} from "./remote-attachments.ts"
import { askBtw, BTW_TITLE_PREFIX } from "./remote-btw.ts"
import { RemoteSubagentPanel, type RemoteSubagentView } from "./remote-subagents.ts"
import { DEFAULT_SUBAGENT_ROUND_LIMITS, limitsFromSettingsRows, type SubagentRoundLimits } from "../subagent-policy.ts"
import { restartSamePortHost } from "./remote-restart.ts"
import {
	loadWorkspaceConfig,
	mergeConfig,
	saveWorkspaceConfig,
	workspaceConfigPath,
	type ModelPrefs,
	type WorkspaceOverlay,
} from "./workspace-config.ts"

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
	/**
	 * Workspace for the `./.dsh/config.yml` overlay (row 41); default = the
	 * `cwd` above (ADR-0005 decision 1: the workspace IS the launch cwd).
	 */
	workspaceDir?: string
	/**
	 * dsh home for the client-local clusters — /agents, /repair, the
	 * profile config base and the /reload restart (rows 30/31/41/29);
	 * default `$DSH_HOME` or `~/.dsh` (HostSession parity).
	 */
	dshHome?: string
	/** Host profile name (profile config paths + restart); default `opentui`. */
	profile?: string
	/**
	 * /reload override (row 29): bring the host back on the SAME authority
	 * and resolve when it accepts connections again (the carrier reconnects
	 * by itself; the wave-2 re-attach machinery resumes the session).
	 * Default: restartSamePortHost over the lifecycle lockfile contract.
	 */
	restartHost?: (reason: string) => Promise<void>
	/**
	 * Re-attach retry cadence override (P2 budget; default REATTACH_RETRY_MS
	 * = 1s). Injectable so the budget-alignment test can compress time.
	 */
	reattachRetryMs?: number
	/** Re-attach attempt cap override (P2 budget; default REATTACH_MAX_ATTEMPTS = 30). */
	reattachMaxAttempts?: number
}

const REATTACH_RETRY_MS = 1_000

/** Turn/settle trace (DSH_OPENTUI_DEBUG): the turn-end finalization path the
 * batch-9b hang was chased through — onTurnEnd receipt, finish/settle, follow
 * detach/reattach. Timestamped stderr, one line per event. */
function trace(message: string): void {
	if (!process.env.DSH_OPENTUI_DEBUG) return
	process.stderr.write(`[rhs ${new Date().toISOString().slice(11, 23)}] ${message}\n`)
}
/**
 * Re-attach budget (P2): must cover a same-port host restart (/reload), whose
 * own budget is `readinessTimeoutMs ?? 30_000` (remote-restart.ts) — the
 * fresh host may legitimately need that long to listen again, and only THEN
 * can the carrier reconnect and these retries succeed. 10×1s used to give up
 * (and error the awaiting turn) ~20s before the restart budget ran out.
 * Exports exist for the budget-alignment test.
 */
const REATTACH_MAX_ATTEMPTS = 30
export { REATTACH_RETRY_MS, REATTACH_MAX_ATTEMPTS }

/**
 * The client-mode session facade. Wave-1 rows are fully functional; the
 * remaining HostSession surface is present with graceful stubs so the
 * rendering layer can swap the injection point without shape drift.
 */
export class RemoteHostSession {
	label = "dsh-host"
	/** Cumulative token telemetry (assignment/addition semantics per chunk). */
	usage = { prompt: 0, completion: 0, cacheRead: 0, cacheWrite: 0 }

	// ---- cacheHitMode bookkeeping (batch F2, tui-pi parity; host-session.ts
	// twin): session-cumulative billing totals over ALL usage frames plus the
	// latest billed request's own hit rate. The `usage` fields above stay
	// assignment-semantics (the 🧠 segment reads latest); these accumulate.
	#cachePromptTotal = 0
	#cacheReadTotal = 0
	#cacheWriteTotal = 0
	#lastMessageCacheHitRate: number | null = null
	/** Telemetry of the last completed turn (HostSession shape). */
	lastTurnStats: TurnStats = emptyTurnStats()
	remoteTailActive = false
	remoteTailSink: ((rows: { kind: string; text: string; final: boolean }[]) => void) | null = null

	readonly #connection: ClientConnection
	readonly #cookieHeader: string
	readonly #baseUrl: string
	readonly #socketFactory: MuxSocketFactory
	readonly #cwd: string
	readonly #workspaceDir: string
	readonly #dshHome: string
	readonly #profile: string
	readonly #restartHost: ((reason: string) => Promise<void>) | undefined

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
	// ---- decode-window timing (batch F4, /session panel; host-session twin) ----
	// First streamed delta → last delta (settle): the real decode window,
	// excluding the pre-first-token prompt latency the whole-turn TurnStats.ms
	// carries. Session totals feed the panel's average; unknown reads null.
	#firstDeltaAt = 0
	#lastDeltaAt = 0
	#decodeTotals = { tokens: 0, ms: 0 }
	#lastDecode = { tokens: 0, ms: 0 }
	#ticker = createStreamTicker((t) => this.#cb?.onStreamTick?.(t))
	#disposed = false
	#disposers: (() => void)[] = []
	#reattachTimer: ReturnType<typeof setTimeout> | undefined
	#reattachInFlight = false
	#reattachAttempts = 0
	/** P2 budget (cadence × cap); defaults match the restart readiness budget. */
	readonly #reattachRetryMs: number
	readonly #reattachMaxAttempts: number
	#labelBackup: string | undefined
	/** Wave-2 ops surfaces (lazy: built on first use after start()). */
	#ops: RemoteSessionOps | undefined
	#model: RemoteModelClient | undefined
	#settings: RemoteSettingsClient | undefined
	/** Durable record ledger of the LIVE session (/history + fork + gap repair). */
	#journal: RemoteJournalEntry[] = []
	/** Batch 9a: external journal observers (SessionSeam adapter event feed). */
	#journalListeners: ((entry: RemoteJournalEntry) => void)[] = []
	/** Highest durable seq painted for the live session (gap-repair base). */
	#lastDurableSeq = -1
	/**
	 * The durable-seq watermark when the CURRENT awaited turn armed (batch 9b).
	 * A `turn/end` journal record with `seq > #turnArmSeq` observed through the
	 * reattach snapshot path means the awaited turn ended while the follow
	 * stream was blind — the snapshot folds it as settled history (remote-follow
	 * never settles a live await from a snapshot), so the reattach must settle
	 * it here (batch-9b hang fix).
	 */
	#turnArmSeq = -1
	/** Foreign-session tail watch (row 17). */
	#tail: RemoteTailSession | undefined
	/** Cached /plugins rows (sync listPlugins contract; refreshed async). */
	#pluginsCache: { name: string; version: string }[] = []
	/** Cached /skills rows (sync listSkills contract; refreshed async). */
	#skillsCache: { name: string; description: string; invocation: string }[] = []
	/** Push-event listeners (settings/commands/plugins/credentials). */
	#pushListeners: RemotePushListeners[] = []
	#coldBootLabelApplied = false
	/** Wave-3: cached executionMode verdict (row 37; probed on preset adoption). */
	#executionMode: "native" | "ptc" = "native"
	/** Wave-3: staged image uploads consumed by the next turn (row 35). */
	#pendingUploads: StagedImageUpload[] = []
	/** Wave-3: the /btw throwaway session (reused across questions, row 32). */
	#btwSessionId: string | undefined
	/** Wave-3: the pid the last same-port restart spawned (row 29 supervision). */
	#lastRestartPid: number | undefined
	/** Wave-3: concurrent /btw guard (one side call at a time). */
	#btwBusy = false
	/** Wave-3: subagent panel (row 33; lazy). */
	#subagents: RemoteSubagentPanel | undefined
	// ---- maxRounds hard-stop policy knobs (batch F1) ----
	// The `dsh-opentui` settings snapshot the subagent panel's ladder reads;
	// refreshed lazily (one in-flight describe at a time). The client face
	// resolves the GLOBAL cap only — agent .md files are host-side.
	#roundLimits: SubagentRoundLimits = { ...DEFAULT_SUBAGENT_ROUND_LIMITS }
	#roundLimitsRefreshing = false
	/** Wave-3: workspace overlay cache — configLoad merges it over the base (row 41). */
	#overlayCache: WorkspaceOverlay | undefined

	constructor(options: RemoteHostSessionOptions) {
		this.#connection = options.connection
		this.#cookieHeader = options.cookieHeader
		this.#baseUrl = options.baseUrl ?? options.connection.baseUrl
		this.#cwd = options.cwd ?? process.cwd()
		this.#workspaceDir = options.workspaceDir ?? this.#cwd
		this.#dshHome = resolveDshHome(options.dshHome)
		this.#profile = options.profile ?? "opentui"
		this.#restartHost = options.restartHost
		this.#reattachRetryMs = options.reattachRetryMs ?? REATTACH_RETRY_MS
		this.#reattachMaxAttempts = options.reattachMaxAttempts ?? REATTACH_MAX_ATTEMPTS
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
		void this.#refreshWorkspaceOverlay()
		void this.#probeExecutionMode()
		// Warm the /plugins sync cache (listPlugins was push-refreshed ONLY —
		// without a boot warm the client-face /plugins panel read an empty
		// cache and rendered the "no plugins installed" fallback). Skipped
		// when a push already populated the cache (no redundant RPC).
		// Contained: an RPC miss keeps the previous (empty) cache.
		if (this.#pluginsCache.length === 0) void this.refreshPlugins().catch(() => {})
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
		this.#subagents?.stop()
		this.#subagents = undefined
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

	/**
	 * Public follow-journal hook (batch 9a, additive — the SessionSeam
	 * adapter's event feed): fires for every durable record the follow pump
	 * appends to the live session's ledger. Listeners' exceptions are
	 * contained. Returns a disposer.
	 */
	onJournalRecord(listener: (entry: RemoteJournalEntry) => void): () => void {
		this.#journalListeners.push(listener)
		return () => {
			this.#journalListeners = this.#journalListeners.filter((l) => l !== listener)
		}
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
		// /attach staging (row 35): the inline image part carries the bytes
		// on THIS prompt; the host admits them to durable references before
		// the message is created (chosen route — see remote-attachments.ts).
		const attachmentParts = this.#pendingUploads.map(imagePromptPart)
		this.#pendingUploads = []
		await this.#rpc("session/prompt", {
			request: {
				requestId,
				sessionId,
				mode: "queue",
				content: [{ type: "text", text: userText }, ...attachmentParts],
			},
		})
		this.#promptInFlight = false
		// abort()/dispose() raced the prompt RPC: the cancel was already sent
		// and the turn was already settled — do not start awaiting now.
		if (this.#interrupted || this.#disposed) return
		this.#awaiting = true
		this.#turnArmSeq = this.#lastDurableSeq
		trace(`turn armed awaiting session=${sessionId} armSeq=${this.#turnArmSeq}`)
		await new Promise<void>((resolve) => {
			this.#resolveTurn = resolve
		})
		trace("turn await RESOLVED")
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

	/** Cache hit rate in percent when the host reports cache traffic.
	 * The mode picks the sample (batch F2, tui-pi parity; host-session.ts
	 * twin): "session" — the session-cumulative rate ΣcacheRead /
	 * (Σprompt + ΣcacheRead + ΣcacheWrite); the default ("lastMessage") —
	 * the latest billed request's own rate. The visibility gate stays
	 * session-scope in both modes: null until ANY cache traffic. */
	cacheHitRate(mode?: "session" | "lastMessage"): number | null {
		const total = this.#cacheReadTotal + this.#cacheWriteTotal
		if (total <= 0) return null
		if (mode === "session") {
			const billed = this.#cachePromptTotal + total
			return billed > 0 ? (this.#cacheReadTotal / billed) * 100 : null
		}
		return this.#lastMessageCacheHitRate
	}

	/** One streamed delta landed — widen this turn's decode window (F4). */
	#noteDelta(): void {
		const now = Date.now()
		if (this.#firstDeltaAt === 0) this.#firstDeltaAt = now
		this.#lastDeltaAt = now
	}

	/** /session panel snapshot (batch F4; host-session.ts twin).
	 * messageCount is adapter-side (the facade has no transcript cache). */
	sessionInfo(): {
		sessionId: string | undefined
		model: string | undefined
		turnCount: number
		tokensIn: number
		tokensOut: number
		cacheRead: number
		cacheWrite: number
		lastTurnTps: number | null
		sessionAvgTps: number | null
	} {
		return {
			sessionId: this.currentSessionId(),
			model: this.label === "dsh-host" ? undefined : this.label,
			turnCount: this.#turns,
			tokensIn: this.usage.prompt,
			tokensOut: this.usage.completion,
			cacheRead: this.usage.cacheRead,
			cacheWrite: this.usage.cacheWrite,
			lastTurnTps:
				this.#lastDecode.ms > 0
					? tokensPerSecond(this.#lastDecode.tokens, this.#lastDecode.ms)
					: this.lastTurnStats.tps,
			sessionAvgTps: tokensPerSecond(this.#decodeTotals.tokens, this.#decodeTotals.ms),
		}
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
	async listSessions(limit = 12): Promise<{ id: string; title: string; updatedAt?: string; cwd?: string; sizeBytes?: number }[]> {
		const cfg = this.configLoad()
		const retentionDays = Number(cfg.retentionDays ?? 0)
		const rows = await this.#opsClient().listSessions({ limit, ...(Number.isFinite(retentionDays) && retentionDays > 0 ? { retentionDays } : {}) })
		// /btw pollution cap (row 32): marker-titled throwaway rows stay in
		// the store (no delete RPC) but never surface in /sessions.
		return rows.filter((row) => !row.title.startsWith(BTW_TITLE_PREFIX)).slice(0, limit)
	}

	/** wave 2 (`session/page` over the follow snapshot — audit row 14).
	 * Rows include the ask_user_question Q&A rows ("ask") from the
	 * durable tool pair — resume replays the Q&A block. */
	async storedTranscript(id: string, skip = 0): Promise<StoredTranscriptRow[]> {
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
		void this.#probeExecutionMode()
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
		this.#invalidateModelCatalog()
	}

	/** wave 2 (`credentials/unset` — audit row 24). */
	async logout(ref: string): Promise<void> {
		await this.#settingsClient().unsetCredential(ref)
		this.#invalidateModelCatalog()
	}

	/**
	 * wave 2 (`settings/describe` + `settings/mutate` — audit row 24/25). The
	 * login feature's route-registration double-write consumes this seam;
	 * describe() answers the FLAT row array the in-process seam produced.
	 * Every mutate invalidates the model catalog: the route registration IS
	 * the /login (resp. removal IS the /logout) half — without the drop the
	 * /model picker kept serving the pre-commit cached catalog.
	 */
	get settingsSeam(): { describe(): Promise<RemoteSettingsRow[]>; mutate(ns: string, ops: unknown[], revision?: number): Promise<void> } {
		const client = this.#settingsClient()
		return {
			describe: () => client.describe(),
			mutate: async (ns: string, ops: unknown[], revision?: number) => {
				await client.mutate(ns, ops, revision)
				this.#invalidateModelCatalog()
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
		this.#invalidateModelCatalog()
	}

	/** wave 2 (`settings/update` — audit row 25). */
	async settingsUpdate(ns: string, patch: Record<string, unknown>, revision?: number) {
		const row = await this.#settingsClient().update(ns, patch, revision)
		this.#invalidateModelCatalog()
		return row
	}

	/** wave 2 (`settings/replace` — audit row 25). */
	async settingsReplace(ns: string, section: Record<string, unknown>, revision?: number) {
		const row = await this.#settingsClient().replace(ns, section, revision)
		this.#invalidateModelCatalog()
		return row
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

	// ------------------------------------------------------------------
	// Wave-3 config seam (row 41) — workspace overlay + profile base
	// ------------------------------------------------------------------

	/** Path of the profile-root keybindings.json (sibling of config.json). */
	keybindingsLoad(): Record<string, string> {
		try {
			return JSON.parse(readFileSync(this.configPath("keybindings.json"), "utf8"))
		} catch {
			return {}
		}
	}

	/**
	 * Config file paths (HostSession parity with client-mode semantics):
	 * the overlay file (`config.yml`) lives in the WORKSPACE (`./.dsh/`,
	 * ADR-0005 decision 4); every other file (config.json base,
	 * keybindings.json) lives in the dsh-home PROFILE root — the same files
	 * plugin mode used (single machine shares the profile dir).
	 */
	configPath(name = "config.json"): string {
		if (name === "config.yml") return workspaceConfigPath(this.#workspaceDir)
		return joinPath(this.#dshHome, "profiles", this.#profile, name)
	}

	/**
	 * The merged config the UI consumes (row 41): profile config.json
	 * (plugin keys: retentionDays, favoriteModels, …) overlaid by the
	 * workspace config.yml (theme + model) and the environment — the
	 * bucket-(d) precedence (env > workspace > profile). The overlay cache
	 * warms at start(); before that the base alone answers.
	 */
	configLoad(): Record<string, unknown> {
		let base: Record<string, unknown> = {}
		try {
			base = JSON.parse(readFileSync(this.configPath(), "utf8")) as Record<string, unknown>
		} catch {
			/* missing profile config: empty base */
		}
		const merged = mergeConfig(base as { theme?: string; model?: ModelPrefs }, this.#overlayCache ?? {}, process.env as Record<string, string>)
		return { ...base, ...merged }
	}

	/**
	 * Persist a config patch (HostSession sync-merge parity): `theme` and
	 * the plugin keys go to the profile config.json (the F7b contract —
	 * /theme persists as the profile's `"theme"` key, host-entry-v2 parity;
	 * a per-workspace theme store would hide the preference from the
	 * profile the e2e and the host face read), `model` goes to the
	 * workspace config.yml (saveWorkspaceConfig, frozen API — atomic 0600,
	 * credential guard). The returned value is the merged view; the
	 * workspace write is async (the cache updates optimistically and
	 * reverts + logs on failure). Legacy overlays that still carry a
	 * `theme:` key keep winning the read (mergeConfig precedence) until
	 * the file is cleaned up — configSave no longer writes one.
	 */
	configSave(patch: Record<string, unknown>): Record<string, unknown> {
		const overlayPatch: WorkspaceOverlay = {}
		const rest: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(patch)) {
			if (key === "model") overlayPatch.model = (typeof value === "object" && value !== null ? (value as ModelPrefs) : undefined)
			else rest[key] = value
		}
		if (Object.keys(overlayPatch).length > 0) {
			const previous = this.#overlayCache
			const next = { ...(previous ?? {}), ...overlayPatch }
			this.#overlayCache = next // optimistic; reverted below on failure
			void saveWorkspaceConfig(this.#workspaceDir, next).catch((error: unknown) => {
				this.#overlayCache = previous
				console.error("[remote-host-session] workspace config save failed:", error)
			})
		}
		if (Object.keys(rest).length > 0) {
			const merged = { ...this.#readProfileConfig(), ...rest }
			const profileDir = joinPath(this.#dshHome, "profiles", this.#profile)
			if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true })
			writeFileSync(this.configPath(), JSON.stringify(merged, null, 2) + "\n")
		}
		return this.configLoad()
	}

	/**
	 * Re-read the workspace overlay and apply its model prefs (row 41
	 * application point): with no live session and no user-chosen route,
	 * the overlay's provider/model stages onto the next create (and the
	 * label), exactly like switchModel without a session. The theme half
	 * is renderer-facing — configLoad() reports the merged theme for the
	 * P3 ShellHostDeps swap.
	 */
	async refreshWorkspaceConfig(): Promise<void> {
		await this.#refreshWorkspaceOverlay()
	}

	#readProfileConfig(): Record<string, unknown> {
		try {
			return JSON.parse(readFileSync(this.configPath(), "utf8")) as Record<string, unknown>
		} catch {
			return {}
		}
	}

	#refreshWorkspaceOverlay(): Promise<void> {
		return loadWorkspaceConfig(this.#workspaceDir)
			.then((overlay) => {
				this.#overlayCache = overlay
				const prefs = overlay.model
				// application point: stage the workspace model route only while
				// nothing else chose one (an explicit user selection wins)
				if (prefs?.provider && prefs.model && this.#sessionId === undefined && this.#pendingModel === undefined) {
					this.switchModel(prefs.provider, prefs.model, prefs.reasoningEffort)
				}
			})
			.catch((error: unknown) => {
				console.error("[remote-host-session] workspace config load failed:", error)
			})
	}

	/** wave 3 (client-local FS for ~/.dsh/agents/*.md — audit row 30). */
	listAgents(): { name: string; displayName?: string; description?: string; model?: string; thinking?: string; deep?: string; file: string; broken?: string }[] {
		return listAgentFiles(this.#dshHome)
	}

	/** wave 3 (row 30 write half; host-session.ts:492-507 parity). */
	agentSet(name: string, field: "model" | "thinking" | "deep", value: string): void {
		setAgentField(name, field, value, this.#dshHome)
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

	/**
	 * wave 3 (row 29 — FULL via lifecycle): no remote live-plugin reload
	 * exists, so /reload restarts the host on the SAME authority and lets
	 * the carrier reconnect + the wave-2 re-attach machinery resume the
	 * session (ADR-0005 user decision). Default action:
	 * restartSamePortHost over the lifecycle lockfile contract (SIGTERM →
	 * same-port respawn → listener wait); a `restartHost` option overrides
	 * for custom topologies. Resolves undefined on success
	 * (host-session.ts:730-740 parity) or an error string; a turn awaiting
	 * across the restart surfaces the usual "reconnecting…" label and
	 * replays through onReattachedMissed.
	 */
	async reloadPlugins(): Promise<string | undefined> {
		if (this.#disposed) throw new Error("RemoteHostSession is disposed")
		if (this.#awaiting) this.#setReconnecting(true)
		try {
			if (this.#restartHost !== undefined) {
				await this.#restartHost("plugin reload")
			} else {
				const restarted = await restartSamePortHost({ profile: this.#profile, dshHome: this.#dshHome })
				this.#lastRestartPid = restarted.pid
			}
		} catch (error) {
			this.#setReconnecting(false)
			return String(error instanceof Error ? error.message : error).slice(0, 200)
		}
		// the carrier retries its authority forever; wait for the fresh host
		// so the caller's next RPC lands on it (not on a dead socket).
		const ok = await this.#awaitConnected(30_000)
		// With no live session the re-attach machinery never runs — clear
		// the reconnecting label here (a no-op when the re-attach cleared it).
		this.#setReconnecting(false)
		if (!ok) return "host restarted but the connection did not come back within 30s (grant rotation? — the P3 ShellHostDeps swap re-mints)"
		return undefined
	}

	/**
	 * The pid of the host process the last same-port restart spawned (the
	 * lifecycle handle keeps the OLD pid — supervisors that need to reap
	 * the restarted process read this; undefined until a restart happens).
	 */
	lastRestartPid(): number | undefined {
		return this.#lastRestartPid
	}

	/** Poll the carrier back to `connected` (reload/restart helper). */
	#awaitConnected(budgetMs: number): Promise<boolean> {
		if (this.#connection.getState() === "connected") return Promise.resolve(true)
		return new Promise((resolve) => {
			const deadline = Date.now() + budgetMs
			const timer = setInterval(() => {
				if (this.#connection.getState() === "connected") {
					clearInterval(timer)
					resolve(true)
				} else if (this.#disposed || Date.now() > deadline) {
					clearInterval(timer)
					resolve(false)
				}
			}, 250)
			timer.unref?.()
		})
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
			const before = this.#pluginsCache.length
			const [plugins, bundles] = await Promise.all([
				this.#rpc("pluginManager/listPlugins") as Promise<unknown>,
				this.#rpc("pluginManager/listBundles").catch(() => undefined) as Promise<unknown>,
			])
			const versions = new Map<string, string>()
			if (Array.isArray(bundles)) {
				for (const b of bundles as Record<string, unknown>[]) {
					// listBundles rows identify the bundle by `name` (moduleName is
					// absent — the pre-fix key never matched, leaving versions "") —
					// index under BOTH spellings for the listPlugins join.
					const moduleName = typeof b?.moduleName === "string" ? b.moduleName : typeof b?.name === "string" ? b.name : ""
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
			// Notify subscribers (the seam adapter's reactive /plugins face) so a
			// late-arriving boot warm or push refresh repaints the panel — the
			// sync listPlugins() read is otherwise a stale-cache trap.
			if (this.#pluginsCache.length !== before || before === 0) {
				for (const listener of this.#pushListeners) {
					try {
						listener.onPluginsChanged?.()
					} catch {
						/* contained */
					}
				}
			}
		} catch {
			/* keep the previous cache */
		}
		return [...this.#pluginsCache]
	}

	/**
	 * wave 3 (row 37): the cached verdict of the preset-document probe
	 * (`#probeExecutionMode`) — see remote-exec-mode.ts for why the
	 * document scan is authoritative for preset-bound sessions and why
	 * "native" is the honest answer everywhere else (the deployment
	 * default composition's mode is not queryable over the wire;
	 * pluginInventory carries no config).
	 */
	executionMode(): "native" | "ptc" {
		return this.#executionMode
	}

	/**
	 * Probe the active preset's composition document for its
	 * `tool-presentation` row. Without an active preset the deployment
	 * default applies and stays "native" (documented assumption); the
	 * probe re-runs whenever a preset is adopted (switchPreset,
	 * session/create value, follow header) — ShellHost's refresh cadence
	 * (/preset, /new, post-turn) picks the verdict up.
	 */
	async #probeExecutionMode(): Promise<void> {
		const presetId = this.#presetId
		if (!presetId) return // deployment default — not queryable; keep "native"
		try {
			const doc = await this.readPreset(presetId)
			const mode = doc ? toolPresentationModeFromPresetDocument(doc.content) : undefined
			if (mode !== undefined) this.#executionMode = mode
		} catch {
			/* keep the previous verdict */
		}
	}

	/** wave 3 (row 31 — client-local session-store scan, HostSession parity). */
	repairScan(): string[] {
		return repairScanSessions(this.#dshHome)
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
	async forkAtTurn(seqEnd?: number): Promise<{ items: StoredTranscriptRow[]; turn: number }> {
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

	/**
	 * wave 3 (row 32 — the shaped second-session flow; remote-btw.ts
	 * documents the pollution choice). One throwaway session per facade,
	 * reused across questions; resolves with the full answer text (turn
	 * errors surface as `error: …` text, HostSession parity) or throws
	 * when the session/prompt services refuse (create/prompt RPC failure).
	 */
	async btwAsk(question: string, snapshot: string[], onDelta?: (full: string) => void): Promise<string> {
		if (this.#disposed) throw new Error("RemoteHostSession is disposed")
		if (this.#btwBusy) throw new Error("a btw question is already running")
		this.#btwBusy = true
		try {
			await this.start()
			// the throwaway rides the CURRENT route (host-session.ts:383 parity
			// — agentOptions: modelSelection()): an explicitly staged route
			// wins, else the live session's effective projection route, else
			// the catalog default — never a stale deployment default.
			const staged = this.#pendingModel ?? (await this.currentModelSelection())
			const result = await askBtw({
				rpc: (method, args) => this.#rpc(method, args),
				socketFactory: this.#socketFactory,
				cwd: this.#cwd,
				question,
				snapshot,
				...(onDelta ? { onDelta } : {}),
				...(this.#btwSessionId !== undefined ? { previousSessionId: this.#btwSessionId } : {}),
				...(staged !== undefined ? { stagedModel: staged } : {}),
			})
			this.#btwSessionId = result.sessionId
			return result.answer
		} finally {
			this.#btwBusy = false
		}
	}

	/**
	 * wave 3 (row 35): stage a local image for the next message. Reads +
	 * validates NOW (host-session.ts:1153-1163 parity: extension
	 * allowlist, whole-file bytes, leaf display name) and returns the same
	 * `name (N KB)` echo; the receipt upload happens at TURN time against
	 * the session the prompt rides (receipts are agent-scoped — see the
	 * turn() comment), and the prompt carries `{type:'file', receiptId}`.
	 */
	async attachImage(path: string): Promise<string> {
		const file = await readImageAttachment(path)
		this.#pendingUploads.push(file)
		return `${file.name} (${(file.bytes / 1024).toFixed(0)} KB)`
	}

	/**
	 * wave 3 (row 36): fetch one host-side file's bytes through the
	 * authenticated `GET /api/file?path=` route (the tool-result image
	 * bytes path; 20 MiB cap). The dock renders the LOCAL path directly —
	 * host and client share one filesystem — this is the verified bytes
	 * route for remote-safe consumers.
	 */
	fetchHostFile(path: string): Promise<Uint8Array> {
		return fetchHostFile(this.#baseUrl, this.#cookieHeader, path)
	}

	/**
	 * wave 3 (row 35 read-back): the durable attachment ids of the last
	 * image-carrying prompt, read from the follow journal's admitted
	 * user/message records (`session/attachment` round-trip input).
	 */
	lastAttachmentIds(): string[] {
		for (let i = this.#journal.length - 1; i >= 0; i--) {
			const entry = this.#journal[i]!
			if (entry.type !== "user/message") continue
			const ids = attachmentIdsOfPromptContent(entry.data.content ?? (entry.data.message as Record<string, unknown> | undefined)?.content)
			if (ids.length > 0) return ids
		}
		return []
	}

	/** Read one durable image back (row 35 round-trip; remote-attachments). */
	readSessionAttachment(attachmentId: string): Promise<{ data: string; mediaType: string; bytes: number; width?: number; height?: number }> {
		const sessionId = this.#sessionId
		if (sessionId === undefined) throw new Error("no live session to read attachments from")
		return readSessionAttachment((method, args) => this.#rpc(method, args), sessionId, attachmentId)
	}

	/**
	 * wave 3 (row 39): the powerline git segment's probe —
	 * `git branch --show-current` in the workspace cwd
	 * (ShellHost.tsx:277-295 semantics; "" on non-repos). Client-local:
	 * no git namespace exists on the Remote surface (audit gap 4).
	 */
	gitBranch(cwd = this.#cwd): Promise<string> {
		return probeGitBranch(cwd)
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

	// ------------------------------------------------------------------
	// Wave-3 subagent panel (row 33)
	// ------------------------------------------------------------------

	/** Lazy live-read of the settings knobs for the subagent ladder. */
	#refreshRoundLimits(): void {
		if (this.#roundLimitsRefreshing) return
		this.#roundLimitsRefreshing = true
		void this.#settingsClient()
			.describeDocument()
			.then((doc) => {
				this.#roundLimits = limitsFromSettingsRows(doc.namespaces)
			})
			.catch(() => {
				/* keep the previous snapshot; defaults disable the ladder */
			})
			.finally(() => {
				this.#roundLimitsRefreshing = false
			})
	}

	#subagentPanel(): RemoteSubagentPanel {
		if (this.#subagents === undefined) {
			this.#subagents = new RemoteSubagentPanel({
				rpc: (method, args) => this.#rpc(method, args),
				socketFactory: this.#socketFactory,
				parentId: () => this.#sessionId,
				limits: () => this.#roundLimits,
				refreshLimits: () => this.#refreshRoundLimits(),
				onHardStop: (record) =>
					console.info(
						`[subagent-policy] force-stopped child ${record.childId} at round ${record.round} (cap ${record.cap} + grace ${record.grace})`,
					),
				onUpdate: (views) => {
					// F6 marker face: fan out to seam subscribers alongside the
					// turn-callbacks surface.
					for (const listener of this.#subagentListeners) {
						try {
							listener(views)
						} catch {
							/* a UI listener must never take the pump down */
						}
					}
					try {
						this.#cb?.onSubagentUpdate?.(views)
					} catch {
						/* a UI callback must never take the pump down */
					}
				},
			})
			this.#refreshRoundLimits()
		}
		return this.#subagents
	}

	/** Child transcript lines (viewer; capped buffer, HostSession parity). */
	childTranscript(id: string): string[] {
		return this.#subagentPanel().transcript(id)
	}

	/**
	 * Steer a RUNNING child (row 33): fire-and-forget `subagents/prompt`
	 * (delivery 'steer'). The SYNC boolean contract is HostSession parity:
	 * true when the child is adopted (reachable), false otherwise; the
	 * host's typed rejection (`subagent/not-resumable` — the host policy
	 * that one-shot/non-continuable children cannot be steered, audit gap
	 * 8) is logged with its code, and `steerChildDetailed` returns it
	 * verbatim for the honest variant.
	 */
	steerChild(id: string, text: string): boolean {
		const panel = this.#subagentPanel()
		if (!panel.known(id)) return false
		void panel.steer(id, text)
		return true
	}

	/** The typed steer outcome ({ok:false, reason} carries the host policy error). */
	steerChildDetailed(id: string, text: string): Promise<{ ok: true } | { ok: false; reason: string }> {
		return this.#subagentPanel().steerChildDetailed(id, text)
	}

	/** Interrupt a child (`subagents/interruptByParent`; typed errors surface). */
	interruptChild(id: string): Promise<void> {
		return this.#subagentPanel().interrupt(id)
	}

	/** The panel snapshot (TurnCallbacks.onSubagentUpdate row shape). */
	subagentViews(): RemoteSubagentView[] {
		return this.#subagentPanel().views()
	}

	// ---- subagent marker face (batch F6: seam → view) ----
	/** Push listener registry (the seam adapter forwards this 1:1); the panel's
	 * onUpdate fans out here too. Fires the FULL snapshot each fold, and
	 * replays it immediately so a late subscriber paints current state. */
	#subagentListeners = new Set<(views: RemoteSubagentView[]) => void>()
	onSubagentViews(listener: (views: RemoteSubagentView[]) => void): () => void {
		this.#subagentListeners.add(listener)
		listener(this.subagentViews())
		return () => this.#subagentListeners.delete(listener)
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

	/**
	 * Drop the cached /model catalog (RemoteModelClient.invalidate). The host
	 * recomputes `session/modelCatalog` per call — this cache was the only
	 * place a logged-out provider survived. Fires on every route-affecting
	 * local commit (login/logout credential halves, every settings seam
	 * write) and on the `settings/document-updated` +
	 * `credentials/reference-updated` pushes (commits from other surfaces).
	 */
	#invalidateModelCatalog(): void {
		this.#modelClient().invalidate()
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
		// Attach BEFORE the first prompt so no live frame is missed. The
		// opening header's agentPreset is the session's bound composition —
		// adopt it (it drives the row-37 executionMode probe).
		const opening = await this.#attachFollow(false)
		if (opening.header.agentPreset && opening.header.agentPreset !== this.#presetId) {
			this.#presetId = opening.header.agentPreset
			void this.#probeExecutionMode()
		}
		return this.#sessionId
	}

	#attachFollow(replay: boolean, sinceSeq?: number): Promise<RemoteFollowOpening> {
		if (this.#follow === undefined) {
			this.#follow = new RemoteFollowSession({
				socketFactory: this.#socketFactory,
				sink: this.#followSink(),
				onDetached: () => this.#onFollowDetached(),
			})
		}
		return this.#follow.attach(this.#sessionId!, replay, sinceSeq)
	}

	#followSink() {
		return {
			// Durable record ledger (wave 2): /history grouping + fork points +
			// the reconnect gap-repair base all read this. Wave 3: the
			// subagent panel pairs tool-workflow rows from the same ledger.
			onRecord: (entry: RemoteJournalEntry) => {
				if (entry.seq > this.#lastDurableSeq) this.#lastDurableSeq = entry.seq
				this.#journal.push(entry)
				if (this.#journal.length > 4000) this.#journal.shift()
				for (const listener of this.#journalListeners) {
					try {
						listener(entry)
					} catch {
						/* contained */
					}
				}
				if (entry.type === "tool-workflow/agent-start" || entry.type === "tool-workflow/agent-end") {
					try {
						this.#subagentPanel().foldParentRecord(entry)
					} catch {
						/* contained */
					}
				}
			},
			onContentDelta: (text: string) => {
				try {
					this.#cb?.onContentDelta(text)
					this.#noteDelta()
					this.#ticker.add(text.length)
				} catch {
					/* a UI callback must never take the pump down */
				}
			},
			onThinkingDelta: (text: string) => {
				try {
					this.#cb?.onThinkingDelta(text)
					this.#noteDelta()
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
				// cacheHitMode bookkeeping (batch F2, tui-pi parity; the
				// host-session twin): cumulative totals add up per frame, the
				// last-message sample recomputes — billed input = uncached
				// prompt + cacheRead + cacheWrite.
				if (usage.prompt > 0) this.#cachePromptTotal += usage.prompt
				if (usage.cacheRead > 0) this.#cacheReadTotal += usage.cacheRead
				if (usage.cacheWrite > 0) this.#cacheWriteTotal += usage.cacheWrite
				const billed = usage.prompt + usage.cacheRead + usage.cacheWrite
				if (billed > 0) this.#lastMessageCacheHitRate = (usage.cacheRead / billed) * 100
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
				trace(`onTurnEnd data=${JSON.stringify(data).slice(0, 200)} resolving=${this.#resolveTurn !== undefined}`)
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
		if (this.#resolveTurn === undefined) {
			trace("finishTurn EARLY-RETURN (no awaited turn)")
			return
		}
		const endedAt = Date.now()
		this.#ticker.finish()
		const chars = this.#ticker.chars()
		const ms = Math.max(0, endedAt - this.#turnStartedAt)
		const completion = this.usage.completion - this.#turnUsageStart.completion
		const real = completion > 0
		const tokens = real ? completion : estimateTokens(chars)
		// Decode window (batch F4): first delta → last delta; a turn with no
		// streamed deltas (pure tool round) contributes no window.
		if (this.#firstDeltaAt > 0) {
			const decodeMs = Math.max(0, (this.#lastDeltaAt || endedAt) - this.#firstDeltaAt)
			if (decodeMs > 0) {
				this.#lastDecode = { tokens, ms: decodeMs }
				this.#decodeTotals.tokens += tokens
				this.#decodeTotals.ms += decodeMs
			}
		}
		this.#firstDeltaAt = 0
		this.#lastDeltaAt = 0
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
		// the queue into a new turn — onTurnEnd must paint first). Wave 3:
		// a post-turn list sweep settles children that never hit an
		// agent-end pairing (one-shot teardown races).
		void this.#subagentPanel()
			.refreshFromList()
			.catch(() => {})
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
		trace("settleTurnWithoutEnd")
		const resolve = this.#resolveTurn
		this.#resolveTurn = undefined
		this.#awaiting = false
		resolve?.()
	}

	/**
	 * Batch-9b hang fix: settle an awaited turn whose `turn/end` arrived while
	 * the follow stream was blind. `#reattach` folds the opening snapshot with
	 * `turn/end`-in-snapshot = settled history (remote-follow.ts never settles
	 * a live await from a snapshot), so without this check a stream death that
	 * spans the turn's end leaves the awaited turn pending FOREVER (composer
	 * locked in steer mode — the batch-9a defect). Any journal `turn/end` newer
	 * than the arm watermark proves the awaited turn ended host-side; settle
	 * through `#finishTurn` for its onTurnEnd/telemetry parity (it is a no-op
	 * if a racing live frame already settled).
	 */
	#settleTurnIfEndedDuringGap(): void {
		if (!this.#awaiting || this.#resolveTurn === undefined) return
		const ended = this.#journal.some((entry) => entry.type === "turn/end" && entry.seq > this.#turnArmSeq)
		if (!ended) return
		trace(`turn/end found in gap-repaired journal (armSeq=${this.#turnArmSeq}) — settling awaited turn`)
		this.#finishTurn()
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
			// a commit from ANOTHER surface (web Models page, second client)
			// changed routes: the cached /model catalog is stale until dropped
			this.#invalidateModelCatalog()
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
			// key stored/removed elsewhere flips a route's routability: drop the
			// cached catalog the same way the local login()/logout() do
			this.#invalidateModelCatalog()
			for (const listener of this.#pushListeners) {
				try {
					listener.onCredentialUpdated?.(ref)
				} catch {
					/* contained */
				}
			}
			return
		}
		// Wave-3 subagent panel feeds (row 33): the forwarded api-session
		// emits carry live child state without a list round-trip.
		if (event === "api-session/status") {
			const sessionId = typeof argv[0] === "string" ? argv[0] : ""
			const running = argv[1] === true
			if (sessionId) {
				try {
					this.#subagentPanel().noteStatus(sessionId, running)
				} catch {
					/* contained */
				}
			}
			return
		}
		if (event === "api-session/removed") {
			const sessionId = typeof argv[0] === "string" ? argv[0] : ""
			if (sessionId) {
				try {
					this.#subagentPanel().noteRemoved(sessionId)
				} catch {
					/* contained */
				}
			}
			return
		}
		if (event === "api-session/added") {
			// args[0] is the SessionSummary row; a cheap refresh adopts any
			// newly published child of OUR session (the row itself is already
			// in the list the panel re-reads).
			const summary = (typeof argv[0] === "object" && argv[0] !== null ? argv[0] : {}) as Record<string, unknown>
			if (summary.parentSessionId !== undefined && summary.parentSessionId === this.#sessionId) {
				void this.#subagentPanel().refreshFromList().catch(() => {})
			}
			return
		}
		// Other forwarded emits (agent-preset/selected, …) have no consumer
		// here; they stay observable through connection.onEvent.
	}

	// ------------------------------------------------------------------
	// Internals — generation change (reconnect) re-attach
	// ------------------------------------------------------------------

	#onConnectionState(state: "connecting" | "connected" | "disconnected"): void {
		if (state === "connected") this.#scheduleReattach()
	}

	#onFollowDetached(): void {
		trace(`follow DETACHED sessionId=${this.#sessionId ?? "-"} awaiting=${this.#awaiting}`)
		if (this.#disposed || this.#sessionId === undefined) return
		if (this.#awaiting) this.#setReconnecting(true)
		// If the carrier is already `connected` again, nothing else will
		// announce it — retry from here; otherwise the state listener fires.
		if (this.#connection.getState() === "connected") this.#scheduleReattach()
	}

	#scheduleReattach(): void {
		if (this.#disposed || this.#sessionId === undefined) return
		trace(`scheduleReattach attached=${this.#follow?.attached ?? "-"} awaiting=${this.#awaiting}`)
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
			// P1#1: the snapshot replay folds against the last durable seq this
			// client painted before the gap — records at/below it are already
			// on the ledgers and must never re-paint (rows) or re-announce
			// (tool calls) after a reconnect /restart re-attach.
			const opening = await this.#attachFollow(true, seqBefore)
			this.#reattachAttempts = 0
			trace(`reattach OK cursor=${opening.cursor} armSeq=${this.#turnArmSeq} awaiting=${this.#awaiting}`)
			// Batch-9b hang fix: the follow stream died MID-TURN and the reattach
			// replay folded the turn's `turn/end` as settled snapshot history
			// (remote-follow never settles a live await from a snapshot). If the
			// journal now holds a turn/end newer than the awaited turn's arm
			// watermark, the turn ended while we were blind — settle here (the
			// guard below makes it idempotent against a racing live frame).
			this.#settleTurnIfEndedDuringGap()
			await this.#repairJournalGap(opening, journalBefore, seqBefore)
			this.#setReconnecting(false)
		} catch (error) {
			trace(`reattach FAIL attempt=${this.#reattachAttempts + 1} err=${error instanceof Error ? error.message : String(error)}`)
			this.#reattachAttempts += 1
			if (this.#reattachAttempts >= this.#reattachMaxAttempts) {
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
			// The wake-diff callback carries user/assistant rows only (the
			// TurnCallbacks shape); ask rows ride the /resume replay instead.
			const painted = rows.filter((r): r is Extract<StoredTranscriptRow, { kind: "user" | "assistant" }> => r.kind !== "ask")
			if (painted.length > 0) {
				try {
					this.#cb?.onReattachedMissed?.(painted)
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
		}, this.#reattachRetryMs)
		this.#reattachTimer.unref?.()
	}

	/**
	 * The wave-1 reconnecting marker: the label swap the UI already reads.
	 * KNOWN GAP (assess, P1#1 group): ShellHost samples `session.label` only
	 * at onTurnEnd (ShellHost.tsx:1081) and its sole mid-turn hook,
	 * onStreamTick (:1085), reads only {chars, at} — so "reconnecting…" never
	 * paints mid-turn. ShellHost needs a label-change notification: an
	 * `onLabel?: (label: string) => void` TurnCallbacks entry fired from here.
	 */
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
