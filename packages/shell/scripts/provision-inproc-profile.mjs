#!/usr/bin/env node
// provision-inproc-profile.mjs — idempotent provisioning of the fixed
// `opentui-inproc` host profile (ADR-0009 decision 3; T3 of the in-process
// bridge plan).
//
// Invoked by the launcher ONLY when DSH_OPENTUI_INPROC=1
// (bin/dsh-opentui.mjs); the default `opentui` profile path is untouched.
// Three local-FS steps, no pnpm/npm, no install scripts:
//
//   [1/4] manifest — write $DSH_HOME/profiles/opentui-inproc/package.json with
//                    dsh.profile.bundles = [@deepseek-ai/dsh-base,
//                    @aiwayds/dsh-opentui-bridge]. NO @deepseek-ai/* dependency
//                    is ever written: the host's installation-first bundle
//                    resolution supplies those bundles from the running dsh
//                    closure (wild-package shadowing is the historical
//                    incident this guard prevents).
//   [2/4] symlink  — create node_modules/@aiwayds/dsh-opentui-bridge as an
//                    ABSOLUTE symlink to THIS installation's dist/bridge
//                    (realpath). No link:/file: protocol, no copying.
//   [3/4] verify   — re-read the link and confirm it resolves to dist/bridge;
//                    refuse any @deepseek-ai copy in the profile.
//   [4/4] identity — T5 guard: hash the RESOLVED bridge's index.js and compare
//                    with the build-time fingerprint shipped in THIS
//                    installation's dist/bridge/bundle-fingerprint.json, plus
//                    name / version. No realpath-prefix hard binding.
//
// T4 — cross-instance mutual exclusion:
//   The whole provisioning run is serialized by `.provision.lock` in the
//   profile dir, created with O_EXCL ("wx"). A live holder makes late
//   instances wait briefly (bounded retries) and then SKIP; a stale lock
//   (holder pid gone, age over threshold, corrupt, or self-leftover) is
//   taken over. The lock is released in `finally`, including on failure.
//   Same-machine only: no cross-host / cross-user semantics.
//
// Idempotency: an existing symlink that resolves to the exact expected target
// is left untouched. An existing entry that points somewhere else is NOT
// overwritten: a conflict is reported (the identity guard below still runs
// and decides whether the resolved artifact is acceptable).
//
// T7 — repair mode (`--repair`, invoked by `dsh-opentui --repair-bridge`):
//   In the normal path the conflict above is report-only. With --repair the
//   SAME lock and the SAME pass are used, but a wrong symlink target (or a
//   non-symlink entry) is replaced with the absolute link to this install's
//   dist/bridge; a missing / wrong manifest is still converged as usual. The
//   T5 identity guard runs afterwards either way — repair fixes the LINK,
//   never the artifact CONTENT, so a fingerprint mismatch still fails.
//
// Hard guard: this script only ever touches the ONE profile named
// `opentui-inproc`. It never runs a package manager and never writes a
// dependency into the manifest.

import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const PREFIX = 'dsh-opentui(inproc): '
const PROFILE = 'opentui-inproc'
const BRIDGE_NAME = '@aiwayds/dsh-opentui-bridge'
const BUNDLES = ['@deepseek-ai/dsh-base', BRIDGE_NAME]
const REPAIR_HINT = 'Run `dsh-opentui --repair-bridge` to rebuild the bridge symlink / manifest (it fixes links, not corrupted artifact contents).'

// --- T4 lock tuning (same-machine only) -------------------------------------
const LOCK_NAME = '.provision.lock'
const LOCK_STALE_MS = 30_000 // a live holder older than 30s is treated as stale
const LOCK_RETRY_MS = 25 // backoff between attempts while a peer holds the lock
const LOCK_MAX_ATTEMPTS = 40 // <= ~1s of waiting before a peer is skipped

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const bridgeDirRaw = join(pkgRoot, 'dist', 'bridge')
const fingerprintPath = join(bridgeDirRaw, 'bundle-fingerprint.json')

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', PROFILE)
const manifestPath = join(profileDir, 'package.json')
const linkPath = join(profileDir, 'node_modules', ...BRIDGE_NAME.split('/'))
const lockPath = join(profileDir, LOCK_NAME)

const say = (step, label, value = '') => console.log(`${PREFIX}[${step}/4] ${label}${value ? ` — ${value}` : ''}`)
const warn = (message) => console.error(`${PREFIX}WARN ${message}`)
const note = (message) => console.log(`${PREFIX}${message}`)

class ProvisionError extends Error {
  constructor(message, detail = '') {
    super(message)
    this.detail = detail
  }
}

// Throw instead of process.exit so a `finally` block can always release the
// lock. The top-level handler sets a non-zero exit code after cleanup.
function fail(message, detail = '') {
  throw new ProvisionError(message, detail)
}

// Synchronous sleep: the whole script is synchronous, so a blocking wait is
// appropriate here. Atomics.wait is permitted on the Node.js main thread.
function sleepSync(ms) {
  const buf = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(buf, 0, 0, ms)
}

// --- T4: lock helpers -------------------------------------------------------
function readJsonObject(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function readLock() {
  const raw = readJsonObject(lockPath)
  if (!raw || !Number.isInteger(raw.pid) || !Number.isFinite(raw.ts)) return undefined
  return raw
}

/** process.kill(pid, 0) probes existence without signalling. EPERM means the
 *  process exists but belongs to another user — treat it as alive (no
 *  cross-user takeover semantics by design). */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function staleReason(lock) {
  if (lock === undefined) return 'lock file is unreadable or corrupt'
  if (lock.pid === process.pid) return `held by self (pid ${lock.pid})`
  if (!pidAlive(lock.pid)) return `holder pid ${lock.pid} no longer exists`
  return `holder pid ${lock.pid} alive but lock age ${Date.now() - lock.ts}ms > ${LOCK_STALE_MS}ms`
}

function isStale(lock) {
  if (lock === undefined) return true
  if (lock.pid === process.pid) return true
  if (!pidAlive(lock.pid)) return true
  return Date.now() - lock.ts > LOCK_STALE_MS
}

/** Exclusive-create the lock. Returns the owned token, or undefined when a
 *  live peer kept it through all retries (caller then SKIPs). Stale locks are
 *  removed and re-contended. Ownership is re-read after create so a concurrent
 *  stale-takeover cannot make two processes both believe they hold it. */
function acquireLock() {
  for (let attempt = 1; attempt <= LOCK_MAX_ATTEMPTS; attempt++) {
    const token = { pid: process.pid, ts: Date.now() }
    let created = false
    try {
      const fd = openSync(lockPath, 'wx', 0o600)
      try {
        writeSync(fd, JSON.stringify(token))
      } finally {
        closeSync(fd)
      }
      created = true
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }

    if (created) {
      const held = readLock()
      if (held && held.pid === token.pid && held.ts === token.ts) {
        if (attempt > 1) note(`acquired provisioning lock on attempt ${attempt}`)
        return token
      }
      // Our create was immediately replaced by another process — do NOT
      // unlink (the lock now belongs to them); just retry.
      sleepSync(LOCK_RETRY_MS)
      continue
    }

    // EEXIST: inspect the holder.
    const lock = readLock()
    if (isStale(lock)) {
      note(`stale provisioning lock (${staleReason(lock)}); taking over`)
      try {
        unlinkSync(lockPath)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      continue
    }
    if (attempt === 1 || attempt % 5 === 0) {
      note(`waiting for provisioning lock (holder pid ${lock.pid}, age ${Date.now() - lock.ts}ms) — attempt ${attempt}/${LOCK_MAX_ATTEMPTS}`)
    }
    sleepSync(LOCK_RETRY_MS)
  }
  return undefined
}

/** Only unlink a lock that is still ours, so a peer that took over after our
 *  stale threshold never loses its own lock to our cleanup. */
function releaseLock(token) {
  if (!token) return
  try {
    const held = readLock()
    if (held && held.pid === token.pid && held.ts === token.ts) unlinkSync(lockPath)
  } catch {
    /* best effort cleanup: never mask the primary provisioning result */
  }
}

// --- Provisioning helpers ---------------------------------------------------
function readManifest() {
  return readJsonObject(manifestPath)
}

const desiredManifest = (existing) => ({
  ...existing,
  dsh: {
    ...(existing?.dsh ?? {}),
    profile: {
      ...(existing?.dsh?.profile ?? {}),
      bundles: [...BUNDLES],
    },
  },
})

function linkState(path) {
  let lst
  try {
    lst = lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return { kind: 'absent' }
    throw error
  }
  if (!lst.isSymbolicLink()) return { kind: 'not-symlink' }
  const raw = readlinkSync(path)
  // Resolve a relative target against the link's own directory so comparison
  // is meaningful; a realpath (when resolvable) also collapses link chains.
  const abs = resolvePath(dirname(path), raw)
  let resolved = abs
  try {
    resolved = realpathSync(path)
  } catch {
    /* dangling link — fall back to the lexical absolute target */
  }
  return { kind: 'symlink', raw, abs, resolved }
}

/** Remove whatever occupies `path` (symlink, file or directory) so the correct
 *  symlink can be created in its place. Repair mode only; ENOENT is a no-op. */
function removePath(path) {
  let st
  try {
    st = lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  if (st.isDirectory()) rmSync(path, { recursive: true, force: true })
  else unlinkSync(path)
}

// --- T5: bridge identity guard ---------------------------------------------
function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Validate the RESOLVED bridge against the build-time fingerprint shipped in
 *  THIS installation. The fingerprint is the authority (not the bridge's own
 *  package.json, which would be self-attestation), and there is deliberately
 *  NO realpath-prefix check: a repointed link is accepted iff name, version
 *  and index.js hash all match — a 0.23.0 split-package install must work. */
function verifyBridgeIdentity() {
  const fp = readJsonObject(fingerprintPath)
  if (
    !fp ||
    typeof fp.name !== 'string' ||
    typeof fp.version !== 'string' ||
    typeof fp.sha256 !== 'string'
  ) {
    fail(
      'build-time bridge fingerprint is missing or malformed',
      `Expected ${fingerprintPath} with string fields name/version/sha256. Rebuild with: bun scripts/build-bridge.mjs\n${REPAIR_HINT}`,
    )
  }

  let resolved
  try {
    resolved = realpathSync(linkPath)
  } catch (error) {
    fail(
      `bridge symlink cannot be resolved: ${linkPath}`,
      `${error?.message ?? error}\n${REPAIR_HINT}`,
    )
  }

  const resolvedPkg = readJsonObject(join(resolved, 'package.json'))
  const actualName = resolvedPkg?.name
  const actualVersion = resolvedPkg?.version
  let actualHash
  try {
    actualHash = sha256File(join(resolved, 'index.js'))
  } catch (error) {
    actualHash = `<unreadable: ${error?.code ?? error?.message ?? error}>`
  }

  const mismatches = []
  const add = (field, expected, actual) => mismatches.push({ field, expected, actual: String(actual) })
  if (actualName !== fp.name) add('name', fp.name, actualName)
  if (actualVersion !== fp.version) add('version', fp.version, actualVersion)
  if (actualHash !== fp.sha256) add('sha256(index.js)', fp.sha256, actualHash)

  if (mismatches.length > 0) {
    const fields = mismatches.map((m) => m.field).join(', ')
    const detail = mismatches.map((m) => `  ${m.field}: expected "${m.expected}", actual "${m.actual}"`).join('\n')
    fail(
      `bridge identity check failed — ${fields} mismatch`,
      `Resolved bridge: ${resolved}\n${detail}\n${REPAIR_HINT}`,
    )
  }

  say(4, 'identity', `name=${fp.name} version=${fp.version} sha256=${fp.sha256.slice(0, 12)}…`)
  note(`bridge identity OK — ${resolved}`)
}

// --- The provision pass itself (runs under the lock) ------------------------
function runProvision({ repair = false } = {}) {
  if (repair) note('repair mode — a wrong bridge symlink will be rebuilt (content is never repaired)')
  // Prerequisites (read-only) are checked before any mutation.
  if (!existsSync(bridgeDirRaw) || !statSync(bridgeDirRaw).isDirectory()) {
    fail(
      `bridge artifact directory not found: ${bridgeDirRaw}`,
      'Rebuild the bridge (bun scripts/build-bridge.mjs) or reinstall @aiwayds/dsh-opentui so dist/bridge ships with the package.',
    )
  }
  for (const required of ['package.json', 'index.js', 'bundle-fingerprint.json']) {
    if (!existsSync(join(bridgeDirRaw, required))) {
      fail(
        `bridge artifact is incomplete: ${join(bridgeDirRaw, required)} not found`,
        'Expected package.json, index.js and bundle-fingerprint.json in dist/bridge; rebuild with bun scripts/build-bridge.mjs.',
      )
    }
  }
  // The symlink must carry a REAL resolved (absolute) path, never a relative
  // or symlinked-in path that could drift with cwd or a moved install.
  const bridgeDir = realpathSync(bridgeDirRaw)

  // [1/4] Manifest: write / converge the profile manifest. Only
  // dsh.profile.bundles is managed; every other field is preserved.
  {
    const existing = existsSync(manifestPath) ? readManifest() : undefined
    if (existsSync(manifestPath) && existing === undefined) {
      fail(`${manifestPath} is not a valid JSON object manifest — leaving it untouched`)
    }
    const desired = desiredManifest(existing ?? { name: `dsh-profile-${PROFILE}`, private: true })
    if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(desired)) {
      say(1, 'manifest', 'already correct, skipping')
    } else {
      mkdirSync(profileDir, { recursive: true })
      if (existsSync(manifestPath)) {
        const backupPath = `${manifestPath}.bak-${Date.now()}`
        renameSync(manifestPath, backupPath)
        console.log(`${PREFIX}backed up ${manifestPath} to ${backupPath}`)
      }
      // Atomic write: a temp file in the same dir, then rename, so a
      // concurrent reader never observes a partially written package.json.
      const tmpPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`
      writeFileSync(tmpPath, `${JSON.stringify(desired, null, 2)}\n`)
      renameSync(tmpPath, manifestPath)
      say(1, 'manifest', `wrote bundles [${BUNDLES.join(', ')}]`)
    }
  }

  // [2/4] Symlink: create the absolute link, skip when already correct, and
  // ONLY in repair mode replace a wrong target / non-symlink entry. Normal
  // startup stays report-only (a conflict is a WARN, never an overwrite).
  let conflict = null
  {
    const state = linkState(linkPath)
    if (state.kind === 'absent') {
      mkdirSync(dirname(linkPath), { recursive: true })
      try {
        symlinkSync(bridgeDir, linkPath, 'dir')
      } catch (error) {
        fail(`could not create symlink ${linkPath}: ${error?.message ?? error}`)
      }
      say(2, 'symlink', `created ${linkPath} -> ${bridgeDir}`)
    } else if (state.kind === 'symlink' && (state.resolved === bridgeDir || state.abs === bridgeDir)) {
      say(2, 'symlink', 'already points at the bridge artifact, skipping')
    } else if (repair) {
      const desc = state.kind === 'not-symlink'
        ? `${linkPath} is not a symlink`
        : `${linkPath} -> ${state.raw}`
      note(`repairing bridge link (${desc})`)
      try {
        removePath(linkPath)
        mkdirSync(dirname(linkPath), { recursive: true })
        symlinkSync(bridgeDir, linkPath, 'dir')
      } catch (error) {
        fail(`could not repair symlink ${linkPath}: ${error?.message ?? error}`)
      }
      say(2, 'symlink', `repaired ${linkPath} -> ${bridgeDir}`)
    } else if (state.kind === 'not-symlink') {
      conflict = `${linkPath} exists and is NOT a symlink`
    } else {
      conflict = `${linkPath} -> ${state.raw} (expected ${bridgeDir})`
    }
  }

  // [3/4] Verify: report-only for a conflict; never overwrite.
  if (conflict !== null) {
    warn(`conflict, not overwriting: ${conflict}`)
    warn('the profile link was left untouched; the identity guard below decides whether the resolved artifact is acceptable')
    console.log(`${PREFIX}REPORT — conflict detected, no change made to the link`)
  } else {
    const finalState = linkState(linkPath)
    if (finalState.kind !== 'symlink' || (finalState.resolved !== bridgeDir && finalState.abs !== bridgeDir)) {
      fail(`post-write verification failed for ${linkPath}: link does not resolve to ${bridgeDir}`)
    }
    // Explicit guard: no @deepseek-ai package may be present in the profile.
    const deepseekDir = join(profileDir, 'node_modules', '@deepseek-ai')
    if (existsSync(deepseekDir)) {
      fail(
        `forbidden @deepseek-ai packages found in profile: ${deepseekDir}`,
        'The host closure supplies @deepseek-ai/* bundles; they must never be copied into a profile directory.',
      )
    }
    say(3, 'verify', `bridge resolves to ${bridgeDir}; no @deepseek-ai copy in profile`)
  }

  // [4/4] Identity guard always runs, including on the conflict path, so a
  // repointed / replaced bridge cannot slip through as a mere WARN.
  verifyBridgeIdentity()

  console.log(`${PREFIX}PASS`)
}

function main(argv = []) {
  // --repair is passed by `dsh-opentui --repair-bridge`; accept the long form
  // too so the underlying mode is unambiguous when invoked directly.
  const repair = argv.includes('--repair') || argv.includes('--repair-bridge')
  console.log(`${PREFIX}dsh home ${dshHome}`)
  if (!existsSync(dshHome)) {
    fail(
      `DSH_HOME directory does not exist: ${dshHome}`,
      `Create it first (e.g. mkdir -p "${dshHome}"). The opentui-inproc profile must share the existing Harness home, not create an isolated one.`,
    )
  }
  if (!statSync(dshHome).isDirectory()) {
    fail(`DSH_HOME is not a directory: ${dshHome}`)
  }

  // The lock lives inside the profile dir, so make sure it exists first.
  mkdirSync(profileDir, { recursive: true })

  const token = acquireLock()
  if (!token) {
    // A live peer kept the lock: it is provisioning the same profile, so this
    // instance skips its own pass rather than corrupting the shared state.
    note(`SKIP — could not acquire provisioning lock after ${LOCK_MAX_ATTEMPTS} attempts (${LOCK_RETRY_MS}ms backoff); another live instance is provisioning; skipping.`)
    return
  }

  try {
    runProvision({ repair })
  } finally {
    releaseLock(token)
  }
}

try {
  main(process.argv.slice(2))
} catch (error) {
  if (error instanceof ProvisionError) {
    console.error(`${PREFIX}FAIL — ${error.message}`)
    if (error.detail) console.error(error.detail.trimEnd())
  } else {
    console.error(`${PREFIX}FAIL — unexpected error: ${error?.stack ?? String(error)}`)
  }
  process.exitCode = 1
}
