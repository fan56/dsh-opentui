/**
 * T8 (2nd cut) — pure migration planner (06 §4.5, §7.1–7.5; D6; D8-Q2).
 * No fs / clock / env: every case drives planMigration with inline text.
 */
import { describe, expect, test } from 'bun:test'
import { planMigration } from '../scripts/lib/migration.mjs'

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
      name: '@aiwayds/dsh-tool-ask-user'
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-context7'
    - id: preset-opentui-append-system
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
    inprocPatchText: patch(subagent('    maxActiveSubagents: 5'), session('false')),
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
