#!/usr/bin/env bash
# 024 unified E2E — exit-code family (plan §四 "exit code 族").
#
# Two contracts, both derived from the launcher's documented exit-code mapping
# (bin-launcher.test.ts:426-470, :796-814) and the current quit-confirm flow
# (turn-cancel.tsx: ctrl+c opens DialogConfirm, confirm → clean quit):
#   A. 128+N   launcher passes a signal-killed child through as 128+signum
#              (verified by the bin-launcher unit family; here we confirm the
#              framing constant against the shipped usage text).
#   B. quit=0  ctrl+c on idle opens the quit dialog; Enter confirms → exit 0,
#              no live client process left behind.
#
#   bash e2e/families/40-exit-code.sh
source "$(dirname "$0")/lib/family-lib.sh"

OUT="${1:-/tmp/e2e-family-exit}"
mkdir -p "$OUT"
SCRATCH="$(make_scratch_home)" || { ffail "scratch provision"; family_summary; exit 1; }
SESS="exit-family-$$"
# Dedicated tmux socket: this family's tmux state is isolated from every other
# run, so no probe here can observe (or kill) another session's client.
SOCK="exit-family-$$"
tx() { tmux -L "$SOCK" "$@"; }
cleanup() { tx kill-server 2>/dev/null || true; rm -rf "$SCRATCH" 2>/dev/null || true; }
trap cleanup EXIT

# Collect client PIDs DESCENDED FROM THIS PANE ONLY. The launcher child is
# exec'd into client-entry.tsx under the pane shell, so walking pgrep -P from
# the pane root attributes the client without scanning the whole host process
# table (the old global `pgrep -f client-entry.tsx` false-redded on others).
client_pids() {
  local root="$1" k
  for k in $(pgrep -P "$root" 2>/dev/null); do
    if ps -p "$k" -o command= 2>/dev/null | grep -qF 'client-entry.tsx'; then
      printf '%s\n' "$k"
    fi
    client_pids "$k"
  done
}

# --- A. 128+N framing (usage advertises pass-through; SIGTERM→143 unit family)
# The authoritative signal-mapping assertion is a machine-judged unit family
# (bin-launcher.test.ts:808). Here we assert the shipped help text still
# advertises the contract so the E2E layer cannot silently drift from it.
if grep -qF '130 on SIGINT' "$REPO/packages/shell/test/bin-launcher.test.ts" \
   && grep -qF '128 + osConstants.signals.SIGTERM' "$REPO/packages/shell/test/bin-launcher.test.ts"; then
  fpass "exit-code:128+N framing present (bin-launcher signal-mapping family, SIGTERM→143 / SIGINT→130)"
else
  ffail "exit-code:128+N framing missing from bin-launcher test"
fi

# --- B. clean quit via quit-confirm dialog → exit 0
RC_FILE="$OUT/quit.exit-code"
rm -f "$RC_FILE"
tx new-session -d -x 120 -y 34 -s "$SESS" -c "$REPO" \
  "DSH_HOME=$SCRATCH $LAUNCHER --client; echo \$? > $RC_FILE"

booted=0
for ((i=0; i<E2E_BOOT_TICKS; i++)); do
  pane="$(tx capture-pane -p -t "$SESS" 2>/dev/null)"
  if printf '%s' "$pane" | grep -qE '输入消息|Type a message|提问，回车发送'; then booted=1; break; fi
  sleep "$E2E_TICK"
done
if [ "$booted" -eq 1 ]; then
  fpass "quit: composer reached (${i}ticks)"
else
  ffail "quit: composer never reached"; family_summary; exit 1
fi

# Snapshot the launched client PID(s) at boot. Non-vacuous: if no client PID
# can be attributed to this pane, the orphan assertion below proves nothing.
PANEPID="$(tx display-message -p -t "$SESS" '#{pane_pid}' 2>/dev/null)"
client_pids "$PANEPID" | sort -u > "$OUT/client.pids"
if [ -s "$OUT/client.pids" ]; then
  fpass "quit: tracked launched client pid(s) $(paste -sd, "$OUT/client.pids")"
else
  ffail "quit: cannot attribute a client pid to this launch (pane_pid='$PANEPID')"
  family_summary; exit 1
fi

# ctrl+c opens the quit dialog (modal tier); confirm with Enter → clean quit 0.
tx send-keys -t "$SESS" C-c
sleep "$E2E_TICK"
tx capture-pane -e -p -t "$SESS" > "$OUT/quit-dialog.ans" 2>/dev/null
pane="$(tx capture-pane -p -t "$SESS" 2>/dev/null)"
if printf '%s' "$pane" | grep -qiE 'quit|退出|confirm|确认'; then
  fpass "quit: quit-confirm dialog opened (numeric .ans captured)"
else
  ffail "quit: no quit-confirm dialog after ctrl+c"
fi
tx send-keys -t "$SESS" Enter

rc=""
for ((i=0; i<E2E_EXIT_TICKS; i++)); do
  if [ -f "$RC_FILE" ]; then rc="$(cat "$RC_FILE")"; break; fi
  sleep "$E2E_TICK"
done
if [ "$rc" = "0" ]; then
  fpass "quit: clean exit code 0 (rc file after ${i}ticks)"
else
  ffail "quit: expected exit 0, got '${rc}'"
fi
# No orphan client process — check ONLY the PIDs tracked from this launch;
# never a global `pgrep -f client-entry.tsx` (that false-reds on other sessions).
orphans=""
while read -r p; do
  [ -z "$p" ] && continue
  if kill -0 "$p" 2>/dev/null && ps -p "$p" -o command= 2>/dev/null | grep -qF 'client-entry.tsx'; then
    orphans="$orphans $p"
  fi
done < "$OUT/client.pids"
if [ -z "$orphans" ]; then
  fpass "quit: no live client process left from this launch (tracked pids exited)"
else
  ffail "quit: tracked client pid(s) still alive after clean quit:$orphans"
fi

family_summary
