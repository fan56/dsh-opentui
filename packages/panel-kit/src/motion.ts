/**
 * motion.ts — one-shot fade math plus the shared-clock driver.
 *
 * v1 transition is a fade (T17-INT2): colors interpolate from
 * theme.background.surface toward the resolved tokens over FADE_MS, both on
 * enter and (reversed) on exit. There is no translation, no geometry and no
 * layout write anywhere in this file; the slide implementation is deferred
 * (spec §4).
 *
 * Two layers:
 *   1. Pure phase machine (idle → entering → open → exiting → closed) and the
 *      motion-gate helpers.
 *   2. `createFadeDriver`, a thin wrapper over the renderer's shared animation
 *      clock (`onAnimationTick`). The accessor returns undefined the moment a
 *      tween settles, so the clock stops by itself — no setInterval /
 *      setTimeout loop exists in this package (spec §4).
 *
 * Adapted from @opencode/tui, Copyright 2025 opencode, MIT.
 */
import { onAnimationTick, onResize } from "@opentui/solid"
import { createEffect, createSignal, type Accessor } from "solid-js"
import { FADE_MS, type PanelMotionAdapter } from "./contracts"

// ---------------------------------------------------------------------------
// Pure math
// ---------------------------------------------------------------------------

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

// ---------------------------------------------------------------------------
// Phase machine (idle → entering → open → exiting → closed)
// ---------------------------------------------------------------------------

export type PanelPhase = "idle" | "entering" | "open" | "exiting" | "closed"

export type PanelPhaseEvent = "mount" | "entered" | "requestClose" | "exited" | "closeNow"

/**
 * Pure transition table.
 *
 * `jump` is the motion gate (`motion.jump()`, spec §4.3): degrading lands on
 * the final state in one step. A close request during `entering` also lands
 * immediately — replaying a fade-out from a half-faded frame would paint a
 * visible snap, so the shell follows the closeNow path (no replay).
 */
export function nextPanelPhase(phase: PanelPhase, event: PanelPhaseEvent, jump: boolean): PanelPhase {
  switch (event) {
    case "mount":
      if (phase !== "idle") return phase
      return jump ? "open" : "entering"
    case "entered":
      return phase === "entering" ? "open" : phase
    case "requestClose":
      if (phase === "open") return jump ? "closed" : "exiting"
      if (phase === "entering") return "closed"
      if (phase === "exiting") return "closed"
      return phase
    case "exited":
      return phase === "exiting" ? "closed" : phase
    case "closeNow":
      return phase === "closed" ? "closed" : "closed"
  }
}

/** True while the phase paints a live fade. */
export function phaseAnimates(phase: PanelPhase): boolean {
  return phase === "entering" || phase === "exiting"
}

/** Degraded = jump requested, or the shared clock is paused (tier "off"). */
export function motionDegraded(motion: PanelMotionAdapter): boolean {
  return motion.jump() || motion.fps() === undefined
}

/** Frame-rate accessor bridge for `onAnimationTick` (spec §4.2). */
export function motionRate(
  phase: Accessor<PanelPhase>,
  motion: Accessor<PanelMotionAdapter>,
): number | undefined {
  if (!phaseAnimates(phase())) return undefined
  if (motionDegraded(motion())) return undefined
  return motion().fps()
}

// ---------------------------------------------------------------------------
// Shared-clock driver
// ---------------------------------------------------------------------------

export interface FadeDriverOptions {
  motion: Accessor<PanelMotionAdapter>
  phase: Accessor<PanelPhase>
  /** Called when the current tween's final state has been reached. */
  onSettled: (phase: PanelPhase) => void
}

export interface FadeDriver {
  /** Elapsed ms inside the current phase, clamped to FADE_MS. */
  elapsed: Accessor<number>
  /** Linear progress in [0, 1] for the current phase. */
  progress: Accessor<number>
}

/**
 * Drives one phase tween on the renderer's shared clock.
 *
 * The first animated paint is the one after mount (the accessor only starts
 * ticking once a phase is animating). `elapsed` resets on every phase change;
 * settling calls `onSettled` and the accessor then returns undefined, so the
 * shared clock unsubscribes with no timer left behind.
 */
export function createFadeDriver(options: FadeDriverOptions): FadeDriver {
  const [clock, setClock] = createSignal(0)
  let elapsed = 0
  let lastPhase: PanelPhase | undefined

  // Reset the tween window on a phase change without ticking.
  createEffect(() => {
    const phase = options.phase()
    if (phase === lastPhase) return
    lastPhase = phase
    elapsed = 0
    setClock((value) => value + 1)
  })

  // Jump degradation (reduced/off, tier flip mid-flight): land immediately.
  createEffect(() => {
    if (!motionDegraded(options.motion())) return
    if (!phaseAnimates(options.phase())) return
    elapsed = FADE_MS
    setClock((value) => value + 1)
    options.onSettled(options.phase())
  })

  // A resize is a reflow boundary: snap, never animate across it (spec §5.4).
  onResize(() => {
    if (!phaseAnimates(options.phase())) return
    elapsed = FADE_MS
    setClock((value) => value + 1)
    options.onSettled(options.phase())
  })

  onAnimationTick(
    () => motionRate(options.phase, options.motion),
    (deltaTime) => {
      const phase = options.phase()
      if (!phaseAnimates(phase)) return
      if (motionDegraded(options.motion())) {
        elapsed = FADE_MS
        setClock((value) => value + 1)
        options.onSettled(phase)
        return
      }
      elapsed = Math.min(FADE_MS, elapsed + Math.max(0, deltaTime))
      setClock((value) => value + 1)
      if (elapsed >= FADE_MS) options.onSettled(phase)
    },
  )

  const elapsedRead = () => {
    clock()
    return elapsed
  }

  return {
    elapsed: elapsedRead,
    progress: () => clamp01(elapsedRead() / FADE_MS),
  }
}
