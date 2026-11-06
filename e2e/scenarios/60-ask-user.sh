#!/usr/bin/env bash
# Scenario 60 — ask_user_question: the F5 batch ask picker over the baked
# mock endpoint (feature batch F5, tui-pi parity; see
# packages/tui-base/src/routes/session/turn-overlays.tsx and
# turn-overlay-controller.ts).
#
# Pre-F5 this surface was a strictly sequential one-question-at-a-time
# DialogSelect with no tab strip, no multi-select toggle and no review page.
# F5 replaced it with ONE batch picker over the whole question list:
#
#   - progress title `Question (i/n): <prompt>` (questions >= 2);
#   - a tab strip description `[1] · 2✓ · 3` and a `space: toggle` hint —
#     NOTE: the vendored DialogSelect paints `description` only in the
#     newDesigns theme mode (dist-host DialogHeader gates on it), which the
#     baked profile does not enable, so the strip is NOT visible in the
#     pane and the scenario cannot assert it — controller unit tests cover
#     it instead;
#   - ←/→ switch tabs, space/enter toggle — a single-select pick REPLACES
#     and AUTO-ADVANCES to the next unanswered question, a multiSelect
#     pick toggles membership in place (`[x] label` / `[ ] label`);
#   - a `⏎ Review answers` row once the batch needs a review (>= 2
#     questions or any multiSelect); enter there flips to the review page
#     (title `Review answers`) that lists every question with its picks
#     plus a `⏎ Submit answers` row;
#   - ← on the review page returns to the questions (edit), enter on the
#     submit row settles the batch. Esc anywhere still declines all.
#
# The mock streams THREE questions (two single-select + one multi_select,
# e2e/lib/mock-llm.mjs QUESTIONS), so the scenario asserts the full F5
# ladder:
#
#   1. question 1 renders with its (1/3) progress title, bracket-less
#      single-select option rows and the review row — questions 2/3 stay
#      unrendered;
#   2. enter on `staging` auto-advances to question 2 — the progress title
#      flips to (2/3);
#   3. down+enter picks `chatty` (second-option pick preserved from the
#      pre-F5 script) and focus lands on question 3, whose multiSelect
#      rows render bracketed UNchecked (`[ ] lint` / `[ ] smoke`);
#   4. space toggles BOTH extras on in place (`[x] lint`, `[x] smoke`) and
#      the picker stays on question 3 (multiSelect never auto-advances);
#   5. enter on the review row opens the review page: every question with
#      its picks (`… deployed?  staging`, `… verbose…?  quiet`, `… checks
#      should run?  lint, smoke`) + the submit row;
#   6. ← returns to the questions view with the toggles intact; the review
#      row re-opens the review page;
#   7. enter on `⏎ Submit answers` settles the batch: the overlay closes,
#      the mock serves its scripted final phase and E2E-ASK-FLOW-COMPLETE
#      renders;
#   8. envelope evidence: the mock dumps the tool-result request body
#      (MOCK_DUMP_DIR) and it carries the multiSelect answer as a
#      TWO-ELEMENT ARRAY — `selected:["lint","smoke"]` — next to the
#      single picks (host-session registerAskProvider wire shape).
#
# Marker shapes below are from a REAL container capture of the F5 build
# (140x36 pane). The dialog title wraps at the pane width — the (1/3) and
# (2/3) titles break mid-sentence with the `esc` hint glued or gapped — so
# title markers assert the stable `Question (i/n): <first words>` prefix,
# not the full line. Like scenario 40, no config is mutated at runtime —
# the endpoint wiring is bake-time only — and the scenario skips on the
# host.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'ask-user: F5 batch ask picker (multiSelect toggle, review page) over the baked mock endpoint'

# Picker markers, from a real container capture (F5 build). The transcript
# ALSO paints the tool call as one row of raw arguments JSON
# (`* ask_user_question({"q…`, cut at the pane width), so bare question
# text is not proof of the picker — the `Question (i/n):` progress prefix
# only exists on the picker's DialogHeader title row.
#   "  Question (1/3): Where should the e2e bundle be   esc"
#   "  deployed?"
#   "  staging"
progress_title() { printf 'Question \\(%s/3\\): %s' "$1" "$2"; }  # ERE: title prefix (wraps)
option_row() { printf '^ +%s *$' "$1"; }                          # ERE: option row
review_title_row() { printf '^ +Review answers +esc *$'; }        # ERE: review page header
assert_no_match() {
  local label="$1" ere="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -qE -- "$ere"; then
    bad "$label (ERE still matched: $ere); haystack tail:"
    printf '%s\n' "$haystack" | tail -6 | sed 's/^/    | /'
    return 1
  fi
  ok "$label"
}
Q1='Where should'
Q2='How verbose'
Q3='Which extra checks should run\?'

# --- host guard -------------------------------------------------------------
if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (sends a live agent turn); container only'
  summary
  exit 0
fi

# --- the mock LLM server ------------------------------------------------------
MOCK_PORT=8642
MOCK_LOG=/tmp/mock-llm-60.log
MOCK_DUMP_DIR=/tmp/mock-dump-60
rm -rf "$MOCK_DUMP_DIR"
mkdir -p "$MOCK_DUMP_DIR"
MOCK_DUMP_DIR="$MOCK_DUMP_DIR" node "$(dirname "$0")/../lib/mock-llm.mjs" --port "$MOCK_PORT" >"$MOCK_LOG" 2>&1 &
MOCK_PID=$!
cleanup() { kill "$MOCK_PID" 2>/dev/null || true; }
trap cleanup EXIT

MOCK_UP=0
for _ in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:$MOCK_PORT/healthz" >/dev/null 2>&1; then
    MOCK_UP=1
    break
  fi
  sleep 1
done
if (( MOCK_UP == 1 )); then
  ok "mock LLM server up on 127.0.0.1:$MOCK_PORT"
else
  bad "mock LLM server did not come up; log tail:"
  tail -10 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi

# --- baked wiring proof + TUI boot -------------------------------------------
if grep -qF '127.0.0.1:8642' "$HOME/.dsh/profiles/dsh-opentui/cordis.patch.yml" 2>/dev/null; then
  ok 'baked profile patch points the pinned provider at the mock endpoint'
else
  bad 'profile patch lacks the mock baseURL (bake step missing)'
fi

if ! tui_alive; then
  info 'TUI not running — starting fresh'
  start_tui
  wait_tui_up 120 || { summary; exit 0; }
fi
PANE="$(capture)"
assert_contains 'footer still paints the pinned provider segment' "$MARKER_PROVIDER_SEG" "$PANE"

# --- trigger: the mock's ask phase opens the batch picker on question 1 -------
ensure_editor_ready 'editor clean before the ask trigger' || true
send 'Ask me the deployment questions now. E2E_ASK_TRIGGER'
sleep 1
send Enter
# Full chain: composer send -> agent loop -> mock SSE ask phase -> tool
# dispatch -> user-questions/request -> the F5 batch picker mounts.
if ! wait_pane 'the ask tool opens the batch picker on question 1' 60 "$(progress_title 1 "$Q1")"; then
  info 'picker never opened — mock server log tail:'
  tail -10 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi
PANE="$(capture)"

# --- 1. one batch dialog, one focused question ---------------------------------
assert_matches 'question 1 renders with the (1/3) progress title' "$(progress_title 1 "$Q1")" "$PANE"
assert_matches 'question 1 option row staging renders bracket-less' "$(option_row staging)" "$PANE"
assert_matches 'question 1 option row production renders bracket-less' "$(option_row production)" "$PANE"
assert_no_match 'single-select options render without toggle brackets' "$(option_row '\[.\] staging')" "$PANE"
assert_matches 'the review row is offered on the multi-question batch' "$(option_row '⏎ Review answers')" "$PANE"
assert_no_match 'question 2 stays unrendered while question 1 is focused' "$(progress_title 2 "$Q2")" "$PANE"
assert_no_match 'question 3 stays unrendered while question 1 is focused' "$(progress_title 3 "$Q3")" "$PANE"
assert_no_match 'question 2 option rows stay unrendered' "$(option_row quiet)" "$PANE"
assert_contains 'transcript records the ask_user_question tool call' 'ask_user_question(' "$PANE"

# --- 2. enter on a single-select pick auto-advances to question 2 ---------------
# The picker starts on the first row (staging); enter replaces the pick and
# auto-advances to the next unanswered question.
send Enter
if ! wait_pane 'enter on question 1 auto-advances to the (2/3) title' 15 "$(progress_title 2 "$Q2")"; then
  summary
  exit 0
fi
PANE="$(capture)"
assert_matches 'question 2 option row quiet renders' "$(option_row quiet)" "$PANE"
assert_matches 'question 2 option row chatty renders' "$(option_row chatty)" "$PANE"
assert_no_match 'question 1 title is gone after the pick' "$(progress_title 1 "$Q1")" "$PANE"
assert_no_match 'question 1 option rows are gone after the pick' "$(option_row production)" "$PANE"

# --- 3. down+enter picks the second option; focus lands on multiSelect q3 -------
# Selection sits on the first row (quiet) after the auto-advance; up is a
# no-op clamp, down+enter picks `chatty` — the second-option pick the pre-F5
# script asserted — and question 3 being still open means the focus
# AUTO-ADVANCES onto it.
send Up
sleep 0.5
send Down
sleep 1
send Enter
if ! wait_pane 'the (3/3) multiSelect question follows the second pick' 15 "$(progress_title 3 "$Q3")"; then
  summary
  exit 0
fi
PANE="$(capture)"
assert_matches 'multiSelect rows render as bracketed UNchecked' "$(option_row '\[ \] lint')" "$PANE"
assert_matches 'multiSelect second option renders unchecked' "$(option_row '\[ \] smoke')" "$PANE"
assert_matches 'the review row follows the multiSelect rows' "$(option_row '⏎ Review answers')" "$PANE"
assert_no_match 'question 2 title is gone after the pick' "$(progress_title 2 "$Q2")" "$PANE"
assert_no_match 'question 2 option rows are gone after the pick' "$(option_row chatty)" "$PANE"

# --- 4. space toggles multiSelect membership in place ---------------------------
# Space is the advertised toggle binding. The dialog selection PERSISTS
# across the auto-advance (it stays on the smoke row here), so clamp to the
# first row with Up presses first — then Space toggles lint ON and the
# picker STAYS on question 3 (multiSelect never auto-advances).
send Up
sleep 0.5
send Up
sleep 0.5
send Up
sleep 1
send Space
if ! wait_pane 'space toggles lint on in place' 15 "$(option_row '\[x\] lint')"; then
  summary
  exit 0
fi
PANE="$(capture)"
assert_matches 'the picker stays on question 3 after the toggle' "$(progress_title 3 "$Q3")" "$PANE"
assert_matches 'smoke is still unchecked after the lint toggle' "$(option_row '\[ \] smoke')" "$PANE"
send Down
sleep 1
send Space
if ! wait_pane 'space toggles smoke on as well' 15 "$(option_row '\[x\] smoke')"; then
  summary
  exit 0
fi
PANE="$(capture)"
assert_matches 'lint stays toggled after the second toggle' "$(option_row '\[x\] lint')" "$PANE"
assert_matches 'the picker still stays on question 3' "$(progress_title 3 "$Q3")" "$PANE"

# --- 5. the review row opens the review page -------------------------------------
# After toggling smoke the selection sits on the smoke row; one Down lands on
# the `⏎ Review answers` row, enter flips to the review phase.
send Down
sleep 1
send Enter
if ! wait_pane 'enter on the review row opens the review page' 15 "$(review_title_row)"; then
  summary
  exit 0
fi
PANE="$(capture)"
assert_matches 'review lists question 1 with its pick' 'deployed\? +staging *$' "$PANE"
assert_matches 'review lists question 2 with its pick' 'log be\? +quiet *$' "$PANE"
assert_matches 'review lists question 3 with BOTH toggled picks' 'should run\? +lint, smoke *$' "$PANE"
assert_matches 'the review page offers the submit row' "$(option_row '⏎ Submit answers')" "$PANE"
assert_no_match 'the questions view is gone on the review page' "$(progress_title 1 "$Q1")" "$PANE"

# --- 6. ← returns to the questions view with the toggles intact ------------------
send Left
if ! wait_pane 'left on the review page returns to question 3' 15 "$(progress_title 3 "$Q3")"; then
  summary
  exit 0
fi
PANE="$(capture)"
assert_matches 'the lint toggle survived the review round-trip' "$(option_row '\[x\] lint')" "$PANE"
assert_matches 'the smoke toggle survived the review round-trip' "$(option_row '\[x\] smoke')" "$PANE"

# Re-open the review page: two Downs land on the review row whether the
# dialog selection reset to lint or stayed on smoke.
send Down
sleep 0.8
send Down
sleep 0.8
send Enter
if ! wait_pane 'the review row re-opens the review page' 15 "$(review_title_row)"; then
  summary
  exit 0
fi

# --- 7. enter on the submit row settles the batch -> final answer ----------------
# The reopened review page starts the selection on the question 1 row; three
# Downs reach the `⏎ Submit answers` row (rows: q1, q2, q3, submit), whatever
# the selection preserved.
send Down
sleep 0.8
send Down
sleep 0.8
send Down
sleep 0.8
send Enter
if ! wait_gone 'the ask overlay closes after the submit row' 15 "$(review_title_row)"; then
  summary
  exit 0
fi
if ! wait_pane 'the mock final answer renders in the transcript' 60 'E2E-ASK-FLOW-COMPLETE'; then
  info 'no final answer — mock server log tail:'
  tail -10 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi
PANE="$(capture)"
assert_contains 'the final text is the scripted one' 'E2E-ASK-FLOW-COMPLETE' "$PANE"
assert_no_match 'no ask picker remains after the batch settles' 'esc *$' "$PANE"

# --- 8. the settled envelope carries the multiSelect answer as an array ----------
# The mock dumps every tool-result request body (MOCK_DUMP_DIR); the F5 wire
# shape answers question 3 with `selected` as a two-element ARRAY (both
# toggled labels), question 1/2 with one-element arrays. The tool-result
# text rides INSIDE the request's message content, so the quotes are
# JSON-escaped on the wire (confirmed against a real dump).
DUMP="$MOCK_DUMP_DIR/last-tool-result-body.json"
MULTI_ESC='\"selected\":[\"lint\",\"smoke\"]'
SINGLE_ESC='\"selected\":[\"staging\"]'
if [ -s "$DUMP" ]; then
  ok 'the mock captured the tool-result request body'
  if grep -qF -- "$MULTI_ESC" "$DUMP" 2>/dev/null; then
    ok 'the envelope carries the multiSelect picks as selected:[lint,smoke]'
  else
    bad 'the envelope lacks the two-element multiSelect selected array; dump tail:'
    tail -c 600 "$DUMP" | sed 's/^/    | /'
  fi
  if grep -qF -- "$SINGLE_ESC" "$DUMP" 2>/dev/null; then
    ok 'the envelope carries the single-select pick selected:[staging]'
  else
    bad 'the envelope lacks the single-select selected array; dump tail:'
    tail -c 600 "$DUMP" | sed 's/^/    | /'
  fi
else
  bad 'the mock never dumped the tool-result body (no envelope evidence)'
fi

# --- 9. the mock served both scripted phases ------------------------------------
if grep -q 'phase=ask' "$MOCK_LOG" 2>/dev/null; then
  ok 'the mock served the scripted ask phase (tool call streamed)'
else
  bad 'the mock never logged phase=ask; log tail:'
  tail -8 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
fi
if grep -q 'phase=final' "$MOCK_LOG" 2>/dev/null; then
  ok 'the mock served the scripted final phase (tool result flowed back)'
else
  bad 'the mock never saw the tool-result turn; log tail:'
  tail -8 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
fi

summary
