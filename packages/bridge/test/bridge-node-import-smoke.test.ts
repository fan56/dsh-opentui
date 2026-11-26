/**
 * Regression guard for the real host load path: the shipped bridge bundle is
 * loaded by `dsh` (node), not by the bun TUI. Bun tolerates named imports that
 * node rejects, so this test spawns a REAL node process to import the bundle.
 * Without a built artifact the case is an explicit skip, never a silent pass.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const SCRIPT = fileURLToPath(new URL('../../../scripts/smoke-bridge-node-import.mjs', import.meta.url))
const BUNDLE = fileURLToPath(new URL('../../shell/dist/bridge/index.js', import.meta.url))

describe('bridge bundle — real node import', () => {
  test.skipIf(!existsSync(BUNDLE))('built bundle imports under node (not bun)', () => {
    const result = spawnSync(process.env.NODE || 'node', [SCRIPT], { encoding: 'utf8' })
    if (result.error) throw result.error
    expect(result.stderr).not.toContain('SyntaxError')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('BRIDGE_NODE_IMPORT_OK')
  })
})
