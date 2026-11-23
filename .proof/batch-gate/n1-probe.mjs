/**
 * N1 real-machine A1 recheck probe (batch-gate Step 6).
 *
 * Drives settings.describe / settings.mutate against a REAL inproc dsh host
 * started by the same provisioner + launcher recipe as scripts/real-client-gate.sh.
 * No product code is touched. All writes go to a fresh scratch DSH_HOME and
 * the caller-supplied output directory.
 *
 * Usage: node n1-probe.mjs <outDir>
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const REPO = '/Users/qingguee/repo/dsh-opentui-wt-uibatch-1123'
const REAL_HOME = process.env.DSH_HOME_REAL || join(process.env.HOME, '.dsh')
const OUT = process.argv[2]
if (!OUT) { console.error('usage: node n1-probe.mjs <outDir>'); process.exit(2) }
mkdirSync(OUT, { recursive: true })
const LOG = join(OUT, 'n1-probe.log')
const lines = []
const log = (s) => { const t = `${new Date().toISOString()} ${s}`; lines.push(t); console.log(t); writeFileSync(LOG, lines.join('\n') + '\n') }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 1. fresh scratch home + provision (same recipe as gate) ----------
const SCRATCH = join(tmpdir(), `n1-gate-home-${process.pid}-${Date.now()}`)
mkdirSync(join(SCRATCH, 'profiles'), { recursive: true })
cpSync(join(REAL_HOME, 'profiles/opentui'), join(SCRATCH, 'profiles/opentui'), { recursive: true })
for (const rel of ['.credentials.yaml', 'models-store.json', 'model-profiles.json', 'settings.yaml', 'workspace-presets.json', 'agents', 'themes']) {
  if (existsSync(join(REAL_HOME, rel))) cpSync(join(REAL_HOME, rel), join(SCRATCH, rel), { recursive: true })
}
if (existsSync(join(REAL_HOME, 'profiles/node_modules'))) {
  cpSync(join(REAL_HOME, 'profiles/node_modules'), join(SCRATCH, 'profiles/node_modules'), { recursive: true })
}
log(`scratch home: ${SCRATCH}`)

const PROV = join(REPO, 'packages/shell/scripts/provision-inproc-profile.mjs')
const prov = spawnSync('node', [PROV, '--repair'], {
  env: { ...process.env, DSH_HOME: SCRATCH }, encoding: 'utf8', timeout: 180000, maxBuffer: 20 * 1024 * 1024,
})
const provOut = (prov.stdout || '') + '\n---STDERR---\n' + (prov.stderr || '')
writeFileSync(join(OUT, 'n1-provision.log'), provOut)
const provOk = prov.status === 0 && provOut.includes('dsh-opentui(inproc): PASS')
log(`provision: rc=${prov.status} PASS=${provOk}`)
if (!provOk) finish(2, { stage: 'provision', scratch: SCRATCH, rc: prov.status, out: provOut.slice(-3000) })

// ---------- helpers: real inproc host over bridge stdio ----------
function spawnHost(tag) {
  const child = spawn('dsh', ['--profile', 'opentui-inproc'], {
    env: { ...process.env, DSH_HOME: SCRATCH, DSH_OPENTUI_BRIDGE_STDIO: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const state = { child, out: '', err: '', tag }
  child.stdout.on('data', (c) => { state.out += c.toString() })
  child.stderr.on('data', (c) => { state.err += c.toString() })
  return state
}
function send(state, id, method, params) {
  state.child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
}
function parseFrame(state, id, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const tick = () => {
      for (const f of state.out.split('\n').filter(Boolean)) {
        let o; try { o = JSON.parse(f) } catch { continue }
        if (o && o.id === id && 'ok' in o) { resolve(o); return }
      }
      if (Date.now() > deadline) { resolve({ __timeout: true, rawTail: state.out.slice(-3000) }); return }
      setTimeout(tick, 150)
    }
    tick()
  })
}
function findNs(frame, ns) {
  const src = frame?.result?.namespaces ?? frame?.result?.value?.namespaces ?? []
  const arr = Array.isArray(src) ? src : (Array.isArray(src?.namespaces) ? src.namespaces : [])
  return arr.find((n) => n && (n.ns === ns || n.namespace === ns || n.name === ns))
}
function scalarOf(nsObj, key) {
  if (!nsObj) return undefined
  const v = nsObj.value ?? nsObj.values ?? {}
  if (v && typeof v === 'object' && key in v) return v[key]
  if (key in nsObj) return nsObj[key]
  return undefined
}
async function describe(state, id, ns = 'subagent', key = 'maxActiveSubagents') {
  send(state, id, 'settings.describe', {})
  const f = await parseFrame(state, id)
  const found = findNs(f, ns)
  const val = scalarOf(found, key)
  const nsCount = (Array.isArray(f?.result?.namespaces) ? f.result.namespaces.length : 'n/a')
  log(`describe id=${id}: frameOk=${f.ok} namespaces=${nsCount} ${ns}=${found ? 'present' : 'MISSING'} ${key}=${JSON.stringify(val)}`)
  if (f.__timeout) log(`describe id=${id} TIMEOUT rawTail=${f.rawTail}`)
  return { ok: f.ok === true, value: val, nsPresent: !!found, nsCount, raw: f }
}
async function mutate(state, id, value, ns = 'subagent', key = 'maxActiveSubagents') {
  send(state, id, 'settings.mutate', {
    ns,
    ops: [{ op: 'set', path: [key], value }],
  })
  const f = await parseFrame(state, id)
  log(`mutate id=${id}: ${ns}.${key}=${JSON.stringify(value)} frameOk=${f.ok} result=${JSON.stringify(f.result ?? f.error)}`)
  if (f.__timeout) log(`mutate id=${id} TIMEOUT rawTail=${f.rawTail}`)
  return { ok: f.ok === true, raw: f }
}
/** Re-run the SAME provisioner the launcher calls on every start (bin/dsh-opentui.mjs:310).
 *  This is the missing half the old N1-d probe omitted, which is why it falsely
 *  reported persistence for a field the provisioner merge did not carry. */
function reprovision() {
  const r = spawnSync('node', [PROV, '--repair'], {
    env: { ...process.env, DSH_HOME: SCRATCH }, encoding: 'utf8', timeout: 180000, maxBuffer: 20 * 1024 * 1024,
  })
  const ok = r.status === 0 && (r.stdout || '').includes('dsh-opentui(inproc): PASS')
  log(`reprovision (launcher restart path): rc=${r.status} PASS=${ok}`)
  return ok
}
async function boot(tag) {
  const state = spawnHost(tag)
  await sleep(1800)
  send(state, 1, 'bridge.hello', { protocolVersion: 1 })
  const hello = await parseFrame(state, 1, 15000)
  const ok = !hello.__timeout && hello.ok === true
  log(`${tag}: bridge.hello ok=${ok} protocolVersion=${hello.result?.protocolVersion} bridgeVersion=${hello.result?.bridgeVersion}`)
  return { state, ok }
}
function kill(state) { try { state.child.kill('SIGTERM') } catch {} }
function finish(code, extra) {
  writeFileSync(join(OUT, 'n1-result.json'), JSON.stringify(extra ?? {}, null, 2))
  log(`FINISH code=${code}`)
  process.exit(code)
}

// ---------- 2. boot 1: describe -> mutate -> describe (hot-effective, TWO fields) ----------
const result = { step: 'N1-A1-corrected', scratch: SCRATCH, provision: { ok: provOk, rc: prov.status }, stages: {} }
const h1 = await boot('boot-1')
result.stages.hello1 = { ok: h1.ok }
if (!h1.ok) { finish(3, { ...result, note: 'bridge.hello failed on boot 1' }) }

// Field A: subagent.maxActiveSubagents 3 -> 5
const a0 = await describe(h1.state, 2)
result.stages.describe_before = { ok: a0.ok, value: a0.value, nsPresent: a0.nsPresent, nsCount: a0.nsCount }
const ma = await mutate(h1.state, 3, 5)
result.stages.mutate_to_5 = { ok: ma.ok }
const a1 = await describe(h1.state, 4)
result.stages.describe_after = { ok: a1.ok, value: a1.value, nsPresent: a1.nsPresent, nsCount: a1.nsCount }

// Field B: session-log-deepseek.enabled true -> false (the field the old probe
// never exercised; its provisioner merge was missing and is now added)
const b0 = await describe(h1.state, 5, 'session-log-deepseek', 'enabled')
result.stages.sld_describe_before = { ok: b0.ok, value: b0.value, nsPresent: b0.nsPresent }
const mb = await mutate(h1.state, 6, false, 'session-log-deepseek', 'enabled')
result.stages.sld_mutate_to_false = { ok: mb.ok }
const b1 = await describe(h1.state, 7, 'session-log-deepseek', 'enabled')
result.stages.sld_describe_after = { ok: b1.ok, value: b1.value, nsPresent: b1.nsPresent }

// reserve evidence
await sleep(500)
const reserveLines = h1.state.err.split('\n').filter((l) => /reserve|maxActiveSubagents|activat|cap/i.test(l)).slice(-40)
log(`host-1 reserve-ish log lines: ${reserveLines.length}`)
for (const l of reserveLines) log(`  HOST| ${l.slice(0, 300)}`)
result.stages.host1_reserve_evidence = reserveLines
writeFileSync(join(OUT, 'n1-host-1.stderr.log'), h1.state.err)
writeFileSync(join(OUT, 'n1-host-1.stdout.frames'), h1.state.out)

const hotEffective = a0.ok && a1.ok && a1.value === 5 && a1.value !== a0.value
const sldHot = b0.ok && b1.ok && b1.value === false && b1.value !== b0.value
log(`HOT-EFFECTIVE: subagent before=${JSON.stringify(a0.value)} after=${JSON.stringify(a1.value)} verdict=${hotEffective}`)
log(`HOT-EFFECTIVE: session-log before=${JSON.stringify(b0.value)} after=${JSON.stringify(b1.value)} verdict=${sldHot}`)
result.stages.hot_effective = hotEffective
result.stages.sld_hot_effective = sldHot

// ---------- 3. CORRECTED restart: re-run provisioner THEN restart host ----------
kill(h1.state)
await sleep(1500)
const reprovOk = reprovision()
result.stages.reprovision_on_restart = { ok: reprovOk }
if (!reprovOk) { finish(5, { ...result, note: 'reprovision on restart failed' }) }

const h2 = await boot('boot-2')
result.stages.hello2 = { ok: h2.ok }
if (!h2.ok) { finish(4, { ...result, note: 'bridge.hello failed on boot 2' }) }
const a2 = await describe(h2.state, 2)
result.stages.describe_after_restart = { ok: a2.ok, value: a2.value, nsPresent: a2.nsPresent, nsCount: a2.nsCount }
const b2 = await describe(h2.state, 3, 'session-log-deepseek', 'enabled')
result.stages.sld_describe_after_restart = { ok: b2.ok, value: b2.value, nsPresent: b2.nsPresent }
writeFileSync(join(OUT, 'n1-host-2.stderr.log'), h2.state.err)
writeFileSync(join(OUT, 'n1-host-2.stdout.frames'), h2.state.out)
const persisted = a2.ok && a2.value === 5
const sldPersisted = b2.ok && b2.value === false
log(`RESTART-PERSIST (after reprovision): subagent value=${JSON.stringify(a2.value)} verdict=${persisted}`)
log(`RESTART-PERSIST (after reprovision): session-log value=${JSON.stringify(b2.value)} verdict=${sldPersisted}`)
result.stages.restart_persist = persisted
result.stages.sld_restart_persist = sldPersisted
kill(h2.state)

finish(0, result)
