#!/usr/bin/env bash
# Scenario 11 — `dsh-opentui upgrade` against a local, offline registry fixture.
#
# What this scenario is for: unit tests inject `run`/`fs`, so they cannot prove
# that `dsh plugin add --save-exact` really forwards the flag to pnpm. This is
# the only leg that exercises the real chain:
#
#   installed bin -> upgrade.mjs -> npm view (fixture) -> dsh plugin add
#   -> pnpm add --save-exact (fixture) -> profile package.json / node_modules
#   -> upgrade-overrides.json -> provision-opentui-profile.mjs
#
# The fixture (e2e/fixtures/upgrade-registry) serves every package in the
# shipped PLUGIN_SET at its pin, plus one patch-bumped version for a chosen
# package. Both the query path (DSH_UPGRADE_REGISTRY) and the install path (the
# scratch profile's .npmrc `registry=`) point at the same 127.0.0.1 server, so
# nothing reaches a real registry. A fixed 2024 `time` in each packument keeps
# pnpm's minimumReleaseAge gate (when enabled) from rejecting the fixture.
#
# Legs (any failure is a hard fail):
#   1. `upgrade --dry-run --no-self` prints the plan (bumped package
#      current -> target, action upgrade) and writes nothing: no node_modules,
#      no lockfile, no override file, profile package.json byte-identical.
#   2. `upgrade --yes --no-self` installs the target version from the fixture,
#      leaves the profile dependency at the EXACT version (not ^x.y.z), and
#      prints the restart hint.
#   3. `$DSH_HOME/profiles/opentui/upgrade-overrides.json` records that
#      package at the installed version.
#   4. A second `upgrade` reports up to date, then provisioning
#      (provision-opentui-profile.mjs) reports the plugin set already satisfied
#      and neither reinstalls nor downgrades the package.
#
# Prerequisites (container only): node, npm, pnpm and a global `dsh` on PATH —
# all part of the e2e image. On a host without /e2e the scenario self-skips the
# way 10-install does. The bin under test is packed from /src and extracted
# into an independent prefix; `npm pack --ignore-scripts` is used because the
# prepack bundle build is unrelated to the upgrade path, and the package is
# extracted by hand because `npm i -g` would fetch the client dependencies from
# a real registry (forbidden here). The upgrade path imports only its own
# scripts and node builtins, so no node_modules is needed.
set -u
. "$(dirname "$0")/../lib/common.sh"
scenario 'upgrade (offline registry fixture: dry-run -> real install -> override -> provisioning)'

PKG_DIR=/src/packages/shell
SCRATCH=/tmp/upgrade-e2e
FIXTURE_DIR="$SCRATCH/fixture"
PREFIX_ROOT="$SCRATCH/prefix"
INSTALL_ROOT="$PREFIX_ROOT/lib/node_modules/@aiwayds/dsh-opentui"
BIN="$INSTALL_ROOT/bin/dsh-opentui.mjs"
SCRATCH_HOME="$SCRATCH/home"
PROFILE_DIR="$SCRATCH_HOME/profiles/opentui"
REG_LOG="$SCRATCH/registry.log"
REG_PID=""

cleanup() {
  if [ -n "$REG_PID" ]; then kill "$REG_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

profile_value() {
  # $1 = "version" of the installed package | "dep" of the bumped dependency.
  node -e '
    const fs = require("node:fs");
    const [kind, profile, name] = process.argv.slice(1);
    if (kind === "version") {
      process.stdout.write(JSON.parse(fs.readFileSync(`${profile}/node_modules/${name}/package.json`, "utf8")).version);
    } else {
      process.stdout.write(String(JSON.parse(fs.readFileSync(`${profile}/package.json`, "utf8")).dependencies?.[name]));
    }
  ' "$1" "$PROFILE_DIR" "$BUMP_NAME" 2>/dev/null
}

if ! in_e2e_container; then
  warn 'host environment detected — skipping (needs the /e2e + /src container layout); container only'
  summary
  exit 0
fi
if [ ! -f "$PKG_DIR/scripts/upgrade.mjs" ]; then
  bad "no $PKG_DIR/scripts/upgrade.mjs in the workspace snapshot (image build contract broken: rebuild the e2e image from this tree)"
  summary
  exit 0
fi
for tool in node npm pnpm dsh; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    bad "required tool '$tool' not found on PATH (e2e image contract broken)"
    summary
    exit 0
  fi
done

rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"

# --- fixture: packuments + tarballs, one patch bump -------------------------
BUMP_NAME='@aiwayds/dsh-cron'
if node /e2e/fixtures/upgrade-registry/build-fixture.mjs \
  --plan "$PKG_DIR/scripts/lib/provision-plan.mjs" \
  --out "$FIXTURE_DIR" --bump "$BUMP_NAME" >"$SCRATCH/build-fixture.log" 2>&1; then
  BUMP_CURRENT="$(node -p 'require(process.argv[1]).bump.current' "$FIXTURE_DIR/meta.json")"
  BUMP_TARGET="$(node -p 'require(process.argv[1]).bump.target' "$FIXTURE_DIR/meta.json")"
  TOTAL_PLUGINS="$(node -p 'require(process.argv[1]).plugins.length' "$FIXTURE_DIR/meta.json")"
  UP_TO_DATE=$((TOTAL_PLUGINS - 1))
  ok "fixture built: $BUMP_NAME $BUMP_CURRENT -> $BUMP_TARGET (shipped pins for the rest)"
else
  bad 'fixture generation failed; tail of log:'
  tail -10 "$SCRATCH/build-fixture.log" | sed 's/^/    | /'
  summary
  exit 0
fi

# --- fixture registry on an ephemeral 127.0.0.1 port ------------------------
node /e2e/fixtures/upgrade-registry/serve.mjs "$FIXTURE_DIR" >"$REG_LOG" 2>&1 &
REG_PID=$!
for _ in $(seq 1 50); do
  grep -q '^REGISTRY ' "$REG_LOG" && break
  sleep 0.1
done
REGISTRY="$(awk '/^REGISTRY /{print $2; exit}' "$REG_LOG")"
if [ -n "$REGISTRY" ]; then
  ok "fixture registry listening at $REGISTRY"
else
  bad 'fixture registry did not start; log tail:'
  tail -10 "$REG_LOG" | sed 's/^/    | /' || true
  summary
  exit 0
fi

# --- scratch profile: deps at shipped pins + the install registry ---------
mkdir -p "$PROFILE_DIR"
node -e '
  const fs = require("node:fs");
  const [fixture, profile, registry] = process.argv.slice(1);
  const meta = JSON.parse(fs.readFileSync(`${fixture}/meta.json`, "utf8"));
  fs.writeFileSync(`${profile}/package.json`, `${JSON.stringify(meta.profile, null, 2)}\n`);
  // The install source. upgrade.mjs resolves its query source from
  // DSH_UPGRADE_REGISTRY; pnpm (spawned by `dsh plugin add` inside the profile
  // directory) resolves its install source from this file. Both must point at
  // the fixture or pnpm would look for the bumped version on a real registry.
  fs.writeFileSync(`${profile}/.npmrc`, `registry=${registry}/\n`);
' "$FIXTURE_DIR" "$PROFILE_DIR" "$REGISTRY"
ok "scratch profile pinned at shipped versions, registry=$REGISTRY"

# --- installed bin under test: pack from /src, extract into a prefix --------
mkdir -p "$SCRATCH/pkg"
if (cd "$PKG_DIR" && npm pack --ignore-scripts --pack-destination "$SCRATCH/pkg") >"$SCRATCH/pack.log" 2>&1; then
  TARBALL="$(ls "$SCRATCH"/pkg/aiwayds-dsh-opentui-*.tgz 2>/dev/null | head -1)"
else
  TARBALL=""
fi
if [ -n "$TARBALL" ] && [ -f "$TARBALL" ]; then
  ok "packed the bin under test: $(basename "$TARBALL")"
else
  bad 'npm pack produced no aiwayds-dsh-opentui-*.tgz; tail of log:'
  tail -10 "$SCRATCH/pack.log" | sed 's/^/    | /'
  summary
  exit 0
fi
mkdir -p "$INSTALL_ROOT" "$PREFIX_ROOT/bin"
if tar -xzf "$TARBALL" --strip-components=1 -C "$INSTALL_ROOT"; then
  chmod +x "$BIN"
  ln -sfn "$BIN" "$PREFIX_ROOT/bin/dsh-opentui"
  ok 'extracted the packed bin into an independent prefix'
else
  bad 'could not extract the packed tarball into the prefix'
  summary
  exit 0
fi
if "$PREFIX_ROOT/bin/dsh-opentui" --version >"$SCRATCH/version.log" 2>&1; then
  ok "installed copy runs: $(cat "$SCRATCH/version.log")"
else
  bad 'the extracted bin cannot print --version; log:'
  cat "$SCRATCH/version.log" | sed 's/^/    | /'
  summary
  exit 0
fi

upgrade() {
  # $1 = output log; remaining args = upgrade flags.
  local log="$1"; shift
  DSH_HOME="$SCRATCH_HOME" DSH_UPGRADE_REGISTRY="$REGISTRY" \
    "$PREFIX_ROOT/bin/dsh-opentui" upgrade "$@" >"$log" 2>&1
}

# --- leg 1: dry-run prints the plan and writes nothing ---------------------
PKG_BEFORE="$(sha256sum "$PROFILE_DIR/package.json" | awk '{print $1}')"
if upgrade "$SCRATCH/dry-run.log" --dry-run --no-self; then
  ok 'upgrade --dry-run exited 0'
else
  bad "upgrade --dry-run exited $?; output tail:"
  tail -15 "$SCRATCH/dry-run.log" | sed 's/^/    | /'
  summary
  exit 0
fi
DRY="$(cat "$SCRATCH/dry-run.log")"
assert_matches 'dry-run plan lists the bumped package current -> target as upgrade' \
  "$BUMP_NAME[[:space:]]+$(printf '%s' "$BUMP_CURRENT" | sed 's/\./\\./g')[[:space:]]+$(printf '%s' "$BUMP_TARGET" | sed 's/\./\\./g')[[:space:]]+upgrade" \
  "$DRY"
assert_contains 'dry-run reports the fixture as the query source' \
  "registry $REGISTRY (source: env)" "$DRY"
assert_contains 'dry-run counts exactly one upgrade' \
  "1 to upgrade, $UP_TO_DATE up to date" "$DRY"
PKG_AFTER="$(sha256sum "$PROFILE_DIR/package.json" | awk '{print $1}')"
if [ "$PKG_BEFORE" = "$PKG_AFTER" ]; then
  ok 'dry-run left the profile package.json byte-identical'
else
  bad 'dry-run modified the profile package.json'
fi
if [ -d "$PROFILE_DIR/node_modules" ] || [ -f "$PROFILE_DIR/pnpm-lock.yaml" ] \
  || [ -f "$PROFILE_DIR/upgrade-overrides.json" ]; then
  bad 'dry-run wrote to disk (node_modules / pnpm-lock.yaml / upgrade-overrides.json appeared)'
else
  ok 'dry-run wrote nothing to disk (no node_modules, no lockfile, no override file)'
fi

# --- leg 2: real install, exact save ---------------------------------------
if upgrade "$SCRATCH/install.log" --yes --no-self; then
  ok 'upgrade --yes exited 0'
else
  bad "upgrade --yes exited $?; output tail:"
  tail -20 "$SCRATCH/install.log" | sed 's/^/    | /'
  summary
  exit 0
fi
INSTALL="$(cat "$SCRATCH/install.log")"
assert_contains 'install output carries the restart hint' 'restart required' "$INSTALL"
INSTALLED_VERSION="$(profile_value version)"
if [ "$INSTALLED_VERSION" = "$BUMP_TARGET" ]; then
  ok "installed package version is the target ($INSTALLED_VERSION)"
else
  bad "installed package version is ${INSTALLED_VERSION:-missing}, expected $BUMP_TARGET"
fi
DEP_SPEC="$(profile_value dep)"
if [ "$DEP_SPEC" = "$BUMP_TARGET" ]; then
  ok "--save-exact reached pnpm: profile dependency stays exact (\"$DEP_SPEC\")"
else
  bad "profile dependency is \"${DEP_SPEC:-missing}\", expected the exact \"$BUMP_TARGET\" — --save-exact did not reach pnpm"
fi
if grep -q "$BUMP_NAME/-/.*-${BUMP_TARGET}.tgz" "$REG_LOG"; then
  ok 'the bumped tarball was fetched from the fixture (no real registry involved)'
else
  bad 'the fixture served no tarball request for the bumped version'
fi

# --- leg 3: the override file records the landed version -------------------
if node -e '
  const fs = require("node:fs");
  const [profile, name, target] = process.argv.slice(1);
  const doc = JSON.parse(fs.readFileSync(`${profile}/upgrade-overrides.json`, "utf8"));
  process.exit(doc.packages?.[name]?.version === target ? 0 : 1);
' "$PROFILE_DIR" "$BUMP_NAME" "$BUMP_TARGET" 2>"$SCRATCH/override.err"; then
  ok "upgrade-overrides.json records $BUMP_NAME at $BUMP_TARGET"
else
  bad "upgrade-overrides.json is missing the $BUMP_NAME entry at $BUMP_TARGET"
fi

# --- leg 4a: a second upgrade is a no-op -----------------------------------
if upgrade "$SCRATCH/rerun.log" --yes --no-self; then
  RERUN="$(cat "$SCRATCH/rerun.log")"
  assert_contains 'second upgrade exits 0 and reports the plugin phase up to date' \
    'plugins: already up to date' "$RERUN"
  assert_contains 'second upgrade reports nothing to do' 'nothing to do' "$RERUN"
else
  bad "second upgrade exited $?; output tail:"
  tail -15 "$SCRATCH/rerun.log" | sed 's/^/    | /'
fi
if [ "$(profile_value version)" = "$BUMP_TARGET" ]; then
  ok 'the bumped package is still at the target after the second upgrade'
else
  bad 'the bumped package changed version after the second upgrade'
fi

# --- leg 4b: provisioning respects the override (no reinstall/downgrade) ---
# Direct call of the same script the launcher runs on every start: the least
# invasive way to trigger provisioning without booting the TUI (and its host).
if DSH_HOME="$SCRATCH_HOME" node "$PKG_DIR/scripts/provision-opentui-profile.mjs" \
  >"$SCRATCH/provision.log" 2>&1; then
  PROV="$(cat "$SCRATCH/provision.log")"
  assert_contains 'provisioning reports the plugin set already satisfied' \
    "already satisfied ($TOTAL_PLUGINS/$TOTAL_PLUGINS)" "$PROV"
else
  bad "provisioning exited $?; output tail:"
  tail -20 "$SCRATCH/provision.log" | sed 's/^/    | /'
  summary
  exit 0
fi
if [ "$(profile_value version)" = "$BUMP_TARGET" ]; then
  ok "provisioning did not reinstall or downgrade $BUMP_NAME (still $BUMP_TARGET)"
else
  bad "provisioning changed $BUMP_NAME to $(profile_value version) (override was not honoured)"
fi
if [ "$(profile_value dep)" = "$BUMP_TARGET" ]; then
  ok 'profile dependency still pins the exact upgraded version after provisioning'
else
  bad 'provisioning rewrote the profile dependency away from the exact upgraded version'
fi

summary
