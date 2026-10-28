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
  onToolRun: (run: ToolRun) => void
  onError: (message: string) => void
}

export class AgentSession {
  model: ResolvedModel
  #messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }]
  #turns = 0
  totalUsage = { prompt: 0, completion: 0 }

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

    for (let round = 0; round < 12; round++) {
      let result
      try {
        result = await streamChat({
          model: this.model,
          messages: this.#messages,
          tools: toolDefs,
          signal,
          onEvent: (e: StreamEvent) => {
            if (e.type === "thinking" && e.text) cb.onThinkingDelta(e.text)
            if (e.type === "content" && e.text) cb.onContentDelta(e.text)
          },
        })
      } catch (e) {
        if (signal?.aborted) return
        cb.onError(String(e instanceof Error ? e.message : e))
        return
      }

      this.totalUsage.prompt += result.usage.prompt
      this.totalUsage.completion += result.usage.completion

      if (!result.toolCalls.length) {
        // final reply for this turn
        this.#messages.push({ role: "assistant", content: result.content, reasoning: result.reasoning })
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
        const run = await runTool(call.name, args, { cwd: process.cwd() })
        cb.onToolRun(run)
        this.#messages.push({ role: "tool", tool_call_id: call.id, content: run.output || "(no output)" })
      }
      if (!anyApproved && round > 8) {
        this.#messages.push({ role: "user", content: "(all tool calls were declined; answer directly now)" })
      }
    }
    cb.onError("reached max tool rounds (12)")
  }
}
