/**
 * Feature: model selection (/model) — the two-stage picker (provider/model
 * row → reasoning effort), composed from Kit's Select. Owns its overlay
 * payload and selection handling; the Shell opens generic overlays with
 * whatever this feature hands it.
 */
import type { SelectItem } from "@dsh-opentui/kit"
import type { ShellSessionSurface } from "../client/shell-session.ts"

export interface ModelSelectDeps {
  session: ShellSessionSurface
  t: (key: string, vars?: Record<string, string>) => string
  /** Current live route label ("provider/model (effort)"). */
  label: () => string
  setLabel: (v: string) => void
  push: (it: { kind: "system" | "error"; text: string }) => void
  /** Plugin config: favoriteModels pinned to the top (★), hiddenModels
   * dropped from the picker. */
  config: () => { favoriteModels?: string[]; hiddenModels?: string[] }
}

export interface OverlayRequest {
  title: string
  items: SelectItem[]
  onSelect: (value: string) => void
  /** Live preview while the highlight moves (theme picker). */
  onPreview?: (value: string) => void
  /** Esc restore hook (theme picker reverts its preview). */
  onHoverCancel?: () => void
  onCancel?: () => void
}

export function createModelSelectFeature(deps: ModelSelectDeps) {
  /** Provider catalog flattened to one row per model (async, cached by the session). */
  let catalog: { provider: string; models: string[] }[] = []

  const refresh = async () => {
    try {
      catalog = await deps.session.listProviders()
    } catch {
      catalog = []
    }
  }

  return {
    /** /model bare: open stage 1 after refreshing the catalog. */
    async open(openOverlay: (req: OverlayRequest) => void) {
      await refresh()
      const current = deps.label()
      const fav: string[] = deps.config()?.favoriteModels ?? []
      const hidden: string[] = deps.config()?.hiddenModels ?? []
      openOverlay({
        title: deps.t("picker.model.title"),
        items: catalog.flatMap((p) =>
          p.models.filter((m) => !hidden.includes(`${p.provider}/${m}`)).map((m) => {
            const id = `${p.provider}/${m}`
            const isFav = fav.includes(id)
            return {
              label: isFav ? `★ ${m}` : m,
              group: p.provider,
              value: id,
              ...(id === current ? { description: deps.t("cmd.model.current") } : {}),
            }
          }),
        ).sort((a, b) => Number(fav.includes(`${b.group}/${b.value}`)) - Number(fav.includes(`${a.group}/${a.value}`))),
        onSelect: (value) => {
          const [provider, model] = value.split("/")
          if (!provider || !model) return
          // stage 2: reasoning effort for the picked route
          openOverlay({
            title: deps.t("picker.effort.title", { model }),
            items: EFFORTS.map((e) => ({ label: e, value: e, description: deps.t(`picker.effort.${e}.desc`) })),
            onSelect: (effortValue) => {
              const effort = effortValue === "keep" ? undefined : effortValue
              deps.session.switchModel(provider, model, effort)
              deps.setLabel(deps.session.label)
              deps.push({ kind: "system", text: `${deps.t("cmd.model.set")} ${provider}/${model}${effort ? ` (${effort})` : ""} ${deps.t("cmd.model.next")}` })
            },
          })
        },
      })
    },
    /** /model provider/id direct form. */
    direct(provider: string, model: string) {
      if (!provider || !model) {
        deps.push({ kind: "error", text: "usage: /model provider/model-id" })
        return
      }
      deps.session.switchModel(provider, model)
      deps.setLabel(deps.session.label)
      deps.push({ kind: "system", text: `${deps.t("cmd.model.set")} ${provider}/${model} ${deps.t("cmd.model.next")}` })
    },
  }
}

/** Reasoning-effort ladder offered after a model pick ("keep" = default). */
const EFFORTS = ["keep", "low", "medium", "high", "xhigh", "max"]
