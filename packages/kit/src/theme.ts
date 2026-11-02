/**
 * Theme interface and the shipped theme table. Most palettes come from
 * themes-data.ts (generated from the dsh-tui-pi theme JSONs); components
 * consume tokens, never raw colors, so themes can change without touching
 * component code.
 */
import { generatedThemes } from "./themes-data.ts"
import { opencodeThemes } from "./themes-opencode.ts"

export interface ThemeTokens {
  /** Primary accent (titles, selection). */
  accent: string
  /** Dim / secondary text (hints, borders). */
  dim: string
  /** Error red. */
  danger: string
  /** Success green. */
  ok: string
  /** Warning amber. */
  warn: string
  /** Body text. */
  text: string
  /** Panel border color. */
  border: string
  /** Selection highlight background (optional extension). */
  selection?: string
  /** User message prefix color (optional extension). */
  userMark?: string
  /** Tool success state color (optional extension). */
  toolOk?: string
  /** Tool failure state color (optional extension). */
  toolFail?: string
  /** Approval card border color (optional extension). */
  approvalBorder?: string
  /** Thinking / reasoning highlight color (optional extension; consumed by ThinkWidget). */
  thinking?: string
}

export interface Theme {
  name: string
  /**
   * Whether the theme targets dark terminals (pickers group by this flag).
   * Defaults to true when omitted. Generated themes carry the flag from
   * their source JSON.
   */
  dark?: boolean
  tokens: ThemeTokens
}

export const defaultTheme: Theme = {
  name: "default",
  tokens: {
    accent: "#00ff88",
    dim: "#666666",
    danger: "#ff5555",
    ok: "#50fa7b",
    warn: "#ffb86c",
    text: "#eeeeee",
    border: "#444444",
  },
}

/** Catppuccin Mocha palette. Background is left to the terminal itself. */
export const catppuccinMocha: Theme = {
  name: "catppuccin-mocha",
  dark: true,
  tokens: {
    accent: "#a6e3a1", // green
    dim: "#6c7086", // overlay0
    danger: "#f38ba8", // red
    ok: "#a6e3a1", // green
    warn: "#f9e2af", // yellow
    text: "#cdd6f4", // text
    border: "#45475a", // surface1
    selection: "#313244", // surface0
    userMark: "#89b4fa", // blue
    toolOk: "#f9e2af", // yellow
    toolFail: "#f38ba8", // red
    approvalBorder: "#f9e2af", // yellow
    thinking: "#cba6f7", // mauve
  },
}

/**
 * All shipped themes, keyed by theme name: the 20 generated palettes plus
 * the hand-tuned default. The hand-written catppuccin-mocha stays the
 * authority over its generated twin (their accent/dim tokens differ), which
 * is why it is assigned after the generated spread.
 */
export const themes: Record<string, Theme> = {
  default: defaultTheme,
  ...generatedThemes,
  ...Object.fromEntries(opencodeThemes.map((t) => [t.name, t])),
  "catppuccin-mocha": catppuccinMocha,
}

/** Resolve a theme by name; unknown or missing names fall back to default. */
export function getTheme(name?: string): Theme {
  if (name && themes[name]) return themes[name]!
  return defaultTheme
}

/** Names of all shipped themes with their dark/light flag, for pickers. */
export function themeNames(): { name: string; dark: boolean }[] {
  return Object.values(themes).map((theme) => ({ name: theme.name, dark: theme.dark ?? true }))
}
