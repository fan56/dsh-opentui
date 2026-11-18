/**
 * M3-05 — resume preset migration decoration layer.
 *
 * ADR-0010:134 "映射在 bridge 的 resume 装饰层、open 之前完成，不进入持久化层"
 * and ADR-0009:47. On resume we READ the persisted session header to learn its
 * agent preset id; when it is the legacy synthetic append id we decorate the
 * in-memory `agents.resume` options with `preset: 'standard'`, emit ONE warning
 * per session per process, and tell the M3-04 setup to suppress the append
 * section (dedupe) — without writing any durable state.
 *
 * Source-verified reading path (NO @deepseek-ai/* runtime import — structural
 * typing discipline, see index.ts top note):
 *  - `@deepseek-ai/dsh-session` `lib/types/types.d.ts:94-96`: `SessionHeader`
 *    carries `readonly agentPreset?: string` ("Id of the agent preset this
 *    session's agent was composed from ... durable").
 *  - `@deepseek-ai/dsh-session-persistence` `lib/types/handle.d.ts:52-54`:
 *    `SessionHandle` exposes `readonly header: SessionHeader`.
 *  - `@deepseek-ai/dsh-agent-loop` `lib/index.js:1727-1781`: `resume()` loads
 *    the session via `persistence.open(id, 'write')` and prepares it with
 *    `meta: structuredClone(handle.header)` — so the preset id the bridge can
 *    observe read-only is exactly `handle.header.agentPreset`.
 *
 * The host `AgentOptions` (`dsh-agent` `lib/types/runtime-types.d.ts`) does not
 * formally declare a `preset` field (it is merge-extensible); the ticket and
 * ADR define the decoration-layer contract as overriding `preset` to the
 * shipped `standard` preset id (append-system.ts:32 roster:
 * standard/ptc/minimal/cordis). We therefore SET the field rather than delete
 * it, leaving provider/model/reasoningEffort accessors intact.
 */

import { APPEND_SYSTEM_PRESET_ID } from './append-text'

/** The shipped default preset id (append-system.ts:32 roster). */
export const STANDARD_PRESET_ID = 'standard'

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
interface MigrationLogger {
  warn(format: unknown, ...params: unknown[]): void
}

/** Process-local memory of sessions already warned. NOT persisted, NOT in the
 *  message stream — the Q3 semantics: once per migrated session per process. */
const warnedAppendSessions = new Set<string>()

/** Warn exactly once per session id in this process. */
export function warnAppendMigrationOnce(logger: MigrationLogger, sessionId: string): void {
  if (warnedAppendSessions.has(sessionId)) return
  warnedAppendSessions.add(sessionId)
  logger.warn(
    '[dsh-opentui-bridge] session %s: legacy preset "%s" migrated to "%s" in-memory for resume; append content is now injected by the bridge section (no durable state changed)',
    sessionId,
    APPEND_SYSTEM_PRESET_ID,
    STANDARD_PRESET_ID,
  )
}
