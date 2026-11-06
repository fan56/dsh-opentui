#!/usr/bin/env bash
# Scenario 61 — /btw side questions over the baked mock endpoint (ported from
# dsh-tui-pi e2e/scenarios/69-btw.sh).
#
# Our /btw face (feature batch F3, a1faa42) is a DIFFERENT surface from the
# tui-pi original (src/btw.ts + btw-overlay.ts there): the command
# (packages/tui-base/src/routes/session/commands.ts) hands the argument text
# to createBtwOpener (btw-overlay.tsx), which submits through the shell
# facade's btwAsk — a throwaway second session riding the SAME baked mock
# endpoint (127.0.0.1:8642) — and shows the framed BtwPanel dialog. The main
# line is never touched; a submit while the panel is closed reopens it
# automatically; Esc hides the panel without stopping the run; a submit while
# a side call streams QUEUES behind it (capacity 3) and the drained job
# promotes the moment the live one settles.
#
# The mock keys phases on the request body (E2E_BTW_Q / E2E_BTW_MAIN — the
# btw/main-slow pair exists for exactly this scenario; decidePhase checks the
# Q key first because the side call's snapshot embeds the main prompt). The
# btw phase holds the first chunk for 6s (BTW_FIRST_CHUNK_DELAY_MS) — the
# deterministic 'Thinking…' window this scenario queues the second side call
# inside — and the main-slow phase streams ~42s of ticks ending in
# E2E-BTW-MAIN-DONE so the main line stays busy throughout.
#
# MARKER MAP (our bundle's actual strings; each with its reference 69
# counterpart):
#   'btw — side question'
#       BtwPanel header (btw-overlay.tsx) — our overlay-presence marker.
#       Reference counterpart: the framed overlay's side-model label
#       '⌘ btw — mock-llm/mock-chat' (also used there for every wait_gone).
#   'Thinking…'
#       BtwPanel streaming-with-empty-answer fallback; identical string in
#       the reference overlay.
#   'E2E-BTW-ANSWER-ONE' / 'E2E-BTW-ANSWER-TWO'
#       mock BTW_Q_ANSWERS (e2e/lib/mock-llm.mjs), keyed on E2E_BTW_Q1/Q2 in
#       the request body; identical markers in the reference.
#   '1 queued'
#       BtwPanel streaming-hint suffix ` · ${queueDepth} queued`. Reference
#       counterpart: the transcript echo 'btw queued (position 1).'
#   'Not kept in the session · /btw reopens this answer'
#       BtwPanel settled hint; the reference badge is the same string.
#   'main-line progress tick' / 'E2E-BTW-MAIN-DONE'
#       mock main-slow phase tick text + done marker; identical in the
#       reference.
#   'Ask anything'
#       DialogPrompt placeholder passed by createBtwOpener's bare branch
#       (idle, nothing to review). Reference counterpart of the bare-/btw
#       usage path ('Usage: /btw <question>' — our idle bare form opens an
#       input dialog instead of printing usage text).
#   'phase=btw' / 'phase=main-slow'
#       mock-llm.mjs decidePhase request log (same phase names as the
#       reference's mock).
#
# SKIPPED vs the reference — PRODUCT GAPS on our surface (each still true at
# HEAD a1faa42; re-add the assertions when the gaps close):
#   1. SIDE MODEL LABEL: BtwPanel paints no side-model segment, so the
#      reference's '⌘ btw — mock-llm/mock-chat' open/close assertions have no
#      counterpart (instructed skip).
#   2. COMMAND ECHOES: the opener's outcome ('started'/'queued'/...) is
#      discarded in host-entry-v2.tsx (`void openBtw(argText)`), so there is
#      no 'btw — answering alongside the main task.' / 'btw queued (position
#      1).' / 'Last btw exchange shown.' echo anywhere. The queue leg is
#      proven through the panel hint suffix instead.
#   3. BARE /btw REOPEN OF A LIVE RUN: our bare branch only reopens the
#      SETTLED last() slot; with a run still streaming it opens the input
#      DialogPrompt instead. The reference's 'the running answer is back on
#      screen' reopen assertion is therefore replaced by watching the first
#      answer inside the already-open live panel (see the tight-window note
#      at that assertion).
#   4. PROMOTE NOTICE: no footer/transcript notice ('btw running in the
#      background') — the drained job promotes silently and the panel simply
#      switches to the next run.
#   5. IDLE REFUSALS: 'the main line is idle, so just ask directly' and the
#      'No question after /btw --model.' argument error do not exist; idle
#      /btw opens the input dialog (covered by the probe below).
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'btw: side questions over the mock LLM (overlay, queue, not-persisted)'

# --- guards -------------------------------------------------------------------
# Container-only: needs the baked mock route plus a throwaway ~/.dsh — on the
# host it would depend on (or poison) live config.
if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (needs the baked mock route + throwaway ~/.dsh); container only'
  summary
  exit 0
fi
if ! grep -qF '127.0.0.1:8642' "$HOME/.dsh/profiles/dsh-opentui/cordis.patch.yml" 2>/dev/null; then
  warn 'profile patch has no mock endpoint (bake step missing) — skipping'
  summary
  exit 0
fi

# --- the mock LLM server (same port as the baked route) -------------------------
MOCK_PORT=8642
MOCK_LOG=/tmp/mock-llm-61.log
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
  bad 'mock LLM server did not come up; log tail:'
  tail -10 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi

# --- fresh TUI on the baked mock endpoint ---------------------------------------
kill_tui
start_tui
wait_tui_up 120 || { summary; exit 0; }
PANE="$(capture)"
assert_contains 'footer still paints the pinned provider segment' "$MARKER_PROVIDER_SEG" "$PANE"
ensure_editor_ready 'editor clean before the btw probes' || true

# --- idle probe (reference #1, remapped): bare /btw with nothing to review ------
# One atomic send per command line: Enter lands before the autocomplete popup
# can own the keys (the house pattern of 30/60). Our idle bare form opens the
# input DialogPrompt ('Ask anything') instead of printing the reference's
# usage text — PRODUCT GAP 5 in the header.
send '/btw' Enter
if wait_pane_fixed 'idle bare /btw opens the input dialog (Ask anything placeholder)' 10 'Ask anything'; then
  send Escape
  wait_gone 'Esc closes the idle input dialog' 10 'Ask anything'
fi
ensure_editor_ready 'editor clean before the busy flow' || true

# --- busy flow: slow main turn + two side calls ----------------------------------
# The main-slow phase keeps the main line busy for ~42s while both side calls
# fire into the window. The panel/dialog owns the keyboard while open, so the
# queue leg closes the panel first (Esc NEVER stops the run — the call keeps
# streaming into the Last-btw slot) and the Q2 submit reopens it by itself.
send 'Walk the migration plan step by step. E2E_BTW_MAIN'
sleep 1
send Enter
if ! wait_pane 'main turn starts streaming its ticks' 45 'main-line progress tick'; then
  info 'main turn never started — mock server log tail:'
  tail -10 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi

# Side call one. The 6s first-chunk hold gives a deterministic Thinking…
# window; any capture inside (panel paint, hold end) shows Thinking… WITHOUT
# the answer — that pairing is the hold proof.
send '/btw E2E_BTW_Q1 what is the deploy status' Enter
HOLD_PANE=''
for _ in $(seq 1 5); do
  HOLD_PANE="$(capture)"
  if printf '%s' "$HOLD_PANE" | grep -qF 'Thinking…'; then
    break
  fi
  HOLD_PANE=''
  sleep 1
done
if [ -n "$HOLD_PANE" ]; then
  assert_contains 'overlay opens: btw panel header renders' 'btw — side question' "$HOLD_PANE"
  assert_contains 'overlay shows Thinking… while the mock holds the first chunk' 'Thinking…' "$HOLD_PANE"
  assert_not_contains 'the 6s hold keeps the answer back during the Thinking window' \
    'E2E-BTW-ANSWER-ONE' "$HOLD_PANE"
else
  bad 'Thinking… never appeared within the 6s hold window'
fi

send Escape # panel hides; the side call keeps streaming
wait_gone 'Esc closes the overlay without stopping the run' 10 'btw — side question'

# Side call two, submitted while call one still streams -> queued behind it.
# The submit reopens the panel by itself and the streaming hint gains the
# queue suffix (PRODUCT GAP 2: there is no 'btw queued (position 1).' echo).
send '/btw E2E_BTW_Q2 and the rollback plan' Enter
# The queue suffix and ANSWER-ONE are both short-lived on our panel: the
# moment call one settles (~400ms after its answer chunk lands) the drained
# job promotes and shown() switches to the next run, hiding BOTH. So this
# leg polls fast (250ms) for the two markers inside that window instead of
# the reference's reopen-then-watch flow (PRODUCT GAP 3).
QUEUED=0 ONE=0
for _ in $(seq 1 64); do
  PANE="$(capture)"
  printf '%s' "$PANE" | grep -qE '1 queued' && QUEUED=1
  printf '%s' "$PANE" | grep -qF 'E2E-BTW-ANSWER-ONE' && ONE=1
  if (( QUEUED == 1 && ONE == 1 )); then
    break
  fi
  sleep 0.25
done
if (( QUEUED == 1 )); then
  ok 'second /btw queues behind the still-running first (hint suffix: 1 queued)'
else
  bad 'second /btw never showed the queued suffix (submitted too late or suffix missing)'
fi
if (( ONE == 1 )); then
  ok 'first answer streams into the live panel before the drained job replaces it'
else
  bad 'E2E-BTW-ANSWER-ONE never surfaced in the panel window'
fi

# The promoted second call settles into the Last-btw slot, which the open
# panel keeps showing indefinitely (nothing queues behind it).
wait_pane 'second answer settles into the panel' 30 'E2E-BTW-ANSWER-TWO'
wait_pane 'settled badge: not kept in the session' 15 \
  'Not kept in the session · /btw reopens this answer'

send Escape
wait_gone 'Esc closes the overlay after the second answer' 15 'btw — side question'
PANE="$(capture)"
assert_not_contains 'answer one never lands in the transcript' 'E2E-BTW-ANSWER-ONE' "$PANE"
assert_not_contains 'answer two never lands in the transcript' 'E2E-BTW-ANSWER-TWO' "$PANE"
assert_contains 'main line was never disrupted by the side calls' 'main-line progress tick' "$PANE"

wait_pane 'main turn finishes normally after the slow stream' 90 'E2E-BTW-MAIN-DONE'
PANE="$(capture)"
assert_not_contains 'transcript stays clean after the main turn' 'E2E-BTW-ANSWER-ONE' "$PANE"
assert_not_contains 'transcript stays clean after the main turn (answer two)' 'E2E-BTW-ANSWER-TWO' "$PANE"

# --- the mock served both scripted phases ----------------------------------------
BTW_PHASES=$(grep -c 'phase=btw' "$MOCK_LOG" 2>/dev/null || true)
if [ "${BTW_PHASES:-0}" -ge 2 ] 2>/dev/null; then
  ok "the mock served the btw phase for both side calls (phase=btw x${BTW_PHASES})"
else
  bad "expected >=2 phase=btw lines, got '${BTW_PHASES:-0}'; log tail:"
  tail -8 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
fi
if grep -q 'phase=main-slow' "$MOCK_LOG" 2>/dev/null; then
  ok 'the mock served the main-slow phase (request keyed on the body)'
else
  bad 'the mock never logged phase=main-slow; log tail:'
  tail -8 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
fi

# --- Last-btw review (reference #12): bare /btw reopens the settled slot ---------
ensure_editor_ready 'editor clean before the review' || true
send '/btw' Enter
wait_pane 'bare /btw after close shows the Last-btw slot' 15 'btw — side question'
wait_pane 'review carries the last answer' 10 'E2E-BTW-ANSWER-TWO'
wait_pane 'review keeps the not-kept badge' 10 'Not kept in the session'
send Escape
wait_gone 'Esc closes the review overlay' 10 'btw — side question'

summary
