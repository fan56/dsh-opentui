#!/usr/bin/env bash
# Scenario 63 — footer CH (cache-hit) segment: lastMessage default + live
# session-mode switch (ported from dsh-tui-pi e2e/scenarios/71-cache-hit.sh).
#
# *** DEPENDENCY GATE — DO NOT SCHEDULE YET ***
# The cacheHitMode SESSION mode is NOT landed on this surface (E1 batch is
# building it; HEAD 34fed99 carries only the raw cacheHitRate() helper in
# packages/shell/src/host-session.ts and no CH mode setting). Until that
# batch lands, the mode-flip leg (step 4) has no product to assert against
# and this scenario is EXPECTED TO FAIL. Written ahead of the batch so the
# acceptance shape is pinned; assertions are complete but NOT part of the
# current verified suite.
# *******************************************
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
#   4. committing `cacheHitMode: session` into the container's active profile
#      patch (an external edit, live-applied through the settings watch hook)
#      flips the same segment to 55% without a restart.
#
# MARKER MAP (to be pinned against a REAL capture of the E1 surface before
# the first scheduled run — the segment's exact painted format below follows
# the reference 'CH<rate>%' shape and is the only unpinned marker):
#   'E2E_CH_TRIGGER' / 'E2E-CH-TURN-ONE' / 'E2E-CH-TURN-TWO'
#       mock CH phase trigger + turn reply markers (mock-llm.mjs, identical
#       in the reference).
#   'phase=ch-warm' / 'phase=ch-cold'
#       mock decidePhase request log lines (identical in the reference).
#   'CH90.0%' / 'CH20.0%' / 'CH55.0%'
#       footer CH segment rates (reference format); the E1 surface's painted
#       format may differ — re-derive from a container capture when landing.
#
# Container-only: persists cacheHitMode into the container's throwaway
# ~/.dsh profile patch — never run against a host config.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'footer CH: lastMessage default + live session-mode switch (E1-gated)'

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

# --- 4. external settings edit flips the mode live -----------------------------
# The durable settings store is the active profile's cordis.patch.yml; the
# edit goes through a structured YAML upsert onto the dsh-opentui insert
# entry's config (the namespace the settings service exposes — same key path
# 62-hard-stop stages its maxRounds through; the helper is inlined because
# e2e/lib is out of this scenario's scope).
SETTINGS="$HOME/.dsh/profiles/dsh-opentui/cordis.patch.yml"
cat > /tmp/stage-ch-mode.mjs <<'EOF'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
const { parse, stringify } = createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json')('yaml')
const patchPath = process.argv[2]
const doc = parse(readFileSync(patchPath, 'utf8')) ?? []
if (!Array.isArray(doc)) throw new Error('patch file is not a top-level YAML array')
let row = doc.flatMap(e => (e && Array.isArray(e.insert)) ? e.insert : []).find(e => e && e.id === 'dsh-opentui')
if (!row) {
  row = { id: 'dsh-opentui', name: '@aiwayds/dsh-opentui', config: {} }
  let ins = doc.find(e => e && Array.isArray(e.insert))
  if (!ins) { ins = { insert: [] }; doc.push(ins) }
  ins.insert.push(row)
}
if (typeof row.config !== 'object' || row.config === null) row.config = {}
row.config.cacheHitMode = 'session'
writeFileSync(patchPath, stringify(doc), 'utf8')
console.log(`staged insert entry dsh-opentui cacheHitMode=session -> ${patchPath}`)
EOF
node /tmp/stage-ch-mode.mjs "$SETTINGS" >/tmp/stage-ch-mode.log 2>&1
if grep -q 'cacheHitMode: session' "$SETTINGS"; then
  ok 'profile patch now carries cacheHitMode: session'
else
  bad 'cacheHitMode: session did not land in the profile patch; tail:'
  tail -6 /tmp/stage-ch-mode.log 2>/dev/null | sed 's/^/    | /'
fi

wait_pane 'session mode flips the footer to the cumulative rate (live apply)' 15 'CH55\.0%'
PANE="$(capture)"
assert_not_contains 'the per-message rate does not leak into session mode' 'CH20\.0%' "$PANE"

# --- the mock served both scripted cache phases ----------------------------------
if grep -q 'phase=ch-warm' "$MOCK_LOG" 2>/dev/null \
  && grep -q 'phase=ch-cold' "$MOCK_LOG" 2>/dev/null; then
  ok 'the mock served both scripted cache phases'
else
  bad 'the mock never saw both CH phases; log tail:'
  tail -8 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
fi

summary
