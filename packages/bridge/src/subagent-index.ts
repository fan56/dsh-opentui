/**
 * L1 (0.23.1) — the bridge-local `session → sub-agents` index.
 *
 * One instance per host bridge (keyed by the cordis ctx via WeakMap, so a fresh
 * `apply()`/host gets a fresh table and concurrent test harnesses stay
 * isolated). The table is a CACHE, never durable state: `session.list` is the
 * source of truth. It exists so the stop capability never depends on the
 * client-side roster (which is empty at the moment Stop is pressed — the
 * 0.23.0 root cause), and so a stop never kills an agent that is not a child of
 * the calling session.
 *
 * Shape (user-approved plan):
 *   Map<childId, { parentSessionId, startedAt, status, lastSeq? }>
 *
 * Lifecycle:
 *  - build: `syncFromList` over a full `session.list` snapshot (first use or
 *    bridge reset), filtered to `origin === 'subagent'`.
 *  - incremental: `noteCatalog` inserts a just-spawned child; `noteSettled`
 *    flips a child to settled on its `turn/end` (both ride the existing
 *    `session/event` firehose).
 *  - reconcile: `syncFromList` again before EVERY stop action — the host list is
 *    authoritative for `running`/`parentSessionId`. `parentSessionId` is
 *    immutable (a child never changes parents), so a TOCTOU between the
 *    incremental event and the list snapshot has no harmful effect.
 */

export type SubagentStatus = 'running' | 'settled'

export interface SubagentIndexRow {
  parentSessionId: string
  /** Host wall clock (epoch ms) — from `childCreatedAt` (catalog) or `updatedAt` (list). */
  startedAt: number
  status: SubagentStatus
  /** Last observed child-journal / turn seq, when the event carried one. */
  lastSeq?: number
}

/** The minimal `session/list` row shape this index reads (structural slice of
 *  the bridge's `SessionSummaryLike`). The bridge passes host rows through
 *  verbatim; only `origin === 'subagent'` rows are indexed. */
export interface SubagentListRowLike {
  sessionId: string
  origin?: string
  parentSessionId?: string
  running: boolean
  updatedAt: number
}

export class SubagentIndex {
  readonly rows = new Map<string, SubagentIndexRow>()
  /** True once at least one full list snapshot has been applied. */
  built = false

  /** Bridge reset / fresh apply: drop every cached child and forget the build. */
  reset(): void {
    this.rows.clear()
    this.built = false
  }

  /**
   * Replace the cache with a full authoritative `session.list` snapshot, while
   * retaining incremental-only rows that the host has not published to the list
   * yet (a catalog event can precede the list row — exactly the Stop window we
   * must cover). On a key present in the list the list row WINS; `parentSessionId`
   * is never changed by an incremental event once set.
   *
   * @returns the number of `origin === 'subagent'` rows found in the snapshot.
   */
  syncFromList(items: readonly SubagentListRowLike[]): number {
    const next = new Map<string, SubagentIndexRow>()
    let subagentCount = 0
    for (const row of items) {
      if (row === null || typeof row !== 'object') continue
      if (row.origin !== 'subagent') continue
      if (typeof row.sessionId !== 'string' || row.sessionId === '') continue
      subagentCount += 1
      next.set(row.sessionId, {
        parentSessionId: typeof row.parentSessionId === 'string' ? row.parentSessionId : '',
        startedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
        status: row.running === true ? 'running' : 'settled',
      })
    }
    // Keep incremental-only children that are not (yet) in the list.
    for (const [childId, cached] of this.rows) {
      if (!next.has(childId)) next.set(childId, cached)
    }
    this.rows.clear()
    for (const [childId, row] of next) this.rows.set(childId, row)
    this.built = true
    return subagentCount
  }

  /** Insert (or refresh) a child from a `subagent/catalog` event on its parent. */
  noteCatalog(childId: string, parentSessionId: string, startedAt?: number): void {
    if (typeof childId !== 'string' || childId === '') return
    const existing = this.rows.get(childId)
    if (existing !== undefined) {
      // parent is immutable; only fill an absent timestamp from the event.
      if (!existing.startedAt && typeof startedAt === 'number') existing.startedAt = startedAt
      return
    }
    this.rows.set(childId, {
      parentSessionId,
      startedAt: typeof startedAt === 'number' ? startedAt : 0,
      status: 'running',
    })
  }

  /** Flip a child to settled from its `turn/end` (or another settle signal). */
  noteSettled(childId: string, lastSeq?: number): void {
    if (typeof childId !== 'string' || childId === '') return
    const row = this.rows.get(childId)
    if (row === undefined) return
    row.status = 'settled'
    if (typeof lastSeq === 'number') row.lastSeq = lastSeq
  }

  has(childId: string): boolean {
    return this.rows.has(childId)
  }

  get(childId: string): SubagentIndexRow | undefined {
    return this.rows.get(childId)
  }

  /** Enumerate RUNNING children of one parent (no global-stop path exists). */
  runningChildrenOf(parentSessionId: string): Array<{ childId: string; row: SubagentIndexRow }> {
    const out: Array<{ childId: string; row: SubagentIndexRow }> = []
    for (const [childId, row] of this.rows) {
      if (row.parentSessionId === parentSessionId && row.status === 'running') {
        out.push({ childId, row })
      }
    }
    return out
  }
}

/** One table per host bridge (per cordis ctx); lazily created. */
const indexes = new WeakMap<object, SubagentIndex>()

export function getSubagentIndex(ctx: object): SubagentIndex {
  let index = indexes.get(ctx)
  if (index === undefined) {
    index = new SubagentIndex()
    indexes.set(ctx, index)
  }
  return index
}
