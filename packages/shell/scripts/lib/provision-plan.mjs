// Pure planning logic for provision-opentui-profile.mjs.
//
// Nothing in this module touches the filesystem or spawns a process: the
// script feeds it a profile manifest it read, and the unit tests feed it
// fixtures. That split is what makes the idempotency rules (dep present,
// node_modules version satisfies, bundle entry present) testable without a
// network or a real dsh profile.

export const PROFILE = 'opentui'
export const PREFIX = 'provision-opentui-profile: '
export const STEPS = 5
export const DEFAULT_TIER = 'recommended'
export const TIERS = ['core', 'recommended', 'none']

// The plugin set this launcher ships with. `reason` is printed by
// `--dry-run --plugins=<tier>` style troubleshooting and documents WHY a
// package is in the set, so a future reader can re-judge the decision.
//
// Ordering contract: `@aiwayds/dsh-ask-router` MUST stay first among the
// UI/ask bundles — it owns the ask surface every later UI bundle attaches to.
// `selectPlugins()` preserves this array's order, and the installer appends
// bundle entries in that order.
export const PLUGIN_SET = [
  {
    name: '@aiwayds/dsh-ask-router',
    version: '0.7.0',
    tier: 'core',
    reason: 'owns the ask surface; must load before any other UI/ask bundle',
  },
  {
    name: '@aiwayds/dsh-subagent-registry',
    version: '0.19.1',
    tier: 'core',
    reason: 'subagent discovery and registration for the shell',
  },
  {
    name: '@aiwayds/dsh-llm-net-retry',
    version: '0.8.0',
    tier: 'core',
    reason: 'retries transient provider/network failures',
  },
  {
    name: '@aiwayds/dsh-web-search-anysearch',
    version: '0.9.0',
    tier: 'core',
    reason: 'web search without a per-provider key',
  },
  {
    name: '@aiwayds/dsh-approval-policy',
    version: '0.3.0',
    tier: 'core',
    reason: 'tool-approval policy shared with the shell approval cards',
  },
  {
    name: '@aiwayds/dsh-model-sync',
    version: '0.9.0',
    tier: 'core',
    reason: 'keeps the profile model list in sync with the provider catalog',
  },
  {
    name: '@aiwayds/dsh-llm-stats',
    version: '0.9.0',
    tier: 'recommended',
    reason: 'token/cost accounting behind /usage',
  },
  {
    name: '@aiwayds/dsh-topics-memory',
    version: '0.26.0',
    tier: 'recommended',
    reason: 'cross-session topic memory',
  },
  {
    name: '@aiwayds/dsh-cron',
    version: '0.7.0',
    tier: 'recommended',
    reason: 'scheduled prompts',
  },
  {
    name: '@aiwayds/dsh-workflow',
    version: '0.2.1',
    tier: 'recommended',
    reason: 'dynamic workflow runs',
  },
  {
    name: '@aiwayds/dsh-vault',
    version: '0.8.0',
    tier: 'recommended',
    reason: 'secret storage used by the companion plugins',
  },
]

// Deliberately NOT installed. Kept explicit so a reviewer can see the
// decision instead of inferring it from an absence.
export const EXCLUDED_PLUGINS = [
  { name: '@aiwayds/dsh-tui-pi', reason: 'takes over stdout/stdin — hard conflict with the opentui client' },
  { name: '@aiwayds/dsh-dcp', reason: 'web-app-preset isolated; an idle no-op in this profile' },
  { name: '@aiwayds/dsh-feishu', reason: 'claims the ask surface and does not fall back' },
  { name: '@aiwayds/dsh-agent-dispatch', reason: 'not part of the shell workflow' },
  { name: '@aiwayds/dsh-self-improve', reason: 'not part of the shell workflow' },
  { name: '@aiwayds/dsh-llm-proxy', reason: 'not part of the shell workflow' },
  { name: '@aiwayds/dsh-web-search-tavily', reason: 'requires an API key' },
  { name: '@aiwayds/dsh-profile-switch', reason: 'profile switching is the launcher\'s job' },
]

// Entries a historic opentui profile may still carry. `@aiwayds/dsh-opentui`
// is the retired plugin-mode package: the global 0.9.2 declares no
// `dsh.bundle`, so every boot prints a "skipping profile bundle" warning, and
// the profile's dependency pointed at a tgz that no longer exists.
export const RETIRED_PROFILE_ENTRIES = ['@aiwayds/dsh-opentui']

/** Parse the `--plugins=` value (or the DSH_OPENTUI_PLUGINS env override).
 *  Throws on an unknown tier so a typo cannot silently install nothing. */
export function parseTier(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_TIER
  const tier = String(value).trim().toLowerCase()
  if (!TIERS.includes(tier)) {
    throw new Error(`unknown plugin tier ${JSON.stringify(value)} — expected one of: ${TIERS.join(', ')}`)
  }
  return tier
}

/** True when the run must only print the commands it would execute. */
export function isDryRun(argv = [], env = {}) {
  return argv.includes('--dry-run') || env.DSH_PROVISION_DRY_RUN === '1'
}

/** The plugins a tier installs, in install order. `recommended` is a superset
 *  of `core`; `none` installs nothing. */
export function selectPlugins(tier) {
  if (tier === 'none') return []
  const wanted = tier === 'core' ? ['core'] : ['core', 'recommended']
  return PLUGIN_SET.filter((plugin) => wanted.includes(plugin.tier))
}

/** package@version specs for `dsh plugin ... add`. */
export function installSpecs(plugins) {
  return plugins.map((plugin) => `${plugin.name}@${plugin.version}`)
}

/** argv tail for the single batched install. */
export function pluginAddArgs(profile, specs) {
  return ['plugin', '--profile', profile, 'add', ...specs]
}

/** Human-readable form of `pluginAddArgs` (used by the progress line). */
export function pluginAddCommand(profile, specs) {
  return ['dsh', ...pluginAddArgs(profile, specs)].join(' ')
}

/** Format one progress line: `[n/m] label` with the value column aligned.
 *  Mirrors dsh-tui-pi's onboarding output, with the script name as prefix. */
export function formatStep(step, label, value = '') {
  return `${PREFIX}[${step}/${STEPS}] ${String(label).padEnd(15)}${value}`
}

// ---------------------------------------------------------------------------
// Versions — a deliberately small semver subset: exact, ^, ~, >=.
// ---------------------------------------------------------------------------
export function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(version).trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : [],
  }
}

/** -1 / 0 / 1; unparsable versions compare equal (callers treat that as
 *  "unknown, do not downgrade"). */
export function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return 0
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1
  if (pb.pre.length === 0) return -1
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i += 1) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = Number.parseInt(x, 10)
    const yn = Number.parseInt(y, 10)
    if (!Number.isNaN(xn) && !Number.isNaN(yn) && xn !== yn) return xn < yn ? -1 : 1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** Does `installed` satisfy the `wanted` requirement? An empty/unknown
 *  `installed` never satisfies. */
export function satisfiesVersion(installed, wanted) {
  const got = parseVersion(installed)
  if (!got) return false
  const wantedText = String(wanted ?? '').trim()
  if (wantedText === '' || wantedText === '*' || wantedText === 'latest') return true
  const cmp = compareVersions(installed, wantedText.replace(/^[\^~]|^>=/, ''))
  if (/^\^/.test(wantedText)) {
    const want = parseVersion(wantedText.slice(1))
    if (!want) return false
    if (want.major > 0) return got.major === want.major && cmp >= 0
    if (want.minor > 0) return got.major === 0 && got.minor === want.minor && cmp >= 0
    return got.major === 0 && got.minor === 0 && got.patch === want.patch
  }
  if (/^~/.test(wantedText)) {
    const want = parseVersion(wantedText.slice(1))
    if (!want) return false
    return got.major === want.major && got.minor === want.minor && cmp >= 0
  }
  if (/^>=/.test(wantedText)) return cmp >= 0
  return cmp === 0
}

/** Dep specs that point somewhere other than the registry (`link:`, `file:`,
 *  `workspace:`, `portal:`). A profile that pins a plugin this way is a local
 *  development setup — the installer must not replace it with a registry
 *  version, so such a dep always counts as satisfied. */
export function isLocalSpec(spec) {
  return typeof spec === 'string' && /^(?:link|file|workspace|portal):/.test(spec)
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Decide what a run must do for one tier. Pure: every filesystem fact arrives
 * in the inputs.
 *
 * Idempotency rule (all three must hold for a plugin to count as satisfied):
 *   1. the package is a `dependencies` entry in the profile manifest
 *   2. `node_modules/<pkg>/package.json` exists (its version is passed in)
 *   3. that version satisfies the pinned version
 * A dep pinned with a local spec (link/file/workspace) skips 2/3: the local
 * pin wins and is never replaced.
 *
 * @param {{tier: string, dependencies?: Record<string,string>, bundles?: string[], installedVersions?: Record<string,string>}} input
 * @returns {{
 *   total: number,
 *   satisfied: number,
 *   install: Array<{name: string, spec: string, reason: string}>,
 *   missingBundles: string[],
 *   managedOrder: string[],
 * }}
 */
export function planPluginInstall({ tier, dependencies = {}, bundles = [], installedVersions = {} }) {
  const plugins = selectPlugins(tier)
  const install = []
  const missingBundles = []
  const managedOrder = plugins.map((plugin) => plugin.name)

  for (const plugin of plugins) {
    const depSpec = dependencies[plugin.name]
    const installed = installedVersions[plugin.name]
    const depOk = depSpec !== undefined && (isLocalSpec(depSpec) || satisfiesVersion(installed, plugin.version))
    if (!depOk) {
      install.push({ name: plugin.name, spec: `${plugin.name}@${plugin.version}`, reason: plugin.reason })
      continue
    }
    if (!bundles.includes(plugin.name)) missingBundles.push(plugin.name)
  }

  return {
    total: plugins.length,
    // "satisfied" counts plugins that need no work at all (dep + bundle).
    satisfied: plugins.length - install.length - missingBundles.length,
    install,
    missingBundles,
    managedOrder,
  }
}

/**
 * Merge bundle selection: drop retired entries, append missing managed
 * entries, and keep the managed subset in `managedOrder` (the ask-router-first
 * contract) without disturbing unmanaged entries.
 *
 * @param {string[]} bundles
 * @param {{managedOrder?: string[], retire?: string[]}} input
 * @returns {{bundles: string[], appended: string[], removed: string[], reordered: boolean}}
 */
export function mergeBundles(bundles, { managedOrder = [], retire = [] } = {}) {
  const removed = bundles.filter((name) => retire.includes(name))
  let next = bundles.filter((name) => !retire.includes(name))

  const appended = []
  for (const name of managedOrder) {
    if (!next.includes(name)) {
      next.push(name)
      appended.push(name)
    }
  }

  // Reorder ONLY the managed slots: take the positions managed names currently
  // occupy and refill them in managedOrder. Unmanaged entries keep their
  // index, so dsh-base / dsh-web-app keep loading first.
  const managedSet = new Set(managedOrder)
  const slots = []
  next.forEach((name, index) => {
    if (managedSet.has(name)) slots.push(index)
  })
  const present = managedOrder.filter((name) => next.includes(name))
  const reordered = slots.some((slot, i) => next[slot] !== present[i])
  if (reordered) {
    const copy = [...next]
    slots.forEach((slot, i) => {
      copy[slot] = present[i]
    })
    next = copy
  }

  return { bundles: next, appended, removed, reordered }
}

/** Remove retired packages from the dependency map. */
export function cleanupDependencies(dependencies, retire = RETIRED_PROFILE_ENTRIES) {
  const next = { ...dependencies }
  const removed = []
  for (const name of retire) {
    if (name in next) {
      delete next[name]
      removed.push(name)
    }
  }
  return { dependencies: next, removed }
}

// ---------------------------------------------------------------------------
// Profile patch rows for the model-facing web tools
//
// The @deepseek-ai/dsh-web-app bundle disables the ambient `tool-web` row
// (`disabled: true`) and recomposes it per agent preset. The opentui profile's
// default preset resolves to `native` (an empty preset), so nothing turns the
// row back on and the model sees no `web_search`/`web_fetch`. These two rows
// are appended to the profile patch (the last layer, so they win per id):
//
//   - tool-web  re-enables the ambient row with the shipped tool defaults
//   - web       pins the vendor-neutral search provider (anysearch needs no
//               key); the identical row ships in the anysearch bundle patch,
//               repeated here so the profile patch stays self-describing and
//               keeps the choice when `--plugins=none` skips that bundle
//
// Idempotency follows the model-route rule but checks the row's *state*, not
// just its id: a row that is already enabled / pinned is left untouched (a
// re-run never duplicates it and never rewrites a config the user edited).
// ---------------------------------------------------------------------------
export const TOOL_WEB_PATCH = `- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  disabled: false
  config:
    fetch: true
    searchTimeoutMs: 60000
`
export const WEB_SEARCH_PATCH = `- id: web
  config:
    searchProvider: anysearch
`

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The raw text of the first TOP-LEVEL `- id: <id>` entry, or null. Nested
 *  ids (`- insert:` rows are indented) never match: the pattern anchors the
 *  dash at column 0, the same rule the script's model-route check uses. The
 *  block runs to the next column-0 `- ` line. */
export function patchEntryBlock(text, id) {
  const lines = String(text ?? '').split('\n')
  const idPattern = new RegExp(`^- id: ${escapeRegExp(id)}\\s*$`)
  const start = lines.findIndex((line) => idPattern.test(line))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^- /.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

/** The value of a key at the entry's own indentation (two spaces), ignoring
 *  comments and blank lines. Nested keys are indented deeper and do not match. */
function entryValue(block, key) {
  const pattern = new RegExp(`^  ${escapeRegExp(key)}:[ \\t]*(.*?)[ \\t]*$`, 'm')
  const match = pattern.exec(block)
  return match ? match[1] : undefined
}

/** True when the row itself states `disabled: false`. An omitted `disabled`
 *  inherits the earlier layer's value (the web-app row is `disabled: true`),
 *  so only an explicit false counts as enabled. */
export function isEntryEnabled(block) {
  const value = entryValue(block, 'disabled')
  return value !== undefined && /^(?:false|False|FALSE)$/.test(value)
}

/** True when the row's `config:` block pins `searchProvider: <provider>`. A
 *  config block is one map replaced wholesale by an id-targeted patch row, so
 *  only the configured provider id counts; an unset provider auto-selects. */
export function pinsSearchProvider(block, provider) {
  const lines = block.split('\n')
  const configStart = lines.findIndex((line) => /^  config:[ \t]*$/.test(line))
  if (configStart < 0) return false
  for (let i = configStart + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    if ((/^\s*/.exec(line)?.[0].length ?? 0) <= 2) break
    const match = /^ {3,}searchProvider:[ \t]*(.*?)[ \t]*$/.exec(line)
    if (match) return match[1].replace(/^['"]|['"]$/g, '') === provider
  }
  return false
}

/**
 * Plan the web-tool rows a profile patch still needs. Pure: the caller passes
 * the patch text it read.
 *
 * @param {string} existingText
 * @returns {{
 *   append: string[],
 *   toolWeb: 'missing'|'disabled'|'enabled',
 *   web: 'missing'|'unpinned'|'pinned',
 *   changed: boolean,
 * }}
 */
export function planToolPatch(existingText = '') {
  const toolWebBlock = patchEntryBlock(existingText, 'tool-web')
  const webBlock = patchEntryBlock(existingText, 'web')
  const toolWebEnabled = toolWebBlock !== null && isEntryEnabled(toolWebBlock)
  const webPinned = webBlock !== null && pinsSearchProvider(webBlock, 'anysearch')

  return {
    append: [...(toolWebEnabled ? [] : [TOOL_WEB_PATCH]), ...(webPinned ? [] : [WEB_SEARCH_PATCH])],
    toolWeb: toolWebBlock === null ? 'missing' : toolWebEnabled ? 'enabled' : 'disabled',
    web: webBlock === null ? 'missing' : webPinned ? 'pinned' : 'unpinned',
    changed: !toolWebEnabled || !webPinned,
  }
}

// ---------------------------------------------------------------------------
// Verify (dsh opentui --dump-config)
// ---------------------------------------------------------------------------
export function parseDumpConfig(stdout = '', stderr = '') {
  const layers = String(stdout)
    .split('\n')
    .filter((line) => /^# == /.test(line)).length
  const skipped = String(stderr)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('skipping profile bundle'))
  return { layers, skipped }
}
