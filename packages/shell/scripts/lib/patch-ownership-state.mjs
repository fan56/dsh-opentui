/**
 * The patch-ownership sidecar: `profiles/<p>/.patch-ownership.json`.
 *
 * `ancestor` is the TEMPLATE projection adopted by the previous converge pass
 * (never the bytes we wrote) — see design 06 R1/§4.3.1. A missing or corrupt
 * sidecar degrades to base-unknown (carry current), so the file only affects
 * merge direction, never the written values. Written inside the same
 * `package.json.lock` critical section as the patch, tmp+rename, mode 0600.
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const STATE_NAME = '.patch-ownership.json'

export function statePath(profileDir) {
  return join(profileDir, STATE_NAME)
}

/** undefined for ENOENT / corrupt / unknown version (deliberately non-throwing). */
export function readState(profileDir) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(profileDir), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    if (parsed.version !== 1 || parsed.rows === null || typeof parsed.rows !== 'object' || Array.isArray(parsed.rows)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function writeState(profileDir, state, { now = () => new Date().toISOString(), pid = process.pid, stamp = Date.now() } = {}) {
  if (!state || state.version !== 1 || !state.rows) return false
  const path = statePath(profileDir)
  const outgoing = { ...state, writtenAt: now() }
  const tmp = `${path}.tmp-${pid}-${stamp}`
  writeFileSync(tmp, `${JSON.stringify(outgoing, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
  return true
}

export default { STATE_NAME, statePath, readState, writeState }
