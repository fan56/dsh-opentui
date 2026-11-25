/**
 * retention P1 — in-memory fixtures for the pure prune planner.
 *
 * No real fs is touched here: `PruneFsLike` and `PrunePersistenceLike` are
 * replaced with deterministic stubs so a test can drive every gate without
 * creating, renaming or deleting any file.
 *
 * B1 CONTRACT (corrected): a stat snapshot's `location.path` is the BACKEND
 * ARTIFACT FILE (e.g. `.../session.v4.jsonl.zstd`), not a session directory.
 * The session directory is `dirname(path)` and its basename is
 * `encodeSegment(id)`. These fixtures reproduce that real host layout,
 * including the host's `_no-cwd` project-directory level under the root.
 *
 * OLD criterion (SUPERSEDED, B1 BLOCKER, verbatim): "A well-formed stat
 * snapshot whose backend location is a directory path" — `path: ${TEST_ROOT}/${id}`.
 * That made every genuine artifact path fail the basename gate (always skip).
 */
import { basename, dirname, join } from "node:path"
import { encodeSegment } from "../../src/session-prune"
import type {
  LockProbeResult,
  PruneConfig,
  PruneFsLike,
  PrunePersistenceLike,
  PruneRow,
  SessionPruneSnapshot,
} from "../../src/session-prune"

export const TEST_NOW = Date.UTC(2026, 10, 25, 12, 0, 0)
export const TEST_ROOT = "/sessions"
/** Host `projectDir(root, undefined)` → `join(root, '_no-cwd')`. */
export const TEST_PROJECT_DIR = "_no-cwd"
export const ARTIFACT_FILENAME = "session.v4.jsonl.zstd"
export const OLD_UPDATED = TEST_NOW - 120 * 86_400_000 // 120 days ago

/** Real host layout: root / project dir / encodeSegment(id) / artifact file. */
export function sessionDirFor(id: string): string {
  return join(TEST_ROOT, TEST_PROJECT_DIR, encodeSegment(id))
}
export function artifactPathFor(id: string): string {
  return join(sessionDirFor(id), ARTIFACT_FILENAME)
}
/** Inverse of encodeSegment, used only by the in-memory fs stub. */
function decodeSegment(segment: string): string {
  return segment.replace(/~([0-9A-F]{4})/g, (_m, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}
function idFromDir(dir: string): string {
  return decodeSegment(basename(dir))
}

/** Default planner config: 90-day retention, no current/staged, zero graces. */
export function pruneConfig(overrides: Partial<PruneConfig> = {}): PruneConfig {
  return {
    retentionDays: 90,
    now: TEST_NOW,
    sessionsRoot: TEST_ROOT,
    stagedIds: new Set<string>(),
    blankGraceDays: 30,
    lockGraceMs: 300_000,
    ...overrides,
  }
}

export function row(id: string, overrides: Partial<PruneRow> = {}): PruneRow {
  // `agentAvailable` is a REQUIRED boolean on the modern wire; omitting it is
  // a field anomaly. Fixture rows are explicit false so existing gate tests
  // keep exercising the path they were written for.
  return { sessionId: id, updatedAt: OLD_UPDATED, agentAvailable: false, running: false, blank: false, ...overrides }
}

export interface FsStubOptions {
  /** Ids whose location DIRECTORY lstat resolves to a real directory. */
  readonly dirs?: readonly string[]
  /** Ids whose realpath resolves OUTSIDE the sessions root. */
  readonly escapes?: readonly string[]
  /** Ids whose location DIRECTORY is a symlink (lstat says non-directory). */
  readonly symlinks?: readonly string[]
  /** Map of session id -> session.lock mtime (ms). Missing = no lock file. */
  readonly lockMtimes?: Readonly<Record<string, number>>
  /** Ids whose lock stat throws a non-ENOENT error. */
  readonly lockErrors?: readonly string[]
  /** Map of session id -> backend artifact mtime (ms) for the fresh-mtime gate.
   *  Missing = deterministically old (0), so the opt-in gate never fires by
   *  accident in the pure-fixture tests. */
  readonly artifactMtimes?: Readonly<Record<string, number>>
  /** P2: id -> read-only flock probe result. Missing id => `unlocked`.
   *  Supplying any probe makes `fsStub` expose the optional `lockProbe`. */
  readonly lockProbes?: Readonly<Record<string, LockProbeResult>>
  /** P2: ids whose flock probe throws (maps to conservative `unknown`). */
  readonly lockProbeErrors?: readonly string[]
}

/** Record every fs call so tests can assert the planner never writes. */
export interface FsStub extends PruneFsLike {
  readonly calls: Array<{ op: string; path: string }>
}

export function fsStub(options: FsStubOptions = {}): FsStub {
  const calls: Array<{ op: string; path: string }> = []
  const dirs = new Set(options.dirs ?? [])
  const escapes = new Set(options.escapes ?? [])
  const symlinks = new Set(options.symlinks ?? [])
  const lockMtimes = options.lockMtimes ?? {}
  const lockErrors = new Set(options.lockErrors ?? [])
  const artifactMtimes = options.artifactMtimes ?? {}
  const lockProbes = options.lockProbes ?? {}
  const lockProbeErrors = new Set(options.lockProbeErrors ?? [])
  const withLockProbe = options.lockProbes !== undefined || options.lockProbeErrors !== undefined
  const rootReal = "/real/sessions"

  return {
    calls,
    async lstat(path: string) {
      calls.push({ op: "lstat", path })
      // Planner calls lstat on the session DIRECTORY, never the artifact file.
      const id = idFromDir(path)
      if (symlinks.has(id)) {
        return { isDirectory: () => false, isSymbolicLink: () => true }
      }
      if (!dirs.has(id)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      return { isDirectory: () => true, isSymbolicLink: () => false }
    },
    async realpath(path: string) {
      calls.push({ op: "realpath", path })
      if (path === TEST_ROOT) return rootReal
      const segment = basename(path)
      const id = decodeSegment(segment)
      return escapes.has(id) ? `/elsewhere/${segment}` : `${rootReal}/${segment}`
    },
    async stat(path: string) {
      calls.push({ op: "stat", path })
      // Both gates stat a path under <sessionDir>; recover the id from the
      // dir segment, then branch on lock vs backend artifact file.
      const id = idFromDir(dirname(path))
      if (basename(path) === "session.lock") {
        if (lockErrors.has(id)) throw Object.assign(new Error("EACCES"), { code: "EACCES" })
        const mtime = lockMtimes[id]
        if (mtime === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
        return { mtimeMs: mtime }
      }
      return { mtimeMs: artifactMtimes[id] ?? 0 }
    },
    ...(withLockProbe
      ? {
          async lockProbe(path: string): Promise<LockProbeResult> {
            calls.push({ op: "lockProbe", path })
            const id = idFromDir(dirname(path))
            if (lockProbeErrors.has(id)) throw new Error("probe failed")
            return lockProbes[id] ?? { status: "unlocked" }
          },
        }
      : {}),
  }
}

export interface PersistenceStubOptions {
  /** id -> snapshot; a missing id makes stat return undefined ("unknown"). */
  readonly snapshots?: Readonly<Record<string, SessionPruneSnapshot>>
  /** Ids whose stat throws (also maps to "unknown"). */
  readonly errors?: readonly string[]
}

export function persistenceStub(options: PersistenceStubOptions = {}): PrunePersistenceLike {
  const snapshots = options.snapshots ?? {}
  const errors = new Set(options.errors ?? [])
  return {
    async stat(id: string) {
      if (errors.has(id)) throw new Error("stat failed")
      return snapshots[id]
    },
  }
}

/** A well-formed stat snapshot: backend-resolved ARTIFACT FILE path (B1 layout). */
export function snapshot(id: string, overrides: Partial<SessionPruneSnapshot> = {}): SessionPruneSnapshot {
  return {
    header: { id, createdAt: OLD_UPDATED },
    location: { kind: "jsonl", path: artifactPathFor(id) },
    ...overrides,
  }
}
