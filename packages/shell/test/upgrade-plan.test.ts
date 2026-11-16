// Pure planning logic behind the `upgrade` subcommand: registry resolution,
// query argv, dependency filtering, the plan table, and the override file
// provisioning shares. No network, no npm, no profile on disk, so all of it
// is tested here from plain fixtures.
import { describe, expect, test } from 'bun:test'
import { compareVersions } from '../scripts/lib/provision-plan.mjs'
import {
  OFFICIAL_REGISTRY,
  buildUpgradePlan,
  buildViewArgs,
  isOfficialRegistry,
  isUpgradableDependency,
  parseOverrides,
  pickEffectivePin,
  resolveRegistry,
  serializeOverrides,
  shouldWriteOverride,
} from '../scripts/lib/upgrade-plan.mjs'

// A name that is in provision-plan's PLUGIN_SET, so the shared pin decision
// can honour an override for it.
const MANAGED = '@aiwayds/dsh-cron'

describe('resolveRegistry', () => {
  test('the environment variable wins over npmrc and the default', () => {
    const resolved = resolveRegistry({
      env: { DSH_UPGRADE_REGISTRY: 'https://explicit.example/' },
      npmrcTexts: ['registry=https://npmrc.example/'],
    })
    expect(resolved).toEqual({ registry: 'https://explicit.example', source: 'env' })
  })

  test('npmrc is used when the environment variable is absent', () => {
    const resolved = resolveRegistry({
      env: {},
      npmrcTexts: ['registry=https://npmrc.example/'],
    })
    expect(resolved).toEqual({ registry: 'https://npmrc.example', source: 'npmrc' })
  })

  test('empty configuration falls back to the official registry', () => {
    expect(resolveRegistry({ env: {}, npmrcTexts: [] })).toEqual({
      registry: OFFICIAL_REGISTRY,
      source: 'default',
    })
    expect(resolveRegistry()).toEqual({ registry: OFFICIAL_REGISTRY, source: 'default' })
  })

  test('trailing slashes are stripped from every source', () => {
    expect(resolveRegistry({ env: { DSH_UPGRADE_REGISTRY: 'https://a.example///' } }).registry).toBe(
      'https://a.example',
    )
    expect(resolveRegistry({ npmrcTexts: ['registry=https://b.example//'] }).registry).toBe(
      'https://b.example',
    )
  })

  test('a later npmrc text overrides an earlier one', () => {
    const resolved = resolveRegistry({
      npmrcTexts: ['registry=https://first.example/', 'registry="https://second.example/"'],
    })
    expect(resolved).toEqual({ registry: 'https://second.example', source: 'npmrc' })
  })

  test('a trailing # comment and quotes do not leak into the value', () => {
    const resolved = resolveRegistry({
      npmrcTexts: ['registry="https://npmrc.example/"  # corporate mirror\n'],
    })
    expect(resolved).toEqual({ registry: 'https://npmrc.example', source: 'npmrc' })
  })

  test('only registry.npmjs.org counts as the official registry', () => {
    expect(isOfficialRegistry('https://registry.npmjs.org')).toBe(true)
    expect(isOfficialRegistry('https://registry.npmjs.org/')).toBe(true)
    expect(isOfficialRegistry('registry.npmjs.org')).toBe(true)
    expect(isOfficialRegistry('https://registry.npmmirror.com')).toBe(false)
    expect(isOfficialRegistry('https://registry.npmjs.org.example.com')).toBe(false)
  })
})

describe('buildViewArgs', () => {
  test('builds dist-tags argv with --prefer-online and the resolved registry', () => {
    const args = buildViewArgs({ pkg: '@aiwayds/dsh-vault', registry: 'https://registry.example' })
    expect(args).toEqual([
      'view',
      '@aiwayds/dsh-vault',
      'dist-tags',
      '--json',
      '--registry',
      'https://registry.example',
      '--prefer-online',
      '--fetch-retries',
      '0',
      '--fetch-timeout',
      '20000',
    ])
    // Package name sits directly after `view`, before any flag.
    expect(args[1]).toBe('@aiwayds/dsh-vault')
    expect(args.indexOf('--prefer-online')).toBeGreaterThan(args.indexOf('dist-tags'))
    expect(args[args.indexOf('--registry') + 1]).toBe('https://registry.example')
    // npm's default retry ladder is what made a dead registry cost minutes.
    expect(args[args.indexOf('--fetch-retries') + 1]).toBe('0')
    expect(args[args.indexOf('--fetch-timeout') + 1]).toBe('20000')
  })
})

describe('isUpgradableDependency', () => {
  test('host-closure packages and non-registry specs are excluded', () => {
    expect(isUpgradableDependency('@deepseek-ai/dsh-app-boot', '1.2.3')).toBe(false)
    expect(isUpgradableDependency('@aiwayds/dsh-workflow', 'link:../../x')).toBe(false)
    expect(isUpgradableDependency('@aiwayds/dsh-workflow', 'file:./y')).toBe(false)
    expect(isUpgradableDependency('@aiwayds/dsh-workflow', 'workspace:*')).toBe(false)
  })

  test('registry specs are upgradable whatever their range shape', () => {
    expect(isUpgradableDependency('@aiwayds/x', '^1.2.3')).toBe(true)
    expect(isUpgradableDependency('@aiwayds/x', '1.2.3')).toBe(true)
    expect(isUpgradableDependency('@aiwayds/x', '~1.2.3')).toBe(true)
    expect(isUpgradableDependency('@aiwayds/x', '*')).toBe(true)
  })
})

describe('buildUpgradePlan', () => {
  test('a newer registry version plans an upgrade', () => {
    const { rows, counts } = buildUpgradePlan({
      deps: { '@aiwayds/dsh-vault': '0.8.1' },
      installedVersions: { '@aiwayds/dsh-vault': '0.8.1' },
      latestByPkg: { '@aiwayds/dsh-vault': '0.8.2' },
    })
    expect(rows).toEqual([
      {
        name: '@aiwayds/dsh-vault',
        currentSpec: '0.8.1',
        current: '0.8.1',
        target: '0.8.2',
        action: 'upgrade',
      },
    ])
    expect(counts).toEqual({ upgrade: 1, latest: 0, excluded: 0, queryFailed: 0 })
  })

  test('an installed version equal to the target is latest', () => {
    const { rows, counts } = buildUpgradePlan({
      deps: { '@aiwayds/x': '0.7.2' },
      installedVersions: { '@aiwayds/x': '0.7.2' },
      latestByPkg: { '@aiwayds/x': '0.7.2' },
    })
    expect(rows[0].action).toBe('latest')
    expect(counts.latest).toBe(1)
  })

  test('a package without a registry answer is query-failed', () => {
    const { rows, counts } = buildUpgradePlan({
      deps: { '@aiwayds/x': '0.7.2' },
      installedVersions: { '@aiwayds/x': '0.7.2' },
      latestByPkg: {},
    })
    expect(rows[0]).toEqual({
      name: '@aiwayds/x',
      currentSpec: '0.7.2',
      current: '0.7.2',
      target: null,
      action: 'query-failed',
    })
    expect(counts.queryFailed).toBe(1)
  })

  test('host-closure and local specs are excluded and never count as upgradable', () => {
    const { rows, counts } = buildUpgradePlan({
      deps: {
        '@deepseek-ai/dsh-base': '1.0.0',
        '@aiwayds/dsh-workflow': 'link:../dsh-workflow',
      },
      latestByPkg: { '@deepseek-ai/dsh-base': '9.9.9', '@aiwayds/dsh-workflow': '9.9.9' },
    })
    expect(rows.map((row) => row.action)).toEqual(['excluded', 'excluded'])
    expect(counts.excluded).toBe(2)
    expect(counts.upgrade).toBe(0)
  })

  test('a missing installed version falls back to the exact spec version', () => {
    const { rows } = buildUpgradePlan({
      deps: { '@aiwayds/exact': '0.7.0', '@aiwayds/range': '^0.7.0' },
      installedVersions: {},
      latestByPkg: { '@aiwayds/exact': '0.7.0', '@aiwayds/range': '0.7.0' },
    })
    expect(rows.find((row) => row.name === '@aiwayds/exact')).toMatchObject({
      current: '0.7.0',
      action: 'latest',
    })
    expect(rows.find((row) => row.name === '@aiwayds/range')).toMatchObject({
      current: null,
      action: 'upgrade',
    })
  })

  test('rows are ordered upgrade, latest, excluded, query-failed and counts match', () => {
    const { rows, counts } = buildUpgradePlan({
      deps: {
        '@aiwayds/zeta': '1.0.0',
        '@deepseek-ai/dsh-base': '1.0.0',
        '@aiwayds/beta': '1.0.0',
        '@aiwayds/alpha': '1.0.0',
        '@aiwayds/gamma': '1.0.0',
        '@aiwayds/linked': 'link:../linked',
      },
      latestByPkg: {
        '@aiwayds/beta': '2.0.0',
        '@aiwayds/alpha': '1.0.0',
        '@aiwayds/gamma': '2.0.0',
        '@deepseek-ai/dsh-base': '9.9.9',
      },
    })
    expect(rows.map((row) => `${row.action}:${row.name}`)).toEqual([
      'upgrade:@aiwayds/beta',
      'upgrade:@aiwayds/gamma',
      'latest:@aiwayds/alpha',
      'excluded:@aiwayds/linked',
      'excluded:@deepseek-ai/dsh-base',
      'query-failed:@aiwayds/zeta',
    ])
    expect(counts).toEqual({ upgrade: 2, latest: 1, excluded: 2, queryFailed: 1 })
  })
})

describe('parseOverrides', () => {
  test('a valid document is parsed and entries keep their shape', () => {
    const parsed = parseOverrides(
      JSON.stringify({
        version: 1,
        packages: {
          '@aiwayds/dsh-vault': '0.8.2',
          '@aiwayds/dsh-cron': { version: '0.7.1', shippedPin: '0.7.0' },
        },
      }),
    )
    expect(parsed).toEqual({
      version: 1,
      packages: {
        '@aiwayds/dsh-vault': '0.8.2',
        '@aiwayds/dsh-cron': { version: '0.7.1', shippedPin: '0.7.0' },
      },
    })
  })

  test('invalid JSON returns null', () => {
    expect(parseOverrides('not json')).toBeNull()
    expect(parseOverrides('')).toBeNull()
  })

  test('a non-object top level returns null', () => {
    expect(parseOverrides('[]')).toBeNull()
    expect(parseOverrides('"0.7.2"')).toBeNull()
    expect(parseOverrides('null')).toBeNull()
    expect(parseOverrides(JSON.stringify({ version: 1, packages: [] }))).toBeNull()
    expect(parseOverrides(JSON.stringify({ version: 1 }))).toBeNull()
  })

  test('a malformed entry is dropped and the rest survive', () => {
    const parsed = parseOverrides(
      JSON.stringify({
        version: 1,
        packages: {
          '@aiwayds/keep': '0.7.2',
          '@aiwayds/broken': { nope: true },
          '@aiwayds/empty': '',
          '@aiwayds/also-keep': { version: '0.7.3' },
        },
      }),
    )
    expect(parsed).toEqual({
      version: 1,
      packages: {
        '@aiwayds/keep': '0.7.2',
        '@aiwayds/also-keep': { version: '0.7.3' },
      },
    })
  })
})

describe('serializeOverrides', () => {
  test('keys are sorted and the output is stable across insertion orders', () => {
    const forward = serializeOverrides({
      version: 1,
      packages: { '@aiwayds/a': '0.7.1', '@aiwayds/b': '0.7.2' },
    })
    const reversed = serializeOverrides({
      version: 1,
      packages: { '@aiwayds/b': '0.7.2', '@aiwayds/a': '0.7.1' },
    })
    expect(forward).toBe(reversed)
    expect(forward.endsWith('\n')).toBe(true)
    expect(forward.indexOf('"@aiwayds/a"')).toBeLessThan(forward.indexOf('"@aiwayds/b"'))
    expect(forward).toBe(
      `${JSON.stringify({ version: 1, packages: { '@aiwayds/a': '0.7.1', '@aiwayds/b': '0.7.2' } }, null, 2)}\n`,
    )
    expect(serializeOverrides(parseOverrides(forward))).toBe(forward)
    expect(serializeOverrides({ version: 1, packages: {} })).toBe(
      `${JSON.stringify({ version: 1, packages: {} }, null, 2)}\n`,
    )
  })
})

describe('shouldWriteOverride', () => {
  test('a strictly newer override is written', () => {
    expect(shouldWriteOverride({ overrideVersion: '0.7.2', shippedPin: '0.7.0' })).toBe(true)
  })

  test('equal, older, and invalid versions are not written', () => {
    expect(shouldWriteOverride({ overrideVersion: '0.7.0', shippedPin: '0.7.0' })).toBe(false)
    expect(shouldWriteOverride({ overrideVersion: '0.7.0', shippedPin: '0.8.0' })).toBe(false)
    expect(shouldWriteOverride({ overrideVersion: 'garbage', shippedPin: '0.7.0' })).toBe(false)
    expect(shouldWriteOverride({ overrideVersion: '0.7.2', shippedPin: 'garbage' })).toBe(false)
    expect(shouldWriteOverride({})).toBe(false)
  })

  test('numeric segments compare numerically, not as strings', () => {
    expect(shouldWriteOverride({ overrideVersion: '1.10.0', shippedPin: '1.9.0' })).toBe(true)
    expect(shouldWriteOverride({ overrideVersion: '1.9.0', shippedPin: '1.10.0' })).toBe(false)
  })
})

describe('pickEffectivePin', () => {
  // The pin decision is provision-plan's resolveEffectivePin, and that
  // function only honours names in PLUGIN_SET, so these fixtures use a real
  // managed name instead of an arbitrary one.
  test('the shipped pin wins when the name has no override entry', () => {
    expect(pickEffectivePin({ name: MANAGED, shippedPin: '0.7.0' })).toEqual({
      pin: '0.7.0',
      overridden: false,
    })
    expect(
      pickEffectivePin({ name: MANAGED, shippedPin: '0.7.0', overrides: { version: 1, packages: {} } }),
    ).toEqual({ pin: '0.7.0', overridden: false })
  })

  test('a newer override is honoured', () => {
    // The object form is what provisioning honours: its resolver requires an
    // entry object with a `version`, so a bare string is inert there.
    expect(
      pickEffectivePin({
        name: MANAGED,
        shippedPin: '0.7.0',
        overrides: { version: 1, packages: { [MANAGED]: { version: '0.7.2' } } },
      }),
    ).toEqual({ pin: '0.7.2', overridden: true })
    // Same version, but for a package outside PLUGIN_SET: a valid, newer
    // entry that provisioning's allowlist will never honour.
    expect(
      pickEffectivePin({
        name: '@aiwayds/x',
        shippedPin: '0.7.0',
        overrides: { version: 1, packages: { '@aiwayds/x': { version: '0.7.2' } } },
      }),
    ).toEqual({ pin: '0.7.0', overridden: false, ignoredReason: 'unmanaged' })
  })

  test('the flat packages map that provisioning reads works too', () => {
    expect(
      pickEffectivePin({
        name: MANAGED,
        shippedPin: '0.7.0',
        overrides: { [MANAGED]: { version: '0.7.2', shippedPin: '0.7.0' } },
      }),
    ).toEqual({ pin: '0.7.2', overridden: true })
  })

  test('a stale override is ignored', () => {
    expect(
      pickEffectivePin({
        name: MANAGED,
        shippedPin: '0.8.0',
        overrides: { version: 1, packages: { [MANAGED]: { version: '0.7.2' } } },
      }),
    ).toEqual({ pin: '0.8.0', overridden: false, ignoredReason: 'stale' })
    expect(
      pickEffectivePin({
        name: MANAGED,
        shippedPin: '0.7.2',
        overrides: { version: 1, packages: { [MANAGED]: { version: '0.7.2' } } },
      }),
    ).toEqual({ pin: '0.7.2', overridden: false, ignoredReason: 'stale' })
  })

  test('an invalid override version is ignored as invalid', () => {
    expect(
      pickEffectivePin({
        name: MANAGED,
        shippedPin: '0.7.0',
        overrides: { version: 1, packages: { [MANAGED]: 'garbage' } },
      }),
    ).toEqual({ pin: '0.7.0', overridden: false, ignoredReason: 'invalid' })
    expect(
      pickEffectivePin({
        name: MANAGED,
        shippedPin: '0.7.0',
        overrides: { version: 1, packages: { [MANAGED]: { nope: true } } },
      }),
    ).toEqual({ pin: '0.7.0', overridden: false, ignoredReason: 'invalid' })
  })
})

describe('compareVersions (reused from provision-plan)', () => {
  test('orders prereleases and releases per semver', () => {
    expect(compareVersions('0.2.2-rc.3', '0.2.2-rc.10')).toBe(-1)
    expect(compareVersions('0.2.2-rc.10', '0.2.2')).toBe(-1)
    expect(compareVersions('0.2.2', '0.2.3')).toBe(-1)
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('0.2.2', '0.2.2')).toBe(0)
  })
})
