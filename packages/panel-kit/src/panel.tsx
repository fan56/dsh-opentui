/**
 * panel.tsx — the Panel shell: scrim, frame, one-shot whole-panel fade.
 *
 * Geometry/motion come from PanelOptions; a direct <Panel> (no stack) renders
 * standalone for demos and tests (spec §3.2). The shell never animates its
 * size, padding, margin or border style: the only motion is a whole-subtree
 * color tint (enter: surface → token, exit: reverse) on the shared clock.
 * Esc is the only back action.
 *
 * Stack integration props (`depth`/`active`/`onReady`) are part of contracts
 * now (T17-INT1 A1): `active` gates the layer's modal table, `depth` feeds the
 * stacking scrim formula, `onReady` publishes the imperative close handle.
 *
 * Adapted from @opencode/tui, Copyright 2025 opencode, MIT.
 */
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import {
  PANEL_WIDTHS,
  type PanelKeyCommands,
  type PanelKeyHandler,
  type PanelKeyRouter,
  type PanelMetrics,
  type PanelProps,
  type PanelSize,
} from "./contracts"
import {
  createFadeDriver,
  motionDegraded,
  nextPanelPhase,
  type PanelPhase,
} from "./motion"
import {
  PanelKeyRoutingContext,
  PanelKitContext,
  STATIC_MOTION,
  fadeTheme,
  resolveFrameToken,
  resolvePanelChrome,
  resolveScrimAlpha,
  resolveScrimColor,
  resolveTitleColor,
  usePanelKit,
  usePanelTheme,
} from "./theme"
import { truncate } from "./text"

export type { PanelShellHandle } from "./contracts"

export type PanelShellProps = PanelProps

/** Reserved ids the layer's single modal table handles (T17-INT1 C1). */
const KEY_IDS = ["escape", "enter", "space", "up", "down", "left", "right"] as const

/** Inner-cell metrics (spec §3.1): compact is width < 64 || height < 20. */
export function resolvePanelMetrics(innerWidth: number, innerHeight: number): PanelMetrics {
  const width = Math.max(0, Math.floor(innerWidth))
  const height = Math.max(0, Math.floor(innerHeight))
  return { width, height, compact: width < 64 || height < 20 }
}

/** Preferred frame width: explicit width, the size preset, or full - 4. */
export function resolvePanelWidth(
  size: PanelSize | undefined,
  width: number | undefined,
  terminalWidth: number,
): number {
  const preset = width ?? (size === "full" ? terminalWidth - 4 : PANEL_WIDTHS[size ?? "medium"])
  return Math.max(1, Math.min(Math.floor(preset), terminalWidth - 2))
}

/** Frame height cap: explicit maxHeight, or terminalRows - 4 (spec §3.2). */
export function resolvePanelHeightLimit(maxHeight: number | undefined, terminalHeight: number): number {
  const rows = maxHeight ?? terminalHeight - 4
  return Math.max(3, Math.min(Math.floor(rows), terminalHeight - 4))
}

/**
 * Fixed frame height (v1.2). `PanelOptions.rows` is a target frame size, so it
 * is clamped exactly like the height cap and resolved BEFORE content: the
 * frame never depends on what a consumer paints inside it. `undefined` keeps
 * the v1 content-sized behavior.
 */
export function resolvePanelRows(
  rows: number | undefined,
  terminalHeight: number,
): number | undefined {
  if (rows === undefined || !Number.isFinite(rows)) return undefined
  return resolvePanelHeightLimit(rows, terminalHeight)
}

export function Panel(props: PanelShellProps) {
  const dimensions = useTerminalDimensions()
  const kit = usePanelKit()
  const baseTheme = usePanelTheme()
  const motion = () => kit?.motion ?? STATIC_MOTION

  const [phase, setPhase] = createSignal<PanelPhase>(
    motionDegraded(motion()) ? "open" : "entering",
  )

  // -- Geometry -------------------------------------------------------------
  const frameWidth = () => resolvePanelWidth(props.size, props.width, dimensions().width)
  const heightLimit = () => resolvePanelHeightLimit(props.maxHeight, dimensions().height)
  /**
   * `rows` (v1.2) is a FIXED frame height: it is resolved from the terminal
   * alone, so a consumer swapping sections or opening an editor cannot resize
   * the frame. `height` keeps the v1 content-height meaning.
   */
  const frameHeight = () => {
    const fixed = resolvePanelRows(props.rows, dimensions().height)
    if (fixed !== undefined) return fixed
    return props.height === undefined ? undefined : Math.min(props.height, heightLimit())
  }
  const innerWidth = () => Math.max(1, frameWidth() - 2)
  const inset = () => (resolvePanelMetrics(innerWidth(), (frameHeight() ?? heightLimit()) - 2).compact ? 1 : 3)

  // -- Tween ----------------------------------------------------------------
  let notified = false
  const notifyClose = () => {
    if (notified) return
    notified = true
    props.onClose?.()
  }

  const finishNow = () => {
    setPhase("closed")
    notifyClose()
  }

  const driver = createFadeDriver({
    motion,
    phase,
    onSettled: (settled) => {
      if (settled === "entering") setPhase("open")
      else if (settled === "exiting") finishNow()
    },
  })

  /**
   * One tint per frame for the whole panel (spec §4.2): 0 = surface color,
   * 1 = resolved token. Enter climbs 0 → 1, exit falls 1 → 0. `fadeIn: false`
   * keeps enter at 1; the scrim is painted from the unfaded theme below.
   */
  const fadeProgress = () => {
    const current = phase()
    if (current === "exiting") return 1 - driver.progress()
    if (current === "entering") return props.fadeIn === false ? 1 : driver.progress()
    return current === "closed" ? 0 : 1
  }
  const theme = createMemo(() => fadeTheme(baseTheme(), fadeProgress()))

  // -- Close guard ----------------------------------------------------------
  let pending = false
  async function requestClose() {
    const current = phase()
    if (current === "closed") return
    if (current === "exiting") {
      // Second Esc during exit = closeNow, no replay (spec §4.2 step 4).
      finishNow()
      return
    }
    if (pending) return
    pending = true
    try {
      if (props.beforeClose) {
        const allowed = await props.beforeClose()
        if (!allowed) return
      }
      setPhase((previous) => nextPanelPhase(previous, "requestClose", motionDegraded(motion())))
      if (phase() === "closed") notifyClose()
    } finally {
      pending = false
    }
  }

  // -- Key routing ----------------------------------------------------------
  // One router per layer (T17-INT1 C1). Controls register innermost-first; the
  // panel default (Esc -> guarded close) runs only when every handler declines.
  const handlers: PanelKeyHandler[] = []
  const router: PanelKeyRouter = {
    register(handler) {
      handlers.push(handler)
      return () => {
        const at = handlers.lastIndexOf(handler)
        if (at >= 0) handlers.splice(at, 1)
      }
    },
  }
  const dispatchKey = (id: string): boolean => {
    for (let at = handlers.length - 1; at >= 0; at -= 1) {
      if (handlers[at]!(id)) return true
    }
    if (id === "escape") {
      void requestClose()
      return true
    }
    return false
  }

  // Standalone fallback (no host adapter): Esc only. Registered once but the
  // active check is live, so a layer that becomes top after a push/pop starts
  // responding (stack focus/active handoff).
  useKeyboard((key) => {
    if (kit?.keys) return
    if (!(props.active ?? true)) return
    if (key.name !== "escape" && key.name !== "esc") return
    if (dispatchKey("escape")) {
      key.preventDefault()
      key.stopPropagation()
    }
  })

  createEffect(() => {
    if (!(props.active ?? true)) return
    const keys = kit?.keys
    if (!keys) return
    const table: PanelKeyCommands = {}
    for (const id of KEY_IDS) table[id] = () => dispatchKey(id)
    const dispose = keys.scope(table)
    if (dispose) onCleanup(dispose)
  })

  onMount(() =>
    props.onReady?.({
      close: () => void requestClose(),
      closeNow: finishNow,
      phase,
    }),
  )

  // -- Paint ----------------------------------------------------------------
  const frameToken = () => resolveFrameToken(theme(), props.tone, props.border)
  const titleTint = () => resolveTitleColor(theme(), props.tone)

  const header = () => {
    if (props.header) return props.header
    const width = Math.max(1, innerWidth() - inset() * 2)
    // v1.2 layered chrome: a title band one step above the content surface and
    // a one-cell rule under it, so the header never blends into the body. Flat
    // (default) keeps the v1.1 look for every existing consumer.
    const layered = props.layered === true
    return (
      <box
        flexDirection="column"
        flexShrink={0}
        backgroundColor={layered ? resolvePanelChrome(theme()).titleBand : undefined}
      >
        <box
          flexDirection="row"
          justifyContent="space-between"
          flexShrink={0}
          border={layered ? ["bottom"] : undefined}
          borderStyle="single"
          borderColor={resolvePanelChrome(theme()).divider}
        >
          <text fg={titleTint()} attributes={theme().attributes.title}>
            {truncate(props.title, Math.max(1, width - 4))}
          </text>
          <text fg={theme().text.muted} attributes={theme().attributes.keyHint}>
            {"esc"}
          </text>
        </box>
        <Show when={props.subtitle}>
          <text fg={theme().text.muted} attributes={theme().attributes.subtitle} wrapMode="none">
            {truncate(props.subtitle ?? "", width)}
          </text>
        </Show>
      </box>
    )
  }

  // The scrim never fades: painted at its final alpha on mount (spec §4.2).
  const scrimColor = () =>
    resolveScrimColor(
      baseTheme(),
      props.scrimAlpha ?? resolveScrimAlpha(baseTheme().background.scrim.toInts()[3], props.depth ?? 0),
    )

  return (
    <Show when={phase() !== "closed"}>
      <PanelKeyRoutingContext.Provider value={router}>
        <box
          position="absolute"
          left={0}
          top={0}
          width={dimensions().width}
          height={dimensions().height}
          zIndex={3000 + (props.depth ?? 0)}
          alignItems="center"
          justifyContent={props.align === "top" ? undefined : "center"}
          paddingTop={props.align === "top" ? Math.floor(dimensions().height / 4) : 0}
          backgroundColor={props.scrim === false ? undefined : scrimColor()}
        >
          <box
            width={frameWidth()}
            height={frameHeight()}
            maxWidth={Math.max(1, dimensions().width - 2)}
            maxHeight={heightLimit()}
            flexShrink={0}
            backgroundColor={theme().background.surface}
            border={["top", "bottom", "left", "right"]}
            borderStyle={frameToken().style}
            borderColor={frameToken().color}
            paddingTop={1}
          >
            <box
              flexDirection="column"
              flexGrow={1}
              flexShrink={1}
              paddingLeft={inset()}
              paddingRight={inset()}
              paddingBottom={1}
            >
              {header()}
              <box flexDirection="column" flexGrow={1} flexShrink={1}>
                {/* Controls paint from the faded projection, so the whole
                    subtree fades with one tint per frame (no per-row loop). */}
                <PanelKitContext.Provider value={{ theme, motion: motion(), keys: kit?.keys }}>
                  {props.children}
                </PanelKitContext.Provider>
              </box>
            </box>
          </box>
        </box>
      </PanelKeyRoutingContext.Provider>
    </Show>
  )
}
