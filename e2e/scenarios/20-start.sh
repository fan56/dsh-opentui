#!/usr/bin/env bash
# Scenario 20 — opentui startup: launch the `dsh-opentui` plugin profile
# inside tmux (a real PTY), then review the first painted screen: composer
# placeholder + keybinding hint, powerline footer with brand/provider/model
# segments, ticking clock (HH:MM:SS, two captures differ), and a live editor.
#
# Editor echo/backspace note: OpenTUI's diff paint has a known upstream bug
# (docs/upstream-opentui-paint-bug-draft.md — "the process stays alive and
# keeps processing input correctly — only the screen is wrong"), so the
# composer VALUE line can render stale while typing. The assertions below
# therefore drive the slash palette, which repaints reliably and mirrors the
# composer buffer exactly: '/quit' filters the row list (5 chars echoed),
# backspaces restore the unfiltered list (buffer cleared back to '/'),
# Escape closes the palette. Same editor-buffer semantics as the dsh-tui-pi
# harness's echo+backspace assertions, observed through a reliable surface.
#
# Markers were derived from a REAL boot capture inside the container, not
# guessed from source.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'opentui startup (composer / powerline / clock / editor in tmux)'

start_tui
wait_tui_up 180 || summary

# --- first paint ----------------------------------------------------------
PANE="$(capture)"
assert_contains 'composer placeholder rendered' "$MARKER_COMPOSER_PLACEHOLDER" "$PANE"
assert_contains 'composer keybinding hint rendered' "$MARKER_COMPOSER_HINT" "$PANE"

# --- powerline footer -----------------------------------------------------
assert_contains 'footer shows the pinned provider segment' "$MARKER_PROVIDER_SEG" "$PANE"
assert_contains 'footer shows the pinned model segment' "$MARKER_MODEL_SEG" "$PANE"
assert_contains 'footer model segment carries the powerline emoji prefix' \
  "$MARKER_MODEL_SEG_POWERLINE" "$PANE"
# The clock ticks at 1s resolution (host-entry-v2.tsx: toTimeString().slice(0,8)).
assert_matches 'footer clock visible (HH:MM:SS)' '[0-9]{2}:[0-9]{2}:[0-9]{2}' "$PANE"

# --- ticking clock: two captures 2.5s apart must disagree ------------------
CLOCK_ERE='[0-9]{2}:[0-9]{2}:[0-9]{2}'
T1="$(capture | grep -oE "$CLOCK_ERE" | tail -1)"
sleep 2.5
T2="$(capture | grep -oE "$CLOCK_ERE" | tail -1)"
if [ -n "$T1" ] && [ -n "$T2" ] && [ "$T1" != "$T2" ]; then
  ok "clock ticks ($T1 -> $T2)"
else
  bad "clock did not tick between captures ('$T1' vs '$T2')"
fi

# --- editor accepts input (observed through the slash palette) -------------
# Typing '/quit' filters the palette to that one command: the /quit row is
# listed for ANY '/' query, so echo is proven by the /help row DISAPPEARING
# (prefix '/quit' no longer matches it) while the /quit row stays.
send '/quit'
sleep 2
PALE="$(capture)"
assert_contains 'editor echoes typed text (/quit row listed)' \
  '/quit exit the app' "$PALE"
assert_not_contains 'editor echoes typed text (/help row filtered out)' \
  '/help show available commands' "$PALE"

# Backspaces clear the query. The palette row area paints stale until the
# next keystroke (observed in a real capture: the /quit row stays visible
# after the buffer is already cleared), so the proof is a trailing '/':
# appending '/' to a cleared buffer yields the unfiltered command list (the
# /help row, or the `… N more` overflow row once usage ordering pushes /help
# out of the 10-row window), while any leftover text would swallow the '/'
# into a non-matching query with neither signal.
for _ in $(seq 1 8); do send BSpace; sleep 0.3; done
send '/'
wait_palette_unfiltered 'editor cleared after backspaces (trailing / lists all commands)' 12

# Escape closes the palette; the composer placeholder comes back.
esc_until_placeholder 'palette closed, composer placeholder back' 15

summary
