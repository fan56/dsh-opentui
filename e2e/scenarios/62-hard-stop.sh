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
if [ "$E2E_FACE" = client ]; then
  ensure_client_profile || { bad 'client-face profile provision/bake failed'; summary; exit 0; }
fi
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

# DUPLICATE NS GUARD (container-verified 2026-11-07): the tarball's own
# dist-host/plugin.patch.yml ALSO inserts an entry with id `dsh-opentui`
# (name @dsh-opentui/shell, no config), so the composed profile carries TWO
# dsh-opentui entries and settings.describe() emits TWO rows with ns
# `dsh-opentui`. limitsFromSettingsRows returns on the FIRST matching row
# (subagent-policy.ts), and the baked layer composes before the user patch —
# so the user-patch limits above were shadowed and the ladder stayed dark
# (observed: 87 hs-loop rounds WITH the Config export live). Stage the same
# limits onto the baked entry's config so whichever row wins carries them.
BUNDLED_PATCH="/usr/local/lib/node_modules/@aiwayds/dsh-opentui/dist-host/plugin.patch.yml"
# The deployed dist-host is the PLUGIN face's runtime; on the client face the
# TUI runs the /src workspace, whose plugin.patch.yml layer does not exist.
if [ "$E2E_FACE" = plugin ] && [ -f "$BUNDLED_PATCH" ]; then
  node /tmp/stage-hs-limits.mjs "$BUNDLED_PATCH" >>/tmp/stage-hs-limits.log 2>&1
  if grep -q 'maxRounds: 3' "$BUNDLED_PATCH" && grep -q 'maxRoundsGrace: 2' "$BUNDLED_PATCH"; then
    ok 'policy limits also staged onto the bundled plugin.patch.yml entry (duplicate-ns shadowing guard)'
  else
    warn 'failed to stage limits onto the bundled plugin.patch.yml; tail:'
    tail -4 /tmp/stage-hs-limits.log | sed 's/^/    | /'
  fi
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
# LADDER FIRES on this build (C4 batch): the D5 signal fix (476f1ef) unmasked
# the wrap-up delivery — steerChildDetailed's in-process subagents service
# fallback now gets a real AbortSignal, stage 1 latches and stage 2 arms —
# so the ladder assertions are HARD, no warns. The DONE probe below stays a
# poll-only capability gate (the round-bound assertion group is the verdict).
DONE_UP=0
for _ in $(seq 1 90); do
  if capture | grep -qF 'E2E-HS-LADDER-DONE'; then DONE_UP=1; break; fi
  sleep 1
done
if (( DONE_UP == 1 )); then
  ok 'E2E-HS-LADDER-DONE landed after the tool result — the stop surfaced to the caller'
else
  bad 'E2E-HS-LADDER-DONE never landed — the ladder did not fire or its result never surfaced; mock server log tail:'
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
  ok "round bound held: ${LOOPS} hs-loop rounds — force-stop fired at cap 5 + grace 2 (per-agent tier won over global 3+2=5)"
else
  bad "round bound violated: ${LOOPS} hs-loop rounds (expected 6..9; per-agent cap 5 + grace 2 = 7 with a 2-round margin; the global tier 3+2 would stop at 5, a dark ladder ran 87+)"
fi

# FORCE-STOP EVIDENCE: after the child is force-stopped its partial output
# rides the use_agent tool result back to the parent, whose next request
# carries the tool message — the mock keys that as phase=hs-final. A merely
# wrap-up-advised (never stopped) child would keep looping with no tool
# result ever reaching the parent.
if grep -q 'phase=hs-final' "$MOCK_LOG" 2>/dev/null; then
  ok 'force-stop evidence: the child result returned to the parent and the parent finished (phase=hs-final served)'
else
  bad 'no phase=hs-final in the mock log — the child result never surfaced to the parent (ladder did not stop the child)'
fi

kill_tui
summary
