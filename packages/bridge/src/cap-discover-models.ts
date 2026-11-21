/**
 * 025-w3-2 — hand-written WIRE projection for `llm/discoverModels`, the one
 * `CAP_PROJECTED_BY_HAND` id (AMEND-2). The generic projector refuses it with
 * HAND_PROJECTION_REQUIRED, so a dedicated hand-wired bridge branch invokes
 * the host adapter and projects here. Only the five fields the TUI renders
 * cross; the result jsonSchema has `additionalProperties: true` and the REQUEST
 * carries `apiKey`, so neither may ever ride a frame verbatim. The seam applies
 * a SECOND whitelist on top (`bridge-directory.ts`).
 */

const MAX_SHORT = 240
const MAX_TEXT = 4096
const MAX_ROWS = 512
const MAX_NUM = 10_000_000

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown, max = MAX_TEXT): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined
}

function cappedNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(value, MAX_NUM)
    : undefined
}

export interface WireDiscoveredModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  inputModalities?: Array<"text" | "image">
}

/** Fixed whitelist; hostile / schema-open keys are dropped, never painted. */
export function projectDiscoverModelsForWire(raw: unknown): WireDiscoveredModel[] {
  // The generic wire wraps arrays as { value: [...] }; accept both shapes.
  const rec = asRecord(raw)
  const value = Object.prototype.hasOwnProperty.call(rec, "value") ? rec.value : raw
  if (!Array.isArray(value)) return []
  const out: WireDiscoveredModel[] = []
  for (const entry of value) {
    const row = asRecord(entry)
    const id = text(row.id, MAX_SHORT)
    if (id === undefined || id === "") continue
    const projected: WireDiscoveredModel = { id }
    const name = text(row.name, MAX_SHORT)
    if (name !== undefined) projected.name = name
    const cw = cappedNumber(row.contextWindow)
    if (cw !== undefined) projected.contextWindow = cw
    const mt = cappedNumber(row.maxTokens)
    if (mt !== undefined) projected.maxTokens = mt
    if (Array.isArray(row.inputModalities)) {
      const mods = row.inputModalities.filter((m): m is "text" | "image" => m === "text" || m === "image").slice(0, 4)
      if (mods.length > 0) projected.inputModalities = mods
    }
    out.push(projected)
    if (out.length >= MAX_ROWS) break
  }
  return out
}
