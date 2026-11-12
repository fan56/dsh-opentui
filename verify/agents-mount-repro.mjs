#!/usr/bin/env node
// Real-client gate for the /agents mount + slash-palette height.
//
//   node verify/agents-mount-repro.mjs [--cols 120] [--rows 34] [--keep]
//
// What it proves (against the REAL launcher `./dsh-opentui`, a scratch
// DSH_HOME seeded from the real home — same isolation pattern as
// packages/shell/scripts/e2e-sweep.mjs, nothing is written to ~/.dsh):
//   1. `/agents` opens the manager panel (table layer, or the limits layer
//      when the corpus is empty) instead of the fallback notice
//      "/agents: the manager panel is not mounted in this entry";
//   2. the panel responds to keys: Enter drills into the fields layer,
//      Esc returns, `l` opens the limits layer, Esc closes the panel;
//   2b. `/settings` opens the v1 three-zone panel (本地偏好 / 宿主设置 /
//      其它命名空间), a local preference edit (motion) really rewrites the
//      scratch profile config.json (full, then back to auto), and Esc clears
//      the filter before closing the panel;
//   3. `/thi` + Tab completes to `/think ` (composer-side Tab), and a
//      user-invocable skill (a scratch-home FIXTURE, not the user's corpus)
//      renders as an italic `/name` row that Tab completes with its trailing
//      space;
//   4. the slash palette at both geometries renders >6 rows inside the
//      composer box (not an overflow-hint fallback), and at 80x24 PgDn x2
//      scrolls the window ("… N more above") and End reaches the last rows
//      (the skill line).
//
// Exit 0 = every check passed; exit 1 = at least one failed (the pane
// captures are printed/kept for inspection); exit 2 = environment problem.
//
// Isolation: tmux sessions are uniquely named and killed individually —
// this script never runs `tmux kill-server`, so the user's own sessions
// survive. The scratch host is reaped through its scratch lock file.

import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LAUNCHER = join(REPO, 'dsh-opentui')
const MOCK = join(REPO, 'e2e', 'lib', 'mock-llm.mjs')
const PROFILE = 'opentui'
const REAL_HOME = process.env.DSH_HOME_REAL || join(homedir(), '.dsh')
// The composer placeholder in this view stack (the old kit IDLE string is the
// host's; the tui-base composer paints this one). Both are accepted so the
// driver keeps working if the skin swaps the copy.
const IDLE = '提问，回车发送'
const PLACEHOLDER = 'Type a message'
const PANEL_OPEN = ['● Agents', '⚙ Limits']
const FALLBACK = 'not mounted in this entry'
const SESS = `agents-mount-${process.pid}`
const SESS80 = `${SESS}-80x24`
const SESSGIT = `${SESS}-git`

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const COLS = Number(arg('cols', '120'))
const ROWS = Number(arg('rows', '34'))
const KEEP = process.argv.includes('--keep')
const TYPE_GAP_MS = 60
const OUT = join(REPO, 'verify', 'agents-mount-out')
// Offline mock LLM (same infra as ui-matrix.mjs, on its own port band so the
// two gates can never collide): the auto-resume seed turn below submits a
// REAL turn, so the route must stay on the machine.
const PORT = 18900 + (process.pid % 300)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })
const tmux = (...a) => sh('tmux', a)
const tmuxOut = (...a) => (tmux(...a).status === 0 ? tmux(...a).stdout : '')
const flat = (s) => String(s).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '')
const has = (out, marker) => flat(out).includes(flat(marker))
const hasAny = (out, markers) => markers.some((m) => has(out, m))
/** Raw (no letter-only flattening) marker match: the panel's close summary
 * "Agents unchanged." flattens to "Agentsunchanged", which would keep a
 * flat-matched '● Agents' predicate true forever. */
const rawHasAny = (out, markers) => markers.some((m) => out.includes(m))

for (const cmd of ['tmux', 'bun'])
  if (sh('which', [cmd]).status !== 0) { console.error(`agents-mount: ${cmd} not on PATH`); process.exit(2) }
if (!existsSync(join(REAL_HOME, 'profiles', PROFILE))) {
  console.error(`agents-mount: profile '${PROFILE}' missing under ${REAL_HOME}`)
  process.exit(2)
}
if (!existsSync(LAUNCHER) || !existsSync(MOCK)) {
  console.error(`agents-mount: launcher or mock missing (${LAUNCHER}, ${MOCK})`)
  process.exit(2)
}
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

// --- scratch home (same isolation as e2e-sweep: real writes never land in ~/.dsh) ---
const HOME = mkdtempSync(join(tmpdir(), 'dsh-agents-mount-home-'))
chmodSync(HOME, 0o700)
const WS = mkdtempSync(join(tmpdir(), 'dsh-agents-mount-ws-'))
mkdirSync(join(HOME, 'profiles'), { recursive: true })
cpSync(join(REAL_HOME, 'profiles', PROFILE), join(HOME, 'profiles', PROFILE), { recursive: true })
for (const rel of ['.credentials.yaml', 'models-store.json', 'model-profiles.json', 'workspace-presets.json', 'settings.yaml', 'agents', 'themes']) {
  const from = join(REAL_HOME, rel)
  if (existsSync(from)) cpSync(from, join(HOME, rel), { recursive: true })
}
// Deterministic, offline model route (same pattern as ui-matrix.mjs): the
// scratch patch's zai-coding-cn provider points at the local mock and the
// default route is re-pinned to it. The operator's real profile may carry its
// own agent-default-model row pointing at a REAL provider/model, and the host
// catalog default is not stable across environments — either state would send
// the seed turn below to the network. So this key is never trusted from the
// copy: EVERY agent-default-model entry is stripped first, then exactly one
// pinned entry is appended. Immune to the operator's profile state by
// construction.
const profilePatchPath = join(HOME, 'profiles', PROFILE, 'cordis.patch.yml')
{
  let patch = readFileSync(profilePatchPath, 'utf8')
  const withUrl = patch.replace(/(\n {6}zai-coding-cn:\n)/, `$1        baseURL: http://127.0.0.1:${PORT}/v1\n`)
  if (withUrl === patch) {
    console.error('agents-mount: could not patch provider baseURL into the scratch profile')
    process.exit(2)
  }
  const kept = []
  let skipping = false
  let blockIndent = 0
  for (const line of withUrl.split('\n')) {
    if (skipping) {
      // Inside a stripped entry: continuation keys are deeper-indented
      // (`name:` / `config:` / `provider:` …) and blanks go with them; a
      // sibling `- id:` or any less-indented line ends the entry.
      const indent = /^([ \t]*)/.exec(line)[1].length
      if (line.trim() === '' || indent > blockIndent) continue
      skipping = false
    }
    const m = /^([ \t]*)- id: agent-default-model\s*$/.exec(line)
    if (m) { skipping = true; blockIndent = m[1].length; continue }
    kept.push(line)
  }
  patch = kept.join('\n').replace(/\n*$/, '\n') + [
    '# agents-mount: pin the default route to the mocked provider (any',
    '# agent-default-model row copied from the real profile was removed above).',
    '- id: agent-default-model',
    '  name: "@deepseek-ai/dsh-agent-default-model"',
    '  config:',
    '    provider: zai-coding-cn',
    '    model: glm-5.3-flash',
    '',
  ].join('\n')
  writeFileSync(profilePatchPath, patch)
}
// Isolate the CLIENT-side skill scan too: `resolveAgentsHome` (skills-source.ts)
// resolves explicit config > non-empty DSH_AGENTS_HOME > ~/.agents, the SAME
// precedence the host's dsh-skill-filesystem provider uses, so pinning the env
// makes the palette read ONLY this scratch root. Seed the fixture skill here
// so the assertions below never depend on the user's real corpus.
const AGENTS_HOME = join(HOME, 'agents-home')
const FIXTURE_SKILL = 'zzzz-verify-fixture'
const fixtureDir = join(AGENTS_HOME, 'skills', FIXTURE_SKILL)
mkdirSync(fixtureDir, { recursive: true })
writeFileSync(join(fixtureDir, 'SKILL.md'),
  `---\nname: ${FIXTURE_SKILL}\ndescription: verify gate fixture skill (italic row + Tab completion)\n---\n\n# ${FIXTURE_SKILL}\n`)

/**
 * The user-invocable skill names the palette should discover in this scratch
 * home (skills-source.ts: bundle <name>/SKILL.md or flat <name>.md; a
 * `user-invocable: false` row is hidden). Read before boot so the assertion
 * targets a real fixture name instead of hardcoding one user's home.
 */
const listLocalSkills = () => {
  const names = []
  for (const root of [join(HOME, 'skills'), join(AGENTS_HOME, 'skills')]) {
    let entries = []
    try { entries = readdirSync(root, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      let file
      if (entry.isDirectory()) file = join(root, entry.name, 'SKILL.md')
      else if (entry.isFile() && entry.name.endsWith('.md')) file = join(root, entry.name)
      if (!file) continue
      let text = ''
      try { text = readFileSync(file, 'utf8') } catch { continue }
      const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
      if (!block) continue
      const field = (name) => {
        const m = new RegExp(`^${name}\\s*:\\s*(.*)$`, 'm').exec(block[1])
        return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined
      }
      const name = field('name')
      if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) continue
      if (field('description') === undefined) continue
      const user = field('user-invocable')
      if (user !== undefined && /^(false|no|off|0)$/i.test(user)) continue
      names.push(name)
    }
  }
  return [...new Set(names)]
}
const LOCAL_SKILLS = listLocalSkills()
if (!LOCAL_SKILLS.includes(FIXTURE_SKILL)) {
  console.error(`agents-mount: fixture skill '${FIXTURE_SKILL}' not discovered under ${AGENTS_HOME}`)
  process.exit(2)
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

let mockProc = null
const startMock = async () => {
  const fd = openSync(join(OUT, 'mock-llm.log'), 'w')
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
/** SGR mouse bytes straight into the pane's pty (the app enables SGR mouse
 * reporting with useMouse). x/y are 1-based terminal cells. */
const sendMouse = (session, kind, x, y, button = 0) => {
  const seq = `\x1b[<${button};${x};${y}${kind === 'release' ? 'm' : 'M'}`
  const hex = [...Buffer.from(seq, 'utf8')].map((b) => b.toString(16).padStart(2, '0'))
  tmux('send-keys', '-t', session, '-H', ...hex)
}
const clickAt = async (session, x, y) => {
  sendMouse(session, 'press', x, y)
  await sleep(60)
  sendMouse(session, 'release', x, y)
  await sleep(300)
}
const wheelAt = async (session, x, y, up = true) => {
  sendMouse(session, 'press', x, y, up ? 64 : 65)
  await sleep(300)
}
const typeText = async (session, text) => {
  for (const ch of text) { sendKeys(session, '-l', ch); await sleep(TYPE_GAP_MS) }
}
/** Composer interior rows: the tui-base composer draws its palette + editor
 * inside a `┃ … ┃` box, so strip the sides instead of hunting a prompt glyph
 * (the old `❯` row does not exist in this view stack). */
const composerRows = (out) =>
  out.split('\n')
    .filter((l) => l.trimStart().startsWith('┃'))
    .map((l) => l.trim().replace(/^┃/, '').replace(/┃$/, '').trim())
const inputRow = (out) => (composerRows(out).filter((l) => l !== '' && !l.startsWith(PLACEHOLDER)).pop() ?? '').trim()
const composerEmpty = (out) => composerRows(out).every((l) => l === '' || l.startsWith(PLACEHOLDER))
/** The composer info-bar row (steer/dir/branch batch): the first NON-pure-
 * border row above the first `┃` interior row. Framed geometry (>30 rows):
 * the composer's own `┏` top border carries the cwd (· branch) embedded, so
 * the scan lands on that border row directly. Compact geometry (≤30 rows)
 * draws left/right rules only and the bar is intentionally absent — the row
 * above the first `┃` is transcript content (the reverse assertions check
 * it). */
const composerContextRow = (out) => {
  const lines = out.split('\n')
  const first = lines.findIndex((l) => l.trimStart().startsWith('┃'))
  if (first < 1) return ''
  let i = first - 1
  while (i >= 0 && /^[┏━┳┓]+$/.test(lines[i].trim())) i--
  return (lines[i] ?? '').trim()
}
/** True when the row carries an SGR run whose parameters include the italic
 * attribute (exactly `3`). Extended colors are skipped (38/48 + 5;n | 2;r;g;b),
 * so `33`/`43`/`93` and a `3` inside a 256-color index do not count. */
const hasItalicSgr = (ansiRow) => {
  for (const m of ansiRow.matchAll(/\x1b\[([0-9;]*)m/g)) {
    const params = (m[1] === '' ? '0' : m[1]).split(';').map(Number)
    for (let i = 0; i < params.length; i++) {
      const p = params[i]
      if (p === 38 || p === 48) {
        i += params[i + 1] === 5 ? 2 : 4
        continue
      }
      if (p === 3) return true
    }
  }
  return false
}
/** The LAST composer row's SGR text runs as raw strings (each run keeps its
 * trailing blanks). A trim()ed capture cannot tell a Tab-appended trailing
 * space from the box padding; this can. */
const editorRuns = (ansiOut) => {
  const rows = ansiOut.split('\n').filter((l) => l.trimStart().startsWith('┃'))
  if (rows.length === 0) return []
  return rows.at(-1).replace(/\x1b\[[0-9;]*m/g, '\u0000').split('\u0000').map((run) => run.trimStart())
}
const submit = async (session, text) => {
  await typeText(session, text)
  await sleep(300)
  if (!inputRow(capture(session)).includes(text)) {
    for (let i = 0; i < text.length + 6; i++) { sendKeys(session, 'BSpace'); await sleep(TYPE_GAP_MS) }
    await sleep(200)
    await typeText(session, text)
    await sleep(300)
  }
  sendKeys(session, 'Enter')
}
const waitPane = async (session, pred, timeoutMs, everyMs = 400) => {
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
  // file keeps the ANSI stream; callers get the plain text they parse
  writeFileSync(join(OUT, `${name}.ans`), capture(session, true))
  console.log(`  snapshot: verify/agents-mount-out/${name}.ans`)
  return capture(session)
}
const idle = (out) => out.includes(IDLE) || composerEmpty(out)
const launch = (session, cols, rows, cwd = WS) => {
  tmux('kill-session', '-t', session)
  const env = [
    `DSH_HOME=${HOME}`,
    `DSH_AGENTS_HOME=${AGENTS_HOME}`,
    'DSH_OPENTUI_DEBUG=1',
    // Same defensive pair as ui-matrix: a dummy key satisfies the provider's
    // apiKeyEnv requirement, and an empty BASE_URL neutralizes any operator
    // env override so only the scratch patch's baseURL can win.
    'ZAI_CODING_CN_API_KEY=mock-only-key',
    'ZAI_CODING_CN_BASE_URL=',
  ]
  const r = tmux('new-session', '-d', '-x', String(cols), '-y', String(rows), '-s', session, '-c', cwd,
    `${env.join(' ')} ${LAUNCHER} --client 2>${join(OUT, `${session}.err.log`)}`)
  if (r.status !== 0) throw new Error('tmux boot failed: ' + r.stderr)
}
const killSession = (session) => tmux('kill-session', '-t', session)

let crashed = null
try {
  await startMock()
  console.log(`agents-mount: mock LLM on 127.0.0.1:${PORT}; scratch home ${HOME}`)
  // ---------------- 1. panel mount + keys (default geometry) ----------------
  launch(SESS, COLS, ROWS)
  const boot = await waitPane(SESS, (o) => o.includes('🧠') || idle(o), 90_000, 500)
  if (!boot.out.includes('🧠') && !idle(boot.out)) {
    console.error('client never rendered:\n' + boot.out.slice(-1500))
    process.exit(2)
  }
  await waitPane(SESS, idle, 30_000)
  snap('01-welcome')

  // Composer info bar (steer/dir/branch batch): the cwd rides INSIDE the
  // composer's own top border (framed geometry at the default 120x34),
  // directly after the corner inset — space-led text, NO dash run of our
  // own (the user's real-device "细线" rejection). The scratch workspace is
  // not a git repo, so no branch segment (silent degrade), and no
  // independent rule/label row may sit above that border.
  const ctxBoot = composerContextRow(capture(SESS))
  const ctxBootBare = ctxBoot.replace(/^[┏┌][━─]/, '')
  record('composer context: the composer top border embeds the working directory',
    ctxBoot.includes(basename(WS)) && /^ [^━─]/.test(ctxBootBare), [`row: ${JSON.stringify(ctxBoot)}`])
  record('composer context: no branch segment outside a git repository',
    ctxBoot.length > 0 && !/ · /.test(ctxBoot), [`row: ${JSON.stringify(ctxBoot)}`])
  const ctxBootLines = capture(SESS).split('\n')
  const ctxBootIdx = ctxBootLines.findIndex((l) => l === ctxBoot)
  const aboveBoot = ctxBootIdx > 0 ? (ctxBootLines[ctxBootIdx - 1] ?? '').trim() : ''
  record('composer context: no independent rule/label row above the border title',
    !/^[─┏┓┌┐\s]+$/.test(aboveBoot) && !aboveBoot.includes(basename(WS)),
    [`row above: ${JSON.stringify(aboveBoot.slice(0, 60))}`])

  await submit(SESS, '/agents')
  const opened = await waitPane(SESS, (o) => rawHasAny(o, PANEL_OPEN) || has(o, FALLBACK), 20_000)
  const tableUp = opened.out.includes('● Agents')
  const limitsUp = opened.out.includes('⚙ Limits')
  snap('02-agents-open')
  record('/agents opens the manager panel', tableUp || limitsUp,
    [tableUp ? 'table layer' : limitsUp ? 'limits layer (empty corpus)' : `saw: ${has(opened.out, FALLBACK) ? FALLBACK : 'no panel marker'}`])

  if (tableUp) {
    sendKeys(SESS, 'Enter')
    const fields = await waitPane(SESS, (o) => has(o, 'model') && has(o, 'thinking') && has(o, 'deep'), 8_000)
    snap('03-agents-fields')
    record('/agents Enter drills into the fields layer', fields.ok, [fields.ok ? 'model/thinking/deep rows' : 'fields layer not visible'])
    sendKeys(SESS, 'Escape')
    await waitPane(SESS, (o) => has(o, '● Agents') && has(o, 'l limits'), 8_000)
  }

  sendKeys(SESS, 'l')
  const limits = await waitPane(SESS, (o) => o.includes('⚙ Limits'), 10_000)
  snap('04-agents-limits')
  record('/agents l opens the limits layer', limits.ok, [limits.ok ? '⚙ Limits visible' : 'limits layer not visible'])

  sendKeys(SESS, 'Escape')
  const back = await waitPane(SESS, (o) => !o.includes('⚙ Limits'), 8_000)
  record('/agents Esc leaves the limits layer', back.ok, [back.ok ? 'limits layer closed' : 'still visible'])
  // Esc one layer at a time (limits -> table -> closed); a dropped Escape in
  // the key parser must not leave the panel parked, so retry bounded.
  const closedPred = (o) => !rawHasAny(o, [...PANEL_OPEN, 'target:']) && idle(o)
  let closed = { ok: false, out: capture(SESS) }
  for (let attempt = 0; attempt < 4 && !closed.ok; attempt++) {
    sendKeys(SESS, 'Escape')
    closed = await waitPane(SESS, closedPred, 5_000)
  }
  snap('05-agents-closed')
  if (!closed.ok) {
    writeFileSync(join(OUT, '05-close-frame.txt'), closed.out)
    console.log(`  debug close: markers=${rawHasAny(closed.out, [...PANEL_OPEN, 'target:'])} ` +
      `idle=${idle(closed.out)} composerRows=${JSON.stringify(composerRows(closed.out))}`)
  }
  record('/agents Esc closes the panel', closed.ok,
    [closed.ok ? 'back to the composer' : 'panel still on screen'])

  // ---------------- 1b. /settings panel v1 ----------------
  // The three fixed zones, a REAL local-preference write (motion full → auto)
  // observed in the scratch profile config.json, and the Esc hierarchy
  // (clear the filter first, then close).
  const SETTINGS_ZONES = ['本地偏好', '宿主设置', '其它命名空间']
  const profileConfigPath = join(HOME, 'profiles', PROFILE, 'config.json')
  const readProfile = () => {
    try { return JSON.parse(readFileSync(profileConfigPath, 'utf8')) } catch { return {} }
  }
  const waitProfile = async (pred, timeout = 8_000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const config = readProfile()
      if (pred(config)) return config
      await sleep(200)
    }
    return readProfile()
  }
  const zonesVisible = (out) => SETTINGS_ZONES.every((zone) => out.includes(zone))

  await submit(SESS, '/settings')
  const settingsUp = await waitPane(SESS, zonesVisible, 25_000)
  snap('11-settings-open')
  record('/settings opens the three-zone panel', settingsUp.ok,
    [SETTINGS_ZONES.filter((zone) => settingsUp.out.includes(zone)).join(' / ') || 'no zone title'])
  record('/settings marks other namespaces read-only ("本 TUI 不消费")',
    settingsUp.out.includes('本 TUI 不消费'),
    [settingsUp.out.includes('本 TUI 不消费') ? 'read-only note visible' : 'note missing'])

  // Local preference write: filter to the motion row, Enter opens the enum
  // picker, Home-ish (Up x4) + Down lands on `full` deterministically.
  await typeText(SESS, 'motion')
  const motionRow = await waitPane(SESS, (out) => /▸\s+motion/.test(out) && !out.includes('footerHints.motion'), 8_000)
  snap('12-settings-motion-filter')
  record('/settings filter narrows to the motion row', motionRow.ok,
    [motionRow.ok ? '/▸ motion/' : motionRow.out.split('\n').find((l) => l.includes('motion')) ?? 'no motion row'])
  sendKeys(SESS, 'Enter')
  const motionOptions = await waitPane(SESS, (out) => out.includes('pick a value') && out.includes('off'), 8_000)
  snap('13-settings-motion-options')
  record('/settings Enter opens the motion enum', motionOptions.ok,
    [motionOptions.ok ? 'auto/full/reduced/off' : 'options layer not visible'])
  for (let i = 0; i < 4; i++) { sendKeys(SESS, 'Up'); await sleep(120) }
  sendKeys(SESS, 'Down')
  await sleep(150)
  sendKeys(SESS, 'Enter')
  const fullConfig = await waitProfile((config) => config.motion === 'full')
  snap('14-settings-motion-full')
  record('settings writes motion=full into the profile config.json',
    fullConfig.motion === 'full', [`motion: ${JSON.stringify(fullConfig.motion)}`])

  // Back to auto on the same row (the filter is still armed).
  await sleep(500)
  sendKeys(SESS, 'Enter')
  await waitPane(SESS, (out) => out.includes('pick a value'), 8_000)
  for (let i = 0; i < 4; i++) { sendKeys(SESS, 'Up'); await sleep(120) }
  sendKeys(SESS, 'Enter')
  const autoConfig = await waitProfile((config) => config.motion === 'auto')
  snap('15-settings-motion-auto')
  record('settings writes motion back to auto', autoConfig.motion === 'auto',
    [`motion: ${JSON.stringify(autoConfig.motion)}`])

  // The host zone rides a REAL settings/describe (the document lands async):
  // wait for a positive namespace count, then for the whitelist rows.
  const liveDoc = await waitPane(SESS, (out) => /document writable · [1-9]\d* namespace/.test(out), 12_000)
  snap('15b-settings-live-document')
  const namespaceCount = /document writable · (\d+) namespace/.exec(liveDoc.out)?.[1]
  record('/settings reads the live host settings document', liveDoc.ok,
    [`namespace count: ${namespaceCount ?? '0'}`])

  // Esc hierarchy: a non-empty filter clears first; the panel stays up.
  const filterCleared = await waitPane(SESS, (out) => out.includes('filter: "motion"'), 4_000)
  sendKeys(SESS, 'Escape')
  const clearedFrame = await waitPane(SESS, (out) => !out.includes('filter: "motion"') && zonesVisible(out), 6_000)
  snap('16-settings-filter-cleared')
  record('/settings Esc clears the filter before closing the panel',
    filterCleared.ok && clearedFrame.ok,
    [filterCleared.ok ? 'filter was armed' : 'filter line not seen',
      clearedFrame.ok ? 'panel still open, filter cleared' : 'panel closed with the filter'])
  const hostRows = ['subagent.maxActiveSubagen', 'subagent.maxDepth', 'permission.defaultPreset', 'session-log-deepseek.enab']
  const hostRowsVisible = hostRows.every((row) => clearedFrame.out.includes(row))
  record('/settings host zone renders the whitelisted rows from the live document', hostRowsVisible,
    [hostRowsVisible ? 'all four rows visible' : `missing: ${hostRows.filter((row) => !clearedFrame.out.includes(row)).join(', ')}`])
  record('/settings never lists dsh-tui (not part of the opentui profile)',
    !clearedFrame.out.includes('dsh-tui'),
    [!clearedFrame.out.includes('dsh-tui') ? 'absent' : 'dsh-tui leaked into the read-only list'])

  // Host write on a REAL host (C2): toggle session-log-deepseek.enabled
  // true → false → true. The proof has two halves — the profile patch file the
  // host applies (cordis.patch.yml) and the value the panel re-renders from a
  // FRESH settings/describe. Scratch home only; the real ~/.dsh is untouched.
  const patchPath = join(HOME, 'profiles', PROFILE, 'cordis.patch.yml')
  const readPatch = () => {
    try { return readFileSync(patchPath, 'utf8') } catch { return '' }
  }
  // The LAST entry for one id (a restored write may append a newer entry).
  const patchEntry = (id) => {
    const text = readPatch()
    const i = text.lastIndexOf(`id: ${id}`)
    if (i < 0) return ''
    const rest = text.slice(i)
    const end = rest.indexOf('\n- ')
    return end < 0 ? rest : rest.slice(0, end)
  }
  const waitPatch = async (pred, timeout = 8_000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (pred(readPatch())) return true
      await sleep(200)
    }
    return pred(readPatch())
  }
  const hostRowLine = (out) => out.split('\n').find((line) => line.includes('session-log-deepseek')) ?? ''
  await typeText(SESS, 'session-log')
  const hostRow = await waitPane(SESS, (out) => /▸\s+session-log-deepseek/.test(out), 8_000)
  sendKeys(SESS, 'Enter') // toggle: on → off
  const wroteOff = await waitPatch((text) => patchEntry('session-log-deepseek').includes('enabled: false'))
  const offFrame = await waitPane(SESS, (out) => /▸.*session-log-deepseek.*\boff\b/.test(out), 8_000)
  snap('18-settings-host-write-off')
  record('settings writes a host row (session-log-deepseek.enabled=false) into cordis.patch.yml',
    hostRow.ok && wroteOff,
    [hostRow.ok ? 'row selected' : 'row not selected',
      wroteOff ? 'patch entry has enabled: false' : `patch entry: ${JSON.stringify(patchEntry('session-log-deepseek').slice(-120))}`])
  record('settings re-reads the host write through settings/describe (row shows off)',
    offFrame.ok,
    [offFrame.ok ? 'row shows off after a fresh describe' : `row: ${JSON.stringify(hostRowLine(offFrame.out))}`])
  sendKeys(SESS, 'Enter') // restore: off → on
  const wroteOn = await waitPatch((text) => patchEntry('session-log-deepseek').includes('enabled: true'))
  const onFrame = await waitPane(SESS, (out) => /▸.*session-log-deepseek.*\bon\b/.test(out), 8_000)
  snap('19-settings-host-restore')
  record('settings restores the host row (session-log-deepseek.enabled=true)',
    wroteOn && onFrame.ok,
    [wroteOn ? 'patch entry back to enabled: true' : `patch entry: ${JSON.stringify(patchEntry('session-log-deepseek').slice(-120))}`,
      onFrame.ok ? 'row shows on again' : `row: ${JSON.stringify(hostRowLine(onFrame.out))}`])
  if (offFrame.ok && !onFrame.ok) sendKeys(SESS, 'Enter')

  // Leave the list layer (Esc clears the filter, the next Esc closes).
  sendKeys(SESS, 'Escape')
  await waitPane(SESS, (out) => zonesVisible(out) && !out.includes('filter: "session-log"'), 6_000)
  sendKeys(SESS, 'Escape')
  const settingsClosed = await waitPane(SESS, (out) => !zonesVisible(out) && idle(out), 8_000)
  snap('17-settings-closed')
  record('/settings Esc closes the panel', settingsClosed.ok,
    [settingsClosed.ok ? 'back to the composer' : 'panel still on screen'])

  // ---------------- 1c. pane focus + transcript scroll (focus batch) ----------------
  // F6 / clicks move focus between the composer and the transcript. The frame
  // form is the observable: focused = heavy border (`┏`/`┃`, accent title),
  // unfocused = single (`┌`/`│`). The border characters are captured plain, no
  // SGR parsing needed.
  const titleRow = (out) => out.split('\n').find((line) => line.includes(' transcript ')) ?? ''
  const heavyFrame = (out) => /┏[━]* transcript /.test(out)
  const lightFrame = (out) => /┌[─]* transcript /.test(out)
  /** The transcript body without the frame + composer (used to compare
   * viewports across scroll keys). */
  const transcriptBody = (out) => {
    const lines = out.split('\n')
    const start = lines.findIndex((line) => line.startsWith('┏') || line.startsWith('┌'))
    const end = lines.findIndex((line) => line.includes(PLACEHOLDER))
    return start >= 0 && end > start ? lines.slice(start + 1, end).join('\n') : out
  }
  const waitFrame = async (pred, timeout = 6_000) => {
    const deadline = Date.now() + timeout
    let last = ''
    while (Date.now() < deadline) {
      last = capture(SESS)
      if (pred(last)) return { ok: true, out: last }
      await sleep(120)
    }
    return { ok: false, out: last }
  }

  const paneBaseline = capture(SESS)
  record('pane-focus: transcript starts unfocused (single frame + title)',
    lightFrame(paneBaseline) && !heavyFrame(paneBaseline),
    [`title row: ${JSON.stringify(titleRow(paneBaseline).trim().slice(0, 48))}`])

  sendKeys(SESS, 'F6')
  const f6Transcript = await waitFrame(heavyFrame)
  snap('20-focus-transcript')
  record('pane-focus: F6 focuses the transcript (heavy frame)', f6Transcript.ok,
    [f6Transcript.ok ? 'heavy transcript frame' : `title row: ${JSON.stringify(titleRow(f6Transcript.out).trim().slice(0, 60))}`])
  record('pane-focus: the hint row switches to the transcript keys',
    f6Transcript.out.includes('↑↓ scroll'),
    [f6Transcript.out.split('\n').find((line) => line.includes('⌨'))?.trim().slice(0, 90) ?? 'no hint row'])

  sendKeys(SESS, 'F6')
  const backToComposer = await waitFrame(lightFrame)
  record('pane-focus: F6 returns to the composer (transcript frame single again)', backToComposer.ok)

  // Click the transcript body (row 8 sits inside the frame; the composer dock
  // is at the bottom) — renderer autoFocus moves focus to the scrollbox.
  await clickAt(SESS, 20, 8)
  const clickedTranscript = await waitFrame(heavyFrame)
  snap('21-focus-transcript-click')
  record('pane-focus: a click in the transcript focuses it (heavy frame)', clickedTranscript.ok)

  // Tab (idle) returns to the composer; so does Esc while no turn runs.
  sendKeys(SESS, 'Tab')
  const tabBack = await waitFrame(lightFrame)
  record('pane-focus: Tab returns from the transcript to the composer', tabBack.ok)
  await clickAt(SESS, 20, 8)
  await waitFrame(heavyFrame)
  sendKeys(SESS, 'Escape')
  const escBack = await waitFrame(lightFrame)
  record('pane-focus: idle Esc returns from the transcript to the composer', escBack.ok)
  await clickAt(SESS, 20, 8)
  await waitFrame(heavyFrame)

  // Click the composer's editor row (the placeholder row locates it without
  // hardcoding the dock geometry at either terminal size).
  const linesAtClick = capture(SESS).split('\n')
  const inputY = linesAtClick.findIndex((line) => line.includes(PLACEHOLDER)) + 1
  if (inputY > 0) await clickAt(SESS, 12, inputY)
  const clickedComposer = await waitFrame(lightFrame)
  record('pane-focus: a click in the composer refocuses it (transcript frame single)', clickedComposer.ok,
    [inputY > 0 ? `clicked editor row ${inputY}` : 'editor row not located'])

  // Long-content scene: /help prints one transcript row per command (each with
  // its own leading margin), comfortably taller than the viewport.
  await submit(SESS, '/help')
  // /help prints one row per command; the LAST command rows land in the
  // bottom viewport (the /help row itself is at the top, offscreen).
  const helpRows = await waitPane(SESS, (out) => out.includes('/preset') || out.includes('/agents'), 15_000)
  record('pane-focus: /help fills the transcript (scroll test scaffold)', helpRows.ok)

  sendKeys(SESS, 'F6')
  await waitFrame(heavyFrame)
  // The frame flipping to heavy also spends two viewport rows (top/bottom);
  // sticky follow re-pins on the NEXT layout pass, so let the position settle
  // before calling this the bottom baseline.
  await sleep(500)
  const atBottom = capture(SESS)
  sendKeys(SESS, 'Up')
  await sleep(400)
  const scrolledUp = capture(SESS)
  snap('22-transcript-scrolled-up')
  record('pane-focus: ↑ scrolls the focused transcript line by line',
    transcriptBody(atBottom) !== transcriptBody(scrolledUp),
    [`body rows changed: ${transcriptBody(atBottom) !== transcriptBody(scrolledUp)}`])

  // End jumps to the bottom and re-engages sticky follow; the next page
  // down at the bottom is a clamp, so compare the body to the pre-scroll one.
  sendKeys(SESS, 'End')
  await sleep(400)
  const transcriptAtEnd = capture(SESS)
  record('pane-focus: End returns to the bottom (sticky follow restored)',
    transcriptBody(transcriptAtEnd) === transcriptBody(atBottom),
    ['body identical to the bottom viewport'])

  // Mouse wheel over the transcript also moves it (useMouse ON, no crash).
  await wheelAt(SESS, 20, 8, true)
  const wheeled = capture(SESS)
  record('pane-focus: the mouse wheel scrolls the transcript (mouse reporting on)',
    wheeled.trim().length > 0 && transcriptBody(wheeled) !== transcriptBody(transcriptAtEnd),
    [wheeled.trim().length > 0 ? 'frame alive after wheel' : 'frame blank after wheel'])
  sendKeys(SESS, 'End')
  await sleep(300)

  // Back to the composer: ↑ must return to prompt-history handling and leave
  // the transcript viewport untouched.
  sendKeys(SESS, 'F6')
  await waitFrame(lightFrame)
  const composerBase = capture(SESS)
  sendKeys(SESS, 'Up')
  await sleep(400)
  const composerUp = capture(SESS)
  record('pane-focus: after F6, ↑ is prompt history again (transcript does not scroll)',
    transcriptBody(composerUp) === transcriptBody(composerBase),
    [`transcript body unchanged: ${transcriptBody(composerUp) === transcriptBody(composerBase)}`])

  // ---------------- 2. /thi + Tab completion ----------------
  await typeText(SESS, '/thi')
  await sleep(400)
  const paletteUp = hasAny(capture(SESS), ['/think', 'reasoning effort'])
  sendKeys(SESS, 'Tab')
  await sleep(600)
  const afterTab = capture(SESS)
  const row = inputRow(afterTab)
  snap('06-thi-tab')
  record('/thi + Tab completes to `/think `', row.includes('/think'), [`input row: ${JSON.stringify(row)}`])
  if (!paletteUp) console.log('  note: /think row was not visible before Tab (palette filter)')
  for (let i = 0; i < 16; i++) { sendKeys(SESS, 'BSpace'); await sleep(TYPE_GAP_MS) }
  await sleep(300)

  // ---------------- 2b. skills in the slash palette ----------------
  // A user-invocable skill from the scratch home must be a `/name` row, its
  // row must carry the italic SGR (whole-row treatment), and Tab must
  // complete it through the same completeSlash path as a command.
  if (LOCAL_SKILLS.length === 0) {
    record('slash palette shows a skill row (italic)', false, ['no user-invocable skill in the scratch home'])
  } else {
    // The scratch home's ONLY skill is the seeded fixture (the real corpus is
    // not copied), so this check cannot drift with the user's ~/.dsh.
    const skill = LOCAL_SKILLS.includes(FIXTURE_SKILL) ? FIXTURE_SKILL : LOCAL_SKILLS[0]
    await typeText(SESS, `/${skill}`)
    await sleep(700)
    const ansi = capture(SESS, true)
    snap('06b-skill-row')
    const plain = capture(SESS)
    const skillRow = plain.split('\n').find((line) => line.includes(`/${skill}`)) ?? ''
    const ansiRow = ansi.split('\n').find((line) => line.includes(`/${skill}`)) ?? ''
    const italic = hasItalicSgr(ansiRow)
    record('slash palette shows a skill row (italic)', skillRow.includes(`/${skill}`) && italic,
      [`skill: /${skill}`, `row: ${JSON.stringify(skillRow.trim())}`, `italic SGR(3): ${italic}`])
    const beforeTab = ansi
    sendKeys(SESS, 'Tab')
    await sleep(600)
    const afterTabAnsi = capture(SESS, true)
    const completed = inputRow(capture(SESS))
    snap('06c-skill-tab')
    // The editor's styled run must be `<name>` + at least one REAL trailing
    // space (the Tab completion's), not the row's blank padding: read the
    // SGR run, do not trim the capture.
    const run = editorRuns(afterTabAnsi).find((r) => r.trimEnd() === `/${skill}`) ?? ''
    const trailingSpace = run.length > `/${skill}`.length && run.endsWith(' ')
    record('skill row completes through Tab (trailing space)', completed === `/${skill}` && trailingSpace,
      [`input row: ${JSON.stringify(completed)}`, `editor run: ${JSON.stringify(run)}`,
        `trailing space: ${trailingSpace}`, `before Tab had it: ${editorRuns(beforeTab).some((r) => r === `/${skill} `)}`])
    for (let i = 0; i < skill.length + 6; i++) { sendKeys(SESS, 'BSpace'); await sleep(TYPE_GAP_MS) }
    await sleep(300)
  }

  // palette height at this geometry: `/` lists the command set
  await typeText(SESS, '/')
  await sleep(800)
  snap('07-palette-default')
  const brush = capture(SESS)
  const more = /…\s*(\d+)\s*more/.exec(brush)
  // Count the rows INSIDE the composer box (composerRows strips the `┃ … ┃`
  // border). The old raw-line regex saw `┃   /agents …` and counted 0, so the
  // `|| more !== null` fallback made this gate green on nothing.
  const slashRows = composerRows(brush).filter((l) => /^\/[a-z]/.test(l)).length
  record('slash palette renders more than 6 rows (default geometry)', slashRows > 6,
    [`${slashRows} slash rows visible${more ? `, hint "… ${more[1]} more"` : ''}`])
  for (let i = 0; i < 8; i++) { sendKeys(SESS, 'BSpace'); await sleep(TYPE_GAP_MS) }
  await sleep(300)

  // crash scan on the full scrollback
  const full = tmuxOut('capture-pane', '-p', '-S', '-3000', '-t', SESS)
  const m = full.match(/TypeError|Cannot access private|Unhandled|boot failed/i)
  crashed = m ? m[0] : null
  record('no crash markers in the client scrollback', crashed === null, crashed ? [crashed] : [])

  await submit(SESS, '/quit')
  const quit = await waitPane(SESS, () => tmux('has-session', '-t', SESS).status !== 0, 15_000)
  if (!quit.ok) killSession(SESS)

  // ---------------- 3. slash palette at 80x24 ----------------
  launch(SESS80, 80, 24)
  const boot80 = await waitPane(SESS80, (o) => o.includes('🧠') || idle(o), 90_000, 500)
  if (!boot80.out.includes('🧠') && !idle(boot80.out)) {
    console.error('client never rendered at 80x24:\n' + boot80.out.slice(-1500))
    process.exit(2)
  }
  await waitPane(SESS80, idle, 30_000)
  // 80x24 is compact (≤30 rows): the composer draws left/right rules only —
  // no top border, so the info bar is intentionally absent (user feedback:
  // zero extra rows anywhere). Nothing directly above the box may carry the
  // workspace or a dash-led rule.
  const ctx80 = composerContextRow(capture(SESS80))
  record('80x24: no context bar above the composer (compact has no top border)',
    !ctx80.includes(basename(WS)) && !/^[─┏┓┌┐\s]+$/.test(ctx80),
    [`row above composer: ${JSON.stringify(ctx80.slice(0, 60))}`])
  // Compact (≤30 rows) transcript frame: left/right rules only — no `┏` top
  // row — but focused still paints the heavy `┃` rule.
  sendKeys(SESS80, 'F6')
  await sleep(500)
  const compactFrame = capture(SESS80)
  snap('08a-focus-transcript-80x24', SESS80)
  record('80x24: focused transcript frame adds no top row (left/right only)',
    !compactFrame.includes('┏') && compactFrame.split('\n').some((line) => line.startsWith('┃')),
    [compactFrame.split('\n').filter((line) => line.startsWith('┃') || line.startsWith('│')).length + ' vertical-rule rows'])
  sendKeys(SESS80, 'F6')
  await sleep(400)
  await typeText(SESS80, '/')
  await sleep(800)
  const out80 = snap('08-palette-80x24', SESS80)
  const lines = out80.split('\n')
  const boxStart = lines.findIndex((l) => l.trimStart().startsWith('┃'))
  const boxEnd = lines.map((l) => l.trimStart().startsWith('┃')).lastIndexOf(true)
  const powerIdx = lines.map((l) => /🧠/.test(l)).lastIndexOf(true)
  const rows80 = composerRows(out80).map((l) => l.trimStart())
  const editorRow = rows80.at(-1) ?? ''
  const menuRows = rows80.filter((l) => /^\/[a-z]/.test(l)).length
  const more80 = /…\s*(\d+)\s*more/.exec(out80)
  // The composer box must be on screen, END above the powerline, and its last
  // interior row must be the editor (placeholder or the typed "/") — the menu
  // grows upward, it must never eat the input row.
  record('80x24: slash menu does not push the input off-screen',
    boxStart >= 0 && boxEnd > boxStart && boxEnd < powerIdx && (editorRow.startsWith(PLACEHOLDER) || editorRow.startsWith('/')),
    [`composer box rows ${boxStart + 1}-${boxEnd + 1}`, `powerline row ${powerIdx + 1}/${lines.length}`,
      `editor row: ${JSON.stringify(editorRow)}`])
  record('80x24: menu lists more than 6 rows', menuRows > 6,
    [`${menuRows} slash rows visible${more80 ? `, hint "… ${more80[1]} more"` : ''}`])
  // Scrolling on the real client: PgDn walks the window, the top edge reports
  // the rows scrolled off, and End lands on the LAST match — a skill row
  // (skills sort after every executable command), i.e. the fixture seeded
  // above. No `|| hint` escape hatch: the rows themselves must move.
  const menuNames = (out) => composerRows(out).filter((l) => /^\/[a-z]/.test(l))
  const initialNames = menuNames(out80)
  sendKeys(SESS80, 'NPage')
  await sleep(400)
  sendKeys(SESS80, 'NPage')
  await sleep(700)
  const scrolled = snap('09-palette-80x24-pgdn', SESS80)
  const scrolledNames = menuNames(scrolled)
  const above = /…\s*(\d+)\s*more above/.exec(composerRows(scrolled).join('\n'))
  record('80x24: PgDn scrolls the window and reports the rows above',
    initialNames.join('|') !== scrolledNames.join('|') && above !== null,
    [`first row: ${JSON.stringify(initialNames[0] ?? '')} → ${JSON.stringify(scrolledNames[0] ?? '')}`,
      `hint: ${above ? `"… ${above[1]} more above"` : 'none'}`])
  sendKeys(SESS80, 'End')
  await sleep(700)
  const paletteEnd = snap('10-palette-80x24-end', SESS80)
  const endNames = menuNames(paletteEnd)
  const fixtureVisible = endNames.some((l) => l.startsWith(`/${FIXTURE_SKILL}`))
  record('80x24: End reaches the last rows and shows the skill line', fixtureVisible,
    [`last visible row: ${JSON.stringify(endNames.at(-1) ?? '')}`, `fixture /${FIXTURE_SKILL} visible: ${fixtureVisible}`])
  for (let i = 0; i < 8; i++) { sendKeys(SESS80, 'BSpace'); await sleep(TYPE_GAP_MS) }
  await submit(SESS80, '/quit')
  await waitPane(SESS80, () => tmux('has-session', '-t', SESS80).status !== 0, 15_000)

  // ---------------- 4. composer top border inside a git repo ----------------
  // Same launcher, workspace = the repo checkout (a real git worktree): the
  // branch must appear as its own segment after the directory (` · ` join)
  // inside the composer's top border — on screen `┏━ ~/repo/dsh-opentui ·
  // main ━━…┓` (space-led text, no dash prefix). The expected name is read
  // straight from git, so a branch rename cannot make this pass by accident.
  const expectedBranch = sh('git', ['-C', REPO, 'rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
  launch(SESSGIT, COLS, ROWS, REPO)
  const bootGit = await waitPane(SESSGIT, (o) => o.includes('🧠') || idle(o), 90_000, 500)
  if (!bootGit.out.includes('🧠') && !idle(bootGit.out)) {
    record('composer context: a git workspace renders the branch', false, ['client never rendered'])
  } else {
    await waitPane(SESSGIT, idle, 30_000)
    const gitRow = await waitPane(
      SESSGIT,
      (o) => expectedBranch !== '' && composerContextRow(o).includes(` · ${expectedBranch}`),
      15_000,
      300,
    )
    const row = composerContextRow(gitRow.out)
    snap('23-composer-context-git', SESSGIT)
    record('composer context: a git workspace renders the branch segment in the top border',
      gitRow.ok && expectedBranch !== '',
      [`expected: " · ${expectedBranch}"`, `row: ${JSON.stringify(row)}`,
        // On a miss, show the rows around the composer so the mis-located
        // search (dock rows, missing bar) is diagnosable from the log.
        ...(gitRow.ok ? [] : gitRow.out.split('\n').slice(-12).map((l) => `frame| ${l}`))])
    await submit(SESSGIT, '/quit')
    await waitPane(SESSGIT, () => tmux('has-session', '-t', SESSGIT).status !== 0, 15_000)
  }

  // ---------------- 5. auto-resume on startup (feat/auto-resume) ----------------
  // The persisted session is the product's source of truth for an EXPLICIT
  // resume, but a plain launch must start a NEW session (the default policy is
  // `autoResume: "off"`). A REAL turn seeds the scratch store (the user message
  // + turn/start are committed before the model answers, so this is
  // route-agnostic); the next default boot must stay empty with no notice, and
  // an explicit `autoResume: "last"` must restore the transcript plus one
  // `resumed …` notice.
  reapHost()
  await sleep(500)
  const FIXTURE = `zzzzAutoresume${process.pid}`
  const sessionsRoot = join(HOME, 'sessions')
  const storedSessionArtifact = () => {
    try {
      for (const project of readdirSync(sessionsRoot, { withFileTypes: true })) {
        if (!project.isDirectory()) continue
        for (const dir of readdirSync(join(sessionsRoot, project.name), { withFileTypes: true })) {
          if (dir.isDirectory() && existsSync(join(sessionsRoot, project.name, dir.name, 'session.v4.jsonl.zstd'))) return true
        }
      }
    } catch { /* store not created yet */ }
    return false
  }
  // The seed boot (default policy = new session, store empty → fresh session).
  launch(SESS, COLS, ROWS)
  const bootSeed = await waitPane(SESS, (o) => o.includes('🧠') || idle(o), 90_000, 500)
  if (!bootSeed.out.includes('🧠') && !idle(bootSeed.out)) {
    record('auto-resume: a persisted session survives a client restart', false, ['client never rendered (seed)'])
  } else {
    await waitPane(SESS, idle, 30_000)
    await submit(SESS, FIXTURE)
    const echoed = await waitPane(SESS, (o) => has(o, FIXTURE), 20_000)
    const persisted = await (async () => {
      const deadline = Date.now() + 90_000
      while (Date.now() < deadline) {
        if (storedSessionArtifact()) return true
        await sleep(500)
      }
      return false
    })()
    snap('30-autoresume-seed')
    record('auto-resume: the seeded turn persists a session in the scratch store',
      echoed.ok && persisted,
      [echoed.ok ? 'fixture echoed in the transcript' : 'fixture echo not seen',
        persisted ? 'session.v4.jsonl.zstd on disk' : 'no session artifact after 90s'])
    await submit(SESS, '/quit')
    await waitPane(SESS, () => tmux('has-session', '-t', SESS).status !== 0, 15_000)
    reapHost()
    await sleep(500)

    // Restart 1: the DEFAULT policy is a NEW session (`autoResume` absent →
    // "off"). The stored transcript must NOT reappear and no `resumed …`
    // notice may be painted. Frames are accumulated over the notice's 8s
    // lifetime so a transient leak cannot slip past a single capture.
    writeFileSync(profileConfigPath, JSON.stringify(readProfile(), null, 2) + '\n')
    launch(SESS, COLS, ROWS)
    const bootDefault = await waitPane(SESS, (o) => o.includes('🧠') || idle(o), 90_000, 500)
    if (!bootDefault.out.includes('🧠') && !idle(bootDefault.out)) {
      record('auto-resume: default launch starts a new session', false, ['client never rendered (default)'])
    } else {
      await waitPane(SESS, idle, 30_000)
      let defaultHistory = false
      let defaultNotice = false
      {
        const deadline = Date.now() + 5_000
        while (Date.now() < deadline) {
          const frame = capture(SESS)
          if (has(frame, FIXTURE)) defaultHistory = true
          if (has(frame, 'resumed')) defaultNotice = true
          if (defaultHistory && defaultNotice) break
          await sleep(250)
        }
      }
      snap('31-autoresume-default-fresh')
      record('auto-resume: default launch starts a new session (no history, no notice)',
        !defaultHistory && !defaultNotice,
        [defaultHistory ? 'stored history leaked' : 'transcript empty',
          defaultNotice ? 'resume notice leaked' : 'no resume notice in the boot frames'])
      await submit(SESS, '/quit')
      await waitPane(SESS, () => tmux('has-session', '-t', SESS).status !== 0, 15_000)
    }
    reapHost()
    await sleep(500)

    // Restart 2: the explicit opt-in (`autoResume: "last"` in the scratch
    // profile config) restores the stored transcript and paints the one-line
    // notice. The notice lives 8s, so both markers are accumulated across
    // early frames instead of waiting for one frame to carry a settled
    // interface.
    writeFileSync(profileConfigPath, JSON.stringify({ ...readProfile(), autoResume: 'last' }, null, 2) + '\n')
    launch(SESS, COLS, ROWS)
    const bootLast = await waitPane(SESS, (o) => o.includes('🧠') || idle(o), 90_000, 500)
    if (!bootLast.out.includes('🧠') && !idle(bootLast.out)) {
      record('auto-resume: autoResume:"last" restores the stored transcript', false, ['client never rendered (last)'])
    } else {
      let resumeNotice = false
      let resumeHistory = false
      {
        const deadline = Date.now() + 90_000
        while (Date.now() < deadline) {
          const frame = capture(SESS)
          if (has(frame, 'resumed')) resumeNotice = true
          if (has(frame, FIXTURE)) resumeHistory = true
          if (resumeNotice && resumeHistory) break
          await sleep(250)
        }
      }
      snap('32-autoresumed')
      record('auto-resume: autoResume:"last" restores the stored transcript', resumeHistory,
        [resumeHistory ? `fixture ${FIXTURE} visible` : 'stored history missing'])
      record('auto-resume: autoResume:"last" paints one `resumed <title> · <time ago>` notice', resumeNotice,
        [resumeNotice ? 'resume notice visible' : 'no resume notice in the boot frames'])
      await submit(SESS, '/quit')
      await waitPane(SESS, () => tmux('has-session', '-t', SESS).status !== 0, 15_000)
    }
  }
} catch (error) {
  console.error('agents-mount: ' + (error instanceof Error ? error.message : String(error)))
  results.push({ item: 'harness', ok: false, detail: [String(error).slice(0, 300)] })
} finally {
  killSession(SESS)
  killSession(SESS80)
  killSession(SESSGIT)
  reapHost()
  stopMock()
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({
    cols: COLS, rows: ROWS, home: HOME, workspace: WS,
    fallbackSeen: results.some((r) => r.detail.some((d) => String(d).includes(FALLBACK))),
    results,
  }, null, 2))
  if (!KEEP) {
    rmSync(HOME, { recursive: true, force: true })
    rmSync(WS, { recursive: true, force: true })
  } else {
    console.log(`scratch home kept: ${HOME}`)
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\nagents-mount: ${results.length - failed.length}/${results.length} checks passed`)
  console.log(`summary: verify/agents-mount-out/summary.json`)
  process.exit(failed.length === 0 ? 0 : 1)
}
