#!/usr/bin/env bash
# Host-side driver for the CLIENT face (E2E_FACE=client): runs the scenario
# suite on the daily-use topology (bun TUI client + resident
# 'dsh --profile opentui' host) using the existing e2e image plus a runtime
# workspace snapshot. The image-baked variant of these layers lives in
# e2e/Containerfile; this runtime path exists because this dev network's
# podman VM currently cannot reach registry.npmjs.org for the in-image
# installs (e2e/lib/client-face-setup.sh pulls from the npmmirror instead).
#
# Usage:  E2E_SCENARIOS='20-start' ./e2e/run-client-e2e.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${IMAGE:-localhost/dsh-opentui-e2e:latest}"

printf '==> running CLIENT-face suite (repo snapshot mounted at /repo)\n'
exec podman run --rm --name dsh-opentui-e2e-client \
  -v "$REPO_ROOT/e2e:/e2e:ro" \
  -v "$REPO_ROOT:/repo:ro" \
  -e E2E_FACE=client \
  -e "E2E_SCENARIOS=${E2E_SCENARIOS:-20-start}" \
  "$IMAGE" \
  bash /e2e/lib/client-face-setup.sh
