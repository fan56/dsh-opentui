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
ensure_editor_ready 'editor clean before /quit' || true
send '/quit'
sleep 0.4
send Enter
wait_shell_back 'clean exit via /quit (shell prompt back, foreground bash)' 10 \
  || true

# --- one more full boot after a quit ---------------------------------------------------
start_tui
wait_tui_up 180 || summary
ok 'TUI boots again after a clean quit'

# --- clean exit B: Ctrl+C x2 (hard regression guard, 7d6d2a1) ----------------------
# Two presses ~300ms apart, inside the 500ms TurnCancelKeys quit window
# (CTRL_C_QUIT_WINDOW_MS). Poll for a clean exit: foreground bash AND the
# shell prompt back. Anything else after 10s — TUI still in the foreground
# (zombie / swallowed presses), a crashed or garbled pane — is a FAIL.
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
else
  bad "Ctrl+C x2 did not quit cleanly within 10s (zombie/crash/garbage; pane_command='$(pane_command)'); pane tail:"
  capture | tail -6 | sed 's/^/    | /'
  # Fall back to the working /quit path so the final boot starts from a
  # stopped app (never type into a bare shell on the success path).
  info 'cleaning up via /quit after the Ctrl+C x2 failure'
  send '/quit'
  sleep 0.4
  send Enter
  wait_shell_back 'cleanup: /quit still exits after the Ctrl+C x2 failure' 10 \
    || true
fi

# --- one more boot after all exit paths ---------------------------------------
start_tui
wait_tui_up 180 || summary
ok 'TUI boots and enters the session again after all exit paths'

kill_tui

summary
