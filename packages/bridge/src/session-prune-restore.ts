/**
 * retention B4/C7 — restore core for session prune.
 *
 * This module owns the rename-only surface that moves a VALIDATED trash entry
 * back into the live sessions root. It is deliberately split from the planner,
 * the flock probe, the apply core and the purge core: every fs primitive is
 * injected through `RestoreFsLike` and nothing imports a host implementation.
 *
 * Hard rules:
 *  - the client supplies only a trash entry ID (a session id). It can send no
 *    path, root, manifest or policy; all of those are host-derived here.
 *  - `list` reports only `{id, movedAt, size?}` — never an absolute path, a
 *    run directory name or a manifest field.
 *  - before a rename: host trash scan + `.applied.json` manifest + artifact
 *    header.id + encoded basename + trash realpath containment + live roster
 *    conflict + live destination containment + refuse-if-exists (TOCTOU
 *    recheck) + read-only flock probe + st_dev equality.
 *  - restore is refuse-if-exists: a live row or an existing destination path
 *    is a CONFLICT, never an overwrite.
 */

import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { zstdDecompressSync as nodeZstdDecompressSync } from 'node:zlib'
import {
  encodeSegment,
  listAllSessions,
  type LockProbe,
  type LockProbeResult,
  type PrunePersistenceLike,
  type SessionListerLike,
  type SessionPruneSnapshot,
} from './session-prune'
import { trashSessionsRoot } from './session-prune-apply'

const RUN_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/
const ARTIFACT_FILENAME = 'session.v4.jsonl.zstd'

/** Host-owned error codes, frozen for the wire. */
export type RestoreErrorCode =
  | 'BAD_PARAMS'
  | 'UNSUPPORTED'
  | 'NOT_FOUND'
  | 'BAD_PATH'
  | 'BAD_MANIFEST'
  | 'CONFLICT'
  | 'LIVE_AGENT'
  | 'LOCKED'
  | 'EXDEV'
  | 'BLOCKED'
  | 'RESTORE_FAILED'
  | 'INTERNAL'

export class RestoreError extends Error {
  readonly code: RestoreErrorCode
  readonly detail?: unknown
  constructor(code: RestoreErrorCode, message: string, detail?: unknown) {
    super(message)
    this.name = 'RestoreError'
    this.code = code
    this.detail = detail
  }
}

function fail(code: RestoreErrorCode, message: string, detail?: unknown): never {
  throw new RestoreError(code, message, detail)
}

function errorCode(err: unknown): string | undefined {
  if (err === null || typeof err !== 'object') return undefined
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function isEnoent(err: unknown): boolean {
  return errorCode(err) === 'ENOENT'
}

function isInside(root: string, target: string): boolean {
  const base = root.length > 1 && root.endsWith(sep) ? root.slice(0, -1) : root
  return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep)
}

function sameDev(a: unknown, b: unknown): boolean {
  return a !== undefined && b !== undefined && String(a) === String(b)
}

// ---------------------------------------------------------------------------
// Injectable seams.
// ---------------------------------------------------------------------------

export interface RestoreStatLike {
  readonly dev?: number | bigint
  readonly ino?: number | bigint
  readonly size?: number
  readonly mtimeMs?: unknown
  isDirectory(): boolean
  isSymbolicLink?(): boolean
}

export interface RestoreFsLike {
  lstat(path: string): Promise<RestoreStatLike>
  stat(path: string): Promise<RestoreStatLike>
  realpath(path: string): Promise<string>
  readdir(path: string): Promise<string[]>
  readFile(path: string): Promise<string>
  /** Binary read of the zstd artifact; the header is its first JSON line. */
  readFileBuffer(path: string): Promise<Buffer>
  rename(from: string, to: string): Promise<void>
}

export interface RestoreDeps {
  readonly persistence: PrunePersistenceLike
  /** Live `session.list` — conflict authority, same gate purge uses. */
  readonly lister: SessionListerLike
  /** Read-only flock probe. Missing -> UNSUPPORTED, never "assume unlocked". */
  readonly lockProbe?: LockProbe
  readonly now: number
  readonly opId: string
  /** Host-owned canonical live sessions root, never a client param. */
  readonly sessionsRoot: string
  /** Host-side apply lock, acquired ONCE around the scan + rename. */
  readonly withApplyLock: <T>(fn: () => Promise<T>) => Promise<T>
}

/** A recoverable trash entry. No path field exists on this shape by design. */
export interface RestoreEntry {
  readonly id: string
  readonly movedAt: number
  readonly size?: number
}

/** A rejection carries only a code/message — never a host path. */
export interface RestoreRejection {
  readonly code: RestoreErrorCode | 'INTERNAL'
  readonly message: string
}

export interface RestoreListResult {
  readonly entries: readonly RestoreEntry[]
  readonly rejected: readonly RestoreRejection[]
}

export interface RestoreResult {
  readonly id: string
  readonly restored: true
  readonly opId: string
}

interface AppliedManifest {
  readonly id: string
  readonly to: string
  readonly from?: string
  readonly appliedAt: number
}

interface ScannedEntry {
  readonly id: string
  readonly run: string
  readonly encoded: string
  readonly path: string
  readonly manifest: AppliedManifest
}

type ZstdDecompress = (frame: Buffer) => Buffer

function zstdDecompress(frame: Buffer): Buffer {
  const bun = (globalThis as { Bun?: { zstdDecompressSync?: ZstdDecompress } }).Bun
  if (bun?.zstdDecompressSync !== undefined) return bun.zstdDecompressSync(frame)
  return nodeZstdDecompressSync(frame)
}

/** Read `header.id` from the FIRST line of the trash artifact. The live
 *  persistence backend cannot stat a session after apply renamed it into
 *  trash, so the artifact is the only header authority here — the same rule
 *  the purge core uses. */
async function readTrashArtifactHeaderId(fs: RestoreFsLike, dir: string): Promise<string> {
  const artifact = join(dir, ARTIFACT_FILENAME)
  let frame: Buffer
  try {
    frame = await fs.readFileBuffer(artifact)
  } catch (err) {
    fail('BAD_MANIFEST', 'trash entry has no readable session artifact', { code: errorCode(err) })
  }
  if (frame.length === 0) fail('BAD_MANIFEST', 'trash session artifact is empty')
  let text: string
  try {
    text = zstdDecompress(frame).toString('utf8')
  } catch {
    fail('BAD_MANIFEST', 'trash session artifact is not a valid zstd frame')
  }
  const firstLine = text.split('\n', 1)[0] ?? ''
  let header: unknown
  try {
    header = JSON.parse(firstLine)
  } catch {
    fail('BAD_MANIFEST', 'trash session artifact header is not JSON')
  }
  if (header === null || typeof header !== 'object') fail('BAD_MANIFEST', 'trash session artifact header is not an object')
  const id = (header as { id?: unknown }).id
  if (typeof id !== 'string' || id === '') fail('BAD_MANIFEST', 'trash artifact header.id is missing')
  return id
}

async function readAppliedManifest(fs: RestoreFsLike, dir: string): Promise<AppliedManifest> {
  let text: string
  try {
    text = await fs.readFile(join(dir, '.applied.json'))
  } catch (err) {
    fail('BAD_MANIFEST', 'trash entry has no readable .applied.json', { code: errorCode(err) })
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    fail('BAD_MANIFEST', 'trash entry .applied.json is not JSON')
  }
  if (raw === null || typeof raw !== 'object') fail('BAD_MANIFEST', 'trash entry .applied.json is not an object')
  const m = raw as Record<string, unknown>
  if (typeof m.id !== 'string' || m.id === '') fail('BAD_MANIFEST', 'applied manifest id is missing')
  if (typeof m.to !== 'string' || m.to === '') fail('BAD_MANIFEST', 'applied manifest to is missing')
  if (typeof m.appliedAt !== 'number' || !Number.isFinite(m.appliedAt)) fail('BAD_MANIFEST', 'applied manifest appliedAt is invalid')
  return {
    id: m.id,
    to: m.to,
    ...(typeof m.from === 'string' && m.from !== '' ? { from: m.from } : {}),
    appliedAt: m.appliedAt,
  }
}

async function probeLockForRestore(lockProbe: LockProbe | undefined, lockPath: string): Promise<void> {
  if (lockProbe === undefined) fail('UNSUPPORTED', 'lockProbe capability unavailable; restore refuses to assume unlocked', { lockPath })
  let result: LockProbeResult
  try {
    result = await lockProbe(lockPath)
  } catch {
    fail('LOCKED', 'lock probe threw; refusing to restore', { lockPath })
  }
  if (result.status === 'lock-held' || result.status === 'unknown') {
    fail('LOCKED', 'session.lock probe is not unlocked', { lockPath, status: result.status })
  }
}

async function pathExists(fs: RestoreFsLike, path: string): Promise<boolean> {
  try {
    await fs.lstat(path)
    return true
  } catch (err) {
    if (isEnoent(err)) return false
    throw err
  }
}

/** Re-derive and validate ONE trash entry. `run`/`encoded` come ONLY from a
 *  host directory scan; the caller never supplies a path. */
async function assessEntry(
  fs: RestoreFsLike,
  dshHome: string,
  run: string,
  encoded: string,
): Promise<ScannedEntry> {
  if (!RUN_NAME_RE.test(run)) fail('BAD_PATH', 'trash run directory name is not a UTC stamp')
  const entryPath = join(trashSessionsRoot(dshHome), run, encoded)
  const st = await fs.lstat(entryPath)
  if (!st.isDirectory() || st.isSymbolicLink?.() === true) fail('BAD_PATH', 'trash entry is not a real directory')
  const manifest = await readAppliedManifest(fs, entryPath)
  if (encodeSegment(manifest.id) !== encoded || basename(entryPath) !== encoded) {
    fail('BAD_MANIFEST', 'manifest id does not encode to the entry basename')
  }
  const toRel = relative(trashSessionsRoot(dshHome), manifest.to)
  const expectedRel = join(run, encoded)
  if (!isAbsolute(manifest.to) || toRel.startsWith('..') || isAbsolute(toRel)) {
    fail('BAD_MANIFEST', 'applied manifest to escapes the trash sessions root')
  }
  if (toRel !== expectedRel && toRel !== expectedRel.split(sep).join('/')) {
    fail('BAD_MANIFEST', 'applied manifest to does not match the scanned entry')
  }
  const trashReal = await fs.realpath(trashSessionsRoot(dshHome))
  const real = await fs.realpath(entryPath)
  if (!isInside(trashReal, real) || relative(trashReal, real) !== expectedRel) {
    fail('BAD_PATH', 'trash entry realpath escaped the sessions trash root')
  }
  // Header is the artifact's own first line; cross-check against the manifest.
  const headerId = await readTrashArtifactHeaderId(fs, entryPath)
  if (headerId !== manifest.id) fail('BAD_MANIFEST', 'trash artifact header.id mismatch')
  return { id: manifest.id, run, encoded, path: entryPath, manifest }
}

/** Read-only enumeration of recoverable trash entries. Rejections are
 *  code/message only — no path is ever projected to the caller. */
export async function listRestoreEntries(
  fs: RestoreFsLike,
  dshHome: string,
): Promise<RestoreListResult> {
  const root = trashSessionsRoot(dshHome)
  let runs: string[]
  try {
    runs = await fs.readdir(root)
  } catch (err) {
    if (isEnoent(err)) return { entries: [], rejected: [] }
    throw err
  }
  const entries: RestoreEntry[] = []
  const rejected: RestoreRejection[] = []
  for (const run of runs) {
    let leaves: string[]
    try {
      leaves = await fs.readdir(join(root, run))
    } catch (err) {
      if (isEnoent(err)) continue
      rejected.push({ code: 'INTERNAL', message: 'cannot read a trash run directory' })
      continue
    }
    for (const encoded of leaves) {
      if (encoded.startsWith('.')) continue
      try {
        const scanned = await assessEntry(fs, dshHome, run, encoded)
        let size: number | undefined
        try {
          const artifactStat = await fs.stat(join(scanned.path, ARTIFACT_FILENAME))
          if (typeof artifactStat.size === 'number' && Number.isFinite(artifactStat.size)) size = artifactStat.size
        } catch { /* size is optional */ }
        entries.push({
          id: scanned.id,
          movedAt: scanned.manifest.appliedAt,
          ...(size !== undefined ? { size } : {}),
        })
      } catch (err) {
        rejected.push({
          code: err instanceof RestoreError ? err.code : 'INTERNAL',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  entries.sort((a, b) => b.movedAt - a.movedAt || a.id.localeCompare(b.id))
  return { entries, rejected }
}

async function readLiveIds(lister: SessionListerLike): Promise<Map<string, 'LIVE_AGENT' | 'CONFLICT'>> {
  const listing = await listAllSessions(lister)
  if (listing.truncated) fail('BLOCKED', 'restore aborted: session.list roster is incomplete', { pages: listing.pages })
  const ids = new Map<string, 'LIVE_AGENT' | 'CONFLICT'>()
  for (const row of listing.rows) {
    const raw = (row as { sessionId?: unknown }).sessionId
    if (raw === undefined || raw === null) continue
    const id = String(raw)
    if ((row as { agentAvailable?: unknown }).agentAvailable === true) ids.set(id, 'LIVE_AGENT')
    else if (!ids.has(id)) ids.set(id, 'CONFLICT')
  }
  return ids
}

/** Derive the live destination from the host manifest `from`, falling back to
 *  a live `persistence.stat(id)` location hint. Never built from a wire path. */
async function liveDestination(
  fs: RestoreFsLike,
  deps: RestoreDeps,
  scanned: ScannedEntry,
  rootReal: string,
): Promise<string> {
  let destination: string | undefined
  const from = scanned.manifest.from
  if (typeof from === 'string' && from !== '' && isAbsolute(from)) {
    const rel = relative(deps.sessionsRoot, from)
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) destination = from
  }
  if (destination === undefined) {
    let snapshot: SessionPruneSnapshot | undefined
    try {
      snapshot = await deps.persistence.stat(scanned.id)
    } catch {
      snapshot = undefined
    }
    const location = snapshot?.location
    const path = typeof location === 'string'
      ? location
      : location !== null && typeof location === 'object' && typeof location.path === 'string'
        ? location.path
        : undefined
    if (path !== undefined && path !== '' && isAbsolute(path)) {
      // `path` is the backend artifact FILE; its dirname is the live session
      // directory — the same B1 contract the planner/apply use.
      const candidate = dirname(path)
      const rel = relative(deps.sessionsRoot, candidate)
      if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) destination = candidate
    }
  }
  if (destination === undefined) fail('BAD_PATH', 'restore refused: no host-derived live destination')
  const dir = basename(destination)
  if (dir !== encodeSegment(scanned.id)) fail('BAD_PATH', 'restore refused: live destination basename mismatch')
  // The destination directory itself must not exist yet, and its parent must
  // canonicalise inside the live sessions root.
  if (await pathExists(fs, destination)) fail('CONFLICT', 'restore refused: live destination already exists')
  const parent = join(destination, '..')
  let parentReal: string
  try {
    parentReal = await fs.realpath(parent)
  } catch (err) {
    if (isEnoent(err)) fail('BAD_PATH', 'restore refused: live destination parent is missing')
    throw err
  }
  if (!isInside(rootReal, parentReal)) fail('BAD_PATH', 'restore refused: live destination escaped sessions root')
  return destination
}

/**
 * Restore ONE trashed session by ID. The entire set is re-scanned and
 * re-validated inside the host apply lock; a matching id is required and a
 * live collision is a hard CONFLICT (refuse-if-exists, never overwrite).
 */
export async function restoreTrashEntry(
  fs: RestoreFsLike,
  deps: RestoreDeps,
  dshHome: string,
  id: unknown,
): Promise<RestoreResult> {
  if (typeof id !== 'string' || id === '') fail('BAD_PARAMS', 'session.prune.restore requires a non-empty id')
  return deps.withApplyLock(async () => {
    const liveIds = await readLiveIds(deps.lister)
    const live = liveIds.get(id)
    if (live === 'LIVE_AGENT') fail('LIVE_AGENT', 'restore refused: a live agent still owns this session id')
    if (live === 'CONFLICT') fail('CONFLICT', 'restore refused: session id already exists outside trash')

    const rootReal = await fs.realpath(deps.sessionsRoot)
    const root = trashSessionsRoot(dshHome)
    let runs: string[]
    try {
      runs = await fs.readdir(root)
    } catch (err) {
      if (isEnoent(err)) fail('NOT_FOUND', 'restore refused: no such trash entry')
      throw err
    }
    const matches: ScannedEntry[] = []
    for (const run of runs) {
      let leaves: string[]
      try {
        leaves = await fs.readdir(join(root, run))
      } catch (err) {
        if (isEnoent(err)) continue
        throw err
      }
      for (const encoded of leaves) {
        if (encoded.startsWith('.')) continue
        try {
          const scanned = await assessEntry(fs, dshHome, run, encoded)
          if (scanned.id === id) matches.push(scanned)
        } catch (err) {
          // A malformed sibling must not make a valid target unreachable; it
          // is simply not a candidate.
          if (err instanceof RestoreError) continue
          throw err
        }
      }
    }
    if (matches.length === 0) fail('NOT_FOUND', 'restore refused: no such trash entry')
    if (matches.length > 1) fail('CONFLICT', 'restore refused: duplicate trash entries for this id')
    const scanned = matches[0]

    const destination = await liveDestination(fs, deps, scanned, rootReal)
    const trashStat = await fs.stat(scanned.path)
    const parentStat = await fs.stat(join(destination, '..'))
    if (!sameDev(trashStat.dev, parentStat.dev)) fail('EXDEV', 'restore refused: cross-device rename')

    // Second gate at the last safe point before the rename: both sides must
    // still be the validated objects and the destination must still be free.
    const recheckSt = await fs.lstat(scanned.path)
    if (!recheckSt.isDirectory() || recheckSt.isSymbolicLink?.() === true) {
      fail('BAD_PATH', 'restore refused: trash entry flipped to symlink/non-directory')
    }
    if (await pathExists(fs, destination)) fail('CONFLICT', 'restore refused: live destination already exists')

    await probeLockForRestore(deps.lockProbe, join(scanned.path, 'session.lock'))
    try {
      await fs.rename(scanned.path, destination)
    } catch (err) {
      if (errorCode(err) === 'EXDEV') fail('EXDEV', 'restore refused: cross-device rename')
      fail('RESTORE_FAILED', 'restore rename failed', { code: errorCode(err) })
    }
    return { id, restored: true as const, opId: deps.opId }
  })
}
