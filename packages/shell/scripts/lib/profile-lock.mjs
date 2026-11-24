/**
 * `profiles/<p>/package.json.lock` — the HOST's writer lock (design 06 R15).
 *
 * This is a byte-for-byte protocol replica of
 * dsh-atomic-write/src/index.ts:100-273:
 *   - the lock is a sibling of package.json, named package.json.lock;
 *   - its content is exactly `${pid}\n` (NOT JSON — the host's holderExited
 *     only accepts /^\d+\n$/, so a JSON record would leave a crashed lock
 *     un-takeoverable by the host);
 *   - exclusive creation with `wx` (EEXIST, or EPERM + lstat on Windows, is
 *     contention);
 *   - a dead holder is reclaimed only through a sha256-named claim file, and
 *     only after re-reading the record and re-probing the pid under that claim;
 *   - liveness is pid-only (ESRCH == dead). A reused pid, EPERM, an incomplete
 *     record or a foreign process is NEVER taken over and NEVER aged out.
 *
 * This lock protects only the short profile-file critical section (manifest +
 * patch + sidecar). It is deliberately NOT held across step 4's pnpm install.
 * The whole-run mutex is `.provision.lock` (see provision-run-lock.mjs).
 */

import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PROFILE_LOCK_WAIT_MS = 120_000
export const PROFILE_LOCK_NAME = 'package.json.lock'
export const WAIT_ENV = 'DSH_OPENTUI_PROFILE_LOCK_WAIT_MS'
export function waitMsFromEnv(env = process.env) {
  const raw = env[WAIT_ENV]
  if (raw === undefined || raw === '') return PROFILE_LOCK_WAIT_MS
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : PROFILE_LOCK_WAIT_MS
}
const RETRY_INITIAL_MS = 50
const RETRY_MAX_MS = 500
const PID_MAX = 0x7fffffff

/** Sleep without timers — the provisioner is a synchronous script. */
export function sleepSync(ms) {
  const buf = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(buf, 0, 0, ms)
}

/** ESRCH proves the process is gone; EPERM proves it exists under another user. */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid > PID_MAX) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** Host `holderExited` (atomic-write/src/index.ts:112-127), verbatim semantics. */
export function holderExited(record) {
  if (typeof record !== 'string' || !/^\d+\n$/.test(record)) return false
  const pid = Number(record.trim())
  if (pid === 0 || pid > PID_MAX || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return error?.code === 'ESRCH'
  }
}

export function readLockRecord(lockPath) {
  try {
    return readFileSync(lockPath, 'utf8')
  } catch {
    // A vanishing lock (or Windows still deleting it) proves nothing.
    return undefined
  }
}

function isLockContention(error, lockPath) {
  if (!error) return false
  if (error.code === 'EEXIST') return true
  if (error.code !== 'EPERM') return false
  try {
    lstatSync(lockPath)
    return true
  } catch {
    return false
  }
}

function claimPathFor(lockPath, record) {
  return `${lockPath}.takeover-${createHash('sha256').update(record).digest('hex').slice(0, 16)}`
}

/** atomic-write/src/index.ts:150-178 — serialize contenders before removing a dead holder's lock. */
export function takeOverExitedHolder(lockPath) {
  const record = readLockRecord(lockPath)
  if (record === undefined || !holderExited(record)) return false
  const claim = claimPathFor(lockPath, record)
  try {
    writeFileSync(claim, `${process.pid}\n`, { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'EPERM') return false
    throw error
  }
  try {
    if (readLockRecord(lockPath) !== record || !holderExited(record)) return false
    rmSync(lockPath, { force: true })
    return true
  } finally {
    // A stale claim names a record that is no longer the lock; it blocks nothing.
    rmSync(claim, { force: true })
  }
}

export class ProfileLockTimeoutError extends Error {
  constructor(lockPath, holderPid) {
    super(
      `timed out after ${PROFILE_LOCK_WAIT_MS}ms waiting for ${lockPath}` +
        (holderPid === undefined ? '' : ` (holder pid ${holderPid})`) +
        '. Another window may be running `dsh plugin install` (the host holds this lock for the whole pnpm run). ' +
        'Retry after it finishes; a pid-reused lock needs manual removal.',
    )
    this.name = 'ProfileLockTimeoutError'
    this.lockPath = lockPath
    this.holderPid = holderPid
    this.exitCode = 2
  }
}

/**
 * Run `operation` under the host lock. Sync by design (the provisioner uses
 * spawnSync throughout); the API shape otherwise matches the design's
 * `withProfileWriteLock(profileDir, fn, { waitMs })`.
 */
export function withProfileWriteLock(profileDir, operation, { waitMs = waitMsFromEnv(), sleep = sleepSync, now = Date.now } = {}) {
  const lockPath = join(profileDir, PROFILE_LOCK_NAME)
  const record = `${process.pid}\n`
  const deadline = now() + waitMs
  let delay = RETRY_INITIAL_MS
  let retriedUnconfirmedPermissionError = false
  for (;;) {
    try {
      writeFileSync(lockPath, record, { mode: 0o600, flag: 'wx' })
      break
    } catch (error) {
      if (!isLockContention(error, lockPath)) {
        // Windows can release a competing lock between exclusive create and lstat.
        if (process.platform !== 'win32' || error?.code !== 'EPERM' || retriedUnconfirmedPermissionError) throw error
        retriedUnconfirmedPermissionError = true
      } else if (takeOverExitedHolder(lockPath)) {
        continue
      }
    }
    if (now() >= deadline) {
      const current = readLockRecord(lockPath)
      const holder = current && /^(\d+)\n$/.exec(current)
      throw new ProfileLockTimeoutError(lockPath, holder ? Number(holder[1]) : undefined)
    }
    sleep(delay)
    delay = Math.min(delay * 2, RETRY_MAX_MS)
  }
  try {
    return operation()
  } finally {
    const current = readLockRecord(lockPath)
    if (current !== undefined && current !== record) {
      console.error(`dsh-opentui(inproc): WARN ${lockPath} was replaced while held; removing it anyway (host compatibility)`)
    }
    rmSync(lockPath, { force: true })
  }
}

export default {
  PROFILE_LOCK_WAIT_MS,
  PROFILE_LOCK_NAME,
  WAIT_ENV,
  waitMsFromEnv,
  pidAlive,
  holderExited,
  readLockRecord,
  takeOverExitedHolder,
  withProfileWriteLock,
  ProfileLockTimeoutError,
  sleepSync,
}
