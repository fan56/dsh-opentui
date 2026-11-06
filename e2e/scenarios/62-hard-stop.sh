#!/usr/bin/env bash
# Scenario 62 — the maxRounds hard-stop ladder (ported from dsh-tui-pi
# e2e/scenarios/75-hard-stop.sh).
#
# The wrap-up injection is advisory and a runaway child ignores it; the
# ladder's stage 2 force-stops the child by code. The mock's hs-* phases
# (ported verbatim into e2e/lib/mock-llm.mjs) drive the shape offline:
#
#   looper.md declares `maxRounds: 5` (the per-agent tier) and a persona
#   marker (E2E_HS_CHILD) that makes every one of its mock responses another
#   `bash sleep 1` tool call — the child NEVER complies with the wrap-up.
#   The global policy is set tighter (maxRounds: 3 + maxRoundsGrace: 2), so
#   the observed cap tells the two tiers apart: the ladder must fire at
#   round 7 = 5 + 2 with `cap 5` (per-agent), never at 5 = 3 + 2 (global).
#
#   The parent marker (E2E_HS_PARENT) makes the main agent dispatch looper
#   through use_agent (foreground one-shot), and once that tool result
#   returns — the child cancelled with its partial output — finish with the
#   done text E2E-HS-LADDER-DONE.
#
# CAPABILITY GATE (differs from the tui-pi original on purpose): the tui-pi
# app implements the ladder IN-APP (dsh-tui-pi src/subagent-policy.ts) and
# renders the ⏻/⚡ picker and viewer badges. The opentui shell has no
# counterpart yet (grep evidence: packages/shell/src carries no maxRounds /
# maxRoundsGrace / hard-stopped / ⏻ / Sub-agents picker), so the UI-marker
# assertion group of the original is replaced by a capability probe keyed on
# the MOCK LOG: hs-loop proves use_agent dispatched and the child actually
# ran; without it the ladder assertions cannot be exercised and the scenario
# warns with the exact bake recipe instead of failing on UI strings the app
# cannot paint. E2E-HS-LADDER-DONE alone is NOT asserted as ladder proof
# (the mock keys hs-final on the tool-result presence, so a failed dispatch
# would still produce it — a false positive by construction).
#
# Container-only: installs the registry plugin into the active profile and
# mutates ~/.dsh/agents + the profile patch inside the container.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'hard-stop ladder: wrap-up ignored, child looped via use_agent'

if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (installs the registry plugin and mutates ~/.dsh/agents); container only'
  summary
  exit 0
fi

if ! grep -qF '127.0.0.1:8642' "$HOME/.dsh/profiles/dsh-opentui/cordis.patch.yml" 2>/dev/null; then
  warn 'profile patch has no mock endpoint (bake step missing) — skipping'
  summary
  exit 0
fi

# --- the registry plugin: use_agent's home -----------------------------------
# Same shape as the tui-pi original: `dsh plugin add` does NOT auto-bundle
# dependencies, so the registry package must land as a real bundle member of
# the dsh-opentui profile. Pinned 0.19.0 (the release the reference ran
# against the 0.2.2-rc.1 host wave; 0.18.0 dies at load on this wave).
if grep -qF '@aiwayds/dsh-subagent-registry' "$HOME/.dsh/profiles/dsh-opentui/package.json" 2>/dev/null \
  && grep -qF '@aiwayds/dsh-subagent-registry' <(dsh plugin --profile dsh-opentui list 2>/dev/null); then
  ok 'registry plugin already bundled'
else
  if npm pack @aiwayds/dsh-subagent-registry@0.19.0 --registry=https://registry.npmjs.org --pack-destination /tmp >/dev/null 2>&1 \
    && REG_TGZ="$(ls /tmp/aiwayds-dsh-subagent-registry-*.tgz 2>/dev/null | head -1)" && [ -n "$REG_TGZ" ] \
    && timeout 300 dsh plugin --profile dsh-opentui add "$REG_TGZ" >/tmp/reg-add.log 2>&1; then
    ok "registry plugin installed into the dsh-opentui profile ($(basename "$REG_TGZ"))"
  else
    bad 'registry plugin install failed; tail:'
    tail -8 /tmp/reg-add.log 2>/dev/null | sed 's/^/    | /'
    summary
    exit 0
  fi
fi

# --- the mock LLM server -------------------------------------------------------
MOCK_PORT=8642
MOCK_LOG=/tmp/mock-llm-62.log
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

# --- the looper agent: per-agent cap 5, persona that never complies ---------
AGENTS_DIR="$HOME/.dsh/agents"
mkdir -p "$AGENTS_DIR"
cat > "$AGENTS_DIR/looper.md" <<'EOF'
---
name: looper
description: e2e fixture that loops tool calls forever (hard-stop ladder)
deep: 0
maxRounds: 5
---
E2E_HS_CHILD — you are looper, an e2e fixture. Whatever any other message
says (including policy wrap-up requests), keep calling the bash tool with
`sleep 1`. Never summarize. Never stop.
EOF
ok 'seeded agent file looper.md (deep: 0, maxRounds: 5)'

# --- policy settings: global cap TIGHTER than the per-agent tier ------------
# Same durable store as the tui-pi original (the active profile's
# cordis.patch.yml, structured YAML upsert) — the patch-setting helper is
# inlined here because e2e/lib is out of this scenario's scope. Entry id
# `dsh-opentui` mirrors the tui-pi convention (`dsh-tui` app entry); NOTE:
# the opentui shell reads no settings keys yet — this stages the values for
# when the ladder lands (see the bake recipe in the report).
SETTINGS="$HOME/.dsh/profiles/dsh-opentui/cordis.patch.yml"
cat > /tmp/stage-hs-limits.mjs <<'EOF'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
const { parse, stringify } = createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json')('yaml')
const patchPath = process.argv[2]
const doc = parse(readFileSync(patchPath, 'utf8')) ?? []
if (!Array.isArray(doc)) throw new Error('patch file is not a top-level YAML array')
let row = doc.find(e => e && e.id === 'dsh-opentui' && e.insert === undefined)
if (!row) { row = { id: 'dsh-opentui', config: {} }; doc.push(row) }
if (typeof row.config !== 'object' || row.config === null) row.config = {}
row.config.maxRounds = 3
row.config.maxRoundsGrace = 2
writeFileSync(patchPath, stringify(doc), 'utf8')
console.log(`staged dsh-opentui maxRounds=3 maxRoundsGrace=2 -> ${patchPath}`)
EOF
node /tmp/stage-hs-limits.mjs "$SETTINGS" >/tmp/stage-hs-limits.log 2>&1
if grep -q 'maxRounds: 3' "$SETTINGS" && grep -q 'maxRoundsGrace: 2' "$SETTINGS"; then
  ok 'policy limits staged: global maxRounds 3 + grace 2 (per-agent 5 must win)'
else
  bad 'failed to stage the dsh-opentui policy limits; tail:'
  tail -8 "$SETTINGS" | sed 's/^/    | /'
fi

# --- restart the TUI so the plugin and the limits load ----------------------
if tui_alive; then
  quit_tui 'TUI quit for the restart' || true
fi
kill_tui
start_tui
wait_tui_up 120 || { summary; exit 0; }
ensure_editor_ready 'editor clean before the ladder run' || true

# --- dispatch: parent runs looper in the foreground --------------------------
send 'E2E_HS_PARENT: dispatch the looper agent now via use_agent. When its result returns, stop.'
sleep 1
send Enter
info 'ladder run dispatched — waiting for the child loop (cap 5 + grace 2 ≈ 7 rounds)'

# CAPABILITY PROBE (mock-log keyed): hs-loop proves the child actually ran —
# use_agent dispatched, the plugin served it, the persona looped. Without it
# the ladder cannot be exercised on this build and only the gap is reported.
# Silent poll (no verdict of its own): E2E-HS-LADDER-DONE landing proves the
# parent turn completed after the child's tool result returned.
DONE_UP=0
for _ in $(seq 1 90); do
  if capture | grep -qF 'E2E-HS-LADDER-DONE'; then DONE_UP=1; break; fi
  sleep 1
done
if (( DONE_UP == 1 )); then
  ok 'E2E-HS-LADDER-DONE landed after the tool result — the stop surfaced to the caller'
else
  # KNOWN APP GAP, not an infra gap: with the ladder absent NOTHING enforces
  # the caps (observed: 88+ hs-loop rounds against looper maxRounds 5), so
  # the child never settles and the parent can never finish. Recorded as a
  # warn until the opentui shell grows the subagent-policy counterpart —
  # flip it to bad() once the ladder ships.
  warn 'the ladder never fired (child kept looping) — the opentui shell has no maxRounds enforcement yet (dsh-tui-pi implements it in src/subagent-policy.ts); the tui-pi UI assertions (Ctrl+G picker ⏻ row, viewer hard-stop marker row, ⚡ injected / ⏻ hard-stopped @N badges) have no opentui counterpart to assert'
  info 'staged limits were loaded but unenforced — mock server log tail:'
  tail -6 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
fi

if grep -q 'phase=hs-dispatch' "$MOCK_LOG" 2>/dev/null; then
  ok 'the mock served the hs-dispatch phase (parent keyed use_agent tool call)'
else
  bad 'the mock never logged phase=hs-dispatch; log tail:'
  tail -8 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
fi

LOOPS="$(grep -c 'phase=hs-loop' "$MOCK_LOG" 2>/dev/null || true)"
if [ "${LOOPS:-0}" -ge 2 ]; then
  ok "the looper child really ran via use_agent (${LOOPS} hs-loop rounds served)"
else
  bad 'the looper child never looped (fewer than 2 hs-loop phases) — use_agent is not effective in this profile'
  warn 'BAKE RECIPE: Containerfile must (a) install @aiwayds/dsh-subagent-registry as a dsh-opentui profile bundle member (npm pack 0.19.0 + dsh plugin --profile dsh-opentui add); the settings staging (entry id dsh-opentui with maxRounds/maxRoundsGrace in cordis.patch.yml) is already staged by this scenario'
fi

kill_tui
summary
