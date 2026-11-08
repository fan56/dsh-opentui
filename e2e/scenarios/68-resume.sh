#!/usr/bin/env bash
# Scenario 68 — /sessions resume picker columns (G1 batch, ported from the
# dsh-tui-pi 66-retention-resume Phases C/D semantics; the retention janitor
# itself is host-side and NOT ported).
#
# DEPENDENCY GATE (the 30-commands / 63 model): the upgraded picker (aligned
# UPDATED/DIR columns + the 1KB display floor + the empty-filtered copy)
# rides the dist-host rebuild carrying the G1 batch — NOT yet baked into the
# image at write time. The scenario greps the INSTALLED bundle at runtime;
# gate dark -> only the G0 stale-bundle probe runs (the old picker must NOT
# paint the new column headers over a seeded, non-empty store) and each
# gate-lit group is logged skipped-by-gate; gate lit -> the groups
# hard-assert.
#
# MARKER MAP (derived from the G1 implementation sources, then pinned):
#   'Resume session'
#       the /sessions pickOne overlay title (routes/session/commands.ts,
#       verbatim — pre-existing).
#   'UPDATED' / 'DIR' / 'SESSION'
#       the fitted column-header line painted by
#       routes/session/resume-picker.ts resumePickerOptions (the reference
#       /resume column vocabulary). Column semantics: UPDATED = relative
#       last-update time, DIR = the session's workspace cwd (ellipsed at
#       the 32-char cap), SESSION = the row title.
#   '/app/alpha' / '/app/stub'
#       seeded session DIR cells: the BIG session (25KB on-disk zstd) passes
#       the 1KB display floor and surfaces; the tiny stub (below 1KB) is
#       hidden — the fail-open contract only spares rows with NO size.
#   'No sessions within the resume window ('
#       the empty-FILTERED copy (resume-picker.ts emptyFilteredCopy) — shown
#       when sessions exist but the size floor hides them ALL, distinct from
#       the plain 'no stored sessions' empty-store copy.
#
# Seeder: same contract as the reference 66 — real zstd frames built through
# the dsh closure's session-format catalog, so `persistence.list()` reads a
# genuine header (parseHeaderMeta) and the snapshot carries sizeBytes.
#
# Container-only: the prep phase wipes $HOME/.dsh/sessions (the disposable
# fixture store inside the podman image) — never run on the host.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario '/sessions resume picker: UPDATED/DIR columns + size floor + empty-filtered copy'

if [ ! -d /e2e/scenarios ]; then
  warn 'not running inside the podman e2e container — skipping (prep would wipe $HOME/.dsh/sessions)'
  summary
  exit 0
fi

# --- seeder: build one real session artifact via the host persistence chain --
NPM_GLOBAL_ROOT="$(npm root -g 2>/dev/null || true)"
PERSISTENCE_CANDIDATES=(
  "$NPM_GLOBAL_ROOT/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js"
  "$NPM_GLOBAL_ROOT/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js"
)
PERSISTENCE_ENTRY=""
for candidate in "${PERSISTENCE_CANDIDATES[@]}"; do
  if [[ -f $candidate ]]; then PERSISTENCE_ENTRY="$candidate"; break; fi
done
if [[ -z $PERSISTENCE_ENTRY ]]; then
  bad 'cannot resolve @deepseek-ai/dsh-session-persistence-jsonl for the seeder'
  info "npm root -g => '$NPM_GLOBAL_ROOT'"
  for candidate in "${PERSISTENCE_CANDIDATES[@]}"; do info "  tried: $candidate"; done
  summary
  exit 1
fi
info "persistence backend entry: $PERSISTENCE_ENTRY"

# The encoder glue is written ONCE to a fixture script (kept out of the
# command-substitution heredoc the reference nests): catalog-resolved header
# + event encoding, two checksummed zstd frames, bounded size-pad loop.
SEED_JS=/tmp/e2e-68-seed.mjs
cat >"$SEED_JS" <<'NODE'
import { writeFile, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { constants, zstdCompress } from "node:zlib";
import { promisify } from "node:util";

const [entryPath, outPath, id, nowMs, targetBytesStr] = process.argv.slice(2);
const targetBytes = Number(targetBytesStr) || 0;
const requireFromBackend = createRequire(entryPath);
const { sessionFormatCatalog } = await import(
  pathToFileURL(requireFromBackend.resolve("@deepseek-ai/dsh-session-format-catalog")).href
);
const zstdFrame = promisify(zstdCompress);
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };

function toHeaderLine(meta) {
  return sessionFormatCatalog.encodeCurrentHeader({ ...meta, delegationDepth: meta.delegationDepth ?? 0 }, 0);
}

function eventLines(events) {
  return events.map((event) => JSON.stringify(sessionFormatCatalog.encodeCurrentEvent(event))).join("\n");
}

async function encodeMaterialization(meta, events) {
  const header = JSON.stringify(toHeaderLine(meta)) + "\n";
  if (events.length === 0) return zstdFrame(header, CHECKSUM_OPTIONS);
  const headerFrame = await zstdFrame(header, CHECKSUM_OPTIONS);
  const eventFrame = await zstdFrame(eventLines(events) + "\n", CHECKSUM_OPTIONS);
  return Buffer.concat([headerFrame, eventFrame]);
}

async function main() {
  // Reuse the top-level argv destructure ([entryPath, outPath, id, nowMs,
  // targetBytes, cwd] after the script path) — hardcoded argv indices here
  // went stale when the persistence entry was prepended to the invocation.
  const id_ = id;
  const nowMs_ = Number(nowMs);
  const target = Number(targetBytesStr) || 0;
  const meta = {
    version: 4,
    id: id_,
    createdAt: nowMs_,
    cwd: process.argv[7],
    delegationDepth: 0,
    isSeeded: false,
  };
  const events = [
    {
      type: "user/message",
      seq: 0,
      time: nowMs_,
      surfaceOp: "append",
      data: {
        id: `${id_}-m0`,
        content: [{ type: "text", text: `seed ${id_}` }],
        source: { kind: "user" },
        role: "user",
      },
    },
  ];
  let onDisk = 0;
  for (let iter = 0; iter < 10; iter++) {
    const content = await encodeMaterialization(meta, events);
    await writeFile(outPath, content);
    onDisk = (await stat(outPath)).size;
    if (onDisk >= target) break;
    const startSeq = events.length;
    for (let i = 0; i < 16; i++) {
      events.push({
        type: "user/message",
        seq: startSeq + i,
        time: nowMs_ + startSeq + i,
        surfaceOp: "append",
        data: {
          id: `${id_}-p${startSeq + i}`,
          role: "user",
          source: { kind: "user" },
          content: [{ type: "text", text: randomBytes(350).toString("hex") }],
        },
      });
    }
  }
  process.stdout.write(String(onDisk));
}
await main();
NODE

# seed_session <project-dir> <hex-uuid> <cwd> <target-bytes> — writes
# $HOME/.dsh/sessions/<project>/<id>/session.v4.jsonl.zstd.
seed_session() {
  local project="$1" id="$2" cwd="$3" target="$4"
  local dir="$FACE_SESSIONS_DIR/$project/$id"
  mkdir -p "$dir"
  local now_ms out size
  now_ms="$(date +%s)000"
  out="$dir/session.v4.jsonl.zstd"
  # Argv layout must match the seeder's destructure: [entryPath, outPath, id,
  # nowMs, targetBytes, cwd] after the script path — the persistence entry
  # goes FIRST, or createRequire resolves the module graph from the session
  # file path and the seeder dies with MODULE_NOT_FOUND.
  size="$(node "$SEED_JS" "$PERSISTENCE_ENTRY" "$out" "$id" "$now_ms" "$target" "$cwd")"
  if [[ -z $size ]]; then
    bad "seeder produced no artifact for $id (seeder fault, not a product one)"
    summary
    exit 1
  fi
  info "seeded $id ($cwd): $size bytes on disk"
}

# --- dependency gate ----------------------------------------------------------
# Face-aware: the plugin face greps the deployed dist-host; the client face
# runs the /src workspace snapshot (grep -r over the sources).
if [ "$E2E_FACE" = client ]; then
  BUNDLE="/src/packages/tui-base/src"
  BUNDLE_GREP=(grep -rqF)
else
  BUNDLE="/usr/local/lib/node_modules/@aiwayds/dsh-opentui/dist-host/index.js"
  BUNDLE_GREP=(grep -qF)
fi
GATE=0
if [ -e "$BUNDLE" ] && "${BUNDLE_GREP[@]}" 'No sessions within the resume window (' "$BUNDLE" 2>/dev/null; then
  GATE=1
  ok 'dependency gate LIT: the face bundle carries the G1 /sessions picker'
else
  warn 'dependency gate DARK: dist-host predates the G1 /sessions picker (rebuild pending) — column groups skipped-by-gate'
fi

# =============================================================================
# G0 — stale-bundle probe (pre-verifiable, runs in BOTH gate states): with a
# seeded non-empty store the OLD picker still opens and lists the big
# session, but must NOT paint the new column headers.
# =============================================================================
rm -rf "$FACE_SESSIONS_DIR"
mkdir -p "$FACE_SESSIONS_DIR"
BIG_ID='b1e2f3a4-0001-4000-8000-000000006801'
STUB_ID='b1e2f3a4-0002-4000-8000-000000006802'
seed_session '--app-alpha--' "$BIG_ID" '/app/alpha' 25000
seed_session '--app-stub--' "$STUB_ID" '/app/stub' 0

start_tui ''
wait_tui_up 180 || summary
ensure_editor_ready 'editor ready before /sessions (G0)' || true

send '/sessions' Enter
sleep 2
PANE="$(capture)"
if wait_pane 'G0: /sessions picker opens over the seeded store' 15 'Resume session'; then
  (( GATE )) || assert_not_contains \
    'G0: stale picker paints no UPDATED column header' \
    'UPDATED' "$PANE"
  (( GATE )) || assert_not_contains \
    'G0: stale picker paints no DIR column header' \
    'DIR' "$PANE"
fi
send Escape
esc_until_gone 'G0: picker closes on Esc' 'Resume session'
quit_tui 'G0 quit' || summary

# =============================================================================
# Phase A (gate lit) — columns + 1KB size floor
# =============================================================================
if (( GATE )); then
  scenario 'Phase A: UPDATED/DIR columns + 1KB size floor'

  start_tui ''
  wait_tui_up 180 || summary
  ensure_editor_ready 'editor ready before /sessions (Phase A)' || true

  send '/sessions' Enter
  if wait_pane 'picker opens (Resume session)' 15 'Resume session'; then
    PANE="$(capture)"
    # Hard assertions (C11): the ungated DialogSelect description (tui-base
    # 5434f84) paints an explicitly passed description below the title even
    # with useNewDesigns() permanently false, so the fitted UPDATED/DIR/
    # SESSION headerLine now renders — verified against the real capture.
    assert_contains 'picker renders the UPDATED column header' 'UPDATED' "$PANE"
    assert_contains 'picker renders the DIR column header' 'DIR' "$PANE"
    assert_contains 'picker renders the SESSION column header' 'SESSION' "$PANE"
    assert_contains 'big session row surfaces with its workspace dir' '/app/alpha' "$PANE"
    assert_not_contains 'tiny stub is hidden by the 1KB size floor' '/app/stub' "$PANE"
  fi
  send Escape
  esc_until_gone 'picker closes on Esc' 'Resume session'
  quit_tui 'Phase A quit' || summary

  # ===========================================================================
  # Phase B (gate lit) — empty-FILTERED copy vs the plain empty-store copy
  # ===========================================================================
  scenario 'Phase B: empty-filtered copy (sessions exist, floor hides them all)'

  # Only the tiny stub remains in the store: the floor hides it, so the
  # picker resolves the empty-filtered branch, never the plain one.
  rm -rf "$FACE_SESSIONS_DIR"
  mkdir -p "$FACE_SESSIONS_DIR"
  seed_session '--app-stub--' "$STUB_ID" '/app/stub' 0

  start_tui ''
  wait_tui_up 180 || summary
  ensure_editor_ready 'editor ready before /sessions (Phase B)' || true

  send '/sessions' Enter
  if wait_pane 'empty-filtered notice appears' 15 'No sessions within the resume window'; then
    PANE="$(capture)"
    assert_contains 'empty-filtered copy names the window' \
      'No sessions within the resume window' "$PANE"
    assert_not_contains 'the stub row must not appear under the floor' \
      '/app/stub' "$PANE"
    assert_not_contains 'must NOT report the plain empty-store copy' \
      'no stored sessions' "$PANE"
  fi
  send Escape
  quit_tui 'Phase B quit' || summary
else
  warn 'Phase A/B skipped-by-gate (dist-host rebuild pending — G1)'
fi

summary
exit 0
