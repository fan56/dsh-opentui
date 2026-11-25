import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { DEFAULT_PROFILE } from '../../packages/shell/scripts/lib/profile-name.mjs'

/**
 * Run the real in-process provisioner against an isolated scratch DSH_HOME.
 * Never reads or copies the operator's ~/.dsh. Set DSH_OPENTUI_PACKAGE_ROOT to
 * an installed package root to exercise shipped artifacts instead of source.
 */
export function provisionScratchProfile({ home, repo, env = process.env, timeoutMs = 600_000, companions } = {}) {
  if (!home || !repo) throw new Error('provisionScratchProfile requires home and repo')
  const packageRoot = resolve(env.DSH_OPENTUI_PACKAGE_ROOT || join(repo, 'packages', 'shell'))
  const provisioner = join(packageRoot, 'scripts', 'provision-inproc-profile.mjs')
  // R6 (additive): an explicit companion selection can be staged into the
  // scratch provision env. `registry` is the catalog id of
  // @aiwayds/dsh-subagent-registry, the bundle that mounts the real
  // `use_agent` / `ask_agent` tools. Absent/empty keeps the D2 default roster
  // byte-for-byte, so every pre-existing scenario is unaffected.
  const provisionEnv = { ...env, DSH_HOME: home, HOME: home }
  if (typeof companions === 'string' && companions.trim() !== '') {
    provisionEnv.DSH_OPENTUI_COMPANIONS = companions.trim()
    // An explicit list must not be overridden by the master switch inherited
    // from the operator shell; `on` is the policy default for a fresh home.
    if (['0', 'false', 'off'].includes(String(provisionEnv.DSH_OPENTUI_COMPANION_LATEST ?? '').trim().toLowerCase())) {
      provisionEnv.DSH_OPENTUI_COMPANION_LATEST = 'on'
    }
  }
  const run = spawnSync(process.execPath, [provisioner, '--repair'], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: provisionEnv,
  })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  if (run.error || run.status !== 0 || !output.includes('dsh-opentui(inproc): PASS')) {
    throw new Error(`in-process profile provisioning failed (exit=${run.status}):\n${output.slice(-4000)}`)
  }
  return join(home, 'profiles', DEFAULT_PROFILE)
}
