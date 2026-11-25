/**
 * SessionSeam — the typed contract between the vendored view (this package)
 * and OUR session layer (`@dsh-opentui/shell`'s legacy HTTP session facade).
 *
 * Design rule (ADR-0006 dependency direction): shell → tui-base, never the
 * reverse. This file therefore declares STRUCTURAL types only and imports
 * nothing from packages/shell; the real adapter lives in shell
 * (the bridge `SessionSeam` impl wrapping host client state) and is injected at
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
 * Mapping table (vendored surface → SessionSeam method → legacy HTTP facade):
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
import type { HistoryJournalEntry } from "../routes/session/history-data.ts"

export interface SeamSessionSummary {
	id: string
	title: string
	updatedAt?: string
	/** Workspace directory of the stored session (/resume DIR column). */
	cwd?: string
	/** On-disk log size in bytes (/resume 1KB display floor; absent = unknown, fails open). */
	sizeBytes?: number
	/** Host list metadata: `true` = the session was created but never prompted
	 * (feat/auto-resume skips these; absent = older host, heuristic falls back). */
	blank?: boolean
	parentID?: string
}

/** One settled Q&A row of an `ask_user_question` transcript block: the tool
 * call carries the question/options, the tool result the selection. Additive
 * — persisted items without it keep rendering (see toStoredRow's fallback). */
export interface SeamAskEntry {
	/** The question text (kept apart from `header`). */
	question: string
	/** Short heading the tool call carried, when any (eyebrow in replay). */
	header?: string
	/** Supporting detail the tool call carried, when any (context line). */
	detail?: string
	/** The options offered, each label with its optional description. */
	options: SeamAskOption[]
	/** The labels the user picked (empty when declined). */
	selected: string[]
	/** Free-text answer carried by the result, when any. */
	custom?: string
	/** True when the question got no user selection (declined / timed out). */
	declined: boolean
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
	/** Settled `ask` rows carry their Q&A entries (the transcript block);
	 * absent on every other kind — and on older projections, which degrade
	 * to the assistant text row they used to be. */
	entries?: SeamAskEntry[]
	/**
	 * ask-outcome hydrate rows only. A stored notice has its OWN kind
	 * (`"notice"`, never `"assistant"`); this fixed id is the shared
	 * `ask-outcome:<eventId>` (A11 conflicts add `:seq-N`). `toStoredRow`
	 * renders it as a view assistant row under key `notice:<id>` — not
	 * `stored:notice:<index>`, and with no cross-path replay dedup key.
	 */
	id?: string
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

/** Bridge link health for the footer status slot (ADR-0010 DEAD recovery).
 *  Additive status precision: dead / recovering / ready. */
export type BridgeLinkStatus = "ready" | "recovering" | "dead"

/** Connection/turn status — RemoteSessionStatus's view-relevant slice. */
export interface SeamStatus {
	connection: "connecting" | "connected" | "disconnected"
	turn: "idle" | "starting" | "running" | "reconnecting"
	sessionAttached: boolean
	/** Bridge link health (A2). Optional: the legacy remote seam and older
	 *  consumers that only read connection/turn are unaffected. */
	bridge?: BridgeLinkStatus
}

/** Provider/model catalog entry (dialog-model, model-options). */
export interface SeamProviderModel {
	providerID: string
	modelID: string
}

/** 025-w2-4 — one provider directory row from `llm/listProviders` (hand-projected). */
export interface SeamLlmProviderRow {
	id: string
	name: string
}

/** 025-w2-4 — one configurable-provider row from `llm/listConfigurableProviders`
 * (hand-projected: env var NAMES only, never values / baseURL / URL). */
export interface SeamConfigurableProviderRow {
	provider: string
	displayName: string
	settingsNs?: string
	declared?: boolean
	authEnvNames?: string[]
	error?: string
}

/**
 * 025-w3-2 — the safe subset of `llm/discoverModels`' request. The host's
 * schema also accepts an `apiKey`, but the TUI NEVER passes a credential to a
 * discovery call: this closed shape has no key field at all. `baseURL` is an
 * optional endpoint the user typed (it is the user's own value, not a host
 * secret); the seam does not log it.
 */
export interface SeamModelDiscoveryRequest {
	provider?: string
	baseURL?: string
	api?: string
}

/** 025-w3-2 — one discovered model from `llm/discoverModels` (SECOND whitelist:
 * only the rendered fields cross; the result schema is additionalProperties:true). */
export interface SeamDiscoveredModel {
	id: string
	name?: string
	contextWindow?: number
	maxTokens?: number
	inputModalities?: Array<"text" | "image">
}

/**
 * 025-w2-5 — goal ref (`GoalRef`, hand-projected). The CAS token every goal
 * mutation rides; only stable id + positive revision cross the seam.
 */
export interface SeamGoalRef {
	id: string
	revision: number
}

/** 025-w2-5 — full goal status view (`GoalView`, hand-projected second whitelist).
 *  Every field is a closed enum / bounded scalar / capped free text — the goal
 *  result schemas are schema-open/null (AMEND-2 blind spot), so this projection
 *  is the load-bearing defence against undeclared sensitive keys. */
export interface SeamGoalView {
	id: string
	revision: number
	objective: string
	phase: "active" | "paused" | "blocked" | "complete"
	activation: "armed" | "disarmed"
	roundsStarted: number
	maxGoalRounds: number
	createdAt: number
	updatedAt: number
	blockedReason?: { code: string; message: string }
}

/** One reasoning-effort ladder entry (ModelReasoningEffort parity — the
 * same shape the remote catalog's `reasoning.efforts` carries). */
export interface SeamEffortOption {
	id: string
	name: string
	description?: string
}

/** One human-invocable skill from the host's session-scoped catalog
 * (`skills/list` — the same wire row the web client reads). */
export interface SeamSkillRow {
	name: string
	description: string
	/** The `/name` gesture form when the host serves it. */
	invocation?: string
}

/** One `pluginManager/listBundles` row (C1 — the /plugins manager renders
 * these; structurally the same face the web profile's plugin-management
 * page drives through `ctx.remote.pluginManager`). */
export interface SeamPluginBundleRow {
	name: string
	version: string
	/** Untranslated package-manifest description (the install preview body). */
	description?: string
	enabled: boolean
	installed: boolean
	/** Not-installed catalog entry (the state column's "available"). */
	optional: boolean
	removable: boolean
	/** `management-required` / `unaddressable` — the host's read-only reasons. */
	readOnlyReason?: string
	/** Last listing diagnostic for the row (compatibility gate rejections). */
	error?: string
	/**
	 * 025-w2-2 honest-degrade flag: the row came from the phase-1 local install
	 * manifest because the pluginManager service is absent — its enabled state
	 * is UNKNOWABLE, so `enabled` is forced false and the panel must NOT paint
	 * it as a real on/off. Never set on real manager rows.
	 */
	stateUnknown?: boolean
}

/** 025-w2-2 — one `pluginManager/readBundleDetail` result, hand-projected.
 * `markdown` is length-capped; no host object crosses the seam. */
export type SeamPluginDetail =
	| { status: "found"; origin: "locale" | "readme"; path: string; markdown: string }
	| { status: "none" }

/** 025-w2-2 — `pluginManager/registries`, hand-projected (URLs are text, never
 * a credential value; free text capped). */
export interface SeamPluginRegistries {
	registry: string | null
	fallbackRegistries: readonly string[]
	resolved: string | null
}

/** 025-w2-2 — `pluginManager/listVersionExemptions`, hand-projected. */
export interface SeamVersionExemptions {
	exemptions: Readonly<Record<string, readonly string[]>>
	warnings: readonly string[]
}

/**
 * 025-w2-2 — the real plugin-manager READ face (plan §5.2), hand-written and
 * second-whitelist-projected. Coexists with the phase-1 local `plugins()` face
 * (local = what is installed; manager = enabled/state/version-exemption view).
 * Every method rejects with BridgeProtocolError(UNSUPPORTED) on a service-absent
 * / NOT_WIRED reply — never a fake empty value.
 */
export interface SeamPluginsManager {
	/** Real `listBundles` rows with the live enabled/state flags. */
	listBundles(): Promise<SeamPluginBundleRow[]>
	/** Real `listPlugins` rows (name/version only; no fabricated enabled flag). */
	listPlugins(): Promise<readonly PluginRowView[]>
	/** Selected bundle's detail document (markdown capped). */
	readBundleDetail(name: string, language: string): Promise<SeamPluginDetail>
	/** Install-dialog preinformation (read-only). */
	registries(): Promise<SeamPluginRegistries>
	listVersions(name: string): Promise<readonly string[]>
	listVersionExemptions(): Promise<SeamVersionExemptions>
	inspect(spec: string): Promise<SeamPluginInspection>
	/**
	 * Honest service availability: `undefined` until first probed, `true` after
	 * a successful read, `false` after a service-absent / NOT_WIRED reply.
	 * NEVER an environment-dependent `present === true` assertion.
	 */
	available(): boolean | undefined
}

/** Minimal name/version row from `pluginManager/listPlugins`. */
export interface PluginRowView {
	name: string
	version: string
}

/** Structural face of the pluginManager ChangeResult (C1). `applied` means
 * the change is LIVE on the running host; `restart-required` means it
 * persists but takes effect at the next host start (the panel states it). */
export interface SeamPluginChange {
	changed: boolean
	application: "applied" | "restart-required" | "overridden" | "failed" | "cancelled"
	target: string
	error?: string
	/** 025-w2-3 — caller-supplied install request id, echoed so the progress
	 *  face can poll waitForInstall / drive cancelInstall. Only on install. */
	requestId?: string
}

/** Structural face of `pluginManager/inspect` (C1 — the install preview). */
export type SeamPluginInspection =
	| { status: "accepted"; name?: string; version?: string; description?: string; bundle: boolean | null }
	| { status: "refused"; problem: string; reason: string }

/**
 * 025-w2-3 (R6) — the seam-side confirmation proof. Production mint points are
 * the three write apply functions driven by a TUI confirm modal's `onConfirm`
 * (via `createPluginWriteConfirm`) PLUS the cancelInstall key handler (a
 * protective operation that aborts an in-flight install, not a new write);
 * Esc/dismiss paths mint nothing. The bridge seam's write faces refuse any call
 * without a structurally-valid token (zero wire traffic). This is a discipline
 * gate, not cryptography: its job is to make "no write fires before the modal
 * is accepted" an enforceable, unit-testable invariant. Structural brand (no
 * module-identity dependency) so tui-base and shell can share it across bundles.
 */
export interface PluginWriteConfirm {
	readonly __pluginWriteConfirm: true
	readonly operation: string
}
export function createPluginWriteConfirm(operation: string): PluginWriteConfirm {
	return { __pluginWriteConfirm: true, operation }
}
export function isPluginWriteConfirm(value: unknown): value is PluginWriteConfirm {
	return (
		typeof value === "object" && value !== null &&
		(value as Record<string, unknown>).__pluginWriteConfirm === true &&
		typeof (value as Record<string, unknown>).operation === "string"
	)
}

/**
 * 025-w2-3c — install progress projection over `waitForInstall` polling (the
 * adjudicated route; ADR-0010 frame surface NOT expanded). The host's
 * `waitForInstall(requestId)` returns a `ChangeResult | null`: null once the
 * request settled and was evicted from the live map. The seam projects a CLOSED
 * state set only — no host object crosses. `running` is the in-flight state,
 * `done`/`cancelled`/`failed` are terminal, `unknown` is the honest fallback for
 * a malformed/hostile reply (never painted as success).
 */
export type SeamInstallProgress =
	| { readonly state: "running"; readonly requestId: string }
	| { readonly state: "done"; readonly requestId: string; readonly target?: string }
	| { readonly state: "cancelled"; readonly requestId: string; readonly target?: string }
	| { readonly state: "failed"; readonly requestId: string; readonly target?: string; readonly error?: string }
	| { readonly state: "unknown"; readonly requestId: string }

/** 025-w2-3c — `cancelInstall` result (host PluginInstallCancellation, closed enum). */
export interface SeamInstallCancellation {
	readonly status: "cancelled" | "too-late" | "not-running"
}

/** One selectable new-session permission preset (`permissionPresets/catalog`
 * — the same process catalog the web client's General settings reads). */
export interface SeamPermissionPresetOption {
	value: string
	name?: string
	description?: string
}

/** The host's permission catalog (`permissionPresets/catalog`). */
export interface SeamPermissionCatalog {
	options: SeamPermissionPresetOption[]
	defaultOptions: SeamPermissionPresetOption[]
	defaultPreset: string
}

/**
 * 026 — closed result of one `/permission <preset>` command round-trip.
 * `matched=false` means the host offers no `/permission` command (web
 * `result.value === undefined`); `ok=false` means the command ran but rejected
 * the preset. `text` is the capped/control-stripped host message, never a raw
 * host object (see bridge-permission.ts SECOND whitelist).
 */
export interface SeamPermissionSwitchResult {
	ok: boolean
	matched: boolean
	text: string
}

/**
 * 026 web-mirror — current-session permission preset mirror (web /permission
 * parity). `catalog` reads the already-wired `permissionPresets/catalog`;
 * `switch` sends the host's registered `/permission <preset>` command through
 * the generic `commands/execute` wire id (agent scope, agentId = session id).
 * Optional — a host without the generic release degrades /permission to an
 * honest notice; a host without the command yields `matched=false`.
 */
export interface SeamPermissionFace {
	catalog(): Promise<SeamPermissionCatalog | undefined>
	switch(preset: string): Promise<SeamPermissionSwitchResult>
}

/**
 * Tool-approval verdict — the exact strings the session layer's approval
 * waterfall expects (shell parity: `ok ? "allowed-once" : "rejected"`, with
 * host adapters mapping "allowed-once" to the allow branch and everything
 * else to fail-closed). Esc on the approval card resolves "rejected".
 */
export type SeamApprovalVerdict = "allowed-once" | "rejected"

/** One selectable option of a question: `label` is the row text AND the
 * answer value (picks, the answer envelope and the transcript all carry the
 * label string), `description` the optional supporting line under it. */
export interface SeamAskOption {
	label: string
	description?: string
}

/** One user question row (the shell registerAskProvider wire shape). The
 * optional faces mirror the tui-pi ask panel: `header` is the short tab
 * label, `description` the supporting line under the prompt, `detail` the
 * host's body text (`question.detail`, e.g. a plan under review),
 * `multiSelect` marks a toggle-many question (upstream `multi_select`). */
export interface SeamAskQuestion {
	id: string
	prompt: string
	options: SeamAskOption[]
	header?: string
	description?: string
	detail?: string
	multiSelect?: boolean
}

/** One answer row: the picked option OR the free-text answer. A declined
 * batch resolves as `[]` (empty selection = the tui-pi declined envelope
 * downstream). A multiSelect answer carries every toggled label in
 * `selections` (display order); `selected` stays the first pick for
 * single-select consumers. A free-text answer (the "Type something."
 * sentinel, C7) rides `custom` with `selected: ""` — selected ⊕ custom
 * are mutually exclusive (tui-pi Answer.custom contract). */
export interface SeamAskPick {
	questionId: string
	selected: string
	selections?: string[]
	custom?: string
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
	/**
	 * Durable user+assistant messages (adapter-side transcript count). Optional
	 * so a seam whose transcript read failed can OMIT it rather than paint a
	 * fake 0; the /session panel renders an em-dash placeholder for absence.
	 */
	messageCount?: number
	/**
	 * /session panel "turns" row — count of durable `user` transcript rows
	 * (one nominal turn = one user/message with source.kind "user"). The
	 * adapter overrides the facade's client-local `turnCount` with this
	 * durable count. A steer may journal another user row on some hosts;
	 * unverifiable from the client. NOT shown in the footer strip. Optional
	 * for the same honest-omission reason as `messageCount`.
	 */
	turnCount?: number
	/**
	 * Footer 💬 msgs — count of durable `assistant/message` journal events
	 * (one durable assistant/message event = one msg). Optional so an older
	 * host or a seam fake without msg plumbing still typechecks; absent
	 * means unknown and the footer hides the segment (not a fabricated 0).
	 */
	msgCount?: number
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
	/** Batch F5: the host v3 `subagent/catalog` child reservation name (unique
	 * among siblings). NOT a registry agent name — `use_agent` already carries
	 * the agent name in `label`. Absent when the producer never supplied one. */
	name?: string
	model?: string
	status: "running" | "completed" | "failed" | "cancelled" | "interrupted"
	rounds: number
	/** Batch V2b (transcript subagent tree): the child's start wall clock —
	 * running rows compute the live duration off it per spinner tick. */
	startedAt?: number
	/** Batch V2b: frozen duration seconds of a SETTLED child (folded at the
	 * settle emission; running rows carry none — they tick live). */
	elapsedSec?: number
	/** P1-5: wall clock of the running→settled transition (epoch ms) — the
	 * viewer's "most recent settled" cap sorts off it (tui-pi endedAt parity).
	 * Settled rows carry one; running rows do not. */
	endedAt?: number
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
	/** Per-agent round cap (registry `maxRounds`, positive integer); absent =
	 * inherit the global ladder. 0 is not a valid value on this surface. */
	maxRounds?: number
	/** Registry `background` dispatch flag (absent = false). */
	background?: boolean
	file: string
	pin?: string
	broken?: string
}

/** B1 S5 — where the official caps came from. `unavailable` means the host
 * settings document could not be read; numeric fields are then ABSENT (never
 * filled from the local file) so the panel renders `n/a` with `reason`. */
export type SeamAgentOfficialCapsSource = "host" | "unavailable"

/** The official subagent plugin's caps (settings ns `subagent`); absent
 * fields mean the host did not serve them — render `n/a`, never a guess.
 * `source`/`reason` are optional for pre-B1 producers; the bridge seam always
 * sets them. */
export interface SeamAgentOfficialCaps {
	maxActiveSubagents?: number
	maxDepth?: number
	source?: SeamAgentOfficialCapsSource
	/** Short sanitized reason when `source === "unavailable"`. */
	reason?: string
}

/** Where a model/thinking edit landed (drives the scope note). */
export type SeamAgentEditTarget = { kind: "profile"; name: string } | { kind: "frontmatter" }

/** Result of one agent field write. */
export interface SeamAgentSetResult {
	target: SeamAgentEditTarget
	error?: string
}

/**
 * One settings namespace row (structural parity with shell's
 * `RemoteSettingsRow` / the wire's `settings/describe` namespace view).
 * Values are already REDACTED by the host: a secret slot rides only as
 * `secrets[{path,set}]`, never as a value.
 */
export interface SeamSettingsRow {
	ns: string
	revision?: number
	value?: unknown
	/** Composition-base layer (defaults resolved), when the host serves it. */
	base?: unknown
	autoGenerate?: boolean
	schema?: unknown
	user?: unknown
	secrets?: { path: string[]; set: boolean }[]
}

/** B1 S4 — authoritative source of a settings document. `host` = the host
 * `settings.describe` answered (values are authoritative, writes route to the
 * host); `local-file` = the host was unavailable and the client fell back to a
 * local patch file FOR RENDERING ONLY — host rows are read-only and their
 * numbers must show `n/a` (never the local file's numbers). */
export type SeamSettingsSource = "host" | "local-file"

/** The settings document view (`settings/describe`): writes are refused
 * wholesale when `writable` is false. `source` is required for B1 S4+ producers;
 * legacy fixtures that omit it are treated as `host`. */
export interface SeamSettingsDocument {
	writable: boolean
	hasDocument: boolean
	namespaces: SeamSettingsRow[]
	source: SeamSettingsSource
	/** Source details: profile / document path / sanitized failure reason. */
	sourceDetail?: { profile?: string; documentPath?: string; reason?: string }
}

/** One path-addressed write (the wire's SettingsPathOpView). Path ops only —
 * a whole-section `replace` would drop redacted secret slots. */
export type SeamSettingsOp =
	| { op: "set"; path: string[]; value: unknown }
	| { op: "unset"; path: string[] }

/**
 * A PLANNED provider-route write (T7 patch-ownership). The client never writes
 * the profile patch directly: it validates the route and hands the caller the
 * host-settings ops to apply via `settings.mutate`. Kept as a structured result
 * (instead of a boolean) so the caller owns the write channel and the refusal
 * reason is not swallowed.
 */
export type SeamRegisterRoutePlan =
	| { kind: "invalid"; reason: string }
	| { kind: "noop" }
	| { kind: "host-settings"; ns: "llm-pi-ai"; ops: SeamSettingsOp[] }

/** One write outcome. `conflict` mirrors the host's `settings/conflict`
 * (stale `expectedRevision`) — the caller re-reads and retries once. */
export type SeamSettingsMutateResult =
	| { ok: true }
	| { ok: false; conflict: boolean; error: string }

/**
 * /settings face (v1): the host settings document behind the profile
 * (settings.describe/mutate → the profile patch file) plus the read-only
 * identity the panel header shows. Optional — a seam without it keeps local
 * preferences editable and degrades the host zone to read-only.
 */
export interface SeamSettingsFace {
	describe(): Promise<SeamSettingsDocument>
	mutate(ns: string, ops: SeamSettingsOp[], revision?: number): Promise<SeamSettingsMutateResult>
	/** Host push (`settings/document-updated`); the disposer unsubscribes. */
	onChanged?(listener: (ns: string, revision: number) => void): () => void
	/** Profile name + dsh home (display only, never written). */
	identity?(): { profile: string; dshHome: string }
	/**
	 * P0-3 — read-only fact for the /login pre-write consistency check: does the
	 * directory the client's config/login faces write to match the profile the
	 * running dsh process loads? A seam without the fact skips the check (never
	 * fabricates one). The dirs are absolute so the notice can name both.
	 */
	profileConsistency?(): { ok: true } | { ok: false; clientDir: string; hostDir: string }
	/**
	 * Process permission catalog (`permissionPresets/catalog`): the real
	 * options for `permission.defaultPreset` plus the effective default when
	 * the settings field is omitted. Optional — a host without the service
	 * (or a failed read) keeps the row read-only instead of an empty picker.
	 */
	permissionCatalog?(): Promise<SeamPermissionCatalog | undefined>
}

/**
 * One configured provider route (one `providers` dict entry of the settings
 * llm-pi-ai namespace), as the /login //logout faces consume it. The body
 * rides along because the credential ref is the profile's OWN `apiKeyEnv` —
 * a hand-edited profile may point anywhere, and deriving the ref from the
 * route id would unset an unrelated key and strand the real one (the
 * reference contract, tui-pi login.ts logoutCandidatesFromSection).
 */
export interface SeamLoginRoute {
	/** Route id (the `providers` dict key). */
	id: string
	/** The credential ref the profile itself names; absent → the caller derives one from the id. */
	apiKeyEnv?: string
	/** The profile's display name, when it carries one. */
	displayName?: string
	/**
	 * Live hand-declaration signal: the profile carries its own
	 * `api`/`baseURL`/`models`, so /login cannot re-create it and /logout
	 * must drop only the key (the reference's declared arm).
	 */
	declared?: boolean
}

/**
 * 025-w1b E — the ONLY account state shape that crosses the seam. Field-by-field
 * whitelist projection of the host AccountView: a bounded status enum, a bounded
 * attempt phase, and booleans. The authorize URL VALUE (and the code_challenge /
 * state it carries) is NEVER part of this shape — only `authorizeUrlReady`.
 */
export interface SeamAccountState {
	status: string | null
	attemptPhase: string | null
	authorizeUrlReady: boolean
	linksPresent: boolean
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
	 * 026 — the current session's working directory, hand-projected from the
	 * already-wired `session/list.cwd` row (no new capability id). Resolves
	 * undefined when no session is attached or the row carries no cwd.
	 * Optional — a seam without it degrades /cwd to an honest notice.
	 */
	cwd?(): Promise<string | undefined>
	/**
	 * The stored session id STAGED by `resumeSession()` (auto-resume,
	 * /search Enter-resume, fork resume): bound to a live session only at the
	 * next turn, so `currentSessionId()` is undefined until then. Optional —
	 * a seam without the face falls back to its other sources. Consumers that
	 * target "the session on screen" (e.g. the /history bare target) must
	 * read this too, or a resumed-but-not-yet-turned session browses the
	 * WRONG id (review P1-1).
	 */
	stagedSessionId?(): string | undefined
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
	/**
	 * Layered config reads for the /settings local zone: the profile
	 * config.json RAW contents (no overlay/env merge) and the workspace
	 * overlay slice. Optional — a seam without them renders the merged value
	 * on both layer rows.
	 */
	configRaw?(): Record<string, unknown>
	workspaceConfig?(): Record<string, unknown>
	/**
	 * /settings host document face (v1): describe/mutate over the profile
	 * patch file, plus profile identity. Optional — a seam without it keeps
	 * the local zone and shows the host zone read-only.
	 */
	settings?: SeamSettingsFace
	/**
	 * 026 web-mirror — current-session permission preset mirror (catalog read +
	 * commands/execute switch). Optional — a host without the generic release
	 * degrades /permission to an honest notice.
	 */
	permission?: SeamPermissionFace
	resumeSession(id: string): "ok" | "owned"
	/**
	 * C13 /resume repair flow, probe half (tui-pi loadSessionPreviews
	 * corruptIds parity): broken session logs from the client-local store
	 * scan (`<dshHome>/sessions/`, the same criteria the /repair card
	 * prints) with their paths and owning session ids. Optional — a seam
	 * without it keeps the /resume picker repair-free.
	 */
	repairScanBroken?(): { path: string; name: string; reason: string; sessionId?: string }[]
	/**
	 * C13 /resume repair flow, apply half: the guarded plain-jsonl tail
	 * repair — the original always moves to `.corrupt-bak` BEFORE any
	 * rewrite, and a failed swap restores it. Optional — the EXPLICIT user
	 * confirmation lives in the /resume command (no silent rewrite here).
	 */
	repairSessionLog?(
		path: string,
	): { kind: "repaired"; backupPath: string } | { kind: "clean" } | { kind: "failed"; detail: string }
	/**
	 * B2 /history raw journal read (gap C1 step 2): the durable journal
	 * records of ANY session (remote-session-ops fetchJournal shape —
	 * type/seq/time/data, oldest-first), the exact input of
	 * routes/session/history-data.ts groupHistoryTurns. The storedTranscript
	 * row face cannot serve the turn brackets (turn/start…turn/end), so the
	 * /history browser folds THIS. Optional — a seam without it degrades
	 * /history to the unavailable notice.
	 */
	sessionJournal?(sessionId: string): Promise<HistoryJournalEntry[]>
	/**
	 * B2 /history fork-at-turn (tui-pi `f` parity): seed a NEW session with
	 * `sessionId`'s journal prefix through `seqEnd` INCLUSIVE (a folded
	 * turn's seqEnd — the state as that turn finished) and return the new
	 * session id. NO facade/app-session switch here — the caller resumes the
	 * forked id through the same path a /resume pick takes. Optional — a
	 * seam without it degrades `f` to the refill notice (never a fake fork).
	 */
	forkSession?(sessionId: string, seqEnd?: number): Promise<string>
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
	/**
	 * 025-w2-4 — real provider directory (the `llm/listProviders` /
	 * `llm/listConfigurableProviders` read ids). Optional; a seam without them
	 * (service absent / UNSUPPORTED) degrades honestly to the static catalog —
	 * never a fake-empty directory. Both faces REJECT (UNSUPPORTED) on service
	 * absence; callers catch and fall back. Hand-projected white-list rows only.
	 */
	providerDirectory?: {
		registered(): Promise<SeamLlmProviderRow[]>
		configurable(): Promise<SeamConfigurableProviderRow[]>
		/** 025-w3-2 — hand-written discovery face (the one PROJECTED_BY_HAND id).
		 *  Service absence / no remote source REJECTS (UNSUPPORTED) — callers
		 *  degrade honestly, never a fake-empty list. SECOND whitelist applies. */
		discover?(settingsNs: string, request: SeamModelDiscoveryRequest): Promise<SeamDiscoveredModel[]>
	}
	/**
	 * 025-w2-5 — goals status face (the `goals/*` ids). Optional; a seam without
	 * it (service absent / no active session) degrades honestly — never a fake
	 * empty goal. Hand-projected second whitelist; free text capped, enums closed.
	 * `available()` is an honest observation of THIS process, never a premise.
	 * Mutations are explicit-intent calls (no silent change); `ref` is the CAS
	 * token from `status()`/create, `revision` guards stale writes.
	 */
	goals?: {
		status(): Promise<SeamGoalView | undefined>
		available(): boolean
		create(objective: string, maxGoalRounds?: number): Promise<SeamGoalRef | undefined>
		edit(ref: SeamGoalRef, patch: { objective?: string; maxGoalRounds?: number }): Promise<SeamGoalView | undefined>
		complete(ref: SeamGoalRef): Promise<SeamGoalView | undefined>
		pause(ref: SeamGoalRef): Promise<SeamGoalView | undefined>
		resume(ref: SeamGoalRef): Promise<SeamGoalView | undefined>
		clear(ref: SeamGoalRef): Promise<SeamGoalRef | undefined>
	}
	currentModelSelection(): Promise<{ providerID: string; modelID: string } | undefined>
	/**
	 * The last SILENT-path selection failure as one short line — a fire-and-
	 * forget switchModel or the staged route's re-send onto a freshly created
	 * session, neither of which has a caller to reject into. Cleared by the
	 * next successful selection application. Optional — a seam without it
	 * never carries such failures (inline-application adapters don't need it).
	 */
	lastSelectionError?(): string | undefined
	/** Resolves when the host accepted the route (footer-refresh seam: the
	 * /model command awaits it before re-reading the selection). REJECTS when
	 * the host refused or the RPC failed — callers surface that failure
	 * (web profile parity: a failed select is reported, never swallowed). */
	selectModel(providerID: string, modelID: string): Promise<void>

	/**
	 * Reasoning-effort surface (batch F7b /think): the CURRENT model route's
	 * effort ladder — real provider data, never a hardcoded off/low/medium/
	 * high set. Optional — a seam without it (or with an empty ladder) makes
	 * /think print the unavailable row (the /btw degrade contract).
	 * `selectEffort` rides /model's effort semantics (switchModel with a
	 * reasoningEffort arm — next-turn effect); undefined clears the override.
	 * Resolves when the host accepted the effort (footer-refresh seam: the
	 * /think command awaits it before re-reading currentEffort). REJECTS when
	 * the host refused or the RPC failed — callers surface that failure.
	 */
	thinking?: {
		efforts(): Promise<SeamEffortOption[]>
		/**
		 * The effort ladder of ANY model route (not just the current one):
		 * /model's two-stage flow reads the just-committed model's ladder to
		 * decide whether the effort stage appears. Same provider data as
		 * `efforts()` (the cached host catalog's `reasoning.efforts`, never
		 * a hardcoded tier set). Optional — a host without it degrades to
		 * the empty-ladder skip arm (no stage 2; the /think contract).
		 */
		effortsFor?(providerID: string, modelID: string): Promise<SeamEffortOption[]>
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
	 * Splash hero (tui-pi welcome parity): push notification after every
	 * plugins-cache refresh lands (the boot warm, the `plugin-manager/changed`
	 * push, post-mutation refreshes). The hero seeds its rows from `plugins()`
	 * at boot and re-reads on this signal — the adapter's revision signal is
	 * shell-side solid-js and cannot invalidate tui-base memos (the /plugins
	 * panel trap). Optional — a seam without it keeps the boot-seeded rows.
	 */
	onPluginsChanged?(listener: () => void): () => void
	/**
	 * C1 (the /plugins manager's management face, tui-pi plugins-manager
	 * parity): the full `pluginManager/listBundles` rows with real
	 * enablement. Optional — a seam without it degrades the panel to the
	 * read-only name@version listing.
	 */
	pluginBundles?(): SeamPluginBundleRow[]
	/**
	 * 025-w2-2 — warm/refresh the real plugin-manager bundle cache. The panel
	 * calls this on every open (the cache fills ASYNC after boot; a sync open
	 * read would see stale/empty rows). Optional — seams whose pluginBundles is
	 * already live (legacy HTTP facade) keep their own refresh strategy.
	 */
	refreshPluginBundles?(): Promise<void>
	/**
	 * 025-w2-2 — the real plugin-manager READ face (hand-projected). Coexists
	 * with the phase-1 local `plugins()`; the /plugins detail view reads
	 * `readBundleDetail` from here. Optional — absent on seams without the
	 * generic-arm plugin manager service.
	 */
	pluginsManager?: SeamPluginsManager
	/** Toggle a bundle on/off (the host persists the selection AND tries a
	 * live apply — `application` reports which). Optional with pluginBundles.
	 * R6: `confirm` MUST come from a confirmed TUI modal (seam-side gate). */
	setPluginBundleEnabled?(name: string, enabled: boolean, confirm: PluginWriteConfirm): Promise<SeamPluginChange>
	/** Uninstall a bundle's package (behind the panel's confirm). R6 gated. */
	removePluginBundle?(name: string, confirm: PluginWriteConfirm): Promise<SeamPluginChange>
	/** Inspect an install spec (the `i` flow's preview half; read-only, no gate). */
	inspectPluginSpec?(spec: string): Promise<SeamPluginInspection>
	/** Install a spec as an enabled bundle (the `i` flow's apply half). R6 gated.
	 *  The returned ChangeResult's `target` carries the install requestId so the
	 *  progress face can poll `waitForInstall`. */
	installPluginSpec?(spec: string, confirm: PluginWriteConfirm, requestId?: string): Promise<SeamPluginChange>
	/** Update an installed bundle to a target version (R6 gated; dry-run via inspect). */
	updatePluginBundle?(name: string, version: string, confirm: PluginWriteConfirm): Promise<SeamPluginChange>
	/** Set a plugin entry enabled (bundle-independent id; R6 gated). */
	setPluginEnabled?(id: string, enabled: boolean, confirm: PluginWriteConfirm): Promise<SeamPluginChange>
	/** Grant/clear a version exemption. acceptRisk MUST be true for a grant
	 *  after the user accepts the crash/data-loss risk in the confirm modal (R6 gated). */
	setVersionExemption?(packageVersion: string, runtimeVersion: string, enabled: boolean, acceptRisk: boolean, confirm: PluginWriteConfirm): Promise<SeamPluginChange>
	/** 025-w2-3c — poll one install's state via waitForInstall (R6 gated; progress is
	 *  a write-id but read-only in effect). Returns a closed-state projection. */
	waitForInstall?(requestId: string, confirm: PluginWriteConfirm): Promise<SeamInstallProgress>
	/** 025-w2-3c — cancel an in-flight install (R6 gated; bound to the modal cancel). */
	cancelInstall?(requestId: string, confirm: PluginWriteConfirm): Promise<SeamInstallCancellation>
	/**
	 * Session-scoped skill catalog (`skills/list`): the host's composed
	 * human-invocable skills, including plugin-provided rows a boot-time
	 * disk scan cannot see. The RPC needs a live session id, so the entry
	 * calls this once after the first user message; `onSkillsChanged` pushes
	 * the refreshed rows back. Optional — a seam without it keeps the disk
	 * snapshot.
	 */
	refreshSkills?(): Promise<SeamSkillRow[]>
	onSkillsChanged?(listener: (skills: readonly SeamSkillRow[]) => void): () => void
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
		/** `null` clears the key (inherit). Deep must be a non-negative integer;
		 * maxRounds a positive integer; background `"true"`/`"false"`. */
		set(
			name: string,
			field: "model" | "thinking" | "deep" | "maxRounds" | "background",
			value: string | null,
		): SeamAgentSetResult
		/** System prompt body (markdown after the frontmatter fence). */
		body(name: string): string
		/** The model's real reasoning-effort ladder ([] when none). */
		modelEfforts(providerID: string, modelID: string): Promise<SeamEffortOption[]>
		/** Official subagent plugin caps (settings ns `subagent`). Optional —
		 * a seam without it renders `n/a` on both limits rows. */
		officialCaps?(): Promise<SeamAgentOfficialCaps>
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
		/** The configured provider routes (settings llm-pi-ai providers dict). */
		routes(): Promise<SeamLoginRoute[]>
		/**
		 * Plan (never perform) one provider-route registration or clear in the
		 * llm-pi-ai settings namespace. The caller applies the returned ops via
		 * `settings.mutate` — the only sanctioned patch write channel.
		 */
		registerRoute(providerId: string, profile: Record<string, unknown> | undefined): Promise<SeamRegisterRoutePlan>
	}
	/**
	 * 025-w1b E — ACCOUNT login-state face (PKCE / DeepSeek account). STRICTLY
	 * SEPARATE from `login` above: `login` = provider credential/route double
	 * write (local file I/O); `account` = account sign-in state over the already
	 * wired S4 `account.*` plaintext frames. They share no field and never call
	 * each other — the two domains were explicitly partitioned by review.
	 *
	 * Every field is whitelist-projected by the bridge (`projectAccountViewForFrame`):
	 * the authorize URL VALUE never crosses a frame — only `authorizeUrlReady`
	 * (a boolean) does. No auth URL / token / credential value reaches the TUI.
	 */
	account?: {
		/** Current account state (status + bounded phase + presence booleans only). */
		getState(): Promise<SeamAccountState>
		/** Begin PKCE sign-in; resolves the projected state (URL value never returned). */
		startSignIn(callbackOrigin: string, loginSource: "web" | "desktop"): Promise<SeamAccountState>
		/** Cancel an in-flight sign-in attempt; resolves the projected state. */
		cancelSignIn(attemptId: string): Promise<SeamAccountState>
		/** Sign out; resolves the projected state. */
		signOut(): Promise<SeamAccountState>
		/** Whether any account task is running (boolean only). */
		hasRunningAccountTasks(): Promise<boolean>
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
	/**
	 * One child's buffered transcript lines (gap C3 /subagents viewer, tui-pi
	 * `bridge.getChildLog` parity): the capped per-child log the client's
	 * child follow pump folds (tool ▶/⎿ rows, assistant text lines). A
	 * snapshot read — re-read it on every render tick; the pump folds the
	 * live frames underneath. Optional — a seam without it renders the
	 * viewer's transcript as "unavailable".
	 */
	subagentTranscript?(id: string): string[]
	/**
	 * Interrupt one child subagent (tui-pi `bridge.cancelChild` parity):
	 * `subagents/interruptByParent` on the remote face. Optional — a seam
	 * without it leaves the viewer's stop gesture dark.
	 */
	interruptChild?(id: string): Promise<void>
	/**
	 * Ask the host to stop ALL of the parent session's live subagents in one
	 * call (0.23.1 `subagents.stopChildren` capability). Prefer this over the
	 * per-child interrupt loop when the bridge advertises the capability: it
	 * sees host-side children even before the client roster catches up.
	 * Disposition values mirror the bridge frame contract
	 * (`cancel-issued` | `already-settled` | `failed`); a per-child failure is
	 * reported as a row, never thrown. Optional — a seam without it falls back
	 * to the roster walk in `stopEverything`.
	 */
	stopChildren?(): Promise<Array<{ childId: string; disposition: string }>>
	/**
	 * Whether the connected bridge advertises a named optional capability from
	 * the handshake (`capabilities` array; missing field = empty set for old
	 * bridges). Lets consumers gate new faces without trial-and-error.
	 */
	hasBridgeCapability?(name: string): boolean
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
