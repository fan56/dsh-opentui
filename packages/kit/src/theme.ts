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
