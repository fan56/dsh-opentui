/**
 * retention P2 — trash-apply core for session prune.
 *
 * This module owns the ONLY write surface introduced by retention P2. It is
 * deliberately split out from the read-only planner (`session-prune.ts`) and
 * the read-only flock probe (`prune-lock-probe.ts`) so the planner keeps its
 * "no write primitive" invariant. Every fs operation is injected through
 * `ApplyFsLike`; nothing here imports a host implementation.
 *
 * Hard rules (oldfox P2 ruling, pre-registered in
 * `.proof/retention-prune-p2/00-preregistered-expected.md`):
 *  - the plan is ALWAYS recomputed by the caller (index.ts) from host state.
 *    Client-supplied entries are never an input to a safety decision here.
 *  - destination is `<dshHome>/trash/sessions/<UTC>/<encodeSegment(id)>`,
 *    created 0700, never overwritten. A cross-device rename is rejected
 *    (EXDEV) with no copy fallback and no unlink/rm of any trash path.
 *  - before rename: lstat + realpath containment + fresh header.id +
 *    encodeSegment basename + source/destination st_dev equality + a fresh
 *    read-only lock probe on the SOURCE `session.lock`.
 *  - immediately after rename the lock is re-probed at the TRASH path;
 *    held/unknown triggers an immediate reverse rename (rollback) that
 *    refuses to overwrite the source and re-validates the header.
 *  - a structured pre/post journal is written around every rename; a crash
 *    orphan is only marked `.orphan.json`, never auto-deleted (no purge in P2).
 *  - the serialisation lock is a HOST-SIDE apply lock owned by index.ts and
 *    passed in as `withApplyLock`; this module never touches `session.lock`
 *    for writing.
 */

import { createHash } from 'node:crypto'
import { basename, dirname, join, sep } from 'node:path'
import { encodeSegment, type PrunePlan, type PrunePlanEntry } from './session-prune'
import type { LockProbe } from './session-prune'
import type { SessionPruneSnapshot } from './session-prune'

/** Structured fs error code used across the apply core. */
export type ApplyErrorCode =
  | 'STALE_PLAN'
  | 'BAD_PARAMS'
  | 'BAD_PATH'
  | 'EXDEV'
  | 'CONFLICT'
  | 'LOCKED'
  | 'ROLLED_BACK'
  | 'ROLLBACK_FAILED'
  /** A write AFTER a successful rename failed; the rename was reversed and
   *  the ORIGINAL write error is carried in the message. */
  | 'JOURNAL_FAILED'
  | 'NO_RECOVERY'

export class ApplyError extends Error {
  readonly code: ApplyErrorCode
  readonly detail?: unknown
  constructor(code: ApplyErrorCode, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApplyError'
    this.code = code
    this.detail = detail
  }
}

function fail(code: ApplyErrorCode, message: string, detail?: unknown): never {
  throw new ApplyError(code, message, detail)
}

function errorCode(err: unknown): string | undefined {
  if (err === null || typeof err !== 'object') return undefined
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function isEnoent(err: unknown): boolean {
  return errorCode(err) === 'ENOENT'
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// Fingerprints.
// ---------------------------------------------------------------------------

/** Host-owned policy inputs. `sessionsRoot` is included so a root change
 *  invalidates a previously issued plan even when the numbers are identical. */
export interface PrunePolicyLike {
  readonly retentionDays: number
  readonly blankGraceDays: number
  readonly lockGraceMs: number
  readonly freshMtimeGraceMs: number
  readonly sessionsRoot: string
}

export function computeConfigFingerprint(policy: PrunePolicyLike): string {
  return sha256(JSON.stringify([
    policy.retentionDays,
    policy.blankGraceDays,
    policy.lockGraceMs,
    policy.freshMtimeGraceMs,
    policy.sessionsRoot,
  ]))
}

/**
 * Fingerprint of the DECISIONS, not of `generatedAt` or `ageDays` (both are
 * derived from "now" and would drift on a harmless recompute). The client
 * carries this opaque string back to apply; it is never asked to supply the
 * entries themselves.
 */
export function computePlanFingerprint(plan: PrunePlan): string {
  const canonical = JSON.stringify({
    retentionDays: plan.retentionDays,
    entries: plan.entries.map((e: PrunePlanEntry) => [
      e.sessionId,
      e.decision,
      e.reason ?? '',
      e.location ?? '',
    ]),
    counts: plan.counts,
  })
  return sha256(canonical)
}

/** UTC run directory name (no colons / no filesystem-hostile characters). */
export function utcStamp(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, '-')
}

export function trashRoot(dshHome: string): string {
  return join(dshHome, 'trash')
}

export function trashSessionsRoot(dshHome: string): string {
  return join(trashRoot(dshHome), 'sessions')
}

export function trashJournalRoot(dshHome: string): string {
  return join(trashRoot(dshHome), 'journal')
}

// ---------------------------------------------------------------------------
// Injectable seams.
// ---------------------------------------------------------------------------

export interface ApplyStatLike {
  readonly dev?: number | bigint
  readonly ino?: number | bigint
  readonly mtimeMs?: unknown
  isDirectory(): boolean
  isSymbolicLink?(): boolean
}

export interface ApplyFsLike {
  lstat(path: string): Promise<ApplyStatLike>
  stat(path: string): Promise<ApplyStatLike>
  realpath(path: string): Promise<string>
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<unknown>
  rename(from: string, to: string): Promise<void>
  writeFile(path: string, data: string, options: { flag: 'wx'; mode?: number }): Promise<void>
  appendFile(path: string, data: string): Promise<void>
  readdir(path: string): Promise<string[]>
  readFile(path: string): Promise<string>
}

export interface ApplyPersistenceLike {
  stat(id: string): Promise<SessionPruneSnapshot | undefined>
}

export interface ApplyDeps {
  readonly persistence: ApplyPersistenceLike
  /** Read-only flock probe; the same one the planner used. */
  readonly lockProbe?: LockProbe
  readonly now: number
  /** Operation id, supplied by the caller so a journal is reproducible. */
  readonly opId: string
  /** Host-side application lock; acquired ONCE around the whole apply. */
  readonly withApplyLock: <T>(fn: () => Promise<T>) => Promise<T>
}

export interface ApplyRunConfig {
  readonly dshHome: string
  readonly sessionsRoot: string
  /** Fingerprint of the freshly recomputed plan (for the journal only). */
  readonly planFingerprint: string
}

export interface AppliedEntry {
  readonly id: string
  readonly from: string
  readonly to: string
}

export interface ApplyFailureEntry {
  readonly id: string
  readonly code: ApplyErrorCode | 'INTERNAL'
  readonly message: string
}

export interface ApplyResult {
  readonly opId: string
  readonly runDir: string
  readonly applied: readonly AppliedEntry[]
  readonly failed: readonly ApplyFailureEntry[]
  readonly markedOrphans: readonly string[]
}

function isInside(root: string, target: string): boolean {
  const base = root.length > 1 && root.endsWith(sep) ? root.slice(0, -1) : root
  return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep)
}

function sameDev(a: unknown, b: unknown): boolean {
  return a !== undefined && b !== undefined && String(a) === String(b)
}

async function pathExists(fs: ApplyFsLike, path: string): Promise<boolean> {
  try {
    await fs.lstat(path)
    return true
  } catch (err) {
    if (isEnoent(err)) return false
    throw err
  }
}

async function probeLock(probe: LockProbe | undefined, lockPath: string): Promise<void> {
  if (probe === undefined) return
  let result
  try {
    result = await probe(lockPath)
  } catch {
    fail('LOCKED', 'lock probe threw; refusing to move a session', { lockPath })
  }
  if (result.status === 'lock-held' || result.status === 'unknown') {
    fail('LOCKED', 'session.lock probe is not unlocked', { lockPath, status: result.status, detail: result.detail })
  }
}

/**
 * Read and validate the HOST-WRITTEN pre-rename journal (`<journalBase>.pre.json`).
 * It is created with `wx`/0600 at the last safe point BEFORE the forward rename,
 * AFTER the live header/location/path gates have passed. A rollback must prove
 * identity against this frozen artifact (or the trash `.applied.json` manifest),
 * NOT against a live `persistence.stat` whose record can be invalidated by the
 * rename itself or by a concurrent writer. No path is ever trusted from the
 * journal: source/trash are re-derived by the caller and compared by value.
 */
async function validateRollbackManifest(
  fs: ApplyFsLike,
  journalBase: string,
  id: string,
  sourceDir: string,
  trashPath: string,
): Promise<void> {
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(`${journalBase}.pre.json`))
  } catch {
    fail('BAD_PATH', 'rollback refused: no valid pre-rename journal', { id })
  }
  if (raw === null || typeof raw !== 'object') fail('BAD_PATH', 'rollback refused: pre-rename journal is not an object', { id })
  const proof = raw as Record<string, unknown>
  if (proof.id !== id || proof.sourceDir !== sourceDir || proof.trashPath !== trashPath) {
    fail('BAD_PATH', 'rollback refused: pre-rename journal identity mismatch', { id })
  }
}

/**
 * Reverse rename used by rollback. Refuses to overwrite an existing source,
 * re-validates identity, and rejects EXDEV. Callers set `skipLock` when the
 * rollback is itself triggered by a held/unknown lock at the trash path.
 *
 * When `journalBase` is supplied (every in-apply rollback does so) the identity
 * proof is the host-written pre-rename journal / trash manifest — the live
 * backend `stat` is deliberately NOT consulted. The `persistence` seam is kept
 * only for the standalone public reverse-rename surface, which has no journal.
 */
export async function restoreFromTrash(
  fs: ApplyFsLike,
  options: {
    readonly sourceDir: string
    readonly trashPath: string
    readonly id: string
    readonly persistence: ApplyPersistenceLike
    readonly journalBase?: string
    readonly lockProbe?: LockProbe
    readonly skipLock?: boolean
    /** Rollback-only: the object may have flipped to a symlink/non-directory
     *  after the forward rename. Public restore still rejects such entries;
     *  a rollback must reverse the exact object that crossed the rename so no
     *  attacker-controlled entry is left inside the trash run. */
    readonly flippedAfterRename?: boolean
  },
): Promise<void> {
  if (await pathExists(fs, options.sourceDir)) {
    fail('CONFLICT', 'restore refused: source path already exists', { id: options.id })
  }
  let st: ApplyStatLike
  try {
    st = await fs.lstat(options.trashPath)
  } catch (err) {
    fail('BAD_PATH', 'restore refused: trash entry is not readable', { id: options.id, code: errorCode(err) })
  }
  if (options.flippedAfterRename !== true && (!st.isDirectory() || st.isSymbolicLink?.() === true)) {
    fail('BAD_PATH', 'restore refused: trash entry is not a real directory', { id: options.id })
  }
  if (options.journalBase !== undefined) {
    // Forward rename already validated the header; the frozen journal is the
    // rollback authority. No live backend stat is touched here.
    await validateRollbackManifest(fs, options.journalBase, options.id, options.sourceDir, options.trashPath)
  } else {
    let snapshot: SessionPruneSnapshot | undefined
    try {
      snapshot = await options.persistence.stat(options.id)
    } catch {
      snapshot = undefined
    }
    if (snapshot?.header?.id !== options.id) {
      fail('BAD_PATH', 'restore refused: header.id mismatch', { id: options.id })
    }
  }
  if (options.skipLock !== true) await probeLock(options.lockProbe, join(options.trashPath, 'session.lock'))
  try {
    await fs.rename(options.trashPath, options.sourceDir)
  } catch (err) {
    if (errorCode(err) === 'EXDEV') fail('EXDEV', 'restore refused: cross-device rename', { id: options.id })
    throw err
  }
}

/**
 * Reverse a rename that already succeeded when a POST-rename journal write
 * (`.applied.json`, `.post.json`, `manifest.jsonl`) fails. The session is moved
 * back to its source; a rollback journal records why. A failed reverse rename
 * is reported as ROLLBACK_FAILED with the original write error preserved in
 * both the message and `detail` — never swallowed.
 */
async function rollbackAfterRename(
  fs: ApplyFsLike,
  deps: ApplyDeps,
  options: {
    readonly sourceDir: string
    readonly trashPath: string
    readonly id: string
    readonly journalBase: string
    readonly planFingerprint: string
    readonly cause: unknown
    readonly reason: string
  },
): Promise<void> {
  const causeMessage = options.cause instanceof Error ? options.cause.message : String(options.cause)
  try {
    await restoreFromTrash(fs, {
      sourceDir: options.sourceDir, trashPath: options.trashPath,
      id: options.id, persistence: deps.persistence,
      journalBase: options.journalBase,
      lockProbe: deps.lockProbe, skipLock: true,
    })
  } catch (rollbackErr) {
    const rollbackMessage = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
    fail('ROLLBACK_FAILED', `reverse rename after journal failure failed (original: ${causeMessage})`, {
      id: options.id, reason: options.reason, cause: causeMessage, rollback: rollbackMessage,
    })
  }
  try {
    await fs.writeFile(`${options.journalBase}.rollback.json`, JSON.stringify({
      opId: deps.opId, phase: 'rolled-back', id: options.id,
      sourceDir: options.sourceDir, trashPath: options.trashPath,
      planFingerprint: options.planFingerprint, reason: options.reason,
    }), { flag: 'wx', mode: 0o600 })
  } catch {
    // The reverse rename already happened; a journal write must not undo it.
  }
}

/** Mark crash orphans only. No unlink/rm exists anywhere in this module. */
export async function recoverTrashOrphans(fs: ApplyFsLike, dshHome: string): Promise<string[]> {
  const runsRoot = trashSessionsRoot(dshHome)
  let runs: string[]
  try {
    runs = await fs.readdir(runsRoot)
  } catch (err) {
    if (isEnoent(err)) return []
    throw err
  }
  const marked: string[] = []
  for (const run of runs) {
    let entries: string[]
    try {
      entries = await fs.readdir(join(runsRoot, run))
    } catch (err) {
      if (isEnoent(err)) continue
      throw err
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const entryDir = join(runsRoot, run, entry)
      try {
        const st = await fs.lstat(entryDir)
        if (!st.isDirectory() || st.isSymbolicLink?.() === true) continue
      } catch {
        continue
      }
      if (await pathExists(fs, join(entryDir, '.applied.json'))) continue
      const marker = join(entryDir, '.orphan.json')
      try {
        await fs.writeFile(marker, JSON.stringify({ markedAt: Date.now(), reason: 'no-applied-manifest', path: entryDir }), { flag: 'wx', mode: 0o600 })
        marked.push(entryDir)
      } catch (err) {
        if (errorCode(err) !== 'EEXIST') throw err
      }
    }
  }
  return marked
}

/**
 * Apply a SERVER-RECOMPUTED plan. `plan.entries` is used only to select the
 * session ids; every path is re-derived from a fresh `persistence.stat` and
 * re-gated before the rename. No client input reaches this function.
 */
export async function applyTrashPlan(
  fs: ApplyFsLike,
  deps: ApplyDeps,
  plan: PrunePlan,
  config: ApplyRunConfig,
): Promise<ApplyResult> {
  return deps.withApplyLock(async () => {
    const trashBase = trashRoot(config.dshHome)
    const sessionsTrash = trashSessionsRoot(config.dshHome)
    const journalDir = trashJournalRoot(config.dshHome)
    await fs.mkdir(trashBase, { recursive: true, mode: 0o700 })
    await fs.mkdir(sessionsTrash, { recursive: true, mode: 0o700 })
    await fs.mkdir(journalDir, { recursive: true, mode: 0o700 })
    const runDir = join(sessionsTrash, utcStamp(deps.now))
    // Non-recursive leaf create: EEXIST means a run dir is already in use,
    // never overwrite it.
    await fs.mkdir(runDir, { mode: 0o700 })

    const applied: AppliedEntry[] = []
    const failed: ApplyFailureEntry[] = []
    let roots: { rootReal: string; trashStat: ApplyStatLike }
    try {
      const rootReal = await fs.realpath(config.sessionsRoot)
      const rootStat = await fs.stat(config.sessionsRoot)
      const trashStat = await fs.stat(runDir)
      if (!sameDev(rootStat.dev, trashStat.dev)) {
        fail('EXDEV', 'sessions root and trash are on different devices', { sessionsRoot: config.sessionsRoot, runDir })
      }
      roots = { rootReal, trashStat }
    } catch (err) {
      // A broken root is a per-run failure, not a thrown rejection: the wire
      // caller always receives an ApplyResult with structured `failed` rows.
      const code = err instanceof ApplyError ? err.code : 'INTERNAL'
      const message = err instanceof Error ? err.message : String(err)
      const ids = plan.entries.filter((entry) => entry.decision === 'prune').map((entry) => entry.sessionId)
      for (const id of ids.length > 0 ? ids : ['<root>']) failed.push({ id, code, message })
      return { opId: deps.opId, runDir, applied, failed, markedOrphans: [] }
    }
    const { rootReal, trashStat } = roots

    const markedOrphans = await recoverTrashOrphans(fs, config.dshHome)

    for (const entry of plan.entries) {
      if (entry.decision !== 'prune') continue
      const id = entry.sessionId
      const encoded = encodeSegment(id)
      const journalBase = join(journalDir, `${deps.opId}-${encoded}`)
      try {
        // ---- fresh host-backed location + pre-rename gates (TOCTOU) ----
        const snapshot = await deps.persistence.stat(id)
        if (snapshot?.header?.id !== id) fail('BAD_PATH', 'header.id mismatch', { id })
        const location = snapshot.location
        const locationPath = typeof location === 'string'
          ? location
          : location !== null && typeof location === 'object' && typeof location.path === 'string'
            ? location.path
            : undefined
        if (locationPath === undefined || locationPath === '') fail('BAD_PATH', 'no host location', { id })
        const sourceDir = dirname(locationPath)
        if (basename(sourceDir) !== encoded) fail('BAD_PATH', 'basename/encodeSegment mismatch', { id, sourceDir })
        const st = await fs.lstat(sourceDir)
        if (!st.isDirectory() || st.isSymbolicLink?.() === true) fail('BAD_PATH', 'not a real directory', { id, sourceDir })
        const real = await fs.realpath(sourceDir)
        if (!isInside(rootReal, real)) fail('BAD_PATH', 'source escaped sessions root', { id, sourceDir, real })
        const sourceStat = await fs.stat(sourceDir)
        if (!sameDev(sourceStat.dev, trashStat.dev)) fail('EXDEV', 'cross-device rename refused', { id, sourceDir, runDir })
        await probeLock(deps.lockProbe, join(sourceDir, 'session.lock'))

        const trashPath = join(runDir, encoded)
        if (await pathExists(fs, trashPath)) fail('CONFLICT', 'trash destination exists; refusing to overwrite', { id, trashPath })

        // ---- second gate at the last safe point before the rename ----
        // The first lstat/realpath/dev check can be stale: a source swapped for
        // a symlink or a non-directory in the window must be rejected here so
        // that no rename ever moves an attacker-controlled object into trash.
        const recheckSt = await fs.lstat(sourceDir)
        if (!recheckSt.isDirectory() || recheckSt.isSymbolicLink?.() === true) {
          fail('BAD_PATH', 'source flipped to symlink/non-directory before rename', { id, sourceDir })
        }
        const recheckReal = await fs.realpath(sourceDir)
        if (!isInside(rootReal, recheckReal)) {
          fail('BAD_PATH', 'source escaped sessions root before rename', { id, sourceDir, real: recheckReal })
        }
        const recheckStat = await fs.stat(sourceDir)
        if (!sameDev(recheckStat.dev, trashStat.dev)) {
          fail('EXDEV', 'cross-device rename refused at second check', { id, sourceDir, runDir })
        }
        const recheckSnapshot = await deps.persistence.stat(id)
        if (recheckSnapshot?.header?.id !== id) fail('BAD_PATH', 'header.id mismatch before rename', { id })

        // ---- journal BEFORE the rename ----
        await fs.writeFile(`${journalBase}.pre.json`, JSON.stringify({
          opId: deps.opId, phase: 'pre-rename', id, sourceDir, trashPath,
          planFingerprint: config.planFingerprint, generatedAt: deps.now,
        }), { flag: 'wx', mode: 0o600 })

        // ---- the single mutation ----
        try {
          await fs.rename(sourceDir, trashPath)
        } catch (err) {
          if (errorCode(err) === 'EXDEV') fail('EXDEV', 'rename returned EXDEV; no copy fallback', { id, sourceDir, trashPath })
          throw err
        }

        // ---- immediate shape re-check at the trash path (TOCTOU) ----
        // If the entry became a symlink/non-directory around the rename, do
        // NOT journal it as applied: reverse the exact object that moved.
        let movedSt: ApplyStatLike
        try {
          movedSt = await fs.lstat(trashPath)
        } catch (err) {
          fail('BAD_PATH', 'moved entry is not readable at trash path', { id, trashPath, code: errorCode(err) })
        }
        if (!movedSt.isDirectory() || movedSt.isSymbolicLink?.() === true) {
          await restoreFromTrash(fs, {
            sourceDir, trashPath, id, persistence: deps.persistence,
            journalBase, lockProbe: deps.lockProbe, skipLock: true, flippedAfterRename: true,
          })
          await fs.writeFile(`${journalBase}.rollback.json`, JSON.stringify({
            opId: deps.opId, phase: 'rolled-back', id, sourceDir, trashPath,
            planFingerprint: config.planFingerprint, reason: 'flipped-to-symlink-or-non-directory',
          }), { flag: 'wx', mode: 0o600 })
          fail('BAD_PATH', 'moved entry flipped to symlink/non-directory; reversed rename', { id, trashPath })
        }

        // ---- immediate re-probe at the trash path ----
        let heldAtTrash = false
        try {
          await probeLock(deps.lockProbe, join(trashPath, 'session.lock'))
        } catch (err) {
          heldAtTrash = true
          if (!(err instanceof ApplyError) || err.code !== 'LOCKED') throw err
        }
        if (heldAtTrash) {
          await restoreFromTrash(fs, {
            sourceDir, trashPath, id, persistence: deps.persistence,
            journalBase, lockProbe: deps.lockProbe, skipLock: true,
          })
          await fs.writeFile(`${journalBase}.rollback.json`, JSON.stringify({
            opId: deps.opId, phase: 'rolled-back', id, sourceDir, trashPath,
            planFingerprint: config.planFingerprint,
          }), { flag: 'wx', mode: 0o600 })
          fail('ROLLED_BACK', 'lock held/unknown at trash path; reversed rename', { id, trashPath })
        }

        // ---- journal + per-entry manifest AFTER a successful rename ----
        // Every write here happens after the single mutation. If ANY of them
        // fails the rename MUST be reversed: a trashed session without a valid
        // applied marker is an orphan, not a successfully applied prune. The
        // ORIGINAL write error is reported as JOURNAL_FAILED; a failed reverse
        // rename is reported separately as ROLLBACK_FAILED (with the original
        // error preserved). Siblings still proceed.
        const appliedRecord = {
          opId: deps.opId, phase: 'applied', id, from: sourceDir, to: trashPath,
          planFingerprint: config.planFingerprint, appliedAt: deps.now,
        }
        try {
          // `.applied.json` is the committed-applied marker that lives INSIDE
          // the trash entry. It MUST be written last: if `.post.json` or the
          // manifest append fails, rollback reverse-renames the whole directory
          // back to source and a marker written earlier would travel with it,
          // leaving a stale `.applied.json` in the live session dir. That stale
          // marker makes every later apply of the same session fail again with
          // EEXIST -> JOURNAL_FAILED. Write the two external journals first so
          // a rolled-back entry is always marker-free at its source.
          await fs.writeFile(`${journalBase}.post.json`, JSON.stringify(appliedRecord), { flag: 'wx', mode: 0o600 })
          await fs.appendFile(join(runDir, 'manifest.jsonl'), JSON.stringify(appliedRecord) + '\n')
          await fs.writeFile(join(trashPath, '.applied.json'), JSON.stringify(appliedRecord), { flag: 'wx', mode: 0o600 })
        } catch (journalErr) {
          await rollbackAfterRename(fs, deps, {
            sourceDir, trashPath, id, journalBase,
            planFingerprint: config.planFingerprint,
            cause: journalErr, reason: 'post-rename-journal-write-failed',
          })
          fail('JOURNAL_FAILED', journalErr instanceof Error ? journalErr.message : String(journalErr), {
            id, cause: journalErr instanceof Error ? journalErr.message : String(journalErr),
          })
        }
        applied.push({ id, from: sourceDir, to: trashPath })
      } catch (err) {
        const code = err instanceof ApplyError ? err.code : 'INTERNAL'
        const message = err instanceof Error ? err.message : String(err)
        failed.push({ id, code, message })
      }
    }

    return { opId: deps.opId, runDir, applied, failed, markedOrphans }
  })
}
