#!/usr/bin/env bash
# Master in-container runner: executes the scenarios in order (each one
# always finishes; failures are recorded, not fatal) and aggregates the
# per-scenario counters into a final verdict + exit code.
set -u
export TERM="${TERM:-xterm-256color}"
cd "$(dirname "$0")"

RESULTS_DIR="${RESULTS_DIR:-/tmp/e2e-results}"
rm -rf "$RESULTS_DIR"
mkdir -p "$RESULTS_DIR"

printf 'e2e runner: image toolchain — %s | node %s | tmux %s\n' \
  "$(uname -m)" "$(node --version)" "$(tmux -V)"
printf 'e2e runner: opentui tarball — %s\n' "$(ls /dist/ 2>/dev/null || echo none)"
printf 'e2e runner: profile — %s\n' \
  "$(ls /root/.dsh/profiles/dsh-opentui/cordis.patch.yml 2>/dev/null || echo MISSING)"

# E2E_SCENARIOS overrides the list (space-separated) so callers can scope a
# run without hand-rolling podman incantations.
E2E_SCENARIOS="${E2E_SCENARIOS:-20-start 22-search 30-commands 40-mock-llm 50-resize-exit 60-ask-user 61-btw 62-hard-stop 63-cache-hit 64-session-stats 65-jev-attention 66-preset 67-theme 68-resume 69-login 70-steer 71-search 72-agents}"
for s in $E2E_SCENARIOS; do
  bash "./$s.sh"
done

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_WARN=0
printf '\n==================================================\n'
printf '  final results\n'
printf '==================================================\n'
for f in "$RESULTS_DIR"/*.result; do
  read -r p fl w < "$f"
  name="$(basename "${f%.result}")"
  printf '  %-14s %3d pass  %3d fail  %3d warn\n' "$name" "$p" "$fl" "$w"
  TOTAL_PASS=$((TOTAL_PASS + p))
  TOTAL_FAIL=$((TOTAL_FAIL + fl))
  TOTAL_WARN=$((TOTAL_WARN + w))
done
printf '  %-14s %3d pass  %3d fail  %3d warn\n' 'TOTAL' \
  "$TOTAL_PASS" "$TOTAL_FAIL" "$TOTAL_WARN"

if (( TOTAL_FAIL > 0 )); then
  printf '\n  E2E RESULT: FAIL (%d failing assertions)\n' "$TOTAL_FAIL"
  exit 1
fi
printf '\n  E2E RESULT: PASS\n'
exit 0
