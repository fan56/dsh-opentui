#!/usr/bin/env node
// Real-client gate for the busy-submit steer/queue flow.
//
//   node verify/steer-queue-repro.mjs [--cols 120] [--rows 34] [--keep]
//
// What it proves against the REAL launcher (same scratch-DSH_HOME isolation
// as verify/agents-mount-repro.mjs — nothing is written to ~/.dsh):
//   1. pressing Enter on a non-empty message while a turn runs opens the
//      two-row choice on the dialog stack ("Turn running — steer or queue?",
//      rows Steer/Queue, Steer highlighted first);
//   2. choosing Queue paints the wait row in the transcript
//      ("⏸ Queued #1");
//   3. aborting that turn (the U6 stop contract) KEEPS the queue and marks it
//      paused ("⏸ Paused #1") — the documented failure/abort policy;
//   4. choosing Steer paints the injection receipt
//      ("⤵ Injected into the current turn"); abort keeps it Injected — abort is
//      NOT evidence of "✓ Delivered" (host cancel keeps the inbox).
//
// The model is the offline mock (e2e/lib/mock-llm.mjs): the scratch profile's
// apiKeyEnv providers get a baseURL pointing at it and the launch env pins
// dummy keys + mock BASE_URL, so no provider call leaves the machine. The
// busy turns carry the mock's E2E_BTW_MAIN marker (main-slow phase, ~42s) so
// the busy window reliably covers the steer/queue dance; the harness asserts
// en copy, so the scratch config pins lang=en.
//
// Exit 0 = every check passed; exit 1 = at least one failed (pane captures are
// kept under verify/steer-queue-out/); exit 2 = environment problem.
//
// Isolation: uniquely named tmux session, killed individually; the scratch
// host is reaped through its scratch lock file.

import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PROFILE } from '../packages/shell/scripts/lib/profile-name.mjs'
import { provisionScratchProfile } from './lib/scratch-profile.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LAUNCHER = join(REPO, 'dsh-opentui')
const MOCK = join(REPO, 'e2e', 'lib', 'mock-llm.mjs')
const PROFILE = DEFAULT_PROFILE
const IDLE = 'enter send'
const PLACEHOLDER = 'Type a message'
const SESS = `steer-queue-${process.pid}`
const OUT = join(REPO, 'verify', 'steer-queue-out')

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const COLS = Number(arg('cols', '120'))
const ROWS = Number(arg('rows', '34'))
const KEEP = process.argv.includes('--keep')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })
const tmux = (...a) => sh('tmux', a)
const tmuxOut = (...a) => (tmux(...a).status === 0 ? tmux(...a).stdout : '')
const flat = (s) => String(s).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '')
const has = (out, marker) => flat(out).includes(flat(marker))
const hasAny = (out, markers) => markers.some((m) => has(out, m))
/** A free TCP port (a fixed default collided with unrelated listeners). */
const freePort = () =>
  new Promise((res, rej) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)) })
    srv.on('error', rej)
  })
const PORT = await freePort()
const mockBaseUrl = () => `http://127.0.0.1:${PORT}/v1`

for (const cmd of ['tmux', 'bun', 'node'])
  if (sh('which', [cmd]).status !== 0) { console.error(`steer-queue: ${cmd} not on PATH`); process.exit(2) }
if (!existsSync(LAUNCHER) || !existsSync(MOCK)) {
  console.error(`steer-queue: launcher or mock missing (${LAUNCHER}, ${MOCK})`)
  process.exit(2)
}
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

// --- scratch home (same isolation as agents-mount-repro) ---
const HOME = mkdtempSync(join(tmpdir(), 'dsh-steer-queue-home-'))
chmodSync(HOME, 0o700)
const WS = mkdtempSync(join(tmpdir(), 'dsh-steer-queue-ws-'))
let profileDir
try {
  profileDir = provisionScratchProfile({ home: HOME, repo: REPO })
} catch (error) {
  console.error(`steer-queue: ${error.message}`)
  process.exit(2)
}

// Deterministic language: the harness asserts en copy, so pin the scratch
// config's `lang` regardless of any migrated legacy preference.
// (Distinct name — a past `profileConfigPath` redeclaration SyntaxError.)
const pinLangConfigPath = join(profileDir, 'config.json')
try {
  const cfg = JSON.parse(readFileSync(pinLangConfigPath, 'utf8'))
  cfg.lang = 'en'
  writeFileSync(pinLangConfigPath, JSON.stringify(cfg, null, 2))
} catch {}

// Offline, free model: point EVERY apiKeyEnv provider at the local mock.
// Indentation is the provision script's fixed shape; a plain string insert,
// no yaml dep. Patching a single provider is not enough — the profile's
// default route (agent-default-model) decides which provider a turn hits,
// and that has already sent a real request when only one provider was
// patched. A pre-existing baseURL means unclear routing; refuse rather than
// silently reach a real endpoint.
const patchPath = join(profileDir, 'cordis.patch.yml')
if (!existsSync(patchPath)) {
  console.error(`steer-queue: profile patch missing: ${patchPath}`)
  process.exit(2)
}
{
  const yaml = readFileSync(patchPath, 'utf8')
  if (/baseURL:/.test(yaml)) {
    console.error('steer-queue: scratch profile patch already carries a baseURL — refusing ambiguous routing')
    process.exit(2)
  }
  const patched = yaml.replace(/^( +[a-z][\w-]*:\n)( +apiKeyEnv:)/gm, `$1        baseURL: ${mockBaseUrl()}\n$2`)
  if (patched === yaml) {
    console.error('steer-queue: no apiKeyEnv provider found to patch — turns would reach a real endpoint')
    process.exit(2)
  }
  writeFileSync(patchPath, patched)
}

const LOCK = join(HOME, `opentui-host.${PROFILE}.json`)
const readLock = () => {
  try {
    const raw = JSON.parse(readFileSync(LOCK, 'utf8'))
    return typeof raw.pid === 'number' ? raw : null
  } catch { return null }
}
const reapHost = () => {
  const lock = readLock()
  if (!lock) return
  const sig = (p, s) => { try { process.kill(-p, s) } catch { try { process.kill(p, s) } catch {} } }
  sig(lock.pid, 'SIGTERM')
  for (let i = 0; i < 20; i++) {
    try { process.kill(lock.pid, 0); sleep(250) } catch { break }
  }
  try { process.kill(lock.pid, 'SIGKILL') } catch {}
  rmSync(LOCK, { force: true })
}

const results = []
const record = (item, ok, detail = []) => {
  results.push({ item, ok, detail })
  console.log(`${(ok ? 'PASS' : 'FAIL').padEnd(5)} ${item}${detail.length ? ` — ${detail.join(' | ')}` : ''}`)
}

const capture = (session = SESS, esc = false) => {
  const args = ['capture-pane', '-p', '-t', session]
  if (esc) args.push('-e')
  return tmuxOut(...args)
}
const sendKeys = (session, ...keys) => tmux('send-keys', '-t', session, ...keys)
/** One burst write (no per-char gaps): busyTurn() gates the caller on the
 * running turn's `esc stop` hint (mock main-slow, ~42s window), and the
 * composer sets busy synchronously, so this reliably lands on it. */
const typeFast = async (session, text) => {
  sendKeys(session, '-l', text)
  await sleep(40)
  sendKeys(session, 'Enter')
}
const composerRows = (out) =>
  out.split('\n')
    .filter((l) => l.trimStart().startsWith('┃'))
    .map((l) => l.trim().replace(/^┃/, '').replace(/┃$/, '').trim())
const composerEmpty = (out) => composerRows(out).every((l) => l === '' || l.startsWith(PLACEHOLDER))
const idle = (out) => out.includes(IDLE) || composerEmpty(out)
const waitPane = async (session, pred, timeoutMs, everyMs = 300) => {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    const frame = capture(session)
    if (frame.trim().length > 0) last = frame
    try { if (last && pred(last)) return { ok: true, out: last } } catch { /* keep waiting */ }
    await sleep(everyMs)
  }
  return { ok: false, out: last }
}
const snap = (name, session = SESS) => {
  writeFileSync(join(OUT, `${name}.ans`), capture(session, true))
  console.log(`  snapshot: verify/steer-queue-out/${name}.ans`)
  return capture(session)
}
const launch = (session, cols, rows) => {
  tmux('kill-session', '-t', session)
  // Dummy keys + mock BASE_URL: the turn runs through the offline mock —
  // both the profile patch and this env point at it, so nothing ever
  // reaches a real provider.
  const env = [
    `DSH_HOME=${HOME}`,
    'DSH_OPENTUI_DEBUG=1',
    'ZAI_CODING_CN_API_KEY=mock-only-key',
    `ZAI_CODING_CN_BASE_URL=${mockBaseUrl()}`,
    'OPENCODE_GO_API_KEY=mock-only-key',
    `OPENCODE_GO_BASE_URL=${mockBaseUrl()}`,
  ]
  const r = tmux('new-session', '-d', '-x', String(cols), '-y', String(rows), '-s', session, '-c', WS,
    `${env.join(' ')} ${LAUNCHER} --client 2>${join(OUT, `${session}.err.log`)}`)
  if (r.status !== 0) throw new Error('tmux boot failed: ' + r.stderr)
}
const killSession = (session) => tmux('kill-session', '-t', session)
/** Abort the running turn through the U6 stop contract (turn-cancel.tsx):
 * the first Esc only ARMS ("Press Esc again to stop"), a second Esc inside
 * the double-press window opens the `Stop everything?` confirm, and Enter
 * confirms it (the confirm card's active row defaults to Yes). A bare Esc
 * or two Escapes without the confirm leave the turn running — and a left-open
 * confirm dialog breaks every later step. The settle predicate reads the
 * HINT row, not the editor: the composer paints its placeholder while busy. */
const abortTurn = async (session, waitMs = 15_000) => {
  sendKeys(session, 'Escape')
  await sleep(150)
  sendKeys(session, 'Escape')
  await sleep(350)
  sendKeys(session, 'Enter')
  return waitPane(session, (o) => !has(o, 'esc stop'), waitMs)
}
/** Wait for the busy hint (`esc stop`) so the next burst write deterministically
 * lands on a running turn (the mock's main-slow phase keeps it busy ~42s). */
const busyTurn = (session) => waitPane(session, (o) => has(o, 'esc stop'), 20_000)

let mockProc = null
const startMock = async () => {
  const log = join(OUT, 'mock-llm.log')
  const fd = openSync(log, 'w')
  mockProc = spawn('node', [MOCK, '--port', String(PORT)], { stdio: ['ignore', fd, fd] })
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`)
      if (res.ok) return
    } catch { /* not up yet */ }
    await sleep(100)
  }
  throw new Error(`mock LLM did not answer on 127.0.0.1:${PORT}`)
}
const stopMock = () => {
  if (!mockProc) return
  try { mockProc.kill('SIGTERM') } catch {}
  mockProc = null
}

let crashed = null
try {
  await startMock()
  console.log(`steer-queue: mock LLM on 127.0.0.1:${PORT}; scratch home ${HOME}`)
  launch(SESS, COLS, ROWS)
  const boot = await waitPane(SESS, (o) => o.includes('🧠') || idle(o), 90_000, 500)
  if (!boot.out.includes('🧠') && !idle(boot.out)) {
    console.error('client never rendered:\n' + boot.out.slice(-1500))
    process.exit(2)
  }
  await waitPane(SESS, idle, 30_000)
  snap('01-welcome')

  // ---------------- 1. busy submit opens the choice ----------------
  // The busy turn carries the mock's E2E_BTW_MAIN marker (main-slow phase,
  // ~42s of ticks) so the window covers the whole steer/queue dance.
  await typeFast(SESS, 'Walk the migration plan step by step. E2E_BTW_MAIN')
  await busyTurn(SESS)
  await typeFast(SESS, 'queued line')
  const popup = await waitPane(SESS, (o) => has(o, 'steer or queue') && hasAny(o, ['Steer']) && hasAny(o, ['Queue']), 15_000)
  snap('02-choice')
  record('busy Enter opens the steer/queue choice', popup.ok,
    [popup.ok ? 'Steer/Queue rows visible' : 'choice dialog not visible'])

  // ---------------- 2. Queue paints the wait row ----------------
  sendKeys(SESS, 'Down')
  await sleep(120)
  sendKeys(SESS, 'Enter')
  const queued = await waitPane(SESS, (o) => has(o, 'Queued') && has(o, '#1'), 8_000)
  snap('03-queued')
  record('Queue paints the numbered wait row', queued.ok,
    [queued.ok ? '⏸ Queued #1 visible' : 'queue row not visible'])

  // ---------------- 3. abort keeps the queue (paused) ----------------
  // Abort through the U6 contract (see abortTurn): Esc arms, Esc opens the
  // stop-everything confirm, Enter confirms. The aborted turn pauses the
  // queue in place (`⏸ Paused #1`, composer-state abort policy).
  await abortTurn(SESS)
  const paused = await waitPane(SESS, (o) => has(o, 'Paused') && has(o, '#1'), 12_000)
  snap('04-paused')
  record('abort keeps the queue and marks it paused', paused.ok,
    [paused.ok ? '⏸ Paused #1 visible' : 'paused queue row not visible'])
  await waitPane(SESS, idle, 15_000)

  // ---------------- 4. Steer paints the injection receipt ----------------
  await typeFast(SESS, 'Walk the migration plan again. E2E_BTW_MAIN')
  await busyTurn(SESS)
  await typeFast(SESS, 'say hello in one word')
  const steerPopup = await waitPane(SESS, (o) => has(o, 'steer or queue'), 15_000)
  if (steerPopup.ok) {
    sendKeys(SESS, 'Enter') // default highlight = Steer
    await sleep(150)
  }
  const injected = await waitPane(SESS, (o) => has(o, 'Injected into the current turn'), 8_000)
  snap('05-steer-injected')
  record('Steer paints the injected receipt', steerPopup.ok && injected.ok,
    [steerPopup.ok ? 'choice reopened' : 'choice did not reopen', injected.ok ? '⤵ Injected into the current turn visible' : 'steer receipt not visible'])

  // End the turn through the same confirmed abort (abortTurn). Abort is NOT
  // proof that the steer was consumed: host cancel keeps the inbox
  // (keepInbox:true) and has no inbox-retract API, so the injected message may
  // remain queued for the NEXT turn. Assert the honest terminal state — the row
  // still reads Injected and no Delivered receipt appears — instead of
  // inventing a delivery the bridge cannot prove.
  await abortTurn(SESS)
  // Gate on the idle/settle wait result: an unsettled turn must NOT be
  // reported as a verified Injected-without-Delivered terminal state.
  const settled = await waitPane(SESS, idle, 15_000)
  const afterAbort = capture(SESS)
  snap('06-steer-after-abort')
  const stillInjected = has(afterAbort, 'Injected into the current turn')
  const noDelivered = !has(afterAbort, 'Delivered')
  record('abort leaves the steer row injected with no delivered claim',
    settled.ok && stillInjected && noDelivered,
    [settled.ok ? 'idle/settle reached' : 'turn did not settle within budget',
     stillInjected ? '⤵ Injected still visible' : 'injected row not visible',
     noDelivered ? 'no Delivered receipt' : 'unexpected Delivered receipt'])

  const err = capture(SESS)
  const crash = /TypeError|ReferenceError|Cannot read propert|Unhandled error|panic/.exec(err)
  record('no crash markers in the client scrollback', crash === null, [crash ? crash[0] : 'clean'])
} catch (error) {
  crashed = error
  console.error('steer-queue: run failed:', error?.stack ?? error)
} finally {
  stopMock()
  if (!KEEP) killSession(SESS)
  reapHost()
  try {
    writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ results, crashed: crashed ? String(crashed) : null }, null, 2))
  } catch {}
  if (!KEEP) {
    try { rmSync(HOME, { recursive: true, force: true }) } catch {}
    try { rmSync(WS, { recursive: true, force: true }) } catch {}
  }
}

const failed = results.filter((r) => !r.ok).length
console.log(`\nsteer-queue: ${results.length - failed}/${results.length} checks passed`)
if (crashed || failed > 0) process.exit(1)
