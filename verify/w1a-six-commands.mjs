#!/usr/bin/env node
// 025-w1a — real-client evidence capture for the six seam-face commands.
//
//   node verify/w1a-six-commands.mjs [--out DIR]
//
// Proves against the REAL launcher + a scratch DSH_HOME (same isolation recipe
// as agents-mount-repro.mjs — nothing written to ~/.dsh) that /export, /think,
// /preset, /login, /logout, /btw no longer hit their seam-face `unavailable`
// degrade branch, and paints the exact observed output. Frames are tmux
// `capture-pane -e -p` numeric ANSI (.ans — no PNG, no visual model).
//
// Exit 0 = all six commands produced a non-unavailable, expected branch.
// Exit 1 = at least one command still degraded / panicked. Exit 2 = env problem.
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PROFILE } from '../packages/shell/scripts/lib/profile-name.mjs'
import { provisionScratchProfile } from './lib/scratch-profile.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LAUNCHER = join(REPO, 'dsh-opentui')
const MOCK = join(REPO, 'e2e', 'lib', 'mock-llm.mjs')
const PROFILE = DEFAULT_PROFILE
const IDLE = '提问，回车发送'
const PLACEHOLDER = 'Type a message'
const PORT = 19500 + (process.pid % 100) // distinct band from agents-mount (18900+pid%300)
const SESS = `w1a-six-${process.pid}`
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const OUT = resolve(arg('out', join(REPO, '.proof/025-w1a/six-commands')))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd, a, opts = {}) => spawnSync(cmd, a, { encoding: 'utf8', ...opts })
const tmux = (...a) => sh('tmux', a)
const tmuxOut = (...a) => (tmux(...a).status === 0 ? tmux(...a).stdout : '')

if (!existsSync(LAUNCHER) || !existsSync(MOCK)) { console.error('w1a-six: launcher or mock missing'); process.exit(2) }
mkdirSync(OUT, { recursive: true })

const HOME = mkdtempSync(join(tmpdir(), 'w1a-six-home-'))
chmodSync(HOME, 0o700)
const WS = mkdtempSync(join(tmpdir(), 'w1a-six-ws-'))
let profileDir
try {
  profileDir = provisionScratchProfile({ home: HOME, repo: REPO })
} catch (error) {
  console.error(`w1a-six: ${error.message}`)
  process.exit(2)
}
const cfgPath = join(profileDir, 'config.json')
try { const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); cfg.lang = 'en'; writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)) } catch {}
// Pin the default model route to the offline mock, and neutralise any real API
// base URL so no operator env can send the /btw probe to the network.
const patchPath = join(profileDir, 'cordis.patch.yml')
{
  let patch = readFileSync(patchPath, 'utf8')
  const withUrl = patch.replace(/(\n {6}zai-coding-cn:\n)/, `$1        baseURL: http://127.0.0.1:${PORT}/v1\n`)
  if (withUrl !== patch) patch = withUrl
  writeFileSync(patchPath, patch)
}

let mock = null
const startMock = async () => {
  const fd = openSync(join(OUT, 'mock-llm.log'), 'w')
  mock = spawn('node', [MOCK, '--port', String(PORT)], { stdio: ['ignore', fd, fd] })
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return } catch {}
    await sleep(100)
  }
  throw new Error('mock LLM did not start')
}
const capture = (esc = true) => { const a = ['capture-pane', '-p', '-t', SESS]; if (esc) a.push('-e'); return tmuxOut(...a) }
const idle = (o) => o.includes(IDLE) || o.includes(PLACEHOLDER)
const inputRow = (o) => o.split('\n').filter((l) => l.trimStart().startsWith('┃')).map((l) => l.trim().replace(/^┃/, '').replace(/┃$/, '').trim()).filter((l) => l && !l.startsWith(PLACEHOLDER)).pop() ?? ''
const typeText = (t) => { for (const ch of t) { tmux('send-keys', '-t', SESS, '-l', ch); await0() } }
// sync per-char gap via busy wait is wasteful; use a tiny sleep through Atomics
function await0() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 35) }
const waitPane = async (pred, ms) => {
  const end = Date.now() + ms; let last = ''
  while (Date.now() < end) { const f = capture(false); if (f.trim()) last = f; if (last && pred(last)) return { ok: true, out: last }; await sleep(400) }
  return { ok: false, out: last }
}
const submit = async (text) => {
  tmux('send-keys', '-t', SESS, 'C-u'); await sleep(150)
  // Read-back BEFORE Enter: the composer still holds the typed text; C-u has
  // already cleared any stale residue. Retry once only on a genuine mismatch.
  await typeText(text); await sleep(250)
  const typed = inputRow(capture(false))
  if (typed && typed !== text) { tmux('send-keys', '-t', SESS, 'C-u'); await sleep(150); await typeText(text); await sleep(250) }
  tmux('send-keys', '-t', SESS, 'Enter')
}

const results = []
// `want` lists ANY honest branch of the wired face (picker / real data / the
// command's own no-* notice) — NOT a fabricated success. Cold boot has no
// active session, so /export honestly says noSession; that still proves the
// face is wired (the unavailable notice is the only thing that must be absent).
const CMDS = [
  { name: '01-export', cmd: '/export w1a-proof.jsonl', no: 'command.export.unavailable', want: ['exported', 'journal records', 'no active session to export'] },
  { name: '02-think', cmd: '/think', no: 'command.think.unavailable', want: ['Select reasoning effort', 'no reasoning efforts', 'reasoning effort'] },
  { name: '03-preset', cmd: '/preset', no: 'command.preset.unavailable', want: ['Select agent preset', 'no agent presets', 'agent preset'] },
  { name: '04-login', cmd: '/login', no: 'command.login.unavailable', want: ['Add provider', 'Custom provider', 'route id', 'provider'] },
  { name: '05-logout', cmd: '/logout', no: 'command.logout.unavailable', want: ['no logged-in providers', 'Log out provider', 'logged-in'] },
  { name: '06-btw', cmd: '/btw ping', no: 'command.btw.unavailable', want: ['side-session', '波2', 'wave 2', 'SIDE_SESSION_NOT_WIRED', 'not wired'] },
]

let booted = false
try {
  await startMock()
  tmux('kill-session', '-t', SESS)
  const env = [`DSH_HOME=${HOME}`, 'DSH_OPENTUI_DEBUG=1', 'ZAI_CODING_CN_API_KEY=mock-only-key', 'ZAI_CODING_CN_BASE_URL=']
  const r = tmux('new-session', '-d', '-x', '120', '-y', '34', '-s', SESS, '-c', WS,
    `${env.join(' ')} ${LAUNCHER} --client 2>${join(OUT, 'client.err.log')}`)
  if (r.status !== 0) throw new Error('tmux boot failed: ' + r.stderr)
  const boot = await waitPane((o) => o.includes('🧠') || idle(o), 90_000)
  if (!boot.ok) { console.error('w1a-six: client never reached composer'); process.exit(2) }
  booted = true
  await waitPane(idle, 20_000)
  for (const c of CMDS) {
    // Close ANY overlay left by the previous command (picker / form / modal),
    // else its key-eating layer swallows this command's keystrokes and poisons
    // the frame (the 12-cascade-red class from agents-mount). 3x Esc walks
    // back an inner layer + the outer picker; harmless when the composer is
    // already focused (idle Esc is a no-op).
    for (let i = 0; i < 3; i++) { tmux('send-keys', '-t', SESS, 'Escape'); await sleep(150) }
    await sleep(200)
    await submit(c.cmd)
    await sleep(c.name === '06-btw' ? 2500 : 1500)
    const frame = capture(true)
    writeFileSync(join(OUT, `${c.name}.ans`), frame)
    const plain = frame.replace(/\x1b\[[0-9;]*m/g, '')
    const degraded = plain.includes(c.no) || plain.includes('unavailable')
    const wanted = c.want.some((w) => plain.includes(w))
    const ok = !degraded && wanted
    results.push({ cmd: c.cmd, ok, degraded, wanted })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  "${c.cmd}"  degraded=${degraded} wanted=${wanted}`)
  }
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(results, null, 2))
} catch (err) {
  console.error('w1a-six: ' + (err?.message || err))
  process.exit(2)
} finally {
  if (booted) tmux('kill-session', '-t', SESS)
  if (mock) { try { mock.kill('SIGTERM') } catch {} }
  try { rmSync(HOME, { recursive: true, force: true }) } catch {}
  try { rmSync(WS, { recursive: true, force: true }) } catch {}
}
const failed = results.filter((r) => !r.ok).length
console.log(`w1a-six: ${results.length - failed}/${results.length} commands non-degraded`)
process.exit(failed === 0 ? 0 : 1)
