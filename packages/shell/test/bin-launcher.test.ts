// Pure logic behind bin/dsh-opentui.mjs's --version/--force flags, plus one
// real-process integration check that `--version` short-circuits the bin
// before any provision/profile/TUI work. No dsh, no profile, no signals:
// kill semantics run against injected fakes; ps parsing runs against both
// synthetic output and the real `ps` on this machine.
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ancestorPids,
  classifyProcess,
  defaultDshHome,
  killStaleProcesses,
  parseLauncherArgs,
  parseProcessHomes,
  parseProcessRows,
  readLauncherVersion,
  selectStaleProcesses,
} from '../bin/lib/launcher.mjs'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const binPath = join(pkgRoot, 'bin', 'dsh-opentui.mjs')
const pkgVersion = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version

describe('parseLauncherArgs', () => {
  test('consumes --version and --force, forwards the rest', () => {
    expect(parseLauncherArgs(['--version'])).toEqual({ version: true, force: false, rest: [] })
    expect(parseLauncherArgs(['--force'])).toEqual({ version: false, force: true, rest: [] })
    expect(parseLauncherArgs(['--force', '--version'])).toEqual({ version: true, force: true, rest: [] })
    expect(parseLauncherArgs(['--model', 'x', '--force', 'prompt'])).toEqual({
      version: false,
      force: true,
      rest: ['--model', 'x', 'prompt'],
    })
  })

  test('leaves unrelated arguments (including lookalikes) untouched', () => {
    expect(parseLauncherArgs(['--model', '--version-like', '--forced'])).toEqual({
      version: false,
      force: false,
      rest: ['--model', '--version-like', '--forced'],
    })
    expect(parseLauncherArgs([])).toEqual({ version: false, force: false, rest: [] })
  })
})

describe('readLauncherVersion', () => {
  test('reads the package manifest version', () => {
    expect(readLauncherVersion(pkgRoot)).toBe(pkgVersion)
  })

  test('undefined for a missing/unreadable manifest (no lying output)', () => {
    expect(readLauncherVersion(join(pkgRoot, 'test', 'fixtures', 'no-such-dir'))).toBeUndefined()
  })
})

describe('parseProcessRows', () => {
  test('parses pid/ppid/command rows and skips non-row lines', () => {
    const rows = parseProcessRows('  PID  PPID COMMAND\n 42 1 /sbin/launchd\nbad line\n 99 42 node dsh --profile opentui\n')
    expect(rows).toEqual([
      { pid: 42, ppid: 1, command: '/sbin/launchd' },
      { pid: 99, ppid: 42, command: 'node dsh --profile opentui' },
    ])
  })

  test('parses the real ps output and finds this process', () => {
    const out = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
    const rows = parseProcessRows(out.stdout)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((row) => row.pid === process.pid)).toBe(true)
  })
})

describe('parseProcessHomes', () => {
  test('maps pid -> DSH_HOME using the LAST occurrence (env trails the command)', () => {
    const homes = parseProcessHomes(
      [
        '11 bun run thing DSH_HOME=/tmp/a',
        '12 node dsh --profile opentui DSH_HOME=/tmp/b',
        '13 node DSH_HOME=/cmd/line DSH_HOME=/the/env',
      ].join('\n'),
    )
    expect(homes.get(11)).toBe('/tmp/a')
    expect(homes.get(12)).toBe('/tmp/b')
    expect(homes.get(13)).toBe('/the/env')
  })

  test('a pid without DSH_HOME in its environment maps to undefined', () => {
    const homes = parseProcessHomes('21 node dsh --profile opentui\n\nnot a row')
    expect(homes.get(21)).toBeUndefined()
  })
})

describe('classifyProcess', () => {
  test('the opentui host in its real-world shapes', () => {
    expect(classifyProcess('node /opt/homebrew/bin/dsh --profile opentui --no-open --port 50657')).toBe('host')
    expect(classifyProcess('dsh --profile opentui')).toBe('host')
    expect(classifyProcess('dsh --profile=opentui')).toBe('host')
    expect(classifyProcess('bun /usr/local/bin/dsh --profile opentui --port 1')).toBe('host')
  })

  test('provision children, other profiles and mere mentions are NOT the host', () => {
    expect(classifyProcess('node /opt/homebrew/bin/dsh plugin --profile opentui add @aiwayds/x')).toBeNull()
    expect(classifyProcess('dsh opentui --dump-config')).toBeNull()
    expect(classifyProcess('dsh --profile default')).toBeNull()
    // a wrapper script that only MENTIONS dsh in its own argv
    expect(classifyProcess('node wrapper.js dsh --profile opentui')).toBeNull()
    // shells / tools whose command line references the profile
    expect(classifyProcess('zsh -c env DSH_HOME=/x dsh-opentui --force')).toBeNull()
    expect(classifyProcess('grep --profile opentui logs.txt')).toBeNull()
    expect(classifyProcess('tmux new-session -d -s x dsh --profile opentui')).toBeNull()
  })

  test('clients: source entry and published bundle', () => {
    expect(classifyProcess('bun --preload x/preload.js /repo/packages/shell/src/client-entry.tsx --client')).toBe('client')
    expect(classifyProcess('bun /opt/homebrew/lib/node_modules/@aiwayds/dsh-opentui/dist/client/index.js')).toBe('client')
  })
})

describe('selectStaleProcesses', () => {
  const rows = [
    { pid: 10, ppid: 1, command: 'node /opt/homebrew/bin/dsh --profile opentui --no-open --port 1' },
    { pid: 11, ppid: 1, command: 'bun /x/dist/client/index.js' },
    { pid: 12, ppid: 1, command: 'node /opt/homebrew/bin/dsh --profile other --no-open --port 2' },
    { pid: 13, ppid: 1, command: 'node /opt/homebrew/bin/dsh --profile opentui --no-open --port 3' },
    { pid: 14, ppid: 1, command: 'bun --preload p /repo/src/client-entry.tsx' },
  ]

  test('keeps same-home host+client, drops other profile and other home', () => {
    const homes = new Map([
      [10, '/tmp/mine'],
      [11, '/tmp/mine'],
      [13, '/tmp/theirs'],
      [14, '/tmp/theirs'],
    ])
    const stale = selectStaleProcesses(rows, { homes, home: '/tmp/mine' })
    expect(stale).toEqual([
      { pid: 10, kind: 'host' },
      { pid: 11, kind: 'client' },
    ])
  })

  test('a candidate without readable env counts as the default home', () => {
    const stale = selectStaleProcesses(rows, { homes: new Map(), home: defaultDshHome() })
    expect(stale.map((s) => s.pid)).toEqual([10, 11, 13, 14])
  })

  test('excluded pids are never selected', () => {
    const stale = selectStaleProcesses(rows, {
      homes: new Map([
        [10, '/tmp/mine'],
        [11, '/tmp/mine'],
      ]),
      home: '/tmp/mine',
      excludePids: [10],
    })
    expect(stale).toEqual([{ pid: 11, kind: 'client' }])
  })
})

describe('ancestorPids', () => {
  test('walks the ppid chain and never loops', () => {
    const rows = [
      { pid: 5, ppid: 4, command: '' },
      { pid: 4, ppid: 1, command: '' },
      { pid: 1, ppid: 1, command: '' },
    ]
    expect(ancestorPids(rows, 5)).toEqual([5, 4, 1])
  })
})

describe('killStaleProcesses (injected kill/sleep/isAlive)', () => {
  test('no targets is a no-op', async () => {
    const r = await killStaleProcesses([])
    expect(r).toEqual({ terminated: 0, killed: 0, survivors: [] })
  })

  test('TERM path: everything dies within the grace window', async () => {
    const alive = new Set([101, 102])
    const signals: Array<[number, string]> = []
    const r = await killStaleProcesses([{ pid: 101, kind: 'host' }, { pid: 102, kind: 'client' }], {
      kill: (pid, sig) => {
        signals.push([pid, sig])
        alive.delete(pid)
      },
      sleep: () => Promise.resolve(),
      isAlive: (pid) => alive.has(pid),
    })
    expect(signals).toEqual([
      [101, 'SIGTERM'],
      [102, 'SIGTERM'],
    ])
    expect(r).toEqual({ terminated: 2, killed: 0, survivors: [] })
  })

  test('stubborn survivor gets SIGKILL after the TERM window', async () => {
    const alive = new Set([201, 202])
    const signals: Array<[number, string]> = []
    const r = await killStaleProcesses([{ pid: 201, kind: 'host' }, { pid: 202, kind: 'client' }], {
      kill: (pid, sig) => {
        signals.push([pid, sig])
        if (sig === 'SIGKILL') alive.delete(pid) // only KILL lands on 202
        if (pid === 201) alive.delete(pid)
      },
      sleep: () => Promise.resolve(),
      isAlive: (pid) => alive.has(pid),
      termWaitMs: 0,
      killWaitMs: 0,
      pollMs: 1,
    })
    expect(signals).toContainEqual([202, 'SIGKILL'])
    expect(r.terminated).toBe(2)
    expect(r.killed).toBe(1)
    expect(r.survivors).toEqual([])
  })
})

describe('bin integration: --version short-circuits the startup chain', () => {
  const cases: Array<Array<string>> = [
    ['--version'],
    ['--force', '--version'],
    ['--model', 'm', '--version'],
  ]
  for (const args of cases) {
    test(`node bin/dsh-opentui.mjs ${args.join(' ')} prints exactly one version line and exits 0`, () => {
      const r = spawnSync('node', [binPath, ...args], { encoding: 'utf8', timeout: 30_000 })
      expect(r.status).toBe(0)
      expect(r.stdout).toBe(`dsh-opentui ${pkgVersion}\n`)
      // proves the short-circuit: provision output, SDK linking and the TUI
      // all print/log before or instead of this line
      expect(r.stderr).toBe('')
    })
  }

  test('--version output contains no provision step lines', () => {
    const r = spawnSync('node', [binPath, '--version'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.stdout).not.toContain('provision')
    expect(r.stdout).not.toContain('[1/5]')
  })
})
