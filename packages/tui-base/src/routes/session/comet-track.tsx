/**
 * comet-track — the shared 🐳 comet renderable + bounce math, extracted from
 * status-bar.tsx so the two hosts of the animation share ONE implementation:
 *   - StatusBar (retained for the transcript `status` slot / its own tests)
 *   - HintsLine (the MAIN path: the comet now rides the last page row, to the
 *     left of the key hints, and appears only while the turn is busy)
 *
 * The busy status LABEL (verb / elapsed seconds / phase icon / detail) was
 * deliberately removed from the product. With it gone the comet has a single
 * deliberate head colour — the stream/accent head (see `cometHeadColor`) —
 * instead of a phase-driven palette. Mapping a real phase back onto the comet
 * is a separate follow-up; do not reintroduce a fake "stream" phase here.
 *
 * Clock law: no timer of our own. Both hosts drive the renderer's shared
 * clock through `onAnimationTick(cometFps(active), …)`; tier off returns
 * undefined (clock paused / comet frozen), reduced keeps the 80ms cadence
 * with the legacy ▓▒░ ramp, full adds the identity-gradient tail.
 */
import { parseColor, Renderable, type RGBA, type OptimizedBuffer, type RenderableOptions, type RenderContext } from "@opentui/core"
import { extend } from "@opentui/solid"
import { STREAM_FPS, getMotionTier } from "../../skin/motion"
import { identityHexAt, type SkinColorMode } from "../../skin/identity"
import type { ComponentTheme } from "../../theme/component"

/** Token RGBA or fallback hex — style colors accept both. */
export type CometColor = string | RGBA

const TAIL = 5
const RAMP = ["█", "▓", "▒", "░"]
const ASSEMBLY = 2

export const COMET_FALLBACK_TRACK = "#565f89"
export const COMET_FALLBACK_HEAD = "#7aa2f7"

/** Fixed-width comet track (15 display columns; 🐳 spans two). */
export const COMET_TRACK_COLS = 15

/**
 * The ONE deliberate comet colour: the old StatusBar "stream" accent head.
 * The phase palette died with the busy label — a real phase mapping is a
 * separate follow-up, so every host passes this same accent head.
 */
export function cometHeadColor(theme: ComponentTheme | undefined): CometColor {
	return theme?.hue.accent[500] ?? COMET_FALLBACK_HEAD
}

/**
 * Shared clock gate for every comet host: undefined (paused) when the host is
 * inactive or the tier is off; otherwise the 12.5fps stream cadence. Reduced
 * and full both animate; `motionDecorationsEnabled()` alone picks the ramp vs
 * gradient tail.
 */
export function cometFps(active: boolean): number | undefined {
	return !active || getMotionTier() === "off" ? undefined : STREAM_FPS
}

/** Bounce math shared by the old runs-based painter and the renderable. */
export function cometPosition(step: number): {
	start: number
	dirRight: boolean
	stern: number
	tailEnd: number
} {
	const span = COMET_TRACK_COLS - ASSEMBLY
	const s = ((step % (span * 2)) + span * 2) % (span * 2)
	const start = s < span ? s : span * 2 - s
	const dirRight = s < span
	const stern = dirRight ? start : start + ASSEMBLY
	const tailEnd = dirRight ? stern - TAIL : stern + TAIL
	return { start, dirRight, stern, tailEnd }
}

/** Tail glyph for the legacy ramp: distance behind the head → ▓▒░. */
export function cometRampChar(behind: number): string {
	return RAMP[Math.min(RAMP.length - 1, Math.floor(behind / 2) + 1)]!
}

type CometTrackOptions = RenderableOptions<CometTrackRenderable> & {
	/** Bounce phase (one unit per 80ms tick). */
	step?: number
	/** Whale head color (accent token or hex). */
	headFg?: CometColor
	/** Track fill color (border.base token or hex). */
	trackFg?: CometColor
	/** Identity ramp mode for the gradient tail. */
	mode?: SkinColorMode
	/** True → identity-gradient █ tail; false → legacy ▓▒░ ramp. */
	gradient?: boolean
}

/**
 * One self-drawn 15x1 comet track (H8: a single renderable replaces the
 * per-tick text-run rebuild). No `animationFps` here — the solid side
 * pauses/plays the renderer's shared animation clock via the fps accessor.
 */
export class CometTrackRenderable extends Renderable {
	private _step = 0
	private _headFg: RGBA
	private _trackFg: RGBA
	private _mode: SkinColorMode
	private _gradient: boolean

	constructor(ctx: RenderContext, options: CometTrackOptions = {} as CometTrackOptions) {
		super(ctx, options)
		this._headFg = parseColor(options.headFg ?? COMET_FALLBACK_HEAD)
		this._trackFg = parseColor(options.trackFg ?? COMET_FALLBACK_TRACK)
		this._mode = options.mode ?? "dark"
		this._gradient = options.gradient ?? false
		this.setMeasureProvider(() => ({ width: COMET_TRACK_COLS, height: 1 }))
	}

	set step(value: number) {
		if (value === this._step) return
		this._step = value
		this.requestRender()
	}

	set headFg(value: CometColor) {
		const next = parseColor(value)
		if (next.equals(this._headFg)) return
		this._headFg = next
		this.requestRender()
	}

	set trackFg(value: CometColor) {
		const next = parseColor(value)
		if (next.equals(this._trackFg)) return
		this._trackFg = next
		this.requestRender()
	}

	set mode(value: SkinColorMode) {
		if (value === this._mode) return
		this._mode = value
		this.requestRender()
	}

	set gradient(value: boolean) {
		if (value === this._gradient) return
		this._gradient = value
		this.requestRender()
	}

	protected override renderSelf(buffer: OptimizedBuffer): void {
		if (!this.visible || this.isDestroyed) return
		const bg = parseColor("transparent")
		const { start, dirRight, stern, tailEnd } = cometPosition(this._step)
		let c = 0
		while (c < COMET_TRACK_COLS) {
			if (c === start) {
				buffer.drawText("🐳", this.screenX + c, this.screenY, this._headFg, bg)
				c += ASSEMBLY // whale spans two display columns
				continue
			}
			const behind = dirRight ? stern - c : c - stern
			const inTail = dirRight ? c < stern && c > tailEnd : c > stern && c < tailEnd
			if (inTail && behind >= 0) {
				if (this._gradient) {
					// identity gradient tail: brand blue at the head fading to
					// purple along the tail (skin contract §1 "彗星")
					const color = parseColor(identityHexAt(Math.min(1, behind / TAIL), this._mode))
					buffer.drawText("█", this.screenX + c, this.screenY, color, bg)
				} else {
					buffer.drawText(cometRampChar(behind), this.screenX + c, this.screenY, this._trackFg, bg)
				}
			} else {
				buffer.drawText("░", this.screenX + c, this.screenY, this._trackFg, bg)
			}
			c += 1
		}
	}
}

extend({ comet_track: CometTrackRenderable })

declare module "@opentui/solid" {
	interface OpenTUIComponents {
		comet_track: typeof CometTrackRenderable
	}
}
