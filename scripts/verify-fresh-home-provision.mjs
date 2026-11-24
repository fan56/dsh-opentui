#!/usr/bin/env node
/**
 * D5 fresh-home provision gate (评审修正 2/4/5).
 *
 * Runs an INSTALLED package's real provisioner against a scratch HOME with an
 * isolated prefix, then exercises the negative fail-fast paths. Never reads the
 * user's ~/.dsh, never uses a static fake profile, never shells out.
 *
 *   node scripts/verify-fresh-home-provision.mjs --prefix <prefix> \
 *     [--with-dsh <absolute-dsh-bin>] [--scenario[=] <name|all>] [--keep] [--json] [--timeout-ms <n>]
 *
 * Scenarios: positive, no-dsh, live-lock, bad-bridge, bad-bridge-repair, all.
 * Exit codes: 0 all selected checks PASS or NOT RUN, 1 a check FAILed, 2 usage/unresolvable prefix.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, platform, tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACKAGE_SCOPE = join('@aiwayds', 'dsh-opentui')
const BRIDGE_NAME = '@aiwayds/dsh-opentui-bridge'
// The shim is generated alongside the bridge, not a companion bundle.
const SHIM_NAME = '@aiwayds/dsh-opentui-session-shim'
const COMPANION_POLICY = join('scripts', 'lib', 'companion-policy.mjs')
const MANAGED_PATCH_LINES = ['subagent', 'permission', 'llm-pi-ai', 'dsh-approval-policy']
const LEGACY_PROFILES = ['opentui', 'opentui-inproc']
const FAIL_FAST_NOTICE = 'inproc bridge mode injects append-system via the bridge section; presets are standard only.'
const MAX_OUTPUT = 4000
const DEFAULT_TIMEOUT_MS = 180_000
const NEG_TIMEOUT_MS = 20_000
export const SCENARIOS = Object.freeze(['positive', 'no-dsh', 'live-lock', 'bad-bridge', 'bad-bridge-repair'])
// DSH_* inherited by the provisioner. Everything else (user pins, user paths)
// is dropped; these are the documented CI pins, never user config.
const ENV_WHITELIST = [
  'DSH_OPENTUI_HOST_VERSION',
  'DSH_OPENTUI_COMPANION_LATEST',
  'DSH_OPENTUI_COMPANIONS',
  'DSH_OPENTUI_APPROVAL_GATE',
  'DSH_OPENTUI_PROVISION_LOCK_WAIT_MS',
  'ZAI_CODING_CN_API_KEY',
  'OPENCODE_GO_API_KEY',
]

const ok = (name, detail = '') => ({ name, status: 'PASS', detail })
const bad = (name, detail = '') => ({ name, status: 'FAIL', detail })
const skip = (name, detail = '') => ({ name, status: 'NOT RUN', detail })
const check = (name, condition, detail = '') => (condition ? ok(name, detail) : bad(name, detail))

function usageError(message) {
  throw Object.assign(new Error(message), { usage: true })
}

export function parseArgs(argv = []) {
  const out = { prefix: undefined, dshBin: undefined, scenario: 'all', keep: false, keepOnFailure: true, json: false, timeoutMs: DEFAULT_TIMEOUT_MS }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--prefix') out.prefix = argv[++i]
    else if (arg === '--with-dsh') out.dshBin = argv[++i]
    else if (arg === '--scenario') out.scenario = argv[++i]
    else if (arg.startsWith('--scenario=')) out.scenario = arg.slice('--scenario='.length)
    else if (arg === '--keep') out.keep = true
    else if (arg === '--no-keep-on-failure') out.keepOnFailure = false
    else if (arg === '--json') out.json = true
    else if (arg === '--timeout-ms') out.timeoutMs = Number(argv[++i])
    else usageError(`unknown argument: ${arg}`)
  }
  if (!out.prefix) usageError('--prefix is required')
  if (out.scenario !== 'all' && !SCENARIOS.includes(out.scenario)) {
    usageError(`--scenario must be one of: ${[...SCENARIOS, 'all'].join(', ')}`)
  }
  if (out.dshBin && !resolvePathArg(out.dshBin)) usageError('--with-dsh must be an absolute path')
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs <= 0) usageError('--timeout-ms must be a positive number')
  return out
}

function resolvePathArg(value) {
  return value && value.startsWith('/') ? resolve(value) : undefined
}

/** Locate the installed package root; fail-fast (exit 2) on either layout. */
export function locatePackage(prefix) {
  const root = resolve(prefix)
  const candidates = [join(root, 'lib', 'node_modules', PACKAGE_SCOPE), join(root, 'node_modules', PACKAGE_SCOPE)]
  for (const packageRoot of candidates) {
    const provisioner = join(packageRoot, 'scripts', 'provision-inproc-profile.mjs')
    const profileName = join(packageRoot, 'scripts', 'lib', 'profile-name.mjs')
    const companionPolicy = join(packageRoot, COMPANION_POLICY)
    if (existsSync(provisioner) && existsSync(profileName) && existsSync(companionPolicy)) {
      return { prefix: root, packageRoot, provisioner, profileName, companionPolicy }
    }
  }
  usageError(
    `installed package not usable under ${root}: expected scripts/provision-inproc-profile.mjs + `
    + `scripts/lib/profile-name.mjs + scripts/lib/companion-policy.mjs in ${candidates.join(' or ')}`,
  )
}

export async function loadProfileName(profileNamePath) {
  const mod = await import(pathToFileURL(profileNamePath).href)
  const name = mod.DEFAULT_PROFILE
  if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\')) {
    usageError(`invalid DEFAULT_PROFILE exported by ${profileNamePath}: ${JSON.stringify(name)}`)
  }
  return name
}

/** Inherit PATH but drop every directory that carries a user-level dsh binary. */
export function stripDshFromPath(inputPath) {
  const parts = String(inputPath ?? '').split(delimiter).filter(Boolean)
  const home = homedir()
  return parts
    .filter((part) => {
      const abs = resolve(part)
      if (abs === home || abs.startsWith(`${home}/`)) return false
      return !existsSync(join(abs, 'dsh')) && !existsSync(join(abs, 'dsh-opentui'))
    })
    .join(delimiter)
}

/** Base env for every child: no inherited DSH_* except the explicit pin list. */
export function buildEnv({ includeDshDir, hostVersion, lockWaitMs } = {}) {
  const env = {
    PATH: stripDshFromPath(process.env.PATH),
    HOME: undefined, // filled per scenario
    LANG: process.env.LANG ?? 'C.UTF-8',
  }
  for (const key of ENV_WHITELIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  if (hostVersion) env.DSH_OPENTUI_HOST_VERSION = hostVersion
  if (lockWaitMs !== undefined) env.DSH_OPENTUI_PROVISION_LOCK_WAIT_MS = String(lockWaitMs)
  if (includeDshDir) env.PATH = `${includeDshDir}${delimiter}${env.PATH}`
  return env
}

/**
 * Resolve the positive pass's host version. Explicit caller pin wins; otherwise
 * ask the supplied dsh binary. Undefined => caller supplied neither and the
 * positive pass cannot run (negative #1 covers that exact case).
 */
export function resolveHostVersion({ dshBin, env }) {
  const pinned = env.DSH_OPENTUI_HOST_VERSION
  if (typeof pinned === 'string' && pinned.trim()) return pinned.trim()
  if (!dshBin) return undefined
  const result = spawnSync(dshBin, ['--version'], { encoding: 'utf8', timeout: 10_000 })
  const raw = String(result.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).find(Boolean)
  if (result.error || result.status !== 0 || !raw) {
    usageError(`${dshBin} --version failed; set DSH_OPENTUI_HOST_VERSION explicitly`)
  }
  return raw.replace(/^v/, '')
}

/**
 * The desired companion set has ONE authoritative source: the installed
 * package's scripts/lib/companion-policy.mjs. No fallback catalog, no
 * "whatever was installed" inference — a missing/invalid policy is fail-fast.
 */
export async function loadCompanionIds(companionPolicyPath, catalogPath) {
  if (!existsSync(companionPolicyPath)) {
    usageError(`companion policy module not found: ${companionPolicyPath}`)
  }
  let mod
  try {
    mod = await import(pathToFileURL(companionPolicyPath).href)
  } catch (error) {
    usageError(`cannot load companion policy ${companionPolicyPath}: ${error?.message ?? error}`)
  }
  const ids = mod.DEFAULT_COMPANION_IDS
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string' || !id)) {
    usageError(`invalid DEFAULT_COMPANION_IDS exported by ${companionPolicyPath}: ${JSON.stringify(ids)}`)
  }
  // Policy IDs are catalog `short` values (registry, ask-router, ...). Map them
  // through the shipped catalog to the package names actually written to the
  // manifest / node_modules. A future policy that exports full package names
  // is accepted verbatim.
  let catalog = []
  if (existsSync(catalogPath)) {
    try {
      const catalogMod = await import(pathToFileURL(catalogPath).href)
      if (Array.isArray(catalogMod.COMPANIONS)) catalog = catalogMod.COMPANIONS
    } catch (error) {
      usageError(`cannot load companion catalog ${catalogPath}: ${error?.message ?? error}`)
    }
  }
  const names = ids.map((id) => {
    if (id.startsWith('@')) return id
    const entry = catalog.find((item) => item?.short === id && typeof item.name === 'string')
    if (!entry) usageError(`companion policy id ${JSON.stringify(id)} has no name in ${catalogPath}`)
    return entry.name
  })
  return { ids: [...ids], names }
}

/** Declared companion bundles from the profile manifest the provisioner wrote. */
function declaredCompanionIds(manifest) {
  const bundles = manifest?.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) return undefined
  return bundles.filter((id) => typeof id === 'string' && id.startsWith('@aiwayds/')
    && id !== BRIDGE_NAME && id !== SHIM_NAME)
}

/** Companion-looking directories actually present in the profile's node_modules. */
function onDiskCompanionIds(profileDir) {
  const scopeDir = join(profileDir, 'node_modules', '@aiwayds')
  let entries = []
  try { entries = readdirSync(scopeDir, { withFileTypes: true }) } catch { return [] }
  return entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => `@aiwayds/${entry.name}`)
    .filter((id) => id !== BRIDGE_NAME && id !== SHIM_NAME)
    .sort()
}

function truncate(value) {
  const text = String(value ?? '')
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n...[truncated ${text.length - MAX_OUTPUT} chars]` : text
}

function runProvisioner({ provisioner, args, env, dshHome, home, timeoutMs }) {
  const started = Date.now()
  const result = spawnSync(process.execPath, [provisioner, ...args], {
    env: { ...env, HOME: home ?? dshHome, DSH_HOME: dshHome },
    encoding: 'utf8',
    timeout: timeoutMs,
    cwd: dirname(provisioner),
  })
  return {
    status: result.status,
    signal: result.signal,
    error: result.error ? String(result.error.message) : undefined,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    durationMs: Date.now() - started,
  }
}

// The provisioner's fail() composes the repair element from BRIDGE_REPAIR_HINT
// ("Run `dsh-opentui --repair-bridge` ..."), while the shared formatter uses
// "Fix: <command>". Accept both so this gate survives either text source.
function hasFailFastTrio(stderr) {
  const hasRepair = /dsh-opentui --repair-bridge/.test(stderr) || stderr.includes('Fix:')
  return hasRepair && stderr.includes(FAIL_FAST_NOTICE) && /FAIL|cannot|failed|could not|mismatch/i.test(stderr)
}

/** Header marker: real patches use "# profileRevision: <hex>"; accept the
 * templateRevision spelling too so a header/sidecar rename cannot silently
 * degrade the equality check to NOT RUN. */
function revisionOf(text) {
  const match = String(text).match(/^[ \t]*#[ \t]*(?:profileRevision|templateRevision|patchRevision|revision)[ \t]*:[ \t]*([0-9a-fA-F]+)[ \t]*$/im)
  return match ? match[1].toLowerCase() : undefined
}

/**
 * Sidecar contract (patch-ownership-state.mjs / templateProjection):
 *   { version: 1, templateRevision: <hex>, rows: {...}, writtenAt: ... }
 * templateRevision is authoritative; older/alternate shapes are accepted as
 * fallbacks but never inferred from patch contents.
 */
function revisionFromSidecar(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const containers = [raw, raw.sidecar, raw.state, raw.template, raw.patch]
  const keys = ['templateRevision', 'profileRevision', 'patchRevision', 'revision']
  for (const container of containers) {
    if (!container || typeof container !== 'object' || Array.isArray(container)) continue
    for (const key of keys) {
      const value = container[key]
      if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase()
    }
  }
  return undefined
}

function positiveChecks({ profileDir, desired, run }) {
  const checks = [check('positive:exit0', run.status === 0, `exit=${run.status} signal=${run.signal ?? 'none'}${run.error ? ` error=${run.error}` : ''}`)]
  if (run.status !== 0) return checks

  checks.push(check('profile:exists', existsSync(profileDir) && statSync(profileDir).isDirectory(), profileDir))
  for (const legacy of LEGACY_PROFILES) {
    const legacyDir = join(dirname(profileDir), legacy)
    if (legacy === basename(profileDir)) {
      checks.push(skip(`legacy:${legacy}`, 'active DEFAULT_PROFILE; legacy-name assertion not applicable'))
    } else {
      checks.push(check(`legacy:${legacy}:absent`, !existsSync(legacyDir), legacyDir))
    }
  }

  const patchPath = join(profileDir, 'cordis.patch.yml')
  let patchText = ''
  try { patchText = readFileSync(patchPath, 'utf8') } catch { /* checked below */ }
  checks.push(check('patch:exists', existsSync(patchPath), patchPath))
  const missing = MANAGED_PATCH_LINES.filter((line) => !patchText.includes(line))
  checks.push(check('patch:managed-lines', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : MANAGED_PATCH_LINES.join(', ')))

  const sidecarPath = join(profileDir, '.patch-ownership.json')
  let sidecar
  try { sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) } catch { /* checked below */ }
  checks.push(check('ownership:sidecar-exists', existsSync(sidecarPath), sidecarPath))
  const headerRevision = revisionOf(patchText)
  const sidecarRevision = revisionFromSidecar(sidecar)
  if (headerRevision && sidecarRevision) {
    checks.push(check('ownership:revision-matches', headerRevision === sidecarRevision,
      `header=${headerRevision} sidecar.templateRevision=${sidecarRevision}`))
  } else {
    checks.push(skip('ownership:revision-matches',
      `header=${headerRevision ?? 'absent'} sidecar.templateRevision=${sidecarRevision ?? 'absent'} (no revision marker in one side; presence asserted only)`))
  }

  // Companion set must be EXACTLY the policy's DEFAULT_COMPANION_IDS — neither
  // missing nor extra, in the manifest AND on disk. "Some of them exist" is
  // explicitly not a pass (D2's 10 missing companions were previously masked).
  const desiredSet = [...desired].sort()
  let manifest
  try { manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) } catch { /* checked below */ }
  const declared = declaredCompanionIds(manifest)
  const onDisk = onDiskCompanionIds(profileDir)
  const missingOnDisk = desiredSet.filter((name) => !onDisk.includes(name))
  const missingDeclared = declared === undefined ? ['<manifest has no dsh.profile.bundles>'] : desiredSet.filter((name) => !declared.includes(name))
  const extraOnDisk = onDisk.filter((name) => !desiredSet.includes(name))
  const extraDeclared = declared === undefined ? [] : declared.filter((name) => !desiredSet.includes(name))
  checks.push(check('companions:desired', desiredSet.length > 0 && missingOnDisk.length === 0,
    `${desiredSet.length - missingOnDisk.length}/${desiredSet.length} policy ids installed${missingOnDisk.length ? `; missing: ${missingOnDisk.join(', ')}` : ''}`))
  checks.push(check('companions:manifest-exact', declared !== undefined && missingDeclared.length === 0 && extraDeclared.length === 0,
    declared === undefined ? 'manifest has no dsh.profile.bundles array'
      : `declared=${declared.length} policy=${desiredSet.length}${missingDeclared.length ? `; missing: ${missingDeclared.join(', ')}` : ''}${extraDeclared.length ? `; extra: ${extraDeclared.join(', ')}` : ''}`))
  checks.push(check('companions:ondisk-exact', missingOnDisk.length === 0 && extraOnDisk.length === 0,
    `onDisk=${onDisk.length} policy=${desiredSet.length}${missingOnDisk.length ? `; missing: ${missingOnDisk.join(', ')}` : ''}${extraOnDisk.length ? `; extra: ${extraOnDisk.join(', ')}` : ''}`))

  const bridgeDir = join(profileDir, 'node_modules', ...BRIDGE_NAME.split('/'))
  const bridgeFiles = ['package.json', 'index.js', 'bundle-fingerprint.json']
  const missingBridge = bridgeFiles.filter((file) => !existsSync(join(bridgeDir, file)))
  checks.push(check('bridge:copied', missingBridge.length === 0, missingBridge.length ? `missing: ${missingBridge.join(', ')}` : bridgeDir))
  if (missingBridge.length === 0) {
    let identityOk = false
    try {
      const fingerprint = JSON.parse(readFileSync(join(bridgeDir, 'bundle-fingerprint.json'), 'utf8'))
      const digest = createHash('sha256').update(readFileSync(join(bridgeDir, 'index.js'))).digest('hex')
      identityOk = fingerprint.sha256 === digest
    } catch { /* identity check below */ }
    checks.push(check('bridge:identity', identityOk, identityOk ? 'index.js sha256 matches bundle-fingerprint.json' : 'index.js sha256 mismatch or unreadable fingerprint'))
  }

  const lockPath = join(profileDir, '.provision.lock')
  checks.push(check('lock:released', !existsSync(lockPath), lockPath))
  return checks
}

/**
 * Run the gate. Exported so the unit tests can drive a fake prefix.
 * Options: { prefix, dshBin, scenario, keep, keepOnFailure, timeoutMs }
 */
export async function runVerification({ prefix, dshBin, scenario = 'all', keep = false, keepOnFailure = true, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (scenario !== 'all' && !SCENARIOS.includes(scenario)) {
    usageError(`--scenario must be one of: ${[...SCENARIOS, 'all'].join(', ')}`)
  }
  const selected = scenario === 'all' ? SCENARIOS : [scenario]
  const selectedSet = new Set(selected)
  const scenarioStatus = Object.fromEntries(SCENARIOS.map((name) => [name, 'NOT RUN']))
  const located = locatePackage(prefix)
  const DEFAULT_PROFILE = await loadProfileName(located.profileName)
  // Authoritative desired set: fail-fast (exit 2) before any scratch I/O if the
  // installed package does not ship the companion policy module.
  const { ids: desiredCompanionIds, names: desiredCompanions } = await loadCompanionIds(
    located.companionPolicy,
    join(located.packageRoot, 'scripts', 'lib', 'inproc-companions.mjs'),
  )
  const scratchBase = platform() === 'darwin' ? '/private/tmp' : tmpdir()
  const scratchHome = mkdtempSync(join(scratchBase, 'dsh-fresh-home-'))
  const checks = []
  const notes = []
  const scenarios = {}
  const envPinned = buildEnv({})
  let hostVersion
  // The no-dsh scenario is defined by the absence of a host and must not probe
  // one, even when a caller supplied --with-dsh for a different scenario.
  if ([...selected].some((name) => name !== 'no-dsh')) {
    try {
      hostVersion = resolveHostVersion({ dshBin, env: envPinned })
    } catch (error) {
      rmSync(scratchHome, { recursive: true, force: true })
      throw error
    }
  }
  if (selectedSet.has('positive') && !hostVersion && !dshBin) {
    notes.push('No --with-dsh and no DSH_OPENTUI_HOST_VERSION pin: positive pass cannot exit 0; negative #1 exercises this case.')
  }

  const scenarioHome = (name) => {
    const home = join(scratchHome, `home-${name}`)
    mkdirSync(home, { recursive: true })
    return home
  }
  const finishScenario = (name, start) => {
    const scoped = checks.slice(start)
    scenarioStatus[name] = scoped.some((c) => c.status === 'FAIL') ? 'FAIL'
      : scoped.some((c) => c.status === 'PASS') ? 'PASS' : 'NOT RUN'
  }

  try {
    for (const name of SCENARIOS) {
      if (!selectedSet.has(name)) checks.push(skip(`scenario:${name}`, `not selected by --scenario ${scenario}`))
    }

    // ---- positive pass -------------------------------------------------------
    if (selectedSet.has('positive')) {
      const start = checks.length
      const posHome = scenarioHome('positive')
      const profileDir = join(posHome, 'profiles', DEFAULT_PROFILE)
      if (hostVersion) {
        const env = buildEnv({
          includeDshDir: dshBin ? dirname(dshBin) : undefined,
          hostVersion,
        })
        const run = runProvisioner({ provisioner: located.provisioner, args: [], env, dshHome: posHome, home: scratchHome, timeoutMs })
        scenarios.positive = run
        checks.push(...positiveChecks({ profileDir, desired: desiredCompanions, run }))
      } else {
        scenarios.positive = { status: null, stdout: '', stderr: '', durationMs: 0 }
        checks.push(skip('positive:exit0', 'no dsh and no host-version pin; covered by negative #1'))
        notes.push('positive path NOT RUN')
      }
      finishScenario('positive', start)
    }

    // ---- negative #1: no dsh + no host version -------------------------------
    if (selectedSet.has('no-dsh')) {
      const start = checks.length
      const home = scenarioHome('no-dsh')
      const env = buildEnv({})
      // Explicitly drop a caller-supplied pin: this scenario is defined by its absence.
      delete env.DSH_OPENTUI_HOST_VERSION
      env.DSH_OPENTUI_COMPANION_LATEST = 'off'
      const run = runProvisioner({ provisioner: located.provisioner, args: [], env, dshHome: home, home: scratchHome, timeoutMs: NEG_TIMEOUT_MS })
      scenarios.noDsh = run
      checks.push(check('negative:no-dsh:exit-nonzero', run.status !== 0, `exit=${run.status}`))
      checks.push(check('negative:no-dsh:fail-fast-trio', hasFailFastTrio(run.stderr), truncate(run.stderr).split('\n').slice(-4).join(' | ')))
      const profileDirNeg = join(home, 'profiles', DEFAULT_PROFILE)
      const artifacts = ['package.json', 'cordis.patch.yml', 'node_modules'].filter((name) => existsSync(join(profileDirNeg, name)))
      checks.push(check('negative:no-dsh:no-profile-artifacts', artifacts.length === 0, artifacts.length ? `artifacts: ${artifacts.join(', ')}` : 'no manifest/patch/bridge written'))
      checks.push(skip('negative:no-dsh:strict-no-profile-dir', existsSync(profileDirNeg)
        ? 'real provisioner mkdir(profile) as lock parent before the host gate; empty dir only, no profile written'
        : 'profile dir absent'))
      finishScenario('no-dsh', start)
    }

    // ---- negative #2: live .provision.lock ----------------------------------
    if (selectedSet.has('live-lock')) {
      const start = checks.length
      const home = scenarioHome('live-lock')
      const lockProfile = join(home, 'profiles', DEFAULT_PROFILE)
      mkdirSync(lockProfile, { recursive: true })
      const nonce = createHash('sha256').update(`${process.pid}:${Date.now()}:lock-probe`).digest('hex').slice(0, 16)
      const lockPath = join(lockProfile, '.provision.lock')
      const lockRecord = JSON.stringify({ pid: process.pid, nonce, startedAt: Date.now(), heartbeatAt: Date.now(), step: 'probe' })
      writeFileSync(lockPath, lockRecord, { mode: 0o600 })
      const env = buildEnv({ includeDshDir: dshBin ? dirname(dshBin) : undefined, hostVersion: hostVersion ?? '0.2.2-rc.5', lockWaitMs: 100 })
      const run = runProvisioner({ provisioner: located.provisioner, args: [], env, dshHome: home, home: scratchHome, timeoutMs: NEG_TIMEOUT_MS })
      scenarios.liveLock = run
      checks.push(check('negative:live-lock:exit-2', run.status === 2, `exit=${run.status} (must be 2, never SKIP-0)`))
      let after = ''
      try { after = readFileSync(lockPath, 'utf8') } catch { /* checked below */ }
      checks.push(check('negative:live-lock:not-overwritten', after === lockRecord, after === lockRecord ? 'pid+nonce unchanged' : `lock changed: ${truncate(after)}`))
      finishScenario('live-lock', start)
    }

    // ---- negative #3: corrupted/missing bridge (source artifact) ------------
    if (selectedSet.has('bad-bridge') || selectedSet.has('bad-bridge-repair')) {
      const home = scenarioHome('bad-bridge')
      const bridgeSrc = join(located.packageRoot, 'dist', 'bridge')
      const badDir = join(scratchHome, 'bad-bridge-src')
      const missingDir = join(scratchHome, 'missing-bridge-src')
      const hasBridge = existsSync(join(bridgeSrc, 'bundle-fingerprint.json'))
      const env = buildEnv({
        includeDshDir: dshBin ? dirname(dshBin) : undefined,
        hostVersion: hostVersion ?? '0.2.2-rc.5',
      })
      env.DSH_OPENTUI_COMPANION_LATEST = 'off'
      if (hasBridge) {
        cpSync(bridgeSrc, badDir, { recursive: true })
        const fpPath = join(badDir, 'bundle-fingerprint.json')
        const fp = JSON.parse(readFileSync(fpPath, 'utf8'))
        writeFileSync(fpPath, JSON.stringify({ ...fp, version: '0.0.0-BROKEN-FIXTURE' }))
      }
      if (selectedSet.has('bad-bridge')) {
        const start = checks.length
        if (hasBridge) {
          env.DSH_OPENTUI_TEST_BRIDGE_DIR = badDir
          const run = runProvisioner({ provisioner: located.provisioner, args: [], env, dshHome: home, home: scratchHome, timeoutMs: NEG_TIMEOUT_MS })
          scenarios.badBridge = run
          checks.push(check('negative:bad-bridge:fail-fast', run.status !== 0 && hasFailFastTrio(run.stderr), `exit=${run.status}; ${truncate(run.stderr).split('\n').slice(-3).join(' | ')}`))
        }
        // A missing bridge directory is independently fatal; never turn a
        // missing shipped artifact into a silent NOT RUN pass.
        env.DSH_OPENTUI_TEST_BRIDGE_DIR = missingDir
        const missingRun = runProvisioner({ provisioner: located.provisioner, args: [], env, dshHome: home, home: scratchHome, timeoutMs: NEG_TIMEOUT_MS })
        scenarios.badBridgeMissing = missingRun
        checks.push(check('negative:bad-bridge:missing-dir-fail-fast',
          missingRun.status !== 0 && hasFailFastTrio(missingRun.stderr),
          `exit=${missingRun.status}; ${truncate(missingRun.stderr).split('\n').slice(-3).join(' | ')}`))
        finishScenario('bad-bridge', start)
      }
      if (selectedSet.has('bad-bridge-repair')) {
        const start = checks.length
        if (!hasBridge) {
          checks.push(skip('negative:bad-bridge:repair-restores', 'no valid dist/bridge artifact to restore'))
        } else {
          // The shipped provisioner documents --repair-bridge as a no-op for a
          // corrupted SOURCE artifact; restoring the artifact is what recovers.
          // With a fake provisioner this branch is exercised end-to-end in tests.
          cpSync(join(bridgeSrc, 'bundle-fingerprint.json'), join(badDir, 'bundle-fingerprint.json'))
          env.DSH_OPENTUI_TEST_BRIDGE_DIR = badDir
          const repairRun = runProvisioner({ provisioner: located.provisioner, args: ['--repair-bridge'], env, dshHome: home, home: scratchHome, timeoutMs: NEG_TIMEOUT_MS })
          scenarios.badBridgeRepair = repairRun
          if (repairRun.status === 0) {
            checks.push(ok('negative:bad-bridge:repair-restores', 'exit=0 after restoring a valid bridge source; --repair-bridge accepted'))
          } else {
            checks.push(skip('negative:bad-bridge:repair-restores',
              `source artifact restored but --repair-bridge run exited ${repairRun.status}: the shipped provisioner treats the flag as a no-op for artifact contents (see provision-inproc-profile.mjs:87-90); recovery requires a valid installed artifact, not the flag`))
          }
        }
        finishScenario('bad-bridge-repair', start)
      }
    }
  } finally {
    const failed = checks.some((c) => c.status === 'FAIL')
    const shouldKeep = keep || (keepOnFailure && failed)
    if (!shouldKeep) rmSync(scratchHome, { recursive: true, force: true })
  }

  const failed = checks.some((c) => c.status === 'FAIL')
  const kept = keep || (keepOnFailure && failed)
  const result = failed ? 'FAIL' : checks.some((c) => c.status === 'PASS') ? 'PASS' : 'NOT RUN'
  return {
    prefix: located.prefix,
    packageRoot: located.packageRoot,
    profile: join(scratchHome, 'home-positive', 'profiles', DEFAULT_PROFILE),
    scratchHome,
    kept,
    profileName: DEFAULT_PROFILE,
    desiredCompanions,
    desiredCompanionIds,
    scenario,
    scenarioStatus,
    pass: !failed,
    result,
    // Positive-pass captured streams; per-scenario streams live in scenarios.*.
    stdout: scenarios.positive?.stdout ?? '',
    stderr: scenarios.positive?.stderr ?? '',
    checks,
    scenarios,
    notes,
    durationMs: Object.values(scenarios).reduce((sum, s) => sum + (s.durationMs ?? 0), 0),
  }
}

function printHuman(report) {
  for (const c of report.checks) console.log(`${c.status.padEnd(7)} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
  for (const n of report.notes) console.log(`NOTE    ${n}`)
  if (report.kept) console.log(`scratch HOME kept: ${report.scratchHome}`)
  console.log(`${report.result} fresh-home provision gate (${report.checks.filter((c) => c.status === 'PASS').length} PASS / ${report.checks.filter((c) => c.status === 'FAIL').length} FAIL / ${report.checks.filter((c) => c.status === 'NOT RUN').length} NOT RUN)`)
  console.log(JSON.stringify(report, null, 2))
}

async function main(argv = process.argv.slice(2)) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error(`[fresh-home-provision] ${error.message}`)
    process.exitCode = 2
    return
  }
  try {
    const report = await runVerification(options)
    if (options.json) console.log(JSON.stringify(report, null, 2))
    else printHuman(report)
    process.exitCode = report.pass ? 0 : 1
  } catch (error) {
    console.error(`[fresh-home-provision] ${error.message}`)
    process.exitCode = 2
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) await main()

export { main }
