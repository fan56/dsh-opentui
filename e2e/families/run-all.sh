#!/usr/bin/env bash
# 024 unified E2E — master family runner (delivery plan §四).
#
# Replaces the per-slice proof scramble with ONE test-layer investment. The
# pack gate is the outermost, always-on family; the capability/handshake/
# session/exit/keymap families run beneath it; the gate family reuses
# scripts/real-client-gate.sh. "verify70" is a historical SCRIPT NAME, not an
# item count — counts below are read from the run's own agents-mount summary,
# and are reported as unavailable when that summary was not produced.
#
#   bash e2e/families/run-all.sh [--out DIR] [--skip-container]
#
# Exit 0 only when every enabled family is green. Each family is independent:
# a failure is recorded and the runner continues, then fails at the end.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="/tmp/e2e-unified-$(date -u +%Y%m%dT%H%M%SZ)"
SKIP_CONTAINER=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --skip-container) SKIP_CONTAINER=1; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
mkdir -p "$OUT"
RUNLOG="$OUT/unified.log"
: > "$RUNLOG"
log() { printf '%s\n' "$*" | tee -a "$RUNLOG"; }
FAILED=0
run_family() {
  local name="$1" script="$2"
  local fout="$OUT/$name"
  mkdir -p "$fout"
  log "=== family: $name ==="
  if bash "$script" "$fout" >>"$RUNLOG" 2>&1; then
    log "FAMILY $name PASS"
  else
    log "FAMILY $name FAIL (see $fout)"
    FAILED=$((FAILED + 1))
  fi
}

log "=== 024 unified E2E start $(date -u +%FT%TZ) ==="
log "head: $(git -C "$REPO" rev-parse HEAD)"

# Outermost, always-on pack gate.
run_family pack "$REPO/e2e/families/00-pack-gate.sh"

# CapIR capability domains + handshake/degrade + multi-session isolation + push.
run_family capdomains "$REPO/e2e/families/10-capability-domains.sh"

# Capability-domain families (generated-chain method roundtrips), with the
# E3 default-model env exemption bounded in 20-model-domain.sh.
run_family model-domain "$REPO/e2e/families/20-model-domain.sh"
run_family account-credentials-domain "$REPO/e2e/families/30-account-credentials-domain.sh"

# Exit-code family.
run_family exit-code "$REPO/e2e/families/40-exit-code.sh"

# Keymap/modality family (FocusRouter layer).
run_family keymap-modality "$REPO/e2e/families/80-keymap-modality.sh"

# Verify gate family — real-client-gate.sh reuse. Report ONLY the count the
# gate's own agents-mount log actually printed; never hardcode 64/70/8 here.
V70_SUMMARY="$OUT/verify-gate/verify70.log"
v70_counts() {
  local line
  line="$(grep -E 'agents-mount: [0-9]+/[0-9]+ checks passed' "$V70_SUMMARY" 2>/dev/null | tail -1)"
  [ -n "$line" ] || return 0
  line="${line#agents-mount: }"
  printf '%s' "${line%% checks passed*}"
}
mkdir -p "$OUT/verify-gate"
log "=== family: verify-gate (real-client-gate.sh reuse) ==="
if ( cd "$REPO" && scripts/real-client-gate.sh --out "$OUT/verify-gate" ) >"$OUT/verify-gate/unified-invoke.log" 2>&1; then
  V70_COUNT="$(v70_counts)"
  if [ -n "$V70_COUNT" ]; then
    log "FAMILY verify-gate PASS (agents-mount summary: $V70_COUNT checks passed)"
  else
    log "FAMILY verify-gate PASS (count unavailable: no agents-mount summary in $V70_SUMMARY; no count claimed)"
  fi
else
  V70_COUNT="$(v70_counts)"
  if [ -n "$V70_COUNT" ]; then
    log "FAMILY verify-gate FAIL (agents-mount summary: $V70_COUNT; see $OUT/verify-gate)"
  else
    log "FAMILY verify-gate FAIL (see $OUT/verify-gate; no count summary available)"
  fi
  FAILED=$((FAILED+1))
fi

# Container family — RETIRED in 025-w3-2 (the old e2e/scenarios/ podman layer).
# The 21 legacy scenarios were offlined under the A.5 ruling: every still-valid
# assertion was shown taken over by the host families / verify70 / unit tests /
# the CI pack-cold-start gate before deletion. First-hand evidence:
#   .proof/025-w3-2/01-legacy-retirement/takeover-table.md (21 rows, STOP=0)
#   docs/adr/0013-legacy-container-e2e-retirement.md
# This slot is deliberately NOT RUN — NOT RUN is NOT a pass, and the family is
# NOT counted as green. --skip-container is kept as a no-op for caller compat.
if [ "$SKIP_CONTAINER" -eq 0 ]; then
  log "FAMILY container RETIRED (025-w3-2: legacy scenarios offlined, coverage taken over by families/verify70/unit/CI) — NOT RUN, not counted as PASS"
fi

log "=== unified verdict: FAILED_FAMILIES=$FAILED ==="
if [ "$FAILED" -ne 0 ]; then log "E2E UNIFIED: FAIL"; exit 1; fi
log "E2E UNIFIED: PASS"
exit 0
