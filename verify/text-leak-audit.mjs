#!/usr/bin/env node
// Locale text-leak audit: every UI text on the captured frames of a REAL
// client is checked against the locale dictionaries. Two legs:
//
//   1. KEY-LEAK GATE (the pass/fail core). The 0.16.0 incident shape: an
//      installed npm package that misses packages/i18n/locales boots an EMPTY
//      registry and `t()`'s fail-open chain (active → en → THE KEY ITSELF)
//      paints raw key names on screen — `overlay.widgets.frameTitle` style.
//      Rule: after ANSI stripping, every text run matching
//      `^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_-]+)+$` (dotted key shape) that EQUALS
//      a key in en.json or zh-CN.json is a FAIL, reported with the key, the
//      face and the language. The dictionary-membership requirement keeps
//      ordinary dotted strings (paths, `subagent.maxDepth` host rows, URLs,
//      versions) out of the alarm — they are not locale keys.
//
//   2. DICTIONARY RECONCILIATION (report-level, NOT gating). Every visible
//      text run per face is collected, deduped and classified: which runs are
//      covered by the active language table (exact / contained either way),
//      and which are not — with whitelist classes for the legitimate
//      non-locale text (keycaps, numbers, paths, emoji, dotted host keys, the
//      daily-quote pool). This is the automated form of "screenshot-review
//      every UI string": anything left in `unclassified` is what a human
//      should eyeball in the report.
//
// Drives the REAL launcher `./dsh-opentui` in a scratch DSH_HOME (same
// isolation as agents-mount-repro: nothing is written to ~/.dsh) twice —
// config lang=en and lang=zh-CN — and captures five faces per language:
//   idle · slash palette at `/ex` prefix · /settings · /hotkeys · /help
//
//   node verify/text-leak-audit.mjs [--keep] [--only en|zh]
//
// Exit 0 = no key leak; exit 1 = at least one leak (or a face could not be
// driven — an unauditable face is a failure, not a skip); exit 2 =
// environment problem. Captures + reports land in verify/text-leak-out/.

import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LAUNCHER = join(REPO, 'dsh-opentui')
const LOCALES_DIR = join(REPO, 'packages', 'i18n', 'locales')
const QUOTES_SRC = join(REPO, 'packages', 'tui-base', 'src', 'routes', 'quotes.ts')
const PROFILE = 'opentui'
const REAL_HOME = process.env.DSH_HOME_REAL || join(homedir(), '.dsh')
const OUT = join(REPO, 'verify', 'text-leak-out')
const SESS = (lang) => `text-leak-${lang}-${process.pid}`
const COLS = 120
const ROWS = 34
const KEEP = process.argv.includes('--keep')
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined // undefined | en | zh-CN
const TYPE_GAP_MS = 60

/** The audited faces, in drive order. */
const FACES = ['idle', 'palette-ex', 'settings', 'hotkeys', 'help']
const LANGS = ['en', 'zh-CN'].filter((l) => !ONLY || l === ONLY)
if (ONLY && LANGS.length === 0) {
  console.error(`text-leak: unknown --only language '${ONLY}' (en|zh-CN)`)
  process.exit(2)
}

// --- dictionary load (direct from the locale sources, NOT through the app's
// registry — the gate must stay independent of the code it polices) -----------
const loadTable = (file) => {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return Object.entries(raw).filter(([, v]) => typeof v === 'string')
  } catch (error) {
    console.error(`text-leak: cannot load ${file}: ${error.message}`)
    process.exit(2)
  }
}
const TABLES = { en: loadTable(join(LOCALES_DIR, 'en.json')), 'zh-CN': loadTable(join(LOCALES_DIR, 'zh-CN.json')) }
// A key is a leak candidate if it is declared in EITHER table (a zh-only key
// leaking through the en fallback chain is the same bug).
const KEY_SET = new Set([...TABLES.en.map(([k]) => k), ...TABLES['zh-CN'].map(([k]) => k)])
if (KEY_SET.size < 100) {
  console.error(`text-leak: dictionary suspiciously small (${KEY_SET.size} keys) — refusing to gate on it`)
  process.exit(2)
}
// Fail-open leak shape: `overlay.widgets.frameTitle` — lower-camel head, dotted
// segments, nothing but letters/digits/_/- inside. The dotted shape alone is
// NOT a leak (host rows, paths); the dictionary membership decides.
const KEY_SHAPE = /[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]+)+/g
/** Value strings of the active table, longest first (containment matching). */
const tableValues = (lang) => [...new Set(TABLES[lang].map(([, v]) => v))].filter((v) => v.trim().length > 0).sort((a, b) => b.length - a.length)

// Daily-quote pool (welcome banner line): plain CJK one-liners, not locale
// table content. Parsed straight from the source so the list cannot drift.
const QUOTE_POOL = (() => {
  try {
    const src = readFileSync(QUOTES_SRC, 'utf8')
    return [...src.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((s) => s.length >= 4)
  } catch { return [] }
})()

// --- environment preflight (same discipline as the other repro gates) --------
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })
const tmux = (...a) => sh('tmux', a)
const tmuxOut = (...a) => (tmux(...a).status === 0 ? tmux(...a).stdout : '')
for (const cmd of ['tmux', 'bun']) {
  if (sh('which', [cmd]).status !== 0) { console.error(`text-leak: ${cmd} not on PATH`); process.exit(2) }
}
if (!existsSync(join(REAL_HOME, 'profiles', PROFILE))) {
  console.error(`text-leak: profile '${PROFILE}' missing under ${REAL_HOME}`)
  process.exit(2)
}
if (!existsSync(LAUNCHER)) { console.error(`text-leak: launcher missing (${LAUNCHER})`); process.exit(2) }
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

// --- ANSI / text-run primitives ----------------------------------------------
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g
const stripAnsi = (s) => String(s).replace(ANSI_RE, '')
const flat = (s) => String(s).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '')
const has = (out, marker) => flat(out).includes(flat(marker))

/**
 * Visible text runs of one frame: ANSI stripped, box-drawing characters and
 * multi-space gaps used as run separators, blank/edge padding dropped. Each
 * run keeps its original frame line for reporting.
 */
const BOX_CHARS = /[|┃│┏━┌─┓└┘├┤╭╮╰╯▸✎●◆·]/g
const textRuns = (ansiFrame) => {
  const runs = []
  for (const line of stripAnsi(ansiFrame).split('\n')) {
    for (const raw of line.split(BOX_CHARS)) {
      for (const chunk of raw.split(/\s{2,}/)) {
        const run = chunk.trim()
        if (run.length > 0) runs.push({ run, line: line.trim().slice(0, 160) })
      }
    }
  }
  return runs
}

/**
 * Dotted key-shaped tokens of one frame (ANSI stripped). False-positive safe:
 * a token only becomes a FAIL if it equals a declared locale key.
 */
const keyShapedTokens = (ansiFrame) => {
  const plain = stripAnsi(ansiFrame)
  const tokens = new Set()
  for (const m of plain.matchAll(KEY_SHAPE)) tokens.add(m[0])
  return [...tokens]
}

// Whitelist classes for the reconciliation leg (report-level tagging).
const classifyRun = (run, lang) => {
  if (/^[█╔╗╚╝═║░▒▓╠╣╦╩╦╤╧╬╭╮╰╯╴╵─▁▔ ]+$/.test(run) && /█/.test(run)) return 'banner-art'
  // /hotkeys rows: `keys — description (definition.name)` from keybind.ts
  // Definitions — static, never locale table content.
  if (/^[a-z]+(\+[^ ]+)*(,[^ ]+)* — .+ \([\w.-]+\)$/.test(run)) return 'keybind-row'
  // powerline / status segments (model, token counts, clock)
  if (/🧠|💬|🔧|🤖|●|\d+ msgs/.test(run)) return 'status-bar'
  if (/^[\d.,:%()\s]+$/.test(run)) return 'numbers'
  if (/^(~\/|\/|\.\.?\/)/.test(run)) return 'paths'
  if (/^[a-zA-Z]([ -+]([a-zA-Z]+|\d))*$/.test(run) && run.length <= 4) return 'keycap'
  if (/^(ctrl|alt|shift|cmd|esc|enter|tab|space|up|down|left|right|end|home|pgup|pgdn|npage|ppage|bspace|del|f\d{1,2})([ +-](ctrl|alt|shift|cmd|[a-z]|\d|esc|enter|tab|end|home))*$/i.test(run)) return 'keycap'
  if (/^[a-zA-Z][\w.-]*\.[a-zA-Z\d_-]+$/.test(run)) return 'dotted-non-locale'
  if (/^[0-9a-zA-Z_@/.+-]+$/.test(run) && (run.includes('/') || run.includes('@') || run.includes('_'))) return 'identifiers'
  if (/[\u4e00-\u9fff]/.test(run) && QUOTE_POOL.some((q) => q.includes(run.slice(0, 6)) || run.includes(q.slice(0, 6)))) return 'daily-quote'
  if (/^\p{Extended_Pictographic}/u.test(run)) return 'emoji'
  return null
}

// --- scratch home (agents-mount isolation: nothing lands in ~/.dsh) ----------
const HOME = mkdtempSync(join(tmpdir(), 'dsh-text-leak-home-'))
chmodSync(HOME, 0o700)
const WS = mkdtempSync(join(tmpdir(), 'dsh-text-leak-ws-'))
mkdirSync(join(HOME, 'profiles'), { recursive: true })
cpSync(join(REAL_HOME, 'profiles', PROFILE), join(HOME, 'profiles', PROFILE), { recursive: true })
for (const rel of ['.credentials.yaml', 'models-store.json', 'model-profiles.json', 'workspace-presets.json', 'settings.yaml', 'agents', 'themes']) {
  const from = join(REAL_HOME, rel)
  if (existsSync(from)) cpSync(from, join(HOME, rel), { recursive: true })
}
// DSH_AGENTS_HOME pin (skills-source precedence): the palette reads ONLY this
// scratch root, so the reconciliation never depends on the user's corpus.
const AGENTS_HOME = join(HOME, 'agents-home')
mkdirSync(join(AGENTS_HOME, 'skills'), { recursive: true })

const CONFIG_PATH = join(HOME, 'profiles', PROFILE, 'config.json')
const writeLang = (lang) => {
  let config = {}
  try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) } catch { /* fresh profile */ }
  writeFileSync(CONFIG_PATH, JSON.stringify({ ...config, lang }, null, 2) + '\n')
}

// host lock reaping (agents-mount pattern)
const LOCK = join(HOME, `opentui-host.${PROFILE}.json`)
const readLock = () => {
  try {
    const raw = JSON.parse(readFileSync(LOCK, 'utf8'))
    return typeof raw.pid === 'number' ? raw : null
  } catch { return null }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const reapHost = () => {
  const lock = readLock()
  if (!lock) return
  try { process.kill(lock.pid, 'SIGTERM') } catch { return }
  for (let i = 0; i < 20; i++) {
    try { process.kill(lock.pid, 0); sleep(250) } catch { break }
  }
  try { process.kill(lock.pid, 'SIGKILL') } catch {}
  rmSync(LOCK, { force: true })
}

// --- tmux driving -------------------------------------------------------------
const capture = (session, esc = false) => {
  const args = ['capture-pane', '-p', '-t', session]
  if (esc) args.push('-e')
  return tmuxOut(...args)
}
const sendKeys = (session, ...keys) => tmux('send-keys', '-t', session, ...keys)
const typeText = async (session, text) => {
  for (const ch of text) { sendKeys(session, '-l', ch); await sleep(TYPE_GAP_MS) }
}
const submit = async (session, text) => {
  await typeText(session, text)
  await sleep(300)
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
const composerRows = (out) =>
  out.split('\n')
    .filter((l) => l.trimStart().startsWith('┃'))
    .map((l) => l.trim().replace(/^┃/, '').replace(/┃$/, '').trim())
const idleMarker = (lang) => TABLES[lang].find(([k]) => k === 'composer.placeholder')?.[1] ?? ''
const isIdle = (out, lang) => composerRows(out).some((l) => l.startsWith('Type a message')) || (idleMarker(lang) !== '' && out.includes(idleMarker(lang)))
const launch = (session, lang) => {
  tmux('kill-session', '-t', session)
  const env = [
    `DSH_HOME=${HOME}`,
    `DSH_AGENTS_HOME=${AGENTS_HOME}`,
    'DSH_OPENTUI_DEBUG=1',
    // Defensive pair (agents-mount parity): no turn is submitted here, but a
    // dummy key + empty BASE_URL guarantee nothing ever reaches a provider.
    'ZAI_CODING_CN_API_KEY=mock-only-key',
    'ZAI_CODING_CN_BASE_URL=',
  ]
  const r = tmux('new-session', '-d', '-x', String(COLS), '-y', String(ROWS), '-s', session, '-c', WS,
    `${env.join(' ')} ${LAUNCHER} --client 2>${join(OUT, `${session}.err.log`)}`)
  if (r.status !== 0) throw new Error('tmux boot failed: ' + r.stderr)
}
const killSession = (session) => tmux('kill-session', '-t', session)

// --- audit state ----------------------------------------------------------------
const results = []
const leaks = [] // { lang, face, key, line }
const facesFrames = [] // { lang, face, ok, note }
const reconciliation = [] // { lang, face, inTable, unclassified, whitelisted }

const snapFace = (lang, face, session) => {
  const ansi = capture(session, true)
  const file = `${lang}-${face}.ans`
  writeFileSync(join(OUT, file), ansi)
  return ansi
}

/** Core gate on one frame: dotted tokens that EQUAL a locale key → leak. */
const auditFrame = (lang, face, ansi) => {
  for (const token of keyShapedTokens(ansi)) {
    if (KEY_SET.has(token)) leaks.push({ lang, face, key: token, line: stripAnsi(ansi).split('\n').find((l) => l.includes(token))?.trim().slice(0, 120) ?? '' })
  }
}

/** Reconciliation leg: classify every visible run against the active table. */
const reconcileFrame = (lang, face, ansi) => {
  const values = tableValues(lang)
  const runs = textRuns(ansi)
  const seen = new Map()
  for (const { run } of runs) {
    if (seen.has(run)) continue
    const inTable = values.some((v) => v === run) ? 'exact'
      : values.some((v) => v.includes(run) && run.length >= 3) ? 'part-of-value'
        : values.some((v) => run.includes(v) && v.length >= 3) ? 'contains-value'
          : null
    seen.set(run, inTable)
  }
  const inTableRuns = []
  const unclassified = []
  const whitelisted = []
  for (const [run, hit] of seen) {
    if (hit) { inTableRuns.push({ run, kind: hit }); continue }
    const klass = classifyRun(run, lang)
    if (klass) whitelisted.push({ run, klass })
    else unclassified.push({ run })
  }
  reconciliation.push({ lang, face, total: seen.size, inTable: inTableRuns, unclassified, whitelisted })
}

const closeSettings = async (session, lang) => {
  const exitTitle = TABLES[lang].find(([k]) => k === 'settings.exit.title')?.[1] ?? ''
  sendKeys(session, 'Escape')
  if (exitTitle !== '' && (await waitPane(session, (o) => o.includes(exitTitle), 6_000)).ok) {
    sendKeys(session, 'Tab')
    await sleep(180)
    sendKeys(session, 'Enter')
  }
  return waitPane(session, (o) => isIdle(o, lang), 12_000)
}

// --- drive one language ----------------------------------------------------------
const driveLang = async (lang) => {
  const session = SESS(lang)
  writeLang(lang)
  launch(session, lang)
  const boot = await waitPane(session, (o) => o.includes('🧠') || isIdle(o, lang), 90_000, 500)
  if (!boot.ok) {
    facesFrames.push({ lang, face: '*', ok: false, note: 'client never rendered' })
    console.error(`text-leak[${lang}]: client never rendered:\n` + boot.out.slice(-1200))
    return false
  }
  await waitPane(session, (o) => isIdle(o, lang), 30_000)
  await sleep(500)

  // face: idle
  let ansi = snapFace(lang, 'idle', session)
  auditFrame(lang, 'idle', ansi)
  reconcileFrame(lang, 'idle', ansi)
  facesFrames.push({ lang, face: 'idle', ok: true, note: '' })

  // face: slash palette at the `/ex` prefix
  await typeText(session, '/ex')
  await sleep(800)
  ansi = snapFace(lang, 'palette-ex', session)
  const paletteRows = composerRows(stripAnsi(ansi)).filter((l) => /^\/[a-z]/.test(l.trimStart()))
  facesFrames.push({ lang, face: 'palette-ex', ok: paletteRows.length > 0, note: paletteRows.length === 0 ? 'palette did not expand' : `${paletteRows.length} rows` })
  auditFrame(lang, 'palette-ex', ansi)
  reconcileFrame(lang, 'palette-ex', ansi)
  for (let i = 0; i < 6; i++) { sendKeys(session, 'BSpace'); await sleep(TYPE_GAP_MS) }
  await sleep(300)

  // face: /settings (marker = the translated subtitle VALUE from the table,
  // so the wait works in both languages even if the translation changes)
  const settingsMarker = TABLES[lang].find(([k]) => k === 'settings.modal.subtitle')?.[1] ?? ''
  await submit(session, '/settings')
  const settings = await waitPane(session, (o) => settingsMarker !== '' && o.includes(settingsMarker), 25_000)
  ansi = snapFace(lang, 'settings', session)
  facesFrames.push({ lang, face: 'settings', ok: settings.ok, note: settings.ok ? '' : 'settings subtitle not seen' })
  auditFrame(lang, 'settings', ansi)
  reconcileFrame(lang, 'settings', ansi)
  const closed = await closeSettings(session, lang)
  if (!closed.ok) console.error(`text-leak[${lang}]: settings modal did not close cleanly (continuing)`)

  // face: /hotkeys (the row list is taller than the viewport, so the header
  // scrolls off — wait on a keybind-row constant instead; keybind descriptions
  // are static keybind.ts definitions, not locale table content)
  await submit(session, '/hotkeys')
  const hotkeys = await waitPane(session, (o) => o.includes('which-key.toggle') && o.includes('Suspend terminal'), 15_000)
  ansi = snapFace(lang, 'hotkeys', session)
  facesFrames.push({ lang, face: 'hotkeys', ok: hotkeys.ok, note: hotkeys.ok ? '' : 'hotkeys header not seen' })
  auditFrame(lang, 'hotkeys', ansi)
  reconcileFrame(lang, 'hotkeys', ansi)

  // face: /help (marker = the translated /help description value)
  const helpMarker = TABLES[lang].find(([k]) => k === 'command.help.description')?.[1] ?? ''
  await submit(session, '/help')
  const help = await waitPane(session, (o) => helpMarker !== '' && has(o, helpMarker), 15_000)
  ansi = snapFace(lang, 'help', session)
  facesFrames.push({ lang, face: 'help', ok: help.ok, note: help.ok ? '' : 'help rows not seen' })
  auditFrame(lang, 'help', ansi)
  reconcileFrame(lang, 'help', ansi)

  // exit
  await submit(session, '/quit')
  await waitPane(session, () => tmux('has-session', '-t', session).status !== 0, 15_000)
  killSession(session)
  reapHost()
  await sleep(500)
  return facesFrames.filter((f) => f.lang === lang).every((f) => f.ok)
}

let crashed = null
try {
  console.log(`text-leak: dictionary = ${KEY_SET.size} keys (en ${TABLES.en.length} / zh-CN ${TABLES['zh-CN'].length}); faces: ${FACES.join(', ')}`)
  for (const lang of LANGS) {
    console.log(`\n== text-leak: lang=${lang} ==`)
    const ok = await driveLang(lang)
    results.push({ item: `drive:${lang}`, ok, detail: facesFrames.filter((f) => f.lang === lang).map((f) => `${f.face}: ${f.ok ? 'ok' : `FAIL (${f.note})`}`) })
  }
  // Crash scan on the scrollbacks kept in the err logs.
  crashed = null
  for (const lang of LANGS) {
    try {
      const err = readFileSync(join(OUT, `${SESS(lang)}.err.log`), 'utf8')
      const m = err.match(/TypeError|Cannot access private|Unhandled|boot failed/i)
      if (m) { crashed = `${lang}: ${m[0]}`; break }
    } catch { /* no log */ }
  }
  results.push({ item: 'no crash markers', ok: crashed === null, detail: crashed ? [crashed] : [] })
} catch (error) {
  console.error('text-leak: ' + (error instanceof Error ? error.message : String(error)))
  results.push({ item: 'harness', ok: false, detail: [String(error).slice(0, 300)] })
} finally {
  for (const lang of LANGS) killSession(SESS(lang))
  reapHost()

  // reports (always, so a failing run still lands its evidence)
  writeFileSync(join(OUT, 'audit-report.json'), JSON.stringify({
    dictionarySizes: { en: TABLES.en.length, 'zh-CN': TABLES['zh-CN'].length },
    faces: FACES,
    facesFrames,
    leaks,
    reconciliation,
  }, null, 2))

  const md = []
  md.push(`# text-leak audit report — ${new Date().toISOString()}`)
  md.push('')
  md.push(`Dictionary: ${KEY_SET.size} keys (en ${TABLES.en.length}, zh-CN ${TABLES['zh-CN'].length}). Faces: ${FACES.join(', ')} × ${LANGS.join(', ')}.`)
  md.push('')
  md.push('## Key-leak gate')
  md.push('')
  if (leaks.length === 0) {
    md.push('PASS — no dotted text run on any captured frame equals a locale key.')
  } else {
    md.push(`FAIL — ${leaks.length} key leak(s):`)
    for (const l of leaks) md.push(`- \`${l.key}\` on face \`${l.face}\` (${l.lang}) — line: \`${l.line}\``)
  }
  md.push('')
  md.push('## Face drive status')
  for (const f of facesFrames) md.push(`- ${f.lang}/${f.face}: ${f.ok ? 'ok' : `FAIL — ${f.note}`}`)
  md.push('')
  md.push('## Dictionary reconciliation (report-level, not gating)')
  for (const rec of reconciliation) {
    md.push('')
    md.push(`### ${rec.lang}/${rec.face} — ${rec.total} unique runs: ${rec.inTable.length} in-table, ${rec.whitelisted.length} whitelisted, ${rec.unclassified.length} unclassified`)
    if (rec.unclassified.length > 0) {
      md.push('')
      md.push('Unclassified (human review list):')
      for (const u of rec.unclassified) md.push(`- \`${u.run}\``)
    }
  }
  writeFileSync(join(OUT, 'audit-report.md'), md.join('\n'))
  console.log(`\nreport: verify/text-leak-out/audit-report.md (+ audit-report.json, ${LANGS.length * FACES.length} .ans frames)`)

  if (!KEEP) {
    rmSync(HOME, { recursive: true, force: true })
    rmSync(WS, { recursive: true, force: true })
  } else {
    console.log(`scratch home kept: ${HOME}`)
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\ntext-leak: ${results.length - failed.length}/${results.length} checks passed, ${leaks.length} key leak(s)`)
  const faceFailed = facesFrames.filter((f) => !f.ok)
  const exitCode = leaks.length > 0 || failed.length > 0 || faceFailed.length > 0 ? 1 : 0
  process.exit(exitCode)
}
