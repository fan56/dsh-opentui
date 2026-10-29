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

const DBG = (_m: string) => {} // stderr mid-render corrupts the frame stream; keep a no-op hook

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
  #override?: { provider: string; model: string; reasoningEffort?: string }
  #resumeId?: string
  usage = { prompt: 0, completion: 0 }

  constructor(ctx: Context) {
    this.#ctx = ctx
    this.#wire()
  }

  /** Provider catalog as the host sees it (llm service), best-effort.
   * Cached: the host list is static between route commits. */
  #providerCache: { provider: string; models: string[] }[] | null = null

  async listProviders(): Promise<{ provider: string; models: string[] }[]> {
    if (this.#providerCache) return this.#providerCache
    try {
      const llm = (this.#ctx as any).get?.("llm")
      if (!llm?.listConfigurableProviders) return (this.#providerCache = [])
      const configurable = (await llm.listConfigurableProviders()) as any[]
      const out: { provider: string; models: string[] }[] = []
      for (const p of configurable) {
        const provider = String(p?.provider ?? "")
        if (!provider) continue
        let models: string[] = []
        try {
          const list = (await llm.listModels(provider)) as any[]
          models = list.map((m) => String(m?.id ?? m?.model ?? m ?? "")).filter(Boolean)
        } catch {
          /* provider without an adapter yet: show it model-less */
        }
        out.push({ provider, models })
      }
      return (this.#providerCache = out)
    } catch {
      return (this.#providerCache = [])
    }
  }

  /** Switch model for the NEXT session (the current one keeps its route). */
  switchModel(provider: string, model: string, reasoningEffort?: string): void {
    this.#override = { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) }
    // drop the live session so the next turn re-creates with the new route
    try {
      this.#handle?.dispose?.()
    } catch {
      /* already gone */
    }
    this.#handle = undefined
    this.#sessionId = undefined
    this.#agentId = undefined
    this.label = `${provider}/${model}${reasoningEffort ? ` (${reasoningEffort})` : ""}`
  }

  /** Start a FRESH session on the next turn (keeps the current model route). */
  newSession(): void {
    try {
      this.#handle?.dispose?.()
    } catch {
      /* already gone */
    }
    this.#handle = undefined
    this.#sessionId = undefined
    this.#agentId = undefined
  }

  /** Resume a historical session on the next turn (best-effort: the host
   * re-attaches by session id; whether history replays into the new agent
   * depends on the persistence layer). */
  resumeSession(id: string): void {
    this.newSession()
    this.#resumeId = id
  }

  /** Stored sessions for the current workspace (newest first, capped). */
  async listSessions(limit = 12): Promise<{ id: string; title: string; updatedAt?: string }[]> {
    const persistence = (this.#ctx as any).get?.("sessionPersistence")
    if (!persistence?.list) return []
    try {
      const headers = (await persistence.list()) as any[]
      return headers
        .map((h) => ({
          id: String(h?.id ?? ""),
          title: String(h?.title ?? h?.firstPrompt ?? h?.name ?? "").slice(0, 40),
          updatedAt: h?.updatedAt ?? h?.lastEventAt ?? h?.mtime,
        }))
        .filter((s) => s.id)
        .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
        .slice(0, limit)
    } catch {
      return []
    }
  }

  /**
   * Register the user-questions answerer: claims requests for our session
   * (or unowned ones when no session exists yet) and forwards them to the
   * UI callback. The UI answers {questionId, selected} pairs; declining
   * returns the tui-pi-style declined envelope (empty selected + marker).
   */
  registerAskProvider(onAsk: (q: { id: string; prompt: string; options: string[] }[]) => Promise<{ questionId: string; selected: string }[]>): void {
    ;(this.#ctx as any).on(
      "user-questions/request",
      async (request: any, next: () => Promise<any>) => {
        const asking = request?.agent?.session?.id
        if (this.#sessionId !== undefined && asking !== undefined && String(asking) !== this.#sessionId) return next()
        const questions = (request?.questions ?? []) as any[]
        if (!questions.length) return next()
        const simplified = questions.map((q) => ({
          id: String(q?.id ?? ""),
          prompt: String(q?.prompt ?? q?.question ?? q?.header ?? ""),
          options: (q?.options ?? []).map((o: any) => String(o?.label ?? o?.value ?? o)),
        }))
        let picks: { questionId: string; selected: string }[]
        try {
          picks = await onAsk(simplified)
        } catch {
          return { answers: simplified.map((q) => ({ id: q.id, selected: [], custom: "declined" })) }
        }
        return {
          answers: simplified.map((q) => {
            const pick = picks.find((p) => p.questionId === q.id)
            return pick ? { id: q.id, selected: [pick.selected] } : { id: q.id, selected: [], custom: "declined" }
          }),
        }
      },
    )
  }

  // ---- credentials seam (/login, /logout) ----
  // ctx.get needs no inject; structural faces mirror tui-pi's login.ts seams.

  #credentials(): any | undefined {
    try {
      return (this.#ctx as any).get?.("credentials")
    } catch {
      return undefined
    }
  }

  async credentialStatus(ref: string): Promise<{ configured: boolean }> {
    const c = this.#credentials()
    if (c?.describe) return c.describe(ref)
    return { configured: false }
  }

  async login(ref: string, apiKey: string): Promise<void> {
    const c = this.#credentials()
    if (!c?.set) throw new Error("credentials service unavailable in this host")
    await c.set(ref, apiKey)
  }

  async logout(ref: string): Promise<void> {
    const c = this.#credentials()
    if (!c?.unset) throw new Error("credentials service unavailable in this host")
    await c.unset(ref)
  }

  async turn(userText: string, cb: TurnCallbacks, _signal?: AbortSignal): Promise<void> {
    this.#cb = cb
    if (!this.#handle) {
      // fresh session, or a one-shot resume of a picked historical one
      this.#sessionId = this.#resumeId ?? randomUUID()
      this.#resumeId = undefined
      // Model precedence: an explicit /model override wins over the composed
      // agent-default-model selection (the host does NOT auto-apply either).
      const sel = this.#override ?? (this.#ctx as any).get?.("agentDefaultModel")?.currentSelection?.()
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
      DBG(`session created ${this.#sessionId} agent=${this.#agentId}`)
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
    DBG("finishTurn")
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
      DBG(`agent/status ${status} wasRunning=${wasRunning} resolve=${!!this.#resolveTurn}`)
      if (wasRunning && !this.#running && this.#resolveTurn) this.#finishTurn()
    })

    ctx.on("session/event", (session: { id: string | { toString(): string } }, event: SessionEvent) => {
      if (process.env.DSH_OPENTUI_DEBUG && (event.type === "turn/end" || event.type === "turn/start")) {
        try { process.stderr.write(`[hs] session/event ${event.type} sessionMatch=${String(session.id) === this.#sessionId} my=${this.#sessionId}\n`) } catch {}
      }
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
          const callId = String(event.data.callId ?? event.data.message?.toolCallId ?? "")
          const known = this.#toolCalls.get(callId)
          const brief = JSON.stringify(event.data.output ?? event.data).slice(0, 300)
          // image content blocks render as pictures in the tool panel
          const content = (event.data.message?.content ?? event.data.content ?? []) as any[]
          const imageBlock = content.find?.((c: any) => c?.type === "image")
          // the host tool result carries the file path in a sibling <path>
          // text block; the image block itself only references an attachment id
          const pathMatch = /<path>([^<]+)<\/path>/.exec(
            content.find?.((c: any) => c?.type === "text")?.text ?? "",
          )
          const imagePath =
            (typeof imageBlock?.source === "string" ? imageBlock.source : undefined) ??
            imageBlock?.path ??
            imageBlock?.file_path ??
            imageBlock?.url ??
            (imageBlock ? pathMatch?.[1] : undefined)
          cb.onToolRun({
            name: known?.name ?? "tool",
            argsPretty: known?.args ?? "",
            output: brief,
            ok: event.data.isError !== true,
            ...(typeof imagePath === "string" ? { imagePath } : {}),
          })
        } else if (event.type === "turn/end") {
          DBG(`turn/end seen resolve=${!!this.#resolveTurn}`)
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
