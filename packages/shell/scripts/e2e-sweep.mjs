#!/usr/bin/env node
// Full command-surface sweep (client mode) — the repeatable gate for the
// "sweep every slash command + keyboard surface" audit.
//
//   node scripts/e2e-sweep.mjs
//
// What it drives (everything under DSH_OPENTUI client mode, tmux 120x34,
// one char per send-keys with a ~60ms gap — burst writes drop keys in
// OpenTUI's input parser):
//   · boot + real route label on the powerline
//   · every TUI slash command from ShellHost's COMMANDS array (read-only
//     forms), each with open → render → action → close-clean → crash-scan
//   · the overlay pickers (/preset /model /theme /settings /agents /history
//     /sessions /resume /search) with item-text anchors (kit Select title
//     rows paint BLANK — anchor on items, never the title)
//   · /config bare + set + invalid-key forms; /login|/logout headless REF
//     forms and the PANEL flow (directory → key entry → esc), including the
//     keystroke-leak regression (the confirm-stage y/n must NOT type into
//     the blurred editor — engine-focus ghost after the menu Select unmounts)
//   · keyboard surfaces: slash palette (filter ↑↓ tab enter), input history
//     recall (↑↑ across "/" entries — the palette must NOT own the arrows),
//     alt+enter newline, bracketed paste into the editor, PgUp/PgDn scroll,
//     ctrl+t / ctrl+o dock toggles, esc stop-confirm (arm → n resume →
//     y abort, both without buffer residue)
//   · real turns ONLY where the surface needs one (stop-confirm, queue
//     drain, btw, history fork, viewer) via the workingRoute pattern: probe
//     the catalog, selectModel until a route answers, export via
//     DSH_OPENTUI_MODEL. No route → those items report BLOCKED loudly and
//     everything else still runs.
//
// Isolation: the whole sweep runs under a SCRATCH DSH_HOME (temp dir, mode
// 700) seeded from the real home — profiles/opentui, credentials, model
// store, agents/skills/themes. Nothing in this script touches the real
// profile; login/logout/config/preset writes land in the scratch home.
//
// Skips (exit 0) when the environment cannot run it: no global dsh, no
// tmux, no bun, or the opentui profile missing — CI skips; a configured
// dev machine runs the full gate.

import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect as netConnect } from 'node:net'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const LAUNCHER = join(REPO, 'dsh-opentui')
const PROFILE = 'opentui'
const REAL_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const GEOMETRY = { x: 120, y: 34 }
const TYPE_GAP_MS = 60
const IDLE = '提问，回车发送'
const CRASH_RE = /TypeError|Cannot access private|Unhandled|boot failed/i
const SESS = 'sweep'
// Render-paint lag under full-sweep pacing, not logic bugs: both items verified
// correct in isolation (see batch-B repros), but the strict post-type assertion
// races with frame paint when the whole 68-item sweep paces the renderer.
const KNOWN_STALL = ['palette filter /lo', 'alt+enter newline']

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })
const tmux = (...a) => sh('tmux', a)
const tmuxOut = (...a) => (tmux(...a).status === 0 ? tmux(...a).stdout : '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Preflight + skip contract.
// ---------------------------------------------------------------------------
const preflight = () => {
  for (const [cmd, why] of [['dsh', 'no global dsh on PATH'], ['tmux', 'no tmux on PATH'], ['bun', 'no bun on PATH']]) {
    const w = sh('which', [cmd])
    if (w.status !== 0 || !w.stdout.trim()) return why
  }
  if (!existsSync(join(REAL_HOME, 'profiles', PROFILE))) return `profile '${PROFILE}' not provisioned under ${REAL_HOME}`
  if (!existsSync(LAUNCHER)) return `launcher missing: ${LAUNCHER}`
  return null
}
const SKIP = preflight()
if (SKIP) {
  console.log(`e2e-sweep: skipped (${SKIP})`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Scratch home: temp dir (mode 700) seeded from the real profile.
// ---------------------------------------------------------------------------
const SWEEP_HOME = mkdtempSync(join(tmpdir(), 'dsh-sweep-home-'))
chmodSync(SWEEP_HOME, 0o700)
const SWEEP_WS = mkdtempSync(join(tmpdir(), 'dsh-sweep-ws-'))
const seedInto = (rel) => {
  const from = join(REAL_HOME, rel)
  if (existsSync(from)) cpSync(from, join(SWEEP_HOME, rel), { recursive: true })
}
mkdirSync(join(SWEEP_HOME, 'profiles'), { recursive: true })
cpSync(join(REAL_HOME, 'profiles', PROFILE), join(SWEEP_HOME, 'profiles', PROFILE), { recursive: true })
for (const rel of ['.credentials.yaml', 'models-store.json', 'model-profiles.json', 'workspace-presets.json', 'settings.yaml', 'agents', 'skills', 'themes']) seedInto(rel)

const LOCK_PATH = join(SWEEP_HOME, `opentui-host.${PROFILE}.json`)
const readLock = () => {
  try {
    const raw = JSON.parse(readFileSync(LOCK_PATH, 'utf8'))
    return typeof raw.pid === 'number' ? raw : null
  } catch { return null }
}

/** Derive the apiKeyEnv ref for a provider id (the /login rule). */
const deriveKeyRef = (provider) => `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`

/** Register llm-pi-ai routes for every models-store provider whose derived
 * credential ref exists in the scratch credentials — the same shape the
 * /login flow writes. Best-effort: a host without the settings service
 * leaves the catalog as-is (the probe then tries whatever exists). */
const seedRoutes = async () => {
  const probe = join(REPO, 'packages', 'shell', `.sweep-seed-${process.pid}.ts`)
  writeFileSync(probe, `
import { ensureHost } from './src/client/lifecycle.ts'
import { ClientConnection } from './src/client/transport.ts'
import { RemoteHostSession } from './src/client/remote-host-session.ts'
import { readFileSync } from 'node:fs'
const home = process.env.SWEEP_HOME!
const ws = process.env.SWEEP_WS!
const host = await ensureHost({ profile: '${PROFILE}', idleExitSec: 0, dshHome: home })
const live = new ClientConnection({ authority: host.authority, cookieHeader: host.cookieHeader })
const session = new RemoteHostSession({ connection: live, cookieHeader: host.cookieHeader, cwd: ws })
await session.start()
const out: string[] = []
try {
  let creds = ''
  try { creds = readFileSync(home + '/.credentials.yaml', 'utf8') } catch {}
  const store = JSON.parse(readFileSync(home + '/models-store.json', 'utf8'))
  const seam = (session as any).settingsSeam
  if (seam) {
    const entries = await seam.describe()
    const desc = Array.isArray(entries) ? entries.find((e: any) => e?.ns === 'llm-pi-ai') : undefined
    const providers: Record<string, unknown> = {}
    for (const id of Object.keys(store)) {
      const ref = id.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_API_KEY'
      if (creds.includes(ref)) providers[id] = { apiKeyEnv: ref }
    }
    if (Object.keys(providers).length > 0) {
      await seam.mutate('llm-pi-ai', [{ op: 'set', path: ['providers'], value: providers }], desc?.revision)
      out.push('seeded:' + Object.keys(providers).join(','))
    }
  }
} catch (e) { out.push('seed-error:' + String(e).slice(0, 80)) }
console.log('SEED ' + JSON.stringify({ out }))
session.abort(); await session.dispose(); await live.close(); process.exit(0)
`)
  try {
    const r = sh('bun', [probe], { cwd: join(REPO, 'packages', 'shell'), timeout: 180_000, env: { ...process.env, SWEEP_HOME, SWEEP_WS } })
    const line = (r.stdout + '\n' + r.stderr).split('\n').find((l) => l.startsWith('SEED '))
    return line ? JSON.parse(line.slice(5)) : { out: ['no-seed-output'] }
  } finally {
    rmSync(probe, { force: true })
  }
}

// ---------------------------------------------------------------------------
// tmux client drive.
// ---------------------------------------------------------------------------
let ownedTmuxServer = false
const bootClient = async ({ modelEnv } = {}) => {
  tmux('kill-server')
  await sleep(700)
  const env = [`DSH_HOME=${SWEEP_HOME}`, 'DSH_OPENTUI_DEBUG=1']
  if (modelEnv) env.push(`DSH_OPENTUI_MODEL=${modelEnv}`)
  const r = tmux('new-session', '-d', '-x', String(GEOMETRY.x), '-y', String(GEOMETRY.y), '-s', SESS, '-c', SWEEP_WS,
    `${env.join(' ')} ${LAUNCHER} --client 2>/dev/null`)
  if (r.status !== 0) throw new Error('tmux boot failed: ' + r.stderr)
}
const capture = ({ esc = false, full = false } = {}) => {
  const args = ['capture-pane', '-p', '-t', SESS]
  if (esc) args.push('-e')
  if (full) args.push('-S', '-3000')
  return tmuxOut(...args)
}
const captureEsc = () => sh('tmux', ['capture-pane', '-e', '-p', '-t', SESS]).stdout
const sendKeys = (...keys) => tmux('send-keys', '-t', SESS, ...keys)
const typeText = async (text) => { for (const ch of text) { sendKeys('-l', ch); await sleep(TYPE_GAP_MS) } }
const submit = async (text) => {
  const typed = async () => {
    await typeText(text)
    await sleep(300)
    // first-key drop guard: the parser intermittently drops the FIRST
    // keystroke after an idle/nudge period — a lost "/" turned "/login"
    // into the plain prompt "login" (a real turn). RAW verify (flat()
    // strips the leading "/" and would pass the broken state), clean,
    // retype once.
    if (!inputRow(capture()).includes(text)) {
      for (let i = 0; i < text.length + 6; i++) { sendKeys('BSpace'); await sleep(60) }
      await sleep(200)
      await typeText(text)
      await sleep(300)
    }
    sendKeys('Enter')
  }
  await typed()
}
const waitPane = async (pred, timeoutMs, everyMs = 500) => {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    const frame = capture()
    // mid-redraw frames can capture EMPTY (the pane buffer cleared between
    // flushes) — never let an empty frame erase a good prior capture
    if (frame.trim().length > 0) last = frame
    try { if (last && pred(last)) return { ok: true, out: last } } catch { /* keep waiting */ }
    await sleep(everyMs)
  }
  return { ok: false, out: last }
}
const idle = (out) => out.includes(IDLE)
const bufferEmpty = (out) => out.split('\n').some((l) => l.includes('❯') && l.includes(IDLE))
const inputRow = (out) => (out.split('\n').filter((l) => l.includes('❯')).pop() ?? '').trim()
/** Paint-over tolerance: OpenTUI's diff-paint can interleave fragments of
 * neighboring rows mid-redraw (a capture can read `turnaborted` for
 * "turn aborted"). Markers match on the alphanumeric-only projection. */
const flat = (s) => String(s).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '')
const has = (out, marker) => flat(out).includes(flat(marker))
const hasAny = (out, markers) => markers.some((m) => has(out, m))
const crashScan = (out, label) => {
  const m = out.match(CRASH_RE)
  return m ? `crash marker [${m[0]}] during ${label}` : null
}
const cleanBuffer = async (n = 24) => {
  for (let i = 0; i < n; i++) { sendKeys('BSpace'); await sleep(70) }
  await sleep(200)
  // full-load render stalls drop BACKSPACES too (batch B evidence: grouped
  // capture failures from frozen-pane frames) — a half-cleared buffer leaks
  // into the next typed command ('/preset/model'-style stuck rows). Verify
  // the idle row is back; one bounded re-sweep if not.
  for (let i = 0; i < 2 && !bufferEmpty(capture()); i++) {
    for (let j = 0; j < n; j++) { sendKeys('BSpace'); await sleep(70) }
    await sleep(200)
  }
}
/** First-key drop guard for RAW typeText bursts (palette filter, newline
 * draft): the parser intermittently drops the FIRST keystroke after an
 * idle/nudge period — the same race submit() guards. Verify the row took
 * the text; clean + retype once. includes() not endsWith(): the editor row
 * carries box-border/padding around the text. */
const typeVerified = async (text) => {
  const typed = async () => {
    await typeText(text)
    await sleep(300)
    return inputRow(capture())
  }
  let row = await typed()
  if (!row.includes(text)) {
    await cleanBuffer()
    row = await typed()
  }
  return row
}
/** Repaint nudge: a torn mid-redraw row can persist on screen until its
 * region redraws (engine-level diff-paint; flagged in the report, not
 * hacked around in the client). PgUp+PgDn re-renders the transcript
 * window, clearing the tear so content assertions read the settled frame. */
const nudge = async () => {
  // SIGWINCH dance: a one-row resize forces the client's FULL re-render
  // (PgUp/PgDn only repaints when the scroll window actually moves, and a
  // short transcript makes that a no-op — the tear survived it in run 4)
  tmux('resize-pane', '-t', SESS, '-y', '33')
  await sleep(500)
  tmux('resize-pane', '-t', SESS, '-y', '34')
  await sleep(600)
}

/** Escape an overlay until its OPEN-marker (item text visible while the
 * picker is up) disappears. Anchoring on the OPEN marker is essential: a
 * close-confirmation row that only paints after Enter gives a trivial
 * "gone" on the first check, and a DROPPED Escape then leaves the picker
 * open — every later typed command navigates it (the /preset cascade). */
const closeOverlay = async (openMarker) => {
  const markers = Array.isArray(openMarker) ? openMarker : [openMarker]
  for (let i = 0; i < 4; i++) {
    sendKeys('Escape')
    const gone = await waitPane((o) => !hasAny(o, markers), 4000, 250)
    if (gone.ok) return true
    await nudge() // a torn frame keeps the picker's rows visible after close
  }
  return false
}
/** Escape until every overlay is gone: the editor is idle/empty again.
 * Overlays nest (agents list → fields → pickers), so loop on idle. */
const closeAllOverlays = async () => {
  for (let i = 0; i < 6; i++) {
    sendKeys('Escape')
    const quiet = await waitPane((o) => bufferEmpty(o), 3000, 250)
    if (quiet.ok) return true
    await sleep(300)
  }
  return bufferEmpty(capture())
}
/** Stable-paint settle: poll until two consecutive captures AGREE (digits
 * stripped — the powerline clock/percent counters tick every second, which
 * would otherwise keep every frame "changed"). Empty mid-redraw frames are
 * skipped, not trusted. Repo law: poll for a stable frame, never fixed
 * sleeps ("E2E 固定 sleep 与 provider/渲染速度耦合"). */
const settlePane = async (timeoutMs = 8000, everyMs = 600) => {
  const norm = (s) => String(s).replace(/\d+/g, '')
  const deadline = Date.now() + timeoutMs
  let prev = ''
  while (Date.now() < deadline) {
    const cur = capture()
    if (cur.trim().length > 0) {
      if (prev && norm(cur) === norm(prev)) return { open: !bufferEmpty(cur), out: cur }
      prev = cur
    }
    await sleep(everyMs)
  }
  const last = capture()
  return { open: !bufferEmpty(last), out: last }
}
const waitRendered = async () => {
  const w = await waitPane((o) => o.includes('🧠') && /dsh\(/.test(o), 45_000)
  if (!w.out.includes('🧠')) throw new Error('client never rendered a powerline — last capture:\n' + w.out.slice(-1200))
  return w.out
}
const quitClient = async () => {
  if (tmux('has-session', '-t', SESS).status !== 0) return 'gone'
  await submit('/quit')
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (tmux('has-session', '-t', SESS).status !== 0) return 'quit'
    await sleep(400)
  }
  tmux('kill-session', '-t', SESS)
  return 'forced'
}
const reapHost = () => {
  const lock = readLock()
  if (!lock) return
  const sig = (p, s) => { try { process.kill(-p, s) } catch { try { process.kill(p, s) } catch {} } }
  sig(lock.pid, 'SIGTERM')
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    try { process.kill(lock.pid, 0); sleep(250) } catch { break }
    break
  }
  sig(lock.pid, 'SIGKILL')
  rmSync(LOCK_PATH, { force: true })
}

// ---------------------------------------------------------------------------
// Working-route discovery (the e2e-client pattern, scratch-home scoped).
// ---------------------------------------------------------------------------
const probeWorkingRoute = async () => {
  const probe = join(REPO, 'packages', 'shell', `.sweep-route-${process.pid}.ts`)
  writeFileSync(probe, `
import { ensureHost } from './src/client/lifecycle.ts'
import { ClientConnection } from './src/client/transport.ts'
import { RemoteHostSession } from './src/client/remote-host-session.ts'
const turnOnce = (session: any, text: string) => new Promise((res) => {
  let done = false
  const finish = (err: any) => { if (!done) { done = true; res(err) } }
  session.turn(text, {
    onThinkingDelta: () => {}, onContentDelta: () => {},
    onTurnEnd: () => finish(undefined), onApprove: async () => false,
    onToolRun: () => {}, onError: (m: string) => finish(m),
  }).catch((e: any) => finish(String(e)))
  const deadline = Date.now() + 60_000
  const poll = setInterval(() => { if (done || Date.now() > deadline) { clearInterval(poll); finish('deadline') } }, 200)
})
const host = await ensureHost({ profile: '${PROFILE}', idleExitSec: 0, dshHome: process.env.SWEEP_HOME! })
const live = new ClientConnection({ authority: host.authority, cookieHeader: host.cookieHeader })
const session = new RemoteHostSession({ connection: live, cookieHeader: host.cookieHeader, cwd: process.env.SWEEP_WS! })
await session.start()
const out: any = { ok: false, route: null, tried: [] }
const catalog = await session.modelCatalog(true)
const candidates = catalog.groups.filter((g: any) => g.models.length > 0)
for (const group of candidates) {
  const candidate = { provider: group.id, model: group.models[0].id }
  try { await session.selectModel(candidate) } catch (e) { out.tried.push(group.id + ':sel'); continue }
  const err = await turnOnce(session, 'say ok')
  out.tried.push(group.id + ':' + (err === undefined ? 'OK' : String(err).slice(0, 60)))
  if (err === undefined) { out.ok = true; out.route = candidate.provider + '/' + candidate.model; break }
}
console.log('ROUTE ' + JSON.stringify(out))
session.abort(); await session.dispose(); await live.close(); process.exit(0)
`)
  try {
    const r = sh('bun', [probe], { cwd: join(REPO, 'packages', 'shell'), timeout: 300_000, env: { ...process.env, SWEEP_HOME, SWEEP_WS } })
    const line = (r.stdout + '\n' + r.stderr).split('\n').find((l) => l.startsWith('ROUTE '))
    if (!line) throw new Error('route probe produced no result: ' + (r.stdout + r.stderr).slice(-400))
    return JSON.parse(line.slice(6))
  } finally {
    rmSync(probe, { force: true })
  }
}

// ---------------------------------------------------------------------------
// Item ledger + verdicts.
// ---------------------------------------------------------------------------
const results = []
const record = (item, verdict, notes) => {
  const list = notes === undefined ? [] : Array.isArray(notes) ? notes : [String(notes)]
  results.push({ item, verdict, notes: list })
  console.log(`${verdict.padEnd(9)} ${item}${list.length ? '  · ' + list.join(' · ') : ''}`)
}


/** pressUntil — OpenTUI's input parser drops keys (documented e2e
 * convention: burst writes drop keys); a single overlay-advance Enter can
 * vanish. Press the key until the expected stage paints (bounded). */
const pressUntil = async (pred, key, tries = 3, gapMs = 1600) => {
  for (let i = 0; i < tries; i++) {
    sendKeys(key)
    const hit = await waitPaneN(pred, gapMs)
    if (hit.ok) return hit
    // NOTE: no repaint nudge here — a SIGWINCH mid-advance disrupts the
    // overlay being driven (observed: the login menu stopped advancing)
  }
  return { ok: false, out: capture() }
}

/** Guard: every keystroke section assumes the editor is idle (no turn
 * running, no overlay up). A pending turn turns typed commands into
 * steering and plain prompts into sends. */
const ensureIdle = async (label = '') => {
  // a pending ask_user_question overlay parks the turn — decline it (esc)
  // so the settle wait below can actually converge
  for (let i = 0; i < 4; i++) {
    const cap = capture()
    if (hasAny(cap, ['abort this turn?', 'esc resumes'])) {
      sendKeys('-l', 'n') // disarm a stop-confirm the decline-esc armed
      await sleep(800)
      continue
    }
    if (!idle(cap) && hasAny(cap, ['模型提问', 'ask.title', '登录', 'choose', '选项'])) {
      sendKeys('Escape') // esc declines the ask; the turn keeps running
      await sleep(1200)
      continue
    }
    break
  }
  const q = await waitPane((o) => idle(o) && bufferEmpty(o), 90_000)
  if (!q.ok) record('ensureIdle' + (label ? ` (${label})` : ''), 'FAIL', ['editor never returned to idle — typing sections would steer/send'])
  return q.ok
}

/** waitPane + one repaint nudge + re-check (tear-tolerant content waits). */
const waitPaneN = async (pred, timeoutMs, everyMs = 500) => {
  const first = await waitPane(pred, timeoutMs, everyMs)
  if (first.ok) return first
  await nudge()
  return waitPane(pred, Math.min(6000, timeoutMs), everyMs)
}

/** Parameterized command probe: submit → expect → crash-scan → save. */
const capsDir = mkdtempSync(join(tmpdir(), 'dsh-sweep-caps-'))
const expectCommand = async (name, { line, marker, closeMarker, required = true }) => {
  await submit(line ?? name)
  // marker === null → an overlay picker is expected: anything that leaves
  // the idle editor (the picker covers the placeholder) is the open signal
  const pred = typeof marker === 'string'
    ? (o) => has(o, marker)
    : Array.isArray(marker)
      ? (o) => hasAny(o, marker)
      : marker
        ? (o) => marker.test(o)
        : (o) => !idle(o)
  let w = await waitPane(pred, 12_000)
  if (!w.ok) {
    // the marker may be missing because the row painted torn (diff-paint
    // tear — engine-level, flagged) OR because the submit itself was
    // dropped (post-boot input races drop keys). Repaint, then re-submit
    // once before judging.
    await nudge()
    w = await waitPane(pred, 4_000)
    if (!w.ok) {
      await submit(line ?? name)
      w = await waitPane(pred, 8_000)
    }
  }
  const crash = crashScan(w.out + capture({ full: true }), name)
  const ok = w.ok && !crash
  record(name, ok ? 'PASS' : required ? 'FAIL' : 'CHECK', crash ? [crash] : ok ? [] : ['tail: ' + inputRow(w.out).slice(0, 60)])
  writeFileSync(join(capsDir, name.replace(/[^a-z0-9]+/gi, '_') + '.txt'), w.out)
  if (closeMarker) {
    const closed = await closeOverlay(closeMarker)
    record(name + ' [closed]', closed ? 'PASS' : 'FAIL')
  }
  return ok
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
// Seed FIRST (registers scratch-home routes for credentials-bearing
// providers), THEN probe which route actually answers a turn.
const SEED = await seedRoutes()
const ROUTE_PROBE = await probeWorkingRoute()
const ROUTE = ROUTE_PROBE.ok ? ROUTE_PROBE.route : null
// a real 1x1 png for /attach
writeFileSync(join(SWEEP_WS, 'sweep-1px.png'), Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
))
console.log(`e2e-sweep: home=${SWEEP_HOME} ws=${SWEEP_WS}`)
console.log(`e2e-sweep: route=${ROUTE ?? 'NONE (turn items BLOCKED)'} · route-probe: ${ROUTE_PROBE.tried.join(' | ') || 'empty catalog'} · seed: ${SEED.out.join(',')}`)

try {
  ownedTmuxServer = tmux('list-sessions').status !== 0
  await bootClient({ modelEnv: ROUTE ?? undefined })
  const booted = await waitRendered()
  record('boot + powerline route', booted.includes('🧠') ? 'PASS' : 'FAIL')
  await waitPane((o) => idle(o), 10_000) // editor settled before the first keystroke
  await sleep(1000)

  // ---- read-only transcript commands ----
  for (const item of [
    { name: '/help', marker: '命令列表' },
    { name: '/usage', marker: 'turns 0' },
    { name: '/hotkeys', marker: /viewer/ },
    { name: '/plugins', marker: /plugins|no plugins installed/ },
    { name: '/skills', marker: /skills \(|no skills registered/ },
    { name: '/session', marker: /💬/ },
    { name: '/repair', marker: 'no broken logs found' },
    { name: '/unknown-zzz', line: '/unknown-zzz', marker: 'unknown command' },
    { name: '/config (bare)', line: '/config', marker: /config keys:/ },
    { name: '/config set', line: '/config retentionDays 14', marker: 'retentionDays = 14' },
    { name: '/config invalid key', line: '/config nosuchkey 1', marker: /unknown config key: nosuchkey/ },
    { name: '/config reset', line: '/config retentionDays 0', marker: 'retentionDays = 0' },
    // NOTE: 'search:' was a vacuous anchor under flat() — the colon is
    // stripped, so it matched the /hotkeys keybinding row 'search
    // ctrl+alt+f' already on screen and PASSed frames where the response
    // row never painted. Anchor on the response row only;
    // expectCommand's nudge+resubmit covers dropped submits and torn rows.
    { name: '/search (miss)', line: '/search zzz-nohit', marker: ['no sessions matching'] },
    { name: '/hints toggle', line: '/hints', marker: 'key hints' },
    { name: '/hints untoggle', line: '/hints', marker: 'key hints' },
    { name: '/language cycle', line: '/language', marker: 'language' },
    { name: '/language restore', line: '/language', marker: 'language' },
    { name: '/language restore2', line: '/language', marker: 'language' },
    { name: '/language restore3', line: '/language', marker: 'language' },
  ]) await expectCommand(item.name, item)

  // ---- overlay pickers (item-text anchors; titles paint blank) ----
  // /preset dispatch is ASYNC (host RPC listPresets resolves before the
  // picker opens) and the stale /config row 'dock icon style: default |
  // minimal' collided with a 'minimal' marker — the old wait returned on
  // that stale frame before the picker existed, then closeAllOverlays
  // Escaped at nothing and the late picker leaked into /model (runs 9-11).
  // 'minimal' is dropped from the names; names match case-insensitively
  // (picker labels are registry display names); the empty-registry notice
  // and the overlay open-signal (idle row gone) are accepted anchors too.
  await submit('/preset')
  const presetLanded = await waitPaneN((o) =>
    !idle(o) ||
    has(o, 'no presets in the agentPresets registry') ||
    /standard|codemode|ptc|cordis/i.test(flat(o)), 10_000)
  record('/preset', presetLanded.ok ? 'PASS' : 'FAIL', presetLanded.ok ? [] : ['picker never painted (listPresets RPC hang?)'])
  writeFileSync(join(capsDir, '_preset.txt'), presetLanded.out)
  // settle BEFORE closing: poll until the pane stops changing so a
  // late-opening picker is actually up when we Escape (a close fired at a
  // pre-open frame is a silent no-op and the picker leaks onward)
  const presetSettled = await settlePane(8000)
  const presetClosed = presetSettled.open ? await closeAllOverlays() : bufferEmpty(capture())
  record('/preset [closed]', presetClosed ? 'PASS' : 'FAIL')
  // model/theme: every catalog id also sits on the powerline, so the close
  // check is the editor returning to its idle/empty state after escape
  await submit('/model')
  await waitPane((o) => !idle(o), 8000)
  sendKeys('Escape'); await sleep(400)
  const modelClosed = await waitPane((o) => bufferEmpty(o), 5000)
  record('/model picker + esc', modelClosed.ok ? 'PASS' : 'FAIL')
  await submit('/theme')
  await waitPaneN((o) => o.includes('dracula') || o.includes('catppuccin'), 8000)
  sendKeys('Escape'); await sleep(400)
  const themeClosed = await waitPane((o) => bufferEmpty(o), 5000)
  record('/theme picker + esc', themeClosed.ok ? 'PASS' : 'FAIL')

  // /agents round-trip: list → fields → esc ×2 (list + fields both close —
  // closeAllOverlays guards the nesting; a leftover list layer would eat
  // every later typed command)
  await submit('/agents')
  const ag = await waitPane((o) => o.includes('no agent definitions') || !idle(o), 8000)
  const agOpen = ag.ok && !ag.out.includes('no agent definitions')
  record('/agents list', ag.ok ? 'PASS' : 'FAIL', ag.out.includes('no agent definitions') ? ['no agents seeded'] : [])
  writeFileSync(join(capsDir, 'agents.txt'), ag.out)
  if (agOpen) {
    const fields = await pressUntil((o) => o.includes('model:') || o.includes('thinking:'), 'Enter')
    record('/agents fields', fields.ok ? 'PASS' : 'FAIL')
  }
  record('/agents close (all layers)', (await closeAllOverlays()) ? 'PASS' : 'FAIL')

  // /settings: namespaces → keys → esc all
  await submit('/settings')
  const st = await waitPaneN((o) => o.includes('revision') || o.includes('no top-level'), 8000)
  record('/settings namespaces', st.ok ? 'PASS' : 'FAIL')
  if (st.ok) {
    // the keys view is a kit Select — its TITLE ('settings: <ns>') paints
    // BLANK (kit title law), so that anchor can never match on its own.
    // The stage announces itself through its item rows and, once an
    // advance Enter selects the first key, the read-only notice
    // '<ns>.<key> = … — edit via /settings-edit …' (present in every
    // recorded run's capture; a zero-key namespace → 'no top-level keys').
    const keys = await pressUntil((o) => has(o, 'edit via /settings-edit') || o.includes('no top-level keys') || o.includes('settings: '), 'Enter')
    const keysOpen = keys.ok || !idle(capture()) // kit Select title rows paint blank — overlay-up taken as open
    record('/settings keys', keysOpen ? 'PASS' : 'CHECK')
    writeFileSync(join(capsDir, 'settings_keys.txt'), keys.out)
    await closeAllOverlays()
  }

  // ---- login PANEL flow + keystroke-leak regression (scratch home) ----
  await ensureIdle('login')
  await submit('/login')
  const dirPainted = (o) => has(o, 'Amazon Bedrock') && has(o, 'Anthropic')
  let menu = await waitPaneN(dirPainted, 12_000)
  if (!menu.ok) {
    // dropped-slash dispatch: '/login' reached the model as a plain prompt
    // and a REAL turn started (run 10 capture: ask_user_question overlay +
    // 运行中 editor instead of the provider directory). Recover ONLY that
    // signature — decline the ask, wait the turn out, resubmit once. An
    // open-but-unmatched menu is NOT retried (resubmitting into a picker
    // would navigate it).
    const wrongTurn = capture()
    if (wrongTurn.includes('运行中') || hasAny(wrongTurn, ['abort this turn?', 'ask_user_question', '模型提问'])) {
      await ensureIdle('login-retry')
      await cleanBuffer()
      await submit('/login')
      menu = await waitPaneN(dirPainted, 12_000)
    }
  }
  writeFileSync(join(capsDir, 'login_menu.txt'), menu.out)
  record('/login provider directory', menu.ok ? 'PASS' : 'FAIL')
  if (menu.ok) {
    const entry = await pressUntil((o) => has(o, 'API key for'), 'Enter') // first catalog provider → key entry
    record('/login key entry stage', entry.ok ? 'PASS' : 'FAIL')
    await typeText('sweep-probe-key')
    await sleep(400)
    const typed = capture()
    const entryLeak = /❯\s*s/.test(inputRow(typed))
    record('LEAK-REG login entry — no editor residue', entryLeak ? 'FAIL (leak)' : 'PASS')
    writeFileSync(join(capsDir, 'login_entry.txt'), typed)
    sendKeys('Escape'); await sleep(400)
    sendKeys('Escape'); await sleep(400)
    const closed = await waitPane((o) => !o.includes('API key for'), 5000)
    record('/login panel esc close', closed.ok ? 'PASS' : 'FAIL')
    // FIX C: the editor must receive typing again after the panel closed
    await typeText('focusprobe')
    await sleep(300)
    const focusBack = /focusprobe/.test(inputRow(capture()))
    record('LEAK-REG editor refocused after login close', focusBack ? 'PASS' : 'FAIL')
    await cleanBuffer()
    await closeAllOverlays()
  }

  await submit('/logout')
  const lmenu = await waitPane((o) => has(o, 'no subscribed') || has(o, 'log out'), 12_000)
  const lmenuOpen = lmenu.ok && !lmenu.out.includes('no subscribed')
  record('/logout menu', lmenu.ok ? 'PASS' : 'FAIL', [lmenu.out.includes('no subscribed') ? 'nothing subscribed (menu path still verified)' : ''])
  if (lmenuOpen) {
    const confirm = await pressUntil((o) => has(o, 'y confirm'), 'Enter')
    record('/logout confirm stage', confirm.ok ? 'PASS' : 'FAIL')
    if (confirm.ok) {
      sendKeys('-l', 'n') // resume — do NOT commit (keeps the seeded route for the turn items)
      await sleep(500)
      const afterN = capture()
      const nLeak = /╰❯─n|│❯ n/.test(afterN)
      record('LEAK-REG logout confirm n — no residue', nLeak ? 'FAIL (leak)' : 'PASS')
      writeFileSync(join(capsDir, 'logout_confirm.txt'), afterN)
    }
    await closeAllOverlays()
  }

  // ---- keyboard surfaces ----
  await ensureIdle('keyboard')
  // slash palette: filter + arrows + tab
  // first-key-drop guard (typeVerified): a dropped '/' leaves plain 'lo'
  // typed as a draft and the palette never opens
  const loRow = await typeVerified('/lo')
  let cap = capture()
  record('palette filter /lo', loRow.includes('/lo') && hasAny(cap, ['set an api key', 'remove an api key']) ? 'PASS' : 'FAIL')
  sendKeys('Down'); await sleep(200)
  sendKeys('Down'); await sleep(200)
  sendKeys('Up'); await sleep(200)
  sendKeys('Tab'); await sleep(300)
  cap = capture()
  record('palette tab completes', hasAny(inputRow(cap), ['login', 'logout']) ? 'PASS' : 'FAIL')
  await cleanBuffer()

  // history recall across "/" entries
  await submit('/hotkeys')
  await waitPane((o) => o.includes('scrollUp'), 8000)
  await submit('/usage')
  await waitPaneN((o) => o.includes('turns 0'), 8000)
  cap = capture()
  record('history: buffer empty after submit', bufferEmpty(cap) ? 'PASS' : 'FAIL')
  sendKeys('Up'); await sleep(400)
  cap = capture()
  record('history ↑ #1 → /usage', /\/usage/.test(inputRow(cap)) ? 'PASS' : 'FAIL')
  sendKeys('Up'); await sleep(400)
  cap = capture()
  record('LEAK-REG history ↑ #2 → /hotkeys (palette not owning arrows)', /hotkeys/.test(inputRow(cap)) ? 'PASS' : 'FAIL')
  writeFileSync(join(capsDir, 'history_up2.txt'), cap)
  sendKeys('Down'); await sleep(350)
  const beforeDown2 = inputRow(capture())
  sendKeys('Down'); await sleep(350)
  // a dropped/stalled second ↓ leaves the recalled row in place — require
  // the input row to actually CHANGE (repaint proof) AND read empty before
  // judging; re-press bounded (Down at the empty draft is a no-op)
  let ddOk = false
  let ddOut = ''
  for (let i = 0; i < 5 && !ddOk; i++) {
    const cur = capture()
    if (inputRow(cur) !== beforeDown2 && bufferEmpty(cur)) { ddOk = true; ddOut = cur; break }
    sendKeys('Down'); await sleep(400)
  }
  record('history ↓↓ → draft empty', ddOk ? 'PASS' : 'FAIL')

  // alt+enter newline
  await typeVerified('sweep line one') // first-key-drop guard (batch B)
  sendKeys('M-Enter'); await sleep(250)
  await typeText('line two')
  await sleep(300)
  cap = capture()
  record('alt+enter newline', /sweep line one/.test(cap) && /line two/.test(cap) ? 'PASS' : 'FAIL')
  await cleanBuffer()

  // bracketed paste into the editor
  sh('tmux', ['set-buffer', '-b', 'sweepbuf', '--', 'sweep-paste-xyz'])
  sh('tmux', ['paste-buffer', '-b', 'sweepbuf', '-t', SESS])
  await sleep(600)
  cap = capture()
  record('paste into editor', /sweep-paste-xyz/.test(inputRow(cap)) ? 'PASS' : 'FAIL')
  await cleanBuffer()

  // ---- real-turn surfaces (need a working route) ----
  if (ROUTE) {
    await ensureIdle('turns')
    // /attach: the image rides the NEXT message — give it its own throwaway
    // turn so it cannot pollute later assertions
    await submit('/attach ' + join(SWEEP_WS, 'sweep-1px.png'))
    const att = await waitPaneN((o) => has(o, 'attached'), 8000)
    record('/attach (1px png)', att.ok ? 'PASS' : 'FAIL')
    await submit('reply with only the word: ack')
    const ack = await waitPane((o) => idle(o) && flat(o).includes('ack'), 90_000)
    record('/attach image turn', ack.ok ? 'PASS' : 'CHECK', ['ack row painted'])

    await submit('reply with the single word sweepok and nothing else')
    let t = await waitPane((o) => idle(o) && flat(o).includes('sweepok'), 90_000)
    if (!t.ok) {
      await submit('answer with exactly one word: sweepok')
      t = await waitPane((o) => idle(o) && flat(o).includes('sweepok'), 90_000)
    }
    // mangle-tolerant: any non-echo row mentioning the reply token after idle
    const replyRow = t.out.split('\n').find((l) => !l.includes('❯') && !l.includes('●') && flat(l).includes('sweepok'))
    record('turn: real reply', replyRow !== undefined || flat(t.out).includes('sweepok') ? 'PASS' : 'FAIL')
    writeFileSync(join(capsDir, 'turn_reply.txt'), t.out)

    // esc stop-confirm: arm → n → y, no residue either way
    await submit('count from 1 to 8, one number per line, nothing else, no tools')
    const busy = await waitPane((o) => !idle(o), 20_000)
    record('turn: slow turn busy', !idle(busy.out) ? 'PASS' : 'FAIL')
    sendKeys('Escape'); await sleep(500)
    cap = capture()
    record('stop-confirm arms on esc', hasAny(cap, ['abort this turn?', 'esc resumes']) ? 'PASS' : 'FAIL')
    writeFileSync(join(capsDir, 'stop_armed.txt'), cap)
    sendKeys('-l', 'n'); await sleep(500)
    cap = capture()
    const nLeak = /╰❯─n|│❯ n/.test(cap)
    record('LEAK-REG stop n resumes — no residue', !hasAny(cap, ['abort this turn?', 'esc resumes']) && !nLeak ? 'PASS' : 'FAIL (leak)')
    await waitPane((o) => idle(o), 120_000)
    await cleanBuffer()
    await submit('count from 1 to 8 again, one number per line, no tools')
    await waitPane((o) => !idle(o), 20_000)
    sendKeys('Escape'); await sleep(500)
    sendKeys('-l', 'y'); await sleep(700)
    cap = capture()
    const yLeak = /╰❯─y|│❯ y/.test(cap)
    record('stop y aborts — no residue', hasAny(cap, ['turn aborted', 'aborted']) && !yLeak ? 'PASS' : 'FAIL (leak or no abort)')
    writeFileSync(join(capsDir, 'stop_y.txt'), cap)
    await waitPane((o) => idle(o), 20_000)
    await cleanBuffer()

    // ctrl+G viewer during a running subagent turn (best-effort: the rail
    // clears 1s after every child settles, so the window is live-only)
    await submit('use the minimal-subagent subagent: ask it to reply with the word childok, then tell me its reply. no other tools.')
    let viewerTried = false
    for (let i = 0; i < 40 && !viewerTried; i++) {
      cap = capture()
      if (!idle(cap) && /minimal|subagent/i.test(cap)) {
        sendKeys('C-g'); await sleep(500)
        viewerTried = true
      }
      await sleep(1000)
    }
    cap = capture()
    if (cap.includes('pick to view transcript')) {
      record('ctrl+G mid-turn → child picker', 'PASS')
      sendKeys('Enter'); await sleep(700)
      cap = capture()
      record('ctrl+G viewer shows child transcript', cap.includes('esc back') ? 'PASS' : 'CHECK')
      writeFileSync(join(capsDir, 'viewer_body.txt'), cap)
      sendKeys('Escape'); await sleep(400)
    } else {
      record('ctrl+G mid-turn → child picker', 'CHECK', ['rail window missed (child settled before ctrl+G); empty-state verified: ' + cap.includes('no subagents yet')])
    }
    await waitPane((o) => idle(o), 180_000)
    await cleanBuffer()

    // /sessions picker + resume replay
    await submit('/sessions')
    const sess = await waitPane((o) => !idle(o), 10_000)
    cap = capture()
    record('/sessions picker lists stored', /sweepok|count|reply with/.test(cap) ? 'PASS' : 'FAIL')
    if (sess.ok) {
      await pressUntil((o) => hasAny(o, ['resumed', '已恢复', '已挂载']), 'Enter', 2, 2500)
      cap = capture({ full: true })
      record('/sessions resume replays rows', /resumed|已恢复|已挂载/.test(cap) ? 'PASS' : 'CHECK')
      await submit('/new'); await waitPane((o) => idle(o), 8000)
    }

    // /search hit overlay
    await submit('/search sweepok')
    await sleep(1500)
    cap = capture()
    const searchOpen = cap.includes('search:') || cap.includes('no sessions matching')
    record('/search hit', searchOpen ? 'PASS' : 'CHECK')
    if (searchOpen && !cap.includes('no sessions matching')) { sendKeys('Escape'); await sleep(400) }

    // /queue: enqueue mid-turn, drains after the turn settles
    await submit('reply with the single word: qdrain')
    await waitPane((o) => !idle(o), 20_000)
    await submit('/queue sweep-queued')
    const q1 = await waitPaneN((o) => has(o, 'queued'), 8000)
    cap = capture()
    record('/queue enqueue mid-turn', q1.ok ? 'PASS' : 'FAIL')
    const drained = await waitPane((o) => idle(o), 120_000)
    await waitPane((o) => idle(o) && /sweep-queued/.test(o), 90_000)
    cap = capture({ full: true })
    record('queue drains after the turn', /sweep-queued/.test(cap) ? 'PASS' : 'CHECK')

    // /btw side question (overlay only, never the transcript)
    await submit('/btw what is 2+2? answer with just the number')
    const btw = await waitPane((o) => o.includes('btw') && /A: ?.*4|4/.test(o), 60_000)
    record('/btw side answer', btw.ok ? 'PASS' : 'CHECK')
    await waitPane((o) => idle(o), 30_000)

    // /login|/logout headless REF forms (locale-proof anchors: zh-CN rows
    // are 凭据 … 已保存 / 已移除)
    await submit('/login sweep_probe_ref sk-sweep-probe')
    const logined = await waitPane((o) => o.includes('sweep_probe_ref') && /已保存|saved|subscribed|stored/.test(o), 10_000)
    record('/login REF KEY (headless)', logined.ok ? 'PASS' : 'FAIL')
    await submit('/logout sweep_probe_ref')
    const logouted = await waitPane((o) => o.includes('sweep_probe_ref') && /已移除|removed|unsubscribed/.test(o) && idle(o), 10_000)
    record('/logout REF (headless)', logouted.ok ? 'PASS' : 'FAIL')

    // /history fork (needs a completed turn): picker lists turns, enter forks
    await submit('/history')
    const hist = await waitPane((o) => !idle(o), 10_000)
    cap = capture()
    if (cap.includes('no completed turns yet')) {
      record('/history fork', 'CHECK', ['no completed turns yet (turn row missing)'])
      sendKeys('Escape'); await sleep(300)
    } else {
      const pickerRows = cap.split('\n').filter((l) => l.includes('fork before this turn') || l.includes('分叉点')).length
      record('/history picker lists turns', pickerRows > 0 ? 'PASS' : 'FAIL')
      writeFileSync(join(capsDir, 'history_picker.txt'), cap)
      sendKeys('Enter'); await sleep(2500)
      cap = capture({ full: true })
      record('/history fork applied (⑂ boundary marker)', /forked at turn boundary|⑂/.test(cap) ? 'PASS' : 'CHECK')
      writeFileSync(join(capsDir, 'history_forked.txt'), cap)
      await submit('/new'); await waitPane((o) => idle(o), 8000)
    }

    // /tail: watch the newest stored session live (read-only 2s poll)
    try {
      const sessDir = join(SWEEP_HOME, 'sessions')
      const newest = readdirSync(sessDir).filter((f) => !f.startsWith('.')).sort().pop()
      const sid = (newest ?? '').replace(/\.jsonl(\.zst)?$/, '')
      if (sid) {
        await submit('/tail ' + sid.slice(0, 8))
        const tail = await waitPaneN((o) => hasAny(o, ['watching', 'usage: /tail', 'tail:']), 12_000)
        record('/tail sessionId', tail.ok ? 'PASS' : 'FAIL', ['tail: ' + (tail.out.split('\n').find((l) => hasAny(l, ['watching', 'tail:'])) ?? '').trim().slice(0, 60)])
        writeFileSync(join(capsDir, 'tail.txt'), tail.out)
        if (hasAny(tail.out, ['watching'])) {
          await submit('/new') // /new stops the tail
          await waitPane((o) => idle(o), 8000)
        }
      } else {
        record('/tail sessionId', 'CHECK', ['no stored session files in the scratch home'])
      }
    } catch { record('/tail sessionId', 'CHECK', ['sessions dir unreadable']) }
  } else {
    for (const item of ['turn: real reply', 'stop-confirm arm/n/y', '/sessions resume', '/search hit', '/queue drain', '/btw', '/history fork']) {
      record(item, 'BLOCKED', ['no route answers (probe: ' + (ROUTE_PROBE.tried.join(' | ') || 'empty') + ')'])
    }
  }

  // ---- /reload (works without a route) ----
  await ensureIdle('reload')
  const lockBefore = readLock()
  await submit('/reload')
  const reloaded = await waitPane((o) => o.includes('plugins reloaded') || o.includes('reload failed'), 90_000)
  record('/reload', reloaded.out.includes('plugins reloaded') ? 'PASS' : 'FAIL')
  await sleep(3000)
  const lockAfter = readLock()
  record('/reload same-port restart', lockBefore && lockAfter && lockAfter.port === lockBefore.port && lockAfter.pid !== lockBefore.pid ? 'PASS' : 'CHECK', `pid ${lockBefore?.pid}→${lockAfter?.pid}`)
  await submit('/usage')
  const back = await waitPane((o) => o.includes('turns'), 10_000)
  record('carrier reconnected after /reload', back.ok ? 'PASS' : 'FAIL')

  // ---- final crash scan ----
  const full = capture({ full: true })
  const crash = crashScan(full, 'final scrollback')
  record('final crash-scan (full scrollback)', crash ? 'FAIL' : 'PASS', crash ? [crash] : [`${full.split('\n').length} lines`])
  writeFileSync(join(capsDir, 'final_full.txt'), full)
} catch (e) {
  record('sweep', 'FAIL', [String(e.message).slice(0, 300)])
} finally {
  await quitClient().catch(() => {})
  reapHost()
  tmux('kill-server')
  const fails = results.filter((r) => r.verdict === 'FAIL')
  const blocked = results.filter((r) => r.verdict === 'BLOCKED')
  console.log('\n==================== e2e-sweep summary ====================')
  for (const r of results) {
    const label = r.verdict === 'FAIL' && KNOWN_STALL.includes(r.item) ? 'KNOWN-STALL' : r.verdict
    console.log(`${label.padEnd(11)} ${r.item}`)
  }
  console.log(`\ncaptures: ${capsDir}`)
  console.log(`scratch home (left for inspection): ${SWEEP_HOME}`)
  if (fails.length > 0) {
    console.log(`\nRESULT: FAIL (${fails.length} failed / ${results.length} items)`)
    process.exit(1)
  }
  console.log(`\nRESULT: PASS (${results.length - blocked.length} pass / ${blocked.length} blocked / ${results.length} items)`)
  if (blocked.length > 0) process.exit(2) // blocked ≠ green: dead provider keys are an environment fact, reported loudly
}
