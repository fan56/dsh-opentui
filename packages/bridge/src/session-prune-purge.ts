/**
 * retention P3 — purge core for session prune.
 *
 * This module owns the ONLY deletion surface introduced by retention. It is
 * deliberately split out from the read-only planner (`session-prune.ts`), the
 * read-only flock probe (`prune-lock-probe.ts`) and the rename-only apply core
 * (`session-prune-apply.ts`). Every fs operation is injected through
 * `PurgeFsLike`; nothing here imports a host implementation.
 *
 * Hard rules (pre-registered in
 * `.proof/retention-prune-p3/00-preregistered-expected.md`):
 *  - the RPC is trash-only. Every path is re-derived from the host's dshHome;
 *    a client path/root/policy never reaches a delete decision.
 *  - a confirmation token is HMAC-signed by the server, bound to the exact
 *    candidate id/path set, host trash root, retention policy and issue time,
 *    bounded-lifetime and single-use. No client can mint one.
 *  - before every delete the whole gate set is re-probed: live agent roster,
 *    live path collision, restore conflict, manifest/header/root, residence
 *    window and the read-only `session.lock` probe. A missing lockProbe makes
 *    the request UNSUPPORTED, never "assume unlocked".
 *  - only one validated trash session directory is removed recursively;
 *    symlinks are unlinked, NEVER followed. Per-entry failures do not abort the
 *    batch. An intent manifest row is written before each delete, so a crash
 *    leaves a record and recovery only marks it.
 *  - trash `.apply.lock`, the apply `manifest.jsonl` and every journal/token
 *    file are outside the delete root and are never touched.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { zstdDecompressSync as nodeZstdDecompressSync } from 'node:zlib'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import {
  encodeSegment,
  listAllSessions,
  type LockProbe,
  type LockProbeResult,
  type PrunePersistenceLike,
  type SessionListerLike,
  type SessionPruneSnapshot,
} from './session-prune'
import { trashJournalRoot, trashRoot, trashSessionsRoot } from './session-prune-apply'

const MS_PER_DAY = 86_400_000

/** Host-owned default. A client may never override it over the wire. */
export const DEFAULT_PURGE_RETENTION_DAYS = 7

export type PurgeErrorCode =
  | 'BAD_PARAMS'
  | 'UNSUPPORTED'
  | 'BAD_TOKEN'
  | 'STALE_TOKEN'
  | 'REPLAY'
  | 'BAD_PATH'
  | 'BAD_MANIFEST'
  | 'FRESH'
  | 'CONFLICT'
  | 'LIVE_AGENT'
  | 'LOCKED'
  | 'BLOCKED'
  | 'DELETE_FAILED'
  | 'INTERNAL'

export class PurgeError extends Error {
  readonly code: PurgeErrorCode
  readonly detail?: unknown
  constructor(code: PurgeErrorCode, message: string, detail?: unknown) {
    super(message)
    this.name = 'PurgeError'
    this.code = code
    this.detail = detail
  }
}

function fail(code: PurgeErrorCode, message: string, detail?: unknown): never {
  throw new PurgeError(code, message, detail)
}

/** Fixed wire wording for per-entry rejection/failure rows. All `PurgeError`
 *  messages are already fixed literals; a raw fs error is never projected. */
function purgeWireMessage(err: unknown): string {
  return err instanceof PurgeError ? err.message : 'purge entry could not be processed'
}

function errorCode(err: unknown): string | undefined {
  if (err === null || typeof err !== 'object') return undefined
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function isInside(root: string, target: string): boolean {
  const base = root.length > 1 && root.endsWith(sep) ? root.slice(0, -1) : root
  return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep)
}

// ---------------------------------------------------------------------------
// Injectable seams.
// ---------------------------------------------------------------------------

export interface PurgeStatLike {
  readonly dev?: number | bigint
  readonly ino?: number | bigint
  readonly mtimeMs?: unknown
  isDirectory(): boolean
  isSymbolicLink?(): boolean
}

export interface PurgeFsLike {
  lstat(path: string): Promise<PurgeStatLike>
  stat(path: string): Promise<PurgeStatLike>
  realpath(path: string): Promise<string>
  readdir(path: string): Promise<string[]>
  readFile(path: string): Promise<string>
  /** Binary read of the zstd session artifact; never decoded as text. */
  readFileBuffer(path: string): Promise<Buffer>
  writeFile(path: string, data: string, options: { flag: 'wx'; mode?: number }): Promise<void>
  appendFile(path: string, data: string): Promise<void>
  unlink(path: string): Promise<void>
  rmdir(path: string): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<unknown>
}

export interface PurgeDeps {
  readonly persistence: PrunePersistenceLike
  /** Host `session.list` — the live-agent / restore-conflict authority. */
  readonly lister: SessionListerLike
  /** Read-only flock probe. Missing -> UNSUPPORTED, never an unlocked default. */
  readonly lockProbe?: LockProbe
  readonly now: number
  readonly opId: string
  /** Host-local HMAC secret provider; resolved once by the caller. */
  readonly secret: string
  /** Host-owned residence window in days (default 7). */
  readonly retentionDays: number
  /** Confirmation token lifetime in ms. */
  readonly tokenTtlMs: number
  /** Secret bootstrap entropy, injected so tests are deterministic. */
  readonly newSecret: () => string
  /** Host-side apply lock, acquired ONCE around prepare/purge. */
  readonly withApplyLock: <T>(fn: () => Promise<T>) => Promise<T>
}

export interface AppliedManifest {
  readonly id: string
  readonly to: string
  /** Original live session directory, written by apply; the live-path gate
   *  authority when the host backend can no longer stat a trashed session. */
  readonly from?: string
  readonly opId: string
  readonly appliedAt: number
}

export interface PurgeCandidate {
  readonly id: string
  readonly encoded: string
  readonly run: string
  /** Host-derived canonical path; never a client path. */
  readonly path: string
  readonly appliedAt: number
  readonly ageDays: number
  readonly manifest: AppliedManifest
}

export interface PurgeRejection {
  readonly path: string
  readonly id?: string
  readonly code: PurgeErrorCode
  readonly message: string
}

// ---------------------------------------------------------------------------
// Server-issued confirmation token.
// ---------------------------------------------------------------------------

export interface PurgeTokenPayload {
  readonly v: 1
  readonly opId: string
  /** Sorted id set, aligned index-by-index with `paths`. */
  readonly ids: readonly string[]
  readonly paths: readonly string[]
  readonly root: string
  readonly retentionDays: number
  readonly issuedAt: number
  readonly expiresAt: number
  readonly nonce: string
}

/** Fixed key order so a client cannot reorder JSON to change the signature. */
export function canonicalTokenPayload(p: PurgeTokenPayload): string {
  return JSON.stringify([
    p.v, p.opId, [...p.ids], [...p.paths], p.root, p.retentionDays,
    p.issuedAt, p.expiresAt, p.nonce,
  ])
}

export interface IssuedToken {
  readonly token: string
  readonly payload: PurgeTokenPayload
}

export function issuePurgeToken(
  input: Omit<PurgeTokenPayload, 'v' | 'expiresAt'>,
  secret: string,
  ttlMs: number,
): IssuedToken {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) fail('BAD_PARAMS', 'tokenTtlMs must be positive')
  const payload: PurgeTokenPayload = {
    ...input,
    v: 1,
    expiresAt: input.issuedAt + ttlMs,
  }
  const body = Buffer.from(canonicalTokenPayload(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret).update(body).digest('hex')
  return { token: `${body}.${sig}`, payload }
}

export function verifyPurgeToken(token: unknown, secret: string, now: number): PurgeTokenPayload {
  if (typeof token !== 'string' || token === '') fail('BAD_TOKEN', 'purge requires a server-issued token')
  const parts = token.split('.')
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') fail('BAD_TOKEN', 'malformed purge token')
  const expected = createHmac('sha256', secret).update(parts[0]).digest()
  const actual = Buffer.from(parts[1], 'hex')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    fail('BAD_TOKEN', 'purge token signature mismatch')
  }
  let raw: unknown = undefined
  try {
    raw = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
  } catch {
    // A non-decodable payload fails the shape gate below.
  }
  if (!Array.isArray(raw) || raw.length !== 9 || raw[0] !== 1) fail('BAD_TOKEN', 'purge token payload shape mismatch')
  const [v, opId, ids, paths, root, retentionDays, issuedAt, expiresAt, nonce] = raw as [
    number, string, string[], string[], string, number, number, number, string,
  ]
  if (
    typeof opId !== 'string' || !Array.isArray(ids) || !Array.isArray(paths) ||
    ids.some((id) => typeof id !== 'string') || paths.some((p) => typeof p !== 'string') ||
    ids.length !== paths.length ||
    typeof root !== 'string' || typeof retentionDays !== 'number' ||
    typeof issuedAt !== 'number' || typeof expiresAt !== 'number' ||
    typeof nonce !== 'string'
  ) {
    fail('BAD_TOKEN', 'purge token payload fields are invalid')
  }
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) fail('BAD_TOKEN', 'purge token timestamps are invalid')
  if (issuedAt > now + 1_000) fail('STALE_TOKEN', 'purge token issued in the future')
  if (now >= expiresAt) fail('STALE_TOKEN', 'purge token expired')
  return { v: 1, opId, ids, paths, root, retentionDays, issuedAt, expiresAt, nonce }
}

/** Host-local signing secret: read from `<trash>/.purge.secret`, bootstrap on
 *  first use with `wx`, and re-read on a create race. Never exposed on the wire. */
export async function resolvePurgeSecret(fs: PurgeFsLike, dshHome: string, newSecret: () => string): Promise<string> {
  const path = join(trashRoot(dshHome), '.purge.secret')
  try {
    const value = (await fs.readFile(path)).trim()
    if (value !== '') return value
    fail('INTERNAL', 'purge secret file is empty')
  } catch (err) {
    if (err instanceof PurgeError) throw err
    if (errorCode(err) !== 'ENOENT') throw err
  }
  await fs.mkdir(trashRoot(dshHome), { recursive: true, mode: 0o700 })
  try {
    await fs.writeFile(path, newSecret(), { flag: 'wx', mode: 0o600 })
  } catch (err) {
    if (errorCode(err) !== 'EEXIST') throw err
  }
  const value = (await fs.readFile(path)).trim()
  if (value === '') fail('INTERNAL', 'purge secret file is empty')
  return value
}

// ---------------------------------------------------------------------------
// Candidate assessment — the full gate set, re-runnable at any time.
// ---------------------------------------------------------------------------

function readLocationPath(location: SessionPruneSnapshot['location']): string | undefined {
  if (typeof location === 'string') return location || undefined
  if (location !== null && typeof location === 'object' && typeof location.path === 'string') return location.path || undefined
  return undefined
}

const RUN_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/
const ARTIFACT_FILENAME = 'session.v4.jsonl.zstd'
/** Apply's same-run manifest is a FILE inside the run dir, not a trash entry. */
const RUN_MANIFEST_FILENAME = 'manifest.jsonl'

type ZstdDecompress = (frame: Buffer) => Buffer

/** Bun's zstd decoder validates the frame body; the node:zlib shim is a fallback. */
function zstdDecompress(frame: Buffer): Buffer {
  const bun = (globalThis as { Bun?: { zstdDecompressSync?: ZstdDecompress } }).Bun
  if (bun?.zstdDecompressSync !== undefined) return bun.zstdDecompressSync(frame)
  return nodeZstdDecompressSync(frame)
}

/**
 * Read `header.id` from the FIRST line of the trash artifact itself. After
 * apply's rename, the live `sessionPersistence.stat(id)` returns undefined, so
 * the artifact is the only header authority for purge. The id is cross-checked
 * against the manifest id and the encoded basename by the caller, so a tampered
 * manifest or a renamed directory cannot make an unrelated artifact purgeable.
 */
async function readTrashArtifactHeaderId(fs: PurgeFsLike, dir: string): Promise<string> {
  const artifact = join(dir, ARTIFACT_FILENAME)
  let frame: Buffer
  try {
    frame = await fs.readFileBuffer(artifact)
  } catch {
    fail('BAD_MANIFEST', 'trash entry has no readable session artifact')
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
  if (header === null || typeof header !== 'object') {
    fail('BAD_MANIFEST', 'trash session artifact header is not an object')
  }
  const id = (header as { id?: unknown }).id
  if (typeof id !== 'string' || id === '') {
    fail('BAD_MANIFEST', 'trash artifact header.id is missing')
  }
  return id
}

function parseAppliedManifest(text: string): AppliedManifest {
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
  if (typeof m.opId !== 'string' || m.opId === '') fail('BAD_MANIFEST', 'applied manifest opId is missing')
  if (typeof m.appliedAt !== 'number' || !Number.isFinite(m.appliedAt)) {
    fail('BAD_MANIFEST', 'applied manifest appliedAt is invalid')
  }
  return {
    id: m.id,
    to: m.to,
    ...(typeof m.from === 'string' && m.from !== '' ? { from: m.from } : {}),
    opId: m.opId,
    appliedAt: m.appliedAt,
  }
}

/** Identity fallback when the in-place `.applied.json` is absent (a restore
 *  that retired it but failed its reverse rename, or a crash after the apply
 *  manifest append). The row must be the host's `applied` record for THIS entry
 *  path; every other gate still cross-checks id, encoding, realpath and header. */
async function readRunManifestRow(fs: PurgeFsLike, manifestPath: string, entryPath: string): Promise<AppliedManifest> {
  let text: string
  try {
    text = await fs.readFile(manifestPath)
  } catch {
    fail('BAD_MANIFEST', 'trash entry has no in-place marker or same-run manifest')
  }
  for (const line of text.split('\n')) {
    if (line === '') continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row === null || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (r.phase !== 'applied' || r.to !== entryPath) continue
    return parseAppliedManifest(line)
  }
  fail('BAD_MANIFEST', 'no same-run manifest row matches this trash entry')
}

/**
 * Read the applied marker. All `detail` payloads are deliberately path-free:
 * the RPC handler forwards `detail` verbatim, so `dir`/`artifact` (absolute
 * host paths) and raw fs error messages must never appear here.
 */
async function readAppliedManifest(fs: PurgeFsLike, dir: string, runManifest?: string): Promise<AppliedManifest> {
  let text: string
  try {
    text = await fs.readFile(join(dir, '.applied.json'))
  } catch (err) {
    if (errorCode(err) === 'ENOENT' && runManifest !== undefined) return readRunManifestRow(fs, runManifest, dir)
    fail('BAD_MANIFEST', 'trash entry has no readable .applied.json')
  }
  return parseAppliedManifest(text)
}

async function probeLockForPurge(lockProbe: LockProbe | undefined, lockPath: string): Promise<void> {
  if (lockProbe === undefined) fail('UNSUPPORTED', 'lockProbe capability unavailable; purge refuses to assume unlocked')
  let result: LockProbeResult
  try {
    result = await lockProbe(lockPath)
  } catch {
    fail('LOCKED', 'lock probe threw; refusing to purge')
  }
  if (result.status === 'lock-held' || result.status === 'unknown') {
    // `status` is a fixed enum; `lockPath` is an absolute host path.
    fail('LOCKED', 'session.lock probe is not unlocked', { status: result.status })
  }
}

/** Re-derive and re-gate ONE trash entry. The path comes only from a host scan. */
export async function assessTrashEntry(
  fs: PurgeFsLike,
  deps: PurgeDeps,
  dshHome: string,
  run: string,
  encoded: string,
  liveIds: ReadonlyMap<string, 'LIVE_AGENT' | 'CONFLICT'>,
): Promise<PurgeCandidate> {
  if (deps.lockProbe === undefined) {
    fail('UNSUPPORTED', 'lockProbe capability unavailable; purge refuses to assume unlocked')
  }
  if (!RUN_NAME_RE.test(run)) fail('BAD_PATH', 'trash run directory name is not a UTC stamp', { run })
  const entryPath = join(trashSessionsRoot(dshHome), run, encoded)
  const st = await fs.lstat(entryPath)
  if (!st.isDirectory() || st.isSymbolicLink?.() === true) {
    fail('BAD_PATH', 'trash entry is not a real directory')
  }
  const manifest = await readAppliedManifest(fs, entryPath, join(trashSessionsRoot(dshHome), run, RUN_MANIFEST_FILENAME))
  if (encodeSegment(manifest.id) !== encoded || basename(entryPath) !== encoded) {
    fail('BAD_MANIFEST', 'manifest id does not encode to the entry basename', { id: manifest.id })
  }
  // The manifest `to` must agree with the host-derived location; a `..` or an
  // absolute outside path is rejected before any realpath/delete.
  const toRel = relative(trashSessionsRoot(dshHome), manifest.to)
  if (!isAbsolute(manifest.to) || toRel.startsWith('..') || isAbsolute(toRel)) {
    fail('BAD_MANIFEST', 'applied manifest to escapes the trash sessions root')
  }
  const expectedRel = join(run, encoded)
  if (toRel !== expectedRel && toRel !== expectedRel.split(sep).join('/')) {
    fail('BAD_MANIFEST', 'applied manifest to does not match the scanned entry', { expectedRel })
  }
  const trashReal = await fs.realpath(trashSessionsRoot(dshHome))
  const real = await fs.realpath(entryPath)
  if (!isInside(trashReal, real) || relative(trashReal, real) !== expectedRel) {
    fail('BAD_PATH', 'trash entry realpath escaped the sessions trash root')
  }

  const liveState = liveIds.get(manifest.id)
  if (liveState === 'LIVE_AGENT') {
    fail('LIVE_AGENT', 'purge refused: a live agent still owns this session id', { id: manifest.id })
  }
  if (liveState === 'CONFLICT') {
    fail('CONFLICT', 'purge refused: session.id exists outside trash (restore conflict)', { id: manifest.id })
  }
  // The header comes from the TRASH ARTIFACT, not from live persistence: the
  // host backend cannot stat a session after apply renamed it into trash.
  const artifactHeaderId = await readTrashArtifactHeaderId(fs, entryPath)
  if (artifactHeaderId !== manifest.id) {
    fail('BAD_MANIFEST', 'trash artifact header.id mismatch', { id: manifest.id, artifactHeaderId })
  }
  // Persistence is consulted only for an OPTIONAL live-path hint, never to
  // validate a header. `undefined` (the normal trashed state) is expected.
  // The authoritative original live path is the apply-written manifest `from`,
  // so the collision gate still works when the host backend cannot stat the
  // trashed id at all.
  let liveSnapshot: SessionPruneSnapshot | undefined
  try {
    liveSnapshot = await deps.persistence.stat(manifest.id)
  } catch {
    // An optional hint must never gate a purge: a recreated/corrupt live
    // artifact can make the backend throw. The manifest `from` gate below
    // is authoritative and still decides CONFLICT.
    liveSnapshot = undefined
  }
  const hintedPath = readLocationPath(liveSnapshot?.location)
  const originalPath = manifest.from === undefined ? undefined : join(manifest.from, ARTIFACT_FILENAME)
  for (const livePath of [hintedPath, originalPath]) {
    if (livePath === undefined || livePath === entryPath) continue
    try {
      await fs.lstat(livePath)
      fail('CONFLICT', 'purge refused: live path for this id exists again', { id: manifest.id })
    } catch (err) {
      if (err instanceof PurgeError) throw err
      if (errorCode(err) !== 'ENOENT') throw err
    }
  }

  const ageDays = (deps.now - manifest.appliedAt) / MS_PER_DAY
  if (!Number.isFinite(deps.retentionDays) || deps.retentionDays < 0) {
    fail('BAD_PARAMS', 'host purge retentionDays is invalid')
  }
  if (ageDays < deps.retentionDays) {
    fail('FRESH', 'trash entry has not served the residence window', { id: manifest.id, ageDays, retentionDays: deps.retentionDays })
  }

  await probeLockForPurge(deps.lockProbe, join(entryPath, 'session.lock'))
  return {
    id: manifest.id,
    encoded,
    run,
    path: real,
    appliedAt: manifest.appliedAt,
    ageDays,
    manifest,
  }
}

async function readLiveIds(deps: PurgeDeps): Promise<Map<string, 'LIVE_AGENT' | 'CONFLICT'>> {
  const listing = await listAllSessions(deps.lister)
  if (listing.truncated) fail('BLOCKED', 'purge aborted: session.list roster is incomplete', { pages: listing.pages })
  const ids = new Map<string, 'LIVE_AGENT' | 'CONFLICT'>()
  for (const row of listing.rows) {
    const raw = (row as { sessionId?: unknown }).sessionId
    if (raw === undefined || raw === null) continue
    const id = String(raw)
    if ((row as { agentAvailable?: unknown }).agentAvailable === true) {
      ids.set(id, 'LIVE_AGENT')
    } else if (!ids.has(id)) {
      ids.set(id, 'CONFLICT')
    }
  }
  return ids
}

export interface PurgeScan {
  readonly candidates: PurgeCandidate[]
  readonly rejected: PurgeRejection[]
}

/** Enumerate ONLY `<dshHome>/trash/sessions/<UTC>/<encoded>` leaves. */
export async function scanPurgeCandidates(
  fs: PurgeFsLike,
  deps: PurgeDeps,
  dshHome: string,
  liveIds: ReadonlyMap<string, 'LIVE_AGENT' | 'CONFLICT'>,
): Promise<PurgeScan> {
  const root = trashSessionsRoot(dshHome)
  let runs: string[]
  try {
    runs = await fs.readdir(root)
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return { candidates: [], rejected: [] }
    throw err
  }
  const candidates: PurgeCandidate[] = []
  const rejected: PurgeRejection[] = []
  for (const run of runs) {
    let entries: string[]
    try {
      entries = await fs.readdir(join(root, run))
    } catch (err) {
      if (errorCode(err) === 'ENOENT') continue
      rejected.push({ path: join(root, run), code: 'INTERNAL', message: purgeWireMessage(err) })
      continue
    }
    for (const encoded of entries) {
      if (encoded.startsWith('.') || encoded === RUN_MANIFEST_FILENAME) continue
      try {
        candidates.push(await assessTrashEntry(fs, deps, dshHome, run, encoded, liveIds))
      } catch (err) {
        rejected.push({
          path: join(root, run, encoded),
          code: err instanceof PurgeError ? err.code : 'INTERNAL',
          message: purgeWireMessage(err),
        })
      }
    }
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id))
  return { candidates, rejected }
}

// ---------------------------------------------------------------------------
// Recursive delete that never follows a symlink and never leaves the root.
// ---------------------------------------------------------------------------

async function removeNode(fs: PurgeFsLike, path: string, rootReal: string): Promise<void> {
  const st = await fs.lstat(path)
  if (st.isSymbolicLink?.() === true) {
    await fs.unlink(path)
    return
  }
  if (st.isDirectory()) {
    const real = await fs.realpath(path)
    if (!isInside(rootReal, real)) fail('BAD_PATH', 'delete target escaped the trash session directory')
    for (const child of await fs.readdir(path)) {
      await removeNode(fs, join(path, child), rootReal)
    }
    await fs.rmdir(path)
    return
  }
  await fs.unlink(path)
}

/** Remove exactly one validated trash session directory, no symlink follow. */
export async function removeTrashTree(fs: PurgeFsLike, candidate: PurgeCandidate): Promise<void> {
  const st = await fs.lstat(candidate.path)
  if (!st.isDirectory() || st.isSymbolicLink?.() === true) {
    fail('BAD_PATH', 'delete target flipped to symlink/non-directory')
  }
  const real = await fs.realpath(candidate.path)
  if (real !== candidate.path) fail('BAD_PATH', 'delete target realpath changed')
  await removeNode(fs, candidate.path, real)
}

// ---------------------------------------------------------------------------
// Manifest (crash record) + replay guard.
// ---------------------------------------------------------------------------

export function purgeManifestPath(dshHome: string, opId: string): string {
  return join(trashJournalRoot(dshHome), `purge-${opId}.jsonl`)
}

function usedTokenPath(dshHome: string, token: string): string {
  return join(trashJournalRoot(dshHome), 'purge-tokens', `${sha256(token)}.used`)
}

/** Single-use guard: `wx` claim, EEXIST means the token was already consumed. */
async function claimToken(fs: PurgeFsLike, dshHome: string, token: string, payload: PurgeTokenPayload, now: number): Promise<void> {
  await fs.mkdir(join(trashJournalRoot(dshHome), 'purge-tokens'), { recursive: true, mode: 0o700 })
  try {
    await fs.writeFile(usedTokenPath(dshHome, token), JSON.stringify({
      opId: payload.opId, issuedAt: payload.issuedAt, claimedAt: now, tokenHash: sha256(token),
    }), { flag: 'wx', mode: 0o600 })
  } catch (err) {
    if (errorCode(err) === 'EEXIST') fail('REPLAY', 'purge token already consumed', { opId: payload.opId })
    throw err
  }
}

async function appendManifest(
  fs: PurgeFsLike,
  dshHome: string,
  opId: string,
  row: Record<string, unknown>,
): Promise<void> {
  await fs.appendFile(purgeManifestPath(dshHome, opId), JSON.stringify(row) + '\n')
}

/**
 * Read a crash manifest and mark intent rows that never reached `done`.
 * Recovery NEVER retries a delete — it only writes a marker for a human.
 */
export async function recoverPurgeIntents(fs: PurgeFsLike, dshHome: string): Promise<string[]> {
  const journal = trashJournalRoot(dshHome)
  let files: string[]
  try {
    files = await fs.readdir(journal)
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return []
    throw err
  }
  const marked: string[] = []
  for (const file of files) {
    if (!file.startsWith('purge-') || !file.endsWith('.jsonl')) continue
    const full = join(journal, file)
    let text: string
    try {
      text = await fs.readFile(full)
    } catch {
      continue
    }
    const done = new Set<string>()
    const intents = new Map<string, { path: string; id: string }>()
    for (const line of text.split('\n')) {
      if (line === '') continue
      let row: { phase?: unknown; path?: unknown; id?: unknown }
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      const key = typeof row.path === 'string' ? row.path : ''
      if (row.phase === 'done' && key !== '') done.add(key)
      if (row.phase === 'intent' && key !== '' && typeof row.id === 'string') {
        intents.set(key, { path: key, id: row.id })
      }
    }
    for (const [path, intent] of intents) {
      if (done.has(path)) continue
      const marker = `${path}.purge-crash.json`
      try {
        await fs.writeFile(marker, JSON.stringify({
          markedAt: Date.now(), reason: 'purge-intent-without-done', id: intent.id, path,
        }), { flag: 'wx', mode: 0o600 })
        marked.push(marker)
      } catch (err) {
        if (errorCode(err) !== 'EEXIST') throw err
      }
    }
  }
  return marked
}

// ---------------------------------------------------------------------------
// RPC phases.
// ---------------------------------------------------------------------------

/**
 * First-ever purge: `<dshHome>/trash/sessions` does not exist yet. `realpath`
 * would throw ENOENT and surface as INTERNAL; fall back to the host-derived
 * lexical root so prepare can return a valid EMPTY preparation. The token is
 * still bound to the host-derived path — no client input reaches it.
 */
async function purgeRootForToken(fs: PurgeFsLike, dshHome: string): Promise<string> {
  const root = trashSessionsRoot(dshHome)
  try {
    return await fs.realpath(root)
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return root
    throw err
  }
}

export interface PurgePrepareResult {
  readonly opId: string
  readonly candidates: PurgeCandidate[]
  readonly rejected: PurgeRejection[]
  readonly token: string
  readonly tokenPayload: PurgeTokenPayload
}

/**
 * Read-only prepare: re-derive eligible trash entries and issue a signed token
 * bound to the exact set. No delete occurs here.
 */
export async function preparePurge(fs: PurgeFsLike, deps: PurgeDeps, dshHome: string): Promise<PurgePrepareResult> {
  return deps.withApplyLock(async () => {
    const liveIds = await readLiveIds(deps)
    const scan = await scanPurgeCandidates(fs, deps, dshHome, liveIds)
    const root = await purgeRootForToken(fs, dshHome)
    const issued = issuePurgeToken({
      opId: deps.opId,
      ids: scan.candidates.map((c) => c.id),
      paths: scan.candidates.map((c) => c.path),
      root,
      retentionDays: deps.retentionDays,
      issuedAt: deps.now,
      nonce: `${deps.opId}:${deps.newSecret()}`,
    }, deps.secret, deps.tokenTtlMs)
    return {
      opId: deps.opId,
      candidates: scan.candidates,
      rejected: scan.rejected,
      token: issued.token,
      tokenPayload: issued.payload,
    }
  })
}

export interface PurgePurgedEntry {
  readonly id: string
  readonly path: string
}

export interface PurgeFailureEntry {
  readonly id?: string
  readonly path?: string
  readonly code: PurgeErrorCode
  readonly message: string
}

export interface PurgeResult {
  readonly opId: string
  readonly purged: PurgePurgedEntry[]
  readonly failed: PurgeFailureEntry[]
  readonly manifestPath: string
}

/**
 * Commit a prepared purge. The token is verified, the entire candidate set is
 * recomputed from host state, and every gate is re-probed immediately before
 * each delete. A failure is recorded per entry; siblings still proceed.
 */
export async function purgeTrashSessions(
  fs: PurgeFsLike,
  deps: PurgeDeps,
  dshHome: string,
  token: unknown,
): Promise<PurgeResult> {
  return deps.withApplyLock(async () => {
    const payload = verifyPurgeToken(token, deps.secret, deps.now)
    if (payload.v !== 1) fail('BAD_TOKEN', 'unsupported purge token version')
    const liveIds = await readLiveIds(deps)
    const scan = await scanPurgeCandidates(fs, deps, dshHome, liveIds)
    const root = await purgeRootForToken(fs, dshHome)
    if (root !== payload.root || payload.retentionDays !== deps.retentionDays) {
      // `root` / `payload.root` are absolute host paths: keep them out of the
      // wire `detail` (the RPC handler forwards it verbatim).
      fail('STALE_TOKEN', 'host trash root or retention policy changed since prepare', {
        retentionDays: deps.retentionDays,
      })
    }
    // Delete set is a SUBSET of the token set: only id+path pairs the server
    // signed may be deleted, and every one is re-gated below. A candidate that
    // became ineligible (or a new candidate that appeared) is a per-entry
    // outcome, NEVER a reason to skip a sibling (partial failures do not abort
    // the batch). A root/policy change is the only global stale failure.
    const byId = new Map(scan.candidates.map((c) => [c.id, c]))
    const rejectedByPath = new Map(scan.rejected.map((r) => [r.path, r]))
    await claimToken(fs, dshHome, String(token), payload, deps.now)

    const purged: PurgePurgedEntry[] = []
    const failed: PurgeFailureEntry[] = []
    const manifestPath = purgeManifestPath(dshHome, payload.opId)
    for (let i = 0; i < payload.ids.length; i++) {
      const id = payload.ids[i]
      const tokenPath = payload.paths[i]
      const candidate = byId.get(id)
      if (candidate === undefined || candidate.path !== tokenPath) {
        const rejection = rejectedByPath.get(tokenPath)
        failed.push({
          id,
          path: tokenPath,
          code: rejection?.code ?? 'STALE_TOKEN',
          message: rejection?.message ?? 'candidate disappeared or moved after token verification',
        })
        continue
      }
      try {
        // Full gate re-probe at the last safe point before the mutation.
        const fresh = await assessTrashEntry(fs, deps, dshHome, candidate.run, candidate.encoded, liveIds)
        if (fresh.path !== tokenPath) fail('STALE_TOKEN', 'candidate realpath moved after token verification', { id })
        await appendManifest(fs, dshHome, payload.opId, {
          phase: 'intent', opId: payload.opId, id: fresh.id, path: fresh.path,
          at: deps.now, tokenHash: sha256(String(token)),
        })
        await removeTrashTree(fs, fresh)
        await appendManifest(fs, dshHome, payload.opId, {
          phase: 'done', opId: payload.opId, id: fresh.id, path: fresh.path, at: deps.now,
        })
        purged.push({ id: fresh.id, path: fresh.path })
      } catch (err) {
        failed.push({
          id: candidate.id,
          path: candidate.path,
          code: err instanceof PurgeError ? err.code : 'DELETE_FAILED',
          message: purgeWireMessage(err),
        })
      }
    }
    return { opId: payload.opId, purged, failed, manifestPath }
  })
}
