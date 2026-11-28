/**
 * BridgeSessionSeam — the `SessionSeam` backed by the in-process host bridge
 * (ADR-0009 方案 D / ADR-0010 IPC contract). The bridge runs as a cordis
 * bundle inside the node host and speaks stdio JSON-lines; this seam is the
 * bun-side client of that protocol.
 *
 * SCOPE (first batch, 12 members — tickets/2026-11-18-seam-capability-matrix.md):
 *   COVERED  currentSessionId / resumeSession / newSession / dispose
 *   PARTIAL  status / storedTranscript / turn / interrupt /
 *            currentModelSelection / usageSummary / onSessionEvent / listSessions
 * The remaining 7 members exist only to satisfy `implements SessionSeam` and
 * are honest D3 stubs (async → UNSUPPORTED, sync → degrade + log) until their
 * own bridge frames land in a later batch. Fail-fast wiring lives in the
 * composition root — `client/seam-bootstrap.ts` and `bin/dsh-opentui.mjs` —
 * not in this file. S6: this is the SOLE seam; construction is unconditional.
 *
 * DEGRADE LAW (ticket §6 D3, non-negotiable):
 *   - A sync-signature member whose bridge capability is absent returns a
 *     contract-valid degraded value and logs through `ctx.logger`. It NEVER
 *     throws — throwing on the render path would break the view.
 *   - An async member whose capability is absent rejects with a protocol
 *     error carrying `code === "UNSUPPORTED"`. It never silently resolves
 *     with fake data (notably `listSessions`: a UNSUPPORTED frame is passed
 *     through, NOT flattened to `[]`).
 *
 * 027 hostCommands: the palette's host-command face rides the generic
 * `commands.list` / `commands.execute` arm through a DEDICATED RemoteSessionOps
 * instance (rpc adapter translates slash wire names to dot names; stream
 * sockets fail loud). The existing `/permission` mirror write path
 * (#permissionSwitch, 026) is deliberately NOT migrated onto this face —
 * known tech debt: two commands/execute callers with different projection
 * and error semantics; consolidation is a later round, not this one.
 *
 * The stdio transport (spawning the host with DSH_OPENTUI_BRIDGE_STDIO=1,
 * correlating {id} responses, forwarding {type,payload} events) is injected
 * as `BridgeTransport` — wiring it at the composition root is a separate
 * task. Keeping it injected makes every degrade path unit-testable without a
 * live host.
 */

import type {
	BridgeLinkStatus,
	SeamAccountState,
	SeamAgentOfficialCaps,
	SeamApprovalVerdict,
	SeamAskPick,
	SeamAskQuestion,
	SeamConfigurableProviderRow,
	SeamDiscoveredModel,
	SeamEffortOption,
	SeamModelDiscoveryRequest,
	SeamGoalRef,
	SeamGoalView,
	SeamHostCommandRow,
	SeamLlmProviderRow,
	PluginRowView,
	SeamPermissionCatalog,
	SeamPermissionSwitchResult,
	PluginWriteConfirm,
	SeamInstallCancellation,
	SeamInstallProgress,
	SeamPluginBundleRow,
	SeamPluginChange,
	SeamPluginDetail,
	SeamPluginInspection,
	SeamPluginRegistries,
	SeamPluginsManager,
	SeamProviderModel,
	SeamVersionExemptions,
	SeamSessionEvent,
	SeamSessionInfo,
	SeamSessionSummary,
	SeamSettingsDocument,
	SeamSettingsMutateResult,
	SeamSettingsOp,
	SeamSettingsSource,
	SeamSteerResult,
	SeamStatus,
	SeamSubagentView,
	SubagentTranscriptStatus,
	SeamTranscriptRow,
	SeamTurnCallbacks,
	SessionPruneApplyParams,
	SessionPruneApplyResult,
	SessionPruneRestoreList,
	SessionPruneRestoreResult,
	SessionPurgeCommitParams,
	SessionPurgeCommitResult,
	SessionPurgePrepareResult,
	SessionSeam,
} from "../../../tui-base/src/seams/session"
import type { RemoteJournalEntry } from "./remote-session-ops.ts"
import { RemoteSessionOps, journalToTranscriptRows } from "./remote-session-ops.ts"
// 025-w1a — /export sessionJournal face: HistoryJournalEntry is the /history
// fold input (the exact shape remote sessionJournal() returns).
import type { HistoryJournalEntry } from "../../../tui-base/src/routes/session/history-data.ts"
// S6: the shared journal projector moved to its permanent home so the bridge
// path survives the legacy seam deletion (zero behavior change).
import { projectJournalRecord } from "./journal-projection.ts"
// ask-outcome notice — single shared derivation for live frames + DEAD replay.
import { deriveAskOutcomeNotice, type AskOutcomeNotice } from "./ask-outcome.ts"
// 025-w2-1 — /btw side session (create -> prompt -> wait) over the generic arm.
import { runSideSession, SideSessionError } from "./bridge-side-session.ts"
import { tokensPerSecond } from "../agent/loop.ts"
// S5 — real local config/settings/agents faces replace the old `{}` / honest-
// failure degrades (no mocks; every read/write touches the operator's files).
import { LocalAgentsFace, LocalConfigStore, LocalLoginFace, LocalPresetFace, LocalSettingsStore } from "./local-config-faces.ts"
import { resolveDshHome } from "./remote-local-fs.ts"
import { DEFAULT_PROFILE } from "./profile-constants.ts"
// 025-w1a — /plugins phase-1 local install manifest (profile node_modules).
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
// 025-w2-3 — install request id (echoed to drive waitForInstall / cancelInstall).
import { randomUUID } from "node:crypto"
// 025-w2-2 — hand-written plugin-manager read face + second whitelist projection.
import {
	projectBundleRows,
	projectCancellation,
	projectChange,
	projectDetail,
	projectInstallProgress,
	projectInspection,
	projectPluginRows,
	projectRegistries,
	projectVersionExemptions,
	projectVersions,
} from "./bridge-plugins-manager.ts"
// 025-w2-4 — hand-written directory faces + second whitelist projection.
import {
	projectConfigurableProviders,
	projectDiscoverModels,
	projectLlmProviders,
	projectPermissionCatalog,
} from "./bridge-directory.ts"
// 025-w2-5 — hand-written goals face + second whitelist projection (the
// load-bearing defence for the AMEND-2 schema-open/null blind-spot family).
import {
	projectCreateGoalResult,
	projectGoalRef,
	projectGoalView,
} from "./bridge-goals.ts"
// 026 web-mirror — hand-written SECOND whitelist for commands/execute
// (jsonSchema:null blind-spot family; see bridge-permission.ts).
import { projectPermissionSwitch } from "./bridge-permission.ts"
// B1 S4/S5 — pure host-first settings route projection (field whitelist, caps, failure reasons).
import {
	hostMutateError,
	officialCapsFromDocument,
	projectHostMutateResult,
	projectHostSettingsDocument,
	settingsFailureReason,
} from "./bridge-settings-route.ts"
// maxRounds hard-stop ladder — the RUNTIME consumer of the profile config.json
// `maxRounds`/`maxRoundsGrace` knobs. One policy instance per session binding;
// driven by additive `agent.progress` rounds, delivered through the seam's real
// child steer/interrupt faces (settings-defaults-029 default-50 blocker).
import { SubagentRoundPolicy, parseSubagentRoundLimits } from "../subagent-policy.ts"
import { BridgeProtocolError } from "./seam-projections/bridge-protocol-error.ts"
import {
	projectBridgePruneApply,
	projectBridgePurgeCommit,
	projectBridgePurgePrepare,
	projectBridgePrunePlan,
	projectBridgePruneRestore,
	projectBridgePruneRestoreList,
} from "./seam-projections/prune-purge.ts"
import type { BridgePrunePlan } from "./seam-projections/prune-purge.ts"
import { projectBridgeSessionList, projectCurrentCwd } from "./seam-projections/session-list.ts"

export { BridgeProtocolError } from "./seam-projections/bridge-protocol-error.ts"
export {
	projectBridgePruneApply,
	projectBridgePurgeCommit,
	projectBridgePurgePrepare,
	projectBridgePrunePlan,
	projectBridgePruneRestore,
	projectBridgePruneRestoreList,
} from "./seam-projections/prune-purge.ts"
export type { BridgePrunePlan, BridgePrunePlanEntry } from "./seam-projections/prune-purge.ts"
export { projectBridgeSessionList, projectCurrentCwd } from "./seam-projections/session-list.ts"

/**
 * 025-w2-3 (R6) — seam-side confirm gate (structural mirror of the tui-base
 * guard). Kept local so shell never imports a runtime value from tui-base's
 * seam module (bundle-boundary safety). A write face refuses any call whose
 * `confirm` is not a structurally-valid token BEFORE touching the transport.
 */
function writeConfirmed(confirm: PluginWriteConfirm | undefined): boolean {
	return (
		typeof confirm === "object" && confirm !== null &&
		(confirm as unknown as Record<string, unknown>).__pluginWriteConfirm === true &&
		typeof (confirm as unknown as Record<string, unknown>).operation === "string"
	)
}
const CONFIRM_REQUIRED = (method: string) =>
	new BridgeProtocolError("CONFIRM_REQUIRED", `${method}: write requires a confirmed TUI modal token`)

// 027 — hostCommands cache tuning: 15s TTL measured from request initiation
// (palette re-opens inside the window ride the cache, keystrokes never hit the
// wire), 100ms refresh debounce (palette open/close flapping must not hammer
// the generic arm).
const HOST_COMMANDS_TTL_MS = 15_000
const HOST_COMMANDS_REFRESH_DEBOUNCE_MS = 100

// ---------------------------------------------------------------------------
// Injected transport surface (ADR-0010 frame shapes)
// ---------------------------------------------------------------------------

/** One `event{type,payload}` frame from the bridge. */
export interface BridgeEventFrame {
	type: string
	payload: unknown
}

// ---- S3 host→client push face ------------------------------------------------
/** One whitelisted `cap.event` push item. No host payload is echoed. */
export interface CapPushEvent {
	readonly methodId: string
	readonly sessionId: string
	readonly seq: number
	readonly eventType: string
}

/** Lifecycle of one session's push subscription, observed by the seam. */
export type CapPushStatusState = "attached" | "degraded" | "disconnected"

/** Aggregate view of one session's per-method push subscriptions. */
export interface CapPushStatus {
	readonly sessionId: string
	readonly state: CapPushStatusState
	/** Highest in-order seq across this session's subscriptions (0 = fresh/reset). */
	readonly lastSeq: number
}

/**
 * Stage at which the bridge reached DEAD (ADR-0010 DEAD recovery, A1).
 * `spawn` = the child never started, `handshake` = hello/ping rejected,
 * `runtime` = a live child exited/was signalled, `closed` = deliberate teardown.
 */
export type BridgeDeadStage = "spawn" | "handshake" | "runtime" | "closed"

/** Structured cause of the current DEAD transition (A1), republished on the
 *  existing `onEvent` pipeline as a `bridge.dead` frame. A3: a successful
 *  recover() clears it; a new DEAD (including a failed recovery) replaces it. */
export interface BridgeDeadCause {
	stage: BridgeDeadStage
	/** Process exit code on a runtime exit; null when unavailable. */
	code: number | null
	/** Terminating signal on a runtime exit; null when unavailable. */
	signal: string | null
	/** Short human-readable summary. */
	message: string
	/** A3: `permanent` means another recover() cannot help (a version /
	 *  fingerprint / host-compat mismatch). Absent/`retriable` means a manual
	 *  retry may succeed. */
	recoverability?: "permanent" | "retriable"
	/** A3: the concrete items that failed a recovery handshake, e.g.
	 *  `["VERSION_INCOMPATIBLE"]`. */
	mismatches?: string[]
}

/** The minimal client half of the stdio bridge, injected by the caller. */
export interface BridgeTransport {
	/** Send `request{id,method,params}`; resolve with `result`, reject with a
	 *  `BridgeProtocolError` when the response frame is `ok:false`. */
	request(method: string, params?: Record<string, unknown>): Promise<unknown>
	/** Subscribe to `event{type,payload}` frames; returns a disposer. */
	onEvent(listener: (event: BridgeEventFrame) => void): () => void
	/**
	 * The profile the dsh process was actually spawned under. `StdioBridgeTransport`
	 * exposes it from its `--profile` argv. Optional: a transport that does not
	 * expose it simply skips the /login write-time consistency check — the seam
	 * never guesses or fabricates a host profile.
	 */
	readonly profile?: string
}

/** `ctx.logger` — the host logger shape (info/warn/error), structural so the
 *  seam does not import the bridge package at runtime. */
export interface BridgeSeamLogger {
	info(message: string, ...args: unknown[]): void
	warn(message: string, ...args: unknown[]): void
	error(message: string, ...args: unknown[]): void
	/** L2b C3: optional debug channel (the timeout fallback logs here). Hosts
	 *  without a debug method are fine — the seam calls it via optional chaining. */
	debug?(message: string, ...args: unknown[]): void
}

export interface BridgeSeamContext {
	logger: BridgeSeamLogger
}

/**
 * L2b C3: injectable clock for the subagent-stop confirm-then-emit poll loop.
 * Tests replace it to drive the 250ms→1s backoff and the 45s deadline without
 * real waits; production uses a real timer + `Date.now()` (set in the ctor).
 */
export interface BridgeConfirmClock {
	/** Resolve after `ms` (real) simulated milliseconds. */
	sleep(ms: number): Promise<void>
	/** Monotonic-ish elapsed clock (ms) used for the confirm deadline. */
	now(): number
}

/**
 * ADR-0011 T8/Q4: a stable machine code for WHY the bridge seam could not
 * confirm an approval provider. A code (not prose) keeps localization in the
 * composition root's i18n layer instead of baking English into the shell seam.
 */
export type PermissionUnavailableReason = "no-provider" | "bridge-offline" | "ask-no-provider"

export interface BridgeSessionSeamOptions {
	transport: BridgeTransport
	ctx: BridgeSeamContext
	/** S5 — dsh home / profile / workspace root for the real local config,
	 *  settings and agents faces. Default to $DSH_HOME (or ~/.dsh), the
	 *  `opentui` client profile and the process cwd. */
	dshHome?: string
	profile?: string
	workspaceDir?: string
	/** A2: called synchronously once when a `bridge.dead` frame arrives, even
	 *  with no in-flight turn (the idle-period crash case). The composition
	 *  root turns this into an immediate transient UI notice. */
	onDead?: (cause: BridgeDeadCause) => void
	/** ADR-0011 T8/Q4: called at most ONCE per process from `permissionCatalog()`
	 *  when no approval provider can be confirmed. The composition root turns
	 *  this into a transient (never persistent) localized fail-closed notice. */
	onPermissionUnavailable?: (reason: PermissionUnavailableReason) => void
	/** L2b C3: override the confirm-then-emit poll clock (tests only). */
	confirmClock?: BridgeConfirmClock
}

// ---------------------------------------------------------------------------
// ADR-0011 ask frames (host → client events, client → host ask.response)
// ---------------------------------------------------------------------------

/** One `ask.request` payload, structurally mirrored from ADR-0011 §3.2. Kept
 *  local to the shell client so this file never imports the bridge package at
 *  runtime (same rule as BridgeTransport above). */
export interface BridgeAskRequestPayload {
	eventId: string
	sessionId: string
	kind: "approval" | "questions"
	toolName?: string
	callId?: string
	reason?: string
	questions?: SeamAskQuestion[]
	deadlineAt?: number
	detachGraceMs?: number
	escalation?: boolean
	/** F1-A3: present only on a subagent ask — the requesting child session id.
	 *  Lets the TUI tell a child card apart from a parent card. */
	childSessionId?: string
	/** F1-A3: present only on a subagent ask — the parent session whose ask
	 *  channel carries it (equals `sessionId`). Lets the TUI mount the child
	 *  card under the parent trajectory. A parent ask carries neither field. */
	parentSessionId?: string
}

/** Derive the turn id from the ADR-0011 association key `${turnId}:ask-${seq}`. */
function askTurnId(eventId: string): string {
	const i = eventId.lastIndexOf(":ask-")
	return i === -1 ? "" : eventId.slice(0, i)
}

function optionalStringField(row: Record<string, unknown>, key: string): string | undefined {
	const value = row[key]
	return typeof value === "string" && value !== "" ? value : undefined
}

/** Parse an `ask.request` payload. Returns undefined for malformed frames —
 *  a bad ask frame must never poison the pending queue or throw on the event
 *  pump (the seam's event path is shared with the render loop). */
function parseAskRequest(value: unknown): BridgeAskRequestPayload | undefined {
	const row = asRecord(value)
	const eventId = optionalStringField(row, "eventId")
	const sessionId = optionalStringField(row, "sessionId")
	const kind = row.kind
	if (eventId === undefined || sessionId === undefined || (kind !== "approval" && kind !== "questions")) {
		return undefined
	}
	const out: BridgeAskRequestPayload = { eventId, sessionId, kind }
	// F1-A3: the two child-ask identity fields ride the same wire payload. They
	// are optional — a parent ask omits both, so parsing stays backward-safe.
	for (const key of ["toolName", "callId", "reason", "childSessionId", "parentSessionId"] as const) {
		const v = optionalStringField(row, key)
		if (v !== undefined) out[key] = v
	}
	for (const key of ["deadlineAt", "detachGraceMs"] as const) {
		const v = row[key]
		if (typeof v === "number" && Number.isFinite(v)) out[key] = v
	}
	if (row.escalation === true) out.escalation = true
	if (Array.isArray(row.questions)) {
		const questions: SeamAskQuestion[] = []
		for (const raw of row.questions) {
			const q = asRecord(raw)
			const id = optionalStringField(q, "id")
			const prompt = optionalStringField(q, "prompt")
			if (id === undefined || prompt === undefined || !Array.isArray(q.options)) continue
			const options: SeamAskQuestion["options"] = []
			for (const rawOpt of q.options) {
				const opt = asRecord(rawOpt)
				const label = optionalStringField(opt, "label")
				if (label === undefined) continue
				const description = optionalStringField(opt, "description")
				options.push({ label, ...(description !== undefined ? { description } : {}) })
			}
			if (options.length === 0) continue
			const question: SeamAskQuestion = { id, prompt, options }
			for (const key of ["header", "description", "detail"] as const) {
				const v = optionalStringField(q, key)
				if (v !== undefined) question[key] = v
			}
			if (q.multiSelect === true) question.multiSelect = true
			questions.push(question)
		}
		if (questions.length > 0) out.questions = questions
	}
	return out
}

/** `SeamApprovalVerdict` plus the two escalated behaviors the wire exposes.
 *  `onApprove`'s real type only promises the first two; the latter two are
 *  handled defensively (a view/caller may widen it) and gated on the ask's
 *  `escalation` flag before a frame is ever sent (ASK_INVALID_RESPONSE). */
type BridgeApproveVerdict = SeamApprovalVerdict | "always" | "session"

/** Args passed to `onApprove(name, args)` — the ask.request wire carries no
 *  tool arguments, so surface the identifying fields the host did send.
 *
 *  F1-A3: a child ask also carries `eventId`, which is the globally-unique
 *  `${parentTurnId}:ask-N` key. When a parent card and a child card coexist in
 *  the same turn, the controller uses it to correlate each card to its own
 *  snapshot row (no cross-over / no double card). A parent ask keeps the
 *  legacy `{callId, reason}` shape — it is the single-card path. */
function approvalArgs(request: BridgeAskRequestPayload): Record<string, unknown> {
	return {
		...(request.callId !== undefined ? { callId: request.callId } : {}),
		...(request.reason !== undefined ? { reason: request.reason } : {}),
		...(request.parentSessionId !== undefined ? { eventId: request.eventId } : {}),
	}
}

/** A registered ask provider answers an approval ask via a synthesized
 *  allow/deny question (the default-surface fallback when no turn-scoped
 *  onApprove is active). Real approvals should go through onApprove. */
function approvalQuestion(request: BridgeAskRequestPayload): SeamAskQuestion {
	const toolName = request.toolName ?? "tool"
	return {
		id: request.eventId,
		prompt: request.reason ?? `Allow ${toolName}?`,
		options: [{ label: "allow" }, { label: "deny" }],
		header: "Approval",
		...(request.callId !== undefined ? { detail: `callId: ${request.callId}` } : {}),
	}
}

function approvalVerdictFromPicks(request: BridgeAskRequestPayload, picks: SeamAskPick[]): BridgeApproveVerdict {
	const pick = picks.find((p) => p.questionId === request.eventId)
	const choice = pick?.custom ?? pick?.selections?.[0] ?? pick?.selected ?? ""
	return /^(allow|allowed-once|yes|approve)$/i.test(choice) ? "allowed-once" : "rejected"
}

/** Map SeamAskPick[] → the wire `{id, selected[], custom?}` answers shape,
 *  mirroring remote-waterfall.ts:206-223 `answersValue` exactly: custom wins,
 *  missing/empty picks become `{selected:[],custom:"declined"}`, multi-select
 *  rides `selections` with `selected` as the first pick. */
function answersFor(request: BridgeAskRequestPayload, picks: SeamAskPick[]): { id: string; selected: string[]; custom?: string }[] {
	const questions = request.questions ?? []
	if (questions.length === 0) {
		return picks.map((pick) => ({
			id: pick.questionId,
			selected: pick.selections?.length ? [...pick.selections] : [pick.selected],
			...(pick.custom !== undefined && pick.custom !== "" ? { custom: pick.custom } : {}),
		}))
	}
	return questions.map((q) => {
		const pick = picks.find((p) => p.questionId === q.id)
		if (pick?.custom !== undefined && pick.custom !== "") return { id: q.id, selected: [], custom: pick.custom }
		if (pick === undefined || (pick.selected === "" && (pick.custom ?? "") === "")) {
			return { id: q.id, selected: [], custom: "declined" }
		}
		return {
			id: q.id,
			selected: pick.selections?.length ? [...pick.selections] : [pick.selected],
		}
	})
}

/** Fail-closed response for a provider-less ask: `verdict:"unavailable"` per
 *  ADR-0011 §5 ASK_CHANNEL_UNAVAILABLE (never a silent approve). Questions
 *  additionally carry declined answers because the host rejects a questions
 *  response with no answers (ask-registry.ts:310). */
function unavailableResponse(request: BridgeAskRequestPayload): Record<string, unknown> {
	return request.kind === "questions"
		? { eventId: request.eventId, kind: "questions", verdict: "unavailable", answers: answersFor(request, []) }
		: { eventId: request.eventId, kind: "approval", verdict: "unavailable" }
}

// ---------------------------------------------------------------------------
// Pure helpers / projections (unit-tested standalone)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
}

// 025-w1b E — account domain helpers. The bridge already projects account
// frames to the four bounded fields; these re-project defensively so no future
// frame shape can leak an authorize URL / token value into the TUI.
const ACCOUNT_STATUSES: ReadonlySet<string> = new Set(["signed-out", "credential-stored"])
const ACCOUNT_PHASES: ReadonlySet<string> = new Set([
	"initializing", "waiting-browser", "exchanging", "committing",
	"succeeded", "cancelled", "expired", "failed",
])

function projectSeamAccountView(value: unknown): SeamAccountState {
	const v = asRecord(value)
	return {
		status: typeof v.status === "string" && ACCOUNT_STATUSES.has(v.status) ? v.status : null,
		attemptPhase: typeof v.attemptPhase === "string" && ACCOUNT_PHASES.has(v.attemptPhase) ? v.attemptPhase : null,
		authorizeUrlReady: v.authorizeUrlReady === true,
		linksPresent: v.linksPresent === true,
	}
}

/** Caller metadata for account.* frames — no credential value, just identity. */
function accountClientMeta(): { version: string; locale: string; timezoneOffsetSeconds: number } {
	return {
		version: "0.25-w1b",
		locale: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().locale : "en",
		timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
	}
}

/** Bridge codes that are ordinary steer refusals (not transport failures).
 *  Everything else propagates unchanged — a rejected steer is never retried. */
const STEER_REJECTION_CODES = new Set([
	"STEER_IDLE",
	"STEER_ENDED",
	"STEER_ABORTING",
	"SESSION_NOT_OPEN",
	"BAD_PARAMS",
	"UNSUPPORTED",
])

/** Build the honest UNSUPPORTED rejection for an absent async capability. */
function unsupported(capability: string): never {
	throw new BridgeProtocolError(
		"UNSUPPORTED",
		`${capability} is not backed by the in-process bridge`,
		{ capability },
	)
}

/** One `journal.replay` row (the bridge's read-only durable row shape). */
export interface BridgeReplayRow {
	seq: number
	type: string
	payload: unknown
}

// ---------------------------------------------------------------------------
// RESTORE — session-level live model route folded from the durable journal.
// `payload` on a replay row IS the host event's `data` (see the projection note
// below), so `request/header` carries `{header:{config:{provider,model,..}}}`
// (rc.2 dsh-session `EpochHeader`) and `model/selection` carries the staged
// ModelSelection. rc.5 is not pinned line-by-line, so both a direct and a
// wrapped/alias shape are accepted — a miss degrades to the default, never a
// fabricated route.
// ---------------------------------------------------------------------------

/** One complete model route (the wire's `ModelSelection` shape). */
export interface ModelRouteSelection {
	providerID: string
	modelID: string
	reasoningEffort?: string
}

/** Mutable per-session fold state. `pending` is a staged `model/selection` a
 *  request has not consumed yet; `lastUsed` is the latest `request/header` config. */
export interface ModelRouteFold {
	pending?: ModelRouteSelection
	lastUsed?: ModelRouteSelection
}

/**
 * The session cache adds three facts the pure fold does not carry:
 *  - `sessionId`: which session the fold belongs to (reply/drain races);
 *  - `complete`: a FULL journal read (`from===1`) has fed it. An incremental
 *    drain (from>1) may only UPDATE an existing cache; creating one from a
 *    partial window would pin a permanently empty route because
 *    #ensureModelRoute short-circuits on any existing cache. NB: a CLAMPED
 *    drain is NOT full — #drainJournal re-reads from `cursor`, not from 1.
 *  - `lastSeq`: the highest journal seq already folded. A late replay of OLD
 *    rows must never overwrite a newer incremental fact (P1-1), and rows read
 *    while the establishment replay was in flight are admitted by seq once it
 *    lands (P1-2).
 */
type ModelRouteCache = ModelRouteFold & { sessionId: string; complete: boolean; lastSeq: number }

function routeFromSelection(value: unknown): ModelRouteSelection | undefined {
	const row = asRecord(value)
	const providerID = typeof row.providerID === "string" ? row.providerID : typeof row.provider === "string" ? row.provider : ""
	const modelID = typeof row.modelID === "string" ? row.modelID : typeof row.model === "string" ? row.model : ""
	if (!providerID || !modelID) return undefined
	const reasoningEffort = typeof row.reasoningEffort === "string" && row.reasoningEffort !== ""
		? row.reasoningEffort : undefined
	return { providerID, modelID, ...(reasoningEffort !== undefined ? { reasoningEffort } : {}) }
}

/** `model/selection` event data → the staged selection. Accept the selection
 *  directly or under `selection` / `data` (rc.2 vs rc.5 drift). */
function routeFromSelectionEvent(payload: unknown): ModelRouteSelection | undefined {
	const data = asRecord(payload)
	const nested = asRecord(data.data)
	return routeFromSelection(data.selection)
		?? routeFromSelection(data)
		?? routeFromSelection(nested.selection)
		?? routeFromSelection(nested)
}

/** `request/header` event data → the config the last request actually ran
 *  under. rc.2 `EpochHeader` is `{header:{config:LlmCallConfig}}`; the extra
 *  paths only guard an rc.5 field rename without inventing a route. */
function routeFromHeader(payload: unknown): ModelRouteSelection | undefined {
	const data = asRecord(payload)
	const header = asRecord(data.header)
	const nested = asRecord(data.data)
	const nestedHeader = asRecord(nested.header)
	for (const candidate of [header.config, nestedHeader.config, data.config, header, nestedHeader]) {
		const route = routeFromSelection(candidate)
		if (route !== undefined) return route
	}
	return undefined
}

/**
 * `request/context` event data → the route the request actually ran under.
 * The in-process host journals `request/context` (NOT `request/header`) for
 * child/session requests; the shape is `{provider, model, contextWindow, ...}`
 * at the top level (bridge-session-seam.ts:3161-3164 reads the SAME fields for
 * the context-window guard, and bridgeChildJournalMeta reads data.model).
 * No reasoningEffort rides this row; `applyUsedRoute` inherits a known effort
 * from a matching staged/previous route instead of clearing it.
 */
function routeFromContext(payload: unknown): ModelRouteSelection | undefined {
	const data = asRecord(payload)
	const providerID = optionalStringField(data, "provider")
	const modelID = optionalStringField(data, "model")
	if (providerID === undefined || modelID === undefined) return undefined
	return { providerID, modelID }
}

/** An actually-used route becomes `lastUsed` and consumes a matching pending
 *  selection so a stale staged route never overrides the newer one.
 *  P1-3: `request/context` carries no `reasoningEffort`. When the used route
 *  matches a known route (the staged selection or the previous `lastUsed`),
 *  inherit its effort so `currentEffort()` does not forget the effort the host
 *  is actually running. A DIFFERENT provider/model never inherits — effort is
 *  per-route. A `request/header` that already carries an effort is authoritative. */
function applyUsedRoute(fold: ModelRouteFold, used: ModelRouteSelection): void {
	if (used.reasoningEffort === undefined) {
		const matches = (route: ModelRouteSelection | undefined) =>
			route !== undefined
			&& route.providerID === used.providerID
			&& route.modelID === used.modelID
			&& route.reasoningEffort !== undefined
		const known = matches(fold.pending) ? fold.pending
			: matches(fold.lastUsed) ? fold.lastUsed
			: undefined
		if (known !== undefined) used = { ...used, reasoningEffort: known.reasoningEffort }
	}
	fold.lastUsed = used
	if (fold.pending !== undefined
		&& fold.pending.providerID === used.providerID
		&& fold.pending.modelID === used.modelID) {
		fold.pending = undefined
	}
}

/** Fold replay rows into a session's live route. Newest row wins; a request
 *  row whose route matches the pending selection consumes it so a stale pending
 *  never overrides a newer lastUsed route. Both wire shapes are accepted:
 *  `request/header` (rc.2 header.config) and `request/context` (inproc host). */
export function foldBridgeModelRoute(fold: ModelRouteFold, rows: readonly BridgeReplayRow[]): void {
	for (const row of rows) {
		if (row.type === "model/selection") {
			const staged = routeFromSelectionEvent(row.payload)
			if (staged !== undefined) fold.pending = staged
		} else if (row.type === "request/header") {
			const used = routeFromHeader(row.payload)
			if (used !== undefined) applyUsedRoute(fold, used)
		} else if (row.type === "request/context") {
			const used = routeFromContext(row.payload)
			if (used !== undefined) applyUsedRoute(fold, used)
		}
	}
}

/** The only journal row types that can change a live model route. */
const ROUTE_ROW_TYPES = new Set(["model/selection", "request/header", "request/context"])

/**
 * P1-1/P1-2: fold ONLY rows newer than the cache's seq watermark, then advance
 * it. Overlapping drains are safe: a row at or below the watermark is a fact we
 * already folded, so a late replay of OLD rows can never overwrite a newer
 * incremental fact. Rows buffered during an in-flight replay (newer than the
 * replay cursor) enter through the same gate exactly once (dedup by seq), in
 * ascending order so "newest row wins" still holds inside the batch.
 */
function foldModelRouteCache(cache: ModelRouteCache, rows: readonly BridgeReplayRow[]): void {
	if (rows.length === 0) return
	const bySeq = new Map<number, BridgeReplayRow>()
	let maxSeq = cache.lastSeq
	for (const row of rows) {
		if (!Number.isFinite(row.seq) || row.seq <= cache.lastSeq) continue
		bySeq.set(row.seq, row)
		if (row.seq > maxSeq) maxSeq = row.seq
	}
	if (bySeq.size === 0) return
	const fresh = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
	foldBridgeModelRoute(cache, fresh)
	cache.lastSeq = maxSeq
}

/** The route in force: a staged selection wins until a request consumes it. */
export function liveModelRoute(fold: ModelRouteFold): ModelRouteSelection | undefined {
	return fold.pending ?? fold.lastUsed
}

/**
 * A4+A5: read-only outcome of a post-DEAD session recovery. Exposed on the
 * seam so the UI branch (A8) can render "已连接未挂载" / "补齐 N 条" without
 * polling, and so a failed open is an explicit state rather than a retry loop.
 */
export type BridgeRecoveryState = "idle" | "recovering" | "attached" | "locked" | "failed"

export interface BridgeRecoveryResult {
	state: BridgeRecoveryState
	sessionId: string | undefined
	/** Number of NEW, deduplicated journal events applied (the N in the notice). */
	applied: number
	/** Inclusive seq lower bound the drain started from (1 when no lastSeq). */
	from: number
	/** Full-log exclusive upper bound from the bridge (`maxSeq + 1`). */
	cursor: number
	/** Transcript projection via the EXISTING journal pipeline (never a new render path). */
	rows: SeamTranscriptRow[]
	error?: { code: string; message: string }
}

/**
 * `journal.replay` rows `{seq,type,payload}` → `SeamTranscriptRow[]`.
 *
 * `payload` is the host event's `data`, so each row is structurally a
 * `RemoteJournalEntry` (`{type,seq,time,data}`) with `data = payload`; `time`
 * is absent on the bridge wire and irrelevant to the transcript projection.
 * Reusing `journalToTranscriptRows` keeps the call→result pairing, ask-row
 * merge and subagent-origin filtering EXACTLY the same as the remote seam —
 * no second implementation of those rules (ticket hard constraint 3).
 * The final SeamTranscriptRow mapping mirrors session-seam-adapter.ts:208-230.
 *
 * `skip` (a ROW COUNT) and `journal.replay`'s `from` (an INCLUSIVE SEQ LOWER
 * BOUND) are NOT equivalent: seqs are sparse — non-human events (turn/start,
 * tool/call, compaction markers) occupy seqs, and compaction can drop whole
 * ranges — so "skip the first 2 rows" over seqs [1,5,9] must yield [9], while
 * `from=2` would yield [5,9]. `cursor` is `maxSeq+1`, the FULL log's exclusive
 * upper bound and independent of `from`, so it cannot express a row offset
 * either. Therefore this seam sends `journal.replay` WITHOUT `from`, reads the
 * whole log, and slices by row count locally (see storedTranscript below).
 */
export function bridgeReplayRowsToSeamTranscript(
	rows: readonly BridgeReplayRow[],
	skip = 0,
	/** Bound/read session id. Only callers painting the session transcript
	 *  (storedTranscript → hydrate, and #recover's result.rows) pass it; the
	 *  child-log and sessionInfo callers omit it, so those paths stay at ZERO
	 *  notice output. */
	sessionId?: string,
): SeamTranscriptRow[] {
	const entries: RemoteJournalEntry[] = rows.map((row) => ({
		type: row.type,
		seq: row.seq,
		time: 0,
		data: asRecord(row.payload),
	}))
	const durable = journalToTranscriptRows(entries, skip)
	const stored: SeamTranscriptRow[] = durable.map((row) => {
		if (row.kind === "ask") {
			return { kind: "ask", text: "", final: true, entries: row.entries }
		}
		if (row.kind === "tool") {
			return { kind: "tool", text: row.name, final: true, args: row.args, output: row.brief, ok: row.ok }
		}
		return { kind: row.kind, text: row.text, final: true }
	})
	if (sessionId === undefined || sessionId === "" || sessionId === "unknown") return stored

	// Hydrate carrier (§8.3 / A21): derive NOTICES from the RAW journal via the
	// same single derivation the DEAD events path uses, then merge by anchorSeq.
	// The stored row keeps its own kind `"notice"` (never an assistant row) and
	// carries the shared `ask-outcome:<eventId>` id; `toStoredRow` builds the
	// fixed `notice:<id>` view key. No event is emitted on this path.
	const notices = deriveAskOutcomeNoticeViews(rows, sessionId)
	if (notices.length === 0) return stored

	// `anchorSeq` is a journal SEQ (sparse: turn/start, tool/call, compaction
	// markers occupy seqs that emit no stored row). Count how many stored rows
	// the journal prefix up to the anchor produces, then subtract `skip` to get
	// the insertion point in `stored` — the notice lands right after the row
	// that carries the anchor (terminal ask row, or the turn/end's last line).
	const prefixCounts = new Map<number, number>()
	const byInsert = new Map<number, AskOutcomeNoticeView[]>()
	for (const notice of notices) {
		let count = prefixCounts.get(notice.anchorSeq)
		if (count === undefined) {
			count = journalToTranscriptRows(entries.filter((e) => e.seq <= notice.anchorSeq), 0).length
			prefixCounts.set(notice.anchorSeq, count)
		}
		const insertAt = Math.max(0, Math.min(stored.length, count - skip))
		const bucket = byInsert.get(insertAt)
		if (bucket === undefined) byInsert.set(insertAt, [notice])
		else bucket.push(notice)
	}
	const merged: SeamTranscriptRow[] = []
	for (let i = 0; i <= stored.length; i++) {
		for (const notice of byInsert.get(i) ?? []) {
			merged.push({ kind: "notice", id: notice.id, text: notice.text, final: true })
		}
		if (i < stored.length) merged.push(stored[i]!)
	}
	return merged
}

/**
 * P1-2: drained journal rows → the SAME wire events `seam-rows.ts` already
 * consumes for the remote seam (`message.updated` / `message.part.updated` /
 * `session.error`). Emitting them through `onSessionEvent` is the ADR-0010:35
 * "经既有 transcript 管线 apply" path: no new render path, and the existing
 * keyed upsert (`user:${id}`, `assistant:${messageID}:${partID}`,
 * `tool:${messageID}:${partID}`) is naturally idempotent.
 *
 * Text/user/notice/error records go through `projectJournalRecord` verbatim —
 * the remote seam's journal feed uses the identical projector, so the source
 * filter, ask merge and seq-derived ids stay in one place. `projectJournalRecord`
 * deliberately skips tool records (the live turn paints those), so replay
 * `tool/call`+`tool/result` pairs are projected here with the same call→result
 * pairing and brief as `journalToTranscriptRows`, under a seq-derived messageID
 * so a re-delivered drain patches the same row instead of appending a second.
 *
 * `seen` is the keys-level half of the seq/keys double insurance: even if a
 * paged drain overlaps (or a second DEAD replays a row already painted live),
 * an event whose key was already emitted is skipped — no duplicate line.
 */
export function seamReplayEventKey(event: SeamSessionEvent): string {
	const details = asRecord(event.details)
	return `${event.type}:${String(details.id ?? details.messageID ?? "")}:${String(asRecord(details.part).id ?? "")}`
}

/** Journal kind from either the payload's `kind` or the plugin record type on
 *  the wire (`plugin:opentui/ask/responded` etc.). */
function askJournalKind(row: BridgeReplayRow, data: Record<string, unknown>): string | undefined {
	if (typeof data.kind === "string" && data.kind !== "") return data.kind
	const prefix = "plugin:opentui/ask/"
	if (row.type.startsWith(prefix)) return `ask.${row.type.slice(prefix.length)}`
	return undefined
}

/**
 * One fully-shaped ask-outcome notice view. Both consumers — the DEAD replay
 * event path and the hydrate (stored) path — are built from these SAME objects,
 * so id / text / anchorSeq are byte-identical (§8.4 / A18 / A28 / A29) and the
 * stored path covers every notice category the events path can paint.
 */
interface AskOutcomeNoticeView {
	/** `ask-outcome:<eventId>` (A11 conflicts append `:seq-N`). */
	id: string
	text: string
	anchorSeq: number
	sessionId: string
	childSessionId?: string
}

/**
 * The SINGLE journal→notice derivation, shared by the DEAD events path and the
 * hydrate/stored path (research §8.4 / hydrate contract §3). It calls the one
 * `deriveAskOutcomeNotice` for every terminal / orphan row, so text is fixed
 * in one place only.
 *
 * - `ask.responded` / `ask.cancelled` → one notice per `eventId`, the MAX-seq
 *   terminal; distinct real terminal reasons stay distinguishable (A11).
 * - `source:'summary'`, missing/unknown/mismatched sessionId are dropped by
 *   `deriveAskOutcomeNotice` and the session guard below (A19 / A17 / A27).
 * - a `requested` row with NO terminal in this window AND a `turn/end` on the
 *   same turnId yields an orphan anchored after that turn/end (A23 / A29).
 */
function deriveAskOutcomeNoticeViews(rows: readonly BridgeReplayRow[], sessionId: string): AskOutcomeNoticeView[] {
	const out: AskOutcomeNoticeView[] = []

	// 1. Terminal rows, grouped by eventId.
	const terminals = new Map<string, BridgeReplayRow[]>()
	for (const row of rows) {
		const data = asRecord(row.payload)
		const kind = askJournalKind(row, data)
		if (kind !== "ask.responded" && kind !== "ask.cancelled") continue
		const eventId = optionalStringField(data, "eventId")
		if (eventId === undefined || optionalStringField(data, "sessionId") !== sessionId) continue
		const group = terminals.get(eventId)
		if (group === undefined) terminals.set(eventId, [row])
		else group.push(row)
	}

	for (const [eventId, group] of terminals) {
		// By seq: last row is the canonical terminal (A11 max-seq rule).
		const ordered = [...group].sort((a, b) => a.seq - b.seq)
		const canonical = ordered[ordered.length - 1]!
		const noticeOf = (row: BridgeReplayRow): AskOutcomeNotice | undefined => {
			const data = asRecord(row.payload)
			return deriveAskOutcomeNotice({
				eventId,
				sessionId,
				anchorSeq: row.seq,
				settleReason: optionalStringField(data, "settleReason"),
				journalKind: askJournalKind(row, data),
				askKind: optionalStringField(data, "askKind"),
				outcome: optionalStringField(data, "outcome"),
				source: optionalStringField(data, "source"),
				cancelReason: optionalStringField(data, "reason"),
				childSessionId: optionalStringField(data, "childSessionId"),
			})
		}
		const canonicalNotice = noticeOf(canonical)
		if (canonicalNotice === undefined) continue
		const canonicalChild = optionalStringField(asRecord(canonical.payload), "childSessionId")
		out.push({
			id: canonicalNotice.id,
			text: canonicalNotice.text,
			anchorSeq: canonicalNotice.anchorSeq,
			sessionId,
			...(canonicalChild !== undefined ? { childSessionId: canonicalChild } : {}),
		})

		// A11 conflict guard: a second DISTINCT real terminal reason must stay
		// distinguishable instead of collapsing into one silent merged line.
		const seenText = new Set([canonicalNotice.text])
		for (const row of ordered) {
			if (row === canonical) continue
			const other = noticeOf(row)
			if (other === undefined || seenText.has(other.text)) continue
			seenText.add(other.text)
			const childSessionId = optionalStringField(asRecord(row.payload), "childSessionId")
			out.push({
				id: `${other.id}:seq-${row.seq}`,
				text: `【日志结局冲突】${other.text}`,
				anchorSeq: other.anchorSeq,
				sessionId,
				...(childSessionId !== undefined ? { childSessionId } : {}),
			})
		}
	}

	// 2. Strong-kill orphans: a `requested` row with no terminal here, joined to
	//    the same turnId's `turn/end` (never a client-invented terminal reason).
	const terminalIds = new Set(terminals.keys())
	const turnEnds = new Map<string, BridgeReplayRow>()
	for (const row of rows) {
		if (row.type !== "turn/end") continue
		const data = asRecord(row.payload)
		const keys = [optionalStringField(data, "turnId")]
		if (typeof data.turn === "number" && Number.isFinite(data.turn)) keys.push(String(data.turn))
		for (const key of keys) {
			if (key === undefined) continue
			const prior = turnEnds.get(key)
			if (prior === undefined || row.seq > prior.seq) turnEnds.set(key, row)
		}
	}
	for (const row of rows) {
		const data = asRecord(row.payload)
		if (askJournalKind(row, data) !== "ask.requested") continue
		const eventId = optionalStringField(data, "eventId")
		if (eventId === undefined || terminalIds.has(eventId)) continue
		if (optionalStringField(data, "sessionId") !== sessionId) continue
		const turnKey = optionalStringField(data, "turnId") ?? askTurnId(eventId)
		if (turnKey === undefined || turnKey === "") continue
		const turnEnd = turnEnds.get(turnKey)
		if (turnEnd === undefined) continue
		const notice = deriveAskOutcomeNotice({
			eventId,
			sessionId,
			anchorSeq: turnEnd.seq,
			orphan: true,
			askKind: optionalStringField(data, "askKind"),
			childSessionId: optionalStringField(data, "childSessionId"),
		})
		if (notice !== undefined) {
			const childSessionId = optionalStringField(data, "childSessionId")
			out.push({
				id: notice.id,
				text: notice.text,
				anchorSeq: notice.anchorSeq,
				sessionId,
				...(childSessionId !== undefined ? { childSessionId } : {}),
			})
		}
	}

	return out
}

/** Project one shared notice view to the wire event seam-rows consumes.
 *  `role:'notice'` makes seam-rows upsert it under `notice:<id>` (=
 *  `notice:ask-outcome:<eventId>`); no `stored:` key and no cross-path dedup. */
function askOutcomeEvent(view: AskOutcomeNoticeView): SeamSessionEvent {
	return {
		type: "message.updated",
		details: {
			id: view.id,
			role: "notice",
			text: view.text,
			sessionID: view.sessionId,
			...(view.childSessionId !== undefined ? { childSessionId: view.childSessionId } : {}),
		},
	}
}

export function bridgeReplayRowsToSeamEvents(
	rows: readonly BridgeReplayRow[],
	sessionId: string,
): SeamSessionEvent[] {
	const events: SeamSessionEvent[] = []
	const seen = new Set<string>()
	const push = (event: SeamSessionEvent): void => {
		const key = seamReplayEventKey(event)
		if (seen.has(key)) return
		seen.add(key)
		events.push(event)
	}
	// Ask-outcome notices are derived from the raw journal, NOT from
	// projectJournalRecord (that stays unchanged). Flush each notice right
	// after the row carrying its anchorSeq so this path keeps the same anchor
	// ordering as hydrate/stored instead of appending all notices at the end.
	// seamReplayEventKey dedups repeated ids here; hydrate uses a view key.
	const noticeViews = [...deriveAskOutcomeNoticeViews(rows, sessionId)].sort(
		(a, b) => a.anchorSeq - b.anchorSeq,
	)
	let nextNotice = 0
	const flushNoticesThrough = (seq: number): void => {
		while (nextNotice < noticeViews.length && noticeViews[nextNotice]!.anchorSeq <= seq) {
			push(askOutcomeEvent(noticeViews[nextNotice]!))
			nextNotice++
		}
	}
	const toolCalls = new Map<string, { seq: number; name: string; args: string }>()
	for (const row of rows) {
		const entry: RemoteJournalEntry = { type: row.type, seq: row.seq, time: 0, data: asRecord(row.payload) }
		for (const event of projectJournalRecord(entry, sessionId)) push(event)
		const data = entry.data
		if (row.type === "tool/call") {
			const callId = data.callId === undefined ? "" : String(data.callId)
			if (callId) {
				toolCalls.set(callId, {
					seq: row.seq,
					name: typeof data.name === "string" ? data.name : "tool",
					args: typeof data.arguments === "string" ? data.arguments : "",
				})
			}
		} else if (row.type === "tool/result") {
			const message = asRecord(data.message)
			const callId = data.callId !== undefined
				? String(data.callId)
				: message.toolCallId !== undefined ? String(message.toolCallId) : ""
			const call = callId ? toolCalls.get(callId) : undefined
			if (call !== undefined) {
				toolCalls.delete(callId)
				const messageID = `journal-${call.seq}`
				const ok = data.isError !== true && message.isError !== true
				push({
					type: "message.part.updated",
					details: {
						messageID,
						sessionID: sessionId,
						part: {
							type: "tool",
							id: callId,
							name: call.name,
							input: call.args,
							status: ok ? "done" : "failed",
							output: JSON.stringify(data.output ?? data).slice(0, 300),
						},
					},
				})
			}
		}
		flushNoticesThrough(row.seq)
	}
	// Defensive: a notice anchored past the last row still has to land.
	flushNoticesThrough(Number.POSITIVE_INFINITY)
	return events
}

// ---------------------------------------------------------------------------
// Subagent lifecycle projection (row 33 on the inproc path)
// ---------------------------------------------------------------------------
//
// The remote seam's subagent panel (RemoteSubagentPanel) is fed by TWO sources:
// durable parent-journal records `tool-workflow/agent-start|agent-end` (paired
// by runId:seq) and a session/list sweep. The inproc bridge has no subagent RPC,
// but its `journal.replay` reads the SAME host journal, so the durable records
// are available; its live `session/event` firehose carries the same events,
// which the bridge forwards as additive `agent.spawn`/`agent.settle` frames.
// Both paths fold through this ONE function so the view FIELD SET matches the
// remote adapter's `#projectSubagentViews` (session-seam-adapter.ts:708). 0.23.0
// T2 closes the P3-3 value debt for `rounds`/`lastLine`/`model`: the seam lazily
// reads each child's journal via `journal.replay` (see #ensureChildJournal) and
// writes the real values into the roster. `elapsedSec`/`endedAt` are frozen at
// the FIRST settle via a per-run snapshot (#freezeSettles) — a later replay
// re-fold that revives+re-settles the child restores that snapshot instead of
// recomputing with the current wall clock (session-seam-adapter.ts:715-721
// settle-freeze parity).

/** The host's durable agent lifecycle record types (dsh-tool-workflow/types.ts:47-57). */
const BRIDGE_AGENT_START = "tool-workflow/agent-start"
const BRIDGE_AGENT_END = "tool-workflow/agent-end"
/** Plain `subagent` calls (the common delegation path) record `subagent/catalog`
 *  on the parent instead of the tool-workflow agent records above. Same childId
 *  + label. A live `agent.settle` from the child's own turn/end settles the row
 *  immediately; the parent journal's `user/message` source.kind "subagent-settled"
 *  notice (P1-2) remains the durable fallback for a missed live frame, and the
 *  live settle is made sticky against catalog-only re-folds (P1-1). */
const BRIDGE_SUBAGENT_CATALOG = "subagent/catalog"
/** source.kind on a `user/message` row that carries an async child's terminal. */
const BRIDGE_SUBAGENT_SETTLED = "subagent-settled"
/** The catalog family's synthetic runId namespace (also the P3-1 collision guard). */
const BRIDGE_CATALOG_RUN_PREFIX = "catalog:"

/** External rows without a settle frame become unknown fifteen minutes after
 * live discovery (or durable `createdAt` on replay). */
export const EXTERNAL_UNKNOWN_MS = 15 * 60 * 1000
const EXTERNAL_SETTLED_CAP = 20

function bridgeAgentRunKey(runId: string, seq: number): string {
	return `${runId}:${seq}`
}

/**
 * outcome → settled status. `failed`/`cancelled` pass through; `aborted` (the
 * journal `subagent-settled.stopReason` / child `turn/end.reason.kind` for a
 * user interrupt) maps to the dedicated interrupted display state — folding
 * it into `completed` was the 0.23.0 P1-3 display bug. Everything else stays
 * the conservative "completed" (never paint a false failure for an unknown
 * reason).
 *
 * `"interrupted"` is part of the `SeamSubagentView.status` union in tui-base
 * (L3), so the aborted outcome is returned directly — no narrow assertion.
 */
function bridgeSettledStatus(outcome: unknown): SeamSubagentView["status"] {
	if (outcome === "failed" || outcome === "cancelled") return outcome
	if (outcome === "aborted") return "interrupted"
	return "completed"
}

/** Frozen ACP/agy terminal mapping. Unlike local children, an unrecognised or
 * missing external stop reason is explicitly unknown, never completed. */
export function bridgeExternalSettledStatus(stopReason: unknown): SeamSubagentView["status"] {
	if (stopReason === "completed") return "completed"
	if (stopReason === "aborted") return "interrupted"
	if (stopReason === "error" || stopReason === "max-tokens" || stopReason === "refusal") return "failed"
	return "unknown"
}

/** Freeze a running child into the settled projection: drop `startedAt`, carry
 *  `elapsedSec` + `endedAt` (the exact shape of session-seam-adapter.ts:715-721).
 *
 *  DROPPING `startedAt` IS LOAD-BEARING (P1-3a): the lazy child-journal cache key
 *  is `id@<startedAt>` (bridgeChildJournalKey / #ensureChildJournal), so a settle
 *  flips it to `id@""`. The caller's #syncSubagentMeta then sees an
 *  UNLOADED key and re-reads the FULL child journal, folding the terminal
 *  rounds/lastLine/model that a running child's first (short) read could not
 *  yet contain. This is the支柱 for ctrl+g terminal accuracy after a completed
 *  child settles — do NOT preserve `startedAt` here or the settled view freezes
 *  the stale pre-settle meta. */
function bridgeSettleChild(
	existing: SeamSubagentView,
	outcome: unknown,
	startedAt: number,
	now: number,
): SeamSubagentView {
	return {
		id: existing.id,
		label: existing.label,
		...(existing.name !== undefined ? { name: existing.name } : {}),
		...(existing.model !== undefined ? { model: existing.model } : {}),
		status: bridgeSettledStatus(outcome),
		rounds: existing.rounds,
		elapsedSec: Number(((now - startedAt) / 1000).toFixed(1)),
		endedAt: now,
		...(existing.injectedRound !== undefined ? { injectedRound: existing.injectedRound } : {}),
		...(existing.hardStopRound !== undefined ? { hardStopRound: existing.hardStopRound } : {}),
		...(existing.spinStopRound !== undefined ? { spinStopRound: existing.spinStopRound } : {}),
		...(existing.lastLine !== undefined ? { lastLine: existing.lastLine } : {}),
	}
}

/**
 * Fold ONE agent lifecycle record (durable journal row OR live frame payload)
 * into the canonical `SeamSubagentView` map. TWO families share this map:
 *   - tool-workflow: agent-start / agent-end paired by runId:seq (the exact
 *     remote pairing, remote-subagents.ts:152/235-249); NO revive after settle;
 *   - catalog: subagent/catalog (spawn) + user/message subagent-settled
 *     (terminal) joined by childId directly — no runId pairing, and REVIVE IS
 *     allowed (journal order is unambiguous: a catalog of a settled child is a
 *     new run of it).
 * `liveStarts` remembers which children got a REAL wall-clock start from a live
 * frame so a later replay sweep never overwrites it with an approximate one.
 *
 * Returns true when the map changed (caller decides whether to re-emit).
 */
function bridgeFoldAgentRecord(
	children: Map<string, SeamSubagentView>,
	runSeq: Map<string, string>,
	liveStarts: Set<string>,
	type: string,
	data: Record<string, unknown>,
	now: number,
	live: boolean,
): boolean {
	// F5: both families carry the host's optional child reservation `name`
	// (raw catalog rows directly; agent.spawn frames forwarded by the bridge).
	// Empty/missing stays absent so the renderer can fall back to label alone.
	const name = typeof data.name === "string" && data.name !== "" ? data.name : undefined
	// P1-2 (catalog-family terminal): the host journals an async child's settle
	// as a `user/message` notice, NOT an agent-end. Real evidence — ad45fecb
	// seq37 source = {kind:"subagent-settled", stopReason:"completed",
	// senderSessionId:"caf48fb3-..."}, byte-identical to the seq21 subagent/catalog
	// childId. Pair by childId directly; no runId:seq needed.
	// KNOWN RESIDUE: an ABORTED parent turn NEVER journals this notice (sample
	// 2d692fc9: catalog seq24, turn/end aborted seq32, no settle row) — that ghost
	// cannot converge through this branch and gets NO wall-clock fallback
	// (ADR-0010). Do not add one: a timed force-settle would be a client-invented
	// fact about a host that is still running.
	if (type === "user/message") {
		const source = asRecord(data.source)
		if (source.kind !== BRIDGE_SUBAGENT_SETTLED) return false
		const childId = typeof source.senderSessionId === "string" ? source.senderSessionId : ""
		if (!childId) return false
		const existing = children.get(childId)
		if (!existing || existing.status !== "running") return false
		children.set(childId, bridgeSettleChild(existing, source.stopReason, existing.startedAt ?? now, now))
		return true
	}

	// Plain `subagent` calls emit `subagent/catalog` (childId + label/name) on the
	// parent, never tool-workflow/agent-* (those belong to the `workflow` tool).
	if (type === BRIDGE_SUBAGENT_CATALOG) {
		// External catalog rows belong to the standalone external map. Folding
		// them here would duplicate #subagentViews and schedule child journal
		// reads for ids that have no local child session.
		if (data.mode === "external") return false
		const childId = typeof data.childId === "string" ? data.childId : ""
		if (!childId) return false
		const label = typeof data.label === "string" && data.label
			? data.label
			: (typeof data.name === "string" ? data.name : "")
		const childCreatedAt = typeof data.childCreatedAt === "number" && Number.isFinite(data.childCreatedAt)
			? data.childCreatedAt
			: undefined
		const existing = children.get(childId)
		// CATALOG-FAMILY REVIVE: a settle followed by another catalog of the same
		// childId is a new run of that child (journal order is unambiguous), so the
		// row goes back to running. Deliberately the OPPOSITE of the tool-workflow
		// family's no-revive guard below — revive permission is PER ROW FAMILY.
		if (existing !== undefined && existing.status !== "running") {
			runSeq.set(bridgeAgentRunKey(`${BRIDGE_CATALOG_RUN_PREFIX}${childId}`, 0), childId)
			const revivedName = name ?? existing.name
			children.set(childId, {
				id: existing.id,
				label: label || existing.label,
				...(revivedName !== undefined ? { name: revivedName } : {}),
				status: "running",
				rounds: 0,
				startedAt: childCreatedAt ?? now,
				...(existing.model !== undefined ? { model: existing.model } : {}),
			})
			if (live) liveStarts.add(childId)
			return true
		}
		return bridgeFoldAgentRecord(children, runSeq, liveStarts, BRIDGE_AGENT_START, {
			childId, label, runId: `${BRIDGE_CATALOG_RUN_PREFIX}${childId}`, seq: 0,
			...(name !== undefined ? { name } : {}),
			...(childCreatedAt !== undefined ? { childCreatedAt } : {}),
			viaCatalog: true,
		}, now, live)
	}
	if (type === BRIDGE_AGENT_START) {
		const childId = typeof data.childId === "string" ? data.childId : ""
		if (!childId) return false
		const runId = data.runId === undefined ? "" : String(data.runId)
		// P3-1: the "catalog:" prefix belongs to the catalog family's synthetic
		// pairing key. A real tool-workflow agent-start carrying it would collide
		// with a catalog child's runSeq key (two families, one map) — reject it.
		// The catalog branch marks its own synthesized start with viaCatalog and
		// never reaches this guard.
		if (data.viaCatalog !== true && runId.startsWith(BRIDGE_CATALOG_RUN_PREFIX)) return false
		const seq = typeof data.seq === "number" ? data.seq : -1
		runSeq.set(bridgeAgentRunKey(runId, seq), childId)
		// P3-2: catalog rows carry the host's real child-creation clock (epoch ms).
		// Use it instead of `now` so a recovered child shows its true duration; a
		// catalog row is the exception to the "replay rows carry no clock" rule.
		const childCreatedAt = typeof data.childCreatedAt === "number" && Number.isFinite(data.childCreatedAt)
			? data.childCreatedAt
			: undefined
		const existing = children.get(childId)
		if (existing !== undefined) {
			// P3-5: a later spawn may refine the label (remote #registerChild parity).
			const newLabel = typeof data.label === "string" ? data.label : ""
			const labelChanged = newLabel !== "" && newLabel !== existing.label
			// F5: a later spawn may also fill/refine the child reservation name.
			const nameChanged = name !== undefined && name !== existing.name
			// A live spawn arriving after a replay approximation upgrades the start
			// clock to a real wall clock; a replay sweep never downgrades it.
			// P3-1: only a RUNNING row may take that upgrade — a spawn arriving after
			// settle must not revive the row or overwrite its frozen start clock.
			const upgradeStart = live && existing.status === "running" && !liveStarts.has(childId)
			if (!labelChanged && !nameChanged && !upgradeStart) return false
			children.set(childId, {
				...existing,
				...(labelChanged ? { label: newLabel } : {}),
				...(nameChanged ? { name } : {}),
				...(upgradeStart ? { startedAt: childCreatedAt ?? now } : {}),
			})
			if (upgradeStart) liveStarts.add(childId)
			return true
		}
		const label = typeof data.label === "string" && data.label ? data.label : `subagent ${childId.slice(0, 8)}`
		children.set(childId, {
			id: childId, label, status: "running", rounds: 0, startedAt: childCreatedAt ?? now,
			...(name !== undefined ? { name } : {}),
		})
		if (live) liveStarts.add(childId)
		return true
	}
	if (type === BRIDGE_AGENT_END) {
		const runId = data.runId === undefined ? "" : String(data.runId)
		const seq = typeof data.seq === "number" ? data.seq : -1
		const key = bridgeAgentRunKey(runId, seq)
		const childId = runSeq.get(key)
		if (!childId) return false
		const existing = children.get(childId)
		if (!existing || existing.status !== "running") return false
		children.set(childId, bridgeSettleChild(existing, data.outcome, existing.startedAt ?? now, now))
		runSeq.delete(key)
		return true
	}
	return false
}

/**
 * Pure replay projection: drained journal rows → `SeamSubagentView[]`.
 * tool-workflow spawn→running→settle folds by runId:seq; a child with
 * agent-start but no agent-end stays `running` (the remote panel's "start
 * without terminal = running" rule, remote-subagents.ts:460-473). The catalog
 * family folds by childId and settles on a `user/message` subagent-settled
 * notice. Replayed tool-workflow rows carry no wall clock, so `now` is the
 * discovery anchor (duration from first observation) — EXCEPT a catalog row,
 * which carries the host's real `childCreatedAt` epoch ms and anchors to that
 * instead, so a recovered child shows its true duration (P3-2).
 */
export function bridgeReplayRowsToSubagentViews(
	rows: readonly BridgeReplayRow[],
	now: number = Date.now(),
): SeamSubagentView[] {
	const children = new Map<string, SeamSubagentView>()
	const runSeq = new Map<string, string>()
	const liveStarts = new Set<string>()
	for (const row of rows) {
		bridgeFoldAgentRecord(children, runSeq, liveStarts, row.type, asRecord(row.payload), now, false)
	}
	return [...children.values()]
}

// ---------------------------------------------------------------------------
// 0.23.0 T1/T2 — registry sweep + child-journal meta (subagent visibility)
// ---------------------------------------------------------------------------

/**
 * The decision half of remote-subagents.ts:277-304 `refreshFromList()`, plus
 * the ADR-0010 guard "only settle a child we STILL believe running". Pure and
 * exported for unit tests. A row is considered ONLY when it is an explicit
 * `origin:"subagent"` row of THIS parent whose host `running` flag is exactly
 * `false`. Malformed rows are skipped — never flattened into an empty registry
 * (the caller handles a failed/malformed list read separately, keeping the
 * roster unchanged).
 */
export function bridgeSweepSettledChildIds(
	rows: readonly unknown[],
	parentId: string | undefined,
	locallyRunning: ReadonlySet<string>,
): string[] {
	if (parentId === undefined || parentId === "") return []
	const settled: string[] = []
	for (const raw of rows) {
		const row = asRecord(raw)
		if (row.origin !== "subagent") continue
		if (row.parentSessionId !== parentId) continue
		const id = row.sessionId
		if (typeof id !== "string" || id === "") continue
		if (row.running !== false) continue
		if (!locallyRunning.has(id) || settled.includes(id)) continue
		settled.push(id)
	}
	return settled
}

/** ctrl+g meta folded from ONE child session's `journal.replay` rows. */
export interface BridgeChildJournalMeta {
	rounds: number
	lastLine?: string
	model?: string
}

/** `blocksText` parity (remote-follow.ts:219) — text blocks joined by newline. */
function bridgeBlocksText(content: unknown): string {
	if (typeof content === "string") return content.trim()
	if (!Array.isArray(content)) return ""
	let text = ""
	for (const block of content) {
		const typed = block as { type?: unknown; text?: unknown } | null
		if (typed?.type === "text" && typeof typed.text === "string") {
			text += (text === "" ? "" : "\n") + typed.text
		}
	}
	return text.trim()
}

/** `lastContentLine` parity (remote-subagents.ts:717): last non-blank line. */
function bridgeLastContentLine(text: string | undefined): string | undefined {
	if (text === undefined) return undefined
	const lines = text.replace(/\r\n?/g, "\n").split("\n")
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]!.trim()
		if (line !== "") return line.replace(/\s+/gu, " ").slice(0, 240)
	}
	return undefined
}

/**
 * Parse one child journal's rows into the real ctrl+g values, mirroring the
 * remote seam's fold (remote-subagents.ts:589-628):
 *  - `rounds` = `assistant/message` ROW COUNT (one-shot children never turn/end);
 *  - `lastLine` = tail of the LAST assistant/message body OR a non-error
 *    `tool/result` body (P2-3b — remote parity, see the branch below);
 *  - `model` = `request/context.data.model`, falling back to
 *    `subagent/descriptor.data.agentModel` (KNOWN FORK vs remote — see below).
 * Unknown rows are ignored. This is display catch-up ONLY — no wall-clock
 * inference, and a caller that cannot read the journal keeps its degraded view
 * rather than calling this with an empty array.
 */
export function bridgeChildJournalMeta(rows: readonly BridgeReplayRow[]): BridgeChildJournalMeta {
	let rounds = 0
	let lastLine: string | undefined
	let contextModel: string | undefined
	let descriptorModel: string | undefined
	for (const row of rows) {
		const data = asRecord(row.payload)
		if (row.type === "assistant/message") {
			rounds += 1
			const message = asRecord(data.message)
			const tail = bridgeLastContentLine(bridgeBlocksText(message.content ?? data.content))
			if (tail !== undefined) lastLine = tail
		} else if (row.type === "tool/result") {
			// P2-3b: remote surfaces a NON-error tool-result's content tail as
			// lastLine (remote-subagents.ts:639-664) — a child that "prints" via
			// bash echoes / search hits exposes its real progress only here.
			// Error results keep the previous good tail (a failure string would
			// mask the last real progress line); the ⎿ failed log still carries it.
			if (data.isError !== true) {
				const message = asRecord(data.message)
				const tail = bridgeLastContentLine(bridgeBlocksText(message.content ?? data.content))
				if (tail !== undefined) lastLine = tail
			}
		} else if (row.type === "request/context") {
			if (contextModel === undefined && typeof data.model === "string" && data.model !== "") {
				contextModel = data.model
			}
		} else if (row.type === "subagent/descriptor") {
			if (descriptorModel === undefined && typeof data.agentModel === "string" && data.agentModel !== "") {
				descriptorModel = data.agentModel
			}
		}
	}
	// KNOWN FORK (P2-3c): the remote seam resolves a child's model from the
	// descriptor's `agentProvider`/`agentModel` JOIN plus a LATER `request/header`
	// override (remote-subagents.ts:589-600,735-748). The inproc child journal
	// carries no `request/header` for children; it carries `request/context`, so we
	// prefer that over the bare `descriptor.agentModel` instead. The two seams are
	// intentionally NOT aligned here — aligning would mean reading a row type the
	// bridge never journals. Documented rather than "fixed" to avoid a fabricated
	// provider/model string.
	const model = contextModel ?? descriptorModel
	return {
		rounds,
		...(lastLine !== undefined ? { lastLine } : {}),
		...(model !== undefined ? { model } : {}),
	}
}

/**
 * 025-w1b D — one child's durable journal rows → the viewer's transcript lines.
 * Reuses the SAME `bridgeReplayRowsToSeamTranscript` projection the session
 * transcript uses (single source of truth for call/result pairing, ask merge and
 * subagent-origin rules); only the final string rendering is viewer-specific.
 * No live/pushed text is fabricated — lines come from real replay rows.
 */
export function bridgeReplayRowsToChildLog(rows: readonly BridgeReplayRow[]): string[] {
	// No session id is passed, so the projection derives zero ask-outcome
	// notices here. Filter explicitly too: a child log is a raw log view, not a
	// notice consumer (A26 — zero `ask-outcome:` / `notice:ask-outcome:` lines).
	return bridgeReplayRowsToSeamTranscript(rows).filter((row) => row.kind !== "notice").map((row) => {
		if (row.kind === "tool") {
			return row.output ? `▶ ${row.text}\n⎿ ${row.output}` : `▶ ${row.text}`
		}
		if (row.kind === "ask") return "[ask]"
		return row.text
	}).filter((line) => line !== "")
}

// ---- LIVE TRANSCRIPT — additive `agent.transcript` row projection + cap ----

/** 500 rows / 64 KiB (UTF-8) per child transcript. Both limits are hard. */
export const CHILD_TRANSCRIPT_MAX_LINES = 500
export const CHILD_TRANSCRIPT_MAX_BYTES = 64 * 1024

const childTextEncoder = new TextEncoder()
// fatal:true makes decode throw on a partial trailing glyph, so the cut can be
// walked back to a clean UTF-8 boundary instead of emitting a replacement char.
const childStrictTextDecoder = new TextDecoder("utf-8", { fatal: true })

function childTranscriptBytes(line: string): number {
	return childTextEncoder.encode(line).length
}

/** A single line may use the whole byte budget minus the +1 separator counted by capChildLog. */
const CHILD_TRANSCRIPT_LINE_BUDGET = CHILD_TRANSCRIPT_MAX_BYTES - 1
/** Visible marker so a truncated line is distinguishable from a naturally short one. */
const CHILD_TRANSCRIPT_TRUNCATION_MARKER = "…"
const CHILD_TRANSCRIPT_TRUNCATION_MARKER_BYTES = childTextEncoder.encode(CHILD_TRANSCRIPT_TRUNCATION_MARKER).length

/**
 * Truncate an over-budget single line on a UTF-8 boundary, keeping a marker.
 * A line that fits is returned verbatim; otherwise cut to LINE_BUDGET minus the
 * marker, decode strictly (no split multibyte glyph), append the marker. This
 * keeps the line instead of letting capChildLog's head-drop discard it whole.
 */
function childTranscriptTruncate(line: string): string {
	const bytes = childTextEncoder.encode(line)
	if (bytes.length <= CHILD_TRANSCRIPT_LINE_BUDGET) return line
	const cutBudget = CHILD_TRANSCRIPT_LINE_BUDGET - CHILD_TRANSCRIPT_TRUNCATION_MARKER_BYTES
	for (let end = cutBudget; end > 0; end -= 1) {
		try {
			return childStrictTextDecoder.decode(bytes.slice(0, end)) + CHILD_TRANSCRIPT_TRUNCATION_MARKER
		} catch {
			// partial multibyte glyph at the cut — try one byte earlier
		}
	}
	return CHILD_TRANSCRIPT_TRUNCATION_MARKER
}

/**
 * Cap the per-child log: drop the OLDEST rows until both the row count and the
 * byte budget fit, and truncate any single row that alone exceeds the budget.
 * Pure and shared by the journal-baseline and live-append paths.
 */
export function capChildLog(lines: readonly string[]): string[] {
	const out = lines.map((line) => childTranscriptTruncate(line))
	let bytes = out.reduce((total, line) => total + childTranscriptBytes(line) + 1, 0)
	while (out.length > CHILD_TRANSCRIPT_MAX_LINES || (out.length > 0 && bytes > CHILD_TRANSCRIPT_MAX_BYTES)) {
		const dropped = out.shift()!
		bytes -= childTranscriptBytes(dropped) + 1
	}
	return out
}

/**
 * One whitelisted wire row → one viewer line. Only finalized assistant/tool
 * kinds survive; `notice` / token / delta rows are filtered (notice filtering:
 * the child log is a raw log view, never a notice consumer). Tool rendering
 * mirrors `bridgeReplayRowsToChildLog` (▶ call / ⎿ result).
 */
export function childTranscriptRowToLine(row: unknown): string {
	const r = asRecord(row)
	if (r.kind !== "assistant" && r.kind !== "tool") return ""
	const text = typeof r.text === "string" ? r.text : ""
	const output = typeof r.output === "string" ? r.output : ""
	if (r.kind === "tool") return output !== "" ? `▶ ${text}\n⎿ ${output}` : `▶ ${text}`
	return text
}

/**
 * Round5 — the viewer renders every transcript element as a height=1 single-line
 * `<text>` node, so a folded `▶ ${text}\n⎿ ${output}` string loses its second
 * line. Split every embedded newline into a SEPARATE array element before the
 * log is written to #subagentTranscripts. Applied at BOTH entry points (journal
 * baseline + live append). Empty segments are dropped, matching the existing
 * `line !== ""` filtering already done by both paths (journal projection and
 * live loop) so empty-line handling stays consistent across the two entries.
 */
export function splitChildLogLines(lines: readonly string[]): string[] {
	const out: string[] = []
	for (const line of lines) {
		for (const part of line.split("\n")) {
			if (part !== "") out.push(part)
		}
	}
	return out
}

/** L2b C3: first confirm poll delay, the doubling ceiling, and the total cap
 *  (45s, inside the plan's 30–60s band). A child that is still host-running at
 *  the cap is NOT force-settled — the marker is dropped so the turn-boundary
 *  `#sweepSubagents` fallback can converge it from a later registry snapshot. */
const CONFIRM_POLL_INITIAL_MS = 250
const CONFIRM_POLL_MAX_MS = 1000
const CONFIRM_TIMEOUT_MS = 45_000

/**
 * L2b C3: read a child's REAL stop reason from its journal. Priority:
 *   ① `user/message source.kind=subagent-settled` → `source.stopReason`;
 *   ② the child session's `turn/end` → `data.reason.kind`;
 *   ③ neither → `undefined` (the caller degrades to `"aborted"`).
 * Scans newest-first so the latest terminal wins when a child ran multiple
 * turns. Pure/testable — the confirm coroutine is the only production caller.
 */
export function bridgeChildStopReason(rows: readonly BridgeReplayRow[]): string | undefined {
	for (let i = rows.length - 1; i >= 0; i -= 1) {
		const row = rows[i]
		if (row.type !== "user/message") continue
		const source = asRecord(asRecord(row.payload).source)
		if (source.kind !== BRIDGE_SUBAGENT_SETTLED) continue
		const reason = source.stopReason
		if (typeof reason === "string" && reason !== "") return reason
	}
	for (let i = rows.length - 1; i >= 0; i -= 1) {
		const row = rows[i]
		if (row.type !== "turn/end") continue
		const reason = asRecord(asRecord(row.payload).reason)
		const kind = reason.kind
		if (typeof kind === "string" && kind !== "") return kind
	}
	return undefined
}

/** Lazy-read / settle-snapshot cache key — a catalog revive (new startedAt) starts a new run. */
function bridgeChildJournalKey(view: SeamSubagentView): string {
	return `${view.id}@${view.startedAt ?? ""}`
}

/**
 * 0.23.0 P1: the frozen facts of a child's FIRST settle, keyed by the RUN key
 * (`id@<startedAt>` before settle). Remote parity: settle freezes the duration
 * (session-seam-adapter.ts:715-721) — a later durable replay re-fold revives a
 * catalog child and re-settles it with the CURRENT wall clock; restoring these
 * facts instead keeps elapsedSec/endedAt/status stable for the whole session.
 */
export interface BridgeSettleSnapshot {
	status: SeamSubagentView["status"]
	elapsedSec: number
	endedAt: number
}

/** Rebuild the settled shape from a frozen snapshot: `startedAt` is dropped
 *  (settle parity), status/elapsedSec/endedAt come from the snapshot, all other
 *  display/meta fields are carried through from the freshly-folded view. */
function bridgeRestoreSettled(view: SeamSubagentView, snap: BridgeSettleSnapshot): SeamSubagentView {
	const { startedAt: _startedAt, ...rest } = view
	return { ...rest, status: snap.status, elapsedSec: snap.elapsedSec, endedAt: snap.endedAt }
}

/**
 * A7: does the drained journal carry a TERMINAL for the turn that was in
 * flight when the bridge died? The host journal records `turn/end` with
 * `data.reason.kind` (completed / aborted / error / interrupted / blocked /
 * forked / max-tokens); a crash mid-turn leaves `turn/start` with NO following
 * `turn/end`. turnId is a bridge-side UUID and is NOT in the journal, so the
 * association is by order: the terminal closing the in-flight turn is any
 * `turn/end` (or a defensive `turn/error`) at a seq ABOVE the last
 * `turn/start`, or — when that start was applied before this drain window —
 * any such row in the drained window.
 *
 * Read-only: this never writes to the journal (blocky 2.4: journal is the
 * single source of truth; the client only infers a LOCAL marker).
 */
export function journalHasTurnTerminal(rows: readonly BridgeReplayRow[]): boolean {
	let lastStart = -Infinity
	let hasStart = false
	for (const row of rows) {
		if (row.type === "turn/start") {
			lastStart = row.seq
			hasStart = true
		}
	}
	return rows.some((row) =>
		(row.type === "turn/end" || row.type === "turn/error") && (!hasStart || row.seq > lastStart),
	)
}

/**
 * The journal row that TERMINATES the in-flight turn — the highest-seq
 * `turn/end` / `turn/error` above the last `turn/start` (any terminal when the
 * start fell outside this drain window). Same association rule as
 * `journalHasTurnTerminal`; `undefined` when the journal stays silent about it.
 * Read-only: the row's `payload` is the host's real terminal shape (`reason`,
 * `usage`, …) and is never rewritten by the client.
 */
export function lastJournalTurnTerminal(
	rows: readonly BridgeReplayRow[],
	startOutsideWindow = false,
): BridgeReplayRow | undefined {
	// P2-1: when the in-flight turn's `turn/start` was applied BEFORE this drain
	// window, a `turn/start` that DOES appear in the window belongs to a LATER
	// (possibly other-writer) turn. The old "highest terminal above the LAST
	// start" rule then attributed that later turn's terminal to ours. Two
	// guards, in the spirit of the recommendation:
	//   - rows carrying a turn id: a terminal whose id matches a start present
	//     in this window is that later turn's — never ours (id association);
	//   - otherwise: only a terminal BEFORE the next (first) turn/start can be
	//     ours, because our start precedes the whole window (order association).
	if (startOutsideWindow) {
		let nextStart = Infinity
		const startIds = new Set<unknown>()
		for (const row of rows) {
			if (row.type === "turn/start") {
				nextStart = Math.min(nextStart, row.seq)
				const id = journalTurnId(row)
				if (id !== undefined) startIds.add(id)
			}
		}
		let latest: BridgeReplayRow | undefined
		for (const row of rows) {
			if (row.type !== "turn/end" && row.type !== "turn/error") continue
			if (row.seq >= nextStart) continue
			const id = journalTurnId(row)
			if (id !== undefined && startIds.has(id)) continue
			if (latest === undefined || row.seq > latest.seq) latest = row
		}
		return latest
	}
	let lastStart = -Infinity
	let hasStart = false
	for (const row of rows) {
		if (row.type === "turn/start") {
			lastStart = row.seq
			hasStart = true
		}
	}
	let latest: BridgeReplayRow | undefined
	for (const row of rows) {
		if ((row.type === "turn/end" || row.type === "turn/error") && (!hasStart || row.seq > lastStart)) {
			if (latest === undefined || row.seq > latest.seq) latest = row
		}
	}
	return latest
}

/** The journal's per-turn identifier (`data.turn` on host rows, defensively a
 *  string `turnId` too). The bridge's UUID turnId is NOT in the journal — this
 *  is the host's numeric turn number and is only used for same-window turn
 *  association (P2-1). */
function journalTurnId(row: BridgeReplayRow): number | string | undefined {
	const payload = asRecord(row.payload)
	if (typeof payload.turn === "number" && Number.isFinite(payload.turn)) return payload.turn
	if (typeof payload.turnId === "string" && payload.turnId !== "") return payload.turnId
	return undefined
}

/**
 * Bridge turn events → the seam-event shapes seam-rows.ts consumes.
 *
 * Explicitly NOT projected (ticket §2 seq 4 / ADR-0010 event list):
 *   - `turn.token` / `turn.tool`: delivered live through the turn() callbacks;
 *     re-emitting them as events would double-paint the transcript rows.
 *   - `permission.asked` / host-initiated `session.updated` / `bridge.shutdown`:
 *     the bridge emits none of these (emitEvent has only the 5 turn.* types).
 * The onSessionEvent registration logs this once as a sync-member degrade.
 */
export function projectBridgeEvent(frame: BridgeEventFrame, sessionId: string): SeamSessionEvent[] {
	const payload = asRecord(frame.payload)
	const turnId = typeof payload.turnId === "string" ? payload.turnId : ""
	if (frame.type === "turn.start") {
		return [{ type: "session.updated", details: { sessionID: sessionId, turnId, turn: "starting" } }]
	}
	if (frame.type === "turn.end") {
		return [{ type: "session.updated", details: { sessionID: sessionId, turnId, turn: "idle" } }]
	}
	if (frame.type === "turn.error") {
		return [{
			type: "session.error",
			details: {
				sessionID: sessionId,
				turnId,
				code: typeof payload.code === "string" ? payload.code : "INTERNAL",
				message: typeof payload.message === "string" ? payload.message : "turn failed",
			},
		}]
	}
	return []
}

/** Accumulated `turn.end.usage` (host `{prompt,completion,cacheRead,cacheWrite}`). */
interface UsageAccumulator {
	turns: number
	prompt: number
	completion: number
	cacheRead: number
	cacheWrite: number
}

/**
 * Parse ONE usage object into the accumulator's canonical fields.
 *
 * The bridge host's `turn.end` frame carries the LAST `assistant/message`
 * row's `data.usage` (bridge/src/index.ts:1006,1066), whose wire fields are
 * `{inputTokens, outputTokens, totalTokens, cacheReadTokens?, cacheWriteTokens?}`
 * — NOT `{prompt, completion, cacheRead, cacheWrite}`. The remote seam maps
 * exactly these aliases (`scanUsageChunk`, remote-follow.ts:199-212); the old
 * bridge-only numeric names are kept first so legacy callers/fixtures still
 * work. A field is set only when at least one alias is present; multiple
 * aliases take the max (the remote scanner's rule). This mismatch is the
 * root cause of the inproc /session "cache read/write 0/0" panel: the journal
 * row DOES carry `cacheReadTokens`, but the seam never read that field.
 */
function parseUsage(value: unknown): Partial<UsageAccumulator> {
	const u = asRecord(value)
	const num = (...aliases: string[]): number | undefined => {
		let present = false
		let best = 0
		for (const alias of aliases) {
			const v = u[alias]
			if (typeof v === "number" && Number.isFinite(v)) {
				present = true
				best = Math.max(best, v)
			}
		}
		return present ? best : undefined
	}
	const out: Partial<UsageAccumulator> = {}
	const prompt = num("prompt", "promptTokens", "inputTokens", "prompt_tokens")
	if (prompt !== undefined) out.prompt = prompt
	const completion = num("completion", "completionTokens", "outputTokens", "completion_tokens")
	if (completion !== undefined) out.completion = completion
	const cacheRead = num("cacheRead", "cacheReadTokens", "cache_read_tokens")
	if (cacheRead !== undefined) out.cacheRead = cacheRead
	const cacheWrite = num("cacheWrite", "cacheWriteTokens", "cache_write_tokens")
	if (cacheWrite !== undefined) out.cacheWrite = cacheWrite
	return out
}

/**
 * One durable `assistant/message.data.usage` row → the same canonical fields
 * plus the host's authoritative `totalTokens` (billed input + output; on
 * cache-splitting adapters input = prompt + cacheRead + cacheWrite). This is
 * the 🧠 numerator's source: remote's `ContextTokenMeter` billed base
 * (`#billedInput + #billedOutput`, token-estimate.ts:65-71) is exactly
 * `input + cacheRead + cacheWrite + output` = `totalTokens`.
 */
function journalUsage(payload: unknown): (Partial<UsageAccumulator> & { total: number }) | undefined {
	const usage = asRecord(asRecord(payload).usage)
	const parsed = parseUsage(usage)
	if (Object.keys(parsed).length === 0) return undefined
	const billed = (parsed.prompt ?? 0) + (parsed.cacheRead ?? 0) + (parsed.cacheWrite ?? 0)
	const rawTotal = usage.totalTokens
	const total = typeof rawTotal === "number" && Number.isFinite(rawTotal) && rawTotal > 0
		? rawTotal
		: billed + (parsed.completion ?? 0)
	return { ...parsed, total }
}

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

// ---------------------------------------------------------------------------
// BridgeSessionSeam
// ---------------------------------------------------------------------------

/** Normalize a `bridge.dead` frame payload into the structured cause. Unknown
 *  senders still get a usable cause (fail open), never a crash. */
function asDeadCause(value: unknown): BridgeDeadCause {
	const r = asRecord(value)
	const stage = r.stage
	const stages: readonly string[] = ["spawn", "handshake", "runtime", "closed"]
	return {
		stage: typeof stage === "string" && stages.includes(stage) ? (stage as BridgeDeadStage) : "runtime",
		code: typeof r.code === "number" ? r.code : null,
		signal: typeof r.signal === "string" ? r.signal : null,
		message: typeof r.message === "string" ? r.message : "bridge connection lost",
		// A3: keep the recovery classification attached to the SeamSessionEvent
		// too, so the view can tell a permanent mismatch from a retryable drop.
		...(r.recoverability === "permanent" || r.recoverability === "retriable"
			? { recoverability: r.recoverability }
			: {}),
		...(Array.isArray(r.mismatches) && r.mismatches.every((m) => typeof m === "string")
			? { mismatches: r.mismatches as string[] }
			: {}),
	}
}

/** One locally-pending ask. `done` always settles — on answer, cancel, host
 *  settled broadcast, reconnect snapshot replacement or dispose — so no
 *  consumer ever waits on a dangling promise (ADR-0011 §3.3 / invariant A2). */
interface PendingAskEntry {
	request: BridgeAskRequestPayload
	turnId: string
	cancelled: boolean
	readonly done: Promise<void>
	readonly finish: () => void
}

export class BridgeSessionSeam implements SessionSeam {
	readonly #transport: BridgeTransport
	readonly #ctx: BridgeSeamContext
	// S5 — real local faces (the old `{}` / honest-failure degrades are gone).
	readonly #dshHome: string
	readonly #profile: string
	readonly #configStore: LocalConfigStore
	readonly #settingsStore: LocalSettingsStore
	readonly #localAgents: LocalAgentsFace
	readonly #localPresets: LocalPresetFace
	readonly #localLogin: LocalLoginFace

	// 025-w2-2 — real plugin-manager bundle cache (fills ASYNC via the generic
	// arm) + honest availability. `undefined` = not probed yet, never a
	// `present === true` environment assertion.
	#pluginBundlesCache: SeamPluginBundleRow[] = []
	#pluginsManagerAvailable: boolean | undefined = undefined

	// 025-w2-5 — honest goals-service availability observation. `undefined` =
	// not probed yet; true/false set by a real goals wire call. NEVER a test
	// `present === true` premise (W5 prevention rule 2).
	#goalsAvailable: boolean | undefined = undefined

	// B1 S4 — the source of the LAST settings.describe. Not a long-term
	// environment assertion: every describe re-probes the host; this only lets
	// mutate decide "host vs local-file" without a second round-trip. Starts at
	// local-file so a mutate before any describe refuses instead of assuming a host.
	#settingsSource: SeamSettingsSource = "local-file"
	#settingsSourceDetail: SeamSettingsDocument["sourceDetail"] | undefined = undefined

	/**
	 * B1 S4 — host-first settings describe. One shared resolver for the panel
	 * and /agents caps (design §4.2(c): a single wire read, not two). Host wire
	 * success → authoritative `source:"host"` document; any failure → local
	 * patch file FOR RENDERING ONLY with `source:"local-file"` + a sanitized
	 * reason (host rows will be read-only and show n/a — never local numbers).
	 */
	async #describeSettings(): Promise<SeamSettingsDocument> {
		try {
			const reply = await this.#transport.request("settings.describe")
			const document = projectHostSettingsDocument(reply)
			this.#settingsSource = "host"
			this.#settingsSourceDetail = undefined
			return document
		} catch (error) {
			const reason = settingsFailureReason(error)
			this.#settingsSource = "local-file"
			this.#settingsSourceDetail = { profile: this.#profile, reason }
			const local = this.#settingsStore.describe()
			return { ...local, source: "local-file", sourceDetail: this.#settingsSourceDetail }
		}
	}

	/** B1 S4 /settings host face — host-first route with local-file degrade.
	 *  Field-level whitelist lives in `projectHostSettingsDocument`; the local
	 *  fallback is rendering-only (host rows read-only, numbers shown as n/a). */
	settings: NonNullable<SessionSeam["settings"]> = {
		describe: (): Promise<SeamSettingsDocument> => this.#describeSettings(),
		mutate: (ns: string, ops: SeamSettingsOp[], revision?: number): Promise<SeamSettingsMutateResult> => {
			if (this.#settingsSource !== "host") {
				// Honest refusal: in local-file mode we never write the local patch
				// to fake a host success (design §4.2(b)); no new capability-error wording.
				return Promise.resolve({
					ok: false,
					conflict: false,
					error: `host settings unavailable (local-file mode); the write was not applied${this.#settingsSourceDetail?.reason ? `: ${this.#settingsSourceDetail.reason}` : ""}`,
				})
			}
			return this.#transport
				.request("settings.mutate", { ns, ops, expectedRevision: revision })
				.then(projectHostMutateResult, hostMutateError)
		},
		identity: () => ({ profile: this.#profile, dshHome: this.#dshHome }),
		/** P0-3: read-only fact for /login's pre-write profile consistency check. */
		profileConsistency: () => this.profileConsistency,
		// 025-w2-4 — real permissionPresets/catalog face. The old top-level
		// permissionCatalog() (ADR-0011 one-shot notice) stays intact; this is a
		// SEPARATE honest read: a service-absent / malformed reply -> undefined
		// (the settings row falls back to the schema enum), never a fake catalog.
		permissionCatalog: () => this.#readPermissionCatalog(),
	}

	/**
	 * 026 web-mirror — current-session permission preset mirror. `catalog`
	 * reuses the already-wired permissionPresets/catalog read; `switch` sends the
	 * host's registered `/permission <preset>` command over the generic
	 * `commands.execute` wire (agent scope; agentId = current session id string,
	 * resolved to a live agent at the host arm). Service absence / no session
	 * rejects honestly — never a fabricated success (W5 E1/E4/E5).
	 */
	permission: NonNullable<SessionSeam["permission"]> = {
		catalog: () => this.#readPermissionCatalog(),
		switch: (preset) => this.#permissionSwitch(preset),
	}

	/**
	 * 025-w2-4 — real provider directory (llm/listProviders + llm/listConfigurableProviders)
	 * over the generic arm. Each face rides the generated wire name and applies
	 * the hand-written SECOND whitelist projection. Service absence rejects with
	 * UNSUPPORTED (never a fake-empty directory); the /login picker catches and
	 * degrades to the static catalog with an honest notice.
	 */
	providerDirectory: NonNullable<SessionSeam["providerDirectory"]> = {
		registered: (): Promise<SeamLlmProviderRow[]> =>
			this.#directoryRequest("llm.listProviders", projectLlmProviders),
		configurable: (): Promise<SeamConfigurableProviderRow[]> =>
			this.#directoryRequest("llm.listConfigurableProviders", projectConfigurableProviders),
		// 025-w3-2 — the one PROJECTED_BY_HAND id. The bridge hand-wired branch
		// applies a fixed wire whitelist; this SECOND projection repeats it.
		// Service absence / no discovery source REJECTS — never a fake-empty list.
		discover: (settingsNs: string, request: SeamModelDiscoveryRequest): Promise<SeamDiscoveredModel[]> =>
			this.#directoryRequest("llm.discoverModels", projectDiscoverModels, { settingsNs, request }),
	}

	/**
	 * 025-w2-5 — goals status face over the generic arm. Every call goes through
	 * the hand-written SECOND whitelist projection (schema-open/null blind spot —
	 * AMEND-2 C-1). `agentId` is the goals scope wire: the wire carries the id
	 * STRING from `currentSessionId()`; the generic arm resolves it in place at
	 * the host-call boundary via CAP_SCOPE_TABLE (data-driven scope substitution,
	 * d94161a, table-driven — AMEND-5 erratum; NOT caller-side live injection).
	 * no active session -> UNSUPPORTED reject (honest, no fabricated agentId). Service
	 * absence rejects UNSUPPORTED (never fake-empty); business/validation errors
	 * keep their own code and do NOT poison availability (W2-3 C-2 classification).
	 */
	goals: NonNullable<SessionSeam["goals"]> = {
		status: (): Promise<SeamGoalView | undefined> =>
			this.#goalsRequest("goals.get", {}, projectGoalView),
		available: (): boolean => this.#goalsAvailable === true,
		create: (objective, maxGoalRounds): Promise<SeamGoalRef | undefined> => {
			const request: Record<string, unknown> = { objective }
			if (maxGoalRounds !== undefined) request.maxGoalRounds = maxGoalRounds
			return this.#goalsRequest("goals.create", { request }, projectCreateGoalResult)
		},
		edit: (ref, patch): Promise<SeamGoalView | undefined> =>
			this.#goalsRequest("goals.edit", { ref, request: patch }, projectGoalView),
		complete: (ref): Promise<SeamGoalView | undefined> =>
			this.#goalsRequest("goals.complete", { ref }, projectGoalView),
		pause: (ref): Promise<SeamGoalView | undefined> =>
			this.#goalsRequest("goals.pause", { ref }, projectGoalView),
		resume: (ref): Promise<SeamGoalView | undefined> =>
			this.#goalsRequest("goals.resume", { ref }, projectGoalView),
		clear: (ref): Promise<SeamGoalRef | undefined> =>
			this.#goalsRequest("goals.clear", { ref }, projectGoalRef),
	}

	/**
	 * 027 — plugin-registered host slash commands for the slash palette
	 * (commands/list + commands/execute over the generic arm). Rides a
	 * dedicated RemoteSessionOps instance (see #hostCommandsOps). State:
	 * per-agentId cache (15s TTL from request initiation) + coalesced in-flight;
	 * every binding change / bridge death bumps the epoch and drops the cache;
	 * a settle whose agent moved on discards its rows. Service-absent class
	 * flips `available=false` (adapter-level observation — the ops layer's
	 * commandsList catch swallows the raw error); BAD_PARAMS and other business
	 * codes keep their own error and never poison availability.
	 * NOTE: the 026 /permission mirror (#permissionSwitch) stays on its own
	 * commands/execute call path — deliberate non-migration, see file header.
	 */
	hostCommands: NonNullable<SessionSeam["hostCommands"]> = {
		list: (): Promise<SeamHostCommandRow[]> => this.#hostCommandsList(),
		execute: (line: string): Promise<{ text?: string } | undefined> => this.#hostCommandsExecute(line),
		available: (): boolean => this.#hostCommandsAvailable === true,
		refresh: (): void => this.#hostCommandsRefresh(),
	}

	/** S5 /agents face — real `agents/*.md` corpus + model catalog, no mocks
	 *  (oldfox S4 review §六.4). */
	agents: NonNullable<SessionSeam["agents"]> = {
		list: () => this.#localAgents.list(),
		dir: () => this.#localAgents.dir(),
		set: (name, field, value) => this.#localAgents.set(name, field, value),
		body: (name) => this.#localAgents.body(name),
		modelEfforts: (providerID, modelID) => this.#localAgents.modelEfforts(providerID, modelID),
		// B1 S5 — caps come from the SAME host settings document as /settings.
		// Never from LocalSettingsStore: local-file mode yields n/a + reason.
		officialCaps: async (): Promise<SeamAgentOfficialCaps> => officialCapsFromDocument(await this.#describeSettings()),
	}

	/**
	 * 025-w1a — /preset agent-preset face. Real local roster declared in the
	 * profile patch (no host registry RPC in the inproc profile); staged id
	 * persisted as a scalar `agentPreset` config preference (next-session effect).
	 */
	preset: NonNullable<SessionSeam["preset"]> = {
		list: () => Promise.resolve(this.#localPresets.list()),
		currentId: () => Promise.resolve(this.#localPresets.currentId()),
		select: (presetId) => Promise.resolve(this.#localPresets.select(presetId)),
	}

	/**
	 * 025-w1a — /login //logout provider face (coordinator ruling: local real
	 * implementation, NOT account/PKCE and NOT a dead credentials CapIR frame).
	 * Routes from the profile patch's llm-pi-ai.providers dict; credentialStatus
	 * is boolean-only (env ref or owner-only local key store); login/logout are
	 * local file I/O. No secret value ever crosses a frame/log/proof.
	 */
	login: NonNullable<SessionSeam["login"]> = {
		credentialStatus: (ref) => Promise.resolve(this.#localLogin.credentialStatus(ref)),
		login: (ref, apiKey) => { this.#assertProfileConsistency(); this.#localLogin.login(ref, apiKey); return Promise.resolve() },
		logout: (ref) => { this.#assertProfileConsistency(); this.#localLogin.logout(ref); return Promise.resolve() },
		routes: () => Promise.resolve(this.#localLogin.routes()),
		registerRoute: async (providerId, profile) => {
			this.#assertProfileConsistency()
			return this.#localLogin.registerRoute(providerId, profile)
		},
	}

	/**
	 * 025-w1b E — ACCOUNT login-state face, a SEPARATE domain from `login`
	 * above. Rides the S4-wired `account.*` plaintext frames (already served by
	 * the bridge); the bridge's `projectAccountViewForFrame` whitelist guarantees
	 * the authorize URL VALUE never reaches this seam — only four bounded fields
	 * do. This face re-projects defensively to those same four fields, so a
	 * future/unexpected frame shape can never smuggle a URL/token into the TUI.
	 * NO credential value is stored/logged/echoed here.
	 */
	account: NonNullable<SessionSeam["account"]> = {
		getState: async () => projectSeamAccountView(await this.#transport.request("account.getState")),
		startSignIn: async (callbackOrigin, loginSource) => projectSeamAccountView(await this.#transport.request(
			"account.startSignIn", { client: accountClientMeta(), callbackOrigin, loginSource },
		)),
		cancelSignIn: async (attemptId) => projectSeamAccountView(await this.#transport.request(
			"account.cancelSignIn", { attemptId },
		)),
		signOut: async () => projectSeamAccountView(await this.#transport.request(
			"account.signOut", { client: accountClientMeta() },
		)),
		hasRunningAccountTasks: async () => {
			const value = asRecord(await this.#transport.request("account.hasRunningAccountTasks"))
			return value.running === true
		},
	}

	/**
	 * 025-w1a — /plugins phase-1 local install manifest (coordinator ruling 3).
	 * Scan `<dshHome>/profiles/<profile>/node_modules` for the REAL installed
	 * packages (top-level + one `@scope` level), excluding `@deepseek-ai/*`
	 * built-ins and the `@aiwayds` bridge self-package. This is the actual
	 * install manifest, NOT the cordis.patch.yml preset/plugin declaration rows
	 * (those are patch inserts, not installs). The full plugin-manager (enable /
	 * disable / install / remove, state column) is a CapIR gap for 波2 — phase 1
	 * honestly lists name/version only; it never fabricates an enabled state.
	 */
	plugins(): { name: string; version: string }[] {
		const root = join(this.#dshHome, "profiles", this.#profile, "node_modules")
		if (!existsSync(root)) return []
		const out: { name: string; version: string }[] = []
		const seen = new Set<string>()
		const readPkg = (dir: string, fallbackName: string): void => {
			try {
				const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>
				const name = typeof pkg.name === "string" && pkg.name ? pkg.name : fallbackName
				const version = typeof pkg.version === "string" ? pkg.version : ""
				if (name.startsWith("@deepseek-ai/") || name.startsWith("@aiwayds/")) return
				if (seen.has(name)) return
				seen.add(name)
				out.push({ name, version })
			} catch {
				// skip malformed package.json — a broken row never crashes the list
			}
		}
		let entries: string[] = []
		try { entries = readdirSync(root) } catch { return [] }
		for (const entry of entries) {
			if (entry.startsWith(".")) continue
			if (entry.startsWith("@")) {
				let scoped: string[] = []
				try { scoped = readdirSync(join(root, entry)) } catch { continue }
				for (const sub of scoped) {
					if (sub.startsWith(".")) continue
					readPkg(join(root, entry, sub), `${entry}/${sub}`)
				}
			} else {
				readPkg(join(root, entry), entry)
			}
		}
		return out
	}

	/**
	 * 025-w2-4 — generic directory read: transport request on the generated wire
	 * name + hand-written SECOND whitelist projection. A transport rejection
	 * (UNSUPPORTED = service absent / HAND_PROJECTION_REQUIRED) PROPAGATES — the
	 * caller (login picker) catches and degrades honestly. No fake empty value,
	 * no host object crosses (the projector whitelists every field).
	 */
	async #directoryRequest<T>(method: string, project: (raw: unknown) => T, params?: Record<string, unknown>): Promise<T> {
		const reply = params === undefined
			? await this.#transport.request(method)
			: await this.#transport.request(method, params)
		return project(reply)
	}

	/**
	 * 025-w2-4 — real permissionPresets/catalog read for the /settings row.
	 * Service-absent / malformed -> undefined (honest fallback to the schema
	 * enum), never a fabricated preset. The top-level ADR-0011 one-shot-notice
	 * permissionCatalog() is untouched — this is the settings face's real data.
	 */
	async #readPermissionCatalog(): Promise<SeamPermissionCatalog | undefined> {
		try {
			const reply = await this.#transport.request("permissionPresets.catalog")
			return projectPermissionCatalog(reply)
		} catch {
			return undefined
		}
	}

	/**
	 * 026 web-mirror — switch the CURRENT session's permission preset via the
	 * host's registered `/permission <preset>` command (the web UI's real write
	 * path). Sends `commands.execute {agentId, line, submittedAttachments:[]}`:
	 * agentId is the bound session id STRING (the generic arm resolves it to a
	 * live agent at the host boundary — W2-0 scope lookup, W2 预防条款 5). line
	 * carries the leading `/` that `dsh-commands` parseCommand requires. The
	 * reply passes through the hand-written SECOND whitelist (E5).
	 */
	async #permissionSwitch(preset: string): Promise<SeamPermissionSwitchResult> {
		// R4 bug fix: a session may be staged but not bound yet (after /resume
		// before the next turn). Fall back to the staged resume id so the host
		// command targets that session instead of failing "no active session".
		// currentSessionId() still wins when a session is bound.
		const agentId = this.currentSessionId() ?? this.stagedSessionId()
		if (agentId === undefined || agentId === "") {
			throw new BridgeProtocolError("UNSUPPORTED", "permission.switch: no active session (agentId unavailable)")
		}
		const line = `/permission ${preset}`
		const reply = await this.#transport.request("commands.execute", {
			agentId,
			line,
			submittedAttachments: [],
		})
		return projectPermissionSwitch(reply)
	}

	/**
	 * 025-w2-5 — generic goals request. Sends the goals scope wire `agentId` as
	 * a STRING from the bound session; the arm resolves it in place at the host
	 * boundary via CAP_SCOPE_TABLE (data-driven scope substitution, d94161a,
	 * table-driven — AMEND-5 erratum). with no active session it rejects
	 * UNSUPPORTED honestly — never a fabricated id.
	 * Hand-written SECOND whitelist projection on every reply (AMEND-2 blind spot).
	 * Service-absent class flips `available=false`; business/validation errors
	 * keep their own code and do NOT poison availability (W2-3 C-2 classification).
	 */
	async #goalsRequest<T>(
		method: string,
		extraParams: Record<string, unknown>,
		project: (raw: unknown) => T,
	): Promise<T> {
		const agentId = this.currentSessionId()
		if (agentId === undefined || agentId === "") {
			throw new BridgeProtocolError("UNSUPPORTED", `${method}: no active session (agentId unavailable)`)
		}
		try {
			const reply = await this.#transport.request(method, { agentId, ...extraParams })
			this.#goalsAvailable = true
			return project(reply)
		} catch (err) {
			const code = err instanceof BridgeProtocolError ? err.code : undefined
			const message = err instanceof Error ? err.message : String(err)
			const serviceAbsent =
				code === "UNSUPPORTED" || code === "NOT_WIRED" || code === "UNAVAILABLE" ||
				(code === undefined && (/^NOT_WIRED/.test(message) || /unavailable/i.test(message)))
			if (serviceAbsent) {
				this.#goalsAvailable = false
				throw new BridgeProtocolError("UNSUPPORTED", `${method}: ${message}`)
			}
			throw err
		}
	}

	// ---- 027 — hostCommands helpers (plugin-registered slash commands) -----

	/**
	 * slash wire name → generic-arm dot name. The bridge generic arm indexes
	 * by EXACT dot-name (CAP_GENERIC_WIRE_METHODS, no slash-name normalization),
	 * so the adapter must translate. Failure semantics match the implementation:
	 * a list-path reject is swallowed by ops.commandsList's catch into a silent
	 * empty-array degradation; only service-absent errors flip `available`,
	 * because the rpc adapter below is the ONLY level where the raw wire error
	 * is observable before ops swallows it.
	 */
	static readonly #HOST_COMMANDS_WIRE: Readonly<Record<string, string>> = {
		"commands/list": "commands.list",
		"commands/execute": "commands.execute",
	}

	/** 027 — service-absent classification, mirrored from #goalsRequest: ONLY
	 *  the UNSUPPORTED / NOT_WIRED / UNAVAILABLE family (or a code-less
	 *  NOT_WIRED/unavailable message) means "the commands service is not on
	 *  this host". BAD_PARAMS and business codes keep their own error. */
	#hostCommandsServiceAbsent(err: unknown): boolean {
		const code = err instanceof BridgeProtocolError ? err.code : undefined
		const message = err instanceof Error ? err.message : String(err)
		return (
			code === "UNSUPPORTED" ||
			code === "NOT_WIRED" ||
			code === "UNAVAILABLE" ||
			(code === undefined && (/^NOT_WIRED/.test(message) || /unavailable/i.test(message)))
		)
	}

	/**
	 * 027 — the DEDICATED RemoteSessionOps for this face (lazy; zero consumers
	 * before this face existed). The rpc adapter does the three seam-only jobs:
	 * (1) slash→dot translation via the explicit table above; (2) service-absent
	 * classification at the ADAPTER level — remote-session-ops commandsList
	 * catches→[] so the raw wire error is ONLY observable here; (3) a
	 * never-factory socket (this face rides the two unary commands ids only;
	 * any stream attempt is a programming error and must fail loud).
	 */
	#hostCommandsOps(): RemoteSessionOps {
		if (this.#hostCommandsOpsRef === undefined) {
			this.#hostCommandsOpsRef = new RemoteSessionOps({
				rpc: (method: string, args?: Record<string, unknown>): Promise<unknown> => {
					const dotted = BridgeSessionSeam.#HOST_COMMANDS_WIRE[method]
					if (dotted === undefined) {
						return Promise.reject(new Error(`hostCommands: unexpected wire method ${method}`))
					}
					// Availability is observed HERE, at the wire-round outcome — the
					// only level where the raw error is visible (ops.commandsList
					// swallows into []). A settled round flips true, a service-absent
					// round flips false; the face's own settle must NOT re-arm the
					// flag, or the swallowed [] would immediately undo the flip and
					// the palette's unavailable status line could never paint.
					return this.#transport.request(dotted, args ?? {}).then(
						(value: unknown) => {
							this.#hostCommandsAvailable = true
							return value
						},
						(err: unknown) => {
							if (this.#hostCommandsServiceAbsent(err)) {
								this.#hostCommandsAvailable = false
								this.#degradeOnce("hostCommands.service", `commands service absent: ${err instanceof Error ? err.message : String(err)}`)
							}
							throw err
						},
					)
				},
				socketFactory: (): never => {
					throw new Error("hostCommands: stream sockets unsupported (unary-only face)")
				},
			})
		}
		return this.#hostCommandsOpsRef
	}

	/**
	 * 027 — cached list(). Per-agentId key; TTL runs from REQUEST INITIATION
	 * (not settle) via the confirm clock. In-flight coalesces per agentId; a
	 * settle whose agent moved on (binding changed under the request) discards
	 * its rows — never cached, never painted.
	 */
	async #hostCommandsList(): Promise<SeamHostCommandRow[]> {
		let agentId = this.currentSessionId() ?? this.stagedSessionId()
		if (agentId === undefined || agentId === "") {
			// Lazy-session client: the bridge mints the session only in turn() /
			// DEAD recovery, but commands.list is agentId-addressed — without a
			// binding the palette would stay empty on a fresh client that never
			// sent a message. Ensure one on this non-turn UI path (see
			// #ensureSession for the rationale); a failed open keeps the
			// established degrade semantics ([] + once-log, never a throw).
			try {
				agentId = await this.#ensureSession()
			} catch (err) {
				this.#degradeOnce(
					"hostCommands.list",
					`ensure session failed: ${err instanceof Error ? err.message : String(err)}`,
				)
				return []
			}
			if (agentId === undefined || agentId === "") return []
		}
		const now = this.#confirmClock.now()
		const cached = this.#hostCommandsCache.get(agentId)
		if (cached && now - cached.fetchedAt < HOST_COMMANDS_TTL_MS) return cached.rows
		const inFlight = this.#hostCommandsInFlight.get(agentId)
		if (inFlight) return inFlight
		const startedAt = now
		const request: Promise<SeamHostCommandRow[]> = this.#hostCommandsOps()
			.commandsList(agentId)
			.then((rows) => {
				// settle-time guard: the binding moved under the request — the rows
				// belong to a session nobody is on anymore; discard, don't cache.
				// (Availability is NOT re-armed here: ops.commandsList swallows a
				// service-absent wire error into this same [], so the settle cannot
				// tell "empty catalog" from "no service" — the adapter owns the flag.)
				const current = this.currentSessionId() ?? this.stagedSessionId()
				if (current !== agentId) return []
				this.#hostCommandsCache.set(agentId, { rows, fetchedAt: startedAt })
				return rows
			})
			.finally(() => {
				if (this.#hostCommandsInFlight.get(agentId) === request) this.#hostCommandsInFlight.delete(agentId)
			})
		this.#hostCommandsInFlight.set(agentId, request)
		return request
	}

	/**
	 * 027 — execute one host command line. The ops layer has NO catch (its
	 * commandsExecute propagates), so this face owns the degrade: any failure
	 * resolves `undefined` (the caller paints the failure copy) + once-log.
	 * A settled round passes through: `{text}` when the host echoed text, `{}`
	 * (success, no text) otherwise.
	 */
	async #hostCommandsExecute(line: string): Promise<{ text?: string } | undefined> {
		let agentId = this.currentSessionId() ?? this.stagedSessionId()
		if (agentId === undefined || agentId === "") {
			// Same ensure as #hostCommandsList (see there): execute is
			// agentId-addressed too, so a palette pick on a fresh client opens
			// the session first; a failed open degrades to `undefined` exactly
			// like a failed wire round.
			try {
				agentId = await this.#ensureSession()
			} catch (err) {
				this.#degradeOnce(
					"hostCommands.execute",
					`ensure session failed: ${err instanceof Error ? err.message : String(err)}`,
				)
				return undefined
			}
			if (agentId === undefined || agentId === "") {
				this.#degradeOnce("hostCommands.execute", "execute without an active session")
				return undefined
			}
		}
		try {
			const result = await this.#hostCommandsOps().commandsExecute(agentId, line)
			return result?.text ? { text: result.text } : {}
		} catch (err) {
			this.#degradeOnce("hostCommands.execute", `execute failed: ${err instanceof Error ? err.message : String(err)}`)
			return undefined
		}
	}

	/**
	 * 027 — debounced refresh (palette open transition). Synchronously drops
	 * the cache so the caller's next list() goes back to the wire, then
	 * schedules ONE eager re-probe per debounce window (open/close flapping
	 * must not hammer the generic arm). No epoch bump: an in-flight request
	 * kicked by the caller is exactly the fetch we want to coalesce with.
	 */
	#hostCommandsRefresh(): void {
		this.#hostCommandsCache.clear()
		if (this.#hostCommandsRefreshTimer !== undefined) return
		this.#hostCommandsRefreshTimer = setTimeout(() => {
			this.#hostCommandsRefreshTimer = undefined
			const agentId = this.currentSessionId() ?? this.stagedSessionId()
			if (agentId !== undefined && agentId !== "") void this.#hostCommandsList()
		}, HOST_COMMANDS_REFRESH_DEBOUNCE_MS)
		this.#hostCommandsRefreshTimer.unref?.()
	}

	/**
	 * 027 — binding change / bridge death: bump the epoch (a settle from the
	 * previous binding observes it and discards) and drop cache + in-flight,
	 * so rows of the previous agent never leak into the next palette.
	 */
	#resetHostCommands(): void {
		this.#hostCommandsEpoch += 1
		this.#hostCommandsCache.clear()
		this.#hostCommandsInFlight.clear()
	}

	/**
	 * 025-w2-2 — real plugin-manager READ face over the generic arm. Every call
	 * goes through the hand-written second whitelist projection (no host object
	 * crosses). A service-absent / NOT_WIRED reply rejects UNSUPPORTED and marks
	 * availability false — never a fake empty value. The boolean is an honest
	 * observation of THIS process, never a test `present === true` premise.
	 *
	 * W2-2 C-2 — error classification is faithful: ONLY a service-absent class
	 * (wire UNSUPPORTED — the bridge's mapping of NOT_WIRED / unavailable — or a
	 * raw NOT_WIRED/unavailable rejection) flips `available=false`. A host business
	 * error (wire INTERNAL, e.g. plugin-manager/unknown-bundle) or a BAD_PARAMS
	 * validation error keeps its OWN code and leaves availability untouched — a
	 * single failed request is not "the manager is gone", otherwise the panel
	 * falsely degrades (fatal once W2-3 write faces ship, where refusals are
	 * routine). The transport already preserves the frame code on the error
	 * (bridge-transport.ts); this layer must not flatten it again.
	 */
	async #pmRequest<T>(
		method: string,
		params: Record<string, unknown>,
		project: (raw: unknown) => T,
	): Promise<T> {
		try {
			const reply = await this.#transport.request(method, params)
			const projected = project(reply)
			this.#pluginsManagerAvailable = true
			return projected
		} catch (err) {
			const code = err instanceof BridgeProtocolError ? err.code : undefined
			const message = err instanceof Error ? err.message : String(err)
			const serviceAbsent =
				code === "UNSUPPORTED" ||
				code === "NOT_WIRED" ||
				code === "UNAVAILABLE" ||
				(code === undefined && (/^NOT_WIRED/.test(message) || /unavailable/i.test(message)))
			if (serviceAbsent) {
				this.#pluginsManagerAvailable = false
				throw new BridgeProtocolError("UNSUPPORTED", `${method}: ${message}`)
			}
			// Business / validation error: surface the original code + message.
			// Do NOT touch availability — the manager is still wired and available.
			throw err
		}
	}

	/**
	 * 025-w2-3 (R6) — seam-side SECOND gate for every pluginManager WRITE face.
	 * Refuses any call without a structurally-valid confirm token BEFORE any
	 * transport traffic (zero wire calls on rejection), then forwards `__confirm:
	 * true` so the bridge generic-arm first gate admits it. Error classification
	 * stays faithful via #pmRequest (C-2): a business refusal keeps its own code
	 * and does NOT poison availability. On success the bundle cache is refreshed
	 * (review §4 item 6) so a toggle/remove/install is reflected on next paint.
	 */
	/** Generic confirmed-call core: seam gate + `__confirm` marker + faithful
	 *  classification. Shared by #pmWrite and the progress/cancel faces. */
	async #pmConfirmed<T>(
		method: string,
		params: Record<string, unknown>,
		confirm: PluginWriteConfirm | undefined,
		project: (raw: unknown) => T,
	): Promise<T> {
		if (!writeConfirmed(confirm)) throw CONFIRM_REQUIRED(method)
		return this.#pmRequest(method, { ...params, __confirm: true }, project)
	}

	async #pmWrite(
		method: string,
		params: Record<string, unknown>,
		confirm: PluginWriteConfirm | undefined,
		target: string,
	): Promise<SeamPluginChange> {
		const reply = await this.#pmConfirmed(method, params, confirm, projectChange)
		// Normalise an empty/short target from the host to the caller's target so
		// the status line always names what changed.
		if (reply.target === "" && target !== "") reply.target = target
		void this.refreshPluginBundles()
		return reply
	}

	pluginsManager: SeamPluginsManager = {
		listBundles: async () => {
			const rows = await this.#pmRequest("pluginManager.listBundles", {}, projectBundleRows)
			this.#pluginBundlesCache = rows
			return rows
		},
		listPlugins: async () => this.#pmRequest("pluginManager.listPlugins", {}, projectPluginRows),
		readBundleDetail: async (name, language) =>
			this.#pmRequest("pluginManager.readBundleDetail", { name, language }, projectDetail),
		registries: async () => this.#pmRequest("pluginManager.registries", {}, projectRegistries),
		listVersions: async (name) => this.#pmRequest("pluginManager.listVersions", { name }, projectVersions),
		listVersionExemptions: async () =>
			this.#pmRequest("pluginManager.listVersionExemptions", {}, projectVersionExemptions),
		inspect: async (spec) => this.#pmRequest("pluginManager.inspect", { spec }, projectInspection),
		available: () => this.#pluginsManagerAvailable,
	}

	// 025-w2-3 (R6) — hand-written WRITE faces over the generic arm. Each goes
	// through #pmWrite (seam confirm gate + bridge __confirm marker + faithful
	// error classification + post-write refresh). No face fires without a token
	// minted by a confirmed TUI modal.
	setPluginBundleEnabled = (name: string, enabled: boolean, confirm: PluginWriteConfirm): Promise<SeamPluginChange> =>
		this.#pmWrite("pluginManager.setBundleEnabled", { name, enabled }, confirm, name)

	removePluginBundle = (name: string, confirm: PluginWriteConfirm): Promise<SeamPluginChange> =>
		this.#pmWrite("pluginManager.removeBundle", { name }, confirm, name)

	inspectPluginSpec = (spec: string): Promise<SeamPluginInspection> =>
		this.pluginsManager.inspect(spec)

	installPluginSpec = async (spec: string, confirm: PluginWriteConfirm, requestIdArg?: string): Promise<SeamPluginChange> => {
		const requestId = requestIdArg ?? `w23-${randomUUID()}`
		const change = await this.#pmWrite(
			"pluginManager.installBundle",
			{ spec, options: { enabled: true, requestId } },
			confirm,
			spec,
		)
		// Echo the caller-supplied requestId so the progress face can poll it,
		// even though the host's ChangeResult does not carry it back.
		change.requestId = requestId
		return change
	}

	updatePluginBundle = (name: string, version: string, confirm: PluginWriteConfirm): Promise<SeamPluginChange> =>
		this.#pmWrite("pluginManager.updateBundle", { name, version, options: {} }, confirm, name)

	setPluginEnabled = (id: string, enabled: boolean, confirm: PluginWriteConfirm): Promise<SeamPluginChange> =>
		this.#pmWrite("pluginManager.setPluginEnabled", { id, enabled }, confirm, id)

	setVersionExemption = (
		packageVersion: string,
		runtimeVersion: string,
		enabled: boolean,
		acceptRisk: boolean,
		confirm: PluginWriteConfirm,
	): Promise<SeamPluginChange> =>
		this.#pmWrite(
			"pluginManager.setVersionExemption",
			{ packageVersion, runtimeVersion, enabled, acceptRisk },
			confirm,
			`${packageVersion}@${runtimeVersion}`,
		)

	// 025-w2-3c (adjudicated route) — install progress/cancel over the two
	// unary write ids waitForInstall + cancelInstall (NO ADR-0010 frame growth).
	// Both pass the seam confirm gate + __confirm marker; progress is a
	// closed-state projection, never a host object.
	waitForInstall = (requestId: string, confirm: PluginWriteConfirm): Promise<SeamInstallProgress> =>
		this.#pmConfirmed(
			"pluginManager.waitForInstall",
			{ requestId },
			confirm,
			(raw) => projectInstallProgress(raw, requestId),
		)

	cancelInstall = (requestId: string, confirm: PluginWriteConfirm): Promise<SeamInstallCancellation> =>
		this.#pmConfirmed("pluginManager.cancelInstall", { requestId }, confirm, projectCancellation)

	/**
	 * 025-w2-2 — warm/refresh the real bundle cache (the panel calls this on
	 * every open; boot warm alone is racy). On failure the previous cache and
	 * the honest availability=false degrade are preserved.
	 */
	async refreshPluginBundles(): Promise<void> {
		try {
			await this.pluginsManager.listBundles()
		} catch {
			// degrade path: pluginBundles() falls back to the phase-1 local
			// manifest with stateUnknown rows — never a fabricated enabled flag.
		}
	}

	/**
	 * 025-w2-2 — /plugins state rows. When the manager is in fact available,
	 * return the real listBundles projection. Otherwise fall back to the
	 * phase-1 local install manifest, explicitly marked `stateUnknown` so the
	 * panel never paints a fake on/off (honest degrade, plan §5.2).
	 */
	pluginBundles(): SeamPluginBundleRow[] {
		if (this.#pluginsManagerAvailable === true) return [...this.#pluginBundlesCache]
		return this.plugins().map((row) => ({
			name: row.name,
			version: row.version,
			enabled: false,
			installed: true,
			optional: false,
			removable: false,
			stateUnknown: true,
		}))
	}

	/**
	 * 025-w1a — /think reasoning-effort face. The effort ladder is REAL host
	 * catalog data (`reasoning.efforts` on each model group), the SAME raw shape
	 * `LocalAgentsFace.modelEfforts` already consumes — NOT a hardcoded tier set.
	 * `selectEffort` rides `selectModel`'s existing reasoningEffort arm (next-turn
	 * effect); rejections propagate so a host refusal surfaces in the transcript.
	 * An absent frame / empty ladder degrades honestly (empty [] / undefined),
	 * never a fabricated default tier.
	 */
	thinking: NonNullable<SessionSeam["thinking"]> = {
		efforts: () => this.#catalogEfforts(),
		effortsFor: (providerID, modelID) => this.#catalogEfforts(providerID, modelID),
		currentEffort: async () => {
			const sessionId = this.#currentSessionId ?? this.stagedSessionId()
			const cache = sessionId !== undefined && sessionId !== ""
				? await this.#ensureModelRoute(sessionId)
				: undefined
			const live = cache !== undefined ? liveModelRoute(cache) : undefined
			// A live route IS the session's truth: when it carries no effort, the
			// answer is undefined (that model has no reasoning effort), NOT the
			// deployment default's effort for a different route.
			if (live !== undefined) return live.reasoningEffort
			// No session / journal silent: the deployment default still names an effort.
			const fallback = await this.#defaultModelRoute()
			return fallback?.reasoningEffort
		},
		selectEffort: async (effort) => {
			// Mirror selectModel's effort arm: the host's session/selectModel
			// validates sessionId + provider + model (bridge:940-955), so the
			// current route must accompany the new effort. Rejections propagate.
			const selection = await this.currentModelSelection()
			if (selection === undefined) return unsupported("selectEffort")
			const sessionId = this.#currentSessionId ?? this.stagedSessionId()
			const reply = await this.#transport.request("selectModel", {
				provider: selection.providerID,
				model: selection.modelID,
				...(effort === undefined ? {} : { reasoningEffort: effort }),
				...(sessionId !== undefined && sessionId !== "" ? { sessionId } : {}),
			})
			const r = reply as { selected?: unknown } | undefined
			if (r === undefined || r === null || r.selected === undefined) {
				return unsupported("selectEffort")
			}
			// RESTORE: the host-resolved selection is the live route from now on —
			// only for the session captured before the request.
			this.#writeModelRouteReply(reply, sessionId)
		},
	}

	/** Raw modelCatalog groups → SeamEffortOption ladder for one model route.
	 *  No providerID/modelID → the CURRENT route (the default selection group). */
	async #catalogEfforts(providerID?: string, modelID?: string): Promise<SeamEffortOption[]> {
		const raw = await this.#transport.request("modelCatalog") as {
			groups?: {
				id?: unknown
				models?: { id?: unknown; reasoning?: { efforts?: unknown } }[]
			}[]
			default?: { provider?: unknown; model?: unknown }
		} | undefined
		if (raw === undefined || raw === null || !Array.isArray(raw.groups)) return []
		if (providerID === undefined || modelID === undefined) {
			// RESTORE: "the current route" is the session's live route, not the
			// catalog default (which is the deployment default and drifts when
			// /model side-writes it). Old sessions with a silent journal keep the
			// catalog.default fallback below.
			const sessionId = this.#currentSessionId ?? this.stagedSessionId()
			const cache = sessionId !== undefined && sessionId !== ""
				? await this.#ensureModelRoute(sessionId)
				: undefined
			const live = cache !== undefined ? liveModelRoute(cache) : undefined
			if (live !== undefined) {
				providerID = live.providerID
				modelID = live.modelID
			}
		}
		let group = raw.groups.find((g) => typeof g?.id === "string" && g.id === providerID)
		let model = group?.models?.find((m) => typeof m?.id === "string" && m.id === modelID)
		if (providerID === undefined || modelID === undefined) {
			// Cold boot / old session: the catalog default is the honest label.
			const d = raw.default
			group = raw.groups.find((g) => typeof g?.id === "string" && g.id === d?.provider) ?? raw.groups[0]
			model = group?.models?.find((m) => typeof m?.id === "string" && m.id === d?.model) ?? group?.models?.[0]
		}
		const efforts = model?.reasoning?.efforts
		if (!Array.isArray(efforts)) return []
		const out: SeamEffortOption[] = []
		for (const e of efforts) {
			const row = asRecord(e)
			const id = typeof row.id === "string" ? row.id : ""
			const name = typeof row.name === "string" ? row.name : ""
			if (!id) continue
			out.push({
				id,
				name: name || id,
				...(typeof row.description === "string" && row.description !== "" ? { description: row.description } : {}),
			})
		}
		return out
	}

	readonly #unsubEvent: () => void
	readonly #listeners: ((event: SeamSessionEvent) => void)[] = []
	readonly #onDead?: (cause: BridgeDeadCause) => void

	// Subagent lifecycle (row 33 inproc): the canonical child map is the single
	// source of truth for both the live `agent.spawn/settle` frames and the
	// journal-replay derivation. runSeq pairs runId:seq -> child; liveStarts
	// remembers real wall-clock starts so replay sweeps never overwrite them.
	readonly #subagentViews = new Map<string, SeamSubagentView>()
	readonly #subagentRunSeq = new Map<string, string>()
	readonly #subagentLiveStarts = new Set<string>()
	/** ACP/agy rows are deliberately outside the local child map/index. */
	readonly #externalSubagentViews = new Map<string, SeamSubagentView>()
	#externalSessionId: string | undefined
	/** External settle may precede spawn; retain the terminal until its row lands. */
	readonly #externalPendingSettles = new Map<string, Record<string, unknown>>()
	/** Timeout anchor: live discovery time, or durable createdAt during replay. */
	readonly #externalUnknownAt = new Map<string, number>()
	/** External rows already terminalized by an actual settle frame/row. */
	readonly #externalSettledIds = new Set<string>()
	/** External ids whose timeout anchor came from a live observation. Repeated
	 * live spawns must not keep extending the fifteen-minute deadline. */
	readonly #externalLiveIds = new Set<string>()
	#externalUnknownTimer: ReturnType<typeof setTimeout> | undefined
	readonly #subagentListeners = new Set<(views: SeamSubagentView[]) => void>()
	/**
	 * B3 — latest host-driven live progress per running child, from additive
	 * `agent.progress` frames. This is RUNTIME data layered on top of the
	 * spawn-time journal baseline (#subagentJournalMeta): the journal snapshot
	 * stays the initial baseline (one-time guard unchanged), progress frames
	 * carry rounds/lastLine/elapsed forward while the child is running. Keyed by
	 * childId (a new run on revive clears it at settle), never synthesizes a row.
	 */
	readonly #subagentProgress = new Map<string, {
		rounds: number
		lastLine?: string
		elapsedSec?: number
	}>()
	/**
	 * maxRounds ladder — ONE instance per session binding (lazily created on the
	 * first `agent.progress` that grows a child's rounds). Disposed on rebind /
	 * dispose; a settled child is forgotten so a catalog revive of the same id
	 * starts a fresh ladder. Limits are read live from the profile config.json.
	 */
	#roundPolicy: SubagentRoundPolicy | undefined
	/** The session the current subagent map belongs to; reset on binding change. */
	#subagentSessionId: string | undefined
	/**
	 * 0.23.0 T2: every child key whose journal was ATTEMPTED this binding, keyed
	 * by `${childId}@${startedAt}` so a catalog REVIVE (new run, new start clock)
	 * re-reads instead of reusing the previous run's counts. A failed read is
	 * recorded too (but writes nothing to the roster) — never retried on every
	 * render, and the view keeps its existing degraded values.
	 */
	readonly #subagentJournalLoaded = new Set<string>()
	/**
	 * 0.23.0 T2: successful journal meta per RUN KEY (`${childId}@${startedAt}`).
	 * A durable replay re-fold revives a settled child then settles it again,
	 * which resets rounds to 0 and drops lastLine; this cache lets the post-fold
	 * sync restore the real values without re-reading the journal on every turn.
	 */
	readonly #subagentJournalMeta = new Map<string, BridgeChildJournalMeta>()
	/**
	 * 025-w1b D — per-child transcript lines folded from the REAL child journal
	 * read in #ensureChildJournal. The seam face is synchronous (viewer re-reads
	 * it per tick), so the async replay populates this cache and the face returns
	 * a snapshot copy. Keyed by childId (not run key): a re-run overwrites lines.
	 */
	readonly #subagentTranscripts = new Map<string, string[]>()
	/**
	 * LIVE TRANSCRIPT — per-child dedupe/order of `agent.transcript` frames.
	 * The dedupe identity is (childId, runId, turnId, seq). `runId` is the
	 * CHILD run identity, while `turnId` is the parent-turn epoch: the host's
	 * child seq restarts when either identity changes (including an idle parent
	 * turn with turnId=""). A changed runId or turnId opens a fresh seen-set;
	 * a new `agent.spawn` also clears the old run's seen/settle lock. The
	 * journal baseline lines stay.
	 */
	readonly #subagentTranscriptRuns = new Map<string, { runId: string; turnId: string; seen: Set<number> }>()
	/** LIVE TRANSCRIPT — a settled child is journal-authoritative; no live append. */
	readonly #subagentTranscriptSettled = new Set<string>()
	/** LIVE TRANSCRIPT — a child whose journal read was attempted and failed. */
	readonly #subagentTranscriptReadFailed = new Set<string>()
	/**
	 * 0.23.0 T1: run keys settled by the registry SWEEP, keyed by childId → the
	 * run key (`id@<startedAt>`) observed at settle time. A sweep settle has NO
	 * journal settle row, so a later replay that re-folds the catalog row would
	 * revive the ghost back to `running`. The post-fold sync re-asserts the settle
	 * via #subagentSettleSnapshots when the key matches. Keeping the childId → key
	 * mapping also lets a MISMATCH be logged (P2a: missing childCreatedAt makes
	 * live/replay keys diverge). Cleared on binding change/dispose.
	 */
	readonly #sweepSettledRuns = new Map<string, string>()
	/**
	 * 0.23.0 P1: frozen settle facts (status/elapsedSec/endedAt) per RUN KEY,
	 * captured at the FIRST settle and restored on every later re-settle so a
	 * replay's wall clock cannot grow a settled child's elapsedSec. Cleared on
	 * binding change/dispose.
	 */
	readonly #subagentSettleSnapshots = new Map<string, BridgeSettleSnapshot>()
	/**
	 * L2a: children with a user interrupt issued against THIS binding, keyed by
	 * childId → monotonic interrupt generation. Sweep MUST skip a child in this
	 * map (no settle) so the confirm-then-emit path owns its terminal projection;
	 * this is the P1-1 "sweep eats the interrupt result" guard. L2b C3 reads the
	 * generation for its binding-change guard and clears entries after settling.
	 * Cleared on binding change / dispose.
	 */
	readonly #interruptInFlight = new Map<string, number>()
	#interruptGeneration = 0
	/** L2b C3: poll clock for the confirm-then-emit loop (real timer by default). */
	readonly #confirmClock: BridgeConfirmClock

	// ---- 027 hostCommands face state (plugin-registered slash commands) ----
	/** Lazy dedicated ops instance (slash→dot rpc adapter + never socket factory). */
	#hostCommandsOpsRef: RemoteSessionOps | undefined
	/** Per-agentId row cache; TTL measured from request initiation. */
	readonly #hostCommandsCache = new Map<string, { rows: SeamHostCommandRow[]; fetchedAt: number }>()
	/** Per-agentId in-flight coalescing. */
	readonly #hostCommandsInFlight = new Map<string, Promise<SeamHostCommandRow[]>>()
	/** Bumped on every binding change / bridge death (cache-drop epochs). */
	#hostCommandsEpoch = 0
	/** Honest observation of THIS process: only the service-absent error class
	 *  flips it false; a settled success flips it back true. */
	#hostCommandsAvailable = true
	/** Debounced refresh timer (palette open/close flapping guard). */
	#hostCommandsRefreshTimer: ReturnType<typeof setTimeout> | undefined

	// status state machine (no dedicated status frame — ticket §1 #1).
	#connection: SeamStatus["connection"] = "disconnected"
	#turn: SeamStatus["turn"] = "idle"
	/** A2: three-value bridge link health, additive to the connection leg. */
	#bridgeLink: BridgeLinkStatus = "ready"
	#sessionAttached = false
	/** lastSessionId for recovery — this IS the last opened session id; it
	 *  survives a `bridge.dead` frame (only `newSession`/`dispose` clear it). */
	#currentSessionId: string | undefined
	/**
	 * L2a capability negotiation: the additive `capabilities` array from the
	 * `bridge.hello`/`bridge.ping` reply (L1 advertises
	 * `subagents.interrupt` / `subagents.stopChildren`). An OLD bridge omits the
	 * field entirely → empty set = no capability (never probe child-by-child).
	 * Refreshed on every successful handshake so a recovered/newer bridge is
	 * picked up without recreating the seam.
	 */
	readonly #bridgeCapabilities = new Set<string>()
	/** A4: highest journal seq applied to the transcript so far. Did NOT exist
	 *  before this task; recovery needs it to compute `from = lastAppliedSeq+1`. */
	#lastAppliedSeq: number | undefined
	/** The session `#lastAppliedSeq` belongs to; reset on a different binding. */
	#lastAppliedSessionId: string | undefined
	/**
	 * P1-2: replay-event keys already pushed to `onSessionEvent` listeners.
	 * Live bridge frames carry NO seq (`turn.token/start/end/tool` payloads in
	 * bridge/src/index.ts have turnId/sessionId/text only), so `lastAppliedSeq`
	 * cannot advance on the live path; a second DEAD re-drains rows painted
	 * since the first drain's cursor. This set is the keys-level half of the
	 * dedup: a re-delivered row upserts the SAME key instead of appending a
	 * duplicate line. Cleared when the session binding changes.
	 */
	readonly #appliedReplayKeys = new Set<string>()
	/** A4+A5: explicit recovery outcome for the UI branch (A8), never thrown. */
	#recoveryState: BridgeRecoveryState = "idle"
	/** Pending sync-stage from resumeSession()/newSession(), bound at next turn. */
	#pendingOpen: { mode: "resume"; id: string } | { mode: "new" } | undefined
	/**
	 * Shared in-flight open across turn() and the non-turn UI faces
	 * (#hostCommandsList / #hostCommandsExecute): ONE session.open at a time,
	 * so a palette probe racing the user's first message can never mint a
	 * second session. Cleared on settle (success or failure) so a failed open
	 * is retryable and a settled slot never serves a stale binding.
	 */
	#ensureSessionInFlight: Promise<string | undefined> | undefined
	/** Turn id of the single in-flight turn (drives interrupt()/status()). */
	#inFlightTurnId: string | undefined
	/** 025-w2-1 /btw: single in-flight side call + last throwaway id (domain
	 *  SEPARATE from #currentSessionId / SessionBinding — a side session never
	 *  rewrites the bound main session). */
	#sideSessionInFlight = false
	#lastSideSessionId: string | undefined
	/** Live callbacks of the in-flight turn (set before send to catch early deltas). */
	#activeCallbacks: SeamTurnCallbacks | undefined
	/** Terminal-event waiter for the in-flight turn. */
	#turnDone: (() => void) | undefined
	/**
	 * P1-3 turn generation guard. Every turn() claims a monotonic generation;
	 * the three slots above only mean anything for the generation that claimed
	 * them. A stale `finally` must never clear a newer generation's slots.
	 * 0 == no turn in flight (also the reentrancy gate at turn() entry).
	 */
	#turnGeneration = 0
	#inFlightGeneration = 0
	/** P2-9: degrade classes that already logged once; idle polling must not spam. */
	#degradedOnce = new Set<string>()
	// S3 push face: per-session listeners + PER-(session,method) ordering state.
	// The relay assigns seq per subscription (key sessionId|methodId), so the
	// seam must key the same way (BL-1) or a second/third stream's frames are
	// silently dropped against the first stream's lastSeq. All state is local;
	// frames are whitelisted (methodId/sessionId/seq/eventType/code) — no payload.
	readonly #capPushListeners = new Map<string, Set<(event: CapPushEvent) => void>>()
	readonly #capPushStatus = new Map<string, {
		sessionId: string
		methodId: string
		state: CapPushStatusState
		lastSeq: number
	}>()
	/** C-2: seq-ordering drops, per (sessionId,methodId) — observable, not silent. */
	readonly #capPushDrops = new Map<string, { sessionId: string; methodId: string; count: number }>()
	#usage: UsageAccumulator = { turns: 0, prompt: 0, completion: 0, cacheRead: 0, cacheWrite: 0 }
	/**
	 * Decode-window timing for the footer ⚡ tok/s. The bridge has no stats
	 * frame, so the seam measures live turn frames itself: window starts at the
	 * first non-reasoning token of a turn and closes at `turn.end`, with the
	 * billed `usage.completion` as the token count (mirrors the remote seam's
	 * first-delta → settle rate). Feeds `sessionInfo().lastTurnTps/sessionAvgTps`.
	 */
	#decodeWindowStart: number | undefined
	#lastTurnDecode: { tokens: number; ms: number } | undefined
	#decodeTotals = { tokens: 0, ms: 0 }
	/**
	 * Review P2-1: the single in-flight `sessionInfo()` promise. The footer
	 * refresh (v2-entry) and the `/session` command share this one seam
	 * instance; without coalescing, two calls racing at a turn boundary each
	 * drain the same incremental rows and add them twice to #sessionInfoStats
	 * (a permanent doubling until session switch / clamp). Concurrent callers
	 * reuse this exact promise so the tally is mutated by ONE drain per
	 * generation. Same single-flight shape as bridge dispatchChain /
	 * resolveSessionController. Cleared on settle with a generation guard.
	 */
	#sessionInfoInFlight: Promise<SeamSessionInfo | undefined> | undefined
	/**
	 * P2-1: incremental `sessionInfo()` tally. The footer /session panel polls
	 * on every turn boundary; re-draining the whole journal each call is O(N²)
	 * on a long session. We keep one cumulative, per-session count and only
	 * drain rows whose seq is greater than `lastSeq`. `tps` is deliberately NOT
	 * cached here — `#lastTurnDecode`/`#decodeTotals` are already accumulated
	 * incrementally from live `turn.end` frames and are read fresh each call.
	 * Invalidated on a different session binding or a journal reset (the drain
	 * clamps when `cursor` falls behind `lastSeq`, i.e. seqs restarted).
	 */
	#sessionInfoStats:
		| {
				sessionId: string
				lastSeq: number
				/** Filtered durable `user` transcript rows (seam口径). */
				userRows: number
				/** Filtered durable `assistant` transcript rows (seam口径). */
				assistantRows: number
				/** Raw `assistant/message` rows — the 0.21.1 footer 💬 unit. */
				rawAssistants: number
				/** ⚡ CH: cumulative billing totals from journal usage rows,
				 *  remote `cacheHitRate("session")` 口径 (prompt = uncached input). */
				cachePrompt: number
				cacheRead: number
				cacheWrite: number
				/** ⚡ CH: latest billed row's own hit rate (remote `lastMessage`). */
				lastCacheHitRate: number | null
				/** 🧠 numerator: latest billed row's input+output (remote meter base). */
				contextTokens: number | null
				/** 🧠 denominator: host-resolved window from `request/context`. */
				contextWindow: number | undefined
				/** provider/model the window belongs to (route-key guard). */
				contextWindowKey: string | undefined
				/** provider/model of the live route (from currentModelSelection()). */
				selectionKey: string | undefined
		  }
		| undefined
	/**
	 * RESTORE: session-level live model route. Undefined means "not established
	 * yet" — a cold start / unbound session keeps reading `model.currentSelection`
	 * (the deployment default). Established from ONE tail journal.replay, then
	 * folded incrementally; cleared on session switch/dispose.
	 */
	#modelRoute: ModelRouteCache | undefined
	/** Single-flight for the first establishment replay, so the footer poll does
	 *  not fire a fresh `journal.replay` on every refresh. */
	#modelRouteReplayInFlight: Promise<ModelRouteCache> | undefined
	/** P1-2: incremental rows read while the establishment replay was in flight
	 *  (and no matching cache existed yet). stats.lastSeq already advanced past
	 *  them, so they are buffered here and admitted by seq when the replay lands. */
	#modelRouteDeferredRows: { sessionId: string; rows: BridgeReplayRow[] } | undefined
	/**
	 * ADR-0011 T8/Q4: a host→client ask frame is the bridge-side proof that the
	 * host armed its ask answerers (`armAskAnswerers`, bridge/src/index.ts). We
	 * use it as the provider signal because `bridge.hello`/`bridge.ping` reply
	 * with ONLY `{protocolVersion, bridgeVersion, hostVersion}` (NO capability
	 * field) and the bridge dispatch exposes NO `permissionPresets/catalog`
	 * route — see permissionCatalog() for the full reasoning.
	 */
	#askFrameSeen = false
	/** ADR-0011 T8/Q4: process-once flag for the fail-closed notice. Never a
	 *  persistent status bit; set on the first confirmed "no provider" probe. */
	#permissionNoticeShown = false
	/** ADR-0011 T8/Q4: composition-root sink for the one-shot notice. */
	#onPermissionUnavailable: ((reason: PermissionUnavailableReason) => void) | undefined
	/** ADR-0011: the globally registered answerer (default for question asks,
	 *  fallback for approval asks when no turn-scoped onApprove is active). */
	#askProvider: ((questions: SeamAskQuestion[]) => Promise<SeamAskPick[]>) | undefined
	/** ADR-0011: pending asks keyed by eventId — first-wins, turn-scoped. */
	readonly #pendingAsks = new Map<string, PendingAskEntry>()
	/** A6: reconnect snapshot buffered while the recovery replay drain is still
	 *  in flight. Applied only AFTER the drain completes (blocky §2.3 step 6),
	 *  so rebuilt cards never race the durable transcript replay. */
	#bufferedPendingSnapshot: BridgeAskRequestPayload[] | undefined
	/** A6: true from recoverSession's attach step until the drain is applied.
	 *  While true, an incoming `ask.pending` frame is buffered, not applied. */
	#replayDrainPending = false
	/** A7: the in-flight turn as of the DEAD frame — id plus the text deltas
	 *  already delivered to the view. A fact captured at death time, consumed
	 *  once after replay; NEVER written to the journal (blocky 2.4). */
	#deadInFlight: { turnId: string; partial: string } | undefined
	/** A7: text-delta accumulator for the generation currently in flight. */
	#inFlightPartial = ""
	/** A6: rebuilt asks whose `ask.response` failed because the ask/turn is gone
	 *  (ASK_UNKNOWN_REQUEST / ASK_TURN_ENDED), keyed by eventId → reason. Kept
	 *  read-only for the view to paint a terminal "已失效" card (never vanish). */
	readonly #invalidatedAsks = new Map<string, string>()
	/** A10: live fixed-id upsert — emit a given ask-outcome frame at most once
	 *  per seam instance (re-delivered `ask.settled` frames are no-ops here).
	 *  Replay events are deduped separately by their own view key; no cross-path
	 *  key is shared (hydrate contract §3). */
	readonly #emittedAskOutcomes = new Set<string>()
	#disposed = false

	constructor(options: BridgeSessionSeamOptions) {
		this.#transport = options.transport
		this.#ctx = options.ctx
		// S5 — resolve the client profile home/workspace with the SAME source the
		// composition root uses (DEFAULT_PROFILE from profile-constants.ts,
		// $DSH_HOME or ~/.dsh). T11 changes that one constant, not this line.
		this.#dshHome = options.dshHome ?? resolveDshHome()
		this.#profile = options.profile ?? DEFAULT_PROFILE
		const workspaceDir = options.workspaceDir ?? process.cwd()
		this.#settingsStore = new LocalSettingsStore(this.#dshHome, this.#profile)
		this.#configStore = new LocalConfigStore(this.#dshHome, this.#profile, workspaceDir)
		this.#localAgents = new LocalAgentsFace({
			home: this.#dshHome,
			workspaceDir,
			settings: this.#settingsStore,
			// Raw catalog with reasoning.efforts (the flat modelCatalog() seam
			// projection drops efforts; the agents picker needs the raw groups).
			modelCatalog: () => this.#transport.request("modelCatalog") as Promise<{
				groups: Array<{ id: string; models: Array<{ id: string; reasoning?: { efforts?: Array<{ id: string; name: string; description?: string }> } }> }>
			}>,
		})
		// 025-w1a — /preset real local roster (patch-declared presets + staged id).
		this.#localPresets = new LocalPresetFace(this.#dshHome, this.#profile)
		// 025-w1a — /login provider face (local patch routes + owner-only key store).
		this.#localLogin = new LocalLoginFace(this.#dshHome, this.#profile)
		this.#onDead = options.onDead
		this.#onPermissionUnavailable = options.onPermissionUnavailable
		this.#confirmClock = options.confirmClock ?? {
			// unref: a background confirmation poll must never keep the CLI alive
			// after every real (ref'd) handle has gone away.
			sleep: (ms) => new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, ms)
				;(timer as { unref?: () => void }).unref?.()
			}),
			now: () => Date.now(),
		}
		this.#unsubEvent = this.#transport.onEvent((frame) => this.#onBridgeEvent(frame))
	}

	/**
	 * Read-only consistency fact for /login's pre-write guard. Compares the
	 * directory the client's config/login faces write to (`#profile`) with the
	 * profile the running dsh process actually loads (`transport.profile`).
	 * A transport that does not expose its profile is treated as "no fact" —
	 * the seam never guesses or fabricates a host profile.
	 */
	get profileConsistency(): { ok: true } | { ok: false; clientDir: string; hostDir: string } {
		const host = this.#transport.profile
		if (host === undefined || host === this.#profile) return { ok: true }
		return {
			ok: false,
			clientDir: join(this.#dshHome, "profiles", this.#profile),
			hostDir: join(this.#dshHome, "profiles", host),
		}
	}

	/**
	 * Seam-side double guard: refuse any local profile-directory write when the
	 * two names drifted. The message is plain language (both directories + the
	 * repair), no transport-frame jargon; the command layer shows the localized
	 * version of the same fact before it ever prompts for a key.
	 */
	#assertProfileConsistency(): void {
		const state = this.profileConsistency
		if (state.ok) return
		throw new Error(
			`Profile mismatch: profile files would be written to ${state.clientDir} ` +
			`but the running dsh process reads ${state.hostDir}. Nothing was written. ` +
			`Fix: restart dsh-opentui so both use ${state.hostDir} (remove any one-sided profile override), then retry.`,
		)
	}

	/** Additive handshake helper (not one of the 19 seam members): ping fills
	 *  the connection leg of status() without a dedicated status frame. L2a: the
	 *  same reply carries the additive `capabilities` array — parse it here so
	 *  `hasBridgeCapability()` is authoritative for L3's stop-all branch. */
	async connect(): Promise<void> {
		try {
			const reply = asRecord(await this.#transport.request("bridge.ping"))
			this.#recordBridgeCapabilities(reply.capabilities)
			this.#connection = "connected"
		} catch (err) {
			this.#connection = "disconnected"
			this.#ctx.logger.warn("[bridge-seam] bridge.ping failed, status connection=disconnected: %s", err)
		}
	}

	/** Replace the capability set with the bridge's advertised array. Missing /
	 *  malformed / non-string entries are simply dropped (old bridge = empty). */
	#recordBridgeCapabilities(value: unknown): void {
		this.#bridgeCapabilities.clear()
		if (!Array.isArray(value)) return
		for (const entry of value) {
			if (typeof entry === "string" && entry !== "") this.#bridgeCapabilities.add(entry)
		}
	}

	/**
	 * L2a: true iff the connected bridge advertised `name` in its hello/ping
	 * reply. Old bridges (no `capabilities` field) answer false for everything.
	 * Public so L3's `stop-all.ts` can pick the capability path vs the legacy
	 * roster traversal without firing a probe frame per child.
	 */
	hasBridgeCapability(name: string): boolean {
		return this.#bridgeCapabilities.has(name)
	}

	// ----- sync members (D3: degrade + log, never throw) -------------------

	status(): SeamStatus {
		if (this.#connection === "disconnected") {
			// No status frame + no successful handshake: the only honest
			// sync answer is the null-seam default, plus a degrade log.
			// P2-9: session-tabs polls status() on a timer — log this class once.
			this.#degradeOnce("status", "no handshake/status frame; returning disconnected/idle")
		}
		return { connection: this.#connection, turn: this.#turn, sessionAttached: this.#sessionAttached, bridge: this.#bridgeLink }
	}

	currentSessionId(): string | undefined {
		// COVERED: just the client-side projection of session.open/close.
		return this.#currentSessionId
	}

	resumeSession(id: string): "ok" | "owned" {
		// COVERED (staging semantics, legacy HTTP session facade:760-764 parity):
		// stage the id; the real resume is an eager `session.open{mode:"resume"}`
		// at the next turn. "owned" is not determinable sync — a writer-held
		// target surfaces as SESSION_LOCKED from that open, asynchronously.
		// RESTORE: switching sessions invalidates the journal-folded live route.
		this.#resetModelRoute()
		this.#pendingOpen = { mode: "resume", id }
		return "ok"
	}

	newSession(): void {
		// COVERED: clear the bound id and stage a `session.open{mode:"new"}` for
		// the next turn (legacy HTTP session facade:746-751 staging parity).
		//
		// P2-8 LOCK WINDOW (deliberate, no behavior change): after /new but before
		// the next turn, the BRIDGE still holds the OLD session open. The close is
		// owed by turn() at the start of that next turn (ADR-0010:58
		// OPEN → CLOSING → OPENING(newId)); it is deliberately NOT sent here so
		// /new stays a synchronous staging operation. Consequence: during this
		// window another process that resumes the old id gets SESSION_LOCKED from
		// the bridge, even though this client already reports
		// currentSessionId() === undefined. #sessionAttached intentionally stays
		// true to remember that the close is owed; do NOT clear it here.
		this.#currentSessionId = undefined
		if (this.#resetExternalSubagents()) this.#emitSubagentViews()
		this.#resetHostCommands()
		this.#resetModelRoute()
		this.#pendingOpen = { mode: "new" }
		// P1-1: starting a fresh session abandons the DEAD session entirely —
		// settle any turn() the dead frame left suspended (busy wedge escape),
		// and drop the death snapshot so a later recovery cannot revive it.
		// P1-2: this is a silent settle, so the helper emits a LOCAL interrupted
		// terminal tagged SESSION_CLOSED / "session changed" before resolving.
		this.#settleSuspendedTurn({ code: "SESSION_CLOSED", reason: "session changed" })
		this.#deadInFlight = undefined
		this.#inFlightPartial = ""
	}

	stagedSessionId(): string | undefined {
		// P1-4: the resume target staged by resumeSession(), still unbound until
		// the next turn calls session.open. Returns undefined for a staged
		// newSession() or when nothing is staged — consumers targeting "the
		// session on screen" must read this alongside currentSessionId() or a
		// resumed-but-not-yet-turned session browses the wrong id (review P1-1).
		return this.#pendingOpen?.mode === "resume" ? this.#pendingOpen.id : undefined
	}

	// ----- A4+A5: post-DEAD session recovery (respawn is A3/transport) --------

	/** A4+A5: read-only recovery outcome; the view reads this in A8 instead of
	 *  polling. Never throws — failures are states + events. */
	recoveryState(): BridgeRecoveryState {
		return this.#recoveryState
	}

	/**
	 * A4+A5: after the transport's `recover()` has reached READY, re-attach the
	 * last session and drain the durable journal. Steps (blocky §2.3 first four):
	 *   session.open{mode:"resume", id:lastSessionId}
	 *   → journal.replay{from:lastAppliedSeq+1} (no lastSeq → 1), paged drain
	 *   → seq dedup + ascending apply through the EXISTING transcript pipeline
	 *   → "已恢复，补齐 N 条事件" event, terminal state "attached".
	 * SESSION_LOCKED keeps the transport READY and drops the session layer to
	 * "connected / not attached" (visible via status() + recoveryState() + event).
	 * A non-LOCKED open/replay failure becomes an explicit "failed" state — no
	 * retry loop, no transport rollback.
	 */
	async recoverSession(): Promise<BridgeRecoveryResult> {
		const sessionId = this.#currentSessionId ?? this.stagedSessionId()

		const emit = (event: SeamSessionEvent): void => {
			for (const listener of [...this.#listeners]) {
				try {
					listener(event)
				} catch {
					/* one stale view listener must not break the feed */
				}
			}
		}
		const fail = (code: string, message: string): BridgeRecoveryResult => {
			this.#recoveryState = "failed"
			this.#sessionAttached = false
			this.#connection = "connected"
			this.#bridgeLink = "ready"
			// A6: a failed recovery never rebuilds cards — drop any buffered
			// snapshot and release the drain gate.
			this.#bufferedPendingSnapshot = undefined
			this.#replayDrainPending = false
			// P1-1: a failed recovery is a terminal outcome for a turn that DEAD
			// left suspended — never leave its waiter hanging (busy wedged, next
			// turn() rejected TURN_REENTRANT). No-op when no turn is suspended.
			this.#settleSuspendedTurn()
			const result: BridgeRecoveryResult = {
				state: "failed", sessionId, applied: 0, from: 0, cursor: 0, rows: [],
				error: { code, message },
			}
			emit({ type: "bridge.recovery.failed", details: { ...result, message: `恢复失败: ${message}` } })
			return result
		}

		if (this.#disposed) return fail("DISPOSED", "bridge seam is disposed")
		if (sessionId === undefined || sessionId === "") {
			return fail("NO_SESSION_TO_RESUME", "no session was open before DEAD")
		}

		this.#recoveryState = "recovering"
		this.#connection = "connected"
		this.#bridgeLink = "ready"
		this.#sessionAttached = false
		// A6: open the drain gate BEFORE session.open — the bridge pushes
		// ask.pending on resume, and that frame can arrive before this method
		// reaches the journal replay below.
		this.#replayDrainPending = true

		// (a) re-attach the last session with an eager resume, never replace.
		let opened: Record<string, unknown>
		try {
			opened = asRecord(await this.#transport.request("session.open", { mode: "resume", id: sessionId }))
		} catch (err) {
			const code = err instanceof BridgeProtocolError ? err.code : "SESSION_OPEN_FAILED"
			const message = err instanceof Error ? err.message : String(err)
			if (code === "SESSION_LOCKED") {
				// Transport stays READY; only the session layer degrades. A8 paints
				// the branch from status()/recoveryState()/this event.
				this.#recoveryState = "locked"
				this.#sessionAttached = false
				// A6: no attach happened — no card rebuild on a locked session.
				this.#bufferedPendingSnapshot = undefined
				this.#replayDrainPending = false
				// P1-1: a locked recovery is also terminal for the suspended turn;
				// otherwise /new (which now settles it too) is the only escape.
				this.#settleSuspendedTurn()
				// P2-1: the bridge maps the host's SessionAlreadyOwnedError to
				// SESSION_LOCKED with detail.holder = the owning session id
				// (packages/bridge/src/index.ts mapHostError). Forward it so the
				// UI banner can name the holder. `message` stays the raw host
				// diagnostic (language-neutral); the localised reason template
				// in the UI does the framing, so no CJK copy rides the wire.
				const errorDetail = err instanceof BridgeProtocolError ? asRecord(err.detail) : {}
				const holder =
					typeof errorDetail.holder === "string" && errorDetail.holder.trim() !== ""
						? errorDetail.holder
						: undefined
				const result: BridgeRecoveryResult = {
					state: "locked", sessionId, applied: 0, from: 0, cursor: 0, rows: [],
					error: { code, message },
				}
				emit({
					type: "bridge.recovery.locked",
					details: {
						...result,
						message,
						...(holder !== undefined ? { holder } : {}),
					},
				})
				return result
			}
			this.#ctx.logger.error("[bridge-seam] recovery session.open failed: %s", err)
			return fail(code, message)
		}

		const boundId = typeof opened.sessionId === "string" ? opened.sessionId : sessionId
		this.#currentSessionId = boundId
		if (this.#rebindExternalSession(boundId)) this.#emitSubagentViews()
		this.#resetHostCommands()
		if (this.#pendingOpen?.mode === "resume" && this.#pendingOpen.id === boundId) this.#pendingOpen = undefined
		if (this.#lastAppliedSessionId !== boundId) {
			this.#lastAppliedSessionId = boundId
			this.#lastAppliedSeq = undefined
			this.#appliedReplayKeys.clear()
			this.#resetModelRoute()
		}
		this.#sessionAttached = true

		// (b) catch up the durable journal. `from` is inclusive; no lastSeq → 1.
		const from = this.#lastAppliedSeq === undefined ? 1 : this.#lastAppliedSeq + 1
		let drained: { rows: BridgeReplayRow[]; cursor: number; clamped: boolean }
		try {
			drained = await this.#drainJournal(boundId, from)
		} catch (err) {
			const code = err instanceof BridgeProtocolError ? err.code : "JOURNAL_REPLAY_FAILED"
			const message = err instanceof Error ? err.message : String(err)
			this.#ctx.logger.error("[bridge-seam] recovery journal.replay failed: %s", err)
			return fail(code, message)
		}
		if (drained.clamped && from > 1) {
			this.#ctx.logger.warn(
				"[bridge-seam] recovery replay from=%d is ahead of journal max=%d; clamped to %d",
				from, Math.max(0, drained.cursor - 1), drained.cursor,
			)
			// The clamped tail cannot refresh a complete route cache. Drop it so
			// the next ensure performs an authoritative from=1 replay (P1-2).
			this.#resetModelRoute()
		}

		// (c) apply through the SAME projection storedTranscript() uses — no new
		// render path. Dedup + ascending order were established by #drainJournal.
		// Same rows also restore the subagent roster after a process restart
		// (spawn/settle from the durable journal; running = start w/o terminal).
		this.#foldAgentReplayRows(drained.rows, boundId)
		// RESTORE: the recovery replay is the first authoritative read of the
		// resumed session's live route — establish the cache from it (no extra RPC)
		// ONLY when it was a full read; an incremental window only updates an
		// already-complete cache (else #ensureModelRoute replays from 1).
		this.#foldModelRouteFromDrain(boundId, drained.rows, from)
		// 0.23.0 T1 sweep hook ② (recover): the bridge has no `recover` event, so
		// the client drives the same host-registry sweep here — after the roster
		// is restored from the replay so a ghost child can be settled. Best-effort
		// (the helper never throws); a failed read leaves the roster unchanged.
		await this.#sweepSubagents(boundId)
		// Pass the bound id so DEAD result.rows MAY carry ask-outcome notices;
		// they are not painted by any consumer (§8.5) and never appear in the
		// sessionInfo count path, which omits the session id.
		const rows = bridgeReplayRowsToSeamTranscript(drained.rows, 0, boundId)
		if (drained.rows.length > 0) {
			const maxSeq = drained.rows.reduce((m, row) => Math.max(m, row.seq), -Infinity)
			this.#lastAppliedSeq = Math.max(this.#lastAppliedSeq ?? 0, maxSeq)
			this.#lastAppliedSessionId = boundId
		}

		// P1-2: the projection above used to be DATA-ONLY — `rows` rode on
		// `bridge.recovered`, whose consumer reads `applied` (the count) but
		// never the rows, so content journalled after the last live delta (the
		// killed turn's tail, tool lines landed during the death window) was
		// never painted, and `#lastAppliedSeq` had already moved past it.
		// The actual event application happens BELOW, after step (e) settles
		// the DEAD-suspended turn — seam-rows' SETTLE SUPERSEDE only replaces a
		// streamed group when `turnOpen === false`, so emitting earlier would
		// append a SECOND body beside the raw live one.

		// (d) A6 timing gate — ONLY now that the replay drain has completed do
		// we rebuild pending cards from a buffered `ask.pending` snapshot. The
		// eventId is preserved verbatim so the cards answer through the existing
		// ask.response path (blocky §2.3 step 6; A4/A5 recovery order).
		const buffered = this.#bufferedPendingSnapshot
		this.#bufferedPendingSnapshot = undefined
		this.#replayDrainPending = false
		if (buffered !== undefined) this.#applyPendingSnapshot(buffered)

		// (e) A7 — the in-flight turn at DEAD is finalized by the durable journal.
		// If replay carries the host terminal, the live turn state is settled to
		// THAT terminal (reason/payload verbatim from the journal row) and NO
		// local duplicate marker is painted. Only when the journal stays silent
		// does the client paint its LOCAL INTERRUPTED marker (seq:null, source:
		// "local", never journaled). A normal (non-DEAD) in-flight turn has no
		// #deadInFlight snapshot and is never touched here.
		const dead = this.#deadInFlight
		this.#deadInFlight = undefined
		if (dead !== undefined) {
			// P2-1: if a terminal precedes the first turn/start in this drain,
			// our turn's start was applied before the window (that terminal is
			// ours) and any turn/start in the window is a LATER writer — switch
			// to the id/next-start association instead of "above the last start".
			const firstStart = drained.rows.find((r) => r.type === "turn/start")?.seq
			const firstTerminal = drained.rows.find((r) => r.type === "turn/end" || r.type === "turn/error")?.seq
			const startOutsideWindow = firstStart !== undefined && firstTerminal !== undefined && firstTerminal < firstStart
			const terminal = lastJournalTurnTerminal(drained.rows, startOutsideWindow)
			if (terminal !== undefined) {
				// The host terminal is already projected into the transcript by
				// step (c). This event feeds the terminal reason/payload back to
				// the live turn state so the streamed rows settle and the spinner
				// closes — without a second transcript marker.
				emit({
					type: "bridge.turn.terminal",
					details: {
						sessionID: boundId,
						turnId: dead.turnId,
						seq: terminal.seq,
						terminalType: terminal.type,
						reason: asRecord(terminal.payload).reason,
						payload: terminal.payload,
						source: "journal",
					},
				})
				// P1-1: settle the suspended turn() waiter — its generation-
				// guarded finally sweep finalizes the live rows and clears the
				// busy/spinner state. Without this the busy flag wedged forever
				// and the next turn() threw TURN_REENTRANT. The journal terminal
				// event above already announced the outcome — no local duplicate.
				this.#settleSuspendedTurn({ terminalEmitted: true })
			} else {
				emit({
					type: "bridge.turn.interrupted",
					details: {
						sessionID: boundId,
						turnId: dead.turnId,
						partial: dead.partial,
						reason: "connection lost while the turn was in flight",
						code: "INTERRUPTED",
						seq: null,
						source: "local",
					},
				})
				// P1-1: the journal stayed silent → the dead turn is a LOCAL
				// INTERRUPTED terminal. Settle turn() the same way as the journal
				// terminal arm (resolve), so busy returns to zero and the next
				// submission is accepted; the event above carries the reason
				// (already emitted — no local duplicate).
				this.#settleSuspendedTurn({ terminalEmitted: true })
			}
		}

		// Step (e)'s #settleSuspendedTurn() resolves turn(), but the view's
		// .finally() (live-row finalize + `turnOpen=false`) runs on a LATER
		// microtask. Yield one macrotask so seam-rows' SETTLE SUPERSEDE guard
		// sees `turnOpen===false` and replaces the raw live group IN PLACE —
		// emitting earlier appends a second body beside the streamed one.
		await new Promise<void>((resolve) => setTimeout(resolve, 0))

		// P1-2: apply the drained rows through the EXISTING onSessionEvent
		// pipeline (the same `message.updated`/`message.part.updated` events the
		// remote seam's journal feed emits). Now that step (e) has settled the
		// suspended turn, seam-rows' SETTLE SUPERSEDE replaces the raw live
		// group in place (one body per turn) instead of appending a duplicate,
		// and tool lines from the death window land under their seq-derived key.
		// The keys set is the seq/keys double insurance for a SECOND death —
		// live bridge frames carry no seq, so a re-drain of rows painted live
		// since the first cursor upserts the same key instead of appending.
		for (const event of bridgeReplayRowsToSeamEvents(drained.rows, boundId)) {
			const key = seamReplayEventKey(event)
			if (this.#appliedReplayKeys.has(key)) continue
			this.#appliedReplayKeys.add(key)
			emit(event)
		}

		this.#sessionAttached = true
		this.#connection = "connected"
		this.#bridgeLink = "ready"
		this.#recoveryState = "attached"
		// S3: a successful resume re-arms the push face — EVERY per-(session,method)
		// subscription returns to attached with seq reset to 0 (the bridge starts
		// fresh subscriptions on its resume open). BL-1: reset is per subscription,
		// never a single session-wide slot.
		for (const [key, status] of this.#capPushStatus) {
			if (status.sessionId !== boundId) continue
			this.#capPushStatus.set(key, { ...status, state: "attached", lastSeq: 0 })
		}
		const result: BridgeRecoveryResult = {
			state: "attached", sessionId: boundId, applied: drained.rows.length,
			from, cursor: drained.cursor, rows,
		}
		emit({ type: "bridge.recovered", details: { ...result, message: `已恢复，补齐 ${result.applied} 条事件` } })
		return result
	}

	/**
	 * Drain `journal.replay` pages. The bridge replies `{rows, cursor}` in one
	 * frame (`cursor = maxSeq+1` of the FULL log, independent of `from`); this
	 * loop still advances `from` by the page's max seq so a paginating bridge is
	 * drained completely. Rows are deduplicated by seq and sorted ascending, so
	 * overlapping/out-of-order pages never paint a duplicate transcript line.
	 * A client ahead of the journal (`from > cursor`) is clamped once + reported
	 * to the caller (which logs `warn`) instead of throwing.
	 */
	async #drainJournal(
		sessionId: string,
		startFrom: number,
	): Promise<{ rows: BridgeReplayRow[]; cursor: number; clamped: boolean }> {
		let from = startFrom
		let floor = startFrom
		let cursor = 0
		let clamped = false
		const seen = new Set<number>()
		const collected: BridgeReplayRow[] = []
		for (;;) {
			const value = asRecord(await this.#transport.request("journal.replay", { sessionId, from }))
			const rawRows = Array.isArray(value.rows) ? value.rows : []
			if (typeof value.cursor === "number" && Number.isFinite(value.cursor)) cursor = value.cursor
			if (!clamped && cursor > 0 && from > cursor) {
				// lastAppliedSeq > journal max — clamp the lower bound once, then
				// re-request; never loop on the clamp itself.
				clamped = true
				from = cursor
				floor = cursor
				continue
			}
			let added = 0
			let pageMax = from - 1
			for (const raw of rawRows) {
				const row = asRecord(raw)
				const seq = row.seq
				if (typeof seq !== "number" || !Number.isFinite(seq) || seq < floor || seen.has(seq)) continue
				seen.add(seq)
				collected.push({ seq, type: typeof row.type === "string" ? row.type : "", payload: row.payload })
				added += 1
				if (seq > pageMax) pageMax = seq
			}
			if (added === 0) break
			from = pageMax + 1
			if (cursor > 0 && from >= cursor) break
		}
		collected.sort((a, b) => a.seq - b.seq)
		return { rows: collected, cursor, clamped }
	}

	interrupt(): void {
		// PARTIAL: turn.abort is real, but the seam is sync void and needs the
		// turnId from the live turn. Without one, degrade to a no-op + log.
		const turnId = this.#inFlightTurnId
		if (turnId === undefined || turnId === "") {
			this.#degrade("interrupt", "no in-flight turnId; turn.abort skipped (no-op)")
			return
		}

		// P1-5: a failed abort used to be logger.warn-only — the state machine
		// stayed "running" with no callback and no event, so the user never saw
		// it. Surface it on BOTH channels the view consumes: the live turn's
		// onError callback and a projected session.error event. Also release the
		// waiter so turn() does not hang forever when no terminal frame arrives
		// (TURN_NOT_FOUND / transport death / a noop "success"). The sync void
		// signature still never throws — all of this runs in a microtask.
		const fail = (message: string, code: string): void => {
			this.#ctx.logger.warn("[bridge-seam] %s", message)
			const cb = this.#activeCallbacks
			if (cb !== undefined) {
				try {
					cb.onError(message)
				} catch {
					/* a throwing view callback must not break the feed */
				}
			}
			const [event] = projectBridgeEvent(
				{ type: "turn.error", payload: { turnId, code, message } },
				this.#currentSessionId ?? "",
			)
			if (event !== undefined) {
				for (const listener of this.#listeners) {
					try {
						listener(event)
					} catch {
						/* one stale view listener must not break the feed */
					}
				}
			}
			// Let turn() finish and status() report idle — the abort failed, so
			// waiting on a terminal frame that may never come is a deadlock.
			if (this.#inFlightTurnId === turnId) {
				this.#inFlightTurnId = undefined
				this.#turn = "idle"
				this.#turnDone?.()
			}
		}

		// Fire-and-forget with ONE bounded retry. A noop response already means
		// the id was terminal/already-aborted — report it, do not retry it.
		const attempt = (remaining: number): void => {
			void this.#transport.request("turn.abort", { turnId })
				.then((result) => {
					if (asRecord(result).noop === true) {
						fail(`turn.abort was a noop for turn ${turnId}; turn may still be running`, "TURN_ABORT_NOOP")
					}
				})
				.catch((err: unknown) => {
					if (remaining > 0) {
						attempt(remaining - 1)
						return
					}
					const code = err instanceof BridgeProtocolError ? err.code : "TURN_ABORT_FAILED"
					const reason = err instanceof Error ? err.message : String(err)
					fail(`turn.abort failed for turn ${turnId}: ${reason}`, code)
				})
		}
		attempt(1)
	}

	usageSummary(): string[] {
		// PARTIAL: cache turn.end.usage; sync read, so no data = empty + log.
		if (this.#usage.turns === 0) {
			// P2-9: the status bar polls this too — warn once per degrade class.
			this.#degradeOnce("usageSummary", "no turn.end usage captured yet; returning []")
			return []
		}
		const u = this.#usage
		return [
			`turns ${u.turns}`,
			`prompt ${fmtTokens(u.prompt)} tok`,
			`completion ${fmtTokens(u.completion)} tok`,
		]
	}

	/**
	 * Footer /session snapshot (0.21.1 single-💬 semantics). `msgCount` is the
	 * authoritative footer unit and is derived from the durable journal's
	 * RAW `assistant/message` rows — one event = one msg (0.21.1 release
	 * semantics, same unit the remote seam bills). `messageCount`/`turnCount`
	 * are the FILTERED durable transcript counts for the /session panel ONLY,
	 * aligned with the seam contract and the remote adapter: a `user/message`
	 * with a non-"user" `source.kind` (runtime-context / tool-registry
	 * injections) and any empty-text user/assistant row are excluded (see
	 * `journalToTranscriptRows`, which the remote adapter also uses).
	 *
	 * P2-1: the journal is drained INCREMENTALLY via a per-session tally —
	 * only rows with seq > the cached `lastSeq` are read, so repeated polls do
	 * not re-scan the whole log. A different session binding or a journal reset
	 * (drain clamped) invalidates the cache and restarts from seq 1.
	 *
	 * tps rides the LIVE decode window measured from turn frames; a journal
	 * that cannot be read omits `msgCount`/`messageCount`/`turnCount` entirely
	 * ("unknown", not a fabricated 0). No session bound → undefined, matching
	 * the null seam.
	 *
	 * Review P2-1: concurrent callers coalesce onto ONE in-flight promise
	 * (#sessionInfoInFlight), so two polls racing at a turn boundary cannot both
	 * drain the same incremental rows and double-count the tally.
	 */

	/**
	 * ⚡ CH footer segment — the retired HTTP facade's cacheHitRate() 1:1
	 * (legacy HTTP session facade:789-803). "session" is the cumulative journal rate
	 * ΣcacheRead / (Σprompt + ΣcacheRead + ΣcacheWrite); the default
	 * ("lastMessage") is the latest billed row's `cacheRead / billed * 100`.
	 * Visibility gate: null until ANY cache traffic. Reads the SAME
	 * `#sessionInfoStats` tally the footer's sessionInfo() poll fills, so it
	 * needs no extra journal drain and cannot double-count.
	 */
	cacheHitRate(mode?: "session" | "lastMessage"): number | null {
		const stats = this.#liveStats()
		if (stats === undefined || stats.cacheRead + stats.cacheWrite <= 0) return null
		if (mode === "session") {
			const billed = stats.cachePrompt + stats.cacheRead + stats.cacheWrite
			return billed > 0 ? (stats.cacheRead / billed) * 100 : null
		}
		return stats.lastCacheHitRate
	}

	/**
	 * 🧠 numerator — the latest billed journal usage row's input+output
	 * (`totalTokens`, remote `ContextTokenMeter` billed base). null until a
	 * usage row has been drained for the live session (honest omission, same
	 * gate as the other footer counters).
	 */
	contextTokens(): number | null {
		return this.#liveStats()?.contextTokens ?? null
	}

	/**
	 * 🧠 denominator — the host-resolved `request/context.contextWindow` for the
	 * live route (remote's projection window / catalog resolution equivalent).
	 * null while unknown → the footer degrades to the bare `🧠 used` shape.
	 */
	contextWindow(): number | null {
		return this.#liveContextWindow()
	}

	/** The stats tally only while it belongs to the CURRENT session binding. */
	#liveStats() {
		const stats = this.#sessionInfoStats
		return stats !== undefined && stats.sessionId === this.currentSessionId() ? stats : undefined
	}

	/** The route-guarded context window shared by the getter and sessionInfo(). */
	#liveContextWindow(): number | null {
		const stats = this.#liveStats()
		if (stats?.contextWindow === undefined) return null
		if (
			stats.contextWindowKey !== undefined &&
			stats.selectionKey !== undefined &&
			stats.contextWindowKey !== stats.selectionKey
		) return null // window belongs to a different route — degrade, never a wrong denominator
		return stats.contextWindow
	}

	sessionInfo(): Promise<SeamSessionInfo | undefined> {
		const existing = this.#sessionInfoInFlight
		if (existing !== undefined) return existing
		const run = this.#computeSessionInfo()
		this.#sessionInfoInFlight = run
		const release = (): void => {
			// Generation guard: only the call that set the slot may clear it.
			if (this.#sessionInfoInFlight === run) this.#sessionInfoInFlight = undefined
		}
		void run.then(release, release)
		return run
	}

	async #computeSessionInfo(): Promise<SeamSessionInfo | undefined> {
		const sessionId = this.currentSessionId()
		if (!sessionId) return undefined

		let counts: Pick<SeamSessionInfo, "msgCount" | "messageCount" | "turnCount"> | undefined
		try {
			// P2-1: reuse the cumulative tally only while the binding is unchanged;
			// a new session starts a fresh one at seq 1.
			let stats = this.#sessionInfoStats
			if (stats === undefined || stats.sessionId !== sessionId) {
				stats = {
					sessionId, lastSeq: 0, userRows: 0, assistantRows: 0, rawAssistants: 0,
					cachePrompt: 0, cacheRead: 0, cacheWrite: 0, lastCacheHitRate: null,
					contextTokens: null, contextWindow: undefined, contextWindowKey: undefined, selectionKey: undefined,
				}
				this.#sessionInfoStats = stats
			}
			let from = stats.lastSeq + 1
			// Read-only incremental log; #drainJournal pages and dedups by seq and
			// never writes to the journal or touches a writer lock (ADR-0010 I6).
			let drained = await this.#drainJournal(sessionId, from)
			if (drained.clamped && from > 1) {
				// Journal reset: `cursor` fell behind our `lastSeq` (seqs restarted).
				// Drop the stale cumulative counts and re-read the whole log.
				stats = {
					sessionId, lastSeq: 0, userRows: 0, assistantRows: 0, rawAssistants: 0,
					cachePrompt: 0, cacheRead: 0, cacheWrite: 0, lastCacheHitRate: null,
					contextTokens: null, contextWindow: undefined, contextWindowKey: undefined, selectionKey: undefined,
				}
					this.#sessionInfoStats = stats
					// P1-2: the route cache kept the OLD journal's watermark (e.g. 40).
					// The next from=1 fold would skip every post-reset row seq<=40 and
					// pin the stale route forever. Drop cache + deferred rows (old seqs
					// collide with the new journal) before the authoritative re-read.
					this.#resetModelRoute()
					from = 1
					drained = await this.#drainJournal(sessionId, 1)
					// A reset invalidates external lifecycle caches as well. The
					// authoritative re-read below re-seeds them from the new log.
					if (this.#resetExternalSubagents()) this.#emitSubagentViews()
				}

			// RESTORE: these SAME drained rows establish/update the live route
			// cache, so the currentModelSelection() call below needs no second
			// journal.replay — but ONLY for a full read. An incremental drain
			// (from>1, no clamp) may update an existing cache, never create one;
			// otherwise an empty window would pin an empty route forever.
			this.#foldModelRouteFromDrain(sessionId, drained.rows, from)

			// P2-1 (inproc): fold the SAME drained rows through the subagent
			// projector so an async child's terminal converges OUTSIDE a turn. The
			// live `agent.settle` frame may be missed while the bridge was idle /
			// down; the host journals it as a `user/message` subagent-settled row,
			// which this fold settles by senderSessionId. Re-folding is idempotent.
			this.#foldAgentReplayRows(drained.rows, sessionId)

			// msgCount stays the RAW assistant/message count (0.21.1 semantics).
			// The SAME journal rows also carry the ⚡ CH and 🧠 inputs: the host's
			// `assistant/message.data.usage` (`inputTokens/outputTokens/cacheReadTokens/
			// cacheWriteTokens/totalTokens`) is the exact data the remote seam reads
			// off its live usage chunks (scanUsageChunk parity). Accumulate into the
			// ONE #sessionInfoStats tally so the incremental drain, its single-flight
			// coalescing and its session/reset invalidation stay shared (P2-1).
			for (const row of drained.rows) {
				if (row.type === "assistant/message") {
					stats.rawAssistants++
					const usage = journalUsage(row.payload)
					if (usage !== undefined) {
						// legacy HTTP session facade:2529-2533 parity — cumulative
						// billing totals + the latest billed request's own rate.
						// Gate on `> 0`, not truthiness, exactly like remote: a
						// reported 0 must never advance (or reset) a tally.
						const prompt = usage.prompt ?? 0
						const cacheRead = usage.cacheRead ?? 0
						const cacheWrite = usage.cacheWrite ?? 0
						if (prompt > 0) stats.cachePrompt += prompt
						if (cacheRead > 0) stats.cacheRead += cacheRead
						if (cacheWrite > 0) stats.cacheWrite += cacheWrite
						const billed = prompt + cacheRead + cacheWrite
						if (billed > 0) stats.lastCacheHitRate = (cacheRead / billed) * 100
						// 🧠 numerator: latest billed request's input+output — remote's
						// ContextTokenMeter billed base (totalTokens when disclosed).
						stats.contextTokens = usage.total
					}
				} else if (row.type === "request/context") {
					// 🧠 denominator: the host resolved the live route's window for
					// this request (remote's `pressure.contextWindow` equivalent).
					const data = asRecord(row.payload)
					const window = data.contextWindow
					if (typeof window === "number" && Number.isFinite(window) && window > 0) {
						const provider = typeof data.provider === "string" ? data.provider : ""
						const model = typeof data.model === "string" ? data.model : ""
						stats.contextWindow = window
						stats.contextWindowKey = provider && model ? `${provider}/${model}` : undefined
					}
				}
			}
			// P2-2: the /session counts go through the SAME projection the remote
			// adapter uses, so the filtered口径 (non-user source.kind + empty-text
			// rows excluded) is identical. The ask/tool pairing inside the
			// projection is irrelevant here — only user/assistant kinds are
			// counted, and those are decided per row, independent of chunking.
			for (const row of bridgeReplayRowsToSeamTranscript(drained.rows)) {
				if (row.kind === "user") stats.userRows++
				else if (row.kind === "assistant") stats.assistantRows++
			}
			for (const row of drained.rows) {
				if (row.seq > stats.lastSeq) stats.lastSeq = row.seq
			}
			counts = {
				msgCount: stats.rawAssistants,
				messageCount: stats.userRows + stats.assistantRows,
				turnCount: stats.userRows,
			}
		} catch (err) {
			// P3-1: a failed read omits ALL durable counts rather than painting a
			// fake 0 — consistent with msgCount's honest-omission contract.
			this.#ctx.logger.warn("[bridge-seam] sessionInfo journal.replay failed: %s", err)
		}

		const selection = await this.currentModelSelection().catch(() => undefined)
		const stats = this.#liveStats()
		// The journal's `request/context` window belongs to the route that made
		// that request. Keep the live route key on the SAME tally so the sync
		// contextWindow() getter and sessionInfo() share the route guard (the
		// remote seam's `#contextWindowKey`): a window for a different route
		// degrades to unknown rather than serving a wrong denominator.
		const selectionKey = selection ? `${selection.providerID}/${selection.modelID}` : undefined
		if (stats !== undefined) stats.selectionKey = selectionKey
		const u = this.#usage
		const last = this.#lastTurnDecode
		return {
			sessionId,
			model: selectionKey ?? null,
			...(counts !== undefined ? counts : {}),
			tokensIn: u.prompt,
			tokensOut: u.completion,
			cacheRead: u.cacheRead,
			cacheWrite: u.cacheWrite,
			lastTurnTps: last && last.ms > 0 ? tokensPerSecond(last.tokens, last.ms) : null,
			sessionAvgTps: this.#decodeTotals.ms > 0
				? tokensPerSecond(this.#decodeTotals.tokens, this.#decodeTotals.ms)
				: null,
			// 🧠 context rows (footer context batch; remote adapter parity).
			contextTokens: stats?.contextTokens ?? null,
			contextWindow: this.#liveContextWindow(),
		}
	}

	// ----- S3 host→client push face ------------------------------------------
	/**
	 * Subscribe to whitelisted `cap.event` push items for ONE session. Frames for
	 * other sessionIds are never delivered (v3 §3.1 sessionId isolation). The
	 * disposer removes only this listener; no state is fabricated on dispose.
	 */
	onCapPush(sessionId: string, listener: (event: CapPushEvent) => void): () => void {
		let set = this.#capPushListeners.get(sessionId)
		if (set === undefined) {
			set = new Set()
			this.#capPushListeners.set(sessionId, set)
		}
		set.add(listener)
		return () => {
			const current = this.#capPushListeners.get(sessionId)
			if (current === undefined) return
			current.delete(listener)
			if (current.size === 0) this.#capPushListeners.delete(sessionId)
		}
	}

	/**
	 * Aggregate push status for a session, or undefined if unseen. Internally the
	 * seam tracks ordering per (sessionId,methodId) (BL-1); this surface keeps the
	 * original three-field shape: `lastSeq` is the max across that session's
	 * subscriptions and `state` uses disconnected > degraded > attached precedence.
	 */
	capPushStatus(sessionId: string): CapPushStatus | undefined {
		let seen = false
		let state: CapPushStatusState = "attached"
		let lastSeq = 0
		for (const status of this.#capPushStatus.values()) {
			if (status.sessionId !== sessionId) continue
			seen = true
			lastSeq = Math.max(lastSeq, status.lastSeq)
			if (status.state === "disconnected") state = "disconnected"
			else if (status.state === "degraded" && state === "attached") state = "degraded"
		}
		return seen ? { sessionId, state, lastSeq } : undefined
	}

	/** C-2: count of seq-ordered drops for one method, or all methods of a session. */
	capPushDropCount(sessionId: string, methodId?: string): number {
		if (methodId !== undefined) {
			return this.#capPushDrops.get(`${sessionId}|${methodId}`)?.count ?? 0
		}
		let total = 0
		for (const drop of this.#capPushDrops.values()) {
			if (drop.sessionId === sessionId) total += drop.count
		}
		return total
	}

	onSessionEvent(listener: (event: SeamSessionEvent) => void): () => void {
		// PARTIAL: only turn.start/end/error project; token/tool ride the live
		// turn callbacks, and permission.asked / host session.updated /
		// bridge.shutdown do not exist on the wire. The ask channel owns its
		// OWN frame queue (ask.request/cancel/settled/pending), so this gap is
		// noise for the approval card — log it once (the view subscribes on
		// every boot / session switch, which used to spam the same warn).
		this.#degradeOnce("onSessionEvent", "only turn.* lifecycle/error events project; permission.asked / bridge.shutdown absent")
		this.#listeners.push(listener)
		return () => {
			const i = this.#listeners.indexOf(listener)
			if (i >= 0) this.#listeners.splice(i, 1)
		}
	}

	// ----- subagent marker face (row 33 inproc, legacy HTTP facade 1:1) -------

	/** Panel/viewer snapshot — a fresh copy so callers cannot mutate the store.
	 *  T2: lazy journal reads write rounds/lastLine/model straight into the
	 *  roster entries (so a later settle carries them via `bridgeSettleChild`);
	 *  the view itself stays a pure copy. */
	subagentViews(): SeamSubagentView[] {
		const expired = this.#expireExternalUnknowns()
		const snapshot = this.#snapshotSubagentViews()
		if (expired) this.#emitSubagentViews()
		return snapshot
	}

	/** Raw combined snapshot. External rows never enter #subagentViews. */
	#snapshotSubagentViews(): SeamSubagentView[] {
		return [
			...[...this.#subagentViews.values()].map((view) => ({ ...view })),
			...[...this.#externalSubagentViews.values()].map((view) => ({ ...view })),
		]
	}

	/** Clear every external-lifecycle cache. The caller owns the single emit. */
	#resetExternalSubagents(): boolean {
		const changed = this.#externalSubagentViews.size > 0 || this.#externalPendingSettles.size > 0
		this.#externalSubagentViews.clear()
		this.#externalPendingSettles.clear()
		this.#externalSessionId = undefined
		this.#externalUnknownAt.clear()
		this.#externalSettledIds.clear()
		this.#externalLiveIds.clear()
		if (this.#externalUnknownTimer !== undefined) {
			clearTimeout(this.#externalUnknownTimer)
			this.#externalUnknownTimer = undefined
		}
		return changed
	}

	/** Rebind external state at the actual session.open boundary, before any
	 * replay/live frame for the new parent can arrive. */
	#rebindExternalSession(sessionId: string): boolean {
		if (sessionId === this.#externalSessionId) return false
		const changed = this.#resetExternalSubagents()
		this.#externalSessionId = sessionId
		return changed
	}

	/** Fold one external spawn. Live rows anchor timeout at discovery; replay
	 * rows anchor only at durable createdAt and never synthesize a clock. */
	#foldExternalSpawn(data: Record<string, unknown>, now: number, live: boolean): boolean {
		const childId = typeof data.childId === "string" ? data.childId : ""
		if (childId === "") return false
		const label = typeof data.label === "string" && data.label !== ""
			? data.label
			: (typeof data.name === "string" && data.name !== "" ? data.name : `external ${childId.slice(0, 8)}`)
		const name = typeof data.name === "string" && data.name !== "" ? data.name : undefined
		const createdAt = typeof data.createdAt === "number" && Number.isFinite(data.createdAt)
			? data.createdAt
			: undefined
		const existing = this.#externalSubagentViews.get(childId)
		let changed = false
		if (existing === undefined) {
			this.#externalSubagentViews.set(childId, {
				id: childId, label, status: "running", rounds: 0,
				...(name !== undefined ? { name } : {}),
				...(createdAt !== undefined ? { createdAt } : {}),
				mode: "external", noTranscript: true,
			})
			if (live) {
				this.#externalLiveIds.add(childId)
				this.#externalUnknownAt.set(childId, now)
			} else if (createdAt !== undefined) {
				this.#externalUnknownAt.set(childId, createdAt)
			}
			changed = true
		} else if (existing.status === "running" && !this.#externalSettledIds.has(childId)) {
			const labelChanged = label !== existing.label
			const nameChanged = name !== undefined && name !== existing.name
			const createdChanged = createdAt !== undefined && createdAt !== existing.createdAt
			if (labelChanged || nameChanged || createdChanged) {
				this.#externalSubagentViews.set(childId, {
					...existing,
					label,
					...(name !== undefined ? { name } : {}),
					...(createdAt !== undefined ? { createdAt } : {}),
				})
				changed = true
			}
			// A replay-created running row gets ONE live-discovery anchor. Duplicate
			// live spawns cannot postpone its deadline indefinitely.
			if (live && !this.#externalLiveIds.has(childId)) {
				this.#externalLiveIds.add(childId)
				this.#externalUnknownAt.set(childId, now)
			} else if (!live && !this.#externalUnknownAt.has(childId) && createdAt !== undefined) {
				this.#externalUnknownAt.set(childId, createdAt)
			}
		}
		const pending = this.#externalPendingSettles.get(childId)
		if (pending !== undefined && !this.#externalSettledIds.has(childId)) {
			if (this.#foldExternalSettleData(childId, pending)) changed = true
		}
		this.#scheduleExternalUnknownTimer()
		return changed
	}

	/** Apply a settle only to the standalone external map. Missing spawns cache
	 * the first terminal; duplicate terminals are idempotent. */
	#foldExternalSettleData(childId: string, data: Record<string, unknown>): boolean {
		if (childId === "") return false
		const existing = this.#externalSubagentViews.get(childId)
		if (existing === undefined) {
			if (!this.#externalPendingSettles.has(childId)) {
				this.#externalPendingSettles.set(childId, { ...data })
			}
			return false
		}
		if (this.#externalSettledIds.has(childId)) return false
		const endedAt = typeof data.endedAt === "number" && Number.isFinite(data.endedAt)
			? data.endedAt
			: undefined
		const summary = typeof data.summary === "string" && data.summary !== "" ? data.summary : undefined
		this.#externalSubagentViews.set(childId, {
			...existing,
			status: bridgeExternalSettledStatus(data.stopReason),
			...(summary !== undefined ? { summary } : {}),
			...(endedAt !== undefined ? { endedAt } : {}),
		})
		this.#externalPendingSettles.delete(childId)
		this.#externalUnknownAt.delete(childId)
		this.#externalLiveIds.delete(childId)
		this.#externalSettledIds.add(childId)
		this.#capExternalSettled()
		this.#scheduleExternalUnknownTimer()
		return true
	}

	/** Keep the newest twenty terminal external rows by endedAt ?? createdAt. */
	#capExternalSettled(): void {
		const terminal = [...this.#externalSubagentViews.entries()]
			.filter(([id]) => this.#externalSettledIds.has(id))
			.map(([id, view], index) => ({ id, at: view.endedAt ?? view.createdAt ?? -Infinity, index }))
			.sort((a, b) => a.at - b.at || a.index - b.index)
		const overflow = terminal.length - EXTERNAL_SETTLED_CAP
		if (overflow <= 0) return
		for (const row of terminal.slice(0, overflow)) {
			this.#externalSubagentViews.delete(row.id)
			this.#externalUnknownAt.delete(row.id)
			this.#externalLiveIds.delete(row.id)
			this.#externalSettledIds.delete(row.id)
		}
	}

	/** Timeout is a display transition, never a fabricated settle/endedAt. */
	#expireExternalUnknowns(now = Date.now()): boolean {
		let changed = false
		for (const [id, view] of this.#externalSubagentViews) {
			if (view.status !== "running") continue
			const anchor = this.#externalUnknownAt.get(id)
			if (anchor === undefined || now - anchor < EXTERNAL_UNKNOWN_MS) continue
			this.#externalSubagentViews.set(id, { ...view, status: "unknown" })
			this.#externalUnknownAt.delete(id)
			changed = true
		}
		if (changed) this.#capExternalSettled()
		return changed
	}

	/** One unref'd timer for the earliest external timeout. Snapshot reads also
	 * expire lazily, so a suspended process converges immediately on resume. */
	#scheduleExternalUnknownTimer(): void {
		if (this.#externalUnknownTimer !== undefined) {
			clearTimeout(this.#externalUnknownTimer)
			this.#externalUnknownTimer = undefined
		}
		let deadline = Number.POSITIVE_INFINITY
		for (const anchor of this.#externalUnknownAt.values()) deadline = Math.min(deadline, anchor + EXTERNAL_UNKNOWN_MS)
		if (!Number.isFinite(deadline)) return
		const timer = setTimeout(() => {
			this.#externalUnknownTimer = undefined
			if (this.#expireExternalUnknowns()) this.#emitSubagentViews()
			this.#scheduleExternalUnknownTimer()
		}, Math.max(0, deadline - Date.now()))
		;(timer as { unref?: () => void }).unref?.()
		this.#externalUnknownTimer = timer
	}

	/** Fold the two frozen external frames without touching local child state. */
	#foldExternalFrame(frame: BridgeEventFrame): void {
		const payload = asRecord(frame.payload)
		const frameSession = typeof payload.sessionId === "string" ? payload.sessionId : ""
		if (this.#externalSessionId !== undefined && frameSession !== "" && frameSession !== this.#externalSessionId) return
		const childId = typeof payload.childId === "string" ? payload.childId : ""
		if (childId === "") return
		if (this.#externalSessionId === undefined && frameSession !== "") this.#externalSessionId = frameSession
		const changed = frame.type === "agent.external.spawn"
			? this.#foldExternalSpawn(payload, Date.now(), true)
			: this.#foldExternalSettleData(childId, payload)
		if (changed) this.#emitSubagentViews()
	}

	/**
	 * 025-w1b D — one child's buffered transcript lines for the viewer. The face
	 * is synchronous (the viewer re-reads it per tick), so lines are folded from
	 * the REAL child journal by #ensureChildJournal and cached. A child whose
	 * journal has not been read yet returns [] (honest empty, never a mock log).
	 */
	subagentTranscript(id: string): string[] {
		return [...(this.#subagentTranscripts.get(id) ?? [])]
	}

	/**
	 * LIVE TRANSCRIPT — why a child's transcript is EMPTY. The viewer uses this
	 * to distinguish "not produced yet" (running, no rows), "read failed"
	 * (journal read attempted and failed), and "not running" (settled/unknown).
	 * `ready` means real rows exist (live and/or journal baseline). Never a mock.
	 */
	subagentTranscriptStatus(id: string): SubagentTranscriptStatus {
		if (this.#externalSubagentViews.has(id)) return "not-running"
		const lines = this.#subagentTranscripts.get(id)
		if (lines !== undefined && lines.length > 0) return "ready"
		if (this.#subagentTranscriptReadFailed.has(id)) return "read-failed"
		const view = this.#subagentViews.get(id)
		if (view === undefined || view.status !== "running") return "not-running"
		return "pending"
	}

	/**
	 * 025-w1b D — steer a RUNNING child via the generated `subagents.prompt` frame
	 * (host SubagentRuntime.prompt, delivery 'steer'). The seam contract is a
	 * SYNC boolean: true when the child is known+running (reachable), false when
	 * settled/unreachable — the same shape the remote adapter's steerChild yields.
	 * The stdio frame is fire-and-forget (no await in a sync face); a host/transport
	 * rejection is contained to a warn, never a false "sent". This is DISTINCT
	 * from the binding-gated `subagents.interrupt` / `stopChildren` stop path.
	 */
	steerChild(id: string, text: string): boolean {
		if (this.#externalSubagentViews.has(id)) return false
		const view = this.#subagentViews.get(id)
		if (view === undefined || view.status !== "running") return false
		const requestId = `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
		void this.#transport.request("subagents.prompt", {
			requestId,
			childSessionId: id,
			delivery: "steer",
			content: [{ type: "text", text }],
		}).catch((err: unknown) => {
			this.#degrade("steerChild", `subagents.prompt failed: ${err instanceof Error ? err.message : String(err)}`)
		})
		return true
	}

	/**
	 * L2a: interrupt ONE running child through the bridge's subagent-stop
	 * capability (retires the D3 stub). `parentSessionId` is ALWAYS the seam's
	 * currently bound session — the bridge enforces a one-session-per-stdio-
	 * connection binding, so a child of any other session must never be named.
	 * A missing binding rejects with a clear NO_SESSION error BEFORE any frame
	 * is sent (no enumeration, no cancel).
	 *
	 * disposition: `cancel-issued`/`already-settled` resolve; `failed` rejects
	 * with the bridge detail attached. The child is registered in
	 * #interruptInFlight so sweep will not settle it — L2b's C3 owns that
	 * confirm-then-emit settle.
	 */
	async interruptChild(childId: string): Promise<void> {
		const parentSessionId = this.#currentSessionId
		if (parentSessionId === undefined || parentSessionId === "") {
			throw new BridgeProtocolError(
				"NO_SESSION",
				"cannot interrupt a subagent: no session is bound to this bridge connection",
				{ childId },
			)
		}
		const generation = ++this.#interruptGeneration
		const sessionAtStart = this.#subagentSessionId
		const external = this.#externalSubagentViews.has(childId)
		if (!external) this.#interruptInFlight.set(childId, generation)
		let value: Record<string, unknown>
		try {
			value = asRecord(await this.#transport.request("subagents.interrupt", { parentSessionId, childId }))
		} catch (err) {
			// No confirmed cancel → drop the marker so the normal sweep can
			// still converge this child (there is nothing for C3 to confirm).
			if (this.#interruptInFlight.get(childId) === generation) this.#interruptInFlight.delete(childId)
			throw err
		}
		const disposition = value.disposition
		if (disposition === "cancel-issued") {
			// External ids have no local session.list row. Only the frozen
			// agent.external.settle frame may terminalize them.
			if (!external) void this.#confirmChildStop(childId, generation, sessionAtStart)
			return
		}
		if (disposition === "already-settled") {
			// Host already terminalized it — no confirmation needed. Drop the
			// marker so sweep stays free to converge the child if it still looks
			// running in the roster.
			if (this.#interruptInFlight.get(childId) === generation) this.#interruptInFlight.delete(childId)
			return
		}
		// `failed` (and any defensive unknown disposition): no cancel was proven
		// and no confirmation coroutine owns this child, so drop the marker too —
		// sweep must stay free to converge it. Reject with the bridge detail
		// attached.
		if (this.#interruptInFlight.get(childId) === generation) this.#interruptInFlight.delete(childId)
		const detail = value.detail
		throw new BridgeProtocolError(
			"INTERRUPT_FAILED",
			`bridge failed to interrupt subagent ${childId}${typeof disposition === "string" ? ` (${disposition})` : ""}`,
			{ childId, disposition, ...(detail !== undefined ? { detail } : {}) },
		)
	}

	/**
	 * L2a: stop ALL running children of the bound parent in one frame (scoped
	 * to #currentSessionId; there is deliberately no global-stop path). Returns
	 * the bridge's `{childId, disposition}` rows verbatim so L3 can report per
	 * child. A missing binding rejects before any frame is sent.
	 */
	async stopChildren(): Promise<Array<{ childId: string; disposition: string }>> {
		const parentSessionId = this.#currentSessionId
		if (parentSessionId === undefined || parentSessionId === "") {
			throw new BridgeProtocolError(
				"NO_SESSION",
				"cannot stop children: no session is bound to this bridge connection",
			)
		}
		const value = asRecord(await this.#transport.request("subagents.stopChildren", { parentSessionId }))
		const children = value.children
		if (!Array.isArray(children)) return []
		const sessionAtStart = this.#subagentSessionId
		const rows = children.map((row) => {
			const r = asRecord(row)
			return {
				childId: typeof r.childId === "string" ? r.childId : "",
				disposition: typeof r.disposition === "string" ? r.disposition : "failed",
			}
		})
		// C3: one independent confirmation coroutine per issued cancel. A failed
		// sibling never blocks or cancels another's confirmation (each is `void`
		// with its own generation + try/catch). `already-settled`/`failed` rows
		// start no coroutine — the host already terminalized them, or no cancel
		// was proven (the normal sweep may still converge the latter).
		for (const row of rows) {
			if (row.disposition !== "cancel-issued" || row.childId === "") continue
			// External rows have no local session.list/journal terminal. Keep the
			// response shape, but let only agent.external.settle settle the row.
			if (this.#externalSubagentViews.has(row.childId)) continue
			const generation = ++this.#interruptGeneration
			this.#interruptInFlight.set(row.childId, generation)
			void this.#confirmChildStop(row.childId, generation, sessionAtStart)
		}
		return rows
	}

	/**
	 * L2b C3 — confirm-then-emit for one user-stopped child. Never throws (called
	 * fire-and-forget from interruptChild/stopChildren). Three outcomes:
	 *   ① host reports running===false → read the REAL reason from the child
	 *      journal and settle exactly once through #settleChildFromHost;
	 *   ② deadline reached while still running → NO settle, drop only this
	 *      child's marker so the turn-boundary #sweepSubagents fallback converges
	 *      it later, with a debug log (no journal/body text);
	 *   ③ binding/generation changed (rebind / dispose / a newer interrupt on
	 *      the same child) → abandon with NO settle and NO emit.
	 * The generation is captured per child at issue time (the value stored in
	 * #interruptInFlight), plus the binding session id — the same sessionAtStart
	 * pattern #ensureChildJournal uses. A rebind clears the marker map (L2a) and
	 * bumps #interruptGeneration, so both guards fire for a stale coroutine.
	 */
	async #confirmChildStop(childId: string, generation: number, sessionAtStart: string | undefined): Promise<void> {
		const clock = this.#confirmClock
		const deadlineAt = clock.now() + CONFIRM_TIMEOUT_MS
		let delayMs = CONFIRM_POLL_INITIAL_MS
		try {
			for (;;) {
				await clock.sleep(delayMs)
				// Guard BEFORE every RPC: a stale coroutine must not even poll.
				if (this.#disposed || this.#subagentSessionId !== sessionAtStart
					|| this.#interruptInFlight.get(childId) !== generation) return

				let stopped = false
				try {
					// Reuse the seam's existing list capability (same frame as
					// #sweepSubagents); a failed/malformed read is NOT a stop.
					const items = asRecord(await this.#transport.request("session.list", { _request: {} })).items
					if (Array.isArray(items)) {
						stopped = items.some((row) => {
							const item = asRecord(row)
							return item.sessionId === childId && item.running === false
						})
					}
				} catch {
					/* best-effort poll: try again until the deadline */
				}
				// Guard AGAIN after the await — a rebind during the poll wins.
				if (this.#disposed || this.#subagentSessionId !== sessionAtStart
					|| this.#interruptInFlight.get(childId) !== generation) return

				if (stopped) {
					let reason = "aborted" // degradation: no readable terminal in the child journal
					try {
						const rows = asRecord(await this.#transport.request("journal.replay", { sessionId: childId })).rows
						if (Array.isArray(rows)) {
							const clean = rows.filter(
								(row): row is BridgeReplayRow => row !== null && typeof row === "object" && !Array.isArray(row),
							)
							reason = bridgeChildStopReason(clean) ?? "aborted"
						}
					} catch {
						/* a journal read failure degrades to "aborted", never a fake success */
					}
					if (this.#disposed || this.#subagentSessionId !== sessionAtStart
						|| this.#interruptInFlight.get(childId) !== generation) return
					this.#settleChildFromHost(childId, reason, clock.now())
					return
				}

				if (clock.now() >= deadlineAt) {
					// Timeout: do NOT invent a terminal. Drop only this marker so
					// the turn-boundary sweep can settle from a later host snapshot.
					if (this.#interruptInFlight.get(childId) === generation) this.#interruptInFlight.delete(childId)
					this.#ctx.logger.debug?.(
						"[bridge-seam] subagent stop confirm timed out (child=%s, generation=%d, after=%dms); "
						+ "clearing in-flight marker for turn sweep",
						childId, generation, CONFIRM_TIMEOUT_MS,
					)
					return
				}
				delayMs = Math.min(CONFIRM_POLL_MAX_MS, delayMs * 2)
			}
		} catch {
			/* defensive: a malformed reply must never leave an unhandled void rejection */
		}
	}

	/**
	 * 0.23.0 P1: post-fold hook — freeze the FIRST settle of every run key and
	 * restore that frozen snapshot on any later re-settle. `before` holds the
	 * startedAt of each child that was RUNNING before the fold. A replay re-fold
	 * revives a settled catalog child (rounds reset, startedAt rebuilt) and then
	 * re-settles it with `now`; without this the settled elapsedSec/endedAt grow
	 * every turn boundary (真机 c5c9a073 109.3s→224.1s). Remote freezes on settle
	 * (session-seam-adapter.ts:715-721) — so do we.
	 */
	#freezeSettles(before: ReadonlyMap<string, number | undefined>): void {
		for (const [childId, startedAt] of before) {
			const view = this.#subagentViews.get(childId)
			if (view === undefined || view.status === "running") continue
			// maxRounds: this run is terminal. Forget its latches so a later
			// catalog revive of the SAME childId (a new run) gets a fresh ladder.
			this.#roundPolicy?.forgetChild(childId)
			if (view.elapsedSec === undefined || view.endedAt === undefined) continue
			const runKey = `${childId}@${startedAt ?? ""}`
			const frozen = this.#subagentSettleSnapshots.get(runKey)
			if (frozen !== undefined) {
				this.#subagentViews.set(childId, bridgeRestoreSettled(view, frozen))
			} else {
				// First settle of this run — freeze it. Later re-folds restore it.
				this.#subagentSettleSnapshots.set(runKey, {
					status: view.status, elapsedSec: view.elapsedSec, endedAt: view.endedAt,
				})
			}
		}
	}

	/** Fold ONE agent record through the shared projector AND freeze/restore the
	 *  settle snapshot. ALL roster folds route through here so a re-settle from
	 *  any source (durable row / live frame / sweep) honours the frozen clock. */
	#foldWithFrozenSettle(
		type: string, data: Record<string, unknown>, now: number, live: boolean,
	): boolean {
		const before = new Map<string, number | undefined>()
		for (const [id, v] of this.#subagentViews) {
			if (v.status === "running") before.set(id, v.startedAt)
		}
		const changed = bridgeFoldAgentRecord(
			this.#subagentViews, this.#subagentRunSeq, this.#subagentLiveStarts,
			type, data, now, live,
		)
		if (changed) this.#freezeSettles(before)
		return changed
	}

	/**
	 * T1: sweep the host session registry at a turn terminal / recovery, mirroring
	 * remote `refreshFromList()`. Only an explicit `origin:"subagent"` row of THIS
	 * parent whose host `running===false` and whose catalog row is still running
	 * is settled — through the SAME catalog settle branch (`user/message`
	 * source.kind=subagent-settled → `bridgeSettleChild`) the durable notice
	 * uses, so status/rounds/lastLine/model/elapsed stay in sync.
	 * Best-effort: a failed/malformed `session.list` read leaves the roster
	 * UNCHANGED (never an empty-list "all settled" inference).
	 */
	async #sweepSubagents(parentId: string): Promise<void> {
		let value: unknown
		try {
			value = await this.#transport.request("session.list", { _request: {} })
		} catch {
			/* best-effort: the journal pairing covers the rest */
			return
		}
		const items = asRecord(value).items
		if (!Array.isArray(items)) return // malformed reply ≠ empty registry
		const locallyRunning = new Set<string>()
		for (const view of this.#subagentViews.values()) {
			if (view.status === "running") locallyRunning.add(view.id)
		}
		const toSettle = bridgeSweepSettledChildIds(items, parentId, locallyRunning)
		if (toSettle.length === 0) return
		const now = Date.now()
		let changed = false
		for (const childId of toSettle) {
			// L2a P1-1: a child with an interrupt in flight belongs to C3's
			// confirm-then-emit path, NOT to the sweep's conservative
			// "completed" projection. Skip it entirely — no settle, no sticky,
			// so the real interrupt reason from the child journal wins.
			if (this.#interruptInFlight.has(childId)) continue
			if (this.#settleChildFromHost(childId, "completed", now, false)) changed = true
		}
		if (changed) {
			// Restore cached meta / frozen settle BEFORE the single emit so the
			// panel never sees a transient rounds=0 (P2b). The single emit is
			// kept here (emit=false above) to preserve the exact 0.23.0 behavior.
			this.#emitSubagentViews()
		}
	}

	/**
	 * L2a: the shared settle three-beat for a host-confirmed child terminal,
	 * extracted from the 0.23.0 registry sweep so sweep / L2b C3 / recovery all
	 * converge on ONE path:
	 *   ① record the pre-settle run key into #sweepSettledRuns (sticky against a
	 *      later catalog revive that carries no journal settle row),
	 *   ② fold the synthetic `user/message subagent-settled` row through
	 *      #foldWithFrozenSettle (freezes elapsedSec/endedAt/status),
	 *   ③ #syncSubagentMeta(false) restores cached meta BEFORE a single emit.
	 * `stopReason` is the real host reason when C3 supplies one; sweep keeps
	 * passing the conservative "completed". `emit=false` lets a multi-child
	 * caller batch its own single emit. Returns true iff the roster changed.
	 */
	#settleChildFromHost(childId: string, stopReason: unknown, now = Date.now(), emit = true): boolean {
		// ① Remember the run BEFORE settle drops startedAt (aborted-parent case).
		const existing = this.#subagentViews.get(childId)
		if (existing !== undefined) this.#sweepSettledRuns.set(childId, bridgeChildJournalKey(existing))
		// ② Catalog settle by childId — the SAME convergence branch the durable
		// `user/message source.kind=subagent-settled` notice uses. No wall-clock
		// fallback: the host's terminal evidence is the only settle input.
		const changed = this.#foldWithFrozenSettle("user/message", {
			source: { kind: BRIDGE_SUBAGENT_SETTLED, stopReason, senderSessionId: childId },
		}, now, false)
		if (changed) {
			// ③ Restore cached meta / frozen settle BEFORE the emit (P2b).
			this.#syncSubagentMeta(false)
			if (emit) this.#emitSubagentViews()
		}
		// A host-confirmed settle ends this child's in-flight interrupt (C3
		// calls this with the real reason, closing the handoff cleanly).
		this.#interruptInFlight.delete(childId)
		return changed
	}

	/**
	 * T2: lazily read one child's journal via the read-only `journal.replay` RPC
	 * (the bridge opens `sessionPersistence.open(id,'read')`). Failure or a
	 * malformed reply keeps the existing degraded view — NEVER a zeroed one.
	 *
	 * COST (P2-3d): per child binding at most 2 FULL journal drains — one for the
	 * running view (`id@<startedAt>`) and one after settle (`id@""`, because
	 * bridgeSettleChild drops startedAt) to pick up terminal rounds/lastLine/model.
	 * The cache key deliberately encodes startedAt so a settle invalidates the
	 * first read and forces that second, terminal-value re-read (P1-3a); a catalog
	 * revive (new startedAt) likewise starts a fresh run with a fresh key.
	 */
	async #ensureChildJournal(childId: string, startedAt: number | undefined): Promise<void> {
		const key = `${childId}@${startedAt ?? ""}`
		if (this.#subagentJournalLoaded.has(key)) return
		this.#subagentJournalLoaded.add(key)
		// P3: a session switch while the read is in flight must not let a stale
		// response seed this binding's meta cache with another session's data.
		const sessionAtStart = this.#subagentSessionId
		try {
			const value = asRecord(await this.#transport.request("journal.replay", { sessionId: childId }))
			const rows = value.rows
			if (!Array.isArray(rows)) {
				// LIVE TRANSCRIPT: an attempted-but-unreadable journal is a distinct
				// empty state; never pretend it is "no activity yet".
				this.#subagentTranscriptReadFailed.add(childId)
				return // malformed read ≠ empty journal
			}
			// P2-3d: a defensive read may carry null / non-object entries; drop them
			// before bridgeChildJournalMeta reads `.payload` off each row (a null row
			// would otherwise throw and silently degrade the whole child's meta).
			const cleanRows = rows.filter(
				(row): row is BridgeReplayRow => row !== null && typeof row === "object" && !Array.isArray(row),
			)
			const meta = bridgeChildJournalMeta(cleanRows)
			// P3: drop a response that arrived after a binding change (or dispose).
			if (this.#subagentSessionId !== sessionAtStart || this.#disposed) return
			// 025-w1b D — fold the same real rows into the viewer's transcript
			// lines (sync face reads this cache; never a fabricated log).
			// LIVE TRANSCRIPT: FIRST journal replay is the baseline; a later
			// terminal re-read OVERWRITES it (never appends) because the journal
			// is authoritative after settle. A new baseline starts a fresh seen-set.
			this.#subagentTranscripts.set(childId, capChildLog(splitChildLogLines(bridgeReplayRowsToChildLog(cleanRows))))
			this.#subagentTranscriptReadFailed.delete(childId)
			this.#subagentTranscriptRuns.delete(childId)
			// Cache by run key even if the view changed in flight: a replay re-fold
			// can revisit this run later and needs the meta to restore rounds.
			this.#subagentJournalMeta.set(key, meta)
			const existing = this.#subagentViews.get(childId)
			// Guard against a binding change / settle while the read was in flight.
			if (existing === undefined || bridgeChildJournalKey(existing) !== key) return
			this.#subagentViews.set(childId, {
				...existing,
				rounds: meta.rounds,
				...(meta.lastLine !== undefined ? { lastLine: meta.lastLine } : {}),
				...(meta.model !== undefined ? { model: meta.model } : {}),
			})
			this.#emitSubagentViews()
		} catch {
			// LIVE TRANSCRIPT: record the failed read so the viewer can say
			// "read failed" instead of "no activity yet". Existing lines (if any)
			// are kept — a failed read never wipes a real baseline.
			this.#subagentTranscriptReadFailed.add(childId)
			/* best-effort: keep rounds=0 / no model / no lastLine degradation */
		}
	}

	/**
	 * Post-fold sync — called after EVERY roster fold (live frame, replay drain,
	 * recovery, sweep). Jobs, in order:
	 *  ① RE-ASSERT SWEEP SETTLES: a `subagent/catalog` row re-folded from the
	 *     durable journal revives a settled child (catalog family revive rule),
	 *     and a sweep settle has NO journal settle row to undo it. Restore the
	 *     FROZEN settle snapshot (status/elapsedSec/endedAt) rather than folding
	 *     with the current clock — no wall-clock growth, no revive flashback.
	 *  ② RESTORE JOURNAL META: the same revive+settle re-fold rebuilds the view
	 *     with `rounds:0` and no `lastLine`; re-apply cached meta (P2b: while the
	 *     `id@""` terminal read has not landed, fall back to the prior run-key
	 *     meta so no transient rounds=0 is emitted).
	 *  ③ QUEUE READS for runs whose journal has not been attempted yet.
	 * `emit=false` lets a caller restore before its own single emit (no transient).
	 */
	#syncSubagentMeta(emit = true): void {
		let changed = false
		if (this.#sweepSettledRuns.size > 0) {
			for (const view of [...this.#subagentViews.values()]) {
				if (view.status !== "running") continue
				const recordedKey = this.#sweepSettledRuns.get(view.id)
				if (recordedKey === undefined) continue
				const key = bridgeChildJournalKey(view)
				if (key !== recordedKey) {
					// P2a: the sweep observed a different start clock than this
					// replay (missing childCreatedAt → live client clock vs replay
					// fold clock). Visible in acceptance logs; the real host rows
					// all carry childCreatedAt, so this is a defensive signal.
					this.#degradeOnce("sweep-sticky-run-key-mismatch",
						`sweep settle run key ${recordedKey} != replay key ${key} for ${view.id}`)
					continue
				}
				const frozen = this.#subagentSettleSnapshots.get(recordedKey)
				if (frozen !== undefined) {
					this.#subagentViews.set(view.id, bridgeRestoreSettled(view, frozen))
					changed = true
				} else {
					// Defensive: a sweep settle always freezes a snapshot; if one is
					// missing, fall back to the shared frozen fold (still no new clock
					// is invented for a child we have never settled before).
					if (this.#foldWithFrozenSettle("user/message", {
						source: { kind: BRIDGE_SUBAGENT_SETTLED, stopReason: "completed", senderSessionId: view.id },
					}, Date.now(), false)) changed = true
				}
			}
		}
		for (const view of [...this.#subagentViews.values()]) {
			const key = bridgeChildJournalKey(view)
			// P2b: `id@""` (settled) has no cached terminal meta until the re-read
			// lands — borrow the most recent prior RUN key's meta (same child run,
			// real journal data) so ctrl+g never flashes rounds=0.
			const exactMeta = this.#subagentJournalMeta.get(key)
			const meta = exactMeta
				?? (key === `${view.id}@` ? this.#priorRunMeta(view.id) : undefined)
			// B3 — LIVE PROGRESS (②b): a RUNNING child's rounds/tail come from
			// `agent.progress` frames, which are RUNTIME updates layered on top of
			// the spawn-time journal baseline. Re-apply them AFTER the meta restore
			// above so a later fold cannot freeze them back to rounds=0 / no tail
			// (the exact defect B3 fixes). Settled rows have NO progress entry (the
			// terminal journal read is authoritative), so this never touches终态.
			const progress = view.status === "running" ? this.#subagentProgress.get(view.id) : undefined
			if (meta !== undefined || progress !== undefined) {
				const restored: SeamSubagentView = {
					...view,
					rounds: progress !== undefined
						? Math.max(view.rounds, progress.rounds)
						: (meta?.rounds ?? view.rounds),
					...(progress?.lastLine !== undefined
						? { lastLine: progress.lastLine }
						: meta?.lastLine !== undefined ? { lastLine: meta.lastLine } : {}),
					...(meta?.model !== undefined ? { model: meta.model } : {}),
					...(progress?.elapsedSec !== undefined ? { elapsedSec: progress.elapsedSec } : {}),
				}
				if (restored.rounds !== view.rounds || restored.lastLine !== view.lastLine
					|| restored.model !== view.model || restored.elapsedSec !== view.elapsedSec) {
					this.#subagentViews.set(view.id, restored)
					changed = true
				}
			}
			// A settled / non-running child carries no live progress — drop any
			// stale entry so a catalog revive (new run) starts from a clean slate.
			if (view.status !== "running" && this.#subagentProgress.has(view.id)) {
				this.#subagentProgress.delete(view.id)
			}
			// Schedule the terminal read EVEN when a borrowed prior-run meta covers
			// the gap — the fallback is only a bridge, never a substitute for the
			// settled-key FULL journal read (P1-3a).
			if (exactMeta === undefined && !this.#subagentJournalLoaded.has(key)) {
				void this.#ensureChildJournal(view.id, view.startedAt)
			}
		}
		if (changed && emit) this.#emitSubagentViews()
	}

	/** P2b: the latest cached journal meta for any RUN key (`id@<startedAt>`) of
	 *  this child — used only as the settled-key bridge while its terminal read
	 *  is pending. Never fabricates data: the meta came from a real child-journal
	 *  read of the same run. */
	#priorRunMeta(childId: string): BridgeChildJournalMeta | undefined {
		const prefix = `${childId}@`
		let best: BridgeChildJournalMeta | undefined
		let bestStart = -Infinity
		for (const [key, meta] of this.#subagentJournalMeta) {
			if (!key.startsWith(prefix)) continue
			const suffix = key.slice(prefix.length)
			if (suffix === "") continue
			const start = Number(suffix)
			if (Number.isFinite(start) && start > bestStart) {
				bestStart = start
				best = meta
			}
		}
		return best
	}

	/** Push listener (the seam-rows tree row + /subagents viewer subscribe here).
	 *  Replays the current snapshot immediately for a late subscriber. */
	onSubagentViews(listener: (views: SeamSubagentView[]) => void): () => void {
		this.#subagentListeners.add(listener)
		listener(this.subagentViews())
		return () => {
			this.#subagentListeners.delete(listener)
		}
	}

	/** Emit the current snapshot to every listener; one stale UI listener is contained. */
	#emitSubagentViews(): void {
		if (this.#subagentListeners.size === 0) return
		const snapshot = this.subagentViews()
		for (const listener of [...this.#subagentListeners]) {
			try {
				listener(snapshot)
			} catch {
				/* a UI listener must never take the event pump down */
			}
		}
	}

	/**
	 * Fold an additive `agent.spawn`/`agent.settle` frame through the SAME pure
	 * projector the replay path uses. Live frames carry a real wall clock, so a
	 * spawn registers with `Date.now()` and a settle freezes the true duration.
	 */
	#foldAgentFrame(frame: BridgeEventFrame): void {
		const payload = asRecord(frame.payload)
		// Defensive session filter: a stale frame from a replaced binding must not
		// pollute the current roster (the bridge already filters by active turn;
		// this is the seam-side backstop for the replay boundary).
		const frameSession = typeof payload.sessionId === "string" ? payload.sessionId : ""
		if (this.#subagentSessionId !== undefined && frameSession !== "" && frameSession !== this.#subagentSessionId) return
		const now = Date.now()
		let changed = false
		if (frame.type === "agent.spawn") {
			// 0.23.1 live-visibility fix: the bridge forwards a plain `subagent`
			// catalog event as an additive spawn whose runId is the catalog-family
			// synthetic key (`catalog:<childId>`). Folding it as a tool-workflow
			// agent-start hits the P3-1 collision guard (viaCatalog!==true) and
			// silently returns false — the roster then only filled on the next
			// journal drain, so a running child was invisible in ctrl+g. Route the
			// catalog-keyed spawn through the catalog branch, which marks its own
			// synthesized start with viaCatalog and inserts the running row.
			const runId = typeof payload.runId === "string" ? payload.runId : ""
			const childId = typeof payload.childId === "string" ? payload.childId : ""
			// LIVE TRANSCRIPT: a spawn of this child is a NEW run — revoke the
			// settle lock AND the old run's seen-set so a re-spawned child whose
			// seq restarts at 0 in the SAME parent turn is not deduped away (the
			// journal baseline for the new run is re-read by #ensureChildJournal).
			if (childId !== "") {
				this.#subagentTranscriptRuns.delete(childId)
				this.#subagentTranscriptSettled.delete(childId)
				this.#subagentTranscriptReadFailed.delete(childId)
			}
			// Bind the roster to the parent session on the first live spawn so a
			// foreign transcript frame cannot claim the binding before any valid
			// live/replay frame establishes it (same rule as the settle path).
			if (this.#subagentSessionId === undefined && frameSession !== "") {
				this.#subagentSessionId = frameSession
			}
			changed = runId === `${BRIDGE_CATALOG_RUN_PREFIX}${childId}`
				? this.#foldWithFrozenSettle(BRIDGE_SUBAGENT_CATALOG, payload, now, true)
				: this.#foldWithFrozenSettle(BRIDGE_AGENT_START, payload, now, true)
		} else if (frame.type === "agent.settle") {
			// P1-1 (revive): a live settle is terminal for THIS run but carries no
			// journal notice, so a later catalog-only re-fold (turn-end
			// storedTranscript / sessionInfo incremental / session.list fallback)
			// would revive the row via the catalog-family revive rule. Register the
			// PRE-settle run key into the SAME sticky map sweep/C3 use
			// (#settleChildFromHost step ①) so #syncSubagentMeta re-asserts the
			// frozen settle after any such re-fold. No new state, #subagentJournalLoaded
			// guard and the journal terminal authority are untouched; the fold itself
			// (and therefore the outcome mapping) is unchanged. Only a running child
			// is registered — an already-settled row has no `startedAt` and would
			// register a mismatching `id@` key.
			const childId = typeof payload.childId === "string" ? payload.childId : ""
			const existing = childId !== "" ? this.#subagentViews.get(childId) : undefined
			// LIVE TRANSCRIPT: freeze live appends from this terminal on. A parent
			// `tool-workflow/agent-end` may omit childId — pair it through the same
			// runSeq key the lifecycle fold uses, so both settle paths agree.
			const lockedChild = childId !== ""
				? childId
				: this.#subagentRunSeq.get(bridgeAgentRunKey(
					typeof payload.runId === "string" ? payload.runId : "",
					typeof payload.seq === "number" ? payload.seq : -1,
				))
			if (lockedChild !== undefined) this.#subagentTranscriptSettled.add(lockedChild)
			if (existing !== undefined && existing.status === "running") {
				// A live settle can arrive BEFORE any journal fold has established
				// #subagentSessionId (turn-external child terminal). Bind it from the
				// frame here so the first catalog-only replay of THIS SAME session is
				// not mistaken for a session switch by #foldAgentReplayRows — that
				// switch clears #sweepSettledRuns and would drop the sticky settle.
				if (this.#subagentSessionId === undefined && frameSession !== "") {
					this.#subagentSessionId = frameSession
				}
				this.#sweepSettledRuns.set(childId, bridgeChildJournalKey(existing))
			}
			changed = this.#foldWithFrozenSettle(BRIDGE_AGENT_END, payload, now, true)
		}
		if (changed) {
			// Restore first, emit once — no transient rounds=0 (P2b).
			this.#syncSubagentMeta(false)
			this.#emitSubagentViews()
		}
	}

	/**
	 * The round ladder's runtime consumer. Created lazily so a session with no
	 * child progress pays nothing. The two knobs are read LIVE from the profile
	 * config.json through the local config face — `parseSubagentRoundLimits`
	 * owns the unset→50/0 and explicit-0-disables rules; no settings-ns provider
	 * is consulted (the retired plugin face answered defaults forever).
	 *
	 * Delivery rides the seam's REAL child faces: the wrap-up goes out through
	 * `steerChild` (subagents.prompt, delivery 'steer') with the policy's own
	 * canonical `wrapupMessage`, and the force-stop through `interruptChild`
	 * (subagents.interrupt + confirm-then-emit settle). The policy's F6 hooks
	 * land the markers in the canonical view so they survive meta sync / settle
	 * and reach every onSubagentViews subscriber.
	 */
	#ensureRoundPolicy(): SubagentRoundPolicy {
		if (this.#roundPolicy === undefined) {
			this.#roundPolicy = new SubagentRoundPolicy({
				limits: () => parseSubagentRoundLimits(this.configLoad()),
				// A settled child is terminal for this run — never re-awaken it
				// with a wrap-up or a force-stop (re-checked at the deferred
				// wrap-up flush too, in case it settled in the same tick).
				isSettled: (childId) => {
					const view = this.#subagentViews.get(childId)
					return view === undefined || view.status !== "running"
				},
				wrapup: (childId, message) => this.steerChild(childId, message),
				// A resolved interrupt issued a stop; a rejection (no binding /
				// failed disposition) reports that nothing was stopped.
				forceStop: (childId) => this.interruptChild(childId).then(() => true, () => false),
				onWrapUp: (childId, round) => this.#markRoundPolicy(childId, "injectedRound", round),
				onForceStop: (childId, round) => this.#markRoundPolicy(childId, "hardStopRound", round),
				onSpinStop: (childId, round) => this.#markRoundPolicy(childId, "spinStopRound", round),
			})
		}
		return this.#roundPolicy
	}

	/** Drop the policy on a binding change/dispose so a deferred wrap-up can
	 *  never land on the next session's roster. */
	#resetRoundPolicy(): void {
		this.#roundPolicy?.dispose()
		this.#roundPolicy = undefined
	}

	/** Land one policy marker in the canonical view (first latch wins) and
	 *  push it through the existing onSubagentViews emit path. */
	#markRoundPolicy(
		childId: string,
		field: "injectedRound" | "hardStopRound" | "spinStopRound",
		round: number,
	): void {
		const view = this.#subagentViews.get(childId)
		if (view === undefined || view[field] !== undefined) return
		const next: SeamSubagentView = { ...view }
		if (field === "injectedRound") next.injectedRound = round
		else if (field === "hardStopRound") next.hardStopRound = round
		else next.spinStopRound = round
		this.#subagentViews.set(childId, next)
		this.#emitSubagentViews()
	}

	/**
	 * B3 — fold an additive `agent.progress` frame (host live rounds/tail).
	 * RUNTIME update only: never mints a row, never touches a settled child,
	 * keyed by childId. The `#subagentJournalLoaded` one-time guard is untouched —
	 * the journal snapshot stays the initial baseline and progress carries the
	 * values forward while the child runs. Stored in `#subagentProgress` and laid
	 * on top of the journal baseline by `#syncSubagentMeta` on every fold so a
	 * later replay fold cannot freeze rounds/tail back to the spawn-time zero.
	 */
	#foldAgentProgress(frame: BridgeEventFrame): void {
		const payload = asRecord(frame.payload)
		// Same stale-binding backstop as #foldAgentFrame.
		const frameSession = typeof payload.sessionId === "string" ? payload.sessionId : ""
		if (this.#subagentSessionId !== undefined && frameSession !== "" && frameSession !== this.#subagentSessionId) return
		const childId = typeof payload.childId === "string" ? payload.childId : ""
		const rounds = typeof payload.rounds === "number" && Number.isFinite(payload.rounds)
			? Math.max(0, Math.floor(payload.rounds))
			: undefined
		if (childId === "" || rounds === undefined) return
		const view = this.#subagentViews.get(childId)
		// No ghost rows; settle terminal is authoritative — progress never writes
		// to a settled (or unknown) child.
		if (view === undefined || view.status !== "running") return
		const lastLine = typeof payload.lastLine === "string" ? payload.lastLine : undefined
		const elapsedSec = typeof payload.elapsedSec === "number" && Number.isFinite(payload.elapsedSec)
			? payload.elapsedSec
			: undefined
		const prev = this.#subagentProgress.get(childId)
		const merged: { rounds: number; lastLine?: string; elapsedSec?: number } = {
			rounds: Math.max(prev?.rounds ?? 0, rounds),
			...(lastLine !== undefined ? { lastLine } : prev?.lastLine !== undefined ? { lastLine: prev.lastLine } : {}),
			...(elapsedSec !== undefined ? { elapsedSec } : prev?.elapsedSec !== undefined ? { elapsedSec: prev.elapsedSec } : {}),
		}
		this.#subagentProgress.set(childId, merged)
		// Drive the ladder ONLY when the round count actually grew. The policy
		// latches per child; duplicate frames at the same round must not retry a
		// delivery or re-enter the ladder.
		if (merged.rounds > (prev?.rounds ?? 0)) {
			this.#ensureRoundPolicy().onRoundCount(childId, merged.rounds, view.label)
		}
		// Restore first, emit once — no transient rounds=0 (P2b).
		this.#syncSubagentMeta(false)
		this.#emitSubagentViews()
	}

	/**
	 * LIVE TRANSCRIPT — append one additive `agent.transcript` frame to the
	 * child's viewer log. Dedupe identity is (childId, runId, turnId, seq):
	 * duplicate frames (e.g. a replayed stdio frame) never double-paint; a new
	 * child run OR parent-turn epoch opens a fresh seen-set even when `seq`
	 * restarts at 0. At least one of runId/turnId must identify the frame; an
	 * idle parent turn (turnId="") remains valid when runId is non-empty. A
	 * settled or unknown child is refused — after settle the journal read is
	 * the only authority. Both caps are enforced on every append.
	 */
	#foldAgentTranscript(frame: BridgeEventFrame): void {
		const payload = asRecord(frame.payload)
		const frameSession = typeof payload.sessionId === "string" ? payload.sessionId : ""
		const childId = typeof payload.childId === "string" ? payload.childId : ""
		const turnId = typeof payload.turnId === "string" ? payload.turnId : ""
		const runId = typeof payload.runId === "string" ? payload.runId : ""
		const seq = typeof payload.seq === "number" && Number.isFinite(payload.seq) ? payload.seq : -1
		const rows = payload.rows
		if (childId === "" || (runId === "" && turnId === "") || seq < 0 || !Array.isArray(rows)) return
		if (this.#subagentTranscriptSettled.has(childId)) return
		const view = this.#subagentViews.get(childId)
		// No ghost rows: only a currently RUNNING child of this binding accepts
		// live transcript rows (receiver law — this is a class method).
		if (view === undefined || view.status !== "running") return
		// Parent-session isolation: this roster is bound to one parent session.
		// A live transcript frame for a RUNNING child must carry that sessionId.
		// When no replay/spawn has established the binding yet, bind from this
		// first valid live frame; any later foreign sessionId is refused so a
		// different session's child cannot leak rows into this child's log.
		if (this.#subagentSessionId === undefined) {
			if (frameSession !== "") this.#subagentSessionId = frameSession
		} else if (frameSession !== "" && frameSession !== this.#subagentSessionId) return
		let run = this.#subagentTranscriptRuns.get(childId)
		if (run === undefined || run.runId !== runId || run.turnId !== turnId) {
			run = { runId, turnId, seen: new Set<number>() }
			this.#subagentTranscriptRuns.set(childId, run)
		}
		if (run.seen.has(seq)) return
		run.seen.add(seq)
		const lines = [...(this.#subagentTranscripts.get(childId) ?? [])]
		for (const row of rows) {
			const line = childTranscriptRowToLine(row)
			if (line !== "") lines.push(line)
		}
		this.#subagentTranscripts.set(childId, capChildLog(splitChildLogLines(lines)))
		this.#subagentTranscriptReadFailed.delete(childId)
		this.#emitSubagentViews()
	}

	/**
	 * Derive subagent rows from durable journal rows (replay / recovery / the
	 * sessionInfo incremental drain), for the SAME session only. A binding change
	 * clears the old session's map so a /new or a different replay target cannot
	 * pollute the live roster. Re-folding the FULL log is idempotent: rows apply
	 * in seq order, so the last terminal/spawn for a child decides its state.
	 * Catalog-family rows may revive a settled child (a new catalog = a new run,
	 * journal order is unambiguous); the tool-workflow family keeps its no-revive
	 * guard. Repeated `storedTranscript` sweeps stay safe.
	 */
	#foldAgentReplayRows(rows: readonly BridgeReplayRow[], sessionId: string): void {
		let rosterReset = false
		if (sessionId !== this.#subagentSessionId) {
			this.#subagentViews.clear()
			this.#subagentRunSeq.clear()
			this.#subagentLiveStarts.clear()
			this.#subagentProgress.clear() // B3: live progress belongs to the old binding
			this.#resetRoundPolicy() // maxRounds: latches belong to the old binding
			this.#subagentJournalLoaded.clear()
			this.#subagentJournalMeta.clear()
			this.#subagentTranscripts.clear() // 025-w1b D: transcripts belong to the old binding
			this.#subagentTranscriptRuns.clear() // LIVE TRANSCRIPT: dedupe/order belong to the old binding
			this.#subagentTranscriptSettled.clear()
			this.#subagentTranscriptReadFailed.clear()
			this.#sweepSettledRuns.clear()
			this.#subagentSettleSnapshots.clear()
			this.#interruptInFlight.clear() // L2a: in-flight interrupts belong to the old binding
			this.#interruptGeneration += 1 // L2b C3: invalidate every in-flight confirm coroutine on rebind
			this.#subagentSessionId = sessionId
			rosterReset = true
		}
		if (sessionId !== this.#externalSessionId) {
			if (this.#rebindExternalSession(sessionId)) rosterReset = true
			rosterReset = true
		}
		let changed = false
		const now = Date.now()
		// Pre-scan ownership so an exact settle row can be routed external even
		// when it appears before its catalog row in a malformed/out-of-order log.
		const externalIds = new Set<string>()
		for (const row of rows) {
			const data = asRecord(row.payload)
			if (row.type === BRIDGE_SUBAGENT_CATALOG && data.mode === "external" && typeof data.childId === "string") {
				externalIds.add(data.childId)
			}
		}
		for (const row of rows) {
			const data = asRecord(row.payload)
			if (row.type === BRIDGE_SUBAGENT_CATALOG && data.mode === "external") {
				if (this.#foldExternalSpawn(data, now, false)) changed = true
				continue
			}
			if (row.type === "user/message") {
				const source = asRecord(data.source)
				if (source.kind === BRIDGE_SUBAGENT_SETTLED) {
					const childId = typeof source.senderSessionId === "string" ? source.senderSessionId : ""
					if (childId !== "" && (externalIds.has(childId) || this.#externalSubagentViews.has(childId))) {
						if (this.#foldExternalSettleData(childId, source)) changed = true
						continue
					}
				}
			}
			if (this.#foldWithFrozenSettle(row.type, data, now, false)) changed = true
		}
		if (this.#expireExternalUnknowns(now)) changed = true
		// P3-2: a session switch must repaint the roster EVEN IF the new session
		// has no agent rows — otherwise a mounted viewer keeps the old session's
		// rows until the next live frame / replay that actually changes the map.
		if (rosterReset || changed) {
			// Restore first, emit once — no transient rounds=0 (P2b).
			this.#syncSubagentMeta(false)
			this.#emitSubagentViews()
		}
	}

	// ----- config faces (S5 — REAL local reads/writes, no degrade, no mock) --
	//
	// The client owns the `opentui-monday` profile files (DEFAULT_PROFILE, $DSH_HOME),
	// exactly the files verify70 reads/writes and the legacy seam used. The in-process host mounts no settingsController/config service, so local file I/O
	// is the honest real implementation — never the old `{}` degrade. Field-level
	// whitelist projection lives in LocalConfigStore (oldfox S4 §六.2/§六.3).
	configLoad(): Record<string, unknown> {
		return this.#configStore.configLoad()
	}

	configRaw(): Record<string, unknown> {
		return this.#configStore.configRaw()
	}

	workspaceConfig(): Record<string, unknown> {
		return this.#configStore.workspaceConfig()
	}

	configSave(patch: Record<string, unknown>): Record<string, unknown> {
		this.#assertProfileConsistency()
		return this.#configStore.configSave(patch)
	}

	/**
	 * ADR-0011 T8 / Q4 — approval-provider availability probe.
	 *
	 * PROBE BASIS (verified, not guessed): the in-process bridge has NO
	 * capability declaration — `bridge.hello`/`bridge.ping` reply with ONLY
	 * `{protocolVersion, bridgeVersion, hostVersion}` (packages/bridge/src/index.ts
	 * :1977-1994) — and NO `permissionPresets/catalog` route (dispatch :1977-2042),
	 * unlike the remote host which calls that RPC (legacy HTTP session facade:1347).
	 * A real catalog therefore cannot be fetched here. The honest signal is the
	 * ask event channel plus local answerer state:
	 *   - a delivered `ask.request`/`ask.pending` frame (#askFrameSeen) proves the
	 *     host armed its ask answerers (bridge/src/index.ts `armAskAnswerers`);
	 *   - a registered `#askProvider` or a live turn's `onApprove` proves this
	 *     client CAN answer an ask;
	 *   - the `ask.no-provider` degrade class (#degradedOnce) is positive proof
	 *     the channel exists but has NO answerer — fail-closed.
	 * When no provider can be confirmed we return `undefined` (the same meaning
	 * the remote implementation gives "service absent / malformed") and fire the
	 * composition-root sink ONCE per process for a transient fail-closed notice.
	 * We never invent preset values: a confirmed provider yields a shape-valid
	 * EMPTY catalog so /settings falls back to the schema-derived enum.
	 */
	async permissionCatalog(): Promise<SeamPermissionCatalog | undefined> {
		const answererReady =
			this.#askProvider !== undefined ||
			(this.#inFlightGeneration !== 0 && this.#activeCallbacks !== undefined) ||
			this.#askFrameSeen
		const providerConfirmed =
			this.#connection === "connected" && answererReady && !this.#degradedOnce.has("ask.no-provider")
		if (providerConfirmed) return { options: [], defaultOptions: [], defaultPreset: "" }
		if (!this.#permissionNoticeShown) {
			this.#permissionNoticeShown = true
			const reason: PermissionUnavailableReason = this.#degradedOnce.has("ask.no-provider")
				? "ask-no-provider"
				: this.#connection === "disconnected"
					? "bridge-offline"
					: "no-provider"
			this.#onPermissionUnavailable?.(reason)
		}
		return undefined
	}

	// ----- async members (D3: UNSUPPORTED error, never fake success) --------

	async listSessions(limit?: number): Promise<SeamSessionSummary[]> {
		// session.list is read-only: the bridge calls the host's
		// sessionController.list and passes items through (7e66b3f, ADR-0010:89).
		// The opentui-monday profile mounts a standalone sessionController shim
		// (2b5e2f1), so dsh-web-app is NOT required. If that service is absent the
		// bridge replies UNSUPPORTED and the transport rejects with
		// BridgeProtocolError(code=UNSUPPORTED); we MUST let it propagate —
		// no `catch { return [] }` (an empty store must stay distinct from a
		// "capability unavailable" answer).
		const value = await this.#transport.request("session.list")
		return projectBridgeSessionList(asRecord(value).items, limit)
	}

	/**
	 * retention P1 — READ-ONLY prune plan (dry run). `retentionDays=0` means the
	 * host skips every row; the default (90) stays host-side. This face NEVER
	 * deletes. A host without the optional `sessionPersistence.stat` capability
	 * rejects with UNSUPPORTED — that error propagates, never a fake empty plan.
	 */
	async planPrune(params?: {
		retentionDays?: number
		stagedIds?: string[]
		blankGraceDays?: number
		lockGraceMs?: number
	}): Promise<BridgePrunePlan> {
		// OLD CRITERION (SUPERSEDED): this face accepted a client-controlled
		// `sessionsRoot` and forwarded it. The root is now host-derived; NO
		// path is exposed here. The bridge only knows BOUND sessions, so wire
		// the REAL staged id from `stagedSessionId()` (a resume staged before
		// its next turn) into the exclusion set; over-exclusion is safe.
		const staged = this.stagedSessionId()
		const ids = new Set(params?.stagedIds ?? [])
		if (staged !== undefined && staged !== "") ids.add(staged)
		const wireParams = ids.size > 0 ? { ...(params ?? {}), stagedIds: [...ids] } : { ...(params ?? {}) }
		const value = await this.#transport.request("session.prune.plan", wireParams)
		return projectBridgePrunePlan(value)
	}

	/**
	 * retention P2 — trash-apply. The client echoes the opaque receipts from a
	 * fresh plan plus the REAL staged id as an EXTRA exclusion (the host still
	 * recomputes every gate; staged ids can only add skips). Entries / paths /
	 * roots / policy are NOT sent — the host rejects them with BAD_PARAMS.
	 * Echoing the staged id keeps plan/apply fingerprints equal after /resume.
	 * Transport errors and host refusals propagate UNCHANGED — no fake success.
	 */
	async applyPrune(params: SessionPruneApplyParams): Promise<SessionPruneApplyResult> {
		const staged = this.stagedSessionId()
		const ids = new Set(params.stagedIds ?? [])
		if (staged !== undefined && staged !== "") ids.add(staged)
		const value = await this.#transport.request("session.prune.apply", {
			fingerprint: params.fingerprint,
			configFingerprint: params.configFingerprint,
			generatedAt: params.generatedAt,
			...(ids.size > 0 ? { stagedIds: [...ids] } : {}),
		})
		return projectBridgePruneApply(value)
	}

	/**
	 * retention P3 phase 1 — read-only prepare. Issues a server-signed token
	 * bound to the exact trash set; NO path / root / policy crosses the wire.
	 */
	async preparePurge(): Promise<SessionPurgePrepareResult> {
		const value = await this.#transport.request("session.prune.purge", { phase: "prepare" })
		return projectBridgePurgePrepare(value)
	}

	/**
	 * retention P3 phase 2 — commit by echoing the prepare token. The host
	 * re-derives and re-gates everything; no client path ever reaches a delete.
	 */
	async commitPurge(params: SessionPurgeCommitParams): Promise<SessionPurgeCommitResult> {
		const value = await this.#transport.request("session.prune.purge", { phase: "commit", token: params.token })
		return projectBridgePurgeCommit(value)
	}

	/**
	 * retention B4/C7 phase 1 — read-only list of recoverable trash entries.
	 * NO path / run / manifest field crosses the wire or the projection.
	 */
	async listPruneRestore(): Promise<SessionPruneRestoreList> {
		const value = await this.#transport.request("session.prune.restore", { phase: "list" })
		return projectBridgePruneRestoreList(value)
	}

	/**
	 * retention B4/C7 phase 2 — restore ONE trashed session by entry id (never
	 * a path). Transport errors and host refusals propagate UNCHANGED.
	 */
	async restorePrune(id: string): Promise<SessionPruneRestoreResult> {
		const value = await this.#transport.request("session.prune.restore", { phase: "restore", id })
		return projectBridgePruneRestore(value)
	}

	/**
	 * 026 — current session working directory (cwd display only). Reuses the
	 * already-wired `session.list` frame (ZERO new capability id) and the SECOND
	 * whitelist `projectCurrentCwd`; a transport failure propagates (no fake cwd).
	 * `undefined` when no session is attached or the row carries no cwd.
	 */
	async cwd(): Promise<string | undefined> {
		const sessionId = this.currentSessionId()
		if (sessionId === undefined || sessionId === "") return undefined
		const value = await this.#transport.request("session.list")
		return projectCurrentCwd(asRecord(value).items, sessionId)
	}

	async storedTranscript(id: string, skip = 0): Promise<SeamTranscriptRow[]> {
		// journal.replay(seq rows) works on ANY id with no writer lock. Send no
		// `from`: skip is a row count, not a seq bound (see projection comment).
		const value = await this.#transport.request("journal.replay", { sessionId: id })
		const rows = (Array.isArray(asRecord(value).rows) ? asRecord(value).rows : []) as BridgeReplayRow[]
		// The SAME durable rows carry the subagent lifecycle records the remote
		// panel reads off session/follow. Derive the live roster from them so a
		// fresh boot / resume / session switch paints spawned+settled (and any
		// start-without-terminal → running) agents even before a frame arrives.
		this.#foldAgentReplayRows(rows, id)
		// P2-1a: a pure resume / viewer open of an OLD session has no turn terminal
		// to drive #sweepSubagents, so a catalog child whose host session has since
		// stopped would stay a running ghost. Sweep here too — idempotent, best-
		// effort (a failed/malformed session.list leaves the roster unchanged), and
		// it settles only children that are locally running AND host-stopped.
		void this.#sweepSubagents(id)
		return bridgeReplayRowsToSeamTranscript(rows, skip, id)
	}

	/**
	 * 025-w1a — /export sessionJournal face. The durable journal is already
	 * read by `storedTranscript` via the wired `journal.replay` protocol frame;
	 * this face exposes the RAW row shape the /history fold and /export JSONL
	 * writer consume (`{type,seq,time,data}`, oldest-first). NO new frame, NO
	 * new projection rule: `data = asRecord(payload)`, `time = 0` — identical
	 * to `bridgeReplayRowsToSeamTranscript`'s row construction (single source
	 * of truth). A transport without the frame rejects (UNSUPPORTED), never
	 * resolving a fake empty journal.
	 */
	async sessionJournal(id: string): Promise<HistoryJournalEntry[]> {
		const value = await this.#transport.request("journal.replay", { sessionId: id })
		const rows = (Array.isArray(asRecord(value).rows) ? asRecord(value).rows : []) as BridgeReplayRow[]
		return rows.map((row) => ({
			type: row.type,
			seq: row.seq,
			time: 0,
			data: asRecord(row.payload),
		}))
	}

	/**
	 * 025-w1b C — /history fork-at-turn. The bridge serves `session.fork` through
	 * the generated chain (table lookup → host sessionController.fork), replying a
	 * whitelisted `{sessionId}`. `seqEnd` maps to the host's inclusive `atSeq`.
	 * An empty id or a missing frame rejects — never a fake fork id, so the
	 * history panel's `f` arm stays honest. No facade/app-session switch here
	 * (the caller resumes the returned id via the normal /resume path).
	 */
	async forkSession(sessionId: string, seqEnd?: number): Promise<string> {
		const value = asRecord(await this.#transport.request("session.fork", {
			sessionId,
			...(seqEnd !== undefined ? { atSeq: seqEnd } : {}),
		}))
		const forked = value.sessionId
		if (typeof forked !== "string" || forked === "") {
			throw new BridgeProtocolError("FORK_FAILED", "/history fork: session.fork returned no session id")
		}
		return forked
	}

	// ----- RESTORE: session-level live route -------------------------------

	/** The deployment default (`agentDefaultModel.currentSelection`), still the
	 *  honest cold-boot truth when no session is bound or the journal is silent. */
	async #defaultModelRoute(): Promise<ModelRouteSelection | undefined> {
		const selection = await this.#transport.request("model.currentSelection")
		return routeFromSelection(selection)
	}

	/** Drop the folded route when the session on screen changes. A stale replay
	 *  still in flight only mutates its captured (now detached) cache object. */
	#resetModelRoute(): void {
		this.#modelRoute = undefined
		this.#modelRouteReplayInFlight = undefined
		this.#modelRouteDeferredRows = undefined
	}

	/** Current cache for `sessionId`, or a fresh EMPTY fold when the session
	 *  switched while a waiter was parked (never hand it another session's fold). */
	#modelRouteFor(sessionId: string): ModelRouteCache {
		const cache = this.#modelRoute
		return cache !== undefined && cache.sessionId === sessionId
			? cache
			: { sessionId, complete: false, lastSeq: 0 }
	}

	/** Establish the cache at most once per session. Single-flight: concurrent
	 *  footer / /model / /think reads await the SAME tail replay. A replay
	 *  failure CLEARS the cache (so a later read can retry) and degrades once;
	 *  callers then fall back to the deployment default. */
	async #ensureModelRoute(sessionId: string): Promise<ModelRouteCache> {
		// P2-1: several waiters can await the SAME in-flight replay. When it
		// settles, re-read the slot in a loop BEFORE establishing a new run: the
		// check + create below is atomic in single-threaded JS, so a fresh replay
		// started by another waiter is reused, not duplicated (N full replays).
		for (;;) {
			const inFlight = this.#modelRouteReplayInFlight
			if (inFlight === undefined) break
			await inFlight
			const after = this.#modelRoute
			// The in-flight replay may belong to a DIFFERENT session (or may have
			// failed). #modelRouteFor would hand back a fresh EMPTY fold and leave
			// no cache behind — fall through and establish THIS session.
			if (after !== undefined && after.sessionId === sessionId && after.complete) return after
			if (this.#modelRouteReplayInFlight === inFlight) break
		}
		const existing = this.#modelRoute
		// Only a COMPLETE fold may short-circuit. An incremental drain or a
		// reply-only cache has not read the whole journal; complete it here.
		if (existing !== undefined && existing.sessionId === sessionId && existing.complete) return existing
		const cache: ModelRouteCache = { sessionId, complete: false, lastSeq: 0 }
		this.#modelRoute = cache
		const run = (async (): Promise<ModelRouteCache> => {
			try {
				// Reuse the existing drain (dedup + paging + clamp) — no new wire.
				const drained = await this.#drainJournal(sessionId, 1)
				if (this.#modelRoute === cache) {
					// P1-1: ONE merged fold over the deferred incremental rows AND
					// this full replay. foldModelRouteCache de-dups by seq and sorts
					// ascending, so lastSeq covers only rows actually folded — a
					// fast incremental drain can no longer inflate the watermark and
					// make the replay skip the baseline selection.
					const deferred = this.#modelRouteDeferredRows
					const own = deferred !== undefined && deferred.sessionId === cache.sessionId ? deferred : undefined
					foldModelRouteCache(cache, own !== undefined ? [...own.rows, ...drained.rows] : drained.rows)
					if (own !== undefined && this.#modelRouteDeferredRows === own) this.#modelRouteDeferredRows = undefined
					cache.complete = true
				}
			} catch (err) {
				// A first-attempt timeout must NOT pin an empty fold for the whole
				// session: drop it if it is still ours so a later read retries.
				if (this.#modelRoute === cache) this.#modelRoute = undefined
				// P2-2: a retry re-reads from=1, so buffered rows can be dropped —
				// otherwise a permanently failing host grows this slot without bound.
				const deferred = this.#modelRouteDeferredRows
				if (deferred !== undefined && deferred.sessionId === sessionId) this.#modelRouteDeferredRows = undefined
				this.#degradeOnce(
					"modelRoute",
					`journal.replay failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
			return cache
		})()
		this.#modelRouteReplayInFlight = run
		const release = (): void => {
			if (this.#modelRouteReplayInFlight === run) this.#modelRouteReplayInFlight = undefined
		}
		void run.then(release, release)
		await run
		// The session may have changed (/new, /resume) while we awaited. A stale
		// replay only ever mutates its detached cache — never return that fold.
		return this.#modelRouteFor(sessionId)
	}

	/** P1-2: admit rows an incremental drain read while no matching cache existed
	 *  (the stats tally had already advanced past them). The seq watermark dedups
	 *  against whatever the establishing replay already folded. */
	#flushDeferredRouteRows(cache: ModelRouteCache): void {
		const deferred = this.#modelRouteDeferredRows
		if (deferred === undefined || deferred.sessionId !== cache.sessionId) return
		this.#modelRouteDeferredRows = undefined
		foldModelRouteCache(cache, deferred.rows)
	}

	/** Establish/update the fold from rows another drain ALREADY fetched (the
	 *  sessionInfo tally or a recovery replay), so the first footer read needs
	 *  no extra RPC. Creation is gated on a FULL read: `from===1` ONLY — a clamped
	 *  drain re-reads from `cursor`, NOT from 1, so it is a partial tail (P2-2).
	 *  A partial window only updates a cache that already belongs to `sessionId`. */
		#foldModelRouteFromDrain(
			sessionId: string,
			rows: readonly BridgeReplayRow[],
			from: number,
		): void {
		const full = from === 1
		const existing = this.#modelRoute
		if (existing !== undefined && existing.sessionId === sessionId && existing.complete) {
			// Only a COMPLETE fold owns the watermark: skipping rows at/below it is
			// safe only after every earlier row was actually folded.
			foldModelRouteCache(existing, rows)
			if (full) existing.complete = true
			return
		}
		if (!full) {
			// No COMPLETE cache (an establishment replay is in flight, or has not
			// started). #computeSessionInfo's tally has ALREADY advanced past these
			// rows, so a later from>1 drain will never see them again. Buffer them
			// WITHOUT advancing any watermark; the establishing replay folds them
			// together with its own full read (P1-1).
			// P2-2: buffer ONLY route rows — non-route rows cannot affect the fold
			// and would grow the single slot across a long incremental window.
			const routeRows = rows.filter((row) => ROUTE_ROW_TYPES.has(row.type))
			if (routeRows.length > 0) {
				const deferred = this.#modelRouteDeferredRows
				if (deferred !== undefined && deferred.sessionId === sessionId) {
					deferred.rows.push(...routeRows)
				} else {
					this.#modelRouteDeferredRows = { sessionId, rows: [...routeRows] }
				}
			}
			return
		}
		// Full read with no complete cache: establish (or complete an in-flight
		// fold) from the whole journal, then admit anything buffered meanwhile.
		const cache: ModelRouteCache = existing !== undefined && existing.sessionId === sessionId
			? existing
			: { sessionId, complete: false, lastSeq: 0 }
		this.#modelRoute = cache
		foldModelRouteCache(cache, rows)
		this.#flushDeferredRouteRows(cache)
		cache.complete = true
	}

	/** A host-accepted `selectModel` reply is the freshest route fact: write it
	 *  into the cache so footer / picker / the NEXT /think see it immediately,
	 *  without waiting for the next request's `request/header`. `expectedSessionId`
	 *  is the session captured BEFORE the request: if /new or /resume switched
	 *  the session meanwhile, A's selection must not land in B's cache. */
	#writeModelRouteReply(reply: unknown, expectedSessionId: string | undefined): void {
		const route = routeFromSelection(asRecord(reply).selected)
		if (route === undefined) return
		const sessionId = this.#currentSessionId ?? this.stagedSessionId()
		if (sessionId === undefined || sessionId === "" || sessionId !== expectedSessionId) return
		let cache = this.#modelRoute
		if (cache === undefined || cache.sessionId !== sessionId) {
			cache = { sessionId, complete: false, lastSeq: 0 }
			this.#modelRoute = cache
		}
		cache.pending = route
	}

	/**
	 * RESTORE: prefer the session's live route (journal-folded / reply-cached)
	 * over `model.currentSelection` (the deployment default). With no session —
	 * or an old session whose journal carries no selection rows — the default
	 * stays the honest fallback.
	 */
	async currentModelSelection(): Promise<{ providerID: string; modelID: string } | undefined> {
		const sessionId = this.#currentSessionId ?? this.stagedSessionId()
		const cache = sessionId !== undefined && sessionId !== ""
			? await this.#ensureModelRoute(sessionId)
			: undefined
		const live = cache !== undefined ? liveModelRoute(cache) : undefined
		if (live !== undefined) return { providerID: live.providerID, modelID: live.modelID }
		const fallback = await this.#defaultModelRoute()
		return fallback !== undefined ? { providerID: fallback.providerID, modelID: fallback.modelID } : undefined
	}

	/**
	 * P1-1: settle the turn() waiter that a `bridge.dead` frame left SUSPENDED
	 * (the dead handler snapshots #deadInFlight but deliberately leaves the
	 * promise awaiting so recovery may decide terminal vs INTERRUPTED). Every
	 * recovery exit that is NOT "journal terminal found" must settle it here:
	 * local INTERRUPTED, failed/locked recovery, and newSession(). Resolving
	 * (not rejecting) matches the journal-terminal arm above and lets seam-rows'
	 * .finally() finalize the partial text; the view learns the interrupted
	 * reason from the LOCAL bridge.turn.interrupted emitted below.
	 *
	 * Clear the slots BEFORE resolving so turn()'s own finally sees a different
	 * generation and cannot double-settle or race a newer turn's state.
	 *
	 * P1-2: a suspended turn must never settle SILENTLY. Unless the caller already
	 * emitted its own terminal (journal `bridge.turn.terminal` / local
	 * `bridge.turn.interrupted`, signalled with `terminalEmitted: true`), this
	 * emits a LOCAL `bridge.turn.interrupted` SYNCHRONOUSLY to listeners before
	 * resolving the waiter, carrying the ended turn id, session id and source.
	 * resolve (not reject) semantics are unchanged.
	 */
	#settleSuspendedTurn(options?: {
		terminalEmitted?: boolean
		code?: string
		reason?: string
	}): void {
		const done = this.#turnDone
		const endedTurnId = this.#inFlightTurnId
		if (!(options?.terminalEmitted ?? false) && done !== undefined) {
			this.#emitEvent({
				type: "bridge.turn.interrupted",
				details: {
					sessionID: this.#currentSessionId ?? "",
					turnId: endedTurnId,
					partial: this.#inFlightPartial,
					reason: options?.reason ?? "turn interrupted before a terminal event",
					code: options?.code ?? "INTERRUPTED",
					seq: null,
					source: "local",
				},
			})
		}
		this.#turnDone = undefined
		this.#activeCallbacks = undefined
		this.#inFlightTurnId = undefined
		this.#inFlightGeneration = 0
		this.#turn = "idle"
		if (endedTurnId !== undefined) this.#cancelAsksForTurn(endedTurnId)
		done?.()
	}

	/**
	 * Stage → open → bind the bridge session, shared by turn() and the
	 * non-turn UI faces (hostCommands list/execute).
	 *
	 * WHY a non-turn ensure exists at all: bridge/client mode is lazy — the
	 * session is minted only by turn() (first message) or DEAD recovery, but
	 * `commands.list` / `commands.execute` are agentId-addressed. A fresh
	 * client that never sent a message has NO binding, so the slash palette
	 * would stay empty forever (hostCommandsList used to early-return []).
	 * This is the seam-side precedent of tui-base mini runtime's ensureSession
	 * (packages/tui-base/src/mini/runtime.ts): a non-turn UI path resolves the
	 * session before acting.
	 *
	 * WHY it does NOT replace turn()'s open: turn() still routes through this
	 * exact block (extracted verbatim), keeping its error semantics — an open
	 * failure surfaces to the turn caller (SESSION_LOCKED / SESSION_NOT_FOUND /
	 * BAD_PARAMS ...), and the DEAD recovery path keeps its own dedicated
	 * recoverSession() (resume + journal replay, different semantics). /new and
	 * --session/auto-resume still win because they stage #pendingOpen
	 * explicitly.
	 *
	 * CONCURRENCY: in-flight merged — every caller while an open is pending
	 * awaits the SAME promise, so a palette list() racing turn()'s first open
	 * cannot mint two sessions.
	 */
	#ensureSession(): Promise<string | undefined> {
		const inFlight = this.#ensureSessionInFlight
		if (inFlight !== undefined) return inFlight
		const task = (async (): Promise<string | undefined> => {
			if (this.#pendingOpen === undefined && !this.#sessionAttached) {
				this.#pendingOpen = { mode: "new" }
			}
			if (this.#pendingOpen !== undefined) {
				const pending = this.#pendingOpen
				this.#pendingOpen = undefined
				if (pending.mode === "new" && this.#sessionAttached) {
					// ADR-0010:58 defines /new as OPEN → CLOSING → OPENING(newId):
					// close the old binding BEFORE minting a new one. The bridge
					// rejects `{mode:"new", replace:true}` outright (replace is
					// only legal with mode:"resume" and an explicitly named id,
					// bridge/src/index.ts:3920-3923), so the old client wire broke
					// here with BAD_PARAMS. Never send replace on the new path.
					try {
						await this.#transport.request("session.close")
					} catch (err) {
						const code = err instanceof BridgeProtocolError ? err.code
							: err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
								? (err as { code: string }).code
								: undefined
						if (code === "SESSION_NOT_OPEN") {
							// The bridge already has no binding: treat as closed and
							// continue to the new open below.
						} else {
							// Transport locally refused / state unknown (BRIDGE_DEAD,
							// BRIDGE_CLOSED, BRIDGE_RECOVERING, BRIDGE_TIMEOUT,
							// BRIDGE_WRITE_FAILED, ...). We still own the old session:
							// restore the staged intent so the next turn() retries the
							// whole close→open sequence instead of silently sending
							// into the old journal with no bound id (oldfox F1).
							this.#pendingOpen = pending
							throw err
						}
					}
					this.#sessionAttached = false
					// close() and open() are two awaits: a dispose() may have landed
					// in between. Do not open on a torn-down seam.
					if (this.#disposed) throw new BridgeProtocolError("DISPOSED", "bridge seam is disposed")
				}
				const params: Record<string, unknown> =
					pending.mode === "resume"
						? { mode: "resume", id: pending.id, ...(this.#sessionAttached ? { replace: true } : {}) }
						: { mode: "new" }
				// SESSION_LOCKED / SESSION_NOT_FOUND / BAD_PARAMS surface to the
				// turn caller. On the /new path close already succeeded (or no
				// session was attached): attached stays false and the intent is
				// NOT restored, so the next ensure/turn() re-stages {mode:"new"}
				// via the !sessionAttached branch above and self-heals.
				const opened = asRecord(await this.#transport.request("session.open", params))
					if (typeof opened.sessionId === "string") {
						this.#currentSessionId = opened.sessionId
						if (this.#rebindExternalSession(opened.sessionId)) this.#emitSubagentViews()
						this.#resetHostCommands()
					}

				// A4: lastAppliedSeq is per-session. A different binding starts a
				// fresh journal, so the next recovery must replay from 1.
				if (this.#lastAppliedSessionId !== this.#currentSessionId) {
					this.#lastAppliedSessionId = this.#currentSessionId
					this.#lastAppliedSeq = undefined
					this.#appliedReplayKeys.clear()
					this.#resetModelRoute()
				}
				this.#sessionAttached = true
			}
			return this.#currentSessionId
		})()
		this.#ensureSessionInFlight = task
		// Clear the merge slot on settle (both arms) — the observer chain
		// swallows the rejection itself; `task` still rejects for its real
		// awaiters (turn() propagates, hostCommands faces degrade).
		const clear = (): void => {
			if (this.#ensureSessionInFlight === task) this.#ensureSessionInFlight = undefined
		}
		task.then(clear, clear)
		return task
	}

	async turn(userText: string, cb: SeamTurnCallbacks): Promise<void> {
		// ADR-0011 T4: cb.onApprove is the turn-scoped answerer for `ask.request
		// {kind:"approval"}` frames (it shadows the registered ask provider for
		// this turn only). The active callbacks are installed below before send;
		// #answerAsk reads them under the in-flight generation guard.

		// P1-3 REENTRANCY SEMANTICS: reject, do not queue. The bridge drives one
		// turn per session (TURN_BUSY on a second send), so an overlapping turn()
		// is not meaningful work to defer — it is a caller bug. Rejecting keeps
		// the single-slot callback/waiter state sound. Callers must await the
		// first turn() before starting another.
		if (this.#inFlightGeneration !== 0) {
			throw new BridgeProtocolError(
				"TURN_REENTRANT",
				"turn() called while another turn is in flight; await the first turn()",
				{ activeTurnId: this.#inFlightTurnId },
			)
		}

		// Claim a generation BEFORE any await. Only this generation's finally
		// may clear the slots; a stale turn cannot wipe a newer one's state.
		const gen = ++this.#turnGeneration
		this.#inFlightGeneration = gen
		// A7: a NEW turn supersedes any stale death snapshot; start a fresh
		// partial-text accumulator for this generation.
		this.#deadInFlight = undefined
		this.#inFlightPartial = ""
		let sendFailed: unknown
		try {
			// Bind a staged id (resume/new) at the next turn, as in the remote seam.
			// Default startup (autoResume off / no --session) stages NOTHING, so
			// the first turn used to reach session.send with no bridge binding
			// and the bridge answered SESSION_NOT_OPEN — no turn started, so the
			// pre-execute gate never fired and no approval ask.card was pushed.
			// Mirror the legacy facade's #ensureSession(): when no id is staged and
			// no session is attached yet, stage a fresh session on this turn so
			// the bridge binds it BEFORE send. --session / auto-resume / /new
			// still win because they stage #pendingOpen explicitly.
			// Extracted verbatim into #ensureSession() (shared with the non-turn
			// hostCommands faces, in-flight merged — one open, never two racing
			// sessions); an open failure still surfaces to THIS caller.
			await this.#ensureSession()

			// Register the terminal waiter and live callbacks BEFORE send: the
			// bridge emits turn.start ahead of its send response, so early deltas
			// must reach the callbacks even though turnId is not known yet.
			this.#activeCallbacks = cb
			const done = new Promise<void>((resolve) => {
				this.#turnDone = resolve
			})
			const sent = asRecord(await this.#transport.request("session.send", { text: userText }))
			if (typeof sent.turnId === "string") {
				this.#inFlightTurnId = sent.turnId
				// A7 scenario 3: session.send resolves with a turnId = the submit
				// ACK. The submit path carries NO client inputId (see report), so
				// the view matches this ACK to its optimistic user row by text.
				this.#emitEvent({
					type: "bridge.input.acked",
					details: { sessionID: this.#currentSessionId ?? "", turnId: sent.turnId, text: userText },
				})
			}
			await done
		} catch (err) {
			sendFailed = err
		} finally {
			// Generation guard: only clear the slots if they still belong to
			// THIS turn. A stale finally (send/reject resolving late) must not
			// clear a newer generation's callbacks, waiter or turnId.
			if (this.#inFlightGeneration === gen) {
				const endedTurnId = this.#inFlightTurnId
				this.#activeCallbacks = undefined
				this.#turnDone = undefined
				this.#inFlightTurnId = undefined
				this.#inFlightGeneration = 0
				this.#turn = "idle"
				// Turn end is the upper bound for every ask it opened (A1/D5):
				// resolve their waiters and drop them even if no terminal frame
				// arrived (e.g. session.send failed).
				if (endedTurnId !== undefined) this.#cancelAsksForTurn(endedTurnId)
			}
		}
		if (sendFailed !== undefined) throw sendFailed
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return
		this.#disposed = true
		this.#unsubEvent()
		this.#listeners.length = 0
		this.#subagentListeners.clear()
		this.#subagentViews.clear()
		this.#resetExternalSubagents()
		this.#subagentRunSeq.clear()
		this.#subagentLiveStarts.clear()
		this.#subagentProgress.clear()
		this.#resetRoundPolicy() // maxRounds: no deferred wrap-up survives teardown
		this.#subagentJournalLoaded.clear()
		this.#subagentJournalMeta.clear()
		this.#subagentTranscripts.clear()
		this.#subagentTranscriptRuns.clear()
		this.#subagentTranscriptSettled.clear()
		this.#subagentTranscriptReadFailed.clear()
		this.#sweepSettledRuns.clear()
		this.#subagentSettleSnapshots.clear()
		this.#interruptInFlight.clear()
		this.#interruptGeneration = 0
		this.#bridgeCapabilities.clear()
		this.#activeCallbacks = undefined
		this.#cancelAllAsks()
		// A6: release buffered/invalidated recovery state on dispose.
		this.#bufferedPendingSnapshot = undefined
		this.#replayDrainPending = false
		this.#invalidatedAsks.clear()
		this.#turnDone?.()
		this.#turnDone = undefined
		this.#inFlightTurnId = undefined
		this.#inFlightGeneration = 0
		this.#inFlightPartial = ""
		this.#deadInFlight = undefined
		this.#turn = "idle"
		try {
			if (this.#sessionAttached) await this.#transport.request("session.close")
		} catch (err) {
			// Teardown is best-effort: a dropped connection must still dispose.
			this.#ctx.logger.warn("[bridge-seam] session.close failed during dispose: %s", err)
		}
		this.#sessionAttached = false
		this.#currentSessionId = undefined
		this.#resetHostCommands()
		if (this.#hostCommandsRefreshTimer !== undefined) {
			clearTimeout(this.#hostCommandsRefreshTimer)
			this.#hostCommandsRefreshTimer = undefined
		}
		this.#resetModelRoute()
	}

	// ----- out-of-batch members: honest D3 stubs (later batch) --------------

	/**
	 * 025-w2-1 — /btw side-question face, now REAL over the generic arm.
	 *
	 * The three side-session ids (session/create|prompt|wait) were released into
	 * CAP_GENERIC_ADAPTERS in W2-1a; this face drives the seam-side lifecycle
	 * module (create -> prompt -> wait, bounded plain-text projection). Domain
	 * separation (plan §5.1): the throwaway id lives in #lastSideSessionId,
	 * NEVER in #currentSessionId / SessionBinding. A service-absent / empty /
	 * timeout result rejects or resolves-empty with an HONEST degrade — no
	 * mocked LLM answer is ever fabricated. One side call at a time (simple
	 * lifecycle, no pool — deferred concurrency stays documented).
	 */
	async btwAsk(question: string, snapshot: string[], onDelta?: (full: string) => void): Promise<string> {
		if (this.#sideSessionInFlight) {
			throw new BridgeProtocolError("SIDE_SESSION_BUSY", "/btw: a side question is already running")
		}
		this.#sideSessionInFlight = true
		try {
			const result = await runSideSession({
				rpc: (method, params) => this.#transport.request(method, params),
				question,
				snapshot,
				onDelta,
				...(this.#lastSideSessionId !== undefined ? { sessionId: this.#lastSideSessionId } : {}),
			})
			// Reuse the throwaway for the next question (one-session pollution cap).
			this.#lastSideSessionId = result.sessionId
			if (result.answer === "") {
				// Honest degrade: no model / timeout / all records filtered. Never
				// a fabricated answer, never a silent empty success the UI paints
				// as a real reply. Message is i18n-free structural text; the layer
				// above maps UNSUPPORTED/no-answer to the locale degrade key.
				throw new BridgeProtocolError(
					"SIDE_SESSION_NO_ANSWER",
					`/btw: side-session produced no answer (${result.reason})${result.truncated ? ", truncated" : ""}`,
				)
			}
			return result.answer
		} catch (err) {
			if (err instanceof SideSessionError) {
				// Map the module's precise code to the ADR-0010 reply surface:
				// UNAVAILABLE -> UNSUPPORTED (face reject -> locale degrade text).
				const code = err.code === "SIDE_SESSION_UNAVAILABLE" ? "UNSUPPORTED" : err.code
				throw new BridgeProtocolError(code, err.message)
			}
			throw err
		} finally {
			this.#sideSessionInFlight = false
		}
	}

	/**
	 * 025-w1b B — /search full-text query over the durable journal. The bridge
	 * now serves `session.search` through the generated capcontract chain
	 * (table lookup → host sessionController.search), replying a whitelisted
	 * `{items:[{id,snippet}]}`. A transport without the frame rejects
	 * UNSUPPORTED (never a fake empty result); an empty store is a real `[]`.
	 */
	async searchSessions(query: string): Promise<{ id: string; snippet: string }[]> {
		const value = asRecord(await this.#transport.request("session.search", { query }))
		const rows = Array.isArray(value.items) ? value.items : []
		return rows.map((row) => {
			const r = asRecord(row)
			return {
				id: typeof r.id === "string" ? r.id : "",
				snippet: typeof r.snippet === "string" ? r.snippet : "",
			}
		}).filter((row) => row.id)
	}

	async renameSession(_title: string): Promise<{ title: string; seq: number } | undefined> {
		return unsupported("renameSession")
	}

	/** 029 A — steer the running turn through the bridge's own frame.
	 * Capability-gated: an old bridge (no `session.steer` in hello/ping) gets a
	 * local UNSUPPORTED rejection, never a speculative frame. Typed rejections
	 * from the bridge become `{accepted:false, reason}`; unknown errors are
	 * propagated verbatim — never retried, never painted as delivered. */
	async steer(text: string): Promise<SeamSteerResult> {
		if (!this.hasBridgeCapability("session.steer")) {
			return { accepted: false, reason: "UNSUPPORTED" }
		}
		let reply: unknown
		try {
			reply = await this.#transport.request("session.steer", { text })
		} catch (err) {
			if (err instanceof BridgeProtocolError && STEER_REJECTION_CODES.has(err.code)) {
				const detail = asRecord(err.detail)
				return {
					accepted: false,
					reason: err.code,
					...(typeof detail.turnId === "string" ? { turnId: detail.turnId } : {}),
				}
			}
			throw err // unknown error: no retry, no fake result
		}
		const result = asRecord(reply)
		if (result.accepted !== true || typeof result.turnId !== "string") {
			throw new BridgeProtocolError("INTERNAL", "session.steer reply has no accepted:true turnId")
		}
		return { accepted: true, turnId: result.turnId }
	}

	registerAskProvider(onAsk: (questions: SeamAskQuestion[]) => Promise<SeamAskPick[]>): void {
		// ADR-0011 T4: really save the answerer. It is the default for
		// `ask.request{kind:"questions"}` and the fallback for approval asks
		// outside a turn; a turn-scoped onApprove shadows it for that turn.
		this.#askProvider = onAsk
	}

	/** ADR-0011: read-only snapshot of the still-pending asks (reconnect cards,
	 *  T5 UI). Fresh shallow copies — callers cannot mutate the live queue. */
	pendingAsks(): readonly BridgeAskRequestPayload[] {
		return [...this.#pendingAsks.values()].map((entry) => ({ ...entry.request }))
	}

	/** A6: read-only rebuilt-and-invalidated asks (eventId → reason). A rebuilt
	 *  card whose `ask.response` failed (ASK_UNKNOWN_REQUEST / ASK_TURN_ENDED)
	 *  lands here as a TERMINAL state with its reason — it never silently
	 *  disappears. Fresh copy so callers cannot mutate the live map. */
	invalidatedAsks(): ReadonlyMap<string, string> {
		return new Map(this.#invalidatedAsks)
	}

	async listProviders(): Promise<{ provider: string; models: string[] }[]> {
		return unsupported("listProviders")
	}

	/**
	 * S1 /model: the bridge now serves `modelCatalog` through the generated
	 * capcontract W chain (session/modelCatalog). Flatten the host provider
	 * groups exactly like SessionSeamAdapter does; a transport without the
	 * frame replies `{}`, which degrades to UNSUPPORTED (never a fake catalog).
	 */
	async modelCatalog(_force?: boolean): Promise<SeamProviderModel[]> {
		const raw = await this.#transport.request("modelCatalog") as {
			groups?: { id?: unknown; models?: { id?: unknown }[] }[]
		} | undefined
		if (raw === undefined || raw === null || !Array.isArray(raw.groups)) {
			return unsupported("modelCatalog")
		}
		const rows: SeamProviderModel[] = []
		for (const group of raw.groups) {
			const providerID = typeof group?.id === "string" ? group.id : ""
			if (!providerID) continue
			for (const model of Array.isArray(group.models) ? group.models : []) {
				const modelID = typeof model?.id === "string" ? model.id : ""
				if (modelID) rows.push({ providerID, modelID })
			}
		}
		return rows
	}

	/**
	 * S1 /model: `selectModel` rides the generated capcontract W chain. The
	 * bridge applies the bound (or staged) sessionId; rejections PROPAGATE so a
	 * host refusal surfaces in the transcript. A transport without the frame
	 * replies `{}` → UNSUPPORTED, preserving the out-of-batch degrade contract.
	 */
	selectModel(providerID: string, modelID: string): Promise<void> {
		const sessionId = this.#currentSessionId ?? this.stagedSessionId()
		return this.#transport
			.request("selectModel", {
				provider: providerID,
				model: modelID,
				...(sessionId !== undefined && sessionId !== "" ? { sessionId } : {}),
			})
			.then((reply) => {
				const r = reply as { selected?: unknown } | undefined
				if (r === undefined || r === null || r.selected === undefined) {
					return unsupported("selectModel")
				}
				// RESTORE: previously discarded — the accepted route must be
				// visible to the footer/picker before the next request lands.
				// `sessionId` was captured before the request: a /new or /resume
				// during the round trip must not write A's route into B's cache.
				this.#writeModelRouteReply(reply, sessionId)
			})
	}

	// ------------------------------------------------------------------
	// ADR-0011 ask queue / answerer resolution
	// ------------------------------------------------------------------

	/**
	 * Map an approval verdict to `ask.response` params. `allowed-once` /
	 * `rejected` are the real SeamApprovalVerdict values. The widened
	 * `always` / `session` behaviors are only legal when the request carried
	 * `escalation:true`; otherwise return undefined so NO frame is sent (the
	 * host would answer ASK_INVALID_RESPONSE — refuse locally instead).
	 */
	#approvalParams(request: BridgeAskRequestPayload, verdict: BridgeApproveVerdict): Record<string, unknown> | undefined {
		const base = { eventId: request.eventId, kind: "approval" as const }
		switch (verdict) {
			case "allowed-once":
				return { ...base, verdict: "allowed-once" }
			case "rejected":
				return { ...base, verdict: "rejected" }
			case "always":
			case "session":
				if (request.escalation !== true) {
					this.#degradeOnce(
						"ask.invalid-escalation",
						`behavior:${verdict} needs a granted escalation; refusing to send ask.response (ASK_INVALID_RESPONSE)`,
					)
					return undefined
				}
				return { ...base, verdict: "allowed-once", behavior: verdict, escalation: true }
			default:
				// Unknown verdict → fail closed (deny), never an implicit allow.
				return { ...base, verdict: "rejected" }
		}
	}

	/** A6: rebuild the local ask queue from a reconnect snapshot. The eventId is
	 *  preserved verbatim (parseAskRequest keeps it), so rebuilt cards answer
	 *  through the EXISTING ask.response path — D4 first-wins stays in the host.
	 *  Old waiters are cancelled first so no snapshot leaves a dangling promise. */
	#applyPendingSnapshot(asks: readonly BridgeAskRequestPayload[]): void {
		this.#cancelAllAsks()
		for (const request of asks) {
			this.#invalidatedAsks.delete(request.eventId)
			this.#enqueueAsk(request)
		}
	}

	/** A6: `ask.response` failed for a reason that means the ask can no longer
	 *  be answered — the ask was evicted, its turn/session is dead, OR the bridge
	 *  connection itself is gone. `ASK_NOT_FOUND` is a defensive alias (ADR-0011's
	 *  code for an unknown eventId is `ASK_UNKNOWN_REQUEST`). RM-2b V3: a DEAD
	 *  bridge rejects every request with `BRIDGE_DEAD` (`bridge-transport.ts`),
	 *  so answering a still-pending card during DEAD must map to the terminal
	 *  invalidated state instead of silently dropping the card. `BRIDGE_CLOSED`
	 *  is the same connection-level class (transport closed, terminal). */
	#isDeadResponseError(err: unknown): string | undefined {
		const code = err instanceof BridgeProtocolError ? err.code
			: err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
				? (err as { code: string }).code
				: undefined
		if (
			code === "ASK_NOT_FOUND" || code === "ASK_UNKNOWN_REQUEST" || code === "ASK_TURN_ENDED" ||
			code === "BRIDGE_DEAD" || code === "BRIDGE_CLOSED"
		) {
			return err instanceof Error && err.message !== "" ? `${code}: ${err.message}` : code
		}
		return undefined
	}

	/** Enqueue a freshly received ask and start its answer task. Duplicate
	 *  eventIds are dropped (first-wins / replay safety, A2/A5). */
	#enqueueAsk(request: BridgeAskRequestPayload): void {
		if (this.#disposed || this.#pendingAsks.has(request.eventId)) return
		this.#invalidatedAsks.delete(request.eventId)
		let finish!: () => void
		const done = new Promise<void>((resolve) => { finish = resolve })
		const entry: PendingAskEntry = {
			request,
			turnId: askTurnId(request.eventId),
			cancelled: false,
			done,
			finish,
		}
		this.#pendingAsks.set(request.eventId, entry)
		void this.#answerAsk(entry)
	}

	/**
	 * Resolve the answerer and send exactly one `ask.response`. Turn-scoped
	 * onApprove wins over the registered provider for approval asks and only
	 * while that turn is in flight. Questions always use the registered
	 * provider. No provider / provider failure → explicit `verdict:"unavailable"`
	 * (ASK_CHANNEL_UNAVAILABLE), never a silent approve.
	 */
	async #answerAsk(entry: PendingAskEntry): Promise<void> {
		const request = entry.request
		let params: Record<string, unknown> | undefined
		try {
			if (request.kind === "approval") {
				const cb = this.#inFlightGeneration !== 0 ? this.#activeCallbacks : undefined
				if (cb !== undefined) {
					const verdict = await cb.onApprove(request.toolName ?? "tool", approvalArgs(request))
					params = this.#approvalParams(request, verdict)
				} else if (this.#askProvider !== undefined) {
					const picks = await this.#askProvider([approvalQuestion(request)])
					params = this.#approvalParams(request, approvalVerdictFromPicks(request, picks))
				} else {
					this.#degradeOnce("ask.no-provider", "no onApprove/ask provider; answering approval unavailable (ASK_CHANNEL_UNAVAILABLE)")
					// ADR-0011 T8: a fail-closed ask with no answerer is the precise
					// moment to probe the catalog; it returns undefined and fires the
					// one-shot transient notice. Never on boot (avoids false alarms).
					void this.permissionCatalog()
					params = unavailableResponse(request)
				}
			} else if (this.#askProvider !== undefined) {
				const picks = await this.#askProvider(request.questions ?? [])
				params = { eventId: request.eventId, kind: "questions", answers: answersFor(request, picks) }
			} else {
				this.#degradeOnce("ask.no-provider", "no ask provider; answering questions unavailable (ASK_CHANNEL_UNAVAILABLE)")
				void this.permissionCatalog() // ADR-0011 T8: one-shot fail-closed notice
				params = unavailableResponse(request)
			}
		} catch (err) {
			// A provider that throws is a fail-closed answer, never an implicit
			// allow and never a dangling promise.
			this.#degradeOnce("ask.provider-error", "ask provider threw; answering unavailable (ASK_CHANNEL_UNAVAILABLE)")
			this.#ctx.logger.warn("[bridge-seam] ask provider failed: %s", err)
			params = unavailableResponse(request)
		}

		// cancel / host-settled / turn end / snapshot replacement may have
		// removed this entry while the provider was pending: never send then.
		if (entry.cancelled || this.#pendingAsks.get(request.eventId) !== entry) {
			entry.finish()
			return
		}
		if (params !== undefined) {
			try {
				await this.#transport.request("ask.response", params)
			} catch (err) {
				// A late response gets ASK_TURN_ENDED / ASK_ALREADY_ANSWERED from
				// the host; log it, never retry (first-wins lives in the bridge).
				this.#ctx.logger.warn("[bridge-seam] ask.response failed for %s: %s", request.eventId, err)
				// A6: a rebuilt card whose ask/turn is gone must not silently
				// vanish. Record a terminal invalidated state + reason and let the
				// view paint it; the local entry is KEPT so syncPendingAsks() does
				// not close the card as an ordinary cancellation.
				const reason = this.#isDeadResponseError(err)
				if (reason !== undefined) {
					this.#invalidatedAsks.set(request.eventId, reason)
					this.#emitEvent({
						type: "bridge.ask.invalidated",
						details: { eventId: request.eventId, sessionId: request.sessionId, reason },
					})
				}
			}
		}
		entry.finish()
		// P2-3: an invalidated entry is KEPT in #pendingAsks through the DEAD
		// window as a terminal card (reason in #invalidatedAsks) so it never
		// vanishes silently mid-crash. It is NOT permanent: a successful
		// recovery's pending-snapshot rebuild clears it along with the view's
		// cards (RM-2c observed ≤200ms post-recovery). This mirrors the
		// turn-overlay-controller invalidateAll() comment.
		if (!this.#invalidatedAsks.has(request.eventId) && this.#pendingAsks.get(request.eventId) === entry) {
			this.#pendingAsks.delete(request.eventId)
		}
	}

	/** Drop one ask: cancel, host-settled or superseded. Always resolves the
	 *  waiter so no consumer hangs (A2/D5). */
	#settlePendingAsk(eventId: string): void {
		const entry = this.#pendingAsks.get(eventId)
		if (entry === undefined) return
		entry.cancelled = true
		this.#pendingAsks.delete(eventId)
		entry.finish()
	}

	#cancelAsksForTurn(turnId: string): void {
		if (turnId === "") return
		for (const [eventId, entry] of [...this.#pendingAsks]) {
			if (entry.turnId === turnId) this.#settlePendingAsk(eventId)
		}
	}

	#cancelAllAsks(): void {
		for (const eventId of [...this.#pendingAsks.keys()]) this.#settlePendingAsk(eventId)
	}

	/**
	 * F1-A3: anchor a received ask on its parent trajectory. A subagent ask's
	 * wire `sessionId` is ALREADY the parent session (that is the binding /
	 * answer / grant key — it must stay the parent), and `parentSessionId` is
	 * the explicit trajectory anchor. Normalizing to `parentSessionId` keeps the
	 * card on the parent queue even if a future wire ever writes a child id in
	 * `sessionId`; the card is told apart from the parent's only by its unique
	 * `${parentTurnId}:ask-N` eventId. A parent ask (no parentSessionId) is
	 * returned untouched — the ordinary path is unchanged.
	 */
	#mountAskOnParentTrajectory(request: BridgeAskRequestPayload): BridgeAskRequestPayload {
		const parent = request.parentSessionId
		if (parent === undefined || parent === request.sessionId) return request
		return { ...request, sessionId: parent }
	}

	/** Handle the four host→client ask events. Returns true when consumed. */
	#onAskEvent(frame: BridgeEventFrame): boolean {
		const payload = asRecord(frame.payload)
		// ADR-0011 T8: a delivered ask.request / ask.pending proves the host
		// armed its ask answerers — the availability signal permissionCatalog()
		// reads (bridge has no capability field and no catalog RPC).
		if (frame.type === "ask.request" || frame.type === "ask.pending") this.#askFrameSeen = true
		switch (frame.type) {
			case "ask.request": {
				const request = parseAskRequest(frame.payload)
				if (request !== undefined) {
					// Child asks hang off the parent trajectory (by parentSessionId,
					// distinguished by eventId); parent asks take the same path.
					this.#enqueueAsk(this.#mountAskOnParentTrajectory(request))
				}
				return true
			}
			case "ask.cancel": {
				const eventId = optionalStringField(payload, "eventId")
				if (eventId !== undefined) this.#settlePendingAsk(eventId)
				return true
			}
			case "ask.settled": {
				// Host broadcast: this eventId is closed — de-dup any local copy.
				const eventId = optionalStringField(payload, "eventId")
				// Settlement MUST come first (A10); no notice is ever emitted from
				// #settlePendingAsk / ask.cancel / turn end (§7.10 item 1).
				if (eventId !== undefined) this.#settlePendingAsk(eventId)
				// A10: emit a fixed-id `message.updated` notice for the bound
				// session only. A mismatched / unknown / missing sessionId yields
				// no line (A17). Re-delivered frames upsert the same id (one line),
				// and `questions`+`approved` without a child is suppressed (A13).
				const bound = this.currentSessionId()
				const sid = optionalStringField(payload, "sessionId")
				const childSessionId = optionalStringField(payload, "childSessionId")
				if (
					eventId !== undefined &&
					bound !== undefined &&
					sid === bound &&
					!this.#emittedAskOutcomes.has(eventId)
				) {
					const notice = deriveAskOutcomeNotice({
						eventId,
						sessionId: sid,
						anchorSeq: 0, // live frames carry no journal seq
						settleReason: optionalStringField(payload, "reason"),
						askKind: optionalStringField(payload, "kind"),
						outcome: optionalStringField(payload, "outcome"),
						childSessionId,
					})
					if (notice !== undefined) {
						this.#emittedAskOutcomes.add(eventId)
						this.#emitEvent({
							type: "message.updated",
							details: {
								id: notice.id,
								role: "notice",
								text: notice.text,
								sessionID: notice.sessionId,
								...(childSessionId !== undefined ? { childSessionId } : {}),
							},
						})
					}
				}
				return true
			}
			case "ask.pending": {
				const asks: BridgeAskRequestPayload[] = []
				const rawAsks = Array.isArray(payload.asks) ? payload.asks : []
				for (const raw of rawAsks) {
					const request = parseAskRequest(raw)
					if (request !== undefined) asks.push(request)
				}
				// A6 timing gate: while recovery's journal replay drain is in
				// flight, BUFFER the snapshot. Cards are rebuilt only after the
				// drain completes (blocky §2.3 step 6), never racing replay. A
				// snapshot arriving with no drain pending still applies at once
				// (ordinary /resume or a frame that lost the race to the drain).
				if (this.#replayDrainPending) {
					this.#bufferedPendingSnapshot = asks
					return true
				}
				this.#applyPendingSnapshot(asks)
				return true
			}
			default:
				return false
		}
	}

	// ------------------------------------------------------------------
	// event pump / state machine
	// ------------------------------------------------------------------

	/** Push an event to every view listener; one stale listener never breaks the
	 *  feed (same containment as the recover/dead event emissions). */
	#emitEvent(event: SeamSessionEvent): void {
		for (const listener of [...this.#listeners]) {
			try {
				listener(event)
			} catch {
				/* one stale view listener must not break the feed */
			}
		}
	}

	#degrade(member: string, reason: string): void {
		this.#ctx.logger.warn("[bridge-seam] %s degraded: %s", member, reason)
	}

	/** P2-9: warn once per degrade class; later hits (idle polling) stay silent. */
	#degradeOnce(member: string, reason: string): void {
		if (this.#degradedOnce.has(member)) return
		this.#degradedOnce.add(member)
		this.#degrade(member, reason)
	}

	/** S3: consume one `cap.event` / `cap.end` frame. Returns true when consumed.
	 *  Machine-decidable rules: sessionId is mandatory and scopes delivery;
	 *  ordering is per (sessionId,methodId) — the relay's seq is per subscription
	 *  (BL-1), so a second stream's `seq=1` must not be judged against the first
	 *  stream's lastSeq. seq must strictly increase within a subscription; a
	 *  duplicate/regressive seq is dropped and counted (C-2); a `cap.end` flips
	 *  only that subscription to `degraded`. Malformed frames are a contained
	 *  no-op — they never throw into the shared event pump. */
	#onCapPushEvent(frame: BridgeEventFrame): boolean {
		if (frame.type !== "cap.event" && frame.type !== "cap.end") return false
		const payload = asRecord(frame.payload)
		const sessionId = optionalStringField(payload, "sessionId")
		if (sessionId === undefined || sessionId === "") return true
		const methodId = optionalStringField(payload, "methodId") ?? "unknown"
		const key = `${sessionId}|${methodId}`
		if (frame.type === "cap.end") {
			const current = this.#capPushStatus.get(key)
			this.#capPushStatus.set(key, {
				sessionId,
				methodId,
				state: "degraded",
				lastSeq: current?.lastSeq ?? 0,
			})
			// C-1 end-to-end: surface the relay's whitelisted error code in the
			// degrade log instead of losing it (no payload, bounded enum).
			const code = optionalStringField(payload, "code")
			this.#degradeOnce(
				"cap.end",
				`push stream ${methodId} ended for ${sessionId}${code === undefined ? "" : ` (code=${code})`}`,
			)
			return true
		}
		const seq = typeof payload.seq === "number" && Number.isInteger(payload.seq) ? payload.seq : 0
		const current = this.#capPushStatus.get(key) ?? {
			sessionId,
			methodId,
			state: "attached" as CapPushStatusState,
			lastSeq: 0,
		}
		// v3 §3.1 ordering: strictly-increasing seq only WITHIN this subscription;
		// a duplicate or a regress is dropped, never delivered twice or out of
		// order. C-2: count it so a silent drop is observable.
		if (seq <= current.lastSeq) {
			const drop = this.#capPushDrops.get(key) ?? { sessionId, methodId, count: 0 }
			drop.count += 1
			this.#capPushDrops.set(key, drop)
			return true
		}
		const status = { ...current, lastSeq: seq }
		this.#capPushStatus.set(key, status)
		const event: CapPushEvent = {
			methodId,
			sessionId,
			seq,
			eventType: optionalStringField(payload, "eventType") ?? "event",
		}
		for (const listener of [...(this.#capPushListeners.get(sessionId) ?? [])]) {
			try {
				listener(event)
			} catch {
				/* one stale push listener must not break the event pump */
			}
		}
		return true
	}

	#onBridgeEvent(frame: BridgeEventFrame): void {
		// ADR-0011 ask frames own their own queue — never project them as turn
		// deltas or session events (they are not transcript rows).
		if (this.#onAskEvent(frame)) return

		// S3: push frames own their own face; never projected as transcript rows.
		if (this.#onCapPushEvent(frame)) return

		// Additive subagent lifecycle frames (row 33 inproc) + B3 live progress:
		// feed the onSubagentViews face, never the transcript/status pipeline.
		// An unknown frame is a no-op.
		if (frame.type === "agent.spawn" || frame.type === "agent.settle") {
			this.#foldAgentFrame(frame)
			return
		}
		if (frame.type === "agent.external.spawn" || frame.type === "agent.external.settle") {
			this.#foldExternalFrame(frame)
			return
		}
		if (frame.type === "agent.progress") {
			this.#foldAgentProgress(frame)
			return
		}
		if (frame.type === "agent.transcript") {
			this.#foldAgentTranscript(frame)
			return
		}

		// A2: DEAD is published on the existing onEvent pipeline (no polling).
		// Event-driven so an idle-period crash — no in-flight turn — paints the
		// notice immediately. Re-emit as a SeamSessionEvent for the view and call
		// the composition-root callback synchronously.
		if (frame.type === "bridge.dead") {
			const cause = asDeadCause(frame.payload)
			// A7: snapshot the in-flight turn BEFORE any state flip. The DEAD
			// transition is the only moment we can factually say "a turn was
			// in flight"; replay later decides whether the host terminalized it.
			if (this.#inFlightGeneration !== 0 && this.#inFlightTurnId !== undefined && this.#inFlightTurnId !== "") {
				this.#deadInFlight = { turnId: this.#inFlightTurnId, partial: this.#inFlightPartial }
			}
			this.#bridgeLink = "dead"
			this.#connection = "disconnected"
			this.#turn = "idle"
			// 027: a dead bridge invalidates the hostCommands catalog — the next
			// palette open must re-probe instead of serving cached rows.
			this.#resetHostCommands()
			// Same cleanup as dispose: a pending refresh settle must not fire
			// against a dead bridge and resurrect stale state.
			if (this.#hostCommandsRefreshTimer !== undefined) {
				clearTimeout(this.#hostCommandsRefreshTimer)
				this.#hostCommandsRefreshTimer = undefined
			}
			// S3: a dead bridge ends every host push subscription; record the
			// disconnect per (session,method) subscription (BL-1) so a later
			// resume can re-arm each one from seq 0.
			for (const [key, status] of this.#capPushStatus) {
				this.#capPushStatus.set(key, { ...status, state: "disconnected" })
			}
			this.#onDead?.(cause)
			for (const listener of [...this.#listeners]) {
				try {
					listener({ type: "bridge.dead", details: cause })
				} catch {
					/* one stale view listener must not break the feed */
				}
			}
			return
		}

		const payload = asRecord(frame.payload)
		// status state machine (no reconnect precision — D3: idle on ambiguity).
		if (frame.type === "turn.start") {
			this.#turn = "starting"
			// A new turn opens a fresh decode window (closed at turn.end).
			this.#decodeWindowStart = undefined
		}
		if (frame.type === "turn.token" || frame.type === "turn.tool") this.#turn = "running"
		if (frame.type === "turn.end" || frame.type === "turn.error") {
			this.#turn = "idle"
			const endedTurnId = typeof payload.turnId === "string" ? payload.turnId : this.#inFlightTurnId
			this.#inFlightTurnId = undefined
			// Turn terminal frame is the upper bound for its asks (A1/D5).
			if (endedTurnId !== undefined) this.#cancelAsksForTurn(endedTurnId)
			this.#turnDone?.()
			// 0.23.0 T1 sweep hook ① (turn end): a child that finished without
			// journaling its `subagent-settled` notice (aborted parent turn) still
			// sits `running` in our roster. Best-effort; never blocks the terminal.
			if (this.#currentSessionId !== undefined && this.#currentSessionId !== "") {
				void this.#sweepSubagents(this.#currentSessionId)
			}
		}

		// Cache billed usage on EVERY turn.end, not only turns this seam drove:
		// the status bar reads usageSummary() synchronously and must reflect
		// usage from any turn on this connection.
		if (frame.type === "turn.end") {
			const usage = parseUsage(payload.usage)
			if (Object.keys(usage).length > 0) {
				this.#usage.turns += 1
				for (const key of ["prompt", "completion", "cacheRead", "cacheWrite"] as const) {
					this.#usage[key] += usage[key] ?? 0
				}
			}
			// Close the decode window: billed completion tokens over the time from
			// the first streamed delta to this terminal frame. A turn with no
			// observed token (e.g. tool-only) has no window and no tps sample.
			const start = this.#decodeWindowStart
			const tokens = usage.completion ?? 0
			if (start !== undefined && tokens > 0) {
				const ms = Date.now() - start
				if (ms > 0) {
					this.#lastTurnDecode = { tokens, ms }
					this.#decodeTotals.tokens += tokens
					this.#decodeTotals.ms += ms
				}
			}
			this.#decodeWindowStart = undefined
		}

		// A7: remember the text already delivered to the view so a local
		// INTERRUPTED marker can report what was produced. Bounded to avoid an
		// unbounded buffer on a long stream; this is a local fact, never a
		// journal write.
		if (frame.type === "turn.token" && payload.kind !== "reasoning" && typeof payload.text === "string" && payload.text) {
			// First visible delta opens the decode window (first-delta → settle).
			if (this.#decodeWindowStart === undefined) this.#decodeWindowStart = Date.now()
			this.#inFlightPartial = (this.#inFlightPartial + payload.text).slice(-4096)
		}

		// live turn callbacks (double-paint law: content goes through turn()).
		const cb = this.#activeCallbacks
		if (cb !== undefined) {
			if (frame.type === "turn.token") {
				const text = typeof payload.text === "string" ? payload.text : ""
				if (payload.kind === "reasoning") {
					if (text) cb.onThinkingDelta(text)
				} else if (text) {
					cb.onContentDelta(text)
				}
			} else if (frame.type === "turn.tool") {
				// P1-1: the bridge's turn.tool carries `input` (call) or `output`
				// (result), plus `callId` on both and the result's `isError` mirror.
				// Forward all three through this conversion layer: seam-rows keys
				// LIVE tool rows by `callId`, so two same-name tools interleaving
				// must not collide on the name; `ok` is the isError mirror, never a
				// hardcoded true. (FakeSeam tests that call the callbacks directly
				// bypass this layer — this is where the wire fields used to be lost.)
				const name = typeof payload.name === "string" ? payload.name : "tool"
				const callId = typeof payload.callId === "string" ? payload.callId : undefined
				if (payload.input !== undefined) {
					cb.onToolStart?.({ ...(callId !== undefined ? { callId } : {}), name, args: JSON.stringify(payload.input) })
				} else if (payload.output !== undefined) {
					cb.onToolRun?.({
						...(callId !== undefined ? { callId } : {}),
						name,
						argsPretty: "",
						output: typeof payload.output === "string" ? payload.output : "",
						ok: payload.isError !== true,
					})
				}
			} else if (frame.type === "turn.error") {
				cb.onError(typeof payload.message === "string" ? payload.message : "turn failed")
			}
		}

		// project the lifecycle/error events to onSessionEvent listeners.
		const events = projectBridgeEvent(frame, this.#currentSessionId ?? "")
		for (const event of events) {
			for (const listener of this.#listeners) {
				try {
					listener(event)
				} catch {
					/* one stale view listener must not break the feed */
				}
			}
		}
	}
}
