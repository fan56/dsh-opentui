#!/usr/bin/env bash
# Scenario 64 — /session info panel: decode speed over a REAL decode window
# (ported from dsh-tui-pi e2e/scenarios/78-session-stats.sh).
#
# The panel's speed row prices REAL decode windows (first streamed delta →
# settlement, tokens = the billed completion usage — host-session.ts
# #finishTurn), and an instant mock reply would price its window at ~0ms —
# an empty or absurd rate. So this scenario drives the mock's `tps` phase
# (e2e/lib/mock-llm.mjs): a scripted ~1.5s tick stream whose 24 billed output
# tokens land at a sane, assertable rate (~17 tok/s over the ~1.4s window).
#
# Fresh-session prerequisite: the TUI restarts first (a cold start lazily
# creates a fresh session), so the panel's cumulative rows cover EXACTLY the
# scripted turn.
#
# MARKER MAP (our bundle's actual strings; each with its reference 78
# counterpart). Our panel (routes/session/session-info.ts, batch F4) prints
# an aligned TRANSCRIPT BLOCK via ctx.say (the /help print path) — no
# overlay, no key/value separator glyph:
#   'tokens in/out'
#       Our merged token row. Reference counterpart: 'tok in/out'.
#   'cache read/write'
#       Our merged cache row. Reference counterpart: 'cache r/w'.
#   'speed            last N tok/s · avg N tok/s'
#       Our speed row carries BOTH rates (last turn + session average over
#       summed decode windows); unknown reads '—', never 0. Reference
#       counterpart: the single-rate row 'speed │ N tok/s'.
#   'session' / 'model' / 'messages' / 'turns'
#       Our identity/counter rows (reference has the same vocabulary).
#   'E2E-TPS-TURN-DONE' / 'phase=tps'
#       mock tps phase done marker + request log (identical in the
#       reference's mock).
#
# COMMAND-DRIVING NOTE (container-verified): '/session' is a strict prefix of
# '/sessions', and the slash palette runs the HIGHLIGHTED row on Enter —
# submitting '/session' bare would open the 'Resume session' picker. The
# line is driven as '/session ' + Enter (trailing space closes the palette,
# dispatchLine re-parses the bare command; see slash-palette.tsx).
#
# SKIPPED vs the reference — PRODUCT SHAPE on our surface (not a gap, a
# mapping decision):
#   1. MODELS ROW: the reference asserts 'models │ mock-chat 1×24 Nt/s' (a
#      per-model usage row). Our panel has no per-model rows — the model is
#      the single 'model' row — so there is no counterpart to assert.
#   2. ESC CLOSE: the reference panel is an overlay closed with Esc; ours is
#      a transcript block (nothing to close). The reference's "editor still
#      works after closing" leg is kept as an ensure_editor_ready probe.
#
# Container-only: needs the baked mock route plus a throwaway ~/.dsh — on
# the host it would depend on (or poison) live config.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'session panel: decode speed priced over a real decode window'

# --- host guard -------------------------------------------------------------
if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (starts a mock LLM server; container only)'
  summary
  exit 0
fi
if ! grep -qF '127.0.0.1:8642' "$HOME/.dsh/profiles/dsh-opentui/cordis.patch.yml" 2>/dev/null; then
  warn 'profile patch has no mock endpoint (bake step missing) — skipping'
  summary
  exit 0
fi

# --- the mock LLM server (40/61/62 pattern) -----------------------------------
# Port 8642 is NOT arbitrary: the baked profile patch points the pinned
# provider route at 127.0.0.1:8642 — a mock on any other port leaves the
# route dialing a dead endpoint (the turn never completes).
MOCK_PORT=8642
MOCK_LOG=/tmp/mock-llm-64.log
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

# --- fresh session: the panel rows must cover ONLY the scripted turn -----------
kill_tui
start_tui
wait_tui_up 120 || { summary; exit 0; }
ensure_editor_ready 'editor clean before the stats turn' || true

# --- one timed billed turn ------------------------------------------------------
send 'Prove the decode-rate row now. E2E_TPS_TRIGGER'
sleep 1
send Enter
if ! wait_pane 'timed turn completes' 45 'E2E-TPS-TURN-DONE'; then
  info 'turn never finished — mock server log tail:'
  tail -10 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi
if grep -q 'phase=tps' "$MOCK_LOG" 2>/dev/null; then
  ok 'the mock served the scripted tps phase'
else
  bad 'the mock never saw the tps phase; log tail:'
  tail -8 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
fi

# --- /session panel: the rows (transcript block, no overlay) --------------------
# COMMAND-DRIVING NUANCE (container-verified): '/session' is a strict PREFIX
# of '/sessions' too, and the palette filter is prefix-based in registration
# order — '/session' + Enter would run the highlighted /sessions row (the
# 'Resume session' picker) instead. The palette closes on a space ("a visible
# menu is always a pure slash prefix; a space closes it" — slash-palette.tsx),
# so the line is submitted as '/session ' + Enter and dispatchLine re-parses
# the argument-free command. Same atomic one-write discipline as 61.
send '/session ' Enter
if ! wait_pane 'session panel prints its rows' 10 'tokens in/out'; then
  summary
  exit 0
fi
PANE="$(capture)"
evidence_file="${RESULTS_DIR:-/tmp/e2e-results}/64-session-panel.txt"
printf '%s\n' "$PANE" >"$evidence_file"
printf '%s\n' "$PANE" | grep -E '^(session|model|messages|turns|tokens in/out|cache read/write|speed)' \
  | sed 's/^/    panel| /'

assert_contains 'merged token row exists' 'tokens in/out' "$PANE"
assert_contains 'merged cache row exists' 'cache read/write' "$PANE"
assert_matches 'identity row renders a real session id (not the em-dash)' \
  'session[[:space:]]+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$PANE"

# SPEED ROW: both rates render as rounded whole tok/s. The ERE demands a
# nonzero leading digit — an em-dash ('—' for unknown) or a 0 tok/s lie
# cannot match. Value range checked separately below.
SPEED_ERE='speed[[:space:]]+last [1-9][0-9]* tok/s · avg [1-9][0-9]* tok/s'
if printf '%s' "$PANE" | grep -qE "$SPEED_ERE"; then
  ok 'speed row renders real rates: last N tok/s · avg N tok/s (no em-dash, no 0)'
else
  bad "speed row did not render two nonzero rates (ERE: $SPEED_ERE); panel evidence:"
  printf '%s\n' "$PANE" | grep -E 'speed' | tail -3 | sed 's/^/    | /'
fi

# SANITY BOUND: the scripted window is ~1.4s for 24 billed output tokens
# (~17 tok/s); the chars/4 estimate path (~52 tokens) prices ~37 tok/s. A
# window that collapsed to ~0ms would price hundreds+; a missing usage would
# floor at the estimate bound only via a huge window. Bracket 3..500.
SPEED_LINE="$(printf '%s' "$PANE" | grep -E 'speed[[:space:]]+last [0-9]+ tok/s' | head -1)"
LAST_TPS="$(printf '%s' "$SPEED_LINE" | sed -E 's/.*last ([0-9]+) tok\/s.*/\1/')"
AVG_TPS="$(printf '%s' "$SPEED_LINE" | sed -E 's/.*avg ([0-9]+) tok\/s.*/\1/')"
if [ -n "$LAST_TPS" ] && [ "$LAST_TPS" -ge 3 ] && [ "$LAST_TPS" -le 500 ] \
  && [ -n "$AVG_TPS" ] && [ "$AVG_TPS" -ge 3 ] && [ "$AVG_TPS" -le 500 ]; then
  ok "rates inside the sane decode-window bracket (last ${LAST_TPS} tok/s, avg ${AVG_TPS} tok/s; scripted window ~1.4s)"
else
  bad "rates outside the sane bracket (last '${LAST_TPS:-none}', avg '${AVG_TPS:-none}'; expected 3..500 over the ~1.4s scripted window)"
fi

# TURN COUNTER: the fresh session covered exactly the scripted turn.
assert_matches 'turns row counts the scripted turn' 'turns[[:space:]]+[1-9][0-9]*' "$PANE"

# --- editor still usable after the panel printed --------------------------------
ensure_editor_ready 'editor focused after the panel printed' || true

summary
