#!/usr/bin/env node
// R6-029 dedicated local mock-llm — ADDITIVE loop subphase, disjoint markers.
//
// This is NOT the shared e2e/lib/mock-llm.mjs: the 0.29 wrap-up smoke needs a
// looper child that (a) emits a MULTI-LINE bash tool output for the Ctrl+G
// transcript and (b) YIELDS when the real maxRounds wrap-up is steered into
// it. It keeps the same OpenAI-compatible SSE wire and the same readiness
// handshake (`ready http://127.0.0.1:<port>`) the R6 driver already gates on.
//
//   node r6-029-mock.mjs --port 0 [--loop-delay-ms 1200]
//
// Phases (keyed on the request body, never arrival order):
//   E2E029_PARENT  -> real use_agent tool call to the by-name r6-029-looper;
//                    after the tool result returns -> E2E-029-PARENT-DONE.
//   E2E029_CHILD   -> every request emits a real bash tool call whose output
//                    spans 3 lines. The round counter is logged so the driver
//                    can prove the child was still running when Ctrl+G fired.
//   wrap-up steer  -> when the shipped wrapupMessage ("Round limit reached (")
//                    lands in the CHILD's own prompt, the child STOPS looping
//                    and streams E2E-029-WRAP-DONE (soft stop, grace 0).
//   anything else  -> short ack (stray/title/probe traffic).
import { createServer } from 'node:http'

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const PORT = Number(arg('port', '0'))
const LOOP_DELAY = Number(arg('loop-delay-ms', '1200'))
const HOST = '127.0.0.1'

const PARENT_KEY = 'E2E029_PARENT'
const CHILD_KEY = 'E2E029_CHILD'
const CHILD_AGENT = 'r6-029-looper'
const WRAP_TEXT = 'Round limit reached ('
const TOOL_LINES = ['E2E-029-TOOL-L1', 'E2E-029-TOOL-L2', 'E2E-029-TOOL-L3']
const WRAP_DONE = 'E2E-029-WRAP-DONE — wrap-up received, summarizing and stopping without further tools.'
const PARENT_DONE = 'E2E-029-PARENT-DONE — the looper child settled and its result came back.'
const CHILD_PROMPT = `${CHILD_KEY}: keep calling the bash tool with the prepared multi-line printf until a wrap-up arrives, then summarize and stop.`
let childRound = 0
let dispatched = false

const log = (line) => console.log(line)

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

const streamText = (res, id, model, text, end = 'stop') => {
  const parts = text.split(/(\s+)/).filter((s) => s !== '').map((p) => ({ delta: { content: p } }))
  parts.push({ delta: {}, finish: end })
  return streamParts(res, id, model, parts, 40)
}

const streamToolCall = (res, id, model, call) => {
  const args = JSON.stringify(call.args)
  const parts = [
    { delta: { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: '' } }] } },
  ]
  for (let i = 0; i < args.length; i += 24) {
    parts.push({ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + 24) } }] } })
  }
  parts.push({ delta: {}, finish: 'tool_calls' })
  return streamParts(res, id, model, parts, 25)
}

/** Marker must be in the request's OWN (non-tool) prompt, not a tool snapshot. */
const markerInOwnPrompt = (messages, key) => messages.some((m) => {
  if (m?.role === 'tool') return false
  const text = typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '')
  return text.includes(key)
})

const toolNames = (tools = []) => tools.map((t) => t?.function?.name ?? t?.name ?? '').filter(Boolean)
const pickBash = (tools = []) => {
  const names = toolNames(tools)
  return names.find((n) => /bash|shell|command|exec|terminal/i.test(n)) ?? names[0] ?? 'bash'
}
/**
 * Delegation tool selection — EXACT FIRST, schema-aware.
 *
 * Root cause of the 0-round run: the old regex `find(/use_agent|subagent|…/)`
 * picked the NATIVE `subagent` tool (whose catalog order precedes the
 * companion's `use_agent`) but supplied the use_agent shape `{agent,prompt}`.
 * The native tool requires `agent_id` + `description`, so the host rejected the
 * call with INVALID_ARGS and the child was never created (childRounds=0).
 *
 * Fix: prefer the by-name roster tool `use_agent` EXACTLY (R6 shared-mock
 * parity, `{agent,prompt}`). Only if it is genuinely absent fall back to the
 * native family WITH its own schema (`agent_id`,`description`). Never mix the
 * two shapes. The chosen name + schema is logged on every selected call.
 */
const pickDelegate = (tools = []) => {
  const names = toolNames(tools)
  const exact = names.find((n) => n === 'use_agent')
  if (exact) return { name: exact, schema: 'use_agent{agent,prompt}', args: { agent: CHILD_AGENT, prompt: CHILD_PROMPT } }
  const native = names.find((n) => /^(subagent|subagent_fork|spawn_agent|delegate[a-z_]*)$/i.test(n))
  if (native) {
    return {
      name: native, schema: 'native{agent_id,prompt,description}',
      args: { agent_id: CHILD_AGENT, prompt: CHILD_PROMPT, description: 'e2e 029 looper child dispatch' },
    }
  }
  // No discovery available: keep the literal roster shape (R6 parity) and
  // mark it in the log so a catalog regression is visible instead of silent.
  return {
    name: 'use_agent', schema: 'use_agent{agent,prompt}:NO-CATALOG-FALLBACK',
    args: { agent: CHILD_AGENT, prompt: CHILD_PROMPT },
  }
}

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    log(`req path=/healthz phase=health model=none effort=none toolNames=[]`)
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok'); return
  }
  if (!req.url?.startsWith('/v1/chat/completions') && !req.url?.startsWith('/chat/completions')) {
    log(`req path=${req.url} phase=route-404 model=none effort=none toolNames=[]`)
    res.writeHead(404).end()
    return
  }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', async () => {
    let payload = {}
    try { payload = JSON.parse(body || '{}') } catch { /* keep sane fallback */ }
    const messages = Array.isArray(payload.messages) ? payload.messages : []
    const hasToolResult = messages.some((m) => m?.role === 'tool')
    const isChild = markerInOwnPrompt(messages, CHILD_KEY)
    const isParent = markerInOwnPrompt(messages, PARENT_KEY)
    const gotWrapup = isChild && messages.some((m) => {
      const text = typeof m?.content === 'string' ? m.content : ''
      return text.includes(WRAP_TEXT)
    })
    const model = payload.model ?? 'demo-1'
    const id = `chatcmpl-029-${Date.now().toString(36)}`
    const phase = gotWrapup ? '029-wrapup-settled'
      : isChild ? '029-loop'
      : isParent ? (hasToolResult ? '029-final' : '029-dispatch')
      : 'ack'
    // EVERY inbound chat request is logged with the wire facts needed to
    // diagnose a 0-round run: model, reasoning effort, the FULL tool catalog,
    // the resolved phase, marker ownership and tool-result presence.
    const effort = payload.reasoningEffort ?? payload.reasoning_effort ?? payload.effort ?? 'unset'
    log(`req model=${model} effort=${String(effort)} phase=${phase} `
      + `toolNames=[${toolNames(payload.tools).join(',')}] msgs=${messages.length} `
      + `hasToolResult=${hasToolResult} ownChild=${isChild} ownParent=${isParent} wrapup=${gotWrapup}`)

    res.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive',
    })

    if (phase === '029-dispatch') {
      dispatched = true
      const delegate = pickDelegate(payload.tools)
      log(`phase=029-dispatch delegate=${delegate.name} schema=${delegate.schema} `
        + `agent=${CHILD_AGENT} childMarker=${CHILD_KEY} args=${JSON.stringify(delegate.args)}`)
      await streamToolCall(res, id, model, {
        id: 'call-e2e-029-dispatch', name: delegate.name, args: delegate.args,
      })
      return
    }
    if (phase === '029-loop' || phase === '029-wrapup-settled') {
      childRound += 1
      log(`phase=${phase} round=${childRound} wrapup=${gotWrapup}`)
      // Surface a rejected / failed tool result immediately: a child bash the
      // approval gate rejected produces NO printf output, which otherwise
      // looks like a transcript cap bug. This is a diagnosis line, never a
      // fabricated success.
      const badResults = messages.filter((m) => m?.role === 'tool').filter((m) => {
        const t = typeof m.content === 'string' ? m.content : JSON.stringify(m?.content ?? '')
        return m.isError === true || /INVALID_ARGS|rejected|approval/i.test(t)
      })
      if (badResults.length > 0) {
        log(`029-child-tool-result ERROR round=${childRound} count=${badResults.length} `
          + `snippet=${JSON.stringify(badResults[0]?.content ?? '').slice(0, 240)}`)
      }
      if (gotWrapup) { await streamText(res, id, model, WRAP_DONE); return }
      await sleep(LOOP_DELAY)
      const bash = pickBash(payload.tools)
      log(`029-child-tool name=${bash} round=${childRound}`)
      const command = `printf '${TOOL_LINES[0]}\\n${TOOL_LINES[1]}\\n${TOOL_LINES[2]}\\n'`
      await streamToolCall(res, id, model, {
        id: `call-e2e-029-loop-${childRound}`,
        name: bash,
        args: { command, description: `e2e 029 multi-line tool output probe round ${childRound}` },
      })
      return
    }
    if (phase === '029-final') {
      log(`phase=029-final dispatched=${dispatched} childRounds=${childRound}`)
      await streamText(res, id, model, PARENT_DONE)
      return
    }
    await streamText(res, id, model, `E2E-029-ACK:${(messages.at(-1)?.content ?? '').toString().slice(0, 60)}`)
  })
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
server.listen(PORT, HOST, () => {
  log(`ready http://${HOST}:${server.address()?.port}`)
  log(`fake_pid=${process.pid}`)
})
