#!/usr/bin/env bash
# 024 real-client gate — ONE repeatable recipe for the three slices whose
# real-machine items were BLOCKED (S1 /model, S2 account, SK keymap) plus the
# shared verify70 (64-item) gate.
#
#   scripts/real-client-gate.sh [--out DIR] [--boot-timeout SEC]
#                               [--keep] [--only smoke|frames|verify70|all]
#
# What it does (all writes to a FRESH scratch DSH_HOME; ~/.dsh is never touched):
#   1. preflight — dsh / node / bun / tmux / launcher / shipped bridge present
#   2. fresh scratch DSH_HOME — seed the `opentui` profile + account/model
#      fixtures from the real home, then PROVISION the in-process host with
#      --repair (this is the fix: the real home's bridge symlink dangles at a
#      removed worktree, so the host skips the bundle and bridge.hello times
#      out; provisioning points it at THIS checkout's dist/bridge and grants
#      the exact host-version exemption)
#   3. handshake smoke — spawn `dsh --profile opentui-inproc` with
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
# overwrites only its --out directory. CI-reusable: no interactive prompts,
# no dependency on the operator's ~/.dsh state beyond read-only fixtures.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER="$REPO/dsh-opentui"
PROVISIONER="$REPO/packages/shell/scripts/provision-inproc-profile.mjs"
BRIDGE_DIR="$REPO/packages/shell/dist/bridge"
REAL_HOME="${DSH_HOME_REAL:-$HOME/.dsh}"
OUT="$REPO/.proof/real-client-gate"
BOOT_TIMEOUT=90
KEEP=0
ONLY=all

while [ "$#" -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --boot-timeout) BOOT_TIMEOUT="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --only) ONLY="$2"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
mkdir -p "$OUT"
RUN_LOG="$OUT/gate-run.log"
: > "$RUN_LOG"
log() { printf '%s\n' "$*" | tee -a "$RUN_LOG"; }
FAIL=0
fail() { FAIL=$((FAIL + 1)); log "FAIL  $*"; }
pass() { log "PASS  $*"; }

SESS="rc-gate-$$"
SCRATCH=""
HOST_PID=""
dump_diagnostics() {
  log "----- diagnostics -----"
  log "env: DSH_HOME=$SCRATCH REAL_HOME=$REAL_HOME OUT=$OUT"
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
  ls -la "$SCRATCH/profiles/opentui-inproc/node_modules/@aiwayds/" 2>/dev/null | tee -a "$RUN_LOG" || true
  readlink "$SCRATCH/profiles/opentui-inproc/node_modules/@aiwayds/dsh-opentui-bridge" 2>/dev/null | tee -a "$RUN_LOG" || true
  log "----- end diagnostics -----"
}
cleanup() {
  if [ "$KEEP" -eq 0 ]; then
    tmux kill-session -t "$SESS" 2>/dev/null || true
    # The detached bridge host idles out ~5s after its client exits; give it a
    # beat so it stops recreating lock/session files under the scratch home.
    sleep 6
    if [ -n "$SCRATCH" ] && [ -d "$SCRATCH" ]; then rm -rf "$SCRATCH" 2>/dev/null || true; fi
  else
    log "kept tmux session $SESS and scratch home $SCRATCH (--keep)"
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------- 1. preflight
log "=== real-client-gate start $(date -u +%FT%TZ) ==="
PRE=0
for tool in dsh node bun tmux; do
  if command -v "$tool" >/dev/null 2>&1; then pass "preflight: $tool on PATH"; else fail "preflight: $tool missing"; PRE=1; fi
done
for f in "$LAUNCHER" "$PROVISIONER" "$BRIDGE_DIR/index.js" "$BRIDGE_DIR/bundle-fingerprint.json"; do
  if [ -e "$f" ]; then pass "preflight: $f"; else fail "preflight: missing $f"; PRE=1; fi
done
[ -d "$REAL_HOME/profiles/opentui" ] || { fail "preflight: real profile $REAL_HOME/profiles/opentui missing"; PRE=1; }
if [ "$PRE" -ne 0 ]; then dump_diagnostics; exit 2; fi

# ------------------------------------------------- 2. fresh scratch + provision
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/rc-gate-home-XXXXXX")"
chmod 700 "$SCRATCH"
mkdir -p "$SCRATCH/profiles"
cp -a "$REAL_HOME/profiles/opentui" "$SCRATCH/profiles/" 2>/dev/null
for rel in .credentials.yaml models-store.json model-profiles.json settings.yaml workspace-presets.json agents themes; do
  [ -e "$REAL_HOME/$rel" ] && cp -a "$REAL_HOME/$rel" "$SCRATCH/" 2>/dev/null
done
[ -d "$REAL_HOME/profiles/node_modules" ] && cp -a "$REAL_HOME/profiles/node_modules" "$SCRATCH/profiles/" 2>/dev/null
log "scratch home: $SCRATCH"
DSH_HOME="$SCRATCH" node "$PROVISIONER" --repair >"$OUT/provision.log" 2>&1
if [ "$?" -eq 0 ] && grep -q '^dsh-opentui(inproc): PASS' "$OUT/provision.log"; then
  pass "provision: inproc host provisioned (--repair)"
else
  fail "provision: see $OUT/provision.log"; dump_diagnostics; exit 2
fi
LINK="$SCRATCH/profiles/opentui-inproc/node_modules/@aiwayds/dsh-opentui-bridge"
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
const child = spawn('dsh', ['--profile', 'opentui-inproc'], {
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
node "$OUT/bridge-probe.mjs" "$SCRATCH" >"$OUT/host-probe.out.log" 2>"$OUT/host-probe.err.log"
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

    # S2: /settings -> Account section (nav right 6x from General)
    tmux send-keys -t "$SESS" '/settings'; sleep 0.5
    tmux send-keys -t "$SESS" Enter; sleep 2
    for _ in 1 2 3 4 5 6; do tmux send-keys -t "$SESS" Right; sleep 0.4; done
    sleep 1; snap 's2-account'
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

# --------------------------------------------------------------- 7. verdict
log "=== verdict: FAIL=$FAIL ==="
if [ "$FAIL" -ne 0 ]; then dump_diagnostics; exit 1; fi
log "REAL_CLIENT_GATE_PASS"
exit 0
