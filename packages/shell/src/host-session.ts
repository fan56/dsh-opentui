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
import {
  createStreamTicker,
  emptyTurnStats,
  estimateTokens,
  tokensPerSecond,
  type TurnCallbacks,
  type TurnStats,
} from "./agent/loop.ts"

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
  /** Telemetry of the last completed turn: duration, streamed chars and
   * tokens-per-second (real completion tokens when usage was reported,
   * chars/4 estimate otherwise — see `estimated`). */
  lastTurnStats: TurnStats = emptyTurnStats()
  #turns = 0
  #ticker = createStreamTicker((t) => this.#cb?.onStreamTick?.(t))
  #turnStartedAt = 0
  #turnUsageStart = { prompt: 0, completion: 0 }

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

  /** Compact /usage lines: cumulative token totals plus the last turn's
   * throughput, e.g. ["turns 3", "prompt 1.2k tok", "completion 4.5k tok",
   * "last turn 18.2s · 31 tok/s (estimated)"]. Pure — reads only usage,
   * #turns and lastTurnStats. */
  usageSummary(): string[] {
    const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)
    const lines = [
      `turns ${this.#turns}`,
      `prompt ${fmt(this.usage.prompt)} tok`,
      `completion ${fmt(this.usage.completion)} tok`,
    ]
    const s = this.lastTurnStats
    if (s.ms > 0) {
      const rate = s.tps === null ? "" : ` · ${Math.round(s.tps)} tok/s${s.estimated ? " (estimated)" : ""}`
      lines.push(`last turn ${(s.ms / 1000).toFixed(1)}s${rate}`)
    }
    return lines
  }

  async turn(userText: string, cb: TurnCallbacks, _signal?: AbortSignal): Promise<void> {
    this.#cb = cb
    // Fresh telemetry window for this turn (ticks reset, timing restarts,
    // usage delta baseline taken in case usage is cumulative over the session)
    this.#turns++
    this.#ticker.reset()
    this.#turnStartedAt = Date.now()
    this.#turnUsageStart = { prompt: this.usage.prompt, completion: this.usage.completion }
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
      // /attach stashed image refs ride along with the next prompt (the
      // host stores bytes; messages only ever carry the persistent ref).
      content: [
        { type: "text", text: userText },
        ...this.#pendingImages.map((ref) => ({ type: "image", attachment: ref })),
      ],
      source: { kind: "user" },
    })
    this.#pendingImages = []
    this.#handle.agent.followup(message)
    await new Promise<void>((resolve) => {
      this.#resolveTurn = resolve
    })
  }

  /** Image refs staged by /attach, sent with the next prompt. */
  #pendingImages: any[] = []

  /** Stage a local image file for the next message via the host attachment
   * store (bytes land in $DSH_HOME/attachments/v1; the message later only
   * carries the sha256 ref). Returns a short description for the echo. */
  async attachImage(path: string): Promise<string> {
    const store = (this.#ctx as any).get?.("attachments")
    if (!store?.saveImages) throw new Error("attachment service unavailable in this host")
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase()
    const mediaType: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" }
    if (!mediaType[ext]) throw new Error(`unsupported image type .${ext} (png/jpg/webp/gif)`)
    const data = await (await import("node:fs/promises")).readFile(path)
    const [ref] = await store.saveImages([{ data: new Uint8Array(data), mediaType: mediaType[ext], name: path.split("/").pop() }])
    this.#pendingImages.push(ref)
    return `${ref.name ?? path} (${(ref.bytes / 1024).toFixed(0)} KB)`
  }

  /** Steer the RUNNING agent with a mid-turn message (Kimi-style inject). */
  steer(userText: string): void {
    if (!this.#handle) return
    const message = createUserMessage({
      content: [{ type: "text", text: userText }],
      source: { kind: "user" },
    })
    this.#handle.agent.steer?.(message)
  }

  #finishTurn() {
    DBG("finishTurn")
    const endedAt = Date.now()
    // One final tick (unthrottled) so the closing rate is accurate, then
    // freeze this turn's stats BEFORE onTurnEnd so UI handlers can read them.
    this.#ticker.finish()
    const chars = this.#ticker.chars()
    const ms = Math.max(0, endedAt - this.#turnStartedAt)
    const completion = this.usage.completion - this.#turnUsageStart.completion
    const real = completion > 0
    const tokens = real ? completion : estimateTokens(chars)
    this.lastTurnStats = {
      startedAt: this.#turnStartedAt,
      endedAt,
      ms,
      chars,
      tokens,
      tps: tokensPerSecond(tokens, ms),
      estimated: !real,
    }
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
        if (c.type === "reasoning-delta" && c.text) {
          cb.onThinkingDelta(c.text)
          this.#ticker.add(c.text.length)
        } else if (c.type === "text-delta" && c.text) {
          cb.onContentDelta(c.text)
          this.#ticker.add(c.text.length)
        } else if (c.type === "tool-call-delta" && c.name) {
          // name arrives with the first delta; the rendered tool block comes
          // from the durable tool/call + tool/result events below
          // (argumentsDelta is tool plumbing, not streamed content — not counted)
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
          const callId = String(event.data.callId ?? "")
          const name = String(event.data.name ?? "tool")
          const args = String(event.data.arguments ?? "")
          this.#toolCalls.set(callId, { name, args })
          // The real "tool started" signal — fires for auto-allowed calls too,
          // which never hit the approval waterfall.
          cb.onToolStart?.({ callId, name, args })
        } else if (event.type === "todo/write") {
          // host todo tool: whole-list snapshot, cleared at turn start
          cb.onTodos?.((event.data?.todos ?? []) as { content: string; status: "pending" | "in_progress" | "completed" }[])
        } else if (event.type === "tool-workflow/agent-start" && event.data) {
          cb.onAgentEvent?.({
            key: `${event.data.runId}:${event.data.seq}`,
            status: "running",
            label: String(event.data.label ?? "subagent"),
          })
        } else if (event.type === "tool-workflow/agent-end" && event.data) {
          const outcome = event.data.outcome === "failed" || event.data.outcome === "cancelled" ? event.data.outcome : "completed"
          cb.onAgentEvent?.({ key: `${event.data.runId}:${event.data.seq}`, status: outcome })
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
            ...(callId ? { callId } : {}),
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
