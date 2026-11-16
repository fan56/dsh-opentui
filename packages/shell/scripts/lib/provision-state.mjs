// Cross-start failure memory for provision-opentui-profile.mjs.
//
// The provisioning script runs on every launch. When a plugin cannot be
// installed at its pin (the registry is missing the version, or the version
// that landed is not the pin) the old behaviour retried on every start
// forever, rewriting node_modules and slowing startup without bound. This
// module decides, purely, what happened last time and whether another retry
// is worth it.
//
// Nothing here touches the filesystem or spawns a process: the caller passes
// the state file's text in and writes the serialized result out. That keeps
// the retry policy testable without a real profile.
//
// Timestamps are always stored as ISO strings so the file is timezone-free
// and diff-friendly.

export const STATE_VERSION = 1
export const MAX_ATTEMPTS = 3
export const BACKOFF_MS = 600000 // 10 minutes
// A pin that has been failing for a full day gets a fresh round. Without this
// the attempt cap would skip a plugin forever: a registry that published the
// pinned version late, or a network outage, would look identical to a broken
// pin. The window is measured from firstFailedAt, not lastFailedAt, so a pin
// that fails once a day still resets on schedule.
export const RESET_AFTER_MS = 86_400_000 // 24 hours
export const MAX_ERROR_LENGTH = 200

const EPOCH_ISO = new Date(0).toISOString()

/** Coerce a Date | ISO string | epoch milliseconds value to milliseconds.
 *  Returns null when the value cannot be read as a point in time. */
function parseTimeMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

function toIso(value) {
  const ms = parseTimeMs(value)
  return ms === null ? null : new Date(ms).toISOString()
}

/** Failure text is logged on one line and must not grow the state file:
 *  newlines become spaces, and the result is capped at MAX_ERROR_LENGTH. */
function sanitizeError(error) {
  const text = typeof error === 'string'
    ? error
    : error == null
      ? ''
      : String(error)
  return text.replace(/[\r\n]+/g, ' ').slice(0, MAX_ERROR_LENGTH)
}

/** A stored entry is untrusted input (the file may be hand-edited or written
 *  by an older build), so re-validate on read. Anything malformed is dropped
 *  by the caller; the remaining entries still participate in the policy. */
function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const pin = typeof raw.pin === 'string' ? raw.pin.trim() : ''
  if (pin === '') return null
  const attempts = Math.floor(Number(raw.attempts))
  if (!Number.isFinite(attempts) || attempts < 1) return null
  const firstFailedAt = toIso(raw.firstFailedAt)
  const lastFailedAt = toIso(raw.lastFailedAt)
  if (firstFailedAt === null || lastFailedAt === null) return null
  return {
    pin,
    attempts,
    firstFailedAt,
    lastFailedAt,
    error: sanitizeError(raw.error),
  }
}

/** Fresh, empty state. Always a new object so callers cannot share one. */
export function emptyState() {
  return { version: STATE_VERSION, failures: {} }
}

/** Parse the state file's text. Returns null when the document is not a
 *  usable state at all; individual malformed failure entries are dropped so
 *  one bad row cannot disable retry tracking for every plugin. */
export function parseState(text) {
  if (typeof text !== 'string' || text.trim() === '') return null
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!raw.failures || typeof raw.failures !== 'object' || Array.isArray(raw.failures)) return null

  const failures = {}
  for (const [name, entry] of Object.entries(raw.failures)) {
    if (typeof name !== 'string' || name === '') continue
    const normalized = normalizeEntry(entry)
    if (normalized) failures[name] = normalized
  }
  return { version: STATE_VERSION, failures }
}

/** Stable JSON for the state file: failure names sorted, fixed field order
 *  inside each entry, trailing newline. Two runs over the same state produce
 *  byte-identical output, so the file does not churn. */
export function serializeState(state) {
  const source = state && typeof state === 'object' && state.failures && typeof state.failures === 'object'
    ? state.failures
    : {}
  const failures = {}
  for (const name of Object.keys(source).sort()) {
    const entry = normalizeEntry(source[name])
    if (entry) failures[name] = entry
  }
  return `${JSON.stringify({ version: STATE_VERSION, failures }, null, 2)}\n`
}

/** True when `firstFailedAt` is at least `resetAfterMs` before `now`.
 *  Exactly the window boundary counts as due: a failure recorded at T is
 *  "24 hours old" at T+24h, and the next attempt is a fresh round.
 *  Unreadable timestamps are never due (retry is the safe failure mode). */
function isResetDue({ now, firstFailedAt, resetAfterMs = RESET_AFTER_MS }) {
  const nowMs = parseTimeMs(now)
  if (nowMs === null) return false
  const firstMs = parseTimeMs(firstFailedAt)
  if (firstMs === null) return false
  const window = Number.isFinite(Number(resetAfterMs)) ? Number(resetAfterMs) : RESET_AFTER_MS
  return nowMs - firstMs >= window
}

/** Record a failed install attempt. Same pin: attempts grow and
 *  firstFailedAt is preserved. New pin: the failure history resets, because
 *  the previous failures said nothing about this pin. A pin that has been
 *  failing for RESET_AFTER_MS also starts a fresh round (attempts back to 1,
 *  firstFailedAt moved to now) — the pin deserves another chance after a day.
 *  Returns a new state. */
export function recordFailure({ state, name, pin, now, error } = {}) {
  const base = state && typeof state === 'object' && state.failures && typeof state.failures === 'object'
    ? state
    : emptyState()
  const failures = { ...base.failures }
  const previous = normalizeEntry(failures[name])
  const resolvedPin = pin == null ? '' : String(pin)
  const at = toIso(now) ?? EPOCH_ISO
  const previousMatches = previous !== null && previous.pin === resolvedPin
  const freshRound = previousMatches && isResetDue({ now, firstFailedAt: previous.firstFailedAt })
  const samePin = previousMatches && !freshRound

  failures[name] = {
    pin: resolvedPin,
    attempts: samePin ? previous.attempts + 1 : 1,
    firstFailedAt: samePin ? previous.firstFailedAt : at,
    lastFailedAt: at,
    error: sanitizeError(error),
  }
  return { version: STATE_VERSION, failures }
}

/** Clear the failure entry for `name`. `pin` is intentionally unused: a
 *  successful install means there is nothing left to retry, whatever pin the
 *  entry recorded. Returns a new state. */
export function recordSuccess({ state, name } = {}) {
  const base = state && typeof state === 'object' && state.failures && typeof state.failures === 'object'
    ? state
    : emptyState()
  const failures = { ...base.failures }
  delete failures[name]
  return { version: STATE_VERSION, failures }
}

/**
 * Record ONE launch's install outcomes under a SINGLE timestamp.
 *
 * The timestamp is chosen by the caller at the moment the batch FINISHED
 * (`new Date().toISOString()` after the last `dsh plugin add` returned), never
 * at process start. Provisioning can spend minutes installing, and the backoff
 * window is measured from `lastFailedAt`: stamping a 9-minute failing batch
 * with the launch time leaves 1 minute of the 10-minute window instead of 10.
 * One timestamp for the whole batch (rather than one per package) keeps the
 * entries of a launch identical; the difference between per-package calls
 * would be milliseconds and is not worth the extra clock reads.
 *
 * Pure: `rows` is `[{ name, pin, ok, error }]`. Returns the next state and the
 * names recorded as failures, so the caller can keep its degraded count.
 *
 * @param {{state?: object, rows?: Array<{name: string, pin: string, ok: boolean, error?: string}>, now?: Date|string|number}} input
 * @returns {{state: object, failed: string[]}}
 */
export function recordInstallOutcomes({ state, rows = [], now } = {}) {
  const base = state && typeof state === 'object' && state.failures && typeof state.failures === 'object'
    ? state
    : emptyState()
  let next = base
  const failed = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.name !== 'string' || row.name === '') continue
    if (row.ok) {
      next = recordSuccess({ state: next, name: row.name })
      continue
    }
    next = recordFailure({ state: next, name: row.name, pin: row.pin, now, error: row.error })
    failed.push(row.name)
  }
  return { state: next, failed }
}

/** Should this pin be skipped on this launch?
 *
 *  Order matters:
 *   1. no entry, or an entry for another pin -> try it
 *   2. firstFailedAt is RESET_AFTER_MS old -> try it (fresh round)
 *   3. attempts >= maxAttempts -> skip permanently (until the pin changes or
 *      the reset window elapses)
 *   4. still inside the backoff window -> skip for now
 *   5. otherwise -> try
 *
 *  The reset check precedes the attempt cap on purpose: without it a plugin
 *  that failed three times would never be retried again on this pin.
 *
 *  Unreadable timestamps count as "not skipped": retrying is slower than
 *  ideal, but a corrupt clock must never wedge provisioning forever. */
export function shouldSkipRetry({ state, name, pin, now, backoffMs = BACKOFF_MS, maxAttempts = MAX_ATTEMPTS } = {}) {
  const failures = state && typeof state === 'object' && state.failures && typeof state.failures === 'object'
    ? state.failures
    : {}
  const entry = normalizeEntry(failures[name])
  if (!entry || entry.pin !== pin) return { skip: false, reason: null, entry }

  if (isResetDue({ now, firstFailedAt: entry.firstFailedAt })) {
    return { skip: false, reason: 'reset', entry }
  }

  const limit = Number.isFinite(Number(maxAttempts)) ? Number(maxAttempts) : MAX_ATTEMPTS
  if (entry.attempts >= limit) return { skip: true, reason: 'max-attempts', entry }

  const nowMs = parseTimeMs(now)
  const lastMs = parseTimeMs(entry.lastFailedAt)
  if (nowMs === null || lastMs === null) return { skip: false, reason: null, entry }

  const window = Number.isFinite(Number(backoffMs)) ? Number(backoffMs) : BACKOFF_MS
  if (nowMs - lastMs < window) return { skip: true, reason: 'backoff', entry }

  return { skip: false, reason: null, entry }
}

/** `pins` may be a name -> pin map, an array of names, or an array of
 *  { name, pin } rows. Omitting it summarises every recorded failure using
 *  the pin stored in the entry. */
function pinPairs(pins) {
  if (pins == null) return null
  if (Array.isArray(pins)) {
    return pins.map((item) => {
      if (typeof item === 'string') return [item, null]
      if (item && typeof item === 'object') return [item.name, item.pin ?? null]
      return [null, null]
    })
  }
  if (typeof pins === 'object') return Object.entries(pins)
  return []
}

/** One row per pin this launch would skip, sorted by name, ready to be
 *  printed as a single startup warning. */
export function summarizeSkips({ state, pins, now, backoffMs = BACKOFF_MS, maxAttempts = MAX_ATTEMPTS } = {}) {
  const failures = state && typeof state === 'object' && state.failures && typeof state.failures === 'object'
    ? state.failures
    : {}
  const pairs = pinPairs(pins) ?? Object.keys(failures).map((name) => [name, null])

  const rows = []
  for (const [name, pin] of pairs) {
    if (typeof name !== 'string' || name === '') continue
    const entry = normalizeEntry(failures[name])
    if (!entry) continue
    const wantedPin = pin == null ? entry.pin : pin
    const verdict = shouldSkipRetry({ state, name, pin: wantedPin, now, backoffMs, maxAttempts })
    if (!verdict.skip) continue
    rows.push({
      name,
      pin: verdict.entry.pin,
      reason: verdict.reason,
      attempts: verdict.entry.attempts,
      lastFailedAt: verdict.entry.lastFailedAt,
    })
  }
  return rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
