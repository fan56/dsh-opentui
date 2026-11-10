// The detached idle reaper (scripts/idle-reaper.mjs — ADR-0005 decision 5's
// entry-side half): the 5s window (DSH_OPENTUI_HOST_IDLE_MS) after the LAST
// client disconnect. After the window it SIGTERMs an idle host and clears the
// lockfile, but these cancel the idle exit and spare the host:
//   - a REPLACED host (lockfile pid moved);
//   - a RE-ATTACHED host (a client opened an ESTABLISHED connection during
//     the window — the reconnect path must never be reaped);
//   - an ADOPTED-BUT-NOT-YET-CONNECTED host (adoptHost bumps the lockfile
//     generation; the adoptee may still be minting past the window edge);
//   - an unreadable lockfile (never kill what cannot be verified).
// Behavioral tests: real reaper process, real fake hosts, short windows.
import { describe, expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { once } from 'node:events'
import { resolveReaperScript } from '../src/client/boot-shared.ts'

const REAPER = join(import.meta.dir, '..', 'scripts', 'idle-reaper.mjs')
const IDLE_MS = 1_200

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface FakeHost {
  pid: number
  port: number
  lockPath: string
  kill(): void
}

/** A stand-in host: a live (optionally LISTENING) process described by a
 * lifecycle-shaped lockfile. The lockfile is FRESH (just written) on purpose:
 * a recent lock alone must not spare the host — only a generation bump after
 * the reaper started, or an ESTABLISHED connection, does. */
function fakeHost(listen: boolean, port: number): FakeHost {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-idle-reaper-'))
  const lockPath = join(dir, 'opentui-host.opentui.json')
  const keepAlive = `
    ${listen ? `Bun.listen({ hostname: '127.0.0.1', port: ${port}, socket: { data() {} } });` : ''}
    setInterval(() => {}, 1000)
  `
  const child = spawn(process.execPath, ['-e', keepAlive], { stdio: 'ignore' })
  const lock = { pid: child.pid!, port, authority: `127.0.0.1:${port}`, startedAt: new Date().toISOString(), profile: 'opentui' }
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
  return {
    pid: child.pid!,
    port,
    lockPath,
    kill() {
      try {
        child.kill('SIGKILL')
      } catch {}
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** Open a real established connection to a listening port and hold it from
 * THIS test process (the reconnect liveness marker). */
async function holdConnection(port: number): Promise<() => void> {
  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port,
    socket: { data() {} },
  })
  return () => {
    try {
      socket.end()
    } catch {}
  }
}

/** Bind + release a port so the fake host and the holder agree on it. */
async function freePort(): Promise<number> {
  const { createServer } = await import('node:net')
  const probe = createServer()
  const port = await new Promise<number>((resolve) => {
    probe.listen(0, '127.0.0.1', () => resolve((probe.address() as { port: number }).port))
  })
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

function reaperArgs(host: FakeHost, idleMs = IDLE_MS): string[] {
  return [REAPER, String(host.pid), String(host.port), host.lockPath, String(idleMs)]
}

function runReaper(host: FakeHost, idleMs = IDLE_MS): void {
  const res = spawnSync(process.execPath, reaperArgs(host, idleMs), { timeout: 30_000 })
  if (res.status !== 0) throw new Error(`reaper exited ${res.status}: ${res.stderr}`)
}

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('idle reaper', () => {
  test('resolveReaperScript finds the script from the source tree', () => {
    const script = resolveReaperScript()
    expect(script).toBe(REAPER)
    expect(existsSync(script)).toBe(true)
  })

  test('idles an abandoned host out (SIGTERM) and clears its lockfile', async () => {
    const host = fakeHost(false, 0) // no listener: nobody can be attached
    try {
      expect(pidAlive(host.pid)).toBe(true)
      runReaper(host)
      await sleep(500)
      expect(pidAlive(host.pid)).toBe(false)
      expect(existsSync(host.lockPath)).toBe(false)
    } finally {
      host.kill()
    }
  }, 40_000)

  test('logs one reason=idle line (idleMs + lastClientAt) before exiting', async () => {
    const host = fakeHost(false, 0)
    const logPath = join(dirname(host.lockPath), 'opentui-host.idle.log')
    try {
      runReaper(host)
      const lines = readFileSync(logPath, 'utf8').trim().split('\n')
      const last = lines[lines.length - 1]!
      expect(last).toContain('reason=idle')
      expect(last).toContain(`idleMs=${IDLE_MS}`)
      expect(last).toContain('lastClientAt=')
      expect(last).toContain(`host=${host.pid}`)
    } finally {
      host.kill()
    }
  }, 40_000)

  test('spares a host whose lockfile now describes a different pid', async () => {
    const host = fakeHost(false, 0)
    try {
      writeFileSync(host.lockPath, JSON.stringify({ pid: 999999, port: 1, authority: '127.0.0.1:1', startedAt: '', profile: 'opentui' }, null, 2))
      runReaper(host)
      await sleep(300)
      expect(pidAlive(host.pid)).toBe(true) // replacement owns the lockfile now
      expect(existsSync(host.lockPath)).toBe(true)
    } finally {
      host.kill()
    }
  }, 40_000)

  test('spares a re-attached host (established connection to the port)', async () => {
    const port = await freePort()
    const host = fakeHost(true, port)
    let release: (() => void) | null = null
    try {
      // wait for the fake host's listener, then attach a client BEFORE the
      // window starts (a reconnecting client that beat the reaper)
      for (let i = 0; i < 40; i++) {
        await sleep(250)
        try {
          release = await holdConnection(port)
          break
        } catch {
          /* listener not up yet */
        }
      }
      expect(release).not.toBeNull() // we are attached — the reaper must see it
      await sleep(300)
      runReaper(host)
      await sleep(300)
      expect(pidAlive(host.pid)).toBe(true) // adoption path keeps the host
      expect(existsSync(host.lockPath)).toBe(true)
    } finally {
      release?.()
      host.kill()
    }
  }, 60_000)

  test('cancels the window when a client connects DURING it (reconnect race)', async () => {
    const port = await freePort()
    const host = fakeHost(true, port)
    let release: (() => void) | null = null
    try {
      // wait for the listener, with NO connection yet
      for (let i = 0; i < 40; i++) {
        await sleep(100)
        try {
          release = await holdConnection(port)
          break
        } catch {
          /* listener not up yet */
        }
      }
      // that probe connection is not the one under test: drop it and let the
      // reaper start from a clean (idle) state
      release?.()
      release = null
      await sleep(200)

      const child = spawn(process.execPath, reaperArgs(host, IDLE_MS), { stdio: 'ignore' })
      // reconnect ~40% into the window: the timer must be cancelled
      await sleep(Math.round(IDLE_MS * 0.4))
      release = await holdConnection(port)

      await once(child, 'exit')
      expect(pidAlive(host.pid)).toBe(true) // re-attached inside the window → spared
      expect(existsSync(host.lockPath)).toBe(true)
    } finally {
      release?.()
      host.kill()
    }
  }, 60_000)

  test('spares an adopted-at-the-window-edge host (lockfile generation bump, no connection yet)', async () => {
    const host = fakeHost(false, 0) // no listener: a mid-mint adoptee cannot be TCP-attached
    try {
      const child = spawn(process.execPath, reaperArgs(host, IDLE_MS), { stdio: 'ignore' })
      // a client adopts at the window edge: lifecycle's adoptHost bumps the
      // lockfile (fresh startedAt/mtime) and the adoptee now spends up to
      // ~15s minting its cookie before its first ESTABLISHED connection.
      await sleep(Math.round(IDLE_MS * 0.5))
      const bumped = JSON.parse(readFileSync(host.lockPath, 'utf8'))
      bumped.startedAt = new Date().toISOString()
      writeFileSync(host.lockPath, JSON.stringify(bumped, null, 2) + '\n')

      await once(child, 'exit') // the reaper finished its window
      expect(pidAlive(host.pid)).toBe(true) // spared — the generation bump counts as alive
      expect(existsSync(host.lockPath)).toBe(true)
    } finally {
      host.kill()
    }
  }, 40_000)

  test('an unreadable / missing lockfile never kills the host (abnormal path)', async () => {
    const host = fakeHost(false, 0)
    try {
      const missing = join(dirname(host.lockPath), 'does-not-exist.json')
      const res = spawnSync(process.execPath, [REAPER, String(host.pid), String(host.port), missing, String(IDLE_MS)], {
        timeout: 30_000,
      })
      expect(res.status).toBe(0)
      expect(pidAlive(host.pid)).toBe(true)
    } finally {
      host.kill()
    }
  }, 40_000)

  test('invalid arguments exit quietly (no throw, no kill)', () => {
    const res = spawnSync(process.execPath, [REAPER, 'not-a-pid'], { timeout: 30_000 })
    expect(res.status).toBe(2)
  }, 40_000)
})
