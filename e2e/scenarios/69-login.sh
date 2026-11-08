#!/usr/bin/env bash
# Scenario 69 — /login provider login (batch H4, tui-pi 65-ux-batch parity):
# the "Add provider" picker (Custom provider first, cursor starts there) and
# the SIX-STEP chained custom form (1 route id → 2 display name → 3 protocol
# → 4 base URL → 5 models → 6 masked API key) with per-step validation (an
# invalid base URL keeps step 4 with the inline error) and the commit
# double-write: the llm-pi-ai route through the settings seam + the key
# through the credentials seam (the key NEVER lands in the settings patch).
# Plus the Esc-abandon path at step 1 (the whole flow closes, nothing
# written).
#
# DEPENDENCY GATE (the 66-preset model): the image's dist-host predates H4 —
# the scenario greps the INSTALLED bundle at runtime for the picker title.
# Gate dark → only the pre-verifiable G0 runs ('/login' is still an unknown
# command in the stale bundle — the harmless error row, never a model send)
# and the form groups are logged skipped-by-gate. Gate lit → everything
# below hard-asserts.
#
# Login never sends a turn, so no mock-llm phase is involved (the reference
# drives the form purely through the dialog host too).
#
# The colliding-route-id arm of the reference (step 1 "already exists") is
# deployment-state-dependent (needs a pre-seeded openai route); it is
# covered by the unit table (test/login.test.ts) instead. The commit-evidence
# file path (~/.dsh/profiles/<profile>/cordis.patch.yml) follows the dsh
# settings layout the reference asserted; if the integration image persists
# namespaces elsewhere, the file arms move with it.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario '/login: add-provider picker + six-step custom form + Esc abandon'

# Face-aware: the plugin face greps the deployed dist-host; the client face
# runs the /src workspace snapshot (grep -r over the sources).
if [ "$E2E_FACE" = client ]; then
  BUNDLE="/src/packages/tui-base/src"
  BUNDLE_GREP=(grep -rqF)
else
  BUNDLE="/usr/local/lib/node_modules/@aiwayds/dsh-opentui/dist-host/index.js"
  BUNDLE_GREP=(grep -qF)
fi

# --- host guard ---------------------------------------------------------------
if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (drives a live TUI session); container only'
  summary
  exit 0
fi

if ! tui_alive; then
  info 'TUI not running — starting fresh'
  start_tui 'DSH_TUI_THEME=dark'
  wait_tui_up 120 || { summary; exit 0; }
fi
sleep 2

# --- the dependency gate --------------------------------------------------------
FORM_GATE=0
if [ -e "$BUNDLE" ] && "${BUNDLE_GREP[@]}" 'Add provider' "$BUNDLE" 2>/dev/null \
  && "${BUNDLE_GREP[@]}" 'Custom provider 1/6' "$BUNDLE" 2>/dev/null; then
  FORM_GATE=1
fi

# Settings patch the login commit writes into (the reference's evidence file).
# Face-aware: the face's own profile dir (plugin face: $HOME/.dsh/
# dsh-opentui; client face: the scratch DSH_HOME's opentui profile).
PATCH="$FACE_PATCH"
UNIQUE_ID='acme-gateway-h4'
UNIQUE_KEY='sk-e2e-h4-login-key'

# --- G0: pre-verifiable on the stale bundle ------------------------------------
if (( FORM_GATE == 0 )); then
  ensure_editor_ready 'editor clean before the stale-bundle /login probe' || true
  send '/login'
  sleep 2
  send Enter
  wait_pane_fixed \
    'G0 (gate dark): /login is an unknown command in the stale bundle (never a model send)' 15 \
    'unknown command: /login (try /help)'
  assert_not_contains 'G0: no add-provider picker exists in the stale bundle' \
    'Add provider' "$(capture)"
  warn 'picker/form groups skipped-by-gate (dist-host rebuild pending — H4)'
  summary
  exit 0
fi
ok 'dependency gate LIT: installed dist-host carries the /login picker + form'

# --- pass 1: the six-step custom form -------------------------------------------
MARKER_ADD_PROVIDER='Add provider'
MARKER_FORM_STEP1='Custom provider 1/6'
MARKER_FORM_STEP4='Custom provider 4/6'

ensure_editor_ready 'editor clean before the login flow' || true
send '/login' Enter
wait_pane '/login opens the add-provider picker' 15 "$MARKER_ADD_PROVIDER" \
  && assert_contains 'picker lists the Custom provider entry' \
    'Custom provider' "$(capture)"

# The custom entry is the FIRST row (cursor starts there) — Enter opens the form.
send Enter
wait_pane 'Enter on Custom provider… opens the chained form at step 1' 15 "$MARKER_FORM_STEP1"

# Field 1 — route id (a fresh unique slug; the collision arm is unit-covered).
send "$UNIQUE_ID" Enter
sleep 2

# Field 2 — display name (optional; skip with empty Enter).
send Enter
sleep 2

# Field 3 — protocol (empty Enter takes the openai-completions default).
send Enter
sleep 2

# Field 4 — base URL. (Step-4 title proves the chain advanced through three
# commits; an invalid URL keeps the step, then a valid one advances.)
wait_pane 'three committed fields advance the form to step 4' 15 "$MARKER_FORM_STEP4"
send 'not-a-url' Enter
sleep 2
PANE="$(capture)"
assert_contains 'an invalid base URL keeps step 4 with the inline error' \
  'http' "$PANE"
for _ in $(seq 1 9); do send BSpace; done
send 'https://gw.internal.example/v1' Enter
sleep 2

# Field 5 — models (comma list).
send 'acme-large,acme-think' Enter
sleep 2

# Field 6 — the masked API key; the final commit writes the settings route +
# the credential, then closes the flow on its own (the subscribed feedback
# row is the in-TUI commit evidence).
send "$UNIQUE_KEY" Enter
wait_pane 'the commit prints the subscribed feedback (key stored, route registered)' 20 \
  'subscribed' \
  || warn 'no subscribed row captured — checking the settings patch directly'
esc_until_gone 'the login flow closes after the custom commit' \
  "$MARKER_FORM_STEP1|$MARKER_ADD_PROVIDER"

if [ -f "$PATCH" ] && grep -qF "$UNIQUE_ID" "$PATCH"; then
  ok 'settings patch carries the hand-declared acme-gateway-h4 route'
else
  bad "settings patch $PATCH lacks the $UNIQUE_ID route; llm-pi-ai tail:"
  grep -A6 'llm-pi-ai' "$PATCH" 2>/dev/null | tail -8 | sed 's/^/    | /' \
    || printf '    | (%s missing or without the ns)\n' "$PATCH"
fi
if [ -f "$PATCH" ] && grep -qF 'ACME_GATEWAY_H4_API_KEY' "$PATCH"; then
  ok 'the settings patch derives the ACME_GATEWAY_H4_API_KEY credential ref'
else
  bad 'the derived credential ref is missing from the settings patch'
fi
if [ -f "$PATCH" ] && grep -qF "$UNIQUE_KEY" "$PATCH"; then
  bad 'the API key leaked into the settings patch (must live in credentials only)'
else
  ok 'the API key never lands in the settings patch'
fi

# --- pass 2: Esc at step 1 abandons the whole flow ------------------------------
ensure_editor_ready 'editor clean before the abandon pass' || true
send '/login' Enter
wait_pane '/login reopens the picker' 15 "$MARKER_ADD_PROVIDER"
send Enter # Custom provider… (first row)
wait_pane 'the form opens at step 1 again' 15 "$MARKER_FORM_STEP1"
send Escape
esc_until_gone 'Esc at step 1 abandons the whole flow (picker included)' \
  "$MARKER_FORM_STEP1|$MARKER_ADD_PROVIDER"

summary
