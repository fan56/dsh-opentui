/**
 * Pre-execute approval gate (ADR-0011 — makes "approval: ask" actually fire).
 *
 * The host's `tools/pre-execute` waterfall defaults to `{kind:'allow'}`; the
 * approval policy itself is only an ANSWER policy (it decides the fate of a
 * request that already exists). Nothing in the stock host emits the `ask`
 * decision, so an approval card never appears for ordinary write tools.
 *
 * This module is the missing TRIGGER. It is a standalone cordis plugin that
 * registers one `tools/pre-execute` listener: for tools named in `config.tools`
 * it returns `{kind:'ask', reason, displayReason?}`, which drives the host's
 * `serviceAsk()` -> `approval.request()` -> waterfall `approval/request` ->
 * bridge answerer -> `ask.request` -> TUI approval card. For every other tool it
 * delegates with `next()` (the built-in default is allow).
 *
 * The policy is DATA, supplied by the profile patch's `config` (see
 * packages/shell/scripts/provision-inproc-profile.mjs). Nothing about tool
 * identity is hard-coded in the listener logic. T9 arms the shipped inproc
 * profile with WRITE_TOOL_POLICY by default (and switches the preset to
 * workspace-write + approval: ask); `DSH_OPENTUI_APPROVAL_GATE=off` disables it.
 *
 * No `@deepseek-ai/*` runtime import: all host shapes are transcribed locally,
 * matching the rest of the bridge package (the build script keeps the whole
 * `@deepseek-ai` scope external).
 */

/** The only directive that upgrades a call to an approval ask. */
export type GateDirective = 'ask'

/** A write-oriented, defensible starter policy. Exported as DATA so a profile
 *  (or a test) can reuse it instead of re-typing tool names; the listener never
 *  reads it implicitly — only `config.tools` decides. */
export const WRITE_TOOL_POLICY: Readonly<Record<string, GateDirective>> = Object.freeze({
  bash: 'ask',
  write: 'ask',
  edit: 'ask',
  apply_patch: 'ask',
})

/** Default audited reason when a profile enables the gate but omits `reason`. */
export const DEFAULT_GATE_REASON = 'Write operations require human approval'

/** Plain-object guard that does not accept arrays or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Normalized, internally consistent gate policy. */
export interface ApprovalGateConfig {
  /** Master switch. `false` passes everything. Default: true. */
  enabled: boolean
  /** tool name -> 'ask'. Any other/missing value passes the tool through. */
  tools: Readonly<Record<string, GateDirective>>
  /** Audited approval reason carried to `PreToolDecision.reason`. */
  reason: string
  /** Optional localized prompt text carried to `PreToolDecision.displayReason`. */
  displayReason?: Readonly<Record<string, string>>
}

/**
 * Resolve a patch `config` value into a safe normalized policy.
 * - a non-object / missing `tools` yields an EMPTY policy => all pass;
 * - a malformed `displayReason` (no string `en`) is dropped;
 * - `enabled:false` is honored.
 * Fail-soft: a bad config can never deny a legitimate tool.
 */
export function resolveApprovalGateConfig(config: unknown): ApprovalGateConfig {
  if (!isRecord(config)) {
    return { enabled: false, tools: Object.freeze({}), reason: DEFAULT_GATE_REASON }
  }
  const tools: Record<string, GateDirective> = {}
  if (isRecord(config.tools)) {
    for (const [name, directive] of Object.entries(config.tools)) {
      if (name !== '' && directive === 'ask') tools[name] = 'ask'
    }
  }
  const reason = typeof config.reason === 'string' && config.reason !== '' ? config.reason : DEFAULT_GATE_REASON
  const result: ApprovalGateConfig = {
    enabled: config.enabled !== false,
    tools: Object.freeze(tools),
    reason,
  }
  if (isRecord(config.displayReason) && typeof config.displayReason.en === 'string') {
    const display: Record<string, string> = {}
    for (const [locale, text] of Object.entries(config.displayReason)) {
      if (typeof text === 'string') display[locale] = text
    }
    result.displayReason = Object.freeze(display)
  }
  return result
}

/** The ask decision returned to the host when a tool matches the policy. */
export interface GateAskDecision {
  kind: 'ask'
  reason: string
  displayReason?: { readonly en: string; readonly [locale: string]: string }
}

/** Structural slice of the host's `PreToolDecision` (only the arms we emit or
 *  delegate to). Kept local so the gate imports no host package. */
export type PreToolDecisionLike =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string; info?: unknown }
  | { kind: 'cancel' }
  | GateAskDecision

/** Structural slice of the host's `ToolExecution` — `.name` gates the policy,
 *  `.agent.session` is the live session consulted for the effective approval
 *  policy (written by dsh-agent-loop / pipeline at runtime). Kept local so the
 *  gate imports no host package. */
export interface GateExecLike {
  readonly name?: unknown
  readonly agent?: { readonly session?: unknown }
}

/** Local structural face of the host approval service (no runtime import).
 *  Only `effectivePolicy` is read, and every call is contained. */
interface ApprovalPolicyLike {
  effectivePolicy?(session: unknown): string | undefined
}

/** Resolves the current effective approval policy of an exec's session, or
 *  `undefined` when it cannot be determined (fail-open → keep asking). */
export type GatePolicyLookup = (exec: GateExecLike) => string | undefined

/** Pull a printable session id out of the opaque session face for logging. */
function sessionIdOf(session: unknown): string {
  if (session !== null && typeof session === 'object') {
    const id = (session as { id?: unknown }).id
    if (typeof id === 'string' && id !== '') return id
  }
  return '(unknown)'
}

/**
 * Pure policy decision. Returns an `ask` decision for a tool named in the
 * policy, otherwise `undefined` (meaning: call `next()`). Exported for unit
 * tests; the listener below is a thin async adapter over it.
 */
export function decideAsk(exec: GateExecLike | null | undefined, config: ApprovalGateConfig): GateAskDecision | undefined {
  if (!config.enabled) return undefined
  const name = exec !== null && exec !== undefined ? (exec as GateExecLike).name : undefined
  if (typeof name !== 'string' || name === '') return undefined
  if (config.tools[name] !== 'ask') return undefined
  const decision: GateAskDecision = { kind: 'ask', reason: config.reason }
  if (config.displayReason !== undefined) {
    decision.displayReason = config.displayReason as { readonly en: string; readonly [locale: string]: string }
  }
  return decision
}

/** Build the `tools/pre-execute` listener from a normalized policy.
 *
 *  `lookup` (when provided) reads the session's effective approval policy on
 *  every hit. A session on 'never' (host full access) rejects every ask BEFORE
 *  the bridge answerer runs, so asking there would only produce an instant
 *  rejection — the listener lets the call through with `next()` instead. Every
 *  uncertain path (no lookup / no session / service or method missing / lookup
 *  threw / any policy other than 'never') stays on the original ask path. */
export function createPreExecuteListener(
  config: ApprovalGateConfig,
  lookup?: GatePolicyLookup,
  onBypass?: (exec: GateExecLike) => void,
): (exec: GateExecLike, next: () => Promise<PreToolDecisionLike>) => Promise<PreToolDecisionLike> {
  return (exec, next) => {
    const decision = decideAsk(exec, config)
    if (decision !== undefined) {
      if (lookup?.(exec) === 'never') {
        onBypass?.(exec)
        return next()
      }
      return Promise.resolve(decision)
    }
    return next()
  }
}

/** Minimal cordis context face used by `apply` (no host import). */
export interface GateContext {
  logger?: {
    info(format: unknown, ...params: unknown[]): void
    warn(format: unknown, ...params: unknown[]): void
  }
  on?(name: string, listener: (...args: unknown[]) => unknown): () => void
  effect(execute: () => () => void | Promise<void>, label?: string): unknown
  /** Cordis service lookup (works without declaring an injection). */
  get?(name: string, strict?: boolean): unknown
}

export const name = 'dsh-opentui-approval-gate'

/**
 * Cordis plugin entry. Registers one root-scope listener (cordis propagates the
 * scoped `tools/pre-execute` waterfall up to root, as it does for the bridge's
 * `session/event` / `agent/assistant-stream` subscriptions). The disposer is
 * owned by `ctx.effect` so unload never leaks the listener.
 */
export function apply(ctx: GateContext, config: unknown): unknown {
  const policy = resolveApprovalGateConfig(config)
  const tools = Object.keys(policy.tools)
  ctx.logger?.info(
    '[approval-gate] armed enabled=%s tools=%s reason=%s',
    String(policy.enabled),
    tools.length === 0 ? '(none — inert)' : tools.join(','),
    policy.reason,
  )

  const effect = (): (() => void) => {
    if (typeof ctx.on !== 'function') {
      ctx.logger?.warn('[approval-gate] ctx.on unavailable — gate not registered (all tools pass)')
      return () => {}
    }
    // Resolve the approval service PER pre-execute, never once at registration:
    // cordis may load it after the gate, and /permission switches the effective
    // policy at runtime. Any lookup failure degrades to "no policy" → ask.
    const lookup: GatePolicyLookup = (exec) => {
      const session = exec.agent?.session
      if (session === undefined || session === null) return undefined
      let approval: ApprovalPolicyLike | undefined
      try {
        approval = typeof ctx.get === 'function'
          ? ctx.get('approval') as ApprovalPolicyLike | undefined
          : undefined
      } catch {
        return undefined
      }
      if (typeof approval?.effectivePolicy !== 'function') return undefined
      try {
        return approval.effectivePolicy(session)
      } catch {
        return undefined
      }
    }
    const onBypass = (exec: GateExecLike): void => {
      const toolName = typeof exec.name === 'string' && exec.name !== '' ? exec.name : '(unknown)'
      ctx.logger?.info(
        '[approval-gate] policy bypass: %s passes without ask (session %s effective policy never)',
        toolName,
        sessionIdOf(exec.agent?.session),
      )
    }
    const listener = createPreExecuteListener(policy, lookup, onBypass)
    const unsub = ctx.on('tools/pre-execute', listener as (...args: unknown[]) => unknown)
    return () => {
      try {
        unsub()
      } catch {
        /* already disposed */
      }
    }
  }
  return ctx.effect(effect, 'dsh-opentui-approval-gate')
}
