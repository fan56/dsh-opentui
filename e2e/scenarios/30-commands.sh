#!/usr/bin/env bash
# Scenario 30 — slash commands over the batch-8 core set (/help /new /model
# /quit /sessions /clear — src/tui-base/src/routes/session/commands.ts):
# the '/' palette (open with all 6 rows, row shape, first-row highlight,
# 'cl'/'mo' filter narrowing, clear-restore, Esc close), /model's bare form,
# the unknown-command row, and editor liveness after every cycle.
#
# Ported from dsh-tui-pi e2e/scenarios/30-commands.sh, adapted to the
# 6-command core set and to the in-container input law (see the palette-
# mirror comment in lib/common.sh): text only ever lands as ONE tmux write
# from a closed palette ('/cl' opens AND filters in a single keystroke
# burst); backspaces are always spaced. Markers were derived from a REAL
# container capture, not guessed from source.
#
# IN-CONTAINER ANOMALY (real-capture verified, stable across boots): bare
# /model never opens the picker — the plugin seam's modelCatalog() is built
# from listProviders(), which returns nothing in this path
# (packages/shell/src/host-session-seam-adapter.ts), so /model prints its
# "no models in the catalog" feedback row instead. The scenario asserts that
# captured behavior AND that no picker overlay opened ('Select model' title
# stays absent); revisit when the seam sources a catalog.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'slash commands (palette + model + unknown over the core set)'

if ! tui_alive; then
  info 'TUI not running — starting fresh'
  start_tui
  wait_tui_up 180 || summary
fi
ensure_editor_ready 'editor ready before command traffic' || true

# --- palette: open with the full core set -----------------------------------
# One '/' write from the clean state opens the palette with all 6 rows.
send '/'
sleep 2
PANE="$(capture)"
assert_contains 'palette row /help' '/help show available commands' "$PANE"
assert_contains 'palette row /new' '/new start a fresh session' "$PANE"
assert_contains 'palette row /model' '/model switch model (bare opens the picker)' "$PANE"
assert_contains 'palette row /quit' '/quit exit the app' "$PANE"
assert_contains 'palette row /sessions' '/sessions list and resume stored sessions' "$PANE"
assert_contains 'palette row /clear' '/clear clear the transcript' "$PANE"
# Row shape is name + space + description (slash-palette.tsx SlashPalette) —
# the six fixed rows above ARE the shape review. The selection highlight is
# color-only, so it is asserted on the SGR capture: the highlighted /help
# name paints the active fg (38;5;238) vs the base fg (38;5;255) on the
# rest — catppuccin-mocha, baked into the image; from the real capture.
SGR="$(capture_sgr)"
assert_matches 'palette highlights the first row (active fg on /help)' \
  '38;5;238m/help' "$SGR"
assert_matches 'later palette rows use the base fg (/new)' \
  '38;5;255m/new' "$SGR"

# --- Esc closes the palette --------------------------------------------------
esc_until_placeholder 'palette closes on Esc' 15
# Esc keeps the buffer ('/'), so blind-clear it for the filter bursts.
for _ in $(seq 1 4); do send BSpace; sleep 0.3; done

# --- filtering: '/cl' and '/mo' narrow; clearing restores --------------------
# The filter cannot be typed into an open palette (input law above) — each
# query is one '/xy' write from the clean state.
send '/cl'
wait_pane_fixed 'filter "/cl" narrows to /clear' 10 '/clear clear the transcript' \
  && assert_not_contains 'filter "/cl" filters out /help' \
    '/help show available commands' "$(capture)"
# Spaced backspaces clear '/cl'; the trailing '/' re-opens the unfiltered
# list — the restore proof (any leftover would swallow the '/' into a
# non-matching query with no /help row).
for _ in $(seq 1 3); do send BSpace; sleep 0.3; done
send '/'
wait_pane_fixed 'clearing the filter restores the full list' 12 \
  '/help show available commands'
esc_until_placeholder 'palette closes after the filter round-trip' 15
for _ in $(seq 1 4); do send BSpace; sleep 0.3; done
send '/mo'
wait_pane_fixed 'filter "/mo" narrows to /model' 10 \
  '/model switch model (bare opens the picker)'
esc_until_placeholder 'palette closes after the /mo filter' 15
for _ in $(seq 1 4); do send BSpace; sleep 0.3; done

# --- editor survives the palette open/close/filter cycles --------------------
ensure_editor_ready 'editor survives the palette open/close/filter cycles'

# --- /model: the in-container empty-catalog feedback row ---------------------
ensure_editor_ready 'editor focused before /model' || true
send '/model' Enter
wait_pane_fixed '/model reports the empty catalog (no picker)' 15 \
  'no models in the catalog' \
  && assert_not_contains 'no model picker overlay opened' \
    'Select model' "$(capture)"
ensure_editor_ready 'editor usable after /model'

# --- unknown command: the harmless error row ----------------------------------
ensure_editor_ready 'editor focused before /nope' || true
send '/nope' Enter
wait_pane_fixed 'unknown /nope yields the error row (never a model send)' 15 \
  'unknown command: /nope (try /help)'
ensure_editor_ready 'editor usable after the unknown command'

summary
