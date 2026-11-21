/**
 * 025 wave2 W2-1 — inproc /btw side-session lifecycle (seam-side, A-2).
 *
 * Encapsulates the create -> prompt -> wait chain over the BRIDGE wire
 * (`session.create`/`session.prompt`/`session.wait`, dot names) with an owned
 * hard-stop timeout and an explicit error surface. The host side-session has
 * NO explicit destroy RPC (host GC, A-2 verified in .proof/025-w2-1/00-slice-ticket.md).
 *
 * Hierarchy discipline (plan §5.1 / ADR-0011):
 *  - This module owns ONLY a throwaway side-session id; it never touches the
 *    bridge seam's currentSessionId / SessionBinding (domain separation).
 *  - wait returns bounded assistant output (`reason/state/output.records`); the
 *    reply is projected to PLAIN TEXT ONLY — no host object, no extra key, no
 *    sensitive field crosses into the seam shape (E5 SENTINEL discipline).
 *  - No caller cancellation channel exists on a unary stdio frame; the host
 *    `timeoutMs` is the hard stop (prompt/wait carry cancel:'signal' and the
 *    bridge generic arm appends an owned, never-aborted AbortSignal).
 */
import { randomUUID } from "node:crypto"

/** Minimal unary RPC carrier (the BridgeTransport.request subset used here). */
export type SideSessionRpc = (method: string, params?: Record<string, unknown>) => Promise<unknown>

export interface SideSessionOptions {
  rpc: SideSessionRpc
  question: string
  /** Recent-conversation snapshot lines, reference-only prefix (remote-btw parity). */
  snapshot?: string[]
  /** Host wait hard stop; default 120s (host-session / remote-btw parity). */
  timeoutMs?: number
  /** Positive assistant-record cap passed to session.wait. */
  maxMessages?: number
  /** Bounded projected answer length; oversize sets truncated. */
  maxAnswerLength?: number
  /** Blank session identity override (test injection / reuse). Omitted => host blank. */
  sessionId?: string
  /** requestId factory (test injection). Omitted => crypto.randomUUID. */
  requestId?: () => string
  /** Terminal full-answer callback (unary wait emits once, no streaming channel). */
  onDelta?: (full: string) => void
}

export interface SideSessionResult {
  answer: string
  sessionId: string
  reason: string
  truncated: boolean
}

/** Precise, machine-greppable side-session failures (face maps these to degrade text). */
export class SideSessionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = "SideSessionError"
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

/** Classify an RPC rejection: absence/unsupported => explicit UNAVAILABLE, never a fake answer. */
function classify(err: unknown, stage: string): SideSessionError {
  const raw = err instanceof Error ? err.message : String(err)
  if (/NOT_WIRED|UNSUPPORTED|unavailable|no inproc host adapter/i.test(raw)) {
    return new SideSessionError("SIDE_SESSION_UNAVAILABLE", `/btw side-session ${stage} unavailable: ${raw.slice(0, 160)}`)
  }
  return new SideSessionError("SIDE_SESSION_FAILED", `/btw side-session ${stage} failed: ${raw.slice(0, 160)}`)
}

/**
 * Project a raw `session.wait` result into a bounded plain-text answer.
 * Reads ONLY assistant/message text blocks; every other key (including hostile
 * sensitive keys injected in a reply) is ignored, so none can reach the seam
 * shape. records are 'newest first' per the host contract -> reversed to
 * chronological before joining.
 */
export function projectWaitAnswer(value: unknown, maxLength = 4000): { answer: string; truncated: boolean } {
  const v = asRecord(value)
  const output = asRecord(v.output)
  const records = Array.isArray(output.records) ? output.records : []
  const texts: string[] = []
  for (const raw of [...records].reverse()) {
    const rec = asRecord(raw)
    const event = asRecord(rec.event)
    if (event.type !== "assistant/message") continue
    const data = asRecord(event.data)
    let text = ""
    if (typeof data.text === "string") {
      text = data.text.trim()
    } else {
      const blocks = Array.isArray(data.content) ? data.content : Array.isArray(data.parts) ? data.parts : []
      const parts: string[] = []
      for (const block of blocks) {
        const b = asRecord(block)
        if (b.type === "text" && typeof b.text === "string") parts.push(b.text)
      }
      text = parts.join("\n").trim()
    }
    if (text) texts.push(text)
  }
  let answer = texts.join("\n\n")
  let truncated = output.truncated === true
  if (answer.length > maxLength) {
    answer = answer.slice(0, maxLength)
    truncated = true
  }
  return { answer, truncated }
}

/**
 * One /btw side question over a throwaway inproc session.
 * create -> prompt(queue) -> wait(bounded). Failures REJECT with a precise code;
 * an empty/timeout wait resolves with answer='' (the caller paints the honest
 * degrade) — never a fabricated model answer.
 */
export async function runSideSession(options: SideSessionOptions): Promise<SideSessionResult> {
  const timeoutMs = options.timeoutMs ?? 120_000
  const rpc = options.rpc

  // 1. create a blank throwaway session (no workspace/cwd/preset leaking the
  //    main session). The host may return a different blank — its id wins.
  let created: Record<string, unknown>
  try {
    created = asRecord(await rpc("session.create", {
      request: options.sessionId !== undefined ? { sessionId: options.sessionId } : {},
    }))
  } catch (err) {
    throw classify(err, "create")
  }
  const sessionId = typeof created.sessionId === "string" ? created.sessionId : ""
  if (sessionId === "") {
    throw new SideSessionError("SIDE_SESSION_UNAVAILABLE", "/btw side-session create returned no sessionId")
  }

  // 2. prompt with the reference-only snapshot prefix (remote-btw parity).
  const requestId = options.requestId?.() ?? randomUUID()
  const snap = options.snapshot && options.snapshot.length > 0
    ? `Recent conversation context (for reference only):\n${options.snapshot.join("\n").slice(-1500)}\n\n`
    : ""
  try {
    const accepted = asRecord(await rpc("session.prompt", {
      request: {
        requestId,
        sessionId,
        mode: "queue",
        content: [{ type: "text", text: `${snap}Side question (answer in one or two sentences, do not use tools): ${options.question}` }],
      },
    }))
    if (accepted.accepted !== true) {
      throw new SideSessionError("SIDE_SESSION_PROMPT_REJECTED", "/btw side-session prompt was not accepted")
    }
  } catch (err) {
    if (err instanceof SideSessionError) throw err
    throw classify(err, "prompt")
  }

  // 3. wait for bounded assistant output (timeoutMs is the hard stop).
  let waited: Record<string, unknown>
  try {
    waited = asRecord(await rpc("session.wait", {
      request: {
        sessionId,
        timeoutMs,
        ...(options.maxMessages !== undefined ? { maxMessages: options.maxMessages } : {}),
      },
    }))
  } catch (err) {
    throw classify(err, "wait")
  }
  const { answer, truncated } = projectWaitAnswer(waited, options.maxAnswerLength)
  const reason = typeof waited.reason === "string" ? waited.reason : "idle"
  if (answer !== "" && options.onDelta !== undefined) {
    try {
      options.onDelta(answer)
    } catch {
      /* a view callback must never take the side call down */
    }
  }
  return { answer, sessionId, reason, truncated }
}
