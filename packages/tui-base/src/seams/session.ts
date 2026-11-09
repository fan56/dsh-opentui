/**
 * SessionSeam — the typed contract between the vendored view (this package)
 * and OUR session layer (`@dsh-opentui/shell`'s RemoteHostSession facade).
 *
 * Design rule (ADR-0006 dependency direction): shell → tui-base, never the
 * reverse. This file therefore declares STRUCTURAL types only and imports
 * nothing from packages/shell; the real adapter lives in shell
 * (`RemoteSessionSeam` wrapping a `RemoteHostSession`) and is injected at
 * the view's composition root, replacing `useClient()`/`useData()` wiring.
 *
 * Derived from an enumeration of all 113 `@opencode/client` import sites in
 * src/ (batch 2a audit). What the vendored view actually consumes:
 *
 *   1. session data reads      — data.session.{get,root,family,list,...},
 *                                data.location.*, data.provider, data.project
 *                                (51 useData() sites)        → listSessions /
 *                                storedTranscript / searchSessions + push
 * 2. part streaming           — mini/stream-v2.* render deltas, tool runs,
 *                                permission & form asks        → turn(text, cb)
 *                                (TurnCallbacks-style: onContentDelta /
 *                                onThinkingDelta / onToolRun / onApprove)
 * 3. provider/model info      — dialog-model, usage.tsx, model-options
 *                                                     → listProviders / modelCatalog
 *                                                       / currentModelSelection
 * 4. event push               — client.event.listen/on (context/event.ts)
 *                                                        → onSessionEvent
 * 5. transcript manipulation  — api.session.{revert,move,update,interrupt}
 *                                     → revertTurn / moveTurn / renameSession /
 *                                       interrupt (+ turn() for re-prompt)
 * 6. lifecycle                — createClientConnection reconnect, session
 *                                switch (dialog-session-list, session-tabs)
 *                                     → status / currentSessionId / resumeSession
 *                                       / newSession / dispose
 *
 * Mapping table (vendored surface → SessionSeam method → RemoteHostSession):
 *
 *   createData().session.list            → listSessions()        → listSessions(limit)
 *   api.session.list / data.session.get  → getSession(id)        → (adapter projects
 *                                             storedTranscript + events cache)
 *   data.session.family/root             → (adapter-side cache; seam exposes
 *                                             the raw rows + events)
 *   api.session.view                     → storedTranscript(id)  → storedTranscript(id, skip)
 *   mini stream-v2 part stream           → turn(text, cb)        → turn(userText, cb)
 *   api.session.interrupt                → interrupt()           → abort()
 *   steer                                → steer(text)           → steer(text)
 *   api.session.update (title)           → renameSession(title)  → renameSession(title)
 *   api.session.revert / move            → revertTurn / moveTurn → (adapter over host
 *                                             RPC; wave-2 parity surface)
 *   client.event.listen / on             → onSessionEvent(cb)    → follow-stream push
 *                                             (#onEventsItem → typed union)
 *   api.session.list (providers)         → listProviders()       → listProviders()
 *   dialog-model catalog                 → modelCatalog()        → modelCatalog(force)
 *   model-preference                     → currentModelSelection() → currentModelSelection()
 *   usage.tsx limits                     → usageSummary()        → usageSummary()
 *   permission/form asks                 → embedded in turn cb   → onApprove / ask provider
 *   dialog-session-list resume           → resumeSession(id)     → resumeSession(id)
 *   new session (config/new-session)     → newSession()          → newSession()
 *   connection state (session-tabs idle) → status()              → status
 *
 * What the seam deliberately does NOT cover (still stubbed, later batch):
 * plugin loading (@opencode/plugin), simulation, merman/latex, persistent
 * PTY, MCP connect, integrations (oauth/commands), worktrees, media helpers
 * (withMediaRefs / mediaHashFromUri — pure functions the adapter may reuse
 * from client when it lands in shell).
 */

/** One session row as the view's lists need it (data.session.list shape). */
import type { CacheHitMode } from "./config.ts"

export interface SeamSessionSummary {
	id: string
	title: string
	updatedAt?: string
	/** Workspace directory of the stored session (/sessions DIR column). */
	cwd?: string
	/** On-disk log size in bytes (/sessions 1KB display floor; absent = unknown, fails open). */
	sizeBytes?: number
	parentID?: string
}

/** Transcript row (api.session.view / storedTranscript shape, view-sliced). */
export interface SeamTranscriptRow {
	kind: string
	text: string
	final: boolean
	/** Batch V1 tool-row slice: raw args JSON, the result JSON-brief and the
	 * isError mirror — present on durable `tool` rows only. */
	args?: string
	output?: string
	ok?: boolean
}

/**
 * Typed event push. The vendored view keys off `event.type` discriminants
 * (session.updated, message.part.updated, permission.asked, ...) via
 * context/event.ts; the adapter projects the host follow stream's frames
 * onto this union. `details` stays structural until the adapter batch pins
 * the exact per-type payloads the surviving components read.
 */
export interface SeamSessionEvent {
	type: string
	details: unknown
}

/** Connection/turn status — RemoteSessionStatus's view-relevant slice. */
export interface SeamStatus {
	connection: "connecting" | "connected" | "disconnected"
	turn: "idle" | "starting" | "running" | "reconnecting"
	sessionAttached: boolean
}

/** Provider/model catalog entry (dialog-model, model-options). */
export interface SeamProviderModel {
	providerID: string
	modelID: string
}

/** One reasoning-effort ladder entry (ModelReasoningEffort parity — the
 * same shape the remote catalog's `reasoning.efforts` carries). */
export interface SeamEffortOption {
	id: string
	name: string
	description?: string
}

/**
 * Tool-approval verdict — the exact strings the session layer's approval
 * waterfall expects (shell parity: `ok ? "allowed-once" : "rejected"`, with
 * host adapters mapping "allowed-once" to the allow branch and everything
 * else to fail-closed). Esc on the approval card resolves "rejected".
 */
export type SeamApprovalVerdict = "allowed-once" | "rejected"

/** One user question row (the shell registerAskProvider wire shape). The
 * optional faces mirror the tui-pi ask panel: `header` is the short tab
 * label, `description` the supporting line under the prompt, `multiSelect`
 * marks a toggle-many question (upstream `multi_select`). */
export interface SeamAskQuestion {
	id: string
	prompt: string
	options: string[]
	header?: string
	description?: string
	multiSelect?: boolean
}

/** One answer row: the picked option. A declined batch resolves as `[]`
 * (empty selection = the tui-pi declined envelope downstream). A
 * multiSelect answer carries every toggled label in `selections`
 * (display order); `selected` stays the first pick for single-select
 * consumers. */
export interface SeamAskPick {
	questionId: string
	selected: string
	selections?: string[]
}

/**
 * The /session info panel's snapshot (feature batch F4). Speeds are
 * decode-window rates (first streamed delta → settle) — `null` reads as
 * "—" on the panel, never as a fabricated 0 tok/s.
 */
export interface SeamSessionInfo {
	sessionId: string | null
	/** "provider/model[ (effort)]" — the facade's live label. */
	model: string | null
	/** Durable user+assistant messages (adapter-side transcript count). */
	messageCount: number
	/** User turns this facade drove since attach. */
	turnCount: number
	tokensIn: number
	tokensOut: number
	cacheRead: number
	cacheWrite: number
	/** Last completed turn's decode-window tok/s (null when not computable). */
	lastTurnTps: number | null
	/** Σ output tokens / Σ decode windows over the session (null when none). */
	sessionAvgTps: number | null
	/**
	 * 🧠 context-occupancy estimate (footer context batch, tui-pi
	 * `stats.contextTokens` parity): the latest billed request's input +
	 * output plus a CJK estimate of everything appended since. Optional —
	 * a seam without it keeps the panel's context row absent.
	 */
	contextTokens?: number | null
	/**
	 * The current route's context window (footer context batch, tui-pi
	 * `getContextWindow` parity). Optional/null — a seam (or catalog) that
	 * doesn't disclose it degrades the 🧠 segment to the bare `used` shape.
	 */
	contextWindow?: number | null
}

/** Streaming callbacks the view binds per turn (TurnCallbacks slice). */
export interface SeamTurnCallbacks {
	onThinkingDelta: (text: string) => void
	onContentDelta: (text: string) => void
	onToolStart?: (start: { callId?: string; name: string; args: string }) => void
	/** Fires when a tool run settles (batch V1): `ok` is the isError mirror,
	 * `output` the follow stream's JSON-brief result slice. Optional — seam
	 * fakes without result wiring leave rows running until turn finalize. */
	onToolRun?: (run: { callId?: string; name: string; argsPretty: string; output: string; ok: boolean }) => void
	/**
	 * Fires mid-turn when a tool run needs approval. Resolve with the exact
	 * `SeamApprovalVerdict` strings — the approval card (dialog-confirm)
	 * resolves "allowed-once" on confirm and "rejected" on cancel/esc.
	 */
	onApprove: (name: string, args: Record<string, unknown>) => Promise<SeamApprovalVerdict>
	onError: (message: string) => void
}

/**
 * One live subagent row (batch F6 marker face): the TurnCallbacks
 * .onSubagentUpdate entry shape, view-relevant slice — what a picker/viewer
 * row renders, plus the maxRounds policy markers (`injectedRound` folds the
 * `⚡ injected` marker, `hardStopRound` the `⏻ hard-stopped @N` one).
 */
export interface SeamSubagentView {
	id: string
	label: string
	model?: string
	status: "running" | "completed" | "failed" | "cancelled"
	rounds: number
	/** Batch V2b (transcript subagent tree): the child's start wall clock —
	 * running rows compute the live duration off it per spinner tick. */
	startedAt?: number
	/** Batch V2b: frozen duration seconds of a SETTLED child (folded at the
	 * settle emission; running rows carry none — they tick live). */
	elapsedSec?: number
	/** maxRounds wrap-up delivered at this round (`⚡ injected`). */
	injectedRound?: number
	/** maxRounds force-stop fired at this round (`⏻ hard-stopped @N`). */
	hardStopRound?: number
	/** Spin-detected early force-stop (`⏻! spin-detected early @N`) — fired
	 * BEFORE the grace window on fresh jev spin evidence; exclusive with the
	 * classic hardStopRound latch. */
	spinStopRound?: number
	/** Batch D2 (lastRequest dock): the child's latest CONTENT line — live
	 * assistant text/reasoning tail folded by the client's child follow
	 * pump. Absent when nothing streamed yet. */
	lastLine?: string
}

/**
 * One agent-preset row (batch H2): the registry roster entry the /preset
 * picker renders. `isDefault` marks the registry-designated default row
 * (tui-pi parity — the selection falls back to it when nothing is current);
 * broken rows stay hidden at this face (the adapters filter to composable
 * entries).
 */
export interface SeamPresetRow {
	id: string
	name: string
	description?: string
	isDefault?: boolean
}

/**
 * One agent definition row for the /agents manager (tui-pi table layer).
 * `model`/`thinking` are the COMPOSED values (frontmatter baseline (+) the
 * workspace-pinned profile override); `pin` names the profile the workspace
 * is pinned to when it resolves. `deep` is the numeric spawn budget.
 */
export interface SeamAgentRow {
	name: string
	displayName?: string
	description?: string
	model?: string
	thinking?: string
	deep: number
	file: string
	pin?: string
	broken?: string
}

/** Where a model/thinking edit landed (drives the scope note). */
export type SeamAgentEditTarget = { kind: "profile"; name: string } | { kind: "frontmatter" }

/** Result of one agent field write. */
export interface SeamAgentSetResult {
	target: SeamAgentEditTarget
	error?: string
}

/** What the vendored view needs from a session backend, no more. */
export interface SessionSeam {
	/** Lifecycle + connection state (session-tabs idle polling, status bar). */
	status(): SeamStatus

	/** Session data reads (dialog-session-list, session-tabs, app routes). */
	listSessions(limit?: number): Promise<SeamSessionSummary[]>
	searchSessions(query: string): Promise<{ id: string; snippet: string }[]>
	storedTranscript(id: string, skip?: number): Promise<SeamTranscriptRow[]>
	currentSessionId(): string | undefined
	/**
	 * ⚡ CH footer segment (batch F2): cache hit rate in percent, null until
	 * the host reports cache traffic (usage chunk cacheReadTokens /
	 * cacheWriteTokens). Optional — a seam without it hides the segment.
	 *
	 * cacheHitMode (batch F2, tui-pi parity): the optional mode picks which
	 * usage sample the rate describes — `"session"` the session-cumulative
	 * hit rate (ΣcacheRead / Σbilled input over the whole session), else the
	 * latest billed request's own rate (`lastMessage`, the default).
	 */
	cacheHitRate?(mode?: CacheHitMode): number | null
	/**
	 * 🧠 context-occupancy estimate (footer context batch, tui-pi
	 * `stats.contextTokens` parity): the latest billed request's input +
	 * output plus a CJK estimate of everything appended since — NOT a
	 * session-cumulative total (compaction drops it, like the real
	 * request). null while no usage frame has landed. Optional — a seam
	 * without it hides the segment.
	 */
	contextTokens?(): number | null
	/**
	 * The current route's context window (footer context batch, tui-pi
	 * `getContextWindow` semantics): the sync getter returns the cached
	 * resolution and fills it in the background. null while unknown — the
	 * 🧠 segment degrades to the bare `used` shape. Optional — a seam
	 * without it always shows the degraded shape.
	 */
	contextWindow?(): number | null
	/**
	 * Config seam read (batch F2 cacheHitMode): the merged config the UI
	 * consumes (profile config.json ⊕ workspace overlay ⊕ env). Optional —
	 * a seam without it reads the `cacheHitMode` default (lastMessage).
	 */
	configLoad?(): Record<string, unknown>
	/**
	 * Config seam write (batch F7b /theme persistence): persist a config
	 * patch and return the merged view. The adapter owns the storage split
	 * (its configSave routes `theme` per its own rules — workspace overlay
	 * or profile config.json). Optional — a seam without it keeps /theme
	 * session-scoped.
	 */
	configSave?(patch: Record<string, unknown>): Record<string, unknown>
	resumeSession(id: string): "ok" | "owned"
	newSession(): void
	renameSession(title: string): Promise<{ title: string; seq: number } | undefined>

	/** Turn streaming (mini/stream-v2 replacement point). */
	turn(userText: string, cb: SeamTurnCallbacks): Promise<void>
	steer(text: string): void
	interrupt(): void

	/**
	 * Register the user-questions answerer (shell host-session parity): the
	 * ask picker (dialog-select) resolves each question with the picked
	 * option; esc resolves the whole batch `[]` = declined envelope.
	 */
	registerAskProvider(onAsk: (questions: SeamAskQuestion[]) => Promise<SeamAskPick[]>): void

	/** Provider/model info (dialog-model, usage, model-options). */
	listProviders(): Promise<{ provider: string; models: string[] }[]>
	modelCatalog(force?: boolean): Promise<SeamProviderModel[]>
	currentModelSelection(): Promise<{ providerID: string; modelID: string } | undefined>
	/** Resolves when the host accepted the route (footer-refresh seam: the
	 * /model command awaits it before re-reading the selection). */
	selectModel(providerID: string, modelID: string): Promise<void>

	/**
	 * Reasoning-effort surface (batch F7b /think): the CURRENT model route's
	 * effort ladder — real provider data, never a hardcoded off/low/medium/
	 * high set. Optional — a seam without it (or with an empty ladder) makes
	 * /think print the unavailable row (the /btw degrade contract).
	 * `selectEffort` rides /model's effort semantics (switchModel with a
	 * reasoningEffort arm — next-turn effect); undefined clears the override.
	 * Resolves when the host accepted the effort (footer-refresh seam: the
	 * /think command awaits it before re-reading currentEffort).
	 */
	thinking?: {
		efforts(): Promise<SeamEffortOption[]>
		currentEffort(): Promise<string | undefined>
		selectEffort(effort: string | undefined): Promise<void>
	}

	/** Usage/limits (usage.tsx, stats). */
	usageSummary(): string[]

	/**
	 * /btw side question (feature batch F3): one out-of-band answer over a
	 * throwaway session, streamed through onDelta (full text so far). Optional
	 * — only the remote adapter carries it; /btw degrades to a notice without.
	 */
	btwAsk?(question: string, snapshot: string[], onDelta?: (full: string) => void): Promise<string>
	/**
	 * /session info panel (feature batch F4): one snapshot of the live
	 * session's identity, token usage and decode-window speeds. Optional —
	 * a seam without it degrades /session to a notice. Resolves undefined
	 * when no session is attached.
	 */
	sessionInfo?(): Promise<SeamSessionInfo | undefined>
	/**
	 * /plugins listing (batch F7a): the user-installed plugin rows (name +
	 * version). The adapters already exclude @deepseek-ai/* built-ins and
	 * resolve installed versions (hero-era HostSession.listPlugins
	 * semantics). Optional — a seam without it degrades /plugins to a
	 * notice.
	 */
	plugins?(): { name: string; version: string }[]
	/**
	 * Agent-preset face (batch H2, tui-pi 60-preset parity): the deployment's
	 * preset roster (the host `agentPresets` registry — each preset composes
	 * a session from a different plugin/tool set) plus the current selection.
	 * `select` rides the adapters' switchPreset semantics: the picked id is
	 * seeded into the NEXT session creation (a live session keeps composing
	 * under its bound preset until then). Optional — a seam without it (or a
	 * roster that reads empty) degrades /preset to a notice.
	 */
	preset?: {
		list(): Promise<SeamPresetRow[]>
		currentId(): Promise<string | undefined>
		/** Apply the switch; false when the backend rejected it. */
		select(presetId: string): Promise<boolean>
	}
	/**
	 * /agents manager face (tui-pi agents manager parity): the client-local
	 * `<DSH_HOME>/agents/*.md` corpus with composed model/thinking values,
	 * the one write site (pinned-profile override when the workspace pin
	 * resolves, frontmatter otherwise), the body for the `v` viewer, and a
	 * per-model reasoning-effort ladder for the two-stage picker. Optional —
	 * a seam without it degrades /agents to a notice.
	 */
	agents?: {
		list(): SeamAgentRow[]
		/** The agents corpus directory (the empty state names it). Optional —
		 * a seam without it falls back to `<DSH_HOME>/agents`. */
		dir?(): string
		/** `null` clears the key (inherit). Deep must be a non-negative integer. */
		set(name: string, field: "model" | "thinking" | "deep", value: string | null): SeamAgentSetResult
		/** System prompt body (markdown after the frontmatter fence). */
		body(name: string): string
		/** The model's real reasoning-effort ladder ([] when none). */
		modelEfforts(providerID: string, modelID: string): Promise<SeamEffortOption[]>
	}
	/**
	 * /login provider face (batch H4, tui-pi 65-ux-batch parity): the
	 * credential + route double-write behind the six-step custom-provider
	 * form. `login`/`logout` ride the session credentials seam
	 * (credentials/set|unset — the key half); `routes`/`registerRoute` ride
	 * the settings seam's llm-pi-ai namespace (the route half — the
	 * registered provider shows up in /model on the next session).
	 * Optional — a seam without it degrades /login to a notice.
	 */
	login?: {
		credentialStatus(ref: string): Promise<{ configured: boolean }>
		/** Store one API key under its derived env-ref (credentials/set). */
		login(ref: string, apiKey: string): Promise<void>
		/** Remove one stored key (credentials/unset). */
		logout(ref: string): Promise<void>
		/** The configured provider route ids (settings llm-pi-ai providers keys). */
		routes(): Promise<string[]>
		/**
		 * Register (profile) or clear (undefined) one provider route in the
		 * llm-pi-ai settings namespace; false when the backend rejected it.
		 */
		registerRoute(providerId: string, profile: Record<string, unknown> | undefined): Promise<boolean>
	}
	/**
	 * Subagent marker face (batch F6): the live subagent rows snapshot, and
	 * a push listener that fires on every fold (adoption, round, marker,
	 * settle). The listener receives the FULL snapshot each time; the
	 * disposer unsubscribes. Optional — a seam without it renders no picker.
	 */
	subagentViews?(): SeamSubagentView[]
	onSubagentViews?(listener: (views: SeamSubagentView[]) => void): () => void
	/**
	 * Steer a RUNNING child subagent (batch G2, tui-pi 70-steer parity): `id`
	 * is the SeamSubagentView.id row key, `text` the injected user message.
	 * False when the child is settled or its agent is unreachable in this
	 * process. Optional — a seam without it leaves the picker's Enter-steer
	 * path dark (the vendored SubagentsTab degrades to navigation only).
	 */
	steerChild?(id: string, text: string): boolean
	/** Event push (context/event.ts's subscribe/on replacement). */
	onSessionEvent(listener: (event: SeamSessionEvent) => void): () => void

	/** Teardown (app shell unmount). */
	dispose(): Promise<void>
}

/**
 * Stub implementation (batch 2a minimum): satisfies the interface for type
 * checking and tests; every call resolves empty / throws "not wired" only
 * where silence would be misleading. The shell adapter replaces it.
 */
export class NullSessionSeam implements SessionSeam {
	status(): SeamStatus {
		return { connection: "disconnected", turn: "idle", sessionAttached: false }
	}
	async listSessions(): Promise<SeamSessionSummary[]> {
		return []
	}
	async searchSessions(): Promise<{ id: string; snippet: string }[]> {
		return []
	}
	async storedTranscript(): Promise<SeamTranscriptRow[]> {
		return []
	}
	currentSessionId(): string | undefined {
		return undefined
	}
	resumeSession(_id: string): "ok" | "owned" {
		return "owned"
	}
	newSession(): void {}
	async renameSession(): Promise<{ title: string; seq: number } | undefined> {
		return undefined
	}
	async turn(_userText: string, _cb: SeamTurnCallbacks): Promise<void> {}
	steer(_text: string): void {}
	interrupt(): void {}
	/** Registered answerer; unset until a view (or test) registers one. */
	#askProvider: ((questions: SeamAskQuestion[]) => Promise<SeamAskPick[]>) | undefined
	registerAskProvider(onAsk: (questions: SeamAskQuestion[]) => Promise<SeamAskPick[]>): void {
		this.#askProvider = onAsk
	}
	/** Test/fake helper: run the registered ask provider; unset = declined. */
	async ask(questions: SeamAskQuestion[]): Promise<SeamAskPick[]> {
		if (!this.#askProvider) return []
		return this.#askProvider(questions)
	}
	async listProviders(): Promise<{ provider: string; models: string[] }[]> {
		return []
	}
	async modelCatalog(): Promise<SeamProviderModel[]> {
		return []
	}
	async currentModelSelection(): Promise<{ providerID: string; modelID: string } | undefined> {
		return undefined
	}
	selectModel(_providerID: string, _modelID: string): Promise<void> {
		return Promise.resolve()
	}
	usageSummary(): string[] {
		return []
	}
	async sessionInfo(): Promise<SeamSessionInfo | undefined> {
		return undefined
	}
	/** F6 marker face stub: no subagents on the null seam. */
	subagentViews(): SeamSubagentView[] {
		return []
	}
	/** F7a plugins stub: the null seam carries no plugins. */
	plugins(): { name: string; version: string }[] {
		return []
	}
	readonly #subagentListeners: ((views: SeamSubagentView[]) => void)[] = []
	onSubagentViews(listener: (views: SeamSubagentView[]) => void): () => void {
		this.#subagentListeners.push(listener)
		return () => {
			const index = this.#subagentListeners.indexOf(listener)
			if (index >= 0) this.#subagentListeners.splice(index, 1)
		}
	}
	/** Test helper: fan a subagent snapshot out to subscribed listeners. */
	emitSubagentViews(views: SeamSubagentView[]): void {
		for (const listener of this.#subagentListeners) listener(views)
	}
	/** Records listeners so a test can drive events through the stub. */
	readonly listeners: ((event: SeamSessionEvent) => void)[] = []
	onSessionEvent(listener: (event: SeamSessionEvent) => void): () => void {
		this.listeners.push(listener)
		return () => {
			const index = this.listeners.indexOf(listener)
			if (index >= 0) this.listeners.splice(index, 1)
		}
	}
	async dispose(): Promise<void> {}
	/** Test helper: fan an event out to subscribed listeners. */
	emit(event: SeamSessionEvent): void {
		for (const listener of this.listeners) listener(event)
	}
}
