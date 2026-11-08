#!/usr/bin/env node
/**
 * Launcher for @aiwayds/dsh-opentui (client mode — the only mode, ADR-0005;
 * the plugin-mode chain was retired in batch B4).
 *
 * Startup chain:
 *   1. bun check — the client bundle runs under bun (FFI, import attributes,
 *      bun export conditions); no bun on PATH → install guidance, exit 1.
 *   2. dsh check — the host CLI is the session carrier (profile storage,
 *      config load); no `dsh` on PATH → install guidance, exit 1.
 *   3. Profile bootstrap — when $DSH_HOME/profiles/opentui is missing, runs
 *      scripts/provision-opentui-profile.mjs (idempotent; transparently
 *      forwards --provider/--model/--reasoning-effort).
 *   4. One-time migration notice — a pre-retirement profile at
 *      $DSH_HOME/profiles/dsh-opentui is detected once, its theme /
 *      config.json preferences are conservatively copied into the opentui
 *      profile (only keys the target does not already have), a marker file
 *      ($DSH_HOME/.dsh-opentui-migrated) makes the step once-only. The old
 *      profile is kept untouched.
 *   5. Exec `bun <package root>/dist/client/index.js` with the user's
 *      arguments forwarded verbatim, then exits with the client's status.
 *
 * Path contract for B3 (package.json wiring): the bin resolves everything
 * relative to ITS OWN LOCATION (bin/..), i.e. the package root. The
 * published package must therefore ship `dist/client/index.js` at the
 * package root (plus `dist/scripts/idle-reaper.mjs`, which the bundle
 * spawns) alongside `bin/` and `scripts/`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')

function exitWithGuidance(what, installCmd) {
  console.error(`dsh-opentui: ${what} is required but was not found on PATH.`)
  console.error(`dsh-opentui: install it with:  ${installCmd}`)
  process.exit(1)
}

// --- 1. bun: hard runtime dependency of the client chain -------------------
if (!spawnSync('which', ['bun'], { encoding: 'utf8' }).stdout.trim()) {
  exitWithGuidance('bun', 'npm i -g bun')
}

// --- 2. dsh: the host CLI carrying the session -----------------------------
if (!spawnSync('which', ['dsh'], { encoding: 'utf8' }).stdout.trim()) {
  exitWithGuidance('the dsh CLI', 'npm i -g @deepseek-ai/dsh')
}

// --- 3. Profile bootstrap (best effort, idempotent) ------------------------
const opentuiProfileDir = join(dshHome, 'profiles', 'opentui')
if (!existsSync(opentuiProfileDir)) {
  // provision-opentui-profile.mjs is idempotent and understands
  // --provider/--model/--reasoning-effort; forward those, ignore the rest.
  const userArgs = process.argv.slice(2)
  const provisionFlags = []
  for (const name of ['provider', 'model', 'reasoning-effort']) {
    const i = userArgs.indexOf(`--${name}`)
    if (i >= 0 && userArgs[i + 1]) provisionFlags.push(`--${name}`, userArgs[i + 1])
  }
  const r = spawnSync(process.execPath, [join(pkgRoot, 'scripts', 'provision-opentui-profile.mjs'), ...provisionFlags], {
    stdio: 'inherit',
  })
  if (r.error) {
    console.error(`dsh-opentui: profile provisioning failed: ${r.error.message}`)
    process.exit(1)
  }
  if (r.status !== 0) {
    console.error(`dsh-opentui: profile provisioning exited ${r.status}; continuing with the profile as-is.`)
  }
}

// --- 4. One-time migration notice from the pre-retirement profile ----------
const legacyProfileDir = join(dshHome, 'profiles', 'dsh-opentui')
const migrationMarker = join(dshHome, '.dsh-opentui-migrated')
if (existsSync(legacyProfileDir) && !existsSync(migrationMarker)) {
  console.log('dsh-opentui: found a legacy profiles/dsh-opentui profile (pre-retirement plugin mode).')
  console.log('dsh-opentui: the client now uses the \'opentui\' profile; the legacy profile is kept, not deleted.')
  try {
    migrateLegacyPreferences()
  } catch (err) {
    console.warn(`dsh-opentui: preference migration skipped (${err?.message ?? err}); the legacy profile is untouched.`)
  }
  try {
    writeFileSync(migrationMarker, new Date().toISOString() + '\n')
  } catch (err) {
    console.warn(`dsh-opentui: could not write ${migrationMarker} (${err?.message ?? err}).`)
  }
}

/** Best-effort copy of legacy preferences into the opentui profile.
 *  Merge-only: a key already present in the target config.json wins; the
 *  legacy profile files are only ever read, never modified. */
function migrateLegacyPreferences() {
  const legacyConfigPath = join(legacyProfileDir, 'config.json')
  const targetConfigPath = join(opentuiProfileDir, 'config.json')

  let target = {}
  try {
    target = JSON.parse(readFileSync(targetConfigPath, 'utf8'))
  } catch {
    /* missing or unparsable → start from an empty object */
  }

  // (a) top-level keys from the legacy profile config.json (e.g.
  //     retentionDays): copied only when the target does not have them.
  let legacyConfig = {}
  try {
    legacyConfig = JSON.parse(readFileSync(legacyConfigPath, 'utf8'))
  } catch {
    /* no legacy config.json — nothing to copy from here */
  }
  if (typeof legacyConfig !== 'object' || legacyConfig === null || Array.isArray(legacyConfig)) legacyConfig = {}

  // (b) the theme preference lived in the legacy plugin patch (the retired
  //     `dsh-opentui` plugin's config block), not in config.json — pull it
  //     out with a narrow scan of that block only.
  let legacyTheme
  try {
    const patch = readFileSync(join(legacyProfileDir, 'cordis.patch.yml'), 'utf8')
    const block = patch.match(/- id: dsh-opentui\b[^\n]*/)?.[0]
    if (block) {
      const tail = patch.slice(patch.indexOf(block))
      legacyTheme = tail.match(/^[ \t]+theme:[ \t]*([^\s#]+)/m)?.[1]
    }
  } catch {
    /* no legacy patch — no theme to copy */
  }
  if (legacyTheme) legacyTheme = legacyTheme.replace(/^['"]|['"]$/g, '')

  const additions = {}
  for (const [key, value] of Object.entries(legacyConfig)) {
    if (!(key in target)) additions[key] = value
  }
  if (legacyTheme && target.theme === undefined) additions.theme = legacyTheme

  const keys = Object.keys(additions)
  if (keys.length === 0) {
    console.log('dsh-opentui: no legacy preferences to carry over.')
    return
  }

  mkdirSync(opentuiProfileDir, { recursive: true })
  if (existsSync(targetConfigPath)) {
    const backupPath = `${targetConfigPath}.bak-${Date.now()}`
    renameSync(targetConfigPath, backupPath)
    console.log(`dsh-opentui: backed up ${targetConfigPath} to ${backupPath}`)
  }
  const merged = { ...target, ...additions }
  writeFileSync(targetConfigPath, JSON.stringify(merged, null, 2) + '\n')
  console.log(`dsh-opentui: carried over legacy preference(s) [${keys.join(', ')}] into ${targetConfigPath}.`)
}

// --- 5. Launch the client bundle under bun ---------------------------------
const clientEntry = join(pkgRoot, 'dist', 'client', 'index.js')
if (!existsSync(clientEntry)) {
  console.error(`dsh-opentui: client bundle not found at ${clientEntry}.`)
  console.error('dsh-opentui: reinstall the package (npm i -g @aiwayds/dsh-opentui), or rebuild it with `bun scripts/build-client.mjs` from the repo.')
  process.exit(1)
}
const result = spawnSync('bun', [clientEntry, ...process.argv.slice(2)], {
  stdio: 'inherit',
})
if (result.error) {
  console.error(`dsh-opentui: failed to launch the client: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 0)
