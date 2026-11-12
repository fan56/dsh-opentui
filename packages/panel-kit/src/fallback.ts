/**
 * fallback.ts — the only palette literal in @dsh-opentui/panel-kit.
 *
 * Used when no PanelKitProvider is present (static demos, unit tests), the
 * same pattern as tui-base's SKIN_FALLBACK (skin/semantic.ts:26-42, spec §7.2).
 * Everything else resolves colors through `PanelTheme`; tests grep the package
 * and fail on hex/RGBA.fromInts anywhere outside this file.
 *
 * Adapted from @opencode/tui, Copyright 2025 opencode, MIT.
 */
import { RGBA, TextAttributes } from "@opentui/core"
import type { PanelTheme } from "./contracts"

const surface = RGBA.fromHex("#1a1b26")
const raised = RGBA.fromHex("#24283b")
const base = RGBA.fromHex("#c0caf5")
const muted = RGBA.fromHex("#a9b1d6")
const faint = RGBA.fromHex("#565f89")
const accent = RGBA.fromHex("#7aa2f7")
const disabled = RGBA.fromHex("#414868")
const danger = RGBA.fromHex("#f7768e")
const warning = RGBA.fromHex("#e0af68")
const success = RGBA.fromHex("#9ece6a")

/** No-provider palette (dialog parity: scrim is RGBA(0,0,0,150)). */
export const FALLBACK_THEME: PanelTheme = Object.freeze({
  background: {
    surface,
    raised,
    scrim: RGBA.fromInts(0, 0, 0, 150),
  },
  text: {
    base,
    muted,
    faint,
    accent,
    disabled,
    danger,
    warning,
    success,
  },
  row: {
    activeBg: accent,
    activeFg: surface,
  },
  border: {
    base: { style: "single" as const, color: RGBA.fromHex("#3b4261") },
    focused: { style: "heavy" as const, color: accent },
    warning: { style: "heavy" as const, color: warning },
  },
  attributes: {
    title: TextAttributes.BOLD,
    group: TextAttributes.BOLD,
    selected: TextAttributes.BOLD,
    keyHint: TextAttributes.NONE,
    subtitle: TextAttributes.NONE,
  },
  identity: [RGBA.fromHex("#4D6BFE"), RGBA.fromHex("#8B5CF6")] as const,
}) satisfies PanelTheme
