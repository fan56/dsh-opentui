#!/usr/bin/env bash
# 024 unified E2E — shared harness for the capability-domain scenario families.
#
# Flaky law (delivery plan §四 + the recorded pitfall list):
#   1. EVERY wall-clock window is derived from ONE constant (E2E_TICK) plus a
#      bounded poll count — no scattered magic `sleep N` that drifts from the
#      readiness signal.
#   2. Readiness is polled on the actual signal (framed reply / painted input
#      box / EXIT-status file), never inferred from an elapsed timeout.
#   3. Negative cases use fault injection (unwired CapIR id, ALREADY_OPEN,
#      signal kill) — never an assertion weakened to make red go green.
#   4. All state lives in a FRESH scratch DSH_HOME; ~/.dsh is read-only seed.
#   5. Frames are numeric `tmux capture-pane -e -p` (.ans) — no PNG, no visual
#      model.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LAUNCHER="$REPO/dsh-opentui"
PROVISIONER="$REPO/packages/shell/scripts/provision-inproc-profile.mjs"
REAL_HOME="${DSH_HOME_REAL:-$HOME/.dsh}"

# Single source of truth for every wall-clock budget (seconds unless noted).
E2E_TICK="${E2E_TICK:-1}"                 # poll cadence
E2E_BOOT_TICKS="${E2E_BOOT_TICKS:-90}"    # composer paint budget
E2E_EXIT_TICKS="${E2E_EXIT_TICKS:-20}"    # clean-quit exit budget

FAMILY_PASS=0
FAMILY_FAIL=0
fpass() { FAMILY_PASS=$((FAMILY_PASS + 1)); printf 'PASS %s\n' "$*"; }
ffail() { FAMILY_FAIL=$((FAMILY_FAIL + 1)); printf 'FAIL %s\n' "$*"; }

# Provision a fresh scratch home seeded from the real home (read-only), using
# the S6 real-directory-copy recipe. No writes to ~/.dsh.
make_scratch_home() {
  local h
  h="$(mktemp -d "${TMPDIR:-/tmp}/e2e-family-home-XXXXXX")"
  chmod 700 "$h"
  mkdir -p "$h/profiles"
  cp -a "$REAL_HOME/profiles/opentui" "$h/profiles/" 2>/dev/null || true
  local rel
  for rel in .credentials.yaml models-store.json model-profiles.json settings.yaml workspace-presets.json agents themes; do
    [ -e "$REAL_HOME/$rel" ] && cp -a "$REAL_HOME/$rel" "$h/" 2>/dev/null || true
  done
  [ -d "$REAL_HOME/profiles/node_modules" ] && cp -a "$REAL_HOME/profiles/node_modules" "$h/profiles/" 2>/dev/null || true
  DSH_HOME="$h" node "$PROVISIONER" --repair >"$h/provision.log" 2>&1 || { printf '%s\n' "$h"; return 1; }
  grep -q '^dsh-opentui(inproc): PASS' "$h/provision.log" || { printf '%s\n' "$h"; return 1; }
  printf '%s\n' "$h"
}

family_summary() {
  printf 'summary: PASS=%d/%d\n' "$FAMILY_PASS" $((FAMILY_PASS + FAMILY_FAIL))
  [ "$FAMILY_FAIL" -eq 0 ]
}
