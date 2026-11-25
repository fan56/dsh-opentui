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
  let actual: Buffer
  try {
    actual = Buffer.from(parts[1], 'hex')
  } catch {
    fail('BAD_TOKEN', 'malformed purge token signature')
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    fail('BAD_TOKEN', 'purge token signature mismatch')
  }
  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
  } catch {
    fail('BAD_TOKEN', 'purge token payload is not decodable')
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
  return { v, opId, ids, paths, root, retentionDays, issuedAt, expiresAt, nonce }
}

/** Host-local signing secret: read from `<trash>/.purge.secret`, bootstrap on
 *  first use with `wx`, and re-read on a create race. Never exposed on the wire. */
export async function resolvePurgeSecret(fs: PurgeFsLike, dshHome: string, newSecret: () => string): Promise<string> {
  const path = join(trashRoot(dshHome), '.purge.secret')
  try {
    const value = (await fs.readFile(path)).trim()
    if (value !== '') return value
    fail('INTERNAL', 'purge secret file is empty', { path })
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
  if (value === '') fail('INTERNAL', 'purge secret file is empty', { path })
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

async function readAppliedManifest(fs: PurgeFsLike, dir: string): Promise<AppliedManifest> {
  let text: string
  try {
    text = await fs.readFile(join(dir, '.applied.json'))
  } catch (err) {
    fail('BAD_MANIFEST', 'trash entry has no readable .applied.json', { dir, code: errorCode(err) })
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    fail('BAD_MANIFEST', 'trash entry .applied.json is not JSON', { dir })
  }
  if (raw === null || typeof raw !== 'object') fail('BAD_MANIFEST', 'trash entry .applied.json is not an object', { dir })
  const m = raw as Record<string, unknown>
  if (typeof m.id !== 'string' || m.id === '') fail('BAD_MANIFEST', 'applied manifest id is missing', { dir })
  if (typeof m.to !== 'string' || m.to === '') fail('BAD_MANIFEST', 'applied manifest to is missing', { dir })
  if (typeof m.opId !== 'string' || m.opId === '') fail('BAD_MANIFEST', 'applied manifest opId is missing', { dir })
  if (typeof m.appliedAt !== 'number' || !Number.isFinite(m.appliedAt)) {
    fail('BAD_MANIFEST', 'applied manifest appliedAt is invalid', { dir })
  }
  return { id: m.id, to: m.to, opId: m.opId, appliedAt: m.appliedAt }
}

async function probeLockForPurge(lockProbe: LockProbe | undefined, lockPath: string): Promise<void> {
  if (lockProbe === undefined) fail('UNSUPPORTED', 'lockProbe capability unavailable; purge refuses to assume unlocked', { lockPath })
  let result: LockProbeResult
  try {
    result = await lockProbe(lockPath)
  } catch {
    fail('LOCKED', 'lock probe threw; refusing to purge', { lockPath })
  }
  if (result.status === 'lock-held' || result.status === 'unknown') {
    fail('LOCKED', 'session.lock probe is not unlocked', { lockPath, status: result.status })
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
    fail('BAD_PATH', 'trash entry is not a real directory', { entryPath })
  }
  const manifest = await readAppliedManifest(fs, entryPath)
  if (encodeSegment(manifest.id) !== encoded || basename(entryPath) !== encoded) {
    fail('BAD_MANIFEST', 'manifest id does not encode to the entry basename', { entryPath, id: manifest.id })
  }
  // The manifest `to` must agree with the host-derived location; a `..` or an
  // absolute outside path is rejected before any realpath/delete.
  const toRel = relative(trashSessionsRoot(dshHome), manifest.to)
  if (!isAbsolute(manifest.to) || toRel.startsWith('..') || isAbsolute(toRel)) {
    fail('BAD_MANIFEST', 'applied manifest to escapes the trash sessions root', { to: manifest.to })
  }
  const expectedRel = join(run, encoded)
  if (toRel !== expectedRel && toRel !== expectedRel.split(sep).join('/')) {
    fail('BAD_MANIFEST', 'applied manifest to does not match the scanned entry', { to: manifest.to, expectedRel })
  }
  const trashReal = await fs.realpath(trashSessionsRoot(dshHome))
  const real = await fs.realpath(entryPath)
  if (!isInside(trashReal, real) || relative(trashReal, real) !== expectedRel) {
    fail('BAD_PATH', 'trash entry realpath escaped the sessions trash root', { entryPath, real, trashReal })
  }

  const liveState = liveIds.get(manifest.id)
  if (liveState === 'LIVE_AGENT') {
    fail('LIVE_AGENT', 'purge refused: a live agent still owns this session id', { id: manifest.id })
  }
  if (liveState === 'CONFLICT') {
    fail('CONFLICT', 'purge refused: session.id exists outside trash (restore conflict)', { id: manifest.id })
  }
  const snapshot = await deps.persistence.stat(manifest.id)
  if (snapshot?.header?.id !== manifest.id) {
    fail('BAD_MANIFEST', 'fresh persistence header.id mismatch', { id: manifest.id })
  }
  const livePath = readLocationPath(snapshot?.location)
  if (livePath !== undefined && livePath !== entryPath) {
    try {
      await fs.lstat(livePath)
      fail('CONFLICT', 'purge refused: live path for this id exists again', { id: manifest.id, livePath })
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
      rejected.push({ path: join(root, run), code: 'INTERNAL', message: String(err) })
      continue
    }
    for (const encoded of entries) {
      if (encoded.startsWith('.')) continue
      try {
        candidates.push(await assessTrashEntry(fs, deps, dshHome, run, encoded, liveIds))
      } catch (err) {
        rejected.push({
          path: join(root, run, encoded),
          code: err instanceof PurgeError ? err.code : 'INTERNAL',
          message: err instanceof Error ? err.message : String(err),
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
    if (!isInside(rootReal, real)) fail('BAD_PATH', 'delete target escaped the trash session directory', { path, real })
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
    fail('BAD_PATH', 'delete target flipped to symlink/non-directory', { path: candidate.path })
  }
  const real = await fs.realpath(candidate.path)
  if (real !== candidate.path) fail('BAD_PATH', 'delete target realpath changed', { path: candidate.path, real })
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
    const root = await fs.realpath(trashSessionsRoot(dshHome))
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
    const root = await fs.realpath(trashSessionsRoot(dshHome))
    if (root !== payload.root || payload.retentionDays !== deps.retentionDays) {
      fail('STALE_TOKEN', 'host trash root or retention policy changed since prepare', {
        root, tokenRoot: payload.root, retentionDays: deps.retentionDays,
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
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return { opId: payload.opId, purged, failed, manifestPath }
  })
}
