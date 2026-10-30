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
import { appendFileSync, readFileSync } from "node:fs"
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

/** Concatenated text of the text blocks in a message content array. */
function blocksText(content: unknown): string {
  if (!Array.isArray(content)) return ""
  let text = ""
  for (const block of content) {
    const typed = block as { type?: unknown; text?: unknown } | null
    if (typed?.type === "text" && typeof typed.text === "string") {
      text += (text === "" ? "" : "\n") + typed.text
    }
  }
  return text.trim()
}

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
    // Cold-boot label: show the configured route on the very first frame
    // (the powerline's model segment would otherwise sit empty until the
    // first turn resolves the live session).
    try {
      const sel = (ctx as any).get?.("agentDefaultModel")?.currentSelection?.()
      if (sel?.provider && sel?.model) this.label = `${sel.provider}/${sel.model}${sel.reasoningEffort ? ` (${sel.reasoningEffort})` : ""}`
    } catch {
      /* optional service; keep the generic label */
    }
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
    // a pending resume must not survive /new — creating with the STORED id
    // again fails with "session already exists"
    this.#resumeId = undefined
  }

  /** Resume a historical session on the next turn (best-effort: the host
   * re-attaches by session id; whether history replays into the new agent
   * depends on the persistence layer). */
  resumeSession(id: string): void {
    this.newSession()
    this.#resumeId = id
  }

  /** Rebuild transcript rows from a STORED session's persisted log (the
   * /sessions resume path — the context comes back with the agent, and the
   * transcript rows come from here). Drain pattern per tui-pi's
   * readPersistedSession: open(id,'read') + offset loop. */
  async storedTranscript(id: string): Promise<{ kind: "user" | "assistant"; text: string }[]> {
    const persistence = (this.#ctx as any).get?.("sessionPersistence")
    if (!persistence?.open) return []
    const handle = await persistence.open(id, "read")
    try {
      const events: any[] = []
      let offset = 0
      for (;;) {
        const batch = await handle.read(offset)
        if (!batch?.events?.length) break
        events.push(...batch.events)
        offset += batch.events.length
      }
      const items: { kind: "user" | "assistant"; text: string }[] = []
      for (const event of events) {
        if (event.type === "user/message") {
          const kind = (event.data as any)?.source?.kind
          if (kind !== undefined && kind !== "user") continue
          const text = blocksText((event.data as any)?.content)
          if (text) items.push({ kind: "user", text })
        } else if (event.type === "assistant/message") {
          const text = blocksText((event.data as any)?.message?.content)
          if (text) items.push({ kind: "assistant", text })
        }
      }
      return items
    } finally {
      await handle.close?.()
    }
  }

  /** Stored sessions for the current workspace (newest first, capped). */
  async listSessions(limit = 12): Promise<{ id: string; title: string; updatedAt?: string }[]> {
    const persistence = (this.#ctx as any).get?.("sessionPersistence")
    if (!persistence?.list) return []
    try {
      const headers = (await persistence.list()) as any[]
      const out: { id: string; title: string; updatedAt?: string }[] = []
      for (const entry of headers) {
        // dsh 0.1.5 wraps each entry as {header, ...}; older builds are bare
        const h = entry?.header ?? entry
        // subagent children are not user-resumable (value-test delegationDepth:
        // the jsonl backend materializes it as 0 on every header)
        if (h?.origin === "subagent" || (h?.delegationDepth ?? 0) > 0) continue
        const id = String(h?.id ?? "")
        if (!id) continue
        out.push({
          id,
          title: String(h?.title ?? h?.firstPrompt ?? h?.name ?? "").slice(0, 40),
          updatedAt: String(h?.updatedAt ?? h?.lastEventAt ?? h?.mtime ?? ""),
        })
      }
      return out
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

  /** Host command registry: the packages' own slash commands (plan,
   * compact, feedback, export, …) — listed for the palette, executed on
   * submit. TUI-owned commands never reach here. */
  async listHostCommands(): Promise<{ name: string; description: string }[]> {
    try {
      const cmds = (this.#ctx as any).get?.("commands")
      if (!cmds?.list) return []
      // agent-scoped list when a session exists; the registry also lists
      // without one (boot-time palette)
      const list = (this.#handle?.agent ? await cmds.list(this.#handle.agent) : await cmds.list?.()) as any[]
      return (Array.isArray(list) ? list : [])
        .map((c) => ({ name: String(c?.name ?? ""), description: String(c?.description ?? "") }))
        .filter((c) => c.name)
    } catch {
      return []
    }
  }

  async executeHostCommand(line: string): Promise<{ text?: string } | undefined> {
    try {
      const cmds = (this.#ctx as any).get?.("commands")
      const agent = this.#handle?.agent
      if (!cmds?.execute || !agent) return { text: "host command service unavailable" }
      const result = (await cmds.execute(agent, line, new AbortController().signal)) as any
      const text = result?.message ?? result?.text ?? result?.output
      return text ? { text: String(text).slice(0, 300) } : {}
    } catch (e) {
      return { text: String(e instanceof Error ? e.message : e).slice(0, 300) }
    }
  }

  /** Selected agent preset (agentPresets registry id) — applied when the
   * next session is created. */
  #presetId?: string

  /** Preset roster from the agentPresets registry. */
  async listPresets(): Promise<{ id: string; name: string }[]> {
    try {
      const registry = (this.#ctx as any).get?.("agentPresets")
      if (!registry?.remoteExportList) return []
      const roster = await registry.remoteExportList()
      const list = Array.isArray(roster) ? roster : (roster?.entries ?? roster?.presets ?? [])
      return (Array.isArray(list) ? list : [])
        .map((e: any) => ({ id: String(e?.id ?? ""), name: String(e?.name ?? e?.id ?? "") }))
        .filter((e: any) => e.id)
    } catch {
      return []
    }
  }

  /** Switch preset: the next session is created seeded with agentPreset. */
  switchPreset(presetId: string): void {
    this.#presetId = presetId
    this.newSession()
  }

  currentPresetId(): string | undefined {
    return this.#presetId
  }

  /** The host settings service seam (login/logout route registration). */
  get settingsSeam(): { describe(): Promise<any>; mutate(ns: string, ops: unknown[], revision?: number): Promise<void> } | undefined {
    const st = (this.#ctx as any).get?.("settings")
    return st ? { describe: () => st.describe(), mutate: (ns: string, ops: unknown[], rev?: number) => st.mutate(ns, ops, rev) } : undefined
  }

  /** Full-text session search via the host sessionQuery FTS index. */
  async searchSessions(query: string): Promise<{ id: string; snippet: string }[]> {
    try {
      const q = (this.#ctx as any).get?.("sessionQuery")
      if (!q?.searchSessions) return []
      const res = await q.searchSessions({ query, limit: 10 })
      return ((res?.items ?? []) as any[]).map((it) => ({
        id: String(it?.header?.id ?? ""),
        snippet: String(it?.bestMatch?.snippet ?? "").replace(/\s+/g, " ").slice(0, 80),
      })).filter((it) => it.id)
    } catch {
      return []
    }
  }

  /** User-installed plugins (profile package.json deps, versions from
   * the installed copies) — dsh built-ins (@deepseek-ai/*) excluded. */
  listPlugins(): { name: string; version: string }[] {
    try {
      const root = new URL("../../../../package.json", import.meta.url).pathname
      const pkg = JSON.parse(readFileSync(root, "utf8"))
      const out: { name: string; version: string }[] = []
      for (const [name, range] of Object.entries((pkg.dependencies ?? {}) as Record<string, string>)) {
        if (name.startsWith("@deepseek-ai/")) continue
        let version = range
        try {
          version = JSON.parse(readFileSync(new URL(`../../../../node_modules/${name}/package.json`, import.meta.url).pathname, "utf8")).version
        } catch {
          /* keep the range as the label */
        }
        out.push({ name, version })
      }
      return out
    } catch {
      return []
    }
  }

  /** Tool-execution mode for the powerline brand segment: "ptc" when a
   * codemode/ptc plugin is mounted, "native" otherwise. */
  executionMode(): "native" | "ptc" {
    return this.listPlugins().some((p) => /ptc|codemode/i.test(p.name)) ? "ptc" : "native"
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
      const agentOptions = this.#modelSelection() ?? {}
      this.#handle = await (this.#ctx as any).agents.create({
        sessionId: this.#sessionId,
        meta: { cwd: process.cwd(), ...(this.#presetId ? { agentPreset: this.#presetId } : {}) },
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

  // ---- subagent panel state ----
  /** Live view per adopted child session (tui-pi AgentView, minimal). */
  #children = new Map<
    string,
    { label: string; model?: string; status: "running" | "completed" | "failed" | "cancelled"; rounds: number; tokens?: number; startedAt: number; lastLine?: string }
  >()
  /** tool-workflow/agent-start ↔ agent-end pairing (runId:seq → child). */
  #runSeqToChild = new Map<string, string>()
  /** Per-child transcript log (viewer) and the live child agent for steer. */
  #childLogs = new Map<string, string[]>()
  #childAgents = new Map<string, any>()

  /** Child transcript lines (viewer; capped buffer, oldest dropped). */
  childTranscript(id: string): string[] {
    return [...(this.#childLogs.get(id) ?? [])]
  }

  /** Steer a RUNNING child session (its live agent captured from the
   * firehose session object). False when the child is settled or its
   * agent is not reachable in this process. */
  steerChild(id: string, text: string): boolean {
    const agent = this.#childAgents.get(id)
    if (!agent?.steer) return false
    try {
      agent.steer(createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }))
      return true
    } catch {
      return false
    }
  }

  /** Adopt a child session by its header (any firehose event carries it). */
  #adoptChild(session: any, sessionKey: string): boolean {
    if (this.#children.has(sessionKey)) return false
    const header = session?.header
    if (!header || String(header.parentSession) !== this.#sessionId) return false
    // value tests, not existence: jsonl backends materialize delegationDepth: 0
    if (header.origin !== "subagent" && (header.delegationDepth ?? 0) <= 0) return false
    this.#children.set(sessionKey, {
      label: `subagent ${sessionKey.slice(0, 8)}`,
      status: "running",
      rounds: 0,
      startedAt: Date.now(),
    })
    // capture the live child agent for the viewer's steer path
    const agent = (session as any)?.agent
    if (agent) this.#childAgents.set(sessionKey, agent)
    return true
  }

  /** Register a child from the parent's tool-workflow/agent-start row. */
  #registerChild(childId: string, label: string): void {
    if (!childId) return
    const existing = this.#children.get(childId)
    if (existing) {
      if (label && label !== existing.label) this.#children.set(childId, { ...existing, label })
    } else {
      this.#children.set(childId, { label: label || `subagent ${childId.slice(0, 8)}`, status: "running", rounds: 0, startedAt: Date.now() })
    }
    this.#emitChildren()
  }

  #settleChild(childId: string, outcome: "completed" | "failed" | "cancelled"): void {
    const existing = this.#children.get(childId)
    if (existing && existing.status === "running") {
      this.#children.set(childId, { ...existing, status: outcome })
      this.#emitChildren()
    }
  }

  /** Fold one event from a (possibly adopted) child session into its view. */
  #foldChildEvent(session: any, sessionKey: string, event: SessionEvent): void {
    let changed = this.#adoptChild(session, sessionKey)
    const view = this.#children.get(sessionKey)
    if (!view) return
    const d = event.data ?? {}
    if (event.type === "subagent/descriptor") {
      const label = typeof d.label === "string" && d.label ? d.label : undefined
      const model = [d.agentProvider, d.agentModel].filter(Boolean).join("/") || (typeof d.provider === "string" ? String(d.provider) : undefined)
      const next = { ...view, ...(label ? { label } : {}), ...(model ? { model } : {}) }
      this.#children.set(sessionKey, next)
      changed = true
    } else if (event.type === "request/header") {
      const cfg = d.header?.config ?? d.config
      const model = cfg && (cfg.provider || cfg.model) ? `${cfg.provider ?? ""}/${cfg.model ?? ""}`.replace(/^\//, "") : undefined
      if (model) {
        this.#children.set(sessionKey, { ...view, model })
        changed = true
      }
    } else if (event.type === "assistant/message") {
      // rounds are assistant/message-counted (one-shot children never turn/end)
      const text = blocksText(d.message?.content ?? d.content)
      const usage = d.usage?.totalTokens ?? d.message?.usage?.totalTokens ?? d.message?.usage?.total_tokens
      this.#children.set(sessionKey, {
        ...view,
        rounds: view.rounds + 1,
        ...(usage ? { tokens: (view.tokens ?? 0) + Number(usage) } : {}),
        ...(text ? { lastLine: text.split("\n").pop()?.slice(0, 80) } : {}),
      })
      changed = true
    }
    // viewer log: assistant text, tool call/result lines (capped)
    const log = this.#childLogs.get(sessionKey) ?? []
    if (event.type === "assistant/message") {
      const text = blocksText(d.message?.content ?? d.content)
      for (const line of text.split("\n")) if (line.trim()) log.push(line.slice(0, 110))
    } else if (event.type === "tool/call") {
      log.push(`▶ ${d.name ?? "tool"} ${String(d.arguments ?? "").slice(0, 90)}`)
    } else if (event.type === "tool/result") {
      log.push("  ⎿ done")
    }
    while (log.length > 200) log.shift()
    if (log.length > 0) this.#childLogs.set(sessionKey, log)
    if (changed) this.#emitChildren()
  }

  /** Snapshot the child views to the UI (elapsed computed at read time). */
  #emitChildren(): void {
    const cb = this.#cb
    if (!cb?.onSubagentUpdate) return
    cb.onSubagentUpdate(
      [...this.#children.entries()].map(([id, v]) => ({
        id,
        label: v.label,
        ...(v.model ? { model: v.model } : {}),
        status: v.status,
        rounds: v.rounds,
        ...(v.tokens !== undefined ? { tokens: v.tokens } : {}),
        elapsed: Math.max(0, Math.floor((Date.now() - v.startedAt) / 1000)),
        ...(v.lastLine ? { lastLine: v.lastLine } : {}),
      })),
    )
  }

  // ---- /history: turn grouping + fork-at-turn ----
  /** Completed turns of the live session, oldest first, for the picker. */
  historyTurns(): { turn: number; seqEnd: number; preview: string }[] {
    const events = this.#snapshot()
    const turns: { turn: number; seqEnd: number; preview: string }[] = []
    let open: { turn: number; seqEnd: number; preview: string } | undefined
    for (const event of events) {
      if (event.type === "turn/start") {
        // an unclosed previous bracket is dropped (live turn mid-flight)
        open = { turn: Number((event.data as any)?.turn ?? turns.length), seqEnd: Number((event as any).seq ?? 0), preview: "" }
        continue
      }
      if (!open) continue
      if (event.type === "user/message") {
        // host-injected runtime-context snapshots are user/message events
        // without a user source — previews want the human's words only
        const kind = (event.data as any)?.source?.kind
        if (kind === undefined || kind === "user") {
          const text = blocksText((event.data as any)?.content)
          if (text && !open.preview) open.preview = text
        }
      } else if (event.type === "turn/end") {
        open.seqEnd = Number((event as any).seq ?? open.seqEnd)
        turns.push(open)
        open = undefined
      }
    }
    return turns
  }

  /** Raw event snapshot of the live session (soft-deprecated upstream, but
   * the only raw-replay path — same call tui-pi keeps for /history). */
  #snapshot(): any[] {
    const session = this.#handle?.agent?.session
    const snap = session?.snapshotEvents?.()
    return Array.isArray(snap) ? snap : []
  }

  /** Fork the live session at a completed turn boundary: seed a NEW session
   * with the parent's event prefix up to `seqEnd` (contiguous from seq 0),
   * replacing our handle. Returns the rebuilt transcript rows. The seed is
   * snapshotted at construction and never re-emitted as session/event, so
   * the caller rebuilds the transcript from the returned rows. */
  async forkAtTurn(seqEnd: number): Promise<{ items: { kind: "user" | "assistant"; text: string }[]; turn: number }> {
    const events = this.#snapshot()
    if (events.length === 0) throw new Error("no live session to fork")
    const seed = events.slice(0, seqEnd + 1)
    if (seed.length === 0) throw new Error("fork point before the first event")
    const parentSession = this.#sessionId
    const sel = this.#modelSelection()
    try {
      this.#handle?.dispose?.()
    } catch {
      /* already gone */
    }
    this.#handle = undefined
    this.#agentId = undefined
    this.#sessionId = randomUUID()
    this.#children.clear()
    this.#runSeqToChild.clear()
    this.#toolCalls.clear()
    this.#handle = await (this.#ctx as any).agents.create({
      sessionId: this.#sessionId,
      meta: { cwd: process.cwd(), ...(parentSession ? { parentSession, isSeeded: true } : {}) },
      ...(seed ? { seed, inheritedEventCount: seed.length } : {}),
      ...(sel ? { agentOptions: sel } : {}),
    })
    this.#agentId = this.#handle.agent.id
    const items: { kind: "user" | "assistant"; text: string }[] = []
    for (const event of seed) {
      if (event.type === "user/message") {
        const kind = (event.data as any)?.source?.kind
        if (kind !== undefined && kind !== "user") continue
        const text = blocksText((event.data as any)?.content)
        if (text) items.push({ kind: "user", text })
      } else if (event.type === "assistant/message") {
        const text = blocksText((event.data as any)?.message?.content)
        if (text) items.push({ kind: "assistant", text })
      }
    }
    return { items, turn: seed.length }
  }

  /** The model route for a (re)creation: explicit override wins over the
   * composed agent-default-model selection. */
  #modelSelection(): Record<string, unknown> | undefined {
    const sel = this.#override ?? (this.#ctx as any).get?.("agentDefaultModel")?.currentSelection?.()
    if (!sel) return undefined
    if (this.#handle === undefined) this.label = `${sel.provider}/${sel.model}${sel.reasoningEffort ? ` (${sel.reasoningEffort})` : ""}`
    return { provider: sel.provider, model: sel.model, ...(sel.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {}) }
  }

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

  /** Abort the running turn: dispose the live agent and settle the turn
   * promise (the stop-confirm flow calls this; /new semantics for the
   * next send — a fresh session is created). */
  abort(): void {
    try {
      this.#handle?.dispose?.()
    } catch {
      /* already gone */
    }
    this.#handle = undefined
    this.#agentId = undefined
    this.#resolveTurn?.()
    this.#resolveTurn = undefined
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
      if (process.env.DSH_OPENTUI_DEBUG) {
        try { appendFileSync("/tmp/otui-stream.log", `${Date.now()} ${c.type} ${(c.text ?? "").length}ch\n`) } catch {}
      }
      try {
        if (c.type === "reasoning-delta" && c.text) {
          cb.onThinkingDelta(c.text)
          this.#ticker.add(c.text.length)
        } else if (c.type === "text-delta" && c.text) {
          cb.onContentDelta(c.text)
          this.#ticker.add(c.text.length)
        } else if (c.type === "usage") {
          // usage frame: prompt = the request's context size (assignment —
          // the 🧠 segment reads latest, not additive); completion adds up
          // over the session. Field names vary by adapter — numeric scan.
          let p = 0
          let comp = 0
          for (const [k, v] of Object.entries(c as Record<string, unknown>)) {
            if (typeof v !== "number") continue
            if (/prompt/i.test(k)) p = Math.max(p, v)
            if (/completion/i.test(k)) comp = Math.max(comp, v)
          }
          if (p > 0) this.usage.prompt = p
          if (comp > 0) this.usage.completion += comp
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

    ctx.on("session/event", (session: any, event: SessionEvent) => {
      if (process.env.DSH_OPENTUI_DEBUG && (event.type === "turn/end" || event.type === "turn/start")) {
        try { process.stderr.write(`[hs] session/event ${event.type} sessionMatch=${String(session.id) === this.#sessionId} my=${this.#sessionId}\n`) } catch {}
      }
      const sessionKey = String(session.id)
      if (this.#sessionId === undefined) return
      if (sessionKey !== this.#sessionId) {
        // Not ours: it may be a subagent child — adopt by header (the
        // firehose is not scope-filtered, children arrive here) and fold
        // their refinement events into the panel view.
        this.#foldChildEvent(session, sessionKey, event)
        return
      }
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
          // rich registration: the start row carries the child session id
          this.#registerChild(String(event.data.childId ?? ""), String(event.data.label ?? "subagent"))
          this.#runSeqToChild.set(`${event.data.runId}:${event.data.seq}`, String(event.data.childId ?? ""))
        } else if (event.type === "tool-workflow/agent-end" && event.data) {
          const childId = this.#runSeqToChild.get(`${event.data.runId}:${event.data.seq}`)
          const outcome = event.data.outcome === "failed" || event.data.outcome === "cancelled" ? event.data.outcome : "completed"
          if (childId) this.#settleChild(childId, outcome)
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
