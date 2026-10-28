/**
 * Theme interface — v0 ships one default theme and the seam only.
 * The mechanism (multiple themes, file loading, live switching) is
 * deliberately deferred; components consume tokens, never raw colors,
 * so themes can arrive without touching component code.
 */
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
}

export interface Theme {
  name: string
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
  },
}

/** All shipped themes, keyed by theme name. */
export const themes: Record<string, Theme> = {
  default: defaultTheme,
  "catppuccin-mocha": catppuccinMocha,
}

/** Resolve a theme by name; unknown or missing names fall back to default. */
export function getTheme(name?: string): Theme {
  if (name && themes[name]) return themes[name]!
  return defaultTheme
}
