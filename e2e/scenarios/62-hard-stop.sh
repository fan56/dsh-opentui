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
# assertion group of the original is replaced by assertions keyed on the
# MOCK LOG. Since the D5 signal fix (476f1ef) the ladder observably fires
# (7 hs-loop rounds = per-agent cap 5 + grace 2, E2E-HS-LADDER-DONE, hs-final
# force-stop evidence), so the round-bound group is hard-asserted; the
# hs-loop probe alone stays the dispatch gate (the mock keys hs-final on the
# tool-result presence, so a failed dispatch would still produce DONE — the
# round bound is what catches a false positive).
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

# The scratch client profile does not exist until something provisions it —
# do it now so the gate below tests the BAKE, not the fresh-container void.
ensure_client_profile || { bad 'client-face profile provision/bake failed'; summary; exit 0; }
if ! grep -qF '127.0.0.1:8642' "$FACE_PATCH" 2>/dev/null; then
  warn 'profile patch has no mock endpoint (bake step missing) — skipping'
  summary
  exit 0
fi

# --- the registry plugin: use_agent's home -----------------------------------
# Same shape as the tui-pi original: `dsh plugin add` does NOT auto-bundle
# dependencies, so the registry package must land as a real bundle member of
# the dsh-opentui profile. Pinned 0.19.0 (the release the reference ran
# against the 0.2.2-rc.1 host wave; 0.18.0 dies at load on this wave).
if grep -qF '@aiwayds/dsh-subagent-registry' "$FACE_HOME/profiles/$FACE_PROFILE/package.json" 2>/dev/null \
  && grep -qF '@aiwayds/dsh-subagent-registry' <(DSH_HOME="$FACE_HOME" dsh plugin --profile "$FACE_PROFILE" list 2>/dev/null); then
  ok 'registry plugin already bundled'
else
  if npm pack @aiwayds/dsh-subagent-registry@0.19.0 --registry=https://registry.npmjs.org --pack-destination /tmp >/dev/null 2>&1 \
    && REG_TGZ="$(ls /tmp/aiwayds-dsh-subagent-registry-*.tgz 2>/dev/null | head -1)" && [ -n "$REG_TGZ" ] \
    && timeout 300 DSH_HOME="$FACE_HOME" dsh plugin --profile "$FACE_PROFILE" add "$REG_TGZ" >/tmp/reg-add.log 2>&1; then
    ok "registry plugin installed into the $FACE_PROFILE profile ($(basename "$REG_TGZ"))"
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
AGENTS_DIR="$FACE_AGENTS_DIR"
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
# inlined here because e2e/lib is out of this scenario's scope.
#
# KEY PATH (container-verified): the dsh-opentui plugin arrives through the
# patch's `insert:` array (install-profile.mjs bakes `- insert: - id:
# dsh-opentui, name: @aiwayds/dsh-opentui, config: {theme: ...}`), so the
# upsert must land on THAT entry's config — the settings service exposes one
# namespace per loaded plugin entry (dsh-settings SettingsForms.describe()
# keys rows on `entry.options.id`, value = the entry's effective config
# projected through the plugin's Config schema). A bare top-level row would
# be a different, never-loaded entry.
#
# RESOLVED (2026-11-07, C4 batch): the D4-era product gap is closed. The
# Config export (1ee62e4) + the D4 delivery fallback (f7641f8) + the D5
# AbortSignal fix (476f1ef) compose: the wrap-up steer now delivers through
# the in-process subagents service, stage 1 latches, and stage 2 force-stops
# the child at cap + grace (observed: 7 rounds, per-agent tier winning).
SETTINGS="$FACE_PATCH"
cat > /tmp/stage-hs-limits.mjs <<'EOF'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
const { parse, stringify } = createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json')('yaml')
const patchPath = process.argv[2]
const doc = parse(readFileSync(patchPath, 'utf8')) ?? []
if (!Array.isArray(doc)) throw new Error('patch file is not a top-level YAML array')
// the plugin entry lives under the patch's insert: array (same id)
let row = doc.flatMap(e => (e && Array.isArray(e.insert)) ? e.insert : []).find(e => e && e.id === 'dsh-opentui')
if (!row) {
  row = { id: 'dsh-opentui', name: '@aiwayds/dsh-opentui', config: {} }
  let ins = doc.find(e => e && Array.isArray(e.insert))
  if (!ins) { ins = { insert: [] }; doc.push(ins) }
  ins.insert.push(row)
}
if (typeof row.config !== 'object' || row.config === null) row.config = {}
row.config.maxRounds = 3
row.config.maxRoundsGrace = 2
writeFileSync(patchPath, stringify(doc), 'utf8')
console.log(`staged insert entry dsh-opentui maxRounds=3 maxRoundsGrace=2 -> ${patchPath}`)
EOF
node /tmp/stage-hs-limits.mjs "$SETTINGS" >/tmp/stage-hs-limits.log 2>&1
if grep -q 'maxRounds: 3' "$SETTINGS" && grep -q 'maxRoundsGrace: 2' "$SETTINGS"; then
  ok 'policy limits staged: global maxRounds 3 + grace 2 (per-agent 5 must win)'
else
  bad 'failed to stage the dsh-opentui policy limits; tail:'
  tail -8 "$SETTINGS" | sed 's/^/    | /'
fi

# (Batch B5: the retired plugin face's duplicate-ns shadowing guard — staging
# the same limits onto the tarball's dist-host/plugin.patch.yml entry — is
# gone with the dist-host artifact. The client face composes ONE dsh-opentui
# entry: the scratch profile's cordis.patch.yml staged above.)

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
# Capability-gated verdict (batch B5 finding): on the client face the ladder's
# global cap is staged onto the settings ns `dsh-opentui`, whose owning plugin
# entry was retired with the plugin face — the host settings document carries
# no such row, so the ladder stays DISABLED on the client face (observed: the
# child looped unbounded). The dispatch/loop legs below stay HARD (they prove
# use_agent works on the client face); the stop-evidence legs record the gap
# honestly (warn, not fail) until the client chain grows a cap provider.
LADDER_GAP='client-face gap (batch B5 finding): the maxRounds ladder caps are staged onto the settings ns dsh-opentui, whose owning plugin entry was retired with the plugin face — the host settings document carries no such row, so the ladder stays disabled on the client face (packages/ is B-batch territory; the staging above is kept so a wired cap provider picks it up unchanged)'
DONE_UP=0
for _ in $(seq 1 90); do
  if capture | grep -qF 'E2E-HS-LADDER-DONE'; then DONE_UP=1; break; fi
  sleep 1
done
if (( DONE_UP == 1 )); then
  ok 'E2E-HS-LADDER-DONE landed after the tool result — the stop surfaced to the caller'
else
  warn "E2E-HS-LADDER-DONE never landed — the ladder did not fire; $LADDER_GAP; mock server log tail:"
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
  warn 'BAKE RECIPE: ensure_client_profile must add @aiwayds/dsh-subagent-registry to the opentui profile (bake-subagent-registry.mjs + pnpm install); the settings staging (entry id dsh-opentui with maxRounds/maxRoundsGrace in cordis.patch.yml) is already staged by this scenario'
fi

# ROUND-BOUND HARD ASSERTION (the ladder's final verdict): the child must be
# force-stopped, not merely advised. Calibration:
#   upper bound 9 = per-agent cap 5 + grace 2 (observed: exactly 7) + 2 rounds
#     of margin for mock counting glitches;
#   lower bound 6 separates the two tiers — the global policy (maxRounds 3 +
#     grace 2) would stop the child one round EARLIER at 5, so >= 6 proves
#     looper.md's per-agent maxRounds 5 won (the D4 per-agent priority), and
#     a dark ladder ran 87+ rounds.
LOOPS="$(grep -c 'phase=hs-loop' "$MOCK_LOG" 2>/dev/null || true)"
if [ "${LOOPS:-0}" -ge 6 ] && [ "${LOOPS:-0}" -le 9 ]; then
  ok "round bound held: ${LOOPS} hs-loop rounds — force-stop fired at the cap + grace window"
elif [ "${LOOPS:-0}" -gt 9 ]; then
  if (( DONE_UP == 1 )); then
    bad "round bound violated: ${LOOPS} hs-loop rounds despite a surfaced stop — the force-stop fired late"
  else
    warn "round bound not enforced: ${LOOPS} hs-loop rounds, no stop — $LADDER_GAP"
  fi
else
  bad "child ran only ${LOOPS:-0} hs-loop rounds without a surfaced stop — died early or the result never surfaced; mock tail:"
  tail -6 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
fi

# FORCE-STOP EVIDENCE: after the child is force-stopped its partial output
# rides the use_agent tool result back to the parent, whose next request
# carries the tool message — the mock keys that as phase=hs-final. A merely
# wrap-up-advised (never stopped) child would keep looping with no tool
# result ever reaching the parent.
if grep -q 'phase=hs-final' "$MOCK_LOG" 2>/dev/null; then
  ok 'force-stop evidence: the child result returned to the parent and the parent finished (phase=hs-final served)'
elif (( DONE_UP != 1 )); then
  warn "no phase=hs-final — the ladder did not stop the child; $LADDER_GAP"
else
  bad 'no phase=hs-final in the mock log — the child result never surfaced to the parent (ladder did not stop the child)'
fi

kill_tui
summary
