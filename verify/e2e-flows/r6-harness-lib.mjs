// R6 harness shared helpers — used by both the R6 driver and its self-test so
// the self-test exercises the exact logic the driver runs (no copied logic).
import { DEFAULT_PROFILE } from '../../packages/shell/scripts/lib/profile-name.mjs'

/**
 * Resolve the active profile name from the single source of truth
 * (profile-name.mjs -> DEFAULT_PROFILE). The injectable module form lets the
 * harness self-test prove the value is READ rather than hardcoded: a module
 * carrying a different DEFAULT_PROFILE must be honoured (e.g. opentui-monday
 * or any future rename).
 */
export function resolveProfile(source = { DEFAULT_PROFILE }) {
  const name = source?.DEFAULT_PROFILE
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`R6 harness: invalid DEFAULT_PROFILE ${JSON.stringify(name)}`)
  }
  return name
}

/** The active profile for this checkout (no hardcoded 'opentui' literal). */
export const ACTIVE_PROFILE = resolveProfile()

/**
 * Build the `agent-default-model` row of the isolated e2e scratch patch.
 *
 * The fake-gw/demo-1 provider config has NO reasoning-effort catalog, so the
 * host rejects *any* explicit reasoningEffort at turn/start with
 * UNSUPPORTED_REASONING_EFFORT (R6 round3 root cause: the status bar showed
 * `● high` and the first real turn died before the mock saw a request). The
 * R1/R4 scratch patches fixed the same fake-model refusal by removing that
 * deployed `high` default from the isolated home. R6 opts into the same fix
 * with `noReasoningEffort`; every other scenario keeps the original row
 * verbatim. setup-home.mjs writes this exact text and the self-test asserts
 * it, so the two cannot drift.
 */
export function agentDefaultModelRow({ noReasoningEffort = false } = {}) {
  const row = [
    '- id: agent-default-model',
    '  name: "@deepseek-ai/dsh-agent-default-model"',
    '  config:',
    '    provider: fake-gw',
    '    model: demo-1',
  ]
  if (!noReasoningEffort) row.push('    reasoningEffort: high')
  return row.join('\n')
}

/**
 * Always-grant / escalation markers. This regex must ONLY be applied to real
 * runtime artifacts (journal rows, captured TUI frames, mock-llm stdout).
 * It must never be applied to the driver's own source: the E8 assertion's
 * expected-label string quotes `escalation:true`, so a source scan would
 * self-match and fail unconditionally (R6 harness audit A2).
 */
const ALWAYS_GRANT_RE = /['"]?behavior['"]?\s*:\s*['"]?always['"]?|['"]?escalation['"]?\s*:\s*['"]?true['"]?/i

/** Return a list of locations where an always-grant marker actually appeared. */
export function scanAlwaysGrant({ journalRows = [], frames = [], mockOutput = '' } = {}) {
  const hits = []
  journalRows.forEach((row, i) => {
    if (ALWAYS_GRANT_RE.test(JSON.stringify(row))) hits.push(`journal#${i}:${String(row?.type ?? '')}`)
  })
  frames.forEach((frame, i) => {
    if (ALWAYS_GRANT_RE.test(String(frame))) hits.push(`frame#${i}`)
  })
  if (ALWAYS_GRANT_RE.test(String(mockOutput))) hits.push('mock-output')
  return hits
}

/**
 * Pane idle markers. Same definition as the other flow harnesses
 * (queue-flush-repro, agents-mount-repro, steer-queue-repro,
 * w1a-six-commands, ui-matrix): either idle string means the composer is ready.
 */
export const IDLE_MARKERS = ['提问，回车发送', 'Type a message', '输入消息']
export const idleText = (out) => IDLE_MARKERS.some((m) => String(out ?? '').includes(m))

/**
 * Real TUI boot gate: 🧠 OR idle text — never AND. The other flows all use
 * this OR form. The old R6 `🧠 && idle` was unsatisfiable whenever the footer
 * did not paint 🧠 (e.g. the observed `🌐 fake-gw · 🤖 demo-1 · 🔧 0 tools`
 * pane with `Type a message`), so the driver timed out at 90s on every run.
 */
export const bootIdle = (out) => String(out ?? '').includes('🧠') || idleText(out)

/** A captured pane must hold real content before it can satisfy any gate. */
export const hasPaneContent = (frame) => String(frame ?? '').trim().length > 0

/** Strip ANSI SGR escapes from a captured tmux pane (shared by driver + tests). */
export const stripAnsi = (s) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '')

/**
 * The child permission ask is mounted as the real DialogConfirm approval card
 * whose i18n title is `⚠ Approval: <tool>` (en) / `⚠ 审批：<tool>` (zh).
 * Matching the TITLE — not a generic "tool call" line in the transcript — is
 * what keeps the gate honest: a stray scrollback line must never be mistaken
 * for a live, answerable card.
 */
export const APPROVAL_CARD_RE = /⚠\s*Approval:|⚠\s*审批：/i
export const isApprovalCard = (out) => APPROVAL_CARD_RE.test(stripAnsi(out))

/**
 * "Allow once" is the DialogConfirm PRIMARY confirm action (label `allow` /
 * `允许`) bound to `enter`. The escalation actions `a` (always) and `s`
 * (session) are deliberately NEVER chosen — the harness must not create an
 * always/session grant. `Esc` is Reject, also forbidden here. So the ONLY key
 * this driver sends to an approval card is Enter, and only when the captured
 * frame actually paints the confirm label. Returns null when there is no card
 * or the label is not yet painted (the driver then waits, never blind-sends).
 */
export const ALLOW_ONCE_LABEL_RE = /\ballow\b|允许/i
export function decideApprovalKey(rawFrame) {
  const frame = stripAnsi(rawFrame)
  if (!isApprovalCard(frame)) return null
  if (!ALLOW_ONCE_LABEL_RE.test(frame)) {
    return { key: null, why: 'approval-card-confirm-label-not-painted', marker: 'approval-no-allow' }
  }
  return { key: 'Enter', why: 'approval-card-confirm-allow-once', marker: 'approval+allow' }
}

/**
 * Verify a replay notice's PARENT attribution from the REAL journal, not from
 * the replay row itself. `bridgeReplayRowsToSeamTranscript` builds a notice row
 * as `{kind,id,text,final}` (bridge-session-seam.ts:828) — there is NO
 * `sessionID` field on the replay shape; `sessionID` only appears on the LIVE
 * event path (:5281). So asserting `JSON.stringify(noticeRow).includes(parent)`
 * is a harness/row-shape mismatch guaranteed to fail. Instead: locate the real
 * journal row that produced the notice (same `eventId`, carrying a
 * childSessionId) and read its `payload.sessionId`.
 * Returns `{ owner, sessionId, ok }` so the caller can log the real value even
 * on failure and the self-test can exercise the exact driver logic.
 */
export function noticeParentFromJournal(replayRows, eventId, parentSessionId) {
  const payloadOf = (row) => row?.payload ?? row?.data ?? row ?? {}
  const owner = (Array.isArray(replayRows) ? replayRows : []).find((row) => {
    const p = payloadOf(row)
    return String(p.eventId) === String(eventId)
      && typeof p.childSessionId === 'string' && p.childSessionId.length > 0
  })
  const sessionId = owner !== undefined ? String(payloadOf(owner).sessionId ?? '') : undefined
  return {
    owner,
    sessionId,
    ok: owner !== undefined && sessionId === String(parentSessionId),
  }
}

/**
 * Idempotent unified teardown for every exit path (BLOCKED, assertion failure,
 * thrown error, normal completion). Previously `blocked()` called
 * `process.exit(2)` right after `flush()`, leaking one mock-llm per BLOCKED
 * run. Actions are injected so the self-test can prove that the client
 * session, the scratch host and the mock child are all reaped exactly once.
 * Each step is best-effort: one failure must never block the rest or the exit.
 */
export function makeCleanup({ killMock, killSession, reapHost, endLog } = {}) {
  let done = false
  return () => {
    if (done) return
    done = true
    for (const fn of [killSession, reapHost, killMock, endLog]) {
      try { fn?.() } catch { /* best effort: teardown must not block exit */ }
    }
  }
}

/**
 * 0.29 Ctrl+G real-UI gates (R6-029 driver). The subagents panel paints one
 * child row as `<label> · <status> · <rounds>` and the transcript layer paints
 * the child's buffered log one line per node (multi-line tool output split).
 * These helpers are shared by the driver and any harness self-test so the
 * frame predicates cannot drift from the real viewer rendering.
 */
/** Strip ANSI and require every needle in the captured pane. */
export function frameHasAll(frame, needles = []) {
  const text = stripAnsi(frame)
  return needles.every((n) => String(text).includes(String(n)))
}

/** The Ctrl+G panel shows the child's (case-insensitive) label on a row. */
export function childRowVisible(frame, label) {
  return stripAnsi(frame).toLowerCase().includes(String(label).toLowerCase())
}

/** A specific buffered child-log marker is painted on the transcript layer. */
export const transcriptLineVisible = (frame, marker) => frameHasAll(frame, [marker])

/** The viewer's `⏻` hard-stop marker is ABSENT under grace 0. */
export const hasHardStopMarker = (frame) => stripAnsi(frame).includes('⏻')
