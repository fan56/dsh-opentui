#!/usr/bin/env node
// upgrade.mjs — the body of `dsh-opentui upgrade`.
//
// Phases (control flow is defined in the implementation plan §6.3):
//   1. Plan (read-only): resolve the registry, read the opentui profile's
//      dependencies and the versions on disk, query the dist-tag once per
//      upgradable package, print the table. A missing profile is a normal
//      terminal state (exit 0): the launcher provisions it on the next start.
//   2. Confirmation: skipped by --dry-run and --yes; otherwise an interactive
//      prompt, and a refusal (exit 2) when neither stdin nor CI allows it.
//   3. Self upgrade: `npm i -g <own name>@<target>`, only when the running
//      copy demonstrably lives under the npm global prefix. Every other
//      install form is skipped with a warning — installing into a different
//      prefix would create a shadow copy that `dsh-opentui` never resolves.
//      A hard failure here aborts BEFORE anything touches the profile.
//   4. Plugins: `applyPluginUpgrades(ctx)` — back up the profile, run ONE
//      batched `dsh plugin add`, verify each package on disk, and record the
//      landed versions in upgrade-overrides.json. An install failure restores
//      the backup and re-adds the pre-upgrade specs; a version that did not
//      land is reported but never rolls back a successful install.
//
// Exit codes: 0 done/nothing to do/dry-run/help; 1 hard failure OR any package
// whose target version could not be determined (a query failure means the
// target is unknown, which is not "up to date"; nothing is written in that
// case); 2 usage refusal; 3 partially applied (some package is not at its
// planned version, or the override file could not be written).
//
// Dependency injection: every child process goes through `run(cmd, args, {
// timeout })` and every file operation through `fs`, both overridable from the
// context argument. That is what lets the tests exercise the install, verify
// and abort paths without npm, a TTY, or a real profile.
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatUpgradeUsage } from '../bin/lib/launcher.mjs'
import {
  PLUGIN_SET,
  PROFILE,
  compareVersions,
  parseVersion,
  resolveEffectivePin,
} from './lib/provision-plan.mjs'
import {
  buildUpgradePlan,
  buildViewArgs,
  isOfficialRegistry,
  isUpgradableDependency,
  parseOverrides,
  resolveRegistry,
  serializeOverrides,
} from './lib/upgrade-plan.mjs'

const PREFIX = 'dsh-opentui upgrade: '
// Matched to buildViewArgs' `--fetch-timeout 20000` (+ slack for npm startup
// and DNS): the child enforces its own fetch budget, so this backstop only
// matters when an argv flag is ignored (an old npm, a wrapper). Without the
// leftover margin a single dead registry would cost 60s per package.
const QUERY_TIMEOUT_MS = 25 * 1000
const PREFIX_TIMEOUT_MS = 10 * 1000
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000
const OVERRIDE_FILE = 'upgrade-overrides.json'
const BACKUP_DIR_NAME = '.upgrade-backup'
// pnpm-workspace.yaml belongs here because users hand-write allowBuilds in it:
// a host rollback that restored only the manifest and the lock would leave the
// rewritten workspace file in place.
const BACKUP_FILE_NAMES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', OVERRIDE_FILE]
const SAVE_EXACT = '--save-exact'
// The host forwards unknown flags to pnpm, but a future argv parser could
// reject it; only a rejection of THIS flag earns the one retry without it.
const SAVE_EXACT_REJECTED = /save-exact|unknown option|unrecognized/i

/** The shipped pins, keyed by package name: the only versions provisioning
 *  may be raised above, so the only names an override can ever affect. */
const SHIPPED_PINS = new Map(PLUGIN_SET.map((plugin) => [plugin.name, plugin.version]))

const ACTION_LABEL = {
  upgrade: 'upgrade',
  latest: 'up to date',
  'query-failed': 'query-failed',
  excluded: 'excluded',
}

const say = (message) => console.log(`${PREFIX}${message}`)
const warn = (message) => console.error(`${PREFIX}warning: ${message}`)

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Injected effects — the defaults used by the real CLI
// ---------------------------------------------------------------------------

/**
 * Run a command and NEVER throw on a non-zero exit: the caller inspects
 * `status`. stderr/stdout are strings ('' when absent) so tail printing and
 * JSON parsing need no Buffer handling.
 *
 * `env` is merged over the parent environment (never replaces it): the plugin
 * install must inherit the caller's DSH_HOME, and a spawn that dropped it
 * would operate on the default profile instead of the selected one.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ timeout?: number, env?: Record<string, string | undefined> }} [options]
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function defaultRun(cmd, args = [], { timeout, env } = {}) {
  const childEnv = {}
  if (env && typeof env === 'object') {
    Object.assign(childEnv, process.env)
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string') childEnv[key] = value
    }
  }
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout,
      ...(env && typeof env === 'object' ? { env: childEnv } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout: String(stdout ?? ''), stderr: '' }
  } catch (err) {
    return {
      status: typeof err?.status === 'number' ? err.status : 1,
      stdout: String(err?.stdout ?? ''),
      stderr: String(err?.stderr ?? err?.message ?? ''),
    }
  }
}

/**
 * The file operations the command needs, as an object so a test can replace
 * the whole surface. Path-only helpers (`realpathSync` in canonicalPath) stay
 * on the module import: the injected set deliberately covers reads/writes
 * only, and canonicalPath remembers a path it was already given.
 */
export const defaultFs = {
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  writeFileSync: (path, data, encoding) => writeFileSync(path, data, encoding),
  existsSync: (path) => existsSync(path),
  mkdirSync: (path, options) => mkdirSync(path, options),
  rmSync: (path, options) => rmSync(path, options),
  rmdirSync: (path) => rmdirSync(path),
  copyFileSync: (from, to) => copyFileSync(from, to),
  renameSync: (from, to) => renameSync(from, to),
}

/** A synchronous one-line read from stdin (the confirmation prompt). */
function defaultReadLine() {
  const buffer = Buffer.alloc(1024)
  try {
    const read = readSync(0, buffer, 0, buffer.length, null)
    return buffer.subarray(0, read).toString('utf8')
  } catch {
    return ''
  }
}

const defaultPrompt = (text) => process.stdout.write(text)

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

/**
 * Absolute path for comparisons. Uses realpathSync when it resolves and falls
 * back to a lexical resolve, so a path that only exists in a test fixture is
 * still comparable (and a broken symlink never throws here).
 */
function canonicalPath(path) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** Is `child` the same as `parent` or below it? */
function isInside(parent, child) {
  const base = canonicalPath(parent).replace(/\/+$/, '')
  const target = canonicalPath(child)
  return target === base || target.startsWith(`${base}${sep}`)
}

/** Parsed JSON, or undefined for a missing/unreadable/malformed file. */
function readJson(fs, path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** File contents, or undefined when the file cannot be read. */
function readText(fs, path) {
  try {
    const text = fs.readFileSync(path, 'utf8')
    return typeof text === 'string' ? text : undefined
  } catch {
    return undefined
  }
}

/**
 * npmrc texts, least specific first (resolveRegistry lets the LAST text win).
 * Only files that exist are passed, so a missing file cannot shadow a present
 * one: profile/.npmrc > $DSH_HOME/.npmrc > ~/.npmrc.
 */
function collectNpmrcTexts({ fs, dshHome, profileDir, env }) {
  const home = env.HOME || homedir()
  const paths = [join(home, '.npmrc'), join(dshHome, '.npmrc'), join(profileDir, '.npmrc')]
  const texts = []
  for (const path of paths) {
    const text = readText(fs, path)
    if (text !== undefined) texts.push(text)
  }
  return texts
}

/** The version on disk for a profile dependency, when readable. */
function readInstalledVersion(fs, profileDir, name) {
  const manifest = readJson(fs, join(profileDir, 'node_modules', ...name.split('/'), 'package.json'))
  return isPlainObject(manifest) && typeof manifest.version === 'string' && manifest.version
    ? manifest.version
    : undefined
}

/** The launcher's own name/version — read from ITS manifest, never guessed. */
function readSelf(fs, pkgRoot) {
  const manifest = readJson(fs, join(pkgRoot, 'package.json'))
  if (!isPlainObject(manifest)) return null
  if (typeof manifest.name !== 'string' || manifest.name === '') return null
  if (typeof manifest.version !== 'string' || manifest.version === '') return null
  return { name: manifest.name, version: manifest.version }
}

/**
 * `npm view <pkg> dist-tags --json` for one package. Returns the version the
 * requested tag points at, or null when the query failed OR the tag is absent.
 * A single package failing is recorded as `query-failed` by the caller.
 */
function queryDistTag({ run, pkg, registry, tag }) {
  const result = run('npm', buildViewArgs({ pkg, registry }), { timeout: QUERY_TIMEOUT_MS })
  if (!result || result.status !== 0) return null
  let tags
  try {
    tags = JSON.parse(result.stdout)
  } catch {
    return null
  }
  if (!isPlainObject(tags)) return null
  const version = tags[tag]
  return typeof version === 'string' && version !== '' ? version : null
}

/** Plain, ANSI-free table with content-sized columns. */
function formatPlanTable(rows) {
  const header = ['PACKAGE', 'CURRENT', 'TARGET', 'ACTION']
  const body = rows.map((row) => [
    row.name,
    row.current ?? '-',
    row.target ?? '-',
    ACTION_LABEL[row.action] ?? row.action,
  ])
  const widths = header.map((title, column) =>
    Math.max(title.length, ...body.map((cells) => cells[column].length)),
  )
  const line = (cells) => cells.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd()
  return [line(header), ...body.map(line)].join('\n')
}

/** The last `count` non-empty lines of a command's stderr. */
function tailLines(text, count = 10) {
  const lines = String(text ?? '')
    .trimEnd()
    .split(/\r?\n/)
    .filter((line) => line !== '')
  return lines.slice(-count)
}

/** Semver-equal per provision-plan's single comparison rule. */
function sameVersion(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a === b) return true
  return Boolean(parseVersion(a) && parseVersion(b) && compareVersions(a, b) === 0)
}

/** `20261116T142530Z` — sortable and filename-safe. */
function backupStamp(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

// ---------------------------------------------------------------------------
// Phase: self upgrade
// ---------------------------------------------------------------------------

/**
 * Bring the launcher itself up to `target`, but only when the running copy is
 * the one the npm global prefix owns.
 *
 * @returns {{ kind: 'skipped', form: string } |
 *   { kind: 'latest', version: string } |
 *   { kind: 'upgraded', from: string, to: string } |
 *   { kind: 'failed', exitCode: 1 }}
 */
function upgradeSelf({ self, target, registry, run, fs, selfPath }) {
  if (!self || typeof target !== 'string' || target === '') {
    say('self: skipped (install form: unknown)')
    warn(
      'upgrade the launcher first; an older launcher does not read upgrade-overrides and will restore shipped pins',
    )
    return { kind: 'skipped', form: 'unknown' }
  }

  // Install form: only a copy under `<npm prefix -g>/lib/node_modules/<name>`
  // is ours to replace. Anything else (source tree, a copy in another prefix)
  // must not be upgraded from here.
  const prefixResult = run('npm', ['prefix', '-g'], { timeout: PREFIX_TIMEOUT_MS })
  let form = 'unknown'
  let globalPkgDir = null
  if (prefixResult && prefixResult.status === 0) {
    const prefix = String(prefixResult.stdout ?? '').trim()
    if (prefix !== '') {
      globalPkgDir = join(prefix, 'lib', 'node_modules', ...self.name.split('/'))
      form = isInside(globalPkgDir, selfPath) ? 'global-npm' : 'foreign'
    }
  }

  if (form !== 'global-npm' || globalPkgDir === null) {
    say(`self: skipped (install form: ${form})`)
    warn(
      'upgrade the launcher first; an older launcher does not read upgrade-overrides and will restore shipped pins',
    )
    return { kind: 'skipped', form }
  }

  if (sameVersion(self.version, target)) {
    say(`self: already up to date (${self.version})`)
    return { kind: 'latest', version: self.version }
  }

  const install = run('npm', ['i', '-g', `${self.name}@${target}`, '--registry', registry], {
    timeout: INSTALL_TIMEOUT_MS,
  })
  if (!install || install.status !== 0) {
    const tail = tailLines(install?.stderr, 10)
    if (tail.length > 0) console.error(tail.join('\n'))
    if (/EACCES|permission denied/i.test(String(install?.stderr ?? ''))) {
      say(`try npm i -g ${self.name}@${target} with a writable prefix`)
    }
    say('upgrade aborted; profile untouched')
    return { kind: 'failed', exitCode: 1 }
  }

  // Landing check reads the INSTALLED copy, never the running pkgRoot: npm may
  // have replaced the directory this process was loaded from.
  const landed = readJson(fs, join(globalPkgDir, 'package.json'))
  const actual = isPlainObject(landed) && typeof landed.version === 'string' ? landed.version : undefined
  if (actual !== target) {
    say(`installed ${actual ?? 'nothing'}, expected ${target}`)
    say('upgrade aborted; profile untouched')
    return { kind: 'failed', exitCode: 1 }
  }

  say(`upgraded ${self.name} ${self.version} -> ${target}`)
  say(`this process still runs the old code; quit and re-run \`dsh-opentui\` to start on ${target}`)
  return { kind: 'upgraded', from: self.version, to: target }
}

// ---------------------------------------------------------------------------
// Phase: plugins
//
// The install is deliberately ONE `dsh plugin ... add` for every target: the
// host takes the profile lock once, saves/restores package.json + lock around
// the run, and pnpm resolves the batch as a whole. Per-package calls would
// turn one bad version into "3 landed, 1 failed" and leave the profile
// inconsistent, so a failure rolls the whole batch back instead.
// ---------------------------------------------------------------------------

/** Numeric exit status of an injected run result; missing results count as 1. */
function runStatus(result) {
  return result && typeof result.status === 'number' ? result.status : 1
}

/** argv tail for the batched install (and for the rollback convergence). */
function pluginAddArgs(specs, { saveExact = true } = {}) {
  const args = ['plugin', '--profile', PROFILE, 'add']
  if (saveExact) args.push(SAVE_EXACT)
  return [...args, ...specs]
}

/**
 * Copy the files a rollback needs. Only files that EXIST are copied: a file
 * that was never there must be re-absent after a rollback, which the caller
 * infers from the missing key (it deletes the override path in that case).
 *
 * @returns {Record<string, string>} original file name -> backup copy path
 */
function createBackup({ fs, profileDir, backupDir }) {
  fs.mkdirSync(backupDir, { recursive: true })
  const copies = {}
  for (const name of BACKUP_FILE_NAMES) {
    const source = join(profileDir, name)
    if (!fs.existsSync(source)) continue
    const target = join(backupDir, name)
    fs.copyFileSync(source, target)
    copies[name] = target
  }
  return copies
}

/**
 * Put the profile back the way the backup found it. `package.json` and the
 * lock are copy-restored; `upgrade-overrides.json` is restored when it was
 * backed up, and REMOVED when it was not (a rollback must not leave behind a
 * file the user never had).
 */
function restoreBackup({ fs, profileDir, overridePath, copies }) {
  for (const [name, copy] of Object.entries(copies)) {
    fs.copyFileSync(copy, join(profileDir, name))
  }
  if (!Object.prototype.hasOwnProperty.call(copies, OVERRIDE_FILE)) {
    fs.rmSync(overridePath, { force: true })
  }
}

/**
 * Remove the backup after a fully successful run: the stamp directory first,
 * then its hidden `.upgrade-backup` parent when it is empty. `rmdir` (not
 * `rm -r`) is deliberate — it refuses to touch a parent that still holds
 * another run's backup (ENOTEMPTY is ignored), so concurrent upgrades cannot
 * delete each other's rollback material. The failure paths never call this.
 */
function removeSuccessfulBackup({ fs, backupDir }) {
  fs.rmSync(backupDir, { recursive: true, force: true })
  try {
    fs.rmdirSync(dirname(backupDir))
  } catch {
    /* not empty, already gone, or not ours to remove — leave it */
  }
}

/** The specs of the pre-upgrade manifest, read from its BACKUP copy (the live
 *  manifest may already have been rewritten by the host). Local and host
 *  specs are skipped: they are not installable from the registry. */
function originalSpecs({ fs, copies, manifestPath }) {
  const manifest = readJson(fs, copies['package.json'] ?? manifestPath)
  const dependencies = isPlainObject(manifest?.dependencies) ? manifest.dependencies : {}
  return Object.entries(dependencies)
    .filter(([name, spec]) => isUpgradableDependency(name, spec))
    .map(([name, spec]) => `${name}@${spec}`)
}

/**
 * One batched install. A host that rejects `--save-exact` gets exactly one
 * retry without it; every other failure is final (no per-package retry).
 *
 * @returns {{ status: number, args: string[], stderr: string }}
 */
function installPlugins({ run, env, specs, warn }) {
  let args = pluginAddArgs(specs)
  let result = run('dsh', args, { timeout: INSTALL_TIMEOUT_MS, env })
  let status = runStatus(result)
  if (status === 0) return { status, args, stderr: '' }

  const stderr = String(result?.stderr ?? '')
  if (SAVE_EXACT_REJECTED.test(stderr)) {
    warn('--save-exact not supported by host; relying on upgrade-overrides')
    args = pluginAddArgs(specs, { saveExact: false })
    result = run('dsh', args, { timeout: INSTALL_TIMEOUT_MS, env })
    status = runStatus(result)
    if (status === 0) return { status, args, stderr: '' }
  }
  return { status, args, stderr }
}

/** Strict per-package check: only an exact string match counts as landed. */
function verifyPlugins({ fs, profileDir, rows }) {
  const landed = []
  const mismatched = []
  for (const row of rows) {
    const actual = readInstalledVersion(fs, profileDir, row.name)
    if (actual !== undefined && actual === row.target) {
      landed.push({ name: row.name, version: actual, from: row.current })
    } else {
      mismatched.push({ name: row.name, expected: row.target, actual: actual ?? null })
    }
  }
  return { landed, mismatched }
}

/**
 * Merge the landed packages into the override document.
 *
 * An entry is only added when `resolveEffectivePin` — the single authority
 * provisioning also uses — agrees the entry would take effect. That one check
 * covers all the ways an entry is useless: a package outside PLUGIN_SET, a
 * version that is not newer than the shipped pin (stale or downgrade), and a
 * version that does not parse.
 *
 * @returns {{
 *   packages: Record<string, unknown>,
 *   written: string[],
 *   atPin: string[],
 *   ineffective: Array<{ name: string, reason: string }>,
 * }}
 */
function planOverrides({ packages, landed, updatedAt }) {
  const next = { ...packages }
  const written = []
  const atPin = []
  const ineffective = []

  for (const entry of landed) {
    const shippedPin = SHIPPED_PINS.get(entry.name)
    if (shippedPin !== undefined && entry.version === shippedPin) {
      // The profile is already on the shipped pin: an override would restate
      // it, so the package counts as up to date instead of upgraded.
      atPin.push(entry.name)
      continue
    }

    const candidate = {
      ...next,
      [entry.name]: { version: entry.version, shippedPin: shippedPin ?? null, updatedAt },
    }
    const effective = resolveEffectivePin({ name: entry.name, shippedPin, overrides: candidate })
    if (effective !== entry.version) {
      ineffective.push({ name: entry.name, version: entry.version, shippedPin: shippedPin ?? null })
      continue
    }
    next[entry.name] = candidate[entry.name]
    written.push(entry.name)
  }

  return { packages: next, written, atPin, ineffective }
}

/** The rollback's second half: re-add the pre-upgrade specs so node_modules
 *  matches the restored manifest again. A failure here is reported with the
 *  exact command the user can run by hand. */
function convergeProfile({ fs, run, env, copies, manifestPath, log, warn }) {
  const specs = originalSpecs({ fs, copies, manifestPath })
  if (specs.length === 0) return

  const result = run('dsh', pluginAddArgs(specs), { timeout: INSTALL_TIMEOUT_MS, env })
  const status = runStatus(result)
  if (status === 0) {
    log(`restored the previous plugin versions (${specs.length} spec(s))`)
    return
  }
  warn(`could not restore the previous plugin versions (dsh plugin add exit ${status})`)
  warn(`run this by hand to restore them: dsh plugin --profile ${PROFILE} add ${specs.join(' ')}`)
}

/**
 * Phase 4: install every planned plugin upgrade, verify it landed, and record
 * the landed versions in `upgrade-overrides.json`.
 *
 * Outcomes (they map 1:1 to the process exit code, see exitCodeAfterPlugins):
 *   - all landed, overrides written or unnecessary -> backup deleted, code 0
 *   - install failed                               -> rollback, backup kept, code 1
 *   - install ok, some version did not land        -> no rollback, code 3
 *   - override write failed                        -> code 3
 *
 * @param {{
 *   profileDir: string, manifestPath: string, overridePath: string,
 *   backupDir: string, pluginRows: Array<{name: string, current: string|null, target: string}>,
 *   rows: Array<{name: string, action: string}>,
 *   counts: {latest: number, excluded: number}, selfName: string|null,
 *   env: Record<string, string|undefined>,
 *   run: Function, fs: typeof defaultFs,
 *   log: (message: string) => void, warn: (message: string) => void,
 * }} ctx
 * @returns {{
 *   landed: Array<{name: string, version: string, from: string|null}>,
 *   mismatched: Array<{name: string, expected: string, actual: string|null}>,
 *   failed: Array<{reason: string, status?: number}>,
 *   overridesError?: boolean,
 *   upgraded?: number,
 *   upToDate?: number,
 * }}
 */
function applyPluginUpgrades(ctx) {
  const { profileDir, manifestPath, overridePath, backupDir, rows, pluginRows, counts, selfName, env, run, fs, log, warn } =
    ctx

  if (pluginRows.length === 0) {
    log('plugins: already up to date')
    return { landed: [], mismatched: [], failed: [] }
  }

  const specs = pluginRows.map((row) => `${row.name}@${row.target}`)
  const copies = createBackup({ fs, profileDir, backupDir })
  log(`backup: ${backupDir}`)
  log(`plugins: installing ${specs.length} package(s)`)

  const install = installPlugins({ run, env, specs, warn })
  if (install.status !== 0) {
    const tail = tailLines(install.stderr, 10)
    if (tail.length > 0) console.error(tail.join('\n'))
    restoreBackup({ fs, profileDir, overridePath, copies })
    convergeProfile({ fs, run, env, copies, manifestPath, log, warn })
    log(`upgrade failed at plugin install; profile restored from ${backupDir}`)
    log('if the profile still looks wrong, fix it by hand before starting the TUI')
    return { landed: [], mismatched: [], failed: [{ reason: 'install', status: install.status }] }
  }

  const { landed, mismatched } = verifyPlugins({ fs, profileDir, rows: pluginRows })
  for (const item of mismatched) {
    log(`mismatch: ${item.name} expected ${item.expected}, installed ${item.actual ?? 'nothing'}`)
  }

  // --- overrides: read, merge, assert, write -------------------------------
  // A file that is not a usable override document is left UNTOUCHED: it may
  // hold hand-edited entries this module would silently drop. Nothing is
  // recorded in that case (the run reports a partial result), and the file is
  // in the backup if the user wants it back.
  const existingText = readText(fs, overridePath)
  const parsed = existingText === undefined ? null : parseOverrides(existingText)
  const unusable = existingText !== undefined && parsed === null
  if (unusable) {
    warn(
      `${overridePath} is not a usable override document; leaving it untouched — fix or delete it and re-run, or the next start will reinstall the shipped pins`,
    )
  }

  let overridesError = unusable
  let written = []
  let atPin = []
  if (!unusable) {
    const document = parsed ?? { version: 1, packages: {} }
    const updatedAt = new Date().toISOString()
    const plan = planOverrides({ packages: document.packages ?? {}, landed, updatedAt })
    written = plan.written
    atPin = plan.atPin

    for (const item of plan.ineffective) {
      if (item.shippedPin === null) {
        // The package is not in PLUGIN_SET, so provisioning never installs or
        // converges it: an override would be dead data, not a lost upgrade.
        warn(`${item.name}: not managed by provisioning; no override recorded`)
        continue
      }
      warn(
        `${item.name}: an override at ${item.version} would be ignored by provisioning (shipped pin ${item.shippedPin}); not recorded — the next start will reinstall the shipped pin`,
      )
    }

    if (written.length > 0) {
      const nextDocument = { ...document, version: document.version ?? 1, updatedAt, packages: plan.packages }
      // Write-then-rename in the SAME directory: a crash mid-write cannot leave
      // a torn upgrade-overrides.json that provisioning would silently ignore.
      const tmpPath = `${overridePath}.tmp`
      try {
        fs.writeFileSync(tmpPath, serializeOverrides(nextDocument), 'utf8')
        fs.renameSync(tmpPath, overridePath)
        log(`wrote ${written.length} override(s) to ${overridePath}`)
      } catch (err) {
        overridesError = true
        warn(`could not write ${overridePath}: ${err?.message ?? err}`)
        warn('the next start may reinstall the shipped pins and downgrade these plugins')
        log(`override write failed; backup kept at ${backupDir}`)
      }
    }
  }

  // --- summary + exit-code material ---------------------------------------
  // The launcher has its own row and its own report, so it never counts here.
  const latestPlugins = rows.filter(
    (row) => row.action === 'latest' && (selfName === null || row.name !== selfName),
  ).length
  const upgraded = landed.length - atPin.length
  const upToDate = latestPlugins + atPin.length
  log(
    `${upgraded} upgraded, ${upToDate} up to date, ${mismatched.length} mismatched, ${counts.excluded} excluded`,
  )
  log('restart required: exit the TUI and run dsh-opentui again')

  if (mismatched.length > 0) {
    log(
      'packages without an override will be reinstalled at the shipped pin on the next start (possible downgrade)',
    )
  }

  if (mismatched.length === 0 && !overridesError) {
    removeSuccessfulBackup({ fs, backupDir })
    log(`upgraded ${upgraded} plugin(s)`)
  } else {
    log(`backup kept at ${backupDir}`)
  }

  return { landed, mismatched, failed: [], overridesError, upgraded, upToDate }
}

/**
 * Exit code after the plugin phase (plan §1.3):
 *   1 - the batched install failed and the profile was rolled back;
 *   3 - partially applied: the install exited 0 but a package is not at its
 *       target version, or the override file could not be written;
 *   0 - every target is on disk at its planned version.
 */
function exitCodeAfterPlugins({ pluginResult } = {}) {
  if (!pluginResult) return 0
  if (Array.isArray(pluginResult.failed) && pluginResult.failed.length > 0) return 1
  if (pluginResult.overridesError) return 3
  if (Array.isArray(pluginResult.mismatched) && pluginResult.mismatched.length > 0) return 3
  return 0
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run the upgrade command and return the process exit code.
 *
 * @param {{
 *   dryRun?: boolean, yes?: boolean, tag?: string, noSelf?: boolean,
 *   noPlugins?: boolean, resetOverrides?: boolean, help?: boolean,
 * }} [opts]
 * @param {{
 *   pkgRoot?: string,
 *   env?: Record<string, string | undefined>,
 *   run?: (cmd: string, args: string[], options?: { timeout?: number }) =>
 *     { status: number, stdout: string, stderr: string },
 *   fs?: typeof defaultFs,
 *   selfPath?: string,
 *   isTTY?: boolean,
 *   readLine?: () => string,
 *   prompt?: (text: string) => void,
 * }} [context]
 * @returns {number} 0 done / nothing to do / --dry-run / --help,
 *   1 hard failure or an undetermined target version, 2 non-interactive
 *   refusal (the bin owns the other usage errors), 3 partially applied
 */
export function runUpgrade(
  opts = {},
  {
    pkgRoot = defaultPkgRoot(),
    env = process.env,
    run = defaultRun,
    fs = defaultFs,
    selfPath = fileURLToPath(import.meta.url),
    isTTY = Boolean(process.stdin.isTTY),
    readLine = defaultReadLine,
    prompt = defaultPrompt,
  } = {},
) {
  if (opts.help) {
    console.log(formatUpgradeUsage())
    return 0
  }

  const dshHome = env.DSH_HOME || join(homedir(), '.dsh')
  const profileDir = join(dshHome, 'profiles', PROFILE)
  const manifestPath = join(profileDir, 'package.json')
  const overridePath = join(profileDir, OVERRIDE_FILE)

  // --- --reset-overrides: a terminal action, never a step of the upgrade ---
  if (opts.resetOverrides) {
    if (!fs.existsSync(overridePath)) {
      say('no overrides to reset')
      return 0
    }
    if (opts.dryRun) {
      say(`would remove ${overridePath}`)
      return 0
    }
    fs.rmSync(overridePath, { force: true })
    say(`removed ${overridePath}`)
    warn('next provisioning will restore shipped pins; plugins may be downgraded')
    return 0
  }

  if (!fs.existsSync(profileDir)) {
    say(`no opentui profile at ${profileDir}; run dsh-opentui once to provision it`)
    return 0
  }

  // --- 1. Plan (read-only) -------------------------------------------------
  const manifest = readJson(fs, manifestPath)
  if (!isPlainObject(manifest)) {
    warn(`could not read ${manifestPath}; treating the profile as having no plugin dependencies`)
  }

  const { registry, source } = resolveRegistry({
    env,
    npmrcTexts: collectNpmrcTexts({ fs, dshHome, profileDir, env }),
  })

  const tag = opts.tag ?? 'latest'
  say(`dsh home ${dshHome} · profile ${PROFILE} · tag ${tag}`)
  say(`registry ${registry} (source: ${source})`)
  if (!isOfficialRegistry(registry)) {
    say(`note: resolved via ${registry}; "${tag}" may lag behind npmjs`)
  }

  // `deps` keeps the excluded entries too: buildUpgradePlan must report them
  // as `excluded` rather than silently dropping them from the table.
  const deps = {}
  const installedVersions = {}

  if (!opts.noPlugins) {
    const dependencies = isPlainObject(manifest?.dependencies) ? manifest.dependencies : {}
    for (const [name, spec] of Object.entries(dependencies)) {
      deps[name] = spec
      const installed = readInstalledVersion(fs, profileDir, name)
      if (installed !== undefined) installedVersions[name] = installed
    }
  }

  const self = opts.noSelf ? null : readSelf(fs, pkgRoot)
  if (self !== null && !Object.prototype.hasOwnProperty.call(deps, self.name)) {
    // The launcher is not a profile dependency; give it a row of its own so
    // "the launcher is already up to date" is visible instead of implied.
    deps[self.name] = self.version
    installedVersions[self.name] = self.version
  }

  // Excluded entries (`@deepseek-ai/*`, local specs) are never queried: their
  // target is meaningless by definition.
  const latestByPkg = {}
  for (const [name, spec] of Object.entries(deps)) {
    if (!isUpgradableDependency(name, spec)) continue
    const target = queryDistTag({ run, pkg: name, registry, tag })
    if (target !== null) latestByPkg[name] = target
  }

  const { rows, counts } = buildUpgradePlan({ deps, installedVersions, latestByPkg, tag })

  console.log(formatPlanTable(rows))
  console.log(
    `${counts.upgrade} to upgrade, ${counts.latest} up to date, ${counts.queryFailed} failed, ${counts.excluded} excluded`,
  )

  // An undetermined target is not a satisfied package: without a target there
  // is nothing to install, so the run must not claim success — and it writes
  // nothing, --dry-run included.
  if (counts.queryFailed > 0) {
    say(`could not determine target version for ${counts.queryFailed} package(s); nothing changed`)
    return 1
  }
  if (opts.dryRun) return 0
  if (counts.upgrade === 0) {
    // No target needs work: there is nothing to back up and nothing to spawn.
    say(opts.noPlugins ? 'plugins: skipped (--no-plugins)' : 'plugins: already up to date')
    say('nothing to do')
    return 0
  }

  // --- 2. Confirmation -----------------------------------------------------
  if (!opts.yes) {
    if (env.CI || !isTTY) {
      console.error(`${PREFIX}refusing to run non-interactively; pass --yes`)
      return 2
    }
    prompt('Proceed with upgrade? [y/N] ')
    const answer = String(readLine() ?? '').trim().toLowerCase()
    if (answer !== 'y' && answer !== 'yes') {
      say('aborted')
      return 0
    }
  }

  // --- 3. Self upgrade -----------------------------------------------------
  const selfRow = self === null ? undefined : rows.find((row) => row.name === self.name)
  let selfResult
  if (opts.noSelf) {
    say('self: skipped (--no-self)')
    selfResult = { kind: 'skipped', form: 'skipped-by-flag' }
  } else {
    selfResult = upgradeSelf({
      self,
      target: selfRow?.target ?? null,
      registry,
      run,
      fs,
      selfPath,
    })
    if (selfResult.kind === 'failed') return selfResult.exitCode
  }

  // --- 4. Plugins ----------------------------------------------------------
  const pluginRows = rows.filter(
    (row) => row.action === 'upgrade' && (self === null || row.name !== self.name),
  )

  if (opts.noPlugins) {
    say('plugins: skipped (--no-plugins)')
    return 0
  }
  if (pluginRows.length === 0) {
    say('plugins: already up to date')
    return 0
  }

  const ctx = {
    // Locations
    dshHome,
    profileDir,
    manifestPath,
    overridePath,
    // Plan
    registry,
    tag,
    rows,
    counts,
    pluginRows,
    installedVersions,
    latestByPkg,
    // Self result
    selfName: self?.name ?? null,
    selfResult,
    // Where the plugin phase writes its backup (created there, not here):
    // $DSH_HOME/profiles/opentui/.upgrade-backup/<UTC stamp>-<pid>/
    backupDir: join(profileDir, BACKUP_DIR_NAME, `${backupStamp()}-${process.pid}`),
    // Injected effects + logging
    env,
    run,
    fs,
    log: say,
    warn,
  }

  const pluginResult = applyPluginUpgrades(ctx)
  return exitCodeAfterPlugins({ pluginResult })
}

function defaultPkgRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)))
}
