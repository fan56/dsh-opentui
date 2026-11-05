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
export interface SeamSessionSummary {
	id: string
	title: string
	updatedAt?: string
	parentID?: string
}

/** Transcript row (api.session.view / storedTranscript shape, view-sliced). */
export interface SeamTranscriptRow {
	kind: string
	text: string
	final: boolean
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

/**
 * Tool-approval verdict — the exact strings the session layer's approval
 * waterfall expects (shell parity: `ok ? "allowed-once" : "rejected"`, with
 * host adapters mapping "allowed-once" to the allow branch and everything
 * else to fail-closed). Esc on the approval card resolves "rejected".
 */
export type SeamApprovalVerdict = "allowed-once" | "rejected"

/** One user question row (the shell registerAskProvider wire shape). */
export interface SeamAskQuestion {
	id: string
	prompt: string
	options: string[]
}

/** One answer row: the picked option. A declined batch resolves as `[]`
 * (empty selection = the tui-pi declined envelope downstream). */
export interface SeamAskPick {
	questionId: string
	selected: string
}

/** Streaming callbacks the view binds per turn (TurnCallbacks slice). */
export interface SeamTurnCallbacks {
	onThinkingDelta: (text: string) => void
	onContentDelta: (text: string) => void
	onToolStart?: (start: { callId?: string; name: string; args: string }) => void
	/**
	 * Fires mid-turn when a tool run needs approval. Resolve with the exact
	 * `SeamApprovalVerdict` strings — the approval card (dialog-confirm)
	 * resolves "allowed-once" on confirm and "rejected" on cancel/esc.
	 */
	onApprove: (name: string, args: Record<string, unknown>) => Promise<SeamApprovalVerdict>
	onError: (message: string) => void
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
	selectModel(providerID: string, modelID: string): void

	/** Usage/limits (usage.tsx, stats). */
	usageSummary(): string[]

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
	selectModel(_providerID: string, _modelID: string): void {}
	usageSummary(): string[] {
		return []
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
