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
import { AskRegistry } from './ask-registry'
// ADR-0011 T7 — redacted decision journal + session-scoped permission summary.
import { askPluginRecordType, type AskJournalEvent } from './ask-journal'
// M3-02 — section registration skeleton lives in append-section.ts; index.ts
// stays assembly-only so it does not grow the overlap surface with ask (ADR-0011).
import { registerAppendSection } from './append-section'
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

/** `agents` is required for the session seam; `agentDefaultModel` is optional
 *  (read through ctx.get). Cordis resolves injected services before apply. */
export const inject: string[] = ['agents']

/**
 * M3-02 assembly seam. registerAppendSection is deliberately NOT called from
 * apply(): ADR-0010 requires the section to be registered at AGENT scope
 * ("scope 注册，禁 global"), and the only agent-scoped handle is the
 * `setup: (agentCtx) => ...` callback on session.open's create/resume — that
 * wiring is M3-04. This thin, testable helper is the single assembly point:
 * callers pass the agent-scoped ctx once M3-04 lands. Keeping it out of the
 * session.open block also keeps this task clear of the ask-channel diff.
 */
export function armAppendSection(ctx: BridgeContext): () => void {
  return registerAppendSection(ctx)
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
function resolveSessionController(ctx: BridgeContext): SessionControllerLike | undefined {
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
  return svc !== undefined && typeof (svc as SessionControllerLike).list === 'function'
    ? (svc as SessionControllerLike)
    : undefined
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

  /** Write one NDJSON frame, pausing stdin on backpressure until drain. */
  function writeFrame(frame: unknown): void {
    if (closing) return
    const line = `${JSON.stringify(frame)}\n`
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

  const ask = new AskRegistry({
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

  /** `session/event` listener. Every event is gated on the currently open
   *  session id AND the in-flight turn's numeric turn, so other sessions —
   *  including subagent child sessions riding the same firehose — never leak
   *  into this turn's frames. */
  function onSessionEvent(session: unknown, event: unknown): void {
    const state = activeTurn
    if (state === undefined || state.ended) return
    const s = session as { id?: unknown }
    if (idString(s?.id) !== state.sessionId) return
    const e = event as { type?: unknown; data?: unknown }
    const type = typeof e?.type === 'string' ? e.type : ''
    const data = e?.data !== null && typeof e?.data === 'object' ? (e.data as Record<string, unknown>) : {}
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
        output: contentText(message?.content),
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
  /** Resolve the single deliverable (session, turn) for an inbound ask. The
   *  bridge owns one binding and one in-flight turn; an ask is deliverable only
   *  while that turn is live. `agent.session.id` is the host's routing identity
   *  (waterfall `claims()`) — a foreign session is NEVER answered here. */
  function askTarget(agent: unknown): { turn: TurnStreamState; sessionId: string } | undefined {
    const state = activeTurn
    if (state === undefined || state.ended || binding === undefined) return undefined
    if (state.sessionId !== binding.sessionId) return undefined
    const agentSessionId = (agent as ApprovalAgentLike | undefined)?.session?.id
    if (agentSessionId !== undefined && idString(agentSessionId) !== binding.sessionId) return undefined
    return { turn: state, sessionId: binding.sessionId }
  }

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
      failClosedAsk('approval', 'no-turn', '', 'no open in-flight turn to deliver an approval ask')
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
    // dsh-user-approval's ApprovalRequestEvent (src/types.ts:63-76) and the
    // dsh-tools call site (pipeline.js:628-635) carry NO escalation field: no
    // escalation is granted, so `behavior:'always'` stays invalid (Q3). State
    // it explicitly rather than fabricate a grant.
    let request: AskRequestPayload | undefined
    try {
      request = ask.create(target.turn.turnId, {
        sessionId: target.sessionId,
        kind: 'approval',
        ...(toolName !== undefined ? { toolName } : {}),
        ...(callId !== undefined ? { callId } : {}),
        ...(reason !== undefined ? { reason } : {}),
        escalation: false,
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
      failClosedAsk('questions', 'no-turn', '', 'no open in-flight turn to deliver a questions ask')
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
    // level firehose subscriptions stay armed (they are session-filtered), but
    // no further frames can be emitted without an activeTurn. This is what
    // keeps A's late events from landing under B's turnId after an open-replace.
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
      // M3-04 TODO: pass `setup: (agentCtx) => armAppendSection(agentCtx)` in
      // BOTH agents.create and agents.resume options below so the append
      // section registers at agent scope (ADR-0010 "scope 注册，禁 global").
      // M3-02 intentionally stops at the testable assembly helper above.
      if (mode === 'new') {
        // I1: a fresh id is minted here and only here.
        sessionId = randomUUID()
        handle = await agents.create({
          sessionId,
          meta: { cwd: process.cwd() },
          agentOptions: buildAgentOptions(ctx),
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
          logger.info('[dsh-opentui-bridge] session.open resume %s', id)
          handle = await agents.resume({
            resumeSessionId: id,
            agentOptions: buildAgentOptions(ctx),
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
    const controller = resolveSessionController(ctx)
    if (controller === undefined) {
      replyError(req.id, 'UNSUPPORTED', 'sessionController service unavailable: session.list capability not present', {
        capability: 'session.list',
        service: 'sessionController',
      })
      return
    }

    const cursor = req.params.cursor
    if (cursor !== undefined && typeof cursor !== 'string') {
      replyError(req.id, 'BAD_PARAMS', 'session.list cursor must be a string')
      return
    }

    try {
      const raw: unknown = await controller.list({ _request: cursor !== undefined ? { cursor } : {} })
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
      const mapped = mapHostError(err)
      replyError(req.id, mapped.code, mapped.message, mapped.detail)
    }
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
      replyOk(req.id, { protocolVersion: PROTOCOL_VERSION, bridgeVersion, hostVersion })
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
      replyOk(req.id, { protocolVersion: PROTOCOL_VERSION, bridgeVersion, hostVersion })
      return
    }
    if (req.method === 'model.currentSelection') {
      // Read-only host route, transcribed from `ctx.agentDefaultModel.currentSelection()`.
      // The client seam reads this at boot (`bridge-session-seam.currentModelSelection`)
      // before staging the first session.open; without it the inproc client aborts
      // boot with BridgeProtocolError(UNSUPPORTED) and never opens a session (so the
      // approval gate can never be reached). No new protocol version: this is an
      // additive read method on the existing v1 dispatch.
      const defaults = resolveDefaultModel(ctx)
      if (defaults === undefined) {
        replyError(req.id, 'UNSUPPORTED', 'agentDefaultModel service unavailable')
        return
      }
      try {
        replyOk(req.id, defaults.currentSelection())
      } catch (err) {
        replyError(req.id, 'INTERNAL', err instanceof Error ? err.message : String(err))
      }
      return
    }
    if (req.method === 'session.list') {
      await handleListSessions(req)
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
  askPluginRecordType,
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
