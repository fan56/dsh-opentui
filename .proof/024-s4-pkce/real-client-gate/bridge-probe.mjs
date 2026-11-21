import { spawn } from 'node:child_process'
const home = process.argv[2]
const child = spawn('dsh', ['--profile', 'opentui-inproc'], {
  env: { ...process.env, DSH_HOME: home, DSH_OPENTUI_BRIDGE_STDIO: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let out = '', err = ''
child.stdout.on('data', (c) => { out += c.toString() })
child.stderr.on('data', (c) => { err += c.toString() })
setTimeout(() => { try { child.stdin.write(JSON.stringify({ id: 1, method: 'bridge.hello', params: { protocolVersion: 1 } }) + '\n') } catch {} }, 1500)
setTimeout(() => {
  const ok = /"protocolVersion"\s*:\s*1/.test(out) && /"bridgeVersion"/.test(out)
  process.stdout.write((ok ? 'HELLO_OK ' : 'HELLO_FAIL ') + JSON.stringify({ out: out.trim(), err: err.trim().slice(0, 2000) }) + '\n')
  try { child.kill('SIGTERM') } catch {}
  process.exit(ok ? 0 : 1)
}, 6000)
