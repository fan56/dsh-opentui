#!/usr/bin/env bash
# In-container runtime bootstrap for the CLIENT face, used by
# run-client-e2e.sh when the image's baked client-face layers are absent
# (the Containerfile carries the same steps as build layers, but this
# dev network's podman VM currently cannot reach registry.npmjs.org —
# see Containerfile — so the runtime path pulls from the npmmirror).
#
# Requires the repo bind-mounted at /repo (run-client-e2e.sh) and the e2e
# lib at /e2e. Steps:
#   1. snapshot the repo sources into /src (host node_modules excluded —
#      they hold darwin natives; linux natives are resolved below)
#   2. install bun globally from the npmmirror registry
#   3. pnpm install the workspace at /src (linux @opentui natives)
# then execs the scenario runner. All of this is per-container scratch;
# nothing is written to the image or the host.
set -euo pipefail

if [ ! -d /repo/packages/shell ]; then
  echo "client-face-setup: /repo bind-mount missing" >&2; exit 1
fi

mkdir -p /src
tar -C /repo --exclude 'node_modules' --exclude '.git' --exclude '.npmrc' -cf - . | tar -C /src -xf -
test -x /src/dsh-opentui

REG="${CLIENT_SETUP_NPM_REGISTRY:-https://registry.npmmirror.com}"
echo "[client-face-setup] installing bun from $REG"
npm install -g --no-fund --no-audit --registry "$REG" bun@1.4.4
bun --version

echo "[client-face-setup] pnpm install /src (linux natives)"
pnpm --dir /src install --registry "$REG"
test -d /src/packages/shell/node_modules/@opentui/solid

echo "[client-face-setup] /src ready — starting scenario runner"
exec bash /e2e/scenarios/run-all.sh
