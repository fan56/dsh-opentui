/**
 * Singleton host registry — schema v2 (ADR-0009 decisions 4 & 8;
 * DESIGN-redesign §7).
 *
 * File: `<DSH_HOME>/opentui-host.<profile>.json`
 *
 *   {
 *     version: 2, profile, home, pid, port,
 *     phase: "claim|booting|ready|stopping",
 *     startedAt, updatedAt, authority,
 *     clients: [{ id, pid, lastSeen }]
 *   }
 *
 * Invariants this module enforces:
 * - writes are ATOMIC (temp file in the same directory + rename); readers
 *   never observe a half-written record;
 * - the O_EXCL claim uses `link(2)` on a fully-written temp file, so exactly
 *   one of N concurrent claimers wins and a loser gets "occupied", never a
 *   clobbered winner;
 * - reads are SCHEMA-VALIDATED: a v2 record is returned typed; an old record
 *   (no `version` / no `clients`) is tagged `legacy`; garbage is `invalid`;
 * - stale detection and legacy cleanup NEVER signal a process
 *   (`safeClearLegacy` only unlinks the registry FILE). Killing a host needs
 *   the three-evidence rule in ADR-0009 decision 8 and belongs to a later
 *   task — this module deliberately has no `process.kill` call.
 *
 * Reuse: the schema is a superset of the existing v1 lockfile handled by
 * `lifecycle.ts` (`{ pid, port, authority, startedAt, profile }`), which is
 * exactly the `legacy` shape detected here. The default liveness probe
 * delegates to `lifecycle.pidAlive`. No existing export or behavior in
 * lifecycle.ts is changed by this module.
 *
 * Filesystem and clock are injectable seams so concurrency / stale / legacy
 * cases are unit-testable without touching the real HOME or spawning a host.
 */

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { pidAlive as defaultPidAlive } from './lifecycle.ts'

/** Current registry schema version. */
export const REGISTRY_SCHEMA_VERSION = 2

/** Lifecycle phases a v2 registry may record. */
export const REGISTRY_PHASES = ['claim', 'booting', 'ready', 'stopping'] as const
export type RegistryPhase = (typeof REGISTRY_PHASES)[number]

/** One attached client recorded in the registry. */
export interface RegistryClient {
  id: string
  pid: number
  /** ISO timestamp of the last heartbeat. */
  lastSeen: string
}

/** A validated schema-v2 host registry record. */
export interface HostRegistryV2 {
  version: 2
  profile: string
  home: string
  pid: number
  port: number
  phase: RegistryPhase
  startedAt: string
  updatedAt: string
  authority: string
  clients: RegistryClient[]
}

/** The shape of a pre-v2 (legacy) lockfile — kept for callers that migrate. */
export interface LegacyRegistry {
  pid: number
  port: number
  authority?: string
  startedAt?: string
  profile?: string
  booting?: boolean
}

/** Tagged result of reading + validating a registry file. */
export type RegistryReadResult =
  | { kind: 'v2'; value: HostRegistryV2 }
  | { kind: 'legacy'; raw: LegacyRegistry }
  | { kind: 'invalid'; raw: unknown; reason: string }
  | { kind: 'missing' }

// ---------------------------------------------------------------------------
// Injectable seams.
// ---------------------------------------------------------------------------

/** The slice of `node:fs` this module needs (injectable in tests). */
export interface RegistryFs {
  existsSync(path: string): boolean
  mkdirSync(path: string, options?: { recursive?: boolean }): void
  readFileSync(path: string, encoding: 'utf8'): string
  writeFileSync(path: string, data: string, options?: { mode?: number }): void
  renameSync(from: string, to: string): void
  linkSync(from: string, to: string): void
  unlinkSync(path: string): void
}

/** Default filesystem: the real `node:fs`. */
export const nodeRegistryFs: RegistryFs = {
  existsSync: (path) => existsSync(path),
  mkdirSync: (path, options) => {
    mkdirSync(path, options)
  },
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  writeFileSync: (path, data, options) => {
    writeFileSync(path, data, options)
  },
  renameSync: (from, to) => renameSync(from, to),
  linkSync: (from, to) => linkSync(from, to),
  unlinkSync: (path) => unlinkSync(path),
}

// ---------------------------------------------------------------------------
// Path + construction + validation.
// ---------------------------------------------------------------------------

/** Absolute registry path for a `(home, profile)` — the v1 lockfile path. */
export function registryPath(home: string, profile: string): string {
  return join(home, `opentui-host.${profile}.json`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function nonEmpty(value: unknown): value is string {
  return isString(value) && value.trim() !== ''
}

function invalid(reason: string, raw: unknown): RegistryReadResult {
  return { kind: 'invalid', raw, reason }
}

/**
 * Validate a parsed JSON value into a tagged {@link RegistryReadResult}.
 * A record with `version === 2` is checked field-by-field; a record with no
 * version (or version 1) that still carries `pid`/`port` is `legacy`; anything
 * else is `invalid`. Pure — no filesystem access.
 */
export function validateRegistry(raw: unknown): RegistryReadResult {
  if (!isPlainObject(raw)) return invalid('registry is not an object', raw)

  if (raw.version === REGISTRY_SCHEMA_VERSION) {
    if (!nonEmpty(raw.profile)) return invalid('profile must be a non-empty string', raw)
    if (!nonEmpty(raw.home)) return invalid('home must be a non-empty string', raw)
    if (!isInteger(raw.pid) || raw.pid < 0) return invalid('pid must be a non-negative integer', raw)
    if (!isInteger(raw.port) || raw.port < 0 || raw.port > 65535) return invalid('port must be an integer in [0, 65535]', raw)
    if (!(REGISTRY_PHASES as readonly string[]).includes(raw.phase as string)) {
      return invalid(`phase must be one of ${REGISTRY_PHASES.join('|')}`, raw)
    }
    if (!nonEmpty(raw.startedAt)) return invalid('startedAt must be a non-empty string', raw)
    if (!nonEmpty(raw.updatedAt)) return invalid('updatedAt must be a non-empty string', raw)
    if (!isString(raw.authority)) return invalid('authority must be a string', raw)
    if (!Array.isArray(raw.clients)) return invalid('clients must be an array', raw)
    const clients: RegistryClient[] = []
    for (const [index, item] of raw.clients.entries()) {
      if (!isPlainObject(item)) return invalid(`clients[${index}] must be an object`, raw)
      if (!nonEmpty(item.id)) return invalid(`clients[${index}].id must be a non-empty string`, raw)
      if (!isInteger(item.pid) || item.pid < 0) return invalid(`clients[${index}].pid must be a non-negative integer`, raw)
      if (!nonEmpty(item.lastSeen)) return invalid(`clients[${index}].lastSeen must be a non-empty string`, raw)
      clients.push({ id: item.id, pid: item.pid, lastSeen: item.lastSeen })
    }
    return {
      kind: 'v2',
      value: {
        version: 2,
        profile: raw.profile,
        home: raw.home,
        pid: raw.pid,
        port: raw.port,
        phase: raw.phase as RegistryPhase,
        startedAt: raw.startedAt,
        updatedAt: raw.updatedAt,
        authority: raw.authority,
        clients,
      },
    }
  }

  // Any other explicit version is unsupported (not "legacy" — legacy is the
  // pre-version lockfile only).
  if (raw.version !== undefined) return invalid(`unsupported registry version ${String(raw.version)}`, raw)
  if (!isInteger(raw.pid) || !isInteger(raw.port)) {
    return invalid('legacy registry is missing pid/port', raw)
  }
  return {
    kind: 'legacy',
    raw: {
      pid: raw.pid,
      port: raw.port,
      ...(isString(raw.authority) ? { authority: raw.authority } : {}),
      ...(isString(raw.startedAt) ? { startedAt: raw.startedAt } : {}),
      ...(isString(raw.profile) ? { profile: raw.profile } : {}),
      ...(raw.booting === true ? { booting: true } : {}),
    },
  }
}

/** Build a well-formed v2 claim record (the O_EXCL placeholder content). */
export function createClaimRegistry(home: string, profile: string, pid: number, nowIso: string): HostRegistryV2 {
  return {
    version: 2,
    profile,
    home,
    pid,
    port: 0,
    phase: 'claim',
    startedAt: nowIso,
    updatedAt: nowIso,
    authority: '',
    clients: [],
  }
}

/** Copy a registry with a new `phase` / `updatedAt` (no in-place mutation). */
export function withPhase(reg: HostRegistryV2, phase: RegistryPhase, nowIso: string): HostRegistryV2 {
  return { ...reg, phase, updatedAt: nowIso }
}

/** Copy a registry with a new `updatedAt` (heartbeat / adoption bump). */
export function touchRegistry(reg: HostRegistryV2, nowIso: string): HostRegistryV2 {
  return { ...reg, updatedAt: nowIso }
}

// ---------------------------------------------------------------------------
// Read / atomic write.
// ---------------------------------------------------------------------------

/** Read + validate the registry file. Never throws — IO/JSON errors are tagged. */
export function readRegistryAt(path: string, fs: RegistryFs = nodeRegistryFs): RegistryReadResult {
  let text: string
  try {
    text = fs.readFileSync(path, 'utf8')
  } catch {
    return { kind: 'missing' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return invalid('registry file is not valid JSON', text)
  }
  return validateRegistry(raw)
}

/** Read + validate `<home>/opentui-host.<profile>.json`. */
export function readRegistry(home: string, profile: string, fs: RegistryFs = nodeRegistryFs): RegistryReadResult {
  return readRegistryAt(registryPath(home, profile), fs)
}

let writeSeq = 0

/**
 * Atomically write a v2 registry: serialize to a temp file in the same
 * directory, then rename over the target. On a rename error the temp file is
 * swept so no orphan accumulates. The record is validated first — callers
 * cannot persist a malformed v2 shape.
 */
export function writeRegistry(home: string, profile: string, record: HostRegistryV2, fs: RegistryFs = nodeRegistryFs): void {
  const checked = validateRegistry(record)
  if (checked.kind !== 'v2') {
    throw new Error(`writeRegistry: refusing to write invalid v2 record (${checked.kind === 'invalid' ? checked.reason : checked.kind})`)
  }
  fs.mkdirSync(home, { recursive: true })
  const path = registryPath(home, profile)
  const tmp = `${path}.tmp-${process.pid}-${++writeSeq}`
  fs.writeFileSync(tmp, JSON.stringify(checked.value, null, 2) + '\n')
  try {
    fs.renameSync(tmp, path)
  } catch (error) {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* nothing to sweep */
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Atomic claim / release (link(2) = O_EXCL).
// ---------------------------------------------------------------------------

export interface ClaimOptions {
  fs?: RegistryFs
  now?: () => number
  /** Claimer pid (default `process.pid`). Stored in the claim record. */
  pid?: number
}

export type ClaimResult =
  | { ok: true; token: string; path: string; registry: HostRegistryV2 }
  | { ok: false; reason: 'occupied'; path: string }

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code
}

/**
 * Atomically claim the registry as a `phase=claim` placeholder.
 *
 * The fully-written temp file is `link(2)`ed to the target: `link` fails with
 * EEXIST when the target already exists, so exactly one concurrent claimer
 * wins. Unlike `writeFileSync('wx')`-style approaches the placeholder content
 * is complete at creation — readers never see a partial claim.
 *
 * Returns `{ ok: false, reason: 'occupied' }` for a rival (a live claim OR an
 * existing v2 record); the existing file is never modified.
 */
export function claimRegistry(home: string, profile: string, options: ClaimOptions = {}): ClaimResult {
  const fs = options.fs ?? nodeRegistryFs
  const now = options.now ?? Date.now
  const pid = options.pid ?? process.pid
  const nowIso = new Date(now()).toISOString()
  fs.mkdirSync(home, { recursive: true })
  const path = registryPath(home, profile)
  const registry = createClaimRegistry(home, profile, pid, nowIso)
  const tmp = `${path}.claim-${process.pid}-${randomUUID()}`
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2) + '\n')
  try {
    fs.linkSync(tmp, path) // EEXIST when a rival holds the file
    return { ok: true, token: registry.startedAt, path, registry }
  } catch (error) {
    if (isErrno(error, 'EEXIST')) return { ok: false, reason: 'occupied', path }
    throw error
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* nothing to sweep */
    }
  }
}

export interface ReleaseClaimOptions {
  fs?: RegistryFs
}

/**
 * Remove a claim ONLY if the file still holds THIS claim (phase `claim`, same
 * claimer pid + startedAt token). Never removes a completed boot's real
 * record or a rival's newer claim. Returns whether anything was removed.
 */
export function releaseClaim(
  home: string,
  profile: string,
  claim: { pid: number; token: string },
  options: ReleaseClaimOptions = {},
): boolean {
  const fs = options.fs ?? nodeRegistryFs
  const path = registryPath(home, profile)
  const read = readRegistryAt(path, fs)
  if (read.kind !== 'v2') return false
  const value = read.value
  if (value.phase !== 'claim' || value.pid !== claim.pid || value.startedAt !== claim.token) return false
  fs.unlinkSync(path)
  return true
}

// ---------------------------------------------------------------------------
// Stale detection + safe legacy cleanup (NO process signalling).
// ---------------------------------------------------------------------------

export interface StaleDeps {
  now?: () => number
  /** Pid liveness probe. Default: `lifecycle.pidAlive`. */
  pidAlive?: (pid: number) => boolean
  /** Optional max age of `updatedAt` before a live-pid record is stale. */
  registryMaxAgeMs?: number
}

export type StaleReason = 'legacy-schema' | 'invalid-schema' | 'dead-pid' | 'registry-too-old'

export interface StaleVerdict {
  stale: boolean
  reasons: StaleReason[]
}

function looksLikeV2(value: RegistryReadResult | HostRegistryV2): value is HostRegistryV2 {
  // Narrow through an `unknown` candidate: applying isPlainObject() directly to
  // the tagged union keeps the {kind:'v2', value:...} branch in play, which has
  // no top-level `version` and fails the check. A raw HostRegistryV2 does.
  const candidate: unknown = value
  return isPlainObject(candidate) && candidate.version === REGISTRY_SCHEMA_VERSION
}

/**
 * Decide whether a registry is stale. Pure given the injected clock / pid
 * probe. Legacy and invalid records are stale by schema; a v2 record is stale
 * when its pid is dead (or, if `registryMaxAgeMs` is supplied, its `updatedAt`
 * is too old). A missing registry is not stale — it is simply free to claim.
 */
export function isRegistryStale(input: RegistryReadResult | HostRegistryV2, deps: StaleDeps = {}): StaleVerdict {
  const read: RegistryReadResult = looksLikeV2(input) ? { kind: 'v2', value: input } : input
  if (read.kind === 'missing') return { stale: false, reasons: [] }
  if (read.kind === 'legacy') return { stale: true, reasons: ['legacy-schema'] }
  if (read.kind === 'invalid') return { stale: true, reasons: ['invalid-schema'] }

  const reasons: StaleReason[] = []
  const alive = deps.pidAlive ?? defaultPidAlive
  if (!alive(read.value.pid)) reasons.push('dead-pid')
  if (deps.registryMaxAgeMs !== undefined) {
    const now = (deps.now ?? Date.now)()
    const updated = Date.parse(read.value.updatedAt)
    if (!Number.isNaN(updated) && now - updated > deps.registryMaxAgeMs) reasons.push('registry-too-old')
  }
  return { stale: reasons.length > 0, reasons }
}

/** Read a registry and classify staleness in one call (IO + injected seams). */
export function checkRegistryStale(
  home: string,
  profile: string,
  fs: RegistryFs = nodeRegistryFs,
  deps: StaleDeps = {},
): { read: RegistryReadResult; verdict: StaleVerdict } {
  const read = readRegistry(home, profile, fs)
  return { read, verdict: isRegistryStale(read, deps) }
}

export interface ClearLegacyResult {
  removed: boolean
  reason: 'legacy-removed' | 'not-legacy' | 'missing'
}

export interface SafeClearOptions {
  fs?: RegistryFs
  /** Pre-read registry (e.g. from `checkRegistryStale`) to avoid a second read. */
  read?: RegistryReadResult
}

/**
 * Remove a legacy registry FILE on first run of the new version.
 *
 * Accepts either a `(home, profile)` pair (reads the file itself) or a
 * pre-read registry via `options.read`. CONTRACT: this function only ever
 * unlinks the registry file. It NEVER signals or kills the legacy pid —
 * identifying and stopping that host needs the three-evidence rule
 * (ADR-0009 decision 8) and belongs to a later task. A v2 record (or a
 * missing/unreadable file) is left untouched.
 */
export function safeClearLegacy(home: string, profile: string, options: SafeClearOptions = {}): ClearLegacyResult {
  const fs = options.fs ?? nodeRegistryFs
  const path = registryPath(home, profile)
  const read = options.read ?? readRegistryAt(path, fs)
  if (read.kind === 'missing') return { removed: false, reason: 'missing' }
  if (read.kind !== 'legacy') return { removed: false, reason: 'not-legacy' }
  fs.unlinkSync(path) // file only — no process.kill anywhere in this module
  return { removed: true, reason: 'legacy-removed' }
}
