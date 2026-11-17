/**
 * Detached all-crash watchdog entry (ADR-0009 decision 6 fallback).
 *
 * Spawned by `spawnWatchdog` with env markers `DSH_OPENTUI_WATCHDOG=1`,
 * `DSH_OPENTUI_WATCHDOG_HOME` and `DSH_OPENTUI_WATCHDOG_PROFILE`, plus the
 * SAME three evidences as the host (`--profile opentui` on argv and
 * `DSH_OPENTUI_SERVER=1`). It polls the heartbeat directory and, after TTL +
 * grace with no fresh client, three-evidence-stops the host, clears the
 * registry, and exits. It also exits on its own the moment the host is gone.
 *
 * Kept a separate tiny bundle so the launcher path stays lean; all logic
 * lives in `client-lifecycle.ts` (unit-tested with injected fakes).
 */

import {
  ENV_WATCHDOG,
  ENV_WATCHDOG_HOME,
  ENV_WATCHDOG_PROFILE,
  nodeLifecycleFs,
  runWatchdog,
} from './client-lifecycle.ts'
import { psKillHooks } from './safe-kill.ts'

const home = process.env[ENV_WATCHDOG_HOME]
const profile = process.env[ENV_WATCHDOG_PROFILE] || 'opentui'

if (process.env[ENV_WATCHDOG] === '1' && home) {
  runWatchdog(home, { fs: nodeLifecycleFs, profile, hooks: psKillHooks })
    .then(() => process.exit(0))
    .catch(() => process.exit(0))
}
