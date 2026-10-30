/**
 * Feature: theme selection (/theme) — the dark/light grouped picker over
 * the 21 shipped palettes, composed from Kit's Select.
 */
import { themeNames, type SelectItem } from "@dsh-opentui/kit"
import type { OverlayRequest } from "./model-select.tsx"

export interface ThemeSelectDeps {
  t: (key: string, vars?: Record<string, string>) => string
  themeName: () => string
  setThemeName: (v: string) => void
  /** Restore the pre-picker theme (esc preview revert). */
  revertTheme: () => void
}

export function createThemeSelectFeature(deps: ThemeSelectDeps) {
  return {
    open(openOverlay: (req: OverlayRequest) => void) {
      const previous = deps.themeName()
      openOverlay({
        title: deps.t("picker.theme.title"),
        items: themeNames().map(
          (x): SelectItem => ({
            label: x.name,
            group: x.dark ? "dark" : "light",
            value: x.name,
            ...(x.name === deps.themeName() ? { description: deps.t("cmd.model.current") } : {}),
          }),
        ),
        // live preview: the whole UI re-skins as the highlight moves;
        // esc reverts to the pre-picker theme, enter keeps it
        onPreview: (value) => deps.setThemeName(value),
        onSelect: (value) => deps.setThemeName(value),
        onCancel: () => deps.setThemeName(previous),
      })
    },
  }
}
