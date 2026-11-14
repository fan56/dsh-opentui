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
#
# F7c EXTENSION (2026-11-07): /think /hotkeys /plugins groups appended at the
# tail (commands.ts F7a /plugins, F7b /think effort picker + /hotkeys panel).
# DEPENDENCY GATE (the 65-jev-attention model): all three ride the dist-host
# rebuild carrying F7a/F7b — NOT yet baked into the image at write time. The
# scenario greps the INSTALLED bundle at runtime; gate dark -> only the
# pre-verifiable G0 runs (the three palette rows must be ABSENT from the
# stale bundle's palette) and each group is logged skipped-by-gate; gate
# lit -> the groups hard-assert. Marker provenance:
#   - palette rows: commands.ts names + descriptions (verbatim);
#   - /think picker: the pickOne overlay title 'Select reasoning effort';
#     tier rows are provider data (seam thinking.efforts reads the model's
#     reasoning.efforts) so row NAMES are never pinned — the assertion is
#     "picker open and >= 1 option row" via a non-empty-line delta;
#   - /hotkeys rows: painted by routes/session/hotkeys.ts from the
#     config/keybind.ts Definitions (`keys — description (name)`); asserted
#     rows are verbatim from a REAL in-container capture of the settled
#     panel (36-row pane) — the panel TAIL, i.e. the which-key.* entries
#     that close Definitions;
#   - /plugins: palette row + the panel title '🔌 Plugins' (+ Esc close) only.
#     Roster rows are never pinned (row text is host/plugin-meta data) and
#     the panel's 'no plugins installed' empty copy is unreachable in this
#     composition (provision installs the 12-plugin default set) — that copy
#     is ft-covered and the deep panel legs live in 71-search.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'slash commands (palette + model + unknown over the core set)'

if ! tui_alive; then
  info 'TUI not running — starting fresh'
  start_tui
  wait_tui_up 180 || summary
fi
ensure_editor_ready 'editor ready before command traffic' || true

# --- palette: the clamped core set ------------------------------------------
# One '/' write from the clean state opens the palette. The window is
# MAX_ROWS=10 (slash-palette.tsx), so the unfiltered list paints the
# alphabetically-first ten rows plus the reserved overflow row; any row past
# that window is proven through its own prefix. The overflow count is computed
# from the registry itself so the assertion tracks registry growth instead of
# pinning a literal that drifts every time a command is added.
REGISTRY_ROWS="$(grep -c 'name: "/' /src/packages/tui-base/src/routes/session/commands.ts || true)"
OVERFLOW_ROWS=$(( REGISTRY_ROWS - 10 ))
send '/'
sleep 2
PANE="$(capture)"
assert_contains 'palette row /help (inside the first window)' \
  '/help show available commands' "$PANE"
assert_contains 'palette row /clear (inside the first window)' \
  '/clear clear the transcript' "$PANE"
assert_contains "palette clamps the ${REGISTRY_ROWS}-command registry with the overflow row" \
  "… ${OVERFLOW_ROWS} more" "$PANE"
# Row shape is name + space + description (slash-palette.tsx SlashPalette).
# The selection highlight is color-only, so it is asserted on the SGR
# capture: the ACTIVE row's fg must differ from the base fg of its sibling
# row. The '/m' filter gives exactly two rows (/model first = selected,
# /motion second = base), which makes the comparison deterministic without
# pinning the skin's palette numbers.
send Escape
sleep 1
for _ in $(seq 1 4); do send BSpace; sleep 0.3; done
send '/m'
wait_pane_fixed 'filter "/m" lists /model + /motion' 10 \
  '/model switch model (bare opens the picker, then the effort picker)'
# One repaint tick: the row area paints stale until the next keystroke (the
# known in-container behavior), so an instant capture can still be blank.
sleep 1
SGR="$(capture_sgr)"
ACTIVE_FG="$(printf '%s' "$SGR" | grep -oE '38;5;[0-9]+m/model' | tail -1 | grep -oE '38;5;[0-9]+' || true)"
BASE_FG="$(printf '%s' "$SGR" | grep -oE '38;5;[0-9]+m/motion' | tail -1 | grep -oE '38;5;[0-9]+' || true)"
if [ -n "$ACTIVE_FG" ] && [ -n "$BASE_FG" ]; then
  if [ "$ACTIVE_FG" != "$BASE_FG" ]; then
    ok "palette highlights the selected row: /model fg ${ACTIVE_FG} vs base fg ${BASE_FG} on /motion"
  else
    bad "palette paints the selected and base rows in the same fg (${ACTIVE_FG}) — the highlight is gone"
  fi
elif [ -n "$BASE_FG" ] && [ -z "$ACTIVE_FG" ]; then
  warn "the active row's fg was not captured (only /motion at ${BASE_FG}): the row area can repaint blank between keystrokes (known in-container stale-paint family); the highlight colours are covered by the composer-palette ft tests"
else
  bad "palette rows not painted at capture time (/model '${ACTIVE_FG}', /motion '${BASE_FG}'); SGR pane tail:"
  printf '%s\n' "$SGR" | tail -6 | sed 's/^/    | /'
fi
send Escape
sleep 0.5
for _ in $(seq 1 4); do send BSpace; sleep 0.3; done

# Rows outside the 10-row window (name-ordered 11th..20th) are proven through
# their own prefix — one write from the closed palette (input law above).
send '/new'
wait_pane_fixed 'palette row /new' 10 '/new start a fresh session'
send Escape
sleep 0.5
for _ in $(seq 1 5); do send BSpace; sleep 0.3; done
send '/qu'
wait_pane_fixed 'palette row /quit' 10 '/quit exit the app'
send Escape
sleep 0.5
for _ in $(seq 1 4); do send BSpace; sleep 0.3; done
send '/res'
wait_pane_fixed 'palette row /resume (the /sessions rename)' 10 \
  '/resume resume a persisted session'
send Escape
sleep 0.5
for _ in $(seq 1 5); do send BSpace; sleep 0.3; done

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
# non-matching query with no overflow row and no /help row).
for _ in $(seq 1 3); do send BSpace; sleep 0.3; done
send '/'
wait_palette_unfiltered 'clearing the filter restores the full list' 12
esc_until_placeholder 'palette closes after the filter round-trip' 15
for _ in $(seq 1 4); do send BSpace; sleep 0.3; done
send '/mo'
wait_pane_fixed 'filter "/mo" narrows to /model' 10 \
  '/model switch model (bare opens the picker, then the effort picker)'
esc_until_placeholder 'palette closes after the /mo filter' 15
for _ in $(seq 1 4); do send BSpace; sleep 0.3; done

# --- editor survives the palette open/close/filter cycles --------------------
ensure_editor_ready 'editor survives the palette open/close/filter cycles'

# --- /model: the baked mock route makes the catalog non-empty ----------------
# Since the mock-endpoint bake (e2e/lib/bake-mock-endpoint.mjs) the pinned
# provider route describes glm-5.3-flash and the credential env carries the
# baked placeholder key, so /model now surfaces the real catalog listing the
# pinned model (pre-bake this build reported 'no models in the catalog' —
# kept as a hard not-contains guard below).
ensure_editor_ready 'editor focused before /model' || true
send '/model' Enter
wait_pane_fixed '/model surfaces the baked catalog (pinned model listed)' 15 \
  "$MARKER_MODEL_SEG" \
  && assert_not_contains 'the empty-catalog feedback row is gone' \
    'no models in the catalog' "$(capture)"
ensure_editor_ready 'editor usable after /model'

# --- unknown command: the harmless error row ----------------------------------
ensure_editor_ready 'editor focused before /nope' || true
send '/nope' Enter
wait_pane_fixed 'unknown /nope yields the error row (never a model send)' 15 \
  'unknown command: /nope (try /help)'
ensure_editor_ready 'editor usable after the unknown command'

# ============================================================================
# F7c extension: /think /hotkeys /plugins (commands.ts F7a/F7b)
# DEPENDENCY GATE (the 65 model): the gate greps the /src workspace snapshot
# (the client face's runtime sources — the dist-host bundle is retired with
# the plugin face); gate dark -> only the pre-verifiable G0 runs and each
# group is logged skipped-by-gate; gate lit -> the groups hard-assert.
# ============================================================================
NEWCMDS_BUNDLE="/src/packages/tui-base/src"
THINK_GATE=0
HOTKEYS_GATE=0
PLUGINS_GATE=0
if [ -d "$NEWCMDS_BUNDLE" ]; then
  grep -rqF 'Select reasoning effort' "$NEWCMDS_BUNDLE" && THINK_GATE=1
  grep -rqF 'Keybinds (defaults' "$NEWCMDS_BUNDLE" && HOTKEYS_GATE=1
  grep -rqF 'no plugins installed' "$NEWCMDS_BUNDLE" && PLUGINS_GATE=1
fi

if (( THINK_GATE )) && (( HOTKEYS_GATE )) && (( PLUGINS_GATE )); then
  ok 'dependency gate LIT: the workspace sources carry /think, /hotkeys and /plugins'
else
  warn 'dependency gate DARK: sources predate the F7a/F7b commands — new-command groups skipped-by-gate'
fi

# --- G0: pre-verifiable absence on the stale bundle (per-command gates) ------
if (( ! THINK_GATE )) || (( ! HOTKEYS_GATE )) || (( ! PLUGINS_GATE )); then
  ensure_editor_ready 'editor clean before the stale-bundle probe' || true
  send '/think'
  sleep 2
  PANE="$(capture)"
  (( THINK_GATE )) || assert_not_contains \
    'G0: /think is absent from the stale bundle palette' \
    '/think set reasoning effort' "$PANE"
  (( HOTKEYS_GATE )) || assert_not_contains \
    'G0: /hotkeys is absent from the stale bundle palette' \
    '/hotkeys show keybinds' "$PANE"
  (( PLUGINS_GATE )) || assert_not_contains \
    'G0: /plugins is absent from the stale bundle palette' \
    '/plugins list installed plugins' "$PANE"
  for _ in $(seq 1 8); do send BSpace; sleep 0.3; done
fi

# --- /think: the effort picker over the model's REAL ladder -------------------
# The ladder is provider data (seam thinking.efforts -> the llm service's
# resolveModelInfo reasoning.efforts), so tier NAMES are never pinned: the
# assertion is "picker open and >= 1 option row". Measured on the dialog's
# focus-border rows: every DialogSelect line is painted between ┃ glyphs,
# while the idle page only has the composer's border rows. (The old metric —
# a non-empty-line delta — is 0 by construction: a full-screen TUI keeps
# every terminal row non-empty, so it could never see the dialog.)
if (( THINK_GATE )); then
  ensure_editor_ready 'editor focused before /think' || true
  BEFORE_PANE="$(capture)"
  send '/think'
  wait_pane_fixed 'palette row /think (F7b command registered)' 10 \
    '/think set reasoning effort (opens the picker)'
  send Enter
  if wait_pane_fixed '/think opens the effort picker' 15 'Select reasoning effort'; then
    AFTER_PANE="$(capture)"
    BASE_ROWS="$(printf '%s\n' "$BEFORE_PANE" | grep -c '┃' || true)"
    AFTER_ROWS="$(printf '%s\n' "$AFTER_PANE" | grep -c '┃' || true)"
    DELTA=$((AFTER_ROWS - BASE_ROWS))
    if (( DELTA >= 2 )); then
      ok "effort picker lists >= 1 option row (dialog border rows $BASE_ROWS -> $AFTER_ROWS; tier names are provider data, not pinned)"
    else
      bad "effort picker shows no option rows (dialog border rows $BASE_ROWS -> $AFTER_ROWS, delta < 2)"
    fi
    esc_until_gone 'effort picker closes on Esc' 'Select reasoning effort'
  else
    info '/think picker never opened (empty-ladder degrade row or absent surface) — the row-count check is moot; see the timed-out marker above'
  fi
else
  warn '/think group skipped-by-gate (dist-host rebuild pending — F7b)'
fi

# --- /hotkeys: the static keybind panel (the /help print path) ----------------
# The panel prints ~150 rows (config/keybind.ts Definitions, none-bound
# entries skipped) — the block scrolls, so the asserted rows are the TAIL
# (the which-key.* entries that close Definitions); the header and the
# early rows scroll off the 36-row pane before the paint settles.
if (( HOTKEYS_GATE )); then
  ensure_editor_ready 'editor focused before /hotkeys' || true
  send '/hotkeys'
  wait_pane_fixed 'palette row /hotkeys (F7b command registered)' 10 \
    '/hotkeys show keybinds'
  send Enter
  # Markers below are verbatim from a REAL in-container capture of the
  # settled panel (36-row pane): the visible tail is the which-key.* block,
  # closing with which-key.end at 'ctrl+alt+end' — NOT 'ctrl+alt+home'
  # (that row is 'Jump to FIRST which-key binding (which-key.home)'; the
  # F7c prewrite guessed the keys column from the Definitions source and
  # got it backwards). The which-key.end row is the genuinely last
  # Definitions row painted, so its arrival proves the print settled.
  wait_pane_fixed '/hotkeys panel finished printing (last Definitions row visible)' 15 \
    'ctrl+alt+end — Jump to last which-key binding (which-key.end)'
  PANE="$(capture)"
  assert_contains 'hotkeys tail row: which-key.toggle' \
    'ctrl+alt+k — Toggle which-key panel (which-key.toggle)' "$PANE"
  assert_contains 'hotkeys tail row: which-key.layout.toggle' \
    'ctrl+alt+shift+k — Switch which-key layout (which-key.layout.toggle)' "$PANE"
  assert_contains 'hotkeys tail row: which-key.end' \
    'ctrl+alt+end — Jump to last which-key binding (which-key.end)' "$PANE"
else
  warn '/hotkeys group skipped-by-gate (dist-host rebuild pending — F7b)'
fi

# --- /plugins: the manager panel ----------------------------------------------
# (C15 semantic merge, batch H3: /plugins no longer prints a listing — it
# opens the manager panel overlay ('🔌 Plugins' title, bundle table +
# state column; the panel's own empty state reads 'no plugins installed').
# The deep panel assertions live in 71-search (H3's scenario); here we
# assert registration + the panel opening, then close it.
if (( PLUGINS_GATE )); then
  ensure_editor_ready 'editor focused before /plugins' || true
  send '/plugins'
  wait_pane_fixed 'palette row /plugins (F7a command registered)' 10 \
    '/plugins manage plugins (opens the panel)'
  send Enter
  if wait_pane '/plugins opens the manager panel' 15 '🔌 Plugins'; then
    # ROSTER-CONTENT LEG SKIPPED (explicit record, not a failed expectation):
    # the retired "empty-by-construction" note was inverted — the client-face
    # roster is non-empty by construction: provision installs the 12-plugin
    # default set into the scratch profile (provision-opentui-profile.mjs
    # [3/5], one `dsh plugin add` batch — real-capture logs confirm
    # "installed 12") and ensure_client_profile (lib/common.sh:206-222) bakes
    # the dispatch/jev chain on top, so the panel's 'no plugins installed'
    # empty copy is unreachable in this composition. That copy is covered by
    # the ft (packages/tui-base/test/commands.test.ts:455-461 "/plugins with
    # an empty list says so"); the deep panel legs (name@version rows, state
    # column, / filter) are asserted in 71-search from real captures. Roster
    # row TEXT is never pinned here: it is host/plugin-meta data
    # (meta.title ?? moduleName — remote-host-session.ts refreshPlugins) and
    # the panel paints at most 12 rows (plugins-panel.tsx), so no specific
    # bundle row is guaranteed visible.
    info 'roster-content leg skipped: non-empty roster is the client-face construction (provision installs the 12-plugin set; the dispatch/jev bake adds more) — the empty-state copy is ft-covered and the deep panel legs live in 71-search'
    esc_until_gone 'plugins panel closes on Esc' '🔌 Plugins'
  fi
else
  warn '/plugins group skipped-by-gate (dist-host rebuild pending — F7a)'
fi

summary
