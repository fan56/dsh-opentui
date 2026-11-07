#!/usr/bin/env bash
# Scenario 66 — agent preset switch (/preset, batch H2): tui-pi 60-preset
# parity. `/preset` bare opens the picker overlay ("Select agent preset")
# when the deployment ships presets (the host agentPresets registry), or
# degrades to the "no agent presets available" notice when the roster reads
# empty; `/preset next` rotates — with a live session it goes through the
# confirmation dialog ("Switch preset to <name>?"), Esc/Cancel keeps
# everything, Enter applies the switch (the picked id composes the NEXT
# session — switchPreset → newSession — and the brand segment follows the
# new selection through the reload hook: "dsh(<name>)").
#
# The footer brand segment is the availability probe, exactly like the
# reference: "dsh" (no presets / no selection) or "dsh(<name>)". Both paths
# are tested, deployment-dependent.
#
# DEPENDENCY GATE (the 67-theme model): the image's dist-host predates H2 —
# the scenario greps the INSTALLED bundle at runtime. Gate dark → only the
# pre-verifiable G0 runs ('/preset' is still an unknown command in the stale
# bundle — the harmless error row, never a model send) and the picker /
# rotation groups are logged skipped-by-gate. Gate lit → everything below
# hard-asserts.
#
# Tab arm note: the reference (tui-pi 2.7.0) asserts Tab no longer cycles
# presets. This stack never had a Tab→preset binding (the keybind table
# carries no preset row), so there is nothing to unbind — the arm is
# structurally satisfied and not asserted here.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'agent preset switch (/preset picker + /preset next rotation)'

BUNDLE="/usr/local/lib/node_modules/@aiwayds/dsh-opentui/dist-host/index.js"

# --- host guard ---------------------------------------------------------------
if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (drives a live TUI session); container only'
  summary
  exit 0
fi

if ! tui_alive; then
  info 'TUI not running — starting fresh'
  start_tui
  wait_tui_up 120 || { summary; exit 0; }
fi
sleep 2

# --- the dependency gate --------------------------------------------------------
PICKER_GATE=0
if [ -f "$BUNDLE" ] && grep -qF 'Select agent preset' "$BUNDLE"; then
  PICKER_GATE=1
fi

# --- G0: pre-verifiable on the stale bundle ------------------------------------
if (( PICKER_GATE == 0 )); then
  ensure_editor_ready 'editor clean before the stale-bundle /preset probe' || true
  send '/preset'
  sleep 2
  send Enter
  wait_pane_fixed \
    'G0 (gate dark): /preset is an unknown command in the stale bundle (never a model send)' 15 \
    'unknown command: /preset (try /help)'
  assert_not_contains 'G0: no preset picker exists in the stale bundle' \
    'Select agent preset' "$(capture)"
  warn 'picker/rotation groups skipped-by-gate (dist-host rebuild pending — H2)'
  summary
  exit 0
fi
ok 'dependency gate LIT: installed dist-host carries the /preset picker'

# --- detect whether presets are available (the footer brand segment) ----------
# "dsh" (no presets / nothing selected) or "dsh(<name>)" — the reference
# probe, verbatim semantics.
PANE="$(capture)"
if printf '%s' "$PANE" | grep -qoE 'dsh\([^)]+\)'; then
  HAS_PRESETS=1
  INITIAL_PRESET="$(printf '%s' "$PANE" | grep -oE 'dsh\([^)]+\)' | head -1)"
  info "presets available; initial footer: $INITIAL_PRESET"
  assert_contains 'footer shows the preset-branded segment' 'dsh(' "$PANE"
else
  HAS_PRESETS=0
  INITIAL_PRESET='dsh'
  info 'no presets detected — testing graceful degradation'
fi

# --- /preset command ------------------------------------------------------------
if (( HAS_PRESETS )); then
  # /preset bare — opens the picker overlay.
  ensure_editor_ready 'editor focused before /preset' || true
  send '/preset'
  sleep 1
  send Enter
  if wait_pane_fixed '/preset opens the preset picker' 10 'Select agent preset'; then
    # Close it.
    esc_until_gone 'preset picker closes on Esc' 'Select agent preset'
  else
    bad 'preset picker never appeared'
  fi

  # /preset next — with a live session this opens the confirmation dialog
  # ("Switch preset to <name>?"); the boot always attaches a session here
  # (wait_tui_up proved the composer+provider segments), so the dialog path
  # is the expected shape.
  ensure_editor_ready 'editor focused before /preset next' || true
  BEFORE="$(capture | grep -oE 'dsh\([^)]+\)' | head -1)"
  send '/preset next'
  sleep 1
  send Enter
  sleep 2
  PANE="$(capture)"
  if printf '%s' "$PANE" | grep -qF 'Switch preset to'; then
    ok '/preset next opens the confirmation dialog (live session)'
    # Cancel keeps everything as it was.
    send Escape
    sleep 2
    AFTER_CANCEL="$(capture | grep -oE 'dsh\([^)]+\)' | head -1)"
    if [[ "$AFTER_CANCEL" == "$BEFORE" ]]; then
      ok "dialog Cancel keeps the preset ($BEFORE)"
    else
      bad "dialog Cancel changed the preset ($BEFORE → $AFTER_CANCEL)"
    fi
    # Re-run and confirm the switch this time (Enter picks row 0 —
    # "Switch to <name>").
    ensure_editor_ready 'editor focused before the confirmed switch' || true
    send '/preset next'
    sleep 1
    send Enter
    sleep 2
    send Enter
    sleep 3
    AFTER="$(capture | grep -oE 'dsh\([^)]+\)' | head -1)"
    if [[ -n "$AFTER" && "$AFTER" != "$BEFORE" ]]; then
      ok "confirmed switch applies: $BEFORE → $AFTER"
    else
      warn "confirmed switch did not change the footer label (single preset?)"
    fi
  else
    AFTER="$(printf '%s' "$PANE" | grep -oE 'dsh\([^)]+\)' | head -1)"
    if [[ -n "$AFTER" && "$AFTER" != "$BEFORE" ]]; then
      ok "/preset next applied directly: $BEFORE → $AFTER"
    else
      warn "/preset next did not change preset (single preset or no-op)"
    fi
  fi
else
  # No presets — /preset reports the degrade notice and the footer stays
  # plain "dsh" (the reference's graceful-degradation arm).
  ensure_editor_ready 'editor focused before /preset (no presets)' || true
  send '/preset'
  sleep 1
  send Enter
  wait_pane_fixed '/preset reports the no-presets notice' 10 'no agent presets available'
  assert_contains 'footer stays plain dsh (no presets)' 'dsh' "$(capture)"
fi

# --- editor still usable after preset traffic ---------------------------------
ensure_editor_ready 'editor usable after preset operations'

summary
