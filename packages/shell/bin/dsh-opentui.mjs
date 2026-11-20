#!/usr/bin/env node
/**
 * Launcher for @aiwayds/dsh-opentui (client mode — the only mode, ADR-0005;
 * the plugin-mode chain was retired in batch B4).
 *
 * Startup chain:
 *   0. Bin-level flags — `--version` prints `dsh-opentui <version>` and
 *      exits 0 BEFORE anything else (no provision, no TUI); `--force` resets
 *      the singleton host before startup continues (needs `--yes` when live
 *      clients are connected; ADR-0009). `--repair-bridge` is a terminal
 *      maintenance command: it clears this profile's stale instances (TERM
 *      then KILL), runs the in-process bridge self-heal (T7), and exits before
 *      any bun/dsh check, TUI launch, or default-seam change; it always runs
 *      full in-process provisioning (bridge is the default since 0.23.0).
 *      All three are consumed by the bin and never forwarded to the client.
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
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { constants as osConstants, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ancestorPids, formatUpgradeUsage, formatUsage, killStaleProcesses, launcherFlagConflict, LAUNCHER_TIMEOUT_FLAGS, parseLauncherArgs, parseLauncherOptions, parseProcessHomes, parseProcessRows, parseUpgradeArgs, prelaunchFailurePolicy, readLauncherVersion, selectStaleProcesses, validateLauncherArgs } from './lib/launcher.mjs'

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
const { version: versionFlag, force: forceFlag, repairBridge: repairBridgeFlag, yes: yesFlag, rest: userArgs, passthrough } = parseLauncherArgs(process.argv.slice(2))

if (versionFlag) {
  const version = readLauncherVersion(pkgRoot)
  if (!version) {
    console.error(`dsh-opentui: could not read the version from ${join(pkgRoot, 'package.json')}.`)
    process.exit(1)
  }
  console.log(`dsh-opentui ${version}`)
  process.exit(0)
}

// P3-3: make flag combinations that used to fall into dead corners explicit.
// Checked here (before the upgrade/help/repair branches) so the same conflict
// wins regardless of which branch a combination would otherwise reach.
const flagConflict = launcherFlagConflict({ force: forceFlag, repairBridge: repairBridgeFlag, yes: yesFlag })
if (flagConflict === 'yes-without-force') {
  console.error('dsh-opentui: --yes is only meaningful together with --force.')
  process.exit(2)
}
if (flagConflict === 'repair-force') {
  console.error('dsh-opentui: --repair-bridge and --force are mutually exclusive; choose one.')
  process.exit(2)
}

// --- 0.5 upgrade subcommand -------------------------------------------------
// `upgrade` is a positional subcommand: only the first remaining argument may
// select it, and here is its ONLY consumer. It must never reach the provision
// forwarder (step 3) or the client (step 6) — the client would take the bare
// `upgrade` for a session name. Placed after `--version` (whose absolute
// short-circuit is unchanged) and BEFORE the bun/dsh checks: upgrading needs
// `npm` and `dsh`, not bun, and must not provision or link anything.
const upgradeResult = parseUpgradeArgs(userArgs)
if (upgradeResult.isUpgrade) {
  // P3-3 ②: the upgrade branch precedes the repair branch, so a stray
  // --repair-bridge used to be silently swallowed. Say so explicitly.
  if (repairBridgeFlag) {
    console.error('dsh-opentui: --repair-bridge is skipped during `upgrade` (no bridge repair on the upgrade path).')
  }
  if (forceFlag) {
    console.error('dsh-opentui: --force is not supported with upgrade.')
    console.error(formatUpgradeUsage())
    process.exit(2)
  }
  if (upgradeResult.error === 'unknown-flag') {
    console.error(`dsh-opentui: unknown flag(s): ${upgradeResult.unknownFlags.join(', ')}`)
    console.error(formatUpgradeUsage())
    process.exit(2)
  }
  if (upgradeResult.error === 'missing-tag-value') {
    console.error('dsh-opentui: --tag requires a non-empty value.')
    console.error(formatUpgradeUsage())
    process.exit(2)
  }
  if (upgradeResult.error === 'invalid-tag') {
    console.error(
      `dsh-opentui: invalid --tag value: ${upgradeResult.invalidTag} (allowed: A-Z a-z 0-9 . _ -)`,
    )
    console.error(formatUpgradeUsage())
    process.exit(2)
  }
  if (upgradeResult.error === 'reset-overrides-conflict') {
    console.error('dsh-opentui: --reset-overrides cannot be combined with --no-self or --no-plugins.')
    console.error(formatUpgradeUsage())
    process.exit(2)
  }
  // Loaded lazily so a normal launch never evaluates the upgrade body.
  const { runUpgrade } = await import(pathToFileURL(join(pkgRoot, 'scripts', 'upgrade.mjs')).href)
  process.exit(runUpgrade(upgradeResult.opts, { pkgRoot }))
}

// --- 0.6 usage/help and argument validation --------------------------------
// Placed after --version (absolute short-circuit) and after `upgrade` (whose
// -h/--help belongs to parseUpgradeArgs), but BEFORE provisioning or any TUI
// work: a typo like `--verison` must fail here instead of running a full
// provision pass first.
function stripLauncherTimeoutFlags(args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const flag = LAUNCHER_TIMEOUT_FLAGS.find((f) => arg === f || arg.startsWith(`${f}=`))
    if (!flag) {
      out.push(arg)
      continue
    }
    // `--flag value`: parseLauncherOptions already verified the value does not
    // start with '-', so it is safe to consume here.
    if (arg === flag) i++
  }
  return out
}

if (userArgs.includes('-h') || userArgs.includes('--help')) {
  console.log(formatUsage())
  process.exit(0)
}

const options = parseLauncherOptions(userArgs)
if (options.error === 'missing-value') {
  console.error(`dsh-opentui: option '${options.errorFlag}' requires a value`)
  console.error(formatUsage())
  process.exit(2)
}
if (options.error === 'invalid-value') {
  console.error(
    `dsh-opentui: invalid value '${options.errorValue}' for '${options.errorFlag}' (expected 1-3600 seconds)`,
  )
  console.error(formatUsage())
  process.exit(2)
}

const validation = validateLauncherArgs(userArgs, { skip: LAUNCHER_TIMEOUT_FLAGS })
if (validation.unknown.length > 0) {
  for (const flag of validation.unknown) {
    console.error(`dsh-opentui: unknown option '${flag}'`)
    // S6: --remote is simply an unknown option (the env escape hatch it once
    // pointed to is gone with the legacy seam). No migration advice.
    if (validation.suggestions[flag]) {
      console.error(`dsh-opentui: did you mean '${validation.suggestions[flag]}'?`)
    }
  }
  console.error(formatUsage())
  process.exit(2)
}

// --- 0.7 --repair-bridge: terminal in-process bridge self-heal (T7) ---------
// This is a maintenance command, not a launch. It invokes the SAME provisioner
// the default startup path uses, in its repair mode. It deliberately exits here
// — before the bun/dsh checks, the default `opentui` profile bootstrap, the
// client-connection link, and the bun client launch — so it never starts a TUI
// and never changes the default seam (that is M2's job). The provisioner owns
// the lock, the repair logic and the T5 identity guard; its exit status is ours.
if (repairBridgeFlag) {
  // Clean up this profile's stale instances first (the old `--force` sweep),
  // scoped to THIS dsh home; the launcher's own process tree is excluded.
  const rows = parseProcessRows(capture('ps', ['-A', '-o', 'pid=,ppid=,command=']))
  const homes = parseProcessHomes(capture('ps', ['eww', '-A', '-o', 'pid=,args=']))
  const stale = selectStaleProcesses(rows, {
    homes,
    home: dshHome,
    excludePids: ancestorPids(rows, process.pid),
  })
  const killed = await killStaleProcesses(stale)
  console.log(`--repair-bridge: killed ${killed.terminated} stale instance(s)`)
  // Then repair the bridge itself; the provisioner owns the lock, repair logic
  // and identity guard, and its exit status is ours.
  const r = spawnSync(process.execPath, [join(pkgRoot, 'scripts', 'provision-inproc-profile.mjs'), '--repair'], {
    stdio: 'inherit',
  })
  if (r.error) {
    console.error(`dsh-opentui: in-process bridge repair failed: ${r.error.message}`)
    process.exit(1)
  }
  process.exit(r.status ?? 0)
}

// Write a timeout to the client env only when the user supplied that flag:
// defaults must not clobber a value already set in the shell environment.
const clientEnv = { ...process.env }
const timeoutEnvNames = {
  bootTimeoutSec: 'DSH_OPENTUI_BOOT_TIMEOUT_MS',
  muxTimeoutSec: 'DSH_OPENTUI_MUX_TIMEOUT_MS',
  connectTimeoutSec: 'DSH_OPENTUI_CONNECT_TIMEOUT_MS',
}
for (const [key, envName] of Object.entries(timeoutEnvNames)) {
  if (options[key] !== undefined) clientEnv[envName] = String(options[key] * 1000)
}

// The client bundle does not understand the launcher's timeout flags; strip
// them and append anything after a `--` verbatim.
const clientArgs = stripLauncherTimeoutFlags(userArgs)
clientArgs.push(...(passthrough ?? []))

// --- 1. bun: hard runtime dependency of the client chain -------------------
if (!spawnSync('which', ['bun'], { encoding: 'utf8' }).stdout.trim()) {
  exitWithGuidance('bun', 'npm i -g bun')
}

// --- 2. dsh: the host CLI carrying the session -----------------------------
if (!spawnSync('which', ['dsh'], { encoding: 'utf8' }).stdout.trim()) {
  exitWithGuidance('the dsh CLI', 'npm i -g @deepseek-ai/dsh')
}

// --- 2.5 --force -----------------------------------------------------------
// NOTE (ADR-0009 decision 8): the old bare `--profile opentui` cmdline sweep
// lived here. It is deliberately removed — killing a process needs the THREE
// evidences (registry pid + `--profile opentui` cmdline + `DSH_OPENTUI_SERVER=1`
// env). `--force` is now handled at step 6a inside the host-launch bundle,
// which also enforces the `--yes` guard when live clients are connected.

// --- 3. Profile bootstrap (every start, best effort, idempotent) -----------
// provision-opentui-profile.mjs is idempotent and understands
// --provider/--model/--reasoning-effort --plugins/--dry-run (both space and
// `=` forms); forward those, ignore the rest. With nothing to do this is a
// local, sub-second pass.
const opentuiProfileDir = join(dshHome, 'profiles', 'opentui')
{
  const provisionFlags = []
  for (const name of ['provider', 'model', 'reasoning-effort']) {
    const inline = userArgs.find((arg) => arg.startsWith(`--${name}=`))
    if (inline) {
      provisionFlags.push(inline)
      continue
    }
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

// --- 3b. In-process bridge profile provisioning ----------------------------
// S6: the bridge is the sole seam, so this runs on EVERY launch. The script
// provisions ONLY the `opentui-inproc` profile: bundle manifest + the shipped
// dist/bridge artifact (real directory copy). A non-zero exit is fatal here
// (the bridge cannot work without it), unlike the best-effort path above.
{
  const r = spawnSync(process.execPath, [join(pkgRoot, 'scripts', 'provision-inproc-profile.mjs')], {
    stdio: 'inherit',
  })
  if (r.error) {
    console.error(`dsh-opentui: in-process profile provisioning failed: ${r.error.message}`)
    process.exit(1)
  }
  if (r.status !== 0) {
    console.error(`dsh-opentui: in-process profile provisioning exited ${r.status}; aborting.`)
    process.exit(1)
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
// --- 6a. Pre-launch the Host service (registry / port / health) ------------
// ADR-0009 §3: start/adopt the singleton host HERE, while the launcher still
// owns the terminal, so the `spawn → booting → ready + elapsed` progress is
// painted BEFORE the bun client enters its alternate screen. The client's own
// lifecycle.ensureHost then adopts the ready host (no double start). On the
// healthy-attach fast path nothing is printed. The orchestration bundle is a
// separate build artifact (packages/shell/dist/host-launch.mjs); a missing or
// failing pre-launch is best-effort — the client retries host boot itself —
// EXCEPT under `--force`, where a failed import/reset is fatal (P1-5).
// `--dry-run` is side-effect free and skips this step.
if (!clientArgs.includes('--dry-run')) {
  try {
    const hostLaunchPath = join(pkgRoot, 'dist', 'host-launch.mjs')
    const { ensureHost: ensureLaunchHost, createLaunchProgress } = await import(pathToFileURL(hostLaunchPath).href)
    await ensureLaunchHost({
      home: dshHome,
      profile: 'opentui',
      cwd: process.cwd(),
      ...(forceFlag ? { force: true } : {}),
      ...(yesFlag ? { yes: true } : {}),
      progress: createLaunchProgress({
        isTty: Boolean(process.stderr.isTTY),
        write: (text) => process.stderr.write(text),
      }),
    })
  } catch (err) {
    // P1-5: a force reset must NEVER silently degrade to a no-op. Only the
    // non-force path is best-effort (the client retries host boot itself).
    const policy = prelaunchFailurePolicy(err, forceFlag)
    if (policy === 'usage-error') {
      console.error(`dsh-opentui: ${err?.message ?? err}`)
      process.exit(2)
    }
    if (policy === 'abort') {
      console.error(`dsh-opentui: --force host pre-launch failed (${err?.message ?? err}); aborting without reset.`)
      process.exit(1)
    }
    console.error(`dsh-opentui: host pre-launch failed (${err?.message ?? err}); the client will retry host boot.`)
  }
}

// ADR-0009 follow-up (PR B): spawnSync blocked the launcher's event loop for
// the whole TUI session, so SIGCHLD could never be delivered — the detached,
// unref'd host child died but stayed a zombie until the client exited. An
// async spawn keeps libuv alive so the host is reaped as soon as it exits.
const child = spawn('bun', [clientEntry, ...clientArgs], {
  stdio: 'inherit',
  env: clientEnv,
  // No `detached`: the client stays in the launcher's foreground process
  // group, preserving TTY / Ctrl-C semantics.
})
child.on('error', (err) => {
  console.error(`dsh-opentui: failed to launch the client: ${err.message}`)
  process.exit(1)
})

// Forward terminal signals to the client; do NOT exit here. We rely on the
// client's handler being idempotent — boot-shared.ts `exitAfterShutdown` is an
// idempotent shutdown + 2.5s grace — so a transitive signal from the tty (the
// client shares our process group) plus this forward cannot strand it. The
// launcher waits for the client to exit, then derives its own exit code below.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    child.kill(signal)
  })
}

// `resolve` forwards only its first argument, so pack both exit-event args.
const [exitCode, signal] = await new Promise((resolve) => child.on('exit', (code, sig) => resolve([code, sig])))
if (signal) {
  // Signal death used to be mis-reported as 0 by `result.status ?? 0`.
  process.exit(128 + (osConstants.signals[signal] ?? 0))
}
process.exit(exitCode ?? 0)
