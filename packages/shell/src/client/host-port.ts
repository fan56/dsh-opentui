/**
 * Deterministic, cross-process-stable host port derivation (ADR-0009 decision
 * 3; DESIGN-redesign §3 step 1).
 *
 *   port = base + FNV-1a(canonical(home) + ":" + profile) % N
 *
 * The hash is a plain 32-bit FNV-1a over UTF-16 code units. It has no
 * per-process seed (unlike a JS object hash or Math.random), so two separate
 * processes derive the SAME port for the same `(home, profile)` pair — the
 * pre-condition for a shared, deterministic singleton registry.
 *
 * `canonical(home)` normalises the path text only (no filesystem access):
 * `node:path.resolve` for absolute paths / cwd-relative resolution, forward
 * slashes and lowercased drive letter on Windows. No `realpathSync` — a
 * symlink's physical path can differ between calls with a fresh mount, which
 * would break cross-process stability. Callers pass the already resolved
 * `DSH_HOME` (see `defaultDshHome` in lifecycle.ts).
 *
 * Conflict handling is the caller's job: `derivePort` gives the PREFERRED
 * port; `findFreePort` probes the `[derived, derived + N)` window and returns
 * the first free port. The caller pins that result into the registry so later
 * launches reuse it — the same window for every process keeps the choice
 * reproducible until it is actually taken.
 *
 * The TCP probe is injectable so unit tests never bind a real socket; the
 * default reuses `isListening` from lifecycle.ts (a bounded loopback connect).
 */

import { resolve } from 'node:path'
import { isListening } from './lifecycle.ts'

/** Default base of the deterministic port window (ADR-0009: 60000). */
export const DEFAULT_PORT_BASE = 60_000
/** Default size of the deterministic port window (ADR-0009: 1000). */
export const DEFAULT_PORT_COUNT = 1_000

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET_BASIS = 0x811c9dc5
/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193

/**
 * Normalise a home path into the exact string the port hash consumes.
 * Pure: no I/O, no `realpath`. Stable for the same textual path across runs.
 */
export function canonicalHome(home: string): string {
  const resolved = resolve(home)
  if (process.platform !== 'win32') return resolved
  // Windows: normalise separators + drive-letter case so `C:\x` and `c:/x`
  // hash identically even across processes with a different cwd spelling.
  return resolved
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_match, drive: string) => drive.toLowerCase() + ':')
}

/**
 * 32-bit FNV-1a over UTF-16 code units, returned as an unsigned integer.
 * `Math.imul` keeps the multiply in 32-bit space (a plain `*` would lose
 * precision above 2^53 and become platform-dependent).
 */
export function fnv1a32(text: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

export interface PortDerivationOptions {
  /** Window base. Default {@link DEFAULT_PORT_BASE}. */
  base?: number
  /** Window size. Default {@link DEFAULT_PORT_COUNT}. */
  count?: number
}

/**
 * The preferred port for `(home, profile)`: `base + hash % count`.
 * Deterministic across calls and processes for identical inputs.
 */
export function derivePort(home: string, profile: string, options: PortDerivationOptions = {}): number {
  const base = options.base ?? DEFAULT_PORT_BASE
  const count = options.count ?? DEFAULT_PORT_COUNT
  if (!Number.isInteger(base) || !Number.isInteger(count) || count <= 0) {
    throw new RangeError('derivePort: base and count must be integers and count > 0')
  }
  const offset = fnv1a32(`${canonicalHome(home)}:${profile}`) % count
  return base + offset
}

/** A TCP probe: `true` when the port is in use / already listening. */
export type PortOccupiedProbe = (port: number) => Promise<boolean>

export interface FindFreePortOptions extends PortDerivationOptions {
  /** Injectable occupancy probe. Default: `lifecycle.isListening` (bounded TCP connect). */
  probe?: PortOccupiedProbe
}

/** Thrown when every port in the derived window is occupied. */
export class NoFreePortError extends Error {
  readonly code = 'no-free-port'
  constructor(
    readonly home: string,
    readonly profile: string,
    readonly base: number,
    readonly count: number,
  ) {
    super(`no free port for ${profile} in [${base}, ${base + count}) under ${home}`)
    this.name = 'NoFreePortError'
  }
}

/**
 * Pick the actual port: start at the derived preference and walk the
 * `[derived, derived + count)` window, returning the first port the probe
 * reports free. The result is returned to the caller, which is responsible
 * for pinning it into the registry — this function never writes state.
 */
export async function findFreePort(home: string, profile: string, options: FindFreePortOptions = {}): Promise<number> {
  const base = options.base ?? DEFAULT_PORT_BASE
  const count = options.count ?? DEFAULT_PORT_COUNT
  if (!Number.isInteger(base) || !Number.isInteger(count) || count <= 0) {
    throw new RangeError('findFreePort: base and count must be integers and count > 0')
  }
  const derived = derivePort(home, profile, { base, count })
  const probe = options.probe ?? isListening
  for (let port = derived; port < derived + count; port++) {
    if (!(await probe(port))) return port
  }
  throw new NoFreePortError(home, profile, derived, count)
}
