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
import { join } from "node:path"
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import {
  createStreamTicker,
  emptyTurnStats,
  estimateTokens,
  tokensPerSecond,
  type TurnCallbacks,
  type TurnStats,
} from "./agent/loop.ts"
import {
  DEFAULT_SUBAGENT_ROUND_LIMITS,
  SubagentRoundPolicy,
  bareAgentLabel,
  limitsFromSettingsRows,
  type SubagentRoundLimits,
} from "./subagent-policy.ts"

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
  // ---- idle release (the takeover contract's lock half) ----
  // A held write handle blocks every other surface (the phone's /resume
  // degrades to a read-only watch against US). A TUI nobody is typing into
  // must not keep that lock: after `idleReleaseSec` without a turn the
  // handle is disposed (the kernel lease frees with it) and the next input
  // re-attaches the SAME session id, folding in whatever other surfaces
  // wrote meanwhile.
  #idleTimer?: ReturnType<typeof setTimeout>
  /** Durable event count when the handle was released — the wake diff base. */
  #releasedSeq = 0
  usage = { prompt: 0, completion: 0, cacheRead: 0, cacheWrite: 0 }

  // ---- journal feed (batch 10a, additive) ----
  // The session/event firehose for OUR session, forwarded as durable
  // records to the v2 seam adapter's projector (client/session-seam-adapter
  // twin: remote-host-session grew the same hook in batch 9a). One sink;
  // records fire even when no turn callbacks are registered.
  #journalSink?: (entry: { seq: number; type: string; data: Record<string, unknown> }) => void
  #journalSeq = 0

  /** Subscribe to our session's durable event records (user/message,
   * assistant/message, turn/end). Returns the disposer. */
  onJournalRecord(listener: (entry: { seq: number; type: string; data: Record<string, unknown> }) => void): () => void {
    this.#journalSink = listener
    return () => {
      if (this.#journalSink === listener) this.#journalSink = undefined
    }
  }

  /** Forward one of OUR session's durable records to the journal sink. */
  #emitJournal(event: SessionEvent): void {
    if (this.#journalSink === undefined) return
    if (event.type !== "user/message" && event.type !== "assistant/message" && event.type !== "turn/end") return
    this.#journalSink({ seq: ++this.#journalSeq, type: event.type, data: (event.data ?? {}) as Record<string, unknown> })
  }

  /** Cache hit rate in percent when the host reports cache traffic. */
  cacheHitRate(): number | null {
    const total = this.usage.cacheRead + this.usage.cacheWrite
    if (total <= 0) return null
    return (this.usage.cacheRead / total) * 100
  }

  /** One streamed delta landed — widen this turn's decode window (F4). */
  #noteDelta(): void {
    const now = Date.now()
    if (this.#firstDeltaAt === 0) this.#firstDeltaAt = now
    this.#lastDeltaAt = now
  }

  /** /session panel snapshot (batch F4): identity, usage, decode speeds.
   * messageCount is adapter-side (the facade has no transcript cache). */
  sessionInfo(): {
    sessionId: string | undefined
    model: string | undefined
    turnCount: number
    tokensIn: number
    tokensOut: number
    cacheRead: number
    cacheWrite: number
    lastTurnTps: number | null
    sessionAvgTps: number | null
  } {
    return {
      sessionId: this.currentSessionId(),
      model: this.label === "dsh-host" ? undefined : this.label,
      turnCount: this.#turns,
      tokensIn: this.usage.prompt,
      tokensOut: this.usage.completion,
      cacheRead: this.usage.cacheRead,
      cacheWrite: this.usage.cacheWrite,
      lastTurnTps:
        this.#lastDecode.ms > 0
          ? tokensPerSecond(this.#lastDecode.tokens, this.#lastDecode.ms)
          : this.lastTurnStats.tps,
      sessionAvgTps: tokensPerSecond(this.#decodeTotals.tokens, this.#decodeTotals.ms),
    }
  }
  /** Telemetry of the last completed turn: duration, streamed chars and
   * tokens-per-second (real completion tokens when usage was reported,
   * chars/4 estimate otherwise — see `estimated`). */
  lastTurnStats: TurnStats = emptyTurnStats()
  #turns = 0
  #ticker = createStreamTicker((t) => this.#cb?.onStreamTick?.(t))
  #turnStartedAt = 0
  #turnUsageStart = { prompt: 0, completion: 0 }
  // ---- decode-window timing (batch F4, /session panel) ----
  // First streamed delta → last delta (settle): the real decode window,
  // excluding the pre-first-token prompt latency the whole-turn TurnStats.ms
  // carries. Session totals feed the panel's average; unknown reads null.
  #firstDeltaAt = 0
  #lastDeltaAt = 0
  #decodeTotals = { tokens: 0, ms: 0 }
  #lastDecode = { tokens: 0, ms: 0 }

  constructor(ctx: Context) {
    this.#ctx = ctx
    this.#wire()
    this.#ensureRoundPolicy()
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
    this.#disarmIdleRelease()
    this.label = `${provider}/${model}${reasoningEffort ? ` (${reasoningEffort})` : ""}`
  }

  /** The live session id, when one exists (batch 10a, additive read: the
   * v2 seam adapter's sessionAttached/currentSessionId reads). */
  currentSessionId(): string | undefined {
    return this.#sessionId
  }

  /** The composed model route — explicit override wins over the
   * agentDefaultModel selection, the same precedence turn() applies, but
   * read-only (no label side effect). Batch 10a, additive: the v2 seam
   * adapter's /model picker label. */
  currentModelSelection(): { provider: string; model: string; reasoningEffort?: string } | undefined {
    const sel = this.#override ?? (this.#ctx as any).get?.("agentDefaultModel")?.currentSelection?.()
    if (!sel?.provider || !sel?.model) return undefined
    return { provider: sel.provider, model: sel.model, ...(sel.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {}) }
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
    this.#disarmIdleRelease()
    // a pending resume must not survive /new — creating with the STORED id
    // again fails with "session already exists"
    this.#resumeId = undefined
  }

  /** Resume a historical session on the next turn (best-effort: the host
   * re-attaches by session id; whether history replays into the new agent
   * depends on the persistence layer). */
  /** Resume a stored session; returns "owned" when a LIVE other-process
   * session blocks the takeover (single-writer guard) — the caller can
   * then fall back to startRemoteTail for a read-only view. */
  resumeSession(id: string): "ok" | "owned" {
    this.newSession()
    this.#resumeId = id
    return "ok"
  }

  /** Rebuild transcript rows from a STORED session's persisted log (the
   * /sessions resume path — the context comes back with the agent, and the
   * transcript rows come from here). `skip` drops the first N durable
   * events (the idle-release wake diff: rows painted before the release).
   * Drain pattern per tui-pi's readPersistedSession: open(id,'read') +
   * offset loop. */
  async storedTranscript(id: string, skip = 0): Promise<{ kind: "user" | "assistant"; text: string }[]> {
    // Cold boot has no session (currentSessionId() undefined → the v2 page's
    // projection.load() passes ""), and persistence.open("") rejects with
    // `session "" not found`. The view's hydration loader only clears when
    // load() RESOLVES (its catch swallows rejections by design), so an empty
    // id must resolve [] — no session yet, no stored history — not reject.
    if (!id) return []
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
      for (const event of skip > 0 ? events.slice(skip) : events) {
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
      const cfg = this.configLoad()
      const retentionDays = Number(cfg.retentionDays ?? 0)
      const cutoff = retentionDays > 0 ? Date.now() - retentionDays * 86400000 : 0
      const out: { id: string; title: string; updatedAt?: string }[] = []
      for (const entry of headers) {
        // dsh 0.1.5 wraps each entry as {header, ...}; older builds are bare
        const h = entry?.header ?? entry
        // subagent children are not user-resumable (value-test delegationDepth:
        // the jsonl backend materializes it as 0 on every header)
        if (h?.origin === "subagent" || (h?.delegationDepth ?? 0) > 0) continue
        const id = String(h?.id ?? "")
        if (!id) continue
        const updatedAt = String(h?.updatedAt ?? h?.lastEventAt ?? h?.mtime ?? "")
        if (cutoff > 0 && updatedAt && new Date(updatedAt).getTime() < cutoff) continue
        out.push({
          id,
          title: String(h?.title ?? h?.firstPrompt ?? h?.name ?? "").slice(0, 40),
          updatedAt,
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

  /** Path of the profile-root keybindings.json (sibling of config.json). */
  keybindingsLoad(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(this.configPath("keybindings.json"), "utf8"))
    } catch {
      return {}
    }
  }

  /** /btw side question: a one-shot agent on a SEPARATE session answers
   * over a snapshot prompt — the main session never sees it. Resolves with
   * the full answer text when the side turn ends. */
  async btwAsk(question: string, snapshot: string[], onDelta?: (full: string) => void): Promise<string> {
    const sessionId = randomUUID()
    const handle = await (this.#ctx as any).agents.create({
      sessionId,
      meta: { cwd: process.cwd() },
      agentOptions: this.#modelSelection() ?? undefined,
    })
    const agentId = handle.agent.id
    let out = ""
    const ctxAny = this.#ctx as any
    return new Promise<string>((resolve) => {
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        offStream()
        offStatus()
        offTurn()
        try {
          handle.dispose()
        } catch {
          /* already gone */
        }
        resolve(out.trim())
      }
      const dbg = (m: string) => {
        if (process.env.DSH_OPENTUI_DEBUG) {
          try { appendFileSync("/tmp/otui-btw.log", `${Date.now()} ${m}\n`) } catch {}
        }
      }
      dbg(`side agent ${agentId} created`)
      const offStream = ctxAny.on("agent/assistant-stream", ({ agent, frame }: { agent: { id: string }; frame: StreamFrame }) => {
        if (agent.id !== agentId) return
        dbg(`frame ${frame.type} ${frame.chunk?.type ?? ""} ${(frame.chunk?.text ?? "").length}ch`)
        if (frame.type !== "chunk" || !frame.chunk) return
        if (frame.chunk.type === "text-delta" && frame.chunk.text) {
          out += frame.chunk.text
          onDelta?.(out)
        }
      })
      // settle on the deterministic turn/end firehose event — the
      // agent/status running→idle bounce at factory init raced the
      // followup and settled the side call before it ran
      const offTurn = ctxAny.on("session/event", (session: any, event: SessionEvent) => {
        if (String(session?.id) === sessionId && event.type === "turn/end") {
          dbg(`turn/end reason=${JSON.stringify(event.data?.reason).slice(0, 200)}`)
          if (event.data?.reason?.kind === "error") {
            out = `error: ${String(event.data.reason.error?.message ?? "unknown").slice(0, 200)}`
          }
          settle()
        }
      })
      const offStatus = ctxAny.on("agent/status", ({ agent, status }: { agent: { id: string }; status: string }) => {
        if (agent.id === agentId) dbg(`status ${status}`)
      })
      const snap = snapshot.length > 0 ? `Recent conversation context (for reference only):\n${snapshot.join("\n").slice(-1500)}\n\n` : ""
      const message = createUserMessage({
        content: [{ type: "text", text: `${snap}Side question (answer in one or two sentences, do not use tools): ${question}` }],
        source: { kind: "user" },
      })
      handle.agent.followup(message)
      // hard stop: a wedged side call resolves empty after 120s
      setTimeout(settle, 120000)
    })
  }

  /** The host settings service seam (login/logout route registration). */
  get settingsSeam(): { describe(): Promise<any>; mutate(ns: string, ops: unknown[], revision?: number): Promise<void> } | undefined {
    const st = (this.#ctx as any).get?.("settings")
    return st ? { describe: () => st.describe(), mutate: (ns: string, ops: unknown[], rev?: number) => st.mutate(ns, ops, rev) } : undefined
  }

  /** Agent definitions from ~/.dsh/agents/*.md — frontmatter (name,
   * display_name, description, model, thinking, deep, maxRounds) + body.
   * Broken files are reported, not thrown. */
  listAgents(): { name: string; displayName?: string; description?: string; model?: string; thinking?: string; deep?: string; maxRounds?: string; file: string; broken?: string }[] {
    const out: { name: string; displayName?: string; description?: string; model?: string; thinking?: string; deep?: string; maxRounds?: string; file: string; broken?: string }[] = []
    try {
      const home = process.env.DSH_HOME || join(process.env.HOME || "", ".dsh")
      const dir = join(home, "agents")
      if (!existsSync(dir)) return []
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".md")) continue
        const full = join(dir, f)
        try {
          const text = readFileSync(full, "utf8")
          const m = /^---\n([\s\S]*?)\n---/.exec(text)
          const fm: Record<string, string> = {}
          if (m) {
            for (const line of m[1]!.split("\n")) {
              const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line.trim())
              if (kv) fm[kv[1]!] = kv[2]!.replace(/^"|"$|'"$/g, "").trim()
            }
          }
          out.push({
            name: fm.name ?? f.replace(/\.md$/, ""),
            displayName: fm.display_name,
            description: fm.description,
            model: fm.model,
            thinking: fm.thinking,
            deep: fm.deep,
            maxRounds: fm.maxRounds,
            file: full,
          })
        } catch (e) {
          out.push({ name: f, file: full, broken: String(e instanceof Error ? e.message : e).slice(0, 100) })
        }
      }
    } catch {
      /* dir missing: empty */
    }
    return out
  }

  /** Edit one frontmatter field of an agent definition file. */
  agentSet(name: string, field: "model" | "thinking" | "deep", value: string): void {
    const home = process.env.DSH_HOME || join(process.env.HOME || "", ".dsh")
    const file = join(home, "agents", `${name}.md`)
    const text = readFileSync(file, "utf8")
    const lineRe = new RegExp(`^(${field}):\\s*.*$`, "m")
    let next: string
    if (lineRe.test(text)) {
      next = text.replace(lineRe, `$1: ${value}`)
    } else if (/^---\\n[\\s\\S]*?\\n---/.test(text)) {
      // insert into the frontmatter block before its closing ---
      next = text.replace(/^---\n/, `---\n${field}: ${value}\n`)
    } else {
      next = `---\n${field}: ${value}\n---\n\n` + text
    }
    writeFileSync(file, next)
  }

  /** Remote tail: READ-ONLY view over a session log another dsh process
   * is driving (resume hits the single-writer guard). Polls the
   * jsonl.zstd file (zstd CLI), keeps durable rows only, and replays the
   * durable suffix into the transcript each tick. */
  remoteTailActive = false
  /** Sink the remote tail replays into (registered by ShellHost). */
  remoteTailSink: ((rows: { kind: string; text: string; final: boolean }[]) => void) | null = null

  async startRemoteTail(sessionId: string): Promise<string | undefined> {
    try {
      const home = process.env.DSH_HOME || join(process.env.HOME || "", ".dsh")
      const root = join(home, "sessions")
      // locate the newest log for this session id across project buckets
      let file: string | undefined
      for (let depth = 0; depth < 4 && !file; depth++) {
        // walk is done below via readdir; here just find the session dir
      }
      const walk = (dir: string, depth: number): string | undefined => {
        if (depth > 3) return undefined
        for (const name of readdirSync(dir)) {
          const full = join(dir, name)
          if (statSync(full).isDirectory()) {
            const found = walk(full, depth + 1)
            if (found) return found
          } else if (name.includes(sessionId) && name.endsWith(".zstd")) {
            return full
          }
        }
        return undefined
      }
      file = walk(root, 0)
      if (!file) return "log file not found for this session"
      this.remoteTailActive = true
      const poll = async (): Promise<void> => {
        if (!this.remoteTailActive) return
        try {
          const r = await new Promise<{ error: Error | null; stdout: string }>((res) => {
            const { execFile } = require("node:child_process") as typeof import("node:child_process")
            execFile("zstd", ["-dc", file!], { maxBuffer: 1 << 30 }, (error, stdout) => res({ error, stdout }))
          })
          if (r.error) return
          const rows: { kind: "user" | "assistant"; text: string }[] = []
          for (const line of r.stdout.split("\n")) {
            if (!line.trim()) continue
            try {
              const ev = JSON.parse(line) as { type?: string; data?: any }
              const type = ev.type ?? ""
              if (!["user/message", "assistant/message", "tool/call", "tool/result"].includes(type)) continue
              const text = type === "assistant/message"
                ? (ev.data?.message?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n")
                : type === "user/message"
                  ? (ev.data?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n")
                  : `${ev.data?.name ?? "tool"}`
              if (text.trim()) rows.push({ kind: type === "user/message" ? "user" : "assistant", text: `${type === "tool/call" || type === "tool/result" ? "⚙ " : ""}${text}` })
            } catch {
              /* partial line */
            }
          }
          if (rows.length > 0 && this.remoteTailSink) {
            this.remoteTailSink(rows.map((r2) => ({ kind: r2.kind, text: r2.text, final: true })))
          }
        } catch {
          /* decode race with the writer — next poll catches up */
        }
        if (this.remoteTailActive) setTimeout(poll, 2000)
      }
      void poll()
      return undefined
    } catch (e) {
      return String(e instanceof Error ? e.message : e).slice(0, 150)
    }
  }

  stopRemoteTail(): void {
    this.remoteTailActive = false
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

  /** Host settings namespaces (settings.describe snapshot). */
  async settingsDescribe(): Promise<{ ns: string; revision?: number; value?: any }[]> {
    try {
      const st = (this.#ctx as any).get?.("settings")
      if (!st?.describe) return []
      const out = (await st.describe()) as any[]
      return (Array.isArray(out) ? out : []).map((e) => ({ ns: String(e?.ns ?? ""), revision: e?.revision, value: e?.value }))
    } catch {
      return []
    }
  }

  /** Host settings mutation (settings.mutate with revision). */
  async settingsMutate(ns: string, ops: unknown[], revision?: number): Promise<void> {
    const st = (this.#ctx as any).get?.("settings")
    if (!st?.mutate) throw new Error("settings service unavailable")
    await st.mutate(ns, ops, revision)
  }

  /** Plugin config file (profile-local JSON, self-contained persistence):
   * retentionDays filters /sessions; askUserTimeoutSec auto-declines the
   * ask overlay; favoriteModels/hiddenModels shape the /model picker. */
  configPath(name = "config.json"): string {
    // walk up from the bundle to the PROFILE ROOT (marked by
    // cordis.patch.yml) — the bundle depth varies between layouts
    let dir = new URL(".", import.meta.url).pathname
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, "cordis.patch.yml"))) return join(dir, name)
      const parent = join(dir, "..")
      if (parent === dir) break
      dir = parent
    }
    const home = process.env.DSH_HOME || join(process.env.HOME || "", ".dsh")
    return join(home, "profiles", "dsh-opentui", name)
  }

  configLoad(): Record<string, any> {
    try {
      return JSON.parse(readFileSync(this.configPath(), "utf8"))
    } catch {
      return {}
    }
  }

  configSave(patch: Record<string, any>): Record<string, any> {
    const merged = { ...this.configLoad(), ...patch }
    writeFileSync(this.configPath(), JSON.stringify(merged, null, 2) + "\n")
    return merged
  }

  /** Session-log integrity scan (the /repair report): walks the session
   * store, flags empty logs, broken zstd frames and invalid jsonl tails. */
  repairScan(): string[] {
    const out: string[] = []
    try {
      const home = process.env.DSH_HOME || join(process.env.HOME || "", ".dsh")
      const root = join(home, "sessions")
      if (!existsSync(root)) return ["no sessions directory"]
      let total = 0
      let ok = 0
      const broken: string[] = []
      const visit = (dir: string, depth: number): void => {
        if (depth > 4) return
        for (const name of readdirSync(dir)) {
          const full = join(dir, name)
          if (statSync(full).isDirectory()) {
            visit(full, depth + 1)
            continue
          }
          // any session log: v3/v4, plain or zstd — the layout moved to
          // session-<uuid>/ directories with v4 zstd logs
          if (!(name.startsWith("session.") && (name.endsWith(".zstd") || name.endsWith(".jsonl")))) continue
          total += 1
          const size = statSync(full).size
          if (size === 0) {
            broken.push(`${name} (0 bytes)`)
            continue
          }
          if (name.endsWith(".zstd")) {
            const buf = readFileSync(full)
            const magicOk = buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd
            if (!magicOk) {
              broken.push(`${name} (not a zstd frame)`)
              continue
            }
            ok += 1
            continue
          }
          try {
            const text = readFileSync(full, "utf8").trim()
            const last = text.split("\n").filter((l) => l.trim()).pop() ?? "{}"
            JSON.parse(last)
            ok += 1
          } catch {
            broken.push(`${name} (invalid jsonl tail)`)
          }
        }
      }
      visit(root, 0)
      out.push(`sessions: ${total} logs scanned, ${ok} healthy`)
      if (broken.length === 0) out.push("no broken logs found")
      else {
        out.push(`broken: ${broken.length}`)
        for (const b of broken.slice(0, 8)) out.push(`  ✗ ${b}`)
        if (broken.length > 8) out.push(`  … +${broken.length - 8} more`)
      }
    } catch (e) {
      out.push(`scan failed: ${String(e instanceof Error ? e.message : e).slice(0, 150)}`)
    }
    return out
  }

  /** Skills from the ctx.skills registry (name/description/invocation). */
  listSkills(): { name: string; description: string; invocation: string }[] {
    try {
      const reg = (this.#ctx as any).get?.("skills")
      if (!reg?.list) return []
      const list = (reg.list() ?? []) as any[]
      return list.map((x) => ({
        name: String(x?.name ?? ""),
        description: String(x?.description ?? "").slice(0, 90),
        invocation: String(x?.invocation ?? ""),
      })).filter((x) => x.name)
    } catch {
      return []
    }
  }

  /** Plugin hot-reload via the host loader seam. */
  async reloadPlugins(): Promise<string | undefined> {
    try {
      const loader = (this.#ctx as any).get?.("loader")
      if (!loader) return "loader service unavailable"
      // entry url = this plugin's dist-host index
      await loader.reload?.(new URL("../dist-host/index.js", import.meta.url).href)
      return undefined
    } catch (e) {
      return String(e instanceof Error ? e.message : e).slice(0, 200)
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

  /** Tool-execution mode for the powerline brand segment — what the model
   * actually sees, read from the host tool registry: under a `ptc`
   * presentation every capability collapses into the reserved `run_code`
   * transport, which `tools.schemas()` lists for exactly that case (and
   * never under `native`). Resolved for the live agent's scope when a
   * session exists (a preset's `tool-presentation` row shadows the
   * deployment default there), else for the global view. Never inferred
   * from the installed plugin list: mounting a ptc/codemode plugin does not
   * change the main agent's presentation. */
  executionMode(): "native" | "ptc" {
    try {
      const tools = (this.#ctx as any).get?.("tools")
      if (typeof tools?.schemas !== "function") return "native"
      const schemas: { name?: string }[] = tools.schemas(this.#handle?.agent) ?? []
      return schemas.some((schema) => schema?.name === "run_code") ? "ptc" : "native"
    } catch {
      return "native"
    }
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
    this.#disarmIdleRelease()
    // Fresh telemetry window for this turn (ticks reset, timing restarts,
    // usage delta baseline taken in case usage is cumulative over the session)
    this.#turns++
    this.#ticker.reset()
    this.#turnStartedAt = Date.now()
    this.#turnUsageStart = { prompt: this.usage.prompt, completion: this.usage.completion }
    if (!this.#handle) {
      // fresh session, a one-shot resume of a picked historical one — or the
      // idle-release wake: same session id re-attached after the lock was
      // freed for other surfaces.
      const reattach = this.#isReleasedForReattach()
      this.#sessionId = this.#resumeId ?? this.#sessionId ?? randomUUID()
      this.#resumeId = undefined
      // The wake continues an EXISTING session — a pending /preset choice is
      // for the NEXT fresh session, not for re-mounting over this one's
      // recorded composition.
      if (reattach) this.#presetId = undefined
      const agentOptions = this.#modelSelection() ?? {}
      try {
        this.#handle = await (this.#ctx as any).agents.create({
          sessionId: this.#sessionId,
          meta: { cwd: process.cwd(), ...(this.#presetId ? { agentPreset: this.#presetId } : {}) },
          agentOptions,
        })
      } catch (error) {
        if (reattach && (error as { name?: string; message?: string })?.name === "SessionAlreadyOwnedError") {
          // Another surface won the lease while we were released. The id is
          // kept — a later send re-probes (their idle frees it); /new escapes.
          throw new Error("session is being driven by another process (phone/web) — send again later to re-take it, or /new for a fresh session")
        }
        throw error
      }
      this.#agentId = this.#handle.agent.id
      DBG(`session created ${this.#sessionId} agent=${this.#agentId}`)
      if (reattach) {
        // Catch-up: durable rows other surfaces wrote while we were
        // released, painted before this turn streams.
        const missed = await this.storedTranscript(this.#sessionId, this.#releasedSeq)
        this.#releasedSeq = 0
        if (missed.length > 0) cb.onReattachedMissed?.(missed)
      }
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

  // ---- idle release mechanics ----

  /** Seconds of input+turn silence before the write handle is freed.
   * `idleReleaseSec` in the plugin config; 0 disables. Default 600 (10min):
   * short enough to free the lock when a TUI is forgotten open, long enough
   * to never fire under a thinking pause. */
  #idleReleaseMs(): number {
    const cfg = this.configLoad()
    const sec = Number(cfg.idleReleaseSec ?? 600)
    if (!Number.isFinite(sec) || sec <= 0) return 0
    return sec * 1000
  }

  #armIdleRelease(): void {
    this.#disarmIdleRelease()
    const ms = this.#idleReleaseMs()
    if (ms <= 0 || this.#sessionId === undefined) return
    const timer = setTimeout(() => this.#releaseIdle(), ms)
    timer.unref?.()
    this.#idleTimer = timer
  }

  #disarmIdleRelease(): void {
    if (this.#idleTimer === undefined) return
    clearTimeout(this.#idleTimer)
    this.#idleTimer = undefined
  }

  /** The contract's "idle releases the write": drop the write handle so the
   * next inputting surface (phone, another TUI) wins the kernel lease. The
   * transcript stays on screen — only the handle goes; the next send
   * re-attaches the SAME session id (turn()'s reattach arm). */
  #releaseIdle(): void {
    this.#idleTimer = undefined
    if (this.#handle === undefined || this.#running) return
    // The wake diff base: everything durable up to now is already painted.
    this.#releasedSeq = this.#snapshot().length
    this.#toolCalls.clear()
    try {
      this.#handle?.dispose?.()
    } catch {
      /* already gone */
    }
    this.#handle = undefined
    this.#agentId = undefined
  }

  /** True when #handle is gone but #sessionId is retained BY the idle
   * release (not by abort or a pending resume — those want fresh/picked). */
  #isReleasedForReattach(): boolean {
    return this.#handle === undefined && this.#sessionId !== undefined && this.#resumeId === undefined
  }

  // ---- subagent panel state ----
  /** Live view per adopted child session (tui-pi AgentView, minimal). */
  #children = new Map<
    string,
    { label: string; model?: string; status: "running" | "completed" | "failed" | "cancelled"; rounds: number; tokens?: number; startedAt: number; lastLine?: string; injectedRound?: number; hardStopRound?: number }
  >()
  /** tool-workflow/agent-start ↔ agent-end pairing (runId:seq → child). */
  #runSeqToChild = new Map<string, string>()
  /** Per-child transcript log (viewer) and the live child agent for steer. */
  #childLogs = new Map<string, string[]>()
  #childAgents = new Map<string, any>()
  // ---- maxRounds hard-stop policy (feature batch F1) ----
  // The round ladder (subagent-policy.ts) fed from #foldChildEvent's
  // assistant/message counts; wrap-up rides the live child agent's steer,
  // force-stop rides the agent's cancel. Limits are read live from the
  // `dsh-opentui` settings namespace (cached snapshot, refreshed lazily —
  // the next round count picks up an edit).
  #roundPolicy?: SubagentRoundPolicy
  #roundLimits: SubagentRoundLimits = { ...DEFAULT_SUBAGENT_ROUND_LIMITS }
  #roundLimitsRefreshing = false

  /** Create the round ladder once (sinks bound to THIS facade). */
  #ensureRoundPolicy(): SubagentRoundPolicy {
    if (this.#roundPolicy === undefined) {
      this.#roundPolicy = new SubagentRoundPolicy({
        limits: () => this.#roundLimits,
        // Per-agent tier: the descriptor label resolves to a registered
        // agent (~/.dsh/agents/*.md) whose frontmatter carries maxRounds.
        // Foreground children carry a namespace prefix on their label
        // ("[fg] looper", legacy "[use_agent foreground] looper") — strip
        // it, and fall back to a bare-name suffix match, so the agent
        // file's per-agent cap actually resolves (an unresolvable label
        // keeps the global cap — never widens it).
        resolveAgentCap: (label) => {
          const stripped = bareAgentLabel(label)
          const row = this.listAgents().find(
            (a) =>
              a.name === label ||
              a.name === stripped ||
              (a.displayName !== undefined && (a.displayName === label || a.displayName === stripped)) ||
              label.endsWith(` ${a.name}`),
          )
          const raw = row?.maxRounds
          if (raw === undefined) return undefined
          const n = Number(String(raw).trim())
          return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
        },
        isSettled: (childId) => this.#children.get(childId)?.status !== "running",
        // The service steer is async (subagents prompt): the policy latches
        // the delivery when the returned promise resolves true.
        wrapup: (childId, message) => this.steerChildDetailed(childId, message).then((r) => r.ok),
        forceStop: (childId) => this.cancelChild(childId),
        onHardStop: (record) => this.#onHardStop(record),
        // F6 marker folds: latch the round counts onto the child's view so
        // the picker/viewer markers survive past the console.info line.
        onWrapUp: (childId, round) => {
          const existing = this.#children.get(childId)
          if (!existing) return
          this.#children.set(childId, { ...existing, injectedRound: round })
          this.#emitChildren()
        },
        onForceStop: (childId, round) => {
          const existing = this.#children.get(childId)
          if (!existing) return
          this.#children.set(childId, { ...existing, hardStopRound: round })
          this.#emitChildren()
        },
      })
      this.#refreshRoundLimits()
    }
    return this.#roundPolicy
  }

  /** Lazy live-read of the settings knobs (one in-flight describe at a
   * time; the ladder reads the latest snapshot at every decision). */
  #refreshRoundLimits(): void {
    if (this.#roundLimitsRefreshing) return
    this.#roundLimitsRefreshing = true
    void this.settingsDescribe()
      .then((rows) => {
        this.#roundLimits = limitsFromSettingsRows(rows)
      })
      .catch(() => {
        /* keep the previous snapshot; defaults disable the ladder */
      })
      .finally(() => {
        this.#roundLimitsRefreshing = false
      })
  }

  /** Force-stop one live child (the ladder's stage-2 sink): cancel the
   * captured agent (keepInbox first — session/inbox survive for resume),
   * fall back to a bare cancel, then to the in-process `subagents`
   * service, and settle the view as cancelled. False when no delivery
   * path reaches the child. */
  cancelChild(childId: string): boolean {
    const agent = this.#childAgents.get(childId)
    if (agent?.cancel) {
      try {
        agent.cancel({ kind: "user" }, { keepInbox: true })
      } catch {
        try {
          agent.cancel({ kind: "user" })
        } catch {
          // Stale handle — try the service before giving up.
          return this.#cancelViaService(childId)
        }
      }
      this.#settleChild(childId, "cancelled")
      return true
    }
    return this.#cancelViaService(childId)
  }

  /** Service-level force-stop: the host `subagents` service's
   * `interruptByParent` (in-process, sync; throws when the address does
   * not own a live target). Independent of the firehose session handle —
   * firehose child objects may never carry `.agent` for adoption. */
  #cancelViaService(childId: string): boolean {
    const service = (this.#ctx as any).get?.("subagents")
    if (!service || typeof service.interruptByParent !== "function") return false
    if (this.#sessionId === undefined) return false
    try {
      service.interruptByParent(childId, this.#sessionId, "continuable")
    } catch (error) {
      console.error(
        `[host-session] subagents service force-stop rejected for ${childId.slice(0, 8)}: ${error instanceof Error ? error.message : error}`,
      )
      return false
    }
    this.#settleChild(childId, "cancelled")
    return true
  }

  /** Hard-stop report (console surface; the `⏻` viewer marker folds through
   * the policy's onForceStop hook — batch F6). */
  #onHardStop(record: { childId: string; round: number; cap: number; grace: number }): void {
    console.info(
      `[subagent-policy] force-stopped child ${record.childId} at round ${record.round} (cap ${record.cap} + grace ${record.grace})`,
    )
  }

  /** Child transcript lines (viewer; capped buffer, oldest dropped). */
  childTranscript(id: string): string[] {
    return [...(this.#childLogs.get(id) ?? [])]
  }

  // ---- subagent marker face (batch F6: seam → view) ----
  /** Snapshot the live subagent rows (SeamSubagentView slice). */
  subagentViews(): { id: string; label: string; status: "running" | "completed" | "failed" | "cancelled"; rounds: number; injectedRound?: number; hardStopRound?: number }[] {
    return [...this.#children.entries()].map(([id, v]) => ({
      id,
      label: v.label,
      status: v.status,
      rounds: v.rounds,
      ...(v.injectedRound !== undefined ? { injectedRound: v.injectedRound } : {}),
      ...(v.hardStopRound !== undefined ? { hardStopRound: v.hardStopRound } : {}),
    }))
  }

  /** Push listener registry (the seam adapter forwards this 1:1); fires the
   * FULL snapshot on every fold — replay the current snapshot immediately so
   * a late subscriber (a picker opened after the run started) paints now. */
  #subagentListeners = new Set<(views: ReturnType<HostSession["subagentViews"]>) => void>()
  onSubagentViews(listener: (views: ReturnType<HostSession["subagentViews"]>) => void): () => void {
    this.#subagentListeners.add(listener)
    listener(this.subagentViews())
    return () => this.#subagentListeners.delete(listener)
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

  /** Steer a RUNNING child with a typed outcome. Tries the captured
   * firehose agent first; firehose child session objects may never carry
   * `.agent` (adoption is best-effort), so a miss falls back to the
   * in-process `subagents` service (`ctx.get("subagents")` — the same
   * subagents/prompt face the client mode rides remotely). Service-level
   * delivery does not depend on the firehose handle, so the maxRounds
   * wrap-up lands even when adoption never captured an agent. */
  async steerChildDetailed(id: string, text: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const agent = this.#childAgents.get(id)
    if (agent?.steer) {
      try {
        agent.steer(createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }))
        return { ok: true }
      } catch {
        /* stale handle — fall through to the service */
      }
    }
    if (this.#sessionId === undefined) return { ok: false, reason: "no live host session" }
    const service = (this.#ctx as any).get?.("subagents")
    if (!service || typeof service.prompt !== "function") {
      return { ok: false, reason: "child agent not reachable and no subagents service" }
    }
    try {
      await service.prompt({
        requestId: randomUUID(),
        parentSessionId: this.#sessionId,
        childSessionId: id,
        mode: "continuable",
        delivery: "steer",
        content: [{ type: "text", text }],
      })
      return { ok: true }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error(`[host-session] subagents service steer rejected for ${id.slice(0, 8)}: ${reason}`)
      return { ok: false, reason }
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
      const rounds = view.rounds + 1
      this.#children.set(sessionKey, {
        ...view,
        rounds,
        ...(usage ? { tokens: (view.tokens ?? 0) + Number(usage) } : {}),
        ...(text ? { lastLine: text.split("\n").pop()?.slice(0, 80) } : {}),
      })
      changed = true
      // maxRounds ladder feed (batch F1): the wrap-up/force-stop delivery
      // is microtask-deferred inside the policy — no inbox reentry here.
      this.#ensureRoundPolicy().onRoundCount(sessionKey, rounds, this.#children.get(sessionKey)?.label)
      this.#refreshRoundLimits()
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
    // F6 marker face: fan the snapshot out to seam subscribers too (the
    // TurnCallbacks surface stays untouched — it may be absent between turns).
    for (const listener of this.#subagentListeners) {
      try {
        listener(this.subagentViews())
      } catch {
        /* a UI listener must never take the firehose down */
      }
    }
    const cb = this.#cb
    if (!cb?.onSubagentUpdate) return
    const clamp = (v: string | undefined) => (v && v.length > 240 ? v.slice(-240) : v)
    cb.onSubagentUpdate(
      [...this.#children.entries()].map(([id, v]) => ({
        id,
        label: v.label,
        ...(v.model ? { model: v.model } : {}),
        status: v.status,
        rounds: v.rounds,
        ...(v.tokens !== undefined ? { tokens: v.tokens } : {}),
        elapsed: Math.max(0, Math.floor((Date.now() - v.startedAt) / 1000)),
        ...(v.lastLine ? { lastLine: clamp(v.lastLine) } : {}),
        ...(v.injectedRound !== undefined ? { injectedRound: v.injectedRound } : {}),
        ...(v.hardStopRound !== undefined ? { hardStopRound: v.hardStopRound } : {}),
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
    this.#disarmIdleRelease()
    this.#releasedSeq = 0
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
    this.#disarmIdleRelease()
    try {
      this.#handle?.dispose?.()
    } catch {
      /* already gone */
    }
    this.#handle = undefined
    this.#agentId = undefined
    // "/new semantics" for the next send: a FRESH session. #sessionId must
    // not survive (the reattach arm would resume the aborted one).
    this.#sessionId = undefined
    this.#releasedSeq = 0
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
    // Decode window (batch F4): first delta → last delta; a turn with no
    // streamed deltas (pure tool round) contributes no window.
    if (this.#firstDeltaAt > 0) {
      const decodeMs = Math.max(0, (this.#lastDeltaAt || endedAt) - this.#firstDeltaAt)
      if (decodeMs > 0) {
        this.#lastDecode = { tokens, ms: decodeMs }
        this.#decodeTotals.tokens += tokens
        this.#decodeTotals.ms += decodeMs
      }
    }
    this.#firstDeltaAt = 0
    this.#lastDeltaAt = 0
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
    // The takeover contract's lock half: once idle, stop hogging the write
    // lease — the phone's /resume (or a second TUI) gets it after the
    // configured quiet window instead of never.
    this.#armIdleRelease()
    r?.()
  }

  #wire() {
    const ctx = this.#ctx as any

    ctx.on("agent/assistant-stream", ({ agent, frame }: { agent: { id: string }; frame: StreamFrame }) => {
      // CHILD agents stream here too (this listener is not scope-filtered
      // below the main-agent gate): live-update the subagent panel's
      // lastLine so its message visibly scrolls
      if (frame.type === "chunk" && frame.chunk?.type === "text-delta" && frame.chunk.text && agent.id !== this.#agentId) {
        const view = this.#children.get(agent.id)
        if (view && view.status === "running") {
          this.#children.set(agent.id, { ...view, lastLine: (view.lastLine ?? "") + frame.chunk.text })
          this.#emitChildren()
        }
      }
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
          this.#noteDelta()
          this.#ticker.add(c.text.length)
        } else if (c.type === "text-delta" && c.text) {
          cb.onContentDelta(c.text)
          this.#noteDelta()
          this.#ticker.add(c.text.length)
        } else if (c.type === "usage") {
          if (process.env.DSH_OPENTUI_DEBUG) {
            try { appendFileSync("/tmp/otui-usage.log", JSON.stringify(c) + "\n") } catch {}
          }
          // usage frame: prompt = the request's context size (assignment —
          // the 🧠 segment reads latest, not additive); completion adds up
          // over the session. Field names vary by adapter — numeric scan.
          // real shape (instrumented): {usage:{inputTokens, outputTokens,
          // totalTokens[, cacheRead/cacheWrite…?]}} — prompt = the request's
          // context size (assignment), completion accumulates
          const u = (c as any).usage ?? {}
          const num = (v: unknown) => (typeof v === "number" ? v : 0)
          let p = Math.max(num(u.promptTokens), num(u.inputTokens), num(u.prompt_tokens))
          let comp = Math.max(num(u.completionTokens), num(u.outputTokens), num(u.completion_tokens))
          const cRead = Math.max(num((u as any).cacheReadTokens), num((u as any).cache_read_tokens), num((u as any).cacheRead))
          const cWrite = Math.max(num((u as any).cacheWriteTokens), num((u as any).cache_write_tokens), num((u as any).cacheWrite))
          if (p > 0) this.usage.prompt = p
          if (comp > 0) this.usage.completion += comp
          if (cRead > 0) this.usage.cacheRead = cRead
          if (cWrite > 0) this.usage.cacheWrite = cWrite
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
      this.#emitJournal(event)
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
