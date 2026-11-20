/**
 * 024 unified E2E — bridge-stdio probe for the handshake/degrade, session
 * (incl. multi-session sessionId isolation), push/event, and model capability
 * families.
 *
 *   DSH_HOME=<provisioned scratch home> node e2e/families/lib/bridge-families.mjs [outDir]
 *
 * Drives the real in-process bridge over NDJSON stdio (framed JSON, the same
 * contract as scripts/real-client-gate.sh's bridge-probe). One child host per
 * run, all writes stay inside the caller's scratch DSH_HOME. Prints one
 * `PASS|FAIL <family>:<id> <detail>` line per assertion and a final summary;
 * exits non-zero if any assertion fails.
 *
 * Flaky law (024 E2E rework): every wall-clock window is derived from a single
 * constant + poll interval (no magic sleeps); negative cases are driven by
 * fault injection (deliberately-unwired CapIR ids / closing sessions), never by
 * weakening an assertion. No PNG / visual model — frames are numeric JSONL.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HOME = process.env.DSH_HOME
if (!HOME) { console.error('bridge-families: DSH_HOME is required (a provisioned scratch home)'); process.exit(2) }
const OUT = process.argv[2] || join(HOME, 'bridge-families')
mkdirSync(OUT, { recursive: true })

// --- single source of truth for every wall-clock window ---------------------
const BOOT_MS = Number(process.env.E2E_BRIDGE_BOOT_MS || 10000)     // host ready
const REPLY_MS = Number(process.env.E2E_BRIDGE_REPLY_MS || 10000)   // one reply
const POLL_MS = Number(process.env.E2E_POLL_MS || 100)              // poll cadence
const EXIT_WAIT_MS = Number(process.env.E2E_EXIT_WAIT_MS || 5000)   // child exit after SIGTERM
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const child = spawn('dsh', ['--profile', 'opentui-inproc'], {
  env: { ...process.env, DSH_HOME: HOME, DSH_OPENTUI_BRIDGE_STDIO: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let buf = '', err = ''
const replies = new Map()
const events = []
const seen = new Set()
const jsonl = join(OUT, 'bridge-stdio.jsonl')
writeFileSync(jsonl, '')
child.stdout.on('data', (c) => {
  buf += c.toString()
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
    if (!line.startsWith('{')) continue
    let j
    try { j = JSON.parse(line) } catch { continue }
    if (!seen.has(line)) { seen.add(line); appendFileSync(jsonl, line + '\n') }
    if ('id' in j) replies.set(String(j.id), j)
    else if (j.type === 'cap.event') events.push(j.payload)
  }
})
child.stderr.on('data', (c) => { err += c.toString() })

let nextId = 1
function send(method, params = {}) {
  const id = nextId++
  child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
  return String(id)
}
async function waitReply(id, ms = REPLY_MS) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (replies.has(id)) return replies.get(id)
    await sleep(POLL_MS)
  }
  return undefined
}
const asArray = (r) => Array.isArray(r) ? r
  : (Array.isArray(r?.items) ? r.items : (Array.isArray(r?.sessions) ? r.sessions : null))
const sid = (s) => s.sessionId || s.id || s.session

const results = []
const logFile = join(OUT, 'bridge-families.log')
const emit = (line) => { process.stdout.write(line + '\n'); appendFileSync(logFile, line + '\n') }
const check = (family, id, ok, detail) => {
  results.push({ family, id, ok: !!ok, detail })
  emit(`${ok ? 'PASS' : 'FAIL'} ${family}:${id} ${detail}`)
}

try {
  // 1. handshake positive — derive readiness from the framed reply, not sleep.
  const helloId = send('bridge.hello', { protocolVersion: 1 })
  const hello = await waitReply(helloId, BOOT_MS)
  check('handshake', 'positive', hello?.ok === true && hello?.result?.protocolVersion === 1,
    `bridge.hello framed reply (ok=${hello?.ok}, protocolVersion=${hello?.result?.protocolVersion})`)

  // 2. session domain — session.list must be a framed, successful reply.
  const list0Id = send('session.list')
  const list0 = await waitReply(list0Id)
  const arr0 = asArray(list0?.result)
  check('session', 'list', list0?.ok === true && arr0 !== null,
    `session.list ok=${list0?.ok} sessions=${arr0 ? arr0.length : 'n/a'}`)

  // 3. multi-session sessionId isolation (non-vacuous). The bridge holds ONE
  //    active session at a time (a second `session.open{mode:new}` returns
  //    ALREADY_OPEN), so isolation is asserted across sequential opens: two
  //    distinct persisted sessionIds, both present and stable in session.list,
  //    and the second open is provably a different id than the first.
  const openA = await waitReply(send('session.open', { mode: 'new' }))
  const idA = openA?.result?.sessionId
  await waitReply(send('session.close', { id: idA }))
  const openB = await waitReply(send('session.open', { mode: 'new' }))
  const idB = openB?.result?.sessionId
  const l1 = asArray((await waitReply(send('session.list')))?.result) || []
  const l2 = asArray((await waitReply(send('session.list')))?.result) || []
  const ids1 = l1.map(sid).filter(Boolean), ids2 = l2.map(sid).filter(Boolean)
  const bothPresent = idA && idB && idA !== idB && ids1.includes(idA) && ids1.includes(idB)
  const stable = ids1.length === ids2.length && ids1.every((v) => ids2.includes(v))
  const distinct = new Set(ids1).size === ids1.length
  check('session', 'sessionId-isolation', bothPresent && stable && distinct,
    `sequential opens A=${idA} B=${idB} (distinct=${!!(idA && idB && idA !== idB)}); ` +
    `list stable=${stable} distinct=${distinct} ids=[${ids1.join(',')}]`)

  // fault injection: a second concurrent open MUST be refused (ALREADY_OPEN)
  // rather than silently reusing the first session's id — that refusal is the
  // isolation guard proving sessions cannot be cross-wired.
  const dup = await waitReply(send('session.open', { mode: 'new' }))
  const guarded = dup?.ok === false && /ALREADY_OPEN/i.test(JSON.stringify(dup?.error ?? ''))
  check('session', 'open-isolation-guard', guarded,
    `concurrent second open -> ok=${dup?.ok} error=${JSON.stringify(dup?.error ?? null).slice(0, 120)}`)
  await waitReply(send('session.close', { id: idB }))

  // 4. push/event family — opening a session must emit a cap.event carrying a
  //    sessionId and a sequenced ready/snapshot event (S3 observeEvent/watch).
  const evWithSid = events.filter((e) => e && e.sessionId && e.seq !== undefined)
  check('push', 'event-sequence', evWithSid.length > 0,
    `cap.event frames with sessionId+seq=${evWithSid.length} ` +
    `(types=[${[...new Set(evWithSid.map((e) => e.eventType))].join(',')}])`)

  // 5. model domain — model.currentSelection must not crash the bridge.
  const model = await waitReply(send('model.currentSelection'))
  check('model', 'currentSelection', model !== undefined && typeof model.ok === 'boolean',
    `model.currentSelection framed reply ok=${model?.ok} result=${JSON.stringify(model?.result ?? null).slice(0, 120)}`)

  // 6. handshake negative / degrade — an inflated (never-wired) CapIR id must
  //    produce an explicit error, NOT a crash — then prove liveness.
  const bogus = await waitReply(send('session/definitelyNotAWiredCapability'))
  const degraded = bogus?.ok === false && /NOT_WIRED|UNSUPPORTED|unknown|unsupported/i.test(JSON.stringify(bogus?.error ?? ''))
  check('handshake', 'negative-degrade', degraded,
    `inflated CapIR id -> ok=${bogus?.ok} error=${JSON.stringify(bogus?.error ?? null).slice(0, 160)}`)
  const ping = await waitReply(send('bridge.ping'))
  check('handshake', 'alive-after-degrade', ping?.ok === true,
    `bridge.ping after negative -> ok=${ping?.ok}`)
} finally {
  try { child.kill('SIGTERM') } catch {}
  const deadline = Date.now() + EXIT_WAIT_MS
  while (child.exitCode === null && Date.now() < deadline) await sleep(POLL_MS)
  if (child.exitCode === null) { try { child.kill('SIGKILL') } catch {} }
  writeFileSync(join(OUT, 'bridge-families.json'), JSON.stringify({
    results, childExitCode: child.exitCode, eventCount: events.length,
    stderrTail: err.trim().slice(-2000),
  }, null, 2))
}

const failed = results.filter((r) => !r.ok).length
emit(`summary: PASS=${results.length - failed}/${results.length}`)
process.exit(failed ? 1 : 0)
