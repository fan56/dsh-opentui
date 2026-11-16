#!/usr/bin/env bash
# Scenario 60 — ask_user_question: the DOCKED batch ask panel over the baked
# mock endpoint (see packages/tui-base/src/routes/session/ask-panel.tsx,
# ask-keys.ts, ask-options.ts and turn-overlay-controller.ts;
# docs/ask-user-panel-spec.md).
#
# The surface is a bottom-docked, full-width IN-FLOW dock, not a centered
# dialog. Rows, top to bottom:
#
#   - a full-width top rule;
#   - the eyebrow (`question.header`, muted) and the full wrapped prompt;
#   - a tab strip `[1] · 2 · 3` (`[n]` focused, `n ✓` answered) — this
#     REPLACED the pre-merge `Question (i/n): <prompt>` dialog title;
#   - numbered option rows `› ○ 1. staging`: a cursor cell, then the
#     selection-state glyph (2-cell slot: `●`/`○` single-select,
#     `■`/`□` multi-select), then `N.`; a Recommended label paints a
#     `[Recommended]` badge (this mock sends none);
#   - a `⏎ Review answers` row when the batch needs the review page;
#   - a RESIDENT inline input row, always last and always visible:
#     `✎ Type something.` (placeholder `overlay.ask.inputPlaceholder`). It
#     replaced the old sentinel row + screen-swap editor, so it does NOT
#     disappear while the list is focused;
#   - a footer hint line (`overlay.ask.footer.*`) whose Esc clause names the
#     current ladder stage (`overlay.ask.esc.*`), and a full-width bottom
#     rule.
#
# Keys: ←/→ switch questions, ↑↓ move, space toggles a multiSelect row, a
# printable character moves focus into the resident inline input, Enter picks
# a single-select option (REPLACES and AUTO-ADVANCES to the next unanswered
# question) or confirms a multiSelect question. The review page (title
# `Review answers`) lists each question as `✓ <prompt>` with its answer on
# the NEXT line (`→ staging`), plus `⏎ Submit answers`. Esc walks one
# monotonic ladder stage per press.
#
# The mock streams THREE questions (two single-select + one multi_select,
# e2e/lib/mock-llm.mjs QUESTIONS), so the scenario asserts the full ladder:
#
#   1. question 1 renders with the strip on `[1]`, the eyebrow + prompt,
#      `○` single-select rows, the review row and the resident
#      `✎ Type something.` row — questions 2/3 stay unrendered;
#   2. enter on `staging` auto-advances to question 2 — the strip flips to
#      `1 ✓ · [2] · 3`;
#   3. down+enter picks `chatty` and focus lands on question 3, whose
#      multiSelect rows render `□` (hollow box, UNchecked);
#   4. space toggles BOTH extras on in place (`■ lint`, `■ smoke`) and the
#      panel stays on question 3 (multiSelect never auto-advances);
#   5. enter on the review row opens the review page: each question with
#      `✓ <prompt>` and its own `→ <answer>` line (`→ staging`,
#      `→ chatty`, `→ lint, smoke`) + the submit row;
#   6. ← returns to the questions view with the toggles intact; the review
#      row re-opens the review page;
#   7. enter on `⏎ Submit answers` settles the batch: the dock closes, the
#      composer returns, the mock serves its scripted final phase and
#      E2E-ASK-FLOW-COMPLETE renders;
#   8. envelope evidence: the mock dumps the tool-result request body
#      (MOCK_DUMP_DIR) and it carries the multiSelect answer as a
#      TWO-ELEMENT ARRAY — `selected:["lint","smoke"]` — next to the
#      single picks (host-session registerAskProvider wire shape).
#
# Every row shape below is taken from a REAL tmux capture of the MERGED
# build (commit 632b684, 140x36 pane, English locale), saved under
# /private/tmp/dsh-ask-verify/frames-merged/ (13-clean-initial,
# 14-clean-cursor-down, 17-multiselect-unchecked, 18-multiselect-toggled,
# 20-review-page, 24-review-submit-focused, 26-settled-transcript,
# 28-settled-block-container — the last one plain text from the e2e
# container, which is where the settled `✔ask_user_question` row paints).
# Like scenario 40, no config is mutated at runtime — the endpoint wiring is
# bake-time only — and the scenario skips on the host.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'ask-user: docked batch ask panel (tab strip, inline input, review page) over the baked mock endpoint'

# --- surface markers, from the merged-build capture (frame names noted) ----
# The tab strip (`askTabStrip`): the FOCUSED question is bracketed and an
# answered question carries `✓`. Args: focused 1-based index, then every
# answered 1-based index. Brackets are ERE-escaped because assert_matches
# greps with -E.
#   tab_strip 1        -> \[1\] · 2 · 3            (13-clean-initial)
#   tab_strip 2 1      -> 1 ✓ · \[2\] · 3          (16-question2)
#   tab_strip 3 1 2 3  -> 1 ✓ · 2 ✓ · \[3 ✓\]      (18-multiselect-toggled)
tab_strip() {
  local focused="$1" i a label out=""
  shift
  for i in 1 2 3; do
    label="$i"
    for a in "$@"; do
      if [ "$a" = "$i" ]; then label="$i ✓"; fi
    done
    if [ "$i" = "$focused" ]; then label="\\[$label\\]"; fi
    out="${out:+$out · }$label"
  done
  printf '%s' "$out"
}
# A numbered option row, e.g. `  › ○ 1. staging` (13-clean-initial) or
# `    □ 2. smoke` (17-multiselect-unchecked): gutter/border padding, an
# OPTIONAL cursor cell (`› `), then the mandatory 2-cell state glyph, then
# `N. `. The default glyph class accepts any state; pass a glyph to pin it.
option_row() {
  printf '^[│┃ ]*(› )?[ ]*%s [0-9]+[.] %s[│┃ ]*$' "${2:-[●○■□]}" "$1"
}
# The same row but REQUIRING the cursor `›` — the active row, which is what
# select_row walks to (`  › ● 1. staging`, frame 15-question1-selected).
cursor_row() {
  printf '^[│┃ ]*› [ ]*%s [0-9]+[.] %s[│┃ ]*$' "${2:-[●○■□]}" "$1"
}
# The Enter affordance rows `⏎ Review answers` / `⏎ Submit answers`: cursor
# cell (optional) then the label, no state glyph and no number.
panel_action_row() { printf '^[│┃ ]*(› )?[ ]*%s[│┃ ]*$' "$1"; }
# Review-page rows (20-review-page): the prompt line carries `✓ ` and the
# answer is the NEXT line, `      → staging`. The pre-merge page put both on
# one line (`… deployed?  staging`), which no longer matches anything.
review_question_row() { printf '^[│┃ ]*(› )?[ ]*✓ .*%s.*[│┃ ]*$' "$1"; }
review_answer_row() { printf '^[│┃ ]*→ %s[│┃ ]*$' "$1"; }
# The review PAGE marker is its footer hint (`↑↓ move  ⏎ edit  esc: back to
# question`, frame 20) — not the title: the questions view also paints a
# `⏎ Review answers` row, and the title alone could be a row label.
review_page_marker() { printf '↑↓ move  ⏎ edit  esc: back to question'; }
# Row assertions print the WHOLE pane on failure: the panel is the last block
# before the status line and the shared helpers only tail a few lines.
# Walk the panel selection down until the row carrying this label is the
# ACTIVE row (painted `›`), then leave the cursor there. Unlike the pre-merge
# helper this does not need SGR bold: the plain capture marks the active row
# with the cursor cell, and nothing outside the dock paints a row starting
# with `›`. Down is the only reliable mover here (Up/Down clamp at the ends;
# Home/End land on the resident inline row, which then owns the keys).
select_row() {
  local label="$1" attempts="${2:-6}" _
  for _ in $(seq 1 "$attempts"); do
    if capture | grep -qE -- "^[│┃ ]*› .*${label}"; then return 0; fi
    send Down
    sleep 0.7
  done
  capture | grep -qE -- "^[│┃ ]*› .*${label}"
}
assert_row() {
  local label="$1" ere="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -qE -- "$ere"; then
    ok "$label"
    return 0
  fi
  bad "$label (ERE not matched: $ere); full pane:"
  printf '%s\n' "$haystack" | sed 's/^/    | /'
  return 1
}
assert_no_match() {
  local label="$1" ere="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -qE -- "$ere"; then
    bad "$label (ERE still matched: $ere); haystack tail:"
    printf '%s\n' "$haystack" | tail -6 | sed 's/^/    | /'
    return 1
  fi
  ok "$label"
}
Q1='Where should the e2e bundle be deployed'
Q2='How verbose should the deploy log be'
Q3='Which extra checks should run'

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
# Client face (batch B5): the profile lives under the scratch DSH_HOME
# (FACE_PATCH from lib/common.sh), not the retired baked /root/.dsh profile.
# ensure_client_profile makes the proof order-independent (a scenario that
# runs before the first start_tui must not skip a live assertion).
ensure_client_profile >/dev/null 2>&1 || true
if grep -qF '127.0.0.1:8642' "$FACE_PATCH" 2>/dev/null; then
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

# --- trigger: the mock's ask phase opens the docked panel on question 1 --------
ensure_editor_ready 'editor clean before the ask trigger' || true
send 'Ask me the deployment questions now. E2E_ASK_TRIGGER'
sleep 1
send Enter
# Full chain: composer send -> agent loop -> mock SSE ask phase -> tool
# dispatch -> user-questions/request -> the docked ask panel mounts with the
# resident inline row as its last line.
if ! wait_pane 'the ask tool opens the docked panel on question 1' 60 '✎ Type something\.'; then
  info 'panel never opened — mock server log tail:'
  tail -10 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi
PANE="$(capture)"

# --- 1. one docked panel, one focused question ---------------------------------
# Rows quoted from 13-clean-initial:
#   "  Deploy target"
#   "  Where should the e2e bundle be deployed?"
#   "  [1] · 2 · 3"
#   "  › ○ 1. staging"
#   "    ⏎ Review answers"
#   "  ✎ Type something."
#   "  ↑↓ move  1-9 pick  ⏎ confirm  esc: decline"
assert_row 'question 1 renders with the first tab of the strip' "$(tab_strip 1)" "$PANE"
assert_matches 'the eyebrow renders the question header' '^  Deploy target$' "$PANE"
assert_contains 'the full question text renders as the title' "$Q1?" "$PANE"
assert_row 'question 1 option staging renders with the hollow dot' "$(option_row staging '○')" "$PANE"
assert_row 'question 1 option production renders with the hollow dot' "$(option_row production '○')" "$PANE"
assert_row 'the first option row carries the cursor' "$(cursor_row staging '○')" "$PANE"
assert_row 'the review row is offered on the multi-question batch' "$(panel_action_row '⏎ Review answers')" "$PANE"
assert_contains 'the resident inline input row is painted last' '✎ Type something.' "$PANE"
assert_contains 'the options footer advertises the new keys' '↑↓ move  1-9 pick  ⏎ confirm  esc: decline' "$PANE"
# The live activity row is the only place the raw tool call appears: while
# the batch is open it paints `⚙ask_user_question · <dur> · {"questions":…`.
assert_contains 'the live activity row records the ask tool call' 'ask_user_question' "$PANE"
# The old surface is gone: no `Question (i/n)` dialog title, no bracket rows.
assert_no_match 'the old (i/n) progress title is gone' 'Question \([0-9]+/[0-9]+\)' "$PANE"
assert_no_match 'single-select rows no longer use toggle brackets' '\[[ x]\] (staging|production)' "$PANE"
# Questions 2/3 stay unrendered while question 1 is focused. The title is
# matched ANCHORED (gutter + end of line) so the truncated raw-JSON activity
# row cannot stand in for a painted title on a wider terminal.
assert_no_match 'question 2 title stays unrendered' "^  ${Q2}\?$" "$PANE"
assert_no_match 'question 3 title stays unrendered' "^  ${Q3}\?$" "$PANE"
assert_no_match 'question 2 option rows stay unrendered' "$(option_row quiet)" "$PANE"
assert_no_match 'question 3 option rows stay unrendered' "$(option_row lint)" "$PANE"

# --- 2. enter on a single-select pick auto-advances to question 2 ---------------
# The panel starts on the first row (staging); enter replaces the pick and
# auto-advances to the next unanswered question. Frame 16:
#   "  How verbose should the deploy log be?"
#   "  1 ✓ · [2] · 3"
#   "  › ○ 1. quiet"
send Enter
if ! wait_pane 'enter on question 1 auto-advances to question 2' 15 "$(tab_strip 2 1)"; then
  summary
  exit 0
fi
PANE="$(capture)"
assert_matches 'question 2 eyebrow renders' '^  Verbosity$' "$PANE"
assert_row 'question 2 option quiet renders with the hollow dot' "$(option_row quiet '○')" "$PANE"
assert_row 'question 2 option chatty renders with the hollow dot' "$(option_row chatty '○')" "$PANE"
assert_no_match 'question 1 title is gone after the pick' "^  ${Q1}\?$" "$PANE"
assert_no_match 'question 1 option rows are gone after the pick' "$(option_row production)" "$PANE"

# --- 3. down+enter picks the second option; focus lands on multiSelect q3 -------
# Selection sits on the first row (quiet) after the auto-advance; up is a
# no-op clamp, down+enter picks `chatty` — the second-option pick the pre-merge
# script asserted — and question 3 being still open means the focus
# AUTO-ADVANCES onto it. Frame 17:
#   "  1 ✓ · 2 ✓ · [3]"
#   "  › □ 1. lint"
#   "    □ 2. smoke"
send Up
sleep 0.5
send Down
sleep 1
send Enter
if ! wait_pane 'the multiSelect question follows the second pick' 15 "$(tab_strip 3 1 2)"; then
  summary
  exit 0
fi
PANE="$(capture)"
assert_matches 'question 3 eyebrow renders' '^  Extras$' "$PANE"
assert_row 'multiSelect rows render as hollow UNchecked boxes' "$(option_row lint '□')" "$PANE"
assert_row 'multiSelect second option renders as a hollow box' "$(option_row smoke '□')" "$PANE"
assert_row 'the first multiSelect row carries the cursor' "$(cursor_row lint '□')" "$PANE"
assert_row 'the review row follows the multiSelect rows' "$(panel_action_row '⏎ Review answers')" "$PANE"
assert_contains 'the multiSelect footer advertises space toggle' '↑↓ move  space toggle  ⏎ confirm  esc: previous question' "$PANE"
assert_no_match 'multiSelect rows no longer use bracket checkboxes' '\[[ x]\] (lint|smoke)' "$PANE"
assert_no_match 'question 2 title is gone after the pick' "^  ${Q2}\?$" "$PANE"
assert_no_match 'question 2 option rows are gone after the pick' "$(option_row chatty)" "$PANE"

# --- 4. space toggles multiSelect membership in place ---------------------------
# Space is the advertised toggle binding and it acts on the ACTIVE row. The
# cursor persists across switches, so walk to the target row by its `›` state
# instead of counting keypresses (the inline row is also in the cursor space).
# Space toggles lint ON and the panel STAYS on question 3 (multiSelect never
# auto-advances); the tab strip gains `✓` on 3 (frame 18):
#   "  1 ✓ · 2 ✓ · [3 ✓]"
#   "    ■ 1. lint"
#   "  › ■ 2. smoke"
select_row lint
sleep 0.5
send Space
if ! wait_pane 'space toggles lint on in place' 15 "$(option_row lint '■')"; then
  summary
  exit 0
fi
PANE="$(capture)"
assert_row 'the panel stays on question 3 after the toggle' "$(tab_strip 3 1 2 3)" "$PANE"
assert_row 'smoke is still a hollow box after the lint toggle' "$(option_row smoke '□')" "$PANE"
select_row smoke
sleep 0.5
send Space
if ! wait_pane 'space toggles smoke on as well' 15 "$(option_row smoke '■')"; then
  summary
  exit 0
fi
PANE="$(capture)"
assert_row 'lint stays a filled box after the second toggle' "$(option_row lint '■')" "$PANE"
assert_row 'the panel still stays on question 3' "$(tab_strip 3 1 2 3)" "$PANE"

# --- 5. the review row opens the review page -------------------------------------
# Walk down until the review row IS the active row, then Enter (selection-state
# independent). Frame 20 rows:
#   "  Review answers"
#   "  1 ✓ · 2 ✓ · [3 ✓]"
#   "  › ✓ Where should the e2e bundle be deployed?"
#   "      → staging"
#   "    ⏎ Submit answers"
#   "  ↑↓ move  ⏎ edit  esc: back to question"
if select_row 'Review answers'; then
  ok 'walked to the review row (active)'
  send Enter
else
  bad 'the review row never became the active row (down-walk exhausted); pane:'
  capture | tail -20 | sed 's/^/    | /'
  summary
  exit 0
fi
if ! wait_pane 'enter on the review row opens the review page' 15 "$(review_page_marker)"; then
  summary
  exit 0
fi
PANE="$(capture)"
assert_row 'review lists question 1 with its check mark' "$(review_question_row "$Q1")" "$PANE"
assert_row 'review lists question 1 answer on its own line' "$(review_answer_row staging)" "$PANE"
assert_row 'review lists question 2 with its check mark' "$(review_question_row "$Q2")" "$PANE"
assert_row 'review lists question 2 answer on its own line' "$(review_answer_row chatty)" "$PANE"
assert_row 'review lists question 3 with BOTH toggled picks' "$(review_answer_row 'lint, smoke')" "$PANE"
assert_row 'the review page offers the submit row' "$(panel_action_row '⏎ Submit answers')" "$PANE"
assert_contains 'the review footer advertises edit and Esc' '↑↓ move  ⏎ edit  esc: back to question' "$PANE"
assert_no_match 'the questions view is gone on the review page' "$(option_row staging)" "$PANE"
assert_no_match 'the question eyebrow is gone on the review page' '^  Deploy target$' "$PANE"

# --- 6. ← returns to the questions view with the toggles intact ------------------
send Left
# The tab strip is painted on BOTH pages, so it cannot prove the return to the
# questions view; the resident inline row (`✎ Type something.`) exists only in
# the questions view. Wait for it, then assert the strip and the toggles.
if ! wait_pane 'left on the review page returns to question 3' 15 '✎ Type something\.'; then
  summary
  exit 0
fi
PANE="$(capture)"
assert_row 'the questions view is back on question 3' "$(tab_strip 3 1 2 3)" "$PANE"
assert_row 'the lint toggle survived the review round-trip' "$(option_row lint '■')" "$PANE"
assert_row 'the smoke toggle survived the review round-trip' "$(option_row smoke '■')" "$PANE"

# Re-open the review page: the same down-walk to the review row.
if select_row 'Review answers'; then
  ok 'walked back to the review row (active)'
  send Enter
else
  bad 'the review row never became active on the second pass'
  summary
  exit 0
fi
if ! wait_pane 'the review row re-opens the review page' 15 "$(review_page_marker)"; then
  summary
  exit 0
fi

# --- 7. enter on the submit row settles the batch -> final answer ----------------
# On the review page the last row is `⏎ Submit answers`; walk down to it (the
# selection the reopened page starts on is not guaranteed) and submit.
if select_row 'Submit answers'; then
  ok 'walked to the submit row (active)'
  send Enter
else
  bad 'the submit row never became the active row'
  summary
  exit 0
fi
if ! wait_gone 'the ask dock closes after the submit row' 15 "$(review_page_marker)"; then
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
# Settlement evidence (real e2e-container capture): the composer is back, the
# ask rows are gone, and the ask call folds into ONE settled transcript row
# (note the `✔` prefix and the ANSWERS envelope, unlike the transient `⚙` row
# asserted in step 1):
#   "   ✔ask_user_question · 12.1s · {\"answers\":[{\"id\":\"deploy-target\",
#    \"selected\":[\"staging\"]},…"
# The row is cut at the pane width, so the stable markers are the call name and
# the start of the envelope. The durable per-question Q&A block (`Deploy
# target` / `✓ <prompt>` / `→ staging`) renders on REPLAY (`--session`), frame
# 27-replay-ask-block.
assert_contains 'the composer is back after the batch settles' "$MARKER_COMPOSER_PLACEHOLDER" "$PANE"
assert_not_contains 'the resident ask input row is gone' '✎ Type something.' "$PANE"
assert_contains 'the settled transcript records the ask tool call' 'ask_user_question ·' "$PANE"
assert_contains 'the settled ask row carries the answers envelope' '"answers":[{"id":"deploy-target","selected":["staging"]}' "$PANE"
assert_no_match 'no ask key-hint footer remains' 'esc: (decline|back to options|previous question|back to question)' "$PANE"

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
