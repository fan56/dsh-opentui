// The `upgrade` subcommand's argv contract: a POSITIONAL command that must be
// the first argument after the bin-level flags, plus the flag/exit-code usage
// text. Pure data in, pure data out — no process, no profile, no npm.
import { describe, expect, test } from 'bun:test'
import {
  UPGRADE_DEFAULT_TAG,
  formatUpgradeUsage,
  parseLauncherArgs,
  parseUpgradeArgs,
} from '../bin/lib/launcher.mjs'

const baseOpts = {
  dryRun: false,
  yes: false,
  tag: UPGRADE_DEFAULT_TAG,
  noSelf: false,
  noPlugins: false,
  resetOverrides: false,
  help: false,
}

describe('parseUpgradeArgs — positional recognition', () => {
  test('`upgrade` in the first position selects the subcommand with defaults', () => {
    expect(parseUpgradeArgs(['upgrade'])).toEqual({ isUpgrade: true, opts: baseOpts, error: null })
    expect(UPGRADE_DEFAULT_TAG).toBe('latest')
  })

  test('anything else in the first position is forwarded, not parsed', () => {
    expect(parseUpgradeArgs([])).toEqual({ isUpgrade: false, opts: baseOpts, error: null })
    expect(parseUpgradeArgs(['--version'])).toEqual({ isUpgrade: false, opts: baseOpts, error: null })
    expect(parseUpgradeArgs(['foo', 'upgrade'])).toEqual({ isUpgrade: false, opts: baseOpts, error: null })
    // Unknown flags are only an upgrade error when `upgrade` is selected.
    expect(parseUpgradeArgs(['foo', '--bogus'])).toEqual({ isUpgrade: false, opts: baseOpts, error: null })
  })

  test('the match is exact and case-sensitive', () => {
    expect(parseUpgradeArgs(['Upgrade']).isUpgrade).toBe(false)
    expect(parseUpgradeArgs(['upgrade-lookalike']).isUpgrade).toBe(false)
    // A flag VALUE that happens to spell `upgrade` is not the subcommand.
    expect(parseUpgradeArgs(['--model', 'upgrade']).isUpgrade).toBe(false)
  })
})

describe('parseUpgradeArgs — flags', () => {
  test('every flag is recognized', () => {
    const { isUpgrade, opts, error } = parseUpgradeArgs([
      'upgrade',
      '--dry-run',
      '-y',
      '--tag',
      'next',
      '--no-self',
      '--no-plugins',
      '--help',
    ])
    expect(isUpgrade).toBe(true)
    expect(error).toBe(null)
    expect(opts).toEqual({
      dryRun: true,
      yes: true,
      tag: 'next',
      noSelf: true,
      noPlugins: true,
      resetOverrides: false,
      help: true,
    })
  })

  test('--yes and -h long/short spellings', () => {
    expect(parseUpgradeArgs(['upgrade', '--yes']).opts.yes).toBe(true)
    expect(parseUpgradeArgs(['upgrade', '-h']).opts.help).toBe(true)
  })

  test('--tag accepts `--tag <name>` and `--tag=<name>`', () => {
    expect(parseUpgradeArgs(['upgrade', '--tag', 'beta']).opts.tag).toBe('beta')
    expect(parseUpgradeArgs(['upgrade', '--tag=beta']).opts.tag).toBe('beta')
    // A flag VALUE is not mistaken for a flag.
    expect(parseUpgradeArgs(['upgrade', '--tag', '--dry-run']).error).toBe('missing-tag-value')
    expect(parseUpgradeArgs(['upgrade', '--tag=']).error).toBe('missing-tag-value')
    expect(parseUpgradeArgs(['upgrade', '--tag']).error).toBe('missing-tag-value')
  })

  test('--tag rejects values npm could not use as a dist-tag', () => {
    const spaced = parseUpgradeArgs(['upgrade', '--tag', 'bad tag'])
    expect(spaced.error).toBe('invalid-tag')
    // The offending value is carried out so the bin can print it.
    expect(spaced.invalidTag).toBe('bad tag')
    expect(parseUpgradeArgs(['upgrade', '--tag=bad/tag']).error).toBe('invalid-tag')
    expect(parseUpgradeArgs(['upgrade', '--tag', '--dry-run']).error).toBe('missing-tag-value')
    // Ordinary dist-tags stay valid.
    expect(parseUpgradeArgs(['upgrade', '--tag', 'next']).error).toBe(null)
    expect(parseUpgradeArgs(['upgrade', '--tag=1.2.3-rc.1_beta']).error).toBe(null)
  })

  test('--reset-overrides is a flag of its own', () => {
    expect(parseUpgradeArgs(['upgrade', '--reset-overrides']).opts.resetOverrides).toBe(true)
  })

  test('unknown flags are collected and reported once', () => {
    const result = parseUpgradeArgs(['upgrade', '--verbose', 'extra', '-z'])
    expect(result.isUpgrade).toBe(true)
    expect(result.error).toBe('unknown-flag')
    expect(result.unknownFlags).toEqual(['--verbose', 'extra', '-z'])
  })

  test('--reset-overrides conflicts with a scope flag', () => {
    expect(parseUpgradeArgs(['upgrade', '--reset-overrides', '--no-self']).error).toBe(
      'reset-overrides-conflict',
    )
    expect(parseUpgradeArgs(['upgrade', '--reset-overrides', '--no-plugins']).error).toBe(
      'reset-overrides-conflict',
    )
    expect(
      parseUpgradeArgs(['upgrade', '--reset-overrides', '--no-self', '--no-plugins']).error,
    ).toBe('reset-overrides-conflict')
    // --yes and --tag shape an upgrade that will not happen; presence counts,
    // even for the default tag value.
    expect(parseUpgradeArgs(['upgrade', '--reset-overrides', '--yes']).error).toBe(
      'reset-overrides-conflict',
    )
    expect(parseUpgradeArgs(['upgrade', '--reset-overrides', '--tag', 'next']).error).toBe(
      'reset-overrides-conflict',
    )
    expect(parseUpgradeArgs(['upgrade', '--reset-overrides', '--tag=latest']).error).toBe(
      'reset-overrides-conflict',
    )
    // --dry-run is the one allowed companion.
    expect(parseUpgradeArgs(['upgrade', '--reset-overrides', '--dry-run']).error).toBe(null)
  })
})

describe('parseUpgradeArgs — interaction with parseLauncherArgs', () => {
  test('--force is consumed before the upgrade parse, never repeated in it', () => {
    const launcher = parseLauncherArgs(['--force', 'upgrade', '--dry-run'])
    expect(launcher).toEqual({ version: false, force: true, rest: ['upgrade', '--dry-run'] })
    expect(parseUpgradeArgs(launcher.rest)).toEqual({
      isUpgrade: true,
      opts: { ...baseOpts, dryRun: true },
      error: null,
    })
    // --force is bin-level wherever it appears: it is stripped, not an upgrade error.
    expect(parseLauncherArgs(['upgrade', '--force']).rest).toEqual(['upgrade'])
    expect(parseUpgradeArgs(parseLauncherArgs(['upgrade', '--force']).rest).error).toBe(null)
  })

  test('--version short-circuits and leaves no upgrade selection', () => {
    const launcher = parseLauncherArgs(['--version', 'upgrade'])
    expect(launcher.version).toBe(true)
    expect(parseUpgradeArgs(['--version']).isUpgrade).toBe(false)
  })
})

describe('formatUpgradeUsage', () => {
  test('documents every flag and the exit codes', () => {
    const usage = formatUpgradeUsage()
    for (const flag of [
      '--dry-run',
      '-y, --yes',
      '--tag <name>',
      '--no-self',
      '--no-plugins',
      '--reset-overrides',
      '-h, --help',
    ]) {
      expect(usage).toContain(flag)
    }
    for (const code of ['  0  ', '  1  ', '  2  ', '  3  ']) expect(usage).toContain(code)
    expect(usage).toContain('Usage: dsh-opentui upgrade [options]')
  })
})
