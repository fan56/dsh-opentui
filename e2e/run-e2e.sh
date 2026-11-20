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
# 024 E2E flaky law: the podman VM clock can lag the host by ~1h48m, so image
# CREATED timestamps are NOT a freshness signal. Freshness is judged ONLY by
# the IMAGE ID below (and by the dsh version resolved above with the
# newest-of(latest,next) rule — never a hand pin, never retired `alpha`).
podman build -f "$REPO_ROOT/e2e/Containerfile" \
  --build-arg DSH_VERSION="$DSH_VERSION" \
  -t "$IMAGE" "$REPO_ROOT"
printf '==> image ID (freshness = this ID only, NOT the VM clock): %s\n' \
  "$(podman image inspect --format '{{.Id}}' "$IMAGE")"

# 024 E2E flaky law: VM is 5CPU/2GiB — run at most 2 scenarios/containers at
# once. This driver runs ONE container for the whole suite; E2E_SCENARIOS
# scopes it to a subset. Source is baked into the image by the Containerfile
# (COPY packages /src) — the worktree is NOT mounted; only the test scripts
# are bind-mounted read-only at /e2e:ro.
printf '==> running scenario suite (all state stays inside the container; VM concurrency <= 2)\n'
# Face under test: the client face only (batch B5) — the bun TUI client +
# resident `dsh --profile opentui` host topology users run daily. The plugin
# face is retired (ADR-0005 / batch B4 removed the --plugin chain): the
# value is rejected outright so stale invocations fail loudly instead of
# booting a dead topology. See e2e/lib/common.sh for the runtime wiring
# (scratch DSH_HOME + provisioned opentui profile).
FACE="${E2E_FACE:-client}"
if [ "$FACE" = plugin ]; then
  printf 'ERROR: E2E_FACE=plugin is retired (the --plugin mode chain was removed in batch B4).\n' >&2
  printf '       The suite now runs the client face only; unset E2E_FACE or set it to client.\n' >&2
  exit 1
fi
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
