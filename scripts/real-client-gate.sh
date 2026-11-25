#!/usr/bin/env bash
# 024 real-client gate — ONE repeatable recipe for the three slices whose
# real-machine items were BLOCKED (S1 /model, S2 account, SK keymap) plus the
# shared verify70 (64-item) gate.
#
#   scripts/real-client-gate.sh [--out DIR] [--boot-timeout SEC]
#                               [--keep] [--only smoke|frames|verify70|all]
#                               [--skip-env-check]
#                               [--self-test=precheck|helpers]
#
# Environment self-check (025 wave3 batch1, W5-CE clause 5): before ANY probe
# or tmux boot, scan for orphan dsh/mock-llm hosts and named tmux sessions
# that would race the gate (the 025-w1a 3/64 mass-red root cause). PID lists are
# written to $OUT/env-precheck.log and (after cleanup) $OUT/env-postcheck.log;
# POST-CHECK filters its own PIDs and re-verifies each PID before listing it
# (W2-1 C5: never report a bare grep count). An OPTIONAL single PID can be
# whitelist-excluded via the PROTECTED_PID env var (default empty); PIDs are
# volatile and non-portable, so this is a per-run aid, never a durable rule —
# the durable exclusion is by command-line pattern (dsh-jev-mcp, below).
# Historically PROTECTED_PID=98608 (dsh-jev-mcp) on the author's host.
# `--skip-env-check` is the documented escape hatch for known-clean hosts.
#
# 2026-11-25 gate-harness fix: self-exclusion walks the PPID ancestor chain up
# to (but NOT including) PID 1, the shared launchd terminal; an excluded
# ancestor is printed as EXCLUDED(self-ancestor) for audit. The executable is
# the argv[0] basename of the FULL `args` column (never macOS-truncated `comm`);
# exact argv follows the product classifyProcess shapes (node/bun/dsh,
# --profile X and --profile=X). An exact match is consumed first; only the
# un-matched host-like shapes (bun dsh, node --inspect) and bare dsh/mock tokens
# (`grep dsh`, flattened `bash -c ... dsh`) are WARN (audit). A REAL host/mock
# argv shape under an unknown runtime is BLOCK and counts in the verdict: dsh
# at arg 0/1 followed by --profile/--profile=, dsh at arg 2 ONLY under a known
# wrapper exe (env/sudo/arch/nice/command/time), and a mock script at arg 1
# followed by --port/--port=. A `bash`/`sh`/`zsh -c` whose argv merely echoes
# the pattern is WARN (audit), never BLOCK. Named tmux rc-gate-*/agents-mount-* sessions
# are ORPHAN tmux:<name> and count too; our own $SESS is always excluded (also
# under --keep). An O_EXCL hard-link lock FILE (CAS stale recovery with a
# PID+stamp claim) serializes sibling worktrees so a concurrent sibling mock is
# never mistaken for an orphan; an empty/failed ps snapshot is a HARD failure.
# GATE_LOCK_FILE env override applies ONLY to --self-test=* — a real gate always
# uses the shared default lock. No new orphan is whitelisted and NO EXTERNAL PROCESS OR ORPHAN IS EVER KILLED: the only termination is `tmux kill-session`
# for this gate's own session; `kill -0` is only a liveness probe. Orphans are
# reported and refused, never killed. --keep retains an owned host past this run
# and is therefore incompatible with a concurrent gate (run gates serially). The
# mutex is released on EXIT/INT/TERM/HUP via an idempotent cleanup that disarms
# signal traps on its first line (a second signal cannot skip the release).
#
# What it does (all writes to a FRESH scratch DSH_HOME; ~/.dsh is never touched):
#   1. preflight — dsh / node / bun / tmux / launcher / shipped bridge present
#   2. fresh scratch DSH_HOME — run the real in-process provisioner with
#      --repair (no reads from ~/.dsh); it creates the active profile, copies
#      THIS checkout's dist/bridge and grants the host-version exemption
#   3. handshake smoke — spawn `dsh --profile <DEFAULT_PROFILE>` with
#      DSH_OPENTUI_BRIDGE_STDIO=1, send bridge.hello, require a framed reply
#   4. tmux boot the TUI against that scratch home, wait until the composer
#      input box paints (the .ans "输入框" readiness criterion)
#   5. capture .ans frames (tmux `capture-pane -e -p`, NUMERIC ANSI only — no
#      PNG, no visual model): S1 /model, S2 account (/settings -> Account),
#      SK four keymap scenarios (modal / turn-Esc / panel-PgUp-PgDn / basic)
#   6. run the shared 64-item gate `verify/agents-mount-repro.mjs` (it now
#      self-provisions its own scratch home with the same recipe)
#   7. cleanup tmux session + scratch home; every failure dumps diagnostics
#      (last pane, client stderr, host probe stderr, env snapshot) and exits
#      non-zero.
#
# Idempotent: safe to re-run; each run uses a new scratch home/session and
# overwrites only its --out directory. CI-reusable: no dependency on the
# operator's ~/.dsh state.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER="$REPO/dsh-opentui"
PROVISIONER="$REPO/packages/shell/scripts/provision-inproc-profile.mjs"
BRIDGE_DIR="$REPO/packages/shell/dist/bridge"
PROFILE="$(node --input-type=module -e 'import { pathToFileURL } from "node:url"; const { DEFAULT_PROFILE } = await import(pathToFileURL(process.argv[1])); process.stdout.write(DEFAULT_PROFILE)' "$REPO/packages/shell/scripts/lib/profile-name.mjs")"
OUT="${OUT:-$REPO/.proof/real-client-gate}"
BOOT_TIMEOUT=90
KEEP=0
ONLY=all
SKIP_ENV_CHECK=0
SELF_TEST=""
# 025 wave3 final C-3: PID is volatile/non-portable — never hardcode it.
# Inject via env (e.g. PROTECTED_PID=98608 ./scripts/real-client-gate.sh ...).
# Default empty = no PID whitelist; the durable dsh-jev-mcp exclusion below is
# by command-line pattern, which survives restarts and machine changes.
PROTECTED_PID="${PROTECTED_PID:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --boot-timeout) BOOT_TIMEOUT="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --only) ONLY="$2"; shift 2 ;;
    --skip-env-check) SKIP_ENV_CHECK=1; shift ;;
    --self-test=*)
      SELF_TEST="${1#--self-test=}"
      case "$SELF_TEST" in
        precheck|helpers) ;;
        *) echo "unknown --self-test mode: $SELF_TEST (expected precheck|helpers)" >&2; exit 2 ;;
      esac
      shift
      ;;
    -h|--help) sed -n '2,62p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
if [ "$SELF_TEST" = precheck ] && [ "$SKIP_ENV_CHECK" -eq 1 ]; then
  echo "--self-test=precheck requires env checks (drop --skip-env-check)" >&2
  exit 2
fi
# R2e: an empty PROFILE would make every dsh matcher vacuous (`--profile=`
# matches everything) — a false-green, not a degraded run. HARD fail for every
# mode that runs env checks; `--skip-env-check` is the documented no-env escape
# hatch and intentionally does not resolve a profile (frozen A12 skip test).
if [ -z "$PROFILE" ] && [ "$SKIP_ENV_CHECK" -eq 0 ]; then
  printf '%s\n' "ERROR: DEFAULT_PROFILE resolved empty (check $REPO/packages/shell/scripts/lib/profile-name.mjs); refusing to run" >&2
  exit 2
fi
# RUN_LOG starts empty so --self-test=helpers has no filesystem side effects;
# the real run log is created only after the helper-only early return below.
RUN_LOG=""
log() {
  if [ -n "$RUN_LOG" ]; then printf '%s\n' "$*" | tee -a "$RUN_LOG"; else printf '%s\n' "$*"; fi
}
FAIL=0
fail() { FAIL=$((FAIL + 1)); log "FAIL  $*"; }
pass() { log "PASS  $*"; }

# --- environment self-check helpers (W5-CE clause 5) -----------------------
# "ours" = this shell OR ANY of its PPID ancestors up to launchd/PID 1. A
# wrapper whose command line echoes the match string must never be counted as
# an orphan (W2-1 C5); the old $$/$PPID-only check missed grandparent wrappers.
# Bounded by 64 hops so a corrupt/looped PPID chain cannot hang the gate.
# R2d: the ancestor set is constant for a process — walk the PPID chain ONCE
# and cache it, so scanning every ps row never re-walks it (no ps storm).
# PID 1 remains the terminal and is never cached as self (A14).
ENV_SELF_ANCESTORS=""
ENV_SELF_CACHE_DONE=0
env_self_cache() {
  [ "$ENV_SELF_CACHE_DONE" -eq 1 ] && return 0
  ENV_SELF_CACHE_DONE=1
  local cur="$$" parent guard=0
  ENV_SELF_ANCESTORS=""
  while [ "$guard" -lt 64 ] && [ -n "$cur" ] && [ "$cur" != 0 ]; do
    [ "$cur" = 1 ] && break
    ENV_SELF_ANCESTORS="$ENV_SELF_ANCESTORS $cur"
    parent="$(ps -p "$cur" -o ppid= 2>/dev/null | tr -d '[:space:]')"
    case "$parent" in ''|*[!0-9]*) break ;; esac
    [ "$parent" = "$cur" ] && break
    [ "$parent" = 1 ] && break
    cur="$parent"
    guard=$((guard + 1))
  done
}
env_is_self() {
  local pid="$1"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  # AMEND A14: PID 1 is the shared launchd chain terminal, never "self".
  [ "$pid" = 1 ] && return 1
  env_self_cache
  case " $ENV_SELF_ANCESTORS " in
    *" $pid "*) return 0 ;;
    *) return 1 ;;
  esac
}

# Exact executable + argv matchers. D3: macOS `ps comm` is truncated, so the
# executable is derived from argv[0] of the FULL `args` column by the caller;
# these matchers receive that basename (node/bun/dsh) plus argv[1..]. No
# `pgrep -f` substring hit on a caller shell that merely echoes a pattern.
# D5: shapes follow the product's classifyProcess (packages/shell/bin/lib/
# launcher.mjs): exe ∈ {node,bun,dsh}, dsh at argv[0] or argv[1], profile flag
# `--profile X` or `--profile=X`, no wrapper/subcommand/grep/tmux false hits.
env_cmd_is_mock_llm() {
  local exe="$1"; shift
  case "${exe##*/}" in node|nodejs|bun) ;; *) return 1 ;; esac
  # C2: identity is runtime + the mock-llm.mjs script at argv[1]. Trailing
  # arguments are allowed (the product classifyProcess does not parse them).
  case "${1:-}" in
    */mock-llm.mjs|mock-llm.mjs) return 0 ;;
    *) return 1 ;;
  esac
}

env_cmd_is_dsh_profile() {
  local exe="$1"; shift
  case "${exe##*/}" in
    dsh)
      # Native launcher: argv[0] IS dsh (classifyProcess token index 0).
      ;;
    node|nodejs|bun)
      # Installed dsh is a script: argv[1] must be the dsh binary (token
      # index 1). A wrapper (`node wrapper.js dsh ...`) merely mentions it.
      case "${1:-}" in */dsh|dsh) shift ;; *) return 1 ;; esac
      ;;
    *) return 1 ;;
  esac
  # C2: once the dsh token is found (argv[0] or argv[1]) and the NEXT token is
  # the target profile flag, this IS the host — trailing args are NOT inspected
  # (product classifyProcess returns 'host' immediately). A non-target flag
  # (`dsh plugin ...`, `dsh opentui ...`, another profile) is not a host.
  if [ "$#" -gt 0 ] && [ "$1" = "--profile" ]; then
    [ "${2:-}" = "$PROFILE" ] && return 0
    return 1
  fi
  [ "$#" -gt 0 ] && [ "$1" = "--profile=$PROFILE" ] && return 0
  return 1
}

# D6: exactly one ps snapshot per probe. ENV_PS_SNAPSHOT is set by env_snapshot
# for the pre/postcheck; an empty or failed snapshot is a HARD failure. Direct
# helper calls (unit tests) fall back to a live snapshot.
ENV_PS_SNAPSHOT=""
ENV_PS_FAILED=0
env_snapshot() {
  local out rc
  out="$(ps -axo pid=,args= 2>/dev/null)"; rc=$?
  ENV_PS_SNAPSHOT="$out"
  ENV_PS_FAILED=0
  if [ "$rc" -ne 0 ] || [ -z "$out" ]; then ENV_PS_FAILED=1; return 1; fi
  return 0
}
env_ps_rows() {
  [ "$ENV_PS_FAILED" -eq 0 ] || return 0
  if [ -n "$ENV_PS_SNAPSHOT" ]; then printf '%s\n' "$ENV_PS_SNAPSHOT"; else ps -axo pid=,args= 2>/dev/null || true; fi
}

# Print "ORPHAN <pid> <cmd>" per live exact match after self + protected-PID
# filters and an explicit per-PID `ps` re-check (not a bare grep count).
env_orphan_pids() {
  local kind="$1" p rest exe
  while IFS=' ' read -r p rest; do
    case "$p" in ''|*[!0-9]*) continue ;; esac
    # D3: argv[0] basename from full args (never truncated ps comm); the
    # remaining tokens are argv[1..]. No glob expansion.
    set -f
    set -- ${rest:-}
    set +f
    [ "$#" -gt 0 ] || continue
    exe="${1##*/}"; shift
    case "$kind" in
      mock) env_cmd_is_mock_llm "$exe" "$@" || continue ;;
      dsh)  env_cmd_is_dsh_profile "$exe" "$@" || continue ;;
      *) return 1 ;;
    esac
    # AMEND A14: emit an auditable exclusion line instead of silently skipping
    # an exact match that is one of our own PPID ancestors.
    if env_is_self "$p"; then
      printf 'EXCLUDED(self-ancestor) %s %s\n' "$p" "$(ps -p "$p" -o command= 2>/dev/null | cut -c1-160)"
      continue
    fi
    [ -n "$PROTECTED_PID" ] && [ "$p" = "$PROTECTED_PID" ] && continue
    ps -p "$p" -o pid= >/dev/null 2>&1 || continue
    printf 'ORPHAN %s %s\n' "$p" "$(ps -p "$p" -o command= 2>/dev/null | cut -c1-160)"
  done < <(env_ps_rows)
}

# AMEND A13: near-miss detector. A process that LOOKS like a gate-owned host
# but fails the exact matcher must never be silently dropped. Emits
# `WARN <reason> <pid> <cmd>` for audit. D4: exact matches are classified and
# consumed FIRST, so a real ORPHAN is never double-reported as a WARN.
env_cmd_is_near_miss() {
  local exe="$1" arg base
  shift
  case "${exe##*/}" in
    dsh) return 0 ;;                 # any dsh argv that was not an exact match
    node|nodejs|bun) ;;
    *) return 1 ;;
  esac
  for arg in "$@"; do
    base="${arg##*/}"
    case "$base" in dsh|mock-llm.mjs|mock-llm) return 0 ;; esac
    case "$arg" in --profile=*|--inspect*|--prof*) return 0 ;; esac
  done
  return 1
}

# R1: BLOCK only for a REAL host/mock argv shape launched through an unknown
# runtime. A bare token in an otherwise unrelated command line (grep dsh,
# `bash -c ... dsh`, a flattened ps token) is audit-only WARN, never a verdict
# blocker: dsh token at arg 0/1 followed by --profile/--profile=, or a mock
# script at arg 1 followed by --port/--port=.
# AMEND4.1/A34: a dsh token at arg 2 (`<wrapper> <flag> dsh --profile X`) is
# BLOCK ONLY under a KNOWN wrapper exe — env/sudo/arch/nice/command/time. A
# shell (`bash`/`sh`/`zsh -c '... dsh ...'`) flattens the quoted body into ps
# tokens and merely ECHOES the pattern; that is audit WARN, never a verdict
# blocker. Unknown exes therefore fall through to the bare-token WARN path.
env_cmd_is_unknown_shape() {
  local exe="${1:-}" a1="${2:-}" a2="${3:-}" a3="${4:-}" base="${1##*/}"
  case "$base" in dsh|node|nodejs|bun) return 1 ;; esac
  case "$a1" in *[[:space:]]*) return 1 ;; esac
  case "$a1" in
    dsh|*/dsh) case "$a2" in --profile|--profile=*) return 0 ;; esac ;;
  esac
  case "$a2" in
    dsh|*/dsh)
      case "$a3" in
        --profile|--profile=*)
          case "$base" in env|sudo|arch|nice|command|time) return 0 ;; esac
          ;;
      esac
      ;;
  esac
  case "${a1##*/}" in
    mock-llm.mjs|mock-llm) case "$a2" in --port|--port=*) return 0 ;; esac ;;
  esac
  return 1
}

# A bare dsh/mock token anywhere in argv (no profile/port shape) is WARN-only
# audit noise, not an orphan: `ps` flattens `bash -c '... dsh'` into tokens.
env_cmd_is_bare_token() {
  local arg
  for arg in "$@"; do
    case "$arg" in *[[:space:]]*) continue ;; esac
    case "${arg##*/}" in dsh|mock-llm.mjs|mock-llm) return 0 ;; esac
  done
  return 1
}

env_near_miss_pids() {
  local p rest exe reason
  while IFS=' ' read -r p rest; do
    case "$p" in ''|*[!0-9]*) continue ;; esac
    set -f
    set -- ${rest:-}
    set +f
    [ "$#" -gt 0 ] || continue
    exe="${1##*/}"; shift
    # D4/D5: exact classification first — a precise host/mock match is never
    # also emitted as a near-miss WARN.
    if env_cmd_is_dsh_profile "$exe" "$@" || env_cmd_is_mock_llm "$exe" "$@"; then continue; fi
    env_is_self "$p" && continue
    [ -n "$PROTECTED_PID" ] && [ "$p" = "$PROTECTED_PID" ] && continue
    # AMEND4.1: classify from the single snapshot FIRST, then re-check liveness
    # only for a line we are about to emit. Doing `ps -p $p` before
    # classification made every candidate row pay a live-ps call even when it
    # was neither BLOCK nor WARN (and skewed the A38 ancestor-walk counter).
    if env_cmd_is_unknown_shape "$exe" "$@"; then
      # C2/R1: a REAL host/mock argv shape under an unknown runtime is BLOCKING;
      # a bare token with no profile/port shape is only an audit WARN.
      ps -p "$p" -o pid= >/dev/null 2>&1 || continue
      printf 'BLOCK unknown-shape %s %s\n' "$p" "$(ps -p "$p" -o command= 2>/dev/null | cut -c1-160)"
      continue
    fi
    if env_cmd_is_near_miss "$exe" "$@"; then
      reason="near-miss"
    elif env_cmd_is_bare_token "$@"; then
      reason="bare-token"
    else
      continue
    fi
    ps -p "$p" -o pid= >/dev/null 2>&1 || continue
    printf 'WARN %s %s %s\n' "$reason" "$p" "$(ps -p "$p" -o command= 2>/dev/null | cut -c1-160)"
  done < <(env_ps_rows)
}

# --- cross-worktree gate mutex --------------------------------------------
# One gate at a time per TMPDIR. D8: the path is env-overridable (default
# unchanged) so tests use a private temp path. D1: every failed/absent branch
# of the acquire loop sleeps one bounded tick; a directory at the lock path,
# an unwritable/missing parent, or a non-EEXIST disk failure fails fast.
# D2: stale recovery is CAS — a hard-link snapshot of the lock path is read
# back (inode + content), a deterministic hard-link claim elects ONE winner,
# and only then is the stale lock removed. A live lock swapped in between
# snapshot and claim is never moved. kill -0 only probes liveness; no external
# process is ever terminated.
# R2f: an inherited GATE_LOCK_FILE must never redirect a REAL gate away from
# the shared default lock (that would defeat cross-worktree serialization).
# The env override is a self-test affordance only (--self-test=*).
GATE_LOCK_DEFAULT="${TMPDIR:-/tmp}/real-client-gate.lock"
if [ -n "$SELF_TEST" ]; then
  GATE_LOCK_FILE="${GATE_LOCK_FILE:-$GATE_LOCK_DEFAULT}"
else
  GATE_LOCK_FILE="$GATE_LOCK_DEFAULT"
fi
GATE_LOCK_QUARANTINE="${GATE_LOCK_QUARANTINE:-${GATE_LOCK_FILE}.stale}"
GATE_LOCK_TICK_SEC="0.5"
GATE_LOCK_MAX_TICKS=120                 # 60s ceiling
GATE_LOCK_STALE_MAX="${GATE_LOCK_STALE_MAX:-8}"   # R2c: recovery attempts ceiling
GATE_LOCK_HELD=0
GATE_LOCK_READ_PID=""
GATE_LOCK_READ_STAMP=""
GATE_LOCK_READ_STATE="absent"
# AMEND4.1: the stamp computed at acquire time is cached on the lock owner.
# release must compare against THAT value, not a fresh `ps lstart` which can
# differ after a locale shift (or a shim) and silently skip lock release.
GATE_LOCK_MY_STAMP=""

# AMEND4.1: prefer GNU `stat -c %i` (filesystem-format `stat -f` on Linux does
# not report an inode), fall back to BSD/macOS `stat -f %i`. Either result must
# be a plain positive integer — a locale banner or an error string is NEVER a
# valid inode (a blank inode would make the CAS read-back vacuous).
gate_lock_inode() {
  local f="$1" i=""
  i="$(stat -c %i "$f" 2>/dev/null || true)"
  case "$i" in ''|*[!0-9]*) i="$(stat -f %i "$f" 2>/dev/null || true)" ;; esac
  case "$i" in ''|*[!0-9]*) i="" ;; esac
  printf '%s' "$i"
}

# Launch stamp of a PID (stable for the lifetime of a process; different after
# PID reuse). "-" is a non-matching placeholder for an unreadable PID.
# AMEND4.1: `lstart` embeds an abbreviated month name; pin LC_ALL=C so a
# locale change between acquire and release cannot make the two stamps differ
# and leave an owned lock un-released (PID-reuse detection stays deterministic).
gate_lock_stamp() {
  local pid="$1" s
  s="$(LC_ALL=C ps -p "$pid" -o lstart= 2>/dev/null | tr -d '\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  case "$s" in '') s="-" ;; esac
  printf '%s' "$s"
}

# R2e: '-' means ps could not read our own start time. Publishing that would
# make every future ownership check (and PID-reuse detection) vacuous, so it
# is a HARD failure — never write a lock or a claim with a '-' stamp.
gate_lock_my_stamp() {
  local s
  s="$(gate_lock_stamp $$)"
  if [ "$s" = "-" ]; then
    # stderr, not log(): callers capture stdout into a variable.
    printf '%s\n' "env lock: HARD — cannot read launch stamp for pid $$ (refusing to publish)" >&2
    return 1
  fi
  printf '%s' "$s"
}

# Parse the lock into GATE_LOCK_READ_{PID,STAMP,STATE}. STATE is one of
# absent | valid | invalid. Strict 2-line shape: any empty/non-numeric PID,
# empty stamp or extra line is "invalid" and is NEVER cleared automatically.
gate_lock_read() {
  local raw nlines l1 l2
  GATE_LOCK_READ_PID=""; GATE_LOCK_READ_STAMP=""; GATE_LOCK_READ_STATE="invalid"
  [ -f "$GATE_LOCK_FILE" ] || { GATE_LOCK_READ_STATE="absent"; return 0; }
  raw="$(cat "$GATE_LOCK_FILE" 2>/dev/null || true)"
  nlines="$(printf '%s\n' "$raw" | wc -l | tr -d '[:space:]')"
  [ "$nlines" = 2 ] || return 0
  l1="$(printf '%s\n' "$raw" | sed -n '1p')"
  l2="$(printf '%s\n' "$raw" | sed -n '2p')"
  case "$l1" in ''|*[!0-9]*) return 0 ;; esac
  case "$l2" in ''|'-') return 0 ;; esac
  GATE_LOCK_READ_PID="$l1"; GATE_LOCK_READ_STAMP="$l2"; GATE_LOCK_READ_STATE="valid"
}

# A live owner: PID reachable AND stamp still identical (no PID reuse).
gate_lock_owner_is_live() {
  local pid="$1" stamp="$2"
  kill -0 "$pid" 2>/dev/null || return 1
  [ "$(gate_lock_stamp "$pid")" = "$stamp" ] || return 1
  return 0
}

# D1 fail-fast preconditions: a directory/symlink at the lock path, a missing
# or unwritable parent are NOT contention — never spin on them.
gate_lock_failfast_check() {
  local parent
  if [ -L "$GATE_LOCK_FILE" ]; then
    log "env lock: lock path is a symlink: $GATE_LOCK_FILE"
    return 1
  fi
  if [ -d "$GATE_LOCK_FILE" ]; then
    log "env lock: lock path is a directory (not a file): $GATE_LOCK_FILE"
    return 1
  fi
  parent="${GATE_LOCK_FILE%/*}"
  [ "$parent" = "$GATE_LOCK_FILE" ] && parent="."
  if [ ! -d "$parent" ]; then
    log "env lock: lock parent directory missing: $parent"
    return 1
  fi
  if [ ! -w "$parent" ]; then
    log "env lock: lock parent directory not writable: $parent"
    return 1
  fi
  return 0
}

# A non-EEXIST create failure (disk full / EROFS / EACCES) must fail fast.
gate_lock_disk_ok() {
  local probe="${GATE_LOCK_FILE}.probe.$$.$RANDOM"
  if ( set -C; : > "$probe" ) 2>/dev/null; then
    rm -f "$probe" 2>/dev/null || true
    return 0
  fi
  rm -f "$probe" 2>/dev/null || true
  return 1
}

# Atomically publish our lock: candidate file + hard link (O_EXCL). The
# read-back of inode/content refuses a torn or substituted publish.
# rc 0=published, 1=EEXIST contention, 2=disk failure.
gate_lock_try_create() {
  local cand="${GATE_LOCK_FILE}.cand.$$.$RANDOM"
  local ci li cc lc lnerr mystamp
  mystamp="$(gate_lock_my_stamp 2>/dev/null)" || {
    log "env lock: HARD — cannot read launch stamp; refusing to publish lock"
    return 2
  }
  if ! ( set -C; printf '%s\n%s\n' "$$" "$mystamp" > "$cand" ) 2>/dev/null; then
    return 2
  fi
  # C1: classify the ln failure by its stderr. ONLY a POSIX EEXIST ("File
  # exists") is contention (rc=1 → bounded retry); every other disk error is
  # rc=2 → fail-fast, never spun into a timeout that could be read as green.
  # R2e: LC_ALL=C makes that diagnostic byte-stable across locales.
  if ! lnerr="$(LC_ALL=C ln "$cand" "$GATE_LOCK_FILE" 2>&1)"; then
    rm -f "$cand" 2>/dev/null || true
    case "$lnerr" in
      *"File exists"*) return 1 ;;
      *) log "env lock: ln failed (disk error): ${lnerr:-<no stderr>}"; return 2 ;;
    esac
  fi
  ci="$(gate_lock_inode "$cand")"
  li="$(gate_lock_inode "$GATE_LOCK_FILE")"
  cc="$(cat "$cand" 2>/dev/null || true)"
  lc="$(cat "$GATE_LOCK_FILE" 2>/dev/null || true)"
  rm -f "$cand" 2>/dev/null || true
  if [ -n "$ci" ] && [ "$ci" = "$li" ] && [ "$cc" = "$lc" ]; then
    GATE_LOCK_HELD=1
    GATE_LOCK_MY_STAMP="$mystamp"
    return 0
  fi
  log "env lock: published lock read-back mismatch; refusing"
  return 2
}

# R2c: a recovery claim records the CLAIMANT's identity (PID + launch stamp)
# instead of merely being a copy of the stale bytes. A contender killed
# mid-recovery leaves a claim whose PID is dead (or stamp mismatched after PID
# reuse) -> reclaimable; a LIVE claimant's claim is left untouched so the
# hard-link claim election still has exactly one winner.
gate_lock_reclaim_claim() {
  local claim="${GATE_LOCK_FILE}.recover" cpid cstamp
  [ -e "$claim" ] || return 0
  cpid="$(sed -n '1p' "$claim" 2>/dev/null || true)"
  cstamp="$(sed -n '2p' "$claim" 2>/dev/null || true)"
  case "$cpid" in ''|*[!0-9]*) rm -f "$claim" 2>/dev/null || true; return 0 ;; esac
  if gate_lock_owner_is_live "$cpid" "$cstamp"; then return 0; fi
  rm -f "$claim" 2>/dev/null || true
}

# D2 CAS stale recovery. 0 = this process won the claim AND removed the stale
# lock; content/inode mismatch never touches the lock path. R2e: LC_ALL=C on
# every ln makes the EEXIST diagnostic byte-stable; a '-' stamp hard-fails.
gate_lock_clear_stale() {
  local pid="$1" stamp="$2"
  local snap="${GATE_LOCK_FILE}.snap.$$.$RANDOM"
  local claim="${GATE_LOCK_FILE}.recover"
  local claim_new="${claim}.cand.$$.$RANDOM"
  local expected expected_inode mystamp rc=1
  mystamp="$(gate_lock_my_stamp 2>/dev/null)" || {
    log "env lock: HARD — cannot read launch stamp; refusing stale recovery"
    return 1
  }
  expected="$(printf '%s\n%s' "$pid" "$stamp")"
  expected_inode="$(gate_lock_inode "$GATE_LOCK_FILE")"
  [ -n "$expected_inode" ] || return 1
  # Point-in-time hard-link snapshot of the exact current lock inode.
  if ! LC_ALL=C ln "$GATE_LOCK_FILE" "$snap" 2>/dev/null; then
    rm -f "$snap" 2>/dev/null || true
    return 1
  fi
  # CAS read-back: snapshotted bytes + inode must be the stale lock we read.
  if [ "$(cat "$snap" 2>/dev/null || true)" != "$expected" ] \
     || [ "$(gate_lock_inode "$snap")" != "$expected_inode" ]; then
    rm -f "$snap" 2>/dev/null || true
    return 1
  fi
  # Winner election: O_EXCL hard-link a claim that IDENTIFIES us (PID+stamp).
  # A live claimant's claim blocks losers; a dead one was reclaimed above.
  if ! ( set -C; printf '%s\n%s\n' "$$" "$mystamp" > "$claim_new" ) 2>/dev/null; then
    rm -f "$snap" "$claim_new" 2>/dev/null || true
    return 1
  fi
  if ! LC_ALL=C ln "$claim_new" "$claim" 2>/dev/null; then
    rm -f "$snap" "$claim_new" 2>/dev/null || true
    return 1
  fi
  # Winner's final CAS check: lock path must STILL be that exact inode/content.
  # A live lock swapped in between snapshot and claim is left untouched.
  if [ "$(gate_lock_inode "$GATE_LOCK_FILE" 2>/dev/null || true)" = "$expected_inode" ] \
     && [ "$(cat "$GATE_LOCK_FILE" 2>/dev/null || true)" = "$expected" ]; then
    rm -f "$GATE_LOCK_FILE" 2>/dev/null || true
    rc=0
  fi
  rm -f "$claim" "$claim_new" "$snap" 2>/dev/null || true
  return "$rc"
}

gate_lock_acquire() {
  local tick=0 stale=0 rc
  gate_lock_failfast_check || return 1
  while [ "$tick" -lt "$GATE_LOCK_MAX_TICKS" ]; do
    # Every iteration is one bounded tick, whatever branch it takes.
    tick=$((tick + 1))
    gate_lock_try_create
    rc=$?
    if [ "$rc" -eq 0 ]; then
      log "env lock: acquired $GATE_LOCK_FILE (pid $$)"
      return 0
    fi
    if [ "$rc" -eq 2 ]; then
      log "env lock: disk failure publishing lock at $GATE_LOCK_FILE; failing fast"
      return 1
    fi
    # rc=1: EEXIST (contention) or the path vanished. An absent lock with a
    # healthy parent/disk is just an absent branch — a bounded sleep, never
    # a busy `continue`.
    if [ ! -e "$GATE_LOCK_FILE" ]; then
      if ! gate_lock_disk_ok; then
        log "env lock: disk failure (parent unwritable/full) at $GATE_LOCK_FILE; failing fast"
        return 1
      fi
      sleep "$GATE_LOCK_TICK_SEC"
      continue
    fi
    gate_lock_read
    case "$GATE_LOCK_READ_STATE" in
      absent)
        sleep "$GATE_LOCK_TICK_SEC"
        continue
        ;;
      invalid)
        log "env lock: invalid lock file $GATE_LOCK_FILE (refusing to clear; inspect manually)"
        return 1
        ;;
    esac
    if gate_lock_owner_is_live "$GATE_LOCK_READ_PID" "$GATE_LOCK_READ_STAMP"; then
      if [ "$GATE_LOCK_READ_PID" = "$$" ]; then
        GATE_LOCK_HELD=1
        # AMEND4.1: an already-owned lock (e.g. a second acquire in the same
        # process) still caches the verified stamp for release.
        GATE_LOCK_MY_STAMP="$GATE_LOCK_READ_STAMP"
        return 0
      fi
      sleep "$GATE_LOCK_TICK_SEC"
      continue
    fi
    gate_lock_reclaim_claim
    # R2c: EVERY recovery attempt counts toward the ceiling — a CAS mismatch,
    # a lost claim, or a dead stale-owner recovery all consume one slot. A
    # permanently contended claim must fail loudly instead of spinning.
    gate_lock_clear_stale "$GATE_LOCK_READ_PID" "$GATE_LOCK_READ_STAMP" || true
    stale=$((stale + 1))
    if [ "$stale" -gt "$GATE_LOCK_STALE_MAX" ]; then
      log "env lock: too many stale recovery attempts/failures ($stale > $GATE_LOCK_STALE_MAX); refusing"
      return 1
    fi
    # Recovery winner and losers both sleep a bounded tick before retrying.
    sleep "$GATE_LOCK_TICK_SEC"
  done
  log "env lock: timed out after $tick ticks acquiring $GATE_LOCK_FILE"
  return 1
}

gate_lock_release() {
  local mystamp="${GATE_LOCK_MY_STAMP:-}"
  # AMEND4.1: fall back to a live read only when no acquire cached a stamp in
  # this process (e.g. a test that writes a lock by hand then releases it).
  [ -n "$mystamp" ] || mystamp="$(gate_lock_stamp $$)"
  gate_lock_read
  # R2b: the identity check (PID + stamp) is the authority, not the in-memory
  # flag. A signal can arrive after `ln` publishes the lock but before
  # GATE_LOCK_HELD is set; gating on the flag leaked that lock. Never touch a
  # lock that does not still identify THIS process. AMEND4.1: compare against
  # the stamp cached at acquire, so a locale/shim shift at signal time cannot
  # make us skip our own release.
  if [ "$GATE_LOCK_READ_STATE" = valid ] && [ "$GATE_LOCK_READ_PID" = "$$" ] \
     && [ "$GATE_LOCK_READ_STAMP" = "$mystamp" ]; then
    rm -f "$GATE_LOCK_FILE" 2>/dev/null || true
    log "env lock: released $GATE_LOCK_FILE (pid $$)"
  elif [ "$GATE_LOCK_HELD" -eq 1 ]; then
    log "WARN env lock: lock file no longer identifies this process; not removing"
  fi
  GATE_LOCK_HELD=0
  GATE_LOCK_MY_STAMP=""
}

# R2a: named gate/mount sessions are REAL orphans. Emit canonical
# `ORPHAN tmux:<name>` lines so the same verdict counter (grep '^ORPHAN ')
# sees them; raw names written to the log were audit-only and never blocked.
# Our own $SESS is excluded unconditionally — including `--keep`, where the
# session deliberately survives into postcheck and must not self-report.
env_tmux_orphans() {
  local names name
  names="$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep -E '^(rc-gate-|agents-mount-)' || true)"
  [ -n "$names" ] || return 0
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    [ -n "${SESS:-}" ] && [ "$name" = "$SESS" ] && continue
    printf 'ORPHAN tmux:%s\n' "$name"
  done <<< "$names"
}

# Write one labelled snapshot to $1 and echo the ORPHAN-line count on stdout
# (captured by the caller; redirected file output never pollutes the count).
env_probe() {
  local logfile="$1" label="$2" orphans tmux_orphans jev_lines near_misses count blocks HARD=0
  local sentinel="SENTINEL-$$-seed:$RANDOM-ts:$(date +%s)"
  # D6: one snapshot per probe; empty/failed ps is HARD, never "none" green.
  # All detectors below consume the same snapshot via env_ps_rows.
  env_snapshot || HARD=1
  {
    printf '%s %s\n' "$label" "$(date -u +%FT%TZ)"
    # AMEND4.1: a per-run sentinel proves the bytes we just counted came from
    # THIS probe, not a stale/substituted log left by an earlier run.
    printf '%s\n' "--- probe-sentinel $sentinel ---"
    # C-3: PROTECTED_PID is now env-injected and may be empty — no PID
    # whitelist in that case. A literal empty `ps -p ''` would be misleading.
    if [ -n "$PROTECTED_PID" ]; then
      printf '%s\n' "--- protected PID $PROTECTED_PID (env-injected) ---"
      if ps -p "$PROTECTED_PID" -o pid= >/dev/null 2>&1; then
        printf '%s\n' "PRESENT (whitelist excluded, untouched)"
      else
        printf '%s\n' "NOT PRESENT"
      fi
    else
      printf '%s\n' "--- protected PID: none configured (PROTECTED_PID unset; pattern exclusion active) ---"
    fi
    # C-3: pattern-based exclusion (survives restarts). The old
    # `pgrep ... | sed ... || printf '(none)'` never printed (none) because sed
    # always exits 0; decide by the captured output instead of the pipeline rc.
    printf '%s\n' "--- dsh-jev-mcp (excluded, untouched; pattern-based) ---"
    jev_lines="$(pgrep -fl 'dsh-jev-mcp' 2>/dev/null | sed 's/^/EXCLUDED /')"
    if [ -n "$jev_lines" ]; then printf '%s\n' "$jev_lines"; else printf '%s\n' "(none)"; fi
    printf '%s\n' "--- orphan dsh --profile $PROFILE (exact comm+argv, PID-verified, self-filtered) ---"
    orphans="$(env_orphan_pids dsh)"
    [ -n "$orphans" ] && printf '%s\n' "$orphans" || printf '%s\n' "none"
    printf '%s\n' "--- orphan mock-llm.mjs (exact comm+argv, PID-verified, self-filtered) ---"
    orphans="$(env_orphan_pids mock)"
    [ -n "$orphans" ] && printf '%s\n' "$orphans" || printf '%s\n' "none"
    printf '%s\n' "--- named tmux sessions (rc-gate-* / agents-mount-*; ORPHAN tmux:<name> = verdict) ---"
    tmux_orphans="$(env_tmux_orphans)"
    [ -n "$tmux_orphans" ] && printf '%s\n' "$tmux_orphans" || printf '%s\n' "none"
    printf '%s\n' "--- near-miss (WARN, audit) / unknown-shape (BLOCK, verdict) host-like processes ---"
    near_misses="$(env_near_miss_pids)"
    [ -n "$near_misses" ] && printf '%s\n' "$near_misses" || printf '%s\n' "none"
  } 2>/dev/null > "$logfile"
  # AMEND A13: an unwritable/empty/non-regular probe log is a hard failure,
  # never a pass (`-s` alone is true for a directory, hence the `-f` guard).
  [ -f "$logfile" ] && [ -s "$logfile" ] || HARD=1
  # AMEND4.1: verify sentinel freshness AFTER the log is written — a missing
  # or mismatched marker means the log is stale/substituted, so every ORPHAN
  # count from it is untrustworthy. Fixed-string match (no regex metachars).
  if ! grep -qF "$sentinel" "$logfile" 2>/dev/null; then
    HARD=1
  fi
  count="$(grep -c '^ORPHAN ' "$logfile" 2>/dev/null || true)"
  case "$count" in ''|*[!0-9]*) count=0 ;; esac
  # C2: unknown dsh/mock shapes are blocking, so fold BLOCK lines into the
  # count that drives the pre/postcheck verdict (near-miss WARN stays audit).
  blocks="$(grep -c '^BLOCK ' "$logfile" 2>/dev/null || true)"
  case "$blocks" in ''|*[!0-9]*) blocks=0 ;; esac
  count=$((count + blocks))
  if [ "$HARD" -eq 1 ]; then
    if [ -f "$logfile" ]; then printf '%s\n' "HARD_FAIL: ps snapshot empty or probe log empty/unwritable" >> "$logfile" 2>/dev/null || true; fi
    printf '%s %s\n' "$count" HARD
  else
    printf '%s %s\n' "$count" OK
  fi
}

# --- bounded idle-out poll (025 wave3 final C-4) ---------------------------
# The detached bridge host idles out ~5s after its client exits. A fixed
# `sleep 6` both over-waits on a fast host and under-waits under load (which
# would misreport our own host as an orphan → false red). Poll on a bounded
# tick until no candidate orphan PID remains; the wall-clock window is DERIVED
# from the documented idle-out + headroom, never a literal sleep value.
IDLE_OUT_TICK_MS=500             # wall-clock per poll tick (0.5s); integer for arithmetic
IDLE_OUT_TICK_SEC="0.5"          # same tick as a sleep argument (fractional)
IDLE_OUT_BASE_SEC=5              # documented detached-host idle-out (client-entry.tsx:20)
IDLE_OUT_HEADROOM_SEC=5          # loaded-host headroom → 10s ceiling
# ceiling(seconds) × 1000 / tick(ms) = max ticks (integer arithmetic only)
IDLE_OUT_MAX_TICKS=$(( (IDLE_OUT_BASE_SEC + IDLE_OUT_HEADROOM_SEC) * 1000 / IDLE_OUT_TICK_MS ))
wait_host_idle_out() {
  local tick=0 orphans
  while [ "$tick" -lt "$IDLE_OUT_MAX_TICKS" ]; do
    # B1: every tick takes a FRESH ps snapshot. env_orphan_pids consumes
    # ENV_PS_SNAPSHOT via env_ps_rows, so reusing a stale precheck snapshot
    # could wrongly declare "host gone" on the very first tick.
    if ! env_snapshot || [ "$ENV_PS_FAILED" -eq 1 ]; then
      log "HARD  wait_host_idle_out: ps snapshot empty/failed at tick $tick (host NOT declared gone)"
      return 1
    fi
    # Same PID-verified detectors the postcheck uses. EXCLUDED(self-ancestor)
    # lines are audit output, not orphan candidates.
    orphans="$(env_orphan_pids dsh | grep -v '^EXCLUDED')$(env_orphan_pids mock | grep -v '^EXCLUDED')"
    [ -z "$orphans" ] && return 0
    tick=$((tick + 1))
    sleep "$IDLE_OUT_TICK_SEC"
  done
  return 1
}

# Cleanup is a FUNCTION DEFINITION (no side effect), so it is available to a
# sourced --self-test=helpers caller for idempotency tests (A24/C3). The traps
# that CALL it are installed below, only on the direct-execution gate path.
SESS="rc-gate-$$"
SCRATCH=""
HOST_PID=""
dump_diagnostics() {
  log "----- diagnostics -----"
  log "env: DSH_HOME=$SCRATCH OUT=$OUT"
  log "dsh=$(dsh --version 2>&1) node=$(node --version 2>&1) bun=$(bun --version 2>&1) tmux=$(tmux -V 2>&1)"
  log "--- last pane (plain) ---"
  tmux capture-pane -p -t "$SESS" 2>/dev/null | tee -a "$RUN_LOG" || true
  log "--- last pane (numeric .ans tail) ---"
  tmux capture-pane -e -p -t "$SESS" 2>/dev/null | tail -40 | tee -a "$RUN_LOG" || true
  log "--- client stderr ---"
  cat "$OUT/client.err.log" 2>/dev/null | tail -60 | tee -a "$RUN_LOG" || true
  log "--- host probe stderr ---"
  cat "$OUT/host-probe.err.log" 2>/dev/null | tail -60 | tee -a "$RUN_LOG" || true
  log "--- bridge symlink state ---"
  ls -la "$SCRATCH/profiles/$PROFILE/node_modules/@aiwayds/" 2>/dev/null | tee -a "$RUN_LOG" || true
  readlink "$SCRATCH/profiles/$PROFILE/node_modules/@aiwayds/dsh-opentui-bridge" 2>/dev/null | tee -a "$RUN_LOG" || true
  log "----- end diagnostics -----"
}
# D9/A24: cleanup is idempotent and runs on EXIT/INT/TERM/HUP so a signal can
# never leak the cross-worktree mutex or the scratch home. A signal trap's
# explicit exit re-triggers EXIT, but CLEANUP_DONE makes the second call a no-op.
CLEANUP_DONE=0
cleanup() {
  # R2b: FIRST statement — disarm INT/TERM/HUP before any teardown. A second
  # signal arriving during the bounded idle-out wait must not re-enter the
  # trap and `exit` before gate_lock_release runs (that leaked the mutex).
  # Only signal traps are ignored: an EXIT trap in a sourcing test caller stays
  # intact and can still run its own cleaner.
  trap '' INT TERM HUP
  [ "$CLEANUP_DONE" -eq 1 ] && return 0
  CLEANUP_DONE=1
  if [ "$KEEP" -eq 0 ]; then
    tmux kill-session -t "$SESS" 2>/dev/null || true
    # C-4: bounded idle-out poll (window from constants) replaces `sleep 6`.
    # B1: each tick takes a fresh ps snapshot; a failed snapshot is non-zero.
    # Failure to converge is logged, never fatal here — postcheck is the verdict.
    [ -n "$SCRATCH" ] && wait_host_idle_out || true
    if [ -n "$SCRATCH" ] && [ -d "$SCRATCH" ]; then rm -rf "$SCRATCH" 2>/dev/null || true; fi
  else
    log "kept tmux session $SESS and scratch home $SCRATCH (--keep)"
    log "WARN --keep leaves this run's host alive after lock release: INCOMPATIBLE with a concurrent gate; clean it up before running a sibling gate"
  fi
  # AMEND A11: release the mutex LAST — after tmux / host idle-out / scratch
  # teardown — so a concurrent gate never inherits our still-live processes as
  # orphans. Never touches another owner's lock (PID + stamp verified).
  gate_lock_release
}

# Library mode: ONLY the explicit CLI --self-test=helpers (AMEND A15). The old
# env var was removed so an inherited variable can never turn a real gate into
# a silent no-op. No lock, no OUT write, no probe/tmux in this mode.
# C6: sourcing the gate with NO (or a non-helpers) self-test mode used to RUN
# THE WHOLE GATE inside the caller's shell. Refuse loudly with exit 2 instead.
if ( return 0 2>/dev/null ); then
  if [ "$SELF_TEST" != helpers ]; then
    printf '%s\n' "ERROR: sourcing $0 requires --self-test=helpers; no-arg source refused (exit 2, no gate run)" >&2
    exit 2
  fi
  return 0
fi
# D7/A22: direct execution of --self-test=helpers is a loud no-op error.
if [ "$SELF_TEST" = helpers ]; then
  printf '%s\n' "ERROR: --self-test=helpers must be sourced (source $0 --self-test=helpers); direct execution runs no gate and exits 2" >&2
  exit 2
fi

mkdir -p "$OUT"
RUN_LOG="$OUT/gate-run.log"
: > "$RUN_LOG"
if [ "$KEEP" -eq 1 ]; then
  log "WARN --keep retains an owned host past this run: INCOMPATIBLE with a concurrent gate (a sibling gate would see it as an orphan); run gates serially"
fi

# C5: trap registration MUST precede lock acquisition. A signal arriving while
# waiting on a live holder must still release what this process owns, so the
# handlers (and the cleanup function above) are installed before the mutex.
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM
trap 'cleanup; exit 129' HUP

# Cross-worktree mutex: held from precheck through postcheck so a sibling
# worktree's mock host can never be mistaken for an orphan. AMEND A12: no env
# check means no lock at all. Refuse (never kill, never bypass) on contention.
# C5: traps above are already installed at this point.
if [ "$SKIP_ENV_CHECK" -eq 0 ] && ! gate_lock_acquire; then
  fail "env lock: could not acquire $GATE_LOCK_FILE (live holder or invalid lock file); refusing to run"
  exit 2
fi

# ------------------------------------------- 0. environment self-check (pre)
if [ "$SKIP_ENV_CHECK" -eq 0 ]; then
  log "=== env precheck $(date -u +%FT%TZ) ==="
  PRE_RESULT="$(env_probe "$OUT/env-precheck.log" "env self-check")"
  PRE_ORPHANS="${PRE_RESULT%% *}"
  PRE_STATUS="${PRE_RESULT##* }"
  case "$PRE_ORPHANS" in ''|*[!0-9]*) PRE_ORPHANS=0 ;; esac
  cat "$OUT/env-precheck.log" | tee -a "$RUN_LOG"
  if [ "$PRE_STATUS" != OK ]; then
    fail "env precheck: ps/log evidence empty — refusing to pass (see $OUT/env-precheck.log)"
    GATE_PRECHECK_RC=2
  elif [ "$PRE_ORPHANS" -gt 0 ]; then
    fail "env precheck: ${PRE_ORPHANS} orphan process(es) — see $OUT/env-precheck.log (stop, clean, rerun; do NOT rerun to fish for green)"
    GATE_PRECHECK_RC=2
  else
    pass "env precheck: no orphan dsh/mock-llm/named-tmux (PID list in $OUT/env-precheck.log)"
    GATE_PRECHECK_RC=0
  fi
  # Explicit CLI self-test hook: exercise the REAL precheck branch (mutex
  # included) without booting probes/tmux. The EXIT trap releases the lock.
  if [ "$SELF_TEST" = precheck ]; then
    exit "$GATE_PRECHECK_RC"
  fi
  [ "$GATE_PRECHECK_RC" -eq 0 ] || exit "$GATE_PRECHECK_RC"
else
  log "SKIP  env precheck (--skip-env-check)"
  printf 'skipped via --skip-env-check %s\n' "$(date -u +%FT%TZ)" > "$OUT/env-precheck.log"
fi

# ---------------------------------------------------------------- 1. preflight
log "=== real-client-gate start $(date -u +%FT%TZ) ==="
PRE=0
for tool in dsh node bun tmux; do
  if command -v "$tool" >/dev/null 2>&1; then pass "preflight: $tool on PATH"; else fail "preflight: $tool missing"; PRE=1; fi
done
for f in "$LAUNCHER" "$PROVISIONER" "$BRIDGE_DIR/index.js" "$BRIDGE_DIR/bundle-fingerprint.json"; do
  if [ -e "$f" ]; then pass "preflight: $f"; else fail "preflight: missing $f"; PRE=1; fi
done
if [ "$PRE" -ne 0 ]; then dump_diagnostics; exit 2; fi

# ------------------------------------------------- 2. fresh scratch + provision
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/rc-gate-home-XXXXXX")"
chmod 700 "$SCRATCH"
mkdir -p "$SCRATCH/profiles"
log "scratch home: $SCRATCH"
DSH_HOME="$SCRATCH" node "$PROVISIONER" --repair >"$OUT/provision.log" 2>&1
if [ "$?" -eq 0 ] && grep -q '^dsh-opentui(inproc): PASS' "$OUT/provision.log"; then
  pass "provision: inproc host provisioned (--repair)"
else
  fail "provision: see $OUT/provision.log"; dump_diagnostics; exit 2
fi
LINK="$SCRATCH/profiles/$PROFILE/node_modules/@aiwayds/dsh-opentui-bridge"
# S6 symlink-debt retirement: the bridge is now a REAL DIRECTORY COPY, never
# an absolute symlink. Assert a real dir (not a link) with the shipped files,
# and that its index.js hash matches this install's fingerprint.
if [ -d "$LINK" ] && [ ! -L "$LINK" ] && [ -f "$LINK/index.js" ] && [ -f "$LINK/bundle-fingerprint.json" ]; then
  EXPECTED_SHA=$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).sha256)' "$BRIDGE_DIR/bundle-fingerprint.json")
  ACTUAL_SHA=$(node -e 'const c=require("node:crypto"),fs=require("node:fs");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$LINK/index.js")
  if [ "$EXPECTED_SHA" = "$ACTUAL_SHA" ]; then
    pass "provision: bridge materialized as real dir (sha256 match, no symlink)"
  else
    fail "provision: bridge copy hash mismatch (expected $EXPECTED_SHA, got $ACTUAL_SHA)"; dump_diagnostics; exit 2
  fi
else
  fail "provision: bridge is not a real directory copy: $(ls -ld "$LINK" 2>/dev/null)"; dump_diagnostics; exit 2
fi

# ------------------------------------------------------- 3. handshake smoke
cat > "$OUT/bridge-probe.mjs" <<'PROBE'
import { spawn } from 'node:child_process'
const home = process.argv[2]
const child = spawn('dsh', ['--profile', process.argv[3]], {
  env: { ...process.env, DSH_HOME: home, DSH_OPENTUI_BRIDGE_STDIO: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let out = '', err = ''
child.stdout.on('data', (c) => { out += c.toString() })
child.stderr.on('data', (c) => { err += c.toString() })
setTimeout(() => { try { child.stdin.write(JSON.stringify({ id: 1, method: 'bridge.hello', params: { protocolVersion: 1 } }) + '\n') } catch {} }, 1500)
setTimeout(() => {
  const ok = /"protocolVersion"\s*:\s*1/.test(out) && /"bridgeVersion"/.test(out)
  process.stdout.write((ok ? 'HELLO_OK ' : 'HELLO_FAIL ') + JSON.stringify({ out: out.trim(), err: err.trim().slice(0, 2000) }) + '\n')
  try { child.kill('SIGTERM') } catch {}
  process.exit(ok ? 0 : 1)
}, 6000)
PROBE
node "$OUT/bridge-probe.mjs" "$SCRATCH" "$PROFILE" >"$OUT/host-probe.out.log" 2>"$OUT/host-probe.err.log"
PROBE_RC=$?
if [ "$PROBE_RC" -eq 0 ]; then pass "handshake: bridge.hello replied in framed JSON"
else fail "handshake: bridge.hello no reply (see $OUT/host-probe.*.log)"; dump_diagnostics; exit 2; fi

# ------------------------------------------- 4. tmux boot + wait for composer
tmux kill-session -t "$SESS" 2>/dev/null || true
tmux new-session -d -x 120 -y 34 -s "$SESS" -c "$REPO" \
  "DSH_HOME=$SCRATCH DSH_OPENTUI_DEBUG=1 $LAUNCHER --client 2>$OUT/client.err.log"
if [ "$?" -ne 0 ]; then fail "tmux boot failed"; dump_diagnostics; exit 2; fi
BOOTED=0
i=0
while [ "$i" -lt "$BOOT_TIMEOUT" ]; do
  pane="$(tmux capture-pane -p -t "$SESS" 2>/dev/null)"
  # S5: configLoad now reads the REAL profile config (lang may be zh), so the
  # composer paints the zh placeholder `输入消息（enter 发送…）` too. Accept it
  # alongside the en strings — the readiness criterion is the painted input box.
  if printf '%s' "$pane" | grep -qE '❯|›|Type a message|提问，回车发送|输入消息'; then BOOTED=1; break; fi
  sleep 1; i=$((i + 1))
done
if [ "$BOOTED" -eq 1 ]; then pass "composer input box painted in ${i}s (.ans readiness)"
else fail "TUI did not reach composer in ${BOOT_TIMEOUT}s"; dump_diagnostics; fi

cap_ansi() { tmux capture-pane -e -p -t "$SESS" 2>/dev/null; }
cap_plain() { tmux capture-pane -p -t "$SESS" 2>/dev/null; }
snap() {
  cap_ansi > "$OUT/$1.ans"
  cap_plain > "$OUT/$1.log"
  log "  frame $1: $(wc -c < "$OUT/$1.ans") ansi bytes"
}

# ------------------------------------------------------- 5. .ans frame capture
if [ "$ONLY" = all ] || [ "$ONLY" = frames ]; then
  if [ "$BOOTED" -eq 1 ]; then
    # Each scenario starts from an IDLE composer: clear any residue so a
    # slash-command keystroke never appends to a previous probe string.
    clear_composer() { tmux send-keys -t "$SESS" C-u 2>/dev/null || true; sleep 0.3; }

    # basic: composer accepts text + footer hints (do NOT submit — keep idle)
    clear_composer
    tmux send-keys -t "$SESS" 'rc-gate-probe'; sleep 1; snap 'sk-08-basic'
    log "  basic: composer-input=$(grep -q 'rc-gate-probe' "$OUT/sk-08-basic.log" && echo yes || echo no)"
    clear_composer

    # modal: ctrl+c on idle opens quit confirm (modal tier), Esc closes
    tmux send-keys -t "$SESS" C-c; sleep 1; snap 'sk-06-modal'
    log "  modal: dialog-frame=$(grep -qiE 'quit|退出|╭|┌' "$OUT/sk-06-modal.log" && echo yes || echo no)"
    tmux send-keys -t "$SESS" Escape; sleep 0.5; clear_composer

    # paging: /agents panel, PgDn, capture, Esc out
    tmux send-keys -t "$SESS" '/agents'; sleep 0.5
    tmux send-keys -t "$SESS" Enter; sleep 2
    tmux send-keys -t "$SESS" Next; sleep 1; snap 'sk-07-pgup-pgdn'
    log "  paging: panel-frame=$(grep -qiE 'agents|agent|╭|┌' "$OUT/sk-07-pgup-pgdn.log" && echo yes || echo no)"
    tmux send-keys -t "$SESS" Escape; sleep 0.5; clear_composer

    # SK turn-Esc: without a live session controller the arm->confirm chain
    # cannot be driven; capture the honest resting frame and note the gap.
    snap 'sk-06-esc'
    log "  esc: turn-busy-marker=$(grep -qiE 'stop|interrupt|停止|busy|writing' "$OUT/sk-06-esc.log" && echo yes || echo no) (full arm->confirm needs live session)"

    # S1: /model picker
    clear_composer
    tmux send-keys -t "$SESS" '/model'; sleep 0.5
    tmux send-keys -t "$SESS" Enter; sleep 3; snap 's1-model'
    log "  s1-model: picker=$(grep -qiE 'model|模型' "$OUT/s1-model.log" && echo yes || echo no) rows=$(grep -qiE 'deepseek|opencode|xiaomi|mimo|glm|provider' "$OUT/s1-model.log" && echo yes || echo no)"
    tmux send-keys -t "$SESS" Escape; sleep 0.5; clear_composer

    # S2: /settings -> Account section. The panel opens on the nav pane:
    # Down walks General(0) -> Account(6); Right/Enter OPENS the highlighted
    # section (it does not advance it). Right 6x used to reopen General each time.
    tmux send-keys -t "$SESS" '/settings'; sleep 0.5
    tmux send-keys -t "$SESS" Enter; sleep 2
    for _ in 1 2 3 4 5 6; do tmux send-keys -t "$SESS" Down; sleep 0.4; done
    tmux send-keys -t "$SESS" Right; sleep 1
    snap 's2-account'
    # locale-complete: S5 made the profile zh-CN by default, so the Account nav
    # label is `账号` (zh) rather than `Account` (en). The grep detects the Account
    # SECTION being visible in the /settings panel; both locale labels are the
    # same section. Adding `账号` keeps the assertion equivalent across locales
    # (same class as the earlier 输入消息 / 🧠→⌨ harness locator fixes) — the
    # check still requires a real /settings panel showing the Account section.
    log "  s2-account: section=$(grep -qiE 'account|账户|账号|/login' "$OUT/s2-account.log" && echo yes || echo no)"
    tmux send-keys -t "$SESS" Escape; sleep 0.5
    tmux send-keys -t "$SESS" Escape; sleep 0.5
  else
    for base in sk-08-basic sk-06-modal sk-07-pgup-pgdn sk-06-esc s1-model s2-account; do
      : > "$OUT/$base.ans"; : > "$OUT/$base.log"
    done
    fail "frames: composer never ready; all .ans frames written EMPTY (BLOCKED, not faked)"
  fi
fi

# ------------------------------------------------------- 6. verify70 (70 items)
if [ "$ONLY" = all ] || [ "$ONLY" = verify70 ]; then
  log "running verify70: node verify/agents-mount-repro.mjs"
  ( cd "$REPO" && node verify/agents-mount-repro.mjs ) >"$OUT/verify70.log" 2>&1
  V70_RC=$?
  if [ "$V70_RC" -eq 0 ]; then pass "verify70: exit 0 (all 64 items)"; else fail "verify70: exit $V70_RC (see $OUT/verify70.log)"; fi
fi

# ------------------------------------------- 6b. answer-bearing frame assert
# W2-3 review C-2: the gate used to emit picker=yes/section=yes as INFO only —
# a fake-empty .ans could never fail the verdict. Chain the answer-bearing
# assertion so its exit code IS part of the gate verdict (W2-2 S-3 ruling).
# Only when frames were actually captured (frames/ALL modes); verify70-only
# runs capture none and are covered by verify70's own verdict.
if { [ "$ONLY" = all ] || [ "$ONLY" = frames ]; } && [ "$BOOTED" -eq 1 ]; then
  node "$REPO/scripts/verify-real-client-frames.mjs" "$OUT" >"$OUT/frame-assert.log" 2>&1
  FRAME_ASSERT_RC=$?
  cat "$OUT/frame-assert.log" | tee -a "$RUN_LOG"
  if [ "$FRAME_ASSERT_RC" -eq 0 ]; then
    pass "frames: answer-bearing assert exit 0 (see frame-assert.log)"
  else
    fail "frames: answer-bearing assert exit $FRAME_ASSERT_RC (fake-empty frame, see $OUT/frame-assert.log)"
  fi
fi

# ------------------------------------------- 6c. environment post-check
if [ "$SKIP_ENV_CHECK" -eq 0 ]; then
  # Retire OUR tmux session first, then poll (bounded, window from constants)
  # until the detached host actually idles out, so the gate's own processes are
  # never reported as orphans even under load. The EXIT trap's cleanup is
  # idempotent (second kill is a no-op). A non-converged poll only logs here —
  # the PID-verified postcheck below is the authoritative orphan verdict.
  if [ "$KEEP" -eq 0 ]; then
    tmux kill-session -t "$SESS" 2>/dev/null || true
    if [ -n "$SCRATCH" ] && ! wait_host_idle_out; then
      log "WARN  postcheck idle-out poll did not converge within $((IDLE_OUT_MAX_TICKS)) ticks (~$((IDLE_OUT_MAX_TICKS / 2))s); PID list below is authoritative"
    fi
  fi
  log "=== env postcheck $(date -u +%FT%TZ) ==="
  POST_RESULT="$(env_probe "$OUT/env-postcheck.log" "post-check")"
  POST_ORPHANS="${POST_RESULT%% *}"
  POST_STATUS="${POST_RESULT##* }"
  case "$POST_ORPHANS" in ''|*[!0-9]*) POST_ORPHANS=0 ;; esac
  cat "$OUT/env-postcheck.log" | tee -a "$RUN_LOG"
  if [ "$POST_STATUS" != OK ]; then
    fail "env postcheck: ps/log evidence empty — refusing to pass (see $OUT/env-postcheck.log)"
  elif [ "$KEEP" -eq 1 ]; then
    log "INFO  env postcheck verdict skipped (--keep retains owned session; PID list still in $OUT/env-postcheck.log)"
  elif [ "$POST_ORPHANS" -gt 0 ]; then
    fail "env postcheck: ${POST_ORPHANS} orphan process(es) — see $OUT/env-postcheck.log"
  else
    pass "env postcheck: no orphan dsh/mock-llm/named-tmux (PID-verified list in $OUT/env-postcheck.log)"
  fi
else
  log "SKIP  env postcheck (--skip-env-check)"
  printf 'skipped via --skip-env-check %s\n' "$(date -u +%FT%TZ)" > "$OUT/env-postcheck.log"
fi

# --------------------------------------------------------------- 7. verdict
log "=== verdict: FAIL=$FAIL ==="
if [ "$FAIL" -ne 0 ]; then dump_diagnostics; exit 1; fi
log "REAL_CLIENT_GATE_PASS"
exit 0
