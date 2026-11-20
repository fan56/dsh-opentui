#!/usr/bin/env bash
# Scenario 50 — resize durability + clean exit, ported from dsh-tui-pi
# e2e/scenarios/50-resize-exit.sh and adapted to the opentui v2 face:
#
#   - shrink to 80x24: the TUI survives with the composer and the powerline
#     footer still painted (tui-pi asserts its whale/wordmark banner here;
#     this face has no banner — its tuned anchors are the composer and the
#     footer), and the '/' slash palette still opens inside the 24-row pane.
#     The palette stands in for tui-pi's /theme picker because it is the
#     cheap, reliable overlay on this face (bare /model never opens a picker
#     in-container — empty catalog, see scenario 30's anomaly note).
#   - restore to the tuned 140x36: the composer and the powerline come back.
#   - clean exit: /quit asserted as a hard regression guard for the fixed
#     blank-zombie (v1 could not quit in-container at all — see quit_tui's
#     KNOWN LIMITATION in lib/common.sh; the batch V5 composer-remount fix
#     is what re-opened the quit path).
#     Ctrl+C x2 is asserted as a HARD clean-exit guard: since 7d6d2a1 the
#     plugin entry (host-entry-v2.tsx V2SessionPage) mounts TurnCancelKeys —
#     two Ctrl+C presses inside a 500ms window quit the app (the keymap gap
#     probed 2026-11-06 — app.tsx's Keymap layer never registered on the lean
#     v2 plugin page — is fixed). Two presses land ~300ms apart, inside the
#     window; the app must quit cleanly (shell prompt back AND the pane's
#     foreground process is bash). A hung TUI (zombie), a crashed or garbled
#     pane, or the pre-fix swallowed-press behavior all FAIL.
#   - one more boot after every exit path, to prove the profile still starts
#     clean and enters the session.
set -u
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/assert-v2.sh"
# v2 B-class fix: capture the client's REAL exit code in the pane so /quit and
# Ctrl+C x2 can be asserted on the exit status, not just "a prompt appeared".
export E2E_CAPTURE_EXIT=1
scenario 'resize (80x24 <-> 140x36) + clean exit (/quit + Ctrl+C x2) + restart'

# Assert the pane is back on the shell after a quit: prompt string visible
# AND the pane's foreground process is bash (either alone is not proof).
wait_shell_back() {
  local label="$1" timeout="${2:-10}" waited=0
  while (( waited < timeout )); do
    if [[ "$(pane_command)" == bash ]] && capture | grep -q 'root@'; then
      ok "$label"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  bad "$label (pane_command='$(pane_command)'); pane tail:"
  capture | tail -6 | sed 's/^/    | /'
  return 1
}

start_tui
wait_tui_up 180 || summary
ensure_editor_ready 'editor clean before resize traffic' || true

# --- shrink to 80x24 ----------------------------------------------------------
tmux resize-window -t "$TS" -x 80 -y 24
sleep 3
PANE="$(capture)"
assert_contains 'TUI alive after resize to 80x24 (composer placeholder)' \
  "$MARKER_COMPOSER_PLACEHOLDER" "$PANE"
assert_contains 'composer keybinding hint still rendered at 80x24' \
  "$MARKER_COMPOSER_HINT" "$PANE"
assert_contains 'powerline still rendered at 80x24 (emoji model segment)' \
  "$MARKER_MODEL_SEG_POWERLINE" "$PANE"

# --- overlay inside the 24-row pane ---------------------------------------------
# One '/' write from the clean state opens the palette (input law: text lands
# as one tmux write from a closed palette). The registry clamps to the 10-row
# window (slash-palette.tsx MAX_ROWS), so /quit is NOT in the visible rows at
# this geometry — the /help row and the `… N more` overflow row are. N is
# computed from the registry so the assertion tracks registry growth.
REGISTRY_ROWS="$(grep -c 'name: "/' /src/packages/tui-base/src/routes/session/commands.ts || true)"
OVERFLOW_ROWS=$(( REGISTRY_ROWS - 10 ))
send '/'
wait_pane_fixed 'slash palette opens at 24 rows' 15 '/help show available commands' \
  && assert_contains 'palette lists the clamped set at 24 rows' \
    "… ${OVERFLOW_ROWS} more" "$(capture)"
esc_until_placeholder 'palette closes at 24 rows, placeholder back' 15

# --- restore to the tuned geometry ------------------------------------------------
tmux resize-window -t "$TS" -x "$TUI_COLS" -y "$TUI_ROWS"
RESTORED=0
for _ in $(seq 1 15); do
  PANE="$(capture)"
  if printf '%s' "$PANE" | grep -qF -- "$MARKER_COMPOSER_PLACEHOLDER" \
    && printf '%s' "$PANE" | grep -qF -- "$MARKER_MODEL_SEG_POWERLINE"; then
    RESTORED=1
    break
  fi
  sleep 1
done
if (( RESTORED )); then
  ok "composer + powerline restored after resize back to ${TUI_COLS}x${TUI_ROWS}"
else
  # Repaint may wait for the next input tick — nudge with single keystrokes
  # (input-law safe) and re-check.
  info 'no restore 15s after resize back — nudging with an input tick'
  send Space
  sleep 0.3
  send BSpace
  sleep 1
  PANE="$(capture)"
  if printf '%s' "$PANE" | grep -qF -- "$MARKER_COMPOSER_PLACEHOLDER" \
    && printf '%s' "$PANE" | grep -qF -- "$MARKER_MODEL_SEG_POWERLINE"; then
    warn 'resize-back repaint only happened after an input tick'
  else
    bad "composer + powerline did not come back after resizing to ${TUI_COLS}x${TUI_ROWS}"
  fi
fi

# --- clean exit A: /quit (hard regression guard) -------------------------------------
# WRONG (v1, lines 113-119): `wait_shell_back ... || true` swallowed the exit
# result and the next boot unconditionally `ok`'d. The scenario passed even
# when the client never exited.
# CORRECT (v2): the client's exit code line (__DSH_E2E_EXIT=0) MUST appear and
# the pane must be back on bash; only then may the restart be claimed as a
# clean-exit success.
EXIT_WRONG='wait_shell_back "clean exit via /quit" 10 || true; then unconditional "TUI boots again after a clean quit"'
EXIT_RIGHT='pane paints __DSH_E2E_EXIT=0 after /quit AND pane_command=bash with prompt; restart asserted only on success'
ensure_editor_ready 'editor clean before /quit' || true
send '/quit'
sleep 0.4
send Enter
QUIT_OK=0
if wait_shell_back 'clean exit via /quit (shell prompt back, foreground bash)' 10; then
  if assert_exit_code '/quit returns exit code 0' '0' "$(capture)" \
    'CMD-08' A L2; then
    QUIT_OK=1
    v2_record 'CMD-08' A L2 PASS '/quit exits with code 0 (L2 exit status)' \
      "$EXIT_WRONG" "$EXIT_RIGHT" 'exit marker 0 + bash prompt'
  fi
else
  v2_record 'CMD-08' A L2 FAIL '/quit exits with code 0 (L2 exit status)' \
    "$EXIT_WRONG" "$EXIT_RIGHT" 'wait_shell_back failed (no || true swallow)'
fi
if (( QUIT_OK == 0 )); then
  bad 'clean exit via /quit was NOT proven — the restart below is not a clean-quit success'
fi

# --- one more full boot after a quit (only if the quit was proven) --------------------
if (( QUIT_OK )); then
  start_tui
  wait_tui_up 180 || summary
  ok 'TUI boots again after a proven clean quit'
else
  info 'restart-after-quit skipped: the /quit exit was not proven (see the FAIL above)'
fi

# --- clean exit B: Ctrl+C x2 (hard regression guard, 7d6d2a1) ----------------------
# Two presses ~300ms apart, inside the 500ms TurnCancelKeys quit window
# (CTRL_C_QUIT_WINDOW_MS). An intentional Ctrl+C exit yields 0 or 130; a hang,
# crash or garbled pane yields no exit marker and is a FAIL.
if tui_alive; then
  send C-c
  sleep 0.3
  send C-c
  CCX2=0
  for _ in $(seq 1 10); do
    if [[ "$(pane_command)" == bash ]] && capture | grep -q 'root@'; then
      CCX2=1
      break
    fi
    sleep 1
  done
  if (( CCX2 )); then
    ok 'clean exit via Ctrl+C x2 (shell prompt back, foreground bash)'
    if assert_exit_code 'Ctrl+C x2 returns a clean exit code (0 or 130)' '0|130' \
      "$(capture)" 'KEY-08' C L2; then
      v2_record 'KEY-08' C L2 PASS 'Ctrl+C x2 exits with 0/130 (L2 exit status)' \
        "$EXIT_WRONG" "$EXIT_RIGHT" 'exit marker 0|130 + bash prompt'
    fi
  else
    bad "Ctrl+C x2 did not quit cleanly within 10s (zombie/crash/garbage; pane_command='$(pane_command)'); pane tail:"
    capture | tail -6 | sed 's/^/    | /'
    v2_record 'KEY-08' C L2 FAIL 'Ctrl+C x2 exits with 0/130 (L2 exit status)' \
      "$EXIT_WRONG" "$EXIT_RIGHT" 'no clean exit within 10s (no || true swallow)'
    # Clean up through /quit so the last boot starts from a stopped app. This
    # is housekeeping, NOT an assertion: its result never masks the FAIL above.
    info 'cleaning up via /quit after the Ctrl+C x2 failure'
    ensure_editor_ready 'editor clean before the cleanup /quit' || true
    send '/quit'
    sleep 0.4
    send Enter
    sleep 2 # best-effort housekeeping only — no assertion, no swallowed verdict
  fi
else
  v2_record 'KEY-08' C L2 SKIP 'Ctrl+C x2 exits with 0/130 (L2 exit status)' \
    "$EXIT_WRONG" "$EXIT_RIGHT" 'no live TUI after the /quit leg; Ctrl+C exit not exercised'
  printf '  SKIP Ctrl+C x2 — no live TUI after the /quit leg\n'
fi

# --- one more boot after all exit paths ---------------------------------------
start_tui
wait_tui_up 180 || summary
ok 'TUI boots and enters the session again after all exit paths'

kill_tui

v2_summary
summary
