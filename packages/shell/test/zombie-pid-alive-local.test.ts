// Real unreaped-zombie probe for the zombie-aware pidAlive fix (f61ae5b).
//
// A zombie still answers kill(pid, 0) with success, so the old pidAlive saw it
// as "alive" and --force --yes could never confirm an old host had stopped.
// This file spawns a genuine zombie: an intermediate parent spawns `sleep`,
// then blocks in spawnSync('sleep', ...) so libuv cannot reap it. We SIGTERM
// the child, observe `ps -o stat=` enter Z, and assert the fixed probe reports
// dead while a bare kill(0) still reports alive.
//
// Safety: only darwin/linux; Z-entry is polled ≤2s (skip with reason if the CI
// host cannot produce a zombie); the parent is always released in afterAll and
// the child is confirmed reaped. Whole test is bounded to ≤10s.
import { afterAll, describe, expect, test } from 'bun:test'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isRegistryStale, type HostRegistryV2 } from '../src/client/host-registry.ts'
import { defaultPidAlive, psKillHooks } from '../src/client/safe-kill.ts'

const IS_POSIX = process.platform === 'darwin' || process.platform === 'linux'
const Z_POLL_TIMEOUT_MS = 2_000

interface ZombieFixture {
  ok: boolean
  reason?: string
  pid?: number
  parent?: ChildProcess
  dir?: string
  releaseFile?: string
  stat?: string | null
  bareAlive?: boolean
}

/** `ps -o stat=` row for pid, or null when ps is unavailable / pid is gone. */
function psStat(pid: number): string | null {
  try {
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' })
    if (result.error || result.status !== 0) return null
    return (result.stdout ?? '').trim() || null
  } catch {
    return null
  }
}

/** The old pidAlive verdict: kill(0) success without the ps-stat follow-up. */
function bareKill0(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Synchronous wait so polling never depends on a free event loop. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Build a real zombie. Never throws: any failure is returned as `{ ok: false,
 * reason }` so the test registers as a skip rather than a red CI run.
 */
async function spawnZombie(): Promise<ZombieFixture> {
  const fixture: ZombieFixture = { ok: false }
  if (!IS_POSIX) {
    fixture.reason = `unsupported platform ${process.platform}`
    return fixture
  }
  if (psStat(process.pid) === null) {
    fixture.reason = 'ps -o stat= is unavailable on this host'
    return fixture
  }

  try {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-zombie-pid-alive-'))
    fixture.dir = dir
    const script = join(dir, 'zombie-parent.mjs')
    const releaseFile = join(dir, 'release')
    fixture.releaseFile = releaseFile
    writeFileSync(script, `
import { spawn, spawnSync } from 'node:child_process'
const [childSeconds, releaseFile] = process.argv.slice(2)
const child = spawn('sleep', [childSeconds], { stdio: 'ignore' })
process.stdout.write(child.pid + '\\n')
// Block the parent's event loop so libuv's SIGCHLD watcher cannot reap child.
spawnSync('sh', ['-c', "while [ ! -f '" + releaseFile + "' ]; do sleep 0.05; done"])
`)

    const parent = spawn(process.execPath, [script, '60', releaseFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    fixture.parent = parent
    let stderr = ''
    parent.stderr?.on('data', (chunk: Buffer) => { stderr += String(chunk) })

    const pid = await new Promise<number>((resolve, reject) => {
      let buf = ''
      const timer = setTimeout(
        () => reject(new Error(`parent did not report child pid (stderr=${stderr})`)),
        2_000,
      )
      parent.once('error', (err) => { clearTimeout(timer); reject(err) })
      parent.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`parent exited before reporting child pid (code=${code}, stderr=${stderr})`))
      })
      parent.stdout!.on('data', (chunk: Buffer) => {
        buf += String(chunk)
        const match = buf.match(/^(\d+)/)
        if (match) {
          clearTimeout(timer)
          resolve(Number(match[1]))
        }
      })
    })
    fixture.pid = pid

    // Parent is blocked in spawnSync(sleep), so the SIGTERMed child is left
    // unreaped by its parent — a zombie from the test process's point of view.
    process.kill(pid, 'SIGTERM')

    const deadline = Date.now() + Z_POLL_TIMEOUT_MS
    let stat: string | null = null
    while (Date.now() < deadline) {
      stat = psStat(pid)
      if (stat !== null && stat.startsWith('Z')) break
      sleepSync(25)
    }
    stat = psStat(pid) // final read after the loop's last sleep
    fixture.stat = stat
    if (stat === null || !stat.startsWith('Z')) {
      fixture.reason = `pid ${pid} never entered Z within ${Z_POLL_TIMEOUT_MS}ms (stat=${stat})`
      return fixture
    }
    fixture.bareAlive = bareKill0(pid)
    fixture.ok = true
    return fixture
  } catch (err) {
    fixture.reason = `setup failed: ${err instanceof Error ? err.message : String(err)}`
    return fixture
  }
}

/** Always release the blocking parent and confirm no residual process remains. */
async function releaseAndReap(f: ZombieFixture): Promise<void> {
  if (!f.dir) return
  if (f.releaseFile) {
    try {
      writeFileSync(f.releaseFile, 'x')
    } catch {
      /* parent may already be gone */
    }
  }
  if (f.parent && f.parent.exitCode === null && f.parent.signalCode === null) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          f.parent?.kill('SIGKILL')
        } catch {
          /* already gone */
        }
        resolve()
      }, 2_000)
      f.parent!.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }
  if (f.pid && f.pid > 0) {
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline && psStat(f.pid) !== null) sleepSync(25)
    if (psStat(f.pid) !== null) {
      // Last resort so no zombie is left behind on a failed cleanup.
      try {
        process.kill(f.pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
  }
  try {
    rmSync(f.dir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

const fixture = await spawnZombie()

afterAll(async () => {
  await releaseAndReap(fixture)
})

describe('defaultPidAlive — real unreaped zombie (darwin/linux)', () => {
  test.skipIf(!fixture.ok)(
    fixture.ok
      ? 'ps stat Z: defaultPidAlive false while bare kill(0) is true; zombie registry pid is stale'
      : `ps stat Z zombie probe (skipped: ${fixture.reason})`,
    () => {
      const pid = fixture.pid!
      // 1. ps really reports a zombie whose command degraded to <defunct>.
      expect(fixture.stat).toMatch(/^Z/)
      // 2. Control: the old kill(0)-only logic still sees this pid as alive.
      expect(fixture.bareAlive).toBe(true)
      // 3. The fixed probe sees through the zombie.
      expect(defaultPidAlive(pid)).toBe(false)
      // 4. envReadable also rejects the zombie's unreadable env.
      expect(psKillHooks.envReadable!(pid)).toBe(false)
      // 5. host-registry layer: with the default zombie-aware probe, a record
      //    holding this zombie pid is stale (dead-pid), not adopted as live.
      const record: HostRegistryV2 = {
        version: 2,
        profile: 'opentui',
        home: fixture.dir!,
        pid,
        port: 60_123,
        phase: 'ready',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        authority: '127.0.0.1:60123',
        clients: [],
      }
      expect(isRegistryStale(record)).toEqual({ stale: true, reasons: ['dead-pid'] })
    },
    10_000,
  )
})
