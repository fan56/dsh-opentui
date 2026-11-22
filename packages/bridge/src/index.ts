/**
 * In-process bridge — stdio JSON-lines protocol (T6 handshake + M2 session seam).
 *
 * Built by scripts/build-bridge.mjs into a node-runnable ESM bundle that the
 * dsh host loads as a cordis plugin. The handshake/ping methods (T6) remain;
 * this module now implements `session.open` / `session.send` / `session.close`
 * against the host's `ctx.agents` registry — the seam where "resume really
 * resumes context" lands (ADR-0009 / ADR-0010) — plus the M2-2 `turn.*` event
 * stream (start/token/tool/end/error) driven by the host's `session/event` and
 * `agent/assistant-stream` firehoses. M2-3 adds `turn.abort` (cancel only the
 * in-flight turn, never the session — I3) and `journal.replay` (read-only
 * persistence drain, no writer lock — I6). `session.list` (read-only session
 * enumeration via the host's `sessionController.list`, reusing the `session/list`
 * wire shape) completes the seam — no new protocol version (v1).
 *
 * stdout is reserved for the protocol. Every log line goes through ctx.logger;
 * nothing in this module ever writes to stdout except a well-formed NDJSON
 * response frame. The whole stdio takeover is gated behind
 * DSH_OPENTUI_BRIDGE_STDIO=1 — when it is unset the plugin behaves exactly as
 * the T2a skeleton did (no stdin reads, no stdout writes).
 *
 * Invariants (ADR-0010 I1–I6) enforced here:
 * - I1: only `session.open` may bind/change the sessionId. There is no other
 *   protocol operation that mints or adopts an id. In particular a failed
 *   resume NEVER falls back to create (that fallback is the ADR-0009 accident).
 * - I2: a resume is eager — `ctx.agents.resume({resumeSessionId})` is called
 *   before any response is returned; the live-session adopt arm uses
 *   `ctx.agents.get(id)` exactly as dsh-tui-pi does, with a no-op disposer.
 * - I3: `turn.abort` calls `agent.cancel({kind:'user'},{keepInbox:true})` on the
 *   in-flight turn only; it never touches sessionId, close, or handle dispose.
 * - I6: `journal.replay` opens persistence with access `'read'` (never takes
 *   the writer lock), works with no session open, and returns the durable rows
 *   plus the exclusive upper-bound cursor from `seq.max + 1`.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
// ADR-0011 T3 — ask channel wiring. The registry shape/validators are T1/T2;
// this module only connects them to dispatch + turn/session lifecycle.
import { ASK_FRAME_TYPES, validateAskResponse } from './ask-frames'
import type { AskOutcome, AskRequestPayload, AskResponseParams, AskSettledPayload } from './ask-frames'
import { AskRegistry, DEFAULT_MAX_ASK_WAIT_MS } from './ask-registry'
// ADR-0011 T7 — redacted decision journal + session-scoped permission summary.
import { alwaysGrantToolsFromJournal, askPluginRecordType, type AskJournalEvent } from './ask-journal'
// M3-02 — section registration skeleton lives in append-section.ts; index.ts
// stays assembly-only so it does not grow the overlap surface with ask (ADR-0011).
import { registerAppendSection } from './append-section'
import type { RegisterAppendSectionOptions } from './append-section'
// M3-05 — legacy preset id DETECTION (debug-only observation) lives in
// preset-migration.ts so index.ts stays assembly-only (same overlap-surface
// discipline as M3-02/04). No preset is written to any resume payload.
import {
  presetMentionsAppend,
  readSessionAgentPreset,
  logLegacyAppendPreset,
} from './preset-migration'
// L1 (0.23.1) — bridge-local session→sub-agents index + stop capability. The
// index module owns the Map shape and its build/incremental/reconcile rules;
// index.ts only wires it to the host firehose and the dispatcher.
import { getSubagentIndex } from './subagent-index'
// 024 base task 4 — startup capability handshake. A lifecycle observer only:
// it is started from apply() but adds NO `req.method ===` dispatch branch, so
// the @manual wired surface (and its ledger registry) is unchanged.
import { attachHandshake, HANDSHAKE_ICLASS_KEYS_BASE, HANDSHAKE_INJECT, S2_OBSERVATION_ICLASS_KEYS, startCapabilityHandshake, type HandshakeHandle } from './handshake'
// 024 base task5b — capcontract host adapter (oldfox R2/R3). The generated
// binder/dispatcher own only id/kind data + membership checks; the bridge
// injects real host invocation and marks every other CapIR W id NOT_WIRED.
import { createProjectionBinder, type WireFrameHandler } from '../../../capcontract/binder'
import { lookupCapKind, type CapHostInvoke } from '../../../capcontract/dispatch'
import {
  CAP_GENERIC_ADAPTERS,
  CAP_GENERIC_WIRE_METHODS,
  CAP_PARAMS_TABLE,
  CAP_PROJECTED_BY_HAND,
  CAP_SCOPE_TABLE,
  CAP_SERVICE_TABLE,
  CAP_WRITE_CONFIRM_IDS,
} from '../../../capcontract/types'
// 025 wave2 W2-0d — table-driven generic arm (dormant at base: adapters empty).
import {
  invokeGenericCap,
  projectGenericWireReply,
  resolveGenericWireMethod,
  type GenericCapConfig,
} from './cap-generic'
// 025-w3-2 — hand projection for the one PROJECTED_BY_HAND id; the generic
// branch below refuses it, so this dedicated branch owns its wire reply.
import { projectDiscoverModelsForWire } from './cap-discover-models'
// NOTE: the bridge deliberately does NOT import `@deepseek-ai/dsh-llm/message`.
// Keeping that import external (build script) made a clean npm-prefix install
// fail at module load with ERR_MODULE_NOT_FOUND: the profile has no host
// closure and the peer is optional, so there is nothing to resolve against.
// Inlining it instead copied host code into the bundle (the forbidden shape).
// We therefore construct the minimal structural message locally below — no
// @deepseek-ai implementation is imported, inlined or copied.

/**
 * Minimal local user-message constructor. It produces exactly the public shape
 * the host's `agent.followup` / `agent.steer` consume —
 * `{ role: 'user', id: <uuid>, content, source: { kind: 'user' } }` — and freezes
 * the small object graph, but it is NOT a copy of any @deepseek-ai code. The
 * host accepting this shape was verified by a real model turn (see M2-1b
 * acceptance: a small `M2B-PROBE-7Q` message got a real `OK` reply).
 */
function createBridgeUserMessage(text: string): {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  readonly source: { readonly kind: 'user' }
} {
  return Object.freeze({
    id: randomUUID(),
    role: 'user' as const,
    content: Object.freeze([Object.freeze({ type: 'text' as const, text })]),
    source: Object.freeze({ kind: 'user' as const }),
  })
}

export interface Logger {
  info(format: unknown, ...params: unknown[]): void
  warn(format: unknown, ...params: unknown[]): void
  error(format: unknown, ...params: unknown[]): void
  debug(format: unknown, ...params: unknown[]): void
}

export interface BridgeContext {
  /** The host logging service (cordis exposes it on ctx without injection). */
  logger: Logger
  /** Register a disposer that runs on effect teardown / plugin unload. */
  effect(execute: () => () => void | Promise<void>, label?: string): unknown
  /** Cordis event subscription. Returns a disposer that removes the listener.
   *  Root-scope subscription sees every session/agent; frames are routed by
   *  session id below (the same shape dsh-tui-pi uses — see M2-2 notes). */
  on?(name: string, listener: (...args: unknown[]) => void): () => void
  /** Cordis service lookup (works without declaring an injection). */
  get?(name: string, strict?: boolean): unknown
  /** Direct service access; cordis proxies provided services onto ctx. */
  appExit?: unknown
  /** Injected by the plugin manifest (`inject: ['agents']`). */
  agents?: AgentsLike
  /** Optional host default-model service; accessed via ctx.get when present. */
  agentDefaultModel?: DefaultModelLike
  /** Optional host persistence service (cordis provides `ctx.sessionPersistence`).
   *  Resolved through ctx.get, never imported at runtime. */
  sessionPersistence?: PersistenceLike
  /** Optional host session-controller service (cordis provides
   *  `ctx.sessionController`). Resolved through ctx.get with a direct-property
   *  fallback; never imported at runtime. */
  sessionController?: SessionControllerLike
  /** M3-02: optional host system-prompt service (`dsh-system-prompt`). Resolved
   *  through ctx.get with a direct-property fallback; never imported at runtime
   *  (structural typing discipline, see below). NOTE: registration must still
   *  happen at agent scope (ADR-0010 "scope 注册，禁 global"); this member only
   *  widens the type surface so the registration skeleton can be carried. */
  systemPrompt?: SystemPromptLike
}

// --------------------------------------------------------------------------
// Structural host types. The bridge deliberately does NOT import runtime
// symbols from @deepseek-ai/* (that would either copy a host package into the
// profile or pin a second, version-skewed copy). These shapes are transcribed
// from the installed host declarations; every call site mirrors dsh-tui-pi's
// host API usage exactly.
// --------------------------------------------------------------------------

/** The live agent face this task needs (runtime augmentation of `Agent`). */
interface AgentLike {
  readonly status?: unknown
  readonly session?: { readonly seq?: unknown }
  followup(message: unknown): void
  steer(message: unknown): void
  /** dsh-agent `cancel(cause, options)` — the M2-3 abort seam. Synchronous and
   *  fire-and-forget: the active driver's AbortSignal fires; the turn's terminal
   *  event arrives on the existing firehose subscription. */
  cancel(cause: { kind: string }, options?: { keepInbox?: boolean }): void
  whenIdle(): Promise<void>
}

/** `{agent, dispose}` from `AgentRegistry.create` / `.resume`. */
interface AgentHandleLike {
  agent: AgentLike
  dispose(): Promise<void>
}

/** Structural slice of `ctx.agents` (dsh-agent `AgentRegistry`). */
interface AgentsLike {
  create(options: Record<string, unknown>): Promise<AgentHandleLike>
  resume(options: Record<string, unknown>): Promise<AgentHandleLike>
  get(id: string): AgentLike | undefined
}

/** `ctx.agentDefaultModel` — host default provider/model route. */
interface DefaultModelLike {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string }
}

/** One durable journal event, transcribed from `@deepseek-ai/dsh-session`'s
 *  `SessionEvent`. The bridge never imports the host package at runtime. */
interface JournalEventLike {
  seq?: unknown
  type?: unknown
  data?: unknown
}

/** Read slice returned by `SessionHandle.read(offset)`. */
interface JournalReadResultLike {
  events?: readonly JournalEventLike[]
}

/** `sessionPersistence` handle — `open(id,'read')` never takes the writer lock. */
interface PersistenceHandleLike {
  /** Immutable stored header (dsh-session-persistence `SessionHandle.header`,
   *  dsh-session `SessionHeader`). M3-05 reads `agentPreset` off it for debug
   *  observation only — no durable state is written and no preset is applied. */
  readonly header?: { readonly agentPreset?: unknown }
  read(offset?: number, length?: number): Promise<JournalReadResultLike>
  close(): Promise<void>
}

/** Structural slice of `ctx.sessionPersistence` (dsh-session-persistence). */
interface PersistenceLike {
  open(id: string, access: 'read' | 'write'): Promise<PersistenceHandleLike>
}

/** One `SessionSummary` on the `session/list` wire, transcribed from
 *  `@deepseek-ai/dsh-api-session-controller` (`ctrl/types.d.ts:41-59`). The
 *  bridge passes these rows through VERBATIM — it never renames a field or
 *  fabricates one (title lives at `projections.values.title`; the summary has
 *  no `title` / `sizeBytes` of its own). */
interface SessionSummaryLike {
  sessionId: string
  updatedAt: number
  agentAvailable: boolean
  formatStatus?: 'current' | 'migration-required'
  running: boolean
  blank: boolean
  parentSessionId?: string
  origin?: 'subagent'
  cwd?: string
  projections?: {
    kind?: 'cached' | 'sequenced'
    asOfSeq?: number
    values?: Record<string, unknown>
  }
}

/** `SessionListValue` — the raw wire reply of `session/list` (`ctrl/types.d.ts:249-255`). */
interface SessionListValueLike {
  items: readonly SessionSummaryLike[]
}

/** Structural slice of `ctx.sessionController` (dsh-api-session-controller).
 *  `list(_request, signal)` is the very handler behind the thin client's
 *  `session/list` RPC (`typert.host.js:2168`, `index.js:3988`). */
interface SessionControllerLike {
  list(request: { _request: { cursor?: string } }): Promise<SessionListValueLike>
}

// 025-w1b B/C — host SessionController's search/fork @Remote methods
// (rc.5 session-controller/src/index.ts:268 search / :422 fork; types.ts:249-257,
// :302-313). Optional so a host without them degrades to NOT_WIRED, never a crash.
interface SessionSearchValueLike {
  items: readonly { sessionId: string; snippet: string }[]
  hasMore?: boolean
}
interface SessionForkValueLike {
  sessionId: string
}

// S1 /model — structural slices of the host SessionController's model @Remote
// methods (`packages/api/session-controller/src/index.ts:289-320`, rc.5 source).
// Optional members keep resolveSessionController's `list` membership test intact:
// a host without the model surface degrades to NOT_WIRED, never a crash.
interface ModelSelectionLike {
  provider: string
  model: string
  reasoningEffort?: string
}
interface ModelCatalogLike {
  default: ModelSelectionLike
  routableProviders?: readonly string[]
  groups?: readonly { id?: unknown; models?: readonly unknown[] }[]
  failures?: readonly unknown[]
}
interface SessionSelectModelRequestLike extends ModelSelectionLike {
  sessionId: string
}
interface SessionSelectModelValueLike {
  selected: ModelSelectionLike
}

/** S1: the three model methods are additive on the same service slice. */
interface SessionControllerModelLike extends SessionControllerLike {
  modelCatalog?(): Promise<ModelCatalogLike>
  selectModel?(request: SessionSelectModelRequestLike): Promise<SessionSelectModelValueLike>
  initializeDefaultModel?(): Promise<void>
  // 025-w1b — additive optional members; resolveSessionController's `list`
  // membership test is unchanged, a host without them degrades to NOT_WIRED.
  search?(request: { query: string }, signal: AbortSignal): Promise<SessionSearchValueLike>
  fork?(request: { sessionId: string; atSeq?: number; allowMigration?: boolean }): Promise<SessionForkValueLike>
}

// S3 push — structural slices of the host SessionController's @Remote stream
// methods (rc.5 session-controller/src/index.ts:527-563), NO runtime import.
// All members optional so an absent host surface degrades to NOT_WIRED, never a
// crash. Event frames are typed minimally: type + seq only (whitelist projection).
interface SessionPushAddressLike { readonly kind: 'session'; readonly sessionId: string }
interface SessionPushFrameLike { readonly type?: string; readonly seq?: number }
interface SessionControllerPushLike extends SessionControllerModelLike {
  observeEvent?(request: { address: SessionPushAddressLike }, signal: AbortSignal): AsyncIterable<SessionPushFrameLike>
  observeState?(request: { sessionId: string }, signal: AbortSignal): AsyncIterable<unknown>
  observeProjections?(request: { sessionId: string }, signal: AbortSignal): AsyncIterable<unknown>
}

// --------------------------------------------------------------------------
// S2 credentials/account — structural slices of two host services. Same
// discipline as S1: NO @deepseek-ai runtime import; shapes transcribed from
// rc.5 host source, every member optional so a missing surface degrades to
// NOT_WIRED (never a crash). Service keys verified one-hand from source:
//   deepseekAccount      — dsh-deepseek-account/src/index.ts:136
//   credentialsController — dsh-api-settings-controller/src/credentials.ts:71
// --------------------------------------------------------------------------

/** `AccountClientMetadata` (dsh-deepseek-account/src/types.ts:7-16) — caller
 *  identity; no credential material. */
interface AccountClientMetaLike {
  version: string
  locale: string
  timezoneOffsetSeconds: number
}
/** `AccountView` (types.ts:38-42): status + attempt + links. NO secret value
 *  is ever returned by the account service (getState doc, index.ts:201-218). */
interface AccountViewLike {
  status: string
  attempt?: unknown
  links?: unknown
}
/** Ordered stream item `AccountUpdate` (types.ts:45-49). */
interface AccountUpdateLike {
  type?: string
  state?: AccountViewLike
}
/** Structural slice of `ctx.deepseekAccount` (rc.5, 12 CapIR methods).
 *  Methods are optional so an absent host surface degrades to NOT_WIRED. */
interface DeepSeekAccountLike {
  getState?(): Promise<AccountViewLike>
  getProfile?(client: AccountClientMetaLike): Promise<unknown>
  getBalance?(client: AccountClientMetaLike): Promise<unknown>
  getNotifications?(client: AccountClientMetaLike): Promise<unknown>
  getNotificationContent?(id: string, client: AccountClientMetaLike): Promise<unknown>
  reportNotificationEvent?(id: string, event: string, client: AccountClientMetaLike): Promise<unknown>
  startSignIn?(client: AccountClientMetaLike, callbackOrigin: string, loginSource: string): Promise<AccountViewLike>
  cancelSignIn?(attemptId: string): Promise<AccountViewLike>
  signOut?(client: AccountClientMetaLike): Promise<AccountViewLike>
  hasRunningAccountTasks?(): boolean | Promise<boolean>
  /** `account/watch` is backed by @Remote-wrapped `watchState` (index.ts:621-623);
   *  the plain `watch` (index.ts:612) is the same `observeUpdates` projection. */
  watchState?(signal: AbortSignal, includeIdentityChanges?: boolean): AsyncIterable<AccountUpdateLike>
  watch?(signal: AbortSignal, includeIdentityChanges?: boolean): AsyncIterable<AccountUpdateLike>
  watchExpiry?(signal: AbortSignal): AsyncIterable<unknown>
}
/** `CredentialInfo` is host-redacted (field-by-field view, credentials.ts:63-66,
  88-90) — key names + presence only, never a secret value. */
interface CredentialInfoLike {
  present?: boolean
  configured?: boolean
  [key: string]: unknown
}
/** Structural slice of `ctx.credentialsController` (rc.5, 3 CapIR methods). */
interface CredentialsControllerLike {
  describe?(refs: string[]): Promise<Record<string, CredentialInfoLike>>
  set?(ref: string, value: string): Promise<void>
  unset?(ref: string): Promise<void>
}
/**
 * S5 — structural slice of `ctx.settingsController` (rc.5,
 * dsh-api-settings-controller/src/index.ts:86 `super(ctx,'settingsController',
 * {namespace:'settings'})`). Only the two CapIR W methods the /settings face
 * needs; host already redacts secret values into `secrets[{path,set}]`.
 */
interface SettingsControllerLike {
  describe?(): SettingsDescribeValueLike | Promise<SettingsDescribeValueLike>
  mutate?(ns: string, ops: unknown[], expectedRevision?: number): Promise<unknown>
}
interface SettingsDescribeValueLike {
  writable?: boolean
  hasDocument?: boolean
  namespaces?: unknown[]
}

// 025-w1b D — structural slice of `ctx.subagents` (SubagentRuntime, service key
// `subagents`, subagent/src/index.ts:210 with @Remote prompt :450 /
// interruptByUser :503). Optional so a host without them degrades to NOT_WIRED.
// content parts are text-only here (the form carries a user message, no images).
interface SubagentPromptRequestLike {
  requestId: string
  childSessionId: string
  delivery: 'steer' | 'queue'
  content: readonly { type: 'text'; text: string }[]
  clientTimeZone?: string
}
interface SubagentRuntimeLike {
  prompt?(request: SubagentPromptRequestLike, signal: AbortSignal): Promise<{ messageId: string }>
  interruptByUser?(childSessionId: string): { accepted: true } | Promise<{ accepted: true }>
}

// --------------------------------------------------------------------------
// S4 PKCE/stream — frame-safe projection of account/PKCE state.
//
// Host source (rc.5, one-hand verified): `deepseekAccount` service key at
// dsh-deepseek-account/src/index.ts:136; `SignInAttemptView.authorizeUrl`
// (types.ts:28) holds the browser URL built with code_challenge/state
// (index.ts:727-737). The PKCE verifier stays host-side. The authorize URL is
// a sensitive neighbour: its VALUE must never cross a frame boundary. Only a
// boolean "ready" signal and bounded status/phase enums may be projected.
// --------------------------------------------------------------------------

/** Account statuses allowed to cross a frame (rc.5 `AccountView.status`). */
const S4_ACCOUNT_STATUSES: ReadonlySet<string> = new Set(['signed-out', 'credential-stored'])
/** Attempt phases allowed to cross a frame (rc.5 `SignInAttemptView.phase`). */
const S4_ATTEMPT_PHASES: ReadonlySet<string> = new Set([
  'initializing', 'waiting-browser', 'exchanging', 'committing',
  'succeeded', 'cancelled', 'expired', 'failed',
])
/** Auth-material keys stripped from EVERY outbound frame (defence in depth).
 *  Key-name based only — user text in `turn.token` is never rewritten. */
const S4_AUTH_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  'authorizeUrl', 'authorize_url', 'code_challenge', 'code_verifier',
  'access_token', 'id_token', 'refresh_token',
])

/** The ONLY shape allowed to represent account/PKCE state in a frame. */
export interface AccountFrameProjection {
  readonly status: string | null
  readonly attemptPhase: string | null
  readonly authorizeUrlReady: boolean
  readonly linksPresent: boolean
}

/**
 * Project a raw host `AccountView` into a fixed, bounded frame-safe shape.
 * The authorize URL contributes ONE boolean (presence only); its value — and
 * the code_challenge/state it carries — is never copied into the result.
 */
export function projectAccountViewForFrame(view: unknown): AccountFrameProjection {
  const v = view as { status?: unknown; attempt?: unknown; links?: unknown } | undefined
  const attempt = v?.attempt as { phase?: unknown; authorizeUrl?: unknown } | null | undefined
  const isAttempt = attempt !== null && typeof attempt === 'object'
  return {
    status: typeof v?.status === 'string' && S4_ACCOUNT_STATUSES.has(v.status) ? v.status : null,
    attemptPhase: isAttempt && typeof attempt.phase === 'string' && S4_ATTEMPT_PHASES.has(attempt.phase)
      ? attempt.phase : null,
    authorizeUrlReady: isAttempt && typeof attempt.authorizeUrl === 'string' && attempt.authorizeUrl.length > 0,
    linksPresent: v?.links !== undefined && v?.links !== null,
  }
}

/**
 * S4b — bounded, host-text-free reply projection for the NON-view unary
 * account wire methods. No host string / URL / object is ever copied into a
 * frame: only presence booleans, counts and an ok flag cross the boundary.
 * The four view-returning methods use `projectAccountViewForFrame` instead
 * (see ACCOUNT_VIEW_WIRE_METHODS); this helper covers the other six.
 */
export function projectAccountScalarResult(method: string, value: unknown): Record<string, unknown> {
  switch (method) {
    case 'account.hasRunningAccountTasks':
      return { running: value === true }
    case 'account.getProfile':
    case 'account.getBalance':
    case 'account.getNotificationContent':
      return { present: value !== undefined && value !== null }
    case 'account.getNotifications':
      return { count: Array.isArray(value) ? value.length : 0 }
    case 'account.reportNotificationEvent':
      return { ok: true }
    default:
      return { ok: true }
  }
}

/**
 * S4 wire guard — strip auth-material keys from ANY object before it is
 * serialized to stdout. Applied centrally in `writeFrame`, so no future
 * caller (reply / emit / relay) can leak an authorize URL into a frame.
 * Structural, bounded-depth, arrays preserved; no value rewriting.
 */
export function sanitizeFrameForWire<T>(frame: T, depth = 0): T {
  if (depth > 12 || frame === null || typeof frame !== 'object') return frame
  if (Array.isArray(frame)) return frame.map((v) => sanitizeFrameForWire(v, depth + 1)) as T
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(frame as Record<string, unknown>)) {
    if (S4_AUTH_FORBIDDEN_KEYS.has(key)) continue
    out[key] = sanitizeFrameForWire(value, depth + 1)
  }
  return out as T
}

// M3-02 — structural slice of `ctx.systemPrompt` (dsh-system-prompt). Exported
// so append-section.ts can consume the same shape without importing any
// @deepseek-ai/* runtime symbol (same discipline as the types above). Fields
// transcribed from the host `PromptSection` declaration: `text` is static
// string OR a provider evaluated per assembly; `interpolate` defaults to true.
export interface SystemPromptSectionLike {
  readonly name: string
  readonly order: number
  readonly text: string | ((context: unknown) => string)
  readonly interpolate?: boolean
}
export interface SystemPromptLike {
  section(section: SystemPromptSectionLike): () => void
}

// --------------------------------------------------------------------------
// ADR-0011 T4 — host waterfall answerer shapes. Transcribed from the installed
// host declarations (never imported at runtime, like every other host type
// above): dsh-user-approval/src/types.ts (ApprovalRequestEvent / ApprovalOutcome)
// and dsh-user-questions/src/types.ts (AskUserQuestionRequestEvent / answer).
// The bridge registers `ctx.on('approval/request', ...)` /
// `ctx.on('user-questions/request', ...)` listeners (cordis dispatches BOTH
// waterfalls through the same hook table; the dispatch mode is chosen by the
// emitter's `ctx.waterfall`, not by the listener registration).
// --------------------------------------------------------------------------
type HostApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

interface ApprovalAgentLike {
  session?: { id?: unknown }
}
interface ApprovalRequestLike {
  agent?: ApprovalAgentLike
  toolName?: unknown
  callId?: unknown
  reason?: unknown
  signal?: AbortSignal
}

interface HostQuestionOptionLike {
  label?: unknown
  description?: unknown
}
interface HostQuestionLike {
  id?: unknown
  question?: unknown
  header?: unknown
  detail?: unknown
  description?: unknown
  options?: readonly HostQuestionOptionLike[]
  multiSelect?: unknown
}
interface UserQuestionsRequestLike {
  questions?: readonly HostQuestionLike[]
  agent?: ApprovalAgentLike
  signal?: AbortSignal
  /** `wait.callId` keys the host's question card; absent on indefinite waits. */
  wait?: { callId?: unknown }
}
interface HostQuestionAnswerLike {
  id: string
  selected: string[]
  custom?: string
}
interface HostQuestionsAnswerLike {
  answers: HostQuestionAnswerLike[]
}

/** One settlement of a T4 answerer's await. The registry's `ask.settled`
 *  broadcast carries the outcome; `ask.response` params are stashed on the
 *  pending entry just before `answer()` so answers reach the questions mapper. */
interface AnswererSettlement {
  outcome: AskOutcome
  params?: AskResponseParams
}

/** Per-connection binding: the ONE handle this stdio connection owns. */
interface SessionBinding {
  sessionId: string
  handle: AgentHandleLike
}

type ExitRequest = (code: number) => void

interface ResolvedExit {
  fn: ExitRequest
  /** Which access path worked, recorded in the log for host-version debugging. */
  source: string
}

/** Resolve the host's bounded exit request (dsh-cmdline provides `appExit` via
 *  `ctx.provide`). `ctx.get` is preferred because it returns `undefined` for an
 *  absent service; the direct property access is a compatibility fallback for
 *  hosts that only expose provided services through the context proxy. */
function resolveAppExit(ctx: BridgeContext): ResolvedExit | undefined {
  try {
    if (typeof ctx.get === 'function') {
      const svc = ctx.get('appExit')
      if (typeof svc === 'function') return { fn: svc as ExitRequest, source: "ctx.get('appExit')" }
    }
  } catch {
    /* host without a get() service lookup */
  }
  try {
    const svc = ctx.appExit
    if (typeof svc === 'function') return { fn: svc as ExitRequest, source: 'ctx.appExit' }
  } catch {
    /* host that does not proxy provided services */
  }
  return undefined
}

export const name = 'dsh-opentui-bridge'

/** `agents` is required for the session seam; `typert` is the declarative
 *  inject of the generated capcontract bundle (v2.1 clause C) used by the
 *  startup handshake. `agentDefaultModel` and the other I-class services
 *  are optional and read through ctx.get. Cordis resolves inject before apply. */
export const inject: string[] = ['agents', ...HANDSHAKE_INJECT]

// ---- 024 base task5b: capcontract host adapter (oldfox R2/R3) ---------------

/** CapIR W ids with a hand-wired inproc host adapter. Single source: the ledger
 *  `methods[].in_wired` flag. check-capcontract reconciles this literal set
 *  against the ledger, so drift fails the gate.
 *  - S1 (4/257): session/list + the three model methods (sessionController seam).
 *  - S2 (+15 → 19/257): 12 `deepseekAccount` methods (10 unary + 2 stream) and
 *    3 `credentialsController` methods, on their own verified ctx.get seams.
 *  - S3 (+3 → 22/257): 3 `sessionController` push stream methods (observeEvent /
 *    observeState / observeProjections) — the CapIR push face, profile expected.
 *  All are profile/host W capabilities; no new host API surface is invented. */
export const CAP_HOST_WIRED_IDS: readonly string[] = [
  '@deepseek-ai/dsh-api-session-controller#session/list',
  '@deepseek-ai/dsh-api-session-controller#session/modelCatalog',
  '@deepseek-ai/dsh-api-session-controller#session/selectModel',
  '@deepseek-ai/dsh-api-session-controller#session/initializeDefaultModel',
  // 025-w1b B/C — session search/fork (sessionController seam, expected 75 gap closed)
  '@deepseek-ai/dsh-api-session-controller#session/search',
  '@deepseek-ai/dsh-api-session-controller#session/fork',
  // 025-w1b D — subagent prompt/user-interrupt (subagents service, expected 75 gap closed)
  '@deepseek-ai/dsh-subagent#subagents/prompt',
  '@deepseek-ai/dsh-subagent#subagents/interruptByUser',
  // S3 — session push streams (sessionController seam, shared with S1 model arms)
  '@deepseek-ai/dsh-api-session-controller#session/observeEvent',
  '@deepseek-ai/dsh-api-session-controller#session/observeState',
  '@deepseek-ai/dsh-api-session-controller#session/observeProjections',
  // S2 — account (dsh-deepseek-account, service key `deepseekAccount`)
  '@deepseek-ai/dsh-deepseek-account#account/cancelSignIn',
  '@deepseek-ai/dsh-deepseek-account#account/getBalance',
  '@deepseek-ai/dsh-deepseek-account#account/getNotificationContent',
  '@deepseek-ai/dsh-deepseek-account#account/getNotifications',
  '@deepseek-ai/dsh-deepseek-account#account/getProfile',
  '@deepseek-ai/dsh-deepseek-account#account/getState',
  '@deepseek-ai/dsh-deepseek-account#account/hasRunningAccountTasks',
  '@deepseek-ai/dsh-deepseek-account#account/reportNotificationEvent',
  '@deepseek-ai/dsh-deepseek-account#account/signOut',
  '@deepseek-ai/dsh-deepseek-account#account/startSignIn',
  '@deepseek-ai/dsh-deepseek-account#account/watch',
  '@deepseek-ai/dsh-deepseek-account#account/watchExpiry',
  // S2 — credentials (dsh-api-settings-controller, service key `credentialsController`)
  '@deepseek-ai/dsh-api-settings-controller#credentials/describe',
  '@deepseek-ai/dsh-api-settings-controller#credentials/set',
  '@deepseek-ai/dsh-api-settings-controller#credentials/unset',
  // S5 — settings document (dsh-api-settings-controller, service key
  // `settingsController`, rc.5 index.ts:86). describe/mutate land in the
  // profile patch file (cordis.patch.yml) that the /settings Host zone writes.
  '@deepseek-ai/dsh-api-settings-controller#settings/describe',
  '@deepseek-ai/dsh-api-settings-controller#settings/mutate',
]

/**
 * S3 / B2 fix — release a controller WE created when the consumer stops.
 *
 * S2 review concern B2: the stream arm used to `new AbortController()` when the
 * caller omitted a signal, then hand the iterable back with no release path —
 * the host subscription lived until GC. Wrapping in an async generator with a
 * `try/finally` makes release deterministic on `return()` / `throw()` / natural
 * completion; a caller-supplied signal is never aborted by us (ownership stays
 * explicit). Values and order are unchanged — the wrapper is transparent.
 */
export function withOwnedAbort<T>(source: AsyncIterable<T>, owned?: AbortController): AsyncIterable<T> {
  if (owned === undefined) return source
  return {
    async *[Symbol.asyncIterator]() {
      try {
        for await (const item of source) yield item
      } finally {
        owned.abort()
      }
    },
  }
}

/**
 * S3 / B2 — shipped-bundle self-check: drive a throwaway owned stream through
 * `withOwnedAbort`, close the iterator with `return()`, and report whether the
 * owned controller was released. No host surface is touched; both the smoke
 * (06-push-smoke.log) and the unit test call this same function.
 */
export async function probeOwnedAbortRelease(): Promise<boolean> {
  const owned = new AbortController()
  const source: AsyncIterable<number> = {
    async *[Symbol.asyncIterator]() {
      yield 1
      yield 2
    },
  }
  const iterator = withOwnedAbort(source, owned)[Symbol.asyncIterator]()
  await iterator.next()
  await iterator.return?.(undefined)
  return owned.signal.aborted
}

/**
 * S3: the host→client push relay, with invoke/emit injected so its ordering,
 * degrade and ownership rules are unit-testable without a live host. Shipped
 * bridge wires it to `createCapInvoke(ctx)` / `emitEvent` below.
 */
export const PUSH_RELAY_METHOD_IDS = [
  '@deepseek-ai/dsh-api-session-controller#session/observeEvent',
  '@deepseek-ai/dsh-api-session-controller#session/observeState',
  '@deepseek-ai/dsh-api-session-controller#session/observeProjections',
] as const

export interface PushRelayDeps {
  invoke(frame: { methodId: never; params: unknown }): Promise<unknown>
  emit(type: string, payload: Record<string, unknown>): void
  isClosing?(): boolean
}
export interface PushRelayHandle {
  start(sessionId: string): void
  stop(sessionId: string): void
  stopAll(): void
  activeCount(): number
}

/**
 * S3 / C-1: classify a failed push-stream error into a bounded, whitelisted
 * code for `cap.end`. Only the known prefix is kept — no message body, host
 * payload or stack is ever emitted (same desensitization law as `cap.event`).
 * This lets the seam / S4 tell "surface absent" (NOT_WIRED) from a host or
 * mid-stream error (HOST_ERROR) instead of collapsing both into one opaque
 * reason.
 */
export function classifyPushErrorCode(err: unknown): 'NOT_WIRED' | 'BAD_PARAMS' | 'BAD_KIND' | 'HOST_ERROR' {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (message.startsWith('NOT_WIRED')) return 'NOT_WIRED'
  if (message.startsWith('BAD_PARAMS')) return 'BAD_PARAMS'
  if (message.startsWith('BAD_KIND')) return 'BAD_KIND'
  return 'HOST_ERROR'
}

export function createPushRelay(deps: PushRelayDeps): PushRelayHandle {
  interface PushSubscription {
    readonly controller: AbortController
    seq: number
    task?: Promise<void>
  }
  const subs = new Map<string, PushSubscription>()
  const pushKey = (sessionId: string, methodId: string): string => `${sessionId}|${methodId}`
  const isClosing = (): boolean => deps.isClosing?.() === true

  async function run(sessionId: string, methodId: string, sub: PushSubscription): Promise<void> {
    try {
      const value = await deps.invoke({
        methodId: methodId as never,
        params: { sessionId, address: { kind: 'session', sessionId }, signal: sub.controller.signal },
      })
      const iterable = value as AsyncIterable<SessionPushFrameLike> | undefined
      if (iterable === null || typeof iterable !== 'object' || typeof iterable[Symbol.asyncIterator] !== 'function') {
        throw new Error('NOT_WIRED: push stream did not return an AsyncIterable')
      }
      for await (const item of iterable) {
        if (isClosing() || sub.controller.signal.aborted) break
        sub.seq += 1
        deps.emit('cap.event', {
          methodId,
          sessionId,
          seq: sub.seq,
          eventType: typeof item?.type === 'string' ? item.type.slice(0, 64) : 'event',
        })
      }
      if (!sub.controller.signal.aborted && !isClosing()) {
        deps.emit('cap.end', { methodId, sessionId, reason: 'stream-end' })
      }
    } catch (err: unknown) {
      // Explicit degrade: a missing/failed host push surface never crashes and
      // never fabricates events. C-1: keep the error class instead of swallowing
      // it — `reason` stays 'unavailable' (wire contract unchanged) while the
      // new whitelisted `code` carries the classification the seam / S4 needs to
      // tell "surface absent" from "host/stream error". No payload is emitted.
      if (!sub.controller.signal.aborted && !isClosing()) {
        deps.emit('cap.end', { methodId, sessionId, reason: 'unavailable', code: classifyPushErrorCode(err) })
      }
    } finally {
      const key = pushKey(sessionId, methodId)
      if (subs.get(key) === sub) subs.delete(key)
    }
  }

  return {
    start(sessionId: string): void {
      if (isClosing() || sessionId === '') return
      for (const methodId of PUSH_RELAY_METHOD_IDS) {
        const key = pushKey(sessionId, methodId)
        if (subs.has(key)) continue
        const sub: PushSubscription = { controller: new AbortController(), seq: 0 }
        subs.set(key, sub)
        sub.task = run(sessionId, methodId, sub)
      }
    },
    stop(sessionId: string): void {
      for (const [key, sub] of [...subs]) {
        if (!key.startsWith(`${sessionId}|`)) continue
        sub.controller.abort()
        subs.delete(key)
      }
    },
    stopAll(): void {
      for (const sub of subs.values()) sub.controller.abort()
      subs.clear()
    },
    activeCount(): number {
      return subs.size
    },
  }
}

/**
 * S4: client-driven account watch relay — the same four-piece-set lifecycle as
 * the S3 push relay, applied to `account/watch` + `account/watchExpiry`:
 *  (a) owned-signal release via `stop`/`stopAll` (+ hostInvoke's withOwnedAbort),
 *  (b) BAD_KIND / NOT_WIRED gates inherited from `createCapHostInvoke`,
 *  (c) `cap.end{reason,code}` degrade via `classifyPushErrorCode` (C-1),
 *  (d) per-subscription seq — seam orders by the (sessionId,methodId) composite
 *      key fixed in S3/BL-1. Explicit start/stop face: no auto-resubscribe.
 * Emits ONLY whitelisted fields; the authorize URL never reaches an emit.
 */
export const ACCOUNT_WATCH_RELAY_METHOD_IDS = [
  '@deepseek-ai/dsh-deepseek-account#account/watch',
  '@deepseek-ai/dsh-deepseek-account#account/watchExpiry',
] as const

export interface AccountWatchRelayDeps {
  invoke(frame: { methodId: never; params: unknown }): Promise<unknown>
  emit(type: string, payload: Record<string, unknown>): void
  isClosing?(): boolean
}
export interface AccountWatchRelayHandle {
  start(sessionId: string): void
  stop(sessionId: string): void
  stopAll(): void
  activeCount(): number
}

/** Host item -> bounded whitelist enum; unknown types collapse to 'event'.
 *  S4 review C1: rc.5 `watchExpiry` is `AsyncIterable<'session-expired'>`
 *  (dsh-deepseek-account/src/index.ts:585-590) — it yields a BARE STRING, not
 *  `{type:'expiry'}`. Without this arm the `'expiry'` enum was unreachable in
 *  production and the integration stub asserted a shape the host never emits. */
function accountWatchEventType(item: unknown): string {
  if (item === 'session-expired' || (typeof item === 'string' && /expired/i.test(item))) return 'expiry'
  const type = (item as { type?: unknown } | undefined)?.type
  if (type === 'snapshot' || type === 'credentials-changed' || type === 'expiry') return type
  return 'event'
}

export function createAccountWatchRelay(deps: AccountWatchRelayDeps): AccountWatchRelayHandle {
  interface WatchSub {
    readonly controller: AbortController
    seq: number
    task?: Promise<void>
  }
  const subs = new Map<string, WatchSub>()
  const watchKey = (sessionId: string, methodId: string): string => `${sessionId}|${methodId}`
  const isClosing = (): boolean => deps.isClosing?.() === true

  async function run(sessionId: string, methodId: string, sub: WatchSub): Promise<void> {
    try {
      const value = await deps.invoke({
        methodId: methodId as never,
        params: { sessionId, signal: sub.controller.signal },
      })
      const iterable = value as AsyncIterable<unknown> | undefined
      if (iterable === null || typeof iterable !== 'object' || typeof iterable[Symbol.asyncIterator] !== 'function') {
        throw new Error('NOT_WIRED: account watch stream did not return an AsyncIterable')
      }
      for await (const item of iterable) {
        if (isClosing() || sub.controller.signal.aborted) break
        sub.seq += 1
        // Fixed whitelist only: methodId / sessionId / seq / eventType.
        // Raw account state (and its authorizeUrl) is never forwarded.
        deps.emit('cap.event', {
          methodId,
          sessionId,
          seq: sub.seq,
          eventType: accountWatchEventType(item),
        })
      }
      if (!sub.controller.signal.aborted && !isClosing()) {
        deps.emit('cap.end', { methodId, sessionId, reason: 'stream-end' })
      }
    } catch (err: unknown) {
      if (!sub.controller.signal.aborted && !isClosing()) {
        deps.emit('cap.end', { methodId, sessionId, reason: 'unavailable', code: classifyPushErrorCode(err) })
      }
    } finally {
      const key = watchKey(sessionId, methodId)
      if (subs.get(key) === sub) subs.delete(key)
    }
  }

  return {
    start(sessionId: string): void {
      if (isClosing() || sessionId === '') return
      for (const methodId of ACCOUNT_WATCH_RELAY_METHOD_IDS) {
        const key = watchKey(sessionId, methodId)
        if (subs.has(key)) continue
        const sub: WatchSub = { controller: new AbortController(), seq: 0 }
        subs.set(key, sub)
        sub.task = run(sessionId, methodId, sub)
      }
    },
    stop(sessionId: string): void {
      // Exact composite-key match (no startsWith mis-abort — C-3 discipline).
      for (const methodId of ACCOUNT_WATCH_RELAY_METHOD_IDS) {
        const key = watchKey(sessionId, methodId)
        const sub = subs.get(key)
        if (sub === undefined) continue
        sub.controller.abort()
        subs.delete(key)
      }
    },
    stopAll(): void {
      for (const sub of subs.values()) sub.controller.abort()
      subs.clear()
    },
    activeCount(): number {
      return subs.size
    },
  }
}

/** S3: shared stream-signal validation. A non-AbortSignal `signal` is BAD_PARAMS
 *  and never reaches a host stream; absence is allowed (hostInvoke owns one). */
function streamSignalFrom(params: unknown, label: string): AbortSignal | undefined {
  const signal = (params as { signal?: unknown } | undefined)?.signal
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new Error(`BAD_PARAMS: ${label} signal must be an AbortSignal`)
  }
  return signal as AbortSignal | undefined
}

/** Bridge-owned host invocation for the generated dispatcher. Only wired ids
 *  reach a real host service; every other CapIR W id fails explicitly with
 *  NOT_WIRED (never silent success / an empty result). session/list reuses the
 *  verified resolveSessionController + controller.list wire shape from
 *  handleListSessions (index.ts:2010-2053) — no new host API is invented.
 *
 *  S1 model arms call the host SessionController's own @Remote methods
 *  (`modelCatalog` / `selectModel` / `initializeDefaultModel`) via the SAME
 *  resolved service; params are passed through with decidable validation so a
 *  bad selection is rejected (BAD_PARAMS) rather than reaching the host. */
/**
 * W2-0d deny-list namespaces (AMEND-1). Mirrors the generator's DENY_NS and
 * check-capcontract #14 exactly; these families only ever use their dedicated
 * hand-written arms + bespoke projection, never generic dispatch.
 */
export const GENERIC_DENY_NAMESPACES: ReadonlySet<string> = new Set(['account', 'credentials', 'settings'])

/** Production generic-arm config: generated tables verbatim + wrapped ctx.get.
 *  NO new cordis inject (R5 — inject stays ['agents', ...HANDSHAKE_INJECT]);
 *  the try/catch resolution lives in cap-generic.ts's getService contract. */
export function createProductionGenericConfig(ctx: BridgeContext): GenericCapConfig {
  return {
    adapters: CAP_GENERIC_ADAPTERS,
    services: CAP_SERVICE_TABLE,
    params: CAP_PARAMS_TABLE,
    projectedByHand: CAP_PROJECTED_BY_HAND,
    confirmIds: CAP_WRITE_CONFIRM_IDS,
    denyNamespaces: GENERIC_DENY_NAMESPACES,
    kindOf: (id) => lookupCapKind(id),
    getService: (service) => (typeof ctx.get === 'function' ? ctx.get(service) : undefined),
    // W2-0 scope-lookup fix: data-driven metadata from the generated table, plus
    // the one bridge-owned resolver seam. Production resolves the "agent" scope
    // through the EXISTING agents registry path (resolveAgents -> ctx.get('agents')
    // ?? ctx.agents, .get(id)) — the same `ctx.agents.get(agent.id) === agent`
    // identity the host goal service asserts (deepseek-harness-pr
    // packages/goal/goal/src/index.ts:472-475). No new cordis inject (R5); any
    // other context / absent registry fails closed inside resolveScopeArg.
    scopes: CAP_SCOPE_TABLE,
    resolveScope: (context, _wire, wireValue) => {
      if (context !== 'agent') return undefined
      const agents = resolveAgents(ctx)
      return agents === undefined ? undefined : agents.get(String(wireValue))
    },
  }
}

export function createCapHostInvoke(
  ctx: BridgeContext,
  generic: GenericCapConfig = createProductionGenericConfig(ctx),
): CapHostInvoke {
  return async (methodId, kind, params) => {
    // S1 (W2-0d): first gate is now (hand-written ∪ generic) union membership.
    // OLD first gate, kept VERBATIM for the wired-count round log (do not delete):
    //   if (!CAP_HOST_WIRED_IDS.includes(methodId)) {
    //     throw new Error(
    //       `NOT_WIRED: ${methodId} has no inproc host adapter (ledger in_wired=${CAP_HOST_WIRED_IDS.length}/257)`,
    //     )
    //   }
    // W2-1 round log (S-1): count text now uses the UNION size (hand 28 + generic
    // released N). OLD count line kept VERBATIM as the W2-0 base criterion:
    //   `NOT_WIRED: ${methodId} has no inproc host adapter (ledger in_wired=${CAP_HOST_WIRED_IDS.length}/257)`
    // At W2-0 base CAP_GENERIC_ADAPTERS was empty so 28/28 was correct; W2-1
    // releases 3 generic ids, so the two-sets-outside id now reports 31/257.
    // W2-2 round log: 7 pluginManager read ids join the set -> union 28+10=38.
    // OLD W2-1 count criterion kept VERBATIM above (do not delete).
    // W2-3 round log: 8 pluginManager write ids join the set -> union 28+18=46.
    // OLD W2-2 count criterion (38) kept VERBATIM in tests/docs (do not delete).
    // W2-4 round log: 5 directory ids (llm x3 / web / permissionPresets) join -> 28+23=51.
    // OLD W2-3 count criterion (46) kept VERBATIM in tests/docs (do not delete).
    // W2-5 round log: 7 goals ids join -> 28+30=58.
    // OLD W2-4 count criterion (51) kept VERBATIM in tests/docs (do not delete).
    const handWired = (CAP_HOST_WIRED_IDS as readonly string[]).includes(methodId)
    const genericReleased = generic.adapters.has(methodId)
    if (!handWired && !genericReleased) {
      throw new Error(
        `NOT_WIRED: ${methodId} has no inproc host adapter (ledger in_wired=${CAP_HOST_WIRED_IDS.length + generic.adapters.size}/257)`,
      )
    }

    // §3.1 generic arm — checked before the per-family chain so ids sharing a
    // hand-written namespace prefix (e.g. a future session/create) are not
    // swallowed by that family's default arm. `!handWired` makes the per-id arm
    // strictly win if an id is ever in both sets (S2 disjointness is a gate).
    if (genericReleased && !handWired) {
      return invokeGenericCap(generic, methodId, kind, params)
    }

    // --- S1 session/model family (unchanged arm bodies) ----------------------
    if (methodId.startsWith('@deepseek-ai/dsh-api-session-controller#')) {
      const controller = resolveSessionController(ctx)
      if (controller === undefined) {
        throw new Error(`NOT_WIRED: sessionController unavailable for ${methodId}`)
      }
      switch (methodId) {
        case '@deepseek-ai/dsh-api-session-controller#session/list': {
          const cursor = (params as { cursor?: unknown } | undefined)?.cursor
          if (cursor !== undefined && typeof cursor !== 'string') {
            throw new Error('BAD_PARAMS: session.list cursor must be a string')
          }
          return controller.list({ _request: cursor !== undefined ? { cursor } : {} })
        }
        case '@deepseek-ai/dsh-api-session-controller#session/modelCatalog': {
          if (typeof controller.modelCatalog !== 'function') {
            throw new Error(`NOT_WIRED: sessionController.modelCatalog unavailable for ${methodId}`)
          }
          return controller.modelCatalog()
        }
        case '@deepseek-ai/dsh-api-session-controller#session/selectModel': {
          if (typeof controller.selectModel !== 'function') {
            throw new Error(`NOT_WIRED: sessionController.selectModel unavailable for ${methodId}`)
          }
          const p = params as Partial<SessionSelectModelRequestLike> | undefined
          if (typeof p?.sessionId !== 'string' || p.sessionId === '') {
            throw new Error('BAD_PARAMS: session.selectModel sessionId must be a non-empty string')
          }
          if (typeof p?.provider !== 'string' || p.provider === '') {
            throw new Error('BAD_PARAMS: session.selectModel provider must be a non-empty string')
          }
          if (typeof p?.model !== 'string' || p.model === '') {
            throw new Error('BAD_PARAMS: session.selectModel model must be a non-empty string')
          }
          const request: SessionSelectModelRequestLike = {
            sessionId: p.sessionId,
            provider: p.provider,
            model: p.model,
          }
          if (typeof p.reasoningEffort === 'string') request.reasoningEffort = p.reasoningEffort
          return controller.selectModel(request)
        }
        case '@deepseek-ai/dsh-api-session-controller#session/initializeDefaultModel': {
          if (typeof controller.initializeDefaultModel !== 'function') {
            throw new Error(`NOT_WIRED: sessionController.initializeDefaultModel unavailable for ${methodId}`)
          }
          return controller.initializeDefaultModel()
        }
        // ---- 025-w1b B/C: search / fork (unary, read-only except fork seeds a
        // new session). Both optional on the host; a missing method is NOT_WIRED.
        case '@deepseek-ai/dsh-api-session-controller#session/search': {
          if (typeof controller.search !== 'function') {
            throw new Error(`NOT_WIRED: sessionController.search unavailable for ${methodId}`)
          }
          const p = params as { query?: unknown } | undefined
          if (typeof p?.query !== 'string') {
            throw new Error('BAD_PARAMS: session.search query must be a string')
          }
          // The host read takes an AbortSignal; a unary stdio frame carries no
          // caller signal, so use an owned, never-aborted one (mirrors other
          // unary reads — no transport cancellation channel for a single frame).
          return controller.search({ query: p.query }, new AbortController().signal)
        }
        case '@deepseek-ai/dsh-api-session-controller#session/fork': {
          if (typeof controller.fork !== 'function') {
            throw new Error(`NOT_WIRED: sessionController.fork unavailable for ${methodId}`)
          }
          const p = params as { sessionId?: unknown; atSeq?: unknown; allowMigration?: unknown } | undefined
          if (typeof p?.sessionId !== 'string' || p.sessionId === '') {
            throw new Error('BAD_PARAMS: session.fork sessionId must be a non-empty string')
          }
          const request: { sessionId: string; atSeq?: number; allowMigration?: boolean } = { sessionId: p.sessionId }
          if (typeof p.atSeq === 'number' && Number.isFinite(p.atSeq)) request.atSeq = p.atSeq
          if (typeof p.allowMigration === 'boolean') request.allowMigration = p.allowMigration
          return controller.fork(request)
        }
        // ---- S3 push streams (kind-gated; hostInvoke returns the AsyncIterable,
        // does NOT consume it — the relay / caller owns cancellation) ----------
        case '@deepseek-ai/dsh-api-session-controller#session/observeEvent':
        case '@deepseek-ai/dsh-api-session-controller#session/observeState':
        case '@deepseek-ai/dsh-api-session-controller#session/observeProjections': {
          if (kind !== 'stream') {
            throw new Error(`BAD_KIND: ${methodId} requires stream transport`)
          }
          const p = params as {
            sessionId?: unknown
            address?: { kind?: unknown; sessionId?: unknown }
          } | undefined
          // Accept the host-native `{address:{kind:'session',sessionId}}` shape and
          // the minimal `{sessionId}` shorthand; both carry a sessionId (v3 §3.1).
          const addr = p?.address
          const sessionId = (addr?.kind === 'session' ? addr.sessionId : undefined) ?? p?.sessionId
          if (typeof sessionId !== 'string' || sessionId === '') {
            throw new Error('BAD_PARAMS: session push stream requires a non-empty sessionId')
          }
          const signal = streamSignalFrom(params, 'session stream')
          const owned = signal === undefined ? new AbortController() : undefined
          const useSignal = signal ?? owned!.signal
          if (methodId.endsWith('/observeEvent')) {
            if (typeof controller.observeEvent !== 'function') {
              throw new Error(`NOT_WIRED: sessionController.observeEvent unavailable for ${methodId}`)
            }
            return withOwnedAbort(
              controller.observeEvent({ address: { kind: 'session', sessionId } }, useSignal),
              owned,
            )
          }
          if (methodId.endsWith('/observeState')) {
            if (typeof controller.observeState !== 'function') {
              throw new Error(`NOT_WIRED: sessionController.observeState unavailable for ${methodId}`)
            }
            return withOwnedAbort(controller.observeState({ sessionId }, useSignal), owned)
          }
          if (typeof controller.observeProjections !== 'function') {
            throw new Error(`NOT_WIRED: sessionController.observeProjections unavailable for ${methodId}`)
          }
          return withOwnedAbort(controller.observeProjections({ sessionId }, useSignal), owned)
        }
        default:
          throw new Error(`NOT_WIRED: ${methodId} has no host arm`)
      }
    }

    // --- S2 account family (dsh-deepseek-account#account/*) ------------------
    if (methodId.startsWith('@deepseek-ai/dsh-deepseek-account#')) {
      const account = resolveDeepSeekAccount(ctx)
      if (account === undefined) {
        throw new Error(`NOT_WIRED: deepseekAccount unavailable for ${methodId}`)
      }
      const short = methodId.slice(methodId.indexOf('#') + 1) // "account/<name>"
      // stream methods are dispatched by the generated CAP_DISPATCH_TABLE kind;
      // the host methods are async generators returning AsyncIterable. We return
      // the iterable (do NOT consume on the bridge); the caller owns the signal.
      if (short === 'account/watch' || short === 'account/watchExpiry') {
        if (kind !== 'stream') {
          throw new Error(`BAD_KIND: ${methodId} requires stream transport`)
        }
        const signal = streamSignalFrom(params, 'account stream')
        const ownController = signal === undefined ? new AbortController() : undefined
        const useSignal = signal ?? ownController!.signal
        if (short === 'account/watchExpiry') {
          if (typeof account.watchExpiry !== 'function') {
            throw new Error(`NOT_WIRED: deepseekAccount.watchExpiry unavailable for ${methodId}`)
          }
          return withOwnedAbort(account.watchExpiry(useSignal), ownController)
        }
        const watchFn = account.watchState ?? account.watch
        if (typeof watchFn !== 'function') {
          throw new Error(`NOT_WIRED: deepseekAccount.watch unavailable for ${methodId}`)
        }
        // B2: own controller is aborted on return/throw/natural done (or when the
        // caller signal settles — the host receives the same useSignal either way).
        return withOwnedAbort(watchFn.call(account, useSignal, false), ownController)
      }
      // unary methods — params validated with decidable checks; NO logging of
      // params/values anywhere in this arm (desensitization discipline).
      switch (short) {
        case 'account/getState': {
          if (typeof account.getState !== 'function') throw new Error(`NOT_WIRED: deepseekAccount.getState unavailable`)
          return account.getState()
        }
        case 'account/hasRunningAccountTasks': {
          if (typeof account.hasRunningAccountTasks !== 'function') throw new Error(`NOT_WIRED: deepseekAccount.hasRunningAccountTasks unavailable`)
          return account.hasRunningAccountTasks()
        }
        case 'account/getProfile':
        case 'account/getBalance':
        case 'account/getNotifications': {
          const name = short.slice('account/'.length) as 'getProfile' | 'getBalance' | 'getNotifications'
          const fn = account[name]
          if (typeof fn !== 'function') throw new Error(`NOT_WIRED: deepseekAccount.${name} unavailable`)
          const p = params as { client?: AccountClientMetaLike } | undefined
          if (!isAccountClientMeta(p?.client)) throw new Error(`BAD_PARAMS: ${short} client metadata required`)
          return fn.call(account, p.client)
        }
        case 'account/getNotificationContent': {
          if (typeof account.getNotificationContent !== 'function') throw new Error(`NOT_WIRED: deepseekAccount.getNotificationContent unavailable`)
          const p = params as { id?: unknown; client?: AccountClientMetaLike } | undefined
          if (typeof p?.id !== 'string' || p.id === '') throw new Error('BAD_PARAMS: account.getNotificationContent id required')
          if (!isAccountClientMeta(p.client)) throw new Error('BAD_PARAMS: account.getNotificationContent client metadata required')
          return account.getNotificationContent(p.id, p.client)
        }
        case 'account/reportNotificationEvent': {
          if (typeof account.reportNotificationEvent !== 'function') throw new Error(`NOT_WIRED: deepseekAccount.reportNotificationEvent unavailable`)
          const p = params as { id?: unknown; event?: unknown; client?: AccountClientMetaLike } | undefined
          if (typeof p?.id !== 'string' || p.id === '') throw new Error('BAD_PARAMS: account.reportNotificationEvent id required')
          if (p.event !== 'displayed' && p.event !== 'cta_clicked' && p.event !== 'dismissed') {
            throw new Error('BAD_PARAMS: account.reportNotificationEvent event invalid')
          }
          if (!isAccountClientMeta(p.client)) throw new Error('BAD_PARAMS: account.reportNotificationEvent client metadata required')
          return account.reportNotificationEvent(p.id, p.event, p.client)
        }
        case 'account/startSignIn': {
          if (typeof account.startSignIn !== 'function') throw new Error(`NOT_WIRED: deepseekAccount.startSignIn unavailable`)
          const p = params as { client?: AccountClientMetaLike; callbackOrigin?: unknown; loginSource?: unknown } | undefined
          if (!isAccountClientMeta(p?.client)) throw new Error('BAD_PARAMS: account.startSignIn client metadata required')
          if (typeof p?.callbackOrigin !== 'string' || p.callbackOrigin === '') throw new Error('BAD_PARAMS: account.startSignIn callbackOrigin required')
          if (p.loginSource !== 'web' && p.loginSource !== 'desktop') throw new Error('BAD_PARAMS: account.startSignIn loginSource must be web|desktop')
          return account.startSignIn(p.client, p.callbackOrigin, p.loginSource)
        }
        case 'account/cancelSignIn': {
          if (typeof account.cancelSignIn !== 'function') throw new Error(`NOT_WIRED: deepseekAccount.cancelSignIn unavailable`)
          const p = params as { attemptId?: unknown } | undefined
          if (typeof p?.attemptId !== 'string' || p.attemptId === '') throw new Error('BAD_PARAMS: account.cancelSignIn attemptId required')
          return account.cancelSignIn(p.attemptId)
        }
        case 'account/signOut': {
          if (typeof account.signOut !== 'function') throw new Error(`NOT_WIRED: deepseekAccount.signOut unavailable`)
          const p = params as { client?: AccountClientMetaLike } | undefined
          if (!isAccountClientMeta(p?.client)) throw new Error('BAD_PARAMS: account.signOut client metadata required')
          return account.signOut(p.client)
        }
        default:
          throw new Error(`NOT_WIRED: ${methodId} has no host arm`)
      }
    }

    // --- S5 settings document family (dsh-api-settings-controller#settings/*) ---
    // Must precede the credentials arm (both share the package prefix). The
    // host's settingsController already redacts secret values; we pass the
    // document view / namespace view through verbatim — no frame payload is
    // copied into logs and no credential VALUE is ever echoed.
    if (methodId.startsWith('@deepseek-ai/dsh-api-settings-controller#settings/')) {
      const settingsSvc = resolveSettingsController(ctx)
      if (settingsSvc === undefined) {
        throw new Error(`NOT_WIRED: settingsController unavailable for ${methodId}`)
      }
      const short = methodId.slice(methodId.indexOf('#') + 1) // "settings/<name>"
      switch (short) {
        case 'settings/describe': {
          if (typeof settingsSvc.describe !== 'function') throw new Error(`NOT_WIRED: settingsController.describe unavailable`)
          return settingsSvc.describe()
        }
        case 'settings/mutate': {
          if (typeof settingsSvc.mutate !== 'function') throw new Error(`NOT_WIRED: settingsController.mutate unavailable`)
          const p = params as { ns?: unknown; ops?: unknown; expectedRevision?: unknown } | undefined
          if (typeof p?.ns !== 'string' || p.ns === '') throw new Error('BAD_PARAMS: settings.mutate ns must be a non-empty string')
          if (!Array.isArray(p.ops)) throw new Error('BAD_PARAMS: settings.mutate ops must be an array')
          if (p.expectedRevision !== undefined && typeof p.expectedRevision !== 'number') {
            throw new Error('BAD_PARAMS: settings.mutate expectedRevision must be a number')
          }
          return settingsSvc.mutate(p.ns, p.ops, p.expectedRevision as number | undefined)
        }
        default:
          throw new Error(`NOT_WIRED: ${methodId} has no host arm`)
      }
    }

    // --- S2 credentials family (dsh-api-settings-controller#credentials/*) ---
    if (methodId.startsWith('@deepseek-ai/dsh-api-settings-controller#')) {
      const creds = resolveCredentialsController(ctx)
      if (creds === undefined) {
        throw new Error(`NOT_WIRED: credentialsController unavailable for ${methodId}`)
      }
      const short = methodId.slice(methodId.indexOf('#') + 1) // "credentials/<name>"
      switch (short) {
        case 'credentials/describe': {
          if (typeof creds.describe !== 'function') throw new Error(`NOT_WIRED: credentialsController.describe unavailable`)
          const p = params as { refs?: unknown } | undefined
          if (!Array.isArray(p?.refs) || p.refs.some((r) => typeof r !== 'string')) {
            throw new Error('BAD_PARAMS: credentials.describe refs must be a string array')
          }
          return creds.describe(p.refs as string[])
        }
        case 'credentials/set': {
          if (typeof creds.set !== 'function') throw new Error(`NOT_WIRED: credentialsController.set unavailable`)
          const p = params as { ref?: unknown; value?: unknown } | undefined
          if (typeof p?.ref !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.ref)) {
            throw new Error('BAD_PARAMS: credentials.set ref must match credential grammar')
          }
          if (typeof p?.value !== 'string' || p.value === '') {
            throw new Error('BAD_PARAMS: credentials.set value must be a non-empty string')
          }
          // The sensitive value is passed to the host and NEVER logged/echoed.
          return creds.set(p.ref, p.value)
        }
        case 'credentials/unset': {
          if (typeof creds.unset !== 'function') throw new Error(`NOT_WIRED: credentialsController.unset unavailable`)
          const p = params as { ref?: unknown } | undefined
          if (typeof p?.ref !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.ref)) {
            throw new Error('BAD_PARAMS: credentials.unset ref must match credential grammar')
          }
          return creds.unset(p.ref)
        }
        default:
          throw new Error(`NOT_WIRED: ${methodId} has no host arm`)
      }
    }

    // --- 025-w1b D — subagent control family (dsh-subagent#subagents/*) --------
    if (methodId.startsWith('@deepseek-ai/dsh-subagent#')) {
      let runtime: SubagentRuntimeLike | undefined
      try {
        runtime = typeof ctx.get === 'function' ? (ctx.get('subagents') as SubagentRuntimeLike) : undefined
      } catch { runtime = undefined }
      if (runtime === undefined) {
        throw new Error(`NOT_WIRED: subagents service unavailable for ${methodId}`)
      }
      const short = methodId.slice(methodId.indexOf('#') + 1)
      if (short === 'subagents/prompt') {
        if (typeof runtime.prompt !== 'function') {
          throw new Error(`NOT_WIRED: subagents.prompt unavailable for ${methodId}`)
        }
        const p = params as Partial<SubagentPromptRequestLike> | undefined
        if (typeof p?.childSessionId !== 'string' || p.childSessionId === '') {
          throw new Error('BAD_PARAMS: subagents.prompt childSessionId must be a non-empty string')
        }
        if (typeof p.requestId !== 'string' || p.requestId === '') {
          throw new Error('BAD_PARAMS: subagents.prompt requestId must be a non-empty string')
        }
        if (!Array.isArray(p.content) || p.content.length === 0 ||
            p.content.some((part) => part?.type !== 'text' || typeof part.text !== 'string')) {
          throw new Error('BAD_PARAMS: subagents.prompt content must be a non-empty text-part array')
        }
        const request: SubagentPromptRequestLike = {
          requestId: p.requestId,
          childSessionId: p.childSessionId,
          delivery: p.delivery === 'queue' ? 'queue' : 'steer',
          content: p.content.map((part) => ({ type: 'text', text: part.text })),
        }
        if (typeof p.clientTimeZone === 'string') request.clientTimeZone = p.clientTimeZone
        // The host control read takes a signal; a unary stdio frame has none.
        return runtime.prompt(request, new AbortController().signal)
      }
      if (short === 'subagents/interruptByUser') {
        if (typeof runtime.interruptByUser !== 'function') {
          throw new Error(`NOT_WIRED: subagents.interruptByUser unavailable for ${methodId}`)
        }
        const p = params as { childSessionId?: unknown } | undefined
        if (typeof p?.childSessionId !== 'string' || p.childSessionId === '') {
          throw new Error('BAD_PARAMS: subagents.interruptByUser childSessionId must be a non-empty string')
        }
        return runtime.interruptByUser(p.childSessionId)
      }
      throw new Error(`NOT_WIRED: ${methodId} has no host arm`)
    }

    // Unreachable: every CAP_HOST_WIRED_IDS member belongs to a family above.
    throw new Error(`NOT_WIRED: ${methodId} has no host arm`)
  }
}

/** Real shipped-bundle export: wire frame -> binder -> dispatcher -> injected
 *  host adapter. The W-roundtrip smoke drives this export (no injected copy). */
export function createCapInvoke(ctx: BridgeContext): WireFrameHandler {
  return createProjectionBinder(createCapHostInvoke(ctx))
}

/**
 * S1 /model — client-facing wire method names → CapIR W ids, served through the
 * GENERATED capcontract chain (`createCapInvoke` → binder → dispatcher → the
 * host adapter above). This is a TABLE LOOKUP, deliberately not a hand-copied
 * per-name dispatch comparison line: it keeps the @manual surface at 11 (the
 * `model.currentSelection` hand-wire is removed) while routing the model
 * frames through the same W path the handshake/smoke exercise.
 *
 * `model.currentSelection` maps to `modelCatalog` and is projected back to the
 * `{provider, model, reasoningEffort?}` reply shape the seam reads at boot —
 * `ModelCatalog.default` IS `agentDefaultModel.currentSelection()` on the host
 * (`catalog.ts:20` defaultSelection), so this is behaviour-equivalent to the
 * removed hand-wire, not a fabricated selection.
 */
const CAP_MODEL_WIRE_METHODS: Readonly<Record<string, string>> = {
  'model.currentSelection': '@deepseek-ai/dsh-api-session-controller#session/modelCatalog',
  'modelCatalog': '@deepseek-ai/dsh-api-session-controller#session/modelCatalog',
  'selectModel': '@deepseek-ai/dsh-api-session-controller#session/selectModel',
  'initializeDefaultModel': '@deepseek-ai/dsh-api-session-controller#session/initializeDefaultModel',
}
/** The one wire name whose reply is projected back to the boot selection shape.
 *  A named constant keeps this branch out of the @manual `req.method` inventory
 *  (it is a reply-shape projection inside generated dispatch, not a hand-wire). */
const CAP_SELECTION_READ_METHOD = 'model.currentSelection'

/**
 * 0.24 final knife — `session.list` joins the generated capcontract chain on
 * the S1 model template. Same table-lookup shape as CAP_MODEL_WIRE_METHODS:
 * the client-facing wire frame name is preserved (seam/client zero change),
 * but the 1:1 host call is no longer a hand-copied `controller.list(...)` line.
 * It rides createCapInvoke -> binder -> dispatcher -> createCapHostInvoke's
 * `session/list` arm, which reuses resolveSessionController (no new host API).
 */
const CAP_SESSION_WIRE_METHODS: Readonly<Record<string, string>> = {
  'session.list': '@deepseek-ai/dsh-api-session-controller#session/list',
}

/**
 * 025-w1b B/C — client-facing frame names → CapIR W ids for session search/fork,
 * served through the SAME generated capcontract chain (table lookup, NOT a
 * hand-copied `req.method ===` line — keeps the @manual surface at 10). Kept in
 * a SEPARATE table from CAP_SESSION_WIRE_METHODS because their reply shapes differ
 * from session.list (search → {items}, fork → {sessionId}), each projected in
 * handleLine before replyOk.
 */
const CAP_SESSION_QUERY_WIRE_METHODS: Readonly<Record<string, string>> = {
  'session.search': '@deepseek-ai/dsh-api-session-controller#session/search',
  'session.fork': '@deepseek-ai/dsh-api-session-controller#session/fork',
}

/** S5 /settings — client-facing wire method names → CapIR W ids for the two
 *  settings-document methods, served through the SAME generated capcontract
 *  chain as the model frames (table lookup, NOT a hand-copied `req.method ===`
 *  line — keeps the @manual wired surface at 11). `settings/conflict` from the
 *  host is preserved as a protocol code so the seam's optimistic-lock retry
 *  can tell a stale revision apart from a transport failure. */
const CAP_SETTINGS_WIRE_METHODS: Readonly<Record<string, string>> = {
  'settings.describe': '@deepseek-ai/dsh-api-settings-controller#settings/describe',
  'settings.mutate': '@deepseek-ai/dsh-api-settings-controller#settings/mutate',
}

/**
 * S4b (R1) — client-facing wire method names → CapIR W ids for the 10 UNARY
 * account methods, served through the SAME generated capcontract chain as the
 * model/settings frames (table lookup, NOT a hand-copied `req.method ===`
 * line — keeps the @manual surface at 11). The 2 stream methods
 * (account/watch, account/watchExpiry) are deliberately NOT here: they are
 * carried by `createAccountWatchRelay` (S5 C4 wiring), which owns the signal
 * and emits whitelisted `cap.event` frames; a stdio unary reply cannot carry
 * an AsyncIterable. Every reply is projected field-by-field — the four
 * AccountView-returning methods via `projectAccountViewForFrame` (URL value
 * contributes one boolean only), the rest via `projectAccountScalarResult`.
 * No host text / URL / credential value is copied into a frame.
 */
const CAP_ACCOUNT_WIRE_METHODS: Readonly<Record<string, string>> = {
  'account.getState': '@deepseek-ai/dsh-deepseek-account#account/getState',
  'account.hasRunningAccountTasks': '@deepseek-ai/dsh-deepseek-account#account/hasRunningAccountTasks',
  'account.getProfile': '@deepseek-ai/dsh-deepseek-account#account/getProfile',
  'account.getBalance': '@deepseek-ai/dsh-deepseek-account#account/getBalance',
  'account.getNotifications': '@deepseek-ai/dsh-deepseek-account#account/getNotifications',
  'account.getNotificationContent': '@deepseek-ai/dsh-deepseek-account#account/getNotificationContent',
  'account.reportNotificationEvent': '@deepseek-ai/dsh-deepseek-account#account/reportNotificationEvent',
  'account.startSignIn': '@deepseek-ai/dsh-deepseek-account#account/startSignIn',
  'account.cancelSignIn': '@deepseek-ai/dsh-deepseek-account#account/cancelSignIn',
  'account.signOut': '@deepseek-ai/dsh-deepseek-account#account/signOut',
}
/** The four account wire methods whose host result is an AccountView; their
 *  reply MUST be `projectAccountViewForFrame` (not key-name stripping). */
const ACCOUNT_VIEW_WIRE_METHODS: ReadonlySet<string> = new Set([
  'account.getState', 'account.startSignIn', 'account.cancelSignIn', 'account.signOut',
])

/**
 * 025-w1b D — client-facing frame names → CapIR W ids for the two subagent
 * control methods (prompt = steer, interruptByUser = user-level interrupt).
 * Table lookup on the generated chain (NOT a hand-copied wire line). These are
 * DISTINCT from the ADR-0010 protocol frames `subagents.interrupt` /
 * `subagents.stopChildren` (binding-gated roster stop) — do not merge them.
 */
const CAP_SUBAGENT_WIRE_METHODS: Readonly<Record<string, string>> = {
  'subagents.prompt': '@deepseek-ai/dsh-subagent#subagents/prompt',
  'subagents.interruptByUser': '@deepseek-ai/dsh-subagent#subagents/interruptByUser',
}

/**
 * M3-02 assembly seam. registerAppendSection is deliberately NOT called from
 * apply(): ADR-0010 requires the section to be registered at AGENT scope
 * ("scope 注册，禁 global"), and the only agent-scoped handle is the
 * `setup: (agentCtx) => ...` callback on session.open's create/resume — that
 * wiring is M3-04 (below). This thin, testable helper is the single assembly
 * point: callers pass the agent-scoped ctx. Keeping it out of the session.open
 * block also keeps this task clear of the ask-channel diff.
 */
export function armAppendSection(
  ctx: BridgeContext,
  options: RegisterAppendSectionOptions = {},
): () => void {
  return registerAppendSection(ctx, options)
}

/**
 * M3-04 — build the agent-scoped `setup` callback for one `session.open`.
 *
 * Host contract (dsh-agent `lib/types/index.d.ts:41`): `AgentSetup` returns an
 * optional synchronous `AgentSetupCommit` (`{ commit() }`) or void — NOT a
 * disposer. A setup throw/rejection rolls the whole Agent creation back
 * (`:96-97`). Therefore:
 *  - we call `armAppendSection` for its side effect and IGNORE its returned
 *    cleanup; the section disposer is held on `agentCtx.effect` inside
 *    `registerAppendSection`, so agent-scope disposal tears it down (`:92-95`);
 *  - every failure is contained to one `logger.warn`, never rethrown.
 *
 * `sessionId` is captured here only for the containment warning. The section
 * text provider is unconditional: append content is always returned from
 * APPEND_SYSTEM.md (M3-05 removed the preset-id-driven `shouldSuppress`, which
 * could only swallow content because inproc mounts no `agentPresets` service).
 */
function makeAppendSectionSetup(
  logger: Logger,
  sessionId: string,
): (agentCtx: BridgeContext) => void {
  return (agentCtx: BridgeContext) => {
    try {
      armAppendSection(agentCtx)
    } catch (err) {
      logger.warn('[dsh-opentui-bridge] append section setup failed for %s (plugin stays live): %s', sessionId, err)
    }
  }
}

/** ADR-0011 T3: one AskRegistry per stdio connection (= one `apply()` call).
 *  Keyed by ctx rather than a module global so concurrent harnesses/tests stay
 *  isolated. Tests use this to inspect pending ids / settlements / timers. */
const askRegistries = new WeakMap<BridgeContext, AskRegistry>()
export function getAskRegistry(ctx: BridgeContext): AskRegistry | undefined {
  return askRegistries.get(ctx)
}

const PROTOCOL_VERSION = 1
const STDIO_SWITCH = 'DSH_OPENTUI_BRIDGE_STDIO'
/** 024 base task5b (oldfox R4.3): env-gated W roundtrip smoke. When set, the
 *  shipped bundle drives the REAL exported `createCapInvoke` (binder -> dispatch
 *  -> injected host adapter) against the live ctx — no injected dispatcher copy. */
const CAP_SMOKE_SWITCH = 'DSH_OPENTUI_CAP_SMOKE'
/** Additive capabilities advertised in the bridge.hello / bridge.ping reply.
 *  An older client that never sees this field has NO capability and keeps its
 *  legacy roster-walk behaviour; a new client gates the stop frame on it. */
const BRIDGE_CAPABILITIES = ['subagents.interrupt', 'subagents.stopChildren'] as const
/** Upper bound on remembered finalized turn ids for abort idempotency (D3).
 *  The set is a FIFO: once more than this many turns have finalized, the oldest
 *  id is evicted. An evicted id is no longer remembered, so a late repeated
 *  `turn.abort` for it is answered TURN_NOT_FOUND rather than a noop. */
const TERMINAL_TURN_ID_LIMIT = 64

/** Walk up from a file path until a package.json with the wanted name is found. */
function findPackageVersion(entryFile: string, wantedName: string): string | undefined {
  try {
    let dir = dirname(realpathSync(entryFile))
    for (let i = 0; i < 12 && dir !== dirname(dir); i++) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
        if (pkg?.name === wantedName && typeof pkg.version === 'string') return pkg.version
      } catch {
        /* not a package root (or unreadable) — keep walking */
      }
      dir = dirname(dir)
    }
  } catch {
    /* entry file unresolvable */
  }
  return undefined
}

/** This bridge's own version, read from the package.json shipped next to the bundle. */
function readBridgeVersion(): string {
  try {
    const url = new URL('./package.json', import.meta.url)
    const pkg = JSON.parse(readFileSync(url, 'utf8'))
    if (typeof pkg.version === 'string') return pkg.version
  } catch {
    /* bundle without a sibling package.json */
  }
  return 'unknown'
}

/** Host version from the running dsh installation.
 *  process.argv[1] is the `dsh` bin (a symlink), so realpath it first, then
 *  walk up to the @deepseek-ai/dsh package.json and read its `version`. */
function readHostVersion(): string {
  if (process.argv[1]) {
    const v = findPackageVersion(process.argv[1], '@deepseek-ai/dsh')
    if (v) return v
  }
  // Fallback: resolve from this bundle (works when symlinks are preserved).
  try {
    const req = createRequire(import.meta.url)
    const path = req.resolve('@deepseek-ai/dsh/package.json')
    const pkg = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof pkg.version === 'string') return pkg.version
  } catch {
    /* resolution not available in this installation */
  }
  return 'unknown'
}

/** Resolve `ctx.agents` through the injected property or ctx.get fallback. */
function resolveAgents(ctx: BridgeContext): AgentsLike | undefined {
  const fromGet = typeof ctx.get === 'function' ? ctx.get('agents') : undefined
  const svc = fromGet ?? ctx.agents
  return svc !== undefined && typeof (svc as AgentsLike).create === 'function'
    ? (svc as AgentsLike)
    : undefined
}

/** Resolve the optional host default-model service without hard-injecting it. */
function resolveDefaultModel(ctx: BridgeContext): DefaultModelLike | undefined {
  const fromGet = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined
  const svc = fromGet ?? ctx.agentDefaultModel
  return svc !== undefined && typeof (svc as DefaultModelLike).currentSelection === 'function'
    ? (svc as DefaultModelLike)
    : undefined
}

/** Resolve `ctx.sessionPersistence` through the service lookup (with a direct
 *  property fallback for hosts that only proxy provided services). */
function resolvePersistence(ctx: BridgeContext): PersistenceLike | undefined {
  const fromGet = typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : undefined
  const svc = fromGet ?? ctx.sessionPersistence
  return svc !== undefined && typeof (svc as PersistenceLike).open === 'function'
    ? (svc as PersistenceLike)
    : undefined
}

/**
 * ADR-0011 T7 — lazily resolve the host's plugin-record writer.
 *
 * Source-verified mechanism (dsh-session 0.2.2-rc.3):
 * - `src/types.ts:532-545` defines `PluginRecordType = plugin:<lowercase path>`
 *   and records are `ignorable:true`, so readers that do not own the type skip
 *   them while fork/resume carry them with the log. This is the sanctioned seam
 *   for out-of-repo plugin state; an arbitrary `session.append('ask.*', …)`
 *   would create an UNKNOWN REQUIRED event and make resume refuse to reconstruct.
 * - `src/index.ts:498-504,919-946` exports `appendPluginRecord(session, type,
 *   data)`, which commits exactly such an ignorable record with the next seq.
 * - The live Session is reached through the answerer's `req.agent.session`
 *   (dsh-user-approval/src/index.ts:243 uses the same object for its own
 *   `approval/asked` / `approval/decided` audit events).
 *
 * We deliberately do NOT add a static `@deepseek-ai/dsh-session` import: that
 * broke clean npm-prefix installs before (see the note at the top of this file)
 * and the build keeps the whole scope external. `createRequire` is already the
 * host-version probe's pattern (readHostVersion above); it is contained here so
 * a host without the package degrades to "no journal write", never a crash.
 */
type AppendPluginRecordFn = (session: unknown, type: string, data: unknown) => unknown
let cachedAppendPluginRecord: AppendPluginRecordFn | undefined
let appendPluginRecordResolved = false
function resolveAppendPluginRecord(): AppendPluginRecordFn | undefined {
  if (appendPluginRecordResolved) return cachedAppendPluginRecord
  appendPluginRecordResolved = true
  // Resolution roots, in order:
  // 1. this bundle (dev / hoisted workspace installs);
  // 2. the running `dsh` bin — the shipped bridge lives in a profile with NO
  //    @deepseek-ai peer closure of its own, but the host always carries
  //    dsh-session (verified rc.4: appendPluginRecord is exported there).
  const roots: string[] = [import.meta.url]
  if (process.argv[1]) {
    try { roots.push(realpathSync(process.argv[1])) } catch { /* not a path */ }
  }
  for (const root of roots) {
    try {
      const req = createRequire(root)
      const mod = req('@deepseek-ai/dsh-session') as Record<string, unknown>
      if (typeof mod.appendPluginRecord === 'function') {
        cachedAppendPluginRecord = mod.appendPluginRecord as AppendPluginRecordFn
        break
      }
    } catch {
      /* try the next root */
    }
  }
  return cachedAppendPluginRecord
}

/** Resolve `ctx.sessionController` through the same cordis `ctx.get` seam the
 *  bridge already uses for persistence. `get?` is optional on BridgeContext, so
 *  a host without a service lookup degrades to "unavailable", never a throw. */
function resolveSessionController(ctx: BridgeContext): SessionControllerPushLike | undefined {
  // cordis throws "cannot get property ... without inject" for a service that
  // is not declared in `inject` (both the `ctx.get` and the direct-property
  // access can throw). Contain it so the frame answers UNSUPPORTED instead of
  // crashing the serial dispatch chain — a stock `opentui-inproc` profile does
  // not mount `sessionController` at all.
  let svc: unknown
  try {
    svc = typeof ctx.get === 'function' ? ctx.get('sessionController') : undefined
    if (svc === undefined) svc = ctx.sessionController
  } catch {
    svc = undefined
  }
  return svc !== undefined && typeof (svc as SessionControllerModelLike).list === 'function'
    ? (svc as SessionControllerPushLike)
    : undefined
}

/** S2 — resolve `ctx.deepseekAccount` through the same contained ctx.get seam
 *  as sessionController. Membership check uses the smallest signature common
 *  to all 12 methods so a wrong/absent service degrades to NOT_WIRED. */
function resolveDeepSeekAccount(ctx: BridgeContext): DeepSeekAccountLike | undefined {
  let svc: unknown
  try {
    svc = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : undefined
    if (svc === undefined) svc = (ctx as unknown as { deepseekAccount?: unknown }).deepseekAccount
  } catch {
    svc = undefined
  }
  return svc !== undefined && typeof svc === 'object' ? (svc as DeepSeekAccountLike) : undefined
}

/** S2 — resolve `ctx.credentialsController` (service key verified from rc.5
 *  source, dsh-api-settings-controller/src/credentials.ts:71). Contained lookup;
 *  an absent provider degrades to NOT_WIRED, never a crash. */
function resolveCredentialsController(ctx: BridgeContext): CredentialsControllerLike | undefined {
  let svc: unknown
  try {
    svc = typeof ctx.get === 'function' ? ctx.get('credentialsController') : undefined
    if (svc === undefined) svc = (ctx as unknown as { credentialsController?: unknown }).credentialsController
  } catch {
    svc = undefined
  }
  return svc !== undefined && typeof svc === 'object' ? (svc as CredentialsControllerLike) : undefined
}

/** S5 — resolve `ctx.settingsController` (service key verified from rc.5
 *  dsh-api-settings-controller/src/index.ts:86 `super(ctx,'settingsController',
 *  {namespace:'settings'})`). Same contained ctx.get seam as the other
 *  controllers so an absent service degrades to NOT_WIRED, never a crash. */
function resolveSettingsController(ctx: BridgeContext): SettingsControllerLike | undefined {
  let svc: unknown
  try {
    svc = typeof ctx.get === 'function' ? ctx.get('settingsController') : undefined
    if (svc === undefined) svc = (ctx as unknown as { settingsController?: unknown }).settingsController
  } catch {
    svc = undefined
  }
  return svc !== undefined && typeof svc === 'object' ? (svc as SettingsControllerLike) : undefined
}

/** Decidable shape check for AccountClientMetadata (version/locale/offset). */
function isAccountClientMeta(v: unknown): v is AccountClientMetaLike {
  if (v === null || typeof v !== 'object') return false
  const m = v as Record<string, unknown>
  return typeof m.version === 'string' && typeof m.locale === 'string' && typeof m.timezoneOffsetSeconds === 'number'
}

/**
 * Mirror the host's `agentOptions()` (dsh-api-session-controller/src/agent.ts):
 * getters read `agentDefaultModel.currentSelection()` so a session that has
 * not recorded a selection follows default model changes. When the service is
 * absent we pass `{}` and let the host's own startup route apply.
 */
function buildAgentOptions(ctx: BridgeContext): Record<string, unknown> {
  const defaults = resolveDefaultModel(ctx)
  if (defaults === undefined) return {}
  return {
    get provider() {
      return defaults.currentSelection().provider
    },
    get model() {
      return defaults.currentSelection().model
    },
    get reasoningEffort() {
      return defaults.currentSelection().reasoningEffort
    },
  }
}

/**
 * Map a host resume/create failure to a typed IPC error code.
 *
 * Evidence: @deepseek-ai/dsh-session-persistence `src/errors.ts` (and the
 * shipped `lib/types/errors.d.ts`) define stable `this.name` values on every
 * class; the agent-loop resume path propagates them unwrapped (it only
 * special-cases SessionPersistenceNotFoundError in the *configured* startup
 * path, not in `AgentLoop.resume`). The bridge cannot `import` these classes
 * at runtime — doing so would either copy a @deepseek-ai package into the
 * profile (forbidden by the guard) or pin a second, version-skewed copy — so
 * we classify by the stable name and document the mapping here.
 *
 *   SessionPersistenceNotFoundError   -> SESSION_NOT_FOUND
 *   SessionAlreadyOwnedError          -> SESSION_LOCKED  (detail.holder = sessionId)
 *   SessionPersistenceCorruptionError -> JOURNAL_CORRUPT
 *   SessionFormatUnsupportedError     -> VERSION_INCOMPATIBLE
 */
const HOST_ERROR_CODES: Record<string, { code: string; holder?: boolean }> = {
  SessionPersistenceNotFoundError: { code: 'SESSION_NOT_FOUND' },
  SessionAlreadyOwnedError: { code: 'SESSION_LOCKED', holder: true },
  SessionPersistenceCorruptionError: { code: 'JOURNAL_CORRUPT' },
  SessionFormatUnsupportedError: { code: 'VERSION_INCOMPATIBLE' },
}

function mapHostError(err: unknown): { code: string; message: string; detail?: Record<string, unknown> } {
  const rawName = err !== null && typeof err === 'object' ? (err as { name?: unknown }).name : undefined
  const name = typeof rawName === 'string' ? rawName : ''
  const message = err instanceof Error ? err.message : String(err)
  const entry = HOST_ERROR_CODES[name]
  if (entry === undefined) return { code: 'INTERNAL', message }
  let detail: Record<string, unknown> | undefined
  if (entry.holder) {
    const holder =
      err !== null && typeof err === 'object' ? (err as { sessionId?: unknown }).sessionId : undefined
    detail = { holder: holder === undefined ? 'unknown' : String(holder) }
  }
  return { code: entry.code, message, ...(detail !== undefined ? { detail } : {}) }
}

/** journalCursor = session log length (`session.seq`, exclusive upper bound). */
function journalCursorOf(binding: SessionBinding): number {
  const seq = binding.handle.agent.session?.seq
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : 0
}

// --------------------------------------------------------------------------
// M2-2 turn event stream helpers.
//
// The bridge never imports @deepseek-ai/* at runtime; these are structural
// slices of the host's event vocabulary, transcribed from the installed
// declarations (dsh-session SessionEvent, dsh-agent AssistantStreamFrame).
// --------------------------------------------------------------------------

/** Batch window for token frames, inside ADR-0010's 16–30ms band. */
const TOKEN_BATCH_MS = 30
/** Flush a pending token buffer before it would push a frame past ~8KiB. */
const TOKEN_FRAME_BYTE_CAP = 6000
/** Set DSH_OPENTUI_BRIDGE_DEBUG_EVENTS=1 to log raw event routing to ctx.logger. */
const DEBUG_EVENTS = process.env.DSH_OPENTUI_BRIDGE_DEBUG_EVENTS === '1'

/** SessionId / agent id are branded strings at runtime (`Branded<'SessionId'>`). */
function idString(value: unknown): string {
  return typeof value === 'string' ? value : String(value)
}

/** Text of the `{type:'text'|'reasoning', text}` blocks of an assistant/tool message. */
function contentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const b = block as { type?: unknown; text?: unknown }
    if ((b.type === 'text' || b.type === 'reasoning') && typeof b.text === 'string') out += b.text
  }
  return out
}

/** A tool call's `arguments` is a raw JSON string; pass a parsed object through
 *  when possible, otherwise keep the raw string (never lose the input). */
function toolInput(args: unknown): unknown {
  if (typeof args !== 'string' || args === '') return undefined
  try {
    return JSON.parse(args)
  } catch {
    return args
  }
}

/** Terminal decision from a dsh `turn/end` reason sum. */
type TerminalDecision = { kind: 'end' } | { kind: 'error'; code: string; message: string }
function terminalFromReason(reason: unknown): TerminalDecision {
  const r = reason !== null && typeof reason === 'object' ? (reason as Record<string, unknown>) : {}
  const kind = r.kind
  if (kind === 'error') {
    const e = r.error !== null && typeof r.error === 'object' ? (r.error as Record<string, unknown>) : {}
    const code = typeof e.code === 'string' && e.code !== '' ? e.code : 'INTERNAL'
    const message = typeof e.message === 'string' ? e.message : 'model turn failed'
    return { kind: 'error', code, message }
  }
  if (kind === 'aborted') {
    const cause = r.reason !== null && typeof r.reason === 'object' ? (r.reason as Record<string, unknown>) : {}
    const code = typeof cause.code === 'string' && cause.code !== '' ? cause.code : 'ABORTED'
    return { kind: 'error', code, message: 'turn aborted' }
  }
  if (kind === 'blocked') return { kind: 'error', code: 'BLOCKED', message: 'turn blocked before a model step' }
  if (kind === 'interrupted') return { kind: 'error', code: 'INTERRUPTED', message: 'turn interrupted' }
  if (kind === 'forked') return { kind: 'error', code: 'FORKED', message: 'turn closed by fork' }
  // 'completed' and 'max-tokens' both carry delivered text — a normal end.
  return { kind: 'end' }
}

/** Per-in-flight-turn accumulator. Tokens are appended to both `textAcc` and a
 *  pending buffer; `turn.end.text` is built from `textAcc`, so concatenation of
 *  emitted `turn.token` texts equals it by construction. */
interface TurnStreamState {
  turnId: string
  sessionId: string
  numericTurn?: number
  started: boolean
  ended: boolean
  textAcc: string
  reasoningAcc: string
  pendingText: string
  pendingReasoning: string
  /** Last `assistant/message` usage snapshot of this turn. */
  usage?: unknown
  batchTimer?: ReturnType<typeof setTimeout>
  /** callId -> tool name, so a tool result can emit an output frame. */
  toolNames: Map<string, string>
  deltaCount: number
  tokenFrameCount: number
  /** Set by turn.abort so a repeated abort is idempotent before the terminal
   *  frame arrives. The terminal shape itself is owned by the host reason. */
  abortRequested?: boolean
}

type FrameId = string | number

interface ParsedRequest {
  id: FrameId | null
  method: string
  params: Record<string, unknown>
}

/** Map a raw NDJSON line to a request, or throw a frame error code. */
function parseRequest(raw: string): ParsedRequest {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw { code: 'BAD_FRAME', message: 'frame is not valid JSON' }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw { code: 'BAD_FRAME', message: 'frame must be a JSON object' }
  }
  const obj = value as Record<string, unknown>
  const id: FrameId | null =
    typeof obj.id === 'string' || typeof obj.id === 'number' ? (obj.id as FrameId) : null
  if (typeof obj.method !== 'string' || obj.method.trim() === '') {
    throw { code: 'BAD_FRAME', message: 'request is missing a method', id }
  }
  const params =
    obj.params !== null && typeof obj.params === 'object' && !Array.isArray(obj.params)
      ? (obj.params as Record<string, unknown>)
      : {}
  return { id, method: obj.method, params }
}

/**
 * oldfox S1 (终审返工): normalize the profile-patch `askDeadlineMs` at the one
 * AskRegistry construction point. A non-number / NaN / negative value is
 * IGNORED (null → no per-ask clock) with ONE warn; a value above the registry's
 * maxAskWaitMs hard cap is CLAMPED to the cap with ONE warn. Otherwise the
 * number passes through. `warn` is injectable so the two cases are unit-testable
 * without a live bridge, and the cap is the same exported constant the registry
 * arms its hard-cap timer with (no drift between check and enforcement).
 */
export function resolveAskDeadlineMs(
  raw: unknown,
  maxAskWaitMs: number = DEFAULT_MAX_ASK_WAIT_MS,
  warn: (format: unknown, ...params: unknown[]) => void = () => {},
): number | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'number' || Number.isNaN(raw) || raw < 0) {
    warn('[dsh-opentui-bridge] invalid askDeadlineMs %s ignored (no per-ask deadline)', String(raw))
    return null
  }
  if (raw > maxAskWaitMs) {
    warn('[dsh-opentui-bridge] askDeadlineMs %d exceeds maxAskWaitMs %d; clamped to hard cap', raw, maxAskWaitMs)
    return maxAskWaitMs
  }
  return raw
}

export function apply(ctx: BridgeContext, config: unknown): unknown {
  const logger = ctx.logger

  // Switch off: byte-for-byte the T2a skeleton (no stdin/stdout takeover).
  if (process.env[STDIO_SWITCH] !== '1') {
    logger.info('[dsh-opentui-bridge] starting (skeleton)')
    return ctx.effect(
      () => () => {
        logger.info('[dsh-opentui-bridge] disposed')
      },
      'dsh-opentui-bridge: lifecycle',
    )
  }

  const bridgeVersion = readBridgeVersion()
  const hostVersion = readHostVersion()
  logger.info(
    `[dsh-opentui-bridge] stdio protocol active (protocolVersion=${PROTOCOL_VERSION}, bridge=${bridgeVersion}, host=${hostVersion})`,
  )

  // L1: a fresh apply() is a fresh bridge — rebuild the subagent index from
  // scratch (the table is never persisted; the host restart / bridge reset is
  // the rebuild trigger).
  getSubagentIndex(ctx).reset()

  // 024 base task 4 — startup capability handshake. The first list() read is
  // deferred to the poll loop (reading at apply() time is always []). No wire
  // method is added: this is a lifecycle observer whose verdict goes to logs
  // and to a per-ctx snapshot, never to the `req.method` dispatch switch.
  const handshakeConfig = config !== null && typeof config === 'object'
    ? (config as { handshakeTimeoutMs?: unknown })
    : {}
  const handshakeTimeoutMs =
    typeof handshakeConfig.handshakeTimeoutMs === 'number' ? handshakeConfig.handshakeTimeoutMs : undefined
  let handshake: HandshakeHandle | undefined
  try {
    handshake = startCapabilityHandshake(
      {
        ctx,
        get: (name: string) => ctx.get?.(name),
        logger,
      },
      {
        timeoutMs: handshakeTimeoutMs,
        // S2: extend the six ledger I-class probes with the two new service
        // seams (observation only; W-face 75/75 comparison is unchanged).
        iClassKeys: [...HANDSHAKE_ICLASS_KEYS_BASE, ...S2_OBSERVATION_ICLASS_KEYS],
      },
    )
  } catch (err) {
    // Startup observation must never take the plugin down.
    logger.warn('[dsh-opentui-bridge][handshake] start failed (plugin stays live): %s', err)
  }
  /** Exposed for headless proof / smoke tooling; no wire surface change. */
  attachHandshake(ctx, handshake)

  // 024 base task5b — env-gated real-host W roundtrip smoke (oldfox R4.3).
  // Drives the shipped bundle's OWN exported createCapInvoke against the live
  // ctx after the registration window; emits a single [CAP-SMOKE] stderr line.
  // No dispatcher source is copied or injected — this IS the shipped code path.
  if (process.env[CAP_SMOKE_SWITCH] === '1') {
    // Mirror ctx.logger to stderr so the handshake verdict + I-probes@stable
    // lines are observable in the headless run (the host logger is not on
    // stderr there). This is a logging tee only; no call logic is injected.
    const origInfo = logger.info.bind(logger)
    const origWarn = logger.warn.bind(logger)
    logger.info = ((fmt: unknown, ...params: unknown[]) => {
      process.stderr.write(`[SMOKE-LOG] ${[fmt, ...params].map(String).join(' ')}\n`)
      return origInfo(fmt, ...params)
    }) as typeof logger.info
    logger.warn = ((fmt: unknown, ...params: unknown[]) => {
      process.stderr.write(`[SMOKE-LOG] ${[fmt, ...params].map(String).join(' ')}\n`)
      return origWarn(fmt, ...params)
    }) as typeof logger.warn

    const W_ID = '@deepseek-ai/dsh-api-session-controller#session/list' as never
    setTimeout(() => {
      const emit = (tag: string, obj: unknown) =>
        process.stderr.write(`[CAP-SMOKE] ${tag} ${JSON.stringify(obj)}\n`)
      // A6 re-registration observations (oldfox §二): direct access after
      // inject declaration, and the ctx.get fallback surface size.
      let direct = 'THREW'
      try {
        const local = (ctx as unknown as { typert?: { local?: unknown } }).typert?.local
        direct = local !== undefined ? 'OK local-present' : 'OK no-local'
      } catch (err) {
        direct = `THREW ${String((err as { message?: string })?.message ?? err)}`
      }
      emit('direct ctx.typert', direct)
      let fallbackLen = -1
      try {
        const svc = ctx.get?.('typert') as { local?: { list(): ReadonlyArray<{ id: string }> } } | undefined
        if (typeof svc?.local?.list === 'function') fallbackLen = svc.local.list().length
      } catch { /* keep -1 */ }
      emit('ctx.get typert fallback', { listLength: fallbackLen })
      // S1 /model — probe the three model W methods through the SAME shipped
      // createCapInvoke export. E1 modelCatalog → its default/first route;
      // E2 selectModel onto a freshly created (real host) session; E3
      // initializeDefaultModel; E4 an UNWIRED id must reject explicitly.
      const CAP_ID = {
        list: W_ID,
        catalog: '@deepseek-ai/dsh-api-session-controller#session/modelCatalog' as never,
        select: '@deepseek-ai/dsh-api-session-controller#session/selectModel' as never,
        initDefault: '@deepseek-ai/dsh-api-session-controller#session/initializeDefaultModel' as never,
        unwired: '@deepseek-ai/dsh-api-session-controller#session/create' as never,
      }
      const invoke = createCapInvoke(ctx)
      const probe = async (id: never, params: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> => {
        try {
          return { ok: true, value: await invoke({ methodId: id, params }) }
        } catch (err) {
          return { ok: false, error: String((err as { message?: string })?.message ?? err) }
        }
      }
      ;(async () => {
        // Base task5b session/list roundtrip — tag + shape kept byte-identical.
        const list = await probe(CAP_ID.list, {})
        const items = (list.value as { items?: unknown[] } | undefined)?.items
        emit('W roundtrip via createCapInvoke', {
          id: CAP_ID.list,
          ok: list.ok,
          ...(list.ok
            ? { kind: 'unary', hasItems: Array.isArray(items), items: Array.isArray(items) ? items.length : undefined }
            : { error: list.error }),
        })

        const errCode = (e?: string): string | undefined => {
          if (e === undefined) return undefined
          if (e.startsWith('NOT_WIRED:')) return 'NOT_WIRED'
          if (e.startsWith('BAD_PARAMS:')) return 'BAD_PARAMS'
          if (e.startsWith('BAD_KIND:')) return 'BAD_KIND'
          return 'HOST_ERROR' // host domain errors never echo a value here
        }

        // ---- S3 push streams + B2 release probe ----------------------------
        // Drive the 3 CapIR push stream methods through the SAME shipped
        // createCapInvoke export; take one guarded item (ready frame) and close
        // the iterator. Whitelist ONLY method kind/type — no payload echo.
        let pushControllerPresent = false
        let pushControllerListFn = false
        let pushControllerDirect = false
        try {
          const svc = ctx.get?.('sessionController') as { list?: unknown } | undefined
          pushControllerPresent = svc !== undefined
          pushControllerListFn = typeof svc?.list === 'function'
        } catch { /* keep false — same containment as resolveSessionController */ }
        try {
          const direct = (ctx as { sessionController?: { list?: unknown } }).sessionController
          pushControllerDirect = direct !== undefined && typeof direct.list === 'function'
        } catch { /* keep false */ }
        emit('I-probe push controller', {
          present: pushControllerPresent,
          listFn: pushControllerListFn,
          directListFn: pushControllerDirect,
        })
        const PUSH_ID = {
          observeEvent: '@deepseek-ai/dsh-api-session-controller#session/observeEvent' as never,
          observeState: '@deepseek-ai/dsh-api-session-controller#session/observeState' as never,
          observeProjections: '@deepseek-ai/dsh-api-session-controller#session/observeProjections' as never,
          unwiredStream: '@deepseek-ai/dsh-api-session-controller#session/control' as never,
        }
        const probeSessionId = `s3-push-probe-${randomUUID().slice(0, 8)}`
        const probeStream = async (id: never) => {
          const r = await probe(id, {
            sessionId: probeSessionId,
            address: { kind: 'session', sessionId: probeSessionId },
          })
          let iterableOk = false
          let firstType: string | null = null
          const val = r.value as AsyncIterable<SessionPushFrameLike> | undefined
          if (r.ok && val !== null && typeof val === 'object' && typeof val[Symbol.asyncIterator] === 'function') {
            iterableOk = true
            try {
              const it = val[Symbol.asyncIterator]()
              const next = await Promise.race([
                it.next(),
                new Promise<{ done: boolean; value?: SessionPushFrameLike }>((resolve) =>
                  setTimeout(() => resolve({ done: true }), 800)),
              ])
              if (!next.done && next.value !== undefined) {
                firstType = typeof next.value.type === 'string' ? next.value.type : null
              }
              try { await it.return?.(undefined) } catch { /* keep observed values */ }
            } catch { /* keep observed values */ }
          }
          return { ok: r.ok, error: r.error, iterableOk, firstType }
        }
        for (const [name, id] of [
          ['observeEvent', PUSH_ID.observeEvent],
          ['observeState', PUSH_ID.observeState],
          ['observeProjections', PUSH_ID.observeProjections],
        ] as const) {
          const r = await probeStream(id)
          emit('W push stream', {
            method: name,
            kind: 'stream',
            ok: r.ok,
            iterableOk: r.iterableOk,
            firstType: r.firstType,
            emitWhitelist: ['kind', 'iterableOk', 'firstType'],
            ...(r.ok ? {} : { errorCode: errCode(r.error) }),
          })
        }
        // B2 (S2 review concern B2): prove owned controller release on return.
        emit('B2 owned-abort', { ownedAbortOnReturn: await probeOwnedAbortRelease() })
        // E6 negative: an UNWIRED stream id must reject explicitly (no silent
        // empty stream); a missing sessionId must be BAD_PARAMS and never reach
        // the host.
        const unwiredPush = await probe(PUSH_ID.unwiredStream, { sessionId: probeSessionId })
        emit('W push negative', {
          id: PUSH_ID.unwiredStream,
          rejected: !unwiredPush.ok,
          errorCode: errCode(unwiredPush.error),
          rawCode: unwiredPush.error?.split(':')[0],
          errorHead: unwiredPush.error?.slice(0, 96),
        })
        const badParamsPush = await probe(PUSH_ID.observeEvent, { address: { kind: 'session', sessionId: '' } })
        emit('W push negative', {
          id: PUSH_ID.observeEvent,
          rejected: !badParamsPush.ok,
          errorCode: errCode(badParamsPush.error),
          rawCode: badParamsPush.error?.split(':')[0],
          errorHead: badParamsPush.error?.slice(0, 96),
        })

        // E1: model catalog via generated chain.
        const catalog = await probe(CAP_ID.catalog, {})
        const cat = catalog.value as { default?: Partial<ModelSelectionLike>; groups?: readonly { id?: unknown; models?: readonly unknown[] }[] } | undefined
        const groups = Array.isArray(cat?.groups) ? cat!.groups! : []
        const def = cat?.default
        const routeGroup = groups.find((g) => Array.isArray(g.models) && (g.models as unknown[]).length > 0)
        const firstModel = (routeGroup?.models as readonly { id?: unknown }[] | undefined)?.[0]
        const route = {
          provider: typeof routeGroup?.id === 'string' ? routeGroup.id : (typeof def?.provider === 'string' ? def.provider : ''),
          model: typeof firstModel?.id === 'string' ? firstModel.id : (typeof def?.model === 'string' ? def.model : ''),
        }
        emit('W modelCatalog', {
          id: CAP_ID.catalog,
          ok: catalog.ok,
          hasGroups: Array.isArray(cat?.groups),
          groups: groups.length,
          defaultProvider: typeof def?.provider === 'string' ? def.provider : null,
          defaultModel: typeof def?.model === 'string' ? def.model : null,
          ...(catalog.ok ? {} : { error: catalog.error }),
        })

        // E2: selectModel on a REAL freshly-created host session, then read the
        // catalog default back. A route unavailable in the catalog is a host
        // policy rejection, not a wiring failure — reported verbatim.
        let selected: { ok: boolean; value?: unknown; error?: string } = { ok: false, error: 'no catalog route' }
        let readback: { ok: boolean; value?: unknown; error?: string } = { ok: false, error: 'not attempted' }
        const agents = resolveAgents(ctx)
        if (agents !== undefined && route.provider !== '' && route.model !== '') {
          try {
            const sessionId = randomUUID()
            await agents.create({ sessionId, meta: { cwd: process.cwd() }, agentOptions: buildAgentOptions(ctx) })
            selected = await probe(CAP_ID.select, { sessionId, ...route })
            readback = await probe(CAP_ID.catalog, {})
          } catch (err) {
            selected = { ok: false, error: String((err as { message?: string })?.message ?? err) }
          }
        }
        const rd = readback.value as { default?: Partial<ModelSelectionLike> } | undefined
        emit('W selectModel', {
          id: CAP_ID.select,
          ok: selected.ok,
          route,
          selected: (selected.value as { selected?: Partial<ModelSelectionLike> } | undefined)?.selected ?? null,
          ...(selected.ok ? {} : { error: selected.error }),
        })
        emit('W modelCatalog after select', {
          ok: readback.ok,
          defaultProvider: typeof rd?.default?.provider === 'string' ? rd.default.provider : null,
          defaultModel: typeof rd?.default?.model === 'string' ? rd.default.model : null,
        })

        // E3: initializeDefaultModel (no-op when a provider key is configured).
        const init = await probe(CAP_ID.initDefault, {})
        emit('W initializeDefaultModel', { id: CAP_ID.initDefault, ok: init.ok, ...(init.ok ? {} : { error: init.error }) })

        // E4: an UNWIRED CapIR id must reject with the explicit NOT_WIRED text.
        const unwired = await probe(CAP_ID.unwired, {})
        emit('W NOT_WIRED negative', {
          id: CAP_ID.unwired,
          rejected: !unwired.ok,
          error: unwired.ok ? '(unexpectedly resolved)' : (unwired.error ?? ''),
        })

        // ---- S2 credentials/account probes ---------------------------------
        // DESENSITIZATION DISCIPLINE: every emit below is a fixed-shape
        // whitelist. Only ids, ok booleans, error CODES (not messages that
        // might carry a value), key NAMES and presence booleans are ever
        // serialized to stderr. No params object, wire frame, credential value
        // or token is passed to emit() anywhere in the S2 block.
        const CLIENT: AccountClientMetaLike = { version: '0.24-opentui-probe', locale: 'en-US', timezoneOffsetSeconds: 0 }
        const A = (name: string) => `@deepseek-ai/dsh-deepseek-account#account/${name}` as never
        const C = (name: string) => `@deepseek-ai/dsh-api-settings-controller#credentials/${name}` as never

        // E4 (concern C): I-probe presence of the two S2 service keys — boolean only.
        let accountPresent = false
        let credsPresent = false
        try { accountPresent = ctx.get?.('deepseekAccount') !== undefined } catch { /* keep false */ }
        try { credsPresent = ctx.get?.('credentialsController') !== undefined } catch { /* keep false */ }
        emit('I-probe S2 services', { deepseekAccountPresent: accountPresent, credentialsControllerPresent: credsPresent })

        // 025-w2-2 W2-2a E1 — A-1 service-key presence probe for pluginManager.
        // Boolean only (key name + presence), no value: this is the wrapped
        // ctx.get seam the generic arm uses for the 7 W2-2 read ids. It records
        // present/absent honestly (NEVER an environment-dependent assertion).
        let pluginManagerPresent = false
        try { pluginManagerPresent = ctx.get?.('pluginManager') !== undefined } catch { /* keep false */ }
        emit('I-probe W2-2 service', { pluginManagerPresent })

        // 025-w2-4 W2-4a A-1 — service-key presence probe for the three NEW
        // service keys the W2-4 directory ids bind to (llm/web/permissionPresets).
        // Boolean only (key name + presence), no value — the wrapped ctx.get seam
        // the generic arm uses. Records present/absent honestly (NEVER an
        // environment-dependent assertion; W5 prevention rule 2).
        let llmPresent = false
        let webPresent = false
        let permissionPresetsPresent = false
        try { llmPresent = ctx.get?.('llm') !== undefined } catch { /* keep false */ }
        try { webPresent = ctx.get?.('web') !== undefined } catch { /* keep false */ }
        try { permissionPresetsPresent = ctx.get?.('permissionPresets') !== undefined } catch { /* keep false */ }
        emit('I-probe W2-4 services', { llmPresent, webPresent, permissionPresetsPresent })

        // 025-w2-5 W2-5a A-1 — service-key presence probe for the NEW service key
        // the 7 goals ids bind to (goals). Boolean only (key name + presence), no
        // value — the wrapped ctx.get seam the generic arm uses. Records
        // present/absent honestly (NEVER an environment-dependent assertion; W5
        // prevention rule 2). goals is a new key (A-1/R4): unresolvable -> park.
        let goalsPresent = false
        try { goalsPresent = ctx.get?.('goals') !== undefined } catch { /* keep false */ }
        emit('I-probe W2-5 services', { goalsPresent })

        // E1: the 10 unary account methods via the shipped generated chain.
        // getState is the shape-critical one; the rest are reachability probes.
        const state = await probe(A('getState'), {})
        const st = state.value as AccountViewLike | undefined
        const allowedStateKeys = ['status', 'attempt', 'links']
        emit('W account getState', {
          ok: state.ok,
          status: typeof st?.status === 'string' ? st.status : null,
          attemptPhase: (st?.attempt as { phase?: unknown } | undefined)?.phase ?? null,
          linksPresent: st?.links !== undefined,
          whitelist: allowedStateKeys,
          ...(state.ok ? {} : { errorCode: errCode(state.error) }),
        })
        // S4 (additive emit; S2 criterion shape above untouched): the host view
        // may carry attempt.authorizeUrl during waiting-browser. Report ONLY a
        // boolean readiness signal — never the URL or its code_challenge/state.
        const projectedState = projectAccountViewForFrame(st)
        emit('W account auth URL guard', {
          urlReady: projectedState.authorizeUrlReady,
          urlInFrame: false,
          whitelist: ['urlReady', 'urlInFrame'],
        })
        const tasks = await probe(A('hasRunningAccountTasks'), {})
        emit('W account hasRunningAccountTasks', { ok: tasks.ok, resultType: typeof tasks.value, ...(tasks.ok ? {} : { errorCode: errCode(tasks.error) }) })
        const unaryAccount = [
          ['getProfile', { client: CLIENT }],
          ['getBalance', { client: CLIENT }],
          ['getNotifications', { client: CLIENT }],
          ['getNotificationContent', { id: 'probe-notification-id', client: CLIENT }],
          ['reportNotificationEvent', { id: 'probe-notification-id', event: 'displayed', client: CLIENT }],
          ['startSignIn', { client: CLIENT, callbackOrigin: 'not-a-url', loginSource: 'desktop' }], // invalid URL -> host rejects before any browser side effect
          ['cancelSignIn', { attemptId: 'probe-attempt-id' }],
          ['signOut', { client: CLIENT }], // signed-out scratch home: no grant to remove
        ] as const
        for (const [name, params] of unaryAccount) {
          const r = await probe(A(name), params)
          emit('W account unary', { method: name, ok: r.ok, ...(r.ok ? {} : { errorCode: errCode(r.error) }) })
        }

        // E2: the 2 stream methods — take ONE item with a guard, emit only its
        // whitelisted type + state.status; abort immediately after.
        for (const name of ['watch', 'watchExpiry'] as const) {
          const ac = new AbortController()
          const r = await probe(A(name), { signal: ac.signal })
          let hasFirst = false
          let firstType: string | null = null
          let firstStatus: string | null = null
          let iterableOk = false
          const val = r.value as AsyncIterable<AccountUpdateLike> | undefined
          if (r.ok && val !== null && typeof val === 'object' && typeof val[Symbol.asyncIterator] === 'function') {
            iterableOk = true
            try {
              const it = val[Symbol.asyncIterator]()
              const next = await Promise.race([
                it.next(),
                new Promise<{ done: boolean; value?: AccountUpdateLike }>((resolve) =>
                  setTimeout(() => resolve({ done: true }), 800)),
              ])
              if (!next.done && next.value !== undefined) {
                hasFirst = true
                firstType = typeof next.value.type === 'string' ? next.value.type : null
                firstStatus = typeof next.value.state?.status === 'string' ? next.value.state.status : null
              }
              try { await it.return?.(undefined) } catch { /* keep observed values */ }
            } catch { /* keep observed values */ }
          }
          ac.abort()
          emit('W account stream', {
            method: name,
            kind: 'stream',
            ok: r.ok,
            iterableOk,
            hasFirst,
            firstType,
            firstStatus,
            emitWhitelist: ['type', 'state.status'],
            ...(r.ok ? {} : { errorCode: errCode(r.error) }),
          })
        }

        // E3 + desensitization: credentials describe/set/unset DATAFLOW using a
        // synthetic sentinel ref/value. The VALUE is never emitted — only the
        // ref KEY name and presence booleans. The scan script (09) greps all
        // evidence for the sentinel substring and must find zero occurrences.
        const sentinel = `DSHS2CRED_SENTINEL_${randomUUID()}`
        const ref = 'dsh_s2_probe_ref'
        const descBefore = await probe(C('describe'), { refs: [ref] })
        const beforeInfo = (descBefore.value as Record<string, CredentialInfoLike> | undefined)?.[ref]
        const set = await probe(C('set'), { ref, value: sentinel })
        const descAfterSet = await probe(C('describe'), { refs: [ref] })
        const afterInfo = (descAfterSet.value as Record<string, CredentialInfoLike> | undefined)?.[ref]
        const unset = await probe(C('unset'), { ref })
        const descAfterUnset = await probe(C('describe'), { refs: [ref] })
        const unsetInfo = (descAfterUnset.value as Record<string, CredentialInfoLike> | undefined)?.[ref]
        const presence = (info: CredentialInfoLike | undefined): boolean =>
          info !== undefined && (info.configured === true || info.present === true || Object.keys(info).length > 0)
        emit('W credentials describe', { ok: descBefore.ok, ref, ...(descBefore.ok ? {} : { errorCode: errCode(descBefore.error) }) })
        emit('W credentials set', { ok: set.ok, ref, ...(set.ok ? {} : { errorCode: errCode(set.error) }) })
        emit('W credentials DATAFLOW', {
          describeOk: descBefore.ok && descAfterSet.ok && descAfterUnset.ok,
          setOk: set.ok,
          unsetOk: unset.ok,
          beforePresent: presence(beforeInfo),
          afterSetPresent: presence(afterInfo),
          afterUnsetPresent: presence(unsetInfo),
          valueLogged: false,
        })
      })()
    }, 1500)
  }

  let buffer = ''
  let closing = false
  let awaitingDrain = false

  // Per-connection session state. The stdio bridge is one connection, so a
  // single binding is the whole state: I1 says only `session.open` may set it.
  let binding: SessionBinding | undefined
  /** Non-undefined while a turn from `session.send` has not gone idle yet. */
  let inFlightTurnId: string | undefined
  /** Serial dispatch queue so async handlers answer in request order. */
  let dispatchChain: Promise<void> = Promise.resolve()
  /** Guard against both 'end' and 'close' firing the EOF path. */
  let eofSeen = false
  /** The (at most one) in-flight turn's stream accumulator. Distinct from
   *  `inFlightTurnId` (the TURN_BUSY guard): this stays alive until the host's
   *  terminal frame arrives, so a `turn/end` racing ahead of `whenIdle()` is
   *  never dropped. */
  let activeTurn: TurnStreamState | undefined
  /** Bounded FIFO of recently finalized turn ids (insertion-ordered Set). Lets
   *  a repeated `turn.abort` on an already-ended turn answer `{noop:true}`
   *  regardless of how many turns ran after it (D3). At most
   *  TERMINAL_TURN_ID_LIMIT ids are retained; the oldest is evicted first once
   *  the cap is exceeded, and an evicted id then answers TURN_NOT_FOUND. */
  const terminalTurnIds = new Set<string>()
  let unsubSessionEvent: (() => void) | undefined
  let unsubStream: (() => void) | undefined
  /** ADR-0011 T4 — host waterfall answerer disposers (contained registration). */
  let unsubApprovalAnswerer: (() => void) | undefined
  let unsubQuestionsAnswerer: (() => void) | undefined

  /** Write one NDJSON frame, pausing stdin on backpressure until drain.
   *  S4: every frame passes the central auth-material key guard before it is
   *  serialized — an authorize URL (code_challenge/state) cannot cross stdout. */
  function writeFrame(frame: unknown): void {
    if (closing) return
    const line = `${JSON.stringify(sanitizeFrameForWire(frame))}\n`
    let writable = true
    try {
      writable = process.stdout.write(line, 'utf8')
    } catch (err) {
      logger.error('[dsh-opentui-bridge] stdout write failed: %s', err)
      return
    }
    if (!writable && !awaitingDrain) {
      awaitingDrain = true
      process.stdin.pause()
      process.stdout.once('drain', () => {
        awaitingDrain = false
        if (!closing) process.stdin.resume()
      })
    }
  }

  function replyOk(id: FrameId | null, result: Record<string, unknown>): void {
    writeFrame({ id, ok: true, result })
  }

  function replyError(id: FrameId | null, code: string, message: string, detail?: unknown): void {
    const error: Record<string, unknown> = { code, message }
    if (detail !== undefined) error.detail = detail
    writeFrame({ id, ok: false, error })
  }

  // ---- M2-2 turn event stream ------------------------------------------------

  /** Emit an ADR-0010 `event{type, payload}` frame (stdout is protocol-only). */
  function emitEvent(type: string, payload: Record<string, unknown>): void {
    writeFrame({ type, payload })
  }

  // ---- ADR-0011 T3/T4 — ask registry + answerer bridges ---------------------
  // Connection-scoped registry. Its sink is ALWAYS `emitEvent`, so ask.cancel /
  // ask.settled / ask.request (T4) travel the same `event{type,payload}` write
  // path as the turn.* frames above. The registry remains the sole owner of
  // first-wins, deadlines and the deliveredTo gate; dispatch only forwards
  // codes verbatim. T4 additionally uses `ask.settled` as the single wake-up
  // for the host answerer's await — every settlement path (answer, deadline,
  // clearTurn, clearSession, failClosed) passes through this one broadcast,
  // so an answerer promise can never be left hanging by a clearing path.
  const pendingAnswerers = new Map<string, {
    resolve: (settlement: AnswererSettlement) => void
    /** `ask.response` params, stashed by handleAskResponse before answer(). */
    params?: AskResponseParams
  }>()

  /** Settle (and forget) one answerer. Idempotent: the first settle deletes the
   *  entry, so a later `ask.settled` / signal abort / teardown is a no-op. */
  function settleAnswerer(eventId: string, settlement: AnswererSettlement): void {
    const pending = pendingAnswerers.get(eventId)
    if (pending === undefined) return
    pendingAnswerers.delete(eventId)
    pending.resolve(settlement)
  }

  /** One promise per pushed ask. The host `signal` settling as 'cancelled'
   *  mirrors dsh-user-approval's abort race (src/index.ts:320-332): a late
   *  answer after abort is discarded by the first-wins delete above. */
  function waitForAnswerer(eventId: string, signal?: AbortSignal): Promise<AnswererSettlement> {
    return new Promise<AnswererSettlement>((resolve) => {
      const pending: { resolve: (s: AnswererSettlement) => void; params?: AskResponseParams } = { resolve }
      pendingAnswerers.set(eventId, pending)
      if (signal !== undefined) {
        if (signal.aborted) {
          settleAnswerer(eventId, { outcome: 'cancelled' })
        } else {
          const original = pending.resolve
          const onAbort = () => settleAnswerer(eventId, { outcome: 'cancelled' })
          pending.resolve = (settlement) => {
            signal.removeEventListener('abort', onAbort)
            original(settlement)
          }
          signal.addEventListener('abort', onAbort, { once: true })
        }
      }
    })
  }

  /** ADR-0011 T7: append one redacted event to the live session journal as an
   *  ignorable `plugin:` record. The registry hands us an allowlisted event, so
   *  no tool arguments / prompts / custom answer text can reach the log here.
   *  Containment: a journal failure is a warning, never a changed verdict. */
  function writeAskJournal(event: AskJournalEvent): void {
    const session = binding?.handle.agent.session
    if (session === undefined) return
    const append = resolveAppendPluginRecord()
    if (append === undefined) {
      logger.debug('[dsh-opentui-bridge] ask journal writer unavailable; event %s not persisted', event.eventId)
      return
    }
    const type = askPluginRecordType(event.kind)
    try {
      append(session, type, event)
      const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8')
      logger.info(
        '[dsh-opentui-bridge] ask journal append type=%s eventId=%s bytes=%d session=%s',
        type, event.eventId, bytes, event.sessionId,
      )
    } catch (err) {
      logger.warn('[dsh-opentui-bridge] ask journal append failed (decision unchanged): %s', err)
    }
  }

  // F1-A2: per-ask wall clock, overridable from the profile patch config.
  // Default stays null (no per-ask deadline) so the 1h maxAskWaitMs hard cap
  // remains the only fallback — changing the default is out of scope.
  const askDeadlineMsRaw = config !== null && typeof config === 'object'
    ? (config as { askDeadlineMs?: unknown }).askDeadlineMs
    : undefined
  // S1: validate once here (never per ask) — invalid/negative → ignored + warn;
  // above the 1h hard cap → clamped + warn (else the config silently loses to
  // the cap timer). The registry still owns the cap it actually enforces.
  const askDeadlineMs = resolveAskDeadlineMs(askDeadlineMsRaw, DEFAULT_MAX_ASK_WAIT_MS, (fmt, ...params) =>
    logger.warn(fmt, ...params),
  )

  const ask = new AskRegistry({
    askDeadlineMs,
    logger,
    journal: writeAskJournal,
    sink: (frame) => {
      emitEvent(frame.type, frame.payload as unknown as Record<string, unknown>)
      if (frame.type === ASK_FRAME_TYPES.SETTLED) {
        const settled = frame.payload as AskSettledPayload
        const pending = pendingAnswerers.get(settled.eventId)
        settleAnswerer(settled.eventId, {
          outcome: settled.outcome,
          ...(pending?.params !== undefined ? { params: pending.params } : {}),
        })
      }
    },
  })
  askRegistries.set(ctx, ask)

  // ---- S3 host→client push relay ------------------------------------------
  // Wired to the shipped generated chain: the relay's injectable factory lives
  // at module scope (unit-testable); here it drives createCapInvoke / emitEvent.
  const pushRelay = createPushRelay({
    invoke: (frame) => createCapInvoke(ctx)(frame),
    emit: emitEvent,
    isClosing: () => closing,
  })
  const startPushRelay = (sessionId: string): void => pushRelay.start(sessionId)
  const stopPushRelay = (sessionId: string): void => pushRelay.stop(sessionId)

  // ---- S4 review C4: account watch relay production wiring ------------------
  // Same generated chain + lifecycle as the S3 push relay (S4 left the relay
  // constructed-but-unwired). `watchExpiry`'s bare 'session-expired' string is
  // mapped to eventType='expiry' by accountWatchEventType (C1 fix above). No
  // raw account state/authorizeUrl ever crosses — only the fixed 4-key cap.event.
  const accountRelay = createAccountWatchRelay({
    invoke: (frame) => createCapInvoke(ctx)(frame),
    emit: emitEvent,
    isClosing: () => closing,
  })
  const startAccountRelay = (sessionId: string): void => accountRelay.start(sessionId)
  const stopAccountRelay = (sessionId: string): void => accountRelay.stop(sessionId)

  /** `turn.start` is emitted once, before any other frame of this turn. */
  function ensureStarted(state: TurnStreamState): void {
    if (state.started) return
    state.started = true
    emitEvent('turn.start', { turnId: state.turnId, sessionId: state.sessionId })
  }

  /** Send the pending text/reasoning deltas as (at most) two token frames. */
  function flushPending(state: TurnStreamState): void {
    if (state.pendingText !== '') {
      emitEvent('turn.token', { turnId: state.turnId, kind: 'text', text: state.pendingText })
      state.tokenFrameCount += 1
      state.pendingText = ''
    }
    if (state.pendingReasoning !== '') {
      emitEvent('turn.token', { turnId: state.turnId, kind: 'reasoning', text: state.pendingReasoning })
      state.tokenFrameCount += 1
      state.pendingReasoning = ''
    }
  }

  /** Arm (or re-arm after a flush) the batch window. */
  function scheduleFlush(state: TurnStreamState): void {
    if (state.batchTimer !== undefined) return
    state.batchTimer = setTimeout(() => {
      state.batchTimer = undefined
      if (!state.ended && activeTurn === state) flushPending(state)
    }, TOKEN_BATCH_MS)
    state.batchTimer.unref?.()
  }

  /** Accumulate one text/reasoning delta; flush early on the ~8KiB cap. */
  function appendDelta(state: TurnStreamState, kind: 'text' | 'reasoning', text: string): void {
    if (text === '') return
    state.deltaCount += 1
    if (kind === 'text') {
      state.textAcc += text
      if (state.pendingText !== '' && Buffer.byteLength(state.pendingText + text, 'utf8') > TOKEN_FRAME_BYTE_CAP) {
        flushPending(state)
      }
      state.pendingText += text
    } else {
      state.reasoningAcc += text
      if (state.pendingReasoning !== '' && Buffer.byteLength(state.pendingReasoning + text, 'utf8') > TOKEN_FRAME_BYTE_CAP) {
        flushPending(state)
      }
      state.pendingReasoning += text
    }
    scheduleFlush(state)
  }

  /** Remember a finalized turn id for abort idempotency, keeping the FIFO
   *  bounded to TERMINAL_TURN_ID_LIMIT (oldest-first eviction). */
  function rememberTerminalTurnId(turnId: string): void {
    terminalTurnIds.add(turnId)
    while (terminalTurnIds.size > TERMINAL_TURN_ID_LIMIT) {
      const oldest = terminalTurnIds.values().next().value
      if (oldest === undefined) break
      terminalTurnIds.delete(oldest)
    }
  }

  /** Emit the single terminal frame and release the turn guards. Error turns
   *  emit ONLY `turn.error` — never a follow-up `turn.end` (M2-2 semantics). */
  function finalizeTurn(state: TurnStreamState, terminal: TerminalDecision): void {
    if (state.ended) return
    state.ended = true
    if (state.batchTimer !== undefined) {
      clearTimeout(state.batchTimer)
      state.batchTimer = undefined
    }
    ensureStarted(state)
    flushPending(state)
    if (terminal.kind === 'end') {
      emitEvent('turn.end', {
        turnId: state.turnId,
        // Built from the SAME accumulator that produced every token frame:
        // concatenation of turn.token[kind=text] === this string, by construction.
        text: state.textAcc,
        ...(state.reasoningAcc !== '' ? { reasoning: state.reasoningAcc } : {}),
        ...(state.usage !== undefined ? { usage: state.usage } : {}),
      })
    } else {
      emitEvent('turn.error', { turnId: state.turnId, code: terminal.code, message: terminal.message })
    }
    if (activeTurn === state) activeTurn = undefined
    if (inFlightTurnId === state.turnId) inFlightTurnId = undefined
    rememberTerminalTurnId(state.turnId)
    // ADR-0011 T3 (D5): a terminal turn is the settlement upper bound for every
    // ask bound to it. All terminal paths funnel here — abort, SESSION_CLOSED
    // from disposeBinding, and the INTERNAL idle safety net in handleSend — so
    // one idempotent call covers them. Late answers then get ASK_TURN_ENDED.
    ask.clearTurn(state.turnId)
    logger.info(
      '[dsh-opentui-bridge] turn %s finalized kind=%s textChars=%d deltas=%d tokenFrames=%d',
      state.turnId,
      terminal.kind,
      state.textAcc.length,
      state.deltaCount,
      state.tokenFrameCount,
    )
    if (DEBUG_EVENTS) {
      // warn level is surfaced on the host's stderr in headless mode, so the
      // M2-2 acceptance harness can prove batching (deltas vs token frames).
      logger.warn(
        '[bridge:stat] turn=%s deltas=%d tokenFrames=%d textChars=%d reasonChars=%d',
        state.turnId,
        state.deltaCount,
        state.tokenFrameCount,
        state.textAcc.length,
        state.reasoningAcc.length,
      )
    }
  }

  // ---- F1: delegated child approval policy re-pin -------------------------
  /** Local structural faces for the host services consulted when re-pinning a
   *  delegated child's approval policy. No runtime @deepseek-ai/* import — same
   *  no-import discipline as the other host faces in this file. */
  interface SessionsServiceLike {
    get?(id: string): unknown
  }
  interface ApprovalServiceLike {
    overrideOf?(session: unknown): string | undefined
    effectivePolicy?(session: unknown): string | undefined
  }
  interface WritableSessionLike {
    append(type: string, data: Record<string, unknown>): unknown
  }

  /** Child ids already processed by the re-pin guard (idempotent: a replayed
   *  catalog row must not append a second policy event). */
  const repinnedChildren = new Set<string>()

  /** F1 (2026-11-22 real-machine收尾): the host pins EVERY delegated child's
   *  approval policy to 'never' (`dsh-subagent` captureDelegatedPolicyOverrides /
   *  appendDelegatedPolicyOverrides, source:'delegation'). `dsh-user-approval`'s
   *  `decide()` returns 'rejected' on that policy BEFORE dispatching the
   *  'approval/request' waterfall — so this bridge's F1 answerer is never
   *  invoked for a child, no `ask.request` frame is emitted and no child card
   *  can appear (evidence: .proof/f1-a1-ask-routing/01-child-approval-rejection-evidence.md).
   *
   *  Re-pin the delegation 'never' to 'ask' on the CHILD session log so child
   *  approvals flow through the parent ask channel and the F1 card — but ONLY
   *  when the PARENT's current effective policy is 'ask'. Under full access the
   *  parent is 'never' (asking is pointless: it is auto-rejected), so we leave the
   *  child policy untouched and, crucially, do NOT mark the child repinned — a
   *  later switch back to 'ask' plus a catalog replay can still re-pin it.
   *
   *  Idempotent and fail-CLOSED: we only touch a child of THIS binding, never
   *  re-append when the child is already answerable, and if the parent session /
   *  approval service / effectivePolicy cannot be resolved we never touch the
   *  child log (host keeps its never→rejected default). */
  function repinChildApprovalPolicy(childId: string, parentSessionId: string): void {
    if (binding === undefined || parentSessionId !== binding.sessionId) return
    if (repinnedChildren.has(childId)) return
    const get = ctx.get
    if (typeof get !== 'function') return
    let sessions: SessionsServiceLike | undefined
    let approval: ApprovalServiceLike | undefined
    try {
      sessions = get.call(ctx, 'sessions') as SessionsServiceLike | undefined
      approval = get.call(ctx, 'approval') as ApprovalServiceLike | undefined
    } catch {
      return
    }
    if (typeof sessions?.get !== 'function') return
    let childSession: WritableSessionLike | undefined
    try {
      childSession = sessions.get(childId) as WritableSessionLike | undefined
    } catch {
      return
    }
    if (childSession === undefined || typeof childSession.append !== 'function') return

    // Parent-policy gate: re-pin only when the PARENT's effective policy is
    // 'ask'. Under full access ('never') a child ask would be auto-rejected
    // before the bridge answerer runs, so asking is pointless — leave the child
    // log alone. Fail-closed: any inability to READ the parent policy (missing
    // service, unresolved parent, throwing effectivePolicy, non-'ask' value)
    // means we never modify the child log. The 'never' path deliberately does
    // NOT add to repinnedChildren so a later 'ask' + catalog replay can re-pin.
    let parentSession: unknown
    try {
      parentSession = sessions.get(parentSessionId)
    } catch (err) {
      logger.warn(
        '[dsh-opentui-bridge] child approval re-pin skipped: parent session lookup failed child=%s parent=%s: %s',
        childId, parentSessionId, String(err),
      )
      return
    }
    if (parentSession === undefined) {
      logger.info(
        '[dsh-opentui-bridge] child approval re-pin skipped: parent session not found child=%s parent=%s',
        childId, parentSessionId,
      )
      return
    }
    if (approval === undefined || typeof approval.effectivePolicy !== 'function') {
      logger.warn(
        '[dsh-opentui-bridge] child approval re-pin skipped: approval.effectivePolicy unavailable child=%s parent=%s',
        childId, parentSessionId,
      )
      return
    }
    let parentPolicy: string | undefined
    try {
      parentPolicy = approval.effectivePolicy(parentSession)
    } catch (err) {
      logger.warn(
        '[dsh-opentui-bridge] child approval re-pin skipped: effectivePolicy threw child=%s parent=%s: %s',
        childId, parentSessionId, String(err),
      )
      return
    }
    if (parentPolicy !== 'ask') {
      logger.info(
        '[dsh-opentui-bridge] child approval re-pin skipped: parent effective policy=%s (not ask) child=%s parent=%s',
        String(parentPolicy), childId, parentSessionId,
      )
      return
    }

    // Only re-pin a 'never' (the delegation pin) or an unset policy. An
    // already-answerable 'ask' policy needs no append — avoid duplicate churn
    // on replayed catalog rows and on children forked with an explicit 'ask'.
    if (approval !== undefined && typeof approval.overrideOf === 'function') {
      const current = approval.overrideOf(childSession)
      if (current !== undefined && current !== 'never') {
        repinnedChildren.add(childId)
        return
      }
    }
    try {
      childSession.append('approval/policy', { policy: 'ask' })
      repinnedChildren.add(childId)
      logger.info(
        '[dsh-opentui-bridge] child approval re-pinned to ask child=%s parent=%s (delegation never pin overridden)',
        childId, parentSessionId,
      )
    } catch (err) {
      logger.warn('[dsh-opentui-bridge] child approval re-pin failed child=%s: %s', childId, String(err))
    }
  }

  /** `session/event` listener. TURN event types are gated on the currently open
   *  session id AND the in-flight turn's numeric turn, so other sessions —
   *  including subagent child sessions riding the same firehose — never leak
   *  into this turn's frames. DURABLE `tool-workflow/agent-*` records are exempt
   *  from the turn gate (ADR-0010): they are parent-journal rows, not turn stream
   *  events, so a late `agent-end` after abort / parent turn end still settles
   *  its row, and background workflow runs stay visible while idle (the remote
   *  firehose has no such gate). They are filtered on the bound session id ONLY;
   *  turn/abort semantics are unchanged by these additive frames. */
  function onSessionEvent(session: unknown, event: unknown): void {
    const state = activeTurn
    const s = session as { id?: unknown }
    const sessionId = idString(s?.id)
    const e = event as { type?: unknown; data?: unknown }
    const type = typeof e?.type === 'string' ? e.type : ''
    const data = e?.data !== null && typeof e?.data === 'object' ? (e.data as Record<string, unknown>) : {}

    // Subagent lifecycle (row 33 in the seam capability matrix). The host writes
    // `tool-workflow/agent-start|agent-end` as DURABLE parent-journal records on
    // the `session/event` firehose (dsh-tool-workflow/src/types.ts:20-33), the same
    // rows the remote panel pairs (remote-subagents.ts:235-249). Forward them as
    // two additive event frames so the inproc seam can project live subagent
    // rows (spawn -> running -> settle) with a real wall-clock start. `agent-end`
    // carries only {runId, seq, outcome}; the client pairs runId:seq -> child the
    // same way the remote panel does. P2-1(a): these records are NOT turn events —
    // they are checked against the bound session id only, with no activeTurn /
    // ended gate, so an end arriving after abort or after the parent turn ended
    // is not dropped and an idle-period background run is not invisible.
    // Additive event types: protocolVersion stays 1 (ADR-0010: old clients ignore
    // unknown `event` types).
    // Plain `subagent` calls (the common delegation path) do NOT emit the
    // `tool-workflow/agent-*` records above — those belong to the `workflow` tool.
    // The host instead appends a `subagent/catalog` record to the PARENT journal
    // and fires the same event on this firehose (dsh-subagent/src/catalog.ts:143,
    // verified live: type=subagent/catalog keys=version,childId,childCreatedAt,
    // mode,label,name on the bound session). Forward it as the SAME additive
    // `agent.spawn` frame so the seam projects a running child row. There is no
    // `agent.settle` for plain children on the firehose: the host journals the
    // terminal as a `user/message` notice with source.kind "subagent-settled"
    // instead (P1-2), which the seam folds by senderSessionId. Until that row
    // is drained the child stays `running` (ADR-0010). An ABORTED parent turn
    // never journals the settle notice — that ghost is a known residue.
    if (type === 'subagent/catalog') {
      const boundId = binding?.sessionId
      if (sessionId !== boundId) return
      // P2-2①: read the raw string, not idString() — idString(undefined) is the
      // literal "undefined", which would slip past the empty check and mint a
      // ghost roster row for a catalog event with no childId.
      const childId = typeof data.childId === 'string' ? data.childId : ''
      if (!childId) return
      // L1 incremental build: a `subagent/catalog` row inserts the child into
      // the host-local index with its parent (the bound session) and the host's
      // real wall clock. This covers the gap before `session.list` publishes the
      // row — exactly the window where 0.23.0's client roster was empty.
      // F1-A1: this same row is the ask-routing target table child key —
      // askTarget() resolves a subagent approval ask via this catalog fact
      // (childId === child session id), so a child ask routes to the parent's
      // channel only after the parent journal has established the child.
      getSubagentIndex(ctx).noteCatalog(
        childId,
        sessionId,
        typeof data.childCreatedAt === 'number' ? data.childCreatedAt : undefined,
      )
      // F1: the host pins this child's approval policy to 'never' at delegation,
      // which short-circuits decide() before our F1 answerer ever sees a child
      // ask (no card, child tool auto-rejected). Re-pin to 'ask' on the child log
      // so the child's approvals route through this bridge's parent channel.
      repinChildApprovalPolicy(childId, sessionId)
      const turnId = state !== undefined && !state.ended ? state.turnId : (inFlightTurnId ?? '')
      const label = typeof data.label === 'string' && data.label !== ''
        ? data.label
        : (typeof data.name === 'string' ? data.name : '')
      // F5: forward the host's v3 child reservation `name` verbatim. It is a
      // sibling-unique child slug (NOT a registry agent name) and the seam
      // needs it as a separate channel; `label` alone cannot distinguish an
      // ad-hoc child titled with a task from a `use_agent` agent name.
      const name = typeof data.name === 'string' && data.name !== '' ? data.name : ''
      // Stable synthetic pairing key; no agent.settle is emitted for catalog
      // children, so runId:seq is only the roster map key here. childCreatedAt
      // is the host's real wall clock (epoch ms) — forward it so the seam can
      // anchor a live spawn to it too, not just the journal replay path.
      emitEvent('agent.spawn', {
        turnId,
        sessionId: boundId,
        childId,
        label,
        ...(name !== '' ? { name } : {}),
        runId: `catalog:${childId}`,
        seq: 0,
        ...(typeof data.childCreatedAt === 'number' ? { childCreatedAt: data.childCreatedAt } : {}),
      })
      return
    }

    if (type === 'tool-workflow/agent-start' || type === 'tool-workflow/agent-end') {
      const boundId = binding?.sessionId
      if (sessionId !== boundId) return
      // No active turn => no bridge turnId to attribute; the seam pairs these
      // frames by runId:seq, so an empty turnId is an honest, inert value here.
      const turnId = state !== undefined && !state.ended ? state.turnId : (inFlightTurnId ?? '')
      if (type === 'tool-workflow/agent-start') {
        const childId = idString(data.childId)
        if (!childId) return
        emitEvent('agent.spawn', {
          turnId,
          sessionId: boundId,
          childId,
          label: typeof data.label === 'string' ? data.label : '',
          runId: idString(data.runId),
          seq: typeof data.seq === 'number' ? data.seq : -1,
        })
      } else {
        emitEvent('agent.settle', {
          turnId,
          sessionId: boundId,
          runId: idString(data.runId),
          seq: typeof data.seq === 'number' ? data.seq : -1,
          outcome: typeof data.outcome === 'string' ? data.outcome : 'completed',
        })
      }
      return
    }

    // L1 incremental settle: a child's OWN `turn/end` rides the same root-scope
    // firehose but is dropped by the turn gate below (child != bound session).
    // Observe it BEFORE that gate and flip the indexed child to settled, so
    // `subagents.interrupt` can answer `already-settled` between list snapshots.
    if (type === 'turn/end') {
      const index = getSubagentIndex(ctx)
      if (index.has(sessionId)) {
        index.noteSettled(sessionId, typeof data.seq === 'number' ? data.seq : undefined)
      }
    }

    if (state === undefined || state.ended) return
    if (sessionId !== state.sessionId) return
    if (DEBUG_EVENTS) {
      logger.info('[bridge:ev] session=%s type=%s turn=%s', state.sessionId, type, String(data.turn))
    }
    if (type === 'turn/start') {
      if (typeof data.turn === 'number') state.numericTurn = data.turn
      ensureStarted(state)
      return
    }
    if (state.numericTurn !== undefined && typeof data.turn === 'number' && data.turn !== state.numericTurn) return
    if (type === 'assistant/message') {
      // A settlement closes a model attempt: flush that attempt's deltas now
      // (a frame boundary) and keep the billed usage for `turn.end`.
      flushPending(state)
      if (data.usage !== undefined) state.usage = data.usage
      return
    }
    if (type === 'tool/call') {
      flushPending(state)
      ensureStarted(state)
      const callId = idString(data.callId)
      const name = typeof data.name === 'string' ? data.name : ''
      if (callId !== 'undefined') state.toolNames.set(callId, name)
      const input = toolInput(data.arguments)
      emitEvent('turn.tool', {
        turnId: state.turnId,
        name,
        // P1-1: carry callId so seam-rows keys LIVE tool rows by callId (not by
        // name) — two same-name tools interleaving must not collide. Corrected
        // from the earlier claim that this preserved the args/latestTodos: the
        // settled row's args survive via seam-rows' empty-argsPretty fallback,
        // NOT via callId. This frame is the call start, so it carries `input`.
        ...(callId !== 'undefined' && callId !== '' ? { callId } : {}),
        ...(input !== undefined ? { input } : {}),
      })
      return
    }
    if (type === 'tool/result') {
      flushPending(state)
      ensureStarted(state)
      const message = data.message !== null && typeof data.message === 'object'
        ? (data.message as Record<string, unknown>)
        : undefined
      const callId = idString(message?.toolCallId)
      const name = state.toolNames.get(callId) ?? ''
      emitEvent('turn.tool', {
        turnId: state.turnId,
        name,
        ...(callId !== 'undefined' && callId !== '' ? { callId } : {}),
        output: contentText(message?.content),
        // P1-1: the result's isError mirror. The seam maps it to `ok` in its
        // onToolRun; without it that arm hardcoded `ok:true` and a failed tool
        // painted as a success. Mirror both the raw row and the nested message
        // (the journal projector reads both — seam lines 478).
        isError: data.isError === true || message?.isError === true,
      })
      return
    }
    if (type === 'turn/end') {
      const terminal = terminalFromReason(data.reason)
      finalizeTurn(state, terminal)
    }
  }

  /** `agent/assistant-stream` listener — the live delta source since dsh
   *  0.1.5-rc.1 (deltas left the `session/event` firehose). dsh-tui-pi routes
   *  these by `String(agent.id)`, which equals the session id (verified by its
   *  onStreamFrame gate); that is the session filter here too. */
  function onAssistantStream(payload: unknown): void {
    const state = activeTurn
    if (state === undefined || state.ended) return
    const p = payload as { agent?: unknown; frame?: unknown }
    const agent = p?.agent as { id?: unknown } | undefined
    if (idString(agent?.id) !== state.sessionId) return
    const frame = p?.frame !== null && typeof p?.frame === 'object' ? (p.frame as Record<string, unknown>) : {}
    if (frame.type === 'start') {
      if (typeof frame.turn === 'number') state.numericTurn = frame.turn
      return
    }
    if (frame.type !== 'chunk') return
    const chunk = frame.chunk !== null && typeof frame.chunk === 'object' ? (frame.chunk as Record<string, unknown>) : {}
    const ctype = chunk.type
    if (ctype !== 'text-delta' && ctype !== 'reasoning-delta') return
    const text = typeof chunk.text === 'string' ? chunk.text : ''
    if (text === '') return
    if (DEBUG_EVENTS) {
      logger.info('[bridge:ev] stream session=%s chunk=%s chars=%d', state.sessionId, ctype, text.length)
    }
    ensureStarted(state)
    appendDelta(state, ctype === 'text-delta' ? 'text' : 'reasoning', text)
  }

  // ---- ADR-0011 T4 — host waterfall answerers -------------------------------
  /** F1-A1: resolved ask channel. `sessionId` stays the parent binding session
   *  for BOTH parent and child asks (that is the `ask.response` addressee and
   *  the grant / clearSession key). `childSessionId` is set only for a routed
   *  subagent ask and is projected on the wire for TUI card attribution. */
  interface AskTarget {
    turn: TurnStreamState
    sessionId: string
    childSessionId?: string
  }

  /** Resolve the deliverable ask channel for an inbound request.
   *
   *  - Parent session (`agent.session.id === binding.sessionId`, or absent):
   *    unchanged ADR-0011 T4 behaviour — the one live in-flight turn.
   *  - Child session: look the requesting session up in the catalog-driven
   *    `SubagentIndex` (childId === child session id, parentSessionId from the
   *    parent's `subagent/catalog` journal row). Only a registered, still-running
   *    child of THIS binding routes, and it routes onto the parent's ask channel
   *    (the only channel the bridge can answer). Unknown / foreign / settled
   *    children stay fail-closed — the security boundary is NOT widened.
   *
   *  `agent.session.id` is the host's routing identity (waterfall `claims()`);
   *  the index row is created only from a parent-journal catalog fact, never
   *  from the self-reported agent string, so spoofing is contained. */
  function askTarget(agent: unknown): AskTarget | undefined {
    const state = activeTurn
    if (state === undefined || state.ended || binding === undefined) return undefined
    if (state.sessionId !== binding.sessionId) return undefined
    const rawSessionId = (agent as ApprovalAgentLike | undefined)?.session?.id
    if (rawSessionId === undefined) return { turn: state, sessionId: binding.sessionId }
    const agentSessionId = idString(rawSessionId)
    if (agentSessionId === binding.sessionId) return { turn: state, sessionId: binding.sessionId }
    const child = getSubagentIndex(ctx).get(agentSessionId)
    if (child === undefined || child.parentSessionId !== binding.sessionId || child.status === 'settled') {
      logger.warn(
        '[dsh-opentui-bridge] ask target rejected child session=%s parent=%s (unknown/foreign/settled) — fail-closed',
        agentSessionId, binding.sessionId,
      )
      return undefined
    }
    return { turn: state, sessionId: binding.sessionId, childSessionId: agentSessionId }
  }

  /** Deterministic audit placeholder for a fail-closed ask with no deliverable
   *  turn. The journal's `redactIdentifier` keeps only [A-Za-z0-9._:-], so a bare
   *  identifier survives verbatim; an empty string would otherwise be emitted as
   *  an empty audit key (the P2-3 defect). */
  const FAIL_CLOSED_UNKNOWN_SESSION = 'unknown'

  /** D6: no deliverable provider → settle `unavailable` + ASK_CHANNEL_UNAVAILABLE
   *  through the registry (emits ask.settled), then fail the host waterfall
   *  closed. NO ask.request frame is pushed and nothing is silently denied. */
  function failClosedAsk(kind: 'approval' | 'questions', turnId: string, sessionId: string, reason: string): void {
    const result = ask.failClosed({ turnId, sessionId, kind, reason })
    logger.warn(
      '[dsh-opentui-bridge] ask fail-closed kind=%s session=%s eventId=%s code=%s reason=%s',
      kind, sessionId, result.settlement.eventId, result.code, reason,
    )
  }

  /** `approval/request` answerer. The request fields are projected into an
   *  ADR-0011 §3.2 `ask.request` via `ask.create()`, then the client's
   *  `ask.response` verdict is mapped back to the host's ApprovalOutcome.
   *  Returning (never calling `next`) claims the waterfall request. */
  async function onApprovalRequest(raw: unknown, _next: () => Promise<HostApprovalOutcome>): Promise<HostApprovalOutcome> {
    const req = (raw !== null && typeof raw === 'object' ? raw : {}) as ApprovalRequestLike
    const target = askTarget(req.agent)
    if (target === undefined) {
      failClosedAsk('approval', 'no-turn', binding?.sessionId ?? FAIL_CLOSED_UNKNOWN_SESSION, 'no open in-flight turn to deliver an approval ask')
      return 'unavailable'
    }
    const toolName = typeof req.toolName === 'string' && req.toolName !== '' ? req.toolName : undefined
    // ADR-0011 T7 (D7): a session-scoped 'always' grant short-circuits the card.
    // The grant can only have been created by an accepted `behavior:'always'`
    // answer (which itself requires a host-granted escalation, Q3), and it is
    // keyed by sessionId so another session never reuses it. No ask.request is
    // pushed; a `responded` journal event still records the audit decision.
    if (toolName !== undefined && ask.hasGrant(target.sessionId, toolName)) {
      const grantedEventId = ask.recordSummaryDecision(target.turn.turnId, {
        sessionId: target.sessionId,
        askKind: 'approval',
        toolName,
      })
      logger.info(
        '[dsh-opentui-bridge] ask always-grant from session summary: session=%s tool=%s eventId=%s (no card)',
        target.sessionId, toolName, grantedEventId,
      )
      return 'allowed-once'
    }
    const callId = req.callId === undefined ? undefined : idString(req.callId)
    const reason = typeof req.reason === 'string' && req.reason !== '' ? req.reason : undefined
    // ADR-0011 Q3/D7: escalation is a BRIDGE-side grant on ask.request, not a
    // host field — dsh-user-approval's ApprovalRequestEvent has no escalation
    // and its ApprovalOutcome has no 'always' (the bridge folds an accepted
    // `behavior:'always'` into the session summary and answers allowed-once).
    // Granting it here is what makes the always/session actions visible on the
    // card (turn-overlays.tsx) and lets the seam send behavior:'always'
    // (bridge-session-seam.ts). Without it the whole Q3 path is unreachable.
    let request: AskRequestPayload | undefined
    try {
      request = ask.create(target.turn.turnId, {
        sessionId: target.sessionId,
        kind: 'approval',
        ...(toolName !== undefined ? { toolName } : {}),
        ...(callId !== undefined ? { callId } : {}),
        ...(reason !== undefined ? { reason } : {}),
        escalation: true,
        // F1-A1: a routed child ask carries the child identity on the frame;
        // parentSessionId lets the TUI mount it under the parent (batch 3).
        ...(target.childSessionId !== undefined
          ? { childSessionId: target.childSessionId, parentSessionId: target.sessionId }
          : {}),
      })
    } catch (err) {
      logger.error('[dsh-opentui-bridge] ask.create(approval) failed: %s', err)
      failClosedAsk('approval', target.turn.turnId, target.sessionId, 'ask.create(approval) threw')
      return 'unavailable'
    }
    const settled = await waitForAnswerer(request.eventId, req.signal)
    switch (settled.outcome) {
      case 'approved': return 'allowed-once'
      case 'denied': return 'rejected'
      case 'cancelled': return 'cancelled'
      case 'unavailable': return 'unavailable'
    }
  }

  /** `user-questions/request` answerer. Host question items use `question`
   *  (not `prompt`) and `options[].label`; the ask wire uses `prompt`. Map
   *  field-for-field like remote-waterfall.questionsView does, then convert the
   *  client's `answers` back to `AskUserQuestionAnswer` on settlement. */
  async function onUserQuestionsRequest(raw: unknown, _next: () => Promise<HostQuestionsAnswerLike>): Promise<HostQuestionsAnswerLike> {
    const req = (raw !== null && typeof raw === 'object' ? raw : {}) as UserQuestionsRequestLike
    const target = askTarget(req.agent)
    if (target === undefined) {
      failClosedAsk('questions', 'no-turn', binding?.sessionId ?? FAIL_CLOSED_UNKNOWN_SESSION, 'no open in-flight turn to deliver a questions ask')
      throw new Error('ASK_CHANNEL_UNAVAILABLE: no in-flight turn to deliver user questions')
    }
    const questions = (req.questions ?? []).map((q) => {
      const id = q.id === undefined ? '' : idString(q.id)
      const prompt = q.question ?? q.header ?? id
      return {
        id,
        prompt: idString(prompt),
        ...(typeof q.header === 'string' && q.header !== '' ? { header: q.header } : {}),
        ...(typeof q.description === 'string' && q.description !== '' ? { description: q.description } : {}),
        ...(typeof q.detail === 'string' && q.detail !== '' ? { detail: q.detail } : {}),
        options: (q.options ?? []).map((option) => ({
          label: option.label === undefined ? '' : idString(option.label),
          ...(typeof option.description === 'string' && option.description !== '' ? { description: option.description } : {}),
        })),
        ...(q.multiSelect === true ? { multiSelect: true } : {}),
      }
    })
    const callId = req.wait?.callId === undefined ? undefined : idString(req.wait.callId)
    let request: AskRequestPayload | undefined
    try {
      request = ask.create(target.turn.turnId, {
        sessionId: target.sessionId,
        kind: 'questions',
        questions,
        ...(callId !== undefined ? { callId } : {}),
        ...(target.childSessionId !== undefined
          ? { childSessionId: target.childSessionId, parentSessionId: target.sessionId }
          : {}),
      })
    } catch (err) {
      logger.error('[dsh-opentui-bridge] ask.create(questions) failed: %s', err)
      failClosedAsk('questions', target.turn.turnId, target.sessionId, 'ask.create(questions) threw')
      throw new Error('ASK_CHANNEL_UNAVAILABLE: ask.create(questions) failed')
    }
    const settled = await waitForAnswerer(request.eventId, req.signal)
    if (settled.outcome !== 'approved' || settled.params?.answers === undefined || settled.params.answers.length === 0) {
      // Explicit channel failure, NOT a silent declined answer: an unavailable /
      // cancelled / denied settlement rejects the host waterfall so the tool
      // sees a real error (the host restores it into a UserQuestionError).
      throw new Error(`ASK_CHANNEL_UNAVAILABLE: user questions settled ${settled.outcome}`)
    }
    return {
      answers: settled.params.answers.map((answer) => ({
        id: answer.id,
        selected: [...answer.selected],
        ...(answer.custom !== undefined ? { custom: answer.custom } : {}),
      })),
    }
  }

  /** Contained registration: a missing `ctx.on` or a throwing registration
   *  (host version skew / inactive fiber) must NOT make the whole plugin
   *  pending — `bridge.ping` and every other method stay available. */
  function armAskAnswerers(): void {
    if (typeof ctx.on !== 'function') {
      logger.warn('[dsh-opentui-bridge] ctx.on unavailable — ask answerers not registered (host waterfall stays fail-closed)')
      return
    }
    try {
      unsubApprovalAnswerer = ctx.on('approval/request', onApprovalRequest as (...args: unknown[]) => void)
      unsubQuestionsAnswerer = ctx.on('user-questions/request', onUserQuestionsRequest as (...args: unknown[]) => void)
      logger.info('[dsh-opentui-bridge] ask answerers armed (approval + user-questions)')
    } catch (err) {
      unsubApprovalAnswerer = undefined
      unsubQuestionsAnswerer = undefined
      logger.warn('[dsh-opentui-bridge] ask answerer registration contained (plugin stays live): %s', err)
    }
  }

  /** Arm the two root-scope subscriptions once per connection; disposers are
   *  retained and cleared in teardown() (EOF + fiber dispose) — no leak. */
  function armTurnSubscriptions(): void {
    if (typeof ctx.on !== 'function') {
      logger.warn('[dsh-opentui-bridge] ctx.on unavailable — turn event stream disabled')
      return
    }
    unsubSessionEvent = ctx.on('session/event', onSessionEvent as (...args: unknown[]) => void)
    unsubStream = ctx.on('agent/assistant-stream', onAssistantStream as (...args: unknown[]) => void)
    logger.info('[dsh-opentui-bridge] turn event subscriptions armed')
  }

  function clearTurnSubscriptions(): void {
    try { unsubSessionEvent?.() } catch { /* already disposed */ }
    try { unsubStream?.() } catch { /* already disposed */ }
    unsubSessionEvent = undefined
    unsubStream = undefined
    if (activeTurn !== undefined && activeTurn.batchTimer !== undefined) {
      clearTimeout(activeTurn.batchTimer)
    }
    activeTurn = undefined
  }

  /** Dispose the current binding (detach semantics) and clear all state. */
  async function disposeBinding(current: SessionBinding): Promise<void> {
    // S3: release every host push subscription for this session BEFORE the
    // handle goes away — no host listener may outlive its binding.
    stopPushRelay(current.sessionId)
    stopAccountRelay(current.sessionId)
    // A turn still streaming when its binding is replaced (session.open
    // replace) or closed MUST get a terminal frame. Dropping activeTurn without
    // one leaves the client's `await done` pending forever (P0). Emit it BEFORE
    // dispose: finalizeTurn writes the single terminal frame while stdout is
    // still live, and the frame precedes any late host event for this turn.
    if (activeTurn !== undefined && activeTurn.sessionId === current.sessionId && !activeTurn.ended) {
      finalizeTurn(activeTurn, {
        kind: 'error',
        code: 'SESSION_CLOSED',
        message: 'turn terminated because its session was closed or replaced',
      })
    }
    // ADR-0011 T3 (D5): session.close / session.open{replace:true} must clear
    // every ask delivered to this session and its turn. Both operations are
    // idempotent (finalizeTurn above already cleared this turn's asks), and the
    // registry records the ids as ended so late answers get ASK_TURN_ENDED.
    ask.clearSession(current.sessionId)
    // ADR-0011 T7 (A5/I1): a session's 'always' summary dies with the session.
    // Without this, an open-replace from A to B could reuse A's grants.
    ask.clearSessionGrants(current.sessionId)
    if (activeTurn !== undefined && activeTurn.sessionId === current.sessionId) {
      ask.clearTurn(activeTurn.turnId)
    }
    binding = undefined
    inFlightTurnId = undefined
    terminalTurnIds.clear()
    // Drop any in-flight stream accumulator for this session. The connection-
    // level firehose subscriptions stay armed (they are session-filtered), so
    // no further TURN frames can be emitted without an activeTurn. This is what
    // keeps A's late turn events from landing under B's turnId after an open-
    // replace. Durable `tool-workflow/agent-*` frames are the deliberate exception
    // (P2-1(a)): they still emit without an activeTurn, but are filtered on the
    // bound session id, so A's late agent records are dropped under B.
    // finalizeTurn above already cleared this turn's timer + activeTurn; this
    // branch is a defensive fallback for an already-ended accumulator.
    if (activeTurn !== undefined && activeTurn.sessionId === current.sessionId) {
      if (activeTurn.batchTimer !== undefined) clearTimeout(activeTurn.batchTimer)
      activeTurn = undefined
    }
    try {
      // The handle we created/resumed is ours to dispose. For an adopted live
      // agent the handle's dispose is a deliberate no-op (creator owns it) —
      // exactly dsh-tui-pi's adopt arm. The firehose subscriptions belong to the
      // connection (not this handle), so a replace leaves them armed and simply
      // swaps the sessionId gate via the new activeTurn.
      await current.handle.dispose()
    } catch (err) {
      logger.warn('[dsh-opentui-bridge] handle dispose failed: %s', err)
    }
  }

  /**
   * A6 — after a RESUME open, proactively push the still-pending ask snapshot so
   * a reconnecting client can rebuild its cards (ADR-0011 §3.2 `ask.pending`).
   * Reuses the existing `AskRegistry.pendingSnapshot` frame builder verbatim —
   * no state-machine change, no new frame. Fresh (`mode:'new'`) opens are
   * deliberately excluded: no ask can be pending before the first turn.
   *
   * The bridge cannot tell a DEAD-recovery resume from a normal `/resume`, so
   * every resume open pushes the (possibly empty) snapshot; an empty frame is a
   * no-op on the client. This is the production call point the A6 ticket found
   * missing (previously `pendingSnapshot` was referenced only by tests).
   */
  function pushResumePendingSnapshot(sessionId: string): void {
    ask.pendingSnapshot(sessionId, true)
  }

  /**
   * ADR-0011 D7 (respawn): repopulate this process's always-grant summary from
   * the durable journal of a resumed session. Read-only (`open(id,'read')`),
   * best-effort and fully contained — a missing service, a corrupt log or an
   * unreadable payload degrades to an EMPTY summary and never fails the open.
   *
   * The in-process summary stays authoritative for the rest of the session
   * (A4: compaction clears events, not the effect). Reconstruction runs only at
   * open on a fresh process, so it cannot resurrect a grant cleared by a live
   * session close/replace, and a Set union keeps repeated opens idempotent.
   * Fired without awaiting so a slow/large journal never delays the reply.
   */
  function restoreSessionGrantsFromJournal(sessionId: string): void {
    void (async () => {
      let handle: PersistenceHandleLike | undefined
      try {
        // Service lookup itself can throw (host proxy / containment boundary);
        // it must be inside the try so a throwing ctx.get never fails the open.
        const persistence = resolvePersistence(ctx)
        if (persistence === undefined) return
        handle = await persistence.open(sessionId, 'read')
        const rows: Array<{ type: string; payload: unknown }> = []
        let offset = 0
        for (;;) {
          const batch = await handle.read(offset)
          const slice = batch.events ?? []
          if (slice.length === 0) break
          for (const event of slice) {
            rows.push({
              type: typeof event.type === 'string' ? event.type : '',
              payload: event.data,
            })
          }
          offset += slice.length
        }
        // The read is async: a close/replace may have moved the binding on.
        // Never repopulate a session that is no longer the active one (I1/A5).
        if (binding?.sessionId !== sessionId) return
        const tools = alwaysGrantToolsFromJournal(sessionId, rows)
        if (tools.length > 0) {
          ask.restoreSessionGrants(sessionId, tools)
          logger.info(
            '[dsh-opentui-bridge] restored %d always-grant(s) from journal session=%s tools=%s',
            tools.length, sessionId, tools.join(','),
          )
        }
      } catch (err) {
        // Degrade to an empty summary; never surface as an open failure.
        logger.warn('[dsh-opentui-bridge] journal grant reconstruction skipped (summary stays empty): %s', err)
      } finally {
        if (handle !== undefined) {
          try {
            await handle.close()
          } catch {
            /* containment: close failure cannot affect the grant or the open */
          }
        }
      }
    })()
  }

  /** `session.open` — the ONLY operation that binds/changes sessionId (I1).
   *
   * `replace` contract: the only way to change an already-bound id is this same
   * `session.open` call, and the caller must NAME the target id
   * (`mode:"resume", id:B`). Because the target is explicitly named here (and
   * no other protocol operation mints or adopts an id), an explicit replace
   * does NOT violate I1 — it is still "only open can change the id, and it
   * must point at a named id". Without `replace`, a different target stays
   * ALREADY_OPEN; an exact repeat of the current id stays idempotent.
   */
  async function handleOpen(req: ParsedRequest): Promise<void> {
    const agents = resolveAgents(ctx)
    if (agents === undefined) {
      replyError(req.id, 'INTERNAL', 'agent registry service unavailable')
      return
    }

    const mode = req.params.mode
    const targetId = mode === 'resume' ? req.params.id : undefined
    const replace = req.params.replace === true
    /** Set only on the explicit-replace path; echoed in the success result. */
    let previousSessionId: string | undefined

    // Duplicate-open policy: an exact repeat of the current id is idempotent;
    // a different target is ALREADY_OPEN unless this very call explicitly asks
    // to replace it with a named id. Validate the named target BEFORE disposing
    // the current session, so a malformed replace cannot drop a live session.
    if (binding !== undefined) {
      if (mode === 'resume' && targetId === binding.sessionId) {
        replyOk(req.id, { sessionId: binding.sessionId, journalCursor: journalCursorOf(binding) })
        // A6: an idempotent resume is exactly what DEAD recovery sends when the
        // bridge stayed alive — still push the snapshot (the binding is live and
        // its pending table is the source of truth).
        pushResumePendingSnapshot(binding.sessionId)
        // S3: a reconnecting client re-arms the push face on its resume open.
        startPushRelay(binding.sessionId)
        startAccountRelay(binding.sessionId)
        // A4/D7: rebuild always-grants from the durable journal as well. Set
        // union makes this idempotent against the already-live in-memory grants.
        restoreSessionGrantsFromJournal(binding.sessionId)
        return
      }
      if (!replace) {
        replyError(
          req.id,
          'ALREADY_OPEN',
          'a session is already open; call session.close before opening another',
          { openSessionId: binding.sessionId },
        )
        return
      }
      if (mode !== 'resume' || typeof targetId !== 'string' || targetId === '') {
        replyError(req.id, 'BAD_PARAMS', 'session.open replace requires mode="resume" with an explicitly named id')
        return
      }
      // Explicit replace: close A first (dispose releases the writer lock),
      // then open the named B below. I1 holds: the id change happens only in
      // session.open, and only because the caller named B.
      previousSessionId = binding.sessionId
      await disposeBinding(binding)
      logger.info('[dsh-opentui-bridge] session.open replace closed previous session %s', previousSessionId)
    }

    try {
      let sessionId: string
      let handle: AgentHandleLike
      // M3-04: register the append section at AGENT scope via the host's
      // `setup` callback (ADR-0010 "scope 注册，禁 global"), on both paths.
      if (mode === 'new') {
        // I1: a fresh id is minted here and only here.
        sessionId = randomUUID()
        handle = await agents.create({
          sessionId,
          meta: { cwd: process.cwd() },
          agentOptions: buildAgentOptions(ctx),
          setup: makeAppendSectionSetup(logger, sessionId),
        })
      } else if (mode === 'resume') {
        const id = req.params.id
        if (typeof id !== 'string' || id === '') {
          replyError(req.id, 'BAD_PARAMS', 'session.open resume requires a non-empty id')
          return
        }
        // I2: eager. Adopt a session already LIVE in this process (tui-pi's
        // arm) — ctx.agents.get — otherwise really resume it. NEVER create.
        const live = agents.get(id)
        if (live !== undefined) {
          logger.info('[dsh-opentui-bridge] session.open adopt live %s', id)
          handle = { agent: live, dispose: async () => { /* owned by creator */ } }
        } else {
          // M3-05 (post-8e0e847) — observation only. Read the persisted header
          // preset through a read-only handle; if it is the legacy synthetic
          // append id, emit ONE debug log for this resume. The id is inert in
          // inproc (no `preset` field on ResumeAgentOptions, no agentPresets
          // service), so NO `preset` is written and the section text stays
          // unconditional. Detection failures are clean misses, never blocking.
          try {
            const preset = await readSessionAgentPreset(resolvePersistence(ctx), id)
            if (presetMentionsAppend(preset)) logLegacyAppendPreset(logger)
          } catch {
            // Service-lookup / detection failure is a clean miss; never block resume.
          }
          logger.info('[dsh-opentui-bridge] session.open resume %s', id)
          handle = await agents.resume({
            resumeSessionId: id,
            agentOptions: buildAgentOptions(ctx),
            setup: makeAppendSectionSetup(logger, id),
          })
        }
        sessionId = id
      } else {
        replyError(req.id, 'BAD_PARAMS', 'session.open mode must be "new" or "resume"')
        return
      }
      binding = { sessionId, handle }
      logger.info(
        '[dsh-opentui-bridge] session.open ok id=%s cursor=%d',
        sessionId,
        journalCursorOf(binding),
      )
      replyOk(req.id, {
        sessionId,
        journalCursor: journalCursorOf(binding),
        ...(previousSessionId !== undefined ? { previousSessionId } : {}),
      })
      // S3: arm the push face for the newly-bound session (new or resume).
      // Start AFTER binding/reply so a not-yet-ready host degrades to cap.end
      // without delaying the open reply.
      startPushRelay(sessionId)
      startAccountRelay(sessionId)
      // A6: resume opens push the reconnect snapshot; fresh opens never do.
      // A4/D7: also rebuild always-grants from the durable journal on a fresh
      // process. Contained + non-awaiting: a corrupt/incomplete journal never
      // blocks the open and degrades to an empty summary.
      if (mode === 'resume') {
        pushResumePendingSnapshot(sessionId)
        restoreSessionGrantsFromJournal(sessionId)
      }
    } catch (err) {
      logger.error('[dsh-opentui-bridge] session.open failed: %s', err)
      // No fallback create: the failure is returned verbatim as a typed code.
      const mapped = mapHostError(err)
      replyError(req.id, mapped.code, mapped.message, mapped.detail)
    }
  }

  /** `session.send` — one user turn; single in-flight turn per session. */
  async function handleSend(req: ParsedRequest): Promise<void> {
    if (binding === undefined) {
      replyError(req.id, 'SESSION_NOT_OPEN', 'no open session; call session.open first')
      return
    }
    if (inFlightTurnId !== undefined) {
      replyError(
        req.id,
        'TURN_BUSY',
        'a turn is already in flight for this session',
        { turnId: inFlightTurnId },
      )
      return
    }
    const text = req.params.text
    if (typeof text !== 'string') {
      replyError(req.id, 'BAD_PARAMS', 'session.send requires a text string')
      return
    }

    const agent = binding.handle.agent
    const sessionId = binding.sessionId
    const message = createBridgeUserMessage(text)
    const turnId = randomUUID()
    inFlightTurnId = turnId
    const state: TurnStreamState = {
      turnId,
      sessionId,
      started: false,
      ended: false,
      textAcc: '',
      reasoningAcc: '',
      pendingText: '',
      pendingReasoning: '',
      toolNames: new Map(),
      deltaCount: 0,
      tokenFrameCount: 0,
    }
    activeTurn = state
    const clearInFlight = () => {
      if (inFlightTurnId === turnId) inFlightTurnId = undefined
    }
    try {
      // tui-pi steer-flow semantics: a running driver consumes steering at
      // its next step boundary; if the turn ended between check and delivery
      // (or steer is unavailable), degrade to a queued follow-up.
      if (agent.status === 'running') {
        try {
          agent.steer(message)
        } catch {
          agent.followup(message)
        }
      } else {
        agent.followup(message)
      }
      // Emit turn.start here (before the send response) so it is unambiguously
      // the first frame of this turn. The session/event 'turn/start' handler
      // only pins the numeric turn and calls ensureStarted (now a no-op).
      ensureStarted(state)
      // followup/steer wake the driver synchronously, so whenIdle() observes
      // the activity and resolves once it converges to idle. The terminal frame
      // (turn/end | turn/error) owns inFlightTurnId release; whenIdle is only a
      // safety net in case a host never emits a terminal, and a rejection is a
      // real error terminal.
      void agent.whenIdle().then(
        () => {
          const safety = setTimeout(() => {
            if (inFlightTurnId === turnId) {
              // The host went idle without delivering turn/end. Releasing only
              // TURN_BUSY left activeTurn unterminated, so the client's
              // `await done` hung and the next send overwrote this turn with no
              // terminal frame (P2). Emit the terminal first, then clear state.
              logger.warn('[dsh-opentui-bridge] turn %s idle with no terminal frame; finalizing', turnId)
              if (activeTurn === state && !state.ended) {
                finalizeTurn(state, {
                  kind: 'error',
                  code: 'INTERNAL',
                  message: 'no terminal frame received before the idle safety net fired',
                })
              }
              clearInFlight()
            }
          }, 2000)
          safety.unref?.()
        },
        (err: unknown) => {
          if (activeTurn === state) {
            finalizeTurn(state, {
              kind: 'error',
              code: 'INTERNAL',
              message: err instanceof Error ? err.message : String(err),
            })
          }
          clearInFlight()
        },
      )
      logger.info('[dsh-opentui-bridge] session.send ok turnId=%s sessionId=%s', turnId, sessionId)
      replyOk(req.id, { turnId })
    } catch (err) {
      if (activeTurn === state) {
        finalizeTurn(state, {
          kind: 'error',
          code: 'INTERNAL',
          message: err instanceof Error ? err.message : String(err),
        })
      }
      clearInFlight()
      logger.error('[dsh-opentui-bridge] session.send failed: %s', err)
      replyError(req.id, 'INTERNAL', err instanceof Error ? err.message : String(err))
    }
  }

  /** `session.close` — dispose handle, clear state, never exit the process. */
  async function handleClose(req: ParsedRequest): Promise<void> {
    if (binding === undefined) {
      replyError(req.id, 'SESSION_NOT_OPEN', 'no open session')
      return
    }
    const current = binding
    await disposeBinding(current)
    logger.info('[dsh-opentui-bridge] session.close ok id=%s', current.sessionId)
    replyOk(req.id, { sessionId: current.sessionId })
  }

  /** `turn.abort` — cancel ONLY the current in-flight turn (ADR-0010 I3).
   *
   * - `turnId` MUST be a non-empty string. Missing / empty / non-string ids are
   *   `BAD_PARAMS`, and the check runs first so a malformed request can never
   *   cancel an in-flight turn.
   * - `sessionId`, `binding`, and the handle are never touched here: no close,
   *   no dispose, no id change. The host's `agent.cancel({kind:'user'},{keepInbox:true})`
   *   fires the active driver's AbortSignal; the turn's terminal frame arrives
   *   on the existing firehose subscription (M2-2 maps an `aborted` reason to
   *   `turn.error{code:'ABORTED'}`).
   * - An unknown id (never seen, or not the current in-flight turn) is
   *   `TURN_NOT_FOUND` with `detail:{requestedTurnId, activeTurnId}`.
   * - Idempotent: repeating an abort for an already-terminal turn returns
   *   `{noop:true}` regardless of how many turns ran after it, as long as the id
   *   is still in the bounded FIFO (TERMINAL_TURN_ID_LIMIT). Repeating an abort
   *   for the in-flight turn before its terminal arrives is also a noop. An id
   *   evicted from the FIFO is no longer known and answers TURN_NOT_FOUND.
   */
  function handleAbort(req: ParsedRequest): void {
    // Validate first: a missing/empty/non-string turnId must never reach cancel.
    const requested = req.params.turnId
    if (typeof requested !== 'string' || requested === '') {
      replyError(req.id, 'BAD_PARAMS', 'turn.abort requires a non-empty turnId string')
      return
    }

    const state = activeTurn
    const inFlight =
      inFlightTurnId !== undefined && state !== undefined && !state.ended && inFlightTurnId === state.turnId

    // Already-terminal turn: bounded-FIFO idempotency, independent of whatever
    // turn is currently in flight (D3).
    if (terminalTurnIds.has(requested)) {
      replyOk(req.id, { noop: true, turnId: requested })
      return
    }

    // The named turn is the live one: issue (or repeat) its cancel.
    if (inFlight && requested === state.turnId) {
      if (state.abortRequested) {
        replyOk(req.id, { noop: true, turnId: state.turnId })
        return
      }

      const agent = binding?.handle.agent
      if (agent === undefined || typeof agent.cancel !== 'function') {
        replyError(req.id, 'INTERNAL', 'open agent has no cancel() seam')
        return
      }
      state.abortRequested = true
      try {
        // Fire-and-forget, exactly dsh-tui-pi's cancelActiveTurn: keepInbox
        // preserves queued prompts; only the active turn is aborted.
        agent.cancel({ kind: 'user' }, { keepInbox: true })
        logger.info('[dsh-opentui-bridge] turn.abort issued turnId=%s sessionId=%s', state.turnId, state.sessionId)
        replyOk(req.id, { turnId: state.turnId, aborted: true })
      } catch (err) {
        // cancel() threw before firing the driver's AbortSignal. Leaving the
        // guard set would make every retry a fake `{noop:true}` success, so the
        // turn could never be cancelled. Clear it so a retry reaches cancel().
        state.abortRequested = false
        logger.error('[dsh-opentui-bridge] turn.abort failed: %s', err)
        replyError(req.id, 'INTERNAL', err instanceof Error ? err.message : String(err))
      }
      return
    }

    // Unknown / stale id — never touches the in-flight turn.
    replyError(
      req.id,
      'TURN_NOT_FOUND',
      inFlight ? 'requested turnId does not match the in-flight turn' : 'requested turnId is not a known turn',
      { requestedTurnId: requested, activeTurnId: inFlightTurnId ?? null },
    )
  }

  /** ADR-0011 T3 — `ask.response` (client → host). Validation follows the
   *  existing parseRequest style: a malformed `params` object is rejected with
   *  ASK_INVALID_RESPONSE before the registry is touched. The registry's error
   *  code is forwarded VERBATIM — the full ADR-0011 §5 set is:
   *   ASK_UNKNOWN_REQUEST / ASK_ALREADY_ANSWERED / ASK_NOT_ADDRESSEE /
   *   ASK_TURN_ENDED / ASK_DEADLINE_EXCEEDED / ASK_CHANNEL_UNAVAILABLE /
   *   ASK_INVALID_RESPONSE.
   *  `answer()` currently returns the first five (plus INVALID_RESPONSE); the
   *  deadline/hard-cap and fail-closed codes originate in the registry's wall
   *  clocks / `failClosed()` and arrive here unchanged if surfaced by a later
   *  registry version. No code is rewritten or swallowed here.
   */
  function handleAskResponse(req: ParsedRequest): void {
    const parsed = validateAskResponse(req.params)
    if (!parsed.ok) {
      replyError(req.id, parsed.code, parsed.message)
      return
    }
    // T4: stash the client's params BEFORE answer() — its settle() emits
    // ask.settled synchronously through the registry sink, which is the single
    // wake-up for the host answerer's await. Questions need `answers` here.
    const pending = pendingAnswerers.get(parsed.value.eventId)
    if (pending !== undefined) pending.params = parsed.value
    const result = ask.answer(binding?.sessionId ?? '', parsed.value)
    if (!result.ok) {
      replyError(req.id, result.code, result.message)
      return
    }
    const settlement = result.settlement
    replyOk(req.id, {
      eventId: settlement.eventId,
      outcome: settlement.outcome,
      ...(settlement.code !== undefined ? { code: settlement.code } : {}),
      ...(settlement.message !== undefined ? { message: settlement.message } : {}),
    })
  }

  /** `session.list` — read-only enumeration of every session visible to the
   *  host. This is the bridge-side twin of the thin client's `session/list`
   *  RPC: it calls the SAME host service (`ctx.sessionController.list`) and
   *  returns the SAME wire value (`{items: SessionSummary[]}`), field for field
   *  — no reshape, no rename, no fabricated `title`/`sizeBytes`.
   *
   * - Read-only: no `agents.create/resume`, no `open`, no writer lock. It works
   *   with NO session open and never changes the binding (ADR-0010 I1/I6).
   * - Params follow the host's `SessionListRequest` (`cursor?: string`); an
   *   illegal cursor is `BAD_PARAMS`. The cursor is reserved by the host (the
   *   thin client does not send it) and is forwarded defensively.
   * - A missing service is a contract error (`UNSUPPORTED`), NOT an empty list:
   *   `{ok:true,result:{items:[]}}` and "capability unavailable" stay distinct.
   */
  async function handleListSessions(req: ParsedRequest): Promise<void> {
    const cursor = req.params.cursor
    if (cursor !== undefined && typeof cursor !== 'string') {
      replyError(req.id, 'BAD_PARAMS', 'session.list cursor must be a string')
      return
    }

    try {
      // 0.24 final knife: the 1:1 host call now rides the generated capcontract
      // chain (table lookup -> binder -> dispatcher -> createCapHostInvoke's
      // session/list arm), which reuses resolveSessionController + controller.list.
      const raw: unknown = await createCapInvoke(ctx)({
        methodId: CAP_SESSION_WIRE_METHODS['session.list'] as never,
        params: cursor !== undefined ? { cursor } : {},
      })
      // A malformed host reply means "host is broken", NOT "no sessions". Never
      // flatten it to an empty success: that would be indistinguishable from a
      // genuinely empty store (see ADR-0010 session.list contract).
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray((raw as { items?: unknown }).items)) {
        const reason =
          raw === null
            ? 'sessionController.list returned null'
            : Array.isArray(raw)
              ? 'sessionController.list returned an array, expected a SessionListValue object'
              : typeof raw !== 'object'
                ? `sessionController.list returned a non-object (${typeof raw})`
                : 'sessionController.list returned an object without an items array'
        logger.error('[dsh-opentui-bridge] session.list malformed reply: %s', reason)
        replyError(req.id, 'INTERNAL', 'sessionController.list returned a malformed value', { reason })
        return
      }
      const items = (raw as SessionListValueLike).items
      logger.info('[dsh-opentui-bridge] session.list ok items=%d', items.length)
      // Pass the host rows through unchanged — the wire shape is the contract.
      replyOk(req.id, { items })
    } catch (err) {
      logger.error('[dsh-opentui-bridge] session.list failed: %s', err)
      const message = err instanceof Error ? err.message : String(err)
      // The generated chain reports a missing service / unwired id as NOT_WIRED;
      // keep the ADR-0010 UNSUPPORTED contract (distinct from an empty list) and
      // the BAD_PARAMS cursor rejection the hand-wire used to own.
      if (message.startsWith('NOT_WIRED') || message.includes('unavailable')) {
        replyError(req.id, 'UNSUPPORTED', 'sessionController service unavailable: session.list capability not present', {
          capability: 'session.list',
          service: 'sessionController',
        })
        return
      }
      if (message.startsWith('BAD_PARAMS')) {
        replyError(req.id, 'BAD_PARAMS', message)
        return
      }
      const mapped = mapHostError(err)
      replyError(req.id, mapped.code, mapped.message, mapped.detail)
    }
  }

  // ---- L1 (0.23.1) — subagents.interrupt / subagents.stopChildren ----------

  /** Refresh the subagent index from the authoritative `session.list` source.
   *  Called before EVERY stop action: the index is a cache, the host list is the
   *  source of truth. A missing/broken host service is a clean miss (cached rows
   *  still carry the parent captured from the catalog event), never a thrown
   *  request — the binding gate + row recheck below still prevent wrong kills. */
  async function reconcileSubagentIndex(): Promise<void> {
    const controller = resolveSessionController(ctx)
    if (controller === undefined) {
      logger.warn('[dsh-opentui-bridge] subagent index reconcile skipped: sessionController unavailable')
      return
    }
    try {
      const raw: unknown = await controller.list({ _request: {} })
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as { items?: unknown }).items)) {
        const count = getSubagentIndex(ctx).syncFromList((raw as SessionListValueLike).items)
        logger.info('[dsh-opentui-bridge] subagent index reconciled: subagents=%d rows=%d', count, getSubagentIndex(ctx).rows.size)
      } else {
        logger.warn('[dsh-opentui-bridge] subagent index reconcile skipped: malformed session.list reply')
      }
    } catch (err) {
      logger.warn('[dsh-opentui-bridge] subagent index reconcile failed: %s', err)
    }
  }

  /**
   * Gate 1 — connection/session binding ownership.
   *
   * The bridge binding model is ONE `SessionBinding { sessionId, handle }` per
   * stdio connection: set only by `session.open` (ADR-0010 I1), cleared by
   * `session.close` / explicit replace / EOF. A stop request may address only
   * children of THAT bound session. Returning an error here means zero
   * enumeration and zero cancellation — no host list call, no agent lookup.
   */
  function gateSubagentParent(parentSessionId: unknown): { code: string; message: string; detail?: Record<string, unknown> } | undefined {
    if (binding === undefined) {
      return { code: 'NO_SESSION', message: 'no session is open; cannot authorize a subagent stop' }
    }
    if (typeof parentSessionId !== 'string' || parentSessionId === '') {
      return { code: 'BAD_PARAMS', message: 'parentSessionId must be a non-empty string' }
    }
    if (parentSessionId !== binding.sessionId) {
      return {
        code: 'OWNERSHIP_MISMATCH',
        message: 'parentSessionId is not the bound session',
        detail: { parentSessionId, boundSessionId: binding.sessionId },
      }
    }
    return undefined
  }

  /** Issue the host cancel for one child. `cancel` is synchronous / fire-and-
   *  forget (I3); a missing agent or a throw is isolated as `failed` detail. */
  function issueChildCancel(childId: string): string | undefined {
    try {
      const agents = resolveAgents(ctx)
      const agent = agents?.get(childId)
      if (agent === undefined) return 'agent not available in host registry'
      agent.cancel({ kind: 'user' }, { keepInbox: true })
      return undefined
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  async function handleInterruptSubagent(req: ParsedRequest): Promise<void> {
    const gate = gateSubagentParent(req.params.parentSessionId)
    if (gate !== undefined) {
      replyError(req.id, gate.code, gate.message, gate.detail)
      return
    }
    const childId = req.params.childId
    if (typeof childId !== 'string' || childId === '') {
      replyError(req.id, 'BAD_PARAMS', 'childId must be a non-empty string')
      return
    }
    const parentSessionId = req.params.parentSessionId as string

    await reconcileSubagentIndex()

    // Gate 2 — row-level parent recheck against the reconciled (host-truth)
    // snapshot BEFORE any cancel. A child of another parent is never cancelled.
    const index = getSubagentIndex(ctx)
    const row = index.get(childId)
    if (row === undefined || row.parentSessionId !== parentSessionId) {
      replyError(req.id, 'OWNERSHIP_MISMATCH', 'child is not a subagent of the bound session', {
        childId,
        parentSessionId,
      })
      return
    }
    if (row.status !== 'running') {
      replyOk(req.id, { childId, disposition: 'already-settled' })
      return
    }
    const detail = issueChildCancel(childId)
    replyOk(req.id, {
      childId,
      disposition: detail === undefined ? 'cancel-issued' : 'failed',
      ...(detail !== undefined ? { detail } : {}),
    })
  }

  async function handleStopChildren(req: ParsedRequest): Promise<void> {
    const gate = gateSubagentParent(req.params.parentSessionId)
    if (gate !== undefined) {
      replyError(req.id, gate.code, gate.message, gate.detail)
      return
    }
    const parentSessionId = req.params.parentSessionId as string

    await reconcileSubagentIndex()

    // Enumerate from the reconciled snapshot, RUNNING children of the bound
    // parent only — there is no global-stop path. Gate 2 is the explicit parent
    // recheck per row before cancel; a failing child is isolated to its own
    // `failed` result so one bad agent never aborts the batch.
    const index = getSubagentIndex(ctx)
    const children: Array<Record<string, unknown>> = []
    for (const [childId, row] of index.rows) {
      if (row.status !== 'running') continue
      if (row.parentSessionId !== parentSessionId) continue
      const detail = issueChildCancel(childId)
      children.push({
        childId,
        disposition: detail === undefined ? 'cancel-issued' : 'failed',
        ...(detail !== undefined ? { detail } : {}),
      })
    }
    replyOk(req.id, { children })
  }

  /** `journal.replay` — read-only drain of one session's durable event log.
   *
   * - Uses `persistence.open(id, 'read')` — never `'write'`, so it cannot steal
   *   or disturb a writer lock held by another process (ADR-0010 I4/I6).
   * - Works with NO session open: the client renders history before `open`.
   *   `sessionId` defaults to the current binding when omitted; it is required
   *   when nothing is open.
   * - `from` is an inclusive seq lower bound; rows are `{seq, type, payload}`
   *   (`payload` is the host event's `data`). `cursor` is always the FULL log's
   *   exclusive upper bound (`seq.max + 1`), independent of `from`.
   * - Host errors map through `mapHostError`: not-found -> `SESSION_NOT_FOUND`,
   *   corruption -> `JOURNAL_CORRUPT`, etc.
   */
  async function handleReplay(req: ParsedRequest): Promise<void> {
    const persistence = resolvePersistence(ctx)
    if (persistence === undefined) {
      replyError(req.id, 'INTERNAL', 'sessionPersistence service unavailable')
      return
    }

    const rawId = req.params.sessionId ?? binding?.sessionId
    if (typeof rawId !== 'string' || rawId === '') {
      replyError(req.id, 'BAD_PARAMS', 'journal.replay requires a sessionId (no session is open)')
      return
    }
    const from = req.params.from
    if (from !== undefined && (typeof from !== 'number' || !Number.isInteger(from) || from < 0)) {
      replyError(req.id, 'BAD_PARAMS', 'journal.replay from must be a non-negative integer seq')
      return
    }
    const sessionId = rawId

    try {
      const handle = await persistence.open(sessionId, 'read')
      try {
        // Paginated drain, mirroring dsh-tui-pi's readPersistedSession. A read
        // handle is a stable logical prefix; paging by returned event count is
        // the documented seam offset (first logical seq to include).
        const events: JournalEventLike[] = []
        let offset = 0
        for (;;) {
          const batch = await handle.read(offset)
          const slice = batch.events ?? []
          if (slice.length === 0) break
          events.push(...slice)
          offset += slice.length
        }

        let maxSeq = -1
        const rows: Array<{ seq: number; type: string; payload: unknown }> = []
        for (const e of events) {
          if (typeof e.seq !== 'number' || !Number.isFinite(e.seq)) {
            throw { name: 'SessionPersistenceCorruptionError', message: 'journal event has no numeric seq' }
          }
          if (e.seq > maxSeq) maxSeq = e.seq
          if (from !== undefined && e.seq < from) continue
          rows.push({
            seq: e.seq,
            type: typeof e.type === 'string' ? e.type : '',
            payload: e.data !== undefined ? e.data : {},
          })
        }
        const cursor = maxSeq + 1
        logger.info(
          '[dsh-opentui-bridge] journal.replay ok sessionId=%s rows=%d cursor=%d',
          sessionId,
          rows.length,
          cursor,
        )
        replyOk(req.id, { rows, cursor })
      } finally {
        await handle.close()
      }
    } catch (err) {
      logger.error('[dsh-opentui-bridge] journal.replay failed: %s', err)
      const mapped = mapHostError(err)
      replyError(req.id, mapped.code, mapped.message, mapped.detail)
    }
  }

  /** Dispatch a single request frame (async: open/send/close are async). */
  async function handleLine(raw: string): Promise<void> {
    let req: ParsedRequest
    try {
      req = parseRequest(raw)
    } catch (err) {
      const e = err as { code?: string; message?: string; id?: FrameId | null }
      replyError(e.id ?? null, e.code ?? 'BAD_FRAME', e.message ?? 'malformed frame')
      return
    }

    if (req.method === 'bridge.ping') {
      replyOk(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        bridgeVersion,
        hostVersion,
        capabilities: [...BRIDGE_CAPABILITIES],
      })
      return
    }
    if (req.method === 'bridge.hello') {
      const clientVersion = req.params.protocolVersion
      if (clientVersion !== undefined && clientVersion !== PROTOCOL_VERSION) {
        replyError(
          req.id,
          'VERSION_INCOMPATIBLE',
          `protocolVersion incompatible: client=${String(clientVersion)}, bridge=${PROTOCOL_VERSION}, host=${hostVersion}`,
          { clientProtocolVersion: clientVersion, bridgeProtocolVersion: PROTOCOL_VERSION, hostVersion },
        )
        return
      }
      replyOk(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        bridgeVersion,
        hostVersion,
        capabilities: [...BRIDGE_CAPABILITIES],
      })
      return
    }
    // S1: `model.currentSelection` is NOT a hand-copied `@manual` wire line any
    // more. It is served by the generated capcontract chain below (table lookup,
    // not `req.method ===`; see CAP_MODEL_WIRE_METHODS), projected from the
    // host's modelCatalog().default. The seam keeps the same frame name + reply
    // shape, so inproc boot is unchanged and the @manual count drops 12 → 11.
    // 0.24 final knife: `session.list` follows the same S1 table-lookup pattern
    // (CAP_SESSION_WIRE_METHODS) — no hand-copied `req.method ===` line. The
    // frame name/reply shape are unchanged; only the host call moved onto the
    // generated chain, so @manual drops 11 → 10.
    if (CAP_SESSION_WIRE_METHODS[req.method] !== undefined) {
      await handleListSessions(req)
      return
    }
    // 025-w1b B/C — session.search / session.fork ride the generated capcontract
    // chain (table lookup, not a hand-copied wire line). Replies are whitelist-
    // projected to the seam shapes: search → {items:[{id,snippet}]},
    // fork → {sessionId}. A missing host method degrades to UNSUPPORTED (never
    // a fake empty result / fake fork), matching the session.list discipline.
    const sessionQueryMethodId = CAP_SESSION_QUERY_WIRE_METHODS[req.method]
    if (sessionQueryMethodId !== undefined) {
      try {
        const value = await createCapInvoke(ctx)({
          methodId: sessionQueryMethodId as never,
          params: req.params ?? {},
        })
        // Branch on the CapIR id (not a hand-copied method-name comparison) so
        // the hand-copied protocol name inventory stays at 10 (gate #8a).
        if (sessionQueryMethodId.endsWith('/search')) {
          const raw = (value as SessionSearchValueLike | undefined)?.items
          const items = Array.isArray(raw)
            ? raw.map((it) => ({
                id: typeof it?.sessionId === 'string' ? it.sessionId : '',
                snippet: typeof it?.snippet === 'string' ? it.snippet.replace(/\s+/g, ' ').slice(0, 200) : '',
              })).filter((it) => it.id)
            : []
          replyOk(req.id, { items })
        } else {
          const newId = (value as SessionForkValueLike | undefined)?.sessionId
          if (typeof newId !== 'string' || newId === '') {
            replyError(req.id, 'INTERNAL', 'session.fork returned no sessionId')
            return
          }
          replyOk(req.id, { sessionId: newId })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const degraded = message.startsWith('NOT_WIRED') || message.includes('unavailable')
        replyError(req.id, degraded ? 'UNSUPPORTED' : (message.startsWith('BAD_PARAMS') ? 'BAD_PARAMS' : 'INTERNAL'), message)
      }
      return
    }
    // 025-w1b D — subagents.prompt (steer) / interruptByUser ride the generated
    // capcontract chain (table lookup, not a hand-copied wire line). Replies are
    // whitelist-projected ({ok}/{accepted}); a missing host service degrades to
    // UNSUPPORTED. These are DISTINCT from the two protocol frames below.
    const subagentMethodId = CAP_SUBAGENT_WIRE_METHODS[req.method]
    if (subagentMethodId !== undefined) {
      try {
        const value = await createCapInvoke(ctx)({
          methodId: subagentMethodId as never,
          params: req.params ?? {},
        })
        // No host text / id is echoed back: prompt → {ok:boolean}, interrupt →
        // {accepted:boolean} from the host's own acknowledgement only.
        replyOk(req.id, subagentMethodId.endsWith('/prompt')
          ? { ok: value !== null && value !== undefined }
          : { accepted: (value as { accepted?: unknown } | undefined)?.accepted === true })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const degraded = message.startsWith('NOT_WIRED') || message.includes('unavailable')
        replyError(req.id, degraded ? 'UNSUPPORTED' : (message.startsWith('BAD_PARAMS') ? 'BAD_PARAMS' : 'INTERNAL'), message)
      }
      return
    }
    // L1 (0.23.1) — subagent stop capability. Both frames are scoped to the
    // bound parent session; there is deliberately NO global-stop method.
    if (req.method === 'subagents.interrupt') {
      await handleInterruptSubagent(req)
      return
    }
    if (req.method === 'subagents.stopChildren') {
      await handleStopChildren(req)
      return
    }
    if (req.method === 'session.open') {
      await handleOpen(req)
      return
    }
    if (req.method === 'session.send') {
      await handleSend(req)
      return
    }
    if (req.method === 'session.close') {
      await handleClose(req)
      return
    }
    if (req.method === 'turn.abort') {
      handleAbort(req)
      return
    }
    if (req.method === 'ask.response') {
      handleAskResponse(req)
      return
    }
    if (req.method === 'journal.replay') {
      await handleReplay(req)
      return
    }
    // S1: model frames ride the generated capcontract chain. Table lookup (not
    // a hand-copied wire line) — see CAP_MODEL_WIRE_METHODS. A missing host
    // service / NOT_WIRED degrades to UNSUPPORTED, never a crash; a bad
    // selection surfaces the host's own error as INTERNAL with its message.
    const capMethodId = CAP_MODEL_WIRE_METHODS[req.method]
    if (capMethodId !== undefined) {
      try {
        const value = await createCapInvoke(ctx)({
          methodId: capMethodId as never,
          params: req.params ?? {},
        })
        if (req.method === CAP_SELECTION_READ_METHOD) {
          const d = (value as { default?: Partial<ModelSelectionLike> } | undefined)?.default
          const provider = typeof d?.provider === 'string' ? d.provider : ''
          const model = typeof d?.model === 'string' ? d.model : ''
          if (provider === '' || model === '') {
            replyError(req.id, 'UNSUPPORTED', 'agentDefaultModel selection unavailable')
            return
          }
          replyOk(req.id, {
            provider,
            model,
            ...(typeof d?.reasoningEffort === 'string' ? { reasoningEffort: d.reasoningEffort } : {}),
          })
          return
        }
        // Host results are records (catalog / {selected}) except the void
        // initializeDefaultModel; wrap non-records so replyOk keeps its shape.
        const result = value !== null && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : { value }
        replyOk(req.id, result)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const degraded = message.startsWith('NOT_WIRED') || message.includes('unavailable')
        replyError(req.id, degraded ? 'UNSUPPORTED' : 'INTERNAL', message)
      }
      return
    }
    // S5 /settings: settings document frames ride the same generated capcontract
    // chain (table lookup, not a hand-copied wire line). The host's redacted
    // document/namespace view is replied verbatim; its `settings/conflict` code
    // survives so the seam can retry a stale revision once.
    const settingsMethodId = CAP_SETTINGS_WIRE_METHODS[req.method]
    if (settingsMethodId !== undefined) {
      try {
        const value = await createCapInvoke(ctx)({
          methodId: settingsMethodId as never,
          params: req.params ?? {},
        })
        const result = value !== null && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : { value }
        replyOk(req.id, result)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const code = message.includes('settings/conflict') || /conflict/i.test(message)
          ? 'settings/conflict'
          : message.startsWith('NOT_WIRED') || message.includes('unavailable')
            ? 'UNSUPPORTED'
            : 'INTERNAL'
        replyError(req.id, code, message)
      }
      return
    }
    // S4b (R1) /account: unary account frames ride the same generated
    // capcontract chain (table lookup, not a hand-copied wire line). Every
    // reply is whitelist-projected: AccountView-returning methods go through
    // `projectAccountViewForFrame` (fixed four fields, URL value contributes
    // one boolean only); the other six through `projectAccountScalarResult`
    // (presence booleans / counts / ok only). NO host text or URL is copied.
    // The 2 stream methods are NOT here — they use createAccountWatchRelay.
    const accountMethodId = CAP_ACCOUNT_WIRE_METHODS[req.method]
    if (accountMethodId !== undefined) {
      try {
        const value = await createCapInvoke(ctx)({
          methodId: accountMethodId as never,
          params: req.params ?? {},
        })
        const result = ACCOUNT_VIEW_WIRE_METHODS.has(req.method)
          ? ({ ...projectAccountViewForFrame(value) } as Record<string, unknown>)
          : projectAccountScalarResult(req.method, value)
        replyOk(req.id, result)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const degraded = message.startsWith('NOT_WIRED') || message.includes('unavailable')
        replyError(req.id, degraded ? 'UNSUPPORTED' : 'INTERNAL', message)
      }
      return
    }
    // 025-w3-2 — hand-wired `llm/discoverModels` (the ONLY CAP_PROJECTED_BY_HAND
    // id, AMEND-2). The generic branch below would refuse it with
    // HAND_PROJECTION_REQUIRED -> UNSUPPORTED, so invoke the host adapter here
    // and apply a FIXED whitelist before any frame crosses the wire. The
    // request jsonSchema carries `apiKey` and the result has
    // additionalProperties:true — neither is ever copied verbatim. The seam
    // applies a SECOND whitelist on top. The E5 wire SENTINEL (generic refusal
    // with a hostile reply) stays in cap-generic-arm.test.ts.
    // The wire name is resolved from the GENERATED tables (C5) — no hand-copied
    // method-name line, which the ledger wired_protocol (ADR-0010 only)
    // reconciliation does not own. `CAP_PROJECTED_BY_HAND` has exactly one
    // member (llm/discoverModels, AMEND-2), so this branch is that id alone.
    const projectedByHandIds = [...CAP_PROJECTED_BY_HAND]
    const invokedCapId = (CAP_GENERIC_WIRE_METHODS as Record<string, string | undefined>)[req.method]
    if (projectedByHandIds.length === 1 && invokedCapId === projectedByHandIds[0]) {
      try {
        const value = await createCapInvoke(ctx)({
          methodId: invokedCapId as never,
          params: req.params ?? {},
        })
        replyOk(req.id, { value: projectDiscoverModelsForWire(value) })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const code = message.startsWith('BAD_PARAMS') ? 'BAD_PARAMS'
          : message.startsWith('NOT_WIRED') || message.includes('unavailable') ? 'UNSUPPORTED'
            : 'INTERNAL'
        replyError(req.id, code, message)
      }
      return
    }
    // W2-0d — generic wire branch (§3.2). LAST on purpose: every existing
    // hand-wired name above wins, so W2-0 observable behaviour is unchanged.
    // The wire name -> CapIR id lookup rides the GENERATED CAP_GENERIC_WIRE_METHODS
    // table (no hand-copied wire line, C5). With CAP_GENERIC_ADAPTERS empty at
    // base, `createCapInvoke` fails NOT_WIRED on every generic id and this branch
    // never emits a value frame — the arm is dormant. When a later batch adds an
    // id to the whitelist, default replies use sanitizeFrameForWire + record wrap;
    // CAP_PROJECTED_BY_HAND ids refuse generic projection (AMEND-2) so no
    // token/secret/password-class key can ever cross the wire for them.
    const genericConfig = createProductionGenericConfig(ctx)
    const genericMethodId = resolveGenericWireMethod(req.method, CAP_GENERIC_WIRE_METHODS, genericConfig)
    if (genericMethodId !== undefined && genericConfig.adapters.has(genericMethodId)) {
      try {
        const value = await createCapInvoke(ctx)({
          methodId: genericMethodId as never,
          params: req.params ?? {},
        })
        replyOk(req.id, projectGenericWireReply(genericConfig, genericMethodId, value, sanitizeFrameForWire))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const code = message.startsWith('BAD_PARAMS') ? 'BAD_PARAMS'
          : message.startsWith('BAD_KIND') ? 'UNSUPPORTED'
            // W2-3 R6: an unconfirmed write is refused with its own code so the
            // seam can reject honestly (never a silent/fake success).
            : message.startsWith('CONFIRM_REQUIRED') ? 'CONFIRM_REQUIRED'
              : message.startsWith('NOT_WIRED') || message.includes('unavailable') ||
                message.startsWith('HAND_PROJECTION_REQUIRED')
                ? 'UNSUPPORTED'
                : 'INTERNAL'
        replyError(req.id, code, message)
      }
      return
    }
    replyError(req.id, 'UNSUPPORTED', `unsupported method: ${req.method}`)
  }

  /** Enqueue a frame so async handlers answer in arrival order. */
  function enqueueLine(raw: string): void {
    dispatchChain = dispatchChain.then(() => handleLine(raw)).catch((err) => {
      logger.error('[dsh-opentui-bridge] unhandled request error: %s', err)
    })
  }

  /** Incremental UTF-8 decoder + line splitter: a `data` event is not a frame. */
  function onData(chunk: string): void {
    buffer += chunk
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      enqueueLine(line)
    }
  }

  /** Shared teardown: registered as the fiber disposer and also run on EOF. */
  function teardown(): void {
    if (closing) return
    closing = true
    process.stdin.off('data', onData)
    process.stdin.off('end', onEnd)
    process.stdin.off('close', onEnd)
    try {
      process.stdin.pause()
    } catch {
      /* stdin already gone */
    }
    // Requirement 6: EOF / fiber dispose removes every listener so a stale
    // firehose callback can never write to a closed stdout.
    clearTurnSubscriptions()
    // S3: release ALL host push subscriptions on teardown (closed connection).
    pushRelay.stopAll()
    accountRelay.stopAll()
    // T4 (D5): settle every host answerer await BEFORE disposing the registry.
    // `ask.dispose()` drops timers silently (no ask.settled), so teardown is the
    // only place left to guarantee no waterfall promise is left hanging on a
    // closed connection. First-wins makes this a no-op for already-settled asks.
    for (const eventId of [...pendingAnswerers.keys()]) {
      settleAnswerer(eventId, { outcome: 'cancelled' })
    }
    try { unsubApprovalAnswerer?.() } catch { /* already disposed */ }
    try { unsubQuestionsAnswerer?.() } catch { /* already disposed */ }
    unsubApprovalAnswerer = undefined
    unsubQuestionsAnswerer = undefined
    // Release every ask timer so a late deadline/hard-cap callback can never
    // emit a cancel/settled frame after the connection closed.
    ask.dispose()
    // 024 base task 4: stop the handshake poll so a disposed bridge never has
    // a timer that could log a late verdict after the connection closed.
    try {
      handshake?.cancel()
    } catch {
      /* already cancelled */
    }
    logger.info('[dsh-opentui-bridge] stdio protocol disposed')
  }

  let exitRequested = false

  /** After teardown, flush stdout and hand the exit to the host's graceful
   *  shutdown chain instead of calling process.exit (which would skip fiber
   *  disposal and any plugin flush, e.g. session persistence). */
  function requestGracefulExit(): void {
    if (exitRequested) return
    exitRequested = true

    const finish = () => {
      const resolved = resolveAppExit(ctx)
      if (resolved === undefined) {
        logger.warn(
          '[dsh-opentui-bridge] appExit service unavailable (host version difference); falling back to process.exitCode=0 and allowing natural exit',
        )
        process.exitCode = 0
        return
      }
      logger.info(
        `[dsh-opentui-bridge] requesting appExit(0) via ${resolved.source} for graceful host shutdown`,
      )
      try {
        resolved.fn(0)
      } catch (err) {
        // The host owns exit once requested; do not set exitCode or force exit.
        logger.error('[dsh-opentui-bridge] appExit(0) threw; leaving exit to the host: %s', err)
      }
    }

    if (process.stdout.writableLength > 0) {
      let done = false
      const once = () => {
        if (done) return
        done = true
        finish()
      }
      process.stdout.once('drain', once)
      const timer = setTimeout(once, 200)
      timer.unref()
    } else {
      finish()
    }
  }

  function onEnd(): void {
    if (eofSeen) return
    eofSeen = true
    // Tolerate a final frame that lacks a trailing newline.
    if (buffer.trim()) enqueueLine(buffer)
    buffer = ''
    // Let queued async handlers write their responses BEFORE teardown flips
    // `closing` (writeFrame drops frames once closing is true).
    void dispatchChain.finally(() => {
      teardown()
      // The host keeps FS watchers alive, so EOF would otherwise leave the
      // process hanging. Hand the exit to appExit so the host can dispose the
      // fiber gracefully (session persistence and other plugins get to flush).
      requestGracefulExit()
    })
  }

  // Arm the turn-event firehoses before stdin starts delivering requests, so a
  // session.open/send in the first input line is already observable.
  armTurnSubscriptions()
  // ADR-0011 T4: register the host waterfall answerers with containment. A
  // failure here is logged and swallowed — the rest of the plugin (ping,
  // session.*) must never go pending because cordis could not resolve a
  // service that is not declared in `inject` (see resolveSessionController).
  armAskAnswerers()

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', onData)
  process.stdin.on('end', onEnd)
  process.stdin.on('close', onEnd)

  return ctx.effect(() => () => {
    teardown()
    // This disposer runs only when the host disposes the fiber (i.e. after
    // appExit reached the shutdown chain). It doubles as the graceful-path
    // marker for the EOF test: process.exit would skip it entirely.
    logger.info('[dsh-opentui-bridge] host graceful shutdown: fiber disposed')
  }, 'dsh-opentui-bridge: stdio')
}

// ---------------------------------------------------------------------------
// ADR-0011 T1/T2 — ask channel skeleton exports.
// Type/value re-exports only: the dispatch switch above is untouched. T3 will
// import the request method + event names here and wire them into `apply()`.
// ---------------------------------------------------------------------------
export {
  ASK_ERROR_CODES,
  ASK_FRAME_TYPES,
  isAskErrorCode,
  validateAskRequest,
  validateAskCancel,
  validateAskPending,
  validateAskSettled,
  validateAskResponse,
  validateAskEvent,
} from './ask-frames'
export type {
  AskFrameType,
  AskEventType,
  AskErrorCode,
  AskKind,
  AskOutcome,
  AskVerdict,
  AskBehavior,
  AskCancelReason,
  AskOption,
  AskQuestion,
  AskAnswer,
  AskRequestPayload,
  AskCancelPayload,
  AskPendingPayload,
  AskSettledPayload,
  AskResponseParams,
  AskOutboundFrame,
  ParseResult,
} from './ask-frames'
export { AskRegistry, askRegistry, createAskRegistry, turnIdOf } from './ask-registry'
export type {
  AskRegistryOptions,
  AskRegistryLogger,
  AskSettlement,
  AnswerResult,
  FailClosedInput,
} from './ask-registry'
// ADR-0011 T7 — journal persistence + session-scoped permission summary.
export {
  ASK_JOURNAL_KINDS,
  ASK_PLUGIN_RECORD_PREFIX,
  ASK_GRANT_JOURNAL_TYPE,
  askPluginRecordType,
  alwaysGrantToolsFromJournal,
  SessionPermissionSummary,
  redactIdentifier,
  summarizeAnswers,
} from './ask-journal'
export type {
  AskJournalKind,
  AskJournalEvent,
  AskJournalSink,
  AskJournalSource,
  AskJournalAnswers,
} from './ask-journal'
