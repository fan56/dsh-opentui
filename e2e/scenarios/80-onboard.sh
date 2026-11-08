#!/usr/bin/env bash
# Scenario 80 — onboarding. A rewrite of the dsh-tui-pi reference scenario 80
# for THIS product's shape (G2 verdict: same intent, different artifact — the
# product's one-command onboarding is `npm i -g @aiwayds/dsh-opentui` followed
# by the `dsh-opentui` launcher, whose first run provisions the profile via
# scripts/install-profile.mjs), so the assertions are NOT a port of the
# reference markers (no 1/3-2/3-3/3 progress lines exist in this product).
#
# Intent carried over from the reference: a cold machine reaches a usable TUI
# through the product's own first-run paths, with NO hand steps. Runs LAST in
# the suite on purpose (like the reference): its legs provision their own
# scratch homes and leg C re-boots the standard profile.
#
# Legs:
#   A. onboarding with THIS tree's artifact — the installer the launcher's
#      first run delegates to, driven with --dep file: (the tarball packed
#      from this source tree), then a real launcher boot into a rendered TUI.
#   B. the launcher's OWN first-run trigger — a fresh scratch DSH_HOME, bare
#      `dsh-opentui`, no pre-provisioning: the launcher must notice the
#      missing profile and attempt the onboarding by itself, and stay
#      non-fatal. KNOWN PUBLISHED-ARTIFACT GAP (warn, not fail): the
#      bootstrap's dep resolves to the npm registry's latest, and the
#      PUBLISHED 0.5.0 still pins the frozen opentui-0.7.0 stack
#      (solid-js ^1.9.12), while THIS tree's installer registers a
#      solid-js@1.9.17 patchedDependencies entry — the registry dep path
#      dies with ERR_PNPM_UNUSED_PATCH until the 0.8.2 stack is published.
#      The tree/published mix only exists inside this image (tree-built
#      launcher + registry dep); a real user installs the published
#      package's own matching scripts. Profile readiness + render are
#      therefore asserted in leg A with the tarball dep; leg B asserts the
#      trigger + the non-fatal degradation contract.
#   C. the BARE command leg — `env -u NODE_OPTIONS dsh --profile dsh-opentui`
#      without the launcher: the historical trap is the wrapper path being
#      all-green while the bare path dies on the missing --experimental-ffi.
#      The plugin's FFI self-heal (re-exec with the flag merged, 6582e2e /
#      the cf5e791 family) must rescue it; assert the render, not the wrapper.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'onboarding (first-run profile bootstrap -> usable TUI -> bare-command boot)'

GLOBAL_ROOT="$(npm prefix -g)"
LAUNCHER_PKG="$GLOBAL_ROOT/lib/node_modules/@aiwayds/dsh-opentui"

# --- prerequisites ----------------------------------------------------------
TARBALL="$(ls /dist/aiwayds-dsh-opentui-*.tgz 2>/dev/null | head -1)"
if [ -n "$TARBALL" ] && [ -f "$TARBALL" ]; then
  ok "tarball present: $(basename "$TARBALL")"
else
  bad 'no tarball found in /dist (image build contract broken)'
  summary
fi
if command -v dsh-opentui >/dev/null 2>&1; then
  ok "dsh-opentui launcher on PATH: $(command -v dsh-opentui)"
else
  bad 'dsh-opentui launcher missing (scenario 10 or the image build should have installed it)'
  summary
fi

# --- CLIENT face: the product's own first-run chain --------------------------
# Legs A-C below are plugin-face paths (the /dist tarball install, the
# registry-dep cold start of the GLOBAL dsh-opentui launcher, the bare plugin
# profile boot). The client face has no tarball/global-launcher install path;
# its first-run chain is: fresh scratch DSH_HOME -> the workspace's
# provision-opentui-profile.mjs (the client-side equivalent of
# install-profile.mjs) -> the repo-root launcher boots straight into a
# rendered TUI. Assert that chain; legs A-C are skipped per-face (same rule
# as 10-install).
if [ "$E2E_FACE" = client ]; then
  scenario 'client face: fresh DSH_HOME -> provision -> repo-root launcher boot'
  HOME_C=/tmp/onboard-home-client
  rm -rf "$HOME_C" && mkdir -p "$HOME_C"
  info "client leg: provisioning $HOME_C via provision-opentui-profile.mjs (scratch DSH_HOME)"
  if DSH_HOME="$HOME_C" timeout 300 node /src/packages/shell/scripts/provision-opentui-profile.mjs \
    >/tmp/onboard-client-provision.log 2>&1; then
    ok 'client onboarding provision exited 0'
  else
    bad "client onboarding provision failed (exit $?); tail of log:"
    tail -10 /tmp/onboard-client-provision.log | sed 's/^/    | /'
  fi
  assert_contains 'provisioned patch carries the pinned route' \
    'zai-coding-cn' "$(cat "$HOME_C/profiles/opentui/cordis.patch.yml" 2>/dev/null || true)"
  info 'client leg: first boot through the repo-root launcher (scratch home)'
  tmux kill-server 2>/dev/null || true
  sleep 0.3
  tmux new-session -d -s "$TS" -x "$TUI_COLS" -y "$TUI_ROWS" -c /app
  tmux send-keys -t "$TS" "env DSH_HOME=$HOME_C /src/dsh-opentui" Enter
  wait_tui_up 180 || { kill_tui; summary; }
  PANE_C="$(capture)"
  assert_contains 'onboarded client machine boots to the composer placeholder' \
    "$MARKER_COMPOSER_PLACEHOLDER" "$PANE_C"
  assert_contains 'onboarded client profile paints the pinned provider segment' \
    "$MARKER_PROVIDER_SEG" "$PANE_C"
  kill_tui
  warn 'plugin-face legs A-C skipped on the client face (no tarball/global-launcher install path; see the client leg above)'
  summary
  exit 0
fi

# --- leg A: onboarding with THIS tree's artifact ----------------------------
HOME_A=/tmp/onboard-home-a
rm -rf "$HOME_A" && mkdir -p "$HOME_A"
info "leg A: provisioning $HOME_A via install-profile.mjs --dep file: (the launcher's first-run delegate)"
if DSH_HOME="$HOME_A" NODE_OPTIONS= timeout 420 node "$LAUNCHER_PKG/scripts/install-profile.mjs" \
  --dep "file:$TARBALL" >/tmp/onboard-a-install.log 2>&1; then
  ok 'onboarding installer exited 0'
else
  bad "onboarding installer failed (exit $?); tail of log:"
  tail -20 /tmp/onboard-a-install.log | sed 's/^/    | /'
  summary
fi
A_INSTALL_LOG="$(cat /tmp/onboard-a-install.log)"
assert_contains 'installer reported the profile ready' \
  '[dsh-opentui] profile ready at' "$A_INSTALL_LOG"
assert_contains 'onboarded profile patch exists' 'id: dsh-opentui' \
  "$(cat "$HOME_A/profiles/dsh-opentui/cordis.patch.yml" 2>/dev/null || true)"

info 'leg A: first boot through the launcher (scratch home)'
start_tui "DSH_HOME=$HOME_A"
# The profile already exists, so the launcher skips its bootstrap and boots
# straight into the TUI — the onboarded machine is immediately usable.
wait_tui_up 180 || { kill_tui; summary; }
PANE="$(capture)"
assert_contains 'onboarded machine boots to the composer placeholder' \
  "$MARKER_COMPOSER_PLACEHOLDER" "$PANE"
assert_contains 'onboarded profile paints the pinned provider segment' \
  "$MARKER_PROVIDER_SEG" "$PANE"
kill_tui

# --- leg B: the launcher's own first-run trigger (cold home, no steps) -----
HOME_B=/tmp/onboard-home-b
rm -rf "$HOME_B" && mkdir -p "$HOME_B"
B_LOG=/tmp/onboard-b-coldstart.log
info "leg B: bare cold start with a fresh DSH_HOME=$HOME_B (launcher must self-onboard)"
set +e
env -u NODE_OPTIONS DSH_HOME="$HOME_B" dsh-opentui </dev/null >"$B_LOG" 2>&1 &
B_PID=$!
set -e
B_TRIGGER=0 B_READY=0 waited=0
while (( waited < 420 )); do
  B_OUT="$(cat "$B_LOG" 2>/dev/null || true)"
  printf '%s' "$B_OUT" | grep -qF '[dsh-opentui] workspace created' && B_TRIGGER=1
  if printf '%s' "$B_OUT" | grep -qF '[dsh-opentui] profile ready at'; then
    B_READY=1
    break
  fi
  # Degraded-published-dep outcome: the bootstrap concluded without a ready
  # profile and dsh went on booting without the plugin — the trigger contract
  # is fully observable, stop polling (the piped core boot never exits).
  if printf '%s' "$B_OUT" | grep -qF 'did not activate'; then
    break
  fi
  kill -0 "$B_PID" 2>/dev/null || break # process died early
  sleep 2
  waited=$((waited + 2))
done
B_OUT="$(cat "$B_LOG" 2>/dev/null || true)"
if (( B_TRIGGER )); then
  ok 'launcher first run attempted the profile bootstrap by itself (trigger works)'
else
  bad 'launcher first run never attempted the profile bootstrap within 420s; log tail:'
  printf '%s\n' "$B_OUT" | tail -10 | sed 's/^/    | /'
fi
if (( B_READY )); then
  ok 'launcher first run completed the profile bootstrap (registry dep resolved)'
else
  warn 'launcher first run did not complete with the registry dep (published 0.5.0 = frozen 0.7.0 stack vs this tree solid-js@1.9.17 patch, ERR_PNPM_UNUSED_PATCH); readiness is leg A'"'"'s subject (tarball dep)'
  printf '%s\n' "$B_OUT" | grep -E 'ERR_|failed to import' | head -3 | sed 's/^/    | /'
fi
assert_not_contains 'cold start hit no FFI failure' 'native FFI is not available' "$B_OUT"
if [ -d "$HOME_B/profiles/dsh-opentui/node_modules/@aiwayds/dsh-opentui" ]; then
  ok 'cold-start home ended with the plugin hoisted into the profile'
else
  warn 'cold-start home has no hoisted plugin (registry-dep gap above); a real first run would retry on the next launch'
fi
# Cleanup: the launcher and its dsh child keep running (piped TUI never
# exits); both match the lib's container-gated process patterns.
kill "$B_PID" 2>/dev/null || true
kill_tui_procs
sleep 1

# --- leg C: the bare command (no wrapper, no NODE_OPTIONS) -----------------
# The wrapper path injecting --experimental-ffi is proven by legs A/B and the
# whole suite; this leg asserts the OTHER path a user can take: the bare
# `dsh --profile dsh-opentui` on the standard profile. Without the launcher
# the FFI flag is missing and the boot used to die ('native FFI is not
# available'); the plugin's re-exec self-heal must turn it into a render.
info 'leg C: bare `env -u NODE_OPTIONS dsh --profile dsh-opentui` (no launcher)'
tmux kill-server 2>/dev/null || true
sleep 0.3
tmux new-session -d -s "$TS" -x "$TUI_COLS" -y "$TUI_ROWS" -c /app
tmux send-keys -t "$TS" 'env -u NODE_OPTIONS dsh --profile dsh-opentui' Enter
wait_tui_up 120 || { kill_tui; summary; }
PANE_C="$(capture)"
assert_contains 'bare command renders the composer placeholder (FFI self-heal works)' \
  "$MARKER_COMPOSER_PLACEHOLDER" "$PANE_C"
assert_not_contains 'bare command pane shows no FFI failure' 'native FFI is not available' "$PANE_C"
assert_not_contains 'bare command pane shows no boot failure' 'dsh-opentui boot failed' "$PANE_C"
if tui_alive; then
  ok 'bare-command boot is a live TUI process (not a dead screen)'
else
  bad 'bare-command boot is not alive'
fi
kill_tui

summary
