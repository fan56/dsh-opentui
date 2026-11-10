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

import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LAUNCHER = join(REPO, 'dsh-opentui')
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

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const COLS = Number(arg('cols', '120'))
const ROWS = Number(arg('rows', '34'))
const KEEP = process.argv.includes('--keep')
const TYPE_GAP_MS = 60
const OUT = join(REPO, 'verify', 'agents-mount-out')

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
if (!existsSync(LAUNCHER)) { console.error(`agents-mount: launcher missing: ${LAUNCHER}`); process.exit(2) }
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
const launch = (session, cols, rows) => {
  tmux('kill-session', '-t', session)
  const env = [`DSH_HOME=${HOME}`, `DSH_AGENTS_HOME=${AGENTS_HOME}`, 'DSH_OPENTUI_DEBUG=1']
  const r = tmux('new-session', '-d', '-x', String(cols), '-y', String(rows), '-s', session, '-c', WS,
    `${env.join(' ')} ${LAUNCHER} --client 2>${join(OUT, `${session}.err.log`)}`)
  if (r.status !== 0) throw new Error('tmux boot failed: ' + r.stderr)
}
const killSession = (session) => tmux('kill-session', '-t', session)

let crashed = null
try {
  // ---------------- 1. panel mount + keys (default geometry) ----------------
  launch(SESS, COLS, ROWS)
  const boot = await waitPane(SESS, (o) => o.includes('🧠') || idle(o), 90_000, 500)
  if (!boot.out.includes('🧠') && !idle(boot.out)) {
    console.error('client never rendered:\n' + boot.out.slice(-1500))
    process.exit(2)
  }
  await waitPane(SESS, idle, 30_000)
  snap('01-welcome')

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
  const atEnd = snap('10-palette-80x24-end', SESS80)
  const endNames = menuNames(atEnd)
  const fixtureVisible = endNames.some((l) => l.startsWith(`/${FIXTURE_SKILL}`))
  record('80x24: End reaches the last rows and shows the skill line', fixtureVisible,
    [`last visible row: ${JSON.stringify(endNames.at(-1) ?? '')}`, `fixture /${FIXTURE_SKILL} visible: ${fixtureVisible}`])
  for (let i = 0; i < 8; i++) { sendKeys(SESS80, 'BSpace'); await sleep(TYPE_GAP_MS) }
  await submit(SESS80, '/quit')
  await waitPane(SESS80, () => tmux('has-session', '-t', SESS80).status !== 0, 15_000)
} catch (error) {
  console.error('agents-mount: ' + (error instanceof Error ? error.message : String(error)))
  results.push({ item: 'harness', ok: false, detail: [String(error).slice(0, 300)] })
} finally {
  killSession(SESS)
  killSession(SESS80)
  reapHost()
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
