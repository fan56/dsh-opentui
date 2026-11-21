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
 * llm/discoverModels IS projected here as of 025-w3-2: it remains in
 * CAP_PROJECTED_BY_HAND (the generic wire still refuses it — the AMEND-2 E5
 * SENTINEL test stays in cap-generic-arm.test.ts), but a hand-wired bridge
 * branch now invokes the host adapter and applies a FIXED wire whitelist, and
 * this SECOND projection repeats the whitelist at the seam boundary. Only
 * id/name/contextWindow/maxTokens/inputModalities cross; the request's
 * `apiKey` and the schema-open result never do.
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

/**
 * 025-w3-2 — SECOND whitelist for the hand-wired `llm/discoverModels` face.
 * Mirrors the bridge-side fixed whitelist (`cap-discover-models.ts`): only the
 * five rendered fields cross, from an array (or its `{value:[...]}` wrap).
 * `additionalProperties:true` on the result schema means hostile keys (apiKey,
 * baseURL, token, ...) may hide in any row — every one is dropped here.
 */
export interface SeamDiscoveredModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  inputModalities?: Array<"text" | "image">
}

const MAX_NUM = 10_000_000

function cappedNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(value, MAX_NUM)
    : undefined
}

export function projectDiscoverModels(raw: unknown): SeamDiscoveredModel[] {
  const value = unwrapWireValue(raw)
  if (!Array.isArray(value)) return []
  const out: SeamDiscoveredModel[] = []
  for (const entry of value) {
    const row = asRecord(entry)
    const id = text(row.id, MAX_SHORT)
    if (id === undefined || id === "") continue
    const projected: SeamDiscoveredModel = { id }
    const name = text(row.name, MAX_SHORT)
    if (name !== undefined) projected.name = name
    const cw = cappedNumber(row.contextWindow)
    if (cw !== undefined) projected.contextWindow = cw
    const mt = cappedNumber(row.maxTokens)
    if (mt !== undefined) projected.maxTokens = mt
    if (Array.isArray(row.inputModalities)) {
      const mods = row.inputModalities
        .filter((m): m is "text" | "image" => m === "text" || m === "image")
        .slice(0, 4)
      if (mods.length > 0) projected.inputModalities = mods
    }
    out.push(projected)
    if (out.length >= MAX_ROWS) break
  }
  return out
}
