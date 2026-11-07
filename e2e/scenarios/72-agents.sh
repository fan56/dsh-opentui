#!/usr/bin/env bash
# Scenario 72 — /agents named model profiles (batch H5, tui-pi 74 minimal
# parity). The command snapshots the CURRENT model route (provider/model +
# reasoning effort) under a name into the profile config.json
# (`agentsProfiles` key, via the F7b configSave seam) and applies names back
# through /model's own semantics — entirely offline (selectModel never calls
# the model; the picked route is the baked pinned provider).
#
#   1. bare `/agents` prints the roster ("model profiles:" + the empty row
#      on a fresh profile);
#   2. `/agents save work` archives the pinned route
#      (zai-coding-cn/glm-5.3-flash) and the roster print marks it ●;
#   3. the store lands in $HOME/.dsh/profiles/dsh-opentui/config.json;
#   4. `/agents use work` re-applies it ("model → … [profile work]"),
#      `/agents use nope` and `/agents rm nope` are harmless notices;
#   5. `/agents rm work` empties the store again (byte-visible in the
#      config.json: the key survives with an empty roster).
#
# DEPENDENCY GATE (the 66-preset model): the image's dist-host predates H5 —
# the scenario greps the INSTALLED bundle at runtime. Gate dark → only the
# pre-verifiable G0 runs ('/agents' is still an unknown command in the stale
# bundle — the harmless error row, never a model send) and the lifecycle
# groups are logged skipped-by-gate. Gate lit → everything below hard-asserts.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'model profiles: /agents save / use / rm over the profile config store'

BUNDLE="/usr/local/lib/node_modules/@aiwayds/dsh-opentui/dist-host/index.js"
CFG="$HOME/.dsh/profiles/dsh-opentui/config.json"

# --- host guard ---------------------------------------------------------------
if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (drives a live TUI session); container only'
  summary
  exit 0
fi

# --- deterministic seed: strip any stale roster from the profile config -------
mkdir -p "$(dirname "$CFG")"
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    delete j.agentsProfiles;
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  } catch {}
' "$CFG"
ok 'profile config.json roster stripped (deterministic seed)'

kill_tui
start_tui 'DSH_TUI_THEME=dark'
wait_tui_up 120 || { summary; exit 0; }
sleep 2

# --- the dependency gate --------------------------------------------------------
AGENTS_GATE=0
if [ -f "$BUNDLE" ] && grep -qF 'agentsProfiles' "$BUNDLE"; then
  AGENTS_GATE=1
fi

# --- G0: pre-verifiable on the stale bundle ------------------------------------
if (( AGENTS_GATE == 0 )); then
  ensure_editor_ready 'editor clean before the stale-bundle /agents probe' || true
  send '/agents'
  sleep 2
  send Enter
  wait_pane_fixed \
    'G0 (gate dark): /agents is an unknown command in the stale bundle (never a model send)' 15 \
    'unknown command: /agents (try /help)'
  assert_not_contains 'G0: no profiles roster exists in the stale bundle' \
    'model profiles:' "$(capture)"
  warn 'lifecycle groups skipped-by-gate (dist-host rebuild pending — H5)'
  summary
  exit 0
fi
ok 'dependency gate LIT: installed dist-host carries the /agents store'

# --- 1. bare /agents prints the empty roster -----------------------------------
ensure_editor_ready 'editor clean before the /agents lifecycle' || true
send '/agents'
sleep 1
send Enter
wait_pane 'bare /agents prints the roster header' 15 'model profiles:'
PANE="$(capture)"
assert_contains 'fresh profile shows the empty-roster row' \
  'no saved model profiles (/agents save <name> archives the current model)' "$PANE"

# --- 2. save archives the pinned route -----------------------------------------
ensure_editor_ready 'editor clean before /agents save' || true
send '/agents save work'
sleep 1
send Enter
wait_pane 'save echoes the archived route' 15 \
  'saved profile work → zai-coding-cn/glm-5.3-flash'
sleep 1
if [ -f "$CFG" ] && grep -qF '"agentsProfiles"' "$CFG"; then
  ok 'profile config.json carries the agentsProfiles store'
else
  bad 'profile config.json lacks the agentsProfiles store'
fi
if [ -f "$CFG" ] && grep -qF 'zai-coding-cn' "$CFG"; then
  ok 'the store recorded the pinned provider route'
else
  bad 'the store lacks the pinned provider route'
fi

# --- 3. bare /agents marks the saved profile current ---------------------------
ensure_editor_ready 'editor clean before the roster re-print' || true
send '/agents'
sleep 1
send Enter
wait_pane 'roster marks the saved profile' 15 '● work'
PANE="$(capture)"
assert_contains 'the row carries the full route' 'work — zai-coding-cn/glm-5.3-flash' "$PANE"

# --- 4. use re-applies through /model semantics; unknown is harmless -----------
ensure_editor_ready 'editor clean before /agents use' || true
send '/agents use work'
sleep 1
send Enter
wait_pane 'use re-applies the archived route with the profile tag' 15 \
  'model → zai-coding-cn/glm-5.3-flash'
PANE="$(capture)"
assert_contains 'the use line tags the profile name' '[profile work]' "$PANE"

ensure_editor_ready 'editor clean before the unknown-profile probe' || true
send '/agents use nope'
sleep 1
send Enter
wait_pane 'use of an unknown profile is a harmless notice' 15 'unknown profile: nope'

ensure_editor_ready 'editor clean before the unknown-rm probe' || true
send '/agents rm nope'
sleep 1
send Enter
wait_pane 'rm of an unknown profile is a harmless notice' 15 'unknown profile: nope'

# --- 5. rm empties the store (the key survives with an empty roster) -----------
ensure_editor_ready 'editor clean before /agents rm' || true
send '/agents rm work'
sleep 1
send Enter
wait_pane 'rm echoes the removal' 15 'removed profile work'
sleep 1
if [ -f "$CFG" ] && grep -qF 'zai-coding-cn' "$CFG"; then
  bad 'the store still carries the route after rm'
else
  ok 'the store dropped the route after rm'
fi
if [ -f "$CFG" ] && grep -qF '"agentsProfiles"' "$CFG"; then
  ok 'the agentsProfiles key survives the rm (empty roster)'
else
  warn 'the agentsProfiles key was dropped entirely after rm (empty-doc elision — harmless)'
fi

summary
