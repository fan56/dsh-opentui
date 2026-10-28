/**
 * HostSession — drives conversations through the REAL dsh host services:
 * ctx.agents.create + agent.followup, agent/assistant-stream frames for
 * thinking/text deltas, session/event firehose for tool calls, and the
 * approval/request waterfall. Same turn() contract as the direct-LLM
 * AgentSession so the Shell renders either identically.
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm"
import type { Context } from "@deepseek-ai/cordis"
import { randomUUID } from "node:crypto"
import type { TurnCallbacks } from "./agent/loop.ts"

/** Minimal structural types — the real ones live in the host closure. */
type StreamFrame = {
  type: "start" | "chunk" | "end"
  chunk?: { type: string; text?: string; argumentsDelta?: string; name?: string }
}
type SessionEvent = { type: string; data?: any }

export class HostSession {
  label = "dsh-host"
  readonly #ctx: Context
  #handle: any
  #sessionId?: string
  #agentId?: string
  #cb?: TurnCallbacks
  #resolveTurn?: () => void
  #running = false
  #toolCalls = new Map<string, { name: string; args: string }>()
  usage = { prompt: 0, completion: 0 }

  constructor(ctx: Context) {
    this.#ctx = ctx
    this.#wire()
  }

  async turn(userText: string, cb: TurnCallbacks, _signal?: AbortSignal): Promise<void> {
    this.#cb = cb
    if (!this.#handle) {
      this.#sessionId = randomUUID()
      // the host does NOT auto-apply a default model — seed from the
      // composed agent-default-model selection (ctx.get needs no inject)
      const sel = (this.#ctx as any).get?.("agentDefaultModel")?.currentSelection?.()
      const agentOptions = sel
        ? { provider: sel.provider, model: sel.model, ...(sel.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {}) }
        : {}
      if (sel) this.label = `${sel.provider}/${sel.model}`
      this.#handle = await (this.#ctx as any).agents.create({
        sessionId: this.#sessionId,
        meta: { cwd: process.cwd() },
        agentOptions,
      })
      this.#agentId = this.#handle.agent.id
    }
    const message = createUserMessage({
      content: [{ type: "text", text: userText }],
      source: { kind: "user" },
    })
    this.#handle.agent.followup(message)
    await new Promise<void>((resolve) => {
      this.#resolveTurn = resolve
    })
  }

  #finishTurn() {
    const r = this.#resolveTurn
    this.#resolveTurn = undefined
    this.#cb?.onTurnEnd({ prompt: this.usage.prompt, completion: this.usage.completion })
    r?.()
  }

  #wire() {
    const ctx = this.#ctx as any

    ctx.on("agent/assistant-stream", ({ agent, frame }: { agent: { id: string }; frame: StreamFrame }) => {
      if (this.#agentId === undefined || agent.id !== this.#agentId) return
      const cb = this.#cb
      if (!cb || frame.type !== "chunk" || !frame.chunk) return
      const c = frame.chunk
      try {
        if (c.type === "reasoning-delta" && c.text) cb.onThinkingDelta(c.text)
        else if (c.type === "text-delta" && c.text) cb.onContentDelta(c.text)
        else if (c.type === "tool-call-delta" && c.name) {
          // name arrives with the first delta; the rendered tool block comes
          // from the durable tool/call + tool/result events below
        }
      } catch {
        /* a UI callback must never take the host listener down */
      }
    })

    ctx.on("agent/status", ({ agent, status }: { agent: { id: string }; status: string }) => {
      if (this.#agentId === undefined || agent.id !== this.#agentId) return
      const wasRunning = this.#running
      this.#running = status === "running"
      if (wasRunning && !this.#running && this.#resolveTurn) this.#finishTurn()
    })

    ctx.on("session/event", (session: { id: string | { toString(): string } }, event: SessionEvent) => {
      if (this.#sessionId === undefined || String(session.id) !== this.#sessionId) return
      const cb = this.#cb
      if (!cb) return
      try {
        if (event.type === "tool/call" && event.data) {
          this.#toolCalls.set(String(event.data.callId ?? ""), {
            name: String(event.data.name ?? "tool"),
            args: String(event.data.arguments ?? ""),
          })
        } else if (event.type === "tool/result" && event.data) {
          const callId = String(event.data.callId ?? "")
          const known = this.#toolCalls.get(callId)
          const brief = JSON.stringify(event.data.output ?? event.data).slice(0, 300)
          cb.onToolRun({
            name: known?.name ?? "tool",
            argsPretty: known?.args ?? "",
            output: brief,
            ok: event.data.isError !== true,
          })
        } else if (event.type === "turn/end") {
          const reason = event.data?.reason
          if (reason?.kind === "error") {
            cb.onError(String(reason.error?.message ?? reason.error ?? "turn error").slice(0, 300))
          }
          if (this.#resolveTurn) this.#finishTurn()
        }
      } catch {
        /* ignore malformed events */
      }
    })

    // Approval waterfall: claim only our session's requests.
    ctx.on(
      "approval/request",
      async (request: any, next: () => Promise<string>) => {
        if (this.#sessionId === undefined || String(request?.agent?.session?.id) !== this.#sessionId) return next()
        const cb = this.#cb
        if (!cb) return "unavailable"
        let args: Record<string, unknown> = {}
        try {
          const raw = this.#lookupCallArgs(request) ?? ""
          if (raw) args = JSON.parse(raw)
        } catch {
          /* show whatever we have */
        }
        const ok = await cb.onApprove(String(request.toolName ?? "tool"), args)
        return ok ? "allowed-once" : "rejected"
      },
    )
  }

  /** Walk the session log backwards for the matching tool/call arguments. */
  #lookupCallArgs(request: any): string | undefined {
    if (!request?.callId) return undefined
    const session = request.agent?.session
    if (typeof session?.eventAt !== "function") return undefined
    for (let seq = (session.seq ?? 0) - 1; seq >= 0; seq--) {
      const event = session.eventAt(seq) as SessionEvent | undefined
      if (event?.type === "tool/call" && String(event.data?.callId ?? "") === String(request.callId)) {
        return event.data?.arguments
      }
    }
    return undefined
  }
}
