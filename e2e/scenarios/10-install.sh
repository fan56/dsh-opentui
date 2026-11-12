#!/usr/bin/env bash
# Scenario 10 — installation (batch B5 rewrite for the client-only face).
# The plugin-era chain this scenario used to assert (tarball -> global
# plugin-launcher install -> dsh-opentui profile bootstrap -> plugin-mode
# boot) is retired with the --plugin mode (ADR-0005, batch B4). The product
# shape it verifies now: the npm package @aiwayds/dsh-opentui packs cleanly
# from this source tree and installs globally — the install path a user
# runs — and the package ships the client bin that boots the bun TUI.
#
# Legs:
#   1. "pack completes" — npm pack of packages/shell from the /src workspace
#      snapshot (the same tree the Containerfile baked), exercising the
#      prepack hook (pack-meta.mjs).
#   2. "install completes and the bin resolves" — npm i -g of the tarball
#      into the container's global prefix (--ignore-scripts: the global
#      postinstall's profile bootstrap is the retired plugin-era path),
#      then the bin name must resolve on PATH.
#   3. "the installed package ships the client bundle" — the npm client
#      distribution artifact (scripts/build-client.mjs ->
#      dist/client/index.js) with a bin that boots it. GATED: until B2/B3
#      land the package still carries the retired plugin-era bin only, so
#      the boot leg records an honest warn and is skipped instead of
#      asserting a boot that cannot exist yet.
#   4. "reinstalling is safe" — the second npm i -g exits 0 and the bin
#      still resolves (the historical 168d201 idempotency intent, carried
#      over in the shape that still exists).
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'install (npm pack -> global install -> client bin -> idempotent reinstall)'

PKG_DIR=/src/packages/shell
GLOBAL_ROOT="$(npm prefix -g)"
LAUNCHER_PKG="$GLOBAL_ROOT/lib/node_modules/@aiwayds/dsh-opentui"
# Runtime installs resolve the tarball's dependencies (@opentui/*, solid-js,
# ws) from a registry; this dev network's podman VM cannot reach
# registry.npmjs.org (the same constraint client-face-setup.sh routes
# around), so the default here is the npmmirror. E2E_NPM_REGISTRY overrides.
NPM_REG="${E2E_NPM_REGISTRY:-https://registry.npmmirror.com}"

if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (installs into the container global prefix); container only'
  summary
  exit 0
fi
if [ ! -d "$PKG_DIR" ]; then
  bad "no workspace snapshot at $PKG_DIR (image build contract broken)"
  summary
  exit 0
fi

# --- leg 1: pack the user-facing tarball from THIS source tree --------------
rm -rf /tmp/install-pkg && mkdir -p /tmp/install-pkg
if (cd "$PKG_DIR" && npm pack --pack-destination /tmp/install-pkg) >/tmp/install-pack.log 2>&1; then
  ok 'npm pack from the source tree exited 0 (prepack hook exercised)'
else
  bad "npm pack failed (exit $?); tail of log:"
  tail -10 /tmp/install-pack.log | sed 's/^/    | /'
  summary
  exit 0
fi
TARBALL="$(ls /tmp/install-pkg/aiwayds-dsh-opentui-*.tgz 2>/dev/null | head -1)"
if [ -n "$TARBALL" ] && [ -f "$TARBALL" ]; then
  ok "tarball under test: $(basename "$TARBALL")"
else
  bad 'npm pack produced no aiwayds-dsh-opentui-*.tgz'
  summary
  exit 0
fi

# --- leg 2: global install — the bin a user gets -----------------------------
# --ignore-scripts skips the global postinstall's profile bootstrap (the
# retired plugin-era path; the client face's profile is provisioned by
# start_tui / ensure_client_profile from the workspace snapshot instead).
if npm install -g --ignore-scripts --no-fund --no-audit --registry "$NPM_REG" "$TARBALL" >/tmp/install-global.log 2>&1; then
  ok 'npm i -g of the tarball exited 0'
else
  bad "npm i -g failed (exit $?); tail of log:"
  tail -20 /tmp/install-global.log | sed 's/^/    | /'
  summary
  exit 0
fi
if command -v dsh-opentui >/dev/null 2>&1; then
  ok "dsh-opentui bin registered: $(command -v dsh-opentui)"
else
  bad 'dsh-opentui bin missing after global install'
  summary
  exit 0
fi

# --- leg 3: the installed package ships the client bin ----------------------
# The npm client distribution (batch B1's bundle) lands at
# dist/client/index.js inside the package. Until B2/B3 repoint the package's
# bin at it, the tarball carries only the retired plugin-era launcher —
# booting that bin would walk the dead `dsh --profile dsh-opentui` chain, so
# the boot leg is gated on the artifact actually existing.
CLIENT_BUNDLE="$LAUNCHER_PKG/dist/client/index.js"
if [ -f "$CLIENT_BUNDLE" ]; then
  ok 'installed package ships the client bundle (dist/client/index.js)'
  if grep -q 'client' "$(command -v dsh-opentui)" 2>/dev/null \
    || grep -rq 'dist/client' "$LAUNCHER_PKG/bin" 2>/dev/null; then
    ok 'bin is wired to the client bundle (client entry referenced by the bin)'
  else
    warn 'client bundle present but the bin does not reference it yet (B2/B3 bin rewiring pending)'
  fi
  info 'client bin boot leg: booting the installed bin in a scratch DSH_HOME'
  BOOT_HOME=/tmp/install-boot-home
  rm -rf "$BOOT_HOME" && mkdir -p "$BOOT_HOME"
  tmux kill-server 2>/dev/null || true
  sleep 0.3
  tmux new-session -d -s "$TS" -x "$TUI_COLS" -y "$TUI_ROWS" -c /app
  tmux send-keys -t "$TS" "env DSH_HOME=$BOOT_HOME dsh-opentui" Enter
  # 600s, not the stock 180: this leg cold-installs the 14 plugin packages
  # (pnpm reports `Packages: +14` / `resolved 14, reused 0` with an empty
  # store, so every package pays a full TLS fetch). Network measured
  # 2026-11-12 on this dev network: host -> registry.npmjs.org TLS 5.54s /
  # 6.65s total at 1.7 KB/s; in-container -> same target TLS 4.74s /
  # 5.41s total at 2.1 KB/s (same speed as the host — not a VM-forwarding
  # problem); same machine -> registry.npmmirror.com 0.21s at 58 KB/s.
  # At 1.7-2.1 KB/s a 14-package cold install cannot finish in 180s and
  # the leg false-fails on the cross-border link alone (sibling scenarios
  # 20/22/40/50 pass in seconds off the pre-provisioned profile). 600s is
  # an environment-sensitivity fix for that measured link, not a mask for
  # a product bug. The registry stays the product default on purpose —
  # pointing this boot at npmmirror would change the environment under test.
  wait_tui_up 600 || { kill_tui; summary; }
  PANE="$(capture)"
  assert_contains 'npm-installed client bin boots to the composer placeholder' \
    "$MARKER_COMPOSER_PLACEHOLDER" "$PANE"
  assert_contains 'npm-installed client bin paints the pinned provider segment' \
    "$MARKER_PROVIDER_SEG" "$PANE"
  # Plugin-integrity proof for this boot leg — the provisioner WARNs and
  # continues when an install ultimately fails, and the composer/provider
  # markers above can paint without the plugins, so the delivered state is
  # asserted here instead: every plugin the INSTALLED package's own
  # provision-plan PLUGIN_SET plans must be pinned in the scratch profile's
  # dependencies AND resolve under node_modules (the same contract the
  # provisioner's idempotency check uses). A spec still missing after the
  # boot is a hard FAIL — a failed install is never waved through.
  MISSING="$(node --input-type=module -e '
import { existsSync, readFileSync } from "node:fs";
const { selectPlugins } = await import("file://" + process.argv[1] + "/scripts/lib/provision-plan.mjs");
const dir = process.argv[2] + "/profiles/opentui";
const manifest = existsSync(dir + "/package.json")
  ? JSON.parse(readFileSync(dir + "/package.json", "utf8"))
  : null;
const deps = manifest?.dependencies ?? {};
const missing = [];
for (const plugin of selectPlugins("recommended")) {
  if (!(plugin.name in deps)) { missing.push(plugin.name + " (not pinned in the profile dependencies)"); continue; }
  if (!existsSync(dir + "/node_modules/" + plugin.name + "/package.json")) {
    missing.push(plugin.name + " (pinned but node_modules does not resolve)");
  }
}
process.stdout.write(missing.join("\n"));
' "$LAUNCHER_PKG" "$BOOT_HOME" 2>&1)"
  if [ -n "$MISSING" ]; then
    bad 'npm-installed boot: plugin set incomplete after provisioning (no silent pass); missing:'
    printf '%s\n' "$MISSING" | sed 's/^/    | /'
  else
    ok 'npm-installed boot: plugin set complete (every PLUGIN_SET dep pinned and resolving)'
  fi
  kill_tui
else
  warn 'installed package ships no client bundle yet (dist/client/index.js missing — B2/B3 npm-bin rewiring pending); boot leg skipped honestly, pack + install + bin-resolution are the asserted contract today'
fi

# --- leg 4: idempotent reinstall ---------------------------------------------
# The second npm i -g must not corrupt the global prefix: the bin still
# resolves afterwards (the 168d201 idempotency intent, npm-package shape).
info 're-running npm i -g (idempotency leg)'
if npm install -g --ignore-scripts --no-fund --no-audit --registry "$NPM_REG" "$TARBALL" >>/tmp/install-global-2.log 2>&1 \
  && command -v dsh-opentui >/dev/null 2>&1; then
  ok 'global reinstall exited 0 and the bin still resolves'
else
  bad 'global reinstall broke the launcher bin'
fi

summary
