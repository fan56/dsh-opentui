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
// config lang=en and lang=zh-CN — and captures eleven faces per language:
//   idle · slash palette at `/ex` prefix · /settings · /hotkeys · /help
//   · /plugins · /skills · /agents · /language picker (the ask seam's
//   pickOne face) · busy (a mock-LLM turn mid-stream) · ask (the F5 batch
//   ask_user_question picker over the same mock)
// The last two ride e2e/lib/mock-llm.mjs (the offline fake model): the
// scratch profile's provider route gets a baseURL pointing at the mock, the
// TPS trigger streams a short turn for the busy face and the ASK trigger
// opens the real batch picker for the ask face.
//
//   node verify/text-leak-audit.mjs [--keep] [--only en|zh]
//
// Env overrides (the packed-artifact leg, verify/text-leak-pack-audit.mjs,
// points these at the npm-prefix install):
//   TEXT_LEAK_LAUNCHER    launcher to boot (default REPO/dsh-opentui)
//   TEXT_LEAK_OUT         capture/report dir (default verify/text-leak-out)
//   TEXT_LEAK_MOCK_PORT   mock-llm port (default: pick a free port)
//
// Exit 0 = no key leak; exit 1 = at least one leak (or a face could not be
// driven — an unauditable face is a failure, not a skip); exit 2 =
// environment problem. Captures + reports land in verify/text-leak-out/.

import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PROFILE } from '../packages/shell/scripts/lib/profile-name.mjs'
import { provisionScratchProfile } from './lib/scratch-profile.mjs'
import { findKeyLeaks, keyShapedTokens, loadDictionary, stripAnsi } from './text-leak-core.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LAUNCHER = process.env.TEXT_LEAK_LAUNCHER || join(REPO, 'dsh-opentui')
const LOCALES_DIR = join(REPO, 'packages', 'i18n', 'locales')
const QUOTES_SRC = join(REPO, 'packages', 'tui-base', 'src', 'routes', 'quotes.ts')
const MOCK_SERVER = join(REPO, 'e2e', 'lib', 'mock-llm.mjs')
let MOCK_PORT = Number(process.env.TEXT_LEAK_MOCK_PORT || 0) // 0 = pick a free port
const mockBaseUrl = () => `http://127.0.0.1:${MOCK_PORT}/v1`
const TPS_TRIGGER = 'E2E_TPS_TRIGGER'
const ASK_TRIGGER = 'E2E_ASK_TRIGGER'
const PROFILE = DEFAULT_PROFILE
const OUT = process.env.TEXT_LEAK_OUT || join(REPO, 'verify', 'text-leak-out')
const SESS = (lang) => `text-leak-${lang}-${process.pid}`
const COLS = 120
const ROWS = 34
const KEEP = process.argv.includes('--keep')
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined // undefined | en | zh-CN
const TYPE_GAP_MS = 60

/** The audited faces, in drive order. */
const FACES = ['idle', 'palette-ex', 'settings', 'hotkeys', 'help', 'plugins', 'skills', 'agents', 'language-picker', 'busy', 'ask']
const LANGS = ['en', 'zh-CN'].filter((l) => !ONLY || l === ONLY)
if (ONLY && LANGS.length === 0) {
  console.error(`text-leak: unknown --only language '${ONLY}' (en|zh-CN)`)
  process.exit(2)
}

// --- dictionary load (direct from the locale sources, NOT through the app's
// registry — the gate must stay independent of the code it polices; the scan
// primitives live in verify/text-leak-core.mjs so the canary unit test
// exercises the SAME logic) -----------------------------------------------
let TABLES, KEY_SET
try {
  const dict = loadDictionary(LOCALES_DIR)
  TABLES = dict.tables
  KEY_SET = dict.keySet
} catch (error) {
  console.error(`text-leak: cannot load the locale dictionaries: ${error.message}`)
  process.exit(2)
}
if (KEY_SET.size < 100) {
  console.error(`text-leak: dictionary suspiciously small (${KEY_SET.size} keys) — refusing to gate on it`)
  process.exit(2)
}
/** Value strings of the active table, longest first (containment matching). */
const tableValues = (lang) => [...new Set(TABLES[lang].map(([, v]) => v))].filter((v) => v.trim().length > 0).sort((a, b) => b.length - a.length)

/**
 * A probe key's expected on-screen text, with `{name}` variables substituted.
 * Returns undefined when the key is absent or empty in that language table —
 * the caller MUST treat that as a failure. A hardcoded literal fallback would
 * let a retired key (the ask redesign retired
 * `overlay.ask.questionProgress`) degrade the probe into a tautology that can
 * only pass.
 */
const probeText = (lang, key, vars = {}) => {
  const value = TABLES[lang].find(([k]) => k === key)?.[1]
  if (value === undefined || value.trim() === '') return undefined
  return Object.entries(vars).reduce((text, [name, sub]) => text.split(`{${name}}`).join(sub), value)
}

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
if (!existsSync(LAUNCHER)) { console.error(`text-leak: launcher missing (${LAUNCHER})`); process.exit(2) }
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

// --- ANSI / text-run primitives ----------------------------------------------
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
 * Dotted key-shaped tokens of one frame — the scanner lives in
 * verify/text-leak-core.mjs (shared with the reverse canary unit test).
 */

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
let profileDir
try {
  profileDir = provisionScratchProfile({ home: HOME, repo: REPO })
} catch (error) {
  console.error(`text-leak: ${error.message}`)
  process.exit(2)
}
// DSH_AGENTS_HOME pin (skills-source precedence): the palette reads ONLY this
// scratch root, so the reconciliation never depends on the user's corpus.
const AGENTS_HOME = join(HOME, 'agents-home')
mkdirSync(join(AGENTS_HOME, 'skills'), { recursive: true })

// --- mock LLM (e2e/lib/mock-llm.mjs — the offline fake model) ---------------
// The busy + ask faces need a REAL turn. The mock stands in for the provider
// (stdlib-only server, phases keyed on the request body): the scratch
// profile's provider route gets a baseURL pointing at it, so no real
// provider is ever contacted and the turn never costs anything.
const patchPath = join(profileDir, 'cordis.patch.yml')
/** A free TCP port (the fixed default collided with unrelated listeners). */
const freePort = async () =>
  new Promise((res, rej) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)) })
    srv.on('error', rej)
  })
/**
 * Point EVERY provider block in the scratch patch at the offline mock. The
 * old guard ("no baseURL anywhere → insert") skipped the whole file when a
 * migrated profile carried even one stale/real baseURL, so a turn routed to
 * that provider reached a REAL endpoint. Rewrite line-by-line (the
 * provisioner's indent shape is fixed; no yaml dep): drop every sibling
 * `baseURL:` and write exactly one mock baseURL under each provider's
 * `apiKeyEnv:`.
 */
const patchProvidersToMock = (yaml) => {
  const lines = yaml.split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    if (!/^ {6}[a-z][\w-]*: *$/.test(lines[i])) { out.push(lines[i++]); continue }
    // Buffer the whole 6-space block; only blocks that actually declare an
    // apiKeyEnv are providers (permission presets / `config:` share the same
    // indent and MUST stay untouched).
    const block = [lines[i++]]
    while (i < lines.length) {
      const line = lines[i]
      if (line.trim() !== '' && /^ */.exec(line)[0].length <= 6) break
      block.push(lines[i++])
    }
    if (!block.some((l) => /^ {8}apiKeyEnv:/.test(l))) { out.push(...block); continue }
    for (const line of block) {
      if (/^ {8}baseURL:/.test(line)) continue // drop stale / real endpoint
      out.push(line)
      if (/^ {8}apiKeyEnv:/.test(line)) out.push(`        baseURL: ${mockBaseUrl()}`)
    }
  }
  return out.join('\n')
}

/**
 * Re-pin the scratch profile's default route to the mocked provider. A
 * migrated legacy config may carry its own `agent-default-model` row pointing
 * at a REAL provider/model (the template itself defaults to opencode-go /
 * deepseek-v4.1-flash) — strip EVERY such entry first, then append exactly
 * one pinned entry (zai-coding-cn / glm-5.3-flash, whose baseURL the patch
 * above points at the mock). The gate is then immune to operator state.
 */
const pinDefaultModel = (yaml) => {
  const kept = []
  let skipping = false
  let blockIndent = 0
  for (const line of yaml.split('\n')) {
    if (skipping) {
      const indent = /^([ \t]*)/.exec(line)[1].length
      if (line.trim() === '' || indent > blockIndent) continue
      skipping = false
    }
    const m = /^([ \t]*)- id: agent-default-model\s*$/.exec(line)
    if (m) { skipping = true; blockIndent = m[1].length; continue }
    kept.push(line)
  }
  return kept.join('\n').replace(/\n*$/, '\n') + [
    '- id: agent-default-model',
    '  name: "@deepseek-ai/dsh-agent-default-model"',
    '  config:',
    '    provider: zai-coding-cn',
    '    model: glm-5.3-flash',
    '    reasoningEffort: high',
    '',
  ].join('\n')
}

const startMock = async () => {
  if (!existsSync(MOCK_SERVER)) return null
  if (MOCK_PORT === 0) MOCK_PORT = await freePort()
  if (!existsSync(patchPath)) {
    console.error('text-leak: scratch provider patch missing — cannot guarantee the mock route; busy/ask faces will FAIL')
    return null
  }
  const yaml = readFileSync(patchPath, 'utf8')
  const patched = pinDefaultModel(patchProvidersToMock(yaml))
  if (patched !== yaml) writeFileSync(patchPath, patched)
  const child = spawn(process.execPath, [MOCK_SERVER, '--port', String(MOCK_PORT)], { stdio: 'ignore', detached: false })
  child.on('error', () => {})
  for (let i = 0; i < 30; i++) {
    if (child.exitCode !== null) return null
    const probe = sh('curl', ['-sf', `http://127.0.0.1:${MOCK_PORT}/healthz`])
    if (probe.status === 0) return child
    await sleep(500)
  }
  child.kill('SIGTERM')
  return null
}
let MOCK = null

const CONFIG_PATH = join(profileDir, 'config.json')
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
    // Dummy keys + mock BASE_URL for EVERY provider: the busy/ask faces DO
    // submit turns, but both the profile patch and this env point at the
    // offline mock — nothing ever reaches a real provider. The template's
    // default route used to be opencode-go, whose key/baseURL were absent,
    // so the turn escaped to a real endpoint; pin both keys here as a belt-
    // and-braces guard even though the patch re-pins the default model.
    'ZAI_CODING_CN_API_KEY=mock-only-key',
    `ZAI_CODING_CN_BASE_URL=${mockBaseUrl()}`,
    'OPENCODE_GO_API_KEY=mock-only-key',
    `OPENCODE_GO_BASE_URL=${mockBaseUrl()}`,
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
  for (const token of findKeyLeaks(ansi, KEY_SET)) {
    leaks.push({ lang, face, key: token, line: stripAnsi(ansi).split('\n').find((l) => l.includes(token))?.trim().slice(0, 120) ?? '' })
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

  // face: /plugins (the plugins manager PANEL — the first open loads every
  // bundle's state over the host RPC, which can take tens of seconds)
  const pluginsMarker = TABLES[lang].find(([k]) => k === 'panel.plugins.header.title')?.[1] ?? ''
  await submit(session, '/plugins')
  const plugins = await waitPane(session, (o) => pluginsMarker !== '' && o.includes(pluginsMarker), 45_000)
  ansi = snapFace(lang, 'plugins', session)
  facesFrames.push({ lang, face: 'plugins', ok: plugins.ok, note: plugins.ok ? '' : 'plugins panel header not seen' })
  auditFrame(lang, 'plugins', ansi)
  reconcileFrame(lang, 'plugins', ansi)
  sendKeys(session, 'Escape')
  await waitPane(session, (o) => isIdle(o, lang), 10_000)
  await sleep(300)

  // face: /skills (the Installed/Available manager panel; header title from
  // the table, Escape closes)
  const skillsMarker = TABLES[lang].find(([k]) => k === 'panel.skills.header.title')?.[1] ?? ''
  await submit(session, '/skills')
  const skills = await waitPane(session, (o) => skillsMarker !== '' && o.includes(skillsMarker), 30_000)
  ansi = snapFace(lang, 'skills', session)
  facesFrames.push({ lang, face: 'skills', ok: skills.ok, note: skills.ok ? '' : 'skills header not seen' })
  auditFrame(lang, 'skills', ansi)
  reconcileFrame(lang, 'skills', ansi)
  sendKeys(session, 'Escape')
  await waitPane(session, (o) => isIdle(o, lang), 10_000)
  await sleep(300)

  // face: /agents (the agent-definition manager table; title from the table)
  const agentsMarker = TABLES[lang].find(([k]) => k === 'panel.agents.title.table')?.[1] ?? ''
  await submit(session, '/agents')
  const agents = await waitPane(session, (o) => agentsMarker !== '' && o.includes(agentsMarker), 30_000)
  ansi = snapFace(lang, 'agents', session)
  facesFrames.push({ lang, face: 'agents', ok: agents.ok, note: agents.ok ? '' : 'agents table title not seen' })
  auditFrame(lang, 'agents', ansi)
  reconcileFrame(lang, 'agents', ansi)
  sendKeys(session, 'Escape')
  await waitPane(session, (o) => isIdle(o, lang), 10_000)
  await sleep(300)

  // face: /language picker (the T14 pickOne ask-seam face; picker title from
  // the table, Escape declines — "language unchanged")
  const pickTitle = TABLES[lang].find(([k]) => k === 'command.language.pickTitle')?.[1] ?? ''
  await submit(session, '/language')
  const picker = await waitPane(session, (o) => pickTitle !== '' && o.includes(pickTitle), 30_000)
  ansi = snapFace(lang, 'language-picker', session)
  facesFrames.push({ lang, face: 'language-picker', ok: picker.ok, note: picker.ok ? '' : 'picker title not seen' })
  auditFrame(lang, 'language-picker', ansi)
  reconcileFrame(lang, 'language-picker', ansi)
  sendKeys(session, 'Escape')
  await waitPane(session, (o) => isIdle(o, lang), 10_000)
  await sleep(300)

  // faces: busy + ask — mock-LLM turns. Without the mock these two faces are
  // unauditable, which by the script's own law is a FAIL, not a skip.
  if (MOCK) {
    // ask FIRST: the mock keys its phase on the request BODY, and the
    // conversation history rides along — a TPS turn submitted first would put
    // E2E_TPS_TRIGGER into the ask turn's history and the mock would serve
    // the tps phase instead of the ask phase (real first-run observation).
    // ask: the ASK trigger opens the F5 batch ask_user_question picker. The
    // redesign retired the `Question ({index}/{total})` title (and with it
    // `overlay.ask.questionProgress`): the panel now paints header eyebrow,
    // prompt, tab strip, option rows, resident input and footer hint. Probe
    // the keys that actually paint on a FRESH batch (question 1 of the mock's
    // three-question batch) and must be localized:
    //   - `overlay.ask.footer.options` — the options-phase footer hint; its
    //     `{esc}` leg is `overlay.ask.esc.decline` at question 1, so that key
    //     is proved transitively
    //   - `overlay.ask.inputPlaceholder` — the resident input's placeholder
    //     (the inline buffer is empty when the batch opens)
    // A probe key missing from the active table FAILS this face; there is no
    // hardcoded fallback (see probeText).
    const escDecline = probeText(lang, 'overlay.ask.esc.decline')
    const askProbes = [
      { key: 'overlay.ask.footer.options', text: escDecline === undefined ? undefined : probeText(lang, 'overlay.ask.footer.options', { esc: escDecline }) },
      { key: 'overlay.ask.inputPlaceholder', text: probeText(lang, 'overlay.ask.inputPlaceholder') },
    ]
    const missingProbes = askProbes.filter((p) => p.text === undefined)
    for (const probe of missingProbes) {
      console.error(`text-leak[${lang}]: probe key '${probe.key}' is missing from ${lang}.json — the ask face cannot prove localization without it`)
    }
    await submit(session, ASK_TRIGGER)
    const ask = missingProbes.length === 0
      ? await waitPane(session, (o) => askProbes.every((p) => o.includes(p.text)), 40_000)
      : { ok: false }
    ansi = snapFace(lang, 'ask', session)
    facesFrames.push({
      lang,
      face: 'ask',
      ok: ask.ok,
      note: ask.ok ? ''
        : missingProbes.length > 0
          ? `probe key(s) missing from ${lang}.json: ${missingProbes.map((p) => p.key).join(', ')}`
          : `ask picker not seen (localized probe text absent: ${askProbes.map((p) => p.key).join(', ')})`,
    })
    auditFrame(lang, 'ask', ansi)
    reconcileFrame(lang, 'ask', ansi)
    sendKeys(session, 'Escape') // decline all — the mock serves its final text
    await waitPane(session, (o) => isIdle(o, lang) && o.includes('E2E-ASK-FLOW-COMPLETE'), 30_000)

    // busy: whatever the mock streams for this turn (its phase selection may
    // see the ask history), the frame only needs the turn IN FLIGHT. Snap the
    // FIRST frame carrying the turn overlay's real busy hint (`esc stop` /
    // `esc 停止`) — the English Writing/Composing/Thinking status copy is no
    // longer a stable marker. Poll fast; the stream can complete inside ~1.5s.
    // The captured frame must ALSO carry TPS_TRIGGER, so a stale or idle frame
    // cannot be mistaken for a mid-turn capture.
    await submit(session, TPS_TRIGGER)
    const busyDeadline = Date.now() + 20_000
    let busySeen = false
    while (Date.now() < busyDeadline) {
      const frame = capture(session)
      if (/esc stop|esc\s*停止/.test(stripAnsi(frame))) {
        ansi = capture(session, true)
        busySeen = stripAnsi(ansi).includes(TPS_TRIGGER)
        if (busySeen) writeFileSync(join(OUT, `${lang}-busy.ans`), ansi) // evidence parity with snapFace
        break
      }
      if (isIdle(frame, lang) && stripAnsi(frame).includes('E2E-TPS-TURN-DONE')) break // too late — turn already settled
      await sleep(150)
    }
    if (!busySeen) ansi = snapFace(lang, 'busy', session)
    const busyOk = busySeen
    facesFrames.push({ lang, face: 'busy', ok: busyOk, note: busyOk ? '' : 'no mid-turn spinner frame captured' })
    auditFrame(lang, 'busy', ansi)
    reconcileFrame(lang, 'busy', ansi)
    await waitPane(session, (o) => isIdle(o, lang), 30_000)
  } else {
    for (const face of ['busy', 'ask']) facesFrames.push({ lang, face, ok: false, note: 'mock LLM unavailable' })
  }

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
  MOCK = await startMock()
  console.log(`text-leak: mock LLM ${MOCK ? `up on 127.0.0.1:${MOCK_PORT}` : 'UNAVAILABLE — busy/ask faces will fail'}`)
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
  if (MOCK) { try { MOCK.kill('SIGTERM') } catch { /* already gone */ } }

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
