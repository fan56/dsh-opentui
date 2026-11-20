#!/usr/bin/env bash
# Scenario t0-global-keys — T0 gate, global key group.
#
# Matrix numbers (e2e-0233-c/matrix.md):
#   KEY-12  ctrl+p           → command palette (real-machine: FAIL, no-op)
#   KEY-05  ctrl+shift+f     → session search overlay (real-machine: FAIL, no-op)
#   KEY-18  ctrl+r           → rename session (real-machine: FAIL, no-op)
#   KEY-22  f2               → cycle recent model (inventory: unavailable; no-op)
#   KEY-02  shift+enter      → REGRESSION GUARD: must insert a newline, never
#                              send the message (real-machine: DEGRADED — the
#                              text was submitted and a model turn started).
#
# All five are written to the v2 EXPECTED behaviour (PASS). On the current
# build the first four are expected to FAIL and the fifth guards against the
# false-send regression. A silent no-op is a FAIL, never a SKIP.
#
# Both geometries (120x40 + 200x50) are driven via v2_each_size.
set -u
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/assert-v2.sh"
scenario 'T0 global keys (KEY-05/12/18/22 + KEY-02 shift+enter guard) — 120x40 + 200x50'

if [ ! -d /e2e/scenarios ]; then
  v2_skip 'KEY-12' 'T0 global keys' 'host environment detected — drives a live TUI; container only'
  warn 'host environment detected — skipping; container only'
  v2_summary
  summary
  exit 0
fi

start_tui
wait_tui_up 180 || { v2_summary; summary; exit 0; }
ensure_editor_ready 'editor ready before T0 global key probes' || true

RENAME_TOKEN='E2E_T0_RN'
MONO_MODEL_ERE='🤖 [A-Za-z0-9._/-]+'

global_keys() {
  local size="$1" before after waited

  # --- KEY-12: ctrl+p opens the slash/command palette -------------------------
  ensure_editor_ready "editor clean before ctrl+p ($size)" || true
  before="$(capture)"
  send C-p
  sleep 1.5
  if assert_frame_has '… [0-9]+ more|/help show available commands' \
    "ctrl+p opens the command palette ($size)" 10 'KEY-12' A L2 \
    'v1: no assertion (KEY-12 uncovered); no-op with unchanged composer would be accepted' \
    'palette rows (/help or … N more) visible after ctrl+p'; then
    after="$(capture)"
    assert_state_change "ctrl+p changes the frame ($size)" "$before" "$after" \
      'KEY-12' A L2 '… [0-9]+ more|/help show available commands'
  fi
  send Escape
  sleep 0.5
  esc_until_placeholder "palette closed after ctrl+p ($size)" 12 || true

  # --- KEY-05: ctrl+shift+f opens the session search overlay ------------------
  ensure_editor_ready "editor clean before ctrl+shift+f ($size)" || true
  before="$(capture)"
  send C-S-f
  sleep 1.5
  if assert_frame_has 'Search sessions|[Ss]earch session' \
    "ctrl+shift+f opens the search overlay ($size)" 10 'KEY-05' A L2 \
    'v1: 22-search asserted the overlay only inside a slash-command flow; a bare-key no-op was never checked' \
    'Search sessions overlay visible after bare ctrl+shift+f'; then
    after="$(capture)"
    assert_state_change "ctrl+shift+f changes the frame ($size)" "$before" "$after" \
      'KEY-05' A L2 'Search sessions|[Ss]earch session'
  fi
  send Escape
  sleep 0.5
  esc_until_placeholder "overlay closed after ctrl+shift+f ($size)" 12 || true

  # --- KEY-18: ctrl+r renames the current session -----------------------------
  ensure_editor_ready "editor clean before ctrl+r ($size)" || true
  send C-r
  sleep 1
  if assert_frame_has '[Rr]ename' "ctrl+r opens a rename prompt ($size)" 10 \
    'KEY-18' A L1 \
    'v1: no assertion (KEY-18 uncovered); ctrl+r no-op accepted' \
    'rename prompt visible after ctrl+r'; then
    before="$(capture)"
    send "$RENAME_TOKEN"
    sleep 0.5
    send Enter
    sleep 1.5
    # Clear the composer / close any dialog so the token can only be the
    # persisted session label — not text left in the input buffer.
    ensure_editor_ready "editor cleared after rename submit ($size)" || true
    send Escape
    sleep 0.5
    after="$(capture)"
    if printf '%s\n' "$after" | grep -qF "$RENAME_TOKEN"; then
      ok "ctrl+r persisted the renamed session label ($size): $RENAME_TOKEN"
      v2_record 'KEY-18' A L2 PASS "ctrl+r renames the session ($size)" \
        'v1: no assertion (KEY-18 uncovered); ctrl+r no-op accepted' \
        "session label shows $RENAME_TOKEN after Escape" 'label persisted'
    else
      bad "ctrl+r did not persist the rename ($size): $RENAME_TOKEN absent after the composer was cleared"
      v2_record 'KEY-18' A L2 FAIL "ctrl+r renames the session ($size)" \
        'v1: no assertion (KEY-18 uncovered); ctrl+r no-op accepted' \
        "session label shows $RENAME_TOKEN after Escape" 'silent no-op / no persisted label'
    fi
    assert_state_change "ctrl+r changes the frame ($size)" "$before" "$after" \
      'KEY-18' A L2 "$RENAME_TOKEN"
  fi
  esc_until_placeholder "editor restored after ctrl+r ($size)" 12 || true

  # --- KEY-22: f2 cycles the recent model -------------------------------------
  ensure_editor_ready "editor clean before f2 ($size)" || true
  before="$(capture)"
  MODEL_BEFORE="$(printf '%s\n' "$before" | grep -oE "$MONO_MODEL_ERE" | head -1)"
  send F2
  sleep 1.5
  MODEL_AFTER=''
  waited=0
  while (( waited < 8 )); do
    MODEL_AFTER="$(capture | grep -oE "$MONO_MODEL_ERE" | head -1)"
    if [ -n "$MODEL_BEFORE" ] && [ -n "$MODEL_AFTER" ] && [ "$MODEL_AFTER" != "$MODEL_BEFORE" ]; then
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done
  if [ -n "$MODEL_BEFORE" ] && [ -n "$MODEL_AFTER" ] && [ "$MODEL_AFTER" != "$MODEL_BEFORE" ]; then
    ok "f2 cycles the model ($size): $MODEL_BEFORE -> $MODEL_AFTER"
    v2_record 'KEY-22' A L2 PASS "f2 cycles the recent model ($size)" \
      'v1: no assertion (KEY-22 uncovered); a no-op was accepted as expected-unavailable' \
      'footer model segment changes after f2' "$MODEL_BEFORE -> $MODEL_AFTER"
  else
    bad "f2 did not cycle the model ($size): footer stayed '$MODEL_BEFORE' -> '$MODEL_AFTER' (silent no-op is FAIL)"
    v2_record 'KEY-22' A L2 FAIL "f2 cycles the recent model ($size)" \
      'v1: no assertion (KEY-22 uncovered); a no-op was accepted as expected-unavailable' \
      'footer model segment changes after f2' "no change: '$MODEL_BEFORE' -> '$MODEL_AFTER'"
  fi

  # --- KEY-02: shift+enter must NOT send (regression guard) -------------------
  # Kitty keyboard shift+enter = CSI 13;2u (the C round also used Kitty CSI
  # sequences). Expected: composer gains a second line; no user turn, footer
  # stays idle ('enter send'), no '👤 <text>' transcript row.
  ensure_editor_ready "editor clean before shift+enter ($size)" || true
  send 'E2E_T0_MULTILINE'
  sleep 0.5
  send $'\x1b[13;2u'
  sleep 1.5
  after="$(capture)"
  SENT=0
  printf '%s\n' "$after" | grep -qF '👤 E2E_T0_MULTILINE' && SENT=1
  printf '%s\n' "$after" | grep -qF 'enter steer' && SENT=1
  COMPOSER_ROWS="$(printf '%s\n' "$after" | grep -c '┃' || true)"
  if (( SENT == 0 )) && (( COMPOSER_ROWS >= 2 )); then
    ok "shift+enter inserts a newline without sending ($size): composer rows=$COMPOSER_ROWS, footer idle"
    v2_record 'KEY-02' A L2 PASS "shift+enter is a newline, not a submit ($size)" \
      'v1: no assertion; C round recorded shift+enter as a DEGRADED false-send' \
      'no user turn / no busy footer AND composer has >=2 rows' \
      "composer rows=$COMPOSER_ROWS, footer idle"
  else
    bad "shift+enter false-send regression ($size): sent=$SENT, composer rows=$COMPOSER_ROWS"
    v2_record 'KEY-02' A L2 FAIL "shift+enter is a newline, not a submit ($size)" \
      'v1: no assertion; C round recorded shift+enter as a DEGRADED false-send' \
      'no user turn / no busy footer AND composer has >=2 rows' \
      "sent=$SENT, composer rows=$COMPOSER_ROWS"
  fi
  # Clear the two-line composer for the next geometry.
  for _ in $(seq 1 12); do send BSpace; sleep 0.25; done
  esc_until_placeholder "editor restored after shift+enter ($size)" 12 || true
}

v2_each_size global_keys

v2_teardown
v2_summary
summary
