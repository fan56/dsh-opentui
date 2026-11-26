// R6-029 shared HARNESS assertions for the 0.29 features.
//
// These are REAL code-path checks, not fixtures: the pure functions under test
// are imported from the shipped product modules (bridge-session-seam.ts and
// subagent-policy.ts) and fed inputs that exercise the 0.29 rules. They are
// deliberately separated from the real-UI smoke (r6-029-driver.ts): a 50-round
// real TUI run is cost-prohibitive, so the DEFAULT-50 / round-50 wrap-up /
// grace-0-never-hard-stops rules are proven here at the policy seam, while the
// UI smoke proves the Ctrl+G panel + transcript + multi-line tool output on a
// SHORT injected cap. The two halves are reported separately — no claim is
// made that 50 rounds were driven through the UI.
//
// Loaded by the bun driver (dynamic .ts imports resolve under bun). The
// self-test can import this module under node only if it never calls the
// function (the imports live inside it).
export async function run029ProtocolChecks() {
  const checks = []
  const add = (label, ok, expected, actual) =>
    checks.push({ label, ok: Boolean(ok), expected, actual })

  const seam = await import('../../packages/shell/src/client/bridge-session-seam.ts')
  const policy = await import('../../packages/shell/src/subagent-policy.ts')
  const {
    capChildLog, splitChildLogLines, childTranscriptRowToLine,
    CHILD_TRANSCRIPT_MAX_LINES, CHILD_TRANSCRIPT_MAX_BYTES,
  } = seam
  const {
    DEFAULT_SUBAGENT_ROUND_LIMITS, parseSubagentRoundLimits,
    ladderDecision, wrapupMessage,
  } = policy

  const bytesOf = (lines) => lines.reduce(
    (total, line) => total + new TextEncoder().encode(line).length + 1, 0,
  )

  // ---- 0.29 feature: Ctrl+G live transcript cap ---------------------------
  add('029-P transcript cap constants are 500 lines / 64 KiB',
    CHILD_TRANSCRIPT_MAX_LINES === 500 && CHILD_TRANSCRIPT_MAX_BYTES === 64 * 1024,
    '500 / 65536', `${CHILD_TRANSCRIPT_MAX_LINES} / ${CHILD_TRANSCRIPT_MAX_BYTES}`)

  // Head truncation, tail visible: 600 short lines -> oldest 100 dropped.
  const shortLines = Array.from({ length: 600 }, (_, i) => `L${String(i + 1).padStart(4, '0')}`)
  const capped = capChildLog(shortLines)
  add('029-P >500 lines: log capped at exactly 500 rows',
    capped.length === 500, 500, capped.length)
  add('029-P >500 lines: HEAD is dropped',
    capped[0] === 'L0101' && !capped.includes('L0001'),
    'first=L0101, L0001 absent', `first=${capped[0]}`)
  add('029-P >500 lines: TAIL stays visible',
    capped[capped.length - 1] === 'L0600',
    'L0600', capped[capped.length - 1])

  // Byte cap: 600 x ~190 B > 64 KiB -> cap by bytes even under 500 rows.
  const fatLines = Array.from({ length: 600 }, (_, i) => `B${String(i).padStart(4, '0')}-${'x'.repeat(180)}`)
  const byteCapped = capChildLog(fatLines)
  add('029-P >64KiB: byte budget enforced (< 500 rows survive)',
    bytesOf(byteCapped) <= CHILD_TRANSCRIPT_MAX_BYTES && byteCapped.length < 500,
    '<=65536 bytes and <500 rows', `${bytesOf(byteCapped)} bytes / ${byteCapped.length} rows`)
  add('029-P >64KiB: HEAD dropped, TAIL B0599 visible',
    !byteCapped.some((l) => l.startsWith('B0000-'))
      && byteCapped.some((l) => l.startsWith('B0599-')),
    'B0000 absent, B0599 present',
    `head=${byteCapped[0]?.slice(0, 8)} tail=${byteCapped[byteCapped.length - 1]?.slice(0, 8)}`)

  // One over-budget row: kept with a truncation marker rather than dropped.
  const huge = `E2E029-HEAD-${'q'.repeat(70000)}-TAIL`
  const oneLine = capChildLog([huge])
  add('029-P single over-budget line is kept, marked, and fits the budget',
    oneLine.length === 1 && oneLine[0].startsWith('E2E029-HEAD-')
      && oneLine[0].includes('…') && bytesOf(oneLine) <= CHILD_TRANSCRIPT_MAX_BYTES,
    '1 marked line <=65536 bytes',
    `${oneLine.length} line, marker=${oneLine[0]?.includes('…')}, bytes=${bytesOf(oneLine)}`)

  // ---- 0.29 feature: multi-line tool output preserved ---------------------
  const toolLine = childTranscriptRowToLine({
    kind: 'tool', text: 'bash printf',
    output: 'E2E-029-TOOL-L1\nE2E-029-TOOL-L2\nE2E-029-TOOL-L3',
  })
  add('029-P tool row keeps call + multi-line output in one line string',
    toolLine.includes('▶ bash printf') && toolLine.includes('⎿ E2E-029-TOOL-L1')
      && toolLine.includes('\n') && toolLine.includes('E2E-029-TOOL-L3'),
    '▶ call + ⎿ L1 + newline + L3', toolLine.replace(/\n/g, '\\n').slice(0, 120))
  const split = splitChildLogLines([toolLine])
  add('029-P multi-line tool output becomes separate viewer lines (none lost)',
    ['E2E-029-TOOL-L1', 'E2E-029-TOOL-L2', 'E2E-029-TOOL-L3']
      .every((m) => split.some((line) => line.includes(m))) && split.every((line) => !line.includes('\n')),
    'L1/L2/L3 as 3 distinct lines', split)

  // ---- 0.29 feature: maxRounds default 50 / round-50 wrap-up / grace 0 ----
  add('029-P default limits are maxRounds=50, grace=0',
    DEFAULT_SUBAGENT_ROUND_LIMITS?.maxRounds === 50
      && DEFAULT_SUBAGENT_ROUND_LIMITS?.maxRoundsGrace === 0,
    '{50,0}', DEFAULT_SUBAGENT_ROUND_LIMITS)
  add('029-P UNSET key resolves to the 50/0 default (not disabled)',
    JSON.stringify(parseSubagentRoundLimits(undefined)) === '{"maxRounds":50,"maxRoundsGrace":0}'
      && JSON.stringify(parseSubagentRoundLimits({})) === '{"maxRounds":50,"maxRoundsGrace":0}',
    '{50,0}', [parseSubagentRoundLimits(undefined), parseSubagentRoundLimits({})])
  add('029-P explicit maxRounds:0 still disables the ladder',
    parseSubagentRoundLimits({ maxRounds: 0, maxRoundsGrace: 0 }).maxRounds === 0,
    0, parseSubagentRoundLimits({ maxRounds: 0 }))

  const decide = (count, grace, wrapupDelivered = false) => ladderDecision({
    count, cap: 50, grace, wrapupDelivered, settled: false,
  })
  add('029-P round 49: no wrap-up', decide(49, 0) === 'none', 'none', decide(49, 0))
  add('029-P round 50: wrap-up fires', decide(50, 0) === 'wrapup', 'wrapup', decide(50, 0))
  add('029-P grace 0: rounds 51/60/100 after wrap-up NEVER force-stop',
    [51, 60, 100].every((n) => decide(n, 0, true) === 'none'),
    'none,none,none', [51, 60, 100].map((n) => decide(n, 0, true)))
  add('029-P control: positive grace reaches force-stop at cap+grace',
    decide(52, 2, true) === 'force-stop' && decide(51, 2, true) === 'none',
    '51=none, 52=force-stop', [decide(51, 2, true), decide(52, 2, true)])
  const soft = wrapupMessage(50, 0)
  const hard = wrapupMessage(50, 2)
  add('029-P wrap-up text names the 50-round cap and carries no force-stop threat',
    soft.includes('Round limit reached (50') && soft.includes('Do NOT call any more tools')
      && !soft.includes('force-stopped'),
    '50 cap + no threat', soft.slice(0, 160))
  add('029-P positive-grace wrap-up text announces the coming force-stop',
    hard.includes('2 more rounds') && hard.includes('force-stopped'),
    '2 more rounds + force-stop', hard.slice(-80))

  return checks
}
