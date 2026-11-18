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
 * identity is hard-coded in the listener logic. The default profile registers
 * this gate with an EMPTY policy (inert): it is enabled independently by
 * setting `config.tools` in a scratch profile.
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

/** Structural slice of the host's `ToolExecution` — only `.name` is read. */
export interface GateExecLike {
  readonly name?: unknown
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

/** Build the `tools/pre-execute` listener from a normalized policy. */
export function createPreExecuteListener(
  config: ApprovalGateConfig,
): (exec: GateExecLike, next: () => Promise<PreToolDecisionLike>) => Promise<PreToolDecisionLike> {
  return (exec, next) => {
    const decision = decideAsk(exec, config)
    if (decision !== undefined) return Promise.resolve(decision)
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
    const listener = createPreExecuteListener(policy)
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
