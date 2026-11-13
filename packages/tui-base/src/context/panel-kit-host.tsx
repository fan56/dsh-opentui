/**
 * panel-kit-host.tsx — the tui-base side of the @dsh-opentui/panel-kit
 * integration (T17-INT2 wiring).
 *
 * The kit never imports tui-base (decision D1), so the host owns the three
 * projections the provider needs:
 *
 *   1. theme  — a flat PanelTheme accessor projected from the live
 *               ComponentTheme, so a /theme switch repaints open panels
 *               without remounting the stack.
 *   2. motion — the skin motion tier as the kit's three-gate adapter.
 *   3. keys   — the tui-base Keymap bridge. The kit's layer shape
 *               (`bindings: [{ key, cmd }]`) is NOT tui-base's
 *               (`commands: [{ bind, run }]`), so `createTuiPanelKeymapHost`
 *               translates inline commands one-for-one. Esc therefore reaches
 *               the Panel's per-layer router: the top layer's table is the
 *               only one enabled, and the router dispatches innermost-first
 *               before falling back to the guarded close.
 *
 * Mount order (see examples/v2-entry.tsx): inside Keymap.Provider and
 * ThemeProvider, above the page. PanelStack emits its layers as absolute
 * siblings of the page root at zIndex 3000+, covering the transcript and
 * every page-level panel.
 */
import { RGBA, TextAttributes } from "@opentui/core"
import type { Accessor, JSX } from "solid-js"
import {
  PanelKitProvider,
  PanelStack,
  type PanelKeymapHost,
  type PanelKeymapLayer,
  type PanelTheme,
} from "@dsh-opentui/panel-kit"
import { motionDecorationsEnabled, motionFrameRate } from "../skin/motion"
import type { ComponentTheme } from "../theme/component"
import { ensureContrast } from "../theme/contrast"
import { Keymap } from "./keymap"
import { useTheme } from "./theme"

/** Semantic text/background projection (spec §7.1; roles v1.2). */
export function projectPanelTheme(theme: ComponentTheme): PanelTheme {
  /**
   * Runtime tolerance for a theme resolved before a slot existed (or a
   * hand-built theme in a test): a missing token falls back to the same role's
   * older source, never to a literal.
   */
  const primary = theme.text.action.primary as
    | { readonly base?: RGBA; readonly focused?: RGBA; readonly disabled?: RGBA }
    | undefined
  const raised = theme.background.raised as
    | { readonly base?: RGBA; readonly high?: RGBA }
    | undefined
  const markdown = theme.markdown as Readonly<Record<string, RGBA | undefined>> | undefined
  const feedback = theme.text.feedback as
    | Readonly<Record<string, { readonly base?: RGBA } | undefined>>
    | undefined
  const interactive = theme.hue.interactive as Readonly<Record<number, RGBA | undefined>> | undefined
  /**
   * Panel content surface, raised one step above the page so the modal is not
   * a black box over the scrim. Every semantic text role is measured against
   * it: a token under 4.5:1 falls back to the theme's primary text (never a
   * literal), which keeps light mode and low-contrast themes legible.
   */
  const content = raised?.base ?? theme.background.base
  const readable = (color: RGBA): RGBA => ensureContrast(color, content, 4.5, theme.text.base)
  return {
    background: {
      surface: theme.background.base,
      raised: raised?.high ?? theme.background.base,
      content,
      // The kit's documented scrim default (RGBA(0,0,0,150)); the theme has
      // no scrim token, so this is the one literal the host contributes.
      scrim: RGBA.fromInts(0, 0, 0, 150),
    },
    text: {
      base: theme.text.base,
      muted: readable(theme.text.muted),
      faint: readable(theme.text.faint),
      accent: readable(interactive?.[500] ?? theme.text.base),
      // `disabled` is an intentional state, not content: keep the theme's dim
      // value so disabled rows never read as enabled.
      disabled: primary?.disabled ?? theme.text.muted,
      // v1.2 fix: the destructive token is a BACKGROUND in all three stock
      // themes (1.0:1 as text); the error FOREGROUND is feedback.error.base.
      danger: readable(feedback?.error?.base ?? theme.text.base),
      warning: readable(feedback?.warning?.base ?? theme.text.base),
      success: readable(feedback?.success?.base ?? theme.text.base),
      code: readable(markdown?.code ?? theme.text.base),
      user: readable(primary?.base ?? theme.text.base),
      system: readable(feedback?.info?.base ?? theme.text.muted),
      heading: readable(markdown?.heading ?? theme.text.base),
    },
    row: {
      activeBg: theme.background.action.primary.focused,
      activeFg: primary?.focused ?? theme.text.base,
    },
    border: {
      base: { style: "single", color: theme.border.base },
      // v1.2 fix: focus was invisible (same color as the idle border); it now
      // follows the interactive ramp, the same source as skin/semantic.ts.
      focused: { style: "heavy", color: interactive?.[500] ?? theme.border.base },
      warning: { style: "single", color: feedback?.warning?.base ?? theme.text.base },
    },
    attributes: {
      title: TextAttributes.BOLD,
      group: TextAttributes.BOLD,
      selected: TextAttributes.BOLD,
      keyHint: TextAttributes.DIM,
      subtitle: TextAttributes.DIM,
    },
    identity: [theme.hue.accent[500], theme.hue.accent[300]] as const,
  }
}

/** Skin motion tier → the kit's live motion gates (spec §4.3). */
export function panelKitMotion() {
  return {
    decorationsEnabled: () => motionDecorationsEnabled(),
    fps: () => motionFrameRate(),
    jump: () => !motionDecorationsEnabled() || motionFrameRate() === undefined,
  }
}

/**
 * Translate the kit's keymap layer shape onto tui-base's `Keymap.createLayer`.
 * The kit gives inline bindings (`{ key, cmd }`); tui-base groups inline
 * commands by `bind` and needs `run`, so every reserved id becomes one
 * `{ bind, run }` command on the same "modal" mode the kit pushes.
 */
export function createTuiPanelKeymapHost(
  keymap: ReturnType<typeof Keymap.use>,
): PanelKeymapHost {
  return {
    mode: {
      push: (mode, active) => keymap.mode.push(mode, active),
    },
    createLayer(input: () => PanelKeymapLayer) {
      return Keymap.createLayer(() => {
        const layer = input()
        return {
          ...(layer.mode === undefined ? {} : { mode: layer.mode }),
          ...(layer.enabled === undefined ? {} : { enabled: layer.enabled }),
          commands: layer.bindings.map((binding) => ({
            bind: binding.key,
            ...(binding.desc === undefined ? {} : { title: binding.desc }),
            ...(binding.group === undefined ? {} : { group: binding.group }),
            run: () => binding.cmd(),
          })),
        }
      })
    },
  }
}

/**
 * Provider + stack host. Mount inside Keymap.Provider and ThemeProvider,
 * wrapping the page (not inside it): the stack's layers are absolute siblings
 * of the page root.
 */
export function PanelKitHost(props: { children?: JSX.Element }): JSX.Element {
  const theme = useTheme()
  const keymap = Keymap.use()
  const panelTheme: Accessor<PanelTheme> = () => projectPanelTheme(theme)
  return (
    <PanelKitProvider
      theme={panelTheme}
      motion={panelKitMotion()}
      keymap={createTuiPanelKeymapHost(keymap)}
    >
      <PanelStack>{props.children}</PanelStack>
    </PanelKitProvider>
  )
}

