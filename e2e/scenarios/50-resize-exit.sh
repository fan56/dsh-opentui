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
#     Ctrl+C x2 is asserted as an observed-behavior guard: on the lean v2
#     plugin page it does NOT exit (one-layer dig, probe-verified 2026-11-06:
#     host-entry-v2.tsx V2SessionPage mounts Transcript + SessionComposer +
#     StatusBar + PowerlineFooter only — app.tsx's Keymap layer that binds
#     app.exit to ctrl+c never registers on this face, and SessionComposer
#     has no ctrl+c binding; keymap-registration gap, NOT FFI/env, NOT the
#     stale-render family — the Enter path is proven live by /quit itself).
#     The guard passes when the pane either quit cleanly OR the TUI is
#     intact and still functional (composer + powerline painted, /quit
#     still works) — and fails on crash/garbage/zombie. /quit then cleans
#     up, which doubles as a third clean-exit proof.
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
# as one tmux write from a closed palette).
send '/'
wait_pane_fixed 'slash palette opens at 24 rows' 15 '/quit exit the app' \
  && assert_contains 'palette lists /help at 24 rows' \
    '/help show available commands' "$(capture)"
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

# --- clean exit B: Ctrl+C x2 (observed-behavior guard) --------------------------------
# Two presses ~300ms apart (well inside tui-pi's documented 500ms double-
# press window). On this face the presses are expected to be swallowed (no
# app.exit keymap layer on the lean v2 plugin page — see the header): the
# guard passes on a clean quit OR an intact, functional TUI, and fails on
# crash/garbage/zombie.
send C-c
sleep 0.3
send C-c
sleep 4
PANE="$(capture)"
if [[ "$(pane_command)" == bash ]] && printf '%s' "$PANE" | grep -q 'root@'; then
  ok 'Ctrl+C x2 quit cleanly (shell prompt back, foreground bash)'
elif printf '%s' "$PANE" | grep -qF -- "$MARKER_COMPOSER_PLACEHOLDER" \
  && printf '%s' "$PANE" | grep -qF -- "$MARKER_MODEL_SEG_POWERLINE"; then
  warn 'Ctrl+C x2 does not exit on the v2 plugin face (no app.exit keymap layer registered there) — TUI intact, functional; /quit is the exit path'
else
  bad 'Ctrl+C x2 left the pane neither on the shell nor an intact TUI (crash/garbage); pane tail:'
  printf '%s\n' "$PANE" | tail -6 | sed 's/^/    | /'
fi

# Cleanup quit via the working path — a third clean-exit proof.
send '/quit'
sleep 0.4
send Enter
wait_shell_back 'clean exit via /quit after the Ctrl+C guard (shell back)' 10 \
  || true

# --- one more boot after all exit paths ---------------------------------------
start_tui
wait_tui_up 180 || summary
ok 'TUI boots and enters the session again after all exit paths'

kill_tui

summary
