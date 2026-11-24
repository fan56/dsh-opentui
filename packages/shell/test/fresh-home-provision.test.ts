/**
 * D5 fresh-home provision verifier tests (T6 third cut).
 *
 * No install, no registry, no ~/.dsh: a fake prefix ships a fake provisioner
 * that mimics the real script's observable contract (profile layout, patch +
 * ownership sidecar, companion tree, bridge copy, lock cleanup, fail-fast trio,
 * live-lock exit 2, --repair-bridge recovery). The REAL provisioner integration
 * is left to the final gate; these tests only prove the verifier's orchestration.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  buildEnv,
  locatePackage,
  resolveHostVersion,
  runVerification,
  stripDshFromPath,
} from '../../../scripts/verify-fresh-home-provision.mjs'

const VERIFIER = fileURLToPath(new URL('../../../scripts/verify-fresh-home-provision.mjs', import.meta.url))
const TMP = mkdtempSync(join(tmpdir(), 'dsh-verify-unit-'))
const PREFIX = join(TMP, 'prefix')
const PKG = join(PREFIX, 'lib', 'node_modules', '@aiwayds', 'dsh-opentui')
const PROFILE = 'opentui-monday'
// The authoritative D2 roster: 11 short IDs from companion-policy.mjs.
const COMPANION_POLICY_IDS = [
  'registry', 'ask-router', 'approval-policy', 'llm-net-retry', 'model-sync',
  'llm-stats', 'mcp-adapter', 'vault', 'web-search', 'topics-memory', 'cron',
]
const COMPANION_NAMES = [
  '@aiwayds/dsh-subagent-registry',
  '@aiwayds/dsh-ask-router',
  '@aiwayds/dsh-approval-policy',
  '@aiwayds/dsh-llm-net-retry',
  '@aiwayds/dsh-model-sync',
  '@aiwayds/dsh-llm-stats',
  '@aiwayds/dsh-mcp-adapter',
  '@aiwayds/dsh-vault',
  '@aiwayds/dsh-web-search-anysearch',
  '@aiwayds/dsh-topics-memory',
  '@aiwayds/dsh-cron',
]

// Fake provisioner: written as plain text so it can be reviewed like a fixture.
// It deliberately avoids backticks inside strings to keep this source readable.
const FAKE_PROVISIONER = `import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PROFILE } from './lib/profile-name.mjs'
import { COMPANIONS } from './lib/inproc-companions.mjs'

const P = 'fake-provisioner: '
const home = process.env.DSH_HOME
const repair = process.argv.includes('--repair') || process.argv.includes('--repair-bridge')
fs.mkdirSync(home, { recursive: true })
fs.writeFileSync(path.join(home, '_env.json'), JSON.stringify({
  HOME: process.env.HOME,
  DSH_HOME: process.env.DSH_HOME,
  PATH: process.env.PATH,
  HOST_VERSION: process.env.DSH_OPENTUI_HOST_VERSION ?? null,
  REPAIR: repair,
}))

function fail(msg, detail) {
  console.error(P + 'FAIL - ' + msg)
  if (detail) console.error(detail)
  console.error('Run dsh-opentui --repair-bridge to rebuild the bridge manifest (it fixes links, not corrupted artifact contents).')
  console.error('inproc bridge mode injects append-system via the bridge section; presets are standard only.')
  process.exit(1)
}

const hasDsh = String(process.env.PATH || '').split(':').some(function (dir) {
  return dir && fs.existsSync(path.join(dir, 'dsh'))
})
if (!process.env.DSH_OPENTUI_HOST_VERSION && !hasDsh) {
  fail('cannot verify the dsh host version before loading the bridge', 'could not determine dsh --version')
}

const profileDir = path.join(home, 'profiles', DEFAULT_PROFILE)
const lockPath = path.join(profileDir, '.provision.lock')
fs.mkdirSync(profileDir, { recursive: true })
if (fs.existsSync(lockPath)) {
  const rec = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  let live = false
  try { process.kill(rec.pid, 0); live = true } catch (_) {}
  if (live) {
    console.error(P + 'FAIL - could not acquire ' + lockPath + ' within 100ms (holder alive)')
    process.exit(2)
  }
}

const bridgeSrc = process.env.DSH_OPENTUI_TEST_BRIDGE_DIR
  || fileURLToPath(new URL('../dist/bridge/', import.meta.url))
const badFp = path.join(bridgeSrc, 'bundle-fingerprint.json')
if (fs.existsSync(badFp)) {
  const fp = JSON.parse(fs.readFileSync(badFp, 'utf8'))
  if (typeof fp.version === 'string' && fp.version.indexOf('BROKEN') >= 0) {
    if (repair) {
      const good = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../dist/bridge/bundle-fingerprint.json', import.meta.url)), 'utf8'))
      fs.writeFileSync(badFp, JSON.stringify(good))
    } else {
      fail('bridge identity check failed - version mismatch', 'expected "0.0.0-BROKEN-FIXTURE", actual "0.1.0"')
    }
  }
}

fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, nonce: 'provision' }))
fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-' + DEFAULT_PROFILE,
  private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@aiwayds/dsh-opentui-bridge'].concat(COMPANIONS.map(function (e) { return e.name })) } },
}))
const template = [
  '- id: llm-pi-ai',
  '  name: "@deepseek-ai/dsh-llm-pi-ai"',
  '- id: permission',
  '  name: "@deepseek-ai/dsh-permission-presets"',
  '- id: subagent',
  '  name: "@deepseek-ai/dsh-subagent"',
  '- insert:',
  '    - id: dsh-approval-policy',
  '      name: "@aiwayds/dsh-approval-policy"',
].join('\\n') + '\\n'
const revision = createHash('sha256').update(template).digest('hex').slice(0, 16)
fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), '# fake patch\\n# profileRevision: ' + revision + '\\n' + template)
const badSidecar = fs.existsSync(new URL('./bad-sidecar.flag', import.meta.url))
fs.writeFileSync(path.join(profileDir, '.patch-ownership.json'), JSON.stringify({
  version: 1, templateRevision: badSidecar ? 'deadbeefdeadbeef' : revision, writtenAt: '2026-11-24T00:00:00.000Z', rows: {},
}))
for (const entry of COMPANIONS) {
  const name = typeof entry === 'string' ? entry : entry.name
  if (fs.existsSync(new URL('./missing-companion.flag', import.meta.url)) && name === COMPANIONS[0].name) continue
  fs.mkdirSync(path.join(profileDir, 'node_modules', ...name.split('/')), { recursive: true })
}
if (fs.existsSync(new URL('./extra-companion.flag', import.meta.url))) {
  fs.mkdirSync(path.join(profileDir, 'node_modules', '@aiwayds', 'dsh-decoy-extra'), { recursive: true })
}
fs.cpSync(bridgeSrc, path.join(profileDir, 'node_modules', '@aiwayds', 'dsh-opentui-bridge'), { recursive: true })
fs.rmSync(lockPath, { force: true })
console.log(P + 'PASS')
`

const FAKE_DSH = `#!/usr/bin/env node
if (process.argv[2] === '--version') { console.log('0.2.2-rc.5'); process.exit(0) }
process.exit(0)
`

let dshBin: string
let userDshDir: string
const originalPath = process.env.PATH

beforeAll(() => {
  mkdirSync(join(PKG, 'scripts', 'lib'), { recursive: true })
  mkdirSync(join(PKG, 'dist', 'bridge'), { recursive: true })
  writeFileSync(join(PKG, 'package.json'), JSON.stringify({ name: '@aiwayds/dsh-opentui', version: '0.18.3' }))
  writeFileSync(join(PKG, 'scripts', 'lib', 'profile-name.mjs'), `export const DEFAULT_PROFILE = '${PROFILE}'\n`)
  writeFileSync(join(PKG, 'scripts', 'lib', 'companion-policy.mjs'),
    `export const DEFAULT_COMPANION_IDS = ${JSON.stringify(COMPANION_POLICY_IDS)}\n`)
  writeFileSync(join(PKG, 'scripts', 'lib', 'inproc-companions.mjs'),
    `export const COMPANIONS = ${JSON.stringify(COMPANION_POLICY_IDS.map((short, i) => ({ short, name: COMPANION_NAMES[i], defaultOn: true })))}\n`
    + `export function selectCompanions() { return COMPANIONS }\n`)
  writeFileSync(join(PKG, 'scripts', 'provision-inproc-profile.mjs'), FAKE_PROVISIONER)

  const indexSrc = '// fake bridge entry\n'
  writeFileSync(join(PKG, 'dist', 'bridge', 'index.js'), indexSrc)
  writeFileSync(join(PKG, 'dist', 'bridge', 'package.json'), JSON.stringify({ name: '@aiwayds/dsh-opentui-bridge', version: '0.1.0' }))
  writeFileSync(join(PKG, 'dist', 'bridge', 'bundle-fingerprint.json'), JSON.stringify({
    name: '@aiwayds/dsh-opentui-bridge',
    version: '0.1.0',
    sha256: createHash('sha256').update(indexSrc).digest('hex'),
  }))
  writeFileSync(join(PKG, 'dist', 'bridge', 'cordis.patch.yml'), '')

  dshBin = join(TMP, 'scoped-bin', 'dsh')
  mkdirSync(dirname(dshBin), { recursive: true })
  writeFileSync(dshBin, FAKE_DSH, { mode: 0o755 })
  chmodSync(dshBin, 0o755)

  userDshDir = join(TMP, 'user-bin')
  mkdirSync(userDshDir, { recursive: true })
  writeFileSync(join(userDshDir, 'dsh'), FAKE_DSH, { mode: 0o755 })
})

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

function statusOf(report: any, name: string): string {
  return report.checks.find((c: any) => c.name === name)?.status ?? 'MISSING'
}

describe('fake prefix plumbing', () => {
  test('locatePackage finds the lib/node_modules layout and reads DEFAULT_PROFILE', async () => {
    const located = locatePackage(PREFIX)
    expect(located.packageRoot).toBe(PKG)
    const mod = await import(pathToFileURL(join(PKG, 'scripts', 'lib', 'profile-name.mjs')).href)
    expect(mod.DEFAULT_PROFILE).toBe(PROFILE)
  })

  test('stripDshFromPath drops user-level dsh dirs, resolveHostVersion reads a pin first', () => {
    const pathWithUserDsh = `${userDshDir}:${originalPath}`
    const stripped = stripDshFromPath(pathWithUserDsh)
    expect(stripped.split(':')).not.toContain(userDshDir)
    const saved = process.env.DSH_OPENTUI_HOST_VERSION
    try {
      process.env.DSH_OPENTUI_HOST_VERSION = '0.2.2-rc.3'
      expect(resolveHostVersion({ dshBin, env: buildEnv({}) })).toBe('0.2.2-rc.3')
      delete process.env.DSH_OPENTUI_HOST_VERSION
      expect(resolveHostVersion({ dshBin, env: buildEnv({}) })).toBe('0.2.2-rc.5')
    } finally {
      if (saved === undefined) delete process.env.DSH_OPENTUI_HOST_VERSION
      else process.env.DSH_OPENTUI_HOST_VERSION = saved
    }
  })
})

describe('verifier against a fake provisioner', () => {
  test('positive pass: all assertions PASS, 11 policy companions verified exactly, JSON shape complete', async () => {
    const report: any = await runVerification({ prefix: PREFIX, dshBin, keep: false })
    expect(report.pass).toBe(true)
    expect(report.profileName).toBe(PROFILE)
    expect(report.profile).toContain(join('profiles', PROFILE))
    expect(report.desiredCompanionIds).toEqual(COMPANION_POLICY_IDS)
    expect(report.desiredCompanions.length).toBe(11)
    expect(report.desiredCompanions).toEqual(COMPANION_NAMES)
    for (const key of ['prefix', 'scratchHome', 'profile', 'pass', 'checks', 'scenarios', 'notes', 'durationMs']) {
      expect(Object.prototype.hasOwnProperty.call(report, key)).toBe(true)
    }
    expect(statusOf(report, 'positive:exit0')).toBe('PASS')
    expect(statusOf(report, 'profile:exists')).toBe('PASS')
    expect(statusOf(report, 'legacy:opentui:absent')).toBe('PASS')
    expect(statusOf(report, 'legacy:opentui-inproc:absent')).toBe('PASS')
    expect(statusOf(report, 'patch:managed-lines')).toBe('PASS')
    expect(statusOf(report, 'ownership:sidecar-exists')).toBe('PASS')
    expect(statusOf(report, 'ownership:revision-matches')).toBe('PASS')
    expect(statusOf(report, 'companions:desired')).toBe('PASS')
    expect(statusOf(report, 'companions:manifest-exact')).toBe('PASS')
    expect(statusOf(report, 'companions:ondisk-exact')).toBe('PASS')
    expect(statusOf(report, 'bridge:copied')).toBe('PASS')
    expect(statusOf(report, 'bridge:identity')).toBe('PASS')
    expect(statusOf(report, 'lock:released')).toBe('PASS')
    expect(existsSync(report.scratchHome)).toBe(false)
  })

  test('negative paths: no-dsh fail-fast, live-lock exit 2 without overwrite, bad bridge fail-fast + repair', async () => {
    const report: any = await runVerification({ prefix: PREFIX, dshBin, keep: false })
    expect(statusOf(report, 'negative:no-dsh:exit-nonzero')).toBe('PASS')
    expect(statusOf(report, 'negative:no-dsh:fail-fast-trio')).toBe('PASS')
    expect(statusOf(report, 'negative:no-dsh:no-profile-artifacts')).toBe('PASS')
    expect(statusOf(report, 'negative:no-dsh:strict-no-profile-dir')).toBe('NOT RUN')
    expect(statusOf(report, 'negative:live-lock:exit-2')).toBe('PASS')
    expect(statusOf(report, 'negative:live-lock:not-overwritten')).toBe('PASS')
    expect(statusOf(report, 'negative:bad-bridge:fail-fast')).toBe('PASS')
    expect(statusOf(report, 'negative:bad-bridge:repair-restores')).toBe('PASS')
    expect(report.scenarios.liveLock.status).toBe(2)
    expect(report.scenarios.badBridge.status).toBe(1)
    expect(report.scenarios.badBridgeRepair.status).toBe(0)
  })

  test('scratch HOME isolation: no user dsh on PATH, both HOME vars point into scratch, --keep retains', async () => {
    const savedPath = process.env.PATH
    try {
      process.env.PATH = `${userDshDir}:${savedPath ?? ''}`
      const report: any = await runVerification({ prefix: PREFIX, dshBin, keep: true })
      expect(report.kept).toBe(true)
      expect(existsSync(report.scratchHome)).toBe(true)
      expect(report.scratchHome).toContain('dsh-fresh-home-')
      const envSnapshot = JSON.parse(readFileSync(join(report.scratchHome, 'home-positive', '_env.json'), 'utf8'))
      expect(envSnapshot.HOME).toBe(report.scratchHome)
      expect(envSnapshot.DSH_HOME).toBe(join(report.scratchHome, 'home-positive'))
      const pathParts = String(envSnapshot.PATH).split(':')
      expect(pathParts).not.toContain(userDshDir)
      expect(pathParts[0]).toBe(dirname(dshBin))
      rmSync(report.scratchHome, { recursive: true, force: true })
    } finally {
      process.env.PATH = savedPath
    }
  })

  test('CLI --json prints JSON only and exits 0 on an all-PASS fake run', () => {
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
    const result = spawnSync(process.execPath, [VERIFIER, '--prefix', PREFIX, '--with-dsh', dshBin, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: String(originalPath) },
    })
    expect(result.status).toBe(0)
    const trimmed = String(result.stdout).trim()
    expect(trimmed.startsWith('{')).toBe(true)
    const report = JSON.parse(trimmed)
    expect(report.pass).toBe(true)
    expect(report.checks.length).toBeGreaterThan(12)
  })

  test('CLI exits 2 when profile-name.mjs is missing from the prefix', () => {
    const brokenRoot = join(TMP, 'broken-prefix', 'lib', 'node_modules', '@aiwayds', 'dsh-opentui')
    mkdirSync(join(brokenRoot, 'scripts'), { recursive: true })
    writeFileSync(join(brokenRoot, 'scripts', 'provision-inproc-profile.mjs'), FAKE_PROVISIONER)
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
    const result = spawnSync(process.execPath, [VERIFIER, '--prefix', join(TMP, 'broken-prefix'), '--json'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: String(originalPath) },
    })
    expect(result.status).toBe(2)
    expect(String(result.stderr)).toContain('profile-name.mjs')
  })

  test('CLI exits 2 when companion-policy.mjs is missing from the prefix', () => {
    const brokenRoot = join(TMP, 'no-policy-prefix', 'lib', 'node_modules', '@aiwayds', 'dsh-opentui')
    mkdirSync(join(brokenRoot, 'scripts', 'lib'), { recursive: true })
    writeFileSync(join(brokenRoot, 'scripts', 'provision-inproc-profile.mjs'), FAKE_PROVISIONER)
    writeFileSync(join(brokenRoot, 'scripts', 'lib', 'profile-name.mjs'), `export const DEFAULT_PROFILE = '${PROFILE}'\n`)
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
    const result = spawnSync(process.execPath, [VERIFIER, '--prefix', join(TMP, 'no-policy-prefix'), '--json'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: String(originalPath) },
    })
    expect(result.status).toBe(2)
    expect(String(result.stderr)).toContain('companion-policy.mjs')
  })

  test('sidecar.templateRevision mismatch is a FAIL against the real producer shape', async () => {
    const flag = join(PKG, 'scripts', 'bad-sidecar.flag')
    writeFileSync(flag, '1')
    try {
      const report: any = await runVerification({ prefix: PREFIX, dshBin, keep: false })
      expect(report.pass).toBe(false)
      expect(statusOf(report, 'ownership:revision-matches')).toBe('FAIL')
      const detail = report.checks.find((c: any) => c.name === 'ownership:revision-matches').detail
      expect(detail).toContain('sidecar.templateRevision=deadbeefdeadbeef')
    } finally {
      rmSync(flag, { force: true })
    }
  })

  test('companion exactness rejects extras and missing policy ids', async () => {
    const extraFlag = join(PKG, 'scripts', 'extra-companion.flag')
    const missingFlag = join(PKG, 'scripts', 'missing-companion.flag')
    try {
      writeFileSync(extraFlag, '1')
      let report: any = await runVerification({ prefix: PREFIX, dshBin, keep: false })
      expect(statusOf(report, 'companions:ondisk-exact')).toBe('FAIL')
      expect(String(report.checks.find((c: any) => c.name === 'companions:ondisk-exact').detail)).toContain('dsh-decoy-extra')

      rmSync(extraFlag, { force: true })
      writeFileSync(missingFlag, '1')
      report = await runVerification({ prefix: PREFIX, dshBin, keep: false })
      expect(statusOf(report, 'companions:desired')).toBe('FAIL')
      expect(statusOf(report, 'companions:ondisk-exact')).toBe('FAIL')
    } finally {
      rmSync(extraFlag, { force: true })
      rmSync(missingFlag, { force: true })
    }
  })
})
