#!/usr/bin/env bash
# 024 unified E2E — CapIR account/credentials capability-domain family (S2/S4/S4b).
#
# Drives the generated-chain account + credentials methods through the shipped
# bridge. Hard gates: handshake, account getState (whitelist), both streams,
# credentials DATAFLOW emission, NOT_WIRED negative, clean close.
# Explicitly NOT claimed here (registered in 024-e2e-requirements.md):
#   - full browser PKCE login (G1) — needs a logged-in account + browser callback
#   - watchExpiry first real event (C3/G2) — needs a session-expiry trigger
#   - credentials real backend DATAFLOW (C1/C5) — settings-controller not mounted
#     in this profile; the cap-smoke proves the honest NOT_WIRED path.
#
#   bash e2e/families/30-account-credentials-domain.sh [outDir]
source "$(dirname "$0")/lib/family-lib.sh"

OUT="${1:-/tmp/e2e-family-account}"
mkdir -p "$OUT"
SCRATCH="$(make_cap_smoke_home)" || { ffail "account/credentials domain: scratch provision"; family_summary; exit 1; }
cleanup() { rm -rf "$SCRATCH" 2>/dev/null || true; }
trap cleanup EXIT
# Drive the REAL dsh host against this run's own freshly provisioned scratch
# home / active profile / bridge symlink. DSH_PROBE_HOME is the runner's seam;
# the legacy shared /private/tmp/dsh-probe-home-024 is never read or rewritten.
( cd "$REPO" && HOME="$SCRATCH" DSH_PROBE_HOME="$SCRATCH" node scripts/verify-s2-credentials.mjs ) > "$OUT/cap-s2.log" 2>&1
LOG="$OUT/cap-s2.log"
FAILS="$(grep -E '^FAIL ' "$LOG" | wc -l | tr -d ' ')"
SUMMARY="$(grep '^summary:' "$LOG" | tail -1)"
if [ "$FAILS" = "0" ]; then
  fpass "account/credentials domain: all reachable checks green ($SUMMARY)"
else
  ffail "account/credentials domain: $FAILS FAIL(s) ($SUMMARY; see $LOG)"
  grep -E '^FAIL ' "$LOG" | head -10
fi
printf 'EXEMPT account/credentials: G1 full PKCE browser login, C3/G2 watchExpiry first event, C1/C5 credentials real backend DATAFLOW — environment (profile service mount / logged-in account), see 024-e2e-requirements.md\n'
family_summary
