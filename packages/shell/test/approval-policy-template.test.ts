/**
 * Contract tests for the approval-policy row embedded in the real inproc patch
 * template. The provisioner is not imported because invoking it provisions a
 * profile; extract its PATCH_TEMPLATE literal and parse that YAML instead.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseDocument } from 'yaml'

type PatchRow = {
  id?: string
  name?: string
  insert?: PatchRow[]
  config?: Record<string, unknown>
}

/** Extract and evaluate only the real backtick literal, preserving JS escapes. */
function extractRealPatchTemplate(): string {
  const source = readFileSync(
    new URL('../scripts/provision-inproc-profile.mjs', import.meta.url),
    'utf8',
  )
  const marker = 'const PATCH_TEMPLATE = `'
  const start = source.indexOf(marker)
  if (start < 0) throw new Error('PATCH_TEMPLATE not found in provision-inproc-profile.mjs')

  let cursor = start + marker.length
  let literal = ''
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === '\\') {
      literal += source.slice(cursor, cursor + 2)
      cursor += 2
      continue
    }
    if (char === '`') return new Function(`return \`${literal}\``)() as string
    literal += char
    cursor += 1
  }
  throw new Error('PATCH_TEMPLATE is missing its closing backtick')
}

const template = extractRealPatchTemplate()
const document = parseDocument(template, {
  customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
})
expect(document.errors).toEqual([])
const rows = document.toJS() as PatchRow[]
expect(Array.isArray(rows)).toBe(true)

const approvalPolicyRows = rows
  .flatMap((row) => (Array.isArray(row.insert) ? row.insert : []))
  .filter((row) => row.id === 'dsh-approval-policy')

describe('shipped inproc template: dsh-approval-policy contract', () => {
  test('the insert/config row pins the approval window to 300 seconds', () => {
    expect(approvalPolicyRows).toHaveLength(1)
    expect(approvalPolicyRows[0].name).toBe('@aiwayds/dsh-approval-policy')
    expect(approvalPolicyRows[0].config?.windowSeconds).toBe(300)
  })

  test('origins are omitted or explicitly match the plugin defaults', () => {
    expect(approvalPolicyRows).toHaveLength(1)
    const config = approvalPolicyRows[0].config
    expect(config).toBeDefined()
    expect(config?.origins).not.toEqual([])
    if (config && Object.prototype.hasOwnProperty.call(config, 'origins')) {
      expect(config.origins).toEqual(['subagent', 'scheduled'])
    }
  })

  test('comments describe the real default origins and interactive fallback', () => {
    const normalized = template.replace(/^[ \t]*#[ \t]?/gm, '').replace(/\s+/g, ' ')
    expect(normalized).not.toContain('origins 默认空')
    expect(normalized).not.toMatch(/origins[^.]*default stays empty/i)
    expect(normalized).toContain("['subagent','scheduled'] by default")
    expect(normalized).toContain('schedule is scheduled')
    expect(normalized).toContain('cron needs explicit opt-in')
    expect(normalized).toContain('human steer returns to the interactive path')
  })

  test('comments describe the window and timeout-only default outcome', () => {
    const normalized = template.replace(/^[ \t]*#[ \t]?/gm, '').replace(/\s+/g, ' ')
    expect(normalized).toContain('windowSeconds defaults to 60')
    expect(normalized).toContain('range 0-86400')
    expect(normalized).toContain('0 skips forwarding and immediately adopts defaultOutcome')
    expect(normalized).toContain("defaultOutcome (default 'rejected', or 'unavailable') applies only on timeout")
    expect(normalized).toContain('an earlier downstream outcome wins')
  })
})
