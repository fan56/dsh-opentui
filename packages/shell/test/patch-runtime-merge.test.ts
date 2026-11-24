/**
 * B1 S3 — provisioner runtime-field merge (design 05 §4.3a).
 *
 * Drives the PURE merge helper with a temp-dir fixture: the template and the
 * "current" patch (as the host config service would have rewritten it) are
 * written to disk and read back, so an accidental fs dependency in the helper
 * would surface here. E1/E2/E3 of .proof/b1-s3-provisioner/00-preregistered-expected.md.
 *
 * No real DSH_HOME, no host package, no clock/env dependence.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeRuntimeFields } from '../scripts/lib/patch-runtime-merge.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/provision-inproc-profile.mjs', import.meta.url))
const JS_PRESET = "!!js process.env.DSH_OPENTUI_APPROVAL_GATE === 'off' && 'danger-full-access' || 'workspace-write'"

const TEMPLATE = [
  '# dsh-opentui inproc profile patch',
  '# profileRevision: abcdef0123456789',
  '- id: permission',
  '  config:',
  `    defaultPreset: ${JS_PRESET}`,
  '- insert:',
  '    - id: dsh-opentui-approval-gate',
  '      config:',
  '        enabled: !!js process.env.DSH_OPENTUI_APPROVAL_GATE !== \'off\'',
  '- id: subagent',
  '  name: "@deepseek-ai/dsh-subagent"',
  '  config:',
  '    maxActiveSubagents: 3',
  '    maxDepth: 1',
  '- id: session-log-deepseek',
  '  name: "@deepseek-ai/dsh-session-log-deepseek"',
  '  config:',
  '    enabled: true',
  '',
].join('\n')

const tempDirs: string[] = []

/** Write both fixture files into a fresh temp dir and read them back. */
function fixture(current: string): { template: string; current: string } {
  const dir = mkdtempSync(join(tmpdir(), 'b1-s3-patch-merge-'))
  tempDirs.push(dir)
  const templatePath = join(dir, 'template.yml')
  const currentPath = join(dir, 'current.yml')
  writeFileSync(templatePath, TEMPLATE)
  writeFileSync(currentPath, current)
  return { template: readFileSync(templatePath, 'utf8'), current: readFileSync(currentPath, 'utf8') }
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('B1 S3 E1 — subagent.maxActiveSubagents merge preserves runtime value and line order', () => {
  test('runtime 5 is carried over; maxDepth and every other line stay byte-identical', () => {
    const current = TEMPLATE.replace('maxActiveSubagents: 3', 'maxActiveSubagents: 5')
    const out = mergeRuntimeFields(fixture(current).template, current)
    expect(out.mergedFields).toEqual(['subagent.maxActiveSubagents'])
    expect(out.notes).toEqual([])
    expect(out.content).toContain('    maxActiveSubagents: 5\n    maxDepth: 1\n')
    expect(out.content).not.toContain('maxActiveSubagents: 3')
    // Only the one line differs from the template.
    const expected = TEMPLATE.replace('maxActiveSubagents: 3', 'maxActiveSubagents: 5')
    expect(out.content).toBe(expected)
  })

  test('merging the merged output is idempotent (no repeated backup on next launch)', () => {
    const current = TEMPLATE.replace('maxActiveSubagents: 3', 'maxActiveSubagents: 7')
    const first = mergeRuntimeFields(TEMPLATE, current)
    const second = mergeRuntimeFields(first.content, first.content)
    expect(second.content).toBe(first.content)
    expect(second.mergedFields).toEqual([])
    expect(second.notes).toEqual([])
  })

  test('invalid scalar is refused with a WARN (no YAML injection)', () => {
    const current = TEMPLATE.replace('maxActiveSubagents: 3', 'maxActiveSubagents: "$(rm -rf /)"')
    const out = mergeRuntimeFields(TEMPLATE, current)
    expect(out.content).toBe(TEMPLATE)
    expect(out.mergedFields).toEqual([])
    expect(out.notes.join(' ')).toContain('failed the scalar allow-list')
  })

  test('duplicate runtime lines are refused with a WARN', () => {
    const current = TEMPLATE + '    maxActiveSubagents: 9\n'
    const out = mergeRuntimeFields(TEMPLATE, current)
    expect(out.content).toBe(TEMPLATE)
    expect(out.notes.join(' ')).toContain('duplicate lines')
  })
})

describe('B1 S3 E2 — permission.defaultPreset !!js guard semantics', () => {
  test('unchanged !!js escape hatch is preserved verbatim (no merge, no note)', () => {
    const out = mergeRuntimeFields(TEMPLATE, TEMPLATE)
    expect(out.content).toBe(TEMPLATE)
    expect(out.mergedFields).toEqual([])
    expect(out.notes).toEqual([])
    expect(out.content).toContain(`defaultPreset: ${JS_PRESET}`)
  })

  test('plain scalar override is merged with an escape-hatch WARN', () => {
    const current = TEMPLATE.replace(JS_PRESET, "'danger-full-access'")
    const out = mergeRuntimeFields(TEMPLATE, current)
    expect(out.mergedFields).toContain('permission.defaultPreset')
    expect(out.content).toContain("    defaultPreset: 'danger-full-access'")
    expect(out.content).not.toContain(`defaultPreset: ${JS_PRESET}`)
    expect(out.notes.join(' ')).toContain('overrides the template !!js')
  })

  test('template !!js line for the approval gate is never touched', () => {
    const current = TEMPLATE.replace('maxActiveSubagents: 3', 'maxActiveSubagents: 5')
    const out = mergeRuntimeFields(TEMPLATE, current)
    expect(out.content).toContain("enabled: !!js process.env.DSH_OPENTUI_APPROVAL_GATE !== 'off'")
  })
})

describe('batch-gate — session-log-deepseek.enabled survives provisioner re-run (design 05 §4.3a)', () => {
  test('runtime false is carried over; the !!js approval enabled line is untouched', () => {
    const current = TEMPLATE.replace('enabled: true', 'enabled: false')
    const out = mergeRuntimeFields(fixture(current).template, current)
    expect(out.mergedFields).toEqual(['session-log-deepseek.enabled'])
    expect(out.notes).toEqual([])
    expect(out.content).toContain('    enabled: false\n')
    expect(out.content).not.toContain('    enabled: true\n')
    expect(out.content).toContain("enabled: !!js process.env.DSH_OPENTUI_APPROVAL_GATE !== 'off'")
    // Only the session-log boolean differs from the template.
    expect(out.content).toBe(current)
  })

  test('mutate false → re-run provisioner → still false (merge is idempotent)', () => {
    const current = TEMPLATE.replace('enabled: true', 'enabled: false')
    const first = mergeRuntimeFields(TEMPLATE, current)
    const second = mergeRuntimeFields(first.content, first.content)
    expect(second.content).toBe(first.content)
    expect(second.content).toContain('    enabled: false\n')
    expect(second.mergedFields).toEqual([])
  })

  test('non-boolean / expression value is refused with a WARN (no !!js injection)', () => {
    const current = TEMPLATE.replace('enabled: true', 'enabled: !!js something')
    const out = mergeRuntimeFields(TEMPLATE, current)
    expect(out.content).toBe(TEMPLATE)
    expect(out.mergedFields).toEqual([])
    expect(out.notes.join(' ')).toContain('failed the boolean allow-list')
  })

  test('unchanged true default needs no merge and emits no WARN', () => {
    const out = mergeRuntimeFields(TEMPLATE, TEMPLATE)
    expect(out.content).toBe(TEMPLATE)
    expect(out.mergedFields).not.toContain('session-log-deepseek.enabled')
  })
})

describe('B1 S3 E3 — ledger-evidenced template line numbers do not shift', () => {
  // R13 and later import additions shifted this ledger-anchored block.
  // D2 appended the approval-policy insert at the END of the template, so it
  // does not move it.
  test('provision-inproc-profile.mjs:568-580 stays byte-for-byte anchored', () => {
    const src = readFileSync(SCRIPT, 'utf8').split('\n')
    const block = src.slice(567, 580).join('\n')
    expect(block).toBe([
      '# Read-only tools (read/search/glob/...) are untouched and pass via next().',
      '# Escape hatch: DSH_OPENTUI_APPROVAL_GATE=off sets enabled=false (and reverts the',
      '# preset above), restoring the old frictionless behavior. Never default to off.',
      '# See tickets/2026-11-18-approval-trigger-mechanism.md.',
      '- insert:',
      '    - id: dsh-opentui-approval-gate',
      "      name: '@aiwayds/dsh-opentui-bridge/approval-gate'",
      '      config:',
      "        enabled: !!js process.env.DSH_OPENTUI_APPROVAL_GATE !== 'off'",
      "        reason: 'Write operations require human approval'",
      '        tools:',
      '          bash: ask',
      '          write: ask',
    ].join('\n'))
  })
})
