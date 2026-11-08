#!/usr/bin/env bash
# Host-side driver: build the Ubuntu 24.04 e2e image from this source tree
# and run the scenario suite inside one container (the container's isolated
# ~/.dsh keeps the host config untouched).
#
# Usage:  ./e2e/run-e2e.sh                 (from anywhere; resolves repo root)
#         E2E_SCENARIOS="20-start" ./e2e/run-e2e.sh
#
# Requirements: podman with a running machine (`podman machine start`).
# The base image pulls through docker.m.daocloud.io because docker.io is
# not reachable from this network; see e2e/Containerfile.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${IMAGE:-localhost/dsh-opentui-e2e:latest}"

# Same resolution rule as the dsh-tui-pi harness: newest of the `latest`
# (stable) and `next` (rc) dist-tags, never hand-pinned and never the
# retired `alpha` tag.
# bash 3.2 (macOS) aborts on `"${arr[@]}"` for an empty array under `set -u`
# (and `arr=()` leaves the variable unset), so carry the flag as a plain
# string — value never contains spaces.
NPM_VIEW_REG=""
if ! npm view @deepseek-ai/dsh@latest version >/dev/null 2>&1; then
  NPM_VIEW_REG="--registry=https://registry.npmjs.org"
fi
# shellcheck disable=SC2086
STABLE="$(npm view @deepseek-ai/dsh@latest version $NPM_VIEW_REG)"
# shellcheck disable=SC2086
RC="$(npm view @deepseek-ai/dsh@next version $NPM_VIEW_REG 2>/dev/null || true)"
DSH_VERSION="$STABLE"
# Prerelease-aware newest-of(latest,next) — NOT sort -V (trap on record:
# sort -V ranks 0.2.1-rc.2 above 0.2.1 once a stable lands on latest).
if [ -n "$RC" ] && node -e '
  const parse = (v) => { const [core, pre] = v.split("-"); return { c: core.split(".").map(Number), pre } }
  const A = parse(process.argv[1]), B = parse(process.argv[2])
  for (let i = 0; i < 3; i++) {
    if (A.c[i] !== B.c[i]) process.exit(A.c[i] > B.c[i] ? 0 : 1)
  }
  if ((A.pre === undefined) !== (B.pre === undefined)) process.exit(A.pre === undefined ? 0 : 1)
  process.exit(String(A.pre ?? "") >= String(B.pre ?? "") ? 0 : 1)
' "$RC" "$STABLE"; then
  DSH_VERSION="$RC"
fi
printf '==> dsh closure: %s\n' "$DSH_VERSION"

# The mirror defaults (DaoCloud base image, npmmirror node dist) are baked
# into e2e/Containerfile on this repo, so the only build arg to forward is
# the resolved dsh version.
printf '==> building image %s (context: %s)\n' "$IMAGE" "$REPO_ROOT"
podman build -f "$REPO_ROOT/e2e/Containerfile" \
  --build-arg DSH_VERSION="$DSH_VERSION" \
  -t "$IMAGE" "$REPO_ROOT"

printf '==> running scenario suite (all state stays inside the container)\n'
# Face under test: plugin (default, unchanged v1 behavior) or client
# (E2E_FACE=client — the bun TUI + resident-host topology users run daily).
# The client face needs the /src workspace snapshot baked by the
# Containerfile's client-face layer; see e2e/lib/common.sh for the runtime
# wiring (scratch DSH_HOME + provisioned opentui profile).
FACE="${E2E_FACE:-plugin}"
RUN_ARGS=(--rm --name dsh-opentui-e2e -v "$REPO_ROOT/e2e:/e2e:ro" -e "E2E_FACE=$FACE")
# Subset override consumed by run-all.sh; forwarded so callers can scope a
# run without hand-rolling podman incantations.
if [ -n "${E2E_SCENARIOS:-}" ]; then
  RUN_ARGS+=(-e "E2E_SCENARIOS=$E2E_SCENARIOS")
fi
podman run "${RUN_ARGS[@]}" \
  "$IMAGE" \
  bash /e2e/scenarios/run-all.sh

printf '==> e2e finished OK\n'
