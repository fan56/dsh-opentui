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
#   4. All state lives in a FRESH scratch DSH_HOME provisioned by the real
#      in-process provisioner; ~/.dsh is never read or written.
#   5. Frames are numeric `tmux capture-pane -e -p` (.ans) — no PNG, no visual
#      model.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LAUNCHER="$REPO/dsh-opentui"
PROVISIONER="$REPO/packages/shell/scripts/provision-inproc-profile.mjs"

# Single source of truth for every wall-clock budget (seconds unless noted).
E2E_TICK="${E2E_TICK:-1}"                 # poll cadence
E2E_BOOT_TICKS="${E2E_BOOT_TICKS:-90}"    # composer paint budget
E2E_EXIT_TICKS="${E2E_EXIT_TICKS:-20}"    # clean-quit exit budget

FAMILY_PASS=0
FAMILY_FAIL=0
fpass() { FAMILY_PASS=$((FAMILY_PASS + 1)); printf 'PASS %s\n' "$*"; }
ffail() { FAMILY_FAIL=$((FAMILY_FAIL + 1)); printf 'FAIL %s\n' "$*"; }

# Provision a fresh scratch home with the S6 real-directory-copy recipe.
# No reads from or writes to ~/.dsh.
make_scratch_home() {
  local h
  h="$(mktemp -d "${TMPDIR:-/tmp}/e2e-family-home-XXXXXX")"
  chmod 700 "$h"
  mkdir -p "$h/profiles"
  DSH_HOME="$h" node "$PROVISIONER" --repair >"$h/provision.log" 2>&1 || { printf '%s\n' "$h"; return 1; }
  grep -q '^dsh-opentui(inproc): PASS' "$h/provision.log" || { printf '%s\n' "$h"; return 1; }
  printf '%s\n' "$h"
}

# Provision a fresh scratch home for the cap-smoke verify-* runners
# (verify-s1-model.mjs / verify-s2-credentials.mjs). Those runners repoint a
# BRIDGE SYMLINK under the active profile (DEFAULT_PROFILE, today
# opentui-monday) at dist/bridge, boot the REAL dsh host with
# DSH_OPENTUI_CAP_SMOKE=1, then restore the link. The modern provisioner
# materializes a REAL DIRECTORY at that path, so after provisioning we replace
# it with a symlink to the shipped bundle — the exact shape the runners expect.
# Every call builds its own isolated home: the legacy shared
# /private/tmp/dsh-probe-home-024 is never read or rewritten, and HOME is
# redirected so ~/.dsh is never touched. Prints the home path on success.
make_cap_smoke_home() {
  local h profile
  h="$(mktemp -d "${TMPDIR:-/tmp}/e2e-capsmoke-home-XXXXXX")" || return 1
  chmod 700 "$h"
  mkdir -p "$h/profiles"
  DSH_HOME="$h" HOME="$h" DSH_OPENTUI_COMPANION_LATEST=off node "$PROVISIONER" --repair >"$h/provision.log" 2>&1 || { printf '%s\n' "$h"; return 1; }
  grep -q '^dsh-opentui(inproc): PASS' "$h/provision.log" || { printf '%s\n' "$h"; return 1; }
  profile="$(node -e 'import(process.argv[1]).then((m) => process.stdout.write(m.DEFAULT_PROFILE))' "$REPO/packages/shell/scripts/lib/profile-name.mjs")"
  [ -n "$profile" ] || { printf '%s\n' "$h"; return 1; }
  DSH_HOME="$h" PROFILE="$profile" BUNDLE="$REPO/packages/shell/dist/bridge" node -e '
    const { lstatSync, rmSync, symlinkSync } = require("node:fs")
    const link = `${process.env.DSH_HOME}/profiles/${process.env.PROFILE}/node_modules/@aiwayds/dsh-opentui-bridge`
    const st = lstatSync(link)
    if (st.isSymbolicLink()) process.exit(0)
    rmSync(link, { recursive: true, force: true })
    symlinkSync(process.env.BUNDLE, link)
  ' >"$h/bridge-link.log" 2>&1 || { printf '%s\n' "$h"; return 1; }
  printf '%s\n' "$h"
}

family_summary() {
  printf 'summary: PASS=%d/%d\n' "$FAMILY_PASS" $((FAMILY_PASS + FAMILY_FAIL))
  [ "$FAMILY_FAIL" -eq 0 ]
}
