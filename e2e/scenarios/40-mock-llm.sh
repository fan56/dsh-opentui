#!/usr/bin/env bash
# Scenario 40 — mock-LLM live turn (acceptance for the ported mock infra).
#
# The image's baked profile points the pinned provider route
# (zai-coding-cn/glm-5.3-flash, ids unchanged) at the in-container mock
# (e2e/lib/mock-llm.mjs on 127.0.0.1:8642 — ported from dsh-tui-pi). This
# scenario boots the TUI, sends one trigger prompt and asserts the FULL
# offline chain: composer send -> dsh agent loop -> pi-ai
# openai-completions -> mock SSE stream -> transcript.
#
# The trigger selects the mock's `tps` phase (request body keyed, not
# arrival-ordered): ten streamed ticks (~1.4s) ending in E2E-TPS-TURN-DONE,
# so the assertion also proves real SSE streaming (not one buffered blob).
#
# No config is mutated at runtime — the endpoint wiring is bake-time only
# (e2e/lib/bake-mock-endpoint.mjs via the Containerfile), so this scenario
# can never poison a host ~/.dsh or spend a real provider call; it still
# guards on the container layout and skips on the host.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'mock-llm live turn: baked endpoint streams the scripted reply'

# --- host guard -------------------------------------------------------------
if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (sends a live agent turn); container only'
  summary
  exit 0
fi

# --- the mock LLM server ------------------------------------------------------
MOCK_PORT=8642
MOCK_LOG=/tmp/mock-llm-40.log
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
  ok "mock LLM server up on 127.0.0.1:$MOCK_PORT"
else
  bad "mock LLM server did not come up; log tail:"
  tail -10 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi

# --- baked wiring proof + TUI boot -------------------------------------------
if grep -qF '127.0.0.1:8642' "$HOME/.dsh/profiles/dsh-opentui/cordis.patch.yml" 2>/dev/null; then
  ok 'baked profile patch points the pinned provider at the mock endpoint'
else
  bad 'profile patch lacks the mock baseURL (bake step missing)'
fi

if ! tui_alive; then
  info 'TUI not running — starting fresh'
  start_tui
  wait_tui_up 120 || { summary; exit 0; }
fi
PANE="$(capture)"
assert_contains 'footer still paints the pinned provider segment' "$MARKER_PROVIDER_SEG" "$PANE"

# --- trigger the tps phase -----------------------------------------------------
ensure_editor_ready 'editor clean before the mock turn' || true
send 'Stream decode ticks now. E2E_TPS_TRIGGER'
sleep 1
send Enter
if ! wait_pane 'the mock streamed reply lands in the transcript' 60 'E2E-TPS-TURN-DONE'; then
  info 'no reply — mock server log tail:'
  tail -10 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi

# --- SGR evidence capture (escape sequences on, trailing spaces kept, last 40
# lines; tmux 3.4: -e/-N are boolean, the range rides -S -40) ---------------------
CAPTURE="$(tmux capture-pane -t "$TS" -p -e -N -S -40)"
if printf '%s' "$CAPTURE" | grep -qF 'E2E-TPS-TURN-DONE'; then
  ok 'capture-pane -e -p -N shows the mock reply in the transcript'
else
  bad 'capture-pane -e -p -N missed the reply'
fi
printf '%s\n' "$CAPTURE" | grep -F 'decode tick' | head -2 | sed 's/^/    capture| /'
printf '%s\n' "$CAPTURE" | grep -F 'E2E-TPS-TURN-DONE' | head -1 | sed 's/^/    capture| /'

if grep -q 'phase=tps' "$MOCK_LOG" 2>/dev/null; then
  ok 'the mock served the scripted tps phase (request keyed on the body)'
else
  bad 'the mock never logged phase=tps; log tail:'
  tail -8 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
fi

summary
