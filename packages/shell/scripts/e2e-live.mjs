#!/usr/bin/env node
// Live interactive E2E for @aiwayds/dsh-opentui against the REAL installed
// profile (real dsh host, real model turns, slow-typed piped keys).
//
// Skips (exit 0) when the environment can't run it: no global dsh on PATH
// or no provider key in the environment — CI runs skip; a developer
// machine with the profile installed runs the full 19-check suite.
// Drive mechanics notes:
// - alt-screen repaints in place: every check is presence-over-time on the
//   whole stream, never window offsets (they mis-slice);
// - piped stdin DROPS burst-written keys in OpenTUI's input parser — all
//   typing is fed char-by-char with a ~60ms inter-key gap;
// - OSC sequences end in BEL or ST; a BEL-only strip regex eats across
//   frames and fakes negatives.
// Boots the real `dsh --profile dsh-opentui`, drives it through piped
// stdin, and asserts on cumulative output (alt-screen repaints in place —
// presence-over-time, never window offsets).
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

import { spawnSync } from 'node:child_process'

const PROFILE = 'dsh-opentui'
const SKIP = (() => {
  const which = spawnSync('which', ['dsh'], { encoding: 'utf8' })
  if (which.status !== 0 || !which.stdout.trim()) return 'no global dsh on PATH'
  return null
})()
if (SKIP) {
  console.log(`e2e-live: skipped (${SKIP})`)
  process.exit(0)
}
const cwd = `${process.env.HOME}/.dsh/profiles/${PROFILE}`
const RAW = '/tmp/opentui-e2e.raw.txt'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const env = { ...process.env, NODE_OPTIONS: '--experimental-ffi' }
delete env.DSH_HOME
env.PATH = env.PATH.split(':')
  .filter((s) => s && !s.includes('dsh-opentui/node_modules/.bin'))
  .join(':')
for (const k of Object.keys(env)) if (k.startsWith('npm_config_')) delete env[k]

const child = spawn('dsh', ['--profile', PROFILE], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
let out = ''
child.stdout.on('data', (c) => { out += c })
child.stderr.on('data', (c) => { out += c })

// OpenTUI's stdin parser drops keys from burst writes under piped stdin —
// feed char-by-char with a real inter-key gap (a real terminal always does).
const send = async (line) => {
  for (const ch of line) { child.stdin.write(ch); await sleep(60) }
  child.stdin.write('\r')
}
const results = []
const check = (name, ok, hint = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ← ' + hint}`)
}

// Wait for the current turn to END before driving the next phase. Fixed
// sleeps raced provider latency: a slow counting turn (~5 tok/s that day)
// ran past the budget and every later keystroke landed mid-turn, where the
// TUI has no command/picker surface — 5 phantom FAILs with zero markers in
// the stream. Detection: the live think/tool dock keeps re-painting into
// the stream tail while a turn runs (its timer ticks every second); after
// the turn ends only the powerline clock repaints, so a tail window free
// of 💭/thinking/⚙ means idle. The powerline clock keeps raw length
// growing forever, so whole-stream length quiescence never fires.
const waitTurnEnd = async (minMs, maxMs) => {
  await sleep(minMs)
  const t0 = Date.now()
  let idleStreak = 0
  while (Date.now() - t0 < maxMs) {
    await sleep(2000)
    const tail = out.slice(-3000)
    const busy = tail.includes('💭') || tail.includes('thinking') || tail.includes('⚙')
    idleStreak = busy ? 0 : idleStreak + 1
    if (idleStreak >= 3) return true // 6s of clock-only tail = turn over
  }
  return false
}

try {
  await sleep(9000) // boot + welcome + powerline

  // --- turn 1: tool use → ToolWidget ⚙, ⚒ counter, live TPS, answer
  await send('用 bash 工具运行 date 命令，然后告诉我今天是几月几号。只回答一句话。')
  await sleep(6000) // mid-turn: TPS segment + thinking + tool active
  const midTurn = out.length
  await waitTurnEnd(10000, 120000)

  // --- turn 2: todos + steering
  await send('先用 todo 工具记录两个任务：测试多行、收尾，然后从 1 数到 20，每个数字单独一行。')
  await sleep(5000)
  await send('改一下：只要数到 10 就行。')
  await waitTurnEnd(30000, 300000)

  // --- /theme picker opens, esc closes
  await send('/theme')
  await sleep(2000)
  const themeOpen = out.length
  child.stdin.write('\x1b') // esc closes the overlay
  await sleep(1500)

  // --- multi-line submit: alt+enter (= ESC CR) inserts a newline
  for (const ch of '第一行') { child.stdin.write(ch); await sleep(60) }
  child.stdin.write('\x1b\r')
  await sleep(300)
  for (const ch of '第二行') { child.stdin.write(ch); await sleep(60) }
  await sleep(600)
  child.stdin.write('\r') // Enter submits the buffer
  await sleep(8000)

  // --- subagent turn: dispatch a child, expect panel rows (tree rail)
  await send('派一个子代理去运行 ls 命令看看当前目录有什么，然后把结果告诉我。')
  await waitTurnEnd(30000, 300000)

  // --- /history fork at the newest turn boundary + context probe
  await send('/history')
  await sleep(2000)
  child.stdin.write('\r') // pick the highlighted (newest) turn
  await sleep(6000)
  await send('刚才我最后请你做的是什么？一句话回答。')
  await waitTurnEnd(30000, 240000)

  child.stdin.end()
  await Promise.race([sleep(4000), new Promise((r) => child.once('exit', r))])
} finally {
  child.kill('SIGTERM')
  writeFileSync(RAW, out)
}

const plain = out.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\\\)/g, '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
const full = plain
const themeWin = plain.slice(0) // whole stream; markers are phase-specific

check('welcome banner (block DSH)', /D\s*S\s*H|█|▄|▀/.test(full) || full.includes('dsh ·'), 'no ascii DSH')
check('daily quote 「…」', full.includes('「') && full.includes('」'), 'no quote')
check('powerline clock ticks', /\d{1,2}:\d{2}:\d{2}/.test(full), 'no clock')
check('ThinkWidget appears', full.includes('💭') || full.includes('thinking ·'), 'no think dock')
check('ToolWidget ⚙ running state', full.includes('⚙'), 'no ⚙')
check('tool counter ⚒', full.includes('⚒'), 'no ⚒')
check('live TPS segment (tok/s)', full.includes('tok/s'), 'no tok/s anywhere')
check('answer delivered (Chinese date phrase)', /\d{1,2}月\d{1,2}日/.test(full), 'no rendered 中文日期 in reply')
check('steer ⚡ line', full.includes('⚡'), 'no ⚡')
check('todo panel 📋 or ▶/☐ rows', full.includes('📋') || full.includes('☐') || full.includes('▶'), 'no todo widget rows')
check('theme picker opened (dark/light group headers)', themeWin.includes('dark') && themeWin.includes('light'), 'no group headers')
check('theme picker lists themes (dracula)', themeWin.includes('dracula'), 'no dracula in stream')
check('multi-line submit (第一行+第二行 as user row)', full.includes('第一行') && full.includes('第二行'), 'multi-line rows missing')
check('subagent panel rows (tree rail)', full.includes('├─') || full.includes('└─'), 'no subagent rail rows')
check('history picker items (fork before this turn)', full.includes('fork before this turn'), 'no picker item rows')
check('fork transcript rebuild without internal leak', !out.replace(/\s+/g, '').includes('Currentruntimecontext'), 'runtime-context leaked into rebuild')
check('no loader failure markers', !full.includes('did not activate') && !full.includes('failed to import'), '')
check('no SSR leak (dist/server.js)', !out.includes('dist/server.js'), '')
check('alt-screen entered', out.includes('\x1b[?1049h'), '')

const fails = results.filter((r) => !r.ok)
console.log(`\n${results.length - fails.length}/${results.length} passed — raw: ${RAW} (${out.length} bytes)`)
process.exit(fails.length ? 1 : 0)
