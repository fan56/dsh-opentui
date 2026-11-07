#!/usr/bin/env bash
# Scenario 10 — installation. A rewrite of the dsh-tui-pi reference scenario
# 10 for THIS product's shape (G2 verdict: same intent, different artifact —
# the product is an npm package @aiwayds/dsh-opentui with a launcher bin and
# an idempotent profile installer, not a `dsh plugin add` tarball), so the
# assertions are NOT a port of the reference markers.
#
# Intent carried over from the reference:
#   1. "install completes and the thing is usable" — pack the tarball from
#      this source tree, install it globally, provision the profile, and
#      prove a real TUI boot renders.
#   2. "reinstalling is safe" — the second install is idempotent: no
#      duplicated patch/workspace blocks, deps still install. This is the
#      168d201 pit (duplicate patchedDependencies blocks + stale direct
#      solid-js dep reviving the SSR build), which the installer fixed —
#      assert the fix holds against a fresh + re-run profile.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'install (tarball -> global launcher -> scratch profile -> boot, then idempotent reinstall)'

GLOBAL_ROOT="$(npm prefix -g)"
LAUNCHER_PKG="$GLOBAL_ROOT/lib/node_modules/@aiwayds/dsh-opentui"
INSTALL_HOME=/tmp/install-dsh-home

# --- pack the user-facing tarball from THIS source tree --------------------
# The Containerfile does the same pack at build time into /dist; re-packing
# here keeps the scenario honest when /dist is stale and exercises the
# prepack hook (pack-meta.mjs). Fall back to the baked /dist tarball if the
# build-time /src is gone.
rm -rf /tmp/install-pkg && mkdir -p /tmp/install-pkg
if [ -d /src/packages/shell ] && (cd /src/packages/shell && npm pack --pack-destination /tmp/install-pkg) >/tmp/install-pack.log 2>&1; then
  ok 'npm pack from the source tree exited 0'
else
  warn 'in-scenario npm pack failed — falling back to the baked /dist tarball'
  tail -10 /tmp/install-pack.log 2>/dev/null | sed 's/^/    | /'
fi
TARBALL="$(ls /tmp/install-pkg/aiwayds-dsh-opentui-*.tgz 2>/dev/null | head -1)"
if [ -z "$TARBALL" ]; then
  TARBALL="$(ls /dist/aiwayds-dsh-opentui-*.tgz 2>/dev/null | head -1)"
fi
if [ -n "$TARBALL" ] && [ -f "$TARBALL" ]; then
  ok "tarball under test: $(basename "$TARBALL")"
else
  bad 'no tarball available (pack and /dist both empty)'
  summary
fi

# --- global install: the launcher bin a user gets --------------------------
# --ignore-scripts mirrors the Containerfile: the global postinstall's own
# bootstrap would resolve the profile dep from the registry's 'latest'
# instead of this source tree; the explicit --dep run below is the
# authoritative profile provisioning (the postinstall-onboarding path is
# scenario 80's subject).
if npm install -g --ignore-scripts --no-fund --no-audit "$TARBALL" >/tmp/install-global.log 2>&1; then
  ok 'npm i -g of the tarball exited 0'
else
  bad "npm i -g failed (exit $?); tail of log:"
  tail -20 /tmp/install-global.log | sed 's/^/    | /'
  summary
fi
if command -v dsh-opentui >/dev/null 2>&1; then
  ok "dsh-opentui bin registered: $(command -v dsh-opentui)"
else
  bad 'dsh-opentui bin missing after global install'
  summary
fi

# --- first-run profile install into a SCRATCH DSH_HOME ---------------------
# The installer is what the launcher's first run and the global postinstall
# both delegate to; driven here with --dep file: so the profile provably
# mounts THIS tree's artifact. The home is scratch: the host/container's
# real ~/.dsh is never touched.
rm -rf "$INSTALL_HOME"
mkdir -p "$INSTALL_HOME"
if DSH_HOME="$INSTALL_HOME" NODE_OPTIONS= timeout 420 node "$LAUNCHER_PKG/scripts/install-profile.mjs" \
  --dep "file:$TARBALL" >/tmp/install-profile.log 2>&1; then
  ok 'install-profile.mjs exited 0'
else
  bad "install-profile.mjs failed (exit $?); tail of log:"
  tail -20 /tmp/install-profile.log | sed 's/^/    | /'
  summary
fi
PROFILE_DIR="$INSTALL_HOME/profiles/dsh-opentui"

PKG_JSON="$(cat "$PROFILE_DIR/package.json" 2>/dev/null || true)"
assert_contains 'profile package.json declares the dsh-opentui bundle' '"@aiwayds/dsh-opentui"' "$PKG_JSON"
assert_contains 'profile package.json declares the dsh-base bundle' '@deepseek-ai/dsh-base' "$PKG_JSON"
assert_contains 'profile dep pinned to the tarball under test' "file:$TARBALL" "$PKG_JSON"
if node -e "const p=require('$PROFILE_DIR/package.json'); process.exit(p.dependencies['solid-js'] ? 1 : 0)" 2>/dev/null; then
  ok 'no stale direct solid-js dep in the profile (the patch owns the pin)'
else
  bad 'profile package.json carries a direct solid-js dep (SSR-revival hazard, 168d201)'
fi

PATCH="$(cat "$PROFILE_DIR/cordis.patch.yml" 2>/dev/null || true)"
assert_contains 'patch layer mounts the dsh-opentui plugin' 'id: dsh-opentui' "$PATCH"
assert_contains 'patch layer pins the default provider route' 'zai-coding-cn' "$PATCH"

WORKSPACE="$(cat "$PROFILE_DIR/pnpm-workspace.yaml" 2>/dev/null || true)"
if printf '%s' "$WORKSPACE" | grep -q 'set this to true or false'; then
  bad 'pnpm-workspace.yaml left an undecided allowBuilds placeholder'
else
  ok 'pnpm-workspace.yaml has no undecided allowBuilds placeholders'
fi

if [ -d "$PROFILE_DIR/node_modules/@aiwayds/dsh-opentui" ]; then
  ok 'plugin package hoisted into the profile node_modules'
else
  bad 'plugin package missing from the profile node_modules'
  summary
fi
if [ -f "$PROFILE_DIR/node_modules/solid-js/dist/solid.js" ]; then
  ok 'solid-js pinned to its client build (dist/solid.js present)'
else
  bad 'solid-js client build missing — first frame would render then updates go dead'
fi
if [ -L "$PROFILE_DIR/node_modules/@deepseek-ai/dsh-llm" ]; then
  ok "dsh-llm closure-linked -> $(readlink "$PROFILE_DIR/node_modules/@deepseek-ai/dsh-llm")"
else
  bad 'profile node_modules has no @deepseek-ai/dsh-llm closure link (plugin import would fail)'
fi

# --- boot leg 1: the freshly installed profile renders a real TUI ---------
start_tui "DSH_HOME=$INSTALL_HOME"
wait_tui_up 180 || { kill_tui; summary; }
PANE="$(capture)"
assert_contains 'boot renders the composer placeholder (installed profile is usable)' \
  "$MARKER_COMPOSER_PLACEHOLDER" "$PANE"
assert_contains 'boot paints the pinned provider segment' "$MARKER_PROVIDER_SEG" "$PANE"
kill_tui

# --- idempotent reinstall (the 168d201 pit) --------------------------------
# Re-running the installer AND the global install must not corrupt anything:
# one patchedDependencies block with one solid-js key, the patch entry not
# re-appended (no .bak rewrite), deps still install (pnpm exits 0).
info 're-running the installer + global install (idempotency leg)'
if DSH_HOME="$INSTALL_HOME" NODE_OPTIONS= timeout 420 node "$LAUNCHER_PKG/scripts/install-profile.mjs" \
  --dep "file:$TARBALL" >/tmp/install-profile-2.log 2>&1; then
  ok 'second install-profile.mjs run exited 0 (deps did not break)'
else
  bad "second install-profile.mjs run failed (exit $?); tail of log:"
  tail -20 /tmp/install-profile-2.log | sed 's/^/    | /'
fi
REINSTALL_LOG="$(cat /tmp/install-profile-2.log /tmp/install-profile.log)"
if printf '%s' "$REINSTALL_LOG" | grep -qiE 'ERR_ |duplicate mapping key'; then
  bad 'installer logs carry pnpm ERR markers across the two runs'
else
  ok 'no pnpm ERR markers across both installer runs'
fi
WS2="$(cat "$PROFILE_DIR/pnpm-workspace.yaml")"
if [ "$(printf '%s\n' "$WS2" | grep -c '^patchedDependencies:')" = "1" ]; then
  ok 'exactly one top-level patchedDependencies block after the rerun'
else
  bad "patchedDependencies block count = $(printf '%s\n' "$WS2" | grep -c '^patchedDependencies:') (duplicate-block hazard)"
fi
if [ "$(printf '%s\n' "$WS2" | grep -c 'solid-js@')" = "1" ]; then
  ok 'exactly one solid-js patch key after the rerun'
else
  bad "solid-js patch key count = $(printf '%s\n' "$WS2" | grep -c 'solid-js@')"
fi
if [ "$(cat "$PROFILE_DIR/cordis.patch.yml" | grep -c 'id: dsh-opentui')" = "1" ]; then
  ok 'patch layer still has exactly one dsh-opentui insert after the rerun'
else
  bad "dsh-opentui insert count = $(cat "$PROFILE_DIR/cordis.patch.yml" | grep -c 'id: dsh-opentui') (re-append hazard)"
fi
BAK_COUNT="$(find "$PROFILE_DIR" -name 'cordis.patch.yml.bak-*' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$BAK_COUNT" = "0" ]; then
  ok 'rerun preserved the patch file (no .bak rewrite — idempotent fast path)'
else
  warn "rerun rewrote the patch file ($BAK_COUNT backup(s)) — installer should keep an existing dsh-opentui layer"
fi
if npm install -g --ignore-scripts --no-fund --no-audit "$TARBALL" >>/tmp/install-global-2.log 2>&1 \
  && command -v dsh-opentui >/dev/null 2>&1; then
  ok 'global reinstall exited 0 and the bin still resolves'
else
  bad 'global reinstall broke the launcher bin'
fi
if [ -f "$PROFILE_DIR/node_modules/solid-js/dist/solid.js" ]; then
  ok 'solid-js client build survived the reinstall (still not the SSR build)'
else
  bad 'solid-js client build lost after the reinstall'
fi

# --- boot leg 2: the reinstalled profile still renders ---------------------
start_tui "DSH_HOME=$INSTALL_HOME"
wait_tui_up 180 || { kill_tui; summary; }
PANE2="$(capture)"
assert_contains 'reboot after reinstall renders the composer placeholder' \
  "$MARKER_COMPOSER_PLACEHOLDER" "$PANE2"
kill_tui

summary
