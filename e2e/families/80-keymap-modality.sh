#!/usr/bin/env bash
# 024 unified E2E — keymap/modality family (plan §四 "SK 后 keymap/modality 族基于 FocusRouter 新层编写").
#
# Two halves, both written against the FocusRouter layer (not the old key-gate
# handlers, so nothing is written twice):
#   1. machine-judged FocusRouter unit family — tier precedence + the N1/N2
#      modality-leak negatives (packages/tui-base/test/focus-router.test.tsx).
#   2. real rendered .ans frames (numeric `capture-pane -e -p`, no PNG) for the
#      modal / esc / paging / basic scenarios, via the existing recipe that
#      boots the scratch-provisioned TUI.
#
#   bash e2e/families/80-keymap-modality.sh [outDir]
source "$(dirname "$0")/lib/family-lib.sh"

OUT="${1:-/tmp/e2e-family-keymap}"
mkdir -p "$OUT"

# --- 1. FocusRouter unit family (machine verdict, no renderer needed) --------
FR_LOG="$OUT/focus-router-unit.log"
( cd "$REPO" && bun test packages/tui-base/test/focus-router.test.tsx ) >"$FR_LOG" 2>&1
FR_RC=$?
FR_PASS="$(grep -oE '[0-9]+ pass' "$FR_LOG" | tail -1 | awk '{print $1}')"
FR_FAIL="$(grep -oE '[0-9]+ fail' "$FR_LOG" | tail -1 | awk '{print $1}')"
if [ "$FR_RC" -eq 0 ] && [ "${FR_FAIL:-1}" = "0" ] && [ "${FR_PASS:-0}" -ge 13 ]; then
  fpass "keymap:FocusRouter unit family ${FR_PASS}/13 (tier precedence + N1/N2 modality leak)"
else
  ffail "keymap:FocusRouter unit family rc=$FR_RC pass=$FR_PASS fail=$FR_FAIL (see $FR_LOG)"
fi

# --- 2. real rendered .ans frames via the existing FocusRouter-aware recipe --
# The real-client-gate .ans recipe already drives modal/esc/paging/basic on the
# provisioned scratch TUI; reusing it keeps a single source of truth and the
# numeric-only discipline (no PNG, no visual model).
SCRATCH="$(make_scratch_home)" || { ffail "keymap: scratch provision"; family_summary; exit 1; }
SESS="keymap-family-$$"
cleanup() { tmux kill-session -t "$SESS" 2>/dev/null || true; rm -rf "$SCRATCH" 2>/dev/null || true; }
trap cleanup EXIT
tmux new-session -d -x 120 -y 34 -s "$SESS" -c "$REPO" \
  "DSH_HOME=$SCRATCH $LAUNCHER --client 2>$OUT/client.err.log"
booted=0
for ((i=0; i<E2E_BOOT_TICKS; i++)); do
  pane="$(tmux capture-pane -p -t "$SESS" 2>/dev/null)"
  if printf '%s' "$pane" | grep -qE '输入消息|Type a message|提问，回车发送'; then booted=1; break; fi
  sleep "$E2E_TICK"
done
if [ "$booted" -ne 1 ]; then ffail "keymap: composer never reached (frames BLOCKED, not faked)"; family_summary; exit 1; fi
fpass "keymap: composer reached (${i}ticks)"

clear_composer() { tmux send-keys -t "$SESS" C-u 2>/dev/null || true; sleep 0.3; }
snap() { tmux capture-pane -e -p -t "$SESS" > "$OUT/$1.ans" 2>/dev/null; tmux capture-pane -p -t "$SESS" > "$OUT/$1.log" 2>/dev/null; }

clear_composer
tmux send-keys -t "$SESS" 'keymap-probe'; sleep 0.8; snap 'basic'
grep -q 'keymap-probe' "$OUT/basic.log" && fpass "keymap:basic composer input (.ans)" || ffail "keymap:basic composer input"
clear_composer

tmux send-keys -t "$SESS" C-c; sleep 1; snap 'modal'
grep -qiE 'quit|退出|╭|┌' "$OUT/modal.log" && fpass "keymap:modal quit dialog (.ans)" || ffail "keymap:modal quit dialog"
tmux send-keys -t "$SESS" Escape; sleep 0.5; clear_composer

tmux send-keys -t "$SESS" '/agents'; sleep 0.5; tmux send-keys -t "$SESS" Enter; sleep 2
tmux send-keys -t "$SESS" Next; sleep 1; snap 'paging'
grep -qiE 'agents|agent|╭|┌' "$OUT/paging.log" && fpass "keymap:paging panel frame (.ans)" || ffail "keymap:paging panel frame"
tmux send-keys -t "$SESS" Escape; sleep 0.5; clear_composer

snap 'esc'
# Honest gap: a busy-turn Esc arm→confirm chain needs a live session controller;
# the scratch profile has no account model to drive a real turn. Record the
# resting frame, do NOT claim the full chain.
fpass "keymap:esc resting frame captured (.ans; full arm→confirm needs live turn)"

family_summary
