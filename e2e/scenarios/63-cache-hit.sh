#!/usr/bin/env bash
# Scenario 63 — footer CH (cache-hit) segment: lastMessage default + live
# session-mode switch (ported from dsh-tui-pi e2e/scenarios/71-cache-hit.sh).
#
# UN-GATED (C6 batch): the cacheHitMode SESSION mode landed in 05c0664 (both
# usage handlers + the config seam reader + both adapters). The first real
# container run against that surface pinned two corrections that are baked
# into step 4 below (see the REAL-CAPTURE note there):
#   - the mode's durable store is the plugin config FILE (config.json), not
#     the cordis.patch.yml settings namespace;
#   - the footer getter re-runs only at reactive turn boundaries, so the
#     live flip is driven across a failed (unbilled) third turn.
#
# The CH segment rates depend on REAL billed usage, and the container has no
# provider credentials — so this scenario reuses the baked local
# OpenAI-compatible mock (e2e/lib/mock-llm.mjs on 127.0.0.1:8642) and its
# cache-bearing usage phases (ch-warm / ch-cold, ported verbatim). Two
# scripted turns carry DIFFERENT cache ratios (OpenAI
# prompt_tokens_details.cached_tokens, mapped to cacheRead by pi-ai's
# openai-completions adapter):
#
#   turn one (ch-warm):  1000 prompt tokens, 900 cached -> that message's rate is 90%
#   turn two (ch-cold):  1000 prompt tokens, 200 cached -> that message's rate is 20%
#   session cumulative over both: 1100 read / 2000 billed = 55%
#
# The three rates are mutually distinct, so the footer's displayed value
# identifies the active mode. The scenario runs against a FRESH session
# (clean TUI restart — a cold start lazily creates a new session, no auto-
# resume) so the cumulative denominator is exactly the two scripted turns:
#
#   1. no usage yet -> no CH segment at all;
#   2. after turn one the segment shows 90% (both modes agree on one sample);
#   3. after turn two the DEFAULT mode (lastMessage) shows 20% — the stale
#      90% and the cumulative 55% must both be absent;
#   4. committing `cacheHitMode: session` into the plugin config FILE
#      (config.json — the store HostSession.configLoad() reads) and crossing
#      a turn boundary (a third, mock-less turn whose failure lands no usage)
#      re-runs the footer getter in session mode: the cumulative 55% replaces
#      the per-message 20% on the SAME running instance — no restart.
#
# MARKER MAP (pinned against the real C6 container capture — the painted
# format matches the reference 'CH<rate>%' shape, one decimal):
#   'E2E_CH_TRIGGER' / 'E2E-CH-TURN-ONE' / 'E2E-CH-TURN-TWO'
#       mock CH phase trigger + turn reply markers (mock-llm.mjs, identical
#       in the reference).
#   'phase=ch-warm' / 'phase=ch-cold'
#       mock decidePhase request log lines (identical in the reference).
#   'CH90.0%' / 'CH20.0%' / 'CH55.0%'
#       footer CH segment rates (cacheSegment: `⚡ CH${rate.toFixed(1)}%`).
#
# Container-only: persists cacheHitMode into the container's throwaway
# ~/.dsh profile — never run against a host config.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'footer CH: lastMessage default + live session-mode switch'

# --- host guard -------------------------------------------------------------
if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (persists cacheHitMode into ~/.dsh; container only)'
  summary
  exit 0
fi
if ! grep -qF '127.0.0.1:8642' "$HOME/.dsh/profiles/dsh-opentui/cordis.patch.yml" 2>/dev/null; then
  warn 'profile patch has no mock endpoint (bake step missing) — skipping'
  summary
  exit 0
fi

# --- the mock LLM server (same port as the baked route) -------------------------
MOCK_PORT=8642
MOCK_LOG=/tmp/mock-llm-63.log
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

# --- fresh session: the cumulative rate must cover ONLY the scripted turns ---
kill_tui
start_tui
wait_tui_up 120 || { summary; exit 0; }
ensure_editor_ready 'editor clean before the CH turns' || true

# --- 1. no usage yet -> no CH segment ----------------------------------------
PANE="$(capture)"
assert_not_contains 'no CH segment before any billed usage' '⚡ CH' "$PANE"

# --- 2. turn one (warm cache): CH 90% -----------------------------------------
send 'Prove the warm cache path now. E2E_CH_TRIGGER'
sleep 1
send Enter
if ! wait_pane 'turn one completes with the warm-cache reply' 45 'E2E-CH-TURN-ONE'; then
  info 'turn one never finished — mock server log tail:'
  tail -10 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi
# The footer updates on the finalized assistant message (its usage snapshot),
# which trails the streamed text — poll for the segment rather than snapshot.
wait_pane 'turn one shows its 90% hit rate' 15 'CH90\.0%'

# --- 3. turn two (cold cache): the DEFAULT mode follows the latest message ----
send 'Prove the cold cache path now. E2E_CH_TRIGGER'
sleep 1
send Enter
if ! wait_pane 'turn two completes with the cold-cache reply' 45 'E2E-CH-TURN-TWO'; then
  info 'turn two never finished — mock server log tail:'
  tail -10 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi
wait_pane 'default lastMessage mode shows the latest message rate (20%)' 15 'CH20\.0%'
PANE="$(capture)"
assert_not_contains 'the previous message rate does not stick (sample follows the latest)' 'CH90\.0%' "$PANE"
assert_not_contains 'the session-cumulative rate does not leak into lastMessage mode' 'CH55\.0%' "$PANE"

# --- 4. external config edit flips the mode live (no restart) ------------------
# REAL-CAPTURE CORRECTIONS (first scheduled run vs the 05c0664 surface,
# container 2026-11-07):
#
#   a. STORE: the mode is read through HostSession.configLoad(), which reads
#      the plugin config FILE configPath('config.json') — i.e.
#      ~/.dsh/profiles/dsh-opentui/config.json — NOT cordis.patch.yml. The
#      patch file is the dsh-settings namespace (62 stages maxRounds there,
#      but that is read at boot); editing it while the TUI is LIVE re-mounts
#      the plugin entry and the second mountEngine dies with 'Cannot create
#      CliRenderer: stdin is already used by another CliRenderer' (observed:
#      the old renderer kept painting the stale 20%).
#
#   b. RE-RUN TIMING: the footer's segments getter re-runs only at REACTIVE
#      boundaries (turnBusy/msgs flips) — a plain repaint does not re-execute
#      configLoad(). The flip is therefore driven across a turn boundary: the
#      mock is stopped and a third turn is sent. It fails WITHOUT landing
#      usage, and the boundary re-runs the getter in session mode — the
#      cumulative rate over the two scripted turns (1100/2000 = 55%)
#      replaces the per-message 20%, no restart in between. The failed turn
#      also cannot skew the denominator (no usage frame), so 55% is exact.
SETTINGS="$HOME/.dsh/profiles/dsh-opentui/config.json"
cat > /tmp/stage-ch-mode.mjs <<'EOF'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const path = process.argv[2]
let doc = {}
if (existsSync(path)) {
  try { doc = JSON.parse(readFileSync(path, 'utf8')) ?? {} } catch { doc = {} }
}
if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) doc = {}
doc.cacheHitMode = 'session'
writeFileSync(path, JSON.stringify(doc, null, 2) + '\n', 'utf8')
console.log(`staged cacheHitMode=session -> ${path}`)
EOF
node /tmp/stage-ch-mode.mjs "$SETTINGS" >/tmp/stage-ch-mode.log 2>&1
if grep -q '"cacheHitMode": "session"' "$SETTINGS"; then
  ok 'plugin config file now carries cacheHitMode: session'
else
  bad 'cacheHitMode: session did not land in config.json; tail:'
  tail -6 /tmp/stage-ch-mode.log 2>/dev/null | sed 's/^/    | /'
fi

# Stop the mock so the third turn fails (no usage lands) and its turn-boundary
# re-runs the footer getter — the session rate must already show the 2-turn
# cumulative 55%.
kill "$MOCK_PID" 2>/dev/null || true
send 'Prove the session cumulative rate now. E2E_CH_TRIGGER'
sleep 1
send Enter
wait_pane 'session mode flips the footer to the cumulative rate (live apply)' 15 'CH55\.0%'
PANE="$(capture)"
assert_not_contains 'the per-message rate does not leak into session mode' 'CH20\.0%' "$PANE"
assert_not_contains 'the stale warm rate does not leak into session mode' 'CH90\.0%' "$PANE"

# --- the mock served both scripted cache phases ----------------------------------
if grep -q 'phase=ch-warm' "$MOCK_LOG" 2>/dev/null \
  && grep -q 'phase=ch-cold' "$MOCK_LOG" 2>/dev/null; then
  ok 'the mock served both scripted cache phases'
else
  bad 'the mock never saw both CH phases; log tail:'
  tail -8 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
fi

summary
