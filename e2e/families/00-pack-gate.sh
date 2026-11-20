#!/usr/bin/env bash
# 024 unified E2E — pack gate (plan §四 "pack 门禁最外层常驻").
#
# The outermost, always-on gate. Reuses the repository's own packaging
# invariants so the E2E layer cannot drift from the publish contract:
#   1. capcontract integrity gate (13 checks, @manual=0)
#   2. pack-locales contract (prepack verifier: dist/locales byte-identical)
#   3. npm pack produces a tarball (no network, prepack build runs)
#
#   bash e2e/families/00-pack-gate.sh [outDir]
source "$(dirname "$0")/lib/family-lib.sh"

OUT="${1:-/tmp/e2e-family-pack}"
mkdir -p "$OUT"

# 1. integrity gate
( cd "$REPO" && node scripts/check-capcontract.mjs ) > "$OUT/capcontract.log" 2>&1
if [ "$?" -eq 0 ]; then
  fpass "pack:capcontract integrity gate green"
else
  ffail "pack:capcontract integrity gate failed (see $OUT/capcontract.log)"
fi

# 2. pack-locales contract (build-client + locales copy must be current)
( cd "$REPO" && bun scripts/verify-pack-locales.mjs ) > "$OUT/pack-locales.log" 2>&1
if [ "$?" -eq 0 ]; then
  fpass "pack:locales contract green (dist/locales byte-identical)"
else
  ffail "pack:locales contract failed (see $OUT/pack-locales.log)"
fi

# 3. npm pack produces a tarball (packages/shell prepack runs the real build)
( cd "$REPO/packages/shell" && npm pack --pack-destination "$OUT" 2>&1 ) > "$OUT/npm-pack.log" 2>&1
TARBALL="$(find "$OUT" -maxdepth 1 -name '*.tgz' 2>/dev/null | head -1)"
if [ -n "$TARBALL" ] && [ -s "$TARBALL" ]; then
  fpass "pack:npm pack produced tarball ($(basename "$TARBALL"))"
else
  ffail "pack:npm pack produced no tarball (see $OUT/npm-pack.log)"
fi

family_summary
