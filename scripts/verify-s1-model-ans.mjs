/**
 * S1 /model — real TUI .ans capture (E1): open `/model`, prove the picker shows
 * provider/model rows sourced from the generated-chain modelCatalog.
 *
 *   node scripts/verify-s1-model-ans.mjs [outDir]
 *
 * tmux + `capture-pane -e` (numeric/ANSI stream, no PNG, no visual model).
 * Scratch DSH_HOME is seeded from the real home (no writes to ~/.dsh), same
 * isolation pattern as verify/agents-mount-repro.mjs. Prints one PASS/FAIL line
 * per assertion; writes the raw ANSI frame to <outDir>/07-model-ans.txt.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const LAUNCHER = join(ROOT, 'dsh-opentui')
const REAL_HOME = join(homedir(), '.dsh')
const PROFILE = 'opentui'
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

if (!existsSync(LAUNCHER) || !existsSync(join(REAL_HOME, 'profiles', PROFILE))) {
  console.error('model-ans: launcher or real profile missing'); process.exit(2)
}
if (sh('which', ['tmux']).status !== 0) { console.error('model-ans: tmux not on PATH'); process.exit(2) }
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

const HOME = mkdtempSync(join(tmpdir(), 's1-model-home-'))
chmodSync(HOME, 0o700)
mkdirSync(join(HOME, 'profiles'), { recursive: true })
cpSync(join(REAL_HOME, 'profiles', PROFILE), join(HOME, 'profiles', PROFILE), { recursive: true })
for (const rel of ['.credentials.yaml', 'models-store.json', 'model-profiles.json', 'settings.yaml', 'workspace-presets.json']) {
  const from = join(REAL_HOME, rel)
  if (existsSync(from)) cpSync(from, join(HOME, rel), { recursive: true })
}
// 024 real-client runner fix: seed a PROVISIONED in-process host into the
// scratch HOME. The real home's opentui-inproc bridge symlink points at a
// cleaned-up worktree; copying profiles alone yields BRIDGE_TIMEOUT. The
// provisioner (with --repair) creates/repairs the inproc profile from THIS
// installation. No writes to ~/.dsh.
{
  const prov = join(ROOT, 'packages', 'shell', 'scripts', 'provision-inproc-profile.mjs')
  const r = spawnSync(process.execPath, [prov, '--repair'], { encoding: 'utf8', env: { ...process.env, DSH_HOME: HOME } })
  if (r.status !== 0) {
    console.error('model-ans: in-process profile provisioning failed:\n' + (r.stderr || r.stdout))
    tmux('kill-session', '-t', SESS); process.exit(2)
  }
}
try {
  const p = join(HOME, 'profiles', PROFILE, 'config.json')
  const cfg = JSON.parse(readFileSync(p, 'utf8')); cfg.lang = 'zh-CN'
  writeFileSync(p, JSON.stringify(cfg, null, 2))
} catch {}

tmux('kill-session', '-t', SESS)
// The client lazily imports @deepseek-ai/dsh-client-connection from the shared
// profiles tree (~/.dsh/profiles/node_modules in the real home); seed that path
// in the scratch HOME so the lazy import resolves without writing to ~/.dsh.
try { cpSync(join(REAL_HOME, 'profiles', 'node_modules'), join(HOME, 'profiles', 'node_modules'), { recursive: true }) } catch {}
const env = [`DSH_HOME=${HOME}`, `NODE_PATH=${join(HOME, 'profiles', 'node_modules')}`, 'DSH_OPENTUI_DEBUG=1']
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
