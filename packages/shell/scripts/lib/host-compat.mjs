/**
 * Single source of truth for the in-process bridge's host-version compatibility.
 *
 * Two consumers, one policy:
 *   - scripts/build-bridge.mjs injects HOST_PEER_RANGE into the shipped bridge
 *     manifest, which is what the host's `evaluatePluginCompatibility` reads.
 *   - scripts/provision-inproc-profile.mjs gates startup: it detects the
 *     running host, fails loud when it is outside the window (the host only
 *     records an incompatible bundle in `skippedBundles` and prints nothing on
 *     this path), and grants the exact-version exemption otherwise.
 *
 * No `semver` import: the shipped provision script runs under plain Node in a
 * published package with no workspace node_modules. The comparison below
 * mirrors `semver.satisfies(v, '>=0.2.2-rc.3 <0.3.0', { includePrerelease: true })`
 * for the canonical versions this project deals with (numeric core + dotted
 * prerelease identifiers).
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Host peer whose version expresses the dsh runtime requirement. */
export const HOST_PEER_NAME = '@deepseek-ai/dsh-base'

/**
 * Supported host window. rc.3 is the floor the bridge was built against; the
 * rc.3 -> rc.4 surface the bridge consumes is byte-identical (dsh-base and the
 * service packages' `lib/types/index.d.ts` diffs are empty — see the commit
 * message). The <0.3.0 cap turns a future major bump into a loud provisioning
 * failure instead of a silent plugin skip.
 */
export const HOST_PEER_RANGE = '>=0.2.2-rc.3 <0.3.0'

/** Host-owned file that carries exact version exemptions (profile-local). */
export const COMPATIBILITY_FILENAME = 'compatibility.json'

/**
 * Explicit override for host-version detection. Intended for tests and for a
 * caller that already knows the exact runtime; empty/unset means auto-detect
 * via `dsh --version`.
 */
export const HOST_VERSION_ENV = 'DSH_OPENTUI_HOST_VERSION'

// --- Minimal semver ---------------------------------------------------------

/** Parse a canonical semver; return null for anything else (ranges, prefixes, garbage). */
function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(value.trim())
  if (match === null) return null
  const prerelease = match[4] === undefined ? [] : match[4].split('.')
  if (prerelease.some((id) => /^\d+$/.test(id) && id.length > 1 && id.startsWith('0'))) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
    build: match[5] ?? '',
  }
}

/** Whether a string is a canonical exact version (the host only grants exact keys). */
export function isExactVersion(value) {
  if (typeof value !== 'string') return false
  const parsed = parseVersion(value)
  if (parsed === null) return false
  const canonical = `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease.length === 0 ? '' : `-${parsed.prerelease.join('.')}`}${parsed.build === '' ? '' : `+${parsed.build}`}`
  return value === canonical
}

function compareIdentifier(a, b) {
  const aNumeric = /^\d+$/.test(a)
  const bNumeric = /^\d+$/.test(b)
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b))
  if (aNumeric) return -1 // numeric identifiers rank below non-numeric ones
  if (bNumeric) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Compare two canonical versions: -1 / 0 / 1. Throws on malformed input. */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === null || b === null) {
    throw new Error(`cannot compare non-semver values ${JSON.stringify(left)} / ${JSON.stringify(right)}`)
  }
  for (const field of ['major', 'minor', 'patch']) {
    if (a[field] !== b[field]) return a[field] < b[field] ? -1 : 1
  }
  // A version with a prerelease ranks below the corresponding release.
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    if (i >= a.prerelease.length) return -1
    if (i >= b.prerelease.length) return 1
    const cmp = compareIdentifier(a.prerelease[i], b.prerelease[i])
    if (cmp !== 0) return cmp
  }
  return 0
}

/** The floor and cap of HOST_PEER_RANGE, kept literal here and pinned by tests. */
export const SUPPORTED_FLOOR = '0.2.2-rc.3'
export const SUPPORTED_CAP = '0.3.0'

/**
 * Whether `version` is inside the supported host window. Mirrors the host's
 * `semver.satisfies(version, HOST_PEER_RANGE, { includePrerelease: true })`,
 * so 0.3.0-rc.1 is still inside and 0.3.0 (and 0.2.2-rc.2) are outside.
 */
export function isHostVersionSupported(version) {
  if (parseVersion(version) === null) return false
  return compareVersions(version, SUPPORTED_FLOOR) >= 0 && compareVersions(version, SUPPORTED_CAP) < 0
}

// --- Host version detection -------------------------------------------------

/** Read the exact runtime version from `dsh --version` (the host's own app-boot version). */
export function detectHostVersion({ env = process.env, spawn = spawnSync } = {}) {
  const override = env[HOST_VERSION_ENV]
  const raw = override !== undefined && override.trim() !== '' ? override.trim() : fromDshCli(spawn)
  if (raw === undefined || raw === '') {
    throw new Error(
      `could not determine the running dsh host version via \`dsh --version\` (or ${HOST_VERSION_ENV}); `
      + 'refusing to provision because a version mismatch would skip the bridge without a usable error',
    )
  }
  if (!isExactVersion(raw)) {
    throw new Error(`dsh host version ${JSON.stringify(raw)} is not an exact semantic version`)
  }
  return raw
}

function fromDshCli(spawn) {
  let result
  try {
    result = spawn('dsh', ['--version'], { encoding: 'utf8', timeout: 5000 })
  } catch (error) {
    return undefined
  }
  if (result?.error !== undefined || result?.status !== 0) return undefined
  const line = String(result.stdout ?? '')
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean)
  return line === undefined ? undefined : line.replace(/^v/, '')
}

// --- Profile-local exemption ------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Read the profile's compatibility file the same way the host does, but treat
 * anything malformed as fatal: a file the host would silently ignore is
 * exactly how the bridge ends up skipped with no explanation.
 */
export function readExemptions(profileDir) {
  const filename = join(profileDir, COMPATIBILITY_FILENAME)
  let text
  try {
    text = readFileSync(filename, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { exemptions: {}, warnings: [] }
    throw new Error(`${filename} cannot be read: ${String(error)}`)
  }
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`${filename} is not valid JSON (${String(error)}); repair it by hand before provisioning`)
  }
  if (!isPlainObject(value)) {
    throw new Error(`${filename} must map exact package@version keys to arrays of exact dsh versions`)
  }
  const exemptions = {}
  const warnings = []
  for (const [key, versions] of Object.entries(value)) {
    const separator = key.lastIndexOf('@')
    const name = separator > 0 ? key.slice(0, separator) : ''
    const version = separator > 0 ? key.slice(separator + 1) : ''
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || !isExactVersion(version)) {
      warnings.push(`${JSON.stringify(key)} is not an exact package-name@version key`)
      continue
    }
    if (!Array.isArray(versions) || versions.some((item) => !isExactVersion(item))) {
      warnings.push(`${key} must contain a list of exact dsh versions`)
      continue
    }
    exemptions[key] = versions
  }
  return { exemptions, warnings }
}

/**
 * Grant the exact-version exemption for one plugin only when the host is in
 * the supported window. Never called for an unsupported host, so --accept-risk
 * can never rubber-stamp a real incompatibility.
 * @returns { changed, key } — `changed` is false when the grant already exists.
 */
export function ensureHostExemption({ profileDir, packageName, packageVersion, hostVersion }) {
  if (!isExactVersion(packageVersion) || !isExactVersion(hostVersion)) {
    throw new Error('a version exemption requires exact package and dsh versions')
  }
  const key = `${packageName}@${packageVersion}`
  const { exemptions, warnings } = readExemptions(profileDir)
  if (warnings.length > 0) {
    throw new Error(
      `${join(profileDir, COMPATIBILITY_FILENAME)} contains records this provisioner will not rewrite: ${warnings.join('; ')}. Repair the file by hand.`,
    )
  }
  if (exemptions[key]?.includes(hostVersion) === true) return { changed: false, key }
  const next = {
    ...exemptions,
    [key]: [...new Set([...(exemptions[key] ?? []), hostVersion])],
  }
  const filename = join(profileDir, COMPATIBILITY_FILENAME)
  const tmp = `${filename}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, `${JSON.stringify(next, undefined, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, filename)
  return { changed: true, key }
}
