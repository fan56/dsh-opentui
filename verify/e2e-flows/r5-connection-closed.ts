#!/usr/bin/env bun
/**
 * R5 scratch-only driver — bridge stdin EOF teardown on the REAL bridge source.
 *
 *   bun verify/e2e-flows/r5-connection-closed.ts [--out <dir>]
 *   bun verify/e2e-flows/r5-connection-closed.ts --resume-last [--journal <path>] [--out <dir>]
 *
 * EOF arm (default):
 *   - apply() is loaded directly from packages/bridge/src/index.ts; every frame
 *     travels the real NDJSON stdio protocol (session.open / session.send /
 *     host approval/request waterfall / ask registry / journal writer).
 *   - TWO pending approval asks are raised in one in-flight turn; then the ONLY
 *     teardown trigger is a stdin 'end' edge. NO session.close, NO turn.abort,
 *     NO UI Escape, NO signal, NO direct registry method call.
 *   - The process is kept alive until the scratch journal file has the terminal
 *     rows on disk (bounded poll). No process.exit truncates the flush.
 *   - Assertions read the scratch journal FILE, not an in-memory mirror: each
 *     pending id has exactly one terminal row with settleReason=connection-closed
 *     and zero ask.settled / ask.cancel live frames for that id.
 *
 * --resume-last arm:
 *   - Takes the journal rows produced by the EOF arm, projects them into the
 *     `{seq,type,payload}` shape a `journal.replay` reply carries, and calls the
 *     REAL deriveAskOutcomeNotice (the same derivation the seam uses after a
 *     `--resume-last` restore). Asserts the notice id / text / session per id.
 *   - This is a projection-level replay of real journal rows through real
 *     source; it does not boot the full TUI (the scratch harness has no host
 *     session store), which is declared in the prereg's NOT RUN section.
 *
 * The only substituted seam is the host journal STORE: appendPluginRecord is
 * mocked to append the verbatim event objects emitted by the real registry to
 * a scratch journal.jsonl. Nothing here touches ~/.dsh, the operator tmux
 * socket, the product exit path, or R3's assertions.
 *
 * Exit code 0 only when every assertion in the selected arm passes.
 */
import { mock } from 'bun:test'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
const RESUME = argv.includes('--resume-last')
const OUT = resolve(opt('out', mkdtempSync(join(tmpdir(), 'r5-eof-driver-'))))
const JOURNAL_PATH = resolve(opt('journal', join(OUT, 'journal.jsonl')))
const FLUSH_TIMEOUT_MS = Number(opt('flush-timeout-ms', '2000'))
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

let failures = 0
let passes = 0
function check(label: string, ok: boolean, expected: string, actual: unknown) {
  if (ok) { passes++; console.log(`  PASS ${label}`) }
  else {
    failures++
    console.log(`  FAIL ${label}\n       expected: ${expected}\n       actual:   ${JSON.stringify(actual)}`)
  }
}

type Frame = Record<string, any>

function readJournalFile(path: string): Frame[] {
  if (!existsSync(path)) return []
  const rows: Frame[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try { rows.push(JSON.parse(line)) } catch { /* skip trailing partial line */ }
  }
  return rows
}

// ---------------------------------------------------------------------------
// --resume-last arm: real notice derivation over the EOF arm's journal rows.
// ---------------------------------------------------------------------------
if (RESUME) {
  console.log(`R5 --resume-last notice replay start ${new Date().toISOString()} — journal ${JOURNAL_PATH}`)
  const { askPluginRecordType } = await import('../../packages/bridge/src/ask-journal')
  const { deriveAskOutcomeNotice } = await import('../../packages/shell/src/client/ask-outcome')

  const rows = readJournalFile(JOURNAL_PATH)
  const terminals = rows.filter(
    (r) => r.settleReason === 'connection-closed' && (r.kind === 'ask.cancelled' || r.kind === 'ask.responded'),
  )
  check('resume: journal readable with connection-closed terminals', terminals.length >= 2, '>=2 terminal rows', terminals.length)

  // Mirror journal.replay's {seq,type,payload} rows. seq is the 1-based index
  // of the appended journal row (the host assigns the next seq on append).
  const seqOf = (row: Frame) => rows.indexOf(row) + 1
  const wrongText = ['已收到该请求的回答', '等待该请求的回答超时', '该请求被中止', '回合结束时该请求已取消', '会话关闭时该请求已取消']
  for (const row of terminals) {
    const id = String(row.eventId)
    const replay = { seq: seqOf(row), type: askPluginRecordType(row.kind), payload: row }
    check(`resume ${id}: journal.replay row type`, replay.type.startsWith('plugin:opentui/ask/'), 'plugin:opentui/ask/*', replay.type)
    const notice = deriveAskOutcomeNotice({
      eventId: row.eventId,
      sessionId: row.sessionId,
      anchorSeq: replay.seq,
      settleReason: row.settleReason,
      journalKind: row.kind,
      askKind: row.askKind,
      outcome: row.outcome,
      source: row.source,
      ...(row.childSessionId !== undefined ? { childSessionId: row.childSessionId } : {}),
    })
    check(`resume ${id}: notice derived`, notice !== undefined, 'AskOutcomeNotice', notice)
    check(`resume ${id}: notice id`, notice?.id === `ask-outcome:${id}`, `ask-outcome:${id}`, notice?.id)
    check(`resume ${id}: notice text = connection-closed`, notice?.text === '连接关闭时该请求已取消', '连接关闭时该请求已取消', notice?.text)
    check(`resume ${id}: notice scoped to session`, notice?.sessionId === row.sessionId, row.sessionId, notice?.sessionId)
    check(`resume ${id}: notice anchored to journal seq`, notice?.anchorSeq === replay.seq, replay.seq, notice?.anchorSeq)
    check(
      `resume ${id}: no divergent (live/timeout/abort/turn/session) notice text`,
      notice !== undefined && !wrongText.includes(notice.text),
      'none of ' + JSON.stringify(wrongText),
      notice?.text,
    )
  }

  writeFileSync(join(OUT, 'assert-summary-replay.json'), JSON.stringify({ passes, failures, journal: JOURNAL_PATH, at: new Date().toISOString() }, null, 2) + '\n')
  console.log(`\nR5 --resume-last replay: ${passes} PASS, ${failures} FAIL — ${failures === 0 ? 'PASS' : 'FAIL'}`)
  process.exitCode = failures === 0 ? 0 : 1
} else {
  // Must be installed BEFORE importing index.ts: resolveAppendPluginRecord()
  // resolves this module once, lazily, on the first journal write.
  mock.module('@deepseek-ai/dsh-session', () => ({
    appendPluginRecord(_session: unknown, _type: string, event: Record<string, any>) {
      appendFileSync(JOURNAL_PATH, `${JSON.stringify(event)}\n`)
    },
  }))

  const { apply, getAskRegistry } = await import('../../packages/bridge/src/index')

  const STDIO_SWITCH = 'DSH_OPENTUI_BRIDGE_STDIO'
  process.env[STDIO_SWITCH] = '1'

  interface Driver {
    send(frame: Frame): void
    reply(id: number | string): Promise<Frame>
    askFrames(type: string): Frame[]
    emitHost(name: string, request: Frame): Promise<any>
    fireStdinEOF(): void
    sentMethods(): string[]
    dispose(): void
  }

  function boot(label: string): Driver {
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

    // Same fake stdin seam as the R3 harness, with one addition: fireStdinEOF()
    // emits the single 'end' edge a real stdin EOF produces. 'close' is NOT
    // fired (eofSeen dedupes both in the product); no other teardown trigger.
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

    const agent = {
      status: 'idle',
      session: { seq: 0 },
      followup() {},
      steer() {},
      cancel() { /* R5: never called — no turn.abort in this fixture */ },
      whenIdle() { return new Promise<void>(() => {}) }, // hold the turn open
    }
    const listeners = new Map<string, Array<(...a: any[]) => any>>()
    let disposeBridge: (() => void) | undefined
    const methods: string[] = []
    const ctx: any = {
      logger: { info() {}, debug() {}, warn() {}, error() {} },
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

    // No config injection: the product's default 1h hard cap stays armed.
    // EOF must win before any timeout, so a timeout terminal is a real FAIL.
    apply(ctx, {})
    if (getAskRegistry(ctx) === undefined) throw new Error(`${label}: apply() did not register an AskRegistry`)

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
      send(frame) {
        if (typeof frame.method === 'string') methods.push(frame.method)
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
      fireStdinEOF() {
        // The single real EOF edge. The product registers onEnd on both 'end'
        // and 'close' and guards with eofSeen; one 'end' is the faithful edge.
        for (const fn of [...(stdinListeners['end'] || [])]) fn()
      },
      sentMethods() { return [...methods] },
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
    d.send({ id: id + 1, method: 'session.send', params: { text: 'R5 stdin EOF teardown probe' } })
    const sent = await d.reply(id + 1)
    check(`session.send ok (${id + 1})`, sent.ok === true, 'ok:true', sent)
    return { sessionId, turnId: sent.result?.turnId as string }
  }

  async function waitJournalRows(expected: number): Promise<Frame[]> {
    const deadline = Date.now() + FLUSH_TIMEOUT_MS
    for (;;) {
      const rows = readJournalFile(JOURNAL_PATH)
      const terminals = rows.filter((r) => r.settleReason === 'connection-closed' &&
        (r.kind === 'ask.cancelled' || r.kind === 'ask.responded'))
      if (terminals.length >= expected) return rows
      if (Date.now() > deadline) return rows
      await sleep(10)
    }
  }

  console.log(`R5 EOF scratch driver start ${new Date().toISOString()} — out ${OUT}`)
  console.log(`  · real bridge from ${join(REPO, 'packages/bridge/src/index.ts')}; journal ${JOURNAL_PATH}`)
  console.log('  · trigger: stdin "end" ONLY (no session.close / turn.abort / signal / registry call)')

  const d = boot('r5-eof')
  try {
    const { sessionId } = await startTurn(d, 1)

    // Two pending asks in the same live turn -> two distinct eventIds.
    const pendings: Array<Promise<any>> = []
    for (const callId of ['r5-eof-ask-1', 'r5-eof-ask-2']) {
      pendings.push(d.emitHost('approval/request', {
        agent: { session: { id: sessionId } },
        toolName: 'bash', callId, reason: `R5 EOF teardown probe ${callId}`,
      }))
    }
    await sleep(0)
    const requests = d.askFrames('ask.request').map((f) => f.payload)
    check('eof: two real ask.request frames emitted', requests.length === 2, '2 frames', requests.length)
    const eventIds = requests.map((r) => r.eventId as string)
    check('eof: two distinct pending eventIds', new Set(eventIds).size === 2 && eventIds.every((x) => typeof x === 'string' && x !== ''), '2 distinct ids', eventIds)
    check('eof: no terminal before stdin EOF', d.askFrames('ask.settled').length === 0, '0 ask.settled frames', d.askFrames('ask.settled').length)

    // The ONLY teardown trigger: close bridge stdin.
    d.fireStdinEOF()

    // Keep the process alive until the scratch journal has the terminal rows.
    const rows = await waitJournalRows(eventIds.length)

    const answerResults = await Promise.race([
      Promise.all(pendings),
      sleep(500).then(() => 'HUNG'),
    ])
    check('eof: both host answerers settled by teardown', Array.isArray(answerResults) && answerResults.every((v) => v === 'cancelled'), "['cancelled','cancelled']", answerResults)

    for (const id of eventIds) {
      const terminals = rows.filter((r) => r.eventId === id && (r.kind === 'ask.cancelled' || r.kind === 'ask.responded'))
      check(`eof ${id}: exactly one terminal journal row (file read)`, terminals.length === 1, '1 row', terminals.length)
      check(`eof ${id}: journal settleReason=connection-closed`, terminals[0]?.settleReason === 'connection-closed', 'connection-closed', terminals[0]?.settleReason)
      check(`eof ${id}: journal outcome=cancelled`, terminals[0]?.outcome === 'cancelled', 'cancelled', terminals[0]?.outcome)
      check(`eof ${id}: journal kind=ask.cancelled`, terminals[0]?.kind === 'ask.cancelled', 'ask.cancelled', terminals[0]?.kind)
      check(`eof ${id}: journal source=teardown`, terminals[0]?.source === 'teardown', 'teardown', terminals[0]?.source)
      check(`eof ${id}: no timeout/aborted/answered terminal`, rows.filter((r) => r.eventId === id && ['timeout', 'aborted', 'answered'].includes(r.settleReason)).length === 0, '0 rows', rows.filter((r) => r.eventId === id && ['timeout', 'aborted', 'answered'].includes(r.settleReason)).map((r) => r.settleReason))
      check(`eof ${id}: one ask.requested row`, rows.filter((r) => r.eventId === id && r.kind === 'ask.requested').length === 1, '1 row', rows.filter((r) => r.eventId === id && r.kind === 'ask.requested').length)

      // No live terminal frame for this batch: writeFrame short-circuits once
      // `closing` is true, so teardown settles the journal silently.
      const settledFrames = d.askFrames('ask.settled').filter((f) => f.payload?.eventId === id)
      const cancelFrames = d.askFrames('ask.cancel').filter((f) => f.payload?.eventId === id)
      check(`eof ${id}: no ask.settled live frame`, settledFrames.length === 0, '0 frames', settledFrames.length)
      check(`eof ${id}: no ask.cancel live frame`, cancelFrames.length === 0, '0 frames', cancelFrames.length)
    }

    const methods = d.sentMethods()
    check('eof: no session.close frame sent', methods.filter((m) => m === 'session.close').length === 0, '0 occurrences', methods.filter((m) => m === 'session.close'))
    check('eof: no turn.abort frame sent', methods.filter((m) => m === 'turn.abort').length === 0, '0 occurrences', methods.filter((m) => m === 'turn.abort'))
    check('eof: only session.open/session.send frames sent', methods.every((m) => m === 'session.open' || m === 'session.send'), 'open/send only', methods)
  } finally {
    d.dispose()
  }

  writeFileSync(join(OUT, 'assert-summary.json'), JSON.stringify({ passes, failures, journal: JOURNAL_PATH, at: new Date().toISOString() }, null, 2) + '\n')
  console.log(`\nR5 EOF scratch driver: ${passes} PASS, ${failures} FAIL — ${failures === 0 ? 'PASS' : 'FAIL'}`)
  console.log(`replay: bun ${join(HERE, 'r5-connection-closed.ts')} --resume-last --journal ${JOURNAL_PATH} --out ${OUT}`)
  process.exitCode = failures === 0 ? 0 : 1
}
