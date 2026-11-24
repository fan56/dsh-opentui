#!/usr/bin/env node
/**
 * Launcher for @aiwayds/dsh-opentui (client mode — the only mode, ADR-0005;
 * the plugin-mode chain was retired in batch B4).
 *
 * Startup chain:
 *   0. Bin-level flags — `--version` prints `dsh-opentui <version>` and
 *      exits 0 BEFORE anything else (no provision, no TUI); `--force` and
 *      `--yes` are deprecated no-ops, retained for compatibility and removed in
 *      the next minor release. Use `--repair-bridge` to clear stale instances.
 *      `--repair-bridge` is a terminal
 *      maintenance command: it clears this profile's stale instances (TERM
 *      then KILL), runs the in-process bridge self-heal (T7), and exits before
 *      any bun/dsh check, TUI launch, or default-seam change; it always runs
 *      full in-process provisioning (bridge is the default since 0.23.0).
 *      All three are consumed by the bin and never forwarded to the client.
 *   1. bun check — the client bundle runs under bun (FFI, import attributes,
 *      bun export conditions); no bun on PATH → install guidance, exit 1.
 *   2. dsh check — the host CLI is the session carrier (profile storage,
 *      config load); no `dsh` on PATH → install guidance, exit 1.
 *   3. In-process profile bootstrap — runs
 *      scripts/provision-inproc-profile.mjs on EVERY start. The script is
 *      idempotent and prints eight progress steps (host, manifest/patch,
 *      workspace, bridge-copy, companions, verify, identity, shim). A non-zero
 *      exit is fatal because the client cannot use its in-process bridge without
 *      this profile.
 *   4. dsh-client-connection resolution guarantee — the client bundle
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
 *   5. Exec `bun <package root>/dist/client/index.js` with the user's
 *      arguments forwarded verbatim, then exits with the client's status.
 *      There is no HTTP-host pre-launch: the launcher only provisions and
 *      spawns the bun client; the client owns its in-process stdio bridge and
 *      the bridge host child lifecycle. The bridge ships in `dist/bridge/`;
 *      no separate lifecycle-helper artifact is required.
 *
 * Path contract for B3 (package.json wiring): the bin resolves everything
 * relative to ITS OWN LOCATION (bin/..), i.e. the package root. The
 * published package must therefore ship `dist/client/index.js` at the
 * package root alongside `bin/`, `scripts/`, `dist/bridge/`, and
 * `dist/locales/`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { constants as osConstants, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ancestorPids, formatUsage, killStaleProcesses, launcherFlagConflict, LAUNCHER_TIMEOUT_FLAGS, parseLauncherArgs, parseLauncherOptions, parseProcessHomes, parseProcessRows, readLauncherVersion, selectStaleProcesses, validateLauncherArgs } from './lib/launcher.mjs'

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

// --- 0. Bin-level flags: --version short-circuits; --force/--yes parsed -----
// --force / --yes remain parsed for compatibility as deprecated no-ops.
// They are removed in the next minor release; use --repair-bridge for stale cleanup.
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

// Warn once on non-version invocations carrying --force. A standalone --yes
// is a usage error below; beside --force or --repair-bridge it is ignored.
if (forceFlag) {
  console.error('dsh-opentui: --force is deprecated and does nothing in this build; run --repair-bridge to clear stale instances. Removed in the next minor release.')
}

// P3-3: make flag combinations that used to fall into dead corners explicit.
// Checked here (before the help/repair branches) so the same conflict wins
// regardless of which branch a combination would otherwise reach.
const flagConflict = launcherFlagConflict({ force: forceFlag, repairBridge: repairBridgeFlag, yes: yesFlag })
if (flagConflict === 'yes-without-force') {
  console.error('dsh-opentui: --yes is only meaningful together with --force.')
  process.exit(2)
}
if (flagConflict === 'repair-force') {
  console.error('dsh-opentui: --repair-bridge and --force are mutually exclusive; choose one.')
  process.exit(2)
}

// --- 0.5 usage/help and argument validation --------------------------------
// Placed after --version (absolute short-circuit), but BEFORE provisioning or
// any TUI work: a typo like `--verison` must fail here instead of running a
// full provision pass first.
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
// — before the bun/dsh checks, the in-process profile bootstrap, the
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

// --- 2.5 deprecated --force / --yes -----------------------------------------
// Parsed and warned about at step 0, then deliberately inert here in this
// in-process-only build: no process is killed or reset. Both flags are removed
// in the next minor release; stale-instance cleanup belongs to --repair-bridge.

// --- 3. In-process bridge profile provisioning ------------------------------
// The bridge is the sole seam, so this runs on EVERY launch. The script
// provisions ONLY the active in-process profile: bundle manifest + the shipped
// dist/bridge artifact (real directory copy). A non-zero exit is fatal because
// the client cannot use its in-process bridge without this profile.
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

// --- 4. dsh-client-connection resolution guarantee --------------------------
// The client bundle historically imported "@deepseek-ai/dsh-client-connection/client"
// at runtime. That SDK is NOT on the public npm registry — it ships only inside a globally-installed dsh's own
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

// --- 5. Launch the client bundle under bun ---------------------------------
const clientEntry = join(pkgRoot, 'dist', 'client', 'index.js')
if (!existsSync(clientEntry)) {
  console.error(`dsh-opentui: client bundle not found at ${clientEntry}.`)
  console.error('dsh-opentui: reinstall the package (npm i -g @aiwayds/dsh-opentui), or rebuild it with `bun scripts/build-client.mjs` from the repo.')
  process.exit(1)
}
// Async spawn: spawnSync blocked the launcher's event loop for the whole TUI
// session. The detached host child this originally described is gone with
// step 6a; an async spawn still keeps libuv alive for signal forwarding and
// for reaping the bun client as soon as it exits.
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
