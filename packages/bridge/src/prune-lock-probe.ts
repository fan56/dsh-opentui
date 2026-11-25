/**
 * retention P2 — read-only flock probe for `session.lock`.
 *
 * This module NEVER writes. The only file operation is `fs.open(path, 'r')`
 * (read-only descriptor) followed by the host addon's nonblocking
 * `tryLockExclusive(fd)`, an inode/dev recheck (`handle.stat()` vs
 * `stat(path)`) to defeat a lock-file swap between open and lock, and a
 * `finally close()` that releases the flock. There is NO `open('w')`, NO
 * `mkdir`, NO `SessionWriteLease.acquire` and no delete surface anywhere here.
 *
 * The addon is resolved DYNAMICALLY through `createRequire` — never a static
 * import — so a host without `@deepseek-ai/node-addon-system/flock` degrades
 * to "capability unavailable" instead of breaking the bridge bundle. Source
 * verified against the installed host (node-addon-system 0.1.2,
 * `lib/flock.d.ts`): `tryLockExclusive(fd: number): Promise<void>` resolves on
 * acquisition, rejects with EAGAIN/EWOULDBLOCK on contention, and never
 * opens/duplicates/closes the caller's descriptor.
 *
 * Error mapping (frozen for the planner):
 *  - EAGAIN / EWOULDBLOCK -> `lock-held` (a writer owns the lock)
 *  - ENOENT / ENOTDIR     -> `no-lock` (nothing to probe)
 *  - everything else      -> `unknown` (conservative skip)
 */

import { realpathSync } from 'node:fs'
import { open, stat as fsStat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { LockProbe, LockProbeResult } from './session-prune'

/** Structural slice of the host's `tryLockExclusive`. */
export type TryLockExclusive = (fd: number) => Promise<void>

export interface FileStatLike {
  readonly dev: number | bigint
  readonly ino: number | bigint
}

export interface FileHandleLike {
  readonly fd: number
  stat(): Promise<FileStatLike>
  close(): Promise<void>
}

/** Injectable read-only io seam so a unit test can drive every error branch
 *  without creating a real lock file. */
export interface LockProbeIo {
  open(path: string, flags: 'r'): Promise<FileHandleLike>
  stat(path: string): Promise<FileStatLike>
}

const defaultIo: LockProbeIo = {
  open(path: string): Promise<FileHandleLike> {
    return open(path, 'r')
  },
  stat(path: string): Promise<FileStatLike> {
    return fsStat(path)
  },
}

function errorCode(err: unknown): string | undefined {
  if (err === null || typeof err !== 'object') return undefined
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

let cachedTryLockExclusive: TryLockExclusive | undefined
let resolved = false

/**
 * Test seam ONLY — the bridge never calls this. Forces a deterministic
 * capability outcome for protocol tests (which have no host addon closure),
 * and is reset by the test cleanup so it cannot leak into a real plan.
 */
export function setFlockTryLockExclusiveForTest(fn: TryLockExclusive | undefined): void {
  resolved = true
  cachedTryLockExclusive = fn
}

/**
 * Resolve the host flock capability from the running dsh installation.
 * `extraRoots` is test-only (canary): when supplied it bypasses the cache and
 * takes precedence over the bundle/argv roots. A missing or malformed addon
 * returns `undefined` — never a fake probe, never a throw.
 */
export function resolveFlockTryLockExclusive(extraRoots: readonly string[] = []): TryLockExclusive | undefined {
  if (extraRoots.length === 0 && resolved) return cachedTryLockExclusive
  const roots: string[] = [...extraRoots, import.meta.url]
  if (process.argv[1]) {
    try {
      roots.push(realpathSync(process.argv[1]))
    } catch {
      /* argv[1] is not a filesystem path (test runner, REPL, ...) */
    }
  }
  let found: TryLockExclusive | undefined
  for (const root of roots) {
    try {
      const req = createRequire(root)
      const mod = req('@deepseek-ai/node-addon-system/flock') as Record<string, unknown>
      const fn = mod.tryLockExclusive
      if (typeof fn === 'function') {
        found = fn as TryLockExclusive
        break
      }
    } catch {
      /* this root has no host addon closure — try the next one */
    }
  }
  if (extraRoots.length === 0) {
    resolved = true
    cachedTryLockExclusive = found
  }
  return found
}

/** Build the injectable `LockProbe` from a resolved host `tryLockExclusive`. */
export function createPruneLockProbe(
  tryLockExclusive: TryLockExclusive,
  io: LockProbeIo = defaultIo,
): LockProbe {
  return async (lockPath: string): Promise<LockProbeResult> => {
    let handle: FileHandleLike | undefined
    try {
      // Read-only descriptor only. Never `open('w')`, never create the lock.
      try {
        handle = await io.open(lockPath, 'r')
      } catch (err) {
        const code = errorCode(err)
        return code === 'ENOENT' || code === 'ENOTDIR'
          ? { status: 'no-lock', detail: code }
          : { status: 'unknown', detail: code ?? 'open-failed' }
      }

      // The syscall runs in async work: keep the fd open until it settles.
      try {
        await tryLockExclusive(handle.fd)
      } catch (err) {
        const code = errorCode(err)
        if (code === 'EAGAIN' || code === 'EWOULDBLOCK') return { status: 'lock-held', detail: code }
        if (code === 'ENOENT' || code === 'ENOTDIR') return { status: 'no-lock', detail: code }
        return { status: 'unknown', detail: code ?? 'flock-failed' }
      }

      // TOCTOU recheck: the descriptor we locked must still be the file at
      // `lockPath`. A replaced inode/dev is `unknown`, never "unlocked".
      try {
        const opened = await handle.stat()
        const current = await io.stat(lockPath)
        if (opened.dev !== current.dev || opened.ino !== current.ino) {
          return { status: 'unknown', detail: 'lock-file-replaced' }
        }
      } catch (err) {
        return { status: 'unknown', detail: errorCode(err) ?? 'stat-failed' }
      }

      return { status: 'unlocked' }
    } finally {
      // Closing the descriptor releases the nonblocking exclusive flock; the
      // addon itself never closes or duplicates it.
      if (handle !== undefined) {
        try {
          await handle.close()
        } catch {
          /* best effort — a leaked fd cannot be turned into a prune */
        }
      }
    }
  }
}
