/**
 * Host-version compatibility gate: unit tests for the shared policy module and
 * real spawned-script tests for the provisioning side of the fix.
 *
 * The incident this pins: the bridge advertised an exact `0.2.2-rc.3` peer; on
 * an rc.4 host the loader recorded the bundle as skipped without a usable
 * error, so bridge.hello timed out. Two invariants must hold now:
 *   1. the supported window contains rc.3 -> rc.4 and caps at 0.3.0;
 *   2. provisioning either grants an exact exemption in-window or fails loud
 *      (diagnosis + repair command + mode notice) OUTSIDE it — never a
 *      silent skip, never an unconditional --accept-risk.
 */
import { describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COMPATIBILITY_FILENAME,
  HOST_PEER_RANGE,
  HOST_VERSION_ENV,
  compareVersions,
  detectHostVersion,
  ensureHostExemption,
  isExactVersion,
  isHostVersionSupported,
} from '../scripts/lib/host-compat.mjs'
import {
  BRIDGE_APPEND_PRESET_NOTICE,
  BRIDGE_REPAIR_COMMAND,
} from '../scripts/lib/bridge-failfast-text.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/provision-inproc-profile.mjs', import.meta.url))
const BRIDGE_PKG = '@aiwayds/dsh-opentui-bridge@0.1.0'

function assertThreeElements(stderr: string, diagnosisNeedle: string): void {
  expect(stderr).toContain(diagnosisNeedle)
  expect(stderr).toContain(BRIDGE_REPAIR_COMMAND)
  expect(stderr).toContain(BRIDGE_APPEND_PRESET_NOTICE)
}

// --- 1. The window itself ---------------------------------------------------
describe('host compatibility window', () => {
  test('HOST_PEER_RANGE pins the exact advertised range', () => {
    expect(HOST_PEER_RANGE).toBe('>=0.2.2-rc.3 <0.3.0')
  })

  test('type definition diff rationale: floor, rc.4, stable and cap behaviour matches host semver', () => {
    // Mirrors semver.satisfies(v, HOST_PEER_RANGE, { includePrerelease: true }).
    const cases: Array<[string, boolean]> = [
      ['0.2.2-rc.2', false], // below floor
      ['0.2.2-rc.3', true],  // floor
      ['0.2.2-rc.4', true],  // the host that triggered the incident
      ['0.2.2', true],       // stable release of the same minor
      ['0.2.9', true],
      ['0.3.0-rc.1', true],  // prereleases participate in ranges
      ['0.3.0', false],      // cap is exclusive
      ['0.1.0', false],
      ['not-a-version', false],
    ]
    for (const [version, expected] of cases) {
      expect(isHostVersionSupported(version), version).toBe(expected)
    }
  })

  test('compareVersions orders prereleases before their release', () => {
    expect(compareVersions('0.2.2-rc.3', '0.2.2-rc.4')).toBe(-1)
    expect(compareVersions('0.2.2-rc.4', '0.2.2')).toBe(-1)
    expect(compareVersions('0.3.0-rc.1', '0.3.0')).toBe(-1)
    expect(compareVersions('0.2.2-rc.10', '0.2.2-rc.9')).toBe(1)
    expect(() => compareVersions('0.2.2', 'nope')).toThrow()
  })

  test('only canonical exact versions qualify for an exemption', () => {
    expect(isExactVersion('0.2.2-rc.4')).toBe(true)
    expect(isExactVersion('0.2.2')).toBe(true)
    expect(isExactVersion('>=0.2.2-rc.3 <0.3.0')).toBe(false)
    expect(isExactVersion('0.2.2-rc.04')).toBe(false)
  })

  test('detectHostVersion honours an explicit override', () => {
    expect(detectHostVersion({ env: { [HOST_VERSION_ENV]: '0.2.2-rc.4' } })).toBe('0.2.2-rc.4')
    expect(() => detectHostVersion({ env: { [HOST_VERSION_ENV]: 'latest' } })).toThrow(/exact semantic version/)
    expect(() => detectHostVersion({ env: {}, spawn: () => ({ error: new Error('missing dsh') }) })).toThrow(/could not determine/)
  })
})

// --- 2. Exemption file ------------------------------------------------------
describe('exact-version exemption grant', () => {
  test('creates, is idempotent, and preserves unrelated grants', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-compat-exempt-'))
    try {
      const first = ensureHostExemption({
        profileDir: root,
        packageName: '@aiwayds/dsh-opentui-bridge',
        packageVersion: '0.1.0',
        hostVersion: '0.2.2-rc.4',
      })
      expect(first).toEqual({ changed: true, key: BRIDGE_PKG })
      const path = join(root, COMPATIBILITY_FILENAME)
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ [BRIDGE_PKG]: ['0.2.2-rc.4'] })

      const second = ensureHostExemption({
        profileDir: root,
        packageName: '@aiwayds/dsh-opentui-bridge',
        packageVersion: '0.1.0',
        hostVersion: '0.2.2-rc.4',
      })
      expect(second.changed).toBe(false)

      writeFileSync(path, JSON.stringify({ 'other@1.0.0': ['0.2.2-rc.3'] }))
      const third = ensureHostExemption({
        profileDir: root,
        packageName: '@aiwayds/dsh-opentui-bridge',
        packageVersion: '0.1.0',
        hostVersion: '0.2.2-rc.4',
      })
      expect(third.changed).toBe(true)
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
        'other@1.0.0': ['0.2.2-rc.3'],
        [BRIDGE_PKG]: ['0.2.2-rc.4'],
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('refuses to rewrite a malformed compatibility file', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-compat-badfile-'))
    try {
      writeFileSync(join(root, COMPATIBILITY_FILENAME), '{ not json')
      expect(() => ensureHostExemption({
        profileDir: root,
        packageName: '@aiwayds/dsh-opentui-bridge',
        packageVersion: '0.1.0',
        hostVersion: '0.2.2-rc.4',
      })).toThrow(/not valid JSON/)
      // The user's bytes are untouched — no silent clobber.
      expect(readFileSync(join(root, COMPATIBILITY_FILENAME), 'utf8')).toBe('{ not json')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// --- 3. Provisioning script (real spawn) ------------------------------------
interface Run {
  status: number | null
  stdout: string
  stderr: string
}

function runProvision(home: string, extraEnv: Record<string, string> = {}): Run {
  const result = Bun.spawnSync([process.execPath, SCRIPT], {
    env: { ...process.env, DSH_HOME: home, DSH_OPENTUI_INPROC: '1', ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    status: result.exitCode,
    stdout: result.stdout.toString('utf8'),
    stderr: result.stderr.toString('utf8'),
  }
}

describe('provision-inproc-profile.mjs host gate', () => {
  test('in-window host: exemption granted before any mutation, PASS', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-compat-inwindow-'))
    try {
      const run = runProvision(root, { [HOST_VERSION_ENV]: '0.2.2-rc.4' })
      expect(run.status).toBe(0)
      expect(run.stdout).toContain('[1/7] host')
      expect(run.stdout).toContain('granted exact-version exemption')
      expect(run.stdout).toContain('PASS')
      const compat = JSON.parse(readFileSync(join(root, 'profiles', 'opentui-inproc', COMPATIBILITY_FILENAME), 'utf8'))
      expect(compat[BRIDGE_PKG]).toContain('0.2.2-rc.4')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('out-of-window host: explicit failure with three elements, no mutation', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-compat-outwindow-'))
    try {
      const run = runProvision(root, { [HOST_VERSION_ENV]: '0.3.0' })
      expect(run.status).toBe(1)
      assertThreeElements(run.stderr, 'expected >=0.2.2-rc.3 <0.3.0, actual 0.3.0')
      expect(run.stderr).toContain('BRIDGE_TIMEOUT')
      // Fail-fast happens before manifest/symlink work: no profile was created.
      expect(existsSync(join(root, 'profiles', 'opentui-inproc', 'package.json'))).toBe(false)
      expect(existsSync(join(root, 'profiles', 'opentui-inproc', COMPATIBILITY_FILENAME))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('undetectable host: fails loud instead of assuming compatibility', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-compat-nodetect-'))
    const bin = join(root, 'bin')
    mkdirSync(bin, { recursive: true })
    const stub = join(bin, 'dsh')
    writeFileSync(stub, '#!/bin/sh\nexit 1\n')
    chmodSync(stub, 0o755)
    try {
      const run = Bun.spawnSync([process.execPath, SCRIPT], {
        env: {
          ...process.env,
          DSH_HOME: root,
          DSH_OPENTUI_INPROC: '1',
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          [HOST_VERSION_ENV]: '',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      expect(run.exitCode).toBe(1)
      const stderr = run.stderr.toString('utf8')
      assertThreeElements(stderr, 'cannot verify the dsh host version')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// --- 4. Build/provision drift guard ----------------------------------------
test('shipped bridge peer matches the provisioner window', () => {
  const peerPath = fileURLToPath(new URL('../dist/bridge/package.json', import.meta.url))
  if (!existsSync(peerPath)) return // bridge artifact not built in this checkout
  const manifest = JSON.parse(readFileSync(peerPath, 'utf8'))
  expect(manifest.peerDependencies?.['@deepseek-ai/dsh-base']).toBe(HOST_PEER_RANGE)
})
