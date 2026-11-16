// Pure retry-state logic for provisioning. No profile, no registry, no fs:
// the state file's text goes in, the skip decisions come out.
import { describe, expect, test } from 'bun:test'
import {
  BACKOFF_MS,
  MAX_ATTEMPTS,
  RESET_AFTER_MS,
  STATE_VERSION,
  emptyState,
  parseState,
  recordFailure,
  recordInstallOutcomes,
  recordSuccess,
  serializeState,
  shouldSkipRetry,
  summarizeSkips,
} from '../scripts/lib/provision-state.mjs'

const NAME = '@aiwayds/dsh-cron'
const PIN = '0.7.0'
const T0 = '2026-11-16T10:00:00.000Z'
const T1 = '2026-11-16T10:05:00.000Z'
const T_RESET = new Date(Date.parse(T0) + RESET_AFTER_MS).toISOString()

function entry(overrides = {}) {
  return { pin: PIN, attempts: 1, firstFailedAt: T0, lastFailedAt: T0, error: 'boom', ...overrides }
}

function stateWith(failures) {
  return { version: STATE_VERSION, failures }
}

describe('parseState', () => {
  test('accepts a well-formed state document', () => {
    const text = JSON.stringify(stateWith({ [NAME]: entry({ attempts: 2, lastFailedAt: T1 }) }))
    const parsed = parseState(text)
    expect(parsed).toEqual(stateWith({
      [NAME]: { pin: PIN, attempts: 2, firstFailedAt: T0, lastFailedAt: T1, error: 'boom' },
    }))
  })

  test('returns null for invalid JSON', () => {
    expect(parseState('{ not json')).toBeNull()
    expect(parseState('')).toBeNull()
  })

  test('returns null when the top level is an array', () => {
    expect(parseState('[]')).toBeNull()
    expect(parseState('[{"failures":{}}]')).toBeNull()
  })

  test('drops a malformed entry and keeps the rest', () => {
    const text = JSON.stringify(stateWith({
      [NAME]: entry(),
      '@aiwayds/broken': { pin: '', attempts: 1, firstFailedAt: T0, lastFailedAt: T0, error: '' },
      '@aiwayds/not-an-object': 'nope',
      '@aiwayds/no-timestamps': { pin: PIN, attempts: 1, error: '' },
    }))
    const parsed = parseState(text)
    expect(Object.keys(parsed.failures)).toEqual([NAME])
    expect(parsed.failures[NAME].attempts).toBe(1)
  })
})

describe('serializeState', () => {
  test('sorts failure keys and is byte-stable across runs', () => {
    const state = stateWith({
      '@aiwayds/zeta': entry(),
      '@aiwayds/alpha': entry({ pin: '1.2.3' }),
    })
    const text = serializeState(state)
    expect(text.endsWith('\n')).toBe(true)
    expect(text.indexOf('"@aiwayds/alpha"')).toBeLessThan(text.indexOf('"@aiwayds/zeta"'))
    expect(serializeState(state)).toBe(text)
    expect(serializeState(parseState(text))).toBe(text)
  })
})

describe('recordFailure', () => {
  test('records the first failure with attempts 1', () => {
    const next = recordFailure({ state: emptyState(), name: NAME, pin: PIN, now: T0, error: 'registry 404' })
    expect(next.failures[NAME]).toEqual({
      pin: PIN,
      attempts: 1,
      firstFailedAt: T0,
      lastFailedAt: T0,
      error: 'registry 404',
    })
  })

  test('increments attempts, keeps firstFailedAt, and advances lastFailedAt', () => {
    const first = recordFailure({ state: emptyState(), name: NAME, pin: PIN, now: T0, error: 'one' })
    const second = recordFailure({ state: first, name: NAME, pin: PIN, now: T1, error: 'two' })
    expect(second.failures[NAME]).toEqual({
      pin: PIN,
      attempts: 2,
      firstFailedAt: T0,
      lastFailedAt: T1,
      error: 'two',
    })
  })

  test('resets the history when the pin changes', () => {
    const first = recordFailure({ state: emptyState(), name: NAME, pin: PIN, now: T0, error: 'one' })
    const second = recordFailure({ state: first, name: NAME, pin: PIN, now: T1, error: 'two' })
    const moved = recordFailure({ state: second, name: NAME, pin: '0.7.1', now: T1, error: 'three' })
    expect(moved.failures[NAME]).toEqual({
      pin: '0.7.1',
      attempts: 1,
      firstFailedAt: T1,
      lastFailedAt: T1,
      error: 'three',
    })
  })

  test('starts a fresh round once the pin has been failing for RESET_AFTER_MS', () => {
    const first = recordFailure({ state: emptyState(), name: NAME, pin: PIN, now: T0, error: 'one' })
    const second = recordFailure({ state: first, name: NAME, pin: PIN, now: T1, error: 'two' })
    const reset = recordFailure({ state: second, name: NAME, pin: PIN, now: T_RESET, error: 'three' })
    expect(reset.failures[NAME]).toEqual({
      pin: PIN,
      attempts: 1,
      firstFailedAt: T_RESET,
      lastFailedAt: T_RESET,
      error: 'three',
    })
  })

  test('flattens newlines and truncates the error to 200 characters', () => {
    const noisy = `line one\nline two\r\n${'x'.repeat(400)}`
    const next = recordFailure({ state: emptyState(), name: NAME, pin: PIN, now: T0, error: noisy })
    const stored = next.failures[NAME].error
    expect(stored).not.toContain('\n')
    expect(stored).not.toContain('\r')
    expect(stored.length).toBe(200)
    expect(stored.startsWith('line one line two ')).toBe(true)
  })
})

describe('recordSuccess', () => {
  test('removes the entry for the name', () => {
    const failed = recordFailure({ state: emptyState(), name: NAME, pin: PIN, now: T0, error: 'boom' })
    const ok = recordSuccess({ state: failed, name: NAME, pin: PIN })
    expect(ok.failures).toEqual({})
  })

  test('is idempotent when the name was never recorded', () => {
    const state = emptyState()
    expect(recordSuccess({ state, name: '@aiwayds/unknown', pin: PIN }).failures).toEqual({})
  })
})

describe('recordInstallOutcomes', () => {
  const OTHER = '@aiwayds/dsh-vault'
  const OTHER_PIN = '0.8.2'

  test('records a whole batch under ONE timestamp: the injected end-of-batch now, not the launch time', () => {
    // T0 is when the launch started, T1 when the failing batch finished.
    // Stamping entries with T0 would shrink the 10-minute backoff by the batch
    // duration — the bug recordInstallOutcomes exists to prevent.
    const { state, failed } = recordInstallOutcomes({
      state: emptyState(),
      now: T1,
      rows: [
        { name: NAME, pin: PIN, ok: false, error: 'registry down' },
        { name: OTHER, pin: OTHER_PIN, ok: false, error: 'registry down' },
      ],
    })
    expect(failed).toEqual([NAME, OTHER])
    expect(state.failures[NAME]).toEqual({
      pin: PIN,
      attempts: 1,
      firstFailedAt: T1,
      lastFailedAt: T1,
      error: 'registry down',
    })
    expect(state.failures[OTHER].lastFailedAt).toBe(T1)
    expect(state.failures[OTHER].firstFailedAt).toBe(T1)
    // the launch timestamp is nowhere in the result
    expect(JSON.stringify(state)).not.toContain(T0)
  })

  test('a success clears its entry and is not reported as failed', () => {
    const previous = recordFailure({ state: emptyState(), name: NAME, pin: PIN, now: T0, error: 'boom' })
    const { state, failed } = recordInstallOutcomes({
      state: previous,
      now: T1,
      rows: [{ name: NAME, pin: PIN, ok: true }, { name: OTHER, pin: OTHER_PIN, ok: false }],
    })
    expect(failed).toEqual([OTHER])
    expect(state.failures[NAME]).toBeUndefined()
    expect(state.failures[OTHER].attempts).toBe(1)
    expect(state.failures[OTHER].lastFailedAt).toBe(T1)
  })

  test('a missing state degrades to an empty one and an empty batch is a no-op', () => {
    const { state, failed } = recordInstallOutcomes({
      state: null,
      now: T0,
      rows: [{ name: NAME, pin: PIN, ok: false }],
    })
    expect(failed).toEqual([NAME])
    expect(state.failures[NAME].attempts).toBe(1)
    expect(recordInstallOutcomes({}).failed).toEqual([])
    expect(serializeState(recordInstallOutcomes({ state: emptyState(), now: T0 }).state)).toBe(serializeState(emptyState()))
  })
})

describe('shouldSkipRetry', () => {
  test('does not skip when there is no entry', () => {
    const verdict = shouldSkipRetry({ state: emptyState(), name: NAME, pin: PIN, now: T0 })
    expect(verdict.skip).toBe(false)
    expect(verdict.reason).toBeNull()
    expect(verdict.entry).toBeNull()
  })

  test('does not skip when the recorded pin differs', () => {
    const state = stateWith({ [NAME]: entry({ pin: '0.6.9' }) })
    const verdict = shouldSkipRetry({ state, name: NAME, pin: PIN, now: T0 })
    expect(verdict.skip).toBe(false)
    expect(verdict.reason).toBeNull()
  })

  test('skips inside the backoff window after a first failure', () => {
    const state = stateWith({ [NAME]: entry() })
    const verdict = shouldSkipRetry({ state, name: NAME, pin: PIN, now: T1 })
    expect(verdict.skip).toBe(true)
    expect(verdict.reason).toBe('backoff')
    expect(verdict.entry.attempts).toBe(1)
  })

  test('does not skip once the backoff window has elapsed', () => {
    const state = stateWith({ [NAME]: entry() })
    const at = new Date(Date.parse(T0) + BACKOFF_MS).toISOString()
    expect(shouldSkipRetry({ state, name: NAME, pin: PIN, now: at }).skip).toBe(false)
  })

  test('skips permanently once maxAttempts is reached', () => {
    const state = stateWith({ [NAME]: entry({ attempts: MAX_ATTEMPTS, lastFailedAt: T0 }) })
    const verdict = shouldSkipRetry({ state, name: NAME, pin: PIN, now: T0 })
    expect(verdict.skip).toBe(true)
    expect(verdict.reason).toBe('max-attempts')
  })

  test('does not skip once the reset window has elapsed, even at maxAttempts', () => {
    const state = stateWith({ [NAME]: entry({ attempts: MAX_ATTEMPTS, lastFailedAt: T0 }) })
    const verdict = shouldSkipRetry({ state, name: NAME, pin: PIN, now: T_RESET })
    expect(verdict.skip).toBe(false)
    expect(verdict.reason).toBe('reset')
  })

  test('the reset boundary is inclusive: 1ms earlier still skips, exactly RESET_AFTER_MS retries', () => {
    const state = stateWith({ [NAME]: entry({ attempts: MAX_ATTEMPTS, lastFailedAt: T0 }) })
    const justBefore = new Date(Date.parse(T0) + RESET_AFTER_MS - 1).toISOString()
    expect(shouldSkipRetry({ state, name: NAME, pin: PIN, now: justBefore }).reason).toBe('max-attempts')
    expect(shouldSkipRetry({ state, name: NAME, pin: PIN, now: T_RESET }).reason).toBe('reset')
  })

  test('does not skip when now is not a readable time', () => {
    const state = stateWith({ [NAME]: entry() })
    const verdict = shouldSkipRetry({ state, name: NAME, pin: PIN, now: 'not-a-date' })
    expect(verdict.skip).toBe(false)
    expect(verdict.reason).toBeNull()
  })

  test('accepts Date and epoch milliseconds for now', () => {
    const state = stateWith({ [NAME]: entry() })
    const at = Date.parse(T1)
    expect(shouldSkipRetry({ state, name: NAME, pin: PIN, now: new Date(at) }).reason).toBe('backoff')
    expect(shouldSkipRetry({ state, name: NAME, pin: PIN, now: at }).reason).toBe('backoff')
  })
})

describe('summarizeSkips', () => {
  test('returns only the pins that would be skipped', () => {
    const state = stateWith({
      '@aiwayds/maxed': entry({ attempts: MAX_ATTEMPTS }),
      '@aiwayds/backing-off': entry(),
      '@aiwayds/due': entry({ firstFailedAt: '2026-11-16T09:30:00.000Z', lastFailedAt: '2026-11-16T09:30:00.000Z' }),
      '@aiwayds/re-pinned': entry({ attempts: MAX_ATTEMPTS, pin: '0.6.0' }),
    })
    const rows = summarizeSkips({
      state,
      pins: {
        '@aiwayds/maxed': PIN,
        '@aiwayds/backing-off': PIN,
        '@aiwayds/due': PIN,
        '@aiwayds/re-pinned': PIN,
      },
      now: T0,
    })
    expect(rows).toEqual([
      { name: '@aiwayds/backing-off', pin: PIN, reason: 'backoff', attempts: 1, lastFailedAt: T0 },
      { name: '@aiwayds/maxed', pin: PIN, reason: 'max-attempts', attempts: MAX_ATTEMPTS, lastFailedAt: T0 },
    ])
  })

  test('accepts an array of name/pin rows', () => {
    const state = stateWith({ [NAME]: entry({ attempts: MAX_ATTEMPTS }) })
    const rows = summarizeSkips({ state, pins: [{ name: NAME, pin: PIN }], now: T0 })
    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toBe('max-attempts')
  })
})

describe('immutability', () => {
  test('recordFailure and recordSuccess leave the input state untouched', () => {
    const original = recordFailure({ state: emptyState(), name: NAME, pin: PIN, now: T0, error: 'boom' })
    const snapshot = structuredClone(original)

    recordFailure({ state: original, name: NAME, pin: PIN, now: T1, error: 'again' })
    recordFailure({ state: original, name: '@aiwayds/other', pin: PIN, now: T1, error: 'again' })
    recordSuccess({ state: original, name: NAME, pin: PIN })

    expect(original).toEqual(snapshot)
  })
})
