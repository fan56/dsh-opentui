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
. "$(dirname "$0")/../lib/assert-v2.sh"
scenario 'agent preset switch (/preset picker + /preset next rotation)'

BUNDLE="/src/packages/tui-base/src"

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
if [ -d "$BUNDLE" ] && grep -rqF 'Select agent preset' "$BUNDLE"; then
  PICKER_GATE=1
fi

# --- G0: gate-dark is SKIP, never a PASS ---------------------------------------
# v2 B-class fix: asserting the degrade copy ("unknown command: /preset") with
# ok() and the picker's ABSENCE with assert_not_contains() counted a downgrade
# as a pass. Under v2 the feature is SKIP (unexercisable in this checkout) and
# is listed explicitly in report.md with both criteria.
if (( PICKER_GATE == 0 )); then
  ensure_editor_ready 'editor clean before the stale-bundle /preset probe' || true
  send '/preset'
  sleep 2
  send Enter
  # Observation only — no ok()/bad() counter; the verdict is SKIP below.
  PANE="$(capture)"
  v2_skip 'CMD-30' '/preset picker + rotation' \
    'workspace sources predate H2 (/preset picker absent); degrade copy observed, not a feature check' \
    'G0: /preset is an unknown command in the stale bundle (wait_pane_fixed ok) + picker absent (assert_not_contains ok)' \
    '/preset opens the picker listing >=2 presets; /preset next switches with a visible footer change'
  info "gate-dark observation: $(printf '%s' "$PANE" | grep -oE 'unknown command: /preset[^ ]*' | head -1)"
  v2_summary
  summary
  exit 0
fi
ok 'dependency gate LIT: the workspace sources carry the /preset picker'

# --- probe roster availability live: /preset's own reaction is the oracle -----
# (C15: the footer brand segment was the original probe, but it reflects the
# SELECTED preset, not roster availability — it stays plain "dsh" whenever
# nothing is selected, even with a full roster. Empirical split: after
# 62-hard-stop installs @aiwayds/dsh-subagent-registry into the profile the
# agentPresets roster is non-empty and /preset opens the picker, while the
# footer still reads plain "dsh" — the footer probe misrouted that state into
# the degrade arm and the notice assert timed out 2/2 in the shared suite
# (standalone, with no registry install, the roster reads empty and the
# notice path passed). So: send /preset once and branch on what appears.)
ensure_editor_ready 'editor focused before the /preset availability probe' || true
send '/preset'
sleep 1
send Enter
PRESET_PICKER=0
PRESET_NOTICE=0
for _ in $(seq 1 10); do
  PANE="$(capture)"
  if printf '%s' "$PANE" | grep -qF 'Select agent preset'; then PRESET_PICKER=1; break; fi
  if printf '%s' "$PANE" | grep -qF 'no agent presets available'; then PRESET_NOTICE=1; break; fi
  sleep 1
done
HAS_PRESETS=0
if (( PRESET_PICKER )); then
  HAS_PRESETS=1
  ok 'presets available: /preset opens the picker'
  esc_until_gone 'preset picker closes on Esc' 'Select agent preset'
elif (( PRESET_NOTICE )); then
  # v2: "no agent presets available" is a degraded surface, not a PASS.
  bad '/preset reports only the no-presets notice — the preset feature is unavailable on this deployment (no degrade-as-PASS under v2)'
  v2_record 'CMD-30' A L1 FAIL '/preset opens a picker with >=2 presets (L1)' \
    'G0: /preset is an unknown command / no agent presets notice accepted as PASS' \
    '/preset opens a picker listing >=2 presets' \
    'no-presets notice painted; footer stayed plain dsh'
else
  bad '/preset produced neither the picker nor the no-presets notice; tail:'
  capture | tail -8 | sed 's/^/    | /'
fi

# --- /preset next (picker arm only) ---------------------------------------------
if (( HAS_PRESETS )); then

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
      bad "confirmed switch did not change the footer label ($BEFORE — silent no-op is FAIL under v2)"
      v2_record 'CMD-30' A L2 FAIL 'preset switch changes the footer label (L2)' \
        'warn "confirmed switch did not change the footer label (single preset?)"' \
        'footer label changes to the newly selected preset' 'no state change observed'
    fi
  else
    AFTER="$(printf '%s' "$PANE" | grep -oE 'dsh\([^)]+\)' | head -1)"
    if [[ -n "$AFTER" && "$AFTER" != "$BEFORE" ]]; then
      ok "/preset next applied directly: $BEFORE → $AFTER"
    else
      bad "/preset next did not change preset ($BEFORE — silent no-op is FAIL under v2)"
      v2_record 'CMD-30' A L2 FAIL 'preset switch changes the footer label (L2)' \
        'warn "/preset next did not change preset (single preset or no-op)"' \
        'footer label changes to the newly selected preset' 'no state change observed'
    fi
  fi
else
  # No presets — the degrade notice + plain-dsh footer were already asserted
  # by the live probe above (C15 restructure: one /preset send, branched).
  :
fi

# --- editor still usable after preset traffic ---------------------------------
ensure_editor_ready 'editor usable after preset operations'

v2_summary
summary
