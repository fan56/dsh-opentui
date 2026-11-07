#!/usr/bin/env bash
# Scenario 22 — transcript search overlay (batch H1, tui-pi 22-search
# parity), over a real PTY.
#
# The overlay is the seam-native find bar: the `session.search` keybind
# (ctrl+shift+f, added to the vendored keybind Definitions by H1) opens a
# one-line strip above the transcript ("Find in transcript" placeholder);
# the query live-counts matches over the CURRENT seam transcript rows (the
# same projection the viewport paints — client remote and plugin host faces
# feed one SeamRows store); Enter / shift+Enter walk the matches (N/M
# counter, scrollChildIntoView jump); escape closes; reopening starts a
# FRESH query (no stale counter). The footer pins the discoverability hint
# segment 'Ctrl+Shift+F: search' (default on, tui-pi 22-search parity).
#
# Match targets: two seeded turns whose PROMPT rows carry the deterministic
# needle 'E2E-SEARCH-NEEDLE' (the mock's generic `ignore` phase answers
# them, so both turns settle and the user rows persist) for the positive
# path — exactly two row matches, so the counter walks 1/2 → 2/2 on Enter —
# and an absurd query for the 'No matches' path.
#
# Dependency gate (70-steer pattern): the deployed dist-host bundle must
# carry the H1 find bar, else the scenario skips (rebuild dist-host to run).
set -u
. "$(dirname "$0")/../lib/common.sh"

scenario 'transcript search overlay (Ctrl+Shift+F)'

# --- host guard -------------------------------------------------------------
if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (drives the deployed TUI over a PTY; container only)'
  summary
  exit 0
fi

# --- dependency gate: the deployed bundle must carry the H1 find bar --------
DEPLOYED_BUNDLE="/usr/local/lib/node_modules/@aiwayds/dsh-opentui/dist-host/index.js"
if [ ! -f "$DEPLOYED_BUNDLE" ]; then
  warn "no deployed dsh-opentui bundle at $DEPLOYED_BUNDLE — skipping"
  summary
  exit 0
fi
if ! grep -qF 'Find in transcript' "$DEPLOYED_BUNDLE" 2>/dev/null \
  || ! grep -qF 'session.search' "$DEPLOYED_BUNDLE" 2>/dev/null; then
  warn 'deployed dist-host predates H1 (no transcript search overlay) — skipping (rebuild dist-host to run)'
  summary
  exit 0
fi
ok 'deployed bundle carries the H1 search overlay'

# --- the mock LLM server (same port as the baked route) -------------------------
MOCK_PORT=8642
MOCK_LOG=/tmp/mock-llm-22.log
node "$(dirname "$0")/../lib/mock-llm.mjs" --port "$MOCK_PORT" >"$MOCK_LOG" 2>&1 &
MOCK_PID=$!
cleanup() { kill "$MOCK_PID" 2>/dev/null || true; }
trap cleanup EXIT

MOCK_UP=0
for _ in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:$MOCK_PORT/healthz" >/dev/null 2>&1; then
    MOCK_UP=1
    break
  fi
  sleep 1
done
if (( MOCK_UP == 1 )); then
  ok 'mock LLM server up on 127.0.0.1:8642'
else
  bad 'mock LLM server did not come up; log tail:'
  tail -10 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi

# --- fresh TUI with a long seeded transcript ----------------------------------
kill_tui
start_tui
wait_tui_up 120 || { summary; exit 0; }

# --- discoverability: the footer hint carries the search segment ----------
PANE="$(capture)"
assert_contains 'footer hint shows the search segment' 'Ctrl+Shift+F: search' "$PANE"

# --- seed the transcript: two needle-carrying turns (settled rows) ----------
ensure_editor_ready 'editor clean before the seed turns' || true
send 'E2E-SEARCH-NEEDLE alpha first seed'
sleep 1
send Enter
if ! wait_pane 'seed turn one settles' 60 'E2E mock: no scripted behavior'; then
  info 'no reply — mock server log tail:'
  tail -10 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi
send 'E2E-SEARCH-NEEDLE beta second seed'
sleep 1
send Enter
if ! wait_pane 'seed turn two settles' 60 'E2E mock: no scripted behavior'; then
  info 'no reply — mock server log tail:'
  tail -10 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi

# --- open the search overlay ----------------------------------------------
send C-S-f
wait_pane 'search overlay opens on ctrl+shift+f' 15 'Find in transcript'

# --- negative path: an absurd query reports no matches ----------------------
send 'zzqqxx'
wait_pane 'absurd query reports no matches' 15 'No matches'

# --- positive path: the seeded needle rows match (exactly two) ---------------
for _ in 1 2 3 4 5 6; do send BSpace; sleep 0.3; done
sleep 1
send 'E2E-SEARCH-NEEDLE'
wait_pane 'seeded needle rows match: counter reads 1/2' 15 '1/2'

# --- n/N walk: Enter pages to the second match -------------------------------
send Enter
wait_pane 'enter walks to the second match: counter reads 2/2' 15 '2/2'

# --- close: escape returns to the plain transcript ----------------------------
esc_until_gone 'escape closes the search' 'Find in transcript'

# --- reopen: a fresh, empty query (no stale counter) --------------------------
send C-S-f
wait_pane 'search reopens' 15 'Find in transcript'
sleep 1
PANE="$(capture)"
assert_not_contains 'reopened search starts with a fresh query' 'No matches' "$PANE"

# --- leave a clean editor for the next scenario -------------------------------
send Escape
sleep 1
send Escape
sleep 0.6

summary
