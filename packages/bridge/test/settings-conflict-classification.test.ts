/**
 * B1 N2 — settings conflict frame code (design 05 §3.4 / Q6).
 *
 * The host's SettingsConflictError has code/name but NO "conflict" word in its
 * message; the old `/conflict/i` message test mislabeled every real conflict
 * as INTERNAL, so the seam's retry-once contract never fired. These tests pin
 * the structured code/name decision and the absence of the message-regex bug.
 *
 * E4 of .proof/b1-s3-provisioner/00-preregistered-expected.md.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { classifySettingsFrameCode } from '../src/index'

describe('B1 N2 — classifySettingsFrameCode uses code/name, not message text', () => {
  test('host SETTINGS_CONFLICT code -> settings/conflict (even with no conflict word in message)', () => {
    const err = Object.assign(new Error('settings mutation failed'), { code: 'SETTINGS_CONFLICT' })
    expect(err.message).not.toMatch(/conflict/i) // the exact historical trap
    expect(classifySettingsFrameCode(err)).toBe('settings/conflict')
  })

  test('SettingsConflictError name alone -> settings/conflict', () => {
    const err = Object.assign(new Error('stale revision'), { name: 'SettingsConflictError' })
    expect(classifySettingsFrameCode(err)).toBe('settings/conflict')
  })

  test('ordinary error whose message mentions conflict -> INTERNAL (no message regex)', () => {
    expect(classifySettingsFrameCode(new Error('conflict in an unrelated subsystem'))).toBe('INTERNAL')
    expect(classifySettingsFrameCode('CONFLICT: some generic failure')).toBe('INTERNAL')
    expect(classifySettingsFrameCode(new Error('settings/conflict-like text but no code'))).toBe('INTERNAL')
  })

  test('plain error with no structured code -> INTERNAL', () => {
    expect(classifySettingsFrameCode(new Error('boom'))).toBe('INTERNAL')
    expect(classifySettingsFrameCode(undefined)).toBe('INTERNAL')
  })

  test('NOT_WIRED / unavailable keeps the existing UNSUPPORTED mapping', () => {
    expect(classifySettingsFrameCode(new Error('NOT_WIRED: settingsController unavailable'))).toBe('UNSUPPORTED')
    expect(classifySettingsFrameCode(new Error('settings service unavailable'))).toBe('UNSUPPORTED')
  })

  test('source no longer carries the /conflict/i message-regex classification', () => {
    const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('/conflict/i')
    expect(src).not.toContain("message.includes('settings/conflict')")
  })
})
