#!/usr/bin/env bun
/**
 * R6 scratch-only driver — REAL TUI child session routing for childSessionId.
 *
 *   bun verify/e2e-flows/r6-child-routing.ts [--out <dir>] [--home <dir>] [--ws <dir>]
 *
 * This is the harness that closes the old BLOCKED row
 *   "R6 子会话 childSessionId 真机路由未覆盖"
 * by exercising the real chain, NOT by synthesising any journal row or id:
 *
 *   1. a scratch profile with the use_agent companion (`registry`) mounted and
 *      the by-name `r6-asker` child agent registered with permission `ask`
 *      (F1 re-pins the delegated child's approval policy to `ask`);
 *   2. the REAL TUI client boots against that scratch home, with the LOCAL
 *      mock-llm two-phase script as the only model route:
 *        parent marker -> a real `use_agent` tool call,
 *        child marker  -> a real gated bash/write tool call whose NAME is
 *          discovered from the request's `tools` array (NOT ask_user_question,
 *          which the installed host rejects for a subagent-origin session:
 *          UserQuestionError / DELEGATED_CALLER);
 *   3. the child's gated write tool raises the REAL approval card on the parent
 *      pane; the driver waits for that card and selects "Allow once" from the
 *      captured frame (only `Enter`, the confirm binding — never a/s/Esc and
 *      never a fixed key sequence);
 *   4. the REAL compressed session journal is read back from the scratch home
 *      (zstd decompressed via the runtime), and the terminal `ask.responded`
 *      row carrying childSessionId is asserted verbatim;
 *   5. the REAL projection code (bridge-session-seam + ask-outcome) is fed the
 *      journal rows to assert parent ask=0 / notice=1 / dedup, /btw=0 and
 *      sessionInfo zero-new.
 *
 * NO registry method is called directly, NO appendPluginRecord mock is
 * installed, NO journal row or childSessionId is invented, NO always-grant
 * answer is sent. If the real child session cannot be reached, the driver
 * prints `BLOCKED: <reason>` and exits non-zero; it never fabricates evidence.
 *
 * The earlier `ask_user_question` (questions-panel) path is retained as
 * DELEGATED_CALLER BLOCKED evidence in the prereg deferred AMEND; this driver
 * now covers the permission-ask path instead.
 *
 * Exit code 0 only when every assertion passes; 1 on assertion failure;
 * 2 on BLOCKED (real chain unreachable).
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACTIVE_PROFILE, bootIdle, decideApprovalKey, hasPaneContent, idleText as idle,
  isApprovalCard, makeCleanup, noticeParentFromJournal, scanAlwaysGrant, stripAnsi,
} from './r6-harness-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const LAUNCHER = join(REPO, 'dsh-opentui')
const MOCK = join(REPO, 'e2e', 'lib', 'mock-llm.mjs')
const SETUP = join(HERE, 'setup-home.mjs')
// Single source of truth: profile-name.mjs -> DEFAULT_PROFILE (no hardcoded
// 'opentui'). setup-home.mjs provisions this same profile, so all profile
// paths stay in sync when the default changes (e.g. opentui-monday).
const PROFILE = ACTIVE_PROFILE
const GEOMETRY = { x: 120, y: 34 }
const FAKE_KEY = 'e2e-fake-key'
const PARENT_MARKER = 'E2E_R6_PARENT'
const CHILD_MARKER = 'E2E_R6_CHILD'
// Gate on the approval CARD TITLE (shared helper), not a generic tool line.
// The child's permission ask renders as `⚠ Approval: <tool>` / `⚠ 审批：<tool>`.
const approvedToolRe = /r6-child-tool name=(bash|write|edit|apply_patch|write_file)\b/

const argv = process.argv.slice(2)
const opt = (name: string, def: string) => {
  const inline = argv.find((a) => a.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : def
}
const OUT = resolve(opt('out', mkdtempSync(join(tmpdir(), 'r6-child-routing-'))))
mkdirSync(OUT, { recursive: true })
const CONSOLE_LOG = join(OUT, '20-r6-console.log')
const MOCK_LOG = join(OUT, '20-r6-mock.log')
const JOURNAL_COPY = join(OUT, '21-r6-journal.jsonl')
const PROJECTION_LOG = join(OUT, '30-r6-projection.log')
const AUDIT_LOG = join(OUT, '40-harness-audit.log')
const PROFILE_LOG = join(OUT, '10-r6-profile.log')
const SUMMARY = join(OUT, 'assert-summary.json')
const SESS = `r6-ask-${process.pid}`
const TMUX_SOCKET = `r6-${process.pid}`

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const sh = (cmd: string, args: string[], opts: Record<string, unknown> = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', ...opts })
const tmux = (...a: string[]) => sh('tmux', ['-L', TMUX_SOCKET, ...a])
const tmuxOut = (...a: string[]) => { const r = tmux(...a); return r.status === 0 ? String(r.stdout ?? '') : '' }
// Keep every captured frame so the E8 audit can scan REAL frame content
// (never the driver's own source text).
const capturedFrames: string[] = []
const capture = () => {
  const frame = tmuxOut('capture-pane', '-p', '-t', SESS)
  if (frame) capturedFrames.push(frame)
  return frame
}
const sendKeys = (...keys: string[]) => tmux('send-keys', '-t', SESS, ...keys)

let failures = 0
let passes = 0
let blockedReason = ''
const consoleLines: string[] = []
const projectionLines: string[] = []
function log(message: string) {
  const line = `${new Date().toISOString()} ${message}`
  console.log(line)
  consoleLines.push(line)
}
function plog(message: string) {
  const line = `${new Date().toISOString()} ${message}`
  console.log(line)
  projectionLines.push(line)
}
function check(label: string, ok: boolean, expected: unknown, actual: unknown) {
  if (ok) { passes++; log(`  PASS ${label}`) }
  else { failures++; log(`  FAIL ${label}\n       expected: ${JSON.stringify(expected)}\n       actual:   ${JSON.stringify(actual)}`) }
}
/** BLOCKED is an honest early exit, never a PASS. */
function blocked(reason: string): never {
  blockedReason = reason
  log(`BLOCKED: ${reason}`)
  cleanup() // release mock child / tmux client / scratch host BEFORE exiting
  flush()
  process.exit(2)
}
function flush() {
  writeFileSync(CONSOLE_LOG, consoleLines.join('\n') + '\n')
  writeFileSync(PROJECTION_LOG, projectionLines.join('\n') + '\n')
  writeFileSync(SUMMARY, JSON.stringify({
    passes, failures, blocked: blockedReason || undefined,
    evidence: { console: CONSOLE_LOG, mock: MOCK_LOG, journal: JOURNAL_COPY, projection: PROJECTION_LOG, audit: AUDIT_LOG, profile: PROFILE_LOG },
    at: new Date().toISOString(),
  }, null, 2) + '\n')
}

// --- unified teardown: every exit path releases mock child + tmux + host -----
// `blocked()` calls `cleanup()`; an 'exit' backstop plus the error handlers
// below cover the paths that bypass it. `home`/`mockChild`/`mockLogStream` are
// assigned before the first possible exit (mock port timeout); the closures
// read them at call time.
let home = ''
let mockChild: ReturnType<typeof spawn> | null = null
let mockLogStream: ReturnType<typeof createWriteStream> | null = null
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Reap the scratch host through its own lock file (same pattern as other flows). */
function reapHost() {
  if (!home) return
  const lock = join(home, `opentui-host.${PROFILE}.json`)
  let pid = 0
  try { pid = Number(JSON.parse(readFileSync(lock, 'utf8')).pid) || 0 } catch { /* already gone */ }
  if (pid) {
    const sig = (target: number, signal: 'SIGTERM' | 'SIGKILL') => {
      try { process.kill(-target, signal) } catch { try { process.kill(target, signal) } catch {} }
    }
    sig(pid, 'SIGTERM')
    const until = Date.now() + 4000
    while (Date.now() < until) {
      try { process.kill(pid, 0); sleepSync(200) } catch { break }
    }
    sig(pid, 'SIGKILL')
  }
  rmSync(lock, { force: true })
}

const cleanup = makeCleanup({
  killSession: () => { tmux('kill-session', '-t', SESS) },
  reapHost,
  killMock: () => { mockChild?.kill() },
  endLog: () => { mockLogStream?.end() },
})
// Last-resort backstop: a thrown error, signal, or any path that bypasses
// blocked()/the happy path still tears down before the process disappears.
process.on('exit', cleanup)
const fatal = (err: unknown) => {
  log(`ERROR: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  cleanup()
  flush()
  process.exit(1)
}
process.on('uncaughtException', fatal)
process.on('unhandledRejection', fatal)

// --- 1. model + scratch profile ---------------------------------------------
log(`R6 child-routing driver start ${new Date().toISOString()} — out ${OUT}`)

mockChild = spawn(process.execPath, [MOCK, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] })
const child = mockChild
mockLogStream = createWriteStream(MOCK_LOG)
const logStream = mockLogStream
let mockOutput = ''
child.stdout!.on('data', (d) => {
  const text = String(d)
  mockOutput += text
  logStream.write(text)
})
child.stderr!.on('data', (d) => logStream.write(String(d)))

async function mockPort(): Promise<number> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const m = /ready http:\/\/127\.0\.0\.1:(\d+)/.exec(mockOutput)
    if (m) return Number(m[1])
    await sleep(50)
  }
  blocked('mock-llm did not report its bound port (two-phase script unavailable)')
}
const PORT = await mockPort()
log(`  · mock-llm on 127.0.0.1:${PORT} (log ${MOCK_LOG})`)

home = opt('home', '')
let ws = opt('ws', '')
if (!home || !ws) {
  home = mkdtempSync(join(tmpdir(), 'r6-child-home-'))
  ws = mkdtempSync(join(tmpdir(), 'r6-child-ws-'))
}
// --no-reasoning-effort: fake-gw/demo-1 rejects the deployed `high` default at
// turn/start (UNSUPPORTED_REASONING_EFFORT). Scratch-only, R6-only; no other
// scenario passes this flag.
const setup = sh('node', [SETUP, '--home', home, '--workspace', ws, '--port', String(PORT), '--companions', 'registry', '--r6-ask', '--no-reasoning-effort'])
writeFileSync(PROFILE_LOG, `${setup.stdout ?? ''}${setup.stderr ?? ''}`)
if (setup.status !== 0) blocked(`scratch profile provision failed (exit ${setup.status}): ${String(setup.stderr ?? setup.stdout ?? '').slice(-1200)}`)

// E2 (profile): use_agent companion bundle + explicit ask permission agent.
const profileDir = join(home, 'profiles', PROFILE)
const patchText = existsSync(join(profileDir, 'cordis.patch.yml')) ? readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8') : ''
const pkgText = existsSync(join(profileDir, 'package.json')) ? readFileSync(join(profileDir, 'package.json'), 'utf8') : ''
const agentText = existsSync(join(home, 'agents', 'r6-asker.md')) ? readFileSync(join(home, 'agents', 'r6-asker.md'), 'utf8') : ''
const companionLoaded = pkgText.includes('@aiwayds/dsh-subagent-registry') || patchText.includes('dsh-subagent-registry')
check('E2 use_agent companion bundle is mounted in the scratch profile', companionLoaded, '@aiwayds/dsh-subagent-registry in profile', companionLoaded ? 'present' : 'absent')
check('E2 child agent declares permission ask', /permission:\s*ask/.test(agentText) && agentText.includes(CHILD_MARKER), 'permission: ask + child marker', stripAnsi(agentText).slice(0, 160))
check('E2 approval gate stays on (no always-grant preset)', !patchText.includes('danger-full-access') || patchText.includes('approval: ask'), 'workspace-write approval: ask', patchText.includes('approval: ask') ? 'approval: ask' : 'not found')
// sourceText is retained only for the E7 static-code check (fixed Down loop).
// The E8 always-grant check below deliberately does NOT scan this source: the
// old source scan self-matched its own expected-label string which quotes
// `escalation:true` and failed unconditionally (harness audit A2).
const sourceText = readFileSync(join(HERE, 'r6-child-routing.ts'), 'utf8')

if (!companionLoaded || !/permission:\s*ask/.test(agentText)) {
  blocked('use_agent companion or ask-permission child agent unavailable in the scratch profile; real child session cannot start')
}

// --- 2. real TUI boot -------------------------------------------------------
async function waitFor(pred: (out: string) => boolean, timeoutMs: number, everyMs = 300) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    const frame = capture()
    // Real-pane non-empty guard: never let a blank capture satisfy a gate.
    if (hasPaneContent(frame)) last = frame
    if (last && pred(last)) return { ok: true, out: last }
    await sleep(everyMs)
  }
  return { ok: false, out: last }
}
const submittedTexts: string[] = []
async function submit(text: string) {
  submittedTexts.push(text)
  for (const ch of text) { sendKeys('-l', ch); await sleep(55) }
  await sleep(250)
  // first-key drop guard (same as the flow suite)
  if (!capture().includes(text.slice(-8))) {
    for (let i = 0; i < text.length + 6; i++) { sendKeys('BSpace'); await sleep(30) }
    await sleep(120)
    for (const ch of text) { sendKeys('-l', ch); await sleep(55) }
    await sleep(200)
  }
  sendKeys('Enter')
}

tmux('kill-session', '-t', SESS)
await sleep(250)
const bootEnv = [
  `DSH_HOME=${home}`,
  'DSH_OPENTUI_MODEL=fake-gw/demo-1',
  `DSH_FAKE_API_KEY=${FAKE_KEY}`,
  'DSH_OPENTUI_DEBUG=1',
  'TERM=xterm-256color',
].join(' ')
const errLog = join(OUT, 'r6-client.err.log')
const bootCmd = `${bootEnv} "${LAUNCHER}" --client 2>"${errLog}"`
const boot = tmux('new-session', '-d', '-x', String(GEOMETRY.x), '-y', String(GEOMETRY.y), '-s', SESS, '-c', ws, bootCmd)
if (boot.status !== 0) blocked(`tmux boot failed: ${boot.stderr}`)
// Same OR gate as every other flow (queue-flush / agents-mount / steer-queue /
// w1a-six-commands / ui-matrix): 🧠 OR idle text. The old `🧠 && idle` was
// unsatisfiable on panes without a footer 🧠 and blocked every R6 run at 90s.
const up = await waitFor((o) => bootIdle(o), 90_000, 700)
if (!up.ok) blocked(`client did not reach idle within 90s; pane tail: ${stripAnsi(up.out).split('\n').slice(-6).join(' | ')}`)
log('  · real TUI client reached idle')

// --- 3. parent turn: real use_agent dispatch --------------------------------
await submit(`Ask the child to run the gated probe tool. ${PARENT_MARKER}`)
const card = await waitFor((o) => isApprovalCard(o), 120_000, 400)
if (!card.ok) blocked(`child permission approval card never appeared (real use_agent / gated tool did not raise the ask); pane tail: ${stripAnsi(card.out).split('\n').slice(-8).join(' | ')}`)
log('  · real child permission approval card appeared on the parent pane')

// --- 4. frame-by-frame "Allow once" (Enter only; never a/s/Esc) -------------
// The approval card is a DialogConfirm: Allow once = PRIMARY confirm = Enter.
// The escalation binds `a` (always) / `s` (session) and Reject = Esc are NEVER
// sent — an always/session grant or a rejection would forge the outcome. Every
// key is chosen from the captured frame via the shared decideApprovalKey, never
// from a fixed Down×N + Enter sequence.
interface Decision { step: number; key: string; why: string; marker: string }
const decisions: Decision[] = []
let framesObserved = 0
let approvalSent = false
let cardClosed = false
for (let step = 0; step < 40; step += 1) {
  const frame = stripAnsi(capture())
  if (!hasPaneContent(frame)) { await sleep(300); continue }
  framesObserved += 1
  if (!isApprovalCard(frame)) {
    if (approvalSent) cardClosed = true
    await sleep(300)
    continue
  }
  if (approvalSent) { await sleep(300); continue } // card draining: never re-send
  const d = decideApprovalKey(frame)
  if (d?.key !== 'Enter') {
    log(`  frame#${step} -> key=NONE why=${d?.why ?? 'card-not-ready'} marker=${d?.marker ?? 'approval-no-card'}`)
    await sleep(300)
    continue
  }
  decisions.push({ step, key: d.key, why: d.why, marker: d.marker })
  log(`  frame#${step} -> key=${d.key} why=${d.why} marker=${d.marker}`)
  sendKeys(d.key)
  approvalSent = true
  await sleep(450)
}
check('E7 approval card observed frame-by-frame before acting', framesObserved >= 1 && decisions.length >= 1, '>=1 observed frame, >=1 decision', `frames=${framesObserved} decisions=${decisions.length}`)
check('E7 Allow once chosen from the captured frame (Enter only)', decisions.length === 1 && decisions.every((d) => d.key === 'Enter' && d.why === 'approval-card-confirm-allow-once'), '1 Enter/allow-once decision', decisions)
check('E7 no fixed key run / no always/session/Reject key sent', !/sendKeys\(['"](Down|Esc|a|s)['"]\)/.test(sourceText) && !decisions.some((d) => d.key !== 'Enter'), 'Enter-only', [...new Set(decisions.map((d) => d.key))].join(','))
if (!approvalSent) blocked(`approval card stayed open but Allow once was never selected; frames=${framesObserved}, tail: ${stripAnsi(capture()).split('\n').slice(-8).join(' | ')}`)
log(`  · Allow once sent; card-closed-observed=${cardClosed}`)
const done = await waitFor((o) => o.includes('E2E-R6-DONE') && idle(o), 120_000, 500)
if (!done.ok) {
  blocked(`child tool did not settle / parent did not finish; frames=${framesObserved}, tail: ${stripAnsi(done.out).split('\n').slice(-6).join(' | ')}`)
}
log('  · parent received the real child result (E2E-R6-DONE)')

// E1 (permission path): the mock's REAL chain reached all four phases, and the
// child phase emitted a gated write tool DISCOVERED from the request tools —
// never ask_user_question (the host rejects subagent-origin human interaction).
check('E1 mock reached real use_agent dispatch phase', mockOutput.includes('phase=r6-dispatch'), 'phase=r6-dispatch', mockOutput.includes('phase=r6-dispatch'))
check('E1 child tool name was discovered from the request tools (gated write)', approvedToolRe.test(mockOutput), 'r6-child-tool name=(bash|write|edit|apply_patch|write_file)', approvedToolRe.exec(mockOutput)?.[0] ?? 'absent')
check('E1 child phase did NOT use ask_user_question', !/r6-child-tool name=ask_user_question/.test(mockOutput), 'no ask_user_question tool name', /r6-child-tool name=(\S+)/.exec(mockOutput)?.[1] ?? 'absent')
check('E1 mock child + parent final phases reached', mockOutput.includes('phase=r6-child-final') && mockOutput.includes('phase=r6-final'), 'r6-child-final + r6-final', `child-final=${mockOutput.includes('phase=r6-child-final')} final=${mockOutput.includes('phase=r6-final')}`)

// --- 5. real journal read-back ----------------------------------------------
interface JournalRow { seq?: number; type: string; data?: Record<string, unknown>; payload?: Record<string, unknown>; [k: string]: unknown }
function readRealJournal(): JournalRow[] {
  const out: JournalRow[] = []
  const root = join(home, 'sessions')
  const visit = (dir: string, depth: number) => {
    if (depth > 4 || !existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { visit(full, depth + 1); continue }
      if (!(entry.name.startsWith('session.') && (entry.name.endsWith('.zstd') || entry.name.endsWith('.jsonl')))) continue
      try {
        let buf = readFileSync(full)
        if (entry.name.endsWith('.zstd')) {
          const z = (globalThis as Record<string, unknown>).Bun as { zstdDecompressSync?: (b: Uint8Array) => Uint8Array } | undefined
          if (!z?.zstdDecompressSync) continue
          buf = Buffer.from(z.zstdDecompressSync(buf))
        }
        for (const line of buf.toString('utf8').split('\n')) {
          if (!line.trim()) continue
          try { out.push(JSON.parse(line) as JournalRow) } catch { /* partial line */ }
        }
      } catch { /* unreadable log: skip, do not invent rows */ }
    }
  }
  visit(root, 0)
  return out
}
const rawJournal = readRealJournal()
const replayRows = rawJournal.map((row, i) => ({
  seq: typeof row.seq === 'number' ? row.seq : i + 1,
  type: String(row.type ?? ''),
  payload: (row.data ?? row.payload ?? row) as Record<string, unknown>,
}))
writeFileSync(JOURNAL_COPY, replayRows.map((r) => JSON.stringify(r)).join('\n') + '\n')
log(`  · real journal rows read: ${replayRows.length} (copy ${JOURNAL_COPY})`)

// E8 — scan REAL runtime artifacts only (journal rows, captured frames,
// mock-llm stdout). Scanning the driver source made this check self-match its
// own expected-label string (`escalation:true`) and fail unconditionally.
const escalationHits = scanAlwaysGrant({ journalRows: replayRows, frames: capturedFrames, mockOutput })
check('E8 harness sends no always-grant / escalation answer',
  escalationHits.length === 0, 'no always-grant marker in real journal/frames', escalationHits)

if (replayRows.length === 0) blocked('no real session journal rows found in the scratch home')

const dataOf = (row: { type: string; payload: Record<string, unknown> }) => row.payload
const terminalKind = (row: { type: string; payload: Record<string, unknown> }) => {
  const d = dataOf(row)
  if (typeof d.kind === 'string') return d.kind
  if (row.type.includes('/responded')) return 'ask.responded'
  if (row.type.includes('/cancelled')) return 'ask.cancelled'
  if (row.type.includes('/requested')) return 'ask.requested'
  return undefined
}
const withChild = replayRows.filter((r) => {
  const d = dataOf(r)
  return typeof d.childSessionId === 'string' && (d.childSessionId as string).length > 0
})
log(`  · real journal rows carrying childSessionId: ${withChild.length}`)
const approved = withChild.filter((r) => {
  const d = dataOf(r)
  return terminalKind(r) === 'ask.responded'
    && d.askKind === 'approval'
    && d.settleReason === 'answered'
    && d.outcome === 'approved'
})
if (approved.length === 0) {
  blocked('no real ask.responded{askKind:approval,settleReason:answered,outcome:approved,childSessionId} row in the journal; childSessionId routing not covered')
}
const canonical = approved[approved.length - 1]!
const d = dataOf(canonical)
const childSessionId = String(d.childSessionId)
const parentSessionId = String(d.sessionId)
check('E3 journal terminal row type is the real ask plugin record', canonical.type.startsWith('plugin:opentui/ask/'), 'plugin:opentui/ask/*', canonical.type)
check('E3 childSessionId is a real non-empty id, distinct from parent', childSessionId.length > 0 && childSessionId !== parentSessionId, `non-empty and != ${parentSessionId}`, childSessionId)
// The real plugin:opentui/ask/responded payload carries only `sessionId`
// (the parent wire addressee) + `childSessionId`; it has NO `parentSessionId`
// field. Comparing two fields (`d.sessionId === d.parentSessionId`) is a schema
// mismatch (right side undefined -> FAIL). The parent id is already derived
// above from the SAME payload.sessionId, so assert the addressee matches it.
check('E3 sessionId equals parentSessionId (wire addressee stays parent)', d.sessionId === parentSessionId, parentSessionId, d.sessionId)
check('E3 askKind=approval (permission-ask path)', d.askKind === 'approval', 'approval', d.askKind)
check('E3 settleReason=answered', d.settleReason === 'answered', 'answered', d.settleReason)
check('E3 outcome=approved', d.outcome === 'approved', 'approved', d.outcome)
log(`  · real childSessionId=${childSessionId} parentSessionId=${parentSessionId} eventId=${String(d.eventId)}`)

// --- 6. real projection (no synthetic childSessionId) -----------------------
const { bridgeReplayRowsToSeamTranscript } = await import('../../packages/shell/src/client/bridge-session-seam.ts')
const { deriveAskOutcomeNotice } = await import('../../packages/shell/src/client/ask-outcome.ts')

// The seam reads journal.replay{sessionId: parent}; feed only the parent
// session's rows so a CHILD's own gated tool/call pair cannot pollute the
// PARENT transcript ask-row count (the child ask plugin row is stored in the
// PARENT journal with sessionId=parent, so it is kept).
const parentReplayRows = replayRows.filter((r) => {
  const sd = dataOf(r).sessionId
  return sd === undefined || sd === parentSessionId
})
const transcript = bridgeReplayRowsToSeamTranscript(parentReplayRows, 0, parentSessionId)
const eventId = String(d.eventId)
const parentAskRows = transcript.filter((r) => r.kind === 'ask')
const noticeRows = transcript.filter((r) => r.kind === 'notice' && r.id === `ask-outcome:${eventId}`)
check('E4 projection: parent transcript ask rows == 0', parentAskRows.length === 0, '0 ask rows', parentAskRows.length)
check('E4 projection: one ask-outcome notice for the child eventId', noticeRows.length === 1, `1 notice ask-outcome:${eventId}`, noticeRows.length)
// Replay notice rows are {kind,id,text,final} with NO sessionID field — that
// field exists only on the live event path (bridge-session-seam.ts:828/:5281).
// Verify the notice's parent attribution from the REAL journal row that
// produced it (payload.sessionId), never from a field on the replay row.
const noticeOwner = noticeParentFromJournal(parentReplayRows, eventId, parentSessionId)
check('E4 projection: notice parent attribution from real journal payload.sessionId',
  noticeRows[0] !== undefined && noticeOwner.ok, parentSessionId, noticeOwner.sessionId)
plog(`transcript-ask-rows=${parentAskRows.length} child-notice-rows=${noticeRows.length} journal-parent-sessionId=${noticeOwner.sessionId ?? 'NONE'}`)

const notice = deriveAskOutcomeNotice({
  eventId,
  sessionId: parentSessionId,
  anchorSeq: canonical.seq ?? replayRows.indexOf(canonical) + 1,
  settleReason: d.settleReason as string | undefined,
  journalKind: 'ask.responded',
  askKind: d.askKind as string | undefined,
  outcome: d.outcome as string | undefined,
  source: d.source as string | undefined,
  childSessionId,
})
check('E4 deriveAskOutcomeNotice returns the child notice', notice !== undefined, 'AskOutcomeNotice', notice)
check('E4 notice id / text / sessionId', notice?.id === `ask-outcome:${eventId}` && notice?.text === '已收到该请求的回答' && notice?.sessionId === parentSessionId, `${eventId} / 已收到该请求的回答 / ${parentSessionId}`, notice)
const suppressedParent = deriveAskOutcomeNotice({
  eventId, sessionId: parentSessionId, anchorSeq: 1,
  settleReason: 'answered', journalKind: 'ask.responded', askKind: 'questions', outcome: 'approved', source: 'answer',
})
// Retained A13 negative control from the (now BLOCKED) questions path: a
// parent questions+approved row WITHOUT childSessionId still carries its own
// answers, so no notice. It is unchanged by the new permission path.
check('E4 parent questions+approved(no child) stays suppressed (A13)', suppressedParent === undefined, 'undefined', suppressedParent)

// E5 dedup: in-memory duplicate only, never written back to the journal.
const maxSeq = Math.max(...parentReplayRows.map((r) => r.seq ?? 0), 0) + 1
const dedupRows = [...parentReplayRows, { seq: maxSeq, type: canonical.type, payload: { ...d } }]
const dedupTranscript = bridgeReplayRowsToSeamTranscript(dedupRows, 0, parentSessionId)
const dedupNotices = dedupTranscript.filter((r) => r.kind === 'notice' && r.id === `ask-outcome:${eventId}`)
check('E5 duplicate replay row still yields exactly one notice', dedupNotices.length === 1, '1 notice', dedupNotices.length)
const maxSeqNotice = deriveAskOutcomeNotice({
  eventId, sessionId: parentSessionId, anchorSeq: maxSeq,
  settleReason: 'answered', journalKind: 'ask.responded', askKind: 'approval', outcome: 'approved', source: 'answer', childSessionId,
})
check('E5 max-seq terminal wins the anchorSeq', maxSeqNotice?.anchorSeq === maxSeq, maxSeq, maxSeqNotice?.anchorSeq)
plog(`dedup-notice-rows=${dedupNotices.length} max-seq=${maxSeq}`)

// E6 /btw zero: the ONLY text submitted to the real TUI is the parent marker
// prompt; the driver never types /btw and never creates a side session.
check('E6 no /btw was submitted to the TUI', submittedTexts.length === 1 && !submittedTexts.some((t) => t.includes('/btw')), '1 prompt, no /btw', submittedTexts)
// E6 sessionInfo zero-new: sessionInfo() counts user/assistant rows only
// (bridge-session-seam.ts:3522-3525), never ask/notice rows. Project the real
// parent journal with and without the child approved row and assert the
// user/assistant counts are identical — a real projection check, no invented
// snapshot and no extra session created by the answer path.
const countUserAssistant = (rows: Array<{ kind: string }>) =>
  rows.filter((r) => r.kind === 'user' || r.kind === 'assistant').length
const withoutChild = bridgeReplayRowsToSeamTranscript(parentReplayRows.filter((r) => r !== canonical), 0)
const infoWithChild = bridgeReplayRowsToSeamTranscript(parentReplayRows, 0)
check('E6 sessionInfo zero-new (user/assistant counts unchanged by the child notice)',
  countUserAssistant(withoutChild) === countUserAssistant(infoWithChild),
  `${countUserAssistant(withoutChild)}==${countUserAssistant(infoWithChild)}`,
  `${countUserAssistant(withoutChild)}/${countUserAssistant(infoWithChild)}`)
plog(`btw-submits=${submittedTexts.filter((t) => t.includes('/btw')).length} sessioninfo-user-assistant=${countUserAssistant(infoWithChild)}`)

// --- 7. harness audit + cleanup ---------------------------------------------
const audit = [
  `driver=${join(HERE, 'r6-child-routing.ts')}`,
  `mock=${MOCK}`,
  `companion=registry(@aiwayds/dsh-subagent-registry)`,
  `child-agent=r6-asker permission=ask f1-repin=product-code(unchanged)`,
  `child-tool=${approvedToolRe.exec(mockOutput)?.[1] ?? 'NONE'} (discovered from request tools, not ask_user_question)`,
  `approval-card=allow-once(Enter) escalation-keys-never-sent=true`,
  `registry-direct-call=false appendPluginRecord-mock=false synthetic-child-id=false always-grant=false`,
  `profile=${PROFILE} (source: profile-name.mjs DEFAULT_PROFILE)`,
  `e8-always-grant-scan-hits=${escalationHits.length}`,
  `frames-observed=${framesObserved} card-closed-observed=${cardClosed}`,
  `frame-decisions=${decisions.map((x) => `#${x.step}:${x.key}`).join(' ')}`,
].join('\n') + '\n'
writeFileSync(AUDIT_LOG, audit)

cleanup() // unified teardown: tmux session + scratch host + mock child

flush()
console.log(`\nR6 child-routing driver: ${passes} PASS, ${failures} FAIL — ${failures === 0 ? 'PASS' : 'FAIL'}`)
process.exitCode = failures === 0 ? 0 : 1
