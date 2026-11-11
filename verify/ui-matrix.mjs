#!/usr/bin/env node
// Geometry × scene visual matrix for the real client (tmux capture gate).
//
//   node verify/ui-matrix.mjs [--geoms 80x24,120x34,45x30] [--keep] [--only 80x24]
//
// Why this file exists: verify/agents-mount-repro.mjs already drives the REAL
// launcher through tmux and asserts behaviour, but its checks mostly answer
// "did the panel open / did the row appear". This gate answers "does the
// frame LOOK right": border characters, SGR attributes, column widths, row
// counts and color contrast are asserted numerically on the captured ANSI.
//
// Matrix (each cell runs every scene that fits it):
//   80x24   compact (≤30 rows): left/right rules only, activity rule form
//   120x34  framed: transcript title, full activity frame
//   45x30   narrow compact: left truncation, clipping discipline
//   100x45  41–50 row band: dock line cap 2
//   120x52  >50 rows: dock line cap 3 (think block 3 rows)
//
// Scenes:
//   1 blank first screen  — no history, no "resumed", no "Loading"
//   2 content session     — user box, assistant markdown, code-block frame,
//                           live think block (cap rows), code fence title
//   3 slash menu          — 10 rows + "… N more", PgDn → "… N more above",
//                           End → skill row with exact italic SGR (param 3)
//   4 pane focus          — single → F6 → heavy + accent color; compact
//                           terminals add no top row
//   5 footer              — 🧠 compact `(x.x%)` (no inner spaces), one row,
//                           every segment inside the terminal width
//   6 composer context    — cwd row above the box: one clipped row, tail kept
//   7 busy submit         — steer/queue rows with muted-italic / brand SGR
//   8 activity frame      — heavy border, blue hue, contrast ≥ 6:1 (frame
//                           form) / left-rule form at compact heights
//
// Isolation: same scratch-DSH_HOME pattern as agents-mount-repro — nothing is
// written to ~/.dsh. The model is the offline mock (e2e/lib/mock-llm.mjs)
// patched into the scratch profile, so no provider call leaves the machine.
//
// Exit 0 = every check passed; exit 1 = at least one failed; exit 2 =
// environment problem. Captures land in verify/ui-matrix-out/ (gitignored).

import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LAUNCHER = join(REPO, 'dsh-opentui')
const MOCK = join(REPO, 'e2e', 'lib', 'mock-llm.mjs')
const PROFILE = 'opentui'
const REAL_HOME = process.env.DSH_HOME_REAL || join(homedir(), '.dsh')
const PLACEHOLDER = 'Type a message'
const IDLE = '提问，回车发送'
const OUT = join(REPO, 'verify', 'ui-matrix-out')
const PORT = 18600 + (process.pid % 300)
const FIXTURE_SKILL = 'zzzz-verify-fixture'
const SESS = `ui-matrix-${process.pid}`

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const GEOMS = String(arg('geoms', '80x24,120x34,45x30,100x45,120x52'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const m = /^(\d+)x(\d+)$/.exec(s)
    if (!m) throw new Error(`bad geometry: ${s}`)
    return { label: s, cols: Number(m[1]), rows: Number(m[2]) }
  })
const ONLY = arg('only', '')
const KEEP = process.argv.includes('--keep')
const TYPE_GAP_MS = 50

// dsh-blue, the scratch profile's theme: token values asserted below.
const THEME = {
  background: '#0a0a0f',
  borderBase: '#3a3f5c',
  interactive500: '#4d6bfe',
  textMuted: '#8a8a8a',
  textBase: '#eeeeee',
  activityBlue: '#8599ff',
}
const ACTIVITY_MIN_CONTRAST = 6

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })
const tmux = (...a) => sh('tmux', a)
const tmuxOut = (...a) => (tmux(...a).status === 0 ? tmux(...a).stdout : '')
const flat = (s) => String(s).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '')
const has = (out, marker) => flat(out).includes(flat(marker))

for (const cmd of ['tmux', 'bun', 'node']) {
  if (sh('which', [cmd]).status !== 0) {
    console.error(`ui-matrix: ${cmd} not on PATH`)
    process.exit(2)
  }
}
if (!existsSync(join(REAL_HOME, 'profiles', PROFILE))) {
  console.error(`ui-matrix: profile '${PROFILE}' missing under ${REAL_HOME}`)
  process.exit(2)
}
if (!existsSync(LAUNCHER) || !existsSync(MOCK)) {
  console.error(`ui-matrix: launcher or mock missing (${LAUNCHER}, ${MOCK})`)
  process.exit(2)
}
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

// ---------------------------------------------------------------------------
// ANSI / width primitives
// ---------------------------------------------------------------------------

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g
const stripAnsi = (s) => String(s).replace(ANSI_RE, '')
/** Display width of ONE plain string (emoji = 2, CJK = 2). */
const widthOf = (s) => {
  let n = 0
  for (const ch of stripAnsi(s)) {
    const cp = ch.codePointAt(0)
    if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) continue
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff) ||
      cp === 0x1f9e0
    ) n += 2
    else n += 1
  }
  return n
}

const BASE16 = ['#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
  '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff']
const hex2 = (n) => n.toString(16).padStart(2, '0')
const rgbHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`
function xterm256(n) {
  if (n < 16) return BASE16[n]
  if (n < 232) {
    const steps = [0, 95, 135, 175, 215, 255]
    const i = n - 16
    return rgbHex(steps[Math.floor(i / 36) % 6], steps[Math.floor(i / 6) % 6], steps[i % 6])
  }
  const v = 8 + (n - 232) * 10
  return rgbHex(v, v, v)
}

/**
 * Parse one captured row into SGR text runs. Returns
 * [{text, fg, bg, italic}] where fg/bg are #rrggbb or null (terminal
 * default). 38/48 + 2;r;g;b and 5;n are handled; a `3` ONLY counts as the
 * italic attribute — color params (33/43/93, 256-index) are skipped.
 */
function sgrRuns(row) {
  const runs = []
  let fg = null
  let bg = null
  let italic = false
  let last = 0
  const push = (text) => { if (text !== '') runs.push({ text, fg, bg, italic }) }
  const re = /\x1b\[([0-9;]*)m/g
  let m
  while ((m = re.exec(row)) !== null) {
    push(row.slice(last, m.index))
    const params = (m[1] === '' ? '0' : m[1]).split(';').map(Number)
    for (let i = 0; i < params.length; i++) {
      const p = params[i]
      if (p === 0) { fg = null; bg = null; italic = false; continue }
      if (p === 3) { italic = true; continue }
      if (p === 23) { italic = false; continue }
      if (p === 39) { fg = null; continue }
      if (p === 49) { bg = null; continue }
      if (p === 38 || p === 48) {
        const mode = params[i + 1]
        let value = null
        if (mode === 2) {
          value = rgbHex(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0)
          i += 4
        } else if (mode === 5) {
          value = xterm256(params[i + 2] ?? 0)
          i += 2
        } else {
          i += 1
        }
        if (value !== null) { if (p === 38) fg = value; else bg = value }
        continue
      }
      if (p >= 30 && p <= 37) { fg = BASE16[p - 30]; continue }
      if (p >= 90 && p <= 97) { fg = BASE16[p - 90 + 8]; continue }
      if (p >= 40 && p <= 47) { bg = BASE16[p - 40]; continue }
      if (p >= 100 && p <= 107) { bg = BASE16[p - 100 + 8]; continue }
      // 1/bold, 2/dim, 4/underline, 7/reverse, 22, 24... are not asserted.
    }
    last = re.lastIndex
  }
  push(row.slice(last))
  return runs
}
const runsText = (runs) => runs.map((r) => r.text).join('')
/** First non-null fg of a run whose text contains `needle` (exact codepoint). */
function fgAt(runs, needle) {
  for (const run of runs) if (run.fg !== null && run.text.includes(needle)) return run.fg
  return null
}
const hasItalicRun = (runs, needle) => runs.some((run) => run.italic && run.text.includes(needle))

function rgbOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!m) return null
  const n = m[1]
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}
function luminance(hex) {
  const rgb = rgbOf(hex)
  if (!rgb) return 0
  const ch = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2])
}
function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
function colorDistance(a, b) {
  const x = rgbOf(a)
  const y = rgbOf(b)
  if (!x || !y) return Infinity
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}
/** Blue-hue + saturation test (the activity fg contract is a blue family). */
function looksBlue(hex) {
  const rgb = rgbOf(hex)
  if (!rgb) return false
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (max === 0 || delta / max < 0.25) return false
  let hue
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  hue = (hue * 60 + 360) % 360
  return b > r && b >= g && hue >= 190 && hue <= 250
}

// ---------------------------------------------------------------------------
// scratch home + mock LLM
// ---------------------------------------------------------------------------

const HOME = mkdtempSync(join(tmpdir(), 'dsh-ui-matrix-home-'))
chmodSync(HOME, 0o700)
const WS = mkdtempSync(join(tmpdir(), 'dsh-ui-matrix-ws-'))
// Long path: the composer context row must clip from the LEFT and keep the
// tail, at 45 columns in particular.
const WS_DEEP = join(WS, 'a-very-long-directory-name-for-left-truncation', 'another-deeply-nested-segment-name', 'workspace-tail-uim')
mkdirSync(WS_DEEP, { recursive: true })

mkdirSync(join(HOME, 'profiles'), { recursive: true })
cpSync(join(REAL_HOME, 'profiles', PROFILE), join(HOME, 'profiles', PROFILE), { recursive: true })
for (const rel of ['.credentials.yaml', 'models-store.json', 'model-profiles.json', 'workspace-presets.json', 'settings.yaml', 'agents', 'themes']) {
  const from = join(REAL_HOME, rel)
  if (existsSync(from)) cpSync(from, join(HOME, rel), { recursive: true })
}
// Deterministic, offline model: point the pinned provider route at the local
// mock and give the model a real context window so the 🧠 segment can paint
// the compact `(x.x%)` form.
const AGENTS_HOME = join(HOME, 'agents-home')
const fixtureDir = join(AGENTS_HOME, 'skills', FIXTURE_SKILL)
mkdirSync(fixtureDir, { recursive: true })
writeFileSync(join(fixtureDir, 'SKILL.md'),
  `---\nname: ${FIXTURE_SKILL}\ndescription: ui-matrix fixture skill (italic palette row)\n---\n\n# ${FIXTURE_SKILL}\n`)

const profileConfigPath = join(HOME, 'profiles', PROFILE, 'config.json')
const patchPath = join(HOME, 'profiles', PROFILE, 'cordis.patch.yml')
{
  let patch = readFileSync(patchPath, 'utf8')
  const withUrl = patch.replace(/(\n {6}zai-coding-cn:\n)/, `$1        baseURL: http://127.0.0.1:${PORT}/v1\n`)
  if (withUrl === patch) {
    console.error('ui-matrix: could not patch provider baseURL into the scratch profile')
    process.exit(2)
  }
  patch = withUrl
  const withWindow = patch.replace(
    /(\n {10}- id: glm-5\.3-flash\n {12}name: glm-5\.3-flash\n)/,
    `$1            contextWindow: 200000\n`,
  )
  if (withWindow === patch) {
    console.error('ui-matrix: could not patch contextWindow into the scratch profile')
    process.exit(2)
  }
  // Deterministic route: re-pin the default model selection to the mocked
  // provider inside the SCRATCH patch (the operator's real profile may or
  // may not carry the agent-default-model row; the host catalog default is
  // not stable across environments and would send real requests).
  patch = withWindow
  if (!/agent-default-model/.test(patch)) {
    patch += [
      '',
      '# ui-matrix: pin the default route to the mocked provider.',
      '- id: agent-default-model',
      '  name: "@deepseek-ai/dsh-agent-default-model"',
      '  config:',
      '    provider: zai-coding-cn',
      '    model: glm-5.3-flash',
      '    reasoningEffort: high',
      '',
    ].join('\n')
  }
  writeFileSync(patchPath, patch)
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
async function startMock() {
  const log = join(OUT, 'mock-llm.log')
  const fd = (await import('node:fs')).openSync(log, 'w')
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

// ---------------------------------------------------------------------------
// tmux driving + pane parsing
// ---------------------------------------------------------------------------

const capture = (session = SESS, ansi = false) => {
  const args = ['capture-pane', '-p', '-t', session]
  if (ansi) args.push('-e')
  return tmuxOut(...args)
}
const sendKeys = (session, ...keys) => tmux('send-keys', '-t', session, ...keys)
const typeText = async (session, text) => {
  for (const ch of text) { sendKeys(session, '-l', ch); await sleep(TYPE_GAP_MS) }
}
const typeFast = async (session, text) => {
  sendKeys(session, '-l', text)
  await sleep(60)
}
const composerRows = (out) =>
  out.split('\n')
    .filter((l) => l.trimStart().startsWith('┃'))
    .map((l) => l.trim().replace(/^┃/, '').replace(/┃$/, '').trim())
const composerEmpty = (out) => composerRows(out).every((l) => l === '' || l.startsWith(PLACEHOLDER))
const idle = (out) => out.includes(IDLE) || composerEmpty(out)
const waitPane = async (session, pred, timeoutMs, everyMs = 250) => {
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
const submit = async (session, text) => {
  await typeText(session, text)
  await sleep(250)
  sendKeys(session, 'Enter')
}
const snap = (name, session = SESS) => {
  writeFileSync(join(OUT, `${name}.ans`), capture(session, true))
  writeFileSync(join(OUT, `${name}.txt`), capture(session))
  return capture(session)
}
const launch = (session, cols, rows, cwd) => {
  tmux('kill-session', '-t', session)
  const env = [
    `DSH_HOME=${HOME}`,
    `DSH_AGENTS_HOME=${AGENTS_HOME}`,
    'DSH_OPENTUI_DEBUG=1',
    'ZAI_CODING_CN_API_KEY=mock-only-key',
    'ZAI_CODING_CN_BASE_URL=',
  ]
  const r = tmux('new-session', '-d', '-x', String(cols), '-y', String(rows), '-s', session, '-c', cwd,
    `${env.join(' ')} ${LAUNCHER} --client 2>${join(OUT, `${session}.err.log`)}`)
  if (r.status !== 0) throw new Error('tmux boot failed: ' + r.stderr)
}
const killSession = (session) => tmux('kill-session', '-t', session)

// ---------------------------------------------------------------------------
// assertions
// ---------------------------------------------------------------------------

const results = []
let currentGeom = ''
/**
 * `known` marks a contract violation that is a PRODUCT defect (listed in the
 * summary's `productIssues`), not a harness failure: it prints as XFAIL and
 * does not fail the gate. Everything else must be green.
 */
const record = (scene, item, ok, detail = [], { known = false } = {}) => {
  const status = ok ? 'PASS' : known ? 'XFAIL' : 'FAIL'
  const entry = { geom: currentGeom, scene, item, ok, known: !ok && known, detail }
  results.push(entry)
  const tag = `${currentGeom} ${scene}`
  console.log(`${status.padEnd(5)} ${tag} — ${item}${detail.length ? `\n        ${detail.join('\n        ')}` : ''}`)
}
/** Failure detail in the expected/actual/snippet shape. */
const failDetail = (expected, actual, frame, needle) => {
  const lines = String(frame).split('\n')
  const at = needle ? lines.findIndex((l) => stripAnsi(l).includes(needle)) : -1
  const slice = (at >= 0 ? lines.slice(Math.max(0, at - 2), at + 3) : lines.slice(-8))
    .map((l) => stripAnsi(l).replace(/ +$/g, ''))
  return [`expected: ${expected}`, `actual:   ${actual}`, `snippet:  ${JSON.stringify(slice)}`]
}

// ---------------------------------------------------------------------------
// scene bodies (each gets the geometry + a live session)
// ---------------------------------------------------------------------------

const dockLineCap = (rows) => (rows <= 40 ? 1 : rows <= 50 ? 2 : 3)

async function sceneBlank(session, geom) {
  const frame = capture(session)
  const plain = stripAnsi(frame)
  const noHistory = !plain.includes('❯') && !has(plain, 'Loading session history')
  const noResume = !plain.includes('resumed ')
  record('blank', 'a fresh session paints no history and no resume notice', noHistory && noResume,
    (noHistory && noResume) ? ['empty transcript'] : failDetail('no ❯ / Loading / resumed', `history=${!noHistory} resume=${!noResume}`, frame))
  const placeholder = composerRows(plain).some((l) => l.startsWith(PLACEHOLDER))
  record('blank', 'the composer shows its placeholder', placeholder,
    placeholder ? [`row: ${JSON.stringify(PLACEHOLDER)}`] : failDetail('composer placeholder row', `composerRows=${JSON.stringify(composerRows(plain))}`, frame, '┃'))
}

/** The one row directly above the composer box (full frame skips the top border). */
function contextRow(frame) {
  const lines = stripAnsi(frame).split('\n')
  const first = lines.findIndex((l) => l.trimStart().startsWith('┃'))
  if (first < 1) return ''
  let i = first - 1
  while (i >= 0 && /^[┏━┳┓┌─┬┐╭╮]+$/.test(lines[i].trim())) i--
  return (lines[i] ?? '').trim()
}

async function sceneContextRow(session, geom) {
  const row = contextRow(capture(session))
  const tail = 'workspace-tail-uim'
  const keepsTail = row.includes(tail)
  const oneRow = !row.includes('\n')
  const within = widthOf(row) <= geom.cols - 1
  record('context', 'the row above the input keeps the path tail and stays one clipped row',
    keepsTail && oneRow && within,
    (keepsTail && oneRow && within)
      ? [`row: ${JSON.stringify(row)}`, `columns: ${widthOf(row)}/${geom.cols}`]
      : failDetail(`row contains "${tail}", width ≤ ${geom.cols - 1}`, `row=${JSON.stringify(row)} width=${widthOf(row)}`, capture(session), tail))
}

/** Footer = the single row carrying the powerline arrows (U+E0B0). */
function footerRow(frame) {
  return stripAnsi(frame).split('\n').filter((l) => l.includes('\ue0b0'))
}

async function sceneFooter(session, geom, { compact = true } = {}) {
  const frame = capture(session)
  const plainRows = stripAnsi(frame).split('\n')
  const arrowIdx = plainRows.map((l, i) => (l.includes('\ue0b0') ? i : -1)).filter((i) => i >= 0)
  const rows = arrowIdx.map((i) => plainRows[i])
  record('footer', 'the footer is one row and never wraps', rows.length === 1,
    rows.length === 1 ? [`width: ${widthOf(rows[0])}/${geom.cols}`] : failDetail('exactly one powerline row', `${rows.length} rows`, frame, '\ue0b0'))
  // Structural no-wrap check: between the powerline and the hint row there
  // must be no continuation row. A strip wider than the terminal wraps its
  // segment labels onto extra rows (the 80/45-column failure).
  const lastArrow = arrowIdx.at(-1) ?? -1
  const hintIdx = plainRows.findIndex((l, i) => i > lastArrow && l.includes('⌨'))
  const between = lastArrow >= 0 && hintIdx > lastArrow
    ? plainRows.slice(lastArrow + 1, hintIdx).filter((l) => l.trim() !== '')
    : []
  record('footer', 'the powerline strip occupies one row (no wrapped continuation)',
    between.length === 0,
    between.length === 0 ? ['no continuation rows']
      : failDetail('0 continuation rows', `${between.length}: ${JSON.stringify(between.map((l) => l.trim()))}`, frame, '\ue0b0'))
  const row = rows[0] ?? ''
  const within = widthOf(row) <= geom.cols
  record('footer', 'every segment stays inside the terminal width', within,
    within ? [`width: ${widthOf(row)}/${geom.cols}`] : failDetail(`width ≤ ${geom.cols}`, `width=${widthOf(row)}`, frame, '\ue0b0'))
  const parts = row.split('\ue0b0').map((s) => s.trim()).filter(Boolean)
  record('footer', 'segments do not overlap (each arrow splits one label)', parts.length >= 2 && parts.every((p) => p.length > 0),
    [`segments: ${JSON.stringify(parts)}`])
  const at = row.indexOf('🧠')
  const segment = (at >= 0 ? row.slice(at) : '').split('\ue0b0')[0] ?? ''
  if (!compact) {
    // Before a turn bills tokens the segment degrades to the bare `🧠 used`
    // shape (no window → no percent).
    const bare = /^🧠 \S+$/.test(segment.trim())
    record('footer', 'the 🧠 segment degrades to the bare `🧠 used` shape with no window',
      bare, bare ? [`segment: ${JSON.stringify(segment.trim())}`]
        : failDetail('🧠 <used>', `segment=${JSON.stringify(segment.trim())}`, frame, '🧠'))
    return
  }
  // 🧠 compact form may be clipped at 45 cols; the inner spacing law holds
  // for the visible prefix: `used/window(x.x%)`, no space inside the parens.
  const compactOk = /\d+(?:\.\d+[kM])?\/\d+(?:\.\d+[kM])?\(\d+\.\d%/.test(segment)
  const noInnerSpace = !/\d\s+%|\(\s|\s\)/.test(segment)
  record('footer', 'the 🧠 segment is the compact `used/window(x.x%)` form with no stray spaces',
    compactOk && noInnerSpace,
    (compactOk && noInnerSpace) ? [`segment: ${JSON.stringify(segment.trim())}`]
      : failDetail('🧠 <used>/<window>(x.x%) with no inner spaces', `segment=${JSON.stringify(segment.trim())}`, frame, '🧠'))
}

function focusFrame(frame) {
  const lines = stripAnsi(frame).split('\n')
  const light = lines.find((l) => /^┌[─]* transcript /.test(l.trim())) ?? ''
  const heavy = lines.find((l) => /^┏[━]* transcript /.test(l.trim())) ?? ''
  return { lines, light, heavy }
}

async function sceneFocus(session, geom, ansiCapture) {
  const compact = geom.rows <= 30
  let frame = capture(session)
  let ansi = capture(session, true)
  const start = focusFrame(frame)
  const startAnsiLines = ansi.split('\n')
  if (compact) {
    const tops = stripAnsi(ansi).split('\n').filter((l) => l.includes('┏'))
    // Transcript vertical rules: a full-width row of nothing but border
    // glyphs + spaces ("┃        ┃"), distinct from the composer row which
    // carries the placeholder text.
    const ruleLine = startAnsiLines.find((l) => /^[│┃]\s*[│┃]$/.test(stripAnsi(l).trim())) ?? ''
    const ruleChar = stripAnsi(ruleLine).trim().charAt(0)
    const fg = ruleLine ? fgAt(sgrRuns(ruleLine), ruleChar) : null
    record('focus', 'compact: the unfocused transcript draws left/right rules only (no top row)',
      tops.length === 0 && ruleLine !== '' && ruleChar === '│' && fg !== null && colorDistance(fg, THEME.borderBase) < 24,
      ruleLine !== ''
        ? [`rule: ${JSON.stringify(stripAnsi(ruleLine).trim().slice(0, 3))}`, `fg: ${fg} (border.base ${THEME.borderBase})`]
        : failDetail('│…│ transcript rule', 'missing', frame, '│'))
  } else {
    const fg = start.light ? fgAt(sgrRuns(startAnsiLines.find((l) => stripAnsi(l).includes(' transcript ')) ?? ''), '─') : null
    record('focus', 'unfocused transcript: single frame + border.base color',
      start.light !== '' && start.heavy === '' && fg !== null && colorDistance(fg, THEME.borderBase) < 24,
      start.light !== ''
        ? [`fg: ${fg} (border.base ${THEME.borderBase})`]
        : failDetail('┌─ transcript ─ top border', `light=${!!start.light} heavy=${!!start.heavy}`, frame, 'transcript'))
  }

  sendKeys(session, 'F6')
  await sleep(500)
  frame = capture(session)
  ansi = capture(session, true)
  const ansiLines = ansi.split('\n')
  if (compact) {
    const tops = stripAnsi(ansi).split('\n').filter((l) => l.includes('┏'))
    const ruleLine = ansiLines.find((l) => /^[│┃]\s*[│┃]$/.test(stripAnsi(l).trim())) ?? ''
    const ruleChar = stripAnsi(ruleLine).trim().charAt(0)
    const fg = ruleLine ? fgAt(sgrRuns(ruleLine), ruleChar) : null
    record('focus', 'compact: F6 focuses the transcript without spending a top row, heavy + accent',
      tops.length === 0 && ruleLine !== '' && ruleChar === '┃' && fg !== null && colorDistance(fg, THEME.interactive500) < 24,
      ruleLine !== ''
        ? [`rule: ${JSON.stringify(stripAnsi(ruleLine).trim().slice(0, 3))}`, `fg: ${fg} (interactive.500 ${THEME.interactive500})`]
        : failDetail('┃…┃ transcript rule', 'missing', frame, '┃'))
  } else {
    const heavyLine = ansiLines.find((l) => /^┏[━]* transcript /.test(stripAnsi(l).trim()))
    const fg = heavyLine ? fgAt(sgrRuns(heavyLine), '━') : null
    record('focus', 'F6 focuses the transcript: heavy frame + accent color',
      heavyLine !== undefined && fg !== null && colorDistance(fg, THEME.interactive500) < 24,
      heavyLine ? [`fg: ${fg} (interactive.500 ${THEME.interactive500})`]
        : failDetail('┏━ transcript ━ top border in accent', `heavy=${!!heavyLine} fg=${fg}`, frame, 'transcript'))
  }
  sendKeys(session, 'F6')
  await sleep(400)
}

const menuNames = (out) => composerRows(out).filter((l) => /^\/[a-z]/.test(l))

async function sceneSlash(session, geom, ansiCapture) {
  await typeText(session, '/')
  await sleep(700)
  const frame = capture(session)
  const ansi = capture(session, true)
  const names = menuNames(frame)
  record('slash', 'the palette paints the full 10-row window', names.length === 10,
    names.length === 10 ? [`10 rows, first ${JSON.stringify(names[0])}`] : failDetail('10 slash rows', `${names.length}: ${JSON.stringify(names)}`, frame, '┃'))
  const hint = /…\s*(\d+)\s*more/.exec(composerRows(frame).join('\n'))
  record('slash', 'more matches than fit report `… N more`', hint !== null,
    hint ? [`hint: "… ${hint[1]} more"`] : failDetail('… N more hint', 'no hint', frame, '…'))

  sendKeys(session, 'NPage')
  await sleep(350)
  sendKeys(session, 'NPage')
  await sleep(600)
  const scrolled = capture(session)
  const above = /…\s*(\d+)\s*more above/.exec(composerRows(scrolled).join('\n'))
  const firstChanged = menuNames(scrolled)[0] !== names[0]
  record('slash', 'PgDn scrolls the window and reports `… N more above`',
    above !== null && firstChanged,
    (above !== null && firstChanged)
      ? [`first: ${JSON.stringify(names[0])} → ${JSON.stringify(menuNames(scrolled)[0])}`, `hint: "… ${above[1]} more above"`]
      : failDetail('window moved + … N more above', `moved=${firstChanged} hint=${above ? above[1] : 'none'}`, scrolled, '…'))

  sendKeys(session, 'End')
  await sleep(600)
  const endFrame = capture(session)
  const endAnsi = capture(session, true)
  const endNames = menuNames(endFrame)
  const skillRowPlain = endFrame.split('\n').find((l) => l.includes(`/${FIXTURE_SKILL}`)) ?? ''
  const skillRowAnsi = endAnsi.split('\n').find((l) => stripAnsi(l).includes(`/${FIXTURE_SKILL}`)) ?? ''
  const runs = sgrRuns(skillRowAnsi)
  const italic = hasItalicRun(runs, `/${FIXTURE_SKILL}`)
  record('slash', 'End reaches the fixture skill row and its SGR carries the italic attribute (exactly 3)',
    skillRowPlain.includes(`/${FIXTURE_SKILL}`) && italic,
    [skillRowPlain
      ? `row: ${JSON.stringify(stripAnsi(skillRowPlain).trim())}`
      : `last row: ${JSON.stringify(endNames.at(-1) ?? '')}`,
      `italic SGR(3): ${italic}`].slice(0, italic ? 1 : 2))
  for (let i = 0; i < 2; i++) { sendKeys(session, 'Escape'); await sleep(300) }
  // The palette leaves the typed "/" in the editor; clear it so the next
  // scene sends a prompt, not an unknown slash command.
  sendKeys(session, 'BSpace')
  await sleep(250)
}

async function sceneContent(session, geom) {
  await submit(session, 'Render the markdown sample. E2E_MD_TRIGGER')
  const done = await waitPane(session, (o) => o.includes('E2E-MD-TURN-DONE'), 45_000)
  await sleep(1200) // one render tick past settlement (code block streaming → final)
  // Scroll the transcript to the top so the user box + heading + code frame
  // are all inspectable at every geometry (the tail is the closing line).
  sendKeys(session, 'F6')
  await sleep(350)
  sendKeys(session, 'Home')
  await sleep(450)
  let frame = capture(session)
  let lines = stripAnsi(frame).split('\n')
  let userIdx = lines.findIndex((l) => l.includes('❯ Render the markdown sample.'))
  // A narrow terminal wraps the user text, so the frame borders sit up to a
  // few rows away from the ❯ row (the top border is above the FIRST wrapped
  // content row, not necessarily directly above ❯).
  const framed = userIdx >= 0 &&
    lines.slice(Math.max(0, userIdx - 5), userIdx).some((l) => l.includes('┌')) &&
    lines.slice(userIdx + 1, userIdx + 6).some((l) => l.includes('└'))
  record('content', 'a user message paints inside a single-line frame with the `❯` prompt',
    userIdx >= 0 && framed,
    userIdx >= 0 ? [`frame: ${framed ? '┌ … └ around the ❯ row' : 'missing'}`]
      : failDetail('❯ prompt row inside a frame', 'missing', frame, 'Report'))
  record('content', 'the assistant markdown lands in the transcript', done.ok && lines.some((l) => l.includes('Report Heading One')),
    done.ok ? ['heading visible at the top'] : failDetail('assistant reply', 'missing', frame, 'Report'))
  // Final fenced block: single frame with the language title in the top
  // border. Scroll down until BOTH the title row and the code body are in
  // the viewport — stopping at the title alone can leave the body one row
  // below the fold (the frame lands on the last visible row).
  let codeFrame = ''
  let codeBody = false
  for (let i = 0; i < 16 && !(codeFrame !== '' && codeBody); i++) {
    const plain = stripAnsi(capture(session))
    const candidate = plain.split('\n').find((l) => /┌[─]*\sts\s[─]*┐/.test(l.trim()))
    if (candidate) codeFrame = candidate
    codeBody = plain.split('\n').some((l) => l.includes('function greet'))
    if (codeFrame !== '' && codeBody) break
    for (let k = 0; k < 2; k++) { sendKeys(session, 'Down'); await sleep(70) }
    await sleep(200)
  }
  record('content', 'the final code block keeps its single frame and language title',
    codeFrame !== '' && codeBody,
    codeFrame !== '' ? [`title row: ${JSON.stringify(codeFrame.trim().slice(0, 48))}`]
      : failDetail('┌─ ts ─┐ frame with the code body', `body=${codeBody}`, capture(session), 'function greet'))
  sendKeys(session, 'End')
  await sleep(300)
  sendKeys(session, 'F6')
  await sleep(300)
  await waitPane(session, idle, 15_000)
  const quiet = capture(session)
  record('content', 'the settled transcript drops the live think panel', !stripAnsi(quiet).includes('💭 thinking'),
    [!stripAnsi(quiet).includes('💭 thinking') ? 'no live think rows' : 'live think row still painted'])
}

async function sceneBusy(session, geom) {
  // Busy turn: the mock's main-slow phase keeps the line running ~42s.
  await typeFast(session, 'Walk the migration plan step by step. E2E_BTW_MAIN')
  sendKeys(session, 'Enter')
  await sleep(900)
  await typeFast(session, 'queued line one')
  sendKeys(session, 'Enter')
  const popup = await waitPane(session, (o) => has(o, 'steer or queue'), 20_000)
  record('busy', 'a second Enter while a turn runs opens the steer/queue choice', popup.ok,
    popup.ok ? ['choice visible'] : failDetail('steer or queue dialog', 'missing', popup.out))
  if (popup.ok) {
    sendKeys(session, 'Down')
    await sleep(150)
    sendKeys(session, 'Enter')
  }
  const queued = await waitPane(session, (o) => has(o, '排队等待') && has(o, '#1'), 10_000)
  const queueAnsi = capture(session, true)
  const queueLine = queueAnsi.split('\n').find((l) => stripAnsi(l).includes('排队等待')) ?? ''
  const queueRuns = sgrRuns(queueLine)
  const queueFg = fgAt(queueRuns, '⏸')
  record('busy', 'Queue paints `⏸ 排队等待 #1` in muted italic (SGR 3)',
    queued.ok && hasItalicRun(queueRuns, '排队等待') && queueFg !== null && colorDistance(queueFg, THEME.textMuted) < 24,
    queued.ok
      ? [`fg: ${queueFg} (text.muted ${THEME.textMuted})`, `italic: ${hasItalicRun(queueRuns, '排队等待')}`]
      : failDetail('⏸ 排队等待 #1', 'missing', queued.out, '排队'))
  sendKeys(session, 'Escape')
  const paused = await waitPane(session, (o) => has(o, '已暂停') && has(o, '#1'), 12_000)
  record('busy', 'aborting the turn keeps the queue and marks it paused', paused.ok,
    paused.ok ? ['⏸ 已暂停 #1 visible'] : failDetail('⏸ 已暂停 #1', 'missing', paused.out, '暂停'))
  await waitPane(session, idle, 20_000)
}

async function sceneSteer(session, geom) {
  await typeFast(session, 'Walk the migration plan again. E2E_BTW_MAIN')
  sendKeys(session, 'Enter')
  await sleep(900)
  await typeFast(session, 'say hello in one word')
  sendKeys(session, 'Enter')
  const popup = await waitPane(session, (o) => has(o, 'steer or queue'), 20_000)
  if (popup.ok) { sendKeys(session, 'Enter'); await sleep(200) }
  const injected = await waitPane(session, (o) => has(o, '已注入当前回合'), 10_000)
  const ansi = capture(session, true)
  const row = ansi.split('\n').find((l) => stripAnsi(l).includes('已注入当前回合')) ?? ''
  const runs = sgrRuns(row)
  const fg = fgAt(runs, '⤵')
  const italic = hasItalicRun(runs, '已注入')
  record('busy', 'Steer paints `⤵ 已注入当前回合` in the brand text color',
    popup.ok && injected.ok && fg !== null && colorDistance(fg, THEME.textBase) < 24,
    injected.ok ? [`fg: ${fg} (text.action.primary.base ${THEME.textBase})`, `italic: ${italic}`]
      : failDetail('⤵ 已注入当前回合', 'missing', injected.out, '注入'))
  sendKeys(session, 'Escape')
  await sleep(350)
  sendKeys(session, 'Escape')
  const delivered = await waitPane(session, (o) => has(o, '已投递'), 25_000)
  const deliveredAnsi = capture(session, true)
  const deliveredRow = deliveredAnsi.split('\n').find((l) => stripAnsi(l).includes('已投递')) ?? ''
  const deliveredFg = fgAt(sgrRuns(deliveredRow), '✓')
  record('busy', 'the steer receipt flips to `✓ 已投递` at turn end',
    delivered.ok && deliveredFg !== null && colorDistance(deliveredFg, THEME.textBase) < 24,
    delivered.ok ? [`fg: ${deliveredFg}`] : failDetail('✓ 已投递', 'missing', delivered.out, '投递'))
  await waitPane(session, idle, 20_000)
}

async function sceneActivity(session, geom) {
  // Live turn: assertions must read the busy frame, so poll while it runs.
  await typeFast(session, 'Walk the migration plan one more time. E2E_BTW_MAIN')
  sendKeys(session, 'Enter')
  let frameLine = ''
  let frameFg = null
  let ruleLine = ''
  const deadline = Date.now() + 6_000
  while (Date.now() < deadline) {
    const ansi = capture(session, true)
    const lines = ansi.split('\n')
    const activity = lines.find((l) => /^┏[━]*\s*activity/.test(stripAnsi(l).trim()))
    if (activity) {
      frameLine = activity
      frameFg = fgAt(sgrRuns(activity), '━')
    }
    const rule = lines.find((l) => stripAnsi(l).includes('┃ activity'))
    if (rule) ruleLine = rule
    if (frameLine || ruleLine) break
    await sleep(120)
  }
  if (geom.rows > 30) {
    const fg = frameFg ?? (frameLine ? fgAt(sgrRuns(frameLine), '━') : null)
    const ratio = fg ? contrast(fg, THEME.background) : 0
    record('activity', 'the turn activity frame draws a heavy border in the theme blue (contrast ≥ 6:1)',
      frameLine !== '' && fg !== null && looksBlue(fg) && ratio >= ACTIVITY_MIN_CONTRAST,
      frameLine !== ''
        ? [`fg: ${fg} (dsh-blue blue.200 ${THEME.activityBlue})`, `contrast: ${ratio.toFixed(2)}:1`]
        : failDetail('┏━ activity frame', 'missing', capture(session), 'activity'))
  } else {
    record('activity', 'compact: the activity frame collapses to a `┃ activity` left rule (zero top rows)',
      ruleLine !== '',
      ruleLine !== '' ? [`rule: ${JSON.stringify(stripAnsi(ruleLine).trim().slice(0, 40))}`]
        : failDetail('┃ activity rule', 'missing', capture(session), 'activity'))
  }
  sendKeys(session, 'Escape')
  await sleep(350)
  sendKeys(session, 'Escape')
  await waitPane(session, idle, 25_000)
}

async function sceneThink(session, geom) {
  const cap = dockLineCap(geom.rows)
  await typeFast(session, 'Reason about the plan first. E2E_THINK_TRIGGER')
  sendKeys(session, 'Enter')
  let thinkRows = 0
  let sample = ''
  let bestAnsi = ''
  const deadline = Date.now() + 6_000
  while (Date.now() < deadline) {
    const ansi = capture(session, true)
    const think = ansi.split('\n').filter((l) => /💭 (thinking|thought)/.test(stripAnsi(l)))
    if (think.length > thinkRows) {
      thinkRows = think.length
      sample = think.map((l) => stripAnsi(l).trim()).join(' / ')
      bestAnsi = ansi
    }
    if (thinkRows >= cap) break
    await sleep(100)
  }
  const thinkLine = bestAnsi.split('\n').find((l) => /💭 (thinking|thought)/.test(stripAnsi(l))) ?? ''
  const thinkRuns = sgrRuns(thinkLine)
  record('think', `the live think block never exceeds its ${cap}-line cap (geometry ${geom.rows} rows)`,
    thinkRows >= 1 && thinkRows <= cap,
    thinkRows >= 1 ? [`rows: ${thinkRows} (cap ${cap})`, `sample: ${sample.slice(0, 80)}`]
      : failDetail(`1..${cap} 💭 rows`, `${thinkRows}`, capture(session), '💭'))
  record('think', 'the think block text carries the italic treatment',
    hasItalicRun(thinkRuns, '💭') || thinkRuns.some((r) => r.italic),
    [`italic: ${thinkRuns.some((r) => r.italic)}`])
  await waitPane(session, idle, 25_000)
}

async function sceneTool(session, geom) {
  // A live tool row (ask_user_question) opens the ask overlay; the dock is
  // covered while the dialog is up, so answer the batch (Enter through the
  // three questions, then the review row) and read the tool line as the turn
  // settles.
  await typeFast(session, 'Ask me three questions. E2E_ASK_TRIGGER')
  sendKeys(session, 'Enter')
  const cap = dockLineCap(geom.rows)
  const ask = await waitPane(session, (o) => /Question \(1\/3\)|Review answers/.test(o), 20_000)
  if (ask.ok) {
    for (let i = 0; i < 3; i++) { sendKeys(session, 'Enter'); await sleep(350) }
    sendKeys(session, 'Down') // from the multiSelect option list to "⏎ Review answers"
    await sleep(200)
    sendKeys(session, 'Enter')
    await sleep(350)
    // The review page exposes "⏎ Submit answers" as its last row. Settle it
    // deterministically: keep nudging the selection down + Enter until the
    // dialog leaves the pane (the old single End+Enter left the overlay up,
    // hiding the dock row the check reads).
    for (let i = 0; i < 8; i++) {
      const pane = stripAnsi(capture(session))
      if (!/Review answers|Question \(\d\/\d\)/.test(pane)) break
      sendKeys(session, 'Down')
      await sleep(120)
      sendKeys(session, 'Enter')
      await sleep(350)
    }
  }
  let toolRows = 0
  let sample = ''
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const frame = capture(session)
    const rows = stripAnsi(frame).split('\n').filter((l) => /[⚙✔✘]\s*ask_user_question/.test(l))
    if (rows.length > 0) {
      toolRows = rows.length
      sample = rows[0].trim().slice(0, 100)
      break
    }
    await sleep(150)
  }
  record('tool', 'a running tool paints one dock line inside the activity slot (never more than the cap)',
    toolRows >= 1 && toolRows <= Math.max(cap, 1),
    toolRows >= 1 ? [`${toolRows} tool row(s), cap ${cap}`, `line: ${JSON.stringify(sample)}`]
      : failDetail('⚙ ask_user_question dock line', 'missing', capture(session), 'activity'))
  snap(`${geom.label}-03-tool`, session)
  // The dock line must fit its column band: a wider line wraps INTO the
  // frame border instead of clipping (the narrow-terminal failure).
  const dockRow = stripAnsi(capture(session)).split('\n').find((l) => l.includes('ask_user_question')) ?? ''
  const dockFits = dockRow !== '' && widthOf(dockRow) <= geom.cols && !/[┗┛]/.test(dockRow)
  record('tool', 'the dock line stays inside its width (no wrap into the frame border)',
    dockFits,
    dockFits ? [`width: ${widthOf(dockRow)}/${geom.cols}`]
      : failDetail(`one row ≤ ${geom.cols} columns, no frame glyph interleaved`,
        `row=${JSON.stringify(dockRow.slice(0, 90))} width=${widthOf(dockRow)}`, capture(session), 'ask_user_question'))
  for (let i = 0; i < 2; i++) { sendKeys(session, 'Escape'); await sleep(300) }
  await waitPane(session, idle, 20_000)
  if (!idle(capture(session))) { sendKeys(session, 'Escape'); await sleep(500) }
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

let crashed = null
try {
  await startMock()
  console.log(`ui-matrix: mock LLM on 127.0.0.1:${PORT}; scratch home ${HOME}`)
  console.log(`ui-matrix: geometries ${GEOMS.map((g) => g.label).join(' · ')}`)

  for (const geom of GEOMS) {
    if (ONLY && geom.label !== ONLY) continue
    currentGeom = geom.label
    const session = `${SESS}-${geom.label}`
    console.log(`\n=== ${geom.label} (${geom.cols}x${geom.rows}) ===`)
    launch(session, geom.cols, geom.rows, WS_DEEP)
    const boot = await waitPane(session, (o) => o.includes('🧠') || idle(o), 90_000, 500)
    if (!boot.out.includes('🧠') && !idle(boot.out)) {
      record('boot', 'the client renders', false, failDetail('a rendered frame', 'blank', boot.out))
      killSession(session)
      continue
    }
    await waitPane(session, idle, 30_000)
    snap(`${geom.label}-01-blank`, session)

    await sceneBlank(session, geom)
    await sceneContextRow(session, geom)
    await sceneFooter(session, geom, { compact: false })
    await sceneFocus(session, geom, true)
    await sceneSlash(session, geom, true)
    // The ask/tool scene must run before any other trigger text enters the
    // transcript: the shared mock keys phases on the whole request body (which
    // carries the history), and its ask branch is the last one checked.
    await sceneTool(session, geom)
    await sceneContent(session, geom)
    snap(`${geom.label}-02-content`, session)
    // Footer context segment is only painted once a turn billed tokens.
    await waitPane(session, (o) => o.includes('🧠') && /\/\S*\(\d/.test(o), 10_000, 300)
    await sceneFooter(session, geom)
    // Think BEFORE the main-slow turn: the shared mock keys phases on the
    // whole body and checks `E2E_BTW_MAIN` first, so once that marker is in
    // the transcript every later request would be served as main-slow.
    await sceneThink(session, geom)
    await sceneActivity(session, geom)
    await sceneBusy(session, geom)
    await sceneSteer(session, geom)
    snap(`${geom.label}-09-end`, session)

    await submit(session, '/quit')
    const quit = await waitPane(session, () => tmux('has-session', '-t', session).status !== 0, 15_000)
    if (!quit.ok) killSession(session)
    reapHost()
    await sleep(400)
  }

  const failedSoFar = results.filter((r) => !r.ok && !r.known)
  if (failedSoFar.length === 0) {
    // Only the crash scan is meaningful if every scene passed.
    const errLog = (() => { try { return readFileSync(join(OUT, `${SESS}-${GEOMS[0].label}.err.log`), 'utf8') } catch { return '' } })()
    const crash = /TypeError|ReferenceError|Cannot read propert|Unhandled|panic/i.exec(errLog)
    record('crash', 'no crash markers in the client stderr', crash === null, [crash ? crash[0] : 'clean'])
  }
} catch (error) {
  crashed = error
  console.error('ui-matrix: run failed:', error?.stack ?? error)
  results.push({ geom: currentGeom, scene: 'harness', item: 'harness completed', ok: false, detail: [String(error).slice(0, 400)] })
} finally {
  for (const geom of GEOMS) killSession(`${SESS}-${geom.label}`)
  reapHost()
  stopMock()
  const failed = results.filter((r) => !r.ok && !r.known)
  const knownIssues = results.filter((r) => !r.ok && r.known)
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({
    geometries: GEOMS.map((g) => `${g.cols}x${g.rows}`),
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: failed.length,
    productIssues: knownIssues.map((r) => ({ geom: r.geom, scene: r.scene, item: r.item, detail: r.detail })),
    results,
    crashed: crashed ? String(crashed) : null,
  }, null, 2))
  console.log(`\nui-matrix: ${results.length - failed.length - knownIssues.length}/${results.length} checks passed, ` +
    `${failed.length} failed, ${knownIssues.length} product issues (xfail) — ${GEOMS.length} geometries`)
  if (knownIssues.length > 0) {
    console.log('product issues (not caused by the harness):')
    for (const issue of knownIssues) console.log(`  - ${issue.geom} ${issue.scene}: ${issue.item}`)
  }
  console.log(`summary: verify/ui-matrix-out/summary.json`)
  if (!KEEP) {
    rmSync(HOME, { recursive: true, force: true })
    rmSync(WS, { recursive: true, force: true })
  } else {
    console.log(`scratch home kept: ${HOME}`)
  }
  process.exit(failed.length === 0 && !crashed ? 0 : 1)
}
