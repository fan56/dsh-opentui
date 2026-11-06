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
#   "spin-detected early" marker strings) and (b) the verdict feed wired
#   from the dispatch chain into HostSession.noteChildSpinVerdict. The image
#   this batch runs against predates both (ff4ae5c baked the jev CHAIN, not
#   the spin consumption), so the gate below greps the installed dist-host:
#   gate dark -> G2/G3 are skipped-by-gate and only G1 runs (it must pass);
#   gate lit -> G2/G3 are hard-asserted. G3 additionally rides the client
#   bundle (the F6 markers render client-side — the plugin-face container
#   cannot reach them, same cause as 62's original UI-marker skip), so even
#   gate-lit it stays a best-effort pane grep.
#
# FINDING (2026-11-07 container run against the ff4ae5c image): G1 is ALSO
# dark — mock-jev records ZERO dispatches even with TYPESAFE_API_KEY and
# JEV_ENDPOINT set and keyword-bearing turns served ("run", "check" hit
# DEFAULT_AUTO_KEYWORDS). The trigger chain is structurally present
# (dsh-agent-loop emits the agent/pre-step waterfall the dispatch plugin
# listens on) but the classify call never leaves the process. Until that is
# diagnosed (plugin apply / bundle-patch insertion on this host wave), G1
# FAILS honestly here — the assertion stays hard so the fix turns it green.
#
# Container-only: mutates ~/.dsh/agents + the profile patch.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'jev attention: spin-detected early hard stop (mock-jev verdict trail)'

if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (mutates ~/.dsh/agents and the profile patch; container only)'
  summary
  exit 0
fi

if ! grep -qF '127.0.0.1:8642' "$HOME/.dsh/profiles/dsh-opentui/cordis.patch.yml" 2>/dev/null; then
  warn 'profile patch has no mock endpoint (bake step missing) — skipping'
  summary
  exit 0
fi

# --- the jev chain gate: the baked dispatch plugin must be present ----------
if grep -qF '@aiwayds/dsh-agent-dispatch' "$HOME/.dsh/profiles/dsh-opentui/package.json" 2>/dev/null \
  && grep -qF 'dsh-agent-dispatch' "$HOME/.dsh/profiles/dsh-opentui/cordis.patch.yml" 2>/dev/null; then
  ok 'jev chain baked (dsh-agent-dispatch + JEV_ENDPOINT route present)'
else
  warn 'dsh-agent-dispatch not in the profile (bake-jev-chain step missing) — skipping'
  summary
  exit 0
fi

# --- the registry plugin (use_agent's home) — probe, 62 installs it ---------
# Only REQUIRED for the gate-lit looper run; the probe records availability.
REGISTRY_UP=0
if grep -qF '@aiwayds/dsh-subagent-registry' <(dsh plugin --profile dsh-opentui list 2>/dev/null); then
  REGISTRY_UP=1
  ok 'registry plugin bundled (use_agent available)'
else
  warn 'registry plugin not bundled (scenario 62 must run first) — the gate-lit looper run will be skipped'
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

# --- the DEPENDENCY GATE: does the installed dist-host carry spin detection?
SPIN_GATE=0
BUNDLED_INDEX="/usr/local/lib/node_modules/@aiwayds/dsh-opentui/dist-host/index.js"
if grep -qF 'spin-detected early' "$BUNDLED_INDEX" 2>/dev/null; then
  SPIN_GATE=1
  ok 'dependency gate LIT: dist-host carries the spin detection'
else
  warn 'dependency gate DARK: dist-host predates the spin detection (rebuild pending) — G2/G3 skipped-by-gate, G1 (jev dispatch trail) still asserted'
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
send 'E2E_JA_PING2: dispatch a summary of the current session state.'
sleep 1
send Enter
wait_pane 'keyword turn two completes (jev dispatch two fired)' 45 'no scripted behavior' || true

CALLS="$(grep -c '"call":' "$JEV_LOG" 2>/dev/null || true)"
CALLS="${CALLS:-0}"
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
  AGENTS_DIR="$HOME/.dsh/agents"
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
  SETTINGS="$HOME/.dsh/profiles/dsh-opentui/cordis.patch.yml"
  cat > /tmp/stage-ja-limits.mjs <<'EOF'
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
row.config.maxRounds = 60
row.config.maxRoundsGrace = 7
writeFileSync(patchPath, stringify(doc), 'utf8')
console.log(`staged insert entry dsh-opentui maxRounds=60 maxRoundsGrace=7 -> ${patchPath}`)
EOF
  node /tmp/stage-ja-limits.mjs "$SETTINGS" >/tmp/stage-ja-limits.log 2>&1
  # Duplicate-ns shadowing guard (62 finding): stage the same limits onto
  # the bundled plugin.patch.yml entry so whichever settings row wins carries
  # them.
  BUNDLED_PATCH="/usr/local/lib/node_modules/@aiwayds/dsh-opentui/dist-host/plugin.patch.yml"
  [ -f "$BUNDLED_PATCH" ] && node /tmp/stage-ja-limits.mjs "$BUNDLED_PATCH" >>/tmp/stage-ja-limits.log 2>&1
  if grep -q 'maxRounds: 60' "$SETTINGS" && grep -q 'maxRoundsGrace: 7' "$SETTINGS"; then
    ok 'policy limits staged: maxRounds 60 + grace 7 (classic stop would be round 67)'
  else
    bad 'failed to stage the dsh-opentui policy limits; tail:'
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
    bad 'G2: E2E-HS-LADDER-DONE never landed — the early stop did not fire or its result never surfaced; mock tails:'
    tail -6 "$MOCK_LOG" 2>/dev/null | sed 's/^/    | /'
  fi

  # G3 (best-effort — the F6-grade markers render in the client bundle, the
  # plugin-face container cannot reach them; 62-parity).
  PANE="$(capture)"
  if printf '%s' "$PANE" | grep -qF '⏻!'; then
    ok 'G3: picker row carries the early marker ⏻!'
  else
    bad 'G3: picker row lacks ⏻! (client-face marker unreachable in the container plugin face — known 62-parity gap); pane tail:'
    printf '%s\n' "$PANE" | tail -12 | sed 's/^/    | /'
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
    bad "G2: round bound violated — ${LOOPS} hs-loop rounds (> cap 60; the child ran to the classic 67-stop, the spin legs never fired)"
  else
    bad "G2: the looper child never looped (${LOOPS:-0} hs-loop rounds) — the dispatch itself failed"
  fi
else
  warn 'G2/G3 skipped-by-gate: dist-host lacks spin detection or the registry plugin is absent — the early-stop assertions need the dist-host rebuild with subagent-policy spin detection + the noteChildSpinVerdict feed wired'
fi

kill_tui
summary
