/**
 * skin/motion.ts — the shared motion clock gate (skin contract §1 "动效档位",
 * §2 guardrail 2).
 *
 * All skin animations read their frame rate from HERE instead of owning a
 * timer. There is no timer in this module and none may be added: driving
 * components use the renderer's shared animation clock
 * (`animationFps` on Renderables, `onAnimationTick(fps, cb)` from
 * @opentui/solid), and this module only decides the fps / whether to tick.
 *
 * Tiers:
 *   full    — decorations on; explicit frame caps: streaming ≤12.5 fps, idle ≤24 fps
 *   reduced — fades/pulses/rolling/gradient off; comet falls back to ▓▒░
 *             (still animates at the 12.5 fps cap); static markers stay
 *   off     — decorative animation stops (fps undefined → clock paused);
 *             static state markers remain
 *
 * Resolution order: an explicit user tier (`setMotionTier`, wired to the
 * future `/motion full|reduced|off` + persistence by a later wave) wins;
 * otherwise the auto tier applies — reduced while the terminal capability
 * probe has not confirmed truecolor, when the probe says non-truecolor, or
 * when `$TMUX` / `$SSH_CONNECTION` / `$SSH_TTY` is present.
 *
 * Usage:
 *   import { motionFrameRate, setMotionBusy, setMotionTier } from "../skin/motion"
 *   setMotionBusy(streaming)                    // host calls this on turn busy/idle
 *   <Renderable animationFps={motionFrameRate()}>  // undefined pauses the clock
 *   // solid: onAnimationTick(() => motionFrameRate(), (dt) => { … })
 *   setMotionTier("reduced")                    // /motion persistence lane
 *   setMotionTier(undefined)                    // back to auto
 */

export type MotionTier = "full" | "reduced" | "off"

/** Streaming/bust cap: one tick per 80 ms comet step (contract §2.2). */
export const STREAM_FPS = 12.5
/** Idle cap — below the renderer's targetFps=30 so live mode never pins full frames. */
export const IDLE_FPS = 24

/** The animation window used by rolling numbers and fades (contract §1). */
export const ROLL_MS = 300

/** Everything the auto tier may look at; all fields optional. */
export interface MotionEnvironment {
	/** `$TMUX` — truthy string means inside tmux. */
	tmux?: string
	/** `$SSH_CONNECTION` — truthy string means remote. */
	sshConnection?: string
	/** `$SSH_TTY` — truthy string means remote. */
	sshTty?: string
	/**
	 * Terminal capability probe state: `undefined` = not confirmed yet
	 * (the renderer's `capabilities` event has not fired — renderer
	 * starts with `capabilities: null`), `true` = truecolor confirmed,
	 * `false` = confirmed non-truecolor.
	 */
	truecolorConfirmed?: boolean
}

/**
 * Pure auto-degradation rule (unit-tested): reduced until truecolor is
 * confirmed, reduced when confirmed non-truecolor, reduced under a
 * multiplexer or SSH regardless of capabilities.
 */
export function resolveAutoTier(env: MotionEnvironment = {}): MotionTier {
	if (env.tmux || env.sshConnection || env.sshTty) return "reduced"
	if (env.truecolorConfirmed !== true) return "reduced"
	return "full"
}

/** The user's explicit tier; undefined = follow the auto tier. */
let userTier: MotionTier | undefined = undefined
let autoTier: MotionTier = "reduced"
let busy = false

/**
 * Pure combine rule: the explicit user choice wins; without one the auto
 * tier applies. (`/motion full` over SSH is the user's call.)
 */
export function resolveEffectiveTier(user: MotionTier | undefined, auto: MotionTier): MotionTier {
	return user ?? auto
}

/** Feed the renderer's `capabilities` event (truecolor = capabilities.rgb). */
export function confirmTerminalCapabilities(capabilities: { rgb: boolean } | null): void {
	autoTier = resolveAutoTier({
		tmux: process.env.TMUX,
		sshConnection: process.env.SSH_CONNECTION,
		sshTty: process.env.SSH_TTY,
		truecolorConfirmed: capabilities ? capabilities.rgb : undefined,
	})
}

/** Re-evaluate the auto tier from the live environment (boot-time default). */
export function refreshAutoTier(): void {
	confirmTerminalCapabilities(null)
}

/**
 * The currently effective tier (user override or auto). Read-only view for
 * components; writes go through setMotionTier.
 */
export function getMotionTier(): MotionTier {
	return resolveEffectiveTier(userTier, autoTier)
}

/** Set the user tier (persisted `/motion` value); undefined returns to auto. */
export function setMotionTier(tier: MotionTier | undefined): void {
	userTier = tier === "full" || tier === "reduced" || tier === "off" ? tier : undefined
}

/** Host entry: whether a turn is streaming/busy right now (caps the fps). */
export function setMotionBusy(value: boolean): void {
	busy = value
}

/** True when a turn is streaming/busy (read-only view). */
export function isMotionBusy(): boolean {
	return busy
}

/**
 * The frame rate all skin animations must pass to the shared clock:
 *   off     → undefined (pauses `animationFps` / `onAnimationTick`)
 *   reduced → STREAM_FPS (the remaining 80 ms comet keeps its cadence)
 *   full    → busy ? STREAM_FPS : IDLE_FPS
 * Re-read this every time you set `animationFps` (or pass an accessor) —
 * it changes with tier and busy flips.
 */
export function motionFrameRate(): number | undefined {
	const tier = getMotionTier()
	if (tier === "off") return undefined
	if (tier === "reduced") return STREAM_FPS
	return busy ? STREAM_FPS : IDLE_FPS
}

/**
 * Decorations allowed? False for reduced AND off (gradient tail, fades,
 * rolling, pulses fall back / jump). Tier off additionally stops the clock
 * (motionFrameRate() undefined), which this gate does not express.
 */
export function motionDecorationsEnabled(): boolean {
	return getMotionTier() === "full"
}

/**
 * The animation is running at all? off stops decorative ticking entirely
 * (the comet freezes on its current frame instead of cycling).
 */
export function motionAnimationRunning(): boolean {
	return getMotionTier() !== "off"
}

refreshAutoTier()
