/**
 * theme.ts — PanelTheme projection and the kit's context hooks.
 *
 * The host resolves one flat `PanelTheme` and injects it through the provider
 * (decision D1: the kit never reads a tui-base theme context). Everything in
 * this file is projection: tone → border token, scrim alpha, title color,
 * gradient eligibility, foreground fade interpolation. No literal colors live
 * here — the only tolerated palette is `fallback.ts` (spec §7.2).
 *
 * Adapted from @opencode/tui, Copyright 2025 opencode, MIT.
 */
import { createContext, useContext, type Accessor } from "solid-js"
import { RGBA } from "@opentui/core"
import type {
  PanelBorderStyle,
  PanelBorderToken,
  PanelChrome,
  PanelKeyCommands,
  PanelKeyRouter,
  PanelKitContextValue,
  PanelTheme,
  PanelTone,
} from "./contracts"
import { SCRIM_MAX, SCRIM_STEP } from "./contracts"
import { FALLBACK_THEME } from "./fallback"
import { clamp01 } from "./motion"

/**
 * THE theme/motion/keys injection point (T17-INT1 B3/C2). The host mounts one
 * PanelKitContext.Provider; every module resolves through this context. The
 * former Symbol.for registry (confirm.tsx) and the list.tsx dual read are
 * removed — do not reintroduce a second context identity.
 */
export const PanelKitContext = createContext<PanelKitContextValue | undefined>(undefined)

/** The one context object, for hosts that mount the provider directly. */
export function panelKitContext() {
  return PanelKitContext
}

/** Optional kit context (undefined without a provider). */
export function usePanelKit(): PanelKitContextValue | undefined {
  return useContext(PanelKitContext)
}

/**
 * Layer-local key router (T17-INT1 C1). The Panel shell provides exactly one
 * per layer; controls register while they own focus / a popup is open.
 * Undefined outside a Panel (standalone control tests mount controls directly).
 */
export const PanelKeyRoutingContext = createContext<PanelKeyRouter | undefined>(undefined)

export function usePanelKeys(): PanelKeyRouter | undefined {
  return useContext(PanelKeyRoutingContext)
}

/**
 * Registration entry point for controls. Inside a Panel this targets the
 * layer's single router (innermost-first dispatch); outside one it degrades to
 * the host adapter's scope so standalone mounts keep working.
 *
 * Call this in the component body (it reads context synchronously), then use
 * the returned registrar in onMount / focus handlers.
 */
export function useControlKeys(): (commands: PanelKeyCommands) => (() => void) | undefined {
  const router = usePanelKeys()
  const kit = usePanelKit()
  return (commands) => {
    if (router) {
      return router.register((id) => {
        const handler = commands[id]
        if (!handler) return false
        // PanelKeyCommands handlers return false to fall through.
        return handler() !== false
      })
    }
    const dispose = kit?.keys?.scope(commands)
    return typeof dispose === "function" ? dispose : undefined
  }
}

/** No-provider motion: reduced/off semantics — every tween jumps (spec §4.3). */
export const STATIC_MOTION = {
  decorationsEnabled: () => false,
  fps: () => undefined,
  jump: () => true,
} as const

export function toAccessor(source: PanelTheme | Accessor<PanelTheme>): Accessor<PanelTheme> {
  return typeof source === "function" ? (source as Accessor<PanelTheme>) : () => source
}

/** Live theme read: the injected accessor, or the fallback palette. */
export function usePanelTheme(): Accessor<PanelTheme> {
  const kit = usePanelKit()
  return kit ? kit.theme : () => FALLBACK_THEME
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

/** Tone → frame border (style + color switch instantly; never animated). */
export function resolveFrameToken(
  theme: PanelTheme,
  tone: PanelTone = "accent",
  style?: PanelBorderStyle,
): PanelBorderToken {
  const token =
    tone === "warning"
      ? theme.border.warning
      : tone === "danger"
        ? { style: theme.border.warning.style, color: theme.text.danger }
        : theme.border.focused
  return { style: style ?? token.style, color: token.color }
}

/** Tone → title foreground (warning/danger recolor the title, spec §3.2). */
export function resolveTitleColor(theme: PanelTheme, tone: PanelTone = "accent"): RGBA {
  if (tone === "warning") return theme.text.warning
  if (tone === "danger") return theme.text.danger
  return theme.text.base
}

/**
 * Stack scrim: `base + SCRIM_STEP × depth`, capped at SCRIM_MAX (spec §6.2).
 * The top layer passes its depth; a single panel passes 0.
 */
export function resolveScrimAlpha(baseAlpha: number, depth = 0): number {
  const base = clampAlpha(baseAlpha)
  const level = Math.max(0, Math.floor(depth))
  if (level === 0) return base
  return Math.min(SCRIM_MAX, base + SCRIM_STEP * level)
}

/** Scrim color at the resolved alpha. Flip a theme scrim's alpha, keep its hue. */
export function resolveScrimColor(theme: PanelTheme, alpha?: number): RGBA {
  const color = RGBA.clone(theme.background.scrim)
  // RGBA's `a` accessor is normalized 0..1; callers speak 0..255.
  if (alpha !== undefined) color.a = clampAlpha(alpha) / 255
  return color
}

function clampAlpha(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

/**
 * Static gradient eligibility (spec §4.6): full tier only, and never across
 * ambiguous CJK/double-width titles. `undefined` means "paint solid accent".
 */
export function resolveIdentity(
  theme: PanelTheme,
  enabled: boolean,
  wideTitle = false,
): readonly [RGBA, RGBA] | undefined {
  if (!enabled || wideTitle) return undefined
  return theme.identity
}

/**
 * Layered chrome projection (v1.2). Consumers that paint zones (a nav column,
 * a content pane, a title band) read these four colors instead of inventing
 * their own: the bands sit one step above the content surface, the divider is
 * the theme's border token. Nothing here is a literal — a theme switch
 * recolors every zone on the next frame, and the shell's whole-subtree fade
 * still works because the inputs are the faded theme's tokens.
 *
 * - content   = background.surface (the panel itself, unchanged)
 * - navBand   = background.raised (one step above the surface)
 * - titleBand = background.raised, blended half a step toward the surface so
 *               the title reads as chrome without competing with the nav
 * - divider   = border.base.color (the brightness floor above the scrim)
 */
export function resolvePanelChrome(theme: PanelTheme): PanelChrome {
  return {
    titleBand: fadeColor(theme.background.surface, theme.background.raised, 0.5),
    navBand: theme.background.raised,
    content: theme.background.surface,
    divider: theme.border.base.color,
  }
}

/**
 * Foreground fade (spec §4.5): mix `from` → `to` by linear t. Terminal cells
 * have no opacity, so the tint is a color interpolation, never alpha.
 */
export function fadeColor(from: RGBA, to: RGBA, t: number): RGBA {
  const progress = clamp01(t)
  if (progress >= 1) return to
  if (progress <= 0) return from
  // RGBA exposes 0..1 channels; fromValues keeps this projection free of any
  // literal 8-bit color (spec §7.2 grep rule).
  const mix = (a: number, b: number) => a + (b - a) * progress
  return RGBA.fromValues(mix(from.r, to.r), mix(from.g, to.g), mix(from.b, to.b), to.a)
}

/**
 * Whole-subtree fade projection (spec §4.2). One call per frame, not per cell:
 * every themed color is mixed from `theme.background.surface` toward its
 * resolved token, so controls that read the theme accessor repaint together.
 * Background surface maps to itself; attributes and border styles are
 * structural and pass through unchanged.
 *
 * t = 0 → invisible against the panel surface; t = 1 → the resolved theme.
 */
export function fadeTheme(theme: PanelTheme, t: number): PanelTheme {
  const progress = clamp01(t)
  if (progress >= 1) return theme
  const surface = theme.background.surface
  const mix = (color: RGBA) => fadeColor(surface, color, progress)
  const border = (token: PanelBorderToken): PanelBorderToken => ({
    style: token.style,
    color: mix(token.color),
  })
  return {
    background: {
      surface,
      raised: mix(theme.background.raised),
      scrim: mix(theme.background.scrim),
    },
    text: {
      base: mix(theme.text.base),
      muted: mix(theme.text.muted),
      faint: mix(theme.text.faint),
      accent: mix(theme.text.accent),
      disabled: mix(theme.text.disabled),
      danger: mix(theme.text.danger),
      warning: mix(theme.text.warning),
      success: mix(theme.text.success),
    },
    row: {
      activeBg: mix(theme.row.activeBg),
      activeFg: mix(theme.row.activeFg),
    },
    border: {
      base: border(theme.border.base),
      focused: border(theme.border.focused),
      warning: border(theme.border.warning),
    },
    attributes: theme.attributes,
    identity: [mix(theme.identity[0]), mix(theme.identity[1])] as const,
  }
}
