// Pure decision table for the `opentui-monday` profile's companion step.
//
// No filesystem I/O, no process spawn and no ambient process.env reads in the
// policy functions: every input is passed in, so the catalog, the selection and
// the per-package install decision are unit-testable without a registry or a
// real dsh profile. Only the `queryDistTagLatest*` functions perform I/O, and
// they take injectable executors for the same reason.
//
// Why this table exists: the inproc profile is deliberately minimal
// (dsh-base + the in-process bridge + the bridge-owned approval gate). The
// default roster is the D2 user decision recorded on 2026-11-24; package specs
// and version guards live here while the ordered default IDs live in
// companion-policy.mjs.
//
// Reference precedent: dsh-tui-pi 2.38.2's `bin/companion-policy.mjs` +
// `DSH_TUI_COMPANION_LATEST`. The switch name here follows the same style with
// the opentui prefix.

import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { DEFAULT_COMPANION_IDS } from './companion-policy.mjs'

// One `npm view` must never hold provisioning hostage; the batch below adds a
// second, outer bound so a slow registry cannot stretch a launch indefinitely.
export const COMPANION_QUERY_TIMEOUT_MS = 9_000
export const COMPANION_QUERY_BUDGET_MS = 20_000
export const COMPANION_QUERY_CONCURRENCY = 4

/** Master kill switch. Anything other than 0/false/off (including unset) = enabled. */
export const COMPANION_LATEST_ENV = 'DSH_OPENTUI_COMPANION_LATEST'
/** Override list of companions (comma-separated catalog IDs or full package names). */
export const COMPANIONS_ENV = 'DSH_OPENTUI_COMPANIONS'

/**
 * The companion catalog.
 *
 * `short` is the catalog ID accepted by DSH_OPENTUI_COMPANIONS. `declaredRange`
 * is the caret range used ONLY as a breaking-version guard against a moved
 * `latest` dist-tag (major, plus minor while still 0.x) — it is never
 * installed. `defaultOn` marks the D2 default roster.
 */
export const COMPANIONS = Object.freeze([
  Object.freeze({
    name: '@aiwayds/dsh-subagent-registry',
    short: 'registry',
    declaredRange: '^0.25.0',
    defaultOn: true,
    reason: 'registers the `use_agent` (by-name custom-agent dispatch) and `ask_agent` follow-up tools; the inproc delegation roster and the APPEND_SYSTEM.md "subagent" vocabulary need a named dispatch entry. Its own cordis.patch.yml mounts it when its bundle is selected.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-ask-router',
    short: 'ask-router',
    declaredRange: '^0.8.0',
    defaultOn: true,
    reason: 'retained by the D2 user decision to own the ask surface for companion UI bundles.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-approval-policy',
    short: 'approval-policy',
    declaredRange: '^0.3.0',
    defaultOn: true,
    reason: 'retained by the D2 user decision for tool-approval policy shared with shell approval cards.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-llm-net-retry',
    short: 'llm-net-retry',
    declaredRange: '^0.8.0',
    defaultOn: true,
    reason: 'retained by the D2 user decision to retry transient provider and network failures.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-model-sync',
    short: 'model-sync',
    declaredRange: '^0.11.0',
    defaultOn: true,
    reason: 'retained by the D2 user decision to keep the profile model list in sync with the provider catalog.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-llm-stats',
    short: 'llm-stats',
    declaredRange: '^0.9.0',
    defaultOn: true,
    reason: 'retained by the D2 user decision for token and cost accounting behind /usage.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-mcp-adapter',
    short: 'mcp-adapter',
    declaredRange: '^0.8.0',
    defaultOn: true,
    reason: 'retained by the D2 user decision for MCP catalog and dispatch meta-tools paired with the context7 server row.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-vault',
    short: 'vault',
    declaredRange: '^0.8.2',
    defaultOn: true,
    reason: 'retained by the D2 user decision for secret storage used by companion plugins.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-web-search-anysearch',
    short: 'web-search',
    declaredRange: '^0.9.0',
    defaultOn: true,
    reason: 'retained by the D2 user decision for web search without a per-provider key.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-topics-memory',
    short: 'topics-memory',
    declaredRange: '^0.26.0',
    defaultOn: true,
    reason: 'added by the D2 user decision for cross-session topic memory.',
  }),
  Object.freeze({
    name: '@aiwayds/dsh-cron',
    short: 'cron',
    declaredRange: '^0.7.0',
    defaultOn: true,
    reason: 'added by the D2 user decision for scheduled prompts.',
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
 * - DSH_OPENTUI_COMPANIONS unset => DEFAULT_COMPANION_IDS, in policy order
 * - explicit list => default set is replaced by the named entries;
 *   `none` means empty, `all` means the whole catalog.
 */
export function selectCompanions(env = process.env) {
  if (!companionLatestEnabled(env)) return []
  const raw = env[COMPANIONS_ENV]
  if (raw === undefined || String(raw).trim() === '') {
    return DEFAULT_COMPANION_IDS
      .map((id) => COMPANIONS.find((entry) => entry.short === id))
      .filter(Boolean)
  }
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
  // `^0.22.0` excludes 0.23.0: while major is 0 the minor is the breaking
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
      timeout: COMPANION_QUERY_TIMEOUT_MS,
    })
    const tags = JSON.parse(typeof out === 'string' ? out : String(out?.stdout ?? ''))
    return typeof tags?.latest === 'string' ? normalizeVersion(tags.latest) : null
  } catch {
    return null
  }
}

const execFileAsync = promisify(execFile)

/** Async twin of `queryDistTagLatest`, used by the bounded concurrent batch. */
export async function queryDistTagLatestAsync(name, { cwd, env, exec } = {}) {
  const run = exec ?? execFileAsync
  try {
    const out = await run('npm', ['view', name, 'dist-tags', '--json'], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: COMPANION_QUERY_TIMEOUT_MS,
    })
    const stdout = typeof out === 'string' ? out : String(out?.stdout ?? '')
    const tags = JSON.parse(stdout)
    return typeof tags?.latest === 'string' ? normalizeVersion(tags.latest) : null
  } catch {
    return null
  }
}

/**
 * Query every name with bounded concurrency and a total wall-clock budget.
 *
 * Results land at the INPUT index (never completion order), so callers stay
 * deterministic. A per-item failure — including a thrown injected query — is
 * swallowed into `null`, which is exactly the existing "unresolved" fallback;
 * provisioning never aborts because one registry lookup failed or timed out.
 * New lookups stop once the budget is spent; lookups already in flight still
 * settle on their own shorter timeout.
 */
export async function queryDistTagLatestBatch(
  names,
  {
    cwd,
    env,
    query = queryDistTagLatestAsync,
    concurrency = COMPANION_QUERY_CONCURRENCY,
    budgetMs = COMPANION_QUERY_BUDGET_MS,
    now = () => Date.now(),
  } = {},
) {
  const results = new Array(names.length).fill(null)
  const deadline = now() + budgetMs
  let cursor = 0
  const worker = async () => {
    while (cursor < names.length && now() < deadline) {
      const index = cursor++
      try {
        results[index] = await query(names[index], { cwd, env })
      } catch {
        results[index] = null
      }
    }
  }
  const lanes = Math.max(1, Math.min(concurrency, names.length))
  await Promise.all(Array.from({ length: lanes }, worker))
  return results
}

/** One summary line for skipped companions, or null when every one succeeded. */
export function formatSkippedCompanionsWarning(shortNames = []) {
  if (shortNames.length === 0) return null
  return `${shortNames.length} companion(s) skipped (version query failed or outside declared range): ${shortNames.join(', ')}`
}
