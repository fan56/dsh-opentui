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
# MODE CHOICE (batch B5): the container boots the CLIENT face only — the
# repo-root `./dsh-opentui` launcher execs `bun --preload ...
# client-entry.tsx` (the bun TUI), which spawns/joins the resident
# `dsh --profile opentui` host through the single-instance lifecycle. The
# plugin face (the TUI running as a cordis plugin inside the dsh host) is
# retired — ADR-0005, batch B4 removed the --plugin chain and batch B5
# removed the e2e face's plugin layers. E2E_FACE=client is the default;
# E2E_FACE=plugin is rejected outright.

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

# --- process-table hygiene (C14) -----------------------------------------------
# Cross-scenario cascade isolation. Empirical baseline (C13 batch): the shared
# container run failed 7 assertions across 30/40/66 while the same scenarios
# were green standalone — a failed/timed-out scenario leaves live processes
# that poison the next one:
#   - the TUI node process. 10 of 15 scenarios end WITHOUT kill_tui, and the
#     in-container quit paths are unreliable (quit_tui KNOWN LIMITATION), so
#     the next scenario's start_tui relied on the kill-session SIGHUP — which
#     does not reliably terminate the node process. The orphan keeps running
#     (spinning on its dead pty, retrying the mock endpoint) alongside the
#     next scenario's fresh boot.
#   - the mock servers (mock-llm.mjs / mock-jev.mjs). Each scenario kills its
#     own mock via a trap, but an orphaned earlier one holds :8642 so the next
#     scenario's mock dies with EADDRINUSE while the health check still passes
#     against the OLD mock (whose request-keyed phases differ) — the scenario
#     then waits forever for a phase the old mock never serves.
#
# Verified cmdlines (live container boot, client face): the TUI is the bun
# client (`bun ... client-entry.tsx`) with its resident host
# `dsh --profile opentui --no-open --port <n>` (node, global dsh closure);
# mocks are `node .../mock-llm.mjs --port ...` / `mock-jev.mjs`. None of the
# patterns below can match a scenario's own cmdline (`bash ./NN-*.sh`) or the
# tmux server (`tmux new-session -d -s dsh-opentui-e2e ...`).
TUI_PAT1='dsh --profile opentui'
TUI_PAT2='client-entry.tsx'
MOCK_PATS='mock-llm.mjs mock-jev.mjs'

# Face identity (batch B5): client only. The opentui profile lives under the
# scratch DSH_HOME (start_tui / ensure_client_profile provisions it).
# Scenarios that read the profile's config.json store (/theme, /agents,
# /preset persistence) use FACE_CFG instead of a hardcoded path.
E2E_FACE="${E2E_FACE:-client}"
if [ "$E2E_FACE" != client ]; then
  printf 'ERROR: E2E_FACE=%s is retired (the --plugin mode chain was removed in batch B4); the suite runs the client face only.\n' "$E2E_FACE" >&2
  exit 1
fi
CLIENT_DSH_HOME=/tmp/client-dsh
FACE_HOME="$CLIENT_DSH_HOME"
FACE_PROFILE=opentui
FACE_CFG="$FACE_HOME/profiles/$FACE_PROFILE/config.json"
# Evidence/store paths for the scenarios: the patch layer the /login commit
# and the policy staging write into, and the agents + sessions stores the
# running host reads — all under the scratch DSH_HOME, never the image's
# baked /root/.dsh.
FACE_PATCH="$FACE_HOME/profiles/$FACE_PROFILE/cordis.patch.yml"
FACE_AGENTS_DIR="$FACE_HOME/agents"
FACE_SESSIONS_DIR="$FACE_HOME/sessions"
CLIENT_TUI_PAT="$TUI_PAT2"
CLIENT_HOST_PAT="$TUI_PAT1"

in_e2e_container() { [ -d /e2e/scenarios ]; }

# Kill processes matching the given patterns: SIGTERM, wait up to ~3s for the
# process table to clear, then SIGKILL. Waiting matters: a mock still dying
# holds :8642/:8643 and the next bind would race.
kill_pats() {
  local pat alive waited
  for pat in "$@"; do pkill -f "$pat" 2>/dev/null || true; done
  for waited in 1 2 3 4 5 6 7 8 9 10 11 12; do
    alive=0
    for pat in "$@"; do pgrep -f "$pat" >/dev/null 2>&1 && alive=1; done
    if (( alive == 0 )); then return 0; fi
    sleep 0.25
  done
  for pat in "$@"; do pkill -9 -f "$pat" 2>/dev/null || true; done
  sleep 0.5
}

kill_tui_procs() {
  in_e2e_container || return 0
  # shellcheck disable=SC2086
  kill_pats "$TUI_PAT1" "$TUI_PAT2"
}

# Full pre-scenario reset: leftover TUI + leftover mocks + the tmux server.
# Container-gated: this lib may be sourced on a host (scenarios carry host
# guards) and must never touch host processes.
reset_e2e_state() {
  in_e2e_container || return 0
  # shellcheck disable=SC2086
  kill_pats "$TUI_PAT1" "$TUI_PAT2" $MOCK_PATS
  tmux kill-server 2>/dev/null || true
  sleep 0.3
}

# Run at source time — i.e. once per scenario, before its body: everything the
# previous scenario left behind dies here, before this scenario starts its own
# mocks or boots its own TUI. (The previous scenario cannot fully clean up
# after itself: its EXIT trap kills only its own mock PIDs, and an EXIT trap
# registered here would be clobbered by the scenarios' own traps.)
reset_e2e_state

# (Batch B5: the former per-face skip gate for 10-install is gone — the
# scenario was rewritten as the npm client-package install verification and
# runs on the client face like every other scenario.)

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

# Provision + bake the CLIENT face's scratch opentui profile WITHOUT booting:
# the same steps start_tui's client branch runs, factored out for scenarios
# whose mock-endpoint/bundle gates fire BEFORE the first start_tui on a fresh
# container (the scratch profile does not exist until something provisions
# it). Idempotent; the pnpm install is guarded on the registry dep so it runs
# once per container.
ensure_client_profile() {
  if [ ! -f "$FACE_PATCH" ]; then
    DSH_HOME="$FACE_HOME" node /src/packages/shell/scripts/provision-opentui-profile.mjs || return 1
  fi
  # Each bake is probed INDEPENDENTLY. They used to ride one guard keyed on
  # the registry dep, so a scenario that had already installed the registry
  # (62 runs before 65/70) silently skipped the jev chain bake and later
  # scenarios saw "dsh-agent-dispatch missing" — a harness fault, not a
  # product gap.
  local profile_pkg="$FACE_HOME/profiles/$FACE_PROFILE/package.json" baked=0
  if ! grep -qF '@aiwayds/dsh-subagent-registry' "$profile_pkg" 2>/dev/null; then
    DSH_HOME="$FACE_HOME" MOCK_PROFILE=opentui node /e2e/lib/bake-subagent-registry.mjs || return 1
    baked=1
  fi
  if ! grep -qF '@aiwayds/dsh-agent-dispatch' "$profile_pkg" 2>/dev/null; then
    DSH_HOME="$FACE_HOME" MOCK_PROFILE=opentui node /e2e/lib/bake-jev-chain.mjs || return 1
    baked=1
  fi
  if (( baked )); then
    pnpm --dir "$FACE_HOME/profiles/$FACE_PROFILE" install \
      --registry="${E2E_NPM_REGISTRY:-https://registry.npmjs.org}" || return 1
  fi
  DSH_HOME="$FACE_HOME" MOCK_PROFILE=opentui node /e2e/lib/bake-mock-endpoint.mjs || return 1
}

start_tui() {
  local env_prefix="${1:-}"
  if in_e2e_container; then
    # C14: never boot beside a leftover TUI — mid-scenario reboots (62/65/67/70)
    # would otherwise stack a second live dsh on the orphaned first one.
    kill_tui_procs
    tmux kill-server 2>/dev/null || true
  else
    tmux kill-session -t "$TS" 2>/dev/null || true
  fi
  sleep 0.3
  # -c pins the pane shell (and thus the boot cwd) to the image WORKDIR —
  # the runner's cd into e2e/scenarios must not leak into the session cwd.
  tmux new-session -d -s "$TS" -x "$TUI_COLS" -y "$TUI_ROWS" -c /app
  # CLIENT face (the only face since batch B5): scratch DSH_HOME (never the
  # image's baked /root/.dsh) + the `opentui` host profile (idempotent
  # provision from the workspace snapshot; global dsh resolves the template)
  # + the mock baseURL baked into that profile's patch layer. The launcher
  # (SCRIPT_DIR-relative, /src/dsh-opentui) execs bun client-entry.tsx and
  # ensureHost pulls up the resident host, all inside this tmux pane with
  # DSH_HOME inherited.
  export DSH_HOME="$CLIENT_DSH_HOME"
  # Batch-1 seg4: provision + bake the scratch profile's subagent-use
  # bundles (registry = use_agent's home; dispatch/jev-core = the jev
  # chain) + the mock endpoint before the boot. See ensure_client_profile.
  ensure_client_profile || return 1
  tmux send-keys -t "$TS" "${env_prefix:+env $env_prefix }DSH_HOME=$CLIENT_DSH_HOME /src/dsh-opentui" Enter
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

# `… N more` — the palette's reserved overflow row (slash-palette.tsx
# overflowHint), painted whenever the query matches more than MAX_ROWS (10).
# The registered command set is 20+, so an unfiltered palette always carries
# it; a narrowed query may not.
PALETTE_OVERFLOW_ERE='… [0-9]+ more'

# True when the slash palette is painted somewhere in the pane. Deliberately
# does NOT require a specific row: the palette sorts usage DESC then name, so
# on a profile where ten commands were dispatched any fixed row (/help,
# /quit) can sit outside the 10-row window. The overflow hint is the
# position-independent signal.
palette_visible_in() {
  printf '%s' "$1" | grep -qE -- "$PALETTE_OVERFLOW_ERE|/help show available commands|/quit exit the app"
}

# Poll until the UNFILTERED command list is painted: either the /help row
# (short list / fresh profile) or the `… N more` overflow row (a full 20+
# command list under usage ordering). Used as the "buffer is empty and the
# trailing '/' re-opened the whole list" proof — any leftover text would
# swallow the '/' into a non-matching (or narrowed) query with neither
# signal.
wait_palette_unfiltered() {
  local label="$1" timeout="$2" waited=0 pane
  while (( waited < timeout )); do
    pane="$(capture)"
    if printf '%s' "$pane" | grep -qF -- '/help show available commands' \
      || printf '%s' "$pane" | grep -qE -- "$PALETTE_OVERFLOW_ERE"; then
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
      && ! palette_visible_in "$pane"; then
      ok "$label"
      return 0
    fi
    if palette_visible_in "$pane"; then
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
#      unfiltered list (the `… N more` overflow row, or the '/help' row on a
#      short list) — any leftover text would swallow the '/' into a
#      non-matching query with no such signal.
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
      if wait_palette_unfiltered "$label: clear (trailing / lists all commands)" 12; then
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
  # C14: the kill-session SIGHUP does not reliably terminate the node process
  # (quit paths are unreliable in-container — quit_tui KNOWN LIMITATION), so
  # enforce the process death; otherwise the orphan spins against its dead
  # pty / the mock endpoint for the rest of the suite.
  kill_tui_procs
}
