/**
 * `RemoteHostSession` — the client-mode session core (ADR-0005 bucket (b)
 * wave 1): the SAME surface ShellHost consumes from the in-process
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
 * Generation changes (reconnect): the follow stream is re-opened when the
 * connection reports `connected` again; the opening snapshot replays missed
 * transcript rows through TurnCallbacks.onReattachedMissed and an ACTIVE
 * turn's compact stream replays as deltas (basic best-effort repair; a
 * "reconnecting…" marker replaces `label` for the gap — the full status
 * surface and journal-tail page repair are wave 2).
 *
 * NOT in wave 1 (same shapes as HostSession, graceful stubs — see the
 * individual methods): session list/page/search/rename/fork, model catalog +
 * selectModel, presets list, credentials/settings RPCs, commands, skills,
 * plugins, /agents, /repair, /tail, subagent panel, /btw, attachments,
 * executionMode — audit rows 12–28, 30–33, 35–37, deferred to waves 2/3.
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
	type RemoteTodoItem,
	type RemoteToolRun,
	type RemoteTranscriptRow,
} from "./remote-follow.ts"
import { openRemoteStream, type RemoteStreamHandle } from "./remote-stream.ts"
import {
	WaterfallAnswerer,
	type RemoteApprovalVerdict,
	type RemoteQuestion,
	type RemoteQuestionAnswer,
} from "./remote-waterfall.ts"
import { ClientConnection, RemoteRpcError, type ClientReadyInfo } from "./transport.ts"

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
	/** abort()/dispose() while the prompt RPC was still in flight. */
	#interrupted = false
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
	 * start whenever the boot sequence is ready.
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
		return this.#started
	}

	/** Stop every stream and listener; resolve an awaited turn. Idempotent. */
	async dispose(): Promise<void> {
		if (this.#disposed) return
		this.#disposed = true
		if (this.#reattachTimer !== undefined) {
			clearTimeout(this.#reattachTimer)
			this.#reattachTimer = undefined
		}
		this.#follow?.reset()
		this.#follow = undefined
		for (const dispose of this.#disposers) dispose()
		this.#disposers = []
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
		this.#interrupted = true
		this.#settleTurnWithoutEnd()
	}

	/** Start a FRESH session on the next turn (keeps the current preset). */
	newSession(): void {
		this.#sessionId = undefined
		this.#resumeId = undefined
		this.#follow?.reset()
	}

	/**
	 * Resume a stored session on the next turn (`session/create` with the
	 * stored id). The writer-lock probe happens at turn time — a
	 * `session/writer-held` failure surfaces as the same friendly error the
	 * in-process SessionAlreadyOwnedError path produced. Transcript replay
	 * (`session/page`) is wave 2; resume works but paints no history rows.
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
	// Wave-2/3 stubs — HostSession shapes, graceful values
	// ------------------------------------------------------------------

	/** wave 2 (`session/modelCatalog` — audit row 21). */
	async listProviders(): Promise<{ provider: string; models: string[] }[]> {
		return []
	}

	/** wave 2 (`session/list` — audit row 13). */
	async listSessions(_limit = 12): Promise<{ id: string; title: string; updatedAt?: string }[]> {
		return []
	}

	/** wave 2 (`session/page` replay — audit row 14). */
	async storedTranscript(_id: string, _skip = 0): Promise<{ kind: "user" | "assistant"; text: string }[]> {
		return []
	}

	/** wave 2 (`agentPresets/list` — audit row 23). */
	async listPresets(): Promise<{ id: string; name: string }[]> {
		return []
	}

	/** Real in wave 1: the preset rides the next `session/create` (row 1). */
	switchPreset(presetId: string): void {
		this.#presetId = presetId
		this.newSession()
	}

	currentPresetId(): string | undefined {
		return this.#presetId
	}

	/** wave 2 (`commands/list` — audit row 26). */
	async listHostCommands(): Promise<{ name: string; description: string }[]> {
		return []
	}

	/** wave 2 (`commands/execute` — audit row 26). */
	async executeHostCommand(_line: string): Promise<{ text?: string } | undefined> {
		return { text: "host commands ride commands/execute from wave 2 (client mode)" }
	}

	/** wave 2 (`credentials/describe` — audit row 24). */
	async credentialStatus(_ref: string): Promise<{ configured: boolean }> {
		return { configured: false }
	}

	/** wave 2 (`credentials/set` — audit row 24). */
	async login(_ref: string, _apiKey: string): Promise<void> {
		throw new Error("credentials service unavailable in client mode (wave 2: credentials/set)")
	}

	/** wave 2 (`credentials/unset` — audit row 24). */
	async logout(_ref: string): Promise<void> {
		throw new Error("credentials service unavailable in client mode (wave 2: credentials/unset)")
	}

	/** wave 2 (`settings/describe` + `settings/mutate` — audit row 25). */
	get settingsSeam(): { describe(): Promise<unknown>; mutate(ns: string, ops: unknown[], revision?: number): Promise<void> } | undefined {
		return undefined
	}

	/** wave 2 (audit row 25). */
	async settingsDescribe(): Promise<{ ns: string; revision?: number; value?: unknown }[]> {
		return []
	}

	/** wave 2 (audit row 25). */
	async settingsMutate(_ns: string, _ops: unknown[], _revision?: number): Promise<void> {
		throw new Error("settings service unavailable in client mode (wave 2)")
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

	/** wave 2 (`skills/list` — audit row 27). */
	listSkills(): { name: string; description: string; invocation: string }[] {
		return []
	}

	/** Wave 3 by design: no remote live reload — host restart + auto-reconnect (audit row 29). */
	async reloadPlugins(): Promise<string | undefined> {
		return "plugin reload requires a host restart in client mode"
	}

	/** wave 2 (`pluginManager/listPlugins` — audit row 28). */
	listPlugins(): { name: string; version: string }[] {
		return []
	}

	/** wave 2 (agentPresets read / pluginInventory probe — audit row 37). */
	executionMode(): "native" | "ptc" {
		return "native"
	}

	/** Client-local scan parity is wave 3 (audit row 31). */
	repairScan(): string[] {
		return ["repair scan runs on the client filesystem; deferred to wave 3 (client mode)"]
	}

	/** wave 2 (`session/search` — audit row 19). */
	async searchSessions(_query: string): Promise<{ id: string; snippet: string }[]> {
		return []
	}

	/** wave 2 (follow-record turn grouping — audit row 18). */
	historyTurns(): { turn: number; seqEnd: number; preview: string }[] {
		return []
	}

	/** wave 2 (`session/fork` — audit row 18). */
	async forkAtTurn(_seqEnd: number): Promise<{ items: { kind: "user" | "assistant"; text: string }[]; turn: number }> {
		throw new Error("fork rides session/fork from wave 2 (client mode)")
	}

	/** wave 2 (second-session flow — audit row 32). */
	async btwAsk(_question: string, _snapshot: string[], _onDelta?: (full: string) => void): Promise<string> {
		throw new Error("btw side sessions are deferred to wave 2 (client mode)")
	}

	/** wave 2 (`fileUploads/upload` — audit row 35). */
	async attachImage(_path: string): Promise<string> {
		throw new Error("attachment service unavailable in client mode (wave 2: fileUploads/upload)")
	}

	/** wave 2 (`session/follow` on another session id — audit row 17). */
	async startRemoteTail(_sessionId: string): Promise<string | undefined> {
		return "remote tail rides session/follow from wave 2 (client mode)"
	}

	stopRemoteTail(): void {
		/* wave 2 */
	}

	/** wave 2 (subagent panel aggregation — audit row 33). */
	childTranscript(_id: string): string[] {
		return []
	}

	/** wave 2 (`subagents/prompt` — audit row 33). */
	steerChild(_id: string, _text: string): boolean {
		return false
	}

	// ------------------------------------------------------------------
	// Internals — session + follow plumbing
	// ------------------------------------------------------------------

	#rpc(method: string, args: Record<string, unknown>): Promise<unknown> {
		return this.#connection.rpc(method, args)
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
		this.#sessionId = typeof value.sessionId === "string" ? value.sessionId : requestedId
		if (typeof value.agentPreset === "string" && value.agentPreset) this.#presetId = value.agentPreset
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
				// host-session.ts:1269-1272 semantics: prompt = the request's
				// context size (assignment); completion accumulates over the
				// session; cache fields are assignments when reported.
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
			await this.#attachFollow(true)
			this.#reattachAttempts = 0
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
