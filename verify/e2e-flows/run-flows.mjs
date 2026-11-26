#!/usr/bin/env node
// E2E flow suite: REAL client + REAL resident host + LOCAL fake model +
// per-scenario scratch DSH_HOME.
//
//   node verify/e2e-flows/run-flows.mjs                 # every scenario
//   node verify/e2e-flows/run-flows.mjs --only=single-turn,steer
//   node verify/e2e-flows/run-flows.mjs --keep           # keep failed scratch homes
//
// Each scenario provisions a private DSH_HOME under the OS temp dir (never
// touches ~/.dsh), boots `./dsh-opentui --client` in a private tmux server (unique socket + session
// name), and drives the real UI. The only model in the scratch home is
// `fake-gw`, an OpenAI-compatible SSE server started on an ephemeral port
// (verify/e2e-flows/fake-model.mjs).
//
// Assertions print `expected` / `actual` and a screen snippet. The process
// exits 0 only when every scenario passes. SKIP is a distinct, non-passing
// outcome: a scenario with skips is never reported as PASS, is never ok=true,
// and makes the run exit non-zero so an uncovered capability cannot hide
// behind a green summary.
//
// Environment: bun, tmux and the global `dsh` must be on PATH. Each scenario
// runs the real in-process provisioner against its scratch HOME.
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { DEFAULT_PROFILE } from '../../packages/shell/scripts/lib/profile-name.mjs'
import { decideApprovalKey, isApprovalCard, stripAnsi } from './r6-harness-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const LAUNCHER = join(REPO, 'dsh-opentui')
const PROFILE = DEFAULT_PROFILE
const GEOMETRY = { x: 120, y: 34 }
const IDLE_MARKERS = ['提问，回车发送', 'Type a message', '输入消息']
const FAKE_KEY = 'e2e-fake-key'
const TYPE_GAP_MS = 55
const CRASH_RE = /TypeError|Cannot access private|Unhandled promise|boot failed/i

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name, def) => {
  const inline = argv.find((a) => a.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : def
}
const ONLY = (opt('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean)
const KEEP = flag('keep')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })
const flat = (s) => String(s).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '')
const has = (out, marker) => flat(out).includes(flat(marker))
const snippet = (out, marker) => {
  const lines = String(out).split('\n')
  const idx = lines.findIndex((l) => flat(l).includes(flat(marker)))
  const from = Math.max(0, idx - 2)
  return lines.slice(from, from + 5).join('\n')
}
const lastLine = (out) => String(out).trimEnd().split('\n').slice(-8).join('\n')

// 0.29 transcript scroll hint — both locale tables ship the same shape:
// `↓ {count} 条新消息 ({keys})` / `↓ {count} new messages ({keys})`.
const NEW_MSG_HINT_RE = /↓\s*\d+\s*(?:条新消息|new messages?)/i
const hasNewMsgHint = (out) => NEW_MSG_HINT_RE.test(String(out ?? ''))

// Scratch homes pin lang=zh-CN; keep the en forms as a compatibility fallback.
// Sources: overlay.delivery.title, transcript.scroll.toLatest,
// command.flush.flushed (packages/i18n/locales/{zh-CN,en}.json).
const DELIVERY_CHOICE_RE = /轮次运行中|Turn running/i
const AWAY_BOTTOM_RE = /回到底部|Jump to latest/i
// Queue/flush receipts stay strict zh-CN now that the scratch home pins lang.
const FLUSHED_RE = /队列已发送/
const hasDeliveryChoice = (out) => DELIVERY_CHOICE_RE.test(String(out ?? ''))
const hasAwayBottomHint = (out) => AWAY_BOTTOM_RE.test(String(out ?? ''))

// Real to-bottom chord for the away hint, independent of composer focus.
const toBottom = async () => { sendKeys('M-S-End'); await sleep(300) }
const scrollAway = async (steps = 8) => {
  for (let i = 0; i < steps; i++) { sendKeys('PgUp'); await sleep(120) }
}

/**
 * Handle a REAL DialogConfirm approval card raised by the gated bash tool.
 * Uses the shared decideApprovalKey gate (title match + confirm label painted)
 * and sends ONLY Enter = "Allow once" — never `a`/`s`/Esc. A host with auto-
 * grant simply produces no card and is not an assertion failure here.
 */
const allowOnceIfAsked = async (ctx, firstWaitMs = 12_000) => {
  let handled = 0
  for (let i = 0; i < 3; i++) {
    const card = await waitFor(isApprovalCard, i === 0 ? firstWaitMs : 2_000, 200)
    if (!card.ok) break
    ctx.expect('bash tool raised a real approval card', true, '⚠ 审批 card', 'present', card.out)
    const ready = await waitFor((o) => Boolean(decideApprovalKey(o)?.key), 10_000, 200)
    ctx.expect('allow-once label painted on the card', ready.ok, '允许 confirm label', ready.ok ? 'present' : 'absent', ready.out)
    if (!ready.ok) return handled
    const decision = decideApprovalKey(ready.out)
    sendKeys(decision.key)
    await sleep(400)
    handled++
  }
  if (handled === 0) ctx.note('no approval card appeared (host auto-granted the bash tool)')
  return handled
}

/**
 * Abort a running turn through the project's U6 stop-confirm contract:
 * Esc arms, 150ms later Esc opens "Stop everything?", 350ms later Enter
 * confirms. A single Esc only ARMS and leaves the turn running.
 */
const abortTurn = async (waitMs = 15_000) => {
  sendKeys('Escape'); await sleep(150)
  sendKeys('Escape'); await sleep(350)
  sendKeys('Enter')
  return waitFor((o) => !busyFrame(o), waitMs)
}

/**
 * The host journals ONE zstd frame per append. node's zstdDecompressSync
 * decodes only the first frame, so split on the magic and concatenate every
 * frame (all 31 lines), preferring Bun's whole-buffer decoder when present.
 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const decompressZstdFrames = (buf) => {
  const bun = globalThis.Bun?.zstdDecompressSync
  if (bun) return Buffer.from(bun(buf))
  const first = buf.indexOf(ZSTD_MAGIC)
  if (first < 0) return buf // plain jsonl fixture
  const chunks = []
  let start = first
  while (start >= 0) {
    const next = buf.indexOf(ZSTD_MAGIC, start + ZSTD_MAGIC.length)
    chunks.push(zstdDecompressSync(buf.subarray(start, next < 0 ? buf.length : next)))
    start = next
  }
  return Buffer.concat(chunks)
}

/** Read the REAL durable journal — every frame, not just the first. */
const readJournalRows = (home) => {
  const rows = []
  const root = join(home, 'sessions')
  const visit = (dir, depth) => {
    if (depth > 5 || !existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { visit(full, depth + 1); continue }
      if (!entry.name.startsWith('session.') || !(entry.name.endsWith('.zstd') || entry.name.endsWith('.jsonl'))) continue
      try {
        let buf = readFileSync(full)
        if (entry.name.endsWith('.zstd')) buf = decompressZstdFrames(buf)
        for (const line of buf.toString('utf8').split('\n')) {
          if (!line.trim()) continue
          try { rows.push(JSON.parse(line)) } catch { /* partial line */ }
        }
      } catch { /* unreadable log: never invent rows */ }
    }
  }
  visit(root, 0)
  return rows
}

/** Finalized text of a journal tool/result, mirroring remote-session-ops.ts. */
const toolResultText = (data) => {
  const candidates = [
    data?.message?.content, data?.content, data?.output, data?.text,
    data?.message?.text, data?.output?.content, data?.output?.text, data?.output?.message?.content,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c !== '') return c
    if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('')
  }
  return ''
}
const successfulToolResult = (rows, marker) => rows.some((row) => {
  if (row?.type !== 'tool/result') return false
  const d = row.data ?? row.payload ?? row
  const isError = d?.isError ?? d?.message?.isError ?? d?.output?.isError
  return isError === false && toolResultText(d).includes(marker)
})

/**
 * The transcript filters tool rows and the dock keeps a tool block only ~2s.
 * Poll the PANE from the moment the tool starts until 2s after its journal
 * tool/result lands — never sample a single late `done` frame.
 */
const watchToolBlock = (ctx, blockMarker, resultMarker, timeoutMs = 180_000) => {
  const deadline = Date.now() + timeoutMs
  return (async () => {
    let resultAt = 0
    while (Date.now() < deadline) {
      if (has(capture(), blockMarker)) return true
      if (resultAt === 0 && successfulToolResult(readJournalRows(ctx.home), resultMarker)) {
        resultAt = Date.now()
      }
      if (resultAt !== 0 && Date.now() - resultAt > 2_000) return false
      await sleep(150)
    }
    return false
  })()
}

/**
 * Host project directory key: realpath(cwd) with path separators folded to
 * '-', wrapped in '--', and the inner part truncated to 251 chars (255-byte
 * filename minus the two 2-char wrappers).
 */
const projectKey = (cwd) => `--${String(cwd).replace(/[\\/]/g, '-').replace(/^-+|-+$/g, '').slice(0, 251)}--`

/** Host path-segment codec (mirrors bridge/src/session-prune.ts encodeSegment). */
const encodeSegment = (raw) => {
  const s = String(raw)
  if (s === '.') return '~002E'
  if (s === '..') return '~002E~002E'
  let out = ''
  for (const ch of s) {
    out += (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch))
      ? ch
      : '~' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/**
 * Seed one genuinely OLD session in the scratch DSH_HOME (never ~/.dsh) so
 * /prune has a real retention candidate. The host REJECTS the old flat-file
 * layout: the real path is
 *   <home>/sessions/<projectSegment>/<encodeSegment(id)>/session.v4.jsonl.zstd
 * The FIRST zstd frame must contain ONE line: the legal v4 header. Appending
 * events to that frame makes the host silently discard the session, so this
 * fixture writes a header-only single frame (no event frames are needed).
 * artifact / session / project dirs all carry the old mtime.
 */
const seedOldSession = (home, ws, id, ageDays) => {
  const oldMs = Date.now() - ageDays * 86_400_000
  const old = new Date(oldMs)
  const realWs = realpathSync(ws)
  const projectDir = join(home, 'sessions', projectKey(realWs))
  const dir = join(projectDir, encodeSegment(id))
  mkdirSync(dir, { recursive: true })
  const artifact = join(dir, 'session.v4.jsonl.zstd')
  const header = {
    type: 'session', version: 4, id, createdAt: oldMs,
    cwd: realWs, isSeeded: false, delegationDepth: 0,
  }
  // Host contract: first frame = header line ONLY. The existing 7 fields are
  // all legal v4 header fields; no event lines/frames are needed for pruning.
  writeFileSync(artifact, zstdCompressSync(Buffer.from(JSON.stringify(header) + '\n')))
  utimesSync(artifact, old, old)
  utimesSync(dir, old, old)
  utimesSync(projectDir, old, old)
  return { artifact, dir, projectDir }
}

/** Real host path for a seeded session artifact (root / project / id / file). */
const sessionArtifactPath = (home, ws, id) =>
  join(home, 'sessions', projectKey(realpathSync(ws)), encodeSegment(id), 'session.v4.jsonl.zstd')

/**
 * Find ALL host-owned `.applied.json` markers anywhere under the scratch
 * trash tree (host inserts a UTC run level, so no fixed path is safe).
 */
const findAppliedMarkers = (home) => {
  const found = []
  const root = join(home, 'trash', 'sessions')
  const walk = (dir, depth = 0) => {
    if (depth > 6 || !existsSync(dir)) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) { walk(full, depth + 1); continue }
      if (e.name !== '.applied.json') continue
      try { found.push({ path: full, rec: JSON.parse(readFileSync(full, 'utf8')) }) } catch {}
    }
  }
  walk(root)
  return found
}
const freshAppliedMarkers = (home, id) => {
  const now = Date.now()
  return findAppliedMarkers(home).filter(({ rec }) =>
    rec?.id === id && typeof rec.appliedAt === 'number' && now - rec.appliedAt >= 0 && now - rec.appliedAt < 300_000)
}

/**
 * After the SECOND apply, age only the freshly-written appliedAt markers so
 * the real purge policy sees a residence-expired entry. Only the fixture's
 * clock is changed — prepare/commit still run through the real bridge RPC.
 */
const backdateFreshMarkers = (home, id, days = 30) => {
  const fresh = freshAppliedMarkers(home, id)
  const agedAt = Date.now() - days * 86_400_000
  for (const { path, rec } of fresh) {
    rec.appliedAt = agedAt
    writeFileSync(path, JSON.stringify(rec))
  }
  return fresh.length
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------
const missing = []
for (const cmd of ['bun', 'tmux', 'dsh']) {
  if (sh('which', [cmd]).status !== 0) missing.push(cmd)
}
if (!existsSync(LAUNCHER)) missing.push(`launcher ${LAUNCHER}`)
if (missing.length > 0) {
  console.error(`e2e-flows: cannot run — missing: ${missing.join(', ')}`)
  process.exit(2)
}

const RD = mkdtempSync(join(tmpdir(), 'e2e-flows-run-'))
// Outside RD: RD is removed at exit, so failure evidence lives in its own
// stable per-run directory and survives for the next diagnosis.
const EVIDENCE_ROOT = join(tmpdir(), 'e2e-flows-evidence')
const MODEL_LOG = join(RD, 'model-requests.jsonl')
const TMUX_SOCKET = `e2e-${process.pid}`
const tmux = (...a) => sh('tmux', ['-L', TMUX_SOCKET, ...a])
const tmuxOut = (...a) => { const r = tmux(...a); return r.status === 0 ? r.stdout : '' }

// ---------------------------------------------------------------------------
// Fake model (one per run, ephemeral port)
// ---------------------------------------------------------------------------
let FAKE_PORT = 0

const startFakeModel = async () => {
  const child = spawn('node', [join(HERE, 'fake-model.mjs'), '--port', '0', '--log', MODEL_LOG], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const port = await new Promise((res) => {
    const timer = setTimeout(() => res(0), 10_000)
    child.stdout.on('data', (d) => {
      const m = String(d).match(/FAKE_PORT=(\d+)/)
      if (m) { clearTimeout(timer); res(Number(m[1])) }
    })
    child.on('exit', () => { clearTimeout(timer); res(0) })
  })
  if (!port) throw new Error('fake model failed to start')
  return { child, port }
}

const modelLogLines = () => {
  try {
    return readFileSync(MODEL_LOG, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  } catch { return [] }
}

// Never write the fake API key (or any echoed credential) into an evidence
// file; the scratch route only needs to know WHICH provider/model was used.
const scrubSecrets = (text) => String(text ?? '').split(FAKE_KEY).join('***')

/**
 * Copy the run-wide fake-model request log and this scenario's client stderr
 * tail into a stable evidence dir. Called only on FAIL/SKIP; RD and the
 * scenario scratch home may both be removed, but this directory is not.
 * Purely best effort — evidence collection never changes the verdict.
 */
const preserveFailureEvidence = (name, home) => {
  const dir = join(EVIDENCE_ROOT, `${name}-${process.pid}`)
  try {
    mkdirSync(dir, { recursive: true })
    if (existsSync(MODEL_LOG)) {
      writeFileSync(join(dir, 'model-requests.jsonl'), scrubSecrets(readFileSync(MODEL_LOG, 'utf8')))
    }
    const errLog = join(RD, `${name}.client.err.log`)
    if (existsSync(errLog)) {
      writeFileSync(join(dir, `${name}.client.err.tail.log`), scrubSecrets(readFileSync(errLog, 'utf8').slice(-4000)))
    }
    writeFileSync(join(dir, 'scenario.json'), JSON.stringify({ name, home, at: new Date().toISOString() }, null, 2) + '\n')
    console.log(`  failure evidence: ${dir}`)
  } catch { /* best effort */ }
}

/** Write one evidence artifact into the same stable dir; returns its path. */
const writeEvidence = (name, filename, text) => {
  try {
    const dir = join(EVIDENCE_ROOT, `${name}-${process.pid}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, filename)
    writeFileSync(path, scrubSecrets(String(text ?? '')))
    return path
  } catch { return '' }
}

/** Save the last pane + on-disk session/trash listing before a scenario SKIPs. */
const saveSkipEvidence = (ctx, label, pane) => {
  const panePath = writeEvidence(ctx.name, `${label}.pane.txt`, pane)
  const lines = []
  for (const root of [join(ctx.home, 'sessions'), join(ctx.home, 'trash', 'sessions')]) {
    lines.push(`# ${root}`)
    // Host layout has project / id / artifact (trash adds a run level).
    const walk = (dir, prefix = '', depth = 0) => {
      try {
        for (const name of readdirSync(dir)) {
          const rel = prefix ? `${prefix}/${name}` : name
          lines.push(`  ${rel}`)
          if (depth < 4) walk(join(dir, name), rel, depth + 1)
        }
      } catch { if (depth === 0) lines.push('  (absent)') }
    }
    walk(root)
  }
  const listPath = writeEvidence(ctx.name, `${label}.session-list.txt`, lines.join('\n') + '\n')
  return [panePath, listPath].filter(Boolean)
}

// ---------------------------------------------------------------------------
// Assertion bookkeeping
// ---------------------------------------------------------------------------
class Ctx {
  constructor(name, home, ws, sess, modelStart) {
    this.name = name
    this.home = home
    this.ws = ws
    this.sess = sess
    this.modelStart = modelStart
    this.failures = 0
    this.passes = 0
    this.skips = []
  }
  expect(label, ok, expected, actual, pane = '') {
    if (ok) {
      this.passes++
      console.log(`  PASS ${label}`)
    } else {
      this.failures++
      console.log(`  FAIL ${label}`)
      console.log(`       expected: ${expected}`)
      console.log(`       actual:   ${actual}`)
      if (pane) console.log(snippet(pane, String(actual).slice(0, 40)).split('\n').map((l) => `       | ${l}`).join('\n'))
    }
    return ok
  }
  contains(label, pane, marker) {
    return this.expect(label, has(pane, marker), `contains "${marker}"`, has(pane, marker) ? 'present' : 'absent', pane)
  }
  absent(label, pane, marker) {
    return this.expect(label, !has(pane, marker), `does not contain "${marker}"`, has(pane, marker) ? 'present' : 'absent', pane)
  }
  skip(label, reason) {
    this.skips.push(`${label}: ${reason}`)
    console.log(`  SKIP ${label} — ${reason}`)
  }
  note(message) { console.log(`  · ${message}`) }
}

// ---------------------------------------------------------------------------
// tmux client driving
// ---------------------------------------------------------------------------
const capture = () => tmuxOut('capture-pane', '-p', '-t', globalThis.CUR_SESS)
const sendKeys = (...keys) => tmux('send-keys', '-t', globalThis.CUR_SESS, ...keys)
const typeText = async (text) => {
  for (const ch of text) { sendKeys('-l', ch); await sleep(TYPE_GAP_MS) }
}
const inputRow = (out) => (out.split('\n').filter((l) => l.includes('❯')).pop() ?? '').trim()

const submit = async (text, { deferred = false } = {}) => {
  // Only model-turn prompts carry an E2E_ marker. Slash commands (/settings,
  // /prune, /quit) and typed confirm words (`prune` / `purge`) are handled
  // locally and never reach the fake model — no request assertion for them.
  // Busy steer/queue/flush submits are `deferred`: their request is made only
  // after the running turn ends (or after a delivery choice), so the strict
  // 15s immediate-request assertion must not be applied to them.
  const expectsModelRequest = text.includes('E2E_') && !deferred
  const requestsBefore = expectsModelRequest ? modelLogLines().length : 0
  const typed = async () => {
    await typeText(text)
    await sleep(250)
    if (!inputRow(capture()).includes(text)) {
      // first-key drop guard (OpenTUI input parser): clean + retype once
      for (let i = 0; i < text.length + 6; i++) { sendKeys('BSpace'); await sleep(45) }
      await sleep(150)
      await typeText(text)
      await sleep(250)
    }
    sendKeys('Enter')
  }
  await typed()
  if (!expectsModelRequest) return

  // Fast delivery check: a lost submit used to burn the full 90s reply wait.
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (modelLogLines().length > requestsBefore) return
    await sleep(250)
  }
  // Throwing ends the scenario now; the runner records a FAIL and copies the
  // model log + client stderr tail to the evidence dir via preserveFailureEvidence.
  throw new Error(`no fake-model request within 15s after submit("${text}") — MODEL_LOG still has ${requestsBefore} request(s)`)
}

const waitFor = async (pred, timeoutMs, everyMs = 400) => {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    const frame = capture()
    if (frame.trim().length > 0) last = frame
    try { if (last && pred(last)) return { ok: true, out: last } } catch { /* keep waiting */ }
    await sleep(everyMs)
  }
  return { ok: false, out: last }
}

const idle = (out) => IDLE_MARKERS.some((m) => out.includes(m))
// busy is NOT the absence of the placeholder: the composer keeps its idle
// placeholder while a turn streams. The hint line flips to `esc stop`.
// footer.hint.stop.busy is "esc stop" in en but "esc 停止" in zh-CN, and the
// scratch home pins lang=zh-CN. Accept both spellings.
const busyFrame = (out) => /esc stop|esc\s*停止/.test(String(out ?? ''))

/**
 * Real boot gate: provider + model + an idle composer, all on the same frame.
 * `fake-gw` / `demo-1` come from the powerline provider/model segments
 * (powerline.tsx:615/680). A brand-new session intentionally HIDES the 💬
 * message counter until the first turn (footer-refresh / msgSegment), so no
 * numeric counter is required here — nor is a 🧠 glyph. The composer's idle
 * placeholder plus !busyFrame is what proves the client is ready to accept a
 * prompt, and a statically painted footer alone is not enough.
 */
const bootReady = (out) => {
  const text = stripAnsi(out)
  return text.includes('fake-gw')
    && text.includes('demo-1')
    && idle(text)
    && !busyFrame(text)
}

// The counter is `💬 N msg` / `💬 N msgs` (en) or `💬 N 条消息` (zh-CN).
// Absence stays undefined — it is NOT a zero: a new session hides the segment
// until the first durable assistant/message event exists (seams/session.ts:499).
const msgsOf = (out) => {
  const all = [...String(out).matchAll(/💬\s*(\d+)\s*(?:msgs?|条消息)/g)]
  return all.length ? Number(all[all.length - 1][1]) : undefined
}
const toolsOf = (out) => {
  const all = [...String(out).matchAll(/🔧\s*(\d+)\s*tools/g)]
  return all.length ? Number(all[all.length - 1][1]) : undefined
}

const reapHost = () => {
  const lock = join(globalThis.CUR_HOME, `opentui-host.${PROFILE}.json`)
  let pid = 0
  try { pid = JSON.parse(readFileSync(lock, 'utf8')).pid } catch {}
  if (pid) {
    try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch {} }
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); sleepSync(200) } catch { break }
    }
    try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch {} }
  }
  rmSync(lock, { force: true })
}
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const quitClient = async () => {
  if (tmux('has-session', '-t', globalThis.CUR_SESS).status !== 0) return
  await submit('/quit')
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (tmux('has-session', '-t', globalThis.CUR_SESS).status !== 0) return
    await sleep(300)
  }
  // fallback: ctrl+c twice (the page's clean shutdown), then hard kill
  sendKeys('C-c'); await sleep(200); sendKeys('C-c'); await sleep(1200)
  tmux('kill-session', '-t', globalThis.CUR_SESS)
}

/**
 * Identify the resident host as a DESCENDANT of the tmux pane, via the real
 * bridge transport's `dsh --profile <profile>` child (bridge-transport.ts:199).
 * The old lock file is not a stable signal in this environment, so when the
 * child cannot be identified unambiguously the caller must FAIL, never pass.
 */
const commandOf = (pid) => {
  const r = sh('ps', ['-p', String(pid), '-o', 'command='])
  return r.status === 0 ? String(r.stdout ?? '') : ''
}
const findHostPid = () => {
  const raw = tmuxOut('display-message', '-p', '-t', globalThis.CUR_SESS, '#{pane_pid}').trim()
  const root = Number(raw)
  if (!Number.isInteger(root) || root <= 0) {
    return { ok: false, why: `pane pid unavailable (${JSON.stringify(raw)})` }
  }
  const hosts = new Set()
  let frontier = [root]
  for (let depth = 0; depth < 4; depth++) {
    const next = []
    for (const pid of frontier) {
      if (/dsh\s+--profile\b/.test(commandOf(pid))) hosts.add(pid)
      const r = sh('pgrep', ['-P', String(pid)])
      for (const line of String(r.stdout ?? '').split('\n')) {
        const child = Number(line.trim())
        if (Number.isInteger(child) && child > 0) next.push(child)
      }
    }
    frontier = next
  }
  if (hosts.size !== 1) {
    return { ok: false, why: `expected exactly one dsh --profile descendant of pane ${root}, found ${hosts.size}` }
  }
  return { ok: true, pid: [...hosts][0] }
}

const boot = async (ctx, extraArgs = []) => {
  tmux('kill-session', '-t', ctx.sess)
  await sleep(300)
  const env = [
    `DSH_HOME=${ctx.home}`,
    `DSH_OPENTUI_MODEL=fake-gw/demo-1`,
    `DSH_FAKE_API_KEY=${FAKE_KEY}`,
    'DSH_OPENTUI_DEBUG=1',
    'TERM=xterm-256color',
  ].join(' ')
  const errLog = join(RD, `${ctx.name}.client.err.log`)
  const cmd = `${env} "${LAUNCHER}" --client ${extraArgs.join(' ')} 2>"${errLog}"`
  const r = tmux('new-session', '-d', '-x', String(GEOMETRY.x), '-y', String(GEOMETRY.y), '-s', ctx.sess, '-c', ctx.ws, cmd)
  if (r.status !== 0) throw new Error(`tmux boot failed: ${r.stderr}`)
  // Wait for the provider + model + idle composer on one frame; !busyFrame
  // keeps a streaming turn from passing. No 💬 counter on a fresh session.
  const up = await waitFor(bootReady, 90_000, 700)
  if (!up.ok) {
    const err = existsSync(errLog) ? readFileSync(errLog, 'utf8').slice(-1500) : ''
    throw new Error(`client did not boot a ready footer within 90s (expected fake-gw + demo-1 + idle composer, not busy). pane:\n${lastLine(up.out)}\nclient stderr:\n${err}`)
  }
  return up.out
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
const scenarios = []
const scenario = (name, title, fn) => scenarios.push({ name, title, fn })

// Any assistant reply produced by the fake model — used to prove a fresh
// session has none before its first turn.
const ASSISTANT_REPLY_RE = /E2E-[A-Z0-9_-]+(?:-REPLY|-DONE)|E2E-ACK:/i

scenario('new-empty', 'new session boots empty (no transcript, no resume)', async (ctx) => {
  const pane = await boot(ctx)
  ctx.expect('powerline/footer painted', has(pane, 'fake-gw') && has(pane, 'demo-1'), 'fake-gw + demo-1', `fake-gw=${has(pane, 'fake-gw')} demo-1=${has(pane, 'demo-1')}`, pane)
  ctx.expect('no assistant reply in the new session', !ASSISTANT_REPLY_RE.test(pane), 'no reply marker', ASSISTANT_REPLY_RE.test(pane) ? 'reply present' : 'absent', pane)
  ctx.expect('message counter hidden before the first reply', msgsOf(pane) === undefined, 'no 💬 N segment', `💬 ${msgsOf(pane)}`, pane)
  ctx.absent('no resumed notice', pane, 'resumed ')
  ctx.absent('no prior transcript content', pane, 'E2E-')
  ctx.expect('composer idle', idle(pane), 'idle placeholder', 'not idle', pane)

  // The counter is absent (not zero) until the first durable assistant/message
  // event; after that real reply it must read exactly 1.
  await submit('E2E_SINGLE first turn for counter check')
  const reply = await waitFor((o) => has(o, 'E2E-SINGLE-REPLY'), 90_000)
  ctx.expect('first reply reached the transcript', reply.ok, 'E2E-SINGLE-REPLY', reply.ok ? 'present' : 'absent', reply.out)
  const counted = await waitFor((o) => msgsOf(o) === 1, 30_000)
  ctx.expect('counter appears with value 1 after the first reply', counted.ok, '💬 1 msg', `💬 ${msgsOf(counted.out)}`, counted.out)
})

scenario('single-turn', 'one message → streamed reply → transcript + footer growth', async (ctx) => {
  const pane0 = await boot(ctx)
  const before = msgsOf(pane0) // undefined on a fresh session: the segment is hidden
  ctx.expect('fresh session hides the counter before the first reply', before === undefined, 'no 💬 N segment', `💬 ${before}`, pane0)
  await submit('E2E_SINGLE hello from the flow suite')
  const reply = await waitFor((o) => has(o, 'E2E-SINGLE-REPLY'), 90_000)
  ctx.expect('streamed reply reached the transcript', reply.ok, 'E2E-SINGLE-REPLY', reply.ok ? 'present' : 'absent', reply.out)
  ctx.contains('user message rendered', reply.out, 'E2E_SINGLE hello from the flow suite')
  // One durable assistant/message event per real reply: +1, never +2.
  const expected = before === undefined ? 1 : before + 1
  const grew = await waitFor((o) => msgsOf(o) === expected, 30_000)
  ctx.expect('footer counts one assistant message for one reply', grew.ok, `💬 ${expected} msg`, `💬 ${msgsOf(grew.out)}`, grew.out)
  ctx.absent('no crash markers', reply.out, 'Unhandled promise')
})

scenario('tool-turn', 'agent tool call (bash echo) → tool block + result row', async (ctx) => {
  await boot(ctx)
  await submit('E2E_TOOL run the echo probe')
  // Start the pane watcher BEFORE the tool runs; it keeps polling until 2s
  // after the journal result appears, so a brief dock frame cannot be missed.
  const toolBlockSeen = watchToolBlock(ctx, 'E2E-TOOL-RESULT-OK', 'E2E_TOOL_RESULT_OK')
  await allowOnceIfAsked(ctx)
  const done = await waitFor((o) => has(o, 'E2E-TOOL-DONE'), 180_000)
  ctx.expect('turn completed after the tool round-trip', done.ok, 'E2E-TOOL-DONE', done.ok ? 'present' : 'absent', done.out)
  // The transcript filters tool rows and the dock keeps them only ~2s; the
  // command string is also visible in the assistant's tool-call ARGS. The
  // authoritative proof is the durable journal tool/result with isError=false
  // and finalized text E2E_TOOL_RESULT_OK — polled, never sampled from `done`.
  const result = await waitFor(
    () => successfulToolResult(readJournalRows(ctx.home), 'E2E_TOOL_RESULT_OK'),
    30_000, 500,
  )
  ctx.expect('journal tool/result confirms a successful real command output', result.ok, 'tool/result isError=false with E2E_TOOL_RESULT_OK', result.ok ? 'present' : 'absent', capture())
  // The counter may be hidden on the first frame and painted later; carry the
  // max across frames instead of sampling one snapshot.
  let maxTools = 0
  const tools = await waitFor((o) => {
    maxTools = Math.max(maxTools, toolsOf(o) ?? 0)
    return maxTools >= 1
  }, 60_000)
  ctx.expect('footer tool counter grew', tools.ok, '🔧 ≥1 tools', `🔧 max ${maxTools} tools`, tools.out)
  const blockSeen = await toolBlockSeen
  ctx.expect('tool block is visible while the tool runs', blockSeen, 'tool-call command painted on the pane', blockSeen ? 'present' : 'absent')
})

scenario('steer', 'busy submit → Steer → ⤵ injected → ✓ delivered', async (ctx) => {
  await boot(ctx)
  await submit('E2E_SLOW keep the turn busy')
  const streaming = await waitFor((o) => busyFrame(o), 30_000)
  ctx.expect('turn is streaming', streaming.ok, 'busy frame (esc stop hint)', streaming.ok ? 'busy' : 'idle', streaming.out)

  await submit('E2E_STEER_TEXT inject this', { deferred: true })
  const choice = await waitFor((o) => hasDeliveryChoice(o), 20_000)
  ctx.expect('busy submit opens the delivery choice', choice.ok, '轮次运行中 — 插话还是排队？ / Turn running — steer or queue?', choice.ok ? 'present' : 'absent', choice.out)
  sendKeys('Enter') // Steer is option 0 (default highlight)
  const injected = await waitFor((o) => has(o, '⤵ 已注入当前回合'), 20_000)
  ctx.expect('steer receipt row appears', injected.ok, '⤵ 已注入当前回合', injected.ok ? 'present' : 'absent', injected.out)
  const delivered = await waitFor((o) => has(o, '✓ 已投递'), 90_000)
  ctx.expect('receipt flips to delivered at turn end', delivered.ok, '✓ 已投递', delivered.ok ? 'present' : 'absent', delivered.out)
  // The composer keeps its idle placeholder while a turn streams, so an idle
  // predicate is vacuous here. Only the footer busy hint clearing proves settle.
  const settled = await waitFor((o) => !busyFrame(o), 30_000)
  ctx.expect('turn settled', settled.ok, 'no esc stop / esc 停止 busy hint', 'still busy', settled.out)
  const reqs = modelLogLines().slice(ctx.modelStart)
  const rode = reqs.some((r) => String(r.marker ?? '').includes('E2E_STEER_TEXT') || String(r.prompt ?? '').includes('E2E_STEER_TEXT'))
  ctx.expect('steer text reached a model request (delivery chain)', rode, 'a request carrying E2E_STEER_TEXT', rode ? 'present' : 'absent')
})

scenario('queue', 'busy submit → Queue → ⏸ #1 → auto-sent after turn end', async (ctx) => {
  await boot(ctx)
  await submit('E2E_SLOW keep the turn busy')
  await waitFor((o) => busyFrame(o), 30_000)

  await submit('E2E_QUEUE_TEXT send after this turn', { deferred: true })
  const choice = await waitFor((o) => hasDeliveryChoice(o), 20_000)
  ctx.expect('busy submit opens the delivery choice', choice.ok, '轮次运行中 — 插话还是排队？ / Turn running — steer or queue?', choice.ok ? 'present' : 'absent', choice.out)
  sendKeys('Down')
  await sleep(150)
  sendKeys('Enter') // Queue is option 1
  const queued = await waitFor((o) => has(o, '⏸ 排队等待 #1'), 3_000)
  ctx.expect('queue wait row appears', queued.ok, '⏸ 排队等待 #1', queued.ok ? 'present' : 'absent', queued.out)

  const ack = await waitFor((o) => has(o, 'E2E-ACK:E2E_QUEUE_TEXT'), 120_000)
  ctx.expect('queued prompt runs as its own turn after the first', ack.ok, 'E2E-ACK:E2E_QUEUE_TEXT reply', ack.ok ? 'present' : 'absent', ack.out)
  // Same vacuity trap as steer: idle placeholder is painted while busy.
  const settled = await waitFor((o) => !busyFrame(o), 30_000)
  const final = settled.out || ack.out
  ctx.absent('queue wait row disappeared', final, '排队等待 #1')
  ctx.expect('queued text became a real user message', has(final, 'E2E_QUEUE_TEXT'), 'user row E2E_QUEUE_TEXT', has(final, 'E2E_QUEUE_TEXT') ? 'present' : 'absent', final)
})

scenario('flush', '/flush delivers a paused queue immediately', async (ctx) => {
  await boot(ctx)
  await submit('E2E_SLOW keep the turn busy')
  await waitFor((o) => busyFrame(o), 30_000)

  await submit('E2E_FLUSH_TEXT deliver me now', { deferred: true })
  await waitFor((o) => hasDeliveryChoice(o), 20_000)
  sendKeys('Down'); await sleep(150); sendKeys('Enter')
  const queued = await waitFor((o) => has(o, '⏸ 排队等待 #1'), 3_000)
  ctx.expect('queue wait row appears', queued.ok, '⏸ 排队等待 #1', queued.ok ? 'present' : 'absent', queued.out)

  // Escape is only meaningful while the FIRST turn is still running with a
  // live queued prompt; a short poll proves both before interrupting.
  const stillBusy = await waitFor((o) => busyFrame(o) && has(o, '排队等待 #1'), 3_000)
  ctx.expect('first turn still running with a live queue before Escape', stillBusy.ok, 'busy frame + ⏸ 排队等待 #1', stillBusy.ok ? 'present' : 'absent', stillBusy.out)

  // A single Esc only ARMS the U6 stop; it leaves the turn running. Use the
  // project's confirmed abort: Esc → 150ms → Esc → 350ms → Enter.
  const aborted = await abortTurn(20_000)
  ctx.expect('U6 stop-confirm aborted the running turn', aborted.ok, 'composer not busy', aborted.ok ? 'idle' : 'still busy', aborted.out)
  const paused = await waitFor((o) => has(o, '已暂停'), 20_000)
  ctx.expect('aborting the turn pauses the queue', paused.ok, '⏸ 已暂停 #1', paused.ok ? 'present' : 'absent', paused.out)
  const settled = await waitFor((o) => !busyFrame(o), 20_000)
  ctx.expect('busy hint cleared after abort', settled.ok, 'no esc stop / esc 停止 busy hint', 'still busy', settled.out)

  // /flush must be the cause of delivery: before it, the queue is still
  // paused and the flushed prompt has NOT run by itself.
  const beforeFlush = settled.out || capture()
  ctx.expect('queue still paused immediately before /flush', has(beforeFlush, '已暂停'), '⏸ 已暂停 #1', has(beforeFlush, '已暂停') ? 'present' : 'absent', beforeFlush)
  ctx.absent('flush payload was not auto-delivered before /flush', beforeFlush, 'E2E-ACK:E2E_FLUSH_TEXT')

  await submit('/flush')
  const flushed = await waitFor((o) => FLUSHED_RE.test(o), 20_000)
  ctx.expect('/flush reports an immediate delivery', flushed.ok, '队列已发送 / queue flushed', flushed.ok ? 'present' : 'absent', flushed.out)
  const ack = await waitFor((o) => has(o, 'E2E-ACK:E2E_FLUSH_TEXT'), 90_000)
  ctx.expect('flushed prompt actually ran', ack.ok, 'E2E-ACK:E2E_FLUSH_TEXT reply', ack.ok ? 'present' : 'absent', ack.out)
})

scenario('resume', 'quit → plain boot is empty → --resume-last restores history', async (ctx) => {
  const pane = await boot(ctx)
  await submit('E2E_SINGLE persist this turn')
  const reply = await waitFor((o) => has(o, 'E2E-SINGLE-REPLY'), 90_000)
  ctx.expect('first session has a turn', reply.ok, 'E2E-SINGLE-REPLY', reply.ok ? 'present' : 'absent', reply.out)
  // One real reply = one durable assistant/message event, not user+assistant.
  // The segment may paint a frame late, so poll for the numeric value.
  const firstCount = await waitFor((o) => msgsOf(o) === 1, 30_000)
  ctx.expect('first turn produced exactly one durable assistant message', firstCount.ok, '💬 1 msg', `💬 ${msgsOf(firstCount.out)}`, firstCount.out)
  const msgsBefore = msgsOf(firstCount.out)

  await quitClient()
  await reapHost()

  const fresh = await boot(ctx) // default: NEW session
  ctx.expect('plain relaunch starts a new (empty) session', msgsOf(fresh) === undefined, 'no 💬 N segment (counter hidden before first reply)', `💬 ${msgsOf(fresh)}`, fresh)
  ctx.expect('plain relaunch has no assistant reply', !ASSISTANT_REPLY_RE.test(fresh), 'no reply marker', ASSISTANT_REPLY_RE.test(fresh) ? 'reply present' : 'absent', fresh)
  ctx.absent('plain relaunch does not restore the old transcript', fresh, 'E2E-SINGLE-REPLY')

  await quitClient()
  await reapHost()

  const resumed = await boot(ctx, ['--resume-last'])
  const restored = await waitFor((o) => has(o, 'E2E-SINGLE-REPLY'), 60_000)
  ctx.expect('--resume-last restores the transcript', restored.ok, 'E2E-SINGLE-REPLY', restored.ok ? 'present' : 'absent', restored.out)
  ctx.contains('restored transcript keeps the user row', restored.out, 'E2E_SINGLE persist this turn')
  ctx.contains('resume notice is printed', restored.out, 'resumed ')
  // A footer that never rehydrates is a real regression. Before the first
  // post-resume turn the counter is hidden by design (not a fabricated 0), so
  // drive one more real reply and assert the durable count grew by exactly 1.
  await submit('E2E_LONG count check after resume')
  const second = await waitFor((o) => has(o, 'E2E-LONG-DONE'), 90_000)
  ctx.expect('a new turn runs in the restored session', second.ok, 'E2E-LONG-DONE', second.ok ? 'present' : 'absent', second.out)
  const expected = msgsBefore === undefined ? undefined : msgsBefore + 1
  const counted = await waitFor((o) => expected !== undefined && msgsOf(o) === expected, 30_000)
  ctx.expect('restored transcript keeps the message count (+1 per reply)', counted.ok, `💬 ${expected} msg`, `💬 ${msgsOf(counted.out)}`, counted.out)
})

scenario('host-restart', 'client quit → host idle-exits (5s) → restart keeps the session', async (ctx) => {
  await boot(ctx)
  await submit('E2E_SINGLE host restart probe')
  const reply = await waitFor((o) => has(o, 'E2E-SINGLE-REPLY'), 90_000)
  ctx.expect('turn recorded before shutdown', reply.ok, 'E2E-SINGLE-REPLY', reply.ok ? 'present' : 'absent', reply.out)

  // Read the REAL host child from the bridge transport, not the unreliable
  // opentui-host.<profile>.json lock. Without a unique PID this scenario
  // cannot prove a restart, so it fails explicitly instead of passing by luck.
  const before = findHostPid()
  ctx.expect('bridge host child PID is identifiable', before.ok, 'exactly one dsh --profile descendant of the tmux pane', before.ok ? `pid ${before.pid}` : before.why)
  if (!before.ok) return

  await quitClient()

  // default idle-exit is 5s; allow headroom for the detached reaper
  const deadline = Date.now() + 25_000
  let gone = false
  while (Date.now() < deadline) {
    try { process.kill(before.pid, 0) } catch { gone = true; break }
    await sleep(400)
  }
  ctx.expect('resident host exited after the client left', gone, `pid ${before.pid} gone`, gone ? 'gone' : 'still alive')

  const resumed = await boot(ctx, ['--resume-last'])
  const after = findHostPid()
  ctx.expect('a new host process was spawned after the restart', after.ok && after.pid !== before.pid, `new dsh --profile pid != ${before.pid}`, after.ok ? `pid ${after.pid}` : after.why)
  const restored = await waitFor((o) => has(o, 'E2E-SINGLE-REPLY'), 60_000)
  ctx.expect('session survived the host restart', restored.ok, 'E2E-SINGLE-REPLY', restored.ok ? 'present' : 'absent', restored.out)
})

scenario('settings', '/settings writes a local preference to config.json and reverts', async (ctx) => {
  await boot(ctx)
  const cfgPath = join(ctx.home, 'profiles', PROFILE, 'config.json')
  const readCfg = () => JSON.parse(readFileSync(cfgPath, 'utf8'))
  const original = readCfg().motion
  const originalMerged = original ?? 'auto'
  ctx.note(`initial motion: ${original === undefined ? '(unset → auto)' : original}`)

  await submit('/settings')
  // Real i18n strings (settings.modal.subtitle / settings.editor.pick): en
  // "section navigation · instant save · Esc walks back" / "pick a value",
  // zh "分区导航 · 即时保存 · Esc 逐级返回" / "选择值". Match either, never a
  // test-stub wording.
  const subtitle = (o) => /section navigation|分区导航/i.test(String(o))
  const pickValue = (o) => /pick a value|选择值/i.test(String(o))
  const open = await waitFor(subtitle, 20_000)
  ctx.expect('settings panel opened', open.ok, 'settings modal (section navigation / 分区导航)', open.ok ? 'present' : 'absent', open.out)

  // nav: Down moves to the TUI 专有 section, Enter opens its row list; motion
  // is the 4th row (theme / themeMode / workspaceThemeMode / motion)
  sendKeys('Down'); await sleep(200)
  sendKeys('Enter'); await sleep(500)
  const rows = await waitFor((o) => has(o, 'motion'), 10_000)
  ctx.contains('TUI 专有 section lists the motion row', rows.out || capture(), 'motion')

  // open the motion enum editor and pick "off" (last option); the cursor
  // starts on the effective value (auto), Enter saves instantly
  for (let i = 0; i < 3; i++) { sendKeys('Down'); await sleep(150) }
  sendKeys('Enter'); await sleep(500)
  const options = await waitFor((o) => pickValue(o) && has(o, 'full'), 10_000)
  ctx.expect('enum option list opened', options.ok, 'motion — pick a value / 选择值 with auto/full/…', options.ok ? 'present' : 'absent', options.out)

  for (let i = 0; i < 3; i++) { sendKeys('Down'); await sleep(120) } // auto -> full -> reduced -> off
  sendKeys('Enter')
  const wrote = await waitForCfg(cfgPath, (c) => c.motion === 'off', 10_000)
  ctx.expect('config.json got the new local preference', wrote.ok, 'motion = "off"', wrote.ok ? 'off' : JSON.stringify(wrote.value), capture())

  // revert: the save returns to the row list, so re-enter the editor — its
  // cursor now restarts on the saved value ("off"); walk it to the original
  sendKeys('Enter'); await sleep(500)
  const targets = ['auto', 'full', 'reduced', 'off']
  const delta = (targets.indexOf('off') - Math.max(0, targets.indexOf(originalMerged)) + targets.length) % targets.length
  for (let i = 0; i < delta; i++) { sendKeys('Up'); await sleep(120) }
  sendKeys('Enter')
  const reverted = await waitForCfg(cfgPath, (c) => c.motion === originalMerged, 10_000)
  ctx.expect('config.json reverted', reverted.ok, `motion = "${originalMerged}"`, reverted.ok ? originalMerged : JSON.stringify(reverted.value), capture())

  // close the modal so the composer owns the keys again for /quit: Esc opens
  // the exit confirmation (focus starts on 否), ←→ cycles to 是
  sendKeys('Escape'); await sleep(400)
  sendKeys('Right'); await sleep(200)
  sendKeys('Enter'); await sleep(400)
  await waitFor((o) => !subtitle(o) && idle(o), 10_000)
})

scenario('mcp', 'host tool catalog lists the context7 MCP tools', async (ctx) => {
  await boot(ctx)
  await submit('E2E_SINGLE list your tools')
  const reply = await waitFor((o) => has(o, 'E2E-SINGLE-REPLY'), 90_000)
  ctx.expect('probe turn completed', reply.ok, 'E2E-SINGLE-REPLY', reply.ok ? 'present' : 'absent', reply.out)

  const reqs = modelLogLines().slice(ctx.modelStart).filter((r) => Array.isArray(r.toolNames) && r.toolNames.length > 0)
  const names = [...new Set(reqs.flatMap((r) => r.toolNames))]
  const mcp = names.filter((n) => /context7|mcp__/i.test(n))
  if (mcp.length > 0) {
    ctx.expect('context7 MCP tools are in the host tool catalog', true, '≥1 context7/mcp__ tool', mcp.slice(0, 5).join(', '))
    ctx.note(`mcp tools: ${mcp.slice(0, 8).join(', ')}`)
  } else {
    ctx.skip('context7 MCP tools', `host tool catalog had ${names.length} tools but no context7/mcp__ entry (MCP server unreachable or adapter not installed)`)
  }
})

// --- 0.29 real E2E scenarios ------------------------------------------------
// All three reuse the suite's real client + resident host + local fake model,
// and only write under the per-scenario scratch DSH_HOME.
//
// Prune i18n predicates are matched on flat() text (ANSI escapes and
// punctuation/spaces removed), covering BOTH locale tables verbatim:
// en "reclaimable" / "nothing reclaimable" / "unavailable" / "failed",
// zh "可回收" / "没有可回收会话" / "不可用" / "失败".
const PRUNE_RE = {
  summary: /可回收|reclaimable/i,
  none: /没有可回收会话|nothingreclaimable/i,
  // flat() removes '/' and spaces — never put a literal slash in these.
  unavailable: /prune不可用|pruneunavailable/i,
  failed: /prune失败|prunefailed/i,
  oldest: /最老候选|oldestcandidate/i,
  applied: /prune已执行|pruneapplied/i,
  restored: /已从回收站恢复|restored/i,
  restoreFailed: /恢复失败|restorefailed/i,
  purgeEligible: /符合永久删除条件|eligibleforpermanentdeletion/i,
  purgeEmpty: /没有符合永久删除条件的会话|nothingeligibleforpermanentdeletion/i,
  purgeUnavailable: /prunepurge不可用|prunepurgeunavailable/i,
  // commands.ts compares the typed answer to the LITERAL "purge"; the locale
  // strings are only the title/placeholder ("输入 purge" / "type purge").
  purgeConfirm: /输入purge|typepurge/i,
  // The plan's typed confirm is "输入 prune" / "Type prune ..." (commands.ts).
  pruneConfirm: /输入prune|typeprune/i,
  committed: /purge已执行|purgecommitted/i,
}
const pruneHas = (out, key) => PRUNE_RE[key].test(flat(out))
const pruneSnippet = (out, key) => {
  const m = flat(out).match(PRUNE_RE[key])
  return m ? snippet(out, m[0]) : lastLine(out)
}
const pruneSkip = (ctx, label, reason, out, tag) => {
  const files = saveSkipEvidence(ctx, tag, out)
  ctx.skip(label, `${reason} · evidence: ${files.join(', ') || 'unavailable'}`)
}

scenario('prune-lifecycle', '0.29: /prune preview → typed apply → /prune-restore → /prune-purge typed confirm', async (ctx) => {
  const id = 'e2e-prune-old-a'
  seedOldSession(ctx.home, ctx.ws, id, 365) // real v4 layout in scratch <home>/sessions
  await boot(ctx)

  // This host does NOT paint an "oldest candidate" banner. The complete plan
  // is observable as the candidate id + its 365.0-day age, or the typed-confirm
  // prompt ("输入 prune") that only appears after the whole table is printed.
  const planComplete = (o) => has(o, id) && (has(o, '365.0') || pruneHas(o, 'pruneConfirm'))
  await submit('/prune')
  const preview = await waitFor((o) =>
    planComplete(o) || ['none', 'unavailable', 'failed'].some((k) => pruneHas(o, k)),
  60_000)
  if (!preview.ok) { pruneSkip(ctx, '0.29 prune preview', 'no /prune plan row within 60s', preview.out, 'prune-preview-timeout'); return }
  if (pruneHas(preview.out, 'unavailable')) { pruneSkip(ctx, '0.29 prune RPC', `host seam unavailable: ${pruneSnippet(preview.out, 'unavailable')}`, preview.out, 'prune-preview-unavailable'); return }
  if (pruneHas(preview.out, 'failed')) {
    // A /prune failure is a real defect, not a capability gap: save the pane
    // and record FAIL instead of silently downgrading to SKIP.
    const files = saveSkipEvidence(ctx, 'prune-preview-failed', preview.out)
    ctx.expect('/prune returned a usable plan (no failed row)', false, 'no /prune failed row', pruneSnippet(preview.out, 'failed'), preview.out)
    ctx.note(`prune failure evidence: ${files.join(', ') || 'unavailable'}`)
    return
  }
  if (pruneHas(preview.out, 'none')) { pruneSkip(ctx, '0.29 prune candidate', `planner found no candidate in scratch home: ${pruneSnippet(preview.out, 'none')}`, preview.out, 'prune-preview-none'); return }
  ctx.expect('/prune preview lists the seeded candidate', planComplete(preview.out), 'candidate id + 365.0 days or typed-confirm prompt', pruneSnippet(preview.out, 'summary'), preview.out)

  // No auto-apply: the plan is staged only after the exact word is typed.
  await submit('prune')
  const applied = await waitFor((o) => pruneHas(o, 'applied'), 60_000)
  ctx.expect('typed "prune" moved the candidate to trash', applied.ok, 'prune applied/reclaimed ≥1', applied.ok ? pruneSnippet(applied.out, 'applied') : 'timeout', applied.out)
  const trashExists = () => findAppliedMarkers(ctx.home).some(({ rec }) => rec?.id === id)
  ctx.expect('trash entry really exists in scratch home', trashExists(), `.applied.json under <home>/trash/sessions/*/${id}`, trashExists() ? 'present' : 'absent')

  await submit(`/prune-restore ${id}`)
  const restored = await waitFor((o) => pruneHas(o, 'restored') || pruneHas(o, 'restoreFailed'), 60_000)
  ctx.expect('/prune-restore returned the session by id', restored.ok && pruneHas(restored.out, 'restored'), 'restored from trash', restored.ok ? pruneSnippet(restored.out, 'restored') : 'timeout', restored.out)
  ctx.expect('restored artifact is back in the live sessions dir', existsSync(sessionArtifactPath(ctx.home, ctx.ws, id)), 'live session.v4.jsonl.zstd', existsSync(sessionArtifactPath(ctx.home, ctx.ws, id)) ? 'present' : 'absent')

  // Re-apply, then age the host-owned appliedAt so the real purge policy sees
  // a residence-expired trash entry. prepare is read-only; commit needs `purge`.
  await submit('/prune')
  await waitFor(planComplete, 60_000)
  await submit('prune')
  const reapplied = await waitFor((o) => pruneHas(o, 'applied'), 60_000)
  ctx.expect('second apply re-populated the trash', reapplied.ok, 'prune applied', reapplied.ok ? 'present' : 'timeout', reapplied.out)
  // The host writes the marker asynchronously under a UTC run dir. Poll the
  // whole trash tree for a FRESH appliedAt before aging it by 30 days.
  const markerWait = await waitFor(() => freshAppliedMarkers(ctx.home, id).length > 0, 30_000, 250)
  ctx.expect('fresh .applied.json observed before aging', markerWait.ok, 'recursive marker with current appliedAt', markerWait.ok ? 'present' : 'absent')
  const aged = backdateFreshMarkers(ctx.home, id, 30)
  ctx.expect('trash marker aged past the purge residence window', aged > 0, 'aged ≥1 fresh .applied.json', aged ? `${aged} aged` : 'none')

  // The "eligible for permanent deletion" summary is off-screen in this pane.
  // The observable prepare-complete proof is the candidate row (id + 30.0
  // days) and/or the typed-confirm prompt; never the summary banner.
  const purgeReady = (o) => has(o, id) && (has(o, '30.0') || pruneHas(o, 'purgeConfirm'))
  await submit('/prune-purge')
  const prepare = await waitFor((o) =>
    purgeReady(o) || ['purgeEmpty', 'purgeUnavailable'].some((k) => pruneHas(o, k)),
  60_000)
  if (!prepare.ok) { pruneSkip(ctx, '0.29 purge prepare', 'no prepare row within 60s', prepare.out, 'prune-purge-timeout'); return }
  if (pruneHas(prepare.out, 'purgeUnavailable')) { pruneSkip(ctx, '0.29 purge RPC', `purge seam unavailable: ${pruneSnippet(prepare.out, 'purgeUnavailable')}`, prepare.out, 'prune-purge-unavailable'); return }
  ctx.expect('/prune-purge preview lists the expired trash entry', purgeReady(prepare.out), 'candidate id + 30.0 days or purge confirm prompt', pruneSnippet(prepare.out, 'purgeConfirm'), prepare.out)

  // The typed confirm only works once its prompt is painted: "输入 purge" /
  // "type purge" (commands.ts compares the ANSWER to the literal `purge`).
  const ready = await waitFor((o) => pruneHas(o, 'purgeConfirm'), 15_000)
  ctx.expect('purge confirmation input is ready', ready.ok, '输入 purge / type purge prompt', ready.ok ? 'present' : 'absent', ready.out)
  await submit('purge')
  const committed = await waitFor((o) => pruneHas(o, 'committed'), 60_000)
  ctx.expect('typed "purge" permanently removed the trash entry', committed.ok && !trashExists(), 'purge committed and no trash marker left', committed.ok ? `trashPresent=${trashExists()}` : 'timeout', committed.out)
})

// Queue a turn first, THEN scroll away: `submit` itself jumps to the latest
// message (submit_scroll), so the off-screen reply must come from a turn that
// starts after the reader has left the bottom.
const queueTurnThenScrollAway = async (ctx, text) => {
  await waitFor((o) => idle(o) && !busyFrame(o), 30_000)
  await submit('E2E_SLOW keep the turn busy')
  await waitFor((o) => busyFrame(o), 30_000)
  await submit(text, { deferred: true })
  await waitFor((o) => hasDeliveryChoice(o), 20_000)
  sendKeys('Down'); await sleep(150); sendKeys('Enter') // Queue option 1
  const queued = await waitFor((o) => has(o, '⏸ 排队等待 #1'), 3_000)
  ctx.expect('scroll probe: queue wait row appears', queued.ok, '⏸ 排队等待 #1', queued.ok ? 'present' : 'absent', queued.out)
  // PgUp is only a scroll probe while the FIRST turn is still streaming.
  const stillBusy = await waitFor((o) => busyFrame(o) && has(o, '排队等待 #1'), 3_000)
  ctx.expect('scroll probe: first turn still streaming before PgUp', stillBusy.ok, 'busy frame + ⏸ 排队等待 #1', stillBusy.ok ? 'present' : 'absent', stillBusy.out)
  await scrollAway()
}

scenario('scroll-new-messages', '0.29: away-from-bottom N-new-messages hint → alt+shift+end / submit returns to bottom', async (ctx) => {
  await boot(ctx)
  await submit('E2E_LONG fill the transcript for scrollback')
  const filled = await waitFor((o) => has(o, 'E2E-LONG-DONE'), 90_000)
  ctx.expect('long reply filled the transcript', filled.ok, 'E2E-LONG-DONE', filled.ok ? 'present' : 'absent', filled.out)

  await queueTurnThenScrollAway(ctx, 'E2E_SINGLE queued reply arrives off-screen')
  // Premise first: the reader really left the bottom before we assert the
  // new-message hint or its disappearance.
  const away = await waitFor(hasAwayBottomHint, 5_000)
  ctx.expect('away-from-bottom premise (回到底部 / Jump to latest)', away.ok, 'to-latest hint', away.ok ? 'present' : 'absent', away.out)
  const hint = await waitFor(hasNewMsgHint, 120_000)
  ctx.expect('N-new-messages hint appears while scrolled away', away.ok && hint.ok, /↓ N 条新消息|N new messages/, hint.ok ? snippet(hint.out, '新消息') : 'no hint', hint.out)

  await toBottom() // alt+shift+end — works even while the composer owns focus
  const cleared = await waitFor((o) => !hasNewMsgHint(o), 20_000)
  ctx.expect('alt+shift+end returns to bottom (hint clears)', away.ok && hint.ok && cleared.ok, 'away + hint + then absent', cleared.ok ? 'absent' : 'still present', cleared.out)

  await queueTurnThenScrollAway(ctx, 'E2E_SINGLE second queued reply arrives off-screen')
  const away2 = await waitFor(hasAwayBottomHint, 5_000)
  ctx.expect('second away-from-bottom premise', away2.ok, 'to-latest hint', away2.ok ? 'present' : 'absent', away2.out)
  const hint2 = await waitFor(hasNewMsgHint, 120_000)
  ctx.expect('hint reappears for the next off-screen reply', away2.ok && hint2.ok, /↓ N 条新消息|N new messages/, hint2.ok ? 'present' : 'absent', hint2.out)
  // This submit is the IDLE to-bottom leg, so it must stay on the strict 15s
  // immediate-request assertion (no deferred option here).
  await waitFor((o) => idle(o) && !busyFrame(o), 30_000)
  await submit('E2E_SINGLE submit returns to latest')
  const cleared2 = await waitFor((o) => !hasNewMsgHint(o), 20_000)
  ctx.expect('submit returns to bottom (hint clears)', away2.ok && hint2.ok && cleared2.ok, 'away + hint + then absent', cleared2.ok ? 'absent' : 'still present', cleared2.out)
})

scenario('todo-write-scroll', '0.29: real todo_write tool → PgUp → reply visible / new-message hint after return', async (ctx) => {
  await boot(ctx)
  // A single todo turn cannot fill a 34-row pane. Seed real scrollback first
  // so PgUp genuinely leaves the bottom before the away-probe assertions.
  await submit('E2E_LONG fill the transcript before the todo probe')
  const filler = await waitFor((o) => has(o, 'E2E-LONG-DONE'), 90_000)
  ctx.expect('transcript has a full screen of scrollback', filler.ok, 'E2E-LONG-DONE', filler.ok ? 'present' : 'absent', filler.out)
  await waitFor((o) => idle(o) && !busyFrame(o), 30_000)
  await submit('E2E_TODO track the two e2e steps')
  // The dock may collapse to the one-line summary (`待办 [✓]1/2 · <active>`)
  // on a 34-row pane, so accept either a step row or the done/total summary.
  const todoWidget = (o) => {
    const f = flat(o)
    return (f.includes('待办') || f.toLowerCase().includes('todos'))
      && (f.includes('E2ETODOSTEPONE') || f.includes('E2ETODOSTEPTWO') || /\d+\/\d+/.test(f))
  }
  const widget = await waitFor(todoWidget, 120_000)
  ctx.expect('todo_write tool rendered the live todo widget', widget.ok, 'todo header + step or done/total count', widget.ok ? 'present' : 'absent', widget.out)

  await scrollAway()
  const away = await waitFor(hasAwayBottomHint, 5_000)
  ctx.expect('away-from-bottom premise before the reply probe', away.ok, '回到底部 / Jump to latest', away.ok ? 'present' : 'absent', away.out)
  // The reply arrives off-screen: either the hint surfaces it or it is visible.
  const surfaced = await waitFor((o) => has(o, 'E2E-TODO-DONE') || hasNewMsgHint(o), 90_000)
  ctx.expect('off-screen reply is visible or surfaced by the hint', away.ok && surfaced.ok, 'away + E2E-TODO-DONE or N-new-messages hint', surfaced.ok ? snippet(surfaced.out, 'E2E-TODO-DONE') : 'neither', surfaced.out)

  await toBottom()
  const visible = await waitFor((o) => has(o, 'E2E-TODO-DONE'), 30_000)
  ctx.expect('reply is readable after returning to bottom', away.ok && surfaced.ok && visible.ok, 'premise + E2E-TODO-DONE', visible.ok ? 'present' : 'absent', visible.out)
})

// R3 (scratch-only): real-bridge hard cap + pending abort. This scenario does
// NOT boot the TUI or touch the operator home. It spawns the dedicated driver
// which applies the REAL bridge over NDJSON frames, shrinks maxAskWaitMs via
// config injection, and aborts a pending ask with a REAL turn.abort frame.
// Only the journal STORE is redirected to a scratch JSONL; no registry call is
// faked. Use --keep to preserve the driver's evidence directory.
scenario('r3-hardcap-abort', 'R3: config-injected hard cap + real turn.abort frame on real bridge', async (ctx) => {
  const out = join(ctx.home, 'r3-evidence')
  mkdirSync(out, { recursive: true })
  const run = sh('bun', [join(HERE, 'r3-hardcap-abort.ts'), '--out', out, '--hard-cap-ms', '60', '--abort-cap-ms', '3000'], { encoding: 'utf8' })
  if (run.stdout) process.stdout.write(run.stdout)
  if (run.stderr) process.stderr.write(run.stderr)
  ctx.expect('R3 scratch driver exited 0', run.status === 0, 'exit 0', `exit ${run.status}`)
  const summaryPath = join(out, 'assert-summary.json')
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : undefined
  ctx.expect('R3 scratch driver had zero failed assertions', summary?.failures === 0, 'failures=0', summary)
  ctx.note(`R3 scratch evidence: ${out} (use --keep to preserve)`)
})

// R5 (scratch-only): bridge stdin EOF teardown on the real bridge. This
// scenario does NOT boot the TUI or touch the operator home. The driver raises
// two pending approval asks over real NDJSON frames, then fires a single stdin
// 'end' edge (NO session.close / turn.abort / signal / registry call), keeps the
// process alive until the scratch journal flushes, and reads that file directly
// to assert one connection-closed terminal row per pending id and zero
// ask.settled live frames. A second driver pass consumes the same journal with
// --resume-last to verify the notice text through the real derivation code.
scenario('r5-connection-closed', 'R5: stdin EOF teardown -> connection-closed + --resume-last notice replay', async (ctx) => {
  const out = join(ctx.home, 'r5-evidence')
  mkdirSync(out, { recursive: true })
  const driver = join(HERE, 'r5-connection-closed.ts')
  const eof = sh('bun', [driver, '--out', out], { encoding: 'utf8' })
  if (eof.stdout) process.stdout.write(eof.stdout)
  if (eof.stderr) process.stderr.write(eof.stderr)
  ctx.expect('R5 EOF scratch driver exited 0', eof.status === 0, 'exit 0', `exit ${eof.status}`)
  const journal = join(out, 'journal.jsonl')
  ctx.expect('R5 EOF arm wrote a scratch journal', existsSync(journal), 'journal.jsonl present', existsSync(journal))
  const summaryPath = join(out, 'assert-summary.json')
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : undefined
  ctx.expect('R5 EOF scratch driver had zero failed assertions', summary?.failures === 0, 'failures=0', summary)

  const replay = sh('bun', [driver, '--resume-last', '--journal', journal, '--out', out], { encoding: 'utf8' })
  if (replay.stdout) process.stdout.write(replay.stdout)
  if (replay.stderr) process.stderr.write(replay.stderr)
  ctx.expect('R5 --resume-last replay driver exited 0', replay.status === 0, 'exit 0', `exit ${replay.status}`)
  const replaySummaryPath = join(out, 'assert-summary-replay.json')
  const replaySummary = existsSync(replaySummaryPath) ? JSON.parse(readFileSync(replaySummaryPath, 'utf8')) : undefined
  ctx.expect('R5 --resume-last replay had zero failed assertions', replaySummary?.failures === 0, 'failures=0', replaySummary)
  ctx.note(`R5 scratch evidence: ${out} (use --keep to preserve)`)
})

// R6 (scratch-only): real TUI child session routing. This scenario does NOT
// reuse the suite's fake model or the generic scratch home — it spawns the
// dedicated driver which provisions a scratch profile with the use_agent
// companion mounted, boots the REAL TUI against the LOCAL two-phase mock LLM;
// the child raises the REAL approval card via a gated bash/write tool (the host
// rejects subagent-origin ask_user_question), the driver picks "Allow once"
// frame-by-frame, and reads the REAL journal + projection code. NO childSessionId
// or journal row is synthesised; if the real child cannot start the driver
// exits 2 with BLOCKED. Use --keep to keep.
scenario('r6-child-routing', 'R6: real use_agent child -> gated tool approval card -> childSessionId journal + projection', async (ctx) => {
  const out = join(ctx.home, 'r6-evidence')
  mkdirSync(out, { recursive: true })
  const run = sh('bun', [join(HERE, 'r6-child-routing.ts'), '--out', out], { encoding: 'utf8' })
  if (run.stdout) process.stdout.write(run.stdout)
  if (run.stderr) process.stderr.write(run.stderr)
  ctx.expect('R6 child-routing driver exited 0', run.status === 0, 'exit 0', `exit ${run.status}`)
  const summaryPath = join(out, 'assert-summary.json')
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : undefined
  ctx.expect('R6 scratch driver had zero failed assertions', summary?.failures === 0 && !summary?.blocked, 'failures=0 blocked=none', summary)
  ctx.note(`R6 scratch evidence: ${out} (use --keep to preserve)`)
})

// R6-029 (scratch-only): real TUI Ctrl+G child panel / transcript layer and
// the shipped maxRounds wrap-up at an injected short cap, plus the 0.29 policy
// seam checks. The dedicated driver provisions its own scratch home; this
// scenario keeps its evidence under the scenario's scratch DSH_HOME. It never
// writes the operator ~/.dsh. Use --keep to preserve the evidence directory.
scenario('r6-029', 'R6-029: real TUI Ctrl+G child panel + injected-cap wrap-up + 0.29 protocol checks', async (ctx) => {
  const out = join(ctx.home, 'r6-029-evidence')
  mkdirSync(out, { recursive: true })
  const run = sh('bun', [join(HERE, 'r6-029-driver.ts'), '--out', out, '--loop-delay-ms', '1500'], { encoding: 'utf8' })
  if (run.stdout) process.stdout.write(run.stdout)
  if (run.stderr) process.stderr.write(run.stderr)
  ctx.expect('R6-029 scratch driver exited 0', run.status === 0, 'exit 0', `exit ${run.status}`)
  const summaryPath = join(out, 'assert-summary.json')
  let summary
  try { summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : undefined } catch { summary = undefined }
  ctx.expect('R6-029 scratch driver had zero failed assertions', summary?.failures === 0, 'failures=0', summary)
  ctx.expect('R6-029 scratch driver was not blocked', !summary?.blocked, 'blocked=none', summary?.blocked ?? 'none')
  ctx.note(`R6-029 scratch evidence: ${out} (use --keep to preserve)`)
})

const waitForCfg = async (path, pred, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  let value
  while (Date.now() < deadline) {
    try {
      value = JSON.parse(readFileSync(path, 'utf8'))
      if (pred(value)) return { ok: true, value }
    } catch {}
    await sleep(300)
  }
  return { ok: false, value }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const selected = ONLY.length > 0
  ? scenarios.filter((s) => ONLY.some((q) => s.name === q || s.name.includes(q)))
  : scenarios
if (selected.length === 0) {
  console.error(`e2e-flows: no scenario matches --only=${ONLY.join(',')}`)
  console.error(`available: ${scenarios.map((s) => s.name).join(', ')}`)
  process.exit(2)
}

let fake
try {
  fake = await startFakeModel()
  FAKE_PORT = fake.port
  console.log(`e2e-flows: fake model on 127.0.0.1:${FAKE_PORT} (log: ${MODEL_LOG})`)
  console.log(`e2e-flows: run dir ${RD}`)

  const results = []
  const runStart = Date.now()
  for (const [i, s] of selected.entries()) {
    const modelStart = modelLogLines().length
    const home = mkdtempSync(join(tmpdir(), `e2e-${s.name}-home-`))
    const ws = mkdtempSync(join(tmpdir(), `e2e-${s.name}-ws-`))
    const sess = `e2e-${s.name}-${process.pid}-${i}`
    console.log(`\n=== [${i + 1}/${selected.length}] ${s.name} — ${s.title}`)

    // fake-gw/demo-1 has no reasoning-effort catalog: the provisioned `high`
    // default makes turn/start fail with UNSUPPORTED_REASONING_EFFORT. Drop it
    // in this isolated scratch home only (same fix R6 uses via the same flag).
    const setup = sh('node', [join(HERE, 'setup-home.mjs'), '--home', home, '--workspace', ws, '--port', String(FAKE_PORT), '--no-reasoning-effort'], { encoding: 'utf8' })
    if (setup.status !== 0) {
      console.log(`  FAIL scratch home — ${setup.stderr || setup.stdout}`)
      preserveFailureEvidence(s.name, home)
      results.push({ name: s.name, status: 'FAIL', ok: false, passes: 0, failures: 1, skipped: [] })
      continue
    }

    const ctx = new Ctx(s.name, home, ws, sess, modelStart)
    globalThis.CUR_SESS = sess
    globalThis.CUR_HOME = home
    const started = Date.now()
    let error = ''
    try {
      await s.fn(ctx)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      ctx.failures++
      console.log(`  FAIL harness error — ${error}`)
    } finally {
      try { await quitClient() } catch {}
      try { reapHost() } catch {}
      tmux('kill-session', '-t', sess)
    }
    const secs = ((Date.now() - started) / 1000).toFixed(1)
    // SKIP is a distinct outcome: it is never PASS and never ok=true, so an
    // unverified capability (e.g. mcp with no MCP server) cannot turn a run
    // green. A real failure still dominates a skip.
    const status = ctx.failures > 0 ? 'FAIL' : ctx.skips.length > 0 ? 'SKIP' : 'PASS'
    const ok = status === 'PASS'
    console.log(`  ${status} ${s.name} (${secs}s, ${ctx.passes} checks${ctx.skips.length ? `, ${ctx.skips.length} skip` : ''})`)
    // Keep diagnostic material before RD / the scratch home can be removed.
    if (!ok) preserveFailureEvidence(s.name, home)
    results.push({ name: s.name, status, ok, passes: ctx.passes, failures: ctx.failures, skipped: ctx.skips, secs })
    if (ok && !KEEP) {
      rmSync(home, { recursive: true, force: true })
      rmSync(ws, { recursive: true, force: true })
    } else if (!ok) {
      console.log(`  kept scratch home: ${home}`)
      console.log(`  kept workspace:    ${ws}`)
    }
  }

  const totalSecs = ((Date.now() - runStart) / 1000).toFixed(1)
  console.log('\n================ E2E FLOWS SUMMARY ================')
  console.log('scenario        result   checks  time')
  for (const r of results) {
    const status = r.status ?? (r.ok ? 'PASS' : 'FAIL')
    console.log(`${r.name.padEnd(15)} ${String(status).padEnd(8)} ${String(r.passes).padStart(3)}     ${r.secs ?? '-'}s`)
  }
  const failed = results.filter((r) => (r.status ?? (r.ok ? 'PASS' : 'FAIL')) === 'FAIL')
  const skipped = results.filter((r) => r.status === 'SKIP')
  const skips = results.flatMap((r) => r.skipped ?? [])
  if (skips.length > 0) {
    console.log('\nSKIPPED:')
    for (const s of skips) console.log(`  - ${s}`)
  }
  const notPassed = failed.length + skipped.length
  const verdict = notPassed === 0
    ? 'PASS'
    : `FAIL (${failed.length} failed, ${skipped.length} skipped)`
  console.log(`\nE2E FLOWS RESULT: ${verdict}  ·  ${totalSecs}s total`)
  // A SKIP keeps the run non-zero: an uncovered capability is not a green run.
  process.exitCode = notPassed === 0 ? 0 : 1
} finally {
  try { fake?.child.kill() } catch {}
  tmux('kill-server')
  if (!KEEP) { try { rmSync(RD, { recursive: true, force: true }) } catch {} }
}
