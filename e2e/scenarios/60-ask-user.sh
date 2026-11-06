#!/usr/bin/env bash
# Scenario 60 — ask_user_question: the ask overlay answers through the
# baked mock endpoint (ported from dsh-tui-pi scenario 68-ask-user.sh).
#
# The tui-pi original drives a DOCKED ask panel (tab strip, (1/3) title,
# single-select auto-advance, ←/→ tab hops, multi-select toggles, Ctrl+T
# fold, Confirm → review page). The opentui ask surface is a DIFFERENT,
# deliberately sequential UI (packages/tui-base/src/routes/session/
# turn-overlays.tsx): the ask_user_question tool call opens an AskPicker —
# a DialogSelect dialog showing ONE question at a time (title = question
# text, rows = option labels); enter records the pick and advances to the
# next question's picker, the LAST pick settles the whole batch (no
# review page), esc declines everything, up/down move the selection
# (config/keybind.ts: dialog.select.prev=up, next=down, submit=return).
# There is no tab strip, no multi-select toggle and no Ctrl+T fold here —
# this scenario asserts the reference's flow on OUR surface's terms:
#
#   trigger prompt (E2E_ASK_TRIGGER) -> mock streams the ask_user_question
#   tool call (two single-select + one multi-select question, scripted in
#   e2e/lib/mock-llm.mjs) and the scenario asserts:
#
#   1. the ask overlay renders question 1 with its option rows, and ONLY
#      question 1 (questions 2/3 stay unrendered);
#   2. enter on an option auto-advances to question 2's picker (question 1
#      is gone);
#   3. down-arrow moves the selection inside the picker and enter on the
#      second option advances to question 3's picker;
#   4. enter on question 3 settles the batch: the overlay closes, the tool
#      result flows back, the mock serves its scripted final phase and the
#      final assistant text E2E-ASK-FLOW-COMPLETE renders in the transcript;
#   5. the mock log shows BOTH phases served (phase=ask, phase=final).
#
# Like scenario 40, no config is mutated at runtime — the endpoint wiring
# is bake-time only — and the scenario skips on the host.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'ask-user: sequential ask picker over the baked mock endpoint'

# Picker markers, from a real container capture. The transcript ALSO paints
# the tool call as one row of raw arguments JSON (`* ask_user_question({"q…`,
# cut at the pane width), so bare question text is not proof of the picker.
# The picker's own rows are: the DialogHeader title line (question text, a
# gap, then the `esc` close hint) and one label-only line per option.
#   "      How verbose should the deploy log be?            esc"
#   "      quiet"
picker_title() { printf '%s +esc *$' "$1"; }          # ERE: picker title row
option_row() { printf '^ +%s *$' "$1"; }              # ERE: option row
assert_no_match() {
  local label="$1" ere="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -qE -- "$ere"; then
    bad "$label (ERE still matched: $ere); haystack tail:"
    printf '%s\n' "$haystack" | tail -6 | sed 's/^/    | /'
    return 1
  fi
  ok "$label"
}
Q1='Where should the e2e bundle be deployed\?'
Q2='How verbose should the deploy log be\?'
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
node "$(dirname "$0")/../lib/mock-llm.mjs" --port "$MOCK_PORT" >"$MOCK_LOG" 2>&1 &
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

# --- trigger: the mock's ask phase opens the first picker ---------------------
ensure_editor_ready 'editor clean before the ask trigger' || true
send 'Ask me the deployment questions now. E2E_ASK_TRIGGER'
sleep 1
send Enter
# Full chain: composer send -> agent loop -> mock SSE ask phase -> tool
# dispatch -> user-questions/request -> the AskPicker dialog mounts.
if ! wait_pane 'the ask tool opens the question 1 picker' 60 "$(picker_title "$Q1")"; then
  info 'picker never opened — mock server log tail:'
  tail -10 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi
PANE="$(capture)"

# --- 1. one question at a time -------------------------------------------------
assert_matches 'question 1 renders as the picker title row' "$(picker_title "$Q1")" "$PANE"
assert_matches 'question 1 option row staging renders' "$(option_row staging)" "$PANE"
assert_matches 'question 1 option row production renders' "$(option_row production)" "$PANE"
assert_no_match 'question 2 picker stays unrendered while question 1 is up' "$(picker_title "$Q2")" "$PANE"
assert_no_match 'question 3 picker stays unrendered while question 1 is up' "$(picker_title "$Q3")" "$PANE"
assert_no_match 'question 2 option rows stay unrendered' "$(option_row quiet)" "$PANE"
assert_contains 'transcript records the ask_user_question tool call' 'ask_user_question(' "$PANE"

# --- 2. enter on an option auto-advances to the next picker --------------------
# The picker starts on the first row (staging); enter records the pick and
# advances to question 2's picker.
send Enter
if ! wait_pane 'enter on question 1 advances to the question 2 picker' 15 "$(picker_title "$Q2")"; then
  summary
  exit 0
fi
PANE="$(capture)"
assert_matches 'question 2 option row quiet renders' "$(option_row quiet)" "$PANE"
assert_matches 'question 2 option row chatty renders' "$(option_row chatty)" "$PANE"
assert_no_match 'question 1 picker title is gone after the pick' "$(picker_title "$Q1")" "$PANE"
assert_no_match 'question 1 option rows are gone after the pick' "$(option_row production)" "$PANE"

# --- 3. down moves the selection; enter picks the second option ----------------
send Down
sleep 1
send Enter
if ! wait_pane 'the question 3 picker follows the second pick' 15 "$(picker_title "$Q3")"; then
  summary
  exit 0
fi
PANE="$(capture)"
assert_matches 'question 3 option row lint renders' "$(option_row lint)" "$PANE"
assert_matches 'question 3 option row smoke renders' "$(option_row smoke)" "$PANE"
assert_no_match 'question 2 picker title is gone after the pick' "$(picker_title "$Q2")" "$PANE"

# --- 4. the last pick settles the batch -> final answer ------------------------
# (Our surface honors multi_select as a single pick too — the batch always
# resolves on the last question's enter; there is no toggle stage.)
send Enter
if ! wait_gone 'the ask overlay closes after the last pick' 15 "$(picker_title "$Q3")"; then
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
assert_no_match 'no ask picker remains after the batch settles' "esc *$" "$PANE"

# --- 5. the mock served both scripted phases ------------------------------------
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
