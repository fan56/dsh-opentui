// Pure planning logic behind provision-opentui-profile.mjs. No network, no
// profile on disk, no dsh process: the script's idempotency rules and the
// ask-router-first bundle order are decided here, so they are tested here.
import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_TIER,
  EXCLUDED_PLUGINS,
  MCP_CONTEXT7_PATCH,
  PLUGIN_SET,
  RETIRED_PROFILE_ENTRIES,
  TOOL_WEB_PATCH,
  WEB_SEARCH_PATCH,
  cleanupDependencies,
  compareVersions,
  formatStep,
  hasAnyEntry,
  installSpecs,
  isDryRun,
  isLocalSpec,
  mergeBundles,
  parseDumpConfig,
  parseTier,
  patchEntryBlock,
  planMcpPatch,
  planPluginInstall,
  planToolPatch,
  pluginAddArgs,
  pluginAddCommand,
  satisfiesVersion,
  selectPlugins,
} from '../scripts/lib/provision-plan.mjs'

const allNames = PLUGIN_SET.map((plugin) => plugin.name)

function fullyProvisioned() {
  const dependencies: Record<string, string> = {}
  const installedVersions: Record<string, string> = {}
  for (const plugin of PLUGIN_SET) {
    dependencies[plugin.name] = plugin.version
    installedVersions[plugin.name] = plugin.version
  }
  return { dependencies, installedVersions, bundles: [...allNames] }
}

describe('plugin set', () => {
  test('core is a subset of recommended; recommended is the default tier', () => {
    const core = selectPlugins('core')
    const recommended = selectPlugins('recommended')
    expect(DEFAULT_TIER).toBe('recommended')
    expect(core.length).toBe(7)
    expect(recommended.length).toBe(12)
    for (const plugin of core) expect(recommended.some((p) => p.name === plugin.name)).toBe(true)
    expect(recommended.filter((p) => p.tier === 'recommended').length).toBe(5)
  })

  test('none selects nothing, and an unknown tier throws instead of silently installing nothing', () => {
    expect(selectPlugins('none')).toEqual([])
    expect(() => parseTier('al')).toThrow(/unknown plugin tier/)
    expect(parseTier(undefined)).toBe('recommended')
    expect(parseTier(' CORE ')).toBe('core')
  })

  test('ask-router is first: it owns the ask surface every UI bundle attaches to', () => {
    expect(selectPlugins('core')[0].name).toBe('@aiwayds/dsh-ask-router')
    expect(selectPlugins('recommended')[0].name).toBe('@aiwayds/dsh-ask-router')
  })

  test('every default plugin declares a tier and a reason; excluded packages are not installed', () => {
    for (const plugin of PLUGIN_SET) {
      expect(['core', 'recommended']).toContain(plugin.tier)
      expect(plugin.reason.length).toBeGreaterThan(10)
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/)
    }
    for (const plugin of PLUGIN_SET) {
      expect(EXCLUDED_PLUGINS.some((excluded) => excluded.name === plugin.name)).toBe(false)
    }
    expect(EXCLUDED_PLUGINS.map((plugin) => plugin.name)).toContain('@aiwayds/dsh-tui-pi')
  })
})

describe('dependency idempotency', () => {
  test('versions compare numerically and prereleases sort before releases', () => {
    expect(compareVersions('0.10.0', '0.9.2')).toBe(1)
    expect(compareVersions('0.9.2', '0.9.2')).toBe(0)
    expect(compareVersions('0.2.2-rc.1', '0.2.2')).toBe(-1)
    expect(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1)
    expect(compareVersions('garbage', '1.0.0')).toBe(0)
  })

  test('pinned versions are exact; ^ ~ >= are supported and an unknown install never satisfies', () => {
    expect(satisfiesVersion('0.7.0', '0.7.0')).toBe(true)
    expect(satisfiesVersion('0.7.1', '0.7.0')).toBe(false)
    expect(satisfiesVersion('0.7.1', '^0.7.0')).toBe(true)
    expect(satisfiesVersion('0.8.0', '^0.7.0')).toBe(false)
    expect(satisfiesVersion('0.7.9', '~0.7.0')).toBe(true)
    expect(satisfiesVersion('0.8.0', '~0.7.0')).toBe(false)
    expect(satisfiesVersion('1.0.0', '>=0.9.0')).toBe(true)
    expect(satisfiesVersion('0.8.0', '>=0.9.0')).toBe(false)
    expect(satisfiesVersion(undefined, '0.7.0')).toBe(false)
    expect(satisfiesVersion('0.7.0', 'latest')).toBe(true)
  })

  test('local specs are never replaced by a registry version', () => {
    expect(isLocalSpec('link:/repo/dsh-workflow')).toBe(true)
    expect(isLocalSpec('file:../x.tgz')).toBe(true)
    expect(isLocalSpec('workspace:*')).toBe(true)
    expect(isLocalSpec('0.7.0')).toBe(false)
  })
})

describe('planPluginInstall', () => {
  test('a fresh profile installs every selected plugin in one batch', () => {
    const plan = planPluginInstall({ tier: 'recommended' })
    expect(plan.total).toBe(12)
    expect(plan.install.length).toBe(12)
    expect(plan.satisfied).toBe(0)
    expect(plan.install[0].spec).toBe('@aiwayds/dsh-ask-router@0.7.0')
    expect(plan.install[0].reason).toContain('ask surface')
  })

  test('a fully provisioned profile is a no-op (dep + node_modules version + bundle entry)', () => {
    const plan = planPluginInstall({ tier: 'recommended', ...fullyProvisioned() })
    expect(plan.install).toEqual([])
    expect(plan.satisfied).toBe(12)
    expect(plan.missingBundles).toEqual([])
  })

  test('an old dep pin or an old installed version triggers the install', () => {
    const fixture = fullyProvisioned()
    fixture.dependencies['@aiwayds/dsh-cron'] = '0.6.1'
    fixture.installedVersions['@aiwayds/dsh-cron'] = '0.6.1'
    expect(planPluginInstall({ tier: 'recommended', ...fixture }).install.map((p) => p.name)).toEqual([
      '@aiwayds/dsh-cron',
    ])

    const missingTree = fullyProvisioned()
    delete missingTree.installedVersions['@aiwayds/dsh-vault']
    expect(planPluginInstall({ tier: 'recommended', ...missingTree }).install.map((p) => p.name)).toEqual([
      '@aiwayds/dsh-vault',
    ])
  })

  test('dep present but bundle missing is a bundle-only repair (no reinstall)', () => {
    const fixture = fullyProvisioned()
    fixture.bundles = fixture.bundles.filter((name) => name !== '@aiwayds/dsh-ask-router')
    const plan = planPluginInstall({ tier: 'recommended', ...fixture })
    expect(plan.install).toEqual([])
    expect(plan.missingBundles).toEqual(['@aiwayds/dsh-ask-router'])
    expect(plan.satisfied).toBe(11)
  })

  test('link:/file: pins count as satisfied even when node_modules is absent', () => {
    const plan = planPluginInstall({
      tier: 'core',
      dependencies: { '@aiwayds/dsh-ask-router': 'link:/repo/ask-router' },
      bundles: ['@aiwayds/dsh-ask-router'],
    })
    expect(plan.install.map((p) => p.name)).not.toContain('@aiwayds/dsh-ask-router')
  })

  test('tier core plans only core; tier none plans nothing', () => {
    expect(planPluginInstall({ tier: 'core' }).install.length).toBe(7)
    expect(planPluginInstall({ tier: 'none' }).total).toBe(0)
  })

  test('install specs and the command are the exact strings the shell runs', () => {
    const specs = installSpecs(selectPlugins('core'))
    expect(specs[0]).toBe('@aiwayds/dsh-ask-router@0.7.0')
    expect(pluginAddArgs('opentui', specs)).toEqual(['plugin', '--profile', 'opentui', 'add', ...specs])
    expect(pluginAddCommand('opentui', specs)).toBe(`dsh plugin --profile opentui add ${specs.join(' ')}`)
  })
})

describe('mergeBundles', () => {
  const order = selectPlugins('recommended').map((plugin) => plugin.name)

  test('appends missing managed bundles and keeps unmanaged entries at their index', () => {
    const result = mergeBundles(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@aiwayds/dsh-approval-policy'], {
      managedOrder: order,
    })
    expect(result.bundles.slice(0, 2)).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    expect(result.appended).toContain('@aiwayds/dsh-ask-router')
    expect(result.removed).toEqual([])
  })

  test('ask-router lands before every other managed UI/ask bundle that is already present', () => {
    const result = mergeBundles(
      ['@deepseek-ai/dsh-base', '@aiwayds/dsh-approval-policy', '@aiwayds/dsh-feishu', '@aiwayds/dsh-topics-memory'],
      { managedOrder: order },
    )
    const ask = result.bundles.indexOf('@aiwayds/dsh-ask-router')
    expect(ask).toBeGreaterThan(0)
    expect(ask).toBeLessThan(result.bundles.indexOf('@aiwayds/dsh-approval-policy'))
    expect(ask).toBeLessThan(result.bundles.indexOf('@aiwayds/dsh-topics-memory'))
    // the unmanaged feishu entry keeps its slot
    expect(result.bundles.indexOf('@aiwayds/dsh-feishu')).toBe(2)
  })

  test('reorders an existing managed subset without moving unmanaged entries', () => {
    const result = mergeBundles(
      [
        '@deepseek-ai/dsh-base',
        '@aiwayds/dsh-vault',
        '@aiwayds/dsh-ask-router',
        '@aiwayds/dsh-cron',
      ],
      { managedOrder: order },
    )
    const managedInOrder = result.bundles.filter((name) => order.includes(name))
    expect(managedInOrder).toEqual(order.filter((name) => result.bundles.includes(name)))
    expect(result.bundles[0]).toBe('@deepseek-ai/dsh-base')
  })

  test('retired entries leave bundles and dependencies', () => {
    const result = mergeBundles(['@deepseek-ai/dsh-base', '@aiwayds/dsh-opentui', '@aiwayds/dsh-ask-router'], {
      managedOrder: order,
      retire: RETIRED_PROFILE_ENTRIES,
    })
    expect(result.removed).toEqual(['@aiwayds/dsh-opentui'])
    expect(result.bundles).not.toContain('@aiwayds/dsh-opentui')

    const deps = cleanupDependencies(
      { '@aiwayds/dsh-opentui': 'file:/nope.tgz', '@aiwayds/dsh-cron': '0.7.0' },
      RETIRED_PROFILE_ENTRIES,
    )
    expect(deps.removed).toEqual(['@aiwayds/dsh-opentui'])
    expect(deps.dependencies).toEqual({ '@aiwayds/dsh-cron': '0.7.0' })
  })

  test('a clean profile reports no change (empty appended/removed, not reordered)', () => {
    const bundles = ['@deepseek-ai/dsh-base', ...order]
    const result = mergeBundles(bundles, { managedOrder: order })
    expect(result.appended).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.reordered).toBe(false)
    expect(result.bundles).toEqual(bundles)
  })
})

describe('web tool patch rows', () => {
  const enabledPatch = `- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  disabled: false
  config:
    fetch: true
    searchTimeoutMs: 60000
- id: web
  config:
    searchProvider: anysearch
`

  test('a fresh profile needs both rows appended (已存在=no, 需追加=yes)', () => {
    const plan = planToolPatch('[]\n')
    expect(plan.append).toEqual([TOOL_WEB_PATCH, WEB_SEARCH_PATCH])
    expect(plan.toolWeb).toBe('missing')
    expect(plan.web).toBe('missing')
    expect(plan.changed).toBe(true)
  })

  test('already enabled and already pinned is a no-op re-run (已启用)', () => {
    const plan = planToolPatch(enabledPatch)
    expect(plan.append).toEqual([])
    expect(plan.toolWeb).toBe('enabled')
    expect(plan.web).toBe('pinned')
    expect(plan.changed).toBe(false)
  })

  test('an existing but disabled tool-web and a differently pinned web row are repaired', () => {
    const plan = planToolPatch(`- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  disabled: true

- id: web
  config:
    searchProvider: deepseek-official
    fetchProvider: http
`)
    expect(plan.append).toEqual([TOOL_WEB_PATCH, WEB_SEARCH_PATCH])
    expect(plan.toolWeb).toBe('disabled')
    expect(plan.web).toBe('unpinned')
  })

  test('the appended rows are idempotent: planning them back needs nothing', () => {
    const first = planToolPatch('')
    expect(planToolPatch(first.append.join('')).changed).toBe(false)
  })

  test('nested ids under an insert: block and commented ids never count as top-level rows', () => {
    const text = `# - id: tool-web
- insert:
    - id: tool-web
      name: '@deepseek-ai/dsh-tool-web'
      disabled: false
    - id: web
      config:
        searchProvider: anysearch
`
    expect(patchEntryBlock(text, 'tool-web')).toBeNull()
    expect(patchEntryBlock(text, 'web')).toBeNull()
    const plan = planToolPatch(text)
    expect(plan.toolWeb).toBe('missing')
    expect(plan.web).toBe('missing')
  })

  test('an omitted disabled inherits the web-app true, so the row is not treated as enabled', () => {
    const plan = planToolPatch(`- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config:
    fetch: true
`)
    expect(plan.toolWeb).toBe('disabled')
    expect(plan.append).toContain(TOOL_WEB_PATCH)
  })
})

describe('mcp client patch row', () => {
  // The exact form the tui profile uses: nested under a top-level insert list.
  const userRow = `- insert:
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: context7
        transport: streamable-http
        url: https://mcp.context7.com/mcp
`

  test('a fresh profile adds the client row next to the adapter', () => {
    const plan = planMcpPatch('[]\n')
    expect(plan.append).toEqual([MCP_CONTEXT7_PATCH])
    expect(plan.mcp).toBe('missing')
    expect(plan.changed).toBe(true)
    // The row is what makes the adapter's mcp_list non-empty: the official
    // client registers mcp__context7__* which the catalog reads.
    expect(MCP_CONTEXT7_PATCH).toContain("name: '@deepseek-ai/dsh-mcp-client'")
    expect(MCP_CONTEXT7_PATCH).toContain('serverName: context7')
    expect(MCP_CONTEXT7_PATCH).toContain('url: https://mcp.context7.com/mcp')
  })

  test('a nested row counts as configured even though it is not a top-level id', () => {
    expect(hasAnyEntry(userRow, 'mcp-context7')).toBe(true)
    expect(patchEntryBlock(userRow, 'mcp-context7')).toBeNull()
    const plan = planMcpPatch(userRow)
    expect(plan.append).toEqual([])
    expect(plan.mcp).toBe('configured')
    expect(plan.changed).toBe(false)
  })

  test('a user-edited row is never rewritten or duplicated', () => {
    const edited = `- insert:
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: context7
        transport: streamable-http
        url: https://my-proxy.example/mcp
        failOnStartupError: true
`
    expect(planMcpPatch(edited).append).toEqual([])
  })

  test('the appended row is idempotent: planning it back needs nothing', () => {
    const first = planMcpPatch('')
    expect(planMcpPatch(first.append.join('')).changed).toBe(false)
  })

  test('--plugins=none writes no row and never removes an existing one', () => {
    expect(planMcpPatch('', { enabled: false })).toEqual({ append: [], mcp: 'skipped', changed: false })
    expect(planMcpPatch(userRow, { enabled: false })).toEqual({ append: [], mcp: 'skipped', changed: false })
  })
})

describe('progress and verify', () => {
  test('progress lines align the value column exactly like the spec sample', () => {
    expect(formatStep(1, 'profile', 'reusing /dsh/profiles/opentui')).toBe(
      'provision-opentui-profile: [1/5] profile        reusing /dsh/profiles/opentui',
    )
    expect(formatStep(2, 'model route', 'zai-coding-cn/glm-5.3-flash')).toBe(
      'provision-opentui-profile: [2/5] model route    zai-coding-cn/glm-5.3-flash',
    )
    expect(formatStep(3, 'plugins', 'already satisfied (11/11)')).toBe(
      'provision-opentui-profile: [3/5] plugins        already satisfied (11/11)',
    )
    expect(formatStep(4, 'bundles', 'up to date (13 entries)')).toBe(
      'provision-opentui-profile: [4/5] bundles        up to date (13 entries)',
    )
    expect(formatStep(5, 'verify', 'composed 12 layers, 0 skipped')).toBe(
      'provision-opentui-profile: [5/5] verify         composed 12 layers, 0 skipped',
    )
  })

  test('dump-config parsing counts layer headers and surfaces skipped bundles', () => {
    const stdout = ['# == @deepseek-ai/dsh-base', '- id: a', '# == @aiwayds/dsh-cron', '- id: b'].join('\n')
    const stderr = 'dsh: skipping profile bundle "@aiwayds/dsh-opentui": Error: declares no dsh.bundle\n'
    expect(parseDumpConfig(stdout, stderr)).toEqual({
      layers: 2,
      skipped: ['dsh: skipping profile bundle "@aiwayds/dsh-opentui": Error: declares no dsh.bundle'],
    })
    expect(parseDumpConfig('', '')).toEqual({ layers: 0, skipped: [] })
  })

  test('dry run is opt-in via --dry-run or DSH_PROVISION_DRY_RUN=1', () => {
    expect(isDryRun([], {})).toBe(false)
    expect(isDryRun(['--provider', 'x'], {})).toBe(false)
    expect(isDryRun(['--dry-run'], {})).toBe(true)
    expect(isDryRun([], { DSH_PROVISION_DRY_RUN: '1' })).toBe(true)
    expect(isDryRun([], { DSH_PROVISION_DRY_RUN: '0' })).toBe(false)
  })
})
