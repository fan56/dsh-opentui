#!/usr/bin/env bash
# Scenario 72 — /agents agent-definition manager (tui-pi agents manager
# parity; see packages/tui-base/src/routes/session/agents-panel.tsx).
#
# The command no longer prints a named "model profile" roster into the
# transcript: it opens ONE manager panel over the `${DSH_HOME}/agents/*.md`
# corpus. Layers:
#
#   table    title `● Agents`, booktabs table NAME/MODEL/DEEP/DESCRIPTION,
#            the empty-corpus hint when no file parses;
#   fields   `● <name>` + Field/Value rows (model / thinking / deep);
#   limits   `⚙ Limits` + the official caps.
#
# Esc walks back one layer (table -> close; fields -> table; limits ->
# table/close). The panel is entirely offline — no model turn.
#
# DEPENDENCY GATE (the 66-preset model): the scenario greps the workspace
# sources (the client face runs /src; the dist-host bundle is retired with
# the plugin face). Gate dark -> only the absence probe runs and the panel
# groups are logged skipped-by-gate; gate lit -> everything hard-asserts.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'agents manager: /agents table / empty corpus / fields + limits layers'

BUNDLE="/src/packages/tui-base/src"
# The manager reads the scratch DSH_HOME's agents corpus (FACE_AGENTS_DIR from
# lib/common.sh), never the retired baked /root/.dsh profile.
AGENTS_DIR="$FACE_AGENTS_DIR"

# --- host guard ---------------------------------------------------------------
if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (drives a live TUI session); container only'
  summary
  exit 0
fi

# --- dependency gate -----------------------------------------------------------
AGENTS_GATE=0
if [ -d "$BUNDLE" ] \
  && grep -rqF '● Agents' "$BUNDLE" \
  && grep -rqF '⚙ Limits' "$BUNDLE"; then
  AGENTS_GATE=1
fi

if (( AGENTS_GATE == 0 )); then
  ensure_editor_ready 'editor clean before the stale-bundle /agents probe' || true
  send '/agents'
  sleep 2
  send Enter
  wait_pane_fixed \
    'G0 (gate dark): /agents is not the manager in these sources (never a model send)' 15 \
    'unknown command: /agents (try /help)' || true
  assert_not_contains 'G0: no agents manager title exists in the stale sources' \
    '● Agents' "$(capture)"
  warn 'manager groups skipped-by-gate (sources predate the agents manager)'
  summary
  exit 0
fi
ok 'dependency gate LIT: the workspace sources carry the /agents manager'

# --- deterministic seed: empty corpus -----------------------------------------
# The registry plugin seeds sample agents at INSTALL time (62-hard-stop), so a
# stale corpus would otherwise leak into the empty-state assertion.
kill_tui
rm -rf "$AGENTS_DIR"
mkdir -p "$AGENTS_DIR"
ok 'agents corpus reset (deterministic empty roster)'

start_tui
wait_tui_up 120 || { summary; exit 0; }

# --- 1. empty corpus -----------------------------------------------------------
ensure_editor_ready 'editor clean before the empty-corpus /agents' || true
send '/agents'
sleep 1
send Enter
if wait_pane 'bare /agents opens the manager (empty corpus)' 20 '● Agents'; then
  PANE="$(capture)"
  # The subagent registry plugin seeds its sample agents at install/boot, so
  # "corpus is empty" is a composition-dependent state. Assert the copy when
  # it applies; otherwise record that the corpus was re-seeded (the table is
  # the other legitimate state).
  if printf '%s' "$PANE" | grep -qF "no agents in $AGENTS_DIR yet"; then
    ok 'empty corpus names the real agents directory'
    assert_contains 'empty state keeps the file-drop affordance' \
      'drop a markdown file to define one' "$PANE"
  else
    warn 'corpus was re-seeded (subagent registry sample agents) — the empty-corpus copy is not reachable in this composition; the table state is asserted next'
  fi
fi
esc_until_gone 'empty-corpus manager closes on Esc' '● Agents'

# --- 2. a real agent file surfaces as a table row -------------------------------
cat > "$AGENTS_DIR/scribe.md" <<'EOF'
---
name: scribe
description: e2e fixture agent (agents manager table row)
deep: 0
---
E2E_AGENTS_SCRIBE — a fixture definition, never dispatched.
EOF
ok 'seeded agent file scribe.md (deep: 0)'

ensure_editor_ready 'editor clean before the seeded /agents' || true
# The argument preselects the EXACT name row (commands.ts), so Enter reaches
# the seeded agent's fields layer deterministically even when the registry
# plugin has seeded its sample agents alongside.
send '/agents scribe'
sleep 1
send Enter
# Wait on the PANEL title first: 'scribe' also matches the composer buffer
# the text was typed into, which paints before Enter is processed.
if wait_pane 'seeded /agents opens the manager' 20 '● Agents'; then
  PANE="$(capture)"
  assert_contains 'seeded agent appears in the table' 'scribe' "$PANE"
  assert_contains 'table renders the NAME column header' 'NAME' "$PANE"
  assert_contains 'table renders the MODEL column header' 'MODEL' "$PANE"
  assert_contains 'table footer advertises Enter/Esc navigation' \
    '↑↓ navigate · Enter open · Esc back' "$PANE"
fi

# --- 3. Enter opens the fields layer ------------------------------------------
# The table header is uppercased by headerLine() ("FIELD"/"VALUE"); the panel
# needs a beat after mount before its key filter is live.
sleep 1.5
send Enter
if wait_pane 'enter on the row opens the fields layer' 15 'FIELD'; then
  PANE="$(capture)"
  assert_contains 'fields layer titles the selected agent' '● scribe' "$PANE"
  assert_contains 'fields layer lists the deep row' 'deep' "$PANE"
  assert_contains 'fields layer footer advertises the field editors' \
    'Enter edit' "$PANE"
fi
send Escape
sleep 1

# --- 4. the limits layer (official caps) --------------------------------------
esc_until_gone 'manager closes from the table' '● Agents'
ensure_editor_ready 'editor clean before the limits layer' || true
send '/agents'
sleep 1
send Enter
if wait_pane 'manager reopens for the limits layer' 20 '● Agents'; then
  send l
  if wait_pane 'l opens the global limits layer' 15 '⚙ Limits'; then
    PANE="$(capture)"
    assert_contains 'limits layer lists the official concurrency cap' \
      'maxActiveSubagents' "$PANE"
    assert_contains 'limits layer lists the official depth cap' 'maxDepth' "$PANE"
  fi
  send Escape
  sleep 1
fi
esc_until_gone 'manager fully closes' '● Agents'

summary
