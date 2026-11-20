#!/usr/bin/env bash
# 024 unified E2E — CapIR capability-domain family driver.
#
# Drives the real in-process bridge over NDJSON to cover the wired capability
# domains in one provisioned scratch home:
#   handshake(±)/degrade · session · sessionId isolation · push/event · model
# All assertions are numeric JSON/.ans (no PNG, no visual model) and all
# windows derive from E2E_TICK + bounded polls (see lib/family-lib.sh).
#
#   bash e2e/families/10-capability-domains.sh [outDir]
source "$(dirname "$0")/lib/family-lib.sh"

OUT="${1:-/tmp/e2e-family-capdomains}"
mkdir -p "$OUT"
SCRATCH="$(make_scratch_home)" || { ffail "capdomains: scratch provision"; family_summary; exit 1; }
cleanup() { rm -rf "$SCRATCH" 2>/dev/null || true; }
trap cleanup EXIT

DSH_HOME="$SCRATCH" node "$REPO/e2e/families/lib/bridge-families.mjs" "$OUT" > "$OUT/bridge-families.stdout.log" 2>&1
RC=$?
cat "$OUT/bridge-families.stdout.log"
if [ "$RC" -eq 0 ]; then
  fpass "capdomains: bridge-families all green (8/8 handshake/session/isolation/push/model)"
else
  ffail "capdomains: bridge-families rc=$RC (see $OUT/bridge-families.stdout.log)"
fi
family_summary
