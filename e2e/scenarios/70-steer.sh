#!/usr/bin/env bash
# Scenario 70 — subagent steer injection through the SubagentsTab picker
# (ported from dsh-tui-pi e2e/scenarios/70-steer-injection.sh; G2 batch).
#
# tui-pi parity shape (viewer Enter-steer) mapped onto the opentui shell:
#   picker open → the running child's row → Enter opens the steer prompt
#   (DialogPrompt, "Steer <agent>" title) → submit rides the session seam's
#   steerChild (plugin face: HostSession in-process; client face: the
#   remote-subagents steer RPC) → success echoes `steered <agent>` and the
#   steer text reaches the child's next LLM request (mock-log evidence).
#   Esc in the prompt cancels silently.
#
# 62-mode seeding (same fixtures as 62-hard-stop.sh, offline):
#   - looper.md persona marker E2E_HS_CHILD keeps every child response another
#     `bash sleep 1` tool call, so the child stays RUNNING (no maxRounds here
#     — the ladder must NOT fire; a live child is the whole point) while the
#     steer is injected;
#   - the parent marker E2E_HS_PARENT dispatches looper through use_agent.
#
# CAPABILITY GATE (tui-pi's "deployed plugin predates v0.17.0" pattern): the
# steer UI must exist in the DEPLOYED dist-host bundle. Until dist-host is
# rebuilt with the G2 batch this scenario SKIPS with a warn — the strings
# grepped are the steer prompt title ("Steer ") and the success echo
# ("steered "), both unique to the G2 UI.
#
# Container-only: installs the registry plugin into the active profile and
# mutates ~/.dsh/agents (same rules as 62-hard-stop.sh).
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'subagent steer injection: picker → Enter → steer prompt → seam.steerChild'

if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (installs the registry plugin and mutates ~/.dsh/agents); container only'
  summary
  exit 0
fi

# --- dependency gate: the runtime sources must carry the G2 steer UI --------
# The client face runs the /src workspace snapshot (grep -r over the
# sources) — the dist-host bundle is retired with the plugin face.
DEPLOYED_BUNDLE="/src/packages/tui-base/src"
BUNDLE_GREP=(grep -rqF)
if [ ! -e "$DEPLOYED_BUNDLE" ]; then
  warn "no workspace snapshot at $DEPLOYED_BUNDLE — skipping"
  summary
  exit 0
fi
if ! "${BUNDLE_GREP[@]}" 'steered ' "$DEPLOYED_BUNDLE" 2>/dev/null \
  || ! "${BUNDLE_GREP[@]}" 'subagentSteerWired' "$DEPLOYED_BUNDLE" 2>/dev/null; then
  warn 'workspace sources predate G2 (no steer echo / steer bridge) — skipping'
  summary
  exit 0
fi
ok 'workspace sources carry the G2 steer UI'

# The scratch client profile does not exist until something provisions it —
# do it now so the gate below tests the BAKE, not the fresh-container void.
ensure_client_profile || { bad 'client-face profile provision/bake failed'; summary; exit 0; }
if ! grep -qF '127.0.0.1:8642' "$FACE_PATCH" 2>/dev/null; then
  warn 'profile patch has no mock endpoint (bake step missing) — skipping'
  summary
  exit 0
fi

# --- the registry plugin: use_agent's home (same block as 62) ---------------
if grep -qF '@aiwayds/dsh-subagent-registry' "$FACE_HOME/profiles/$FACE_PROFILE/package.json" 2>/dev/null \
  && grep -qF '@aiwayds/dsh-subagent-registry' <(DSH_HOME="$FACE_HOME" dsh plugin --profile "$FACE_PROFILE" list 2>/dev/null); then
  ok 'registry plugin already bundled'
else
  if npm pack @aiwayds/dsh-subagent-registry@0.19.0 --registry=https://registry.npmjs.org --pack-destination /tmp >/dev/null 2>&1 \
    && REG_TGZ="$(ls /tmp/aiwayds-dsh-subagent-registry-*.tgz 2>/dev/null | head -1)" && [ -n "$REG_TGZ" ] \
    && timeout 300 DSH_HOME="$FACE_HOME" dsh plugin --profile "$FACE_PROFILE" add "$REG_TGZ" >/tmp/reg-add-70.log 2>&1; then
    ok "registry plugin installed into the $FACE_PROFILE profile ($(basename "$REG_TGZ"))"
  else
    bad 'registry plugin install failed; tail:'
    tail -8 /tmp/reg-add-70.log 2>/dev/null | sed 's/^/    | /'
    summary
    exit 0
  fi
fi

# --- the mock LLM server ------------------------------------------------------
MOCK_PORT=8642
MOCK_LOG=/tmp/mock-llm-70.log
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

# --- the looper agent: NO maxRounds (the child must stay live to steer) -----
AGENTS_DIR="$FACE_AGENTS_DIR"
mkdir -p "$AGENTS_DIR"
cat > "$AGENTS_DIR/looper.md" <<'EOF'
---
name: looper
description: e2e fixture that loops tool calls forever (steer target)
deep: 0
---
E2E_HS_CHILD — you are looper, an e2e fixture. Whatever any other message
says (including steering requests), keep calling the bash tool with
`sleep 1`. Never summarize. Never stop.
EOF
ok 'seeded agent file looper.md (deep: 0, no maxRounds — the child stays live)'

# --- policy isolation: DISABLE the global ladder for this scenario ----------
# Scenario isolation (D7): 62-hard-stop.sh stages `maxRounds: 5 /
# maxRoundsGrace: 2` as TOP-LEVEL keys of the scratch profile's config.json —
# the live round-limits read (remote-host-session.ts parseSubagentRoundLimits
# (this.configLoad()); the old cordis.patch.yml dsh-opentui entry is a dead
# target) — and that staging survives across scenarios (run-all.sh shares
# /tmp/client-dsh). With it live, the global ladder force-stops the looper
# child at round 7 (5 + 2 grace), long before the steer can be injected. This
# scenario needs a LIVE child, so it upserts maxRounds 0 / maxRoundsGrace 0
# into that same config.json: a non-positive global cap disables the whole
# ladder (subagent-policy.ts #resolveCaps returns undefined →
# ladderDecision never consulted).
SETTINGS="$FACE_CFG"
cat > /tmp/stage-steer-isolation.mjs <<'EOF'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const path = process.argv[2]
let doc = {}
if (existsSync(path)) {
  try { doc = JSON.parse(readFileSync(path, 'utf8')) ?? {} } catch { doc = {} }
}
if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) doc = {}
doc.maxRounds = 0
doc.maxRoundsGrace = 0
writeFileSync(path, JSON.stringify(doc, null, 2) + '\n', 'utf8')
console.log(`staged maxRounds=0 maxRoundsGrace=0 -> ${path}`)
EOF
node /tmp/stage-steer-isolation.mjs "$SETTINGS" >/tmp/stage-steer-isolation.log 2>&1
# (Batch B5: the retired plugin face's second staging target — the dist-host
# plugin.patch.yml — is gone with the dist-host artifact; the client face
# reads ONE round-limits source, the scratch profile's config.json top-level
# keys staged above.)
if grep -q '"maxRounds": 0' "$SETTINGS"; then
  ok 'policy ladder disabled for this scenario ("maxRounds": 0 staged into config.json — 62 seeding isolated)'
else
  bad 'failed to stage the maxRounds 0 isolation; tail:'
  tail -8 "$SETTINGS" 2>/dev/null | sed 's/^/    | /'
fi

# --- restart the TUI so the plugin and the agent load ------------------------
if tui_alive; then
  quit_tui 'TUI quit for the restart' || true
fi
kill_tui
start_tui
wait_tui_up 120 || { summary; exit 0; }
ensure_editor_ready 'editor clean before the steer run' || true

# --- dispatch: parent runs looper in the foreground --------------------------
send 'E2E_HS_PARENT: dispatch the looper agent now via use_agent. Do not summarize.'
sleep 1
send Enter
info 'dispatch sent — waiting for the looper child to loop'

CHILD_UP=0
for _ in $(seq 1 60); do
  if grep -q 'phase=hs-loop' "$MOCK_LOG" 2>/dev/null; then
    CHILD_UP=1
    break
  fi
  sleep 1
done
if (( CHILD_UP == 1 )); then
  ok 'the looper child is live (hs-loop rounds served by the mock)'
else
  bad 'the looper child never started (no hs-loop phases) — use_agent is not effective; mock log tail:'
  tail -6 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  kill_tui
  summary
  exit 0
fi

# --- open the picker ----------------------------------------------------------
# session.child.first ("down") toggles the SubagentsTab composer picker.
send Down
# D7: give the running-status fold a beat to land before asserting the row —
# the picker filters to RUNNING rows when "show inactive" is off.
sleep 1
if wait_pane_fixed 'picker opens with the looper row' 15 'Looper'; then
  :
else
  bad 'the SubagentsTab picker never showed the looper row; pane tail:'
  capture | tail -12 | sed 's/^/    | /'
  kill_tui
  summary
  exit 0
fi
PANE="$(capture)"
assert_contains 'picker footer hint rendered' 'Subagents' "$PANE"

# --- Enter on the running row → the steer prompt -----------------------------
# C11b2 TERMINAL FINDING (instrumented container iteration, tmux
# capture-pane -e -p -N around Enter): the C11 "nothing paints" break is GONE
# in the current product batch — Enter on the running row DOES paint the
# DialogPrompt ("Steer [Fg] Looper" title, "Steer message" textarea label,
# "submit enter" footer), the textarea takes focus (cursor jumps onto the
# prompt row) and echoes typed text. The scenario was red for two SCENARIO
# reasons, both fixed here:
#   1. stale matcher: the prompt title carries the agent display decoration
#      ("Steer [Fg] Looper" — the deep:0 foreground marker), so the old
#      fixed-string 'Steer Looper' never matched a fully correct render;
#   2. scrolling input: the prompt textarea is a single-line SCROLLING input
#      (~43 visible cols) — a 45-char steer text echoed fully into the buffer
#      but the pane only ever shows the tail ("E_STEER_70…", cursor pinned at
#      col 86), so a contiguous contains-assert on the full text can never
#      match. Fixed by keeping the marker text short (see STEER_TEXT below).
send Enter
if wait_pane 'Enter opens the steer prompt' 15 'Steer .*Looper'; then
  :
else
  bad 'Enter on the running row never opened the steer prompt; pane tail:'
  capture | tail -12 | sed 's/^/    | /'
  kill_tui
  summary
  exit 0
fi
sleep 1 # dialog mount beat: textarea focus lands a beat after the first paint

# --- Esc cancel path: silent return, nothing delivered -----------------------
send Escape
sleep 1
PANE="$(capture)"
if printf '%s' "$PANE" | grep -qE 'Steer .*Looper'; then
  bad 'cancel-path: Esc left the steer prompt open'
else
  ok 'cancel-path: Esc closed the steer prompt'
fi

# --- reopen and inject the steer text ----------------------------------------
send Enter
if wait_pane 'steer prompt reopens' 15 'Steer .*Looper'; then
  :
else
  bad 'steer prompt did not reopen for the injection'
  kill_tui
  summary
  exit 0
fi
sleep 1 # dialog mount beat: focus lands after the first paint (cursor on the prompt row)
# The steer prompt textarea is a single-line SCROLLING input (~43 visible
# cols, instrumented cursor evidence: a 45-char text ends with the cursor at
# col 86 and the pane showing only the tail "E_STEER_70…" — the full string
# IS in the buffer but scrolled). Keep the marker text short enough to be
# fully visible, or the contains-assert matches nothing.
STEER_TEXT='E2E_STEER_70 wrap up after next call'
send "$STEER_TEXT"
sleep 1
assert_contains 'steer editor echoed the typed text' "$STEER_TEXT" "$(capture)"
send Enter

# --- success echo -------------------------------------------------------------
# C11b2 TERMINAL FINDING (instrumented container iterations, tmux
# capture-pane -e -p -N before/after each key, cursor tracking): the submit
# leg breaks the same way on the FIRST open and on a post-Esc reopen, so it
# is not an Esc-cleanup artifact:
#   Enter on a populated prompt closes the dialog (cursor returns to the
#   composer) with NO "steered <agent>" echo AND no delivery — the mock LLM
#   never sees steer-marker=E2E_STEER_70 in the child's request stream (60s
#   window; the child keeps looping throughout).
# C12 UPDATE: with the 9be0e6e rebuild both legs work — the steer-marker IS
# logged (delivery OK) and the echo prints as a D9 transcript row, but the
# row text is `steered ${agent.toLowerCase()}` (composer/subagents-tab.tsx
# :133 — lowercase agent id, NOT the decorated display name), so the old
# case-sensitive `steered .*Looper` never matched. Matcher loosened to a
# case-insensitive agent word.
# Two candidate product breaks, both in the rebuilt dist-host (recipe):
#   1. packages/tui-base/src/ui/dialog-prompt.tsx — Enter never reaches
#      confirm()/onConfirm (the modal keymap at :85 binds only escape; submit
#      rides the footer action "dialog.prompt.submit" at :146/:154 — that
#      trigger appears dead, Enter silently cancels instead), OR
#   2. packages/tui-base/src/routes/session/composer/subagents-tab.tsx:129
#      onConfirm DID run but steerSubagent
#      (packages/tui-base/src/routes/session/subagent-markers.ts:85)
#      returned falsy — no seam registered on this face / the sessionID not
#      matched by HostSession.steerChild (packages/shell/src/host-session.ts
#      :1323) — and the rejection toast ("steer rejected — …", subagents-tab
#      :141) does not paint either (same family as the 68-resume toast
#      paint gate). No e2e scenario asserts toast rendering today, so (2)
#      is unverifiable from the harness alone.
# Either way the steer text never reaches the child: these assertions stay
# red until the submit→steerChild→delivery chain is fixed product-side.
if wait_pane 'success echo "steered looper" appears' 10 'steered .*[Ll]ooper'; then
  :
else
  bad 'no "steered looper" echo after submitting the steer; pane tail:'
  capture | tail -12 | sed 's/^/    | /'
fi

# --- tool evidence: the steer text reached the child's LLM request ----------
STEER_UP=0
for _ in $(seq 1 60); do
  if grep -q 'steer-marker=E2E_STEER_70' "$MOCK_LOG" 2>/dev/null; then
    STEER_UP=1
    break
  fi
  sleep 1
done
if (( STEER_UP == 1 )); then
  ok 'steer injection evidence: the steer text reached the child request stream (mock steer-marker logged)'
else
  bad 'the steer text never reached the child request stream within 60s (no steer-marker line); mock log tail:'
  tail -6 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
fi

# The child persona ignores the steer and keeps looping (steer is advisory
# for the fixture) — its liveness bounds the injection wait and is itself
# evidence the steer path did not settle/kill the child.
sleep 3
LOOPS="$(grep -c 'phase=hs-loop' "$MOCK_LOG" 2>/dev/null || true)"
if [ "${LOOPS:-0}" -ge 2 ]; then
  ok "the steered child is still looping (${LOOPS} hs-loop rounds — the injection did not settle it)"
else
  warn "the child stopped looping after the steer (${LOOPS} rounds) — the steer may have ended it"
fi

kill_tui
summary
