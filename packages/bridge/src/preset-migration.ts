/**
 * M3-05 (post-8e0e847) — legacy append preset id DETECTION only.
 *
 * Architecture ruling (blocky, 2026-11-18): the synthetic id
 * `opentui-append-system` is INERT historical metadata in the inproc profile:
 * host `AgentOptions`/`ResumeAgentOptions` have no `preset` field,
 * `agentOptions.preset` has no consumer, and inproc mounts no `agentPresets`
 * service. The header is readonly and is never cleaned or overwritten.
 *
 * Therefore this module only READS `header.agentPreset` to emit ONE debug log
 * per resume (expected state — no warn, no once-per-session Set). The append
 * content is injected unconditionally by the M3-04 bridge section, and inproc
 * and legacy-opentui mount surfaces are structurally mutually exclusive, so no
 * dedupe predicate is needed: suppressing on the id only eats content.
 *
 * Source-verified reading path (NO @deepseek-ai/* runtime import — structural
 * typing discipline, see index.ts top note):
 *  - `@deepseek-ai/dsh-session` `src/types.ts:95-136`: `SessionHeader` carries
 *    `readonly agentPreset?: string`; its persisted meta has no system-prompt
 *    assembly field (`:143-165`), so the append text is never in the header.
 *  - `@deepseek-ai/dsh-session-persistence`: `SessionHandle.header` is that
 *    immutable header.
 *  - `@deepseek-ai/dsh-agent-loop` `src/index.ts:805-807`: resume prepares the
 *    session with `meta: structuredClone(handle.header)` — the value observed
 *    through a read-only handle is exactly `handle.header.agentPreset`.
 */

import { APPEND_SYSTEM_PRESET_ID } from './append-text'

/** Read-only slice of the persistence handle we need (dsh-session-persistence
 *  `SessionHandle.header`). `read`/`close` keep it structurally compatible with
 *  the bridge's `PersistenceHandleLike` in index.ts. */
export interface SessionPresetHandleLike {
  readonly header?: { readonly agentPreset?: unknown }
  read(offset?: number, length?: number): Promise<{ events?: readonly unknown[] }>
  close(): Promise<void>
}

/** Read-only slice of `ctx.sessionPersistence`. */
export interface SessionPresetPersistenceLike {
  open(id: string, access: 'read' | 'write'): Promise<SessionPresetHandleLike>
}

/**
 * Whether a persisted preset value denotes the legacy synthetic append preset.
 *
 * The canonical value is a bare string (`SessionHeader.agentPreset`), but hosts
 * / older records have been seen to carry it as an array or a nested projection;
 * we therefore match by shape: string equality, array members, or any nested
 * string value. A missing/unreadable value is a clean miss (never a throw).
 */
export function presetMentionsAppend(value: unknown): boolean {
  if (typeof value === 'string') return value === APPEND_SYSTEM_PRESET_ID
  if (Array.isArray(value)) return value.some(presetMentionsAppend)
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some(presetMentionsAppend)
  }
  return false
}

/**
 * Read the session's `header.agentPreset` through a READ-ONLY handle.
 * Any failure (no persistence service, open/read/close throw, missing header
 * or field) degrades to `undefined` = "not a legacy append session" so a
 * detection problem can never block resume. Never opens `'write'`; never
 * appends; the handle is always closed.
 */
export async function readSessionAgentPreset(
  persistence: SessionPresetPersistenceLike | undefined,
  sessionId: string,
): Promise<unknown> {
  if (persistence === undefined) return undefined
  let handle: SessionPresetHandleLike | undefined
  try {
    handle = await persistence.open(sessionId, 'read')
    return handle?.header?.agentPreset
  } catch {
    return undefined
  } finally {
    if (handle !== undefined) {
      try { await handle.close() } catch { /* best-effort teardown */ }
    }
  }
}

/** Minimal logging surface; `ctx.logger` satisfies it. */
interface DetectionLogger {
  debug(format: unknown, ...params: unknown[]): void
}

/**
 * Observe a legacy id on every resume (no once-per-session Set). This state is
 * EXPECTED — debug, not warn. The append content is owned by the bridge section.
 */
export function logLegacyAppendPreset(logger: DetectionLogger): void {
  logger.debug(
    `[append-system] header.agentPreset="${APPEND_SYSTEM_PRESET_ID}" 为旧版合成 preset id，在本 profile 中不生效（无 agentPresets 服务）；append 内容由 bridge section 注入，行为与新建会话一致`,
  )
}
