/**
 * The agent session: message history + the turn loop
 * (user → thinking → tool calls → tool results → … → reply).
 * The UI drives it through callbacks; nothing here touches the renderer.
 */
import type { ResolvedModel } from "./config.ts"
import { streamChat, type ChatMessage, type StreamEvent } from "./llm.ts"
import { runTool, toolDefs, type ToolRun } from "./tools.ts"

const SYSTEM_PROMPT = `You are a focused terminal coding assistant working inside dsh-opentui.
Use the bash/read_file/write_file tools to inspect and change the workspace before answering.
Keep answers concise and technical. Reply in the user's language.`

export interface TurnCallbacks {
  onThinkingDelta: (text: string) => void
  onContentDelta: (text: string) => void
  onTurnEnd: (usage: { prompt: number; completion: number }) => void
  /** Return true to approve the tool run, false to reject it. */
  onApprove: (name: string, args: Record<string, unknown>) => Promise<boolean>
  /** A tool call was issued — the dock's "running" signal (fires before
   * onToolRun settles the entry; onApprove alone can't cover auto-allowed
   * calls). Optional so thin embedders need not implement it. */
  onToolStart?: (start: { callId?: string; name: string; args: string }) => void
  onToolRun: (run: ToolRun) => void
  onError: (message: string) => void
  /** Streaming telemetry for tokens-per-second displays: fired at most every
   * ~250ms while the model streams, with `chars` = total content characters
   * (text + reasoning combined) streamed SO FAR this turn and `at` = the tick
   * timestamp. One final tick fires on turn end so the closing rate is
   * accurate. Optional — embedders that don't render throughput omit it. */
  onStreamTick?: (tick: { chars: number; at: number }) => void
  /** The agent's todo list snapshot (host todo tool's todo/write event —
   * whole-list replacement, cleared by the host at every turn start).
   * Host mode only; the direct session has no todo tool. */
  onTodos?: (todos: { content: string; status: "pending" | "in_progress" | "completed" }[]) => void
  /** Subagent panel snapshot: every adopted child session's live view
   * (label/model/status/rounds/tokens/elapsed/lastLine). Host mode only. */
  onSubagentUpdate?: (entries: {
    id: string
    label: string
    model?: string
    status: "running" | "completed" | "failed" | "cancelled"
    rounds: number
    tokens?: number
    elapsed: number
    lastLine?: string
  }[]) => void
  /** Idle-release wake catch-up: durable user/assistant rows the session
   * gained while our write handle was released (another surface — the
   * phone, a second TUI — drove it). Fired once per wake, BEFORE the new
   * turn streams; the rows belong BEFORE the prompt row the caller just
   * pushed. Host mode only; no release, no callback. */
  onReattachedMissed?: (items: { kind: "user" | "assistant"; text: string }[]) => void
}

/**
 * End-of-turn streaming telemetry (what onStreamTick was sampling).
 * `tokens` prefers the provider-reported completion count for the turn;
 * `estimated: true` means it is a chars/4 approximation instead.
 * `tps` is tokens/ms→s (null when duration or tokens are 0).
 */
export interface TurnStats {
  startedAt: number
  endedAt: number
  ms: number
  chars: number
  tokens: number
  tps: number | null
  estimated: boolean
}

/** onStreamTick cadence — ~4 telemetry samples per streamed second. */
export const STREAM_TICK_MS = 250

/** Fallback tokens-per-char divisor when the provider reports no usage. */
export const CHARS_PER_TOKEN = 4

/** Estimate tokens from streamed characters (used when no real usage). */
export function estimateTokens(chars: number): number {
  return Math.max(0, Math.round(chars / CHARS_PER_TOKEN))
}

/** Tokens per second over a duration in ms; null when not computable. */
export function tokensPerSecond(tokens: number, ms: number): number | null {
  if (ms <= 0 || tokens <= 0) return null
  return (tokens * 1000) / ms
}

/** An empty TurnStats for "no turn observed yet". */
export function emptyTurnStats(): TurnStats {
  return { startedAt: 0, endedAt: 0, ms: 0, chars: 0, tokens: 0, tps: null, estimated: true }
}

/**
 * The char accumulator + throttle behind onStreamTick, shared by AgentSession
 * (direct mode) and HostSession (host mode) so both tick identically:
 * add() emits a tick at most once per intervalMs, finish() always emits one
 * final (unthrottled) tick on turn end.
 */
export function createStreamTicker(
  onTick: (tick: { chars: number; at: number }) => void,
  intervalMs = STREAM_TICK_MS,
): {
  reset: () => void
  add: (delta: number) => void
  finish: () => void
  chars: () => number
} {
  let chars = 0
  let lastTickAt = 0
  return {
    reset() {
      chars = 0
      lastTickAt = 0
    },
    add(delta: number) {
      if (delta <= 0) return
      chars += delta
      const now = Date.now()
      if (now - lastTickAt >= intervalMs) {
        lastTickAt = now
        onTick({ chars, at: now })
      }
    },
    finish() {
      if (chars <= 0) return
      const now = Date.now()
      lastTickAt = now
      onTick({ chars, at: now })
    },
    chars: () => chars,
  }
}

export class AgentSession {
  model: ResolvedModel
  #messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }]
  #turns = 0
  totalUsage = { prompt: 0, completion: 0 }
  /** Telemetry of the last completed turn (same shape as HostSession's). */
  lastTurnStats: TurnStats = emptyTurnStats()

  constructor(model: ResolvedModel) {
    this.model = model
  }

  get turns() {
    return this.#turns
  }

  /** One user turn; may internally run many LLM rounds (tool loop). */
  async turn(userText: string, cb: TurnCallbacks, signal?: AbortSignal): Promise<void> {
    this.#turns++
    this.#messages.push({ role: "user", content: userText })

    // Per-turn telemetry: chars accrue across ALL rounds (thinking + text),
    // real completion tokens accrue per round when the provider reports any.
    const startedAt = Date.now()
    const ticker = createStreamTicker((t) => cb.onStreamTick?.(t))
    let realTokens = 0
    let sawRealUsage = false
    let ended = false
    const endTurn = () => {
      if (ended) return
      ended = true
      const endedAt = Date.now()
      ticker.finish() // final tick so the closing rate is accurate
      const chars = ticker.chars()
      const ms = Math.max(0, endedAt - startedAt)
      const real = sawRealUsage && realTokens > 0
      const tokens = real ? realTokens : estimateTokens(chars)
      this.lastTurnStats = {
        startedAt,
        endedAt,
        ms,
        chars,
        tokens,
        tps: tokensPerSecond(tokens, ms),
        estimated: !real,
      }
    }

    try {
      for (let round = 0; round < 12; round++) {
        let result
        try {
          result = await streamChat({
            model: this.model,
            messages: this.#messages,
            tools: toolDefs,
            signal,
            onEvent: (e: StreamEvent) => {
              if (e.type === "thinking" && e.text) {
                cb.onThinkingDelta(e.text)
                ticker.add(e.text.length)
              }
              if (e.type === "content" && e.text) {
                cb.onContentDelta(e.text)
                ticker.add(e.text.length)
              }
            },
          })
        } catch (e) {
          if (signal?.aborted) return
          cb.onError(String(e instanceof Error ? e.message : e))
          return
        }

        this.totalUsage.prompt += result.usage.prompt
        this.totalUsage.completion += result.usage.completion
        if (result.usage.prompt > 0 || result.usage.completion > 0) {
          sawRealUsage = true
          realTokens += result.usage.completion
        }

        if (!result.toolCalls.length) {
          // final reply for this turn
          this.#messages.push({ role: "assistant", content: result.content, reasoning: result.reasoning })
          endTurn()
          cb.onTurnEnd({ prompt: result.usage.prompt, completion: result.usage.completion })
          return
        }

        // assistant asked for tools
        this.#messages.push({
          role: "assistant",
          content: result.content || "",
          tool_calls: result.toolCalls.map((t) => ({
            id: t.id,
            type: "function" as const,
            function: { name: t.name, arguments: t.arguments },
          })),
        })

        let anyApproved = false
        for (const call of result.toolCalls) {
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(call.arguments || "{}")
          } catch {
            /* model sent malformed args; pass through as-is */
          }
          const approved = await cb.onApprove(call.name, args)
          if (!approved) {
            this.#messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: "user declined this tool call",
            })
            continue
          }
          anyApproved = true
          cb.onToolStart?.({ callId: call.id, name: call.name, args: call.arguments || "{}" })
          const run = await runTool(call.name, args, { cwd: process.cwd() })
          cb.onToolRun(run)
          this.#messages.push({ role: "tool", tool_call_id: call.id, content: run.output || "(no output)" })
        }
        if (!anyApproved && round > 8) {
          this.#messages.push({ role: "user", content: "(all tool calls were declined; answer directly now)" })
        }
      }
      cb.onError("reached max tool rounds (12)")
    } finally {
      endTurn() // covers error/abort/max-rounds exits with a final tick + stats
    }
  }
}
