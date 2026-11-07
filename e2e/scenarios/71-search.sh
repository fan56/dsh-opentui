#!/usr/bin/env bash
# Scenario 71 — /plugins manager panel + cross-session full-text search
# (batch H3; dsh-tui-pi 77-plugins-search parity).
#
# Reference surface (tui-pi 77): the plugins panel is driven read-only —
# open, assert the bundle table, `/` filter narrows it, the state column
# carries on/off labels, Esc back (first Esc pops the filter, second closes
# the panel). The search overlay is exercised via /search (and the
# ctrl+alt+f chord): "🔍 Search sessions" opens, a query over the stored
# corpus returns hits, Esc closes. Enter-resume is left to the /resume
# suites (reference semantics, kept).
#
# STATE-COLUMN GAP (recorded): this stack's plugins seam carries only
# {name, version} — no enabled flag, no toggle — so the panel's state
# column renders the static "on" and the reference's toggle assertions are
# reduced to the on/off label grep (which the static "on" satisfies).
#
# DEPENDENCY GATE (the 66-preset model): the image's dist-host predates H3
# (the batch does not rebuild dist-host) — the scenario greps the INSTALLED
# bundle at runtime. Gate dark → only the pre-verifiable G0 runs ('/search'
# is still an unknown command in the stale bundle — the harmless error row,
# never a model send) and the panel/search groups are skipped-by-gate.
# Gate lit → everything below hard-asserts.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'plugins manager panel + cross-session full-text search (/search)'

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
# (C15: the panel marker for the BUNDLE grep must be emoji-free — the bun
# build transpiles '🔌' in plugins-panel.tsx into a unicode escape, so the
# literal never appears in dist-host/index.js and the gate read dark while
# the bundle actually carried H3 (suite pass 1: gate-dark G0 asserted
# '/search unknown command' against a bundle where /search IS registered).
# Pane captures are tmux-rendered and keep the emoji — those greps stay.)
PANEL_GATE=0
if [ -f "$BUNDLE" ] && grep -qF 'Search sessions' "$BUNDLE" && grep -qF 'Close plugins manager' "$BUNDLE"; then
  PANEL_GATE=1
fi

# --- G0: pre-verifiable on the stale bundle ------------------------------------
if (( PANEL_GATE == 0 )); then
  ensure_editor_ready 'editor clean before the stale-bundle /search probe' || true
  send '/search'
  sleep 2
  send Enter
  wait_pane_fixed \
    'G0 (gate dark): /search is an unknown command in the stale bundle (never a model send)' 15 \
    'unknown command: /search (try /help)'
  assert_not_contains 'G0: no search overlay exists in the stale bundle' \
    'Search sessions' "$(capture)"
  warn 'panel/search groups skipped-by-gate (dist-host rebuild pending — H3)'
  summary
  exit 0
fi
ok 'dependency gate LIT: installed dist-host carries the H3 panel + overlay'

# --- /plugins: the manager panel ------------------------------------------------
ensure_editor_ready 'editor clean before the plugin panel' || true
send '/plugins'
sleep 1
send Enter
wait_pane '/plugins opens the manager panel' 20 '🔌 Plugins'
PANE="$(capture)"
if printf '%s' "$PANE" | grep -qE '(^|[^a-z])on([^a-z]|$)'; then
  ok 'state column carries the on label (static: the seam carries no enabled flag)'
else
  bad 'state column shows no on label; pane tail:'
  printf '%s\n' "$PANE" | tail -12 | sed 's/^/    | /'
fi

# The panel's own `/` filter (the reference's narrowing move — the bundle
# table can scroll past the fold on a wide deployment).
send '/'
sleep 0.5
send 'dsh-opentui'
sleep 1.5
PANE="$(capture)"
if printf '%s' "$PANE" | grep -qF 'dsh-opentui@'; then
  ok 'filter narrows the table to the dsh-opentui row with its version'
else
  bad 'dsh-opentui row not visible after the / filter; pane tail:'
  printf '%s\n' "$PANE" | tail -12 | sed 's/^/    | /'
fi
# First Esc pops the filter (the panel stays open), second closes it.
send Escape
sleep 0.5
PANE="$(capture)"
if printf '%s' "$PANE" | grep -qF '🔌 Plugins'; then
  ok 'first Esc pops the filter, the panel stays open'
else
  bad 'panel closed on the first Esc (expected the filter to pop first)'
fi
send Escape
sleep 1
PANE="$(capture)"
if printf '%s' "$PANE" | grep -qF '🔌 Plugins'; then
  bad 'plugins manager still open after the second Esc'
else
  ok 'second Esc closes the plugins manager'
fi

# --- the chord: ctrl+alt+f opens the same overlay --------------------------------
ensure_editor_ready 'editor clean before the chord check' || true
send C-M-f
wait_pane 'ctrl+alt+f opens the search overlay' 15 'Search sessions'
send Escape
sleep 1

# --- /search: full-text over the stored corpus ------------------------------------
ensure_editor_ready 'editor clean before the search' || true
send '/search'
sleep 1
send Enter
wait_pane '/search opens the query editor' 20 'Search sessions'
# Scenario 40's mock-llm prompt is a persisted user message — the FTS
# corpus needle (the reference's E2E_HS_PARENT move): no live model needed.
send 'E2E_TPS_TRIGGER'
sleep 1
send Enter
wait_pane 'results view shows the scenario-40 hit' 30 'E2E_TPS_TRIGGER'
PANE="$(capture)"
if printf '%s' "$PANE" | grep -qF '🔍 Search sessions'; then
  ok 'results view rendered with the search title'
else
  bad 'search title not visible; pane tail:'
  printf '%s\n' "$PANE" | tail -12 | sed 's/^/    | /'
fi
send Escape
sleep 1
PANE="$(capture)"
if printf '%s' "$PANE" | grep -qF 'Search sessions'; then
  bad 'search overlay still open after Esc'
else
  ok 'Esc closes the search overlay'
fi

kill_tui
summary
