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
import { Keymap } from "./keymap"
import { useTheme } from "./theme"

/** Semantic text/background projection (spec §7.1). */
export function projectPanelTheme(theme: ComponentTheme): PanelTheme {
  const primary = theme.text.action.primary
  return {
    background: {
      surface: theme.background.base,
      raised: theme.background.raised.high,
      // The kit's documented scrim default (RGBA(0,0,0,150)); the theme has
      // no scrim token, so this is the one literal the host contributes.
      scrim: RGBA.fromInts(0, 0, 0, 150),
    },
    text: {
      base: theme.text.base,
      muted: theme.text.muted,
      faint: theme.text.faint,
      accent: theme.hue.interactive[500],
      disabled: primary.disabled,
      danger: theme.text.action.destructive.base,
      warning: theme.text.feedback.warning.base,
      success: theme.text.feedback.success.base,
    },
    row: {
      activeBg: theme.background.action.primary.focused,
      activeFg: primary.focused,
    },
    border: {
      base: { style: "single", color: theme.border.base },
      focused: { style: "heavy", color: theme.border.base },
      warning: { style: "single", color: theme.text.feedback.warning.base },
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

