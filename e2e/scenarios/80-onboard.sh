#!/usr/bin/env bash
# Scenario 80 — onboarding (batch B5 rewrite for the client-only face). A
# rewrite of the dsh-tui-pi reference scenario 80 for THIS product's shape:
# the client face's one-command onboarding is a fresh machine reaching a
# usable TUI through the product's own first-run paths, with NO hand steps.
#
# The plugin-era legs this scenario used to run (the /dist tarball install
# via install-profile.mjs, the global dsh-opentui launcher's registry-dep
# cold start, the bare `dsh --profile dsh-opentui` FFI self-heal) are
# retired with the --plugin mode (ADR-0005, batch B4) — the profile they
# targeted (dsh-opentui) and the launcher they drove no longer exist in the
# e2e image.
#
# The client face's first-run chain, asserted here: fresh scratch DSH_HOME
# -> the workspace's provision-opentui-profile.mjs (the client-side
# equivalent of the old install-profile.mjs) -> the repo-root launcher boots
# straight into a rendered TUI.
#
# Runs LAST in the suite on purpose (like the reference): it provisions its
# own scratch home and boots through the repo-root launcher.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'onboarding (fresh DSH_HOME -> provision -> repo-root launcher boot)'

if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (drives a live TUI session); container only'
  summary
  exit 0
fi

# --- prerequisite: the client launcher (repo-root, from the /src snapshot) --
if [ -x /src/dsh-opentui ]; then
  ok 'client launcher on the image: /src/dsh-opentui'
else
  bad '/src/dsh-opentui launcher missing (image build contract broken)'
  summary
  exit 0
fi

HOME_C=/tmp/onboard-home-client
rm -rf "$HOME_C" && mkdir -p "$HOME_C"
info "provisioning $HOME_C via provision-opentui-profile.mjs (scratch DSH_HOME, the first-run delegate)"
if DSH_HOME="$HOME_C" timeout 300 node /src/packages/shell/scripts/provision-opentui-profile.mjs \
  >/tmp/onboard-client-provision.log 2>&1; then
  ok 'onboarding provision exited 0'
else
  bad "onboarding provision failed (exit $?); tail of log:"
  tail -10 /tmp/onboard-client-provision.log | sed 's/^/    | /'
  summary
  exit 0
fi
assert_contains 'provisioned patch carries the pinned route' \
  'zai-coding-cn' "$(cat "$HOME_C/profiles/opentui/cordis.patch.yml" 2>/dev/null || true)"

info 'first boot through the repo-root launcher (scratch home)'
tmux kill-server 2>/dev/null || true
sleep 0.3
tmux new-session -d -s "$TS" -x "$TUI_COLS" -y "$TUI_ROWS" -c /app
tmux send-keys -t "$TS" "env DSH_HOME=$HOME_C /src/dsh-opentui" Enter
wait_tui_up 180 || { kill_tui; summary; }
PANE_C="$(capture)"
assert_contains 'onboarded machine boots to the composer placeholder' \
  "$MARKER_COMPOSER_PLACEHOLDER" "$PANE_C"
assert_contains 'onboarded profile paints the pinned provider segment' \
  "$MARKER_PROVIDER_SEG" "$PANE_C"
kill_tui

summary
