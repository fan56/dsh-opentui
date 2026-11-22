// Pure decision table for the `opentui-inproc` profile's companion step.
//
// No filesystem I/O, no process spawn and no ambient process.env reads in the
// policy functions: every input is passed in, so the catalog, the selection and
// the per-package install decision are unit-testable without a registry or a
// real dsh profile. Only `queryDistTagLatest` performs I/O, and it takes an
// injectable executor for the same reason.
//
// Why this table exists: the inproc profile is deliberately minimal
// (dsh-base + the in-process bridge + the bridge-owned approval gate). Adding
// every @aiwayds companion "just in case" would pull client UI bundles into a
// headless-ish profile and create new failure modes. Each candidate below is
// judged by whether the inproc assembly has a CONSUMER for it; the ones without
// one are listed explicitly with `defaultOn: false` and are opt-in only.
//
// Reference precedent: dsh-tui-pi 2.38.2's `bin/companion-policy.mjs` +
// `DSH_TUI_COMPANION_LATEST`. The switch name here follows the same style with
// the opentui prefix.

import { execFileSync } from 'node:child_process'

/** Master kill switch. Anything other than 0/false/off (including unset) = enabled. */
export const COMPANION_LATEST_ENV = 'DSH_OPENTUI_COMPANION_LATEST'
/** Opt-in list of additional companions (comma-separated short names or full package names). */
export const COMPANIONS_ENV = 'DSH_OPENTUI_COMPANIONS'

/**
 * The companion catalog.
 *
 * `short` is the token accepted by DSH_OPENTUI_COMPANIONS. `declaredRange` is
 * the caret range used ONLY as a breaking-version guard against a moved
 * `latest` dist-tag (major, plus minor while still 0.x) — it is never
 * installed. `defaultOn` marks the minimal set.
 */
export const COMPANIONS = Object.freeze([
  Object.freeze({
    name: '@aiwayds/dsh-subagent-registry',
    short: 'registry',
    declaredRange: '^0.21.0',
    defaultOn: true,
    reason: 'registers the `use_agent` (by-name custom-agent dispatch) and `ask_agent` follow-up tools; the inproc delegation roster and the APPEND_SYSTEM.md "subagent" vocabulary need a named dispatch entry. Its own cordis.patch.yml mounts it when its bundle is selected.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-ask-router',
    short: 'ask-router',
    declaredRange: '^0.7.0',
    defaultOn: false,
    reason: 'inproc owns the ask surface bridge-side (ask.request frames from packages/bridge/src/ask-registry.ts); no inproc row consumes @aiwayds/dsh-ask-router.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-approval-policy',
    short: 'approval-policy',
    declaredRange: '^0.3.0',
    defaultOn: false,
    reason: 'inproc uses its own bridge /approval-gate row plus @deepseek-ai/dsh-permission-presets; no consumer of the @aiwayds policy plugin.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-llm-net-retry',
    short: 'llm-net-retry',
    declaredRange: '^0.8.0',
    defaultOn: false,
    reason: 'dsh-base already mounts @deepseek-ai/dsh-llm-retry in the inproc assembly; a second retry layer has no consumer.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-model-sync',
    short: 'model-sync',
    declaredRange: '^0.9.0',
    defaultOn: false,
    reason: 'the inproc patch pins its own provider model list; nothing in the profile asks this plugin to sync it.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-llm-stats',
    short: 'llm-stats',
    declaredRange: '^0.9.0',
    defaultOn: false,
    reason: 'token/cost accounting behind /usage; no /usage consumer exists in the inproc client path.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-mcp-adapter',
    short: 'mcp-adapter',
    declaredRange: '^0.8.0',
    defaultOn: false,
    reason: 'the inproc patch carries a mcp-context7 client row, but no inproc row consumes the adapter\'s mcp_list/mcp_call meta-tools; opt-in only.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-web-search-anysearch',
    short: 'web-search',
    declaredRange: '^0.9.0',
    defaultOn: false,
    reason: 'tool-web is enabled in the inproc patch but no search provider is pinned; independent of delegation, opt-in only.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-vault',
    short: 'vault',
    declaredRange: '^0.8.2',
    defaultOn: false,
    reason: 'secret storage; no consumer in the minimal inproc set.',
  }),
])

/** True unless the master switch is explicitly disabled. */
export function companionLatestEnabled(env = process.env) {
  const raw = env[COMPANION_LATEST_ENV]
  if (raw === undefined) return true
  return !['0', 'false', 'off'].includes(String(raw).trim().toLowerCase())
}

/**
 * The companions this launch should satisfy.
 * - master switch off => no companions at all (non-destructive: already
 *   installed packages are left in place, they are just not queried/installed)
 * - DSH_OPENTUI_COMPANIONS unset => the `defaultOn` set (registry only)
 * - explicit list => defaultOn set is replaced by the named entries;
 *   `none` means empty, `all` means the whole catalog.
 */
export function selectCompanions(env = process.env) {
  if (!companionLatestEnabled(env)) return []
  const raw = env[COMPANIONS_ENV]
  if (raw === undefined || String(raw).trim() === '') return COMPANIONS.filter((entry) => entry.defaultOn)
  const tokens = String(raw).split(',').map((token) => token.trim()).filter(Boolean)
  if (tokens.includes('none')) return []
  if (tokens.includes('all')) return [...COMPANIONS]
  return COMPANIONS.filter((entry) => tokens.includes(entry.short) || tokens.includes(entry.name))
}

/** npm dist-tags are usually bare, occasionally v-prefixed. */
export function normalizeVersion(version) {
  return String(version).trim().replace(/^v/, '')
}

function parseCore(version) {
  if (typeof version !== 'string') return null
  const match = /^[v^~><=\s]*(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

function compareCore(a, b) {
  const pa = parseCore(a)
  const pb = parseCore(b)
  if (!pa || !pb) return null
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] - pb[key]
  }
  return 0
}

/** Outcome: { action: 'install'|'skip', spec, reason }. */
const skip = (reason) => ({ action: 'skip', spec: null, reason })
const install = (spec, reason) => ({ action: 'install', spec, reason })

/**
 * Decide one companion's install action.
 *
 * - unresolved dist-tag + already installed => skip (offline: keep the pin)
 * - unresolved dist-tag + nothing installed => install `@latest` (pnpm resolves)
 * - breaking latest vs declaredRange => skip (major change, or minor change
 *   while 0.x — under 0.x the minor IS the breaking boundary)
 * - installed version === latest => skip (idempotent, no add on every launch)
 * - installed version > latest => skip (never downgrade)
 * - otherwise => install the exact `pkg@<resolved>` spec
 */
export function decideCompanionInstall({
  packageName,
  declaredRange,
  resolved = null,
  currentPin = null,
} = {}) {
  const normalized = resolved === null ? null : normalizeVersion(resolved)
  const resolvedCore = parseCore(normalized)
  const declaredCore = parseCore(declaredRange)
  if (!resolvedCore || !declaredCore) {
    return currentPin
      ? skip('unresolved')
      : install(`${packageName}@latest`, 'unresolved')
  }
  if (resolvedCore.major !== declaredCore.major) {
    return skip(`cross_major (${normalized} outside ${declaredRange})`)
  }
  // `^0.21.0` excludes 0.22.0: while major is 0 the minor is the breaking
  // boundary, so a major-only guard would let breaking bumps into the profile.
  if (resolvedCore.major === 0 && resolvedCore.minor !== declaredCore.minor) {
    return skip(`cross_minor (${normalized} outside ${declaredRange})`)
  }
  if (currentPin) {
    const cmp = compareCore(normalized, currentPin)
    if (cmp === null) return skip('unresolved-pin')
    if (cmp === 0) return skip('idempotent')
    if (cmp < 0) return skip(`downgrade (${currentPin} > ${normalized})`)
  }
  return install(`${packageName}@${normalized}`, 'latest')
}

/**
 * Query the `latest` dist-tag. Injectable `exec` keeps this pure in tests.
 * Returns null on any failure (offline / no npm / malformed JSON) — the caller
 * then uses the `@latest` fallback decision above.
 */
export function queryDistTagLatest(name, { cwd, env, exec } = {}) {
  const run = exec ?? execFileSync
  try {
    const out = run('npm', ['view', name, 'dist-tags', '--json'], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    })
    const tags = JSON.parse(typeof out === 'string' ? out : String(out?.stdout ?? ''))
    return typeof tags?.latest === 'string' ? normalizeVersion(tags.latest) : null
  } catch {
    return null
  }
}
