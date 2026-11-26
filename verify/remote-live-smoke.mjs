#!/usr/bin/env node
// Live e2e smoke — REAL provider turn(s) against an isolated scratch DSH_HOME.
//
//   DSH_E2E_LIVE=1 node verify/remote-live-smoke.mjs [--cols 120] [--rows 34] [--keep]
//
// This is the file `scripts/test-tier.mjs` drives when DSH_E2E_LIVE=1. It is
// deliberately small: two real turns at most. Turn 1 asks the model to replace
// PING with PONG in a token; turn 2 asks it to run one read-only bash command
// (`echo … | sed 's/PING/PONG/'`). In both cases the prompt carries only the PING
// token — the expected PONG marker is DERIVED and never pasted into the prompt,
// so a composer echo of the prompt can never satisfy an assertion.
//
// Contract (see docs/testing.md §1.3):
//   - scratch DSH_HOME + EMPTY workspace; the real ~/.dsh is never a target;
//   - credentials are REFERENCED, never copied into argv/logs: the real
//     .credentials.yaml is linked into the scratch home by path, and its
//     contents are never read into output;
//   - scratch-only approval gate: provision AND runtime set
//     DSH_OPENTUI_APPROVAL_GATE=off so the read-only bash turn cannot be blocked
//     by a permission card. This affects ONLY the scratch home — the real
//     ~/.dsh is never touched. The harness still auto-approves nothing: if a
//     permission card does appear the run is NOT RUN, no key is sent to approve
//     it;
//   - wall-clock budget (DSH_LIVE_SMOKE_WALL_MS, default 240s) bounds every
//     wait, so a hung provider cannot hang the tier;
//   - provider 401 / 429 / 5xx / auth errors count as ENVIRONMENT results only
//     when they appear in an explicit provider/error notification or on stderr
//     (stderr numbers are word-bounded: \b401\b / \b429\b / \b5\d{2}\b, so a
//     filename or counter merely containing those digits is not a verdict);
//     a bare number or "timeout" elsewhere in the pane is not an ENV verdict.
//     A hung client, missing prerequisites and wall-clock exhaustion are also
//     ENVIRONMENT results (exit 2, NOT RUN), never a product PASS/FAIL.
//     A recorded product FAIL / crash outranks an ENV reason: exit 1 wins over
//     exit 2. The text turn must first positively enter the busy state (esc
//     stop hint, short poll interval) before its reply is trusted — that busy
//     observation is recorded.
//
// Exit codes: 0 = every product assertion passed (real turns completed);
//             1 = a product assertion failed;
//             2 = NOT RUN (opt-in off, prerequisite/key/provider/network
//                 problem, approval required, or wall-clock exhausted).
import { spawnSync } from 'node:child_process'
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PROFILE } from '../packages/shell/scripts/lib/profile-name.mjs'
import { provisionScratchProfile } from './lib/scratch-profile.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LAUNCHER = join(REPO, 'dsh-opentui')
const REAL_HOME = process.env.DSH_HOME_REAL || join(homedir(), '.dsh')
const CREDENTIALS = join(REAL_HOME, '.credentials.yaml')
const PROFILE = DEFAULT_PROFILE
const SESS = `remote-live-${process.pid}`
const SOCKET = `remote-live-${process.pid}`
const OUT = join(REPO, 'verify', 'remote-live-out')
const WALL_MS = Number(process.env.DSH_LIVE_SMOKE_WALL_MS || 240_000)
const TURN_MS = Number(process.env.DSH_LIVE_SMOKE_TURN_MS || 90_000)
// Start the budget AFTER provisioning (the provisioner has its own timeout).
let DEADLINE = Infinity
const IDLE = ['提问，回车发送', 'Type a message', 'enter send']
// Prompts carry ONLY the PING token. The expected PONG marker is derived from
// it, so the full reply string is never present in the prompt/composer.
const TEXT_TOKEN = 'LIVE_SMOKE_TEXT_PING_7F3A'
const TEXT_REPLY = TEXT_TOKEN.replace('PING', 'PONG') // LIVE_SMOKE_TEXT_PONG_7F3A
const TOOL_TOKEN = 'LIVE_SMOKE_TOOL_PING_7F3A'
const TOOL_CMD = `echo ${TOOL_TOKEN} | sed 's/PING/PONG/'`
// `sed 's/PING/PONG/'` replaces only the PING substring, so the LIVE prefix is
// preserved and the token becomes LIVE_SMOKE_TOOL_PONG_7F3A. Never paste the
// expected reply into the prompt.
const TOOL_REPLY = 'LIVE_SMOKE_TOOL_PONG_7F3A'

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const COLS = Number(arg('cols', '120'))
const ROWS = Number(arg('rows', '34'))
const KEEP = process.argv.includes('--keep')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })
const tmux = (...a) => sh('tmux', ['-L', SOCKET, ...a])
const tmuxOut = (...a) => (tmux(...a).status === 0 ? tmux(...a).stdout : '')
const flat = (s) => String(s).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '')
const has = (out, marker) => flat(out).includes(flat(marker))
/** User rows are painted with a leading ❯; the composer box uses ┃. A marker
 * found only on those lines is the prompt echo, not a model answer. */
const isUserOrComposer = (line) => {
  const t = line.trimStart()
  return t.includes('❯') || t.startsWith('┃')
}
/** The full expected reply must appear on a real transcript line. */
const replyOutsideComposer = (out, marker) =>
  String(out).split('\n').some((line) => !isUserOrComposer(line) && has(line, marker))
/** A real tool result block: the marker sits on a non-user/composer transcript
 * line AND the same frame carries tool semantics (Output:/Exit code/🔧). A
 * composer echo of the prompt or generic tool wording is not proof that the
 * command actually ran — but a genuine result need not use the ⎿ glyph. */
const toolResultHas = (out, marker) =>
  /Output:|Exit code|🔧/.test(String(out)) &&
  String(out).split('\n').some((line) =>
    !isUserOrComposer(line) && has(line, marker))
const idle = (out) => IDLE.some((m) => out.includes(m))
/** The composer keeps its idle placeholder while a turn streams, so only the
 * footer busy hint (`esc stop`, `esc 停止` in zh-CN) clearing proves settle. */
const busyFrame = (out) => /esc stop|esc\s*停止/.test(String(out ?? ''))
const msgsOf = (out) => {
  const all = [...String(out).matchAll(/💬\s*(\d+)\s*\bmsgs?\b/g)]
  return all.length ? Number(all[all.length - 1][1]) : undefined
}
const toolsOf = (out) => {
  const all = [...String(out).matchAll(/🔧\s*(\d+)\s*tools/g)]
  return all.length ? Number(all[all.length - 1][1]) : undefined
}

/** Never print a copied secret: redact common key shapes from any output. */
const scrub = (text) =>
  String(text ?? '')
    .replace(/(sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|api[_-]?key["':= ]+[^\s"',}]{6,})/gi, '<redacted>')

const notRun = (reason) => {
  console.log(`NOT RUN (ENV) ${reason}`)
  process.exit(2)
}

// --- opt-in gate + preflight (must be cheap and silent on the default path) ---
if (process.env.DSH_E2E_LIVE !== '1') notRun('DSH_E2E_LIVE is not 1 (live legs are opt-in)')
for (const cmd of ['tmux', 'bun', 'dsh'])
  if (sh('which', [cmd]).status !== 0) notRun(`${cmd} not on PATH`)
if (!existsSync(LAUNCHER)) notRun(`launcher missing: ${LAUNCHER}`)
if (!existsSync(CREDENTIALS) || statSync(CREDENTIALS).size === 0)
  notRun('no provider credentials in the real DSH_HOME (path referenced, contents never read into logs)')
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

// --- scratch isolation: real provisioner, empty workspace, referenced key ---
const HOME = mkdtempSync(join(tmpdir(), 'dsh-remote-live-home-'))
const WS = mkdtempSync(join(tmpdir(), 'dsh-remote-live-ws-'))
chmodSync(HOME, 0o700)
let profileDir
try {
  // SCRATCH ONLY: turn the approval gate off at provision time so the read-only
  // bash tool cannot be blocked by a permission card. The real ~/.dsh is never
  // touched and no other scenario inherits this env.
  profileDir = provisionScratchProfile({
    home: HOME,
    repo: REPO,
    env: { ...process.env, DSH_OPENTUI_APPROVAL_GATE: 'off' },
  })
} catch (error) {
  notRun(`scratch profile provisioning failed: ${scrub(error.message)}`)
}
try {
  const cfgPath = join(profileDir, 'config.json')
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {}
  cfg.lang = 'en' // harness asserts en copy
  cfg.autoResume = 'off' // a fresh scratch home boots a NEW session
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n')
  // Reference the real credential FILE BY PATH. No copy into argv, no key
  // value in any log, no fabricated placeholder key ("dummy" would be a
  // false green). Only read() by the client, following this symlink.
  const scratchCreds = join(HOME, '.credentials.yaml')
  rmSync(scratchCreds, { force: true })
  symlinkSync(CREDENTIALS, scratchCreds, 'file')
} catch (error) {
  notRun(`scratch credential link failed: ${scrub(error.message)}`)
}
DEADLINE = Date.now() + WALL_MS

const ERR_LOG = join(OUT, `${SESS}.err.log`)
const errTail = () => (existsSync(ERR_LOG) ? scrub(readFileSync(ERR_LOG, 'utf8')).slice(-4000) : '')

/** Provider/network signatures for the dedicated stderr channel ONLY. Bare
 * numbers (401/429/5xx) and "timeout" are meaningful there; the same tokens
 * anywhere in the pane are NOT (counters, seqs, filenames and normal copy
 * legitimately contain them). */
const ENV_SIGNATURES = [
  /\b401\b|unauthori[sz]ed|invalid[_-]?api[_-]?key|authentication failed|expired (?:key|token)/i,
  /\b429\b|rate[_-]?limit|too many requests/i,
  /\b5\d{2}\b|internal server error|bad gateway|service unavailable|provider (?:error|unavailable)/i,
  /timeout|timed out|ETIMEDOUT|ECONNRESET|socket hang up|超时/i,
]
const APPROVAL_SIGNATURES = [/\ballow once\b/i, /\balways allow\b/i, /permission request/i, /批准|授权|允许一次/]
/** In the pane, only an EXPLICIT provider/error notification counts: an error
 * glyph or an error/provider label on the SAME line as a provider/auth phrase.
 * Never scan the whole pane for a bare 401/429/5xx/timeout. */
const ENV_NOTICE = /unauthori[sz]ed|invalid[_-]?api[_-]?key|authentication failed|expired (?:key|token)|rate[_-]?limit|too many requests|internal server error|bad gateway|service unavailable|provider (?:error|unavailable)|\b4\d{2}\b|\b5\d{2}\b|timed? ?out|超时/i
const ENV_NOTICE_LABEL = /[✗⚠⛔]|\b(?:error|failed|provider|api[_ -]?key)\b/i
const paneEnvNotice = (pane) =>
  String(pane).split('\n').some((line) => ENV_NOTICE_LABEL.test(line) && ENV_NOTICE.test(line))
const envVerdict = (pane) => {
  const clean = scrub(pane)
  if (APPROVAL_SIGNATURES.some((re) => re.test(clean)))
    return 'a permission/approval card appeared — harness never auto-approves'
  if (paneEnvNotice(clean)) return 'explicit provider/error notification in the pane'
  const err = errTail()
  const hit = ENV_SIGNATURES.find((re) => re.test(err))
  return hit ? `provider/network environment error on stderr (${hit.source})` : null
}

const capture = () => tmuxOut('capture-pane', '-p', '-t', SESS)
const sendKeys = (...keys) => tmux('send-keys', '-t', SESS, ...keys)
const typeFast = async (text) => {
  sendKeys('-l', text)
  await sleep(60)
  sendKeys('Enter')
}
const waitPane = async (pred, timeoutMs, everyMs = 350) => {
  const deadline = Math.min(Date.now() + timeoutMs, DEADLINE)
  let last = ''
  while (Date.now() < deadline) {
    const frame = capture()
    if (frame.trim().length > 0) last = frame
    const verdict = envVerdict(last)
    if (verdict) return { ok: false, out: last, env: verdict }
    try {
      if (last && pred(last)) return { ok: true, out: last }
    } catch { /* keep waiting */ }
    await sleep(everyMs)
  }
  return { ok: false, out: last, env: Date.now() >= DEADLINE ? 'wall-clock budget exhausted' : null }
}
const snap = (name) => {
  const raw = tmuxOut('capture-pane', '-p', '-e', '-t', SESS)
  writeFileSync(join(OUT, `${name}.ans`), scrub(raw))
}

/** Journal evidence: durable session log (plain jsonl or v4 zstd), measured by
 * bytes so no decoder is needed. The host writes
 * `<DSH_HOME>/sessions/<project>/<session>/session.v4.jsonl.zstd`. A fresh
 * scratch home has NO `sessions` root at boot — that is a valid zero baseline,
 * not an ENV failure. Walk this run's scratch HOME and WS recursively so a
 * different (but valid) session location is not a false NOT RUN. The walk is
 * confined to these two temp dirs: node_modules is skipped, and symlinks are
 * never followed, so the referenced credential file and the real ~/.dsh are
 * unreachable. */
const JOURNAL_MAX_DEPTH = 6
const JOURNAL_SKIP_DIRS = new Set(['node_modules'])
const JOURNAL_FILE = /^session\..*\.(?:jsonl|zstd)$/
const journalFiles = () => {
  const roots = [HOME, WS]
  const files = []
  const searched = []
  const seen = new Set()
  const visit = (dir, depth) => {
    if (depth > JOURNAL_MAX_DEPTH || seen.has(dir)) return
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    seen.add(dir)
    searched.push(dir)
    for (const e of entries) {
      const full = join(dir, e.name)
      // Dirent.isDirectory()/isFile() are false for symlinks, so neither the
      // credential symlink nor any linked directory can escape the scratch.
      if (e.isDirectory()) {
        if (!JOURNAL_SKIP_DIRS.has(e.name)) visit(full, depth + 1)
        continue
      }
      if (e.isFile() && JOURNAL_FILE.test(e.name)) files.push(full)
    }
  }
  for (const root of roots) visit(root, 0)
  let bytes = 0
  for (const f of files) { try { bytes += statSync(f).size } catch { /* rotated */ } }
  return { files, bytes, searched, roots }
}

const results = []
const record = (item, ok, detail = []) => {
  results.push({ item, ok, status: ok ? 'PASS' : 'FAIL', detail })
  console.log(`${(ok ? 'PASS' : 'FAIL').padEnd(5)} ${item}${detail.length ? ` — ${detail.join(' | ')}` : ''}`)
}
/** A check that could not run is NOT RUN — never PASS, never a product FAIL.
 * Earlier product results stay untouched in `results`. */
const recordNotRun = (item, detail = []) => {
  results.push({ item, ok: null, status: 'NOT RUN', detail })
  console.log(`NOT RUN ${item}${detail.length ? ` — ${detail.join(' | ')}` : ''}`)
}

let envReason = null
let crashed = null
const EnvAbort = Symbol('env-abort')
const checkEnv = (step) => {
  if (step.env) { envReason = step.env; throw EnvAbort }
}
const reapHost = () => {
  const lock = join(HOME, `opentui-host.${PROFILE}.json`)
  let pid = 0
  try { pid = JSON.parse(readFileSync(lock, 'utf8')).pid } catch { /* no host */ }
  if (pid) {
    try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch {} }
    const until = Date.now() + 4000
    while (Date.now() < until) {
      try { process.kill(pid, 0); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200) } catch { break }
    }
    try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch {} }
  }
  rmSync(lock, { force: true })
}

try {
  tmux('kill-server')
  // SCRATCH ONLY: the same gate-off escape hatch at runtime — the patch's
  // approval expression is evaluated from the client's env, so off must be here
  // too. The operator home is never touched; no other scenario inherits it.
  const r = tmux('new-session', '-d', '-x', String(COLS), '-y', String(ROWS), '-s', SESS, '-c', WS,
    `DSH_HOME=${HOME} DSH_OPENTUI_APPROVAL_GATE=off DSH_OPENTUI_DEBUG=1 TERM=xterm-256color ${LAUNCHER} --client 2>${ERR_LOG}`)
  if (r.status !== 0) { envReason = `tmux boot failed: ${scrub(r.stderr)}`; throw EnvAbort }

  const boot = await waitPane((o) => o.includes('🧠') || idle(o), 90_000, 500)
  checkEnv(boot)
  if (!boot.ok) { envReason = 'client never reached idle within the wall-clock budget'; throw EnvAbort }
  record('real client reached idle on the scratch home', true)
  const j0 = journalFiles()

  // --- turn 1: pure text, one real provider round-trip ----------------------
  // Only the PING token is sent; the derived PONG marker can only appear if
  // the model actually performed the replacement, never from the prompt echo.
  await typeFast(`${TEXT_TOKEN} — replace PING with PONG in that token and output the result verbatim, nothing else`)
  // Positive evidence the submit was accepted: the footer busy hint (`esc stop`
  // / `esc 停止`) must appear BEFORE any reply is trusted. Poll at a short
  // interval so a transient busy frame cannot be missed; the observation is
  // recorded like every other product check.
  const busy = await waitPane((o) => busyFrame(o), 15_000, 100)
  checkEnv(busy)
  record('client entered busy state after the text turn', busy.ok,
    [busy.ok ? 'esc stop busy hint observed' : 'no busy hint observed within budget'])
  const reply = await waitPane((o) => replyOutsideComposer(o, TEXT_REPLY), TURN_MS, 500)
  checkEnv(reply)
  snap('01-text-turn')
  record('real text turn returned the expected reply', reply.ok,
    [reply.ok ? `${TEXT_REPLY} on a non-user transcript line` : 'reply marker not visible outside composer/user lines'])
  const footer1 = await waitPane((o) => (msgsOf(o) ?? 0) >= (msgsOf(boot.out) ?? 0) + 1, 20_000)
  checkEnv(footer1)
  record('footer message counter grew after the text turn', footer1.ok,
    [footer1.ok ? `${msgsOf(footer1.out)} msgs` : `stuck at ${msgsOf(boot.out)} msgs`])
  const settled1 = await waitPane((o) => !busyFrame(o), 30_000)
  checkEnv(settled1)
  record('client left the busy state after the text turn', settled1.ok,
    [settled1.ok ? 'esc stop busy hint cleared' : 'esc stop busy hint still visible within budget'])

  // --- turn 2: one read-only bash echo tool call ---------------------------
  // The command itself does the transform; only the tool RESULT row (⎿/tool
  // semantics) may satisfy the assertion, never the composer prompt echo.
  await typeFast(`${TOOL_TOKEN} — run this read-only bash command and report its output: ${TOOL_CMD}`)
  const tool = await waitPane((o) => toolResultHas(o, TOOL_REPLY), TURN_MS, 500)
  checkEnv(tool)
  snap('02-tool-turn')
  record('tool result row shows the real echo output', tool.ok,
    [tool.ok ? `${TOOL_REPLY} on a tool-result line` : 'tool output not visible on a result line'])
  const footer2 = await waitPane((o) => (toolsOf(o) ?? 0) >= 1, 20_000)
  checkEnv(footer2)
  record('footer tool counter grew after the tool turn', footer2.ok,
    [footer2.ok ? `${toolsOf(footer2.out)} tools` : 'no tool counter growth'])

  const j1 = journalFiles()
  const JOURNAL_ITEM = 'durable journal persisted the turns'
  // No journal at either measurement means the evidence is missing, not that a
  // product assertion failed. Keep every product PASS already recorded, mark
  // only this item NOT RUN, and leave the run non-zero. A missing root at boot
  // (j0) is normal for a fresh scratch home and is NOT a NOT RUN by itself.
  if (j0.files.length === 0 && j1.files.length === 0) {
    const searched = j1.roots.join(' , ')
    envReason = `no scratch journal found under ${searched} (depth <= ${JOURNAL_MAX_DEPTH}, skipping node_modules) — cannot assert durable journal`
    recordNotRun(JOURNAL_ITEM, [
      `searched: ${searched}`,
      `depth <= ${JOURNAL_MAX_DEPTH}, node_modules skipped, ${j1.searched.length} directories scanned`,
      'expected layout: <scratch HOME>/sessions/<project>/<session>/session.v4.jsonl.zstd',
    ])
    throw EnvAbort
  }
  // A real session was created; the durable log must have grown across the two
  // turns. No growth is a genuine product FAIL, not an ENV reason.
  record(JOURNAL_ITEM, j1.bytes > j0.bytes || j1.files.length > j0.files.length,
    [`${j0.files.length}→${j1.files.length} logs, ${j0.bytes}→${j1.bytes} bytes`,
      `journal: ${j1.files.slice(0, 3).join(' , ')}`])

  const final = capture()
  const crash = /TypeError|ReferenceError|Cannot read propert|Unhandled error|panic/i.exec(scrub(final))
  record('no crash markers in the client scrollback', crash === null, [crash ? crash[0] : 'clean'])
} catch (error) {
  if (error !== EnvAbort) {
    crashed = error
    envReason = envReason || `harness error: ${scrub(error?.message ?? error)}`
  }
} finally {
  tmux('kill-server')
  reapHost()
  // Defensive: scrub the client's stderr log on disk in case it echoed a value.
  try {
    if (existsSync(ERR_LOG)) writeFileSync(ERR_LOG, scrub(readFileSync(ERR_LOG, 'utf8')))
  } catch { /* best effort */ }
  try {
    writeFileSync(join(OUT, 'summary.json'), JSON.stringify({
      results, envReason: envReason ? scrub(envReason) : null,
      crashed: crashed ? scrub(String(crashed)) : null,
    }, null, 2))
  } catch { /* best effort */ }
  if (!KEEP) {
    try { rmSync(HOME, { recursive: true, force: true }) } catch {}
    try { rmSync(WS, { recursive: true, force: true }) } catch {}
  }
}

// A recorded product FAIL / crash outranks an ENV reason: judge it FIRST so an
// ENV abort later in the run cannot mask a real product regression as NOT RUN.
const failed = results.filter((r) => r.ok === false).length
const notRunItems = results.filter((r) => r.ok === null).length
const productItems = results.length - notRunItems
console.log(`\nremote-live-smoke: ${productItems - failed}/${productItems} product checks passed${notRunItems ? `, ${notRunItems} NOT RUN` : ''}`)
if (crashed || failed > 0) process.exit(1)
if (envReason || notRunItems > 0) notRun(envReason || 'one or more checks did not run')
process.exit(0)
