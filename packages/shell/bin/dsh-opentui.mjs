#!/usr/bin/env node
/**
 * Launcher for @aiwayds/dsh-opentui (client mode — the only mode, ADR-0005;
 * the plugin-mode chain was retired in batch B4).
 *
 * Startup chain:
 *   0. Bin-level flags — `--version` prints `dsh-opentui <version>` and
 *      exits 0 BEFORE anything else (no provision, no TUI); `--force` kills
 *      this profile's stale instances (resident dsh host + bun client, TERM
 *      then KILL) before startup continues. Both are consumed by the bin
 *      and never forwarded to the client.
 *   1. bun check — the client bundle runs under bun (FFI, import attributes,
 *      bun export conditions); no bun on PATH → install guidance, exit 1.
 *   2. dsh check — the host CLI is the session carrier (profile storage,
 *      config load); no `dsh` on PATH → install guidance, exit 1.
 *   3. Profile bootstrap — runs scripts/provision-opentui-profile.mjs on
 *      EVERY start. The script is idempotent and prints five progress steps
 *      (profile, model route, plugins, bundles, verify); with nothing to do
 *      it is a sub-second local pass. It transparently forwards
 *      --provider/--model/--reasoning-effort and
 *      --plugins=core|recommended|none (--dry-run prints the commands without
 *      executing them). A non-zero exit is a WARN: the client still starts
 *      with the profile as-is.
 *   4. One-time migration notice — a pre-retirement profile at
 *      $DSH_HOME/profiles/dsh-opentui is detected once, its theme /
 *      config.json preferences are conservatively copied into the opentui
 *      profile (only keys the target does not already have), a marker file
 *      ($DSH_HOME/.dsh-opentui-migrated) makes the step once-only. The old
 *      profile is kept untouched.
 *   5. dsh-client-connection resolution guarantee — the client bundle
 *      imports `@deepseek-ai/dsh-client-connection/client` at runtime, but
 *      that SDK is NOT on the public npm registry (it exists only inside a
 *      globally-installed dsh's node_modules closure, and it must NEVER be
 *      bundled into this public package — DeepSeek private code). When the
 *      bundle's module resolution would fail (no node_modules link in this
 *      package), the bin creates one — a symlink from
 *      <package root>/node_modules/@deepseek-ai/dsh-client-connection to
 *      the SDK inside the global dsh closure. Idempotent: skipped whenever
 *      the link already resolves; if no global dsh closure can be located,
 *      install guidance is printed and the launch aborts (exit 1).
 *   6. Exec `bun <package root>/dist/client/index.js` with the user's
 *      arguments forwarded verbatim, then exits with the client's status.
 *
 * Path contract for B3 (package.json wiring): the bin resolves everything
 * relative to ITS OWN LOCATION (bin/..), i.e. the package root. The
 * published package must therefore ship `dist/client/index.js` at the
 * package root (plus `dist/scripts/idle-reaper.mjs`, which the bundle
 * spawns) alongside `bin/` and `scripts/`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ancestorPids, killStaleProcesses, parseLauncherArgs, parseProcessHomes, parseProcessRows, readLauncherVersion, selectStaleProcesses } from './lib/launcher.mjs'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')

function exitWithGuidance(what, installCmd) {
  console.error(`dsh-opentui: ${what} is required but was not found on PATH.`)
  console.error(`dsh-opentui: install it with:  ${installCmd}`)
  process.exit(1)
}

/** Run a helper command and return its stdout ('' on failure). */
function capture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return r.stdout ?? ''
}

// --- 0. Bin-level flags: --version short-circuits, --force pre-clears -------
const { version: versionFlag, force: forceFlag, rest: userArgs } = parseLauncherArgs(process.argv.slice(2))

if (versionFlag) {
  const version = readLauncherVersion(pkgRoot)
  if (!version) {
    console.error(`dsh-opentui: could not read the version from ${join(pkgRoot, 'package.json')}.`)
    process.exit(1)
  }
  console.log(`dsh-opentui ${version}`)
  process.exit(0)
}

// --- 1. bun: hard runtime dependency of the client chain -------------------
if (!spawnSync('which', ['bun'], { encoding: 'utf8' }).stdout.trim()) {
  exitWithGuidance('bun', 'npm i -g bun')
}

// --- 2. dsh: the host CLI carrying the session -----------------------------
if (!spawnSync('which', ['dsh'], { encoding: 'utf8' }).stdout.trim()) {
  exitWithGuidance('the dsh CLI', 'npm i -g @deepseek-ai/dsh')
}

// --- 2.5 --force: kill this profile's stale instances before starting ------
// Matches the opentui-profile host (`node <...>/dsh --profile opentui ...`)
// and the dsh-opentui client (source entry or published bundle) by command
// line, scoped to THIS dsh home (see lib/launcher.mjs SCOPE). The launcher's
// own process tree is excluded; TERM first, then KILL for survivors.
if (forceFlag) {
  const rows = parseProcessRows(capture('ps', ['-A', '-o', 'pid=,ppid=,command=']))
  const homes = parseProcessHomes(capture('ps', ['eww', '-A', '-o', 'pid=,args=']))
  const stale = selectStaleProcesses(rows, {
    homes,
    home: dshHome,
    excludePids: ancestorPids(rows, process.pid),
  })
  const result = await killStaleProcesses(stale)
  console.log(`--force: killed ${result.terminated} stale instance(s)`)
}

// --- 3. Profile bootstrap (every start, best effort, idempotent) -----------
// provision-opentui-profile.mjs is idempotent and understands
// --provider/--model/--reasoning-effort --plugins/--dry-run; forward those,
// ignore the rest. With nothing to do this is a local, sub-second pass.
const opentuiProfileDir = join(dshHome, 'profiles', 'opentui')
{
  const provisionFlags = []
  for (const name of ['provider', 'model', 'reasoning-effort']) {
    const i = userArgs.indexOf(`--${name}`)
    if (i >= 0 && userArgs[i + 1]) provisionFlags.push(`--${name}`, userArgs[i + 1])
  }
  const pluginsInline = userArgs.find((arg) => arg.startsWith('--plugins='))
  if (pluginsInline) {
    provisionFlags.push(pluginsInline)
  } else {
    const i = userArgs.indexOf('--plugins')
    if (i >= 0 && userArgs[i + 1]) provisionFlags.push('--plugins', userArgs[i + 1])
  }
  if (userArgs.includes('--dry-run')) provisionFlags.push('--dry-run')
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

// --- 5. dsh-client-connection resolution guarantee --------------------------
// The client bundle imports "@deepseek-ai/dsh-client-connection/client" at
// runtime (packages/shell/src/client/transport.ts). That SDK is NOT on the
// public npm registry — it ships only inside a globally-installed dsh's own
// node_modules closure, and it must NEVER be bundled into this public
// package (that would redistribute DeepSeek private code). A plain npm
// global install of this package does not make the closure reachable: module
// resolution from <prefix>/node_modules/@aiwayds/dsh-opentui stops at the
// global node_modules and never enters the dsh package's nested
// node_modules. So the bin bridges the gap itself: symlink the SDK from the
// global dsh closure into this package's node_modules. Idempotent — a no-op
// whenever the link already resolves.
ensureClientConnectionSdk()

function ensureClientConnectionSdk() {
  const linkDir = join(pkgRoot, 'node_modules', '@deepseek-ai')
  const linkPath = join(linkDir, 'dsh-client-connection')
  if (existsSync(join(linkPath, 'package.json'))) return
  // Stale or broken link from an earlier run (or an uninstalled closure) —
  // clear it so the symlink below can be re-created.
  try {
    lstatSync(linkPath)
    unlinkSync(linkPath)
  } catch {
    /* nothing to clear */
  }
  for (const candidate of dshClientConnectionCandidates()) {
    if (!existsSync(join(candidate, 'package.json'))) continue
    try {
      mkdirSync(linkDir, { recursive: true })
      symlinkSync(candidate, linkPath, 'dir')
    } catch (err) {
      console.error(`dsh-opentui: could not link @deepseek-ai/dsh-client-connection: ${err?.message ?? err}`)
      process.exit(1)
    }
    console.log(`dsh-opentui: linked @deepseek-ai/dsh-client-connection from the global dsh closure (${candidate}).`)
    return
  }
  console.error('dsh-opentui: the client needs @deepseek-ai/dsh-client-connection, which is not on the public npm registry —')
  console.error('dsh-opentui: it ships inside a globally-installed dsh CLI, but no dsh installation was found.')
  console.error('dsh-opentui: install (or reinstall) the dsh CLI first:  npm i -g @deepseek-ai/dsh')
  process.exit(1)
}

/** Candidate paths of the SDK inside a global dsh closure, best first. */
function dshClientConnectionCandidates() {
  const candidates = []
  // (a) npm's global root: <npm root -g>/@deepseek-ai/dsh/node_modules/...
  const npmRoot = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' }).stdout?.trim()
  if (npmRoot) {
    candidates.push(join(npmRoot, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-connection'))
  }
  // (b) derived from the `dsh` bin on PATH (covers a dsh installed under a
  //     different prefix than the npm on PATH resolves to): realpath the
  //     bin, then walk up to the package dir whose package.json names
  //     @deepseek-ai/dsh.
  const dshBin = spawnSync('which', ['dsh'], { encoding: 'utf8' }).stdout?.trim()
  if (dshBin) {
    try {
      let dir = dirname(realpathSync(dshBin))
      for (let i = 0; i < 8 && dir !== dirname(dir); i++) {
        try {
          if (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))?.name === '@deepseek-ai/dsh') {
            candidates.push(join(dir, 'node_modules', '@deepseek-ai', 'dsh-client-connection'))
            break
          }
        } catch {
          /* not a package dir — keep walking up */
        }
        dir = dirname(dir)
      }
    } catch {
      /* unresolvable dsh bin — candidate (a) may still hit */
    }
  }
  return candidates
}

// --- 6. Launch the client bundle under bun ---------------------------------
const clientEntry = join(pkgRoot, 'dist', 'client', 'index.js')
if (!existsSync(clientEntry)) {
  console.error(`dsh-opentui: client bundle not found at ${clientEntry}.`)
  console.error('dsh-opentui: reinstall the package (npm i -g @aiwayds/dsh-opentui), or rebuild it with `bun scripts/build-client.mjs` from the repo.')
  process.exit(1)
}
const result = spawnSync('bun', [clientEntry, ...userArgs], {
  stdio: 'inherit',
})
if (result.error) {
  console.error(`dsh-opentui: failed to launch the client: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 0)
