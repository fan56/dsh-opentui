#!/usr/bin/env node
/**
 * postinstall for @aiwayds/dsh-opentui — best-effort setup that NEVER fails
 * the install (always exits 0).
 *
 * NOTE on coverage: pnpm >= 10 skips lifecycle scripts of dependencies by
 * default. When this package is installed INTO a dsh profile (via
 * scripts/install-profile.mjs), this postinstall does not run there. That is
 * acceptable: the `dsh-opentui` bin covers it — it re-runs
 * scripts/install-profile.mjs idempotently on first launch.
 *
 * Job — global installs only (npm_config_global === 'true'): run
 *       scripts/install-profile.mjs to create ~/.dsh/profiles/dsh-opentui.
 *       Failures are warned, never fatal — the bin retries on first run.
 *
 * (The former Job 1 — scripts/link-dsh-closure.mjs, the plugin's
 * @deepseek-ai/* closure link — is gone with the plugin-mode chain.)
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))

// --- Profile bootstrap for global installs only ---
if (process.env.npm_config_global === 'true') {
  const r = spawnSync(process.execPath, [join(pkgRoot, 'scripts', 'install-profile.mjs')], {
    stdio: 'inherit',
  })
  if (r.error || r.status !== 0) {
    console.warn('[dsh-opentui] profile install failed; it will be retried on the first `dsh-opentui` run.')
  }
}

process.exit(0)
