#!/usr/bin/env bash
# v2 assertion primitives for the podman e2e suite.
#
# The v1 suite in lib/common.sh is string-grep based and counts a "degrade"
# copy (unknown command / not mounted / unavailable) as a PASS. Under the v2
# criteria (0234-fix-design-v3.md §6) that is not acceptable:
#
#   A 真缺陷  — feature is broken, must be fixed (expected PASS, so a FAIL here
#               is a real defect, not an accepted degradation).
#   B 判据错误 — the old check proved the wrong thing; attach the wrong and the
#               correct criterion verbatim, do not "fix" the feature.
#   C 预期行为 — expected behaviour, a plain PASS is fine.
#
#   L1 有响应      — the app reacts at all (dialog/panel/echo appears).
#   L2 状态真变    — a real state field changes (frame/selector/store).
#   L3 模型可感知  — the injected content reaches the model side (mock log).
#
#   Silent no-op is ALWAYS FAIL, even when the feature is statically predicted
#   unavailable. A feature being absent is a defect to report, not a SKIP.
#   SKIP is reserved for gates that cannot be exercised in this checkout (e.g.
#   a source bundle predating the feature), and is always listed in report.md.
#
# Source AFTER lib/common.sh — this file reuses ok/bad/capture/send and the
# result counters. When sourced standalone (syntax checks, dry runs) the
# missing helpers are stubbed so the primitives stay callable.
set -u

V2_RESULTS_DIR="${RESULTS_DIR:-/tmp/e2e-results}"
V2_ITEMS="$V2_RESULTS_DIR/v2-items.tsv"
V2_PASS=0
V2_FAIL=0
V2_SKIP=0

# Current geometry label, stamped onto every item recorded while it is set.
V2_SIZE="${V2_SIZE:-${TUI_COLS:-140}x${TUI_ROWS:-36}}"
# Geometries exercised by key/panel scenarios (wide threshold straddled).
V2_SIZES="${V2_SIZES:-120x40 200x50}"

# Degradation copy that must never be accepted as a PASS. Configurable per
# scenario: override V2_DEGRADE_ERE before calling assert_no_degrade. Kept as
# an ERE so a scenario can add its own localized strings.
V2_DEGRADE_ERE="${V2_DEGRADE_ERE:-unavailable|degraded|not[ -]mounted|no models in the catalog|unknown command:|is a no-op|not supported|unsupported}"

if ! declare -F capture >/dev/null 2>&1; then capture() { :; }; fi
if ! declare -F ok >/dev/null 2>&1; then ok() { printf '  ok   %s\n' "$*"; }; fi
if ! declare -F bad >/dev/null 2>&1; then bad() { printf '  FAIL %s\n' "$*"; }; fi

# --- item ledger (drives report.md) ------------------------------------------
v2_init() {
  mkdir -p "$V2_RESULTS_DIR"
  if [ ! -f "$V2_ITEMS" ]; then
    printf 'scenario\tmatrix\tclass\tlevel\tverdict\tname\tsize\twrong\tfact\tdetail\n' >"$V2_ITEMS"
  fi
}

# TSV-safe field: collapse tabs/newlines so a multi-line haystack can never
# break the report parser.
v2_field() { printf '%s' "$1" | tr '\t\n\r' '   ' | sed 's/  */ /g'; }

# v2_record <matrix-id> <A|B|C> <L1|L2|L3> <PASS|FAIL|SKIP> <name> \
#           [wrong-criterion] [correct-criterion] [detail]
# One row per assertion. B-class rows MUST carry both criteria (§6 rule).
v2_record() {
  local matrix="$1" class="$2" level="$3" verdict="$4" name="$5"
  local wrong="${6:-}" correct="${7:-}" detail="${8:-}"
  case "$class" in A|B|C) ;; *) class='A' ;; esac
  case "$level" in L1|L2|L3) ;; *) level='L1' ;; esac
  case "$verdict" in
    PASS) V2_PASS=$((V2_PASS + 1)) ;;
    FAIL) V2_FAIL=$((V2_FAIL + 1)) ;;
    SKIP) V2_SKIP=$((V2_SKIP + 1)) ;;
  esac
  v2_init
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(v2_field "${SCENARIO:-scenario}")" "$(v2_field "$matrix")" \
    "$(v2_field "$class")" "$(v2_field "$level")" "$(v2_field "$verdict")" \
    "$(v2_field "$name")" "$(v2_field "$V2_SIZE")" "$(v2_field "$wrong")" \
    "$(v2_field "$correct")" "$(v2_field "$detail")" >>"$V2_ITEMS"
  printf '  v2-%s [%s %s/%s] %s\n' "$verdict" "$matrix" "$class" "$level" "$name"
}

# --- assertion primitives ----------------------------------------------------

# assert_frame_has <regex> [label] [timeout] [matrix-id] [class] [level] \
#                  [wrong-criterion] [correct-criterion]
# Content polling: the regex appearing at ANY poll wins. Deliberately does NOT
# use "two identical captures" — during a busy turn elapsed/spinner/token make
# every frame differ (0234-fix-design-v3.md P1.3).
assert_frame_has() {
  local ereg="$1" label="${2:-frame matches $1}" timeout="${3:-20}"
  local matrix="${4:-}" class="${5:-C}" level="${6:-L1}"
  local wrong="${7:-}" correct="${8:-}" waited=0 frame=''
  v2_init
  while (( waited < timeout )); do
    frame="$(capture)"
    if printf '%s\n' "$frame" | grep -qE -- "$ereg"; then
      ok "$label"
      v2_record "$matrix" "$class" "$level" PASS "$label" "$wrong" "$correct" \
        "regex=$ereg matched at poll $waited"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  bad "$label (regex not seen within ${timeout}s: $ereg); haystack tail:"
  capture | tail -8 | sed 's/^/    | /'
  v2_record "$matrix" "$class" "$level" FAIL "$label" "$wrong" "$correct" \
    "regex=$ereg absent after ${timeout}s"
  return 1
}

# assert_log_has <regex> <logfile> [label] [timeout] [matrix-id] [class] [level] \
#               [wrong-criterion] [correct-criterion]
# L3 model-side proof: the injected content reached the mock's request stream.
assert_log_has() {
  local ereg="$1" logfile="$2" label="${3:-log matches $1}" timeout="${4:-20}"
  local matrix="${5:-}" class="${6:-A}" level="${7:-L3}"
  local wrong="${8:-}" correct="${9:-}" waited=0
  v2_init
  while (( waited < timeout )); do
    if [ -f "$logfile" ] && grep -qE -- "$ereg" "$logfile"; then
      ok "$label"
      v2_record "$matrix" "$class" "$level" PASS "$label" "$wrong" "$correct" \
        "log=$logfile regex=$ereg matched at poll $waited"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  bad "$label (log regex not seen within ${timeout}s: $ereg); log tail:"
  tail -6 "$logfile" 2>/dev/null | sed 's/^/    | /'
  v2_record "$matrix" "$class" "$level" FAIL "$label" "$wrong" "$correct" \
    "log=$logfile regex=$ereg absent after ${timeout}s"
  return 1
}

# assert_no_degrade <frame> [label] [matrix-id] [class] [level] [blacklist-ere]
# <frame> is a captured frame string; pass '-' to capture a fresh one. The
# blacklist is configurable (V2_DEGRADE_ERE by default) and a hit is a FAIL.
assert_no_degrade() {
  local frame="$1" label="${2:-frame carries no degrade copy}" matrix="${3:-}"
  local class="${4:-C}" level="${5:-L1}" blacklist="${6:-$V2_DEGRADE_ERE}"
  [ "$frame" = '-' ] && frame="$(capture)"
  v2_init
  local hit
  hit="$(printf '%s\n' "$frame" | grep -oiE -- "$blacklist" | sort -u | tr '\n' ',')"
  if [ -n "$hit" ]; then
    bad "$label (degrade copy present: ${hit%,}); haystack tail:"
    printf '%s\n' "$frame" | tail -8 | sed 's/^/    | /'
    v2_record "$matrix" "$class" "$level" FAIL "$label" '' '' \
      "degrade-copy=$hit"
    return 1
  fi
  ok "$label"
  v2_record "$matrix" "$class" "$level" PASS "$label" '' '' \
    "blacklist=$blacklist clean"
  return 0
}

# assert_state_change <label> <before> <after> [matrix-id] [class] [level] [expect-ere]
# A silent no-op (before == after) is a FAIL. When expect-ere is supplied the
# after-state must also match it (L2 proof of the intended new state).
assert_state_change() {
  local label="$1" before="$2" after="$3" matrix="${4:-}"
  local class="${5:-A}" level="${6:-L2}" expect="${7:-}"
  v2_init
  if [ "$before" = "$after" ]; then
    bad "$label (state did not change — silent no-op)"
    v2_record "$matrix" "$class" "$level" FAIL "$label" '' '' \
      'before == after (silent no-op)'
    return 1
  fi
  if [ -n "$expect" ] && ! printf '%s\n' "$after" | grep -qE -- "$expect"; then
    bad "$label (frame changed but the expected state is absent: $expect)"
    printf '%s\n' "$after" | tail -8 | sed 's/^/    | /'
    v2_record "$matrix" "$class" "$level" FAIL "$label" '' '' \
      "changed but regex=$expect absent"
    return 1
  fi
  ok "$label"
  v2_record "$matrix" "$class" "$level" PASS "$label" '' '' \
    "before != after${expect:+; regex=$expect matched}"
  return 0
}

# assert_exit_code <label> <expected-ere> <frame> [matrix-id] [class] [level]
# Opt-in exit-code proof: start_tui with E2E_CAPTURE_EXIT=1 appends an
# `__DSH_E2E_EXIT=<n>` line to the pane when the client returns to the shell.
assert_exit_code() {
  local label="$1" expected="$2" frame="$3" matrix="${4:-}"
  local class="${5:-A}" level="${6:-L2}" ereg="__DSH_E2E_EXIT=(${expected})"
  v2_init
  # A freshly captured frame may already carry the marker (the common case
  # after /quit). Honour the supplied frame first; otherwise poll the live pane.
  if printf '%s\n' "$frame" | grep -qE -- "$ereg"; then
    ok "$label"
    v2_record "$matrix" "$class" "$level" PASS "$label" '' '' \
      "exit marker matched in supplied frame: $ereg"
    return 0
  fi
  assert_frame_has "$ereg" "$label" 15 "$matrix" "$class" "$level"
}

# v2_skip <matrix-id> <name> <reason> [wrong-criterion] [correct-criterion]
# Gate-dark / unexercisable items: never a PASS, always listed in report.md.
v2_skip() {
  local matrix="$1" name="$2" reason="$3" wrong="${4:-}" correct="${5:-}"
  v2_init
  v2_record "$matrix" 'B' 'L1' SKIP "$name" "$wrong" "$correct" "$reason"
  printf '  SKIP %s — %s\n' "$name" "$reason"
}

# --- geometry ----------------------------------------------------------------
v2_set_size() {
  V2_SIZE="$1"
  local cols="${1%x*}" rows="${1#*x}"
  if declare -F resize_tui_to >/dev/null 2>&1; then
    resize_tui_to "$cols" "$rows"
  elif command -v tmux >/dev/null 2>&1; then
    tmux resize-window -t "${TS:-dsh-opentui-e2e}" -x "$cols" -y "$rows" 2>/dev/null || true
  fi
}

# v2_each_size <callback> [sizes-string]
# Runs the callback once per geometry, stamping V2_SIZE onto every item it
# records. The callback name is passed (not eval'd) to keep quoting safe.
v2_each_size() {
  local callback="$1" sizes="${2:-$V2_SIZES}" size
  for size in $sizes; do
    printf '\n  -- geometry %s --\n' "$size"
    v2_set_size "$size"
    sleep 2
    "$callback" "$size"
  done
}

# --- isolation helpers -------------------------------------------------------
# Deterministic per-scenario scratch home. The default runner is sequential,
# so mock-backed scenarios keep the shared baked profile; E2E_ISOLATED=1 makes
# run-all.sh export a distinct home per scenario (see run-all.sh).
v2_scoped_home() {
  local root="${E2E_SCRATCH_ROOT:-/tmp/e2e-scratch}"
  printf '%s/%s' "$root" "${1:-${SCENARIO:-scenario}}"
}

# Deterministic per-slot port. Used with MOCK_BASE_URL when a scenario gets its
# own profile bake; the mock port baked into the profile is 8642 by default.
v2_scoped_port() {
  local base="${E2E_PORT_BASE:-8642}"
  printf '%d' "$((base + ${1:-0}))"
}

# Tear down this scenario's processes: TUI + resident host + mocks + tmux.
v2_teardown() {
  if declare -F kill_tui >/dev/null 2>&1; then kill_tui; fi
  if declare -F kill_tui_procs >/dev/null 2>&1; then kill_tui_procs; fi
  if declare -F kill_pats >/dev/null 2>&1 && [ -n "${MOCK_PATS:-}" ]; then
    # shellcheck disable=SC2086
    kill_pats $MOCK_PATS
  fi
  tmux kill-server 2>/dev/null || true
}

v2_summary() {
  printf '  -- v2: %d pass, %d fail, %d skip\n' "$V2_PASS" "$V2_FAIL" "$V2_SKIP"
  printf '%d %d %d\n' "$V2_PASS" "$V2_FAIL" "$V2_SKIP" \
    >"$V2_RESULTS_DIR/${SCENARIO:-scenario}.v2.result"
}
