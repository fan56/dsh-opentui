/**
 * Streaming chat client for OpenAI-compatible endpoints (the api all local
 * dsh providers speak: "openai-completions"). Parses SSE, accumulates
 * tool_calls by index, surfaces GLM-style reasoning_content as thinking.
 */
import type { ResolvedModel } from "./config.ts"

export interface ToolDef {
  type: "function"
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content?: string | null
  reasoning?: string
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

export interface StreamEvent {
  type: "thinking" | "content" | "done" | "error"
  text?: string
  usage?: { prompt: number; completion: number }
  error?: string
}

export interface AssistantResult {
  content: string
  reasoning: string
  toolCalls: { id: string; name: string; arguments: string }[]
  usage: { prompt: number; completion: number }
}

export async function streamChat(opts: {
  model: ResolvedModel
  messages: ChatMessage[]
  tools?: ToolDef[]
  signal?: AbortSignal
  onEvent: (e: StreamEvent) => void
}): Promise<AssistantResult> {
  const body: Record<string, unknown> = {
    model: opts.model.model,
    messages: opts.messages,
    stream: true,
    // Ask OpenAI-compatible endpoints to attach the `usage` object to the
    // final SSE chunk (OpenAI proper never sends it without this; vLLM and
    // friends already do). The parser below picks it up for real TPS math.
    stream_options: { include_usage: true },
  }
  if (opts.tools?.length) {
    body.tools = opts.tools
    body.tool_choice = "auto"
  }

  const res = await fetch(`${opts.model.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.model.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  const result: AssistantResult = { content: "", reasoning: "", toolCalls: [], usage: { prompt: 0, completion: 0 } }
  const toolAcc = new Map<number, { id: string; name: string; args: string }>()

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split("\n")
    buf = lines.pop() ?? ""
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data:")) continue
      const payload = trimmed.slice(5).trim()
      if (payload === "[DONE]") continue
      let chunk: any
      try {
        chunk = JSON.parse(payload)
      } catch {
        continue
      }
      if (chunk.usage) {
        result.usage.prompt = chunk.usage.prompt_tokens ?? 0
        result.usage.completion = chunk.usage.completion_tokens ?? 0
      }
      const delta = chunk.choices?.[0]?.delta
      if (!delta) continue
      const think = delta.reasoning_content ?? delta.reasoning
      if (typeof think === "string" && think) {
        result.reasoning += think
        opts.onEvent({ type: "thinking", text: think })
      }
      if (typeof delta.content === "string" && delta.content) {
        result.content += delta.content
        opts.onEvent({ type: "content", text: delta.content })
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0
        const acc = toolAcc.get(idx) ?? { id: "", name: "", args: "" }
        if (tc.id) acc.id = tc.id
        if (tc.function?.name) acc.name = tc.function.name
        if (tc.function?.arguments) acc.args += tc.function.arguments
        toolAcc.set(idx, acc)
      }
    }
  }

  result.toolCalls = [...toolAcc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => ({ id: v.id, name: v.name, arguments: v.args }))
  opts.onEvent({ type: "done", usage: result.usage })
  return result
}
