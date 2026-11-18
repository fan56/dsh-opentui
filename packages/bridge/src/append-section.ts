/**
 * M3-02 — append-system `systemPrompt.section` registration skeleton.
 *
 * Kept in its own file on purpose (ticket §4 scheduling advice #2): index.ts
 * is assembly-only, so the ask channel (ADR-0011) and this append work touch
 * disjoint files. No `@deepseek-ai/*` import here — only the structural shape
 * exported by index.ts is consumed (type-only, erased at runtime).
 *
 * Scope discipline (ADR-0010 "scope 注册，禁 global"): the real registration
 * point is the agent-scoped `setup: (agentCtx) => ...` callback on session.open
 * (M3-04). This module is deliberately agnostic about WHERE its ctx comes
 * from; it never registers on a root ctx by itself.
 */

import type { BridgeContext, SystemPromptLike } from './index'
import { createAppendTextProvider } from './append-text'
import type { AppendTextProvider, AppendTextProviderOptions } from './append-text'

// Re-export for callers/tests that consumed the M3-02 seam type from here.
export type { AppendTextProvider } from './append-text'

/**
 * Stable section name carrying the dsh-opentui prefix. ADR-0010 pins only
 * `order: 200` and gives no named constant for the section name — this id is
 * chosen here and is **待 ADR 终审** (pending ADR final review). Keep it stable
 * once shipped: M3-03's dedupe key and M3-05's preset mapping will key off it.
 */
export const APPEND_SECTION_NAME = 'dsh-opentui:append-system'

/** Literal order from ADR-0010:143 / M3-01 handshake (host has no named 200). */
const APPEND_SECTION_ORDER = 200

export interface RegisterAppendSectionOptions {
  /** Override the text provider entirely (highest precedence). */
  text?: AppendTextProvider
  /** Options for the default M3-03 append-text provider (home / logger /
   *  shouldSuppress / maxBytes). Ignored when `text` is set. Tests inject a
   *  temp `home` here so they never touch the real `~/.dsh`. */
  appendText?: AppendTextProviderOptions
}

const NOOP: () => void = () => {}
const EFFECT_LABEL = 'dsh-opentui:append-system section'

/**
 * Resolve `ctx.systemPrompt` through the same containment seam as
 * `resolveSessionController` in index.ts: cordis throws "cannot get property
 * ... without inject" for an undeclared service, so BOTH the ctx.get lookup and
 * the direct property access are wrapped. A missing/throwing lookup degrades
 * to `undefined`, never a crash — the plugin must stay live (ping, session.*).
 */
function resolveSystemPrompt(ctx: BridgeContext): SystemPromptLike | undefined {
  let svc: unknown
  try {
    svc = typeof ctx.get === 'function' ? ctx.get('systemPrompt') : undefined
    if (svc === undefined) svc = ctx.systemPrompt
  } catch {
    svc = undefined
  }
  return svc !== undefined && typeof (svc as SystemPromptLike).section === 'function'
    ? (svc as SystemPromptLike)
    : undefined
}

/**
 * Register the append section on the given (agent-scoped) ctx.
 *
 * - Missing/unavailable service: log one warning and return a no-op cleanup.
 * - Available service: register with `order: 200`, `interpolate: false`, hold
 *   the returned disposer through `ctx.effect`, and return an idempotent
 *   cleanup function (safe to call both explicitly and from effect teardown).
 *
 * @returns a cleanup function that disposes the registered section.
 */
export function registerAppendSection(
  ctx: BridgeContext,
  options: RegisterAppendSectionOptions = {},
): () => void {
  const sp = resolveSystemPrompt(ctx)
  if (sp === undefined) {
    warn(ctx, '[dsh-opentui-bridge] systemPrompt unavailable — append section not registered (plugin stays live)')
    return NOOP
  }

  // M3-03: default text is the real lazy provider; `ctx.logger` feeds its
  // truncation warning. Per-call overrides (temp home, shouldSuppress, etc.)
  // come through `options.appendText`. An explicit `text` still wins.
  const text = options.text ?? createAppendTextProvider({
    logger: ctx.logger,
    ...options.appendText,
  })

  let disposer: (() => void) | undefined
  try {
    disposer = sp.section({
      name: APPEND_SECTION_NAME,
      order: APPEND_SECTION_ORDER,
      text,
      interpolate: false,
    })
  } catch (err) {
    warn(ctx, '[dsh-opentui-bridge] append section registration contained (plugin stays live): %s', err)
    return NOOP
  }
  if (typeof disposer !== 'function') disposer = NOOP

  let disposed = false
  const cleanup = (): void => {
    if (disposed) return
    disposed = true
    try { disposer?.() } catch { /* host already disposed the section */ }
  }

  // Hold the disposer on the fiber so plugin unload tears the section down.
  ctx.effect(() => cleanup, EFFECT_LABEL)
  return cleanup
}

/** Logging is best-effort: a missing logger must not break the degrade path. */
function warn(ctx: BridgeContext, format: unknown, ...params: unknown[]): void {
  try {
    ctx.logger?.warn(format, ...params)
  } catch {
    /* no logger — degrade silently */
  }
}
