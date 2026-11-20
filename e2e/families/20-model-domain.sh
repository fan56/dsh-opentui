#!/usr/bin/env bash
# 024 unified E2E — CapIR model capability-domain family (S1).
#
# Drives the generated-chain model methods through the shipped bridge bundle.
# E1/E2/E4 are hard gates. E3 (initializeDefaultModel) is an EXPLICIT ENV
# EXEMPTION (requirements B2): the scratch profile has no deepseek-account
# models/API key, so the host returns "provider deepseek-account has no
# available models" — an environment fact, not an implementation regression.
# The exemption is recorded here and in 024-e2e-requirements.md, never hidden.
#
#   bash e2e/families/20-model-domain.sh [outDir]
source "$(dirname "$0")/lib/family-lib.sh"

OUT="${1:-/tmp/e2e-family-model}"
mkdir -p "$OUT"
( cd "$REPO" && node scripts/verify-s1-model.mjs ) > "$OUT/cap-s1.log" 2>&1
LOG="$OUT/cap-s1.log"
E3_FAIL="$(grep -c 'FAIL  E3 initializeDefaultModel' "$LOG")"
OTHER_FAIL="$(grep -E '^FAIL ' "$LOG" | grep -v 'FAIL  E3 initializeDefaultModel' | wc -l | tr -d ' ')"
SUMMARY="$(grep '^summary:' "$LOG" | tail -1)"

# All non-E3 checks must pass; E3 must be the only (env) failure.
if [ "$OTHER_FAIL" = "0" ]; then
  fpass "model domain: all reachable checks green ($SUMMARY)"
else
  ffail "model domain: $OTHER_FAIL non-exempt FAIL(s) ($SUMMARY; see $LOG)"
fi
if [ "$E3_FAIL" -ge 1 ]; then
  printf 'EXEMPT model:E3 initializeDefaultModel — no deepseek-account models in scratch (requirements B2, environment)\n'
fi
# Ensure E3 is the ONLY failure and the exemption is honestly bounded.
if [ "$OTHER_FAIL" = "0" ] && [ "$(grep -c '^FAIL ' "$LOG")" -le 1 ]; then
  fpass "model domain: exemption bounded (E3 only, no silent reds)"
fi
family_summary
