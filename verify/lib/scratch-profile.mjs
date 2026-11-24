import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { DEFAULT_PROFILE } from '../../packages/shell/scripts/lib/profile-name.mjs'

/**
 * Run the real in-process provisioner against an isolated scratch DSH_HOME.
 * Never reads or copies the operator's ~/.dsh. Set DSH_OPENTUI_PACKAGE_ROOT to
 * an installed package root to exercise shipped artifacts instead of source.
 */
export function provisionScratchProfile({ home, repo, env = process.env, timeoutMs = 600_000 } = {}) {
  if (!home || !repo) throw new Error('provisionScratchProfile requires home and repo')
  const packageRoot = resolve(env.DSH_OPENTUI_PACKAGE_ROOT || join(repo, 'packages', 'shell'))
  const provisioner = join(packageRoot, 'scripts', 'provision-inproc-profile.mjs')
  const run = spawnSync(process.execPath, [provisioner, '--repair'], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...env, DSH_HOME: home, HOME: home },
  })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  if (run.error || run.status !== 0 || !output.includes('dsh-opentui(inproc): PASS')) {
    throw new Error(`in-process profile provisioning failed (exit=${run.status}):\n${output.slice(-4000)}`)
  }
  return join(home, 'profiles', DEFAULT_PROFILE)
}
