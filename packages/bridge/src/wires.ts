/**
 * Bridge wire ids — single source of truth for the stdio JSON-lines protocol.
 *
 * The dispatch in `index.ts` compares against these constants (both the
 * pre-existing twelve wires and the batch-1 additions) so a wire id is spelled
 * in exactly one place. Naming follows the established dotted, lower-camel
 * style: `namespace.verb` (`session.send`, `model.currentSelection`, ...).
 *
 * This module is pure data: no host imports, no runtime code, no side effects.
 * It is bundled into the bridge entry through `index.ts`.
 */

export const WIRE = {
  // ---- handshake / read-only (existing) -----------------------------------
  BRIDGE_PING: 'bridge.ping',
  BRIDGE_HELLO: 'bridge.hello',
  MODEL_CURRENT_SELECTION: 'model.currentSelection',

  // ---- session / turn (existing) -----------------------------------------
  SESSION_LIST: 'session.list',
  SESSION_OPEN: 'session.open',
  SESSION_SEND: 'session.send',
  SESSION_CLOSE: 'session.close',
  TURN_ABORT: 'turn.abort',
  JOURNAL_REPLAY: 'journal.replay',

  // ---- subagents / ask (existing) -----------------------------------------
  SUBAGENTS_INTERRUPT: 'subagents.interrupt',
  SUBAGENTS_STOP_CHILDREN: 'subagents.stopChildren',
  ASK_RESPONSE: 'ask.response',

  // ---- batch 1 additions ---------------------------------------------------
  /** Inject a message into the CURRENT running turn (independent of session.send). */
  AGENT_STEER: 'agent.steer',
  /** Steer one child subagent through ctx.subagents.sendMessage(delivery:'steer'). */
  SUBAGENTS_STEER: 'subagents.steer',
  /** Session-scoped model selection (also persists the deployment default). */
  SESSION_SELECT_MODEL: 'session.selectModel',
  /** Full-text session search; projects host rows to { id, snippet }. */
  SESSION_SEARCH: 'session.search',
  CREDENTIALS_SET: 'credentials.set',
  CREDENTIALS_UNSET: 'credentials.unset',
  CREDENTIALS_DESCRIBE: 'credentials.describe',
} as const

export type WireId = (typeof WIRE)[keyof typeof WIRE]

/** Every wire id the bridge can dispatch. Used for the explicit unknown-wire error. */
export const ALL_WIRE_IDS: readonly WireId[] = Object.values(WIRE)

const WIRE_ID_SET: ReadonlySet<string> = new Set(ALL_WIRE_IDS)

/** Whether a string is a known wire id (not, by itself, a claim it is dispatched). */
export function isWireId(value: unknown): value is WireId {
  return typeof value === 'string' && WIRE_ID_SET.has(value)
}
