/**
 * retention P1 — read-only session prune PLANNER (dry-run only).
 *
 * This module is a pure planner: it turns a `session.list` snapshot plus
 * backend-resolved `sessionPersistence.stat()` locations into a decision
 * table. It NEVER deletes. It has NO `node:fs` import at all — every fs
 * primitive is injected (`PruneFsLike`) so a test can replace the whole chain
 * and so no write surface (`rename`/`unlink`/`rm*`/`write*`) exists here.
 *
 * Safety invariants (oldfox P1 ruling; B1 contract correction applied):
 *  - candidate paths come ONLY from `stat(id).location.path` (the host's
 *    `SessionLocation` is `{kind,path}`, NOT a bare string). Never build a
 *    session directory path from the session id.
 *  - B1 FIX: `location.path` is the BACKEND ARTIFACT LOG FILE (e.g.
 *    `session.v4.jsonl.zstd`), NOT a session directory. The session directory
 *    is `dirname(location.path)`; every fs gate below operates on that
 *    directory, never on the artifact file itself.
 *  - four path gates: `lstat(dir)` says real directory (symlinks rejected),
 *    `realpath(dir)` stays inside the canonical sessions root, `header.id`
 *    equals the candidate id, `basename(dir)` equals `encodeSegment(id)`.
 *    UUID ids are identity; illegal characters are encoded as `~XXXX` by the
 *    host encoder (dsh-session-persistence-jsonl/src/format.ts:199).
 *  - OLD CRITERION (B1 BLOCKER — SUPERSEDED, recorded verbatim for
 *    transparency): "`basename(location.path)` equals the id", with
 *    `location.path` treated as the session directory. Against the real host
 *    the basename is `session.v4.jsonl.zstd`, so every genuine session was
 *    skipped as `basename-mismatch` and no prune could ever be produced. The
 *    criterion is corrected here, not silently reinterpreted.
 *  - `session.lock` and the backend artifact file are only ever `stat`-ed for
 *    a RECENT-WRITE HEURISTIC — never a liveness proof, never opened for
 *    writing, renamed, moved or removed. The authoritative "still attached"
 *    signal is the `session.list` row's `agentAvailable` field, backed by the
 *    read-only flock probe on `session.lock`.
 *  - P2 GATE: `agentAvailable === true` skips immediately; a missing or
 *    non-boolean field is a field-anomaly skip (never "no agent => deletable").
 *    Capability version strategy: `agentAvailable` is a REQUIRED boolean on
 *    the `SessionSummary` wire (host 0.2.2-rc.5
 *    `dsh-api-session-controller/lib/types/types.d.ts:140`: "Whether this
 *    Session currently owns a live Agent"). An older host that does not emit
 *    it yields a field-anomaly skip on EVERY row; this planner never lowers
 *    that floor by defaulting an absent field to false. A future host version
 *    may RAISE the floor (add gates), never silently relax this one.
 *  - excluded: current / staged / agent-available / running / missing-time /
 *    future-time / lock-fresh / lock-held / fresh-mtime / subtree-running /
 *    field anomalies; retentionDays=0 skips everything; blank needs an extra
 *    grace window; unknown (stat or lock probe failure) skips. Default
 *    retention is 90 days, but this slice only PLANS.
 *
 *  OLD CRITERIA (oldfox P1 CONCERN — superseded, recorded verbatim for
 *  transparency, NOT silently reinterpreted):
 *   - "a missing `running`/`blank` field means not-running/not-blank, so the
 *     row is a prune candidate" — WRONG: a missing field is a field anomaly
 *     and must skip. Only an explicit `running === false` (with a boolean
 *     `blank`) can become a candidate.
 *   - "half a roster can still be planned: `listAllSessions.truncated` is
 *     advisory" — WRONG: an incomplete roster must abort the whole plan,
 *     never produce a partial decision table.
 *   - "the only mtime gate is `session.lock`" — SUPERSEDED by the additional
 *     `fresh-mtime` gate on the backend artifact file (opt-in via
 *     `freshMtimeGraceMs`): a recently written artifact is a conservative
 *     heuristic signal, NOT a liveness proof, and blocks pruning even when
 *     the lock is missing or stale.
 *   - "an absent `agentAvailable` means no agent is attached, so the row is
 *     a candidate" — WRONG / SUPERSEDED: absence (or a non-boolean value) is
 *     a field anomaly and must skip. Defaulting it to false would make every
 *     row deletable on a host version that never emitted the field.
 *   - "a fresh `session.lock` / artifact mtime proves the session is live"
 *     — SUPERSEDED wording: mtime only reports a recent write; it can never
 *     prove liveness. The P2 read-only flock probe (no writer lease, no
 *     `open('w')`, no `mkdir`) plus `agentAvailable` are the gates.
 *   - "staged exclusion: an arbitrary client-supplied `stagedIds` array" —
 *     the staged id now comes from the client's REAL `stagedSessionId()` seam
 *     face; the sessions root is host-derived, never a client wire param.
 *     The P2 FRONT GATE is implemented here (`agentAvailable` + read-only
 *     flock probe); identifying OTHER open-but-idle sessions beyond those two
 *     signals remains future work and is NOT claimed solved.
 */

import { basename, dirname, join, sep } from 'node:path'

/** Default retention window in days. Real deletion is a later slice; this
 *  slice only hands a plan to the caller. */
export const DEFAULT_RETENTION_DAYS = 90

const MS_PER_DAY = 86_400_000

/**
 * Host-identical single path-segment encoder — ported from
 * `dsh-session-persistence-jsonl/src/format.ts:199` (`encodeSegment`), whose
 * body is identical across the installed host versions checked. Mirrored
 * locally rather than imported: this module keeps the no-runtime-host-import,
 * structural-typing discipline. Safe `[A-Za-z0-9._-]` code units pass through
 * (except `~`); every other UTF-16 code unit becomes `~XXXX` (uppercase hex);
 * `.`/`..` are special-cased so a whole segment can never traverse.
 */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  return out
}

// --------------------------------------------------------------------------
// Structural host slices (no @deepseek-ai runtime import — structural typing
// discipline inherited from index.ts).
// --------------------------------------------------------------------------

/** `SessionLocation` (`dsh-session-persistence/lib/types/errors.d.ts:64-69`). */
export interface SessionLocationLike {
  readonly kind: string
  readonly path: string
}

/** `SessionPersistenceSnapshot` slice (`.../lib/types/index.d.ts:23-40`). */
export interface SessionPruneSnapshot {
  readonly header: { readonly id: unknown; readonly createdAt?: unknown }
  readonly location?: SessionLocationLike | string | null
}

/** Optional `stat` capability of `ctx.sessionPersistence`. */
export interface PrunePersistenceLike {
  stat(id: string): Promise<SessionPruneSnapshot | undefined>
}

/** Feature probe: a host without `stat` is unavailable, never an empty plan. */
export function hasStatCapability(value: unknown): value is PrunePersistenceLike {
  return value !== null && typeof value === 'object' && typeof (value as { stat?: unknown }).stat === 'function'
}

/** Outcome of the read-only flock probe on `session.lock`.
 *  - `unlocked`: a nonblocking exclusive flock succeeded; no other writer holds it.
 *  - `lock-held`: the kernel reported EAGAIN/EWOULDBLOCK — a writer owns the lock.
 *  - `no-lock`: ENOENT — there is no lock file to probe.
 *  - `unknown`: anything else (capability, syscall or inode/dev recheck failure).
 *  Only `unlocked` / `no-lock` let a row continue; every other status skips. */
export type LockProbeStatus = 'unlocked' | 'lock-held' | 'no-lock' | 'unknown'

export interface LockProbeResult {
  readonly status: LockProbeStatus
  readonly detail?: string
}

/** Injectable P2 gate: `(session.lock path) => probe result`. The bridge always
 *  injects one built on the host's `tryLockExclusive`; absent means the gate is
 *  disabled (fixture-only) and MUST NOT be used as a permission to delete. */
export type LockProbe = (lockPath: string) => Promise<LockProbeResult>

/** Read-only fs primitives. `stat` is used ONLY on `session.lock` and (opt-in)
 *  the backend artifact; `lockProbe` is optional and never opens for writing. */
export interface PruneFsLike {
  lstat(path: string): Promise<{ isDirectory(): boolean; isSymbolicLink?(): boolean }>
  realpath(path: string): Promise<string>
  stat(path: string): Promise<{ mtimeMs?: unknown }>
  readonly lockProbe?: LockProbe
}

/** One projected `session.list` row (the fields retention cares about). */
export interface PruneRow {
  readonly sessionId: unknown
  readonly updatedAt?: unknown
  /** Required boolean on modern hosts; missing/non-boolean is a field anomaly. */
  readonly agentAvailable?: unknown
  readonly running?: unknown
  readonly blank?: unknown
  readonly parentSessionId?: unknown
}

/** `session.list` reply slice. `nextCursor`/`hasMore` are optional: the current
 *  host emits neither, so the drain degrades to one page without fabrication. */
export interface SessionListPageLike {
  readonly items?: unknown
  readonly nextCursor?: unknown
  readonly hasMore?: unknown
}

export interface SessionListerLike {
  list(request: { _request: { cursor?: string } }): Promise<SessionListPageLike>
}

// --------------------------------------------------------------------------
// Full `session.list` drain (defensive cursor pagination).
// --------------------------------------------------------------------------

export interface ListAllResult {
  readonly rows: readonly PruneRow[]
  readonly pages: number
  /** true when the page cap or a repeated cursor stopped an otherwise-open walk. */
  readonly truncated: boolean
}

const DEFAULT_MAX_PAGES = 64

/**
 * Drain `session.list` across pages, dedup by `sessionId`.
 *
 * The installed host returns every visible row in one shot with no continuation
 * token (`SessionListValue = {items}`), so this is a single call today. The
 * helper still honours an optional `nextCursor` + `hasMore` if a later host
 * emits them, brakes on a repeated cursor, and caps at `maxPages` so a broken
 * host cannot spin forever. A malformed reply throws (never a fake empty list).
 */
export async function listAllSessions(
  lister: SessionListerLike,
  options?: { readonly maxPages?: number },
): Promise<ListAllResult> {
  const requested = options?.maxPages
  const maxPages = typeof requested === 'number' && Number.isInteger(requested) && requested > 0 && requested <= 512
    ? requested
    : DEFAULT_MAX_PAGES
  const rows: PruneRow[] = []
  const seenIds = new Set<string>()
  const usedCursors = new Set<string>()
  let cursor: string | undefined
  let pages = 0
  let truncated = false

  while (pages < maxPages) {
    usedCursors.add(cursor ?? '')
    const page = await lister.list({ _request: cursor !== undefined ? { cursor } : {} })
    if (page === null || typeof page !== 'object' || !Array.isArray(page.items)) {
      throw new Error('BAD_REPLY: session.list returned an object without an items array')
    }
    pages += 1
    for (const raw of page.items) {
      if (raw === null || typeof raw !== 'object') continue
      const row = raw as PruneRow
      if (typeof row.sessionId !== 'string' || row.sessionId === '' || seenIds.has(row.sessionId)) continue
      seenIds.add(row.sessionId)
      rows.push(row)
    }

    const hasMore = page.hasMore === true
    const next = typeof page.nextCursor === 'string' && page.nextCursor !== '' ? page.nextCursor : undefined
    if (!hasMore) break
    // OLD CRITERION (SUPERSEDED): `hasMore` with no usable cursor silently
    // ended the walk with `truncated=false`, so half a roster was planned.
    // Any open continuation we cannot follow is now explicitly truncated;
    // the RPC caller aborts the whole plan on this flag.
    if (next === undefined) {
      truncated = true
      break
    }
    if (usedCursors.has(next)) {
      truncated = true
      break
    }
    cursor = next
  }

  if (pages >= maxPages && cursor !== undefined) truncated = true
  return { rows, pages, truncated }
}

// --------------------------------------------------------------------------
// Planner config + result types.
// --------------------------------------------------------------------------

export interface PruneConfig {
  /** 0 means "retention disabled": every row is skipped. Default 90. */
  readonly retentionDays: number
  /** Epoch ms "now"; injected so planning is deterministic. */
  readonly now: number
  /** Canonical sessions root (the bridge canonicalises it before calling). */
  readonly sessionsRoot: string
  readonly currentSessionId?: string
  readonly stagedIds?: ReadonlySet<string>
  /** Extra days a blank session must survive past the normal window. */
  readonly blankGraceDays: number
  /** A `session.lock` mtime newer than `now - lockGraceMs` blocks pruning.
   *  This is a RECENT-WRITE HEURISTIC only — it never proves liveness. */
  readonly lockGraceMs: number
  /**
   * Opt-in extra gate: an artifact-file mtime newer than
   * `now - freshMtimeGraceMs` blocks pruning with reason `fresh-mtime`.
   * 0 (the default) disables the gate; the bridge sets it from host config.
   * Read-only `stat` on the backend-resolved path only — never a write.
   */
  readonly freshMtimeGraceMs?: number
}

/** Machine-readable skip reasons. Frozen for the plan wire shape. */
export type PruneReason =
  | 'retention-disabled'
  | 'field-anomaly'
  | 'current'
  | 'staged'
  | 'agent-available'
  | 'running'
  | 'missing-time'
  | 'future-time'
  | 'subtree-running'
  | 'unknown'
  | 'no-location'
  | 'header-mismatch'
  | 'basename-mismatch'
  | 'not-directory'
  | 'escaped-root'
  | 'lock-fresh'
  | 'lock-held'
  | 'fresh-mtime'
  | 'blank-grace'
  | 'within-retention'

export interface PrunePlanEntry {
  readonly sessionId: string
  readonly decision: 'prune' | 'skip'
  readonly reason?: PruneReason
  /** Backend-resolved location, included only when a path gate was reached. */
  readonly location?: string
  readonly ageDays?: number
}

export interface PrunePlan {
  readonly generatedAt: number
  readonly retentionDays: number
  readonly entries: readonly PrunePlanEntry[]
  readonly counts: {
    readonly prune: number
    readonly skip: number
    readonly byReason: Readonly<Record<string, number>>
  }
}

function isInside(root: string, target: string): boolean {
  const base = root.length > 1 && root.endsWith(sep) ? root.slice(0, -1) : root
  return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep)
}

/** Backend `location` may be the typed `{kind,path}` object; tolerate a bare
 *  string from older hosts, reject everything else as a field anomaly. */
function locationPath(location: SessionPruneSnapshot['location']): string | undefined {
  if (typeof location === 'string') return location !== '' ? location : undefined
  if (location !== null && typeof location === 'object') {
    return typeof location.path === 'string' && location.path !== '' ? location.path : undefined
  }
  return undefined
}

/** True when any running session sits below `id` in the parent chain (or uses
 *  the `parentId/childId` subagent id form). Never builds a filesystem path. */
function hasRunningDescendant(id: string, rows: readonly PruneRow[]): boolean {
  const children = new Map<string, string[]>()
  for (const row of rows) {
    if (typeof row.sessionId !== 'string' || row.sessionId === '') continue
    const parent = typeof row.parentSessionId === 'string' ? row.parentSessionId : ''
    if (parent !== '') {
      const list = children.get(parent) ?? []
      list.push(row.sessionId)
      children.set(parent, list)
    }
  }
  const queue = [id]
  const visited = new Set<string>([id])
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const childId of children.get(current) ?? []) {
      if (visited.has(childId)) continue
      visited.add(childId)
      const child = rows.find((r) => r.sessionId === childId)
      if (child?.running === true) return true
      queue.push(childId)
    }
  }
  // Defensive: subagent sessions may be addressed as `parentId/childId`.
  return rows.some((row) => row.running === true && typeof row.sessionId === 'string' && row.sessionId.startsWith(id + '/'))
}

function skip(id: string, reason: PruneReason, location?: string, ageDays?: number): PrunePlanEntry {
  return location !== undefined
    ? { sessionId: id, decision: 'skip', reason, location, ...(ageDays !== undefined ? { ageDays } : {}) }
    : { sessionId: id, decision: 'skip', reason, ...(ageDays !== undefined ? { ageDays } : {}) }
}

/**
 * Produce a prune PLAN. Pure: reads only through `fs` + `persistence.stat`,
 * returns a frozen-in-shape decision table, performs no mutation anywhere.
 * A failing sessions-root `realpath` throws (the RPC maps it to INTERNAL);
 * a per-candidate fs failure degrades to a skip, never a throw or a delete.
 */
export async function planSessionPrune(
  rows: readonly PruneRow[],
  persistence: PrunePersistenceLike,
  fs: PruneFsLike,
  config: PruneConfig,
): Promise<PrunePlan> {
  const rootReal = await fs.realpath(config.sessionsRoot)
  const now = Number.isFinite(config.now) ? config.now : Date.now()
  const entries: PrunePlanEntry[] = []

  for (const row of rows) {
    const rawId = row.sessionId
    if (typeof rawId !== 'string' || rawId === '') {
      // An unidentifiable row cannot be planned; keep it visible as anomaly.
      entries.push(skip('', 'field-anomaly'))
      continue
    }
    const id = rawId

    if (config.retentionDays === 0) {
      entries.push(skip(id, 'retention-disabled'))
      continue
    }
    if (id === config.currentSessionId) {
      entries.push(skip(id, 'current'))
      continue
    }
    if (config.stagedIds?.has(id) === true) {
      entries.push(skip(id, 'staged'))
      continue
    }
    // P2 gate — the authoritative "an Agent is still attached" signal. A
    // `true` value skips outright, independent of `running`/mtime. OLD
    // CRITERION (SUPERSEDED, recorded verbatim): "an absent agentAvailable
    // means no agent is attached", which defaulted every row on an older host
    // to deletable. Missing / non-boolean is now a field anomaly: the host
    // capability floor is a REQUIRED boolean, never silently downgraded.
    if (row.agentAvailable === true) {
      entries.push(skip(id, 'agent-available'))
      continue
    }
    if (typeof row.agentAvailable !== 'boolean') {
      entries.push(skip(id, 'field-anomaly'))
      continue
    }
    // OLD CRITERION (SUPERSEDED): a missing `running` fell through as
    // "not running" and became a candidate; a missing `blank` was likewise
    // treated as false. Only EXPLICIT `running === false` is eligible to be a
    // candidate. `true` is a running skip; anything else (undefined, null, a
    // non-boolean) is a field anomaly. `blank` must be an explicit boolean.
    if (row.running === true) {
      entries.push(skip(id, 'running'))
      continue
    }
    if (row.running !== false) {
      entries.push(skip(id, 'field-anomaly'))
      continue
    }
    if (typeof row.blank !== 'boolean') {
      entries.push(skip(id, 'field-anomaly'))
      continue
    }
    const updatedAt = row.updatedAt
    if (updatedAt === undefined || updatedAt === null) {
      entries.push(skip(id, 'missing-time'))
      continue
    }
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
      entries.push(skip(id, 'field-anomaly'))
      continue
    }
    if (updatedAt > now) {
      entries.push(skip(id, 'future-time'))
      continue
    }
    if (hasRunningDescendant(id, rows)) {
      entries.push(skip(id, 'subtree-running'))
      continue
    }

    // The ONLY source of a candidate path: the host's own stat snapshot.
    let snapshot: SessionPruneSnapshot | undefined
    try {
      snapshot = await persistence.stat(id)
    } catch {
      snapshot = undefined
    }
    if (snapshot === undefined || snapshot === null) {
      entries.push(skip(id, 'unknown'))
      continue
    }
    if (snapshot.header?.id !== id) {
      entries.push(skip(id, 'header-mismatch'))
      continue
    }
    const path = locationPath(snapshot.location)
    if (path === undefined) {
      entries.push(skip(id, 'no-location'))
      continue
    }

    // B1: `path` is the artifact FILE; its dirname is the session directory.
    // Every fs gate below uses the directory, never the artifact file path.
    const sessionDir = dirname(path)

    // Basename gate — the dir's basename is encodeSegment(id), not the raw id.
    if (basename(sessionDir) !== encodeSegment(id)) {
      entries.push(skip(id, 'basename-mismatch', path))
      continue
    }

    // lstat gate — a symlink is NOT a directory here.
    try {
      const st = await fs.lstat(sessionDir)
      if (!st.isDirectory() || st.isSymbolicLink?.() === true) {
        entries.push(skip(id, 'not-directory', path))
        continue
      }
    } catch {
      entries.push(skip(id, 'not-directory', path))
      continue
    }

    // realpath containment gate (on the session directory).
    try {
      const real = await fs.realpath(sessionDir)
      if (!isInside(rootReal, real)) {
        entries.push(skip(id, 'escaped-root', path))
        continue
      }
    } catch {
      entries.push(skip(id, 'escaped-root', path))
      continue
    }

    // session.lock: stat only. ENOENT means "no fresh lock"; any other read
    // error is treated as unknown so a lock problem can never become a prune.
    const lockPath = join(sessionDir, 'session.lock')
    try {
      const lockStat = await fs.stat(lockPath)
      const mtime = lockStat.mtimeMs
      if (typeof mtime === 'number' && Number.isFinite(mtime) && now - mtime < config.lockGraceMs) {
        entries.push(skip(id, 'lock-fresh', path))
        continue
      }
    } catch (err) {
      const code = (err as { code?: unknown })?.code
      if (code !== 'ENOENT') {
        entries.push(skip(id, 'unknown', path))
        continue
      }
    }

    // P2 gate — read-only flock probe on `session.lock`. The bridge injects a
    // probe built from the host's `tryLockExclusive` (open 'r' only, inode/dev
    // recheck, close in finally). A held lock is a hard skip; an unknown
    // outcome (including a thrown probe) is a conservative skip. Absence of
    // the optional probe disables this gate for pure fixtures only — the RPC
    // refuses to plan at all when the capability cannot be resolved.
    if (typeof fs.lockProbe === 'function') {
      let probe: LockProbeResult
      try {
        probe = await fs.lockProbe(lockPath)
      } catch {
        probe = { status: 'unknown', detail: 'probe-threw' }
      }
      if (probe.status === 'lock-held') {
        entries.push(skip(id, 'lock-held', path))
        continue
      }
      if (probe.status === 'unknown') {
        entries.push(skip(id, 'unknown', path))
        continue
      }
    }

    // Recent-write heuristic (P1): the backend artifact's own mtime is a
    // second, conservative signal. A recently written artifact blocks pruning
    // even if `session.lock` is missing or stale. Opt-in via `freshMtimeGraceMs`
    // (0 disables it so pure fixtures stay deterministic); read-only `stat`
    // on the backend-resolved path only. A stat failure is conservative
    // `unknown`, never a silent prune.
    const freshGrace =
      typeof config.freshMtimeGraceMs === 'number' &&
      Number.isFinite(config.freshMtimeGraceMs) &&
      config.freshMtimeGraceMs > 0
        ? config.freshMtimeGraceMs
        : 0
    if (freshGrace > 0) {
      try {
        const artifactStat = await fs.stat(path)
        const artifactMtime = artifactStat.mtimeMs
        if (
          typeof artifactMtime === 'number' &&
          Number.isFinite(artifactMtime) &&
          now - artifactMtime < freshGrace
        ) {
          entries.push(skip(id, 'fresh-mtime', path))
          continue
        }
      } catch {
        entries.push(skip(id, 'unknown', path))
        continue
      }
    }

    const ageDays = (now - updatedAt) / MS_PER_DAY
    const threshold = config.retentionDays + (row.blank === true ? config.blankGraceDays : 0)
    if (ageDays < threshold) {
      entries.push(skip(id, row.blank === true ? 'blank-grace' : 'within-retention', path, ageDays))
      continue
    }
    entries.push({ sessionId: id, decision: 'prune', location: path, ageDays })
  }

  const byReason: Record<string, number> = {}
  let prune = 0
  let skipped = 0
  for (const entry of entries) {
    if (entry.decision === 'prune') {
      prune += 1
    } else {
      skipped += 1
      const reason = entry.reason ?? 'unknown'
      byReason[reason] = (byReason[reason] ?? 0) + 1
    }
  }
  return {
    generatedAt: now,
    retentionDays: config.retentionDays,
    entries,
    counts: { prune, skip: skipped, byReason },
  }
}
