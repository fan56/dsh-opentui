#!/usr/bin/env node
// R6 harness self-test — lightweight (no TUI, no network, no mock-llm).
//
// Covers the harness defects found in the R6 verification report:
//   A. profile resolution is dynamic (reads profile-name.mjs DEFAULT_PROFILE,
//      not a hardcoded 'opentui'), and stays correct for opentui-monday;
//   B. the E8 always-grant self-check is NOT unconditionally failing: clean
//      real journal/frame/mock content yields zero hits (check passes), while
//      a planted marker is still detected (negative control);
//   C. the real TUI boot gate is 🧠 OR idle text (not AND), with a non-empty
//      pane guard — the old AND form blocked the driver at 90s every run;
//   D. every exit path uses one idempotent cleanup that kills the tmux client,
//      reaps the scratch host and kills the mock child (blocked() used to exit
//      straight after flush() and leaked one mock-llm per BLOCKED run);
//   E. the R6 scratch model config carries no `reasoningEffort: high` — the
//      fake-gw/demo-1 route has no effort catalog and rejects `high` at the
//      first real turn — while every other scenario keeps the deployed row.
//
// The self-test imports the SAME helpers the driver imports, so it exercises
// the real logic rather than a copy of it.
import assert from 'node:assert/strict'
import { DEFAULT_PROFILE } from '../../packages/shell/scripts/lib/profile-name.mjs'
import {
  ACTIVE_PROFILE, ALLOW_ONCE_LABEL_RE, agentDefaultModelRow, bootIdle, decideApprovalKey,
  hasPaneContent, idleText, isApprovalCard, makeCleanup, noticeParentFromJournal, resolveProfile, scanAlwaysGrant, stripAnsi,
} from './r6-harness-lib.mjs'
// Module import never binds the mock server (run-as-script gate); it only
// exposes the pure helpers so the test exercises the EXACT functions the R6
// child phase uses (tool discovery, args schema, phase routing), not copies.
import { decidePhase, pickR6Tool, r6ToolArgs } from '../../e2e/lib/mock-llm.mjs'

const results = []
function t(name, fn) {
  fn()
  results.push(`PASS ${name}`)
}

t('dynamic profile: an injected DEFAULT_PROFILE is honoured (not hardcoded opentui)', () => {
  assert.equal(resolveProfile({ DEFAULT_PROFILE: 'opentui-monday' }), 'opentui-monday')
  assert.equal(resolveProfile({ DEFAULT_PROFILE: 'a-future-profile' }), 'a-future-profile')
})

t('dynamic profile: active profile equals the single source of truth', () => {
  assert.equal(ACTIVE_PROFILE, DEFAULT_PROFILE)
  assert.equal(resolveProfile(), DEFAULT_PROFILE)
  assert.ok(typeof ACTIVE_PROFILE === 'string' && ACTIVE_PROFILE.trim().length > 0)
  assert.notEqual(ACTIVE_PROFILE, 'opentui') // the old hardcoded value is gone
})

t('dynamic profile: invalid DEFAULT_PROFILE is rejected', () => {
  assert.throws(() => resolveProfile({ DEFAULT_PROFILE: '' }), /invalid DEFAULT_PROFILE/)
})

t('E8: clean real journal + frames + mock output yield no always-grant hits', () => {
  const hits = scanAlwaysGrant({
    journalRows: [
      { type: 'plugin:opentui/ask/responded', payload: { outcome: 'approved', settleReason: 'answered' } },
      { type: 'user', payload: { text: 'E2E_R6_PARENT' } },
    ],
    frames: ['› 1. Deploy target\n  ● 2. Verbosity', 'Review answers'],
    mockOutput: `ready http://127.0.0.1:1234\n`,
  })
  assert.deepEqual(hits, []) // => check(..., hits.length === 0) passes
})

t('E8: planted escalation:true in a real journal row is detected', () => {
  const hits = scanAlwaysGrant({ journalRows: [{ type: 'x', payload: { escalation: true } }] })
  assert.equal(hits.length, 1)
  assert.ok(hits[0].startsWith('journal#0'))
})

t('E8: planted behavior:always in a captured frame is detected', () => {
  const hits = scanAlwaysGrant({ frames: ['behavior: "always"'] })
  assert.equal(hits.length, 1)
  assert.ok(hits[0].startsWith('frame#0'))
})

t('E8: check is not unconditionally failing (negative control stays clean)', () => {
  // The old defect fed the assertion's own expected-label string (which
  // quotes `escalation:true`) to the regex. The scan now receives only real
  // content, so a benign runtime artifact cannot trip it.
  const hits = scanAlwaysGrant({ frames: ['no always-grant answer was sent'], mockOutput: 'idle\n' })
  assert.deepEqual(hits, [])
})

t('boot gate: 🧠 alone satisfies the OR predicate (no idle text)', () => {
  assert.equal(idleText('🧠 used 12%'), false)
  assert.equal(bootIdle('🧠 used 12%'), true)
})

t('boot gate: idle text alone satisfies the OR predicate (no 🧠)', () => {
  for (const frame of ['> Type a message', '提问，回车发送', '🌐 fake-gw · 🤖 demo-1 · 🔧 0 tools\n> Type a message']) {
    assert.equal(frame.includes('🧠'), false)
    assert.equal(idleText(frame), true)
    assert.equal(bootIdle(frame), true)
  }
})

t('boot gate: neither 🧠 nor idle text is not ready', () => {
  assert.equal(bootIdle('🌐 fake-gw · 🤖 demo-1 · 🔧 0 tools'), false)
  assert.equal(bootIdle('loading…'), false)
})

t('boot gate: the old AND form fails the observed idle pane (regression guard)', () => {
  // round2 pane tail: footer had no 🧠 but the composer was idle. `🧠 && idle`
  // stayed false for 90s; `bootIdle` is true on the very same frame.
  const observed = '🌐 fake-gw · 🤖 demo-1 · 🔧 0 tools\n> Type a message\n'
  assert.equal(observed.includes('🧠') && idleText(observed), false)
  assert.equal(bootIdle(observed), true)
})

t('boot gate: a blank pane never satisfies the non-empty guard', () => {
  assert.equal(hasPaneContent('   \n  \n'), false)
  assert.equal(hasPaneContent(''), false)
  assert.equal(hasPaneContent('🧠'), true)
  assert.equal(hasPaneContent('> Type a message'), true)
})

t('cleanup: tmux session, scratch host and mock child are all killed before exit', () => {
  const calls = []
  const cleanup = makeCleanup({
    killSession: () => calls.push('tmux'),
    reapHost: () => calls.push('host'),
    killMock: () => calls.push('mock'),
    endLog: () => calls.push('log'),
  })
  cleanup()
  assert.deepEqual(calls, ['tmux', 'host', 'mock', 'log'])
  cleanup() // blocked() + process 'exit' backstop both call it
  assert.deepEqual(calls, ['tmux', 'host', 'mock', 'log']) // idempotent
})

t('cleanup: a failing teardown step cannot skip the remaining kills', () => {
  const calls = []
  const cleanup = makeCleanup({
    killSession: () => { throw new Error('tmux session already gone') },
    reapHost: () => calls.push('host'),
    killMock: () => calls.push('mock'),
  })
  assert.doesNotThrow(() => cleanup())
  assert.deepEqual(calls, ['host', 'mock'])
})

t('cleanup: missing actions are safe (earliest BLOCKED before boot)', () => {
  assert.doesNotThrow(() => makeCleanup()())
})

t('R6 scratch config: the fake route row has no reasoningEffort (never high)', () => {
  const row = agentDefaultModelRow({ noReasoningEffort: true })
  assert.equal(/reasoningEffort/.test(row), false, row)
  assert.equal(/\bhigh\b/.test(row), false, row)
  assert.match(row, /provider: fake-gw/)
  assert.match(row, /model: demo-1/)
})

t('R6 scratch config: non-R6 scenarios still get the deployed high default', () => {
  const row = agentDefaultModelRow()
  assert.match(row, /reasoningEffort: high/)
  assert.notEqual(row, agentDefaultModelRow({ noReasoningEffort: true }))
})

// --- permission-ask path (subagent-origin ask_user_question is DELEGATED_CALLER) ---
t('R6 permission path: approval card title detected in en + zh, not a stray tool line', () => {
  assert.equal(isApprovalCard('⚠ Approval: bash'), true)
  assert.equal(isApprovalCard('⚠ 审批：bash'), true)
  assert.equal(isApprovalCard('tool/call bash'), false)
  assert.equal(isApprovalCard('phase=r6-child-ask'), false)
})

t('R6 permission path: ANSI escapes stripped before card detection', () => {
  assert.equal(stripAnsi('\x1b[31m⚠ Approval: bash\x1b[0m'), '⚠ Approval: bash')
  assert.equal(isApprovalCard('\x1b[31m⚠ 审批：bash\x1b[0m'), true)
})

t('R6 permission path: Allow once key chosen from the frame (Enter only)', () => {
  assert.deepEqual(
    decideApprovalKey('⚠ Approval: bash\nallow [enter]  reject [esc]  always [a]'),
    { key: 'Enter', why: 'approval-card-confirm-allow-once', marker: 'approval+allow' },
  )
  assert.equal(decideApprovalKey('⚠ 审批：bash\n允许 [enter]  拒绝 [esc]')?.key, 'Enter')
})

t('R6 permission path: no card / no confirm label painted => no key (never blind-send)', () => {
  assert.equal(decideApprovalKey('tool/call bash'), null)
  assert.equal(decideApprovalKey('⚠ Approval: bash')?.key, null)
})

t('R6 permission path: confirm-label regex accepts allow/允许, rejects approval-only text', () => {
  assert.equal(ALLOW_ONCE_LABEL_RE.test('allow'), true)
  assert.equal(ALLOW_ONCE_LABEL_RE.test('允许'), true)
  assert.equal(ALLOW_ONCE_LABEL_RE.test('approval required'), false)
})

t('R6 permission path: child tool name discovered from request tools (E2E_TOOL discipline)', () => {
  const body = JSON.stringify({
    tools: [
      { type: 'function', function: { name: 'read_file' } },
      { type: 'function', function: { name: 'bash' } },
    ],
  })
  assert.equal(pickR6Tool(body), 'bash')
  assert.equal(pickR6Tool(JSON.stringify({ tools: [{ name: 'write' }, { function: { name: 'bash' } }] })), 'write')
})

t('R6 permission path: ask_user_question is NEVER selected even if advertised', () => {
  const body = JSON.stringify({
    tools: [{ function: { name: 'ask_user_question' } }, { function: { name: 'read_file' } }],
  })
  assert.equal(pickR6Tool(body), undefined)
  assert.notEqual(pickR6Tool(body), 'ask_user_question')
})

t('R6 permission path: malformed / tool-less body yields no discovered tool', () => {
  assert.equal(pickR6Tool('not json'), undefined)
  assert.equal(pickR6Tool('{}'), undefined)
  assert.equal(pickR6Tool(JSON.stringify({ tools: 'x' })), undefined)
})

// --- round5 harness FAIL fixes ----------------------------------------------
t('R6 tool args: bash uses host schema command/description, never cmd', () => {
  const args = r6ToolArgs('bash')
  assert.equal(args.command, 'echo E2E-R6-PERMISSION-TOOL-RAN')
  assert.equal(args.description, 'R6 child approval-gate probe')
  assert.equal('cmd' in args, false) // the rejected INVALID_ARGS field
  assert.deepEqual(Object.keys(args).sort(), ['command', 'description'])
})

t('R6 tool args: write uses file_path/content (not path), edit uses the three required fields', () => {
  const write = r6ToolArgs('write')
  assert.equal(write.file_path, 'e2e-r6-permission-probe.txt')
  assert.equal(write.content, 'E2E-R6-PERMISSION-TOOL-RAN')
  assert.equal('path' in write, false)
  assert.deepEqual(Object.keys(write).sort(), ['content', 'file_path'])
  const edit = r6ToolArgs('edit')
  assert.equal(edit.file_path, 'e2e-r6-permission-probe.txt')
  assert.equal(edit.old_string, 'E2E-R6-PERMISSION-TOOL-RAN')
  assert.equal(edit.new_string, 'E2E-R6-PERMISSION-TOOL-RAN')
  assert.deepEqual(Object.keys(edit).sort(), ['file_path', 'new_string', 'old_string'])
})

t('R6 phase routing: a child-session prompt routes to child-ask / child-final', () => {
  const childBody = (withToolResult) => JSON.stringify({
    messages: [
      { role: 'system', content: 'You are r6-asker. E2E_R6_CHILD: run the probe.' },
      ...(withToolResult ? [{ role: 'tool', content: 'tool result' }] : []),
    ],
  })
  assert.equal(decidePhase(childBody(false)), 'r6-child-ask')
  assert.equal(decidePhase(childBody(true)), 'r6-child-final')
  // content may be an array of text parts — the marker still counts as own prompt
  assert.equal(decidePhase(JSON.stringify({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'E2E_R6_CHILD probe' }] }],
  })), 'r6-child-ask')
})

t('R6 phase routing: a child marker embedded ONLY in a parent tool-result routes to r6-final (regression guard)', () => {
  // round5 root cause: raw bodyText.includes(R6_CHILD_KEY) saw the child prompt
  // echoed inside the parent's role:tool result and misrouted the parent turn
  // to r6-child-final, so r6-final / E2E-R6-DONE never streamed.
  const parentAfterTool = JSON.stringify({
    messages: [
      { role: 'system', content: 'Parent persona E2E_R6_PARENT' },
      { role: 'assistant', content: '' },
      { role: 'tool', content: 'child replied: E2E_R6_CHILD: run the probe ...' },
    ],
  })
  assert.equal(decidePhase(parentAfterTool), 'r6-final')
  assert.notEqual(decidePhase(parentAfterTool), 'r6-child-final')
  // parent dispatch (no tool result) still routes to r6-dispatch
  assert.equal(decidePhase(JSON.stringify({
    messages: [{ role: 'system', content: 'Parent persona E2E_R6_PARENT' }],
  })), 'r6-dispatch')
})

t('R6 phase routing: child marker in a tool result alone is NOT attributed to a child session', () => {
  const toolOnly = JSON.stringify({ messages: [{ role: 'tool', content: 'E2E_R6_CHILD echoed' }] })
  assert.notEqual(decidePhase(toolOnly), 'r6-child-final')
  assert.notEqual(decidePhase(toolOnly), 'r6-child-ask')
})

t('R6 phase routing: child wins when its history snapshot also embeds the parent marker', () => {
  const body = JSON.stringify({
    messages: [
      { role: 'system', content: 'E2E_R6_CHILD child persona' },
      { role: 'user', content: 'snapshot: E2E_R6_PARENT parent prompt' },
    ],
  })
  assert.equal(decidePhase(body), 'r6-child-ask')
})

t('E4 parent attribution: notice ownership is read from the real journal payload.sessionId', () => {
  const rows = [
    { seq: 19, type: 'plugin:opentui/ask/responded', payload: {
      eventId: 'evt-1', sessionId: 'parent-1', parentSessionId: 'parent-1', childSessionId: 'child-1',
    } },
  ]
  const hit = noticeParentFromJournal(rows, 'evt-1', 'parent-1')
  assert.equal(hit.ok, true)
  assert.equal(hit.sessionId, 'parent-1')
  // a child-id attribution or a different event must fail
  assert.equal(noticeParentFromJournal(rows, 'evt-1', 'child-1').ok, false)
  assert.equal(noticeParentFromJournal(rows, 'other-evt', 'parent-1').ok, false)
  assert.equal(noticeParentFromJournal([], 'evt-1', 'parent-1').ok, false)
})

t('E4 parent attribution: a replay notice row (no sessionID) cannot self-attribute', () => {
  // bridge-session-seam.ts:828 builds {kind,id,text,final} with no sessionID;
  // only the live path (:5281) has one — the helper never reads it from there.
  const replayNotice = { kind: 'notice', id: 'ask-outcome:evt-1', text: '已收到该请求的回答', final: true }
  assert.equal('sessionID' in replayNotice, false)
  assert.equal(noticeParentFromJournal([replayNotice], 'evt-1', 'parent-1').ok, false)
  // data-shaped journal rows (driver readRealJournal maps data -> payload) work too
  const dataRow = [{ seq: 1, type: 'x', data: { eventId: 'evt-2', sessionId: 'parent-2', childSessionId: 'kid' } }]
  assert.equal(noticeParentFromJournal(dataRow, 'evt-2', 'parent-2').ok, true)
})

// --- round6 E3 schema fix ----------------------------------------------------
t('round6 E3: real ask payload has no parentSessionId; E3 reads the parent from sessionId', () => {
  // Verbatim key set of the real parent journal seq=19
  // (plugin:opentui/ask/responded) from the round6 run — there is NO
  // `parentSessionId` field on the real wire payload.
  const realPayload = {
    askKind: 'approval', at: '2026-11-25T15:24:00.000Z',
    childSessionId: 'cbabe785-6315-45a2-b6e3-ee9817069a41', eventId: 'evt-1',
    kind: 'ask.responded', outcome: 'approved',
    sessionId: 'e959b495-90a5-4ea4-a8f8-2e25fb1b1b13',
    settleReason: 'answered', source: 'answer', toolName: 'bash',
    turnId: 'turn-1', verdict: 'allow-once',
  }
  assert.equal('parentSessionId' in realPayload, false)
  // The driver derives the parent id from this SAME payload.sessionId, then
  // asserts `d.sessionId === parentSessionId` — true for the real schema.
  const parentSessionId = String(realPayload.sessionId)
  assert.equal(realPayload.sessionId === parentSessionId, true)
  // The old buggy expression compared against the non-existent field (undefined).
  assert.equal(realPayload.sessionId === realPayload.parentSessionId, false)
  // Parent attribution still resolves from the real payload.sessionId (E4 helper).
  const row = { seq: 19, type: 'plugin:opentui/ask/responded', payload: realPayload }
  assert.equal(noticeParentFromJournal([row], 'evt-1', parentSessionId).ok, true)
  assert.equal(noticeParentFromJournal([row], 'evt-1', realPayload.childSessionId).ok, false)
})

console.log(results.join('\n'))
console.log(`\nR6 harness self-test: ${results.length} PASS, 0 FAIL`)
