/**
 * Provider/model configuration — reuses the existing dsh config files:
 *   ~/.dsh/model-profiles.json  → current profile + agent model
 *   ~/.dsh/models-store.json    → provider baseUrl + model catalog
 *   ~/.dsh/.credentials.yaml    → API keys under refs/<NAME>_API_KEY
 *
 * Overrides (highest wins): CLI --model provider/model → env
 * DSH_OPENTUI_MODEL → profile workhorse → store's first model.
 */
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface ResolvedModel {
  provider: string
  model: string
  baseUrl: string
  apiKey: string
}

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), ".dsh")

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function readCredentials(): Record<string, string> {
  // credentials.yaml is a small flat YAML; parse only the refs block
  try {
    const text = readFileSync(join(DSH_HOME, ".credentials.yaml"), "utf8")
    const refs: Record<string, string> = {}
    let inRefs = false
    for (const line of text.split("\n")) {
      if (/^refs:/.test(line)) {
        inRefs = true
        continue
      }
      if (inRefs) {
        const m = line.match(/^\s{2}([A-Za-z0-9_]+):\s*(.+)$/)
        if (m) refs[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
        else if (/^\S/.test(line)) break
      }
    }
    return refs
  } catch {
    return {}
  }
}

/** provider id → credential ref name (dsh convention). */
function credRefFor(provider: string): string | null {
  const map: Record<string, string> = {
    "zai-coding-cn": "ZAI_CODING_CN_API_KEY",
    "minimax-cn": "MINIMAX_CN_API_KEY",
    "opencode-go": "OPENROUTER_API_KEY",
    "xiaomi-token-plan-cn": "XIAOMI_TOKEN_PLAN_CN_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
  }
  return map[provider] ?? null
}

export interface ProviderCatalogEntry {
  provider: string
  model: string
  baseUrl: string
}

/** All (provider, model, baseUrl) triples known to the local dsh config. */
export function listModels(): ProviderCatalogEntry[] {
  const store = readJson(join(DSH_HOME, "models-store.json"))
  const out: ProviderCatalogEntry[] = []
  if (store) {
    for (const [provider, entry] of Object.entries<any>(store)) {
      for (const m of entry.models ?? []) {
        if (m.baseUrl) out.push({ provider, model: m.id, baseUrl: m.baseUrl })
      }
    }
  }
  return out
}

export function resolveModel(override?: string): ResolvedModel {
  const catalog = listModels()
  if (!catalog.length) throw new Error("no providers in ~/.dsh/models-store.json")

  let wanted = override ?? process.env.DSH_OPENTUI_MODEL ?? null

  // default: current profile's workhorse agent model
  if (!wanted) {
    const profiles = readJson(join(DSH_HOME, "model-profiles.json"))
    const current = profiles?.profiles?.find((p: any) => p.name === profiles.current)
    const workhorse = current?.agents?.workhorse?.model ?? current?.agents?.[Object.keys(current?.agents ?? {})[0]]?.model
    wanted = workhorse ?? null
  }
  if (!wanted) wanted = `${catalog[0].provider}/${catalog[0].model}`

  const [provider, model] = wanted.includes("/") ? wanted.split("/") : [catalog[0].provider, wanted]
  const providerEntry = catalog.find((c) => c.provider === provider)
  if (!providerEntry) throw new Error(`provider ${provider} not found in models-store`)

  // explicit model id wins even when the local catalog is stale (API accepts it);
  // a bare provider falls back to the catalog's first model
  const entry = { provider, model: model ?? providerEntry.model, baseUrl: providerEntry.baseUrl }

  const ref = credRefFor(entry.provider)
  const apiKey = (ref && readCredentials()[ref]) || process.env.DSH_OPENTUI_API_KEY || ""
  if (!apiKey) throw new Error(`no API key for ${entry.provider} (ref ${ref ?? "none"})`)

  return { provider: entry.provider, model: entry.model, baseUrl: entry.baseUrl.replace(/\/$/, ""), apiKey }
}
