#!/usr/bin/env node
/**
 * Headless bridge handshake gate (T8). Spawns an INSTALLED dsh host (never the
 * repo checkout) against a fresh DSH_HOME with DSH_OPENTUI_BRIDGE_STDIO=1,
 * sends one NDJSON `bridge.ping` frame, asserts the `protocolVersion:1` reply
 * on stdout, then terminates the host so CI does not hang on its FS watchers.
 *
 *   node scripts/verify-bridge-handshake.mjs <dsh-bin> <dsh-home> [deadline-ms]
 *
 * stdout is the protocol channel; the raw reply is echoed to this process's
 * stdout so the CI log carries the exact frame. The host's stderr is echoed on
 * failure (and always, prefixed, to this process's stderr) so a missing reply
 * comes with context instead of a bare exit code.
 */
import { spawn } from 'node:child_process'

const [dshBin, dshHome, deadlineRaw] = process.argv.slice(2)
if (!dshBin || !dshHome) {
  console.error('usage: verify-bridge-handshake.mjs <dsh-bin> <dsh-home> [deadline-ms]')
  process.exit(2)
}
const deadlineMs = Number(deadlineRaw ?? 25000)
if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
  console.error(`[bridge-handshake] invalid deadline: ${deadlineRaw}`)
  process.exit(2)
}

const PING = '{"id":1,"method":"bridge.ping"}'
const REPLY_RE = /"protocolVersion"\s*:\s*1\b/

const child = spawn(dshBin, ['--profile', 'opentui-inproc'], {
  env: { ...process.env, DSH_HOME: dshHome, DSH_OPENTUI_BRIDGE_STDIO: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''
let gotReply = false
let terminated = false
let spawnError
const timers = []

const clearTimers = () => {
  for (const t of timers) clearTimeout(t)
  timers.length = 0
}

/** Terminate the host: TERM first, KILL for survivors. Idempotent. */
function terminate(signal = 'SIGTERM') {
  if (terminated) return
  terminated = true
  try {
    child.kill(signal)
  } catch {
    /* already gone */
  }
}

child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  stdout += chunk
  if (!gotReply && REPLY_RE.test(stdout)) {
    gotReply = true
    // Give the host a beat to flush, then stop it — the bridge keeps FS
    // watchers alive so EOF alone does not reliably end the process.
    timers.push(setTimeout(() => terminate('SIGTERM'), 250))
    timers.push(setTimeout(() => terminate('SIGKILL'), 2000))
  }
})
child.stderr.on('data', (chunk) => {
  stderr += chunk
})
child.on('error', (err) => {
  spawnError = err
  clearTimers()
})

// Send the ping once the bridge has had time to attach its stdin listener;
// retry once in case a slow host boot missed the first write.
timers.push(setTimeout(() => {
  if (!gotReply) {
    try {
      child.stdin.write(`${PING}\n`)
    } catch {
      /* stdin gone */
    }
  }
}, 400))
timers.push(setTimeout(() => {
  if (!gotReply) {
    try {
      child.stdin.write(`${PING}\n`)
    } catch {
      /* stdin gone */
    }
  }
}, 4000))

// Overall deadline: never hang the job; kill and let the exit handler fail.
timers.push(setTimeout(() => {
  if (!gotReply) terminate('SIGTERM')
  timers.push(setTimeout(() => terminate('SIGKILL'), 1500))
}, deadlineMs))

child.on('close', () => {
  clearTimers()
  try {
    child.stdin.end()
  } catch {
    /* already closed */
  }

  // The exact frame the host emitted is the primary evidence.
  process.stdout.write(`--- bridge handshake stdout (raw) ---\n${stdout}`)
  if (!stdout.endsWith('\n')) process.stdout.write('\n')
  process.stdout.write('--- end bridge handshake stdout ---\n')

  if (stderr.trim()) {
    process.stderr.write(`--- bridge handshake stderr (raw) ---\n${stderr}`)
    if (!stderr.endsWith('\n')) process.stderr.write('\n')
    process.stderr.write('--- end bridge handshake stderr ---\n')
  }

  if (spawnError) {
    console.error(`[bridge-handshake] could not spawn ${dshBin}: ${spawnError.message}`)
    process.exit(1)
  }
  if (!gotReply) {
    console.error(`[bridge-handshake] FAIL — no reply matching ${REPLY_RE} within ${deadlineMs}ms`)
    console.error(`[bridge-handshake] sent: ${PING}`)
    console.error(`[bridge-handshake] DSH_HOME: ${dshHome}`)
    process.exit(1)
  }
  console.log('[bridge-handshake] PASS — bridge.ping replied with protocolVersion:1')
  process.exit(0)
})
