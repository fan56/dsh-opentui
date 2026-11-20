#!/usr/bin/env bash
# Scenario t0-leader-keys — T0 gate, leader (ctrl+x) key group.
#
# Matrix (e2e-0233-c/matrix.md "leader 组"): KEY-15 <leader>x export,
# KEY-16 <leader>n new session, KEY-17 <leader>l session list,
# KEY-19 <leader>g timeline, KEY-21 <leader>q queue panel.
#
# Real-machine 0.23.3 result (C round): ALL FIVE FAIL — ctrl+x never enters the
# pending sequence; the follow-up key lands literally in the composer (7 send
# techniques tried; ctrl+c / ctrl+g on the same keymap work). This scenario
# encodes the v2 EXPECTED behaviour (PASS), so on the current build it must be
# RED. That is the point: a silent no-op is a FAIL, not an accepted degrade.
#
# All five are exercised at BOTH geometries (120x40 and 200x50) via
# v2_each_size; the size is stamped onto every report item.
set -u
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/assert-v2.sh"
scenario 'T0 leader keys (KEY-15/16/17/19/21) — expected PASS at 120x40 + 200x50'

if [ ! -d /e2e/scenarios ]; then
  v2_skip 'KEY-15' 'T0 leader keys' 'host environment detected — drives a live TUI; container only'
  warn 'host environment detected — skipping; container only'
  v2_summary
  summary
  exit 0
fi

start_tui
wait_tui_up 180 || { v2_summary; summary; exit 0; }
ensure_editor_ready 'editor ready before leader probes' || true

# <leader> = ctrl+x, follow-up within the 2000ms pending window. 120ms was one
# of the C-round intervals (all failed on 0.23.3), so it is a fair v2 probe.
leader_case() {
  local size="$1" id="$2" key="$3" name="$4" expect="$5" wrong="$6"
  local before after
  ensure_editor_ready "editor clean before $name ($size)" || true
  send Escape
  sleep 0.5
  before="$(capture)"
  send C-x
  sleep 0.12
  send "$key"
  sleep 2
  after="$(capture)"
  if assert_frame_has "$expect" "$name opens the real surface ($size)" 8 \
    "$id" A L2 "$wrong" "$expect present in pane after <leader>$key"; then
    assert_state_change "$name changes the frame ($size)" "$before" "$after" \
      "$id" A L2 "$expect"
  fi
  # Leave a clean editor / closed overlay for the next case.
  send Escape
  sleep 0.5
  esc_until_placeholder "editor restored after $name ($size)" 12 || true
}

leader_group() {
  local size="$1"

  leader_case "$size" 'KEY-15' x \
    '<leader>x export' \
    'export|[Ee]xported|\.jsonl' \
    'v1: no assertion (KEY-15 uncovered); literal x landing in composer would be accepted'

  leader_case "$size" 'KEY-16' n \
    '<leader>n new session' \
    'created|Created|new session' \
    'v1: no assertion (KEY-16 uncovered); literal n landing in composer would be accepted'

  leader_case "$size" 'KEY-17' l \
    '<leader>l session list' \
    'Resume session| Sessions|session list' \
    'v1: no assertion (KEY-17 uncovered); literal l landing in composer would be accepted'

  leader_case "$size" 'KEY-19' g \
    '<leader>g timeline' \
    '[Tt]imeline' \
    'v1: no assertion (KEY-19 uncovered); literal g landing in composer would be accepted'

  leader_case "$size" 'KEY-21' q \
    '<leader>q queue panel' \
    '[Qq]ueued|queue|⏸' \
    'v1: no assertion (KEY-21 uncovered); literal q landing in composer would be accepted'
}

v2_each_size leader_group

v2_teardown
v2_summary
summary
