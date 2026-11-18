/**
 * M3-03 — unit tests for the append-text provider.
 *
 * Every test builds its own temp DSH_HOME; the real ~/.dsh is never touched.
 * Covers the full acceptance matrix from the M3-03 inventory row / ADR-0010:140-142.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  APPEND_SYSTEM_PRESET_ID,
  APPEND_TEXT_MAX_BYTES,
  createAppendTextProvider,
} from '../src/append-text'
import type { AppendTextLogger, AppendTextProviderOptions } from '../src/append-text'
import { registerAppendSection } from '../src/append-section'
import type {
  BridgeContext,
  SystemPromptLike,
  SystemPromptSectionLike,
} from '../src/index'

const FNAME = 'APPEND_SYSTEM.md'

let dir: string
let filePath: string

function makeLogger() {
  const warnings: unknown[][] = []
  const noop = () => {}
  return {
    warnings,
    logger: {
      info: noop,
      warn: (...args: unknown[]) => { warnings.push(args) },
      error: noop,
      debug: noop,
    },
  }
}

/** Build a provider pinned to this test's temp home. */
function provider(extra: Omit<AppendTextProviderOptions, 'home'> = {}, logger?: AppendTextLogger) {
  return createAppendTextProvider({ home: dir, logger, ...extra })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-append-'))
  filePath = join(dir, FNAME)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('M3-03: createAppendTextProvider', () => {
  test('copied preset id matches the canonical shell constant (dedupe key)', () => {
    // packages/shell/src/client/append-system.ts:33 — kept in sync by hand.
    expect(APPEND_SYSTEM_PRESET_ID).toBe('opentui-append-system')
  })

  test('missing file -> empty string, no warning', () => {
    const { logger, warnings } = makeLogger()
    const text = provider({}, logger)
    expect(text({})).toBe('')
    expect(warnings).toHaveLength(0)
  })

  test('empty file -> empty string, no warning', () => {
    writeFileSync(filePath, '')
    const { logger, warnings } = makeLogger()
    expect(provider({}, logger)({})).toBe('')
    expect(warnings).toHaveLength(0)
  })

  test('normal content -> returned verbatim (incl. multibyte)', () => {
    const content = 'first line\n你好，世界 🌍\nlast line\n'
    writeFileSync(filePath, content, 'utf8')
    expect(provider()({})).toBe(content)
  })

  test('>64 KiB with a multibyte char straddling the cut -> UTF-8-boundary truncate + one log-only warn', () => {
    const { logger, warnings } = makeLogger()
    // 65535 ASCII bytes occupy offsets 0..65534. The 3-byte '中' then starts
    // exactly at offset 65535, so its continuation bytes straddle the 65536
    // cap — a byte slice would tear it in half.
    const ascii = 'a'.repeat(APPEND_TEXT_MAX_BYTES - 1)
    const content = ascii + '中' + 'x'.repeat(8)
    expect(Buffer.byteLength(content, 'utf8')).toBeGreaterThan(APPEND_TEXT_MAX_BYTES)
    writeFileSync(filePath, content, 'utf8')

    const text = provider({}, logger)
    const out = text({})
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(APPEND_TEXT_MAX_BYTES)
    expect(out).toBe(ascii)                 // cut landed exactly before the multibyte char
    expect(out).not.toContain('\uFFFD')     // no half character / replacement glyph
    expect(warnings).toHaveLength(1)        // one warn, to the logger only

    // mtime cache: a second read produces no extra warn and identical text.
    expect(text({})).toBe(ascii)
    expect(warnings).toHaveLength(1)
  })

  test('content changes with mtime pinned -> stale cached value (cache key is mtime only)', () => {
    const fixed = new Date('2020-01-01T00:00:00.000Z')
    writeFileSync(filePath, 'OLD', 'utf8')
    utimesSync(filePath, fixed, fixed)

    const text = provider()
    expect(text({})).toBe('OLD')

    // New content AND a different size, but mtime restored to the exact same
    // instant: the mtime-keyed cache must still return the old value.
    writeFileSync(filePath, 'A-MUCH-LONGER-NEW-CONTENT', 'utf8')
    utimesSync(filePath, fixed, fixed)
    expect(text({})).toBe('OLD')
  })

  test('mtime bump -> re-reads the new content', () => {
    const d1 = new Date('2020-01-01T00:00:00.000Z')
    const d2 = new Date('2020-01-01T00:01:00.000Z')
    writeFileSync(filePath, 'AAA', 'utf8')
    utimesSync(filePath, d1, d1)

    const text = provider()
    expect(text({})).toBe('AAA')

    writeFileSync(filePath, 'BBB', 'utf8')
    utimesSync(filePath, d2, d2)
    expect(text({})).toBe('BBB')
  })

  test('shouldSuppress()=true -> empty string even with file content (no disk read, no warn)', () => {
    writeFileSync(filePath, 'REAL-CONTENT', 'utf8')
    const { logger, warnings } = makeLogger()
    let calls = 0
    const text = provider({ shouldSuppress: () => { calls += 1; return true } }, logger)
    expect(text({})).toBe('')
    expect(calls).toBe(1)
    expect(warnings).toHaveLength(0)
  })

  test('shouldSuppress defaults to false -> normal content is returned', () => {
    writeFileSync(filePath, 'SHOWN', 'utf8')
    expect(provider()({})).toBe('SHOWN')
  })
})

describe('M3-03: registerAppendSection default wiring', () => {
  test('with no injected text it uses the real provider (temp home injected)', () => {
    writeFileSync(filePath, 'FROM-DEFAULT-PROVIDER', 'utf8')
    const { logger } = makeLogger()
    const sections: SystemPromptSectionLike[] = []
    const sp: SystemPromptLike = {
      section(spec) { sections.push(spec); return () => {} },
    }
    const ctx = {
      logger,
      effect: () => {},
      get: (name: string) => (name === 'systemPrompt' ? sp : undefined),
    } as unknown as BridgeContext

    registerAppendSection(ctx, { appendText: { home: dir } })

    expect(sections).toHaveLength(1)
    expect((sections[0]!.text as (c: unknown) => string)({})).toBe('FROM-DEFAULT-PROVIDER')
  })

  test('an explicit text still overrides the default provider', () => {
    writeFileSync(filePath, 'FROM-FILE', 'utf8')
    const { logger } = makeLogger()
    const sections: SystemPromptSectionLike[] = []
    const sp: SystemPromptLike = {
      section(spec) { sections.push(spec); return () => {} },
    }
    const ctx = {
      logger,
      effect: () => {},
      get: (name: string) => (name === 'systemPrompt' ? sp : undefined),
    } as unknown as BridgeContext

    registerAppendSection(ctx, {
      text: () => 'EXPLICIT',
      appendText: { home: dir },
    })
    expect((sections[0]!.text as (c: unknown) => string)({})).toBe('EXPLICIT')
  })
})
