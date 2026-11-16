/**
 * kit.tsx — PanelKitProvider: the host-side adapter wiring.
 *
 * The kit never imports tui-base (decision D1). The host passes either a
 * pre-built PanelKeyAdapter (`keys`) or a structural Keymap bridge (`keymap`);
 * this file turns the latter into the kit's key adapter:
 *
 *   - one modal layer (`mode: "modal"`) with one inline binding per reserved id,
 *   - `enabled` tracks whether an active Panel has registered its table,
 *   - `cmd()` returns the handler result, so `false` reaches the host as
 *     "not handled" and the event continues (focused renderable / text input).
 *
 * Hosts mounting a Keymap-like object MUST run focused-renderable key handlers
 * before this layer and MUST treat a `false` cmd result as pass-through.
 *
 * T17-INT2.
 */
import { createSignal, onCleanup, type JSX } from "solid-js"
import type {
  PanelKeyAdapter,
  PanelKeyCommands,
  PanelKitProviderProps,
  PanelOwnership,
} from "./contracts"
import { PanelKitContext, toAccessor } from "./theme"

/** Reserved ids the provider maps onto the host's modal layer. */
export const PANEL_KEY_IDS = [
  "escape",
  "enter",
  "space",
  "up",
  "down",
  "left",
  "right",
] as const

export type PanelKeyId = (typeof PANEL_KEY_IDS)[number]

export interface PanelKeymapBinding {
  /** Host binding syntax, e.g. "escape" / "ctrl+c". */
  readonly key: string
  /** Return `false` to report the event unhandled (pass-through). */
  readonly cmd: () => void | boolean
  readonly desc?: string
  readonly group?: string
}

/** Structural subset of tui-base's `Keymap.createLayer` input. */
export interface PanelKeymapLayer {
  readonly mode?: string
  readonly enabled?: boolean
  readonly bindings: readonly PanelKeymapBinding[]
}

/** Structural subset of the host Keymap bridge (decision D1). */
export interface PanelKeymapHost {
  readonly mode: {
    push(mode: string, active?: () => boolean): () => void
  }
  createLayer(input: () => PanelKeymapLayer): void | (() => void)
}

/**
 * Build a PanelKeyAdapter over a host Keymap bridge. Call inside a reactive
 * owner (the provider component): it registers one host layer for the whole
 * kit lifetime and pushes the modal mode while a table is active.
 */
export function createHostKeyAdapter(
  keymap: PanelKeymapHost,
  ownership?: PanelOwnership,
): PanelKeyAdapter {
  const [active, setActive] = createSignal<PanelKeyCommands | undefined>(undefined)

  const disposeLayer = keymap.createLayer(() => ({
    mode: "modal",
    // ADR-0008: a panel layer answers only while the deepest panel frame is
    // the top ownership frame, so a dialog opened above the panel wins even
    // though both layers sit at priority 0.
    enabled: active() !== undefined && (ownership === undefined || ownership.owns(ownership.topFrame())),
    bindings: PANEL_KEY_IDS.map((id) => ({
      key: id,
      group: "Panel",
      desc: `Panel ${id}`,
      cmd: () => {
        const handler = active()?.[id]
        if (!handler) return false
        return handler()
      },
    })),
  }))
  if (typeof disposeLayer === "function") onCleanup(disposeLayer)

  const popMode = keymap.mode.push("modal", () => active() !== undefined)
  onCleanup(popMode)

  return {
    scope(commands) {
      setActive(commands)
      return () => {
        // A newer layer may already own the table; only clear our own.
        setActive((current) => (current === commands ? undefined : current))
      }
    },
  }
}

export interface PanelKitProviderHostProps extends PanelKitProviderProps {
  /**
   * Host Keymap bridge. Ignored when `keys` is supplied. Prefer `keys` when the
   * host already owns an adapter (e.g. a shared modal scope).
   */
  keymap?: PanelKeymapHost
}

/**
 * One provider, one context (theme.ts). The value is exactly the contract
 * shape `{ theme: Accessor<PanelTheme>, motion, keys }`.
 */
export function PanelKitProvider(props: PanelKitProviderHostProps): JSX.Element {
  const theme = toAccessor(props.theme)
  // The deepest panel layer's frame. PanelStack owns the push/pop, the
  // provider owns the signal so the modal layer (built below) can read it.
  const [topFrame, setTopFrame] = createSignal<unknown>(undefined)
  const ownership: PanelOwnership | undefined = props.ownership
    ? {
        push: (kind) => props.ownership!.push(kind),
        pop: (token) => props.ownership!.pop(token),
        owns: (token) => props.ownership!.owns(token),
        topFrame,
        setTopFrame,
      }
    : undefined
  const keys = props.keys ?? (props.keymap ? createHostKeyAdapter(props.keymap, ownership) : undefined)
  return (
    <PanelKitContext.Provider value={{ theme, motion: props.motion, keys, ownership }}>
      {props.children}
    </PanelKitContext.Provider>
  )
}
