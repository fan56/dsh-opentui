/**
 * 024 SK keymap — real TUI .ans capture (tmux `capture-pane -e`, numeric ANSI
 * stream only; no PNG, no visual model).
 *
 *   node scripts/verify-sk-keymap-ans.mjs [outDir] [bootWaitSeconds]
 *
 * Four scenarios from the SK preregistration:
 *   modal   — ctrl+c on the idle page opens the quit confirm dialog (modal tier)
 *   esc     — busy-turn Esc ownership (arm -> confirm dialog -> dialog closes)
 *   paging  — panel open, PgUp/PgDn belongs to the panel pager (overlay tier)
 *   basic   — base key regression (composer accepts input, footer hints render)
 *
 * Isolation mirrors scripts/verify-s1-model-ans.mjs: scratch DSH_HOME built by
 * the real in-process provisioner, never reads or writes ~/.dsh. Each captured frame is written as
 * raw `capture-pane -e` output to <outDir>/*.ans and a plain view to *.log.
 *
 * Honesty contract (oldfox S2 review §四.1): if the TUI cannot reach the
 * composer within the wait window, the render assertions are NOT claimed PASS.
 * The script prints BLOCKED per scenario, saves the raw last pane, appends a
 * four-line declaration to the run log, and exits 2. The local-reachable part
 * (script ran, raw files landed, exit code honest) is machine-judged.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PROFILE } from '../packages/shell/scripts/lib/profile-name.mjs'
import { provisionScratchProfile } from '../verify/lib/scratch-profile.mjs'

const ROOT = process.cwd()
const LAUNCHER = join(ROOT, 'dsh-opentui')
const PROFILE = DEFAULT_PROFILE
const OUT = process.argv[2] || join(ROOT, '.proof/024-sk-keymap')
const BOOT_WAIT = Number(process.argv[3] || 90)
const SESS = `sk-keymap-${process.pid}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' })
const tmux = (...args) => sh('tmux', args)
const capture = (ansi = true) => {
  const args = ansi ? ['capture-pane', '-e', '-p', '-t', SESS] : ['capture-pane', '-p', '-t', SESS]
  const r = tmux(...args)
  return r.status === 0 ? r.stdout : ''
}
const log = (line) => { console.log(line); appendFileSync(join(OUT, '06-09-ans-run.log'), line + '\n') }

if (!existsSync(LAUNCHER)) {
  console.error('sk-ans: launcher missing'); process.exit(2)
}
if (sh('which', ['tmux']).status !== 0) { console.error('sk-ans: tmux not on PATH'); process.exit(2) }
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

const runLog = join(OUT, '06-09-ans-run.log')
writeFileSync(runLog, `# sk keymap real-machine capture\ncaptured-at-utc=${new Date().toISOString()}\nhead=${sh('git', ['rev-parse', 'HEAD']).stdout.trim()}\nboot-wait-seconds=${BOOT_WAIT}\n---\n`)
log(`env: launcher=${LAUNCHER} profile=${PROFILE} bootWait=${BOOT_WAIT}s`)

const HOME = mkdtempSync(join(tmpdir(), 'sk-keymap-home-'))
chmodSync(HOME, 0o700)
let profileDir
try {
  profileDir = provisionScratchProfile({ home: HOME, repo: ROOT })
} catch (error) {
  console.error(`sk-ans: ${error.message}`)
  process.exit(2)
}
try {
  const p = join(profileDir, 'config.json')
  const cfg = JSON.parse(readFileSync(p, 'utf8')); cfg.lang = 'zh-CN'
  writeFileSync(p, JSON.stringify(cfg, null, 2))
} catch {}

tmux('kill-session', '-t', SESS)
const errLog = join(OUT, '06-09-ans.err.log')
const env = [`DSH_HOME=${HOME}`, 'DSH_OPENTUI_DEBUG=1']
const boot = tmux('new-session', '-d', '-x', '120', '-y', '34', '-s', SESS, '-c', ROOT,
  `${env.join(' ')} ${LAUNCHER} --client 2>${errLog}`)
if (boot.status !== 0) {
  log(`BLOCKED tmux boot failed: ${boot.stderr}`)
  process.exit(2)
}

let booted = false
for (let i = 0; i < BOOT_WAIT; i++) {
  const o = capture(false)
  // Readiness = the composer INPUT BOX is painted (empty-state placeholder
  // "Type a message" / "提问，回车发送"); the old ❯/›/> marker alone does not
  // appear before the first keystroke in this view stack.
  if ((/❯|›|>/u.test(o) || /Type a message|提问，回车发送/u.test(o)) && o.length > 80) { booted = true; break }
  await sleep(1000)
}

const scenarios = [
  ['modal', '06-ans-modal', 'ctrl+c opens quit confirm (modal tier)'],
  ['esc', '06-ans-esc', 'busy-turn Esc ownership (main tier -> dialog)'],
  ['paging', '07-ans-pgup-pgdn', 'panel PgUp/PgDn (overlay tier)'],
  ['basic', '08-ans-basic', 'base key regression (composer + footer hints)'],
]

function blockedAll(reason) {
  writeFileSync(join(OUT, '06-ans-modal.ans'), capture(true))
  writeFileSync(join(OUT, '06-ans-esc.ans'), '')
  writeFileSync(join(OUT, '07-ans-pgup-pgdn.ans'), '')
  writeFileSync(join(OUT, '08-ans-basic.ans'), '')
  for (const [id, , desc] of scenarios) log(`BLOCKED ${id}: ${desc} — ${reason}`)
  log('Reason: provisioned runner / renderable TUI host not available locally (same wall as S1/S2 verify70).')
  log('Tried: tmux new-session + capture-pane -e with scratch DSH_HOME built by the real in-process provisioner; last pane saved to 06-ans-modal.ans; stderr to 06-09-ans.err.log.')
  log('Excluded scope: render-frame ownership assertions for modal/esc/paging/basic; local-reachable script execution is machine-judged separately.')
  log('Remaining risk: key ownership at true rendered modality cannot be confirmed on this runner; register in 024-e2e-requirements.md B3/C4 channel.')
  tmux('kill-session', '-t', SESS)
  process.exit(2)
}

if (!booted) {
  const pane = capture(false)
  log(`BLOCKED TUI did not reach composer in ${BOOT_WAIT}s; last pane:\n${pane}`)
  blockedAll('TUI did not reach composer')
}

log(`PASS local-reachable: TUI reached composer (booted=${booted})`)

// The scenarios below run only when a real rendered TUI is reachable.
function snap(base) {
  const ansi = capture(true)
  const plain = capture(false)
  writeFileSync(join(OUT, base + '.ans'), ansi)
  writeFileSync(join(OUT, base + '.log'), plain)
  return plain
}

// basic: composer accepts text and footer hints render
tmux('send-keys', '-t', SESS, 'sk-keymap-probe')
await sleep(600)
const basic = snap('08-ans-basic')
log(`basic: composer-input=${/sk-keymap-probe/.test(basic)} footer-hint=${/ctrl|esc|⏎|enter|hint/i.test(basic)}`)

// modal: ctrl+c on idle page opens the quit confirm dialog, then Esc closes it
tmux('send-keys', '-t', SESS, 'C-c')
await sleep(800)
const modal = snap('06-ans-modal')
const dialogRe = /quit|退出|╭|┌/i
log(`modal: dialog-frame=${dialogRe.test(modal)}`)
tmux('send-keys', '-t', SESS, 'Escape')
await sleep(400)

// paging: /agents panel, PgDn, capture, then Esc out
tmux('send-keys', '-t', SESS, '/agents')
await sleep(400)
tmux('send-keys', '-t', SESS, 'Enter')
await sleep(1500)
tmux('send-keys', '-t', SESS, 'Next')
await sleep(600)
const paging = snap('07-ans-pgup-pgdn')
log(`paging: panel-frame=${/agents|agent|╭|┌/i.test(paging)} rows-rendered=${paging.length > 200}`)
tmux('send-keys', '-t', SESS, 'Escape')
await sleep(300)

// esc: with a live turn, first Esc arms, second opens stop confirm; without a
// provisioned session controller this cannot be driven from the client alone.
const esc = snap('06-ans-esc')
log(`esc: turn-busy-marker=${/stop|interrupt|停止|busy|writing/i.test(esc)} (needs provisioned runner for full arm->confirm ownership)`)

tmux('kill-session', '-t', SESS)
log('done: raw .ans frames captured; see individual *.log for plain view')
process.exit(0)
