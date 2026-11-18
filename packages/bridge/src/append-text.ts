/**
 * M3-03 — append-system text provider.
 *
 * Reads `$DSH_HOME/APPEND_SYSTEM.md` lazily, caches by mtime, truncates at a
 * UTF-8 character boundary at 64 KiB (logger.warn only — the warning never
 * enters the message stream), and returns '' when deduped via `shouldSuppress`.
 *
 * Discipline: no `@deepseek-ai/*` import (ADR-0010 structural typing); Node
 * built-ins only. The text provider shape mirrors `SystemPromptSectionLike.text`
 * from index.ts (`(context) => string`).
 */

import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 64 KiB truncation cap pinned by ADR-0010:141. */
export const APPEND_TEXT_MAX_BYTES = 64 * 1024

/**
 * Synthetic preset id whose presence in a session's preset list means append
 * content was already injected via the legacy ride path — in that case the
 * section returns '' (dedupe, ADR-0010:142).
 *
 * COPIED VALUE (bridge must not import from packages/shell): the canonical
 * constant is `APPEND_SYSTEM_PRESET_ID` in
 * `packages/shell/src/client/append-system.ts:33`. Kept in sync by hand; M3-05
 * builds the real `shouldSuppress` predicate against this id.
 */
export const APPEND_SYSTEM_PRESET_ID = 'opentui-append-system'

/** Minimal logging surface; `ctx.logger` satisfies it. */
export interface AppendTextLogger {
  warn(format: unknown, ...params: unknown[]): void
}

export interface AppendTextProviderOptions {
  /** DSH_HOME override. Tests pass a temp dir; production uses defaultDshHome(). */
  home?: string
  /** Logger for the truncation warning (best-effort; warn-only). */
  logger?: AppendTextLogger
  /** Dedupe signal: true when the session's presets already contain
   *  APPEND_SYSTEM_PRESET_ID. Defaults to `() => false` (M3-05 wires the real one). */
  shouldSuppress?: () => boolean
  /** Byte cap override for tests; defaults to APPEND_TEXT_MAX_BYTES. */
  maxBytes?: number
}

/** The section's `text` provider: `(context) => string` (index.ts structural shape). */
export type AppendTextProvider = (context: unknown) => string

/** `$DSH_HOME` or `~/.dsh` — copied from `defaultDshHome()` in
 *  `packages/shell/src/client/append-system.ts:39` (empty DSH_HOME falls back). */
function defaultDshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function isContinuationByte(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0xc0) === 0x80
}

/**
 * Decode `buf` as UTF-8, cutting on a character boundary so no partial
 * multibyte sequence survives. When `buf.length > maxBytes`, step back from
 * byte `maxBytes` while that byte is a continuation byte: the first
 * non-continuation byte reached is a character boundary, and the character
 * beginning there (which would overrun the budget) is excluded.
 */
function decodeUtf8Capped(buf: Buffer, maxBytes: number): { text: string; truncated: boolean } {
  if (buf.length <= maxBytes) return { text: buf.toString('utf8'), truncated: false }
  let end = maxBytes
  while (end > 0 && isContinuationByte(buf[end])) end -= 1
  return { text: buf.toString('utf8', 0, end), truncated: true }
}

/**
 * Build the lazy, mtime-cached text provider.
 *
 * The cache key is mtime ONLY — deliberately not size, not a content hash.
 * This is the behavior pinned by the M3-03 tests / ADR-0010:140: content that
 * changes without an mtime bump keeps returning the cached value.
 */
export function createAppendTextProvider(options: AppendTextProviderOptions = {}): AppendTextProvider {
  const filePath = join(options.home ?? defaultDshHome(), 'APPEND_SYSTEM.md')
  const shouldSuppress = options.shouldSuppress ?? (() => false)
  const maxBytes = options.maxBytes ?? APPEND_TEXT_MAX_BYTES
  const logger = options.logger

  let cachedMtimeMs: number | undefined
  let cachedText = ''

  return (_context: unknown): string => {
    // Dedupe takes precedence: no disk I/O at all when already injected.
    if (shouldSuppress()) return ''

    let stat
    try {
      stat = statSync(filePath)
    } catch {
      return '' // missing / unreadable is the normal state on this machine
    }
    if (cachedMtimeMs !== undefined && stat.mtimeMs === cachedMtimeMs) return cachedText

    let text: string
    try {
      const buf = readFileSync(filePath)
      const decoded = decodeUtf8Capped(buf, maxBytes)
      text = decoded.text
      if (decoded.truncated) {
        try {
          logger?.warn(
            '[dsh-opentui-bridge] APPEND_SYSTEM.md exceeds %d bytes; truncated at UTF-8 boundary (kept %d bytes; warning is log-only)',
            maxBytes,
            Buffer.byteLength(text, 'utf8'),
          )
        } catch { /* logging is best-effort */ }
      }
    } catch {
      return '' // read failed: keep the previous cache, degrade silently
    }

    cachedMtimeMs = stat.mtimeMs
    cachedText = text
    return text
  }
}
