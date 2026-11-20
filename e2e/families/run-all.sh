#!/usr/bin/env bash
# 024 unified E2E — master family runner (delivery plan §四).
#
# Replaces the per-slice proof scramble with ONE test-layer investment. The
# pack gate is the outermost, always-on family; the capability/handshake/
# session/exit/keymap families run beneath it; verify70 (64 items, the accurate
# count) is the gate family via scripts/real-client-gate.sh reuse.
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

# verify70 gate family — real-client-gate.sh reuse. The accurate count is
# 64/64 (the "70" in that script's banner is stale 0.23 text, not a count).
mkdir -p "$OUT/verify-gate"
log "=== family: verify-gate (real-client-gate.sh reuse) ==="
if ( cd "$REPO" && scripts/real-client-gate.sh --out "$OUT/verify-gate" ) >"$OUT/verify-gate/unified-invoke.log" 2>&1; then
  log "FAMILY verify-gate PASS (64/64)"
else
  log "FAMILY verify-gate FAIL (see $OUT/verify-gate)"; FAILED=$((FAILED+1))
fi

# Container family — only when the podman VM is runnable; otherwise recorded
# as BLOCKED (not faked). The canonical path bakes source into the image and
# does NOT mount the worktree (E2E_SCENARIOS selects a subset; VM 5CPU/2GiB
# concurrency <= 2).
if [ "$SKIP_CONTAINER" -eq 0 ]; then
  if command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; then
    log "=== family: container (podman) ==="
    E2E_SCENARIOS="${E2E_SCENARIOS:-20-start 30-commands}" "$REPO/e2e/run-e2e.sh" >"$OUT/container.log" 2>&1 \
      && log "FAMILY container PASS" || { log "FAMILY container FAIL (see $OUT/container.log)"; FAILED=$((FAILED+1)); }
  else
    log "FAMILY container BLOCKED (podman VM not runnable) — recorded, not faked"
  fi
fi

log "=== unified verdict: FAILED_FAMILIES=$FAILED ==="
if [ "$FAILED" -ne 0 ]; then log "E2E UNIFIED: FAIL"; exit 1; fi
log "E2E UNIFIED: PASS"
exit 0
