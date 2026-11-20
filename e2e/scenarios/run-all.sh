#!/usr/bin/env bash
# Master in-container runner: executes the scenarios in order (each one
# always finishes; failures are recorded, not fatal) and aggregates the
# per-scenario counters into a final verdict + exit code.
#
# v2 additions (0234-fix-design-v3.md §4):
#   - E2E_ISOLATED=1  → each scenario gets its own scratch DSH_HOME (no shared
#     profile/cookie state); the default sequential path keeps the cached
#     baked home for speed.
#   - E2E_RETRY=1     → a failed scenario is rerun once (2 attempts max), so a
#     single flaky case can be retried without a full suite pass.
#   - report.md       → A/B/C + L1/L2/L3 ledger, B-class criteria, SKIP list.
set -u
export TERM="${TERM:-xterm-256color}"
cd "$(dirname "$0")"
RESULTS_DIR="${RESULTS_DIR:-/tmp/e2e-results}"
. "$(dirname "$0")/../lib/assert-v2.sh"
. "$(dirname "$0")/../lib/report.sh"

rm -rf "$RESULTS_DIR"
mkdir -p "$RESULTS_DIR"

printf 'e2e runner: face — %s (client only since batch B5)\n' "${E2E_FACE:-client}"
printf 'e2e runner: image toolchain — %s | node %s | tmux %s\n' \
  "$(uname -m)" "$(node --version)" "$(tmux -V)"
printf 'e2e runner: profile — opentui under the scratch %s (provisioned per scenario by start_tui/ensure_client_profile)\n' \
  "${CLIENT_DSH_HOME:-/tmp/client-dsh}"
printf 'e2e runner: sizes — %s (v2 key/panel scenarios run each)\n' "${E2E_SIZES:-120x40 200x50}"

# E2E_SCENARIOS overrides the list (space-separated) so callers can scope a
# run without hand-rolling podman incantations.
E2E_SCENARIOS="${E2E_SCENARIOS:-10-install 11-upgrade 20-start 22-search 30-commands 40-mock-llm 50-resize-exit 60-ask-user 61-btw 62-hard-stop 63-cache-hit 64-session-stats 65-jev-attention 66-preset 67-theme 68-resume 69-login 70-steer 71-search 72-agents t0-leader-keys t0-global-keys 80-onboard}"
E2E_RETRY="${E2E_RETRY:-1}"   # 1 → at most 2 attempts per scenario
E2E_ISOLATED="${E2E_ISOLATED:-0}"
slot=0
for s in $E2E_SCENARIOS; do
  # Per-slot isolation: a fresh scratch home (and a derived mock port) per
  # scenario. reset_e2e_state at common.sh source time kills any leftover
  # host/mock, so no scenario inherits another's single-instance lock.
  if [ "$E2E_ISOLATED" = 1 ]; then
    export CLIENT_DSH_HOME="$(v2_scoped_home "$s")"
    export MOCK_PORT="$(v2_scoped_port "$slot")"
    export MOCK_BASE_URL="http://127.0.0.1:${MOCK_PORT}/v1"
    mkdir -p "$CLIENT_DSH_HOME"
    slot=$((slot + 1))
  fi

  attempt=1
  while (( attempt <= 2 )); do
    printf '\n===== scenario %s (attempt %d/2) =====\n' "$s" "$attempt"
    bash "./$s.sh"
    fail=0
    if [ -f "$RESULTS_DIR/$s.result" ]; then
      read -r _pass fail _warn <"$RESULTS_DIR/$s.result" || fail=0
    fi
    if (( fail == 0 )) || [ "$E2E_RETRY" != 1 ] || (( attempt >= 2 )); then
      break
    fi
    printf '  -- retrying %s (failed assertions: %s)\n' "$s" "$fail"
    # A retry must not inherit the failed attempt's counters/items.
    rm -f "$RESULTS_DIR/$s.result" "$RESULTS_DIR/$s.v2.result"
    if [ -f "$RESULTS_DIR/v2-items.tsv" ]; then
      # Remove this scenario's rows so the ledger reflects the final attempt.
      local_tmp="${RESULTS_DIR}/v2-items.tmp"
      awk -F '\t' -v name="$s" '$1 != name' "$RESULTS_DIR/v2-items.tsv" >"$local_tmp" \
        && mv "$local_tmp" "$RESULTS_DIR/v2-items.tsv"
    fi
    attempt=$((attempt + 1))
  done
done

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_WARN=0
printf '\n==================================================\n'
printf '  final results\n'
printf '==================================================\n'
for f in "$RESULTS_DIR"/*.result; do
  [ -f "$f" ] || continue
  read -r p fl w < "$f"
  name="$(basename "${f%.result}")"
  printf '  %-14s %3d pass  %3d fail  %3d warn\n' "$name" "$p" "$fl" "$w"
  TOTAL_PASS=$((TOTAL_PASS + p))
  TOTAL_FAIL=$((TOTAL_FAIL + fl))
  TOTAL_WARN=$((TOTAL_WARN + w))
done
printf '  %-14s %3d pass  %3d fail  %3d warn\n' 'TOTAL' \
  "$TOTAL_PASS" "$TOTAL_FAIL" "$TOTAL_WARN"

# v2 report: A/B/C + L-level ledger, B-class criteria, SKIP list, geometries.
v2_render_report "$RESULTS_DIR"

if (( TOTAL_FAIL > 0 )); then
  printf '\n  E2E RESULT: FAIL (%d failing assertions)\n' "$TOTAL_FAIL"
  exit 1
fi
printf '\n  E2E RESULT: PASS\n'
exit 0
