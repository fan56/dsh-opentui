#!/usr/bin/env bun
/**
 * R3 scratch-only driver — REAL bridge + REAL bridge journal events, driven
 * over the real NDJSON stdio protocol. No registry method is called directly
 * by the harness, no journal row is synthesised, no product source is patched.
 *
 *   bun verify/e2e-flows/r3-hardcap-abort.ts [--out <dir>] [--hard-cap-ms 60] [--abort-cap-ms 3000]
 *
 * Two scenarios share one process but use a fresh `apply()` ctx each:
 *   hardcap — config injection shrinks maxAskWaitMs; an unanswered pending
 *             approval is settled by the registry's real hard-cap timer.
 *   abort   — a REAL `turn.abort` request frame fires the driver AbortSignal,
 *             which reaches `waitForAnswerer.onAbort` -> settleExternal(aborted).
 *
 * The only substituted seam is the host journal STORE: `appendPluginRecord`
 * is mocked to append the verbatim journal event objects emitted by the real
 * registry into a scratch `journal.jsonl`. The bridge, registry, ask answerers,
 * timers, protocol frames and journal event vocabulary are all the real code
 * from packages/bridge/src. The fake ctx mirrors packages/bridge/test's
 * established harness (agent.cancel aborts the turn signal, as the real host
 * driver does). Nothing here touches ~/.dsh, the operator tmux socket, or
 * product semantics.
 *
 * Exit code 0 only when every assertion in both scenarios passes.
 */
import { mock } from 'bun:test'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const argv = process.argv.slice(2)
const opt = (name: string, def: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : def
}
const OUT = resolve(opt('out', mkdtempSync(join(tmpdir(), 'r3-bridge-driver-'))))
const HARD_CAP_MS = Number(opt('hard-cap-ms', '60'))
const ABORT_CAP_MS = Number(opt('abort-cap-ms', '3000'))
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const journalRows: Record<string, any>[] = []
const journalPath = join(OUT, 'journal.jsonl')
// Must be installed BEFORE importing index.ts: resolveAppendPluginRecord()
// resolves this module once, lazily, on the first journal write.
mock.module('@deepseek-ai/dsh-session', () => ({
  appendPluginRecord(_session: unknown, _type: string, event: Record<string, any>) {
    journalRows.push(event)
    appendFileSync(journalPath, `${JSON.stringify(event)}\n`)
  },
}))

const { apply, getAskRegistry } = await import('../../packages/bridge/src/index')
const { DEFAULT_MAX_ASK_WAIT_MS } = await import('../../packages/bridge/src/ask-registry')

let failures = 0
let passes = 0
function check(label: string, ok: boolean, expected: string, actual: unknown) {
  if (ok) { passes++; console.log(`  PASS ${label}`) }
  else {
    failures++
    console.log(`  FAIL ${label}\n       expected: ${expected}\n       actual:   ${JSON.stringify(actual)}`)
  }
}

const STDIO_SWITCH = 'DSH_OPENTUI_BRIDGE_STDIO'
process.env[STDIO_SWITCH] = '1'

type Frame = Record<string, any>

interface Driver {
  send(frame: Frame): void
  reply(id: number | string): Promise<Frame>
  askFrames(type: string): Frame[]
  emitHost(name: string, request: Frame): Promise<any>
  turnSignal: AbortController
  dispose(): void
}

function boot(maxAskWaitMs: number, label: string): Driver {
  const originalWrite = process.stdout.write.bind(process.stdout)
  const frames: string[] = []
  process.stdout.write = ((chunk: any, ...rest: any[]) => {
    const text = String(chunk)
    frames.push(text)
    let parsed: any
    try { parsed = JSON.parse(text.trim()) } catch { /* reporter noise */ }
    const isBridge = parsed && typeof parsed === 'object' && ('ok' in parsed || 'type' in parsed) &&
      ('id' in parsed || 'payload' in parsed || 'result' in parsed || 'error' in parsed)
    return isBridge ? true : originalWrite(chunk, ...rest)
  }) as typeof process.stdout.write

  const stdinListeners: Record<string, Array<(...a: any[]) => void>> = {}
  const fakeStdin = {
    setEncoding() {},
    on(name: string, fn: (...a: any[]) => void) { (stdinListeners[name] ||= []).push(fn); return fakeStdin },
    off(name: string, fn: (...a: any[]) => void) {
      stdinListeners[name] = (stdinListeners[name] || []).filter((f) => f !== fn)
      return fakeStdin
    },
    once(name: string, fn: (...a: any[]) => void) { (stdinListeners[name] ||= []).push(fn); return fakeStdin },
    pause() { return fakeStdin },
    resume() { return fakeStdin },
  }
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true })

  const turnSignal = new AbortController()
  const agent = {
    status: 'idle',
    session: { seq: 0 },
    followup() {},
    steer() {},
    // Real host driver cancels by firing the active turn's AbortSignal.
    cancel() { turnSignal.abort() },
    whenIdle() { return new Promise<void>(() => {}) }, // hold the turn open
  }
  const listeners = new Map<string, Array<(...a: any[]) => any>>()
  let disposeBridge: (() => void) | undefined
  const warns: string[] = []
  const ctx: any = {
    logger: {
      info() {}, debug() {},
      warn(format: unknown, ...params: unknown[]) { warns.push(`${String(format)} ${params.map(String).join(' ')}`) },
      error() {},
    },
    effect(execute: () => () => void) { disposeBridge = execute(); return { dispose: () => disposeBridge?.() } },
    on(name: string, listener: (...a: any[]) => any) {
      const next = [...(listeners.get(name) || []), listener]
      listeners.set(name, next)
      return () => listeners.set(name, next.filter((l) => l !== listener))
    },
    agents: {
      async create() { return { agent, dispose: async () => {} } },
      async resume() { return { agent, dispose: async () => {} } },
      get() { return undefined },
    },
  }

  // R3 injection point: the profile-patch config is the ONLY thing changed
  // between scratch and production. apply() validates it and passes the
  // effective value into the real AskRegistry constructor.
  apply(ctx, { maxAskWaitMs })
  if (getAskRegistry(ctx) === undefined) throw new Error(`${label}: apply() did not register an AskRegistry`)
  console.log(`  · ${label}: injected config.maxAskWaitMs=${maxAskWaitMs} (default ${DEFAULT_MAX_ASK_WAIT_MS})`)
  if (warns.length > 0) console.log(`  · ${label}: construction warns: ${warns.join(' | ')}`)

  const latest = (id: number | string): Frame | undefined => {
    for (let i = frames.length - 1; i >= 0; i--) {
      try {
        const f = JSON.parse(frames[i])
        if (f?.id === id) return f
      } catch { /* noise */ }
    }
    return undefined
  }
  return {
    turnSignal,
    send(frame) {
      for (const fn of stdinListeners['data'] || []) fn(`${JSON.stringify(frame)}\n`)
    },
    async reply(id) {
      const deadline = Date.now() + 2000
      for (;;) {
        const f = latest(id)
        if (f !== undefined) return f
        if (Date.now() > deadline) throw new Error(`${label}: no reply for id=${id}`)
        await sleep(1)
      }
    },
    askFrames(type) {
      const out: Frame[] = []
      for (const line of frames) {
        try { const f = JSON.parse(line); if (f?.type === type) out.push(f) } catch { /* noise */ }
      }
      return out
    },
    emitHost(name, request) {
      return Promise.resolve((listeners.get(name) || [])[0]?.(request, async () => {
        throw new Error('next() must not be reached when the bridge claims the ask')
      }))
    },
    dispose() {
      try { disposeBridge?.() } catch { /* already down */ }
      process.stdout.write = originalWrite
      if (stdinDescriptor) Object.defineProperty(process, 'stdin', stdinDescriptor)
      else delete (process as any).stdin
    },
  }
}

async function startTurn(d: Driver, id: number) {
  d.send({ id, method: 'session.open', params: { mode: 'new' } })
  const opened = await d.reply(id)
  check(`session.open ok (${id})`, opened.ok === true, 'ok:true', opened)
  const sessionId = opened.result?.sessionId as string
  d.send({ id: id + 1, method: 'session.send', params: { text: 'R3 protocol probe' } })
  const sent = await d.reply(id + 1)
  check(`session.send ok (${id + 1})`, sent.ok === true, 'ok:true', sent)
  return { sessionId, turnId: sent.result?.turnId as string }
}

const terminalRows = (eventId: string) => journalRows.filter(
  (r) => r.eventId === eventId && (r.kind === 'ask.cancelled' || r.kind === 'ask.responded'),
)
const askOf = (d: Driver, eventId: string) =>
  d.askFrames('ask.settled').filter((f) => f.payload?.eventId === eventId)

console.log(`R3 scratch driver start ${new Date().toISOString()} — out ${OUT}`)
console.log(`  · real bridge from ${join(REPO, 'packages/bridge/src/index.ts')}; journal ${journalPath}`)

// --- Scenario 1: hard cap via config injection only --------------------------
{
  journalRows.length = 0
  const d = boot(HARD_CAP_MS, 'hardcap')
  try {
    const { sessionId } = await startTurn(d, 1)
    const pending = d.emitHost('approval/request', {
      agent: { session: { id: sessionId } },
      toolName: 'bash', callId: 'r3-hardcap', reason: 'R3 hard cap probe',
      signal: d.turnSignal.signal,
    })
    await sleep(0)
    const request = d.askFrames('ask.request').at(-1)?.payload
    check('hardcap: real ask.request frame emitted', !!request?.eventId, 'eventId string', request)
    const eventId = request.eventId as string
    const result = await Promise.race([pending, sleep(1000).then(() => 'HUNG')])
    check('hardcap: answerer settled', result === 'unavailable', 'unavailable', result)

    const rows = terminalRows(eventId)
    check('hardcap: exactly one terminal journal row', rows.length === 1, '1 row', rows.length)
    check('hardcap: journal settleReason=timeout', rows[0]?.settleReason === 'timeout', 'timeout', rows[0]?.settleReason)
    check('hardcap: journal outcome=unavailable (D6)', rows[0]?.outcome === 'unavailable', 'unavailable', rows[0]?.outcome)
    check('hardcap: journal code=ASK_DEADLINE_EXCEEDED', rows[0]?.code === 'ASK_DEADLINE_EXCEEDED', 'ASK_DEADLINE_EXCEEDED', rows[0]?.code)
    check('hardcap: journal kind=ask.cancelled', rows[0]?.kind === 'ask.cancelled', 'ask.cancelled', rows[0]?.kind)
    check('hardcap: journal source=timeout', rows[0]?.source === 'timeout', 'timeout', rows[0]?.source)
    check('hardcap: no aborted terminal', journalRows.filter((r) => r.eventId === eventId && r.settleReason === 'aborted').length === 0, '0 rows', journalRows.filter((r) => r.settleReason === 'aborted').length)
    const frames = askOf(d, eventId)
    check('hardcap: exactly one ask.settled frame', frames.length === 1, '1 frame', frames.length)
    check('hardcap: frame reason=timeout', frames[0]?.payload?.reason === 'timeout', 'timeout', frames[0]?.payload?.reason)
    check('hardcap: ask.cancel reason=deadline', d.askFrames('ask.cancel').some((f) => f.payload?.eventId === eventId && f.payload?.reason === 'deadline'), 'ask.cancel{reason:deadline}', d.askFrames('ask.cancel').map((f) => f.payload?.reason))
  } finally { d.dispose() }
}

// --- Scenario 2: pending abort via a REAL turn.abort protocol frame ----------
{
  journalRows.length = 0
  const d = boot(ABORT_CAP_MS, 'abort')
  try {
    const { sessionId, turnId } = await startTurn(d, 10)
    void d.emitHost('approval/request', {
      agent: { session: { id: sessionId } },
      toolName: 'bash', callId: 'r3-abort', reason: 'R3 abort probe',
      signal: d.turnSignal.signal,
    })
    await sleep(0)
    const request = d.askFrames('ask.request').at(-1)?.payload
    check('abort: real ask.request frame emitted', !!request?.eventId, 'eventId string', request)
    const eventId = request.eventId as string
    check('abort: no premature terminal', terminalRows(eventId).length === 0, '0 rows', terminalRows(eventId).length)

    // The ONLY abort trigger: a real bridge protocol frame (not a registry call).
    d.send({ id: 12, method: 'turn.abort', params: { turnId } })
    const reply = await d.reply(12)
    check('abort: turn.abort frame ok', reply.ok === true && reply.result?.aborted === true, 'ok:true aborted:true', reply)
    await sleep(80) // well inside ABORT_CAP_MS

    const rows = terminalRows(eventId)
    check('abort: exactly one terminal journal row', rows.length === 1, '1 row', rows.length)
    check('abort: journal settleReason=aborted', rows[0]?.settleReason === 'aborted', 'aborted', rows[0]?.settleReason)
    check('abort: journal outcome=cancelled', rows[0]?.outcome === 'cancelled', 'cancelled', rows[0]?.outcome)
    check('abort: no timeout terminal for same id', rows.filter((r) => r.settleReason === 'timeout').length === 0, '0 rows', rows.map((r) => r.settleReason))
    check('abort: no ASK_DEADLINE_EXCEEDED code', rows[0]?.code === undefined, 'undefined', rows[0]?.code)
    const frames = askOf(d, eventId)
    check('abort: exactly one ask.settled frame', frames.length === 1, '1 frame', frames.length)
    check('abort: frame reason=aborted', frames[0]?.payload?.reason === 'aborted', 'aborted', frames[0]?.payload?.reason)
  } finally { d.dispose() }
}

writeFileSync(join(OUT, 'assert-summary.json'), JSON.stringify({ passes, failures, at: new Date().toISOString() }, null, 2) + '\n')
console.log(`\nR3 scratch driver: ${passes} PASS, ${failures} FAIL — ${failures === 0 ? 'PASS' : 'FAIL'}`)
process.exitCode = failures === 0 ? 0 : 1
