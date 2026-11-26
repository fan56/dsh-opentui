#!/usr/bin/env bun
/**
 * R6-029 scratch-only driver — 0.29 real-client directed E2E.
 *
 *   bun verify/e2e-flows/r6-029-driver.ts [--out <dir>] [--cap <n>] [--grace <n>] [--no-inject-cap]
 *
 * COVERAGE CONTRACT (honest split — no faked 50-round UI run):
 *   UI SMOKE (real TUI, private tmux + scratch home, dedicated loop mock):
 *     1. Ctrl+G while the looper child is RUNNING opens the subagents panel and
 *        the child row is painted; Enter opens the transcript layer and the
 *        multi-line tool output lines appear on the real pane.
 *     2. The shipped maxRounds wrap-up is steered into the running child. By
 *        default the cap is INJECTED into the scratch config at a SHORT value
 *        (default 4, not the shipped default — a full shipped-default run is
 *        cost prohibitive). With --no-inject-cap the scratch config keys are
 *        left unset so the shipped default applies; CAP itself then defaults
 *        to DEFAULT_SUBAGENT_ROUND_LIMITS.maxRounds, read live at startup from
 *        packages/shell/src/subagent-policy.ts, so the labels and round-count
 *        assertion stay consistent. Only an explicit --cap overrides either
 *        mode. The wrap-up wait budget scales with CAP * LOOP_DELAY (floor 90s,
 *        otherwise two full passes + 30s) so a full shipped-default run is not
 *        timed out early. The child yields and no `⏻` hard-stop marker appears
 *        with grace 0.
 *   PROTOCOL/HARNESS (real shipped pure functions, r6-029-lib.mjs):
 *     3. Transcript buffer head-drop/64 KiB cap/tail visible + multi-line tool
 *        output split; 4. DEFAULTS maxRounds=50 grace=0, round-50 wrap-up,
 *        grace 0 never force-stops.
 *   The UI cap (injected or default) is reported in the summary; every label
 *   is derived from CAP and the injection mode, never hard-coded.
 *
 * Exits 0 = all checks pass, 1 = assertion failure, 2 = BLOCKED (real chain
 * unreachable). Scratch home only; never reads/writes the operator ~/.dsh.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  createWriteStream, existsSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, writeFileSync, rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACTIVE_PROFILE, bootIdle, childRowVisible, decideApprovalKey, frameHasAll,
  hasHardStopMarker, hasPaneContent, isApprovalCard, makeCleanup, stripAnsi,
  transcriptLineVisible,
} from './r6-harness-lib.mjs'
import { run029ProtocolChecks } from './r6-029-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const LAUNCHER = join(REPO, 'dsh-opentui')
const MOCK = join(HERE, 'r6-029-mock.mjs')
const SETUP = join(HERE, 'setup-home.mjs')
const PROFILE = ACTIVE_PROFILE
const GEOMETRY = { x: 120, y: 36 }
const FAKE_KEY = 'e2e-fake-key'
const PARENT_MARKER = 'E2E029_PARENT'
const CHILD_LABEL = 'r6-029-looper'
const TOOL_L1 = 'E2E-029-TOOL-L1'
const TOOL_L2 = 'E2E-029-TOOL-L2'
const TOOL_L3 = 'E2E-029-TOOL-L3'
const WRAP_DONE = 'E2E-029-WRAP-DONE'
const PARENT_DONE = 'E2E-029-PARENT-DONE'

const argv = process.argv.slice(2)
const opt = (name: string, def: string) => {
  const inline = argv.find((a) => a.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : def
}
const OUT = resolve(opt('out', mkdtempSync(join(tmpdir(), 'r6-029-'))))
mkdirSync(OUT, { recursive: true })
const NO_INJECT_CAP = process.argv.includes('--no-inject-cap')
// --no-inject-cap leaves the scratch config keys unset, so the shipped policy
// governs the real run. Read its cap from the source of truth rather than
// repeating a literal: a policy change must move the expected round count with
// it. Bun supports top-level await; an explicit --cap still overrides below.
const POLICY = join(REPO, 'packages', 'shell', 'src', 'subagent-policy.ts')
const policyModule = await import(POLICY)
const SHIPPED_MAX_ROUNDS: number = policyModule.DEFAULT_SUBAGENT_ROUND_LIMITS.maxRounds
// CAP must mirror the shipped cap in --no-inject-cap mode, otherwise the
// labels would claim "N rounds expected" while the real default ran a
// different count — a contradiction. Injected mode stays at a short 4.
const CAP_DEFAULT = NO_INJECT_CAP ? SHIPPED_MAX_ROUNDS : 4
const CAP = Math.max(1, Number(opt('cap', String(CAP_DEFAULT))) || CAP_DEFAULT)
const GRACE = Math.max(0, Number(opt('grace', '0')) || 0)
// Single source for every check/audit/coverage label: injected short cap vs
// the shipped default with the scratch config keys absent.
const capLabel = () => NO_INJECT_CAP
  ? `shipped default (scratch maxRounds unset; ${CAP} rounds expected)`
  : `injected ${CAP}/${GRACE}`
const uiNote = () => NO_INJECT_CAP
  ? `Ctrl+G panel + transcript + multi-line tool output + wrap-up smoke at the SHIPPED DEFAULT cap (scratch maxRounds/maxRoundsGrace unset; ${CAP} rounds expected); scratch approval gate off`
  : `Ctrl+G panel + transcript + multi-line tool output + wrap-up smoke at an INJECTED short cap ${CAP}/${GRACE}; not necessarily a ${SHIPPED_MAX_ROUNDS}-round UI run; scratch approval gate off`
const LOOP_DELAY = Math.max(200, Number(opt('loop-delay-ms', '1200')) || 1200)
const CONSOLE_LOG = join(OUT, '20-r6-029-console.log')
const MOCK_LOG = join(OUT, '21-r6-029-mock.log')
const FRAMES_LOG = join(OUT, '22-r6-029-frames.log')
const JOURNAL_SUMMARY = join(OUT, '23-r6-029-journal-summary.json')
const CATALOG_SUMMARY = join(OUT, '24-r6-029-catalog-summary.json')
const SUMMARY = join(OUT, 'assert-summary.json')
const AUDIT_LOG = join(OUT, '40-r6-029-audit.log')
const SESS = `r6029-${process.pid}`
const TMUX_SOCKET = `r6029-${process.pid}`

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const sh = (cmd: string, args: string[], opts: Record<string, unknown> = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', ...opts })
const tmux = (...a: string[]) => sh('tmux', ['-L', TMUX_SOCKET, ...a])
const tmuxOut = (...a: string[]) => { const r = tmux(...a); return r.status === 0 ? String(r.stdout ?? '') : '' }
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
function log(message: string) {
  const line = `${new Date().toISOString()} ${message}`
  console.log(line)
  consoleLines.push(line)
}
function check(label: string, ok: boolean, expected: unknown, actual: unknown) {
  if (ok) { passes++; log(`  PASS ${label}`) }
  else { failures++; log(`  FAIL ${label}\n       expected: ${JSON.stringify(expected)}\n       actual:   ${JSON.stringify(actual)}`) }
}
// --- diagnostics: real journal / tool catalog / captured frames ------------
interface JRow { seq?: number; type?: string; payload?: Record<string, unknown>; data?: Record<string, unknown>; [k: string]: unknown }
const payloadOf = (row: JRow) => (row.payload ?? row.data ?? row) as Record<string, unknown>

/** Read the REAL compressed journal rows from the scratch home (never ~/.dsh). */
function readJournalRows(): JRow[] {
  const out: JRow[] = []
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
          try { out.push(JSON.parse(line) as JRow) } catch { /* partial line */ }
        }
      } catch { /* unreadable log: skip, never invent rows */ }
    }
  }
  visit(root, 0)
  return out
}

/** Real tool/result rows that failed (isError) or were rejected as INVALID_ARGS. */
function scanToolErrors(rows: JRow[]): Array<Record<string, unknown>> {
  const hits: Array<Record<string, unknown>> = []
  for (const row of rows) {
    const p = payloadOf(row)
    const text = JSON.stringify(row)
    const isTool = String(row.type ?? '').includes('tool') || p.kind === 'tool' || p.role === 'tool'
    const isError = p.isError === true || (isTool && p.ok === false)
    const invalidArgs = text.includes('INVALID_ARGS')
    if (!isTool && !invalidArgs) continue
    if (!isError && !invalidArgs) continue
    hits.push({
      seq: row.seq, type: row.type, isError, invalidArgs,
      name: p.name ?? p.tool ?? undefined, callId: p.callId ?? p.toolCallId ?? undefined,
      output: String(p.output ?? p.message ?? p.text ?? p.error ?? '').slice(0, 500),
      raw: text.slice(0, 500),
    })
  }
  return hits
}

/**
 * Approval gate evidence: `approval/asked` and its `rejected` terminal. A
 * rejected child bash tool never produces stdout, so the transcript assertions
 * would otherwise wait for output that can never exist. Detect it from the
 * REAL journal and FAIL explicitly.
 */
function scanApprovalRejections(rows: JRow[]): Array<Record<string, unknown>> {
  const hits: Array<Record<string, unknown>> = []
  for (const row of rows) {
    const p = payloadOf(row)
    const text = JSON.stringify(row)
    const type = String(row.type ?? '')
    const isApproval = /approval|ask\//i.test(type) || p.askKind === 'approval' || p.kind === 'approval'
    const rejected = text.includes('rejected') || p.outcome === 'rejected'
      || p.settleReason === 'rejected' || p.decision === 'rejected'
    const asked = text.includes('asked') || p.kind === 'ask.requested'
    if (!isApproval || (!rejected && !asked)) continue
    hits.push({
      seq: row.seq, type, kind: p.kind, askKind: p.askKind,
      outcome: p.outcome, settleReason: p.settleReason,
      raw: text.slice(0, 500),
    })
  }
  return hits
}

/** Fail fast (not BLOCKED) when the approval gate rejected the child tool. */
function failOnApprovalRejections(stage: string) {
  const hits = scanApprovalRejections(readJournalRows())
  check(`029-UI no approval/asked→rejected before ${stage}`, hits.length === 0, '0 approval rejections', hits)
  if (hits.length > 0) {
    persistDiagnostics(`approval-rejected:${stage}`)
    cleanup(); flush(); process.exit(1)
  }
  return hits
}

/** Tool catalog + delegation selection actually observed on the mock wire. */
function catalogSummary(): Record<string, unknown> {
  const reqLines = mockOutput.split('\n').filter((l) => l.startsWith('req '))
  const names = [...new Set(reqLines.flatMap((l) => {
    const m = /toolNames=\[([^\]]*)\]/.exec(l)
    return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : []
  }))]
  let companionMounted = false
  try {
    const patch = join(home, 'profiles', PROFILE, 'cordis.patch.yml')
    companionMounted = existsSync(patch) && readFileSync(patch, 'utf8').includes('dsh-subagent-registry')
  } catch { /* best effort */ }
  return {
    toolNames: names,
    useAgentExact: names.includes('use_agent'),
    lastRequest: reqLines.at(-1) ?? '',
    delegateSelections: mockOutput.split('\n').filter((l) => l.startsWith('phase=029-dispatch')),
    companionMounted,
    childAgentFile: home ? existsSync(join(home, 'agents', `${CHILD_LABEL}.md`)) : false,
  }
}

/** Persist every exit path's evidence: frames, real journal summary, catalog. */
function persistDiagnostics(label: string) {
  try {
    writeFileSync(FRAMES_LOG,
      `diagnostic=${label}\n` + capturedFrames.map((f, i) => `--- frame#${i} ---\n${f}`).join('\n') + '\n')
  } catch { /* best effort */ }
  let rows: JRow[] = []
  try { rows = readJournalRows() } catch { /* best effort */ }
  const errors = scanToolErrors(rows)
  const typeCounts: Record<string, number> = {}
  for (const r of rows) { const t = String(r.type ?? ''); typeCounts[t] = (typeCounts[t] ?? 0) + 1 }
  try {
    writeFileSync(JOURNAL_SUMMARY, JSON.stringify({
      label, rowCount: rows.length, typeCounts,
      toolErrors: errors, approvalRejections: scanApprovalRejections(rows),
    }, null, 2) + '\n')
  } catch { /* best effort */ }
  try {
    writeFileSync(CATALOG_SUMMARY, JSON.stringify({ label, ...catalogSummary() }, null, 2) + '\n')
  } catch { /* best effort */ }
  log(`  · diagnostics persisted (${label}): frames / journal / catalog`)
}

function blocked(reason: string): never {
  blockedReason = reason
  log(`BLOCKED: ${reason}`)
  persistDiagnostics(`blocked:${reason}`)
  cleanup()
  flush()
  process.exit(2)
}

// Real results of the protocol/harness checks (section 6). null until they
// actually run — blocked/fatal paths flush earlier. The note is derived from
// THESE results, never a static "proven" claim.
interface ProtocolCheck { label: string; ok: boolean; expected: unknown; actual: unknown }
let protocolChecks: ProtocolCheck[] | null = null
function protocolNote(): string {
  const base = `default maxRounds=${SHIPPED_MAX_ROUNDS} / grace=0 / round-${SHIPPED_MAX_ROUNDS} wrap-up`
  if (!protocolChecks) return `${base} / cap rules NOT RUN`
  const passed = protocolChecks.filter((c) => c.ok).length
  const failed = protocolChecks.length - passed
  const failing = failed
    ? `; failing: ${protocolChecks.filter((c) => !c.ok).map((c) => c.label).join(', ')}`
    : ''
  return `${base} / ${passed}/${protocolChecks.length} 029-P protocol checks passed at the shipped policy seam (${failed} failed)${failing}`
}
function flush() {
  writeFileSync(CONSOLE_LOG, consoleLines.join('\n') + '\n')
  writeFileSync(SUMMARY, JSON.stringify({
    passes, failures, blocked: blockedReason || undefined,
    coverage: {
      uiCap: CAP, uiGrace: GRACE,
      capInjected: !NO_INJECT_CAP,
      capLabel: capLabel(),
      approvalGate: 'off (scratch config only; real home untouched)',
      uiNote: uiNote(),
      protocolNote: protocolNote(),
    },
    evidence: {
      console: CONSOLE_LOG, mock: MOCK_LOG, audit: AUDIT_LOG,
      frames: FRAMES_LOG, journalSummary: JOURNAL_SUMMARY, catalogSummary: CATALOG_SUMMARY,
    },
    at: new Date().toISOString(),
  }, null, 2) + '\n')
}

// --- unified teardown (same pattern as r6-child-routing.ts) -----------------
let home = ''
let mockChild: ReturnType<typeof spawn> | null = null
let mockLogStream: ReturnType<typeof createWriteStream> | null = null
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
function reapHost() {
  if (!home) return
  const lock = join(home, `opentui-host.${PROFILE}.json`)
  let pid = 0
  try { pid = Number(JSON.parse(readFileSync(lock, 'utf8')).pid) || 0 } catch { /* gone */ }
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
process.on('exit', cleanup)
const fatal = (err: unknown) => {
  log(`ERROR: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  persistDiagnostics('error')
  cleanup(); flush(); process.exit(1)
}
process.on('uncaughtException', fatal)
process.on('unhandledRejection', fatal)

log(`R6-029 driver start ${new Date().toISOString()} — out ${OUT}, uiCap=${CAP}, uiGrace=${GRACE}, capSource=${capLabel()}`)

// --- 1. scratch mock + profile ---------------------------------------------
mockChild = spawn(process.execPath, [MOCK, '--port', '0', '--loop-delay-ms', String(LOOP_DELAY)], { stdio: ['ignore', 'pipe', 'pipe'] })
const child = mockChild
mockLogStream = createWriteStream(MOCK_LOG)
const logStream = mockLogStream
let mockOutput = ''
child.stdout!.on('data', (d) => { const t = String(d); mockOutput += t; logStream.write(t) })
child.stderr!.on('data', (d) => logStream.write(String(d)))

async function mockPort(): Promise<number> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const m = /ready http:\/\/127\.0\.0\.1:(\d+)/.exec(mockOutput)
    if (m) return Number(m[1])
    await sleep(50)
  }
  blocked('r6-029 loop mock did not report its bound port')
}
const PORT = await mockPort()
log(`  · r6-029 loop mock on 127.0.0.1:${PORT}`)

home = opt('home', '')
let ws = opt('ws', '')
if (!home || !ws) {
  home = mkdtempSync(join(tmpdir(), 'r6-029-home-'))
  ws = mkdtempSync(join(tmpdir(), 'r6-029-ws-'))
}
// SCRATCH-ONLY no-approval config: the provisioner's documented escape hatch
// (provision-inproc-profile.mjs:565/579) bakes `permission.defaultPreset:
// danger-full-access` and `approval enabled:false` into THIS scratch patch.
// The 0.29 transcript/wrapup smoke must not be blocked by an approval card —
// a rejected child bash tool produces no stdout at all. The operator home is
// never touched; no other scenario receives this env.
const setupEnv = { ...process.env, DSH_OPENTUI_APPROVAL_GATE: 'off' }
const setup = sh('node', [SETUP, '--home', home, '--workspace', ws, '--port', String(PORT), '--companions', 'registry', '--r6-ask', '--no-reasoning-effort'], { env: setupEnv })
if (setup.status !== 0) blocked(`scratch profile provision failed (exit ${setup.status}): ${String(setup.stderr ?? setup.stdout ?? '').slice(-1200)}`)
// Verify the escape hatch is present in the scratch patch (the template keeps
// its `!!js process.env.DSH_OPENTUI_APPROVAL_GATE` expression; the runtime
// client env below is what makes it evaluate to off, so both are checked).
const scratchPatch = join(home, 'profiles', PROFILE, 'cordis.patch.yml')
let patchHatch = ''
try { patchHatch = existsSync(scratchPatch) ? readFileSync(scratchPatch, 'utf8') : '' } catch { /* assertion below */ }
const hatchPresent = patchHatch.includes('DSH_OPENTUI_APPROVAL_GATE')
  || (/defaultPreset:\s*danger-full-access/.test(patchHatch) && /enabled:\s*false/.test(patchHatch))
check('029-UI scratch patch carries the approval-gate escape hatch',
  hatchPresent, 'DSH_OPENTUI_APPROVAL_GATE in scratch patch',
  hatchPresent ? 'present' : `patch=${scratchPatch} (see catalog summary)`)

// Register the by-name loop child (the agent corpus the real use_agent tool
// dispatches into). Written DIRECTLY into the scratch home, never ~/.dsh.
const agentsDir = join(home, 'agents')
mkdirSync(agentsDir, { recursive: true })
writeFileSync(join(agentsDir, `${CHILD_LABEL}.md`), [
  '---',
  `name: ${CHILD_LABEL}`,
  '---',
  '',
  'E2E029_CHILD',
  '',
  'Keep calling the prepared bash tool with the multi-line printf output each round. ' +
  'When a wrap-up message arrives, stop calling tools, summarize and return your final answer.',
  '',
].join('\n'))

// UI cap mode: the ladder reads this scratch config live. With --no-inject-cap
// both keys are removed (not written) so the shipped default applies; the
// default-50 rule is independently asserted at the policy seam.
const cfgPath = join(home, 'profiles', PROFILE, 'config.json')
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {}
if (NO_INJECT_CAP) {
  delete cfg.maxRounds
  delete cfg.maxRoundsGrace
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n')
  const onDisk = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {}
  check('029-UI scratch profile leaves maxRounds unset (--no-inject-cap)',
    onDisk.maxRounds === undefined && onDisk.maxRoundsGrace === undefined,
    'unset', `maxRounds=${onDisk.maxRounds} maxRoundsGrace=${onDisk.maxRoundsGrace}`)
} else {
  cfg.maxRounds = CAP
  cfg.maxRoundsGrace = GRACE
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n')
  check('029-UI scratch profile injects short maxRounds for the UI smoke',
    cfg.maxRounds === CAP && cfg.maxRoundsGrace === GRACE,
    `${CAP}/${GRACE}`, `${cfg.maxRounds}/${cfg.maxRoundsGrace}`)
}

// --- 2. real TUI boot -------------------------------------------------------
async function waitFor(pred: (out: string) => boolean, timeoutMs: number, everyMs = 300) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    const frame = capture()
    if (hasPaneContent(frame)) last = frame
    if (last && pred(last)) return { ok: true, out: last }
    await sleep(everyMs)
  }
  return { ok: false, out: last }
}
async function waitMock(pred: () => boolean, timeoutMs: number, everyMs = 200) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { if (pred()) return true; await sleep(everyMs) }
  return false
}
async function submit(text: string) {
  for (const ch of text) { sendKeys('-l', ch); await sleep(45) }
  await sleep(250)
  if (!capture().includes(text.slice(-8))) {
    for (let i = 0; i < text.length + 6; i++) { sendKeys('BSpace'); await sleep(25) }
    await sleep(120)
    for (const ch of text) { sendKeys('-l', ch); await sleep(45) }
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
  // Same scratch-only escape hatch at RUNTIME: the patch's `!!js` preset/gate
  // expressions are evaluated from the client's env, so off must be here too.
  'DSH_OPENTUI_APPROVAL_GATE=off',
  'TERM=xterm-256color',
].join(' ')
// No `bootEnv.includes('...=off')` assertion here: the string is built by the
// line above, so that check was tautological. The real gate-off evidence is
// the scratch patch escape-hatch check earlier plus the approval-card watcher.
const errLog = join(OUT, 'r6-029-client.err.log')
const bootCmd = `${bootEnv} "${LAUNCHER}" --client 2>"${errLog}"`
const boot = tmux('new-session', '-d', '-x', String(GEOMETRY.x), '-y', String(GEOMETRY.y), '-s', SESS, '-c', ws, bootCmd)
if (boot.status !== 0) blocked(`tmux boot failed: ${boot.stderr}`)
const up = await waitFor((o) => bootIdle(o), 90_000, 700)
if (!up.ok) blocked(`client did not reach idle within 90s; pane tail: ${stripAnsi(up.out).split('\n').slice(-6).join(' | ')}`)
log('  · real TUI client reached idle (scratch home)')

// --- 3. dispatch + RUNNING child -------------------------------------------
await submit(`Dispatch the loop child and report when it settles. ${PARENT_MARKER}`)

// PROACTIVE approval handling — started BEFORE the first child tool call, not
// after any transcript assertion. Primary defense is the scratch gate-off
// config; this watcher is the belt-and-suspenders path using r6-child-routing's
// safe key discipline: Enter (allow once) ONLY, never a/s/Esc.
let approvalSent = false
const approvalWatchDeadline = Date.now() + 60_000
void (async () => {
  while (!approvalSent && Date.now() < approvalWatchDeadline) {
    const frame = stripAnsi(capture())
    if (isApprovalCard(frame)) {
      const d = decideApprovalKey(frame)
      if (d?.key === 'Enter') {
        sendKeys('Enter'); approvalSent = true
        log(`  · approval card allowed once from painted label (${d.marker})`)
      } else if (d?.why === 'approval-card-confirm-label-not-painted' && /\besc\b/i.test(frame)) {
        // Observed 029 card paints only `⚠ Approval: bash` + `esc`; DialogConfirm
        // binds return/Enter to the PRIMARY confirm (allow once). Enter stays
        // the safe key — escalation a/s and reject Esc are NEVER sent.
        sendKeys('Enter'); approvalSent = true
        log('  · approval card allowed once via Enter (label absent, esc reject visible)')
      } else {
        log(`  · approval card frame not actionable yet (${d?.why ?? 'no-card'})`)
      }
    }
    if (mockOutput.includes('phase=029-loop round=1')) break
    await sleep(250)
  }
})().catch((e) => log(`  · approval watcher error: ${String(e)}`))

const dispatched = await waitMock(() => mockOutput.includes('phase=029-dispatch'), 60_000)
if (!dispatched) blocked('real use_agent dispatch phase never reached the loop mock')
check('029-UI real use_agent dispatch reached the loop mock', dispatched, 'phase=029-dispatch', dispatched)
const delegateLine = mockOutput.split('\n').find((l) => l.startsWith('phase=029-dispatch')) ?? ''
check('029-UI delegation used the exact use_agent tool with its own {agent,prompt} schema',
  /delegate=use_agent schema=use_agent\{agent,prompt\}(?!:NO-CATALOG)/.test(delegateLine),
  'delegate=use_agent schema=use_agent{agent,prompt}', delegateLine)

// FAIL-FAST before waiting for the child round: a rejected dispatch (native
// `subagent` with the use_agent arg shape -> INVALID_ARGS) used to surface only
// as a generic "no round 1" BLOCKED. Scan the REAL journal tool/result rows;
// any isError / INVALID_ARGS is a hard assertion failure, with frames + journal
// + catalog persisted, never a masked BLOCKED.
let toolErrors: Array<Record<string, unknown>> = []
const errorScanDeadline = Date.now() + 8_000
while (Date.now() < errorScanDeadline) {
  toolErrors = scanToolErrors(readJournalRows())
  if (toolErrors.length > 0) break
  if (/phase=029-loop round=1\b/.test(mockOutput)) break
  await sleep(300)
}
if (toolErrors.length > 0) {
  check('029-UI dispatch tool/result has no isError / INVALID_ARGS', false, '0 tool errors', toolErrors)
  persistDiagnostics('tool-error-fail-fast')
  cleanup(); flush()
  process.exit(1)
}
check('029-UI dispatch tool/result has no isError / INVALID_ARGS', true, '0 tool errors', 0)

const running = await waitMock(() => /phase=029-loop round=1\b/.test(mockOutput), 30_000)
if (!running) blocked('looper child never issued round 1 (no running child to open Ctrl+G on)')
log(`  · looper child RUNNING at round 1; mock: ${mockOutput.split('\n').filter((l) => l.startsWith('phase=')).slice(-3).join(' | ')}`)

// A rejected approval means the child bash never ran and no tool output can
// ever appear — FAIL explicitly instead of waiting on a transcript assertion.
failOnApprovalRejections('Ctrl+G panel')

// --- 4. Ctrl+G while child runs -> panel row -> transcript layer -----------
sendKeys('C-g')
const panel = await waitFor((o) => childRowVisible(o, CHILD_LABEL), 25_000, 300)
check('029-UI Ctrl+G opens subagents panel with the running child row',
  panel.ok, `${CHILD_LABEL} row`, stripAnsi(panel.out).split('\n').filter((l) => l.toLowerCase().includes('r6-029')).slice(0, 2))
if (!panel.ok) blocked('Ctrl+G panel did not paint the running child row; UI transcript coverage unreachable')

sendKeys('Enter')
// Re-check immediately before the transcript assertion: a card could still
// have been rejected between the panel gate and this layer.
failOnApprovalRejections('transcript assertion')
const transcript = await waitFor((o) => transcriptLineVisible(o, TOOL_L1) && transcriptLineVisible(o, TOOL_L2), 25_000, 300)
check('029-UI real-time transcript paints multi-line tool output (L1 + L2)',
  transcript.ok, `${TOOL_L1} + ${TOOL_L2}`,
  stripAnsi(transcript.out).split('\n').filter((l) => l.includes('E2E-029-TOOL')).slice(0, 6))
// L3 is a stronger check (fully preserved third line); assert separately so a
// short transcript window cannot silently swallow a partial result.
check('029-UI third tool-output line preserved on the real pane',
  stripAnsi(transcript.out).includes(TOOL_L3), TOOL_L3,
  stripAnsi(transcript.out).includes(TOOL_L3) ? 'present' : 'not in visible window')

// Close transcript layer, then the list layer, so the parent turn can settle.
sendKeys('Escape')
await sleep(200)
sendKeys('Escape')
await sleep(200)

// Approval is owned exclusively by the proactive watcher started before the
// first child tool (Enter only — no second key, never a/s/Esc).

// --- 5. wrap-up lands at the injected cap; grace 0 never hard-stops --------
// No wrap-up claim is allowed while an approval ask is still blocking the
// loop: a rejected child tool burns zero rounds and never settles.
failOnApprovalRejections('wrap-up verification')
// A real shipped-default child genuinely burns CAP rounds at LOOP_DELAY each,
// so a fixed 90s budget can time out a legitimate full run. Budget two full
// passes plus a 30s margin, never below the original 90s floor for short
// injected caps. Deriving this from CAP keeps the wait honest in both modes.
const WRAPUP_WAIT_MS = Math.max(90_000, CAP * LOOP_DELAY * 2 + 30_000)
const wrapped = await waitMock(() => mockOutput.includes('phase=029-wrapup-settled'), WRAPUP_WAIT_MS, 300)
check(`029-UI shipped wrap-up was steered into the running child (${capLabel()})`,
  wrapped, 'phase=029-wrapup-settled', wrapped)
if (!wrapped) blocked('maxRounds wrap-up never reached the child; 0.29 UI wrap-up coverage unreachable')
const loopRounds = [...mockOutput.matchAll(/phase=029-loop round=(\d+)/g)].map((m) => Number(m[1]))
const lastLoopRound = loopRounds.length ? Math.max(...loopRounds) : 0
check(`029-UI wrap-up fired at the configured cap (${capLabel()})`,
  lastLoopRound === CAP, CAP, lastLoopRound)
check('029-UI grace 0: wrap-up did NOT force-stop the child',
  !mockOutput.includes('phase=029-force-stop') && !capturedFrames.some(hasHardStopMarker),
  'no force-stop phase / no ⏻ marker',
  `forceStopPhase=${mockOutput.includes('phase=029-force-stop')} hardStopMarkers=${capturedFrames.filter(hasHardStopMarker).length}`)

const settled = await waitFor((o) => o.includes(WRAP_DONE) || o.includes(PARENT_DONE), 60_000, 400)
check('029-UI child yielded to wrap-up and the parent received its final result',
  settled.ok, `${WRAP_DONE} / ${PARENT_DONE}`,
  stripAnsi(settled.out).split('\n').filter((l) => l.includes('E2E-029-')).slice(-4))

// One composite assertion so a wrap-up can never be reported as covered while
// approval blocked it: round===cap AND child settled AND parent finalized AND
// no approval rejection anywhere in the real journal.
const finalReached = mockOutput.includes('phase=029-final')
const wrapApprovalHits = scanApprovalRejections(readJournalRows())
check(`029-UI wrap-up verified unblocked: round===cap (${capLabel()}) + child settled + parent finalized`,
  wrapped && lastLoopRound === CAP && finalReached && settled.ok && wrapApprovalHits.length === 0,
  `wrapped + round===${CAP} + final + settled + 0 approval rejections`,
  `wrapped=${wrapped} rounds=${lastLoopRound} final=${finalReached} settled=${settled.ok} approvalRejections=${wrapApprovalHits.length}`)
if (wrapApprovalHits.length > 0) persistDiagnostics('wrapup-approval-rejected')

// --- 6. protocol/harness checks (real shipped pure code) -------------------
const protocol = await run029ProtocolChecks()
protocolChecks = protocol
for (const c of protocol) check(c.label, c.ok, c.expected, c.actual)

// --- 7. audit + cleanup -----------------------------------------------------
const audit = [
  `driver=${join(HERE, 'r6-029-driver.ts')}`,
  `mock=${MOCK}`,
  `profile=${PROFILE} (source: profile-name.mjs DEFAULT_PROFILE)`,
  `ui-cap=${CAP} ui-grace=${GRACE} cap-source=${capLabel()} (default ${SHIPPED_MAX_ROUNDS} also proven at policy seam)`,
  `child-agent=${CHILD_LABEL} (scratch home agent corpus, scratch only)`,
  `ctrlg-panel-child-row=${panel.ok} transcript-multiline=${transcript.ok}`,
  `wrapup-phase=${wrapped} last-loop-round=${lastLoopRound} approval-card-allowed-once=${approvalSent}`,
  `delegate=${delegateLine || 'NONE'}`,
  `dispatch-tool-errors=${toolErrors.length}`,
  `hard-stop-markers=${capturedFrames.filter(hasHardStopMarker).length}`,
  `scratch-home-only=true real-home-touched=false approval-gate=off(scratch) ${SHIPPED_MAX_ROUNDS}-round-ui-run=${lastLoopRound === SHIPPED_MAX_ROUNDS}`,
].join('\n') + '\n'
writeFileSync(AUDIT_LOG, audit)

cleanup()
flush()
console.log(`\nR6-029 driver: ${passes} PASS, ${failures} FAIL — ${failures === 0 ? 'PASS' : 'FAIL'}`)
process.exitCode = failures === 0 ? 0 : 1
