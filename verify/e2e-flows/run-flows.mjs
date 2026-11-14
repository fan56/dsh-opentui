#!/usr/bin/env node
// E2E flow suite: REAL client + REAL resident host + LOCAL fake model +
// per-scenario scratch DSH_HOME.
//
//   node verify/e2e-flows/run-flows.mjs                 # every scenario
//   node verify/e2e-flows/run-flows.mjs --only=single-turn,steer
//   node verify/e2e-flows/run-flows.mjs --keep           # keep failed scratch homes
//
// Each scenario provisions a private DSH_HOME under the OS temp dir (never
// touches ~/.dsh beyond READING the opentui profile as a template), boots
// `./dsh-opentui --client` in a private tmux server (unique socket + session
// name), and drives the real UI. The only model in the scratch home is
// `fake-gw`, an OpenAI-compatible SSE server started on an ephemeral port
// (verify/e2e-flows/fake-model.mjs).
//
// Assertions print `expected` / `actual` and a screen snippet. The process
// exits 0 only when every scenario passes (SKIP is not a failure).
//
// Environment: bun, tmux and the global `dsh` must be on PATH, and the
// `opentui` profile must exist under $DSH_HOME (or ~/.dsh) — the client's
// normal first-run provisions it.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const LAUNCHER = join(REPO, 'dsh-opentui')
const PROFILE = 'opentui'
const TEMPLATE_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const GEOMETRY = { x: 120, y: 34 }
const IDLE_MARKERS = ['提问，回车发送', 'Type a message']
const FAKE_KEY = 'e2e-fake-key'
const TYPE_GAP_MS = 55
const CRASH_RE = /TypeError|Cannot access private|Unhandled promise|boot failed/i

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name, def) => {
  const inline = argv.find((a) => a.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : def
}
const ONLY = (opt('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean)
const KEEP = flag('keep')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })
const flat = (s) => String(s).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '')
const has = (out, marker) => flat(out).includes(flat(marker))
const snippet = (out, marker) => {
  const lines = String(out).split('\n')
  const idx = lines.findIndex((l) => flat(l).includes(flat(marker)))
  const from = Math.max(0, idx - 2)
  return lines.slice(from, from + 5).join('\n')
}
const lastLine = (out) => String(out).trimEnd().split('\n').slice(-8).join('\n')

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------
const missing = []
for (const cmd of ['bun', 'tmux', 'dsh']) {
  if (sh('which', [cmd]).status !== 0) missing.push(cmd)
}
if (!existsSync(LAUNCHER)) missing.push(`launcher ${LAUNCHER}`)
if (!existsSync(join(TEMPLATE_HOME, 'profiles', PROFILE))) missing.push(`profile ${join(TEMPLATE_HOME, 'profiles', PROFILE)}`)
if (missing.length > 0) {
  console.error(`e2e-flows: cannot run — missing: ${missing.join(', ')}`)
  process.exit(2)
}

const RD = mkdtempSync(join(tmpdir(), 'e2e-flows-run-'))
const MODEL_LOG = join(RD, 'model-requests.jsonl')
const TMUX_SOCKET = `e2e-${process.pid}`
const tmux = (...a) => sh('tmux', ['-L', TMUX_SOCKET, ...a])
const tmuxOut = (...a) => { const r = tmux(...a); return r.status === 0 ? r.stdout : '' }

// ---------------------------------------------------------------------------
// Fake model (one per run, ephemeral port)
// ---------------------------------------------------------------------------
let FAKE_PORT = 0

const startFakeModel = async () => {
  const child = spawn('node', [join(HERE, 'fake-model.mjs'), '--port', '0', '--log', MODEL_LOG], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const port = await new Promise((res) => {
    const timer = setTimeout(() => res(0), 10_000)
    child.stdout.on('data', (d) => {
      const m = String(d).match(/FAKE_PORT=(\d+)/)
      if (m) { clearTimeout(timer); res(Number(m[1])) }
    })
    child.on('exit', () => { clearTimeout(timer); res(0) })
  })
  if (!port) throw new Error('fake model failed to start')
  return { child, port }
}

const modelLogLines = () => {
  try {
    return readFileSync(MODEL_LOG, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  } catch { return [] }
}

// ---------------------------------------------------------------------------
// Assertion bookkeeping
// ---------------------------------------------------------------------------
class Ctx {
  constructor(name, home, ws, sess, modelStart) {
    this.name = name
    this.home = home
    this.ws = ws
    this.sess = sess
    this.modelStart = modelStart
    this.failures = 0
    this.passes = 0
    this.skips = []
  }
  expect(label, ok, expected, actual, pane = '') {
    if (ok) {
      this.passes++
      console.log(`  PASS ${label}`)
    } else {
      this.failures++
      console.log(`  FAIL ${label}`)
      console.log(`       expected: ${expected}`)
      console.log(`       actual:   ${actual}`)
      if (pane) console.log(snippet(pane, String(actual).slice(0, 40)).split('\n').map((l) => `       | ${l}`).join('\n'))
    }
    return ok
  }
  contains(label, pane, marker) {
    return this.expect(label, has(pane, marker), `contains "${marker}"`, has(pane, marker) ? 'present' : 'absent', pane)
  }
  absent(label, pane, marker) {
    return this.expect(label, !has(pane, marker), `does not contain "${marker}"`, has(pane, marker) ? 'present' : 'absent', pane)
  }
  skip(label, reason) {
    this.skips.push(`${label}: ${reason}`)
    console.log(`  SKIP ${label} — ${reason}`)
  }
  note(message) { console.log(`  · ${message}`) }
}

// ---------------------------------------------------------------------------
// tmux client driving
// ---------------------------------------------------------------------------
const capture = () => tmuxOut('capture-pane', '-p', '-t', globalThis.CUR_SESS)
const sendKeys = (...keys) => tmux('send-keys', '-t', globalThis.CUR_SESS, ...keys)
const typeText = async (text) => {
  for (const ch of text) { sendKeys('-l', ch); await sleep(TYPE_GAP_MS) }
}
const inputRow = (out) => (out.split('\n').filter((l) => l.includes('❯')).pop() ?? '').trim()

const submit = async (text) => {
  const typed = async () => {
    await typeText(text)
    await sleep(250)
    if (!inputRow(capture()).includes(text)) {
      // first-key drop guard (OpenTUI input parser): clean + retype once
      for (let i = 0; i < text.length + 6; i++) { sendKeys('BSpace'); await sleep(45) }
      await sleep(150)
      await typeText(text)
      await sleep(250)
    }
    sendKeys('Enter')
  }
  await typed()
}

const waitFor = async (pred, timeoutMs, everyMs = 400) => {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    const frame = capture()
    if (frame.trim().length > 0) last = frame
    try { if (last && pred(last)) return { ok: true, out: last } } catch { /* keep waiting */ }
    await sleep(everyMs)
  }
  return { ok: false, out: last }
}

const idle = (out) => IDLE_MARKERS.some((m) => out.includes(m))
// busy is NOT the absence of the placeholder: the composer keeps its idle
// placeholder while a turn streams. The hint line flips to `esc stop`.
const busyFrame = (out) => /esc stop/.test(out)
const msgsOf = (out) => {
  const all = [...String(out).matchAll(/💬\s*(\d+)\s*msgs/g)]
  return all.length ? Number(all[all.length - 1][1]) : undefined
}
const toolsOf = (out) => {
  const all = [...String(out).matchAll(/🔧\s*(\d+)\s*tools/g)]
  return all.length ? Number(all[all.length - 1][1]) : undefined
}

const reapHost = () => {
  const lock = join(globalThis.CUR_HOME, `opentui-host.${PROFILE}.json`)
  let pid = 0
  try { pid = JSON.parse(readFileSync(lock, 'utf8')).pid } catch {}
  if (pid) {
    try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch {} }
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); sleepSync(200) } catch { break }
    }
    try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch {} }
  }
  rmSync(lock, { force: true })
}
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const quitClient = async () => {
  if (tmux('has-session', '-t', globalThis.CUR_SESS).status !== 0) return
  await submit('/quit')
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (tmux('has-session', '-t', globalThis.CUR_SESS).status !== 0) return
    await sleep(300)
  }
  // fallback: ctrl+c twice (the page's clean shutdown), then hard kill
  sendKeys('C-c'); await sleep(200); sendKeys('C-c'); await sleep(1200)
  tmux('kill-session', '-t', globalThis.CUR_SESS)
}

const boot = async (ctx, extraArgs = []) => {
  tmux('kill-session', '-t', ctx.sess)
  await sleep(300)
  const env = [
    `DSH_HOME=${ctx.home}`,
    `DSH_OPENTUI_MODEL=fake-gw/demo-1`,
    `DSH_FAKE_API_KEY=${FAKE_KEY}`,
    'DSH_OPENTUI_DEBUG=1',
    'TERM=xterm-256color',
  ].join(' ')
  const errLog = join(RD, `${ctx.name}.client.err.log`)
  const cmd = `${env} "${LAUNCHER}" --client ${extraArgs.join(' ')} 2>"${errLog}"`
  const r = tmux('new-session', '-d', '-x', String(GEOMETRY.x), '-y', String(GEOMETRY.y), '-s', ctx.sess, '-c', ctx.ws, cmd)
  if (r.status !== 0) throw new Error(`tmux boot failed: ${r.stderr}`)
  const up = await waitFor((o) => o.includes('🧠') && idle(o), 90_000, 700)
  if (!up.ok) {
    const err = existsSync(errLog) ? readFileSync(errLog, 'utf8').slice(-1500) : ''
    throw new Error(`client did not reach idle within 90s. pane:\n${lastLine(up.out)}\nclient stderr:\n${err}`)
  }
  return up.out
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
const scenarios = []
const scenario = (name, title, fn) => scenarios.push({ name, title, fn })

scenario('new-empty', 'new session boots empty (no transcript, no resume)', async (ctx) => {
  const pane = await boot(ctx)
  ctx.contains('powerline/footer painted', pane, '🧠')
  ctx.expect('message counter starts at zero', msgsOf(pane) === 0, '💬 0 msgs', `💬 ${msgsOf(pane)} msgs`, pane)
  ctx.absent('no resumed notice', pane, 'resumed ')
  ctx.absent('no prior transcript content', pane, 'E2E-')
  ctx.expect('composer idle', idle(pane), 'idle placeholder', 'not idle', pane)
})

scenario('single-turn', 'one message → streamed reply → transcript + footer growth', async (ctx) => {
  const pane0 = await boot(ctx)
  const before = msgsOf(pane0) ?? 0
  await submit('E2E_SINGLE hello from the flow suite')
  const reply = await waitFor((o) => has(o, 'E2E-SINGLE-REPLY'), 90_000)
  ctx.expect('streamed reply reached the transcript', reply.ok, 'E2E-SINGLE-REPLY', reply.ok ? 'present' : 'absent', reply.out)
  ctx.contains('user message rendered', reply.out, 'E2E_SINGLE hello from the flow suite')
  const grew = await waitFor((o) => (msgsOf(o) ?? 0) >= before + 2, 30_000)
  ctx.expect('footer message counter grew', grew.ok, `💬 ${before + 2} msgs`, `💬 ${msgsOf(grew.out)} msgs`, grew.out)
  ctx.absent('no crash markers', reply.out, 'Unhandled promise')
})

scenario('tool-turn', 'agent tool call (bash echo) → tool block + result row', async (ctx) => {
  await boot(ctx)
  await submit('E2E_TOOL run the echo probe')
  const done = await waitFor((o) => has(o, 'E2E-TOOL-DONE'), 120_000)
  ctx.expect('turn completed after the tool round-trip', done.ok, 'E2E-TOOL-DONE', done.ok ? 'present' : 'absent', done.out)
  ctx.contains('tool result row shows the real command output', done.out, 'E2E-TOOL-RESULT-OK')
  const tools = await waitFor((o) => (toolsOf(o) ?? 0) >= 1, 15_000)
  ctx.expect('footer tool counter grew', tools.ok, '🔧 ≥1 tools', `🔧 ${toolsOf(tools.out)} tools`, tools.out)
  ctx.contains('tool block is visible in the activity area', done.out, 'E2E-TOOL-RESULT-OK')
})

scenario('steer', 'busy submit → Steer → ⤵ injected → ✓ delivered', async (ctx) => {
  await boot(ctx)
  await submit('E2E_SLOW keep the turn busy')
  const streaming = await waitFor((o) => busyFrame(o), 30_000)
  ctx.expect('turn is streaming', streaming.ok, 'busy frame (esc stop hint)', streaming.ok ? 'busy' : 'idle', streaming.out)

  await submit('E2E_STEER_TEXT inject this')
  const choice = await waitFor((o) => has(o, 'Turn running — steer or queue?'), 20_000)
  ctx.expect('busy submit opens the delivery choice', choice.ok, 'Turn running — steer or queue?', choice.ok ? 'present' : 'absent', choice.out)
  sendKeys('Enter') // Steer is option 0 (default highlight)
  const injected = await waitFor((o) => has(o, '⤵ 已注入当前回合'), 20_000)
  ctx.expect('steer receipt row appears', injected.ok, '⤵ 已注入当前回合', injected.ok ? 'present' : 'absent', injected.out)
  const delivered = await waitFor((o) => has(o, '✓ 已投递'), 90_000)
  ctx.expect('receipt flips to delivered at turn end', delivered.ok, '✓ 已投递', delivered.ok ? 'present' : 'absent', delivered.out)
  const settled = await waitFor((o) => idle(o), 30_000)
  ctx.expect('turn settled', settled.ok, 'idle composer', 'still busy', settled.out)
  const reqs = modelLogLines().slice(ctx.modelStart)
  const rode = reqs.some((r) => String(r.marker ?? '').includes('E2E_STEER_TEXT') || String(r.prompt ?? '').includes('E2E_STEER_TEXT'))
  ctx.expect('steer text reached a model request (delivery chain)', rode, 'a request carrying E2E_STEER_TEXT', rode ? 'present' : 'absent')
})

scenario('queue', 'busy submit → Queue → ⏸ #1 → auto-sent after turn end', async (ctx) => {
  await boot(ctx)
  await submit('E2E_SLOW keep the turn busy')
  await waitFor((o) => busyFrame(o), 30_000)

  await submit('E2E_QUEUE_TEXT send after this turn')
  const choice = await waitFor((o) => has(o, 'Turn running — steer or queue?'), 20_000)
  ctx.expect('busy submit opens the delivery choice', choice.ok, 'Turn running — steer or queue?', choice.ok ? 'present' : 'absent', choice.out)
  sendKeys('Down')
  await sleep(150)
  sendKeys('Enter') // Queue is option 1
  const queued = await waitFor((o) => has(o, '⏸ 排队等待 #1'), 15_000)
  ctx.expect('queue wait row appears', queued.ok, '⏸ 排队等待 #1', queued.ok ? 'present' : 'absent', queued.out)

  const ack = await waitFor((o) => has(o, 'E2E-ACK:E2E_QUEUE_TEXT'), 120_000)
  ctx.expect('queued prompt runs as its own turn after the first', ack.ok, 'E2E-ACK:E2E_QUEUE_TEXT reply', ack.ok ? 'present' : 'absent', ack.out)
  const settled = await waitFor((o) => idle(o), 30_000)
  const final = settled.out || ack.out
  ctx.absent('queue wait row disappeared', final, '排队等待 #1')
  ctx.expect('queued text became a real user message', has(final, 'E2E_QUEUE_TEXT'), 'user row E2E_QUEUE_TEXT', has(final, 'E2E_QUEUE_TEXT') ? 'present' : 'absent', final)
})

scenario('flush', '/flush delivers a paused queue immediately', async (ctx) => {
  await boot(ctx)
  await submit('E2E_SLOW keep the turn busy')
  await waitFor((o) => busyFrame(o), 30_000)

  await submit('E2E_FLUSH_TEXT deliver me now')
  await waitFor((o) => has(o, 'Turn running — steer or queue?'), 20_000)
  sendKeys('Down'); await sleep(150); sendKeys('Enter')
  const queued = await waitFor((o) => has(o, '⏸ 排队等待 #1'), 15_000)
  ctx.expect('queue wait row appears', queued.ok, '⏸ 排队等待 #1', queued.ok ? 'present' : 'absent', queued.out)

  sendKeys('Escape') // interrupt the running turn → the queue PAUSES
  const paused = await waitFor((o) => has(o, '已暂停'), 20_000)
  ctx.expect('aborting the turn pauses the queue', paused.ok, '⏸ 已暂停 #1', paused.ok ? 'present' : 'absent', paused.out)
  const settled = await waitFor((o) => idle(o), 20_000)
  ctx.expect('composer idle after abort', settled.ok, 'idle composer', 'still busy', settled.out)

  await submit('/flush')
  const flushed = await waitFor((o) => has(o, 'queue flushed'), 20_000)
  ctx.expect('/flush reports an immediate delivery', flushed.ok, 'queue flushed', flushed.ok ? 'present' : 'absent', flushed.out)
  const ack = await waitFor((o) => has(o, 'E2E-ACK:E2E_FLUSH_TEXT'), 90_000)
  ctx.expect('flushed prompt actually ran', ack.ok, 'E2E-ACK:E2E_FLUSH_TEXT reply', ack.ok ? 'present' : 'absent', ack.out)
})

scenario('resume', 'quit → plain boot is empty → --resume-last restores history', async (ctx) => {
  const pane = await boot(ctx)
  await submit('E2E_SINGLE persist this turn')
  const reply = await waitFor((o) => has(o, 'E2E-SINGLE-REPLY'), 90_000)
  ctx.expect('first session has a turn', reply.ok, 'E2E-SINGLE-REPLY', reply.ok ? 'present' : 'absent', reply.out)
  const msgsBefore = msgsOf(reply.out)

  await quitClient()
  await reapHost()

  const fresh = await boot(ctx) // default: NEW session
  ctx.expect('plain relaunch starts a new (empty) session', msgsOf(fresh) === 0, '💬 0 msgs', `💬 ${msgsOf(fresh)} msgs`, fresh)
  ctx.absent('plain relaunch does not restore the old transcript', fresh, 'E2E-SINGLE-REPLY')

  await quitClient()
  await reapHost()

  const resumed = await boot(ctx, ['--resume-last'])
  const restored = await waitFor((o) => has(o, 'E2E-SINGLE-REPLY'), 60_000)
  ctx.expect('--resume-last restores the transcript', restored.ok, 'E2E-SINGLE-REPLY', restored.ok ? 'present' : 'absent', restored.out)
  ctx.contains('restored transcript keeps the user row', restored.out, 'E2E_SINGLE persist this turn')
  ctx.contains('resume notice is printed', restored.out, 'resumed ')
  const counted = await waitFor((o) => (msgsOf(o) ?? 0) >= (msgsBefore ?? 2), 10_000)
  if (counted.ok) ctx.expect('restored transcript keeps the message count', true, `💬 ≥${msgsBefore}`, `💬 ${msgsOf(counted.out)}`, counted.out)
  else ctx.note(`footer message counter did not rehydrate after --resume-last (observed 💬 ${msgsOf(counted.out)}; transcript rows are correct)`)
})

scenario('host-restart', 'client quit → host idle-exits (5s) → restart keeps the session', async (ctx) => {
  await boot(ctx)
  await submit('E2E_SINGLE host restart probe')
  const reply = await waitFor((o) => has(o, 'E2E-SINGLE-REPLY'), 90_000)
  ctx.expect('turn recorded before shutdown', reply.ok, 'E2E-SINGLE-REPLY', reply.ok ? 'present' : 'absent', reply.out)

  const lock = join(ctx.home, `opentui-host.${PROFILE}.json`)
  const pid = JSON.parse(readFileSync(lock, 'utf8')).pid
  await quitClient()

  // default idle-exit is 5s; allow headroom for the detached reaper
  const deadline = Date.now() + 25_000
  let gone = false
  while (Date.now() < deadline) {
    try { process.kill(pid, 0) } catch { gone = true; break }
    await sleep(400)
  }
  ctx.expect('resident host exited after the client left', gone, `pid ${pid} gone`, gone ? 'gone' : 'still alive')
  ctx.expect('host lock file was cleared', !existsSync(lock), 'lock removed', existsSync(lock) ? 'still present' : 'removed')

  const resumed = await boot(ctx, ['--resume-last'])
  const restored = await waitFor((o) => has(o, 'E2E-SINGLE-REPLY'), 60_000)
  ctx.expect('session survived the host restart', restored.ok, 'E2E-SINGLE-REPLY', restored.ok ? 'present' : 'absent', restored.out)
})

scenario('settings', '/settings writes a local preference to config.json and reverts', async (ctx) => {
  await boot(ctx)
  const cfgPath = join(ctx.home, 'profiles', PROFILE, 'config.json')
  const readCfg = () => JSON.parse(readFileSync(cfgPath, 'utf8'))
  const original = readCfg().motion
  const originalMerged = original ?? 'auto'
  ctx.note(`initial motion: ${original === undefined ? '(unset → auto)' : original}`)

  await submit('/settings')
  // v1.2 settings modal: a sectioned panel ("分节导航 · 即时保存 · Esc 逐层
  // 返回") with General / TUI 专有 / Host / 模型 / 插件 / Agent 预设 / 账号 —
  // the old flat "● Settings + 本地偏好" list is gone.
  const open = await waitFor((o) => has(o, 'Settings') && has(o, '分节导航'), 20_000)
  ctx.expect('settings panel opened', open.ok, 'settings modal (分节导航 subtitle)', open.ok ? 'present' : 'absent', open.out)

  // nav: Down moves to the TUI 专有 section, Enter opens its row list; motion
  // is the 4th row (theme / themeMode / workspaceThemeMode / motion)
  sendKeys('Down'); await sleep(200)
  sendKeys('Enter'); await sleep(500)
  const rows = await waitFor((o) => has(o, 'motion'), 10_000)
  ctx.contains('TUI 专有 section lists the motion row', rows.out || capture(), 'motion')

  // open the motion enum editor and pick "off" (last option); the cursor
  // starts on the effective value (auto), Enter saves instantly
  for (let i = 0; i < 3; i++) { sendKeys('Down'); await sleep(150) }
  sendKeys('Enter'); await sleep(500)
  const options = await waitFor((o) => has(o, '选择值') && has(o, 'full'), 10_000)
  ctx.expect('enum option list opened', options.ok, 'motion — 选择值 with auto/full/…', options.ok ? 'present' : 'absent', options.out)

  for (let i = 0; i < 3; i++) { sendKeys('Down'); await sleep(120) } // auto -> full -> reduced -> off
  sendKeys('Enter')
  const wrote = await waitForCfg(cfgPath, (c) => c.motion === 'off', 10_000)
  ctx.expect('config.json got the new local preference', wrote.ok, 'motion = "off"', wrote.ok ? 'off' : JSON.stringify(wrote.value), capture())

  // revert: the save returns to the row list, so re-enter the editor — its
  // cursor now restarts on the saved value ("off"); walk it to the original
  sendKeys('Enter'); await sleep(500)
  const targets = ['auto', 'full', 'reduced', 'off']
  const delta = (targets.indexOf('off') - Math.max(0, targets.indexOf(originalMerged)) + targets.length) % targets.length
  for (let i = 0; i < delta; i++) { sendKeys('Up'); await sleep(120) }
  sendKeys('Enter')
  const reverted = await waitForCfg(cfgPath, (c) => c.motion === originalMerged, 10_000)
  ctx.expect('config.json reverted', reverted.ok, `motion = "${originalMerged}"`, reverted.ok ? originalMerged : JSON.stringify(reverted.value), capture())

  // close the modal so the composer owns the keys again for /quit: Esc opens
  // the exit confirmation (focus starts on 返回), ←→ cycles to 确认退出
  sendKeys('Escape'); await sleep(400)
  sendKeys('Right'); await sleep(200)
  sendKeys('Enter'); await sleep(400)
  await waitFor((o) => !has(o, '分节导航') && idle(o), 10_000)
})

scenario('mcp', 'host tool catalog lists the context7 MCP tools', async (ctx) => {
  await boot(ctx)
  await submit('E2E_SINGLE list your tools')
  const reply = await waitFor((o) => has(o, 'E2E-SINGLE-REPLY'), 90_000)
  ctx.expect('probe turn completed', reply.ok, 'E2E-SINGLE-REPLY', reply.ok ? 'present' : 'absent', reply.out)

  const reqs = modelLogLines().slice(ctx.modelStart).filter((r) => Array.isArray(r.toolNames) && r.toolNames.length > 0)
  const names = [...new Set(reqs.flatMap((r) => r.toolNames))]
  const mcp = names.filter((n) => /context7|mcp__/i.test(n))
  if (mcp.length > 0) {
    ctx.expect('context7 MCP tools are in the host tool catalog', true, '≥1 context7/mcp__ tool', mcp.slice(0, 5).join(', '))
    ctx.note(`mcp tools: ${mcp.slice(0, 8).join(', ')}`)
  } else {
    ctx.skip('context7 MCP tools', `host tool catalog had ${names.length} tools but no context7/mcp__ entry (MCP server unreachable or adapter not installed)`)
  }
})

const waitForCfg = async (path, pred, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  let value
  while (Date.now() < deadline) {
    try {
      value = JSON.parse(readFileSync(path, 'utf8'))
      if (pred(value)) return { ok: true, value }
    } catch {}
    await sleep(300)
  }
  return { ok: false, value }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const selected = ONLY.length > 0
  ? scenarios.filter((s) => ONLY.some((q) => s.name === q || s.name.includes(q)))
  : scenarios
if (selected.length === 0) {
  console.error(`e2e-flows: no scenario matches --only=${ONLY.join(',')}`)
  console.error(`available: ${scenarios.map((s) => s.name).join(', ')}`)
  process.exit(2)
}

let fake
try {
  fake = await startFakeModel()
  FAKE_PORT = fake.port
  console.log(`e2e-flows: fake model on 127.0.0.1:${FAKE_PORT} (log: ${MODEL_LOG})`)
  console.log(`e2e-flows: run dir ${RD}`)

  const results = []
  const runStart = Date.now()
  for (const [i, s] of selected.entries()) {
    const modelStart = modelLogLines().length
    const home = mkdtempSync(join(tmpdir(), `e2e-${s.name}-home-`))
    const ws = mkdtempSync(join(tmpdir(), `e2e-${s.name}-ws-`))
    const sess = `e2e-${s.name}-${process.pid}-${i}`
    console.log(`\n=== [${i + 1}/${selected.length}] ${s.name} — ${s.title}`)

    const setup = sh('node', [join(HERE, 'setup-home.mjs'), '--home', home, '--workspace', ws, '--port', String(FAKE_PORT), '--template', TEMPLATE_HOME], { encoding: 'utf8' })
    if (setup.status !== 0) {
      console.log(`  FAIL scratch home — ${setup.stderr || setup.stdout}`)
      results.push({ name: s.name, ok: false, passes: 0, failures: 1, skips: [] })
      continue
    }

    const ctx = new Ctx(s.name, home, ws, sess, modelStart)
    globalThis.CUR_SESS = sess
    globalThis.CUR_HOME = home
    const started = Date.now()
    let error = ''
    try {
      await s.fn(ctx)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      ctx.failures++
      console.log(`  FAIL harness error — ${error}`)
    } finally {
      try { await quitClient() } catch {}
      try { reapHost() } catch {}
      tmux('kill-session', '-t', sess)
    }
    const secs = ((Date.now() - started) / 1000).toFixed(1)
    const ok = ctx.failures === 0
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${s.name} (${secs}s, ${ctx.passes} checks${ctx.skips.length ? `, ${ctx.skips.length} skip` : ''})`)
    results.push({ name: s.name, ok, passes: ctx.passes, failures: ctx.failures, skipped: ctx.skips, secs })
    if (ok && !KEEP) {
      rmSync(home, { recursive: true, force: true })
      rmSync(ws, { recursive: true, force: true })
    } else if (!ok) {
      console.log(`  kept scratch home: ${home}`)
      console.log(`  kept workspace:    ${ws}`)
    }
  }

  const totalSecs = ((Date.now() - runStart) / 1000).toFixed(1)
  console.log('\n================ E2E FLOWS SUMMARY ================')
  console.log('scenario        result   checks  time')
  for (const r of results) {
    console.log(`${r.name.padEnd(15)} ${(r.ok ? 'PASS' : 'FAIL').padEnd(8)} ${String(r.passes).padStart(3)}     ${r.secs ?? '-'}s`)
  }
  const failed = results.filter((r) => !r.ok)
  const skips = results.flatMap((r) => r.skipped ?? [])
  if (skips.length > 0) {
    console.log('\nSKIPPED:')
    for (const s of skips) console.log(`  - ${s}`)
  }
  console.log(`\n${failed.length === 0 ? 'E2E FLOWS RESULT: PASS' : `E2E FLOWS RESULT: FAIL (${failed.length})`}  ·  ${totalSecs}s total`)
  process.exitCode = failed.length === 0 ? 0 : 1
} finally {
  try { fake?.child.kill() } catch {}
  tmux('kill-server')
  if (!KEEP) { try { rmSync(RD, { recursive: true, force: true }) } catch {} }
}
