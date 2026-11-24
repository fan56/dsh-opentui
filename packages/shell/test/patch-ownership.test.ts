/**
 * T3 — pure patch ownership / convergence (design 06, §8.1 #7/#12/#27/#32 +
 * the T3 extra matrix). No fs, no clock, no env reads: every test drives the
 * pure module with inline text fixtures.
 */
import { describe, expect, test } from 'bun:test'
import {
  converge,
  managedIds,
  providersMerge,
  splitPatch,
  templateProjection,
} from '../scripts/lib/patch-ownership.mjs'

const REV = 'aaaaaaaaaaaaaaaa'
const REV2 = 'bbbbbbbbbbbbbbbb'

const JS_PRESET = `!!js process.env.DSH_OPENTUI_APPROVAL_GATE === 'off' && 'danger-full-access' || 'workspace-write'`

/** A template with one row per role, one insert block, and a user-region gap. */
const TEMPLATE = [
  '# dsh-opentui inproc profile patch — GENERATED',
  `# profileRevision: ${REV}`,
  '# model route (managed):',
  '',
  '- id: llm-pi-ai',
  '  name: "@deepseek-ai/dsh-llm-pi-ai"',
  '  config:',
  '    providers:',
  '      zai-coding-cn:',
  '        api: openai-completions',
  '        apiKeyEnv: ZAI_CODING_CN_API_KEY',
  '        models:',
  '          - id: glm-4.5',
  '            name: glm-4.5',
  '      opencode-go:',
  '        api: openai-completions',
  '        apiKeyEnv: OPENCODE_API_KEY',
  '        models:',
  '          - id: deepseek-v4.1-flash',
  '            name: deepseek-v4.1-flash',
  '  # a trailing comment inside the managed row',
  '',
  '# USER REGION — blank line above and below must survive byte-for-byte',
  '- id: foreign-row',
  '  config:',
  '    mine: keep-me',
  '',
  '- id: subagent',
  '  name: "@deepseek-ai/dsh-subagent"',
  '  config:',
  '    maxActiveSubagents: 3',
  '    maxDepth: 1',
  '- insert:',
  '    - id: tool-ask-user',
  "      name: '@aiwayds/dsh-tool-ask-user'",
  '- id: permission',
  '  name: "@deepseek-ai/dsh-permission-presets"',
  '  config:',
  '    presets:',
  '      sandbox-loosening-forbidden:',
  '        sandbox: danger-full-access',
  `    defaultPreset: ${JS_PRESET}`,
  '- id: session-log-deepseek',
  '  name: "@deepseek-ai/dsh-session-log-deepseek"',
  '  config:',
  '    enabled: true',
  '- id: tool-bash',
  '  name: "@deepseek-ai/dsh-tool-bash"',
  '  config:',
  '    enabled: true',
  '',
].join('\n')

function sidecar(text = TEMPLATE, revision = REV) {
  return templateProjection(text, revision)
}

function run(current: string | undefined, extra: Partial<Parameters<typeof converge>[0]> = {}) {
  return converge({ template: TEMPLATE, current, sidecar: sidecar(), templateRevision: REV, ...extra })
}

// ---------------------------------------------------------------------------
// split / managedIds / templateProjection basics
// ---------------------------------------------------------------------------

describe('splitPatch / managedIds / templateProjection', () => {
  test('splits top-level blocks with byte ranges, kind, id and insert ids', () => {
    const blocks = splitPatch(TEMPLATE)
    const rows = blocks.filter((b) => b.kind === 'row')
    const inserts = blocks.filter((b) => b.kind === 'insert')
    expect(rows.map((b) => b.id)).toEqual([
      'llm-pi-ai', 'foreign-row', 'subagent', 'permission', 'session-log-deepseek', 'tool-bash',
    ])
    expect(inserts.length).toBe(1)
    expect(inserts[0].insertIds).toEqual(['tool-ask-user'])
    for (const b of blocks) {
      expect(TEMPLATE.slice(b.range[0], b.range[1])).toBe(b.raw)
      expect(b.raw.startsWith('- ')).toBe(true)
    }
  })

  test('managedIds = top-level row ids ∪ insert nested ids (foreign rows never declared in template)', () => {
    const noForeign = TEMPLATE.replace(
      "# USER REGION — blank line above and below must survive byte-for-byte\n- id: foreign-row\n  config:\n    mine: keep-me\n\n",
      '',
    )
    const ids = managedIds(noForeign)
    expect(ids.has('subagent')).toBe(true)
    expect(ids.has('tool-ask-user')).toBe(true)
    expect(ids.has('foreign-row')).toBe(false)
  })

  test('N9: ancestor never contains name or disabled; js marker is JSON-safe', () => {
    const state = sidecar()
    expect(state.rows.subagent.ancestor).not.toHaveProperty('name')
    expect(state.rows.subagent.ancestor).not.toHaveProperty('disabled')
    expect(JSON.parse(JSON.stringify(state.rows.permission.ancestor)).config.defaultPreset.$js).toContain('APPROVAL_GATE')
    expect(state.rows['llm-pi-ai'].ancestor.providers).toBeTruthy()
    expect(state.rows['llm-pi-ai'].ancestor.restSha256).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// #7 — ancestor is the TEMPLATE projection, not what was written
// ---------------------------------------------------------------------------

describe('#7 — carry leaf maxDepth=2 is stable across three rounds', () => {
  test('ancestor records 1; round 2 no write; round 3 still 2', () => {
    const state = sidecar()
    expect(state.rows.subagent.ancestor.config.maxDepth).toBe(1)

    const current = TEMPLATE.replace('maxDepth: 1', 'maxDepth: 2')
    const first = run(current)
    // The file already holds the user's value; converge must not revert it.
    expect(first.write).toBe(false)
    expect(first.content).toContain('maxDepth: 2')

    const second = run(first.content, { sidecar: first.sidecar ?? state })
    expect(second.write).toBe(false)
    expect(second.content).toContain('maxDepth: 2')

    const third = run(second.content, { sidecar: second.sidecar ?? state })
    expect(third.write).toBe(false)
    expect(third.content).toContain('maxDepth: 2')
    expect(third.content).not.toContain('maxDepth: 1')
  })

  test('template default change with current==base adopts the NEW template value', () => {
    const newTemplate = TEMPLATE.replace(`# profileRevision: ${REV}`, `# profileRevision: ${REV2}`)
      .replace('maxDepth: 1', 'maxDepth: 9')
    const out = converge({
      template: newTemplate,
      current: TEMPLATE,
      sidecar: sidecar(), // ancestor = old template projection
      templateRevision: REV2,
    })
    expect(out.write).toBe(true)
    expect(out.content).toContain('maxDepth: 9')
    expect(out.sidecar.rows.subagent.ancestor.config.maxDepth).toBe(9)
  })
})

// ---------------------------------------------------------------------------
// #12 / P0-4 — user-added entries inside a managed insert block
// ---------------------------------------------------------------------------

describe('#12 — managed insert block with a user-added entry', () => {
  const USER_ENTRY = [
    '    - id: my-custom-entry',
    "      name: 'my.custom/plugin'",
    '      config:',
    '        note: keep-me',
  ].join('\n')
  const withUserEntry = TEMPLATE.replace(
    "      name: '@aiwayds/dsh-tool-ask-user'",
    `      name: '@aiwayds/dsh-tool-ask-user'\n${USER_ENTRY}`,
  )

  test('template entries unchanged → no write, user entry preserved byte-for-byte', () => {
    const out = run(withUserEntry)
    expect(out.write).toBe(false)
    expect(out.content).toBe(withUserEntry)
    expect(out.content).toContain('note: keep-me')
  })

  test('template entry changed → block rewritten, user entry appended after it + WARN', () => {
    const newTemplate = TEMPLATE.replace(
      "      name: '@aiwayds/dsh-tool-ask-user'",
      "      name: '@aiwayds/dsh-tool-ask-user'\n      config:\n        enabled: true",
    ).replace(`# profileRevision: ${REV}`, `# profileRevision: ${REV2}`)
    const out = converge({
      template: newTemplate,
      current: withUserEntry,
      sidecar: sidecar(newTemplate, REV2),
      templateRevision: REV2,
    })
    expect(out.write).toBe(true)
    expect(out.content).toContain('enabled: true')
    expect(out.content).toContain('note: keep-me')
    // template entry precedes the user entry
    expect(out.content.indexOf('enabled: true')).toBeLessThan(out.content.indexOf('note: keep-me'))
    expect(out.warnings.join(' ')).toContain('insert-user-entry-moved')
  })
})

// ---------------------------------------------------------------------------
// #27 — absent file + externalCarry
// ---------------------------------------------------------------------------

describe('#27 — absent file + externalCarry', () => {
  const ext = {
    source: 'opentui-inproc' as const,
    values: {
      'subagent.maxActiveSubagents': 5,
      'subagent.maxDepth': 3,
      'session-log-deepseek.enabled': false,
    },
    dropped: [{ path: 'permission.defaultPreset', reason: 'template-authority' }],
  }

  test('ext written; ancestor is unmodified template; marker round no-op; no-marker round idempotent', () => {
    const first = converge({
      template: TEMPLATE,
      current: undefined,
      sidecar: sidecar(),
      templateRevision: REV,
      externalCarry: ext,
    })
    expect(first.write).toBe(true)
    expect(first.reason).toBe('absent')
    expect(first.content).toContain('maxActiveSubagents: 5')
    expect(first.content).toContain('maxDepth: 3')
    expect(first.content).toContain('enabled: false')
    // ancestor stores the TEMPLATE values, not the ext values
    expect(first.sidecar.rows.subagent.ancestor.config.maxDepth).toBe(1)
    expect(first.sidecar.rows.subagent.ancestor.config.maxActiveSubagents).toBe(3)
    expect(first.warnings.join(' ')).toContain('external-dropped')

    // marker exists → ext gone → no-op
    const withMarker = converge({
      template: TEMPLATE,
      current: first.content,
      sidecar: first.sidecar,
      templateRevision: REV,
    })
    expect(withMarker.write).toBe(false)

    // marker lost → ext recomputed on the same content → identical, no-op
    const noMarker = converge({
      template: TEMPLATE,
      current: first.content,
      sidecar: first.sidecar,
      templateRevision: REV,
      externalCarry: ext,
    })
    expect(noMarker.write).toBe(false)
    expect(noMarker.content).toBe(first.content)
  })
})

// ---------------------------------------------------------------------------
// #32 — providers sub-key merge
// ---------------------------------------------------------------------------

describe('#32 — llm-pi-ai.providers merge', () => {
  test('user-added provider kept, user-edited template provider kept, deleted template provider restored', () => {
    const current = TEMPLATE
      .replace('apiKeyEnv: ZAI_CODING_CN_API_KEY', 'apiKeyEnv: MY_PRIVATE_REF')
      .replace(/      opencode-go:\n        api: openai-completions\n        apiKeyEnv: OPENCODE_API_KEY\n        models:\n          - id: deepseek-v4\.1-flash\n            name: deepseek-v4\.1-flash\n/, '')
      .replace(
        '      zai-coding-cn:',
        "      my-gateway:\n        api: openai-completions\n        apiKeyEnv: MY_GATEWAY_KEY\n      zai-coding-cn:",
      )
    const out = run(current)
    expect(out.write).toBe(true)
    expect(out.content).toContain('apiKeyEnv: MY_PRIVATE_REF')
    expect(out.content).toContain('my-gateway')
    expect(out.content).toContain('opencode-go')
    expect(out.warnings.join(' ')).toContain('provider-restored')
  })

  test('base-unknown: template providers authoritative, user additions kept', () => {
    const current = TEMPLATE
      .replace('apiKeyEnv: ZAI_CODING_CN_API_KEY', 'apiKeyEnv: MY_PRIVATE_REF')
      .replace('      zai-coding-cn:', '      my-gateway:\n        apiKeyEnv: MY_GATEWAY_KEY\n      zai-coding-cn:')
    const out = run(current, { sidecar: undefined })
    expect(out.backupReason).toBe('base-unknown')
    expect(out.content).not.toContain('MY_PRIVATE_REF')
    expect(out.content).toContain('ZAI_CODING_CN_API_KEY')
    expect(out.content).toContain('my-gateway')
    expect(out.warnings.join(' ')).toContain('provider-template-authority')
  })

  test('user-corrupted api/models → whole provider restored to template + WARN', () => {
    const current = TEMPLATE
      .replace('api: openai-completions\n        apiKeyEnv: ZAI_CODING_CN_API_KEY', 'api: bogus-protocol\n        apiKeyEnv: ZAI_CODING_CN_API_KEY')
    const out = run(current)
    expect(out.content).toContain('api: openai-completions')
    expect(out.content).not.toContain('bogus-protocol')
    expect(out.warnings.join(' ')).toContain('provider-api-invalid')
  })

  test('providersMerge unit: template id authority / user additions / field merge', () => {
    const anc = { a: { api: 'openai-completions', apiKeyEnv: 'OLD' } }
    const cur = { a: { api: 'openai-completions', apiKeyEnv: 'NEW' }, b: { apiKeyEnv: 'B' } }
    const nxt = { a: { api: 'openai-completions', apiKeyEnv: 'OLD' }, c: { apiKeyEnv: 'C' } }
    const warnings: string[] = []
    const out = providersMerge(anc, cur, nxt, 'llm-pi-ai', warnings)
    expect(out.a.apiKeyEnv).toBe('NEW') // user field change survives
    expect(out.b.apiKeyEnv).toBe('B') // user addition survives
    expect(out.c.apiKeyEnv).toBe('C') // new template provider restored
    expect(warnings.join(' ')).toContain('provider-restored')
  })
})

// ---------------------------------------------------------------------------
// T3 extras — format normalization, duplicates, user bytes, N1, fatal
// ---------------------------------------------------------------------------

describe('format normalization is a no-op (R8)', () => {
  test('!!js folded by host, trailing-comment spacing normalized → write:false', () => {
    const folded = [
      `    defaultPreset: !!js process.env.DSH_OPENTUI_APPROVAL_GATE === 'off' &&`,
      "      'danger-full-access' || 'workspace-write'  # normalized spacing",
    ].join('\n')
    const current = TEMPLATE.replace(`    defaultPreset: ${JS_PRESET}`, folded)
    const out = run(current)
    expect(out.write).toBe(false)
    expect(out.content).toBe(current) // user bytes preserved, no rewrite
  })

  test('CRLF input + equivalent values → write:false', () => {
    const current = TEMPLATE.replace(/\n/g, '\r\n')
    const out = run(current)
    expect(out.write).toBe(false)
  })

  test('long line folded around !!js does not trigger carry or backup', () => {
    const longLine = `    defaultPreset: !!js process.env.DSH_OPENTUI_APPROVAL_GATE === 'off' &&\n      'danger-full-access' || 'workspace-write'`
    const current = TEMPLATE.replace(`    defaultPreset: ${JS_PRESET}`, longLine)
    const out = run(current)
    expect(out.write).toBe(false)
    expect(out.backupReason).toBeUndefined()
    expect(out.warnings.join(' ')).not.toContain('carry-conflict')
  })

  test('tag participates in projection: plain override carried, !!js in current rejected', () => {
    // A plain scalar replacing the template !!js is a real user value and is
    // carried (06:1145); its text alone does not make it equal to the tag.
    const plain = TEMPLATE.replace(JS_PRESET, `'danger-full-access'`)
    const plainOut = run(plain)
    expect(plainOut.content).toContain(`defaultPreset: 'danger-full-access'`)
    expect(plainOut.content).not.toContain(JS_PRESET)
    // Conversely a host-written !!js leaf cannot be carried: template wins.
    const jsCurrent = TEMPLATE.replace(JS_PRESET, `!!js some.other.expression`)
    const jsOut = run(jsCurrent)
    expect(jsOut.write).toBe(true)
    expect(jsOut.content).toContain(JS_PRESET)
    expect(jsOut.warnings.join(' ')).toContain('carry-js-rejected')
  })
})

describe('duplicate ids, user region bytes, disabled carry', () => {
  test('duplicate managed id: value is per-key last-wins, position first, rest deleted', () => {
    const current = TEMPLATE.replace(
      '    maxDepth: 1\n- insert:',
      '    maxDepth: 2\n- id: subagent\n  name: "@deepseek-ai/dsh-subagent"\n  disabled: true\n- insert:',
    )
    const out = run(current)
    expect(out.write).toBe(true)
    expect(out.backupReason).toBe('duplicates')
    expect(out.content).toContain('maxDepth: 2')
    expect(out.content).toContain('disabled: true')
    const count = (out.content.match(/^- id: subagent$/gm) || []).length
    expect(count).toBe(1)
  })

  test('user region (blank lines, foreign comments, foreign row) preserved byte-for-byte', () => {
    const current = TEMPLATE
      .replace('maxDepth: 1', 'maxDepth: 4')
      .replace('# USER REGION', '# USER REGION (edited by hand)\n\n# extra hand-written note')
      .replace(
        '- id: tool-bash\n  name: "@deepseek-ai/dsh-tool-bash"\n  config:\n    enabled: true',
        '- id: tool-bash\n  name: "@deepseek-ai/dsh-tool-bash"\n  config:\n    enabled: false  # hand note',
      )
    const out = run(current)
    expect(out.write).toBe(true)
    // R10 priority: foreign-comments outranks drift when both occur.
    expect(out.backupReason).toBe('foreign-comments')
    expect(out.notes.join(' ')).toContain('drift:')
    expect(out.content).toContain('# USER REGION (edited by hand)\n\n# extra hand-written note')
    expect(out.content).toContain('    mine: keep-me')
    expect(out.content).toContain('maxDepth: 4')
    // A trailing comment inside a rewritten authority row is reported.
    expect(out.droppedComments.join(' ')).toContain('hand note')
    // The foreign row was outside any managed span, so its bytes survived.
    expect(out.content).toContain('    mine: keep-me\n')
  })

  test('disabled: /plugin true survives; false ≡ absent; no spurious disabled:false emitted', () => {
    const disabledTrue = TEMPLATE.replace('    maxDepth: 1', '    maxDepth: 1\n  disabled: true')
    const outTrue = run(disabledTrue)
    expect(outTrue.write).toBe(false)
    expect(outTrue.content).toContain('disabled: true')
    // Explicit `false` is semantically equal to absence (R8/R20): no rewrite,
    // and we never emit a meaningless `disabled: false` into a fresh row.
    const disabledFalse = TEMPLATE.replace('    maxDepth: 1', '    maxDepth: 1\n  disabled: false')
    expect(run(disabledFalse).write).toBe(false)
    expect(run(TEMPLATE).content).not.toContain('disabled: false')
    // A template `!!js` disabled leaf stays authoritative if the host writes a plain bool.
    const jsTpl = TEMPLATE.replace(
      '  config:\n    enabled: true\n',
      '  disabled: !!js process.platform === \'win32\'\n  config:\n    enabled: true\n',
    )
    const jsCur = jsTpl.replace("disabled: !!js process.platform === 'win32'", 'disabled: false')
    const outJs = converge({ template: jsTpl, current: jsCur, sidecar: templateProjection(jsTpl, REV), templateRevision: REV })
    expect(outJs.write).toBe(true)
    expect(outJs.content).toContain("disabled: !!js process.platform === 'win32'")
    expect(outJs.warnings.join(' ')).toContain('disabled-js-overwritten')
  })
})

describe('N1 sidecar self-heal and fatal parse errors', () => {
  test('sidecar missing + file equals template → write:false, writeSidecarOnly:true', () => {
    const out = run(TEMPLATE, { sidecar: undefined })
    expect(out.write).toBe(false)
    expect(out.writeSidecarOnly).toBe(true)
    expect(out.sidecar.version).toBe(1)
    expect(out.sidecar.templateRevision).toBe(REV)
  })

  test('sidecar corrupt (version != 1) → self-heal', () => {
    const out = run(TEMPLATE, { sidecar: { version: 2, rows: {} } })
    expect(out.write).toBe(false)
    expect(out.writeSidecarOnly).toBe(true)
  })

  test('sidecar revision stale + otherwise converged → self-heal', () => {
    const stale = sidecar(TEMPLATE, '0000000000000000')
    const out = run(TEMPLATE, { sidecar: stale })
    expect(out.write).toBe(false)
    expect(out.writeSidecarOnly).toBe(true)
    expect(out.sidecar.templateRevision).toBe(REV)
  })

  test('parse failure → structured error with line:col, write:false, no content write', () => {
    const out = run('- id: [unclosed\n  config: {')
    expect(out.write).toBe(false)
    expect(out.error).toBeTruthy()
    expect(out.error.code).toBe('parse')
    expect(typeof out.error.line).toBe('number')
    expect(typeof out.error.col).toBe('number')
  })

  test('`- # comment` on a separate line → shape error, write:false (R28)', () => {
    const broken = '- # note\n  id: subagent\n  config:\n    maxDepth: 1\n'
    const out = run(broken)
    expect(out.write).toBe(false)
    expect(out.error.code).toBe('shape')
    expect(typeof out.error.line).toBe('number')
  })
})

describe('R13 preamble on generated content', () => {
  test('generated content survives document.delete(0) (header + first comment stay)', async () => {
    const { parseDocument, isSeq } = await import('yaml')
    const out = run(undefined)
    expect(out.write).toBe(true)
    const doc = parseDocument(out.content, {
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (v: string) => v }],
    })
    expect(isSeq(doc.contents)).toBe(true)
    doc.delete(0)
    const after = String(doc)
    expect(after).toContain('# profileRevision:')
    expect(after).toContain('# model route')
  })
})

// ---------------------------------------------------------------------------
// externalCarry validation / drop matrix (06 §4.5, §5.4, §7.3 — T8 第 1 刀)
// ---------------------------------------------------------------------------

const ADM_ROW = [
  '- id: agent-default-model',
  '  name: "@deepseek-ai/dsh-agent-default-model"',
  '  config:',
  '    provider: opencode-go',
  '    model: deepseek-v4.1-flash',
  '    reasoningEffort: high',
].join('\n')
const TEMPLATE_ADM = TEMPLATE.replace('- id: session-log-deepseek', `${ADM_ROW}\n- id: session-log-deepseek`)
const sidecarAdm = () => templateProjection(TEMPLATE_ADM, REV)

function absentRun(ext: Parameters<typeof converge>[0]['externalCarry'], template = TEMPLATE) {
  return converge({
    template,
    current: undefined,
    sidecar: template === TEMPLATE ? sidecar() : sidecarAdm(),
    templateRevision: REV,
    externalCarry: ext,
  })
}

describe('externalCarry — old callers and idempotence', () => {
  test('no externalCarry: byte-identical behavior, no drops, no ext warnings', () => {
    // authority-row drift still writes and backs up, exactly as before
    const changed = TEMPLATE.replace(
      '- id: tool-bash\n  name: "@deepseek-ai/dsh-tool-bash"\n  config:\n    enabled: true',
      '- id: tool-bash\n  name: "@deepseek-ai/dsh-tool-bash"\n  config:\n    enabled: false',
    )
    const out = run(changed)
    expect(out.write).toBe(true)
    expect(out.content).toContain('enabled: true')
    expect(out.backupReason).toBe('drift')
    expect(out.dropped).toEqual([])
    expect(out.warnings.join(' ')).not.toContain('external-dropped')

    // carry user value still survives with no write
    const carried = run(TEMPLATE.replace('maxDepth: 1', 'maxDepth: 4'))
    expect(carried.write).toBe(false)
    expect(carried.content).toContain('maxDepth: 4')
    expect(carried.dropped).toEqual([])

    const same = run(TEMPLATE)
    expect(same.write).toBe(false)
    expect(same.content).toBe(TEMPLATE)
    expect(same.dropped).toEqual([])
  })

  test('absent + ext: values written, ancestor stays the unmodified template projection', () => {
    const ext = {
      source: 'opentui-inproc' as const,
      values: {
        'subagent.maxActiveSubagents': 2,
        'subagent.maxDepth': 3,
        'session-log-deepseek.enabled': false,
      },
      dropped: [{ path: 'permission.defaultPreset', reason: 'template-authority' }],
    }
    const first = absentRun(ext)
    expect(first.write).toBe(true)
    expect(first.reason).toBe('absent')
    expect(first.content).toContain('maxActiveSubagents: 2')
    expect(first.content).toContain('maxDepth: 3')
    expect(first.content).toContain('enabled: false')
    // ancestor = template, never the ext values
    expect(first.sidecar.rows.subagent.ancestor.config).toEqual({ maxActiveSubagents: 3, maxDepth: 1 })
    expect(first.sidecar.rows['session-log-deepseek'].ancestor.config).toEqual({ enabled: true })
    expect(first.dropped).toEqual([{ path: 'permission.defaultPreset', reason: 'template-authority' }])
    expect(first.warnings.join(' ')).toContain('external-dropped: permission.defaultPreset: template-authority')

    // marker exists -> caller passes undefined -> no-op
    const withMarker = converge({
      template: TEMPLATE,
      current: first.content,
      sidecar: first.sidecar,
      templateRevision: REV,
    })
    expect(withMarker.write).toBe(false)
    expect(withMarker.content).toBe(first.content)
  })

  test('crash re-entry: patch written with ext but marker missing -> same result, write:false', () => {
    const ext = {
      source: 'opentui' as const,
      values: { 'subagent.maxActiveSubagents': 2, 'subagent.maxDepth': 3, 'session-log-deepseek.enabled': false },
      dropped: [] as Array<{ path: string; reason: string }>,
    }
    const first = absentRun(ext)
    const reentry = converge({
      template: TEMPLATE,
      current: first.content,
      sidecar: first.sidecar,
      templateRevision: REV,
      externalCarry: ext, // marker was never written, so ext is recomputed
    })
    expect(reentry.write).toBe(false)
    expect(reentry.content).toBe(first.content)
    expect(reentry.dropped).toEqual(first.dropped)
    expect(reentry.sidecar).toBeUndefined()
  })
})

describe('externalCarry — validation and drops', () => {
  test('invalid ext leaves are dropped and never written (!!js / wrong type / non-boolean)', () => {
    const ext = {
      source: 'opentui' as const,
      values: {
        'subagent.maxActiveSubagents': 2,
        'subagent.maxDepth': 'oops',
        'subagent.foo': { $js: 'evil' },
        'session-log-deepseek.enabled': 'no',
      },
    }
    const out = absentRun(ext)
    expect(out.content).toContain('maxActiveSubagents: 2')
    expect(out.content).toContain('maxDepth: 1')
    expect(out.content).not.toContain('maxDepth: oops')
    expect(out.content).not.toContain('foo:')
    expect(out.content).toContain('enabled: true')
    expect(out.dropped.map((d) => d.path).sort()).toEqual([
      'session-log-deepseek.enabled', 'subagent.foo', 'subagent.maxDepth',
    ])
    expect(out.dropped.every((d) => d.reason === 'invalid-value')).toBe(true)
    expect((out.warnings.join(' ').match(/external-dropped:/g) || []).length).toBe(3)
  })

  test('subagent capacity/depth reject 0 and negatives; 1 is the minimum accepted value', () => {
    const ext = {
      source: 'opentui' as const,
      values: { 'subagent.maxActiveSubagents': 0, 'subagent.maxDepth': -1 },
    }
    const out = absentRun(ext)
    expect(out.content).toContain('maxActiveSubagents: 3')
    expect(out.content).toContain('maxDepth: 1')
    expect(out.content).not.toContain('maxActiveSubagents: 0')
    expect(out.content).not.toContain('maxDepth: -1')
    expect(out.dropped).toEqual([
      { path: 'subagent.maxActiveSubagents', reason: 'invalid-value' },
      { path: 'subagent.maxDepth', reason: 'invalid-value' },
    ])

    const atOne = absentRun({ source: 'opentui' as const, values: { 'subagent.maxActiveSubagents': 1 } })
    expect(atOne.content).toContain('maxActiveSubagents: 1')
    expect(atOne.dropped).toEqual([])
  })

  test('permission.defaultPreset, permission.presets and llm-pi-ai.providers are rejected by role', () => {
    const ext = {
      source: 'opentui' as const,
      values: {
        'permission.defaultPreset': 'danger-full-access',
        'permission.presets': { my: { sandbox: 'danger-full-access' } },
        'llm-pi-ai.providers': { evil: { api: 'openai-completions' } },
        'subagent.maxDepth': 2,
      },
    }
    const out = absentRun(ext)
    expect(out.content).toContain('maxDepth: 2')
    expect(out.content).toContain('defaultPreset: !!js')
    expect(out.content).not.toContain('defaultPreset: danger-full-access')
    expect(out.content).not.toContain('my:')
    expect(out.content).not.toContain('evil:')
    expect(out.dropped).toEqual([
      { path: 'permission.defaultPreset', reason: 'template-authority' },
      { path: 'permission.presets', reason: 'sandbox-loosening-forbidden' },
      { path: 'llm-pi-ai.providers', reason: 'model-table-template-owned' },
    ])
  })

  test('agent-default-model: missing required leaf drops the whole group', () => {
    const ext = {
      source: 'opentui' as const,
      values: { 'agent-default-model.provider': 'zai-coding-cn' }, // no model
    }
    const out = absentRun(ext, TEMPLATE_ADM)
    expect(out.content).toContain('provider: opencode-go')
    expect(out.content).not.toContain('provider: zai-coding-cn')
    expect(out.dropped).toEqual([{ path: 'agent-default-model.provider', reason: 'invalid-value' }])
  })

  test('agent-default-model: model absent from the new template table drops the whole group', () => {
    const ext = {
      source: 'opentui' as const,
      values: {
        'agent-default-model.provider': 'opencode-go',
        'agent-default-model.model': 'glm-5.4', // not in opencode-go.models
        'agent-default-model.reasoningEffort': 'high',
      },
    }
    const out = absentRun(ext, TEMPLATE_ADM)
    expect(out.content).toContain('model: deepseek-v4.1-flash')
    expect(out.content).not.toContain('glm-5.4')
    expect(out.dropped).toEqual([
      { path: 'agent-default-model.provider', reason: 'model-id-not-in-template' },
      { path: 'agent-default-model.model', reason: 'model-id-not-in-template' },
      { path: 'agent-default-model.reasoningEffort', reason: 'model-id-not-in-template' },
    ])
  })

  test('agent-default-model: complete valid group is applied atomically', () => {
    const ext = {
      source: 'opentui' as const,
      values: {
        'agent-default-model.provider': 'zai-coding-cn',
        'agent-default-model.model': 'glm-4.5',
        'agent-default-model.reasoningEffort': 'medium',
      },
    }
    const out = absentRun(ext, TEMPLATE_ADM)
    expect(out.content).toContain('provider: zai-coding-cn')
    expect(out.content).toContain('model: glm-4.5')
    expect(out.content).toContain('reasoningEffort: medium')
    expect(out.dropped).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// P1-1 — externalCarry leaf depth + prototype-pollution regression
// ---------------------------------------------------------------------------

describe('externalCarry — P1-1 whitelist and prototype-pollution defense', () => {
  test('extra depth under a valid leaf is dropped; template number stays unchanged', () => {
    const out = absentRun({
      source: 'opentui' as const,
      values: { 'subagent.maxActiveSubagents.foo': 1 },
    })
    expect(out.content).toContain('maxActiveSubagents: 3')
    expect(out.content).not.toContain('foo:')
    expect(out.dropped).toEqual([
      { path: 'subagent.maxActiveSubagents.foo', reason: 'invalid-value' },
    ])
  })

  test('unsafe segments (__proto__ / constructor / prototype) are dropped as invalid-value', () => {
    const out = absentRun({
      source: 'opentui' as const,
      values: {
        'subagent.__proto__.pollutedByExt': 'yes',
        'constructor.prototype.x': 'yes',
        'prototype.x': 'yes',
        'permission.__proto__.x': 'yes',
      },
    })
    expect(out.dropped).toEqual([
      { path: 'subagent.__proto__.pollutedByExt', reason: 'invalid-value' },
      { path: 'constructor.prototype.x', reason: 'invalid-value' },
      { path: 'prototype.x', reason: 'invalid-value' },
      { path: 'permission.__proto__.x', reason: 'invalid-value' },
    ])
    expect(out.content).toContain('maxActiveSubagents: 3')
    expect(out.content).not.toContain('pollutedByExt')
    expect(out.content).not.toContain('x: yes')
  })

  test('converge never pollutes Object.prototype or Array.prototype', () => {
    absentRun({
      source: 'opentui' as const,
      values: {
        'subagent.__proto__.pollutedByExt': 'yes',
        'constructor.prototype.pollutedByExt': 'yes',
        'prototype.pollutedByExt': 'yes',
      },
    })
    expect(({} as Record<string, unknown>).pollutedByExt).toBeUndefined()
    expect(([] as unknown as Record<string, unknown>).pollutedByExt).toBeUndefined()
  })

  test('unknown leaf subagent.unknown is dropped (no default-valid fallback)', () => {
    const out = absentRun({
      source: 'opentui' as const,
      values: { 'subagent.unknown': 1 },
    })
    expect(out.dropped).toEqual([{ path: 'subagent.unknown', reason: 'invalid-value' }])
    expect(out.content).not.toContain('unknown:')
  })

  test('all six whitelisted leaves are still applied together', () => {
    const out = absentRun({
      source: 'opentui' as const,
      values: {
        'subagent.maxActiveSubagents': 4,
        'subagent.maxDepth': 2,
        'session-log-deepseek.enabled': false,
        'agent-default-model.provider': 'zai-coding-cn',
        'agent-default-model.model': 'glm-4.5',
        'agent-default-model.reasoningEffort': 'medium',
      },
    }, TEMPLATE_ADM)
    expect(out.content).toContain('maxActiveSubagents: 4')
    expect(out.content).toContain('maxDepth: 2')
    expect(out.content).toContain('enabled: false')
    expect(out.content).toContain('provider: zai-coding-cn')
    expect(out.content).toContain('model: glm-4.5')
    expect(out.content).toContain('reasoningEffort: medium')
    expect(out.dropped).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// nested insert ext — dsh-approval-policy.config.windowSeconds
// ---------------------------------------------------------------------------

const POLICY_INSERT = [
  '- insert:',
  '    - id: dsh-approval-policy',
  "      name: '@aiwayds/dsh-approval-policy'",
  '      config:',
  '        windowSeconds: 300',
].join('\n')
const TEMPLATE_POLICY = TEMPLATE + POLICY_INSERT + '\n'

function policyRun(current: string | undefined, ext: Parameters<typeof converge>[0]['externalCarry']) {
  return converge({
    template: TEMPLATE_POLICY,
    current,
    sidecar: sidecar(TEMPLATE_POLICY, REV),
    templateRevision: REV,
    externalCarry: ext,
  })
}

function windowExt(value: unknown) {
  return {
    source: 'opentui-inproc' as const,
    values: { 'dsh-approval-policy.config.windowSeconds': value },
  }
}

describe('externalCarry — nested insert windowSeconds', () => {
  test('absent: 600 lands in the insert config; ancestor stays the unmodified template (300)', () => {
    const first = policyRun(undefined, windowExt(600))
    expect(first.write).toBe(true)
    expect(first.reason).toBe('absent')
    expect(first.content).toContain('        windowSeconds: 600')
    expect(first.content).not.toContain('windowSeconds: 300')
    // Sidecar ancestor is the template projection WITHOUT ext.
    expect(first.sidecar!.rows['dsh-approval-policy'].ancestor.config).toEqual({ windowSeconds: 300 })
    expect(first.dropped).toEqual([])

    // marker present -> no ext -> no-op on the written patch
    const withMarker = converge({
      template: TEMPLATE_POLICY,
      current: first.content,
      sidecar: first.sidecar,
      templateRevision: REV,
    })
    expect(withMarker.write).toBe(false)
    expect(withMarker.content).toBe(first.content)
  })

  test('existing file: ext overrides the template value and is not reported as drift', () => {
    const out = policyRun(TEMPLATE_POLICY, windowExt(600))
    expect(out.write).toBe(true)
    expect(out.content).toContain('windowSeconds: 600')
    expect(out.content).not.toContain('windowSeconds: 300')
    expect(out.sidecar!.rows['dsh-approval-policy'].ancestor.config).toEqual({ windowSeconds: 300 })
    expect(out.drift).toEqual([])
  })

  test('crash re-entry: current already 600, marker missing -> ext re-applied idempotently', () => {
    const first = policyRun(undefined, windowExt(600))
    const reentry = policyRun(first.content, windowExt(600))
    expect(reentry.write).toBe(false)
    expect(reentry.content).toBe(first.content)
    expect(reentry.dropped).toEqual([])
  })

  test('boundaries 0 and 86400 are accepted; both are written verbatim', () => {
    for (const boundary of [0, 86400]) {
      const out = policyRun(undefined, windowExt(boundary))
      expect(out.content).toContain(`windowSeconds: ${boundary}`)
      expect(out.dropped).toEqual([])
    }
  })

  test('invalid values drop as invalid-value and never widen the window', () => {
    const invalid = [-1, 86401, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
      '600', { $js: 'evil' }, {}, true, null] as unknown[]
    for (const value of invalid) {
      const out = policyRun(undefined, windowExt(value))
      expect(out.content).toContain('windowSeconds: 300')
      expect(out.dropped).toEqual([
        { path: 'dsh-approval-policy.config.windowSeconds', reason: 'invalid-value' },
      ])
      expect(out.warnings.join(' ')).toContain('external-dropped: dsh-approval-policy.config.windowSeconds: invalid-value')
    }
  })

  test('only the exact nested path is allowed: wrong depth/leaf/row are dropped', () => {
    const out = policyRun(undefined, {
      source: 'opentui' as const,
      values: {
        'dsh-approval-policy.windowSeconds': 600,
        'dsh-approval-policy.config.foo': 600,
        'dsh-approval-policy.config.windowSeconds.extra': 600,
        'subagent.config.windowSeconds': 600,
        'dsh-approval-policy.config.__proto__.polluted': 600,
      },
    })
    expect(out.content).toContain('windowSeconds: 300')
    expect(out.content).not.toContain('polluted')
    expect(out.dropped).toEqual([
      { path: 'dsh-approval-policy.windowSeconds', reason: 'invalid-value' },
      { path: 'dsh-approval-policy.config.foo', reason: 'invalid-value' },
      { path: 'dsh-approval-policy.config.windowSeconds.extra', reason: 'invalid-value' },
      { path: 'subagent.config.windowSeconds', reason: 'invalid-value' },
      { path: 'dsh-approval-policy.config.__proto__.polluted', reason: 'invalid-value' },
    ])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  test('nested ext composes with the row leaves and permission stays template-owned', () => {
    const out = policyRun(undefined, {
      source: 'opentui' as const,
      values: {
        'subagent.maxDepth': 2,
        'dsh-approval-policy.config.windowSeconds': 600,
        'permission.defaultPreset': 'danger-full-access',
      },
      dropped: [{ path: 'permission.presets', reason: 'sandbox-loosening-forbidden' }],
    })
    expect(out.content).toContain('maxDepth: 2')
    expect(out.content).toContain('windowSeconds: 600')
    expect(out.content).toContain('defaultPreset: !!js')
    expect(out.content).not.toContain('defaultPreset: danger-full-access')
    expect(out.dropped).toEqual([
      { path: 'permission.presets', reason: 'sandbox-loosening-forbidden' },
      { path: 'permission.defaultPreset', reason: 'template-authority' },
    ])
  })
})
