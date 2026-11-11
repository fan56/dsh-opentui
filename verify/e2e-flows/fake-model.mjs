#!/usr/bin/env node
// Local OpenAI-compatible fake model for the e2e flow suite.
//
//   node fake-model.mjs --port 0 --log /tmp/requests.jsonl
//     [--chunk-ms 45] [--slow-ticks 16] [--slow-ms 700]
//
// Prints `FAKE_PORT=<port>` on stdout once listening, then serves
// POST /v1/chat/completions (streaming SSE or a complete JSON body for
// non-streaming probes) and GET /healthz.
//
// Phase selection is keyed on the request BODY, never arrival order. Markers
// live in the user messages; the LAST user message carrying a marker wins:
//
//   E2E_SLOW       — a long slow stream (slowTicks * slowMs) ending in
//                    `E2E-SLOW-DONE`; gives steer/queue a delivery window
//   E2E_STEER_TEXT — injected mid-turn: closes the turn with an ack
//   E2E_QUEUE_TEXT — queued prompt: its own turn, ack
//   E2E_FLUSH_TEXT — flushed prompt: its own turn, ack
//   E2E_TOOL       — first request: one real bash-family tool_call
//                    (`echo E2E-TOOL-RESULT-OK`); after the tool message
//                    round-trips: `E2E-TOOL-DONE`
//   E2E_SINGLE     — a short streamed reply
//   anything else  — `E2E-ACK:<last user line>` (stray/title/probe traffic)
//
// Tool arguments are calibrated from the `tools` array the HOST sends; the
// scheme is real (a call the agent loop executes), not a canned transcript
// row. The tool name is discovered, never guessed.
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const PORT = Number(arg('port', '0'))
const LOG = arg('log', '')
const CHUNK_MS = Number(arg('chunk-ms', '45'))
const SLOW_TICKS = Number(arg('slow-ticks', '16'))
const SLOW_MS = Number(arg('slow-ms', '700'))

const logReq = (entry) => {
  if (!LOG) return
  try { appendFileSync(LOG, JSON.stringify(entry) + '\n') } catch {}
}

const splitChunks = (text, max = 20) => {
  const words = text.split(/(\s+)/)
  const out = []
  let cur = ''
  for (const w of words) {
    if ((cur + w).length >= max && cur) { out.push(cur); cur = w }
    else cur += w
  }
  if (cur) out.push(cur)
  return out
}

const jsonChunk = (id, model, delta, finish = null) =>
  `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`

const streamParts = (res, id, model, parts, intervalMs) =>
  new Promise((resolve) => {
    let i = 0
    const tick = () => {
      if (res.writableEnded) return resolve()
      const p = parts[i++]
      if (!p) { res.write('data: [DONE]\n\n'); res.end(); return resolve() }
      res.write(jsonChunk(id, model, p.delta, p.finish ?? null))
      setTimeout(tick, intervalMs)
    }
    tick()
  })

const streamText = (res, id, model, text, { intervalMs = CHUNK_MS, end = true } = {}) => {
  const parts = splitChunks(text).map((p) => ({ delta: { content: p } }))
  if (end) parts.push({ delta: {}, finish: 'stop' })
  return streamParts(res, id, model, parts, intervalMs)
}

// One tool call per response: index+id+name first, arguments in fragments,
// then finish_reason:"tool_calls" — the shape the openai-completions adapter
// accumulates.
const streamToolCall = (res, id, model, call, { intervalMs = 40 } = {}) => {
  const args = JSON.stringify(call.args)
  const parts = [
    { delta: { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: '' } }] } },
  ]
  for (let i = 0; i < args.length; i += 24) {
    parts.push({ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + 24) } }] } })
  }
  parts.push({ delta: {}, finish: 'tool_calls' })
  return streamParts(res, id, model, parts, intervalMs)
}

const messageText = (m) => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? ''))

const lastUserText = (messages = []) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return messageText(messages[i])
  }
  return ''
}

/** The last user message that carries one of our markers. */
const lastMarker = (messages, markers) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role !== 'user') continue
    const text = messageText(m)
    const hit = markers.find((k) => text.includes(k))
    if (hit) return { key: hit, text }
  }
  return undefined
}

const pickBash = (tools = []) => {
  const names = tools.map((t) => t?.function?.name ?? t?.name ?? '').filter(Boolean)
  return names.find((n) => /bash|shell|command|exec|terminal|pwsh/i.test(n))
}

const MARKERS = ['E2E_SLOW', 'E2E_STEER_TEXT', 'E2E_QUEUE_TEXT', 'E2E_FLUSH_TEXT', 'E2E_TOOL', 'E2E_SINGLE']

const server = createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }).end('ok'); return }
  if (!req.url?.startsWith('/v1/chat/completions') && !req.url?.startsWith('/chat/completions')) {
    res.writeHead(404).end()
    return
  }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', async () => {
    let payload = {}
    try { payload = JSON.parse(body || '{}') } catch {}
    const messages = Array.isArray(payload.messages) ? payload.messages : []
    const prompt = lastUserText(messages)
    const toolNames = (payload.tools ?? []).map((t) => t?.function?.name ?? t?.name ?? '').filter(Boolean)
    const hasToolResult = messages.some((m) => m?.role === 'tool')
    const marker = lastMarker(messages, MARKERS)
    const isTitleReq = /generate the session title/i.test(prompt)
    const model = payload.model ?? 'demo-1'
    const id = 'chatcmpl-e2e-' + Date.now().toString(36)
    const phase = isTitleReq ? 'title' : marker?.key ?? 'ack'
    logReq({
      t: Date.now(), phase, prompt: prompt.slice(0, 200), stream: payload.stream !== false,
      toolNames, hasToolResult, msgs: messages.length,
      marker: marker?.text.slice(0, 200),
    })

    if (payload.stream === false) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }))
      return
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })

    if (isTitleReq) { await streamText(res, id, model, 'e2e session'); return }

    if (phase === 'E2E_TOOL') {
      if (hasToolResult) {
        await streamText(res, id, model, 'E2E-TOOL-DONE — the bash tool ran and its result came back.')
        return
      }
      const bash = pickBash(payload.tools)
      if (!bash) {
        await streamText(res, id, model, 'E2E-TOOL-NO-BASH — the host sent no bash-family tool.')
        return
      }
      await streamToolCall(res, id, model, {
        id: 'call_e2e_tool_1',
        name: bash,
        args: { command: 'echo E2E-TOOL-RESULT-OK', description: 'e2e echo probe' },
      })
      return
    }

    if (phase === 'E2E_SLOW') {
      const parts = []
      for (let i = 1; i <= SLOW_TICKS; i++) parts.push({ delta: { content: `E2E-SLOW-TICK-${i} ` } })
      parts.push({ delta: { content: 'E2E-SLOW-DONE' } })
      parts.push({ delta: {}, finish: 'stop' })
      await streamParts(res, id, model, parts, SLOW_MS)
      return
    }

    if (phase === 'E2E_SINGLE') {
      await streamText(res, id, model, 'E2E-SINGLE-REPLY — streamed by the local fake model in chunks.')
      return
    }

    const ack = `E2E-ACK:${(marker?.text ?? prompt).replace(/\s+/g, ' ').trim().slice(0, 80)}`
    await streamText(res, id, model, ack)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`FAKE_PORT=${server.address()?.port}`)
  console.log(`FAKE_PID=${process.pid}`)
})
