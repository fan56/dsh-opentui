/**
 * D7 workspace contract — real-FS tests for ensureWorkspaceContract().
 *
 * The provisioner is imported in-process (the script's main() is guarded by
 * an entry-point check, so importing it does not provision anything). Every
 * case uses a fresh mkdtemp directory: no fs mocks, no fake timers.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BRIDGE_REPAIR_COMMAND } from '../scripts/lib/bridge-failfast-text.mjs'
import { ensureWorkspaceContract } from '../scripts/provision-inproc-profile.mjs'

const TEMPLATE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

const dirs: string[] = []
function scratch(): { dir: string, file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'workspace-contract-'))
  dirs.push(dir)
  return { dir, file: join(dir, 'pnpm-workspace.yaml') }
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

function failureText(error: unknown): string {
  const err = error as { message?: string, detail?: string }
  return `${err?.message ?? String(error)}\n${err?.detail ?? ''}`
}

function backupsIn(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith('pnpm-workspace.yaml.bak-')).sort()
}

function expectFailFast(error: unknown, file: string, key: string) {
  const text = failureText(error)
  expect(text).toContain(file)
  expect(text).toContain(key)
  expect(text).toContain('expected')
  expect(text).toContain('got')
  // Two explicit repair paths, with the command name from the shared module.
  expect(text).toContain('Repair by hand')
  expect(text).toContain('Repair with backup + rewrite')
  expect(text).toContain(BRIDGE_REPAIR_COMMAND)
}

describe('ensureWorkspaceContract — D7 pnpm-workspace.yaml', () => {
  test('missing file is written as the exact template (atomic, no leftovers)', () => {
    const { dir, file } = scratch()
    expect(ensureWorkspaceContract({ profileDir: dir })).toBe('wrote')
    expect(readFileSync(file, 'utf8')).toBe(TEMPLATE)
    expect(readdirSync(dir)).toEqual(['pnpm-workspace.yaml'])
  })

  test('conforming file with extra keys returns ok and stays byte-identical', () => {
    const { dir, file } = scratch()
    const conforming = `${TEMPLATE}allowBuilds:\n  esbuild: true\nstrictDepBuilds: true\ncustomUnknown: keep-me\n`
    writeFileSync(file, conforming)
    expect(ensureWorkspaceContract({ profileDir: dir })).toBe('ok')
    expect(readFileSync(file, 'utf8')).toBe(conforming)
  })

  test('idempotent: the second call returns ok and does not rewrite', () => {
    const { dir, file } = scratch()
    expect(ensureWorkspaceContract({ profileDir: dir })).toBe('wrote')
    const first = readFileSync(file, 'utf8')
    expect(ensureWorkspaceContract({ profileDir: dir })).toBe('ok')
    expect(readFileSync(file, 'utf8')).toBe(first)
  })

  const conflicts: Array<{ name: string, key: string, expected: string, got: string, content: string }> = [
    {
      name: 'packages does not contain "."',
      key: 'packages',
      expected: 'a string sequence containing "."',
      got: '"src"',
      content: 'packages:\n  - src\nnodeLinker: hoisted\nautoInstallPeers: false\n',
    },
    {
      name: 'nodeLinker is not hoisted',
      key: 'nodeLinker',
      expected: 'hoisted',
      got: '"pnpm"',
      content: 'packages:\n  - .\nnodeLinker: pnpm\nautoInstallPeers: false\n',
    },
    {
      name: 'autoInstallPeers is not boolean false',
      key: 'autoInstallPeers',
      expected: 'false (boolean)',
      got: 'boolean true',
      content: 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: true\n',
    },
  ]

  for (const { name, key, expected, got, content } of conflicts) {
    test(`conflict — ${name}: fail-fast with filename/key/expected/got and two repair hints`, () => {
      const { dir, file } = scratch()
      writeFileSync(file, content)
      let error: unknown
      try {
        ensureWorkspaceContract({ profileDir: dir })
      } catch (caught) {
        error = caught
      }
      expect(error).toBeDefined()
      expectFailFast(error, file, key)
      const text = failureText(error)
      expect(text).toContain(expected)
      expect(text).toContain(got)
      // A conflict must never be silently rewritten.
      expect(readFileSync(file, 'utf8')).toBe(content)
    })
  }

  const documentKey = '<document> (packages/nodeLinker/autoInstallPeers)'
  const malformed: Array<{ name: string, key: string, content: string }> = [
    { name: 'unparseable YAML', key: documentKey, content: 'packages: [\n' },
    { name: 'root is a sequence, not a mapping', key: documentKey, content: '- packages\n- nodeLinker\n' },
    { name: 'root is a scalar', key: documentKey, content: 'just-a-scalar\n' },
    { name: 'partial keys (no autoInstallPeers)', key: 'autoInstallPeers', content: 'packages:\n  - .\nnodeLinker: hoisted\n' },
    { name: 'partial keys (no packages)', key: 'packages', content: 'nodeLinker: hoisted\nautoInstallPeers: false\n' },
  ]

  for (const { name, key, content } of malformed) {
    test(`fail-fast — ${name}`, () => {
      const { dir, file } = scratch()
      writeFileSync(file, content)
      let error: unknown
      try {
        ensureWorkspaceContract({ profileDir: dir })
      } catch (caught) {
        error = caught
      }
      expect(error).toBeDefined()
      expectFailFast(error, file, key)
      expect(readFileSync(file, 'utf8')).toBe(content)
    })
  }

  test('repair=true with a missing file still writes the exact template (wrote)', () => {
    const { dir, file } = scratch()
    expect(ensureWorkspaceContract({ profileDir: dir, repair: true })).toBe('wrote')
    expect(readFileSync(file, 'utf8')).toBe(TEMPLATE)
    expect(backupsIn(dir)).toEqual([])
  })

  test('repair=true on a conflict returns repaired, backs up original bytes, and rewrites the template', () => {
    const { dir, file } = scratch()
    const content = 'packages:\n  - .\nnodeLinker: pnpm\nautoInstallPeers: false\n'
    writeFileSync(file, content)
    expect(ensureWorkspaceContract({ profileDir: dir, repair: true })).toBe('repaired')
    expect(readFileSync(file, 'utf8')).toBe(TEMPLATE)
    const backups = backupsIn(dir)
    expect(backups.length).toBe(1)
    expect(backups[0]).toMatch(/^pnpm-workspace\.yaml\.bak-\d+$/)
    expect(readFileSync(join(dir, backups[0]), 'utf8')).toBe(content)
  })

  test('a second repair=true returns ok and creates no additional backup (idempotent)', () => {
    const { dir, file } = scratch()
    writeFileSync(file, 'packages:\n  - .\nnodeLinker: pnpm\nautoInstallPeers: false\n')
    expect(ensureWorkspaceContract({ profileDir: dir, repair: true })).toBe('repaired')
    const firstBackups = backupsIn(dir)
    expect(firstBackups.length).toBe(1)
    expect(ensureWorkspaceContract({ profileDir: dir, repair: true })).toBe('ok')
    expect(backupsIn(dir)).toEqual(firstBackups)
    expect(readFileSync(file, 'utf8')).toBe(TEMPLATE)
  })

  test('repair=false keeps fail-fast on a conflict (no backup, no rewrite)', () => {
    const { dir, file } = scratch()
    const content = 'packages:\n  - .\nnodeLinker: pnpm\nautoInstallPeers: false\n'
    writeFileSync(file, content)
    let error: unknown
    try {
      ensureWorkspaceContract({ profileDir: dir, repair: false })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeDefined()
    expectFailFast(error, file, 'nodeLinker')
    expect(readFileSync(file, 'utf8')).toBe(content)
    expect(backupsIn(dir)).toEqual([])
  })

  for (const { name, content } of [...conflicts, ...malformed]) {
    test(`repair=true recovers every conflict category — ${name}`, () => {
      const { dir, file } = scratch()
      writeFileSync(file, content)
      expect(ensureWorkspaceContract({ profileDir: dir, repair: true })).toBe('repaired')
      expect(readFileSync(file, 'utf8')).toBe(TEMPLATE)
      const backups = backupsIn(dir)
      expect(backups.length).toBe(1)
      expect(readFileSync(join(dir, backups[0]), 'utf8')).toBe(content)
    })
  }

  test('repair=true emits a WARN naming the backup path', () => {
    const { dir, file } = scratch()
    writeFileSync(file, 'packages:\n  - .\nnodeLinker: pnpm\nautoInstallPeers: false\n')
    const original = console.error
    const lines: string[] = []
    console.error = (...args: unknown[]) => { lines.push(args.join(' ')) }
    try {
      expect(ensureWorkspaceContract({ profileDir: dir, repair: true })).toBe('repaired')
    } finally {
      console.error = original
    }
    const backup = backupsIn(dir)[0]
    expect(lines.join('\n')).toContain('WARN')
    expect(lines.join('\n')).toContain(backup)
  })
})
