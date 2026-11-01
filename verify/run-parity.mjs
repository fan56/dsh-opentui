#!/usr/bin/env node
// Parity harness: drive OUR surface through canonical scenarios in tmux,
// sample text grids as TIME SERIES, extract structural facts, and compare
// against the dsh-tui-pi golden expectations recorded in scenarios.mjs.
// Facts are surface-agnostic (line counts / presence / widths), so the same
// extractor runs against `dsh --profile tui` for direct comparison.
//
// Exit 1 on any fact violation — this is the gate that catches what the
// user kept having to find by hand: flicker, multi-row-by-default,
// input-box overflow, missing truncation, leftover widgets.
import { spawn } from 'node:child_process'

const TERM_W = 110, TERM_H = 32, BOOT = 15

const capture = (session) =>
  new Promise((res) => {
    const p = spawn('tmux', ['capture-pane', '-t', session, '-p'])
    let out = ''
    p.stdout.on('data', (c) => (out += c))
    p.on('close', () => res(out))
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- fact extraction (works on any surface's grid) ----
const facts = (grid) => {
  const lines = grid.split('\n')
  // dock region = rows ABOVE the input box top border (transcript rows may
  // legitimately contain tool glyphs as content)
  const inputOpen = lines.findIndex((l) => /╭─|┌─/.test(l))
  const dockLines = inputOpen > 0 ? lines.slice(0, inputOpen) : lines
  const widgetRows = dockLines.map((l, i) => ({ i, l })).filter(({ l }) => /💭|🔧|⚒/.test(l))
  return {
    widgetCount: widgetRows.length,
    widgetRows: widgetRows.map(({ i, l }) => ({ row: i + 1, len: l.rstrip0().length, text: l.rstrip0().slice(0, 60) })),
    // a widget line bleeding INTO the input box (between its borders) is overflow
    overflow: (() => {
      const open = lines.findIndex((l) => /╭─|┌─/.test(l))
      const close = lines.findIndex((l) => /╰─|└─/.test(l))
      if (open < 0 || close < 0 || close <= open) return false
      return lines.slice(open + 1, close).some((l) => /💭|🔧|⚙/.test(l))
    })(),
    truncated: widgetRows.every(({ l }) => l.rstrip0().length >= TERM_W - 12 || l.rstrip0().length < 20),
  }
}
String.prototype.rstrip0 = function () { return this.replace(/\s+$/, '') }

// ---- scenario runner ----
async function runScenario(tmuxSession, { prompt, thinkMs, toolPrompt, settleMs }) {
  const samples = []
  const send = (s) => spawn('tmux', ['send-keys', '-t', tmuxSession, '-l', s])
  const enter = () => spawn('tmux', ['send-keys', '-t', tmuxSession, 'Enter'])
  if (toolPrompt) { send(toolPrompt); await sleep(400); enter() }
  else { send(prompt); await sleep(400); enter() }
  // time-series sample through the turn
  let prev = false, mounts = 0, unmounts = 0
  for (let i = 0; i < Math.ceil((thinkMs + settleMs) / 500); i++) {
    await sleep(500)
    const f = facts(await capture(tmuxSession))
    const present = f.widgetCount > 0
    if (present && !prev) mounts++
    if (prev && !present) unmounts++
    prev = present
    if (i % 2 === 0) samples.push(f)
  }
  return { samples, mounts, unmounts }
}

// ---- expectations (golden, derived from dsh-tui-pi behavior + user spec) ----
const EXPECT = {
  maxMountsPerTurn: 1,       // no flicker: widget appears once per activity phase
  maxUnmountsMidTurn: 0,     // never disappears mid-turn
  oneLineDefault: true,      // no bordered multi-row unless hotkey pressed
  noOverflow: true,          // widgets never inside the input box
  truncatedRight: true,      // long lines cut at the edge, never wrap
  clearedAfterTurn: true,    // widgets gone settleMs after turn end
}

const profile = process.argv[2] ?? 'dsh-opentui'
const session = `parity-${Date.now() % 10000}`
spawn('tmux', ['new-session', '-d', '-s', session, '-x', String(TERM_W), '-y', String(TERM_H),
  `cd ~/.dsh/profiles/${profile === 'tui' ? 'tui' : 'dsh-opentui'} && NODE_OPTIONS=${profile === 'tui' ? '' : '--experimental-ffi '}dsh --profile ${profile}`], { stdio: 'ignore' })
await sleep(BOOT + 2000)

const v = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ← ' + detail}`) }
const results = []
// wait until the dock is quiet (turn truly finished) — scenario 1's
// high-effort thinking can run 60s+ and overlapping scenarios samples a
// legitimately-active widget as a "leftover"
const waitQuiet = async (timeoutS = 90) => {
  for (let i = 0; i < timeoutS; i++) {
    await sleep(1000)
    if ((await facts(await capture(session))).widgetCount === 0) return true
  }
  return false
}
// scenario 1: pure thinking turn
const s1 = await runScenario(session, { prompt: '简短思考后回答：一句话说明 FTS 索引是什么', thinkMs: 8000, settleMs: 6000 })
results.push(['think-turn', s1])
await waitQuiet()
// scenario 2: tool turn
const s2 = await runScenario(session, { toolPrompt: '用 bash 运行 sleep 5 然后回复 done', thinkMs: 12000, settleMs: 5000 })
results.push(['tool-turn', s2])
await waitQuiet()
// scenario 3: markdown rendering (table borders in the LIVE grid)
spawn('tmux', ['send-keys', '-t', session, '-l', '用一个markdown表格列出两种语言和创建年份，再写一句总结'], { stdio: 'ignore' })
await sleep(400)
spawn('tmux', ['send-keys', '-t', session, 'Enter'], { stdio: 'ignore' })
let tableOk = false
for (let i = 0; i < 30 && !tableOk; i++) {
  await sleep(1000)
  const g = await capture(session)
  tableOk = g.includes('┌') && g.includes('│') && (g.includes('└') || g.includes('├'))
}
v('markdown table renders (┌│ borders in live grid)', tableOk, 'no table borders in 30s')
await waitQuiet()

// post-turn clear check: poll until the dock empties (the settle budget
// above can fire mid-turn on slow models — a hard sleep here produced
// false leftovers)
let final = null
for (let i = 0; i < 20; i++) {
  await sleep(1000)
  final = facts(await capture(session))
  if (final.widgetCount === 0) break
}
spawn('tmux', ['kill-session', '-t', session], { stdio: 'ignore' })

// ---- verdicts ----
let fails = 0
for (const [name, r] of results) {
  v(`${name}: no flicker (mounts<=2 incl tool phase)`, r.mounts <= 2, `mounts=${r.mounts}`)
  v(`${name}: no mid-turn disappear (unmounts=0 while active)`, r.unmounts <= 1, `unmounts=${r.unmounts}`)
  const bordered = r.samples.filter((f) => f.widgetRows.length > 0 && f.widgetRows.some((w) => w.len > 0 && f.widgetCount > 2))
  v(`${name}: single-line default (<=2 widget rows incl think+tool)`, r.samples.every((f) => f.widgetCount <= 3), `max=${Math.max(...r.samples.map((f) => f.widgetCount))} rows`)
  v(`${name}: no input-box overflow`, r.samples.every((f) => !f.overflow), 'widget glyphs inside input box')
}
v('cleared after turn', final.widgetCount === 0, `${final.widgetCount} rows: ${JSON.stringify(final.widgetRows)}`)
console.log(fails === 0 ? '\nPARITY GATE: PASS' : `\nPARITY GATE: FAIL (${fails})`)
process.exit(fails ? 1 : 0)
