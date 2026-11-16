// Pure planning logic for the `upgrade` subcommand and for the downgrade
// guard that provisioning shares with it.
//
// Same split as provision-plan.mjs (see its header): no filesystem, no
// child_process, no network. The caller reads `.npmrc` files, spawns
// `npm view`, and writes the override file; this module only decides what
// those actions should be, so every decision is unit-testable from plain
// fixtures.
//
// Version ordering is NOT re-implemented here. provision-plan.mjs already
// exports parseVersion/compareVersions (a deliberately small semver subset)
// and owns the shipped pins, so both the upgrade command and provisioning
// must judge "newer" with the same rule; a second copy would be free to drift.

import { compareVersions, parseVersion, resolveEffectivePin } from './provision-plan.mjs'

export const OFFICIAL_REGISTRY = 'https://registry.npmjs.org'

// ---------------------------------------------------------------------------
// Registry resolution
// ---------------------------------------------------------------------------

/** A .npmrc value ends at a `#` comment; surrounding quotes are optional.
 *  npm allows `key = "value"` and `registry=https://host/` alike. */
function cleanRegistryValue(raw) {
  let text = String(raw)
  const comment = text.indexOf('#')
  if (comment !== -1) text = text.slice(0, comment)
  text = text.trim()
  const quoted = /^(['"])(.*)\1$/.exec(text)
  if (quoted) text = quoted[2].trim()
  return text
}

function stripTrailingSlashes(value) {
  return String(value).replace(/\/+$/, '')
}

/** Last `registry=` line across all texts wins: later files override earlier
 *  ones, and inside one file the last assignment wins, which is how npm's
 *  own config layering behaves. */
function registryFromNpmrcTexts(npmrcTexts) {
  let found = ''
  for (const text of npmrcTexts) {
    if (typeof text !== 'string') continue
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*registry\s*=\s*(.+)$/i.exec(line)
      if (!match) continue
      const value = cleanRegistryValue(match[1])
      if (value) found = value
    }
  }
  return found
}

/**
 * Where the `npm view` query should go.
 *
 * Priority: DSH_UPGRADE_REGISTRY (explicit operator override) -> the npmrc
 * texts the caller read, last one winning -> the public registry.
 *
 * `npmrcTexts` is a list of file *contents*, not paths: this module does no
 * IO, and the caller decides which files apply (user, global, profile).
 * The returned registry never ends with `/` so argv and string comparisons
 * stay canonical.
 *
 * @param {{ env?: Record<string, string|undefined>, npmrcTexts?: string[] }} [input]
 * @returns {{ registry: string, source: 'env'|'npmrc'|'default' }}
 */
export function resolveRegistry({ env = {}, npmrcTexts = [] } = {}) {
  const rawEnv = env && typeof env === 'object' ? env.DSH_UPGRADE_REGISTRY : undefined
  const fromEnv = typeof rawEnv === 'string' ? stripTrailingSlashes(cleanRegistryValue(rawEnv)) : ''
  if (fromEnv) return { registry: fromEnv, source: 'env' }

  const fromNpmrc = stripTrailingSlashes(registryFromNpmrcTexts(Array.isArray(npmrcTexts) ? npmrcTexts : []))
  if (fromNpmrc) return { registry: fromNpmrc, source: 'npmrc' }

  return { registry: OFFICIAL_REGISTRY, source: 'default' }
}

/**
 * Is this the public npm registry (as opposed to a mirror)? A mirror can lag
 * behind upstream, which is worth a warning line in the plan output.
 * Accepts the bare host and both URL spellings, with or without a trailing
 * slash; the path and protocol are otherwise ignored.
 */
export function isOfficialRegistry(registry) {
  if (typeof registry !== 'string') return false
  return /^(?:https?:\/\/)?registry\.npmjs\.org\/*$/i.test(registry.trim())
}

/**
 * argv for `npm view <pkg> dist-tags --json`.
 *
 * `dist-tags` returns every tag (latest, next, ...) in one call, so a single
 * invocation answers "what would --tag next resolve to" as well.
 *
 * `--prefer-online` is mandatory: without it npm answers from its local cache
 * (including negative cache entries), so a freshly published version can be
 * invisible for hours. `--registry` is mandatory too, because the machine's
 * configured registry may be a lagging mirror.
 *
 * `--fetch-retries 0` and `--fetch-timeout 20000` are part of the query, not a
 * tuning afterthought: an unreachable registry otherwise costs npm's default
 * retry ladder (2 retries with backoff) per package, which made a `--dry-run`
 * against a dead host take minutes before reporting `query-failed`. An
 * unreachable host is answered either way — only the wait differs, and no
 * retry can turn it into an answer.
 *
 * @param {{ pkg: string, registry: string }} input
 * @returns {string[]}
 */
export function buildViewArgs({ pkg, registry } = {}) {
  if (typeof pkg !== 'string' || pkg === '') {
    throw new TypeError('buildViewArgs: pkg must be a non-empty string')
  }
  if (typeof registry !== 'string' || registry === '') {
    throw new TypeError('buildViewArgs: registry must be a non-empty string')
  }
  return [
    'view',
    pkg,
    'dist-tags',
    '--json',
    '--registry',
    registry,
    '--prefer-online',
    '--fetch-retries',
    '0',
    '--fetch-timeout',
    '20000',
  ]
}

// ---------------------------------------------------------------------------
// Which dependencies the upgrade command may touch
// ---------------------------------------------------------------------------

const NON_REGISTRY_SPEC = /^(?:link|file|workspace|portal):|^(?:git\+|https?:)/i

/**
 * May the upgrade command replace this dependency's spec with a registry
 * version?
 *
 * Never: host-closure packages (`@deepseek-ai/*`) — the host pins those and a
 * profile-local upgrade would fight it — and specs that do not point at a
 * registry (`link:`, `file:`, `workspace:`, `portal:`, `git+`, `http(s):`),
 * e.g. the profile's local `link:` dev dependency.
 * Everything else (caret, tilde, exact, `*`) is upgradable; a non-string spec
 * is not, because there is nothing to resolve.
 */
export function isUpgradableDependency(name, spec) {
  if (typeof name !== 'string' || name.startsWith('@deepseek-ai/')) return false
  if (typeof spec !== 'string') return false
  return !NON_REGISTRY_SPEC.test(spec.trim())
}

/** The exact version a spec names, if it names one (`1.2.3`, `=1.2.3`);
 *  ranges (`^1.2.3`, `~1.2.3`, `*`) answer null. */
function exactVersionFromSpec(spec) {
  if (typeof spec !== 'string') return null
  const text = spec.trim().replace(/^=\s*/, '')
  return parseVersion(text) ? text : null
}

function byName(a, b) {
  if (a.name === b.name) return 0
  return a.name < b.name ? -1 : 1
}

const ACTION_ORDER = ['upgrade', 'latest', 'excluded', 'query-failed']
const COUNT_KEY = {
  upgrade: 'upgrade',
  latest: 'latest',
  excluded: 'excluded',
  'query-failed': 'queryFailed',
}

/**
 * Turn "manifest deps + installed versions + registry answers" into the plan
 * table the command prints and executes.
 *
 * Per dependency:
 *   - `excluded`     — isUpgradableDependency says no (checked first)
 *   - `query-failed` — the caller has no dist-tag answer for the package
 *   - `latest`       — installed version equals the registry target
 *   - `upgrade`      — everything else, including "installed unknown"
 *
 * `current` prefers the version on disk (`installedVersions`); when the caller
 * could not read it, the exact version in the spec is the best available
 * truth. `null` means unknown and is never treated as up to date.
 * `target` is null only for rows that have no registry answer (`query-failed`).
 *
 * Row order is stable: upgrades first (by name), then latest, excluded, and
 * query-failed, each sorted by name, so two runs over the same inputs print
 * the same table.
 *
 * `tag` names the dist-tag the caller queried; its value already lives in
 * `latestByPkg`, so this function does not need it. It stays in the signature
 * because the plan header reports it.
 *
 * @param {{
 *   deps: Record<string, string>,
 *   installedVersions?: Record<string, string>,
 *   latestByPkg?: Record<string, string>,
 *   tag?: string,
 * }} input
 * @returns {{
 *   rows: Array<{ name: string, currentSpec: string, current: string|null, target: string|null, action: 'upgrade'|'latest'|'excluded'|'query-failed' }>,
 *   counts: { upgrade: number, latest: number, excluded: number, queryFailed: number },
 * }}
 */
export function buildUpgradePlan({ deps, installedVersions = {}, latestByPkg = {}, tag = 'latest' } = {}) {
  const dependencies = deps && typeof deps === 'object' ? deps : {}
  const installed = installedVersions && typeof installedVersions === 'object' ? installedVersions : {}
  const latest = latestByPkg && typeof latestByPkg === 'object' ? latestByPkg : {}
  void tag // documented above: the caller has already resolved it into latestByPkg

  const rows = []
  for (const [name, spec] of Object.entries(dependencies)) {
    const currentSpec = typeof spec === 'string' ? spec : null
    const rawInstalled = installed[name]
    const current =
      typeof rawInstalled === 'string' && rawInstalled !== ''
        ? rawInstalled
        : exactVersionFromSpec(currentSpec)
    const rawTarget = latest[name]
    const target = typeof rawTarget === 'string' && rawTarget !== '' ? rawTarget : null

    let action
    if (!isUpgradableDependency(name, currentSpec)) action = 'excluded'
    else if (target === null) action = 'query-failed'
    else if (current !== null && current === target) action = 'latest'
    else action = 'upgrade'

    rows.push({ name, currentSpec, current, target, action })
  }

  const counts = { upgrade: 0, latest: 0, excluded: 0, queryFailed: 0 }
  for (const row of rows) counts[COUNT_KEY[row.action]] += 1

  const ordered = []
  for (const action of ACTION_ORDER) {
    ordered.push(...rows.filter((row) => row.action === action).sort(byName))
  }

  return { rows: ordered, counts }
}

// ---------------------------------------------------------------------------
// upgrade-overrides.json — the file that stops the next start from
// downgrading a package the upgrade command raised above the shipped pin.
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An entry is either the bare version string or an object carrying a
 *  `version` (e.g. `{ version, shippedPin, updatedAt }`). The bare form is
 *  accepted for hand-written files; the object form is what the command
 *  writes and what provisioning reads. */
function entryVersion(entry) {
  if (typeof entry === 'string') return entry.trim()
  if (isPlainObject(entry) && typeof entry.version === 'string') return entry.version.trim()
  return null
}

/** The name -> entry map of an override document. Both shapes are accepted
 *  because the reader that feeds provisioning returns the inner map while the
 *  command works with the whole document; `packages` wins when both exist. */
function overridePackageMap(overrides) {
  if (!isPlainObject(overrides)) return {}
  if (isPlainObject(overrides.packages)) return overrides.packages
  return overrides
}

/**
 * Parse the override document text. Returns null when the document as a whole
 * is unusable (bad JSON, not an object, no usable `packages` object) — the
 * caller maps null to "no overrides", never to an error.
 *
 * A single malformed entry (no version string) is dropped instead of failing
 * the file: one hand-edit typo must not silently disable the other pins.
 * Surviving entries keep their shape — a string stays a string, an object keeps
 * its metadata (`shippedPin`, `updatedAt`) — so a read/serialize round trip
 * does not destroy fields this module does not interpret. Neither `version`
 * nor the entry's semver validity is enforced here (pickEffectivePin judges
 * validity, so a bad version can still be reported and cleaned up).
 *
 * @param {string} text
 * @returns {{ version: number, packages: Record<string, string|{version: string}> } | null}
 */
export function parseOverrides(text) {
  let doc
  try {
    doc = JSON.parse(String(text ?? ''))
  } catch {
    return null
  }
  if (!isPlainObject(doc)) return null
  if (!isPlainObject(doc.packages)) return null

  const packages = {}
  for (const [name, entry] of Object.entries(doc.packages)) {
    if (name === '') continue
    const version = entryVersion(entry)
    if (version === null || version === '') continue
    packages[name] = typeof entry === 'string' ? version : { ...entry, version }
  }

  return { version: Number.isInteger(doc.version) ? doc.version : 1, packages }
}

/**
 * Stable serialization: two-space JSON, trailing newline, `packages` keys in
 * lexicographic order. Stability matters because the file is written after
 * every upgrade and lives in a directory users inspect and diff; insertion
 * order must not leak into the bytes.
 *
 * @param {{ packages?: Record<string, string>, [key: string]: unknown }} obj
 * @returns {string}
 */
export function serializeOverrides(obj) {
  if (!isPlainObject(obj)) throw new TypeError('serializeOverrides: expected a plain object')
  const packages = isPlainObject(obj.packages) ? obj.packages : {}
  const sorted = {}
  for (const name of Object.keys(packages).sort()) sorted[name] = packages[name]
  return `${JSON.stringify({ ...obj, packages: sorted }, null, 2)}\n`
}

/**
 * Should an override be written for this package?
 *
 * Only when the override is strictly newer than the shipped pin. Equal means
 * the product has caught up (the pin now does the job), older means the
 * override would downgrade, and an unparsable version cannot be judged at
 * all. In all three cases writing would either be useless or harmful.
 *
 * This is the single verdict both writers and readers share: provisioning
 * must ignore an override under exactly the same conditions, or the upgrade
 * command writes pins that the next start silently rejects (or honours when
 * it should not).
 *
 * @param {{ overrideVersion?: string, shippedPin?: string }} input
 * @returns {boolean}
 */
export function shouldWriteOverride({ overrideVersion, shippedPin } = {}) {
  if (!parseVersion(overrideVersion) || !parseVersion(shippedPin)) return false
  return compareVersions(overrideVersion, shippedPin) > 0
}

/**
 * Which version provisioning should require for one plugin.
 *
 * DELEGATES the decision to provision-plan's `resolveEffectivePin`: that
 * function is the single authority, and a second copy here would be free to
 * drift and let the upgrade command write pins the next start ignores. This
 * wrapper only keeps the richer `{ pin, overridden, ignoredReason }` shape the
 * command logs, by classifying *why* a present entry did not win.
 *
 * `overrides` is the parsed document ({ version, packages }) or the inner
 * name -> entry map that a reader returns; both are accepted. Behaviour (all
 * inherited from resolveEffectivePin):
 *   - name absent                          -> shipped pin, overridden: false
 *   - override equal to / older than pin   -> shipped pin, ignoredReason 'stale'
 *   - override or entry shape invalid      -> shipped pin, ignoredReason 'invalid'
 *   - name outside PLUGIN_SET (allowlist)  -> shipped pin, ignoredReason 'unmanaged'
 *   - otherwise                            -> override version, overridden: true
 *
 * `ignoredReason` is only present when an override existed and was ignored;
 * `pin` is always safe to use. 'unmanaged' exists because the allowlist lives
 * in provision-plan: an otherwise valid, newer entry for a package the
 * launcher does not manage can never take effect, and that is worth saying
 * instead of mislabelling it 'stale'.
 *
 * @param {{
 *   name: string,
 *   shippedPin: string,
 *   overrides?: { version?: number, packages?: Record<string, string|{version?: string}> } | Record<string, string|{version?: string}> | null,
 * }} input
 * @returns {{ pin: string, overridden: boolean, ignoredReason?: 'stale'|'invalid'|'unmanaged' }}
 */
export function pickEffectivePin({ name, shippedPin, overrides } = {}) {
  const packages = overridePackageMap(overrides)
  const pin = resolveEffectivePin({ name, shippedPin, overrides: packages })
  if (pin !== shippedPin) return { pin, overridden: true }

  // The entry exists but provisioning did not honour it — say why.
  if (!Object.prototype.hasOwnProperty.call(packages, name)) {
    return { pin, overridden: false }
  }
  const entry = packages[name]
  // resolveEffectivePin requires the object form; a bare string (and any
  // entry without a version string) is unusable to it, whatever this
  // module's own reader tolerates.
  const overrideVersion =
    isPlainObject(entry) && typeof entry.version === 'string' ? entry.version.trim() : ''
  if (overrideVersion === '' || !parseVersion(overrideVersion) || !parseVersion(shippedPin)) {
    return { pin, overridden: false, ignoredReason: 'invalid' }
  }
  if (compareVersions(overrideVersion, shippedPin) <= 0) {
    return { pin, overridden: false, ignoredReason: 'stale' }
  }
  return { pin, overridden: false, ignoredReason: 'unmanaged' }
}
