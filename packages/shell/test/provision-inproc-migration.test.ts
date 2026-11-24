/**
 * T8b (2nd cut) — migration wired into the REAL provisioner (06 §7.4/§7.5).
 *
 * Every run spawns the shipped script against a throwaway DSH_HOME under
 * /private/tmp with stub dsh/npm/which on PATH. The test-only profile-name seam
 * points the provisioner at a fresh profile ('opentui-monday'), so the two
 * legacy source dirs stay separate and can be asserted read-only. Companions
 * are disabled (DSH_OPENTUI_COMPANION_LATEST=off): no registry, no network,
 * no ~/.dsh is ever touched.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/provision-inproc-profile.mjs', import.meta.url))
const NEW_PROFILE = 'opentui-monday'
// Version authority: the same shell package.json the provisioner reads.
const SHELL_VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
).version
const tempDirs: string[] = []

const STUB_DSH = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
if (args[0] === 'plugin' && args[3] === 'add') {
  const home = process.env.DSH_HOME
  const dir = path.join(home, 'profiles', process.env.DSH_OPENTUI_TEST_PROFILE_NAME || 'opentui-inproc')
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
  legacyA: string
  legacyB: string
  bin: string
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-inproc-mig-'))
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
  return {
    root,
    home,
    profile: join(home, 'profiles', NEW_PROFILE),
    legacyA: join(home, 'profiles', 'opentui'),
    legacyB: join(home, 'profiles', 'opentui-inproc'),
    bin,
  }
}

function run(fx: Fixture, extra: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: [process.execPath, SCRIPT],
    env: {
      ...process.env,
      DSH_HOME: fx.home,
      DSH_OPENTUI_TEST_PROFILE_NAME: NEW_PROFILE,
      DSH_OPENTUI_TEST_BRIDGE_DIR: join(fx.root, 'bridge'),
      DSH_OPENTUI_HOST_VERSION: '0.2.2-rc.5',
      DSH_OPENTUI_COMPANION_LATEST: 'off', // no registry / network
      DSH_STUB_WHICH_PATH: join(fx.bin, 'dsh'),
      PATH: `${fx.bin}:${process.env.PATH ?? ''}`,
      ...extra,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

const text = (buf: Uint8Array | undefined) => new TextDecoder().decode(buf ?? new Uint8Array())
const allOutput = (r: ReturnType<typeof run>) => text(r.stdout) + text(r.stderr)

function seed(fx: Fixture, legacy: 'A' | 'B', name: string, content: string) {
  const dir = legacy === 'A' ? fx.legacyA : fx.legacyB
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

function snapshot(path: string) {
  return { content: readFileSync(path, 'utf8'), mtimeMs: statSync(path).mtimeMs }
}

const subagent = (body: string) =>
  `- id: subagent\n  name: "@deepseek-ai/dsh-subagent"\n  config:\n${body}`
const session = (enabled: string) =>
  `- id: session-log-deepseek\n  config:\n    enabled: ${enabled}`
const patch = (...blocks: string[]) => blocks.join('\n') + '\n'
const BAD_YAML = '\t- id: ]]]: : : {{{  not valid  [[['

const markerPath = (fx: Fixture) => join(fx.profile, '.migration.json')
const backup = (fx: Fixture, source: string, kind: string) => join(fx.profile, '.migrated-from', `${source}-${kind}`)
const configPath = (fx: Fixture) => join(fx.profile, 'config.json')
const newPatchPath = (fx: Fixture) => join(fx.profile, 'cordis.patch.yml')
const readMarker = (fx: Fixture) => JSON.parse(readFileSync(markerPath(fx), 'utf8'))

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('T8b migration wired into the provisioner', () => {
  test('只有 opentui：config + 可迁叶进来，旧 patch 备份，marker 字段完整，源 A 不变', () => {
    const fx = fixture()
    const config = '{"theme":"carbonfox","lang":"zh-CN"}'
    const keybindings = '{"bindings":{"ctrl-x":"do-thing"}}'
    const oldPatch = patch(subagent('    maxActiveSubagents: 7'), session('false'))
    seed(fx, 'A', 'cordis.patch.yml', oldPatch)
    seed(fx, 'A', 'config.json', config)
    seed(fx, 'A', 'keybindings.json', keybindings)
    const before = [
      snapshot(join(fx.legacyA, 'cordis.patch.yml')),
      snapshot(join(fx.legacyA, 'config.json')),
      snapshot(join(fx.legacyA, 'keybindings.json')),
    ]

    const result = run(fx)
    expect(result.exitCode).toBe(0)

    // config / keybindings carried into the active profile
    expect(readFileSync(configPath(fx), 'utf8')).toBe(config)
    expect(readFileSync(join(fx.profile, 'keybindings.json'), 'utf8')).toBe(keybindings)
    // leaf values carried through externalCarry in the SAME converge pass
    const newPatch = readFileSync(newPatchPath(fx), 'utf8')
    expect(newPatch).toContain('maxActiveSubagents: 7')
    expect(newPatch).toContain('enabled: false')
    // legacy patch backed up under the new profile
    expect(readFileSync(backup(fx, 'opentui', 'cordis.patch.yml'), 'utf8')).toBe(oldPatch)
    // marker fields complete + version from package.json
    const marker = readMarker(fx)
    expect(Object.keys(marker).sort()).toEqual(['at', 'digest', 'dropped', 'from', 'migrated', 'version'])
    expect(marker.version).toBe(SHELL_VERSION)
    expect(marker.from).toEqual(['opentui'])
    expect(marker.migrated).toContain('subagent.maxActiveSubagents')
    expect(marker.migrated).toContain('session-log-deepseek.enabled')
    expect(marker.digest).toMatch(/^[0-9a-f]{64}$/)
    // notice printed once
    expect(allOutput(result).match(/迁移完成/g)?.length).toBe(1)
    // legacy A untouched
    expect(snapshot(join(fx.legacyA, 'cordis.patch.yml'))).toEqual(before[0])
    expect(snapshot(join(fx.legacyA, 'config.json'))).toEqual(before[1])
    expect(snapshot(join(fx.legacyA, 'keybindings.json'))).toEqual(before[2])
    expect(existsSync(fx.legacyB)).toBe(false)
  })

  test('只有 inproc：maxDepth / enabled / maxActiveSubagents 迁，源 A 不干扰，源 B 不变', () => {
    const fx = fixture()
    const oldPatch = patch(
      subagent('    maxActiveSubagents: 5\n    maxDepth: 3'),
      session('false'),
    )
    seed(fx, 'B', 'cordis.patch.yml', oldPatch)
    const before = snapshot(join(fx.legacyB, 'cordis.patch.yml'))

    const result = run(fx)
    expect(result.exitCode).toBe(0)

    const newPatch = readFileSync(newPatchPath(fx), 'utf8')
    expect(newPatch).toContain('maxActiveSubagents: 5')
    expect(newPatch).toContain('maxDepth: 3')
    expect(newPatch).toContain('enabled: false')
    expect(readFileSync(backup(fx, 'opentui-inproc', 'cordis.patch.yml'), 'utf8')).toBe(oldPatch)
    const marker = readMarker(fx)
    expect(marker.from).toEqual(['opentui-inproc'])
    expect(marker.migrated).toContain('subagent.maxDepth')
    expect(marker.migrated).toContain('session-log-deepseek.enabled')
    // no source A -> no config/keybindings notice
    expect(allOutput(result)).not.toContain('keybindings.json 已整份带回')
    expect(existsSync(configPath(fx))).toBe(false)
    // legacy B untouched (content + mtime)
    expect(snapshot(join(fx.legacyB, 'cordis.patch.yml'))).toEqual(before)
    expect(existsSync(fx.legacyA)).toBe(false)
  })

  test('两个都有：逐叶 inproc 优先（inproc=5 胜出 opentui=7）', () => {
    const fx = fixture()
    seed(fx, 'A', 'cordis.patch.yml', patch(subagent('    maxActiveSubagents: 7')))
    seed(fx, 'B', 'cordis.patch.yml', patch(subagent('    maxActiveSubagents: 5')))
    const beforeA = snapshot(join(fx.legacyA, 'cordis.patch.yml'))
    const beforeB = snapshot(join(fx.legacyB, 'cordis.patch.yml'))

    const result = run(fx)
    expect(result.exitCode).toBe(0)

    const newPatch = readFileSync(newPatchPath(fx), 'utf8')
    expect(newPatch).toContain('maxActiveSubagents: 5')
    expect(newPatch).not.toContain('maxActiveSubagents: 7')
    expect(readMarker(fx).from).toEqual(['opentui-inproc', 'opentui'])
    expect(existsSync(backup(fx, 'opentui-inproc', 'cordis.patch.yml'))).toBe(true)
    expect(existsSync(backup(fx, 'opentui', 'cordis.patch.yml'))).toBe(true)
    expect(snapshot(join(fx.legacyA, 'cordis.patch.yml'))).toEqual(beforeA)
    expect(snapshot(join(fx.legacyB, 'cordis.patch.yml'))).toEqual(beforeB)
  })

  test('marker 已存在：第二次启动不覆盖 config / patch / marker，不重放 notice，不读坏旧 JSON', () => {
    const fx = fixture()
    const config = '{"theme":"carbonfox"}'
    seed(fx, 'A', 'cordis.patch.yml', patch(subagent('    maxActiveSubagents: 7')))
    seed(fx, 'A', 'config.json', config)
    const first = run(fx)
    expect(first.exitCode).toBe(0)
    expect(allOutput(first)).toContain('迁移完成')

    // Corrupt legacy config and mutate active files: a marker hit must not read
    // the legacy file nor overwrite any active payload. The patch mutation stays
    // valid YAML so converge (not migration) is the only possible writer here.
    seed(fx, 'A', 'config.json', '{broken')
    writeFileSync(configPath(fx), '{"theme":"user-edited"}')
    writeFileSync(newPatchPath(fx), readFileSync(newPatchPath(fx), 'utf8').replace('maxActiveSubagents: 7', 'maxActiveSubagents: 9'))
    const beforeMarker = snapshot(markerPath(fx))
    const beforePatch = snapshot(newPatchPath(fx))
    const beforeConfig = snapshot(configPath(fx))

    const second = run(fx)
    expect(second.exitCode).toBe(0)
    expect(snapshot(markerPath(fx))).toEqual(beforeMarker)
    expect(snapshot(newPatchPath(fx))).toEqual(beforePatch)
    expect(snapshot(configPath(fx))).toEqual(beforeConfig)
    expect(allOutput(second)).not.toContain('迁移完成')
    expect(allOutput(second)).not.toContain('检测到迁移 marker')
  })

  test('坏旧 patch：非零、无 marker、有 dropped/notice、仍备份坏 patch', () => {
    const fx = fixture()
    seed(fx, 'A', 'cordis.patch.yml', BAD_YAML)
    seed(fx, 'A', 'config.json', '{"theme":"x"}')

    const result = run(fx)
    expect(result.exitCode).not.toBe(0)
    expect(existsSync(markerPath(fx))).toBe(false)
    const out = allOutput(result)
    expect(out).toContain('dropped')
    expect(out).toContain('invalid-value')
    expect(out).toContain('migration incomplete')
    expect(out).toContain(join(fx.home, 'profiles', 'opentui'))
    expect(readFileSync(backup(fx, 'opentui', 'cordis.patch.yml'), 'utf8')).toBe(BAD_YAML)
    // config was still carried (idempotent payload allowed), just not the marker
    expect(readFileSync(configPath(fx), 'utf8')).toBe('{"theme":"x"}')
  })

  test('坏 config JSON：非零、无 marker、active config 不写入，提示修旧 JSON', () => {
    const fx = fixture()
    seed(fx, 'A', 'cordis.patch.yml', patch(subagent('    maxActiveSubagents: 7')))
    seed(fx, 'A', 'config.json', '{bad')

    const result = run(fx)
    expect(result.exitCode).not.toBe(0)
    expect(existsSync(markerPath(fx))).toBe(false)
    expect(existsSync(configPath(fx))).toBe(false)
    const out = allOutput(result)
    expect(out).toContain('config.json 解析失败')
    expect(out).toContain('not valid JSON')
    expect(out).toContain(join(fx.home, 'profiles', 'opentui'))
  })

  test('连续 3 次：config / patch / marker 内容幂等', () => {
    const fx = fixture()
    seed(fx, 'A', 'cordis.patch.yml', patch(subagent('    maxActiveSubagents: 7')))
    seed(fx, 'A', 'config.json', '{"theme":"carbonfox"}')

    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      const result = run(fx)
      expect(result.exitCode).toBe(0)
      seen.push(
        [readFileSync(configPath(fx), 'utf8'), readFileSync(newPatchPath(fx), 'utf8'), readFileSync(markerPath(fx), 'utf8')].join('\u0000'),
      )
    }
    expect(seen[1]).toBe(seen[0])
    expect(seen[2]).toBe(seen[0])
  })

  test('干净 home：无迁移 notice、无 marker、正常 provision', () => {
    const fx = fixture()
    const result = run(fx)
    expect(result.exitCode).toBe(0)
    expect(existsSync(markerPath(fx))).toBe(false)
    expect(existsSync(configPath(fx))).toBe(false)
    expect(allOutput(result)).not.toContain('迁移完成')
    expect(allOutput(result)).not.toContain('migration incomplete')
    expect(readFileSync(newPatchPath(fx), 'utf8')).toContain('maxDepth: 1')
  })
})
