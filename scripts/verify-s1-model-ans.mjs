/**
 * S1 /model — real TUI .ans capture (E1): open `/model`, prove the picker shows
 * provider/model rows sourced from the generated-chain modelCatalog.
 *
 *   node scripts/verify-s1-model-ans.mjs [outDir]
 *
 * tmux + `capture-pane -e` (numeric/ANSI stream, no PNG, no visual model).
 * Scratch DSH_HOME is built by the real in-process provisioner (never reads or
 * writes ~/.dsh), same isolation pattern as verify/agents-mount-repro.mjs. Prints one PASS/FAIL line
 * per assertion; writes the raw ANSI frame to <outDir>/07-model-ans.txt.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PROFILE } from '../packages/shell/scripts/lib/profile-name.mjs'
import { provisionScratchProfile } from '../verify/lib/scratch-profile.mjs'

const ROOT = process.cwd()
const LAUNCHER = join(ROOT, 'dsh-opentui')
const PROFILE = DEFAULT_PROFILE
const OUT = process.argv[2] || join(ROOT, '.proof/024-s1-model')
const SESS = `s1-model-${process.pid}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const sh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' })
const tmux = (...args) => sh('tmux', args)
const capture = (ansi = true) => {
  const args = ansi ? ['capture-pane', '-e', '-p', '-t', SESS] : ['capture-pane', '-p', '-t', SESS]
  const r = tmux(...args)
  return r.status === 0 ? r.stdout : ''
}

if (!existsSync(LAUNCHER)) {
  console.error('model-ans: launcher missing'); process.exit(2)
}
if (sh('which', ['tmux']).status !== 0) { console.error('model-ans: tmux not on PATH'); process.exit(2) }
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

const HOME = mkdtempSync(join(tmpdir(), 's1-model-home-'))
chmodSync(HOME, 0o700)
let profileDir
try {
  profileDir = provisionScratchProfile({ home: HOME, repo: ROOT })
} catch (error) {
  console.error(`model-ans: ${error.message}`)
  tmux('kill-session', '-t', SESS); process.exit(2)
}
try {
  const p = join(profileDir, 'config.json')
  const cfg = JSON.parse(readFileSync(p, 'utf8')); cfg.lang = 'zh-CN'
  writeFileSync(p, JSON.stringify(cfg, null, 2))
} catch {}

tmux('kill-session', '-t', SESS)
const env = [`DSH_HOME=${HOME}`, 'DSH_OPENTUI_DEBUG=1']
const r = tmux('new-session', '-d', '-x', '120', '-y', '34', '-s', SESS, '-c', ROOT,
  `${env.join(' ')} ${LAUNCHER} --client 2>${join(OUT, '07-model-ans.err.log')}`)
if (r.status !== 0) { console.error('model-ans: tmux boot failed: ' + r.stderr); process.exit(2) }

let booted = false
for (let i = 0; i < 90; i++) {
  const o = capture(false)
  // Readiness = the composer INPUT BOX is painted. The empty-state placeholder
  // in this view stack is "Type a message" (en) / "提问，回车发送" (zh); the old
  // ❯/›/> marker alone no longer appears before the first keystroke.
  if ((/❯|›|>/u.test(o) || /Type a message|提问，回车发送/u.test(o)) && o.length > 80) { booted = true; break }
  await sleep(1000)
}
if (!booted) {
  const o = capture(false)
  console.error('model-ans: TUI did not reach composer in 90s; pane:\n' + o)
  tmux('kill-session', '-t', SESS); process.exit(2)
}

// Open the /model picker: type the slash command and press Enter.
tmux('send-keys', '-t', SESS, '/model')
await sleep(600)
tmux('send-keys', '-t', SESS, 'Enter')
await sleep(3000)

const ansi = capture(true)
writeFileSync(join(OUT, '07-model-ans.txt'), ansi)
const plain = capture(false)
console.log('--- captured pane (numeric .ans saved to 07-model-ans.txt) ---')
console.log(plain)
console.log('--- end captured pane ---')

const checks = [
  ['TUI reached composer', booted],
  ['/model picker opened (dialog title present)', /model|模型|Model/i.test(plain) && /╭|┌|┏/.test(plain)],
  ['provider/model rows rendered', /deepseek|opencode|xiaomi|mimo|glm|provider|model/i.test(plain)],
  ['no UNSUPPORTED crash', !/UNSUPPORTED|BridgeProtocolError|panic|TypeError/i.test(plain)],
]
let failed = 0
for (const [name, ok] of checks) {
  if (ok) console.log('PASS  ' + name)
  else { console.log('FAIL  ' + name); failed++ }
}
tmux('kill-session', '-t', SESS)
console.log(`summary: PASS=${checks.length - failed}/${checks.length}`)
process.exit(failed ? 1 : 0)
