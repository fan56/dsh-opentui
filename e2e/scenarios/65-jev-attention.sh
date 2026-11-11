#!/usr/bin/env bash
# Scenario 65 — jev attention: spin-detected early hard stop (ported from
# dsh-tui-pi e2e/scenarios/76-attention-early-stop.sh).
#
# Reference shape (76): the attention layer probes the local mock System One
# server (lib/mock-jev.mjs, every noul question answered 0.95 — comfortably
# past the spinning high-segment line 0.75). Consecutive spinning verdicts
# arm the maxRounds ladder's TIGHTEN-ONLY legs long before the cap: two
# strikes pull the wrap-up forward past the rounds floor max(10, cap/3), and
# a FRESH strike that postdates the delivered wrap-up force-stops the child
# on the next counted round — grace never eaten. The cap is 60 (classic stop
# at 67) so an early stop proves itself by its ROUND BOUND (at/below the
# cap), and the picker/viewer carry the `⏻!` / "spin-detected early" markers
# instead of the classic `⏻`.
#
# ASSERTION GROUPS (aligned with 76):
#   G1  the jev verdict trail exists: mock-jev saw >= 2 dispatches —
#       RUNNABLE NOW. The dsh-agent-dispatch chain baked by
#       e2e/lib/bake-jev-chain.mjs reads JEV_ENDPOINT in mode auto: a parent
#       turn whose text hits a task keyword fires one jev call, so two
#       keyword turns prove the consumption chain end to end.
#   G2  the early stop happened: the looper child's round bound sits
#       at/below the cap (the classic ladder would run 60 + 7 = 67 rounds).
#   G3  marker evidence: the picker row carries `⏻!` / "spin-detected early"
#       (and `⚡ injected` — the early wrap-up ran).
#
# DEPENDENCY GATE (63 model — head-documented, run what can run):
#   G2/G3 need BOTH (a) a dist-host build that carries the spin detection
#   (packages/shell/src/subagent-policy.ts spinDecision + the
#   "spin-detected early" marker strings) and (b) the verdict feed wired on
#   the client face (RemoteSubagentPanel's spin attention source feeding
#   noteSpinVerdict). The image
#   this batch runs against predates both (ff4ae5c baked the jev CHAIN, not
#   the spin consumption), so the gate below greps the installed dist-host:
#   gate dark -> G2/G3 are skipped-by-gate and only G1 runs (it must pass);
#   gate lit -> G2/G3 are hard-asserted. G3 additionally rides the client
#   bundle (the F6 markers render client-side — the plugin-face container
#   cannot reach them, same cause as 62's original UI-marker skip), so even
#   gate-lit it stays a best-effort pane grep.
#
#   GATE-LIT CAVEAT (2026-11-07, RESOLVED 2026-11-11): the gate used to grep
#   only for the spin STRINGS while the spin feed leg (b) had no caller —
#   HostSession.noteChildSpinVerdict was removed with the plugin face
#   (ADR-0005 client-mode-only), so no jev verdict could reach the ladder.
#   The feed is now wired on the CLIENT face: RemoteSubagentPanel constructs
#   the spin attention source (tick driven from the live round fold,
#   noteSpinVerdict the verdict sink) and the capability gate below matches
#   that construction. The feed stays silent without a configured jev
#   endpoint (unconfigured == off, dispatch parity) and is hot-off via the
#   settings ns `dsh-opentui` `spinAttention: false` knob.
#
# FINDING, RESOLVED (2026-11-07 container diagnosis against the ff4ae5c-era
# image): the earlier "G1 dark: 0 dispatches" had TWO stacked causes, both
# harness-side, neither in the product chain.
#
#   1. The batch that saw 0 dispatches ran 65 via an E2E_SCENARIOS override,
#      so 62 (the only scenario that installs the registry plugin and seeds
#      ~/.dsh/agents) never ran in that container. The dispatch plugin's
#      capability gate (dsh-agent-dispatch lib/capabilities.js) needs ALL of
#      use_agent visible + the subagent provider registered + a non-empty
#      roster, and under mode auto a capability-gap turn returns SILENTLY —
#      no jev call, no verdict row, by design. Verified: with the registry
#      absent, 65 standalone reproduces 0 dispatches; `dsh plugin add` of the
#      registry (which also seeds oldfox/rubber-duck/workhorse.md) makes the
#      same turns fire. Scenario 65 now installs the registry itself
#      (62's recipe) so G1 does not depend on execution order.
#   2. Even with the registry up, the old G1 turn two ("dispatch a summary
#      ...") is a keyword-gate MISS: "dispatch" is NOT in the plugin's
#      DEFAULT_AUTO_KEYWORDS and the gate wants "summarize", not "summary"
#      (verified against lib/rubric.js findKeyword). Turn two now carries
#      "check", a listed keyword.
#
# Container-only: mutates ~/.dsh/agents + the profile config.json (the
# maxRounds staging); the patch layer is only written by the common.sh bake.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'jev attention: spin-detected early hard stop (mock-jev verdict trail)'

if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (mutates ~/.dsh/agents and the profile config.json; container only)'
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

# --- the jev chain gate: the baked dispatch plugin must be present ----------
if grep -qF '@aiwayds/dsh-agent-dispatch' "$FACE_HOME/profiles/$FACE_PROFILE/package.json" 2>/dev/null \
  && grep -qF 'dsh-agent-dispatch' "$FACE_PATCH" 2>/dev/null; then
  ok 'jev chain baked (dsh-agent-dispatch + JEV_ENDPOINT route present)'
else
  warn 'dsh-agent-dispatch not in the profile (bake-jev-chain step missing) — skipping'
  summary
  exit 0
fi

# --- capability gate: the spin-verdict feed --------------------------------
# G2 asserts the EARLY hard stop driven by a JEV spin verdict. The product
# half of that feed is wired on the CLIENT face: RemoteSubagentPanel
# constructs the spin attention source and drives tick() from the live
# round fold (packages/shell/src/client/remote-subagents.ts), with
# noteSpinVerdict as the verdict sink into the round policy's streak trail.
# The gate matches the CONSTRUCTION shape `createSpinAttentionSource(` in
# packages/shell/src EXCLUDING the defining module (spin-attention.ts's own
# export line would light the gate with zero callers); the test/ suite
# lives outside src, so a test-only construction cannot pass it. Gate dark
# still means the feed is absent — skip with THAT reason, the honest gap,
# instead of asserting a behavior the product does not have.
if ! grep -rq --exclude=spin-attention.ts 'createSpinAttentionSource(' /src/packages/shell/src 2>/dev/null; then
  warn 'jev spin-verdict feed not wired (no spin attention source construction in packages/shell/src outside its defining module) — the early hard stop is not observable; skipping'
  summary
  exit 0
fi

# --- the registry plugin (use_agent's home) — install if missing -------------
# NOT probe-only anymore: the dispatch plugin's capability gate refuses an
# auto keyword turn SILENTLY (no jev call, no verdict row) unless use_agent
# is visible + the provider registered + the roster non-empty, so G1 is dark
# whenever 62 has not run in this container (any E2E_SCENARIOS subset that
# skips 62). Same recipe as 62: `dsh plugin add` does NOT auto-bundle
# dependencies, so the registry must land as a real bundle member; its
# install also seeds ~/.dsh/agents (oldfox/rubber-duck/workhorse), which is
# what empties the roster leg. Pinned 0.19.0 (the release the reference ran
# against the 0.2.2-rc.1 host wave; 0.18.0 dies at load on this wave).
REGISTRY_UP=0
if grep -qF '@aiwayds/dsh-subagent-registry' "$FACE_HOME/profiles/$FACE_PROFILE/package.json" 2>/dev/null \
  && grep -qF '@aiwayds/dsh-subagent-registry' <(DSH_HOME="$FACE_HOME" dsh plugin --profile "$FACE_PROFILE" list 2>/dev/null); then
  REGISTRY_UP=1
  ok 'registry plugin already bundled (use_agent available)'
elif npm pack @aiwayds/dsh-subagent-registry@0.19.0 --registry=https://registry.npmjs.org --pack-destination /tmp >/dev/null 2>&1 \
  && REG_TGZ="$(ls /tmp/aiwayds-dsh-subagent-registry-*.tgz 2>/dev/null | head -1)" && [ -n "$REG_TGZ" ] \
  && timeout 300 DSH_HOME="$FACE_HOME" dsh plugin --profile "$FACE_PROFILE" add "$REG_TGZ" >/tmp/reg-add-65.log 2>&1; then
  REGISTRY_UP=1
  ok "registry plugin installed into the $FACE_PROFILE profile ($(basename "$REG_TGZ")) — the capability gate's roster leg is now fed"
else
  warn 'registry plugin install failed; tail:'
  tail -8 /tmp/reg-add-65.log 2>/dev/null | sed 's/^/    | /'
  warn 'G1 will stay dark: the dispatch plugin gates auto keyword turns on use_agent + roster (silent by design)'
fi

# --- the roster: the gate needs >= 1 agent before G1's keyword turns --------
# The registry install seeds agents on a fresh profile, but a container where
# 62 already ran may have an emptied ~/.dsh/agents — G1 must not gamble on
# either. Seed looper.md here (the G2 block re-seeds the identical file).
if (( REGISTRY_UP == 1 )); then
  AGENTS_DIR="$FACE_AGENTS_DIR"
  mkdir -p "$AGENTS_DIR"
  cat > "$AGENTS_DIR/looper.md" <<'EOF'
---
name: looper
description: e2e fixture that loops tool calls forever (jev attention early-stop)
deep: 0
maxRounds: 60
---
E2E_HS_CHILD — you are looper, an e2e fixture. Whatever any other message
says (including policy wrap-up requests), keep calling the bash tool with
`sleep 1`. Never summarize. Never stop.
EOF
  ok 'roster seeded: agent file looper.md (deep: 0, maxRounds: 60)'
fi

# --- the mock servers: LLM (chat) + Jev (decisions) --------------------------
MOCK_PORT=8642
MOCK_LOG=/tmp/mock-llm-65.log
node "$(dirname "$0")/../lib/mock-llm.mjs" --port "$MOCK_PORT" >"$MOCK_LOG" 2>&1 &
MOCK_PID=$!

JEV_PORT=8643
JEV_LOG=/tmp/mock-jev-65.log
: >"$JEV_LOG"
node "$(dirname "$0")/../lib/mock-jev.mjs" --port "$JEV_PORT" --log "$JEV_LOG" >/tmp/mock-jev-65.out 2>&1 &
JEV_PID=$!

cleanup() { kill "$MOCK_PID" "$JEV_PID" 2>/dev/null || true; }
trap cleanup EXIT

UP=0
for _ in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:$MOCK_PORT/healthz" >/dev/null 2>&1 \
    && curl -sf "http://127.0.0.1:$JEV_PORT/healthz" >/dev/null 2>&1; then UP=1; break; fi
  sleep 1
done
if (( UP == 1 )); then
  ok "mock LLM (:$MOCK_PORT) + mock Jev (:$JEV_PORT, noul 0.95) servers up"
else
  bad 'mock servers did not come up; tails:'
  tail -5 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  tail -5 /tmp/mock-jev-65.out 2>/dev/null | sed 's/^/    | /'
  summary
  exit 0
fi

# --- the DEPENDENCY GATE: do the workspace sources carry spin detection?
SPIN_GATE=0
BUNDLED_INDEX="/src/packages/tui-base/src"
if grep -rqF 'spin-detected early' "$BUNDLED_INDEX" 2>/dev/null; then
  SPIN_GATE=1
  ok 'dependency gate LIT: the workspace sources carry the spin detection'
else
  warn 'dependency gate DARK: sources predate the spin detection — G2/G3 skipped-by-gate, G1 (jev dispatch trail) still asserted'
fi

# --- restart the TUI with the jev layer pointed at the mock ------------------
if tui_alive; then
  quit_tui 'TUI quit for the restart' || true
fi
kill_tui
start_tui "JEV_ENDPOINT=http://127.0.0.1:$JEV_PORT/v1/systemone TYPESAFE_API_KEY=e2e-fake-key"
wait_tui_up 120 || { summary; exit 0; }
ensure_editor_ready 'editor clean before the attention run' || true

# --- G1: the jev verdict trail (must hold on ANY gate state) -----------------
# The mode-auto keyword gate fires ONE jev call per keyword-bearing parent
# turn, so two plain keyword turns (fast mock replies, no looper) build the
# 2-dispatch trail. This group is the batch's pre-verifiable part: it does
# not depend on the spin detection landing in dist-host.
send 'E2E_JA_PING1: run a quick board check and summarize.'
sleep 1
send Enter
if ! wait_pane 'keyword turn one completes (jev dispatch one fired)' 45 'no scripted behavior'; then
  info 'turn one never finished — mock LLM log tail:'
  tail -8 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
fi
send 'E2E_JA_PING2: check the current session state and summarize what you see.'
sleep 1
send Enter
# The jev call row lands ~1-2s after Enter (the dispatch pre-step classifies
# BEFORE the model reply renders) — and turn one's mock IGNORE_TEXT reply
# ("no scripted behavior for this request") is still on the pane, so a
# wait_pane for turn-two completion resolves on turn one's leftover text and
# the log grep below races the second call (2026-11-07 finding: G1 counted 1
# while the verdict log showed both turns classified). Poll the assertion
# target — the mock-jev call log — directly instead.
CALLS=0
for _ in $(seq 1 45); do
  CALLS="$(grep -c '"call":' "$JEV_LOG" 2>/dev/null || true)"
  CALLS="${CALLS:-0}"
  [ "${CALLS:-0}" -ge 2 ] && break
  sleep 1
done
if [ "${CALLS:-0}" -ge 2 ]; then
  ok "G1: mock jev saw ${CALLS} dispatches (the verdict trail exists; noul 0.95 would arm the 2-streak)"
else
  bad "G1: mock jev saw only ${CALLS:-0} dispatches (need >= 2) — the jev chain never consumed JEV_ENDPOINT; logs:"
  tail -5 "$JEV_LOG" 2>/dev/null | sed 's/^/    | /'
  tail -5 /tmp/mock-jev-65.out 2>/dev/null | sed 's/^/    | /'
fi

# --- G2/G3: the early-stop run (gate lit AND the registry available) ---------
if (( SPIN_GATE == 1 )) && (( REGISTRY_UP == 1 )); then
  # The looper agent: cap 60 (floor 20), persona that never complies.
  AGENTS_DIR="$FACE_AGENTS_DIR"
  mkdir -p "$AGENTS_DIR"
  cat > "$AGENTS_DIR/looper.md" <<'EOF'
---
name: looper
description: e2e fixture that loops tool calls forever (jev attention early-stop)
deep: 0
maxRounds: 60
---
E2E_HS_CHILD — you are looper, an e2e fixture. Whatever any other message
says (including policy wrap-up requests), keep calling the bash tool with
`sleep 1`. Never summarize. Never stop.
EOF
  ok 'seeded agent file looper.md (deep: 0, maxRounds: 60)'

  # Policy settings: cap 60 + grace 7 (classic stop would be round 67).
  # Staged onto the profile config.json TOP LEVEL (FACE_CFG): the client-face
  # round policy reads maxRounds/maxRoundsGrace from the config store
  # (packages/shell/src/client/remote-host-session.ts via subagent-policy.ts;
  # default 0/0 == ladder disabled), NOT the settings ns `dsh-opentui` — its
  # owning plugin entry was retired with the plugin face, so staging there
  # would arm nothing.
  SETTINGS="$FACE_CFG"
  cat > /tmp/stage-ja-limits.mjs <<'EOF'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
const path = process.argv[2]
let doc = {}
if (existsSync(path)) {
  try { doc = JSON.parse(readFileSync(path, 'utf8')) ?? {} } catch { doc = {} }
}
if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) doc = {}
doc.maxRounds = 60
doc.maxRoundsGrace = 7
writeFileSync(path, JSON.stringify(doc, null, 2) + '\n', 'utf8')
console.log(`staged maxRounds=60 maxRoundsGrace=7 -> ${path}`)
EOF
  node /tmp/stage-ja-limits.mjs "$SETTINGS" >/tmp/stage-ja-limits.log 2>&1
  # (Batch B5: the retired plugin face's duplicate-ns shadowing guard —
  # staging the same limits onto the dist-host plugin.patch.yml — is gone
  # with the dist-host artifact; the client face reads ONE source, the
  # profile config.json top level staged above.)
  if grep -q '"maxRounds": 60' "$SETTINGS" && grep -q '"maxRoundsGrace": 7' "$SETTINGS"; then
    ok 'policy limits staged: config.json maxRounds 60 + grace 7 (classic stop would be round 67)'
  else
    bad 'failed to stage the config.json policy limits; tail:'
    tail -6 /tmp/stage-ja-limits.log 2>/dev/null | sed 's/^/    | /'
  fi

  # Restart so the limits (and the spin-detecting dist-host) load.
  kill_tui
  start_tui "JEV_ENDPOINT=http://127.0.0.1:$JEV_PORT/v1/systemone TYPESAFE_API_KEY=e2e-fake-key"
  wait_tui_up 120 || { summary; exit 0; }
  ensure_editor_ready 'editor clean before the looper run' || true

  send 'E2E_HS_PARENT: dispatch the looper agent now via use_agent. When its result returns, stop.'
  sleep 1
  send Enter
  info 'looper dispatched (cap 60 + grace 7; the early stop must land at/below round 60)'

  # G2: the stop surfaced to the caller. The early timeline (2-strike arm ->
  # wrap-up at the floor -> re-strike -> stop on the next counted round)
  # stays well under the classic 67-round run; budget generously.
  DONE_UP=0
  for _ in $(seq 1 180); do
    if capture | grep -qF 'E2E-HS-LADDER-DONE'; then DONE_UP=1; break; fi
    sleep 1
  done
  if (( DONE_UP == 1 )); then
    ok 'G2: E2E-HS-LADDER-DONE landed — the stop surfaced to the caller'
  else
    # No client-face gap remains: the caps are staged onto the profile
    # config.json top level, which the client-face round policy reads
    # (remote-host-session.ts), and this block only runs gate-lit (the spin
    # feed construction exists in packages/shell/src). A missing stop is a
    # product failure — hard per the header contract ("gate lit -> G2/G3 are
    # hard-asserted"). G1's jev dispatch trail above remains the consumption
    # verdict; this is the enforcement verdict.
    bad 'G2: E2E-HS-LADDER-DONE never landed — the early stop did not fire although the config.json ladder caps (60 + grace 7) are live; mock tails:'
    tail -6 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  fi

  # G3 (best-effort — the F6-grade markers render in the client bundle, the
  # plugin-face container cannot reach them; 62-parity).
  PANE="$(capture)"
  if printf '%s' "$PANE" | grep -qF '⏻!'; then
    ok 'G3: picker row carries the early marker ⏻!'
  else
    # Skip, not fail: the ⏻! marker renders in the client bundle, which the
    # plugin-face container cannot reach (62-parity caveat, batch C8
    # diagnosis). The container-reachable G2 evidence is the round bound
    # below plus the mock-jev spin dispatch trail.
    warn 'G3: picker row lacks ⏻! — skipped by design (client-face marker unreachable in the container plugin face; 62-parity caveat)'
  fi
  if printf '%s' "$PANE" | grep -qF 'spin-detected early'; then
    ok 'G3: "spin-detected early" evidence present on the pane'
  else
    warn 'G3: no "spin-detected early" text on the pane (viewer marker rides the client bundle)'
  fi

  # G2 round bound: early stop at/below the cap.
  LOOPS="$(grep -c 'phase=hs-loop' "$MOCK_LOG" 2>/dev/null || true)"
  if [ "${LOOPS:-0}" -ge 2 ] && [ "${LOOPS:-0}" -le 60 ]; then
    ok "G2: round bound held — ${LOOPS} hs-loop rounds (at/below cap 60; the classic ladder would run 67)"
  elif [ "${LOOPS:-0}" -gt 60 ]; then
    if (( DONE_UP == 1 )); then
      bad "G2: round bound violated — ${LOOPS} hs-loop rounds despite a surfaced stop"
    else
      # Same no-gap reasoning as the DONE leg above: the config.json caps are
      # live, so blowing past 60 with no surfaced stop is a genuine cap
      # failure, hard per the header contract.
      bad "G2: round bound violated — ${LOOPS} hs-loop rounds with no surfaced stop; the config.json ladder caps (60 + grace 7) are live, so the cap did not hold"
    fi
  else
    bad "G2: the looper child never looped (${LOOPS:-0} hs-loop rounds) — the dispatch itself failed"
  fi
else
  warn 'G2/G3 skipped-by-gate: dist-host lacks spin detection or the registry plugin is absent — the early-stop assertions need the dist-host rebuild with subagent-policy spin detection + the client-face spin verdict feed wired'
fi

kill_tui
summary
