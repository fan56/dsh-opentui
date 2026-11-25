/**
 * Behaviour tests for the inproc companion step of provision-inproc-profile.mjs.
 *
 * The script is spawned against a throwaway DSH_HOME with a stub `dsh` and a
 * stub `npm` first on PATH; the bridge artifact is a small fixture whose
 * index.js hash matches its bundle-fingerprint.json. Nothing touches the real
 * ~/.dsh and nothing reaches the network. Assertions read the stub's argv log,
 * the converged profile manifest and the script's stdout/stderr.
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
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMPANIONS } from '../scripts/lib/inproc-companions.mjs'
import { DEFAULT_COMPANION_IDS } from '../scripts/lib/companion-policy.mjs'
import { DEFAULT_PROFILE } from '../scripts/lib/profile-name.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/provision-inproc-profile.mjs', import.meta.url))
const REGISTRY = '@aiwayds/dsh-subagent-registry'
const DEFAULT_COMPANIONS = DEFAULT_COMPANION_IDS
  .map((id) => COMPANIONS.find((entry) => entry.short === id))
  .filter(Boolean)
const LATEST_BY_NAME = Object.fromEntries(
  DEFAULT_COMPANIONS.map((entry) => [entry.name, entry.declaredRange.slice(1)]),
)
const DEFAULT_SPECS = DEFAULT_COMPANIONS.map((entry) => `${entry.name}@${LATEST_BY_NAME[entry.name]}`)
const tempDirs: string[] = []

const STUB_DSH = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
if (process.env.DSH_STUB_LOG) fs.appendFileSync(process.env.DSH_STUB_LOG, args.join(' ') + '\\n')
if (args[0] === 'plugin' && args[1] === '--profile' && args[2] === ${JSON.stringify(DEFAULT_PROFILE)} && args[3] === 'add') {
  if (process.env.DSH_STUB_ADD_FAIL === '1') { console.error('ERR_PNPM_META_FETCH_FAIL stub'); process.exit(1) }
  const halfFail = process.env.DSH_STUB_ADD_HALF_FAIL === '1'
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
    if (halfFail) continue
    const pkgDir = path.join(dir, 'node_modules', ...name.split('/'))
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name, version }))
  }
  if (process.env.DSH_STUB_SORT_MANIFEST === '1') {
    // Real dsh plugin add + pnpm write dependencies in sorted key order and
    // append bundles in that order — not the provisioner's catalog order.
    // Opt-in so the default fixture stays stable for unrelated tests.
    const deps = manifest.dependencies
    manifest.dependencies = Object.fromEntries(Object.keys(deps).sort().map(function (k) { return [k, deps[k]] }))
    const bundles = manifest.dsh.profile.bundles
    // dsh-base + the bridge stay first; only the appended companion rows are
    // written in pnpm's sorted order.
    manifest.dsh.profile.bundles = bundles.slice(0, 2).concat(bundles.slice(2).sort())
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\\n')
  if (halfFail) { console.error('ERR_PNPM_META_FETCH_FAIL stub (half-write)'); process.exit(1) }
  process.exit(0)
}
process.exit(0)
`
const STUB_NPM = `#!/usr/bin/env node
if (process.env.DSH_STUB_NPM_FAIL === '1') { console.error('offline stub'); process.exit(1) }
const latestByPkg = ${JSON.stringify(LATEST_BY_NAME)}
const name = process.argv[3]
process.stdout.write(JSON.stringify({ latest: process.env.DSH_STUB_LATEST || latestByPkg[name] || '0.21.0' }) + '\\n')
`
// A `which` stub that never finds its target: putting this first on PATH
// deterministically simulates a host with no global `dsh`, independent of
// whatever is installed on the runner (the local dev box has one; CI does not).
const STUB_WHICH_MISS = `#!/usr/bin/env node
process.exit(1)
`

function fixture(): { home: string; bridge: string; bin: string; log: string } {
  const root = mkdtempSync(join(tmpdir(), 'inproc-companions-'))
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
  chmodSync(join(bin, 'dsh'), 0o755)
  chmodSync(join(bin, 'npm'), 0o755)
  return { home, bridge, bin, log: join(root, 'dsh.log') }
}

function provision(fx: ReturnType<typeof fixture>, env: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: [process.execPath, SCRIPT],
    env: {
      ...process.env,
      DSH_HOME: fx.home,
      DSH_OPENTUI_TEST_BRIDGE_DIR: fx.bridge,
      // The stub dsh only implements `plugin add`; pin the host version so the
      // step-1 compatibility gate is exercised without a version-printing host.
      DSH_OPENTUI_HOST_VERSION: '0.2.2-rc.5',
      DSH_STUB_LOG: fx.log,
      PATH: `${fx.bin}:${process.env.PATH ?? ''}`,
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

const text = (buf: Uint8Array | undefined) => new TextDecoder().decode(buf ?? new Uint8Array())
const stubCalls = (fx: ReturnType<typeof fixture>) => {
  try { return readFileSync(fx.log, 'utf8').split('\n').filter(Boolean) } catch { return [] }
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('provision-inproc-profile.mjs companion step (spawned, offline)', () => {
  test('fresh profile: installs the D2 default companions at their resolved latest versions', () => {
    const fx = fixture()
    const run = provision(fx)
    expect(run.exitCode).toBe(0)
    expect(text(run.stdout)).toContain('[5/8] companions — installed 11 of 11')
    expect(stubCalls(fx)).toEqual([`plugin --profile ${DEFAULT_PROFILE} add ${DEFAULT_SPECS.join(' ')}`])
    const manifest = JSON.parse(readFileSync(join(fx.home, 'profiles', DEFAULT_PROFILE, 'package.json'), 'utf8'))
    for (const entry of DEFAULT_COMPANIONS) {
      expect(manifest.dependencies[entry.name]).toBe(LATEST_BY_NAME[entry.name])
      expect(manifest.dsh.profile.bundles).toContain(entry.name)
      expect(existsSync(join(fx.home, 'profiles', DEFAULT_PROFILE, 'node_modules', ...entry.name.split('/'), 'package.json'))).toBe(true)
    }
  })

  test('second run is idempotent: no second install, no manifest rewrite', () => {
    const fx = fixture()
    expect(provision(fx).exitCode).toBe(0)
    const callsAfterFirst = stubCalls(fx).length
    const manifestBefore = readFileSync(join(fx.home, 'profiles', DEFAULT_PROFILE, 'package.json'), 'utf8')
    const second = provision(fx)
    expect(second.exitCode).toBe(0)
    expect(text(second.stdout)).toContain('already satisfied (11/11)')
    expect(stubCalls(fx)).toHaveLength(callsAfterFirst)
    expect(readFileSync(join(fx.home, 'profiles', DEFAULT_PROFILE, 'package.json'), 'utf8')).toBe(manifestBefore)
  })

  test('replay after a pnpm/dsh sorted manifest write-back creates no .bak', () => {
    const fx = fixture()
    // The CI shape: pnpm sorted the dependency keys and dsh appended the
    // companion bundles in that order, which differs from catalog order.
    expect(provision(fx, { DSH_STUB_SORT_MANIFEST: '1' }).exitCode).toBe(0)
    const profile = join(fx.home, 'profiles', DEFAULT_PROFILE)
    const manifestBefore = readFileSync(join(profile, 'package.json'), 'utf8')
    const appended = JSON.parse(manifestBefore).dsh.profile.bundles.slice(2)
    expect(appended).toEqual([...appended].sort())

    const replay = provision(fx, { DSH_STUB_SORT_MANIFEST: '1' })
    expect(replay.exitCode).toBe(0)
    expect(text(replay.stdout)).toContain('already correct, skipping')
    expect(text(replay.stdout)).not.toContain('backed up')
    expect(readdirSync(profile).filter((name) => name.includes('.bak-'))).toEqual([])
    expect(readFileSync(join(profile, 'package.json'), 'utf8')).toBe(manifestBefore)
  })

  test('genuine desired drift is still backed up and rewritten', () => {
    const fx = fixture()
    expect(provision(fx, { DSH_STUB_SORT_MANIFEST: '1' }).exitCode).toBe(0)
    const profile = join(fx.home, 'profiles', DEFAULT_PROFILE)
    const manifestPath = join(profile, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    // Drop one companion bundle row while leaving its dependency installed:
    // real desired drift, not merely a reorder of the array.
    const dropped = manifest.dsh.profile.bundles.pop()
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

    const repair = provision(fx, { DSH_STUB_SORT_MANIFEST: '1' })
    expect(repair.exitCode).toBe(0)
    const backups = readdirSync(profile).filter((name) => name.startsWith('package.json.bak-'))
    expect(backups).toHaveLength(1)
    expect(text(repair.stdout)).toContain('backed up')
    const backedUp = JSON.parse(readFileSync(join(profile, backups[0]), 'utf8'))
    expect(backedUp.dsh.profile.bundles).not.toContain(dropped)
    expect(JSON.parse(readFileSync(manifestPath, 'utf8')).dsh.profile.bundles).toContain(dropped)
  })

  test('DSH_OPENTUI_COMPANION_LATEST=off skips the install but leaves an existing install alone', () => {
    const fx = fixture()
    expect(provision(fx).exitCode).toBe(0)
    const callsAfterFirst = stubCalls(fx).length
    const off = provision(fx, { DSH_OPENTUI_COMPANION_LATEST: 'off' })
    expect(off.exitCode).toBe(0)
    expect(text(off.stdout)).toContain('skipped (DSH_OPENTUI_COMPANION_LATEST=off)')
    expect(stubCalls(fx)).toHaveLength(callsAfterFirst)
    expect(JSON.parse(readFileSync(join(fx.home, 'profiles', DEFAULT_PROFILE, 'package.json'), 'utf8')).dependencies[REGISTRY]).toBe('0.21.0')
  })

  test('a failed install is a WARN, not a boot blocker', () => {
    const fx = fixture()
    const run = provision(fx, { DSH_STUB_ADD_FAIL: '1' })
    expect(run.exitCode).toBe(0)
    expect(text(run.stderr)).toContain('companions are optional')
    expect(text(run.stdout)).toContain('installed 0 of 11')
  })

  test('no global dsh on PATH degrades to WARN-skip and still yields a usable profile', () => {
    const fx = fixture()
    // A bin with npm (dist-tag query works) but a `which` that never finds
    // `dsh` — deterministically simulates a runner without the global CLI.
    const noDshBin = join(dirname(fx.bin), 'bin-no-dsh')
    mkdirSync(noDshBin, { recursive: true })
    writeFileSync(join(noDshBin, 'npm'), STUB_NPM, { mode: 0o755 })
    writeFileSync(join(noDshBin, 'which'), STUB_WHICH_MISS, { mode: 0o755 })
    chmodSync(join(noDshBin, 'npm'), 0o755)
    chmodSync(join(noDshBin, 'which'), 0o755)

    const run = provision(fx, {
      PATH: `${noDshBin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    })
    expect(run.exitCode).toBe(0)
    expect(text(run.stdout)).toContain('PASS')
    // Actionable WARN, no FAIL — the user knows how to get companions back.
    expect(text(run.stderr)).toContain('WARN')
    expect(text(run.stderr)).toContain('no global `dsh`')
    expect(text(run.stderr)).toContain('Install dsh')
    expect(text(run.stderr)).toContain('DSH_OPENTUI_COMPANION_LATEST=off')
    expect(text(run.stdout)).toContain('[5/8] companions — skipped (no global `dsh`')
    // No add attempted, but the profile is fully provisioned and bootable.
    expect(stubCalls(fx)).toEqual([])
    const profile = join(fx.home, 'profiles', DEFAULT_PROFILE)
    expect(existsSync(join(profile, 'node_modules', '@aiwayds', 'dsh-opentui-bridge', 'index.js'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    expect(manifest.dsh.profile.bundles).toContain('@aiwayds/dsh-opentui-bridge')
    expect(manifest.dependencies?.[REGISTRY]).toBeUndefined()
  })

  test('a half-written manifest from a failed add is dropped, not a boot blocker', () => {
    const fx = fixture()
    // The stub writes the dependency + bundle row but fails before installing
    // node_modules — the exact half-write that used to hard-fail step [6/8].
    const run = provision(fx, { DSH_STUB_ADD_HALF_FAIL: '1' })
    expect(run.exitCode).toBe(0)
    expect(text(run.stderr)).toContain('companions are optional')
    expect(text(run.stderr)).toContain('dropping stale declaration')
    expect(text(run.stdout)).toContain('profile stays usable')
    const manifest = JSON.parse(readFileSync(join(fx.home, 'profiles', DEFAULT_PROFILE, 'package.json'), 'utf8'))
    expect(manifest.dependencies?.[REGISTRY]).toBeUndefined()
    expect(manifest.dsh.profile.bundles).not.toContain(REGISTRY)
  })

  test('a later offline start skips a stale declaration with a WARN and stays bootable', () => {
    const fx = fixture()
    expect(provision(fx).exitCode).toBe(0)
    const profile = join(fx.home, 'profiles', DEFAULT_PROFILE)
    rmSync(join(profile, 'node_modules', ...REGISTRY.split('/')), { recursive: true, force: true })
    const callsAfterFirst = stubCalls(fx).length
    const run = provision(fx, { DSH_STUB_NPM_FAIL: '1' })
    expect(run.exitCode).toBe(0)
    expect(text(run.stdout)).toContain('skip (offline-stale)')
    expect(text(run.stderr)).toContain('declared but not installed, and offline')
    expect(text(run.stderr)).toContain('dropping stale declaration')
    // No dsh add is attempted while offline; the stale declaration is skipped.
    expect(stubCalls(fx)).toHaveLength(callsAfterFirst)
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    expect(manifest.dependencies?.[REGISTRY]).toBeUndefined()
    expect(manifest.dsh.profile.bundles).not.toContain(REGISTRY)
  })

  test('verify catches a declared-but-missing companion (two-state drift)', () => {
    const fx = fixture()
    // Provision once to materialise everything, then delete only the mounted
    // package while the manifest still declares it; disable the step so it
    // cannot self-heal and step [6/8] is the one that reports the drift.
    expect(provision(fx).exitCode).toBe(0)
    rmSync(join(fx.home, 'profiles', DEFAULT_PROFILE, 'node_modules', ...REGISTRY.split('/')), { recursive: true, force: true })
    const run = provision(fx, { DSH_OPENTUI_COMPANION_LATEST: 'off' })
    expect(run.exitCode).toBe(1)
    expect(text(run.stderr)).toContain('companion drift')
    expect(text(run.stderr)).toContain(REGISTRY)
  })

  test('unresolved registry answers use the @latest fallback for the full default roster', () => {
    const fx = fixture()
    const run = provision(fx, { DSH_STUB_NPM_FAIL: '1' })
    expect(run.exitCode).toBe(0)
    const specs = DEFAULT_COMPANIONS.map((entry) => `${entry.name}@latest`)
    expect(stubCalls(fx)).toEqual([`plugin --profile ${DEFAULT_PROFILE} add ${specs.join(' ')}`])
  })

  test('version mismatch produces ONE summary WARN naming every skipped companion in roster order', () => {
    const fx = fixture()
    const run = provision(fx, { DSH_STUB_LATEST: '1.0.0' })
    expect(run.exitCode).toBe(0)
    const summaryLines = text(run.stderr).split('\n').filter((line) =>
      line.includes('companion(s) skipped (version query failed or outside declared range)'))
    expect(summaryLines).toHaveLength(1)
    expect(summaryLines[0]).toContain('11 companion(s)')
    expect(summaryLines[0]).toContain(DEFAULT_COMPANION_IDS.join(', '))
    expect(stubCalls(fx)).toEqual([])
  })

  test('a failed registry query is skipped in one WARN while the @latest fallback still installs', () => {
    const fx = fixture()
    const run = provision(fx, { DSH_STUB_NPM_FAIL: '1' })
    expect(run.exitCode).toBe(0)
    expect(text(run.stdout)).toContain('[5/8] companions — installed 11 of 11')
    const summaryLines = text(run.stderr).split('\n').filter((line) =>
      line.includes('companion(s) skipped (version query failed or outside declared range)'))
    expect(summaryLines).toHaveLength(1)
    expect(summaryLines[0]).toContain(DEFAULT_COMPANION_IDS.join(', '))
  })

  test('all-version-success path emits no skip summary WARN', () => {
    const fx = fixture()
    const run = provision(fx)
    expect(run.exitCode).toBe(0)
    expect(text(run.stderr)).not.toContain('companion(s) skipped (version query failed')
  })
})

/**
 * Real-host integration assertion (opt-in, not part of the offline gate).
 *
 * DSH_INPROC_COMPANION_LIVE=1 DSH_INPROC_COMPANION_HOME=<scratch home> \
 *   bun test test/provision-inproc-companions.test.ts
 *
 * `use_agent` is a runtime tool registered by the mounted plugin, so a
 * compose-only `--dump-config` cannot name it directly: what it DOES prove is
 * that the registry bundle row which registers it is present in the composed
 * tree. The actual tool call is covered by the fresh-home dispatch check.
 */
test.skipIf(process.env.DSH_INPROC_COMPANION_LIVE !== '1')(
  'real host: provisioned profile composes the use_agent-registering bundle',
  () => {
    const home = process.env.DSH_INPROC_COMPANION_HOME
    expect(home).toBeDefined()
    const run = Bun.spawnSync({
      cmd: ['dsh', '--profile', DEFAULT_PROFILE, '--dump-config'],
      env: { ...process.env, DSH_HOME: home! },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(run.exitCode).toBe(0)
    const dump = text(run.stdout)
    expect(dump).toContain('- id: dsh-subagent-registry')
    expect(dump).toContain("name: '@aiwayds/dsh-subagent-registry'")
    // The legacy list_agents bridge rides the same bundle.
    expect(dump).toContain('@aiwayds/dsh-subagent-registry/legacy-subagent-list-agents')
  },
)
