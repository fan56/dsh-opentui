// The detached idle reaper (scripts/idle-reaper.mjs — ADR-0005 decision 5's
// entry-side half): after the grace it SIGTERMs an idle host and clears the
// lockfile, but a REPLACED host (lockfile pid moved), a RE-ATTACHED host
// (established connections to the port — the grace-window adoption marker),
// and an ADOPTED-BUT-NOT-YET-CONNECTED host (adoptHost bumps the lockfile;
// the adoptee may still be minting past the grace edge) must survive it.
// Behavioral tests: real reaper process, real fake hosts, short grace.
import { describe, expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'

const REAPER = join(import.meta.dir, '..', 'scripts', 'idle-reaper.mjs')
const GRACE_SEC = 1.5

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Backdate the lockfile mtime beyond the reaper's LOCK_RECENT_MS window
 * (30s): models a lock untouched since long before the quit. */
function backdateLock(lockPath: string, secondsAgo = 40): void {
  const t = new Date(Date.now() - secondsAgo * 1000)
  utimesSync(lockPath, t, t)
}

interface FakeHost {
  pid: number
  port: number
  lockPath: string
  kill(): void
}

/** A stand-in host: a live (optionally LISTENING) process described by a
 * lifecycle-shaped lockfile. */
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
 * THIS test process (the adoption liveness marker). */
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

function runReaper(host: FakeHost): void {
  const res = spawnSync(process.execPath, [REAPER, String(host.pid), String(host.port), host.lockPath, String(GRACE_SEC)], { timeout: 30_000 })
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
  test('idles an abandoned host out (SIGTERM) and clears its lockfile', async () => {
    const host = fakeHost(false, 0) // no listener: nobody can be attached
    try {
      expect(pidAlive(host.pid)).toBe(true)
      backdateLock(host.lockPath) // untouched since long before the quit — stale, reap it
      runReaper(host)
      await sleep(500)
      expect(pidAlive(host.pid)).toBe(false)
      expect(existsSync(host.lockPath)).toBe(false)
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
    // bind a known free port first so the fake host + the holder agree
    const { createServer } = await import('node:net')
    const bindProbe = createServer()
    const port = await new Promise<number>((resolve) => {
      bindProbe.listen(0, '127.0.0.1', () => resolve((bindProbe.address() as { port: number }).port))
    })
    // hold the port open only long enough for the fake host to bind it
    await new Promise<void>((resolve) => bindProbe.close(() => resolve()))

    const host = fakeHost(true, port)
    let release: (() => void) | null = null
    try {
      // wait for the fake host's listener, then attach a client
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
      backdateLock(host.lockPath) // the ESTABLISHED socket must be what spares, not a fresh lockfile
      runReaper(host)
      await sleep(300)
      expect(pidAlive(host.pid)).toBe(true) // adoption path keeps the host
      expect(existsSync(host.lockPath)).toBe(true)
    } finally {
      release?.()
      host.kill()
    }
  }, 60_000)

  test('spares an adopted-at-the-grace-edge host (fresh lockfile touch, no connection yet)', async () => {
    const host = fakeHost(false, 0) // no listener: a mid-mint adoptee cannot be TCP-attached
    try {
      backdateLock(host.lockPath) // untouched since long before the quit…
      const child = spawn(
        process.execPath,
        [REAPER, String(host.pid), String(host.port), host.lockPath, String(GRACE_SEC)],
        { stdio: 'ignore' },
      )
      // …then a client adopts at the grace edge: lifecycle's adoptHost bumps
      // the lockfile (fresh startedAt/mtime) and the adoptee now spends up to
      // ~15s minting its cookie before its first ESTABLISHED connection.
      await sleep((GRACE_SEC - 0.5) * 1000)
      const bumped = JSON.parse(readFileSync(host.lockPath, 'utf8'))
      bumped.startedAt = new Date().toISOString()
      writeFileSync(host.lockPath, JSON.stringify(bumped, null, 2) + '\n')

      await once(child, 'exit') // the reaper finished its window
      expect(pidAlive(host.pid)).toBe(true) // spared — the fresh touch counts as alive
      expect(existsSync(host.lockPath)).toBe(true)
    } finally {
      host.kill()
    }
  }, 40_000)
})
