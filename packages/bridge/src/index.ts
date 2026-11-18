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
 * persistence drain, no writer lock — I6).
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

const PROTOCOL_VERSION = 1
const STDIO_SWITCH = 'DSH_OPENTUI_BRIDGE_STDIO'

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
  /** Last finalized turn id — lets a repeated `turn.abort` on an already-ended
   *  turn answer `{noop:true}` instead of an error. */
  let lastTerminalTurnId: string | undefined
  let unsubSessionEvent: (() => void) | undefined
  let unsubStream: (() => void) | undefined

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
    lastTerminalTurnId = state.turnId
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
    binding = undefined
    inFlightTurnId = undefined
    lastTerminalTurnId = undefined
    // Drop any in-flight stream accumulator for this session. The connection-
    // level firehose subscriptions stay armed (they are session-filtered), but
    // no further frames can be emitted without an activeTurn. This is what
    // keeps A's late events from landing under B's turnId after an open-replace.
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
              logger.warn('[dsh-opentui-bridge] turn %s idle with no terminal frame; releasing TURN_BUSY', turnId)
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
   * - `sessionId`, `binding`, and the handle are never touched here: no close,
   *   no dispose, no id change. The host's `agent.cancel({kind:'user'},{keepInbox:true})`
   *   fires the active driver's AbortSignal; the turn's terminal frame arrives
   *   on the existing firehose subscription (M2-2 maps an `aborted` reason to
   *   `turn.error{code:'ABORTED'}`).
   * - `turnId` must name the current in-flight turn. A different/unknown id is
   *   `TURN_NOT_FOUND` (detail carries the requested and active ids).
   * - Idempotent: repeating the abort of the same turn — whether its terminal
   *   has arrived or not — returns `{ noop: true }` instead of an error.
   */
  function handleAbort(req: ParsedRequest): void {
    const requested = req.params.turnId
    if (requested !== undefined && (typeof requested !== 'string' || requested === '')) {
      replyError(req.id, 'BAD_PARAMS', 'turn.abort requires a non-empty turnId string')
      return
    }

    const state = activeTurn
    const inFlight =
      inFlightTurnId !== undefined && state !== undefined && !state.ended && inFlightTurnId === state.turnId

    if (!inFlight) {
      // No live turn. Repeating an abort on the last finalized turn (or on a
      // turn whose cancel was already issued) is a successful no-op.
      if (requested === undefined || requested === lastTerminalTurnId) {
        replyOk(req.id, { noop: true, ...(requested !== undefined ? { turnId: requested } : {}) })
        return
      }
      replyError(
        req.id,
        'TURN_NOT_FOUND',
        'requested turnId is not the current in-flight turn',
        { requestedTurnId: requested, activeTurnId: inFlightTurnId ?? null },
      )
      return
    }

    if (requested !== undefined && requested !== state.turnId) {
      replyError(
        req.id,
        'TURN_NOT_FOUND',
        'requested turnId does not match the in-flight turn',
        { requestedTurnId: requested, activeTurnId: state.turnId },
      )
      return
    }

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
      logger.error('[dsh-opentui-bridge] turn.abort failed: %s', err)
      replyError(req.id, 'INTERNAL', err instanceof Error ? err.message : String(err))
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
