#!/usr/bin/env node
// Fork-context E2E: boot the real profile, plant a fact ("pineapple"),
// /history-fork at the completed turn, then ask for the fact in English —
// the fork is correct only if the SEEDED session answers it. Skips like
// e2e-live.mjs when the environment can't run it.
import { spawn } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const cwd = `${process.env.HOME}/.dsh/profiles/dsh-opentui`

const SKIP = (() => {
  const which = spawnSync('which', ['dsh'], { encoding: 'utf8' })
  if (which.status !== 0 || !which.stdout.trim()) return 'no global dsh on PATH'
  return null
})()
if (SKIP) {
  console.log(`e2e-fork: skipped (${SKIP})`)
  process.exit(0)
}
const env = { ...process.env, NODE_OPTIONS: '--experimental-ffi' }
delete env.DSH_HOME
const child = spawn('dsh', ['--profile', 'dsh-opentui'], { cwd, env, stdio: ['pipe','pipe','pipe'] })
let out = ''
child.stdout.on('data', c => out += c); child.stderr.on('data', c => out += c)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const send = async (line) => { for (const ch of line) { child.stdin.write(ch); await sleep(70) } child.stdin.write('\r'); await sleep(400) }
await sleep(15000)
// turn 1: distinctive fact
await send('My favorite fruit is pineapple. Just remember it, reply OK only.')
await sleep(30000)
// fork at turn 1 (the only completed turn)
await send('/history')
await sleep(2500)
child.stdin.write('\r')
await sleep(7000)
// context probe in English → ASCII-safe assertion
await send('In one short English sentence: what is my favorite fruit?')
await sleep(40000)
writeFileSync('/tmp/fork-probe.txt', out)
child.kill('SIGTERM'); await sleep(600)
const plain = out.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
const squash = plain.replace(/\s+/g, '')
console.log('fork rebuilt (no runtime-context leak):', !squash.includes('Currentruntimecontext'))
console.log('reply mentions pineapple:', squash.toLowerCase().includes('pineapple'))
