#!/usr/bin/env node
// Real-client gate for the /agents mount + slash-palette height.
//
//   node verify/agents-mount-repro.mjs [--cols 120] [--rows 34] [--keep]
//
// What it proves (against the REAL launcher `./dsh-opentui`, a scratch
// DSH_HOME seeded from the real home — same isolation pattern as
// packages/shell/scripts/e2e-sweep.mjs, nothing is written to ~/.dsh):
//   1. `/agents` opens the panel-kit modal (title `Agents`, List columns
//      NAME/MODEL/THINK/DEEP/LIMITS, one row per agent; the limits layer when
//      the corpus is empty) instead of the fallback notice
//      "/agents: the manager panel is not mounted in this entry";
//   2. the panel responds to keys: Enter drills into the fields layer
//      (FIELD/VALUE + ✎ model|thinking|deep rows naming the selected agent),
//      Esc returns one layer, `l` opens the limits layer (maxRounds /
//      background / the two official caps), Esc closes the modal;
//   2b. `/settings` opens the panel-kit modal (title `Settings`, seven-section
//      nav, Host section with the four whitelist rows), a local preference
//      edit (motion) really rewrites the scratch profile config.json (full,
//      then back to auto), the inner-first Esc ladder (editor → browse →
//      close) holds, and a keyboard-selected host row commits through 确定
//      (Ctrl+S) into the scratch cordis.patch.yml;
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
const FALLBACK = 'not mounted in this entry'
// panel-kit modal contracts (T18 migration): the kit Panel paints a bare
// title + `esc` hint; the List paints its own column titles. The old inline
// panel's `● Agents` / `⚙ Limits` glyph titles and the three-zone /settings
// frame no longer exist, so the markers below are the new ones.
const AGENT_TABLE_HEADER = /NAME\s+MODEL\s+THINK\s+DEEP\s+LIMITS/
const AGENT_TABLE_HINT = 'enter open · l limits'
const AGENT_LIMITS_KEYS = ['maxRounds', 'background', 'maxActiveSubagents', 'maxDepth']
const SETTINGS_SUBTITLE = '分节导航 · Ctrl+S 提交 · Esc 逐层返回'
const SETTINGS_SECTIONS = ['通用', 'TUI 专有', 'Host', '模型', '插件', 'Agent 预设', '账号']
/** Content-pane marker that only one section paints (reachability proof). */
const SECTION_MARKERS = ['权限默认预设', 'cacheHitMode', 'subagent.maxActiveSubagents', '打开 /model', '打开 /plugins', '打开 /preset', '打开 /login']
const HOST_ROWS = ['subagent.maxActiveSubagents', 'subagent.maxDepth', 'permission.defaultPreset', 'session-log-deepseek.enabled']
const XLargeWidth = (cols) => Math.min(116, cols - 2)
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

// --- panel-kit frame parsing ------------------------------------------------
/** Display cells of one grapheme (CJK/emoji occupy two). */
const charCells = (ch) => {
  const cp = ch.codePointAt(0) ?? 0
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0
  const wide =
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff)
  return wide ? 2 : 1
}
const displayColumns = (text) => {
  const cols = []
  for (const ch of text) {
    cols.push(ch)
    for (let i = charCells(ch); i > 1; i -= 1) cols.push('')
  }
  return cols
}
/** Text between the panel's own vertical borders (`┃ … ┃`), inset kept. */
const panelInterior = (line) => {
  const left = line.indexOf('┃')
  const right = line.lastIndexOf('┃')
  return left >= 0 && right > left ? line.slice(left + 1, right) : ''
}
/** The kit Panel header row (`<title> … esc`) as painted. */
const panelTitle = (out) => {
  for (const line of out.split('\n')) {
    const m = /┃\s{2,}(\S.*?)\s{2,}esc\s*┃/.exec(line)
    if (m) return m[1].trim()
  }
  return ''
}
/** Heavy frame width of the modal (`xlarge` preset clamps to cols - 2). */
const panelFrameWidth = (out) => {
  for (const line of out.split('\n')) {
    const m = /┏([━]*)┓/.exec(line)
    if (m) return m[1].length + 2
  }
  return 0
}
/** /agents layers. The table is the column header + its action hint; fields
 * carries the three `✎` field rows; limits always paints both official caps. */
const agentTableUp = (out) => AGENT_TABLE_HEADER.test(out) && out.includes(AGENT_TABLE_HINT)
const agentFieldsUp = (out) => out.includes('✎ model') && out.includes('t think')
const agentLimitsUp = (out) => AGENT_LIMITS_KEYS.every((key) => out.includes(key))
const agentsPanelUp = (out) => agentTableUp(out) || agentFieldsUp(out) || agentLimitsUp(out)
/** Body cell budget, mirroring agents-panel.tsx `bodyWidth()`. */
const agentTableBudget = (cols, rows) => {
  const inner = Math.max(1, XLargeWidth(cols) - 2)
  const inset = inner < 64 || rows - 4 < 20 ? 1 : 3
  return Math.max(20, inner - inset * 2)
}
const AGENT_TABLE_WIDTHS = [18, 30, 10, 5, 24]
/** One table row split into its five declared cells (header gives the origin). */
const agentTableCells = (headerLine, rowLine) => {
  const origin = panelInterior(headerLine).indexOf('NAME')
  if (origin < 0) return undefined
  const cols = displayColumns(panelInterior(rowLine))
  const bounds = []
  let at = origin
  for (const width of AGENT_TABLE_WIDTHS) {
    bounds.push([at, at + width])
    at += width + 1
  }
  const [name, model, think, deep, limits] = bounds.map(([from, to]) => cols.slice(from, to).join('').trim())
  return { name, model, think, deep, limits }
}
/** Parsed table data rows (header + action-hint excluded). */
const agentTableParsed = (out) => {
  const lines = out.split('\n')
  const at = lines.findIndex((line) => AGENT_TABLE_HEADER.test(line))
  if (at < 0) return []
  const parsed = []
  for (let i = at + 1; i < lines.length; i += 1) {
    if (!lines[i].includes('┃') || lines[i].includes(AGENT_TABLE_HINT)) break
    if (panelInterior(lines[i]).trim() === '') break
    const cells = agentTableCells(lines[at], lines[i])
    if (cells !== undefined) parsed.push(cells)
  }
  return parsed
}
/** /settings modal: the subtitle is unique to the panel. */
const settingsUp = (out) => out.includes(SETTINGS_SUBTITLE)

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
  const opened = await waitPane(SESS, (o) => agentsPanelUp(o) || has(o, FALLBACK), 20_000)
  const tableUp = agentTableUp(opened.out)
  const limitsFirst = agentLimitsUp(opened.out)
  snap('02-agents-open')
  record('/agents opens the manager panel (panel-kit modal)', tableUp || limitsFirst,
    [tableUp ? 'table layer' : limitsFirst ? 'limits layer (empty corpus)' : `saw: ${has(opened.out, FALLBACK) ? FALLBACK : 'no panel marker'}`])
  // New contract: the kit Panel paints the bare title + esc hint and the List
  // paints its own column titles; the old inline `● Agents` glyph is gone.
  record('/agents modal frame uses the 116-cell xlarge preset',
    panelFrameWidth(opened.out) === XLargeWidth(COLS),
    [`frame width: ${panelFrameWidth(opened.out)} (expected ${XLargeWidth(COLS)} at ${COLS} cols)`])

  const parsedTable = tableUp ? agentTableParsed(opened.out) : []
  if (tableUp) {
    // Row content: every agent row must fill all five declared cells, with a
    // numeric DEEP and a non-empty LIMITS cell. The fixed widths only hold
    // while the body budget covers them; below that the kit shrinks columns,
    // so the cell-level assertions are pinned to the declared-width geometry.
    const strictCells = agentTableBudget(COLS, ROWS) >= AGENT_TABLE_WIDTHS.reduce((a, b) => a + b, 0) + AGENT_TABLE_WIDTHS.length - 1
    if (strictCells) {
      record('/agents table paints NAME/MODEL/THINK/DEEP/LIMITS cells for every agent row',
        parsedTable.length >= 1 && parsedTable.every((row) => row.name !== '' && row.model !== ''),
        [`${parsedTable.length} rows`, `first: ${JSON.stringify(parsedTable[0] ?? {})}`])
      record('/agents table rows fill the THINK, DEEP and LIMITS cells',
        parsedTable.every((row) => row.think !== '' && /^\d+$/.test(row.deep) && row.limits !== ''),
        [`think cells: ${JSON.stringify(parsedTable.map((row) => row.think))}`,
          `deep cells: ${JSON.stringify(parsedTable.map((row) => row.deep))}`,
          `limits cells: ${JSON.stringify(parsedTable.map((row) => row.limits))}`])
    } else {
      record('/agents table paints its column header at a shrunk geometry',
        parsedTable.length >= 1, [`${parsedTable.length} rows (columns shrunk)`])
    }

    sendKeys(SESS, 'Enter')
    const fields = await waitPane(SESS, agentFieldsUp, 8_000)
    snap('03-agents-fields')
    const fieldsTitle = panelTitle(fields.out)
    record('/agents Enter drills into the fields layer', fields.ok && fieldsTitle !== '',
      [fields.ok ? `title: ${JSON.stringify(fieldsTitle)}` : 'fields layer not visible'])
    record('/agents fields layer opens the table row under the cursor',
      fieldsTitle !== '' && parsedTable[0]?.name === fieldsTitle,
      [`table row 0: ${JSON.stringify(parsedTable[0]?.name ?? '')}`, `fields title: ${JSON.stringify(fieldsTitle)}`])
    record('/agents fields layer paints the three editable field rows (✎ model/thinking/deep)',
      /✎\s*model/.test(fields.out) && /✎\s*thinking/.test(fields.out) && /✎\s*deep/.test(fields.out),
      ['FIELD/VALUE list with ✎ model · ✎ thinking · ✎ deep'])
    sendKeys(SESS, 'Escape')
    const backToTable = await waitPane(SESS, agentTableUp, 8_000)
    record('/agents Esc returns from the fields layer to the table', backToTable.ok,
      [backToTable.ok ? 'table layer visible again' : 'still on the fields layer'])
  }

  sendKeys(SESS, 'l')
  const limits = await waitPane(SESS, agentLimitsUp, 10_000)
  snap('04-agents-limits')
  const missingLimitKeys = AGENT_LIMITS_KEYS.filter((key) => !limits.out.includes(key))
  record('/agents l opens the limits layer', limits.ok && missingLimitKeys.length === 0,
    [limits.ok ? `rows: ${AGENT_LIMITS_KEYS.join(' / ')}` : `limits layer not visible${missingLimitKeys.length ? ` (missing ${missingLimitKeys.join(', ')})` : ''}`])
  // The two official caps are host settings: numeric when the host serves them,
  // `n/a` otherwise — either way the row must be painted.
  const officialCaps = ['maxActiveSubagents', 'maxDepth'].map((key) => ({
    key,
    value: new RegExp(`${key}\\s+(\\S+)`).exec(limits.out)?.[1] ?? '',
  }))
  record('/agents limits layer paints both official subagent caps',
    officialCaps.every((cap) => /^\d+$|^n\/a$/.test(cap.value)),
    officialCaps.map((cap) => `${cap.key}: ${cap.value || 'missing'}`))

  sendKeys(SESS, 'Escape')
  const back = await waitPane(SESS, (o) => !agentLimitsUp(o) && agentTableUp(o), 8_000)
  record('/agents Esc leaves the limits layer', back.ok, [back.ok ? 'back on the table layer' : 'limits layer still visible'])
  // Esc one layer at a time (limits -> table -> closed); a dropped Escape in
  // the key parser must not leave the panel parked, so retry bounded.
  const closedPred = (o) => !agentsPanelUp(o) && idle(o)
  let closed = { ok: false, out: capture(SESS) }
  for (let attempt = 0; attempt < 4 && !closed.ok; attempt++) {
    sendKeys(SESS, 'Escape')
    closed = await waitPane(SESS, closedPred, 5_000)
  }
  snap('05-agents-closed')
  if (!closed.ok) {
    writeFileSync(join(OUT, '05-close-frame.txt'), closed.out)
    console.log(`  debug close: markers=${agentsPanelUp(closed.out)} ` +
      `idle=${idle(closed.out)} composerRows=${JSON.stringify(composerRows(closed.out))}`)
  }
  record('/agents Esc closes the modal', closed.ok,
    [closed.ok ? 'back to the composer' : 'panel still on screen'])
  const agentsSummary = closed.out.split('\n').find((line) => /Agents (unchanged|updated)/.test(line)) ?? ''
  record('/agents close prints the exit summary', /Agents (unchanged|updated)/.test(agentsSummary),
    [agentsSummary.trim() === '' ? 'no summary row' : agentsSummary.trim()])

  // ---------------- 1b. /settings modal (panel-kit, T18) ----------------
  // Seven-section nav (通用 / TUI 专有 / Host / 模型 / 插件 / Agent 预设 / 账号)
  // with the inner-first Esc ladder (editor → browse → close), a REAL local
  // preference write (motion full → auto) observed in the scratch profile
  // config.json, and the Host section: the four whitelist rows from the live
  // settings/describe plus a keyboard-selected row committed with 确定 (Ctrl+S).
  const profileConfigPath = join(HOME, 'profiles', PROFILE, 'config.json')
  const readProfile = () => {
    try { return JSON.parse(readFileSync(profileConfigPath, 'utf8')) } catch { return {} }
  }
  const waitProfile = async (pred, timeout = 12_000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const config = readProfile()
      if (pred(config)) return config
      await sleep(200)
    }
    return readProfile()
  }
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
  const waitPatch = async (pred, timeout = 12_000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (pred(readPatch())) return true
      await sleep(200)
    }
    return pred(readPatch())
  }
  const hostRowLine = (out, key) => out.split('\n').find((line) => line.includes(key)) ?? ''
  const openSettings = async () => {
    await submit(SESS, '/settings')
    return waitPane(SESS, settingsUp, 25_000)
  }
  const waitSettingsClosed = (timeout = 15_000) => waitPane(SESS, (out) => !settingsUp(out) && idle(out), timeout)
  /** Land on one section: Up clamps at index 0, then Down walks to the target. */
  const gotoSection = async (index) => {
    await sleep(250) // let the modal's entrance settle before driving its keys
    for (let i = 0; i < SETTINGS_SECTIONS.length; i++) { sendKeys(SESS, 'Up'); await sleep(110) }
    for (let i = 0; i < index; i++) { sendKeys(SESS, 'Down'); await sleep(160) }
  }
  /** The Host rows pane (section 2, rows focus). */
  const openHostRows = async () => {
    await gotoSection(2)
    sendKeys(SESS, 'Right')
    return waitPane(SESS, (out) => out.includes('↑↓ 选择行') && /subagent\.maxActiveSubagents\s+\d+/.test(out), 10_000)
  }

  const settingsOpen = await openSettings()
  snap('11-settings-open')
  const navLabels = SETTINGS_SECTIONS.filter((label) => settingsOpen.out.includes(label))
  record('/settings opens the Settings modal (section nav + commit band)',
    settingsOpen.ok && navLabels.length === SETTINGS_SECTIONS.length && settingsOpen.out.includes('确定 ctrl+s'),
    [`nav sections: ${navLabels.join(' / ') || 'none'}`,
      settingsOpen.out.includes('确定 ctrl+s') ? 'commit band: esc 取消 · 确定 ctrl+s' : 'commit band missing'])
  record('/settings modal frame uses the 116-cell xlarge preset',
    panelFrameWidth(settingsOpen.out) === XLargeWidth(COLS),
    [`frame width: ${panelFrameWidth(settingsOpen.out)} (expected ${XLargeWidth(COLS)} at ${COLS} cols)`])

  // Every section must be reachable from the nav: Down walks the seven entries
  // and each one paints its own content marker in the right pane.
  const sectionSeen = []
  for (let index = 0; index < SETTINGS_SECTIONS.length; index += 1) {
    const frame = capture(SESS)
    sectionSeen.push(SECTION_MARKERS[index] !== undefined && frame.includes(SECTION_MARKERS[index]))
    if (index < SETTINGS_SECTIONS.length - 1) { sendKeys(SESS, 'Down'); await sleep(320) }
  }
  record('/settings all seven nav sections are reachable',
    sectionSeen.every(Boolean),
    SETTINGS_SECTIONS.map((label, index) => `${label}: ${sectionSeen[index] ? 'ok' : 'missing'}`))

  // Host section: the four whitelist rows from a LIVE settings/describe (the
  // numeric caps prove the document landed, not just the static skeleton).
  const hostPane = await openHostRows()
  snap('13-settings-host-rows')
  const missingHostRows = HOST_ROWS.filter((row) => !hostPane.out.includes(row))
  record('/settings Host section renders the four whitelisted rows from the live document',
    hostPane.ok && missingHostRows.length === 0,
    [hostPane.ok ? 'section rows pane' : 'rows pane not reached',
      missingHostRows.length === 0 ? 'all four rows visible' : `missing: ${missingHostRows.join(', ')}`,
      `values: maxActiveSubagents=${/subagent\.maxActiveSubagents\s+(\S+)/.exec(hostPane.out)?.[1] ?? '?'} ` +
      `maxDepth=${/subagent\.maxDepth\s+(\S+)/.exec(hostPane.out)?.[1] ?? '?'} ` +
      `session-log-deepseek.enabled=${/session-log-deepseek\.enabled\s+(\S+)/.exec(hostPane.out)?.[1] ?? '?'}`])
  record('/settings never lists dsh-tui (not part of the opentui profile)',
    !hostPane.out.includes('dsh-tui'),
    [!hostPane.out.includes('dsh-tui') ? 'absent' : 'dsh-tui leaked into the read-only list'])
  // A section longer than one page reports its window; the old three-zone
  // panel had no paging, so this also proves the List pager is wired.
  const pageIndicator = /(\d+-\d+\/\d+)/.exec(hostPane.out)?.[1] ?? ''
  record('/settings paged section reports its row window',
    pageIndicator === '' || /^1-\d+\/\d+$/.test(pageIndicator),
    [pageIndicator === '' ? 'section fits one page (no indicator)' : `indicator: ${pageIndicator}`])

  // Describe-only namespaces are read-only: their rows carry `rev N` and the
  // current row's note says so. Down x4 from the first whitelist row lands on
  // the first other namespace (agent-default-model).
  for (let i = 0; i < 4; i++) { sendKeys(SESS, 'Down'); await sleep(140) }
  const readOnlyRow = await waitPane(SESS, (out) => out.includes('只读 · 本 TUI 不消费'), 6_000)
  snap('14-settings-host-readonly-note')
  record('/settings marks other namespaces read-only ("本 TUI 不消费")',
    readOnlyRow.ok && /agent-default-model\s+rev \d+/.test(readOnlyRow.out) &&
      !/✎\s+agent-default-model/.test(readOnlyRow.out),
    [readOnlyRow.ok ? 'read-only note visible on a `rev N` row' : 'note missing',
      hostRowLine(readOnlyRow.out, 'agent-default-model').trim()])
  sendKeys(SESS, 'Up') // back onto session-log-deepseek.enabled (row 3)
  await sleep(200)

  // Host write on a REAL host: a keyboard-selected row → Enter stages a draft →
  // 确定 (Ctrl+S) commits through settings.mutate into cordis.patch.yml. The
  // proof has two halves — the patch file and the value a FRESH describe paints
  // after reopening the modal. Scratch home only; the real ~/.dsh stays clean.
  const hostRow = await waitPane(SESS, (out) => /session-log-deepseek\.enabled\s+(on|off)/.test(out), 6_000)
  const valueBefore = /session-log-deepseek\.enabled\s+(on|off)/.exec(hostRow.out)?.[1] ?? 'on'
  const afterToggle = valueBefore === 'on' ? 'off' : 'on'
  record('settings selects the host row with the keyboard', hostRow.ok && hostRow.out.includes('session-log-deepseek.enabled'),
    [hostRow.ok ? `row: ${hostRowLine(hostRow.out, 'session-log-deepseek').trim()}` : 'row not selected'])
  sendKeys(SESS, 'Enter') // toggle: value → afterToggle (staged draft)
  const staged = await waitPane(SESS,
    (out) => new RegExp(`session-log-deepseek\\.enabled\\s+${afterToggle}`).test(out) && /未提交：\d+ 项/.test(out), 8_000)
  snap('15-settings-host-staged')
  record('settings stages the host toggle as an uncommitted draft', staged.ok,
    staged.ok ? [`row shows ${afterToggle}; commit band: 未提交：1 项`] : ['draft not staged'])
  sendKeys(SESS, 'C-s') // 确定
  const wroteOff = await waitPatch((text) => patchEntry('session-log-deepseek').includes(`enabled: ${afterToggle === 'on'}`))
  const closedAfterWrite = await waitSettingsClosed()
  snap('16-settings-host-write-off')
  record(`settings writes a host row (session-log-deepseek.enabled=${afterToggle}) into cordis.patch.yml`,
    staged.ok && wroteOff && closedAfterWrite.ok,
    [staged.ok ? 'row selected + edited' : 'row not selected',
      wroteOff ? `patch entry has enabled: ${afterToggle === 'on'}` : `patch entry: ${JSON.stringify(patchEntry('session-log-deepseek').slice(-120))}`,
      closedAfterWrite.ok ? '确定 closed the modal' : 'modal still on screen'])
  const writeSummary = closedAfterWrite.out.split('\n').find((line) => /Settings updated:/.test(line)) ?? ''
  record('/settings commits print the exit summary', /Settings updated:/.test(writeSummary),
    [writeSummary.trim() === '' ? 'no summary row' : writeSummary.trim()])

  // Proof half 2: a fresh settings/describe after reopening shows the new value.
  await openSettings()
  const reread = await openHostRows()
  const rereadRow = await waitPane(SESS,
    (out) => new RegExp(`session-log-deepseek\\.enabled\\s+${afterToggle}`).test(out), 10_000)
  snap('17-settings-host-reread')
  record('settings re-reads the host write through settings/describe',
    reread.ok && rereadRow.ok,
    [rereadRow.ok ? `row shows ${afterToggle} after a fresh describe` : `row: ${JSON.stringify(hostRowLine(rereadRow.out, 'session-log-deepseek'))}`])

  // Restore the original value (same keyboard path).
  for (let i = 0; i < 3; i++) { sendKeys(SESS, 'Down'); await sleep(140) }
  sendKeys(SESS, 'Enter')
  const stagedBack = await waitPane(SESS,
    (out) => new RegExp(`session-log-deepseek\\.enabled\\s+${valueBefore}`).test(out) && /未提交：\d+ 项/.test(out), 8_000)
  sendKeys(SESS, 'C-s')
  const wroteOn = await waitPatch((text) => patchEntry('session-log-deepseek').includes(`enabled: ${valueBefore === 'on'}`))
  const restoredClose = await waitSettingsClosed()
  snap('18-settings-host-restore')
  record(`settings restores the host row (session-log-deepseek.enabled=${valueBefore})`,
    stagedBack.ok && wroteOn && restoredClose.ok,
    [wroteOn ? `patch entry back to enabled: ${valueBefore === 'on'}` : `patch entry: ${JSON.stringify(patchEntry('session-log-deepseek').slice(-120))}`,
      restoredClose.ok ? 'modal closed after 确定' : 'modal still on screen'])

  // ---- local preference write (motion) through the TUI 专有 section ----
  const MOTION_OPTIONS = ['auto', 'full', 'reduced', 'off']
  /** Open the motion enum editor: TUI 专有 (section 1) → rows → row 3. The
   * enum cursor starts on the current display value (P0-2). */
  const openMotionEditor = async () => {
    await gotoSection(1)
    sendKeys(SESS, 'Right')
    const rows = await waitPane(SESS,
      (out) => out.includes('↑↓ 选择行') && new RegExp(`motion\\s+(${MOTION_OPTIONS.join('|')})`).test(out), 8_000)
    const current = new RegExp(`motion\\s+(${MOTION_OPTIONS.join('|')})`).exec(rows.out)?.[1] ?? 'auto'
    for (let i = 0; i < 3; i++) { sendKeys(SESS, 'Down'); await sleep(140) } // motion row (index 3)
    sendKeys(SESS, 'Enter')
    const editor = await waitPane(SESS, (out) => out.includes('motion — 选择值'), 8_000)
    return { rows, current, editor }
  }
  /** ↓ to the target option (the enum cursor wraps). */
  const moveMotionCursor = async (current, target) => {
    const steps = (MOTION_OPTIONS.indexOf(target) - MOTION_OPTIONS.indexOf(current) + MOTION_OPTIONS.length) % MOTION_OPTIONS.length
    for (let i = 0; i < steps; i++) { sendKeys(SESS, 'Down'); await sleep(160) }
    return steps
  }

  await openSettings()
  const motionFirst = await openMotionEditor()
  // Always pick a value that differs from the snapshot, so Enter stages a real
  // draft and 确定 writes it (a same-value choice is dropped by the modal).
  const motionTarget = motionFirst.current === 'full' ? 'auto' : 'full'
  const motionSteps = await moveMotionCursor(motionFirst.current, motionTarget)
  snap('19-settings-motion-editor')
  const optionLines = MOTION_OPTIONS.filter((option) =>
    new RegExp(`${option}(\\s+\\(current\\))?\\s+┃`).test(motionFirst.editor.out))
  record('/settings Enter opens the motion enum editor', motionFirst.editor.ok && optionLines.length === 4,
    [motionFirst.editor.ok ? `title: motion — 选择值; options: ${optionLines.join('/')}` : 'editor not visible',
      `cursor starts on the current value: ${motionFirst.current}`,
      new RegExp(`▸\\s+${motionFirst.current}\\b`).test(motionFirst.editor.out) ? '▸ on current' : '▸ missing'])

  // Inner-first Esc ladder: editor → browse (the panel stays open).
  sendKeys(SESS, 'Escape')
  const editorBack = await waitPane(SESS,
    (out) => !out.includes('motion — 选择值') && settingsUp(out) && /↑↓ 选择行/.test(out), 6_000)
  snap('20-settings-motion-editor-back')
  record('/settings Esc discards the editor and returns to the section rows', editorBack.ok,
    [editorBack.ok ? 'editor closed, section still on screen' : 'editor did not return'])

  // Re-enter the editor, aim the cursor, stage the draft, commit with 确定.
  sendKeys(SESS, 'Enter')
  await waitPane(SESS, (out) => out.includes('motion — 选择值'), 8_000)
  await moveMotionCursor(motionFirst.current, motionTarget)
  sendKeys(SESS, 'Enter')
  const motionStaged = await waitPane(SESS,
    (out) => new RegExp(`✎\\s*motion\\s+${motionTarget}`).test(out) && /未提交：\d+ 项/.test(out), 8_000)
  snap('21-settings-motion-staged')
  record(`settings stages motion=${motionTarget} as an uncommitted draft`, motionStaged.ok,
    motionStaged.ok ? [`row: ✎ motion ${motionTarget}; commit band: 未提交：1 项`] : ['draft not staged'])
  sendKeys(SESS, 'C-s')
  const fullConfig = await waitProfile((config) => config.motion === motionTarget)
  const fullClose = await waitSettingsClosed()
  snap('22-settings-motion-write')
  record(`settings writes motion=${motionTarget} into the profile config.json`,
    motionStaged.ok && fullConfig.motion === motionTarget && fullClose.ok,
    [`motion: ${JSON.stringify(fullConfig.motion)}`, `steps from ${motionFirst.current}: ${motionSteps}`,
      fullClose.ok ? 'modal closed after 确定' : 'modal still on screen'])

  // Restore the original value through the same path (cursor starts on it now).
  await openSettings()
  const motionBack = await openMotionEditor()
  const restoreSteps = await moveMotionCursor(motionBack.current, motionFirst.current)
  sendKeys(SESS, 'Enter')
  const autoStaged = await waitPane(SESS,
    (out) => new RegExp(`✎\\s*motion\\s+${motionFirst.current}`).test(out) && /未提交：\d+ 项/.test(out), 8_000)
  sendKeys(SESS, 'C-s')
  const autoConfig = await waitProfile((config) => config.motion === motionFirst.current)
  const autoClose = await waitSettingsClosed()
  snap('23-settings-motion-restore')
  record(`settings writes motion back to ${motionFirst.current}`,
    autoStaged.ok && autoConfig.motion === motionFirst.current && autoClose.ok,
    [`motion: ${JSON.stringify(autoConfig.motion)}`, `steps from ${motionBack.current}: ${restoreSteps}`])

  // Browse root Esc closes (no dirty draft → no discard confirm).
  await openSettings()
  sendKeys(SESS, 'Escape')
  const settingsClosed = await waitSettingsClosed(8_000)
  snap('24-settings-closed')
  record('/settings Esc closes the modal at the browse root', settingsClosed.ok,
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
