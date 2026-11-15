// Pure scanning core of the text-leak audit — no side effects, no I/O beyond
// the explicit loaders. Extracted so the reverse canary unit test
// (packages/tui-base/test/text-leak-canary.test.tsx) exercises THE SAME scan
// the audit gates with, instead of a drifting copy of the regex.

import { readFileSync } from 'node:fs'

/** Fail-open leak shape: `overlay.widgets.frameTitle` — lower-camel head, dotted
 * segments, nothing but letters/digits/_/- inside. The dotted shape alone is
 * NOT a leak (host rows, paths); the dictionary membership decides. */
export const KEY_SHAPE = /[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]+)+/g

export const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g
export const stripAnsi = (s) => String(s).replace(ANSI_RE, '')

/**
 * Dotted key-shaped tokens of one frame (ANSI stripped). False-positive safe:
 * a token only becomes a FAIL if it equals a declared locale key.
 */
export const keyShapedTokens = (ansiFrame) => {
  const plain = stripAnsi(ansiFrame)
  const tokens = new Set()
  for (const m of plain.matchAll(KEY_SHAPE)) tokens.add(m[0])
  return [...tokens]
}

/** String entries of one locale JSON file (the gate only needs string values). */
export const loadTable = (file) => {
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  return Object.entries(raw).filter(([, v]) => typeof v === 'string')
}

/**
 * The gate dictionary: a key is a leak candidate if it is declared in EITHER
 * table (a zh-only key leaking through the en fallback chain is the same bug).
 * Loaded direct from the locale sources, NOT through the app's registry —
 * the gate must stay independent of the code it polices.
 */
export const loadDictionary = (localesDir, files = ['en.json', 'zh-CN.json']) => {
  const tables = Object.fromEntries(files.map((f) => [f.replace(/\.json$/, ''), loadTable(`${localesDir}/${f}`)]))
  const keySet = new Set(Object.values(tables).flatMap((t) => t.map(([k]) => k)))
  return { tables, keySet }
}

/** The gate on one frame's text: dotted tokens that EQUAL a locale key. */
export const findKeyLeaks = (ansiFrame, keySet) =>
  keyShapedTokens(ansiFrame).filter((token) => keySet.has(token))
