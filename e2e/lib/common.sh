#!/usr/bin/env bash
# Shared helpers for the dsh-opentui e2e scenarios: assertion primitives with
# per-scenario counters, tmux driving (a real PTY) around the opentui client
# boot, and the UI marker strings asserted across the suite. Sourced by each
# scenario script; $0 is still the scenario, so the result file derives from
# its basename.
#
# All state lives inside the container (~/.dsh of the image user) — nothing
# here touches host configuration.
#
# MODE CHOICE (v1): the container boots the PLUGIN path — the globally
# installed launcher `dsh-opentui` (bin/dsh-opentui.mjs), which injects
# node's --experimental-ffi into NODE_OPTIONS and execs
# `dsh --profile dsh-opentui` (the dist-host plugin under the node runtime).
# Client mode (`bun src/client-entry.tsx`) needs bun + the full workspace and
# is out of scope for the container image; the goal is mode-agnostic —
# "the same cases pass on opentui". Node >= 26.4 is a hard requirement of
# the plugin path (OpenTUI's native core needs --experimental-ffi; node 22
# rejects the flag as a bad option).

# --- identity / counters ----------------------------------------------------
SCENARIO="$(basename "$0" .sh)"
RESULTS_DIR="${RESULTS_DIR:-/tmp/e2e-results}"
mkdir -p "$RESULTS_DIR"
PASS=0 FAIL=0 WARN=0

scenario() { printf '\n=== [%s] %s ===\n' "$SCENARIO" "$*"; }
ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$*"; }
bad()  { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$*"; }
warn() { WARN=$((WARN + 1)); printf '  warn %s\n' "$*"; }
info() { printf '  [info] %s\n' "$*"; }

summary() {
  printf '%d %d %d\n' "$PASS" "$FAIL" "$WARN" >"$RESULTS_DIR/$SCENARIO.result"
  printf '  -- %s: %d pass, %d fail, %d warn\n' "$SCENARIO" "$PASS" "$FAIL" "$WARN"
}

# --- assertions -------------------------------------------------------------
assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    ok "$label"
    return 0
  fi
  bad "$label (substring not found: $needle); haystack tail:"
  printf '%s\n' "$haystack" | tail -6 | sed 's/^/    | /'
  return 1
}

assert_not_contains() {
  local label="$1" needle="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    bad "$label (substring still present: $needle); haystack tail:"
    printf '%s\n' "$haystack" | tail -6 | sed 's/^/    | /'
    return 1
  fi
  ok "$label"
  return 0
}

assert_matches() {
  local label="$1" ere="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -qE -- "$ere"; then
    ok "$label"
    return 0
  fi
  bad "$label (ERE not matched: $ere); haystack tail:"
  printf '%s\n' "$haystack" | tail -6 | sed 's/^/    | /'
  return 1
}

# --- UI markers (derived from a REAL boot capture inside the container, then
# --- kept in sync with the sources noted) ------------------------------------
# Composer placeholder — tui-base session-composer.tsx default placeholder.
MARKER_COMPOSER_PLACEHOLDER='Type a message (enter send, alt+enter newline)'
# Composer hint line, painted under the placeholder.
MARKER_COMPOSER_HINT='enter send · alt+enter newline · ↑↓ history'
# Powerline segments — install-profile.mjs pins the default provider/model
# into cordis.patch.yml; the footer paints them via sessionFooterSegments.
MARKER_PROVIDER_SEG='zai-coding-cn'
MARKER_MODEL_SEG='glm-5.3-flash'
# Powerline brand segment word (powerline.tsx brandSegment text: "dsh").
# Asserting "dsh" alone is too generic (transcript rows say dsh too), and the
# inter-segment separator glyph collapses to an unpredictable number of
# spaces under capture-pane, so the stable powerline pairing asserted from
# the real capture is the model segment's emoji prefix + id.
MARKER_MODEL_SEG_POWERLINE='🤖 glm-5.3-flash'

# --- tmux session -------------------------------------------------------------
TS=dsh-opentui-e2e
# Geometry is env-overridable (same rule as the dsh-tui-pi harness).
TUI_COLS="${TUI_COLS:-140}"
TUI_ROWS="${TUI_ROWS:-36}"

capture() { tmux capture-pane -t "$TS" -p 2>/dev/null; }
capture_sgr() { tmux capture-pane -t "$TS" -p -e 2>/dev/null; }
send() { tmux send-keys -t "$TS" "$@"; }
pane_command() { tmux display-message -p -t "$TS" '#{pane_current_command}' 2>/dev/null; }

tui_alive() {
  tmux has-session -t "$TS" 2>/dev/null \
    && [[ "$(pane_command)" != bash ]]
}

start_tui() {
  local env_prefix="${1:-}"
  tmux kill-session -t "$TS" 2>/dev/null || true
  sleep 0.3
  # -c pins the pane shell (and thus the boot cwd) to the image WORKDIR —
  # the runner's cd into e2e/scenarios must not leak into the session cwd.
  tmux new-session -d -s "$TS" -x "$TUI_COLS" -y "$TUI_ROWS" -c /app
  # The launcher injects --experimental-ffi and execs dsh --profile
  # dsh-opentui; the profile itself is baked into the image by the
  # Containerfile (install-profile.mjs --dep file:/dist/...).
  tmux send-keys -t "$TS" "${env_prefix:+$env_prefix }dsh-opentui" Enter
}

wait_tui_up() {
  local timeout="${1:-120}" waited=0 pane
  while (( waited < timeout )); do
    pane="$(capture)"
    if printf '%s' "$pane" | grep -qF -- "$MARKER_COMPOSER_PLACEHOLDER" \
      && printf '%s' "$pane" | grep -qF -- "$MARKER_PROVIDER_SEG"; then
      sleep 2 # let the view finish its first full paint (powerline + clock)
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  bad "TUI did not come up within ${timeout}s; last pane tail:"
  capture | tail -12 | sed 's/^/    | /'
  return 1
}

# Poll until an ERE appears in the pane (records the verdict itself).
wait_pane() {
  local label="$1" timeout="$2" ere="$3" waited=0
  while (( waited < timeout )); do
    if capture | grep -qE -- "$ere"; then
      ok "$label"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  bad "$label (timed out after ${timeout}s); haystack tail:"
  capture | tail -8 | sed 's/^/    | /'
  return 1
}

# Poll until a fixed string appears (no keypresses sent — bytes already in
# the pane's tty buffer are expected to be consumed by the app eventually).
wait_pane_fixed() {
  local label="$1" timeout="$2" needle="$3" waited=0
  while (( waited < timeout )); do
    if capture | grep -qF -- "$needle"; then
      ok "$label"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  bad "$label (timed out after ${timeout}s); haystack tail:"
  capture | tail -8 | sed 's/^/    | /'
  return 1
}

# Close the slash palette with Escape, retrying until the palette rows are
# gone AND the composer placeholder is back (Escape presses land
# unreliably; see above).
#
# Batch V5 note: the composer no longer remounts on every clock tick, so
# the buffer now SURVIVES the palette's Esc close (pre-fix the remount
# wiped it, which is how the placeholder used to "come back" on its own).
# When the rows are gone but the placeholder is still absent, the buffer
# keeps leftover text — clear it with spaced backspaces (input-law safe:
# single spaced keystrokes) until the placeholder returns.
esc_until_placeholder() {
  local label="$1" timeout="$2" waited=0 pane
  while (( waited < timeout )); do
    pane="$(capture)"
    if printf '%s' "$pane" | grep -qF -- "$MARKER_COMPOSER_PLACEHOLDER" \
      && ! printf '%s' "$pane" | grep -qF -- '/help show available commands' \
      && ! printf '%s' "$pane" | grep -qF -- '/quit exit the app'; then
      ok "$label"
      return 0
    fi
    if printf '%s' "$pane" | grep -qF -- '/help show available commands' \
      || printf '%s' "$pane" | grep -qF -- '/quit exit the app'; then
      send Escape # palette still up: close it first
    else
      local _
      for _ in 1 2 3 4; do send BSpace; sleep 0.3; done # clear kept buffer
    fi
    sleep 1
    waited=$((waited + 1))
  done
  bad "$label (timed out after ${timeout}s); haystack tail:"
  capture | tail -8 | sed 's/^/    | /'
  return 1
}

# Poll until an ERE disappears (no keypresses sent).
wait_gone() {
  local label="$1" timeout="$2" ere="$3" waited=0
  while (( waited < timeout )); do
    if ! capture | grep -qE -- "$ere"; then
      ok "$label"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  bad "$label (still present after ${timeout}s)"
  return 1
}

esc_until_gone() {
  local label="$1" ere="$2" attempt
  for attempt in 1 2 3 4 5 6; do
    send Escape
    sleep 1.5
    if ! capture | grep -qE -- "$ere"; then
      ok "$label"
      return 0
    fi
  done
  bad "$label (still up after 6 Esc presses); stuck pane:"
  capture | sed 's/^/    STUCK| /'
  return 1
}

# Make sure the slash-command editor is focused and empty, PROVEN through the
# palette mirror — never through a composer-value echo. The composer value row
# has the known stale-render issue in-container (docs/upstream-opentui-paint-
# bug-draft.md family), while the palette repaints reliably on keystrokes and
# mirrors the composer buffer exactly (scenario 20's discipline). Derived from
# real container captures:
#
#   - Text must land as ONE tmux write (send '/quit') and FROM A CLOSED
#     palette: any text append while the palette is really open breaks the
#     palette/buffer (rows vanish, buffer state undefined). Single keystrokes
#     (Escape, spaced backspaces) are fine while it is open.
#   - Backspaces sent as a no-sleep flood drain ASYNCHRONOUSLY (a late
#     backlog can eat keys typed seconds later) — always space them.
#
# Flow per attempt:
#   1. Escape closes any overlay/palette; spaced blind backspaces clear
#      leftovers (no-op on an empty buffer).
#   2. ECHO proof: '/quit' (one write) must list the '/quit' row.
#   3. CLEAR proof: spaced backspaces + a trailing '/' must restore the
#      unfiltered list ('/help' row back) — any leftover text would swallow
#      the '/' into a non-matching query with NO /help row.
#   4. One more spaced backspace (buffer '' again, palette closes) + Escape,
#      so callers start from a clean, empty, overlay-free editor.
ensure_editor_ready() {
  local label="$1" attempt
  for attempt in 1 2; do
    send Escape
    sleep 0.6
    for _ in $(seq 1 12); do send BSpace; sleep 0.25; done
    send '/quit'
    if wait_pane_fixed "$label: echo (/quit row listed)" 10 '/quit exit the app'; then
      for _ in $(seq 1 8); do send BSpace; sleep 0.3; done
      send '/'
      if wait_pane_fixed "$label: clear (trailing / lists all commands)" 12 \
        '/help show available commands'; then
        send BSpace
        sleep 0.4
        send Escape
        sleep 0.6
        return 0
      fi
    fi
  done
  bad "$label (palette mirror did not round-trip)"
  return 1
}

# Quit via the /quit slash command (commands.ts registers /quit — exits with
# process.exit(0)), falling back to Ctrl+C presses and then Ctrl+D.
#
# KNOWN LIMITATION (v1): inside the current container image none of these
# paths has been observed to exit the app — Enter/Ctrl+C/Ctrl+D presses are
# not reliably reaching the composer submit path (same family as the
# upstream paint/input bugs in docs/upstream-opentui-paint-bug-draft.md).
# Scenario 20 therefore does not assert quit; runners clean up with
# kill_tui() and the container's own lifecycle reaps everything at exit.
# Revisit when the upstream fix lands.
quit_tui() {
  local label="$1" waited=0
  send '/quit'
  sleep 0.4
  send Enter
  while (( waited < 8 )); do
    if [[ "$(pane_command)" == bash ]] && capture | grep -q 'root@'; then
      ok "$label"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  info "/quit did not quit — falling back to Ctrl+C x2"
  send C-c
  sleep 0.3
  send C-c
  waited=0
  while (( waited < 6 )); do
    if [[ "$(pane_command)" == bash ]]; then
      warn "$label (needed the Ctrl+C fallback)"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  info "Ctrl+C x2 did not quit — falling back to Ctrl+D"
  send C-d
  waited=0
  while (( waited < 6 )); do
    if [[ "$(pane_command)" == bash ]]; then
      warn "$label (needed the Ctrl+D fallback)"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  bad "$label (TUI still running)"
  return 1
}

kill_tui() {
  if tmux has-session -t "$TS" 2>/dev/null; then
    send '/quit'
    sleep 0.4
    send Enter
    sleep 0.8
    send C-c
    sleep 0.4
    send C-d
    sleep 0.8
    tmux kill-session -t "$TS" 2>/dev/null || true
  fi
}
