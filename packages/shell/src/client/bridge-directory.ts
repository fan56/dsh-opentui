/**
 * 025 W2-4b — hand-written seam projections for the directory faces released
 * into the generic arm in W2-4a (plan §4.2): llm/listProviders,
 * llm/listConfigurableProviders and permissionPresets/catalog.
 *
 * DISCIPLINE (R2 / C2 / AMEND-2): SECOND whitelist on top of the bridge wire
 * sanitizer. Only the fields the TUI actually renders cross into the seam —
 * no host object, no baseURL/URL value, no credential value, no unbounded free
 * text. `nativeAuth.env` / `baseURLEnv` are ENV VAR NAMES (safe key names),
 * never resolved values. Every function is pure and unit-testable without a
 * live host, and every hostile key is dropped.
 *
 * llm/discoverModels is NOT projected here: it is in CAP_PROJECTED_BY_HAND, so
 * its generic wire reply is refused with HAND_PROJECTION_REQUIRED. Its
 * AMEND-2 wire SENTINEL obligation is discharged in the W2-4a bridge unit
 * test; the network-dependent method has no UI consumer this batch (registered
 * NOT RUN in the proof backfill) — no dead face is added.
 */
import type {
  SeamPermissionCatalog,
} from "../../../tui-base/src/seams/session"

const MAX_TEXT = 4096
const MAX_SHORT = 240
const MAX_ROWS = 512

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** The generic wire layer wraps arrays/primitives as `{ value: ... }` and
 *  returns plain objects directly. Accept BOTH shapes (same helper shape as
 *  bridge-plugins-manager) so the seam never depends on that subtlety. */
export function unwrapWireValue(raw: unknown): unknown {
  const rec = asRecord(raw)
  if (Object.prototype.hasOwnProperty.call(rec, "value")) return rec.value
  return raw
}

function text(value: unknown, max = MAX_TEXT): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined
}

/** One llm/listProviders row -> `{id, name}` only (result schema: id, name). */
export interface SeamLlmProviderRow {
  id: string
  name: string
}

export function projectLlmProviders(raw: unknown): SeamLlmProviderRow[] {
  const value = unwrapWireValue(raw)
  if (!Array.isArray(value)) return []
  const out: SeamLlmProviderRow[] = []
  for (const entry of value) {
    const row = asRecord(entry)
    const id = text(row.id, MAX_SHORT)
    const name = text(row.name, MAX_SHORT)
    if (id === undefined || id === "" || name === undefined) continue
    out.push({ id, name })
    if (out.length >= MAX_ROWS) break
  }
  return out
}

/** One llm/listConfigurableProviders row -> only the fields the picker shows.
 *  baseURL / URL values are NEVER projected; env key NAMES are kept capped. */
export interface SeamConfigurableProviderRow {
  provider: string
  displayName: string
  settingsNs?: string
  declared?: boolean
  authEnvNames?: string[]
  error?: string
}

function envNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const names: string[] = []
  for (const item of value) {
    if (typeof item === "string" && item.length > 0 && names.length < 16) names.push(item.slice(0, MAX_SHORT))
  }
  return names.length > 0 ? names : undefined
}

export function projectConfigurableProviders(raw: unknown): SeamConfigurableProviderRow[] {
  const value = unwrapWireValue(raw)
  if (!Array.isArray(value)) return []
  const out: SeamConfigurableProviderRow[] = []
  for (const entry of value) {
    const row = asRecord(entry)
    const provider = text(row.provider, MAX_SHORT)
    const displayName = text(row.displayName, MAX_SHORT)
    if (provider === undefined || provider === "" || displayName === undefined) continue
    const projected: SeamConfigurableProviderRow = { provider, displayName }
    const settingsNs = text(row.settingsNs, MAX_SHORT)
    if (settingsNs !== undefined) projected.settingsNs = settingsNs
    if (row.declared === true || row.declared === false) projected.declared = row.declared
    const auth = asRecord(row.nativeAuth)
    const authEnv = envNames(auth.env)
    if (authEnv !== undefined) projected.authEnvNames = authEnv
    const baseEnv = envNames(row.baseURLEnv)
    if (baseEnv !== undefined) {
      projected.authEnvNames = [...(projected.authEnvNames ?? []), ...baseEnv].slice(0, 16)
    }
    const error = text(row.error, MAX_SHORT)
    if (error !== undefined) projected.error = error
    out.push(projected)
    if (out.length >= MAX_ROWS) break
  }
  return out
}

/** permissionPresets/catalog -> SeamPermissionCatalog | undefined.
 *  Mirrors the remote host's honest "absent/malformed -> undefined" semantics
 *  (remote-host-session.ts:1351): an empty catalog is NOT invented. */
function projectOptions(value: unknown): { value: string; name?: string; description?: string }[] {
  if (!Array.isArray(value)) return []
  const out: { value: string; name?: string; description?: string }[] = []
  for (const entry of value) {
    const row = asRecord(entry)
    const key = text(row.value, MAX_SHORT)
    if (key === undefined || key === "") continue
    const opt: { value: string; name?: string; description?: string } = { value: key }
    const name = text(row.name, MAX_SHORT)
    if (name !== undefined) opt.name = name
    const description = text(row.description, MAX_TEXT)
    if (description !== undefined) opt.description = description
    out.push(opt)
    if (out.length >= MAX_ROWS) break
  }
  return out
}

export function projectPermissionCatalog(raw: unknown): SeamPermissionCatalog | undefined {
  const value = unwrapWireValue(raw)
  const rec = asRecord(value)
  const options = projectOptions(rec.options)
  const defaultOptions = projectOptions(rec.defaultOptions)
  const defaultPreset = text(rec.defaultPreset, MAX_SHORT) ?? ""
  if (options.length === 0 && defaultOptions.length === 0 && defaultPreset === "") return undefined
  return { options, defaultOptions, defaultPreset }
}
