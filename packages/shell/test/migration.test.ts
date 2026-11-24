/**
 * T8 (2nd cut) — pure migration planner (06 §4.5, §7.1–7.5; D6; D8-Q2).
 * No fs / clock / env: every case drives planMigration with inline text.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { planMigration } from '../scripts/lib/migration.mjs'
import { converge, templateProjection } from '../scripts/lib/patch-ownership.mjs'

const OLD_MODEL_IDS = ['glm-5.4', 'mimo-v2.6-pro-ultraspeed', 'hy4-flash-free', 'qwen4-max']

/** Current new template: carries the model table used for ADM group validation. */
const TEMPLATE = `# dsh-opentui inproc profile patch — GENERATED
# profileRevision: aaaaaaaaaaaaaaaa
# model route (managed):

- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      opencode-go:
        apiKeyEnv: OPENCODE_GO_API_KEY
        models:
          - id: deepseek-v4.1-flash
            name: DeepSeek V4.1 Flash
            reasoningEfforts:
              low: low
              high: high
              max: max
          - id: deepseek-v4-pro
            name: DeepSeek V4 Pro
            compat:
              thinkingFormat: deepseek
      zai-coding-cn:
        apiKeyEnv: ZAI_CODING_CN_API_KEY
        models:
          - id: glm-4.5
            name: glm-4.5
- id: subagent
  name: "@deepseek-ai/dsh-subagent"
  config:
    maxActiveSubagents: 3
    maxDepth: 1
- id: session-log-deepseek
  name: "@deepseek-ai/dsh-session-log-deepseek"
  config:
    enabled: true
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: opencode-go
    model: deepseek-v4.1-flash
    reasoningEffort: high
- insert:
    - id: tool-ask-user
      name: '@aiwayds/dsh-tool-ask-user'
`

function patch(...blocks: string[]): string {
  return blocks.join('\n') + '\n'
}

const subagent = (body: string) => `- id: subagent\n  name: "@deepseek-ai/dsh-subagent"\n  config:\n${body}`
const session = (enabled: string) => `- id: session-log-deepseek\n  config:\n    enabled: ${enabled}`
const adm = (provider: string, model: string, reasoningEffort?: string) =>
  `- id: agent-default-model\n  config:\n    provider: ${provider}\n    model: ${model}` +
  (reasoningEffort !== undefined ? `\n    reasoningEffort: ${reasoningEffort}` : '')

function plan(overrides: Record<string, unknown> = {}) {
  return planMigration({ templatePatchText: TEMPLATE, markerExists: false, ...overrides })
}

// ---------------------------------------------------------------------------
// 1. marker 存在：完全跳过，坏 YAML 也不读
// ---------------------------------------------------------------------------
test('marker 存在时完全跳过：坏 YAML 不解析、无任何载荷、只返回跳过 notice', () => {
  const result = planMigration({
    markerExists: true,
    // Deliberately corrupt text plus valid-looking migratable values: if the
    // planner read either, it would throw or emit an ext / backup.
    inprocPatchText: '\t- id: ]]]: : : {{{  not valid  [[[',
    opentuiPatchText: subagent('    maxActiveSubagents: 9'),
    templatePatchText: TEMPLATE,
    opentuiConfigText: '{"theme":"x"}',
    opentuiKeybindingsText: '{}',
    opentuiProviderKeysText: '{"k":1}',
  })
  expect(result.externalCarry).toBeUndefined()
  expect(result.config).toBeUndefined()
  expect(result.keybindings).toBeUndefined()
  expect(result.backups).toEqual([])
  expect(result.marker).toBeUndefined()
  expect(result.notices.join('\n')).toContain('跳过迁移')
})

// ---------------------------------------------------------------------------
// 2. 两源逐叶优先级
// ---------------------------------------------------------------------------
test('逐叶优先级：inproc 有值用 inproc，inproc 缺字段才回退 opentui', () => {
  const result = plan({
    inprocPatchText: patch(subagent('    maxActiveSubagents: 5')),
    opentuiPatchText: patch(
      subagent('    maxActiveSubagents: 7'),
      session('false'), // inproc 没有 session 行 → 回退 opentui
    ),
  })
  const values = result.externalCarry!.values
  expect(values['subagent.maxActiveSubagents']).toBe(5)
  expect(values['session-log-deepseek.enabled']).toBe(false)
})

test('逐叶优先级：inproc 值等于模板也不回退老源（不复活更老的意图）', () => {
  const result = plan({
    inprocPatchText: patch(subagent('    maxActiveSubagents: 3')), // == 模板
    opentuiPatchText: patch(subagent('    maxActiveSubagents: 7')),
  })
  const values = result.externalCarry!.values
  expect(values['subagent.maxActiveSubagents']).toBeUndefined()
  expect(result.externalCarry!.source).toBe('opentui-inproc')
})

// ---------------------------------------------------------------------------
// 3. maxDepth：源 A 不迁，源 B 迁合法值
// ---------------------------------------------------------------------------
test('源 A（opentui）不迁 maxDepth，即便它带了该字段', () => {
  const result = plan({
    opentuiPatchText: patch(subagent('    maxActiveSubagents: 3\n    maxDepth: 4')),
  })
  expect(result.externalCarry!.values['subagent.maxDepth']).toBeUndefined()
})

test('源 B（opentui-inproc）迁合法的 maxDepth', () => {
  const result = plan({
    inprocPatchText: patch(subagent('    maxActiveSubagents: 3\n    maxDepth: 3')),
  })
  expect(result.externalCarry!.values['subagent.maxDepth']).toBe(3)
})

// ---------------------------------------------------------------------------
// 4. 非法值拒绝
// ---------------------------------------------------------------------------
test('maxActiveSubagents 的 0 / 负数 / 非整数 / !!js 全部进 dropped invalid-value', () => {
  const bad = ['0', '-1', '1.5', "!!js 1 + 1"]
  for (const raw of bad) {
    const result = plan({ inprocPatchText: patch(subagent(`    maxActiveSubagents: ${raw}`)) })
    expect(result.externalCarry!.values['subagent.maxActiveSubagents']).toBeUndefined()
    expect(result.externalCarry!.dropped).toContainEqual({
      path: 'subagent.maxActiveSubagents', reason: 'invalid-value',
    })
  }
})

test('session-log-deepseek.enabled 的 !!js / 非 boolean 进 dropped invalid-value', () => {
  for (const raw of ['!!js true', 'yes', '1']) {
    const result = plan({ inprocPatchText: patch(session(raw)) })
    expect(result.externalCarry!.values['session-log-deepseek.enabled']).toBeUndefined()
    expect(result.externalCarry!.dropped).toContainEqual({
      path: 'session-log-deepseek.enabled', reason: 'invalid-value',
    })
  }
})

// ---------------------------------------------------------------------------
// 5. 禁止项全部进 dropped
// ---------------------------------------------------------------------------
test('permission / providers / insert / append / dead-row 禁止项全部进 dropped', () => {
  const oldPatch = patch(
    `- id: permission
  config:
    presets:
      full: {}
    defaultPreset: danger-full-access`,
    `- id: llm-pi-ai
  config:
    providers:
      hand-added-id:
        api: openai-completions
        baseURL: https://example.invalid
        models:
          - id: glm-5.4
          - id: mimo-v2.6-pro-ultraspeed
          - id: hy4-flash-free
          - id: qwen4-max`,
    `- insert:
    - id: tool-ask-user
      name: '@aiwayds/dsh-tool-ask-user'`,
    `- insert:
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-context7'`,
    `- insert:
    - id: preset-opentui-append-system
      name: '@deepseek-ai/dsh-agent-presets'
    - id: persona
      name: '@deepseek-ai/dsh-agent-presets'
    - id: plugin-manager
      name: '@deepseek-ai/dsh-agent-presets'`,
    `- id: web
  config: {}
- id: ui-settings-general
  config: {}`,
  )
  const result = plan({ opentuiPatchText: oldPatch })
  const dropped = result.externalCarry!.dropped
  const pair = (path: string, reason: string) => ({ path, reason })
  expect(dropped).toContainEqual(pair('permission.defaultPreset', 'template-authority'))
  expect(dropped).toContainEqual(pair('permission.presets', 'sandbox-loosening-forbidden'))
  expect(dropped).toContainEqual(pair('llm-pi-ai.providers', 'model-table-template-owned'))
  expect(dropped).toContainEqual(pair('providers.hand-added-id', 'credentials-channel-pending'))
  expect(dropped).toContainEqual(pair('insert.tool-ask-user', 'duplicate-insert'))
  expect(dropped).toContainEqual(pair('insert.mcp-context7', 'duplicate-insert'))
  expect(dropped).toContainEqual(pair('insert.preset-opentui-append-system', 'append-preset-unused'))
  expect(dropped).toContainEqual(pair('web', 'dead-row-no-bundle'))
  expect(dropped).toContainEqual(pair('ui-settings-general', 'dead-row-no-bundle'))
  // 禁止项绝不进入 values
  expect(Object.keys(result.externalCarry!.values).some((k) => k.startsWith('permission') || k.startsWith('llm-pi-ai') || k.startsWith('providers'))).toBe(false)
  // marker.dropped 带 id（给 .migration.json 用）
  expect(result.marker!.dropped.every((d: any) => typeof d.id === 'string' && d.path && d.reason)).toBe(true)
  // ext.dropped 是 converge 期望的 {path, reason}，不含 id
  expect(dropped.every((d: any) => Object.keys(d).sort().join(',') === 'path,reason')).toBe(true)
})

// ---------------------------------------------------------------------------
// 6. agent-default-model 整组
// ---------------------------------------------------------------------------
test('agent-default-model 合法且与模板不同：整组迁（provider/model/reasoningEffort）', () => {
  const result = plan({
    inprocPatchText: patch(adm('opencode-go', 'deepseek-v4-pro', 'max')),
  })
  const values = result.externalCarry!.values
  expect(values['agent-default-model.provider']).toBe('opencode-go')
  expect(values['agent-default-model.model']).toBe('deepseek-v4-pro')
  expect(values['agent-default-model.reasoningEffort']).toBe('max')
})

test('agent-default-model 缺 model：整组丢弃，不产生半个 ext', () => {
  const result = plan({
    inprocPatchText: patch(`- id: agent-default-model
  config:
    provider: opencode-go
    reasoningEffort: high`),
  })
  expect(Object.keys(result.externalCarry!.values).some((k: string) => k.startsWith('agent-default-model'))).toBe(false)
  expect(result.externalCarry!.dropped).toContainEqual({ path: 'agent-default-model', reason: 'invalid-value' })
})

test('agent-default-model 模型不在当前模板：整组丢弃 model-id-not-in-template', () => {
  const result = plan({
    inprocPatchText: patch(adm('opencode-go', 'not-in-template', 'high')),
  })
  expect(Object.keys(result.externalCarry!.values).some((k: string) => k.startsWith('agent-default-model'))).toBe(false)
  expect(result.externalCarry!.dropped).toContainEqual({ path: 'agent-default-model', reason: 'model-id-not-in-template' })
})

test('agent-default-model 与模板逐字相同：no-op，不产生 ext', () => {
  const result = plan({ inprocPatchText: patch(adm('opencode-go', 'deepseek-v4.1-flash', 'high')) })
  expect(Object.keys(result.externalCarry!.values).some((k: string) => k.startsWith('agent-default-model'))).toBe(false)
})

// ---------------------------------------------------------------------------
// 7. config / keybindings 只来自 opentui
// ---------------------------------------------------------------------------
test('config 只来自 opentui，未知键保留并 notice；keybindings 整份带回', () => {
  const configText = '{"theme":"carbonfox","lang":"zh-CN","mystery":{"keep":true}}'
  const kbText = '{"bindings":{"ctrl-x":"do-thing"}}'
  const result = plan({
    inprocPatchText: patch(subagent('    maxActiveSubagents: 5')),
    opentuiConfigText: configText,
    opentuiKeybindingsText: kbText,
  })
  expect(result.config).toEqual({ source: 'opentui', text: configText })
  expect(result.keybindings).toEqual({ source: 'opentui', text: kbText })
  const notices = result.notices.join('\n')
  expect(notices).toContain('mystery')
  expect(notices).toContain('未知键未丢弃')
  expect(notices).toContain('keybindings.json 已整份带回')
})

test('inproc 侧没有 config/keybindings 字段：即使 inproc patch 存在也不产出', () => {
  const result = plan({ inprocPatchText: patch(subagent('    maxActiveSubagents: 5')) })
  expect(result.config).toBeUndefined()
  expect(result.keybindings).toBeUndefined()
})

// ---------------------------------------------------------------------------
// 8. provider-keys 只备份不激活
// ---------------------------------------------------------------------------
test('provider-keys.json 只进备份清单并 notice，不作为激活凭据', () => {
  const pk = '{"keys":{"opencode-go":"sk-should-not-activate"}}'
  const result = plan({
    inprocPatchText: patch(subagent('    maxActiveSubagents: 5')),
    opentuiProviderKeysText: pk,
  })
  expect(result.backups).toContainEqual({ source: 'opentui', kind: 'provider-keys.json', text: pk })
  // 即便有旧 patch 产生了 ext，values 里也不得出现任何凭据/key 字段
  const values = result.externalCarry!.values
  expect(Object.keys(values)).toEqual(['subagent.maxActiveSubagents'])
  expect(Object.keys(values).some((k) => k.toLowerCase().includes('key'))).toBe(false)
  const notices = result.notices.join('\n')
  expect(notices).toContain('/login')
  expect(notices).toContain('~/.dsh/.credentials.yaml')
})

// ---------------------------------------------------------------------------
// 9. 两个旧 patch 都不存在：不伪造 ext
// ---------------------------------------------------------------------------
test('两个旧 patch 都不存在：externalCarry=undefined，不伪造迁移', () => {
  const result = plan({})
  expect(result.externalCarry).toBeUndefined()
  expect(result.marker).toBeUndefined()
  expect(result.backups).toEqual([])
})

test('无 patch 但 config 存在：config 仍按源 A 拷贝，ext 仍为 undefined', () => {
  const result = plan({ opentuiConfigText: '{"theme":"carbonfox"}' })
  expect(result.externalCarry).toBeUndefined()
  expect(result.config).toEqual({ source: 'opentui', text: '{"theme":"carbonfox"}' })
  expect(result.marker!.from).toContain('opentui')
})

// ---------------------------------------------------------------------------
// 10. notice 内容（迁入/丢弃/备份/审批/4 模型 id）
// ---------------------------------------------------------------------------
test('notice 汇总迁入数、丢弃数、备份数、审批档位、4 个模型 id', () => {
  const result = plan({
    inprocPatchText: patch(
      subagent('    maxActiveSubagents: 5'),
      session('false'),
      '- id: permission\n  config:\n    defaultPreset: danger-full-access',
    ),
    opentuiPatchText: patch(subagent('    maxActiveSubagents: 3')),
    opentuiProviderKeysText: '{"k":1}',
  })
  const notices = result.notices.join('\n')
  expect(notices).toMatch(/迁入 \d+ 项，丢弃 \d+ 项，备份 \d+ 份/)
  expect(notices).toContain('workspace-write')
  for (const id of OLD_MODEL_IDS) expect(notices).toContain(id)
  // 备份清单：两个 patch + provider-keys
  expect(result.backups).toHaveLength(3)
  expect(result.backups.map((b: any) => `${b.source}/${b.kind}`)).toEqual([
    'opentui-inproc/cordis.patch.yml',
    'opentui/cordis.patch.yml',
    'opentui/provider-keys.json',
  ])
})

// ---------------------------------------------------------------------------
// 11. marker 形状：不含 at/version/digest（由 T8b 补）
// ---------------------------------------------------------------------------
test('marker 只含 from/migrated/dropped，不含 at/version/digest', () => {
  const result = plan({
    inprocPatchText: patch(subagent('    maxActiveSubagents: 5')),
    opentuiPatchText: patch(subagent('    maxActiveSubagents: 3')),
  })
  expect(Object.keys(result.marker!).sort()).toEqual(['dropped', 'from', 'migrated'])
  expect(result.marker!.from).toEqual(['opentui-inproc', 'opentui'])
  expect(result.marker!.migrated).toContain('subagent.maxActiveSubagents')
})

// ---------------------------------------------------------------------------
// 12. P1-1: 坏旧 patch 不能吞成空索引，也不能写 marker
// ---------------------------------------------------------------------------
const BAD_YAML = '\t- id: ]]]: : : {{{  not valid  [[['

test('P1-1: 坏 inproc patch → dropped + notice + canWriteMarker=false，无迁移成功文案', () => {
  const result = plan({ inprocPatchText: BAD_YAML, opentuiConfigText: '{"theme":"x"}' })
  expect(result.canWriteMarker).toBe(false)
  expect(result.externalCarry!.dropped).toContainEqual({
    path: 'opentui-inproc-cordis.patch.yml', reason: 'invalid-value',
  })
  expect(result.marker!.dropped).toContainEqual({
    id: 'opentui-inproc', path: 'opentui-inproc-cordis.patch.yml', reason: 'invalid-value',
  })
  expect(result.backups).toContainEqual({
    source: 'opentui-inproc', kind: 'cordis.patch.yml', text: BAD_YAML,
  })
  const notices = result.notices.join('\n')
  expect(notices).toContain('dropped opentui-inproc-cordis.patch.yml reason=invalid-value')
  expect(notices).toContain('解析失败')
  expect(notices).not.toContain('迁移完成')
})

test('P1-1: 坏 opentui patch → dropped + notice + canWriteMarker=false', () => {
  const result = plan({
    opentuiPatchText: '- id: [unclosed\n  config: {',
    inprocPatchText: patch(subagent('    maxActiveSubagents: 5')),
  })
  expect(result.canWriteMarker).toBe(false)
  expect(result.externalCarry!.dropped).toContainEqual({
    path: 'opentui-cordis.patch.yml', reason: 'invalid-value',
  })
  const notices = result.notices.join('\n')
  expect(notices).toContain('dropped opentui-cordis.patch.yml reason=invalid-value')
  expect(notices).not.toContain('迁移完成')
})

test('P1-1: 正常/干净输入 canWriteMarker=true', () => {
  expect(plan({}).canWriteMarker).toBe(true)
  expect(plan({ inprocPatchText: patch(subagent('    maxActiveSubagents: 5')) }).canWriteMarker).toBe(true)
})

// ---------------------------------------------------------------------------
// 13. P1-2: 4 个旧 model id 不得伪造进审计数组
// ---------------------------------------------------------------------------
test('P1-2: 旧 patch 只有 subagent → 4 个 model id 不出现在 dropped', () => {
  const result = plan({ inprocPatchText: patch(subagent('    maxActiveSubagents: 5')) })
  const modelDrops = result.externalCarry!.dropped.filter((d) => d.path.startsWith('model.'))
  expect(modelDrops).toEqual([])
  // 发布说明（选择器少 4 项）仍可出现，但不是审计项
  expect(result.notices.join('\n')).toContain('选择器少 4 项')
})

test('P1-2: 源表实际含旧 id 时才记 dropped，未出现的 id 不补', () => {
  const oldTable = `- id: llm-pi-ai
  config:
    providers:
      hand-added:
        models:
          - id: glm-5.4
`
  const result = plan({ opentuiPatchText: patch(oldTable, subagent('    maxActiveSubagents: 5')) })
  expect(result.externalCarry!.dropped).toContainEqual({
    path: 'model.glm-5.4', reason: 'model-id-not-in-template',
  })
  for (const id of OLD_MODEL_IDS.filter((x) => x !== 'glm-5.4')) {
    expect(result.externalCarry!.dropped.some((d) => d.path === `model.${id}`)).toBe(false)
  }
})

// ---------------------------------------------------------------------------
// 14. P1-3: 坏模板 fail-fast（06 §4.6.1 构建期 bug）
// ---------------------------------------------------------------------------
test('P1-3: 模板语法错误或非 seq 直接抛错，不产出假 ext', () => {
  expect(() => plan({ templatePatchText: BAD_YAML, inprocPatchText: patch(subagent('    maxActiveSubagents: 5')) })).toThrow()
  expect(() => plan({ templatePatchText: 'foo: bar', inprocPatchText: patch(subagent('    maxActiveSubagents: 5')) })).toThrow()
})

// ---------------------------------------------------------------------------
// 15. P2-5: 干净 home 不打迁移汇总/审批档位
// ---------------------------------------------------------------------------
test('P2-5: 干净 home 不输出迁移完成/审批/模型清单 notice', () => {
  const notices = plan({}).notices.join('\n')
  expect(notices).not.toContain('迁移完成')
  expect(notices).not.toContain('workspace-write')
  expect(notices).not.toContain('选择器少 4 项')
  expect(notices).not.toContain('丢弃')
})

// ---------------------------------------------------------------------------
// 16. P2-6: 坏 JSON 原文透传但标记 invalid
// ---------------------------------------------------------------------------
test('P2-6: 坏 config.json → invalid=true，不写成合法载荷', () => {
  const bad = '{not json'
  const result = plan({ opentuiConfigText: bad })
  expect(result.config).toEqual({ source: 'opentui', text: bad, invalid: true })
  expect(result.notices.join('\n')).toContain('未写入新 profile')
  expect(result.notices.join('\n')).toContain('需人工修复')
})

test('P2-6: 坏 keybindings.json → invalid=true + notice', () => {
  const bad = '{oops'
  const result = plan({ opentuiKeybindingsText: bad })
  expect(result.keybindings).toEqual({ source: 'opentui', text: bad, invalid: true })
  expect(result.notices.join('\n')).toContain('keybindings.json 解析失败')
})

// ---------------------------------------------------------------------------
// 17. P2-7: 未知叶子不能静默忽略
// ---------------------------------------------------------------------------
test('P2-7: subagent.mysteryKnob 进 dropped invalid-value 并进 notice', () => {
  const result = plan({ inprocPatchText: patch(subagent('    maxActiveSubagents: 5\n    mysteryKnob: 7')) })
  expect(result.externalCarry!.dropped).toContainEqual({
    path: 'subagent.mysteryKnob', reason: 'invalid-value',
  })
  expect(result.notices.join('\n')).toContain('subagent.mysteryKnob')
})

// ---------------------------------------------------------------------------
// 18. P2-4: 源 B template-owned 行 + append 块内其余 insert
// ---------------------------------------------------------------------------
test('P2-4: 源 B tool 行用 row-replaced-by-leaf，append 块内全部 id 进 dropped', () => {
  const oldB = patch(
    subagent('    maxActiveSubagents: 5'),
    '- id: tool-bash\n  config:\n    enabled: false',
    `- insert:
    - id: preset-opentui-append-system
      name: '@deepseek-ai/dsh-agent-presets'
    - id: persona
      name: '@deepseek-ai/dsh-agent-presets'
    - id: plugin-manager
      name: '@deepseek-ai/dsh-agent-presets'`,
  )
  const dropped = plan({ inprocPatchText: oldB }).externalCarry!.dropped
  expect(dropped).toContainEqual({ path: 'tool-bash', reason: 'row-replaced-by-leaf' })
  expect(dropped).not.toContainEqual({ path: 'tool-bash', reason: 'dead-row-no-bundle' })
  expect(dropped).toContainEqual({ path: 'insert.preset-opentui-append-system', reason: 'append-preset-unused' })
  expect(dropped).toContainEqual({ path: 'insert.persona', reason: 'append-preset-unused' })
  expect(dropped).toContainEqual({ path: 'insert.plugin-manager', reason: 'append-preset-unused' })
})

// ---------------------------------------------------------------------------
// 19. P2-8: ADM 逐叶回退，整组 R22 校验
// ---------------------------------------------------------------------------
test('P2-8: inproc 缺 reasoningEffort → 回退 opentui，整组校验后整组迁', () => {
  const result = plan({
    inprocPatchText: patch(`- id: agent-default-model
  config:
    provider: opencode-go
    model: deepseek-v4-pro`),
    opentuiPatchText: patch(`- id: agent-default-model
  config:
    reasoningEffort: max`),
  })
  const values = result.externalCarry!.values
  expect(values['agent-default-model.provider']).toBe('opencode-go')
  expect(values['agent-default-model.model']).toBe('deepseek-v4-pro')
  expect(values['agent-default-model.reasoningEffort']).toBe('max')
})

test('P2-8: 回退来的 reasoningEffort 非法 → 整组丢弃，不产生半个 ext', () => {
  const result = plan({
    inprocPatchText: patch(`- id: agent-default-model
  config:
    provider: opencode-go
    model: deepseek-v4-pro`),
    opentuiPatchText: patch(`- id: agent-default-model
  config:
    reasoningEffort: !!js 1 + 1`),
  })
  expect(Object.keys(result.externalCarry!.values).some((k) => k.startsWith('agent-default-model'))).toBe(false)
  expect(result.externalCarry!.dropped).toContainEqual({
    path: 'agent-default-model', reason: 'invalid-value',
  })
})

// ---------------------------------------------------------------------------
// 20. 真实模板联调：planMigration → converge（不修改 provisioner）
// ---------------------------------------------------------------------------
/** Extract the real `PATCH_TEMPLATE` literal from the provisioner source.
 *  No import/exec of the provisioner: it has fs side effects. */
function extractRealTemplate(): string {
  const src = readFileSync(new URL('../scripts/provision-inproc-profile.mjs', import.meta.url), 'utf8')
  const marker = 'const PATCH_TEMPLATE = `'
  const start = src.indexOf(marker)
  if (start < 0) throw new Error('PATCH_TEMPLATE not found in provision-inproc-profile.mjs')
  let i = start + marker.length
  let literal = ''
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\') { literal += src[i] + src[i + 1]; i += 2; continue }
    if (ch === '`') break
    literal += ch
    i += 1
  }
  // No `${...}` in the template body; escaped backticks survive verbatim.
  return new Function(`return \`${literal}\``)() as string
}

test('真实模板联调：两源旧 patch → planMigration → converge 全叶接受、无意外 dropped', () => {
  const template = extractRealTemplate()
  expect(template).toContain('- id: llm-pi-ai')
  expect(template).toContain('maxDepth: 1')

  const inprocPatchText = [
    '- id: subagent',
    '  config:',
    '    maxActiveSubagents: 5',
    '    maxDepth: 2',
    '- id: session-log-deepseek',
    '  config:',
    '    enabled: false',
    '- id: agent-default-model',
    '  config:',
    '    provider: opencode-go',
    '    model: deepseek-v4.1-flash',
    '    reasoningEffort: max',
  ].join('\n') + '\n'
  const opentuiPatchText = [
    '- id: subagent',
    '  config:',
    '    maxActiveSubagents: 9',
    '- id: permission',
    '  config:',
    '    defaultPreset: danger-full-access',
    '- insert:',
    '    - id: tool-ask-user',
  ].join('\n') + '\n'

  const planned = planMigration({
    templatePatchText: template,
    markerExists: false,
    inprocPatchText,
    opentuiPatchText,
  })
  expect(planned.canWriteMarker).toBe(true)
  const ext = planned.externalCarry!
  // inproc 逐叶优先：9 被 5 覆盖，不回退老源
  expect(ext.values['subagent.maxActiveSubagents']).toBe(5)
  expect(ext.values['subagent.maxDepth']).toBe(2)
  expect(ext.values['session-log-deepseek.enabled']).toBe(false)
  expect(ext.values['agent-default-model.provider']).toBe('opencode-go')
  // R22 原子组：reasoningEffort 偏离模板 → 整组携带（含与模板相同的 model）
  expect(ext.values['agent-default-model.model']).toBe('deepseek-v4.1-flash')
  expect(ext.values['agent-default-model.reasoningEffort']).toBe('max')

  const REV = 'aaaaaaaaaaaaaaaa'
  const conv = converge({
    template,
    current: undefined,
    sidecar: templateProjection(template, REV),
    templateRevision: REV,
    externalCarry: ext,
  })
  // converge 报出的 dropped 必须全部来自 planner 已声明的 dropped
  const unexpected = conv.dropped.filter((d: any) =>
    !ext.dropped.some((e) => e.path === d.path && e.reason === d.reason))
  expect(unexpected).toEqual([])
  // 合法叶全部落到真实模板
  for (const [path, value] of Object.entries(ext.values)) {
    expect(conv.content).toContain(`${path.split('.')[1]}: ${value}`)
  }
  expect(conv.content).not.toContain('maxActiveSubagents: 9')
})
