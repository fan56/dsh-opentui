/**
 * T8b — migration I/O helper (06 §7.4/§7.5; D6 §二/§三).
 *
 * Split from the pure planner (`migration.mjs`): this module is the only place
 * that touches the filesystem. It never reads `~/.dsh` on its own — every path
 * comes from its arguments, so tests can point it at a scratch home.
 *
 * Contract:
 *   readMigrationInputs({ dshHome, profileDir, templatePatchText })
 *     -> { markerExists, marker, inprocPatchText, opentuiPatchText,
 *          opentuiConfigText, opentuiKeybindingsText, opentuiProviderKeysText }
 *   applyMigrationPlan({ profileDir, plan, version, now = new Date(), backupsOnly = false, skipBackups = false })
 *     -> { wroteConfig, wroteKeybindings, backupsWritten, markerWritten, notices }
 *
 * Hard rules:
 *  - readMigrationInputs is read-only and creates no directory;
 *  - marker present on entry => the legacy files are NEVER read (an EACCES /
 *    EISDIR artifact must not break an already-migrated machine's startup);
 *  - invalid config/keybindings payloads are NOT written to the active files;
 *  - marker is written LAST; any write failure throws before the marker;
 *  - backupsOnly writes ONLY backups (wroteConfig / wroteKeybindings /
 *    markerWritten all stay false) — used to snapshot the source before
 *    converge rewrites it when source B is the target profile;
 *  - skipBackups leaves an existing snapshot untouched on crash re-entry while
 *    still writing config / keybindings / marker;
 *  - marker present on entry => immediate no-op (no overwrite, no notice replay);
 *  - every write is tmp+rename in the target's own directory, mode 0600 for
 *    active files / marker / provider-keys backup, 0644 for other backups;
 *  - equal content is skipped (no mtime churn); a differing backup rotates a
 *    single `.bak` before being overwritten;
 *  - no console output — notices are returned for the caller to print. A
 *    "已备份" claim is dropped unless a matching backup file exists.
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MARKER_NAME = '.migration.json'
export const BACKUP_DIR = '.migrated-from'

function markerPath(profileDir) {
  return join(profileDir, MARKER_NAME)
}

/** Create the new profile lazily, only when there is a payload to write. */
function ensureProfileDir(profileDir) {
  if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true, mode: 0o700 })
}

/** Text of a file, or undefined when it does not exist. Other IO errors throw. */
function readTextIfExists(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return undefined
    throw error
  }
}

/** tmp + rename inside the target's directory; cleanup on any failure. */
function atomicWrite(target, content, mode) {
  const tmp = `${target}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`
  try {
    writeFileSync(tmp, content, { mode })
    renameSync(tmp, target)
  } catch (error) {
    try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
    throw error
  }
}

/** Deterministic JSON with sorted object keys (used only for the marker digest). */
function canonical(value) {
  if (value === undefined || value === null) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

/** sha256 over { marker, backups } — at/version are deliberately excluded. */
function markerDigest(marker, backups) {
  const payload = {
    marker,
    backups: backups.map(({ source, kind, text }) => ({ source, kind, text })),
  }
  return createHash('sha256').update(canonical(payload)).digest('hex')
}

/**
 * A printed notice must match what is actually on disk. The planner emits an
 * "已备份" claim in its invalid config/keybindings notices, but those payloads
 * are never part of `plan.backups` (only patches and provider-keys are) and no
 * backup file is written for them. Drop the false claim in that case; genuine
 * patch / provider-keys backup notices keep their exact wording.
 */
function honestBackupNotices(notices, plan, profileDir) {
  const backedKinds = new Set(
    (Array.isArray(plan.backups) ? plan.backups : []).map((entry) => entry && entry.kind),
  )
  return notices.map((notice) => {
    if (typeof notice !== 'string') return notice
    let text = notice
    for (const name of ['config.json', 'keybindings.json']) {
      if (backedKinds.has(name)) continue
      if (typeof profileDir === 'string' && existsSync(join(profileDir, BACKUP_DIR, `opentui-${name}`))) continue
      text = text.replace(`${name} 解析失败：已备份、`, `${name} 解析失败：`)
    }
    return text
  })
}

/**
 * Read everything the planner needs. No directory creation, no writes.
 * A missing file yields `undefined` for that field; a corrupt marker still sets
 * `markerExists: true` but yields `marker: undefined` (safe direction: block).
 */
export function readMigrationInputs({ dshHome, profileDir, templatePatchText } = {}) {
  const mp = markerPath(profileDir)
  const markerExists = existsSync(mp)
  let marker
  if (markerExists) {
    // Migration is already done: do NOT open ANY legacy file. A source that
    // turned into a directory (EISDIR), lost its read bit (EACCES) or holds a
    // half-written payload must never make every later start fail. A corrupt
    // marker takes the same safe route (marker: undefined => planner no-op).
    try {
      marker = JSON.parse(readFileSync(mp, 'utf8'))
    } catch {
      marker = undefined
    }
    return {
      markerExists: true,
      marker,
      inprocPatchText: undefined,
      opentuiPatchText: undefined,
      opentuiConfigText: undefined,
      opentuiKeybindingsText: undefined,
      opentuiProviderKeysText: undefined,
    }
  }
  const legacy = (name) => join(dshHome, 'profiles', name)
  const opentui = legacy('opentui')
  const inproc = legacy('opentui-inproc')
  return {
    markerExists,
    marker,
    inprocPatchText: readTextIfExists(join(inproc, 'cordis.patch.yml')),
    opentuiPatchText: readTextIfExists(join(opentui, 'cordis.patch.yml')),
    opentuiConfigText: readTextIfExists(join(opentui, 'config.json')),
    opentuiKeybindingsText: readTextIfExists(join(opentui, 'keybindings.json')),
    opentuiProviderKeysText: readTextIfExists(join(opentui, 'provider-keys.json')),
  }
}

/**
 * Apply a plan from `planMigration`. Marker is the last write, so a failure in
 * config / keybindings / backups leaves no marker and the next call re-runs.
 * Files already holding the exact payload are skipped (idempotent re-entry).
 */
export function applyMigrationPlan({ profileDir, plan = {}, version, now = new Date(), backupsOnly = false, skipBackups = false } = {}) {
  const notices = honestBackupNotices(Array.isArray(plan.notices) ? plan.notices : [], plan, profileDir)
  const result = {
    wroteConfig: false,
    wroteKeybindings: false,
    backupsWritten: [],
    markerWritten: false,
    notices,
  }

  // Marker gate: already migrated => no writes and no notice replay.
  if (existsSync(markerPath(profileDir))) {
    return { ...result, notices: [] }
  }

  // ---- active config / keybindings (invalid payloads are never activated) --
  // backupsOnly snapshots the source BEFORE converge rewrites it; it must not
  // activate any payload, so these flags stay false on that path.
  if (!backupsOnly) {
    const active = [
      ['wroteConfig', plan.config, 'config.json'],
      ['wroteKeybindings', plan.keybindings, 'keybindings.json'],
    ]
    if (active.some(([, payload]) => payload && payload.invalid !== true && typeof payload.text === 'string')) {
      ensureProfileDir(profileDir)
    }
    for (const [flag, payload, name] of active) {
      if (!payload || payload.invalid === true || typeof payload.text !== 'string') continue
      const target = join(profileDir, name)
      if (readTextIfExists(target) === payload.text) continue
      atomicWrite(target, payload.text, 0o600)
      result[flag] = true
    }
  }

  // ---- backups (copy into the new profile; old profiles stay untouched) ----
  const backups = Array.isArray(plan.backups) ? plan.backups : []
  if (backups.length > 0 && !skipBackups) {
    const dir = join(profileDir, BACKUP_DIR)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    for (const entry of backups) {
      if (!entry || !entry.source || !entry.kind || typeof entry.text !== 'string') continue
      const mode = entry.kind === 'provider-keys.json' ? 0o600 : 0o644
      const dest = join(dir, `${entry.source}-${entry.kind}`)
      const existing = readTextIfExists(dest)
      if (existing === entry.text) continue
      if (existing !== undefined) atomicWrite(`${dest}.bak`, existing, mode)
      atomicWrite(dest, entry.text, mode)
      result.backupsWritten.push(`${BACKUP_DIR}/${entry.source}-${entry.kind}`)
    }
  }

  // ---- marker: last write, and only when the planner allows it -------------
  if (!backupsOnly && plan.marker && plan.canWriteMarker === true) {
    ensureProfileDir(profileDir)
    const record = {
      from: plan.marker.from,
      at: now.toISOString(),
      version,
      digest: markerDigest(plan.marker, backups),
      migrated: plan.marker.migrated,
      dropped: plan.marker.dropped,
    }
    atomicWrite(markerPath(profileDir), `${JSON.stringify(record, null, 2)}\n`, 0o600)
    result.markerWritten = true
  }

  return result
}

export default { readMigrationInputs, applyMigrationPlan, MARKER_NAME, BACKUP_DIR }
