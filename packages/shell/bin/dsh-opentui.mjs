#!/usr/bin/env node
/**
 * Launcher for @aiwayds/dsh-opentui.
 *
 * 1. Ensures NODE_OPTIONS carries --experimental-ffi (required by OpenTUI's
 *    native FFI bindings). The flag is merged into any existing NODE_OPTIONS
 *    and deduplicated, so it is never appended twice.
 * 2. First-run bootstrap: when ~/.dsh/profiles/dsh-opentui/cordis.patch.yml
 *    is missing, runs scripts/install-profile.mjs to create the profile.
 *    Failures are intentionally non-fatal — dsh itself reports a missing
 *    profile with its own diagnostics; we do not mask or duplicate them.
 * 3. Execs `dsh --profile dsh-opentui ...` with the user's arguments
 *    forwarded verbatim, then exits with dsh's status.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const binDir = dirname(fileURLToPath(import.meta.url))

// --- 1. Merge + dedupe --experimental-ffi into NODE_OPTIONS ---
const FFI_FLAG = '--experimental-ffi'
const flags = (process.env.NODE_OPTIONS || '').split(/\s+/).filter(Boolean)
if (!flags.includes(FFI_FLAG)) flags.push(FFI_FLAG)
const env = { ...process.env, NODE_OPTIONS: flags.join(' ') }

// --- 2. First-run profile bootstrap (best effort) ---
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profilePatch = join(dshHome, 'profiles', 'dsh-opentui', 'cordis.patch.yml')
if (!existsSync(profilePatch)) {
  // install-profile.mjs is idempotent and accepts --provider/--model/...
  // flags; a bare run applies the defaults. Non-blocking on failure.
  spawnSync(process.execPath, [join(binDir, '..', 'scripts', 'install-profile.mjs')], {
    stdio: 'inherit',
    env,
  })
}

// --- 3. Launch dsh with our profile ---
const result = spawnSync('dsh', ['--profile', 'dsh-opentui', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
})
if (result.error) {
  console.error(`dsh-opentui: failed to launch dsh: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 0)
