#!/usr/bin/env bash
# Scenario 67 — /theme end-to-end (batch F7c prewrite): the /theme picker
# (commands.ts F7a — the pickOne overlay titled 'Select theme' over the
# bundled theme list), the live-apply feedback row ('Theme: <name> — applied'),
# the config.json persistence through the seam configSave (host-entry-v2 F7b:
# themes.set -> seam.configSave({ theme }) -> HostSession.configSave upserts
# the profile config.json 'theme' key), and — α skin layer rewrite — the
# ONE-SHOT skin migration restart (a legacy `theme` key flips to the dsh-blue
# default, `skinMigration: 1` lands, the notice fires once) instead of the
# old boot-restore group.
#
# DEPENDENCY GATE (the 65-jev-attention model): the image's dist-host
# predates F7a/F7b — the scenario greps the INSTALLED bundle at runtime.
# Gate dark -> only the pre-verifiable G0 runs ('/theme' is still an unknown
# command in the stale bundle — the harmless error row, never a model send)
# and the picker/persistence/restart groups are logged skipped-by-gate.
# Gate lit -> everything below hard-asserts.
#
# RESTORE EVIDENCE IS SELF-CALIBRATING (no hardcoded SGR pins — the image has
# no real /theme capture to derive them from, unlike the tui-pi 40-theme
# canvas SGR constants): a color fingerprint (multiset of SGR fg/bg codes,
# md5) of the EMPTY-TRANSCRIPT boot pane is taken pre-switch; after switching
# to 'aura' and restarting, the fingerprint must DIFFER (the persisted theme
# owns the boot chrome); after removing the theme key and restarting again
# (the control boot), it must MATCH the pre-switch fingerprint (default
# chrome back). Every compared capture is an empty-transcript boot, so
# transcript content cannot confound the diff, and the clock digits ride one
# uniformly-colored segment so the color multiset is tick-stable.
#
# Picker navigation: pickOne renders the vendored DialogSelect with the
# selection starting at row 0 and no current-option preselect
# (host-entry-v2.tsx pickOne); bundledThemeNames() sorts 'aura' first
# (theme/v1.ts DEFAULT_THEMES keys + the 'opencode' default — the baked
# patch theme 'catppuccin-mocha' is NOT a bundled seam name), so one Enter
# picks a non-current theme with no navigation keys.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'theme switch (picker / apply / config.json persistence / restart restore)'

# Face-aware: the store lives in the profile the face actually runs
# (plugin face: baked dsh-opentui; client face: opentui under the scratch
# DSH_HOME common.sh provisioned). See FACE_CFG in lib/common.sh.
CONFIG_JSON="$FACE_CFG"
BUNDLE="/src/packages/tui-base/src"

# --- host guard ---------------------------------------------------------------
if [ ! -d /e2e/scenarios ]; then
  warn 'host environment detected — skipping (mutates the profile config.json); container only'
  summary
  exit 0
fi

# Color fingerprint of the pane: the multiset of SGR fg/bg color codes in the
# -e capture (256-color and truecolor forms), hashed. Theme switches repaint
# the chrome palette, so the multiset moves; identical renders hash equal.
sgr_fingerprint() {
  capture_sgr | grep -oE '[34]8;5;[0-9]+|[34]8;2;[0-9;]+' | sort | uniq -c | md5sum | cut -d' ' -f1
}

# --- boot fresh (env-free: the persisted theme — not an env pin — owns it) ----
kill_tui
start_tui
wait_tui_up 120 || { summary; exit 0; }
sleep 2
BASE_FP="$(sgr_fingerprint)"

# --- the dependency gates -------------------------------------------------------
PICKER_GATE=0
PERSIST_GATE=0
if [ -d "$BUNDLE" ]; then
  grep -rqF 'Select theme' "$BUNDLE" && PICKER_GATE=1
  grep -rqF 'theme persist failed' "$BUNDLE" && PERSIST_GATE=1
fi

# --- G0: pre-verifiable on the stale bundle ------------------------------------
if (( PICKER_GATE == 0 )); then
  ensure_editor_ready 'editor clean before the stale-bundle /theme probe' || true
  send '/theme'
  sleep 2
  send Enter
  wait_pane_fixed \
    'G0 (gate dark): /theme is an unknown command in the stale bundle (never a model send)' 15 \
    'unknown command: /theme (try /help)'
  assert_not_contains 'G0: no theme picker exists in the stale bundle' \
    'Select theme' "$(capture)"
  warn 'picker/persistence/restart groups skipped-by-gate (dist-host rebuild pending — F7a/F7b)'
  summary
  exit 0
fi
if (( PERSIST_GATE )); then PERSIST_ARM=lit; else PERSIST_ARM=DARK; fi
ok "dependency gate LIT: the workspace sources carry the /theme picker (persistence arm: $PERSIST_ARM)"

# --- G1: the picker -------------------------------------------------------------
ensure_editor_ready 'editor clean before /theme traffic' || true
send '/theme'
wait_pane_fixed 'palette row /theme (F7a command registered)' 10 \
  '/theme switch theme (opens the picker)'
send Enter
wait_pane_fixed '/theme opens the theme picker' 15 'Select theme' || { summary; exit 0; }
# Picker rows below are verbatim from a REAL in-container capture of the
# opened picker (36-row pane, no navigation): DialogSelect renders a centered
# single-column list — 'aura' (row 0, what the bare Enter then picks), 'ayu',
# 'dracula', ... The F7c prewrite guessed 'opencode'/'zenburn' as first/last
# rows; the real capture shows neither in the visible window, and the vendored
# pickOne carries NO current-option marker at all (options are bare titles —
# host-entry-v2.tsx pickOne), so the 'exactly one current row' prewrite check
# is replaced by the capture-true row-shape count: the visible window lists
# >= 5 indented single-word theme rows.
sleep 1
PANE="$(capture)"
assert_contains 'picker row: aura (row 0 — what the bare Enter picks)' 'aura' "$PANE"
assert_contains 'picker row: ayu (visible list, capture-verified)' 'ayu' "$PANE"
assert_contains 'picker row: dracula (visible list, capture-verified)' 'dracula' "$PANE"
ROW_COUNT="$(printf '%s\n' "$PANE" | grep -cE '^ {20,}[a-z0-9][a-z0-9-]* *$' || true)"
if [ "$ROW_COUNT" -ge 5 ]; then
  ok "picker lists >= 5 theme rows in the visible window (found $ROW_COUNT indented option rows)"
else
  bad "picker row shape count too low: $ROW_COUNT indented single-word rows (< 5)"
fi

# --- G1: the apply (row 0 = 'aura' — a non-current bundled theme) ---------------
send Enter
sleep 2
wait_pane_fixed 'theme apply feedback row (Theme: aura — applied)' 15 \
  'Theme: aura — applied'
wait_gone 'theme picker closed after selection' 10 'Select theme'

# --- G2: config.json persistence + one-shot skin migration restart ----------------
# (α skin layer rewrote this group: a restart with a legacy `theme` key no
# longer boots that theme — the one-shot migration flips it to the dsh-blue
# default, writes the `skinMigration` marker, and notifies once. The
# pre-migration 'persisted theme owns the boot chrome' evidence lives in the
# aura apply above; the restart now proves the MIGRATION contract.)
if (( PERSIST_GATE == 0 )); then
  warn 'persistence arm DARK: dist-host predates the configSave theme write (F7b) — restart groups skipped-by-gate; the live apply row above is the apply evidence'
  summary
  exit 0
fi
sleep 1
if [ -f "$CONFIG_JSON" ] && grep -qF '"theme": "aura"' "$CONFIG_JSON"; then
  ok 'theme persisted to the profile config.json ("theme": "aura")'
else
  bad 'config.json missing or carries no "theme": "aura" key'
fi

# Restart: the one-shot migration owns the boot — aura flips to dsh-blue,
# the marker lands, the notice shows once, the chrome returns to the default
# fingerprint (equal to the pre-switch baseline: same theme both sides).
kill_tui
start_tui
wait_tui_up 120 || { summary; exit 0; }
sleep 2
wait_pane_fixed 'migration notice shown once (one-shot skin migration)' 15 \
  'Theme switched to dsh-blue (new default). Use /theme to switch back.'
if [ -f "$CONFIG_JSON" ] && grep -qF '"theme": "dsh-blue"' "$CONFIG_JSON" && grep -qF '"skinMigration": 1' "$CONFIG_JSON"; then
  ok 'migration persisted ("theme": "dsh-blue" + "skinMigration": 1)'
else
  bad 'config.json missing the migration write ("theme": "dsh-blue" / "skinMigration": 1)'
fi
wait_gone 'migration notice retires (transient notice channel)' 20 \
  'Theme switched to dsh-blue'
sleep 1
RESTORED_FP="$(sgr_fingerprint)"
if [ "$RESTORED_FP" = "$BASE_FP" ]; then
  ok 'migrated boot chrome matches the pre-switch fingerprint (the dsh-blue default owns the boot again)'
else
  bad 'migrated boot chrome fingerprint differs from the pre-switch baseline — the migration did not restore the default theme'
fi

# Marker gating: a second restart must NOT re-notify (the skinMigration
# marker fires once).
kill_tui
start_tui
wait_tui_up 120 || { summary; exit 0; }
sleep 2
PANE="$(capture)"
assert_not_contains 'no second migration notice after the marker' \
  'Theme switched to dsh-blue' "$PANE"
if grep -qF '"skinMigration": 1' "$CONFIG_JSON"; then
  ok 'config.json keeps the migration marker across the restart'
else
  bad 'config.json lost the skinMigration marker after the restart'
fi

# Control boot: remove the persisted theme AND marker keys; the default
# chrome must come back (fingerprint matches the pre-switch baseline again).
# This step is also the cleanup — the profile is left theme-free for later
# scenarios (a fresh profile lands on dsh-blue naturally).
node -e 'const fs=require("fs");const f=process.argv[1];const j=JSON.parse(fs.readFileSync(f,"utf8"));delete j.theme;delete j.skinMigration;fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")' "$CONFIG_JSON"
ok 'theme + skinMigration keys removed from config.json (control step)'
kill_tui
start_tui
wait_tui_up 120 || { summary; exit 0; }
sleep 2
CONTROL_FP="$(sgr_fingerprint)"
if [ "$CONTROL_FP" = "$BASE_FP" ]; then
  ok 'control boot (keys removed) matches the pre-switch fingerprint (default chrome restored)'
else
  bad 'control boot fingerprint differs from the pre-switch baseline — the default-chrome render is not reproducible across boots'
fi

summary
