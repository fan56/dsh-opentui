/**
 * Whole-run mutex for the inproc provisioner (design 06 R14, P0-1).
 *
 * `.provision.lock` is held for the ENTIRE provision pass, including step 4's
 * companion install. Its record is JSON (our own protocol, not the host's):
 *   { pid, nonce, startedAt, heartbeatAt, step }
 *
 * Liveness is PID-ONLY: process.kill(pid, 0). A live holder is never aged out —
 * there is no `LOCK_STALE_MS` and no mtime-based takeover of a live record,
 * however old. Dead holders are reclaimed through a sha256-named claim file so
 * two contenders cannot both take over. Corrupt/empty records get a 1s grace
 * (the create→write window) before they can be reclaimed. A reused pid is
 * indistinguishable from a live holder: we never take it over; we wait, then
 * fail with exit code 2 and an explicit manual-recovery hint.
 *
 * Lock ORDER: `.provision.lock` first, then package.json.lock (profile-lock.mjs).
 * Never the reverse — the host only takes the latter.
 */

import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync, rmSync, openSync, closeSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { pidAlive, sleepSync } from './profile-lock.mjs'

export const LOCK_NAME = '.provision.lock'
export const LOCK_CORRUPT_GRACE_MS = 1_000
export const PROVISION_LOCK_WAIT_MS = 30_000
export const WAIT_ENV = 'DSH_OPENTUI_PROVISION_LOCK_WAIT_MS'
const RETRY_INITIAL_MS = 50
const RETRY_MAX_MS = 500

export function waitMsFromEnv(env = process.env) {
  const raw = env[WAIT_ENV]
  if (raw === undefined || raw === '') return PROVISION_LOCK_WAIT_MS
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : PROVISION_LOCK_WAIT_MS
}

/** Pure classification used by the lock tests (#37/#38). `record` is the parsed
 *  lock record plus `mtimeMs`; a corrupt record has `corrupt:true`. Age is used
 *  ONLY for corrupt records, never for a record with a live pid. */
export function classifyLock(record, now = Date.now(), alive = pidAlive) {
  if (record === undefined) return { state: 'absent', takeover: true, reason: 'lock file is absent or unreadable' }
  if (record.corrupt || !Number.isInteger(record.pid)) {
    const age = Math.max(0, now - (record.mtimeMs ?? now))
    if (age > LOCK_CORRUPT_GRACE_MS) {
      return { state: 'corrupt-stale', takeover: true, reason: `corrupt lock record, age ${age}ms > ${LOCK_CORRUPT_GRACE_MS}ms` }
    }
    return { state: 'corrupt-grace', takeover: false, reason: `corrupt lock record within the ${LOCK_CORRUPT_GRACE_MS}ms create/write grace` }
  }
  if (record.pid === process.pid) return { state: 'live', takeover: false, reason: `held by self (pid ${record.pid})` }
  if (!alive(record.pid)) return { state: 'dead', takeover: true, reason: `holder pid ${record.pid} no longer exists` }
  // A live holder is live forever from our point of view. `startedAt` is
  // diagnostic context only; it must never influence takeover.
  const age = Number.isFinite(record.startedAt) ? now - record.startedAt : undefined
  return {
    state: 'live',
    takeover: false,
    reason: `holder pid ${record.pid} alive (step ${record.step ?? 'unknown'}${age === undefined ? '' : `, age ${age}ms — age is NOT a stale signal`})`,
  }
}

/** True when the record's pid is provably gone (or the record is absent/corrupt past grace). */
export function provisionHolderExited(record) {
  return classifyLock(record).takeover
}

function readRawLock(lockPath) {
  try {
    return { raw: readFileSync(lockPath, 'utf8'), mtimeMs: statSync(lockPath).mtimeMs }
  } catch {
    return undefined
  }
}

function parseRecord(entry) {
  if (!entry) return undefined
  try {
    const parsed = JSON.parse(entry.raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return { ...parsed, mtimeMs: entry.mtimeMs }
  } catch {
    return { corrupt: true, mtimeMs: entry.mtimeMs }
  }
}

function claimPathFor(lockPath, raw) {
  return `${lockPath}.takeover-${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`
}

/** Take over a dead/corrupt holder under a claim, re-reading and re-probing. */
function takeOverLock(lockPath) {
  const entry = readRawLock(lockPath)
  if (!entry || !classifyLock(parseRecord(entry)).takeover) return false
  const claim = claimPathFor(lockPath, entry.raw)
  try {
    writeFileSync(claim, `${process.pid}\n`, { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'EPERM') return false
    throw error
  }
  try {
    const again = readRawLock(lockPath)
    if (!again || again.raw !== entry.raw || !classifyLock(parseRecord(again)).takeover) return false
    rmSync(lockPath, { force: true })
    return true
  } finally {
    rmSync(claim, { force: true })
  }
}

export class ProvisionLockError extends Error {
  constructor(message, detail) {
    super(message)
    this.name = 'ProvisionLockError'
    this.detail = detail
    this.exitCode = 2
  }
}

function makeToken(step) {
  return {
    pid: process.pid,
    nonce: createHash('sha256').update(`${process.pid}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16),
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    step,
  }
}

function readOwnLock(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Acquire the whole-run lock. Returns `{ pid, nonce, lockPath }`; throws
 * ProvisionLockError (exitCode 2) on timeout. Never returns a SKIP token.
 */
export function acquireProvisionRunLock(profileDir, { waitMs = waitMsFromEnv(), onWait = () => {}, sleep = sleepSync, now = Date.now } = {}) {
  const lockPath = join(profileDir, LOCK_NAME)
  const deadline = now() + waitMs
  let delay = RETRY_INITIAL_MS
  let lastStatusLine = 0
  for (;;) {
    const token = makeToken('1/7 host')
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
      // Re-read before doing any work: a contender that took over while we were
      // descheduled must not leave two processes believing they hold the lock.
      const held = readOwnLock(lockPath)
      if (held?.pid === token.pid && held.nonce === token.nonce) return { ...token, lockPath }
      sleep(delay)
      continue
    }

    const entry = readRawLock(lockPath)
    const verdict = classifyLock(parseRecord(entry), now())
    if (verdict.takeover) {
      onWait(`stale provisioning lock (${verdict.reason}); taking over via claim`)
      if (takeOverLock(lockPath)) continue
    }
    if (now() - lastStatusLine >= 5_000) {
      onWait(`waiting for provisioning lock (${verdict.reason})`)
      lastStatusLine = now()
    }
    if (now() >= deadline) {
      const current = parseRecord(readRawLock(lockPath))
      const who = current && !current.corrupt && Number.isInteger(current.pid)
        ? `holder pid ${current.pid}, step ${current.step ?? 'unknown'}, age ${Math.max(0, now() - (current.startedAt ?? now()))}ms`
        : 'an unreadable record'
      throw new ProvisionLockError(
        `could not acquire ${lockPath} within ${waitMs}ms (${who})`,
        [
          `The recorded holder is still considered alive — its age is deliberately NOT a stale signal, and a reused pid is never taken over.`,
          `Confirm no provisioning is running, then remove ${lockPath} manually to recover.`,
          `Lock path: ${lockPath}`,
        ].join('\n'),
      )
    }
    sleep(delay)
    delay = Math.min(delay * 2, RETRY_MAX_MS)
  }
}

/** Release only a lock that is still ours (pid + nonce). */
export function releaseProvisionRunLock(token, onWarn = () => {}) {
  if (!token) return
  try {
    const held = readOwnLock(token.lockPath)
    if (held?.pid === token.pid && held.nonce === token.nonce) rmSync(token.lockPath, { force: true })
    else onWarn(`provisioning lock was replaced while held; leaving ${token.lockPath} untouched`)
  } catch {
    // Best-effort cleanup: never mask the primary provisioning result.
  }
}

export default {
  LOCK_NAME,
  LOCK_CORRUPT_GRACE_MS,
  PROVISION_LOCK_WAIT_MS,
  WAIT_ENV,
  waitMsFromEnv,
  classifyLock,
  provisionHolderExited,
  acquireProvisionRunLock,
  releaseProvisionRunLock,
  ProvisionLockError,
}
