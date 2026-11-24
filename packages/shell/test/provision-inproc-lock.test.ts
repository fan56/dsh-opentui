/**
 * T4 — whole-run lock, host-lock interop and converge wiring (design 06 R14/R15,
 * oldfox-2 P0-1/P0-2/P0-8, oldfox-3 N1/N4).
 *
 * Every run is spawned against a throwaway DSH_HOME under /private/tmp with a
 * stub dsh/npm/which on PATH. Nothing touches ~/.dsh, no registry is queried
 * and no real plugin is installed.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyLock, LOCK_CORRUPT_GRACE_MS } from '../scripts/lib/provision-run-lock.mjs'
import { holderExited } from '../scripts/lib/profile-lock.mjs'
import { DEFAULT_PROFILE } from '../scripts/lib/profile-name.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/provision-inproc-profile.mjs', import.meta.url))
const tempDirs: string[] = []

const STUB_DSH = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
if (args[0] === 'plugin' && args[3] === 'add') {
  const secs = Number(process.env.DSH_STUB_ADD_SLEEP || '0')
  if (secs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, secs * 1000)
  const home = process.env.DSH_HOME
  const dir = path.join(home, 'profiles', ${JSON.stringify(DEFAULT_PROFILE)})
  const manifestPath = path.join(dir, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.dependencies = manifest.dependencies || {}
  manifest.dsh = manifest.dsh || {}
  manifest.dsh.profile = manifest.dsh.profile || {}
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles || []
  for (const spec of args.slice(4)) {
    const at = spec.lastIndexOf('@')
    const name = spec.slice(0, at)
    const version = spec.slice(at + 1) === 'latest' ? '0.21.0' : spec.slice(at + 1)
    manifest.dependencies[name] = version
    if (!manifest.dsh.profile.bundles.includes(name)) manifest.dsh.profile.bundles.push(name)
    const pkgDir = path.join(dir, 'node_modules', ...name.split('/'))
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name, version }))
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\\n')
}
process.exit(0)
`
const STUB_NPM = `#!/bin/sh
echo '{"latest":"0.21.0"}'
`
const STUB_WHICH = `#!/bin/sh
echo "$DSH_STUB_WHICH_PATH"
`

interface Fixture {
  root: string
  home: string
  profile: string
  bin: string
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'inproc-lock-'))
  tempDirs.push(root)
  const home = join(root, 'home')
  const bridge = join(root, 'bridge')
  const bin = join(root, 'bin')
  for (const dir of [home, bridge, bin]) mkdirSync(dir, { recursive: true })
  const indexJs = '// fixture bridge index\n'
  writeFileSync(join(bridge, 'index.js'), indexJs)
  writeFileSync(join(bridge, 'package.json'), JSON.stringify({ name: '@aiwayds/dsh-opentui-bridge', version: '0.1.0' }))
  writeFileSync(join(bridge, 'bundle-fingerprint.json'), JSON.stringify({
    name: '@aiwayds/dsh-opentui-bridge',
    version: '0.1.0',
    sha256: createHash('sha256').update(indexJs).digest('hex'),
  }))
  writeFileSync(join(bin, 'dsh'), STUB_DSH, { mode: 0o755 })
  writeFileSync(join(bin, 'npm'), STUB_NPM, { mode: 0o755 })
  writeFileSync(join(bin, 'which'), STUB_WHICH, { mode: 0o755 })
  chmodSync(join(bin, 'dsh'), 0o755)
  return { root, home, profile: join(home, 'profiles', DEFAULT_PROFILE), bin }
}

function env(fx: Fixture, extra: Record<string, string> = {}) {
  return {
    ...process.env,
    DSH_HOME: fx.home,
    DSH_OPENTUI_TEST_BRIDGE_DIR: join(fx.root, 'bridge'),
    DSH_OPENTUI_HOST_VERSION: '0.2.2-rc.5',
    DSH_STUB_WHICH_PATH: join(fx.bin, 'dsh'),
    PATH: `${fx.bin}:${process.env.PATH ?? ''}`,
    ...extra,
  }
}

function run(fx: Fixture, extra: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: [process.execPath, SCRIPT],
    env: env(fx, extra),
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

const text = (buf: Uint8Array | undefined) => new TextDecoder().decode(buf ?? new Uint8Array())
const patchPath = (fx: Fixture) => join(fx.profile, 'cordis.patch.yml')
const sidecarPath = (fx: Fixture) => join(fx.profile, '.patch-ownership.json')
const runLockPath = (fx: Fixture) => join(fx.profile, '.provision.lock')
const profileLockPath = (fx: Fixture) => join(fx.profile, 'package.json.lock')

function baseline(fx: Fixture) {
  const first = run(fx, { DSH_OPENTUI_COMPANION_LATEST: 'off' })
  expect(first.exitCode).toBe(0)
  return first
}

async function deadPid(): Promise<number> {
  const child = Bun.spawn(['/bin/sleep', '0.01'], { stdout: 'ignore', stderr: 'ignore' })
  await child.exited
  return child.pid
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('lock liveness (pure + fake pid)', () => {
  test('a live holder aged one hour is still live — age never makes it stale', () => {
    const now = Date.now()
    const verdict = classifyLock(
      { pid: process.pid, nonce: 'x', startedAt: now - 3_600_000, step: '4/7 companions', mtimeMs: now - 3_600_000 },
      now,
    )
    expect(verdict.state).toBe('live')
    expect(verdict.takeover).toBe(false)
  })

  test('dead pid is reclaimable; corrupt record only after the grace window', async () => {
    const now = Date.now()
    expect(classifyLock({ pid: 99_999, mtimeMs: now }, now, () => false).takeover).toBe(true)
    expect(classifyLock({ corrupt: true, mtimeMs: now }, now).takeover).toBe(false)
    expect(classifyLock({ corrupt: true, mtimeMs: now - LOCK_CORRUPT_GRACE_MS - 1 }, now).takeover).toBe(true)
    // The host lock accepts ONLY ${pid}\n, never JSON / a reused self pid.
    expect(holderExited(`${process.pid}\n`)).toBe(false)
    expect(holderExited(`${await deadPid()}\n`)).toBe(true)
    expect(holderExited('{"pid":123}\n')).toBe(false)
  })
})

describe('provision-inproc-profile.mjs — whole-run lock', () => {
  test('a concurrent second instance fails with exit 2 (never SKIP-0)', async () => {
    const fx = fixture()
    const first = Bun.spawn({
      cmd: [process.execPath, SCRIPT],
      env: env(fx, { DSH_STUB_ADD_SLEEP: '2' }),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    try {
      // Wait until the first process actually owns the lock.
      const deadline = Date.now() + 3_000
      while (Date.now() < deadline && !existsSync(runLockPath(fx))) await Bun.sleep(10)
      expect(existsSync(runLockPath(fx))).toBe(true)
      const second = run(fx, {
        DSH_OPENTUI_PROVISION_LOCK_WAIT_MS: '150',
        DSH_OPENTUI_COMPANION_LATEST: 'off',
      })
      expect(second.exitCode).toBe(2)
      expect(text(second.stderr)).toContain('could not acquire')
      expect(text(second.stderr)).toContain('holder pid')
      expect(text(second.stderr)).not.toContain('SKIP')
      expect(text(second.stdout)).not.toContain('PASS')
    } finally {
      await first.exited
    }
    expect(await new Response(first.stdout).text()).toContain('PASS')
  }, 10_000)

  test('remaining lock with a live fake pid is refused even when 1h old', () => {
    const fx = fixture()
    baseline(fx)
    writeFileSync(runLockPath(fx), `${JSON.stringify({
      pid: process.pid,
      nonce: 'fake-live',
      startedAt: Date.now() - 3_600_000,
      heartbeatAt: Date.now() - 3_600_000,
      step: '4/7 companions',
    })}\n`)
    const second = run(fx, { DSH_OPENTUI_PROVISION_LOCK_WAIT_MS: '100', DSH_OPENTUI_COMPANION_LATEST: 'off' })
    expect(second.exitCode).toBe(2)
    expect(text(second.stderr)).toContain(`holder pid ${process.pid}`)
    expect(text(second.stderr)).toContain('manually')
    expect(existsSync(runLockPath(fx))).toBe(true)
  })

  test('a foreign live pid is never taken over; a dead pid is reclaimed via claim', async () => {
    const fx = fixture()
    baseline(fx)
    const live = Bun.spawn(['/bin/sleep', '5'], { stdout: 'ignore', stderr: 'ignore' })
    try {
      writeFileSync(runLockPath(fx), `${JSON.stringify({ pid: live.pid, nonce: 'foreign', startedAt: Date.now(), step: 'x' })}\n`)
      const refused = run(fx, { DSH_OPENTUI_PROVISION_LOCK_WAIT_MS: '100', DSH_OPENTUI_COMPANION_LATEST: 'off' })
      expect(refused.exitCode).toBe(2)
      expect(text(refused.stderr)).toContain(`holder pid ${live.pid}`)
    } finally {
      live.kill()
    }
    await live.exited
    const healed = run(fx, { DSH_OPENTUI_PROVISION_LOCK_WAIT_MS: '100', DSH_OPENTUI_COMPANION_LATEST: 'off' })
    expect(healed.exitCode).toBe(0)
    expect(existsSync(runLockPath(fx))).toBe(false)
    expect(readdirSync(fx.profile).some((name) => name.includes('.takeover-'))).toBe(false)
  }, 10_000)

  test('host package.json.lock with a live pid makes provision fail with exit 2', () => {
    const fx = fixture()
    baseline(fx)
    writeFileSync(profileLockPath(fx), `${process.pid}\n`)
    const second = run(fx, { DSH_OPENTUI_PROFILE_LOCK_WAIT_MS: '100', DSH_OPENTUI_COMPANION_LATEST: 'off' })
    expect(second.exitCode).toBe(2)
    expect(text(second.stderr)).toContain('package.json.lock')
    expect(text(second.stderr)).toContain(`holder pid ${process.pid}`)
    expect(readFileSync(profileLockPath(fx), 'utf8')).toBe(`${process.pid}\n`)
  })

  test('host lock with a dead pid is reclaimed and its claim is cleaned up', async () => {
    const fx = fixture()
    baseline(fx)
    const pid = await deadPid()
    writeFileSync(profileLockPath(fx), `${pid}\n`)
    const second = run(fx, { DSH_OPENTUI_COMPANION_LATEST: 'off' })
    expect(second.exitCode).toBe(0)
    expect(existsSync(profileLockPath(fx))).toBe(false)
    expect(readdirSync(fx.profile).some((name) => name.includes('.takeover-'))).toBe(false)
  }, 10_000)
})

describe('provision-inproc-profile.mjs — converge wiring', () => {
  test('write:false self-heals a missing sidecar without touching the patch (N1)', () => {
    const fx = fixture()
    baseline(fx)
    const before = readFileSync(patchPath(fx), 'utf8')
    expect(existsSync(sidecarPath(fx))).toBe(true)
    const backupsBefore = readdirSync(fx.profile).filter((name) => name.includes('cordis.patch.yml.bak-')).length
    rmSync(sidecarPath(fx))

    const again = run(fx, { DSH_OPENTUI_COMPANION_LATEST: 'off' })
    expect(again.exitCode).toBe(0)
    expect(text(again.stdout)).toContain('already current; rewrote missing/stale ownership sidecar')
    expect(existsSync(sidecarPath(fx))).toBe(true)
    expect(readFileSync(patchPath(fx), 'utf8')).toBe(before)
    expect(readdirSync(fx.profile).filter((name) => name.includes('cordis.patch.yml.bak-'))).toHaveLength(backupsBefore)
  })

  test('a stale sidecar revision is rewritten on a no-write pass', () => {
    const fx = fixture()
    baseline(fx)
    const state = JSON.parse(readFileSync(sidecarPath(fx), 'utf8'))
    state.templateRevision = 'stale'
    writeFileSync(sidecarPath(fx), JSON.stringify(state))
    const again = run(fx, { DSH_OPENTUI_COMPANION_LATEST: 'off' })
    expect(again.exitCode).toBe(0)
    expect(text(again.stdout)).toContain('rewrote missing/stale ownership sidecar')
    expect(JSON.parse(readFileSync(sidecarPath(fx), 'utf8')).templateRevision).not.toBe('stale')
  })

  test('unparseable current patch: line:col diagnostic, no write, non-zero exit', () => {
    const fx = fixture()
    baseline(fx)
    const broken = '- id: [\n  name: "unterminated\n'
    writeFileSync(patchPath(fx), broken)
    const again = run(fx, { DSH_OPENTUI_COMPANION_LATEST: 'off' })
    expect(again.exitCode).not.toBe(0)
    expect(text(again.stderr)).toMatch(/cordis\.patch\.yml:\d+:\d+:/)
    expect(text(again.stderr)).toContain('Refusing to overwrite')
    expect(readFileSync(patchPath(fx), 'utf8')).toBe(broken)
  })

  test('a corrupt .provision.lock older than the grace window is reclaimed', () => {
    const fx = fixture()
    baseline(fx)
    writeFileSync(runLockPath(fx), '')
    const old = new Date(Date.now() - LOCK_CORRUPT_GRACE_MS - 5_000)
    utimesSync(runLockPath(fx), old, old)
    const again = run(fx, { DSH_OPENTUI_COMPANION_LATEST: 'off' })
    expect(again.exitCode).toBe(0)
    expect(existsSync(runLockPath(fx))).toBe(false)
  })
})
