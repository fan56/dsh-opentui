/**
 * T8b — migration I/O helper tests. Everything lives in a scratch dir; the
 * real ~/.dsh is never read or written.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyMigrationPlan, readMigrationInputs } from '../scripts/lib/migration-io.mjs'

let root: string
let dshHome: string
let profileDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-migration-io-'))
  dshHome = join(root, 'home')
  profileDir = join(dshHome, 'profiles', 'opentui-monday')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const NOW = new Date('2026-11-24T12:34:56.000Z')
const OLD_TIME = new Date('2020-01-01T00:00:00.000Z')

function mode(path: string): number {
  return statSync(path).mode & 0o777
}

function oldPath(name: string, file: string): string {
  return join(dshHome, 'profiles', name, file)
}

function seedOld(name: string, file: string, text: string): string {
  const path = oldPath(name, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  return path
}

function basePlan(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    config: undefined,
    keybindings: undefined,
    backups: [],
    marker: undefined,
    canWriteMarker: false,
    notices: ['迁移完成：迁入 1 项，丢弃 0 项，备份 1 份。'],
    ...overrides,
  }
}

const SIMPLE_MARKER = { from: ['opentui'], migrated: [], dropped: [] }

describe('readMigrationInputs', () => {
  test('干净 home：全部字段 undefined，markerExists=false，不创建目录', () => {
    const inputs = readMigrationInputs({ dshHome, profileDir, templatePatchText: '' })
    expect(inputs).toEqual({
      markerExists: false,
      marker: undefined,
      inprocPatchText: undefined,
      opentuiPatchText: undefined,
      opentuiConfigText: undefined,
      opentuiKeybindingsText: undefined,
      opentuiProviderKeysText: undefined,
    })
    expect(existsSync(dshHome)).toBe(false)
    expect(existsSync(profileDir)).toBe(false)
  })

  test('读出两个旧 profile 的 patch / config / keybindings / provider-keys', () => {
    seedOld('opentui', 'cordis.patch.yml', '- id: permission\n')
    seedOld('opentui-inproc', 'cordis.patch.yml', '- id: subagent\n')
    seedOld('opentui', 'config.json', '{"theme":"carbonfox"}')
    seedOld('opentui', 'keybindings.json', '{"bindings":{}}')
    seedOld('opentui', 'provider-keys.json', '{"keys":{}}')

    const inputs = readMigrationInputs({ dshHome, profileDir, templatePatchText: 'unused' })
    expect(inputs.markerExists).toBe(false)
    expect(inputs.inprocPatchText).toBe('- id: subagent\n')
    expect(inputs.opentuiPatchText).toBe('- id: permission\n')
    expect(inputs.opentuiConfigText).toBe('{"theme":"carbonfox"}')
    expect(inputs.opentuiKeybindingsText).toBe('{"bindings":{}}')
    expect(inputs.opentuiProviderKeysText).toBe('{"keys":{}}')
    expect(existsSync(profileDir)).toBe(false)
  })

  test('marker 存在（即便损坏）→ markerExists=true，且读操作不写任何东西', () => {
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, '.migration.json'), '{bad json')
    const inputs = readMigrationInputs({ dshHome, profileDir, templatePatchText: '' })
    expect(inputs.markerExists).toBe(true)
    expect(inputs.marker).toBeUndefined()
  })
})

describe('applyMigrationPlan — active files', () => {
  test('干净 home：apply no-op，不创建 profile', () => {
    const result = applyMigrationPlan({ profileDir, plan: basePlan(), version: 1, now: NOW })
    expect(result).toEqual({
      wroteConfig: false,
      wroteKeybindings: false,
      backupsWritten: [],
      markerWritten: false,
      notices: ['迁移完成：迁入 1 项，丢弃 0 项，备份 1 份。'],
    })
    expect(existsSync(profileDir)).toBe(false)
  })

  test('合法 config/keybindings：原子写入 0600，内容一致', () => {
    const config = '{"theme":"carbonfox","lang":"zh-CN"}'
    const keybindings = '{"bindings":{"ctrl-x":"do-thing"}}'
    const result = applyMigrationPlan({
      profileDir,
      plan: basePlan({
        config: { source: 'opentui', text: config },
        keybindings: { source: 'opentui', text: keybindings },
      }),
      version: 1,
      now: NOW,
    })
    expect(result.wroteConfig).toBe(true)
    expect(result.wroteKeybindings).toBe(true)
    const configPath = join(profileDir, 'config.json')
    const kbPath = join(profileDir, 'keybindings.json')
    expect(readFileSync(configPath, 'utf8')).toBe(config)
    expect(readFileSync(kbPath, 'utf8')).toBe(keybindings)
    expect(mode(configPath)).toBe(0o600)
    expect(mode(kbPath)).toBe(0o600)
  })

  test('相同内容第二次不重写 active 文件（mtime 不变）', () => {
    const config = '{"theme":"carbonfox"}'
    const plan = basePlan({ config: { source: 'opentui', text: config } })
    applyMigrationPlan({ profileDir, plan, version: 1, now: NOW })
    const configPath = join(profileDir, 'config.json')
    utimesSync(configPath, OLD_TIME, OLD_TIME)

    const second = applyMigrationPlan({ profileDir, plan, version: 1, now: NOW })
    expect(second.wroteConfig).toBe(false)
    expect(readFileSync(configPath, 'utf8')).toBe(config)
    expect(statSync(configPath).mtimeMs).toBe(OLD_TIME.getTime())
  })

  test('invalid config/keybindings：不写 active 文件，marker 仍可按 canWriteMarker 写', () => {
    const result = applyMigrationPlan({
      profileDir,
      plan: basePlan({
        config: { source: 'opentui', text: '{bad', invalid: true },
        keybindings: { source: 'opentui', text: '{oops', invalid: true },
        marker: SIMPLE_MARKER,
        canWriteMarker: true,
      }),
      version: 1,
      now: NOW,
    })
    expect(result.wroteConfig).toBe(false)
    expect(result.wroteKeybindings).toBe(false)
    expect(existsSync(join(profileDir, 'config.json'))).toBe(false)
    expect(existsSync(join(profileDir, 'keybindings.json'))).toBe(false)
    expect(result.markerWritten).toBe(true)
    expect(result.notices[0]).toContain('迁移完成')
  })

  test('canWriteMarker:false：不写 marker，其它有效载荷照常写', () => {
    const result = applyMigrationPlan({
      profileDir,
      plan: basePlan({
        config: { source: 'opentui', text: '{"theme":"x"}' },
        marker: SIMPLE_MARKER,
        canWriteMarker: false,
      }),
      version: 1,
      now: NOW,
    })
    expect(result.wroteConfig).toBe(true)
    expect(result.markerWritten).toBe(false)
    expect(existsSync(join(profileDir, '.migration.json'))).toBe(false)
  })

  test('plan.marker 不存在：即便 canWriteMarker=true 也不写 marker', () => {
    const result = applyMigrationPlan({
      profileDir,
      plan: basePlan({ marker: undefined, canWriteMarker: true }),
      version: 1,
      now: NOW,
    })
    expect(result.markerWritten).toBe(false)
    expect(existsSync(join(profileDir, '.migration.json'))).toBe(false)
  })
})

describe('applyMigrationPlan — backups', () => {
  const BACKUPS = [
    { source: 'opentui-inproc', kind: 'cordis.patch.yml', text: '- id: subagent\n' },
    { source: 'opentui', kind: 'cordis.patch.yml', text: '- id: permission\n' },
    { source: 'opentui', kind: 'provider-keys.json', text: '{"keys":{}}' },
  ]

  test('备份命名/权限：provider-keys 0600，其余 0644', () => {
    const result = applyMigrationPlan({
      profileDir,
      plan: basePlan({ backups: BACKUPS }),
      version: 1,
      now: NOW,
    })
    expect(result.backupsWritten).toEqual([
      '.migrated-from/opentui-inproc-cordis.patch.yml',
      '.migrated-from/opentui-cordis.patch.yml',
      '.migrated-from/opentui-provider-keys.json',
    ])
    const dir = join(profileDir, '.migrated-from')
    for (const [index, entry] of BACKUPS.entries()) {
      const path = join(dir, `${entry.source}-${entry.kind}`)
      expect(readFileSync(path, 'utf8')).toBe(entry.text)
      expect(mode(path)).toBe(index === 2 ? 0o600 : 0o644)
    }
  })

  test('相同内容第二次不重写备份（mtime 不变、backupsWritten 为空）', () => {
    const plan = basePlan({ backups: BACKUPS })
    applyMigrationPlan({ profileDir, plan, version: 1, now: NOW })
    const dir = join(profileDir, '.migrated-from')
    const paths = BACKUPS.map((b) => join(dir, `${b.source}-${b.kind}`))
    for (const path of paths) utimesSync(path, OLD_TIME, OLD_TIME)

    const second = applyMigrationPlan({ profileDir, plan, version: 1, now: NOW })
    expect(second.backupsWritten).toEqual([])
    for (const [index, path] of paths.entries()) {
      expect(readFileSync(path, 'utf8')).toBe(BACKUPS[index].text)
      expect(statSync(path).mtimeMs).toBe(OLD_TIME.getTime())
    }
  })

  test('内容不同：覆盖前留一份 .bak，且 .bak 最多一份', () => {
    const entry = { source: 'opentui', kind: 'cordis.patch.yml', text: '- id: new\n' }
    const dir = join(profileDir, '.migrated-from')
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, 'opentui-cordis.patch.yml')
    writeFileSync(dest, '- id: old\n')
    const bak = `${dest}.bak`

    applyMigrationPlan({ profileDir, plan: basePlan({ backups: [entry] }), version: 1, now: NOW })
    expect(readFileSync(bak, 'utf8')).toBe('- id: old\n')
    expect(readFileSync(dest, 'utf8')).toBe(entry.text)

    // 再次变更：.bak 被覆盖成上一份内容，不会累积第二份
    applyMigrationPlan({
      profileDir,
      plan: basePlan({ backups: [{ ...entry, text: '- id: newest\n' }] }),
      version: 1,
      now: NOW,
    })
    expect(readFileSync(bak, 'utf8')).toBe('- id: new\n')
    expect(readFileSync(dest, 'utf8')).toBe('- id: newest\n')
    expect(readdirSync(dir).length).toBe(2)
  })
})

describe('applyMigrationPlan — marker', () => {
  test('marker 字段完整、digest 稳定（不同 at 同 digest）、0600', () => {
    const marker = {
      from: ['opentui-inproc', 'opentui'],
      migrated: ['subagent.maxActiveSubagents'],
      dropped: [{ id: 'opentui', path: 'permission.defaultPreset', reason: 'template-authority' }],
    }
    const plan = basePlan({
      marker,
      backups: [{ source: 'opentui', kind: 'cordis.patch.yml', text: '- id: subagent\n' }],
      canWriteMarker: true,
    })
    const dirA = join(root, 'a')
    const dirB = join(root, 'b')
    applyMigrationPlan({ profileDir: dirA, plan, version: '1.2.3', now: new Date('2026-01-01T00:00:00.000Z') })
    applyMigrationPlan({ profileDir: dirB, plan, version: '1.2.3', now: new Date('2027-01-01T00:00:00.000Z') })

    const markerA = join(dirA, '.migration.json')
    const parsedA = JSON.parse(readFileSync(markerA, 'utf8'))
    const parsedB = JSON.parse(readFileSync(join(dirB, '.migration.json'), 'utf8'))
    expect(Object.keys(parsedA).sort()).toEqual(['at', 'digest', 'dropped', 'from', 'migrated', 'version'])
    expect(parsedA.from).toEqual(marker.from)
    expect(parsedA.migrated).toEqual(marker.migrated)
    expect(parsedA.dropped).toEqual(marker.dropped)
    expect(parsedA.version).toBe('1.2.3')
    expect(parsedA.at).toBe('2026-01-01T00:00:00.000Z')
    expect(parsedB.at).toBe('2027-01-01T00:00:00.000Z')
    expect(parsedA.digest).toBe(parsedB.digest)
    expect(parsedA.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(mode(markerA)).toBe(0o600)
  })

  test('marker 已存在：第二次 apply 直接 no-op，不覆盖 marker、不重放 notices', () => {
    const config = '{"theme":"first"}'
    const plan = basePlan({
      config: { source: 'opentui', text: config },
      marker: SIMPLE_MARKER,
      canWriteMarker: true,
      notices: ['first-notice'],
    })
    const first = applyMigrationPlan({ profileDir, plan, version: 1, now: NOW })
    expect(first.markerWritten).toBe(true)

    const markerPath = join(profileDir, '.migration.json')
    const raw = readFileSync(markerPath, 'utf8')
    utimesSync(markerPath, OLD_TIME, OLD_TIME)

    const changed = basePlan({
      config: { source: 'opentui', text: '{"theme":"second"}' },
      marker: { from: ['other'], migrated: ['x'], dropped: [] },
      canWriteMarker: true,
      notices: ['second-notice'],
    })
    const second = applyMigrationPlan({
      profileDir,
      plan: changed,
      version: 99,
      now: new Date('2030-01-01T00:00:00.000Z'),
    })
    expect(second).toEqual({
      wroteConfig: false,
      wroteKeybindings: false,
      backupsWritten: [],
      markerWritten: false,
      notices: [],
    })
    expect(readFileSync(markerPath, 'utf8')).toBe(raw)
    expect(statSync(markerPath).mtimeMs).toBe(OLD_TIME.getTime())
    expect(readFileSync(join(profileDir, 'config.json'), 'utf8')).toBe(config)
  })
})

describe('applyMigrationPlan — failure / re-entry', () => {
  test('备份中途失败：不写 marker；恢复后可重入且已写文件按内容跳过', () => {
    const config = '{"theme":"x"}'
    const backup = { source: 'opentui', kind: 'cordis.patch.yml', text: '- id: subagent\n' }
    const plan = basePlan({
      config: { source: 'opentui', text: config },
      backups: [backup],
      marker: SIMPLE_MARKER,
      canWriteMarker: true,
    })

    // Block the backup directory with a regular file: mkdirSync(recursive)
    // throws EEXIST after config was already written but before the marker.
    const backupDir = join(profileDir, '.migrated-from')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(backupDir, 'blocker')
    expect(() => applyMigrationPlan({ profileDir, plan, version: 1, now: NOW })).toThrow()
    expect(existsSync(join(profileDir, '.migration.json'))).toBe(false)
    expect(readFileSync(join(profileDir, 'config.json'), 'utf8')).toBe(config)

    rmSync(backupDir, { force: true })
    const retry = applyMigrationPlan({ profileDir, plan, version: 1, now: NOW })
    expect(retry.wroteConfig).toBe(false)
    expect(retry.backupsWritten).toEqual(['.migrated-from/opentui-cordis.patch.yml'])
    expect(retry.markerWritten).toBe(true)
    expect(readFileSync(join(backupDir, 'opentui-cordis.patch.yml'), 'utf8')).toBe(backup.text)
  })
})

describe('旧 profile 只读', () => {
  test('read inputs + apply 后旧文件内容和 mtime 均不变', () => {
    const paths = [
      seedOld('opentui', 'cordis.patch.yml', '- id: permission\n'),
      seedOld('opentui-inproc', 'cordis.patch.yml', '- id: subagent\n'),
      seedOld('opentui', 'config.json', '{"theme":"carbonfox"}'),
      seedOld('opentui', 'keybindings.json', '{}'),
      seedOld('opentui', 'provider-keys.json', '{"keys":{}}'),
    ]
    const before = paths.map((path) => ({
      text: readFileSync(path, 'utf8'),
      mtime: statSync(path).mtimeMs,
    }))

    const inputs = readMigrationInputs({ dshHome, profileDir, templatePatchText: '' })
    applyMigrationPlan({
      profileDir,
      plan: basePlan({
        config: inputs.opentuiConfigText ? { source: 'opentui', text: inputs.opentuiConfigText } : undefined,
        backups: [
          { source: 'opentui-inproc', kind: 'cordis.patch.yml', text: inputs.inprocPatchText ?? '' },
          { source: 'opentui', kind: 'cordis.patch.yml', text: inputs.opentuiPatchText ?? '' },
          { source: 'opentui', kind: 'provider-keys.json', text: inputs.opentuiProviderKeysText ?? '' },
        ],
        marker: SIMPLE_MARKER,
        canWriteMarker: true,
      }),
      version: 1,
      now: NOW,
    })

    paths.forEach((path, index) => {
      expect(readFileSync(path, 'utf8')).toBe(before[index].text)
      expect(statSync(path).mtimeMs).toBe(before[index].mtime)
    })
  })
})

describe('readMigrationInputs — marker early return', () => {
  test('marker 存在 + 旧文件变目录/坏 JSON：一个旧文件都不读，全部文本字段 undefined', () => {
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, '.migration.json'), JSON.stringify({ from: ['opentui'] }))
    // Any read of these paths would throw EISDIR; provider-keys is bad JSON that
    // the planner would reject if it ever saw it. None of it may be touched.
    for (const [name, file] of [
      ['opentui-inproc', 'cordis.patch.yml'],
      ['opentui', 'cordis.patch.yml'],
      ['opentui', 'config.json'],
      ['opentui', 'keybindings.json'],
    ]) {
      mkdirSync(oldPath(name, file), { recursive: true })
    }
    writeFileSync(oldPath('opentui', 'provider-keys.json'), '{bad json')

    const inputs = readMigrationInputs({ dshHome, profileDir, templatePatchText: '' })
    expect(inputs).toEqual({
      markerExists: true,
      marker: { from: ['opentui'] },
      inprocPatchText: undefined,
      opentuiPatchText: undefined,
      opentuiConfigText: undefined,
      opentuiKeybindingsText: undefined,
      opentuiProviderKeysText: undefined,
    })
  })

  test('marker 损坏 + 旧文件不可读：仍安全早退，不抛、不创建目录', () => {
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, '.migration.json'), '{bad json')
    mkdirSync(oldPath('opentui-inproc', 'cordis.patch.yml'), { recursive: true })

    const inputs = readMigrationInputs({ dshHome, profileDir, templatePatchText: '' })
    expect(inputs.markerExists).toBe(true)
    expect(inputs.marker).toBeUndefined()
    expect(inputs.inprocPatchText).toBeUndefined()
    expect(inputs.opentuiPatchText).toBeUndefined()
    expect(existsSync(join(dshHome, 'profiles', 'opentui'))).toBe(false)
  })
})

describe('applyMigrationPlan — backupsOnly', () => {
  const OLD_PATCH = '- id: subagent\n  config:\n    maxActiveSubagents: 5\n'

  test('只写 backups：config/keybindings/marker 全不写，对应 flags 为 false', () => {
    const plan = basePlan({
      config: { source: 'opentui', text: '{"theme":"x"}' },
      keybindings: { source: 'opentui', text: '{"bindings":{}}' },
      backups: [{ source: 'opentui-inproc', kind: 'cordis.patch.yml', text: OLD_PATCH }],
      marker: SIMPLE_MARKER,
      canWriteMarker: true,
    })
    const result = applyMigrationPlan({ profileDir, plan, version: 1, now: NOW, backupsOnly: true })
    expect(result).toEqual({
      wroteConfig: false,
      wroteKeybindings: false,
      backupsWritten: ['.migrated-from/opentui-inproc-cordis.patch.yml'],
      markerWritten: false,
      notices: plan.notices,
    })
    expect(existsSync(join(profileDir, 'config.json'))).toBe(false)
    expect(existsSync(join(profileDir, 'keybindings.json'))).toBe(false)
    expect(existsSync(join(profileDir, '.migration.json'))).toBe(false)
    expect(readFileSync(join(profileDir, '.migrated-from', 'opentui-inproc-cordis.patch.yml'), 'utf8')).toBe(OLD_PATCH)
  })

  test('pre-backup 后完整 apply：备份内容相同即跳过，config/marker 依次落盘', () => {
    const config = '{"theme":"x"}'
    const plan = basePlan({
      config: { source: 'opentui', text: config },
      backups: [{ source: 'opentui-inproc', kind: 'cordis.patch.yml', text: OLD_PATCH }],
      marker: SIMPLE_MARKER,
      canWriteMarker: true,
    })
    applyMigrationPlan({ profileDir, plan, version: 1, now: NOW, backupsOnly: true })
    const backupPath = join(profileDir, '.migrated-from', 'opentui-inproc-cordis.patch.yml')
    utimesSync(backupPath, OLD_TIME, OLD_TIME)

    const second = applyMigrationPlan({ profileDir, plan, version: 1, now: NOW })
    expect(second.wroteConfig).toBe(true)
    expect(second.backupsWritten).toEqual([])
    expect(second.markerWritten).toBe(true)
    expect(statSync(backupPath).mtimeMs).toBe(OLD_TIME.getTime())
    expect(readFileSync(backupPath, 'utf8')).toBe(OLD_PATCH)
    expect(existsSync(join(profileDir, '.migration.json'))).toBe(true)
  })

  test('marker 在 config 之后：config 写入失败时不留 marker', () => {
    mkdirSync(profileDir, { recursive: true })
    mkdirSync(join(profileDir, 'config.json')) // rename onto a dir throws
    const plan = basePlan({
      config: { source: 'opentui', text: '{"theme":"x"}' },
      marker: SIMPLE_MARKER,
      canWriteMarker: true,
    })
    expect(() => applyMigrationPlan({ profileDir, plan, version: 1, now: NOW })).toThrow()
    expect(existsSync(join(profileDir, '.migration.json'))).toBe(false)
  })

  test('crash re-entry：重复 pre-backup 不覆盖既有备份、不留 .bak、不改 mtime', () => {
    const firstPlan = basePlan({
      backups: [{ source: 'opentui-inproc', kind: 'cordis.patch.yml', text: OLD_PATCH }],
      notices: [],
    })
    const first = applyMigrationPlan({ profileDir, plan: firstPlan, version: 1, now: NOW, backupsOnly: true })
    expect(first.backupsWritten).toHaveLength(1)
    const dest = join(profileDir, '.migrated-from', 'opentui-inproc-cordis.patch.yml')
    utimesSync(dest, OLD_TIME, OLD_TIME)

    // Same plan re-entered after a crash before converge: content is identical,
    // so the backup is skipped instead of being rotated/rewritten.
    const retry = applyMigrationPlan({ profileDir, plan: firstPlan, version: 1, now: NOW, backupsOnly: true })
    expect(retry.backupsWritten).toEqual([])
    expect(statSync(dest).mtimeMs).toBe(OLD_TIME.getTime())
    expect(readdirSync(join(profileDir, '.migrated-from'))).toEqual(['opentui-inproc-cordis.patch.yml'])
  })
})

describe('applyMigrationPlan — notice 与写盘一致', () => {
  test('invalid config/keybindings 不谎称已备份；patch/provider-keys 的真实备份措辞保留', () => {
    const plan = basePlan({
      config: { source: 'opentui', text: '{bad', invalid: true },
      keybindings: { source: 'opentui', text: '{bad', invalid: true },
      backups: [
        { source: 'opentui', kind: 'cordis.patch.yml', text: '- id: x\n' },
        { source: 'opentui', kind: 'provider-keys.json', text: '{"keys":{}}' },
      ],
      notices: [
        'config.json 解析失败：已备份、未写入新 profile，需人工修复；原文原样保留。',
        'keybindings.json 解析失败：已备份、未写入新 profile，需人工修复；原文原样保留。',
        'opentui 的旧 patch 解析失败，已备份但未迁移/未写入新 profile，请修复后等待下次启动重试。',
        '旧 provider-keys.json 已备份；新版请重新 /login，宿主凭据在 ~/.dsh/.credentials.yaml。',
      ],
      canWriteMarker: false,
    })
    const result = applyMigrationPlan({ profileDir, plan, version: 1, now: NOW })
    expect(result.notices[0]).toBe('config.json 解析失败：未写入新 profile，需人工修复；原文原样保留。')
    expect(result.notices[1]).toBe('keybindings.json 解析失败：未写入新 profile，需人工修复；原文原样保留。')
    expect(result.notices[2]).toContain('已备份')
    expect(result.notices[3]).toContain('已备份')
    // No config/keybindings backup file exists — that is exactly why the
    // claim had to be removed.
    expect(readdirSync(join(profileDir, '.migrated-from')).sort()).toEqual([
      'opentui-cordis.patch.yml',
      'opentui-provider-keys.json',
    ])
  })

  test('若确实存在 config 备份文件，则保留已备份措辞', () => {
    mkdirSync(join(profileDir, '.migrated-from'), { recursive: true })
    writeFileSync(join(profileDir, '.migrated-from', 'opentui-config.json'), '{"theme":"x"}')
    const notice = 'config.json 解析失败：已备份、未写入新 profile，需人工修复；原文原样保留。'
    const plan = basePlan({
      config: { source: 'opentui', text: '{bad', invalid: true },
      notices: [notice],
      canWriteMarker: false,
    })
    const result = applyMigrationPlan({ profileDir, plan, version: 1, now: NOW })
    expect(result.notices).toEqual([notice])
  })
})
