// Pure logic behind bin/dsh-opentui.mjs's --version/--force flags, plus one
// real-process integration check that `--version` short-circuits the bin
// before any provision/profile/TUI work. No dsh, no profile, no signals:
// kill semantics run against injected fakes; ps parsing runs against both
// synthetic output and the real `ps` on this machine.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { constants as osConstants, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ancestorPids,
  classifyProcess,
  defaultDshHome,
  emitRemoteDeprecation,
  formatUsage,
  isRemoteRequested,
  KNOWN_CLIENT_ARGS,
  killStaleProcesses,
  launcherFlagConflict,
  parseLauncherArgs,
  REMOTE_DEPRECATION_NOTICE,
  parseLauncherOptions,
  parseProcessHomes,
  parseProcessRows,
  prelaunchFailurePolicy,
  readLauncherVersion,
  selectStaleProcesses,
  validateLauncherArgs,
} from '../bin/lib/launcher.mjs'
import { CLI_LAUNCH_FLAGS } from '../../tui-base/src/routes/session/auto-resume.ts'
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_READINESS_TIMEOUT_MS,
  DEFAULT_SERVE_PROBE_BUDGET_MS,
  ENV_BOOT_TIMEOUT_MS,
  ENV_CONNECT_TIMEOUT_MS,
  ENV_MUX_TIMEOUT_MS,
  resolveBootTimeoutMs,
  resolveConnectTimeoutMs,
  resolveMuxTimeoutMs,
} from '../src/client/lifecycle.ts'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const binPath = join(pkgRoot, 'bin', 'dsh-opentui.mjs')
const pkgVersion = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version

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

describe('--remote deprecation (T10)', () => {
  test('is an accepted (known) client arg and in the client-launch allowlist', () => {
    expect(KNOWN_CLIENT_ARGS).toContain('--remote')
    expect(validateLauncherArgs(['--remote']).unknown).toEqual([])
    // A `--remote` value-taking neighbour is not mistaken for an unknown flag.
    expect(validateLauncherArgs(['--remote', '--new']).unknown).toEqual([])
  })

  test('the notice names the removal line and the replacement entry', () => {
    expect(REMOTE_DEPRECATION_NOTICE).toContain('0.23.0')
    expect(REMOTE_DEPRECATION_NOTICE).toContain('deprecated')
    expect(REMOTE_DEPRECATION_NOTICE.toLowerCase()).toContain('in-process bridge')
    expect(REMOTE_DEPRECATION_NOTICE).toContain('DSH_OPENTUI_INPROC=1')
    expect(REMOTE_DEPRECATION_NOTICE).toContain('--session')
  })

  test('emitRemoteDeprecation prints at most once even when the flag repeats', () => {
    const lines: string[] = []
    expect(emitRemoteDeprecation([['--remote', '--remote', '--new'], []], (m) => lines.push(String(m)))).toBe(1)
    expect(lines).toEqual([REMOTE_DEPRECATION_NOTICE])
    expect(emitRemoteDeprecation([['--new'], []], (m) => lines.push(String(m)))).toBe(0)
    expect(lines).toHaveLength(1)
  })

  test('isRemoteRequested sees the flag before and after a -- separator', () => {
    expect(isRemoteRequested(['--remote'], [])).toBe(true)
    expect(isRemoteRequested(['--new'], ['--remote'])).toBe(true)
    expect(isRemoteRequested(['--new'], [])).toBe(false)
  })

  test('bin integration: --remote --help prints one notice and the usage', () => {
    const r = spawnSync('node', [binPath, '--remote', '--help'], { encoding: 'utf8', timeout: 30_000 })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Usage: dsh-opentui')
    const matches = r.stderr.split(REMOTE_DEPRECATION_NOTICE).length - 1
    expect(matches).toBe(1)
    expect(r.stderr).not.toContain('[1/5]') // no provisioning on the help path
  })
})

describe('P3-3 flag-combination conflicts', () => {
  test('--repair-bridge + --force is an explicit mutually-exclusive reject', () => {
    expect(launcherFlagConflict({ force: true, repairBridge: true, yes: false }, false)).toBe('repair-force')
    expect(launcherFlagConflict({ force: true, repairBridge: true, yes: true }, false)).toBe('repair-force')
  })

  test('--repair-bridge + --remote is rejected (remote mode has no bridge to repair)', () => {
    expect(launcherFlagConflict({ force: false, repairBridge: true, yes: false }, true)).toBe('repair-remote')
  })

  test('--yes without --force is rejected, but --repair-bridge --yes is the kill confirmation', () => {
    expect(launcherFlagConflict({ force: false, repairBridge: false, yes: true }, false)).toBe('yes-without-force')
    // Under --repair-bridge, --yes is intentionally allowed through.
    expect(launcherFlagConflict({ force: false, repairBridge: true, yes: true }, false)).toBeNull()
  })

  test('benign combinations do not conflict', () => {
    expect(launcherFlagConflict({ force: false, repairBridge: false, yes: false }, false)).toBeNull()
    expect(launcherFlagConflict({ force: true, repairBridge: false, yes: true }, false)).toBeNull()
    expect(launcherFlagConflict({ force: true, repairBridge: false, yes: false }, false)).toBeNull()
  })

  test('bin integration: conflicting combos exit 2 with a human-readable message', () => {
    for (const [args, needle] of [
      [['--repair-bridge', '--force'], 'mutually exclusive'],
      [['--repair-bridge', '--remote'], 'no bridge to repair'],
      [['--yes'], 'only meaningful together with --force'],
    ] as const) {
      const r = spawnSync('node', [binPath, ...args], { encoding: 'utf8', timeout: 30_000 })
      expect(r.status).toBe(2)
      expect(r.stderr).toContain(needle)
    }
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
      '--repair-bridge',
      '--boot-timeout <sec>',
      '--mux-timeout <sec>',
      '--connect-timeout <sec>',
      '--provider <name>',
      '--model <name>',
      '--reasoning-effort <level>',
      '--plugins <tier>',
      '--dry-run',
      '--remote',
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
    // P3-3 ④: --force is documented as a no-op under --dry-run.
    expect(usage).toContain('no-op under --dry-run')
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

// The client-side resolvers share the launcher's env contract. `Number()` on
// its own also accepts hex/exponent/separator spellings that are NOT valid
// millisecond budgets, so each env value must pass a plain-decimal gate first.
describe('timeout env parsing rejects non-decimal Number() spellings', () => {
  const resolvers = [
    {
      name: 'resolveBootTimeoutMs',
      env: ENV_BOOT_TIMEOUT_MS,
      def: DEFAULT_READINESS_TIMEOUT_MS,
      fn: resolveBootTimeoutMs,
    },
    {
      name: 'resolveMuxTimeoutMs',
      env: ENV_MUX_TIMEOUT_MS,
      def: DEFAULT_SERVE_PROBE_BUDGET_MS,
      fn: resolveMuxTimeoutMs,
    },
    {
      name: 'resolveConnectTimeoutMs',
      env: ENV_CONNECT_TIMEOUT_MS,
      def: DEFAULT_CONNECT_TIMEOUT_MS,
      fn: resolveConnectTimeoutMs,
    },
  ]
  const saved = new Map<string, string | undefined>()

  beforeEach(() => {
    for (const r of resolvers) {
      saved.set(r.env, process.env[r.env])
      delete process.env[r.env]
    }
  })

  afterEach(() => {
    for (const r of resolvers) {
      const value = saved.get(r.env)
      if (value === undefined) delete process.env[r.env]
      else process.env[r.env] = value
    }
  })

  for (const r of resolvers) {
    for (const bad of ['0x1D', '30e2', '1_000']) {
      test(`${r.name}: env '${bad}' falls back to the default`, () => {
        process.env[r.env] = bad
        expect(r.fn()).toBe(r.def)
      })
    }
  }
})

describe('prelaunchFailurePolicy — --force never silently degrades to a no-op (P1-5)', () => {
  const needsYes = Object.assign(new Error('will disconnect 2 live clients'), { code: 'force-needs-yes' })

  test('force-needs-yes is always a usage error (exit 2), force or not', () => {
    expect(prelaunchFailurePolicy(needsYes, false)).toBe('usage-error')
    expect(prelaunchFailurePolicy(needsYes, true)).toBe('usage-error')
  })

  test('any other pre-launch failure under --force is a hard abort (exit 1)', () => {
    for (const err of [
      new Error('Cannot find module .../dist/host-launch.mjs'),
      new TypeError('ensureLaunchHost is not a function'),
      'string rejection',
    ]) {
      expect(prelaunchFailurePolicy(err, true)).toBe('abort')
    }
  })

  test('without --force the same failure stays best-effort (warn)', () => {
    expect(prelaunchFailurePolicy(new Error('ENOENT'), false)).toBe('warn')
  })
})

// ---- bin integration: async client spawn exit mapping (PR B) -------------
// Exercise the launcher's real `spawn('bun', …)` path end to end. To avoid a
// real host (and any dependence on a globally installed dsh), copy the bin +
// its lib into a throwaway package root, stub the two filesystem gates
// (dist/client/index.js and the SDK link), put a fake `dsh` and a controllable
// fake `bun` first on PATH, and pass `--dry-run` so step 6a host pre-launch is
// skipped. The subject under test is the launcher's exit-code mapping of the
// child's outcome, so only the fake bun's exit code / signal death matters.
function makeAsyncLauncherHarness() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-launcher-async-'))
  const tmpBinDir = join(root, 'bin')
  mkdirSync(join(tmpBinDir, 'lib'), { recursive: true })
  cpSync(binPath, join(tmpBinDir, 'dsh-opentui.mjs'))
  cpSync(join(pkgRoot, 'bin', 'lib', 'launcher.mjs'), join(tmpBinDir, 'lib', 'launcher.mjs'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@aiwayds/dsh-opentui', version: pkgVersion }))
  // Step 6 existsSync gate — fake bun ignores the bundle contents.
  mkdirSync(join(root, 'dist', 'client'), { recursive: true })
  writeFileSync(join(root, 'dist', 'client', 'index.js'), '')
  // ensureClientConnectionSdk() returns early when this package.json exists.
  const sdkDir = join(root, 'node_modules', '@deepseek-ai', 'dsh-client-connection')
  mkdirSync(sdkDir, { recursive: true })
  writeFileSync(join(sdkDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-connection', version: '0.0.0' }))

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
    env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}`, DSH_HOME: dshHome },
    setBunShim(body: string) {
      writeFileSync(bunShim, `#!/bin/sh\n${body}\n`)
      chmodSync(bunShim, 0o755)
    },
  }
}

function runAsyncLauncher(h: ReturnType<typeof makeAsyncLauncherHarness>) {
  return spawnSync('node', [h.launcherBin, '--dry-run'], { encoding: 'utf8', timeout: 30_000, env: h.env })
}

describe('bin integration: async client spawn maps child exit code / signal (PR B)', () => {
  let h: ReturnType<typeof makeAsyncLauncherHarness>
  beforeEach(() => { h = makeAsyncLauncherHarness() })
  afterEach(() => { rmSync(h.root, { recursive: true, force: true }) })

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
