// Pure logic behind bin/dsh-opentui.mjs's --version/--force flags, plus one
// real-process integration check that `--version` short-circuits the bin
// before any provision/profile/TUI work. No dsh, no profile, no signals:
// kill semantics run against injected fakes; ps parsing runs against both
// synthetic output and the real `ps` on this machine.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { constants as osConstants, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ancestorPids,
  classifyProcess,
  defaultDshHome,
  formatUsage,
  KNOWN_CLIENT_ARGS,
  killStaleProcesses,
  launcherFlagConflict,
  parseLauncherArgs,
  parseLauncherOptions,
  parseProcessHomes,
  parseProcessRows,
  readLauncherVersion,
  selectStaleProcesses,
  validateLauncherArgs,
} from '../bin/lib/launcher.mjs'
import { CLI_LAUNCH_FLAGS } from '../../tui-base/src/routes/session/auto-resume.ts'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const binPath = join(pkgRoot, 'bin', 'dsh-opentui.mjs')
const pkgVersion = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version
const RESERVED_FLAGS_WARNING = 'dsh-opentui: --force/--yes is reserved but not wired in this build; no processes were killed or reset.'

describe('parseLauncherArgs', () => {
  test('consumes --version and --force, forwards the rest', () => {
    expect(parseLauncherArgs(['--version'])).toEqual({ version: true, force: false, repairBridge: false, yes: false, rest: [], passthrough: [] })
    expect(parseLauncherArgs(['--force'])).toEqual({ version: false, force: true, repairBridge: false, yes: false, rest: [], passthrough: [] })
    expect(parseLauncherArgs(['--force', '--version'])).toEqual({ version: true, force: true, repairBridge: false, yes: false, rest: [], passthrough: [] })
    expect(parseLauncherArgs(['--model', 'x', '--force', 'prompt'])).toEqual({
      version: false,
      force: true,
      repairBridge: false,
      yes: false,
      rest: ['--model', 'x', 'prompt'],
      passthrough: [],
    })
  })

  test('consumes --yes (confirm flag) and never forwards it', () => {
    expect(parseLauncherArgs(['--force', '--yes'])).toEqual({ version: false, force: true, repairBridge: false, yes: true, rest: [], passthrough: [] })
    expect(parseLauncherArgs(['--yes', '--model', 'x'])).toEqual({
      version: false, force: false, repairBridge: false, yes: true, rest: ['--model', 'x'], passthrough: [],
    })
    expect(parseLauncherArgs(['--yes', '--', '--yes']).passthrough).toEqual(['--yes'])
  })

  test('treats -v as an alias for --version', () => {
    expect(parseLauncherArgs(['-v'])).toEqual({ version: true, force: false, repairBridge: false, yes: false, rest: [], passthrough: [] })
    expect(parseLauncherArgs(['--force', '-v'])).toEqual({ version: true, force: true, repairBridge: false, yes: false, rest: [], passthrough: [] })
  })

  test('leaves unrelated arguments (including lookalikes) untouched', () => {
    expect(parseLauncherArgs(['--model', '--version-like', '--forced'])).toEqual({
      version: false,
      force: false,
      repairBridge: false,
      yes: false,
      rest: ['--model', '--version-like', '--forced'],
      passthrough: [],
    })
    expect(parseLauncherArgs([])).toEqual({ version: false, force: false, repairBridge: false, yes: false, rest: [], passthrough: [] })
  })

  test('consumes --repair-bridge as a bin-level flag, forwarding the rest', () => {
    expect(parseLauncherArgs(['--repair-bridge'])).toEqual({
      version: false,
      force: false,
      repairBridge: true,
      yes: false,
      rest: [],
      passthrough: [],
    })
    expect(parseLauncherArgs(['--model', 'x', '--repair-bridge', 'prompt'])).toEqual({
      version: false,
      force: false,
      repairBridge: true,
      yes: false,
      rest: ['--model', 'x', 'prompt'],
      passthrough: [],
    })
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
    ['-v'],
    ['--force', '--version'],
    ['--model', 'm', '--version'],
    ['-v', '--', '--whatever'],
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

  test('-v output contains no provision step lines', () => {
    const r = spawnSync('node', [binPath, '-v'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe(`dsh-opentui ${pkgVersion}\n`)
    expect(r.stdout).not.toContain('provision')
    expect(r.stdout).not.toContain('[1/5]')
  })
})

describe('parseLauncherArgs -- separator', () => {
  test('everything after the first standalone -- goes to passthrough verbatim', () => {
    expect(
      parseLauncherArgs(['--model', 'm', '--', '--version', '--force', '--verison', 'plain']),
    ).toEqual({
      version: false,
      force: false,
      repairBridge: false,
      yes: false,
      rest: ['--model', 'm'],
      passthrough: ['--version', '--force', '--verison', 'plain'],
    })
  })

  test('a bare -- has an empty passthrough; a second -- is itself passthrough', () => {
    expect(parseLauncherArgs(['--']).passthrough).toEqual([])
    expect(parseLauncherArgs(['--', '--']).passthrough).toEqual(['--'])
  })

  test('passthrough is an empty array when no separator is present', () => {
    expect(parseLauncherArgs(['--force']).passthrough).toEqual([])
    expect(parseLauncherArgs([]).passthrough).toEqual([])
  })

  test('-v after -- is passthrough, never a version flag', () => {
    const result = parseLauncherArgs(['--', '-v'])
    expect(result.version).toBe(false)
    expect(result.passthrough).toContain('-v')
  })

  test('-h and --help after -- are passthrough, never interpreted as help', () => {
    expect(parseLauncherArgs(['--', '-h', '--help']).passthrough).toEqual(['-h', '--help'])
  })

  test('--repair-bridge after -- is passthrough, never a repair flag', () => {
    const result = parseLauncherArgs(['--', '--repair-bridge'])
    expect(result.repairBridge).toBe(false)
    expect(result.passthrough).toEqual(['--repair-bridge'])
  })
})

describe('--remote removal (0.23.0)', () => {
  test('is no longer in the allowlist and is rejected as an unknown flag', () => {
    expect(KNOWN_CLIENT_ARGS).not.toContain('--remote')
    const result = validateLauncherArgs(['--remote'])
    expect(result.unknown).toEqual(['--remote'])
    // No known flag is within edit distance 2 of "--remote", so the generic
    // did-you-mean rule correctly declines to suggest a misleading neighbour.
    expect(result.suggestion).toBeUndefined()
    expect(validateLauncherArgs(['--remote', '--new']).unknown).toEqual(['--remote'])
  })

  test('-- --remote stays passthrough and is never validated', () => {
    expect(parseLauncherArgs(['--', '--remote']).passthrough).toEqual(['--remote'])
    expect(validateLauncherArgs(['--', '--remote']).unknown).toEqual([])
  })

  test('the did-you-mean unknown-flag path still works after the removal', () => {
    const result = validateLauncherArgs(['--verison'])
    expect(result.unknown).toEqual(['--verison'])
    expect(result.suggestion).toBe('--version')
  })

  test('bin integration: --remote exits 2 as an unknown option, no notice, no provisioning', () => {
    const r = spawnSync('node', [binPath, '--remote'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain("dsh-opentui: unknown option '--remote'")
    // S6: --remote is a plain unknown option — its one-time migration hint is
    // gone with the env escape hatch it pointed to.
    expect(r.stderr).not.toContain('migration advice')
    expect(r.stderr).not.toContain('deprecated')
    expect(r.stderr).not.toContain('[1/5]')
    expect(r.stderr).not.toContain('[1/7]')
  })
})

describe('P3-3 flag-combination conflicts', () => {
  test('--repair-bridge + --force is an explicit mutually-exclusive reject', () => {
    expect(launcherFlagConflict({ force: true, repairBridge: true, yes: false })).toBe('repair-force')
    expect(launcherFlagConflict({ force: true, repairBridge: true, yes: true })).toBe('repair-force')
  })

  test('--yes without --force is rejected, but --repair-bridge --yes is the kill confirmation', () => {
    expect(launcherFlagConflict({ force: false, repairBridge: false, yes: true })).toBe('yes-without-force')
    // Under --repair-bridge, --yes is intentionally allowed through.
    expect(launcherFlagConflict({ force: false, repairBridge: true, yes: true })).toBeNull()
  })

  test('benign combinations do not conflict', () => {
    expect(launcherFlagConflict({ force: false, repairBridge: false, yes: false })).toBeNull()
    expect(launcherFlagConflict({ force: true, repairBridge: false, yes: true })).toBeNull()
    expect(launcherFlagConflict({ force: true, repairBridge: false, yes: false })).toBeNull()
  })

  test('bin integration: conflicting combos exit 2 with a human-readable message', () => {
    for (const [args, needle] of [
      [['--repair-bridge', '--force'], 'mutually exclusive'],
      [['--yes'], 'only meaningful together with --force'],
    ] as const) {
      const r = spawnSync('node', [binPath, ...args], { encoding: 'utf8', timeout: 30_000 })
      expect(r.status).toBe(2)
      expect(r.stderr).toContain(needle)
    }
  })

  test('bin integration: --yes alone warns once and keeps the existing usage exit code', () => {
    const r = spawnSync('node', [binPath, '--yes'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('dsh-opentui: --yes is only meaningful together with --force.')
    expect(r.stderr.split('\n').filter((line) => line === RESERVED_FLAGS_WARNING)).toHaveLength(1)
    expect(r.stderr).not.toContain('[1/5]')
  })

  test('bin integration: --repair-bridge with upgrade prints a skip notice, still runs upgrade help', () => {
    const r = spawnSync('node', [binPath, '--repair-bridge', 'upgrade', '--help'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('--repair-bridge is skipped')
    expect(r.stdout).toContain('Usage: dsh-opentui upgrade')
  })
})

describe('formatUsage', () => {
  test('documents every launcher option, client options and the exit codes', () => {
    const usage = formatUsage()
    for (const flag of [
      '-v, --version',
      '--force',
      '--yes',
      '--repair-bridge',
      '--boot-timeout <sec>',
      '--mux-timeout <sec>',
      '--connect-timeout <sec>',
      '--provider <name>',
      '--model <name>',
      '--reasoning-effort <level>',
      '--plugins <tier>',
      '--dry-run',
      '-h, --help',
    ]) {
      expect(usage).toContain(flag)
    }
    expect(usage).toContain('Usage: dsh-opentui [options] [-- <client args>]')
    expect(usage).toContain('Client options')
    expect(usage).toContain('--new, --resume-last, --session <id>')
    for (const code of ['  0  ', '  1  ', '  2  ']) expect(usage).toContain(code)

    // --boot-timeout is scoped to the cold start; /reload keeps its own 30s.
    expect(usage).toContain('seconds to wait for the host to cold-start (default: 30; /reload keeps its own 30s)')
    // The env contract and its precedence are documented, not implied.
    expect(usage).toContain('Environment:')
    for (const env of [
      'DSH_OPENTUI_BOOT_TIMEOUT_MS',
      'DSH_OPENTUI_MUX_TIMEOUT_MS',
      'DSH_OPENTUI_CONNECT_TIMEOUT_MS',
    ]) {
      expect(usage).toContain(env)
    }
    expect(usage).toContain('CLI flag > environment variable > default')
    // S6: help advertises neither the removed --remote flag nor the deleted
    // env escape hatch (same assertion class as the --remote one).
    expect(usage).not.toContain('DSH_OPENTUI_INPROC')
    expect(usage).not.toContain('--remote')
    // P1-A: the in-process-only build reserves these flags without promising
    // the retired singleton-host reset or a dry-run-only exception.
    expect(usage).not.toContain('reset the singleton host')
    expect(usage).toContain('reserved in this in-process-only build; currently does not kill or reset anything')
    expect(usage).toContain('currently does not confirm or perform any kill/reset')
    // Exit codes are honest: provisioning failures are WARNs, not exit 1, and
    // the client's own code is passed through.
    expect(usage).toContain('  1  launcher startup failure')
    expect(usage).toContain("  other  the client's own exit code is passed through (e.g. 130 on SIGINT)")
    expect(usage).not.toContain('host failed to boot')
    expect(usage).not.toContain('provisioning failed')

    // The upgrade subcommand has its own, separate usage text.
    expect(usage).not.toContain('Usage: dsh-opentui upgrade')
  })
})

describe('parseLauncherOptions', () => {
  test('accepts space and equals forms for all three flags', () => {
    expect(
      parseLauncherOptions([
        '--boot-timeout',
        '45',
        '--mux-timeout=20',
        '--connect-timeout',
        '90',
      ]),
    ).toEqual({
      bootTimeoutSec: 45,
      muxTimeoutSec: 20,
      connectTimeoutSec: 90,
      error: null,
    })
  })

  test('a missing value is reported with the offending flag', () => {
    const missing = parseLauncherOptions(['--boot-timeout'])
    expect(missing.error).toBe('missing-value')
    expect(missing.errorFlag).toBe('--boot-timeout')
    expect(parseLauncherOptions(['--mux-timeout', '--force']).error).toBe('missing-value')
    expect(parseLauncherOptions(['--connect-timeout=']).error).toBe('missing-value')
  })

  test('invalid and out-of-range values carry the original value', () => {
    const bad = parseLauncherOptions(['--mux-timeout', 'abc'])
    expect(bad.error).toBe('invalid-value')
    expect(bad.errorFlag).toBe('--mux-timeout')
    expect(bad.errorValue).toBe('abc')
    expect(parseLauncherOptions(['--connect-timeout=0']).error).toBe('invalid-value')
    expect(parseLauncherOptions(['--connect-timeout=3601']).error).toBe('invalid-value')
    expect(parseLauncherOptions(['--connect-timeout=3600']).error).toBe(null)
    expect(parseLauncherOptions(['--boot-timeout=1']).error).toBe(null)
  })

  test('a negative number is an invalid value, not a missing one', () => {
    const bad = parseLauncherOptions(['--boot-timeout', '-5'])
    expect(bad.error).toBe('invalid-value')
    expect(bad.errorFlag).toBe('--boot-timeout')
    expect(bad.errorValue).toBe('-5')
    // The inline form reports the same thing.
    const inline = parseLauncherOptions(['--boot-timeout=-5'])
    expect(inline.error).toBe('invalid-value')
    expect(inline.errorValue).toBe('-5')
    // A flag-looking token is still a genuinely missing value.
    expect(parseLauncherOptions(['--boot-timeout', '--force']).error).toBe('missing-value')
    expect(parseLauncherOptions(['--boot-timeout', '-x']).error).toBe('missing-value')
  })

  test('the last occurrence of a flag wins', () => {
    expect(parseLauncherOptions(['--boot-timeout', '10', '--boot-timeout=20']).bootTimeoutSec).toBe(20)
    expect(parseLauncherOptions(['--mux-timeout', '5', '--mux-timeout', '8']).muxTimeoutSec).toBe(8)
  })
})

describe('validateLauncherArgs', () => {
  test('allowlisted provision and client flags plus values and positionals pass', () => {
    const result = validateLauncherArgs([
      '--provider',
      'p',
      '--model',
      'm',
      '--reasoning-effort',
      'high',
      '--plugins',
      'core',
      '--dry-run',
      '--new',
      '--resume-last',
      '--session',
      's1',
      'positional',
    ])
    expect(result.unknown).toEqual([])
  })

  test('inline --plugins= and --session= forms pass', () => {
    expect(validateLauncherArgs(['--plugins=none', '--session=x']).unknown).toEqual([])
  })

  test('inline --provider=, --model= and --reasoning-effort= forms pass', () => {
    const result = validateLauncherArgs(['--provider=x', '--model=y', '--reasoning-effort=high'])
    expect(result.unknown).toEqual([])
  })

  test('a value-taking flag consumes the next token even when it starts with -', () => {
    for (const flag of ['--session', '--provider', '--model', '--reasoning-effort', '--plugins']) {
      expect(validateLauncherArgs([flag, '-x']).unknown).toEqual([])
    }
  })

  test('a known flag after a value-taking flag is not consumed as its value', () => {
    expect(validateLauncherArgs(['--session', '--new']).unknown).toEqual([])
    // --plugins was validated on its own: it consumed its own -x value rather
    // than being swallowed by --session (which would leave -x unknown).
    expect(validateLauncherArgs(['--session', '--plugins', '-x']).unknown).toEqual([])
  })

  test('a single-character unknown flag is reported without a misleading suggestion', () => {
    const result = validateLauncherArgs(['-x'])
    expect(result.unknown).toEqual(['-x'])
    expect(result.suggestion).toBeUndefined()
    expect(result.suggestions['-x']).toBeUndefined()
  })

  test('an unknown flag is reported with a spelling suggestion', () => {
    const result = validateLauncherArgs(['--verison'])
    expect(result.unknown).toEqual(['--verison'])
    expect(result.suggestion).toBe('--version')
    expect(result.suggestions['--verison']).toBe('--version')
  })

  test('multiple unknowns are each reported and suggested independently', () => {
    const result = validateLauncherArgs(['--verison', '--forc', '--new'])
    expect(result.unknown).toEqual(['--verison', '--forc'])
    expect(result.suggestions['--verison']).toBe('--version')
    expect(result.suggestions['--forc']).toBe('--force')
  })

  test('nothing after a standalone -- is validated', () => {
    expect(validateLauncherArgs(['--verison', '--', '--bogus']).unknown).toEqual(['--verison'])
  })

  test('flags consumed by the launcher can be skipped', () => {
    expect(
      validateLauncherArgs(['--boot-timeout', '45', '--verison'], {
        skip: ['--boot-timeout'],
      }).unknown,
    ).toEqual(['--verison'])
  })

  test('the client launch flags stay inside the exported allowlist', () => {
    for (const flag of CLI_LAUNCH_FLAGS) expect(KNOWN_CLIENT_ARGS).toContain(flag)
  })
})

describe('bin integration: usage errors fail before provisioning', () => {
  test('--help prints the launcher usage and exits 0 without provisioning', () => {
    const r = spawnSync('node', [binPath, '--help'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    expect(r.stdout).toContain('Usage: dsh-opentui [options] [-- <client args>]')
    expect(r.stdout).toContain('reserved in this in-process-only build; currently does not kill or reset anything')
    expect(r.stdout).not.toContain('reset the singleton host')
    expect(r.stdout).not.toContain('[1/5]')
  })

  test('--verison fails with a suggestion, no provisioning output', () => {
    const r = spawnSync('node', [binPath, '--verison'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain("dsh-opentui: unknown option '--verison'")
    expect(r.stderr).toContain("dsh-opentui: did you mean '--version'?")
    expect(r.stderr).not.toContain('[1/5]')
  })

  test('-x is rejected as unknown without a misleading did-you-mean hint', () => {
    const r = spawnSync('node', [binPath, '-x'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain("dsh-opentui: unknown option '-x'")
    expect(r.stderr).not.toContain('did you mean')
    expect(r.stderr).not.toContain('[1/5]')
  })

  test('--boot-timeout -5 is an invalid value, not a missing one', () => {
    const r = spawnSync('node', [binPath, '--boot-timeout', '-5'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain("dsh-opentui: invalid value '-5' for '--boot-timeout' (expected 1-3600 seconds)")
    expect(r.stderr).not.toContain('requires a value')
  })

  test('an invalid timeout fails with the value and the valid range', () => {
    const r = spawnSync('node', [binPath, '--boot-timeout=0'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain("dsh-opentui: invalid value '0' for '--boot-timeout' (expected 1-3600 seconds)")
  })

  test('a missing timeout value names the flag', () => {
    const r = spawnSync('node', [binPath, '--mux-timeout'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain("dsh-opentui: option '--mux-timeout' requires a value")
  })
})

// ---- bin integration: async client spawn exit mapping (PR B) -------------
// Exercise the launcher's real `spawn('bun', …)` path end to end. To avoid a
// real host (and any dependence on a globally installed dsh), copy the bin +
// its lib into a throwaway package root, stub the two filesystem gates
// (dist/client/index.js and the SDK link), put a fake `dsh` and a controllable
// fake `bun` first on PATH, and pass `--dry-run` (there is no HTTP host
// pre-launch any more; the flag is simply forwarded). The subject under test
// is the launcher's exit-code mapping of the child's outcome, so only the
// fake bun's exit code / signal death matters.
function makeAsyncLauncherHarness() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-launcher-async-'))
  const tmpBinDir = join(root, 'bin')
  mkdirSync(join(tmpBinDir, 'lib'), { recursive: true })
  cpSync(binPath, join(tmpBinDir, 'dsh-opentui.mjs'))
  cpSync(join(pkgRoot, 'bin', 'lib', 'launcher.mjs'), join(tmpBinDir, 'lib', 'launcher.mjs'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@aiwayds/dsh-opentui', version: pkgVersion }))
  // S6: provisioning is unconditional (no env hatch to skip it). Copy the
  // scripts/ tree + a real dist/bridge so the launcher's step-3b provisioning
  // passes; the subject (fake-bun exit-code mapping) is unchanged.
  cpSync(join(pkgRoot, 'scripts'), join(root, 'scripts'), { recursive: true })
  cpSync(join(pkgRoot, 'dist', 'bridge'), join(root, 'dist', 'bridge'), { recursive: true })
  // Step 6 existsSync gate — fake bun ignores the bundle contents.
  mkdirSync(join(root, 'dist', 'client'), { recursive: true })
  writeFileSync(join(root, 'dist', 'client', 'index.js'), '')
  // ensureClientConnectionSdk() returns early when this package.json exists.
  const sdkDir = join(root, 'node_modules', '@deepseek-ai', 'dsh-client-connection')
  mkdirSync(sdkDir, { recursive: true })
  writeFileSync(join(sdkDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-connection', version: '0.0.0' }))
  // The copied scripts/ tree imports `yaml` and `@deepseek-ai/cordis`; link
  // them from this package's installed node_modules so step-3b provisioning
  // resolves them (the throwaway root has no manifest deps of its own).
  symlinkSync(join(pkgRoot, 'node_modules', 'yaml'), join(root, 'node_modules', 'yaml'), 'dir')
  symlinkSync(join(pkgRoot, 'node_modules', '@deepseek-ai', 'cordis'), join(root, 'node_modules', '@deepseek-ai', 'cordis'), 'dir')

  const shimDir = join(root, 'shim')
  mkdirSync(shimDir)
  const dshShim = join(shimDir, 'dsh')
  writeFileSync(dshShim, '#!/bin/sh\nexit 0\n')
  chmodSync(dshShim, 0o755)
  const bunShim = join(shimDir, 'bun')

  const dshHome = join(root, 'dsh-home')
  mkdirSync(dshHome)
  return {
    root,
    launcherBin: join(tmpBinDir, 'dsh-opentui.mjs'),
    // S6: scripts/ + dist/bridge are copied above so the unconditional
    // provisioning passes; the host-version override avoids spawning the fake
    // `dsh` for version detection. Subject remains fake-bun exit-code mapping.
    // Companions are not the subject of these exit-code tests. The existing
    // master switch keeps provisioning offline here (no real `npm view`), so a
    // slow registry cannot push the 4-launch case past bun's 5s per-test limit.
    env: {
      ...process.env,
      PATH: `${shimDir}:${process.env.PATH}`,
      DSH_HOME: dshHome,
      DSH_OPENTUI_HOST_VERSION: '0.2.2-rc.3',
      DSH_OPENTUI_COMPANION_LATEST: 'off',
    },
    setBunShim(body: string) {
      writeFileSync(bunShim, `#!/bin/sh\n${body}\n`)
      chmodSync(bunShim, 0o755)
    },
  }
}

function runAsyncLauncher(h: ReturnType<typeof makeAsyncLauncherHarness>, args: string[] = []) {
  return spawnSync('node', [h.launcherBin, '--dry-run', ...args], { encoding: 'utf8', timeout: 30_000, env: h.env })
}

describe('bin integration: async client spawn maps child exit code / signal (PR B)', () => {
  let h: ReturnType<typeof makeAsyncLauncherHarness>
  beforeEach(() => { h = makeAsyncLauncherHarness() })
  afterEach(() => { rmSync(h.root, { recursive: true, force: true }) })

  test('reserved --force/--yes warn once without changing the client exit code', () => {
    h.setBunShim('exit 42')
    // --yes is valid only with --force on the normal launch path. Supplying
    // both (in either order) must still produce exactly one warning.
    for (const args of [[], ['--force'], ['--force', '--yes'], ['--yes', '--force']]) {
      const r = runAsyncLauncher(h, args)
      expect(r.error).toBeUndefined()
      expect(r.status).toBe(42)
      const warnings = r.stderr.split('\n').filter((line) => line === RESERVED_FLAGS_WARNING)
      expect(warnings).toHaveLength(args.length === 0 ? 0 : 1)
    }
  })

  test('launcher exits with the fake bun shim exit code', () => {
    h.setBunShim('exit 42')
    const r = runAsyncLauncher(h)
    expect(r.error).toBeUndefined()
    expect(r.status).toBe(42)
  })

  test('launcher exits 128 + SIGTERM when fake bun kills itself with SIGTERM', () => {
    h.setBunShim('kill -TERM $$')
    const r = runAsyncLauncher(h)
    expect(r.error).toBeUndefined()
    // 128 + 15 = 143 on POSIX; SIGKILL used to be mis-reported as 0.
    expect(r.status).toBe(128 + osConstants.signals.SIGTERM)
    expect(r.status).toBe(143)
  })
})
