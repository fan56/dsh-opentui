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
//      ("⏸ 排队等待 #1");
//   3. aborting that turn (Esc) KEEPS the queue and marks it paused
//      ("⏸ 已暂停 #1") — the documented failure/abort policy;
//   4. choosing Steer paints the injection receipt
//      ("⤵ 已注入当前回合") and it flips to "✓ 已投递" at turn end.
//
// Exit 0 = every check passed; exit 1 = at least one failed (pane captures are
// kept under verify/steer-queue-out/); exit 2 = environment problem.
//
// Isolation: uniquely named tmux session, killed individually; the scratch
// host is reaped through its scratch lock file.

import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LAUNCHER = join(REPO, 'dsh-opentui')
const PROFILE = 'opentui'
const REAL_HOME = process.env.DSH_HOME_REAL || join(homedir(), '.dsh')
const IDLE = '提问，回车发送'
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

for (const cmd of ['tmux', 'bun'])
  if (sh('which', [cmd]).status !== 0) { console.error(`steer-queue: ${cmd} not on PATH`); process.exit(2) }
if (!existsSync(join(REAL_HOME, 'profiles', PROFILE))) {
  console.error(`steer-queue: profile '${PROFILE}' missing under ${REAL_HOME}`)
  process.exit(2)
}
if (!existsSync(LAUNCHER)) { console.error(`steer-queue: launcher missing: ${LAUNCHER}`); process.exit(2) }
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

// --- scratch home (same isolation as agents-mount-repro) ---
const HOME = mkdtempSync(join(tmpdir(), 'dsh-steer-queue-home-'))
chmodSync(HOME, 0o700)
const WS = mkdtempSync(join(tmpdir(), 'dsh-steer-queue-ws-'))
mkdirSync(join(HOME, 'profiles'), { recursive: true })
cpSync(join(REAL_HOME, 'profiles', PROFILE), join(HOME, 'profiles', PROFILE), { recursive: true })
for (const rel of ['.credentials.yaml', 'models-store.json', 'model-profiles.json', 'workspace-presets.json', 'settings.yaml', 'agents', 'themes']) {
  const from = join(REAL_HOME, rel)
  if (existsSync(from)) cpSync(from, join(HOME, rel), { recursive: true })
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
/** One burst write (no per-char gaps): the busy window is short and the
 * composer sets busy synchronously, so this reliably lands on a running turn. */
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
  const env = [`DSH_HOME=${HOME}`, 'DSH_OPENTUI_DEBUG=1']
  const r = tmux('new-session', '-d', '-x', String(cols), '-y', String(rows), '-s', session, '-c', WS,
    `${env.join(' ')} ${LAUNCHER} --client 2>${join(OUT, `${session}.err.log`)}`)
  if (r.status !== 0) throw new Error('tmux boot failed: ' + r.stderr)
}
const killSession = (session) => tmux('kill-session', '-t', session)

let crashed = null
try {
  launch(SESS, COLS, ROWS)
  const boot = await waitPane(SESS, (o) => o.includes('🧠') || idle(o), 90_000, 500)
  if (!boot.out.includes('🧠') && !idle(boot.out)) {
    console.error('client never rendered:\n' + boot.out.slice(-1500))
    process.exit(2)
  }
  await waitPane(SESS, idle, 30_000)
  snap('01-welcome')

  // ---------------- 1. busy submit opens the choice ----------------
  await typeFast(SESS, 'Reply with just: OK')
  await typeFast(SESS, 'queued line')
  const popup = await waitPane(SESS, (o) => has(o, 'steer or queue') && hasAny(o, ['Steer']) && hasAny(o, ['Queue']), 15_000)
  snap('02-choice')
  record('busy Enter opens the steer/queue choice', popup.ok,
    [popup.ok ? 'Steer/Queue rows visible' : 'choice dialog not visible'])

  // ---------------- 2. Queue paints the wait row ----------------
  sendKeys(SESS, 'Down')
  await sleep(120)
  sendKeys(SESS, 'Enter')
  const queued = await waitPane(SESS, (o) => has(o, '排队等待') && has(o, '#1'), 8_000)
  snap('03-queued')
  record('Queue paints the numbered wait row', queued.ok,
    [queued.ok ? '⏸ 排队等待 #1 visible' : 'queue row not visible'])

  // ---------------- 3. abort keeps the queue (paused) ----------------
  sendKeys(SESS, 'Escape')
  const paused = await waitPane(SESS, (o) => has(o, '已暂停') && has(o, '#1'), 10_000)
  snap('04-paused')
  record('abort keeps the queue and marks it paused', paused.ok,
    [paused.ok ? '⏸ 已暂停 #1 visible' : 'paused queue row not visible'])
  await waitPane(SESS, idle, 15_000)

  // ---------------- 4. Steer paints the injection receipt ----------------
  await typeFast(SESS, 'Reply with just: OK')
  await typeFast(SESS, 'say hello in one word')
  const steerPopup = await waitPane(SESS, (o) => has(o, 'steer or queue'), 15_000)
  if (steerPopup.ok) {
    sendKeys(SESS, 'Enter') // default highlight = Steer
    await sleep(150)
  }
  const injected = await waitPane(SESS, (o) => has(o, '已注入当前回合'), 8_000)
  snap('05-steer-injected')
  record('Steer paints the injected receipt', steerPopup.ok && injected.ok,
    [steerPopup.ok ? 'choice reopened' : 'choice did not reopen', injected.ok ? '⤵ 已注入当前回合 visible' : 'steer receipt not visible'])

  // Abort the turn to make the receipt transition deterministic (an abort also
  // delivers the injected steer). Two Escapes: the first closes any ask card
  // the model opened, the second cancels the turn.
  sendKeys(SESS, 'Escape')
  await sleep(350)
  sendKeys(SESS, 'Escape')
  const delivered = await waitPane(SESS, (o) => has(o, '已投递'), 20_000)
  snap('06-steer-delivered')
  record('the steer receipt flips to delivered at turn end', delivered.ok,
    [delivered.ok ? '✓ 已投递 visible' : 'delivered receipt not visible'])

  const err = capture(SESS)
  const crash = /TypeError|ReferenceError|Cannot read propert|Unhandled error|panic/.exec(err)
  record('no crash markers in the client scrollback', crash === null, [crash ? crash[0] : 'clean'])
} catch (error) {
  crashed = error
  console.error('steer-queue: run failed:', error?.stack ?? error)
} finally {
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
